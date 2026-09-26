import React, { useEffect, useState } from 'react';
import { HandHelping, AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { playSound, modalSoundFor } from '../utils/uiSounds';

/**
 * Confirmation modal for offering to fill an open shift (My Schedule).
 * Mounted only while an open pill is selected, so state starts fresh each open.
 * `onConfirm` resolves to { success, message } - on success the parent closes
 * this modal and the pill flips to "pending approval".
 */
export default function ShiftOfferModal({ shift, assignment, onClose, onConfirm }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // A positive tone: this is a modal the member opened by pressing the pill. Played once per mount, which is one
  // per open - see MODAL_SOUNDS in utils/uiSounds.
  useEffect(() => {
    playSound(modalSoundFor('shiftOffer'));
  }, []);

  if (!shift) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      const result = await onConfirm();
      if (!result || !result.success) {
        setError(result?.message || 'Unable to submit your offer. Please try again.');
      }
      // On success the parent unmounts this modal
    } catch {
      setError('Unable to reach the scheduling server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const rows = [
    { label: 'Date', value: shift.dateLabel },
    { label: 'Shift', value: shift.label || 'Scheduled' },
    { label: 'Time', value: shift.timeLabel || 'Not specified' },
    {
      label: 'Assignment',
      value: assignment?.description || '—',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn"
      onClick={isSubmitting ? undefined : onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="p-3 bg-amber-500/10 rounded-full shrink-0">
            <HandHelping className="w-7 h-7 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Offer to fill this shift?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              A supervisor still has to approve your offer. Until then the shift stays open to everyone.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 divide-y divide-slate-200 dark:divide-slate-700/70">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">{row.label}</span>
              <span className="text-sm font-medium text-slate-900 dark:text-white text-right truncate">{row.value}</span>
            </div>
          ))}
        </div>

        {shift.approvedNote && (
          <p className="mt-3 flex items-start gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{shift.approvedNote}</span>
          </p>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/20 disabled:opacity-50 transition"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <HandHelping className="w-4 h-4" />}
            {isSubmitting ? 'Submitting...' : 'Offer to fill'}
          </button>
        </div>
      </div>
    </div>
  );
}
