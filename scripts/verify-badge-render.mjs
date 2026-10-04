// PROVES A NAME ALREADY ON SCREEN REDRAWS WHEN ITS BADGES ARRIVE.
//
//   npm run verify:badge-render
//
// WHY THIS FILE EXISTS, and why no other harness could have caught it.
//
// The certification icons stopped appearing next to member names on EVERY screen. Two separate faults stacked, and
// the second is invisible to every other tool in this repo:
//
//   1. The READ. The badge index left the sign-in payload (1.12) and rode onto GET_ROSTER, which is read for
//      `schedule` and `admin` only - so the dashboard's on-duty card and the sidebar read a map that was never
//      filled. That one is a wiring fact and is pinned by the source checks in scripts/verify-certifications.mjs.
//
//   2. The RENDER. Fixing (1) was necessary and not sufficient. While the index rode the sign-in payload it was in
//      hand BEFORE the first render, so every name was drawn with its icons from the start. Give it its own read
//      and the answer lands AFTER the first paint - and a module-level variable that is mutated is INVISIBLE to
//      React. The name had already been rendered with an empty index and nothing asked it to render again.
//
// A server render cannot see (2). renderToString runs the component body and the hook CALLS, once, with whatever
// the module happens to hold at that moment - so it draws the icon and reports success while the browser draws a
// bare name for ever. Neither can a source check: `const badges = certificationBadgesFor(userId)` and
// `useSyncExternalStore(...)` differ by one hook, and both read correctly. Only a commit into a real DOM shows the
// difference, which is the same argument scripts/dom-env.mjs records for the admin schedule board.
//
// So this mounts the real components, fills the registry the way App does - after first paint - and asserts what an
// officer is looking at. See scripts/verify-admin-schedule-runtime.mjs for the sibling harness.
import './dom-env.mjs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MemberName from '../src/components/MemberName.jsx';
import CertificationBadges from '../src/components/CertificationBadges.jsx';
import ScheduleItemModal from '../src/components/ScheduleItemModal.jsx';
import ScheduleCalendar from '../src/components/ScheduleCalendar.jsx';
import { shiftItemDetails } from '../src/utils/scheduleItemDetails.js';
import { mergeCertificationBadges, setCertificationBadges } from '../src/utils/certifications.js';

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};

const container = document.createElement('div');
document.body.appendChild(container);
const root = createRoot(container);

// Drawn the way a screen draws it: a full render, which is what happens BEFORE any read has answered.
const draw = async (element) => {
  await act(async () => {
    root.render(element);
  });
};
const icons = () => container.querySelectorAll('svg').length;

console.log('\n--- a name already on screen when its badges arrive ---');
{
  setCertificationBadges({});

  // First paint. The dashboard's on-duty card and the sidebar both get here before any badge read has resolved.
  await draw(React.createElement(MemberName, { user: { id: 'u2', name: 'Ana Ruiz' } }));
  check('a name drawn before its icons are known draws bare', icons() === 0, `${icons()} icon(s)`);

  // The targeted read resolving, exactly as App.jsx merges it. NOTHING re-renders the tree by hand here - if the
  // index is not a subscribed store, this is where the icons stay missing for ever.
  await act(async () => {
    mergeCertificationBadges({ u2: [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }] });
  });
  check('and the SAME name redraws with its icon once the read lands', icons() === 1, `${icons()} icon(s)`);

  // The icon that ships in the seed for u2. Asserting the glyph rather than "an svg appeared" catches the other way
  // this renders nothing: an icon name outside RankIcon's map draws a HelpCircle, and a badge nobody recognises is
  // a bug the officer has to decode.
  check('the real glyph, not a placeholder', container.innerHTML.includes('lucide-heart-pulse'));
  check('and the tooltip names the certification', container.innerHTML.includes('title="EMT"'));
}

console.log('\n--- members with nothing to draw ---');
{
  // "Holds none" and "nobody has asked" both draw nothing, and both must stay free: this sits beside every name.
  await draw(React.createElement(MemberName, { user: { id: 'u9', name: 'Nobody Asked' } }));
  check('a member with no badges adds no icons', icons() === 0, `${icons()} icon(s)`);

  // A badge that lapsed is erased by a re-read, and the icon has to disappear from a name that is already drawn.
  await draw(React.createElement(MemberName, { user: { id: 'u2', name: 'Ana Ruiz' } }));
  check('the member with badges still shows theirs', icons() === 1, `${icons()} icon(s)`);
  await act(async () => {
    mergeCertificationBadges({ u2: [] });
  });
  check('and a lapsed badge removes the icon from that name', icons() === 0, `${icons()} icon(s)`);
}

console.log('\n--- the sidebar, which draws the signed-in member by id ---');
{
  // The sidebar renders CertificationBadges directly, off `currentUser.id`, on every screen - the other path that
  // was blank. It subscribes through the same store, and this is the case that proves the id-only caller works.
  await draw(React.createElement(CertificationBadges, { userId: 'u5' }));
  check('nothing until that member has been asked about', icons() === 0, `${icons()} icon(s)`);

  await act(async () => {
    setCertificationBadges({ u5: [{ id: 'c9', name: 'Swiftwater', icon: 'sailboat' }] });
  });
  check('and an index replaced wholesale redraws it', icons() === 1, `${icons()} icon(s)`);
  check('with the icon it was given', container.innerHTML.includes('lucide-sailboat'));

  await act(async () => {
    setCertificationBadges({});
  });
  check('and clearing the index takes the icon away again', icons() === 0, `${icons()} icon(s)`);
}

await act(async () => {
  root.unmount();
});

// ---------------------------------------------------------------------------
// THE CREW VIEW - the screens that draw SOMEBODY ELSE'S name.
//
// Every case above draws a name the app already had in hand: the signed-in member. These two draw the names of OTHER
// people, which is the question these icons exist to answer at a glance - "I am on with an EMT, and I am not one". They
// are separate cases because the NAME is separate: a screen only draws a name it has, so a badge beside somebody else
// has two ways to go missing (the name is never drawn, or drawn as a bare string) and a harness that only renders the
// signed-in member sees neither.
//
// The two are the paths a firefighter actually reads: the popup a crew pill opens, and the pill itself in the crew
// view. Both draw names from the index the roster read fills, so nothing here costs an extra read.
//
// Icons are counted ACROSS document.body rather than inside a container, because a dialog is portalled out to the body
// (see utils/viewportLayer) and its markup is therefore not inside the element that asked for it. The tree before each
// case is unmounted first, so "on the page" means the case under test.
// ---------------------------------------------------------------------------
const emtIcons = () => document.body.querySelectorAll('svg.lucide-heart-pulse').length;
const other = { id: 'u2', name: 'Ana Ruiz' };

const openTree = async (element) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tree = createRoot(host);
  await act(async () => {
    tree.render(element);
  });
  return tree;
};

console.log('\n--- the popup for somebody else on your shift ---');
{
  setCertificationBadges({});
  const details = shiftItemDetails(
    {
      userId: other.id,
      name: other.name,
      isMine: false,
      label: 'Rescue',
      from: '2026-09-15',
      to: '2026-09-15',
      timeRange: '8:00 AM – 6:00 PM',
    },
    { crewMember: true }
  );
  const popupTree = await openTree(
    React.createElement(ScheduleItemModal, { details, icon: 'shift', onClose: () => {} })
  );
  check('the popup names the member you are on with', document.body.textContent.includes(other.name));
  check('and draws no icon until the index knows about them', emtIcons() === 0, `${emtIcons()} icon(s)`);

  // The read landing, merged exactly as App merges it. This is the crew case: nothing re-renders the popup by hand.
  await act(async () => {
    mergeCertificationBadges({ [other.id]: [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }] });
  });
  check('and gains their certification icon once the answer lands', emtIcons() === 1, `${emtIcons()} icon(s)`);
  const badge = document.querySelector('svg.lucide-heart-pulse');
  // MemberName draws the icon as the SIBLING of the name, so two levels up is the row that carries both.
  const rowText = badge?.parentElement?.parentElement?.textContent || '';
  check('inside the row that names them, not loose on the screen', rowText.includes(other.name), rowText);
  await act(async () => {
    popupTree.unmount();
  });
}

console.log('\n--- the crew view, where another member is on the calendar ---');
{
  // The index is filled BEFORE the first render here on purpose: it is the roster read's answer sitting in the
  // registry, which is what these screens get. If the icon shows up below, it is because the crew pill drew the
  // name, and not because a read happened to land at the right moment.
  setCertificationBadges({ [other.id]: [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }] });
  const me = { id: 'u1', name: 'Matt' };
  const now = new Date();
  const dayThisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  const rowFor = (userId) => ({
    id: `s-${userId}`,
    schedule_template_id: 't1',
    assignment_id: 'a1',
    user_id: userId,
    date_from: dayThisMonth,
    date_to: dayThisMonth,
  });
  const calendarTree = await openTree(
    React.createElement(ScheduleCalendar, {
      currentUser: me,
      schedule: [rowFor(me.id), rowFor(other.id)],
      assignments: [{ id: 'a1', description: 'Firefighter 3' }],
      scheduleTemplates: [{ id: 't1', start_time: '08:00', end_time: '18:00' }],
      users: [me, other],
      ranks: [],
      offers: [],
      events: [],
      token: 'test-token',
      canMakeOffers: false,
      canViewFullSchedule: true,
    })
  );
  check('the calendar opens on your own shifts', !document.body.textContent.includes(other.name));
  check('so a filled index still draws no icon', emtIcons() === 0, `${emtIcons()} icon(s)`);

  const crewToggle = [...document.body.querySelectorAll('button')].find((button) =>
    button.textContent.includes('everyone')
  );
  check('the crew view is offered to a role that may see it', Boolean(crewToggle));
  await act(async () => {
    crewToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  check('the other member is on the calendar now', document.body.textContent.includes(other.name));
  check('and their certification icon is drawn with the name', emtIcons() === 1, `${emtIcons()} icon(s)`);
  const badge = document.querySelector('svg.lucide-heart-pulse');
  // NOT a key or a legend: the icon sits in the same element as the name it stands for, which is what "beside the
  // name" means and what a badge drawn somewhere else on the screen would not be.
  const nameElement = badge?.parentElement?.parentElement?.textContent || '';
  check('in the same element as the name it belongs to', nameElement.includes(other.name), nameElement);
  await act(async () => {
    calendarTree.unmount();
  });
}

console.log('\n--- the administration board, where the pill names whoever is on the shift ---');
{
  // THE BOARD IS THE OTHER PLACE AN OFFICER READS "who is on this shift", and its pills went without the icons for
  // longer than the calendar's - because the board has three kinds of pill (a template slot's occupant, a custom-shift
  // row, and an unfilled slot) and each spelled its own contents out. They are assembled by one body now, so this case
  // and the calendar's are two doors onto the same drawing.
  //
  // THE VACANCIES ARE THE OTHER HALF. Every uncovered slot in the day is drawn as a pill too, and a badge on one of
  // those would be a certification claimed for an assignment's NAME - so the count is the assertion: one member, one
  // icon, on a board full of vacancies.
  setCertificationBadges({ [other.id]: [{ id: 'c1', name: 'EMT', icon: 'heart-pulse' }] });
  const AdminScheduleManagementTab = (
    await import('../src/components/admin/AdminScheduleManagementTab.jsx')
  ).default;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = 15;
  const dayKey = `${year}-${pad(month + 1)}-${pad(day)}`;
  const boardTemplates = WEEKDAYS.map((day_of_week) => ({
    id: `t-${day_of_week}`,
    day_of_week,
    start_time: '08:00',
    end_time: '18:00',
    assignment_id: 'a1',
  }));
  const boardRows = [
    {
      id: 's1',
      schedule_template_id: `t-${WEEKDAYS[new Date(year, month, day).getDay()]}`,
      assignment_id: 'a1',
      user_id: other.id,
      date_from: dayKey,
      date_to: dayKey,
    },
  ];

  // The board reads its month from an effect, so the read has to be answered and the promises flushed before anything
  // is on screen at all.
  const tree = await openTree(
    React.createElement(AdminScheduleManagementTab, {
      token: 'test-token',
      scheduleTemplates: boardTemplates,
      assignments: [{ id: 'a1', description: 'Firefighter 3' }],
      ranks: [],
      users: [other],
      rosterAvailability: [],
      offers: [],
      events: [],
      timeFormat: '12',
      departmentName: 'Bolivia Volunteer Fire Department',
      onNeedSchedule: () => Promise.resolve(boardRows),
      onOffersChanged: async () => {},
      onAdminDataChanged: async () => {},
    })
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  check('the board draws the month and names its member', document.body.textContent.includes(other.name));
  check('and their certification icon is drawn with the name', emtIcons() === 1, `${emtIcons()} icon(s)`);
  const boardBadge = document.querySelector('svg.lucide-heart-pulse');
  const pillText = boardBadge?.parentElement?.parentElement?.textContent || '';
  check('inside the pill that names them', pillText.includes(other.name), pillText);
  // ...AND NOWHERE ELSE. The board draws a vacancy for every uncovered slot in the month, so a badge that leaked onto
  // the vacancy branch would be several icons rather than one - and it would be standing for an assignment.
  check('while the month of vacancies carries none', emtIcons() === 1, `${emtIcons()} icon(s) on the board`);

  await act(async () => {
    tree.unmount();
  });
  setCertificationBadges({});
}

const SUMMARY = `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`;
console.log(SUMMARY);
process.exit(failures === 0 ? 0 : 1);

