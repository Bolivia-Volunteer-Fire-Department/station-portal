import React, { useEffect, useRef, useState } from 'react';
import { Check, Edit3, RotateCcw } from 'lucide-react';
import { parseSignatureValue } from '../../utils/formDefinition';

export default function SignaturePad({
  value = '',
  onChange,
  disabled = false,
  height = 140,
  error = false,
}) {
  const canvasRef = useRef(null);
  const parsed = parseSignatureValue(value);
  const signatureImage = parsed.image;
  const signedDate = parsed.readable_time;
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(Boolean(signatureImage));
  const lastPointRef = useRef({ x: 0, y: 0 });

  // Initialize canvas coordinates and clear/redraw. Always uses pure black ink
  // so exported images/PDFs are authentic black on transparent, while CSS dark:invert
  // presents high-contrast white strokes on dark slate in the UI.
  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.floor(rect.width * dpr);
    const targetHeight = Math.floor(rect.height * dpr);

    if (canvas.width === targetWidth && canvas.height === targetHeight) {
      return;
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#000000';
  };

  useEffect(() => {
    setHasDrawn(Boolean(parsed.image));
  }, [parsed.image]);

  useEffect(() => {
    if (!signatureImage) {
      setupCanvas();
      const timer = setTimeout(setupCanvas, 50);
      window.addEventListener('resize', setupCanvas);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', setupCanvas);
      };
    }
  }, [signatureImage]);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e) => {
    if (disabled || signatureImage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const { x, y } = getCanvasCoords(e);
    lastPointRef.current = { x, y };
    setIsDrawing(true);
    setHasDrawn(true);

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerMove = (e) => {
    if (!isDrawing || disabled || signatureImage) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { x, y } = getCanvasCoords(e);
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPointRef.current = { x, y };
  };

  const handlePointerUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const dataUrl = canvas.toDataURL('image/png');
      const now = new Date();
      const signedAt = now.toISOString();
      const readableTime = now.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      onChange?.({
        image: dataUrl,
        signed_at: signedAt,
        readable_time: readableTime,
      });
    } catch {
      // ignore
    }
  };

  const handleClear = () => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
    onChange?.(null);
    setTimeout(setupCanvas, 0);
  };

  return (
    <div className="space-y-2 select-none">
      <div
        className={`relative rounded-xl border bg-white dark:bg-slate-900 overflow-hidden shadow-inner ${
          error
            ? 'border-red-400 dark:border-red-600 ring-2 ring-red-400/20'
            : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {signatureImage ? (
          <div
            className="flex items-center justify-center p-3 bg-white dark:bg-slate-900"
            style={{ height }}
          >
            <img
              src={signatureImage}
              alt="E-Signature"
              className="max-h-full max-w-full object-contain signature-invert-dark dark:invert print:filter-none"
            />
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              style={{ height, width: '100%' }}
              className="touch-none cursor-crosshair block signature-invert-dark dark:invert"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {/* Signature baseline guide */}
            <div className="pointer-events-none absolute bottom-7 left-8 right-8 border-b border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-between text-[10px] text-slate-400">
              <span>Sign above this line</span>
              <span>✕</span>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
        <span className="flex items-center gap-1.5">
          {signatureImage || hasDrawn ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <Check className="h-3.5 w-3.5" />
              <span>
                Signature captured
                {signedDate ? ` • Signed on ${signedDate}` : ''}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Edit3 className="h-3.5 w-3.5" /> Draw using finger, stylus, or mouse
            </span>
          )}
        </span>

        {!disabled && (signatureImage || hasDrawn) && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-xs font-semibold"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Clear / Redraw
          </button>
        )}
      </div>
    </div>
  );
}


