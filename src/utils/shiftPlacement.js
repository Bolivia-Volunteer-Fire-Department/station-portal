// Which day a shift is drawn on.
//
// A shift that runs past midnight - a 22:00-04:00 overnight, or a multi-day
// assignment - is drawn ONLY on the day it STARTS. Drawing it on every day it
// covered made a single overnight shift look like two separate shifts, and an
// OPEN overnight shift look like two separate vacancies to fill, which is worse:
// members would offer on a day the shift does not actually start.
//
// Nothing is lost by placing it once, because the pill still prints the whole
// window ("10:00 PM - 4:00 AM") and the detail list below the calendar prints the
// full date range. The start day is also the day the shift's hours are measured
// from, so it is the only unambiguous place to put it.
//
// Shared by the member calendar (My Schedule) and the admin board (Schedule
// Management) so both agree. Note that a row still COUNTS as covering the days it
// spans - that is a separate question, answered by overlap checks - so a long
// shift does not leave a later slot of the same template looking vacant.
export const isShiftDay = (fromKey, dateKey) => {
  const from = String(fromKey ?? '').trim();
  if (from === '') return false; // no date info: never claim a day
  return from === String(dateKey ?? '').trim();
};
