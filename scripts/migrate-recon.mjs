// Read-only reconnaissance of the station spreadsheet, for the move to Firestore.
//
// WHY THIS COMES FIRST: the migration has to map each sheet to a collection, and the only honest source for that
// mapping is the sheet's own headers. docs/FIRESTORE_MODEL.md describes the shape the CODE expects; the sheet is
// what is actually there, and the two have drifted before. So this pass reads, prints, and writes nothing.
//
// It needs two things and will say so plainly if either is missing:
//
//   - the service account key (MIGRATE_SERVICE_ACCOUNT, or the only .json in secrets/)
//   - the spreadsheet id (MIGRATE_SPREADSHEET_ID, or as the first argument - a full sheet URL works too)
//
// It never prints the key, the token, or any cell beyond the header row: this is a shape report, not a data dump,
// and a migration tool that leaks the station's data into a terminal scrollback is a bad tool.
//
// Run with: npm run migration:recon
import { createSign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Read-only, and nothing wider: this pass must not be able to change anything even if it is misused.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

// --- the service account's token, without pulling in googleapis ------------------------------------------------
//
// A service account signs a JWT with its own private key and exchanges it for an access token. That is the whole of
// what a client library would do here, and doing it in twenty lines keeps a heavy dependency tree out of a
// maintenance script.

const b64url = (value) => Buffer.from(value).toString('base64url');

export const signedJwt = ({
  clientEmail,
  privateKey,
  scopes = SCOPES,
  tokenUrl = TOKEN_URL,
  now = Math.floor(Date.now() / 1000),
}) => {
  const signing = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: scopes.join(' '),
      aud: tokenUrl,
      iat: now,
      exp: now + 3600, // an hour, which is Google's ceiling for this exchange
    })
  )}`;
  const signature = createSign('RSA-SHA256').update(signing).sign(privateKey);
  return `${signing}.${signature.toString('base64url')}`;
};

export const accessTokenFor = async ({ clientEmail, privateKey, fetchImpl = fetch }) => {
  const assertion = signedJwt({ clientEmail, privateKey });
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    // The body carries Google's own explanation (bad key, API not enabled, clock skew) and is worth showing.
    throw new Error(
      `Google refused the token request (${response.status}). ${await response.text()}\n` +
        'A 400 naming "invalid_grant" usually means the key was rotated or the service account was deleted.'
    );
  }
  return (await response.json()).access_token;
};

// --- inputs -----------------------------------------------------------------------------------------------------

// The key file: named explicitly, or the single .json in the directory, or a useful error listing what is there.
export const resolveServiceAccount = ({ env = process.env, dir = 'secrets' } = {}) => {
  const named = env.MIGRATE_SERVICE_ACCOUNT;
  const candidates = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => path.join(dir, name))
    : [];
  const file = named || (candidates.length === 1 ? candidates[0] : null);

  if (!file) {
    throw new Error(
      `No service-account key found. Set MIGRATE_SERVICE_ACCOUNT, or put one .json in ${dir}/.\n` +
        (candidates.length
          ? `There are ${candidates.length} files there (${candidates.join(', ')}), so which one is not obvious.`
          : `That directory is ${existsSync(dir) ? 'empty' : 'missing'}.`)
    );
  }

  const key = JSON.parse(readFileSync(file, 'utf8'));
  if (!key.client_email || !key.private_key) {
    throw new Error(`${file} does not look like a service-account key (no client_email/private_key).`);
  }
  return { file, clientEmail: key.client_email, privateKey: key.private_key, projectId: key.project_id };
};

// The spreadsheet: an id, or a full URL, which people have to hand more often than an id.
export const spreadsheetIdFrom = (value) => {
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(String(value || ''));
  return match ? match[1] : String(value || '').trim();
};

export const resolveSpreadsheetId = ({ env = process.env, argv = [] } = {}) => {
  const argument = argv.find((value) => !value.startsWith('-')) || '';
  const id = spreadsheetIdFrom(env.MIGRATE_SPREADSHEET_ID || argument);
  if (!id) {
    throw new Error(
      'No spreadsheet id. Set MIGRATE_SPREADSHEET_ID, or pass one as the first argument - the id is the long\n' +
        'string between /d/ and /edit in the sheet\'s URL. A whole URL works too.'
    );
  }
  return id;
};

// --- reading the shape ------------------------------------------------------------------------------------------

export const tabProperties = (spreadsheet) =>
  (spreadsheet.sheets || []).map((sheet) => ({
    title: sheet.properties.title,
    // The sheet id is stable while a title is not, and a later phase wants it for deletes.
    sheetId: sheet.properties.sheetId,
    allocatedRows: sheet.properties.gridProperties?.rowCount ?? 0,
    allocatedColumns: sheet.properties.gridProperties?.columnCount ?? 0,
  }));

// The header row, trimmed, with blanks left as empty strings: the mapping is written against these.
export const headersFrom = (values) => ((values && values[0]) || []).map((cell) => String(cell ?? '').trim());

// How many rows actually hold something. A sheet's own rowCount is what is ALLOCATED, not what is used, so counting
// is the only honest answer - and it is what says whether a tab is worth migrating at all.
export const usedRowsFrom = (values) =>
  ((values || []).filter((row) => (row || []).some((cell) => String(cell ?? '').trim() !== '')) || []).length;

// Two headers that read the same, or one that is blank, is a mapping waiting to go wrong: a blank column cannot be
// named in the mapping, and a duplicate cannot be told apart from its twin.
export const headerProblems = (headers) => {
  const problems = [];
  const seen = new Map();
  headers.forEach((header, index) => {
    if (!header) problems.push(`column ${index + 1} has no header`);
    else if (seen.has(header)) problems.push(`"${header}" appears at columns ${seen.get(header) + 1} and ${index + 1}`);
    else seen.set(header, index);
  });
  return problems;
};

// --- the report -------------------------------------------------------------------------------------------------

const wholeTab = (title) => `${title}!A1:ZZ`;

const apiGet = async (url, token) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Sheets API failed (${response.status}). ${await response.text()}`);
  }
  return response.json();
};

export const report = async ({ spreadsheetId, token }) => {
  const meta = await apiGet(`${SHEETS_API}/${spreadsheetId}?fields=properties.title,sheets.properties`, token);
  const tabs = tabProperties(meta);

  // One request for every tab's cells rather than one per tab: thirty round trips to Google is a slow way to learn
  // thirty row counts.
  const ranges = tabs.map((tab) => `ranges=${encodeURIComponent(wholeTab(tab.title))}`);
  const batch = await apiGet(`${SHEETS_API}/${spreadsheetId}/values:batchGet?${ranges.join('&')}`, token);

  const lines = [`Spreadsheet: ${meta.properties?.title || '(untitled)'}`, `${tabs.length} tab(s)`, ''];
  const empty = [];

  tabs.forEach((tab, index) => {
    const values = batch.valueRanges?.[index]?.values;
    const headers = headersFrom(values);
    const used = usedRowsFrom(values);
    const problems = headerProblems(headers);
    if (used <= 1) empty.push(tab.title);
    lines.push(`${tab.title}  -  ${used} row(s) including the header, ${headers.length} column(s)`);
    lines.push(`  headers: ${headers.map((header) => header || '(blank)').join(' | ')}`);
    if (problems.length) lines.push(`  CHECK: ${problems.join('; ')}`);
    lines.push('');
  });

  if (empty.length) lines.push(`Tab(s) with no data rows: ${empty.join(', ')}`);

  return lines.join('\n');
};

// --- main, only when run directly (so a harness can import the above) --------------------------------------------

const main = async () => {
  const spreadsheetId = resolveSpreadsheetId({ argv: process.argv.slice(2) });
  const account = resolveServiceAccount();
  console.log(`Reading with ${account.clientEmail}`);
  const token = await accessTokenFor(account);
  console.log(await report({ spreadsheetId, token }));
  console.log('Nothing was written. This is the input for the collection mapping.');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}

export { main };
