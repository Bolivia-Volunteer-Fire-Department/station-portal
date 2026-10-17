import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Wrench,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  UserCheck,
  Paperclip,
  Eye,
  DollarSign,
  Truck,
  ShieldAlert,
  Building2,
  FileUp,
  X,
  MessageSquare,
  Send,
  RefreshCw,
  Info,
} from 'lucide-react';
import {
  adminSaveWorkOrder,
  adminDeleteWorkOrder,
  fetchWorkOrders,
  fetchApparatus,
  fetchEquipment,
  adminSaveApparatus,
  fetchAdminSections,
} from '../../services/api';
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
} from '../../utils/workOrders';
import { permissionGranted } from '../../utils/permissions';
import { isTruthyFlag } from '../../utils/rankEligibility';
import {
  uploadWorkOrderFile,
  openWorkOrderFile,
} from '../../services/workOrderFileStorage';
import ConfirmModal from '../ConfirmModal';
import ViewportModal from '../ViewportModal';

const WORK_ORDER_FORM_ID = 'work-order-editor-form';

const EMPTY_FORM = {
  id: '',
  ticket_number: '',
  title: '',
  description: '',
  category: 'other',
  priority: 'medium',
  status: 'pending',
  apparatus_id: '',
  apparatus_name: '',
  maintenance_record_id: '',
  equipment_id: '',
  equipment_name: '',
  station_location: '',
  assigned_to_id: '',
  assigned_to_name: '',
  assigned_at: null,
  assigned_by_id: '',
  cost: 0,
  resolution_notes: '',
  completed_at: null,
  completed_by_id: '',
  completed_by_name: '',
  notes: [],
  files: [],
};

export default function AdminWorkOrdersTab({
  token,
  currentUserId = '',
  currentUser = null,
  currentUserName: currentUserNameProp = '',
  users = [],
  roles = [],
  onDataChanged,
  initialWorkOrderId = null,
  initialWorkOrder = null,
  onClearInitialWorkOrder = null,
}) {
  const [internalUsers, setInternalUsers] = useState([]);
  const [internalRoles, setInternalRoles] = useState([]);
  const [noticeModal, setNoticeModal] = useState(null);

  const effectiveUsers = users && users.length > 0 ? users : internalUsers;
  const effectiveRoles = roles && roles.length > 0 ? roles : internalRoles;

  const currentUserName = useMemo(() => {
    return (
      currentUserNameProp ||
      currentUser?.name ||
      currentUser?.full_name ||
      currentUser?.user_name ||
      effectiveUsers.find((u) => String(u?.id ?? u?.user_id) === String(currentUserId || currentUser?.id))?.name ||
      'Officer'
    );
  }, [currentUserNameProp, currentUser, effectiveUsers, currentUserId]);

  const [workOrdersList, setWorkOrdersList] = useState([]);
  const [apparatusList, setApparatusList] = useState([]);
  const [equipmentList, setEquipmentList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'all', 'active', or specific status
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all'); // 'all', 'me', 'unassigned', or userId

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [newNoteText, setNewNoteText] = useState('');

  // Uploading state
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Maintenance creation state
  const [creatingMaintenance, setCreatingMaintenance] = useState(false);

  // Eligible assignees: STRICTLY members whose role grants `can_manage_work_orders` or `is_admin`
  const eligibleAssignees = useMemo(() => {
    const roleById = new Map();
    (Array.isArray(effectiveRoles) ? effectiveRoles : []).forEach((r) => {
      if (!r) return;
      if (r.id != null) roleById.set(String(r.id), r);
      if (r.role_id != null) roleById.set(String(r.role_id), r);
      if (r.roleId != null) roleById.set(String(r.roleId), r);
    });

    return (Array.isArray(effectiveUsers) ? effectiveUsers : [])
      .filter((user) => {
        if (!user) return false;
        const userRoleId = String(user.role_id ?? user.role ?? user.roleId ?? '');
        const role = roleById.get(userRoleId);
        if (role) {
          return permissionGranted(role, 'can_manage_work_orders') || isTruthyFlag(role.is_admin);
        }
        return permissionGranted(user, 'can_manage_work_orders') || isTruthyFlag(user.is_admin);
      })
      .map((user) => ({
        ...user,
        id: String(user.id ?? user.user_id ?? user.uid ?? ''),
        name: user.name || user.full_name || user.user_name || 'Member',
      }))
      .filter((user) => Boolean(user.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [effectiveUsers, effectiveRoles]);

  // Load work orders and assets
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const missingSections = [];
      if (!users?.length && !internalUsers.length) missingSections.push('directory');
      if (!roles?.length && !internalRoles.length) missingSections.push('roles');

      const [woRes, appRes, eqRes, adminSections] = await Promise.all([
        fetchWorkOrders(token).catch(() => null),
        fetchApparatus(token).catch(() => null),
        fetchEquipment(token).catch(() => null),
        missingSections.length ? fetchAdminSections(missingSections).catch(() => null) : null,
      ]);

      if (adminSections?.directory) {
        setInternalUsers(adminSections.directory);
      }
      if (adminSections?.roles) {
        setInternalRoles(adminSections.roles);
      }
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
      console.warn('Failed to load work orders data:', err);
    } finally {
      setLoading(false);
    }
  }, [token, currentUser, users, roles, internalUsers.length, internalRoles.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    await loadData();
    if (onDataChanged) onDataChanged();
  };

  // Filtered list
  const filteredWorkOrders = useMemo(() => {
    return workOrdersList.filter((wo) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          String(wo.ticket_number || '').toLowerCase().includes(q) ||
          String(wo.title || '').toLowerCase().includes(q) ||
          String(wo.description || '').toLowerCase().includes(q) ||
          String(wo.apparatus_name || '').toLowerCase().includes(q) ||
          String(wo.equipment_name || '').toLowerCase().includes(q) ||
          String(wo.station_location || '').toLowerCase().includes(q) ||
          String(wo.assigned_to_name || '').toLowerCase().includes(q) ||
          String(wo.submitted_by_name || '').toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Status
      if (statusFilter === 'active') {
        if (!isActiveWorkOrder(wo)) return false;
      } else if (statusFilter !== 'all') {
        if (String(wo.status).toLowerCase() !== statusFilter) return false;
      }

      // Category
      if (categoryFilter !== 'all') {
        if (String(wo.category).toLowerCase() !== categoryFilter) return false;
      }

      // Priority
      if (priorityFilter !== 'all') {
        if (String(wo.priority).toLowerCase() !== priorityFilter) return false;
      }

      // Assignee
      if (assigneeFilter === 'me') {
        if (String(wo.assigned_to_id) !== String(currentUserId)) return false;
      } else if (assigneeFilter === 'unassigned') {
        if (String(wo.assigned_to_id).trim()) return false;
      } else if (assigneeFilter !== 'all') {
        if (String(wo.assigned_to_id) !== String(assigneeFilter)) return false;
      }

      return true;
    });
  }, [workOrdersList, searchQuery, statusFilter, categoryFilter, priorityFilter, assigneeFilter, currentUserId]);

  // Counts for summary metrics
  const activeCount = useMemo(() => workOrdersList.filter(isActiveWorkOrder).length, [workOrdersList]);
  const myAssignedCount = useMemo(
    () => workOrdersList.filter((wo) => String(wo.assigned_to_id) === String(currentUserId) && isActiveWorkOrder(wo)).length,
    [workOrdersList, currentUserId]
  );
  const urgentCount = useMemo(
    () => workOrdersList.filter((wo) => String(wo.priority) === 'urgent' && isActiveWorkOrder(wo)).length,
    [workOrdersList]
  );

  // Quick assignment handler from the card dropdown
  const handleQuickAssign = async (workOrder, newAssigneeId) => {
    const assignee = eligibleAssignees.find((u) => String(u.id) === String(newAssigneeId));
    const updated = {
      ...workOrder,
      assigned_to_id: assignee ? String(assignee.id) : '',
      assigned_to_name: assignee ? String(assignee.name || '') : '',
      assigned_at: assignee ? new Date().toISOString() : null,
      assigned_by_id: assignee ? String(currentUserId) : '',
      status: workOrder.status === 'pending' && assignee ? 'scheduled' : workOrder.status,
      updated_at: new Date().toISOString(),
      updated_by: currentUserId,
    };

    try {
      await adminSaveWorkOrder(updated, token);
      setWorkOrdersList((prev) => prev.map((item) => (item.id === workOrder.id ? updated : item)));
      if (onDataChanged) onDataChanged();
    } catch (err) {
      console.error('Failed to assign work order:', err);
      setNoticeModal({
        title: 'Assignment Failed',
        message: 'Could not update assignment. Please try again.',
        tone: 'danger',
      });
    }
  };

  // Quick status change handler
  const handleQuickStatusChange = async (workOrder, newStatus) => {
    const isCompleting = newStatus === 'complete';
    const updated = {
      ...workOrder,
      status: newStatus,
      completed_at: isCompleting ? workOrder.completed_at || new Date().toISOString() : workOrder.completed_at,
      completed_by_id: isCompleting ? workOrder.completed_by_id || currentUserId : workOrder.completed_by_id,
      completed_by_name: isCompleting ? workOrder.completed_by_name || currentUserName : workOrder.completed_by_name,
      updated_at: new Date().toISOString(),
      updated_by: currentUserId,
    };

    try {
      await adminSaveWorkOrder(updated, token);
      setWorkOrdersList((prev) => prev.map((item) => (item.id === workOrder.id ? updated : item)));
      if (onDataChanged) onDataChanged();
    } catch (err) {
      console.error('Failed to change work order status:', err);
      setNoticeModal({
        title: 'Status Update Failed',
        message: 'Could not update status. Please try again.',
        tone: 'danger',
      });
    }
  };

  // Open modal for editing or new
  const openEditor = (workOrder = null) => {
    if (workOrder) {
      setFormData({
        ...workOrder,
        notes: Array.isArray(workOrder.notes) ? [...workOrder.notes] : [],
        files: Array.isArray(workOrder.files) ? [...workOrder.files] : [],
      });
    } else {
      setFormData({
        ...EMPTY_FORM,
        ticket_number: generateWorkOrderTicketNumber(),
        submitted_at: new Date().toISOString(),
        submitted_by_id: currentUserId,
        submitted_by_name: currentUserName,
      });
    }
    setNewNoteText('');
    setEditorOpen(true);
  };

  // Automatically open the editor if an initial work order or ID was requested
  const lastOpenedWorkOrderIdRef = useRef(null);

  useEffect(() => {
    if (!initialWorkOrder && !initialWorkOrderId) {
      lastOpenedWorkOrderIdRef.current = null;
      return;
    }

    if (initialWorkOrder && initialWorkOrder.id) {
      if (lastOpenedWorkOrderIdRef.current !== initialWorkOrder.id) {
        lastOpenedWorkOrderIdRef.current = initialWorkOrder.id;
        openEditor(initialWorkOrder);
        onClearInitialWorkOrder?.();
      }
      return;
    }

    if (initialWorkOrderId && workOrdersList.length > 0) {
      if (lastOpenedWorkOrderIdRef.current !== initialWorkOrderId) {
        const found = workOrdersList.find((wo) => String(wo.id) === String(initialWorkOrderId));
        if (found) {
          lastOpenedWorkOrderIdRef.current = initialWorkOrderId;
          openEditor(found);
          onClearInitialWorkOrder?.();
        }
      }
    }
  }, [initialWorkOrder, initialWorkOrderId, workOrdersList, onClearInitialWorkOrder]);

  // Keep editor formData updated if fresh notes or files load for the open ticket
  useEffect(() => {
    if (editorOpen && formData.id && workOrdersList.length > 0) {
      const match = workOrdersList.find((wo) => String(wo.id) === String(formData.id));
      if (match) {
        const matchNotesLen = Array.isArray(match.notes) ? match.notes.length : 0;
        const formNotesLen = Array.isArray(formData.notes) ? formData.notes.length : 0;
        const matchFilesLen = Array.isArray(match.files) ? match.files.length : 0;
        const formFilesLen = Array.isArray(formData.files) ? formData.files.length : 0;
        if (matchNotesLen > formNotesLen || matchFilesLen > formFilesLen) {
          setFormData((prev) => ({
            ...prev,
            ...match,
            notes: Array.isArray(match.notes) ? match.notes : prev.notes,
            files: Array.isArray(match.files) ? match.files : prev.files,
          }));
        }
      }
    }
  }, [workOrdersList, editorOpen, formData.id]);

  // Save full form
  const handleSaveForm = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.title.trim()) {
      setNoticeModal({
        title: 'Title Required',
        message: 'Please enter a title for the work order.',
        tone: 'danger',
      });
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const isCompleting = formData.status === 'complete';

      const payload = {
        ...formData,
        title: formData.title.trim(),
        description: formData.description.trim(),
        cost: parseFloat(formData.cost) >= 0 ? parseFloat(formData.cost) : 0,
        completed_at: isCompleting ? formData.completed_at || now : null,
        completed_by_id: isCompleting ? formData.completed_by_id || currentUserId : '',
        completed_by_name: isCompleting ? formData.completed_by_name || currentUserName : '',
        updated_at: now,
        updated_by: currentUserId,
      };

      const res = await adminSaveWorkOrder(payload, token);
      const savedId = res?.id || payload.id;
      const normalized = normalizeWorkOrder({ ...payload, id: savedId }, currentUser);

      setWorkOrdersList((prev) => {
        const idx = prev.findIndex((wo) => wo.id === savedId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = normalized;
          return next;
        }
        return [normalized, ...prev];
      });

      setEditorOpen(false);
      if (onDataChanged) onDataChanged();
    } catch (err) {
      console.error('Failed to save work order:', err);
      setNoticeModal({
        title: 'Save Failed',
        message: 'Failed to save work order. ' + (err?.message || ''),
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingId(pendingDelete.id);
    try {
      await adminDeleteWorkOrder(pendingDelete.id, token);
      setWorkOrdersList((prev) => prev.filter((wo) => wo.id !== pendingDelete.id));
      setPendingDelete(null);
      if (onDataChanged) onDataChanged();
    } catch (err) {
      console.error('Failed to delete work order:', err);
      setNoticeModal({
        title: 'Delete Failed',
        message: 'Failed to delete work order: ' + (err?.message || ''),
        tone: 'danger',
      });
    } finally {
      setDeletingId(null);
    }
  };

  // Add a note to the work order
  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;
    const note = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}`,
      text: newNoteText.trim(),
      author_id: currentUserId,
      author_name: currentUserName,
      created_at: new Date().toISOString(),
    };
    const nextNotes = [...(formData.notes || []), note];
    setFormData((prev) => ({
      ...prev,
      notes: nextNotes,
    }));
    setNewNoteText('');

    // If editing an existing ticket, persist immediately to trigger note push notifications
    if (formData.id) {
      try {
        const updated = {
          ...formData,
          notes: nextNotes,
          updated_at: new Date().toISOString(),
          updated_by: currentUserId,
        };
        await adminSaveWorkOrder(updated, token);
        setWorkOrdersList((prev) =>
          prev.map((wo) => (wo.id === formData.id ? normalizeWorkOrder(updated, currentUser) : wo))
        );
        if (onDataChanged) onDataChanged();
      } catch (err) {
        console.error('Failed to auto-save note:', err);
      }
    }
  };

  // Upload file attachment
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setUploadingFiles(true);
    setUploadProgress(0);

    const workOrderId = formData.id || 'draft_' + Date.now();
    try {
      const uploadedAttachments = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await uploadWorkOrderFile({
          workOrderId,
          file,
          onProgress: (p) => setUploadProgress(Math.round(((i + p) / files.length) * 100)),
        });
        uploadedAttachments.push(res);
      }

      setFormData((prev) => ({
        ...prev,
        files: [...(prev.files || []), ...uploadedAttachments],
      }));
    } catch (err) {
      console.error('Failed to upload attachment:', err);
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

  const handleRemoveFile = (indexToRemove) => {
    setFormData((prev) => ({
      ...prev,
      files: (prev.files || []).filter((_, i) => i !== indexToRemove),
    }));
  };

  // Create maintenance record on apparatus from work order
  const handleCreateMaintenanceRecord = async () => {
    if (!formData.apparatus_id) {
      setNoticeModal({
        title: 'Select Apparatus',
        message: 'Please select an apparatus first.',
        tone: 'info',
      });
      return;
    }
    const app = apparatusList.find((a) => String(a.id) === String(formData.apparatus_id));
    if (!app) {
      setNoticeModal({
        title: 'Apparatus Not Found',
        message: 'The selected apparatus was not found.',
        tone: 'danger',
      });
      return;
    }

    setCreatingMaintenance(true);
    try {
      const recordId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `maint_${Date.now()}`;
      const newMaintRecord = {
        id: recordId,
        date: new Date().toISOString().slice(0, 10),
        type: 'repair',
        description: `[Work Order ${formData.ticket_number || ''}] ${formData.title}: ${formData.description || ''}`,
        vendor: '',
        cost: parseFloat(formData.cost) >= 0 ? parseFloat(formData.cost) : 0,
        mileage: app.mileage || '',
        engine_hours: app.engine_hours || '',
        logged_by: currentUserName,
        files: [...(formData.files || [])],
      };

      const updatedRecords = [...(app.maintenance_records || []), newMaintRecord];
      const updatedApparatus = {
        ...app,
        maintenance_records: updatedRecords,
      };

      await adminSaveApparatus(updatedApparatus, token);

      // Update apparatus list state
      setApparatusList((prev) => prev.map((a) => (a.id === app.id ? updatedApparatus : a)));

      // Link to work order
      setFormData((prev) => ({
        ...prev,
        maintenance_record_id: recordId,
      }));

      setNoticeModal({
        title: 'Maintenance Record Created',
        message: `Maintenance record created and linked to ${app.identifier || app.description || 'apparatus'}!`,
        tone: 'success',
      });
    } catch (err) {
      console.error('Failed to create maintenance record:', err);
      setNoticeModal({
        title: 'Record Creation Failed',
        message: 'Could not create maintenance record: ' + (err?.message || ''),
        tone: 'danger',
      });
    } finally {
      setCreatingMaintenance(false);
    }
  };

  // Selected apparatus lookup for form
  const selectedApparatus = useMemo(() => {
    return apparatusList.find((a) => String(a.id) === String(formData.apparatus_id));
  }, [apparatusList, formData.apparatus_id]);

  // Real-time duplicate detection while writing/editing tickets
  const potentialDuplicates = useMemo(() => {
    if (!editorOpen) return [];
    return findPotentialDuplicates(formData, workOrdersList, formData.id || null);
  }, [editorOpen, formData, workOrdersList]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Wrench className="w-6 h-6 text-red-600" />
            Work Orders
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage, assign, and track maintenance tickets for apparatus, station facilities, and equipment.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition disabled:opacity-50"
            title="Refresh work orders"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white shadow-lg shadow-red-600/20 hover:bg-red-700 transition"
          >
            <Plus className="w-4 h-4" />
            New Work Order
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Work Orders</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{activeCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center font-bold">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned to Me</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{myAssignedCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center font-bold">
            <UserCheck className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Urgent Attention</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">{urgentCount}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center font-bold">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticket #, title, asset, submitter, assignee..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium"
            >
              <option value="active">Active Only</option>
              <option value="all">All Statuses</option>
              {WORK_ORDER_STATUSES.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium"
            >
              <option value="all">All Categories</option>
              {WORK_ORDER_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium"
            >
              <option value="all">All Priorities</option>
              {WORK_ORDER_PRIORITIES.map((pr) => (
                <option key={pr.value} value={pr.value}>
                  {pr.label}
                </option>
              ))}
            </select>

            {/* Assignee Filter */}
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium"
            >
              <option value="all">All Assignees</option>
              <option value="me">Assigned to Me</option>
              <option value="unassigned">Unassigned</option>
              {eligibleAssignees.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tickets List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-red-600 mb-2" />
          <p className="text-sm">Loading work orders...</p>
        </div>
      ) : filteredWorkOrders.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
          <Wrench className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">No work orders found</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            {searchQuery || statusFilter !== 'all' || categoryFilter !== 'all' || priorityFilter !== 'all' || assigneeFilter !== 'all'
              ? 'Try adjusting your filters or search query.'
              : 'No work orders have been submitted yet. Members can submit tickets from the Work Orders module.'}
          </p>
          <button
            type="button"
            onClick={() => openEditor(null)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white shadow-sm hover:bg-red-700 transition"
          >
            <Plus className="w-4 h-4" />
            Create Work Order
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredWorkOrders.map((wo) => {
            const statusMeta = getStatusMeta(wo.status);
            const priorityMeta = getPriorityMeta(wo.priority);
            const categoryMeta = getCategoryMeta(wo.category);

            const isUrgent = wo.priority === 'urgent';
            const isAssignedToMe = String(wo.assigned_to_id) === String(currentUserId);

            return (
              <div
                key={wo.id}
                className={`bg-white dark:bg-slate-800 border rounded-2xl p-4 sm:p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between ${
                  isUrgent
                    ? 'border-red-300 dark:border-red-800/80 bg-red-50/20'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {/* Main Body */}
                <div className="space-y-2.5">
                  {/* Top Bar: Badges & Action Buttons */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 px-2.5 py-1 rounded-lg">
                        {wo.ticket_number}
                      </span>

                      {/* Status Badge */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          statusMeta.value === 'complete'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : statusMeta.value === 'in_progress'
                              ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-400'
                              : statusMeta.value === 'scheduled'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400'
                                : statusMeta.value === 'on_hold'
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-400'
                                  : statusMeta.value === 'cancelled'
                                    ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {statusMeta.label}
                      </span>

                      {/* Priority Badge */}
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                          priorityMeta.value === 'urgent'
                            ? 'bg-red-100 text-red-800 dark:bg-red-950/70 dark:text-red-400'
                            : priorityMeta.value === 'high'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400'
                              : priorityMeta.value === 'medium'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300'
                        }`}
                      >
                        {priorityMeta.label}
                      </span>

                      {/* Category Badge */}
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                        {wo.category === 'apparatus' && <Truck className="w-3 h-3 text-red-500" />}
                        {wo.category === 'equipment' && <ShieldAlert className="w-3 h-3 text-amber-500" />}
                        {wo.category === 'station' && <Building2 className="w-3 h-3 text-blue-500" />}
                        {categoryMeta.label}
                      </span>

                      {isAssignedToMe && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full">
                          Assigned to You
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditor(wo)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700 transition"
                        title="Edit work order details"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(wo)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                        title="Delete work order"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                    {wo.title}
                  </h3>

                  {/* Description */}
                  {wo.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                      {wo.description}
                    </p>
                  )}

                  {/* Asset details & tags */}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                    {wo.category === 'apparatus' && wo.apparatus_name && (
                      <span className="flex items-center gap-1 text-slate-700 dark:text-slate-200 font-medium">
                        <Truck className="w-3.5 h-3.5 text-red-500" />
                        Apparatus: {wo.apparatus_name}
                      </span>
                    )}

                    {wo.maintenance_record_id && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                        <CheckCircle2 className="w-3 h-3" />
                        Maintenance Record Linked
                      </span>
                    )}

                    {wo.category === 'equipment' && wo.equipment_name && (
                      <span className="flex items-center gap-1 text-slate-700 dark:text-slate-200 font-medium">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                        Equipment: {wo.equipment_name}
                      </span>
                    )}

                    {wo.category === 'station' && wo.station_location && (
                      <span className="flex items-center gap-1 text-slate-700 dark:text-slate-200 font-medium">
                        <Building2 className="w-3.5 h-3.5 text-blue-500" />
                        Location: {wo.station_location}
                      </span>
                    )}

                    {wo.files && wo.files.length > 0 && (
                      <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                        <Paperclip className="w-3 h-3 text-slate-400" />
                        {wo.files.length} attachment{wo.files.length === 1 ? '' : 's'}
                      </span>
                    )}

                    {wo.cost > 0 && (
                      <span className="flex items-center gap-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        <DollarSign className="w-3 h-3" />
                        {Number(wo.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer: Submitter info on left, Quick Triage Selects on right */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <span>
                      Submitted by <strong className="text-slate-700 dark:text-slate-200 font-medium">{wo.submitted_by_name}</strong>
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">•</span>
                    <span>{new Date(wo.submitted_at).toLocaleDateString()}</span>
                  </div>

                  {/* Inline Triage Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Quick Assignment Dropdown */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-[11px] font-medium text-slate-400">Assignee:</span>
                      <select
                        value={wo.assigned_to_id || ''}
                        onChange={(e) => handleQuickAssign(wo, e.target.value)}
                        className="bg-transparent font-medium text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer pr-1"
                      >
                        <option value="">Unassigned</option>
                        {eligibleAssignees.map((officer) => (
                          <option key={officer.id} value={officer.id}>
                            {officer.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quick Status Dropdown */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
                      <span className="text-[11px] font-medium text-slate-400">Status:</span>
                      <select
                        value={wo.status || 'pending'}
                        onChange={(e) => handleQuickStatusChange(wo, e.target.value)}
                        className="bg-transparent font-medium text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer pr-1"
                      >
                        {WORK_ORDER_STATUSES.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      {editorOpen && (
        <ViewportModal
          onClose={() => setEditorOpen(false)}
          title={formData.id ? `Work Order ${formData.ticket_number}` : 'New Work Order'}
          formId={WORK_ORDER_FORM_ID}
          saveLabel={formData.id ? 'Save Changes' : 'Create Work Order'}
          saving={saving}
          busy={saving}
          busyLabel="Saving…"
        >
          <form id={WORK_ORDER_FORM_ID} onSubmit={handleSaveForm} className="space-y-6">
            {/* Top row: Ticket Number & Status & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Ticket Number
                </label>
                <input
                  type="text"
                  readOnly
                  value={formData.ticket_number}
                  className="w-full px-3 py-2 text-sm rounded-xl font-mono font-bold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                >
                  {WORK_ORDER_STATUSES.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
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

            {/* Title & Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Title / Short Summary *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Engine 1 primer valve leak, Bay 2 overhead door stuck"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => {
                    const cat = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      category: cat,
                      // reset irrelevant fields
                      apparatus_id: cat === 'apparatus' ? prev.apparatus_id : '',
                      apparatus_name: cat === 'apparatus' ? prev.apparatus_name : '',
                      equipment_id: cat === 'equipment' ? prev.equipment_id : '',
                      equipment_name: cat === 'equipment' ? prev.equipment_name : '',
                      station_location: cat === 'station' ? prev.station_location : '',
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
            </div>

            {/* Asset Selection (Conditional based on Category) */}
            {formData.category === 'apparatus' && (
              <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-4">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-red-500" />
                  Apparatus Details & Maintenance Record
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Target Apparatus
                    </label>
                    <select
                      value={formData.apparatus_id}
                      onChange={(e) => {
                        const aid = e.target.value;
                        const app = apparatusList.find((a) => String(a.id) === String(aid));
                        setFormData((prev) => ({
                          ...prev,
                          apparatus_id: aid,
                          apparatus_name: app ? `${app.identifier || ''} - ${app.description || app.type || ''}`.trim() : '',
                          maintenance_record_id: '',
                        }));
                      }}
                      className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      <option value="">Select an apparatus...</option>
                      {apparatusList.map((app) => (
                        <option key={app.id} value={app.id}>
                          {app.identifier} {app.description ? `(${app.description})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedApparatus && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Link Existing Maintenance Record
                      </label>
                      <select
                        value={formData.maintenance_record_id || ''}
                        onChange={(e) => setFormData((prev) => ({ ...prev, maintenance_record_id: e.target.value }))}
                        className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      >
                        <option value="">No maintenance record linked</option>
                        {(selectedApparatus.maintenance_records || []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.date || 'Record'} - {m.type || 'service'} ({m.description?.slice(0, 30)}...)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {selectedApparatus && !formData.maintenance_record_id && (
                  <div className="flex items-center justify-between bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <span className="text-xs text-slate-500">
                      Need to log a maintenance record for this repair on {selectedApparatus.identifier}?
                    </span>
                    <button
                      type="button"
                      disabled={creatingMaintenance}
                      onClick={handleCreateMaintenanceRecord}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition"
                    >
                      {creatingMaintenance ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Plus className="w-3.5 h-3.5 text-red-500" />
                      )}
                      Create & Link Maintenance Record
                    </button>
                  </div>
                )}
              </div>
            )}

            {formData.category === 'equipment' && (
              <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  Equipment & Gear Details
                </h4>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Select Equipment Item
                  </label>
                  <select
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
                    <option value="">Select equipment item (turnout gear, SCBA, radio)...</option>
                    {equipmentList.map((eq) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.identifier ? `[${eq.identifier}] ` : ''}
                        {eq.make_model || eq.type || eq.category} (S/N: {eq.serial_number || 'N/A'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {formData.category === 'station' && (
              <div className="bg-slate-50 dark:bg-slate-900/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-blue-500" />
                  Station Facility Location
                </h4>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Station Area / Room
                  </label>
                  <input
                    type="text"
                    value={formData.station_location}
                    onChange={(e) => setFormData((prev) => ({ ...prev, station_location: e.target.value }))}
                    placeholder="e.g. Apparatus Bay 1, Kitchen, Bunk Room 3, Chief's Office, Front Entryway"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Assignee & Cost */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Assigned Officer (Restricted to Work Order Managers)
                </label>
                <select
                  value={formData.assigned_to_id || ''}
                  onChange={(e) => {
                    const aid = e.target.value;
                    const assignee = eligibleAssignees.find((u) => String(u.id) === String(aid));
                    setFormData((prev) => ({
                      ...prev,
                      assigned_to_id: aid,
                      assigned_to_name: assignee ? assignee.name : '',
                      assigned_at: aid ? prev.assigned_at || new Date().toISOString() : null,
                      assigned_by_id: aid ? prev.assigned_by_id || currentUserId : '',
                    }));
                  }}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                >
                  <option value="">Unassigned</option>
                  {eligibleAssignees.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Only members granted "Manage Work Orders" can be assigned.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Cost / Expense ($)
                </label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.cost ?? 0}
                    onChange={(e) => setFormData((prev) => ({ ...prev, cost: e.target.value }))}
                    placeholder="0.00"
                    className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Description of Issue / Work Requested
              </label>
              <textarea
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Detailed description of what is damaged, malfunctioning, or needs replacement..."
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            {/* Resolution Notes (especially if marked Complete) */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Resolution Notes (Optional)
              </label>
              <textarea
                rows={2}
                value={formData.resolution_notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, resolution_notes: e.target.value }))}
                placeholder="What action was taken to fix or resolve this work order?"
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
                      An active ticket may already cover this issue. Review active tickets below to avoid duplicating efforts:
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

            {/* Attachments Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Attachments (Photos, Receipts, Diagrams, Invoices)
                </label>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition">
                  <FileUp className="w-3.5 h-3.5" />
                  Add Files
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
                    <p className="text-xs font-semibold text-red-800 dark:text-red-300">Uploading files...</p>
                    <div className="w-full h-1.5 bg-red-200 dark:bg-red-900 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-red-600 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                </div>
              )}

              {formData.files && formData.files.length > 0 ? (
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
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openWorkOrderFile({ file, workOrderId: formData.id })}
                          className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          title="View attachment"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx)}
                          className="p-1 rounded text-slate-400 hover:text-red-600"
                          title="Remove attachment"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">No attachments added yet.</p>
              )}
            </div>

            {/* Activity & Internal Notes Log */}
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-slate-400" />
                Internal Activity & Notes ({formData.notes?.length || 0})
              </h4>

              {formData.notes && formData.notes.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {formData.notes.map((note) => (
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
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddNote();
                    }
                  }}
                  placeholder="Add a progress update or internal note..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleAddNote}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 transition"
                >
                  <Send className="w-3 h-3" />
                  Add
                </button>
              </div>
            </div>
          </form>
        </ViewportModal>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <ConfirmModal
          title="Delete Work Order"
          message={`Are you sure you want to permanently delete ticket ${pendingDelete.ticket_number} ("${pendingDelete.title}")? This action cannot be undone.`}
          confirmLabel={deletingId ? 'Deleting...' : 'Delete Ticket'}
          tone="danger"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
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
