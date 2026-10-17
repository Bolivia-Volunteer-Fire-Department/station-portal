import React, { useState } from 'react';
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Calendar,
  CheckSquare,
  Clock,
  FileCode,
  FileText,
  GripVertical,
  Hash,
  List,
  Pencil,
  PenTool,
  Phone,
  Radio,
  SeparatorHorizontal,
  Trash2,
  Type,
} from 'lucide-react';
import FormFieldConfigModal from './FormFieldConfigModal';
import { normalizeEnteredFieldItem } from '../../../utils/formDefinition';

const generateFieldId = (index) =>
  `field_${index + 1}_${Math.random().toString(36).substring(2, 7)}`;

export default function FormBuilderCanvas({ layout = [], onChange }) {
  const [editingItemIndex, setEditingItemIndex] = useState(null);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const addField = (fieldType) => {
    const isMarkdown = fieldType === 'markdown';
    const isDivider = fieldType === 'divider';
    const isNonData = isMarkdown || isDivider;
    const nextIndex = layout.length;

    let defaultCaption = `Question ${nextIndex + 1}`;
    if (isMarkdown) defaultCaption = 'Instructions';
    if (isDivider) defaultCaption = '';
    if (fieldType === 'signature') defaultCaption = 'Member Signature';
    if (fieldType === 'signature_stamp') defaultCaption = 'Acknowledge & Sign';
    if (fieldType === 'tel') defaultCaption = 'Phone Number';

    const defaultDataName = isNonData ? '' : `field_${nextIndex + 1}`;

    const newItem = normalizeEnteredFieldItem(
      {
        id: generateFieldId(nextIndex),
        field_type: fieldType,
        caption: defaultCaption,
        data_name: defaultDataName,
        col_span: isNonData ? 3 : 3,
        required: false,
        markdown_content: isMarkdown ? '### Instructions\nPlease complete all required fields below.' : '',
      },
      nextIndex
    );

    const updated = [...layout, newItem];
    onChange?.(updated);
    setEditingItemIndex(updated.length - 1);
  };

  const handleUpdateItem = (updatedItem) => {
    if (editingItemIndex === null) return;
    const next = [...layout];
    next[editingItemIndex] = updatedItem;
    onChange?.(next);
    setEditingItemIndex(null);
  };

  const handleRemoveItem = (index) => {
    const next = layout.filter((_, i) => i !== index);
    onChange?.(next);
    if (editingItemIndex === index) setEditingItemIndex(null);
  };

  const handleMove = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= layout.length) return;
    const next = [...layout];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange?.(next);
  };

  const handleColSpanChange = (index, colSpan) => {
    const next = [...layout];
    next[index] = { ...next[index], col_span: Number(colSpan) };
    onChange?.(next);
  };

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch {
      // ignore
    }
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    if (draggedIndex !== index) {
      handleMove(draggedIndex, index);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const colSpanClass = (span) => {
    switch (span) {
      case 1:
        return 'col-span-1 md:col-span-1';
      case 2:
        return 'col-span-1 md:col-span-2';
      case 3:
      default:
        return 'col-span-1 md:col-span-3';
    }
  };

  const TOOLBAR_BUTTONS = [
    { type: 'text', label: 'Text', icon: Type },
    { type: 'textarea', label: 'Long Text', icon: AlignLeft },
    { type: 'tel', label: 'Telephone', icon: Phone },
    { type: 'number', label: 'Number', icon: Hash },
    { type: 'date', label: 'Date', icon: Calendar },
    { type: 'time', label: 'Time', icon: Clock },
    { type: 'select', label: 'Dropdown', icon: List },
    { type: 'checkbox', label: 'Checkbox', icon: CheckSquare },
    { type: 'radio', label: 'Radio', icon: Radio },
    { type: 'signature', label: 'E-Signature', icon: PenTool },
    { type: 'signature_stamp', label: 'Signature Stamp', icon: BadgeCheck },
    { type: 'divider', label: 'Divider', icon: SeparatorHorizontal },
    { type: 'markdown', label: 'Instructions', icon: FileCode },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbox Bar */}
      <div className="sticky top-0 z-20 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md p-3 shadow-md">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Add Fields & Instructions
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {TOOLBAR_BUTTONS.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => addField(type)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm"
            >
              <Icon className="w-3.5 h-3.5 text-blue-500" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-4 bg-slate-50/50 dark:bg-slate-900/20 min-h-[260px]">
        {layout.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500 mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Form is empty</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Click any field button above to add inputs, questions, or markdown instructions to this form.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {layout.map((item, index) => {
              const isMarkdown = item.field_type === 'markdown';
              const isDragging = draggedIndex === index;
              const isDragOver = dragOverIndex === index;

              return (
                <div
                  key={item.id || index}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`${colSpanClass(item.col_span || 3)} rounded-xl border transition-all ${
                    isDragOver
                      ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/40 dark:bg-blue-950/20'
                      : isDragging
                      ? 'opacity-40 border-slate-300 bg-white'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm'
                  } p-3 flex flex-col justify-between`}
                >
                  {/* Top Bar of Field Card */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60 pb-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title="Drag to reposition"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                      <span className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        {item.field_type}
                      </span>
                      {item.required && (
                        <span className="rounded bg-red-100 dark:bg-red-950/60 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                          Required
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        value={item.col_span || 3}
                        onChange={(e) => handleColSpanChange(index, e.target.value)}
                        className="h-7 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-1.5"
                        title="Change field width"
                      >
                        <option value={1}>1/3 W</option>
                        <option value={2}>2/3 W</option>
                        <option value={3}>Full W</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => handleMove(index, index - 1)}
                        disabled={index === 0}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 dark:hover:text-slate-200"
                        title="Move Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleMove(index, index + 1)}
                        disabled={index === layout.length - 1}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 disabled:opacity-30 dark:hover:text-slate-200"
                        title="Move Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditingItemIndex(index)}
                        className="p-1 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/50"
                        title="Edit properties"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="p-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50"
                        title="Delete field"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Body Preview */}
                  <div
                    onClick={() => setEditingItemIndex(index)}
                    className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-700/20 rounded p-1 transition"
                  >
                    {item.field_type === 'divider' ? (
                      <div className="py-2">
                        {item.caption ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                              {item.caption}
                            </span>
                            <div className="flex-1 h-px bg-slate-300 dark:bg-slate-600" />
                          </div>
                        ) : (
                          <hr className="border-t-2 border-slate-300 dark:border-slate-600" />
                        )}
                      </div>
                    ) : isMarkdown ? (
                      <div className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 font-mono">
                        {item.markdown_content || 'Empty markdown instructions'}
                      </div>
                    ) : item.field_type === 'signature' ? (
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <PenTool className="w-3.5 h-3.5 text-blue-500" />
                          {item.caption}
                        </div>
                        {item.instructions && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic line-clamp-1 mt-0.5">
                            Note: {item.instructions}
                          </p>
                        )}
                        <div className="mt-1.5 h-12 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center text-[10px] text-slate-400">
                          Finger / Stylus Drawing Area
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-1">
                          Firestore field: <span className="text-blue-600 dark:text-blue-400">{item.data_name}</span>
                        </div>
                      </div>
                    ) : item.field_type === 'signature_stamp' ? (
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <BadgeCheck className="w-3.5 h-3.5 text-emerald-500" />
                          {item.caption}
                        </div>
                        {item.instructions && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic line-clamp-1 mt-0.5">
                            Note: {item.instructions}
                          </p>
                        )}
                        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                          <BadgeCheck className="w-3.5 h-3.5" />
                          <span>Digital Signature Stamp Button</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-1">
                          Firestore field: <span className="text-blue-600 dark:text-blue-400">{item.data_name}</span>
                        </div>
                      </div>
                    ) : item.field_type === 'tel' ? (
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400" />
                          {item.caption}
                        </div>
                        {item.instructions && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic line-clamp-1 mt-0.5">
                            Note: {item.instructions}
                          </p>
                        )}
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                          Format: (XXX) XXX-XXXX • Firestore field: <span className="text-blue-600 dark:text-blue-400">{item.data_name}</span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-white">
                          {item.caption}
                        </div>
                        {item.instructions && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic line-clamp-1 mt-0.5">
                            Note: {item.instructions}
                          </p>
                        )}
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                          Firestore field: <span className="text-blue-600 dark:text-blue-400">{item.data_name}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Field Customization Modal */}
      {editingItemIndex !== null && layout[editingItemIndex] && (
        <FormFieldConfigModal
          item={layout[editingItemIndex]}
          onSave={handleUpdateItem}
          onClose={() => setEditingItemIndex(null)}
        />
      )}
    </div>
  );
}
