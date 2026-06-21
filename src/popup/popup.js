import { saveBookmark, getBookmark } from '../db/database.js'
import { syncBookmark, currentUser } from '../dashboard/firebase.js'

const $ = (id) => document.getElementById(id)
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const ratingAbbr = (r='') => r.includes('General')?'G':r.includes('Teen')?'T':r.includes('Mature')?'M':r.includes('Explicit')?'E':'NR'
const fmtChap = (c,t) => t===null?`${c}/?`:`${c}/${t}`

let currentFic = null, personalTags = [], toastTimer = null

async function init() {
  chrome.runtime.sendMessage({ type:'GET_CURRENT_FIC' }, async (r) => {
    if (chrome.runtime.lastError || !r?.fic) { showState('no-fic'); return }
    currentFic = r.fic; await renderFic(r.fic); showState('fic')
  })
}

async function renderFic(fic) {
  $('fic-title').textContent = fic.title || 'Untitled'; $('fic-title').title = fic.title || ''
  $('fic-author').textContent = fic.authors?.join(', ') || 'Anonymous'
  const rs = ratingAbbr(fic.rating)
  $('fic-rating').textContent = rs; $('fic-rating').setAttribute('data-rating', rs); $('fic-rating').title = fic.rating || 'Not Rated'
  $('fic-fandoms').innerHTML = ''
  ;[...(fic.fandoms||[]).slice(0,3), ...(fic.fandoms?.length > 3 ? [`+${fic.fandoms.length-3} more`] : [])].forEach((f) => {
    const p = document.createElement('span'); p.className='fandom-pill'; p.textContent=f; p.title=f; $('fic-fandoms').appendChild(p)
  })
  $('fic-words').textContent     = (fic.wordCount||0).toLocaleString() + ' words'
  $('fic-chapters').textContent  = fmtChap(fic.chaptersCurrent, fic.chaptersTotal)
  $('fic-ao3-status').textContent= fic.ao3Status || 'In Progress'
  const existing = await getBookmark(fic.workId)
  if (existing) {
    $('already-saved-banner').classList.remove('hidden')
    $('status-select').value = existing.status || 'Plan to Read'
    $('quick-note').value    = existing.annotation?.slice(0,140) || ''
    personalTags = [...(existing.personalTags||[])]
    renderTagChips(); updateCharCount()
  }
}

const showState = (s) => { $('state-no-fic').classList.toggle('hidden', s!=='no-fic'); $('state-fic').classList.toggle('hidden', s!=='fic') }

function renderTagChips() {
  $('tag-chips').innerHTML = ''
  personalTags.forEach((tag,i) => {
    const chip = document.createElement('span'); chip.className='tag-chip'
    chip.innerHTML = `${esc(tag)}<button data-i="${i}">×</button>`
    chip.querySelector('button').onclick = () => { personalTags.splice(i,1); renderTagChips() }
    $('tag-chips').appendChild(chip)
  })
}

const addTagsFromInput = () => {
  const raw = $('tag-input').value.trim(); if (!raw) return
  raw.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => { if (!personalTags.includes(t)) personalTags.push(t) })
  $('tag-input').value = ''; renderTagChips()
}

$('tag-input').addEventListener('keydown', (e) => { if (e.key==='Enter'||e.key===',') { e.preventDefault(); addTagsFromInput() } })
$('tag-input').addEventListener('blur', addTagsFromInput)

const updateCharCount = () => {
  const len = $('quick-note').value.length
  $('char-count').textContent = `${len} / 140`; $('char-count').classList.toggle('warn', len>=120)
}
$('quick-note').addEventListener('input', updateCharCount)

$('save-btn').addEventListener('click', async () => {
  if (!currentFic) return
  $('save-btn').disabled = true; $('save-btn').textContent = 'Saving...'
  try {
    addTagsFromInput()
    const saved = await saveBookmark({ ...currentFic, status:$('status-select').value, annotation:$('quick-note').value.trim(), personalTags:[...personalTags] })
    try { const u=currentUser(); if(u) await syncBookmark(u.uid, saved) } catch {}
    showToast('Saved to your library'); $('already-saved-banner').classList.remove('hidden')
  } catch { showToast('Something went wrong. Try again.', true) }
  finally { $('save-btn').disabled=false; $('save-btn').textContent='Save' }
})

$('open-panel-btn').addEventListener('click', () => {
  chrome.tabs.query({active:true,currentWindow:true}, ([tab]) => { if(tab) chrome.sidePanel.open({tabId:tab.id}) })
  window.close()
})
$('open-dashboard-btn').addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') }); window.close() })

const showToast = (msg, isError=false) => {
  const t = $('toast'); t.textContent=msg; t.classList.toggle('error',isError); t.classList.remove('hidden'); t.classList.add('show')
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.classList.add('hidden'),200) },2200)
}

init()
