<script lang="ts">
  import { onMount } from 'svelte';
  import { getMedia, MEDIA_STAMP_KEY } from './wallpaperStore';
  import { createParticles, type Scene } from './particles';

  let { cfg, accent }: { cfg: Record<string, unknown>; accent: string } = $props();
  const kind = $derived(String(cfg.kind ?? 'none'));
  let imageUrl = $state<string | null>(null);
  let videoUrl = $state<string | null>(null);
  let video = $state<HTMLVideoElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let hidden = $state(document.hidden);
  let reduced = $state(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const animate = $derived(!hidden && !reduced);
  let stamp = $state(0);

  onMount(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => (reduced = mq.matches);
    const onVis = () => (hidden = document.hidden);
    mq.addEventListener('change', onMq);
    document.addEventListener('visibilitychange', onVis);
    const onStore = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && MEDIA_STAMP_KEY in c) stamp++;
    };
    chrome.storage?.onChanged.addListener(onStore);
    return () => {
      mq.removeEventListener('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      chrome.storage?.onChanged.removeListener(onStore);
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

  // Particles scene.
  let scene = $state.raw<Scene | null>(null);
  $effect(() => {
    if (kind !== 'particles' || !canvas) return;
    scene = createParticles(canvas, '#e8ecf3', accent);
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
  <div class="media" style="background:{background};filter:{blur ? `blur(${blur}px)` : 'none'};transform:{blur ? 'scale(1.06)' : 'none'}">
    {#if kind === 'video' && videoUrl}
      <video bind:this={video} src={videoUrl} muted loop playsinline autoplay={animate} disablepictureinpicture></video>
    {:else if kind === 'aurora'}
      <div class="aurora" class:paused={!animate} style="--a:{accent}">
        <span class="b1"></span><span class="b2"></span><span class="b3"></span>
      </div>
    {:else if kind === 'particles'}
      <canvas bind:this={canvas}></canvas>
    {/if}
  </div>
  <div class="dim" style="background:rgba(0,0,0,{dim / 100})"></div>
</div>

<style>
  .wallpaper { position: fixed; inset: 0; z-index: 0; overflow: hidden; background: var(--ox-bg); }
  .media, .dim { position: absolute; inset: 0; }
  video, canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
  .aurora { position: absolute; inset: -20%; background: radial-gradient(ellipse at 50% 120%, color-mix(in srgb, var(--a) 10%, transparent), transparent 60%), var(--ox-bg); }
  .aurora span { position: absolute; width: 60vmax; height: 60vmax; border-radius: 50%; filter: blur(90px); opacity: 0.45; animation: drift 38s ease-in-out infinite alternate; will-change: transform; }
  .b1 { background: #3b5bdb; top: 0%; left: 5%; }
  .b2 { background: #0ca678; top: 30%; left: 45%; animation-duration: 46s !important; animation-delay: -12s !important; opacity: 0.3 !important; }
  .b3 { background: color-mix(in srgb, var(--a) 70%, #9c36b5); top: 45%; left: 0%; animation-duration: 54s !important; animation-delay: -25s !important; opacity: 0.32 !important; }
  .aurora.paused span { animation-play-state: paused; }
  @keyframes drift {
    0% { transform: translate3d(0, 0, 0) scale(1); }
    50% { transform: translate3d(12vw, -6vh, 0) scale(1.15); }
    100% { transform: translate3d(-8vw, 8vh, 0) scale(0.95); }
  }
</style>
