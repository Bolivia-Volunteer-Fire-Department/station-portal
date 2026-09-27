/**
 * Verifies per-device push registration.
 *
 * This exists because the previous design stored a single `user_settings.fcm_token` per member, which
 * produced two bugs that both looked like the app lying:
 *
 *   * a second device OVERWROTE the first one's token, so the first silently stopped receiving;
 *   * "turn off" on a device that had never been enabled cleared the member's token - the OTHER
 *     device's - so it reported success while breaking the one that worked.
 *
 * The backend functions are extracted from Code.gs and run against a fake sheet, so the rules are
 * exercised rather than described. Run with: npm run verify:push-devices
 */
import { readFileSync } from 'node:fs';
import { deviceLabelFromUserAgent } from '../src/utils/pushNotifications.js';

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
// For the wiring checks below, where the interesting thing is a condition over source text rather than a
// value that can be printed.
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const apiSource = readFileSync('src/services/api.js', 'utf8');
const settingsSource = readFileSync('src/components/UserSettings.jsx', 'utf8');
const adminSource = readFileSync('src/components/admin/AdminNotificationsTab.jsx', 'utf8');

const extract = (name) => {
  const start = codeSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Code.gs has no function ${name}`);
  let depth = 0;
  for (let i = codeSource.indexOf('{', start); i < codeSource.length; i++) {
    if (codeSource[i] === '{') depth++;
    else if (codeSource[i] === '}') {
      depth--;
      if (depth === 0) return codeSource.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
};

const constSource = (name) => {
  const match = new RegExp(`^const ${name} = [^;]+;`, 'm').exec(codeSource);
  if (!match) throw new Error(`Code.gs has no const ${name}`);
  return match[0];
};

// The real functions, with the timestamp helper stubbed: it is not what is under test, and a fixed
// value makes "the stamp was refreshed" assertable.
const HARNESS = `
  ${constSource('PUSH_DEVICE_SHEET')}
  ${constSource('PUSH_DEVICE_HEADERS')}
  ${extract('getSheetData')}
  ${extract('newRowId')}
  ${extract('userSettingsIndex')}
  ${extract('pushDeviceSheet')}
  ${extract('pushDeviceRows')}
  ${extract('pushTokenIndex')}
  ${extract('pushTokensForUser')}
  ${extract('pushDeviceOwnerLabel')}
  ${extract('clearLegacyPushToken')}
  ${extract('pushDeviceOwner')}
  ${extract('isTruthyValue')}
  ${extract('pushDisabledForUser')}
  ${extract('setPushDisabledForUser')}
  ${extract('disablePushForUser')}
  ${extract('registerPushDevice')}
  ${extract('deletePushTokens')}
  ${extract('pushDeviceCountByUser')}
  return { registerPushDevice, deletePushTokens, pushTokenIndex, pushTokensForUser, pushDeviceCountByUser, pushDeviceRows, pushDeviceOwner, pushDeviceOwnerLabel, pushDisabledForUser, setPushDisabledForUser, disablePushForUser, PUSH_DEVICE_SHEET };
`;

// A sheet good enough for these functions: everything they touch is implemented, and every write is
// recorded as the real array so the assertions read like the sheet.
class FakeSheet {
  constructor(rows = []) {
    this.rows = rows;
    this.writes = 0;
  }
  getDataRange() {
    return { getValues: () => this.rows.map((row) => row.slice()) };
  }
  getRange(row, col) {
    const rows = this.rows;
    return {
      getValue: () => rows[row - 1][col - 1],
      setValue: (value) => {
        rows[row - 1][col - 1] = value;
        this.writes++;
      },
    };
  }
  getLastRow() {
    return this.rows.length;
  }
  appendRow(values) {
    this.rows.push(values.slice());
    this.writes++;
  }
  deleteRow(index) {
    this.rows.splice(index - 1, 1);
    this.writes++;
  }
}

const DEVICE_HEADERS = ['id', 'user_id', 'token', 'device_label', 'updated_at'];

const makeBackend = ({ devices = [], settings = [], members = [] } = {}) => {
  const sheets = {
    push_devices: new FakeSheet([DEVICE_HEADERS.slice(), ...devices.map((d) => d.slice())]),
    // The members sheet is what turns an owner id into a name the settings card can show.
    users: new FakeSheet([['id', 'name', 'user_name'], ...members.map((m) => m.slice())]),
    user_settings: new FakeSheet([
      // `is_push_disabled` is the column the administrator's switch writes; the real sheet grows it on
      // first use (upsertUserSettingsColumns adds anything it is asked to write), so a harness that did
      // not have it would be testing a sheet this app never sees.
      ['user_id', 'fcm_token', 'is_push_disabled'],
      ...settings.map((s) => s.slice()),
    ]),
  };
  const ss = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => {
      sheets[name] = new FakeSheet([]);
      return sheets[name];
    },
  };

  const Logger = { log: () => {} };
  const getEasternTimestamp = () => '2026-01-01 12:00';
  // Mirrors Code.gs's upsertUserSettingsColumns: it grows the header row for anything it is asked to
  // write, and creates the member's row when they have none. Both matter to these tests - `is_push_disabled`
  // is a column that exists only once the administrator's switch is first used, and a member who has
  // devices but no settings row is exactly the member an administrator is most likely to switch off.
  const upsertUserSettingsColumns = (spreadsheet, userId, values) => {
    const sheet = spreadsheet.getSheetByName('user_settings');
    if (!sheet || !sheet.rows.length) return false;

    const headers = sheet.rows[0];
    const idCol = headers.indexOf('user_id') !== -1 ? headers.indexOf('user_id') : headers.indexOf('id');
    if (idCol === -1) return false;

    Object.keys(values).forEach((key) => {
      if (headers.indexOf(key) === -1) headers.push(key);
    });

    for (let i = 1; i < sheet.rows.length; i++) {
      if (String(sheet.rows[i][idCol]).trim() !== String(userId).trim()) continue;
      Object.keys(values).forEach((key) => {
        const col = headers.indexOf(key);
        if (col !== -1) sheet.rows[i][col] = values[key];
      });
      return true;
    }

    const newRow = headers.map((key) => (values[key] !== undefined ? values[key] : ''));
    newRow[idCol] = String(userId).trim();
    sheet.rows.push(newRow);
    return true;
  };

  const backend = new Function(
    'Logger',
    'getEasternTimestamp',
    'upsertUserSettingsColumns',
    // A new device row is identified by a UUID (see newRowId in Code.gs), so the harness supplies one.
    'Utilities',
    HARNESS
  )(Logger, getEasternTimestamp, upsertUserSettingsColumns, {
    getUuid: (() => {
      let issued = 0;
      return () => {
        issued++;
        return `00000000-0000-4000-8000-${String(issued).padStart(12, '0')}`;
      };
    })(),
  });

  return { backend, ss, sheets };
};

const deviceTokens = (sheets) => {
  const rows = sheets.push_devices.rows;
  const headers = rows[0].map(String);
  const userCol = headers.indexOf('user_id');
  const tokenCol = headers.indexOf('token');
  return rows.slice(1).map((row) => `${row[userCol]}:${row[tokenCol]}`);
};

console.log('--- a member with two devices gets two rows ---');
// The bug, stated as a test: the second device must not replace the first.
{
  const { backend, ss, sheets } = makeBackend();
  backend.registerPushDevice(ss, 'u1', 'token-computer', 'Chrome on Mac');
  backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');

  check('both devices are stored', deviceTokens(sheets), ['u1:token-computer', 'u1:token-phone']);
  check('and both are delivered to', backend.pushTokensForUser(ss, 'u1'), ['token-computer', 'token-phone']);
  check('the admin count sees two', backend.pushDeviceCountByUser(ss), { u1: 2 });
}

console.log('\n--- registering twice is idempotent ---');
// Opening the settings card repeatedly re-registers the same device; it must not accumulate rows.
{
  const { backend, ss, sheets } = makeBackend();
  backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');
  backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');
  backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');

  check('one row, not three', deviceTokens(sheets), ['u1:token-phone']);
  const headers = sheets.push_devices.rows[0];
  check('and the label is refreshed', sheets.push_devices.rows[1][headers.indexOf('device_label')], 'Safari on iPhone');
  check('with a timestamp', sheets.push_devices.rows[1][headers.indexOf('updated_at')], '2026-01-01 12:00');
}

console.log('\n--- a shared device does not change hands by itself ---');
// The bug this replaces: the row was re-pointed at whoever registered. Since the settings card registers
// whenever it finds a subscription, SIGNING IN on a shared computer handed it over - the member who set
// it up went on believing their alerts arrived there, and the member who signed in owned a device they
// had never enabled, with a test push to them landing on the first member's desk.
{
  const { backend, ss, sheets } = makeBackend({
    members: [['u1', 'Kayla Nguyen', 'kayla'], ['u2', 'Sam Okafor', 'sam']],
  });
  backend.registerPushDevice(ss, 'u1', 'token-tablet', 'Chrome on Android');
  const refused = backend.registerPushDevice(ss, 'u2', 'token-tablet', 'Chrome on Android');

  check('the row stays with the member who set it up', deviceTokens(sheets), ['u1:token-tablet']);
  check(
    'and the refusal says whose it is',
    [refused.ok, refused.reason, refused.ownerLabel],
    [false, 'owned_by_another_member', 'Kayla Nguyen']
  );
  check('the second member gains nothing', backend.pushTokensForUser(ss, 'u2'), []);
  check('and the first still receives', backend.pushTokensForUser(ss, 'u1'), ['token-tablet']);
}
{
  // The move is still possible - a station computer really does change hands - but only said out loud.
  const { backend, ss, sheets } = makeBackend({
    members: [['u1', 'Kayla Nguyen', 'kayla'], ['u2', 'Sam Okafor', 'sam']],
  });
  backend.registerPushDevice(ss, 'u1', 'token-tablet', 'Chrome on Android');
  const moved = backend.registerPushDevice(ss, 'u2', 'token-tablet', 'Chrome on Android', { transfer: true });

  check('an explicit transfer re-points the row', deviceTokens(sheets), ['u2:token-tablet']);
  check(
    'and reports who it came from, so it can be logged',
    [moved.ok, moved.transferredFrom, moved.transferredFromLabel],
    [true, 'u1', 'Kayla Nguyen']
  );
  check('u1 has nothing left', backend.pushTokensForUser(ss, 'u1'), []);
  check('and u2 has the device', backend.pushTokensForUser(ss, 'u2'), ['token-tablet']);
}
{
  // Registering your OWN device again is a refresh, not a transfer - it happens on every settings open.
  const { backend, ss } = makeBackend({ members: [['u1', 'Kayla Nguyen', 'kayla']] });
  backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');
  const again = backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');

  check('re-registering your own device is a plain refresh', [again.ok, again.transferredFrom], [true, '']);
}
{
  // A device enabled before the push_devices sheet existed also lives in the legacy column, which is
  // still read. If a transfer left it there, ONE browser would deliver for BOTH members at once.
  const { backend, ss, sheets } = makeBackend({
    members: [['u1', 'Kayla Nguyen', 'kayla'], ['u2', 'Sam Okafor', 'sam']],
    settings: [['u1', 'token-tablet']],
  });
  backend.registerPushDevice(ss, 'u1', 'token-tablet', 'Chrome on Android');
  backend.registerPushDevice(ss, 'u2', 'token-tablet', 'Chrome on Android', { transfer: true });

  check('the previous owner\u2019s legacy token is cleared', sheets.user_settings.rows[1][1], '');
  check('so only the new owner receives', backend.pushTokensForUser(ss, 'u1'), []);
}

console.log('\n--- the card can ask whose this computer is ---');
{
  const { backend, ss } = makeBackend({
    members: [['u1', 'Kayla Nguyen', 'kayla'], ['u2', '', 'sam']],
    devices: [['1', 'u1', 'shared-token', 'Chrome on Mac', '']],
  });

  check('a registered token names its owner', backend.pushDeviceOwner(ss, 'shared-token'), {
    user_id: 'u1',
    name: 'Kayla Nguyen',
    device_label: 'Chrome on Mac',
  });
  // An empty display name falls back to the sign-in name rather than showing nothing.
  check('a member with no display name still reads well', backend.pushDeviceOwnerLabel(ss, 'u2'), 'sam');
  check('a token with no row names nobody', backend.pushDeviceOwner(ss, 'never-registered'), null);
  check('and an empty token does not throw', backend.pushDeviceOwner(ss, ''), null);
  check('nor does an id with no member row', backend.pushDeviceOwnerLabel(ss, 'deleted-member'), 'another member');
}

console.log('\n--- turning off ONE device leaves the other alone ---');
// The reported bug: "turn off" cleared the member's single token, which was the OTHER device's, so a
// device that was never on broke the one that was.
{
  const { backend, ss, sheets } = makeBackend({
    devices: [
      ['1', 'u1', 'token-computer', 'Chrome on Mac', '2026-01-01 09:00'],
      ['2', 'u1', 'token-phone', 'Safari on iPhone', '2026-01-01 09:05'],
    ],
  });

  check('the phone is removed', backend.deletePushTokens(ss, ['token-phone'], 'u1'), 1);
  check('the computer is untouched', deviceTokens(sheets), ['u1:token-computer']);
  check('and still receives', backend.pushTokensForUser(ss, 'u1'), ['token-computer']);
}

console.log('\n--- a dead-token prune cannot reach another member ---');
// The blast radius of deleting on a token match, bounded by the member the send was FOR. This is the
// only path that keeps the bound (see the unregister section below): a prune has no session behind it
// and no device to prove anything with, just a token FCM refused for one recipient.
{
  const { backend, ss, sheets } = makeBackend({
    devices: [
      ['1', 'u1', 'shared-token', 'Chrome on Mac', ''],
      ['2', 'u2', 'shared-token', 'Chrome on Mac', ''],
    ],
  });

  check('nothing is removed for the wrong member', backend.deletePushTokens(ss, ['shared-token'], 'u3'), 0);
  check('and both rows survive', deviceTokens(sheets), ['u1:shared-token', 'u2:shared-token']);
}

console.log('\n--- an administrator can turn a member off, and it stays off ---');
// The button an administrator presses. Two halves that fail in different ways: forgetting the devices
// stops delivery NOW, and the flag stops the member's own browser from registering itself again the next
// time their User Settings is opened - which, without the flag, would silently undo the whole thing.
{
  const { backend, ss, sheets } = makeBackend({
    members: [['u1', 'Kayla Nguyen', 'kayla'], ['u2', 'Sam Okafor', 'sam']],
    devices: [
      ['1', 'u1', 'token-phone', 'Safari on iPhone', ''],
      ['2', 'u1', 'token-computer', 'Chrome on Mac', ''],
      ['3', 'u2', 'token-tablet', 'Chrome on Android', ''],
    ],
  });

  const off = backend.disablePushForUser(ss, 'u1');

  check('every device is forgotten', backend.pushTokensForUser(ss, 'u1'), []);
  check('and the admin is told how many', off.devices, 2);
  check('so the count they see is zero', backend.pushDeviceCountByUser(ss), { u2: 1 });
  check('and the member reads as switched off', backend.pushDisabledForUser(ss, 'u1'), true);

  // The load-bearing half: the browser still holds a subscription, and it registers itself on sight.
  const putBack = backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone');
  check('a browser cannot put itself back', [putBack.ok, putBack.reason], [false, 'disabled_by_admin']);
  check('and nothing is stored', deviceTokens(sheets), ['u2:token-tablet']);

  // Nobody else is affected, in either direction.
  check('another member is untouched', backend.pushDisabledForUser(ss, 'u2'), false);
  const other = backend.registerPushDevice(ss, 'u2', 'token-laptop', 'Chrome on Windows');
  check('and can still register a new device', [other.ok, other.transferredFrom], [true, '']);

  // Lifting it: allowed again, but nothing handed back - a subscription can only be turned on at the
  // device, by the member, which is why this direction is one-sided.
  check('allowing again lifts the block', [backend.setPushDisabledForUser(ss, 'u1', false), backend.pushDisabledForUser(ss, 'u1')], [true, false]);
  check('but their devices are still gone', backend.pushTokensForUser(ss, 'u1'), []);
  check('so re-enabling is theirs to do', backend.registerPushDevice(ss, 'u1', 'token-phone', 'Safari on iPhone').ok, true);
}
{
  // A device enabled before the push_devices sheet existed lives in the legacy column, which is still
  // read - so the switch has to clear that too, or the member keeps receiving after being turned off.
  const { backend, ss } = makeBackend({
    members: [['u1', 'Kayla Nguyen', 'kayla']],
    settings: [['u1', 'legacy-computer-token']],
  });

  const off = backend.disablePushForUser(ss, 'u1');

  check('a legacy-only device is silenced as well', backend.pushTokensForUser(ss, 'u1'), []);
  check('and counted for the admin', off.devices, 1);
  check('and even that token cannot come back', backend.registerPushDevice(ss, 'u1', 'legacy-computer-token', 'Chrome on Mac').reason, 'disabled_by_admin');
}
{
  // The flag is read through the same settings index as everything else, so a blank or absent column is
  // simply "not switched off" - the state every member is in until somebody says otherwise.
  const { backend, ss } = makeBackend({ settings: [['u1', '']] });
  check('an empty settings row is not a block', backend.pushDisabledForUser(ss, 'u1'), false);
  check('and neither is a member with no row', backend.pushDisabledForUser(ss, 'u9'), false);
}

console.log('\n--- the card asks the DEVICE, not the member ---');
// The exact bug: the state was read from the member's stored token, so a phone that had never been
// enabled showed "Registered" because the member's computer was.
check('the card no longer reads fcm_registered', /fcm_registered/.test(settingsSource), false);
check('it reads this device\u2019s own subscription instead', /currentDeviceToken\(/.test(settingsSource), true);
check('and says which device it means', /This device/.test(settingsSource), true);
check('it reports the other devices too', /otherDeviceCount/.test(settingsSource), true);
// Enabling must register a device; the member's own row must never be rewritten.
check('enabling registers the device', /pushDeviceApi\?\.register\(/.test(settingsSource), true);
check('and no longer writes fcm_token', /fcm_token/.test(settingsSource), false);
// Turning off must remove exactly the token this browser released.
check('turning off unregisters the released token', /disablePushNotifications\(webConfig\)/.test(settingsSource) && /unregister\(releasedToken\)/.test(settingsSource), true);

console.log('\n--- the card asks WHOSE this computer is ---');
// The second half of the bug: a subscription existing here was taken as proof it was the member's, so
// opening the card registered it for them. The card has to ask the server who the row names, and write
// nothing when the answer is somebody else.
check('the card reads the owner from the server', /pushDeviceApi\?\.status\(/.test(settingsSource), true);
check('and never registers a device it does not own', /ownerIsSomeoneElse/.test(settingsSource), true);
check('it says whose computer this is', /is set up for/.test(settingsSource), true);
// Handing over is a button, not a side effect: the transfer flag exists for exactly one call site.
check('the transfer is behind its own button', /onClick=\{handleClaimDevice\}/.test(settingsSource), true);
check('which sends the transfer flag', /transfer: true/.test(settingsSource), true);
check('and the wire carries it as a boolean', /transfer: options\?\.transfer === true/.test(apiSource), true);
check('the server only re-points a row when it is set', /options && options\.transfer/.test(codeSource), true);
check('and refuses, naming the owner, when it is not', /owned_by_another_member/.test(codeSource), true);
check('the refusal reaches the client by name', /DEVICE_OWNED_BY_ANOTHER_MEMBER/.test(codeSource), true);
check('a hand-over is written to the system log', /Moved a device from/.test(codeSource), true);

console.log('\n--- turning a device off clears the row, whatever it names ---');
// Bounded to the session's member, this left the other member's row behind after the browser had
// unsubscribed: a device recorded as registered that could never receive anything. Holding the token
// is the proof - a browser can only name its own subscription - so the delete is by token alone.
check('unregister deletes by token alone', /deletePushTokens\(ss, \[removeToken\]\)/.test(codeSource), true);
check(
  'not bounded to the session member',
  /deletePushTokens\(ss, \[removeToken\], authUnregister\.userId\)/.test(codeSource),
  false
);
check('and reports whose device it was', /removed_owner_name/.test(codeSource), true);
check('so the card can say whose alerts stopped here', /removed_owner_name/.test(settingsSource), true);
// The prune path keeps the bound where it can: a one-member send removes that member's dead token only.
// (The announcement and offer fan-outs send to many members at once, so they prune by TOKEN - asserted
// above - because there is no single member to bound the delete to.)
check('a dead-token prune is still bounded by member', /deletePushTokens\(ss, deadTokens, targetUserId\)/.test(codeSource), true);

console.log('\n--- the administrator\'s switch is wired to all three ends ---');
// Middle: the action. Gated on the same permission as the table it is on, and logged, because a member
// whose notifications stop has to be able to find out why and who did it.
checkIs('there is an action for the switch', /case "ADMIN_SET_PUSH_DISABLED":/.test(codeSource));
checkIs('gated on the notification permission, like the table', /case "ADMIN_SET_PUSH_DISABLED"[\s\S]{0,260}can_edit_notification_settings/.test(codeSource));
checkIs('it writes a system log line', /"ADMIN_SET_PUSH_DISABLED",\s*\n?\s*"Turned notifications off for "/.test(codeSource));
checkIs('and names the member in it', /Allowed notifications for " \+ pushTargetName/.test(codeSource));
// The flag has to reach BOTH surfaces: the admin table (so the row reads as switched off) and the
// member's own card (so a live subscription is not reported as delivery).
checkIs('the admin table is told the state', /push_disabled: pushDisabledForUser\(ss, String\(user\.id\)\.trim\(\)\)/.test(codeSource));
checkIs('and so is the member', /push_disabled: pushDisabledForUser\(ss, myDeviceUserId\)/.test(codeSource));
// The refusal has to be a NAME, not a generic failure: the member has done nothing wrong.
checkIs('the block has its own code for the client', /PUSH_DISABLED_BY_ADMIN/.test(codeSource) && /PUSH_DISABLED_BY_ADMIN/.test(settingsSource));
checkIs('so the card can explain rather than shrug', /An administrator has turned notifications off for your account/.test(settingsSource));
checkIs('and it offers no Enable button that could only fail', /pushBlocked \? \(/.test(settingsSource));
// Front: the admin UI. Disabling is destructive and asks first (a native dialog is banned here - see
// verify:confirmations); allowing does not ask, because nothing is lost.
checkIs('the admin sends the switch', /adminSetPushDisabled\(/.test(adminSource) && /action: 'ADMIN_SET_PUSH_DISABLED'/.test(apiSource));
checkIs('the destructive direction asks in ConfirmModal', /import ConfirmModal/.test(adminSource) && /<ConfirmModal/.test(adminSource));
checkIs('holding the row it is asking about', /setConfirmingOff\(user\)/.test(adminSource) && /confirmingOff\.device_count/.test(adminSource));
checkIs('and the row re-reads itself afterwards', /await loadStatus\(\)/.test(adminSource));
checkIs('the table shows the switched-off state', /Off \(administrator\)/.test(adminSource));
checkIs('and cannot send a test to a switched-off member', /!user\.device_registered \|\| user\.push_disabled \|\| sendingTo === user\.id/.test(adminSource));

console.log('\n--- the wire name cannot collide with the session ---');
// `token` is the session in the RPC envelope. Reading it as the device token would register a session
// id as a push device - the same class of collision that broke the System Log request.
check('the client sends device_token', /device_token:/.test(apiSource), true);
check('the backend reads device_token', /data\.device_token/.test(codeSource), true);
check('and never reads the envelope token as a device', /data\.token \|\| payload\.token/.test(codeSource), false);

console.log('\n--- device labels are human ---');
check('iPhone Safari', deviceLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
check('macOS Chrome', deviceLabelFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36'), 'Chrome on Mac');
check('Android Chrome', deviceLabelFromUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36'), 'Chrome on Android');
check('Windows Edge', deviceLabelFromUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0'), 'Edge on Windows');
check('iPad Safari', deviceLabelFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0) Version/17.0 Safari/604.1'), 'Safari on iPad');
// An unrecognized agent still produces something a member can recognize rather than an empty cell.
check('something unknown is still labeled', deviceLabelFromUserAgent(''), 'Browser on device');
check('and a null agent does not throw', deviceLabelFromUserAgent(null), 'Browser on device');

console.log('\n--- the admin view counts devices ---');
check('it reports a per-member count', /device_count: deviceCount/.test(codeSource), true);
check('derived from the device index', /pushDeviceCountByUser\(ss\)/.test(codeSource), true);
// A test push should prove delivery on every device, not just one.
check('the test push fans out to all devices', /targetTokens\.forEach/.test(codeSource), true);
check('and reports how many it reached', /deliveredCount === 1/.test(codeSource), true);

console.log('\n--- the announcement and offer sends fan out too ---');
check('announcements iterate the member\u2019s devices', /const devices = tokensByUser\[String\(member\.id\)\] \|\| \[\]/.test(codeSource), true);
check('offers iterate them as well', /const devices = tokensByUser\[key\] \|\| \[\]/.test(codeSource), true);
// Dead tokens are pruned by TOKEN: pruning by member would take their other devices with it.
check('a dead token prunes only that token', /staleTokens\.push\(token\)/.test(codeSource), true);
check('and never prunes by member id', /staleTokens\.push\(String\(member\.id\)\)/.test(codeSource), false);

console.log('\n--- the legacy token column still counts ---');
// A device that registered before the push_devices sheet existed must keep working with no re-enable.
{
  const { backend, ss } = makeBackend({
    settings: [['u1', 'legacy-computer-token']],
  });

  check('it is included', backend.pushTokensForUser(ss, 'u1'), ['legacy-computer-token']);
  check('and counted for the admin view', backend.pushDeviceCountByUser(ss), { u1: 1 });

  backend.registerPushDevice(ss, 'u1', 'phone-token', 'Safari on iPhone');
  // Sorted on purpose: devices are read before the legacy column, so the order in the list is an
  // implementation detail - what matters is that BOTH are delivered to and neither replaced the other.
  check(
    'a new device joins it rather than replacing it',
    backend.pushTokensForUser(ss, 'u1').slice().sort(),
    ['legacy-computer-token', 'phone-token']
  );
}
{
  // The same token in both places must not be delivered to twice.
  const { backend, ss } = makeBackend({
    devices: [['1', 'u1', 'same-token', '', '']],
    settings: [['u1', 'same-token']],
  });
  check('a token stored in both places is deduped', backend.pushTokensForUser(ss, 'u1'), ['same-token']);
}
{
  // And removal has to clear the legacy column too, or a "turned off" device keeps receiving.
  const { backend, ss, sheets } = makeBackend({ settings: [['u1', 'legacy-token']] });
  backend.deletePushTokens(ss, ['legacy-token'], 'u1');
  const rows = sheets.user_settings.rows;
  check('removing a legacy device clears the column', rows[1][1], '');
  check('and it stops being delivered to', backend.pushTokensForUser(ss, 'u1'), []);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

