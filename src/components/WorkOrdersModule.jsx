import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Wrench,
  Plus,
  Search,
  AlertTriangle,
  Truck,
  ShieldAlert,
  Building2,
  Paperclip,
  Eye,
  FileUp,
  X,
  Loader2,
  Send,
  MessageSquare,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  saveWorkOrder,
  fetchWorkOrders,
  fetchApparatus,
  fetchEquipment,
} from '../services/api';
import {
  WORK_ORDER_STATUSES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_CATEGORIES,
  getStatusMeta,
  getPriorityMeta,
  getCategoryMeta,
  isActiveWorkOrder,
  generateWorkOrderTicketNumber,
  normalizeWorkOrder,
  findPotentialDuplicates,
} from '../utils/workOrders';
import {
  uploadWorkOrderFile,
  openWorkOrderFile,
} from '../services/workOrderFileStorage';
import ConfirmModal from './ConfirmModal';
import ViewportModal from './ViewportModal';

const SUBMIT_MODAL_FORM_ID = 'member-work-order-form';

export default function WorkOrdersModule({
  token,
  currentUserId = '',
  currentUser = null,
  currentUserName: currentUserNameProp = '',
  canManageWorkOrders = false,
  onNavigateToAdmin = null,
  onChanged = null,
}) {
  const [noticeModal, setNoticeModal] = useState(null);

  const currentUserName = useMemo(() => {
    return (
      currentUserNameProp ||
      currentUser?.name ||
      currentUser?.full_name ||
      currentUser?.user_name ||
      'Member'
    );
  }, [currentUserNameProp, currentUser]);

  const [workOrdersList, setWorkOrdersList] = useState([]);
  const [apparatusList, setApparatusList] = useState([]);
  const [equipmentList, setEquipmentList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Active view tab: 'my' (My Submissions) or 'all' (All Station Tickets)
  const [viewTab, setViewTab] = useState('my');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Submit modal state
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Detail modal state
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketNoteText, setTicketNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'apparatus',
    priority: 'medium',
    apparatus_id: '',
    apparatus_name: '',
    equipment_id: '',
    equipment_name: '',
    station_location: '',
    files: [],
  });

  // Load work orders & assets
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [woRes, appRes, eqRes] = await Promise.all([
        fetchWorkOrders(token).catch(() => null),
        fetchApparatus(token).catch(() => null),
        fetchEquipment(token).catch(() => null),
      ]);

      if (woRes?.workOrders) {
        setWorkOrdersList(woRes.workOrders.map((wo) => normalizeWorkOrder(wo, currentUser)));
      }
      if (appRes?.apparatus) {
        setApparatusList(appRes.apparatus);
      }
      if (eqRes?.equipment) {
        setEquipmentList(eqRes.equipment);
      }
    } catch (err) {
      console.warn('Failed to load work orders:', err);
    } finally {
      setLoading(false);
    }
  }, [token, currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    await loadData();
    onChanged?.();
  };

  // Open submit form
  const handleOpenSubmit = () => {
    setFormData({
      title: '',
      description: '',
      category: 'apparatus',
      priority: 'medium',
      apparatus_id: '',
      apparatus_name: '',
      equipment_id: '',
      equipment_name: '',
      station_location: '',
      files: [],
    });
    setIsSubmitModalOpen(true);
  };

  // Upload file handler
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploadingFiles(true);
    setUploadProgress(0);

    const workOrderId = 'draft_' + Date.now();
    try {
      const uploaded = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await uploadWorkOrderFile({
          workOrderId,
          file,
          onProgress: (p) => setUploadProgress(Math.round(((i + p) / files.length) * 100)),
        });
        uploaded.push(res);
      }
      setFormData((prev) => ({
        ...prev,
        files: [...(prev.files || []), ...uploaded],
      }));
    } catch (err) {
      console.error('File upload error:', err);
      setNoticeModal({
        title: 'Upload Failed',
        message: 'Could not upload file: ' + (err?.message || ''),
        tone: 'danger',
      });
    } finally {
      setUploadingFiles(false);
      setUploadProgress(0);
      e.target.value = '';
    }
  };

  const handleRemoveFile = (index) => {
    setFormData((prev) => ({
      ...prev,
      files: (prev.files || []).filter((_, i) => i !== index),
    }));
  };

  // Submit ticket
  const handleSubmitTicket = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.title.trim()) {
      setNoticeModal({
        title: 'Title Required',
        message: 'Please provide a title for the issue.',
        tone: 'danger',
      });
      return;
    }

    setSubmitting(true);
    try {
      const ticketNumber = generateWorkOrderTicketNumber();
      const now = new Date().toISOString();

      const newWorkOrder = normalizeWorkOrder(
        {
          ticket_number: ticketNumber,
          title: formData.title.trim(),
          description: formData.description.trim(),
          category: formData.category,
          priority: formData.priority,
          status: 'pending',
          apparatus_id: formData.apparatus_id,
          apparatus_name: formData.apparatus_name,
          equipment_id: formData.equipment_id,
          equipment_name: formData.equipment_name,
          station_location: formData.station_location,
          submitted_by_id: currentUserId,
          submitted_by_name: currentUserName,
          submitted_at: now,
          updated_at: now,
          updated_by: currentUserId,
          files: formData.files || [],
          notes: [],
        },
        currentUser
      );

      const res = await saveWorkOrder(newWorkOrder, token);
      const savedId = res?.id || newWorkOrder.id;
      const finalWorkOrder = { ...newWorkOrder, id: savedId };

      setWorkOrdersList((prev) => [finalWorkOrder, ...prev]);
      setIsSubmitModalOpen(false);
      setViewTab('my');
    } catch (err) {
      console.error('Failed to submit work order:', err);
      setNoticeModal({
        title: 'Submission Failed',
        message: 'Failed to submit work order: ' + (err?.message || ''),
        tone: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Add comment / note to existing ticket
  const handleAddTicketNote = async () => {
    if (!ticketNoteText.trim() || !selectedTicket) return;
    setAddingNote(true);

    const newNote = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}`,
      text: ticketNoteText.trim(),
      author_id: currentUserId,
      author_name: currentUserName,
      created_at: new Date().toISOString(),
    };

    const updated = {
      ...selectedTicket,
      notes: [...(selectedTicket.notes || []), newNote],
      updated_at: new Date().toISOString(),
      updated_by: currentUserId,
    };

    try {
      await saveWorkOrder(updated, token);
      setSelectedTicket(updated);
      setWorkOrdersList((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setTicketNoteText('');
    } catch (err) {
      console.error('Failed to add note:', err);
      setNoticeModal({
        title: 'Note Failed',
        message: 'Could not save note.',
        tone: 'danger',
      });
    } finally {
      setAddingNote(false);
    }
  };

  // Filter lists
  const myWorkOrders = useMemo(() => {
    return workOrdersList.filter((wo) => String(wo.submitted_by_id) === String(currentUserId));
  }, [workOrdersList, currentUserId]);

  const activeStationWorkOrders = useMemo(() => {
    return workOrdersList.filter(isActiveWorkOrder);
  }, [workOrdersList]);

  // Real-time similarity search for potential duplicate work orders while writing a ticket
  const potentialDuplicates = useMemo(() => {
    if (!isSubmitModalOpen) return [];
    return findPotentialDuplicates(formData, workOrdersList);
  }, [isSubmitModalOpen, formData, workOrdersList]);

  const displayedWorkOrders = useMemo(() => {
    const baseList = viewTab === 'my' ? myWorkOrders : workOrdersList;

    return baseList.filter((wo) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          String(wo.ticket_number || '').toLowerCase().includes(q) ||
          String(wo.title || '').toLowerCase().includes(q) ||
          String(wo.description || '').toLowerCase().includes(q) ||
          String(wo.apparatus_name || '').toLowerCase().includes(q) ||
          String(wo.equipment_name || '').toLowerCase().includes(q) ||
          String(wo.station_location || '').toLowerCase().includes(q);
        if (!matches) return false;
      }

      if (categoryFilter !== 'all' && String(wo.category).toLowerCase() !== categoryFilter) {
        return false;
      }

      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !isActiveWorkOrder(wo)) return false;
        if (statusFilter !== 'active' && String(wo.status).toLowerCase() !== statusFilter) return false;
      }

      return true;
    });
  }, [viewTab, myWorkOrders, workOrdersList, searchQuery, categoryFilter, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Wrench className="w-7 h-7 text-red-600" />
            Work Orders
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Submit maintenance and repair requests for apparatus, equipment, or station facilities.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition disabled:opacity-50"
            title="Refresh tickets"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {canManageWorkOrders && onNavigateToAdmin && (
            <button
              type="button"
              onClick={onNavigateToAdmin}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
            >
              <Wrench className="w-3.5 h-3.5 text-red-500" />
              Manage in Administration
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-700 transition"
          >
            <Plus className="w-4 h-4" />
            Submit Work Order
          </button>
        </div>
      </div>

      {/* Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* View Switcher: My Submissions vs All Station Tickets */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl max-w-fit">
          <button
            type="button"
            onClick={() => setViewTab('my')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition ${
              viewTab === 'my'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            My Submissions ({myWorkOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('all')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition ${
              viewTab === 'all'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            All Station Tickets ({activeStationWorkOrders.length} Open)
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tickets..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Categories</option>
            {WORK_ORDER_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active / Open</option>
            {WORK_ORDER_STATUSES.map((st) => (
              <option key={st.value} value={st.value}>
                {st.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ticket List Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-red-600 mb-2" />
          <p className="text-sm">Loading tickets...</p>
        </div>
      ) : displayedWorkOrders.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <Wrench className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            {viewTab === 'my' ? "You haven't submitted any work orders" : 'No tickets match your filters'}
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            {viewTab === 'my'
              ? 'Notice an issue with an apparatus, piece of gear, or station facility? Submit a work order ticket.'
              : 'Try clearing your search query or changing category and status filters.'}
          </p>
          {viewTab === 'my' && (
            <button
              type="button"
              onClick={handleOpenSubmit}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white shadow-sm hover:bg-red-700 transition"
            >
              <Plus className="w-4 h-4" />
              Submit First Work Order
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayedWorkOrders.map((wo) => {
            const statusMeta = getStatusMeta(wo.status);
            const priorityMeta = getPriorityMeta(wo.priority);
            const categoryMeta = getCategoryMeta(wo.category);

            return (
              <div
                key={wo.id}
                onClick={() => setSelectedTicket(wo)}
                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  {/* Top line badges */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-700/60 px-2 py-0.5 rounded">
                      {wo.ticket_number}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {/* Priority */}
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                          priorityMeta.value === 'urgent'
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-400'
                            : priorityMeta.value === 'high'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {priorityMeta.label}
                      </span>

                      {/* Status */}
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          statusMeta.value === 'complete'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : statusMeta.value === 'in_progress'
                              ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-400'
                              : statusMeta.value === 'scheduled'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400'
                                : statusMeta.value === 'on_hold'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-400'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                        }`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-1">
                      {wo.title}
                    </h3>
                    {wo.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                        {wo.description}
                      </p>
                    )}
                  </div>

                  {/* Target Asset Detail */}
                  <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                    <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 font-medium bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                      {wo.category === 'apparatus' && <Truck className="w-3 h-3 text-red-500" />}
                      {wo.category === 'equipment' && <ShieldAlert className="w-3 h-3 text-amber-500" />}
                      {wo.category === 'station' && <Building2 className="w-3 h-3 text-blue-500" />}
                      {categoryMeta.label}
                    </span>

                    {wo.category === 'apparatus' && wo.apparatus_name && (
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        {wo.apparatus_name}
                      </span>
                    )}

                    {wo.category === 'equipment' && wo.equipment_name && (
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        {wo.equipment_name}
                      </span>
                    )}

                    {wo.category === 'station' && wo.station_location && (
                      <span className="text-slate-700 dark:text-slate-300 font-medium">
                        {wo.station_location}
                      </span>
                    )}
                  </div>
                </div>

                {/* Card Footer: Submitter / Assignee / Files */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-400">
                  <div>
                    <span>Submitted {new Date(wo.submitted_at).toLocaleDateString()}</span>
                    {viewTab === 'all' && (
                      <span className="ml-1 text-slate-600 dark:text-slate-300">by {wo.submitted_by_name}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    {wo.assigned_to_name && (
                      <span className="text-blue-600 dark:text-blue-400 font-medium">
                        Assigned: {wo.assigned_to_name}
                      </span>
                    )}

                    {wo.files && wo.files.length > 0 && (
                      <span className="flex items-center gap-0.5 text-slate-500">
                        <Paperclip className="w-3 h-3" />
                        {wo.files.length}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ticket Submission Modal */}
      {isSubmitModalOpen && (
        <ViewportModal
          onClose={() => setIsSubmitModalOpen(false)}
          title="Submit Work Order"
          formId={SUBMIT_MODAL_FORM_ID}
          saveLabel="Submit Work Order"
          saving={submitting}
          busy={submitting || uploadingFiles}
          busyLabel="Submitting…"
        >
          <form id={SUBMIT_MODAL_FORM_ID} onSubmit={handleSubmitTicket} className="space-y-5">
            {/* Category & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Category *
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => {
                    const c = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      category: c,
                      apparatus_id: c === 'apparatus' ? prev.apparatus_id : '',
                      apparatus_name: c === 'apparatus' ? prev.apparatus_name : '',
                      equipment_id: c === 'equipment' ? prev.equipment_id : '',
                      equipment_name: c === 'equipment' ? prev.equipment_name : '',
                      station_location: c === 'station' ? prev.station_location : '',
                    }));
                  }}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                >
                  {WORK_ORDER_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Priority
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData((prev) => ({ ...prev, priority: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                >
                  {WORK_ORDER_PRIORITIES.map((pr) => (
                    <option key={pr.value} value={pr.value}>
                      {pr.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Priority Level Guide */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300 mb-2">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>Priority Level Key</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 dark:text-slate-400">
                {WORK_ORDER_PRIORITIES.map((p) => (
                  <div key={p.value} className="flex items-start gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${p.badgeClass}`}>
                      {p.label}
                    </span>
                    <span className="text-[11px] leading-tight">
                      {p.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Target Asset selection */}
            {formData.category === 'apparatus' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Apparatus *
                </label>
                <select
                  required
                  value={formData.apparatus_id}
                  onChange={(e) => {
                    const aid = e.target.value;
                    const app = apparatusList.find((a) => String(a.id) === String(aid));
                    setFormData((prev) => ({
                      ...prev,
                      apparatus_id: aid,
                      apparatus_name: app ? `${app.identifier || ''} - ${app.description || app.type || ''}`.trim() : '',
                    }));
                  }}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select vehicle / apparatus...</option>
                  {apparatusList.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.identifier} {app.description ? `(${app.description})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {formData.category === 'equipment' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Equipment / Gear Item *
                </label>
                <select
                  required
                  value={formData.equipment_id}
                  onChange={(e) => {
                    const eid = e.target.value;
                    const eq = equipmentList.find((item) => String(item.id) === String(eid));
                    setFormData((prev) => ({
                      ...prev,
                      equipment_id: eid,
                      equipment_name: eq
                        ? `${eq.identifier || eq.serial_number || ''} (${eq.type || eq.category || ''})`.trim()
                        : '',
                    }));
                  }}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">Select equipment item...</option>
                  {equipmentList.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.identifier ? `[${eq.identifier}] ` : ''}
                      {eq.make_model || eq.type || eq.category} (S/N: {eq.serial_number || 'N/A'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {formData.category === 'station' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Station Location / Room *
                </label>
                <input
                  type="text"
                  required
                  value={formData.station_location}
                  onChange={(e) => setFormData((prev) => ({ ...prev, station_location: e.target.value }))}
                  placeholder="e.g. Apparatus Bay 1, Kitchen, Bunk Room 3, Front Entry"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            )}

            {/* Title / Summary */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Issue Summary / Title *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Brief summary of what is broken or needed"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Detailed Description
              </label>
              <textarea
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Provide as much context as possible (symptoms, when it occurred, how to reproduce)..."
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            {/* Potential Duplicate Warning */}
            {potentialDuplicates.length > 0 && (
              <div className="p-3.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Possible Duplicate Work Orders Found ({potentialDuplicates.length})
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                      An active ticket may already cover this issue. Please check to avoid submitting duplicates:
                    </p>
                    <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {potentialDuplicates.map(({ workOrder: dup, reasons }) => (
                        <div
                          key={dup.id}
                          className="p-2 bg-white/90 dark:bg-slate-900/90 rounded-lg border border-amber-200/70 dark:border-amber-900/60 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-white truncate">
                              {dup.ticket_number ? `${dup.ticket_number} - ` : ''}{dup.title}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 shrink-0">
                              {dup.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap gap-x-2">
                            <span className="text-amber-800 dark:text-amber-300">Matches: {reasons.join(', ')}</span>
                            {dup.submitted_at && <span>Submitted {new Date(dup.submitted_at).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* File Uploads */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Photos & Attachments (Optional)
                </label>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition">
                  <FileUp className="w-3.5 h-3.5" />
                  Attach Photos / Files
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {uploadingFiles && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-200 dark:border-red-900 flex items-center gap-3">
                  <Loader2 className="w-4 h-4 animate-spin text-red-600 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-red-800 dark:text-red-300">Uploading attachments...</p>
                    <div className="w-full h-1.5 bg-red-200 dark:bg-red-900 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                </div>
              )}

              {formData.files && formData.files.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {formData.files.map((file, idx) => (
                    <div
                      key={file.fileId || idx}
                      className="flex items-center justify-between p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{file.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        className="p-1 rounded text-slate-400 hover:text-red-600"
                        title="Remove file"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Ticket Details & Discussion Modal */}
      {selectedTicket && (
        <ViewportModal
          onClose={() => setSelectedTicket(null)}
          title={`Ticket ${selectedTicket.ticket_number}`}
          readOnly
        >
          <div className="space-y-6">
            {/* Header badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg">
                {selectedTicket.ticket_number}
              </span>

              {/* Status */}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  getStatusMeta(selectedTicket.status).value === 'complete'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400'
                    : getStatusMeta(selectedTicket.status).value === 'in_progress'
                      ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-400'
                      : getStatusMeta(selectedTicket.status).value === 'scheduled'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400'
                        : getStatusMeta(selectedTicket.status).value === 'on_hold'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-400'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {getStatusMeta(selectedTicket.status).label}
              </span>

              {/* Priority */}
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded ${
                  getPriorityMeta(selectedTicket.priority).value === 'urgent'
                    ? 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-400'
                    : getPriorityMeta(selectedTicket.priority).value === 'high'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}
              >
                {getPriorityMeta(selectedTicket.priority).label}
              </span>

              {/* Category */}
              <span className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                {getCategoryMeta(selectedTicket.category).label}
              </span>
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {selectedTicket.title}
              </h3>
              {selectedTicket.description && (
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  {selectedTicket.description}
                </p>
              )}
            </div>

            {/* Meta details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-900/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-slate-400">Submitted by:</span>{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">{selectedTicket.submitted_by_name}</span>
                <p className="text-slate-400 mt-0.5">{new Date(selectedTicket.submitted_at).toLocaleString()}</p>
              </div>

              <div>
                <span className="text-slate-400">Assigned officer:</span>{' '}
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  {selectedTicket.assigned_to_name || 'Unassigned'}
                </span>
                {selectedTicket.assigned_at && (
                  <p className="text-slate-400 mt-0.5">Assigned {new Date(selectedTicket.assigned_at).toLocaleDateString()}</p>
                )}
              </div>

              {selectedTicket.apparatus_name && (
                <div>
                  <span className="text-slate-400">Apparatus:</span>{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">{selectedTicket.apparatus_name}</span>
                </div>
              )}

              {selectedTicket.equipment_name && (
                <div>
                  <span className="text-slate-400">Equipment:</span>{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">{selectedTicket.equipment_name}</span>
                </div>
              )}

              {selectedTicket.station_location && (
                <div>
                  <span className="text-slate-400">Station area:</span>{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">{selectedTicket.station_location}</span>
                </div>
              )}

              {selectedTicket.status === 'complete' && selectedTicket.completed_at && (
                <div className="sm:col-span-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">Resolved & Completed:</span>{' '}
                  <span>{new Date(selectedTicket.completed_at).toLocaleString()}</span>
                  {selectedTicket.resolution_notes && (
                    <p className="mt-1 text-slate-700 dark:text-slate-300 italic">
                      "{selectedTicket.resolution_notes}"
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Attachments */}
            {selectedTicket.files && selectedTicket.files.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  Attachments ({selectedTicket.files.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedTicket.files.map((file, idx) => (
                    <button
                      key={file.fileId || idx}
                      type="button"
                      onClick={() => openWorkOrderFile({ file, workOrderId: selectedTicket.id })}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition text-xs text-left"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">{file.name}</span>
                      </div>
                      <Eye className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Activity & Notes thread */}
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
              <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-slate-400" />
                Notes & Updates ({selectedTicket.notes?.length || 0})
              </h4>

              {selectedTicket.notes && selectedTicket.notes.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedTicket.notes.map((note) => (
                    <div
                      key={note.id}
                      className="bg-slate-50 dark:bg-slate-900/70 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{note.author_name}</span>
                        <span>{new Date(note.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{note.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No notes posted yet.</p>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={ticketNoteText}
                  onChange={(e) => setTicketNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTicketNote();
                    }
                  }}
                  placeholder="Post an update or question on this ticket..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={addingNote || !ticketNoteText.trim()}
                  onClick={handleAddTicketNote}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition"
                >
                  {addingNote ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Post
                </button>
              </div>
            </div>
          </div>
        </ViewportModal>
      )}

      {/* Notice / Feedback Modal */}
      {noticeModal && (
        <ConfirmModal
          title={noticeModal.title}
          message={noticeModal.message}
          tone={noticeModal.tone || 'default'}
          confirmLabel={noticeModal.confirmLabel || 'OK'}
          cancelLabel={null}
          onConfirm={() => setNoticeModal(null)}
          onCancel={() => setNoticeModal(null)}
        />
      )}
    </div>
  );
}

