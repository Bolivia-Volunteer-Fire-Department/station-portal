import React, { useEffect, useState, useRef } from 'react';
import { Save, Loader2, Pencil, PenLine, Trash2, Plus, AlertCircle, X, Monitor, Settings2, Building2, MapPin, Map as MapIcon, TimerOff, Volume2, CalendarDays, MessageSquare, Upload, Download, Sparkles, RotateCcw, FileArchive, Shield, Check, Smartphone, Compass, Database, ShieldCheck, Archive, Clock, RotateCw, CheckCircle2, AlertTriangle, Mail } from 'lucide-react';
import { stationLogoUrl } from '../../utils/assets';
import { processUploadedLogo, generatePwaAssets, createZipArchive, downloadBlob } from '../../utils/pwaIcons';
import { adminSaveSystemSetting, adminSaveSystemSettings, isUnknownAction, adminDeleteSystemSetting, adminTriggerDatabaseBackup, adminReadPrivateSettings } from '../../services/api';
import { SIDEBAR_NAV_ORDER_KEY, SIDEBAR_NAV_ICONS_KEY } from '../../utils/sidebarNav';
import { clockLocationConfig } from '../../utils/clockLocation';
import { CLOCK_ROUNDING_KEY, CLOCK_ROUNDING_OPTIONS, clockRoundingMinutes } from '../../utils/clockRounding';
import { sessionTimeoutConfig } from '../../utils/sessionTimeout';
import {
  DEFAULT_PAY_WEEK_START,
  PAY_PERIOD_DAYS_KEY,
  PAY_WEEK_START_KEY,
  PAY_WEEKDAYS,
  payPeriodConfig,
} from '../../utils/payPeriod';
import { getCurrentCoordinates } from '../../utils/geolocation';
import PasswordInput from '../PasswordInput';
import {
  getSettingValue,
  getLoadingMessages,
  loadingMessageSavePlan,
  updateLoadingMessages,
  LOADING_MESSAGE_KEYS,
  // Phrases shown during the mini-game boss level.
  getBossSayings,
  updateBossSayings,
  bossSayingSavePlan,
  BOSS_SAYING_KEYS,
  FORGOT_PASSWORD_ENABLED_KEY,
} from '../../utils/systemSettings';
import {
  MOBILE_NAV_MODULES_KEY,
  AVAILABLE_MOBILE_NAV_MODULES,
  parseMobileNavModules,
  formatMobileNavModules,
} from '../../utils/mobileNav';
import { getBackupConfig, formatBackupDate, backupStatusDetails } from '../../utils/databaseBackup';
import { PASSWORD_MIN_STRENGTH_KEY, PASSWORD_STRENGTH_LEVELS, getRequiredPasswordStrength } from '../../utils/passwordCrackTime';
import ToggleSwitch from '../ToggleSwitch';
import CenteredContent from '../CenteredContent';
import ConfirmModal from '../ConfirmModal';

// Settings that have their own dedicated card in the settings page.
const KNOWN_KEYS = [
  'department_name',
  'department_logo_url',
  'time_format',
  'is_dark_mode',
  'is_sounds_active',
  'required_clock_latitude',
  'required_clock_longitude',
  'gps_margin_of_error',
  CLOCK_ROUNDING_KEY,
  'session_timeout',
  PASSWORD_MIN_STRENGTH_KEY,
  'training_signature_window_days',
  'members_must_sign_trainings',
  'training_categories',
  PAY_PERIOD_DAYS_KEY,
  PAY_WEEK_START_KEY,
  ...LOADING_MESSAGE_KEYS,
  ...BOSS_SAYING_KEYS,
  MOBILE_NAV_MODULES_KEY,
  SIDEBAR_NAV_ORDER_KEY,
  SIDEBAR_NAV_ICONS_KEY,
  'backup_last_run_at',
  'backup_last_status',
  'backup_last_message',
  'backup_bucket_name',
  'backup_pitr_status',
  'backup_retention_days',
  FORGOT_PASSWORD_ENABLED_KEY,
  'email_sender',
  'resend_api_key',
];

function isTruthySetting(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

function MapSettingsPointer({ onOpenMapSettings }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
      <MapIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      <span className="font-medium text-slate-900 dark:text-white">The district map has its own screen.</span>
      {typeof onOpenMapSettings === 'function' ? (
        <button
          type="button"
          onClick={onOpenMapSettings}
          className="font-medium text-red-600 underline underline-offset-2 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
        >
          Open Map Settings
        </button>
      ) : (
        <span className="font-medium">Map Settings</span>
      )}
      <span>for the boundary, the roads and waterways, and the uploaded drawing.</span>
    </div>
  );
}

export default function AdminSystemSettingsTab({ token, systemSettings, onDataChanged, onOpenMapSettings, onOpenNavigationSetup }) {
  // Capped and centerd: this is a stack of setting cards rather than a table, so full width on a wide
  // monitor would leave the labels and their controls far apart. See utils/contentWidth.
  return (
    <CenteredContent className="space-y-6">
      <GeneralSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <DatabaseBackupCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      {/* <MapSettingsPointer onOpenMapSettings={onOpenMapSettings} /> */}
      <DisplaySettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <SoundSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <SessionTimeoutCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <PasswordStrengthPolicyCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <EmailSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <PayPeriodCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <ClockSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <LoadingMessagesCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      <BossSayingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} />
      {/* <CustomSettingsCard token={token} systemSettings={systemSettings} onDataChanged={onDataChanged} /> */}
    </CenteredContent>
  );
}

function GeneralSettingsCard({ token, systemSettings, onDataChanged }) {
  const [departmentName, setDepartmentName] = useState(getSettingValue(systemSettings, 'department_name', ''));
  const [logoUrl, setLogoUrl] = useState(getSettingValue(systemSettings, 'department_logo_url', ''));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);

  // PWA Generation state
  const [isGeneratingPwa, setIsGeneratingPwa] = useState(false);
  const [generatedPwaFiles, setGeneratedPwaFiles] = useState(null);
  const [pwaSuccess, setPwaSuccess] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    setDepartmentName(getSettingValue(systemSettings, 'department_name', ''));
    setLogoUrl(getSettingValue(systemSettings, 'department_logo_url', ''));
  }, [systemSettings]);

  const activeLogo = logoUrl || stationLogoUrl();
  const isCustomLogo = Boolean(logoUrl && logoUrl.trim());

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingLogo(true);
    setError(null);
    try {
      const dataUrl = await processUploadedLogo(file);
      setLogoUrl(dataUrl);
      setGeneratedPwaFiles(null);
      setPwaSuccess(false);
    } catch (err) {
      setError(err?.message || 'Failed to process logo file.');
    } finally {
      setIsProcessingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResetLogo = () => {
    setLogoUrl('');
    setGeneratedPwaFiles(null);
    setPwaSuccess(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSettings(
        [
          { key: 'department_name', value: departmentName },
          { key: 'department_logo_url', value: logoUrl },
        ],
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Failed to save general settings.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save general settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleGeneratePwa = async () => {
    setIsGeneratingPwa(true);
    setError(null);
    try {
      const files = await generatePwaAssets(activeLogo, { departmentName });
      setGeneratedPwaFiles(files);
      setPwaSuccess(true);
    } catch (err) {
      setError(err?.message || 'Failed to generate PWA assets from this logo.');
    } finally {
      setIsGeneratingPwa(false);
    }
  };

  const handleDownloadZip = () => {
    if (!generatedPwaFiles) return;
    try {
      const zipBlob = createZipArchive(generatedPwaFiles);
      const safeName = (departmentName || 'station').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      downloadBlob(zipBlob, `${safeName}-pwa-icons.zip`);
    } catch (err) {
      setError(err?.message || 'Failed to create ZIP archive.');
    }
  };

  const handleDownloadSingle = (file) => {
    const blob = file.name.endsWith('.webmanifest')
      ? new Blob([file.data], { type: 'application/manifest+json' })
      : new Blob([file.data], { type: 'image/png' });
    downloadBlob(blob, file.name.split('/').pop());
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">General Settings & Branding</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Department identity, emblem, and app branding used across the station.</p>
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
            placeholder="e.g. Bolivia Volunteer Fire Department"
            value={departmentName}
            onChange={(e) => setDepartmentName(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">Shown on the login screen, schedule printouts, and browser tab titles.</p>
        </div>

        {/* Department Logo Upload */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white">Department Emblem / Shield</label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Replaces the shield patch on the login screen, timeclock header, and printable sheets.
              </p>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
              isCustomLogo
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700'
            }`}>
              {isCustomLogo ? <Check className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
              {isCustomLogo ? 'Custom Logo Active' : 'Default Shield Active'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60">
            <div className="w-20 h-20 shrink-0 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center overflow-hidden">
              <img
                src={activeLogo}
                alt="Department Logo Preview"
                className="max-w-full max-h-full object-contain"
              />
            </div>

            <div className="flex-1 space-y-2 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isProcessingLogo}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm disabled:opacity-50"
                >
                  {isProcessingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {isCustomLogo ? 'Upload New Emblem' : 'Upload Department Emblem'}
                </button>

                {isCustomLogo && (
                  <button
                    type="button"
                    onClick={handleResetLogo}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 border border-transparent hover:border-red-200 dark:hover:border-red-800 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset to Default Shield
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Recommended: Square PNG with transparency, WebP, or SVG. Auto-scaled for crisp rendering across retina and mobile screens.
              </p>
            </div>
          </div>
        </div>

        {/* PWA Icon Pack Auto-Generator */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">PWA & App Icon Generator</h4>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/80 dark:text-red-300">
                  Auto-Gen
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Generates responsive favicons, Apple touch icons, Android home screen badges, and web app manifest from your logo.
              </p>
            </div>

            <button
              type="button"
              disabled={isGeneratingPwa}
              onClick={handleGeneratePwa}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 transition disabled:opacity-50"
            >
              {isGeneratingPwa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-500" />}
              Generate Icons
            </button>
          </div>

          {generatedPwaFiles && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 space-y-4 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    Generated {generatedPwaFiles.length - 1} icon formats + Web App Manifest
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition shadow-sm"
                >
                  <FileArchive className="w-3.5 h-3.5" />
                  Download PWA Icon Pack (.zip)
                </button>
              </div>

              {/* Icon thumbnails grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                {generatedPwaFiles.filter((f) => f.dataUrl).map((f) => (
                  <div
                    key={f.name}
                    className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-between gap-1.5 text-center group"
                  >
                    <div className="w-12 h-12 flex items-center justify-center p-1 rounded bg-slate-100 dark:bg-slate-900/80">
                      <img src={f.dataUrl} alt={f.label} className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="w-full">
                      <div className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 truncate">{f.label}</div>
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(f)}
                        className="mt-1 w-full text-[10px] text-slate-500 hover:text-red-500 flex items-center justify-center gap-0.5 py-0.5"
                      >
                        <Download className="w-2.5 h-2.5" /> Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-700/80 mt-2">
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

function DatabaseBackupCard({ token, systemSettings, onDataChanged }) {
  const config = getBackupConfig(systemSettings);
  const statusInfo = backupStatusDetails(config.status);
  const [runningBackup, setRunningBackup] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleRunBackup = async () => {
    setRunningBackup(true);
    setFeedback(null);
    try {
      const response = await adminTriggerDatabaseBackup(token);
      if (response && response.success === false) {
        setFeedback({ type: 'error', message: response.error || 'Backup attempt reported an error.' });
      } else {
        setFeedback({
          type: 'success',
          message: response?.message || 'Database snapshot successfully initiated and archived.',
        });
        if (typeof onDataChanged === 'function') {
          onDataChanged();
        }
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to trigger database backup.' });
    } finally {
      setRunningBackup(false);
    }
  };

  const badgeStyles = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    warning: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    danger: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  }[statusInfo.variant] || 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Database Backup & Recovery
              </h2>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeStyles}`}>
                {config.status === 'running' || runningBackup ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : config.status === 'success' ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {runningBackup ? 'Running Backup...' : statusInfo.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Protection against accidental deletions and data loss with continuous rollbacks and daily cold-storage snapshots.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRunBackup}
          disabled={runningBackup || config.status === 'running'}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
          {runningBackup || config.status === 'running' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Backing up…</span>
            </>
          ) : (
            <>
              <RotateCw className="h-4 w-4" />
              <span>Back Up Now</span>
            </>
          )}
        </button>
      </div>

      {feedback && (
        <div
          className={`mt-4 rounded-xl border p-3 text-sm ${
            feedback.type === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Pillar 1: Point-In-Time Recovery */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800/80 dark:bg-slate-800/40">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold">Continuous 7-Day Recovery (PITR)</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Firestore keeps a continuous change log. If someone accidentally deletes or changes important records,
            an administrator can rewind the database back to any exact minute in the past 7 days.
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Continuous protection active</span>
          </div>
        </div>

        {/* Pillar 2: Cold Storage Daily Snapshots */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800/80 dark:bg-slate-800/40">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white">
            <Archive className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold">Automated Cold Storage Snapshots</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            A full database export runs automatically every night at 2:00 AM and is stored in Google Cloud Coldline/Archive storage for long-term safety.
          </p>
          <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-300">Last snapshot: </span>
              <span>{formatBackupDate(config.lastRunAt)}</span>
            </div>
            {config.bucket && (
              <div className="truncate" title={config.bucket}>
                <span className="font-medium text-slate-700 dark:text-slate-300">Storage bucket: </span>
                <span className="font-mono">{config.bucket}</span>
              </div>
            )}
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-300">Retention: </span>
              <span>Retained on cold archive for {config.retentionDays} days</span>
            </div>
          </div>
        </div>
      </div>

      {config.message && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
          <span className="font-medium text-slate-700 dark:text-slate-200">Latest activity: </span>
          <span>{config.message}</span>
        </div>
      )}
    </div>
  );
}

// Settings card for clock-in rounding rules and GPS geofence boundaries.
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

  // Check if the current inputs form a valid GPS location.
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
      // Save each setting one by one.
      const entries = [
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

        {/* Rounding rule used when calculating work hours */}
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

        {/* Show error message if latitude, longitude, or radius are invalid */}
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

// Signs out users automatically after a period of inactivity.
function SessionTimeoutCard({ token, systemSettings, onDataChanged }) {
  const [minutes, setMinutes] = useState(getSettingValue(systemSettings, 'session_timeout', ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  // Check if the entered minutes are valid before saving.
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
            className="flex items-center gap-2 mr-auto text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 transition disabled:opacity-50"
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

// Enforces minimum password strength based on 2026 brute-force benchmark.
function PasswordStrengthPolicyCard({ token, systemSettings, onDataChanged }) {
  const currentSetting = getRequiredPasswordStrength(systemSettings);
  const [selectedLevel, setSelectedLevel] = useState(currentSetting.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSelectedLevel(getRequiredPasswordStrength(systemSettings).id);
  }, [systemSettings]);

  const activePolicy = PASSWORD_STRENGTH_LEVELS.find((l) => l.id === selectedLevel) || PASSWORD_STRENGTH_LEVELS[0];

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting(PASSWORD_MIN_STRENGTH_KEY, selectedLevel, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save password strength requirement.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save password strength requirement.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Password Strength Policy</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Enforce a minimum password complexity based on 2026 brute-force crack time benchmarks.
            </p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              activePolicy.minTier > 0
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {activePolicy.minTier > 0 ? `Enforcing (${activePolicy.label})` : 'Not enforced'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saved && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/80">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Password strength requirement saved successfully.</span>
          </div>
        )}

        <div className="space-y-2 pt-1">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Minimum Required Strength
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {PASSWORD_STRENGTH_LEVELS.map((lvl) => {
              const isSelected = selectedLevel === lvl.id;
              return (
                <label
                  key={lvl.id}
                  className={`flex flex-col p-3 rounded-xl border cursor-pointer transition text-left ${
                    isSelected
                      ? 'border-red-500 bg-red-50/50 dark:bg-red-950/30 dark:border-red-500 ring-1 ring-red-500'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {lvl.label}
                    </span>
                    <input
                      type="radio"
                      name="password_min_strength"
                      value={lvl.id}
                      checked={isSelected}
                      onChange={() => {
                        setSelectedLevel(lvl.id);
                        setSaved(false);
                      }}
                      className="w-4 h-4 accent-red-600"
                    />
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {lvl.description}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setSelectedLevel('none');
              setSaved(false);
            }}
            disabled={saving || selectedLevel === 'none'}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 transition disabled:opacity-50"
          >
            Clear (none)
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Password Policy
          </button>
        </div>
      </form>
    </div>
  );
}

// Configures transactional email delivery for password resets and system notifications via Resend.
function EmailSettingsCard({ token, systemSettings, onDataChanged }) {
  const [savedKey, setSavedKey] = useState('');
  const [sender, setSender] = useState('');
  const [enabled, setEnabled] = useState(isTruthySetting(getSettingValue(systemSettings, 'forgot_password_enabled', 'true')));

  // Obfuscated key handling
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [loadingPrivate, setLoadingPrivate] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEnabled(isTruthySetting(getSettingValue(systemSettings, 'forgot_password_enabled', 'true')));
  }, [systemSettings]);

  useEffect(() => {
    let active = true;
    setLoadingPrivate(true);
    adminReadPrivateSettings(token)
      .then((res) => {
        if (!active) return;
        if (res?.success) {
          const key = String(res.resend_api_key || '').trim();
          const from = String(res.email_sender || '').trim();
          setSavedKey(key);
          if (from) {
            setSender(from);
          } else {
            setSender(getSettingValue(systemSettings, 'email_sender', ''));
          }
        }
      })
      .catch((err) => {
        console.warn('[email-settings] Failed to load private settings:', err);
      })
      .finally(() => {
        if (active) setLoadingPrivate(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const hasExistingKey = Boolean(String(savedKey || '').trim());

  const getMaskedKey = () => {
    const key = String(savedKey || '').trim();
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 3)}••••••••••••••••••••${key.slice(-4)}`;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updates = [
        { key: 'email_sender', value: String(sender || '').trim() },
        { key: 'forgot_password_enabled', value: enabled ? 'true' : 'false' },
      ];

      if (newApiKey === '__REMOVE__') {
        updates.push({ key: 'resend_api_key', value: '' });
      } else if (newApiKey.trim()) {
        updates.push({ key: 'resend_api_key', value: newApiKey.trim() });
      }

      const result = await adminSaveSystemSettings(updates, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save email settings.');
      
      if (newApiKey === '__REMOVE__') {
        setSavedKey('');
      } else if (newApiKey.trim()) {
        setSavedKey(newApiKey.trim());
      }
      setSaved(true);
      setIsEditingKey(false);
      setNewApiKey('');
      void onDataChanged();
    } catch (err) {
      setError(err?.message || 'Failed to save email settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
          <Mail className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Email & Password Reset</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure self-service password reset options and transactional email delivery via Resend.
          </p>
        </div>
        <span
          className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            loadingPrivate
              ? 'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400'
              : hasExistingKey
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-400'
          }`}
        >
          {loadingPrivate ? 'Checking...' : hasExistingKey ? 'Key Configured' : 'No API Key'}
        </span>
      </div>

      {error && (
        <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saved && (
        <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/80">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Email & password reset settings saved successfully.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Enable / Disable Feature Toggle */}
        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="pr-4">
            <span className="text-sm font-semibold text-slate-900 dark:text-white block">
              Enable "Forgot Password" on Login Screen
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              When disabled, the "Forgot password?" link is completely hidden from the login screen and reset requests are refused.
            </span>
          </div>
          <ToggleSwitch
            checked={enabled}
            onChange={(val) => {
              setEnabled(val);
              setSaved(false);
            }}
            disabled={saving}
          />
        </div>

        {/* Resend API Key Field (Obfuscated) */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
            Resend API Key
          </label>

          {loadingPrivate ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-red-500" />
              <span>Checking key configuration...</span>
            </div>
          ) : hasExistingKey && !isEditingKey ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={getMaskedKey()}
                  readOnly
                  disabled
                  className="w-full bg-slate-100 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 font-mono select-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingKey(true);
                    setNewApiKey('');
                    setSaved(false);
                  }}
                  className="shrink-0 px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
                >
                  Change Key
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingKey(true);
                    setNewApiKey('__REMOVE__');
                    setSaved(false);
                  }}
                  className="shrink-0 px-3.5 py-2.5 text-xs font-semibold rounded-xl border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 transition"
                >
                  Remove
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                The saved API key is hidden for security. Click "Change Key" to enter a replacement.
              </p>
            </div>
          ) : newApiKey === '__REMOVE__' ? (
            <div className="flex items-center justify-between p-3.5 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              <span>API Key will be removed when you save settings.</span>
              <button
                type="button"
                onClick={() => {
                  setIsEditingKey(false);
                  setNewApiKey('');
                }}
                className="font-semibold underline hover:no-underline"
              >
                Keep Existing Key
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <PasswordInput
                  placeholder={hasExistingKey ? 'Enter new Resend API key' : 're_...'}
                  value={newApiKey}
                  onChange={(e) => {
                    setNewApiKey(e.target.value);
                    setSaved(false);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                />
                {hasExistingKey && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingKey(false);
                      setNewApiKey('');
                    }}
                    className="shrink-0 px-3.5 py-2.5 text-xs font-medium rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sign up at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="text-red-600 dark:text-red-400 underline">resend.com</a> to create an API key. Free tier includes 3,000 emails/month.
              </p>
            </div>
          )}
        </div>

        {/* Sender Address */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
            Sender Address
          </label>
          <input
            type="text"
            placeholder="StationSync <onboarding@resend.dev>"
            value={sender}
            onChange={(e) => {
              setSender(e.target.value);
              setSaved(false);
            }}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Leave blank to use default <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded">StationSync &lt;onboarding@resend.dev&gt;</code>, or use a custom verified domain address (e.g. <code className="text-xs bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded">StationSync &lt;no-reply@station.boliviavfd.org&gt;</code>).
          </p>
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-end">
          <button
            type="submit"
            disabled={saving || loadingPrivate}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Email Settings
          </button>
        </div>
      </form>
    </div>
  );
}

// Sets the length of a pay period in days and which weekday it begins on.
function PayPeriodCard({ token, systemSettings, onDataChanged }) {
  const [days, setDays] = useState(getSettingValue(systemSettings, PAY_PERIOD_DAYS_KEY, ''));
  const [weekStart, setWeekStart] = useState(
    getSettingValue(systemSettings, PAY_WEEK_START_KEY, '') || DEFAULT_PAY_WEEK_START
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDays(getSettingValue(systemSettings, PAY_PERIOD_DAYS_KEY, ''));
    setWeekStart(getSettingValue(systemSettings, PAY_WEEK_START_KEY, '') || DEFAULT_PAY_WEEK_START);
  }, [systemSettings]);

  // Check if the entered pay period settings are valid.
  const preview = payPeriodConfig([
    { key: PAY_PERIOD_DAYS_KEY, value: days },
    { key: PAY_WEEK_START_KEY, value: weekStart },
  ]);
  const weekdayLabel = (PAY_WEEKDAYS.find((day) => day.value === preview.weekStart) || {}).label || 'Sunday';

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Save both pay period settings together in one request.
      const result = await adminSaveSystemSettings(
        [
          { key: PAY_PERIOD_DAYS_KEY, value: String(days ?? '').trim() },
          { key: PAY_WEEK_START_KEY, value: weekStart },
        ],
        token
      );
      if (!result?.success) throw new Error(result?.message || 'Failed to save the pay period.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save the pay period.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Pay Period</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              How long a period covers, and the day it begins on.
            </p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              preview.invalidDays
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-400'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
            }`}
          >
            {preview.days} day{preview.days === 1 ? '' : 's'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">
          The clock history opens on{' '}
          <strong className="text-slate-700 dark:text-slate-300">
            the last {preview.days} day{preview.days === 1 ? '' : 's'}, including today
          </strong>
          , and <strong className="text-slate-700 dark:text-slate-300">Load older entries</strong> walks back one period at
          a time. That window is the largest read in the app and it grows on its own, so a longer period is paid by every
          officer on every visit — while nothing is hidden by a shorter one, because the table says what it holds.
          {preview.invalidDays ? (
            <>
              {' '}
              <strong className="text-amber-600 dark:text-amber-400">
                &ldquo;{preview.rawDays}&rdquo; cannot be used, so the window is the default of 7 days.
              </strong>{' '}
              Enter a whole number of days — for example{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">
                14
              </code>
              .
            </>
          ) : null}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Days in a pay period
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 7"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setSaved(false);
              }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              First day of the pay week
            </label>
            <select
              value={weekStart}
              onChange={(e) => {
                setWeekStart(e.target.value);
                setSaved(false);
              }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {PAY_WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              A period begins on <strong className="text-slate-700 dark:text-slate-300">{weekdayLabel}</strong> —{' '}
              <strong className="text-slate-700 dark:text-slate-300">Used for all calendars</strong>. The clock window is the number of days beside it, counted back from today.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDays('');
              setWeekStart(DEFAULT_PAY_WEEK_START);
              setSaved(false);
            }}
            className="flex items-center gap-2 mr-auto text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 transition disabled:opacity-50flex items-center gap-2 mr-auto text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 transition disabled:opacity-50"
          >
            Clear (back to 7 days)
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Pay Period
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

        {/* Note that the mini-game has separate sound controls */}
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

  // Ask for confirmation before deleting a setting.
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

      {/* Confirmation dialog before deleting */}
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

// Configures custom phrases for the mini-game boss level.
function BossSayingsCard({ token, systemSettings, onDataChanged }) {
  const [sayings, setSayings] = useState(() => getBossSayings(systemSettings));
  // Update state when settings change.
  const [settingsSeen, setSettingsSeen] = useState(systemSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  if (settingsSeen !== systemSettings) {
    setSettingsSeen(systemSettings);
    setSayings(getBossSayings(systemSettings));
  }

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const plan = bossSayingSavePlan(sayings);
      const result = await adminSaveSystemSettings(
        plan.map(({ key, value }) => ({ key, value })),
        token
      );

      // Fall back to saving each saying one by one if batch save is not supported.
      if (isUnknownAction(result)) {
        console.warn('This deployment has no batch settings action; saving each saying on its own.');
        for (const { key, value, label } of plan) {
          const one = await adminSaveSystemSetting(key, value, token);
          if (!one?.success) throw new Error(one?.message || `Failed to save ${label}.`);
        }
        void onDataChanged();
        setSaved(true);
        return;
      }

      if (!result?.success) throw new Error(result?.message || "Failed to save the chief's sayings.");

      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || "Failed to save the chief's sayings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Boss Sayings</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Up to five things the floating head says between fireballs in the Firefighter Runner. One is picked at
              random and the same line is never said twice in a row. Clear a line to leave it out; clear all five to
              keep him quiet.
            </p>
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

        {sayings.map((saying) => (
          <div key={saying.id}>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              {saying.label}
            </label>
            <input
              type="text"
              maxLength={60}
              placeholder="Leave blank for silence"
              value={saying.value}
              // Update saying by its unique ID.
              onChange={(e) =>
                setSayings((current) => updateBossSayings(current, saying.id, e.target.value))
              }
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        ))}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Sayings'}
          </button>
        </div>
      </form>
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
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Save all loading messages in a single batch request.
      const plan = loadingMessageSavePlan(loadingMessages);
      const result = await adminSaveSystemSettings(
        plan.map(({ key, value }) => ({ key, value })),
        token
      );

      // Fall back to saving one message at a time if batch save is not supported.
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
                // Update the message by its unique ID.
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


