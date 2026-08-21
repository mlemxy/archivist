const AO3         = 'https://archiveofourown.org'
const PAGE_DELAY  = 4000
const JITTER      = 2000
const PAUSE_EVERY = 10
const PAUSE_MS    = 300000
const BACKOFF_MS  = 120000
const sleep       = (ms) => new Promise((r) => setTimeout(r, ms))
const texts       = (el, sel) => [...el.querySelectorAll(sel)].map((a) => a.textContent.trim())

export async function scrapeReadingHistory({ username, cookies, yearFrom, yearTo, onProgress=()=>{}, onPause=()=>{}, onStatus=()=>{} }) {
  if (!username)                     throw new Error('AO3 username is required.')
  if (!cookies?._otwarchive_session) throw new Error('Session cookie is required. Add it in Settings.')
  onStatus('Setting up...')
  await setCookies(cookies)
  const works = []; let page = 1, totalPages = null

  while (true) {
    onStatus(`Fetching page ${page}${totalPages ? ' of ' + totalPages : ''}...`)
    const html = await fetchWithBackoff(`${AO3}/users/${encodeURIComponent(username)}/readings?page=${page}`, onStatus, onPause)
    if (!html) throw new Error(`Could not fetch page ${page}. Your cookies may have expired.`)
    totalPages ??= parseTotalPages(html) || 1
    const { works: w, stop } = parseWorks(html, yearFrom, yearTo)
    works.push(...w)
    onProgress(page, totalPages, works.length)
    if (stop || page >= totalPages) break
    page++
    if ((page - 1) % PAUSE_EVERY === 0) {
      onStatus('Pausing to avoid rate limits...')
      await countdown(PAUSE_MS, onPause)
    } else {
      await sleep(PAGE_DELAY + Math.floor(Math.random() * JITTER))
    }
  }
  return works
}

async function fetchWithBackoff(url, onStatus, onPause) {
  let wait = BACKOFF_MS
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { credentials:'include', headers:{ Accept:'text/html,application/xhtml+xml' } })
      if (r.status === 429 || r.status === 503) {
        if (i < 4) { onStatus(`Rate limited. Waiting ${wait/60000} min...`); await countdown(wait, onPause); wait = Math.min(wait*2, 600000); continue }
        return null
      }
      if (r.status === 401 || r.status === 403) throw new Error('Your cookies have expired. Update them in Settings.')
      if (!r.ok) { if (i < 4) { await sleep(5000); continue } return null }
      const text = await r.text()
      if (text.includes('Retry later')) { if (i < 4) { await countdown(wait, onPause); wait = Math.min(wait*2,600000); continue } return null }
      return text
    } catch(e) { if (e.message.includes('expired')) throw e; if (i < 4) { await sleep(5000); continue } return null }
  }
  return null
}

async function setCookies(cookies) {
  const url = 'https://archiveofourown.org/', domain = '.archiveofourown.org'
  await Promise.all(
    Object.entries({ '_otwarchive_session':cookies._otwarchive_session, '__cf_bm':cookies.__cf_bm, '_cfuvid':cookies._cfuvid, 'cf_clearance':cookies.cf_clearance })
      .filter(([,v]) => v?.trim())
      .map(([name,value]) => new Promise((r) => chrome.cookies.set({url,name,value,domain,path:'/'},r)))
  )
}

function parseTotalPages(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Math.max(1, ...[...doc.querySelectorAll('ol.pagination li')].map((li) => parseInt(li.textContent.trim(),10)||0))
}

function parseWorks(html, yearFrom, yearTo) {
  const doc   = new DOMParser().parseFromString(html, 'text/html')
  const works = []; let stop = false

  for (const item of doc.querySelectorAll('li.reading.work')) {
    const visitDate = parseAO3Date(item.querySelector('h4.viewed')?.textContent || '')
    const visitYear = visitDate?.getFullYear() ?? null
    if (visitYear !== null && visitYear < yearFrom) { stop = true; break }
    if (visitYear !== null && (visitYear < yearFrom || visitYear > yearTo)) continue
    const link = item.querySelector('h4.heading a[href*="/works/"]')
    if (!link) continue
    const wm = link.getAttribute('href').match(/\/works\/(\d+)/)
    if (!wm) continue
    const [cur, tot] = (item.querySelector('dd.chapters')?.textContent.trim() || '0/0').split('/')
    const cc = parseInt(cur,10)||0, ct = tot==='?'?null:parseInt(tot,10)||null
    works.push({
      workId: wm[1], title: link.textContent.trim(),
      authors: texts(item,'a[rel="author"]').length ? texts(item,'a[rel="author"]') : ['Anonymous'],
      fandoms: texts(item,'.fandoms a.tag'), rating: item.querySelector('.rating')?.title||'Not Rated',
      relationships: texts(item,'.relationships a.tag'), characters: texts(item,'.characters a.tag'),
      additionalTags: texts(item,'.freeforms a.tag'),
      wordCount: parseInt((item.querySelector('dd.words')?.textContent||'0').replace(/,/g,''),10)||0,
      chaptersCurrent: cc, chaptersTotal: ct,
      ao3Status: ct!==null&&cc===ct ? 'Complete' : 'In Progress',
      visitDate: visitDate?.toISOString()??null, visitYear,
      ao3Url: `${AO3}/works/${wm[1]}`,
    })
  }
  return { works, stop }
}

const parseAO3Date = (text) => { const m=text.match(/(\d{1,2}\s+\w+\s+\d{4})/); try{return m?new Date(m[1]):null}catch{return null} }

async function countdown(ms, onPause) {
  for (let i = Math.ceil(ms/1000); i > 0; i--) { onPause(i); await sleep(1000) }
}
