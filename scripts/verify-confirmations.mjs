/**
 * Verifies that nothing in the app asks a question with a native dialog.
 *
 * What this exists for: every destructive action - deleting a user, an event, a training, a timeclock entry, a role
 * - used to ask with `window.confirm`. A browser-owned dialog cannot be styled (it looks nothing like the app),
 * cannot be heard (the sound layer never sees it open), blocks the main thread, and in some browsers is suppressed
 * entirely - so a delete would either happen with no prompt at all or not happen, depending on a setting the app
 * cannot read or report. It also cannot say more than two strings, so the confirmations that needed to name what
 * would be lost (a training's signatures) had to fit that into one sentence.
 *
 * All thirteen now ask in ConfirmModal. Three things are checked here:
 *
 *   1. The rule: no native dialog call anywhere in src, comments excluded.
 *   2. The wiring: every file that had one asks in the dialog instead, holding the row while it asks.
 *   3. The dialog's own contract: what it announces, how it can be dismissed, and what it sounds like. This part is
 *      inverted on purpose from the forced modals: a confirmation is the member's own action being confirmed, so it
 *      MUST be dismissible, where ReauthModal and ClockBlockedModal must not be (verify:clock-notice covers that
 *      side, including that ClockBlockedModal has exactly one dismiss control).
 *
 * What this cannot check: there is no DOM harness in this project, so the dismissal paths are read from the source
 * rather than exercised by pressing Escape. The rendering is real (`verify:admin-render` renders the dialog); the
 * interaction is a code reading, and that is stated rather than implied.
 *
 * Run with: npm run verify:confirmations
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MODAL_SOUNDS } from '../src/utils/soundRules.js';

let failures = 0;
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

// --- the rules, as functions of source text --------------------------------------------------
//
// Every rule below is a function rather than an inline test so the mutation section at the end can re-run it
// against a deliberately broken copy. A check that passes because it is looking at the wrong thing looks exactly
// like a check that passes because the code is right, and only a mutation tells them apart.
//
// The leading character class is what keeps this honest: it rejects a `confirm(` that is part of a longer
// identifier, so `onConfirm={confirmDelete}` and `confirmLabel="Delete"` - which are everywhere now - are not
// mistaken for the native dialog they replaced.
const NATIVE_DIALOG = /(^|[^\w.$])(?:window\s*\.\s*)?(alert|confirm|prompt)\s*\(/;
const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

const nativeDialogCalls = (source) =>
  source
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => !isCommentLine(text) && NATIVE_DIALOG.test(text));

const importsDialog = (source) => /import ConfirmModal from '\.\.\/ConfirmModal';/.test(source);
const rendersDialog = (source) => /<ConfirmModal/.test(source);
// A call with something in it: `setPendingDelete(null)` is the CANCEL path, so a check that accepted any call -
// or any argument starting with a letter, which `null` does - would pass on a tab that only ever cancels.
const holdsTheRow = (source) => /setPendingDelete\((?!null\))[^)]/.test(source);

// Which top-level declaration a line belongs to. This exists because a dialog rendered from a DIFFERENT component
// than the one holding the row is a runtime ReferenceError, not a style problem - and it happened in this change:
// the system settings tab keeps seven cards in one file, and the dialog went to the end of the file, in the parent.
// With the names lines up it even compiles; only rendering it fails. The render harness caught it, but only because
// it happens to render that card, so this check exists to catch it whether or not anything renders the file.
const DECLARATION = /^(?:export default function|export function|function)\s+(\w+)|^const\s+(\w+)\s*=\s*\(/;
const enclosingDeclaration = (source, lineNumber) => {
  let owner = null;
  source
    .split('\n')
    .slice(0, Math.max(lineNumber - 1, 0))
    .forEach((line) => {
      const match = DECLARATION.exec(line);
      if (match) owner = match[1] || match[2];
    });
  return owner;
};
const lineOf = (source, pattern) => source.split('\n').findIndex((line) => pattern.test(line)) + 1;

// --- 1. nothing native, anywhere in src -------------------------------------------------------

const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk('src');

// A walk that found nothing would make every check below pass while testing the strings in this file. (verify:help
// learned the same lesson about a glob that matched nothing.)
checkIs('the scan covered the source tree', sourceFiles.length > 100, `only ${sourceFiles.length} files`);

const violations = sourceFiles.flatMap((file) =>
  nativeDialogCalls(readFileSync(file, 'utf8')).map(({ line, text }) => `${file}:${line} ${text}`)
);
check('native dialog calls in src', violations, []);
// --- 2. the wiring: every confirmation that was native now asks in the dialog -----------------
//
// This list IS the audit - every native confirmation that was removed, one entry per file. A new destructive action
// belongs here when it is written: the rule above stops it being native, and this stops it from silently not saying
// which row it is about to destroy.
const ASK_IN_APP = [
  { file: 'src/components/admin/AdminAnnouncementsTab.jsx', subject: 'announcement' },
  { file: 'src/components/admin/AdminUsersTab.jsx', subject: 'user' },
  { file: 'src/components/admin/AdminRolesTab.jsx', subject: 'role' },
  { file: 'src/components/admin/AdminAssignmentsTab.jsx', subject: 'assignment' },
  { file: 'src/components/admin/AdminScheduleTemplatesTab.jsx', subject: 'template' },
  { file: 'src/components/admin/AdminEventsTab.jsx', subject: 'event' },
  { file: 'src/components/admin/AdminClockManagementTab.jsx', subject: 'timeclock entry' },
  { file: 'src/components/admin/AdminShiftsTab.jsx', subject: 'shift' },
  { file: 'src/components/admin/AdminSystemSettingsTab.jsx', subject: 'setting' },
  { file: 'src/components/admin/AdminRanksTab.jsx', subject: 'rank' },
  // Three at once - locking a training, deleting one, and removing a signature - so it holds a discriminated action
  // rather than a row. Its own shape is checked below.
  { file: 'src/components/admin/AdminTrainingTab.jsx', subject: 'training action', kinds: true },
];

for (const { file, kinds } of ASK_IN_APP) {
  const name = path.basename(file);
  const source = readFileSync(file, 'utf8');
  checkIs(`${name} imports the dialog`, importsDialog(source));
  checkIs(`${name} renders it`, rendersDialog(source));
  checkIs(`${name} hands it a title`, /title=/.test(source));
  checkIs(`${name} and a message`, /message=/.test(source));
  if (kinds) {
    // One dialog for three actions: the pending value says which.
    checkIs(`${name} holds which action is pending`, /setPending\(\{ kind: '/.test(source));
    checkIs(`${name} and dispatches on confirm`, /void saveTraining\(action\.values\)/.test(source));
    checkIs(`${name} cancelling clears it`, /onCancel=\{\(\) => setPending\(null\)\}/.test(source));
  } else {
    // The row the button was clicked on is held in state, and the work runs from the dialog's callback - so nothing
    // is written before the answer.
    checkIs(`${name} holds the row while it asks`, holdsTheRow(source));
    checkIs(`${name} cancelling clears it`, /onCancel=\{\(\) => setPendingDelete\(null\)\}/.test(source));
  }
  // The dialog has to be rendered from the component that holds the row. The two are on opposite sides of the file
  // in every one of these tabs, so nothing else in this file would notice them drifting apart.
  const handlerPattern = kinds ? /setPending\(\{ kind: '/ : /setPendingDelete\([a-z]/;
  checkIs(
    `${name} renders it from the component that holds the row`,
    enclosingDeclaration(source, lineOf(source, handlerPattern)) ===
      enclosingDeclaration(source, lineOf(source, /<ConfirmModal/)),
    `held in ${enclosingDeclaration(source, lineOf(source, handlerPattern))}, rendered in ${enclosingDeclaration(
      source,
      lineOf(source, /<ConfirmModal/)
    )}`
  );
}
// --- 3. the dialog's own contract -------------------------------------------------------------
//
// Source-level, not behavioural: there is no jsdom in this project, so "Escape cancels it" is asserted as the
// handler that does so being present and reached from a document-level listener - not by pressing Escape.
const modalSource = readFileSync('src/components/ConfirmModal.jsx', 'utf8');

const announcesItself = (s) => /role="alertdialog"/.test(s) && /aria-modal="true"/.test(s);
const namesItself = (s) =>
  /aria-labelledby=\{titleId\}/.test(s) && /aria-describedby=\{message \? messageId : undefined\}/.test(s);
const escapesOnEscape = (s) =>
  /event\.key === 'Escape'[\s\S]{0,160}?onCancel\?\.\(\)/.test(s) &&
  /document\.addEventListener\('keydown', onKeyDown, true\)/.test(s);
const cancelsOutside = (s) => /onClick=\{onCancel\} aria-hidden="true"/.test(s);
const focusesTheSafeAnswer = (s) =>
  /cancelRef\.current\?\.focus\(\)/.test(s) && /ref=\{cancelRef\}[\s\S]{0,240}?onClick=\{onCancel\}/.test(s);
const dangerByDefault = (s) =>
  /tone = 'danger'/.test(s) && /const danger = tone !== 'default';/.test(s) && /bg-red-600 hover:bg-red-500/.test(s);
const soundsOnceOnOpen = (s) => /playSound\(modalSoundFor\('confirm'\)\);\n  \}, \[\]\)/.test(s);
const labelsComeFromProps = (s) =>
  /confirmLabel = 'Confirm'/.test(s) &&
  /cancelLabel = 'Cancel'/.test(s) &&
  /\{confirmLabel\}/.test(s) &&
  /\{cancelLabel\}/.test(s);

checkIs('it is announced as an alert dialog', announcesItself(modalSource));
checkIs('with a name and a description for a screen reader', namesItself(modalSource));
checkIs('Escape cancels it', escapesOnEscape(modalSource));
checkIs('so does a click outside', cancelsOutside(modalSource));
checkIs('and the safe answer takes the focus', focusesTheSafeAnswer(modalSource));
checkIs('destructive by default', dangerByDefault(modalSource));
checkIs('with both labels overridable', labelsComeFromProps(modalSource));
checkIs('it plays its tone once, when it opens', soundsOnceOnOpen(modalSource));
check('its tone in the table', MODAL_SOUNDS.confirm, 'positive');
checkIs(
  'and the table holds only the two tones',
  Object.values(MODAL_SOUNDS).every((tone) => tone === 'positive' || tone === 'error')
);
// --- 4. the checks themselves -----------------------------------------------------------------
//
// Each rule above, re-run against a copy broken in exactly the way it is supposed to catch. Without this, a rule
// written against the wrong string passes forever and reads as coverage.
//
// `passes` is the condition the check above requires - true for the real source, and the mutation must make it
// false. Written this way around because that is the direction the checks run: they fail when a good thing is
// missing, not when a bad thing is present.
console.log('\n--- the checks themselves ---');

const userTab = readFileSync('src/components/admin/AdminUsersTab.jsx', 'utf8');

const MUTATIONS = [
  {
    label: 'a reintroduced native confirm',
    source: userTab,
    passes: (s) => nativeDialogCalls(s).length === 0,
    breakIt: (s) =>
      s.replace(
        'const handleDelete = (user) => setPendingDelete(user);',
        "const handleDelete = (user) => { if (!window.confirm('Delete?')) return; setPendingDelete(user); };"
      ),
  },
  {
    label: 'a tab that forgets the dialog',
    source: userTab,
    passes: rendersDialog,
    breakIt: (s) => s.replace('<ConfirmModal', '<SomethingElse'),
  },
  {
    label: 'a row dropped instead of held',
    source: userTab,
    passes: holdsTheRow,
    breakIt: (s) => s.replace('setPendingDelete(user);', 'setPendingDelete(null);'),
  },
  {
    label: 'a dialog that traps Escape',
    source: modalSource,
    passes: escapesOnEscape,
    breakIt: (s) => s.replace('        onCancel?.();\n', ''),
  },
  {
    label: 'a dialog that is not announced',
    source: modalSource,
    passes: announcesItself,
    breakIt: (s) => s.replace('role="alertdialog"', 'role="dialog"'),
  },
  {
    label: 'a click outside that does nothing',
    source: modalSource,
    passes: cancelsOutside,
    breakIt: (s) => s.replace('onClick={onCancel} aria-hidden="true"', 'aria-hidden="true"'),
  },
  {
    label: 'focus on the destructive button',
    source: modalSource,
    passes: focusesTheSafeAnswer,
    breakIt: (s) => s.replace('ref={cancelRef}\n', ''),
  },
  {
    label: 'a confirm button that is not red',
    source: modalSource,
    passes: dangerByDefault,
    breakIt: (s) => s.replace("tone = 'danger'", "tone = 'default'"),
  },
  {
    label: 'the wrong tone played',
    source: modalSource,
    passes: soundsOnceOnOpen,
    breakIt: (s) => s.replace("modalSoundFor('confirm')", "modalSoundFor('reauth')"),
  },
];

for (const { label, source, passes, breakIt } of MUTATIONS) {
  const broken = breakIt(source);
  checkIs(`${label}: the real source passes`, passes(source));
  checkIs(`${label}: the mutation is caught`, broken !== source && !passes(broken));
}

// The scope rule, proved on two small sources rather than by mutating a 950-line file: one where the dialog is in
// the component that holds the row, and one where it is in the component after it - which is exactly the shape of
// the bug this rule was written for.
const SAME_SCOPE = [
  'function Card() {',
  '  const [pendingDelete, setPendingDelete] = useState(null);',
  '  const handleDelete = (row) => setPendingDelete(row);',
  '  return <div>{pendingDelete && <ConfirmModal />}</div>;',
  '}',
].join('\n');
const WRONG_SCOPE = [
  'function Card() {',
  '  const [pendingDelete, setPendingDelete] = useState(null);',
  '  const handleDelete = (row) => setPendingDelete(row);',
  '  return <div />;',
  '}',
  'function Parent() {',
  '  return <div>{pendingDelete && <ConfirmModal />}</div>;',
  '}',
].join('\n');
const sameScope = (s) =>
  enclosingDeclaration(s, lineOf(s, /setPendingDelete\([a-z]/)) === enclosingDeclaration(s, lineOf(s, /<ConfirmModal/));

// Both are conditions, not values to compare: this file's `check` compares JSON, and `checkIs` takes a boolean and
// a diagnostic. Mixing them up is easy and silent - the wrong one fails on a correct source, or passes always.
checkIs('a dialog in the component that holds the row', sameScope(SAME_SCOPE));
checkIs('and a dialog one component away is caught', !sameScope(WRONG_SCOPE));
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);



