/**
 * @file config.js
 * @description Configurações globais, constantes, estado inicial e definições de UI da extensão.
 */

// --- CONFIGURAÇÕES GERAIS E ARMAZENAMENTO ---
const DEV_MODE_KEY = 'developerModeEnabled' // Nova chave para o modo dev
const DATA_VERSION = 3
const STORAGE_KEY = 'quickMessagesData'
const NOTES_STORAGE_KEY = 'editorNotesData'
const REMINDERS_STORAGE_KEY = 'remindersData'
const SETTINGS_STORAGE_KEY = 'extensionSettingsData'
const USER_RESPONSE_SAMPLES_KEY = 'userResponseSamples'
const MAX_RESPONSE_SAMPLES = 30
const FAB_POSITION_KEY = 'fabPositionData' // NOVO

// Configurações Padrão
const DEFAULT_SETTINGS = {
  reminderRetentionDays: 7, // ALTERADO: Padrão agora é 7 dias
  geminiApiKey: '', // Chave da API do Gemini fornecida pelo usuário
  previewResizable: false, // Define se o preview é redimensionável
  fabPosition: 'bottom-left', // NOVO: Posição padrão
  toolbarButtons: {
    link: true,
    emoji: true,
    username: true,
    color: true,
    highlight: true,
    lists: true,
    bullet: true,
    reminders: true,
    quickSteps: true,
    notes: true,
    fab: true,
    goToTop: true,
    separator1: true, // Divisor após IA (sempre ativo, não configurável)
    separator2: true, // Divisor após Formatação
    separator3: true, // Divisor após Listas
    separator4: true, // Divisor após Inserir
    separator5: true, // Divisor após Cores
    separator6: true // Divisor após Ferramentas
  },
  uiSettings: {
    iconSize: 1.0,
    uiFontSize: 14,
    editorFontSize: 14
  }
}

// --- ESTADO GLOBAL (Variáveis mutáveis usadas entre os scripts) ---

let currentEditorTheme = 'padrao'

// Controle de Drag & Drop
let draggedCategoryItem = null
let draggedMessageItem = null

// Timeout para esconder os pickers
let pickerHideTimeout

// --- CONFIGURAÇÕES DO SISTEMA ALVO (SGD) ---

/**
 * Lista de seletores CSS para encontrar os textareas alvo no SGD.
 */
const TARGET_TEXTAREA_SELECTORS = [
  'textarea#sscForm\\:descricaoTramite',
  'textarea#cadSscForm\\:tramiteDescricao',
  'textarea#ssForm\\:descricaoTramite'
]

/**
 * IDs/Seletores para encontrar a descrição inicial da solicitação de suporte.
 */
const SUPPORT_REQUEST_DESCRIPTION_SELECTORS = [
  '#sscForm\\:solicitacao',
  '#cadSscForm\\:solicitacao',
  '#ssForm\\:solicitacao',
  'textarea[name="solicitacao"]' // Fallback
]

/**
 * Seletores para encontrar a tabela de trâmites anteriores.
 */
const TRAMITES_TABLE_SELECTORS = [
  '#sscForm\\:tramitesTable_data',
  '#cadSscForm\\:tramites_data',
  '#ssForm\\:tramitesTable_data'
]

/**
 * IDs de elementos usados para encontrar o nome do usuário no SGD.
 */
const USER_NAME_SELECT_ID = 'cadSscForm:usuario'
const USER_NAME_LOGGED_ID = 'td:usuario_nome'

// --- CONFIGURAÇÕES DE TEMA ---

// Ordem de alternância dos temas
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

// Mapeamento de temas para classes CSS.
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

// Array de todas as classes de tema para facilitar a remoção.
const ALL_THEME_CLASSES = Object.values(THEME_CLASSES_MAP)

// Ícones para o botão de alternância de tema
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

// Nomes amigáveis para o menu de temas
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

// --- DADOS DOS PICKERS (Cores e Emojis) ---

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

// Emojis e seus códigos HTML.
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
  { char: '🤠', code: '&#129312;' },
  { char: '😭', code: '&#128557;' },
  { char: '😱', code: '&#128561;' },
  { char: '😠', code: '&#128544;' },
  { char: '😡', code: '&#128545;' },
  { char: '😢', code: '&#128546;' },
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
  { char: '📌', code: '&#128204;' }
]

// --- CONFIGURAÇÕES DE ATALHOS ---

// Lista de atalhos críticos do navegador/SO que não devem ser sobrescritos.
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
