import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { COLOR_HEX } from '../colors.ts';
import { useWidgetConfig } from './config.ts';
import { EVENT_COLORS } from '../../../shared/src/types.ts';
import type { EventColor, WidgetRec } from '../../../shared/src/types.ts';

export interface WidgetProps {
  widget: WidgetRec;
  editing: boolean;
  onRemove: () => void;
}

/** The widget being rendered; lets the frame handle features shared by all types (header color, collapsing). */
export interface WidgetContextValue {
  widget: WidgetRec;
  collapsed: boolean;
  toggleCollapsed: () => void;
}

export const WidgetContext = createContext<WidgetContextValue | null>(null);

interface FrameProps {
  title: ReactNode;
  icon: string;
  editing: boolean;
  onRemove: () => void;
  /** Shows a ⚙ button that toggles the widget's settings. */
  onSettings?: () => void;
  settingsOpen?: boolean;
  /** Extra buttons on the right side of the header. */
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function WidgetFrame({ title, icon, editing, onRemove, onSettings, settingsOpen, actions, footer, children }: FrameProps) {
  const ctx = useContext(WidgetContext);
  const widget = ctx?.widget;
  const collapsed = ctx?.collapsed ?? false;
  const [picking, setPicking] = useState(false);
  const headerColor = (widget?.config.headerColor as EventColor | undefined) || null;
  const style = headerColor ? ({ '--header-color': COLOR_HEX[headerColor] } as CSSProperties) : undefined;
  const cls = ['widget', headerColor && 'has-header-color', collapsed && 'collapsed'].filter(Boolean).join(' ');

  // Collapsed widgets stay mounted (body only hidden), so timers keep ringing and data keeps refreshing.
  return (
    <section className={cls} style={style}>
      <header className={`widget-header${editing ? ' drag-handle' : ''}`}>
        {ctx && (
          <button
            className="icon-btn subtle collapse-btn"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
            onClick={ctx.toggleCollapsed}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
        <span className="widget-icon" aria-hidden>
          {icon}
        </span>
        <h2 className="widget-title">{title}</h2>
        <div className="widget-actions">
          {actions}
          {onSettings && (
            <button className={`icon-btn${settingsOpen ? ' active' : ''}`} title="Settings" onClick={onSettings}>
              ⚙
            </button>
          )}
          {editing && widget && (
            <button className={`icon-btn${picking ? ' active' : ''}`} title="Header color" onClick={() => setPicking((p) => !p)}>
              🎨
            </button>
          )}
          {editing && (
            <button className="icon-btn danger" title="Remove widget" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
      </header>
      {editing && picking && widget && <HeaderColorPicker widget={widget} current={headerColor} onDone={() => setPicking(false)} />}
      <div className="widget-body">{children}</div>
      {footer && <footer className="widget-footer">{footer}</footer>}
    </section>
  );
}

function HeaderColorPicker({ widget, current, onDone }: { widget: WidgetRec; current: EventColor | null; onDone: () => void }) {
  const [, setConfig] = useWidgetConfig(widget, { headerColor: '' as EventColor | '' });
  const pick = (headerColor: EventColor | '') => {
    void setConfig({ headerColor });
    onDone();
  };
  return (
    <div className="header-colors swatches" role="radiogroup" aria-label="Header color">
      <button
        className={`swatch none${current === null ? ' active' : ''}`}
        role="radio"
        aria-checked={current === null}
        aria-label="No color"
        title="No color"
        onClick={() => pick('')}
      >
        ∅
      </button>
      {EVENT_COLORS.map((c) => (
        <button
          key={c}
          className={`swatch${current === c ? ' active' : ''}`}
          role="radio"
          aria-checked={current === c}
          aria-label={c}
          title={c}
          style={{ background: COLOR_HEX[c] }}
          onClick={() => pick(c)}
        />
      ))}
    </div>
  );
}
