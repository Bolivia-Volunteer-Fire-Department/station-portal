// Verifies which notification switches a member is offered
// (utils/notificationPrefs).
//
// "New shift requests" is an approver-only switch: for anyone else it would be a
// control that does nothing, so it is hidden. The risk this pins is the toggle
// disappearing from the people who DO need it (or showing to everyone), so the
// TRUE-parsing is exercised the same way the sheet stores it.
//
// Run with: npm run verify:notification-prefs
import { readFileSync } from 'node:fs';
import { NOTIFICATION_TYPES, visibleNotificationTypes } from '../src/utils/notificationPrefs.js';
import { notificationPrefFields } from '../src/services/api.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${
      ok ? '' : ` (expected ${JSON.stringify(expected)})`
    }`
  );
};

const keys = (list) => list.map((type) => type.key);

const OWN_OFFER_KEYS = ['notify_offer_approved', 'notify_offer_declined'];
// Offered to everyone: an announcement can be aimed at any member, so no role gate applies.
const EVERYONE_KEYS = ['notify_announcements'];
const ALL_KEYS = ['notify_new_offer', ...OWN_OFFER_KEYS, ...EVERYONE_KEYS];

console.log('--- the catalog itself ---');
check('four switches exist', NOTIFICATION_TYPES.length, 4);
check('exactly one is approver-only', NOTIFICATION_TYPES.filter((t) => t.approverOnly).map((t) => t.key), [
  'notify_new_offer'
]);
check('every switch has a label and description', NOTIFICATION_TYPES.every((t) => t.label && t.description), true);
check('the approver-only one is "New shift requests"', NOTIFICATION_TYPES.find((t) => t.approverOnly)?.label, 'New shift requests');
// The station defaults card renders the station-facing wording, so every switch needs one.
check('every switch has a station-facing label too', NOTIFICATION_TYPES.every((t) => t.stationLabel && t.stationDescription), true);
check('the announcement switch says the app copy is unaffected', /still (appear|show)/i.test(NOTIFICATION_TYPES.find((t) => t.key === 'notify_announcements').stationDescription), true);

console.log('\n--- a role that CAN approve shifts sees everything ---');
check('boolean true', keys(visibleNotificationTypes(true)), ALL_KEYS);
check('the sheet string "TRUE"', keys(visibleNotificationTypes('TRUE')), ALL_KEYS);
check('a padded/lowercase " true "', keys(visibleNotificationTypes(' true ')), ALL_KEYS);

console.log('\n--- everyone else does NOT see the approver-only switch ---');
const WITHOUT_APPROVER = [...OWN_OFFER_KEYS, ...EVERYONE_KEYS];
check('boolean false', keys(visibleNotificationTypes(false)), WITHOUT_APPROVER);
check('undefined (role not loaded yet)', keys(visibleNotificationTypes(undefined)), WITHOUT_APPROVER);
check('null', keys(visibleNotificationTypes(null)), WITHOUT_APPROVER);
check('the sheet string "FALSE"', keys(visibleNotificationTypes('FALSE')), WITHOUT_APPROVER);
check('an empty cell', keys(visibleNotificationTypes('')), WITHOUT_APPROVER);
check('a numeric 0', keys(visibleNotificationTypes(0)), WITHOUT_APPROVER);
// The announcement switch is for everyone, including a member who cannot approve anything.
check('a member who cannot approve still gets the announcement switch', keys(visibleNotificationTypes(false)).includes('notify_announcements'), true);

console.log('\n--- the member\'s own offer switches are never hidden ---');
[true, false, 'TRUE', 'FALSE', undefined, null, '', 0].forEach((value) => {
  const shown = keys(visibleNotificationTypes(value));
  check(`both own-offer switches shown for ${JSON.stringify(value)}`, OWN_OFFER_KEYS.every((k) => shown.includes(k)), true);
});

console.log('\n--- the filter does not mutate the catalog ---');
visibleNotificationTypes(false);
check('catalog still has four entries', NOTIFICATION_TYPES.length, 4);

// Every switch must be savable. This is the drift guard for a bug that shipped: the Announcements
// switch was added to the catalog but not to the sender, so flipping it produced an empty
// settings payload and the member saw "Failed to save notification preference." The sender
// must enumerate the catalog, which the sections below assert.
// The SENDER — api.js's saveUserSettings payload. This is the list that actually caused the
// reported bug: the catalog was fixed while this copy was still missing the key, so nothing was
// sent and the member saw "No settings were supplied." The sender is checked here too.
console.log('\n--- the sender enumerates the catalog (no third hand-written list) ---');
const apiSource = readFileSync('src/services/api.js', 'utf8');
check('api.js imports the switch catalog', /import\s*\{[^}]*NOTIFICATION_TYPES[^}]*\}\s*from\s*'\.\.\/utils\/notificationPrefs'/.test(apiSource), true);
check('api.js spreads the derived fields into the save payload', /\.\.\.notificationPrefFields\(updatedSettings\)/.test(apiSource), true);

// No hand-written notify_ keys may remain in the payload builder: a literal there is the drift risk.
const saveBlock = /export const saveUserSettings[\s\S]*?\n\s*\}\);/.exec(apiSource);
check('the saveUserSettings call was found', !!saveBlock, true);
const literalKeys = saveBlock ? [...saveBlock[0].matchAll(/'(notify_[a-z_]+)'/g)].map((m) => m[1]) : [];
check('the payload builder hard-codes no notification key', literalKeys, []);

// And the derived fields really do carry every key, exercised by calling the builder the way
// saveUserSettings does.
const derived = notificationPrefFields({ notify_new_offer: 'TRUE', notify_announcements: '' });
keys(NOTIFICATION_TYPES).forEach((key) => {
  check(`the derived payload carries ${key}`, Object.prototype.hasOwnProperty.call(derived, key), true);
});
check('an unsent key stays undefined so the backend ignores it', derived.notify_offer_approved, undefined);
check('an empty string survives as "inherit"', derived.notify_announcements, '');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
