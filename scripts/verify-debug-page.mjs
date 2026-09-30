// Verifies the Debug page (Administration ▸ System ▸ Debug): the permission that opens it, the nav entry that
// reaches it, the buttons on it, and the one property that makes it safe to leave switched on for a station.
//
// What this exists for: a preview page fails in the one way that is invisible. A toast kind is added, a sound file
// is renamed, a modal gains a required prop - and the page still renders, still looks right, and has quietly
// stopped previewing the thing you would have reached for it to check. So most of what follows is CROSS-CHECKS
// against tables that already exist: every toast kind the wrapper can fire, every sound file the app ships, and
// every preview the page lists must all actually reach the page.
//
//   npm run verify:debug-page
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import AdminPanel, { ADMIN_NAV_CATEGORIES } from '../src/components/admin/AdminPanel.jsx';
import AdminDebugTab from '../src/components/admin/AdminDebugTab.jsx';
// The page's data, which is where its decisions live - the component is only the renderer, exactly as
// utils/soundRules is to utils/uiSounds.
import {
  DEBUG_PREVIEWS,
  OVERLAY_PREVIEW_MS,
  clockNoticePreviews,
  debugLoadingMessage,
  debugToastMessage,
  DEBUG_LONG_MESSAGE,
} from '../src/utils/debugPage.js';
import {
  ADMIN_PERMISSIONS,
  PERMISSION_KEYS,
  allowedAdminTabs,
  permissionTab,
  roleAllowsTab,
  roleFieldsFromForm,
  roleHasAdministration,
} from '../src/utils/permissions.js';
import { SOUND_FILES, TOAST_SOUNDS } from '../src/utils/uiSounds.js';
import { adminBarLabel } from '../src/utils/pageLabels.js';

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};
const checkEqual = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

console.log('\n--- the permission that opens it ---');
const debugPermission = ADMIN_PERMISSIONS.find((permission) => permission.key === 'can_access_debug');
check('the permission is declared', Boolean(debugPermission), 'no ADMIN_PERMISSIONS entry for can_access_debug');
checkEqual('and points at the debug tab', debugPermission && debugPermission.tab, 'debug');
check('with a label for the Roles editor', Boolean(debugPermission && debugPermission.label));
check('and a description saying what it grants', Boolean(debugPermission && debugPermission.description));
checkEqual('it is the tab id the nav uses', permissionTab('can_access_debug'), debugPermission && debugPermission.tab);
check('it is part of the permission set the Roles editor saves', PERMISSION_KEYS.includes('can_access_debug'));
checkEqual(
  'so a saved role carries it',
  roleFieldsFromForm({ can_access_debug: true }).can_access_debug,
  true
);
checkEqual('a role without it cannot use the tab', roleAllowsTab({ can_manage_roles: true }, 'debug'), false);
check('a role with it can', roleAllowsTab({ can_access_debug: true }, 'debug'), true);
checkEqual('and an unrecognized tab is still refused', roleAllowsTab({ can_access_debug: true }, 'debbug'), false);
check('is_admin passes it like every other tab', roleAllowsTab({ is_admin: true }, 'debug'), true);
check('a debug-only role counts as having Administration at all', roleHasAdministration({ can_access_debug: true }), true);
checkEqual(
  'and it lands on Debug first, not on Help',
  allowedAdminTabs({ can_access_debug: true })[0],
  'debug'
);

console.log('\n--- the nav entry that reaches it ---');
const debugCategory = ADMIN_NAV_CATEGORIES.find((category) =>
  category.items.some((item) => item.id === 'debug')
);
checkEqual('it lives under System', debugCategory && debugCategory.label, 'System');
checkEqual('labeled Debug', debugCategory && debugCategory.items.find((item) => item.id === 'debug').label, 'Debug');
checkEqual('with a bar label for the app bar', adminBarLabel('debug'), 'Debug');
checkEqual(
  'and System is still the last group before Help',
  ADMIN_NAV_CATEGORIES.find((c) => c.id === 'catSystem').items.map((item) => item.id),
  ['system', 'notifications', 'system-log', 'debug', 'help']
);

const panelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
check('the panel renders it', /<AdminDebugTab/.test(panelSource), 'AdminPanel.jsx has no AdminDebugTab');
check(
  'only while its tab is open, like the log',
  /activeSubTab === 'debug' && <AdminDebugTab/.test(panelSource),
  'the Debug tab would mount on every Administration screen'
);
check(
  'and hands it the station settings, for the overlay wording',
  /<AdminDebugTab systemSettings=\{systemSettings\} \/>/.test(panelSource)
);

// The source checks above say the panel renders the tab. This says the GATE works: the same panel, driven by two
// different roles, must reach the Debug page for one and be unable to for the other. Rendered rather than read,
// because a permission that is declared and then never consulted looks identical from the source.
const debugOnlyPanel = renderToString(
  React.createElement(AdminPanel, {
    currentRole: { can_access_debug: true },
    systemSettings: [{ key: 'loading_message0', value: 'Fetching the schedule…' }],
  })
);
check(
  'a role with the permission lands on the Debug page',
  debugOnlyPanel.includes('data-debug-preview="overlay"'),
  'the panel did not render the debug controls for a role that has the permission'
);
const otherPermissionPanel = renderToString(
  React.createElement(AdminPanel, { currentRole: { can_manage_roles: true } })
);
check(
  'and a role without it cannot reach that page',
  !otherPermissionPanel.includes('data-debug-preview='),
  'the Debug page rendered for a role that does not have can_access_debug'
);
check(
  'which is the same panel, only a different role',
  otherPermissionPanel.length > 0 && !otherPermissionPanel.includes('Fires the app')
);

// The transport, stubbed BEFORE anything renders. The page's safety claim is that it asks for nothing and makes no
// noise on its own, and a stub is the only way to show either. (This is not a sound test - verify-sound-fetch owns
// that - it only has to be able to say the count is zero.)
const fetches = [];
const audios = [];
globalThis.fetch = (url) => {
  fetches.push(String(url));
  return Promise.resolve({ ok: true, blob: async () => new Blob([]) });
};
globalThis.Audio = class {
  constructor(src) {
    this.src = src;
    this.paused = true;
    this.currentTime = 0;
    this.preload = '';
    this.volume = 1;
    audios.push(this);
  }

  play() {
    return Promise.resolve();
  }
};

console.log('\n--- rendering the page ---');
const STATION_SETTINGS = [{ key: 'loading_message0', value: 'Fetching the schedule…' }];
const html = renderToString(React.createElement(AdminDebugTab, { systemSettings: STATION_SETTINGS }));
// React separates two adjacent text nodes with `<!-- -->` (the number and the "%" beside it), which no reader ever
// sees and no assertion should have to spell out. Text assertions read this version; the raw one is used where the
// markup itself is the subject.
const htmlText = html.replace(/<!--[\s\S]*?-->/g, '');
check('it renders', html.length > 500, `rendered ${html.length} characters`);
checkEqual('and asks the backend for nothing', fetches.length, 0);
checkEqual('and makes no noise by itself', audios.length, 0);

// Every toast kind, from the table the wrapper itself uses. A kind added there must appear here without anybody
// remembering to add a button - the failure this catches is a preview page that quietly stops previewing.
const toastKinds = Object.keys(TOAST_SOUNDS);
const missingToasts = toastKinds.filter((kind) => !html.includes(`${kind}</button>`));
check('every toast kind the app can fire has a button', missingToasts.length === 0, `missing: ${missingToasts.join(', ')}`);
check('the push notification has one too', html.includes('push notification</button>'));
check('and toasts can be cleared', html.includes('dismiss them all</button>'));

// Every sound file, from the same table the engine plays. A renamed or added file must reach the page.
const soundNames = Object.keys(SOUND_FILES);
const missingSounds = soundNames.filter((name) => !html.includes(`${name}</button>`));
check('every sound the app ships has a button', missingSounds.length === 0, `missing: ${missingSounds.join(', ')}`);
checkEqual(
  'and each one is silent itself, so the sample is the only thing heard',
  (html.match(/data-sound="none"/g) || []).length,
  // One per sound button, and one per level slider: a slider that clicked while being dragged would be competing
  // with the very level being judged.
  soundNames.length * 2
);

console.log('\n--- nothing is open until it is pressed ---');
check('no dialog is mounted on arrival', !html.includes('role="alertdialog"'));
check('no forced prompt either', !html.includes('Verification Required'));
check('and no overlay', !html.includes('Please Wait'));
checkEqual(
  'every button is a button, so the click layer covers them',
  (html.match(/type="button"/g) || []).length,
  (html.match(/<button/g) || []).length
);

console.log('\n--- every preview is listed and reachable ---');
checkEqual('the ids are unique', new Set(DEBUG_PREVIEWS.map((entry) => entry.id)).size, DEBUG_PREVIEWS.length);
DEBUG_PREVIEWS.forEach((entry) => {
  check(`"${entry.label}" has a button`, html.includes(`data-debug-preview="${entry.id}"`));
  check('and says what it shows for the reader', String(entry.description || '').length > 20);
});
check('the destructive confirmation is among them', DEBUG_PREVIEWS.some((entry) => entry.id === 'confirm-danger'));
check('and the forced password change', DEBUG_PREVIEWS.some((entry) => entry.id === 'password-change'));
checkEqual('the overlay preview clears itself', OVERLAY_PREVIEW_MS, 3000);

console.log('\n--- the previews use the real rules, not copies ---');
const notices = clockNoticePreviews();
checkEqual('the too-far refusal is the clock\u2019s own kind', notices.tooFar && notices.tooFar.kind, 'too-far');
checkEqual('with its title', notices.tooFar && notices.tooFar.title, 'Too far from the station');
checkEqual('and the limit it was configured with', notices.tooFar && notices.tooFar.limitFeet, 500);
check(
  'carrying a distance the rule computed, not one written here',
  Number(notices.tooFar && notices.tooFar.distanceFeet) > 500,
  `distanceFeet was ${notices.tooFar && notices.tooFar.distanceFeet}`
);
check(
  'and the wording that rule builds from it',
  /ft from the station, outside the 500ft limit/.test(String(notices.tooFar && notices.tooFar.message)),
  `message was ${JSON.stringify(notices.tooFar && notices.tooFar.message)}`
);
checkEqual('the no-location refusal is its own kind', notices.noLocation && notices.noLocation.kind, 'no-location');
check(
  'and tells the member what to do about it',
  /location access/i.test(String(notices.noLocation && notices.noLocation.hint))
);
checkEqual(
  'both carry everything ClockBlockedModal renders',
  [typeof notices.tooFar.title, typeof notices.tooFar.hint, typeof notices.noLocation.title],
  ['string', 'string', 'string']
);
checkEqual('the overlay says what this station says', debugLoadingMessage(STATION_SETTINGS), 'Fetching the schedule…');
checkEqual('a station with no messages gets the app default', debugLoadingMessage([]), 'Communicating with server...');
checkEqual(
  'and so does a blank one',
  debugLoadingMessage([{ key: 'loading_message_1', value: '   ' }]),
  'Communicating with server...'
);

console.log('\n--- the toast wording ---');
checkEqual('a short toast names its kind', debugToastMessage('success'), 'A test success toast, from the Debug page.');
checkEqual(
  'a long one carries the long copy',
  debugToastMessage('error', { long: true }),
  `A test error toast, deliberately long: ${DEBUG_LONG_MESSAGE}`
);
check('and it is long enough to wrap', DEBUG_LONG_MESSAGE.length > 180, `${DEBUG_LONG_MESSAGE.length} characters`);

console.log('\n--- and it can never change a row ---');
const tabSource = readFileSync('src/components/admin/AdminDebugTab.jsx', 'utf8');
const tabCode = tabSource.replace(/\/\/[^\n]*/g, '');
check('it imports no backend call', !/services\/api/.test(tabCode), 'the tab imports the api module');
check(
  'it is given nothing but the station settings, so it has nothing to send',
  /export default function AdminDebugTab\(\{ systemSettings = \[\] \}\)/.test(tabCode),
  'the signature takes a token or another handle'
);
check('and mentions no session token at all', !/authToken|sessionToken|\btoken:/.test(tabCode));
checkEqual('its one effect is the overlay timer', (tabCode.match(/useEffect\(/g) || []).length, 1);
check('which is guarded to that preview', /if \(preview !== 'overlay'\) return undefined;/.test(tabCode));
// The two prompts that normally submit are previews, so their handlers must refuse rather than report success - a
// page answering "success: true" would show a station a lie about something it had not done.
check(
  'the session-expired preview never reports success',
  /onReauth=\{async \(\) => \(\{[\s\S]{0,160}?success: false/.test(tabCode),
  'onReauth may be claiming success'
);
check(
  'nor does the password-change preview',
  /onPasswordChange=\{async \(\) => \(\{[\s\S]{0,160}?success: false/.test(tabCode),
  'onPasswordChange may be claiming success'
);

console.log('\n--- the level sliders ---');
checkEqual('one per sound', (html.match(/type="range"/g) || []).length, soundNames.length);
checkEqual(
  'each labeled for whoever cannot see it',
  (html.match(/aria-label="Volume for /g) || []).length,
  soundNames.length
);
checkEqual(
  'each stepped to a position the shipped mix can land on',
  (html.match(/step="0.05"/g) || []).length,
  soundNames.length
);
check('seeded from the shipped levels rather than from zero', htmlText.includes('>15%</span>'), 'the click ships at 15%');
check('a sound sharing the default says so', html.includes('(shared default)'));
check('and a sound with its own level names itself', html.includes('(click)'));
check('with a way back to the shipped mix for everything', html.includes('reset all levels'));
checkEqual(
  'and no row offers its own reset until it has been moved',
  (html.match(/>reset<\/button>/g) || []).length,
  0
);
check('the page says the levels are temporary', /when you sign out/.test(html));
check('and that they apply everywhere, not only here', /everywhere the app plays that sound/.test(html));

// The end of the session is what ends the experiment, and there are exactly two ways a session ends: the member
// signs out, or it times out. Both must put the levels back - otherwise the next person to sign in on this machine
// gets somebody else's test mix, and nothing on screen would explain why the app sounded wrong.
console.log('\n--- and a level belongs to the session that set it ---');
const appSource = readFileSync('src/App.jsx', 'utf8');
const funnelSource = (name, next) => {
  const start = appSource.indexOf(`const ${name} = `);
  const end = appSource.indexOf(next, start);
  return start === -1 ? '' : appSource.slice(start, end === -1 ? appSource.length : end);
};
check('signing out resets the levels', /resetSoundVolumes\(\)/.test(funnelSource('handleLogout', 'const endSession')));
check(
  'and so does a session running out',
  /resetSoundVolumes\(\)/.test(funnelSource('endSession', '// The idle timer')),
  'endSession does not reset them'
);
check('the reset is the engine\u2019s own, not a local variable', /resetSoundVolumes/.test(appSource));
check(
  'and it is imported from the engine',
  /resetSoundVolumes,?\s*\n\} from '\.\/utils\/uiSounds'/.test(appSource),
  'App.jsx does not import resetSoundVolumes from utils/uiSounds'
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
