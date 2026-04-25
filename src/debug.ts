// Shared debug logging utility
// Enable via: DEBUG=lucid-hud or DEBUG=*

const DEBUG = process.env.DEBUG?.includes('lucid-hud') || process.env.DEBUG === '*';

/**
 * Create a namespaced debug logger
 * @param namespace - Tag for log messages (e.g., 'config', 'usage')
 */
export function createDebug(namespace: string) {
  return function debug(msg: string, ...args: unknown[]): void {
    if (DEBUG) {
      console.error(`[lucid-hud:${namespace}] ${msg}`, ...args);
    }
  };
}
