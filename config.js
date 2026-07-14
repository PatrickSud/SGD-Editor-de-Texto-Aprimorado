/**
 * @file config.js
 * Configurações globais, constantes, estado inicial e definições de UI da extensão
 */

// ─── DEBUG LOGS (console) ──────────────────────────────────────────────────
// Controla a exibição dos logs de diagnóstico da extensão (ex.: "[AI WS]",
// "[SugerirSAM]", "[PLUG Access]", "[DEBUG]" do Verificador de Duplicidade).
// Por padrão fica DESATIVADO para não poluir o console de todos os usuários.
// Cada técnico pode ativar/desativar no console da página do SGD (F12):
//   sgdDebug.ativar()     → liga os logs (persiste entre recarregamentos)
//   sgdDebug.desativar()  → desliga os logs
//   sgdDebug.status()     → mostra o estado atual
const SGD_DEBUG_STORAGE_KEY = 'sgdDebugLogsEnabled'

// Valor em memória usado pelas funções sgdLog/sgdWarn/sgdError. Começa como
// false e é atualizado assim que a leitura do storage (abaixo) resolver, e
// também ao vivo caso outra aba altere o valor (chrome.storage.onChanged).
let sgdDebugLogsEnabled = false

chrome.storage.local.get([SGD_DEBUG_STORAGE_KEY]).then(res => {
  sgdDebugLogsEnabled = res[SGD_DEBUG_STORAGE_KEY] === true
}).catch(() => {})

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, SGD_DEBUG_STORAGE_KEY)) {
      sgdDebugLogsEnabled = changes[SGD_DEBUG_STORAGE_KEY].newValue === true
    }
  })
}

/** Log de debug da extensão — só aparece se sgdDebug.ativar() tiver sido chamado. */
function sgdLog(...args) {
  if (sgdDebugLogsEnabled) console.log(...args)
}
/** Warn de debug da extensão — só aparece se sgdDebug.ativar() tiver sido chamado. */
function sgdWarn(...args) {
  if (sgdDebugLogsEnabled) console.warn(...args)
}
/** Error de debug da extensão — só aparece se sgdDebug.ativar() tiver sido chamado. */
function sgdError(...args) {
  if (sgdDebugLogsEnabled) console.error(...args)
}

// Implementação real (só existe aqui, no "mundo isolado" do content script,
// que é o único lugar com acesso à API chrome.storage).
window.sgdDebug = {
  ativar() {
    sgdDebugLogsEnabled = true
    chrome.storage.local.set({ [SGD_DEBUG_STORAGE_KEY]: true })
    console.log('%c[SGD PowerTools] Logs de debug ATIVADOS nesta e nas próximas sessões. Recarregue a página se algo não aparecer.', 'color: #22c55e; font-weight: bold;')
  },
  desativar() {
    sgdDebugLogsEnabled = false
    chrome.storage.local.set({ [SGD_DEBUG_STORAGE_KEY]: false })
    console.log('%c[SGD PowerTools] Logs de debug DESATIVADOS.', 'color: #ef4444; font-weight: bold;')
  },
  status() {
    console.log(`[SGD PowerTools] Logs de debug estão ${sgdDebugLogsEnabled ? 'ATIVADOS ✅' : 'DESATIVADOS ⛔'}.`)
    return sgdDebugLogsEnabled
  }
}

// ─── Ponte com o console (mundo principal da página) ───────────────────────
// O DevTools Console, por padrão, executa comandos no "mundo principal" da
// página — não no "mundo isolado" onde os content scripts (e o objeto acima)
// rodam. Por isso "sgdDebug.ativar()" digitado direto no console dava
// "ReferenceError: sgdDebug is not defined": window.sgdDebug só existia no
// mundo isolado.
//
// Tentamos primeiro injetar uma tag <script> inline (sem precisar de arquivo
// separado), mas o SGD tem uma Content-Security-Policy que bloqueia scripts
// inline — a injeção falha silenciosamente (sem lançar exceção; o navegador
// só recusa a execução). Por isso voltamos ao arquivo debug-bridge.js,
// declarado no manifest.json com "world": "MAIN": scripts de content script
// injetados dessa forma são executados pelo próprio Chrome e não passam
// pela CSP da página, então funcionam mesmo em páginas restritivas.
// Esse arquivo só expõe um window.sgdDebug "fininho" que repassa o comando
// para cá via CustomEvent, já que o mundo principal não tem acesso à API
// chrome.storage.
window.addEventListener('sgd-debug-command', (event) => {
  const action = event.detail && event.detail.action
  if (action === 'ativar') window.sgdDebug.ativar()
  else if (action === 'desativar') window.sgdDebug.desativar()
  else if (action === 'status') window.sgdDebug.status()
})

const DEV_MODE_KEY = 'developerModeEnabled'
const DATA_VERSION = 3
const STORAGE_KEY = 'quickMessagesData'
const NOTES_STORAGE_KEY = 'editorNotesData'
const REMINDERS_STORAGE_KEY = 'remindersData'
const SETTINGS_STORAGE_KEY = 'extensionSettingsData'
const USER_RESPONSE_SAMPLES_KEY = 'userResponseSamples'
const MAX_RESPONSE_SAMPLES = 30
const FAB_POSITION_KEY = 'fabPositionData'
const GREETINGS_CLOSINGS_KEY = 'greetingsAndClosingsData'
const FOLLOWED_ATTENDANCES_KEY = 'followedAttendancesData'
const LAST_SEEN_VERSION_KEY = 'lastSeenVersion'
const PENDING_MINOR_NOTES_KEY = 'pendingMinorNotes'

// Permissões de Editores (Firebase Realtime Database)
const RTDB_PERMISSIONS_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com/permissions'
const RTDB_EDITORS_URL = `${RTDB_PERMISSIONS_BASE_URL}/editors`
const RTDB_VIEWERS_URL = `${RTDB_PERMISSIONS_BASE_URL}/viewers`
const PERMISSIONS_CACHE_KEY = 'cachedEditorPermissions'
const VIEWERS_CACHE_KEY = 'cachedViewerPermissions'
// TTLs para reduzir o consumo de download do RTDB (cota gratuita).
// Editores/visualizadores mudam raramente; 12h é seguro para as listas.
// Canais e config remota têm TTL menor (2h) para propagar criação/renomeação
// de canais e flags remotas com mais agilidade.
const PERMISSIONS_CACHE_TTL = 12 * 60 * 60 * 1000 // 12 horas em ms
const REMOTE_CONFIG_CACHE_TTL = 2 * 60 * 60 * 1000  // 2 horas em ms
const ACTIVE_CHANNELS_CACHE_TTL = 2 * 60 * 60 * 1000 // 2 horas em ms

/**
 * Separadores exclusivos para delimitar saudação e encerramento no texto.
 */
const GREETING_SEPARATOR = '<!--Saudação-->\n\n'
const CLOSING_SEPARATOR = '\n\n<!--Encerramento-->'

const AI_FEATURES = {
  'ai-complete-draft': {
    label: 'Melhorar Texto',
    icon: '🪄',
    title: 'Melhorar Texto com IA'
  },
  'ai-summarize': {
    label: 'Resumir Solicitação',
    icon: '📄',
    title: 'Resumir Solicitação com IA'
  },
  'sugerir-ss': { label: 'Sugerir SS', icon: '✨', title: 'Sugerir SS com IA' },
  'sugerir-sam': {
    label: 'Sugerir SAM',
    icon: '📋',
    title: 'Sugerir SAM com IA'
  }
}

const DEFAULT_SETTINGS = {
  reminderRetentionDays: 7,
  geminiApiKey: '',
  previewResizable: false,
  fabPosition: 'bottom-left',
  toolbarButtons: {
    ai: true,
    link: true,
    insertImage: true,
    emoji: true,
    username: true,
    color: true,
    highlight: true,
    lists: true,
    bullet: true,
    reminders: true,
    quickSteps: true,
    quickChange: true,
    notes: true,
    fab: true,
    goToTop: true,
    searchAnswerButton: true,
    separator1: true,
    separator2: true,
    separator3: true,
    separator4: true,
    separator5: true,
    separator6: true
  },
  uiSettings: {
    iconSize: 1.0,
    uiFontSize: 14,
    editorFontSize: 14,
    buttonLabelType: 'symbol' // 'symbol' ou 'text'
  },
  preferences: {
    enableWindowsNotifications: true,
    dropdownBehavior: 'hover', // 'hover' ou 'click'
    ocultarPreVisualizacaoSite: false, // Oculta o campo "Pré-visualizar:" nativo do site por padrão desativado
    enableDuplicateChecker: false, // Habilita a verificação de atendimentos duplicados por padrão desativado
    enableTeamManagement: false, // Habilita o gerenciamento de Equipe AT na guia Controle de Acesso por padrão desativado
    rememberLastClassification: false, // Lembrar e preencher automaticamente a última classificação selecionada (desativado por padrão)
    enableAutoCapitalize: true // Capitaliza automaticamente a primeira letra de frases ao digitar (habilitado por padrão)
  },
  pinnedAIButtons: []
}

let currentEditorTheme = 'padrao'

let draggedCategoryItem = null
let draggedMessageItem = null

let pickerHideTimeout

/**
 * Lista de seletores CSS para encontrar os textareas alvo no SGD
 */
const TARGET_TEXTAREA_SELECTORS = [
  'textarea#sscForm\\:descricaoTramite',
  'textarea#cadSscForm\\:tramiteDescricao',
  'textarea#ssForm\\:descricaoTramite',
  'textarea#ocorrenciaForm\\:descricaoTramite'
]

/**
 * IDs/Seletores para encontrar a descrição inicial da solicitação de suporte
 */
const SUPPORT_REQUEST_DESCRIPTION_SELECTORS = [
  '#sscForm\\:solicitacao',
  '#cadSscForm\\:solicitacao',
  '#ssForm\\:solicitacao',
  'textarea[name="solicitacao"]'
]

/**
 * Seletores para encontrar a tabela de trâmites anteriores
 */
const TRAMITES_TABLE_SELECTORS = [
  '#sscForm\\:tramitesTable_data',
  '#cadSscForm\\:tramites_data',
  '#ssForm\\:tramitesTable_data'
]

/**
 * IDs de elementos usados para encontrar o nome do usuário no SGD
 */
const USER_NAME_SELECT_ID = 'cadSscForm:usuario'
const USER_NAME_LOGGED_ID = 'td:usuario_nome'
const USER_NAME_INPUT_ID = 'cadSscForm:nome'

const THEMES = [
  'padrao',
  'serenidade',
  'lumen',
  'pink',
  'forest',
  'dark-graphite',
  'dark',
  'tokyo-night'
]

const THEME_CLASSES_MAP = {
  serenidade: 'serenidade-mode',
  lumen: 'lumen-mode',
  dark: 'dark-mode',
  forest: 'forest-mode',
  pink: 'pink-mode',
  'dark-graphite': 'dark-graphite-mode',
  'tokyo-night': 'tokyo-night-mode',
  padrao: 'padrao-mode'
}

const ALL_THEME_CLASSES = Object.values(THEME_CLASSES_MAP)

const THEME_ICONS = {
  serenidade: '☁️',
  lumen: '🌐',
  dark: '❄️',
  forest: '🍃',
  pink: '🌸',
  'dark-graphite': '🌙',
  'tokyo-night': '🌑',
  padrao: '💎'
}

const THEME_NAMES = {
  serenidade: 'Serenidade',
  lumen: 'Lumen',
  'dark-graphite': 'Midnight',
  dark: 'Blue Night',
  forest: 'Floresta',
  pink: 'Cerejeira',
  'tokyo-night': 'Tokyo Night',
  padrao: 'Padrão'
}

const PICKER_COLORS = [
  '#fa6400',
  '#FF0000',
  '#0000FF',
  '#FFFF00',
  '#FF00FF',
  '#00FFFF',
  '#FFA500',
  '#008000'
]

const PICKER_EMOJIS = [
  { char: '😀', code: '&#128512;' },
  { char: '😃', code: '&#128515;' },
  { char: '😄', code: '&#128516;' },
  { char: '😁', code: '&#128513;' },
  { char: '😆', code: '&#128518;' },
  { char: '😅', code: '&#128517;' },
  { char: '😂', code: '&#128514;' },
  { char: '🤗', code: '&#129303;' },
  { char: '🤭', code: '&#129325;' },
  { char: '😊', code: '&#128522;' },
  { char: '😉', code: '&#128521;' },
  { char: '😌', code: '&#128524;' },
  { char: '😍', code: '&#128525;' },
  { char: '🥰', code: '&#129392;' },
  { char: '😎', code: '&#128526;' },
  { char: '😋', code: '&#128523;' },
  { char: '🤔', code: '&#129300;' },
  { char: '😮', code: '&#128558;' },
  { char: '😬', code: '&#128556;' },
  { char: '😥', code: '&#128549;' },
  { char: '😢', code: '&#128546;' },
  { char: '😔', code: '&#128532;' },
  { char: '🤠', code: '&#129312;' },
  { char: '😭', code: '&#128557;' },
  { char: '😱', code: '&#128561;' },
  { char: '😠', code: '&#128544;' },
  { char: '👋', code: '&#128075;' },
  { char: '👏', code: '&#128079;' },
  { char: '🙌', code: '&#128588;' },
  { char: '🤝', code: '&#129309;' },
  { char: '👍', code: '&#128077;' },
  { char: '👎', code: '&#128078;' },
  { char: '🤙', code: '&#129305;' },
  { char: '👆', code: '&#128070;' },
  { char: '👇', code: '&#128071;' },
  { char: '👉', code: '&#128073;' },
  { char: '👈', code: '&#128072;' },
  { char: '👌', code: '&#128076;' },
  { char: '👊', code: '&#128074;' },
  { char: '🙏', code: '&#128591;' },
  { char: '🎉', code: '&#127881;' },
  { char: '✅', code: '&#9989;' },
  { char: '❌', code: '&#10060;' },
  { char: '⚠️', code: '&#9888;' },
  { char: '💡', code: '&#128161;' },
  { char: '💻', code: '&#128187;' },
  { char: '📱', code: '&#128241;' },
  { char: '🕵', code: '&#128373;' },
  { char: '📞', code: '&#128222;' },
  { char: '🔒', code: '&#128274;' },
  { char: '🔥', code: '&#128293;' },
  { char: '🧡', code: '&#129505;' },
  { char: '📌', code: '&#128204;' },
  { char: '🌟', code: '&#127775;' },
  { char: '⌛', code: '&#9203;' }
]

const PROTECTED_SHORTCUTS = [
  'ctrl+c',
  'ctrl+v',
  'ctrl+x',
  'ctrl+a',
  'ctrl+z',
  'ctrl+y',
  'ctrl+s',
  'ctrl+p',
  'ctrl+f',
  'ctrl+g',
  'ctrl+h',
  'ctrl+j',
  'ctrl+k',
  'ctrl+l',
  'ctrl+n',
  'ctrl+o',
  'ctrl+r',
  'ctrl+t',
  'ctrl+w',
  'ctrl+shift+t',
  'ctrl+shift+n',
  'ctrl+shift+w',
  'alt+f4',
  'alt+tab',
  'f1',
  'f5',
  'f11',
  'f12',
  'ctrl+shift+i',
  'ctrl+shift+j',
  'ctrl+shift+c',
  'ctrl+u'
]

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
]

// ─── FEATURE FLAGS ───────────────────────────────────────────────────────────
// Para reativar, mude para true e recarregue a extensão.
const FEATURE_SUGERIR_SAM = true
// ─────────────────────────────────────────────────────────────────────────────

// ─── LIMIARES DE JANELA PARA BOTÕES FLUTUANTES ───────────────────────────────
// FAB e botões Ir ao Topo/PLUG ficam ocultos quando a janela do navegador
// for menor que estas dimensões (comum em janelas SGD abertas em tamanho reduzido).
const FAB_MIN_WINDOW_WIDTH = 680   // px — largura mínima para exibir os botões
const FAB_MIN_WINDOW_HEIGHT = 450  // px — altura mínima para exibir os botões
// ─────────────────────────────────────────────────────────────────────────────

// ─── CONSTANTES DE TEMPORIZAÇÃO ──────────────────────────────────────────────
const SGD_BUTTON_FEEDBACK_MS = 1500       // Duração do feedback visual em botões (ex: "Indisponível")
const SGD_TOAST_FADE_MS = 300             // Deve coincidir com a duração da animação CSS sgdToastOut (0.3s)
const SGD_TAB_NAV_INITIAL_DELAY_MS = 300  // Delay antes da primeira tentativa de navegar para uma aba
const SGD_TAB_NAV_RETRY_MS = 200          // Intervalo entre tentativas de navegação de aba
const SGD_CLICK_GUARD_DELAY_MS = 100      // Delay para registrar listener de clique-fora (evita capturar o clique de abertura)
// ─────────────────────────────────────────────────────────────────────────────
