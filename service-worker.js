/**
 * @file service-worker.js
 * @description Service worker de segundo plano para gerenciar alarmes, notificações e outras tarefas assíncronas.
 */

// --- CONSTANTES ---
const REMINDERS_STORAGE_KEY = 'remindersData'
const USAGE_TRACKING_KEY = 'usageTrackingData'
const SUGGESTED_TRAMITES_KEY = 'suggestedTramites'
const STORAGE_KEY = 'quickMessagesData'
const SUGGESTION_THRESHOLD = 5
const MIN_SUGGESTION_LENGTH = 100

// --- FUNÇÕES DE ARMAZENAMENTO (STORAGE) ---

/**
 * Busca dados de uma área de armazenamento do Chrome.
 * @param {string} key A chave a ser buscada.
 * @param {'sync' | 'local'} storageArea A área de armazenamento a ser usada.
 * @returns {Promise<any>} Os dados encontrados ou undefined.
 */
async function getStorageData(key, storageArea = 'sync') {
  try {
    const result = await chrome.storage[storageArea].get(key)
    return result[key]
  } catch (error) {
    console.error(
      `Erro ao ler do storage (${storageArea}) a chave ${key}:`,
      error
    )
    return undefined
  }
}

/**
 * Salva dados em uma área de armazenamento do Chrome.
 * @param {string} key A chave para salvar os dados.
 * @param {any} value O valor a ser salvo.
 * @param {'sync' | 'local'} storageArea A área de armazenamento a ser usada.
 */
async function setStorageData(key, value, storageArea = 'sync') {
  try {
    await chrome.storage[storageArea].set({ [key]: value })
  } catch (error) {
    console.error(
      `Erro ao salvar no storage (${storageArea}) a chave ${key}:`,
      error
    )
  }
}

/**
 * Busca todos os lembretes do armazenamento.
 * @returns {Promise<object>} Um objeto com todos os lembretes.
 */
async function getReminders() {
  return (await getStorageData(REMINDERS_STORAGE_KEY, 'sync')) || {}
}

/**
 * Salva o objeto de lembretes no armazenamento.
 * @param {object} reminders O objeto de lembretes a ser salvo.
 */
async function saveReminders(reminders) {
  await setStorageData(REMINDERS_STORAGE_KEY, reminders, 'sync')
}

// --- LÓGICA DE LEMBRETES E NOTIFICAÇÕES ---

/**
 * Calcula a próxima data de um alarme recorrente.
 * @param {Date} lastDate A última data do alarme.
 * @param {string} recurrence A regra ('daily', 'weekly', 'monthly').
 * @returns {Date | null} A nova data ou null se a recorrência for 'none'.
 */
function getNextRecurrenceDate(lastDate, recurrence) {
  if (!recurrence || recurrence === 'none') return null

  const nextDate = new Date(lastDate.getTime())
  switch (recurrence) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1)
      break
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7)
      break
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1)
      break
    default:
      return null
  }
  return nextDate
}

/**
 * Transmite uma mensagem para todas as abas abertas do SGD.
 * Útil para notificações em página.
 * @param {object} message O objeto da mensagem a ser enviada.
 */
async function broadcastToSgdTabs(message) {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://sgd.dominiosistemas.com.br/*'
    })
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, message).catch(error => {
        // Ignora erros comuns quando a aba não está pronta para receber mensagens.
        if (
          !error.message.includes('Could not establish connection') &&
          !error.message.includes('Receiving end does not exist')
        ) {
          console.error(`Erro ao enviar mensagem para a aba ${tab.id}:`, error)
        }
      })
    })
  } catch (error) {
    console.error('Erro ao consultar abas do SGD:', error)
  }
}

/**
 * Exibe uma notificação nativa do Chrome.
 * @param {object} reminder O objeto do lembrete.
 */
function showChromeNotification(reminder) {
  const notificationId = reminder.id
  const hasUrl = reminder.url && reminder.url.startsWith('http')

  const buttons = [{ title: 'Soneca (10 min)' }]
  if (hasUrl) {
    buttons.push({ title: 'Abrir Solicitação' })
  }
  buttons.push({ title: 'Dispensar' })

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'logo.png',
    title: reminder.title || 'Lembrete SGD',
    message: reminder.description || 'Verificar chamado agendado.',
    priority: 2,
    buttons: buttons,
    requireInteraction: true,
    silent: false
  })
}

/**
 * Limpa a notificação visual e o alarme associado.
 * @param {string} notificationId O ID da notificação a ser limpa.
 */
async function clearNotificationAndAlarm(notificationId) {
  try {
    await chrome.notifications.clear(notificationId)
    await chrome.alarms.clear(notificationId)
    // Limpa também possíveis alarmes de soneca
    await chrome.alarms.clear(`snooze-${notificationId}`)
  } catch (error) {
    console.error(`Erro ao limpar notificação/alarme ${notificationId}:`, error)
  }
}

// --- INICIALIZAÇÃO E LISTENERS DE EVENTOS DO CHROME ---

/**
 * Configura alarmes essenciais na inicialização da extensão.
 */
function setupInitialAlarms() {
  chrome.alarms.create('analyze-usage', {
    delayInMinutes: 60,
    periodInMinutes: 180
  })
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Service Worker: Extensão instalada/atualizada.')
  setupInitialAlarms()
})

chrome.runtime.onStartup.addListener(() => {
  console.log('Service Worker: Navegador iniciado.')
  setupInitialAlarms()
})

/**
 * Listener para mensagens do content script (para criar/limpar alarmes).
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    try {
      if (
        message.action === 'SET_ALARM' &&
        message.reminderId &&
        message.alarmTime
      ) {
        await chrome.alarms.create(message.reminderId, {
          when: message.alarmTime
        })
        sendResponse({ success: true })
      } else if (message.action === 'CLEAR_ALARM' && message.reminderId) {
        await chrome.alarms.clear(message.reminderId)
        sendResponse({ success: true })
      } else if (message.action === 'BROADCAST_DISMISS' && message.reminderId) {
        // Nova ação para retransmitir o fechamento da notificação em-página
        await broadcastToSgdTabs({
          action: 'CLOSE_IN_PAGE_NOTIFICATION',
          reminderId: message.reminderId
        })

        // Atualiza o badge em todas as abas após dispensar
        await broadcastToSgdTabs({
          action: 'UPDATE_NOTIFICATION_BADGE'
        })

        sendResponse({ success: true })
      } else if (message.action === 'UPDATE_NOTIFICATION_BADGE') {
        // Atualiza o badge em todas as abas
        await broadcastToSgdTabs({
          action: 'UPDATE_NOTIFICATION_BADGE'
        })
        sendResponse({ success: true })
      }
    } catch (error) {
      console.error(`Erro ao processar ação '${message.action}':`, error)
      sendResponse({ success: false, error: error.message })
    }
  })()
  return true // Indica resposta assíncrona.
})

/**
 * Listener principal para quando um alarme é disparado.
 */
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'analyze-usage') {
    await analyzeUsageAndSuggest()
    return
  }

  const isSnooze = alarm.name.startsWith('snooze-')
  const reminderId = isSnooze ? alarm.name.split('snooze-')[1] : alarm.name

  if (!reminderId.startsWith('reminder-')) return

  const reminders = await getReminders()
  const reminder = reminders[reminderId]

  if (!reminder) {
    console.warn(`Lembrete com ID ${reminderId} não encontrado.`)
    await clearNotificationAndAlarm(reminderId)
    return
  }

  showChromeNotification(reminder)
  broadcastToSgdTabs({ action: 'SHOW_IN_PAGE_NOTIFICATION', reminder })

  // Marca o lembrete atual como disparado. Isso é importante para a UI.
  reminder.isFired = true
  reminder.firedAt = Date.now()

  // Se for um lembrete recorrente (e não uma soneca), agenda a próxima ocorrência.
  if (reminder.recurrence && reminder.recurrence !== 'none' && !isSnooze) {
    const nextDate = getNextRecurrenceDate(
      new Date(reminder.dateTime),
      reminder.recurrence
    )
    if (nextDate) {
      // Atualiza o lembrete existente com a nova data e reseta o status 'fired'.
      reminder.dateTime = nextDate.toISOString()
      reminder.isFired = false
      reminder.firedAt = null
      await chrome.alarms.create(reminder.id, { when: nextDate.getTime() })
    }
  }

  await saveReminders(reminders)
})

/**
 * Listener para cliques nos botões da notificação.
 */
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('reminder-')) return

    const reminders = await getReminders()
    const reminder = reminders[notificationId]

    if (!reminder) {
      await clearNotificationAndAlarm(notificationId)
      return
    }

    const hasUrl = reminder.url && reminder.url.startsWith('http')
    let buttonAction = 'snooze' // Botão 0 é sempre soneca

    if (hasUrl) {
      if (buttonIndex === 1) buttonAction = 'open'
      if (buttonIndex === 2) buttonAction = 'dismiss'
    } else {
      if (buttonIndex === 1) buttonAction = 'dismiss'
    }

    switch (buttonAction) {
      case 'snooze':
        const snoozeTime = Date.now() + 10 * 60 * 1000 // 10 minutos
        await chrome.alarms.create(`snooze-${notificationId}`, {
          when: snoozeTime
        })
        break
      case 'open':
        chrome.tabs.create({ url: reminder.url })
        break
      case 'dismiss':
        // Apenas fecha a notificação, o estado 'fired' já foi salvo no onAlarm.
        break
    }

    // Limpa a notificação visual após qualquer ação de botão.
    await chrome.notifications.clear(notificationId)
  }
)

/**
 * Listener para clique no corpo da notificação.
 */
chrome.notifications.onClicked.addListener(async notificationId => {
  if (!notificationId.startsWith('reminder-')) return

  const reminder = (await getReminders())[notificationId]
  if (reminder?.url) {
    chrome.tabs.create({ url: reminder.url })
  }
  await clearNotificationAndAlarm(notificationId)
})

/**
 * Listener para quando a notificação é fechada pelo usuário.
 */
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  if (byUser && notificationId.startsWith('reminder-')) {
    await clearNotificationAndAlarm(notificationId)
  }
})

// --- LÓGICA DE ANÁLISE DE SUGESTÕES ---

/**
 * Analisa o uso de trâmites e sugere novos para adicionar às mensagens rápidas.
 * (A lógica interna desta função permanece a mesma)
 */
async function analyzeUsageAndSuggest() {
  console.log('Executando análise de uso para sugestão de trâmites...')
  const usageData = (await getStorageData(USAGE_TRACKING_KEY, 'local')) || {
    hashes: {},
    content: {}
  }
  const quickMessagesData = (await getStorageData(STORAGE_KEY, 'sync')) || {
    messages: []
  }
  const existingSuggestions =
    (await getStorageData(SUGGESTED_TRAMITES_KEY, 'sync')) || []

  const existingTramiteHashes = new Set(
    quickMessagesData.messages.map(msg => simpleHash(msg.message))
  )
  const pendingSuggestionHashes = new Set(existingSuggestions.map(s => s.hash))

  const newSuggestions = []

  for (const hash in usageData.hashes) {
    const count = usageData.hashes[hash]
    const content = usageData.content[hash]

    if (
      content &&
      count >= SUGGESTION_THRESHOLD &&
      content.length >= MIN_SUGGESTION_LENGTH &&
      !existingTramiteHashes.has(parseInt(hash)) &&
      !pendingSuggestionHashes.has(parseInt(hash))
    ) {
      newSuggestions.push({
        hash: parseInt(hash),
        content: content,
        count: count
      })
    }
  }

  if (newSuggestions.length > 0) {
    const allSuggestions = [...existingSuggestions, ...newSuggestions]
    await setStorageData(SUGGESTED_TRAMITES_KEY, allSuggestions, 'sync')
    console.log(`${newSuggestions.length} nova(s) sugestão(ões) salva(s).`)
  }
}

/**
 * Gera um hash simples de uma string.
 * @param {string} str A string de entrada.
 * @returns {number} O hash gerado.
 */
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Converte para um inteiro de 32 bits.
  }
  return hash
}
