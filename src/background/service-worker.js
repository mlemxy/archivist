'use strict'
const ALARM = 'archivist-update-check'
const INTERVAL = 12 * 60

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      updateCheckEnabled: true, updateCheckIntervalMinutes: INTERVAL,
      ao3Cookies: { __cf_bm:'', _cfuvid:'', _otwarchive_session:'', cf_clearance:'' },
      ao3Username: '', pendingUpdates: [],
    })
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') })
  }
  setupAlarm()
})

chrome.runtime.onStartup.addListener(setupAlarm)

async function setupAlarm() {
  await chrome.alarms.clear(ALARM)
  const { updateCheckEnabled, updateCheckIntervalMinutes } =
    await chrome.storage.local.get(['updateCheckEnabled','updateCheckIntervalMinutes'])
  if (updateCheckEnabled)
    chrome.alarms.create(ALARM, { periodInMinutes: updateCheckIntervalMinutes || INTERVAL })
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  ({
    FIC_PAGE_DETECTED:    () => { chrome.storage.session.set({ currentFic: msg.payload, currentFicTabId: sender.tab?.id }); respond({ ok: true }) },
    GET_CURRENT_FIC:      () => { chrome.storage.session.get(['currentFic']).then((r) => respond({ fic: r.currentFic || null })); return true },
    AO3_COOKIES_UPDATED:  () => { chrome.storage.local.set({ ao3Cookies: msg.payload }); respond({ ok: true }) },
    UPDATE_INTERVAL_CHANGED: () => { chrome.storage.local.set({ updateCheckIntervalMinutes: msg.payload.minutes, updateCheckEnabled: msg.payload.enabled }).then(setupAlarm); respond({ ok: true }) },
    CLEAR_PENDING_UPDATES:() => { chrome.storage.local.set({ pendingUpdates: [] }); updateBadge(0); respond({ ok: true }) },
    UPDATE_CHECK_RESULTS: () => {
      const { updatedFics } = msg.payload
      if (updatedFics?.length) {
        chrome.storage.local.set({ pendingUpdates: updatedFics })
        updateBadge(updatedFics.length)
        chrome.notifications.create('archivist-updates', {
          type: 'basic', iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
          title: 'Archivist',
          message: `${updatedFics.length} fic${updatedFics.length > 1 ? 's' : ''} you're reading ${updatedFics.length > 1 ? 'have' : 'has'} new chapters.`,
        })
      } else {
        chrome.storage.local.set({ pendingUpdates: [] }); updateBadge(0)
      }
    },
  })[msg.type]?.()
})

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== ALARM) return
  const { updateCheckEnabled } = await chrome.storage.local.get(['updateCheckEnabled'])
  if (!updateCheckEnabled) return
  const tabs = await chrome.tabs.query({})
  const tab  = tabs.find((t) => t.url?.startsWith(chrome.runtime.getURL('src/dashboard')))
  tab
    ? chrome.tabs.sendMessage(tab.id, { type: 'RUN_UPDATE_CHECK' })
    : chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') + '?autocheck=1', active: false })
})

chrome.action.onClicked.addListener(() => { chrome.storage.local.set({ pendingUpdates: [] }); updateBadge(0) })

const updateBadge = (n) => {
  chrome.action.setBadgeText({ text: n ? String(n) : '' })
  if (n) chrome.action.setBadgeBackgroundColor({ color: '#C27C88' })
}
