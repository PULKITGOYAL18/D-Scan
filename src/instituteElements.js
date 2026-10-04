/**
 * Institute Elements Module
 * Real User Assets Only (Logo, Signature, Stamp).
 * Zero default/fake assets. Elements remain separate until final render.
 */

import { loadImage } from './imageProcessing.js';
import { INSTITUTE_TEMPLATES } from './config.js';

/**
 * Creates placement overlay objects for a given template and uploaded assets.
 * Coordinates are normalized (0 to 1) relative to document dimensions.
 * Missing or null elements are NEVER rendered.
 */
export function buildTemplateOverlays(templateId = 'standard', userAssets = {}) {
  const template = INSTITUTE_TEMPLATES[templateId] || INSTITUTE_TEMPLATES.standard;
  const elements = [];

  const types = ['logo', 'signature', 'stamp'];

  for (const type of types) {
    const imageSrc = userAssets && userAssets[type];
    if (!imageSrc) continue; // Only include if explicitly uploaded

    const pos = template.positions[type];
    if (!pos) continue;

    elements.push({
      id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      image: imageSrc,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      rotation: pos.rotation || 0,
    });
  }

  return elements;
}

/**
 * Renders final document page by drawing the scanned page and compositing overlays on top.
 * Preserves exact aspect ratio and outputs real requested format (PNG or JPEG).
 */
export async function renderFinalPage(page, outputMimeType = 'image/jpeg') {
  const baseImg = await loadImage(page.processedImage);
  const canvas = document.createElement('canvas');
  canvas.width = baseImg.width;
  canvas.height = baseImg.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return page.processedImage;

  // 1. Draw base scanned page
  ctx.drawImage(baseImg, 0, 0);

  // 2. Draw active independent overlays (if any uploaded)
  if (page.overlays && page.overlays.length > 0) {
    for (const item of page.overlays) {
      if (!item.image) continue;
      try {
        const itemImg = await loadImage(item.image);
        const x = item.x * canvas.width;
        const y = item.y * canvas.height;
        const w = item.width * canvas.width;
        const aspect = itemImg.height / (itemImg.width || 1);
        const h = w * aspect;

        ctx.save();
        if (item.rotation) {
          ctx.translate(x + w / 2, y + h / 2);
          ctx.rotate((item.rotation * Math.PI) / 180);
          ctx.drawImage(itemImg, -w / 2, -h / 2, w, h);
        } else {
          ctx.drawImage(itemImg, x, y, w, h);
        }
        ctx.restore();
      } catch (e) {
        console.warn('Overlay rendering skipped for item:', item.type);
      }
    }
  }

  const isPng = outputMimeType === 'image/png' || outputMimeType === 'png';
  const result = isPng
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', 0.95);

  canvas.width = 0;
  canvas.height = 0;
  return result;
}
