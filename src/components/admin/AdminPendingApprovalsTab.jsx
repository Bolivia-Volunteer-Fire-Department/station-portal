import React, { useEffect, useMemo, useState } from 'react';
import { Check, X, User, Clock, RefreshCw, Filter } from 'lucide-react';
import { adminResolveShiftOffer, adminFetchScheduleOffers } from '../../services/api';
import {
  DEFAULT_OFFER_SORT,
  OFFER_SORT_OPTIONS,
  describeShiftOffer,
  filterAndSortOffers,
  offerFilterOptions,
  pendingOffersOnly,
} from '../../utils/shiftOfferRow';
import { assignmentColor } from '../../utils/assignmentColor';
import RankIcon from '../RankIcon';
import { unnamedLabel } from '../../utils/displayLabel';
// From our own wrapper, not from sonner: it plays the sound for each toast kind and then delegates. Importing
// 'sonner' directly here would silence every toast on this screen (the verifier fails on that import).
import { toast } from '../../utils/toast';

export default function AdminPendingApprovalsTab({ token, offers = [], onOffersChanged, users = [], assignments = [], schedule = [], scheduleTemplates = [], timeFormat = '12', onAdminDataChanged }) {
  const [pendingOffers, setPendingOffers] = useState([]);
  const [resolvingOfferId, setResolvingOfferId] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Filtering and sorting. Ascending by shift date is the default: this is a queue of decisions,
  // and the soonest shift is the one that needs making first.
  const [memberFilter, setMemberFilter] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState('');
  const [sortBy, setSortBy] = useState(DEFAULT_OFFER_SORT);
  
  // Always ensure pendingOffers is treated as an array
  const safeGetPending = () => Array.isArray(pendingOffers) ? pendingOffers : [];
  
  // Lookup functions for display
  const userById = (id) => users.find((u) => String(u.id) === String(id)) || users.find((u) => String(u.user_name) === String(id));
  const userName = (id) => userById(id)?.name || unnamedLabel('member');

  // One described row per offer, built once per data change.
  //
  // The table, the sort and the filters all read this, so describeShiftOffer (which also resolves
  // co-workers) runs once per offer rather than once per use - and the ordering rules get real
  // dates and start times to work with instead of display strings.
  const rows = useMemo(
    () =>
      safeGetPending().map((offer) => ({
        offer,
        shift: describeShiftOffer(offer, {
          schedule,
          scheduleTemplates,
          assignments,
          timeFormat,
          userName,
        }),
        memberId: String(offer.user_id ?? '').trim(),
        memberName: userName(offer.user_id),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingOffers, schedule, scheduleTemplates, assignments, timeFormat, users]
  );

  const filterOptions = useMemo(() => offerFilterOptions(rows), [rows]);

  const visibleRows = useMemo(
    () =>
      filterAndSortOffers(rows, {
        member: memberFilter,
        assignment: assignmentFilter,
        sort: sortBy,
      }),
    [rows, memberFilter, assignmentFilter, sortBy]
  );

  const hasFilters = Boolean(memberFilter || assignmentFilter);
  

  useEffect(() => {
    if (!token) { 
      setPendingOffers([]); 
      return; 
    }
    
    // Only undecided offers belong in this queue - the same rule the backend
    // applies when it derives each offer's status.
    setPendingOffers(pendingOffersOnly(offers));
  }, [offers, token]);

  const handleApprove = async (offer) => {
    if (!token) {
      console.error('No token available for approval');
      toast.error('Authentication required - please refresh the page or check your login status');
      return;
    }
    
    setResolvingOfferId(offer.id);
    try {
      const result = await adminResolveShiftOffer(offer.id, 'APPROVE', token);
      
      // Check for authorization issues - likely need to re-login with admin credentials
      if (result && result.code === 'UNAUTHORIZED') {
        toast.error('You must be logged in as an administrator to approve shift offers. Please try again.');
        console.warn('Unauthorized error received');
        return;
      }
      
      if (result && result.success) { 
        toast.success('Shift offer approved');
        
        // Optionally notify parent of change - but refresh from our own state is primary
        if (onOffersChanged) {
          onOffersChanged();
        }
        
        // Also trigger admin data refresh so the Schedule Management calendar sees changes immediately
        void onAdminDataChanged?.(token);
        
        // Refresh the offers list to get updated data - extract offers array from response
        const refreshResult = await adminFetchScheduleOffers(token);
        if (Array.isArray(refreshResult?.offers)) {
          // The fetch returns every offer; only the undecided ones belong here.
          setPendingOffers(pendingOffersOnly(refreshResult.offers));
          toast.success('List refreshed');
        } else {
          console.warn('Non-array response from adminFetchScheduleOffers:', refreshResult);
        }
      } 
      else { 
        console.error('Approve failed:', result);
        toast.error(result?.message || 'Failed to approve offer'); 
      }
    } catch (err) { 
      console.error('Approve error:', err);
      toast.error('Error approving offer - see console for details');
    } 
    finally { setResolvingOfferId(null); }
  };

  const handleDecline = async (offer) => {
    if (!token) {
      console.error('No token available for decline');
      toast.error('Authentication required - please refresh the page or check your login status');
      return;
    }
    
    setResolvingOfferId(offer.id);
    try {
      const result = await adminResolveShiftOffer(offer.id, 'DECLINE', token);
      
      // Check for authorization issues - likely need to re-login with admin credentials
      if (result && result.code === 'UNAUTHORIZED') {
        toast.error('You must be logged in as an administrator to manage shift offers. Please try again.');
        console.warn('Unauthorized error received');
        return;
      }
      
      if (result && result.success) { 
        toast.success('Shift offer declined');
        
        // Optionally notify parent of change - but refresh from our own state is primary
        if (onOffersChanged) {
          onOffersChanged();
        }
        
        // Also trigger admin data refresh so the Schedule Management calendar sees changes immediately
        void onAdminDataChanged?.(token);
        
        // Refresh the offers list to get updated data - extract offers array from response
        const refreshResult = await adminFetchScheduleOffers(token);
        if (Array.isArray(refreshResult?.offers)) {
          // The fetch returns every offer; only the undecided ones belong here.
          setPendingOffers(pendingOffersOnly(refreshResult.offers));
          toast.success('List refreshed');
        } else {
          console.warn('Non-array response from adminFetchScheduleOffers:', refreshResult);
        }
      } 
      else { 
        console.error('Decline failed:', result);
        toast.error(result?.message || 'Failed to decline offer'); 
      }
    } catch (err) { 
      console.error('Decline error:', err);
      toast.error('Error declining offer - see console for details');
    } 
    finally { setResolvingOfferId(null); }
  };

  const handleRefresh = async () => {
    if (!token) return;
    setIsRefreshing(true);
    try {
      const refreshResult = await adminFetchScheduleOffers(token);
      if (Array.isArray(refreshResult?.offers)) {
        setPendingOffers(pendingOffersOnly(refreshResult.offers));
      } else {
        console.warn('Non-array response from adminFetchScheduleOffers:', refreshResult);
      }
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Failed to refresh pending offers');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-4 p-6 border-b border-slate-200 dark:border-slate-700">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Pending Shift Offers</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Approve or decline the offers members have made on open shifts.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-xl transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters and sort. The selects follow the same style as Clock Management, and the
          options are built from the offers in the queue rather than the whole roster, so a
          filter never lists a member with nothing waiting. */}
      <div className="flex flex-wrap items-end gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
          <Filter className="w-3.5 h-3.5" />
          Filter
        </div>

        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="block mb-1">Member</span>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">All Members</option>
            {filterOptions.members.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="block mb-1">Assignment</span>
          <select
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value)}
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">All Assignments</option>
            {filterOptions.assignments.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-500 dark:text-slate-400">
          <span className="block mb-1">Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {OFFER_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {hasFilters
            ? `${visibleRows.length} of ${rows.length} offer${rows.length === 1 ? '' : 's'}`
            : `${rows.length} offer${rows.length === 1 ? '' : 's'}`}
        </span>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setMemberFilter(''); setAssignmentFilter(''); }}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline underline-offset-2"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Date / Time</th>
              <th className="px-4 py-3">Working With</th>
              <th className="px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700/70">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                  No pending shift offers.
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                  No offers match these filters.
                </td>
              </tr>
            ) : (
              visibleRows.map(({ offer, shift }) => {
                const offerUser = userById(offer.user_id);

                // Date, shift window, assignment and co-workers come from the row built above
                // (utils/shiftOfferRow), which resolves template-vs-row times the same way the
                // schedule calendar does. The previous inline logic showed no date (it fed a raw
                // ISO value to displayDate), put the assignment where the time belonged, and
                // repeated the assignment under "Working With".

                return (
                  <tr key={offer.id} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                    <td className="px-4 py-4 whitespace-nowrap align-top">
                      <div className="flex items-center space-x-2">
                        <User className="w-4 h-4 text-slate-500" />
                        <span className="font-medium">{userName(offer.user_id) || offerUser?.name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      <div className="text-slate-900 dark:text-white">{shift.dateLabel}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {shift.timeLabel || 'Time not set'}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 text-xs">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: assignmentColor(shift.assignmentId, assignments) }}
                        />
                        {shift.assignmentIcon && (
                          <span
                            className="shrink-0"
                            style={{ color: assignmentColor(shift.assignmentId, assignments) }}
                            title={shift.assignmentIcon}
                          >
                            <RankIcon name={shift.assignmentIcon} className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span className="text-slate-500 dark:text-slate-400">
                          {shift.assignmentName || 'No assignment'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top">
                      {shift.coworkers.length ? (
                        <ul className="flex flex-col gap-1 list-disc list-inside marker:text-slate-400 dark:marker:text-slate-500">
                          {shift.coworkers.map((coworker) => (
                            <li key={coworker.userId} className="text-slate-700 dark:text-slate-200">
                              {coworker.name}
                              {coworker.assignmentName && (
                                <span className="text-slate-500 dark:text-slate-400"> ({coworker.assignmentName})</span>
                              )}
                              {coworker.timeLabel && (
                                <span className="text-slate-500 dark:text-slate-400"> {coworker.timeLabel}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">No one else scheduled</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-center space-x-2 align-top">
                      {!resolvingOfferId || resolvingOfferId !== offer.id ? (
                        <>
                          <button type="button" onClick={() => handleApprove(offer)} className="text-success-600 hover:text-success-500 mr-2" title="Approve">
                            <Check className="w-4 h-4 inline" />
                          </button>
                          <button type="button" onClick={() => handleDecline(offer)} className="text-destructive hover:text-destructive/80" title="Decline">
                            <X className="w-4 h-4 inline" />
                          </button>
                        </>
                      ) : (
                        <span className="text-muted hover:text-muted/80" title="Processing...">
                          <Clock className="w-4 h-4 animate-spin inline" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

