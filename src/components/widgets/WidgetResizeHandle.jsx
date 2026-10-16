import React, { useState, useRef, useCallback } from 'react';
import { Scaling } from 'lucide-react';

/**
 * Corner resize handle for dashboard widgets.
 * Allows interactive dragging to snap between 1 column, 2 columns, and 3 columns (full width).
 * Also supports clicking to cycle through column spans for accessible touch interaction.
 */
export default function WidgetResizeHandle({
  colSpan = 1,
  onResize,
  disabled = false,
  minColSpan = 1,
  maxColSpan = 3,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewSpan, setPreviewSpan] = useState(colSpan);
  const dragStartRef = useRef({ startX: 0, startSpan: colSpan, gridWidth: 1200, moved: false });

  const handlePointerDown = useCallback(
    (e) => {
      if (disabled) return;
      e.stopPropagation();
      e.preventDefault();

      const handleElem = e.currentTarget;
      try {
        handleElem.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture not supported in some test envs
      }

      // Find the parent grid container to calculate column widths
      const gridElem = handleElem.closest('.dashboard-grid') || handleElem.closest('[class*="grid-cols"]');
      const gridWidth = gridElem ? gridElem.getBoundingClientRect().width : 1200;

      dragStartRef.current = {
        startX: e.clientX,
        startSpan: colSpan,
        gridWidth: Math.max(gridWidth, 400),
        moved: false,
      };

      setIsDragging(true);
      setPreviewSpan(colSpan);
    },
    [colSpan, disabled]
  );

  const handlePointerMove = useCallback(
    (e) => {
      if (!isDragging || disabled) return;
      e.stopPropagation();

      const { startX, startSpan, gridWidth } = dragStartRef.current;
      const deltaX = e.clientX - startX;

      if (Math.abs(deltaX) > 6) {
        dragStartRef.current.moved = true;
      }

      // In a 3-column desktop layout, one column is ~1/3 of the container width
      const colWidth = gridWidth / 3;
      // Snapping threshold: require moving ~35% of a column width to trigger snap
      const spanDelta = Math.round(deltaX / (colWidth * 0.7));
      const targetSpan = Math.min(maxColSpan, Math.max(minColSpan, startSpan + spanDelta));

      setPreviewSpan(targetSpan);
      if (targetSpan !== colSpan) {
        onResize?.(targetSpan);
      }
    },
    [isDragging, disabled, colSpan, onResize, minColSpan, maxColSpan]
  );

  const handlePointerUp = useCallback(
    (e) => {
      if (!isDragging) return;
      e.stopPropagation();
      setIsDragging(false);

      const handleElem = e.currentTarget;
      try {
        if (handleElem.hasPointerCapture(e.pointerId)) {
          handleElem.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }

      // If the user tapped or clicked without dragging, cycle to the next width
      if (!dragStartRef.current.moved) {
        let nextSpan = colSpan + 1;
        if (nextSpan > maxColSpan) nextSpan = minColSpan;
        onResize?.(nextSpan);
      }
    },
    [isDragging, colSpan, onResize, minColSpan, maxColSpan]
  );

  const handlePointerCancel = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (disabled) return null;

  const spanLabel = (span) => {
    switch (span) {
      case 2:
        return '2 Col';
      case 3:
        return 'Full';
      case 1:
      default:
        return '1 Col';
    }
  };

  const currentDisplaySpan = isDragging ? previewSpan : colSpan;

  return (
    <div
      role="slider"
      aria-label="Resize widget width (click to cycle or drag to snap between 1, 2, and 3 columns)"
      aria-valuemin={minColSpan}
      aria-valuemax={maxColSpan}
      aria-valuenow={colSpan}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onResize?.(Math.min(maxColSpan, colSpan + 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          onResize?.(Math.max(minColSpan, colSpan - 1));
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title={`Width: ${spanLabel(colSpan)} (Drag corner to snap or click to cycle width)`}
      className={`group/handle absolute -bottom-1.5 -right-1.5 z-20 flex items-center justify-center p-1 rounded-br-xl rounded-tl-lg cursor-se-resize select-none touch-none transition-all shadow-md ${
        isDragging
          ? 'bg-red-600 text-white ring-4 ring-red-400/50 scale-110 shadow-lg'
          : 'bg-slate-100 hover:bg-red-500 dark:bg-slate-700 dark:hover:bg-red-600 text-slate-500 hover:text-white dark:text-slate-300 border border-slate-300 dark:border-slate-600'
      }`}
    >
      <div className="flex items-center gap-1 px-1">
        <span className="text-[10px] font-bold tracking-tight">
          {spanLabel(currentDisplaySpan)}
        </span>
        {/* Corner angled grab stripes SVG */}
        <svg
          className="w-3.5 h-3.5 shrink-0 opacity-70 group-hover/handle:opacity-100"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="14" y1="2" x2="2" y2="14" />
          <line x1="14" y1="7" x2="7" y2="14" />
          <line x1="14" y1="12" x2="12" y2="14" />
        </svg>
      </div>

      {isDragging && (
        <div className="absolute -top-7 right-0 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-semibold tracking-wide whitespace-nowrap shadow-lg pointer-events-none animate-fadeIn">
          Snap: {spanLabel(previewSpan)} ({previewSpan} / 3 cols)
        </div>
      )}
    </div>
  );
}

