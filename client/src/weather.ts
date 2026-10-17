// Open-Meteo (free, no API key): forecast + place search. https://open-meteo.com

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** e.g. "Bavaria, Germany" */
  region: string;
}

export interface Forecast {
  fetchedAt: number;
  current: { temp: number; feelsLike: number; code: number; isDay: boolean; wind: number; humidity: number };
  hourly: { time: string; temp: number; code: number; precipProb: number; isDay: boolean }[];
  daily: { date: string; code: number; max: number; min: number; precipProb: number; sunrise: string; sunset: string }[];
}

const WMO: Record<number, [label: string, day: string, night: string]> = {
  0: ['Clear', '☀️', '🌙'],
  1: ['Mostly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Freezing fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Heavy drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Rain showers', '🌦️', '🌧️'],
  81: ['Rain showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '🌨️', '🌨️'],
  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Thunderstorm, hail', '⛈️', '⛈️'],
  99: ['Thunderstorm, hail', '⛈️', '⛈️'],
};

export const weatherLabel = (code: number) => WMO[code]?.[0] ?? 'Unknown';
export const weatherIcon = (code: number, isDay = true) => WMO[code]?.[isDay ? 1 : 2] ?? '🌡️';

export async function searchPlaces(query: string): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status})`);
  const data = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[];
  };
  return (data.results ?? []).map((r) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
  }));
}

export async function fetchForecast(lat: number, lon: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '6',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Weather failed (HTTP ${res.status})`);
  const d = await res.json();

  // Next 12 hours starting at the current hour (times are local to the location).
  const nowHour = (d.current.time as string).slice(0, 13);
  const startIdx = Math.max(0, (d.hourly.time as string[]).findIndex((t) => t.slice(0, 13) === nowHour));
  const hourly = (d.hourly.time as string[]).slice(startIdx, startIdx + 12).map((time, i) => ({
    time,
    temp: d.hourly.temperature_2m[startIdx + i],
    code: d.hourly.weather_code[startIdx + i],
    precipProb: d.hourly.precipitation_probability[startIdx + i] ?? 0,
    isDay: !!d.hourly.is_day[startIdx + i],
  }));

  return {
    fetchedAt: Date.now(),
    current: {
      temp: d.current.temperature_2m,
      feelsLike: d.current.apparent_temperature,
      code: d.current.weather_code,
      isDay: !!d.current.is_day,
      wind: d.current.wind_speed_10m,
      humidity: d.current.relative_humidity_2m,
    },
    hourly,
    daily: (d.daily.time as string[]).map((date, i) => ({
      date,
      code: d.daily.weather_code[i],
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      precipProb: d.daily.precipitation_probability_max[i] ?? 0,
      sunrise: d.daily.sunrise[i],
      sunset: d.daily.sunset[i],
    })),
  };
}
