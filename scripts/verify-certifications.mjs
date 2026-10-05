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
// The badge rule, from the pure module the app's rebuild AND scripts/normalize-certification-badges.mjs both use - plus
// that script's plan, so the decision that deletes badge documents is tested without a database.
import { badgeForRecord, badgeIndexFor } from '../src/utils/certificationBadges.js';
import { badgeRebuildPlan, refuseOnInvisibleRecords } from './normalize-certification-badges.mjs';

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
checkIs('Certification Setup includes the separate Show on Roster switch', /key: 'show_on_roster'/.test(setupTab) && /label: 'Show on Roster'/.test(setupTab));

// The six actions, and who each one answers to - the reader and the writer functions in api.js, checked
// against the routes they map to.
const apiSource = readFileSync('src/services/api.js', 'utf8');
checkIs('the switch is restored when editing and sent when saving', /show_on_roster: !!row\.show_on_roster/.test(setupTab) && /show_on_roster: certification\.show_on_roster === true/.test(apiSource));
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
checkIs('it renders into the viewport so a card cannot clip it', /renderInViewport\(/.test(iconPicker) && /fixed z-\[66\]/.test(iconPicker));
// AND ABOVE THE DIALOG LAYER (ViewportModal is z-[60]), because the editors that host this picker are dialogs
// and the panel renders to document.body: at the old popover-grade z-50 the dialog's own shade painted over the
// panel and swallowed every click - "the icon dropdown doesn't work, no icon can be chosen". The click-away
// catcher clears the dialog at z-[65]; the panel sits one step above it at z-[66]. Pinned so the dialog layer
// cannot rise past it again unnoticed.
checkIs('and above the dialog layer that hosts its callers', /z-\[65\]/.test(iconPicker) && /z-\[66\]/.test(iconPicker));
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

// THE BADGE ICON BESIDE A NAME - the regression these checks exist for.
//
// The icons stopped rendering next to member names everywhere except Schedule and Administration, and nothing was
// wrong with any of the screens that draw them. The badge index had left the sign-in payload (1.12) and rode onto
// GET_ROSTER, which is read for `schedule` and `admin` ONLY. So the dashboard's on-duty card and the sidebar's own
// badges - the two screens that draw names without being either of those - read from a map that was never filled, and
// simply drew bare names.
//
// The fix has to keep two things true at once, which is what these assert: the index REACHES every screen that draws a
// name, and the targeted read ADDS to the index rather than replacing it.
const {
  certificationBadgesFor,
  certificationBadgesLoaded,
  mergeCertificationBadges,
  setCertificationBadges,
  subscribeCertificationBadges,
} = await import('../src/utils/certifications.js');

console.log('\n--- the badge index beside a name ---');
{
  setCertificationBadges({});
  check('an unfilled index draws no icons', certificationBadgesFor('u1').length, 0);
  // The distinction that makes the targeted read possible at all. Without it, "holds nothing" and "nobody has asked"
  // are the same answer, and every render of a live on-duty list re-reads it.
  check('and is distinguishable from a member who holds none', certificationBadgesLoaded('u1'), false);

  setCertificationBadges({ u1: [{ id: 'c1', name: 'EMT', icon: 'cross' }] });
  check('a filled index draws them', certificationBadgesFor('u1').map((badge) => badge.id), ['c1']);
  check('and marks that member answered', certificationBadgesLoaded('u1'), true);

  // THE MERGE. The dashboard reads two members; the roster read has thirty. Both roads write here, and in either order
  // the answer must be the union - which is the whole reason this is a merge and not a second setter.
  mergeCertificationBadges({ u2: [{ id: 'c2', name: 'Hazmat', icon: 'flame' }] });
  check('a targeted read adds to the roster read', certificationBadgesFor('u2').map((badge) => badge.id), ['c2']);
  check('without disturbing what the roster read put in', certificationBadgesFor('u1').map((badge) => badge.id), ['c1']);

  // A member who was asked about and holds nothing: known, empty, and not asked again.
  mergeCertificationBadges({ u3: [] });
  check(
    'a member with no badges is known and empty',
    [certificationBadgesLoaded('u3'), certificationBadgesFor('u3').length],
    [true, 0]
  );
  check('which is not the same as never having been asked', certificationBadgesLoaded('u4'), false);

  // A re-read that comes back empty must erase the old badge: an empty answer means "this member has none now", which
  // is authoritative. An ABSENT key means "not in this reply", which is not, and must leave what is known alone.
  mergeCertificationBadges({ u1: [] });
  check('a fresh empty answer replaces the old one', certificationBadgesFor('u1').length, 0);

  // Guarding against a merge that quietly replaces the whole map, which is the exact regression shape.
  setCertificationBadges({ u1: [{ id: 'c1', name: 'EMT' }], u5: [{ id: 'c3', name: 'Rope' }] });
  mergeCertificationBadges({ u2: [{ id: 'c2', name: 'Hazmat' }] });
  check(
    'a merge keeps the members it says nothing about',
    [certificationBadgesFor('u1').length, certificationBadgesFor('u5').length],
    [1, 1]
  );
  check('and does not answer for anyone new', certificationBadgesLoaded('u9'), false);
}

console.log('\n--- a name already on screen redraws when the icons arrive ---');
{
  // THE BUG THAT OUTLIVED THE READ FIX, and the reason these checks exist.
  //
  // Fixing the READ was necessary and not sufficient. The index used to ride the sign-in payload, so it was in
  // hand BEFORE the first render and every name was drawn with its icons from the start. Once it became its own
  // read, the answer lands AFTER the first paint - and a module-level variable that is mutated is INVISIBLE to
  // React. The name had already been rendered with an empty index, and nothing ever asked it to render again, so
  // the icons never appeared. Every screen, which is why this read as "the badges are gone everywhere" and not as
  // a missing read.
  //
  // So the registry has to ANNOUNCE its changes. These pin the contract; the component that listens is asserted
  // below, and scripts/verify-badge-render.mjs proves the redraw against a real DOM.
  setCertificationBadges({});
  let woke = 0;
  const unsubscribe = subscribeCertificationBadges(() => {
    woke += 1;
  });

  setCertificationBadges({ u1: [{ id: 'c1', name: 'EMT' }] });
  check('filling the whole index wakes the listeners', woke, 1);

  mergeCertificationBadges({ u2: [{ id: 'c2', name: 'Hazmat' }] });
  check('so does a targeted read merging in', woke, 2);

  // A merge that re-delivers the SAME answer must not wake anyone: the dashboard re-reads the members it draws,
  // and waking every subscriber for an unchanged answer is a re-render per member per poll.
  mergeCertificationBadges({ u2: certificationBadgesFor('u2') });
  check('but re-delivering an unchanged answer does not', woke, 2);

  // The teardown React calls on unmount, and it has to actually unhook - a listener set that only grows would
  // re-render screens that are no longer mounted.
  unsubscribe();
  setCertificationBadges({});
  check('and an unsubscribed listener is not woken again', woke, 2);

  // useSyncExternalStore compares snapshots by IDENTITY, so the empty answer has to be one shared array rather
  // than a fresh [] per call, or the store re-renders for ever.
  checkIs(
    'the empty answer is a single stable array',
    certificationBadgesFor('nobody') === certificationBadgesFor('someone-else'),
    true
  );
  checkIs('and stays stable for a member nobody has asked about', certificationBadgesFor('u9') === certificationBadgesFor('u9'), true);
}

console.log('\n--- and the component is listening, not merely reading ---');
{
  // The half a read fix cannot reach. If this component reads the registry during render without subscribing,
  // every read in the app can be perfect and no icon will ever appear on a screen that was already painted.
  const component = readFileSync('src/components/CertificationBadges.jsx', 'utf8');
  checkIs(
    'the badge component subscribes to the index',
    /useSyncExternalStore\(\s*subscribeCertificationBadges/.test(component)
  );
  // Three arguments, not two. The harnesses in this repo render these screens with renderToString, which has no
  // store at all and THROWS without a server snapshot - so omitting it breaks the suite rather than the browser.
  const call = component.slice(component.indexOf('useSyncExternalStore('));
  checkIs(
    'and passes a server snapshot, because these screens are server-rendered in the harnesses',
    (call.match(/certificationBadgesFor\(userId\)/g) || []).length === 2
  );
}

console.log('\n--- the badge index reaches the screens that draw names ---');
{
  const reads = readFileSync('src/services/firestoreReads.js', 'utf8');
  const routing = readFileSync('src/services/firestoreRouting.js', 'utf8');

  // The roster read is still the WHOLE index, and is still gated on schedule/admin - that part was correct and stays.
  checkIs(
    'the roster read still carries the whole index for the screens that draw many names',
    /GET_ROSTER: async/.test(reads) && /certificationBadges: Object\.fromEntries\(badgeRows/.test(reads)
  );
  // And there is now a second road in, for the screens that draw two names.
  checkIs('a targeted read asks for named members', /GET_CERTIFICATION_BADGES: async/.test(reads));
  // A reader with no route is unreachable code - the exact shape this file already caught once with GET_ROSTER.
  checkIs('and the route is registered', /'GET_CERTIFICATION_BADGES'/.test(routing));

  // THE READ COST IS THE POINT. One `getDoc` per id is a bounded number of reads; a query over the collection would
  // bill the whole collection the moment a second member is named, which is what the sign-in payload change avoided.
  // Asserted against the READER'S OWN BODY, not the file, so the assertion cannot be satisfied by this reader and some
  // other reader in the same file doing the collection read it is supposed to be avoiding.
  const badgeReader = (() => {
    const at = reads.indexOf('GET_CERTIFICATION_BADGES: async');
    if (at < 0) return '';
    const start = reads.indexOf('async', at);
    return reads.slice(start, reads.indexOf('\n  },', start));
  })();
  checkIs(
    'by id, not by a collection query',
    /getDoc\(doc\(firestore\(\), 'certification_badges', id\)\)/.test(badgeReader) && !/collection\(/.test(badgeReader)
  );
  // `.exists()` is a METHOD in the client SDK. As a bare property reference it is truthy for every snapshot, so every
  // member would be reported as holding a blank badge instead of being absent from the answer.
  checkIs(
    'and it calls the method rather than testing the reference',
    /\.filter\(\(\[, snap\]\) => snap\.exists\(\)\)/.test(reads)
  );

  // The app asks for the members the screen actually draws.
  checkIs(
    'the signed-in member is always asked for, because the sidebar draws them on every screen',
    /ids\.add\(String\(currentUser\.id\)\)/.test(app)
  );
  checkIs(
    'and so is whoever is on duty, because the dashboard draws them',
    /activeTab === 'dashboard'[\s\S]{0,120}onDutyUsers\.forEach/.test(app)
  );
  // A member who holds nothing must not be re-read on every render of a live on-duty list.
  checkIs(
    'and members already answered are not asked for again',
    /badgeTargets\.filter\(\(id\) => !certificationBadgesLoaded\(id\)\)/.test(app)
  );
  // THE MERGE, at the call site. `setCertificationBadges` here would blank the other thirty.
  checkIs(
    'the app merges the answer rather than replacing the index',
    /mergeCertificationBadges\(badges\)/.test(app) && !/setCertificationBadges\(data\.badges/.test(app)
  );
  // The ids ASKED ABOUT are recorded even when they hold nothing - that is what stops the read repeating.
  checkIs(
    'recording which members were asked about, not just which hold badges',
    /\(data\.asked \|\| wanted\)/.test(app)
  );
}

console.log('\n--- the icons are drawn on BOTH kinds of shift pill that name a member ---');
{
  // Two screens draw a member's name on a coloured shift pill, and each is the answer to "who am I on with" at a
  // different moment: the member's own month (the crew view) and the officer's board. The pills are the worst surface
  // in the app to draw an icon on - the background is an ARBITRARY assignment colour with white text over it - so both
  // call the same component the same way, and the tone is asserted here because a fixed sky blue is unreadable on half
  // of a real station's colours.
  const calendarSource = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
  const boardSource = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');

  checkIs(
    'the member calendar draws them on the crew pill',
    /<MemberName[\s\S]{0,200}iconClassName=""/.test(calendarSource)
  );
  // THE BOARD DRAWS THEM THROUGH ITS OWN PILL BODY, which is the one place all three kinds of its pill are assembled
  // (see scripts/verify-rank-dot.mjs, which pins that shape). That is also why only ONE of the two appears: the fact
  // reaching the badge used to be exactly what a second pill branch could miss.
  checkIs(
    'and the board draws them in the shared pill body',
    /const pillBody = \([\s\S]{0,3000}?<CertificationBadges userId=\{memberId\}/.test(boardSource) &&
      (boardSource.match(/<CertificationBadges/g) || []).length === 1,
    `${(boardSource.match(/<CertificationBadges/g) || []).length} CertificationBadges on the board`
  );
  // The tone, read off the ELEMENT rather than counted across the file: the note above the call mentions the same
  // attribute in prose, so a count would be satisfied by a comment.
  const boardBadgeCall = (boardSource.match(/<CertificationBadges[\s\S]*?\/>/) || [''])[0];
  checkIs(
    'both of them letting the glyph inherit the pill text colour rather than a fixed sky',
    /iconClassName=""/.test(boardBadgeCall) && /iconClassName=""/.test(calendarSource),
    boardBadgeCall
  );
  // A VACANCY IS NOT A PERSON. The board draws every uncovered slot of the month, so a badge leaking onto that branch
  // would be a certification claimed for an assignment - and there would be a lot of them on screen.
  const vacancyCall =
    boardSource
      .split('{pillBody({')
      .slice(1)
      .map((call) => call.slice(0, call.indexOf('})}') + 3))
      .find((call) => call.includes('pending:')) || '';
  checkIs(
    'and a vacancy is handed no member to badge',
    Boolean(vacancyCall) && !/memberId:/.test(vacancyCall),
    vacancyCall || 'the empty-slot branch has stopped using pillBody'
  );
}

console.log('\n--- a badge appears when the officer saves ---');
{
  // The server rebuilds the index after a certification or setup save and RETURNS it with the reply. It was being
  // thrown away, so toggling "show as badge" changed nothing on screen until the next sign-in. The fix uses the answer
  // the write already paid for rather than re-reading it - the mindful half of the brief.
  //
  // AND THEN THAT SAME REPLY BROKE EVERYTHING, which is what the last two checks here exist for. App puts
  // `response.badges` straight into `setCertificationBadges`, which REPLACES the registry - so the SHAPE of the reply
  // is the screen. While the route answered with a summary of the rebuild (`{ members, cleared }`), saving one
  // certification replaced every member's icons with two numbers and blanked every badge on every screen, on the
  // Schedule module and the board as much as anywhere else. The wiring was asserted all along and the wiring was never
  // the fault: the field really was called `badges`, and the value really was about badges.
  const adminPanel = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');
  const routing = readFileSync('src/services/firestoreRouting.js', 'utf8');
  const writes = readFileSync('src/services/firestoreWrites.js', 'utf8');
  checkIs(
    'a certification record save hands the rebuilt index up',
    /onBadgesChanged\?\.\(response\.badges\)/.test(adminTab)
  );
  checkIs(
    'and so does a delete, which can remove a badge just as surely',
    adminTab.split('onBadgesChanged?.(response.badges)').length >= 3
  );
  checkIs('a setup save hands it up too', /onBadgesChanged\?\.\(response\.badges\)/.test(setupTab));
  checkIs('the panel carries it to App', /onBadgesChanged=\{onBadgesChanged\}/.test(adminPanel));
  // WHAT THE REPLY HOLDS - the half that was missing. The routes reply with a rebuilt index, so the rebuild has to
  // ANSWER with an index: a summary put under this name is a reply the registry replaces itself with.
  checkIs(
    'the badge routes reply with whatever the rebuild answered',
    /badges: await refreshCertificationBadges\(\)/.test(routing)
  );
  checkIs(
    'and the rebuild answers with the index itself, so there is no summary to mistake for one',
    /\n  return index;/.test(writes) && !/members: Object\.keys\(index\)/.test(writes),
    'a summary here is what App replaces the whole registry with - see the round trip in verify-firestore-writes'
  );
  checkIs(
    'which is what App uses it as, replacing the whole index with it',
    /onBadgesChanged=\{setCertificationBadges\}/.test(app)
  );
}

// -----------------------------------------------------------------------------------------------------------
// THE REBUILD RULE, AND THE PLAN A REPAIR SCRIPT PRODUCES BEFORE IT DELETES ANYTHING
// -----------------------------------------------------------------------------------------------------------
// The index is a DERIVED CACHE - one document per member beside `certifications` - and it went missing on a station that
// migrated records without it, which took the icons off every name with nothing on screen to say why. That made this rule
// the only thing that could bring them back without an officer editing a certification by hand.
//
// So the rule now lives in ONE pure place (utils/certificationBadges.js) that both the app's rebuild and the repair
// script use. That is the point of the assertions below: a second implementation would rebuild the index to something
// different from what the app draws, and the drift would be invisible until a badge appeared that should not.
console.log('\n--- the badge rule lives in one place ---');
{
  const writes = readFileSync('src/services/firestoreWrites.js', 'utf8');
  const script = readFileSync('scripts/normalize-certification-badges.mjs', 'utf8');

  checkIs('the app imports the shared rule rather than re-deriving it', /badgeIndexFor\(records, types, today\)/.test(writes));
  // The loop that used to live here is the one thing that could disagree with the script's, so it is asserted GONE by
  // name: `index[owner].push(badge)` was the only place the app built the index by hand.
  checkIs(
    'and the hand-written loop is gone from it',
    !/index\[owner\]\.push\(badge\)/.test(writes),
    'the app still builds the index itself, so the two can draw different badges'
  );
  checkIs('the repair script imports the same rule', /from '\.\.\/src\/utils\/certificationBadges\.js'/.test(script));
  checkIs(
    'and the app still re-exports the single-record rule for the harnesses that import it from there',
    /export \{ badgeForRecord \}/.test(writes)
  );
}

// The rule itself, exercised where it now lives. Each of these is a claim the app is making ABOUT A PERSON on a screen, so
// they are worth pinning individually rather than as one snapshot.
console.log('\n--- which records earn a badge ---');
{
  const emt = { id: 'c1', name: 'EMT', icon: 'heart-pulse', show_next_to_name: true };
  const noIcon = { id: 'c2', name: 'Driver', icon: '', show_next_to_name: true };
  const notShown = { id: 'c3', name: 'Defibrillator', icon: 'zap', show_next_to_name: false };
  const today = '2026-10-04';

  check('a current record of a type that asks to be shown earns its badge', badgeForRecord({ effective_date: '2026-01-01' }, emt, today), { id: 'c1', name: 'EMT', icon: 'heart-pulse' });
  check('an open-ended record does too', badgeForRecord({ effective_date: '2026-01-01', end_date: '' }, emt, today), { id: 'c1', name: 'EMT', icon: 'heart-pulse' });
  // THE THREE REFUSALS, each for the reason in the rule: a future licence is not a qualification today, a lapsed one is a
  // claim the station cannot back, and a type nobody asked to show is not an icon beside a name.
  check('a record that has not started yet earns nothing', badgeForRecord({ effective_date: '2026-12-01' }, emt, today), null);
  check('a lapsed record earns nothing', badgeForRecord({ effective_date: '2025-01-01', end_date: '2026-09-30' }, emt, today), null);
  check('a type with no icon to draw earns nothing', badgeForRecord({ effective_date: '2026-01-01' }, noIcon, today), null);
  check('a type not asked to be shown beside a name earns nothing', badgeForRecord({ effective_date: '2026-01-01' }, notShown, today), null);
  // The boundaries themselves: a record ending TODAY is still in force, and one starting today has started.
  checkIs('a record ending today is still in force', badgeForRecord({ effective_date: '2026-01-01', end_date: today }, emt, today) !== null);
  checkIs('and one starting today has started', badgeForRecord({ effective_date: today }, emt, today) !== null);

  // The whole index, which is what the document actually stores.
  const index = badgeIndexFor(
    [
      { user_id: 'u1', certification_id: 'c1', effective_date: '2026-01-01' },
      // A second period of the SAME type: one badge beside the name, not two.
      { user_id: 'u1', certification_id: 'c1', effective_date: '2025-01-01', end_date: '2025-12-31' },
      { user_id: 'u2', certification_id: 'c3', effective_date: '2026-01-01' },
      // A record with no owner cannot be drawn beside anybody's name.
      { user_id: '', certification_id: 'c1', effective_date: '2026-01-01' },
    ],
    [emt, notShown],
    today
  );
  check('the index gives each member one badge per type', index.u1, [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }]);
  check('and leaves a member who earns nothing out of it entirely', index.u2, undefined);
  check('so a missing document and an empty one mean the same thing', Object.keys(index), ['u1']);
}

console.log('\n--- what a repair would do, before it deletes anything ---');
{
  const emt = { id: 'c1', name: 'EMT', icon: 'heart-pulse', show_next_to_name: true };
  const records = [{ user_id: 'u1', certification_id: 'c1', effective_date: '2026-01-01' }];

  // The station this was written for: records exist, the index does not. Every member is reported as GAINING, and - the
  // point of the report - nothing as removed, because there is nothing stored to remove.
  const cold = badgeRebuildPlan({ records, types: [emt], stored: {}, today: '2026-10-04' });
  check('a station with no index at all reports every member as gaining', cold.gain, ['u1']);
  check('and nothing as removed', cold.remove, []);
  checkIs('which is not a no-op', cold.unchanged === false);

  // The second run, which is what makes the script safe to run twice.
  const warm = badgeRebuildPlan({ records, types: [emt], stored: cold.index, today: '2026-10-04' });
  checkIs('a second run over the same records has nothing to do', warm.unchanged, JSON.stringify(warm));

  // A member whose stored badge no longer matches the rule - the lapse case.
  const stale = badgeRebuildPlan({
    records: [],
    types: [emt],
    stored: { u9: [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }] },
    today: '2026-10-04',
  });
  check('a stored badge the rule no longer supports is reported as removed', stale.remove, ['u9']);

  // THE REFUSAL, and it is the one that matters: a run that cannot judge the records must not proceed, because the
  // rebuild deletes everything the index cannot account for.
  checkIs('a station with records and no readable types is refused', refuseOnInvisibleRecords(records, []).length > 0);
  checkIs('a station with neither is simply empty, not refused', refuseOnInvisibleRecords([], []) === '');
  checkIs('and one that can judge them proceeds', refuseOnInvisibleRecords(records, [emt]) === '');
}

const SUMMARY = `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`;
console.log(SUMMARY);
process.exit(failures === 0 ? 0 : 1);
