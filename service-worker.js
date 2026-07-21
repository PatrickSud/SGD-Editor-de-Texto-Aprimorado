/**
 * @file service-worker.js
 * Service worker de segundo plano para gerenciar alarmes, notificações e outras tarefas assíncronas.
 * Também contém a lógica de backend do Sugestor SS (autenticação e WebSocket com a Thomson Reuters).
 */

// ─── DEBUG LOGS (console do Service Worker) ────────────────────────────────
// Mesmo gate usado nas páginas de conteúdo (ver config.js), lido do mesmo
// chrome.storage.local para que "sgdDebug.ativar()" rodado no console da
// página do SGD também controle os logs "[AI WS]" daqui. Desativado por
// padrão. O console do Service Worker é acessado por chrome://extensions →
// "service worker" (não é o mesmo console da aba do SGD).
const SGD_DEBUG_STORAGE_KEY = 'sgdDebugLogsEnabled'
let sgdDebugLogsEnabled = false

chrome.storage.local.get([SGD_DEBUG_STORAGE_KEY]).then(res => {
  sgdDebugLogsEnabled = res[SGD_DEBUG_STORAGE_KEY] === true
}).catch(() => {})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, SGD_DEBUG_STORAGE_KEY)) {
    sgdDebugLogsEnabled = changes[SGD_DEBUG_STORAGE_KEY].newValue === true
  }
})

function sgdLog(...args) {
  if (sgdDebugLogsEnabled) console.log(...args)
}
function sgdWarn(...args) {
  if (sgdDebugLogsEnabled) console.warn(...args)
}

// ─────────────────────────────────────────
// SUGESTOR SS — Constantes e funções de autenticação/WebSocket
// Absorvidas do background.js do Sugestor SS (agora unificado neste plugin)
// ─────────────────────────────────────────

const CHAIN_SS_WORKFLOW_ID = '27921542-92d4-408a-a3cb-bb4372553e43'
const WS_BASE_URL = 'wss://wymocw0zke.execute-api.us-east-1.amazonaws.com/prod'
const AI_PLATFORM_LOGIN_URL = 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/' + CHAIN_SS_WORKFLOW_ID
const FALLBACK_WORKFLOW_ID = '4b95e35f-e8ea-44e6-ad74-555bf39be13f' // Chain genérica — fallback ESTOURO
const COMPARACAO_SSC_WORKFLOW_ID = FALLBACK_WORKFLOW_ID // Gemini Flash — mesma chain genérica/rápida

/**
 * Mapa de chains da plataforma de IA Thomson Reuters.
 * Chave: string exibida no select para o usuário.
 * Valor: workflow_id enviado ao WebSocket.
 *
 * Para adicionar uma nova chain: inclua uma nova entrada neste objeto.
 * Para remover: apague a entrada. A UI do select é gerada automaticamente.
 */
const AI_CHAINS = {
  'SGD Interno - Dúvidas gerais': '1cea8592-8748-47bd-8c4b-5318d6599045',
  'ÁREA TÉCNICA (Instalação, Atualização, Backup) - Dúvidas gerais': 'db7162a0-ad9b-4c19-85c4-315169a1ef43',
  'FISCONT - Buscador de Soluções e SA/NE': 'a84ee410-18f0-4f99-bc65-566b8340e6f8',
  'FISCONT - Assistente': 'f4e61162-241e-477b-851e-c28e1470b519',
  'FISCONT - Dúvidas sobre reforma tributária': 'dbc04d2e-4157-4369-b8af-2877a798dba1',
  'FISCONT - Kolossus Auditor': '0f1088b3-b410-468c-9039-00932d4c13df',
  'FOLHA - Dúvidas gerais (sem anexos)': '0a365547-b3e1-4008-bbbd-afee1596dcf6',
  'FOLHA - Rubricas com Fórmulas': 'b653d9c8-da78-4880-9347-e08a8c97c145',
  'FOLHA - Rubricas com Fórmulas (GPT 5.2)': '9692b101-98e8-4d62-9948-918e90904e31',
  'FOLHA - Consulta SA/NE Extrator DIRF': 'e68e988c-403d-4917-91e3-2b5344ac5e8a',
  'FOLHA - Analisador de arquivo de INSS': 'efb4ae5e-191c-4cbe-9a68-8ef4ed3497af',
  'CONTABILIDADE DIGITAL - Dúvidas gerais': 'af573701-d00c-4fac-89c8-0e7ea6af3434',
  'CONTABILIDADE - Análise erro ECF P200/P400': 'd66d4161-c01a-498a-95d8-229a4a884e26',
  'ESCRITA, CONTABILIDADE, LALUR E PATRIMÔNIO - Embasamento legal': '7e04fbb6-cdef-450f-89b5-d83c392583ab',
  'HONORÁRIOS, REGISTRO, PROTOCOLO, ADMINISTRAR, ATUALIZAR e CUSTOS - Dúvidas gerais e fórmulas': '01138fe4-aecd-48bc-a958-e8ef1006f487',
  'DOMÍNIO PROCESSOS - Dúvidas gerais': '98d8e94a-f795-44fe-aa86-ab8b4471e202',
  'DOMÍNIO MESSENGER - Dúvidas gerais': 'b787e0c7-2608-4ae6-97e5-b128c205c194',
  'DOMÍNIO COBRANÇAS - Dúvidas gerais': '26858ea4-9ffd-479a-8125-5f127341d34d',
  'ONVIO GESTÃO/PORTAL DO CLIENTE - Dúvidas gerais': 'ec6d18b1-955b-426a-a34d-622065fd982a',
  'ONBALANCE, CCT, BUSCA, SEFAZ, API - Dúvidas gerais': 'bdcf2679-98c5-4201-98bd-2c53ee07e63e',
  'NOVO PORTAL DO EMPREGADO (Domínio Para Você) - Dúvidas Gerais': '9631a5ff-16d7-4f9b-b3f4-28f5562b8749',
  'PERFORMANCE - Dúvidas Gerais': 'b2a13bb9-d13a-42d8-ad98-a77cd2a8eb10',
  'ASSISTENTE - Dúvidas conceituais': '32b16228-9d6f-4bf6-b9ce-18ea59c2095d',
  'ASSISTENTE SUPORTE - Padrões e assuntos por fila': 'bf79bed3-d1f2-4b9c-b08a-a7c0551eb4dc',
  'ASSISTENTE - Manual Cadastro de SSs': '27921542-92d4-408a-a3cb-bb4372553e43',
  'ASSISTENTE: Cadastro de SA/NE': '3ef5f8c0-721e-4ee1-bf3a-48e37ec9f9e2',
  'LISTAGEM DE SANES E SAILS - GERAL': 'cb5f81b8-40eb-4f61-b155-e70a51525103',
  'APOIO AO SUPORTE - Boas práticas telefone/laptop': '4f0e3f37-e63f-4188-8c15-373eb75c77c8',
  'GERADOR DE RELATÓRIOS - Criar arquivo BGR com consultas SQL': 'c5c03c64-1577-4e1d-bf7a-61723a450449',
  'GERADOR DE RELATÓRIOS - Criação de Computados': '7459b824-1a6b-4548-9a3a-6716e1dc5a79',
}

const GPT55_WORKFLOW_ID = '3a875be6-996a-4a44-b78d-d9aa2584f9a4'
const EXPERIENCE_IDS = [GPT55_WORKFLOW_ID] // IDs que usam SendMessageV3
const ROUTER_WORKFLOW_ID = '10a5378c-8777-4217-9cae-6b5a1dbfdb14'

/**
 * Mapa de classificação da chain roteadora → workflow_id da chain de destino.
 * A chave é exatamente o valor do campo "classificacao" retornado pelo JSON da roteadora.
 */
const ROUTER_CHAIN_MAP = {
  'FILA 41': '98d8e94a-f795-44fe-aa86-ab8b4471e202', // DOMÍNIO PROCESSOS
  'FILA 42': 'b787e0c7-2608-4ae6-97e5-b128c205c194', // DOMÍNIO MESSENGER
  'REFORMA TRIBUTÁRIA': 'dbc04d2e-4157-4369-b8af-2877a798dba1', // FISCONT - Reforma Tributária
  'DOMINIO COBRANÇAS': '26858ea4-9ffd-479a-8125-5f127341d34d', // DOMÍNIO COBRANÇAS
  'FILA 61': '01138fe4-aecd-48bc-a958-e8ef1006f487', // HONORÁRIOS
  'FILA 5': 'db7162a0-ad9b-4c19-85c4-315169a1ef43', // ÁREA TÉCNICA
  'FILA 3': 'ec6d18b1-955b-426a-a34d-622065fd982a', // ONVIO GESTÃO/PORTAL DO CLIENTE
  'CONTABILIDADE DIGITAL': 'af573701-d00c-4fac-89c8-0e7ea6af3434', // CONTABILIDADE DIGITAL
  'FILA 62': 'bdcf2679-98c5-4201-98bd-2c53ee07e63e', // ONBALANCE, CCT, BUSCA, SEFAZ, API
  'DOMINIO PARA VOCÊ': '9631a5ff-16d7-4f9b-b3f4-28f5562b8749', // NOVO PORTAL DO EMPREGADO
  'CONTABILIDADE ECF': 'd66d4161-c01a-498a-95d8-229a4a884e26', // CONTABILIDADE - Análise ECF
  'FOLHA': '0a365547-b3e1-4008-bbbd-afee1596dcf6', // FOLHA - Dúvidas gerais
  'PERFORMANCE': 'f7ff4d6f-1847-463b-a6be-acc122a0fe01', // PERFORMANCE
  'FISCONT KOLOSSUS': '0f1088b3-b410-468c-9039-00932d4c13df', // KOLOSSUS
  'FISCONT': 'f4e61162-241e-477b-851e-c28e1470b519', // FISCONT - ASSISTENTE
  'ESTOURO': null, // Sem chain — dispara erro de fallback
}

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
 * Executa a chamada à IA da Thomson Reuters via WebSocket.
 *
 * @param {string} prompt      - O conteúdo a enviar para a chain.
 * @param {number} tabId       - ID da aba que deve receber a resposta.
 * @param {string} workflowId  - O workflow_id da chain a ser acionada.
 * @param {string} successAction - Nome da action enviada de volta em caso de sucesso.
 * @param {string} errorAction   - Nome da action enviada de volta em caso de erro.
 */
async function handleGerarSugestao(prompt, tabId, workflowId, successAction = 'sugestaoCompleta', errorAction = 'sugestaoErro') {
  try {
    const essoToken = await ensureValidToken()
    const API_URL = `${WS_BASE_URL}/?Authorization=${essoToken}`

    sgdLog(`[AI WS] Conectando via WebSocket. workflow_id: ${workflowId}`)
    const ws = new WebSocket(API_URL)
    let fullResponse = ''
    const startTime = Date.now()

    const isV3 = EXPERIENCE_IDS.includes(workflowId)
    ws.onopen = () => {
      sgdLog('[AI WS] WebSocket aberto. Enviando consulta...')
      ws.send(JSON.stringify({
        action: isV3 ? 'SendMessageV3' : 'SendMessage',
        workflow_id: workflowId,
        query: prompt,
        is_persistence_allowed: false,
        ...(isV3 && { conversation_id: null })
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
            sgdLog(`[AI WS] ✅ Completo em ${tempo}s. Tamanho: ${fullResponse.length} chars`)
            chrome.tabs.sendMessage(tabId, { action: successAction, data: fullResponse })
            ws.close()
          }
        }
      } catch (err) {
        chrome.tabs.sendMessage(tabId, {
          action: errorAction,
          data: `Erro ao processar resposta: ${err.message}`
        })
        ws.close()
      }
    }

    ws.onerror = () => {
      chrome.tabs.sendMessage(tabId, {
        action: errorAction,
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
        chrome.tabs.sendMessage(tabId, { action: errorAction, data: msg })
      }
    }

  } catch (err) {
    console.error('[AI WS] Erro:', err)
    chrome.tabs.sendMessage(tabId, {
      action: errorAction,
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

// Configurações de Avisos (Firebase Realtime Database)
const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com';
const RTDB_WARNINGS_META_URL = `${RTDB_BASE_URL}/metadata/warnings`;
// Nó de versão minúsculo (apenas um timestamp): o poll lê só este valor a cada ciclo
// e só baixa o metadata detalhado + avisos quando a versão muda. Reduz drasticamente
// o download do RTDB, sem afetar a entrega de avisos.
const RTDB_WARNINGS_VERSION_URL = `${RTDB_BASE_URL}/metadata/warnings_version`;
const RTDB_WARNINGS_URL = `${RTDB_BASE_URL}/warnings`;
const WARNINGS_POLL_ALARM = 'warnings-poll';
// Rede de segurança: força uma verificação completa (ignora o atalho de versão)
// a cada 60 min, garantindo consistência mesmo se o nó de versão dessincronizar.
const WARNINGS_POLL_FULL_CHECK_MS = 60 * 60 * 1000;
// Janela de horário do poll de avisos (economia de cota): evita verificações de madrugada.
const WARNINGS_POLL_START_HOUR = 6;  // inclusive
const WARNINGS_POLL_END_HOUR = 23;   // exclusive

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
  try {
    const localResult = await getStorageData(REMINDERS_STORAGE_KEY, 'local')
    if (localResult) return localResult

    const syncResult = await getStorageData(REMINDERS_STORAGE_KEY, 'sync')
    if (syncResult) {
      await setStorageData(REMINDERS_STORAGE_KEY, syncResult, 'local')
      await chrome.storage.sync.remove(REMINDERS_STORAGE_KEY)
      return syncResult
    }
    return {}
  } catch (error) {
    console.error('Erro ao buscar lembretes:', error)
    return {}
  }
}

/**
 * Salva o objeto de lembretes no armazenamento.
 * @param {object} reminders O objeto de lembretes a ser salvo.
 */
async function saveReminders(reminders) {
  await setStorageData(REMINDERS_STORAGE_KEY, reminders, 'local')
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

// ─────────────────────────────────────────
// IAplug — Janela dedicada do assistente Tria
// O assistente não funciona dentro de um iframe (detecção de frame no lado da
// Tria), então é aberto em uma janela própria do navegador (tipo "popup"/app),
// onde a Tria volta a ser a página principal e funciona normalmente.
// ─────────────────────────────────────────
const IAPLUG_BOUNDS_KEY = 'iaplugWindowBounds'
const IAPLUG_DEFAULT_BOUNDS = { width: 460, height: 780 }
// Guarda windowId/tabId/region também em chrome.storage.session porque o
// service worker do MV3 é encerrado após ~30s de inatividade, zerando estas
// variáveis em memória mesmo com a janela do IAplug ainda aberta. Sem isso, ao
// clicar no ícone depois de um tempo parado, isIAplugWindowOpen() concluía
// (errado) que não havia janela e abria uma segunda janela duplicada.
const IAPLUG_SESSION_KEY = 'iaplugWindowSession'
let iaplugWindowId = null
let iaplugTabId = null
let iaplugRegion = 'SUL'

/**
 * Persiste o estado atual da janela do IAplug em chrome.storage.session, para
 * sobreviver a um reinício do service worker.
 */
async function saveIAplugSessionState() {
  try {
    await chrome.storage.session.set({
      [IAPLUG_SESSION_KEY]: { windowId: iaplugWindowId, tabId: iaplugTabId, region: iaplugRegion }
    })
  } catch (e) {
    /* Ignora falha ao persistir; pior caso volta ao bug antigo. */
  }
}

/**
 * Limpa o estado persistido da janela do IAplug.
 */
async function clearIAplugSessionState() {
  try {
    await chrome.storage.session.remove(IAPLUG_SESSION_KEY)
  } catch (e) {
    /* Ignora. */
  }
}

/**
 * Injeta via chrome.scripting um MutationObserver para manter o título da janela personalizado.
 */
function injectIAplugTitle(tabId, regionName) {
  if (!tabId) return
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (region) => {
      const expectedTitle = `TRIA - IAplug - [${region}]`
      document.title = expectedTitle
      
      // Remove observer antigo se houver
      if (window.iaplugTitleObserver) {
        window.iaplugTitleObserver.disconnect()
      }
      
      // Monitora mudanças no título
      window.iaplugTitleObserver = new MutationObserver(() => {
        if (document.title !== expectedTitle) {
          document.title = expectedTitle
        }
      })
      
      const titleEl = document.querySelector('title')
      if (titleEl) {
        window.iaplugTitleObserver.observe(titleEl, { childList: true })
      } else {
        window.iaplugTitleObserver.observe(document.documentElement, {
          subtree: true,
          childList: true
        })
      }
    },
    args: [regionName]
  }).catch(err => console.warn('[IAplug] Falha ao injetar script de título:', err))
}

/**
 * Verifica se a janela do IAplug ainda existe.
 * @returns {Promise<boolean>}
 */
async function isIAplugWindowOpen() {
  // O service worker pode ter sido reiniciado (idle) desde a última abertura,
  // zerando iaplugWindowId mesmo com a janela real ainda aberta. Antes de
  // concluir "não há janela", tenta recuperar o último estado salvo.
  if (iaplugWindowId === null) {
    try {
      const data = await chrome.storage.session.get([IAPLUG_SESSION_KEY])
      const saved = data[IAPLUG_SESSION_KEY]
      if (saved && typeof saved.windowId === 'number') {
        iaplugWindowId = saved.windowId
        iaplugTabId = typeof saved.tabId === 'number' ? saved.tabId : null
        iaplugRegion = saved.region || iaplugRegion
      }
    } catch (e) {
      /* Sem estado salvo; segue como "não há janela". */
    }
  }

  if (iaplugWindowId === null) return false

  try {
    await chrome.windows.get(iaplugWindowId)
    return true
  } catch (e) {
    // A janela foi fechada sem disparar o onRemoved capturado; normaliza o estado.
    iaplugWindowId = null
    iaplugTabId = null
    clearIAplugSessionState()
    return false
  }
}

/**
 * Abre a janela dedicada do IAplug ou, se já estiver aberta, traz para frente
 * (restaurando-a caso esteja minimizada). Lembra o tamanho/posição/estado entre
 * aberturas.
 * @param {string} url - URL do assistente.
 * @param {string|null} [regionKey] - Chave do link resolvido (sul/sudeste/at/custom),
 *   quando disponível. Usada para o título da janela em vez de tentar adivinhar
 *   a região comparando URLs, o que falha quando dois links compartilham a
 *   mesma URL (ex.: "AT" hoje reaproveita a URL do "Sul").
 * @param {string|null} [regionLabel] - Label configurado do link (ex.: "AT").
 * @returns {Promise<boolean>} true se a janela está aberta ao final.
 */
async function openOrFocusIAplugWindow(url, regionKey, regionLabel) {
  if (await isIAplugWindowOpen()) {
    try {
      await chrome.windows.update(iaplugWindowId, {
        focused: true,
        drawAttention: true,
        state: 'normal'
      })
    } catch (e) {
      /* Ignora; a janela pode ter fechado nesse instante. */
    }
    return true
  }

  // Recupera tamanho/posição/estado salvos (ou usa o padrão).
  let bounds = { ...IAPLUG_DEFAULT_BOUNDS }
  try {
    const data = await chrome.storage.local.get([IAPLUG_BOUNDS_KEY])
    const saved = data[IAPLUG_BOUNDS_KEY]
    if (saved && typeof saved === 'object') bounds = saved
  } catch (e) {
    /* Usa o padrão. */
  }

  const createData = {
    url: url || 'https://tria.plugsocial.online/',
    type: 'popup',
    focused: true
  }

  // Restaura o último estado do usuário: maximizado ou tamanho/posição normais.
  if (bounds.state === 'maximized') {
    createData.state = 'maximized'
  } else {
    createData.width = typeof bounds.width === 'number' ? bounds.width : IAPLUG_DEFAULT_BOUNDS.width
    createData.height = typeof bounds.height === 'number' ? bounds.height : IAPLUG_DEFAULT_BOUNDS.height
    if (typeof bounds.left === 'number' && typeof bounds.top === 'number') {
      createData.left = bounds.left
      createData.top = bounds.top
    }
  }

  try {
    const win = await chrome.windows.create(createData)
    iaplugWindowId = win.id
    if (win.tabs && win.tabs[0]) {
      iaplugTabId = win.tabs[0].id

      if (regionLabel) {
        // Caminho preferido: o content script já resolveu a chave/label do
        // link (via getIAplugLinkInfo) e nos diz exatamente qual região exibir.
        // Necessário porque links diferentes podem apontar para a mesma URL
        // (ex.: "AT" reaproveitando a URL do "Sul") — nesse caso comparar por
        // URL não distingue a região certa.
        iaplugRegion = String(regionLabel).toUpperCase()
      } else {
        // Fallback (mensagens antigas/sem regionLabel): tenta adivinhar pela URL.
        const localData = await chrome.storage.local.get(['remoteConfig'])
        const remoteConfig = localData.remoteConfig || {}
        const urlSul = remoteConfig.iagente_url_sul || 'https://tria.plugsocial.online/?assunto=sped&codigoCliente=96797&identificacaoRevenda=3'
        const urlSudeste = remoteConfig.iagente_url_sudeste

        if (url === urlSudeste) {
          iaplugRegion = 'SUDESTE'
        } else if (url === urlSul) {
          iaplugRegion = 'SUL'
        } else {
          iaplugRegion = url.includes('identificacaoRevenda=3') ? 'SUL' : 'SUDESTE'
        }
      }

      injectIAplugTitle(iaplugTabId, iaplugRegion)
    }
    await saveIAplugSessionState()
    broadcastToSgdTabs({ action: 'IAPLUG_WINDOW_STATE', open: true })
    return true
  } catch (e) {
    console.error('[IAplug] Erro ao abrir a janela dedicada:', e)
    return false
  }
}

// Salva tamanho/posição/estado sempre que o usuário move, redimensiona ou
// maximiza a janela — para reabrir exatamente como o usuário deixou.
if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener(win => {
    if (win.id !== iaplugWindowId) return
    // Não persiste o estado minimizado (não queremos reabrir minimizado).
    if (win.state === 'minimized') return
    chrome.storage.local.set({
      [IAPLUG_BOUNDS_KEY]: {
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
        state: win.state
      }
    }).catch(() => {})
  })
}

// Detecta o fechamento da janela para sincronizar o botão em todas as abas do SGD.
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId !== iaplugWindowId) return
  iaplugWindowId = null
  iaplugTabId = null
  clearIAplugSessionState()
  broadcastToSgdTabs({ action: 'IAPLUG_WINDOW_STATE', open: false })
})

// Escuta atualizações de abas para manter o título injetado durante carregamentos/reloads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === iaplugTabId && (changeInfo.status === 'loading' || changeInfo.status === 'complete')) {
    injectIAplugTitle(tabId, iaplugRegion)
  }
})

// Escuta remoção da aba do IAplug
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === iaplugTabId) {
    iaplugTabId = null
    saveIAplugSessionState()
  }
})

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
          broadcastToSgdTabs({
            action: 'SHOW_TOAST',
            id: `team-watch-${key}-${now}`,
            title: 'Alerta de Indisponibilidade',
            message: `${m.name} ultrapassou o limite crítico (${m.percentFormatted})!`,
            type: 'alert'
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

const WARNING_CHANNELS = [
  'Geral',
  'AT',
  'Onvio',
  'Dominio Processos/Messenger',
  'Folha de pagamento',
  'Escrita Fiscal',
  'Contabilidade',
  'Serviços Digitais',
  'Fila 61',
  'Fila 62'
];

/**
 * Verifica se há novos avisos na Central de Informações via Firestore REST API
 */
function safeFirebaseKey(str) {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9]/g, '_') // Substitui não-alfanuméricos por _
    .replace(/_+/g, '_'); // Evita múltiplos _
}

async function touchWarningsMetadata(warningDataOrArray) {
  try {
    const now = new Date().toISOString();
    const patchData = { lastUpdated: now };
    const allChannels = [
      'Geral', 'AT', 'Onvio', 'Dominio Processos/Messenger',
      'Folha de pagamento', 'Escrita Fiscal', 'Contabilidade',
      'Serviços Digitais', 'Fila 61', 'Fila 62'
    ];
    const dataArray = Array.isArray(warningDataOrArray) ? warningDataOrArray : [warningDataOrArray];
    let hasValidData = false;

    for (const data of dataArray) {
      if (data) {
        hasValidData = true;
        if (data.isTest) {
          patchData.lastTestUpdated = now;
        } else if (data.targetUsers && Array.isArray(data.targetUsers) && data.targetUsers.length > 0) {
          for (const user of data.targetUsers) {
            const userKey = safeFirebaseKey(user);
            if (userKey) {
              patchData[`user_${userKey}`] = now;
            }
          }
        } else if (data.channel) {
          const channelKey = safeFirebaseKey(data.channel);
          if (channelKey) {
            patchData[`channel_${channelKey}`] = now;
          }
        } else {
          patchData.lastTestUpdated = now;
          for (const ch of allChannels) {
            patchData[`channel_${safeFirebaseKey(ch)}`] = now;
          }
        }
      }
    }

    if (!hasValidData) {
      patchData.lastTestUpdated = now;
      for (const ch of allChannels) {
        patchData[`channel_${safeFirebaseKey(ch)}`] = now;
      }
    }

    await fetch(`${RTDB_WARNINGS_META_URL}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchData)
    });

    // Atualiza o nó de versão (atalho de polling). Qualquer alteração em avisos
    // bump-a este valor, fazendo os clientes detectarem a mudança lendo poucos bytes.
    await fetch(`${RTDB_WARNINGS_VERSION_URL}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(now)
    }).catch(() => {});
  } catch (e) { console.warn('Falha meta avisos:', e); }
}

async function checkWarningsAndNotify(respectSchedule = true) {
  try {
    // 0. Janela de horário: evita polls de rotina na madrugada (economia de cota RTDB).
    // Não se aplica a verificações sob demanda (ex.: editor acabou de criar um aviso),
    // garantindo entrega imediata de avisos urgentes a qualquer hora.
    if (respectSchedule) {
      const hourNow = new Date().getHours();
      if (hourNow < WARNINGS_POLL_START_HOUR || hourNow >= WARNINGS_POLL_END_HOUR) return;
    }

    const storage = await chrome.storage.local.get([
      'warningsMetaSignature',
      'infoDevMode',
      'currentUser',
      'subscribedChannels',
      'allowedChannels',
      'warningChannels',
      'isCurrentUserEditor',
      'warningsVersionSeen',
      'warningsLastFullCheck'
    ]);
    const localSignature = storage.warningsMetaSignature;

    // 0.1 Atalho de versão: lê um nó minúsculo (apenas um timestamp). Se a versão do
    // servidor não mudou desde a última verificação, encerra sem baixar metadata/avisos.
    // A cada WARNINGS_POLL_FULL_CHECK_MS força uma verificação completa (rede de segurança).
    let serverVersion = null;
    try {
      const verResp = await fetch(`${RTDB_WARNINGS_VERSION_URL}.json`, { cache: 'no-store' });
      if (verResp.ok) serverVersion = await verResp.json();
    } catch (e) { /* sem versão: cai na verificação completa abaixo */ }

    const lastFullCheck = storage.warningsLastFullCheck || 0;
    const mustFullCheck = (Date.now() - lastFullCheck) > WARNINGS_POLL_FULL_CHECK_MS;
    if (!mustFullCheck && serverVersion != null && serverVersion === storage.warningsVersionSeen) {
      return;
    }

    // 1. Checa a data de última atualização (Metadado) via Realtime Database
    const metaResponse = await fetch(`${RTDB_WARNINGS_META_URL}.json`, { cache: 'no-store' });
    if (!metaResponse.ok) return;

    const metaDoc = await metaResponse.json();
    if (!metaDoc) return;

    const isDevMode = !!(storage.infoDevMode);
    const isEditor = !!(storage.infoDevMode || storage.isCurrentUserEditor);
    const currentChannels = storage.warningChannels || WARNING_CHANNELS;
    const subscribed = storage.subscribedChannels ? [...storage.subscribedChannels] : [...currentChannels];
    let allowed = storage.allowedChannels ? [...storage.allowedChannels] : ['Geral'];

    if (!isEditor && allowed.length >= currentChannels.length) {
      allowed = ['Geral'];
    }

    let hasChanges = false;
    if (typeof localSignature !== 'object' || !localSignature) {
      hasChanges = true;
    } else {
      if (isDevMode && metaDoc.lastTestUpdated !== localSignature.lastTestUpdated) {
        hasChanges = true;
      }
      if (!hasChanges && storage.currentUser) {
        const userKey = `user_${safeFirebaseKey(storage.currentUser)}`;
        if (metaDoc[userKey] !== localSignature[userKey]) {
          hasChanges = true;
        }
      }
      if (!hasChanges) {
        const activeSubscribedChannels = subscribed.filter(c => allowed.includes(c));
        for (const channel of activeSubscribedChannels) {
          const key = `channel_${safeFirebaseKey(channel)}`;
          if (metaDoc[key] !== localSignature[key]) {
            hasChanges = true;
            break;
          }
        }
      }
      // Fallback se não há chaves específicas (compatibilidade com registros antigos)
      const hasSpecificKeys = Object.keys(metaDoc).some(k => k.startsWith('channel_') || k.startsWith('user_') || k === 'lastTestUpdated');
      if (!hasSpecificKeys && metaDoc.lastUpdated !== localSignature.lastUpdated) {
        hasChanges = true;
      }
    }

    // Se não houve alteração relevante para este usuário, encerra.
    // Registra a versão avaliada para não reprocessar o metadata no próximo ciclo.
    if (!hasChanges) {
      await chrome.storage.local.set({
        warningsVersionSeen: serverVersion,
        warningsLastFullCheck: Date.now()
      });
      return;
    }

    // 2. Se a assinatura mudou, busca os últimos avisos (20 para cachear)
    const response = await fetch(`${RTDB_WARNINGS_URL}.json?orderBy="date"&limitToLast=20`, { cache: 'no-store' });
    if (!response.ok) return;

    const result = await response.json();
    if (!result || typeof result !== 'object') return;

    // Realtime DB retorna objeto { "-id1": { ... }, "-id2": { ... } }
    // Converte para array e ordena por data (mais recente primeiro)
    const warnings = Object.entries(result).map(([id, data]) => ({ id, ...data }));
    warnings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (warnings.length === 0) return;

    const nowMs = Date.now();
    const nowIso = new Date().toISOString();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    // Filtra avisos válidos ativos para notificação
    const activeWarnings = warnings.filter(w => {
      if (w.archived) return false;
      if (w.isTest && !isDevMode && !w.onlySelf) return false;
      if (w.publishedAt && nowIso < w.publishedAt) return false;
      
      if (w.expiresAt) {
        if (nowMs > new Date(w.expiresAt).getTime()) return false;
      } else if (w.date) {
        if (nowMs - new Date(w.date).getTime() >= SEVEN_DAYS_MS) return false;
      }

      // Se for direcionado a colaboradores específicos, valida se o usuário atual é destinatário
      if (w.targetUsers && Array.isArray(w.targetUsers) && w.targetUsers.length > 0) {
        const currentUser = storage.currentUser;
        if (!currentUser) return false;
        const normalizeName = (name) => {
          if (!name) return '';
          return name
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ');
        };
        const normCurrentUser = normalizeName(currentUser);
        if (!w.targetUsers.some(u => normalizeName(u) === normCurrentUser)) {
          return false;
        }
      }

      // Se for apenas para o autor, valida se o usuário atual é o autor
      if (w.onlySelf) {
        const currentUser = storage.currentUser;
        if (!w.author || !currentUser || w.author.trim().toLowerCase() !== currentUser.trim().toLowerCase()) {
          return false;
        }
      }

      // Valida se o usuário tem permissão e está inscrito no canal
      const wChannel = w.channel || 'Geral';
      if (!subscribed.includes(wChannel) || !allowed.includes(wChannel)) {
        return false;
      }

      return true;
    });

    if (activeWarnings.length === 0) {
      await chrome.storage.local.set({
        warningsMetaSignature: metaDoc,
        cachedWarnings: warnings,
        warningsVersionSeen: serverVersion,
        warningsLastFullCheck: Date.now()
      });
      return;
    }

    const newestWarning = activeWarnings[0];
    const title = newestWarning.title || 'Novo Aviso na Central';
    const message = newestWarning.message || 'Você tem um novo comunicado não lido na Central de Informações SGD.';
    const isTest = !!newestWarning.isTest;
    const type = newestWarning.type || 'info';

    // 3. Atualiza a assinatura local e o cache de avisos para não repetir a mesma notificação e requisições redundantes
    await chrome.storage.local.set({
      warningsMetaSignature: metaDoc,
      cachedWarnings: warnings,
      warningsVersionSeen: serverVersion,
      warningsLastFullCheck: Date.now()
    });

    // Evita duplicar notificações se o aviso já foi notificado anteriormente com a mesma data/versão
    const notifiedStorage = await chrome.storage.local.get([
      'notifiedWarnings',
      'readWarningIds',
      'ignoredWarnings',
      'warningsLastReadTime',
      'readWarnings'
    ]);
    const notifiedWarnings = notifiedStorage.notifiedWarnings || {};
    const readWarningIds = notifiedStorage.readWarningIds || [];
    const ignoredWarnings = notifiedStorage.ignoredWarnings || [];
    const readWarnings = notifiedStorage.readWarnings || [];
    const lastReadTime = notifiedStorage.warningsLastReadTime || 0;
    
    if (notifiedWarnings[newestWarning.id] === newestWarning.date) {
      return;
    }

    // Se o aviso é antigo (data menor ou igual ao último acesso do usuário na aba de avisos) 
    // ou se já foi lido/ignorado, apenas registra para evitar notificações futuras e encerra.
    // Só permitimos re-notificar se o aviso foi explicitamente atualizado (ou seja, já havia uma data notificada anterior diferente da atual).
    const wTime = newestWarning.date ? new Date(newestWarning.date).getTime() : 0;
    const hasPreviousNotification = notifiedWarnings[newestWarning.id] !== undefined;
    const isDateChanged = hasPreviousNotification && notifiedWarnings[newestWarning.id] !== newestWarning.date;
    
    if (!isDateChanged && (wTime <= lastReadTime || readWarningIds.includes(newestWarning.id) || ignoredWarnings.includes(newestWarning.id))) {
      notifiedWarnings[newestWarning.id] = newestWarning.date;
      await chrome.storage.local.set({ notifiedWarnings });
      return;
    }

    // Se o aviso foi marcado para não notificar, apenas registra no controle para evitar re-verificações e encerra
    if (newestWarning.notify === false) {
      notifiedWarnings[newestWarning.id] = newestWarning.date;
      await chrome.storage.local.set({ notifiedWarnings });
      return;
    }

    // Atualiza o controle de notificações enviadas
    notifiedWarnings[newestWarning.id] = newestWarning.date;

    // Se o aviso é novo ou foi reenviado (a data mudou), remove das listas de lidos e ignorados para que seja exibido novamente
    let updatedReadWarningIds = [...readWarningIds];
    let updatedIgnoredWarnings = [...ignoredWarnings];
    let updatedReadWarnings = [...readWarnings];
    let storageUpdated = false;

    if (updatedReadWarningIds.includes(newestWarning.id)) {
      updatedReadWarningIds = updatedReadWarningIds.filter(id => id !== newestWarning.id);
      storageUpdated = true;
    }
    if (updatedReadWarnings.includes(newestWarning.id)) {
      updatedReadWarnings = updatedReadWarnings.filter(id => id !== newestWarning.id);
      storageUpdated = true;
    }
    if (updatedIgnoredWarnings.includes(newestWarning.id)) {
      updatedIgnoredWarnings = updatedIgnoredWarnings.filter(id => id !== newestWarning.id);
      storageUpdated = true;
    }

    const setToStorage = { notifiedWarnings };
    if (storageUpdated) {
      setToStorage.readWarningIds = updatedReadWarningIds;
      setToStorage.readWarnings = updatedReadWarnings;
      setToStorage.ignoredWarnings = updatedIgnoredWarnings;
    }
    await chrome.storage.local.set(setToStorage);

    // Se for aviso de teste (desenvolvimento), apenas usuários com o modo dev ativado a receberão
    if (isTest && !isDevMode) {
      return;
    }

    // 4. Dispara a notificação nativa do Windows com tipo e emoji, limpando tags HTML
    const typeMap = {
      danger: { icon: '🚨', label: 'IMPORTANTE:' },
      warning: { icon: '⚠️', label: 'Alerta:' },
      success: { icon: '✨', label: 'Novidade:' },
      info: { icon: 'ℹ️', label: 'Informativo:' }
    };
    const meta = typeMap[type] || typeMap.info;
    const cleanMessage = message.replace(/<[^>]+>/g, '').trim();

    const notificationId = `warning:${newestWarning.id || 'unknown'}:${Date.now()}`;
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'logo.png',
      title: `${meta.icon} ${meta.label} ${title}`,
      message: cleanMessage,
      priority: 2,
      buttons: [{ title: 'Ver Aviso' }],
      requireInteraction: true
    });

    // 5. Sinaliza abas ativas para atualizarem o badge do ícone se estiverem abertas
    broadcastToSgdTabs({ action: 'UPDATE_NOTIFICATION_BADGE' });

    // 6. Dispara o Toast in-page para todas as abas ativas do SGD
    broadcastToSgdTabs({
      action: 'SHOW_TOAST',
      id: newestWarning.id || `warning-${Date.now()}`,
      title: title,
      message: message,
      type: type,
      requiredReading: !!newestWarning.requiredReading,
      onlySelf: !!newestWarning.onlySelf,
      author: newestWarning.author
    });

  } catch (err) {
    console.error('[SW] Erro ao verificar novos avisos:', err);
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
  const TEAM_STATUS_POLL_PERIOD_MIN = 15
  if (!teamAlarm || teamAlarm.periodInMinutes !== TEAM_STATUS_POLL_PERIOD_MIN) {
    chrome.alarms.create(TEAM_STATUS_POLL_ALARM, {
      delayInMinutes: 2, // Começa em 2 min
      periodInMinutes: TEAM_STATUS_POLL_PERIOD_MIN
    })
  }

  // Alarme para verificação de novos avisos (Realtime Database — cota por bandwidth, não por leituras)
  // Recria o alarme se ele não existir OU se o período antigo (ex.: 2 min) divergir do atual,
  // garantindo que usuários já instalados migrem para o novo período ao atualizar a extensão.
  const warningsAlarm = await chrome.alarms.get(WARNINGS_POLL_ALARM)
  const WARNINGS_POLL_PERIOD_MIN = 5
  if (!warningsAlarm || warningsAlarm.periodInMinutes !== WARNINGS_POLL_PERIOD_MIN) {
    // Jitter aleatório de 0-1 minuto para distribuir as requisições dos 800 usuários
    const jitterMinutes = Math.random() * 1;
    chrome.alarms.create(WARNINGS_POLL_ALARM, {
      delayInMinutes: 0.5 + jitterMinutes,
      // Verifica a cada 5 minutos. Com o atalho de versão (lê ~poucos bytes por ciclo)
      // o custo por verificação caiu de KBs para dezenas de bytes na maioria dos polls.
      periodInMinutes: WARNINGS_POLL_PERIOD_MIN
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

  // Migração de canal: Onvio Processos/Messenger -> Dominio Processos/Messenger
  try {
    const storage = await chrome.storage.local.get(['subscribedChannels', 'allowedChannels', 'warningChannels']);
    const updates = {};
    if (storage.subscribedChannels && Array.isArray(storage.subscribedChannels)) {
      updates.subscribedChannels = storage.subscribedChannels.map(c => c === 'Onvio Processos/Messenger' ? 'Dominio Processos/Messenger' : c);
    }
    if (storage.allowedChannels && Array.isArray(storage.allowedChannels)) {
      updates.allowedChannels = storage.allowedChannels.map(c => c === 'Onvio Processos/Messenger' ? 'Dominio Processos/Messenger' : c);
    }
    if (storage.warningChannels && Array.isArray(storage.warningChannels)) {
      updates.warningChannels = storage.warningChannels.map(c => c === 'Onvio Processos/Messenger' ? 'Dominio Processos/Messenger' : c);
    }
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('Service Worker: Canais migrados com sucesso para Dominio Processos/Messenger.');
    }
  } catch (err) {
    console.error('Erro na migração de canais no Service Worker:', err);
  }

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
            'SGD - PowerTools: Encerramento "Acesso Remoto" adicionado para usuário existente.'
          )
        }
      }
    } catch (error) {
      console.error(
        'SGD - PowerTools: Falha ao adicionar encerramento "Acesso Remoto" na atualização.',
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
      } else if (message.action === 'LOAD_JSZIP') {
        // Carrega o JSZip sob demanda (só quando o Chat Viewer precisa gerar um
        // .zip), injetando o arquivo na aba que pediu — assim evitamos somar
        // ~96KB ao carregamento de todas as páginas do SGD.
        try {
          const tabId = sender?.tab?.id
          if (!tabId) {
            sendResponse({ success: false, error: 'sem tabId' })
          } else {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ['jszip.min.js']
            })
            sendResponse({ success: true })
          }
        } catch (error) {
          console.error('Service Worker: erro ao injetar JSZip:', error)
          sendResponse({ success: false, error: error.message })
        }
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
      } else if (message.action === 'WARNING_CREATED') {
        // Quando um aviso é criado pelo admin, verifica imediatamente para disparar toast
        // (ignora a janela de horário para garantir entrega imediata).
        await checkWarningsAndNotify(false);
        sendResponse({ success: true });
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

          // Padrão agora é true (habilitado): só desativa se o usuário
          // explicitamente desligou o toggle (valor salvo como false).
          // Isso força a mudança de padrão mesmo para quem nunca alterou essa
          // preferência (antes o padrão implícito era desabilitado).
          const notificationsEnabled = preferences.enablePendingNotifications !== false

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
          broadcastToSgdTabs({
            action: 'SHOW_TOAST',
            id: notificationId,
            title: message.title,
            message: message.message,
            type: message.type || 'warning'
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

        // --- NOTIFICAÇÕES GENÉRICAS SUBSTITUÍDAS ---
        // Agora disparadas diretamente via Broadcast para exibição in-page (Toasts)
        broadcastToSgdTabs({
          action: 'SHOW_TOAST',
          id: message.id || `generic-${Date.now()}`,
          title: message.title,
          message: message.message,
          type: message.type || 'info',
          requiredReading: !!message.requiredReading
        })

        sendResponse({ success: true })

      } else if (message.action === 'ABRIR_TODAS_SSCS') {
        // Abre em novas guias todas as SSCs em faixa de atenção (widget lateral).
        // Feito aqui no service worker via chrome.tabs.create para não esbarrar
        // no bloqueio de múltiplos pop-ups do window.open na página.
        const urls = Array.isArray(message.urls) ? message.urls : []
        const validUrls = urls.filter(
          u => typeof u === 'string' && /^https?:\/\//.test(u)
        )
        validUrls.forEach((url, i) => {
          // Abre a primeira já ativa; as demais em segundo plano.
          chrome.tabs.create({ url, active: i === 0 })
        })
        sendResponse({ success: true, opened: validUrls.length })

      } else if (message.action === 'UPDATE_TEAM_STATUS') {
        // Handler para receber dados do Power BI Scraper (Master PC)
        try {
          const currentHour = new Date().getHours();
          if (currentHour < 8 || currentHour >= 18) {
            console.log('Service Worker: UPDATE_TEAM_STATUS ignorado fora do horário de funcionamento (08h às 18h).');
            sendResponse({ success: false, error: 'Fora do horário de funcionamento (08h às 18h).' });
            return;
          }

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
      } else if (message.action === 'FETCH_CLIENT_INFO') {
        // ── Consulta de Cliente (Domínio Web) ─────────────────────────────
        // A página do SGD é HTTPS e a API interna é HTTP (mixed content). O
        // content script não consegue fazer esse fetch; por isso ele delega
        // aqui. O service worker roda em contexto de extensão e, com a
        // host_permission "http://srvatn2-01.ead.thomsonreuters.com:8080/*"
        // declarada no manifest, não sofre bloqueio de mixed content nem CORS.
        (async () => {
          const CLIENT_API_BASE = 'http://srvatn2-01.ead.thomsonreuters.com:8080/api/client/'
          try {
            const clienteId = String(message.clienteId || '').trim()
            if (!/^\d+$/.test(clienteId)) {
              throw new Error('Código de cliente inválido.')
            }
            const response = await fetch(CLIENT_API_BASE + clienteId, { cache: 'no-store' })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const data = await response.json()
            sendResponse({ ok: true, data })
          } catch (error) {
            console.error('Service Worker: Erro ao consultar cliente:', error)
            sendResponse({ ok: false, error: error.message || String(error) })
          }
        })()
        return true // Resposta assíncrona
      } else if (message.action === 'getAiChains') {
        // ── Retorna a lista de chains disponíveis para o modal de seleção ─
        // O ui-components.js chama isso para montar os botões de fila.
        sendResponse(AI_CHAINS)

      } else if (message.action === 'gerarSugestaoSS' && sender.tab?.id) {
        // ── Sugestor SS (Assistente: Manual Cadastro de SSs) ─────────────
        // Disparado quando o analista clica no botão da toolbar na ssc.html.
        // Sempre usa a chain fixa do Sugestor SS. Não usa sendResponse.
        handleGerarSugestao(message.markdownSSC, sender.tab.id, CHAIN_SS_WORKFLOW_ID, 'sugestaoCompleta', 'sugestaoErro')

      } else if (message.action === 'gerarSugestaoSS' && sender.tab?.id) {
        handleGerarSugestao(message.markdownSSC, sender.tab.id, CHAIN_SS_WORKFLOW_ID, 'sugestaoCompleta', 'sugestaoErro')

        // ADICIONE ESTE BLOCO:
      } else if (message.action === 'gerarSugestaoSAM' && sender.tab?.id) {
        // ── Sugestor SAM — chain fixa "ASSISTENTE: Cadastro de SA/NE" ──────────
        const SAM_WORKFLOW_ID = AI_CHAINS['ASSISTENTE: Cadastro de SA/NE']
        handleGerarSugestao(message.prompt, sender.tab.id, SAM_WORKFLOW_ID, 'samCompleta', 'samErro')

      } else if (message.action === 'buscarSAMSimilares' && sender.tab?.id) {
        // ── Busca SAMs similares antes de cadastrar ───────────────────────
        const BUSCA_SAM_WORKFLOW_ID = AI_CHAINS['LISTAGEM DE SANES E SAILS - GERAL']
        sgdLog('[AI WS][buscarSAMSimilares] Mensagem recebida. tabId:', sender.tab.id, '| workflowId:', BUSCA_SAM_WORKFLOW_ID, '| prompt length:', message.prompt?.length ?? 0)

        if (!BUSCA_SAM_WORKFLOW_ID) {
          console.error('[AI WS][buscarSAMSimilares] BUSCA_SAM_WORKFLOW_ID não encontrado em AI_CHAINS["LISTAGEM DE SANES E SAILS - GERAL"]. Verifique o mapa AI_CHAINS.')
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'buscaSAMErro',
            data: 'Configuração da chain "LISTAGEM DE SANES E SAILS - GERAL" não encontrada.'
          })
        } else {
          handleGerarSugestao(message.prompt, sender.tab.id, BUSCA_SAM_WORKFLOW_ID, 'buscaSAMCompleta', 'buscaSAMErro')
        }

      } else if (message.action === 'compararSSCsSimilares' && sender.tab?.id) {
        // ── Comparação de assuntos de SSCs via IA (Gemini Flash) ──────────
        sgdLog('[AI WS][compararSSCsSimilares] Mensagem recebida. tabId:', sender.tab.id, '| workflowId:', COMPARACAO_SSC_WORKFLOW_ID)
        handleGerarSugestao(message.prompt, sender.tab.id, COMPARACAO_SSC_WORKFLOW_ID, 'comparacaoSSCCompleta', 'comparacaoSSCErro')

      } else if (message.action === 'resumirChat' && sender.tab?.id) {
        // ── Pré-resumo de chat ou transcrição via chain rápida (Gemini Flash) ──
        const RESUMO_CHAT_WORKFLOW_ID = '4b95e35f-e8ea-44e6-ad74-555bf39be13f'
        handleGerarSugestao(message.prompt, sender.tab.id, RESUMO_CHAT_WORKFLOW_ID, 'resumoChatCompleto', 'resumoChatErro')

      } else if (message.action === 'resumirSolicitacao' && sender.tab?.id) {
        // ── Resumir Solicitação via chain da fila selecionada ────────────
        // message.chainKey: chave do objeto AI_CHAINS selecionada pelo usuário
        // message.prompt:   conteúdo extraído da página montado pelo features.js
        const workflowId = AI_CHAINS[message.chainKey]
        if (!workflowId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'resumoErro',
            data: `Chain não encontrada para a fila: "${message.chainKey}"`
          })
        } else {
          handleGerarSugestao(message.prompt, sender.tab.id, workflowId, 'resumoCompleto', 'resumoErro')
        }

      } else if (message.action === 'gerarPorTopicos' && sender.tab?.id) {
        // ── Gerar por Tópicos via GPT-5.5 ────────────────────────────────────
        handleGerarSugestao(message.prompt, sender.tab.id, GPT55_WORKFLOW_ID, 'topicosCompleto', 'topicosErro')

      } else if (message.action === 'completarRascunho' && sender.tab?.id) {
        // ── Completar Rascunho via chain da fila selecionada ────────────
        // message.chainKey: chave do objeto AI_CHAINS selecionada pelo usuário
        // message.prompt:   histórico + rascunho montados pelo features.js
        const workflowId = AI_CHAINS[message.chainKey]
        if (!workflowId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'rascunhoErro',
            data: `Chain não encontrada para a fila: "${message.chainKey}"`
          })
        } else {
          handleGerarSugestao(message.prompt, sender.tab.id, workflowId, 'rascunhoCompleto', 'rascunhoErro')
        }

      } else if (message.action === 'rotearEMelhorar' && sender.tab?.id) {
        // ── Melhorar Texto com roteamento automático de fila ──────────────
        const { prompt, promptCompleto } = message
        const tabId = sender.tab.id

          ; (async () => {
            try {
              const essoToken = await ensureValidToken()
              const API_URL = `${WS_BASE_URL}/?Authorization=${essoToken}`
              const ws = new WebSocket(API_URL)
              let jsonBruto = ''

              ws.onopen = () => {
                ws.send(JSON.stringify({
                  action: 'SendMessage',
                  workflow_id: ROUTER_WORKFLOW_ID,
                  query: prompt,
                  is_persistence_allowed: false
                }))
              }

              ws.onmessage = (event) => {
                try {
                  const data = JSON.parse(event.data)
                  for (const key in data) {
                    const val = data[key]
                    if (typeof val !== 'object' || val === null) continue
                    if ('answer' in val && val.answer) jsonBruto += val.answer
                    if ('cost_track' in val) ws.close()
                  }
                } catch (e) {
                  chrome.tabs.sendMessage(tabId, {
                    action: 'rascunhoErro',
                    data: `Erro ao processar resposta da roteadora: ${e.message}`
                  })
                  ws.close()
                }
              }

              ws.onerror = () => {
                chrome.tabs.sendMessage(tabId, {
                  action: 'rascunhoErro',
                  data: 'Erro na conexão com a chain roteadora.'
                })
              }

              ws.onclose = async () => {
                console.log('[ROUTER] jsonBruto recebido:', jsonBruto)
                if (!jsonBruto) return

                let classificacao
                try {
                  const limpo = jsonBruto.replace(/```json|```/g, '').replace(/^json\s*/i, '').trim()
                  const parsed = JSON.parse(limpo)
                  classificacao = parsed.classificacao
                } catch (e) {
                  chrome.tabs.sendMessage(tabId, {
                    action: 'rascunhoErro',
                    data: 'A roteadora retornou uma resposta inválida. Tente novamente com mais informações.'
                  })
                  return
                }

                const workflowId = ROUTER_CHAIN_MAP[classificacao]

                if (!workflowId) {
                  // ESTOURO — fallback para chain genérica
                  console.log('[ROTEADORA] Classificação não reconhecida. Usando fallback genérico.')
                  chrome.tabs.sendMessage(tabId, {
                    action: 'filaIdentificada',
                    fila: 'Melhoria Geral'
                  })
                  await handleGerarSugestao(
                    promptCompleto,
                    tabId,
                    FALLBACK_WORKFLOW_ID,
                    'rascunhoCompleto',
                    'rascunhoErro'
                  )
                  return
                }

                chrome.tabs.sendMessage(tabId, {
                  action: 'filaIdentificada',
                  fila: classificacao
                })

                await handleGerarSugestao(
                  promptCompleto,
                  tabId,
                  workflowId,
                  'rascunhoCompleto',
                  'rascunhoErro'
                )
              }

            } catch (err) {
              chrome.tabs.sendMessage(tabId, {
                action: 'rascunhoErro',
                data: `Erro de autenticação: ${err.message}`
              })
            }
          })()
      } else if (message.action === 'rotearEResumir' && sender.tab?.id) {
        // ── Resumir Solicitação com roteamento automático de fila ─────────
        const { prompt, promptCompleto } = message
        const tabId = sender.tab.id

          ; (async () => {
            try {
              const essoToken = await ensureValidToken()
              const API_URL = `${WS_BASE_URL}/?Authorization=${essoToken}`
              const ws = new WebSocket(API_URL)
              let jsonBruto = ''

              ws.onopen = () => {
                ws.send(JSON.stringify({
                  action: 'SendMessage',
                  workflow_id: ROUTER_WORKFLOW_ID,
                  query: prompt,
                  is_persistence_allowed: false
                }))
              }

              ws.onmessage = (event) => {
                try {
                  const data = JSON.parse(event.data)
                  for (const key in data) {
                    const val = data[key]
                    if (typeof val !== 'object' || val === null) continue
                    if ('answer' in val && val.answer) jsonBruto += val.answer
                    if ('cost_track' in val) ws.close()
                  }
                } catch (e) {
                  chrome.tabs.sendMessage(tabId, {
                    action: 'resumoErro',
                    data: `Erro ao processar resposta da roteadora: ${e.message}`
                  })
                  ws.close()
                }
              }

              ws.onerror = () => {
                chrome.tabs.sendMessage(tabId, {
                  action: 'resumoErro',
                  data: 'Erro na conexão com a chain roteadora.'
                })
              }

              ws.onclose = async () => {
                if (!jsonBruto) return

                let classificacao
                try {
                  const limpo = jsonBruto.replace(/```json|```/g, '').replace(/^json\s*/i, '').trim()
                  const parsed = JSON.parse(limpo)
                  classificacao = parsed.classificacao
                } catch (e) {
                  chrome.tabs.sendMessage(tabId, {
                    action: 'resumoErro',
                    data: 'A roteadora retornou uma resposta inválida. Tente novamente com mais informações.'
                  })
                  return
                }

                const workflowId = ROUTER_CHAIN_MAP[classificacao]

                if (!workflowId) {
                  chrome.tabs.sendMessage(tabId, {
                    action: 'resumoErro',
                    data: `Não foi possível identificar a fila para este atendimento (classificação: "${classificacao}"). Adicione mais informações e tente novamente.`
                  })
                  return
                }

                chrome.tabs.sendMessage(tabId, {
                  action: 'filaIdentificadaResumo',
                  fila: classificacao
                })

                await handleGerarSugestao(
                  promptCompleto,
                  tabId,
                  workflowId,
                  'resumoCompleto',
                  'resumoErro'
                )
              }

            } catch (err) {
              chrome.tabs.sendMessage(tabId, {
                action: 'resumoErro',
                data: `Erro de autenticação: ${err.message}`
              })
            }
          })()

      } else if (message.action === 'resumirDireto' && sender.tab?.id) {
        const workflowId = ROUTER_CHAIN_MAP[message.chainKey]
        if (!workflowId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'resumoErro',
            data: `Chain não encontrada para: "${message.chainKey}"`
          })
        } else {
          handleGerarSugestao(message.prompt, sender.tab.id, workflowId, 'resumoCompleto', 'resumoErro')
        }

      } else if (message.action === 'melhorarDireto' && sender.tab?.id) {
        const workflowId = ROUTER_CHAIN_MAP[message.chainKey]
        if (!workflowId) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: 'rascunhoErro',
            data: `Chain não encontrada para: "${message.chainKey}"`
          })
        } else {
          handleGerarSugestao(message.prompt, sender.tab.id, workflowId, 'rascunhoCompleto', 'rascunhoErro')
        }

      } else if (message.action === 'FETCH_WARNINGS_DATA') {
        const fetchUrl = `${RTDB_WARNINGS_URL}.json?orderBy="date"&limitToLast=20`;
        try {
          const response = await fetch(fetchUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error('Erro ao buscar do RTDB');
          const data = await response.json();
          sendResponse({ success: true, data });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }

      } else if (message.action === 'WRITE_WARNING_ACTION') {
        const { type, id, data } = message;
        (async () => {
          try {
            if (type === 'create') {
              const { id: _, ...bodyData } = data;
              const response = await fetch(`${RTDB_WARNINGS_URL}.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
              });
              if (!response.ok) throw new Error('Erro ao criar no RTDB');
              await touchWarningsMetadata(data);
              sendResponse({ success: true });
            } else if (type === 'update') {
              let oldDoc = null;
              try {
                const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
                if (fetchResponse.ok) oldDoc = await fetchResponse.json();
              } catch (_) {}

              const { id: _, ...bodyData } = data;
              const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
              });
              if (!response.ok) throw new Error('Erro ao atualizar no RTDB');

              let newDoc = null;
              try {
                const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
                if (fetchResponse.ok) newDoc = await fetchResponse.json();
              } catch (_) {}

              await touchWarningsMetadata([oldDoc, newDoc || data]);
              sendResponse({ success: true });
            } else if (type === 'delete') {
              let doc = null;
              try {
                const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
                if (fetchResponse.ok) doc = await fetchResponse.json();
              } catch (_) {}

              const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
                method: 'DELETE'
              });
              if (!response.ok) throw new Error('Erro ao deletar no RTDB');
              await touchWarningsMetadata(doc);
              sendResponse({ success: true });
            }
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true; // Resposta assíncrona

      } else if (message.action === 'READ_PERMISSIONS_ACTION') {
        const { path } = message;
        (async () => {
          try {
            const url = `${RTDB_BASE_URL}${path}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            sendResponse({ success: true, data });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true; // Resposta assíncrona

      } else if (message.action === 'WRITE_PERMISSIONS_ACTION') {
        const { path, method, data } = message;
        (async () => {
          try {
            const url = `${RTDB_BASE_URL}${path}`;
            const options = { method };
            if (data) {
              options.headers = { 'Content-Type': 'application/json' };
              options.body = JSON.stringify(data);
            }
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const resData = await response.json();
            sendResponse({ success: true, data: resData });
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true; // Resposta assíncrona

      } else if (message.action === 'IAPLUG_OPEN_WINDOW') {
        // Abre (ou foca) a janela dedicada do assistente IAplug.
        const open = await openOrFocusIAplugWindow(message.url, message.regionKey, message.regionLabel)
        sendResponse({ open })

      } else if (message.action === 'IAPLUG_GET_STATE') {
        // Informa ao content script se a janela do IAplug está aberta.
        sendResponse({ open: await isIAplugWindowOpen() })

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

  if (alarm.name === WARNINGS_POLL_ALARM) {
    checkWarningsAndNotify();
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

// Controle temporário para ignorar o clique no corpo da notificação quando um botão é clicado
const buttonClickIgnoredNotifications = new Set()

// Listener para cliques nos botões da notificação do Windows
chrome.notifications.onButtonClicked.addListener(
  (notificationId, buttonIndex) => {
    // Registra que a notificação foi tratada por um botão para evitar propagação/duplicação no onClicked
    buttonClickIgnoredNotifications.add(notificationId)
    setTimeout(() => {
      buttonClickIgnoredNotifications.delete(notificationId)
    }, 1000)

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

    // Tratamento para Avisos (prefixo 'warning-' ou 'warning:')
    if (notificationId.startsWith('warning-') || notificationId.startsWith('warning:')) {
      if (buttonIndex === 0) {
        if (notificationId.startsWith('warning:')) {
          const parts = notificationId.split(':')
          const warningId = parts[1]
          chrome.tabs.create({
            url: `https://sgd.dominiosistemas.com.br/sgsa/faces/noticias.html?open_warning_id=${warningId}`
          })
        } else {
          // Fallback antigo para warning-
          chrome.tabs.create({
            url: 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html?open_sgd_panel=true&target_tab=notices'
          })
        }
      }
      chrome.notifications.clear(notificationId)
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
  // Pequeno delay para garantir que, se um botão foi clicado, o onButtonClicked seja processado primeiro e popule o set de ignorados
  setTimeout(() => {
    // Ignora se o clique veio de um botão já tratado (como Dispensar)
    if (buttonClickIgnoredNotifications.has(notificationId)) {
      return
    }

    // Se clicar no corpo da notificação de pendências, age como o botão "Visualizar"
    if (notificationId.startsWith('pending-')) {
      chrome.tabs.create({
        url: 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html?open_sgd_panel=true'
      })
      chrome.notifications.clear(notificationId)
    }

    // Se clicar no corpo da notificação de avisos (ou fallback de clique de botão), abre o aviso correspondente
    if (notificationId.startsWith('warning-') || notificationId.startsWith('warning:')) {
      if (notificationId.startsWith('warning:')) {
        const parts = notificationId.split(':')
        const warningId = parts[1]
        chrome.tabs.create({
          url: `https://sgd.dominiosistemas.com.br/sgsa/faces/noticias.html?open_warning_id=${warningId}`
        })
      } else {
        chrome.tabs.create({
          url: 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html?open_sgd_panel=true&target_tab=notices'
        })
      }
      chrome.notifications.clear(notificationId)
    }
  }, 150)
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