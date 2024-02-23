/* global chrome */
const GIST_NAME = 'chrome-context-sync.json'

let urls
let headers

async function init () {
  await enableScripts()
  const token = (await chrome.storage.sync.get('githubToken')).githubToken || ''
  document.getElementById('github-token').setAttribute('value', token)
  headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const urlsText = (await chrome.storage.sync.get('urls')).urls || ''
  document.getElementById('urls').value = urlsText
  urls = urlsText.split('\n').map(url => url.trim())
}

init()

//
// Cookie management.
//

function buildUrl (secure, domain, path) {
  if (domain.startsWith('.')) {
    domain = domain.substr(1)
  }
  return `http${secure ? 's' : ''}://${domain}${path}`
}

async function getCookies (domain) {
  const cookies = await chrome.cookies.getAll({ domain })

  return cookies.map(cookie => {
    const cookieDetails = {
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      storeId: cookie.storeId,
      url: buildUrl(cookie.secure, cookie.domain, cookie.path)
    }

    if (!cookie.hostOnly) {
      cookieDetails.domain = cookie.domain
    }
    if (!cookie.session) {
      cookieDetails.expirationDate = cookie.expirationDate
    }

    return cookieDetails
  })
}

//
// Enabling and disabling JS.
//

async function disableScripts () {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: '*',
        resourceTypes: ['script']
      }
    }]
  })
}

async function enableScripts () {
  return chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1] })
}

//
// GitHub Gist API
//

async function getGist () {
  const res = await fetch('https://api.github.com/gists', { headers })
  const gists = await res.json()
  return gists.find(gist => gist.files[GIST_NAME])
}

async function saveData (data) {
  const gist = await getGist()

  if (!gist) {
    // Create new gist.
    await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: `Data from ${data.domain}`,
        public: false,
        files: {
          [GIST_NAME]: {
            content: JSON.stringify(data)
          }
        }
      })
    })
  } else {
    // Update existing gist.
    await fetch(`https://api.github.com/gists/${gist.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        description: `Data from ${data.domain}`,
        public: false,
        files: {
          [GIST_NAME]: {
            content: JSON.stringify(data)
          }
        }
      })
    })
  }
}

// -----------------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------------

document.getElementById('save').addEventListener('click', async event => {
  const data = []

  await disableScripts()

  for (const url of urls) {
    const entry = { url, hostname: new URL(url).hostname }

    // Try to get cookies for the root domain.
    entry.domain = entry.hostname.split('.').slice(-2).join('.')
    entry.cookies = await getCookies(entry.domain)

    // If not possible, get cookies for the full domain.
    if (entry.cookies.length === 0) {
      entry.domain = entry.hostname
      entry.cookies = await getCookies(entry.domain)
    }

    // Visit the URL in order to obtain storage data.
    const tab = await chrome.tabs.create({ url, active: false })
    const response = await new Promise(resolve => {
      chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          resolve(await chrome.tabs.sendMessage(tab.id, { cmd: 'save' }))
        }
      })
    })
    await chrome.tabs.remove(tab.id)

    entry.ss = response.ss
    entry.ls = response.ls
    data.push(entry)
  }

  await enableScripts()
  await saveData(data)
})

document.getElementById('load').addEventListener('click', async event => {
  const gist = await getGist()
  const res = await fetch(gist.files[GIST_NAME].raw_url)
  const data = await res.json()

  await disableScripts()

  for (const entry of data) {
    // Restore cookies.
    for (const cookie of entry.cookies) {
      try {
        await chrome.cookies.set(cookie)
      } catch (err) {
        console.log('Unable to set cookie:', cookie)
      }
    }

    // Resotre storage data.
    const tab = await chrome.tabs.create({ url: entry.url, active: false })
    await new Promise(resolve => {
      chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          resolve(await chrome.tabs.sendMessage(tab.id, { cmd: 'load', ss: entry.ss, ls: entry.ls }))
        }
      })
    })
    await chrome.tabs.remove(tab.id)
  }

  await enableScripts()

  // Open tabs for each URL.
  for (const entry of data) {
    await chrome.tabs.create({ url: entry.url, active: false })
  }
})

document.getElementById('github-token').addEventListener('input', async event => {
  await chrome.storage.sync.set({ githubToken: event.target.value.trim() })
})

document.getElementById('urls').addEventListener('input', async event => {
  await chrome.storage.sync.set({ urls: event.target.value.trim() })
})

document.getElementById('enable-scripts').addEventListener('click', async event => {
  await enableScripts()
})

document.getElementById('disable-scripts').addEventListener('click', async event => {
  await disableScripts()
})
