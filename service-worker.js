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
  console.log(
    'Alarme disparado:',
    alarm.name,
    'às:',
    new Date().toLocaleString()
  )

  // --- LÓGICA DE SUGESTÃO ---
  if (alarm.name === 'analyze-usage') {
    console.log('Executando análise de uso...')
    await analyzeUsageAndSuggest()
    return
  }

  // --- LÓGICA DE LEMBRETES ---
  const reminderId = alarm.name
  if (!reminderId.startsWith('reminder-')) {
    console.log('Alarme não é um lembrete:', reminderId)
    return
  }

  console.log('Processando lembrete:', reminderId)

  const reminders = (await getStorageData(REMINDERS_STORAGE_KEY, 'sync')) || {}
  const reminder = reminders[reminderId]

  if (reminder) {
    console.log('Lembrete encontrado, exibindo notificação:', reminder.title)

    // Atualiza o estado do lembrete para "disparado" e registra a hora.
    reminder.isFired = true
    reminder.firedAt = Date.now()

    // Salva no storage (para persistência na lista de gerenciamento)
    await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })

    // Exibe a notificação
    showChromeNotification(reminder)
  } else {
    console.warn(
      `Service Worker: Lembrete não encontrado no storage ao disparar alarme: ${reminderId}`
    )
  }
})

/**
 * Exibe a notificação nativa do Chrome com configurações para forçar interação.
 */
function showChromeNotification(reminder) {
  const notificationId = reminder.id
  const hasUrl = reminder.url && reminder.url.startsWith('http')

  // Botões: [Abrir?], [Dispensar].
  const buttons = []
  if (hasUrl) {
    buttons.push({ title: 'Abrir Solicitação' }) // Index 0
  }
  buttons.push({ title: 'Dispensar' }) // Index 0 or 1

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
    console.log(
      'Botão clicado na notificação:',
      notificationId,
      'índice:',
      buttonIndex
    )

    if (!notificationId.startsWith('reminder-')) return

    const reminders =
      (await getStorageData(REMINDERS_STORAGE_KEY, 'sync')) || {}
    const reminder = reminders[notificationId]

    if (!reminder) {
      chrome.notifications.clear(notificationId)
      return
    }

    const hasUrl = reminder.url && reminder.url.startsWith('http')

    // Lógica corrigida para os botões
    if (hasUrl) {
      // Tem URL: [Abrir Solicitação] [Dispensar]
      if (buttonIndex === 0) {
        // Botão "Abrir Solicitação"
        console.log('Abrindo URL do lembrete:', reminder.url)
        chrome.tabs.create({ url: reminder.url })
      } else if (buttonIndex === 1) {
        // Botão "Dispensar" - apenas fecha a notificação
        console.log('Usuário dispensou a notificação - NÃO abrindo URL')
      }
    } else {
      // Não tem URL: [Dispensar]
      if (buttonIndex === 0) {
        // Botão "Dispensar" - apenas fecha a notificação
        console.log('Usuário dispensou a notificação')
      }
    }

    // Em todos os casos de clique em botão, a notificação é limpa.
    console.log('Usuário interagiu com a notificação, limpando...')
    await clearNotificationAndAlarm(notificationId)
  }
)

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
