<script lang="ts">
  import type { Component } from 'svelte';
  import { widgetDef } from './widgets';
  let { type, props }: { type: string; props: Record<string, unknown> } = $props();
  let Comp = $state<Component<any> | null>(null);
  $effect(() => {
    const def = widgetDef(type);
    let alive = true;
    void def?.load().then((m) => alive && (Comp = m.default));
    return () => (alive = false);
  });
</script>

{#if Comp}<Comp {...props} />{/if}
