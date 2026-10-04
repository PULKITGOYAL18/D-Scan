import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import { DOCUMENT_TYPES, SCANNER_CONFIG, INSTITUTE_TEMPLATES, UPLOAD_LIMITS } from './config.js';
import {
  distance,
  orderCorners,
  correctPerspective,
  applyEnhancement,
  rotateImage,
} from './imageProcessing.js';
import {
  detectDocumentCorners,
  checkAutoCapture,
  getFixedCropCorners,
  processScannedImage,
} from './scanner.js';
import {
  deletePage,
  reorderPages,
  rotatePage,
  updatePageEnhancements,
  setPageOverlays,
} from './pageManager.js';
import {
  buildTemplateOverlays,
  renderFinalPage,
} from './instituteElements.js';
import {
  exportToPdf,
  exportToImage,
  exportToDocx,
} from './export.js';
import { usePWA } from './pwa.js';
import { clearAllLocalData } from './storage.js';

import {
  FileText,
  Camera,
  UploadCloud,
  Plus,
  Trash2,
  RotateCw,
  ChevronUp,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  Check,
  Download,
  Zap,
  ZapOff,
  Sparkles,
  Crop,
  Maximize2,
  Ban,
  ShieldCheck,
  CheckCircle,
  Sliders,
  Move,
  Upload,
  Share,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
  HelpCircle,
  SquarePlus,
  Smartphone,
  X,
} from 'lucide-react';

// ----------------------------------------------------------------------------
// Small pure helpers (module scope so they never change between renders)
// ----------------------------------------------------------------------------
const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

// Every page object gets a stable `id` (React key / lookup) and a `sourceId`
// (identity of the ONE scanned/uploaded source it came from). The pages array
// refuses to hold two entries with the same sourceId.
const stampPage = (page) => ({
  ...page,
  id: page.id ?? newId(),
  sourceId: page.sourceId ?? newId(),
});

// A scan of one source image must yield exactly one page object. If a helper
// ever returns a list (e.g. [original, processed]) keep only the processed
// result (the last one) so the original can never become its own page.
const toSinglePage = (result) => (Array.isArray(result) ? result[result.length - 1] : result);

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('File read failed'));
    r.readAsDataURL(file);
  });

const freshStabilityState = () => ({
  consecutiveStableFrames: 0,
  lastCorners: null,
  lastCaptureTime: 0,
  message: SCANNER_CONFIG.messages.idle,
});

export default function App() {
  const {
    isInstallable,
    isInstalled,
    isOnline,
    isIOS,
    showIOSPrompt,
    installApp,
    openIOSPrompt,
    closeIOSPrompt,
  } = usePWA();

  const [dismissedIOSBanner, setDismissedIOSBanner] = useState(false);

  // Navigation Steps:
  // 'home' | 'camera' | 'crop' | 'page_manager' |
  // 'institute_upload' | 'template_select' | 'custom_template' | 'final_preview' | 'export'
  const [step, setStep] = useState('home');

  // Document Profile & Orientation Settings
  const [docType, setDocType] = useState('a4'); // 'a4' | 'a3' | 'passport'
  const [docOrientation, setDocOrientation] = useState('portrait'); // 'portrait' | 'landscape'
  const [cropMode, setCropMode] = useState('auto'); // 'auto' | 'fixed' | 'off'
  const [enhancementMode, setEnhancementMode] = useState('auto'); // 'auto' | 'original' | 'grayscale' | 'bw'

  // Multi-page State
  // INVARIANT: one scanned/uploaded source image === exactly one entry here.
  // originalImage / processedImage are properties of that one entry.
  const [pages, setPages] = useState([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [showOriginalPreview, setShowOriginalPreview] = useState(false);
  const [showManualTuning, setShowManualTuning] = useState(false);

  // When true, the next change of `pages` selects the last page. This replaces
  // calling setSelectedPageIndex() inside a setPages() updater, which is a
  // side effect inside a function React may run twice (StrictMode).
  const selectLastRef = useRef(false);
  useEffect(() => {
    if (selectLastRef.current) {
      selectLastRef.current = false;
      setSelectedPageIndex(Math.max(0, pages.length - 1));
    }
  }, [pages]);

  // Friendly in-app feedback banner
  const [bannerMessage, setBannerMessage] = useState(null);
  const bannerTimerRef = useRef(null);

  const showNotification = useCallback((msg, isError = false) => {
    setBannerMessage({ text: msg, isError });
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setBannerMessage(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    },
    []
  );

  // --------------------------------------------------------------------------
  // The ONLY places pages are created / replaced
  // --------------------------------------------------------------------------
  // Add brand-new pages. Idempotent: a page whose sourceId is already present
  // is ignored, so the same source can never be added twice, no matter how
  // many times an event/callback/updater fires.
  const appendPages = useCallback((incoming) => {
    const stamped = incoming.filter(Boolean).map(stampPage);
    if (stamped.length === 0) return;
    selectLastRef.current = true;
    setPages((prev) => {
      const seen = new Set(prev.map((p) => p.sourceId));
      const fresh = [];
      for (const p of stamped) {
        if (seen.has(p.sourceId)) continue;
        seen.add(p.sourceId);
        fresh.push(p);
      }
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Replace an existing page IN PLACE (matched by id, never by a possibly
  // stale index). Never changes pages.length.
  const commitPageUpdate = useCallback((pageId, updated) => {
    if (!updated) return;
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...updated, id: p.id, sourceId: p.sourceId } : p))
    );
  }, []);

  // Manual Touch Crop State
  const [croppingImage, setCroppingImage] = useState(null);
  // null = create a new page; string = id of the existing page to update in-place
  const [editingCropPageId, setEditingCropPageId] = useState(null);
  const [cropCorners, setCropCorners] = useState([]);
  const [showLargeHandles, setShowLargeHandles] = useState(false);
  const [cropNaturalDim, setCropNaturalDim] = useState({ width: 0, height: 0 });
  const [cropDisplayDim, setCropDisplayDim] = useState({ width: 0, height: 0 });
  const [activeCropCorner, setActiveCropCorner] = useState(null);
  const cropImgRef = useRef(null);
  const isApplyingCropRef = useRef(false);

  // Gallery lock (a second change event can't start while one is processing)
  const isUploadingRef = useRef(false);

  // Camera State
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const camRequestRef = useRef(0);
  const isAnalyzingRef = useRef(false);
  // One capture lock. It is taken when a capture starts and is NOT released
  // after a successful hand-off (page added / crop screen opened) until the
  // camera screen is entered again. It is released immediately on failure.
  const isCapturingRef = useRef(false);
  const lastAnalyzeTimeRef = useRef(0);
  const [cameraStatus, setCameraStatus] = useState(SCANNER_CONFIG.messages.idle);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [isShutterFlashing, setIsShutterFlashing] = useState(false);
  const stabilityRef = useRef(freshStabilityState());

  // Institute Elements Uploads (ZERO default/fake assets! Explicit uploads only)
  const [uploadedAssets, setUploadedAssets] = useState({
    logo: null,
    signature: null,
    stamp: null,
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState('standard');

  // Custom Template Placement Editor
  const [customOverlays, setCustomOverlays] = useState([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [editingTargetPageIndex, setEditingTargetPageIndex] = useState(0);
  const customCanvasRef = useRef(null);
  const [dragItem, setDragItem] = useState(null);

  // Export State
  const [fileName, setFileName] = useState(`DScan_${new Date().toISOString().slice(0, 10)}`);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState(null);

  // --------------------------------------------------------------------------
  // Crop screen preparation (defined before captureFrame, which uses it)
  // Resolves true when the crop screen was opened, false on failure.
  // --------------------------------------------------------------------------
  const prepareCropStep = useCallback(
    async (imageDataUrl, preDetectedCorners = null, targetPageId = null) => {
      try {
        const img = await loadImage(imageDataUrl);

        let initial = preDetectedCorners;
        let detected = Boolean(initial && initial.length === 4);

        // If no corners were supplied, try a fresh document detection before
        // falling back to the size-aware fixed frame.
        if (!detected) {
          try {
            const result = detectDocumentCorners(img, docType, docOrientation);
            if (result?.detected && result?.corners?.length === 4) {
              initial = result.corners;
              detected = true;
            }
          } catch {
            // Detection failure is handled by the fixed-frame fallback below.
          }
        }

        if (!detected) {
          initial = getFixedCropCorners(img.width, img.height, docType, docOrientation, 0.06);
        }

        setCroppingImage(imageDataUrl);
        setEditingCropPageId(targetPageId);
        setCropNaturalDim({ width: img.width, height: img.height });
        setCropCorners(initial);
        // Show handles immediately when automatic detection did not succeed so
        // the user is never told that a crop was detected when it was not.
        setShowLargeHandles(!detected);
        setStep('crop');
        if (!detected) {
          showNotification('Document boundary was not detected automatically. Adjust the crop manually.', true);
        }
        return true;
      } catch {
        showNotification('Unable to open this image for cropping.', true);
        return false;
      }
    },
    [docType, docOrientation, showNotification]
  );

  // --------------------------------------------------------------------------
  // Camera Management
  // --------------------------------------------------------------------------
  const stopCamera = useCallback(() => {
    // Invalidate any getUserMedia request that is still pending so a stream
    // that arrives late (or in StrictMode's mount/unmount/mount) is discarded.
    camRequestRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const requestId = ++camRequestRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (requestId !== camRequestRef.current) {
        // A newer start/stop happened while waiting for permission.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities && track.getCapabilities()) || {};
      setHasTorch('torch' in caps);
    } catch {
      if (requestId === camRequestRef.current) {
        setCameraStatus('Camera permission is required. You can also upload from Gallery.');
      }
    }
  }, [facingMode]);

  // Entering the camera screen always starts from a clean capture state, so
  // the lock from the previous capture and its "stable frames" counter can't
  // leak into the next scan (and can't trigger an instant second capture).
  useEffect(() => {
    if (step === 'camera') {
      isCapturingRef.current = false;
      isAnalyzingRef.current = false;
      lastAnalyzeTimeRef.current = 0;
      stabilityRef.current = freshStabilityState();
      setCameraStatus(SCANNER_CONFIG.messages.idle);
    }
  }, [step]);

  useEffect(() => {
    if (step === 'camera') {
      startCamera();
    } else {
      stopCamera();
    }
    return stopCamera;
  }, [step, startCamera, stopCamera]);

  const toggleTorch = async () => {
    if (!streamRef.current || !hasTorch) return;
    const track = streamRef.current.getVideoTracks()[0];
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn);
    } catch { }
  };

  // Capture frame from camera. ONE call creates AT MOST ONE page.
  const captureFrame = useCallback(
    async (detectedCorners = null) => {
      // Ignore duplicate camera/shutter triggers while a capture is in flight
      // OR has already been handed off (until the camera screen is re-entered).
      if (isCapturingRef.current) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;

      isCapturingRef.current = true;
      let handedOff = false;
      try {
        setIsShutterFlashing(true);
        setTimeout(() => setIsShutterFlashing(false), 180);

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.94);

        if (cropMode === 'auto' && !detectedCorners) {
          // Auto Crop without a successful detection goes to the manual crop screen.
          handedOff = await prepareCropStep(dataUrl, null, null);
          return;
        }

        const options = {
          documentType: docType,
          orientation: docOrientation,
          cropMode,
          enhancementMode,
        };
        if (cropMode === 'auto') options.manualCorners = detectedCorners;

        const newPage = toSinglePage(await processScannedImage(dataUrl, options));
        appendPages([newPage]);
        handedOff = true;
        setStep('page_manager');
      } catch {
        showNotification('Capture failed. Please try again.', true);
      } finally {
        // Only a FAILED capture releases the lock here. After a successful
        // hand-off the lock stays until the camera screen is entered again.
        if (!handedOff) isCapturingRef.current = false;
      }
    },
    [cropMode, docType, docOrientation, enhancementMode, prepareCropStep, appendPages, showNotification]
  );

  // Real-time camera auto-capture loop
  useEffect(() => {
    if (step !== 'camera') return;
    let isCancelled = false;

    const loop = async () => {
      if (isCancelled) return;
      const now = performance.now();

      if (
        !isCapturingRef.current &&
        !isAnalyzingRef.current &&
        now - lastAnalyzeTimeRef.current >= SCANNER_CONFIG.frameIntervalMs &&
        videoRef.current &&
        videoRef.current.readyState === 4 &&
        videoRef.current.videoWidth > 0
      ) {
        isAnalyzingRef.current = true;
        lastAnalyzeTimeRef.current = now;

        try {
          if (cropMode === 'auto') {
            const det = detectDocumentCorners(videoRef.current, docType, docOrientation);
            const corners = det.detected ? det.corners : null;
            const { nextState, triggerCapture } = checkAutoCapture(
              stabilityRef.current,
              corners
            );
            stabilityRef.current = nextState;
            setCameraStatus(nextState.message);

            if (triggerCapture && !isCapturingRef.current && !isCancelled) {
              await captureFrame(corners);
            }
          } else {
            setCameraStatus('Auto Crop OFF — Tap Shutter');
          }
        } catch {
        } finally {
          isAnalyzingRef.current = false;
        }
      }

      if (!isCancelled) {
        animFrameRef.current = requestAnimationFrame(loop);
      }
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      isCancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [step, cropMode, docType, docOrientation, captureFrame]);

  // --------------------------------------------------------------------------
  // Gallery Upload with Safety Validation
  // N selected files -> N pages. A second change event cannot overlap.
  // --------------------------------------------------------------------------
  const handleGalleryUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    // Reset the input so the same file can be chosen again later, and so this
    // change event can never be replayed for the same selection.
    e.target.value = '';
    if (files.length === 0) return;
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;

    try {
      const incoming = [];
      for (const file of files) {
        if (!UPLOAD_LIMITS.allowedMimeTypes.includes(file.type)) {
          showNotification('Please upload a PNG, JPG, JPEG, or WebP image.', true);
          continue;
        }

        if (file.size > UPLOAD_LIMITS.maxSizeBytes) {
          showNotification('This image is too large to process reliably. Please choose a smaller image.', true);
          continue;
        }

        try {
          const dataUrl = await readFileAsDataUrl(file);

          if (cropMode === 'auto' && files.length === 1) {
            // Single image in Auto Crop: use detection when it works, otherwise
            // open the manual crop screen instead of silently guessing.
            const img = await loadImage(dataUrl);
            let det = null;
            try {
              det = detectDocumentCorners(img, docType, docOrientation);
            } catch {
              det = null;
            }
            if (!det?.detected || det.corners?.length !== 4) {
              await prepareCropStep(dataUrl, null, null);
              return;
            }
            incoming.push(
              toSinglePage(
                await processScannedImage(dataUrl, {
                  documentType: docType,
                  orientation: docOrientation,
                  cropMode: 'auto',
                  manualCorners: det.corners,
                  enhancementMode,
                })
              )
            );
          } else {
            incoming.push(
              toSinglePage(
                await processScannedImage(dataUrl, {
                  documentType: docType,
                  orientation: docOrientation,
                  cropMode,
                  enhancementMode,
                })
              )
            );
          }
        } catch {
          showNotification(`Could not process ${file.name}.`, true);
        }
      }

      if (incoming.length > 0) {
        appendPages(incoming);
        setStep('page_manager');
      }
    } finally {
      isUploadingRef.current = false;
    }
  };

  // --------------------------------------------------------------------------
  // Size-Aware Touch Crop
  // --------------------------------------------------------------------------
  const handleAutoDetectAgain = () => {
    if (!cropImgRef.current) return;
    const det = detectDocumentCorners(cropImgRef.current, docType, docOrientation);
    if (det.detected && det.corners) {
      setCropCorners(det.corners);
    } else {
      setCropCorners(getFixedCropCorners(cropNaturalDim.width, cropNaturalDim.height, docType, docOrientation));
    }
    setShowLargeHandles(true);
  };

  const handleCropPointerDown = (e) => {
    if (!cropImgRef.current || !showLargeHandles) return;
    const rect = cropImgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = cropDisplayDim.width / cropNaturalDim.width;
    const scaleY = cropDisplayDim.height / cropNaturalDim.height;

    let closestIdx = null;
    let minDist = 50; // Minimum touch grab radius (44-50px)
    cropCorners.forEach((p, idx) => {
      const screenX = p.x * scaleX;
      const screenY = p.y * scaleY;
      const d = Math.hypot(clientX - screenX, clientY - screenY);
      if (d < minDist) {
        minDist = d;
        closestIdx = idx;
      }
    });

    if (closestIdx !== null) {
      setActiveCropCorner(closestIdx);
      if (e.target && e.target.setPointerCapture) {
        e.target.setPointerCapture(e.pointerId);
      }
    }
  };

  const handleCropPointerMove = (e) => {
    if (activeCropCorner === null || !cropImgRef.current) return;
    const rect = cropImgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = cropDisplayDim.width / cropNaturalDim.width;
    const scaleY = cropDisplayDim.height / cropNaturalDim.height;

    const natX = Math.max(0, Math.min(cropNaturalDim.width, Math.round(clientX / scaleX)));
    const natY = Math.max(0, Math.min(cropNaturalDim.height, Math.round(clientY / scaleY)));

    setCropCorners((prev) => {
      const copy = [...prev];
      copy[activeCropCorner] = { x: natX, y: natY };
      return copy;
    });
  };

  const handleCropPointerUp = () => {
    setActiveCropCorner(null);
  };

  const resetCropState = () => {
    setCroppingImage(null);
    setEditingCropPageId(null);
    setCropCorners([]);
    setActiveCropCorner(null);
  };

  const applyCropAndContinue = async () => {
    if (!croppingImage || cropCorners.length !== 4) return;
    // Double-tap / double-fire protection: one crop apply at a time.
    if (isApplyingCropRef.current) return;
    isApplyingCropRef.current = true;

    try {
      const targetId = editingCropPageId;
      const existing = targetId ? pages.find((p) => p.id === targetId) : null;

      // We were editing a page that has since been deleted: do NOT turn this
      // into a new page.
      if (targetId && !existing) {
        showNotification('That page no longer exists, so the crop was not applied.', true);
        resetCropState();
        setStep(pages.length > 0 ? 'page_manager' : 'home');
        return;
      }

      const processedPage = toSinglePage(
        await processScannedImage(croppingImage, {
          documentType: docType,
          orientation: docOrientation,
          cropMode: 'auto',
          manualCorners: cropCorners,
          enhancementMode: existing?.enhancementMode || enhancementMode,
        })
      );

      if (existing) {
        // EXISTING page: replace that same page in place. pages.length unchanged.
        commitPageUpdate(existing.id, {
          ...processedPage,
          overlays: existing.overlays || [],
        });
        const idx = pages.findIndex((p) => p.id === existing.id);
        if (idx >= 0) setSelectedPageIndex(idx);
        showNotification(`Crop updated for Page ${idx + 1}.`);
      } else {
        // NEW source: exactly one new page.
        appendPages([processedPage]);
        showNotification('New page added.');
      }

      resetCropState();
      setStep('page_manager');
    } catch {
      showNotification('Unable to apply the crop. Please try again.', true);
    } finally {
      isApplyingCropRef.current = false;
    }
  };

  // --------------------------------------------------------------------------
  // Auto Enhance & Manual Levels Tuning (all update the SAME page by id)
  // --------------------------------------------------------------------------
  const handleAutoEnhancePage = async (pageIndex) => {
    const page = pages[pageIndex];
    if (!page) return;
    setShowOriginalPreview(false);
    const updated = await updatePageEnhancements(page, {
      enhancementMode: 'auto',
      brightness: 0,
      contrast: 0,
    });
    commitPageUpdate(page.id, updated);
  };

  const handleSetPageEnhancement = async (pageIndex, mode) => {
    const page = pages[pageIndex];
    if (!page) return;
    setShowOriginalPreview(false);
    const updated = await updatePageEnhancements(page, {
      enhancementMode: mode,
    });
    commitPageUpdate(page.id, updated);
  };

  const handleManualBrightness = async (pageIndex, val) => {
    const page = pages[pageIndex];
    if (!page) return;
    const updated = await updatePageEnhancements(page, {
      brightness: val,
    });
    commitPageUpdate(page.id, updated);
  };

  const handleManualContrast = async (pageIndex, val) => {
    const page = pages[pageIndex];
    if (!page) return;
    const updated = await updatePageEnhancements(page, {
      contrast: val,
    });
    commitPageUpdate(page.id, updated);
  };

  const handleResetManualSettings = async (pageIndex) => {
    const page = pages[pageIndex];
    if (!page) return;
    const updated = await updatePageEnhancements(page, {
      brightness: 0,
      contrast: 0,
    });
    commitPageUpdate(page.id, updated);
  };

  const handleRotatePage = async (page) => {
    if (!page) return;
    const rotated = await rotatePage(page);
    commitPageUpdate(page.id, rotated);
  };

  // --------------------------------------------------------------------------
  // Institute Elements Upload (User uploads only)
  // --------------------------------------------------------------------------
  const handleAssetUpload = (type, e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!UPLOAD_LIMITS.allowedMimeTypes.includes(file.type)) {
      showNotification('Please upload a PNG, JPG, JPEG, or WebP image.', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setUploadedAssets((prev) => ({ ...prev, [type]: dataUrl }));
      showNotification(`${type.charAt(0).toUpperCase() + type.slice(1)} uploaded successfully.`);
    };
    reader.readAsDataURL(file);
  };

  const removeUploadedAsset = (type) => {
    setUploadedAssets((prev) => ({ ...prev, [type]: null }));
  };

  const openTemplateSelection = (targetIndex = selectedPageIndex) => {
    setEditingTargetPageIndex(targetIndex);
    setStep('template_select');
  };

  const openCustomTemplateEditor = (targetIndex = selectedPageIndex) => {
    setEditingTargetPageIndex(targetIndex);
    const targetPage = pages[targetIndex] || pages[0];

    let initialOverlays = targetPage?.overlays;
    if (!initialOverlays || initialOverlays.length === 0) {
      initialOverlays = buildTemplateOverlays(selectedTemplateId, uploadedAssets);
    }

    setCustomOverlays([...initialOverlays]);
    setSelectedOverlayId(initialOverlays[0]?.id || null);
    setStep('custom_template');
  };

  // Applying overlays maps over the existing pages (same length in, same out).
  const applyOverlays = (overlaysToApply, applyToAll = false) => {
    if (applyToAll) {
      setPages((prev) => prev.map((p) => setPageOverlays(p, overlaysToApply)));
      showNotification(`Applied to all ${pages.length} pages.`);
    } else {
      const targetId = pages[editingTargetPageIndex]?.id;
      setPages((prev) =>
        prev.map((p) => (p.id === targetId ? setPageOverlays(p, overlaysToApply) : p))
      );
      showNotification(`Applied to Page ${editingTargetPageIndex + 1}.`);
    }
    setStep('final_preview');
  };

  const handleOverlayPointerDown = (id, e) => {
    e.stopPropagation();
    setSelectedOverlayId(id);
    const item = customOverlays.find((o) => o.id === id);
    if (!item || !customCanvasRef.current) return;

    if (e.target && e.target.setPointerCapture) {
      e.target.setPointerCapture(e.pointerId);
    }
    setDragItem({
      id,
      startX: e.clientX,
      startY: e.clientY,
      initX: item.x,
      initY: item.y,
    });
  };

  const handleOverlayPointerMove = (e) => {
    if (!dragItem || !customCanvasRef.current) return;
    const rect = customCanvasRef.current.getBoundingClientRect();
    const deltaX = (e.clientX - dragItem.startX) / rect.width;
    const deltaY = (e.clientY - dragItem.startY) / rect.height;

    const targetItem = customOverlays.find((o) => o.id === dragItem.id);
    const itemW = targetItem ? targetItem.width : 0.16;
    // Calculate usable boundary so the entire element remains completely inside the page
    const maxX = Math.max(0, 1.0 - itemW);
    const estimatedH = itemW * (rect.width / Math.max(1, rect.height));
    const maxY = Math.max(0, 1.0 - Math.min(0.85, estimatedH));

    const newX = Math.max(0, Math.min(maxX, dragItem.initX + deltaX));
    const newY = Math.max(0, Math.min(maxY, dragItem.initY + deltaY));

    setCustomOverlays((prev) =>
      prev.map((o) => (o.id === dragItem.id ? { ...o, x: newX, y: newY } : o))
    );
  };

  const handleOverlayPointerUp = () => {
    setDragItem(null);
  };

  const resizeSelectedOverlay = (factor) => {
    if (!selectedOverlayId) return;
    setCustomOverlays((prev) =>
      prev.map((o) => {
        if (o.id === selectedOverlayId) {
          const newW = Math.max(0.06, Math.min(0.45, o.width * factor));
          const clampedX = Math.min(o.x, Math.max(0, 1.0 - newW));
          return { ...o, width: newW, x: clampedX };
        }
        return o;
      })
    );
  };

  const rotateSelectedOverlay = () => {
    if (!selectedOverlayId) return;
    setCustomOverlays((prev) =>
      prev.map((o) => {
        if (o.id === selectedOverlayId) {
          return { ...o, rotation: ((o.rotation || 0) + 90) % 360 };
        }
        return o;
      })
    );
  };

  const deleteSelectedOverlay = () => {
    if (!selectedOverlayId) return;
    setCustomOverlays((prev) => prev.filter((o) => o.id !== selectedOverlayId));
    setSelectedOverlayId(null);
  };

  const resetCustomPositions = () => {
    const reset = buildTemplateOverlays(selectedTemplateId, uploadedAssets);
    setCustomOverlays(reset);
    setSelectedOverlayId(reset[0]?.id || null);
  };

  // --------------------------------------------------------------------------
  // Exports
  // --------------------------------------------------------------------------
  const handleExportDownload = async (format) => {
    setIsExporting(true);
    setExportNotice(null);
    try {
      if (format === 'pdf') {
        await exportToPdf(pages, fileName);
        setExportNotice(`Downloaded ${fileName}.pdf`);
      } else if (format === 'docx') {
        await exportToDocx(pages, fileName);
        setExportNotice(`Downloaded ${fileName}.docx`);
      } else if (format === 'jpg' || format === 'png') {
        await exportToImage(pages, format, fileName);
        setExportNotice(
          pages.length > 1
            ? `Downloaded ${fileName}_pages.zip`
            : `Downloaded ${fileName}.${format}`
        );
      }
    } catch {
      showNotification('Export failed. Please try again.', true);
    } finally {
      setIsExporting(false);
    }
  };

  // Clear Session & Local Data
  const handleClearSession = async () => {
    setPages([]);
    setSelectedPageIndex(0);
    setUploadedAssets({ logo: null, signature: null, stamp: null });
    await clearAllLocalData();
    setStep('home');
    showNotification('Session cleared. All temporary document data removed from device.');
  };

  // Active page for preview
  const activePage = pages[selectedPageIndex] || pages[0];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 select-none">
      {/* Header - Pure Light Professional Styling */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => {
              if (pages.length === 0) setStep('home');
              else setStep('page_manager');
            }}
          >
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shadow-xs">
              <FileText className="w-5 h-5 stroke-[2.4]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-lg tracking-tight text-slate-900">
                  D-Scan
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                  OFFLINE
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium hidden sm:block">
                Scan, Enhance & Brand Documents in One Place.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isOnline && (
              <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-lg">
                Offline
              </span>
            )}

            {pages.length > 0 && (
              <button
                onClick={handleClearSession}
                className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 px-2.5 py-1.5 rounded-lg transition"
                title="Wipe active scans from device memory"
              >
                Clear Data
              </button>
            )}

            {/* PWA Install Button */}
            {isInstalled ? (
              <span className="hidden sm:flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs font-bold px-3 py-1.5 rounded-xl">
                <Check className="w-3.5 h-3.5" />
                App Installed
              </span>
            ) : isInstallable ? (
              <button
                onClick={installApp}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-xs transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Install D-Scan</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {/* In-app Notification Banner */}
      {bannerMessage && (
        <div
          className={`fixed top-18 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl shadow-lg border text-xs font-bold flex items-center gap-2 animate-fadeIn ${bannerMessage.isError
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
        >
          {bannerMessage.isError ? <AlertCircle className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          <span>{bannerMessage.text}</span>
        </div>
      )}

      {/* iOS Safari Floating Guidance Bar (for non-standalone mobile Safari) */}
      {isIOS && !isInstalled && !dismissedIOSBanner && (
        <div className="fixed bottom-4 left-4 right-4 z-40 max-w-md mx-auto bg-slate-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700/60 flex items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
              <Share className="w-4 h-4 text-white" />
            </div>
            <div className="text-left min-w-0">
              <p className="text-xs font-bold truncate">Install D-Scan on iPhone</p>
              <p className="text-[11px] text-slate-300 leading-tight truncate">
                Tap Share <Share className="inline w-3 h-3 mx-0.5 text-blue-400" /> then 'Add to Home Screen'
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={openIOSPrompt}
              className="text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-xl cursor-pointer shadow-xs transition active:scale-95"
            >
              Guide
            </button>
            <button
              onClick={() => setDismissedIOSBanner(true)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer transition"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* iOS / Browser Install Instructions Modal */}
      {showIOSPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white text-slate-900 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl border border-slate-200 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto shadow-xs">
              <Smartphone className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-black text-slate-900">
                {isIOS ? 'Install D-Scan on iPhone / iPad' : 'Install D-Scan'}
              </h3>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                Add D-Scan to your Home Screen for a fast, standalone full-screen scanner that works offline.
              </p>
            </div>

            {isIOS ? (
              <div className="space-y-2.5 text-left bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div>
                    <span className="font-bold text-slate-800">Tap the Share button</span>
                    <p className="text-slate-500 text-[11px]">
                      Located in the bottom Safari toolbar <Share className="inline w-3.5 h-3.5 text-blue-600 mx-0.5" />.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div>
                    <span className="font-bold text-slate-800">Select 'Add to Home Screen'</span>
                    <p className="text-slate-500 text-[11px]">
                      Scroll down the share sheet and tap <SquarePlus className="inline w-3.5 h-3.5 text-slate-700 mx-0.5" /> <strong>Add to Home Screen</strong>.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div>
                    <span className="font-bold text-slate-800">Tap 'Add' in Top Right</span>
                    <p className="text-slate-500 text-[11px]">
                      Confirm to place the D-Scan icon directly on your Home Screen.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-left bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs text-slate-600 space-y-2">
                <p>
                  Use your browser menu (<span className="font-mono font-bold">⋮</span> or <span className="font-mono font-bold">⋯</span>) and tap <strong>'Install App'</strong> or <strong>'Add to Home Screen'</strong>.
                </p>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-[11px] text-emerald-800 font-semibold bg-emerald-50 py-2 px-3 rounded-xl border border-emerald-200">
              <Check className="w-3.5 h-3.5" />
              <span>Full-screen view • Works offline • No store download</span>
            </div>

            <button
              onClick={closeIOSPrompt}
              className="btn-large w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-3 cursor-pointer shadow-xs"
            >
              Done / Got it
            </button>
          </div>
        </div>
      )}

      {/* Main Viewport */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col justify-center">
        {/* ================================================================ */}
        {/* STEP 1: Simple Main UI with Profile & Orientation Selectors     */}
        {/* ================================================================ */}
        {step === 'home' && (
          <div className="w-full max-w-xl mx-auto space-y-6 text-center animate-fadeIn py-3">
            {/* Branding Header */}
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                Local & Account-Free
              </div>
              <h1 className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight">
                D-Scan
              </h1>
              <p className="text-sm text-slate-600 font-medium">
                Scan, Enhance & Brand Documents in One Place.
              </p>
              <p className="text-[11px] text-slate-400">
                Documents are processed locally in your browser and are not uploaded to D-Scan servers.
              </p>
            </div>

            {/* Primary Main Actions: [ Camera ] & [ Gallery ] */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => setStep('camera')}
                className="p-7 rounded-3xl border-2 border-slate-200 hover:border-blue-600 bg-white text-center transition flex flex-col items-center justify-center gap-2.5 shadow-xs hover:shadow-md cursor-pointer"
              >
                <div className="p-3.5 rounded-2xl bg-blue-100 text-blue-600">
                  <Camera className="w-8 h-8" />
                </div>
                <div>
                  <span className="text-lg font-bold text-slate-900 block">Camera</span>
                  <span className="text-xs text-slate-500">Hands-free boundary detection</span>
                </div>
              </button>

              <label className="p-7 rounded-3xl border-2 border-slate-200 hover:border-indigo-600 bg-white text-center transition flex flex-col items-center justify-center gap-2.5 shadow-xs hover:shadow-md cursor-pointer">
                <div className="p-3.5 rounded-2xl bg-indigo-100 text-indigo-600">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <div>
                  <span className="text-lg font-bold text-slate-900 block">Gallery</span>
                  <span className="text-xs text-slate-500">Choose images from device</span>
                </div>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                  multiple
                  onChange={handleGalleryUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Document Profile & Settings Section */}
            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4 text-left">
              {/* Document Profile Selector (A4, A3, Passport Photo) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Document Profile
                  </label>
                  <span className="text-[11px] font-mono font-semibold text-blue-600">
                    Ratio: {DOCUMENT_TYPES[docType].size}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Object.keys(DOCUMENT_TYPES).map((key) => {
                    const doc = DOCUMENT_TYPES[key];
                    const isSel = docType === key;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setDocType(key);
                          if (key === 'passport') setDocOrientation('portrait');
                        }}
                        className={`py-3 px-2 rounded-2xl border text-center transition cursor-pointer flex flex-col items-center justify-center ${isSel
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold shadow-xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                          }`}
                      >
                        <span className="text-sm font-bold">{doc.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono mt-0.5">{doc.size}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Orientation Selector: Portrait vs Landscape */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Orientation
                  </label>
                  {DOCUMENT_TYPES[docType].portraitOnly && (
                    <span className="text-[11px] font-medium text-amber-700">
                      Passport Photo is portrait only (35 × 45 mm)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDocOrientation('portrait')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${docOrientation === 'portrait'
                      ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                      }`}
                  >
                    <span>Portrait (Vertical)</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!DOCUMENT_TYPES[docType].portraitOnly) {
                        setDocOrientation('landscape');
                      }
                    }}
                    disabled={DOCUMENT_TYPES[docType].portraitOnly}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${DOCUMENT_TYPES[docType].portraitOnly
                      ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-50 cursor-not-allowed'
                      : docOrientation === 'landscape'
                        ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-xs cursor-pointer'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 cursor-pointer'
                      }`}
                    title={DOCUMENT_TYPES[docType].portraitOnly ? 'Passport Photo is portrait only' : undefined}
                  >
                    <span>Landscape (Horizontal)</span>
                  </button>
                </div>
              </div>

              {/* Crop Mode Selector */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
                  Crop Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'auto', label: 'Auto Crop', icon: Sparkles },
                    { id: 'fixed', label: 'Fixed Size', icon: Maximize2 },
                    { id: 'off', label: 'Crop Off', icon: Ban },
                  ].map((item) => {
                    const isSel = cropMode === item.id;
                    const IconComp = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setCropMode(item.id)}
                        className={`py-2.5 px-2 rounded-2xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 ${isSel
                          ? 'border-blue-600 bg-blue-50 text-blue-900 shadow-xs'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300'
                          }`}
                      >
                        <IconComp className="w-3.5 h-3.5" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* If user already scanned pages, show quick return button */}
            {pages.length > 0 && (
              <button
                onClick={() => setStep('page_manager')}
                className="btn-large w-full bg-slate-900 text-white hover:bg-slate-800 shadow-md text-xs font-bold"
              >
                Resume Scanned Document ({pages.length} Pages) →
              </button>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 2: Camera UI with Automatic Hands-Free Capture             */}
        {/* ================================================================ */}
        {step === 'camera' && (
          <div className="relative w-full max-w-2xl mx-auto bg-black rounded-3xl overflow-hidden shadow-2xl flex flex-col animate-fadeIn">
            {/* Camera Video Viewport */}
            <div className="relative aspect-[3/4] sm:aspect-[4/3] max-h-[68vh] bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />

              {/* Shutter flash */}
              <div
                className={`absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 ${isShutterFlashing ? 'opacity-90' : 'opacity-0'
                  }`}
              />

              {/* Status Banner */}
              <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20 pointer-events-none">
                <div className="bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-full text-white text-xs font-bold flex items-center gap-2 border border-white/10">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{cameraStatus}</span>
                </div>
                <div className="bg-black/70 backdrop-blur-md px-3 py-1 rounded-full text-white text-xs font-mono font-semibold border border-white/10">
                  {DOCUMENT_TYPES[docType].name} ({docOrientation.slice(0, 4)})
                </div>
              </div>

              {/* Size-aware Fixed Frame Overlay */}
              <div className="absolute inset-8 sm:inset-12 border-2 border-white/70 rounded-xl pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-500 -mt-1 -ml-1" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-500 -mt-1 -mr-1" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-500 -mb-1 -ml-1" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-500 -mb-1 -mr-1" />
              </div>
            </div>

            {/* Bottom Camera Action Bar */}
            <div className="bg-slate-950 p-4 flex items-center justify-around text-white">
              {hasTorch ? (
                <button
                  onClick={toggleTorch}
                  className={`p-3.5 rounded-full transition ${torchOn ? 'bg-amber-400 text-black' : 'bg-slate-800'}`}
                >
                  {torchOn ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
                </button>
              ) : (
                <div className="w-11" />
              )}

              {/* Shutter Button (Manual Fallback) */}
              <button
                onClick={() => captureFrame(null)}
                className="w-18 h-18 rounded-full border-4 border-white bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition active:scale-95 shadow-lg cursor-pointer"
                title="Capture Now"
              >
                <div className="w-13 h-13 rounded-full bg-white flex items-center justify-center">
                  <Camera className="w-6 h-6 text-blue-700" />
                </div>
              </button>

              <button
                onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                className="p-3.5 rounded-full bg-slate-800 hover:bg-slate-700"
              >
                <RotateCw className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950 pb-3 text-center">
              <button
                onClick={() => {
                  setEditingCropPageId(null);
                  setCroppingImage(null);
                  setStep(pages.length > 0 ? 'page_manager' : 'home');
                }}
                className="text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel / Return
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 3: Size-Aware Touch-Friendly Crop Screen                   */}
        {/* ================================================================ */}
        {step === 'crop' && croppingImage && (
          <div className="w-full max-w-2xl mx-auto space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
              <div>
                <span className="font-bold text-slate-900 text-sm">
                  Review Crop ({DOCUMENT_TYPES[docType].name})
                </span>
                <p className="text-[11px] text-slate-500">
                  {showLargeHandles ? 'Drag large corner handles' : 'Automatic boundary detected'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!showLargeHandles ? (
                  <button
                    onClick={() => setShowLargeHandles(true)}
                    className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                  >
                    Adjust Crop
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleAutoDetectAgain}
                      className="px-2.5 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 rounded-xl"
                      title="Auto Detect Again"
                    >
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                      Auto
                    </button>
                    <button
                      onClick={() => {
                        setCropCorners(getFixedCropCorners(cropNaturalDim.width, cropNaturalDim.height, docType, docOrientation));
                      }}
                      className="px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 rounded-xl"
                    >
                      Reset
                    </button>
                  </>
                )}

                <button
                  onClick={() => {
                    resetCropState();
                    setStep(pages.length > 0 ? 'page_manager' : 'home');
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Cancel
                </button>

                <button
                  onClick={applyCropAndContinue}
                  className="px-4 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs"
                >
                  Use This Crop ✓
                </button>
              </div>
            </div>

            {/* Interactive Image Container with large 48px handles */}
            <div
              className="touch-crop-container relative aspect-[3/4] bg-slate-950 rounded-3xl overflow-hidden flex items-center justify-center p-3 select-none shadow-2xl"
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerUp}
              onPointerDown={handleCropPointerDown}
            >
              <div className="relative inline-block max-w-full max-h-full">
                <img
                  ref={cropImgRef}
                  src={croppingImage}
                  alt="Crop preview"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setCropDisplayDim({
                      width: img.width,
                      height: img.height,
                    });
                  }}
                  className="max-h-[60vh] w-auto object-contain block mx-auto rounded-sm pointer-events-none"
                />

                {/* Quad Boundary Polygon */}
                {cropDisplayDim.width > 0 && cropCorners.length === 4 && (
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    viewBox={`0 0 ${cropDisplayDim.width} ${cropDisplayDim.height}`}
                  >
                    <polygon
                      points={cropCorners
                        .map((p) => {
                          const sx = (p.x / cropNaturalDim.width) * cropDisplayDim.width;
                          const sy = (p.y / cropNaturalDim.height) * cropDisplayDim.height;
                          return `${sx},${sy}`;
                        })
                        .join(' ')}
                      fill="rgba(59, 130, 246, 0.15)"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeDasharray="4 2"
                    />
                  </svg>
                )}

                {/* 4 Large Touch Handles (minimum 48px touch target) */}
                {showLargeHandles &&
                  cropDisplayDim.width > 0 &&
                  cropCorners.map((p, idx) => {
                    const sx = (p.x / cropNaturalDim.width) * cropDisplayDim.width;
                    const sy = (p.y / cropNaturalDim.height) * cropDisplayDim.height;
                    const labels = ['TL', 'TR', 'BR', 'BL'];
                    return (
                      <div
                        key={idx}
                        className="large-crop-handle absolute"
                        style={{ left: `${sx}px`, top: `${sy}px` }}
                      >
                        {labels[idx]}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 4: Multi-Page Manager with Manual Crop, Rotate, Brightness */}
        {/* ================================================================ */}
        {step === 'page_manager' && (
          <div className="w-full max-w-4xl mx-auto space-y-6 animate-fadeIn">
            {/* Header with Add Page and Save Scan */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  Scanned Pages ({pages.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Profile: <strong className="text-blue-700">{DOCUMENT_TYPES[docType].name}</strong> • Tap arrows to reorder pages
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStep('home')}
                  className="btn-large bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 shadow-xs"
                >
                  <Plus className="w-4 h-4 text-blue-600" />
                  <span>+ Add Page</span>
                </button>

                <button
                  onClick={() => {
                    setEditingTargetPageIndex(selectedPageIndex);
                    setStep('institute_upload');
                  }}
                  disabled={pages.length === 0}
                  className="btn-large bg-blue-600 hover:bg-blue-700 text-white shadow-md disabled:opacity-50"
                >
                  <span>Save Scan →</span>
                </button>
              </div>
            </div>

            {/* Quick Action Ribbon: Auto Enhance, Modes & Manual Tuning Toggle */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAutoEnhancePage(selectedPageIndex)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
                    title="Automatic brightness & contrast adaptation"
                  >
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Auto Enhance</span>
                  </button>

                  <button
                    onClick={() => setShowManualTuning(!showManualTuning)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition border cursor-pointer ${showManualTuning
                      ? 'bg-blue-50 border-blue-300 text-blue-800'
                      : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                      }`}
                    title="Manual brightness & contrast sliders"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Adjust Levels</span>
                  </button>
                </div>

                {/* 4 Simple Enhancement Mode Tabs: Auto Enhance, Original, Grayscale, Document / B&W */}
                <div className="flex items-center gap-1 text-xs">
                  {[
                    { id: 'auto', label: 'Auto Enhance' },
                    { id: 'original', label: 'Original' },
                    { id: 'grayscale', label: 'Grayscale' },
                    { id: 'bw', label: 'Document / B&W' },
                  ].map((item) => {
                    const currentMode = pages[selectedPageIndex]?.enhancementMode || 'auto';
                    const isSel = currentMode === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSetPageEnhancement(selectedPageIndex, item.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${isSel
                          ? 'bg-slate-900 text-white font-bold shadow-xs'
                          : 'text-slate-600 hover:bg-slate-100'
                          }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Manual Brightness & Contrast Adjustment Panel */}
              {showManualTuning && pages[selectedPageIndex] && (
                <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-4 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-blue-600" />
                      Manual Brightness & Contrast (Page {selectedPageIndex + 1})
                    </span>
                    <button
                      onClick={() => handleResetManualSettings(selectedPageIndex)}
                      className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                    >
                      Reset to 0
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Brightness Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold text-slate-700">
                        <span>Brightness</span>
                        <span className="font-mono text-blue-600">
                          {(pages[selectedPageIndex].brightness || 0) > 0 ? `+${pages[selectedPageIndex].brightness}` : pages[selectedPageIndex].brightness || 0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-50"
                        max="50"
                        step="1"
                        value={pages[selectedPageIndex].brightness || 0}
                        onChange={(e) => handleManualBrightness(selectedPageIndex, parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                        <span>Darker (-50)</span>
                        <span>Normal (0)</span>
                        <span>Brighter (+50)</span>
                      </div>
                    </div>

                    {/* Contrast Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold text-slate-700">
                        <span>Contrast</span>
                        <span className="font-mono text-blue-600">
                          {(pages[selectedPageIndex].contrast || 0) > 0 ? `+${pages[selectedPageIndex].contrast}` : pages[selectedPageIndex].contrast || 0}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="-50"
                        max="50"
                        step="1"
                        value={pages[selectedPageIndex].contrast || 0}
                        onChange={(e) => handleManualContrast(selectedPageIndex, parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] text-slate-400 font-medium">
                        <span>Flatter (-50)</span>
                        <span>Normal (0)</span>
                        <span>Punchier (+50)</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Thumbnails Grid and Active Preview */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* Thumbnails */}
              <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {pages.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPageIndex(idx)}
                    className={`relative flex flex-col bg-white rounded-2xl border-2 transition overflow-hidden shadow-xs cursor-pointer ${idx === selectedPageIndex
                      ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md'
                      : 'border-slate-200 hover:border-slate-300'
                      }`}
                  >
                    <div className="absolute top-2 left-2 z-10 bg-slate-900/80 text-white text-[11px] font-bold px-2 py-0.5 rounded">
                      Page {idx + 1}
                    </div>

                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPages(reorderPages(pages, idx, Math.max(0, idx - 1)));
                          setSelectedPageIndex(Math.max(0, idx - 1));
                        }}
                        disabled={idx === 0}
                        className="p-1 rounded bg-white/90 text-slate-700 disabled:opacity-30 shadow-xs"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPages(reorderPages(pages, idx, Math.min(pages.length - 1, idx + 1)));
                          setSelectedPageIndex(Math.min(pages.length - 1, idx + 1));
                        }}
                        disabled={idx === pages.length - 1}
                        className="p-1 rounded bg-white/90 text-slate-700 disabled:opacity-30 shadow-xs"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="aspect-[3/4] p-2 flex items-center justify-center bg-slate-100 relative">
                      <img
                        src={p.processedImage}
                        alt={`Page ${idx + 1}`}
                        className="max-h-full max-w-full object-contain rounded-xs"
                      />
                      {p.overlays?.length > 0 && (
                        <div className="absolute bottom-1 right-1 bg-amber-500 text-white text-[9px] font-bold px-1 rounded">
                          {p.overlays.length} Seals
                        </div>
                      )}
                    </div>

                    {/* Bottom thumbnail actions: Rotate, Crop, Seals, Delete */}
                    <div
                      className="p-1.5 bg-slate-50 border-t border-slate-100 flex items-center justify-around"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handleRotatePage(p)}
                        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600"
                        title="Rotate 90°"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => {
                          prepareCropStep(p.originalImage, p.cropCorners, p.id);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600"
                        title="Adjust Crop"
                      >
                        <Crop className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => {
                          openCustomTemplateEditor(idx);
                        }}
                        className="p-1.5 rounded-lg hover:bg-blue-100 text-blue-600 font-bold text-[11px]"
                        title="Edit Institute Elements for this page"
                      >
                        Seals
                      </button>

                      <button
                        onClick={() => {
                          const rem = deletePage(pages, idx);
                          setPages(rem);
                          setSelectedPageIndex(Math.max(0, idx - 1));
                          if (rem.length === 0) setStep('home');
                        }}
                        className="p-1.5 rounded-lg hover:bg-rose-100 text-rose-600"
                        title="Delete Page"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Large Active Preview Card with Before/After Comparison & Manual Actions */}
              {pages[selectedPageIndex] && (
                <div className="md:col-span-5 bg-white rounded-3xl border border-slate-200 p-4 shadow-xs sticky top-20 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Page {selectedPageIndex + 1} of {pages.length}
                    </span>

                    {/* Compare Before / After Toggle Button.
                        This only swaps which image of the SAME page is shown. */}
                    <button
                      onClick={() => setShowOriginalPreview(!showOriginalPreview)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition ${showOriginalPreview
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                        }`}
                      title="Compare with raw scan"
                    >
                      {showOriginalPreview ? 'Viewing: Original' : 'Show Original'}
                    </button>
                  </div>

                  {/* Document preview container */}
                  <div className="aspect-[3/4] bg-slate-100 rounded-2xl flex items-center justify-center p-2 overflow-hidden border border-slate-200 relative">
                    <img
                      src={
                        showOriginalPreview
                          ? pages[selectedPageIndex].croppedImage || pages[selectedPageIndex].originalImage
                          : pages[selectedPageIndex].processedImage
                      }
                      alt="Active page"
                      className="max-h-full max-w-full object-contain rounded-xs shadow-md"
                    />

                    {/* Preview page's overlays if already added */}
                    {!showOriginalPreview &&
                      pages[selectedPageIndex].overlays?.map((o) => (
                        <div
                          key={o.id}
                          className="absolute pointer-events-none drop-shadow-md"
                          style={{
                            left: `${o.x * 100}%`,
                            top: `${o.y * 100}%`,
                            width: `${o.width * 100}%`,
                            transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
                          }}
                        >
                          <img src={o.image} alt={o.type} className="w-full h-auto object-contain" />
                        </div>
                      ))}
                  </div>

                  {/* Manual Quick Action Bar on Active Page: Rotate & Crop */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => handleRotatePage(pages[selectedPageIndex])}
                      className="py-2.5 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold hover:bg-slate-100 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <RotateCw className="w-4 h-4 text-blue-600" />
                      <span>Rotate 90°</span>
                    </button>

                    <button
                      onClick={() => {
                        prepareCropStep(
                          pages[selectedPageIndex].originalImage,
                          pages[selectedPageIndex].cropCorners,
                          pages[selectedPageIndex].id
                        );
                      }}
                      className="py-2.5 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-bold hover:bg-slate-100 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Crop className="w-4 h-4 text-blue-600" />
                      <span>Adjust Crop</span>
                    </button>
                  </div>

                  <div>
                    <button
                      onClick={() => openCustomTemplateEditor(selectedPageIndex)}
                      className="w-full py-2.5 rounded-xl border border-blue-300 bg-blue-50 text-blue-700 text-xs font-bold hover:bg-blue-100 transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Edit Seals for Page {selectedPageIndex + 1}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 5A: Add Institute Elements? (Uploads only, zero fake assets) */}
        {/* ================================================================ */}
        {step === 'institute_upload' && (
          <div className="w-full max-w-xl mx-auto space-y-6 text-center animate-fadeIn">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                Institute Branding
              </div>
              <h2 className="text-3xl font-black text-slate-900">
                Add Institute Elements?
              </h2>
              <p className="text-sm text-slate-500">
                Upload your official Logo, Signature, and Stamp (PNG, JPG, WebP)
              </p>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3 text-left">
              {/* Logo Card */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 hover:border-slate-300 transition">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 p-1.5 flex items-center justify-center overflow-hidden border border-slate-200">
                    {uploadedAssets.logo ? (
                      <img src={uploadedAssets.logo} alt="Logo" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 font-bold">None</span>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900">Institute Logo</span>
                    <p className="text-xs text-slate-500">
                      {uploadedAssets.logo ? 'Uploaded ✓' : 'Emblem or crest'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {uploadedAssets.logo && (
                    <button
                      onClick={() => removeUploadedAsset('logo')}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <label className="touch-toolbar-btn text-xs">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadedAssets.logo ? 'Change' : 'Upload'}</span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      onChange={(e) => handleAssetUpload('logo', e)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Signature Card */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 hover:border-slate-300 transition">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 p-1.5 flex items-center justify-center overflow-hidden border border-slate-200">
                    {uploadedAssets.signature ? (
                      <img src={uploadedAssets.signature} alt="Signature" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 font-bold">None</span>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900">Authorized Signature</span>
                    <p className="text-xs text-slate-500">
                      {uploadedAssets.signature ? 'Uploaded ✓' : 'Authority signature mark'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {uploadedAssets.signature && (
                    <button
                      onClick={() => removeUploadedAsset('signature')}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <label className="touch-toolbar-btn text-xs">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadedAssets.signature ? 'Change' : 'Upload'}</span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      onChange={(e) => handleAssetUpload('signature', e)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Stamp Card */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 hover:border-slate-300 transition">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 p-1.5 flex items-center justify-center overflow-hidden border border-slate-200">
                    {uploadedAssets.stamp ? (
                      <img src={uploadedAssets.stamp} alt="Stamp" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-slate-400 font-bold">None</span>
                    )}
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-900">Official Stamp</span>
                    <p className="text-xs text-slate-500">
                      {uploadedAssets.stamp ? 'Uploaded ✓' : 'Official verification seal'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {uploadedAssets.stamp && (
                    <button
                      onClick={() => removeUploadedAsset('stamp')}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-xl"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <label className="touch-toolbar-btn text-xs">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadedAssets.stamp ? 'Change' : 'Upload'}</span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      onChange={(e) => handleAssetUpload('stamp', e)}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={() => setStep('final_preview')}
                className="btn-large flex-1 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Skip (No Elements)
              </button>

              <button
                onClick={() => openTemplateSelection(editingTargetPageIndex)}
                className="btn-large flex-1 bg-blue-600 hover:bg-blue-700 text-white shadow-md"
              >
                Choose Template →
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 5B: Template Selection & Preview                            */}
        {/* ================================================================ */}
        {step === 'template_select' && (
          <div className="w-full max-w-4xl mx-auto space-y-6 animate-fadeIn">
            <div className="text-center space-y-1">
              <h2 className="text-2xl md:text-3xl font-black text-slate-900">
                Select Institute Template
              </h2>
              <p className="text-xs text-slate-500">
                Safe proportional placement for {DOCUMENT_TYPES[docType].name}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* Left Column: Template Cards & Custom Option */}
              <div className="md:col-span-6 space-y-3">
                {Object.keys(INSTITUTE_TEMPLATES).map((key) => {
                  const tmpl = INSTITUTE_TEMPLATES[key];
                  const isSel = selectedTemplateId === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedTemplateId(key)}
                      className={`w-full p-4 rounded-2xl border-2 text-left transition cursor-pointer flex flex-col gap-1 ${isSel
                        ? 'border-blue-600 bg-blue-50/70 shadow-xs ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-base">{tmpl.name} Template</span>
                        {isSel && <CheckCircle className="w-5 h-5 text-blue-600" />}
                      </div>
                      <span className="text-xs text-slate-500">{tmpl.description}</span>
                    </button>
                  );
                })}

                {/* Custom Template Card */}
                <button
                  onClick={() => openCustomTemplateEditor(editingTargetPageIndex)}
                  className="w-full p-4 rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/50 hover:bg-blue-50 text-left transition cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-blue-900 text-base flex items-center gap-2">
                      <Move className="w-4 h-4 text-blue-600" />
                      Create Custom Template
                    </span>
                    <p className="text-xs text-blue-700 mt-0.5">
                      Drag, scale, and place uploaded elements freely
                    </p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-blue-600" />
                </button>
              </div>

              {/* Right Column: Visual Document Preview with Selected Template */}
              <div className="md:col-span-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Template Visual Preview
                  </span>
                  <button
                    onClick={() => openCustomTemplateEditor(editingTargetPageIndex)}
                    className="text-xs font-bold text-blue-600 hover:underline"
                  >
                    Customize Positions ⚙
                  </button>
                </div>

                <div className="aspect-[3/4] bg-slate-950 rounded-3xl p-3 flex items-center justify-center relative overflow-hidden shadow-xl">
                  {activePage && (
                    <div className="relative max-w-full max-h-[58vh]">
                      <img
                        src={activePage.processedImage}
                        alt="Doc"
                        className="max-h-[55vh] w-auto object-contain rounded-xs shadow-md"
                      />

                      {/* Display Template Overlays on Document */}
                      {buildTemplateOverlays(selectedTemplateId, uploadedAssets).map((item) => (
                        <div
                          key={item.id}
                          className="absolute pointer-events-none drop-shadow-md"
                          style={{
                            left: `${item.x * 100}%`,
                            top: `${item.y * 100}%`,
                            width: `${item.width * 100}%`,
                            transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                          }}
                        >
                          <img src={item.image} alt={item.type} className="w-full h-auto object-contain" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Apply Buttons */}
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-bold text-slate-700 text-center uppercase tracking-wider">
                    Apply Template
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const built = buildTemplateOverlays(selectedTemplateId, uploadedAssets);
                        applyOverlays(built, false);
                      }}
                      className="touch-toolbar-btn text-xs font-bold py-3"
                    >
                      Apply Only to Page {editingTargetPageIndex + 1}
                    </button>

                    <button
                      onClick={() => {
                        const built = buildTemplateOverlays(selectedTemplateId, uploadedAssets);
                        applyOverlays(built, true);
                      }}
                      className="btn-large bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-3 shadow-md"
                    >
                      Apply to All Pages ({pages.length})
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 5C: Custom Template Editor (Touch-Friendly Drag/Resize)    */}
        {/* ================================================================ */}
        {step === 'custom_template' && (
          <div className="w-full max-w-2xl mx-auto space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Custom Template</h3>
                <p className="text-xs text-slate-500">
                  Tap and drag uploaded elements to position them freely
                </p>
              </div>

              <button
                onClick={resetCustomPositions}
                className="touch-toolbar-btn text-xs"
              >
                Reset
              </button>
            </div>

            {/* Interactive Document Preview Canvas */}
            <div
              ref={customCanvasRef}
              onPointerMove={handleOverlayPointerMove}
              onPointerUp={handleOverlayPointerUp}
              className="touch-crop-container relative aspect-[3/4] bg-slate-950 rounded-3xl overflow-hidden flex items-center justify-center p-3 select-none shadow-2xl"
            >
              {activePage && (
                <div className="relative inline-block max-w-full max-h-full">
                  <img
                    src={activePage.processedImage}
                    alt="Document"
                    className="max-h-[58vh] w-auto object-contain block mx-auto rounded-sm shadow-md pointer-events-none"
                  />

                  {/* Movable Overlay Objects */}
                  {customOverlays.map((item) => {
                    const isSelected = selectedOverlayId === item.id;
                    return (
                      <div
                        key={item.id}
                        onPointerDown={(e) => handleOverlayPointerDown(item.id, e)}
                        className={`overlay-touch-item ${isSelected ? 'overlay-selected z-30' : 'z-20'}`}
                        style={{
                          left: `${item.x * 100}%`,
                          top: `${item.y * 100}%`,
                          width: `${item.width * 100}%`,
                          transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                        }}
                      >
                        <img
                          src={item.image}
                          alt={item.type}
                          className="w-full h-auto object-contain pointer-events-none drop-shadow-md"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Element Touch Toolbar with Large 44-50px Buttons */}
            {selectedOverlayId && (
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between gap-2 flex-wrap animate-fadeIn">
                <span className="text-xs font-bold text-slate-700 capitalize">
                  {customOverlays.find((o) => o.id === selectedOverlayId)?.type || 'Element'}:
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => resizeSelectedOverlay(0.88)}
                    className="touch-toolbar-btn text-xs"
                    title="Smaller"
                  >
                    Size -
                  </button>
                  <button
                    onClick={() => resizeSelectedOverlay(1.12)}
                    className="touch-toolbar-btn text-xs"
                    title="Larger"
                  >
                    Size +
                  </button>
                  <button
                    onClick={rotateSelectedOverlay}
                    className="touch-toolbar-btn text-xs"
                    title="Rotate 90 degrees"
                  >
                    <RotateCw className="w-4 h-4" />
                    <span>Rotate</span>
                  </button>
                  <button
                    onClick={deleteSelectedOverlay}
                    className="touch-toolbar-btn text-xs text-rose-600"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Apply Choices */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="text-xs font-bold text-slate-700 text-center uppercase tracking-wider">
                Apply Custom Template
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => applyOverlays(customOverlays, false)}
                  className="touch-toolbar-btn text-xs font-bold py-3.5"
                >
                  This Page Only (Page {editingTargetPageIndex + 1})
                </button>

                <button
                  onClick={() => applyOverlays(customOverlays, true)}
                  className="btn-large bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-3.5 shadow-md"
                >
                  All Pages ({pages.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 6: Final Document Preview (Document + Real Overlays)       */}
        {/* ================================================================ */}
        {step === 'final_preview' && (
          <div className="w-full max-w-3xl mx-auto space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  Final Document Preview
                </h2>
                <p className="text-xs text-slate-500">
                  Inspect pages, dimensions, and official seals before downloading
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => openCustomTemplateEditor(selectedPageIndex)}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  Edit Elements
                </button>
                <button
                  onClick={() => setStep('export')}
                  className="btn-large bg-blue-600 hover:bg-blue-700 text-white shadow-md text-xs py-2 px-5 min-h-[42px]"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Document</span>
                </button>
              </div>
            </div>

            {/* Page Viewer: Document remains accurate natural white paper */}
            <div className="bg-slate-950 rounded-3xl p-4 sm:p-8 flex items-center justify-center min-h-[500px] shadow-2xl relative">
              {pages[selectedPageIndex] && (
                <div className="relative max-w-full max-h-[65vh]">
                  <img
                    src={pages[selectedPageIndex].processedImage}
                    alt="Page"
                    className="max-h-[62vh] w-auto object-contain rounded-xs shadow-2xl"
                  />

                  {/* Render independent overlays for visual check */}
                  {pages[selectedPageIndex].overlays?.map((o) => (
                    <div
                      key={o.id}
                      className="absolute pointer-events-none drop-shadow-md"
                      style={{
                        left: `${o.x * 100}%`,
                        top: `${o.y * 100}%`,
                        width: `${o.width * 100}%`,
                        transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined,
                      }}
                    >
                      <img src={o.image} alt={o.type} className="w-full h-auto object-contain" />
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {pages.length > 1 && (
                <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-3">
                  <button
                    onClick={() => setSelectedPageIndex((prev) => Math.max(0, prev - 1))}
                    disabled={selectedPageIndex === 0}
                    className="p-2 rounded-full bg-black/70 text-white disabled:opacity-30 border border-white/10"
                  >
                    <ChevronUp className="w-4 h-4 -rotate-90" />
                  </button>
                  <span className="bg-black/70 px-4 py-1.5 rounded-full text-white text-xs font-mono font-bold border border-white/10">
                    Page {selectedPageIndex + 1} of {pages.length}
                  </span>
                  <button
                    onClick={() => setSelectedPageIndex((prev) => Math.min(pages.length - 1, prev + 1))}
                    disabled={selectedPageIndex === pages.length - 1}
                    className="p-2 rounded-full bg-black/70 text-white disabled:opacity-30 border border-white/10"
                  >
                    <ChevronDown className="w-4 h-4 -rotate-90" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
              <span>Elements remain separate until final export.</span>
              <button
                onClick={() => setStep('page_manager')}
                className="font-bold text-blue-600 hover:underline"
              >
                ← Back to Page Manager
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* STEP 7: Export Download [PDF] [JPG] [PNG] [DOCX]                */}
        {/* ================================================================ */}
        {step === 'export' && (
          <div className="w-full max-w-xl mx-auto space-y-6 text-center animate-fadeIn">
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-900">
                Download Document
              </h2>
              <p className="text-sm text-slate-500">
                Profile: <strong className="text-blue-700">{DOCUMENT_TYPES[docType].fullName}</strong> ({docOrientation})
              </p>
              <p className="text-xs text-slate-400">
                Files are rendered locally in your browser with non-distorted dimensions.
              </p>
            </div>

            {/* File name box */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 text-left shadow-xs space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">File Name</label>
              <input
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold focus:outline-none focus:border-blue-500"
              />
            </div>

            {exportNotice && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl animate-fadeIn">
                {exportNotice}
              </div>
            )}

            {/* Download Buttons Grid */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleExportDownload('pdf')}
                disabled={isExporting}
                className="p-5 rounded-2xl border-2 border-slate-200 hover:border-red-500 bg-white text-left transition flex flex-col gap-1 shadow-xs cursor-pointer"
              >
                <div className="p-2 rounded-xl bg-red-100 text-red-600 w-fit mb-1">
                  <FileText className="w-6 h-6" />
                </div>
                <span className="font-bold text-slate-900 text-base">PDF Document</span>
                <span className="text-xs text-slate-500">
                  {DOCUMENT_TYPES[docType].name} proportions
                </span>
                <span className="text-xs font-bold text-red-600 mt-2">Download .PDF</span>
              </button>

              <button
                onClick={() => handleExportDownload('docx')}
                disabled={isExporting}
                className="p-5 rounded-2xl border-2 border-slate-200 hover:border-blue-600 bg-white text-left transition flex flex-col gap-1 shadow-xs cursor-pointer"
              >
                <div className="p-2 rounded-xl bg-blue-100 text-blue-600 w-fit mb-1">
                  <FileText className="w-6 h-6" />
                </div>
                <span className="font-bold text-slate-900 text-base">Word (DOCX)</span>
                <span className="text-xs text-slate-500">Preserved aspect ratio</span>
                <span className="text-xs font-bold text-blue-600 mt-2">Download .DOCX</span>
              </button>

              <button
                onClick={() => handleExportDownload('jpg')}
                disabled={isExporting}
                className="p-5 rounded-2xl border-2 border-slate-200 hover:border-amber-500 bg-white text-left transition flex flex-col gap-1 shadow-xs cursor-pointer"
              >
                <div className="p-2 rounded-xl bg-amber-100 text-amber-600 w-fit mb-1">
                  <Download className="w-6 h-6" />
                </div>
                <span className="font-bold text-slate-900 text-base">JPEG Image</span>
                <span className="text-xs text-slate-500">
                  {pages.length > 1 ? 'ZIP bundle of all pages' : 'Single image'}
                </span>
                <span className="text-xs font-bold text-amber-600 mt-2">Download .JPG</span>
              </button>

              <button
                onClick={() => handleExportDownload('png')}
                disabled={isExporting}
                className="p-5 rounded-2xl border-2 border-slate-200 hover:border-emerald-600 bg-white text-left transition flex flex-col gap-1 shadow-xs cursor-pointer"
              >
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 w-fit mb-1">
                  <Download className="w-6 h-6" />
                </div>
                <span className="font-bold text-slate-900 text-base">PNG Lossless</span>
                <span className="text-xs text-slate-500">
                  Real PNG MIME encoding
                </span>
                <span className="text-xs font-bold text-emerald-700 mt-2">Download .PNG</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
              <button
                onClick={() => setStep('final_preview')}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                ← Back to Preview
              </button>

              <button
                onClick={handleClearSession}
                className="btn-large bg-slate-900 text-white hover:bg-slate-800 text-xs px-5 py-2.5"
              >
                Start New Scan
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
