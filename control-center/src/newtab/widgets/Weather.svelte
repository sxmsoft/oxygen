<script lang="ts">
  import { describeWeather } from './weatherCodes';
  let { settings, locale, t }: { settings: Record<string, unknown>; locale: string; t: (k: string, p?: Record<string, string | number>) => string } = $props();

  interface Weather {
    place: string;
    temp: number;
    feels: number;
    code: number;
    isDay: boolean;
    wind: number;
    days: { date: string; max: number; min: number; code: number }[];
    at: number;
  }
  const CACHE_KEY = 'oxygen.weather.cache';
  const TTL = 30 * 60_000;
  let data = $state<Weather | null>(null);
  let error = $state('');
  let loading = $state(false);

  async function load(city: string, unit: string) {
    error = '';
    if (!city.trim()) {
      data = null;
      return;
    }
    const key = `${city.trim().toLowerCase()}|${unit}|${locale}`;
    const readCache = async () => ((await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? {}) as Record<string, Weather>;
    let cache = await readCache();
    if (cache[key] && Date.now() - cache[key].at < TTL) {
      data = cache[key];
      return;
    }
    loading = true;
    // One fetch for all open new tabs: the first takes the lock, the others then
    // find its fresh result in the cache.
    const locked = (f: () => Promise<void>): Promise<void> => (navigator.locks ? (navigator.locks.request('oxygen-weather', f) as Promise<void>) : f());
    try {
      await locked(async () => {
      cache = await readCache();
      if (cache[key] && Date.now() - cache[key].at < TTL) {
        data = cache[key];
        return;
      }
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=${locale}&name=${encodeURIComponent(city.trim())}`).then((r) => r.json());
      const g = geo?.results?.[0];
      if (!g) throw new Error('not found');
      const f = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
          `&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto&temperature_unit=${unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'}`
      ).then((r) => r.json());
      const w: Weather = {
        place: [g.name, g.country_code].filter(Boolean).join(', '),
        temp: Math.round(f.current.temperature_2m),
        feels: Math.round(f.current.apparent_temperature),
        code: f.current.weather_code,
        isDay: f.current.is_day === 1,
        wind: Math.round(f.current.wind_speed_10m),
        days: (f.daily.time as string[]).slice(1).map((d, i) => ({
          date: d,
          max: Math.round(f.daily.temperature_2m_max[i + 1]),
          min: Math.round(f.daily.temperature_2m_min[i + 1]),
          code: f.daily.weather_code[i + 1],
        })),
        at: Date.now(),
      };
      data = w;
      await chrome.storage.local.set({ [CACHE_KEY]: { ...cache, [key]: w } });
      });
    } catch {
      error = t('w.weather.error');
      data = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load(String(settings.city ?? ''), String(settings.unit ?? 'celsius'));
  });
  const now = $derived(data ? describeWeather(data.code, locale, data.isDay) : null);
  const dayName = (d: string) => new Date(d + 'T12:00').toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short' });
</script>

<div class="weather" data-testid="widget-weather" data-state={data ? 'ok' : error ? 'error' : loading ? 'loading' : 'empty'}>
  {#if data && now}
    <div class="main">
      <span class="icon">{now.icon}</span>
      <div>
        <div class="temp">{data.temp}°</div>
        <div class="ox-muted small">{now.label} · {data.place}</div>
      </div>
    </div>
    <div class="days">
      {#each data.days as d}
        <div class="day"><span>{dayName(d.date)}</span><span>{describeWeather(d.code, locale).icon}</span><span>{d.max}° <em>{d.min}°</em></span></div>
      {/each}
    </div>
  {:else}
    <div class="ox-muted msg">{loading ? t('w.weather.loading') : error || t('w.weather.setCity')}</div>
  {/if}
</div>

<style>
  .weather { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 2px 4px; }
  .main { display: flex; align-items: center; gap: 12px; }
  .icon { font-size: 38px; line-height: 1; }
  .temp { font-size: 32px; font-weight: 650; line-height: 1; }
  .small { font-size: 12.5px; margin-top: 4px; }
  .days { display: flex; gap: 6px; }
  .day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12px; padding: 6px 0; border-radius: var(--ox-radius); background: color-mix(in srgb, var(--ox-text) 5%, transparent); }
  .day em { color: var(--ox-muted); font-style: normal; }
  .msg { font-size: 13px; text-align: center; }
</style>
