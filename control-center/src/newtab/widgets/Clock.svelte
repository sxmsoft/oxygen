<script lang="ts">
  import { onMount } from 'svelte';
  let { settings, locale }: { settings: Record<string, unknown>; locale: string } = $props();
  let now = $state(new Date());

  // Ticks only while the tab is visible; aligned to the next second/minute boundary.
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      now = new Date();
      if (document.hidden) return;
      const step = settings.seconds ? 1000 : 60_000;
      timer = setTimeout(tick, step - (Date.now() % step) + 5);
    };
    const onVis = () => {
      clearTimeout(timer);
      if (!document.hidden) tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  const lang = $derived(locale === 'tr' ? 'tr-TR' : 'en-US');
  const time = $derived(
    now.toLocaleTimeString(lang, {
      hour: '2-digit',
      minute: '2-digit',
      second: settings.seconds ? '2-digit' : undefined,
      hour12: settings.hour24 === false,
    })
  );
  const date = $derived(now.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }));
</script>

<div class="clock" data-testid="widget-clock">
  <div class="time">{time}</div>
  {#if settings.showDate !== false}<div class="date">{date}</div>{/if}
</div>

<style>
  .clock { height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 4px 6px; }
  .time { font-size: clamp(34px, 4.2vw, 64px); font-weight: 650; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .date { margin-top: 8px; color: var(--ox-muted); font-size: 14px; text-transform: capitalize; }
</style>
