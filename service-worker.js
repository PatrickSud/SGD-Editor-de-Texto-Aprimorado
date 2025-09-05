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

// --- CONTROLE DE EVENTOS DE NOTIFICAÇÃO ---
// Evita a dupla ativação de eventos de clique em notificações.
const handledNotifications = new Set()

// --- INICIALIZAÇÃO E ALARMES ---,

/**
 * Função auxiliar para buscar dados no storage.
 */
async function getReminders() {
  try {
    const result = await browser.storage.sync.get(REMINDERS_STORAGE_KEY)
    return result[REMINDERS_STORAGE_KEY] || {}
  } catch (error) {
    console.error('Service Worker: Erro ao carregar lembretes.', error)
    return {}
  }
}

// É executado quando a extensão é instalada ou atualizada.
browser.runtime.onInstalled.addListener(() => {
  console.log('Service Worker instalado. Configurando alarmes.')
  setupAlarms()
})

// É executado quando a extensão é iniciada
browser.runtime.onStartup.addListener(() => {
  console.log('Service Worker iniciado. Configurando alarmes.')
  setupAlarms()
})

// Função para configurar alarmes
function setupAlarms() {
  // Cria o alarme para análise periódica.
  browser.alarms.create('analyze-usage', {
    // Executa a primeira vez após 1 hora, e depois a cada 3 horas.
    delayInMinutes: 60,
    periodInMinutes: 180
  })

  console.log('Alarmes configurados: analyze-usage')

  // Lista todos os alarmes ativos para debug
  browser.alarms.getAll(alarms => {
    console.log('Alarmes ativos:', alarms)
  })
}

/**
 * Função auxiliar para buscar dados de um storage específico (sync ou local).
 */
async function getStorageData(key, storageArea = 'sync') {
  return new Promise((resolve, reject) => {
    browser.storage[storageArea].get(key, result => {
      if (browser.runtime.lastError) {
        return reject(browser.runtime.lastError)
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
    await browser.storage.sync.set({
      [SUGGESTED_TRAMITES_KEY]: allSuggestions
    })
    console.log(`${newSuggestions.length} nova(s) sugestão(ões) salva(s).`)
  } else {
    console.log('Nenhuma nova sugestão de trâmite encontrada.')
  }
}

// --- LISTENERS DE EVENTOS ---

/**
 * Ouve mensagens para gerenciar alarmes, pois Content Scripts não têm acesso direto a browser.alarms.
 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    try {
      if (message.action === 'SET_ALARM') {
        if (message.reminderId && message.alarmTime) {
          await browser.alarms.create(message.reminderId, {
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
          await browser.alarms.clear(message.reminderId)
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
browser.alarms.onAlarm.addListener(async alarm => {
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
    console.log('Lembrete encontrado, enviando para a UI:', reminder.title)

    // Atualiza o estado do lembrete para "disparado" e registra a hora.
    reminder.isFired = true
    reminder.firedAt = Date.now()

    // Salva no storage (para persistência na lista de gerenciamento)
    await browser.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })

    // Nova Lógica: Envia a notificação para os content scripts nas abas do SGD
    try {
      const tabs = await browser.tabs.query({
        url: 'https://sgd.dominiosistemas.com.br/*'
      })

      if (tabs.length > 0) {
        console.log(`Enviando lembrete para ${tabs.length} aba(s) do SGD.`)
        tabs.forEach(tab => {
          browser.tabs.sendMessage(tab.id, {
            action: 'SHOW_IN_PAGE_NOTIFICATION',
            reminder: reminder
          })
        })
      } else {
        console.log('Nenhuma aba do SGD encontrada para exibir o lembrete.')
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem para content script:', error)
    }
  } else {
    console.warn(
      `Service Worker: Lembrete não encontrado no storage ao disparar alarme: ${reminderId}`
    )
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
