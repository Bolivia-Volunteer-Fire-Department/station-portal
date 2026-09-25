import React, { useEffect, useState } from 'react';
import {
  Save, Loader2, Bell, AlertCircle, CheckCircle, KeyRound, Send,
  Smartphone, RefreshCw, Settings2, Info, Lock,
} from 'lucide-react';
import { adminSaveSystemSetting, adminFetchPushStatus, adminSendTestPush, adminFetchFcmStatus } from '../../services/api';
import CenteredContent from '../CenteredContent';
import ToggleSwitch from '../ToggleSwitch';

// Every value on this tab is a `system_settings` row (key/value sheet), the same
// sheet the System Settings tab writes to - notifications just get their own
// curated screen so the FCM wiring isn't buried in the generic key list.
const FCM_KEYS = {
  webConfig: 'fcm_web_config',
  vapidPublicKey: 'fcm_vapid_public_key',
  serviceAccountEmail: 'fcm_service_account_email',
  serviceAccountKey: 'fcm_service_account_private_key',
};

// Notification types a member or admin can switch on/off.
//
// ONE list, from utils/notificationPrefs: the keys are the matching `user_settings` / `system_settings`
// column names, and this tab renders the station-facing wording (stationLabel/stationDescription) while
// User Settings renders the member-facing wording. Keeping the keys in one place is what stops a new
// toggle from existing in one screen and not the other.
import { NOTIFICATION_TYPES } from '../../utils/notificationPrefs';

function settingValue(systemSettings, key, fallback = '') {
  const setting = (systemSettings || []).find((s) => String(s.key) === key);
  return setting?.value ?? fallback;
}

function isTruthySetting(value) {
  if (value === undefined || value === null || value === '') return true; // default on
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

export default function AdminNotificationsTab({ token, systemSettings, isAdmin = false, onDataChanged }) {
  const [status, setStatus] = useState(null);

  // Credential *presence* comes from an authenticated admin action. The public
  // initial payload no longer carries the service-account fields, so it cannot
  // be used to decide whether setup is complete. The action is administrator-only,
  // so it is not even called for anyone else.
  const refreshStatus = async () => {
    if (!token || !isAdmin) return;
    try {
      const result = await adminFetchFcmStatus(token);
      if (result?.success) setStatus(result);
    } catch (err) {
      console.warn('Could not load FCM status:', err);
    }
  };

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  const fcmConfigured = !!status?.ready;

  const handleConfigSaved = async () => {
    void onDataChanged();
    await refreshStatus();
  };

  // Capped and centred: a stack of configuration and status cards rather than a table, so full width on a
  // wide monitor would leave labels and their controls far apart. See utils/contentWidth.
  return (
    <CenteredContent className="space-y-6">
      {isAdmin ? (
        <FcmConfigCard
          token={token}
          systemSettings={systemSettings}
          status={status}
          onSaved={handleConfigSaved}
        />
      ) : (
        // Visible but inert for a role that manages notification settings without
        // being an administrator: the credentials themselves stay admin-only, and
        // the backend refuses these actions regardless of what the UI shows.
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden opacity-60">
          <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Lock className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              Firebase (FCM) credentials
            </h3>
          </div>
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">
            Administrator access is required to view or change the Firebase project configuration.
            The station defaults below are yours to manage.
          </p>
        </div>
      )}
      <StationDefaultsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <DeliveryStatusCard token={token} fcmConfigured={fcmConfigured} />
    </CenteredContent>
  );
}

function FcmConfigCard({ token, systemSettings, status, onSaved }) {
  // Public values are prefilled from system_settings. The service-account email
  // comes from the admin status action, and the private key is never sent to a
  // client at all - it is write-only, so the field starts empty and staying
  // empty means "keep whatever is already stored".
  const [form, setForm] = useState({
    webConfig: settingValue(systemSettings, FCM_KEYS.webConfig),
    vapidPublicKey: settingValue(systemSettings, FCM_KEYS.vapidPublicKey),
    serviceAccountEmail: status?.service_account_email || '',
    serviceAccountKey: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      webConfig: settingValue(systemSettings, FCM_KEYS.webConfig),
      vapidPublicKey: settingValue(systemSettings, FCM_KEYS.vapidPublicKey),
      // Don't clobber what the admin is currently typing.
      serviceAccountEmail: prev.serviceAccountEmail || status?.service_account_email || '',
    }));
  }, [systemSettings, status]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // The web config has to be parseable JSON, otherwise the browser can't
      // initialise Firebase and members will see "not configured yet".
      const rawConfig = String(form.webConfig || '').trim();
      if (rawConfig) {
        try {
          JSON.parse(rawConfig);
        } catch {
          throw new Error('Firebase web config must be valid JSON.');
        }
      }

      const entries = [
        [FCM_KEYS.webConfig, rawConfig],
        [FCM_KEYS.vapidPublicKey, String(form.vapidPublicKey || '').trim()],
      ];

      // Blank credential fields mean "leave the stored value alone", so an admin
      // can correct the web config without having to re-paste the private key
      // (which they can never read back).
      const email = String(form.serviceAccountEmail || '').trim();
      if (email) entries.push([FCM_KEYS.serviceAccountEmail, email]);

      const privateKey = String(form.serviceAccountKey || '').trim();
      if (privateKey) entries.push([FCM_KEYS.serviceAccountKey, privateKey]);

      for (const [key, value] of entries) {
        const result = await adminSaveSystemSetting(key, value, token);
        if (!result?.success) throw new Error(result?.message || `Failed to save ${key}.`);
      }

      // Clear the write-only field so it never lingers in component state.
      setForm((prev) => ({ ...prev, serviceAccountKey: '' }));
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save Firebase configuration.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border ${status?.ready
            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500'
            : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-red-500'}`}>
            <Settings2 className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Firebase Cloud Messaging</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Credentials used to deliver push notifications, stored in the system_settings sheet.
            </p>
          </div>
        </div>

        {!status?.ready && (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 flex items-start gap-3">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-medium">Setup still needed</p>
              <p>
                Create a Firebase project, enable Cloud Messaging, then paste the four values below. The
                full walkthrough is in <span className="font-mono text-xs">docs/FCM_SETUP.md</span>.
              </p>
            </div>
          </div>
        )}

        {status?.ready && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>Firebase Cloud Messaging is configured. Members can enable notifications on their devices.</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Firebase web config (JSON)
            </label>
            <textarea
              rows={5}
              value={form.webConfig}
              onChange={(e) => setForm({ ...form, webConfig: e.target.value })}
              placeholder={'{\n  "apiKey": "...",\n  "projectId": "...",\n  "messagingSenderId": "...",\n  "appId": "..."\n}'}
              className="w-full font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Firebase Console &gt; Project settings &gt; Your apps &gt; SDK setup and configuration.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              VAPID public key
            </label>
            <input
              type="text"
              value={form.vapidPublicKey}
              onChange={(e) => setForm({ ...form, vapidPublicKey: e.target.value })}
              placeholder="BEl62iUYgUivxIkv69yViEuiBIa-..."
              className="w-full font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Project settings &gt; Cloud Messaging &gt; Web Push certificates &gt; Key pair.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Service account email
            </label>
            <input
              type="text"
              value={form.serviceAccountEmail}
              onChange={(e) => setForm({ ...form, serviceAccountEmail: e.target.value })}
              placeholder="firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com"
              className="w-full font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Service account private key
            </label>
            <textarea
              rows={4}
              value={form.serviceAccountKey}
              onChange={(e) => setForm({ ...form, serviceAccountKey: e.target.value })}
              placeholder={status?.has_private_key
                ? 'A key is already stored - leave blank to keep it'
                : '-----BEGIN PRIVATE KEY-----   ...   -----END PRIVATE KEY-----'}
              className="w-full font-mono text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-start gap-1">
              <KeyRound className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Write-only: the <span className="font-mono">private_key</span> from the service
                account JSON is stored but never sent back to any browser
                {status?.has_private_key ? ' (one is already saved - type a new one only to replace it)' : ''}.
                For tighter handling, store it in Apps Script Script Properties as
                <span className="font-mono"> FCM_SERVICE_ACCOUNT_PRIVATE_KEY</span> instead; the backend
                prefers that store.
                {status?.credential_source === 'script_properties' && (
                  <> Currently reading credentials from Script Properties.</>
                )}
              </span>
            </p>
          </div>
        </div>

        <div className="flex justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save FCM Configuration
          </button>
        </div>
      </form>
    </div>
  );
}

function StationDefaultsCard({ token, systemSettings, onDataChanged }) {
  const readDefaults = () =>
    NOTIFICATION_TYPES.reduce((acc, type) => {
      acc[type.key] = isTruthySetting(settingValue(systemSettings, type.key, ''));
      return acc;
    }, {});

  const [defaults, setDefaults] = useState(readDefaults);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDefaults(readDefaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemSettings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      for (const type of NOTIFICATION_TYPES) {
        const result = await adminSaveSystemSetting(type.key, String(defaults[type.key]), token);
        if (!result?.success) throw new Error(result?.message || `Failed to save ${type.key}.`);
      }
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save notification defaults.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Station Defaults</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              What every member is notified about unless they change it themselves in User Settings.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          {NOTIFICATION_TYPES.map((type) => (
            <ToggleSwitch
              key={type.key}
              // The station-facing wording, falling back to the member's if none was written.
              label={type.stationLabel || type.label}
              description={type.stationDescription || type.description}
              enabled={defaults[type.key]}
              onChange={(value) => setDefaults({ ...defaults, [type.key]: value })}
            />
          ))}
        </div>

        <div className="flex justify-end items-center gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/80">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Defaults
          </button>
        </div>
      </form>
    </div>
  );
}

function DeliveryStatusCard({ token, fcmConfigured }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sendingTo, setSendingTo] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const loadStatus = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetchPushStatus(token);
      if (response?.success) {
        setStatus(response);
      } else {
        setError(response?.message || 'Could not load notification status.');
      }
    } catch (err) {
      setError(err.message || 'Could not load notification status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleTest = async (userId) => {
    setSendingTo(userId);
    setTestResult(null);
    try {
      const response = await adminSendTestPush(userId, token);
      setTestResult({
        userId,
        ok: !!response?.success,
        message: response?.message || (response?.success ? 'Test notification sent.' : 'Test notification failed.'),
        // `advice` explains how to fix it; `detail` is the raw cause, kept for debugging.
        advice: response?.advice || '',
        detail: response?.detail || '',
      });
    } catch (err) {
      setTestResult({ userId, ok: false, message: err.message || 'Test notification failed.' });
    } finally {
      setSendingTo(null);
    }
  };

  // Blank cells inherit the station default, so they read as "Default".
  const prefLabel = (value) => {
    if (value === undefined || value === null || value === '') return 'Default';
    return isTruthySetting(value) ? 'On' : 'Off';
  };

  const users = Array.isArray(status?.users) ? status.users : [];
  const registeredCount = users.filter((u) => u.device_registered).length;
  // Devices are counted, not members: one member with a phone and a computer is worth two, and the
  // difference is what tells you whether a silent device is a configuration problem or simply a
  // device nobody has set up yet.
  const deviceTotal = users.reduce((sum, user) => sum + (Number(user.device_count) || 0), 0);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-6 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Device Status</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {status
                ? `${registeredCount} of ${users.length} members have notifications enabled, on ${deviceTotal} device${deviceTotal === 1 ? '' : 's'} in total.`
                : 'Which members can receive push notifications right now.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadStatus}
          disabled={loading}
          className="flex items-center gap-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-xl transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="p-6 pb-0 space-y-3">
        {!fcmConfigured && (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 text-sm text-amber-800 dark:text-amber-300">
            Finish the Firebase configuration above before testing delivery.
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {testResult && (
          <div
            className={`p-4 rounded-xl text-sm font-medium border ${
              testResult.ok
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/80'
                : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80'
            }`}
          >
            <div className="flex items-start gap-2">
              {testResult.ok
                ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
              <div className="space-y-1 min-w-0">
                <p>{testResult.message}</p>
                {testResult.advice && (
                  <p className="text-xs font-normal opacity-90">{testResult.advice}</p>
                )}
                {!testResult.ok && testResult.detail && (
                  <p className="text-xs font-normal font-mono opacity-70 break-all">{testResult.detail}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Device</th>
              <th className="px-4 py-3">New requests</th>
              <th className="px-4 py-3">Approved</th>
              <th className="px-4 py-3">Declined</th>
              <th className="px-4 py-3 text-right">Test</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                  {loading ? 'Loading device status...' : 'No members found.'}
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{user.name || user.id}</td>
                  <td className="px-4 py-3">
                    <span className={user.device_registered
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-400 dark:text-slate-500'}>
                      {/* A count, not a tick: a member with a phone and a computer has two, and knowing
                          how many is how you tell "one device is silent" from "no device at all". */}
                      {user.device_registered
                        ? `${Number(user.device_count) || 1} device${(Number(user.device_count) || 1) === 1 ? '' : 's'}`
                        : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{prefLabel(user.notify_new_offer)}</td>
                  <td className="px-4 py-3">{prefLabel(user.notify_offer_approved)}</td>
                  <td className="px-4 py-3">{prefLabel(user.notify_offer_declined)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleTest(user.id)}
                      disabled={!user.device_registered || sendingTo === user.id}
                      title={user.device_registered ? 'Send a test notification' : 'No registered device'}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sendingTo === user.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Send
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
