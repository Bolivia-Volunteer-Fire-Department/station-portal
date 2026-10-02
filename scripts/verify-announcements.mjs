/**
 * Verifies the announcement rules (utils/announcements).
 *
 * Three things could go wrong here in ways a reader would notice, and each is pinned:
 *
 *   1. The wrong people see it. The three targeting columns are read together (AND), not as a list of
 *      alternatives, and three blanks mean everyone.
 *   2. It shows somewhere it should not - or nowhere at all. A blank effective date must not hide an
 *      announcement created by hand, and at least one location is required to save one.
 *   3. **A targeted announcement leaking onto the login screen.** There is no signed-in reader there, so
 *      only announcements aimed at everyone may appear.
 *
 * Run with: npm run verify:announcements
 */
import { readFileSync } from 'node:fs';
import {
  ANNOUNCEMENT_ICON_FALLBACK,
  ANNOUNCEMENT_LOCATIONS,
  ANNOUNCEMENT_VARIANT_KEYS,
  announcementAudienceLabel,
  announcementAuthorLabel,
  announcementDismissalKey,
  announcementFlag,
  announcementIsLiveOn,
  announcementLocations,
  announcementShowsNowhere,
  announcementMatchesAudience,
  announcementReachesSomeone,
  announcementShowsIn,
  announcementTargetsEveryone,
  announcementValidation,
  announcementVariant,
  visibleAnnouncementsFor,
} from '../src/utils/announcements.js';

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

const base = {
  id: '1',
  title: 'Drill moved',
  message: 'Saturday drill moves to 0900.',
  effective_date: '2026-03-01',
  end_date: '',
  is_visible_on_login: 'TRUE',
  is_visible_on_dashboard: 'TRUE',
  is_visible_on_sidebar: 'FALSE',
  role_id: '',
  rank_id: '',
  user_id: '',
  icon: '',
  context_variant: 'warning',
  is_dismissable: 'FALSE',
};
const announcement = (overrides = {}) => ({ ...base, ...overrides });

console.log('--- sheet booleans and locations ---');
check('TRUE is true', announcementFlag('TRUE'), true);
check('a real boolean is true', announcementFlag(true), true);
check('FALSE is false', announcementFlag('FALSE'), false);
check('blank is false', announcementFlag(''), false);
check('a missing column is false', announcementFlag(undefined), false);
check('lowercase true is true', announcementFlag(' true '), true);

// `is_visible_on_login` is left in the fixture ON PURPOSE: it was a real column, rows in the wild still carry it, and the
// assertions below are that nothing acts on it any more.
check('locations are the flagged ones', announcementLocations(announcement()), ['is_visible_on_dashboard']);
check('a LEGACY login flag is ignored, not honoured', announcementShowsIn(announcement(), 'is_visible_on_login'), false);
check('a login-flagged row still shows where it is flagged', announcementShowsIn(announcement(), 'is_visible_on_dashboard'), true);
check('nothing flagged at all is nowhere', announcementLocations(announcement({ is_visible_on_dashboard: '' })), []);
// NOWHERE TO SHOW IS ITS OWN QUESTION, asked by the administration list rather than by the display: an announcement that is
// live on its dates but flagged for no surviving place renders nowhere, and the list used to call that "Showing now" - the
// one label that would send the officer reading it looking in exactly the wrong direction. It is also the state a
// re-saved legacy row lands in, which is why the row was worth a name.
check(
  'a live announcement with no surviving place shows nowhere',
  announcementShowsNowhere(announcement({ is_visible_on_dashboard: '' })),
  true
);
check('and one flagged for a real place does not', announcementShowsNowhere(announcement()), false);
check(
  'a row whose only flag was the retired login screen shows nowhere',
  announcementShowsNowhere(announcement({ is_visible_on_dashboard: '', is_visible_on_login: 'TRUE' })),
  true
);
check('showsIn reports the dashboard', announcementShowsIn(announcement(), 'is_visible_on_dashboard'), true);
check('and not the sidebar', announcementShowsIn(announcement(), 'is_visible_on_sidebar'), false);
// The deletion guard. The login screen was a placement, it is not one now, and this is what says so - so a later edit that
// reintroduces it has to argue with a failing check rather than with a comment.
check('there are two places to show an announcement', ANNOUNCEMENT_LOCATIONS.length, 2);
check(
  'and the login screen is not one of them',
  ANNOUNCEMENT_LOCATIONS.some((place) => place.key === 'is_visible_on_login'),
  false
);

console.log('\n--- the date window ---');
check('inside the window', announcementIsLiveOn(announcement(), '2026-03-15'), true);
check('on the effective date', announcementIsLiveOn(announcement(), '2026-03-01'), true);
check('the day before', announcementIsLiveOn(announcement(), '2026-02-28'), false);
check('a blank end runs indefinitely', announcementIsLiveOn(announcement(), '2099-01-01'), true);
check('an end date stops it', announcementIsLiveOn(announcement({ end_date: '2026-03-10' }), '2026-03-11'), false);
check('and includes the end date', announcementIsLiveOn(announcement({ end_date: '2026-03-10' }), '2026-03-10'), true);
// Required by the form, but a hand-edited row with a blank cell must still show rather than vanish.
check('a blank effective date is not treated as "never"', announcementIsLiveOn(announcement({ effective_date: '' }), '2026-03-15'), true);
check('an unreadable date is treated as open rather than dropping it', announcementIsLiveOn(announcement({ effective_date: 'nonsense' }), '2026-03-15'), true);

console.log('\n--- the audience ---');
check('three blanks reach everyone', announcementTargetsEveryone(announcement()), true);
check('a role target does not', announcementTargetsEveryone(announcement({ role_id: '2' })), false);

const member = { roleId: '1', rankId: '10', userId: '100' };
check('an untargeted announcement matches anyone', announcementMatchesAudience(announcement(), member), true);
check('a matching role matches', announcementMatchesAudience(announcement({ role_id: '1' }), member), true);
check('a different role does not', announcementMatchesAudience(announcement({ role_id: '9' }), member), false);
check('a matching member matches', announcementMatchesAudience(announcement({ user_id: '100' }), member), true);
check('another member does not', announcementMatchesAudience(announcement({ user_id: '101' }), member), false);
// The columns are ANDed: this is the rule an administrator is most likely to misread as "either".
check('both filled and both matching', announcementMatchesAudience(announcement({ role_id: '1', rank_id: '10' }), member), true);
check('both filled and only one matching is not a match', announcementMatchesAudience(announcement({ role_id: '1', rank_id: '99' }), member), false);
check('a reader with no rank cannot match a rank target', announcementMatchesAudience(announcement({ rank_id: '10' }), { roleId: '1', rankId: '', userId: '100' }), false);
check('a reader with no role cannot match a role target', announcementMatchesAudience(announcement({ role_id: '1' }), { roleId: '', rankId: '', userId: '' }), false);
check('an id is compared as text', announcementMatchesAudience(announcement({ user_id: '100' }), { userId: 100 }), true);

console.log('\n--- what reaches nobody ---');
const directory = [
  { id: '100', role_id: '1', rank_id: '10' },
  { id: '101', role_id: '2', rank_id: '20' },
];
check('no targeting reaches everyone', announcementReachesSomeone({}, directory), true);
check('a real member is reached', announcementReachesSomeone({ userId: '100' }, directory), true);
check('an unknown member is not', announcementReachesSomeone({ userId: '999' }, directory), false);
check('a real role is reached', announcementReachesSomeone({ roleId: '2' }, directory), true);
check('an unknown role is not', announcementReachesSomeone({ roleId: '77' }, directory), false);
// The combination that matches nobody: role 1 exists, rank 20 exists, but not on the same person.
check('a combination matching nobody is refused', announcementReachesSomeone({ roleId: '1', rankId: '20' }, directory), false);
check('and one matching somebody is allowed', announcementReachesSomeone({ roleId: '1', rankId: '10' }, directory), true);
check('an empty directory only reaches everyone', [
  announcementReachesSomeone({}, []),
  announcementReachesSomeone({ userId: '1' }, []),
], [true, false]);
check('a non-array directory is safe', announcementReachesSomeone({ userId: '1' }, null), false);

console.log('\n--- validation, shared with the backend ---');
const valid = { title: 'T', message: 'M', effective_date: '2026-03-01', is_visible_on_dashboard: true };
check('a complete announcement is valid', announcementValidation(valid), '');
check('a title is required', announcementValidation({ ...valid, title: '  ' }), 'A title is required.');
check('a message is required', announcementValidation({ ...valid, message: '' }), 'A message is required.');
check('an effective date is required', announcementValidation({ ...valid, effective_date: '' }), 'An effective date is required.');
check('an unreadable date is refused', announcementValidation({ ...valid, effective_date: 'nonsense' }), 'The effective date is not a readable date.');
check('an inverted window is refused', announcementValidation({ ...valid, end_date: '2026-02-01' }), 'The end date must not be before the effective date.');
check('the same day is allowed', announcementValidation({ ...valid, end_date: '2026-03-01' }), '');
// The one requirement that is easy to forget while writing: no place to show it.
check('at least one place is required', announcementValidation({ ...valid, is_visible_on_dashboard: false }), 'Choose at least one place to show the announcement.');
check('the sidebar alone satisfies it', announcementValidation({ title: 'T', message: 'M', effective_date: '2026-03-01', is_visible_on_sidebar: true }), '');
// A row placed only on the login screen is REFUSED rather than saved into nowhere: the location is gone, so the only honest
// answer is to make the author choose one of the two that remain.
check(
  'and a login-only row is refused rather than saved into nowhere',
  announcementValidation({ title: 'T', message: 'M', effective_date: '2026-03-01', is_visible_on_login: true }),
  'Choose at least one place to show the announcement.'
);

console.log('\n--- what a reader is shown ---');
const list = [
  announcement({ id: 'a', effective_date: '2026-03-01' }),
  announcement({ id: 'b', effective_date: '2026-03-05' }),
  announcement({ id: 'c', effective_date: '2026-03-10', end_date: '2026-03-11' }),
  announcement({ id: 'd', effective_date: '2026-03-01', is_visible_on_dashboard: 'FALSE', is_visible_on_sidebar: 'TRUE' }),
  announcement({ id: 'e', effective_date: '2026-03-01', user_id: '100' }),
  announcement({ id: 'f', effective_date: '2026-03-01', is_dismissable: 'TRUE' }),
];
const ids = (rows) => rows.map((row) => row.id);

const dashboard = visibleAnnouncementsFor({ announcements: list, location: 'is_visible_on_dashboard', audience: member, dateKey: '2026-03-15' });
// `b` has the latest effective date, so it leads; the three 03-01 rows then fall back to newest id first.
check('only dashboard announcements, newest first', ids(dashboard), ['b', 'f', 'e', 'a']);
check('the ended one is gone', ids(dashboard).includes('c'), false);
check('the sidebar-only one is not here', ids(dashboard).includes('d'), false);
check("another member's is not here", ids(visibleAnnouncementsFor({ announcements: list, location: 'is_visible_on_dashboard', audience: { roleId: '1', rankId: '10', userId: '999' }, dateKey: '2026-03-15' })).includes('e'), false);
check('the sidebar view shows d', ids(visibleAnnouncementsFor({ announcements: list, location: 'is_visible_on_sidebar', audience: member, dateKey: '2026-03-15' })), ['d']);

console.log('\n--- the login screen is not a placement, and that is asserted rather than assumed ---');
// This section used to test `includeEveryoneOnly`: the rule that the login screen - read before anybody signs in - could
// only show announcements aimed at everyone. The placement is gone now, so the parameter went with it, and what is left to
// assert is the invalidity of the old placement itself. `announcementTargetsEveryone` is still exported and still used by
// the administrator's audience label.
check('a login-flagged row is shown nowhere', ids(visibleAnnouncementsFor({
  announcements: [announcement({ id: 'legacy', is_visible_on_login: 'TRUE', is_visible_on_dashboard: 'FALSE' })],
  location: 'is_visible_on_login',
  dateKey: '2026-03-15',
})), []);
check('and the parameter that served it is gone', /includeEveryoneOnly/.test(readFileSync('src/utils/announcements.js', 'utf8')), false);

console.log('\n--- dismissal ---');
check('a dismissed announcement is hidden', ids(visibleAnnouncementsFor({
  announcements: list,
  location: 'is_visible_on_dashboard',
  audience: member,
  dateKey: '2026-03-15',
  dismissedIds: ['f'],
})).includes('f'), false);
// Only dismissable ones can be dismissed, so a stray key cannot hide a non-dismissable notice.
check('a non-dismissable one stays', ids(visibleAnnouncementsFor({
  announcements: [announcement({ id: 'a' })],
  location: 'is_visible_on_dashboard',
  audience: member,
  dateKey: '2026-03-15',
  dismissedIds: ['a'],
})), ['a']);
check('the dismissal key is per member and per announcement', [
  announcementDismissalKey('1', '9'),
  announcementDismissalKey('2', '9'),
  announcementDismissalKey('1', '8'),
], ['sp_announcement_dismissed_1_9', 'sp_announcement_dismissed_2_9', 'sp_announcement_dismissed_1_8']);
check('an anonymous reader gets their own key', announcementDismissalKey(null, '9'), 'sp_announcement_dismissed_anon_9');

console.log('\n--- presentation ---');
check('the fallback icon is an exclamation triangle', ANNOUNCEMENT_ICON_FALLBACK, 'triangle-alert');
check('the five variants', ANNOUNCEMENT_VARIANT_KEYS, ['info', 'tip', 'important', 'warning', 'caution']);
check('an unknown variant falls back to info', announcementVariant('nonsense').label, 'Info');
check('so does a blank one', announcementVariant('').label, 'Info');
check('a variant is matched case-insensitively', announcementVariant('CAUTION').label, 'Caution');
check('every variant carries its own colors', ANNOUNCEMENT_VARIANT_KEYS.every((key) => announcementVariant(key).box && announcementVariant(key).head), true);
check('the audience label for everyone', announcementAudienceLabel(announcement(), {}), 'Everyone');
check('for one member', announcementAudienceLabel(announcement({ user_id: '100' }), { users: [{ id: '100', name: 'Member 1' }] }), 'Only Member 1');
check('for a rank', announcementAudienceLabel(announcement({ rank_id: '10' }), { ranks: [{ id: '10', description: 'Lieutenant' }] }), 'Lieutenant rank');
// The label lists the member first, then the role, then the rank; "and only" attaches to the second of
// the pair rather than reading as a list.
check('and for a combination', announcementAudienceLabel(
  announcement({ rank_id: '10', role_id: '1' }),
  { ranks: [{ id: '10', description: 'Lieutenant' }], roles: [{ id: '1', description: 'Member' }] }
), 'Member role, and only Lieutenant rank');

console.log('\n--- the creator label ---');
const authorDirectory = [{ id: '1', name: 'Member 1' }, { id: 100, name: 'Member 3' }];
check('a known author by name', announcementAuthorLabel({ author_user_id: '1' }, authorDirectory), 'Created by Member 1');
// Numeric ids arrive from Sheets as numbers and from the client as strings.
check('a numeric author id still matches', announcementAuthorLabel({ author_user_id: 100 }, authorDirectory), 'Created by Member 3');
check('an unknown author falls back to a phrase', announcementAuthorLabel({ author_user_id: '7' }, authorDirectory), 'Created by Unnamed member');
// A row that predates the column, or one added by hand: nothing to show rather than a dangling "#".
check('a blank author yields nothing', announcementAuthorLabel({ author_user_id: '' }, authorDirectory), '');
check('a whitespace-only author yields nothing', announcementAuthorLabel({ author_user_id: '   ' }, authorDirectory), '');
check('a missing author yields nothing', announcementAuthorLabel({}, authorDirectory), '');
check('a missing announcement is safe', announcementAuthorLabel(null, authorDirectory), '');
check('a nameless directory row falls back to a phrase', announcementAuthorLabel({ author_user_id: '1' }, [{ id: '1' }]), 'Created by Unnamed member');
check('no directory at all still yields a label', announcementAuthorLabel({ author_user_id: '5' }), 'Created by Unnamed member');

// The administrator's list is its own fetch, deliberately.
//
// This is the bug that shipped: the tab was handed the same `announcements` array the sidebar and
// dashboard use, which is filtered by audience - and on top of that the prop was never actually
// passed, so the tab always received [] and reported "No announcements yet" while the sheet held two.
// The admin list therefore has to come from ADMIN_GET_ANNOUNCEMENTS, which returns every row.
//
// ...and since then it asks for a WINDOW of them. The tab still owns its own fetch - that is what these assertions are
// about - but the read that grows without limit needed a floor: the list opens on the last twelve months, and the reader
// unions that with every row still in force, so a notice with no end date cannot fall out of sight. "Show older" moves the
// floor back. The patterns below are the fetch itself, not the exact argument list, because the argument is the floor.
console.log('\n--- the admin tab fetches the full list itself ---');
const tabSource = readFileSync('src/components/admin/AdminAnnouncementsTab.jsx', 'utf8');
const panelSource = readFileSync('src/components/admin/AdminPanel.jsx', 'utf8');

check('the tab fetches announcements', /adminFetchAnnouncements\(token/.test(tabSource), true);
check('the tab fetches on mount', /useEffect\(\(\) => \{[\s\S]*?loadRows\(/.test(tabSource), true);
check('the tab re-reads the list after a write', (tabSource.match(/await reload\(\)/g) || []).length, 2);
check('the tab no longer renders an announcements prop', /announcements = \[\]/.test(tabSource), false);
check('the tab renders its fetched rows', /rows\.map\(/.test(tabSource) && /rows\.length/.test(tabSource), true);
check('a load failure is surfaced, not swallowed', /setLoadError/.test(tabSource) && /loadError &&/.test(tabSource), true);
check('AdminPanel no longer declares an announcements prop', /announcements = \[\]/.test(panelSource), false);

// The add/edit form is an editor modal now, matching the Training form: not on the page until it is asked for,
// opened by New announcement or by clicking Edit on a row, submitted from the modal's toolbar, and closed again
// after a save. formOpen is the same state it always was - it asked "is the form showing", which is still the
// question - so the wiring is asserted rather than rewritten.
console.log('\n--- the editor is a modal ---');
check('the form has an open/closed state', /const \[formOpen, setFormOpen\] = useState\(false\)/.test(tabSource), true);
check('the form body renders only when open', /\{formOpen && \(/.test(tabSource), true);
check('mounted in the viewport modal', /<ViewportModal/.test(tabSource) && /<ViewportModal[\s\S]{0,900}formId=\{ANNOUNCEMENT_FORM_ID\}/.test(tabSource), true);
check('with the toolbar submitting the form inside', /<form id=\{ANNOUNCEMENT_FORM_ID\}/.test(tabSource), true);
check('New announcement opens it, on a clean form', /resetForm\(\);\s*setFormOpen\(true\);/.test(tabSource), true);
check('clicking Edit opens it', /setFormOpen\(true\)/.test(tabSource), true);
check('a successful save closes it', /setFormOpen\(false\)/.test(tabSource), true);
check('and closing it clears the form', /onClose=\{\(\) => \{\s*resetForm\(\);\s*setFormOpen\(false\);\s*\}\}/.test(tabSource), true);
// The collapse header is gone with the card: no toggle, and nothing reporting a collapsed state.
check('there is no collapse control left', /setFormOpen\(\(open\) => !open\)/.test(tabSource), false);

// The creator is shown in the administrator's list, and nowhere else.
//
// author_user_id is stamped from the session on create and can never be sent back by a client, so it is
// trustworthy - but it is also administrative metadata: a member reading a callout on the login screen
// or dashboard has no business seeing who wrote it, and the member payload does not even need to carry it.
console.log('\n--- the creator is shown to administrators only ---');
const calloutSource = readFileSync('src/components/AnnouncementCallout.jsx', 'utf8');
const listSource = readFileSync('src/components/AnnouncementList.jsx', 'utf8');
const loginSource = readFileSync('src/components/LoginScreen.jsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.jsx', 'utf8');

check('the admin row renders the creator', /announcementAuthorLabel\(announcement, users\)/.test(tabSource), true);
[
  ['AnnouncementCallout', calloutSource],
  ['AnnouncementList', listSource],
  ['LoginScreen', loginSource],
  ['Sidebar', sidebarSource],
].forEach(([label, source]) => {
  check(`${label} does not mention the author`, /author_user_id|announcementAuthorLabel/.test(source), false);
});

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);