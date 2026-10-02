/**
 * Verifies the event-time repair, which writes to production data with the Admin SDK and therefore has no rules,
 * no reviewer and no second opinion between it and the station's calendar.
 *
 * What this exists for: `scripts/restore-event-times.mjs` rewrites `date_from`/`date_to` on live event documents. A
 * repair that is subtly wrong does not fail loudly - it moves a training to the wrong hour, or writes a pair the form
 * then refuses to save, and the only symptom is an officer who cannot edit their own event. So every guarantee the
 * script's header claims gets an assertion here.
 *
 * THE POINT OF IMPORTING THE APP: the repair cannot import src/utils/events.js (extensionless imports are Vite's
 * resolution, not node's), so it copies two small rules. A copy is a drift waiting to happen, which is why this
 * harness is built through Vite like verify-events.mjs: it holds BOTH the copy and the original and asserts they
 * agree, and it checks every pair the repair can produce against the app's OWN `eventValidation`. The repair is
 * therefore unable to write a pair the form would reject, without this file failing.
 *
 * Run with: npm run verify:event-times
 */
import {
  REASON_LABELS,
  TIME_FIELDS,
  eventTimeFixesFor,
  hasClockTime,
  isAllDayRow,
  isDayOnly,
  minutesOf,
} from './restore-event-times.mjs';
import { typedValue } from './migration-map.mjs';
// The app's own rules, which the repair copies and this file compares against.
import { eventFlag, eventMinutesOf, eventValidation } from '../src/utils/events.js';

let failures = 0;
const checkIs = (label, condition, detail = '') => {
  const ok = condition === true;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `: ${detail || 'expected true'}`}`);
};
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`
  );
};

console.log('--- the copied rules match the app, so they cannot drift ---');
// The all-day flag decides whether a day-only value is CORRECT or CORRUPT, so getting it wrong either invents a time
// nobody chose or leaves a broken event broken. Every shape a Firestore boolean column can hold is checked.
[true, false, 'true', 'TRUE', 'True', 'false', 'FALSE', 'yes', '1', '0', '', null, undefined].forEach((value) => {
  checkIs(
    `isAllDayRow agrees with eventFlag for ${JSON.stringify(value)}`,
    isAllDayRow({ is_all_day: value }) === eventFlag(value),
    `${isAllDayRow({ is_all_day: value })} vs ${eventFlag(value)}`
  );
});
// The minutes rule decides whether a restored pair is ordered, so it has to read a time exactly as the form does -
// including the app's own answers for a bare date (midnight) and an impossible clock time (unusable).
[
  '2026-11-10 18:00',
  '2026-11-10 06:05',
  '2026-11-10 8:00',
  '2026-11-10T18:00',
  '2026-11-10T18:00:00.000Z',
  '2026-11-10',
  '2026-11-10 24:30',
  '2026-11-10 18:60',
  '2026-11-10 23:59',
  '',
  '   ',
  'nonsense',
  '11/10/2026 18:00',
  null,
  undefined,
].forEach((value) => {
  checkIs(
    `minutesOf agrees with eventMinutesOf for ${JSON.stringify(value)}`,
    minutesOf(value) === eventMinutesOf(value),
    `${minutesOf(value)} vs ${eventMinutesOf(value)}`
  );
});

console.log('\n--- the guarantees, over every case the repair can meet ---');

const dayOf = (value) => String(value ?? '').trim().slice(0, 10);

// Every shape this repair can meet: the production ones found by reading the live collection, and the awkward ones a
// hand-edited sheet produces. Each goes through the SAME list of guarantees rather than getting a bespoke assertion,
// because a guarantee checked only on the happy case is not a guarantee.
const CASES = [
  {
    label: 'a timed event whose hour the migration lost',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10', is_all_day: false },
    sheetRow: { date_from: '11/10/2026 18:00', date_to: '11/10/2026 20:00' },
  },
  {
    label: 'a recurring event, whose dates carry ONLY times',
    stored: { date_from: '2026-09-24', date_to: '2026-09-24', is_recurring: true, recurring_start: '2026-09-01' },
    sheetRow: { date_from: '9/24/2026 19:00', date_to: '9/24/2026 21:30' },
  },
  {
    label: 'an overnight event',
    stored: { date_from: '2026-11-06', date_to: '2026-11-07' },
    sheetRow: { date_from: '11/6/2026 22:00', date_to: '11/7/2026 06:00' },
  },
  {
    label: 'an ALL-DAY event, which is correct as it stands',
    stored: { date_from: '2026-11-06', date_to: '2026-11-07', is_all_day: true },
    sheetRow: { date_from: '11/6/2026', date_to: '11/7/2026' },
  },
  {
    label: 'an all-day event whose flag is the string TRUE',
    stored: { date_from: '2026-11-06', date_to: '2026-11-07', is_all_day: 'TRUE' },
    sheetRow: { date_from: '11/6/2026 09:00', date_to: '11/7/2026 17:00' },
  },
  {
    label: 'an event created since cutover, so it is not in the sheet',
    stored: { date_from: '2026-12-01', date_to: '2026-12-01' },
    sheetRow: null,
  },
  {
    label: 'an event an officer has already fixed in the app',
    stored: { date_from: '2026-11-10 18:00', date_to: '2026-11-10 20:00' },
    sheetRow: { date_from: '11/10/2026 09:00', date_to: '11/10/2026 10:00' },
  },
  {
    label: 'a row whose time the sheet lost too',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10' },
    sheetRow: { date_from: '11/10/2026', date_to: '11/10/2026' },
  },
  {
    label: 'a sheet cell that is empty',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10' },
    sheetRow: { date_from: '', date_to: '' },
  },
  {
    label: 'a sheet row dating a DIFFERENT DAY',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10' },
    sheetRow: { date_from: '11/12/2026 18:00', date_to: '11/12/2026 20:00' },
  },
  {
    label: 'a sheet row whose end is before its start',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10' },
    sheetRow: { date_from: '11/10/2026 20:00', date_to: '11/10/2026 18:00' },
  },
  {
    label: 'a sheet row whose end EQUALS its start',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10' },
    sheetRow: { date_from: '11/10/2026 18:00', date_to: '11/10/2026 18:00' },
  },
  {
    label: 'a sheet row holding an impossible clock time',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10' },
    sheetRow: { date_from: '11/10/2026 24:30', date_to: '11/10/2026 26:00' },
  },
  {
    label: 'a document with no dates at all',
    stored: { title: 'No dates' },
    sheetRow: { date_from: '11/10/2026 18:00', date_to: '11/10/2026 20:00' },
  },
  {
    label: 'a document holding the sheet display text, not a key',
    stored: { date_from: '11/10/2026', date_to: '11/10/2026' },
    sheetRow: { date_from: '11/10/2026 18:00', date_to: '11/10/2026 20:00' },
  },
  {
    label: 'only one of the two fields lost its time',
    stored: { date_from: '2026-11-10', date_to: '2026-11-10 20:00' },
    sheetRow: { date_from: '11/10/2026 18:00', date_to: '11/10/2026 20:00' },
  },
  {
    label: 'an ISO instant, which already carries a time',
    stored: { date_from: '2026-11-10T18:00:00.000Z', date_to: '2026-11-10T20:00:00.000Z' },
    sheetRow: { date_from: '11/10/2026 09:00', date_to: '11/10/2026 10:00' },
  },
];

const seenReasons = new Set();
CASES.forEach(({ label, stored, sheetRow }) => {
  const { updates, reason } = eventTimeFixesFor({ stored, sheetRow });
  seenReasons.add(reason);

  // A reason outside the vocabulary is a report line nobody can read, and a group the summary silently drops.
  checkIs(`${label}: the reason is one the report can name`, reason in REASON_LABELS, reason);
  // It writes two fields or nothing. A repair that also touched a title or an audience would be rolling an officer's
  // work back to the sheet's stale copy.
  checkIs(
    `${label}: it writes only the two date fields`,
    Object.keys(updates).every((field) => TIME_FIELDS.includes(field)),
    Object.keys(updates).join(',')
  );
  // THE GUARANTEE THAT MATTERS MOST: it can add an hour, it cannot move an event to another day.
  checkIs(
    `${label}: it never changes the DAY`,
    Object.entries(updates).every(([field, value]) => dayOf(value) === dayOf(stored[field])),
    JSON.stringify(updates)
  );
  // An all-day event's day-only value is the shape the form writes, so touching it invents a time nobody chose.
  if (isAllDayRow(stored)) check(`${label}: an all-day event is left exactly alone`, updates, {});

  if (reason !== 'ok') return;
  const patched = { ...stored, ...updates };
  // THE APP IS THE AUTHORITY. If the form would refuse this pair the event becomes unsaveable, which is the very
  // failure this repair exists to undo - so writing it would be worse than leaving the row alone.
  //
  // But `eventValidation` only reaches the date pair for a SINGLE event: a recurring one returns early after checking
  // recurring_start/frequency/amount, and never looks at date_from/date_to at all (on a recurring event those carry
  // the TIMES only). So the form's verdict is asserted where it is actually rendered, and a recurring pair is checked
  // for the property that matters - that it is ordered - which the repair enforces for every case anyway.
  if (!eventFlag(stored.is_recurring)) {
    check(
      `${label}: the restored pair passes the app's own eventValidation`,
      eventValidation({ title: 'Any title', ...patched }),
      ''
    );
  }
  checkIs(
    `${label}: the restored pair is ordered`,
    dayOf(patched.date_to) > dayOf(patched.date_from) ||
      (dayOf(patched.date_to) === dayOf(patched.date_from) &&
        (minutesOf(patched.date_to) ?? -1) > (minutesOf(patched.date_from) ?? -1))
  );
  // THE FORM HAS TO BE ABLE TO DRAW IT, not merely accept it. `AdminEventsTab` hands these fields straight to an
  // `<input type="datetime-local">` (a single event: `date_from.replace(' ', 'T')`) or an `<input type="time">` (a
  // recurring one: `date_from.slice(11, 16)`), and both run the value sanitization algorithm - which sets the value to
  // EMPTY unless the hour is two digits. `eventValidation` passes `8:00` happily, so the form's verdict is not enough:
  // two cells in the sheet hold `8:00`, and restoring that verbatim would leave an officer staring at a blank "Starts"
  // field in the very form they would use to fix it. This is the property the map's zero-padding exists to keep.
  TIME_FIELDS.forEach((field) => {
    if (!(field in updates)) return;
    const value = String(updates[field]);
    checkIs(
      `${label}: ${field} is a shape <input type="time"> draws rather than sanitizes away`,
      /^\d{2}:\d{2}$/.test(value.slice(11, 16)),
      value
    );
    checkIs(
      `${label}: and one <input type="datetime-local"> draws`,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.replace(' ', 'T')),
      value
    );
  });



  // SAFE TO RUN TWICE: feeding the repair its own output must produce nothing, or a second run rewrites again.
  check(`${label}: a second run finds nothing to do`, eventTimeFixesFor({ stored: patched, sheetRow }).updates, {});
  // What it writes is what a FRESH MIGRATION writes for the same cell, so the repair and the map cannot disagree.
  TIME_FIELDS.forEach((field) => {
    if (!(field in updates)) return;
    check(`${label}: ${field} matches a fresh migration`, updates[field], typedValue(field, sheetRow[field]));
  });
});

checkIs(
  'every reason the vocabulary names is one a real case produces',
  Object.keys(REASON_LABELS).every((reason) => seenReasons.has(reason)),
  Object.keys(REASON_LABELS).filter((reason) => !seenReasons.has(reason)).join(',')
);

console.log('\n--- the state read from the live collection, and the bug this undoes ---');

// Read from production: 11 events, EVERY ONE of them day-only, 10 of them timed and 1 all-day. A timed event with
// both ends at midnight is not merely drawn wrong - `eventValidation` REFUSES it, so an officer who opens one to
// change the title cannot save it at all. That is asserted rather than described, because it is what makes this a
// repair worth running rather than a cosmetic one.
const productionTimed = { date_from: '2026-11-10', date_to: '2026-11-10', is_all_day: false };
checkIs(
  'a day-only timed event is currently UNSAVEABLE in the form',
  eventValidation({ title: 'Training', ...productionTimed }) !== '',
  eventValidation({ title: 'Training', ...productionTimed })
);
const productionRepair = eventTimeFixesFor({
  stored: productionTimed,
  sheetRow: { date_from: '11/10/2026 18:00', date_to: '11/10/2026 20:00' },
});
check('the repair restores the hour the migration dropped', productionRepair.updates, {
  date_from: '2026-11-10 18:00',
  date_to: '2026-11-10 20:00',
});

// TWO of the eleven rows hold a single-digit hour in the sheet - `2026-09-26 8:00` and `2026-10-31 8:00` - and this is
// the case that separates "the app accepts it" from "the app can DRAW it". `eventValidation` passes `8:00` and
// `eventMinutesOf` reads it as 480, so nothing downstream complains; but `AdminEventsTab` hands the field to an
// `<input type="datetime-local">` as `2026-09-26T8:00`, which is not a valid local date-and-time string, so the browser
// sanitizes the input to EMPTY and the officer sees a blank "Starts". Hence the padded hour.
const productionSingleDigit = { date_from: '2026-09-26', date_to: '2026-09-26', is_all_day: false };
const singleDigitRepair = eventTimeFixesFor({
  stored: productionSingleDigit,
  sheetRow: { date_from: '2026-09-26 8:00', date_to: '2026-09-26 17:00' },
});
check('a single-digit hour in the sheet is restored zero-padded', singleDigitRepair.updates, {
  date_from: '2026-09-26 08:00',
  date_to: '2026-09-26 17:00',
});
const datetimeLocal = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value).replace(' ', 'T'));
checkIs(
  "the hour the sheet holds would draw blank in the officer's form, and the one it writes will not",
  !datetimeLocal('2026-09-26 8:00') && datetimeLocal(singleDigitRepair.updates.date_from),
  `sheet: 2026-09-26 8:00 -> ${datetimeLocal('2026-09-26 8:00')}, restored: ${singleDigitRepair.updates.date_from} -> ${datetimeLocal(singleDigitRepair.updates.date_from)}`
);

check('which makes the event saveable again', eventValidation({ title: 'Training', ...productionTimed, ...productionRepair.updates }), '');

// The one all-day event in the collection. Day-only is what AdminEventsTab writes for one and the app reads its dates
// INCLUSIVELY, so it is right as it stands and has to survive the repair unchanged - even with times on offer.
const productionAllDay = { date_from: '2026-11-06', date_to: '2026-11-07', is_all_day: true };
checkIs('an all-day event is valid exactly as it stands', eventValidation({ title: 'Bazaar', ...productionAllDay }) === '');
check(
  'and the repair leaves it alone even when the sheet offers times',
  eventTimeFixesFor({
    stored: productionAllDay,
    sheetRow: { date_from: '11/6/2026 09:00', date_to: '11/7/2026 17:00' },
  }).updates,
  {}
);

// The recurring event: its dates carry ONLY times, so a day-only pair is an event with NO time rather than a wrong
// hour - the worst case, found by the same test and fixed by the same repair rather than a special case.
check(
  'a recurring event gets its times back the same way',
  eventTimeFixesFor({
    stored: { date_from: '2026-09-24', date_to: '2026-09-24', is_recurring: true },
    sheetRow: { date_from: '9/24/2026 19:00', date_to: '9/24/2026 21:30' },
  }).updates,
  { date_from: '2026-09-24 19:00', date_to: '2026-09-24 21:30' }
);

// The recognisers everything above rests on.
checkIs('a day-only key is recognised as having lost its time', isDayOnly('2026-11-10'));
checkIs('a value carrying a time is not treated as one', isDayOnly('2026-11-10 18:00') === false);
checkIs('and neither is sheet display text, which is a different repair', isDayOnly('11/10/2026') === false);
checkIs(
  'hasClockTime sees a time in either shape the app stores',
  hasClockTime('2026-11-10 18:00') && hasClockTime('2026-11-10T18:00:00.000Z')
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);




