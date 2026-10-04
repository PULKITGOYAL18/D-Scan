/**
 * Scanner Module
 * Camera streaming, document detection, auto-capture stability, and crop calculation
 */

import { SCANNER_CONFIG, DOCUMENT_TYPES } from './config.js';
import {
  distance,
  orderCorners,
  correctPerspective,
  applyEnhancement,
  loadImage,
  createThumbnail,
} from './imageProcessing.js';

function getCv() {
  if (typeof window !== 'undefined' && window.cv && window.cv.Mat) {
    return window.cv;
  }
  return null;
}

export function isOpenCvAvailable() {
  return getCv() !== null;
}

/**
 * Calculates centered fixed crop rectangle for document aspect ratio and orientation
 */
export function getFixedCropCorners(width, height, documentType = 'a4', orientation = 'portrait', margin = 0.08) {
  const doc = DOCUMENT_TYPES[documentType] || DOCUMENT_TYPES.a4;
  const isLandscape = orientation === 'landscape';
  const targetAspect = isLandscape ? (1 / doc.aspectRatio) : doc.aspectRatio;

  const maxW = width * (1 - margin * 2);
  const maxH = height * (1 - margin * 2);

  let cropW = maxW;
  let cropH = cropW / targetAspect;

  if (cropH > maxH) {
    cropH = maxH;
    cropW = cropH * targetAspect;
  }

  const startX = Math.round((width - cropW) / 2);
  const startY = Math.round((height - cropH) / 2);

  return [
    { x: startX, y: startY },
    { x: Math.round(startX + cropW), y: startY },
    { x: Math.round(startX + cropW), y: Math.round(startY + cropH) },
    { x: startX, y: Math.round(startY + cropH) },
  ];
}

/**
 * Downscales image/video for fast, low-latency detection
 */
function downscaleSource(source, maxWidth = SCANNER_CONFIG.detectionDownscaleWidth) {
  const w = 'videoWidth' in source ? source.videoWidth || source.width : source.width;
  const h = 'videoHeight' in source ? source.videoHeight || source.height : source.height;
  const scale = w > maxWidth ? maxWidth / w : 1.0;
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(source, 0, 0, targetW, targetH);
  return { canvas, scale };
}

/**
 * Validates document quadrilateral candidate geometry
 */
function scoreDocumentQuad(corners, width, height, expectedAspectRatio, tolerance = 0.3) {
  const [tl, tr, br, bl] = corners;

  // Shoelace area
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += corners[i].x * corners[j].y - corners[j].x * corners[i].y;
  }
  area = Math.abs(area) / 2;
  const areaRatio = area / (width * height);

  if (areaRatio < SCANNER_CONFIG.minimumAreaRatio || areaRatio > SCANNER_CONFIG.maximumAreaRatio) {
    return 0;
  }

  // Edge lengths
  const topEdge = distance(tl, tr);
  const bottomEdge = distance(bl, br);
  const leftEdge = distance(tl, bl);
  const rightEdge = distance(tr, br);

  if (topEdge < 25 || bottomEdge < 25 || leftEdge < 25 || rightEdge < 25) {
    return 0;
  }

  const avgW = (topEdge + bottomEdge) / 2;
  const avgH = (leftEdge + rightEdge) / 2;
  const candAspect = avgW / avgH;
  const candAspectAlt = avgH / avgW;

  const diff = Math.min(
    Math.abs(candAspect - expectedAspectRatio),
    Math.abs(candAspectAlt - expectedAspectRatio)
  );

  if (diff > tolerance) return 0.2;
  return Math.min(1.0, 0.5 + (areaRatio * 0.5));
}

/**
 * Detects 4-corner document boundary on video frame or image
 */
export function detectDocumentCorners(source, documentType = 'a4', orientation = 'portrait') {
  const doc = DOCUMENT_TYPES[documentType] || DOCUMENT_TYPES.a4;
  const isLandscape = orientation === 'landscape';
  const targetAspect = isLandscape ? (1 / doc.aspectRatio) : doc.aspectRatio;
  const { canvas, scale } = downscaleSource(source);

  // Try OpenCV if loaded
  const cv = getCv();
  if (cv) {
    let src = null;
    let gray = null;
    let blur = null;
    let edges = null;
    let closed = null;
    let contours = null;
    let hierarchy = null;

    try {
      src = cv.imread(canvas);
      gray = new cv.Mat();
      blur = new cv.Mat();
      edges = new cv.Mat();
      closed = new cv.Mat();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blur, edges, 50, 150);

      const morphK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, morphK);
      morphK.delete();

      cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let bestCorners = null;
      let highestScore = 0;

      for (let i = 0; i < contours.size(); ++i) {
        const contour = contours.get(i);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows === 4) {
          const raw = [];
          for (let j = 0; j < 4; j++) {
            raw.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1],
            });
          }
          const ordered = orderCorners(raw);
          const score = scoreDocumentQuad(ordered, canvas.width, canvas.height, targetAspect, doc.tolerance);

          if (score > highestScore && score >= SCANNER_CONFIG.confidenceThreshold) {
            highestScore = score;
            bestCorners = ordered;
          }
        }

        approx.delete();
        contour.delete();
      }

      if (bestCorners) {
        return {
          detected: true,
          corners: bestCorners.map((p) => ({
            x: Math.round(p.x / scale),
            y: Math.round(p.y / scale),
          })),
          confidence: highestScore,
        };
      }
    } catch (e) {
      console.warn('OpenCV detection issue:', e);
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blur) blur.delete();
      if (edges) edges.delete();
      if (closed) closed.delete();
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
    }
  }

  // Fallback: Actual document boundary not detected
  const w = 'videoWidth' in source ? source.videoWidth || source.width : source.width;
  const h = 'videoHeight' in source ? source.videoHeight || source.height : source.height;
  return {
    detected: false,
    corners: getFixedCropCorners(w, h, documentType, orientation, 0.06),
    confidence: 0,
  };
}

/**
 * Multi-frame stability evaluator for hands-free auto-capture
 */
export function checkAutoCapture(stabilityState, detectedCorners, now = Date.now()) {
  if (now - stabilityState.lastCaptureTime < SCANNER_CONFIG.autoCaptureCooldownMs) {
    return {
      nextState: { ...stabilityState, message: 'Cooldown...' },
      triggerCapture: false,
    };
  }

  if (!detectedCorners || detectedCorners.length !== 4) {
    return {
      nextState: {
        consecutiveStableFrames: 0,
        lastCorners: null,
        lastCaptureTime: stabilityState.lastCaptureTime,
        message: SCANNER_CONFIG.messages.idle,
      },
      triggerCapture: false,
    };
  }

  if (!stabilityState.lastCorners) {
    return {
      nextState: {
        consecutiveStableFrames: 1,
        lastCorners: detectedCorners,
        lastCaptureTime: stabilityState.lastCaptureTime,
        message: SCANNER_CONFIG.messages.detected,
      },
      triggerCapture: false,
    };
  }

  // Calculate maximum shift
  let maxShift = 0;
  for (let i = 0; i < 4; i++) {
    const shift = distance(stabilityState.lastCorners[i], detectedCorners[i]);
    if (shift > maxShift) maxShift = shift;
  }

  if (maxShift <= SCANNER_CONFIG.cornerMovementThreshold) {
    const count = stabilityState.consecutiveStableFrames + 1;
    const isReady = count >= SCANNER_CONFIG.requiredStableFrames;

    return {
      nextState: {
        consecutiveStableFrames: isReady ? 0 : count,
        lastCorners: isReady ? null : detectedCorners,
        lastCaptureTime: isReady ? now : stabilityState.lastCaptureTime,
        message: isReady
          ? SCANNER_CONFIG.messages.captured
          : `${SCANNER_CONFIG.messages.holding} (${Math.round((count / SCANNER_CONFIG.requiredStableFrames) * 100)}%)`,
      },
      triggerCapture: isReady,
    };
  }

  return {
    nextState: {
      consecutiveStableFrames: 1,
      lastCorners: detectedCorners,
      lastCaptureTime: stabilityState.lastCaptureTime,
      message: SCANNER_CONFIG.messages.detected,
    },
    triggerCapture: false,
  };
}

/**
 * Universal Processing Pipeline for Camera and Gallery
 */
export async function processScannedImage(originalDataUrl, options = {}) {
  const {
    documentType = 'a4',
    orientation = 'portrait',
    cropMode = 'auto', // 'auto', 'fixed', 'off'
    manualCorners = null,
    enhancementMode = 'auto',
    rotation = 0,
    brightness = 0,
    contrast = 0,
  } = options;

  const doc = DOCUMENT_TYPES[documentType] || DOCUMENT_TYPES.a4;
  const isLandscape = orientation === 'landscape';
  const targetAspect = isLandscape ? (1 / doc.aspectRatio) : doc.aspectRatio;
  const img = await loadImage(originalDataUrl);

  let warpedDataUrl = originalDataUrl;
  let finalCorners = null;

  if (cropMode === 'auto') {
    if (manualCorners && manualCorners.length === 4) {
      finalCorners = manualCorners;
    } else {
      const det = detectDocumentCorners(img, documentType, orientation);
      finalCorners = det.corners || getFixedCropCorners(img.width, img.height, documentType, orientation);
    }
    const warped = await correctPerspective(img, finalCorners, targetAspect);
    warpedDataUrl = warped.dataUrl;
  } else if (cropMode === 'fixed') {
    finalCorners = manualCorners || getFixedCropCorners(img.width, img.height, documentType, orientation);
    const warped = await correctPerspective(img, finalCorners, targetAspect);
    warpedDataUrl = warped.dataUrl;
  } else {
    // cropMode === 'off' (original)
    warpedDataUrl = originalDataUrl;
    finalCorners = null;
  }

  // Apply Enhancements ('auto' by default)
  const processedImage = await applyEnhancement(warpedDataUrl, {
    mode: enhancementMode,
    brightness,
    contrast,
  });

  // Fast downscaled thumbnail (~15KB) for mobile grid performance
  const thumbnail = await createThumbnail(processedImage, 320);

  return {
    id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    originalImage: originalDataUrl,
    croppedImage: warpedDataUrl,
    processedImage,
    thumbnail,
    cropCorners: finalCorners,
    cropMode,
    rotation,
    orientation,
    enhancementMode,
    documentType,
    brightness,
    contrast,
    overlays: [],
    createdAt: Date.now(),
  };
}
