/**
 * Formats a Date object or timestamp string based on 12-hour or 24-hour preference.
 * 
 * @param {Date|string|number} dateInput - Date object or date string
 * @param {string|number} formatPreference - '12' or '24'
 * @param {boolean} includeSeconds - Whether to render seconds
 * @return {string} Formatted time string
 */
export const formatStationTime = (dateInput, formatPreference = '12', includeSeconds = true) => {
  if (!dateInput) return '--';
  
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '--';

  const is24Hour = String(formatPreference) === '24';

  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour12: !is24Hour,
    hour: is24Hour ? '2-digit' : '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
  });
};