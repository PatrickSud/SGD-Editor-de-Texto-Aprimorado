/**
 * @file storage.js
 * Gerenciamento de armazenamento (Chrome Storage), migração de dados e controle de temas
 */

/**
 * Recupera os dados armazenados, executando migrações se necessário.
 * Esta versão inclui uma migração transparente de chrome.storage.sync para chrome.storage.local.
 */
async function getStoredData() {
  try {
    // 1. Tenta ler do novo local de armazenamento (local)
    let localResult = await chrome.storage.local.get(STORAGE_KEY)
    let data = localResult[STORAGE_KEY]

    // 2. Se não encontrou dados no local, verifica o local antigo (sync)
    if (!data) {
      const syncResult = await chrome.storage.sync.get(STORAGE_KEY)
      const syncData = syncResult[STORAGE_KEY]

      // 3. Se encontrou dados no sync, migra para o local
      if (syncData) {
        console.log(
          'Editor SGD: Migrando dados do storage.sync para storage.local.'
        )
        await chrome.storage.local.set({ [STORAGE_KEY]: syncData }) // Salva no local
        await chrome.storage.sync.remove(STORAGE_KEY) // Limpa o local antigo
        data = syncData // Usa os dados migrados para continuar
        showNotification(
          'Dados da extensão atualizados para a nova versão!',
          'info',
          4000
        )
      }
    }

    // A partir daqui, o código original de migração de versão continua
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
 * Salva os dados no armazenamento local.
 */
async function saveStoredData(data) {
  try {
    data.version = DATA_VERSION
    // Agora sempre salva no local, que tem mais espaço.
    await chrome.storage.local.set({ [STORAGE_KEY]: data })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar dados.', error)
    showNotification('Falha ao salvar alterações.', 'error')
  }
}

/**
 * Inicializa os dados padrão.
 */
function initializeDefaultData(save = false) {
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
    // Busca tanto as configurações novas quanto as antigas (tema, preview) para migração suave.
    const result = await chrome.storage.sync.get([
      SETTINGS_STORAGE_KEY,
      'editorTheme',
      'previewVisible'
    ])

    const settings = result[SETTINGS_STORAGE_KEY] || {}

    // Mescla as configurações de forma aninhada para garantir que novas chaves sejam adicionadas
    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      toolbarButtons: {
        ...DEFAULT_SETTINGS.toolbarButtons,
        ...(settings.toolbarButtons || {})
      },
      uiSettings: {
        ...DEFAULT_SETTINGS.uiSettings,
        ...(settings.uiSettings || {})
      }
    }

    // Migração suave de chaves antigas para o novo objeto de configurações
    if (result.editorTheme && !mergedSettings.editorTheme) {
      mergedSettings.editorTheme = result.editorTheme
    }
    if (
      result.previewVisible !== undefined &&
      mergedSettings.previewVisible === undefined
    ) {
      mergedSettings.previewVisible = result.previewVisible
    }

    // Validação extra para o período de retenção
    if (
      mergedSettings.reminderRetentionDays < 1 ||
      mergedSettings.reminderRetentionDays > 30
    ) {
      mergedSettings.reminderRetentionDays =
        DEFAULT_SETTINGS.reminderRetentionDays
    }

    return mergedSettings
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
 * Carrega o tema salvo nas configurações e o aplica.
 * Se nenhum tema estiver salvo, usa o padrão ('padrao').
 */
async function loadSavedTheme() {
  const settings = await getSettings()
  let theme = settings.editorTheme || 'padrao'

  // Migração: Se o usuário estava com o tema 'light' (Alvorada), muda para 'padrao'.
  if (theme === 'light') {
    theme = 'padrao'
    await saveSettings({ editorTheme: theme }) // Salva a alteração
  }

  await setTheme(theme)
}

/**
 * Define o tema atual, salva a preferência e atualiza a UI.
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
  // Seleciona todas as instâncias do editor, modais, popups e textareas aprimorados, incluindo o novo preview.
  const themedElements = document.querySelectorAll(
    '.editor-master-container, .editor-container, .editor-modal, .editor-preview-container, #shortcut-popup, textarea[data-enhanced], #notes-side-panel, #floating-scroll-top-btn'
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
  if (!element) return
  const themeClass = THEME_CLASSES_MAP[currentEditorTheme]
  if (themeClass) {
    element.classList.add(themeClass)
  }
}

// --- GERENCIAMENTO DO PAINEL DE VISUALIZAÇÃO (Atualizado para usar Settings) ---

/**
 * Carrega a orientação salva do painel de visualização.
 * @returns {Promise<'horizontal'|'vertical'>} Retorna a orientação.
 */
async function getPreviewOrientationState() {
  const settings = await getSettings()
  return settings.previewOrientation || 'horizontal'
}

/**
 * Salva a orientação do painel de visualização.
 * @param {'horizontal'|'vertical'} orientation - A orientação a ser salva.
 */
async function savePreviewOrientationState(orientation) {
  const settings = await getSettings()
  settings.previewOrientation = orientation
  await saveSettings(settings)
}

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

/**
 * Carrega o estado de redimensionamento do painel de visualização.
 * @returns {Promise<boolean>} Retorna true se deve ser redimensionável, false caso contrário.
 */
async function getPreviewResizableState() {
  const settings = await getSettings()
  return settings.previewResizable === true
}

/**
 * Salva o estado de redimensionamento do painel de visualização.
 * @param {boolean} isResizable - O estado a ser salvo.
 */
async function savePreviewResizableState(isResizable) {
  await saveSettings({ previewResizable: isResizable })
}

// --- GERENCIAMENTO DE ANOTAÇÕES ---

/**
 * Retorna uma estrutura de dados padrão para as anotações.
 * @returns {object}
 */
function getInitialNotesData() {
  const firstBlockId = `note-${Date.now()}`
  return {
    version: 2,
    activeBlockId: firstBlockId,
    blocks: [
      {
        id: firstBlockId,
        title: 'Anotações Gerais',
        content: '',
        associatedUrl: null
      }
    ]
  }
}

/**
 * Recupera o conteúdo das anotações salvas, migrando o formato antigo se necessário.
 * @returns {Promise<object>} O objeto de dados das anotações.
 */
async function getSavedNotes() {
  try {
    const result = await chrome.storage.sync.get(NOTES_STORAGE_KEY)

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

    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY)
    // Usamos um objeto (dicionário) para facilitar a busca por ID.
    return result[REMINDERS_STORAGE_KEY] || {}
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar lembretes.', error)
    return {}
  }
}

/**
 * Função interna para limpar lembretes expirados.
 * Regra: Lembretes com um 'firedAt' timestamp são mantidos pelo tempo configurado pelo usuário.
 */
async function cleanupOldReminders() {
  try {
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

      // Se o lembrete tem uma data de disparo, verifica se já passou o tempo de retenção
      if (reminder.firedAt && now - reminder.firedAt > retentionMs) {
        shouldDelete = true
      }
      // Se não foi disparado, verifica se é um alarme antigo que foi perdido
      else if (!reminder.firedAt) {
        const alarmTime = new Date(reminder.dateTime).getTime()
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
    recurrence: reminderData.recurrence || 'none', // NOVO
    priority: reminderData.priority || 'medium', // NOVO
    createdAt: reminderData.createdAt || Date.now(),
    isFired: false, // Sempre false ao salvar/editar manualmente
    firedAt: null, // Limpa o timestamp do disparo
    // Adiciona o contador de adiamentos, incrementando se já existir
    snoozeCount:
      (reminderData.snoozeCount || 0) + (reminderData.isSnoozed ? 1 : 0)
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

    // 3. Notifica o service worker sobre a criação do lembrete para atualizar o badge
    sendBackgroundMessage({
      action: reminderData.id ? 'REMINDER_UPDATED' : 'REMINDER_CREATED'
    }).catch(error => {
      console.warn('Erro ao notificar criação/atualização de lembrete:', error)
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

      // 3. Notifica o service worker sobre a exclusão do lembrete para atualizar o badge
      sendBackgroundMessage({
        action: 'REMINDER_DISMISSED'
      }).catch(error => {
        console.warn('Erro ao notificar exclusão de lembrete:', error)
      })
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

      // Notifica o service worker sobre as exclusões para atualizar o badge
      sendBackgroundMessage({
        action: 'REMINDER_DISMISSED'
      }).catch(error => {
        console.warn('Erro ao notificar exclusão em massa de lembretes:', error)
      })
    }
  } catch (error) {
    console.error(`Editor SGD: Erro ao excluir múltiplos lembretes.`, error)
    throw error
  }
}

/**
 * Salva a posição do menu flutuante (FAB).
 * @param {string} position - A nova posição (ex: 'bottom-left').
 */
async function saveFabPosition(position) {
  try {
    await saveSettings({ fabPosition: position })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar a posição do FAB.', error)
  }
}

/**
 * Recupera a posição salva do menu flutuante (FAB).
 * @returns {Promise<string>} A posição salva ou o padrão.
 */
async function getFabPosition() {
  const settings = await getSettings()
  return settings.fabPosition || 'bottom-left'
}

/**
 * Aplica as configurações de UI salvas (tamanho de fonte e ícones) ao documento.
 * @param {object} settings - O objeto de configurações da extensão.
 */
function applyUiSettings(settings) {
  const ui = settings.uiSettings || DEFAULT_SETTINGS.uiSettings
  const root = document.documentElement

  // Define as variáveis CSS com base nas configurações
  root.style.setProperty('--ui-icon-scale', ui.iconSize)
  root.style.setProperty('--ui-font-size', `${ui.uiFontSize}px`)
  root.style.setProperty('--editor-font-size', `${ui.editorFontSize}px`)
}

// --- GERENCIAMENTO DE AMOSTRAS DE RESPOSTA (Adaptação de Estilo IA) ---

/**
 * Recupera as amostras de respostas do usuário.
 * @returns {Promise<Array<string>>} Um array de strings com as respostas.
 */
async function getUserResponseSamples() {
  try {
    const result = await chrome.storage.local.get(USER_RESPONSE_SAMPLES_KEY)
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
    await chrome.storage.local.set({ [USER_RESPONSE_SAMPLES_KEY]: samples })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar amostra de resposta.', error)
  }
}

// --- SUGESTÃO INTELIGENTE DE TRÂMITES ---

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

/**
 * Atualiza o nome de uma categoria com validação (obrigatório e não duplicado).
 * @param {string} categoryId - O ID da categoria a ser atualizada.
 * @param {string} newName - O novo nome a ser definido.
 */
async function updateCategoryName(categoryId, newName) {
  try {
    const trimmed = (newName || '').trim()
    if (!trimmed) {
      throw new Error('O nome da categoria não pode estar vazio.')
    }

    const data = await getStoredData()
    const category = data.categories.find(c => c.id === categoryId)
    if (!category) {
      throw new Error('Categoria não encontrada para atualizar o nome.')
    }

    const lower = trimmed.toLowerCase()
    const isDuplicate = data.categories.some(
      c => c.id !== categoryId && (c.name || '').trim().toLowerCase() === lower
    )
    if (isDuplicate) {
      throw new Error(`Nome de categoria duplicado: "${trimmed}"`)
    }

    category.name = trimmed
    await saveStoredData(data)
  } catch (error) {
    console.error('Editor SGD: Erro ao atualizar nome da categoria.', error)
    // Propaga o erro para a UI poder notificar o usuário.
    throw error
  }
}
/**
 * Verifica se o modo de desenvolvedor está ativo.
 * @returns {Promise<boolean>} Retorna true se o modo dev estiver ativado.
 */
async function isDevModeEnabled() {
  try {
    // Usamos 'local' para que a configuração não seja sincronizada.
    const result = await chrome.storage.local.get(DEV_MODE_KEY)
    // Acessa a chave diretamente e retorna true se o valor for exatamente true.
    return result[DEV_MODE_KEY] === true
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao verificar o modo de desenvolvedor.',
      error
    )
    return false
  }
}

/**
 * Alterna (liga/desliga) o modo de desenvolvedor.
 * @returns {Promise<boolean>} Retorna o novo estado do modo dev (true se ativado, false se desativado).
 */
async function toggleDevMode() {
  const isEnabled = await isDevModeEnabled()
  const newState = !isEnabled
  try {
    await chrome.storage.local.set({ [DEV_MODE_KEY]: newState })
    console.log(`Modo de desenvolvedor alterado para: ${newState}`)
    return newState
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao alternar o modo de desenvolvedor.',
      error
    )
    return isEnabled // Retorna ao estado anterior em caso de erro
  }
}

/**
 * Salva o objeto completo de lembretes no armazenamento.
 * @param {object} reminders - O objeto de dados completo de lembretes a ser salvo.
 */
async function saveAllReminders(reminders) {
  try {
    await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar todos os lembretes.', error)
    throw error // Propaga o erro para a UI
  }
}

// --- GERENCIAMENTO DE SAUDAÇÕES E ENCERRAMENTOS ---

/**
 * Recupera as saudações e encerramentos salvos, incluindo os IDs padrão.
 * @returns {Promise<{greetings: Array<object>, closings: Array<object>, defaultGreetingId: string|null, defaultClosingId: string|null}>}
 */
async function getGreetingsAndClosings() {
  try {
    const result = await chrome.storage.sync.get(GREETINGS_CLOSINGS_KEY)
    let data = result[GREETINGS_CLOSINGS_KEY]

    // Se não houver dados, inicializa com exemplos e define o primeiro de cada lista como padrão
    if (!data || !data.greetings || !data.closings) {
      const initialGreetings = [
        {
          id: `grt-${Date.now()}`,
          title: 'Simples',
          content:
            "[saudacao], [usuario]! Tudo bem? Espero que sim! <nobr style='font-size:18px;'>&#128516;</nobr>",
          shortcut: ''
        },
        {
          id: `grt-${Date.now() + 1}`,
          title: 'Contato e Acesso',
          content:
            "[saudacao], [usuario]! Tudo bem? Espero que sim!<nobr style='font-size:20px;'>&#128521;</nobr> \n \nConforme contato telefônico e conexão remota a máquina ",
          shortcut: ''
        },
        {
          id: `grt-${Date.now() + 3}`,
          title: 'Agradecendo',
          content:
            "[saudacao], [usuario]! Tudo bem? \n \nAgradeço pelo envio das informações/arquivos. \nJá estou analisando o seu caso e em breve retorno com novidades. <nobr style='font-size:18px;'>👍</nobr>",
          shortcut: ''
        }
      ]
      const initialClosings = [
        {
          id: `cls-${Date.now()}`,
          title: 'Simples',
          content:
            "Se surgir alguma dúvida sobre o atendimento, estou aqui para ajudar!\n\nSeguimos à disposição.\n[finalizacao]! <nobr style='font-size:18px;'>&#128075;</nobr>",
          shortcut: ''
        },
        {
          id: `cls-${Date.now() + 1}`,
          title: 'Aguardando Retorno',
          content:
            "Fico no aguardo de seu Retorno, \n[finalizacao]! <nobr style='font-size:18px;'>&#128522;</nobr>",
          shortcut: ''
        },
        {
          id: `cls-${Date.now() + 2}`,
          title: 'Com Reforma Tributária',
          content: `Se surgir alguma dúvida sobre o atendimento, estou aqui para ajudar! Por favor, sinta-se à vontade para retornar.

Agora, se tudo estiver resolvido, marque a situação como <strong><span style="color:#fa6400">'Atendimento Concluído'</span></strong> para nos ajudar a garantir a qualidade do suporte. Estamos aqui para você! &#x1F31F;	
   <span style="color:#FF7F00;"> __________________________________________________________________________________________________________________________________________________________________________</span>
Prepare-se para a <strong>Reforma Tributária</strong>! Ative o módulo da Domínio até <strong>30/11/2025</strong> e tenha acesso gratuito a ele e a todas as novas funcionalidades enquanto seu contrato estiver vigente.
 
<span style="font-size: 1.2em;">&#128073;</span> <a href="https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=11999" style="color: rgb(250, 100, 0);"><strong>Clique aqui para mais informações e saiba como ativar!</strong></a>
 
Seguimos à disposição.
[finalizacao]! <nobr style='font-size:19px;'>&#128075;</nobr>`,
          shortcut: ''
        },
        {
          id: `cls-${Date.now() + 6}`,
          title: 'Feliz em ajudar',
          content: `Fico feliz em ajudar! Se não houver mais nenhuma dúvida, peço a gentileza de avaliar meu atendimento marcando a situação como <strong><span style="color:#fa6400">'Atendimento Concluído'</span></strong>. \nSua opinião é muito importante para nós!\n\n[finalizacao]! <nobr style='font-size:18px;'>&#10024;</nobr>`,
          shortcut: ''
        },
        {
          id: `cls-${Date.now() + 7}`,
          title: 'Acesso Remoto',
          content: `<b>Você sabia?! Nosso suporte via acesso remoto pode ser ainda mais ágil! </b><nobr style='font-size:20px;'>&#9757;</nobr></b><nobr style='font-size:20px;'>&#129299;</nobr> 
 
 Pesquise pela ferramenta “<b>Acesso Remoto - Domínio Sistemas</b>”, instalada em sua máquina: <img src="https://www.dropbox.com/scl/fi/495canzpdjs211hh6la45/acesso.gif?rlkey=5khplj8wi64db0xyv2rsrql5a&st=y923wzze&raw=1"  width="200" height="32" border="0" alt="iniciar"> ou clique na imagem abaixo para baixar e instalar! 
 
 <a href="https://download.dominiosistemas.com.br/Suporte/AcessoRemoto/LogMeInRescueCallingCard.msi" target="_blank"> 
 
 <img src="https://www.dropbox.com/scl/fi/byeq2k2diaqq9wqv2sk3r/acesso_icon.png?rlkey=qky0l9byalcwojsi04xpq7o88&st=ybvth8cw&raw=1"  width="250" height="118" border="0" alt="acesso_remoto"></a> 
 
 [finalizacao]! <nobr style='font-size:18px;'>&#10024;</nobr>`,
          shortcut: ''
        }
      ]

      data = {
        greetings: initialGreetings,
        closings: initialClosings,
        defaultGreetingId: null,
        defaultClosingId: null
      }
      await saveGreetingsAndClosings(data)
    }

    // Garante que as propriedades de ID padrão existam para dados antigos
    if (data.defaultGreetingId === undefined) data.defaultGreetingId = null
    if (data.defaultClosingId === undefined) data.defaultClosingId = null

    return data
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao carregar saudações e encerramentos.',
      error
    )
    return {
      greetings: [],
      closings: [],
      defaultGreetingId: null,
      defaultClosingId: null
    }
  }
}

/**
 * Salva o objeto de saudações e encerramentos.
 * @param {{greetings: Array<object>, closings: Array<object>}} data
 */
async function saveGreetingsAndClosings(data) {
  try {
    // Garante que a propriedade 'order' exista para compatibilidade com drag-drop
    if (data.greetings) {
      data.greetings.forEach((item, index) => {
        if (item.order === undefined) {
          item.order = index
        }
      })
    }
    if (data.closings) {
      data.closings.forEach((item, index) => {
        if (item.order === undefined) {
          item.order = index
        }
      })
    }

    await chrome.storage.sync.set({ [GREETINGS_CLOSINGS_KEY]: data })
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao salvar saudações e encerramentos.',
      error
    )
    showNotification('Falha ao salvar as configurações.', 'error')
  }
}

// --- GERENCIAMENTO DE ATENDIMENTOS SEGUIDOS ---

/**
 * Recupera todos os atendimentos seguidos.
 * @returns {Promise<object>} Objeto onde as chaves são os IDs dos atendimentos.
 */
async function getFollowedAttendances() {
  try {
    const result = await chrome.storage.sync.get(FOLLOWED_ATTENDANCES_KEY)
    return result[FOLLOWED_ATTENDANCES_KEY] || {}
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar atendimentos seguidos.', error)
    return {}
  }
}

/**
 * Salva o objeto completo de atendimentos seguidos.
 * @param {object} attendances - O objeto de dados completo a ser salvo.
 */
async function saveFollowedAttendances(attendances) {
  try {
    await chrome.storage.sync.set({ [FOLLOWED_ATTENDANCES_KEY]: attendances })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar atendimentos seguidos.', error)
    throw error
  }
}

/**
 * Adiciona ou atualiza um atendimento seguido.
 * @param {object} attendanceData - Dados do atendimento (id, subject, url, lastContentHash).
 */
async function saveFollowedAttendance(attendanceData) {
  if (
    !attendanceData.id ||
    !attendanceData.url ||
    !attendanceData.lastContentHash
  ) {
    throw new Error(
      'ID, URL e Hash de conteúdo são obrigatórios para seguir um atendimento.'
    )
  }
  try {
    const attendances = await getFollowedAttendances()
    const now = Date.now()
    const existing = attendances[attendanceData.id]

    attendances[attendanceData.id] = {
      id: attendanceData.id,
      subject:
        attendanceData.subject ||
        (existing ? existing.subject : 'Assunto não capturado'),
      url: attendanceData.url,
      status: attendanceData.status || 'monitoring', // 'monitoring', 'updated', 'concluded'
      lastContentHash: attendanceData.lastContentHash,
      lastCheckedAt: now,
      addedAt: existing ? existing.addedAt : now,
      updatedAt:
        attendanceData.status === 'updated'
          ? now
          : existing
          ? existing.updatedAt
          : null
    }
    await saveFollowedAttendances(attendances)

    // Notifica o service worker sobre a mudança para atualizar alarmes/badges se necessário
    chrome.runtime
      .sendMessage({ action: 'FOLLOW_STATUS_CHANGED' })
      .catch(err =>
        console.warn('Erro ao notificar SW sobre mudança de follow:', err)
      )

    return attendances[attendanceData.id]
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar atendimento seguido.', error)
    throw error
  }
}

/**
 * Remove um atendimento da lista de seguidos.
 * @param {string} attendanceId - O ID do atendimento a ser removido.
 */
async function removeFollowedAttendance(attendanceId) {
  try {
    const attendances = await getFollowedAttendances()
    if (attendances[attendanceId]) {
      delete attendances[attendanceId]
      await saveFollowedAttendances(attendances)
      // Notifica o service worker
      chrome.runtime
        .sendMessage({ action: 'FOLLOW_STATUS_CHANGED' })
        .catch(err =>
          console.warn('Erro ao notificar SW sobre remoção de follow:', err)
        )
    }

    /**
     * Marca o status de um atendimento seguido e salva.
     * @param {string} attendanceId
     * @param {'monitoring'|'updated'|'concluded'} status
     */
    async function markAttendanceStatus(attendanceId, status) {
      const attendances = await getFollowedAttendances()
      if (!attendances[attendanceId]) return
      attendances[attendanceId].status = status
      if (status === 'updated') {
        attendances[attendanceId].updatedAt = Date.now()
      }
      await saveFollowedAttendances(attendances)
      try {
        await chrome.runtime.sendMessage({ action: 'FOLLOW_STATUS_CHANGED' })
      } catch {}
    }
  } catch (error) {
    console.error(
      `Editor SGD: Erro ao remover atendimento seguido ${attendanceId}.`,
      error
    )
    throw error
  }
}

// --- CONTROLE DE VERSÃO VISTA ---

/**
 * Recupera a última versão da extensão que o usuário viu as novidades.
 * @returns {Promise<string|null>} A versão ou null se nunca foi vista.
 */
async function getLastSeenVersion() {
  try {
    const result = await chrome.storage.local.get(LAST_SEEN_VERSION_KEY)
    return result[LAST_SEEN_VERSION_KEY] || null
  } catch (error) {
    console.error('Editor SGD: Erro ao obter a última versão vista.', error)
    return null
  }
}

/**
 * Salva a versão atual da extensão como a última vista pelo usuário.
 * @param {string} version - A versão a ser salva.
 */
async function setLastSeenVersion(version) {
  try {
    await chrome.storage.local.set({ [LAST_SEEN_VERSION_KEY]: version })
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar a última versão vista.', error)
  }
}

/**
 * Obtém notas pendentes de versões menores.
 * @returns {Promise<string[]>} Lista de notas acumuladas.
 */
async function getPendingMinorNotes() {
  try {
    const result = await chrome.storage.local.get(PENDING_MINOR_NOTES_KEY)
    const notes = result[PENDING_MINOR_NOTES_KEY]
    return Array.isArray(notes) ? notes : []
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao obter notas pendentes de versões menores.',
      error
    )
    return []
  }
}

/**
 * Adiciona uma nota pendente de versão menor para ser exibida na próxima versão cheia.
 * @param {string} note - Texto/HTML da nota.
 */
async function addPendingMinorNote(note) {
  try {
    const existing = await getPendingMinorNotes()
    const sanitized = typeof note === 'string' ? note : String(note)
    existing.push(sanitized)
    await chrome.storage.local.set({ [PENDING_MINOR_NOTES_KEY]: existing })
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao adicionar nota pendente de versão menor.',
      error
    )
  }
}

/**
 * Limpa todas as notas pendentes de versões menores.
 */
async function clearPendingMinorNotes() {
  try {
    await chrome.storage.local.remove(PENDING_MINOR_NOTES_KEY)
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao limpar notas pendentes de versões menores.',
      error
    )
  }
}
