import { update } from '../data.ts';
import type { WidgetRec } from '../../../shared/src/types.ts';

/**
 * Typed access to a widget's synced settings (stored in widget.config).
 * Returns the settings merged with defaults and a setter that saves a partial update.
 */
export function useWidgetConfig<T extends object>(widget: WidgetRec, defaults: T) {
  const config = { ...defaults, ...(widget.config as Partial<T>) } as T;
  const setConfig = (patch: Partial<T>) => update('widgets', widget.id, { config: { ...widget.config, ...patch } });
  return [config, setConfig] as const;
}
