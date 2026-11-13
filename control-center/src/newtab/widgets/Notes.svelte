<script lang="ts">
  import { StoredValue } from '../../lib/kv.svelte';
  import { renderMarkdown } from '../../../../extension/src/logic/markdown.js';
  let { t }: { t: (k: string) => string } = $props();
  const notes = new StoredValue<string>('oxygen.notes', '');
  let preview = $state(true);
</script>

<div class="notes" data-testid="widget-notes">
  <div class="bar">
    <span class="ox-muted head">{t('w.notes')}</span>
    <button class="ox-btn small ghost" onclick={() => (preview = !preview)}>{preview ? t('notes.edit') : t('notes.preview')}</button>
  </div>
  {#if preview && notes.value.trim()}
    <!-- renderMarkdown escapes all input before formatting -->
    <div class="ox-md body ox-scroll" role="button" tabindex="0" ondblclick={() => (preview = false)}>{@html renderMarkdown(notes.value)}</div>
  {:else}
    <textarea class="ox-textarea body" placeholder={t('notes.placeholder')} value={notes.value} oninput={(e) => notes.set((e.target as HTMLTextAreaElement).value, 400)}></textarea>
  {/if}
</div>

<style>
  .notes { height: 100%; display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; }
  .head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; margin-left: 4px; }
  .body { flex: 1; min-height: 0; overflow: auto; font-size: 13.5px; }
  textarea.body { resize: none; }
</style>
