// System-settings helpers, used by the administration settings tab and by its verifier.
//
// They live outside the component for two reasons. `getSettingValue` is a lookup that every settings card
// needs, and the loading messages are pure list arithmetic over ten fixed keys - which is worth testing on
// its own, because the bug they had could not be seen by rendering them (see updateLoadingMessages).

// One setting's value, or `fallback` when the sheet has no such row. Tolerant of a missing list, a row with
// no key, and a key that arrived padded with whitespace - this reads a spreadsheet somebody may have edited
// by hand, where a trailing space is invisible.
export const getSettingValue = (systemSettings, key, fallback = '') => {
  const rows = Array.isArray(systemSettings) ? systemSettings : [];
  const setting = rows.find((row) => String(row?.key ?? '').trim() === String(key).trim());
  return setting?.value ?? fallback;
};

// The ten loading messages are stored as ten separate settings rather than one delimited value, so a blank
// one is simply an empty setting and adding a message later needs no data migration.
export const LOADING_MESSAGE_COUNT = 10;
export const LOADING_MESSAGE_KEYS = Array.from(
  { length: LOADING_MESSAGE_COUNT },
  (_, index) => `loading_message${index}`
);

// The editable rows, always all ten and always in key order, whatever order the sheet returned them in.
//
// Every row exists even when the sheet has no such key: a field that only appears once a value is stored
// could never be used to add the first message.
export const getLoadingMessages = (systemSettings) =>
  LOADING_MESSAGE_KEYS.map((key, index) => ({
    // The key IS the identity. Deriving one from an index - or comparing a parsed id against `map`'s index -
    // is what broke this card: the id's tail is a STRING ("0"), the index is a NUMBER, so the comparison was
    // never true, no row was ever replaced, and every keystroke was undone by the next render.
    id: key,
    index,
    key,
    label: `Message ${index}`,
    value: String(getSettingValue(systemSettings, key, '') ?? ''),
  }));

// One field edited, by id. Returns a NEW list and never mutates: the untouched rows are returned as they are,
// and a value can never land on the wrong row.
// One row of a CARD OF IDENTICAL FIELDS edited, by id - that field's value changed, the rest returned as they are.
// Shared by the loading messages and by the chief's sayings, which are the same shape of thing: a fixed list of
// settings with a label each, saved together.
export const updateSettingRow = (rows, id, value) =>
  (Array.isArray(rows) ? rows : []).map((row) =>
    row.id === id ? { ...row, value: String(value ?? '') } : row
  );

// What such a card writes: every key, in order, INCLUDING the blank ones - clearing a field is a save too, and
// skipping blanks would leave the old text in the store with no way to remove it from this screen.
//
// Returning the pairs is what makes the save testable without a browser: the value a member typed is asserted
// against the key it goes to, rather than the two being joined by an index inside an event handler.
export const settingRowSavePlan = (rows) =>
  (Array.isArray(rows) ? rows : []).map((row) => ({
    key: row.key,
    value: String(row.value ?? ''),
    label: row.label,
  }));

// The two cards that are that shape, named as their screens and harnesses have always named them. Aliases rather than
// second implementations, because the arithmetic is identical and two copies of it would eventually disagree about
// what an empty field means.
export const updateLoadingMessages = updateSettingRow;
export const loadingMessageSavePlan = settingRowSavePlan;
export const updateBossSayings = updateSettingRow;
export const bossSayingSavePlan = settingRowSavePlan;

// THE CHIEF'S SAYINGS: five lines the floating head comes out with between fireball blasts, in the runner's boss
// level. Five separate settings rather than one delimited value, for the same reason the loading messages are separate:
// a blank one is simply an empty setting, and adding a sixth later needs no migration.
export const BOSS_SAYING_COUNT = 5;
export const BOSS_SAYING_KEYS = Array.from(
  { length: BOSS_SAYING_COUNT },
  (_, index) => `boss_saying${index}`
);

// What the chief says on a station that has never configured any, so the bubbles exist the first time somebody reaches
// the boss rather than looking broken until an administrator finds the card. Short lines, because they are read in the
// second or two they are on screen, in the voice of a fire chief who is enjoying himself - the head is a cartoon, and
// the station may well have a chief who plays it.
export const DEFAULT_BOSS_SAYINGS = [
  'Nice dodge. Try it again.',
  'My grandmother ducks faster.',
  'Is that all you have?',
  'Stay down, rookie.',
  'You missed one...',
];

// The five editable rows, always all five and always in key order, whatever order the backend returned them in. A row
// exists even when the station has no such key - a field that only appears once a value is stored could never be used
// to add the first one - and an UNSET key shows its DEFAULT, because that is what the boss is actually saying.
export const getBossSayings = (systemSettings) =>
  BOSS_SAYING_KEYS.map((key, index) => ({
    // The key IS the identity, as it is for a loading message: matched by id and never by position, so a keystroke
    // survives the next render.
    id: key,
    index,
    key,
    label: `Saying ${index + 1}`,
    value: String(getSettingValue(systemSettings, key, DEFAULT_BOSS_SAYINGS[index] || '') ?? ''),
  }));

// The five lines as the RUNNER wants them: the ones with something in them, in key order, and nothing else.
//
// THE TWO KINDS OF EMPTY ARE DIFFERENT, and this is the whole of the function. A key the station has never set falls
// back to its default, so the boss speaks on day one. A key that HAS a value and it is blank is a deliberate silence
// and is left out. Blanking all five is therefore how an administrator turns the bubbles off - the honest reading of an
// empty box, rather than a station arguing with its own settings.
export const bossSayingsFrom = (systemSettings) => {
  const rows = Array.isArray(systemSettings) ? systemSettings : [];
  return BOSS_SAYING_KEYS.map((key, index) => {
    const row = rows.find((candidate) => String(candidate?.key ?? '').trim() === key);
    if (row === undefined) return String(DEFAULT_BOSS_SAYINGS[index] || '').trim();
    return String(row?.value ?? '').trim();
  }).filter((line) => line !== '');
};

// Which system settings are PUBLIC, in one place, because three things have to agree about it: the migration that
// filled `settings/public` and `settings/private`, that migration's plan (which prints which side each key lands on),
// and the app's own settings saves.
//
// PUBLIC IS BY NAMING AND PRIVATE IS THE DEFAULT, so a setting added later is officer-readable until somebody decides
// it belongs to everyone - the safe way round for a document any signed-in member may read. Every key below is public
// because the BROWSER reads it: the loading messages, the theme and the time format are drawn on screen, and the clock
// location has to be readable or the fence cannot be checked at all (see clockLocation.js).
export const PUBLIC_SETTING_KEYS = [
  'station_name',
  'department_name',
  ...LOADING_MESSAGE_KEYS,
  'required_clock_latitude',
  'required_clock_longitude',
  'gps_margin_of_error',
  // The rounding step, because a MEMBER'S OWN Clock History rounds its hours by it - the screen cannot honour a setting it
  // cannot read - and the reconciliation report reads the same public document server-side. Written here as a literal
  // rather than imported from utils/clockRounding, which would be a cycle: that module reads settings through this one.
  // scripts/verify-firestore-writes pins the two names together so they cannot drift.
  'clock_hours_rounding',
  'session_timeout',
  // The training SIGNING WINDOW, because the MEMBER'S OWN Training module reads it to close the Sign button on a training
  // whose date is too far back - and a screen cannot honour a setting it may not read. Written as a literal rather than
  // imported from utils/training, which reads settings through this module (the same cycle the rounding key above avoids);
  // scripts/verify-training pins the two names together so they cannot drift.
  'training_signature_window_days',
  // THE PAY PERIOD, both halves public: the LENGTH is the window the member's own Clock History opens on - a screen cannot
  // honour a setting it may not read - and the day a period STARTS is a fact about the station rather than about the person
  // looking. Literals rather than imports from utils/payPeriod, which reads settings through this module (the same cycle the
  // two keys above avoid); scripts/verify-clock-logs pins the names together so they cannot drift.
  'pay_period_days',
  'pay_week_start',
  // THE CHIEF'S SAYINGS, public because the RUNNER draws them: a member's own game cannot read a private setting, and
  // the bubbles would simply never appear. Nothing in them is station business - they are five lines an administrator
  // writes for a cartoon head to say.
  ...BOSS_SAYING_KEYS,
  'is_dark_mode',
  'time_format',
];

// Which document a setting belongs in: 'public' or 'private'.
export const settingSide = (key) =>
  PUBLIC_SETTING_KEYS.includes(String(key || '').trim()) ? 'public' : 'private';
