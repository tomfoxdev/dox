const editor = document.getElementById('editor');
const paper = document.getElementById('paper');
const fontSizeInput = document.getElementById('fontSize');
const fontSizeValue = document.getElementById('fontSizeValue');
const fontButtons = Array.from(document.querySelectorAll('[data-font]'));
const driveList = document.getElementById('driveList');
const newFolderBtn = document.getElementById('newFolderBtn');
const newDocBtn = document.getElementById('newDocBtn');
const upFolderBtn = document.getElementById('upFolderBtn');
const currentPathLabel = document.getElementById('currentPath');
const docTitleInput = document.getElementById('docTitle');
const docStatus = document.getElementById('docStatus');
const saveDocBtn = document.getElementById('saveDocBtn');

const editorState = {
  text: '',
  selection: {
    anchor: 0,
    focus: 0,
  },
  preferredColumn: null,
  isFocused: false,
  isDragging: false,
  nodes: {
    before: null,
    selection: null,
    caret: null,
    after: null,
  },
};

const driveState = {
  currentFolder: null,
  path: [],
  listing: { folders: [], documents: [] },
  currentDoc: null,
  isDirty: false,
  isSaving: false,
  saveTimer: null,
};

function clampSelection() {
  const max = editorState.text.length;
  editorState.selection.anchor = Math.max(0, Math.min(max, editorState.selection.anchor));
  editorState.selection.focus = Math.max(0, Math.min(max, editorState.selection.focus));
}

function getSelectionRange() {
  const start = Math.min(editorState.selection.anchor, editorState.selection.focus);
  const end = Math.max(editorState.selection.anchor, editorState.selection.focus);
  return { start, end };
}

function hasSelection() {
  return editorState.selection.anchor !== editorState.selection.focus;
}

function setSelection(anchor, focus) {
  editorState.selection.anchor = anchor;
  editorState.selection.focus = focus;
  clampSelection();
}

function render() {
  clampSelection();
  const scrollTop = paper.scrollTop;

  editor.innerHTML = '';
  const { start, end } = getSelectionRange();

  const before = document.createTextNode(editorState.text.slice(0, start));
  editor.append(before);

  let selectionNode = null;
  let caret = null;

  if (start !== end) {
    selectionNode = document.createElement('span');
    selectionNode.className = 'selection';
    selectionNode.textContent = editorState.text.slice(start, end);
    editor.append(selectionNode);
  } else {
    caret = document.createElement('span');
    caret.className = 'caret';
    editor.append(caret);
  }

  const after = document.createTextNode(editorState.text.slice(end));
  editor.append(after);

  editorState.nodes = { before, selection: selectionNode, caret, after };

  editor.classList.toggle('is-empty', editorState.text.length === 0);
  editor.classList.toggle('is-focused', editorState.isFocused);
  paper.classList.toggle('is-focused', editorState.isFocused);

  paper.scrollTop = scrollTop;

  if (editorState.isFocused && caret) {
    caret.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function setFont(font) {
  editor.dataset.font = font;
  fontButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.font === font);
  });
}

function setFontSize(size) {
  document.documentElement.style.setProperty('--font-size', `${size}px`);
  fontSizeValue.textContent = String(size);
}

function replaceSelection(text) {
  const { start, end } = getSelectionRange();
  const before = editorState.text.slice(0, start);
  const after = editorState.text.slice(end);
  editorState.text = `${before}${text}${after}`;
  const nextCaret = start + text.length;
  setSelection(nextCaret, nextCaret);
  editorState.preferredColumn = null;
  markDirty();
}

function insertText(text) {
  if (hasSelection()) {
    replaceSelection(text);
    return;
  }
  const before = editorState.text.slice(0, editorState.selection.focus);
  const after = editorState.text.slice(editorState.selection.focus);
  editorState.text = `${before}${text}${after}`;
  const nextCaret = editorState.selection.focus + text.length;
  setSelection(nextCaret, nextCaret);
  editorState.preferredColumn = null;
  markDirty();
}

function deleteSelection() {
  if (!hasSelection()) {
    return;
  }
  const { start, end } = getSelectionRange();
  const before = editorState.text.slice(0, start);
  const after = editorState.text.slice(end);
  editorState.text = `${before}${after}`;
  setSelection(start, start);
  editorState.preferredColumn = null;
  markDirty();
}

function deleteBackward() {
  if (hasSelection()) {
    deleteSelection();
    return;
  }
  if (editorState.selection.focus === 0) {
    return;
  }
  const before = editorState.text.slice(0, editorState.selection.focus - 1);
  const after = editorState.text.slice(editorState.selection.focus);
  editorState.text = `${before}${after}`;
  const nextCaret = editorState.selection.focus - 1;
  setSelection(nextCaret, nextCaret);
  editorState.preferredColumn = null;
  markDirty();
}

function deleteForward() {
  if (hasSelection()) {
    deleteSelection();
    return;
  }
  if (editorState.selection.focus >= editorState.text.length) {
    return;
  }
  const before = editorState.text.slice(0, editorState.selection.focus);
  const after = editorState.text.slice(editorState.selection.focus + 1);
  editorState.text = `${before}${after}`;
  editorState.preferredColumn = null;
  markDirty();
}

function collapseSelectionToEdge(direction) {
  if (!hasSelection()) {
    return false;
  }
  const { start, end } = getSelectionRange();
  const target = direction === 'left' ? start : end;
  setSelection(target, target);
  editorState.preferredColumn = null;
  return true;
}

function moveLeft(extend) {
  if (!extend && collapseSelectionToEdge('left')) {
    return;
  }
  const nextCaret = Math.max(0, editorState.selection.focus - 1);
  if (extend) {
    setSelection(editorState.selection.anchor, nextCaret);
  } else {
    setSelection(nextCaret, nextCaret);
  }
  editorState.preferredColumn = null;
}

function moveRight(extend) {
  if (!extend && collapseSelectionToEdge('right')) {
    return;
  }
  const nextCaret = Math.min(editorState.text.length, editorState.selection.focus + 1);
  if (extend) {
    setSelection(editorState.selection.anchor, nextCaret);
  } else {
    setSelection(nextCaret, nextCaret);
  }
  editorState.preferredColumn = null;
}

function getLineData(text) {
  const lines = text.split('\n');
  const starts = [];
  let index = 0;

  for (let i = 0; i < lines.length; i += 1) {
    starts.push(index);
    index += lines[i].length + 1;
  }

  return { lines, starts };
}

function getLineInfo(text, caretIndex) {
  const { lines, starts } = getLineData(text);
  let lineIndex = lines.length - 1;

  for (let i = 0; i < lines.length; i += 1) {
    const lineStart = starts[i];
    const lineEnd = lineStart + lines[i].length;
    if (caretIndex <= lineEnd) {
      lineIndex = i;
      break;
    }
  }

  const column = caretIndex - starts[lineIndex];
  return { lines, starts, lineIndex, column };
}

function moveVertical(direction, extend) {
  const { lines, starts, lineIndex, column } = getLineInfo(
    editorState.text,
    editorState.selection.focus,
  );
  const targetLine = Math.max(0, Math.min(lines.length - 1, lineIndex + direction));
  const desiredColumn = editorState.preferredColumn ?? column;
  const targetColumn = Math.min(desiredColumn, lines[targetLine].length);
  const nextCaret = starts[targetLine] + targetColumn;

  if (extend) {
    setSelection(editorState.selection.anchor, nextCaret);
  } else {
    setSelection(nextCaret, nextCaret);
  }

  editorState.preferredColumn = desiredColumn;
}

function moveLineStart(extend) {
  const { starts, lineIndex } = getLineInfo(editorState.text, editorState.selection.focus);
  const nextCaret = starts[lineIndex];
  if (extend) {
    setSelection(editorState.selection.anchor, nextCaret);
  } else {
    setSelection(nextCaret, nextCaret);
  }
  editorState.preferredColumn = null;
}

function moveLineEnd(extend) {
  const { lines, starts, lineIndex } = getLineInfo(editorState.text, editorState.selection.focus);
  const nextCaret = starts[lineIndex] + lines[lineIndex].length;
  if (extend) {
    setSelection(editorState.selection.anchor, nextCaret);
  } else {
    setSelection(nextCaret, nextCaret);
  }
  editorState.preferredColumn = null;
}

function selectAll() {
  setSelection(0, editorState.text.length);
  editorState.preferredColumn = null;
}

function getCaretFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) {
      return { node: position.offsetNode, offset: position.offset };
    }
  }

  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  }

  return null;
}

function indexFromNodeOffset(node, offset) {
  if (!editor.contains(node)) {
    return null;
  }

  const range = document.createRange();
  range.setStart(editor, 0);

  try {
    range.setEnd(node, offset);
  } catch (error) {
    return null;
  }

  return range.toString().length;
}

function getIndexFromPoint(x, y) {
  const pos = getCaretFromPoint(x, y);
  if (!pos) {
    return null;
  }

  const index = indexFromNodeOffset(pos.node, pos.offset);
  if (index === null) {
    return null;
  }

  return Math.max(0, Math.min(editorState.text.length, index));
}

function handleKeydown(event) {
  const key = event.key.toLowerCase();

  if ((event.metaKey || event.ctrlKey) && key === 'a') {
    event.preventDefault();
    selectAll();
    render();
    return;
  }

  if ((event.metaKey || event.ctrlKey) && key === 's') {
    event.preventDefault();
    saveCurrentDoc();
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  const extend = event.shiftKey;
  let handled = true;

  switch (event.key) {
    case 'ArrowLeft':
      moveLeft(extend);
      break;
    case 'ArrowRight':
      moveRight(extend);
      break;
    case 'ArrowUp':
      moveVertical(-1, extend);
      break;
    case 'ArrowDown':
      moveVertical(1, extend);
      break;
    case 'Home':
      moveLineStart(extend);
      break;
    case 'End':
      moveLineEnd(extend);
      break;
    case 'Backspace':
      deleteBackward();
      break;
    case 'Delete':
      deleteForward();
      break;
    case 'Enter':
      insertText('\n');
      break;
    case 'Tab':
      insertText('  ');
      break;
    default:
      handled = false;
  }

  if (!handled && event.key.length === 1 && !event.isComposing) {
    insertText(event.key);
    handled = true;
  }

  if (handled) {
    event.preventDefault();
    render();
  }
}

function handlePaste(event) {
  const text = event.clipboardData.getData('text/plain');
  if (!text) {
    return;
  }

  event.preventDefault();
  replaceSelection(text);
  render();
}

function handleCopy(event) {
  if (!editorState.isFocused || !hasSelection()) {
    return;
  }
  event.preventDefault();
  const { start, end } = getSelectionRange();
  const text = editorState.text.slice(start, end);
  event.clipboardData.setData('text/plain', text);
}

function handleCut(event) {
  if (!editorState.isFocused || !hasSelection()) {
    return;
  }
  event.preventDefault();
  const { start, end } = getSelectionRange();
  const text = editorState.text.slice(start, end);
  event.clipboardData.setData('text/plain', text);
  deleteSelection();
  render();
}

function handlePointerDown(event) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  editor.focus({ preventScroll: true });
  const index = getIndexFromPoint(event.clientX, event.clientY);
  if (index === null) {
    return;
  }
  setSelection(index, index);
  editorState.isDragging = true;
  editor.setPointerCapture(event.pointerId);
  if (window.getSelection) {
    window.getSelection().removeAllRanges();
  }
  render();
}

function handlePointerMove(event) {
  if (!editorState.isDragging) {
    return;
  }
  const index = getIndexFromPoint(event.clientX, event.clientY);
  if (index === null) {
    return;
  }
  setSelection(editorState.selection.anchor, index);
  render();
}

function handlePointerUp(event) {
  if (!editorState.isDragging) {
    return;
  }
  editorState.isDragging = false;
  if (editor.hasPointerCapture(event.pointerId)) {
    editor.releasePointerCapture(event.pointerId);
  }
}

function handleFocus() {
  editorState.isFocused = true;
  render();
}

function handleBlur() {
  editorState.isFocused = false;
  render();
}

function setDocStatus(message, state) {
  docStatus.textContent = message;
  if (state) {
    docStatus.dataset.state = state;
  } else {
    docStatus.removeAttribute('data-state');
  }
}

function markDirty() {
  if (!driveState.currentDoc) {
    return;
  }
  if (!driveState.isDirty) {
    driveState.isDirty = true;
    setDocStatus('Unsaved changes', 'dirty');
  }
  scheduleSave();
}

function scheduleSave() {
  if (!driveState.currentDoc) {
    return;
  }
  if (driveState.saveTimer) {
    clearTimeout(driveState.saveTimer);
  }
  driveState.saveTimer = setTimeout(() => {
    saveCurrentDoc();
  }, 1500);
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (data && data.error) {
        message = data.error;
      }
    } catch (error) {
      message = message;
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function runAction(action) {
  return action().catch((error) => {
    const message = error && error.message ? error.message : 'Something went wrong.';
    window.alert(message);
  });
}

function renderDriveList() {
  driveList.innerHTML = '';

  const { folders, documents } = driveState.listing;
  if (folders.length === 0 && documents.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'drive-empty';
    empty.textContent = 'No files here yet.';
    driveList.append(empty);
    return;
  }

  folders.forEach((folder) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'drive-item is-folder';
    item.dataset.type = 'folder';
    item.dataset.id = folder.id;
    item.dataset.name = folder.name;
    item.innerHTML = '<span class="drive-item__icon"></span><span class="drive-item__name"></span>';
    item.querySelector('.drive-item__name').textContent = folder.name;
    driveList.append(item);
  });

  documents.forEach((doc) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'drive-item is-doc';
    if (driveState.currentDoc && driveState.currentDoc.id === doc.id) {
      item.classList.add('is-active');
    }
    item.dataset.type = 'doc';
    item.dataset.id = doc.id;
    item.innerHTML = '<span class="drive-item__icon"></span><span class="drive-item__name"></span>';
    item.querySelector('.drive-item__name').textContent = doc.title || 'Untitled';
    driveList.append(item);
  });
}

function renderPath() {
  const parts = ['Root'].concat(driveState.path.map((segment) => segment.name));
  currentPathLabel.textContent = parts.join(' / ');
  upFolderBtn.disabled = driveState.path.length === 0;
}

async function loadDrive(parentID) {
  const url = parentID ? `/api/drive?parent_id=${encodeURIComponent(parentID)}` : '/api/drive';
  const listing = await fetchJSON(url);
  driveState.currentFolder = parentID || null;
  driveState.listing = {
    folders: Array.isArray(listing.folders) ? listing.folders : [],
    documents: Array.isArray(listing.documents) ? listing.documents : [],
  };
  renderDriveList();
  renderPath();
}

async function openDocument(id) {
  const doc = await fetchJSON(`/api/documents/${id}`);
  driveState.currentDoc = doc;
  driveState.isDirty = false;
  docTitleInput.value = doc.title || 'Untitled';
  editorState.text = doc.content || '';
  const end = editorState.text.length;
  setSelection(end, end);
  editorState.preferredColumn = null;
  setDocStatus('Saved', 'saved');
  render();
  renderDriveList();
}

async function createFolder(name) {
  await fetchJSON('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: driveState.currentFolder }),
  });
  await loadDrive(driveState.currentFolder);
}

async function createDocument(title) {
  const doc = await fetchJSON('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      folder_id: driveState.currentFolder,
      content: '',
    }),
  });
  await loadDrive(driveState.currentFolder);
  await openDocument(doc.id);
}

async function saveCurrentDoc() {
  if (!driveState.currentDoc || driveState.isSaving) {
    return true;
  }
  if (!driveState.isDirty) {
    return true;
  }

  driveState.isSaving = true;
  if (driveState.saveTimer) {
    clearTimeout(driveState.saveTimer);
    driveState.saveTimer = null;
  }
  setDocStatus('Saving...', 'saving');

  const payload = {
    title: docTitleInput.value.trim() || 'Untitled',
    content: editorState.text,
    folder_id: driveState.currentDoc.folder_id ?? null,
  };

  try {
    const doc = await fetchJSON(`/api/documents/${driveState.currentDoc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    driveState.currentDoc = doc;
    driveState.isDirty = false;
    setDocStatus('Saved', 'saved');
    await loadDrive(driveState.currentFolder);
    return true;
  } catch (error) {
    setDocStatus('Save failed', 'error');
    return false;
  } finally {
    driveState.isSaving = false;
  }
}

async function maybeSwitchDocument(handler) {
  if (driveState.isDirty) {
    const saved = await saveCurrentDoc();
    if (!saved) {
      const discard = window.confirm('Save failed. Discard changes?');
      if (!discard) {
        return;
      }
    }
  }
  await handler();
}

fontButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setFont(button.dataset.font);
  });
});

fontSizeInput.addEventListener('input', (event) => {
  setFontSize(event.target.value);
});

editor.addEventListener('keydown', handleKeydown);
editor.addEventListener('paste', handlePaste);
editor.addEventListener('copy', handleCopy);
editor.addEventListener('cut', handleCut);
editor.addEventListener('pointerdown', handlePointerDown);
editor.addEventListener('pointermove', handlePointerMove);
editor.addEventListener('pointerup', handlePointerUp);
editor.addEventListener('pointercancel', handlePointerUp);
editor.addEventListener('focus', handleFocus);
editor.addEventListener('blur', handleBlur);

driveList.addEventListener('click', async (event) => {
  const item = event.target.closest('.drive-item');
  if (!item) {
    return;
  }

  const { type, id, name } = item.dataset;

  if (type === 'folder') {
    await runAction(async () => {
      await maybeSwitchDocument(async () => {
        driveState.path.push({ id, name });
        await loadDrive(id);
      });
    });
    return;
  }

  if (type === 'doc') {
    await runAction(async () => {
      await maybeSwitchDocument(async () => {
        await openDocument(id);
      });
    });
  }
});

upFolderBtn.addEventListener('click', async () => {
  if (driveState.path.length === 0) {
    return;
  }
  await runAction(async () => {
    await maybeSwitchDocument(async () => {
      driveState.path.pop();
      const parent = driveState.path[driveState.path.length - 1];
      await loadDrive(parent ? parent.id : null);
    });
  });
});

newFolderBtn.addEventListener('click', async () => {
  const name = window.prompt('Folder name');
  if (!name) {
    return;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  await runAction(async () => {
    await createFolder(trimmed);
  });
});

newDocBtn.addEventListener('click', async () => {
  const title = window.prompt('Document title', 'Untitled');
  if (title === null) {
    return;
  }
  await runAction(async () => {
    await createDocument(title.trim() || 'Untitled');
  });
});

docTitleInput.addEventListener('input', () => {
  if (!driveState.currentDoc) {
    return;
  }
  markDirty();
});

saveDocBtn.addEventListener('click', () => {
  runAction(async () => {
    const saved = await saveCurrentDoc();
    if (!saved) {
      window.alert('Save failed.');
    }
  });
});

setFont('serif');
setFontSize(fontSizeInput.value);
setSelection(0, 0);
render();

(async () => {
  await runAction(async () => {
    await loadDrive(null);
    if (driveState.listing.documents.length > 0) {
      await openDocument(driveState.listing.documents[0].id);
    } else {
      await createDocument('Untitled');
    }
  });
})();
