/**
 * Verifies the idle session timeout.
 *
 * Two things have to hold, and the second is the one that matters:
 *
 *   1. The client's parsing and state transitions - a typo must switch the feature OFF rather than
 *      expire every session, and the threshold must be the boundary between "warning" and "over".
 *   2. The SERVER expires sessions on the same setting. A client-only timeout is not a timeout: it
 *      is a button that says the session ended. These assertions lift the real functions out of
 *      Code.gs and run them against stubs, so `sessionTtlMs` and `createSession` are exercised as
 *      written rather than as described.
 *
 * Run with: npm run verify:session-timeout
 */
import { readFileSync } from 'node:fs';
import {
  MIN_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_KEY,
  SESSION_WARNING_SECONDS,
  formatIdleCountdown,
  idleLogoutMessage,
  idleRemainingMs,
  idleSecondsRemaining,
  idleState,
  parseSessionTimeoutMinutes,
  sessionTimeoutConfig,
  sessionTimeoutSetting,
} from '../src/utils/sessionTimeout.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const rows = (value) => [{ key: SESSION_TIMEOUT_KEY, value }];

console.log('--- reading the setting ---');
check('a number of minutes', parseSessionTimeoutMinutes('30'), 30);
check('a number with surrounding space', parseSessionTimeoutMinutes('  45  '), 45);
check('a numeric cell', parseSessionTimeoutMinutes(60), 60);
check('a fraction is floored', parseSessionTimeoutMinutes('2.7'), 2);
check('blank is not configured', parseSessionTimeoutMinutes(''), null);
check('a missing value is not configured', parseSessionTimeoutMinutes(undefined), null);
check('null is not configured', parseSessionTimeoutMinutes(null), null);
check('only whitespace is not configured', parseSessionTimeoutMinutes('   '), null);
check('zero is not configured, not instant expiry', parseSessionTimeoutMinutes('0'), null);
check('a negative is not configured', parseSessionTimeoutMinutes('-30'), null);
check('"30 minutes" is refused rather than guessed at 30', parseSessionTimeoutMinutes('30 minutes'), null);
check('"30m" is refused', parseSessionTimeoutMinutes('30m'), null);
check('a thousands separator is refused', parseSessionTimeoutMinutes('1,000'), null);
check('a word is refused', parseSessionTimeoutMinutes('later'), null);
check('the minimum itself is accepted', parseSessionTimeoutMinutes(String(MIN_SESSION_TIMEOUT_MINUTES)), MIN_SESSION_TIMEOUT_MINUTES);

check('the setting is found by key', sessionTimeoutSetting(rows('25')), '25');
check('an unrelated key is not it', sessionTimeoutSetting([{ key: 'time_format', value: '24' }]), undefined);
check('a non-array is tolerated', sessionTimeoutSetting(null), undefined);

console.log('\n--- the config the UI and the timer read ---');
const on = sessionTimeoutConfig(rows('30'));
check('configured', on.configured, true);
check('not invalid', on.invalid, false);
check('the minutes', on.minutes, 30);
check('the window in ms', on.ms, 30 * 60 * 1000);
check('the warning window', on.warningMs, SESSION_WARNING_SECONDS * 1000);
const off = sessionTimeoutConfig(rows(''));
check('blank means off', off.configured, false);
check('and is not reported as invalid', off.invalid, false);
const bad = sessionTimeoutConfig(rows('half an hour'));
check('an unusable value is off', bad.configured, false);
check('and IS reported as invalid, so it can be fixed', bad.invalid, true);
check('and its raw text is kept for the message', bad.raw, 'half an hour');
check('with no window at all', bad.ms, 0);
check('no settings at all means off', sessionTimeoutConfig([]).configured, false);
check('a non-array means off', sessionTimeoutConfig(undefined).configured, false);

console.log('\n--- the state machine ---');
const cfg = sessionTimeoutConfig(rows('30'));
const T0 = 1_000_000;
const at = (ms) => idleState(T0, T0 + ms, cfg);
check('just after activity it is active', at(0), 'active');
check('a minute in it is active', at(60_000), 'active');
check('past the warning window it is still active', at(cfg.ms - cfg.warningMs - 1), 'active');
check('entering the warning window', at(cfg.ms - cfg.warningMs), 'warning');
check('one second before the end it is still a warning', at(cfg.ms - 1000), 'warning');
check('at the threshold the session is over, not warning', at(cfg.ms), 'expired');
check('well past it is over', at(cfg.ms + 60_000), 'expired');
check('with the feature off nothing expires', idleState(T0, T0 + 10 * 24 * 3600_000, off), 'off');
check('a null config is off', idleState(T0, T0, null), 'off');

check('the time left', idleRemainingMs(T0, T0 + 60_000, cfg), cfg.ms - 60_000);
check('negative once past the threshold', idleRemainingMs(T0, T0 + cfg.ms + 5000, cfg) < 0, true);
check('infinite when off', idleRemainingMs(T0, T0 + 1, off), Number.POSITIVE_INFINITY);
check('seconds left, rounded up', idleSecondsRemaining(T0, T0 + cfg.ms - 1500, cfg), 2);
check('exactly at the threshold', idleSecondsRemaining(T0, T0 + cfg.ms, cfg), 0);
check('null when off, so no countdown is shown', idleSecondsRemaining(T0, T0, off), null);

console.log('\n--- the wording a member sees ---');
check('seconds are pluralised', formatIdleCountdown(45), '45 seconds');
check('one second is singular', formatIdleCountdown(1), '1 second');
check('zero still reads as time', formatIdleCountdown(0), '0 seconds');
check('a minute', formatIdleCountdown(60), '1 minute');
check('minutes', formatIdleCountdown(120), '2 minutes');
check('a non-number is tolerated', formatIdleCountdown(undefined), '0 seconds');
check(
  'the logout message names the period',
  idleLogoutMessage(30),
  'You were signed out after 30 minutes of inactivity. Sign in again to continue.'
);
check(
  'and reads sensibly for one minute',
  idleLogoutMessage(1),
  'You were signed out after 1 minute of inactivity. Sign in again to continue.'
);
check(
  'and for an unknown period',
  idleLogoutMessage(null),
  'You were signed out after a period of inactivity. Sign in again to continue.'
);

console.log('\n--- the server expires on the same setting ---');
// The real functions, lifted out of Code.gs and run against stubs of the Apps Script globals they
// touch. The parsing has to agree with the client's or the two halves would disagree about when a
// session ends - and this half is the one that actually stops a token being used afterwards.
const codeSource = readFileSync('src/services/Code.gs', 'utf8');
const extract = (name) => {
  const start = codeSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Code.gs has no function ${name}`);
  let depth = 0;
  let i = codeSource.indexOf('{', start);
  for (; i < codeSource.length; i++) {
    if (codeSource[i] === '{') depth++;
    else if (codeSource[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return codeSource.slice(start, i + 1);
};

const parseSource = extract('parseSessionTimeoutMinutes');
const ttlSource = extract('sessionTtlMs');
check('both server functions were extracted', ttlSource.length > 300 && parseSource.length > 150, true);

// The functions read module-level constants, so those are lifted from the file as well rather than
// restated here - a hardcoded copy would silently diverge from the real default (and from the session
// property prefix, which the retune path keys on).
const extractConst = (name) => {
  const match = new RegExp(`^const ${name} = [^;]+;`, 'm').exec(codeSource);
  if (!match) throw new Error(`Code.gs has no const ${name}`);
  return match[0];
};
const SESSION_CONSTS = [
  'DEFAULT_SESSION_TTL_MINUTES',
  'MIN_SESSION_TTL_MINUTES',
  'SESSION_PROPERTY_PREFIX',
  // The epoch key space, and the reader createSession stamps a new session with. Both are needed or the
  // extracted createSession below throws - the session record now carries a revocation epoch.
  'SESSION_EPOCH_PREFIX',
].map(extractConst);
check('every constant the session functions need was found', SESSION_CONSTS.length, 4);
// The epoch reader, extracted once and included wherever createSession is.
const epochSource = extract('sessionEpochFor');
// The prefix itself, so the fixtures below can assert against the real value rather than an assumed one.
const sessionPrefix = /^const SESSION_PROPERTY_PREFIX = "([^"]+)";/m.exec(codeSource);
check('the session property prefix was read', !!sessionPrefix, true);
check('and it is still the historical fc_auth_ prefix', sessionPrefix && sessionPrefix[1], 'fc_auth_');
const defaultTtlMs = (() => {
  const match = /^const DEFAULT_SESSION_TTL_MINUTES = ([^;]+);/m.exec(codeSource);
  return Number(new Function(`return ${match[1]};`)()) * 60 * 1000;
})();

const MINUTE = 60 * 1000;

// A fake CacheService, so the memo can be observed rather than assumed.
const makeCache = () => {
  const store = new Map();
  return {
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => store.set(k, v),
    _store: store,
  };
};

// systemSettingsMap and getSheetData are the REAL ones, lifted out as well. Writing my own stub
// here is how this test first went wrong: a hand-rolled reader keyed the map by column name
// instead of by row key, so it silently returned the default for every configuration.
const settingsSource = extract('systemSettingsMap');
const sheetDataSource = extract('getSheetData');
check('the settings chain was extracted', settingsSource.length > 100 && sheetDataSource.length > 200, true);

const SHEET_SOURCES = [sheetDataSource, settingsSource].join('\n');

const serverTtlFor = (settingValue, cache = makeCache()) => {
  const body = `
    ${SESSION_CONSTS.join('\n')}
    ${SHEET_SOURCES}
    ${parseSource}
    ${ttlSource}
    return sessionTtlMs;
  `;
  const sheet = {
    getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => [['key', 'value'], ['session_timeout', settingValue]] }),
    }),
  };
  const fn = new Function('CacheService', body)({ getScriptCache: () => cache });
  return fn(sheet);
};

check('a configured timeout becomes the session window', serverTtlFor('30'), 30 * MINUTE);
check('and the server floors it just as the client does', serverTtlFor('2.7'), 2 * MINUTE);
check('the minimum is honoured', serverTtlFor('1'), MINUTE);
check(
  'an unusable value falls back to the default rather than expiring everyone',
  serverTtlFor('half an hour'),
  defaultTtlMs
);
check('zero falls back to the default too', serverTtlFor('0'), defaultTtlMs);
check('a blank value falls back to the default', serverTtlFor(''), defaultTtlMs);

// --- the performance contract ------------------------------------------------------------------
//
// The whole point of carrying the window in the session record is that the REQUEST PATH does no
// settings I/O. These assertions are the regression guard: reintroducing a lookup in
// getAuthContext would fail here rather than quietly costing every request a round trip.
console.log('\n--- the request path does no settings I/O ---');
const authSource = extract('getAuthContext');
check('getAuthContext was extracted', authSource.length > 400, true);
check('it does not resolve the timeout', /sessionTtlMs\(/.test(authSource), false);
check('it does not read the settings sheet', /systemSettingsMap\(/.test(authSource), false);
check('it does not touch CacheService', /CacheService/.test(authSource), false);
check('it reads the window from the session record instead', /parseSessionRecord\(/.test(authSource), true);
check(
  'and refreshes with that window',
  /sessionRecordValue\(userId, Date\.now\(\) \+ record\.ttlMs, record\.ttlMs\)/.test(authSource),
  true
);
// One sheet read remains, and it is the pre-existing members lookup - not something this feature added.
check(
  'its only sheet read is the members lookup it always did',
  (authSource.match(/getSheetData\(ss, "users"\)/g) || []).length,
  1
);
check('the timeout helper itself uses no cache', /CacheService/.test(ttlSource), false);
// Two CALL SITES, excluding the declaration itself: createSession and retuneSessions. Anything else
// calling it is a new per-request lookup creeping back in.
check(
  'the timeout is resolved only at session creation and on save',
  (codeSource.match(/= sessionTtlMs\(ss\)/g) || []).length,
  2
);

// --- the session record ------------------------------------------------------------------------
console.log('\n--- the session record carries the window ---');
const recordSource = extract('parseSessionRecord');
const recordValueSource = extract('sessionRecordValue');
const createSource = extract('createSession');
const retuneSource = extract('retuneSessions');

const recordModule = () =>
  new Function(
    `${SESSION_CONSTS.join('\n')}\n${recordSource}\n${recordValueSource}\nreturn { parseSessionRecord, sessionRecordValue };`
  )();
const { parseSessionRecord, sessionRecordValue } = recordModule();

const NOW = 1_700_000_000_000;
const threeField = parseSessionRecord(sessionRecordValue('u1', NOW + 30 * MINUTE, 30 * MINUTE));
check('a new-style record parses', threeField.userId, 'u1');
check('with its expiry', threeField.expiry, NOW + 30 * MINUTE);
check('and its window', threeField.ttlMs, 30 * MINUTE);
check('the value is pipe-delimited', sessionRecordValue('u1', 123, 456), 'u1|123|456|');
check('and carries the epoch as its fourth field', sessionRecordValue('u1', 123, 456, 'epoch-9'), 'u1|123|456|epoch-9');
// A record written before the epoch existed has three fields and no epoch: it must stay valid, or deploying
// the revocation fix would sign everybody out.
const preEpoch = parseSessionRecord(sessionRecordValue('u3', NOW + MINUTE, MINUTE));
check('a pre-epoch record parses', preEpoch.userId, 'u3');
check('with no epoch', preEpoch.epoch, '');

// A session created by the deploy BEFORE this change has two fields. It must keep working, or
// releasing would sign everybody out mid-shift.
const legacy = parseSessionRecord('u2|' + (NOW + 6 * 60 * MINUTE));
check('a two-field record from an earlier deploy still parses', legacy.userId, 'u2');
check('keeping its expiry', legacy.expiry, NOW + 6 * 60 * MINUTE);
check('and falling back to the default window', legacy.ttlMs, defaultTtlMs);
check('a garbage record does not throw', parseSessionRecord('nonsense').userId, 'nonsense');
check('an empty record is not a user', parseSessionRecord('').userId, '');
check('a null record does not throw', parseSessionRecord(null).userId, '');

// The window reaches open sessions through retuneSessions rather than per-request polling.
console.log('\n--- retuning open sessions on save ---');
const makeProps = (entries) => {
  const store = new Map(Object.entries(entries));
  return {
    getKeys: () => [...store.keys()],
    getProperty: (k) => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => store.set(k, v),
    deleteProperty: (k) => store.delete(k),
    _store: store,
  };
};

const runRetune = (entries, settingValue, now = Date.now()) => {
  const props = makeProps(entries);
  const body = `
    ${SESSION_CONSTS.join('\n')}
    ${SHEET_SOURCES}
    ${extract('parseSessionTimeoutMinutes')}
    ${recordSource}
    ${recordValueSource}
    ${ttlSource}
    ${retuneSource}
    return retuneSessions;
  `;
  const sheet = {
    getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => [['key', 'value'], ['session_timeout', settingValue]] }),
    }),
  };
  const fn = new Function('PropertiesService', 'getSheetData', body)(
    { getScriptProperties: () => props },
    () => []
  );
  return { props, updated: fn(sheet) };
};

// A session idle for 60 minutes of a 720-minute window, when the timeout is shortened to 30: it must
// become "60 minutes idle against the NEW window", so it is already past its expiry - not renewed.
const baseNow = Date.now();
const longWindow = defaultTtlMs;
const idleEntries = { 'fc_auth_t1': `u1|${baseNow - 60 * MINUTE + longWindow}|${longWindow}` };
const retuned = runRetune(idleEntries, '30');
check('live sessions are retuned', retuned.updated, 1);
const retunedRecord = parseSessionRecord(retuned.props._store.get('fc_auth_t1'));
check('to the new window', retunedRecord.ttlMs, 30 * MINUTE);
check(
  'preserving the time already spent idle',
  Math.abs(retunedRecord.expiry - (baseNow - 60 * MINUTE + 30 * MINUTE)) < 2000,
  true
);
check('so an over-idle session is past its expiry, not renewed', retunedRecord.expiry < Date.now() + 1000, true);

// A just-used session gets the full new window.
const freshRetuned = runRetune(
  { 'fc_auth_t2': `u1|${baseNow - 1000 + longWindow}|${longWindow}` },
  '30'
);
const freshRecord = parseSessionRecord(freshRetuned.props._store.get('fc_auth_t2'));
check('a just-used session gets the full new window', freshRecord.expiry - Date.now() - 30 * MINUTE < 5000, true);

// Expired and unrelated properties are left alone, so the retune stays proportional to live sessions.
// The timestamp is captured once, so the assertions below compare against the same value the fixture used.
const expiredFixtureExpiry = Date.now() - MINUTE;
const mixed = runRetune(
  {
    'fc_auth_dead': `u9|${expiredFixtureExpiry}|${longWindow}`,
    'fc_auth_live': `u1|${Date.now() - 1000 + longWindow}|${longWindow}`,
    some_other_setting: 'keep me',
  },
  '30'
);
// The expired record must be left EXACTLY as it was, but the fixture's timestamp is built from Date.now()
// and the code under test also calls Date.now(), so comparing the two round-tripped strings races the
// clock by a millisecond. Asserting the property that matters - an expired session is left alone and is
// not counted - keeps that check meaningful without depending on when the clock ticks.
const deadRecord = parseSessionRecord(mixed.props._store.get('fc_auth_dead'));
check('an expired record is left alone', deadRecord.userId, 'u9');
check('and its expiry is unchanged', deadRecord.expiry, expiredFixtureExpiry);
check('and it was not counted as live', mixed.updated, 1);
check('and unrelated properties are untouched', mixed.props._store.get('some_other_setting'), 'keep me');

// Clearing the setting must restore the default window, not make sessions expire instantly.
const cleared = runRetune({ 'fc_auth_t3': `u1|${Date.now() - 1000 + longWindow}|${longWindow}` }, '');
check(
  'clearing the timeout restores the default window',
  parseSessionRecord(cleared.props._store.get('fc_auth_t3')).ttlMs,
  longWindow
);

// A record with no expiry must be left rather than turned into "expires at 0".
const noExpiry = runRetune({ 'fc_auth_bad': 'u1' }, '30');
check('a malformed record is skipped', noExpiry.updated, 0);

// createSession must write the four-field form (userId|expiry|window|epoch), with the configured window.
const created = (() => {
  const props = makeProps({});
  const body = `
    ${SESSION_CONSTS.join('\n')}
    ${SHEET_SOURCES}
    ${recordSource}${recordValueSource}${ttlSource}
    ${epochSource}
    ${extract('parseSessionTimeoutMinutes')}
    ${createSource}
    return createSession;
  `;
  const sheet = {
    getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => [['key', 'value'], ['session_timeout', '30']] }),
    }),
  };
  const fn = new Function('PropertiesService', 'Utilities', 'getSheetData', body)(
    { getScriptProperties: () => props },
    { getUuid: () => 'tok-1' },
    () => []
  );
  fn('u7', sheet);
  return props._store.get('fc_auth_tok-1');
})();
const createdRecord = parseSessionRecord(created);
check('a new session carries its window', createdRecord.ttlMs, 30 * MINUTE);
check('and a matching expiry', createdRecord.expiry - Date.now() - 30 * MINUTE < 5000, true);
check('the record has four fields, the last being the epoch', created.split('|').length, 4);
// No revocation has happened for this member, so the epoch is empty - and a session created before anything
// was ever revoked must be valid, which is what makes deploying the epoch a no-op for everybody.
check('and the epoch is empty until something is revoked', created.split('|')[3], '');

// The client tick runs once a second for a whole session, so it has to be negligible.
console.log('\n--- the client tick is cheap ---');
const tickStart = process.hrtime.bigint();
for (let i = 0; i < 200_000; i++) {
  idleState(T0, T0 + 1000, cfg);
}
const tickMs = Number(process.hrtime.bigint() - tickStart) / 1e6;
const perTickUs = (tickMs / 200_000) * 1000;
console.log(`     measured: ${perTickUs.toFixed(2)}us per tick (${(1000 / perTickUs).toFixed(0)} ticks/ms)`);
check('a tick costs microseconds', perTickUs < 50, true);

// --- what a request costs now ------------------------------------------------------------------
//
// Printed rather than only asserted, because "did this make the app slower?" deserves a number
// rather than a claim. Counted from the auth path itself.
console.log('\n--- what an authenticated request costs ---');
const countOf = (source, pattern) => (source.match(pattern) || []).length;
const sheetReads = countOf(authSource, /getSheetData\(/g);
const cacheCalls = countOf(authSource, /CacheService/g);
const settingsReads = countOf(authSource, /systemSettingsMap\(/g);
const propsReads = countOf(authSource, /props\.getProperty/g);
const propsWrites = countOf(authSource, /props\.setProperty/g);
console.log(`     sheet reads:        ${sheetReads}  (the members lookup, pre-existing)`);
console.log(`     settings reads:     ${settingsReads}  (was 1 per cache miss)`);
console.log(`     CacheService calls: ${cacheCalls}  (was 1 per request, plus a sheet read on eviction)`);
console.log(`     script properties:  ${propsReads} read + ${propsWrites} write (was the same)`);

check('nothing extra reads the settings sheet per request', settingsReads, 0);
check('no cache round trip per request', cacheCalls, 0);
check('exactly one sheet read, and it is not ours', sheetReads, 1);
check('the property read/write count is unchanged from before this feature', propsReads === 1 && propsWrites === 1, true);


// The two halves must agree on what a usable value is. If the client reported "Enforcing" while
// the server ignored the setting, the card would be lying about the protection in place.
console.log('\n--- client and server parse alike ---');
const serverParse = new Function(
  `${SESSION_CONSTS.join('\n')}\n${parseSource}\nreturn parseSessionTimeoutMinutes;`
)();
['30', '  45  ', '2.7', '', '0', '-30', '30 minutes', '30m', '1,000', 'later', '1', '  ', '99999'].forEach(
  (probe) => {
    check(`agree on ${JSON.stringify(probe)}`, serverParse(probe), parseSessionTimeoutMinutes(probe));
  }
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
