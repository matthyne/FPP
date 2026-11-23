// Build-time constants injected by vite.config.ts `define`.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

export const VERSION: string = __APP_VERSION__;
export const COMMIT: string = __APP_COMMIT__;
/** e.g. "v1.1.0 (aca03f9)" */
export const VERSION_LABEL = `v${VERSION}${COMMIT ? ` (${COMMIT})` : ''}`;
