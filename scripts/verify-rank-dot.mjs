// THE RANK DOT BESIDE A MEMBER'S NAME ON A SCHEDULE PILL.
//
//   npm run verify:rank-dot
//
// WHY THIS FILE EXISTS, in the order the questions about it actually get asked.
//
// 1. DOES IT COST A READ? That question came with the request ("in an efficient way in terms of Firestore reads"), and
//    the answer is that it cannot cost one. The dot needs two facts, and both are already on the screen before it is
//    drawn:
//
//      * a member's `rank_id` rides every roster row. GET_ROSTER's projection is `{ id, name, rank_id }` - the same
//        three columns the sign-in payload's on-duty rows carry - and the administrator's `users` section SPREADS the
//        whole user document. So the row the name is already being drawn from answers "which rank".
//      * the rank's `color` arrives with the rest of the rank. `ranks` is read whole (`rowsOf(collection(db, 'ranks'))`)
//        wherever a schedule is drawn, and it is ALREADY a prop of both calendars, for the eligibility rule.
//
//    So the last case here asserts that components/RankDot imports nothing that can read - the only version of "costs no
//    read" a source check can hold - and that both pills PASS `ranks` through, because a prop that arrives nowhere
//    produces no error, only a dot that never appears. It also pins the two reads this leans on, so a future pass that
//    trims `rank_id` out of the roster projection or narrows the ranks read fails here rather than silently unpainting
//    every pill in the app.
//
// 2. NOTHING IS DRAWN WHEN THERE IS NOTHING TO DRAW. A member with no rank, a rank id that matches no rank, and a rank
//    whose colour the station has not painted all render nothing. That last one is the one worth spelling out: a blank
//    colour is a TRANSPARENT dot, so rendering it would put an empty ring on every unpainted pill - a colour nobody
//    chose, which reads as a rendering fault. It also means a station that has painted no ranks sees no change at all.
//
// 3. WHERE IT LANDS. A rank belongs to a person, so the dot is drawn in the one branch of each pill that draws a NAME -
//    the crew view of the member calendar, and a filled pill on the administration board - and nowhere else. The
//    personal view's pill labels the ASSIGNMENT rather than a member, and a vacancy has no member at all; both are
//    asserted to carry no dot, because "now there is a dot on every pill" is the failure mode of adding one to a shared
//    pill renderer.
//
// 4. WHICH WAY ROUND IT IS DRAWN. A dot before a name is a fact about order, and order is the one thing `textContent`
//    cannot show (the dot has no text of its own). So the cases below read the dot's SIBLINGS rather than the pill's
//    text: everything after the dot must be what names the member. A dot that ended up after the name, or loose in the
//    cell next to it, would pass a textContent check and fail that one.
//
// (The three sections that need a committed DOM import their own, further down: the calendar's crew view is behind a
// toggle and the board's pills arrive from a read in an effect.)

let failures = 0;
const check = (label, condition, detail) => {
  if (!condition) failures++;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}${condition || detail === undefined ? '' : ` -> ${detail}`}`);
};
// For a source claim, which has no "actual" value to print - the same split the other harnesses make.
const checkIs = (label, condition, detail) => check(label, Boolean(condition), detail);

// The two ranks the fixtures use. Any hex is a colour a station can pick in the Ranks tab, so these are deliberately
// two different ones: half the checks below are "this pill got ITS member's colour and not the other one's".
const OFFICER = '#c3223b';
const DRIVER = '#227dc3';
const ranks = [
  { id: 'k1', description: 'Officer', color: OFFICER },
  { id: 'k2', description: 'Driver/Operator', color: DRIVER },
];

// The server renderer writes a style value through as it was given it, while a real (or jsdom) style declaration
// normalizes `#c3223b` to `rgb(195, 34, 59)`. Both are the same colour, and the two halves of this file meet both.
const rgbOf = (hex) => {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};
const sameColor = (text, hex) => String(text).includes(hex) || String(text).includes(rgbOf(hex));

// Every element painted in this exact colour. Scoped by the colour rather than by a class on purpose: the shell has
// rounded-full spans of its own (the toggle switches), so "the dot" has to mean the dot.
const dotsIn = (scope, hex) =>
  [...scope.querySelectorAll('span')].filter((el) => sameColor(el.style.backgroundColor, hex));

// ---------------------------------------------------------------------------
// 1. The dot, and the things it must refuse to draw
// ---------------------------------------------------------------------------
// Imported HERE rather than at the top of the file, and that is deliberate. This section needs no DOM, and importing
// `./dom-env.mjs` builds a whole JSDOM for it - so a reader who only cares whether a blank colour draws anything pays
// for a browser it does not use. The sections that genuinely commit below import it themselves, at the point of need.
console.log('\n--- the dot itself ---');
{
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const RankDot = (await import('../src/components/RankDot.jsx')).default;
  const dotHtml = (props) => renderToStaticMarkup(React.createElement(RankDot, props));
  const officer = { id: 'u1', name: 'Ana Ruiz', rank_id: 'k1' };

  const painted = dotHtml({ user: officer, ranks });
  check('the rank colour the Ranks tab holds is what is painted', sameColor(painted, OFFICER), painted);
  check('the dot is round', painted.includes('rounded-full'), painted);
  // A filled pill is an arbitrary assignment colour with white text on it, so a rank colour close to the assignment
  // colour would otherwise disappear into the pill. The ring is the same white the pill's own text uses.
  check('and it separates itself from the pill it is drawn on', painted.includes('ring-1 ring-white/70'), painted);
  check('the rank names itself on hover, so a colour can be read', painted.includes('title="Officer"'), painted);
  check(
    'and it is silent to a screen reader, because it carries no text',
    painted.includes('aria-hidden="true"'),
    painted
  );
  // The geometry belongs to the caller - a 10px pill and a table row do not want the same size (the same split of size
  // from tone that CertificationBadges uses).
  check(
    'the caller decides the size and how it sits on the line',
    dotHtml({ user: officer, ranks, className: 'w-9 h-9 shrink-0' }).includes('w-9 h-9 shrink-0'),
    true
  );

  const labeled = dotHtml({ user: officer, ranks, showLabel: true });
  check('the opt-in mode shows rank initials beside its color', labeled.includes('OF') && sameColor(labeled, OFFICER), labeled);
  check('the initials expose the full rank to assistive technology', labeled.includes('aria-label="Rank: Officer"'), labeled);
  check('the text label is not hidden from screen readers', !labeled.includes('aria-hidden="true"'), labeled);

  // The refusals. Each one is a state a real station is in on its first day, or after a rank is deleted.
  const nothing = (props) => dotHtml(props) === '';
  const unranked = { id: 'u2', name: 'Nobody In Particular' };
  check('a member with no rank draws nothing', nothing({ user: unranked, ranks }), dotHtml({ user: unranked, ranks }));
  check(
    'a rank id matching no rank draws nothing',
    nothing({ user: { id: 'u3', name: 'Dangling', rank_id: 'deleted-rank' }, ranks }),
    dotHtml({ user: { id: 'u3', name: 'Dangling', rank_id: 'deleted-rank' }, ranks })
  );
  check(
    'a rank whose colour was never painted draws nothing',
    nothing({ user: { id: 'u4', name: 'Unpainted', rank_id: 'k9' }, ranks: [{ id: 'k9', description: 'Recruit', color: '' }] }),
    'a transparent dot is an empty ring on the pill - a colour nobody chose'
  );
  check(
    'and a rank with no colour field at all draws nothing',
    nothing({ user: { id: 'u5', name: 'Old Row', rank_id: 'k9' }, ranks: [{ id: 'k9', description: 'Recruit' }] }),
    dotHtml({ user: { id: 'u5', name: 'Old Row', rank_id: 'k9' }, ranks: [{ id: 'k9', description: 'Recruit' }] })
  );
  check(
    'with no ranks at all it still refuses rather than guessing',
    nothing({ user: officer }),
    dotHtml({ user: officer })
  );
  check('and a member who is not there at all draws nothing', nothing({ user: null, ranks }), dotHtml({ user: null, ranks }));
}

// ---------------------------------------------------------------------------
// 2. The crew view: where a member's NAME is what the first line says
// ---------------------------------------------------------------------------
// This section and the two after it need a real DOM, so they import jsdom at the point of need - see the note above
// section 1. A server render cannot reach any of them: the crew view is behind a toggle, and the board's pills arrive
// from a read in an effect (the same gap scripts/dom-env.mjs was written for).
console.log('\n--- the member calendar, in the crew view ---');
await (async () => {
  await import('./dom-env.mjs');
  const React = (await import('react')).default;
  const { render, fireEvent, cleanup } = await import('@testing-library/react');
  const ScheduleCalendar = (await import('../src/components/ScheduleCalendar.jsx')).default;

  // Both members hold a DIFFERENT rank with a DIFFERENT colour, so "the dot is there" and "the dot is THEIR dot" are
  // two different assertions - and the second is the one that catches a dot borrowing the signed-in member's rank.
  const me = { id: 'u1', name: 'Matt', rank_id: 'k2' };
  const other = { id: 'u2', name: 'Ana Ruiz', rank_id: 'k1' };
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
  const { container } = render(
    React.createElement(ScheduleCalendar, {
      currentUser: me,
      schedule: [rowFor(me.id), rowFor(other.id)],
      assignments: [{ id: 'a1', description: 'Firefighter 3', color: '#475569' }],
      scheduleTemplates: [{ id: 't1', start_time: '08:00', end_time: '18:00' }],
      users: [me, other],
      ranks,
      offers: [],
      events: [],
      token: 'test-token',
      canMakeOffers: false,
      canViewFullSchedule: true,
    })
  );

  // The personal view first, because it is the state a member opens the screen in. Its first line is the ASSIGNMENT, not
  // a person - so a dot here would be a dot with nothing to mark, which is the failure mode of adding one to a shared
  // pill renderer rather than to the branch that draws a name.
  check(
    'your own view, whose first line names an assignment rather than a person, carries no dot',
    dotsIn(container, OFFICER).length === 0 && dotsIn(container, DRIVER).length === 0,
    `${dotsIn(container, OFFICER).length + dotsIn(container, DRIVER).length} dot(s)`
  );

  const toggle = [...container.querySelectorAll('button')].find((button) =>
    button.textContent.includes('everyone')
  );
  check('the crew view is offered to a role that may see it', Boolean(toggle));
  fireEvent.click(toggle);

  check('the other member is on the calendar now', container.textContent.includes(other.name));
  const theirDots = dotsIn(container, OFFICER);
  check('and their rank dot is drawn', theirDots.length === 1, `${theirDots.length} dot(s)`);
  check(
    'in their rank colour, not the signed-in member\'s',
    dotsIn(container, DRIVER).length === 1,
    `${dotsIn(container, DRIVER).length} dot(s) in the wrong colour`
  );

  // WHERE IT IS, which `textContent` cannot show: the dot carries no text of its own, so a dot loose in the day cell
  // beside the pill would read identically to one inside it. The parent has to be the element that names the member.
  const dot = theirDots[0];
  check(
    'inside the same element as the name it belongs to',
    (dot?.parentElement?.textContent || '').includes(other.name),
    dot?.parentElement?.textContent
  );

  // AND WHICH WAY ROUND. Everything AFTER the dot has to be what names the member: a dot drawn after the name, or after
  // the whole pill, would satisfy the check above and fail this one. This is the only assertion here that can see it.
  const after = [];
  for (let node = dot?.nextSibling; node; node = node.nextSibling) after.push(node.textContent || '');
  check(
    'and before the name, not after it',
    after.join('').includes(other.name),
    after.join('') || '(nothing follows the dot)'
  );

  cleanup();
})();

// ---------------------------------------------------------------------------
// 3. The administration board: a filled pill and a month of vacancies
// ---------------------------------------------------------------------------
console.log('\n--- the administration board ---');
await (async () => {
  const React = (await import('react')).default;
  const { render, act, cleanup } = await import('@testing-library/react');
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
  const member = { id: 'u9', name: 'Zed Quarles', role_id: 'r1', rank_id: 'k1', status: 'active' };

  // A template for every weekday, so the row lands in a slot rather than in the unmatched list - and so every OTHER day
  // of the month is a vacancy, which is what makes "the vacancies carry no dot" worth asserting.
  const scheduleTemplates = WEEKDAYS.map((day_of_week) => ({
    id: `t-${day_of_week}`,
    day_of_week,
    start_time: '08:00',
    end_time: '18:00',
    assignment_id: 'a1',
  }));
  const rows = [
    {
      id: 's1',
      schedule_template_id: `t-${WEEKDAYS[new Date(year, month, day).getDay()]}`,
      assignment_id: 'a1',
      user_id: member.id,
      date_from: dayKey,
      date_to: dayKey,
    },
  ];

  // The board's rows come from an EFFECT, so the read has to be answered and the promises flushed: two turns of the
  // microtask queue then a macrotask, because the board reads in one effect and seeds its copies in another.
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const board = (boardRanks) =>
    React.createElement(AdminScheduleManagementTab, {
      token: 'test-token',
      scheduleTemplates,
      assignments: [{ id: 'a1', description: 'Firefighter 3', color: '#475569' }],
      ranks: boardRanks,
      users: [member],
      rosterAvailability: [],
      offers: [],
      events: [],
      timeFormat: '12',
      departmentName: 'Bolivia Volunteer Fire Department',
      onNeedSchedule: () => Promise.resolve(rows),
      onOffersChanged: async () => {},
      onAdminDataChanged: async () => {},
    });

  const { container } = render(board(ranks));
  await flush();

  check('the filled pill names its member', container.textContent.includes(member.name), 'the board drew no pill');
  const dots = dotsIn(container, OFFICER);
  check('and carries that member\'s rank dot', dots.length === 1, `${dots.length} dot(s)`);
  check(
    'inside the pill that names them',
    (dots[0]?.parentElement?.textContent || '').includes(member.name),
    dots[0]?.parentElement?.textContent
  );
  // THE VACANCIES. The board draws every uncovered slot in the month, so there are several - and the dot COUNT is the
  // assertion: one member means one dot, however many empty slots there are.
  check(
    'while the month\'s vacant slots carry none',
    container.textContent.includes('Firefighter 3') && dots.length === 1,
    `${dots.length} dot(s) beside a month of vacancies`
  );
  cleanup();

  // THE SAME BOARD WITH AN UNPAINTED RANK, which is what most stations are running until somebody fills the colour in.
  // Nothing changes on screen, and THAT is the assertion: no dot, no empty ring, no invented colour.
  const unpainted = render(board([{ id: 'k1', description: 'Officer', color: '' }]));
  await flush();
  const paintedSpans = unpainted.container.querySelectorAll('span[aria-hidden="true"][style*="background"]');
  check(
    'a station with no painted colours sees no change at all',
    unpainted.container.textContent.includes(member.name) && paintedSpans.length === 0,
    `${paintedSpans.length} painted span(s) for an unpainted rank`
  );
  cleanup();
})();

// ---------------------------------------------------------------------------
// 4. The read it does not cost
// ---------------------------------------------------------------------------
// "Can this be added efficiently in terms of Firestore reads?" is a question about IMPORTS, not about intent. The dot
// needs two facts - a member's `rank_id`, and the rank's `color` - and both are already on the screen before it draws.
console.log('\n--- the read it does not cost ---');
{
  const { readFileSync } = await import('node:fs');
  const dotSource = readFileSync('src/components/RankDot.jsx', 'utf8');
  const calendarSource = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
  const boardSource = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
  const appSource = readFileSync('src/App.jsx', 'utf8');

  // The strongest form of "it costs no read": the module has no way to ask for one. No service import, no firestore, no
  // collection, no fetch - so the question cannot be answered wrongly later by accident.
  checkIs(
    'the dot reaches for no data of its own',
    !/from\s+'[^']*(services|firebase|firestore)/.test(dotSource),
    'it imports something that could read'
  );
  checkIs(
    'and calls nothing that could read',
    !/\b(getDoc|getDocs|collection|query|fetch|routeRead|dispatchRequest)\s*\(/.test(dotSource),
    'it makes a read itself'
  );

  // Which only holds because both screens were ALREADY handed what it needs - so the wiring is asserted rather than
  // assumed. A prop that arrives nowhere produces no error, only a dot that never appears.
  checkIs(
    'the member calendar draws it from the ranks it already holds',
    /<RankDot\s+user=\{crewUser\}/.test(calendarSource) &&
      /ranks=\{ranks\}/.test(calendarSource) &&
      /showLabel=\{colorblindRankLabels\}/.test(calendarSource)
  );
  checkIs(
    'App derives the opt-in mode from the current user settings',
    /currentUserSettings\?\.colorblind_rank_labels/.test(appSource)
  );
  checkIs(
    'and passes it into the member and administrator schedules',
    /<ScheduleCalendar[\s\S]{0,1200}colorblindRankLabels=\{colorblindRankLabels\}/.test(appSource) &&
      /<AdminPanel[\s\S]{0,1600}colorblindRankLabels=\{colorblindRankLabels\}/.test(appSource)
  );
  // ONE PLACE ON THE BOARD DRAWS IT, which is a stronger statement than the two this used to assert - and the count
  // went DOWN by adding the certification badges, which is worth explaining rather than hiding. The board has three
  // kinds of pill (a template slot's occupant, a custom-shift row, and an unfilled slot) and each used to spell its own
  // contents out, so the rank dot had been written into two of them and the badges reached none. They are assembled by
  // one function now, so there is one `<RankDot` and one `<CertificationBadges` - and a fact added to a pill cannot
  // reach some of the pills and miss the rest.
  checkIs(
    'the board draws it once, in the body every kind of pill is assembled by',
    (boardSource.match(/<RankDot/g) || []).length === 1 &&
      /const pillBody = \(/.test(boardSource) &&
      /showLabel=\{colorblindRankLabels\}/.test(boardSource),
    `${(boardSource.match(/<RankDot/g) || []).length} RankDot(s) on the board`
  );
  checkIs(
    'so all three kinds of pill go through that one body',
    (boardSource.match(/pillBody\(\{/g) || []).length === 3,
    `${(boardSource.match(/pillBody\(\{/g) || []).length} pillBody call(s)`
  );
  // ...AND THE VACANCY USES IT WITH NO MEMBER, which is what keeps a dot and a badge off an assignment's name. Asserted
  // at the call site because the runtime case below can see that there is no dot but not WHY: passing the row through
  // and relying on `rank_id` being blank would satisfy that check on a station where every member has a rank.
  //
  // Identified by the one thing only a vacancy passes - the pending-offer marker - rather than by position, so adding a
  // fourth call site does not silently point this assertion at the wrong one.
  const vacancyCall =
    boardSource
      .split('{pillBody({')
      .slice(1)
      .map((call) => call.slice(0, call.indexOf('})}') + 3))
      .find((call) => call.includes('pending:')) || '';
  checkIs(
    'and the vacancy is handed no member at all',
    Boolean(vacancyCall) && !/memberId:/.test(vacancyCall) && !/user:/.test(vacancyCall),
    vacancyCall || 'no pillBody call passes a pending marker - the empty-slot branch has stopped using it'
  );

  // The two reads this leans on, so a future pass that trims either one fails HERE rather than silently unpainting every
  // pill in the app. Both are asserted in their own harnesses too - this is the reminder, from the feature that depends.
  checkIs(
    'the roster projection still carries the rank the dot reads',
    /rank_id: user\.rank_id/.test(readFileSync('src/services/firestoreReads.js', 'utf8')),
    'the dot would have nothing to look up'
  );
  checkIs(
    'and the ranks still arrive whole, so the colour comes with them',
    /rowsOf\(collection\(db, 'ranks'\)\)/.test(readFileSync('src/services/firestorePayload.js', 'utf8'))
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

