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
export const updateLoadingMessages = (messages, id, value) =>
  (Array.isArray(messages) ? messages : []).map((message) =>
    message.id === id ? { ...message, value: String(value ?? '') } : message
  );

// What a save writes: every key, in order, INCLUDING the blank ones - clearing a message is a save too, and
// skipping blanks would leave the old text in the sheet with no way to remove it from this screen.
//
// Returning the pairs is what makes the save testable without a browser: the value a member typed is asserted
// against the key it goes to, rather than the two being joined by an index inside an event handler.
export const loadingMessageSavePlan = (messages) =>
  (Array.isArray(messages) ? messages : []).map((message) => ({
    key: message.key,
    value: String(message.value ?? ''),
    label: message.label,
  }));

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
  'session_timeout',
  'is_dark_mode',
  'time_format',
  // Not a secret: a POLICY flag, and the client has to read it to know which way to write. Off unless an officer sets
  // it, which is the default in docs/MIGRATION_MAP.md: the straightforward admin saves go straight to Firestore, and
  // nothing is audited for them because Firestore has no audit log. Switch this on and those saves are routed through
  // a callable that writes an audit row first - slower, always accountable.
  'audit_client_writes',
];

// Which document a setting belongs in: 'public' or 'private'.
export const settingSide = (key) =>
  PUBLIC_SETTING_KEYS.includes(String(key || '').trim()) ? 'public' : 'private';
