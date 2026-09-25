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

const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const apiSource = readFileSync('src/services/api.js', 'utf8');
const settingsSource = readFileSync('src/components/UserSettings.jsx', 'utf8');

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
  ${extract('registerPushDevice')}
  ${extract('deletePushTokens')}
  ${extract('pushDeviceCountByUser')}
  return { registerPushDevice, deletePushTokens, pushTokenIndex, pushTokensForUser, pushDeviceCountByUser, pushDeviceRows, PUSH_DEVICE_SHEET };
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

const makeBackend = ({ devices = [], settings = [] } = {}) => {
  const sheets = {
    push_devices: new FakeSheet([DEVICE_HEADERS.slice(), ...devices.map((d) => d.slice())]),
    user_settings: new FakeSheet([
      ['user_id', 'fcm_token'],
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
  const upsertUserSettingsColumns = (spreadsheet, userId, values) => {
    const sheet = spreadsheet.getSheetByName('user_settings');
    const rows = sheet.rows;
    const headers = rows[0];
    const idCol = headers.indexOf('user_id');
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idCol]).trim() !== String(userId).trim()) continue;
      Object.keys(values).forEach((key) => {
        const col = headers.indexOf(key);
        if (col !== -1) sheet.getRange(i + 1, col + 1).setValue(values[key]);
      });
      return true;
    }
    return false;
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

console.log('\n--- a shared device changes hands ---');
{
  const { backend, ss, sheets } = makeBackend();
  backend.registerPushDevice(ss, 'u1', 'token-tablet', 'Chrome on Android');
  backend.registerPushDevice(ss, 'u2', 'token-tablet', 'Chrome on Android');

  check('the row re-points rather than duplicating', deviceTokens(sheets), ['u2:token-tablet']);
  check('u1 has nothing left', backend.pushTokensForUser(ss, 'u1'), []);
  check('and u2 has the device', backend.pushTokensForUser(ss, 'u2'), ['token-tablet']);
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

console.log('\n--- a token cannot be removed from another member ---');
// The blast radius of deleting on a token match, bounded by the session's user id.
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
// An unrecognised agent still produces something a member can recognise rather than an empty cell.
check('something unknown is still labelled', deviceLabelFromUserAgent(''), 'Browser on device');
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

