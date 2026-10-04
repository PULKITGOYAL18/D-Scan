# D-Scan

> **Scan, Enhance & Brand Documents in One Place.**

D-Scan is a professional, privacy-focused, offline-capable Progressive Web Application (PWA) designed for students, faculty, administrators, offices, and general users. All document boundary detection, perspective warping, image enhancements, official seal composition, and document exports execute entirely locally inside your browser.

---

## Key Features

- **Document Size Profiles**:
  - **A4**: 210 × 297 mm (Aspect ratio: `210 / 297 ≈ 0.7071`)
  - **A3**: 297 × 420 mm (Aspect ratio: `297 / 420 ≈ 0.7071`)
  - **Passport Photo**: 35 × 45 mm (Aspect ratio: `35 / 45 ≈ 0.7778`, strictly portrait-only)
- **Crop Modes**:
  - **Auto Crop**: Computer vision contour detection with automatic perspective transformation.
  - **Fixed Frame**: Centered frame strictly maintaining the selected profile aspect ratio.
  - **Original**: Keeps the uncropped image dimensions without forcing a document ratio.
- **Hands-Free Camera Scanning**: Real-time quad tracking on downscaled frames with stability detection and automated capture.
- **Gallery Upload**: Single and multi-image import with MIME validation and mobile safety limits.
- **Self-Hosted Local OpenCV**: OpenCV.js is self-hosted locally within `/opencv.js` for offline computer vision without external CDN dependencies.
- **Touch-Friendly Controls**: Generous 48px touch handles with 50px proximity hit testing for finger manipulation.
- **Intelligent Auto Enhance**: Dynamically assesses document illumination, whitens grayish paper backgrounds, deepens text ink contrast, and sharpens letterforms while preserving natural colors.
- **Manual Adjustments**: 90° clockwise rotation, crop adjustment, and fine-tuning sliders for Brightness (`-50` to `+50`) and Contrast (`-50` to `+50`).
- **Institute Branding**: Upload official **Logo**, **Signature**, and **Stamp** (PNG with transparency, JPG, WebP). Zero fake or sample assets; only explicit user uploads are rendered.
- **Templates**: Standard, Official, Certificate, and Letter layouts with full touch drag-and-drop boundary-safe customization.
- **Selective Scope**: Apply institute elements to **All Scanned Pages** or **Only This Page**.
- **Multi-Format Export**:
  - **PDF**: Profile-aware physical dimensions (`[210, 297]`, `[297, 420]`, `[35, 45]`) preserving exact aspect ratio.
  - **Word (DOCX)**: Scaled images with preserved proportions and native page breaks.
  - **JPEG**: High-quality compressed image or multi-page ZIP bundle.
  - **PNG**: Lossless image with authentic `image/png` MIME encoding.
- **Progressive Web App (PWA)**: Installable on Desktop (Chrome, Edge), Android, and iOS (Safari "Add to Home Screen").
- **Offline-Capable Operation**: After the required application assets are cached, D-Scan can operate without an internet connection.
- **Privacy Architecture**:
  - Documents are processed locally in your browser and are not uploaded to D-Scan servers.
  - No account, registration, or cloud storage is required.
  - An explicit **[ Clear Data ]** option wipes all temporary active scan data from device memory.

---

## Technology Stack

- **Framework**: React 19, Vite 8, Tailwind CSS v4
- **Computer Vision**: OpenCV.js (locally hosted in `/public/opencv.js`) with native JavaScript homography solver fallback
- **PWA & Caching**: Vite PWA Plugin, Workbox Service Worker
- **Document Export Engines**: jsPDF, docx, JSZip
- **Icons**: Lucide React

---

## Local Development & Build

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run linter
npm run lint

# Build for production
npm run build
```
