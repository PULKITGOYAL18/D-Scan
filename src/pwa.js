/**
 * D-Scan PWA Module
 * Handles native install prompts, standalone detection, iOS guidance,
 * and online/offline status.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function usePWA() {
  const deferredPromptRef = useRef(null);
  const [hasNativePrompt, setHasNativePrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean(window.navigator && window.navigator.standalone);

    setIsInstalled(standalone);

    const handleBeforeInstall = (event) => {
      event.preventDefault();
      deferredPromptRef.current = event;
      setHasNativePrompt(true);
    };

    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      setHasNativePrompt(false);
      setIsInstalled(true);
      setShowIOSPrompt(false);
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const installApp = useCallback(async () => {
    const promptEvent = deferredPromptRef.current;

    if (promptEvent) {
      try {
        promptEvent.prompt();

        const choice = await promptEvent.userChoice;

        deferredPromptRef.current = null;
        setHasNativePrompt(false);

        if (choice?.outcome === 'accepted') {
          setIsInstalled(true);
          return true;
        }
      } catch {
        deferredPromptRef.current = null;
        setHasNativePrompt(false);
      }

      return false;
    }

    // iOS/Safari does not provide beforeinstallprompt.
    // The React UI can show manual installation instructions.
    setShowIOSPrompt(true);
    return false;
  }, []);

  const openIOSPrompt = useCallback(() => {
    setShowIOSPrompt(true);
  }, []);

  const closeIOSPrompt = useCallback(() => {
    setShowIOSPrompt(false);
  }, []);

  return {
    isInstallable: !isInstalled,
    hasNativePrompt,
    isInstalled,
    isOnline,
    isIOS,
    showIOSPrompt,
    installApp,
    openIOSPrompt,
    closeIOSPrompt,
  };
}