import React, { useEffect, useState } from 'react';
import { AlertCircle, Download, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { fetchMemberTraining } from '../../services/api';
import { generateForm } from '../../utils/generateForm';
import { loadBundledBlank } from '../../utils/formCatalog';
import { downloadFormPdf, formPdfFileName, openFormPdf } from '../../utils/formExport';
import { resolveReportRange } from '../../utils/reportParameters';
import { toDateKey } from '../../utils/scheduleDate';
import { userLabel } from '../../utils/displayLabel';
import { categoryPairsFrom } from '../../utils/trainingSummary';
import { TRAINING_FLAGS } from '../../utils/training';
import { renderInViewport } from '../../utils/viewportLayer';

const PERIODS = [
  ['this_year', 'This year'],
  ['last_year', 'Last year'],
  ['all', 'All time'],
];

export default function GeneratePdfModal({
  form,
  departmentName = '',
  currentUser,
  subjects = [],
  canPickMembers = false,
  onClose,
}) {
  const [subjectId, setSubjectId] = useState(() => (currentUser ? String(currentUser.id) : ''));
  const [period, setPeriod] = useState('this_year');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    return () => {
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  const handleGenerate = async (e) => {
    e?.preventDefault();
    setGenerating(true);
    setError('');
    setResult(null);

    try {
      const today = toDateKey(new Date());
      const subject = subjects.find((entry) => entry.id === String(subjectId)) || subjects[0] || currentUser || {};
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
        problems: filled.problems || [],
      });
    } catch (failure) {
      setError(failure.message || 'Could not generate this form.');
    } finally {
      setGenerating(false);
    }
  };

  return renderInViewport(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-pdf-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h2 id="generate-pdf-title" className="text-base font-bold text-slate-900 dark:text-white">
                Generate PDF Export
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{form.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleGenerate} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              For
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={!canPickMembers || generating}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-red-500"
              >
                {subjects.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Period
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                disabled={generating}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-red-500"
              >
                {PERIODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            This generated export automatically calculates and inserts training hours, totals, and member credentials onto the state-recognized form template.
          </p>

          {/* Generated Result */}
          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40 animate-fade-in">
              <div className="flex flex-wrap items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-emerald-800 dark:text-emerald-200">
                  {result.fileName}
                </span>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
                <button
                  type="button"
                  onClick={() => downloadFormPdf(result.bytes, result.fileName)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Download className="h-3.5 w-3.5" /> Save
                </button>
              </div>

              {result.problems.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
                  {result.problems.length} box{result.problems.length === 1 ? '' : 'es'} on the blank could not be filled:{' '}
                  {result.problems.map((prob) => prob.name || 'the form').join(', ')}.
                </p>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={generating}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition shadow-sm"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {generating ? 'Generating PDF…' : result ? 'Regenerate PDF' : 'Generate PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

