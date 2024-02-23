/* global chrome */
console.log('Context sync initialised.')
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const data = { ls: {}, ss: {} }

  switch (message.cmd) {
    case 'save': // Save context.
      for (const key in sessionStorage) {
        data.ss[key] = sessionStorage[key]
      }

      for (const key in localStorage) {
        data.ls[key] = localStorage[key]
      }

      sendResponse(data)
      break
    case 'load': // Load context.
      console.log('Restoring session storage.')
      for (const key in message.ss) {
        sessionStorage[key] = message.ss[key]
      }

      console.log('Restoring local storage.')
      for (const key in message.ls) {
        localStorage[key] = message.ls[key]
      }

      sendResponse({ cmd: 'ok' })
      break
  }
})
