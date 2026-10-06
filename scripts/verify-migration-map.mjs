/**
 * Verifies the migration's MAPPING, which is the part that can be wrong in silence.
 *
 * What this exists for: the writer runs as the Admin SDK and bypasses firestore.rules, so nothing downstream catches a
 * mapping mistake. A password column that travels, an audience array that hides a document from everybody, a split
 * that puts the username on the public document - all of those write successfully and look fine until a screen is
 * empty or a secret is readable. So each decision gets an assertion, and the tab list is the real one from the live
 * spreadsheet, which is what will notice the day a tab is renamed.
 *
 * Run with: npm run verify:migration-map
 */
import { TAB_MAP, audienceKeysFrom, isOpenFrom, isSecretKey, mappedTabs, skippedTabs, slotKeyFrom, typedValue } from './migration-map.mjs';
import { planForTab, planForTabs } from './migrate-plan.mjs';
// The repair's decision, so the cure and the map cannot drift apart: see scripts/normalize-date-columns.mjs.
import { dateFixesFor } from './normalize-date-columns.mjs';

let failures = 0;
const checkIs = (label, condition, detail = '') => {
  const ok = condition === true;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: ${detail || 'expected true'}`}`);
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};

// The 25 tabs the reconnaissance pass found, in the sheet.
const REAL_TABS = [
  'users', 'certifications', 'certification_setup', 'document_checklist_items', 'document_signatures', 'documents',
  'id_migration', 'push_devices', 'roles', 'ranks', 'timeclock', 'shifts', 'schedule', 'events', 'schedule_offers',
  'schedule_templates', 'assignments', 'apparatus', 'availability', 'training', 'training_signatures',
  'announcements', 'system_settings', 'user_settings', 'system_log',
];

const mapped = mappedTabs();
check('every tab in the sheet is accounted for', REAL_TABS.filter((tab) => !mapped.includes(tab)), []);
check('and nothing is mapped that is not a tab', mapped.filter((tab) => !REAL_TABS.includes(tab)), []);
// Both are skipped on purpose: id_migration is history, and system_log's rows are development noise whose structure
// the rules already define (the owner's call - the log starts clean).
check('the two skips are the ones decided on', skippedTabs(), ['system_log', 'id_migration']);

// --- secrets -----------------------------------------------------------------------------------------------------

checkIs('a private key name is refused', isSecretKey('fcm_private_key'));
checkIs('so is anything called a token', isSecretKey('fcm_token'));
checkIs('a setting name is not', !isSecretKey('station_name'));
checkIs('nor is a column called notes', !isSecretKey('notes'));

// --- the audience array, which is where a quiet mistake hides people --------------------------------------------

const ranks = [
  { id: 'r1', rank_order: '1' },
  { id: 'r2', rank_order: '2' },
  { id: 'r3', rank_order: '3' },
];
check('nobody targeted means everybody', audienceKeysFrom({ row: {}, ranks }).keys, ['*']);
check('a role audience', audienceKeysFrom({ row: { role_id: 'officer' }, ranks }).keys, ['role:officer']);
check('a personal audience', audienceKeysFrom({ row: { user_id: 'u1' }, ranks }).keys, ['user:u1']);
// Announcements target the rank exactly; events target it and above (Code.gs: `ownOrder < required` excludes).
check('an announcement targets one rank', audienceKeysFrom({ row: { rank_id: 'r2' }, ranks }).keys, ['rank:r2']);
check(
  'an event targets that rank and above',
  audienceKeysFrom({ row: { rank_id: 'r2' }, ranks, rankAndAbove: true }).keys,
  ['rank:r2', 'rank:r3']
);
check('a rank nobody has is reported', audienceKeysFrom({ row: { rank_id: 'nope' }, ranks }).unknownRank, 'nope');
check(
  'two audience columns cannot be an array, and say so',
  audienceKeysFrom({ row: { role_id: 'officer', rank_id: 'r2' }, ranks }).notRepresentable,
  true
);

// --- the derived fields -------------------------------------------------------------------------------------------

check('an unassigned shift is open', isOpenFrom({ user_id: '' }), true);
check('an assigned one is not', isOpenFrom({ user_id: 'u1' }), false);
check('a slot key for a template occurrence', slotKeyFrom({ date_from: '2026-03-04', schedule_template_id: 't1' }), 'slot-2026-03-04-t1');
check('a row key for a real shift', slotKeyFrom({ schedule_id: 's9', date_from: '2026-03-04' }), 'row-s9');
check('and nothing when neither is there', slotKeyFrom({}), '');

// --- the splits, which is where a credential would travel ---------------------------------------------------------

const userRows = [
  {
    id: 'u1', user_name: 'jdoe', name: 'J Doe', password: 'hash', status: 'active',
    role_id: 'officer', rank_id: 'r2', is_change_password_on_login: 'TRUE',
  },
];
const usersPlan = planForTab({
  tab: 'users', spec: TAB_MAP.users, rows: userRows, ranks, knownIds: { users: new Set(['u1']) },
});
check('the public half keeps the roster fields', usersPlan.collections.users[0], {
  id: 'u1', name: 'J Doe', role_id: 'officer', rank_id: 'r2',
});
check('the private half keeps the username and the status', usersPlan.collections.users_private[0], {
  // A real boolean, not "TRUE": the rules compare `role.is_admin == true`, and the string cost every officer
  // permission in the database. See typedValue in migration-map.mjs.
  username: 'jdoe', status: 'active', is_change_password_on_login: true,
});
checkIs(
  'and the password is nowhere at all',
  // By key, not by substring: `is_change_password_on_login` legitimately contains the word "password".
  !('password' in usersPlan.collections.users[0]) &&
    !('password' in usersPlan.collections.users_private[0]) &&
    !JSON.stringify(usersPlan.collections).includes('hash')
);

// A role or a rank that is not in the sheet: the member keeps a row, signs in, and has no permissions or no rank on
// the roster. Nothing else in the mapping would notice, which is why these two are foreign keys.
const badRefs = planForTab({
  tab: 'users',
  spec: TAB_MAP.users,
  rows: userRows,
  ranks,
  knownIds: { users: new Set(['u1']), roles: new Set(['member']), ranks: new Set(['r1']) },
});
check('a user pointing at a role and a rank that do not exist is reported once, listing both', badRefs.problems.length, 1);
checkIs(
  'naming both the role and the rank',
  badRefs.problems.some((problem) => problem.includes('role_id=officer')) &&
    badRefs.problems.some((problem) => problem.includes('rank_id=r2'))
);

const assignmentRows = [{ id: 'a1', description: 'Engine', color: '#f00', icon: 'truck', rank_order_required: '2' }];
const assignmentPlan = planForTab({ tab: 'assignments', spec: TAB_MAP.assignments, rows: assignmentRows });
check('the public half is the calendar pill', Object.keys(assignmentPlan.collections.assignments[0]).sort(), [
  'color', 'description', 'icon', 'id', 'rank_order_required',
]);
check('and the private half is the note, empty', assignmentPlan.collections.assignment_private[0], { admin_note: '' });

// --- junk columns, foreign keys, and the settings split -----------------------------------------------------------

const clockRows = [
  { id: 'c1', user_id: 'u1', time_in: '2026-01-01 08:00:00', time_out: '', 'Column 1': '', 'Column 2': '' },
  { id: 'c2', user_id: 'ghost', time_in: '2026-01-02 08:00:00', time_out: '', 'Column 1': '', 'Column 2': '' },
];
const clockPlan = planForTab({
  tab: 'timeclock', spec: TAB_MAP.timeclock, rows: clockRows, knownIds: { users: new Set(['u1']) },
});
check('the junk columns do not travel', Object.keys(clockPlan.collections.timeclock[0]).sort(), [
  'id', 'time_in', 'time_out', 'user_id',
]);
check('they are noted, not flagged', clockPlan.notes.filter((n) => n.includes('junk')).length, 1);
checkIs(
  'a foreign key that does not resolve is reported',
  clockPlan.problems.some((p) => p.includes('user_id=ghost'))
);

const settingsRows = [
  { key: 'station_name', value: 'Bolivia VFD' },
  { key: 'fcm_service_account_private_key', value: 'BEGIN PRIVATE KEY' },
  { key: 'some_officer_setting', value: 'x' },
  { key: 'looks_like_a_secret', value: 'oops' },
  { key: 'an_api_key', value: 'sk-live' },
];
const settingsPlan = planForTab({ tab: 'system_settings', spec: TAB_MAP.system_settings, rows: settingsRows });
check('the public side takes the named public keys', settingsPlan.collections['settings/public'][0], {
  station_name: 'Bolivia VFD',
});
check('the private side takes the rest', settingsPlan.collections['settings/private'][0], {
  some_officer_setting: 'x',
});
checkIs(
  'the FCM credential is not copied',
  !JSON.stringify(settingsPlan.collections).includes('BEGIN PRIVATE KEY')
);
// The fcm_ namespace is build-time config, checked BEFORE the credential rule - so the FCM key is a note rather than
// a problem that has to be forced past on every run. It is also the ordering that keeps the key out of Firestore.
checkIs(
  'and is a note, not a problem to force past',
  settingsPlan.notes.some((note) => note.includes('fcm_service_account_private_key')) &&
    settingsPlan.problems.every((problem) => !problem.includes('fcm_'))
);
checkIs(
  'anything else that looks like a credential still is',
  settingsPlan.problems.some((problem) => problem.includes('looks_like_a_secret')) &&
    settingsPlan.problems.some((problem) => problem.includes('an_api_key')) &&
    settingsPlan.problems.every((problem) => !problem.includes('fcm_'))
);

// --- the whole-sheet pass ----------------------------------------------------------------------------------------

const fixture = REAL_TABS.map((title) => ({
  title,
  values: [[title === 'system_settings' ? 'key' : 'id'], ['r1']],
}));
const whole = planForTabs({ tabs: fixture });
check('no tab is left without a mapping', whole.problems.filter((p) => p.includes('no mapping')).length, 0);
checkIs('the totals count documents per collection', Object.keys(whole.totals).length > 10, JSON.stringify(whole.totals));

// A row with no id is the one row a migration must never invent an id for, so it is skipped and reported.
const noId = planForTabs({ tabs: [{ title: 'roles', values: [['id'], ['']] }] });
checkIs('and a row with no id is skipped rather than written', noId.problems.some((p) => p.includes('no id')));

// --- what the first real run of the plan taught the tooling ------------------------------------------------------

// A declared column is not a leak: both of these were refused as credentials before the declaration mattered, and
// both are the data of their own collection.
check('the password-change flag is not refused', usersPlan.problems.filter((p) => p.includes('REFUSED')).length, 0);
const devicePlan = planForTab({
  tab: 'push_devices',
  spec: TAB_MAP.push_devices,
  rows: [{ id: 'd1', user_id: 'u1', token: 'fcm-abc', device_label: 'phone' }],
});
check('a device token travels, since it is the whole point of the collection', devicePlan.collections.push_devices[0], {
  id: 'd1', user_id: 'u1', token: 'fcm-abc', device_label: 'phone',
});
check('and is not refused', devicePlan.problems.filter((p) => p.includes('REFUSED')).length, 0);

// An undeclared column that looks like a credential still is refused, and never reaches a document.
const leaky = planForTab({
  tab: 'roles',
  spec: TAB_MAP.roles,
  rows: [{ id: 'r1', description: 'Officer', api_key: 'sk-live-123' }],
});
checkIs('an undeclared api key is refused', leaky.problems.some((p) => p.includes('REFUSED') && p.includes('api_key')));
checkIs('and does not reach the document', !JSON.stringify(leaky.collections).includes('sk-live'));

// system_log: a row-counter id, so the writer mints one per row instead of overwriting 35 of them.
const logRows = [
  { id: '2', timestamp: '2026-01-01 08:00:00', user_id: 'mwills', action: 'LOGIN', details: '' },
  { id: '2', timestamp: '2026-01-02 08:00:00', user_id: 'crave', action: 'LOGIN', details: '' },
];
const logPlan = planForTab({
  tab: 'system_log', spec: TAB_MAP.system_log, rows: logRows, knownIds: { users: new Set(['u1']) },
});
check('a duplicated row-counter id is not reported as a duplicate', logPlan.problems.filter((p) => p.includes('more than once')).length, 0);
checkIs('the writer is told to mint ids', logPlan.notes.some((n) => n.includes('mints an id')));
checkIs(
  'and a stale username is history rather than a broken reference',
  logPlan.notes.some((n) => n.includes('historical row(s)')) &&
    logPlan.problems.filter((p) => p.includes('does not resolve')).length === 0
);

// The distinction the first run taught: a decision is not a problem. The plan reports both, separately, because 107
// lines for four findings is a report nobody reads to the end.
checkIs('nothing decided is also a problem', !logPlan.notes.some((n) => logPlan.problems.includes(n)));

// --- the typing, which is what made the first routed read fail ---------------------------------------------------

// The spreadsheet stores TRUE and FALSE as strings; firestore.rules compares booleans. Every officer permission in
// the database was read as not granted because of this, and it surfaced as permission-denied on the member payload -
// a symptom with nothing to do with the cause.
check('a boolean column becomes a real boolean', typedValue('is_admin', 'TRUE'), true);
check('and the other spelling of it', typedValue('can_edit_users', 'true'), true);
check('FALSE becomes false, not the string', typedValue('is_admin', 'FALSE'), false);
check('and a blank cell is false, which is what it meant', typedValue('is_renewable', ''), false);
check('a number the app compares becomes a number', typedValue('rank_order', '3'), 3);
check('and conflict detection gets one too', typedValue('row_version', '12'), 12);
check('while a date stays the string the readers expect', typedValue('date_from', '2026-03-04'), '2026-03-04');
// DATES ARE KEYS THE APP COMPARES AND QUERIES, not the sheet's display text - and this is the bug the DATE_COLUMNS list exists
// for. `where('date_from', '>=', '2026-09-01')` is a string range and `'3/6/2026'` sorts AFTER `'2026-09-30'`, so a row dated
// that way is excluded from every month a screen asks for: an empty calendar, and nothing anywhere to explain it.
check('a display-formatted date becomes a key', typedValue('date_from', '3/6/2026'), '2026-03-06');
// A DATE COLUMN IS NOT NECESSARILY DAY-ONLY. `parseSheetDateKey` is a day parser with an UNANCHORED date regex, so it
// takes `'2026-11-10 18:00'` apart and hands back `'2026-11-10'` - the time silently gone. That is how every migrated
// event lost its hours and drew as "00:00 - 00:01". A value carrying a time keeps it; the date half is still normalised,
// so a display date WITH a time is fixed rather than passed through.
check('a datetime keeps its time', typedValue('date_from', '2026-11-10 18:00'), '2026-11-10 18:00');
check('and a display date with a time has its date half fixed and its time kept', typedValue('date_from', '11/10/2026 18:00'), '2026-11-10 18:00');
// AND THE HOUR IS ZERO-PADDED, because the app's inputs reject anything else: `<input type="datetime-local">` and
// `<input type="time">` both sanitize a value to EMPTY unless the hour is two digits, and `AdminEventsTab` feeds these
// fields straight to them. Two cells in the events tab hold `8:00`, so passing that through verbatim would restore a
// time the officer's own edit form then draws as a blank field.
check("and a single-digit hour is padded, because the app's time inputs reject anything else", typedValue('date_from', '2026-09-26 8:00'), '2026-09-26 08:00');
check('padded in the display form as well', typedValue('date_from', '9/26/2026 8:05'), '2026-09-26 08:05');
check('and an already-padded hour is unchanged by it', typedValue('date_from', '2026-09-26 08:00'), '2026-09-26 08:00');
check('while a meridiem is left exactly as it arrived rather than converted', typedValue('date_from', '9/26/2026 8:00 PM'), '2026-09-26 8:00 PM');

check('including seconds, and a meridiem suffix', typedValue('date_from', '11/10/2026 6:30 PM'), '2026-11-10 6:30 PM');
// The repair walks the same function, so a datetime it has already written survives a second pass untouched - which is
// what makes running it twice safe.
check('and a value that is already a key with a time is left alone', typedValue('date_to', '2026-11-10 18:00'), '2026-11-10 18:00');
check('while a day-only value is still normalised', typedValue('date_to', '11/10/2026'), '2026-11-10');
check('the sloppy hyphen form becomes one too', typedValue('date_to', '2026-3-6'), '2026-03-06');
check('an ISO instant becomes the day it falls on AT THE STATION', typedValue('effective_date', '2026-03-06T04:00:00.000Z'), '2026-03-05');
check('and an unreadable date is left EXACTLY as it was', typedValue('date_from', 'sometime in March'), 'sometime in March');
checkIs('while a datetime is not in the list at all, so its time survives', typedValue('time_in', '2026-03-06 07:55') === '2026-03-06 07:55');
// THE REPAIR'S DECISION, driven from the map's own rules: what a document should hold, and an EMPTY answer when nothing needs
// writing - which is what makes a second run silent, and what lets this be a check as well as a cure.
check('a document already keyed needs nothing', dateFixesFor({ date_from: '2026-03-06' }), {});
check('one holding display text gets the keys', dateFixesFor({ date_from: '3/6/2026', date_to: '3/7/2026' }), {
  date_from: '2026-03-06',
  date_to: '2026-03-07',
});
// An OFFER's `slot_key` is DERIVED from its date, so it was derived from the unreadable value - and a key built from
// `3/6/2026` matches nothing the calendar computes. The derivation therefore runs against the PATCHED row, not the stored one.
check(
  'and a derived column is re-derived from the corrected date',
  dateFixesFor({ date_from: '3/6/2026', schedule_template_id: 't1', slot_key: 'slot-3/6/2026-t1' }, { slot_key: slotKeyFrom }),
  { date_from: '2026-03-06', slot_key: 'slot-2026-03-06-t1' }
);
check('a value the parser cannot read is left alone rather than blanked', dateFixesFor({ date_from: 'whenever' }), {});
check('and a column the document does not carry is not invented', dateFixesFor({ title: 'no dates here' }), {});
check(
  'a training gets a day key from its free-text date',
  dateFixesFor({ date: '3/6/2026' }, TAB_MAP.training.derive),
  { date_key: '2026-03-06' }
);
check('and one whose date cannot be read gets none', dateFixesFor({ date: 'soon' }, TAB_MAP.training.derive), {});
check('and so does free text', typedValue('description', 'Engine'), 'Engine');
const roleRows = [{ id: 'officer', description: 'Officer', is_admin: 'TRUE', can_edit_users: 'TRUE', can_view_my_schedule: 'FALSE' }];
const rolePlan = planForTab({ tab: 'roles', spec: TAB_MAP.roles, rows: roleRows });
check('and a role document carries booleans, which is what the rules read', rolePlan.collections.roles[0], {
  id: 'officer', description: 'Officer', is_admin: true, can_edit_users: true, can_view_my_schedule: false,
});

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
