/**
 * Verifies the optional clock-in geofence.
 *
 * The client util is the only implementation of the rule now that the backend is Firestore
 * and the fence is enforced by the client pre-flight (a refused clock action never leaves
 * the browser), so this checks it against the geofence's documented expectations.
 *
 * Run with: npm run verify:clock-location
 */
import {
  CLOCK_LOCATION_KEYS,
  clockLocationConfig,
  distanceInFeet,
  evaluateClockLocation,
  hasCoordinates,
  parseLatitude,
  parseLongitude,
  parseMarginFeet,
  settingValue,
} from '../src/utils/clockLocation.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};
const close = (label, actual, expected, tolerance) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${actual} (expected ${expected} +/- ${tolerance})`}`
  );
};

const CONFIGURED = {
  configured: true,
  latitude: 39.277157,
  longitude: -78.23833,
  marginFeet: 1000,
  missing: [],
  invalid: [],
};

console.log('--- distance, in the units the setting uses ---');
// One degree of latitude is ~69 statute miles, i.e. ~364,000 ft. This is the sanity check that
// the feet conversion is right and not, say, meters.
close('one degree of latitude', distanceInFeet({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }), 364000, 2000);
// One degree of longitude at 39.28 N is ~0.774 of a degree of latitude.
close(
  'one degree of longitude at 39.28N',
  distanceInFeet({ latitude: 39.277157, longitude: 0 }, { latitude: 39.277157, longitude: 1 }),
  282000,
  3000
);
check('a point is zero feet from itself', Math.round(distanceInFeet({ latitude: 39.28, longitude: -78.24 }, { latitude: 39.28, longitude: -78.24 })), 0);
close('the same point in meters', distanceInFeet({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0, 0.0001);
// Antipodal -1/1 on the sine/cosine: asin must be clamped, not NaN. Pole to pole along a meridian
// is exactly half the circumference, pi * R.
close(
  'antipodal points are half the circumference',
  distanceInFeet({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 }),
  65666386,
  1000
);

console.log('\n--- coordinates: 1000 ft is a real, walkable distance ---');
// 1000 ft north of the station must be inside; 2000 ft must not.
const oneDegreeLatFeet = distanceInFeet({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
const north = (feet) => ({ latitude: CONFIGURED.latitude + feet / oneDegreeLatFeet, longitude: CONFIGURED.longitude });
check('900 ft away is inside', evaluateClockLocation(north(900), CONFIGURED).allowed, true);
check('1100 ft away is outside', evaluateClockLocation(north(1100), CONFIGURED).allowed, false);
check('and reports being outside', evaluateClockLocation(north(1100), CONFIGURED).code, 'outside');
check('exactly at the margin is inside', evaluateClockLocation(north(1000), CONFIGURED).allowed, true);
// Matched with \s* rather than an exact space: the wording of these messages is copy, and tweaking it
// should not break the suite. What must hold is that the member is told the distance AND the limit.
check('the message names the distance', /about 1,100\s*ft/.test(evaluateClockLocation(north(1100), CONFIGURED).message), true);
check('and the limit', /1,000\s*ft/.test(evaluateClockLocation(north(1100), CONFIGURED).message), true);
check('a nearby point reports ok', evaluateClockLocation(north(10), CONFIGURED).code, 'ok');

console.log('\n--- no coordinates captured ---');
// A denied permission resolves to nulls, which must be rejected whenever a fence is set: that is
// the bypass this closes. It is NOT rejected when no fence is configured, because then the app
// must behave exactly as it did before these settings existed.
check('nulls are not coordinates', hasCoordinates({ latitude: null, longitude: null }), false);
check('undefined is not coordinates', hasCoordinates(undefined), false);
check('an empty object is not coordinates', hasCoordinates({}), false);
check('strings are not coordinates', hasCoordinates({ latitude: '39.2', longitude: '-78.2' }), false);
check('rejects a missing location', evaluateClockLocation({ latitude: null, longitude: null }, CONFIGURED).allowed, false);
check('with the no-coords code', evaluateClockLocation({ latitude: null, longitude: null }, CONFIGURED).code, 'no-coords');
check('and tells the member to allow access', /Allow location access/.test(evaluateClockLocation(null, CONFIGURED).message), true);
check('a real coordinate pair is accepted', hasCoordinates({ latitude: 39.2, longitude: -78.2 }), true);

console.log('\n--- all three keys, or the feature is off ---');
const withSettings = (pairs) => clockLocationConfig(pairs.map(([key, value]) => ({ key, value })));
const FULL = [
  [CLOCK_LOCATION_KEYS.latitude, '39.277157'],
  [CLOCK_LOCATION_KEYS.longitude, '-78.238330'],
  [CLOCK_LOCATION_KEYS.margin, '1000'],
];
check('all three set is enforced', withSettings(FULL).configured, true);
check('values are read as numbers', withSettings(FULL).latitude, 39.277157);
check('margin is read as a number', withSettings(FULL).marginFeet, 1000);
check('no latitude means off', withSettings(FULL.slice(1)).configured, false);
check('no longitude means off', withSettings([FULL[0], FULL[2]]).configured, false);
check('no margin means off', withSettings(FULL.slice(0, 2)).configured, false);
check('nothing set means off', withSettings([]).configured, false);
check('and says which key is missing', withSettings(FULL.slice(0, 2)).missing, [CLOCK_LOCATION_KEYS.margin]);
check('and says all three when empty', withSettings([]).missing.length, 3);
check('an empty settings array is off', clockLocationConfig([]).configured, false);
check('undefined settings are off', clockLocationConfig(undefined).configured, false);
check('a plain object map works too', clockLocationConfig({ required_clock_latitude: '39.2', required_clock_longitude: '-78.2', gps_margin_of_error: '500' }).configured, true);

console.log('\n--- and when off, clocking behaves exactly as before ---');
const off = clockLocationConfig([]);
check('a location is not required', evaluateClockLocation({ latitude: null, longitude: null }, off).allowed, true);
check('with the disabled code', evaluateClockLocation({ latitude: null, longitude: null }, off).code, 'disabled');
check('a far-away location is allowed', evaluateClockLocation({ latitude: 0, longitude: 0 }, off).allowed, true);
check('and there is no message', evaluateClockLocation(null, off).message, '');

console.log('\n--- blank cells versus unreadable ones ---');
check('a blank latitude is not required', parseLatitude(''), null);
check('a whitespace-only latitude is not required', parseLatitude('   '), null);
check(
  'but a word is reported, not ignored',
  clockLocationConfig([{ key: CLOCK_LOCATION_KEYS.latitude, value: 'north' }]).invalid,
  [CLOCK_LOCATION_KEYS.latitude]
);
check(
  'and so is a thousands separator',
  clockLocationConfig([{ key: CLOCK_LOCATION_KEYS.margin, value: '1,000' }]).invalid,
  [CLOCK_LOCATION_KEYS.margin]
);
check(
  'and a unit suffix',
  clockLocationConfig([{ key: CLOCK_LOCATION_KEYS.margin, value: '1000ft' }]).invalid,
  [CLOCK_LOCATION_KEYS.margin]
);
check('"1000" is fine', clockLocationConfig([{ key: CLOCK_LOCATION_KEYS.margin, value: '1000' }]).invalid, []);
check('a decimal is fine', clockLocationConfig([{ key: CLOCK_LOCATION_KEYS.margin, value: '250.5' }]).invalid, []);

console.log('\n--- range and sign ---');
check('latitude accepts the equator', parseLatitude('0'), 0);
check('latitude accepts negative', parseLatitude('-39.277157'), -39.277157);
check('latitude rejects 91', parseLatitude('91'), null);
check('latitude rejects -90.5', parseLatitude('-90.5'), null);
check('latitude accepts the pole', parseLatitude('90'), 90);
check('longitude accepts 180', parseLongitude('180'), 180);
check('longitude rejects 181', parseLongitude('181'), null);
check('longitude accepts negative', parseLongitude('-78.23833'), -78.23833);
check('a zero margin is off, not an instant lockout', parseMarginFeet('0'), null);
check('a negative margin is off', parseMarginFeet('-5'), null);
check('a zero margin disables the fence', withSettings([FULL[0], FULL[1], [CLOCK_LOCATION_KEYS.margin, '0']]).configured, false);
check('a plus sign is accepted', parseMarginFeet('+250'), 250);
check('a leading decimal point is accepted', parseMarginFeet('.5'), 0.5);

console.log('\n--- reading settings rows ---');
check('finds a key in the array shape the API returns', settingValue(FULL.map(([key, value]) => ({ key, value })), 'gps_margin_of_error'), '1000');
check('a missing key is undefined', settingValue([], 'gps_margin_of_error'), undefined);
check('a key with no matching entry is undefined', settingValue([{ key: 'other', value: 'x' }], 'gps_margin_of_error'), undefined);
check('numbers pass through', settingValue([{ key: 'gps_margin_of_error', value: 1000 }], 'gps_margin_of_error'), 1000);
check('null settings are safe', settingValue(null, 'gps_margin_of_error'), undefined);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);



