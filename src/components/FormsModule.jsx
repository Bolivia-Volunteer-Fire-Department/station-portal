import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FileCheck,
  FileEdit,
  FileText,
  Filter,
  History,
  Loader2,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  Search,
} from 'lucide-react';
import { fetchFormSubmissions, fetchFormTemplates } from '../services/api';
import { SOURCE_KINDS } from '../utils/formDefinition';
import { userLabel } from '../utils/displayLabel';
import GeneratePdfModal from './forms/GeneratePdfModal';
import EnteredFormModal from './forms/EnteredFormModal';
import PrintableFormSubmission from './forms/PrintableFormSubmission';

// The Forms module: generate filled PDFs or complete interactive entered forms,
// supporting multiple entries per template, viewing completed entries, and printing.
export default function FormsModule({
  departmentName = '',
  currentUser,
  users = [],
  canPickMembers = false,
}) {
  const [activeTab, setActiveTab] = useState('templates'); // 'templates' | 'my-submissions'
  const [forms, setForms] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeGeneratedForm, setActiveGeneratedForm] = useState(null);
  const [activeEnteredForm, setActiveEnteredForm] = useState(null);
  const [activeSubmission, setActiveSubmission] = useState(null);
  const [isViewingReadOnly, setIsViewingReadOnly] = useState(false);
  const [expandedForms, setExpandedForms] = useState({});
  const [printingSubmission, setPrintingSubmission] = useState(null);

  // Submissions search & filter in "My Submissions" tab
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [submissionTemplateFilter, setSubmissionTemplateFilter] = useState('');

  // Who a form can be generated for: the caller, or - for an officer - anybody on the roster, by name.
  const subjects = useMemo(() => {
    const me = currentUser ? [{ id: currentUser.id, name: currentUser.name }] : [];
    if (!canPickMembers) return me;
    const roster = users.map((user) => ({ id: String(user.id), name: userLabel(user) }));
    const rest = roster.filter((user) => !currentUser || user.id !== String(currentUser.id));
    return [...me, ...rest.sort((left, right) => left.name.localeCompare(right.name))];
  }, [canPickMembers, currentUser, users]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [fetchedForms, fetchedSubmissions] = await Promise.all([
        fetchFormTemplates(),
        fetchFormSubmissions().catch(() => []),
      ]);
      setForms(fetchedForms);
      setSubmissions(Array.isArray(fetchedSubmissions) ? fetchedSubmissions : []);
    } catch (failure) {
      setError(failure.message || 'Could not load forms.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Filter only submissions completed by the current member
  const mySubmissions = useMemo(() => {
    return submissions.filter(
      (s) =>
        s.submitted_by_uid === currentUser?.id ||
        (!currentUser && !s.submitted_by_uid)
    );
  }, [submissions, currentUser]);

  // Group user submissions by template ID for fast lookup
  const submissionsByTemplate = useMemo(() => {
    const map = {};
    mySubmissions.forEach((sub) => {
      const tId = sub.form_template_id;
      if (!map[tId]) map[tId] = [];
      map[tId].push(sub);
    });
    return map;
  }, [mySubmissions]);

  // Filtered submissions for "My Submissions" tab
  const filteredMySubmissions = useMemo(() => {
    let list = mySubmissions;
    if (submissionTemplateFilter) {
      list = list.filter((s) => s.form_template_id === submissionTemplateFilter);
    }
    if (submissionSearch.trim()) {
      const q = submissionSearch.toLowerCase();
      list = list.filter(
        (s) =>
          String(s.form_template_name || '').toLowerCase().includes(q) ||
          String(s.id || '').toLowerCase().includes(q) ||
          String(s.submitted_at || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [mySubmissions, submissionTemplateFilter, submissionSearch]);

  const toggleExpand = (formId) => {
    setExpandedForms((prev) => ({ ...prev, [formId]: !prev[formId] }));
  };

  const handleOpenNewEntry = (form) => {
    setActiveEnteredForm(form);
    setActiveSubmission(null);
    setIsViewingReadOnly(false);
  };

  const handleViewSubmission = (sub, form) => {
    setActiveEnteredForm(form || forms.find((f) => f.id === sub.form_template_id) || {
      id: sub.form_template_id,
      name: sub.form_template_name,
      form_type: 'entered',
      layout: [],
    });
    setActiveSubmission(sub);
    setIsViewingReadOnly(true);
  };

  const handleEditSubmission = (sub, form) => {
    setActiveEnteredForm(form || forms.find((f) => f.id === sub.form_template_id) || {
      id: sub.form_template_id,
      name: sub.form_template_name,
      form_type: 'entered',
      layout: [],
    });
    setActiveSubmission(sub);
    setIsViewingReadOnly(false);
  };

  return (
    <div className="space-y-4">
      {/* Intro Banner */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 mt-0.5">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Department Forms & Exports</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Access official state training PDF exports and complete interactive departmental forms directly from your account.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Primary Section Container */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        {/* Module Subtabs Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'templates'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Available Forms</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  activeTab === 'templates'
                    ? 'bg-red-700/80 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {forms.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('my-submissions')}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                activeTab === 'my-submissions'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60'
              }`}
            >
              <FileCheck className="h-3.5 w-3.5" />
              <span>My Submissions</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  activeTab === 'my-submissions'
                    ? 'bg-blue-700/80 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                {mySubmissions.length}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={load}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-12 text-sm text-slate-500 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading forms…
          </div>
        ) : activeTab === 'templates' ? (
          /* Available Forms Tab */
          forms.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No forms have been shared with you yet.</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                An administrator configures them in Administration → Forms.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
              {forms.map((form) => {
                const isEntered = form.form_type === 'entered';
                const formEntries = submissionsByTemplate[form.id] || [];
                const hasEntries = formEntries.length > 0;
                const isExpanded = Boolean(expandedForms[form.id]);

                return (
                  <div key={form.id} className="transition">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-900/30">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300">
                        {isEntered ? (
                          <FileEdit className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                            {form.name}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              isEntered
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                            }`}
                          >
                            {isEntered ? 'Interactive Form' : 'PDF Export'}
                          </span>
                          {isEntered && hasEntries && (
                            <span className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                              <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              {formEntries.length} {formEntries.length === 1 ? 'entry' : 'entries'} submitted
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {isEntered
                            ? `${(form.layout || []).filter((f) => f.field_type !== 'markdown' && f.field_type !== 'divider').length} questions / fields`
                            : (SOURCE_KINDS[form.source] || {}).label || form.source}
                          {form.description ? ` · ${form.description}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isEntered ? (
                          <>
                            {hasEntries && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(form.id)}
                                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                title="View completed entries for this form"
                              >
                                <History className="h-3.5 w-3.5 text-slate-500" />
                                <span>Entries ({formEntries.length})</span>
                                {isExpanded ? (
                                  <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                                )}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenNewEntry(form)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-500 transition shadow-sm"
                            >
                              <Plus className="h-4 w-4" />
                              <span>{hasEntries ? 'New Entry' : 'Fill Out'}</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setActiveGeneratedForm(form)}
                            className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-500 transition shadow-sm"
                          >
                            <FileText className="h-4 w-4" />
                            Generate
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expandable previous entries sub-drawer */}
                    {isEntered && hasEntries && isExpanded && (
                      <div className="bg-slate-50/70 dark:bg-slate-900/40 border-t border-b border-slate-200/80 dark:border-slate-700/60 px-5 py-3.5">
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                            <History className="h-3.5 w-3.5 text-blue-500" />
                            Your Completed Entries ({formEntries.length})
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenNewEntry(form)}
                            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <Plus className="h-3.5 w-3.5" /> Submit Another Entry
                          </button>
                        </div>

                        <div className="space-y-2">
                          {formEntries.map((sub, sIdx) => {
                            const isEditable = Boolean(form.allow_editing_after_submission) && !sub.locked;
                            const submittedDateStr = sub.submitted_at
                              ? new Date(sub.submitted_at).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })
                              : sub.date_key || 'Earlier';

                            return (
                              <div
                                key={sub.id || sIdx}
                                className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2.5 shadow-xs"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                                    #{formEntries.length - sIdx}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                                        Submitted {submittedDateStr}
                                      </span>
                                      {sub.locked ? (
                                        <span className="rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 flex items-center gap-1">
                                          <Lock className="w-2.5 h-2.5" />
                                          Locked
                                        </span>
                                      ) : (
                                        <span
                                          className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                                            isEditable
                                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                              : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
                                          }`}
                                        >
                                          {isEditable ? 'Editable' : 'Locked'}
                                        </span>
                                      )}
                                    </div>
                                    {sub.locked ? (
                                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                        Locked by {sub.locked_by_name || 'Admin'} on{' '}
                                        {sub.locked_readable_time ||
                                          (sub.locked_at ? new Date(sub.locked_at).toLocaleString() : '—')}
                                      </p>
                                    ) : sub.updated_at ? (
                                      <p className="text-[11px] text-slate-400">
                                        Updated: {new Date(sub.updated_at).toLocaleString()}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleViewSubmission(sub, form)}
                                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-600 px-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                  >
                                    <Eye className="h-3 w-3 text-blue-500" /> View
                                  </button>

                                  {isEditable && (
                                    <button
                                      type="button"
                                      onClick={() => handleEditSubmission(sub, form)}
                                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-700 px-2 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
                                    >
                                      <FileEdit className="h-3 w-3" /> Edit
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => setPrintingSubmission(sub)}
                                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-600 px-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                    title="Print this submission"
                                  >
                                    <Printer className="h-3 w-3 text-slate-500" /> Print
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* My Submissions Tab */
          <div>
            {/* Filter controls */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 dark:bg-slate-900/30">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[240px]">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={submissionSearch}
                    onChange={(e) => setSubmissionSearch(e.target.value)}
                    placeholder="Search submissions…"
                    className="h-9 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  <Filter className="h-3.5 w-3.5 text-slate-400" />
                  <select
                    value={submissionTemplateFilter}
                    onChange={(e) => setSubmissionTemplateFilter(e.target.value)}
                    className="h-9 rounded-xl border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">All Form Templates</option>
                    {forms
                      .filter((f) => f.form_type === 'entered')
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Showing {filteredMySubmissions.length} of {mySubmissions.length} record{mySubmissions.length === 1 ? '' : 's'}
              </span>
            </div>

            {filteredMySubmissions.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <FileCheck className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500 mb-2" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {mySubmissions.length === 0 ? 'No completed forms yet' : 'No matching submissions found'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                  {mySubmissions.length === 0
                    ? 'When you fill out interactive departmental forms, your completed records will be listed here.'
                    : 'Try clearing your search or template filter to see all your completed forms.'}
                </p>
                {mySubmissions.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('templates')}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition shadow-sm"
                  >
                    <Plus className="h-4 w-4" /> Browse Available Forms
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
                {filteredMySubmissions.map((sub) => {
                  const matchingTemplate = forms.find((f) => f.id === sub.form_template_id);
                  const isEditable = Boolean(matchingTemplate?.allow_editing_after_submission) && !sub.locked;
                  const submittedDate = sub.submitted_at
                    ? new Date(sub.submitted_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : sub.date_key || '—';

                  return (
                    <div
                      key={sub.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-900/30 transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                            {sub.form_template_name || matchingTemplate?.name || 'Form Submission'}
                          </span>
                          {sub.locked ? (
                            <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" />
                              Locked
                            </span>
                          ) : (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider ${
                                isEditable
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                              }`}
                            >
                              {isEditable ? 'Editable' : 'Locked'}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" /> Submitted: {submittedDate}
                          </span>
                          {sub.locked && (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                              <Lock className="h-3 w-3" />
                              Locked by {sub.locked_by_name || 'Admin'} on{' '}
                              {sub.locked_readable_time ||
                                (sub.locked_at ? new Date(sub.locked_at).toLocaleString() : '—')}
                            </span>
                          )}
                          {sub.updated_at && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> Updated: {new Date(sub.updated_at).toLocaleDateString()}
                            </span>
                          )}
                          <span className="text-slate-400">
                            &bull; {Object.keys(sub.data || {}).length} response{Object.keys(sub.data || {}).length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleViewSubmission(sub, matchingTemplate)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-500" /> View
                        </button>

                        {isEditable && (
                          <button
                            type="button"
                            onClick={() => handleEditSubmission(sub, matchingTemplate)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 px-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition"
                          >
                            <FileEdit className="h-3.5 w-3.5" /> Edit
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setPrintingSubmission(sub)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          title="Print this form submission"
                        >
                          <Printer className="h-3.5 w-3.5 text-slate-500" /> Print
                        </button>

                        {matchingTemplate && (
                          <button
                            type="button"
                            onClick={() => handleOpenNewEntry(matchingTemplate)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800 px-2.5 text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
                            title="Complete another entry of this form"
                          >
                            <Plus className="h-3.5 w-3.5" /> Fill Out Again
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Generated Form Modal */}
      {activeGeneratedForm && (
        <GeneratePdfModal
          form={activeGeneratedForm}
          departmentName={departmentName}
          currentUser={currentUser}
          subjects={subjects}
          canPickMembers={canPickMembers}
          onClose={() => setActiveGeneratedForm(null)}
        />
      )}

      {/* Entered Form Modal */}
      {activeEnteredForm && (
        <EnteredFormModal
          form={activeEnteredForm}
          currentUser={currentUser}
          submission={activeSubmission}
          isReadOnly={isViewingReadOnly}
          departmentName={departmentName}
          onClose={() => {
            setActiveEnteredForm(null);
            setActiveSubmission(null);
            setIsViewingReadOnly(false);
          }}
          onSubmitted={() => {
            void load();
          }}
        />
      )}

      {/* Printable Sheet */}
      {printingSubmission && (
        <PrintableFormSubmission
          submission={printingSubmission}
          form={forms.find((f) => f.id === printingSubmission.form_template_id)}
          departmentName={departmentName}
          onDone={() => setPrintingSubmission(null)}
        />
      )}
    </div>
  );
}
