import { useMemo, useState } from 'react';
import { format, getISOWeek } from 'date-fns';
import { useNow } from '../dates.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';

interface ClockConfig {
  showSeconds: boolean;
  /** Optional second time zone (IANA name, e.g. "America/New_York"). */
  tz2: string;
  tz2Label: string;
}

const DEFAULTS: ClockConfig = { showSeconds: false, tz2: '', tz2Label: '' };

function timeIn(tz: string, now: number, seconds: boolean) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds && { second: '2-digit' }),
      weekday: 'short',
    }).format(now);
  } catch {
    return 'Invalid time zone';
  }
}

export function ClockWidget({ widget, editing, onRemove }: WidgetProps) {
  const [config, setConfig] = useWidgetConfig(widget, DEFAULTS);
  const [settings, setSettings] = useState(false);
  const now = useNow(config.showSeconds ? 1000 : 5000);
  const date = new Date(now);
  const zones = useMemo(() => Intl.supportedValuesOf?.('timeZone') ?? [], []);

  return (
    <WidgetFrame
      title={format(date, 'EEEE')}
      icon="🕰️"
      editing={editing}
      onRemove={onRemove}
      onSettings={() => setSettings((s) => !s)}
      settingsOpen={settings}
    >
      {settings ? (
        <div className="settings">
          <label className="check">
            <input type="checkbox" checked={config.showSeconds} onChange={(e) => setConfig({ showSeconds: e.target.checked })} />
            Show seconds
          </label>
          <label className="field">
            Second time zone (optional)
            <input
              list={`tz-${widget.id}`}
              placeholder="e.g. America/New_York"
              defaultValue={config.tz2}
              onBlur={(e) => setConfig({ tz2: e.target.value.trim() })}
            />
            <datalist id={`tz-${widget.id}`}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          <label className="field">
            Label
            <input placeholder="e.g. Grandma" defaultValue={config.tz2Label} onBlur={(e) => setConfig({ tz2Label: e.target.value.trim() })} />
          </label>
          <button className="primary" onClick={() => setSettings(false)}>
            Done
          </button>
        </div>
      ) : (
        <div className="clock">
          <div className="clock-time">
            {format(date, 'HH:mm')}
            {config.showSeconds && <span className="clock-sec">{format(date, ':ss')}</span>}
          </div>
          <div className="clock-date">{format(date, 'd MMMM yyyy')}</div>
          <div className="clock-week">Week {getISOWeek(date)}</div>
          {config.tz2 && (
            <div className="clock-tz2">
              {config.tz2Label || config.tz2.split('/').pop()!.replace(/_/g, ' ')}: {timeIn(config.tz2, now, config.showSeconds)}
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  );
}
