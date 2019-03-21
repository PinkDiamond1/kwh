/** @format */

import browser from 'webextension-polyfill'

import {PROMPT_PAYMENT, PROMPT_INVOICE, PROMPT_ENABLE} from './constants'
import {rpcCall, getOriginData, sprint} from './utils'
import {getBehavior} from './predefined-behaviors'
import * as current from './current-action'

// logger service
browser.runtime.onMessage.addListener((message, sender) => {
  console.log(
    `[message-in]: ${sprint({
      ...message,
      tab: message.getInit ? '-' : sender.tab || message.tab
    })}}`
  )
})

// return the current action to anyone asking for it -- normally the popup
browser.runtime.onMessage.addListener(({getInit}) => {
  if (!getInit) return
  return browser.tabs.query({active: true}).then(tabs => {
    let tab = tabs[0]
    return {action: current.get(tab.id)[0], tab: {id: tab.id}}
  })
})

// set current action when anyone -- normally the popup -- wants
browser.runtime.onMessage.addListener(({setAction, tab}, sender) => {
  if (!setAction) return

  tab = sender.tab || tab
  let action = setAction

  let promise = current.set(tab.id, action)

  if (tab) {
    // means it's coming from the content-script, not the popup
    browser.runtime.sendMessage({setAction: action}).catch(() => {})
  }

  if (
    action.type === PROMPT_PAYMENT ||
    action.type === PROMPT_INVOICE ||
    action.type === PROMPT_ENABLE
  ) {
    browser.browserAction.openPopup().catch(() => {})
  }

  return promise
})

// do an rpc call on behalf of anyone who wants that -- normally the popup
browser.runtime.onMessage.addListener(
  ({rpc, method, params, behaviors = {}, extra = {}, tab}, sender) => {
    if (!rpc) return

    tab = sender.tab || tab
    let resPromise = rpcCall(method, params)

    resPromise.then(res => {
      ;(behaviors.success || [])
        .map(getBehavior)
        .forEach(behavior => behavior(res, current.get(tab.id), tab.id))
    })

    resPromise.catch(err => {
      ;(behaviors.failure || [])
        .map(getBehavior)
        .forEach(behavior => behavior(err, current.get(tab.id), tab.id))
    })

    return resPromise
  }
)

// trigger behaviors from popup action
browser.runtime.onMessage.addListener(
  ({triggerBehaviors, behaviors, tab}, sender) => {
    if (!triggerBehaviors) return
    tab = sender.tab || tab
    behaviors
      .map(getBehavior)
      .forEach(behavior => behavior(null, current.get(tab.id), tab.id))
  }
)

// return if a domain is authorized or authorize a domain
browser.runtime.onMessage.addListener(
  ({getAuthorized, domain, tab}, sender) => {
    if (!getAuthorized) return
    tab = sender.tab || tab
    return browser.storage.local.get('authorized').then(res => {
      let authorized = res.authorized || {}
      return domain
        ? authorized[domain]
        : authorized /* return all if domain not given */
    })
  }
)

// context menus
// 'pay with lightning' context menu
browser.contextMenus.create({
  id: 'pay-invoice',
  title: 'Pay Lightning Invoice',
  contexts: ['selection', 'page'],
  visible: false
})

// 'insert invoice' here context menu
browser.contextMenus.create({
  id: 'generate-invoice-here',
  title: 'Generate invoice here',
  contexts: ['editable']
})

browser.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'pay-invoice':
      // set current action to pay this invoice
      current.set(tab.id, {
        type: PROMPT_PAYMENT,
        invoice: currentInvoice,
        origin: getOriginData()
      })
      break
    case 'generate-invoice-here':
      current.set(tab.id, {
        type: PROMPT_INVOICE,
        pasteOn: [tab.id, info.targetElementId],
        origin: getOriginData()
      })
      break
  }
})

var currentInvoice = ''

browser.runtime.onMessage.addListener(({contextMenu, invoice}) => {
  if (!contextMenu) return

  // set context menu visibility based on right-clicked text
  currentInvoice = invoice.trim()
  var visible = currentInvoice.slice(0, 4) === 'lnbc'
  browser.contextMenus.update('pay-invoice', {visible})
})
