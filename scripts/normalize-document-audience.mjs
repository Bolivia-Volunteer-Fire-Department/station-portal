// `documents.audience_keys` after a change that made "Minimum rank" mean a rank and above.
//
// WHY THIS EXISTS. The document editor has always labelled that field "Minimum rank" and both help pages have always
// described it as "a rank and above" - but the save stored the single rank id, so `array-contains-any` matched that one
// rank and nothing else. A document with a minimum of Firefighter was invisible to a Captain: not "not aimed at you",
// simply absent, with nothing on screen to say why. `ADMIN_SAVE_DOCUMENT` now passes `rankAndAbove: true`, which fixes
// every document saved from now on.
//
// ...AND NONE OF THE ONES ALREADY SAVED. `audience_keys` is MATERIALIZED on the row - the reason it exists is that a
// query cannot compare rank orders, so the ranks at or above the minimum are written out as concrete ids at save time.
// That is also what makes this necessary: a stored list is a snapshot of a rule that has since changed, and nothing
// re-derives it. A document saved before the fix keeps its single-rank list until it is saved again, so the bug persists
// in the station's live data with the code now correct around it - the worst combination, because the fix looks applied.
//
// WHAT IT CHANGES, AND ONLY THIS: documents whose audience is a RANK, and only their `audience_keys` field. A document
// aimed at a role, at one member, or at everybody is left exactly as it is, and so is every other field on every document -
// title, body, revision, dates, author. This is a data repair, not an editor.
//
// WHAT IT REFUSES TO GUESS AT. A document with no `rank_id` but a rank in its stored `audience_keys` is one this script
// cannot reason about - the minimum rank it was saved with is not recorded anywhere on the row, so any expansion would be
// a guess, and a guess written to production is how a document silently widens. Those are counted and listed, and left
// alone. Save that document once through the editor and it is correct.
//
// SAFE TO RUN TWICE, which is what makes it usable as a check as well as a fix: it writes only the documents whose list
// is actually wrong, so a second run reports nothing to do.
//
// THE EXPANSION IS THE APP'S OWN FUNCTION, imported from services/firestoreWrites rather than restated here. That module
// is normally unloadable in plain Node (it imports `firebase/firestore` without an extension, which Node ESM will not
// resolve), which is why every other script here re-implements what it needs - and it turns out to load all the same,
// because the SDK's own package exports satisfy the bare specifier. So the one thing that must not drift between this
// script and the app - what "a rank and above" MEANS - is literally the same code, and scripts/verify-documents.mjs
// asserts that this file and the app agree rather than trusting it.
//
// The Admin SDK is imported inside main(), NOT here, for the reason every script in this repo does it: it lives in
// functions/node_modules, so a static import would make this module unloadable from anywhere else.
//
// Run with: npm run docs:audience               (report only - the default)
//           npm run docs:audience -- --apply    (write)
//
// The project comes from .firebaserc and the credentials from THE MIGRATION'S OWN KEY - a file named by
// MIGRATE_SERVICE_ACCOUNT, or the single .json in secrets/. That is the path that needs no gcloud at all, and it is why
// normalize-date-columns.mjs has it: application default credentials are the FALLBACK, not the answer, because gcloud is
// not installed everywhere this runs. Both are tried; see the guidance printed if neither is there.
import { audienceKeysForWrite } from '../src/services/firestoreWrites.js';
// The migration's account resolution, so there is ONE credentials convention in this repository rather than one per script.
import { resolveServiceAccount } from './migrate-recon.mjs';

const text = (value) => String(value ?? '').trim();

// What `audience_keys` a stored document SHOULD carry, or `null` to leave it exactly as it is.
//
// `null` is the common answer and it covers four different situations on purpose: a document with no minimum rank, one
// aimed at everybody, one aimed at a role, one aimed at a single member, and - the fourth and most satisfying - one whose
// stored list is already right. That last is most of a typical station: a document with a minimum at the TOP of the ladder
// expands to that one rank, which is exactly what the old code stored, so it was never broken and must not be "fixed".
//
// The comparison is on the SET rather than the order, because the expansion reads the ranks collection in whatever order
// it comes back and a list in a different order is not a different audience. Rewriting those would touch every document in
// the station to change nothing.
export const correctedAudienceKeys = (document, ranks) => {
  const row = document || {};
  const rankId = text(row.rank_id);
  // No minimum rank recorded: this is not a rank-audience document, or it is one whose minimum this script cannot know.
  if (!rankId) return null;

  let wanted;
  try {
    wanted = audienceKeysForWrite({ rankId, ranks, rankAndAbove: true });
  } catch {
    // `audienceKeysForWrite` refuses a rank that is not on the ladder - and it is right to: expanding a minimum that no
    // longer exists would silently widen the document to every rank. Nothing to repair here; the editor will refuse the
    // save too, which is where this gets fixed properly.
    return null;
  }

  const stored = Array.isArray(row.audience_keys) ? row.audience_keys.map(text).filter(Boolean) : [];
  // A document with no stored list at all is NOT a document to repair: it was saved with no audience column, which is a
  // different fault (nobody can see it) and is fixed by saving it, not by this script inventing an audience for it.
  if (!stored.length) return null;
  const alreadyRight = stored.length === wanted.length && wanted.every((key) => stored.includes(key));
  return alreadyRight ? null : wanted;
};

// WHY A ROW CANNOT BE JUDGED, named rather than left as a silent skip, because a document that silently keeps its
// broken audience is the whole failure this script is reporting on. A rank in the list with no `rank_id` to expand it
// from is the only shape this happens in.
export const isUnjudgeable = (document) => {
  const row = document || {};
  if (text(row.rank_id)) return false;
  const stored = Array.isArray(row.audience_keys) ? row.audience_keys : [];
  return stored.some((key) => text(key).startsWith('rank:'));
};

import { readFileSync } from 'node:fs';

// The project this checkout deploys to, from .firebaserc - the same file `firebase deploy` reads, so there is one place that
// says which project this is and no environment variable to remember.
const projectFromFirebaserc = () => {
  try {
    const text = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8');
    return String((JSON.parse(text).projects || {}).default || '');
  } catch {
    return '';
  }
};

const main = async () => {
  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const apply = process.argv.includes('--apply');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc();
  console.log(`Reading documents from ${emulator ? 'the emulator' : projectId || 'production'}${apply ? '' : ' (report only)'}`);

  // THE MIGRATION'S OWN KEY FIRST, the same order normalize-date-columns.mjs uses, because `applicationDefault()`
  // answers "Could not load the default credentials" on any machine without gcloud - which is this one, and is the whole
  // reason this is tried rather than assumed. It THROWS when it finds no key, which is not fatal: a machine with
  // application default credentials is a perfectly good second answer, and GOOGLE_APPLICATION_CREDENTIALS is honoured by
  // the fallback below.
  let account = null;
  try {
    account = resolveServiceAccount();
  } catch {
    account = null;
  }

  let db;
  try {
    // THE CREDENTIAL HELD ON ITS OWN, not read back off the app: firebase-admin 13 dropped `app.credential` from the
    // App interface, so reaching for it yields undefined and the token is never resolved. Holding it here means the
    // resolution below has something to ask, whatever route produced it.
    const credential = emulator
      ? null
      : account
        ? cert(account.file)
        : applicationDefault();
    const app = emulator
      ? initializeApp({ projectId: projectId || 'demo-station-portal' })
      : initializeApp({ credential, projectId: projectId || account?.projectId });

    // RESOLVE THE CREDENTIAL HERE, INSIDE THE TRY - and only against a real project, because the emulator is the one
    // mode that legitimately has no credentials to resolve. Neither `applicationDefault()` nor `getFirestore()` throws
    // when there are no credentials: both are lazy, and the lookup happens on the first query, which is well past this
    // block. That is how the guidance below stayed DEAD CODE while printing an unhandled rejection and a forty-line
    // stack instead - the reader asked for a token, got "Could not load the default credentials", and nothing was
    // listening. Forcing the token here turns a late crash into the message this block exists to print.
    if (credential) await credential.getAccessToken();
    db = getFirestore(app);
  } catch (error) {
    console.error(
      [
        `Could not reach ${emulator ? 'the emulator' : projectId ? `project ${projectId}` : 'a project'}:`,
        `  ${(error && error.message) || error}`,
        '',
        'NO CREDENTIALS WERE FOUND. Against a real project this needs a service-account key - the one thing the Admin SDK',
        'cannot invent. Either of these works, and neither needs gcloud:',
        '  secrets/<name>.json          (any single .json in that folder), or',
        '  MIGRATE_SERVICE_ACCOUNT=/path/to/key.json npm run docs:audience',
        'Application default credentials are the fallback, for a machine that has them:',
        `  gcloud auth application-default login${projectId ? ` && gcloud config set project ${projectId}` : ''}`,
        'Against the emulator, run it inside one:',
        '  firebase emulators:exec --only firestore "npm run docs:audience"',
      ].join('\n')
    );
    process.exit(1);
  }

  // THE RANKS FIRST, and they are not optional: "a rank and above" cannot be expanded without knowing what is on the
  // ladder. A rank that has since been deleted simply will not appear, and the document naming it is then unjudgeable -
  // which is the correct answer, and why the ladder is read fresh rather than assumed.
  const ranks = (await db.collection('ranks').get()).docs.map((document) => ({ id: document.id, ...document.data() }));
  const documents = await db.collection('documents').get();

  const wanted = [];
  const unjudgeable = [];
  const audienceByDocument = new Map();
  documents.forEach((document) => {
    const row = { id: document.id, ...document.data() };
    if (isUnjudgeable(row)) {
      unjudgeable.push(row);
      return;
    }
    const to = correctedAudienceKeys(row, ranks);
    const audienceKeys = to || (Array.isArray(row.audience_keys) ? row.audience_keys : []);
    audienceByDocument.set(row.id, audienceKeys);
    if (to) wanted.push({ id: row.id, from: row.audience_keys || [], to });
  });

  const checklistItems = await db.collection('document_checklist_items').get();
  const checklistWanted = [];
  const orphanChecklistItems = [];
  checklistItems.forEach((item) => {
    const row = { id: item.id, ...item.data() };
    const documentId = text(row.document_id);
    const audienceKeys = audienceByDocument.get(documentId);
    if (!audienceKeys) {
      orphanChecklistItems.push(row.id);
      return;
    }
    const stored = Array.isArray(row.audience_keys) ? row.audience_keys.map(text).filter(Boolean) : [];
    const matches = stored.length === audienceKeys.length && audienceKeys.every((key) => stored.includes(key));
    if (!matches) checklistWanted.push({ id: row.id, documentId, from: stored, to: audienceKeys });
  });

  console.log(`  ${ranks.length} rank(s), ${documents.size} document(s)`);
  console.log(`  ${wanted.length} holding an audience narrower than their minimum rank`);
  console.log(`  ${unjudgeable.length} cannot be judged (see below)`);
  console.log(`  ${checklistWanted.length} checklist item(s) need the parent audience copied`);
  console.log(`  ${orphanChecklistItems.length} checklist item(s) have no parent audience to copy`);
  wanted.slice(0, 20).forEach((entry) => {
    console.log(`    ${entry.id}: ${JSON.stringify(entry.from)} -> ${JSON.stringify(entry.to)}`);
  });
  if (wanted.length > 20) console.log(`    ... and ${wanted.length - 20} more`);
  unjudgeable.slice(0, 20).forEach((row) => {
    console.log(`    ${row.id}: rank in the audience, no minimum rank recorded - save it once to repair it`);
  });
  if (unjudgeable.length > 20) console.log(`    ... and ${unjudgeable.length - 20} more`);
  checklistWanted.slice(0, 20).forEach((entry) => {
    console.log(`    checklist ${entry.id} (${entry.documentId}): ${JSON.stringify(entry.from)} -> ${JSON.stringify(entry.to)}`);
  });
  if (checklistWanted.length > 20) console.log(`    ... and ${checklistWanted.length - 20} more checklist item(s)`);

  if (!apply) {
    console.log('\nNothing was written. Add --apply to repair document and checklist audiences.');
    return;
  }
  // `update` with a single field, NOT `set` with the whole row read back: the read is a snapshot and a set would write
  // back anything that changed in between, which is how a repair script quietly reverts somebody's edit.
  for (let index = 0; index < wanted.length; index += 400) {
    const batch = db.batch();
    wanted
      .slice(index, index + 400)
      .forEach((entry) => batch.update(db.doc(`documents/${entry.id}`), { audience_keys: entry.to }));
    await batch.commit();
  }
  for (let index = 0; index < checklistWanted.length; index += 400) {
    const batch = db.batch();
    checklistWanted.slice(index, index + 400).forEach((entry) =>
      batch.update(db.doc(`document_checklist_items/${entry.id}`), { audience_keys: entry.to })
    );
    await batch.commit();
  }
  console.log(`\nRewrote ${wanted.length} document audience(s) and ${checklistWanted.length} checklist audience(s).`);
  if (unjudgeable.length) {
    console.log(`${unjudgeable.length} still need saving once through the editor - this script will not guess at them.`);
  }
};

// Only when run as a command, so a harness can import the decisions above without doing any of this.
if (process.argv[1] && process.argv[1].includes('normalize-document-audience')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}