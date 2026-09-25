/**
 * Verifies the clock-location notice that the refusal modal renders.
 *
 * The bug this exists because of: a clock action refused for being out of GPS range loaded for a
 * moment and then stopped, with NOTHING shown to the member. `statusMessage` - which the geofence
 * check used to write to - is only rendered by LoginScreen, so while signed in every clock message
 * was invisible. The refusal now goes to a modal, and this asserts the wording, the numbers and the
 * codes that reach it.
 *
 * The backend half is covered too: Code.gs must keep returning code "OUT_OF_RANGE" for a refused
 * clock action, because the client routes that code to the modal. If the two ever disagree, a server
 * refusal goes silently back to the invisible banner.
 *
 * Run with: npm run verify:clock-notice
 */
import { readFileSync } from 'node:fs';
import {
  OUT_OF_RANGE_CODE,
  clockLocationConfig,
  clockLocationNotice,
  evaluateClockLocation,
} from '../src/utils/clockLocation.js';

let failures = 0;
const check = (label, condition) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`);
};

// A configured station: 40.0,-75.0 with a 1,000 ft margin.
const settings = [
  { key: 'required_clock_latitude', value: '40' },
  { key: 'required_clock_longitude', value: '-75' },
  { key: 'gps_margin_of_error', value: '1000' },
];
const config = clockLocationConfig(settings);

const NEAR = { latitude: 40.0005, longitude: -75 };
const FAR = { latitude: 40.05, longitude: -75 };

console.log('--- the outcome the util reports ---');

const okOutcome = evaluateClockLocation(NEAR, config);
check('a nearby action is allowed', okOutcome.allowed === true);
check('and has no notice', clockLocationNotice(okOutcome, config) === null);

const farOutcome = evaluateClockLocation(FAR, config);
check('a distant action is refused', farOutcome.allowed === false);
check('with code "outside"', farOutcome.code === 'outside');

const noCoordsOutcome = evaluateClockLocation({ latitude: null, longitude: null }, config);
check('missing coordinates are refused', noCoordsOutcome.allowed === false);
check('with code "no-coords"', noCoordsOutcome.code === 'no-coords');

const offConfig = clockLocationConfig([]);
check('an unconfigured station allows anything', evaluateClockLocation(FAR, offConfig).allowed === true);
check('and produces no notice', clockLocationNotice(evaluateClockLocation(FAR, offConfig), offConfig) === null);

console.log('\n--- what the modal is handed ---');

const tooFar = clockLocationNotice(farOutcome, config);
check('a kind the modal knows', tooFar.kind === 'too-far');
check('a title', tooFar.title === 'Too far from the station');
check('the distance as a number', tooFar.distanceFeet === farOutcome.distanceFeet);
check('the limit as a number', tooFar.limitFeet === 1000);
check('a hint telling them to move closer', /move closer/i.test(tooFar.hint));
check('and the message names the limit', tooFar.message.includes('1,000'));

const noLocation = clockLocationNotice(noCoordsOutcome, config);
check('missing coordinates get their own kind', noLocation.kind === 'no-location');
check('a title of their own', noLocation.title === 'Location required');
check('no distance to report', noLocation.distanceFeet === null && noLocation.limitFeet === null);
check('and a hint about allowing access', /allow location access/i.test(noLocation.hint));

// The backend only reports that it refused, so the notice must still be useful.
const serverRefusal = clockLocationNotice({
  allowed: false,
  code: OUT_OF_RANGE_CODE,
  message: 'You are about 5,000 ft from the station, outside the 1,000 ft limit. Move closer and try again.',
});
check('a server refusal maps to the same kind', serverRefusal.kind === 'too-far');
check('and keeps the server wording', serverRefusal.message.includes('5,000 ft'));
check('with no numbers of its own to invent', serverRefusal.distanceFeet === null && serverRefusal.limitFeet === null);
check('and a hint covering both causes', /location access/i.test(serverRefusal.hint));

const bareServerRefusal = clockLocationNotice({ allowed: false, code: OUT_OF_RANGE_CODE });
check('a refusal with no message still has one', bareServerRefusal.message.length > 0);
check('and says to do it on site', /on site/i.test(bareServerRefusal.message));

// The whole point: an unrecognised refusal must NOT be silent.
const unknown = clockLocationNotice({ allowed: false, code: 'SOMETHING_NEW', message: 'Nope.' });
check('an unknown refusal still produces a notice', unknown !== null);
check('of a generic kind', unknown.kind === 'blocked');
check('carrying its message', unknown.message === 'Nope.');
check('and a next step', unknown.hint.length > 0);

check('a null outcome is not a refusal', clockLocationNotice(null) === null);
check('and neither is undefined', clockLocationNotice(undefined) === null);
check(
  'an allowed outcome never raises a notice, whatever else it carries',
  clockLocationNotice({ allowed: true, code: 'outside', message: 'stale' }) === null
);

// A malformed distance must not reach the modal as NaN, which would render as "NaN ft".
const brokenDistance = clockLocationNotice({ allowed: false, code: 'outside', distanceFeet: null, message: 'x' }, config);
check('a missing distance becomes null, not NaN', brokenDistance.distanceFeet === null);
check('while the limit is still named', brokenDistance.limitFeet === 1000);

console.log('\n--- the backend agreement the routing depends on ---');

let code = '';
try {
  code = readFileSync('src/services/Code.gs', 'utf8');
} catch {
  console.log('NOTE src/services/Code.gs not readable - skipping the backend checks');
}

if (code) {
  check('the backend still uses OUT_OF_RANGE', code.includes('code: "OUT_OF_RANGE"'));
  check('for clock-in', /clockInLocationError[\s\S]{0,200}code: "OUT_OF_RANGE"/.test(code));
  check('and for clock-out', /clockOutLocationError[\s\S]{0,200}code: "OUT_OF_RANGE"/.test(code));
  check('and the client constant matches it', code.includes(`"${OUT_OF_RANGE_CODE}"`));
}

console.log('\n--- the app routes both paths to the modal ---');

let app = '';
try {
  app = readFileSync('src/App.jsx', 'utf8');
} catch {
  console.log('NOTE src/App.jsx not readable - skipping the wiring checks');
}

if (app) {
  check('App renders the refusal modal', app.includes('<ClockBlockedModal'));
  check('only while a user and a notice are present', /\{currentUser && clockNotice && \(/.test(app));
  check('the client geofence refusal raises it', /if \(!locationCheck\.allowed\)[\s\S]{0,400}setClockNotice\(/.test(app));
  check('the server refusal raises it', /result\.code === OUT_OF_RANGE_CODE[\s\S]{0,300}setClockNotice\(/.test(app));
  check('a new attempt clears the previous notice', /const handleClockAction = async[\s\S]{0,300}setClockNotice\(null\)/.test(app));
  check('signing out clears it', /const handleLogout = \(\) => \{[\s\S]{0,400}setClockNotice\(null\)/.test(app));
  check('and so does an idle sign-out', /const endSession = useCallback[\s\S]{0,500}setClockNotice\(null\)/.test(app));
  // The bug: the refusal used to go somewhere invisible.
  check(
    'and the geofence refusal no longer writes to statusMessage',
    !/if \(!locationCheck\.allowed\)[\s\S]{0,400}setStatusMessage\(/.test(app)
  );

  const modal = readFileSync('src/components/ClockBlockedModal.jsx', 'utf8');
  check('the modal renders the title', modal.includes('notice.title'));
  check('the message', modal.includes('notice.message'));
  check('the hint', modal.includes('notice.hint'));
  check('the distance', modal.includes('notice.distanceFeet'));
  check('the limit', modal.includes('notice.limitFeet'));
  check('and a dismiss button', modal.includes('onDismiss'));
  check('with an accessible dialog role', modal.includes('role="dialog"'));
  // Assert the absence of a HANDLER, not of the word: the modal's own doc comment mentions that
  // there is no Escape-to-dismiss, which a naive /Escape/ match would read as one existing.
  check('and no key handler of its own', !modal.includes('onKeyDown') && !modal.includes("'keydown'"));
  // Exactly one dismiss control - the Got it button. A second would mean a backdrop click or an X
  // had crept in, which is how a member loses the explanation they were just given.
  check('and exactly one dismiss control', (modal.match(/onClick=\{onDismiss\}/g) || []).length === 1);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
