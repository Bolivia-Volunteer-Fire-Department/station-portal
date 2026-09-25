// Verifies the Loading Messages card on Administration → System Settings (utils/systemSettings).
//
// The bug that prompted this file could not be seen by rendering the card: the inputs were focused, the
// keystrokes arrived, and every render put the stored value back. The cause was identity - the onChange
// compared `map`'s index (a number) against the tail of the row's id (a string), so no row was ever replaced.
//
// So the editing is asserted as list arithmetic rather than as markup: what a member types has to end up on
// the row they typed it on, and on the KEY that row saves to. The markup checks are here for the parts that
// only rendering can prove - ten fields exist before anything is stored, and a stored message is shown in its
// field.
//
// Run with: npm run verify:loading-messages
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import {
  LOADING_MESSAGE_COUNT,
  LOADING_MESSAGE_KEYS,
  getLoadingMessages,
  getSettingValue,
  loadingMessageSavePlan,
  updateLoadingMessages,
} from '../src/utils/systemSettings.js';
import AdminSystemSettingsTab from '../src/components/admin/AdminSystemSettingsTab.jsx';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const values = (rows) => rows.map((row) => row.value);
const plan = (rows) => loadingMessageSavePlan(rows).map((row) => `${row.key}=${row.value}`);

// ---------------------------------------------------------------------------
// The fixed ten
// ---------------------------------------------------------------------------
console.log('--- the ten messages ---');
check('there are ten of them', LOADING_MESSAGE_COUNT, 10);
check('named loading_message0 to loading_message9', LOADING_MESSAGE_KEYS[0], 'loading_message0');
check('and the last one is 9', LOADING_MESSAGE_KEYS.at(-1), 'loading_message9');
check('the list is the count', LOADING_MESSAGE_KEYS.length, 10);

console.log('--- the rows the card edits ---');
const stored = [
  { key: 'loading_message9', value: 'Ninth' },
  { key: 'loading_message0', value: 'First' },
];
const rows = getLoadingMessages(stored);
check('always ten rows, whatever the sheet holds', rows.length, 10);
// The sheet may return the settings in any order; the form must not.
check('in key order', rows.map((row) => row.key), LOADING_MESSAGE_KEYS);
check('and numbered to match', rows.map((row) => row.label).slice(0, 2), ['Message 0', 'Message 1']);
check('the last is Message 9', rows.at(-1).label, 'Message 9');
check('the stored ones are read', values(rows).slice(0, 1), ['First']);
check('including one from further down the sheet', rows.at(-1).value, 'Ninth');
check('and the unstored ones are blank', values(rows).slice(1, 9), ['', '', '', '', '', '', '', '']);
// The key IS the id, which is what removes the need to parse one out of the other.
check('each row is identified by its key', rows.every((row) => row.id === row.key), true);
check('and the ids are unique', new Set(rows.map((row) => row.id)).size, 10);
check('every row also carries its index', rows.map((row) => row.index).slice(0, 3), [0, 1, 2]);

console.log('--- nothing to read yet, or nothing to read at all ---');
check('an empty sheet is ten blank rows', values(getLoadingMessages([])), Array(10).fill(''));
check('undefined is not a crash', values(getLoadingMessages(undefined)), Array(10).fill(''));
check('nor is a non-list', values(getLoadingMessages('nope')), Array(10).fill(''));
check('a stored null reads as blank, not "null"', getLoadingMessages([{ key: 'loading_message0', value: null }])[0].value, '');
check(
  'a key with a stray space in the sheet still resolves',
  getLoadingMessages([{ key: ' loading_message2 ', value: 'Spaced' }])[2].value,
  'Spaced'
);
check('the value itself is not trimmed', getLoadingMessages([{ key: 'loading_message2', value: '  keep me  ' }])[2].value, '  keep me  ');
check('a row with no key is ignored, not matched', getLoadingMessages([{ value: 'Orphan' }])[0].value, '');
check('getSettingValue falls back when the key is absent', getSettingValue([{ key: 'a', value: 'x' }], 'b', 'fallback'), 'fallback');

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------
console.log('--- typing into a field ---');
const typed = updateLoadingMessages(rows, 'loading_message3', 'Typed here');
check('the field that was typed into shows it', typed[3].value, 'Typed here');
check('and nothing else moved', values(typed).filter((_, index) => index !== 3), values(rows).filter((_, index) => index !== 3));
check('the untouched rows are the very same objects', typed[5] === rows[5], true);
check('a new list is returned, not the old one', typed === rows, false);
// The bug in one line: the old code replaced a row only when `index === idTail`, which is a number against a
// string and so never true. Matching on the id is what makes the keystroke stick.
check('the original input was not mutated', rows[3].value, '');
check('the first field can be edited', updateLoadingMessages(rows, 'loading_message0', 'A')[0].value, 'A');
check('and the tenth', updateLoadingMessages(rows, 'loading_message9', 'J').at(-1).value, 'J');
check('clearing a field is an edit too', updateLoadingMessages(rows, 'loading_message0', '')[0].value, '');
check('an unmatched id changes nothing', values(updateLoadingMessages(rows, 'message_3', 'Nope')), values(rows));
check('and still returns a new list', updateLoadingMessages(rows, 'message_3', 'Nope') === rows, false);
// Position must never decide: a list whose order does not match its ids must still edit the right row.
const reversed = [...rows].reverse();
const reversedEdit = updateLoadingMessages(reversed, 'loading_message0', 'First only');
check('editing by id, not by position', reversedEdit.map((row) => row.value).filter((value) => value === 'First only').length, 1);
check('and it lands on the row with that id', reversedEdit.find((row) => row.id === 'loading_message0').value, 'First only');
check('a missing list is not a crash', updateLoadingMessages(undefined, 'loading_message0', 'x').length, 0);
const twice = updateLoadingMessages(updateLoadingMessages(rows, 'loading_message2', 'B'), 'loading_message2', 'BC');
check('fast typing keeps the later text, not the earlier', twice[2].value, 'BC');
check('undefined text is read as blank, not "undefined"', updateLoadingMessages(rows, 'loading_message1', undefined)[1].value, '');

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------
console.log('--- what a save writes ---');
const edited = updateLoadingMessages(updateLoadingMessages(rows, 'loading_message3', 'Typed here'), 'loading_message0', 'First');
check('every key is written', loadingMessageSavePlan(edited).length, 10);
check('in key order', loadingMessageSavePlan(edited).map((row) => row.key), LOADING_MESSAGE_KEYS);
check('the typed text goes to the key that was typed on', plan(edited)[3], 'loading_message3=Typed here');
check('and the other edit to its own', plan(edited)[0], 'loading_message0=First');
// Blank keys are written too: skipping them would leave the previous text in the sheet for ever, because
// this screen is the only place that can clear it.
check('blanks are written, not skipped', plan(edited)[5], 'loading_message5=');
check('a blank field in the middle does not shift the rest', plan(edited).slice(4), [
  'loading_message4=',
  'loading_message5=',
  'loading_message6=',
  'loading_message7=',
  'loading_message8=',
  'loading_message9=Ninth',
]);
check('each pair names itself for the error message', loadingMessageSavePlan(edited)[3].label, 'Message 3');
check('nothing to save is an empty plan, not a crash', loadingMessageSavePlan(undefined), []);
// The end-to-end shape of the original bug: type, then save, then read the plan.
const afterTyping = updateLoadingMessages(getLoadingMessages([]), 'loading_message7', 'Almost there');
check('typing on a blank screen saves that text', plan(afterTyping)[7], 'loading_message7=Almost there');

// ---------------------------------------------------------------------------
// Rendered
// ---------------------------------------------------------------------------
console.log('--- rendered: the card ---');
const card = (settings) => {
  try {
    return renderToString(
      React.createElement(AdminSystemSettingsTab, {
        token: 'test-token',
        systemSettings: settings,
        onDataChanged: () => {},
      })
    );
  } catch (error) {
    return { error };
  }
};

const blankCard = card([{ key: 'loading_message0', value: 'Welcome aboard' }]);
check(
  `the card renders${typeof blankCard === 'string' ? '' : ` (${blankCard.error?.message})`}`,
  typeof blankCard === 'string',
  true
);
// Every field exists before anything is stored, which is the whole point of a curated card: the first message
// is added from this screen, not by inserting a sheet row. Matched on the placeholder, because the other
// cards in this tab draw blank inputs too.
const messageInputs = (html) => html.match(/<input[^>]*placeholder="Message [^"]*"[^>]*>/g) || [];
check('ten fields are drawn', messageInputs(blankCard).length, 10);
check('numbered from zero', blankCard.includes('placeholder="Message 0..."'), true);
check('through to nine', blankCard.includes('placeholder="Message 9..."'), true);
check('a stored message is shown in its field', messageInputs(blankCard).some((input) => input.includes('value="Welcome aboard"')), true);
check('and the blank ones are blank fields', messageInputs(blankCard).filter((input) => input.includes('value=""')).length, 9);
check('with the save button', blankCard.includes('Save Loading Messages'), true);
check('the card does not render its own key anywhere', blankCard.includes('loading_message0'), false);

const emptyCard = card([]);
check(
  `the card renders with no settings at all${typeof emptyCard === 'string' ? '' : ` (${emptyCard.error?.message})`}`,
  typeof emptyCard === 'string',
  true
);
check('and still offers all ten fields', messageInputs(emptyCard).length, 10);
check('all of them blank', messageInputs(emptyCard).every((input) => input.includes('value=""')), true);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
console.log('--- wiring: the parts a render cannot prove ---');
const source = readFileSync('src/components/admin/AdminSystemSettingsTab.jsx', 'utf8');
const util = readFileSync('src/utils/systemSettings.js', 'utf8');
const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// The defect's signature: an id parsed into an index, then compared against the map index.
check('the onChange does not parse an index out of the id', /\.split\('_'\)/.test(code), false);
check('nor compare an index to one', /i === msg\.id|=== msg\.id\.split/.test(code), false);
check(
  'the field edits by id through the shared helper',
  /onChange=\{\(e\) => setLoadingMessages\(\(current\) => updateLoadingMessages\(current, msg\.id, e\.target\.value\)\)\}/.test(code),
  true
);
// The functional update matters as well: reading `loadingMessages` from the closure would drop a keystroke
// that arrived in the same tick as another.
check('and takes the current list, not a closed-over one', /setLoadingMessages\(\(current\) =>/.test(code), true);
check('the row value is the field value', /value=\{msg\.value\}/.test(code), true);
check('the rows come from the shared helper', /useState\(\(\) => getLoadingMessages\(systemSettings\)\)/.test(code), true);
check('and follow the sheet when it changes', /setLoadingMessages\(getLoadingMessages\(systemSettings\)\)/.test(code), true);
// The save is ONE request now (see verify-write-safety for the backend half): the plan is built first, sent as
// a batch, and only falls back to per-key saves when the deployment in front of us predates the batch action.
check('the save builds the plan from the form', /const plan = loadingMessageSavePlan\(loadingMessages\)/.test(code), true);
check('and sends it as one request', /adminSaveSystemSettings\(\s*plan\.map\(\(\{ key, value \}\) => \(\{ key, value \}\)\),\s*token\s*\)/.test(code), true);
check('falling back to per-key saves for an older deployment', /for \(const \{ key, value, label \} of plan\)/.test(code), true);
check('through the single-key action', /adminSaveSystemSetting\(key, value, token\)/.test(code), true);
check(
  'and the fallback is only reached on UNKNOWN_ACTION',
  /if \(isUnknownAction\(result\)\)/.test(code),
  true
);
// Once a save failed, the old handler refused to try again until the tab was remounted.
check('a failed save does not disable the button for good', /if \(!error\)/.test(code), false);
check('the button is only disabled while saving', /disabled=\{saving\}/.test(code), true);
check('the handler clears the old error first', /setError\(null\);\n\s*setSaved\(false\);/.test(source), true);
// Mutating a prop is what the old helper did: it wrote the typed value straight into the parent's list.
check('the card never assigns into the settings it was given', /systemSettings\[[^\]]*\]\s*\.\s*value\s*=/.test(code), false);
check('and never writes into the rows it renders', /msg\.value\s*=/.test(code), false);
check('the settings lookup is shared, not re-defined', /function getSettingValue/.test(code), false);
check('but is imported', /getSettingValue,/.test(source), true);
// The keys are curated so the Custom Settings card below does not also list them as generic rows.
check('the curated key list reuses the shared one', /\.\.\.LOADING_MESSAGE_KEYS,/.test(source), true);
check('the util is the single source of the keys', /export const LOADING_MESSAGE_KEYS = Array\.from/.test(util), true);
check('which is built from the count, not a hand-written list', /export const LOADING_MESSAGE_COUNT = 10/.test(util), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);


