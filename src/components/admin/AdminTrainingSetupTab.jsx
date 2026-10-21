import React, { useState, useEffect, useMemo } from 'react';
import {
  SlidersHorizontal,
  PenLine,
  CheckCircle2,
  AlertCircle,
  Save,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  GraduationCap,
  Sparkles,
} from 'lucide-react';
import { adminSaveSystemSetting } from '../../services/api';
import {
  SIGNATURE_WINDOW_KEY,
  signatureWindowConfig,
  MEMBERS_MUST_SIGN_KEY,
  membersMustSignTrainings,
  TRAINING_CATEGORIES_KEY,
  DEFAULT_TRAINING_CATEGORIES,
  getTrainingCategories,
  TRAINING_CATEGORY_COLORS,
  getCategoryColorClasses,
} from '../../utils/training';
import { getSettingValue } from '../../utils/systemSettings';
import CenteredContent from '../CenteredContent';
import ToggleSwitch from '../ToggleSwitch';
import ViewportModal from '../ViewportModal';
import ConfirmModal from '../ConfirmModal';
import IconPicker from '../IconPicker';
import RankIcon from '../RankIcon';

export default function AdminTrainingSetupTab({
  token,
  systemSettings = [],
  onDataChanged,
}) {
  return (
    <CenteredContent>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <SlidersHorizontal className="w-6 h-6 text-red-600 dark:text-red-500" />
          Training Setup
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Configure attendance requirements, signature windows, and training category badges.
        </p>
      </div>

      <div className="space-y-6">
        {/* Attendance & Signing Rules */}
        <TrainingSignatureRequirementCard
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
        />
        <SignatureWindowCard
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
        />

        {/* Training Categories Management */}
        <TrainingCategoriesCard
          token={token}
          systemSettings={systemSettings}
          onDataChanged={onDataChanged}
        />
      </div>
    </CenteredContent>
  );
}

// Controls whether individual members must sign for their own trainings or officers can sign on their behalf.
function TrainingSignatureRequirementCard({ token, systemSettings, onDataChanged }) {
  const [mustSign, setMustSign] = useState(() => membersMustSignTrainings(systemSettings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMustSign(membersMustSignTrainings(systemSettings));
  }, [systemSettings]);

  const handleToggle = async (checked) => {
    setMustSign(checked);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting(MEMBERS_MUST_SIGN_KEY, String(checked), token);
      if (!result?.success) throw new Error(result?.message || 'Failed to update setting.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to update setting.');
      setMustSign(!checked);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Training Signatures</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Members must sign for their own trainings
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
            <ToggleSwitch
              checked={mustSign}
              onChange={handleToggle}
              disabled={saving}
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">
          {mustSign ? (
            <>
              <strong className="text-slate-700 dark:text-slate-300">Self-sign required (Default):</strong> Members must sign into their own account in the Training module to sign and acknowledge their attendance.
            </>
          ) : (
            <>
              <strong className="text-amber-600 dark:text-amber-400">Member sign-off disabled:</strong> Any user authorized to add or edit trainings can select which members were present directly on the training form, signing attendance on their behalf.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// Sets how many days members have to sign training records before they lock.
function SignatureWindowCard({ token, systemSettings, onDataChanged }) {
  const [days, setDays] = useState(getSettingValue(systemSettings, SIGNATURE_WINDOW_KEY, ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDays(getSettingValue(systemSettings, SIGNATURE_WINDOW_KEY, ''));
  }, [systemSettings]);

  // Check if the typed days value is valid.
  const preview = signatureWindowConfig([{ key: SIGNATURE_WINDOW_KEY, value: days }]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await adminSaveSystemSetting(SIGNATURE_WINDOW_KEY, String(days ?? '').trim(), token);
      if (!result?.success) throw new Error(result?.message || 'Failed to save the signing window.');
      void onDataChanged();
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save the signing window.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <form onSubmit={handleSave} className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
            <PenLine className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Training Signing Window</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              How long after its date a training stays open for signatures.
            </p>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              preview.configured
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-400'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {preview.configured ? `${preview.days} day${preview.days === 1 ? '' : 's'}` : 'No limit'}
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400">
          {preview.configured ? (
            <>
              A training can be signed for{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                {preview.days} day{preview.days === 1 ? '' : 's'}
              </strong>{' '}
              after its date, counting the date itself — so a 30-day window on 1 March closes after 31 March. After that
              the <strong className="text-slate-700 dark:text-slate-300">Sign</strong> button reads Closed for every
              member. A signature that is genuinely missing is then yours to sort out here: widen the window, let them
              sign, and set it back. A training marked as Locked stays closed, whatever the date.
            </>
          ) : preview.invalid ? (
            <>
              <strong className="text-amber-600 dark:text-amber-400">
                &ldquo;{preview.raw}&rdquo; cannot be used, so there is no window at all.
              </strong>{' '}
              Enter a whole number of days — for example{' '}
              <code className="rounded bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 px-1 py-0.5 font-mono text-[11px]">
                30
              </code>
              . An unreadable value is ignored rather than applied, so a typo can never close every training in the
              station at once.
            </>
          ) : (
            <>
              Trainings are{' '}
              <strong className="text-slate-700 dark:text-slate-300">
                open for signature for as long as they exist
              </strong>
              . Leave this blank to keep that, or fill it in to close signing a set number of days after each training's
              date — which is what stops a member signing six months of trainings in one pass.
            </>
          )}
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Signable for (days after the date)
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 30"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setSaved(false);
              }}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="sm:col-span-2 flex items-end">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Counted from the training's own date, so one number covers every training at once. Signatures already given
              are untouched: closing the window stops new ones, and removing one stays an administrator's action — a
              signature is an acknowledgment of attendance, not a preference.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDays('');
              setSaved(false);
            }}
            className="flex items-center gap-2 mr-auto text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 transition disabled:opacity-50"
          >
            Clear (no limit)
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          <button
            type="submit"
            disabled={saving}
            className="ml-auto flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl transition shadow-lg shadow-red-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Signing Window
          </button>
        </div>
      </form>
    </div>
  );
}

// Manages custom training categories, labels, badge icons, and colors.
function TrainingCategoriesCard({ token, systemSettings, onDataChanged }) {
  const categories = useMemo(() => getTrainingCategories(systemSettings), [systemSettings]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Modal editor state
  const [editingCategory, setEditingCategory] = useState(null);
  const [formData, setFormData] = useState({
    key: '',
    label: '',
    short: '',
    icon: '',
    color: 'slate',
    active: true,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState('');

  // Confirm delete or reset modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  const saveCategoriesList = async (updatedList) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = JSON.stringify(updatedList);
      const res = await adminSaveSystemSetting(TRAINING_CATEGORIES_KEY, payload, token);
      if (!res?.success) throw new Error(res?.message || 'Failed to save training categories.');
      void onDataChanged();
      setSuccess('Training categories saved successfully.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save training categories.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingCategory(null);
    setFormData({
      key: '',
      label: '',
      short: '',
      icon: 'flame',
      color: 'blue',
      active: true,
    });
    setModalError('');
    setModalOpen(true);
  };

  const handleOpenEdit = (cat) => {
    setEditingCategory(cat);
    setFormData({
      key: cat.key,
      label: cat.label,
      short: cat.short,
      icon: cat.icon || '',
      color: cat.color || 'slate',
      active: cat.active !== false,
    });
    setModalError('');
    setModalOpen(true);
  };

  const handleToggleActive = async (catKey) => {
    const updated = categories.map((cat) =>
      cat.key === catKey ? { ...cat, active: !cat.active } : cat
    );
    await saveCategoriesList(updated);
  };

  const handleMove = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;
    const reordered = [...categories];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const updated = reordered.map((cat, idx) => ({ ...cat, order: idx + 1 }));
    await saveCategoriesList(updated);
  };

  const handleDeleteCategory = (catToDelete) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Training Category',
      message: `Are you sure you want to delete the category "${catToDelete.label}"? Historical training records tagged with this category will retain their saved flag.`,
      onConfirm: async () => {
        const filtered = categories.filter((c) => c.key !== catToDelete.key);
        const updated = filtered.map((c, idx) => ({ ...c, order: idx + 1 }));
        await saveCategoriesList(updated);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleResetDefaults = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset Training Categories to Defaults',
      message: 'Are you sure you want to reset all training categories, badge colors, and icons back to standard station defaults?',
      onConfirm: async () => {
        await saveCategoriesList(DEFAULT_TRAINING_CATEGORIES);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
    });
  };

  const handleSaveModal = async (e) => {
    e.preventDefault();
    const labelTrimmed = formData.label.trim();
    if (!labelTrimmed) {
      setModalError('Category name is required.');
      return;
    }
    const shortTrimmed = formData.short.trim() || labelTrimmed;

    let updatedList;
    if (editingCategory) {
      // Editing existing category
      updatedList = categories.map((cat) => {
        if (cat.key === editingCategory.key) {
          return {
            ...cat,
            label: labelTrimmed,
            short: shortTrimmed,
            icon: formData.icon.trim(),
            color: formData.color,
            active: formData.active,
          };
        }
        return cat;
      });
    } else {
      // Creating new category
      const slugKey =
        'cat_' +
        labelTrimmed
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') +
        '_' +
        Date.now().toString().slice(-4);

      const newCategory = {
        key: slugKey,
        label: labelTrimmed,
        short: shortTrimmed,
        icon: formData.icon.trim(),
        color: formData.color,
        active: formData.active,
        order: categories.length + 1,
      };
      updatedList = [...categories, newCategory];
    }

    setModalOpen(false);
    await saveCategoriesList(updatedList);
  };

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden">
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-red-500">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Training Categories</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Manage training classifications, badge labels, icons, and theme colors.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition disabled:opacity-50"
              title="Reset to default category settings"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>
            <button
              type="button"
              onClick={handleOpenAdd}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl shadow-md shadow-red-600/20 transition disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Category
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/80">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Categories Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4 w-12 text-center">Order</th>
                <th className="py-3 px-4">Badge Preview</th>
                <th className="py-3 px-4">Category Name</th>
                <th className="py-3 px-4">Short Code</th>
                <th className="py-3 px-4">Icon</th>
                <th className="py-3 px-4 text-center">Active</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60">
              {categories.map((cat, idx) => {
                const colorClass = getCategoryColorClasses(cat.color);
                return (
                  <tr
                    key={cat.key}
                    className={`hover:bg-slate-50/60 dark:hover:bg-slate-700/30 transition ${
                      !cat.active ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Reorder Buttons */}
                    <td className="py-2.5 px-4 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMove(idx, -1)}
                          disabled={saving || idx === 0}
                          className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                          title="Move up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(idx, 1)}
                          disabled={saving || idx === categories.length - 1}
                          className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                          title="Move down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Badge Preview */}
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colorClass}`}
                      >
                        {cat.icon && <RankIcon name={cat.icon} className="w-3 h-3 shrink-0" />}
                        {cat.short || cat.label}
                      </span>
                    </td>

                    {/* Name */}
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                      {cat.label}
                    </td>

                    {/* Short Code */}
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono text-xs">
                      {cat.short || '—'}
                    </td>

                    {/* Icon */}
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {cat.icon ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <RankIcon name={cat.icon} className="w-4 h-4 text-slate-500" />
                          <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                            {cat.icon}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">None</span>
                      )}
                    </td>

                    {/* Active Toggle */}
                    <td className="py-2.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={cat.active !== false}
                        onChange={() => handleToggleActive(cat.key)}
                        disabled={saving}
                        className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                        title={cat.active ? 'Active' : 'Inactive'}
                      />
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(cat)}
                          disabled={saving}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700/60 transition"
                          title="Edit category"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat)}
                          disabled={saving}
                          className="p-1.5 rounded-lg text-red-500 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
                          title="Delete category"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Category Modal */}
      {modalOpen && (
        <ViewportModal
          title={editingCategory ? 'Edit Training Category' : 'Add Training Category'}
          subtitle="Configure category name, badge label, icon, and badge theme color."
          icon={<GraduationCap className="h-5 w-5 text-red-600 dark:text-red-500" />}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveModal}
          saveLabel={editingCategory ? 'Save Changes' : 'Create Category'}
          saving={saving}
        >
          <div className="space-y-4">
            {modalError && (
              <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-medium bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/80 dark:text-red-400 dark:border-red-800/80">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Live Badge Preview */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 block mb-1">
                  Badge Preview
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${getCategoryColorClasses(
                    formData.color
                  )}`}
                >
                  {formData.icon && <RankIcon name={formData.icon} className="w-3.5 h-3.5 shrink-0" />}
                  {formData.short || formData.label || 'Preview'}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formData.active ? 'Active' : 'Hidden'}
                </span>
              </div>
            </div>

            {/* Category Full Name */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1">
                Category Name *
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder="e.g. Hazardous Materials"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                required
              />
            </div>

            {/* Short Badge Text */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1">
                Badge Text (Short Label)
              </label>
              <input
                type="text"
                value={formData.short}
                onChange={(e) => setFormData({ ...formData, short: e.target.value })}
                placeholder="e.g. Hazmat"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Short abbreviation displayed inside the compact badge on records and tables.
              </p>
            </div>

            {/* Icon Picker */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-1">
                Badge Icon
              </label>
              <div className="flex items-center gap-3">
                <IconPicker
                  value={formData.icon}
                  onChange={(icon) => setFormData({ ...formData, icon })}
                  label="category icon"
                />
                <span className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
                  {formData.icon ? (
                    <RankIcon name={formData.icon} className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                  ) : (
                    <span className="text-xs text-slate-400">None</span>
                  )}
                </span>
                {formData.icon && (
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, icon: '' })}
                    className="text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                  >
                    Clear icon
                  </button>
                )}
              </div>
            </div>

            {/* Badge Color Swatch Selector */}
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2">
                Badge Color
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {TRAINING_CATEGORY_COLORS.map((col) => {
                  const isSelected = formData.color === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: col.id })}
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition ${
                        isSelected
                          ? 'border-red-600 ring-2 ring-red-500/30 bg-red-50/30 dark:bg-red-950/20'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'
                      }`}
                      title={col.label}
                    >
                      <span className={`w-5 h-5 rounded-full ${col.swatch} shadow-sm`} />
                      <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 truncate w-full text-center">
                        {col.id}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Switch */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Active (available for new training records and filters)
                </span>
              </label>
            </div>
          </div>
        </ViewportModal>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        />
      )}
    </div>
  );
}

