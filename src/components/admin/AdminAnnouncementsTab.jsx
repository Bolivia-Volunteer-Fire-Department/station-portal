import React, { useCallback, useEffect, useState } from 'react';
import {
  Save, Loader2, Pencil, Trash2, Plus, AlertCircle, X, Megaphone, Send, RefreshCw,
  ChevronDown, ChevronRight, UserRound,
} from 'lucide-react';
import { adminDeleteAnnouncement, adminFetchAnnouncements, adminSaveAnnouncement } from '../../services/api';
import RankIcon, { RANK_ICON_MAP } from '../RankIcon';
import { toDateKey } from '../../utils/scheduleDate';
import {
  ANNOUNCEMENT_ICON_FALLBACK,
  ANNOUNCEMENT_LOCATIONS,
  ANNOUNCEMENT_VARIANT_KEYS,
  announcementAudienceLabel,
  announcementAuthorLabel,
  announcementDateWindow,
  announcementFlag,
  announcementLocations,
  announcementReachesSomeone,
  announcementVariant,
  announcementValidation,
} from '../../utils/announcements';

const EMPTY_FORM = {
  id: '',
  title: '',
  message: '',
  effective_date: '',
  end_date: '',
  is_visible_on_login: false,
  is_visible_on_dashboard: false,
  is_visible_on_sidebar: false,
  role_id: '',
  rank_id: '',
  user_id: '',
  icon: '',
  context_variant: 'info',
  is_send_push_notification: false,
  is_dismissable: false,
};

// Read once per render so every row is judged against the same day.
const todayKey = toDateKey(new Date());

const dateLabel = (key) => {
  if (!key) return '';
  const [year, month, day] = key.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month - 1]} ${day}, ${year}`;
};

export default function AdminAnnouncementsTab({
  token,
  roles = [],
  ranks = [],
  users = [],
  onDataChanged,
}) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  // The administrator's list, fetched from ADMIN_GET_ANNOUNCEMENTS.
  //
  // It cannot come from the prop the app uses for the sidebar and dashboard: that list is filtered by
  // audience (utils/announcements), so an administrator would only ever see the announcements aimed at
  // themselves and could not manage the rest. This action returns every row regardless of targeting.
  //
  // Fetched on mount rather than from the shared refresh wave - this tab is mounted only while it is
  // open, so the request happens when an administrator actually looks at it.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadRows = useCallback(async () => {
    const result = await adminFetchAnnouncements(token);
    if (!result?.success) throw new Error(result?.message || 'Failed to load announcements.');
    return Array.isArray(result.announcements) ? result.announcements : [];
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadRows()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Failed to load announcements.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadRows]);

  // Re-reads the list after a write. The shared onDataChanged covers the member-facing lists, which are
  // audience-filtered, so it cannot refresh this one.
  const reload = async () => {
    try {
      setRows(await loadRows());
      setLoadError(null);
    } catch (err) {
      // The write already succeeded - report only that the list could not be re-read.
      setLoadError(err.message || 'Saved, but the list could not be reloaded.');
    }
  };

  const isEditing = !!formData.id;
  // Collapsed by default to save screen space, matching the Training form. Clicking Edit on a row
  // opens it - otherwise Edit would look like it did nothing - and a successful save closes it again,
  // which doubles as confirmation that the save went through.
  const [formOpen, setFormOpen] = useState(false);
  const resetForm = () => setFormData(EMPTY_FORM);
  const setField = (key, value) => setFormData((previous) => ({ ...previous, [key]: value }));

  // The audience as the shared rule sees it, so the form and the backend agree.
  const audience = { roleId: formData.role_id, rankId: formData.rank_id, userId: formData.user_id };
  const reachesSomeone = announcementReachesSomeone(audience, users);
  const locationsChosen = ANNOUNCEMENT_LOCATIONS.filter((place) => formData[place.key]).length;

  const handleEdit = (announcement) => {
    setError(null);
    // Open the card, or the click would appear to do nothing.
    setFormOpen(true);
    const window = announcementDateWindow(announcement);
    setFormData({
      id: announcement.id,
      // Carried through the form so the backend can refuse a save built on a stale copy.
      row_version: announcement.row_version,
      title: String(announcement.title ?? ''),
      message: String(announcement.message ?? ''),
      effective_date: window.from,
      end_date: window.to,
      is_visible_on_login: announcementFlag(announcement.is_visible_on_login),
      is_visible_on_dashboard: announcementFlag(announcement.is_visible_on_dashboard),
      is_visible_on_sidebar: announcementFlag(announcement.is_visible_on_sidebar),
      role_id: String(announcement.role_id ?? '').trim(),
      rank_id: String(announcement.rank_id ?? '').trim(),
      user_id: String(announcement.user_id ?? '').trim(),
      icon: String(announcement.icon ?? '').trim(),
      context_variant: String(announcement.context_variant ?? '').trim().toLowerCase() || 'info',
      is_send_push_notification: announcementFlag(announcement.is_send_push_notification),
      is_dismissable: announcementFlag(announcement.is_dismissable),
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The same rules the backend enforces, checked here so a bad announcement is caught before a round
      // trip. The audience check needs the directory, which only the client has in this shape.
      const validationError = announcementValidation(formData);
      if (validationError) throw new Error(validationError);
      if (!reachesSomeone) {
        throw new Error('No members match that role, rank and member combination, so nobody would receive this announcement.');
      }
      const result = await adminSaveAnnouncement(formData, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the announcement.');
      // Members' lists first (so a push-disabled member sees it immediately), then this tab's own
      // full list, which the shared refresh deliberately does not cover.
      void onDataChanged?.();
      await reload();
      resetForm();
      setFormOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to save the announcement.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (announcement) => {
    if (!window.confirm(`Delete "${announcement.title}"? This cannot be undone.`)) return;
    setDeletingId(announcement.id);
    setError(null);
    try {
      const result = await adminDeleteAnnouncement(announcement.id, token);
      if (!result?.success) throw new Error(result?.message || 'Failed to delete the announcement.');
      void onDataChanged?.();
      await reload();
      if (String(formData.id) === String(announcement.id)) resetForm();
    } catch (err) {
      setError(err.message || 'Failed to delete the announcement.');
    } finally {
      setDeletingId(null);
    }
  };

  const variantPreview = announcementVariant(formData.context_variant);
  const previewIcon = formData.icon || ANNOUNCEMENT_ICON_FALLBACK;

  const fieldClass =
    'w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500';
  const labelClass = 'block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5';

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        {/* The header is the collapse control. It stays visible when collapsed so "New Announcement"
            is always one click away - and it keeps saying "Edit Announcement #N" while an edit is
            staged, so a collapsed card can't hide work in progress. */}
        <button
          type="button"
          onClick={() => setFormOpen((open) => !open)}
          aria-expanded={formOpen}
          className="w-full flex items-start gap-3 p-6 text-left hover:bg-slate-50 dark:hover:bg-slate-900/40 transition"
        >
          <span className="mt-0.5 text-slate-400 shrink-0">
            {formOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <Megaphone className="w-5 h-5 text-red-500" />
              {isEditing ? `Edit Announcement #${formData.id}` : 'New Announcement'}
            </span>
            <span className="block text-sm text-slate-500 dark:text-slate-400">
              {isEditing
                ? 'Change this announcement. Saving applies it to whoever it targets.'
                : 'Write a message for the crew. Choose where it appears, who receives it, and whether it also sends a push.'}
            </span>
          </span>
        </button>

        {formOpen && (
        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          {/* Cancel lives inside the form rather than the header: the header is a button now, and a
              button inside a button is invalid markup. */}
          {isEditing && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setFormOpen(false);
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
                Cancel edit
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Title</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setField('title', e.target.value)}
                placeholder="e.g. Station drill moved to Saturday"
                className={fieldClass}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Effective Date</label>
                <input
                  type="date"
                  required
                  value={formData.effective_date}
                  onChange={(e) => setField('effective_date', e.target.value)}
                  className={fieldClass}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">First day it shows.</p>
              </div>
              <div>
                <label className={labelClass}>
                  End Date <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setField('end_date', e.target.value)}
                  className={fieldClass}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Blank runs indefinitely.</p>
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Message</label>
            <textarea
              required
              rows={3}
              value={formData.message}
              onChange={(e) => setField('message', e.target.value)}
              placeholder="What members need to know."
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Color</label>
              <select
                value={formData.context_variant}
                onChange={(e) => setField('context_variant', e.target.value)}
                className={fieldClass}
              >
                {ANNOUNCEMENT_VARIANT_KEYS.map((key) => (
                  <option key={key} value={key}>{announcementVariant(key).label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Icon <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={formData.icon}
                  onChange={(e) => setField('icon', e.target.value)}
                  className={fieldClass}
                >
                  <option value="">-- Warning triangle --</option>
                  {Object.keys(RANK_ICON_MAP).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <span className={`p-2 shrink-0 rounded-xl border ${variantPreview.box} ${variantPreview.head}`}>
                  <RankIcon name={previewIcon} className="w-5 h-5" />
                </span>
              </div>
            </div>
          </div>

          {/* Where it shows. At least one is required, which the shared validator enforces. */}
          <div>
            <label className={labelClass}>Show On</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {ANNOUNCEMENT_LOCATIONS.map((place) => (
                <label
                  key={place.key}
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ${
                    formData[place.key]
                      ? 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/40'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData[place.key]}
                    onChange={(e) => setField(place.key, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-slate-700 dark:text-slate-200">{place.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{place.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {locationsChosen === 0 && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                Choose at least one place, or nobody will see it.
              </p>
            )}
          </div>

          {/* Who it reaches. All three blank means everyone. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Role <span className="font-normal text-slate-400">(optional)</span></label>
              <select value={formData.role_id} onChange={(e) => setField('role_id', e.target.value)} className={fieldClass}>
                <option value="">-- All roles --</option>
                {roles.map((role) => (
                  <option key={role.id} value={String(role.id)}>{role.description || `#${role.id}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Rank <span className="font-normal text-slate-400">(optional)</span></label>
              <select value={formData.rank_id} onChange={(e) => setField('rank_id', e.target.value)} className={fieldClass}>
                <option value="">-- All ranks --</option>
                {ranks.map((rank) => (
                  <option key={rank.id} value={String(rank.id)}>{rank.description || `#${rank.id}`}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Member <span className="font-normal text-slate-400">(optional)</span></label>
              <select value={formData.user_id} onChange={(e) => setField('user_id', e.target.value)} className={fieldClass}>
                <option value="">-- All members --</option>
                {users.map((user) => (
                  <option key={user.id} value={String(user.id)}>{user.name || `#${user.id}`}</option>
                ))}
              </select>
            </div>
          </div>

          {!reachesSomeone && (
            <div className="p-3 rounded-xl flex items-start gap-2 text-sm bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800/60">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                No members match that role, rank and member combination, so nobody would receive this
                announcement. The combination reads as &quot;all three must match&quot;, not &quot;any&quot;.
              </span>
            </div>
          )}

          <label className="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_send_push_notification}
              onChange={(e) => setField('is_send_push_notification', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-slate-700 dark:text-slate-200">Also send a push notification</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Delivered to the registered devices of everyone who matches, in addition to showing in the app.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_dismissable}
              onChange={(e) => setField('is_dismissable', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-slate-700 dark:text-slate-200">Let members dismiss it</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Dismissal is remembered on that device only, and does not affect the push notification.
              </span>
            </span>
          </label>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isEditing ? 'Save Changes' : 'Create Announcement'}
            </button>
          </div>
        </form>
        )}
      </div>

      {/* Existing announcements, newest first. */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Announcements ({rows.length})
          </h3>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {loadError && (
          <div className="px-6 py-4 flex items-center gap-3 border-b border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm font-medium">{loadError}</p>
          </div>
        )}

        {loading && rows.length === 0 ? (
          <p className="p-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading announcements…
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            No announcements yet. Create one above and it appears in the places you choose.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {rows.map((announcement) => {
              const window = announcementDateWindow(announcement);
              const variant = announcementVariant(announcement.context_variant);
              const live = Boolean(window.from) && window.from <= todayKey && (!window.to || window.to >= todayKey);
              const places = announcementLocations(announcement);
              const placeLabels = places
                .map((key) => (ANNOUNCEMENT_LOCATIONS.find((place) => place.key === key) || {}).label)
                .filter(Boolean);
              return (
                <li key={String(announcement.id)} className="p-4 flex items-start gap-3">
                  <span className={`p-2 shrink-0 rounded-xl border ${variant.box} ${variant.head}`}>
                    <RankIcon name={String(announcement.icon ?? '').trim() || ANNOUNCEMENT_ICON_FALLBACK} className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{announcement.title}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        live
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400'
                      }`}>
                        {live ? 'Showing now' : 'Not showing'}
                      </span>
                      {announcementFlag(announcement.is_send_push_notification) && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                          <Send className="w-3 h-3" /> Push
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{announcement.message}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {announcementAudienceLabel(announcement, { roles, ranks, users })}
                      {' · '}
                      {placeLabels.length ? placeLabels.join(', ') : 'Nowhere'}
                      {' · '}
                      {window.from ? dateLabel(window.from) : 'No start'}
                      {window.to ? ` to ${dateLabel(window.to)}` : ' onwards'}
                    </p>
                    {/* Who wrote it. Administrative-only: the resolved label is computed here and never
                        passed to the member-facing callouts. Blank for a row that predates the column. */}
                    {announcementAuthorLabel(announcement, users) && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <UserRound className="w-3 h-3 shrink-0" />
                        {announcementAuthorLabel(announcement, users)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(announcement)}
                      title="Edit"
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      disabled={deletingId === announcement.id}
                      onClick={() => handleDelete(announcement)}
                      className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {deletingId === announcement.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

