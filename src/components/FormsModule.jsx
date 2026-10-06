import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, FileText, Loader2, RefreshCw } from 'lucide-react';
import { fetchFormTemplates, fetchMemberTraining } from '../services/api';
import { SOURCE_KINDS } from '../utils/formDefinition';
import { categoryPairsFrom } from '../utils/trainingSummary';
import { TRAINING_FLAGS } from '../utils/training';
import { generateForm } from '../utils/generateForm';
import { loadBundledBlank } from '../utils/formCatalog';
import { downloadFormPdf, formPdfFileName, openFormPdf } from '../utils/formExport';
import { resolveReportRange } from '../utils/reportParameters';
import { toDateKey } from '../utils/scheduleDate';
import { userLabel } from '../utils/displayLabel';

// The Forms module: generate a printable PDF already filled in from the app's own data.
//
// WHAT A MEMBER SEES is decided by each definition's AUDIENCE, on the server - this screen asks for "my forms" and is
// handed exactly the ones shared with the caller's role or rank, with no client-side filtering that could disagree.
//
// THE PDF IS MADE IN THE BROWSER (utils/generateForm, which lazy-loads pdf-lib), so this works on a station laptop with
// no signal: nothing but the (bundled) blank is fetched, and the values come from data already on the screen.
//
// THE SUBJECT IS PICKABLE ONLY FOR AN OFFICER. Reading another member's training signatures is `can_administer_trainings`
// at the rules, so a role without it is offered only themselves - and is not shown a picker that would be refused.
const PERIODS = [
  ['this_year', 'This year'],
  ['last_year', 'Last year'],
  ['all', 'All time'],
];

export default function FormsModule({ departmentName = '', currentUser, users = [], canPickMembers = false }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [period, setPeriod] = useState('this_year');
  const [busyId, setBusyId] = useState('');
  const [result, setResult] = useState(null);

  // Who a form can be generated for: the caller, or - for an officer - anybody on the roster, by name.
  const subjects = useMemo(() => {
    const me = currentUser ? [{ id: currentUser.id, name: currentUser.name }] : [];
    if (!canPickMembers) return me;
    const roster = users.map((user) => ({ id: String(user.id), name: userLabel(user) }));
    const rest = roster.filter((user) => !currentUser || user.id !== String(currentUser.id));
    return [...me, ...rest.sort((left, right) => left.name.localeCompare(right.name))];
  }, [canPickMembers, currentUser, users]);

  useEffect(() => {
    setSubjectId(currentUser ? String(currentUser.id) : '');
  }, [currentUser]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setForms(await fetchFormTemplates());
    } catch (failure) {
      setError(failure.message || 'Could not load forms.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // The object URL for the last generated PDF is released when it is replaced or the screen closes, so a long session
  // does not hold every sheet in memory.
  useEffect(
    () => () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    },
    [result]
  );

  const generate = async (form) => {
    setBusyId(form.id);
    setError('');
    setResult(null);
    try {
      const today = toDateKey(new Date());
      const subject = subjects.find((entry) => entry.id === String(subjectId)) || subjects[0] || currentUser || {};
      // The rows a form's source needs, then the words the source cannot know (`station`, `today`, `range`).
      const { trainings, signatures } = await fetchMemberTraining(subjectId || currentUser?.id);
      const filled = await generateForm({
        definition: form,
        data: {
          subject,
          station: { name: departmentName, department_name: departmentName },
          categories: categoryPairsFrom(TRAINING_FLAGS),
          today,
          range: period === 'all' ? {} : resolveReportRange(period, today),
          trainings,
          signatures,
        },
        loadTemplate: (id) => loadBundledBlank(id, { baseUrl: import.meta.env.BASE_URL }),
      });
      setResult({
        formId: form.id,
        fileName: formPdfFileName({ formName: form.name, subjectName: userLabel(subject), today }),
        url: openFormPdf(filled.bytes),
        bytes: filled.bytes,
        problems: filled.problems,
      });
    } catch (failure) {
      setError(failure.message || 'Could not generate this form.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Pick a form and it is filled in from the app’s own records, ready to print or save — no retyping the same
            details onto the sheet.
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            For
            <select
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              disabled={!canPickMembers}
              aria-label="Who the form is for"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Period
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              aria-label="The period the form covers"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            >
              {PERIODS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
          <div className="flex flex-wrap items-center gap-3">
            <FileText className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-emerald-800 dark:text-emerald-200">
              {result.fileName}
            </span>
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-300 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
            >
              Open
            </a>
            <button
              type="button"
              onClick={() => downloadFormPdf(result.bytes, result.fileName)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500"
            >
              <Download className="h-4 w-4" /> Save
            </button>
          </div>
          {result.problems.length > 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {result.problems.length} box{result.problems.length === 1 ? '' : 'es'} on the blank could not be filled:{' '}
              {result.problems.map((problem) => problem.name || 'the form').join(', ')}.
            </p>
          )}
        </div>
      )}

      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Available forms</h3>
          <button
            type="button"
            onClick={load}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
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
              An administrator sets them up in Administration → Forms.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
            {forms.map((form) => (
              <div key={form.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{form.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {(SOURCE_KINDS[form.source] || {}).label || form.source}
                    {form.description ? ` · ${form.description}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => generate(form)}
                  disabled={busyId === form.id}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {busyId === form.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Generate
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


