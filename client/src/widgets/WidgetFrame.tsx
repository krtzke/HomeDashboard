import type { ReactNode } from 'react';
import type { WidgetRec } from '../../../shared/src/types.ts';

export interface WidgetProps {
  widget: WidgetRec;
  editing: boolean;
  onRemove: () => void;
}

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
  return (
    <section className="widget">
      <header className={`widget-header${editing ? ' drag-handle' : ''}`}>
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
          {editing && (
            <button className="icon-btn danger" title="Remove widget" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
      </header>
      <div className="widget-body">{children}</div>
      {footer && <footer className="widget-footer">{footer}</footer>}
    </section>
  );
}
