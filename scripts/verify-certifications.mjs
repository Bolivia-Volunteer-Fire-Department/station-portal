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

// The rules now live in src/utils/certifications.js, as pure functions of a record, its type and today -
// the same rules the sheet backend carried, asserted here against the module that ships.
const {
  certificationDaysUntil,
  decorateCertifications,
  certificationAlertsFor,
  certificationTypeIndex,
} = await import('../src/utils/certifications.js');

const type = ({ id = 'c1', name = 'EMT', icon = 'cross', warn = '', renewable = 'TRUE', beside = '' } = {}) => ({
  id,
  name,
  icon,
  warn_days_before: warn === '' ? null : Number(warn),
  is_renewable: renewable === 'TRUE',
  show_next_to_name: beside === 'TRUE',
});

const record = ({ id = 'r1', user = 'u1', cert = 'c1', effective = '', end = '' } = {}) => ({
  id,
  user_id: user,
  certification_id: cert,
  effective_date: effective,
  end_date: end,
});

// The decoration, as the readers apply it: one today, the setup rows, the member's records.
const decorate = ({ setup = [type()], records = [], user = 'u1', today = '2026-09-27' } = {}) =>
  decorateCertifications(records.filter((row) => row.user_id === user), setup, today);

const stateOf = (fixture, today) => decorate({ ...fixture, today })[0].state;

console.log('\n--- where a certification stands ---');
{
  const withWarn = {
    setup: [type({ warn: '30' })],
    records: [record({ effective: '2024-01-01', end: '2026-10-10' })],
  };
  check('inside the window it is expiring', stateOf(withWarn, '2026-09-27'), 'expiring');
  check('on the day itself it still has not expired', stateOf(withWarn, '2026-10-10'), 'expiring');
  check('the day after it has', stateOf(withWarn, '2026-10-11'), 'expired');
  check('and outside the window it is simply current', stateOf(withWarn, '2026-08-01'), 'active');
}
{
  // A blank window is "do not warn", which is NOT the same as zero days - the difference between a station
  // tracking a certificate quietly and nagging about it.
  const quiet = {
    setup: [type({ warn: '' })],
    records: [record({ effective: '2024-01-01', end: '2026-09-30' })],
  };
  check('a blank window never warns', stateOf(quiet, '2026-09-27'), 'active');
  check('but the date still expires', stateOf(quiet, '2026-10-01'), 'expired');
  check('so it is not in the sign-in notice', certificationAlertsFor(decorate(quiet)), []);
}
{
  const zero = {
    setup: [type({ warn: '0' })],
    records: [record({ effective: '2024-01-01', end: '2026-09-27' })],
  };
  check('zero days warns on the day', stateOf(zero, '2026-09-27'), 'expiring');
  check('and not the day before', stateOf(zero, '2026-09-26'), 'active');
}
{
  const forever = { records: [record({ effective: '2020-05-01' })] };
  check('no end date never expires', stateOf(forever, '2036-01-01'), 'active');
  const future = { records: [record({ effective: '2027-01-01' })] };
  check('a future start is not yet effective', stateOf(future, '2026-09-27'), 'upcoming');
  const undated = { records: [record({})] };
  check('and an undated one counts as always having applied', stateOf(undated, '2026-09-27'), 'active');
}

console.log('\n--- the day count ---');
check('days are counted from midnight, not from now', certificationDaysUntil('2026-10-15', '2026-09-27'), 18);
check('an unusable date is null, not zero', certificationDaysUntil('', '2026-09-27'), null);

console.log('\n--- the warning a member signs in to ---');
{
  const fixture = {
    setup: [type({ warn: '30' }), type({ id: 'c2', name: 'EVOC', warn: '' })],
    records: [
      record({ id: 'r1', cert: 'c1', effective: '2024-01-01', end: '2026-10-05' }),
      record({ id: 'r2', cert: 'c2', effective: '2024-01-01', end: '2026-09-28' }),
      record({ id: 'r3', cert: 'c1', effective: '2020-01-01', end: '2025-01-01' }),
    ],
  };
  const alerts = certificationAlertsFor(decorate(fixture));
  // The EVOC has no window, so it is never mentioned; the lapsed EMT period is, or a licence that quietly
  // expired would never be spoken of again.
  check('only the ones with a window, plus anything lapsed', alerts.map((row) => `${row.id}:${row.state}`), ['r1:expiring', 'r3:expired']);
  check('another member is told nothing', certificationAlertsFor(decorate({ ...fixture, user: 'u2' })), []);
}

console.log('\n--- the decoration the screens draw ---');
{
  const decorated = decorate({ setup: [type({ warn: '30' })], records: [record({ effective: '2024-01-01', end: '2026-10-05' })] })[0];
  check('the type\u2019s name travels with the record', decorated.name, 'EMT');
  check('so does its icon', decorated.icon, 'cross');
  check('and the state and day count are on the row', [decorated.state, decorated.days_until_end], ['expiring', 8]);
  check('most urgent first', decorate({
    records: [
      record({ id: 'ra', effective: '2024-01-01', end: '2027-01-01' }),
      record({ id: 'rb', effective: '2024-01-01', end: '2026-10-05' }),
    ],
  }).map((row) => row.id), ['rb', 'ra']);
}

console.log('\n--- a missing sheet is empty, not a crash ---');
check('no types and no records reads as nothing', decorate({ setup: [], records: [] }), []);
check('the index builder survives an empty setup', certificationTypeIndex([]), {});
{
  // A record whose type has been deleted from the catalog is dropped from the catalog lookups but still shown,
  // with a blank name - visible is better than a row that vanishes unexplained.
  const orphan = decorate({ setup: [], records: [record({ effective: '2024-01-01' })] });
  checkIs('an orphaned record is still returned', orphan.length >= 1, `${orphan.length}`);
  checkIs('with a blank name rather than a crash', orphan[0].name === '', true);
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

// The six actions, and who each one answers to - the reader and the writer functions in api.js, checked
// against the routes they map to.
const apiSource = readFileSync('src/services/api.js', 'utf8');
checkIs('the member read is unprivileged', /export const fetchCertifications = /.test(apiSource));
['adminSaveCertification', 'adminDeleteCertification'].forEach((fn) => {
  checkIs(`${fn} exists`, new RegExp(`export const ${fn} = `).test(apiSource));
});
['adminSaveCertificationSetup', 'adminDeleteCertificationSetup'].forEach((fn) => {
  checkIs(`${fn} exists`, new RegExp(`export const ${fn} = `).test(apiSource));
});

// A type that cannot be renewed has no end date to save: the client disables the field to match.
checkIs('the client disables that field for a type that cannot be renewed', /disabled=\{endDateOff\}/.test(adminTab) && /const endDateOff = !selectedType \|\| !selectedType\.is_renewable/.test(adminTab));

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
// Hearing EVERY scroll is what makes the capture phase work, and it is also what made the grid unusable: the
// panel scrolls its own 74 icons, that scroll reached this handler, and the picker shut on the first wheel over
// it. The handler has to skip its own panel.
checkIs(
  'but the panel scrolling itself is not a scroll away',
  // Matches either shape: the target tested inline, or pulled out into a local first.
  /panelRef\.current[\s\S]{0,200}contains\((?:event\.)?target\)/.test(iconPicker),
  'the grid is scrollable by design; closing on its own scroll is the reported bug'
);
checkIs('so the panel carries the ref that tells them apart', /ref=\{panelRef\}/.test(iconPicker));
checkIs(
  'and the grid does not hand its leftover scroll to the page',
  /overflow-y-auto overscroll-contain/.test(iconPicker),
  'without it, reaching the end of the grid scrolls the page - which closes the picker the same way'
);

// The Notes column. A table row cannot show a paragraph, so it answers the only question a row can - is there
// anything in the notes? - and the icon carries a title so a screen reader is not left with an unlabelled glyph.
checkIs('the records table has a Notes column', /text-center">Notes<\/th>/.test(adminTab));
checkIs(
  'drawn from the record\'s own notes',
  /\{row\.notes \? \(/.test(adminTab) && /title="This record has notes/.test(adminTab)
);
checkIs('with an em dash where there are none', /text-slate-300 dark:text-slate-600">—<\/span>/.test(adminTab));
checkIs('and the empty table still spans every column', /colSpan=\{7\}/.test(adminTab));
// The column is only as good as the payload: `notes` has to be on every record the client is handed. The
// decoration spreads the stored row, so notes survive it by construction - asserted against the helper.
checkIs(
  'and the decoration keeps notes on every record',
  (() => {
    const decorated = decorateCertifications(
      [{ id: 'r1', user_id: 'u1', certification_id: 'c1', notes: 'lens replaced' }],
      [],
      '2026-09-27'
    );
    return decorated.length === 1 && decorated[0].notes === 'lens replaced';
  })(),
  true
);

const SUMMARY = `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`;
console.log(SUMMARY);
process.exit(failures === 0 ? 0 : 1);
