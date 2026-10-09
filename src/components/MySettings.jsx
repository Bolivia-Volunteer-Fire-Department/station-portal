import React, { useState, useEffect } from 'react';
import { Clock, Save, CheckCircle, AlertCircle, Loader2, KeyRound, Bell, Smartphone, ShieldCheck, Camera, Trash2 } from 'lucide-react';
import ToggleSwitch from './ToggleSwitch';
import PasswordInput from './PasswordInput';
import { soundsActiveFrom } from '../utils/uiSounds';
import { visibleNotificationTypes } from '../utils/notificationPrefs';
import { rolePermissionAudit, roleColumnValue, ADMIN_PERMISSIONS } from '../utils/permissions';
import {
  pushSupported,
  notificationPermission,
  parseWebConfig,
  vapidKeyFrom,
  enablePushNotifications,
  disablePushNotifications,
  currentDeviceToken,
  deviceLabelFromUserAgent,
} from '../utils/pushNotifications';
import { saveMemberPrivateFields, saveMemberAvatarUrl } from '../services/api';
import { uploadAvatar, removeAvatar, storageConfigured } from '../services/avatarStorage';
import { AVATAR_ACCEPT } from '../utils/avatars';
import { MEMBER_PRIVATE_FIELDS } from '../utils/memberFields';

function isTruthySetting(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

const FONT_SCALES = [0.9, 1, 1.1, 1.2];
const fontScaleValue = (value) => {
  const scale = Number(value);
  return FONT_SCALES.includes(scale) ? scale : 1;
};

export default function UserSettings({
  currentUser,
  userSettings = [],
  systemSettings = {},
  // The signed-in member's own role row, for the read-only access summary below.
  currentRole,
  canApproveShifts = false,
  // Whether this member's role grants Chat. The chat notification switches are hidden without it - see utils/notificationPrefs.js.
  canUseChat = false,
  onSaveSettings,
  onFontScalePreview,
  onPasswordChange,
  pushDeviceApi,
}) {
  // Find current user's existing settings record
  const existingUserSetting = userSettings.find(
    (s) => String(s.id ?? s.user_id) === String(currentUser?.id)
  );

  // Initialize form state using fallback logic: User Setting -> System Setting -> Default
  const [formData, setFormData] = useState({
    time_format: existingUserSetting?.time_format || systemSettings?.time_format || '12',
    is_dark_mode: isTruthySetting(
      existingUserSetting?.is_dark_mode !== undefined && existingUserSetting?.is_dark_mode !== ''
        ? existingUserSetting.is_dark_mode
        : (systemSettings?.is_dark_mode !== undefined ? systemSettings.is_dark_mode : true)
    ),
    hide_events_by_default: isTruthySetting(existingUserSetting?.hide_events_by_default),
    colorblind_rank_labels: isTruthySetting(existingUserSetting?.colorblind_rank_labels),
    font_scale: fontScaleValue(existingUserSetting?.font_scale),
    // Same ladder, resolved by the shared rule rather than re-implemented here: the member's own value, else the
    // station default, else on. A blank cell is "inherit", not "off".
    is_sounds_active: soundsActiveFrom(existingUserSetting?.is_sounds_active, systemSettings?.is_sounds_active),
  });

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Update form if userSettings prop updates from backend
  useEffect(() => {
    setFormData((prev) => ({
      time_format: existingUserSetting?.time_format || prev.time_format,
      is_dark_mode: existingUserSetting?.is_dark_mode !== undefined && existingUserSetting?.is_dark_mode !== ''
        ? isTruthySetting(existingUserSetting.is_dark_mode)
        : prev.is_dark_mode,
      hide_events_by_default:
        existingUserSetting?.hide_events_by_default !== undefined && existingUserSetting?.hide_events_by_default !== ''
          ? isTruthySetting(existingUserSetting.hide_events_by_default)
          : prev.hide_events_by_default,
      colorblind_rank_labels:
        existingUserSetting?.colorblind_rank_labels !== undefined && existingUserSetting?.colorblind_rank_labels !== ''
          ? isTruthySetting(existingUserSetting.colorblind_rank_labels)
          : prev.colorblind_rank_labels,
      font_scale:
        existingUserSetting?.font_scale !== undefined && existingUserSetting?.font_scale !== ''
          ? fontScaleValue(existingUserSetting.font_scale)
          : prev.font_scale,
      // A saved FALSE has to survive this sync, so the cell is checked for emptiness rather than truthiness.
      is_sounds_active:
        existingUserSetting?.is_sounds_active !== undefined && existingUserSetting?.is_sounds_active !== ''
          ? isTruthySetting(existingUserSetting.is_sounds_active)
          : prev.is_sounds_active,
    }));
  }, [existingUserSetting]);

  useEffect(() => () => onFontScalePreview?.(null), [onFontScalePreview]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    const payload = {
      id: currentUser.id,
      time_format: String(formData.time_format),
      is_dark_mode: String(formData.is_dark_mode),
      hide_events_by_default: String(formData.hide_events_by_default),
      colorblind_rank_labels: String(formData.colorblind_rank_labels),
      font_scale: String(formData.font_scale),
      // Always sent, never omitted: an empty string would mean "inherit the station default" on the backend, and
      // this switch is a decision either way. The member's own answer always wins.
      is_sounds_active: String(formData.is_sounds_active),
    };

    try {
      if (onSaveSettings) {
        await onSaveSettings(payload);
      }
      onFontScalePreview?.(null);
      setStatusMessage({ type: 'success', text: 'Settings updated successfully!' });
    } catch (err) {
      console.error('Failed to save user settings:', err);
      setStatusMessage({ type: 'error', text: 'Failed to save settings. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const isSystemDefault = !existingUserSetting?.time_format;
  const systemDefaultValue = systemSettings?.time_format || '12';
  // Mirrors the resolver: an empty cell in the member's own row is what "using the station default" means.
  const isUsingSystemSoundsDefault =
    existingUserSetting?.is_sounds_active === undefined || existingUserSetting?.is_sounds_active === '';
  const systemSoundsDefault = soundsActiveFrom('', systemSettings?.is_sounds_active);

  return (
    <div className="space-y-6">

      {/* THEIR OWN DETAILS COME FIRST. This is the card people open this screen for, and it is the only one here that is
          about the member rather than about the app's behaviour. */}
      <ProfilePictureCard currentUser={currentUser} />

      <PersonalInformationCard currentUser={currentUser} />

      {/* Settings Form */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form id="user-settings-form" onSubmit={handleSubmit} className="p-6 space-y-6">

          {/* Status Feedback Banner */}
          {statusMessage && (
            <div
              className={`p-4 rounded-xl flex items-center gap-3 text-sm font-medium border ${statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/80'
                  : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
                }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle className="w-5 h-5 shrink-0 text-emerald-500 dark:text-emerald-400" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 text-red-500 dark:text-red-400" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Time Format Preference */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Time Display Format
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 12-Hour Option */}
              <label
                className={`flex items-start p-4 rounded-xl border cursor-pointer transition ${String(formData.time_format) === '12'
                    ? 'bg-red-500/10 border-red-500 text-slate-900 dark:text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900/60 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-900'
                  }`}
              >
                <input
                  type="radio"
                  name="time_format"
                  value="12"
                  checked={String(formData.time_format) === '12'}
                  onChange={(e) => setFormData({ ...formData, time_format: e.target.value })}
                  className="sr-only"
                />
                <div>
                  <div className="font-semibold text-sm">12-Hour Clock</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Example: <span className="font-mono text-slate-700 dark:text-slate-200">06:00:00 PM</span>
                  </div>
                </div>
              </label>

              {/* 24-Hour Option */}
              <label
                className={`flex items-start p-4 rounded-xl border cursor-pointer transition ${String(formData.time_format) === '24'
                    ? 'bg-red-500/10 border-red-500 text-slate-900 dark:text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-900/60 dark:border-slate-700/80 dark:text-slate-300 dark:hover:bg-slate-900'
                  }`}
              >
                <input
                  type="radio"
                  name="time_format"
                  value="24"
                  checked={String(formData.time_format) === '24'}
                  onChange={(e) => setFormData({ ...formData, time_format: e.target.value })}
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

            {/* Default Indicator Note */}
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">
              {isSystemDefault ? (
                <span>
                  Currently using station default setting (<strong className="text-slate-700 dark:text-slate-200">{systemDefaultValue}-Hour</strong>).
                </span>
              ) : (
                <span>Overriding station default setting.</span>
              )}
            </p>
          </div>

          {/* Dark Mode Preference */}
          <div className="border-t border-slate-200 dark:border-slate-700/80 pt-4">
            <ToggleSwitch
              label="Dark Mode"
              description="Use the dark station theme for your account."
              enabled={formData.is_dark_mode}
              onChange={(value) => setFormData({ ...formData, is_dark_mode: value })}
            />
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700/80 pt-4">
            <ToggleSwitch
              label="Hide Events by Default"
              description="Start Schedule and Availability views with non-shift events hidden. Use each view's events toggle to show them temporarily."
              enabled={formData.hide_events_by_default}
              onChange={(value) => setFormData({ ...formData, hide_events_by_default: value })}
            />
          </div>

          {/* Sound Effects. The switch that controls sounds is the one switch that has to be audible while
              turning itself on, hence feedbackSound: see the note on ToggleSwitch. */}
          <div className="border-t border-slate-200 dark:border-slate-700/80 pt-4">
            <ToggleSwitch
              label="Sound Effects"
              description={
                isUsingSystemSoundsDefault
                  ? `Clicks, toasts and notifications play sounds. Currently using the station default (${systemSoundsDefault ? 'on' : 'off'}).`
                  : 'Clicks, toasts and notifications play sounds.'
              }
              enabled={formData.is_sounds_active}
              onChange={(value) => setFormData({ ...formData, is_sounds_active: value })}
              feedbackSound="onOff"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-2">
              The Firefighter Runner keeps its own sound effects either way, and alarm sounds from your device are
              not affected.
            </p>
          </div>

        </form>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Accessibility</h2>
        </div>
        <div className="p-6 space-y-5">
          <ToggleSwitch
            label="Colorblind-Friendly Rank Labels"
            description="Show rank initials beside schedule rank markers, so rank is not conveyed by color alone."
            enabled={formData.colorblind_rank_labels}
            onChange={(value) => setFormData({ ...formData, colorblind_rank_labels: value })}
          />

          <div className="border-t border-slate-200 pt-4 dark:border-slate-700/80">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="font-scale" className="text-sm font-medium text-slate-900 dark:text-white">
                Font size
              </label>
              <output htmlFor="font-scale" className="text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                {formData.font_scale}x
              </output>
            </div>
            <input
              id="font-scale"
              type="range"
              min="0"
              max={FONT_SCALES.length - 1}
              step="1"
              value={Math.max(0, FONT_SCALES.indexOf(Number(formData.font_scale)))}
              aria-valuetext={`${formData.font_scale} times`}
              onChange={(event) => {
                const scale = FONT_SCALES[Number(event.target.value)] ?? 1;
                setFormData({ ...formData, font_scale: scale });
                onFontScalePreview?.(scale);
              }}
              className="w-full accent-red-600"
            />
            <div className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
              {FONT_SCALES.map((scale) => <span key={scale}>{scale}x</span>)}
            </div>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Changes preview across the app immediately and are kept when you save.
            </p>
          </div>

          <div className="flex justify-end border-t border-slate-200 pt-4 dark:border-slate-700/80">
            <button
              type="submit"
              form="user-settings-form"
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span>{saving ? 'Saving...' : 'Save Preferences'}</span>
            </button>
          </div>
        </div>
      </div>

      <NotificationsCard
        currentUser={currentUser}
        userSettings={userSettings}
        systemSettings={systemSettings}
        canApproveShifts={canApproveShifts}
        canUseChat={canUseChat}
        onSaveSettings={onSaveSettings}
        pushDeviceApi={pushDeviceApi}
      />

      <PasswordChangeCard onPasswordChange={onPasswordChange} />

      <AccessCard currentRole={currentRole} />
    </div>
  );
}

function PasswordChangeCard({ onPasswordChange }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage(null);

    if (newPassword !== confirmPassword) {
      setStatusMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    if (!newPassword) {
      setStatusMessage({ type: 'error', text: 'Please enter a new password.' });
      return;
    }

    setSaving(true);
    try {
      const result = await onPasswordChange(newPassword);
      if (result?.success) {
        setStatusMessage({ type: 'success', text: 'Password updated successfully!' });
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setStatusMessage({ type: 'error', text: result?.message || 'Failed to update password.' });
      }
    } catch (err) {
      console.error('Failed to update password:', err);
      setStatusMessage({ type: 'error', text: 'Failed to update password. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Change Password</h3>
        </div>

        {statusMessage && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium border ${statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/80'
                : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
              }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">New Password</label>
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Confirm Password</label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Updating...</span>
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                <span>Update Password</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

// Notification switches a member can see and toggle. The list and the visibility
// rule live in utils/notificationPrefs.js (dependency-free, so they are testable
// without React); "New shift requests" is only offered to roles that can approve
// shifts, since it is about offers waiting on an approval.

function NotificationsCard({
  currentUser,
  userSettings = [],
  systemSettings = {},
  canApproveShifts = false,
  canUseChat = false,
  onSaveSettings,
  pushDeviceApi,
}) {
  const existingUserSetting = userSettings.find(
    (s) => String(s.id ?? s.user_id) === String(currentUser?.id)
  );

  const webConfig = parseWebConfig(systemSettings);
  const vapidKey = vapidKeyFrom(systemSettings);
  const fcmConfigured = !!webConfig && !!vapidKey;

  // Whether THIS device is enabled, and on how many devices the member is enabled in total.
  //
  // The question the card has to answer is local - a push subscription either exists in this browser
  // or it does not - so it is answered locally. Deriving it from the member's stored token was the
  // bug: a phone that had never been enabled showed "Registered" (and offered "Turn off", which then
  // cleared the computer's token) because the member's computer was registered.
  //
  // `ownerName` is the second half, and it is a separate field because the two come apart on a shared
  // computer: the subscription belongs to the BROWSER, while the row that names it belongs to one
  // member. A subscription that exists is not evidence that it is YOURS - assuming it was is what made
  // signing in on somebody's computer quietly hand it over, so the owner is read from the server.
  const [thisDevice, setThisDevice] = useState({ known: false, enabled: false, token: '', ownerName: '' });
  const [deviceTotal, setDeviceTotal] = useState(0);
  // Set when an administrator has turned this member's notifications off outright. It outranks the local
  // picture: a browser can hold a live subscription and still receive nothing, and a card that showed
  // "on for this device" would be describing the subscription rather than the delivery.
  const [pushBlocked, setPushBlocked] = useState(false);
  const [permission, setPermission] = useState(notificationPermission());
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const supported = pushSupported();

  // Read this device's real state, and make sure the server agrees with it.
  //
  // The self-healing half is a re-registration, and it is deliberately narrow. If this browser holds a
  // subscription the server has no row for (a deploy added the sheet after the device was enabled, or
  // an admin pruned a dead-looking token), the device would otherwise be silent with the card claiming
  // it was on - so it is claimed. If the row exists and says this device belongs to SOMEBODY ELSE,
  // nothing is written at all: that is a transfer, and transfers belong to a button. Registering
  // unconditionally - which this used to do - made opening this page enough to take a shared computer
  // away from the member who set it up.
  useEffect(() => {
    let canceled = false;

    const readDevice = async () => {
      if (!supported) {
        if (!canceled) setThisDevice({ known: true, enabled: false, token: '', ownerName: '' });
        return;
      }

      const token = fcmConfigured ? await currentDeviceToken(webConfig, vapidKey) : null;
      if (canceled) return;

      setThisDevice({ known: true, enabled: !!token, token: token || '', ownerName: '' });
      setPermission(notificationPermission());

      if (!pushDeviceApi) return;

      try {
        // One call, two answers: this member's devices, and whose this browser is.
        const status = await pushDeviceApi.status(token || '');
        if (canceled) return;

        const listed = (status?.devices || []).length;
        const owner = status?.device_owner || null;
        const ownerIsSomeoneElse = !!owner && String(owner.user_id) !== String(currentUser?.id);
        // An administrator's switch outranks everything below it: there is no registration to refresh, no
        // device to claim and nothing for the member to press, so the card stops here.
        setPushBlocked(!!status?.push_disabled);
        if (status?.push_disabled) {
          setDeviceTotal(listed);
          return;
        }

        if (ownerIsSomeoneElse && token) {
          // Somebody else's device, and saying so is the whole point: the card must not offer to turn
          // off a device that is not theirs, nor claim the alerts arriving here are theirs.
          setThisDevice({ known: true, enabled: true, token, ownerName: owner.name || 'another member' });
          setDeviceTotal(listed);
          return;
        }

        if (!token) {
          setDeviceTotal(listed);
          return;
        }

        // Either there is no row yet, or it is already this member's and its label and stamp are worth
        // refreshing. Neither touches anybody else.
        const registered = await pushDeviceApi.register(token, deviceLabelFromUserAgent(navigator.userAgent));
        if (canceled) return;
        setDeviceTotal(typeof registered?.devices === 'number' ? registered.devices : listed);
      } catch (err) {
        // Not fatal: the device is still subscribed, it just may not be listed. Enabling again from
        // the button below re-registers it.
        console.warn('[push] could not read this device from the server:', err.message);
      }
    };

    readDevice();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, fcmConfigured, currentUser?.id]);

  const stationDefault = (key) => {
    const value = systemSettings?.[key];
    return value === undefined || value === '' ? true : isTruthySetting(value);
  };

  const userOverride = (key) => existingUserSetting?.[key];

  const isInherited = (key) => {
    const value = userOverride(key);
    return value === undefined || value === null || value === '';
  };

  const effectiveValue = (key) =>
    isInherited(key) ? stationDefault(key) : isTruthySetting(userOverride(key));

  const savePref = async (key, value) => {
    setBusy(true);
    setStatusMessage(null);
    try {
      await onSaveSettings({ id: currentUser.id, [key]: value === undefined ? '' : String(value) });
      setStatusMessage({ type: 'success', text: 'Notification preference saved.' });
    } catch (err) {
      console.error('Failed to save notification preference:', err);
      setStatusMessage({ type: 'error', text: 'Failed to save notification preference.' });
    } finally {
      setBusy(false);
    }
  };

  const handleEnableDevice = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      // Must run from this click so the browser ties the permission prompt to
      // a user gesture.
      const token = await enablePushNotifications(webConfig, vapidKey);
      // It is the DEVICE that gets registered, not the member: enabling this phone must not touch a
      // computer that is already receiving notifications.
      const registered = await pushDeviceApi?.register(token, deviceLabelFromUserAgent(navigator.userAgent));
      setThisDevice({ known: true, enabled: true, token, ownerName: '' });
      setPermission(notificationPermission());

      if (registered && registered.success === false) {
        // An administrator's switch is not a race and not a device problem, so it gets its own answer
        // rather than the borrowed-computer one below.
        if (registered.code === 'PUSH_DISABLED_BY_ADMIN') {
          setPushBlocked(true);
          setThisDevice({ known: true, enabled: true, token, ownerName: '' });
          setStatusMessage({ type: 'error', text: registered.message || 'An administrator has turned notifications off for your account.' });
          return;
        }

        // A brand-new subscription has no row, so this is the narrow race: another member claimed this
        // browser (in another window, or while this page sat open) between the read above and this
        // click. The permission prompt cannot be undone, so the honest move is to show whose the
        // computer is and offer the button that moves it - NOT to unsubscribe, which would break the
        // other member's device behind their back, and not to insist, which is how this started.
        setThisDevice({ known: true, enabled: true, token, ownerName: registered.owner_name || 'another member' });
        const listed = await pushDeviceApi?.status(token);
        if (listed?.success) setDeviceTotal((listed.devices || []).length);
        setStatusMessage({
          type: 'error',
          text: registered.message || 'This device is registered to another member.',
        });
        return;
      }

      if (typeof registered?.devices === 'number') setDeviceTotal(registered.devices);
      setStatusMessage({ type: 'success', text: 'This device will now receive Station Portal notifications.' });
    } catch (err) {
      console.error('Failed to enable notifications:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Could not enable notifications on this device.' });
    } finally {
      setBusy(false);
    }
  };

  // Moves this computer from the member it is registered to onto the signed-in member.
  //
  // Deliberately its own button rather than something that happens during a read. The other member
  // loses a place their alerts were arriving, so it has to be a thing somebody chose, in words that
  // say so - and the server records it in the system log for exactly that reason.
  const handleClaimDevice = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      const token = thisDevice.token || (await currentDeviceToken(webConfig, vapidKey));
      if (!token) throw new Error('This browser has no notification subscription to move.');

      const previousOwner = thisDevice.ownerName;
      const registered = await pushDeviceApi?.register(
        token,
        deviceLabelFromUserAgent(navigator.userAgent),
        { transfer: true }
      );
      if (!registered?.success) {
        throw new Error(registered?.message || 'Could not move this computer onto your account.');
      }

      setThisDevice({ known: true, enabled: true, token, ownerName: '' });
      if (typeof registered.devices === 'number') setDeviceTotal(registered.devices);
      setStatusMessage({
        type: 'success',
        text: previousOwner
          ? `This computer now receives your notifications instead of ${previousOwner}'s.`
          : 'This computer now receives your notifications.',
      });
    } catch (err) {
      console.error('Failed to move this device:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Could not move this computer onto your account.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDisableDevice = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      // Releases this browser's push subscription and reports which token it held, so exactly one
      // device is removed from the list rather than every device the member has.
      const releasedToken = await disablePushNotifications(webConfig);
      let removedOwner = '';
      if (releasedToken) {
        const result = await pushDeviceApi?.unregister(releasedToken);
        removedOwner = result?.removed_owner_name || '';
      }
      setThisDevice({ known: true, enabled: false, token: '', ownerName: '' });
      setPermission(notificationPermission());
      const listed = await pushDeviceApi?.status('');
      if (listed?.success) setDeviceTotal((listed.devices || []).length);
      setStatusMessage({
        type: 'success',
        text: removedOwner
          // Turning the browser's subscription off stops delivery for whoever the row named, so the
          // card says that rather than reporting a tidy "off for this device" over somebody else's.
          ? `Notifications are off for this computer. It was set up for ${removedOwner}, so their alerts stop here too.`
          : 'Notifications turned off for this device. Any other device you have enabled is unaffected.',
      });
    } catch (err) {
      console.error('Failed to disable notifications:', err);
      setStatusMessage({ type: 'error', text: 'Could not turn off notifications for this device.' });
    } finally {
      setBusy(false);
    }
  };

  // How many OTHER devices the member has, so a second device makes sense of what it is looking at:
  // this one may be off while the account is set up elsewhere.
  //
  // A device registered to somebody else is not one of mine, so it does not reduce this count - the
  // sentence is about the member's own devices, and the list it comes from is already theirs.
  const mineHere = thisDevice.enabled && !thisDevice.ownerName;
  const otherDeviceCount = mineHere ? Math.max(0, deviceTotal - 1) : deviceTotal;

  // Surfaced so it is obvious whether the browser grant exists. A member who
  // has already allowed notifications is never prompted again by Chrome, which
  // otherwise looks like the Enable button silently doing nothing.
  const permissionLabel = permission === 'granted'
    ? 'allowed'
    : permission === 'denied'
      ? 'blocked'
      : permission === 'unsupported'
        ? 'not supported'
        : 'not requested yet';
  const permissionClass = permission === 'granted'
    ? 'text-emerald-600 dark:text-emerald-400'
    : permission === 'denied'
      ? 'text-red-600 dark:text-red-400'
      : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Notifications</h3>
        </div>

        {statusMessage && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium border ${statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/80'
                : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
              }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500 dark:text-red-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* This device */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-900/60 p-4">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-white">This device</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {!thisDevice.known
                  ? 'Checking this device…'
                  : pushBlocked
                    // Outranks the owner sentence below it: whoever the subscription belongs to, nothing
                    // is being delivered, and that is the whole of what the member needs to know.
                    ? 'An administrator has turned notifications off for your account.'
                    : !thisDevice.enabled
                      ? 'Notifications are not on for this device yet.'
                      : thisDevice.ownerName
                        // The sentence that was missing. A subscription existing here is not the same as
                        // it being the signed-in member's, and a card that cannot tell the two apart
                        // either lies about delivery or offers to break somebody else's device.
                        ? `This computer is set up for ${thisDevice.ownerName}, so ${thisDevice.ownerName === 'another member' ? 'their' : `${thisDevice.ownerName}'s`
                        } alerts appear here.`
                        : 'Notifications are on for this device.'}
              </p>
              {pushBlocked && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Enabling a device will not work until an administrator allows it again. Ask an
                  administrator if you need them back.
                </p>
              )}
              {thisDevice.ownerName && !pushBlocked && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  One computer can only receive one member&rsquo;s notifications at a time. If you take this
                  one over, {thisDevice.ownerName} stops receiving them here &mdash; and the app records
                  that it happened.
                </p>
              )}
              {thisDevice.known && otherDeviceCount > 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {otherDeviceCount === 1
                    ? 'You have 1 other device enabled.'
                    : `You have ${otherDeviceCount} other devices enabled.`}{' '}
                  Each device is set up separately.
                </p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Browser permission: <span className={permissionClass}>{permissionLabel}</span>
              </p>
              {permission === 'denied' && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Notifications are blocked for this site in your browser settings.
                </p>
              )}
              {permission === 'granted' && thisDevice.enabled && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Nothing showing up? Your operating system also has to allow alerts for this
                  browser - on macOS enable &ldquo;Google Chrome Helper&rdquo; under
                  System Settings &gt; Notifications.
                </p>
              )}
              {!supported && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  This browser does not support push notifications.
                </p>
              )}
              {supported && !fcmConfigured && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Push notifications have not been configured by an admin yet.
                </p>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2">
              {thisDevice.ownerName && !pushBlocked && (
                // The one place a device changes hands. It is a button, with the consequence written on
                // it, rather than something a page load does on the member's behalf.
                <button
                  type="button"
                  onClick={handleClaimDevice}
                  disabled={busy}
                  className="flex items-center gap-2 text-xs font-medium bg-red-600 hover:bg-red-500 text-white px-3 py-2 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                  Use this computer for me
                </button>
              )}
              {thisDevice.enabled ? (
                <button
                  type="button"
                  onClick={handleDisableDevice}
                  disabled={busy}
                  className="flex items-center gap-2 text-xs font-medium bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-xl transition disabled:opacity-50"
                >
                  {busy && !thisDevice.ownerName && <Loader2 className="w-3 h-3 animate-spin" />}
                  {thisDevice.ownerName ? 'Turn off here' : 'Turn off'}
                </button>
              ) : pushBlocked ? (
                // No Enable button at all while the account is switched off: it could only fail, and a
                // control that exists to be refused is worse than the explanation above it.
                null
              ) : (
                <button
                  type="button"
                  onClick={handleEnableDevice}
                  disabled={busy || !supported || !fcmConfigured}
                  className="flex items-center gap-2 text-xs font-medium bg-red-600 hover:bg-red-500 text-white px-3 py-2 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                  Enable
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Per-type preferences */}
        <div>
          {visibleNotificationTypes(canApproveShifts, canUseChat).map((type) => (
            <div key={type.key}>
              <ToggleSwitch
                label={type.label}
                description={
                  isInherited(type.key)
                    ? `${type.description} Currently using the station default (${stationDefault(type.key) ? 'On' : 'Off'}).`
                    : type.description
                }
                enabled={effectiveValue(type.key)}
                disabled={busy}
                onChange={(value) => savePref(type.key, value)}
              />
              {!isInherited(type.key) && (
                <button
                  type="button"
                  onClick={() => savePref(type.key, undefined)}
                  disabled={busy}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white mb-2"
                >
                  Reset to station default
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Read-only summary of what the signed-in member's role actually grants, plus any
// problem found in the roles sheet itself.
//
// This exists because a hand-edited sheet fails silently: a permission column that is
// missing or misspelled simply reads as "not granted", so its tab or button never
// appears and nothing explains why. It is also the quickest way to confirm a role is
// set up as intended. Sheet problems are only reported for a role that can reach
// Administration, so a plain member's card stays a short list of what they can do.
function AccessCard({ currentRole }) {
  if (!currentRole) return null;

  const audit = rolePermissionAudit(currentRole);
  const roleName = String(roleColumnValue(currentRole, 'description') ?? '').trim() || 'Your role';
  const isAdministrator = audit.masterState === 'granted';
  const adminGrants = audit.granted.filter((permission) => permission.tab);
  const memberGrants = audit.granted.filter((permission) => !permission.tab);
  const tabCount = ADMIN_PERMISSIONS.length;
  const reachesAdministration = isAdministrator || adminGrants.length > 0;
  // "Off (no is_admin column)" is worth saying out loud: a missing column and a column
  // that says FALSE look identical in the UI but need different fixes.
  const masterLabel = isAdministrator
    ? 'On'
    : audit.masterState === 'no column'
      ? 'Off (no is_admin column)'
      : 'Off';
  // Missing columns only cost a role something when it is trying to reach
  // Administration, so a plain member's card does not list every admin column the sheet
  // has no use for. A typo is always worth reporting.
  const showSheetCheck =
    (reachesAdministration || audit.unknownColumns.length > 0) &&
    (audit.missing.length > 0 || audit.unknownColumns.length > 0);

  // Keep a long list readable: the first few names, then a count.
  const shorten = (labels, limit = 6) =>
    labels.length <= limit
      ? labels.join(', ')
      : `${labels.slice(0, limit).join(', ')} and ${labels.length - limit} more`;

  const chip = (permission) => (
    <span
      key={permission.key}
      className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700"
      title={permission.description}
    >
      {permission.label}
    </span>
  );

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Your Access</h3>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {roleName}. Access comes from your role; an administrator can change it in
          Administration &rarr; People &rarr; Roles.
        </p>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`px-2 py-1 rounded-lg font-medium border ${isAdministrator
                ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700'
              }`}
          >
            Administrator access: {masterLabel}
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {audit.allowedTabs.length} of {tabCount} Administration tabs
          </span>
        </div>

        {isAdministrator && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Administrator access grants every permission, so no other roles column needs setting.
          </p>
        )}
        {!isAdministrator && (
          <div>
            {adminGrants.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">Administration</p>
                <div className="flex flex-wrap gap-1.5">{adminGrants.map(chip)}</div>
              </div>
            )}

            {memberGrants.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">Station modules</p>
                <div className="flex flex-wrap gap-1.5">{memberGrants.map(chip)}</div>
              </div>
            )}

            {audit.granted.length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No permissions are granted, so only the dashboard and My Settings are available.
              </p>
            )}
          </div>
        )}

        {showSheetCheck && (
          <div className="p-3 rounded-xl border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80 space-y-1.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Roles check</span>
            </p>
            {audit.unknownColumns.length > 0 && (
              <p className="text-xs">
                These columns are not recognized, so they do nothing:{' '}
                <span className="font-mono">{shorten(audit.unknownColumns)}</span> — check for a typo.
              </p>
            )}
            {audit.missing.length > 0 && (
              <p className="text-xs">
                The roles sheet has no column for{' '}
                <span className="font-mono">{shorten(audit.missing.map((permission) => permission.key))}</span>. Those
                permissions therefore read as off.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// THE MEMBER'S OWN DETAILS - and this card is FIRST on the page because it is the one people come here to change.
//
// ITS OWN CARD AND ITS OWN SAVE, because these are stored differently from everything else on this screen: the preferences
// go to the member's settings document, these go to the PRIVATE half of their account (see firestore.rules - they are the
// keys a browser may write there, and the member id deliberately is not one of them). Folding them into the settings form
// would save them through a call that cannot reach them, which is exactly the "control that quietly did nothing" this file
// has been bitten by before.
//
// THE NAME IS SHOWN BUT NOT EDITABLE. It is the station's record of who somebody is, and it is changed by an administrator
// in Administration → Members; a member renaming themselves here would be editing the roster by the back door.
//
// MEMBER ID IS ABSENT ON PURPOSE, and the absence is the feature rather than a gap in the layout: the station issues it and
// recycles it when somebody goes inactive, so it is not carried into the member's session at all (firebaseAuth).
//
// It is not shown to other members either: the private half is readable by the member and by officers with the user
// permission, and by nobody else.
// A MEMBER'S OWN PROFILE PICTURE - the only place in the app that sets one. Everywhere else READS the link: the send
// callable stamps `author_avatar_url` onto each message, so a conversation draws faces with no directory lookup at all,
// and the roster carries it for the screens that show a member outside chat.
//
// THE FILE NEVER TOUCHES FIRESTORE. The browser downscales it and hands the bytes to the bucket
// (services/avatarStorage.js), then this card stores the LINK that comes back on the member's roster row - two steps, and
// the order matters, because a failure between them leaves a picture nothing points at, rather than a link pointing at
// nothing.
function ProfilePictureCard({ currentUser }) {
  // THE PICTURE IS HELD HERE AS WELL AS IN THE ROW. The roster listener will carry the new link within a second or two,
  // but a station's connection is not something to make somebody sit and watch: uploading and then seeing no change reads
  // as a failure whether or not it was one.
  const [url, setUrl] = useState(String(currentUser?.avatar_url || ''));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState(null);

  const choose = async (file) => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    setStatusMessage(null);
    try {
      const uploaded = await uploadAvatar({ userId: currentUser?.id, file, onProgress: setProgress });
      const result = await saveMemberAvatarUrl({ url: uploaded.url });
      if (!result?.success) throw new Error(result?.message || 'Could not save your picture.');
      setUrl(uploaded.url);
      setStatusMessage({ type: 'success', text: 'Picture saved.' });
    } catch (failure) {
      setStatusMessage({ type: 'error', text: failure.message || 'Could not upload that picture.' });
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const remove = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      // THE FILE FIRST, THEN THE ROW - the reverse of setting one, and for the same reason: the other order would leave
      // the roster pointing at a picture that no longer exists, which is a broken image beside this member's name in
      // every conversation in the station.
      await removeAvatar(currentUser?.id);
      const result = await saveMemberAvatarUrl({ url: '' });
      if (!result?.success) throw new Error(result?.message || 'Could not remove your picture.');
      setUrl('');
      setStatusMessage({ type: 'success', text: 'Picture removed.' });
    } catch (failure) {
      setStatusMessage({ type: 'error', text: failure.message || 'Could not remove that picture.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Profile Picture</h2>
      </div>
      <div className="space-y-4 p-6">
        {statusMessage && (
          <div
            className={`p-4 rounded-xl flex items-center gap-3 text-sm font-medium border ${statusMessage.type === 'success'
                ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-400 dark:border-emerald-800/80'
                : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
              }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-5 h-5 shrink-0 text-emerald-500 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-red-500 dark:text-red-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {!storageConfigured() ? (
          // A NOTE RATHER THAN A BUTTON THAT WOULD FAIL: an upload needs a bucket, so a station running without one is
          // told so instead of being offered something that breaks at the first byte.
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Picture uploads are not set up for this station yet. Ask an administrator.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              {url ? (
                // The SAME `alt=""` the chat uses, for the same reason: the words beside it already say whose picture
                // this is. `onError` drops it rather than leaving a broken-image glyph on a settings page.
                <img
                  src={url}
                  alt=""
                  aria-hidden="true"
                  onError={() => setUrl('')}
                  className="h-16 w-16 shrink-0 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-600">
                  <Camera className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Shown beside your name in chat. A square picture works best.
                </p>
                {/* WHAT THE PICKER OPENS ON IS PART OF THE LIMIT, not a courtesy: `accept` is a hint the browser honours,
                    so offering "all files" invites a photo this app will refuse after the wait. */}
                <p className="text-xs text-slate-500 dark:text-slate-400">JPEG, PNG or WebP, up to 512 KB.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 ${busy ? 'pointer-events-none opacity-60' : ''
                  }`}
              >
                <Camera className="h-4 w-4" />
                {busy && progress > 0 ? `Uploading ${Math.round(progress * 100)}%` : url ? 'Change picture' : 'Upload picture'}
                <input
                  type="file"
                  className="hidden"
                  accept={AVATAR_ACCEPT}
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    // The input is CLEARED after choosing, so picking the same file twice still fires a change - which
                    // is exactly what somebody does after a failed upload they have since fixed.
                    event.target.value = '';
                    choose(file);
                  }}
                />
              </label>

              {url && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function PersonalInformationCard({ currentUser }) {
  const initialValues = () =>
    Object.fromEntries(MEMBER_PRIVATE_FIELDS.map((key) => [key, currentUser?.[key] || '']));
  const [form, setForm] = useState(initialValues);
  // What the record holds now, so the save below can send only what actually changed.
  const [saved, setSaved] = useState(initialValues);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setStatusMessage(null);
    try {
      // ONLY WHAT CHANGED, so an untouched field is never round-tripped. The row is the session's own because no user id
      // is passed - and the rules would refuse anybody else's anyway.
      const changed = Object.fromEntries(
        MEMBER_PRIVATE_FIELDS.map((key) => [key, String(form[key] ?? '').trim()]).filter(
          ([key, value]) => value !== String(saved[key] ?? '').trim()
        )
      );
      if (!Object.keys(changed).length) {
        setStatusMessage({ type: 'success', text: 'Nothing to change.' });
        return;
      }
      const result = await saveMemberPrivateFields({ fields: changed });
      if (!result?.success) throw new Error(result?.message || 'Could not save your details.');
      setSaved({ ...form });
      setStatusMessage({ type: 'success', text: 'Saved.' });
    } catch (failure) {
      setStatusMessage({ type: 'error', text: failure.message || 'Could not save your details.' });
    } finally {
      setSaving(false);
    }
  };

  const field = (key) => String(form[key] ?? '');
  const setField = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  const FIELD_CLASS =
    'w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
  const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300';

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-700">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Personal Information</h2>
      </div>
      <form onSubmit={save} className="space-y-4 p-6">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Your own details. They are kept on your record, they are not shown to other members, and your email address is
          for the station&rsquo;s records &mdash; signing in still uses your username.
        </p>

        {/* The name, shown rather than offered: it is the station's record of who somebody is. */}
        <div>
          <span className={LABEL_CLASS}>Name</span>
          <p className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
            {currentUser?.name || 'Unnamed member'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Changed by an administrator in Administration &rarr; Members.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className={LABEL_CLASS}>Email Address</span>
            <input
              type="email"
              autoComplete="email"
              maxLength={120}
              value={field('email')}
              onChange={(event) => setField('email')(event.target.value)}
              placeholder="name@example.com"
              className={FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className={LABEL_CLASS}>Phone Number</span>
            <input
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={field('phone')}
              onChange={(event) => setField('phone')(event.target.value)}
              placeholder="e.g. 555-0100"
              className={FIELD_CLASS}
            />
          </label>

          <label className="block">
            <span className={LABEL_CLASS}>FEMA Student ID</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={40}
              value={field('fema_student_id')}
              onChange={(event) => setField('fema_student_id')(event.target.value)}
              placeholder="e.g. 1234567"
              className={FIELD_CLASS}
            />
          </label>
        </div>
        {statusMessage && (
          <p
            className={`text-xs font-medium ${statusMessage.type === 'success'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
              }`}
          >
            {statusMessage.text}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-red-600/20 transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

