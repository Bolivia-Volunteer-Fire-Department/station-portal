// A live end-to-end run against the seeded emulator, so the loop around the decisions is exercised and not just the
// decisions. Written as a script rather than run inline because it needs the emulator's environment variable set before
// anything imports firebase-admin.
//
// It seeds the demo station, BREAKS doc2 the way the old save did - a minimum rank with a list holding one rank - runs
// the repair with --apply, and then asserts three things: doc2 was widened, nothing else about doc2 moved, and a second
// run finds nothing to do.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { spawnSync } from 'node:child_process';
import { seed } from './seed-emulator.mjs';

let failures = 0;
// `checkIs` is the boolean form, for a claim whose value is not worth pinning exactly. Two cases here were first written
// with `check` against an `includes(...)` result, so the comparison asked whether `true` equalled `true` - an inverted
// assertion that reported a passing claim as a failure. Having both helpers, as every other harness in this repo does, is
// what made the mistake visible rather than leaving it to be "fixed" by loosening the assertion.
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

// Reports the DOCUMENT changes only, not the whole script's stdout. The script also prints a heading, a rank/document
// count and a closing hint, and asserting on the entire output would make this harness go red every time somebody improves
// a word of that prose - which is the wrong reason for a repair script to fail.
const docLines = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\S+: \[/.test(line));

// "N holding an audience narrower...", extracted from the line itself rather than matched loosely, because
// `includes('1 holding')` also matches inside `11 holding`.
const pendingCount = (output) => {
  const found = /(\d+) holding an audience narrower/.exec(output);
  return found ? Number(found[1]) : -1;
};

const checklistPendingCount = (output) => {
  const found = /(\d+) checklist item\(s\) need the parent audience copied/.exec(output);
  return found ? Number(found[1]) : -1;
};

const main = async () => {
  await seed();
  const db = getFirestore(initializeApp({ projectId: 'demo-station-portal' }));

  // doc2 as the OLD save wrote it: minimum rank k1 (order 3), audience the single rank. With k1 at the top of the two-rank
  // ladder that expands to `['rank:k1']`, so this row is already correct and the script must leave it - which is exactly
  // the "most of a real station" case. doc6 is given a minimum BELOW the top of the ladder so there is also something to
  // genuinely repair, because a run that only finds correct rows proves nothing about the writing path.
  await db.doc('documents/doc2').update({ rank_id: 'k1', audience_keys: ['rank:k1'] });
  await db.doc('documents/doc6').update({ rank_id: 'k2', audience_keys: ['rank:k1'] });
  await db.doc('document_checklist_items/it1').update({ audience_keys: ['rank:k1'] });

  const runRepair = (args) =>
    spawnSync(process.execPath, ['scripts/normalize-document-audience.mjs', ...args], { encoding: 'utf8' });

  console.log('\n--- a report-only run writes nothing ---');
  const reported = runRepair([]);
  check('it found exactly the one broken document', pendingCount(reported.stdout), 1);
    check('and the one checklist item with stale audience', checklistPendingCount(reported.stdout), 1);
  check(
    'and named it, with the list it would write',
    docLines(reported.stdout),
    ['doc6: ["rank:k1"] -> ["rank:k1","rank:k2"]']
  );
  checkIs('and wrote nothing', reported.stdout.includes('Nothing was written'), 'the report did not say so');
  const untouched = (await db.doc('documents/doc6').get()).data();
  check('leaving the stored list exactly as it was', untouched.audience_keys, ['rank:k1']);
  check('report-only leaves the checklist item untouched', (await db.doc('document_checklist_items/it1').get()).get('audience_keys'), ['rank:k1']);

  console.log('\n--- the repair, with --apply ---');
  const applied = runRepair(['--apply']);
  check('it found the same one document to change', pendingCount(applied.stdout), 1);
    check('and repairs the checklist audience in the same run', checklistPendingCount(applied.stdout), 1);
  checkIs('and says what it rewrote', applied.stdout.includes('Rewrote 1 document audience'), applied.stdout.trim());
  const repaired = (await db.doc('documents/doc6').get()).data();
  check('the broken document now holds every rank at or above its minimum', repaired.audience_keys.sort(), ['rank:k1', 'rank:k2']);
  // ONLY THE AUDIENCE, and this is the assertion that matters most for a script pointed at production: a repair that
  // wrote the whole row back would revert any edit made since the read.
  check(
    'and nothing else on that document moved',
    [repaired.title, repaired.content_revision, repaired.is_published],
    ['New Policy Acknowledgement', 1, true]
  );
  const alone = (await db.doc('documents/doc2').get()).data();
  check('while a document already holding the right list is untouched', alone.audience_keys, ['rank:k1']);
  check('the checklist item now inherits its parent audience', (await db.doc('document_checklist_items/it1').get()).get('audience_keys'), ['*']);

  console.log('\n--- a second run finds nothing to do ---');
  const again = runRepair([]);
  check('nothing left to repair', pendingCount(again.stdout), 0);
  check('and no checklist audiences need repair', checklistPendingCount(again.stdout), 0);
  check('and names no document', docLines(again.stdout), []);

  // Restore the seed's own shape, so a run that leaves the emulator dirty cannot affect a later case in this file.
  await db.doc('documents/doc6').update({ rank_id: '', audience_keys: ['*'] });

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});