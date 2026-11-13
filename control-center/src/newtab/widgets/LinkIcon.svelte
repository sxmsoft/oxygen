<script lang="ts">
  import { colorFor, letterFor, parseIcon } from '../../../../extension/src/logic/linkIcons.js';
  import { favicon } from '../../lib/kv.svelte';
  import { customIconUrl, hiResIcon, isDefaultFavicon } from '../../lib/iconStore';
  let { url, title, icon, size = 44, shape = 'rounded', refresh = 0 }: { url: string; title: string; icon?: unknown; size?: number; shape?: string; refresh?: number } = $props();

  const ic = $derived(parseIcon(icon));
  let src = $state('');
  let fallback = $state(false);
  let source = $state<'favicon' | 'hires' | 'custom' | 'letter'>('favicon');

  $effect(() => {
    const cur = ic, u = url, force = refresh > 0;
    let live = true;
    fallback = false;
    if (cur.kind === 'image') {
      source = 'custom';
      void customIconUrl(cur.id).then((s) => live && (s ? (src = s) : ((fallback = true), (source = 'letter'))));
    } else if (cur.kind === 'auto') {
      source = 'favicon';
      src = favicon(u, 64);
      void hiResIcon(u, force).then(async (s) => {
        if (!live) return;
        if (s) {
          src = s;
          source = 'hires';
        } else if (await isDefaultFavicon(u)) {
          if (live) (fallback = true), (source = 'letter');
        }
      });
    }
    return () => (live = false);
  });
  const tileText = $derived(ic.kind === 'emoji' || ic.kind === 'letter' ? ic.text : letterFor(title, url));
  const tileBg = $derived(ic.kind === 'emoji' || ic.kind === 'letter' ? ic.bg : colorFor(url));
  const radius = $derived(shape === 'circle' ? '50%' : shape === 'square' ? `${Math.round(size * 0.12)}px` : `${Math.round(size * 0.28)}px`);
</script>

<span class="ic" style="--s:{size}px;--r:{radius}" data-icon-source={ic.kind === 'emoji' || ic.kind === 'letter' ? ic.kind : source}>
  {#if ic.kind === 'emoji' || ic.kind === 'letter' || fallback}
    <span class="tile" class:emoji={ic.kind === 'emoji'} style="background:{tileBg}">{tileText}</span>
  {:else if src}
    <img {src} alt="" class:full={source !== 'favicon'} onerror={() => ((fallback = true), (source = 'letter'))} />
  {/if}
</span>

<style>
  .ic { width: var(--s); height: var(--s); border-radius: var(--r); display: grid; place-items: center; overflow: hidden; flex: none;
    background: color-mix(in srgb, var(--ox-text) 9%, transparent); }
  img { width: 62%; height: 62%; object-fit: contain; }
  img.full { width: 100%; height: 100%; object-fit: cover; }
  .tile { width: 100%; height: 100%; display: grid; place-items: center; color: #fff; font-weight: 650; font-size: calc(var(--s) * 0.44); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); }
  .tile.emoji { font-size: calc(var(--s) * 0.55); text-shadow: none; }
</style>
