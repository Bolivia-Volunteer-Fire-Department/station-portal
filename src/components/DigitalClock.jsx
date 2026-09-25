import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatStationTime } from '../utils/timeFormat';

export default function DigitalClock({ timeFormat = '12' }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formattedTime = formatStationTime(time, timeFormat, true);

  const formattedDate = time.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 text-center shadow-xl mb-6">
      <div className="flex items-center justify-center gap-2 text-red-500 font-semibold text-xs tracking-wider uppercase mb-1">
        <Clock className="w-4 h-4" />
        <span>Station Time ({String(timeFormat) === '24' ? '24-HR' : '12-HR EST'})</span>
      </div>
      <div className="text-4xl md:text-5xl font-extrabold text-slate-900 dark:text-white font-mono tracking-tight my-2">
        {formattedTime}
      </div>
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {formattedDate}
      </div>
    </div>
  );
}