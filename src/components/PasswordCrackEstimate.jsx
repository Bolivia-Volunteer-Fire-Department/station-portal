import React, { useMemo } from 'react';
import { ShieldAlert, Shield, ShieldCheck } from 'lucide-react';
import { estimatePasswordCrackTime } from '../utils/passwordCrackTime';

export default function PasswordCrackEstimate({ password = '', minTier = 0, className = '' }) {
  const estimate = useMemo(() => estimatePasswordCrackTime(password), [password]);

  if (!password || estimate.charCount === 0) {
    return null;
  }

  const { tier, tierConfig, crackTime, categoryLabel, charCount } = estimate;
  const ShieldIcon = tier <= 2 ? ShieldAlert : tier === 3 ? Shield : ShieldCheck;
  const meetsPolicy = minTier > 0 ? tier >= minTier : true;

  return (
    <div
      className={`mt-2 p-2.5 rounded-xl border text-xs transition-all duration-200 ${tierConfig.bg} ${tierConfig.border} ${className}`}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldIcon className={`w-4 h-4 shrink-0 ${tierConfig.color}`} />
          <span className="text-slate-600 dark:text-slate-300 font-medium">Time to hack:</span>
          <span className={`font-bold tracking-tight ${tierConfig.color}`}>{crackTime}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {minTier > 0 && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${
                meetsPolicy
                  ? 'text-emerald-700 bg-emerald-100/90 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-950/80 dark:border-emerald-800'
                  : 'text-amber-700 bg-amber-100/90 border-amber-300 dark:text-amber-300 dark:bg-amber-950/80 dark:border-amber-800'
              }`}
            >
              {meetsPolicy ? '✓ Meets policy' : 'Below policy'}
            </span>
          )}
          <span
            className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md ${tierConfig.color} bg-white/60 dark:bg-slate-900/60 border border-current/20`}
          >
            {tierConfig.label}
          </span>
        </div>
      </div>

      {/* 5-segment strength bar */}
      <div className="grid grid-cols-5 gap-1 my-2">
        {[1, 2, 3, 4, 5].map((seg) => (
          <div
            key={seg}
            className={`h-1.5 rounded-full transition-colors duration-200 ${
              seg <= tier ? tierConfig.segmentColor : 'bg-slate-200 dark:bg-slate-700/80'
            }`}
          />
        ))}
      </div>

      {/* Composition & benchmark note */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span className="truncate">
          {categoryLabel} <span className="text-slate-400 dark:text-slate-500">•</span> {charCount} char{charCount === 1 ? '' : 's'}
        </span>
        <span className="hidden sm:inline text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
          16× RTX 5090 (bcrypt-10)
        </span>
      </div>
    </div>
  );
}

