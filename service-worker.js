/**
 * @file service-worker.js
 * Service worker de segundo plano para gerenciar alarmes, notificações e outras tarefas assíncronas
 */

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
// REMOVIDO: A função getNextRecurrenceDate foi movida para utils.js

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

// ATENÇÃO: A função showChromeNotification foi REMOVIDA - agora usamos apenas notificações internas

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
  // Alarmes de análise de uso removidos
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
      } else if (message.action === 'REMINDER_CREATED') {
        // Notifica todas as abas sobre novo lembrete criado
        await broadcastToSgdTabs({
          action: 'UPDATE_NOTIFICATION_BADGE'
        })
        sendResponse({ success: true })
      } else if (message.action === 'REMINDER_DISMISSED') {
        // Notifica todas as abas sobre lembrete dispensado
        await broadcastToSgdTabs({
          action: 'UPDATE_NOTIFICATION_BADGE'
        })
        sendResponse({ success: true })
      } else if (message.action === 'REMINDER_UPDATED') {
        // Notifica todas as abas sobre lembrete atualizado
        await broadcastToSgdTabs({
          action: 'UPDATE_NOTIFICATION_BADGE'
        })
        sendResponse({ success: true })
      } else if (message.action === 'BROADCAST_DISMISS' && message.reminderId) {
        // Ação para fechar a notificação em outras abas quando o usuário interage em uma delas
        await broadcastToSgdTabs({
          action: 'CLOSE_IN_PAGE_NOTIFICATION',
          reminderId: message.reminderId
        })
        sendResponse({ success: true })
      } else if (message.action === 'UPDATE_NOTIFICATION_BADGE') {
        // Ação para atualizar o badge em todas as abas (agora chamada pelo site após 10s)
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
  if (alarm.name.startsWith('snooze-')) {
    // Lógica para soneca (se necessário) ou pode ser unificada
  }

  const reminderId = alarm.name.replace('snooze-', '')
  if (!reminderId) return

  const reminders = await getReminders()
  const reminder = reminders[reminderId]

  if (!reminder) {
    console.warn(`Lembrete com ID ${reminderId} não encontrado.`)
    await clearNotificationAndAlarm(reminderId)
    return
  }

  // Passo 1: Atualiza o estado para "disparado" e salva. Esta é a nova fonte da verdade.
  reminder.isFired = true
  reminder.firedAt = Date.now()
  await saveReminders(reminders)

  // Passo 2: Notifica todas as abas para atualizarem o ícone do sino.
  // Isso garante que o sino comece a pulsar imediatamente em todas as guias.
  broadcastToSgdTabs({ action: 'UPDATE_NOTIFICATION_BADGE' })

  // Passo 3: Verifica se o toast de notificação único para esta sessão já foi exibido.
  const toastShownKey = `toast_shown_${reminder.id}`
  const sessionData = await chrome.storage.session.get(toastShownKey)

  if (!sessionData[toastShownKey]) {
    // Se ainda não foi exibido, define o flag de visualização para a sessão...
    await chrome.storage.session.set({ [toastShownKey]: true })
    // ...e então envia a mensagem para mostrar o toast.
    broadcastToSgdTabs({ action: 'SHOW_IN_PAGE_NOTIFICATION', reminder })
  }
})

// ATENÇÃO: Todos os listeners de chrome.notifications foram REMOVIDOS

// --- LÓGICA DE ANÁLISE DE SUGESTÕES ---

/**
 * Analisa o uso de trâmites e sugere novos para adicionar às mensagens rápidas.
 * (A lógica interna desta função permanece a mesma)
 */

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
