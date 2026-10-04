/**
 * Page Manager Module
 * Page state operations: add, delete, reorder, rotate, update
 */

import { rotateImage, applyEnhancement, createThumbnail } from './imageProcessing.js';

export function addPage(pages, newPage) {
  return [...pages, newPage];
}

export function deletePage(pages, index) {
  return pages.filter((_, i) => i !== index);
}

export function reorderPages(pages, fromIndex, toIndex) {
  if (fromIndex === toIndex) return pages;
  const copy = [...pages];
  const [removed] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, removed);
  return copy;
}

export async function rotatePage(page) {
  const nextRotation = ((page.rotation || 0) + 90) % 360;
  const rotatedProcessed = await rotateImage(page.processedImage, 90);
  const rotatedCropped = page.croppedImage ? await rotateImage(page.croppedImage, 90) : rotatedProcessed;
  const currentOrientation = page.orientation || 'portrait';
  const nextOrientation = currentOrientation === 'portrait' ? 'landscape' : 'portrait';
  const thumbnail = await createThumbnail(rotatedProcessed, 320);

  return {
    ...page,
    processedImage: rotatedProcessed,
    croppedImage: rotatedCropped,
    thumbnail,
    rotation: nextRotation,
    orientation: nextOrientation,
  };
}

export async function updatePageEnhancements(page, options) {
  const base = page.croppedImage || page.originalImage;
  const brightness = options.brightness !== undefined ? options.brightness : (page.brightness ?? 0);
  const contrast = options.contrast !== undefined ? options.contrast : (page.contrast ?? 0);
  const mode = options.enhancementMode || page.enhancementMode || 'auto';

  const updatedProcessed = await applyEnhancement(base, {
    mode,
    brightness,
    contrast,
  });

  const thumbnail = await createThumbnail(updatedProcessed, 320);

  return {
    ...page,
    processedImage: updatedProcessed,
    thumbnail,
    enhancementMode: mode,
    brightness,
    contrast,
  };
}

export function setPageOverlays(page, overlays) {
  return {
    ...page,
    overlays: [...overlays],
  };
}
