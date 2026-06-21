// src/dashboard/stats.js — Archivist Stats Dashboard v2
// Caches AO3 history in IndexedDB. Redesigned charts.

import { getAllBookmarks, getSetting, getCachedHistory, setCachedHistory, listHistoryCacheKeys, getCachedHistoryForRange } from '../db/database.js';
import { scrapeReadingHistory } from './ao3-scraper.js';

let bookmarkCache = [];
let isScraping    = false;

// ---------------------------------------------------------------------------
// Chart.js global defaults — applied once
// ---------------------------------------------------------------------------
function applyChartDefaults() {
  const Chart = window.Chart;
  if (!Chart) return;
  Chart.defaults.font.family   = "'Inter', system-ui, sans-serif";
  Chart.defaults.font.size     = 11;
  Chart.defaults.color         = '#5C3D42';
  Chart.defaults.plugins.legend.labels.boxWidth  = 12;
  Chart.defaults.plugins.legend.labels.padding   = 14;
  Chart.defaults.plugins.tooltip.padding         = 10;
  Chart.defaults.plugins.tooltip.cornerRadius    = 6;
  Chart.defaults.plugins.tooltip.backgroundColor = '#1A0A0D';
  Chart.defaults.plugins.tooltip.titleColor      = '#FAF7F2';
  Chart.defaults.plugins.tooltip.bodyColor       = '#EACDD0';
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
export async function initStats(container) {
  applyChartDefaults();
  bookmarkCache = await getAllBookmarks();
  container.innerHTML = await buildStatsShell();
  bindStatsEvents(container);
  renderBookmarkOnlyStats(container);
}

// ---------------------------------------------------------------------------
// Shell HTML
// ---------------------------------------------------------------------------
async function buildStatsShell() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 2007 }, (_, i) => currentYear - i);

  // Check for existing caches
  const cacheList  = await listHistoryCacheKeys();
  const cacheItems = cacheList.map((c) =>
    `<button class="cache-chip" data-from="${c.yearFrom}" data-to="${c.yearTo}">
      ${c.yearFrom === c.yearTo ? c.yearFrom : c.yearFrom + ' to ' + c.yearTo}
      <span class="cache-chip-count">${c.count} works</span>
    </button>`
  ).join('');

  return `
    <div class="stats-root">

      <div class="stats-bar">
        <div class="stats-bar-left">
          <select id="stats-year-from" class="stats-select">
            ${years.map((y) => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('')}
          </select>
          <span class="stats-bar-label">to</span>
          <select id="stats-year-to" class="stats-select">
            ${years.map((y) => `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" id="stats-fetch-btn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
            Load from AO3
          </button>
        </div>
        <div class="stats-bar-right">
          <span class="stats-source-tag" id="stats-source-tag">Bookmarks only</span>
        </div>
      </div>

      ${cacheItems ? `
      <div class="cache-bar">
        <span class="cache-bar-label">Cached:</span>
        ${cacheItems}
        <button class="cache-clear-btn" id="cache-clear-btn" title="Clear all cached history">Clear cache</button>
      </div>` : ''}

      <div class="stats-progress hidden" id="stats-progress">
        <div class="stats-progress-bar-track">
          <div class="stats-progress-bar" id="stats-progress-bar" style="width:0%"></div>
        </div>
        <p class="stats-progress-text" id="stats-progress-text">Connecting to AO3...</p>
        <p class="stats-pause-text hidden" id="stats-pause-text"></p>
      </div>

      <div class="stats-error hidden" id="stats-error"></div>

      <div class="stats-body" id="stats-body">

        <div class="stats-kpi-row" id="stats-kpi-row">
          <div class="kpi-card">
            <span class="kpi-value" id="kpi-works">0</span>
            <span class="kpi-label">Works read</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-value" id="kpi-words">0</span>
            <span class="kpi-label">Total words</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-value" id="kpi-fandoms">0</span>
            <span class="kpi-label">Fandoms</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-value" id="kpi-hours">0</span>
            <span class="kpi-label">Hours reading</span>
          </div>
          <div class="kpi-card">
            <span class="kpi-value" id="kpi-bookmarked">0</span>
            <span class="kpi-label">Bookmarked</span>
          </div>
        </div>

        <div class="stats-charts-grid">

          <div class="chart-card chart-wide">
            <p class="chart-title">Works read per month</p>
            <div class="chart-wrap" style="height:120px"><canvas id="chart-monthly"></canvas></div>
          </div>

          <div class="chart-card">
            <p class="chart-title">Top fandoms</p>
            <div class="chart-wrap" style="height:150px"><canvas id="chart-fandoms"></canvas></div>
          </div>

          <div class="chart-card">
            <p class="chart-title">Rating breakdown</p>
            <div class="chart-wrap" style="height:150px"><canvas id="chart-ratings"></canvas></div>
          </div>

          <div class="chart-card">
            <p class="chart-title">Top ships</p>
            <div class="chart-wrap" style="height:150px"><canvas id="chart-ships"></canvas></div>
          </div>

          <div class="chart-card">
            <p class="chart-title">Complete vs In Progress</p>
            <div class="chart-wrap" style="height:150px"><canvas id="chart-status"></canvas></div>
          </div>

          <div class="chart-card chart-wide">
            <p class="chart-title">Top characters</p>
            <div class="chart-wrap" style="height:120px"><canvas id="chart-characters"></canvas></div>
          </div>

          <div class="chart-card chart-section-header" style="grid-column:span 2">
            <p class="chart-section-title">My Bookmarks</p>
          </div>

          <div class="chart-card">
            <p class="chart-title">Reading status</p>
            <div class="chart-wrap" style="height:150px"><canvas id="chart-bm-status"></canvas></div>
          </div>

          <div class="chart-card">
            <p class="chart-title">Star ratings</p>
            <div class="chart-wrap" style="height:150px"><canvas id="chart-bm-stars"></canvas></div>
          </div>

          <div class="chart-card chart-wide">
            <p class="chart-title">Top personal tags</p>
            <div class="chart-wrap" style="height:120px"><canvas id="chart-bm-tags"></canvas></div>
          </div>

        </div>
      </div>

    </div>
  `;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bindStatsEvents(container) {
  container.querySelector('#stats-fetch-btn').addEventListener('click', async () => {
    if (isScraping) return;
    const from = parseInt(container.querySelector('#stats-year-from').value, 10);
    const to   = parseInt(container.querySelector('#stats-year-to').value,   10);
    if (from > to) { showStatsError(container, 'Year From cannot be greater than Year To.'); return; }
    await runScrape(container, from, to);
  });

  // Load from cache chips
  container.addEventListener('click', async (e) => {
    const chip = e.target.closest('.cache-chip');
    if (!chip) return;
    const from = parseInt(chip.dataset.from, 10);
    const to   = parseInt(chip.dataset.to,   10);
    const [username] = await Promise.all([getSetting('ao3Username')]);
    const cached = await getCachedHistory(username, from, to);
    if (cached) {
      container.querySelector('#stats-source-tag').textContent =
        `AO3 history + bookmarks (${from === to ? from : from + ' to ' + to}) — cached`;
      renderAllStats(container, cached, bookmarkCache, from, to);
    }
  });

  // Clear cache
  const clearBtn = container.querySelector('#cache-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      const { clearHistoryCache } = await import('../db/database.js');
      await clearHistoryCache();
      // Rebuild the shell to remove cache chips
      bookmarkCache = await getAllBookmarks();
      container.innerHTML = await buildStatsShell();
      bindStatsEvents(container);
      renderBookmarkOnlyStats(container);
    });
  }
}

// ---------------------------------------------------------------------------
// Scrape
// ---------------------------------------------------------------------------
async function runScrape(container, yearFrom, yearTo) {
  isScraping = true;
  const fetchBtn    = container.querySelector('#stats-fetch-btn');
  const progressEl  = container.querySelector('#stats-progress');
  const progressBar = container.querySelector('#stats-progress-bar');
  const progressTxt = container.querySelector('#stats-progress-text');
  const pauseTxt    = container.querySelector('#stats-pause-text');
  const errorEl     = container.querySelector('#stats-error');

  fetchBtn.disabled = true;
  errorEl.classList.add('hidden');
  progressEl.classList.remove('hidden');

  try {
    const [username, cookies] = await Promise.all([
      getSetting('ao3Username'),
      loadCookies(),
    ]);

    if (!username || !cookies._otwarchive_session) {
      throw new Error('No AO3 connection found. Open Settings and save your AO3 cookies first.');
    }

    // Smart cache check — exact match OR wider range that contains the requested range
    let cachedResult = await getCachedHistory(username, yearFrom, yearTo);
    let cacheLabel   = '';

    if (!cachedResult) {
      const rangeHit = await getCachedHistoryForRange(username, yearFrom, yearTo);
      if (rangeHit) { cachedResult = rangeHit.works; cacheLabel = ` (from ${rangeHit.sourceRange} cache)`; }
    } else {
      cacheLabel = ' (cached)';
    }

    if (cachedResult) {
      progressEl.classList.add('hidden');
      container.querySelector('#stats-source-tag').textContent =
        `AO3 history + bookmarks (${yearFrom === yearTo ? yearFrom : yearFrom + '-' + yearTo})${cacheLabel}`;
      renderAllStats(container, cachedResult, bookmarkCache, yearFrom, yearTo);
      return;
    }

    // No cache — show time estimate before starting
    progressTxt.textContent = 'Estimating scrape time...';
    const estimated = await estimateStatsTime(username, cookies, yearFrom, yearTo);
    progressTxt.textContent = `Estimated time: ${estimated}. Starting scrape...`;
    await new Promise((r) => setTimeout(r, 1800));

    // Scrape fresh
    const history = await scrapeReadingHistory({
      username, cookies, yearFrom, yearTo,
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

    // Save to cache
    await setCachedHistory(username, yearFrom, yearTo, history);

    progressEl.classList.add('hidden');
    container.querySelector('#stats-source-tag').textContent =
      `AO3 history + bookmarks (${yearFrom === yearTo ? yearFrom : yearFrom + '-' + yearTo})`;
    renderAllStats(container, history, bookmarkCache, yearFrom, yearTo);

  } catch (err) {
    progressEl.classList.add('hidden');
    showStatsError(container, err.message);
  } finally {
    isScraping        = false;
    fetchBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Estimate scrape time
// ---------------------------------------------------------------------------
async function estimateStatsTime(username, cookies, yearFrom, yearTo) {
  try {
    await setStatsCookies(cookies);
    const url  = `https://archiveofourown.org/users/${encodeURIComponent(username)}/readings?page=1`;
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) return 'unknown';
    const html   = await resp.text();
    const parser = new DOMParser();
    const doc    = parser.parseFromString(html, 'text/html');
    let totalPages = 1;
    doc.querySelectorAll('ol.pagination li').forEach((li) => {
      const n = parseInt(li.textContent.trim(), 10);
      if (!isNaN(n) && n > totalPages) totalPages = n;
    });
    // ~5s per page + 5 min pause every 10 pages
    const secs = totalPages * 5 + Math.floor(totalPages / 10) * 300;
    return fmtDuration(secs);
  } catch { return 'unknown'; }
}

async function setStatsCookies(cookies) {
  const url = 'https://archiveofourown.org/', domain = '.archiveofourown.org';
  const map = { '_otwarchive_session':cookies._otwarchive_session, '__cf_bm':cookies.__cf_bm, '_cfuvid':cookies._cfuvid, 'cf_clearance':cookies.cf_clearance };
  await Promise.all(Object.entries(map).filter(([,v])=>v?.trim()).map(([n,v])=>new Promise((r)=>chrome.cookies.set({url,name:n,value:v,domain,path:'/'},r))));
}

function fmtDuration(secs) {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `~${Math.round(secs/60)} min`;
  const h=Math.floor(secs/3600), m=Math.round((secs%3600)/60);
  return m>0 ? `~${h}h ${m}m` : `~${h}h`;
}

async function loadCookies() {
  const [session, cfbm, cfuvid, clearance] = await Promise.all([
    getSetting('ao3SessionCookie'), getSetting('ao3CfBm'),
    getSetting('ao3Cfuvid'),        getSetting('ao3Clearance'),
  ]);
  return { _otwarchive_session: session||'', __cf_bm: cfbm||'', _cfuvid: cfuvid||'', cf_clearance: clearance||'' };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
function renderBookmarkOnlyStats(container) {
  const bm = bookmarkCache;
  kpi(container, '#kpi-works',      bm.length);
  kpi(container, '#kpi-words',      sumWords(bm));
  kpi(container, '#kpi-fandoms',    new Set(bm.flatMap((b) => b.fandoms||[])).size);
  kpi(container, '#kpi-hours',      Math.round(bm.reduce((s,b)=>s+(b.wordCount||0),0)/15000));
  kpi(container, '#kpi-bookmarked', bm.length);
  renderBookmarkCharts(container, bm);
}

function renderAllStats(container, history, bookmarks, yearFrom, yearTo) {
  const combined = [...history, ...bookmarks];
  kpi(container, '#kpi-works',      history.length);
  kpi(container, '#kpi-words',      sumWords(combined));
  kpi(container, '#kpi-fandoms',    new Set(combined.flatMap((b)=>b.fandoms||[])).size);
  kpi(container, '#kpi-hours',      Math.round(combined.reduce((s,b)=>s+(b.wordCount||0),0)/15000));
  kpi(container, '#kpi-bookmarked', bookmarks.length);

  renderMonthlyChart(container,    history, yearFrom, yearTo);
  renderFandomsChart(container,    combined);
  renderRatingsChart(container,    combined);
  renderShipsChart(container,      combined);
  renderStatusChart(container,     history);
  renderCharactersChart(container, combined);
  renderBookmarkCharts(container,  bookmarks);
}

function kpi(container, sel, val) {
  const el = container.querySelector(sel);
  if (!el) return;
  el.textContent = typeof val === 'number' ? val.toLocaleString() : val;
}

// ---------------------------------------------------------------------------
// Chart renderers
// ---------------------------------------------------------------------------
const WINE    = '#722F37';
const ROSE    = '#C27C88';
const CREAM   = '#FAF7F2';
const BORDER  = '#DDD0D2';

function wineScale(n) {
  return Array.from({length:n}, (_,i) => `hsla(350, 42%, ${28 + (i/(Math.max(n-1,1)))*32}%, 0.85)`);
}

function renderMonthlyChart(container, works, yearFrom, yearTo) {
  const labels=[], data=[];
  for (let y=yearFrom; y<=yearTo; y++) {
    for (let m=1; m<=12; m++) {
      labels.push(`${String(m).padStart(2,'0')}/${String(y).slice(2)}`);
      data.push(works.filter((w)=>{
        const d=w.visitDate?new Date(w.visitDate):null;
        return d&&d.getFullYear()===y&&d.getMonth()+1===m;
      }).length);
    }
  }
  renderChart(container, 'chart-monthly', 'bar', labels, [{
    data, backgroundColor: ROSE+'BB', borderColor: WINE,
    borderWidth:1, borderRadius:3, borderSkipped:false,
  }], {
    plugins:{ legend:{display:false} },
    scales:{
      x:{ grid:{color:BORDER+'55'}, ticks:{maxTicksLimit:24, font:{size:9}} },
      y:{ grid:{color:BORDER+'55'}, ticks:{stepSize:1, font:{size:10}} },
    },
  });
}

function renderFandomsChart(container, works) {
  const counts = topN(works.flatMap((w)=>w.fandoms||[]), 10);
  if (!counts.length) return;
  renderChart(container, 'chart-fandoms', 'bar',
    counts.map((c)=>truncate(c.label,28)),
    [{ data:counts.map((c)=>c.count), backgroundColor:wineScale(counts.length),
       borderRadius:4, borderSkipped:false }],
    { indexAxis:'y', plugins:{legend:{display:false}},
      scales:{
        x:{ grid:{color:BORDER+'55'}, ticks:{font:{size:10}} },
        y:{ grid:{display:false}, ticks:{font:{size:10}} },
      }
    }
  );
}

function renderRatingsChart(container, works) {
  const labels=['General','Teen+','Mature','Explicit','Not Rated'];
  const colors=['#4A7C59','#4A6FA5','#B8860B','#8B1A1A','#888'];
  const keys  =['General','Teen','Mature','Explicit',''];
  const data  = keys.map((k,i) =>
    works.filter((w)=> k ? (w.rating||'').includes(k) : !['General','Teen','Mature','Explicit'].some((r)=>(w.rating||'').includes(r))).length
  );
  renderChart(container,'chart-ratings','doughnut',labels,[{
    data, backgroundColor:colors, borderWidth:3, borderColor:CREAM, hoverOffset:6,
  }],{ cutout:'62%', plugins:{legend:{position:'bottom'}} });
}

function renderShipsChart(container, works) {
  const counts = topN(works.flatMap((w)=>w.relationships||[]), 8);
  if (!counts.length) return;
  renderChart(container,'chart-ships','bar',
    counts.map((c)=>truncate(c.label,28)),
    [{ data:counts.map((c)=>c.count), backgroundColor:WINE+'CC',
       borderRadius:4, borderSkipped:false }],
    { indexAxis:'y', plugins:{legend:{display:false}},
      scales:{
        x:{grid:{color:BORDER+'55'}, ticks:{font:{size:10}}},
        y:{grid:{display:false}, ticks:{font:{size:10}}},
      }
    }
  );
}

function renderStatusChart(container, works) {
  const complete   = works.filter((w)=>w.ao3Status==='Complete').length;
  const inProgress = works.filter((w)=>w.ao3Status!=='Complete').length;
  renderChart(container,'chart-status','doughnut',
    ['Complete','In Progress'],
    [{ data:[complete,inProgress], backgroundColor:['#4A7C59', ROSE],
       borderWidth:3, borderColor:CREAM, hoverOffset:6 }],
    { cutout:'62%', plugins:{legend:{position:'bottom'}} }
  );
}

function renderCharactersChart(container, works) {
  const counts = topN(works.flatMap((w)=>w.characters||[]), 12);
  if (!counts.length) return;
  renderChart(container,'chart-characters','bar',
    counts.map((c)=>truncate(c.label,20)),
    [{ data:counts.map((c)=>c.count), backgroundColor:wineScale(counts.length),
       borderRadius:4, borderSkipped:false }],
    { plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false}, ticks:{font:{size:10}}},
        y:{grid:{color:BORDER+'55'}, ticks:{font:{size:10}}},
      }
    }
  );
}

function renderBookmarkCharts(container, bookmarks) {
  const statuses=['Reading','Completed','On Hold','Dropped','Plan to Read'];
  const statusColors=['#4A6FA5','#4A7C59','#B8860B','#8B1A1A','#888'];
  renderChart(container,'chart-bm-status','doughnut',statuses,[{
    data:statuses.map((s)=>bookmarks.filter((b)=>b.status===s).length),
    backgroundColor:statusColors, borderWidth:3, borderColor:CREAM, hoverOffset:6,
  }],{ cutout:'62%', plugins:{legend:{position:'bottom'}} });

  const starData=[1,2,3,4,5].map((n)=>bookmarks.filter((b)=>b.starRating===n).length);
  renderChart(container,'chart-bm-stars','bar',
    ['1 star','2 stars','3 stars','4 stars','5 stars'],
    [{ data:starData, backgroundColor:['#8B3D47','#A05060','#B8860B','#9A7C20','#C4900A'],
       borderRadius:4, borderSkipped:false }],
    { plugins:{legend:{display:false}},
      scales:{
        x:{grid:{display:false}},
        y:{grid:{color:BORDER+'55'}, ticks:{stepSize:1, font:{size:10}}},
      }
    }
  );

  const tagCounts = topN(bookmarks.flatMap((b)=>b.personalTags||[]), 10);
  if (tagCounts.length) {
    renderChart(container,'chart-bm-tags','bar',
      tagCounts.map((c)=>c.label),
      [{ data:tagCounts.map((c)=>c.count), backgroundColor:ROSE+'BB',
         borderColor:WINE, borderWidth:1, borderRadius:4, borderSkipped:false }],
      { plugins:{legend:{display:false}},
        scales:{
          x:{grid:{display:false}, ticks:{font:{size:10}}},
          y:{grid:{color:BORDER+'55'}, ticks:{stepSize:1, font:{size:10}}},
        }
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Chart.js wrapper
// ---------------------------------------------------------------------------
const chartInstances = {};

function renderChart(container, id, type, labels, datasets, extra={}) {
  const canvas = container.querySelector(`#${id}`);
  if (!canvas || !window.Chart) return;
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
  // Explicitly set canvas dimensions so Chart.js doesn't expand the container
  const wrapHeight = canvas.parentElement?.style?.height || '120px';
  const h = parseInt(wrapHeight, 10) || 120;
  canvas.style.height = h + 'px';
  canvas.style.width  = '100%';

  const baseScaleStyle = {
    grid:  { color: BORDER+'55' },
    ticks: { color: '#5C3D42', font:{ family:"'Inter', sans-serif", size:11 } },
    border:{ color: 'transparent' },
  };

  const defaults = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500, easing:'easeOutQuart' },
    plugins: {
      legend: {
        labels: { color:'#5C3D42', font:{ family:"'Inter', sans-serif", size:11 },
                  usePointStyle:true, pointStyleWidth:10 },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.label || ctx.dataset.label}: ${ctx.parsed.y ?? ctx.parsed}`,
        },
      },
    },
    scales: type==='bar' ? { x:{...baseScaleStyle}, y:{...baseScaleStyle} } : {},
  };

  chartInstances[id] = new window.Chart(canvas.getContext('2d'), {
    type, data:{labels, datasets}, options: deepMerge(defaults, extra),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function topN(arr, n) {
  const counts={};
  arr.forEach((v)=>{ if(v) counts[v]=(counts[v]||0)+1; });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,n)
    .map(([label,count])=>({label,count}));
}

function sumWords(works) {
  const t = works.reduce((s,w)=>s+(w.wordCount||0),0);
  if (t>=1_000_000) return (t/1_000_000).toFixed(1)+'M';
  if (t>=1_000)     return Math.round(t/1_000)+'K';
  return t.toLocaleString();
}

function truncate(str, max) {
  return str.length>max ? str.slice(0,max)+'...' : str;
}

function showStatsError(container, msg) {
  const el = container.querySelector('#stats-error');
  if (el) { el.textContent=msg; el.classList.remove('hidden'); }
}

function deepMerge(a, b) {
  const out={...a};
  for (const k of Object.keys(b)) {
    if (b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k]))
      out[k]=deepMerge(a[k]||{}, b[k]);
    else out[k]=b[k];
  }
  return out;
}
