/**
 * Image Processing Module
 * Perspective warp, enhancement filters, shadow reduction, and background cleanup
 */

function getCv() {
  if (typeof window !== 'undefined' && window.cv && window.cv.Mat) {
    return window.cv;
  }
  return null;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export function distance(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Orders 4 quadrilateral points into canonical order:
 * [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
 */
export function orderCorners(pts) {
  if (!pts || pts.length !== 4) return pts;
  const sortedBySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const tl = sortedBySum[0];
  const br = sortedBySum[3];

  const remaining = [sortedBySum[1], sortedBySum[2]];
  remaining.sort((a, b) => a.y - a.x - (b.y - b.x));
  const tr = remaining[0];
  const bl = remaining[1];

  return [tl, tr, br, bl];
}

/**
 * Calculates rectangular output dimensions from quad corners
 */
export function calculateOutputDimensions(corners, targetAspectRatio) {
  const [tl, tr, br, bl] = corners;
  const widthA = distance(br, bl);
  const widthB = distance(tr, tl);
  let maxWidth = Math.max(Math.round(widthA), Math.round(widthB));

  const heightA = distance(tr, br);
  const heightB = distance(tl, bl);
  let maxHeight = Math.max(Math.round(heightA), Math.round(heightB));

  if (targetAspectRatio && targetAspectRatio > 0) {
    if (maxWidth > maxHeight) {
      maxHeight = Math.round(maxWidth * targetAspectRatio);
    } else {
      maxHeight = Math.round(maxWidth / targetAspectRatio);
    }
  }

  // Mobile Memory Safeguard:
  // Cap max dimension to 2048px (crisp print-grade document resolution)
  // Prevents browser heap exhaustion and canvas crashes during 30-40+ page sessions
  const MAX_DIM = 2048;
  if (maxWidth > MAX_DIM || maxHeight > MAX_DIM) {
    const scale = MAX_DIM / Math.max(maxWidth, maxHeight);
    maxWidth = Math.round(maxWidth * scale);
    maxHeight = Math.round(maxHeight * scale);
  }

  maxWidth = Math.max(240, maxWidth);
  maxHeight = Math.max(240, maxHeight);
  return { width: maxWidth, height: maxHeight };
}

/**
 * Fast downscaled thumbnail generator for mobile memory preservation
 * Generates a lightweight preview (~15KB) for UI grid rendering
 */
export async function createThumbnail(imageDataUrl, maxDim = 320) {
  try {
    const img = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageDataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const thumb = canvas.toDataURL('image/jpeg', 0.80);
    canvas.width = 0;
    canvas.height = 0;
    return thumb;
  } catch {
    return imageDataUrl;
  }
}

/**
 * 3x3 Homography solver for native JavaScript warp fallback
 */
function solveHomography(srcPts, dstPts) {
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const sx = srcPts[i].x;
    const sy = srcPts[i].y;
    const dx = dstPts[i].x;
    const dy = dstPts[i].y;
    a.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    a.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  for (let i = 0; i < 8; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 8; k++) {
      if (Math.abs(a[k][i]) > Math.abs(a[maxRow][i])) maxRow = k;
    }
    const tempA = a[i]; a[i] = a[maxRow]; a[maxRow] = tempA;
    const tempB = b[i]; b[i] = b[maxRow]; b[maxRow] = tempB;
    if (Math.abs(a[i][i]) < 1e-10) return null;

    for (let k = i + 1; k < 8; k++) {
      const factor = a[k][i] / a[i][i];
      for (let j = i; j < 8; j++) a[k][j] -= factor * a[i][j];
      b[k] -= factor * b[i];
    }
  }

  const h = new Array(9);
  for (let i = 7; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < 8; j++) sum += a[i][j] * h[j];
    h[i] = (b[i] - sum) / a[i][i];
  }
  h[8] = 1.0;
  return h;
}

/**
 * High quality perspective warp with bilinear sampling (Canvas / JS fallback)
 */
function warpPerspectiveNative(sourceImg, corners, outW, outH) {
  const [tl, tr, br, bl] = corners;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sourceImg.width;
  srcCanvas.height = sourceImg.height;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(sourceImg, 0, 0);

  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const srcPixels = srcData.data;
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = outW;
  dstCanvas.height = outH;
  const dstCtx = dstCanvas.getContext('2d');
  const dstData = dstCtx.createImageData(outW, outH);
  const dstPixels = dstData.data;

  const dstCorners = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const H = solveHomography(dstCorners, [tl, tr, br, bl]);
  if (!H) {
    dstCtx.drawImage(sourceImg, 0, 0, outW, outH);
    return dstCanvas;
  }

  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const z = h6 * x + h7 * y + h8;
      const sx = (h0 * x + h1 * y + h2) / z;
      const sy = (h3 * x + h4 * y + h5) / z;
      const dstIdx = (y * outW + x) * 4;

      if (sx >= 0 && sx < sw - 1 && sy >= 0 && sy < sh - 1) {
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const wx1 = sx - x0;
        const wx0 = 1 - wx1;
        const wy1 = sy - y0;
        const wy0 = 1 - wy1;

        const idx00 = (y0 * sw + x0) * 4;
        const idx10 = (y0 * sw + x1) * 4;
        const idx01 = (y1 * sw + x0) * 4;
        const idx11 = (y1 * sw + x1) * 4;

        for (let c = 0; c < 3; c++) {
          const c0 = srcPixels[idx00 + c] * wx0 + srcPixels[idx10 + c] * wx1;
          const c1 = srcPixels[idx01 + c] * wx0 + srcPixels[idx11 + c] * wx1;
          dstPixels[dstIdx + c] = Math.round(c0 * wy0 + c1 * wy1);
        }
        dstPixels[dstIdx + 3] = 255;
      } else {
        dstPixels[dstIdx] = 255;
        dstPixels[dstIdx + 1] = 255;
        dstPixels[dstIdx + 2] = 255;
        dstPixels[dstIdx + 3] = 255;
      }
    }
  }

  dstCtx.putImageData(dstData, 0, 0);
  return dstCanvas;
}

/**
 * Perspective correction with OpenCV or Native engine
 */
export async function correctPerspective(sourceImg, corners, targetAspectRatio) {
  const ordered = orderCorners(corners);
  const { width, height } = calculateOutputDimensions(ordered, targetAspectRatio);

  let canvas;
  const cv = getCv();
  if (cv && cv.getPerspectiveTransform) {
    try {
      const src = cv.imread(sourceImg);
      const dst = new cv.Mat();
      const [tl, tr, br, bl] = ordered;
      const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
      const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
      const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
      const dsize = new cv.Size(width, height);
      cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

      canvas = document.createElement('canvas');
      cv.imshow(canvas, dst);

      src.delete();
      dst.delete();
      srcCoords.delete();
      dstCoords.delete();
      M.delete();
    } catch (e) {
      canvas = warpPerspectiveNative(sourceImg, ordered, width, height);
    }
  } else {
    canvas = warpPerspectiveNative(sourceImg, ordered, width, height);
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
  return { dataUrl, width, height };
}

/**
 * High-Clarity Auto Enhance & Document Filtering
 * Modes: 'auto' (Auto Enhance - default), 'original', 'grayscale', 'bw' (Document / B&W)
 */
export async function applyEnhancement(imageDataUrl, options = {}) {
  const {
    mode = 'auto',
    brightness = 0,
    contrast = 0,
  } = options;

  if (mode === 'original' && brightness === 0 && contrast === 0) {
    return imageDataUrl;
  }

  const img = await loadImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return imageDataUrl;

  ctx.drawImage(img, 0, 0);
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // =========================================================================
  // 1. AUTO ENHANCE MODE:
  // Intelligent adaptive illumination normalization, contrast punch, and full unsharp mask
  // =========================================================================
  if (mode === 'auto') {
    // Step A: Calculate local paper background illumination using a 16x16 grid
    const gridCols = 16;
    const gridRows = 16;
    const cellW = Math.max(1, Math.floor(w / gridCols));
    const cellH = Math.max(1, Math.floor(h / gridRows));
    const bgGrid = new Float32Array(gridCols * gridRows);

    // Global luminance sample to find overall paper brightness reference
    let globalMaxLum = 0;
    for (let y = 0; y < h; y += 8) {
      for (let x = 0; x < w; x += 8) {
        const idx = (y * w + x) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        if (lum > globalMaxLum) globalMaxLum = lum;
      }
    }
    const globalRef = Math.max(140, Math.min(250, globalMaxLum));

    // Sample 90th percentile bright pixel in each cell to represent paper illumination
    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const startX = gx * cellW;
        const endX = Math.min(w, (gx + 1) * cellW);
        const startY = gy * cellH;
        const endY = Math.min(h, (gy + 1) * cellH);

        let cellMax = 0;
        for (let y = startY; y < endY; y += 4) {
          for (let x = startX; x < endX; x += 4) {
            const idx = (y * w + x) * 4;
            const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            if (lum > cellMax) cellMax = lum;
          }
        }
        // Smooth local background with global reference to avoid over-amplifying dark blocks
        bgGrid[gy * gridCols + gx] = Math.max(110, Math.min(255, cellMax > 90 ? cellMax : globalRef));
      }
    }

    // Step B: Normalize pixels with smooth bilinear interpolation of background illumination
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * (gridRows - 1);
      const gy0 = Math.floor(gy);
      const gy1 = Math.min(gridRows - 1, gy0 + 1);
      const ty = gy - gy0;

      for (let x = 0; x < w; x++) {
        const gx = (x / w) * (gridCols - 1);
        const gx0 = Math.floor(gx);
        const gx1 = Math.min(gridCols - 1, gx0 + 1);
        const tx = gx - gx0;

        // Bilinear sample of local background
        const b00 = bgGrid[gy0 * gridCols + gx0];
        const b10 = bgGrid[gy0 * gridCols + gx1];
        const b01 = bgGrid[gy1 * gridCols + gx0];
        const b11 = bgGrid[gy1 * gridCols + gx1];
        const localBg = (1 - ty) * ((1 - tx) * b00 + tx * b10) + ty * ((1 - tx) * b01 + tx * b11);

        const idx = (y * w + x) * 4;
        let r = data[idx];
        let g = data[idx + 1];
        let b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // Illumination leveling factor
        const normFactor = 255 / Math.max(110, localBg);

        // Normalize towards clean bright white paper
        let nr = r * normFactor;
        let ng = g * normFactor;
        let nb = b * normFactor;
        const nLum = 0.299 * nr + 0.587 * ng + 0.114 * nb;

        if (nLum > 185) {
          // Whitening curve: light paper noise smoothly lifted to clean crisp white
          const boost = (nLum - 185) * 1.0;
          nr = Math.min(255, nr + boost);
          ng = Math.min(255, ng + boost);
          nb = Math.min(255, nb + boost);
        } else if (nLum < 120) {
          // Darken text strokes for crisp readability
          const textDarken = 0.88;
          nr *= textDarken;
          ng *= textDarken;
          nb *= textDarken;
        }

        // Preserve and slightly boost vibrant colors (signatures, stamps, letterhead logos)
        const gray = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        const satBoost = 1.15;
        nr = Math.min(255, Math.max(0, gray + satBoost * (nr - gray)));
        ng = Math.min(255, Math.max(0, gray + satBoost * (ng - gray)));
        nb = Math.min(255, Math.max(0, gray + satBoost * (nb - gray)));

        data[idx] = Math.round(nr);
        data[idx + 1] = Math.round(ng);
        data[idx + 2] = Math.round(nb);
      }
    }

    // Step C: High-definition Unsharp Masking across ALL pixels for needle-sharp text & details
    const orig = new Uint8ClampedArray(data);
    const sharpenStrength = 0.38;

    for (let y = 1; y < h - 1; y++) {
      const rowPrev = (y - 1) * w;
      const rowCurr = y * w;
      const rowNext = (y + 1) * w;

      for (let x = 1; x < w - 1; x++) {
        const idx = (rowCurr + x) * 4;
        const idxN = (rowPrev + x) * 4;
        const idxS = (rowNext + x) * 4;
        const idxW = (rowCurr + (x - 1)) * 4;
        const idxE = (rowCurr + (x + 1)) * 4;

        for (let c = 0; c < 3; c++) {
          const center = orig[idx + c];
          const north = orig[idxN + c];
          const south = orig[idxS + c];
          const west = orig[idxW + c];
          const east = orig[idxE + c];

          // Laplacian high-pass edge
          const edge = (center * 4) - north - south - west - east;
          const sharpVal = center + edge * sharpenStrength;
          data[idx + c] = Math.min(255, Math.max(0, Math.round(sharpVal)));
        }
      }
    }
  } else if (mode === 'grayscale') {
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  } else if (mode === 'bw') {
    // Document / B&W: high-contrast text separation
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const val = gray >= 140 ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
  }

  // Apply optional brightness/contrast if specified
  if (brightness !== 0 || contrast !== 0) {
    const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const bOffset = brightness * 2.55;

    for (let i = 0; i < data.length; i += 4) {
      if (contrast !== 0) {
        data[i] = Math.min(255, Math.max(0, cFactor * (data[i] - 128) + 128));
        data[i + 1] = Math.min(255, Math.max(0, cFactor * (data[i + 1] - 128) + 128));
        data[i + 2] = Math.min(255, Math.max(0, cFactor * (data[i + 2] - 128) + 128));
      }
      if (brightness !== 0) {
        data[i] = Math.min(255, Math.max(0, data[i] + bOffset));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + bOffset));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + bOffset));
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const result = canvas.toDataURL('image/jpeg', 0.94);
  canvas.width = 0;
  canvas.height = 0;
  return result;
}

/**
 * Rotates an image by 90-degree increments
 */
export async function rotateImage(dataUrl, degrees) {
  const norm = ((degrees % 360) + 360) % 360;
  if (norm === 0) return dataUrl;

  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (norm === 90 || norm === 270) {
    canvas.width = img.height;
    canvas.height = img.width;
  } else {
    canvas.width = img.width;
    canvas.height = img.height;
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((norm * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  const res = canvas.toDataURL('image/jpeg', 0.94);
  canvas.width = 0;
  canvas.height = 0;
  return res;
}
