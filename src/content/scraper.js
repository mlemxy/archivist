;(function () {
  const m = window.location.pathname.match(/^\/works\/(\d+)/)
  if (!m) return
  const workId = m[1]
  const text   = (sel, root = document) => root.querySelector(sel)?.textContent.trim() || ''
  const texts  = (sel, root = document) => [...root.querySelectorAll(sel)].map((el) => el.textContent.trim())
  const tagGroup = (meta, label) => {
    for (const dt of meta?.querySelectorAll('dt') || [])
      if (dt.textContent.trim().toLowerCase().startsWith(label.toLowerCase()))
        return texts('a.tag', dt.nextElementSibling)
    return []
  }
  const send = () => {
    try {
      const meta  = document.querySelector('.work.meta.group')
      const stats = document.querySelector('dl.stats')
      const stat  = (l) => {
        for (const dt of stats?.querySelectorAll('dt') || [])
          if (dt.textContent.trim().toLowerCase().startsWith(l.toLowerCase()))
            return dt.nextElementSibling?.textContent.trim() || ''
        return ''
      }
      const wc  = parseInt(stat('Words').replace(/,/g,''), 10) || 0
      const ch  = stat('Chapters')
      const [cur, tot] = ch ? ch.split('/') : ['0','0']
      const cc  = parseInt(cur, 10) || 0
      const ct  = tot === '?' ? null : parseInt(tot, 10) || null
      const authors = [...document.querySelectorAll('h3.byline.heading a[rel="author"]')].map((a) => a.textContent.trim())
      chrome.runtime.sendMessage({ type: 'FIC_PAGE_DETECTED', payload: {
        workId, title: text('h2.title.heading'),
        authors: authors.length ? authors : ['Anonymous'],
        fandoms: tagGroup(meta,'Fandom'), rating: tagGroup(meta,'Rating')[0] || 'Not Rated',
        warnings: tagGroup(meta,'Archive Warning'), categories: tagGroup(meta,'Category'),
        relationships: tagGroup(meta,'Relationship'), characters: tagGroup(meta,'Character'),
        additionalTags: tagGroup(meta,'Additional Tags'),
        summary: document.querySelector('.summary .userstuff')?.innerHTML.trim() || '',
        wordCount: wc, chaptersCurrent: cc, chaptersTotal: ct,
        ao3Status: ct !== null && cc === ct ? 'Complete' : 'In Progress',
        language: stat('Language'), datePublished: stat('Published'),
        dateUpdatedOnAO3: stat('Updated') || stat('Published'),
        ao3Url: `https://archiveofourown.org/works/${workId}`,
        kudos: parseInt(stat('Kudos').replace(/,/g,''), 10) || 0,
        hits:  parseInt(stat('Hits').replace(/,/g,''),  10) || 0,
      }})
    } catch {}
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', send) : send()
})()
