import { useEffect, useRef } from 'react';

/**
 * Calls `fn` immediately, then every `ms` while the page is visible, and again when it becomes visible.
 * Pass `enabled=false` to pause. `deps` restart the cycle (e.g. when a setting changes).
 */
export function useVisibleInterval(fn: () => void, ms: number, deps: unknown[] = [], enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    run();
    const t = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', run);
    };
  }, [ms, enabled, ...deps]);
}
