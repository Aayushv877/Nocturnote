<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AppSettings } from './types';
  
  // Components
  import Header from './components/Header.svelte';
  import Footer from './components/Footer.svelte';
  import Editor from './components/Editor.svelte';
  import SearchBar from './components/SearchBar.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import UnsavedModal from './components/UnsavedModal.svelte';
  import AboutModal from './components/AboutModal.svelte';
  import RainEffect from './components/RainEffect.svelte';

  // --- STATE ---
  let content = $state('');
  let filePath = $state<string | null>(null);
  let isSaved = $state(true);
  let fileName = $derived(filePath ? filePath.split(/[\\/]/).pop() : 'Untitled');
  let statusMessage = $state('');

  // Cursor Position State
  let currentLine = $state(1);
  let currentCol = $state(1);

  // UI Toggles
  let showSettings = $state(false);
  let showSearch = $state(false);
  let showReplace = $state(false);
  let showUnsavedDialog = $state(false);
  let showAbout = $state(false);
  let rainMode = $state(false);
  let notepadMode = $state(false);

  // Search State
  let searchQuery = $state('');
  let replaceQuery = $state('');
  let searchInputRef: HTMLInputElement; // This ref is inside SearchBar now, might not need direct access if we handle focus differently, or bind it.
  let activeMatchIndex = $state(-1);
  let searchFeedback = $state('');

  // Pending Action (for modal)
  let pendingAction = $state<() => void | null>(null);

  // References
  let textAreaRef = $state<HTMLTextAreaElement>();
  let lineNumRef = $state<HTMLDivElement>();
  let highlightRef = $state<HTMLDivElement>();
  let measureRef = $state<HTMLDivElement>();
  let lineHeights = $state<number[]>([]);

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

  onMount(() => {
    const saved = localStorage.getItem('notepad-settings');
    if (saved) {
      try { settings = { ...settings, ...JSON.parse(saved) }; } catch (e) {}
    }
    calculateLineHeights();
    window.addEventListener('resize', calculateLineHeights);
    window.addEventListener('keydown', preventRefresh);

    // Check for initial file
    window.api.getInitialFile().then((file) => {
      if (file) {
        content = file.content;
        filePath = file.filePath;
        isSaved = true;
        flashStatus('Opened');
        calculateLineHeights();
        updateCursorPos();
      }
    });

    // Listen for files opened externally while running
    window.api.onFileOpened((newContent, newPath) => {
      if (!isSaved) {
         if (!confirm('You have unsaved changes. Open the new file anyway?')) return;
      }
      content = newContent;
      filePath = newPath;
      isSaved = true;
      flashStatus('Opened');
      calculateLineHeights();
      updateCursorPos();
    });

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
      // searchInputRef?.focus(); // Handled by effect in SearchBar
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
      if (!textAreaRef) return;
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
      updateCursorPos();
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
        textAreaRef?.focus();
    }
  }

  function handleScroll() {
    if (textAreaRef) {
        const top = textAreaRef.scrollTop;
        if (lineNumRef) lineNumRef.scrollTop = top;
        if (highlightRef) highlightRef.scrollTop = top;
    }
  }

  function updateCursorPos() {
      if (textAreaRef) {
          const val = textAreaRef.value;
          const sel = textAreaRef.selectionStart;
          const lines = val.substr(0, sel).split('\n');
          currentLine = lines.length;
          currentCol = sel - val.lastIndexOf('\n', sel - 1) - 1;
      }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    content = target.value;
    isSaved = false;
    calculateLineHeights();
    updateCursorPos();
  }

  function onEditorClick() {
      showSearch = false; 
      activeMatchIndex = -1;
      updateCursorPos();
  }

  function flashStatus(msg: string) {
    statusMessage = msg;
    setTimeout(() => statusMessage = '', 2000);
  }

  function handleKeydown(e: KeyboardEvent) {
    updateCursorPos();
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

  // 2. WINDOW CONTROLS
  const winMin = () => window.api.minimize();
  const winMax = () => window.api.maximize();
  const winClose = () => confirmAction(() => window.api.close());

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
      updateCursorPos();
    }
    calculateLineHeights();
  }

  function handleNew() {
    content = '';
    filePath = null;
    isSaved = true;
    flashStatus('New File');
    calculateLineHeights();
    updateCursorPos();
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

<div class="h-screen w-screen flex flex-col overflow-hidden overscroll-none transition-colors duration-500 relative antialiased {notepadMode ? 'bg-[#fdfbf7] text-[#2d3436] selection:bg-[#fde047] selection:text-black' : 'bg-[#0e1019] text-[#cbd5e1] selection:bg-[#fbbf24]/50 selection:text-white'}" style="font-family: system-ui, sans-serif; text-rendering: optimizeLegibility;">
  
  <RainEffect {rainMode} {notepadMode} />

  <Header 
    bind:notepadMode 
    bind:rainMode 
    bind:showSettings 
    bind:showSearch
    bind:showAbout
    {isSaved} 
    {fileName} 
    {isMacOrLinux}
    {winClose}
    {winMin}
    {winMax}
    {toggleSearch}
    {handleNew}
    {handleOpen}
    {handleSave}
    {confirmAction}
  />

  <SearchBar 
    bind:showSearch
    bind:showReplace
    bind:searchQuery
    bind:replaceQuery
    {notepadMode}
    {performSearch}
    {toggleSearch}
    {replaceCurrent}
    {replaceAll}
    {handleSearchKeydown}
  />

  <Editor
    bind:content
    bind:textAreaRef
    bind:lineNumRef
    bind:highlightRef
    bind:measureRef
    {settings}
    {notepadMode}
    {lineHeights}
    {lineNumWidth}
    {lineHeightPx}
    {baselineOffset}
    {highlightedHTML}
    {showSearch}
    {activeMatchIndex}
    {textLines}
    {handleScroll}
    {handleInput}
    {onEditorClick}
  />

  <Footer 
    {content} 
    {notepadMode} 
    {statusMessage} 
    {showSearch} 
    {searchFeedback} 
    {textAreaRef}
    {currentLine}
    {currentCol}
  />

  <SettingsModal 
    bind:showSettings 
    bind:settings 
  />

  <AboutModal
    bind:showAbout
  />

  <UnsavedModal 
    bind:showUnsavedDialog 
    {notepadMode} 
    {fileName} 
    onSave={onDialogSave} 
    onDontSave={onDialogDontSave} 
    onCancel={closeUnsavedDialog}
  />

</div>
