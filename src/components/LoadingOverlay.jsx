import React from 'react';
import { Loader2, Shield } from 'lucide-react';

export default function LoadingOverlay({ isLoading, message = 'Communicating with server...' }) {
  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-300 animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 md:p-8 shadow-2xl flex flex-col items-center max-w-sm w-full mx-4 text-center">
        <div className="relative mb-4 flex items-center justify-center">
          {/* Pulsing Outer Glow */}
          <div className="absolute inset-0 rounded-full bg-red-600/20 blur-xl animate-pulse" />
          
          {/* Animated Spinner */}
          <Loader2 className="w-12 h-12 text-red-500 animate-spin relative z-10" />
          
          {/* Subtle Center Icon */}
          <Shield className="w-5 h-5 text-slate-400 absolute z-10" />
        </div>

        <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Please Wait</h4>
        <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
      </div>
    </div>
  );
}