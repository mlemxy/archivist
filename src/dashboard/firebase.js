import { initializeApp } from '../../assets/lib/firebase.bundle.js'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, signInWithCredential, GoogleAuthProvider } from '../../assets/lib/firebase.bundle.js'
import { getFirestore, doc, setDoc, deleteDoc, collection, onSnapshot, writeBatch, serverTimestamp, getDoc } from '../../assets/lib/firebase.bundle.js'

const app = initializeApp({
  apiKey:'AIzaSyBrIzFaBI4lzHaBmXW5Vad1_xfgmBRA1pw', authDomain:'archivist-6efd3.firebaseapp.com',
  projectId:'archivist-6efd3', storageBucket:'archivist-6efd3.firebasestorage.app',
  messagingSenderId:'223549238677', appId:'1:223549238677:web:91e07c34d2e5716263da9c',
})

export const auth = getAuth(app)
export const db   = getFirestore(app)

export const loginGoogle = () => new Promise((resolve, reject) =>
  chrome.identity?.getAuthToken({ interactive: true }, async (token) => {
    if (chrome.runtime.lastError || !token) return reject({ code: 'auth/popup-closed-by-user' })
    try { resolve(await signInWithCredential(auth, GoogleAuthProvider.credential(null, token))) }
    catch (e) { reject(e) }
  }) ?? reject({ code: 'auth/no-identity-api' })
)

export const loginEmail    = (e, p) => signInWithEmailAndPassword(auth, e, p)
export const registerEmail = (e, p) => createUserWithEmailAndPassword(auth, e, p)
export const logout        = () => signOut(auth)
export const onAuth        = (cb) => onAuthStateChanged(auth, cb)
export const currentUser   = () => auth.currentUser

const bDoc    = (uid, id) => doc(db, 'users', uid, 'bookmarks', id)
const bCol    = (uid)     => collection(db, 'users', uid, 'bookmarks')
const sDoc    = (uid, k)  => doc(db, 'users', uid, 'settings', k)
const sCol    = (uid)     => collection(db, 'users', uid, 'settings')
const metaDoc = (uid)     => doc(db, 'users', uid, 'meta', 'info')

const SYNC_FIELDS = ['workId','title','authors','fandoms','rating','warnings','categories','relationships','characters','additionalTags','summary','wordCount','chaptersCurrent','chaptersTotal','ao3Status','language','datePublished','dateUpdatedOnAO3','ao3Url','status','lastReadChapter','starRating','annotation','personalTags','notifyUpdates','dateBookmarked','dateModified','hasUpdate']
const LOCAL_ONLY  = new Set(['ao3SessionCookie','ao3CfBm','ao3Cfuvid','ao3Clearance','wallpaper','pinnedPhoto'])
const slim = (bm) => ({ ...Object.fromEntries(SYNC_FIELDS.filter((k) => bm[k] !== undefined).map((k) => [k, bm[k]])), _syncedAt: serverTimestamp() })

export const syncBookmark   = (uid, bm) => setDoc(bDoc(uid, bm.workId), slim(bm))
export const unsyncBookmark = (uid, id) => deleteDoc(bDoc(uid, id))
export const syncSetting    = (uid, k, v) => LOCAL_ONLY.has(k) ? Promise.resolve() : setDoc(sDoc(uid, k), { key:k, value:v, _syncedAt:serverTimestamp() })
export const getSyncMeta    = (uid) => getDoc(metaDoc(uid)).then((d) => d.data() || {})
export const setSyncMeta    = (uid, data) => setDoc(metaDoc(uid), { ...data, updatedAt: serverTimestamp() })

export async function pushChangedBookmarks(uid, bookmarks, sinceIso) {
  const toSync = sinceIso ? bookmarks.filter((bm) => bm.dateModified > sinceIso) : bookmarks
  if (!toSync.length) return 0
  for (let i = 0; i < toSync.length; i += 400) {
    const batch = writeBatch(db)
    toSync.slice(i, i + 400).forEach((bm) => batch.set(bDoc(uid, bm.workId), slim(bm)))
    await batch.commit()
  }
  return toSync.length
}

export const listenBookmarks = (uid, cb) => {
  let ready = false
  return onSnapshot(bCol(uid), (snap) => {
    if (!ready) { ready = true; return }
    const changed = snap.docChanges().filter((c) => c.type !== 'removed').map((c) => c.doc.data())
    const removed = snap.docChanges().filter((c) => c.type === 'removed').map((c) => c.doc.id)
    if (changed.length || removed.length) cb({ changed, removed })
  })
}

export const listenSettings = (uid, cb) =>
  onSnapshot(sCol(uid), (snap) => {
    const obj = {}
    snap.docChanges()
      .filter((c) => c.type !== 'removed' && !LOCAL_ONLY.has(c.doc.data().key))
      .forEach((c) => { obj[c.doc.data().key] = c.doc.data().value })
    if (Object.keys(obj).length) cb(obj)
  })
