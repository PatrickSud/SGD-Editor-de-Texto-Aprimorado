/**
 * @file storage.js
 * @description Gerenciamento de armazenamento (Chrome Storage), migração de dados e controle de temas.
 */

// --- ESTRUTURA DE DADOS E MIGRAÇÃO ---

/**
 * Recupera os dados armazenados, executando migrações se necessário.
 */
async function getStoredData() {
  // ... (A função getStoredData permanece inalterada)
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(STORAGE_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(data)
      })
    })

    let data = result[STORAGE_KEY]

    // Verifica se a migração é necessária (qualquer versão anterior ou dados corrompidos)
    if (!data || data.version !== DATA_VERSION || Array.isArray(data)) {
      data = await runDataMigration(data)
    }

    // Verifica corrupção final.
    if (
      !data ||
      !Array.isArray(data.categories) ||
      !Array.isArray(data.messages)
    ) {
      return initializeDefaultData(true)
    }

    return data
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar dados.', error)
    return initializeDefaultData(false)
  }
}

/**
 * Salva os dados no armazenamento.
 */
async function saveStoredData(data) {
  // ... (A função saveStoredData permanece inalterada)
  try {
    data.version = DATA_VERSION
    await chrome.storage.sync.set({ [STORAGE_KEY]: data })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar dados.', error)
    showNotification('Falha ao salvar alterações.', 'error')
  }
}

/**
 * Inicializa os dados padrão.
 */
function initializeDefaultData(save = false) {
  // ... (A função initializeDefaultData permanece inalterada)
  const timestamp = Date.now()
  const defaultCategories = [
    { id: `cat-${timestamp}-0`, name: 'Geral', shortcut: 'alt+0' },
    { id: `cat-${timestamp}-1`, name: '13 - Folha', shortcut: 'alt+1' },
    { id: `cat-${timestamp}-3`, name: '31 - Onvio', shortcut: 'alt+3' },
    { id: `cat-${timestamp}-8`, name: 'Trâmites Padrões', shortcut: 'alt+8' }
  ]

  const defaultData = {
    version: DATA_VERSION,
    categories: defaultCategories,
    messages: []
  }
  if (save) {
    saveStoredData(defaultData)
  }
  return defaultData
}

/**
 * Migração de versões antigas (V1, V2) para a estrutura atual (V3).
 */
async function runDataMigration(data) {
  // ... (A função runDataMigration permanece inalterada)
  // Se não houver dados, inicializa padrão.
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return initializeDefaultData(true)
  }

  let newData = JSON.parse(JSON.stringify(data)) // Deep copy para manipulação segura

  // 1. Migração de V1 (ou sem versão) para V2 (Estruturado).
  if (Array.isArray(data) || !data.version || data.version < 2) {
    console.log('Editor SGD: Iniciando migração para V2.')
    // Mantém a migração antiga para preservar dados do usuário.
    const defaultCategoryId = `cat-${Date.now()}`
    let newCategories = [
      { id: defaultCategoryId, name: 'Geral (Migrado)', shortcut: '' }
    ]
    let newMessages = []

    if (Array.isArray(data)) {
      // Formato mais antigo (array de mensagens).
      newMessages = data.map((msg, index) => ({
        id: `msg-${Date.now() + index}`,
        title: msg.title || 'Sem título',
        message: msg.message || '',
        categoryId: defaultCategoryId
      }))
    } else {
      // Formato intermediário (objeto V1).
      if (
        data.categories &&
        Array.isArray(data.categories) &&
        data.categories.length > 0
      ) {
        newCategories = data.categories.map((cat, index) => ({
          id: cat.id || `cat-${Date.now()}-${index}`,
          name: cat.name || 'Categoria Sem Nome',
          shortcut: cat.shortcut || ''
        }))
      }
      const fallbackCatId = newCategories[0]?.id || defaultCategoryId

      if (data.messages && Array.isArray(data.messages)) {
        newMessages = data.messages.map((msg, index) => ({
          id: msg.id || `msg-${Date.now() + index}`,
          title: msg.title || 'Sem título',
          message: msg.message || '',
          categoryId:
            msg.categoryId && newCategories.some(c => c.id === msg.categoryId)
              ? msg.categoryId
              : fallbackCatId
        }))
      }
    }

    newData = {
      version: 2,
      categories: newCategories,
      messages: newMessages
    }
  }

  // 2. Migração de V2 para V3 (Adicionando propriedade 'order').
  if (newData.version < 3) {
    console.log('Editor SGD: Iniciando migração para V3 (Ordenação).')

    // Agrupa mensagens por categoria para definir a ordem sequencialmente.
    const messagesByCat = {}

    // Inicializa grupos baseado nas categorias existentes.
    if (
      !newData.categories ||
      !Array.isArray(newData.categories) ||
      newData.categories.length === 0
    ) {
      // Se as categorias estiverem corrompidas, reinicializa os dados.
      return initializeDefaultData(true)
    }

    newData.categories.forEach(cat => {
      if (!messagesByCat[cat.id]) {
        messagesByCat[cat.id] = []
      }
    })

    // Distribui as mensagens nos grupos.
    if (newData.messages && Array.isArray(newData.messages)) {
      newData.messages.forEach(msg => {
        if (messagesByCat[msg.categoryId]) {
          messagesByCat[msg.categoryId].push(msg)
        } else {
          // Mensagens órfãs (categoria não existe mais) - move para a primeira categoria válida.
          const firstCatId = newData.categories[0]?.id
          if (firstCatId) {
            msg.categoryId = firstCatId
            // Cria o grupo se necessário
            if (!messagesByCat[firstCatId]) {
              messagesByCat[firstCatId] = []
            }
            messagesByCat[firstCatId].push(msg)
          }
        }
      })
    }

    // Reconstroi o array de mensagens com a propriedade 'order' definida.
    const orderedMessages = []
    Object.values(messagesByCat).forEach(catMessages => {
      catMessages.forEach((msg, index) => {
        msg.order = index
        orderedMessages.push(msg)
      })
    })

    newData.messages = orderedMessages
    newData.version = 3
  }

  // Salva os dados migrados se a versão mudou.
  if (newData.version !== (data.version || 0)) {
    await saveStoredData(newData)
  }

  return newData
}

// --- CONFIGURAÇÕES GERAIS (Consolidado) ---

/**
 * Recupera as configurações gerais da extensão.
 * @returns {Promise<object>} As configurações armazenadas ou os padrões.
 */
async function getSettings() {
  try {
    const result = await new Promise((resolve, reject) => {
      // Busca tanto as configurações novas quanto as antigas (tema, preview) para migração suave.
      chrome.storage.sync.get(
        [SETTINGS_STORAGE_KEY, 'editorTheme', 'previewVisible'],
        data => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
          else resolve(data)
        }
      )
    })

    const settings = result[SETTINGS_STORAGE_KEY] || {}

    // Aplica os padrões definidos em config.js se a chave não existir
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (settings[key] === undefined) {
        settings[key] = DEFAULT_SETTINGS[key]
      }
    })

    // Migração suave de chaves antigas para o novo objeto de configurações
    if (result.editorTheme && !settings.editorTheme) {
      settings.editorTheme = result.editorTheme
    }
    if (
      result.previewVisible !== undefined &&
      settings.previewVisible === undefined
    ) {
      settings.previewVisible = result.previewVisible
    }

    // Validação extra para o período de retenção
    if (
      settings.reminderRetentionDays < 1 ||
      settings.reminderRetentionDays > 30
    ) {
      settings.reminderRetentionDays = DEFAULT_SETTINGS.reminderRetentionDays
    }

    return settings
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar configurações.', error)
    return { ...DEFAULT_SETTINGS } // Retorna padrões em caso de erro
  }
}

/**
 * Salva as configurações gerais da extensão (Merge com as existentes).
 * @param {object} newSettings - Objeto com as configurações a serem atualizadas.
 */
async function saveSettings(newSettings) {
  try {
    const currentSettings = await getSettings()
    const mergedSettings = { ...currentSettings, ...newSettings }

    // Validação antes de salvar
    if (
      mergedSettings.reminderRetentionDays < 1 ||
      mergedSettings.reminderRetentionDays > 30
    ) {
      throw new Error('Período de retenção inválido (1-30 dias).')
    }

    await chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: mergedSettings })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar configurações.', error)
    throw error // Propaga o erro para a UI
  }
}

/**
 * Helper específico para obter a chave de API do Gemini.
 * @returns {Promise<string>} A chave de API ou string vazia.
 */
async function getGeminiApiKey() {
  const settings = await getSettings()
  return settings.geminiApiKey || ''
}

// --- GERENCIAMENTO DE TEMA (Atualizado para usar Settings) ---

/**
 * Carrega o tema salvo do armazenamento.
 */
async function loadSavedTheme() {
  const settings = await getSettings()
  currentEditorTheme = settings.editorTheme || 'light'
}

/**
 * Define um tema específico e salva a preferência.
 * @param {string} themeName - O nome do tema a ser aplicado (ex: 'dark', 'forest').
 */
async function setTheme(themeName) {
  // Valida se o tema existe na lista de temas permitidos
  if (!THEMES.includes(themeName)) {
    console.error(`Editor SGD: Tema inválido "${themeName}".`)
    return
  }

  currentEditorTheme = themeName

  // Salva a preferência nas configurações gerais
  await saveSettings({ editorTheme: currentEditorTheme })
  updateThemeOnElements()
}

/**
 * Atualiza as classes CSS nos elementos da extensão.
 */
function updateThemeOnElements() {
  // ... (A função updateThemeOnElements permanece inalterada)
  // Seleciona todas as instâncias do editor, modais, popups e textareas aprimorados, incluindo o novo preview.
  const themedElements = document.querySelectorAll(
    '.editor-container, .editor-modal, .editor-preview-container, #shortcut-popup, textarea[data-enhanced], #notes-side-panel, #floating-scroll-top-btn'
  )

  themedElements.forEach(el => {
    if (!el) return
    // Remove todas as classes de tema possíveis
    el.classList.remove(...ALL_THEME_CLASSES)
    // Adiciona a classe do tema atual, se existir
    const themeClass = THEME_CLASSES_MAP[currentEditorTheme]
    if (themeClass) {
      el.classList.add(themeClass)
    }
  })

  // Atualiza o ícone em todos os botões de tema existentes.
  const themeButtons = document.querySelectorAll(
    '[data-action="theme-menu-button"]'
  )
  themeButtons.forEach(button => {
    button.textContent = THEME_ICONS[currentEditorTheme] || '🎨'
  })
}

/**
 * Aplica o tema atual a um elemento recém-criado.
 */
function applyCurrentTheme(element) {
  // ... (A função applyCurrentTheme permanece inalterada)
  if (!element) return
  const themeClass = THEME_CLASSES_MAP[currentEditorTheme]
  if (themeClass) {
    element.classList.add(themeClass)
  }
}

// --- GERENCIAMENTO DO PAINEL DE VISUALIZAÇÃO (Atualizado para usar Settings) ---

/**
 * Carrega o estado de visibilidade do painel de visualização.
 * @returns {Promise<boolean>} Retorna true se deve ser visível, false caso contrário.
 */
async function getPreviewState() {
  const settings = await getSettings()
  // Padrão é true (visível) se nunca foi definido.
  return settings.previewVisible !== false
}

/**
 * Salva o estado de visibilidade do painel de visualização.
 * @param {boolean} isVisible - O estado a ser salvo.
 */
async function savePreviewState(isVisible) {
  await saveSettings({ previewVisible: isVisible })
}

// --- GERENCIAMENTO DE ANOTAÇÕES ---

// ... (Funções de Anotações permanecem inalteradas)

/**
 * Retorna uma estrutura de dados padrão para as anotações.
 * @returns {object}
 */
function getInitialNotesData() {
  const firstBlockId = `note-${Date.now()}`
  return {
    version: 2,
    activeBlockId: firstBlockId,
    blocks: [{ id: firstBlockId, title: 'Anotações Gerais', content: '' }]
  }
}

/**
 * Recupera o conteúdo das anotações salvas, migrando o formato antigo se necessário.
 * @returns {Promise<object>} O objeto de dados das anotações.
 */
async function getSavedNotes() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(NOTES_STORAGE_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(data)
      })
    })

    const notesData = result[NOTES_STORAGE_KEY]

    // Se não houver dados, inicializa com a nova estrutura.
    if (!notesData) {
      return getInitialNotesData()
    }

    // Migração: Se os dados forem uma string (formato antigo V1).
    if (typeof notesData === 'string') {
      const initialData = getInitialNotesData()
      initialData.blocks[0].content = notesData
      initialData.blocks[0].title = 'Anotações Antigas (Migrado)'
      // Salva os dados já migrados.
      await saveNotes(initialData)
      return initialData
    }

    // Se for um objeto, mas sem a estrutura esperada, reinicializa.
    if (typeof notesData !== 'object' || !Array.isArray(notesData.blocks)) {
      return getInitialNotesData()
    }

    return notesData
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar anotações.', error)
    return getInitialNotesData()
  }
}

/**
 * Salva o objeto de dados das anotações.
 * @param {object} data - O objeto de dados completo a ser salvo.
 */
async function saveNotes(data) {
  try {
    await chrome.storage.sync.set({ [NOTES_STORAGE_KEY]: data })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar anotações.', error)
  }
}

// --- GERENCIAMENTO DE LEMBRETES (REMINDERS) ---

/**
 * Função auxiliar para enviar mensagens ao Service Worker e aguardar a resposta.
 */
async function sendBackgroundMessage(message) {
  try {
    // Em MV3, chrome.runtime.sendMessage retorna uma Promise se nenhum callback for fornecido.
    const response = await chrome.runtime.sendMessage(message)

    // Verifica se a resposta foi bem-sucedida.
    if (!response || !response.success) {
      const errorMsg = response
        ? response.error
        : 'Background script não respondeu com sucesso.'
      throw new Error(errorMsg)
    }
    return response
  } catch (error) {
    // Captura erros de comunicação ou erros reportados pelo background.
    console.error(
      `Comunicação com o background falhou para a ação ${message.action}:`,
      error
    )
    throw new Error(`Falha na operação de background: ${error.message}`)
  }
}

/**
 * Recupera todos os lembretes armazenados.
 * @returns {Promise<object>} Um objeto onde as chaves são os IDs dos lembretes.
 */
async function getReminders() {
  try {
    // Limpa lembretes antigos/disparados antes de retornar os ativos.
    await cleanupOldReminders()

    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(REMINDERS_STORAGE_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(data)
      })
    })
    // Usamos um objeto (dicionário) para facilitar a busca por ID.
    return result[REMINDERS_STORAGE_KEY] || {}
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar lembretes.', error)
    return {}
  }
}

/**
 * Função interna para limpar lembretes expirados.
 * Regra: Lembretes disparados (isFired=true) são mantidos pelo tempo configurado pelo usuário.
 */
async function cleanupOldReminders() {
  try {
    // 1. Carrega as configurações para obter o período de retenção
    const settings = await getSettings()
    const retentionMs = settings.reminderRetentionDays * 24 * 60 * 60 * 1000
    const FIVE_MINUTES_MS = 5 * 60 * 1000

    // 2. Carrega os lembretes
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY)
    const reminders = result[REMINDERS_STORAGE_KEY] || {}
    const now = Date.now()
    let changed = false

    for (const id in reminders) {
      const reminder = reminders[id]
      let shouldDelete = false

      if (reminder.isFired) {
        // Caso 1: Disparado. Excluir se tiver passado o tempo de retenção configurado.
        if (reminder.firedAt && now - reminder.firedAt > retentionMs) {
          shouldDelete = true
        }
      } else {
        // Caso 2: Não disparado (Ativo ou Perdido).
        const alarmTime = new Date(reminder.dateTime).getTime()
        // Excluir se o tempo do alarme já passou significativamente (Alarme Perdido).
        if (alarmTime < now - FIVE_MINUTES_MS) {
          shouldDelete = true
        }
      }

      if (shouldDelete) {
        delete reminders[id]
        changed = true
        // Pede ao background para limpar o alarme também (melhor esforço).
        sendBackgroundMessage({ action: 'CLEAR_ALARM', reminderId: id }).catch(
          err => {
            console.warn(
              'Erro ao limpar alarme durante cleanup (background pode estar inativo):',
              err
            )
          }
        )
      }
    }

    if (changed) {
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })
    }
  } catch (error) {
    console.error('Editor SGD: Erro ao limpar lembretes antigos.', error)
  }
}

/**
 * Salva um novo lembrete ou atualiza um existente no storage e agenda o alarme via Service Worker.
 * @param {object} reminderData - Dados do lembrete.
 */
async function saveReminder(reminderData) {
  if (!reminderData.dateTime) {
    throw new Error('A data e hora do lembrete são obrigatórias.')
  }

  const reminderId = reminderData.id || `reminder-${crypto.randomUUID()}`
  const alarmTime = new Date(reminderData.dateTime).getTime()

  if (isNaN(alarmTime) || alarmTime <= Date.now() + 1000) {
    throw new Error('A data e hora do lembrete devem ser futuras.')
  }

  // Ao salvar ou editar manualmente, resetamos o estado de disparo.
  const reminder = {
    id: reminderId,
    title: reminderData.title,
    dateTime: reminderData.dateTime,
    description: reminderData.description || '',
    url: reminderData.url || '',
    createdAt: reminderData.createdAt || Date.now(),
    isFired: false, // Sempre false ao salvar/editar manualmente
    firedAt: null // Limpa o timestamp do disparo
  }

  try {
    // 1. Salva no storage
    // Buscamos diretamente para garantir consistência.
    const storageResult = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY)
    const reminders = storageResult[REMINDERS_STORAGE_KEY] || {}

    reminders[reminderId] = reminder
    await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })

    // 2. Agenda o alarme via mensagem para o Service Worker
    await sendBackgroundMessage({
      action: 'SET_ALARM',
      reminderId: reminderId,
      alarmTime: alarmTime
    })

    return reminderId
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao salvar lembrete ou agendar alarme.',
      error
    )

    // Tentativa de rollback (apenas para novos lembretes)
    if (!reminderData.id) {
      try {
        const currentRemindersResult = await chrome.storage.sync.get(
          REMINDERS_STORAGE_KEY
        )
        const currentReminders =
          currentRemindersResult[REMINDERS_STORAGE_KEY] || {}
        if (currentReminders[reminderId]) {
          delete currentReminders[reminderId]
          await chrome.storage.sync.set({
            [REMINDERS_STORAGE_KEY]: currentReminders
          })
        }
      } catch (cleanupError) {
        console.error(
          'Erro ao limpar storage após falha no alarme (rollback).',
          cleanupError
        )
      }
    }
    throw error
  }
}

/**
 * Exclui um lembrete do storage e cancela seu alarme via Service Worker.
 * @param {string} reminderId - O ID do lembrete a ser excluído.
 */
async function deleteReminder(reminderId) {
  try {
    // 1. Pede ao background script para cancelar o alarme.
    sendBackgroundMessage({
      action: 'CLEAR_ALARM',
      reminderId: reminderId
    }).catch(error => {
      console.warn(
        `Editor SGD: Não foi possível garantir que o alarme ${reminderId} foi limpo no background:`,
        error
      )
    })

    // 2. Remove do storage
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY)
    const reminders = result[REMINDERS_STORAGE_KEY] || {}

    if (reminders[reminderId]) {
      delete reminders[reminderId]
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })
    }
  } catch (error) {
    console.error(`Editor SGD: Erro ao excluir lembrete ${reminderId}.`, error)
    throw error
  }
}

/**
 * Exclui múltiplos lembretes do storage (usado para limpeza em massa de disparados). (NOVO)
 * @param {Array<string>} reminderIds - Array dos IDs a serem excluídos.
 */
async function deleteMultipleReminders(reminderIds) {
  if (!reminderIds || reminderIds.length === 0) return

  try {
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY)
    const reminders = result[REMINDERS_STORAGE_KEY] || {}
    let changed = false

    for (const id of reminderIds) {
      if (reminders[id]) {
        delete reminders[id]
        changed = true
        // Pede ao background para limpar o alarme (melhor esforço).
        sendBackgroundMessage({ action: 'CLEAR_ALARM', reminderId: id }).catch(
          err => {
            console.warn(
              `Erro ao limpar alarme durante exclusão em massa (${id}):`,
              err
            )
          }
        )
      }
    }

    if (changed) {
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })
    }
  } catch (error) {
    console.error(`Editor SGD: Erro ao excluir múltiplos lembretes.`, error)
    throw error
  }
}

// --- GERENCIAMENTO DE AMOSTRAS DE RESPOSTA (Adaptação de Estilo IA) ---

/**
 * Recupera as amostras de respostas do usuário.
 * @returns {Promise<Array<string>>} Um array de strings com as respostas.
 */
async function getUserResponseSamples() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.local.get(USER_RESPONSE_SAMPLES_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(data)
      })
    })
    // Retorna o array de amostras ou um array vazio se não existir.
    return result[USER_RESPONSE_SAMPLES_KEY] || []
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar amostras de respostas.', error)
    return []
  }
}

/**
 * Salva uma nova amostra de resposta, mantendo o histórico rotativo.
 * @param {string} responseText - O texto da resposta a ser salvo.
 */
async function saveUserResponseSample(responseText) {
  try {
    let samples = await getUserResponseSamples()
    // Adiciona a nova amostra no início do array.
    samples.unshift(responseText)
    // Remove duplicados, mantendo o mais recente.
    samples = [...new Set(samples)]
    // Garante que o histórico não exceda o tamanho máximo.
    if (samples.length > MAX_RESPONSE_SAMPLES) {
      samples = samples.slice(0, MAX_RESPONSE_SAMPLES)
    }
    // Salva o array atualizado.
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [USER_RESPONSE_SAMPLES_KEY]: samples }, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve()
      })
    })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar amostra de resposta.', error)
  }
}

// --- SUGESTÃO INTELIGENTE DE TRÂMITES ---

/**
 * Registra o uso de um texto, incrementando seu contador.
 * @param {string} text - O texto da resposta do usuário.
 */
async function logResponseUsage(text) {
  try {
    // Usamos chrome.storage.local para dados mais frequentes e maiores.
    const result = await chrome.storage.local.get(USAGE_TRACKING_KEY)
    const trackingData = result[USAGE_TRACKING_KEY] || {
      hashes: {},
      content: {}
    }
    const hash = simpleHash(text)

    // Incrementa o contador para o hash
    trackingData.hashes[hash] = (trackingData.hashes[hash] || 0) + 1
    // Armazena o conteúdo completo associado ao hash, sobrescrevendo para manter o mais recente.
    trackingData.content[hash] = text

    await chrome.storage.local.set({ [USAGE_TRACKING_KEY]: trackingData })
  } catch (error) {
    console.error('Editor SGD: Erro ao registrar uso de resposta.', error)
  }
}

/**
 * Recupera as sugestões de trâmites pendentes.
 * @returns {Promise<Array<object>>}
 */
async function getSuggestedTramites() {
  try {
    const result = await chrome.storage.sync.get(SUGGESTED_TRAMITES_KEY)
    return result[SUGGESTED_TRAMITES_KEY] || []
  } catch (error) {
    console.error('Editor SGD: Erro ao buscar sugestões.', error)
    return []
  }
}

/**
 * Remove uma sugestão da lista de pendentes (após o usuário interagir).
 * @param {number} suggestionHash - O hash da sugestão a ser removida.
 */
async function clearSuggestion(suggestionHash) {
  try {
    let suggestions = await getSuggestedTramites()
    suggestions = suggestions.filter(s => s.hash !== suggestionHash)

    await chrome.storage.sync.set({ [SUGGESTED_TRAMITES_KEY]: suggestions })
  } catch (error) {
    console.error('Editor SGD: Erro ao limpar sugestão.', error)
  }
}

/**
 * Adiciona uma nova sugestestão à lista de pendentes.
 * @param {string} text - O texto da nova sugestão.
 */
async function addSuggestedTramite(text) {
  try {
    let suggestions = await getSuggestedTramites()
    const hash = simpleHash(text)

    // Verifica se já existe uma sugestão igual
    const exists = suggestions.some(s => s.hash === hash)
    if (exists) {
      console.warn('Sugestão duplicada, não adicionada:', text)
      return
    }

    // Adiciona a nova sugestão no início da lista
    suggestions.unshift({ text, hash })

    await chrome.storage.sync.set({ [SUGGESTED_TRAMITES_KEY]: suggestions })
  } catch (error) {
    console.error('Editor SGD: Erro ao adicionar sugestão.', error)
  }
}

/**
 * Limpa todas as sugestões armazenadas (usado em configurações).
 */
async function clearAllSuggestions() {
  try {
    await chrome.storage.sync.set({ [SUGGESTED_TRAMITES_KEY]: [] })
  } catch (error) {
    console.error('Editor SGD: Erro ao limpar todas as sugestões.', error)
  }
}

/**
 * Atualiza o atalho de uma categoria específica diretamente no storage.
 * @param {string} categoryId - O ID da categoria a ser atualizada.
 * @param {string} newShortcut - O novo atalho.
 */
async function updateCategoryShortcut(categoryId, newShortcut) {
  try {
    const data = await getStoredData()
    const category = data.categories.find(c => c.id === categoryId)
    if (category) {
      // Valida se o novo atalho (se não for vazio) já está em uso por outra categoria.
      if (
        newShortcut &&
        data.categories.some(
          c => c.id !== categoryId && c.shortcut === newShortcut
        )
      ) {
        throw new Error(`O atalho "${newShortcut}" já está em uso.`)
      }
      category.shortcut = newShortcut
      await saveStoredData(data)
    } else {
      throw new Error('Categoria não encontrada para atualizar o atalho.')
    }
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar o atalho da categoria.', error)
    // Propaga o erro para a UI poder notificar o usuário.
    throw error
  }
}
