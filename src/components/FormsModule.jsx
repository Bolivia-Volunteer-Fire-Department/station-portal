import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Eye, FileEdit, FileText, Loader2, RefreshCw } from 'lucide-react';
import { fetchFormSubmissions, fetchFormTemplates } from '../services/api';
import { SOURCE_KINDS } from '../utils/formDefinition';
import { userLabel } from '../utils/displayLabel';
import GeneratePdfModal from './forms/GeneratePdfModal';
import EnteredFormModal from './forms/EnteredFormModal';

// The Forms module: generate filled PDFs or complete interactive entered forms.
export default function FormsModule({ departmentName = '', currentUser, users = [], canPickMembers = false }) {
  const [forms, setForms] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeGeneratedForm, setActiveGeneratedForm] = useState(null);
  const [activeEnteredForm, setActiveEnteredForm] = useState(null);
  const [activeSubmission, setActiveSubmission] = useState(null);
  const [isViewingReadOnly, setIsViewingReadOnly] = useState(false);

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

      {/* Forms List */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Available Forms</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Forms shared with your role or rank.</p>
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
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading forms…
          </div>
        ) : forms.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No forms have been shared with you yet.</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              An administrator configures them in Administration → Forms.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {forms.map((form) => {
              const isEntered = form.form_type === 'entered';
              const userSubmission = isEntered
                ? submissions.find(
                    (s) =>
                      s.form_template_id === form.id &&
                      (s.submitted_by_uid === currentUser?.id || (!currentUser && !s.submitted_by_uid))
                  )
                : null;

              return (
                <div key={form.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-slate-50/60 dark:hover:bg-slate-900/30 transition">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300">
                    {isEntered ? <FileEdit className="h-5 w-5 text-blue-600 dark:text-blue-400" /> : <FileText className="h-5 w-5 text-red-600 dark:text-red-400" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{form.name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          isEntered
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                            : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                        }`}
                      >
                        {isEntered ? 'Interactive Form' : 'PDF Export'}
                      </span>
                      {isEntered && userSubmission && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider flex items-center gap-1 ${
                            form.allow_editing_after_submission
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600'
                          }`}
                        >
                          <CheckCircle className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          {form.allow_editing_after_submission ? 'Submitted (Editable)' : 'Submitted'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {isEntered
                        ? `${(form.layout || []).filter((f) => f.field_type !== 'markdown' && f.field_type !== 'divider').length} questions / fields`
                        : (SOURCE_KINDS[form.source] || {}).label || form.source}
                      {form.description ? ` · ${form.description}` : ''}
                      {isEntered && userSubmission?.submitted_at && (
                        <span className="text-slate-400 dark:text-slate-500 block sm:inline sm:ml-1">
                          · Completed {new Date(userSubmission.submitted_at).toLocaleDateString()}
                          {userSubmission.updated_at && ` (Updated ${new Date(userSubmission.updated_at).toLocaleDateString()})`}
                        </span>
                      )}
                    </p>
                  </div>

                  {isEntered ? (
                    userSubmission ? (
                      form.allow_editing_after_submission ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveEnteredForm(form);
                            setActiveSubmission(userSubmission);
                            setIsViewingReadOnly(false);
                          }}
                          className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
                        >
                          <FileEdit className="h-4 w-4" />
                          Edit Response
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveEnteredForm(form);
                            setActiveSubmission(userSubmission);
                            setIsViewingReadOnly(true);
                          }}
                          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 px-4 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                        >
                          <Eye className="h-4 w-4 text-slate-500" />
                          View Response
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveEnteredForm(form);
                          setActiveSubmission(null);
                          setIsViewingReadOnly(false);
                        }}
                        className="inline-flex h-9 items-center gap-2 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-500 transition shadow-sm"
                      >
                        <FileEdit className="h-4 w-4" />
                        Fill Out
                      </button>
                    )
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
              );
            })}
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
    </div>
  );
}
