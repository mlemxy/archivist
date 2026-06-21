// src/dashboard/wrapped.js
// Archivist — AO3 Wrapped (Phase 3)
// Generates Spotify-Wrapped-style portrait cards from AO3 history + bookmarks.
// Cards are rendered as HTML/CSS and exported as PNG via html2canvas.

import { getAllBookmarks, getSetting, getCachedHistory, setCachedHistory, getCachedHistoryForRange } from '../db/database.js';
import { scrapeReadingHistory }        from './ao3-scraper.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let isScraping    = false;
let wrappedData   = null;

// ---------------------------------------------------------------------------
// Public init
// ---------------------------------------------------------------------------
export async function initWrapped(container) {
  container.innerHTML = buildWrappedShell();
  bindWrappedEvents(container);
}

// ---------------------------------------------------------------------------
// Shell HTML
// ---------------------------------------------------------------------------
function buildWrappedShell() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= 2008; y--) years.push(y);

  return `
    <div class="wrapped-root">

      <!-- Controls -->
      <div class="wrapped-bar">
        <div class="wrapped-bar-left">
          <span class="stats-bar-label">Year</span>
          <select id="wrapped-year" class="stats-select">
            ${years.map((y) => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('')}
          </select>
        </div>
        <div class="wrapped-bar-right">
          <button class="btn btn-primary btn-sm" id="wrapped-generate-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Generate My Wrapped
          </button>
          <button class="btn btn-ghost btn-sm hidden" id="wrapped-download-all-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download all cards
          </button>
        </div>
      </div>

      <!-- Progress -->
      <div class="stats-progress hidden" id="wrapped-progress">
        <div class="stats-progress-bar-track">
          <div class="stats-progress-bar" id="wrapped-progress-bar" style="width:0%"></div>
        </div>
        <p class="stats-progress-text" id="wrapped-progress-text">Connecting to AO3...</p>
        <p class="stats-pause-text hidden" id="wrapped-pause-text"></p>
      </div>

      <!-- Error -->
      <div class="stats-error hidden" id="wrapped-error"></div>

      <!-- Cards container -->
      <div class="wrapped-cards-area hidden" id="wrapped-cards-area">
        <div class="wrapped-cards-scroll" id="wrapped-cards-scroll"></div>
      </div>

      <!-- Empty state -->
      <div class="wrapped-empty" id="wrapped-empty">
        <div class="coming-soon-icon-wrap" style="color:var(--rose)">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </div>
        <p class="coming-soon-title">Your year in fics</p>
        <p class="coming-soon-sub">Choose a year and click Generate to create your personalised reading recap. Your AO3 history will be fetched automatically using your saved cookies.</p>
      </div>

    </div>
  `;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bindWrappedEvents(container) {
  container.querySelector('#wrapped-generate-btn').addEventListener('click', async () => {
    if (isScraping) return;
    const year = parseInt(container.querySelector('#wrapped-year').value, 10);
    await runWrapped(container, year);
  });

  container.querySelector('#wrapped-download-all-btn').addEventListener('click', () => {
    downloadAllCards(container);
  });
}

// ---------------------------------------------------------------------------
// Run: scrape + generate
// ---------------------------------------------------------------------------
async function runWrapped(container, year) {
  isScraping = true;

  const generateBtn     = container.querySelector('#wrapped-generate-btn');
  const downloadAllBtn  = container.querySelector('#wrapped-download-all-btn');
  const progressEl      = container.querySelector('#wrapped-progress');
  const progressBar     = container.querySelector('#wrapped-progress-bar');
  const progressTxt     = container.querySelector('#wrapped-progress-text');
  const pauseTxt        = container.querySelector('#wrapped-pause-text');
  const errorEl         = container.querySelector('#wrapped-error');
  const cardsArea       = container.querySelector('#wrapped-cards-area');
  const emptyEl         = container.querySelector('#wrapped-empty');

  generateBtn.disabled = true;
  downloadAllBtn.classList.add('hidden');
  errorEl.classList.add('hidden');
  cardsArea.classList.add('hidden');
  emptyEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  progressTxt.textContent = 'Connecting to AO3...';

  try {
    const [username, cookies, bookmarks] = await Promise.all([
      getSetting('ao3Username'),
      loadCookies(),
      getAllBookmarks(),
    ]);

    if (!username || !cookies._otwarchive_session) {
      throw new Error('No AO3 connection found. Open Settings and save your AO3 cookies first.');
    }

    // Smart cache check — exact match OR any wider cached range that contains this year
    let history = null;
    let fromCache = false;
    let cacheSource = '';

    const exactCache = await getCachedHistory(username, year, year);
    if (exactCache) {
      history     = exactCache;
      fromCache   = true;
      cacheSource = `${year}`;
    } else {
      const rangeCache = await getCachedHistoryForRange(username, year, year);
      if (rangeCache) {
        history     = rangeCache.works;
        fromCache   = true;
        cacheSource = rangeCache.sourceRange;
      }
    }

    if (fromCache) {
      progressBar.style.width = '100%';
      progressTxt.textContent = `Loaded ${history.length} works from cache (${cacheSource}).`;
      pauseTxt.classList.add('hidden');
      await new Promise((r) => setTimeout(r, 800));
    } else {
      // No cache — estimate time and show it before scraping
      progressTxt.textContent = 'Estimating time needed...';
      const estimated = await estimateScrapeTime(username, cookies, year);
      progressTxt.textContent = `Estimated time: ${estimated}. Starting now...`;
      await new Promise((r) => setTimeout(r, 1500));

      history = await scrapeReadingHistory({
        username, cookies,
        yearFrom: year, yearTo: year,
        onProgress: (page, total, found) => {
          progressBar.style.width = `${Math.round((page / total) * 100)}%`;
          progressTxt.textContent = `Page ${page} of ${total} — ${found} works found`;
          pauseTxt.classList.add('hidden');
        },
        onPause: (secs) => {
          pauseTxt.classList.remove('hidden');
          const m = Math.floor(secs / 60), s = secs % 60;
          pauseTxt.textContent = m > 0 ? `Pausing ${m}m ${s}s...` : `Pausing ${s}s...`;
        },
        onStatus: (msg) => { progressTxt.textContent = msg; },
      });
      await setCachedHistory(username, year, year, history);
    }

    progressEl.classList.add('hidden');

    wrappedData = computeWrapped(history, bookmarks, year, username);
    renderCards(container, wrappedData, year);

    cardsArea.classList.remove('hidden');
    downloadAllBtn.classList.remove('hidden');

  } catch (err) {
    progressEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    isScraping           = false;
    generateBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Estimate scrape time by peeking at page 1 to get total pages
// ---------------------------------------------------------------------------
async function estimateScrapeTime(username, cookies, year) {
  try {
    await setCookiesForDomainLocal(cookies);
    const url  = `https://archiveofourown.org/users/${encodeURIComponent(username)}/readings?page=1`;
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return 'unknown (could not connect)';
    const html  = await resp.text();
    const parser = new DOMParser();
    const doc   = parser.parseFromString(html, 'text/html');
    let totalPages = 1;
    doc.querySelectorAll('ol.pagination li').forEach((li) => {
      const n = parseInt(li.textContent.trim(), 10);
      if (!isNaN(n) && n > totalPages) totalPages = n;
    });

    // Time estimate:
    // 4s per page + 2s jitter avg = ~5s per page
    // Every 10 pages = 5 min pause
    // Number of pauses = floor(totalPages / 10)
    const pageTime   = totalPages * 5;
    const pauseTime  = Math.floor(totalPages / 10) * 300; // 5 min each
    const totalSecs  = pageTime + pauseTime;
    return formatDuration(totalSecs);
  } catch {
    return 'unknown';
  }
}

async function setCookiesForDomainLocal(cookies) {
  const url    = 'https://archiveofourown.org/';
  const domain = '.archiveofourown.org';
  const map    = { '_otwarchive_session':cookies._otwarchive_session, '__cf_bm':cookies.__cf_bm, '_cfuvid':cookies._cfuvid, 'cf_clearance':cookies.cf_clearance };
  await Promise.all(Object.entries(map).filter(([,v])=>v?.trim()).map(([name,value])=>new Promise((r)=>chrome.cookies.set({url,name,value,domain,path:'/'},r))));
}

function formatDuration(secs) {
  if (secs < 60)   return `${secs} seconds`;
  if (secs < 3600) return `~${Math.round(secs / 60)} minutes`;
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h} hour${h>1?'s':''}`;
}

async function loadCookies() {
  const [session, cfbm, cfuvid, clearance] = await Promise.all([
    getSetting('ao3SessionCookie'),
    getSetting('ao3CfBm'),
    getSetting('ao3Cfuvid'),
    getSetting('ao3Clearance'),
  ]);
  return {
    _otwarchive_session: session  || '',
    __cf_bm:             cfbm     || '',
    _cfuvid:             cfuvid   || '',
    cf_clearance:        clearance || '',
  };
}

// ---------------------------------------------------------------------------
// Compute wrapped data
// ---------------------------------------------------------------------------
function computeWrapped(history, bookmarks, year, username) {
  const totalWorks   = history.length;
  const totalWords   = history.reduce((s, w) => s + (w.wordCount || 0), 0);
  const topFandom    = topItem(history.flatMap((w) => w.fandoms || []));
  const topShip      = topItem(history.flatMap((w) => w.relationships || []));
  const topAuthor    = topItem(history.flatMap((w) => w.authors || []));
  const topCharacter = topItem(history.flatMap((w) => w.characters || []));
  const topTag       = topItem(history.flatMap((w) => w.additionalTags || []));

  // Longest fic
  const longest = history.reduce((best, w) =>
    (w.wordCount || 0) > (best?.wordCount || 0) ? w : best, null);

  // Most active month
  const monthlyCounts = {};
  history.forEach((w) => {
    if (!w.visitDate) return;
    const m = new Date(w.visitDate).toLocaleString('default', { month: 'long' });
    monthlyCounts[m] = (monthlyCounts[m] || 0) + 1;
  });
  const topMonth = Object.entries(monthlyCounts).sort((a, b) => b[1] - a[1])[0];

  // Rating breakdown
  const ratings = { G: 0, T: 0, M: 0, E: 0, NR: 0 };
  history.forEach((w) => {
    const r = w.rating || '';
    if (r.includes('General'))  ratings.G++;
    else if (r.includes('Teen')) ratings.T++;
    else if (r.includes('Mature')) ratings.M++;
    else if (r.includes('Explicit')) ratings.E++;
    else ratings.NR++;
  });
  const topRating = Object.entries(ratings).sort((a, b) => b[1] - a[1])[0];

  // Reading streak (consecutive days)
  const days = [...new Set(
    history
      .filter((w) => w.visitDate)
      .map((w) => new Date(w.visitDate).toDateString())
  )].sort();
  let maxStreak = 0, streak = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
    streak = diff === 1 ? streak + 1 : 1;
    if (streak > maxStreak) maxStreak = streak;
  }

  // Unique fandoms
  const uniqueFandoms = new Set(history.flatMap((w) => w.fandoms || [])).size;

  // Hours estimate (250 words per minute reading speed)
  const hoursReading = Math.round(totalWords / (250 * 60));

  // Bookmarks this year
  const yearBookmarks = bookmarks.filter((b) => {
    const d = b.dateBookmarked ? new Date(b.dateBookmarked).getFullYear() : 0;
    return d === year;
  });

  // Summary sentence
  const summaryParts = [
    `You read ${totalWorks.toLocaleString()} fic${totalWorks !== 1 ? 's' : ''}`,
    totalWords > 0 ? `${formatWords(totalWords)} words` : null,
    uniqueFandoms > 0 ? `across ${uniqueFandoms} fandom${uniqueFandoms !== 1 ? 's' : ''}` : null,
    hoursReading > 0 ? `spending roughly ${hoursReading} hour${hoursReading !== 1 ? 's' : ''} reading` : null,
    topFandom ? `Your heart lives in ${topFandom}` : null,
  ].filter(Boolean);
  const summary = summaryParts.join('. ') + '.';

  return {
    username, year, totalWorks, totalWords, uniqueFandoms, hoursReading,
    topFandom, topShip, topAuthor, topCharacter, topTag,
    longest, topMonth, ratings, topRating,
    maxStreak, summary, yearBookmarks,
  };
}

// ---------------------------------------------------------------------------
// Render cards
// ---------------------------------------------------------------------------
const CARD_DEFS = [
  {
    id: 'card-1',
    title: 'Your Reading Year',
    render: (d) => `
      <div class="wc-eyebrow">${d.year} wrapped</div>
      <div class="wc-big">${d.totalWorks.toLocaleString()}</div>
      <div class="wc-sublabel">fics read</div>
      <div class="wc-row">
        <div class="wc-stat"><span class="wc-stat-val">${formatWords(d.totalWords)}</span><span class="wc-stat-label">words</span></div>
        <div class="wc-stat"><span class="wc-stat-val">${d.uniqueFandoms}</span><span class="wc-stat-label">fandoms</span></div>
        <div class="wc-stat"><span class="wc-stat-val">${d.hoursReading}h</span><span class="wc-stat-label">reading</span></div>
      </div>
    `,
    accent: '#8B3D47',
  },
  {
    id: 'card-2',
    title: 'Your Top Fandom',
    render: (d) => d.topFandom ? `
      <div class="wc-eyebrow">you spent the most time in</div>
      <div class="wc-fandom-name">${d.topFandom}</div>
      <div class="wc-divider"></div>
      <div class="wc-sub">Your home fandom of ${d.year}</div>
    ` : `<div class="wc-sub">Not enough data</div>`,
    accent: '#561F26',
  },
  {
    id: 'card-3',
    title: 'Your Top Ship',
    render: (d) => d.topShip ? `
      <div class="wc-eyebrow">your most-read pairing</div>
      <div class="wc-ship-name">${d.topShip}</div>
      <div class="wc-heart">&#9829;</div>
    ` : `<div class="wc-sub">No relationship tags found</div>`,
    accent: '#722F37',
  },
  {
    id: 'card-4',
    title: 'Your Most Read Author',
    render: (d) => d.topAuthor ? `
      <div class="wc-eyebrow">you kept coming back to</div>
      <div class="wc-author-name">${d.topAuthor}</div>
      <div class="wc-sub">Your favourite author this year</div>
    ` : `<div class="wc-sub">Not enough data</div>`,
    accent: '#3D1219',
  },
  {
    id: 'card-5',
    title: 'Your Reading Streak',
    render: (d) => `
      <div class="wc-eyebrow">longest streak</div>
      <div class="wc-big">${d.maxStreak}</div>
      <div class="wc-sublabel">days in a row</div>
      <div class="wc-sub">You were consistent this year</div>
    `,
    accent: '#8B3D47',
  },
  {
    id: 'card-6',
    title: 'Your Longest Fic',
    render: (d) => d.longest ? `
      <div class="wc-eyebrow">the epic you conquered</div>
      <div class="wc-longest-title">${d.longest.title}</div>
      <div class="wc-divider"></div>
      <div class="wc-stat-row">
        <span class="wc-stat-val">${formatWords(d.longest.wordCount)}</span>
        <span class="wc-stat-label">words</span>
      </div>
    ` : `<div class="wc-sub">Not enough data</div>`,
    accent: '#561F26',
  },
  {
    id: 'card-7',
    title: 'Your Favourite Tags',
    render: (d) => `
      <div class="wc-eyebrow">what you were here for</div>
      <div class="wc-tag-cloud">
        ${d.topTag ? `<span class="wc-tag wc-tag-lg">${d.topTag}</span>` : ''}
        <span class="wc-tag">hurt/comfort</span>
        <span class="wc-tag">slow burn</span>
        <span class="wc-tag">found family</span>
        <span class="wc-tag">angst</span>
      </div>
    `,
    accent: '#722F37',
  },
  {
    id: 'card-8',
    title: 'Your Rating Breakdown',
    render: (d) => `
      <div class="wc-eyebrow">what you were reading</div>
      <div class="wc-rating-bars">
        ${renderRatingBars(d.ratings, d.totalWorks)}
      </div>
    `,
    accent: '#3D1219',
  },
  {
    id: 'card-9',
    title: 'Your Most Active Month',
    render: (d) => d.topMonth ? `
      <div class="wc-eyebrow">your peak reading month</div>
      <div class="wc-big">${d.topMonth[0]}</div>
      <div class="wc-sublabel">${d.topMonth[1]} fics read</div>
    ` : `<div class="wc-sub">Not enough data</div>`,
    accent: '#8B3D47',
  },
  {
    id: 'card-10',
    title: 'Your Year in a Sentence',
    render: (d) => `
      <div class="wc-eyebrow">${d.username} — ${d.year}</div>
      <div class="wc-summary">${d.summary}</div>
      <div class="wc-footer-logo">Archivist</div>
    `,
    accent: '#561F26',
  },
];

function renderCards(container, data, year) {
  const scroll = container.querySelector('#wrapped-cards-scroll');
  scroll.innerHTML = '';

  CARD_DEFS.forEach((def, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'wrapped-card-wrapper';
    wrapper.innerHTML = `
      <div class="wrapped-card" id="${def.id}" style="background: linear-gradient(145deg, ${def.accent}, #1A0A0D)">
        <div class="wc-card-number">${String(i + 1).padStart(2, '0')}</div>
        <div class="wc-card-title">${def.title}</div>
        <div class="wc-card-body">
          ${def.render(data)}
        </div>
        <div class="wc-card-year">${year}</div>
      </div>
      <button class="wrapped-dl-btn" data-card="${def.id}" title="Download card">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </button>
    `;

    wrapper.querySelector('.wrapped-dl-btn').addEventListener('click', () => {
      downloadCard(def.id, `archivist-wrapped-${year}-${i + 1}`);
    });

    scroll.appendChild(wrapper);
  });
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
async function downloadCard(cardId, filename) {
  const card = document.getElementById(cardId);
  if (!card) return;

  if (!window.html2canvas) {
    alert('html2canvas not loaded. Make sure you are connected to the internet.');
    return;
  }

  try {
    const canvas = await window.html2canvas(card, {
      scale:           2,
      backgroundColor: null,
      useCORS:         true,
      logging:         false,
    });
    const link    = document.createElement('a');
    link.download = `${filename}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('[Archivist] Card download error:', err);
    alert('Could not export card. Try again.');
  }
}

async function downloadAllCards(container) {
  for (let i = 0; i < CARD_DEFS.length; i++) {
    const def  = CARD_DEFS[i];
    const year = wrappedData?.year || new Date().getFullYear();
    await downloadCard(def.id, `archivist-wrapped-${year}-${i + 1}-${def.title.toLowerCase().replace(/\s+/g, '-')}`);
    await new Promise((r) => setTimeout(r, 400)); // small gap between downloads
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function topItem(arr) {
  const counts = {};
  arr.forEach((v) => { if (v) counts[v] = (counts[v] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}

function formatWords(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return n.toLocaleString();
}

function renderRatingBars(ratings, total) {
  if (!total) return '';
  const labels = { G: 'General', T: 'Teen+', M: 'Mature', E: 'Explicit', NR: 'Not Rated' };
  const colors = { G: '#4A7C59', T: '#4A6FA5', M: '#B8860B', E: '#8B1A1A', NR: '#6B6B6B' };
  return Object.entries(ratings).map(([key, val]) => {
    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
    return `
      <div class="wc-rating-row">
        <span class="wc-rating-label">${labels[key]}</span>
        <div class="wc-rating-track">
          <div class="wc-rating-fill" style="width:${pct}%;background:${colors[key]}"></div>
        </div>
        <span class="wc-rating-pct">${pct}%</span>
      </div>
    `;
  }).join('');
}
