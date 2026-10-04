/**
 * D-Scan Configuration Module
 * A4 / A3 / Passport Photo document profiles, scanner settings, upload limits, and institute templates
 */

export const DOCUMENT_TYPES = {
  a4: {
    id: 'a4',
    name: 'A4',
    fullName: 'A4 Document',
    size: '210 × 297 mm',
    widthMm: 210,
    heightMm: 297,
    aspectRatio: 210 / 297, // ~0.7071
    physicalWidthMm: 210,
    physicalHeightMm: 297,
    tolerance: 0.28,
    portraitOnly: false,
  },
  a3: {
    id: 'a3',
    name: 'A3',
    fullName: 'A3 Document',
    size: '297 × 420 mm',
    widthMm: 297,
    heightMm: 420,
    aspectRatio: 297 / 420, // ~0.7071
    physicalWidthMm: 297,
    physicalHeightMm: 420,
    tolerance: 0.28,
    portraitOnly: false,
  },
  passport: {
    id: 'passport',
    name: 'Passport Photo',
    fullName: 'Passport Photo (35 × 45 mm)',
    size: '35 × 45 mm',
    widthMm: 35,
    heightMm: 45,
    aspectRatio: 35 / 45, // ~0.7778
    physicalWidthMm: 35,
    physicalHeightMm: 45,
    tolerance: 0.35,
    portraitOnly: true,
  },
};

export const UPLOAD_LIMITS = {
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB max for mobile safety
  maxWidthPixels: 8000,
  maxHeightPixels: 8000,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
};

export const SCANNER_CONFIG = {
  // Detection resolution downscale for real-time smoothness
  detectionDownscaleWidth: 640,

  // Stability & auto-capture rules
  requiredStableFrames: 4,
  cornerMovementThreshold: 22, // Max pixel shift between frames
  minimumAreaRatio: 0.14,
  maximumAreaRatio: 0.95,
  confidenceThreshold: 0.55,
  autoCaptureCooldownMs: 1600,
  frameIntervalMs: 80, // ~12 fps detection check to avoid overheating device

  // Simple, friendly user-facing messages
  messages: {
    idle: 'Place document inside frame',
    detected: 'Document detected',
    holding: 'Hold steady...',
    captured: 'Captured ✓',
    notFound: 'Document could not be detected. Please adjust crop manually.',
  },
};

export const INSTITUTE_TEMPLATES = {
  standard: {
    id: 'standard',
    name: 'Standard',
    description: 'Logo Top Right • Signature Bottom Right • Stamp Bottom Left',
    positions: {
      logo: { x: 0.82, y: 0.04, width: 0.14, rotation: 0 },
      signature: { x: 0.74, y: 0.86, width: 0.22, rotation: 0 },
      stamp: { x: 0.06, y: 0.82, width: 0.16, rotation: 0 },
    },
  },
  official: {
    id: 'official',
    name: 'Official',
    description: 'Logo Top Left • Signature Bottom Right • Stamp Bottom Right',
    positions: {
      logo: { x: 0.05, y: 0.04, width: 0.14, rotation: 0 },
      signature: { x: 0.74, y: 0.86, width: 0.22, rotation: 0 },
      stamp: { x: 0.55, y: 0.82, width: 0.16, rotation: 0 },
    },
  },
  certificate: {
    id: 'certificate',
    name: 'Certificate',
    description: 'Logo Top Center • Signature Bottom Left • Stamp Bottom Right',
    positions: {
      logo: { x: 0.43, y: 0.04, width: 0.16, rotation: 0 },
      signature: { x: 0.06, y: 0.86, width: 0.22, rotation: 0 },
      stamp: { x: 0.78, y: 0.82, width: 0.16, rotation: 0 },
    },
  },
  letter: {
    id: 'letter',
    name: 'Letter',
    description: 'Logo Top Left • Signature Bottom Right • Stamp Near Signature',
    positions: {
      logo: { x: 0.05, y: 0.04, width: 0.15, rotation: 0 },
      signature: { x: 0.74, y: 0.86, width: 0.22, rotation: 0 },
      stamp: { x: 0.56, y: 0.82, width: 0.15, rotation: 0 },
    },
  },
};
