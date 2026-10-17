import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export default function MultiSelectDropdown({
  id,
  options = [],
  value = [],
  onChange,
  placeholder = 'Select one or more options…',
  disabled = false,
  error = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  const selected = Array.isArray(value) ? value : value ? [value] : [];

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && options.length > 5 && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen, options.length]);

  const handleToggleOption = (opt) => {
    if (disabled) return;
    if (selected.includes(opt)) {
      onChange?.(selected.filter((item) => item !== opt));
    } else {
      onChange?.([...selected, opt]);
    }
  };

  const handleRemoveOption = (e, opt) => {
    e.stopPropagation();
    if (disabled) return;
    onChange?.(selected.filter((item) => item !== opt));
  };

  const handleClearAll = (e) => {
    e?.stopPropagation();
    if (disabled) return;
    onChange?.([]);
  };

  const handleSelectAll = (e) => {
    e?.stopPropagation();
    if (disabled) return;
    onChange?.([...options]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      setIsOpen(false);
    }
  };

  const filteredOptions = searchQuery.trim()
    ? options.filter((opt) => opt.toLowerCase().includes(searchQuery.toLowerCase()))
    : options;

  if (disabled) {
    return (
      <div
        id={id}
        className="w-full min-h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2 text-sm flex flex-wrap gap-1.5 items-center select-text"
      >
        {selected.length > 0 ? (
          selected.map((item) => (
            <span
              key={item}
              className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200 border border-blue-200 dark:border-blue-800/80"
            >
              {item}
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500 italic">None selected</span>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown} className="relative w-full">
      {/* Trigger Box */}
      <div
        id={id}
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={`w-full min-h-10 rounded-xl border px-3 py-1.5 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white cursor-pointer flex items-center justify-between gap-2 transition focus:outline-none focus:ring-2 ${
          error
            ? 'border-red-400 focus:ring-red-500 dark:border-red-600'
            : isOpen
            ? 'border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-500'
            : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500 hover:border-slate-400 dark:hover:border-slate-500'
        }`}
      >
        <div className="flex flex-wrap gap-1.5 items-center min-w-0 flex-1 py-0.5">
          {selected.length > 0 ? (
            selected.map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/80 animate-fade-in"
              >
                <span>{item}</span>
                <button
                  type="button"
                  onClick={(e) => handleRemoveOption(e, item)}
                  className="rounded-full p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-900 transition"
                  title={`Remove ${item}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))
          ) : (
            <span className="text-sm text-slate-400 dark:text-slate-500 select-none">
              {placeholder}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 text-slate-400">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition"
              title="Clear all selections"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-blue-500' : ''
            }`}
          />
        </div>
      </div>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-fade-in">
          {/* Search filter for longer option lists */}
          {options.length > 5 && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter choices…"
                  className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Quick Actions Header */}
          {options.length > 1 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-800/40">
              <span>
                {selected.length} of {options.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Select all
                </button>
                <span>&bull;</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}

          {/* Option Items List */}
          <div
            role="listbox"
            aria-multiselectable="true"
            className="max-h-56 overflow-y-auto p-1 divide-y divide-slate-50 dark:divide-slate-800/50"
          >
            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">
                No matching options found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isChecked = selected.includes(opt);
                return (
                  <div
                    key={opt}
                    role="option"
                    aria-selected={isChecked}
                    onClick={() => handleToggleOption(opt)}
                    className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs cursor-pointer transition select-none ${
                      isChecked
                        ? 'bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 font-normal'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          isChecked
                            ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-500 dark:bg-blue-500'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                      <span className="truncate">{opt}</span>
                    </div>

                    {isChecked && (
                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 shrink-0 uppercase tracking-wider">
                        Selected
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

