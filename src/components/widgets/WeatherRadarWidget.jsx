import React from 'react';
import { CloudRain, ExternalLink, Wind, Thermometer, Compass, Sun } from 'lucide-react';

/**
 * Weather & Radar Widget.
 * Shows active radar link and weather quick view for district coverage.
 */
export default function WeatherRadarWidget({
  radarUrl = 'https://radar.weather.gov',
  stationZip = '',
}) {
  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-5 md:p-6 shadow-xl transition-all">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-semibold text-sm">
          <CloudRain className="w-4 h-4 text-sky-500" />
          <span>District Weather & Radar</span>
        </div>
        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
          NWS Live
        </span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1">
        {/* Radar Graphic Card */}
        <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/80 bg-gradient-to-br from-slate-900 to-sky-950 p-4 text-white shadow-inner mb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-sky-300 font-medium">
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Station District Radar</span>
              </div>
              <div className="text-xl font-bold font-mono tracking-tight text-white">
                Live Doppler
              </div>
            </div>
            <div className="p-2 rounded-full bg-white/10 backdrop-blur-xs">
              <Compass className="w-5 h-5 text-sky-300 animate-spin" style={{ animationDuration: '12s' }} />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[11px] text-sky-200/80 pt-2 border-t border-white/10">
            <span className="flex items-center gap-1">
              <Wind className="w-3 h-3 text-sky-300" />
              <span>NWS Forecast</span>
            </span>
            <a
              href={radarUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 font-semibold text-sky-300 hover:text-white transition"
            >
              <span>View Interactive Radar</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Quick Action Link */}
        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
          <p className="flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <span>Real-time local weather alerts and hazardous storm tracks.</span>
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between">
        <span className="text-[11px] text-slate-400 dark:text-slate-500">NOAA National Weather Service</span>
        <a
          href={radarUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
        >
          <span>Open Full Radar</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

