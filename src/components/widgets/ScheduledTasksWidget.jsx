import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckSquare,
  ClipboardList,
  Truck,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  Loader2,
  Calendar,
  Lock,
  Plus,
} from 'lucide-react';
import {
  fetchTaskNoteTemplates,
  fetchTaskNoteEntries,
  fetchApparatus,
} from '../../services/api';
import {
  TASK_NOTE_KINDS,
  TASK_NOTE_STATUS,
  KIND_META,
  isTemplateScheduledForDate,
  normalizeTaskNoteEntry,
  getTemplatePermissionsForUser,
} from '../../utils/tasksAndNotes';
import { stationTodayKey } from '../../utils/scheduleDate';
import TaskNoteEntryModal from '../tasks/TaskNoteEntryModal';

export default function ScheduledTasksWidget({
  token,
  currentUser = null,
  currentRole = null,
  roles = [],
  onNavigate = null,
}) {
  const [templates, setTemplates] = useState([]);
  const [todayEntries, setTodayEntries] = useState([]);
  const [apparatusList, setApparatusList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEntry, setModalEntry] = useState(null);
  const [modalTemplate, setModalTemplate] = useState(null);

  const todayKey = useMemo(() => stationTodayKey(), []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [tplsRes, entriesRes, apparatusRes] = await Promise.all([
        fetchTaskNoteTemplates().catch(() => []),
        fetchTaskNoteEntries({ fromDate: todayKey, days: 1 }).catch(() => []),
        fetchApparatus(token).catch(() => ({ apparatus: [] })),
      ]);

      setTemplates(tplsRes || []);
      setTodayEntries((entriesRes || []).map(normalizeTaskNoteEntry));
      if (apparatusRes?.apparatus) {
        setApparatusList(apparatusRes.apparatus);
      }
    } catch (err) {
      setError(err?.message || 'Failed to load scheduled tasks.');
    } finally {
      setLoading(false);
    }
  }, [token, todayKey]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Find all templates scheduled for today and viewable by current user
  const scheduledTasks = useMemo(() => {
    return templates
      .filter((tpl) => {
        if (!isTemplateScheduledForDate(tpl, todayKey)) return false;
        const perms = getTemplatePermissionsForUser({
          template: tpl,
          user: currentUser,
          role: currentRole,
          roles,
        });
        return perms.canView;
      })
      .map((tpl) => {
        // Find if there is an entry created today for this template
        const match = todayEntries.find((e) => e.template_id === tpl.id);
        const isSigned = match?.status === TASK_NOTE_STATUS.SIGNED;
        const isDraft = match?.status === TASK_NOTE_STATUS.EDITABLE;
        const apparatus = apparatusList.find((a) => a.id === tpl.apparatus_id);
        const perms = getTemplatePermissionsForUser({
          template: tpl,
          user: currentUser,
          role: currentRole,
          roles,
        });

        return {
          template: tpl,
          entry: match || null,
          isCompleted: isSigned,
          isDraft: isDraft,
          canEdit: perms.canEdit,
          apparatusIdentifier: apparatus?.identifier || apparatus?.description || '',
        };
      })
      .sort((a, b) => {
        // Pending first, then drafts, then completed
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        if (a.isDraft !== b.isDraft) return a.isDraft ? -1 : 1;
        return a.template.name.localeCompare(b.template.name);
      });
  }, [templates, todayEntries, apparatusList, todayKey, currentUser, currentRole, roles]);

  const handleOpenTask = (item) => {
    setModalTemplate(item.template);
    setModalEntry(item.entry);
    setModalOpen(true);
  };

  const handleSaved = (savedEntry) => {
    setTodayEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === savedEntry.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = normalizeTaskNoteEntry(savedEntry);
        return next;
      }
      return [normalizeTaskNoteEntry(savedEntry), ...prev];
    });
  };

  const completedCount = scheduledTasks.filter((t) => t.isCompleted).length;
  const totalCount = scheduledTasks.length;

  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 shadow-xl transition-all">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold shrink-0">
            <CheckSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Today's Scheduled Tasks
            </h3>
            <p className="text-[11px] text-slate-400">
              Daily operational tasks &amp; apparatus checks
            </p>
          </div>
        </div>

        {totalCount > 0 && (
          <span
            className={`inline-flex items-center justify-center shrink-0 whitespace-nowrap min-w-[20px] px-2 py-0.5 text-[11px] font-bold rounded-full ${
              completedCount === totalCount
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60'
                : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60'
            }`}
          >
            {completedCount} / {totalCount} Done
          </span>
        )}
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin text-red-600" />
            <span className="ml-2 text-xs">Checking today's tasks...</span>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : scheduledTasks.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              No tasks or checklists scheduled for today
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              You're all clear! Extra entries can still be logged in Tasks &amp; Notes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {scheduledTasks.map((item) => {
              return (
                <div
                  key={item.template.id}
                  onClick={() => handleOpenTask(item)}
                  className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition cursor-pointer group ${
                    item.isCompleted
                      ? 'bg-slate-50/50 border-slate-200/60 dark:bg-slate-800/40 dark:border-slate-700/40 hover:bg-slate-100/60 dark:hover:bg-slate-700/40'
                      : item.isDraft
                        ? 'bg-amber-50/30 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40 hover:bg-amber-50/60 dark:hover:bg-amber-950/30'
                        : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/80 dark:bg-slate-700/30 dark:border-slate-700/60 dark:hover:bg-slate-700/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="shrink-0">
                      {item.isCompleted ? (
                        <div className="h-6 w-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                      ) : item.isDraft ? (
                        <div className="h-6 w-6 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-xs">
                          <Clock className="h-3.5 w-3.5" />
                        </div>
                      ) : (
                        <div className="h-6 w-6 rounded-full border-2 border-slate-300 dark:border-slate-600 group-hover:border-red-500 transition" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-red-600 dark:group-hover:text-red-400 transition">
                          {item.template.name}
                        </h4>
                        {item.apparatusIdentifier && (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:text-slate-300 shrink-0">
                            <Truck className="w-2.5 h-2.5 text-slate-400" />
                            {item.apparatusIdentifier}
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        <span className="capitalize shrink-0">
                          {item.template.scheduling?.frequency || 'Daily'}
                        </span>
                        {item.isCompleted ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium truncate">
                            • Signed by {item.entry?.signed_by_name || 'Member'}
                          </span>
                        ) : item.isDraft ? (
                          <span className="text-amber-600 dark:text-amber-400 font-medium truncate">
                            • Draft in progress
                          </span>
                        ) : (
                          <span className="text-slate-400 truncate">• Due today</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 text-xs font-semibold ml-2">
                    {item.isCompleted ? (
                      <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                        Done
                      </span>
                    ) : !item.canEdit ? (
                      <span className="text-slate-500 dark:text-slate-400 text-xs group-hover:underline">
                        View
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 text-xs group-hover:underline">
                        {item.isDraft ? 'Resume' : 'Start'}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-red-500 dark:group-hover:text-red-400 group-hover:translate-x-0.5 transition" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      {onNavigate && (
        <div className="shrink-0 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-400">
            {scheduledTasks.length} task{scheduledTasks.length === 1 ? '' : 's'} scheduled today
          </span>
          <button
            type="button"
            onClick={() => onNavigate('tasks-and-notes')}
            className="text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-500 flex items-center gap-0.5 transition"
          >
            <span>Tasks &amp; Notes Log</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Interactive Entry Modal */}
      {modalOpen && (() => {
        const modalPerms = getTemplatePermissionsForUser({
          template: modalTemplate,
          user: currentUser,
          role: currentRole,
          roles,
        });
        return (
          <TaskNoteEntryModal
            entry={modalEntry}
            template={modalTemplate}
            templates={templates}
            currentUser={currentUser}
            canEdit={modalPerms.canEdit}
            canUnsign={modalPerms.canUnsign}
            canDelete={modalPerms.canDelete}
            apparatusList={apparatusList}
            onClose={() => {
              setModalOpen(false);
              setModalEntry(null);
              setModalTemplate(null);
            }}
            onSaved={handleSaved}
          />
        );
      })()}
    </div>
  );
}

