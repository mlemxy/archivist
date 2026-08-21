import { getAllBookmarks, updateBookmark } from '../db/database.js'

const AO3   = 'https://archiveofourown.org'
const DELAY = 3000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runUpdateCheck() {
  const toCheck = (await getAllBookmarks()).filter((bm) =>
    bm.notifyUpdates &&
    !['Dropped','Completed'].includes(bm.status) &&
    bm.workId &&
    (bm.chaptersTotal === null || (bm.chaptersCurrent ?? 0) < (bm.chaptersTotal ?? Infinity))
  )

  const updatedFics = []

  for (const bm of toCheck) {
    try {
      const meta = await fetchFicMeta(bm.workId)
      if (meta && meta.chaptersCurrent > (bm.chaptersCurrent ?? 0)) {
        await updateBookmark(bm.workId, { ...meta, dateUpdatedOnAO3: new Date().toISOString(), hasUpdate: true })
        updatedFics.push({ workId: bm.workId, title: bm.title, newChapters: meta.chaptersCurrent, isComplete: meta.ao3Status === 'Complete' })
      }
    } catch {}
    await sleep(DELAY)
  }

  chrome.runtime.sendMessage({ type: 'UPDATE_CHECK_RESULTS', payload: { updatedFics } })
}

async function fetchFicMeta(workId) {
  const r = await fetch(`${AO3}/works/${workId}`, { credentials: 'include' })
  if (!r.ok) return null
  const chapEl = new DOMParser()
    .parseFromString(await r.text(), 'text/html')
    .querySelector('dl.stats dd.chapters')
  if (!chapEl) return null
  const [cur, tot]  = chapEl.textContent.trim().split('/')
  const chaptersCurrent = parseInt(cur, 10) || 0
  const chaptersTotal   = tot === '?' ? null : parseInt(tot, 10) || null
  return { chaptersCurrent, chaptersTotal, ao3Status: chaptersTotal !== null && chaptersCurrent === chaptersTotal ? 'Complete' : 'In Progress' }
}
