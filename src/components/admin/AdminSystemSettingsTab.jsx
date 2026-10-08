import React, { useEffect, useState } from 'react';
import { Save, Loader2, Pencil, PenLine, Trash2, Plus, AlertCircle, X, Monitor, Settings2, Building2, MapPin, TimerOff, Volume2 } from 'lucide-react';
import { adminSaveSystemSetting, adminSaveSystemSettings, isUnknownAction, adminDeleteSystemSetting } from '../../services/api';
import { clockLocationConfig } from '../../utils/clockLocation';
import { CLOCK_ROUNDING_KEY, CLOCK_ROUNDING_OPTIONS, clockRoundingMinutes } from '../../utils/clockRounding';
import { sessionTimeoutConfig } from '../../utils/sessionTimeout';
// The signing window's own key and parser, from the module the member's Training module reads them with - so the card's
// preview of a typed value and the rule the Sign button follows cannot be two different rules.
import { SIGNATURE_WINDOW_KEY, signatureWindowConfig } from '../../utils/training';
import { getCurrentCoordinates } from '../../utils/geolocation';
import {
  getSettingValue,
  getLoadingMessages,
  loadingMessageSavePlan,
  updateLoadingMessages,
  LOADING_MESSAGE_KEYS,
} from '../../utils/systemSettings';
import ToggleSwitch from '../ToggleSwitch';
import CenteredContent from '../CenteredContent';
import ConfirmModal from '../ConfirmModal';

// Keys surfaced in their own curated category card rather than the generic list below. The loading messages
// are curated too - ten of them, named rather than repeated here (see utils/systemSettings).
const KNOWN_KEYS = [
  'department_name',
  'time_format',
  'is_dark_mode',
  'is_sounds_active',
  'required_clock_latitude',
  'required_clock_longitude',
  'gps_margin_of_error',
  CLOCK_ROUNDING_KEY,
  'session_timeout',
  // The signing window for trainings: curated because a BLANK value means NO LIMIT rather than "off", which the generic
  // value editor has no way to say - the same reason the session timeout has a card (see utils/training#signatureWindowConfig).
  SIGNATURE_WINDOW_KEY,
  ...LOADING_MESSAGE_KEYS,
];

function isTruthySetting(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

export default function AdminSystemSettingsTab({ token, systemSettings, onDataChanged }) {
  // Capped and centerd: this is a stack of setting cards rather than a table, so full width on a wide
  // monitor would leave the labels and their controls far apart. See utils/contentWidth.
  return (
    <CenteredContent className="space-y-6">
      <GeneralSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <ClockSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <SessionTimeoutCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <SignatureWindowCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <DisplaySettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <SoundSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <LoadingMessagesCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <CustomSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
    </CenteredContent>
  );
}

function GeneralSettingsCard({ token, systemSettings, onDataChanged }) {
  const [departmentName, setDepartmentName] = useState(getSettingValue(systemSettings, 'department_name', ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDepartmentName(getSettingValue(systemSettings, 'department_name', ''));
  }, [systemSettings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting('department_name', departmentName, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save general settings.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save general settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">General Settings</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Basic identity used across the app.</p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Department Name</label>
          <input
            type="text"
            placeholder="e.g. Riverside Fire Department"
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">Shown on the login screen and browser tab title.</p>
        </div>

        <div className="flex justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80 mt-2">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save General Settings
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Clock Settings: the two station-wide policies about the timeclock - how hours are rounded when they are reported, and
 * whether clocking in and out is restricted to the station.
 *
 * The rounding field is first because it always applies, while the fence only applies once all three of its keys are
 * filled in: any blank one leaves clocking exactly as it is today, so a half-finished setup cannot lock the station out
 * of its own timeclock. The card says which state the fence is in so the behavior is never a guess.
 *
 * "Use my current location" exists because typing a latitude and longitude by hand is the most error-prone part of this,
 * and the person configuring it is usually standing at the station.
 */
function ClockSettingsCard({ token, systemSettings, onDataChanged }) {
  const [latitude, setLatitude] = useState(getSettingValue(systemSettings, 'required_clock_latitude', ''));
  const [longitude, setLongitude] = useState(getSettingValue(systemSettings, 'required_clock_longitude', ''));
  const [margin, setMargin] = useState(getSettingValue(systemSettings, 'gps_margin_of_error', ''));
  const [rounding, setRounding] = useState(String(clockRoundingMinutes(systemSettings)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    setLatitude(getSettingValue(systemSettings, 'required_clock_latitude', ''));
    setLongitude(getSettingValue(systemSettings, 'required_clock_longitude', ''));
    setMargin(getSettingValue(systemSettings, 'gps_margin_of_error', ''));
    setRounding(String(clockRoundingMinutes(systemSettings)));
  }, [systemSettings]);

  // Evaluated live on the typed values, so the card reports what the next clock action will do
  // rather than what the last save stored.
  const preview = clockLocationConfig([
    { key: 'required_clock_latitude', value: latitude },
    { key: 'required_clock_longitude', value: longitude },
    { key: 'gps_margin_of_error', value: margin },
  ]);

  const handleUseCurrentLocation = async () => {
    setError(null);
    setLocating(true);
    const coords = await getCurrentCoordinates();
    setLocating(false);

    if (typeof coords?.latitude !== 'number' || typeof coords?.longitude !== 'number') {
      setError('Could not read this device’s location. Allow location access in the browser and try again.');
      return;
    }
    setLatitude(String(coords.latitude));
    setLongitude(String(coords.longitude));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Saved in sequence rather than in parallel: each key is one Apps Script round trip, and a
      // partial write is easier to reason about when the failure names the key that failed.
      const entries = [
        // The rounding first: it is the one that always applies, so a name-and-value list that fails on it should not
        // leave the other three looking saved.
        [CLOCK_ROUNDING_KEY, rounding],
        ['required_clock_latitude', latitude],
        ['required_clock_longitude', longitude],
        ['gps_margin_of_error', margin],
      ];
      for (const [key, value] of entries) {
        const result = await adminSaveSystemSetting(key, String(value ?? '').trim(), token);
        if (!result?.success) throw new Error(result?.message || `Failed to save ${key}.`);
      }
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save the clock location settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Clock Settings</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              How reported hours are rounded, and whether clocking is restricted to the station.
            </p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              preview.configured
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {preview.configured ? 'Enforcing' : 'Not enforced'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ONE SETTING, TWO SCREENS. The member's own Clock History and the Clocked vs scheduled report both round by
            this, so the hours a member reads are the hours an officer pays for. Recorded times are never touched - only
            the hours the app reports. */}
        <div>
          <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
            Round reported hours
          </label>
          <select
            value={rounding}
            onChange={(e) => setRounding(e.target.value)}
            className="w-full sm:w-72 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {CLOCK_ROUNDING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Applies to Clock History — each entry's hours, the shift it fell in, and the totals — and to the Clocked vs
            scheduled report. Change it when the station's pay structure changes; no recorded time is affected.
          </p>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-700/80">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Clock-in location</p>

        <p className="text-sm text-slate-500 dark:text-slate-400">
          {preview.configured ? (
            <>
              Members can only clock in or out within{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                {Number(margin).toLocaleString('en-US')} feet
              </strong>{' '}
              of{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">
                {preview.latitude}, {preview.longitude}
              </code>
              . A device whose location cannot be read — including one that has denied location
              access — cannot clock in or out at all.
            </>
          ) : (
            <>
              Clocking in and out is{' '}
              <strong className="text-slate-700 dark:text-slate-300">not restricted</strong>. Fill in
              all three values below to enforce a location; any blank or unreadable value leaves this
              switched off.
            </>
          )}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Latitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 39.277157"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Longitude</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. -78.238330"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Margin (feet)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 1000"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        {/* Says which of the two failure modes applies: a wrong value, or simply nothing entered. */}
        {(preview.invalid.length > 0 || preview.missing.length > 0) && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {preview.invalid.length > 0
              ? `Not a valid value: ${preview.invalid.join(', ')}. Latitude runs -90 to 90, longitude -180 to 180, and the margin must be greater than zero.`
              : `Still blank: ${preview.missing.join(', ')}. The location check stays off until all three hold valid values.`}
          </p>
        )}

        </div>

        <div className="flex flex-wrap justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80 mt-2">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="flex items-center gap-2 mr-auto text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 transition disabled:opacity-50"
          >
            {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            Use my current location
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Clock Settings
          </button>
        </div>
      </form>
    </div>
  );
}

// Idle session timeout. A member who neither interacts nor navigates for this many minutes is
// signed out - see utils/sessionTimeout.js for the client half and the idle-timer note there for the
// server half, which is what actually stops the token being used afterwards.
function SessionTimeoutCard({ token, systemSettings, onDataChanged }) {
  const [minutes, setMinutes] = useState(getSettingValue(systemSettings, 'session_timeout', ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  // Previewed from the TYPED value rather than the stored one, so the effect of a change is visible
  // before it is saved - and so a typo is reported here rather than silently switching it off.
  const preview = sessionTimeoutConfig([{ key: 'session_timeout', value: minutes }]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting('session_timeout', String(minutes ?? '').trim(), token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the session timeout.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save the session timeout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <TimerOff className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Session Timeout</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sign members out after a period of inactivity.
            </p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              preview.configured
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {preview.configured ? 'Enforcing' : 'Not enforced'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">
          {preview.configured ? (
            <>
              A member who neither interacts with the app nor moves between modules for{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                {preview.minutes} minute{preview.minutes === 1 ? '' : 's'}
              </strong>{' '}
              is signed out, and their session stops working on the server at the same time. They are
              warned in the final minute and can choose to stay signed in.
            </>
          ) : preview.invalid ? (
            <>
              <strong className="text-amber-600 dark:text-amber-400">
                &ldquo;{preview.raw}&rdquo; cannot be used, so this is switched off.
              </strong>{' '}
              Enter a whole number of minutes — for example{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">30</code>. An unreadable
              value is ignored rather than applied, so a typo never signs the whole department out at
              once.
            </>
          ) : (
            <>
              Sessions are{' '}
              <strong className="text-slate-700 dark:text-slate-300">not timed out for inactivity</strong>.
              Leave this blank to keep the previous behavior of a 12-hour session; fill it in to sign
              members out after that many idle minutes.
            </>
          )}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Idle timeout (minutes)
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={minutes}
              onChange={(e) => { setMinutes(e.target.value); setSaved(false); }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="sm:col-span-2 flex items-end">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Counted from the last interaction — a click, a keypress, a scroll, or moving between
              modules. Saving applies to signed-in members at once; members who are not signed in pick
              it up when they next sign in.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => { setMinutes(''); setSaved(false); }}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            Clear (switch off)
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Session Timeout
          </button>
        </div>
      </form>
    </div>
  );
}

// THE TRAINING SIGNING WINDOW: how long after its date a training may still be signed.
//
// A card rather than a row in the generic editor, for the session timeout's reason and one more: a BLANK value means NO
// LIMIT here, which is the opposite of what a blank means in a key/value list. It says what the window does to the
// member's screen, because that is the only place its effect shows.
function SignatureWindowCard({ token, systemSettings, onDataChanged }) {
  const [days, setDays] = useState(getSettingValue(systemSettings, SIGNATURE_WINDOW_KEY, ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDays(getSettingValue(systemSettings, SIGNATURE_WINDOW_KEY, ''));
  }, [systemSettings]);

  // Previewed from the TYPED value rather than the stored one, so the effect of a change is visible before it is saved
  // and a typo is reported here rather than silently switching the window off.
  const preview = signatureWindowConfig([{ key: SIGNATURE_WINDOW_KEY, value: days }]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting(SIGNATURE_WINDOW_KEY, String(days ?? '').trim(), token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the signing window.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save the signing window.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <PenLine className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Training Signing Window</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              How long after its date a training stays open for signatures.
            </p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              preview.configured
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {preview.configured ? `${preview.days} day${preview.days === 1 ? '' : 's'}` : 'No limit'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">
          {preview.configured ? (
            <>
              A training can be signed for{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                {preview.days} day{preview.days === 1 ? '' : 's'}
              </strong>{' '}
              after its date, counting the date itself — so a 30-day window on 1 March closes after 31 March. After that
              the <strong className="text-slate-700 dark:text-slate-300">Sign</strong> button reads Closed for every
              member. A signature that is genuinely missing is then yours to sort out here: widen the window, let them
              sign, and set it back. A training marked as Locked stays closed, whatever the date.
            </>
          ) : preview.invalid ? (
            <>
              <strong className="text-amber-600 dark:text-amber-400">
                &ldquo;{preview.raw}&rdquo; cannot be used, so there is no window at all.
              </strong>{' '}
              Enter a whole number of days — for example{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">
                30
              </code>
              . An unreadable value is ignored rather than applied, so a typo can never close every training in the
              station at once.
            </>
          ) : (
            <>
              Trainings are{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                open for signature for as long as they exist
              </strong>
              . Leave this blank to keep that, or fill it in to close signing a set number of days after each training's
              date — which is what stops a member signing six months of trainings in one pass.
            </>
          )}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Signable for (days after the date)
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setSaved(false);
              }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="sm:col-span-2 flex items-end">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Counted from the training's own date, so one number covers every training at once. Signatures already given
              are untouched: closing the window stops new ones, and removing one stays an administrator's action — a
              signature is an acknowledgment of attendance, not a preference.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDays('');
              setSaved(false);
            }}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            Clear (no limit)
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Signing Window
          </button>
        </div>

      </form>
    </div>
  );
}

function SoundSettingsCard({ token, systemSettings, onDataChanged }) {
  const [soundsActive, setSoundsActive] = useState(
    isTruthySetting(getSettingValue(systemSettings, 'is_sounds_active', 'true'))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Keep the local form in sync if settings are reloaded from the sheet
  useEffect(() => {
    setSoundsActive(isTruthySetting(getSettingValue(systemSettings, 'is_sounds_active', 'true')));
  }, [systemSettings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting('is_sounds_active', String(soundsActive), token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save sound settings.');

      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save sound settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Sound Settings</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Station-wide default for interface sounds.</p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <ToggleSwitch
          label="Sound Effects"
          description="Clicks, toasts and notifications make a sound. Members can turn this off for themselves, and a member who has never changed it follows this."
          enabled={soundsActive}
          onChange={setSoundsActive}
        />

        {/* Says out loud what this setting does NOT reach, because "sounds off" reads like it covers everything.
            The minigame's effects are its own, and a push notification's OS banner is the device's. */}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The Firefighter Runner keeps its own sound effects, and this does not silence a device's own notification
          banner.
        </p>

        <div className="flex justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80 mt-2">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Sound Settings
          </button>
        </div>
      </form>
    </div>
  );
}

function DisplaySettingsCard({ token, systemSettings, onDataChanged }) {
  const [timeFormat, setTimeFormat] = useState(getSettingValue(systemSettings, 'time_format', '12'));
  const [darkMode, setDarkMode] = useState(isTruthySetting(getSettingValue(systemSettings, 'is_dark_mode', 'true')));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Keep the local form in sync if settings are reloaded from the sheet
  useEffect(() => {
    setTimeFormat(getSettingValue(systemSettings, 'time_format', '12'));
    setDarkMode(isTruthySetting(getSettingValue(systemSettings, 'is_dark_mode', 'true')));
  }, [systemSettings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting('time_format', String(timeFormat), token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save display settings.');

      const darkModeResult = await adminSaveSystemSetting('is_dark_mode', String(darkMode), token);
      if (!darkModeResult?.success) throw new Error(darkModeResult?.message || 'Failed to save display settings.');

      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save display settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Monitor className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Display Settings</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Station-wide default for how time is displayed.</p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label
            className={`flex items-start p-4 rounded-xl border cursor-pointer transition ${
              String(timeFormat) === '12'
                ? 'bg-red-500/10 border-red-500 text-slate-900 dark:text-white'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900/60 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <input
              type="radio"
              name="time_format"
              value="12"
              checked={String(timeFormat) === '12'}
              onChange={(e) => setTimeFormat(e.target.value)}
              className="sr-only"
            />
            <div>
              <div className="font-semibold text-sm">12-Hour Clock</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Example: <span className="font-mono text-slate-700 dark:text-slate-200">06:00:00 PM</span>
              </div>
            </div>
          </label>

          <label
            className={`flex items-start p-4 rounded-xl border cursor-pointer transition ${
              String(timeFormat) === '24'
                ? 'bg-red-500/10 border-red-500 text-slate-900 dark:text-white'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900/60 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <input
              type="radio"
              name="time_format"
              value="24"
              checked={String(timeFormat) === '24'}
              onChange={(e) => setTimeFormat(e.target.value)}
              className="sr-only"
            />
            <div>
              <div className="font-semibold text-sm">24-Hour Clock</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Example: <span className="font-mono text-slate-700 dark:text-slate-200">18:00:00</span>
              </div>
            </div>
          </label>
        </div>

        <ToggleSwitch
          label="Dark Mode"
          description="Use the dark station theme across the app. Users can override this."
          enabled={darkMode}
          onChange={setDarkMode}
        />

        <div className="flex justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80 mt-2">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Display Settings
          </button>
        </div>
      </form>
    </div>
  );
}

function CustomSettingsCard({ token, systemSettings, onDataChanged }) {
  const EMPTY_FORM = { originalKey: '', key: '', value: '' };
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState(null);
  // The row whose delete is being confirmed in the modal below.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [error, setError] = useState(null);

  const isEditing = !!formData.originalKey;
  const resetForm = () => setFormData(EMPTY_FORM);
  const otherSettings = systemSettings.filter((s) => !KNOWN_KEYS.includes(String(s.key)));

  const handleEdit = (setting) => {
    setError(null);
    setFormData({ originalKey: setting.key, key: setting.key, value: setting.value ?? '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // If the key was renamed while editing, remove the old entry first
      if (isEditing && formData.originalKey !== formData.key) {
        await adminDeleteSystemSetting(formData.originalKey, token);
      }
      const result = await adminSaveSystemSetting(formData.key, formData.value, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save setting.');
      void onDataChanged();
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save setting.');
    } finally {
      setSaving(false);
    }
  };

  // The row awaiting confirmation. Nothing is written until the modal below is answered; the work
  // itself is unchanged, it just runs from the modal's callback instead of inline.
  const handleDelete = (setting) => setPendingDelete(setting);

  const confirmDelete = async () => {
    const setting = pendingDelete;
    setPendingDelete(null);
    if (!setting) return;
    setDeletingKey(setting.key);
    setError(null);
    try {
      const result = await adminDeleteSystemSetting(setting.key, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete setting.');
      void onDataChanged();
      if (formData.originalKey === setting.key) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete setting.');
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 pb-0 flex items-center gap-3">
        <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
          <Settings2 className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Custom Settings</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Additional configuration values not covered by a dedicated section above.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{isEditing ? `Edit Setting "${formData.originalKey}"` : 'Add New Setting'}</h4>
          {isEditing && (
            <button type="button" onClick={resetForm} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 text-sm">
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Key</label>
            <input
              type="text"
              required
              value={formData.key}
              onChange={(e) => setFormData({ ...formData, key: e.target.value })}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Value</label>
            <input
              type="text"
              value={formData.value}
              onChange={(e) => setFormData({ ...formData, value: e.target.value })}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isEditing ? 'Save Changes' : 'Add Setting'}
          </button>
        </div>
      </form>

      <div className="border-t border-slate-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {otherSettings.map((setting) => (
              <tr key={setting.key} className="text-slate-700 dark:text-slate-200">
                <td className="px-4 py-3 font-medium font-mono">{setting.key}</td>
                <td className="px-4 py-3">{String(setting.value)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(setting)} className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(setting)}
                      disabled={deletingKey === setting.key}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {deletingKey === setting.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {otherSettings.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500">No custom settings found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmed in the app rather than by a native dialog: it can be styled, it is heard
          (ConfirmModal plays the tone), and it names what is about to be deleted. It lives in THIS card, not at the
          end of the file, because this is the component that holds the setting being deleted - the tab is a stack of
          separate cards, and a dialog rendered from the wrong one would not compile, let alone work. */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete setting"
          message={<>Delete setting <strong className="text-slate-900 dark:text-white">{pendingDelete.key}</strong>?</>}
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
function LoadingMessagesCard({ token, systemSettings, onDataChanged }) {
  const [loadingMessages, setLoadingMessages] = useState(() => getLoadingMessages(systemSettings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoadingMessages(getLoadingMessages(systemSettings));
  }, [systemSettings]);

  const handleSave = async (e) => {
    e.preventDefault();
    // No gate on a previous error: an earlier version only saved `if (!error)`, so once a save had failed the
    // button did nothing at all until the tab was remounted - the retry was silently discarded.
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // All ten in ONE request, so a failure cannot leave some saved and some not. The backend validates every
      // pair before writing any of them - see loadingMessageSavePlan and setSystemSettingsBatch.
      const plan = loadingMessageSavePlan(loadingMessages);
      const result = await adminSaveSystemSettings(
        plan.map(({ key, value }) => ({ key, value })),
        token
      );

      // The deployment in front of us may predate this action - the page and the backend are deployed
      // separately. UNKNOWN_ACTION is exactly that case, so fall back to the per-key save rather than
      // reporting a failure for an action the server has never heard of.
      if (isUnknownAction(result)) {
        console.warn('This deployment has no batch settings action; saving each setting on its own.');
        for (const { key, value, label } of plan) {
          const one = await adminSaveSystemSetting(key, value, token);
          if (!one?.success) throw new Error(one?.message || `Failed to save ${label}.`);
        }
        void onDataChanged();
        setSaved(true);
        return;
      }

      if (!result?.success) throw new Error(result?.message || 'Failed to save loading messages.');

      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save loading messages.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Loading Messages</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Custom messages shown during app load and actions. Enter up to 10 messages; they'll be rotated randomly.</p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-green-50 text-green-600 border border-green-200 dark:bg-green-950/80 dark:text-green-400 dark:border-green-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Changes saved!</span>
          </div>
        )}

        {loadingMessages.map((msg) => (
          <div key={msg.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
            <div className="flex items-center gap-3 min-w-[240px]">
              <input
                type="text"
                placeholder={`${msg.label}...`}
                value={msg.value}
                // Matched by the message's own id, never by position: the previous version compared the map
                // index (a number) against the tail of the id (a string), which is never true, so the field
                // could be focused and typed into but the value never changed.
                onChange={(e) => setLoadingMessages((current) => updateLoadingMessages(current, msg.id, e.target.value))}
                className="flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>
        ))}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Loading Messages'}
          </button>
        </div>
      </form>

    </div>
  );
}


