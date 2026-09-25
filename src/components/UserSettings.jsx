import React, { useState, useEffect } from 'react';
import { Clock, Save, CheckCircle, AlertCircle, Loader2, User, KeyRound, Bell, Smartphone, ShieldCheck } from 'lucide-react';
import ToggleSwitch from './ToggleSwitch';
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

function isTruthySetting(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

export default function UserSettings({ 
  currentUser, 
  userSettings = [], 
  systemSettings = {}, 
  // The signed-in member's own role row, for the read-only access summary below.
  currentRole,
  canApproveShifts = false,
  onSaveSettings,
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
    }));
  }, [existingUserSetting]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    const payload = {
      id: currentUser.id,
      time_format: String(formData.time_format),
      is_dark_mode: String(formData.is_dark_mode),
    };

    try {
      if (onSaveSettings) {
        await onSaveSettings(payload);
      }
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

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 shadow-xl flex items-center gap-4">
        <div className="p-3 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
          <User className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">User Preferences</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Customize display preferences for {currentUser?.name || currentUser?.id || 'your account'}
          </p>
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* Status Feedback Banner */}
          {statusMessage && (
            <div
              className={`p-4 rounded-xl flex items-center gap-3 text-sm font-medium border ${
                statusMessage.type === 'success'
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
                className={`flex items-start p-4 rounded-xl border cursor-pointer transition ${
                  String(formData.time_format) === '12'
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
                className={`flex items-start p-4 rounded-xl border cursor-pointer transition ${
                  String(formData.time_format) === '24'
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

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700/80 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Save Preferences</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>

      <NotificationsCard
        currentUser={currentUser}
        userSettings={userSettings}
        systemSettings={systemSettings}
        canApproveShifts={canApproveShifts}
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
            className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium border ${
              statusMessage.type === 'success'
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
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Confirm Password</label>
            <input
              type="password"
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
  const [thisDevice, setThisDevice] = useState({ known: false, enabled: false, token: '' });
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [permission, setPermission] = useState(notificationPermission());
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  const supported = pushSupported();

  // Read this device's real state, and make sure the server agrees with it.
  //
  // The re-registration is the self-healing half: if this browser holds a subscription but the
  // server has no row for it (a deploy added the sheet after the device was enabled, or an admin
  // pruned a dead-looking token), the device would otherwise be silent with the card claiming it
  // was on. Both calls are cheap - the token comes from the SDK's own cache, and no permission
  // prompt is involved once a subscription exists.
  useEffect(() => {
    let cancelled = false;

    const readDevice = async () => {
      if (!supported) {
        if (!cancelled) setThisDevice({ known: true, enabled: false, token: '' });
        return;
      }

      const token = fcmConfigured ? await currentDeviceToken(webConfig, vapidKey) : null;
      if (cancelled) return;

      setThisDevice({ known: true, enabled: !!token, token: token || '' });
      setPermission(notificationPermission());

      if (!token || !pushDeviceApi) return;

      try {
        await pushDeviceApi.register(token, deviceLabelFromUserAgent(navigator.userAgent));
        const result = await pushDeviceApi.list();
        if (!cancelled && result?.success) setDeviceTotal((result.devices || []).length);
      } catch (err) {
        // Not fatal: the device is still subscribed, it just may not be listed. Enabling again from
        // the button below re-registers it.
        console.warn('[push] could not sync this device with the server:', err.message);
      }
    };

    readDevice();
    return () => {
      cancelled = true;
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
      await pushDeviceApi?.register(token, deviceLabelFromUserAgent(navigator.userAgent));
      setThisDevice({ known: true, enabled: true, token });
      setPermission(notificationPermission());
      const listed = await pushDeviceApi?.list();
      if (listed?.success) setDeviceTotal((listed.devices || []).length);
      setStatusMessage({ type: 'success', text: 'This device will now receive Station Portal notifications.' });
    } catch (err) {
      console.error('Failed to enable notifications:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Could not enable notifications on this device.' });
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
      if (releasedToken) await pushDeviceApi?.unregister(releasedToken);
      setThisDevice({ known: true, enabled: false, token: '' });
      setPermission(notificationPermission());
      const listed = await pushDeviceApi?.list();
      if (listed?.success) setDeviceTotal((listed.devices || []).length);
      setStatusMessage({
        type: 'success',
        text: 'Notifications turned off for this device. Any other device you have enabled is unaffected.',
      });
    } catch (err) {
      console.error('Failed to disable notifications:', err);
      setStatusMessage({ type: 'error', text: 'Could not turn off notifications for this device.' });
    } finally {
      setBusy(false);
    }
  };

  // How many other devices the member has, so a second device makes sense of what it is looking at:
  // this one may be off while the account is set up elsewhere.
  const otherDeviceCount = thisDevice.enabled
    ? Math.max(0, deviceTotal - 1)
    : deviceTotal;

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
            className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium border ${
              statusMessage.type === 'success'
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
                  : thisDevice.enabled
                    ? 'Notifications are on for this device.'
                    : "Notifications are not on for this device yet."}
              </p>
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
            <div className="shrink-0">
              {thisDevice.enabled ? (
                <button
                  type="button"
                  onClick={handleDisableDevice}
                  disabled={busy}
                  className="flex items-center gap-2 text-xs font-medium bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-xl transition disabled:opacity-50"
                >
                  {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                  Turn off
                </button>
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
          {visibleNotificationTypes(canApproveShifts).map((type) => (
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
            className={`px-2 py-1 rounded-lg font-medium border ${
              isAdministrator
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
            Administrator access grants every permission, so no other roles-sheet column needs setting.
          </p>
        )}

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
            No permissions are granted, so only the dashboard and User Settings are available.
          </p>
        )}

        {showSheetCheck && (
          <div className="p-3 rounded-xl border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/80 space-y-1.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Roles sheet check</span>
            </p>
            {audit.unknownColumns.length > 0 && (
              <p className="text-xs">
                These columns are not recognised, so they do nothing:{' '}
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

