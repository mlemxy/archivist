// src/dashboard/dashboard.js — ArchivistOS v2
// Menubar, desktop icons, photo widget, glass windows

import { initStats }   from './stats.js';
import { runUpdateCheck } from './updater.js';
import { mountAuthWidget, onUserChange, onBookmarkSaved, onBookmarkDeleted, onSettingChanged } from './auth.js';
import { initWrapped } from './wrapped.js';
import {
  getAllBookmarks, deleteBookmark, updateBookmark,
  getSetting, setSetting,
  exportAllData, importAllData,
} from '../db/database.js';

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
const desktop         = document.getElementById('desktop');
const wallpaperLayer  = document.getElementById('wallpaper-layer');
const windowsLayer    = document.getElementById('windows-layer');
const toast           = document.getElementById('toast');
const menuUsername    = document.getElementById('menu-username');
const menuClock       = document.getElementById('menu-clock');

// Bookmarks
const bmSearch        = document.getElementById('bm-search');
const bmFilterStatus  = document.getElementById('bm-filter-status');
const bmSort          = document.getElementById('bm-sort');
const bmTabs          = document.getElementById('bm-tabs');
const bmGrid          = document.getElementById('bm-grid');
const bmEmpty         = document.getElementById('bm-empty');
const bmPagination    = document.getElementById('bm-pagination');
const pagePrev        = document.getElementById('page-prev');
const pageNext        = document.getElementById('page-next');
const pageNumbers     = document.getElementById('page-numbers');

// Settings
const sUsername       = document.getElementById('s-username');
const sSession        = document.getElementById('s-session');
const sCfbm           = document.getElementById('s-cfbm');
const sCfuvid         = document.getElementById('s-cfuvid');
const sClearance      = document.getElementById('s-clearance');
const sSaveCookies    = document.getElementById('s-save-cookies');
const connStatus      = document.getElementById('conn-status');
const sNotifyEnabled  = document.getElementById('s-notify-enabled');
const wallpaperUpload = document.getElementById('wallpaper-upload');
const wallpaperReset  = document.getElementById('wallpaper-reset');
const wallpaperPreview= document.getElementById('wallpaper-preview');
const sExport         = document.getElementById('s-export');
const sImportFile     = document.getElementById('s-import-file');
const photoUpload     = document.getElementById('photo-upload');
const photoRemoveBtn  = document.getElementById('photo-remove-btn');

// Photo widget
const photoWidget     = document.getElementById('photo-widget');
const photoImg        = document.getElementById('photo-img');
const photoRemove     = document.getElementById('photo-remove');

// Ghost
const ghostTitle      = document.getElementById('ghost-title');
const ghostAuthor     = document.getElementById('ghost-author');
const ghostExcerpt    = document.getElementById('ghost-excerpt');

// Modal
const ficModalOverlay = document.getElementById('fic-modal-overlay');
const modalClose      = document.getElementById('modal-close');
const modalSwatch     = document.getElementById('modal-swatch');
const modalRating     = document.getElementById('modal-rating');
const modalTitle      = document.getElementById('modal-title');
const modalAuthor     = document.getElementById('modal-author');
const modalFandoms    = document.getElementById('modal-fandoms');
const modalWords      = document.getElementById('modal-words');
const modalChapters   = document.getElementById('modal-chapters');
const modalAo3Status  = document.getElementById('modal-ao3-status');
const modalAnnotation = document.getElementById('modal-annotation');
const modalTags       = document.getElementById('modal-tags');
const modalAo3Link    = document.getElementById('modal-ao3-link');
const modalDeleteBtn  = document.getElementById('modal-delete-btn');
const modalDate       = document.getElementById('modal-date');

const confirmOverlay  = document.getElementById('confirm-overlay');
const confirmCancel   = document.getElementById('confirm-cancel');
const confirmDelete   = document.getElementById('confirm-delete');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const PAGE_SIZE       = 12;
let allBookmarks      = [];
let filteredBookmarks = [];
let activeTabStatus   = '';
let currentPage       = 1;
let pendingDeleteId   = null;
let currentModalWorkId= null;
let toastTimer        = null;
let highestZ          = 20;
let dragState         = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function showUpdateBanner(updatedFics) {
  const existing = document.getElementById('update-banner')
  if (existing) existing.remove()
  const banner = document.createElement('div')
  banner.id = 'update-banner'
  banner.className = 'update-banner'
  banner.innerHTML = `
    <span>${updatedFics.length} fic${updatedFics.length > 1 ? 's' : ''} you're reading ${updatedFics.length > 1 ? 'have' : 'has'} new chapters.</span>
    <button onclick="this.parentElement.remove();chrome.runtime.sendMessage({type:'CLEAR_PENDING_UPDATES'})">Dismiss</button>
  `
  document.getElementById('desktop').appendChild(banner)
}

async function init() {
  setupMenubar();
  setupMenuDropdowns();
  setupDesktopIcons();
  setupWindowManager();
  setupDock();
  await loadSettings();
  await loadBookmarks();
  await loadGhostOverlay();
  startClock()
  onUserChange(async () => { await loadBookmarks() })
  openWindow('win-bookmarks')

  // Listen for update check requests from the service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'RUN_UPDATE_CHECK') runUpdateCheck()
  })

  // Auto-check if opened in background by the alarm
  if (new URLSearchParams(window.location.search).get('autocheck') === '1') {
    runUpdateCheck().then(() => window.close())
  }

  // Show pending update banner if any
  chrome.storage.local.get(['pendingUpdates'], ({ pendingUpdates }) => {
    if (pendingUpdates?.length) showUpdateBanner(pendingUpdates)
  })
}

// ---------------------------------------------------------------------------
// Menubar clock
// ---------------------------------------------------------------------------
function startClock() {
  function tick() {
    const now = new Date();
    menuClock.textContent = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// Menubar dropdowns
// ---------------------------------------------------------------------------
function setupMenubar() {
  const items = document.querySelectorAll('.menu-item[id^="menu-"]');
  const dropdowns = {
    'menu-file':   'dropdown-file',
    'menu-view':   'dropdown-view',
    'menu-window': 'dropdown-window',
  };

  // Position dropdowns under their menu item
  const fileItem   = document.getElementById('menu-file');
  const viewItem   = document.getElementById('menu-view');
  const windowItem = document.getElementById('menu-window');
  const ddFile     = document.getElementById('dropdown-file');
  const ddView     = document.getElementById('dropdown-view');
  const ddWindow   = document.getElementById('dropdown-window');

  function positionDropdown(menuItem, dropdown) {
    const rect = menuItem.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
  }

  function closeAll() {
    document.querySelectorAll('.menu-dropdown').forEach((d) => d.classList.add('hidden'));
    document.querySelectorAll('.menu-item').forEach((i) => i.classList.remove('active-menu'));
  }

  function toggleDropdown(menuItem, dropdown) {
    const wasHidden = dropdown.classList.contains('hidden');
    closeAll();
    if (wasHidden) {
      positionDropdown(menuItem, dropdown);
      dropdown.classList.remove('hidden');
      menuItem.classList.add('active-menu');
    }
  }

  fileItem.addEventListener('click',   (e) => { e.stopPropagation(); toggleDropdown(fileItem, ddFile); });
  viewItem.addEventListener('click',   (e) => { e.stopPropagation(); toggleDropdown(viewItem, ddView); });
  windowItem.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(windowItem, ddWindow); });

  document.addEventListener('click', closeAll);
  document.querySelectorAll('.menu-dropdown').forEach((d) => d.addEventListener('click', (e) => e.stopPropagation()));

  // View dropdown — open windows
  document.querySelectorAll('#dropdown-view [data-win]').forEach((btn) => {
    btn.addEventListener('click', () => { openWindow(btn.dataset.win); closeAll(); });
  });

  // File dropdown
  document.getElementById('menu-export').addEventListener('click', () => { doExport(); closeAll(); });
  document.getElementById('menu-import-trigger').addEventListener('click', () => {
    document.getElementById('menu-import-file').click(); closeAll();
  });
  document.getElementById('menu-import-file').addEventListener('change', doImport);
  document.getElementById('menu-new-bookmark').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://archiveofourown.org' }); closeAll();
  });

  // Window dropdown
  document.getElementById('menu-close-all').addEventListener('click', () => {
    document.querySelectorAll('.window').forEach((w) => w.classList.add('hidden'));
    closeAll();
  });
  document.getElementById('menu-tile').addEventListener('click', () => { tileWindows(); closeAll(); });
}

function setupMenuDropdowns() {
  // already handled in setupMenubar
}

// ---------------------------------------------------------------------------
// Desktop icons (right side)
// ---------------------------------------------------------------------------
function setupDesktopIcons() {
  document.querySelectorAll('.desk-icon[data-win]').forEach((icon) => {
    icon.addEventListener('click', () => {
      const winId = icon.dataset.win;
      const win   = document.getElementById(winId);
      if (!win) return;
      if (!win.classList.contains('hidden')) focusWindow(win);
      else openWindow(winId);
    });

    // Double click to open
    icon.addEventListener('dblclick', () => openWindow(icon.dataset.win));
  });
}

// ---------------------------------------------------------------------------
// Ghost overlay
// ---------------------------------------------------------------------------
async function loadGhostOverlay() {
  if (!allBookmarks.length) return;
  const latest = [...allBookmarks].sort(
    (a, b) => new Date(b.dateBookmarked) - new Date(a.dateBookmarked)
  )[0];
  ghostTitle.textContent  = latest.title || '';
  ghostAuthor.textContent = (latest.authors || []).join(', ') || '';
  ghostExcerpt.textContent = latest.annotation
    ? `"${latest.annotation.slice(0, 120)}${latest.annotation.length > 120 ? '...' : ''}"`
    : (latest.fandoms || []).slice(0, 2).join(' · ') || '';
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------
async function loadBookmarks() {
  allBookmarks = await getAllBookmarks();
  currentPage  = 1;
  renderBookmarks();
}

function getFiltered() {
  const query        = bmSearch.value.trim().toLowerCase();
  const statusFilter = bmFilterStatus.value || activeTabStatus;
  const [sortKey, sortDir] = (bmSort.value || 'dateBookmarked-desc').split('-');

  let filtered = [...allBookmarks];
  if (statusFilter) filtered = filtered.filter((b) => b.status === statusFilter);
  if (query) {
    filtered = filtered.filter((b) =>
      [b.title, ...(b.authors||[]), ...(b.fandoms||[]), ...(b.personalTags||[]), b.annotation]
        .join(' ').toLowerCase().includes(query)
    );
  }
  filtered.sort((a, b) => {
    let va = a[sortKey]??0, vb = b[sortKey]??0;
    if (typeof va==='string') va = new Date(va).getTime()||0;
    if (typeof vb==='string') vb = new Date(vb).getTime()||0;
    return sortDir==='asc' ? va-vb : vb-va;
  });
  return filtered;
}

function renderBookmarks() {
  filteredBookmarks = getFiltered();
  const totalPages  = Math.ceil(filteredBookmarks.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const paged = filteredBookmarks.slice(start, start + PAGE_SIZE);

  bmGrid.innerHTML = '';

  if (!filteredBookmarks.length) {
    bmGrid.classList.add('hidden');
    bmEmpty.classList.remove('hidden');
    bmPagination.classList.add('hidden');
    return;
  }

  bmGrid.classList.remove('hidden');
  bmEmpty.classList.add('hidden');

  paged.forEach((bm) => {
    const card = buildFicCard(bm);
    bmGrid.appendChild(card);
  });

  if (totalPages <= 1) {
    bmPagination.classList.add('hidden');
  } else {
    bmPagination.classList.remove('hidden');
    renderPagination(totalPages);
  }
}

function renderPagination(totalPages) {
  pagePrev.disabled = currentPage === 1;
  pageNext.disabled = currentPage === totalPages;
  pageNumbers.innerHTML = '';
  getPagesToShow(currentPage, totalPages).forEach((p) => {
    if (p === '...') {
      const span = document.createElement('span');
      span.textContent = '...';
      span.style.cssText = 'font-size:11px;color:var(--ink-l);padding:0 4px;line-height:28px;';
      pageNumbers.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = 'page-num' + (p === currentPage ? ' active' : '');
      btn.textContent = p;
      btn.addEventListener('click', () => { currentPage = p; renderBookmarks(); bmGrid.scrollTop = 0; });
      pageNumbers.appendChild(btn);
    }
  });
}

function getPagesToShow(c, t) {
  if (t <= 7) return Array.from({length:t},(_,i)=>i+1);
  if (c <= 4) return [1,2,3,4,5,'...',t];
  if (c >= t-3) return [1,'...',t-4,t-3,t-2,t-1,t];
  return [1,'...',c-1,c,c+1,'...',t];
}

pagePrev.addEventListener('click', () => { if (currentPage>1){currentPage--;renderBookmarks();bmGrid.scrollTop=0;} });
pageNext.addEventListener('click', () => { const t=Math.ceil(filteredBookmarks.length/PAGE_SIZE); if(currentPage<t){currentPage++;renderBookmarks();bmGrid.scrollTop=0;} });
bmSearch.addEventListener('input',        () => { currentPage=1; renderBookmarks(); });
bmFilterStatus.addEventListener('change', () => { currentPage=1; renderBookmarks(); });
bmSort.addEventListener('change',         () => { currentPage=1; renderBookmarks(); });

bmTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.bm-tab');
  if (!tab) return;
  bmTabs.querySelectorAll('.bm-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  activeTabStatus = tab.dataset.status || '';
  currentPage = 1;
  renderBookmarks();
});

// ---------------------------------------------------------------------------
// Fic card
// ---------------------------------------------------------------------------
function buildFicCard(bm) {
  const card = document.createElement('div');
  card.className = 'fic-card';
  const statusClass = (bm.status||'Plan to Read').replace(/\s+/g,'-').replace('Plan-to-Read','Plan');
  const stars = bm.starRating ? '\u2605'.repeat(bm.starRating)+'\u2606'.repeat(5-bm.starRating) : '';

  card.innerHTML = `
    <button class="card-delete" title="Delete" data-id="${escHtml(bm.workId)}">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="fic-card-header">
      <div class="card-swatch" style="background:${swatchColor(bm.workId)}"></div>
      <div style="flex:1;min-width:0">
        <p class="card-title">${escHtml(bm.title||'Untitled')}</p>
        <p class="card-author">${escHtml((bm.authors||[]).join(', ')||'Anonymous')}</p>
      </div>
    </div>
    ${bm.fandoms?.[0]?`<span class="card-fandom">${escHtml(bm.fandoms[0])}</span>`:''}
    <div class="card-meta"><span>${formatNumber(bm.wordCount)}w</span><span>·</span><span>${formatChapters(bm.chaptersCurrent,bm.chaptersTotal)}</span></div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span class="card-status ${statusClass}">${escHtml(bm.status||'Plan to Read')}</span>
      ${stars?`<span class="card-stars">${stars}</span>`:''}
    </div>
    ${bm.annotation?`<p class="card-annotation">${escHtml(bm.annotation)}</p>`:''}
    ${bm.hasUpdate?'<span class="card-update-badge">New chapter!</span>':''}
  `;

  card.querySelector('.card-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    pendingDeleteId = bm.workId;
    confirmOverlay.classList.remove('hidden');
  });

  card.addEventListener('click', () => {
    if (bm.hasUpdate) {
      updateBookmark(bm.workId, { hasUpdate: false })
        .then(() => { bm.hasUpdate = false })
        .catch(() => {})
    }
    openFicModal(bm)
  });
  return card;
}

// ---------------------------------------------------------------------------
// Confirm delete
// ---------------------------------------------------------------------------
confirmCancel.addEventListener('click', () => { confirmOverlay.classList.add('hidden'); pendingDeleteId=null; });
confirmDelete.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  confirmOverlay.classList.add('hidden');
  try {
    await deleteBookmark(pendingDeleteId);
    await onBookmarkDeleted(pendingDeleteId);
    pendingDeleteId = null;
    ficModalOverlay.classList.add('hidden');
    await loadBookmarks();
    showToast('Bookmark deleted');
  } catch { showToast('Could not delete. Try again.', true); }
});

// ---------------------------------------------------------------------------
// Fic modal
// ---------------------------------------------------------------------------
function openFicModal(bm) {
  currentModalWorkId = bm.workId;
  modalSwatch.style.background = swatchColor(bm.workId);
  const rs = ratingAbbr(bm.rating);
  modalRating.textContent = rs;
  modalRating.setAttribute('data-rating', rs);
  modalTitle.textContent  = bm.title || 'Untitled';
  modalAuthor.textContent = (bm.authors||[]).join(', ') || 'Anonymous';
  modalFandoms.innerHTML  = '';
  (bm.fandoms||[]).forEach((f) => { const p=document.createElement('span'); p.className='modal-fandom-pill'; p.textContent=f; modalFandoms.appendChild(p); });
  modalWords.textContent     = formatNumber(bm.wordCount) + ' words';
  modalChapters.textContent  = formatChapters(bm.chaptersCurrent, bm.chaptersTotal);
  modalAo3Status.textContent = bm.ao3Status || 'In Progress';
  if (bm.annotation) { modalAnnotation.textContent=bm.annotation; modalAnnotation.classList.remove('hidden'); }
  else { modalAnnotation.classList.add('hidden'); }
  modalTags.innerHTML = '';
  (bm.personalTags||[]).forEach((t) => { const c=document.createElement('span'); c.className='modal-tag'; c.textContent=t; modalTags.appendChild(c); });
  modalAo3Link.href = bm.ao3Url || `https://archiveofourown.org/works/${bm.workId}`;
  modalDate.textContent = bm.dateBookmarked ? 'Saved ' + formatDate(bm.dateBookmarked) : '';
  ficModalOverlay.classList.remove('hidden');
}

modalClose.addEventListener('click', () => ficModalOverlay.classList.add('hidden'));
ficModalOverlay.addEventListener('click', (e) => { if (e.target===ficModalOverlay) ficModalOverlay.classList.add('hidden'); });
modalDeleteBtn.addEventListener('click', () => { pendingDeleteId=currentModalWorkId; confirmOverlay.classList.remove('hidden'); });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function loadSettings() {
  const [username, session, cfbm, cfuvid, clearance, notifyEnabled, wallpaper, photo] =
    await Promise.all([
      getSetting('ao3Username'), getSetting('ao3SessionCookie'),
      getSetting('ao3CfBm'),    getSetting('ao3Cfuvid'),
      getSetting('ao3Clearance'), getSetting('updateCheckEnabled'),
      getSetting('wallpaper'),  getSetting('pinnedPhoto'),
    ]);

  if (username) { sUsername.value=username; updateMenuUsername(username); }
  if (session)  sSession.value  = session;
  if (cfbm)     sCfbm.value     = cfbm;
  if (cfuvid)   sCfuvid.value   = cfuvid;
  if (clearance) sClearance.value = clearance;
  sNotifyEnabled.checked = notifyEnabled !== false;
  if (wallpaper) applyWallpaper(wallpaper);
  if (photo)     applyPinnedPhoto(photo);
}

function updateMenuUsername(username) {
  if (username) menuUsername.textContent = username + 'OS';
}

sSaveCookies.addEventListener('click', async () => {
  const username = sUsername.value.trim();
  await Promise.all([
    setSetting('ao3Username',      username),
    setSetting('ao3SessionCookie', sSession.value.trim()),
    setSetting('ao3CfBm',          sCfbm.value.trim()),
    setSetting('ao3Cfuvid',        sCfuvid.value.trim()),
    setSetting('ao3Clearance',     sClearance.value.trim()),
  ]);
  chrome.runtime.sendMessage({ type:'AO3_COOKIES_UPDATED', payload:{ _otwarchive_session:sSession.value.trim(), __cf_bm:sCfbm.value.trim(), _cfuvid:sCfuvid.value.trim(), cf_clearance:sClearance.value.trim() } });
  await onSettingChanged('ao3Username', username);
  updateMenuUsername(username);
  connStatus.textContent = 'Saved';
  showToast('Connection saved');
  setTimeout(() => { connStatus.textContent = ''; }, 3000);
});

sNotifyEnabled.addEventListener('change', async () => {
  await setSetting('updateCheckEnabled', sNotifyEnabled.checked);
  chrome.runtime.sendMessage({ type:'UPDATE_INTERVAL_CHANGED', payload:{ enabled:sNotifyEnabled.checked, minutes:12*60 } });
});

// Wallpaper
wallpaperUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => { await setSetting('wallpaper', ev.target.result); await onSettingChanged('wallpaper', ev.target.result); applyWallpaper(ev.target.result); showToast('Wallpaper updated'); };
  reader.readAsDataURL(file);
});
wallpaperReset.addEventListener('click', async () => {
  await setSetting('wallpaper', null);
  wallpaperLayer.style.backgroundImage = '';
  wallpaperLayer.style.background = 'radial-gradient(ellipse at 30% 50%, #8B3D47 0%, #561F26 45%, #3D1219 100%)';
  wallpaperPreview.style.backgroundImage = '';
  showToast('Wallpaper reset');
});
function applyWallpaper(dataUrl) {
  wallpaperLayer.style.backgroundImage = `url(${dataUrl})`;
  wallpaperLayer.style.backgroundSize  = 'cover';
  wallpaperLayer.style.backgroundPosition = 'center';
  wallpaperPreview.style.backgroundImage = `url(${dataUrl})`;
}

// Photo pin
photoUpload.addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => { await setSetting('pinnedPhoto', ev.target.result); applyPinnedPhoto(ev.target.result); showToast('Photo pinned to desktop'); };
  reader.readAsDataURL(file);
});
photoRemoveBtn.addEventListener('click', async () => {
  await setSetting('pinnedPhoto', null);
  photoWidget.classList.add('hidden');
  showToast('Photo removed');
});
photoRemove.addEventListener('click', async () => {
  await setSetting('pinnedPhoto', null);
  photoWidget.classList.add('hidden');
  showToast('Photo removed');
});
function applyPinnedPhoto(dataUrl) {
  photoImg.src = dataUrl;
  photoWidget.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Photo widget drag
// ---------------------------------------------------------------------------
(function setupPhotoDrag() {
  let pdrag = null;

  photoWidget.addEventListener('mousedown', (e) => {
    // Don't drag if clicking the remove button
    if (e.target === photoRemove) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = photoWidget.getBoundingClientRect();
    pdrag = {
      startX:   e.clientX,
      startY:   e.clientY,
      origLeft: photoWidget.offsetLeft,
      origTop:  photoWidget.offsetTop,
    };
    photoWidget.classList.add('dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!pdrag) return;
    const dx = e.clientX - pdrag.startX;
    const dy = e.clientY - pdrag.startY;
    photoWidget.style.left   = `${pdrag.origLeft + dx}px`;
    photoWidget.style.top    = `${pdrag.origTop  + dy}px`;
    photoWidget.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (!pdrag) return;
    photoWidget.classList.remove('dragging');
    pdrag = null;
  });
})();

// Export/Import
sExport.addEventListener('click', doExport);
sImportFile.addEventListener('change', doImport);
async function doExport() {
  const data = await exportAllData();
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`archivist-export-${new Date().toISOString().slice(0,10)}.json`; a.click();
  URL.revokeObjectURL(url); showToast('Bookmarks exported');
}
async function doImport(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    await importAllData(data); await loadBookmarks();
    showToast(`Imported ${data.bookmarks?.length||0} bookmarks`);
  } catch { showToast('Import failed. Invalid file.', true); }
}

// ---------------------------------------------------------------------------
// Window manager
// ---------------------------------------------------------------------------
function setupWindowManager() {
  document.addEventListener('mousedown', (e) => {
    const tb = e.target.closest('.win-titlebar');
    if (!tb) return;
    const win = document.getElementById(tb.dataset.win);
    if (!win) return;
    focusWindow(win);
    const rect = win.getBoundingClientRect();
    dragState = { win, startX:e.clientX, startY:e.clientY, origLeft:rect.left, origTop:rect.top };
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    dragState.win.style.left = `${dragState.origLeft + e.clientX - dragState.startX}px`;
    dragState.win.style.top  = `${dragState.origTop  + e.clientY - dragState.startY}px`;
  });

  document.addEventListener('mouseup', () => { dragState = null; });

  // Traffic lights
  document.querySelectorAll('.tl-close').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById(btn.dataset.win)?.classList.add('hidden'); });
  });
  document.querySelectorAll('.tl-min').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById(btn.dataset.win)?.classList.add('hidden'); });
  });
  document.querySelectorAll('.tl-max').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const win = document.getElementById(btn.dataset.win); if (!win) return;
      if (win.classList.contains('maximized')) {
        win.classList.remove('maximized');
        win.style.left=win.dataset.prevLeft||'60px'; win.style.top=win.dataset.prevTop||'48px';
        win.style.width=win.dataset.prevWidth||'760px'; win.style.height=win.dataset.prevHeight||'520px';
      } else {
        win.dataset.prevLeft=win.style.left; win.dataset.prevTop=win.style.top;
        win.dataset.prevWidth=win.style.width; win.dataset.prevHeight=win.style.height;
        win.classList.add('maximized');
      }
    });
  });

  windowsLayer.addEventListener('mousedown', (e) => {
    const win = e.target.closest('.window'); if (win) focusWindow(win);
  });
}

function focusWindow(win) {
  highestZ++; win.style.zIndex = highestZ;
  document.querySelectorAll('.window').forEach((w) => w.classList.remove('focused'));
  win.classList.add('focused');
}

function openWindow(winId) {
  const win = document.getElementById(winId); if (!win) return;
  win.classList.remove('hidden'); focusWindow(win);
  if (winId === 'win-bookmarks') renderBookmarks();
  if (winId === 'win-sync') {
    const body = document.getElementById('sync-win-body');
    if (body && !body.dataset.inited) { body.dataset.inited = 'true'; mountAuthWidget(body); }
  }
  if (winId === 'win-stats') {
    const body = win.querySelector('.win-body-noscroll, .win-body');
    if (body && !body.dataset.inited) { body.dataset.inited='true'; initStats(body); }
  }
  if (winId === 'win-wrapped') {
    const body = win.querySelector('.win-body-noscroll, .win-body');
    if (body && !body.dataset.inited) { body.dataset.inited='true'; initWrapped(body); }
  }
}

function tileWindows() {
  const visible = Array.from(document.querySelectorAll('.window')).filter((w) => !w.classList.contains('hidden'));
  if (!visible.length) return;
  const cols = Math.ceil(Math.sqrt(visible.length));
  const rows = Math.ceil(visible.length / cols);
  const W = (window.innerWidth - 20) / cols;
  const H = (window.innerHeight - 28 - 80) / rows;
  visible.forEach((win, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    win.style.left = `${col * W + 8}px`;
    win.style.top  = `${28 + row * H + 8}px`;
    win.style.width  = `${W - 12}px`;
    win.style.height = `${H - 12}px`;
    win.classList.remove('maximized');
  });
}

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------
function setupDock() {
  document.querySelectorAll('.dock-item[data-win]').forEach((item) => {
    item.addEventListener('click', () => {
      const winId = item.dataset.win;
      const win   = document.getElementById(winId); if (!win) return;
      if (!win.classList.contains('hidden')) focusWindow(win);
      else openWindow(winId);
    });
  });
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function showToast(message, isError=false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.remove('hidden'); toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); setTimeout(()=>toast.classList.add('hidden'),200); }, 2400);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function swatchColor(workId) {
  let hash=0; for (const ch of String(workId)) hash=(hash*31+ch.charCodeAt(0))&0xffffffff;
  return `hsl(${Math.abs(hash)%360}, 40%, 32%)`;
}
function ratingAbbr(r) {
  if (!r) return 'NR';
  if (r.includes('General')) return 'G'; if (r.includes('Teen')) return 'T';
  if (r.includes('Mature'))  return 'M'; if (r.includes('Explicit')) return 'E';
  return 'NR';
}
function formatNumber(n) { if (!n&&n!==0) return '0'; return n.toLocaleString(); }
function formatChapters(c, t) { if (!c&&c!==0) return 'unknown'; return t===null?`${c}/?`:`${c}/${t}`; }
function formatDate(str) { if (!str) return ''; try { return new Date(str).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); } catch { return str; } }
function escHtml(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

init();
