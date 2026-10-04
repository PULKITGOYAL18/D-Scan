# D-Scan — Feature Guide

> **"Scan, Enhance & Brand Documents in One Place."**
> A lightweight, 100% offline, privacy-first mobile document scanner PWA built for colleges, institutes, offices, faculty, staff, students, and general users.

---

## 1. Document Format Profiles (A4, A3, Passport)
- **What it does**: Calibrates the camera overlay, fixed-crop framing, and export resolution to match ISO 216 standards (A4: 210×297mm, A3: 297×420mm) or ICAO ID standards (Passport: 35×45mm).
- **Why it is useful**: Eliminates stretched or misproportioned scans. PDFs are generated with proper physical dimensions instead of forcing everything into arbitrary screen sizes.

---

## 2. Hands-Free Camera Auto Capture
- **What it does**: Analyzes live camera video frames for quadrilateral boundaries. When a document is detected and held steady across consecutive frames, it triggers the shutter automatically.
- **Why it is useful**: Allows single-handed scanning without having to tap a shutter button while holding a document or book open. Manual capture is always available as a fallback.

---

## 3. Computer Vision & Perspective Correction
- **What it does**: Detects 4-corner document boundaries using OpenCV.js with a native JavaScript homography fallback. Warps skewed, angled photos into perfectly flat, upright rectangular pages.
- **Why it is useful**: Documents photographed at an angle or on a desk are instantly straightened and squared off, looking like flatbed scanner scans.

---

## 4. Touch-First 48px Easy Crop
- **What it does**: If automatic detection finds a quad, users can simply tap `[Use This Crop ✓]`. If adjustment is needed, 4 large 48px touch handles appear with a 48px finger proximity grab zone.
- **Why it is useful**: Eliminates frustration on mobile phones where tiny corner handles are hard to drag or get covered by thumbs.

---

## 5. One-Click Auto Enhance
- **What it does**: Evaluates paper luminance and text contrast. Smoothly whitens paper background noise, sharpens text letterforms, and preserves natural colors without harsh artificial thresholds.
- **Why it is useful**: Makes faded receipts, handwritten notes, and low-light classroom scans crisp and professional in one click.

---

## 6. Non-Destructive Enhancements & Before/After Toggle
- **What it does**: Stores the raw unenhanced crop separately from the processed image. Users can toggle `[Show Original]` vs `[Show Enhanced]` or switch between `Auto Enhance`, `Original`, `Grayscale`, and `Document / B&W`.
- **Why it is useful**: Users never lose their original scan. If an enhancement doesn't look right, they can revert to the pristine original with a single tap without rescanning.

---

## 7. Multi-Page Manager
- **What it does**: Displays thumbnail cards for all scanned pages with quick actions: `[+ Add Page]`, `[🗑 Delete]`, `[↻ Rotate 90°]`, `[↑ / ↓ Reorder]`, and `[Edit Crop]`.
- **Why it is useful**: Easily assemble multi-page reports, exams, or agreements in the exact order needed before generating final files.

---

## 8. Institutional Seals & Safe Placement
- **What it does**: Enables uploading an Institute Logo, Authorized Signature, and Official Stamp (supporting transparent PNG, JPG, and WebP).
- **Why it is useful**: Teachers, administrators, and students can authenticate official assignment submissions, recommendation letters, and certificates directly on their phone.

---

## 9. Predefined & Custom Templates
- **What it does**:
  - **Predefined**: Instantly arranges elements in standard layouts (`Standard`, `Official`, `Certificate`, `Letter`).
  - **Custom Template**: Provides a touch canvas to drag elements freely with large `[Size -]`, `[Size +]`, `[Rotate]`, and `[Delete]` buttons.
- **Why it is useful**: Positions are proportional (`0.0` to `1.0`), preventing seals from overflowing edges on different document sizes (A4, A3, Passport).

---

## 10. Per-Page Overrides vs. Apply to All
- **What it does**: Offers two explicit options:
  - `[Apply to All Pages]` — propagates seals to every page.
  - `[Apply Only to This Page]` — customizes a specific page (e.g. signature on the last page only).
- **Why it is useful**: Real documents rarely have signatures on every page; users have complete control without complicated software.

---

## 11. Multi-Format High-Res Export (PDF, DOCX, JPG, PNG)
- **What it does**:
  - **PDF**: Generates multi-page vector-scaled PDFs with jsPDF.
  - **Word (DOCX)**: Produces Microsoft Word documents with non-distorted images and native page breaks.
  - **JPG / PNG**: Direct download for single pages, or automatically bundles multiple pages into a ZIP archive.
- **Why it is useful**: Compatible with college portals, email attachments, and document archiving workflows.

---

## 12. Local In-Browser Processing (No Accounts / No Cloud Storage)
- **What it does**: All image processing, detection, perspective warping, and export run directly in the user's browser. Documents are processed locally in your browser and are not uploaded to D-Scan servers. No account or cloud storage is required.
- **Why it is useful**: Ensures user scans remain on their own device. User A's scans on Device A can never appear on User B's device. No server CPU bottleneck, allowing unlimited concurrent users.

---

## 13. Installable PWA with Offline App Shell
- **What it does**: Includes a Web App Manifest, Service Worker, and a smart header `[Install App]` button (with iOS Safari instructions).
- **Why it is useful**: Once opened or installed, the entire scanner works with zero internet connection in airplane mode or remote campus areas.

---

## 14. Pure Professional Light Theme
- **What it does**: Clean, bright, and distraction-free styling optimized for daylight document scanning and clear inspection of letterforms, paper texture, and seal placement.
- **Why it is useful**: Eliminates unnecessary theme toggles and ensures standard document readability across all devices.

---

## 15. Manual Fine-Tuning (Crop, Rotate, Brightness & Contrast)
- **What it does**: In addition to one-click Auto Enhance, provides instant manual options on every page:
  - **Adjust Crop**: Re-open manual 48px touch crop handles anytime.
  - **Rotate 90°**: Clockwise 90-degree page rotation.
  - **Adjust Levels**: Numerical sliders for Brightness (-50 to +50) and Contrast (-50 to +50) with instant reset.
- **Why it is useful**: Gives users full control to fine-tune faded carbon copies, vintage manuscripts, or heavily shaded notes to their exact preference.

