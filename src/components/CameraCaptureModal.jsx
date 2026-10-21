import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, FlipHorizontal, Loader2, RefreshCw, Smartphone, X, AlertCircle } from 'lucide-react';
import { playSound, modalSoundFor } from '../utils/uiSounds';
import { renderInViewport } from '../utils/viewportLayer';

export default function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
  onFallbackNative,
  occupancyName = '',
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' (rear) or 'user' (front)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [capturedPreview, setCapturedPreview] = useState(null);
  const [photoName, setPhotoName] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // Initialize camera stream
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const startCamera = async () => {
      setLoading(true);
      setError('');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        setError('In-app camera stream is not supported by this browser. You can still use your device camera app.');
        setLoading(false);
        return;
      }

      try {
        const constraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Check if multiple camera devices are available
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          setHasMultipleCameras(videoInputs.length > 1);
        } catch {
          // ignore device enumeration errors
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('Camera error:', err);
        setError(
          err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
            ? 'Camera permission was denied. Please allow camera access in your browser settings or use the system camera.'
            : 'Unable to start camera stream. You can still use your device camera app.'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, facingMode]);

  // Clean up captured preview URL
  useEffect(() => {
    return () => {
      if (capturedPreview) {
        URL.revokeObjectURL(capturedPreview);
      }
    };
  }, [capturedPreview]);

  useEffect(() => {
    if (isOpen) {
      playSound(modalSoundFor('cameraCapture'));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleSnap = () => {
    const video = videoRef.current;
    if (!video) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const previewUrl = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setCapturedPreview(previewUrl);

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
        const cleanName = occupancyName ? `${occupancyName.replace(/[^a-zA-Z0-9_-]/g, '_')}_` : '';
        setPhotoName(`Photo_${cleanName}${dateStr}_${timeStr}.jpg`);
      },
      'image/jpeg',
      0.92
    );
  };

  const handleRetake = () => {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
    }
    setCapturedBlob(null);
    setCapturedPreview(null);
    setPhotoName('');
  };

  const handleConfirmUpload = async () => {
    if (!capturedBlob) return;
    setIsUploading(true);
    try {
      const fileName = photoName.trim() || `Photo_${Date.now()}.jpg`;
      const finalFileName =
        fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg')
          ? fileName
          : `${fileName}.jpg`;
      const file = new File([capturedBlob], finalFileName, { type: 'image/jpeg' });
      await onCapture(file);
      handleClose();
    } catch (err) {
      console.error('Failed to upload captured photo:', err);
      setError(err?.message || 'Failed to upload photo.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    handleRetake();
    onClose();
  };

  return renderInViewport(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-fadeIn">
      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <Camera className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-white">Take Photo</h3>
              <p className="text-xs text-slate-400">
                {occupancyName ? occupancyName : 'Pre-Incident Plan'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isUploading}
            aria-label="Close"
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Viewport / Video Area */}
        <div className="relative aspect-[4/3] w-full bg-black flex items-center justify-center overflow-hidden">
          {capturedPreview ? (
            <img
              src={capturedPreview}
              alt="Captured preview"
              className="h-full w-full object-contain"
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${loading || error ? 'hidden' : 'block'}`}
            />
          )}

          {loading && !capturedPreview && !error && (
            <div className="flex flex-col items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              <span>Starting camera…</span>
            </div>
          )}

          {error && !capturedPreview && (
            <div className="flex max-w-xs flex-col items-center gap-3 p-4 text-center">
              <AlertCircle className="h-8 w-8 text-amber-400" />
              <p className="text-xs text-slate-300">{error}</p>
              {onFallbackNative && (
                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    onFallbackNative();
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500"
                >
                  <Smartphone className="h-4 w-4" />
                  Use Device Camera App
                </button>
              )}
            </div>
          )}
        </div>

        {/* Controls Footer */}
        <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-900/90 p-4">
          {capturedPreview ? (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                  Photo Name / Label
                </label>
                <input
                  type="text"
                  value={photoName}
                  onChange={(e) => setPhotoName(e.target.value)}
                  placeholder="e.g. North Side FDC, Knox Box..."
                  disabled={isUploading}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retake
                </button>

                <button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {isUploading ? 'Uploading Photo…' : 'Upload to Preplan'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              {/* Flip camera button */}
              <div className="w-20">
                {hasMultipleCameras && !loading && !error && (
                  <button
                    type="button"
                    onClick={toggleFacingMode}
                    title="Switch Camera (Front / Back)"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  >
                    <FlipHorizontal className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Shutter Button */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleSnap}
                  disabled={loading || Boolean(error)}
                  title="Snap photo"
                  className="group relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/20 bg-emerald-600 transition hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                >
                  <div className="h-12 w-12 rounded-full border-2 border-slate-900 bg-white transition group-hover:bg-slate-100" />
                </button>
              </div>

              {/* System Camera App Fallback */}
              <div className="flex w-20 justify-end">
                {onFallbackNative && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClose();
                      onFallbackNative();
                    }}
                    title="Open device camera app"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  >
                    <Smartphone className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

