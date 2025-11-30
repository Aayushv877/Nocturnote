<script lang="ts">
    import type { AppSettings } from '../types';
    
    let { 
        content = $bindable(), 
        settings, 
        notepadMode,
        lineHeights, 
        lineNumWidth, 
        lineHeightPx, 
        baselineOffset, 
        highlightedHTML,
        showSearch,
        activeMatchIndex,
        textAreaRef = $bindable(),
        lineNumRef = $bindable(),
        highlightRef = $bindable(),
        measureRef = $bindable(),
        handleScroll,
        handleInput,
        textLines,
        onEditorClick
    } = $props<{
        content: string;
        settings: AppSettings;
        notepadMode: boolean;
        lineHeights: number[];
        lineNumWidth: number;
        lineHeightPx: number;
        baselineOffset: number;
        highlightedHTML: string;
        showSearch: boolean;
        activeMatchIndex: number;
        textAreaRef: HTMLTextAreaElement;
        lineNumRef: HTMLDivElement;
        highlightRef: HTMLDivElement;
        measureRef: HTMLDivElement;
        handleScroll: () => void;
        handleInput: (e: Event) => void;
        textLines: string[];
        onEditorClick: () => void;
    }>();

</script>

<div bind:this={measureRef} aria-hidden="true" class="antialiased" style="visibility: hidden; position: absolute; top: 0; left: 0; z-index: -1000; width: {textAreaRef ? textAreaRef.clientWidth : 0}px; font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; white-space: {settings.wordWrap ? 'pre-wrap' : 'pre'}; word-break: break-word; padding-left: 16px; padding-right: 32px; box-sizing: border-box; text-rendering: optimizeLegibility;">
    {#each textLines as line} <div style="min-height: {lineHeightPx}px;">{line || ' '}</div> {/each}
</div>

<main class="relative flex-1 z-10 flex overflow-hidden">
    {#if settings.showLineNumbers}
      <div bind:this={lineNumRef} class="h-full select-none pr-3 text-right overflow-hidden transition-all duration-300 shrink-0" style="width: {lineNumWidth}px; font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; color: {notepadMode ? '#9ca3af' : '#52525b'}; background-color: {notepadMode ? 'transparent' : 'rgba(0,0,0,0.2)'}; border-right: {notepadMode ? '2px solid #e0e0e0' : '1px solid #2e3245'}; padding-top: 8px;">
        {#each lineHeights as height, i} <div style="height: {height}px;">{i + 1}</div> {/each}
        <div style="height: 32px;"></div>
      </div>
    {/if}

    <div class="flex-1 relative h-full min-w-0">
        <div bind:this={highlightRef} class="absolute inset-0 z-0 pointer-events-none overflow-hidden pt-2 pb-8 pr-8 pl-4 antialiased" style="font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; white-space: {settings.wordWrap ? 'pre-wrap' : 'pre'}; word-break: break-word; color: transparent;">{@html highlightedHTML}</div>
        <textarea bind:this={textAreaRef} onscroll={handleScroll} onclick={onEditorClick} value={content} oninput={handleInput} spellcheck="false" style="font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; white-space: {settings.wordWrap ? 'pre-wrap' : 'pre'}; background-image: {notepadMode ? 'linear-gradient(transparent calc(100% - 1px), #ffcccc calc(100% - 1px))' : 'none'}; background-size: {notepadMode ? '100% ' + lineHeightPx + 'px' : 'auto'}; background-position: {notepadMode ? '0 ' + baselineOffset + 'px' : '0 0'}; background-attachment: local;" class="absolute inset-0 w-full h-full resize-none bg-transparent pt-2 pb-8 pr-8 pl-4 focus:outline-none leading-relaxed relative z-10 {notepadMode ? 'placeholder-gray-400 caret-black' : 'placeholder-white/10 caret-[#818cf8]'}" placeholder="Type something amazing..."></textarea>
    </div>
</main>

<style>
  textarea::-webkit-scrollbar { width: 10px; }
  textarea::-webkit-scrollbar-track { background: transparent; }
  textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 5px; border: 2px solid transparent; background-clip: content-box; }
  textarea::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); border: 2px solid transparent; background-clip: content-box; }
</style>
