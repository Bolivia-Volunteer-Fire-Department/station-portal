/**
 * Verifies schedule template effective/end dates (utils/scheduleTemplates).
 *
 * The feature: a template can start on a date and retire on a date, instead of having to be deleted to
 * stop producing shifts. The thing worth testing hardest is the BLANK case, because that is what every
 * existing template in the sheet has: a blank cell must mean "no restriction", not "no date, so never".
 * Getting that backwards would erase the schedule for the whole station on deploy.
 *
 * The gate has to be applied in four places that each turn a template into a dated occurrence - the
 * member calendar, the administrator's board, the Add Shift picker and both availability views - so this
 * also asserts each of them calls it, rather than trusting that I remembered all four.
 *
 * Run with: npm run verify:template-dates
 */
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import AdminScheduleTemplatesTab from '../src/components/admin/AdminScheduleTemplatesTab.jsx';
import {
  templateDateError,
  templateDateKey,
  templateDateLabel,
  templateDateRange,
  templateIsActiveOn,
  templateLifecycle,
} from '../src/utils/scheduleTemplates.js';

// React's SSR puts <!-- --> markers between text and an interpolated value, so prose assertions read
// through this rather than matching the raw HTML.
const visibleText = (html) => String(html).replace(/<!--[^>]*-->/g, '');

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

const template = (overrides = {}) => ({
  id: '1',
  day_of_week: 'monday',
  start_time: '08:00',
  end_time: '18:00',
  assignment_id: '3',
  ...overrides,
});

console.log('--- reading a date cell ---');
check('a text yyyy-MM-dd passes through', templateDateKey('2026-07-01'), '2026-07-01');
check('a US text date is read', templateDateKey('7/1/2026'), '2026-07-01');
check('a padded US date is read', templateDateKey('07/01/2026'), '2026-07-01');
check('a slack date is padded', templateDateKey('2026-7-1'), '2026-07-01');
// A real date cell arrives over the API as a UTC ISO string; the schedule's parser reads it in the
// station timezone, which is what keeps 1 July from becoming 30 June.
check('an ISO string is read in station time', templateDateKey('2026-07-01T04:00:00.000Z'), '2026-07-01');
check('a Date object is read', templateDateKey(new Date(2026, 6, 1)), '2026-07-01');
check('blank is blank', templateDateKey(''), '');
check('null is blank', templateDateKey(null), '');
check('undefined is blank', templateDateKey(undefined), '');
check('whitespace is blank', templateDateKey('   '), '');
check('nonsense is blank rather than a guess', templateDateKey('not a date'), '');

console.log('\n--- the rule ---');
// The whole point of the feature shipping safely.
check('no dates means always active', templateIsActiveOn(template(), '2026-07-01'), true);
check('and active in the past too', templateIsActiveOn(template(), '2019-01-01'), true);
check('and far in the future', templateIsActiveOn(template(), '2099-12-31'), true);

const fromOnly = template({ effective_date: '2026-07-01' });
check('a start date excludes the day before', templateIsActiveOn(fromOnly, '2026-06-30'), false);
check('and INCLUDES the effective date itself', templateIsActiveOn(fromOnly, '2026-07-01'), true);
check('and everything after', templateIsActiveOn(fromOnly, '2030-01-01'), true);

const toOnly = template({ end_date: '2026-06-30' });
check('an end date excludes the day after', templateIsActiveOn(toOnly, '2026-07-01'), false);
check('and INCLUDES the end date itself', templateIsActiveOn(toOnly, '2026-06-30'), true);
check('and everything before', templateIsActiveOn(toOnly, '2000-01-01'), true);

const windowed = template({ effective_date: '2026-01-01', end_date: '2026-12-31' });
check('inside the window', templateIsActiveOn(windowed, '2026-06-15'), true);
check('on the first day', templateIsActiveOn(windowed, '2026-01-01'), true);
check('on the last day', templateIsActiveOn(windowed, '2026-12-31'), true);
check('before the window', templateIsActiveOn(windowed, '2025-12-31'), false);
check('after the window', templateIsActiveOn(windowed, '2027-01-01'), false);

// A single-day window is a real use: a template that ran for one day only.
const oneDay = template({ effective_date: '2026-03-14', end_date: '2026-03-14' });
check('a one-day window includes that day', templateIsActiveOn(oneDay, '2026-03-14'), true);
check('and excludes the days either side', [
  templateIsActiveOn(oneDay, '2026-03-13'),
  templateIsActiveOn(oneDay, '2026-03-15'),
], [false, false]);

// The dates travel as text, so a comparison must behave as a date comparison across months and years -
// the reason the whole design uses yyyy-MM-dd keys.
check('December comes after January', templateIsActiveOn(template({ effective_date: '2026-12-01' }), '2026-01-01'), false);
check('a later year comes after', templateIsActiveOn(template({ effective_date: '2026-01-01' }), '2025-12-31'), false);

check('a blank date key is treated as inside the window', templateIsActiveOn(fromOnly, ''), true);
check('a null date key too', templateIsActiveOn(fromOnly, null), true);

console.log('\n--- lifecycle, for the badges ---');
const today = '2026-06-15';
// A template that has actually ended, as opposed to toOnly, which ends 2026-06-30 and is therefore
// still running on the 15th.
const alreadyEnded = template({ effective_date: '2025-01-01', end_date: '2026-06-01' });
check('always-on reads active', templateLifecycle(template(), today), 'active');
check('inside a window reads active', templateLifecycle(windowed, today), 'active');
check('before its start reads scheduled', templateLifecycle(fromOnly, today), 'scheduled');
check('an end date still in the future is active', templateLifecycle(toOnly, today), 'active');
check('after its end reads retired', templateLifecycle(alreadyEnded, today), 'retired');
check('the day it starts is active, not scheduled', templateLifecycle(fromOnly, '2026-07-01'), 'active');
check('the day it ends is active, not retired', templateLifecycle(toOnly, '2026-06-30'), 'active');
check('the day after it ends is retired', templateLifecycle(toOnly, '2026-07-01'), 'retired');
check('without a today it reads active', templateLifecycle(toOnly, ''), 'active');

console.log('\n--- labels ---');
check('no dates means no label', templateDateLabel(template()), '');
check('a start only', templateDateLabel(fromOnly), 'From Jul 1, 2026');
check('an end only', templateDateLabel(toOnly), 'Until Jun 30, 2026');
check('both ends', templateDateLabel(windowed), 'Jan 1, 2026 - Dec 31, 2026');
check('a one-day window reads as a range', templateDateLabel(oneDay), 'Mar 14, 2026 - Mar 14, 2026');

console.log('\n--- the date range, as the components read it ---');
check('both open', templateDateRange(template()), { from: '', to: '', openStart: true, openEnd: true });
check('start only', templateDateRange(fromOnly), { from: '2026-07-01', to: '', openStart: false, openEnd: true });
check('end only', templateDateRange(toOnly), { from: '', to: '2026-06-30', openStart: true, openEnd: false });

console.log('\n--- validation, shared with the backend ---');
// The effective date is REQUIRED on save, so the blank cases that used to be valid are now refused. The
// dates are still optional in the SHEET: a row created before the rule keeps working, which is why the
// reading tests above are unchanged.
check('both blank is refused', /effective date is required/i.test(templateDateError('', '')), true);
check('an end with no start is refused', /effective date is required/i.test(templateDateError('', '2026-06-30')), true);
check('a start alone is valid', templateDateError('2026-07-01', ''), '');
check('a normal range is valid', templateDateError('2026-01-01', '2026-12-31'), '');
check('the same day is valid', templateDateError('2026-03-14', '2026-03-14'), '');
check('an inverted range is refused', /end date must not be before/i.test(templateDateError('2026-12-31', '2026-01-01')), true);
// Unreadable text must not be silently treated as blank, which would quietly put the template back to
// running forever.
check('an unreadable start is refused', /not a readable date/i.test(templateDateError('nonsense', '2026-12-31')), true);
check('an unreadable end is refused', /not a readable date/i.test(templateDateError('2026-01-01', 'nonsense')), true);
check('a readable start with an unreadable end is refused', /not a readable date/i.test(templateDateError('2026-01-01', 'nonsense')), true);
// Whitespace is not a date: it must be refused as missing rather than stored as a blank cell.
check('whitespace is refused as missing', /effective date is required/i.test(templateDateError('   ', '')), true);

console.log('\n--- every occurrence generator applies the gate ---');
// The minimum is the number of CALL SITES, not imports: `import { templateIsActiveOn } from ...` has no
// parenthesis after the name, so the count below is call sites only. Two of these files build template
// occurrences in more than one loop, and a gate applied to only the first would leave a retired template
// drawing in the other - which is exactly what these counts pin.
const callSites = [
  ['src/components/ScheduleCalendar.jsx', 'the member calendar', 1],
  ['src/components/admin/AdminScheduleManagementTab.jsx', "the administrator's board and picker", 2],
  ['src/utils/availability.js', 'both availability views', 2],
];

for (const [path, what, minimum] of callSites) {
  const source = readFileSync(path, 'utf8');
  check(`${what} imports the gate`, /templateIsActiveOn/.test(source), true);
  // Counting references matters more than finding one: two of these files build template occurrences in
  // more than one loop, and a gate applied to only the first would leave a retired template drawing in
  // the other. The count includes the import.
  const references = (source.match(/templateIsActiveOn\(/g) || []).length;
  check(`${what} gates every loop (${references} references)`, references >= minimum, true);
}

// The member calendar's slot loop specifically, since that is the one a member sees.
// The window is generous on purpose: comments sit between the weekday check and the gate, and a
// character budget tight enough to break when a comment grows would fail for the wrong reason. The
// call-site counts above are what pin the coverage; these confirm the gate is in the same loop.
const calendarSource = readFileSync('src/components/ScheduleCalendar.jsx', 'utf8');
check(
  'the member slot loop gates on the date',
  /day_of_week[\s\S]{0,600}?templateIsActiveOn\(template, dateKey\)/.test(calendarSource),
  true
);

const boardSource = readFileSync('src/components/admin/AdminScheduleManagementTab.jsx', 'utf8');
check(
  'the board gates its month slots',
  /day_of_week[\s\S]{0,600}?templateIsActiveOn\(t, dateKey\)/.test(boardSource),
  true
);
check(
  'and its Add Shift picker',
  /templatesForDate[\s\S]{0,600}?templateIsActiveOn/.test(boardSource),
  true
);

const availabilitySource = readFileSync('src/utils/availability.js', 'utf8');
check(
  'the availability grid gates',
  /day_of_week[\s\S]{0,600}?templateIsActiveOn\(template, dateKey\)/.test(availabilitySource),
  true
);
check(
  'and the All Members roster gates',
  (availabilitySource.match(/templateIsActiveOn\(template, dateKey\)/g) || []).length === 2,
  true
);

console.log('\n--- the backend keeps up ---');
const code = readFileSync('src/services/Code.gs', 'utf8');
check('the save action accepts the effective date', /effective_date: toDateKeyValue\(/.test(code), true);
check('and the end date', /end_date: toDateKeyValue\(/.test(code), true);
check('and refuses an inverted range', /end date must not be before the effective date/i.test(code), true);
// Reusing the existing helper rather than adding a second date parser is the anti-drift point.
check('it reuses toDateKeyValue rather than a new parser', (code.match(/function toDateKeyValue/g) || []).length === 1, true);
check('the member projection includes the effective date', /effective_date: toDateKeyValue\(row\.effective_date\)/.test(code), true);
check('and the end date', /end_date: toDateKeyValue\(row\.end_date\)/.test(code), true);
// Members must receive the dates, or their calendar would keep drawing slots for a template that was
// retired for administrators only - letting a member offer on a shift nobody is running.
check(
  'and that projection is what members receive',
  /memberScheduleTemplateRows\(ss\)/.test(code) && (code.match(/memberScheduleTemplateRows\(ss\)/g) || []).length >= 2,
  true
);

console.log('\n--- the form and the API layer ---');
const apiSource = readFileSync('src/services/api.js', 'utf8');
check('the API sends the effective date', /effective_date: templateData\.effective_date/.test(apiSource), true);
check('and the end date', /end_date: templateData\.end_date/.test(apiSource), true);

const formSource = readFileSync('src/components/admin/AdminScheduleTemplatesTab.jsx', 'utf8');
check('the empty form carries both fields', /effective_date: ''[\s\S]{0,60}end_date: ''/.test(formSource), true);
check('editing seeds the effective date', /effective_date: templateDateKey\(/.test(formSource), true);
check('and the end date', /end_date: templateDateKey\(/.test(formSource), true);
check('the form validates before saving', /templateDateError\(formData\.effective_date, formData\.end_date\)/.test(formSource), true);
check('the card shows the window', /templateDateLabel\(s\.c\.template\)/.test(formSource), true);
check('a retired card is dimmed', /'retired' \? 'opacity-40'/.test(formSource), true);
check('a not-yet-effective card is ringed', /'scheduled' \? 'ring-2/.test(formSource), true);

console.log('\n--- the form and the API layer (rendered) ---');
const templateFormHtml = renderToString(
  React.createElement(AdminScheduleTemplatesTab, {
    token: 'TOKEN',
    scheduleTemplates: [],
    assignments: [{ id: '3', description: 'Engine 1' }],
    onDataChanged: () => {},
  })
);
const templateFormText = visibleText(templateFormHtml);
check('the form offers an Effective Date', /Effective Date/.test(templateFormText), true);
check('and an End Date', /End Date/.test(templateFormText), true);
// The label wraps "(required)" in a span, so prose assertions need the tags stripped as well as the
// SSR comment markers that visibleText removes.
const templateFormProse = templateFormText.replace(/<[^>]*>/g, '');
// The effective date is now required, so the form marks it as such and the end date stays optional.
check('the effective date is marked required', /Effective Date \(required\)/.test(templateFormProse), true);
check('the end date is marked optional', /End Date \(optional\)/.test(templateFormProse), true);
check('and the input carries the required attribute', /required=""/.test(templateFormHtml), true);
// Two optional markers remain (Nickname and End Date), down from three.
check('two optional fields remain', (templateFormProse.match(/\(optional\)/g) || []).length, 2);
check('two date inputs', (templateFormHtml.match(/type="date"/g) || []).length, 2);
check('explaining what the effective date means', /The first date this pattern runs/.test(templateFormProse), true);
check('and a blank end means it is still running', /still running/.test(templateFormProse), true);
check('with the inclusive-dates note', /Both dates are inclusive/.test(templateFormProse), true);

// A retired template must be visibly distinct on the grid, and a not-yet-effective one too - the grid is
// the only place both are listed, since neither produces shifts on the board any more.
const retiredHtml = renderToString(
  React.createElement(AdminScheduleTemplatesTab, {
    token: 'TOKEN',
    scheduleTemplates: [
      { id: 'r1', day_of_week: 'monday', start_time: '08:00', end_time: '18:00', assignment_id: '3', nickname: '', effective_date: '2020-01-01', end_date: '2021-01-01' },
      { id: 'r2', day_of_week: 'tuesday', start_time: '08:00', end_time: '18:00', assignment_id: '3', nickname: '', effective_date: '2099-01-01', end_date: '' },
      { id: 'r3', day_of_week: 'wednesday', start_time: '08:00', end_time: '18:00', assignment_id: '3', nickname: '', effective_date: '', end_date: '' },
    ],
    assignments: [{ id: '3', description: 'Engine 1' }],
    onDataChanged: () => {},
  })
);
check('a retired card is dimmed on the grid', /opacity-40/.test(retiredHtml), true);
check('a not-yet-effective card is ringed', /ring-2/.test(retiredHtml), true);
// Both dates present reads as a range, so "Jan 1, 2020 - Jan 1, 2021" rather than "Until ...". Only a
// template with an end date and NO effective date reads as "Until".
check('every dated card shows its window', /Jan 1, 2020 - Jan 1, 2021/.test(retiredHtml) && /From Jan 1, 2099/.test(retiredHtml), true);
check('the retired card is marked on hover', /Retired/.test(retiredHtml), true);
check('and the future card too', /Not yet effective/.test(retiredHtml), true);
// Both are still drawn: the grid is the editor, and retiring a template is meant to keep it editable
// rather than invisible.
check('all three cards are still rendered', (retiredHtml.match(/draggable="true"/g) || []).length, 3);
// The undated card must not carry a window label, which would imply a restriction it does not have.
const undatedCard = retiredHtml.split('draggable="true"')[3] || '';
check('the undated card carries no window label', /Until |From /.test(visibleText(undatedCard)), false);
// ...but it IS nudged, because the effective date is now required and this row predates that rule. A
// blank cell keeps working, so the nudge is how an administrator finds the rows still to fill in.
check('and the undated card is nudged', /No start date/.test(visibleText(retiredHtml)), true);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
