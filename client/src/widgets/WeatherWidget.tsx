import { useEffect, useState, type FormEvent } from 'react';
import { format, parseISO } from 'date-fns';
import { getMeta, setMeta } from '../db.ts';
import { useVisibleInterval } from '../hooks.ts';
import { fetchForecast, searchPlaces, weatherIcon, weatherLabel, type Forecast, type Place } from '../weather.ts';
import { useWidgetConfig } from './config.ts';
import { WidgetFrame, type WidgetProps } from './WidgetFrame.tsx';

interface WeatherConfig {
  place: Place | null;
}

const DEFAULTS: WeatherConfig = { place: null };
const REFRESH_MS = 30 * 60 * 1000;

const round = (n: number) => Math.round(n);
const cacheKey = (p: Place) => `weather:${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

export function WeatherWidget({ widget, editing, onRemove }: WidgetProps) {
  const [config, setConfig] = useWidgetConfig(widget, DEFAULTS);
  const place = config.place;
  const [settings, setSettings] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Show the cached forecast immediately (works offline), then refresh.
  useEffect(() => {
    setForecast(null);
    if (place) void getMeta<Forecast | null>(cacheKey(place), null).then((f) => f && setForecast((cur) => cur ?? f));
  }, [place?.lat, place?.lon]);

  useVisibleInterval(
    async () => {
      if (!place) return;
      try {
        const f = await fetchForecast(place.lat, place.lon);
        setForecast(f);
        setError(null);
        await setMeta(cacheKey(place), f);
      } catch (err) {
        setError(navigator.onLine ? (err as Error).message : 'Offline');
      }
    },
    REFRESH_MS,
    [place?.lat, place?.lon],
  );

  const showSettings = settings || !place;

  return (
    <WidgetFrame
      title={place?.name ?? 'Weather'}
      icon="🌤️"
      editing={editing}
      onRemove={onRemove}
      onSettings={() => setSettings((s) => !s)}
      settingsOpen={showSettings}
    >
      {showSettings ? (
        <PlaceSearch
          current={place}
          onPick={(p) => {
            void setConfig({ place: p });
            setSettings(false);
          }}
        />
      ) : !forecast ? (
        <p className="empty">{error ? `Couldn't load weather: ${error}` : 'Loading…'}</p>
      ) : (
        <WeatherView forecast={forecast} error={error} />
      )}
    </WidgetFrame>
  );
}

function WeatherView({ forecast: f, error }: { forecast: Forecast; error: string | null }) {
  const c = f.current;
  const today = f.daily[0];
  return (
    <div className="weather">
      <div className="wx-now">
        <span className="wx-icon">{weatherIcon(c.code, c.isDay)}</span>
        <span className="wx-temp">{round(c.temp)}°</span>
        <span className="wx-desc">
          <strong>{weatherLabel(c.code)}</strong>
          <span>
            Feels {round(c.feelsLike)}° · {round(c.wind)} km/h · {c.humidity}%
          </span>
          {today && (
            <span>
              ↑{round(today.max)}° ↓{round(today.min)}° · 🌅 {today.sunrise.slice(11)} · 🌇 {today.sunset.slice(11)}
            </span>
          )}
        </span>
      </div>
      <div className="wx-hours">
        {f.hourly.map((h) => (
          <div key={h.time} className="wx-hour">
            <span>{h.time.slice(11, 13)}h</span>
            <span className="wx-hour-icon">{weatherIcon(h.code, h.isDay)}</span>
            <strong>{round(h.temp)}°</strong>
            <small className={h.precipProb >= 50 ? 'rainy' : ''}>{h.precipProb ? `${h.precipProb}%` : ''}</small>
          </div>
        ))}
      </div>
      <ul className="wx-days">
        {f.daily.slice(1).map((d) => (
          <li key={d.date}>
            <span className="wx-day">{format(parseISO(d.date), 'EEE')}</span>
            <span title={weatherLabel(d.code)}>{weatherIcon(d.code)}</span>
            <span className={`wx-rain${d.precipProb >= 50 ? ' rainy' : ''}`}>{d.precipProb ? `💧${d.precipProb}%` : ''}</span>
            <span className="wx-range">
              <span className="muted">{round(d.min)}°</span> {round(d.max)}°
            </span>
          </li>
        ))}
      </ul>
      <div className="wx-updated">
        {error ? `⚠ ${error} · ` : ''}Updated {format(f.fetchedAt, 'HH:mm')} · Open-Meteo
      </div>
    </div>
  );
}

function PlaceSearch({ current, onPick }: { current: Place | null; onPick: (p: Place) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await searchPlaces(query.trim()));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      <form className="add-row" onSubmit={search}>
        <input autoFocus placeholder="Search city or town…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? '…' : 'Search'}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {results && (
        <ul className="place-results">
          {results.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button onClick={() => onPick(p)}>
                <strong>{p.name}</strong> <small>{p.region}</small>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="empty">No places found</li>}
        </ul>
      )}
      {current && !results && (
        <p className="muted">
          Current: {current.name}, {current.region}
        </p>
      )}
    </div>
  );
}
