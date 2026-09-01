const bc = new BroadcastChannel('projector_sync');
const urlParams = new URLSearchParams(window.location.search);
const myId = urlParams.get('id');

const contentLayer = document.getElementById('content-layer');
const fullscreenBtn = document.getElementById('fullscreen-btn');

// Announce presence immediately and when window closes
bc.postMessage({ type: 'STATUS', id: myId, status: 'OPEN' });
window.addEventListener('beforeunload', () => {
  bc.postMessage({ type: 'STATUS', id: myId, status: 'CLOSED' });
});

// Fullscreen Trigger (requires direct user interaction)
fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
    fullscreenBtn.style.display = 'none'; // hide when fullscreen
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) fullscreenBtn.style.display = 'block';
});

// Listen for updates from Control Room
bc.onmessage = (e) => {
  if (e.data.type === 'CLOSE' && e.data.targetId === myId) {
    window.close();
  }
  
  if (e.data.type === 'UPDATE' && e.data.targetId === myId) {
    const state = e.data.state;
    
    // Update Content if changed
    if (contentLayer.dataset.current !== state.content) {
      if (state.type === 'blank') {
        contentLayer.innerHTML = '';
      } else if (state.type === 'image') {
        contentLayer.innerHTML = `<img src="${state.content}" />`;
      } else if (state.type === 'url') {
        // Fallback text hidden behind iframe in case of X-Frame-Options blocking
        contentLayer.innerHTML = `
          <div class="iframe-fallback">If this page remains blank, the website does not allow embedding.</div>
          <iframe src="${state.content}"></iframe>
        `;
      }
      contentLayer.dataset.current = state.content;
    }
    
    // Update Zoom & Pan
    contentLayer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  }
};

// Send true dimensions to Control Room
function sendDimensions() {
  bc.postMessage({ type: 'DIMENSIONS', targetId: myId, width: window.innerWidth, height: window.innerHeight });
}

// Send immediately, on resize, and on fullscreen change
sendDimensions();
window.addEventListener('resize', sendDimensions);
document.addEventListener('fullscreenchange', sendDimensions);