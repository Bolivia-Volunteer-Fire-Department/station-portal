import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClipboardList,
  Plus,
  Search,
  Filter,
  Calendar,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  Lock,
  Unlock,
  Truck,
  FileText,
  CheckSquare,
  Repeat,
  RotateCw,
  Sparkles,
  Layers,
  ChevronRight,
  Trash2,
  Printer,
} from 'lucide-react';
import {
  fetchTaskNoteEntries,
  fetchTaskNoteTemplates,
  fetchApparatus,
} from '../services/api';
import {
  TASK_NOTE_KINDS,
  TASK_NOTE_STATUS,
  KIND_META,
  STATUS_META,
  daysAgoDateKey,
  isTemplateActiveOn,
  normalizeTaskNoteEntry,
  getTemplatePermissionsForUser,
} from '../utils/tasksAndNotes';
import { stationTodayKey } from '../utils/scheduleDate';
import TaskNoteEntryModal from './tasks/TaskNoteEntryModal';
import PrintableTaskNoteEntry from './tasks/PrintableTaskNoteEntry';
import { toast } from '../utils/toast';

const WINDOW_OPTIONS = [
  { days: 7, label: 'Last 7 Days' },
  { days: 14, label: 'Last 14 Days (Default)' },
  { days: 30, label: 'Last 30 Days' },
  { days: 90, label: 'Last 90 Days' },
  { days: 0, label: 'All History' },
];

export default function TasksAndNotesModule({
  token = '',
  currentUser = null,
  currentUserRole = null,
  roles = [],
  canEdit = true,
  canUnsign = false,
  canDelete = false,
  canManageTaskSetup = false,
  canManageNoteSetup = false,
  departmentName = '',
  departmentLogoUrl = '',
  onNavigateToAdmin = null,
}) {
  const [entries, setEntries] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [apparatusList, setApparatusList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Windowed Query State: default to 14 days
  const [windowDays, setWindowDays] = useState(14);

  // Filters and Search
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Add New Dropdown State
  const [addNewOpen, setAddNewOpen] = useState(false);

  // Modal State for Viewing / Filling an Entry
  const [activeModalEntry, setActiveModalEntry] = useState(null);
  const [activeModalTemplate, setActiveModalTemplate] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [printTargetEntry, setPrintTargetEntry] = useState(null);

  const todayKey = useMemo(() => stationTodayKey(), []);

  // Compute fromDate string based on windowDays
  const windowFromDate = useMemo(() => {
    if (windowDays === 0) return '';
    return daysAgoDateKey(new Date(), windowDays);
  }, [windowDays]);

  const loadData = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const [entriesRes, templatesRes, apparatusRes] = await Promise.all([
          fetchTaskNoteEntries({
            fromDate: windowFromDate,
            days: windowDays,
          }),
          fetchTaskNoteTemplates().catch(() => []),
          fetchApparatus(token).catch(() => ({ apparatus: [] })),
        ]);

        setEntries((entriesRes || []).map(normalizeTaskNoteEntry));
        setTemplates(templatesRes || []);
        if (apparatusRes?.apparatus) {
          setApparatusList(apparatusRes.apparatus);
        }
      } catch (err) {
        setError(err.message || 'Failed to load Tasks & Notes.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [windowFromDate, windowDays, token]
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Map templates by ID for fast lookup
  const templateMap = useMemo(() => {
    const map = new Map();
    templates.forEach((t) => map.set(t.id, t));
    return map;
  }, [templates]);

  // Active templates currently available for adding new entries
  const activeTemplates = useMemo(() => {
    return templates.filter((tpl) => isTemplateActiveOn(tpl, todayKey));
  }, [templates, todayKey]);

  // Active templates grouped by kind for the "Add New" dropdown, filtered by user's canEdit permission on each template
  const groupedTemplates = useMemo(() => {
    const creatableTemplates = activeTemplates.filter((t) => {
      const perms = getTemplatePermissionsForUser({
        template: t,
        user: currentUser,
        role: currentUserRole,
        roles,
      });
      return perms.canEdit;
    });
    return {
      notes: creatableTemplates.filter((t) => t.kind === TASK_NOTE_KINDS.NOTE),
      tasks: creatableTemplates.filter((t) => t.kind === TASK_NOTE_KINDS.TASK),
      checklists: creatableTemplates.filter((t) => t.kind === TASK_NOTE_KINDS.APPARATUS_CHECKLIST),
    };
  }, [activeTemplates, currentUser, currentUserRole, roles]);

  const hasCreatableTemplates = useMemo(() => {
    return (
      groupedTemplates.notes.length > 0 ||
      groupedTemplates.tasks.length > 0 ||
      groupedTemplates.checklists.length > 0
    );
  }, [groupedTemplates]);

  // Filtered and searched entries
  const filteredEntries = useMemo(() => {
    return entries.filter((row) => {
      // Permission check: if template exists and user doesn't have canView, hide it
      const tpl = templateMap.get(row.template_id);
      if (tpl) {
        const perms = getTemplatePermissionsForUser({
          template: tpl,
          user: currentUser,
          role: currentUserRole,
          roles,
        });
        if (!perms.canView) return false;
      }

      if (kindFilter !== 'all' && row.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = String(row.title || '').toLowerCase().includes(q);
        const matchesAuthor = String(row.submitted_by_name || '').toLowerCase().includes(q);
        const matchesApparatus = String(row.apparatus_identifier || '').toLowerCase().includes(q);
        const matchesDate = String(row.entry_date || '').includes(q);
        if (!matchesTitle && !matchesAuthor && !matchesApparatus && !matchesDate) return false;
      }

      return true;
    });
  }, [entries, kindFilter, statusFilter, searchQuery, templateMap, currentUser, currentUserRole, roles]);

  // Open entry modal for a newly initiated entry from template
  const handleStartNewEntry = (tpl) => {
    setActiveModalEntry(null);
    setActiveModalTemplate(tpl);
    setModalOpen(true);
    setAddNewOpen(false);
  };

  // Open entry modal for an existing entry
  const handleOpenEntry = (entry) => {
    setActiveModalEntry(entry);
    const matchedTpl = templates.find((t) => t.id === entry.template_id) || null;
    setActiveModalTemplate(matchedTpl);
    setModalOpen(true);
  };

  const handleEntrySaved = (savedEntry) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === savedEntry.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = normalizeTaskNoteEntry(savedEntry);
        return next;
      }
      return [normalizeTaskNoteEntry(savedEntry), ...prev];
    });
  };

  const handleEntryDeleted = (deletedId) => {
    setEntries((prev) => prev.filter((e) => e.id !== deletedId));
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Add New Action Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-red-600" />
            Tasks & Notes
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Chronological log of shift notes, daily tasks, and apparatus walk-around checklists.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-60"
            title="Refresh log"
          >
            <RotateCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-red-600' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Add New Dropdown Menu */}
          {canEdit && hasCreatableTemplates && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAddNewOpen((prev) => !prev)}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
              >
                <Plus className="h-4 w-4" />
                <span>Add New</span>
                <ChevronDown className="h-4 w-4 ml-1 opacity-80" />
              </button>

              {addNewOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setAddNewOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800 z-30 space-y-2">
                    {/* Shift Notes Section */}
                    {groupedTemplates.notes.length > 0 && (
                      <div>
                        <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                          <ClipboardList className="h-3.5 w-3.5" />
                          <span>Shift Notes</span>
                        </div>
                        <div className="space-y-0.5">
                          {groupedTemplates.notes.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => handleStartNewEntry(tpl)}
                              className="w-full text-left px-3 py-2 text-xs font-medium rounded-xl text-slate-700 dark:text-slate-200 hover:bg-purple-50 dark:hover:bg-purple-950/40 flex items-center justify-between transition"
                            >
                              <span className="truncate">{tpl.name}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Daily Tasks Section */}
                    {groupedTemplates.tasks.length > 0 && (
                      <div className="border-t border-slate-100 dark:border-slate-700/60 pt-2">
                        <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                          <CheckSquare className="h-3.5 w-3.5" />
                          <span>Daily Tasks</span>
                        </div>
                        <div className="space-y-0.5">
                          {groupedTemplates.tasks.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => handleStartNewEntry(tpl)}
                              className="w-full text-left px-3 py-2 text-xs font-medium rounded-xl text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-950/40 flex items-center justify-between transition"
                            >
                              <span className="truncate">{tpl.name}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Apparatus Checklists Section */}
                    {groupedTemplates.checklists.length > 0 && (
                      <div className="border-t border-slate-100 dark:border-slate-700/60 pt-2">
                        <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <Truck className="h-3.5 w-3.5" />
                          <span>Apparatus Checklists</span>
                        </div>
                        <div className="space-y-0.5">
                          {groupedTemplates.checklists.map((tpl) => (
                            <button
                              key={tpl.id}
                              type="button"
                              onClick={() => handleStartNewEntry(tpl)}
                              className="w-full text-left px-3 py-2 text-xs font-medium rounded-xl text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-between transition"
                            >
                              <span className="truncate">{tpl.name}</span>
                              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTemplates.length === 0 && (
                      <div className="p-3 text-center text-xs text-slate-500">
                        <p>No active templates configured.</p>
                        {(canManageTaskSetup || canManageNoteSetup) && onNavigateToAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setAddNewOpen(false);
                              onNavigateToAdmin();
                            }}
                            className="mt-2 text-red-600 font-semibold hover:underline"
                          >
                            Go to Template Setup
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Windowing & Performance Notice Pill */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-600 dark:border-slate-700/80 dark:bg-slate-800/40 dark:text-slate-300">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
          <span>
            {windowDays > 0 ? (
              <>
                Displaying entries from <strong>{windowFromDate}</strong> to <strong>{todayKey}</strong> (Window: {windowDays} days).
              </>
            ) : (
              <>Displaying all historical entries.</>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Query Window:</span>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {WINDOW_OPTIONS.map((opt) => (
              <option key={opt.days} value={opt.days}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search entries by title, author, apparatus, or date…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>

        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Types</option>
          <option value={TASK_NOTE_KINDS.NOTE}>Shift Notes</option>
          <option value={TASK_NOTE_KINDS.TASK}>Daily Tasks</option>
          <option value={TASK_NOTE_KINDS.APPARATUS_CHECKLIST}>Apparatus Checklists</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="all">All Statuses</option>
          <option value={TASK_NOTE_STATUS.EDITABLE}>Editable (Draft)</option>
          <option value={TASK_NOTE_STATUS.SIGNED}>Signed (Locked)</option>
        </select>
      </div>

      {/* Table & Content Area */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-red-600" />
          <span className="ml-3 text-sm">Loading log entries…</span>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center dark:border-slate-700">
          <ClipboardList className="mx-auto h-12 w-12 text-slate-400" />
          <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
            No entries found in this window
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {searchQuery || kindFilter !== 'all' || statusFilter !== 'all'
              ? 'Try clearing your filters or search terms.'
              : `No entries were logged in the past ${windowDays > 0 ? `${windowDays} days` : 'period'}. Select a wider window or start a new entry.`}
          </p>
          {canEdit && hasCreatableTemplates && (
            <button
              type="button"
              onClick={() => {
                const firstCreatable =
                  groupedTemplates.notes[0] ||
                  groupedTemplates.tasks[0] ||
                  groupedTemplates.checklists[0];
                if (firstCreatable) handleStartNewEntry(firstCreatable);
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition"
            >
              <Plus className="h-4 w-4" />
              <span>Start an Entry</span>
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-6 py-3.5">
                    Entry
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Date & Time
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Submitted By
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEntries.map((row) => {
                  const kindMeta = KIND_META[row.kind] || KIND_META[TASK_NOTE_KINDS.TASK];
                  const statusMeta = STATUS_META[row.status] || STATUS_META[TASK_NOTE_STATUS.EDITABLE];
                  const isRowSigned = row.status === TASK_NOTE_STATUS.SIGNED;

                  return (
                    <tr
                      key={row.id}
                      onClick={() => handleOpenEntry(row)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
                    >
                      {/* What the Entry is */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${kindMeta.badgeClass}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${kindMeta.dotClass}`} />
                            {kindMeta.label}
                          </span>

                          <div>
                            <span className="font-semibold text-slate-900 dark:text-white group-hover:text-red-600 transition">
                              {row.title || row.template_name}
                            </span>
                            {row.apparatus_identifier && (
                              <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                <Truck className="h-3 w-3 text-slate-400" />
                                <span>{row.apparatus_identifier}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Date & Time */}
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-white font-medium">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{row.entry_date}</span>
                        </div>
                        {row.entry_time && (
                          <div className="mt-0.5 flex items-center gap-1.5 text-slate-400 text-[11px]">
                            <Clock className="h-3 w-3" />
                            <span>{row.entry_time}</span>
                          </div>
                        )}
                      </td>

                      {/* Submitter */}
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1.5 text-slate-900 dark:text-white font-medium">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span>{row.submitted_by_name || 'Member'}</span>
                        </div>
                        {row.submitted_by_rank && (
                          <div className="mt-0.5 text-[11px] text-slate-400 pl-5">
                            {row.submitted_by_rank}
                          </div>
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusMeta.badgeClass}`}
                        >
                          {isRowSigned ? (
                            <Lock className="h-3 w-3" />
                          ) : (
                            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          )}
                          {statusMeta.label}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPrintTargetEntry(row);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-750 rounded-lg transition"
                            title="Print Record"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                          {(() => {
                            const rowTemplate = templateMap.get(row.template_id);
                            const rowPerms = getTemplatePermissionsForUser({
                              template: rowTemplate,
                              user: currentUser,
                              role: currentUserRole,
                              roles,
                            });
                            const canEditRow = rowPerms.canEdit && !isRowSigned;
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenEntry(row);
                                }}
                                className="inline-flex items-center gap-1 font-semibold text-red-600 hover:text-red-700"
                              >
                                <span>{canEditRow ? 'Open / Edit' : 'View Form'}</span>
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full-Width Task/Note Entry Modal */}
      {modalOpen && (() => {
        const effectivePerms = getTemplatePermissionsForUser({
          template: activeModalTemplate,
          user: currentUser,
          role: currentUserRole,
          roles,
        });
        return (
          <TaskNoteEntryModal
            entry={activeModalEntry}
            template={activeModalTemplate}
            templates={templates}
            currentUser={currentUser}
            canEdit={effectivePerms.canEdit}
            canUnsign={effectivePerms.canUnsign}
            canDelete={effectivePerms.canDelete}
            apparatusList={apparatusList}
            departmentName={departmentName}
            departmentLogoUrl={departmentLogoUrl}
            onClose={() => {
              setModalOpen(false);
              setActiveModalEntry(null);
              setActiveModalTemplate(null);
            }}
            onSaved={handleEntrySaved}
            onDeleted={handleEntryDeleted}
          />
        );
      })()}

      {/* Quick Print from Table Row */}
      {printTargetEntry && (() => {
        const rowTemplate = templateMap.get(printTargetEntry.template_id);
        const apparatusName =
          apparatusList.find((a) => String(a.id) === String(printTargetEntry.apparatus_id))?.name ||
          apparatusList.find((a) => String(a.id) === String(printTargetEntry.apparatus_id))?.unit_number ||
          '';
        return (
          <PrintableTaskNoteEntry
            entry={printTargetEntry}
            template={rowTemplate}
            title={printTargetEntry.title || rowTemplate?.name || 'Task / Note Record'}
            entryDate={printTargetEntry.entry_date}
            entryTime={printTargetEntry.entry_time}
            apparatusName={apparatusName}
            answers={printTargetEntry.data || {}}
            departmentName={departmentName}
            logoUrl={departmentLogoUrl}
            onDone={() => setPrintTargetEntry(null)}
          />
        );
      })()}
    </div>
  );
}

