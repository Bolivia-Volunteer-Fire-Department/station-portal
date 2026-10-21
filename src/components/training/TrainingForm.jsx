import React, { useState, useMemo, useEffect } from 'react';
import { ClipboardCheck, Lock, Check, ShieldCheck, Search, Users, AlertCircle, Loader2 } from 'lucide-react';
import { fetchAdminSections } from '../../services/api';
import {
  MEMBER_EDITABLE_FLAGS,
  TRAINING_FLAG_KEYS,
  normalizeTraining,
  trainingLocked,
  membersMustSignTrainings,
  getActiveTrainingCategories,
} from '../../utils/training';
import { recordHeading } from '../../utils/displayLabel';
import ViewportModal from '../ViewportModal';
import ConfirmModal from '../ConfirmModal';
import RankIcon from '../RankIcon';

// The add/edit form for a training activity, in the editor modal both audiences use.
const TRAINING_FORM_ID = 'training-editor-form';
const EMPTY_FORM = {
  id: '',
  date: '',
  title: '',
  start_time: '',
  duration: '',
  location: '',
  instructors: '',
  narrative: '',
  locked_at: '',
  locked_by_id: '',
  locked_by_name: '',
  is_locked: false,
  ...TRAINING_FLAG_KEYS.reduce((flags, key) => ({ ...flags, [key]: false }), {}),
};

const formFromTraining = (training) => {
  if (!training) return EMPTY_FORM;
  const normalized = normalizeTraining(training);
  return {
    ...EMPTY_FORM,
    ...training,
    id: normalized.id,
    date: normalized.date_key || '',
    title: normalized.title,
    start_time: normalized.start_time,
    duration: normalized.duration === null ? '' : String(normalized.duration),
    location: normalized.location,
    instructors: normalized.instructors,
    narrative: normalized.narrative,
    locked_at: normalized.locked_at || '',
    locked_by_id: normalized.locked_by_id || '',
    locked_by_name: normalized.locked_by_name || '',
    is_locked: Boolean(normalized.is_locked || normalized.locked),
    ...TRAINING_FLAG_KEYS.reduce(
      (flags, key) => ({ ...flags, [key]: Boolean(normalized[key]) }),
      {}
    ),
  };
};

export default function TrainingForm({
  editing = null,
  saving = false,
  onSubmit,
  onCancel,
  // Which flags this caller may set.
  allowAdminFlags = false,
  // Shows the training without any way to change it - for one somebody has signed or locked.
  readOnly = false,
  readOnlyReason = '',
  // Roster users list for attendee multi-select
  users = [],
  ranks = [],
  // System settings to check whether members must sign for their own trainings
  systemSettings = [],
  // Existing signatures for this training (used to pre-populate attendees if editing)
  existingSignatures = [],
  currentUserId = '',
  currentUserName = '',
}) {
  const [form, setForm] = useState(() => formFromTraining(editing));
  const isEditing = Boolean(form.id);
  const locked = trainingLocked(form);
  const frozen = locked || readOnly;

  // Department signing requirement: default true (members must sign).
  // When false, any user who can add trainings can select which members were present.
  const membersMustSign = useMemo(
    () => membersMustSignTrainings(systemSettings),
    [systemSettings]
  );

  const activeCategories = useMemo(
    () => getActiveTrainingCategories(systemSettings),
    [systemSettings]
  );
  // Classification flags: active configured categories or fallback to defaults
  const flags = activeCategories.length > 0 ? activeCategories : MEMBER_EDITABLE_FLAGS;

  // Selected attendee IDs when membersMustSign is false
  const [selectedMemberIds, setSelectedMemberIds] = useState(() => {
    if (Array.isArray(existingSignatures) && existingSignatures.length > 0) {
      return Array.from(
        new Set(
          existingSignatures
            .map((s) => String(s.user_id || '').trim())
            .filter(Boolean)
        )
      );
    }
    return [];
  });

  const [memberSearch, setMemberSearch] = useState('');

  // Self-healing member directory state: syncs with users prop and proactively fetches if missing
  const [internalUsers, setInternalUsers] = useState(() => (Array.isArray(users) ? users : []));
  const [loadingMembers, setLoadingMembers] = useState(false);

  useEffect(() => {
    if (Array.isArray(users) && users.length > 0) {
      setInternalUsers(users);
    }
  }, [users]);

  useEffect(() => {
    if (!membersMustSign && internalUsers.length === 0) {
      let cancelled = false;
      setLoadingMembers(true);
      fetchAdminSections(['directory'])
        .then((data) => {
          if (cancelled) return;
          if (Array.isArray(data?.directory) && data.directory.length > 0) {
            setInternalUsers(data.directory);
          }
        })
        .catch((err) => console.error('Failed to load member directory for training form', err))
        .finally(() => {
          if (!cancelled) setLoadingMembers(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [membersMustSign, internalUsers.length]);

  // Lock & approve state
  const [willLock, setWillLock] = useState(() => Boolean(form.is_locked || locked));
  const [confirmLockModal, setConfirmLockModal] = useState(false);

  // Which flags the form offers depends on the caller: the member module gets the member set, the Administration
  // report gets everything including the external-system marker.
  // allowAdminFlags ? TRAINING_FLAGS : MEMBER_EDITABLE_FLAGS
  // Setting the Lock / Approve status is permanent: once saved, this training and its signatures are locked for everyone.

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const canSave = form.date.trim() !== '' && form.title.trim() !== '' && !saving && !frozen;

  const userRankLabel = (u) => {
    const name = u?.name || u?.full_name || u?.user_name || 'Unnamed member';
    const rankObj = Array.isArray(ranks) ? ranks.find((r) => String(r.id) === String(u?.rank_id)) : null;
    const rank = rankObj?.name || u?.rank || u?.rank_name || '';
    return rank ? `${rank} ${name}` : name;
  };

  // Member search filtering
  const filteredUsers = useMemo(() => {
    const q = memberSearch.toLowerCase().trim();
    return (Array.isArray(internalUsers) ? internalUsers : [])
      .filter((u) => u && (u.id || u.user_id))
      .filter((u) => {
        if (!q) return true;
        const name = String(u.name || u.full_name || u.user_name || '').toLowerCase();
        const rankObj = Array.isArray(ranks) ? ranks.find((r) => String(r.id) === String(u?.rank_id)) : null;
        const rank = String(rankObj?.name || u.rank || u.rank_name || '').toLowerCase();
        return name.includes(q) || rank.includes(q);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [internalUsers, ranks, memberSearch]);

  const toggleMember = (userId) => {
    if (frozen) return;
    const targetId = String(userId);
    setSelectedMemberIds((prev) =>
      prev.includes(targetId) ? prev.filter((id) => id !== targetId) : [...prev, targetId]
    );
  };

  const handleSelectAll = () => {
    if (frozen) return;
    const allIds = filteredUsers.map((u) => String(u.id || u.user_id));
    setSelectedMemberIds((prev) => Array.from(new Set([...prev, ...allIds])));
  };

  const handleClearAll = () => {
    if (frozen) return;
    if (memberSearch.trim()) {
      const visibleIds = new Set(filteredUsers.map((u) => String(u.id || u.user_id)));
      setSelectedMemberIds((prev) => prev.filter((id) => !visibleIds.has(id)));
    } else {
      setSelectedMemberIds([]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSave) return;
    const now = new Date().toISOString();
    const payload = {
      ...form,
      id: form.id || '',
      duration: form.duration === '' ? '' : String(form.duration),
    };

    if (willLock && !locked) {
      payload.is_locked = true;
      payload.is_entered_into_external = true;
      payload.locked_at = now;
      payload.locked_by_id = currentUserId || '';
      payload.locked_by_name = currentUserName || '';
    }

    if (!membersMustSign) {
      payload.attendee_ids = selectedMemberIds;
    }

    onSubmit(payload);
  };

  return (
    <ViewportModal
      title={isEditing ? recordHeading('Training', form.title) : 'New training'}
      subtitle={
        readOnly
          ? 'Details'
          : isEditing
          ? 'Editing an existing training'
          : 'Record a training activity.'
      }
      icon={<ClipboardCheck className="h-4 w-4" />}
      formId={TRAINING_FORM_ID}
      saveLabel={isEditing ? 'Save training' : 'Add training'}
      saving={saving}
      readOnly={readOnly}
      onClose={onCancel}
      actions={
        canSave || readOnly ? null : (
          <span className="mr-1 hidden text-xs text-slate-500 dark:text-slate-400 sm:inline">
            {locked ? 'This training is locked.' : 'A date and a title are required.'}
          </span>
        )
      }
    >
      <form id={TRAINING_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {locked && (
          <div className="p-3.5 rounded-xl flex items-center justify-between text-sm bg-slate-100 border border-slate-200 dark:bg-slate-900/60 dark:border-slate-700">
            <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                <strong>Locked &amp; Approved</strong>
                {form.locked_by_name ? ` by ${form.locked_by_name}` : ''}
                {form.locked_at ? ` on ${form.locked_at.slice(0, 10)}` : ''}.
                This training has been entered into an external system, so it is locked and cannot be changed.
              </span>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              Finalized
            </span>
          </div>
        )}

        {readOnly && !locked && readOnlyReason && (
          <div className="p-3 rounded-xl flex items-start gap-2 text-sm font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-900/60 dark:text-slate-300 dark:border-slate-700">
            <Lock className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{readOnlyReason}</span>
          </div>
        )}

        <fieldset disabled={frozen} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Title</label>
              <input
                type="text"
                placeholder="e.g. SCBA Refresher"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Start time</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => set('start_time', e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Duration (hours)</label>
              <input
                type="number"
                step="0.25"
                min="0"
                placeholder="e.g. 2"
                value={form.duration}
                onChange={(e) => set('duration', e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Location</label>
              <input
                type="text"
                placeholder="e.g. Station 1 classroom"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Instructors</label>
              <input
                type="text"
                placeholder="e.g. Capt. Cooper"
                value={form.instructors}
                onChange={(e) => set('instructors', e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">Narrative</label>
            <textarea
              rows={3}
              placeholder="What was covered, and anything worth recording."
              value={form.narrative}
              onChange={(e) => set('narrative', e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Classification</p>
            <div className="grid gap-2 sm:grid-cols-4">
              {flags.map((flag) => (
                <label
                  key={flag.key}
                  className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form[flag.key])}
                    onChange={(e) => set(flag.key, e.target.checked)}
                    className="h-4 w-4 accent-red-600"
                  />
                  {flag.icon && <RankIcon name={flag.icon} className="w-4 h-4 text-slate-500 shrink-0" />}
                  <span>{flag.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Attendee multi-select (shown when "Members must sign for their own trainings" is FALSE) */}
          {!membersMustSign && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-red-600 dark:text-red-400" />
                    <span>Members Present ({selectedMemberIds.length} attended)</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Select members who attended this training. Attendance will be recorded for each selected member.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="font-medium text-red-600 hover:text-red-700 dark:text-red-400"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter members by name or rank…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 p-1 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                {loadingMembers ? (
                  <div className="col-span-full py-6 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                    <span>Loading members…</span>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="col-span-full py-4 text-center text-xs text-slate-400">
                    {memberSearch.trim()
                      ? `No members match "${memberSearch}"`
                      : 'No members available'}
                  </div>
                ) : (
                  filteredUsers.map((u) => {
                    const uid = String(u.id || u.user_id);
                    const selected = selectedMemberIds.includes(uid);
                    return (
                      <button
                        key={uid}
                        type="button"
                        onClick={() => toggleMember(uid)}
                        className={`flex items-center gap-2 p-2 rounded-lg text-left text-xs transition border ${
                          selected
                            ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/60 dark:border-red-800 dark:text-red-200 font-semibold'
                            : 'border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          readOnly
                          className="h-3.5 w-3.5 accent-red-600 rounded pointer-events-none"
                        />
                        <span className="truncate">{userRankLabel(u)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Lock / Approve button (replaces old "Entered into an external system" checkbox) */}
          {!locked && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  <span>Lock &amp; Approve</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Permanently finalizes this training report and prevents future edits or signature modifications.
                </p>
              </div>
              <button
                type="button"
                disabled={frozen}
                onClick={() => {
                  if (!willLock) {
                    setConfirmLockModal(true);
                  } else {
                    setWillLock(false);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition shrink-0 ${
                  willLock
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'
                    : 'border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800'
                }`}
              >
                {willLock ? <Check className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                <span>{willLock ? 'Approved (Will lock on save)' : 'Lock / Approve Training'}</span>
              </button>
            </div>
          )}
        </fieldset>
      </form>

      {confirmLockModal && (
        <ConfirmModal
          isOpen={true}
          title="Lock & Approve Training"
          message={`Are you sure you want to lock and approve this training? Once saved, this training and its ${membersMustSign ? 'signatures' : 'attendance records'} will be permanently locked and cannot be changed.`}
          confirmLabel="Approve & Lock"
          confirmVariant="primary"
          onConfirm={() => {
            setWillLock(true);
            setConfirmLockModal(false);
          }}
          onCancel={() => setConfirmLockModal(false)}
        />
      )}
    </ViewportModal>
  );
}
