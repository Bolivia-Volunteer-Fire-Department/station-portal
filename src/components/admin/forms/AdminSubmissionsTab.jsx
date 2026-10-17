import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCheck,
  Filter,
  Loader2,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react';
import ConfirmModal from '../../ConfirmModal';
import Markdown from '../../Markdown';
import { deleteFormSubmission, fetchFormSubmissions } from '../../../services/api';
import { formatPhoneNumber, parseSignatureValue } from '../../../utils/formDefinition';
import { toast } from '../../../utils/toast';
import { renderInViewport } from '../../../utils/viewportLayer';

const PAGE_SIZE = 15;

export default function AdminSubmissionsTab({ formTemplates = [] }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [viewingSubmission, setViewingSubmission] = useState(null);
  const [deletingSubmission, setDeletingSubmission] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadSubmissions = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchFormSubmissions();
      setSubmissions(rows);
    } catch (err) {
      setError(err?.message || 'Could not load form submissions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSubmissions();
  }, []);

  // Filtered submissions
  const filteredSubmissions = useMemo(() => {
    return submissions.filter((sub) => {
      if (templateFilter && sub.form_template_id !== templateFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesUser = String(sub.submitted_by_name || '').toLowerCase().includes(q);
        const matchesForm = String(sub.form_template_name || '').toLowerCase().includes(q);
        if (!matchesUser && !matchesForm) return false;
      }
      return true;
    });
  }, [submissions, templateFilter, searchQuery]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredSubmissions.length / PAGE_SIZE));
  const paginatedSubmissions = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSubmissions.slice(start, start + PAGE_SIZE);
  }, [filteredSubmissions, page]);

  const handleDelete = async () => {
    if (!deletingSubmission) return;
    setDeleting(true);
    try {
      await deleteFormSubmission(deletingSubmission.id);
      setSubmissions((prev) => prev.filter((s) => s.id !== deletingSubmission.id));
      if (viewingSubmission?.id === deletingSubmission.id) setViewingSubmission(null);
      setDeletingSubmission(null);
      toast.success('Form submission deleted.');
    } catch (err) {
      toast.error(err?.message || 'Failed to delete submission.');
    } finally {
      setDeleting(false);
    }
  };

  // Associated template for the submission being viewed
  const activeTemplate = useMemo(() => {
    if (!viewingSubmission) return null;
    return formTemplates.find((t) => t.id === viewingSubmission.form_template_id) || null;
  }, [viewingSubmission, formTemplates]);

  return (
    <div className="space-y-4">
      {/* Filter and search header */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search member or form name…"
              className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 pl-9 pr-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={templateFilter}
              onChange={(e) => {
                setTemplateFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Form Templates</option>
              {formTemplates.map((tmpl) => (
                <option key={tmpl.id} value={tmpl.id}>
                  {tmpl.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={loadSubmissions}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-600 px-3 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Submissions list */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Completed Submissions</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing {filteredSubmissions.length} record{filteredSubmissions.length === 1 ? '' : 's'}
            </p>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-12 text-sm text-slate-500 justify-center">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading submissions…
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <FileCheck className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500 mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No submissions found</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              When members complete interactive forms, their answers will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {paginatedSubmissions.map((sub) => (
              <div
                key={sub.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-900/30 transition"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                      {sub.form_template_name || 'Form Submission'}
                    </span>
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                      {Object.keys(sub.data || {}).length} response{Object.keys(sub.data || {}).length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> {sub.submitted_by_name || 'Member'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />{' '}
                      {sub.submitted_at
                        ? new Date(sub.submitted_at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : sub.date_key || '—'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setViewingSubmission(sub)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                  >
                    <Eye className="h-3.5 w-3.5 text-blue-500" /> View
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingSubmission(sub)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 px-2.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Submission Detail Modal */}
      {viewingSubmission &&
        renderInViewport(
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
          >
          <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {viewingSubmission.form_template_name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Submitted by {viewingSubmission.submitted_by_name} on{' '}
                  {viewingSubmission.submitted_at
                    ? new Date(viewingSubmission.submitted_at).toLocaleString()
                    : viewingSubmission.date_key}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingSubmission(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {activeTemplate?.layout ? (
                <div className="space-y-4">
                  {activeTemplate.layout.map((item, idx) => {
                    if (item.field_type === 'markdown') {
                      return (
                        <div
                          key={item.id || idx}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-3.5 select-text"
                        >
                          <Markdown markdown={item.markdown_content || ''} />
                        </div>
                      );
                    }

                    if (item.field_type === 'divider') {
                      return (
                        <div key={item.id || idx} className="pt-2 pb-1">
                          {item.caption ? (
                            <div className="flex items-center gap-3">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
                                {item.caption}
                              </h4>
                              <div className="h-px w-full bg-slate-200 dark:bg-slate-700" />
                            </div>
                          ) : (
                            <hr className="border-t border-slate-200 dark:border-slate-700 my-1" />
                          )}
                        </div>
                      );
                    }

                    const val = viewingSubmission.data?.[item.data_name];

                    if (item.field_type === 'signature') {
                      const sig = parseSignatureValue(val);
                      return (
                        <div
                          key={item.id || idx}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-900/50"
                        >
                          <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {item.caption}
                          </span>
                          {item.instructions && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-0.5">
                              {item.instructions}
                            </p>
                          )}
                          <div className="mt-2">
                            {sig.image ? (
                              <div className="inline-flex flex-col gap-1.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                                <img
                                  src={sig.image}
                                  alt={item.caption || 'Drawn signature'}
                                  className="max-h-24 max-w-full object-contain signature-invert-dark dark:invert print:filter-none"
                                />
                                {sig.readable_time && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 pt-1 border-t border-slate-100 dark:border-slate-800">
                                    <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
                                    <span>
                                      Signed: <strong className="text-slate-700 dark:text-slate-300">{sig.readable_time}</strong>
                                    </span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic text-sm">No signature provided</span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    if (item.field_type === 'signature_stamp') {
                      const stamp =
                        typeof val === 'object' && val !== null
                          ? val
                          : val
                          ? { stamped: true, name: String(val) }
                          : null;
                      return (
                        <div
                          key={item.id || idx}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-900/50"
                        >
                          <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                            {item.caption}
                          </span>
                          {item.instructions && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mb-2">
                              {item.instructions}
                            </p>
                          )}
                          {stamp?.stamped ? (
                            <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/70 dark:bg-emerald-950/20 p-3.5 flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                                <BadgeCheck className="h-6 w-6" />
                              </div>
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                                  Digitally Stamped & Verified
                                </p>
                                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                  {stamp.name || viewingSubmission.submitted_by_name || 'Member'}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {stamp.readable_time ||
                                    (stamp.timestamp ? new Date(stamp.timestamp).toLocaleString() : '')}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-sm">No stamp recorded</span>
                          )}
                        </div>
                      );
                    }

                    if (item.field_type === 'tel') {
                      return (
                        <div
                          key={item.id || idx}
                          className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-900/50"
                        >
                          <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {item.caption}
                          </span>
                          {item.instructions && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-0.5">
                              {item.instructions}
                            </p>
                          )}
                          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 select-text">
                            {val ? (
                              <>
                                <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <a
                                  href={`tel:${String(val).replace(/[^0-9+]/g, '')}`}
                                  className="hover:text-blue-600 dark:hover:text-blue-400 underline decoration-slate-300"
                                >
                                  {formatPhoneNumber(String(val))}
                                </a>
                              </>
                            ) : (
                              <span className="text-slate-400 italic font-normal">No response provided</span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.id || idx}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-900/50"
                      >
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {item.caption}
                        </span>
                        {item.instructions && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic mt-0.5">
                            {item.instructions}
                          </p>
                        )}
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white select-text">
                          {val === true
                            ? 'Yes / Checked'
                            : val === false
                            ? 'No / Unchecked'
                            : val !== undefined && val !== ''
                            ? String(val)
                            : <span className="text-slate-400 italic font-normal">No response provided</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Fallback raw display if template layout is unavailable */
                <div className="space-y-3">
                  {Object.entries(viewingSubmission.data || {}).map(([key, val]) => {
                    const isImg = typeof val === 'string' && val.startsWith('data:image/');
                    const isStamp = typeof val === 'object' && val !== null && val.stamped;
                    return (
                      <div
                        key={key}
                        className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-white dark:bg-slate-900/50"
                      >
                        <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          {key}
                        </span>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white select-text">
                          {isImg ? (
                            <img
                              src={val}
                              alt={key}
                              className="max-h-24 max-w-full object-contain mt-1"
                            />
                          ) : isStamp ? (
                            <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/70 dark:bg-emerald-950/20 p-2.5 flex items-center gap-2 mt-1">
                              <BadgeCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                                {val.name || 'Digitally Stamped'} (
                                {val.readable_time || val.timestamp || 'Verified'})
                              </span>
                            </div>
                          ) : (
                            String(val ?? '—')
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end border-t border-slate-200 dark:border-slate-700 px-6 py-3">
              <button
                type="button"
                onClick={() => setViewingSubmission(null)}
                className="h-9 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSubmission && (
        <ConfirmModal
          tone="danger"
          title="Delete Submission?"
          message={`Are you sure you want to permanently delete this submission for "${deletingSubmission.form_template_name}" by ${deletingSubmission.submitted_by_name}? This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete Submission'}
          onConfirm={handleDelete}
          onCancel={() => setDeletingSubmission(null)}
        />
      )}
    </div>
  );
}
