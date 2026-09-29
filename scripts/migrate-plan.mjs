// The migration PLAN: read the sheet, map it, check it, print what would be written - and write nothing.
//
// This is the step between "we know the shape" and "we are writing production data with the Admin SDK, which
// bypasses firestore.rules entirely". Everything it reports is something that would otherwise be discovered as a
// missing screen after cutover: a foreign key that does not resolve, a document over Firestore's 1 MiB limit, a
// credential about to be copied, an audience no query can express.
//
// It is deliberately not a dry run of the writer's code, because the writer does not exist yet. It is a dry run of
// the MAPPING, which is the part that can be wrong in silence.
//
// Run with: npm run migration:plan
import { accessTokenFor, resolveServiceAccount, resolveSpreadsheetId } from './migrate-recon.mjs';
import { TAB_MAP, audienceKeysFrom, isSecretKey, skippedTabs } from './migration-map.mjs';
import { pathToFileURL } from 'node:url';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Firestore's own limit, checked before anything is written rather than discovered as a failed write.
const DOCUMENT_LIMIT = 1024 * 1024;

const apiGet = async (url, token) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Sheets API failed (${response.status}). ${await response.text()}`);
  return response.json();
};

// One object per header, blanks left out and every value a trimmed string: the sheet's own types are not trusted (a
// number arrives as a number, a date as a serial) and Firestore wants the string the app reads.
export const rowsFrom = (values) => {
  const headers = ((values && values[0]) || []).map((cell) => String(cell ?? '').trim());
  return (values || []).slice(1).map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = String((row || [])[index] ?? '').trim();
    });
    return record;
  });
};

// One tab's worth of mapping: the documents each of its collections would receive, plus everything wrong with it.
// Pure, so the harness can hand it a fixture sheet and check the answers.
export const planForTab = ({ tab, spec, rows, ranks = [], knownIds = {} }) => {
  const problems = [];
  const collections = {};
  const push = (name, document) => {
    (collections[name] = collections[name] || []).push(document);
  };

  const seenIds = new Set();
  rows.forEach((row) => {
    const id = String(row[spec.key] ?? '').trim();
    if (!id) {
      problems.push(`${tab}: a row with no ${spec.key} is skipped`);
      return;
    }
    if (seenIds.has(id)) problems.push(`${tab}: ${id} appears twice`);
    seenIds.add(id);
  });

  const junk = (spec.junk || []).flatMap((pattern) => Object.keys(rows[0] || {}).filter((h) => pattern.test(h)));
  if (junk.length) problems.push(`${tab}: ${junk.length} junk column(s) ignored (${junk.join(', ')})`);

  rows.forEach((row) => {
    Object.keys(row).forEach((header) => {
      if (isSecretKey(header) && !(spec.drop || []).includes(header)) {
        problems.push(`${tab}: column "${header}" looks like a credential and was NOT copied`);
      }
    });
  });

  // Foreign keys: `id_migration` exists because every id in this sheet was rewritten once, so nothing is assumed.
  Object.entries(spec.foreignKeys || {}).forEach(([field, target]) => {
    const ids = knownIds[target];
    if (!ids) return;
    rows.forEach((row) => {
      const value = String(row[field] || '').trim();
      if (!value) return;
      if (!ids.has(value)) problems.push(`${tab}: ${field}=${value} does not exist in ${target}`);
    });
  });

  // The settings pair: one document per side, not one per row.
  if (spec.pair) {
    const publicKeys = new Set(spec.publicKeys || []);
    const sides = { public: {}, private: {} };
    rows.forEach((row) => {
      const key = String(row[spec.pair.key] || '').trim();
      if (!key) return;
      if (isSecretKey(key)) {
        problems.push(`${tab}: "${key}" is a credential and was NOT copied`);
        return;
      }
      if (key.startsWith('fcm_')) {
        problems.push(`${tab}: "${key}" is web-app config (not a secret, but not data either)`);
      }
      sides[publicKeys.has(key) ? 'public' : 'private'][key] = String(row[spec.pair.value] ?? '');
    });
    push('settings/public', sides.public);
    push('settings/private', sides.private);
  }

  rows.forEach((row) => {
    const id = String(row[spec.key] ?? '').trim();
    if (!id) return;

    const document = {};
    Object.entries(row).forEach(([header, value]) => {
      if ((spec.drop || []).includes(header)) return;
      if ((spec.junk || []).some((pattern) => pattern.test(header))) return;
      if (spec.rename && spec.rename[header]) {
        document[spec.rename[header]] = value;
        return;
      }
      document[header] = value;
    });
    Object.entries(spec.derive || {}).forEach(([field, derive]) => {
      document[field] = derive(row);
    });

    if (spec.audience) {
      const answer = audienceKeysFrom({ row, ranks, rankAndAbove: spec.audience.rankAndAbove });
      document.audience_keys = answer.keys;
      if (answer.notRepresentable) {
        problems.push(`${tab}: ${id} fills more than one audience column, which no array can express`);
      }
      if (answer.unknownRank) problems.push(`${tab}: ${id} targets rank ${answer.unknownRank}, which is not in ranks`);
    }

    if (!spec.pair) push(spec.collections[0], document);

    if (spec.toPrivate) {
      const privateDocument = {};
      spec.toPrivate.forEach((field) => {
        privateDocument[field] = document[field] ?? '';
        delete document[field];
      });
      push('users_private', privateDocument);
    }

    if (spec.privateExtras) {
      const privateDocument = {};
      if (document.admin_note === undefined) privateDocument.admin_note = '';
      Object.keys(spec.privateExtras).forEach((field) => {
        privateDocument[field] = document[field] ?? spec.privateExtras[field];
      });
      push(spec.collections[1], privateDocument);
    }

    const size = Buffer.byteLength(JSON.stringify(document));
    if (size > DOCUMENT_LIMIT) {
      problems.push(`${tab}: ${id} is ${Math.round(size / 1024)} KiB, over Firestore's 1 MiB document limit`);
    }
  });

  return { collections, problems };
};

// --- the run -----------------------------------------------------------------------------------------------------

const tabValues = async ({ spreadsheetId, token }) => {
  const meta = await apiGet(`${SHEETS_API}/${spreadsheetId}?fields=properties.title,sheets.properties`, token);
  const titles = (meta.sheets || []).map((sheet) => sheet.properties.title);
  const ranges = titles.map((title) => `ranges=${encodeURIComponent(`${title}!A1:ZZ`)}`).join('&');
  const batch = await apiGet(`${SHEETS_API}/${spreadsheetId}/values:batchGet?${ranges}`, token);
  return { title: meta.properties?.title || '(untitled)', tabs: titles.map((title, index) => ({ title, values: batch.valueRanges?.[index]?.values })) };
};

export const planForTabs = ({ tabs }) => {
  const rowsByTab = {};
  const idsByTab = {};
  tabs.forEach(({ title, values }) => {
    rowsByTab[title] = rowsFrom(values);
    idsByTab[title] = new Set(rowsByTab[title].map((row) => String(row.id || '').trim()).filter(Boolean));
  });

  const ranks = rowsByTab.ranks || [];
  const totals = {};
  const problems = [];
  const lines = [];

  const mapped = tabs.filter(({ title }) => TAB_MAP[title] && !TAB_MAP[title].skip);
  const unknown = tabs.filter(({ title }) => !TAB_MAP[title]).map(({ title }) => title);

  mapped.forEach(({ title }) => {
    const spec = TAB_MAP[title];
    const { collections, problems: found } = planForTab({
      tab: title,
      spec: spec.skip ? {} : spec,
      rows: rowsByTab[title],
      ranks,
      knownIds: idsByTab,
    });
    const parts = Object.entries(collections).map(([name, documents]) => {
      totals[name] = (totals[name] || 0) + documents.length;
      return `${name} ${documents.length}`;
    });
    lines.push(`${title}  -  ${rowsByTab[title].length} row(s)  ->  ${parts.join(', ')}`);
    problems.push(...found);
  });

  if (unknown.length) problems.push(`tabs with no mapping at all: ${unknown.join(', ')}`);
  const skipped = skippedTabs();
  if (skipped.length) lines.push(`skipped by design: ${skipped.join(', ')}`);

  return { lines, totals, problems };
};

const main = async () => {
  const spreadsheetId = resolveSpreadsheetId({ argv: process.argv.slice(2) });
  const account = resolveServiceAccount();
  console.log(`Reading with ${account.clientEmail}`);
  const token = await accessTokenFor(account);
  const { title, tabs } = await tabValues({ spreadsheetId, token });
  const { lines, totals, problems } = planForTabs({ tabs });

  console.log(`\nSpreadsheet: ${title}`);
  console.log(`${tabs.length} tab(s)\n`);
  lines.forEach((line) => console.log(line));

  console.log('\nWhat would be written:');
  Object.entries(totals)
    .sort()
    .forEach(([name, count]) => console.log(`  ${String(count).padStart(5)}  ${name}`));

  console.log(`\nNeeds attention (${problems.length}):`);
  if (problems.length === 0) console.log('  nothing');
  problems.forEach((problem) => console.log(`  - ${problem}`));

  console.log('\nNOTHING WAS WRITTEN. The next step is the writer, which runs as the Admin SDK.');
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}

export { main };
