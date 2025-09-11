/**
 * @file service-worker.js
 * @description Background service worker para lidar com alarmes e notificações de lembretes.
 */

const REMINDERS_STORAGE_KEY = 'remindersData'
const USAGE_TRACKING_KEY = 'usageTrackingData'
const SUGGESTED_TRAMITES_KEY = 'suggestedTramites'
const STORAGE_KEY = 'quickMessagesData' // Para acessar trâmites existentes
const SUGGESTION_THRESHOLD = 5
const MIN_SUGGESTION_LENGTH = 100

/**
 * Calcula a próxima data de um alarme recorrente.
 * @param {Date} lastDate A última data do alarme.
 * @param {string} recurrence A regra ('daily', 'weekly', 'monthly').
 * @returns {Date | null} A nova data ou null se não houver recorrência.
 */
function getNextRecurrenceDate(lastDate, recurrence) {
  const nextDate = new Date(lastDate.getTime())
  switch (recurrence) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1)
      return nextDate
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7)
      return nextDate
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1)
      return nextDate
    default:
      return null
  }
}

// --- CONTROLE DE EVENTOS DE NOTIFICAÇÃO ---
// Evita a dupla ativação de eventos de clique em notificações.
const handledNotifications = new Set()

/**
 * Transmite uma mensagem para todas as abas abertas do SGD.
 * @param {object} message - O objeto da mensagem a ser enviada.
 */
async function broadcastToSgdTabs(message) {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://sgd.dominiosistemas.com.br/*'
    })
    if (tabs.length > 0) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, message).catch(error => {
          // Ignora erros de portas desconectadas (abas que não têm o content script)
          if (
            !error.message.includes('Could not establish connection') &&
            !error.message.includes('Receiving end does not exist')
          ) {
            console.error(
              `Erro ao enviar mensagem para a aba ${tab.id}:`,
              error
            )
          }
        })
      })
    }
  } catch (error) {
    console.error('Erro ao consultar abas do SGD para transmissão:', error)
  }
}

// --- INICIALIZAÇÃO E ALARMES ---,

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

// É executado quando a extensão é instalada ou atualizada.
chrome.runtime.onInstalled.addListener(() => {
  console.log('Service Worker instalado. Configurando alarmes.')
  setupAlarms()
})

// É executado quando a extensão é iniciada
chrome.runtime.onStartup.addListener(() => {
  console.log('Service Worker iniciado. Configurando alarmes.')
  setupAlarms()
})

// Função para configurar alarmes
function setupAlarms() {
  // Cria o alarme para análise periódica.
  chrome.alarms.create('analyze-usage', {
    // Executa a primeira vez após 1 hora, e depois a cada 3 horas.
    delayInMinutes: 60,
    periodInMinutes: 180
  })

  console.log('Alarmes configurados: analyze-usage')

  // Lista todos os alarmes ativos para debug
  chrome.alarms.getAll(alarms => {
    console.log('Alarmes ativos:', alarms)
  })
}

/**
 * Função auxiliar para buscar dados de um storage específico (sync ou local).
 */
async function getStorageData(key, storageArea = 'sync') {
  return new Promise((resolve, reject) => {
    chrome.storage[storageArea].get(key, result => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError)
      }
      resolve(result[key])
    })
  })
}

// --- LÓGICA DE ANÁLISE DE SUGESTÕES ---

async function analyzeUsageAndSuggest() {
  console.log('Executando análise de uso para sugestão de trâmites...')

  // 1. Obter todos os dados necessários
  const usageData = (await getStorageData(USAGE_TRACKING_KEY, 'local')) || {
    hashes: {},
    content: {}
  }
  const quickMessagesData = (await getStorageData(STORAGE_KEY, 'sync')) || {
    messages: []
  }
  const existingSuggestions =
    (await getStorageData(SUGGESTED_TRAMITES_KEY, 'sync')) || []

  // 2. Criar um set de hashes dos trâmites rápidos já existentes para verificação rápida
  const existingTramiteHashes = new Set(
    quickMessagesData.messages.map(msg => simpleHash(msg.message))
  )
  const pendingSuggestionHashes = new Set(existingSuggestions.map(s => s.hash))

  const newSuggestions = []

  // 3. Iterar sobre os hashes rastreados
  for (const hash in usageData.hashes) {
    const count = usageData.hashes[hash]
    const content = usageData.content[hash]

    // 4. Aplicar regras para gerar uma sugestão
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
      console.log(
        `Nova sugestão encontrada (usada ${count} vezes): "${content.substring(
          0,
          50
        )}..."`
      )
    }
  }

  // 5. Salvar as novas sugestões, se houver
  if (newSuggestions.length > 0) {
    const allSuggestions = [...existingSuggestions, ...newSuggestions]
    await chrome.storage.sync.set({
      [SUGGESTED_TRAMITES_KEY]: allSuggestions
    })
    console.log(`${newSuggestions.length} nova(s) sugestão(ões) salva(s).`)
  } else {
    console.log('Nenhuma nova sugestão de trâmite encontrada.')
  }
}

// --- LISTENERS DE EVENTOS ---

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

// Listener para quando um alarme é disparado
chrome.alarms.onAlarm.addListener(async alarm => {
  // --- LÓGICA DE SUGESTÃO ---
  if (alarm.name === 'analyze-usage') {
    console.log('Executando análise de uso...')
    await analyzeUsageAndSuggest()
    return
  }

  // --- LÓGICA DE LEMBRETES ---
  const alarmName = alarm.name
  const isSnooze = alarmName.startsWith('snooze-')
  const reminderId = isSnooze ? alarmName.split('snooze-')[1] : alarmName

  if (!reminderId.startsWith('reminder-')) {
    console.log('Alarme não é um lembrete:', reminderId)
    return
  }

  const reminders = (await getStorageData(REMINDERS_STORAGE_KEY, 'sync')) || {}
  const reminder = reminders[reminderId]

  if (reminder) {
    showChromeNotification(reminder)

    // Ação 2: Envia a notificação para ser exibida dentro da página do SGD.
    try {
      const tabs = await chrome.tabs.query({
        url: 'https://sgd.dominiosistemas.com.br/*'
      })

      if (tabs.length > 0) {
        console.log(`Enviando lembrete para ${tabs.length} aba(s) do SGD.`)
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'SHOW_IN_PAGE_NOTIFICATION',
            reminder: reminder
          })
        })
      } else {
        console.log(
          'Nenhuma aba do SGD encontrada para exibir o lembrete em página.'
        )
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem para content script:', error)
    }

    // Se NÃO for soneca, processa a recorrência
    if (!isSnooze) {
      const nextDate = getNextRecurrenceDate(
        new Date(reminder.dateTime),
        reminder.recurrence
      )
      if (nextDate) {
        // Reagenda para a próxima ocorrência
        await chrome.alarms.create(reminder.id, {
          when: nextDate.getTime()
        })
        // Atualiza o storage com a nova data, mas mantém o estado original
        reminders[reminderId].dateTime = nextDate.toISOString()
      } else {
        // Se não houver recorrência, marca como disparado
        reminders[reminderId].isFired = true
        reminders[reminderId].firedAt = Date.now()
      }
    } else {
      // Se for soneca, apenas marca como disparado
      reminders[reminderId].isFired = true
      reminders[reminderId].firedAt = Date.now()
    }
    await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })
  } else {
    console.warn(`Lembrete com ID ${reminderId} não encontrado no storage.`)
  }
})

/**
 * Exibe a notificação nativa do Chrome com configurações para forçar interação.
 */
function showChromeNotification(reminder) {
  const notificationId = reminder.id
  const hasUrl = reminder.url && reminder.url.startsWith('http')

  // Botões: [Soneca], [Abrir?], [Dispensar].
  const buttons = [{ title: 'Soneca (10 min)' }] // Index 0
  if (hasUrl) {
    buttons.push({ title: 'Abrir Solicitação' }) // Index 1
  }
  buttons.push({ title: 'Dispensar' }) // Index 1 ou 2

  // Configurações para forçar a interação do usuário
  const notificationOptions = {
    type: 'basic',
    iconUrl: 'logo.png',
    title: reminder.title || 'Lembrete SGD',
    message: reminder.description || 'Verificar chamado agendado.',
    priority: 2, // Prioridade alta
    buttons: buttons,
    requireInteraction: true, // Força o usuário a interagir
    silent: false // Garante que haja som
  }

  // Tenta criar a notificação com retry em caso de falha
  const createNotification = () => {
    chrome.notifications.create(
      notificationId,
      notificationOptions,
      notificationId => {
        if (chrome.runtime.lastError) {
          console.error('Erro ao criar notificação:', chrome.runtime.lastError)
          // Retry após 1 segundo
          setTimeout(createNotification, 1000)
        } else {
          console.log('Notificação criada com sucesso:', notificationId)
        }
      }
    )
  }

  createNotification()
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

// Listener para cliques nos botões da notificação
chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('reminder-')) return

    const reminders =
      (await getStorageData(REMINDERS_STORAGE_KEY, 'sync')) || {}
    const reminder = reminders[notificationId]

    if (!reminder) {
      chrome.notifications.clear(notificationId)
      return
    }

    const hasUrl = reminder.url && reminder.url.startsWith('http')

    // Lógica ATUALIZADA para os botões
    if (buttonIndex === 0) {
      // Botão "Soneca"
      const snoozeTime = Date.now() + 10 * 60 * 1000 // 10 minutos a partir de agora
      // Cria um alarme específico para a soneca
      await chrome.alarms.create(`snooze-${notificationId}`, {
        when: snoozeTime
      })
      console.log(`Lembrete ${notificationId} adiado por 10 minutos.`)
    } else if (hasUrl) {
      // Tem URL: [Soneca] [Abrir Solicitação] [Dispensar]
      if (buttonIndex === 1) {
        // Botão "Abrir Solicitação"
        chrome.tabs.create({ url: reminder.url })
      }
    }

    // Em todos os casos de clique em botão, a notificação visual é limpa.
    await clearNotificationAndAlarm(notificationId)
  }
)

// Listener para quando a notificação é clicada diretamente (não nos botões)
chrome.notifications.onClicked.addListener(async notificationId => {
  // Ignora o clique se ele foi originado por um botão.
  if (handledNotifications.has(notificationId)) {
    return
  }

  console.log('Notificação clicada:', notificationId)

  if (!notificationId.startsWith('reminder-')) return

  const reminders = (await getStorageData(REMINDERS_STORAGE_KEY, 'sync')) || {}
  const reminder = reminders[notificationId]

  if (reminder && reminder.url && reminder.url.startsWith('http')) {
    console.log('Abrindo URL do lembrete via clique no corpo:', reminder.url)
    chrome.tabs.create({ url: reminder.url })
  }

  // Limpa a notificação após o clique
  await clearNotificationAndAlarm(notificationId)
})

// Listener para quando a notificação é fechada manualmente
chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
  console.log('Notificação fechada:', notificationId, 'por usuário:', byUser)

  if (notificationId.startsWith('reminder-')) {
    // Limpa o alarme e a notificação quando fechada
    await clearNotificationAndAlarm(notificationId)
  }
})

// Função auxiliar para hashing (duplicada aqui para independência do service worker)
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash
}
