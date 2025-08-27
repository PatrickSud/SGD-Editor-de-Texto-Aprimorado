/**
 * @file service-worker.js
 * @description Background service worker para lidar com alarmes e notificações de lembretes.
 */

const REMINDERS_STORAGE_KEY = 'remindersData'

/**
 * Função auxiliar para buscar dados no storage.
 */
async function getReminders() {
  try {
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY)
    return result[REMINDERS_STORAGE_KEY] || {}
  } catch (error) {
    console.error('Service Worker: Erro ao carregar lembretes.', error)
    return {}
  }
}

// --- Listener de Mensagens (Comunicação com Content Scripts) ---

/**
 * Ouve mensagens para gerenciar alarmes, pois Content Scripts não têm acesso direto a chrome.alarms.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    try {
      if (message.action === 'SET_ALARM') {
        if (message.reminderId && message.alarmTime) {
          await chrome.alarms.create(message.reminderId, {
            when: message.alarmTime
          })
          sendResponse({ success: true })
        } else {
          sendResponse({
            success: false,
            error: 'Missing parameters for SET_ALARM.'
          })
        }
      } else if (message.action === 'CLEAR_ALARM') {
        if (message.reminderId) {
          await chrome.alarms.clear(message.reminderId)
          sendResponse({ success: true })
        } else {
          sendResponse({
            success: false,
            error: 'Missing parameter for CLEAR_ALARM.'
          })
        }
      } else {
        sendResponse({ success: false, error: 'Unknown action' })
      }
    } catch (error) {
      console.error(
        `Service Worker: Erro ao processar mensagem ${message.action}:`,
        error
      )
      sendResponse({ success: false, error: error.message })
    }
  })()

  // Retorna true para indicar que a resposta será enviada assincronamente.
  return true
})

// --- Lógica de Alarmes e Notificações ---

// Listener para quando um alarme é disparado
chrome.alarms.onAlarm.addListener(async alarm => {
  const reminderId = alarm.name
  if (!reminderId.startsWith('reminder-')) return

  const reminders = await getReminders()
  const reminder = reminders[reminderId]

  if (reminder) {
    // Atualiza o estado do lembrete para "disparado" e registra a hora.
    reminder.isFired = true
    reminder.firedAt = Date.now()
    // Salva no storage (para persistência na lista de gerenciamento)
    await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })
    showNotification(reminder)
  } else {
    console.warn(
      `Service Worker: Lembrete não encontrado no storage ao disparar alarme: ${reminderId}`
    )
  }
})

/**
 * Exibe a notificação nativa do Chrome (Simplificada).
 */
function showNotification(reminder) {
  const notificationId = reminder.id
  const hasUrl = reminder.url && reminder.url.startsWith('http')

  // Botões: [Abrir?], [Dispensar].
  const buttons = []
  if (hasUrl) {
    buttons.push({ title: 'Abrir Solicitação' }) // Index 0
  }
  buttons.push({ title: 'Dispensar' }) // Index 0 or 1

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'logo.png',
    title: reminder.title || 'Lembrete SGD',
    message: reminder.description || 'Verificar chamado agendado.',
    priority: 2,
    buttons: buttons,
    requireInteraction: true
  })
}

/**
 * Esta função apenas limpa a notificação visual e o alarme associado.
 * NÃO exclui o lembrete do storage. O lembrete permanece marcado como 'isFired'.
 */
async function clearNotificationAndAlarm(notificationId) {
  try {
    // Garante que o alarme seja limpo (embora já deva ter disparado)
    await chrome.alarms.clear(notificationId)
    // Limpa a notificação visualmente
    await chrome.notifications.clear(notificationId)
  } catch (error) {
    console.error(
      `Service Worker: Erro ao limpar notificação/alarme ${notificationId}:`,
      error
    )
  }
}

// Listener para cliques nos botões da notificação (Simplificado)
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('reminder-')) return

    const reminders = await getReminders()
    const reminder = reminders[notificationId]

    if (!reminder) {
      chrome.notifications.clear(notificationId)
      return
    }

    const hasUrl = reminder.url && reminder.url.startsWith('http')

    // Lógica de decisão simplificada.
    if (hasUrl) {
      if (buttonIndex === 0) {
        // Abrir Chamado
        chrome.tabs.create({ url: reminder.url })
      }
      // Se for index 1 (Dispensar) ou qualquer outro caso, apenas limpa.
    }
    // Se não tiver URL, buttonIndex === 0 é Dispensar

    // Em todos os casos de clique em botão, a notificação é limpa.
    await clearNotificationAndAlarm(notificationId)
  }
)

// Listener para clique no corpo da notificação
chrome.notifications.onClicked.addListener(async notificationId => {
  if (!notificationId.startsWith('reminder-')) return

  const reminders = await getReminders()
  const reminder = reminders[notificationId]

  if (reminder && reminder.url && reminder.url.startsWith('http')) {
    chrome.tabs.create({ url: reminder.url })
  }
  // Clicar no corpo sempre fecha a notificação (mas mantém o lembrete no storage).
  await clearNotificationAndAlarm(notificationId)
})

// Listener para quando a notificação é fechada manualmente
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  if (byUser && notificationId.startsWith('reminder-')) {
    // Apenas garante que o alarme e a notificação sejam limpos. O estado no storage permanece.
    await clearNotificationAndAlarm(notificationId)
  }
})
