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
