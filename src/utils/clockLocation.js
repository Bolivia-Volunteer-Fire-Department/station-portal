// Optional geofence for clocking in and out.
//
// Three system_settings keys drive it:
//
//   required_clock_latitude   station latitude
//   required_clock_longitude  station longitude
//   gps_margin_of_error       allowed radius, in IMPERIAL FEET
//
// The rule is all-or-nothing: unless all three hold valid values the feature is off and clocking
// behaves exactly as it did before, so a half-filled configuration can never lock the station
// out of its own timeclock. That makes `configured: false` (rather than an error) the safe answer
// for a partial setup, and `missing` reports which keys are outstanding for the admin UI.
//
// Everything here is a pure function over the settings rows the API already returns, which is
// what makes the geometry testable - see scripts/verify-clock-location.mjs.

// Mean Earth radius. A geofence's job is to answer "are they roughly here?", and the haversine
// formula at this radius is within a few tenths of a percent, far inside any margin a station
// would set in feet.
const EARTH_RADIUS_METERS = 6371008.8;

export const FEET_PER_METER = 3.280839895;

export const CLOCK_LOCATION_KEYS = {
  latitude: 'required_clock_latitude',
  longitude: 'required_clock_longitude',
  margin: 'gps_margin_of_error',
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Reads a system_settings value. The app holds settings as an array of { key, value } rows from
// the sheet, but accepts a plain object too so callers with a reduced map can use it.
export const settingValue = (systemSettings, key) => {
  if (!systemSettings) return undefined;
  if (Array.isArray(systemSettings)) {
    const row = systemSettings.find((entry) => String(entry?.key) === key);
    return row ? row.value : undefined;
  }
  return systemSettings[key];
};

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

// A blank cell is "not configured"; anything else must be a real number in range. Degrees and
// feet are both plain decimals in the sheet, and a value like "39.5 °" or "1,000" is a typo that
// should turn the feature OFF rather than silently evaluate as 39.5 or 1.
const parseNumber = (value) => {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseLatitude = (value) => {
  const parsed = parseNumber(value);
  return parsed !== null && parsed >= -90 && parsed <= 90 ? parsed : null;
};

export const parseLongitude = (value) => {
  const parsed = parseNumber(value);
  return parsed !== null && parsed >= -180 && parsed <= 180 ? parsed : null;
};

// A radius of zero would reject everyone, and a negative one is meaningless, so both count as
// "not configured" rather than a silent lockout.
export const parseMarginFeet = (value) => {
  const parsed = parseNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

// The geofence for a station, as read from system_settings.
export const clockLocationConfig = (systemSettings) => {
  const rawLatitude = settingValue(systemSettings, CLOCK_LOCATION_KEYS.latitude);
  const rawLongitude = settingValue(systemSettings, CLOCK_LOCATION_KEYS.longitude);
  const rawMargin = settingValue(systemSettings, CLOCK_LOCATION_KEYS.margin);

  const latitude = parseLatitude(rawLatitude);
  const longitude = parseLongitude(rawLongitude);
  const marginFeet = parseMarginFeet(rawMargin);

  // Which keys are filled in at all, versus filled in correctly. A key that is present but
  // unreadable is reported too - "39.5N" is a configuration mistake, not an empty setting.
  const missing = [];
  if (isBlank(rawLatitude)) missing.push(CLOCK_LOCATION_KEYS.latitude);
  if (isBlank(rawLongitude)) missing.push(CLOCK_LOCATION_KEYS.longitude);
  if (isBlank(rawMargin)) missing.push(CLOCK_LOCATION_KEYS.margin);

  const invalid = [];
  if (!isBlank(rawLatitude) && latitude === null) invalid.push(CLOCK_LOCATION_KEYS.latitude);
  if (!isBlank(rawLongitude) && longitude === null) invalid.push(CLOCK_LOCATION_KEYS.longitude);
  if (!isBlank(rawMargin) && marginFeet === null) invalid.push(CLOCK_LOCATION_KEYS.margin);

  return {
    configured: latitude !== null && longitude !== null && marginFeet !== null,
    latitude,
    longitude,
    marginFeet,
    missing,
    invalid,
  };
};

// Great-circle distance in feet between two { latitude, longitude } points.
export const distanceInFeet = (from, to) => {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  const meters = 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));

  return meters * FEET_PER_METER;
};

export const hasCoordinates = (coords) =>
  !!coords &&
  typeof coords.latitude === 'number' &&
  Number.isFinite(coords.latitude) &&
  typeof coords.longitude === 'number' &&
  Number.isFinite(coords.longitude);

const formatFeet = (feet) => Math.round(feet).toLocaleString('en-US');

// Decides whether a clock action may proceed.
//
// Codes:
//   'disabled'   no geofence configured - every other rule is skipped
//   'no-coords'  a geofence IS configured but the browser gave us nothing
//   'outside'    coordinates captured, but beyond the margin
//   'ok'
//
// Note that missing coordinates only block when a geofence is configured. That is deliberate: the
// requirement is all-or-nothing, so a station that has not set the keys keeps clocking in exactly
// as it does today, even for a member who has denied location access.
export const evaluateClockLocation = (coords, config) => {
  if (!config || !config.configured) {
    return { allowed: true, code: 'disabled', distanceFeet: null, message: '' };
  }

  if (!hasCoordinates(coords)) {
    return {
      allowed: false,
      code: 'no-coords',
      distanceFeet: null,
      message:
        'Your location could not be determined, so this clock action was rejected. Allow location access for this site and try again.',
    };
  }

  const distanceFeet = distanceInFeet(coords, {
    latitude: config.latitude,
    longitude: config.longitude,
  });

  if (distanceFeet > config.marginFeet) {
    return {
      allowed: false,
      code: 'outside',
      distanceFeet,
      message: `You are about ${formatFeet(distanceFeet)}ft from the station, outside the ${formatFeet(
        config.marginFeet
      )}ft limit.`,
    };
  }

  return { allowed: true, code: 'ok', distanceFeet, message: '' };
};

// The code the backend uses when IT refuses a clock action on location. Must match Code.gs - the
// client routes that code to the same modal as its own check, because the fence can be enabled while
// a page is already open, in which case only the server refuses.
export const OUT_OF_RANGE_CODE = 'OUT_OF_RANGE';

// What to show a member whose clock action was refused for location, or null when there is nothing to
// report.
//
// Written as a pure function of the outcome so the wording and the numbers can be tested, and so the
// modal stays a dumb renderer. `config` is used only to name the limit in the client's own case.
//
// The client and server outcomes are shaped differently on purpose: the client knows WHICH rule
// failed and how far away the member is, while the server only reports that it refused. So the client
// case says "move closer" with the numbers, and the server case shows its message and a hint that
// covers both possibilities.
export const clockLocationNotice = (outcome, config) => {
  if (!outcome || outcome.allowed === true) return null;

  if (outcome.code === 'no-coords') {
    return {
      kind: 'no-location',
      title: 'Location required',
      message: outcome.message,
      hint: 'Allow location access for this site in your browser, then try the button again.',
      distanceFeet: null,
      limitFeet: null,
    };
  }

  if (outcome.code === 'outside') {
    return {
      kind: 'too-far',
      title: 'Too far from the station',
      message: outcome.message,
      hint: 'Clock in and out has to be done at the station. Move closer and try again.',
      distanceFeet: Number.isFinite(outcome.distanceFeet) ? outcome.distanceFeet : null,
      limitFeet: config && Number.isFinite(config.marginFeet) ? config.marginFeet : null,
    };
  }

  if (outcome.code === OUT_OF_RANGE_CODE) {
    return {
      kind: 'too-far',
      title: 'Clock action not allowed here',
      message: outcome.message || 'The station requires clocking in and out to be done on site.',
      hint: 'If you are at the station, check that location access is allowed for this site.',
      distanceFeet: null,
      limitFeet: null,
    };
  }

  // An unrecognised refusal still gets a modal rather than silence - that is the whole point.
  return {
    kind: 'blocked',
    title: 'Clock action blocked',
    message: outcome.message || 'This clock action was refused.',
    hint: 'Try again, or ask an administrator if it keeps happening.',
    distanceFeet: null,
    limitFeet: null,
  };
};


