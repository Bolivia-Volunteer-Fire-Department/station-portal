// `signature_count` on every training, rebuilt from the `training_signatures` it is derived from.
//
//   npm run training-counts:normalize             (report only - the default)
//   npm run training-counts:normalize -- --apply  (write)
//
// WHY THIS EXISTS. The Training module needs "how many members have signed this" for every row it draws - the running
// "1 of 3 signed", and the rule that a training with ANY signature can no longer be edited. That count used to be
// recomputed on the server by scanning the whole `training_signatures` collection on every open of the module. It now
// lives ON THE TRAINING as `signature_count`, kept in step by the triggers in functions/index.js.
//
// THE GAP THIS FILLS. A counter trigger only fires on signatures added or removed AFTER it is deployed. The trainings
// that were written (and signed) BEFORE it carry no `signature_count` at all - and a training whose count reads 0 is one
// the module believes nobody has signed, so it offers to edit a record that is evidence. This script seeds the field from
// the signatures themselves.
//
// RUN IT WITH (OR IMMEDIATELY AFTER) THE FUNCTIONS DEPLOY, BEFORE the frontend that reads the field ships. The previous
// frontend asked a callable for these counts and the new one reads `training.signature_count` directly, so until the
// field is seeded the new reader answers 0 for every training. (The callable is kept as a compatibility shim that reads
// the stored field, so an already-open old bundle keeps working either way - see functions/index.js.)
//
// SAFE TO RUN TWICE, and safe as a check: the count is recomputed from the signatures every time, so a second run over a
// correct station reports nothing to do and writes nothing.
//
// THE ADMIN SDK IS IMPORTED INSIDE main(), NOT HERE: it lives in functions/node_modules, so a static import would make
// this module unloadable from a harness - the same reason scripts/normalize-certification-badges.mjs does it, and the same
// reason `signatureCountPlan` is exported from here as a pure function a test can call directly.
import { readFileSync } from 'node:fs';

// What a rebuild would write, as the counts every training should hold and the ids whose stored count disagrees. Pure, and
// therefore testable without a database.
//
// Every training in the list gets an entry, INCLUDING the zero, because the reader treats a missing field as 0 anyway and
// writing it keeps the collection uniform. A signature pointing at a training that no longer exists is reported as
// ORPHANED rather than silently dropped - it is why a signature list can count something no training shows.
export const signatureCountPlan = (signatures = [], trainings = []) => {
  const counts = {};
  (Array.isArray(signatures) ? signatures : []).forEach((signature) => {
    const id = String(signature && signature.training_id ? signature.training_id : '').trim();
    if (id) counts[id] = (counts[id] || 0) + 1;
  });

  const plan = {};
  const change = [];
  (Array.isArray(trainings) ? trainings : []).forEach((training) => {
    const id = String((training && training.id) || '');
    if (!id) return;
    const wanted = counts[id] || 0;
    plan[id] = wanted;
    const stored = Number(training.signature_count);
    if (!(Number.isFinite(stored) && stored === wanted)) change.push(id);
  });

  const orphaned = Object.keys(counts).filter((id) => !(id in plan));
  return { counts, plan, change, orphaned };
};

// The project this checkout deploys to, from .firebaserc - the same file `firebase deploy` reads, so there is one place
// that says which project this is and no environment variable to remember. The environment WINS, for the same reason the
// sibling normalizers let it: `firebase emulators:exec --project demo-station-portal` sets GCLOUD_PROJECT, and a script
// that read .firebaserc while running inside an emulator for a different project would read an EMPTY database and report
// "0 signatures" - a wrong answer with no error, which for a repair script is the worst kind.
const projectFromFirebaserc = (() => {
  try {
    const raw = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8');
    return JSON.parse(raw).projects?.default;
  } catch {
    return undefined;
  }
})();
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc;

async function main() {
  const apply = process.argv.includes('--apply');
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (!projectId) {
    console.error('No default project in .firebaserc - point this at the station to seed.');
    process.exit(1);
  }
  console.log(`Reading ${emulator ? 'the emulator' : `project ${projectId}`}${apply ? '' : ' (report only)'}`);

  let trainings;
  let signatures;
  let db;
  try {
    const app = emulator
      ? initializeApp({ projectId: projectId || 'demo-station-portal' })
      : initializeApp({ credential: applicationDefault(), projectId });
    db = getFirestore(app);
    [trainings, signatures] = await Promise.all([
      db.collection('trainings').get(),
      db.collection('training_signatures').get(),
    ]);
  } catch (error) {
    console.error(
      [
        `Could not read the training collections from ${emulator ? 'the emulator' : `project ${projectId}`}:`,
        `  ${(error && error.message) || error}`,
        '',
        'Against a real project the Admin SDK needs application default credentials - the one thing it cannot invent:',
        `  a Google login:      gcloud auth application-default login && gcloud config set project ${projectId}`,
        '  or a service key:    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json',
        '    (Firebase console -> Project settings -> Service accounts -> Generate new private key.',
        '     Delete the key when you are done - it is a long-lived credential.)',
        '',
        'YOU MAY NOT NEED THIS SCRIPT AT ALL. It only seeds trainings that were signed BEFORE the counter trigger existed.',
        'A training with no signature correctly reads 0, and the trigger keeps the count from the first signature on. So if',
        'the station has no `training_signatures` yet (check the collection in the Firebase console), skip this - there is',
        'nothing to seed.',
        '',
        'Against the emulator, run it inside one:',
        '  firebase emulators:exec --only firestore "npm run training-counts:normalize"',
        '',
        'NOTHING WAS WRITTEN.',
      ].join('\n')
    );
    process.exit(1);
  }

  const trainingRows = trainings.docs.map((d) => ({ id: d.id, ...d.data() }));
  const signatureRows = signatures.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`\ntrainings:  ${trainingRows.length}`);
  console.log(`signatures: ${signatureRows.length}`);

  const plan = signatureCountPlan(signatureRows, trainingRows);
  console.log(`\ntrainings whose count would change: ${plan.change.length}`);
  plan.change.slice(0, 25).forEach((id) => console.log(`  ${id}  ->  ${plan.plan[id]}`));
  if (plan.change.length > 25) console.log(`  ...and ${plan.change.length - 25} more`);
  if (plan.orphaned.length) {
    console.log(
      `\nsignatures pointing at a training that no longer exists: ${plan.orphaned.length} (${plan.orphaned
        .slice(0, 10)
        .join(', ')})`
    );
  }

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply to seed the counts.');
    return;
  }

  let written = 0;
  for (let start = 0; start < plan.change.length; start += 500) {
    const batch = db.batch();
    plan.change.slice(start, start + 500).forEach((id) => {
      batch.set(db.collection('trainings').doc(id), { signature_count: plan.plan[id] }, { merge: true });
    });
    await batch.commit();
    written += Math.min(500, plan.change.length - start);
  }
  console.log(`\nWrote signature_count on ${written} training(s).`);
  console.log('Reopen the app and each training shows the signatures it already holds.');
}

// RUN ONLY WHEN INVOKED DIRECTLY. A harness imports `signatureCountPlan` from this file to test the plan, and an unguarded
// `main()` would fire a live Firestore read (and an exit code) the moment it did.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('normalize-training-signature-counts.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
