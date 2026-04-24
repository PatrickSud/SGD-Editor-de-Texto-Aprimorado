/**
 * @file service-worker.js
 * Service worker de segundo plano para gerenciar alarmes, notificações e outras tarefas assíncronas.
 * Também contém a lógica de backend do Sugestor SS (autenticação e WebSocket com a Thomson Reuters).
 */

// ─────────────────────────────────────────
// SUGESTOR SS — Constantes e funções de autenticação/WebSocket
// Absorvidas do background.js do Sugestor SS (agora unificado neste plugin)
// ─────────────────────────────────────────

const CHAIN_SS_WORKFLOW_ID = '27921542-92d4-408a-a3cb-bb4372553e43'
const AI_PLATFORM_LOGIN_URL = 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/' + CHAIN_SS_WORKFLOW_ID
const WS_BASE_URL = 'wss://wymocw0zke.execute-api.us-east-1.amazonaws.com/prod'

/**
 * Verifica se um token JWT está expirado.
 * @param {string} token - O token JWT.
 * @returns {boolean} True se expirado ou inválido.
 */
function isTokenExpired(token) {
  if (!token) return true
  try {
    const decoded = JSON.parse(atob(token.split('.')[1]))
    return decoded.exp < Date.now() / 1000
  } catch {
    return true
  }
}

/**
 * Abre uma aba de login na plataforma Thomson Reuters e aguarda o token
 * ser extraído pelo token-extractor.js (injetado programaticamente pelo scripting API).
 * @returns {Promise<string>} O token de acesso extraído.
 */
function acquireTokenInteractively() {
  return new Promise((resolve, reject) => {
    let loginTabId = null

    console.log('[Sugestor SS] acquireTokenInteractively() iniciado.')

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(onMessage)
      chrome.tabs.onUpdated.removeListener(onTabUpdated)
      chrome.tabs.onRemoved.removeListener(onTabRemoved)
    }

    const onMessage = (message, sender) => {
      if (sender.tab?.id !== loginTabId) return
      cleanup()
      chrome.tabs.remove(loginTabId)
      if (message.action === 'tokenExtracted') {
        console.log('[Sugestor SS] Token extraído com sucesso!')
        resolve(message.token)
      } else {
        reject(new Error('Não foi possível extrair o token. Faça login novamente.'))
      }
    }

    const onTabUpdated = (tabId, changeInfo) => {
      if (tabId === loginTabId && changeInfo.status === 'complete') {
        console.log('[Sugestor SS] Aba de login carregou. Injetando token-extractor.js...')
        chrome.scripting.executeScript({
          target: { tabId: loginTabId },
          files: ['sugestor-ss/token-extractor.js']
        }).catch(err => {
          console.error('[Sugestor SS] Erro ao injetar token-extractor.js:', err.message)
          cleanup()
          reject(err)
        })
        chrome.tabs.onUpdated.removeListener(onTabUpdated)
      }
    }

    const onTabRemoved = (tabId) => {
      if (tabId === loginTabId) {
        cleanup()
        reject(new Error('Login cancelado pelo usuário.'))
      }
    }

    chrome.runtime.onMessage.addListener(onMessage)
    chrome.tabs.onUpdated.addListener(onTabUpdated)
    chrome.tabs.onRemoved.addListener(onTabRemoved)

    chrome.tabs.create({ url: AI_PLATFORM_LOGIN_URL, active: true }, (tab) => {
      loginTabId = tab.id
      console.log('[Sugestor SS] Aba de login criada. ID:', loginTabId)
    })
  })
}

/**
 * Garante que existe um token válido, renovando-o interativamente se necessário.
 * @returns {Promise<string>} O token de acesso válido.
 */
async function ensureValidToken() {
  const data = await chrome.storage.local.get('essoToken')
  let token = data.essoToken

  if (token && !isTokenExpired(token)) {
    console.log('[Sugestor SS] Reutilizando token salvo.')
    return token
  }

  console.log('[Sugestor SS] Token inválido ou expirado. Solicitando novo...')
  token = await acquireTokenInteractively()
  await chrome.storage.local.set({ essoToken: token })
  return token
}

/**
 * Executa a chamada à IA da Thomson Reuters via WebSocket e retorna o resultado
 * para a aba da SSC que iniciou a requisição.
 * @param {string} markdownSSC - O prompt montado pelo sugestor-ss.js.
 * @param {number} tabId - ID da aba que deve receber a resposta.
 */
async function handleGerarSugestao(markdownSSC, tabId) {
  try {
    const essoToken = await ensureValidToken()
    const API_URL = `${WS_BASE_URL}/?Authorization=${essoToken}`

    console.log('[Sugestor SS] Conectando via WebSocket...')
    const ws = new WebSocket(API_URL)
    let fullResponse = ''
    const startTime = Date.now()

    ws.onopen = () => {
      console.log('[Sugestor SS] WebSocket aberto. Enviando consulta...')
      ws.send(JSON.stringify({
        action: 'SendMessage',
        workflow_id: CHAIN_SS_WORKFLOW_ID,
        query: markdownSSC,
        is_persistence_allowed: false
      }))
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        for (const modelKey in data) {
          const modelValue = data[modelKey]
          if (typeof modelValue !== 'object' || modelValue === null) continue
          if ('answer' in modelValue && modelValue.answer) {
            fullResponse += modelValue.answer
          }
          if ('cost_track' in modelValue) {
            const tempo = Math.round((Date.now() - startTime) / 1000)
            console.log(`[Sugestor SS] ✅ Completo em ${tempo}s. Tamanho: ${fullResponse.length} chars`)
            chrome.tabs.sendMessage(tabId, { action: 'sugestaoCompleta', data: fullResponse })
            ws.close()
          }
        }
      } catch (err) {
        chrome.tabs.sendMessage(tabId, {
          action: 'sugestaoErro',
          data: `Erro ao processar resposta: ${err.message}`
        })
        ws.close()
      }
    }

    ws.onerror = () => {
      chrome.tabs.sendMessage(tabId, {
        action: 'sugestaoErro',
        data: 'Erro na conexão WebSocket. Verifique o console do Service Worker.'
      })
    }

    ws.onclose = (event) => {
      if (!event.wasClean && fullResponse === '') {
        let msg = `Conexão encerrada inesperadamente (Código: ${event.code}).`
        if (event.code === 1006) {
          chrome.storage.local.remove('essoToken')
          msg += '\n\nToken expirado. Clique novamente para renovar o login.'
        }
        chrome.tabs.sendMessage(tabId, { action: 'sugestaoErro', data: msg })
      }
    }

  } catch (err) {
    console.error('[Sugestor SS] Erro:', err)
    chrome.tabs.sendMessage(tabId, {
      action: 'sugestaoErro',
      data: `Erro de autenticação: ${err.message}`
    })
  }
}

// ─────────────────────────────────────────
// FIM DO BLOCO SUGESTOR SS
// ─────────────────────────────────────────

const REMINDERS_STORAGE_KEY = 'remindersData'
const GREETINGS_CLOSINGS_KEY = 'greetingsClosingsData'
const PENDING_POLL_ALARM = 'pending-poll'
const USAGE_TRACKING_KEY = 'usageTrackingData'
const SUGGESTED_TRAMITES_KEY = 'suggestedTramites'
const STORAGE_KEY = 'quickMessagesData'
const SUGGESTION_THRESHOLD = 5
const MIN_SUGGESTION_LENGTH = 100

// Configurações do Team Status (Firestore)
const TEAM_PROJECT_ID = 'sgd-extension';
const TEAM_API_KEY = 'AIzaSyBJgLpNfiycnIr-OybbfAOAuIa4ZU3nBbY';
const TEAM_STATUS_URL = `https://firestore.googleapis.com/v1/projects/${TEAM_PROJECT_ID}/databases/(default)/documents/team_status/current`;
const TEAM_STATUS_POLL_ALARM = 'team-status-poll';

// --- FUNÇÕES DE ARMAZENAMENTO (STORAGE) ---

/**
 * Busca dados de uma área de armazenamento do Chrome.
 * @param {string} key A chave a ser buscada.
 * @param {'sync' | 'local'} storageArea A área de armazenamento a ser usada.
 * @returns {Promise<any>} Os dados encontrados ou undefined.
 */
async function getStorageData(key, storageArea = 'local') {
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
async function setStorageData(key, value, storageArea = 'local') {
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
 * Exibe uma notificação do Chrome (Windows).
 * @param {object} reminder - O objeto do lembrete.
 */
function showChromeNotification(reminder) {
  const notificationId = `chrome-notification-${reminder.id}-${Date.now()}`

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'logo.png', // Caminho para o ícone da sua extensão
    title: `Lembrete: ${reminder.title}`,
    message: reminder.description || 'Você tem um novo lembrete.',
    priority: 2,
    buttons: [{ title: 'Dispensar' }],
    requireInteraction: true // Mantém a notificação visível até a interação do usuário
  })

  // Fecha automaticamente após 45 segundos (usando alarmes para garantir execução mesmo se o SW dormir)
  chrome.alarms.create(`dismiss-notification-${notificationId}`, {
    when: Date.now() + 45000
  })
}

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

/**
 * Verifica o status da equipe e dispara notificações para técnicos vigiados.
 * @param {Array} providedMembers - (Opcional) Array de membros já formatados
 */
async function checkTeamStatusAndNotify(providedMembers = null) {
  try {
    // 1. Busca preferências
    const prefs = await chrome.storage.local.get(['watchedTechnicians', 'lastAlerts', 'equipeATEnabled']);
    const watchedList = Array.isArray(prefs.watchedTechnicians) ? prefs.watchedTechnicians : [];
    
    // Se não houver ninguém vigiado, nem processa
    if (watchedList.length === 0) return;

    let members = providedMembers;

    // 2. Se não foi fornecido, busca do Firestore
    if (!members) {
      const response = await fetch(`${TEAM_STATUS_URL}?key=${TEAM_API_KEY}`);
      if (!response.ok) return;

      const doc = await response.json();
      const fields = doc.fields;
      if (fields?.members?.arrayValue?.values) {
        members = fields.members.arrayValue.values.map(v => {
          const f = v.mapValue?.fields || {};
          return {
            name: f.name?.stringValue || '',
            percentNotReady: parseFloat(f.percentNotReady?.doubleValue || f.percentNotReady?.integerValue || 0),
            percentFormatted: f.percentFormatted?.stringValue || '0 %'
          };
        });
      }
    }

    if (!members || !Array.isArray(members)) return;

    // 3. Verifica limites e dispara notificações
    const lastAlerts = prefs.lastAlerts || {};
    let updatedAlerts = false;
    const now = Date.now();

    members.forEach(m => {
      const key = m.name?.trim().toLowerCase().replace(/\s+/g, ' ') || '';
      if (watchedList.includes(key) && m.percentNotReady > 20) {
        const lastTime = lastAlerts[key] || 0;
        // Anti-spam: 10 minutos
        if (now - lastTime > 10 * 60 * 1000) {
          chrome.notifications.create(`team-watch-${key}-${now}`, {
            type: 'basic',
            iconUrl: 'logo.png',
            title: 'Alerta de Indisponibilidade',
            message: `${m.name} ultrapassou o limite crítico (${m.percentFormatted})!`,
            priority: 2
          });
          lastAlerts[key] = now;
          updatedAlerts = true;
          console.log(`[SW] Alerta disparado para: ${m.name}`);
        }
      }
    });

    if (updatedAlerts) {
      await chrome.storage.local.set({ lastAlerts });
    }
  } catch (error) {
    console.error('[SW] Erro ao verificar status da equipe:', error);
  }
}

// --- INICIALIZAÇÃO E LISTENERS DE EVENTOS DO CHROME ---

/**
 * Configura o alarme de verificação de pendências com distribuição aleatória.
 * Evita que todos os usuários façam requisições simultâneas.
 */
async function setupPendingPollAlarm() {
  const alarm = await chrome.alarms.get(PENDING_POLL_ALARM)
  if (!alarm) {
    const delayInMinutes = Math.random() * 15
    chrome.alarms.create(PENDING_POLL_ALARM, {
      delayInMinutes,
      periodInMinutes: 15
    })
  }

  // Alarme para monitoramento da equipe (Team Status)
  const teamAlarm = await chrome.alarms.get(TEAM_STATUS_POLL_ALARM)
  if (!teamAlarm) {
    chrome.alarms.create(TEAM_STATUS_POLL_ALARM, {
      delayInMinutes: 2, // Começa em 2 min
      periodInMinutes: 5  // Verifica a cada 5 min
    })
  }
}

/**
 * Configura alarmes essenciais na inicialização da extensão.
 */
async function setupInitialAlarms() {
  setupPendingPollAlarm()
  // Alarmes de análise de uso removidos

  // Recupera o ciclo de notificação de pendências do storage (caso o service worker tenha sido recarregado)
  try {
    const sessionData = await chrome.storage.session.get('lastPendingNotificationCycle')
    if (sessionData.lastPendingNotificationCycle) {
      pendingNotificationCycle = sessionData.lastPendingNotificationCycle
    }
  } catch (error) {
    console.error('Erro ao recuperar ciclo de notificação:', error)
  }
}

chrome.runtime.onInstalled.addListener(async details => {
  console.log('Service Worker: Extensão instalada/atualizada.')
  setupInitialAlarms()

  if (details.reason === 'update') {
    try {
      const data = await getStorageData(GREETINGS_CLOSINGS_KEY, 'sync')
      if (data && data.closings) {
        const hasAcessoRemoto = data.closings.some(
          c => c.title === 'Acesso Remoto'
        )

        if (!hasAcessoRemoto) {
          const newClosing = {
            id: `cls-${Date.now()}`,
            title: 'Acesso Remoto',
            content: `<b>Você sabia?! Nosso suporte via acesso remoto pode ser ainda mais ágil! <nobr style='font-size:20px;'>&#9757;</nobr></b><nobr style='font-size:20px;'>&#129299;</nobr> \n\nPesquise pela ferramenta “<b>Acesso Remoto - Domínio Sistemas</b>”, instalada em sua máquina: <img src="https://www.dropbox.com/scl/fi/495canzpdjs211hh6la45/acesso.gif?rlkey=5khplj8wi64db0xyv2rsrql5a&st=y923wzze&raw=1"  width="200" height="32" border="0" alt="iniciar"> \n\nou clique na imagem abaixo para baixar e instalar! \n\n<a href="https://download.dominiosistemas.com.br/Suporte/AcessoRemoto/LogMeInRescueCallingCard.msi" target="_blank"> \n\n<img src="https://www.dropbox.com/scl/fi/byeq2k2diaqq9wqv2sk3r/acesso_icon.png?rlkey=qky0l9byalcwojsi04xpq7o88&st=ybvth8cw&raw=1"  width="250" height="118" border="0" alt="acesso_remoto"></a> \n\n[finalizacao]! <nobr style='font-size:18px;'>&#10024;</nobr>`,
            shortcut: ''
          }
          data.closings.push(newClosing)
          await setStorageData(GREETINGS_CLOSINGS_KEY, data, 'sync')
          console.log(
            'Editor SGD: Encerramento "Acesso Remoto" adicionado para usuário existente.'
          )
        }
      }
    } catch (error) {
      console.error(
        'Editor SGD: Falha ao adicionar encerramento "Acesso Remoto" na atualização.',
        error
      )
    }
  }
})

chrome.runtime.onStartup.addListener(() => {
  console.log('Service Worker: Navegador iniciado.')
  setupInitialAlarms()
})

// Variável para controle de debounce de notificações genéricas
let lastGenericNotification = {
  hash: 0,
  timestamp: 0
}

// Variável para controle de notificações de pendências por ciclo
let pendingNotificationCycle = {
  cycleId: null,
  timestamp: 0
}

/**
 * Listener para mensagens do content script (para criar/limpar alarmes).
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ; (async () => {
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
      } else if (message.action === 'RESET_TOAST_FLAG' && message.reminderId) {
        // NOVA AÇÃO: Limpa o flag de notificação da sessão
        const toastShownKey = `toast_shown_${message.reminderId}`
        console.log('Resetando flag de notificação para:', toastShownKey)

        try {
          // Remove completamente o flag da sessão
          await chrome.storage.session.remove(toastShownKey)
          console.log('Flag removido com sucesso')
          sendResponse({ success: true })
        } catch (error) {
          console.error('Erro ao resetar flag:', error)
          sendResponse({ success: false, error: error.message })
        }
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
      } else if (message.action === 'SHOW_GENERIC_NOTIFICATION') {
        const contentString = (message.title || '') + (message.message || '')
        const currentHash = simpleHash(contentString)
        const now = Date.now()

        // Verifica se é uma notificação de pendências (pelo título)
        const isPendingNotification = message.title &&
          (message.title.includes('Pendências') || message.title.includes('Pendência'))

        if (isPendingNotification) {
          // Para notificações de pendências, verifica o ciclo de verificação
          // Recupera o ciclo atual do storage (caso o service worker tenha sido recarregado)
          const sessionData = await chrome.storage.session.get(['lastPendingNotificationCycle', 'pendingNotificationShown'])
          let storedCycle = sessionData.lastPendingNotificationCycle || pendingNotificationCycle
          const shownForCycle = sessionData.pendingNotificationShown

          // Se não há ciclo válido ou o ciclo expirou (mais de 30 segundos), cria um novo
          if (!storedCycle || !storedCycle.cycleId || (storedCycle.timestamp && (now - storedCycle.timestamp) > 30000)) {
            const newCycleId = `pending-check-${Date.now()}`
            storedCycle = {
              cycleId: newCycleId,
              timestamp: now
            }
            pendingNotificationCycle = storedCycle
            await chrome.storage.session.set({
              lastPendingNotificationCycle: storedCycle
            })
            console.log('Service Worker: Novo ciclo de verificação criado:', newCycleId)
          }

          // Se já foi exibida para este ciclo, ignora
          if (shownForCycle === storedCycle.cycleId) {
            console.log('Service Worker: Notificação de pendências já exibida para este ciclo:', storedCycle.cycleId)
            sendResponse({ success: true, ignored: true })
            return
          }

          // Verifica se o usuário permitiu notificações de pendências
          const settings = (await getStorageData('extensionSettingsData', 'sync')) || {}
          const preferences = settings.preferences || {}

          // Padrão é false (desabilitado) se não estiver definido
          const notificationsEnabled = preferences.enablePendingNotifications === true

          if (!notificationsEnabled) {
            console.log('Service Worker: Notificação de pendências silenciada pelo usuário.')
            sendResponse({ success: true, silenced: true })
            return
          }

          // Marca que a notificação foi exibida para este ciclo
          await chrome.storage.session.set({
            pendingNotificationShown: storedCycle.cycleId
          })

          const notificationId = `pending-${Date.now()}`

          // Exibe uma notificação genérica do sistema
          chrome.notifications.create(notificationId, {
            type: 'basic',
            iconUrl: 'logo.png',
            title: message.title,
            message: message.message,
            priority: 2,
            buttons: [
              { title: 'Visualizar' },
              { title: 'Dispensar' }
            ],
            requireInteraction: true // Mantém para controlar o tempo manualmente
          })

          // Fecha automaticamente após 60 segundos
          chrome.alarms.create(`dismiss-notification-${notificationId}`, {
            when: Date.now() + 60000
          })

          console.log('Service Worker: Notificação de pendências exibida para o ciclo:', storedCycle.cycleId)
          sendResponse({ success: true })
          return
        }

        // Para outras notificações genéricas, usa o debounce padrão
        // Debounce: Se a mesma notificação chegou há menos de 5 segundos, ignora
        if (
          lastGenericNotification.hash === currentHash &&
          now - lastGenericNotification.timestamp < 5000
        ) {
          console.log('Service Worker: Notificação genérica duplicada ignorada.')
          sendResponse({ success: true, ignored: true })
          return
        }

        lastGenericNotification = {
          hash: currentHash,
          timestamp: now
        }

        const notificationId = `generic-${Date.now()}`

        // Exibe uma notificação genérica do sistema
        chrome.notifications.create(notificationId, {
          type: 'basic',
          iconUrl: 'logo.png',
          title: message.title,
          message: message.message,
          priority: 2,
          buttons: [{ title: 'Dispensar' }],
          requireInteraction: true // Mantém para controlar o tempo manualmente
        })

        // Fecha automaticamente após 60 segundos
        chrome.alarms.create(`dismiss-notification-${notificationId}`, {
          when: Date.now() + 60000
        })

        sendResponse({ success: true })
      } else if (message.action === 'UPDATE_TEAM_STATUS') {
        // Handler para receber dados do Power BI Scraper (Master PC)
        try {
          const { members, timestamp, source } = message.data || {};

          if (!members || !Array.isArray(members)) {
            throw new Error('Dados inválidos: members deve ser um array.');
          }

          // Configuração do Firestore (mesmas credenciais do projeto)
          const TEAM_PROJECT_ID = 'sgd-extension';
          const TEAM_API_KEY = 'AIzaSyBJgLpNfiycnIr-OybbfAOAuIa4ZU3nBbY';
          const TEAM_STATUS_URL = `https://firestore.googleapis.com/v1/projects/${TEAM_PROJECT_ID}/databases/(default)/documents/team_status/current`;

          // Converte para formato do Firestore
          const firestoreData = {
            fields: {
              timestamp: { timestampValue: timestamp || new Date().toISOString() },
              source: { stringValue: source || 'power_bi_scraper' },
              members: {
                arrayValue: {
                  values: members.map(member => ({
                    mapValue: {
                      fields: {
                        name: { stringValue: member.name || '' },
                        percentNotReady: { doubleValue: member.percentNotReady || 0 },
                        percentFormatted: { stringValue: member.percentFormatted || '0 %' },
                        status: { stringValue: member.status || 'Normal' },
                        presence: { stringValue: member.presence || '' },
                        currentStatus: { stringValue: member.currentStatus || '' },
                        duration: { stringValue: member.duration || '' }
                      }
                    }
                  }))
                }
              }
            }
          };

          // Salva no Firestore
          const response = await fetch(`${TEAM_STATUS_URL}?key=${TEAM_API_KEY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firestoreData)
          });

          if (!response.ok) {
            const errorDetail = await response.json();
            throw new Error(`Erro ao salvar no Firestore: ${errorDetail.error?.message || response.statusText}`);
          }

          console.log(`Service Worker: Status da equipe atualizado com ${members.length} membros.`);
          
          // ALÉM DE SALVAR, verifica imediatamente se tem alertas para o Master PC
          checkTeamStatusAndNotify(members);

          sendResponse({ success: true, membersCount: members.length });
        } catch (error) {
          console.error('Service Worker: Erro ao atualizar status da equipe:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true; // Resposta assíncrona
      } else if (message.action === 'FETCH_FORMS_DATA') {
        // Nova ação para buscar dados do Gist via Service Worker (evita CORS da página)
        try {
          const url = message.url
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'SW fetch start', data: { url }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
          // #endregion

          const response = await fetch(url)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'SW fetch response', data: { ok: response.ok, status: response.status, statusText: response.statusText }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
          // #endregion

          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

          const text = await response.text()

          // Validar se o texto não está vazio e tem tamanho mínimo esperado
          if (!text || text.trim().length === 0) {
            throw new Error('Resposta do Gist está vazia')
          }

          // Verificar se o JSON parece estar completo (termina com } ou ])
          const trimmedText = text.trim()
          const lastChar = trimmedText[trimmedText.length - 1]
          if (lastChar !== '}' && lastChar !== ']') {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'JSON appears incomplete', data: { textLength: text.length, lastChar, last50Chars: trimmedText.substring(trimmedText.length - 50) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
            // #endregion
            throw new Error(`JSON do Gist parece estar incompleto (termina com '${lastChar}'). Verifique se o arquivo está completo no Gist.`)
          }

          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'SW response text received', data: { textLength: text.length, textPreview: text.substring(0, 200), last50Chars: text.substring(text.length - 50) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
          // #endregion

          // Tentar encontrar a linha 97 para debug
          const lines = text.split('\n')
          let data
          try {
            data = JSON.parse(text)
          } catch (parseError) {
            // Capturar contexto detalhado do erro
            const errorPos = parseError.message.match(/position (\d+)/)?.[1]
            const errorLine = parseError.message.match(/line (\d+)/)?.[1]
            const errorCol = parseError.message.match(/column (\d+)/)?.[1]

            const contextAround = errorLine ? {
              lineBefore: lines[parseInt(errorLine) - 2]?.substring(0, 150),
              lineError: lines[parseInt(errorLine) - 1]?.substring(0, 150),
              lineAfter: lines[parseInt(errorLine)]?.substring(0, 150),
              charAtPos: errorPos ? text[parseInt(errorPos)] : null,
              charBefore: errorPos ? text[parseInt(errorPos) - 1] : null,
              charAfter: errorPos ? text[parseInt(errorPos) + 1] : null
            } : null

            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'JSON parse error details', data: { error: parseError.message, position: errorPos, line: errorLine, column: errorCol, contextAround, totalLines: lines.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
            // #endregion

            // Melhorar mensagem de erro com contexto
            const improvedError = new Error(
              `Erro de sintaxe JSON no Gist na linha ${errorLine || 'desconhecida'}, coluna ${errorCol || 'desconhecida'}. ` +
              `Verifique se há vírgulas faltando ou elementos mal formatados. ` +
              `O sistema usará os dados locais como fallback.`
            )
            throw improvedError
          }
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'SW JSON parsed', data: { isArray: Array.isArray(data), hasCategories: !!data.categories, dataType: typeof data, keys: Object.keys(data || {}) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
          // #endregion

          sendResponse({ success: true, data: data })
        } catch (error) {
          console.error('Service Worker: Erro ao buscar forms data:', error)
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'service-worker.js:FETCH_FORMS_DATA', message: 'SW fetch error', data: { error: error.message, stack: error.stack }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
          // #endregion
          sendResponse({ success: false, error: error.message })
        }
        return true // Resposta assíncrona
      } else if (message.action === 'gerarSugestaoSS' && sender.tab?.id) {
        // ── Sugestor SS ──────────────────────────────────────────────────
        // Disparado quando o analista clica no botão da toolbar na ssc.html.
        // A resposta vai diretamente para a aba via chrome.tabs.sendMessage
        // (ações: sugestaoCompleta / sugestaoErro) — não usa sendResponse.
        handleGerarSugestao(message.markdownSSC, sender.tab.id)
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
  if (alarm.name === PENDING_POLL_ALARM) {
    // Alarme de verificação de pendências disparado
    // Cria um novo ciclo de verificação para evitar notificações duplicadas
    const cycleId = `pending-check-${Date.now()}`
    pendingNotificationCycle = {
      cycleId: cycleId,
      timestamp: Date.now()
    }
    // Salva o ciclo no storage para persistência entre recarregamentos do service worker
    await chrome.storage.session.set({
      lastPendingNotificationCycle: pendingNotificationCycle
    })
    console.log('Service Worker: Disparando verificação de pendências. Ciclo:', cycleId)
    broadcastToSgdTabs({ action: 'TRIGGER_PENDING_CHECK', cycleId: cycleId })
    return
  }

  if (alarm.name === TEAM_STATUS_POLL_ALARM) {
    // Monitoramento em segundo plano para todos os usuários
    checkTeamStatusAndNotify();
    return
  }

  if (alarm.name.startsWith('snooze-')) {
    // Lógica para soneca (se necessário) ou pode ser unificada
  }

  // Lógica para fechar notificação automaticamente
  if (alarm.name.startsWith('dismiss-notification-')) {
    const notificationId = alarm.name.replace('dismiss-notification-', '')
    chrome.notifications.clear(notificationId)
    return
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

  // Verifica se a notificação do Windows está habilitada
  const settings = (await getStorageData('extensionSettingsData', 'sync')) || {}
  const preferences = settings.preferences || {
    enableWindowsNotifications: true
  }

  if (preferences.enableWindowsNotifications) {
    showChromeNotification(reminder)
  }

  // Passo 3: Verifica se o toast de notificação único para esta sessão já foi exibido.
  const toastShownKey = `toast_shown_${reminder.id}`
  const sessionData = await chrome.storage.session.get(toastShownKey)

  console.log(
    'Verificando flag de notificação:',
    toastShownKey,
    'Valor:',
    sessionData[toastShownKey]
  )
  console.log(
    'Lembrete disparado em:',
    new Date(reminder.firedAt).toISOString()
  )

  // Verifica se a notificação já foi exibida para este disparo específico
  const lastShownTime = sessionData[toastShownKey]
  const currentFireTime = reminder.firedAt

  if (!lastShownTime || lastShownTime < currentFireTime) {
    // Se ainda não foi exibido para este disparo, define o flag de visualização...
    await chrome.storage.session.set({ [toastShownKey]: currentFireTime })
    // ...e então envia a mensagem para mostrar o toast.
    console.log('Exibindo notificação interna para lembrete:', reminder.id)
    broadcastToSgdTabs({ action: 'SHOW_IN_PAGE_NOTIFICATION', reminder })
  } else {
    console.log(
      'Notificação interna já foi exibida para este disparo do lembrete:',
      reminder.id
    )
  }
})

// Listener para cliques nos botões da notificação do Windows
chrome.notifications.onButtonClicked.addListener(
  (notificationId, buttonIndex) => {
    // Tratamento para notificações de Pendências (prefixo 'pending-')
    if (notificationId.startsWith('pending-')) {
      if (buttonIndex === 0) {
        // Botão "Visualizar"
        chrome.tabs.create({
          url: 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html?open_sgd_panel=true'
        })
        chrome.notifications.clear(notificationId)
      } else if (buttonIndex === 1) {
        // Botão "Dispensar"
        chrome.notifications.clear(notificationId)
      }
      return
    }

    // Tratamento para outras notificações genéricas (prefixo 'generic-')
    if (notificationId.startsWith('generic-')) {
      if (buttonIndex === 0) {
        // Botão "Dispensar"
        chrome.notifications.clear(notificationId)
      }
      return
    }

    // Tratamento para Lembretes (padrão antigo)
    if (buttonIndex === 0) {
      // Índice do botão "Dispensar"
      chrome.notifications.clear(notificationId)
    }
  }
)

// Listener para cliques no CORPO da notificação (Windows)
chrome.notifications.onClicked.addListener((notificationId) => {
  // Se clicar no corpo da notificação de pendências, age como o botão "Visualizar"
  if (notificationId.startsWith('pending-')) {
    chrome.tabs.create({
      url: 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html?open_sgd_panel=true'
    })
    chrome.notifications.clear(notificationId)
  }
})

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
