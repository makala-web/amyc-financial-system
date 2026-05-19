let installed = false;

export function installStartupDiagnostics() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    console.error('[AMYC Startup] Unhandled error:', event.message, event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[AMYC Startup] Unhandled promise rejection:', event.reason);
  });
}

export function logStartupStep(step: string, detail?: unknown) {
  if (detail === undefined) {
    console.info(`[AMYC Startup] ${step}`);
    return;
  }

  console.info(`[AMYC Startup] ${step}`, detail);
}
