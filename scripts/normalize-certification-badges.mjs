// The `certification_badges` index, rebuilt from the `certifications` records it is derived from.
//
//   npm run badges:normalize             (report only - the default)
//   npm run badges:normalize -- --apply  (write)
//
// WHY THIS EXISTS, because it is the fourth time the badges have gone missing and every earlier fix was about the wrong
// thing. Those were all faults in the PATH to the index - the read was not routed, the registry was not reactive, a pill
// rendered a bare string. The index itself is a DERIVED CACHE, and that is what is missing here: a member's icons beside
// their name are read from `certification_badges`, one small document per member, while the truth lives in
// `certifications`. Nothing ever built that index for a station that migrated its records without it, so every screen that
// draws a name drew a bare one - with no error anywhere, because "this member's icon is not in a cache that was never
// populated" and "this member holds nothing" are the same empty answer to a reader.
//
// WHO BUILT IT BEFORE, AND WHY THAT WAS NOT ENOUGH. `refreshCertificationBadges` in services/firestoreWrites.js rebuilds
// the whole index, and it runs as a side effect of saving a certification or a certification TYPE. So the only way to have
// this index has always been to edit something - and it lived in a browser module importing the Firebase SDK, which no
// script can reach. The rule now lives in src/utils/certificationBadges.js and BOTH callers use it, which is what makes this
// script possible; the drift this avoids is a rebuild that draws different badges from the ones on screen.
//
// THE DESTRUCTIVE PART, STATED PLAINLY BECAUSE IT IS THE TRAP. That rebuild deletes every badge document whose member is
// not in the index it just computed. So a rebuild run by a caller that cannot SEE the records - a narrower role, a read
// refused, a `certifications` collection that was never migrated - produces an empty index and DELETES EVERY BADGE. The
// badges are not corrupted, they are removed, and they return the moment a rebuild can see the records. That is why this
// script REFUSES TO WRITE when it cannot see the records it is supposed to be derived from, and why it reports by default:
// an operator should see what a rebuild would do before it does it.
//
// SAFE TO RUN TWICE, which is what makes it usable as a check as well as a fix: the index is recomputed from the records
// every time, so a second run over an already-correct station writes nothing and reports nothing to do.
//
// THE ADMIN SDK IS IMPORTED INSIDE main(), NOT HERE: it lives in functions/node_modules, so a static import would make this
// module unloadable from anywhere else - the same reason scripts/normalize-runner-scores.mjs does it, and the same reason
// `badgeIndexFor` is exported from a pure util that a harness can test directly.
import { readFileSync } from 'node:fs';

import { badgeIndexFor, badgeToday } from '../src/utils/certificationBadges.js';

// The project this checkout deploys to, from .firebaserc - the same file `firebase deploy` reads, so there is one place
// that says which project this is and no environment variable to remember.
//
// BUT THE ENVIRONMENT WINS, and that precedence is not tidiness. `firebase emulators:exec --project demo-station-portal`
// sets GCLOUD_PROJECT, and the emulator keys its documents by project: a script that read .firebaserc while running inside
// an emulator for a different project reads an EMPTY database and cheerfully reports "0 records" - a wrong answer with no
// error, which for a repair script is the worst kind. Same resolution as scripts/normalize-runner-scores.mjs.
const projectFromFirebaserc = (() => {
  try {
    const raw = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8');
    return JSON.parse(raw).projects?.default;
  } catch {
    return undefined;
  }
})();
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || projectFromFirebaserc;

// What a rebuild WOULD write, as three lists a reader can check before agreeing to it: the members who would gain badges,
// the members whose stored badges are wrong, and the stored badges that would be removed. Pure, and therefore testable
// without a database - which is the only way to test a decision that deletes data.
//
// `stored` is what `certification_badges` holds today (id -> badges), and it is compared on CONTENT rather than on
// identity, because a rebuild rewrites every document it touches: a second run must be able to see that nothing needs
// doing, and reference equality would report a change on every member forever.
export const badgeRebuildPlan = ({ records = [], types = [], stored = {}, today = '' } = {}) => {
  const index = badgeIndexFor(records, types, today);
  const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

  const gain = [];
  const change = [];
  const remove = [];

  Object.keys(index).forEach((userId) => {
    if (!(userId in stored)) gain.push(userId);
    else if (!same(stored[userId], index[userId])) change.push(userId);
  });
  Object.keys(stored).forEach((userId) => {
    // Only a document that actually claims something is a removal worth reporting. An empty one is shown by no screen, so
    // reporting it would be noise in a report an operator has to read.
    if (!(userId in index) && (stored[userId] || []).length) remove.push(userId);
  });

  return { index, gain, change, remove, unchanged: gain.length + change.length + remove.length === 0 };
};

// THE ONE THING THIS SCRIPT REFUSES TO DO: rebuild from records it could not judge.
//
// A rebuild with no usable types produces an empty index, and `refreshCertificationBadges` would then delete every badge
// document. A station holding records but no readable types is far more likely to be a permissions or wiring problem than a
// station that has genuinely recorded nothing, so the case is named and the run stops rather than emptying the collection.
export const refuseOnInvisibleRecords = (records, types) => {
  if (types.length) return '';
  if (!records.length) return '';
  return 'certification records are present but the certification TYPES could not be read, so no record can be judged';
};

async function main() {
  const apply = process.argv.includes('--apply');
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (!projectId) {
    console.error('No default project in .firebaserc - point this at the station to repair.');
    process.exit(1);
  }
  console.log(`Reading ${emulator ? 'the emulator' : `project ${projectId}`}${apply ? '' : ' (report only)'}`);

  // The read is guarded rather than allowed to throw, because the failure here is a CREDENTIAL problem and the SDK's own
  // message talks about a service account object - which is not what an operator is looking at. This is the same wording the
  // sibling normalizers use, for the same reason.
  let records;
  let types;
  let storedRows;
  let db;
  try {
    const app = emulator
      ? initializeApp({ projectId: projectId || 'demo-station-portal' })
      : initializeApp({ credential: applicationDefault(), projectId });
    db = getFirestore(app);
    [records, types, storedRows] = await Promise.all([
      db.collection('certifications').get(),
      db.collection('certification_setup').get(),
      db.collection('certification_badges').get(),
    ]);
  } catch (error) {
    console.error(
      [
        `Could not read the certification collections from ${emulator ? 'the emulator' : `project ${projectId}`}:`,
        `  ${(error && error.message) || error}`,
        '',
        'Against a real project this needs application default credentials - the one thing the Admin SDK cannot invent:',
        `  gcloud auth application-default login && gcloud config set project ${projectId}`,
        'Against the emulator, run it inside one:',
        '  firebase emulators:exec --only firestore "npm run badges:normalize"',
        '',
        'NOTHING WAS WRITTEN. And nothing has to be: an officer who can manage certifications can rebuild the same index by',
        'saving any one certification record - that save rebuilds it for the whole station.',
      ].join('\n')
    );
    process.exit(1);
  }

  const recordsList = records.docs.map((d) => ({ id: d.id, ...d.data() }));
  const typesList = types.docs.map((d) => ({ id: d.id, ...d.data() }));
  const stored = Object.fromEntries(storedRows.docs.map((d) => [String(d.id), d.data().badges || []]));

  const today = badgeToday();
  console.log(`\nToday (station time):  ${today}`);
  console.log(`certification records: ${recordsList.length}`);
  console.log(`certification types:   ${typesList.length}`);
  console.log(`badge documents today: ${storedRows.size}`);

  const refusal = refuseOnInvisibleRecords(recordsList, typesList);
  if (refusal) {
    console.error(`\nRefusing to rebuild: ${refusal}.`);
    console.error('Nothing has been written. Fix the read, then run this again.');
    process.exit(1);
  }

  const plan = badgeRebuildPlan({ records: recordsList, types: typesList, stored, today });
  console.log(`\nmembers who would gain badges:    ${plan.gain.length}`);
  console.log(`members whose badges would change: ${plan.change.length}`);
  console.log(`stored badges that would be removed: ${plan.remove.length}`);

  const show = (label, ids) => {
    if (!ids.length) return;
    console.log(`\n${label}`);
    ids.slice(0, 25).forEach((id) => {
      const names = (plan.index[id] || []).map((b) => b.name).join(', ') || '(no badge now)';
      console.log(`  ${id}  ${names}`);
    });
    if (ids.length > 25) console.log(`  ...and ${ids.length - 25} more`);
  };
  show('Would gain:', plan.gain);
  show('Would change:', plan.change);
  show('Would be removed:', plan.remove);

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply to rebuild the index.');
    return;
  }

  // The same shape as the app's own rebuild: write what the rule says, remove what it no longer says.
  const batch = db.batch();
  Object.entries(plan.index).forEach(([userId, badges]) => {
    batch.set(db.collection('certification_badges').doc(userId), { user_id: userId, badges }, { merge: true });
  });
  Object.keys(stored).forEach((userId) => {
    if (!(userId in plan.index)) batch.delete(db.collection('certification_badges').doc(userId));
  });
  await batch.commit();

  console.log(`\nWrote ${Object.keys(plan.index).length} badge document(s).`);
  console.log('Reopen the app (or re-read the roster) and the icons are back beside the names.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});