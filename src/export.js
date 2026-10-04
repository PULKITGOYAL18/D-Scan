/**
 * Export Module
 * Profile-aware PDF, DOCX, JPG, and PNG generation
 */

import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, ImageRun, PageBreak } from 'docx';
import JSZip from 'jszip';
import { renderFinalPage } from './instituteElements.js';
import { loadImage } from './imageProcessing.js';
import { DOCUMENT_TYPES } from './config.js';

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Exports pages to a profile-aware, non-distorted PDF.
 * Respects A4 (210×297mm), A3 (297×420mm), and Passport Photo (35×45mm) dimensions.
 */
export async function exportToPdf(pages, docName = 'Scanned_Document') {
  if (!pages || pages.length === 0) return;
  const filename = `${docName.replace(/\.pdf$/i, '')}.pdf`;

  const firstPage = pages[0];
  const firstDoc = DOCUMENT_TYPES[firstPage.documentType] || DOCUMENT_TYPES.a4;
  const firstDataUrl = await renderFinalPage(firstPage, 'image/jpeg');
  const firstImg = await loadImage(firstDataUrl);
  const firstIsLandscape = (firstPage.orientation === 'landscape') || (firstImg.width > firstImg.height);

  const firstW = firstIsLandscape ? firstDoc.physicalHeightMm : firstDoc.physicalWidthMm;
  const firstH = firstIsLandscape ? firstDoc.physicalWidthMm : firstDoc.physicalHeightMm;

  const pdf = new jsPDF({
    orientation: firstIsLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [firstW, firstH],
    compress: true,
  });

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const finalDataUrl = i === 0 ? firstDataUrl : await renderFinalPage(page, 'image/jpeg');
    const imgObj = i === 0 ? firstImg : await loadImage(finalDataUrl);

    const docConfig = DOCUMENT_TYPES[page.documentType] || DOCUMENT_TYPES.a4;
    const isLandscape = (page.orientation === 'landscape') || (imgObj.width > imgObj.height);

    let pageW = isLandscape ? docConfig.physicalHeightMm : docConfig.physicalWidthMm;
    let pageH = isLandscape ? docConfig.physicalWidthMm : docConfig.physicalHeightMm;

    if (i > 0) {
      pdf.addPage([pageW, pageH], isLandscape ? 'landscape' : 'portrait');
    }

    // Preserve exact real-world aspect ratio without stretching
    const imgAspect = imgObj.width / (imgObj.height || 1);
    const pageAspect = pageW / (pageH || 1);
    let renderW = pageW;
    let renderH = pageH;
    let offsetX = 0;
    let offsetY = 0;

    if (imgAspect > pageAspect) {
      renderW = pageW;
      renderH = renderW / imgAspect;
      offsetY = (pageH - renderH) / 2;
    } else {
      renderH = pageH;
      renderW = renderH * imgAspect;
      offsetX = (pageW - renderW) / 2;
    }

    pdf.addImage(finalDataUrl, 'JPEG', offsetX, offsetY, renderW, renderH, undefined, 'FAST');
  }

  pdf.save(filename);
}

/**
 * Exports pages as true JPEG or true PNG files.
 * Single page: direct file download.
 * Multiple pages: clean ZIP bundle.
 */
export async function exportToImage(pages, format = 'jpg', docName = 'Scanned_Document') {
  if (!pages || pages.length === 0) return;

  const isPng = format.toLowerCase() === 'png';
  const mimeType = isPng ? 'image/png' : 'image/jpeg';
  const ext = isPng ? 'png' : 'jpg';

  // Single page: direct download with matching MIME type
  if (pages.length === 1) {
    const finalDataUrl = await renderFinalPage(pages[0], mimeType);
    const bytes = dataUrlToUint8Array(finalDataUrl);
    const blob = new Blob([bytes], { type: mimeType });
    triggerDownload(blob, `${docName}.${ext}`);
    return;
  }

  // Multi-page: ZIP archive
  const zip = new JSZip();
  for (let i = 0; i < pages.length; i++) {
    const finalDataUrl = await renderFinalPage(pages[i], mimeType);
    const base64Data = finalDataUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    const num = String(i + 1).padStart(2, '0');
    zip.file(`${docName}_page_${num}.${ext}`, base64Data, { base64: true });
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(zipBlob, `${docName}_pages.zip`);
}

/**
 * Exports pages to Word (DOCX) preserving true aspect ratio and layout.
 */
export async function exportToDocx(pages, docName = 'Scanned_Document') {
  if (!pages || pages.length === 0) return;

  const children = [];
  // Standard printable width in Word document bounds
  const maxDocxW = 460;
  const maxDocxH = 650;

  for (let i = 0; i < pages.length; i++) {
    const finalDataUrl = await renderFinalPage(pages[i], 'image/jpeg');
    const imgObj = await loadImage(finalDataUrl);
    const bytes = dataUrlToUint8Array(finalDataUrl);

    const aspect = imgObj.width / (imgObj.height || 1);
    let renderW = maxDocxW;
    let renderH = Math.round(renderW / aspect);
    if (renderH > maxDocxH) {
      renderH = maxDocxH;
      renderW = Math.round(renderH * aspect);
    }

    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: bytes,
            transformation: { width: renderW, height: renderH },
            type: 'jpg',
          }),
        ],
      })
    );

    if (i < pages.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${docName}.docx`);
}
