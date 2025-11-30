<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade, fly, scale, slide } from 'svelte/transition';

  // --- TYPES ---
  interface AppSettings {
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    wordWrap: boolean;
    lineHeight: number;
    showLineNumbers: boolean;
  }

  // --- STATE ---
  let content = $state('');
  let filePath = $state<string | null>(null);
  let isSaved = $state(true);
  let fileName = $derived(filePath ? filePath.split(/[\\/]/).pop() : 'Untitled');
  let statusMessage = $state('');

  // UI Toggles
  let showSettings = $state(false);
  let showSearch = $state(false);
  let showReplace = $state(false);
  let showUnsavedDialog = $state(false);
  let rainMode = $state(false);
  let notepadMode = $state(false);

  // Search State
  let searchQuery = $state('');
  let replaceQuery = $state('');
  let searchInputRef: HTMLInputElement;
  let activeMatchIndex = $state(-1);
  let searchFeedback = $state('');

  // Pending Action (for modal)
  let pendingAction = $state<() => void | null>(null);

  // References
  let textAreaRef: HTMLTextAreaElement;
  let lineNumRef: HTMLDivElement;
  let highlightRef: HTMLDivElement;
  let measureRef: HTMLDivElement;
  let lineHeights = $state<number[]>([]);

  // Rain Drops
  const dropCount = 100;
  const drops = Array.from({ length: dropCount }).map(() => ({
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 0.5 + Math.random() * 0.5,
    opacity: 0.1 + Math.random() * 0.3
  }));

  // Default Settings
  let settings = $state<AppSettings>({
    fontSize: 15,
    fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace",
    fontWeight: 400,
    wordWrap: true,
    lineHeight: 1.6,
    showLineNumbers: true
  });

  // --- DERIVED CALCULATIONS ---
  let lineHeightPx = $derived(settings.fontSize * settings.lineHeight);
  const editorPaddingTop = 8;
  let baselineOffset = $derived(editorPaddingTop - (lineHeightPx * 0.15));

  let textLines = $derived(content.split('\n'));
  let lineCount = $derived(textLines.length);
  let maxDigits = $derived(lineCount.toString().length);
  let lineNumWidth = $derived(Math.max(50, (maxDigits * (settings.fontSize * 0.7)) + 20));
  let lineNumbers = $derived(Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'));

  // --- HIGHLIGHTER ---
  let highlightedHTML = $derived.by(() => {
    if (!showSearch || !searchQuery) return escapeHtml(content);
    const regex = new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi');
    let count = -1;
    return escapeHtml(content).replace(regex, (match) => {
        count++;
        const isSelected = count === activeMatchIndex;
        return `<mark class="${isSelected ? 'highlight-active' : 'highlight-match'}">${match}</mark>`;
    });
  });

  function escapeHtml(unsafe: string) {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/\n/g, '<br>');
  }

  function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const fontOptions = [
    { name: 'Modern Mono', value: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace", label: 'System UI' },
    { name: 'Classic Console', value: "Consolas, 'Liberation Mono', Menlo, Courier, monospace", label: 'Retro' },
    { name: 'Clean Sans', value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", label: 'Modern UI' },
    { name: 'Elegant Serif', value: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif", label: 'Reading' }
  ];

  const weightOptions = [
    { label: 'Light', value: 300 },
    { label: 'Normal', value: 400 },
    { label: 'Medium', value: 500 }
  ];

  onMount(() => {
    const saved = localStorage.getItem('notepad-settings');
    if (saved) {
      try { settings = { ...settings, ...JSON.parse(saved) }; } catch (e) {}
    }
    calculateLineHeights();
    window.addEventListener('resize', calculateLineHeights);
    window.addEventListener('keydown', preventRefresh);
    return () => {
      window.removeEventListener('resize', calculateLineHeights);
      window.removeEventListener('keydown', preventRefresh);
    };
  });

  $effect(() => {
    localStorage.setItem('notepad-settings', JSON.stringify(settings));
    calculateLineHeights();
  });

  function preventRefresh(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      flashStatus('Refresh Disabled');
    }
  }

  async function calculateLineHeights() {
    await tick();
    if (!measureRef) return;
    const heights: number[] = [];
    const children = measureRef.children;
    for (let i = 0; i < children.length; i++) {
        heights.push(children[i].getBoundingClientRect().height);
    }
    lineHeights = heights;
  }

  // --- SEARCH ENGINE ---
  async function toggleSearch() {
    showSearch = !showSearch;
    if (showSearch) {
      await tick();
      searchInputRef?.focus();
    } else {
      activeMatchIndex = -1;
      searchFeedback = '';
      textAreaRef?.focus();
    }
  }

  function getMatchIndices(): number[] {
      if (!searchQuery) return [];
      const text = content.toLowerCase();
      const query = searchQuery.toLowerCase();
      const matches: number[] = [];
      let idx = text.indexOf(query);
      while (idx !== -1) {
          matches.push(idx);
          idx = text.indexOf(query, idx + 1);
      }
      return matches;
  }

  function performSearch(direction: 'next' | 'prev', stealFocus: boolean = false, forceFirst: boolean = false) {
    if (!searchQuery || !textAreaRef) {
        activeMatchIndex = -1;
        searchFeedback = '';
        return;
    }

    const matches = getMatchIndices();
    if (matches.length === 0) {
        activeMatchIndex = -1;
        searchFeedback = 'No Matches';
        return;
    }

    let targetMatchArrayIndex = -1;

    if (forceFirst) {
        targetMatchArrayIndex = 0;
    } else {
        const currentCaret = textAreaRef.selectionEnd || 0;
        if (direction === 'next') {
            const foundIdx = matches.findIndex(i => i > currentCaret - (searchQuery.length - 1));
            targetMatchArrayIndex = foundIdx !== -1 ? foundIdx : 0;
            if (foundIdx === -1) flashStatus('Wrapped Top');
        } else {
            let foundIdx = -1;
            for (let i = matches.length - 1; i >= 0; i--) {
                if (matches[i] < textAreaRef.selectionStart) {
                    foundIdx = i;
                    break;
                }
            }
            targetMatchArrayIndex = foundIdx !== -1 ? foundIdx : matches.length - 1;
            if (foundIdx === -1) flashStatus('Wrapped Bottom');
        }
    }

    const targetIndex = matches[targetMatchArrayIndex];
    activeMatchIndex = targetMatchArrayIndex;
    searchFeedback = `Match ${targetMatchArrayIndex + 1} of ${matches.length}`;

    if (targetIndex !== -1) {
        jumpToMatch(targetIndex);
        if(stealFocus) textAreaRef.focus();
    }
  }

  function replaceCurrent() {
      if (!searchQuery) return;
      const matches = getMatchIndices();
      if (activeMatchIndex === -1 || activeMatchIndex >= matches.length) {
          performSearch('next', false, false);
          return;
      }
      const matchIndex = matches[activeMatchIndex];
      const before = content.substring(0, matchIndex);
      const after = content.substring(matchIndex + searchQuery.length);
      content = before + replaceQuery + after;
      isSaved = false;
      tick().then(() => {
          calculateLineHeights();
          performSearch('next', false, false);
      });
  }

  function replaceAll() {
      if (!searchQuery) return;
      const regex = new RegExp(escapeRegExp(searchQuery), 'gi');
      const count = (content.match(regex) || []).length;
      if (count === 0) { flashStatus('No Occurrences'); return; }
      content = content.replace(regex, replaceQuery);
      isSaved = false;
      flashStatus(`Replaced ${count} items`);
      activeMatchIndex = -1;
      searchFeedback = '';
      calculateLineHeights();
  }

  function jumpToMatch(index: number) {
      textAreaRef.setSelectionRange(index, index + searchQuery.length);
      const precedingText = content.substring(0, index);
      const lineIndex = precedingText.split('\n').length - 1;
      let scrollY = 0;
      for(let i = 0; i < lineIndex; i++) { scrollY += lineHeights[i] || lineHeightPx; }
      const viewportHeight = textAreaRef.clientHeight;
      const centeredScroll = Math.max(0, scrollY - (viewportHeight / 2) + (lineHeightPx / 2));
      textAreaRef.scrollTop = centeredScroll;
      if (highlightRef) highlightRef.scrollTop = centeredScroll;
      if (lineNumRef) lineNumRef.scrollTop = centeredScroll;
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) performSearch('prev', false, false);
      else performSearch('next', false, false);
    }
    if (e.key === 'Escape') {
        showSearch = false;
        activeMatchIndex = -1;
        searchFeedback = '';
        textAreaRef.focus();
    }
  }

  function handleScroll() {
    if (textAreaRef) {
        const top = textAreaRef.scrollTop;
        if (lineNumRef) lineNumRef.scrollTop = top;
        if (highlightRef) highlightRef.scrollTop = top;
    }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    content = target.value;
    isSaved = false;
    calculateLineHeights();
  }

  function flashStatus(msg: string) {
    statusMessage = msg;
    setTimeout(() => statusMessage = '', 2000);
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); toggleSearch(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); toggleSearch(); showReplace = true; return; }

    // Safety check shortcuts
    if (!showSettings && !showSearch && !showUnsavedDialog) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); confirmAction(handleOpen); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); confirmAction(handleNew); }
    }
    if (e.key === 'Escape') {
        if (showSettings) showSettings = false;
        if (showUnsavedDialog) closeUnsavedDialog();
    }
  }

  // --- CORE ACTIONS ---
  const isMacOrLinux = window.api.platform === 'darwin' || window.api.platform === 'linux';

  // 1. CONFIRMATION LOGIC
  function confirmAction(action: () => void) {
    if (!isSaved) {
        pendingAction = action;
        showUnsavedDialog = true;
    } else {
        action();
    }
  }

  // 2. WINDOW CONTROLS (Updated to use confirmAction on Close)
  const winMin = () => window.api.minimize();
  const winMax = () => window.api.maximize();
  const winClose = () => confirmAction(() => window.api.close()); // <--- FIX HERE

  // 3. FILE OPERATIONS
  async function handleSave() {
    statusMessage = 'Saving...';
    const result = await window.api.saveFile(content, filePath);
    if (result.success && result.filePath) {
      filePath = result.filePath;
      isSaved = true;
      flashStatus('Saved');
      return true;
    } else {
      flashStatus('Cancelled');
      return false;
    }
  }

  async function handleOpen() {
    const result = await window.api.openFile();
    if (!result.canceled && result.content !== undefined) {
      content = result.content;
      filePath = result.filePath || null;
      isSaved = true;
      flashStatus('Opened');
    }
    calculateLineHeights();
  }

  function handleNew() {
    content = '';
    filePath = null;
    isSaved = true;
    flashStatus('New File');
    calculateLineHeights();
  }

  // 4. DIALOG HANDLERS
  async function onDialogSave() {
    const saved = await handleSave();
    if (saved) {
        showUnsavedDialog = false;
        if (pendingAction) pendingAction();
        pendingAction = null;
    }
  }

  function onDialogDontSave() {
    showUnsavedDialog = false;
    if (pendingAction) pendingAction();
    pendingAction = null;
  }

  function closeUnsavedDialog() {
    showUnsavedDialog = false;
    pendingAction = null;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div bind:this={measureRef} aria-hidden="true" class="antialiased" style="visibility: hidden; position: absolute; top: 0; left: 0; z-index: -1000; width: {textAreaRef ? textAreaRef.clientWidth : 0}px; font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; white-space: {settings.wordWrap ? 'pre-wrap' : 'pre'}; word-break: break-word; padding-left: 16px; padding-right: 32px; box-sizing: border-box; text-rendering: optimizeLegibility;">
    {#each textLines as line} <div style="min-height: {lineHeightPx}px;">{line || ' '}</div> {/each}
</div>

<div class="h-screen w-screen flex flex-col overflow-hidden overscroll-none transition-colors duration-500 relative antialiased {notepadMode ? 'bg-[#fdfbf7] text-[#2d3436] selection:bg-[#fde047] selection:text-black' : 'bg-[#0e1019] text-[#cbd5e1] selection:bg-[#fbbf24]/50 selection:text-white'}" style="font-family: system-ui, sans-serif; text-rendering: optimizeLegibility;">

  {#if rainMode}
    <div transition:fade={{ duration: 1000 }} class="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {#each drops as drop}
            <div class="rain-drop" style="left: {drop.left}%; animation-duration: {drop.duration}s; animation-delay: -{drop.delay}s; opacity: {notepadMode ? drop.opacity * 2 : drop.opacity}; background: {notepadMode ? 'linear-gradient(to bottom, transparent, rgba(250, 204, 21, 0.5), transparent)' : 'linear-gradient(to bottom, transparent, rgba(251, 191, 36, 0.5), transparent)'};"></div>
        {/each}
    </div>
  {/if}

  <header class="h-12 flex items-center justify-between px-4 draggable-region z-50 border-b transition-colors duration-500 relative backdrop-blur-md shrink-0 {notepadMode ? 'bg-[#fdfbf7]/80 border-gray-300' : 'bg-[#0e1019]/80 border-[#2e3245]'}">
    <div class="flex items-center gap-4">
      {#if isMacOrLinux}
        <div class="flex items-center gap-2 no-drag group">
          <button onclick={winClose} class="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-75 transition-all"></button>
          <button onclick={winMin} class="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-75 transition-all"></button>
          <button onclick={winMax} class="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-75 transition-all"></button>
        </div>
      {/if}
      <div class="flex items-center gap-2 transition-opacity {notepadMode ? 'opacity-80' : 'opacity-60'} hover:opacity-100">
        <div class="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentcolor] {isSaved ? 'text-emerald-400 bg-emerald-400' : 'text-amber-400 bg-amber-400'}"></div>
        <span class="text-xs font-medium tracking-wide {notepadMode ? 'text-gray-600' : 'text-gray-400'}">{fileName}</span>
      </div>
    </div>

    <div class="flex items-center gap-1 no-drag">
       <button onclick={toggleSearch} title="Find (Ctrl+F)" class="p-2 rounded-lg transition-all active:scale-95 {showSearch ? 'text-[#fbbf24] bg-[#fbbf24]/10' : (notepadMode ? 'text-gray-400 hover:text-gray-800' : 'text-gray-500 hover:text-[#fbbf24] hover:bg-white/5')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></button>
       <div class="w-px h-4 mx-2 {notepadMode ? 'bg-gray-300' : 'bg-[#2e3245]'}"></div>
       <button onclick={() => notepadMode = !notepadMode} title="Notepad Mode" class="p-2 rounded-lg transition-all active:scale-95 {notepadMode ? 'text-gray-800 bg-gray-200' : 'text-gray-500 hover:text-[#818cf8]'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg></button>
       <button onclick={() => rainMode = !rainMode} title="Rain Mode" class="p-2 rounded-lg transition-all active:scale-95 {rainMode ? 'text-[#818cf8] bg-[#818cf8]/10' : (notepadMode ? 'text-gray-400' : 'text-gray-500 hover:text-[#818cf8]')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg></button>
       <div class="w-px h-4 mx-2 {notepadMode ? 'bg-gray-300' : 'bg-[#2e3245]'}"></div>
       <button onclick={() => showSettings = !showSettings} title="Settings" class="p-2 rounded-lg transition-all active:scale-95 {showSettings ? (notepadMode ? 'bg-gray-200' : 'bg-white/10') : (notepadMode ? 'text-gray-400' : 'text-gray-500 hover:text-[#818cf8]')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 1-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 0 1-1.73l.43-.25a2 2 0 0 0 2 0l.15.08a2 2 0 0 1 2.73-.73l.22-.39a2 2 0 0 1-.73-2.73l-.15-.1a2 2 0 0 0 1-1.72v-.51a2 2 0 0 0-1-1.74l-.15-.09a2 2 0 0 1-.73-2.73l.22-.38a2 2 0 0 1 2.73-.73l.15.08a2 2 0 0 0 2 0l.43-.25a2 2 0 0 0 1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
       <div class="w-px h-4 mx-2 {notepadMode ? 'bg-gray-300' : 'bg-[#2e3245]'}"></div>
       <button onclick={() => confirmAction(handleNew)} title="New File" class="p-2 rounded-lg transition-all active:scale-95 {notepadMode ? 'text-gray-400 hover:text-gray-800' : 'text-gray-500 hover:text-[#818cf8]'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>
       <button onclick={() => confirmAction(handleOpen)} title="Open" class="p-2 rounded-lg transition-all active:scale-95 {notepadMode ? 'text-gray-400 hover:text-gray-800' : 'text-gray-500 hover:text-[#818cf8]'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/></svg></button>
       <button onclick={handleSave} title="Save" class="p-2 rounded-lg transition-all active:scale-95 {notepadMode ? 'text-gray-400 hover:text-gray-800' : 'text-gray-500 hover:text-[#818cf8]'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg></button>
       {#if !isMacOrLinux}
        <div class="ml-2 flex h-full">
            <button onclick={winMin} class="h-8 w-10 flex items-center justify-center {notepadMode ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-white'}"><svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1"/></svg></button>
            <button onclick={winMax} class="h-8 w-10 flex items-center justify-center {notepadMode ? 'hover:bg-gray-200 text-gray-500' : 'hover:bg-white/10 text-white'}"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1" fill="none"><rect x="0.5" y="0.5" width="9" height="9"/></svg></button>
            <button onclick={winClose} class="h-8 w-10 flex items-center justify-center hover:bg-red-500 hover:text-white {notepadMode ? 'text-gray-500' : 'text-white'}"><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1"><path d="M0 0L10 10M10 0L0 10"/></svg></button>
        </div>
       {/if}
    </div>
  </header>

  {#if showSearch}
    <div transition:fly={{ y: -10, duration: 150 }} class="absolute top-16 right-6 z-[60] flex flex-col gap-1 p-1 rounded-lg border shadow-xl {notepadMode ? 'bg-white border-gray-200' : 'bg-[#18181b] border-[#2e3245]'}">
      <div class="flex items-center gap-1">
        <button onclick={() => showReplace = !showReplace} class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 {notepadMode ? 'text-gray-500' : 'text-gray-400'} transition-transform duration-200" style="transform: rotate({showReplace ? '90deg' : '0deg'})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
        <input bind:this={searchInputRef} bind:value={searchQuery} oninput={() => performSearch('next', false, true)} onkeydown={handleSearchKeydown} placeholder="Find..." class="w-48 h-8 px-2 text-sm bg-transparent outline-none {notepadMode ? 'text-gray-800 placeholder-gray-400' : 'text-white placeholder-gray-600'}" />
        <div class="h-4 w-px {notepadMode ? 'bg-gray-200' : 'bg-[#2e3245]'}"></div>
        <button onclick={() => performSearch('prev', false, false)} class="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 {notepadMode ? 'text-gray-500' : 'text-gray-400'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg></button>
        <button onclick={() => performSearch('next', false, false)} class="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 {notepadMode ? 'text-gray-500' : 'text-gray-400'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
        <button onclick={toggleSearch} class="p-1.5 rounded hover:bg-red-500/10 hover:text-red-500 {notepadMode ? 'text-gray-400' : 'text-gray-500'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      {#if showReplace}
        <div transition:slide={{ duration: 150 }} class="flex items-center gap-1 border-t {notepadMode ? 'border-gray-200' : 'border-[#2e3245]'} pt-1 mt-1">
            <div class="w-[22px]"></div>
            <input bind:value={replaceQuery} placeholder="Replace..." class="w-36 h-8 px-2 text-sm bg-transparent outline-none {notepadMode ? 'text-gray-800 placeholder-gray-400' : 'text-white placeholder-gray-600'}" />
            <button onclick={replaceCurrent} title="Replace" class="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 {notepadMode ? 'text-gray-500' : 'text-gray-400'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></button>
            <button onclick={replaceAll} title="Replace All" class="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 {notepadMode ? 'text-gray-500' : 'text-gray-400'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
        </div>
      {/if}
    </div>
  {/if}

  <main class="relative flex-1 z-10 flex overflow-hidden">
    {#if settings.showLineNumbers}
      <div bind:this={lineNumRef} class="h-full select-none pr-3 text-right overflow-hidden transition-all duration-300 shrink-0" style="width: {lineNumWidth}px; font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; color: {notepadMode ? '#9ca3af' : '#52525b'}; background-color: {notepadMode ? 'transparent' : 'rgba(0,0,0,0.2)'}; border-right: {notepadMode ? '2px solid #e0e0e0' : '1px solid #2e3245'}; padding-top: 8px;">
        {#each lineHeights as height, i} <div style="height: {height}px;">{i + 1}</div> {/each}
        <div style="height: 32px;"></div>
      </div>
    {/if}

    <div class="flex-1 relative h-full min-w-0">
        <div bind:this={highlightRef} class="absolute inset-0 z-0 pointer-events-none overflow-hidden pt-2 pb-8 pr-8 pl-4 antialiased" style="font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; white-space: {settings.wordWrap ? 'pre-wrap' : 'pre'}; word-break: break-word; color: transparent;">{@html highlightedHTML}</div>
        <textarea bind:this={textAreaRef} onscroll={handleScroll} onclick={() => { showSearch = false; activeMatchIndex = -1; }} value={content} oninput={handleInput} spellcheck="false" style="font-size: {settings.fontSize}px; font-family: {settings.fontFamily}; font-weight: {settings.fontWeight}; line-height: {lineHeightPx}px; white-space: {settings.wordWrap ? 'pre-wrap' : 'pre'}; background-image: {notepadMode ? 'linear-gradient(transparent calc(100% - 1px), #ffcccc calc(100% - 1px))' : 'none'}; background-size: {notepadMode ? '100% ' + lineHeightPx + 'px' : 'auto'}; background-position: {notepadMode ? '0 ' + baselineOffset + 'px' : '0 0'}; background-attachment: local;" class="absolute inset-0 w-full h-full resize-none bg-transparent pt-2 pb-8 pr-8 pl-4 focus:outline-none leading-relaxed relative z-10 {notepadMode ? 'placeholder-gray-400 caret-black' : 'placeholder-white/10 caret-[#818cf8]'}" placeholder="Type something amazing..."></textarea>
    </div>
  </main>

  <footer class="h-9 flex items-center justify-between px-4 text-xs select-none z-50 border-t transition-colors duration-500 relative shrink-0 {notepadMode ? 'bg-[#fdfbf7] border-gray-300 text-gray-500' : 'bg-[#0e1019] border-[#2e3245] text-[#52525b]'}">
    <div class="flex gap-4 font-mono w-1/3"><span>Ln {content.substr(0, (document.querySelector('textarea')?.selectionStart || 0)).split('\n').length}</span><span>Col {(document.querySelector('textarea')?.selectionStart || 0) - content.lastIndexOf('\n', (document.querySelector('textarea')?.selectionStart || 0) - 1) - 1}</span></div>
    <div class="absolute left-1/2 -translate-x-1/2 font-mono uppercase tracking-[0.2em] pointer-events-none {notepadMode ? 'text-pink-600' : 'text-[#818cf8]'} opacity-80 whitespace-nowrap">{#if statusMessage} <span transition:fade={{ duration: 150 }}>{statusMessage}</span> {:else if showSearch && searchFeedback} <span transition:fade={{ duration: 150 }} class={notepadMode ? 'text-orange-500' : 'text-[#fbbf24]'}>{searchFeedback}</span> {/if}</div>
    <div class="flex gap-4 font-mono w-1/3 justify-end"><span>UTF-8</span><span>{content.length} chars</span></div>
  </footer>

  {#if showUnsavedDialog}
    <div transition:fade={{ duration: 150 }} class="absolute inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm no-drag" onclick={() => { /* Modal backdrop click does nothing to force choice */ }}>
      <div transition:scale={{ duration: 200, start: 0.95 }} class="w-[350px] {notepadMode ? 'bg-white border-gray-200' : 'bg-[#18181b] border-[#2e3245]'} border rounded-xl shadow-2xl overflow-hidden p-6" onclick={(e) => e.stopPropagation()}>
        <h3 class="text-lg font-semibold mb-2 {notepadMode ? 'text-gray-900' : 'text-[#f4f4f5]'}">Unsaved Changes</h3>
        <p class="text-sm mb-6 {notepadMode ? 'text-gray-600' : 'text-[#a1a1aa]'}">You have unsaved changes in <span class="font-medium {notepadMode ? 'text-gray-800' : 'text-white'}">{fileName}</span>. Do you want to save them?</p>
        <div class="flex justify-end gap-3">
            <button onclick={onDialogDontSave} class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {notepadMode ? 'text-red-600 hover:bg-red-50' : 'text-red-400 hover:bg-red-500/10'}">Don't Save</button>
            <button onclick={closeUnsavedDialog} class="px-4 py-2 text-sm font-medium rounded-lg transition-colors {notepadMode ? 'text-gray-600 hover:bg-gray-100' : 'text-[#a1a1aa] hover:bg-[#27272a]'}">Cancel</button>
            <button onclick={onDialogSave} class="px-4 py-2 text-sm font-medium rounded-lg text-white bg-[#818cf8] hover:bg-[#6366f1] transition-colors shadow-lg shadow-[#818cf8]/20">Save</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showSettings}
    <div transition:fade={{ duration: 150 }} class="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm no-drag" onclick={() => showSettings = false}>
      <div transition:scale={{ duration: 200, start: 0.95 }} class="w-[440px] bg-[#18181b] border border-[#2e3245] rounded-xl shadow-2xl overflow-hidden" onclick={(e) => e.stopPropagation()}>
        <div class="px-6 py-4 border-b border-[#2e3245] flex justify-between items-center bg-[#0e1019]">
          <h2 class="text-sm font-semibold tracking-wide text-[#f4f4f5]">Appearance</h2>
          <button onclick={() => showSettings = false} class="text-[#71717a] hover:text-[#f4f4f5] transition-colors text-xs uppercase tracking-wider font-bold">Close</button>
        </div>
        <div class="p-6 space-y-8">
          <div class="space-y-3">
             <label class="text-[11px] font-bold text-[#71717a] uppercase tracking-widest">Typography</label>
             <div class="grid grid-cols-2 gap-2">
               {#each fontOptions as font}
                 <button onclick={() => settings.fontFamily = font.value} class="h-14 rounded-lg border flex flex-col items-center justify-center transition-all duration-200 group relative overflow-hidden {settings.fontFamily === font.value ? 'bg-[#818cf8]/10 border-[#818cf8]/50 text-[#818cf8]' : 'bg-[#2e3245]/50 border-transparent hover:bg-[#2e3245] text-[#a1a1aa] hover:text-[#f4f4f5]'}"><span class="text-sm font-medium z-10 truncate w-full px-2" style="font-family: {font.value}">{font.name}</span><span class="text-[10px] opacity-60 z-10">{font.label}</span></button>
               {/each}
             </div>
          </div>
          <div class="space-y-2">
             <label class="text-[11px] font-bold text-[#71717a] uppercase tracking-widest">Weight</label>
             <div class="grid grid-cols-3 gap-2">
               {#each weightOptions as weight}
                 <button onclick={() => settings.fontWeight = weight.value} class="h-8 rounded-md text-xs font-medium transition-all duration-200 border {settings.fontWeight === weight.value ? 'bg-[#818cf8]/10 border-[#818cf8]/50 text-[#818cf8]' : 'bg-[#2e3245]/50 border-transparent hover:bg-[#2e3245] text-[#a1a1aa] hover:text-[#f4f4f5]'}">{weight.label}</button>
               {/each}
             </div>
          </div>
          <div class="space-y-6">
              <div class="space-y-3"><div class="flex justify-between text-xs text-[#a1a1aa]"><span>Font Size</span><span class="font-mono text-[#818cf8]">{settings.fontSize}px</span></div><input type="range" min="12" max="32" step="1" bind:value={settings.fontSize} class="w-full h-1.5 bg-[#2e3245] rounded-full appearance-none cursor-pointer accent-[#818cf8]"></div>
              <div class="space-y-3"><div class="flex justify-between text-xs text-[#a1a1aa]"><span>Line Height</span><span class="font-mono text-[#818cf8]">{settings.lineHeight}</span></div><input type="range" min="1.0" max="2.5" step="0.1" bind:value={settings.lineHeight} class="w-full h-1.5 bg-[#2e3245] rounded-full appearance-none cursor-pointer accent-[#818cf8]"></div>
          </div>
          <div class="pt-6 border-t border-[#2e3245] space-y-4">
              <label class="flex items-center justify-between cursor-pointer group"><span class="text-sm text-[#d4d4d8] group-hover:text-white transition-colors">Word Wrap</span><div class="relative"><input type="checkbox" bind:checked={settings.wordWrap} class="sr-only peer"><div class="w-10 h-5 bg-[#2e3245] rounded-full peer peer-checked:bg-[#818cf8] transition-colors"></div><div class="absolute top-[2px] left-[2px] bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-full shadow-sm"></div></div></label>
              <label class="flex items-center justify-between cursor-pointer group"><span class="text-sm text-[#d4d4d8] group-hover:text-white transition-colors">Line Numbers</span><div class="relative"><input type="checkbox" bind:checked={settings.showLineNumbers} class="sr-only peer"><div class="w-10 h-5 bg-[#2e3245] rounded-full peer peer-checked:bg-[#818cf8] transition-colors"></div><div class="absolute top-[2px] left-[2px] bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-full shadow-sm"></div></div></label>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .draggable-region { -webkit-app-region: drag; }
  .no-drag { -webkit-app-region: no-drag; }
  textarea::-webkit-scrollbar { width: 10px; }
  textarea::-webkit-scrollbar-track { background: transparent; }
  textarea::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 5px; border: 2px solid transparent; background-clip: content-box; }
  textarea::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); border: 2px solid transparent; background-clip: content-box; }
  :global(.highlight-match) { background-color: rgba(251, 191, 36, 0.2); color: transparent; border-radius: 2px; }
  :global(.highlight-active) { background-color: #f97316; color: transparent; border-radius: 2px; outline: 1px solid rgba(255,255,255,0.3); }
  .bg-\[\#fdfbf7\] :global(.highlight-match) { background-color: rgba(253, 224, 71, 0.4); }
  .bg-\[\#fdfbf7\] :global(.highlight-active) { background-color: #f59e0b; }
  .rain-drop { position: absolute; top: -100px; width: 1px; height: 120px; animation-name: rain-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
  @keyframes rain-fall { 0% { transform: translateY(0); } 100% { transform: translateY(130vh); } }
</style>
