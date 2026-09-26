import React, { useState } from 'react';
import { Shield, AlertCircle, CheckCircle } from 'lucide-react';
import { stationLogoUrl } from '../utils/assets';
import AnnouncementList from './AnnouncementList';

export default function LoginScreen({ onLogin, statusMessage, departmentName, announcements = [] }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-3">
            <img src={stationLogoUrl()} alt="Bolivia Fire Department Logo" className="w-20 h-20" />
            {/* <Shield className="w-10 h-10 text-red-500" /> */}
          </div>
          <h1 className="text-2xl font-bold tracking-wide text-slate-900 dark:text-white">{departmentName || 'Station'}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Please login to continue</p>
        </div>

        {/* Announcements for the login screen sit directly beneath the prompt. Only the ones aimed at
            everyone can arrive here - there is no signed-in reader to target. */}
        {announcements.length > 0 && (
          <div className="mb-6">
            <AnnouncementList announcements={announcements} location="is_visible_on_login" />
          </div>
        )}

        {statusMessage.text && (
          <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
            statusMessage.type === 'error'
              ? 'bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200'
              : 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/80 dark:border-emerald-800 dark:text-emerald-200'
          }`}>
            {statusMessage.type === 'error' ? <AlertCircle className="w-5 h-5 shrink-0" /> : <CheckCircle className="w-5 h-5 shrink-0" />}
            <p className="text-sm font-medium">{statusMessage.text}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Username</label>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">Password</label>
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-3 px-4 rounded-xl transition shadow-lg shadow-red-600/20"
          >
            Sign In
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">v1.05</span>
        </form>
      </div>
    </div>
  );
}