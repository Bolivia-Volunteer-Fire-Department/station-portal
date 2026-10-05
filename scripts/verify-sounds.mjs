/**
 * Verifies the sounds.
 *
 * Every sound is decoration, so none of this can fail loudly at runtime - which is exactly why it needs a test
 * rather than a look. Three things are checked here:
 *
 *   1. The rules, as pure functions: which setting wins, which press makes which noise, which tone a modal opens
 *      with, which toast kind gets which sound.
 *   2. The wiring, as source assertions: the delegated listener is installed, the toast wrapper is the only thing
 *      importing sonner's `toast`, and the settings key is accepted by the backend and merged by the client.
 *   3. The assets: every mp3 on disk is wired to a name, every wired name exists on disk, and each file is real
 *      audio rather than an empty placeholder.
 *
 * The last one matters more than it looks. A sound nobody named is silent and nobody notices; a name with no file
 * breaks the build. And a click listener that stopped being installed would take every sound in the app with it
 * while the code still looked right - so the listener is also EXERCISED against a fake document, to prove it
 * plays something on a press and nothing on a paragraph.
 *
 * Run with: npm run verify:sounds
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
// The pure rules. Imported from soundRules rather than uiSounds because uiSounds imports the mp3 files, which
// plain Node cannot load - and because the decisions are the part worth exercising without a browser.
import {
  REQUIRED_SOUNDS,
  SOUND_VOLUME,
  SOUND_VOLUME_MIN,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_STEP,
  clampSoundVolume,
  soundVolumeFor,
  soundVolumeRows,
  SOUNDS_SETTING_KEY,
  SOUNDS_DEFAULT,
  soundsActiveFrom,
  CLICKABLE_SELECTOR,
  SOUND_DIRECTIVES,
  DIRECTIVE_SOUNDS,
  TOGGLE_SOUNDS,
  isToggleSound,
  soundDirectiveFor,
  isClickableElement,
  soundForPress,
  controlLabel,
  labelSaysImpactful,
  isImpactfulControl,
  IMPACT_VERBS,
  IMPACT_ICONS,
  CONTROL_LABEL_LIMIT,
  movedEnoughToBeADrag,
  MODAL_SOUNDS,
  MODAL_TONE_FILES,
  modalSoundFor,
  TOAST_SOUNDS,
  toastSoundFor,
  createPressTracker,
} from '../src/utils/soundRules.js';

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

const listFiles = (dir) => {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else found.push(full);
  }
  return found;
};
const allSources = listFiles('src').filter((file) => /\.jsx?$/.test(file));
const readSource = (file) => readFileSync(file, 'utf8');

// ---------------------------------------------------------------------------
// 1. The setting: member, then station, then on
// ---------------------------------------------------------------------------
console.log('\n--- is this member hearing sounds? ---');
check('the key is the one the sheet carries', SOUNDS_SETTING_KEY, 'is_sounds_active');
check('a station default of TRUE wins for a member who has not chosen', soundsActiveFrom('', 'TRUE'), true);
check('and a station default of FALSE is honored', soundsActiveFrom('', 'FALSE'), false);
check('a missing station default is ON, which is the documented default', soundsActiveFrom('', ''), true);
check('and a missing user_settings column is ON too', soundsActiveFrom(undefined, undefined), SOUNDS_DEFAULT);
check('the member wins over the station', soundsActiveFrom('FALSE', 'TRUE'), false);
check('and wins the other way as well', soundsActiveFrom('TRUE', 'FALSE'), true);
check('lower case and padding are read as a hand-edited cell looks', soundsActiveFrom(' false ', 'TRUE'), false);
check('a real boolean is accepted, since that is what state holds', soundsActiveFrom(true, 'FALSE'), true);
check('nonsense falls through to the station rather than guessing', soundsActiveFrom('maybe', 'FALSE'), false);
check('and nonsense everywhere is ON', soundsActiveFrom('maybe', 'perhaps'), true);


// ---------------------------------------------------------------------------
// 2. Presses
// ---------------------------------------------------------------------------
// A fake element that answers a closest() query the way the DOM would for everything the real code asks:
// a declared selector (it passes the whole comma-joined list at once, so `includes` is the right emulation), or
// one of the data-sound attribute selectors the rules use - `[data-sound]` for ANY value, and
// `[data-sound="x"]` for a specific one. `text` and `icons` stand in for the control's own label and the lucide
// icons inside it, which is what the heavier-click rule reads.
console.log('\n--- which press makes a noise ---');
const el = ({
  selectors = [],
  attrs = {},
  disabled = false,
  htmlFor = '',
  contains = null,
  text = '',
  icons = [],
} = {}) => {
  const matchesQuery = (queried) => {
    if (selectors.some((sel) => queried.includes(sel))) return true;
    const marker = String(attrs['data-sound'] ?? '');
    if (!marker) return false;
    if (queried.includes(`[data-sound="${marker}"]`)) return true;
    return queried.includes('[data-sound]');
  };
  const node = {
    tagName: (attrs.tagName || 'DIV').toUpperCase(),
    disabled,
    htmlFor,
    textContent: text,
    querySelector: () => contains,
    // The icons inside a control, as lucide renders them: the icon name is in the class.
    querySelectorAll: (queried) =>
      queried.includes('lucide-') || queried.includes('class')
        ? icons.map((classes) => ({ getAttribute: () => classes }))
        : [],
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    closest: (queried) => (matchesQuery(queried) ? node : null),
  };
  return node;
};
const plainDiv = (extra = {}) => el({ selectors: [], ...extra });
const buttonWith = ({ text = '', icons = [], attrs = {} } = {}) => el({ selectors: ['button'], text, icons, attrs });

checkIs('a button clicks', soundForPress(el({ selectors: ['button'] })) === 'click');
checkIs('a role="button" clicks', soundForPress(el({ selectors: ['[role="button"]'] })) === 'click');
checkIs('a menu item clicks', soundForPress(el({ selectors: ['[role="menuitem"]'] })) === 'click');
checkIs('a checkbox clicks', soundForPress(el({ selectors: ['input'] })) === 'click');
checkIs('so does a <select>, for the press that opens it', soundForPress(el({ selectors: ['select'] })) === 'click');
checkIs('a link clicks', soundForPress(el({ selectors: ['a[href]'] })) === 'click');
checkIs(
  'a draggable pill clicks even though it is a div',
  soundForPress(el({ selectors: ['[draggable="true"]'] })) === 'click'
);
checkIs(
  'and an explicitly marked div clicks',
  soundForPress(el({ selectors: ['[data-sound="click"]'] })) === 'click'
);
checkIs('a label with a for= clicks', soundForPress(el({ selectors: ['label'], htmlFor: 'x' })) === 'click');
checkIs(
  'a label wrapping a control clicks',
  soundForPress(el({ selectors: ['label'], contains: { tagName: 'INPUT' } })) === 'click'
);
checkIs('a decorative label does not', soundForPress(el({ selectors: ['label'] })) === '');
checkIs('a paragraph does not', soundForPress(plainDiv()) === '');
checkIs('nor a table cell', soundForPress(el({ attrs: { tagName: 'TD' } })) === '');
checkIs('a disabled control does not', soundForPress(el({ selectors: ['button'], disabled: true })) === '');
checkIs(
  'nor one that is aria-disabled',
  soundForPress(el({ selectors: ['button', '[aria-disabled="true"]'] })) === ''
);
checkIs('no element at all is silence, not a crash', soundForPress(null) === '');

// The recognizer on its own, since the change event and dragend call it directly rather than through a press.
checkIs('a button is a control', isClickableElement(el({ selectors: ['button'] })) === true);
checkIs('and so is a <select>', isClickableElement(el({ selectors: ['select'] })) === true);
checkIs('while a bare div is not', isClickableElement(plainDiv()) === false);
checkIs('and neither is nothing at all', isClickableElement(null) === false);

// The minigame opts the whole cabinet out of the app's click sound; nothing inside it can put it back.
checkIs('a marked subtree is silent', soundForPress(el({ selectors: ['[data-sound="none"]', 'button'] })) === '');

console.log('\n--- the sounds toggle, which has to be heard while it turns itself on ---');
checkIs(
  'a switch that is off plays the on sound',
  soundForPress(el({ selectors: ['button'], attrs: { 'data-sound': 'sound-on' } })) === 'sound_on'
);
checkIs(
  'and one that is on plays the off sound',
  soundForPress(el({ selectors: ['button'], attrs: { 'data-sound': 'sound-off' } })) === 'sound_off'
);
checkIs(
  'a directive wins over the generic click, so nothing is sounded twice',
  soundDirectiveFor(el({ selectors: ['[data-sound]'], attrs: { 'data-sound': 'sound-on' } })) === 'sound-on'
);
checkIs(
  'an unrecognized directive falls back to the click',
  soundForPress(el({ selectors: ['button'], attrs: { 'data-sound': 'loud' } })) === 'click'
);
checkIs(
  'and every documented directive does something',
  SOUND_DIRECTIVES.every(
    (value) =>
      soundForPress(el({ selectors: ['button', '[data-sound]'], attrs: { 'data-sound': value } })) ===
      (value === 'none' ? '' : DIRECTIVE_SOUNDS[value])
  )
);
checkIs(
  'each directive resolves to a sound that exists',
  Object.values(DIRECTIVE_SOUNDS).every((sound) => REQUIRED_SOUNDS.includes(sound)),
  Object.values(DIRECTIVE_SOUNDS).join(', ')
);
checkIs(
  'and every directive is mapped, so none is silently a no-op',
  SOUND_DIRECTIVES.filter((value) => value !== 'none').every((value) => !!DIRECTIVE_SOUNDS[value])
);

// ---------------------------------------------------------------------------
// 3. Grab and release
// ---------------------------------------------------------------------------
console.log('\n--- a drag gets a second sound, a tap does not ---');
check('a press that did not move is not a drag', movedEnoughToBeADrag({ x: 0, y: 0 }, { x: 0, y: 0 }), false);
check('nor is one that jittered', movedEnoughToBeADrag({ x: 10, y: 10 }, { x: 14, y: 12 }), false);
check('but six pixels sideways is', movedEnoughToBeADrag({ x: 10, y: 10 }, { x: 16, y: 10 }), true);
check('and so is a drag across the board', movedEnoughToBeADrag({ x: 10, y: 10 }, { x: 210, y: 10 }), true);
check('vertically too', movedEnoughToBeADrag({ x: 10, y: 10 }, { x: 10, y: 40 }), true);
check('a release with no recorded press is not a drag', movedEnoughToBeADrag(null, { x: 1, y: 1 }), false);
check('and neither is a press with no release point', movedEnoughToBeADrag({ x: 1, y: 1 }, null), false);


// ---------------------------------------------------------------------------
// 3. Which actions get the heavier click
// ---------------------------------------------------------------------------
// The policy (see IMPACT_VERBS): consequential and infrequent actions get click_double. These cases are the policy
// written down, including the exclusions, because "some clicks are heavier" is only defensible if the line is
// somewhere specific.
console.log('\n--- which actions get the heavier click ---');
const pressFor = (spec) => soundForPress(spec instanceof Object ? spec : buttonWith({ text: spec }));

[
  'Save Changes',
  'Save Preferences',
  'Delete',
  'Remove member from shift',
  'Cancel',
  'Export CSV',
  'Print schedule',
  'Sign Out',
  'Approve shift offer',
  'Decline offer',
].forEach((label) => {
  check(`"${label}" is a heavier click`, pressFor(label), 'click_double');
});

// The app's Edit and Delete buttons are icon-only, with no text to read at all.
[
  ['a pencil (Edit)', 'lucide lucide-pencil w-4 h-4'],
  ['a bin (Delete)', 'lucide lucide-trash-2 w-4 h-4'],
  ['a download (Export)', 'lucide lucide-download w-4 h-4'],
  ['a printer', 'lucide lucide-printer w-4 h-4'],
].forEach(([what, classes]) => {
  check(`an icon-only button showing ${what} is a heavier click`, pressFor(buttonWith({ icons: [classes] })), 'click_double');
});
check('an icon behind an aria-label is read', pressFor(buttonWith({ attrs: { 'aria-label': 'Edit' } })), 'click_double');
check('and behind a title', pressFor(buttonWith({ attrs: { title: 'Delete' }, icons: ['lucide lucide-trash-2'] })), 'click_double');

// The deliberate exclusions. Each of these is an everyday action, and a heavier sound on them would stop meaning
// anything - which is the whole reason for the distinction.
[
  'Clock In',
  'Clock Out',
  'Dashboard',
  'My Schedule',
  'Reset filters',
  'Clear selection',
  'Close',
  'Add member',
  'Next month',
  'Calendar',
].forEach((label) => {
  check(`"${label}" stays on the plain click`, pressFor(label), 'click');
});
// A spinner is not the action it belongs to.
check('a spinner icon-only button is not an action', pressFor(buttonWith({ icons: ['lucide lucide-loader-circle animate-spin'] })), 'click');
check('nor is a close X', pressFor(buttonWith({ icons: ['lucide lucide-x w-4 h-4'] })), 'click');
check('nor a plus, which opens a form rather than committing it', pressFor(buttonWith({ icons: ['lucide lucide-plus w-4 h-4'] })), 'click');

// The label cap, for a clickable container that holds a paragraph rather than a button label. What it protects
// against is a verb appearing LATE in long text - a card that happens to mention deleting something in its last
// line is not a delete button.
const paragraph = 'Station apparatus checklist for the coming week, including the items we intend to delete';
checkIs('the sample text is longer than the cap', paragraph.length > CONTROL_LABEL_LIMIT);
check(
  'a paragraph that only mentions a verb past the cap is not an action',
  pressFor(buttonWith({ text: paragraph })),
  'click'
);
// A verb inside the cap is read, wherever it is: this is a button whose label really does start with its action.
check('while a verb within the cap is', pressFor(buttonWith({ text: 'Delete this entry permanently' })), 'click_double');
check('and a bare label is', pressFor(buttonWith({ text: 'Save' })), 'click_double');

console.log('\n--- and the marker has the last word, both ways ---');
check(
  'an action can be demoted back to the plain click',
  pressFor(buttonWith({ text: 'Delete', attrs: { 'data-sound': 'click' } })),
  'click'
);
check(
  'and anything at all can be promoted',
  soundForPress(el({ selectors: ['[data-sound="click"]'], attrs: { 'data-sound': 'click-double' } })),
  'click_double'
);
check('the sounds toggle still speaks only for itself', pressFor(buttonWith({ text: 'Sound Effects', attrs: { 'data-sound': 'sound-off' } })), 'sound_off');
check('a disabled Delete is still silent', soundForPress(el({ selectors: ['button'], text: 'Delete', disabled: true })), '');
check('and the runner is silent whatever its buttons say', soundForPress(el({ selectors: ['[data-sound="none"]', 'button'], text: 'Delete' })), '');

checkIs('the marker is not required on the common case', isImpactfulControl(buttonWith({ text: 'Save' })) === true);
checkIs('nor on the icon-only case', isImpactfulControl(buttonWith({ icons: ['lucide lucide-trash-2'] })) === true);
checkIs('and the label reader caps what it reads', controlLabel(buttonWith({ text: 'x'.repeat(120) })).length <= CONTROL_LABEL_LIMIT);
check('the verb list has no duplicates', IMPACT_VERBS.length, new Set(IMPACT_VERBS).size);
check('and the icon list neither', IMPACT_ICONS.length, new Set(IMPACT_ICONS).size);
checkIs(
  'the plain click and the heavier one are mixed in the documented order',
  SOUND_VOLUME.click < SOUND_VOLUME.click_double && SOUND_VOLUME.click_double <= SOUND_VOLUME.default,
  `click ${SOUND_VOLUME.click}, click_double ${SOUND_VOLUME.click_double}, default ${SOUND_VOLUME.default}`
);
checkIs('and only the toggle pair bypasses the mute gate', isToggleSound('sound_on') && isToggleSound('sound_off'));
checkIs('the heavier click obeys the member\'s setting like the plain one', !isToggleSound('click_double') && !TOGGLE_SOUNDS.includes('click'));

// ---------------------------------------------------------------------------
// 3b. The levels, and the Debug page's session overrides
// ---------------------------------------------------------------------------
// A level can arrive from a slider, so it can arrive wrong: too high for an Audio element, or not a number at all.
// Clamping is therefore a rule rather than a detail - and the fallback direction matters, because a level that
// cannot be read must not be the one that silences a sound.
console.log('\n--- levels ---');
check('the range is what an Audio element accepts', [SOUND_VOLUME_MIN, SOUND_VOLUME_MAX], [0, 1]);
checkIs('and the slider step divides it evenly', Number.isInteger(1 / SOUND_VOLUME_STEP), `step ${SOUND_VOLUME_STEP}`);
check('below the range is clamped up to nothing', clampSoundVolume(-0.5), 0);
check('above it is clamped down to full', clampSoundVolume(4), 1);
check('a level inside it passes through', clampSoundVolume(0.35), 0.35);
check('a numeric string is read', clampSoundVolume('0.2'), 0.2);
check('and anything unreadable falls back to the shipped default', clampSoundVolume('loud'), SOUND_VOLUME.default);
check('including a missing value', clampSoundVolume(undefined), SOUND_VOLUME.default);
check('and a NaN', clampSoundVolume(Number.NaN), SOUND_VOLUME.default);

check('a tuned sound plays at its own level', soundVolumeFor('click', {}), SOUND_VOLUME.click);
check('an untuned one at the shared default', soundVolumeFor('toast_success', {}), SOUND_VOLUME.default);
check('an override wins', soundVolumeFor('click', { click: 0.85 }), 0.85);
check('but only for its own sound', soundVolumeFor('toast_success', { click: 0.85 }), SOUND_VOLUME.default);
check('a null override is not an override', soundVolumeFor('click', { click: null }), SOUND_VOLUME.click);
check('and a silly one is clamped, not obeyed', soundVolumeFor('click', { click: 9 }), 1);
check('the engine holds its overrides in a Map', soundVolumeFor('click', new Map([['click', 0.1]])), 0.1);

// The rows are what the Debug page renders. Every sound has one, seeded from the shipped mix, and only the sounds
// somebody moved are marked as moved - which is what lets a row be put back on its own.
const shippedRows = soundVolumeRows({});
check('every sound has a level row', shippedRows.map((row) => row.name), REQUIRED_SOUNDS);
check('seeded from the shipped mix', shippedRows.every((row) => row.volume === row.shipped), true);
check('with none of them marked as moved', shippedRows.filter((row) => row.overridden).length, 0);
check(
  'and each row says where its shipped level came from',
  [
    shippedRows.find((row) => row.name === 'click').shippedFrom,
    shippedRows.find((row) => row.name === 'toast_success').shippedFrom,
  ],
  ['click', 'default']
);
checkIs(
  'every shipped level lands exactly on a slider position',
  shippedRows.every((row) => Math.abs(row.shipped / SOUND_VOLUME_STEP - Math.round(row.shipped / SOUND_VOLUME_STEP)) < 1e-9),
  `shipped: ${shippedRows.map((row) => row.shipped).join(', ')}`
);

const movedRows = soundVolumeRows({ click: 0.05, notification: 0.2 });
check('a moved sound is marked as moved', movedRows.filter((row) => row.overridden).map((row) => row.name), ['click', 'notification']);
check('and shows the level in force', movedRows.find((row) => row.name === 'notification').volume, 0.2);
check('while still showing what it ships at', movedRows.find((row) => row.name === 'notification').shipped, SOUND_VOLUME.default);
check(
  'every other sound is untouched',
  movedRows.filter((row) => !row.overridden).every((row) => row.volume === row.shipped),
  true
);

// ---------------------------------------------------------------------------
// 4. The rule, applied to the app's own buttons
// ---------------------------------------------------------------------------
// The table above says what the policy MEANS; this reads every button in the codebase and says what it DOES. It is
// the check that would have caught "the rule matches everything, so the heavy click means nothing" - and it is
// printed rather than only asserted, so the line the policy draws can be read at a glance.
console.log('\n--- the rule, on this app\'s actual buttons ---');
// The end of an opening tag: the first '>' outside braces and quotes. A naive search finds the '>' inside
// `onClick={() => ...}` instead, and ends up classifying handler NAMES ("handleEdit") as button labels - which
// flatters the rule for the wrong reason.
const openingTagEnd = (source, start) => {
  let braces = 0;
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const character = source[i];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '{') braces++;
    else if (character === '}') braces--;
    else if (character === '>' && braces === 0) return i;
  }
  return -1;
};

const interactiveLabels = [];
allSources.forEach((file) => {
  const source = readSource(file);
  let cursor = -1;
  while ((cursor = source.indexOf('<button', cursor + 1)) !== -1) {
    const close = source.indexOf('</button>', cursor);
    const tagEnd = openingTagEnd(source, cursor);
    if (close === -1 || tagEnd === -1) break;
    // A button's own words: an explicit label, or its visible text with any JSX expressions removed.
    const attributes = source.slice(cursor, tagEnd);
    const labeled = /(?:aria-label|title)="([^"]{2,40})"/.exec(attributes);
    const inner = source.slice(tagEnd + 1, close).replace(/\{[\s\S]*?\}/g, '');
    const text = inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const words = labeled ? labeled[1] : text;
    // Skip entries that are code rather than a label: a button built from several JSX fragments can leave
    // attribute text behind, and listing it would make the report harder to trust than it is useful.
    if (words && !/["={}<>]|\/\//.test(words)) interactiveLabels.push(words.slice(0, CONTROL_LABEL_LIMIT));
  }
});
const heavier = [];
const plain = [];
const seen = new Set();
interactiveLabels.forEach((words) => {
  if (seen.has(words)) return;
  seen.add(words);
  (labelSaysImpactful({ getAttribute: () => null, textContent: words }) ? heavier : plain).push(words);
});
console.log(`  heavier (${heavier.length}): ${heavier.join(' | ')}`);
console.log(`  plain   (${plain.length}): ${plain.slice(0, 12).join(' | ')}${plain.length > 12 ? ' …' : ''}`);
checkIs('the app has buttons to classify', interactiveLabels.length > 30, `${interactiveLabels.length} found`);
checkIs('some of them are heavier actions', heavier.length > 5, heavier.join(', '));
// The point of the distinction: the heavier sound marks the exception. If it ever covered most of the interface,
// it would no longer mean "this one mattered".
checkIs(
  'and the heavier ones are the minority, which is what makes the distinction mean something',
  heavier.length < plain.length,
  `${heavier.length} heavier vs ${plain.length} plain`
);
checkIs('nothing that is pure navigation is heavier', heavier.every((label) => !/^(dashboard|calendar|my schedule)$/i.test(label)));
// Tied back to labels the app really uses, so the report cannot drift away from the truth table above.
const classifiedAs = (list, label) => list.some((entry) => entry.toLowerCase() === label.toLowerCase());
checkIs(
  'the app\'s own Save button is classified as an action',
  classifiedAs(heavier, 'Save Changes') || classifiedAs(heavier, 'Save Preferences') || classifiedAs(heavier, 'Save'),
  heavier.join(' | ')
);
checkIs(
  'and its clock buttons are not',
  ['Clock In', 'Clock Out'].every((label) => !classifiedAs(heavier, label) || classifiedAs(plain, label)),
  plain.join(' | ')
);

// ---------------------------------------------------------------------------
// 5. The listeners, exercised
// ---------------------------------------------------------------------------
// The tracker, driven with fake events. This is the part that would otherwise only be proven by clicking around:
// one sound per tap, two per drag, none for a paragraph or a right-click.
console.log('\n--- driving the listeners ---');
const trackerWith = () => {
  const played = [];
  const tracker = createPressTracker((name, options) => played.push({ name, ...options }));
  return { tracker, played };
};
const button = () => el({ selectors: ['button'] });
const press = (tracker, target, { x = 0, y = 0, button: which = 0 } = {}) =>
  tracker.onPointerDown({ target, clientX: x, clientY: y, button: which });
// A finger, as the browser reports it: pointerType 'touch' is what defers the sound to the release.
const touchPointer = { clientX: 10, clientY: 10, button: 0, pointerType: 'touch' };

{
  const { tracker, played } = trackerWith();
  press(tracker, button());
  check('a tap makes one sound', played.length, 1);
  check('and it is the click', played[0].name, 'click');
  check('the click is not forced, so the mute gate applies to it', played[0].force, false);
  // The release of a tap that did not move: silent, or every tap would click twice.
  tracker.onPointerUp({ target: button(), clientX: 0, clientY: 0 });
  check('and its release adds nothing', played.length, 1);
}
{
  const { tracker, played } = trackerWith();
  press(tracker, button(), { x: 100, y: 100 });
  tracker.onPointerUp({ target: button(), clientX: 160, clientY: 100 });
  check('a release that moved is a drag release, and sounds', played.length, 2);
  check('with a second click', played[1].name, 'click');
}
{
  // An HTML5 drag: the press sounds the grab, dragstart stays quiet, dragend sounds the release.
  const { tracker, played } = trackerWith();
  press(tracker, el({ selectors: ['[draggable="true"]'] }), { x: 5, y: 5 });
  tracker.onDragStart({ target: button() });
  check('the grab sounds once', played.length, 1);
  tracker.onPointerUp({ target: button(), clientX: 200, clientY: 200 });
  check('and no pointerup sound is added during an HTML5 drag', played.length, 1);
  tracker.onDragEnd({ target: el({ selectors: ['[draggable="true"]'] }) });
  check('dragend sounds the release', played.length, 2);
}
{
  const { tracker, played } = trackerWith();
  press(tracker, plainDiv());
  check('pressing a paragraph is silent', played.length, 0);
  tracker.onPointerUp({ target: plainDiv(), clientX: 50, clientY: 50 });
  check('and so is releasing one, however far it moved', played.length, 0);
}
{
  const { tracker, played } = trackerWith();
  press(tracker, button(), { button: 2 });
  check('a right-click is silent', played.length, 0);
}
{
  const { tracker, played } = trackerWith();
  press(tracker, el({ selectors: ['button'], attrs: { 'data-sound': 'sound-on' } }));
  check('the sounds toggle plays its own sound', played[0].name, 'sound_on');
  check('and FORCES it, because that is the switch that turns sounds on', played[0].force, true);
  check('with no click layered on top', played.length, 1);
}
{
  const { tracker, played } = trackerWith();
  tracker.onChange({ target: el({ selectors: ['select'], attrs: { tagName: 'SELECT' } }) });
  check('choosing from a dropdown clicks', played.length, 1);
  tracker.onChange({ target: el({ selectors: ['input'], attrs: { tagName: 'INPUT' } }) });
  check('but typing in a text input does not', played.length, 1);
}
{
  // A finger must not click as it starts a scroll: the sound waits for the release, and a release that moved was
  // a scroll, not a tap.
  console.log('\n--- a finger is not a mouse ---');
  const { tracker, played } = trackerWith();
  const touch = { ...touchPointer, target: button() };
  tracker.onPointerDown(touch);
  check('touching a button makes no sound yet', played.length, 0);
  tracker.onPointerUp({ ...touch, clientX: 10, clientY: 10 });
  check('and lifting the finger without moving plays the tap', played.length, 1);
  check('which is the click', played[0].name, 'click');

  const scrolled = trackerWith();
  scrolled.tracker.onPointerDown(touch);
  scrolled.tracker.onPointerUp({ ...touch, clientX: 10, clientY: 220 });
  check('a finger that traveled was scrolling, and is silent', scrolled.played.length, 0);

  const canceled = trackerWith();
  canceled.tracker.onPointerDown(touch);
  // A scroll the browser takes over arrives as pointercancel, and nothing else follows it.
  canceled.tracker.onPointerCancel({ ...touch });
  canceled.tracker.onPointerUp({ ...touch, clientX: 10, clientY: 10 });
  check('and a canceled touch plays nothing at all', canceled.played.length, 0);

  // The sounds toggle still speaks for itself on a touch screen, and still forces its sound through the mute gate.
  const toggled = trackerWith();
  toggled.tracker.onPointerDown({
    ...touch,
    target: el({ selectors: ['button'], attrs: { 'data-sound': 'sound-on' } }),
  });
  toggled.tracker.onPointerUp({ ...touch, target: el({ selectors: ['button'] }) });
  check('tapping the sounds switch plays the on sound on release', toggled.played[0].name, 'sound_on');
  check('and forces it, so it is heard while sounds are off', toggled.played[0].force, true);
}
{
  // The heavier click and the mute gate. `click_double` is NOT a toggle sound, so it must obey the member's
  // setting: an earlier version of this logic forced everything that was not the plain click, which would have
  // made the heaviest actions the one thing a member could not silence.
  const { tracker, played } = trackerWith();
  press(tracker, buttonWith({ text: 'Save Changes' }));
  check('a Save button plays the heavier click', played[0].name, 'click_double');
  check('and it is NOT forced, so the mute gate still applies', played[0].force, false);

  const toggled = trackerWith();
  press(toggled.tracker, buttonWith({ attrs: { 'data-sound': 'sound-on' } }));
  check('while the sounds switch itself still forces its sound through', toggled.played[0].force, true);

  // A finger gets the same classification as a mouse, played on release instead.
  const touched = trackerWith();
  touched.tracker.onPointerDown({ ...touchPointer, target: buttonWith({ text: 'Delete' }) });
  check('a touch on an action waits for the release, as any touch does', touched.played.length, 0);
  touched.tracker.onPointerUp({ ...touchPointer, target: buttonWith({ text: 'Delete' }) });
  check('and then plays the heavier click', touched.played[0].name, 'click_double');
  check('unforced, like the mouse press', touched.played[0].force, false);
}
{
  // A drag end on something that is not a control, e.g. a draggable wrapper, must not click.
  const { tracker, played } = trackerWith();
  tracker.onDragEnd({ target: plainDiv() });
  check('dragend on a non-control is silent', played.length, 0);
}


// ---------------------------------------------------------------------------
// 4. The sound files themselves
// ---------------------------------------------------------------------------
// The failure this section exists for: a file added to src/assets that nobody wired to a name. It would sit there
// for ever, silent, and nothing else would ever mention it.
console.log('\n--- the files on disk ---');
const assetDir = 'src/assets';
const assetFiles = readdirSync(assetDir)
  .filter((name) => name.toLowerCase().endsWith('.mp3'))
  .sort();
const assetNames = assetFiles.map((name) => name.replace(/\.mp3$/i, ''));

check('every sound in the contract has a file, and every file has a name', assetNames, [...REQUIRED_SOUNDS].sort());
assetFiles.forEach((name) => {
  const bytes = readFileSync(path.join(assetDir, name));
  const looksLikeAudio =
    bytes.length > 512 && (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  checkIs(`${name} is a real mp3, not an empty placeholder`, looksLikeAudio, `${bytes.length} bytes`);
});

// The engine has to import them by name, or the contract above is only a suggestion.
const soundSource = readSource('src/utils/uiSounds.js');
REQUIRED_SOUNDS.forEach((name) => {
  checkIs(`${name} is imported by the engine`, soundSource.includes(`from '../assets/${name}.mp3'`));
});
checkIs(
  'and mapped to that name in SOUND_FILES',
  REQUIRED_SOUNDS.every((name) => new RegExp(`^\\s*${name}: `, 'm').test(soundSource)),
  'a name not mapped is a sound nothing can play'
);
check('the click is mixed below the one-shot sounds', SOUND_VOLUME.click < SOUND_VOLUME.default, true);

// ---------------------------------------------------------------------------
// 5. Modals
// ---------------------------------------------------------------------------
console.log('\n--- modals ---');
Object.entries(MODAL_SOUNDS).forEach(([modal, tone]) => {
  checkIs(`${modal} maps to a real tone (${tone})`, Object.keys(MODAL_TONE_FILES).includes(tone));
  checkIs(`${modal}'s tone resolves to a modal sound`, /^modal_(positive|error)$/.test(modalSoundFor(modal)));
});
check('an unknown modal defaults to the forgiving tone', modalSoundFor('somethingNew'), 'modal_positive');
check('and an explicit tone overrides the table', modalSoundFor('reauth', 'positive'), 'modal_positive');

// Every modal component names its own tone, and every tone in the table belongs to a component. Without the first
// half a new modal is silent; without the second, a stale entry hides the fact that its component is gone.
const modalFiles = readdirSync('src/components')
  .filter((name) => /Modal\.jsx$/.test(name))
  .sort();
const declaredBy = {};
modalFiles.forEach((name) => {
  const match = /modalSoundFor\('([A-Za-z]+)'\)/.exec(readSource(path.join('src/components', name)));
  declaredBy[name] = match ? match[1] : null;
  checkIs(`${name} declares its tone`, !!match, 'no modalSoundFor() call found');
  if (match) {
    checkIs(
      `${name}'s key '${match[1]}' is in the table`,
      match[1] in MODAL_SOUNDS,
      'an unknown key silently defaults to positive'
    );
  }
});
const declaredKeys = Object.values(declaredBy).filter(Boolean).sort();
check('every component is accounted for in the table', declaredKeys, Object.keys(MODAL_SOUNDS).sort());
check('and there is no stale entry', Object.keys(MODAL_SOUNDS).filter((key) => !declaredKeys.includes(key)), []);

// The popovers in Schedule Management are menus and context popovers, not modals: their ITEMS click, and the panel
// opening is not an interruption. Asserted so a later "tidy up" cannot quietly make them modal.
//
// ...WHICH IS STILL TRUE OF THE FRAME THEY KEEP ON A WIDE SCREEN, and the tone is what says so: the board itself has no
// modalSoundFor call anywhere, and the DIALOG its day view uses - a different component, outside this file - is the only
// half that opens with a tone. Both directions are asserted below, because "the popover is silent" and "the dialog
// sounds" are two claims and a single check on the board can only ever see one of them.
const popoverSource = readSource('src/components/admin/AdminScheduleManagementTab.jsx');
const assignmentDialogSource = readSource('src/components/ScheduleAssignmentModal.jsx');
checkIs('and the member picker sounds when it is the dialog, not when it is the menu', /playSound\(modalSoundFor\('scheduleAssignment'\)\)/.test(assignmentDialogSource));
checkIs(
  'which is the frame only the day view uses',
  /if \(dayView\) \{[\s\S]{0,200}<ScheduleAssignmentModal/.test(popoverSource),
  'the two frames would have to be told apart by something other than the view'
);

// ---------------------------------------------------------------------------
// 6. Toasts
// ---------------------------------------------------------------------------
console.log('\n--- toasts ---');
Object.entries(TOAST_SOUNDS).forEach(([kind, sound]) => {
  checkIs(`the ${kind} toast maps to a real sound (${sound})`, REQUIRED_SOUNDS.includes(sound));
});
check('an unknown toast kind falls back to normal, not to a promise', toastSoundFor('celebrate'), 'toast_normal');
check('and so does no kind at all', toastSoundFor(undefined), 'toast_normal');

// The wrapper is the only way a toast gets a sound, so a direct sonner import in a component would silence that
// screen. This is the rule that keeps the next feature honest.
const toastSource = readSource('src/utils/toast.js');
checkIs('the wrapper imports sonner itself', /from 'sonner'/.test(toastSource));
allSources
  .filter((file) => /from 'sonner'/.test(readSource(file)))
  .forEach((file) => {
    const imported = /import\s*{([^}]*)}\s*from 'sonner'/.exec(readSource(file))?.[1] || '';
    const takesToast = /(^|,)\s*(toast|sonnerToast)\s*(,|$)/.test(imported);
    checkIs(
      `${path.basename(file)} imports only the host from sonner, not toast`,
      file === 'src/utils/toast.js' || !takesToast,
      `imports: ${imported.trim()}`
    );
  });
checkIs('the push-toast helper plays the notification sound', /playSound\('notification'\)/.test(toastSource));
// Loading toasts re-fire on every progress tick, so the wrapper has to remember what it has already announced.
checkIs(
  'a refresh wave only makes one noise',
  /announcedLoading\.has\(id\)/.test(toastSource) && /announcedLoading\.add\(id\)/.test(toastSource)
);

checkIs('the schedule popovers are menus, not modals, and take no modal tone', !popoverSource.includes('modalSoundFor'));


// ---------------------------------------------------------------------------
// 7. The wiring
// ---------------------------------------------------------------------------
console.log('\n--- the wiring ---');
const appSource = readSource('src/App.jsx');
checkIs('App installs the delegated listeners', /useEffect\(\(\) => installUiSoundListeners\(\), \[\]\)/.test(appSource));
checkIs('App resolves the setting rather than assuming it', /soundsActiveFrom\(/.test(appSource));
checkIs('and hands the answer to the engine', /setSoundsEnabled\(soundsActive\)/.test(appSource));
checkIs('the app-wide toast wrapper is what App imports', /from '\.\/utils\/toast'/.test(appSource));
checkIs('the push toast uses the notification sound', /notificationToast\(/.test(appSource));
checkIs(
  'and the settings merge list carries the key, or the switch would appear not to stick',
  /'is_sounds_active',/.test(appSource)
);

// The listeners: six events, capture phase, all removed again on unmount.
['pointerdown', 'pointerup', 'pointercancel', 'dragstart', 'dragend', 'change'].forEach((event) => {
  checkIs(`the engine listens for ${event}`, new RegExp(`'${event}', tracker\\.`).test(soundSource));
});
checkIs(
  'in capture phase, so a handler that swallows the event cannot silence it',
  /addEventListener\(event, handler, true\)/.test(soundSource)
);
checkIs('and removes every one of them again', /removeEventListener\(event, handler, true\)/.test(soundSource));

// The save payload: the settings sender derives its fields from the switch catalog (utils/notificationPrefs
// enumerates the user_settings keys), and UserSettings names the key directly. A key missing from the sender
// (the trap the notification preferences hit) fails the notification-prefs harness rather than shipping. Here
// we pin the two halves that make the switch work end to end: App carries the key in its optimistic merge list
// (checked above), and the settings screen sends it by name - checked beside the screen below.


// The member's switch, and the station default behind it.
const userSettingsSource = readSource('src/components/MySettings.jsx');
checkIs('User Settings offers the switch', /label="Sound Effects"/.test(userSettingsSource));
checkIs('and the switch is sent by the settings screen', /is_sounds_active: String\(formData\.is_sounds_active\)/.test(userSettingsSource));
// ToggleSwitch.jsx is the definition (it reads the prop); a *usage* is what this is about, so it is excluded.
const onOffUsers = allSources.filter(
  (file) => !file.endsWith('ToggleSwitch.jsx') && /feedbackSound=/.test(readSource(file))
);
checkIs(
  'and it is the ONLY switch that speaks for itself',
  onOffUsers.length === 1 && onOffUsers[0].endsWith('MySettings.jsx'),
  onOffUsers.join(', ')
);
checkIs('and sends the decision on save', /is_sounds_active: String\(formData\.is_sounds_active\)/.test(userSettingsSource));
const toggleSource = readSource('src/components/ToggleSwitch.jsx');
checkIs(
  'the switch renders the sound it is about to make',
  /data-sound=\{soundDirective\}/.test(toggleSource) && /enabled \? 'sound-off' : 'sound-on'/.test(toggleSource)
);

const adminSettingsSource = readSource('src/components/admin/AdminSystemSettingsTab.jsx');
checkIs('the station default has a control, not just a column', /function SoundSettingsCard/.test(adminSettingsSource));
checkIs('saved under the same key', /adminSaveSystemSetting\('is_sounds_active'/.test(adminSettingsSource));
checkIs(
  'and listed as known, so it does not also appear in the generic settings list',
  /'is_sounds_active',/.test(adminSettingsSource)
);
checkIs(
  'the station default does NOT use the on/off sounds, which belong to the member switch',
  !/feedbackSound=/.test(adminSettingsSource)
);
checkIs('and its fallback when the sheet has no such row is TRUE', /is_sounds_active', 'true'/.test(adminSettingsSource));

// The minigame: its own sounds untouched, and opted out of the app's click.
const runnerSource = readSource('src/components/FirefighterRunner/FirefighterRunner.jsx');
checkIs('the runner opts the whole minigame out of the UI click', /data-sound="none"/.test(runnerSource));
// An IMPORT is what would change its behavior - the comment above data-sound mentions uiSounds by name, which is
// documentation rather than coupling.
checkIs(
  'and nothing in it imports the app sounds, so its own audio is untouched',
  !/^\s*import[^;]*from '[^']*(uiSounds|soundRules|utils\/toast)/m.test(runnerSource)
);
checkIs(
  'its jump/die/point audio is still its own',
  /jumpAudioRef/.test(runnerSource) && /dieAudioRef/.test(runnerSource) && /pointAudioRef/.test(runnerSource)
);

// ---------------------------------------------------------------------------
// 8. What is deliberately silent
// ---------------------------------------------------------------------------
// Backdrops that dismiss a modal or a drawer by clicking outside. These are divs with an onClick, and they are
// exempt on purpose: dismissing something is not an action on a control, and a click there would be noise with
// nothing to attach it to. Listed here so the decision is visible, and so a later one can be seen for what it is.
console.log('\n--- deliberate silence ---');
const silentBackdrops = [
  // These two now dismiss THROUGH the exit animation (`dismiss` from utils/motion, which adds the class and
  // then calls the callback) rather than straight to onClose - still silent, still a backdrop.
  ['src/components/ScheduleItemModal.jsx', 'onClick={dismiss}'],
  ['src/components/ShiftOfferModal.jsx', 'onClick={dismiss}'],
  ['src/components/Sidebar.jsx', 'setIsSidebarOpen(false)'],
  ['src/components/admin/AdminScheduleManagementTab.jsx', 'onClick={closePopover}'],
];
silentBackdrops.forEach(([file, marker]) => {
  checkIs(`${path.basename(file)} keeps its dismiss backdrop silent`, readSource(file).includes(marker));
});

// The roles in use that are controls. If one is added that the selector does not know, it will be silent and
// nothing else here would notice - so the selector has to grow with the app.
const interactiveRoles = [
  'button',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'switch',
  'checkbox',
  'radio',
];
const rolesInUse = new Set();
allSources.forEach((file) => {
  for (const match of readSource(file).matchAll(/role="([a-z]+)"/g)) rolesInUse.add(match[1]);
  for (const match of readSource(file).matchAll(/'\[role="([a-z]+)"\]'/g)) rolesInUse.add(match[1]);
});
const controlRoles = [...rolesInUse].filter((role) => interactiveRoles.includes(role)).sort();
controlRoles.forEach((role) => {
  checkIs(`the click selector covers role="${role}", which the app uses`, CLICKABLE_SELECTOR.includes(`[role="${role}"]`));
});
checkIs('and every interactive role in the app is covered', controlRoles.length > 0, 'found none, which cannot be right');

// The other half of the same rule: a control that the selector cannot see has to be marked by hand. The div pills
// and the empty slot cells are, and this asserts they stay that way - they are the controls most likely to be
// clicked in a whole admin session.
console.log('\n--- controls that are divs, and so had to be marked ---');
[
  ['src/components/admin/AdminScheduleManagementTab.jsx', 'the shift pill'],
  ['src/components/admin/AdminScheduleTemplatesTab.jsx', 'the template pill'],
].forEach(([file, label]) => {
  const source = readSource(file);
  checkIs(`${label} carries data-sound="click"`, /data-sound="click"/.test(source));
});
checkIs(
  'and the marked controls are only the ones that need it',
  (readSource('src/components/admin/AdminScheduleManagementTab.jsx').match(/data-sound="click"/g) || []).length === 3,
  'three: the shift pill, the event pill, the empty slot'
);

// ---------------------------------------------------------------------------
// 9. Teeth
// ---------------------------------------------------------------------------
// The wiring checks above are string matches on source. A string match that cannot fail is worse than no check at
// all, because it looks like coverage. Each of the most important ones is re-run against a copy of its file with
// the thing it describes taken out, and has to fail.
console.log('\n--- and the checks would notice if the wiring went away ---');
const mutated = (file, remove) => readSource(file).split(remove).join('/* removed by the mutation check */');

[
  {
    label: 'the click listener',
    file: 'src/utils/uiSounds.js',
    remove: "['pointerdown', tracker.onPointerDown],",
    assertion: (source) => new RegExp(`'pointerdown', tracker\\.`).test(source),
  },
  {
    label: 'the listener install in App',
    file: 'src/App.jsx',
    remove: 'useEffect(() => installUiSoundListeners(), []);',
    assertion: (source) => /useEffect\(\(\) => installUiSoundListeners\(\), \[\]\)/.test(source),
  },
  {
    label: 'the mute gate being fed',
    file: 'src/App.jsx',
    remove: 'setSoundsEnabled(soundsActive);',
    assertion: (source) => /setSoundsEnabled\(soundsActive\)/.test(source),
  },
  {
    label: 'the push notification sound',
    file: 'src/App.jsx',
    remove: 'notificationToast(message.title ||',
    assertion: (source) => /notificationToast\(/.test(source),
  },
  {
    label: 'the runner opting out',
    file: 'src/components/FirefighterRunner/FirefighterRunner.jsx',
    remove: 'data-sound="none"',
    assertion: (source) => /data-sound="none"/.test(source),
  },
].forEach(({ label, file, remove, assertion }) => {
  const before = readSource(file);
  const after = mutated(file, remove);
  checkIs(`${label}: the mutation changed the source`, after !== before, `could not find ${remove}`);
  checkIs(`${label}: the check fails without it`, assertion(after) === false);
  checkIs(`${label}: and passes with it`, assertion(before) === true);
});

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
