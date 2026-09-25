// Verifies the schedule-template nickname rule (utils/shiftTime).
//
// A template can carry an optional `nickname`, and every schedule view shows it in
// place of the times when one is set. The interesting cases are the fallbacks, because
// a shift must never lose both its name and its window: no nickname, a blank or
// whitespace-only nickname, a column the sheet does not have, and a custom shift with
// no template at all (which can never have a nickname).
//
// Run with: npm run verify:shift-label
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  rowTimeText,
  shiftTimeLabel,
  templateNickname,
  templateTimeText,
} from '../src/utils/shiftTime.js';
import ScheduleCalendar from '../src/components/ScheduleCalendar.jsx';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`}`
  );
};

const template = (overrides = {}) => ({ id: 't1', start_time: '08:00', end_time: '18:00', ...overrides });
const WINDOW = '08:00–18:00';

console.log('--- the nickname is shown instead of the times ---');
check('a nickname wins', shiftTimeLabel(template({ nickname: 'Day Shift' }), WINDOW), 'Day Shift');
check('no nickname column', shiftTimeLabel(template(), WINDOW), WINDOW);
check('a blank nickname', shiftTimeLabel(template({ nickname: '' }), WINDOW), WINDOW);
check('a whitespace-only nickname', shiftTimeLabel(template({ nickname: '   ' }), WINDOW), WINDOW);
check('a null nickname', shiftTimeLabel(template({ nickname: null }), WINDOW), WINDOW);
check('the nickname is trimmed', shiftTimeLabel(template({ nickname: '  Day Shift  ' }), WINDOW), 'Day Shift');

console.log('--- a custom shift has no template, so it keeps its times ---');
check('no template at all', shiftTimeLabel(undefined, '22:00–04:00'), '22:00–04:00');
check('a null template', shiftTimeLabel(null, '22:00–04:00'), '22:00–04:00');
check('with no window either', shiftTimeLabel(undefined, ''), '');
check('an undefined fallback is safe', shiftTimeLabel(undefined, undefined), '');

console.log('--- the pieces the views build from ---');
check('templateNickname reads the column', templateNickname({ nickname: ' Night ' }), 'Night');
check('templateNickname without the column', templateNickname({}), '');
check('the template window still resolves', templateTimeText(template()), WINDOW);
check('and the row window too', rowTimeText({ start_time: '22:00', end_time: '04:00' }), '22:00–04:00');
// Both views compute the pill text and the tooltip text from the same source, which is
// what keeps "Day Shift" on the pill and "8:00 AM – 6:00 PM" in the tooltip.
check('a filled template row', shiftTimeLabel(template({ nickname: 'Day Shift' }), templateTimeText(template())), 'Day Shift');

console.log('--- rendered: the calendar pill ---');
const currentUser = { id: 'u1', name: 'Matt', rank_id: 'k1', status: 'active' };
// The calendar opens on the CURRENT month, so the row has to fall inside it or no pill
// is drawn at all (and the assertion would pass for the wrong reason).
const now = new Date();
const dayInThisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
const calendarHtml = (scheduleTemplates, assignmentOverrides = {}, rowOverrides = {}) =>
  renderToString(
    React.createElement(ScheduleCalendar, {
      currentUser,
      schedule: [{ id: 's1', schedule_template_id: 't1', assignment_id: 'a1', user_id: 'u1', date_from: dayInThisMonth, date_to: dayInThisMonth, ...rowOverrides }],
      assignments: [{ id: 'a1', description: 'Firefighter 3', ...assignmentOverrides }],
      scheduleTemplates,
      ranks: [],
      users: [currentUser],
      offers: [],
      token: 'test-token',
      canMakeOffers: false,
      canViewFullSchedule: false,
    })
  );

const withNickname = calendarHtml([template({ nickname: 'Day Shift' })]);
const withoutNickname = calendarHtml([template()]);
// The pill's second line is the only place the label is drawn, so match that element
// directly rather than searching the whole page - the detail list below the calendar
// deliberately keeps showing the window. SSR comment markers and any assignment icon
// are stripped so the assertion is about the text a member actually reads.
const pillLine2 = (html) => {
  const match = html.match(/class="block truncate text-\[9px\][^>]*>([\s\S]*?)<\/span>/);
  if (!match) return '';
  return match[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .trim();
};

check('the pill shows the nickname', pillLine2(withNickname), 'Day Shift');
// The window stays in the tooltip so hovering still says when the shift runs.
check('the tooltip still carries the window', withNickname.includes('8:00 AM'), true);
check('without a nickname the pill shows the window', pillLine2(withoutNickname).startsWith('8:00 AM'), true);
check('and no nickname leaks in', withoutNickname.includes('Day Shift'), false);

console.log('--- rendered: the assignment icon on the pill ---');
// lucide-react marks every icon with `lucide-<name>`, which makes the drawn icon
// identifiable in the markup without depending on the path data.
const withIcon = calendarHtml([template()], { icon: 'truck' });
check('the assignment icon is drawn', withIcon.includes('lucide-truck'), true);
check('and nothing is drawn without one', withNickname.includes('lucide-truck'), false);

console.log('--- rendered: the member calendar still says "Open" ---');
// The vacancy label change is scoped to the ADMIN board. On the member calendar the word is
// the point: it tells the member the shift is available to offer for.
const openNow = new Date();
const openMonthDays = new Date(openNow.getFullYear(), openNow.getMonth() + 1, 0).getDate();
// A vacant row is only drawn while it is not in the past (to >= today), so the fixture has
// to sit on a day this month that is still to come when today is late in the month.
const openDay = `${openNow.getFullYear()}-${String(openNow.getMonth() + 1).padStart(2, '0')}-${String(
  Math.min(openMonthDays, Math.max(15, openNow.getDate() + 1))
).padStart(2, '0')}`;
const openHtml = calendarHtml([template()], {}, { user_id: '', date_from: openDay, date_to: openDay });
check('the member calendar labels an unfilled shift "Open"', openHtml.includes('>Open<'), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
