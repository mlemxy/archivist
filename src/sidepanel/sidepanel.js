import { saveBookmark, getBookmark, deleteBookmark, updateBookmark } from '../db/database.js'
import { syncBookmark, unsyncBookmark, currentUser } from '../dashboard/firebase.js'

const $ = (id) => document.getElementById(id)
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const ratingAbbr = (r='') => r.includes('General')?'G':r.includes('Teen')?'T':r.includes('Mature')?'M':r.includes('Explicit')?'E':'NR'
const fmtNum  = (n) => n?.toLocaleString() || '0'
const fmtChap = (c,t) => t===null?`${c}/?`:`${c}/${t}`
const fmtDate = (s) => { try{return new Date(s).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}catch{return s||''} }
const swatchColor = (id) => { let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))&0xffffffff; return `hsl(${Math.abs(h)%360},40%,32%)` }
const texts = (el, sel) => [...(el?.querySelectorAll(sel)||[])].map((a) => a.textContent.trim())

let currentFic=null, personalTags=[], starRating=0, toastTimer=null

const init = () => {
  loadCurrentFic()
  chrome.tabs.onActivated.addListener(loadCurrentFic)
  chrome.tabs.onUpdated.addListener((_,ci) => { if(ci.status==='complete') loadCurrentFic() })
}

const loadCurrentFic = () =>
  chrome.runtime.sendMessage({type:'GET_CURRENT_FIC'}, async (r) => {
    if(chrome.runtime.lastError||!r?.fic){showState('no-fic');return}
    currentFic=r.fic; await renderFic(r.fic); showState('fic')
  })

async function renderFic(fic) {
  $('fic-swatch').style.background = swatchColor(fic.workId)
  const rs = ratingAbbr(fic.rating)
  $('fic-rating').textContent=rs; $('fic-rating').setAttribute('data-rating',rs); $('fic-rating').title=fic.rating||'Not Rated'
  $('fic-title').textContent    = fic.title||'Untitled'
  $('fic-author').textContent   = (fic.authors||[]).join(', ')||'Anonymous'
  $('fic-words').textContent    = fmtNum(fic.wordCount)
  $('fic-chapters').textContent = fmtChap(fic.chaptersCurrent, fic.chaptersTotal)
  $('fic-ao3-status').textContent  = fic.ao3Status||'In Progress'
  $('fic-language').textContent    = fic.language||'Unknown'
  $('fic-updated').textContent     = fmtDate(fic.dateUpdatedOnAO3)
  $('fic-kudos').textContent       = fmtNum(fic.kudos)
  renderTagGroup($('fic-fandoms'), fic.fandoms, 'fandom')
  renderTagSection($('section-warnings'),     'Warnings',       fic.warnings,      'warning')
  renderTagSection($('section-relationships'),'Relationships',  fic.relationships, 'relationship')
  renderTagSection($('section-characters'),   'Characters',     fic.characters,    'character')
  renderTagSection($('section-additional'),   'Additional Tags',fic.additionalTags,'additional')
  const sum = $('fic-summary')
  if (sum) { const d=document.createElement('div'); d.innerHTML=fic.summary||''; d.querySelectorAll('script,iframe,object,embed').forEach((el)=>el.remove()); sum.innerHTML=d.innerHTML }
  const link = $('ao3-link'); if(link) link.href=fic.ao3Url||`https://archiveofourown.org/works/${fic.workId}`
  const e = await getBookmark(fic.workId)
  if (e) {
    $('already-saved-banner')?.classList.remove('hidden')
    $('status-select').value=$('status-select')?e.status||'Plan to Read':''; $('last-chapter').value=e.lastReadChapter||0
    $('notify-toggle').checked=e.notifyUpdates||false; $('annotation').value=e.annotation||''
    personalTags=[...(e.personalTags||[])]; starRating=e.starRating||0
    $('date-bookmarked').textContent=fmtDate(e.dateBookmarked)
    const badge=$('sp-update-badge'); if(badge) badge.classList.toggle('hidden',!e.hasUpdate)
  } else {
    $('already-saved-banner')?.classList.add('hidden')
    $('status-select').value='Plan to Read'; $('last-chapter').value=0; $('notify-toggle').checked=false
    $('annotation').value=''; personalTags=[]; starRating=0; $('date-bookmarked').textContent='unknown'
    $('sp-update-badge')?.classList.add('hidden')
  }
  renderTagChips(); renderStars()
}

const tagPill = (tag, type) => { const p=document.createElement('span'); p.className=`tag-pill ${type}`; p.textContent=p.title=tag; return p }
const renderTagGroup   = (el, tags, type) => { if(!el) return; el.innerHTML=''; (tags||[]).forEach((t)=>el.appendChild(tagPill(t,type))) }
const renderTagSection = (el, label, tags, type) => {
  if(!el) return; el.innerHTML=''
  if(!(tags||[]).length) return
  const l=document.createElement('p'); l.className='section-label'; l.textContent=label; el.appendChild(l)
  const g=document.createElement('div'); g.className='tag-group'; (tags||[]).forEach((t)=>g.appendChild(tagPill(t,type))); el.appendChild(g)
}

function renderTagChips() {
  const tc=$('tag-chips'); if(!tc) return; tc.innerHTML=''
  personalTags.forEach((tag,i) => {
    const chip=document.createElement('span'); chip.className='tag-chip'
    chip.innerHTML=`${esc(tag)}<button>×</button>`
    chip.querySelector('button').onclick=()=>{ personalTags.splice(i,1); renderTagChips() }
    tc.appendChild(chip)
  })
}

const renderStars = () =>
  document.querySelectorAll('#star-rating .star').forEach((s) => s.classList.toggle('active', parseInt(s.dataset.v,10)<=starRating))

const addTagsFromInput = () => {
  const ti=$('tag-input'); if(!ti) return
  ti.value.trim().split(',').map((t)=>t.trim()).filter(Boolean).forEach((t)=>{ if(!personalTags.includes(t)) personalTags.push(t) })
  ti.value=''; renderTagChips()
}

$('tag-input')?.addEventListener('keydown',(e)=>{ if(e.key==='Enter'||e.key===','){e.preventDefault();addTagsFromInput()} })
$('tag-input')?.addEventListener('blur', addTagsFromInput)

$('star-rating')?.addEventListener('click',(e)=>{ const s=e.target.closest('.star'); if(!s) return; const v=parseInt(s.dataset.v,10); starRating=starRating===v?0:v; renderStars() })
$('star-rating')?.addEventListener('mouseover',(e)=>{ const s=e.target.closest('.star'); if(!s) return; const v=parseInt(s.dataset.v,10); document.querySelectorAll('#star-rating .star').forEach((st)=>st.classList.toggle('active',parseInt(st.dataset.v,10)<=v)) })
$('star-rating')?.addEventListener('mouseleave', renderStars)

$('save-btn')?.addEventListener('click', async () => {
  if(!currentFic) return
  const btn=$('save-btn'); btn.disabled=true; btn.textContent='Saving...'
  try {
    addTagsFromInput()
    const saved = await saveBookmark({ ...currentFic, status:$('status-select').value, lastReadChapter:parseInt($('last-chapter').value,10)||0, notifyUpdates:$('notify-toggle').checked, starRating, annotation:$('annotation').value.trim(), personalTags:[...personalTags] })
    try { const u=currentUser(); if(u) await syncBookmark(u.uid, saved) } catch {}
    $('already-saved-banner')?.classList.remove('hidden'); $('date-bookmarked').textContent=fmtDate(new Date().toISOString())
    showToast('Saved to your library')
  } catch { showToast('Something went wrong. Try again.', true) }
  finally { btn.disabled=false; btn.textContent='Save to Library' }
})

$('copy-link-btn')?.addEventListener('click', () =>
  navigator.clipboard.writeText(currentFic?.ao3Url||`https://archiveofourown.org/works/${currentFic?.workId}`).then(()=>showToast('Link copied'))
)

$('delete-btn')?.addEventListener('click', () => $('confirm-overlay')?.classList.remove('hidden'))
$('confirm-cancel')?.addEventListener('click', () => $('confirm-overlay')?.classList.add('hidden'))
$('confirm-delete')?.addEventListener('click', async () => {
  if(!currentFic) return
  $('confirm-overlay')?.classList.add('hidden')
  try {
    await deleteBookmark(currentFic.workId)
    try { const u=currentUser(); if(u) await unsyncBookmark(u.uid, currentFic.workId) } catch {}
    $('already-saved-banner')?.classList.add('hidden'); $('status-select').value='Plan to Read'
    $('last-chapter').value=0; $('notify-toggle').checked=false; $('annotation').value=''
    personalTags=[]; starRating=0; $('date-bookmarked').textContent='unknown'
    renderTagChips(); renderStars(); showToast('Bookmark deleted')
  } catch { showToast('Could not delete. Try again.', true) }
})

$('open-dashboard-btn')?.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') }))

const showState = (s) => { $('state-no-fic')?.classList.toggle('hidden',s!=='no-fic'); $('state-fic')?.classList.toggle('hidden',s!=='fic') }
const showToast = (msg, isError=false) => {
  const t=$('toast'); if(!t) return; t.textContent=msg; t.classList.toggle('error',isError); t.classList.remove('hidden'); t.classList.add('show')
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.classList.add('hidden'),200) },2200)
}

init()
