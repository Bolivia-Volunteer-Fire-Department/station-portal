/**
 * Verifies the migration's reconnaissance pass, which is the part of it that can be checked without the station's
 * sheet or its key.
 *
 * What this exists for: the recon script talks to Google with a hand-built JWT and prints a shape report, and both
 * halves fail in ways that look like something else when they break - a wrong signature comes back as `invalid_grant`
 * from Google, and a wrong range comes back as an empty tab that reads exactly like a tab nobody uses. Neither is
 * worth discovering while migrating production data, so:
 *
 *   - the JWT is signed with a keypair generated HERE and verified with its own public key, which proves the signing
 *     rather than trusting it, and the claims are asserted one by one;
 *   - the token exchange and the report run against a stubbed `fetch`, so the request SHAPES (grant type, bearer
 *     header, encoded ranges) are checked without a network or a credential;
 *   - the input resolution is checked against a temporary directory, including the two failure messages, because
 *     "which key did you mean" is the first thing that will go wrong on a new machine.
 *
 * What this cannot check: that the real key is accepted, that the real sheet has the tabs the model expects, or that
 * the service account can see the file at all. Those need the live spreadsheet, and the whole point of a read-only
 * first pass is to find out.
 *
 * Run with: npm run verify:migration-recon
 */
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  accessTokenFor,
  headerProblems,
  headersFrom,
  report,
  resolveServiceAccount,
  resolveSpreadsheetId,
  signedJwt,
  spreadsheetIdFrom,
  tabProperties,
  usedRowsFrom,
} from './migrate-recon.mjs';

let failures = 0;
const checkIs = (label, condition, detail = '') => {
  const ok = condition === true;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: ${detail || 'expected true'}`}`);
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkThrows = (label, run) => {
  try {
    run();
    failures++;
    console.log(`FAIL ${label}: nothing was thrown`);
  } catch {
    console.log(`ok   ${label}`);
  }
};

// --- the JWT: signed here, verified here -------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const jwt = signedJwt({
  clientEmail: 'migration@fire-clock-76723.iam.gserviceaccount.com',
  privateKey,
  now: 1_700_000_000,
});

const [header, claim, signature] = jwt.split('.');
check('the JWT has three parts', jwt.split('.').length, 3);
check('and says it is RS256', JSON.parse(Buffer.from(header, 'base64url').toString()).alg, 'RS256');

const claims = JSON.parse(Buffer.from(claim, 'base64url').toString());
check('the issuer is the service account', claims.iss, 'migration@fire-clock-76723.iam.gserviceaccount.com');
check('the audience is the token endpoint', claims.aud, 'https://oauth2.googleapis.com/token');
check('the scope is read-only Sheets', claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
check('issued now, valid for an hour', [claims.iat, claims.exp], [1_700_000_000, 1_700_003_600]);

// The signature is the part that is worth proving rather than trusting: a wrong encoding here fails at Google with a
// message about the grant, not about the signature.
checkIs(
  'the signature verifies against the matching public key',
  verify('RSA-SHA256', Buffer.from(`${header}.${claim}`), publicKey, Buffer.from(signature, 'base64url'))
);
const other = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
checkIs(
  'and does NOT verify against a different one',
  verify('RSA-SHA256', Buffer.from(`${header}.${claim}`), other.publicKey, Buffer.from(signature, 'base64url')) === false
);

// --- the token exchange, against a stubbed fetch ------------------------------------------------------------------

const tokenCalls = [];
const token = await accessTokenFor({
  clientEmail: 'migration@example.iam.gserviceaccount.com',
  privateKey,
  fetchImpl: async (url, options) => {
    tokenCalls.push({ url, options });
    return { ok: true, json: async () => ({ access_token: 'ya29.stub' }) };
  },
});
check('the access token comes back', token, 'ya29.stub');
check('one POST to the token endpoint', [tokenCalls.length, tokenCalls[0].url], [1, 'https://oauth2.googleapis.com/token']);
check(
  'granted as a JWT bearer assertion',
  tokenCalls[0].options.body.toString().startsWith('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&'),
  true
);

const refusal = await accessTokenFor({
  clientEmail: 'migration@example.iam.gserviceaccount.com',
  privateKey,
  fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' }),
}).then(
  () => 'no error',
  (error) => error.message
);
checkIs("Google's own words survive a refusal", refusal.includes('invalid_grant') && refusal.includes('400'), refusal);

// --- the inputs ---------------------------------------------------------------------------------------------------

const dir = mkdtempSync(path.join(tmpdir(), 'migrate-recon-one-'));
const pairDir = mkdtempSync(path.join(tmpdir(), 'migrate-recon-two-'));
const keyJson = JSON.stringify({
  client_email: 'migrate@x.iam.gserviceaccount.com',
  private_key: privateKey,
  project_id: 'x',
});
writeFileSync(path.join(dir, 'key.json'), keyJson);
writeFileSync(path.join(pairDir, 'key.json'), keyJson);
writeFileSync(
  path.join(pairDir, 'unrelated.json'),
  JSON.stringify({ client_email: 'other@x.iam.gserviceaccount.com', private_key: privateKey })
);

const chosen = resolveServiceAccount({ dir });
checkIs('one key in the directory and no naming needed', chosen.clientEmail === 'migrate@x.iam.gserviceaccount.com', chosen.clientEmail);
const named = resolveServiceAccount({ dir: pairDir, env: { MIGRATE_SERVICE_ACCOUNT: path.join(pairDir, 'unrelated.json') } });
check('a named key wins', named.clientEmail, 'other@x.iam.gserviceaccount.com');
checkThrows('two keys and no name is refused, with what is there', () => resolveServiceAccount({ dir: pairDir }));
const missing = (() => {
  try {
    resolveServiceAccount({ dir: path.join(dir, 'nope') });
  } catch (error) {
    return error.message;
  }
  return '';
})();
checkIs('and a missing directory says so', missing.includes('missing'), missing);

check('an id passes through', spreadsheetIdFrom('1AbC-dEf'), '1AbC-dEf');
check(
  'a whole URL is understood, because that is what people have to hand',
  spreadsheetIdFrom('https://docs.google.com/spreadsheets/d/1AbC-dEf_ghi/edit#gid=0'),
  '1AbC-dEf_ghi'
);
check('the environment wins over the argument', resolveSpreadsheetId({ env: { MIGRATE_SPREADSHEET_ID: 'env-id' }, argv: ['arg-id'] }), 'env-id');
check('an argument is used otherwise', resolveSpreadsheetId({ env: {}, argv: ['arg-id'] }), 'arg-id');
checkThrows('and neither is refused', () => resolveSpreadsheetId({ env: {}, argv: [] }));

// --- the shape readers --------------------------------------------------------------------------------------------

check('headers are trimmed', headersFrom([['  id  ', 'name', '']]), ['id', 'name', '']);
check(
  'a blank column and a duplicated header are both reported, in column order',
  headerProblems(['id', 'name', 'name', '']),
  ['"name" appears at columns 2 and 3', 'column 4 has no header']
);
check('and a clean header row reports nothing', headerProblems(['id', 'name']), []);
check('rows are counted as used, not as allocated', usedRowsFrom([['id'], ['a'], [''], ['', '  '], ['b']]), 3);
check('a tab with only a header has one used row', usedRowsFrom([['id'], ['', '']]), 1);
check(
  'tabs carry their stable sheet id',
  tabProperties({ sheets: [{ properties: { title: 'Users', sheetId: 7, gridProperties: { rowCount: 1000, columnCount: 26 } } }] }),
  [{ title: 'Users', sheetId: 7, allocatedRows: 1000, allocatedColumns: 26 }]
);

// --- the report, against a stubbed Sheets API --------------------------------------------------------------------

const seen = [];
globalThis.fetch = async (url, options) => {
  seen.push({ url, auth: options.headers.Authorization });
  if (url.includes('values:batchGet')) {
    return {
      ok: true,
      json: async () => ({
        valueRanges: [
          { values: [['id', 'name'], ['1', 'Ana'], ['2', 'Luis']] },
          { values: [['id'], ['', '  ']] },
        ],
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      properties: { title: 'Station' },
      sheets: [
        { properties: { title: 'Users', sheetId: 1, gridProperties: { rowCount: 1000, columnCount: 26 } } },
        { properties: { title: 'Roles', sheetId: 2, gridProperties: { rowCount: 1000, columnCount: 26 } } },
      ],
    }),
  };
};

const printed = await report({ spreadsheetId: 'sheet-1', token: 'ya29.stub' });
checkIs('the bearer token is used on both reads', seen.every((call) => call.auth === 'Bearer ya29.stub'), JSON.stringify(seen));
checkIs('the range is encoded, so a tab with a space works', seen[1].url.includes('ranges=Users!A1%3AZZ'), seen[1].url);
checkIs('the tab title is printed', printed.includes('Spreadsheet: Station'), printed);
checkIs('with its row count', printed.includes('Users  -  3 row(s) including the header, 2 column(s)'), printed);
checkIs('and its headers', printed.includes('headers: id | name'), printed);
checkIs('a tab with no data rows is called out', printed.includes('Tab(s) with no data rows: Roles'), printed);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
