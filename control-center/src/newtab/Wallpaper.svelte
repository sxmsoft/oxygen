<script lang="ts">
  import { onMount } from 'svelte';
  import { getMedia, MEDIA_STAMP_KEY } from './wallpaperStore';
  import { createParticles, type Scene } from './particles';
  import { createAurora } from './aurora';
  import { perf } from '../lib/perf.svelte';
  import { WALLPAPER_IDLE_MS } from '../../../extension/src/logic/perf.js';

  let { cfg, accent }: { cfg: Record<string, unknown>; accent: string } = $props();
  const kind = $derived(String(cfg.kind ?? 'none'));
  let imageUrl = $state<string | null>(null);
  let videoUrl = $state<string | null>(null);
  let video = $state<HTMLVideoElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let hidden = $state(document.hidden);
  let reduced = $state(matchMedia('(prefers-reduced-motion: reduce)').matches);
  let focused = $state(document.hasFocus());
  let idle = $state(false);
  // Animated wallpapers run only while the tab is visible, the window focused,
  // the user active, and performance mode off.
  const animate = $derived(!hidden && !reduced && focused && !idle && !perf.lite);
  let stamp = $state(0);

  onMount(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => (reduced = mq.matches);
    const onVis = () => (hidden = document.hidden);
    mq.addEventListener('change', onMq);
    document.addEventListener('visibilitychange', onVis);
    const onFocus = () => (focused = true);
    const onBlur = () => (focused = false);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPoke = 0;
    const poke = () => {
      const now = Date.now();
      if (!idle && now - lastPoke < 1000) return; // cheap on pointermove
      lastPoke = now;
      idle = false;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => (idle = true), WALLPAPER_IDLE_MS);
    };
    poke();
    addEventListener('focus', onFocus);
    addEventListener('blur', onBlur);
    for (const e of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(e, poke, { passive: true });
    const onStore = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && MEDIA_STAMP_KEY in c) stamp++;
    };
    chrome.storage?.onChanged.addListener(onStore);
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      chrome.storage?.onChanged.removeListener(onStore);
      removeEventListener('focus', onFocus);
      removeEventListener('blur', onBlur);
      for (const e of ['pointermove', 'pointerdown', 'keydown', 'wheel']) removeEventListener(e, poke);
      clearTimeout(idleTimer);
    };
  });

  // Load media for image/video kinds (object URLs are revoked on change).
  $effect(() => {
    const k = kind;
    void stamp;
    let url: string | null = null;
    let cancelled = false;
    if (k === 'image' || k === 'video') {
      void getMedia(k).then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        if (k === 'image') imageUrl = url;
        else videoUrl = url;
      });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      imageUrl = videoUrl = null;
    };
  });

  // Video: play only while visible and motion is allowed.
  $effect(() => {
    if (!video) return;
    if (animate) void video.play().catch(() => {});
    else video.pause();
  });

  // Canvas scenes (particles, aurora).
  let scene = $state.raw<Scene | null>(null);
  $effect(() => {
    if ((kind !== 'particles' && kind !== 'aurora') || !canvas) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--ox-bg').trim() || '#07080b';
    scene = kind === 'aurora' ? createAurora(canvas, /^#[0-9a-f]{6}$/i.test(bg) ? bg : '#07080b', accent) : createParticles(canvas, '#e8ecf3', accent);
    return () => {
      scene?.destroy();
      scene = null;
    };
  });
  $effect(() => {
    if (!scene) return;
    if (animate) scene.start();
    else {
      scene.stop();
      scene.drawStatic();
    }
  });

  const background = $derived.by(() => {
    if (kind === 'solid') return String(cfg.color1);
    if (kind === 'gradient') return `linear-gradient(${Number(cfg.angle)}deg, ${cfg.color1}, ${cfg.color2})`;
    if (kind === 'image' && imageUrl) return `center / cover no-repeat url("${imageUrl}")`;
    return 'var(--ox-bg)';
  });
  const blur = $derived(Number(cfg.blur ?? 0));
  const dim = $derived(Number(cfg.dim ?? 0));
  const playing = $derived(
    (kind === 'video' && !!videoUrl && animate) || ((kind === 'aurora' || kind === 'particles') && animate)
  );
</script>

<div class="wallpaper" data-testid="wallpaper" data-kind={kind} data-playing={String(playing)} data-reduced={String(reduced)} aria-hidden="true">
  <div class="media" style="background:{background};filter:{blur && !perf.lite ? `blur(${blur}px)` : 'none'};transform:{blur && !perf.lite ? 'scale(1.06)' : 'none'}">
    {#if kind === 'video' && videoUrl}
      <video bind:this={video} src={videoUrl} muted loop playsinline autoplay={animate} disablepictureinpicture></video>
    {:else if kind === 'aurora' || kind === 'particles'}
      <canvas bind:this={canvas} class:aurora={kind === 'aurora'}></canvas>
    {/if}
  </div>
  <div class="dim" style="background:rgba(0,0,0,{dim / 100})"></div>
</div>

<style>
  .wallpaper { position: fixed; inset: 0; z-index: 0; overflow: hidden; background: var(--ox-bg); }
  .media, .dim { position: absolute; inset: 0; }
  video, canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
  canvas.aurora { image-rendering: auto; }
</style>
