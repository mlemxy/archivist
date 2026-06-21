import {
  loginGoogle, loginEmail, registerEmail, logout, onAuth,
  pushChangedBookmarks, listenBookmarks, listenSettings,
  syncSetting, syncBookmark, unsyncBookmark, getSyncMeta, setSyncMeta
} from './firebase.js'
import { getAllBookmarks, saveBookmark, setSetting, getAllSettings } from '../db/database.js'

let _unsub = [], _uid = null, _onChange = null

export const onUserChange      = (cb)    => { _onChange = cb }
export const getUid            = ()      => _uid
export const onBookmarkSaved   = async (bm)  => { if (_uid) await syncBookmark(_uid, bm) }
export const onBookmarkDeleted = async (id)  => { if (_uid) await unsyncBookmark(_uid, id) }
export const onSettingChanged  = async (k,v) => { if (_uid) await syncSetting(_uid, k, v) }

export function mountAuthWidget(container) {
  container.innerHTML = `
    <div class="auth-wrap">
      <div id="ao">
        <p class="auth-title">Sync your library</p>
        <p class="auth-sub">Sign in to access your bookmarks on any device.</p>
        <button class="btn-google" id="ag">
          <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Continue with Google
        </button>
        <p class="auth-note">Sign in with your Google account to sync your library.</p>
        <div class="auth-divider"><span>or use email</span></div>
        <div class="auth-form" id="signin-form">
          <input class="input" id="ae"  type="email"    placeholder="Email address"  autocomplete="email"/>
          <input class="input" id="ap"  type="password" placeholder="Password"        autocomplete="current-password"/>
          <div class="auth-row">
            <button class="btn btn-primary" style="flex:1" id="asi">Sign in</button>
            <button class="btn btn-ghost"   style="flex:1" id="atab-reg">New here? Register</button>
          </div>
        </div>
        <div class="auth-form hidden" id="reg-form">
          <p class="auth-section-label">Create an account</p>
          <input class="input" id="re"  type="email"    placeholder="Email address"    autocomplete="email"/>
          <input class="input" id="rp"  type="password" placeholder="Password (min 6 characters)" autocomplete="new-password"/>
          <input class="input" id="rp2" type="password" placeholder="Confirm password" autocomplete="new-password"/>
          <div class="auth-row">
            <button class="btn btn-primary" style="flex:1" id="areg">Create account</button>
            <button class="btn btn-ghost"   style="flex:1" id="atab-si">Back to sign in</button>
          </div>
        </div>
        <p class="auth-error hidden" id="aerr"></p>
      </div>

      <div id="ain" class="hidden">
        <div class="auth-user-row">
          <img class="auth-avatar hidden" id="aav" src="" alt=""/>
          <div>
            <p class="auth-name"        id="aname"></p>
            <p class="auth-email-label" id="aeml"></p>
          </div>
        </div>
        <div class="auth-sync-row">
          <p class="auth-sync-status" id="asst">Connecting...</p>
          <div class="auth-sync-progress hidden" id="apbar">
            <div class="auth-sync-fill" id="apfill"></div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="aso">Sign out</button>
      </div>
    </div>`

  const $ = (id) => container.querySelector('#' + id)
  const showErr  = (msg) => { $('aerr').textContent = msg; $('aerr').classList.remove('hidden') }
  const clearErr = ()    => $('aerr').classList.add('hidden')

  $('atab-reg').onclick = () => { $('signin-form').classList.add('hidden'); $('reg-form').classList.remove('hidden'); clearErr() }
  $('atab-si').onclick  = () => { $('reg-form').classList.add('hidden'); $('signin-form').classList.remove('hidden'); clearErr() }

  $('ag').onclick = async () => {
    clearErr()
    try { await loginGoogle() }
    catch (e) { showErr(friendlyError(e.code)) }
  }

  $('asi').onclick = async () => {
    clearErr()
    const email = $('ae').value.trim(), pass = $('ap').value
    if (!email || !pass) { showErr('Please enter your email and password.'); return }
    try { await loginEmail(email, pass) }
    catch (e) { showErr(friendlyError(e.code)) }
  }

  $('areg').onclick = async () => {
    clearErr()
    const email = $('re').value.trim(), pass = $('rp').value, pass2 = $('rp2').value
    if (!email || !pass)  { showErr('Please enter an email and password.'); return }
    if (pass !== pass2)   { showErr('Passwords do not match.'); return }
    if (pass.length < 6)  { showErr('Password must be at least 6 characters.'); return }
    try { await registerEmail(email, pass) }
    catch (e) { showErr(friendlyError(e.code)) }
  }

  $('aso').onclick = async () => { _unsub.forEach((u) => u()); _unsub = []; await logout() }

  onAuth((user) => handleUser(user, container))
}

async function handleUser(user, container) {
  const $ = (id) => container.querySelector('#' + id)

  if (!user) {
    _uid = null
    _unsub.forEach((u) => u()); _unsub = []
    $('ao').classList.remove('hidden')
    $('ain').classList.add('hidden')
    _onChange?.(null)
    return
  }

  _uid = user.uid
  $('ao').classList.add('hidden')
  $('ain').classList.remove('hidden')
  $('aname').textContent = user.displayName || user.email?.split('@')[0] || 'Archivist'
  $('aeml').textContent  = user.email || ''
  if (user.photoURL) { $('aav').src = user.photoURL; $('aav').classList.remove('hidden') }

  await doInitialSync(user.uid, container)
  _onChange?.(_uid)

  _unsub = [
    listenBookmarks(_uid, async ({ changed, removed }) => {
      await Promise.all([
        ...changed.map((bm) => saveBookmark(bm)),
        ...removed.map((id) => import('../db/database.js').then(({ deleteBookmark }) => deleteBookmark(id))),
      ])
      _onChange?.(_uid)
    }),
    listenSettings(_uid, async (s) => {
      for (const [k,v] of Object.entries(s)) await setSetting(k, v)
    }),
  ]
}

function setProgress(container, pct) {
  const bar  = container.querySelector('#apbar')
  const fill = container.querySelector('#apfill')
  if (!bar || !fill) return
  // Show bar first, then update width in the NEXT frame so the
  // CSS transition has a visible start state to animate from
  bar.classList.remove('hidden')
  requestAnimationFrame(() =>
    requestAnimationFrame(() => { fill.style.width = pct + '%' })
  )
}

function setStatus(container, msg) {
  const el = container.querySelector('#asst')
  if (el) el.textContent = msg
}

async function doInitialSync(uid, container) {
  const t0 = Date.now()

  setStatus(container, 'Preparing sync...')
  setProgress(container, 10)

  const [local, settings, meta] = await Promise.all([
    getAllBookmarks(),
    getAllSettings(),
    getSyncMeta(uid).catch(() => ({})),
  ])

  const sinceIso  = meta?.lastSync || null
  const toSyncCount = sinceIso
    ? local.filter((bm) => bm.dateModified && bm.dateModified > sinceIso).length
    : local.length

  if (toSyncCount > 0) {
    const estSecs = Math.max(1, Math.ceil(toSyncCount / 400) * 2)
    setStatus(container, `Uploading ${toSyncCount} change${toSyncCount !== 1 ? 's' : ''}... (~${estSecs}s)`)
  } else {
    setStatus(container, 'Checking for changes...')
  }
  setProgress(container, 30)

  const pushed = await pushChangedBookmarks(uid, local, sinceIso)
  setProgress(container, 75)

  // Sync non-sensitive settings in parallel
  const SYNCABLE = ['ao3Username', 'updateCheckEnabled']
  await Promise.all(
    SYNCABLE.filter((k) => settings[k] != null).map((k) => syncSetting(uid, k, settings[k]))
  )
  setProgress(container, 90)

  const now = new Date().toISOString()
  await setSyncMeta(uid, { lastSync: now, bookmarkCount: local.length })
  setProgress(container, 100)

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const msg = pushed > 0
    ? `Uploaded ${pushed} change${pushed !== 1 ? 's' : ''} in ${elapsed}s`
    : `Up to date (${elapsed}s)`
  setStatus(container, msg)

  setTimeout(() => {
    container.querySelector('#apbar')?.classList.add('hidden')
    setStatus(container, 'Sync active')
  }, 3000)
}

const friendlyError = (code) => ({
  'auth/invalid-email':          'Please enter a valid email address.',
  'auth/user-not-found':         'No account found with that email.',
  'auth/invalid-credential':     'Incorrect email or password.',
  'auth/wrong-password':         'Incorrect email or password.',
  'auth/email-already-in-use':   'An account with that email already exists. Try signing in.',
  'auth/weak-password':          'Password must be at least 6 characters.',
  'auth/popup-closed-by-user':   'Sign-in was cancelled.',
  'auth/no-identity-api':        'Google sign-in is not available. Please use email instead.',
  'auth/network-request-failed': 'Connection failed. Check your internet and try again.',
  'auth/too-many-requests':      'Too many attempts. Please wait a moment and try again.',
  'auth/operation-not-allowed':  'Sign-in is temporarily unavailable. Please try again later.',
})[code] || 'Something went wrong. Please try again.'
