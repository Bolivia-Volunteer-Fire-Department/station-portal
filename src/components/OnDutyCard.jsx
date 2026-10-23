import React, { useState, useEffect, useMemo } from 'react';
import { Users, User, CalendarCheck, Clock } from 'lucide-react';
import RankIcon from './RankIcon';
import MemberName from './MemberName';
import { parseSheetDateKey, stationTodayKey, dateKeyDaysBack } from '../utils/scheduleDate';
import { monthKeyFor, scheduleWindowFor, windowCoversMonth } from '../utils/scheduleWindow';
import { formatClockRange, rowTimeText, templateTimeText, timeToMinutes } from '../utils/shiftTime';
import { parseRankOrder } from '../utils/rankEligibility';
import { compareCrewOrder } from '../utils/crewOrder';
import { getUser } from '../utils/userCache';
import { certificationBadgesLoaded, mergeCertificationBadges } from '../utils/certifications';
import { fetchCertificationBadges } from '../services/api';

function stationMinutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return (hour % 24) * 60 + minute;
}

function isShiftActiveNow({ from, to, startMin, endMin, todayKey, yesterdayKey, nowMin }) {
  if (!from) return false;
  const endDay = to || from;

  // All-day / untimed shift
  if (startMin === null || endMin === null) {
    return from <= todayKey && todayKey <= endDay;
  }

  // Same-day time window (e.g. 08:00 - 18:00)
  if (startMin < endMin) {
    if (from === endDay) {
      return from === todayKey && nowMin >= startMin && nowMin < endMin;
    }
    if (from <= todayKey && todayKey <= endDay) {
      if (todayKey === from) return nowMin >= startMin;
      if (todayKey === endDay) return nowMin < endMin;
      return true;
    }
    return false;
  }

  // Overnight or 24-hour window (endMin <= startMin, e.g. 20:00 - 04:00 or 08:00 - 08:00)
  if (from === endDay) {
    if (from === todayKey) return nowMin >= startMin;
    if (from === yesterdayKey) return nowMin < endMin;
    return false;
  }

  if (todayKey === from) return nowMin >= startMin;
  if (todayKey === endDay) return nowMin < endMin;
  return from < todayKey && todayKey < endDay;
}

export default function OnDutyCard({
  onDutyUsers = [],
  ranks = [],
  schedule = [],
  scheduleWindow = null,
  onNeedSchedule = null,
  scheduleTemplates = [],
  assignments = [],
  users = [],
  currentUser = null,
  timeFormat = '12',
  token = '',
  groupBySchedule = true,
  title = 'Currently On Duty',
  subtitle = '',
}) {
  const [now, setNow] = useState(() => new Date());
  const [resolvedUsers, setResolvedUsers] = useState({});

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Ensure the current month's schedule window is loaded when schedule grouping is enabled
  useEffect(() => {
    if (!groupBySchedule || !onNeedSchedule) return;
    const currentMonthKey = monthKeyFor(new Date());
    if (!windowCoversMonth(scheduleWindow, currentMonthKey)) {
      const win = scheduleWindowFor(new Date());
      void Promise.resolve(onNeedSchedule(win.from, win.to));
    }
  }, [groupBySchedule, onNeedSchedule, scheduleWindow]);

  const rankFor = (rankId) => ranks.find((r) => String(r.id) === String(rankId));

  const templateMap = useMemo(
    () => new Map((scheduleTemplates || []).map((t) => [String(t.id), t])),
    [scheduleTemplates]
  );

  const assignmentMap = useMemo(
    () => new Map((assignments || []).map((a) => [String(a.id), a])),
    [assignments]
  );

  // Known user profiles by ID (from onDutyUsers, directory/roster, currentUser, or cached single-doc reads)
  const knownUsersById = useMemo(() => {
    const map = new Map();
    Object.entries(resolvedUsers).forEach(([id, u]) => {
      if (id && u) map.set(String(id), u);
    });
    (Array.isArray(users) ? users : []).forEach((u) => {
      const id = String(u?.id ?? u?.user_id ?? '').trim();
      if (id) map.set(id, { ...map.get(id), ...u, id });
    });
    if (currentUser?.id) {
      const myId = String(currentUser.id).trim();
      map.set(myId, { ...map.get(myId), ...currentUser, id: myId });
    }
    (Array.isArray(onDutyUsers) ? onDutyUsers : []).forEach((u) => {
      const id = String(u?.id ?? u?.user_id ?? '').trim();
      if (id) map.set(id, { ...map.get(id), ...u, id });
    });
    return map;
  }, [resolvedUsers, users, currentUser, onDutyUsers]);

  const clockedInUserIds = useMemo(() => {
    const set = new Set();
    (Array.isArray(onDutyUsers) ? onDutyUsers : []).forEach((u) => {
      const id = String(u?.id ?? u?.user_id ?? '').trim();
      if (id) set.add(id);
    });
    return set;
  }, [onDutyUsers]);

  const todayKey = stationTodayKey(now);
  const yesterdayKey = dateKeyDaysBack(1, todayKey);
  const nowMin = stationMinutesNow(now);

  // Compute active scheduled shifts for the current time
  const activeScheduledEntries = useMemo(() => {
    if (!groupBySchedule || !Array.isArray(schedule)) return [];

    const byUser = new Map();

    schedule.forEach((row) => {
      const userId = String(row?.user_id ?? row?.userId ?? '').trim();
      if (!userId) return;

      const from = parseSheetDateKey(row?.date_from || row?.date || row?._from) || '';
      const to = parseSheetDateKey(row?.date_to || row?.date_from || row?.date || row?._from) || from;
      if (!from) return;

      const template = row?.schedule_template_id
        ? templateMap.get(String(row.schedule_template_id))
        : null;
      const startMin = timeToMinutes(template ? template.start_time : row?.start_time);
      const endMin = timeToMinutes(template ? template.end_time : row?.end_time);

      if (
        !isShiftActiveNow({
          from,
          to,
          startMin,
          endMin,
          todayKey,
          yesterdayKey,
          nowMin,
        })
      ) {
        return;
      }

      const assignmentId = String(row?.assignment_id || template?.assignment_id || '').trim();
      const assignment = assignmentId ? assignmentMap.get(assignmentId) : null;
      const assignmentLabel =
        assignment?.description ||
        assignment?.name ||
        String(row?.apparatus_id || template?.apparatus_id || '').trim() ||
        '';
      const rawTimeRange = rowTimeText(row) || (template ? templateTimeText(template) : '');
      const formattedRange = formatClockRange(rawTimeRange, timeFormat);
      const userProfile = knownUsersById.get(userId) || { id: userId, user_id: userId, name: '' };

      const entry = {
        userId,
        user: userProfile,
        isClockedIn: clockedInUserIds.has(userId),
        assignmentLabel,
        shiftTimeLabel: formattedRange || template?.nickname || '',
        startMin,
        isOpen: false,
        requiredRankOrder: parseRankOrder(assignment?.rank_order_required),
        name: userProfile?.name || '',
      };

      if (!byUser.has(userId)) {
        byUser.set(userId, entry);
      }
    });

    return [...byUser.values()].sort(compareCrewOrder);
  }, [
    groupBySchedule,
    schedule,
    templateMap,
    assignmentMap,
    todayKey,
    yesterdayKey,
    nowMin,
    timeFormat,
    knownUsersById,
    clockedInUserIds,
  ]);

  const scheduledUserIds = useMemo(
    () => activeScheduledEntries.map((entry) => entry.userId),
    [activeScheduledEntries]
  );

  // Fetch user profile for any scheduled member not yet in knownUsersById
  const missingScheduledUserIds = useMemo(
    () =>
      scheduledUserIds.filter((uid) => {
        const known = knownUsersById.get(uid);
        return !known || !known.name;
      }),
    [scheduledUserIds, knownUsersById]
  );

  useEffect(() => {
    if (!groupBySchedule || missingScheduledUserIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      missingScheduledUserIds.map(async (uid) => {
        const data = await getUser(uid);
        return data ? [uid, { ...data, id: uid }] : null;
      })
    ).then((entries) => {
      if (cancelled) return;
      const valid = entries.filter(Boolean);
      if (valid.length === 0) return;
      setResolvedUsers((prev) => {
        const next = { ...prev };
        valid.forEach(([uid, profile]) => {
          next[uid] = profile;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [groupBySchedule, missingScheduledUserIds]);

  // Ensure certification badges are loaded for scheduled members as well
  useEffect(() => {
    if (!groupBySchedule || !token || scheduledUserIds.length === 0) return;
    const wanted = scheduledUserIds.filter((id) => !certificationBadgesLoaded(id));
    if (wanted.length === 0) return;
    let cancelled = false;
    fetchCertificationBadges(wanted, token)
      .then((data) => {
        if (cancelled || !data?.success) return;
        const badges = { ...(data.badges || {}) };
        (data.asked || wanted).forEach((id) => {
          if (!badges[id]) badges[id] = [];
        });
        mergeCertificationBadges(badges);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupBySchedule, token, scheduledUserIds]);

  const scheduledIdSet = useMemo(() => new Set(scheduledUserIds), [scheduledUserIds]);

  // Additional clocked-in personnel who are not on the current schedule
  const additionalClockedInUsers = useMemo(() => {
    if (!groupBySchedule) return onDutyUsers;
    return (Array.isArray(onDutyUsers) ? onDutyUsers : []).filter((u) => {
      const id = String(u?.id ?? u?.user_id ?? '').trim();
      return id && !scheduledIdSet.has(id);
    });
  }, [groupBySchedule, onDutyUsers, scheduledIdSet]);

  const renderUserPill = (user, { highlightGreen = false, shiftBadge = '' } = {}) => {
    const rank = rankFor(user?.rank_id);
    return (
      <div
        key={user.id || user.user_id}
        className={`flex items-center gap-3 p-3 rounded-xl transition ${
          highlightGreen
            ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-2 border-emerald-500 dark:border-emerald-400 shadow-xs'
            : 'bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/50 shadow-xs'
        }`}
      >
        <div
          className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg shrink-0"
          style={{ color: rank?.color || undefined }}
        >
          {rank ? (
            <RankIcon name={rank.icon} className="w-5 h-5" />
          ) : (
            <User className="w-5 h-5 text-slate-500 dark:text-slate-300" />
          )}
        </div>
        <div className="overflow-hidden min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
              <MemberName user={user} nameClassName="truncate" />
            </p>
          </div>
          {rank && (
            <p className="text-xs truncate font-medium" style={{ color: rank.color || undefined }}>
              {rank.description}
            </p>
          )}
          {shiftBadge && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {shiftBadge}
            </p>
          )}
        </div>
      </div>
    );
  };

  const totalDisplayedCount = groupBySchedule
    ? activeScheduledEntries.length + additionalClockedInUsers.length
    : onDutyUsers.length;

  const displaySubtitle =
    subtitle ||
    (groupBySchedule
      ? 'Scheduled crew & active personnel on the clock'
      : 'Active personnel currently on the clock');

  return (
    <div className="h-full max-h-[500px] flex flex-col justify-between overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-5 md:p-6 shadow-xl transition-all">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-700/60 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold shrink-0">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {title || 'Currently On Duty'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {displaySubtitle}
            </p>
          </div>
        </div>

        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {onDutyUsers.length}
        </span>
      </div>

      {/* Content */}
      <div className="overflow-y-auto min-h-0 flex-1 pr-1">
        {!groupBySchedule ? (
          onDutyUsers.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-1 opacity-70" />
              <p className="font-semibold text-slate-700 dark:text-slate-300">No personnel clocked in</p>
              <p className="text-[11px]">Staff will appear here when they clock in.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {onDutyUsers.map((user) => renderUserPill(user))}
            </div>
          )
        ) : totalDisplayedCount === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-1 opacity-70" />
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              No personnel scheduled or clocked in right now
            </p>
            <p className="text-[11px]">
              Scheduled shift crew and clocked-in members will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Group 1: Scheduled for Current Time */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <CalendarCheck className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <span>Scheduled for Current Shift</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {activeScheduledEntries.length} scheduled
                </span>
              </div>

              {activeScheduledEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700/70 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                  No members scheduled for the current time window.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeScheduledEntries.map((entry) => {
                    const badgeParts = [entry.assignmentLabel, entry.shiftTimeLabel].filter(Boolean);
                    return renderUserPill(entry.user, {
                      highlightGreen: entry.isClockedIn,
                      shiftBadge: badgeParts.join(' • '),
                    });
                  })}
                </div>
              )}
            </div>

            {/* Group 2: Additional Clocked-In Personnel */}
            {additionalClockedInUsers.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-slate-200/80 dark:border-slate-700/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>Additional Personnel Clocked In</span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                    {additionalClockedInUsers.length} clocked in
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {additionalClockedInUsers.map((user) => renderUserPill(user))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 pt-3 mt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
        <span className="text-[11px] text-slate-400">
          {groupBySchedule
            ? `${activeScheduledEntries.length} scheduled • ${onDutyUsers.length} clocked in`
            : `${onDutyUsers.length} member${onDutyUsers.length === 1 ? '' : 's'} on duty`}
        </span>
      </div>
    </div>
  );
}
