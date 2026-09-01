import { saveHistory, getHistory, clearHistory } from './db.js';

const bc = new BroadcastChannel('projector_sync');
let outputs = {}; // Stores state for each output card

// DOM Elements
const btnAddOutput = document.getElementById('btn-add-output');
const outputsGrid = document.getElementById('outputs-grid');
const tplOutputCard = document.getElementById('tpl-output-card');
const historyList = document.getElementById('history-list');
const btnClearHistory = document.getElementById('btn-clear-history');

// --- Initialization ---
async function init() {
  await renderHistory();
  // Listen for pings from opened output windows
  bc.onmessage = (e) => {
    if (e.data.type === 'STATUS' && outputs[e.data.id]) {
      outputs[e.data.id].isOpen = e.data.status === 'OPEN';
      updateCardUI(e.data.id);
      if (e.data.status === 'OPEN') broadcastState(e.data.id);
    }
    // Update preview aspect ratio to exactly match the target monitor
    if (e.data.type === 'DIMENSIONS' && outputs[e.data.targetId]) {
      const card = document.querySelector(`.card[data-id="${e.data.targetId}"]`);
      if (card) {
        card.querySelector('.preview-container').style.aspectRatio = `${e.data.width} / ${e.data.height}`;
      }
    }
  };
}

// --- Output Management ---
btnAddOutput.addEventListener('click', () => {
  const name = prompt('Name for this output?', `Screen ${Object.keys(outputs).length + 1}`);
  if (!name) return;
  
  const id = 'out_' + Date.now();
  outputs[id] = { id, name, type: 'blank', content: null, zoom: 1, panX: 0, panY: 0, isOpen: false };
  createOutputCard(id);
});

function createOutputCard(id) {
  const clone = tplOutputCard.content.cloneNode(true);
  const card = clone.querySelector('.card');
  card.dataset.id = id;
  card.querySelector('.output-name').textContent = outputs[id].name;
  
  // Bind Controls
  card.querySelector('.btn-open').onclick = () => openOutputWindow(id);
  card.querySelector('.btn-blank').onclick = () => setContent(id, 'blank', null);
  card.querySelector('.btn-close').onclick = () => {
    bc.postMessage({ type: 'CLOSE', targetId: id });
    delete outputs[id];
    card.remove();
  };
  
  // URL Input
  const urlInput = card.querySelector('.url-input');
  card.querySelector('.btn-send-url').onclick = () => {
    if (urlInput.value) handleNewContent(id, 'url', urlInput.value);
  };

  // Zoom & Pan
  const zoomSlider = card.querySelector('.zoom-slider');
  const previewContainer = card.querySelector('.preview-container');
  
  zoomSlider.oninput = (e) => {
    outputs[id].zoom = parseFloat(e.target.value);
    applyTransform(id);
  };

  let isDragging = false, startX, startY;
  previewContainer.onmousedown = (e) => {
    isDragging = true;
    startX = e.clientX - outputs[id].panX;
    startY = e.clientY - outputs[id].panY;
  };
  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    outputs[id].panX = e.clientX - startX;
    outputs[id].panY = e.clientY - startY;
    applyTransform(id);
  });
  window.addEventListener('mouseup', () => isDragging = false);

  // Drag & Drop
  previewContainer.ondragover = (e) => { e.preventDefault(); card.classList.add('drag-over'); };
  previewContainer.ondragleave = () => card.classList.remove('drag-over');
 previewContainer.ondrop = (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    
    if (file && file.type.startsWith('image/')) {
      handleNewContent(id, 'image', file); // Dropped from computer
    } else {
      const historyData = e.dataTransfer.getData('application/json');
      if (historyData) {
        const parsed = JSON.parse(historyData);
        if (parsed.source === 'history') bumpAndSetContent(id, parsed.id); // Dropped from history sidebar
      }
    }
  };

  outputsGrid.appendChild(card);
}

function openOutputWindow(id) {
  // Specifying a target name prevents duplicates.
  window.open(`/output.html?id=${id}`, `projector_${id}`, 'width=800,height=600');
  // Assume open until it pings back, UI updates on ping
}

// Helper to move existing items to the top of the list
async function bumpAndSetContent(targetId, historyId) {
  const history = await getHistory();
  const existing = history.find(i => i.id === historyId);
  if (existing) {
    existing.timestamp = Date.now(); // Bump timestamp to now
    await saveHistory(existing);     // Overwrite in DB
    await renderHistory();           // Refresh UI so it jumps to top
    const content = existing.type === 'url' ? existing.url : URL.createObjectURL(existing.blob);
    setContent(targetId, existing.type, content);
  }
}

async function handleNewContent(id, type, data) {
  const history = await getHistory();
  let content = data;
  
  if (type === 'image') {
    // Deduplicate: check if we already have this exact file
    const duplicate = history.find(i => i.type === 'image' && i.filename === data.name && i.blob.size === data.size);
    if (duplicate) return bumpAndSetContent(id, duplicate.id); // Stop here and just bump it

    content = URL.createObjectURL(data);
    await saveHistory({ id: Date.now().toString(), type, blob: data, thumbnail: content, timestamp: Date.now(), filename: data.name });
  } else if (type === 'url') {
    // Deduplicate: check if we already have this exact URL
    const duplicate = history.find(i => i.type === 'url' && i.url === data);
    if (duplicate) return bumpAndSetContent(id, duplicate.id); // Stop here and just bump it

    await saveHistory({ id: Date.now().toString(), type, url: data, thumbnail: '🌐', timestamp: Date.now() });
  }

  renderHistory();
  setContent(id, type, content);
}

function setContent(id, type, content) {
  const state = outputs[id];
  state.type = type;
  state.content = content;
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  
  const card = document.querySelector(`.card[data-id="${id}"]`);
  const zoomSlider = card.querySelector('.zoom-slider');
  zoomSlider.value = 1;
  
  updateCardUI(id);
  broadcastState(id);
}

// --- UI & Syncing ---
function updateCardUI(id) {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  const state = outputs[id];
  
  // Status badge
  const statusBadge = card.querySelector('.status');
  statusBadge.className = `status ${state.isOpen ? 'open' : 'closed'}`;
  statusBadge.textContent = state.isOpen ? '● Live' : '● Closed';
  
  // Preview Layer
  const layer = card.querySelector('.preview-layer');
  if (state.type === 'blank') layer.innerHTML = '';
  if (state.type === 'image') layer.innerHTML = `<img src="${state.content}" />`;
  if (state.type === 'url') layer.innerHTML = `<iframe src="${state.content}" sandbox="allow-scripts allow-same-origin"></iframe>`;
  
  applyTransform(id);
}

function applyTransform(id) {
  const state = outputs[id];
  const layer = document.querySelector(`.card[data-id="${id}"] .preview-layer`);
  layer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  broadcastState(id);
}

function broadcastState(id) {
  bc.postMessage({ type: 'UPDATE', targetId: id, state: outputs[id] });
}

// --- History ---
async function renderHistory() {
  const items = await getHistory();
  historyList.innerHTML = '';
  
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.draggable = true;
    
    // Resolve object URL if it's an image blob
    const displaySrc = item.type === 'image' ? URL.createObjectURL(item.blob) : '';
    const visual = item.type === 'image' 
      ? `<img src="${displaySrc}" />` 
      : `<div style="font-size:24px; padding: 10px;">🌐</div>`;
      
    // Determine the text to show (URL or Filename)
    const labelText = item.type === 'url' ? item.url : (item.filename || 'Image');
      
    // Added title tag so you can hover to see long file names
    el.innerHTML = `${visual}<div class="meta" title="${labelText}">${labelText}</div>`;
    
 // Support dragging from history to output cards
    el.ondragstart = (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ source: 'history', id: item.id }));
    };
    
    // Allow clicking to prompt which screen to send it to
    el.onclick = () => {
      const activeOutputs = Object.values(outputs);
      if (activeOutputs.length === 0) return alert("Add an output first.");
      const targetId = activeOutputs.length === 1 ? activeOutputs[0].id : prompt(`Enter screen number (1-${activeOutputs.length}):`);
      if (!targetId) return;
      const id = activeOutputs.length === 1 ? activeOutputs[0].id : activeOutputs[parseInt(targetId)-1]?.id;
      
      // We now trigger the bump function!
      if (id) bumpAndSetContent(id, item.id);
    };
    
    historyList.appendChild(el);
  });
}

// --- Clear History ---
btnClearHistory.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all history?')) {
    await clearHistory();
    await renderHistory();
  }
});

init();