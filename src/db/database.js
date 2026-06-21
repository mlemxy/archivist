import { openDB } from '../../node_modules/idb/build/index.js'

let _db
const DB = 'archivist-db', V = 2
const getDB = async () => _db ??= await openDB(DB, V, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('bookmarks')) {
      const s = db.createObjectStore('bookmarks', { keyPath: 'workId' })
      ;['status','dateBookmarked','dateUpdatedOnAO3'].forEach((k) =>
        s.createIndex(k, k, { unique: false })
      )
      s.createIndex('fandom',      'fandoms',      { unique: false, multiEntry: true })
      s.createIndex('personalTags','personalTags', { unique: false, multiEntry: true })
    }
    if (!db.objectStoreNames.contains('tags'))
      db.createObjectStore('tags', { keyPath: 'name' })
    if (!db.objectStoreNames.contains('notes'))
      db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true })
        .createIndex('dateCreated', 'dateCreated', { unique: false })
    if (!db.objectStoreNames.contains('settings'))
      db.createObjectStore('settings', { keyPath: 'key' })
    if (!db.objectStoreNames.contains('historyCache'))
      db.createObjectStore('historyCache', { keyPath: 'cacheKey' })
  },
})

const now = () => new Date().toISOString()

export async function saveBookmark(bm) {
  const db = await getDB()
  const existing = await db.get('bookmarks', bm.workId)
  const record = {
    status: 'Plan to Read', lastReadChapter: 0, starRating: 0,
    annotation: '', personalTags: [], notifyUpdates: false,
    dateBookmarked: now(), ...existing, ...bm, dateModified: now(),
  }
  await db.put('bookmarks', record)
  return record
}

export const getBookmark    = async (id) => (await getDB()).get('bookmarks', id)
export const getAllBookmarks = async ()   => (await getDB()).getAll('bookmarks')
export const deleteBookmark = async (id) => (await getDB()).delete('bookmarks', id)

export async function updateBookmark(workId, updates) {
  const db = await getDB()
  const e  = await db.get('bookmarks', workId)
  if (!e) throw new Error(`Bookmark ${workId} not found`)
  const updated = { ...e, ...updates, workId, dateModified: now() }
  await db.put('bookmarks', updated)
  return updated
}

export const getSetting    = async (k)    => (await (await getDB()).get('settings', k))?.value ?? null
export const setSetting    = async (k, v) => (await getDB()).put('settings', { key: k, value: v })
export const getAllSettings = async ()    =>
  Object.fromEntries((await (await getDB()).getAll('settings')).map((r) => [r.key, r.value]))

export async function exportAllData() {
  const db = await getDB()
  const [bookmarks, tags, notes, settings] = await Promise.all([
    db.getAll('bookmarks'), db.getAll('tags'),
    db.getAll('notes'),     db.getAll('settings'),
  ])
  return {
    version: V, exportedAt: now(), bookmarks, tags, notes,
    settings: Object.fromEntries(settings.map((r) => [r.key, r.value])),
  }
}

export async function importAllData(data) {
  const db = await getDB()
  const tx = db.transaction(['bookmarks','tags','notes','settings'], 'readwrite')
  await Promise.all(['bookmarks','tags','notes','settings'].map((s) => tx.objectStore(s).clear()))
  await Promise.all([
    ...(data.bookmarks||[]).map((b) => tx.objectStore('bookmarks').put(b)),
    ...(data.tags||[]).map((t)      => tx.objectStore('tags').put(t)),
    ...(data.notes||[]).map((n)     => tx.objectStore('notes').put(n)),
    ...Object.entries(data.settings||{}).map(([k,v]) => tx.objectStore('settings').put({key:k,value:v})),
  ])
  await tx.done
}

export const getCachedHistory = async (u, f, t) =>
  (await (await getDB()).get('historyCache', `${u}:${f}:${t}`))?.works ?? null

export const setCachedHistory = async (u, f, t, works) =>
  (await getDB()).put('historyCache', { cacheKey:`${u}:${f}:${t}`, username:u, yearFrom:f, yearTo:t, works, cachedAt:now() })

export const clearHistoryCache    = async () => (await getDB()).clear('historyCache')
export const listHistoryCacheKeys = async () =>
  (await (await getDB()).getAll('historyCache')).map(({ cacheKey, yearFrom, yearTo, works, cachedAt }) =>
    ({ key: cacheKey, yearFrom, yearTo, count: works.length, cachedAt })
  )

export async function getCachedHistoryForRange(username, yearFrom, yearTo) {
  const all = await (await getDB()).getAll('historyCache')
  const e   = all.find((r) => r.username === username && r.yearFrom <= yearFrom && r.yearTo >= yearTo)
  return e
    ? { works: e.works.filter((w) => w.visitYear >= yearFrom && w.visitYear <= yearTo), cachedAt: e.cachedAt, sourceRange: `${e.yearFrom}-${e.yearTo}` }
    : null
}
