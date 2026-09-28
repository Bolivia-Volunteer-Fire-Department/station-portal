/**
 * Verifies the certification rules in Code.gs, and the wiring that makes them reach a screen.
 *
 * The bug this file exists for was reported from the far end: a member's certification started 2026-08-28 and
 * the app said "Not yet effective" on 2026-09-27. Nothing about the dates was wrong - what came back out of the
 * sheet was a DATE, because Google Sheets coerces a date-like string written to a general-formatted cell, and
 * `String(date)` is "Fri Aug 28 2026 00:00:00 GMT-0400". Compared against "2026-09-27" as strings, "F" beats
 * "2", so the certification looked like it was in the future for ever. The file compares date keys as strings
 * everywhere, which only works if every path normalizes on the way out, so that is what is tested here as
 * well as the rules themselves.
 *
 * The real functions are extracted from Code.gs and run against a fake sheet, the same way
 * verify-push-devices.mjs does it - so this exercises the code that ships rather than a description of it.
 *
 * Run with: npm run verify:certifications
 */
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};
const checkIs = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` -> ${detail}`}`);
};

const codeSource = readFileSync('src/services/Code.gs', 'utf8');

// The two sheet names, mirroring the constants in Code.gs - the harness exports them too, and a mismatch would
// show up as every lookup returning nothing rather than as a silent pass.
const CERT_SETUP_NAME = 'certification_setup';
const CERT_RECORD_NAME = 'certifications';

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

// The real functions, with the two things Apps Script supplies stubbed: the clock (a fixed "today" is the only
// way to test a warning window) and the timezone formatter (deterministic, from the date's UTC parts - the
// sheets in these tests are built with Date.UTC, so a real timezone would only add noise).
const HARNESS = `
  ${constSource('CERT_SETUP_SHEET')}
  ${constSource('CERT_SHEET')}
  ${extract('getSheetData')}
  ${extract('isTruthyValue')}
  ${extract('pad2')}
  ${extract('toDateKeyValue')}
  ${extract('todayDateKey')}
  ${extract('certificationTypes')}
  ${extract('certificationTypeIndex')}
  ${extract('certificationRecords')}
  ${extract('certificationTodayKey')}
  ${extract('certificationDaysUntil')}
  ${extract('certificationState')}
  ${extract('certificationsForUser')}
  ${extract('certificationsExpiringForUser')}
  ${extract('certificationBadgeIndex')}
  return {
    certificationState, certificationDaysUntil, certificationsForUser, certificationsExpiringForUser,
    certificationBadgeIndex, certificationRecords, certificationTodayKey, CERT_SETUP_SHEET, CERT_SHEET
  };
`;

// A sheet good enough for getSheetData: header row plus rows, values exactly as the sheet would hold them -
// which is the point of the Date case below.
class FakeSheet {
  constructor(rows) {
    this.rows = rows;
  }
  getDataRange() {
    return { getValues: () => this.rows.map((row) => row.slice()) };
  }
}

const SETUP_HEADERS = ['id', 'name', 'icon', 'sort_order', 'warn_days_before', 'is_renewable', 'show_next_to_name', 'description'];
const RECORD_HEADERS = ['id', 'user_id', 'certification_id', 'effective_date', 'end_date', 'notes', 'updated_at'];

// A certification type, with the defaults this feature cares about. `warn` blank is "do not warn".
const type = ({ id = 'c1', name = 'EMT', icon = 'cross', warn = '', renewable = 'TRUE', beside = '' } = {}) =>
  [id, name, icon, '', warn, renewable, beside, ''];

// A record. `effective` and `end` may be strings (what the app writes), Dates (what Sheets stores back) or ''.
const record = ({ id = 'r1', user = 'u1', cert = 'c1', effective = '', end = '', notes = '' } = {}) =>
  [id, user, cert, effective, end, notes, ''];

const makeBackend = ({ setup = [type()], records = [] } = {}) => {
  const sheets = {
    [CERT_SETUP_NAME]: new FakeSheet([SETUP_HEADERS.slice(), ...setup.map((row) => row.slice())]),
    [CERT_RECORD_NAME]: new FakeSheet([RECORD_HEADERS.slice(), ...records.map((row) => row.slice())]),
  };
  const ss = { getSheetByName: (name) => sheets[name] || null };
  const Logger = { log: () => {} };

  const backend = new Function('Logger', 'Utilities', HARNESS)(Logger, {
    formatDate: (date) => {
      const pad = (value) => (value < 10 ? `0${value}` : String(value));
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    },
  });

  return { backend, ss, sheets };
};


// ---------------------------------------------------------------------------
// The regression: a sheet cell holding a real Date
// ---------------------------------------------------------------------------
console.log('\n--- a date the sheet read back as a Date, not as text ---');
// Exactly what was reported: certified from 2026-08-28, read on 2026-09-27, shown as "not yet effective".
// Sheets coerces the written string into a DATE value, so this is the ordinary case rather than an odd one.
{
  const { backend, ss } = makeBackend({
    records: [record({ effective: new Date(Date.UTC(2026, 7, 28)) })],
  });

  const [row] = backend.certificationsForUser(ss, 'u1', '2026-09-27');
  check('the date is read as a key, not stringified', row.effective_date, '2026-08-28');
  check('so the certification is active', row.state, 'active');
}
{
  const { backend, ss } = makeBackend({
    setup: [type({ warn: '30' })],
    records: [record({ effective: new Date(Date.UTC(2025, 7, 28)), end: new Date(Date.UTC(2026, 9, 15)) })],
  });

  const [row] = backend.certificationsForUser(ss, 'u1', '2026-09-27');
  check('an end date is read as a key too', row.end_date, '2026-10-15');
  check('and the countdown is counted from it', row.days_until_end, 18);
  check('so the warning window applies', row.state, 'expiring');
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------
console.log('\n--- where a certification stands ---');
const stateOf = (backend, ss, today) => backend.certificationsForUser(ss, 'u1', today)[0].state;

{
  const withWarn = makeBackend({
    setup: [type({ warn: '30' })],
    records: [record({ effective: '2024-01-01', end: '2026-10-10' })],
  });
  check('inside the window it is expiring', stateOf(withWarn.backend, withWarn.ss, '2026-09-27'), 'expiring');
  check('on the day itself it still has not expired', stateOf(withWarn.backend, withWarn.ss, '2026-10-10'), 'expiring');
  check('the day after it has', stateOf(withWarn.backend, withWarn.ss, '2026-10-11'), 'expired');
  check('and outside the window it is simply current', stateOf(withWarn.backend, withWarn.ss, '2026-08-01'), 'active');
}
{
  // A blank window is "do not warn", which is NOT the same as zero days - the difference between a station
  // tracking a certificate quietly and nagging about it.
  const quiet = makeBackend({
    setup: [type({ warn: '' })],
    records: [record({ effective: '2024-01-01', end: '2026-09-30' })],
  });
  check('a blank window never warns', stateOf(quiet.backend, quiet.ss, '2026-09-27'), 'active');
  check('but the date still expires', stateOf(quiet.backend, quiet.ss, '2026-10-01'), 'expired');
  check('so it is not in the sign-in notice', quiet.backend.certificationsExpiringForUser(quiet.ss, 'u1', '2026-09-27'), []);
}
{
  const zero = makeBackend({
    setup: [type({ warn: '0' })],
    records: [record({ effective: '2024-01-01', end: '2026-09-27' })],
  });
  check('zero days warns on the day', stateOf(zero.backend, zero.ss, '2026-09-27'), 'expiring');
  check('and not the day before', stateOf(zero.backend, zero.ss, '2026-09-26'), 'active');
}
{
  const forever = makeBackend({ records: [record({ effective: '2020-05-01' })] });
  check('no end date never expires', stateOf(forever.backend, forever.ss, '2036-01-01'), 'active');

  const future = makeBackend({ records: [record({ effective: '2027-01-01' })] });
  check('a future start is not yet effective', stateOf(future.backend, future.ss, '2026-09-27'), 'upcoming');

  const undated = makeBackend({ records: [record({})] });
  check('and an undated one counts as always having applied', stateOf(undated.backend, undated.ss, '2026-09-27'), 'active');
}


console.log('\n--- the warning a member signs in to ---');
{
  const { backend, ss } = makeBackend({
    setup: [type({ warn: '30' }), type({ id: 'c2', name: 'EVOC', warn: '' })],
    records: [
      record({ id: 'r1', cert: 'c1', effective: '2024-01-01', end: '2026-10-05' }),
      record({ id: 'r2', cert: 'c2', effective: '2024-01-01', end: '2026-09-28' }),
      record({ id: 'r3', cert: 'c1', effective: '2020-01-01', end: '2025-01-01' }),
    ],
  });

  const alerts = backend.certificationsExpiringForUser(ss, 'u1', '2026-09-27');
  // The EVOC has no window, so it is never mentioned; the lapsed EMT period is, or a licence that quietly
  // expired would never be spoken of again.
  check('only the ones with a window, plus anything lapsed', alerts.map((row) => `${row.id}:${row.state}`), ['r1:expiring', 'r3:expired']);
  check('another member is told nothing', backend.certificationsExpiringForUser(ss, 'u2', '2026-09-27'), []);
}

console.log('\n--- the icon beside a name ---');
{
  const { backend, ss } = makeBackend({
    setup: [type({ id: 'c1', icon: 'cross', beside: 'TRUE' }), type({ id: 'c2', name: 'Quiet', beside: '' })],
    records: [
      record({ id: 'r1', cert: 'c1', effective: '2024-01-01', end: '2026-12-31' }),
      record({ id: 'r2', cert: 'c2', effective: '2024-01-01' }),
    ],
  });

  check('only the types that asked for one', backend.certificationBadgeIndex(ss, '2026-09-27').u1.map((badge) => badge.icon), ['cross']);
}
{
  // The badge is a claim about somebody, so it goes when the certification does.
  const expired = makeBackend({
    setup: [type({ icon: 'cross', beside: 'TRUE' })],
    records: [record({ effective: '2020-01-01', end: '2025-01-01' })],
  });
  check('an expired certification shows no badge', expired.backend.certificationBadgeIndex(expired.ss, '2026-09-27'), {});

  const upcoming = makeBackend({
    setup: [type({ icon: 'cross', beside: 'TRUE' })],
    records: [record({ effective: '2027-01-01' })],
  });
  check('nor does one that has not started', upcoming.backend.certificationBadgeIndex(upcoming.ss, '2026-09-27'), {});
}
{
  // Renewals are separate rows, so one type appears more than once for a member: one badge, not two.
  const renewed = makeBackend({
    setup: [type({ icon: 'cross', beside: 'TRUE' })],
    records: [
      record({ id: 'r1', effective: '2020-01-01', end: '2022-01-01' }),
      record({ id: 'r2', effective: '2022-01-01', end: '2030-01-01' }),
    ],
  });
  const badges = renewed.backend.certificationBadgeIndex(renewed.ss, '2026-09-27').u1;
  check('one badge per type, however many periods', badges.length, 1);
}

console.log('\n--- a missing sheet is empty, not a crash ---');
{
  const { backend, ss } = makeBackend({ setup: [], records: [] });
  check('no types and no records reads as nothing', backend.certificationsForUser(ss, 'u1', '2026-09-27'), []);
  check('and no badges', backend.certificationBadgeIndex(ss, '2026-09-27'), {});
}
{
  const { backend, ss } = makeBackend({ setup: [type()], records: [record({ effective: '2024-01-01' })] });
  // A record whose type has been deleted from the catalog is dropped from the catalog lookups but still shown,
  // with a blank name - visible is better than a row that vanishes unexplained.
  const orphan = backend.certificationsForUser(ss, 'u1', '2026-09-27');
  checkIs('an orphaned record is still returned', orphan.length >= 1, `${orphan.length}`);
}

console.log('\n--- the wiring the reported bugs were about ---');
// Two of these are the reasons the feature was invisible when it shipped: a permission with no column yet, and
// a member's own module gated behind it.
const permissions = readFileSync('src/utils/permissions.js', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.jsx', 'utf8');
const memberModule = readFileSync('src/components/CertificationsModule.jsx', 'utf8');
const adminTab = readFileSync('src/components/admin/AdminCertificationsTab.jsx', 'utf8');
const setupTab = readFileSync('src/components/admin/AdminCertificationSetupTab.jsx', 'utf8');
const rankIcon = readFileSync('src/components/RankIcon.jsx', 'utf8');
const iconPicker = readFileSync('src/components/IconPicker.jsx', 'utf8');

checkIs(
  'there is no member permission gating your own certifications',
  !/key: 'can_view_certifications'/.test(permissions),
  'a permission whose roles column does not exist yet hides the screen from everybody'
);
checkIs('so the module opens for everyone', /activeTab === 'certifications' && \(/.test(app));
checkIs('and its nav item is not gated either', /onClick=\{\(\) => \{ setActiveTab\('certifications'\)/.test(sidebar));
checkIs('while recording them still is', /key: 'can_manage_certifications'/.test(permissions) && /key: 'can_manage_certification_setup'/.test(permissions));

// The six actions, and who each one answers to.
checkIs('the member read is unprivileged', /case "GET_CERTIFICATIONS":/.test(codeSource) && !/can_manage_certifications/.test(extract('getAuthContext')));
['ADMIN_GET_CERTIFICATIONS', 'ADMIN_SAVE_CERTIFICATION', 'ADMIN_DELETE_CERTIFICATION'].forEach((action) => {
  checkIs(`${action} needs Manage certifications`, new RegExp(`case "${action}"[\\s\\S]{0,200}can_manage_certifications`).test(codeSource));
});
['ADMIN_SAVE_CERTIFICATION_SETUP', 'ADMIN_DELETE_CERTIFICATION_SETUP'].forEach((action) => {
  checkIs(`${action} needs Set up certifications`, new RegExp(`case "${action}"[\\s\\S]{0,220}can_manage_certification_setup`).test(codeSource));
});
checkIs('and a write is a write, so it takes the lock', !/GET_CERTIFICATIONS: true/.test(codeSource));

// The two server-side rules the screens cannot be trusted with, asserted as code rather than described.
checkIs('the server blanks the end date for a type that cannot be renewed', /certType\.is_renewable \? String\(data\.end_date/.test(codeSource));
checkIs('and refuses to delete a type that records still use', /records still use this certification/.test(codeSource));
checkIs('the client disables that field to match', /disabled=\{endDateOff\}/.test(adminTab) && /const endDateOff = !selectedType \|\| !selectedType\.is_renewable/.test(adminTab));

// The reported bug, asserted at the source: the dates must go through the normalizer.
checkIs('records normalize their dates on the way out', /effective_date: toDateKeyValue\(row\.effective_date\)/.test(codeSource));
checkIs('and "today" comes from the one helper that knows the station timezone', /function certificationTodayKey\(\) \{\s*return todayDateKey\(\);/.test(codeSource));
checkIs('the member module reads its own rows', /fetchCertifications\(token\)/.test(memberModule));

// ---------------------------------------------------------------------------------------------------------
// THE ICON SET, AND THE PICKER THAT CHOOSES FROM IT.
//
// A certification icon is the glyph a member is identified by at a glance, so the set it is chosen from is a
// real requirement rather than decoration: the sixteen requested (heart, heart-pulse, heart-plus, ambulance,
// briefcase-medical, scan-heart, square-activity, germ, van, toolbox, biohazard, radiation, sailboat, ship,
// life-buoy - plus the ones already there) must all be present, and each has to be a lucide export rather than
// a name that quietly renders a question mark. The build is what actually proves the last part; this checks
// that the map lists them, so a deletion here fails a test rather than shipping.
const REQUESTED_ICONS = [
  'heart',
  'heart-pulse',
  'heart-plus',
  'ambulance',
  'briefcase-medical',
  'scan-heart',
  'square-activity',
  'germ',
  'van',
  'toolbox',
  'biohazard',
  'radiation',
  'sailboat',
  'ship',
  'life-buoy',
];
// The key may be quoted or not: single-word names are written bare, the hyphenated ones need quotes.
const ICON_KEY = (name) => new RegExp(`(?:'${name}'|\\b${name}):\\s*\\w`);
// The lucide import block sits at the top of the file, above the map - so the component has to be found there,
// not after its entry.
const lucideImports = rankIcon.slice(0, rankIcon.indexOf("from 'lucide-react'"));
const missingIcons = REQUESTED_ICONS.filter((name) => !ICON_KEY(name).test(rankIcon));
check('the requested icons are all in the set', missingIcons, []);
REQUESTED_ICONS.forEach((name) => {
  const component = (rankIcon.match(new RegExp(`(?:'${name}'|\\b${name}):\\s*(\\w+)`)) || [])[1];
  checkIs(`and ${name} is imported from lucide`, !!(component && lucideImports.includes(component)), component);
});

// The dropdowns are gone. Every icon field is the visual picker, and none of them lists icon names any more.
const ICON_FIELDS = {
  'AdminCertificationSetupTab': setupTab,
  'AdminRanksTab': readFileSync('src/components/admin/AdminRanksTab.jsx', 'utf8'),
  'AdminAssignmentsTab': readFileSync('src/components/admin/AdminAssignmentsTab.jsx', 'utf8'),
  'AdminAnnouncementsTab': readFileSync('src/components/admin/AdminAnnouncementsTab.jsx', 'utf8'),
};
Object.entries(ICON_FIELDS).forEach(([file, src]) => {
  checkIs(`${file} picks icons visually`, src.includes('<IconPicker') && src.includes("from '../IconPicker'"));
  checkIs(`and has no icon dropdown left`, !/-- No Icon --|-- No icon --|-- Warning triangle --/.test(src));
});

// The picker itself: the three ways in, and the two ways out.
checkIs('the picker renders a grid of the icons', /grid-cols-6/.test(iconPicker) && /filtered\.map/.test(iconPicker));
checkIs('filters them as you type', /filtered/.test(iconPicker) && /placeholder="Search, or type a number/.test(iconPicker));
checkIs('offers a no-icon choice', /No icon<\/span>|No icon\b/.test(iconPicker) && /onClick=\{\(\) => choose\(''\)\}/.test(iconPicker));
checkIs(
  'and takes a number or roman numeral, which nothing in the set is',
  /const TYPED_ICON = \/\^\(\?:\\d\{1,2\}\|\[IVX\]\{1,4\}\)\$\//.test(iconPicker),
  'the icon set has no digits, so 1, 2 and III have to be drawn as text'
);
checkIs('it renders into the viewport so a card cannot clip it', /renderInViewport\(/.test(iconPicker) && /fixed z-50/.test(iconPicker));
checkIs('Escape closes it', /event\.key === 'Escape'/.test(iconPicker));
checkIs(
  'and so does scrolling, heard in the capture phase',
  /addEventListener\('scroll', onScroll, true\)/.test(iconPicker),
  'the forms scroll inside <main>, so a bubbling listener would never fire'
);

const SUMMARY = `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`;
console.log(SUMMARY);
process.exit(failures === 0 ? 0 : 1);
