/**
 * @file storage.js
 * @description Gerenciamento de armazenamento (Chrome Storage), migração de dados e controle de temas.
 */

// --- ESTRUTURA DE DADOS E MIGRAÇÃO ---

/**
 * Recupera os dados armazenados, executando migrações se necessário.
 */
async function getStoredData() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(STORAGE_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(data);
      });
    });

    let data = result[STORAGE_KEY];

    // Verifica se a migração é necessária (qualquer versão anterior ou dados corrompidos)
    if (!data || data.version !== DATA_VERSION || Array.isArray(data)) {
      data = await runDataMigration(data);
    }

    // Verifica corrupção final.
    if (
      !data ||
      !Array.isArray(data.categories) ||
      !Array.isArray(data.messages)
    ) {
      return initializeDefaultData(true);
    }

    return data;
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar dados.', error);
    return initializeDefaultData(false);
  }
}

/**
 * Salva os dados no armazenamento.
 */
async function saveStoredData(data) {
  try {
    data.version = DATA_VERSION;
    await chrome.storage.sync.set({ [STORAGE_KEY]: data });
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar dados.', error);
    showNotification('Falha ao salvar alterações.', 'error');
  }
}

/**
 * Inicializa os dados padrão.
 */
function initializeDefaultData(save = false) {
  const timestamp = Date.now();
  const defaultCategories = [
    { id: `cat-${timestamp}-0`, name: 'Geral', shortcut: 'alt+0' },
    { id: `cat-${timestamp}-1`, name: '13 - Folha', shortcut: 'alt+1' },
    { id: `cat-${timestamp}-3`, name: '31 - Onvio', shortcut: 'alt+3' },
    { id: `cat-${timestamp}-8`, name: 'Trâmites Padrões', shortcut: 'alt+8' }
  ];

  const defaultData = {
    version: DATA_VERSION,
    categories: defaultCategories,
    messages: []
  };
  if (save) {
    saveStoredData(defaultData);
  }
  return defaultData;
}

/**
 * Migração de versões antigas (V1, V2) para a estrutura atual (V3).
 */
async function runDataMigration(data) {
  // Se não houver dados, inicializa padrão.
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return initializeDefaultData(true);
  }

  let newData = JSON.parse(JSON.stringify(data)); // Deep copy para manipulação segura

  // 1. Migração de V1 (ou sem versão) para V2 (Estruturado).
  if (Array.isArray(data) || !data.version || data.version < 2) {
    console.log('Editor SGD: Iniciando migração para V2.');
    const defaultCategoryId = `cat-${Date.now()}`;
    let newCategories = [
      { id: defaultCategoryId, name: 'Geral (Migrado)', shortcut: '' }
    ];
    let newMessages = [];

    if (Array.isArray(data)) {
      // Formato mais antigo (array de mensagens).
      newMessages = data.map((msg, index) => ({
        id: `msg-${Date.now() + index}`,
        title: msg.title || 'Sem título',
        message: msg.message || '',
        categoryId: defaultCategoryId
      }));
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
        }));
      }
      const fallbackCatId = newCategories[0]?.id || defaultCategoryId;

      if (data.messages && Array.isArray(data.messages)) {
        newMessages = data.messages.map((msg, index) => ({
          id: msg.id || `msg-${Date.now() + index}`,
          title: msg.title || 'Sem título',
          message: msg.message || '',
          categoryId:
            msg.categoryId && newCategories.some(c => c.id === msg.categoryId)
              ? msg.categoryId
              : fallbackCatId
        }));
      }
    }

    newData = {
      version: 2,
      categories: newCategories,
      messages: newMessages
    };
  }

  // 2. Migração de V2 para V3 (Adicionando propriedade 'order').
  if (newData.version < 3) {
    console.log('Editor SGD: Iniciando migração para V3 (Ordenação).');
    const messagesByCat = {};
    if (
      !newData.categories ||
      !Array.isArray(newData.categories) ||
      newData.categories.length === 0
    ) {
      return initializeDefaultData(true);
    }
    newData.categories.forEach(cat => {
      if (!messagesByCat[cat.id]) {
        messagesByCat[cat.id] = [];
      }
    });
    if (newData.messages && Array.isArray(newData.messages)) {
      newData.messages.forEach(msg => {
        if (messagesByCat[msg.categoryId]) {
          messagesByCat[msg.categoryId].push(msg);
        } else {
          const firstCatId = newData.categories[0]?.id;
          if (firstCatId) {
            msg.categoryId = firstCatId;
            if (!messagesByCat[firstCatId]) {
              messagesByCat[firstCatId] = [];
            }
            messagesByCat[firstCatId].push(msg);
          }
        }
      });
    }
    const orderedMessages = [];
    Object.values(messagesByCat).forEach(catMessages => {
      catMessages.forEach((msg, index) => {
        msg.order = index;
        orderedMessages.push(msg);
      });
    });
    newData.messages = orderedMessages;
    newData.version = 3;
  }

  if (newData.version !== (data.version || 0)) {
    await saveStoredData(newData);
  }

  return newData;
}

// --- CONFIGURAÇÕES GERAIS (Consolidado) ---

/**
 * Recupera as configurações gerais da extensão.
 * @returns {Promise<object>} As configurações armazenadas ou os padrões.
 */
async function getSettings() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(
        [SETTINGS_STORAGE_KEY, 'editorTheme', 'previewVisible'],
        data => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(data);
        }
      );
    });

    const settings = result[SETTINGS_STORAGE_KEY] || {};

    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (settings[key] === undefined) {
        settings[key] = DEFAULT_SETTINGS[key];
      }
    });

    if (result.editorTheme && !settings.editorTheme) {
      settings.editorTheme = result.editorTheme;
    }
    if (
      result.previewVisible !== undefined &&
      settings.previewVisible === undefined
    ) {
      settings.previewVisible = result.previewVisible;
    }

    if (
      settings.reminderRetentionDays < 1 ||
      settings.reminderRetentionDays > 30
    ) {
      settings.reminderRetentionDays = DEFAULT_SETTINGS.reminderRetentionDays;
    }

    return settings;
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar configurações.', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Salva as configurações gerais da extensão (Merge com as existentes).
 * @param {object} newSettings - Objeto com as configurações a serem atualizadas.
 */
async function saveSettings(newSettings) {
  try {
    const currentSettings = await getSettings();
    const mergedSettings = { ...currentSettings, ...newSettings };

    if (
      mergedSettings.reminderRetentionDays < 1 ||
      mergedSettings.reminderRetentionDays > 30
    ) {
      throw new Error('Período de retenção inválido (1-30 dias).');
    }

    await chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: mergedSettings });
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar configurações.', error);
    throw error;
  }
}

/**
 * Helper específico para obter a chave de API do Gemini.
 * @returns {Promise<string>} A chave de API ou string vazia.
 */
async function getGeminiApiKey() {
  const settings = await getSettings();
  return settings.geminiApiKey || '';
}

// --- NOVO: GERENCIAMENTO DE AMOSTRAS DE RESPOSTA (PARA APRENDIZADO DE ESTILO) ---

/**
 * Salva uma amostra de resposta do usuário para adaptação de estilo da IA.
 * Usa chrome.storage.local por ser mais adequado para dados maiores e não precisar de sync.
 * @param {string} responseText - O texto completo da resposta enviada.
 */
async function saveResponseSample(responseText) {
    if (!responseText || responseText.trim().length < 100) return; // Salva apenas respostas substanciais

    try {
        const result = await chrome.storage.local.get(RESPONSE_SAMPLES_KEY);
        let samples = result[RESPONSE_SAMPLES_KEY] || [];

        // Adiciona a nova amostra no início
        samples.unshift({
            text: responseText,
            timestamp: Date.now()
        });

        // Mantém a lista dentro do limite definido em config.js
        if (samples.length > MAX_RESPONSE_SAMPLES) {
            samples = samples.slice(0, MAX_RESPONSE_SAMPLES);
        }

        await chrome.storage.local.set({ [RESPONSE_SAMPLES_KEY]: samples });

    } catch (error) {
        console.warn("Editor SGD: Não foi possível salvar a amostra de resposta.", error);
    }
}

/**
 * Recupera todas as amostras de resposta salvas.
 * @returns {Promise<Array<object>>} Uma lista de objetos de amostra.
 */
async function getResponseSamples() {
    try {
        const result = await chrome.storage.local.get(RESPONSE_SAMPLES_KEY);
        return result[RESPONSE_SAMPLES_KEY] || [];
    } catch (error) {
        console.error("Editor SGD: Erro ao recuperar amostras de resposta.", error);
        return [];
    }
}


// --- GERENCIAMENTO DE TEMA ---

async function loadSavedTheme() {
  const settings = await getSettings();
  currentEditorTheme = settings.editorTheme || 'light';
}

async function setTheme(themeName) {
  if (!THEMES.includes(themeName)) {
    console.error(`Editor SGD: Tema inválido "${themeName}".`);
    return;
  }
  currentEditorTheme = themeName;
  await saveSettings({ editorTheme: currentEditorTheme });
  updateThemeOnElements();
}

function updateThemeOnElements() {
  const themedElements = document.querySelectorAll(
    '.editor-container, .editor-modal, .editor-preview-container, #shortcut-popup, textarea[data-enhanced], #notes-side-panel, #floating-scroll-top-btn'
  );
  themedElements.forEach(el => {
    if (!el) return;
    el.classList.remove(...ALL_THEME_CLASSES);
    const themeClass = THEME_CLASSES_MAP[currentEditorTheme];
    if (themeClass) {
      el.classList.add(themeClass);
    }
  });
  const themeButtons = document.querySelectorAll(
    '[data-action="theme-menu-button"]'
  );
  themeButtons.forEach(button => {
    button.textContent = THEME_ICONS[currentEditorTheme] || '🎨';
  });
}

function applyCurrentTheme(element) {
  if (!element) return;
  const themeClass = THEME_CLASSES_MAP[currentEditorTheme];
  if (themeClass) {
    element.classList.add(themeClass);
  }
}

// --- GERENCIAMENTO DO PAINEL DE VISUALIZAÇÃO ---

async function getPreviewState() {
  const settings = await getSettings();
  return settings.previewVisible !== false;
}

async function savePreviewState(isVisible) {
  await saveSettings({ previewVisible: isVisible });
}

// --- GERENCIAMENTO DE ANOTAÇÕES ---

function getInitialNotesData() {
  const firstBlockId = `note-${Date.now()}`;
  return {
    version: 2,
    activeBlockId: firstBlockId,
    blocks: [{ id: firstBlockId, title: 'Anotações Gerais', content: '' }]
  };
}

async function getSavedNotes() {
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(NOTES_STORAGE_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(data);
      });
    });
    const notesData = result[NOTES_STORAGE_KEY];
    if (!notesData) {
      return getInitialNotesData();
    }
    if (typeof notesData === 'string') {
      const initialData = getInitialNotesData();
      initialData.blocks[0].content = notesData;
      initialData.blocks[0].title = 'Anotações Antigas (Migrado)';
      await saveNotes(initialData);
      return initialData;
    }
    if (typeof notesData !== 'object' || !Array.isArray(notesData.blocks)) {
      return getInitialNotesData();
    }
    return notesData;
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar anotações.', error);
    return getInitialNotesData();
  }
}

async function saveNotes(data) {
  try {
    await chrome.storage.sync.set({ [NOTES_STORAGE_KEY]: data });
  } catch (error) {
    console.error('Editor SGD: Erro ao salvar anotações.', error);
  }
}

// --- GERENCIAMENTO DE LEMBRETES (REMINDERS) ---

async function sendBackgroundMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || !response.success) {
      const errorMsg = response ?
        response.error :
        'Background script não respondeu com sucesso.';
      throw new Error(errorMsg);
    }
    return response;
  } catch (error) {
    console.error(
      `Comunicação com o background falhou para a ação ${message.action}:`,
      error
    );
    throw new Error(`Falha na operação de background: ${error.message}`);
  }
}

async function getReminders() {
  try {
    await cleanupOldReminders();
    const result = await new Promise((resolve, reject) => {
      chrome.storage.sync.get(REMINDERS_STORAGE_KEY, data => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(data);
      });
    });
    return result[REMINDERS_STORAGE_KEY] || {};
  } catch (error) {
    console.error('Editor SGD: Erro ao carregar lembretes.', error);
    return {};
  }
}

async function cleanupOldReminders() {
  try {
    const settings = await getSettings();
    const retentionMs = settings.reminderRetentionDays * 24 * 60 * 60 * 1000;
    const FIVE_MINUTES_MS = 5 * 60 * 1000;
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const reminders = result[REMINDERS_STORAGE_KEY] || {};
    const now = Date.now();
    let changed = false;
    for (const id in reminders) {
      const reminder = reminders[id];
      let shouldDelete = false;
      if (reminder.isFired) {
        if (reminder.firedAt && now - reminder.firedAt > retentionMs) {
          shouldDelete = true;
        }
      } else {
        const alarmTime = new Date(reminder.dateTime).getTime();
        if (alarmTime < now - FIVE_MINUTES_MS) {
          shouldDelete = true;
        }
      }
      if (shouldDelete) {
        delete reminders[id];
        changed = true;
        sendBackgroundMessage({ action: 'CLEAR_ALARM', reminderId: id }).catch(
          err => {
            console.warn(
              'Erro ao limpar alarme durante cleanup (background pode estar inativo):',
              err
            );
          }
        );
      }
    }
    if (changed) {
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders });
    }
  } catch (error) {
    console.error('Editor SGD: Erro ao limpar lembretes antigos.', error);
  }
}

async function saveReminder(reminderData) {
  if (!reminderData.dateTime) {
    throw new Error('A data e hora do lembrete são obrigatórias.');
  }
  const reminderId = reminderData.id || `reminder-${crypto.randomUUID()}`;
  const alarmTime = new Date(reminderData.dateTime).getTime();
  if (isNaN(alarmTime) || alarmTime <= Date.now() + 1000) {
    throw new Error('A data e hora do lembrete devem ser futuras.');
  }
  const reminder = {
    id: reminderId,
    title: reminderData.title,
    dateTime: reminderData.dateTime,
    description: reminderData.description || '',
    url: reminderData.url || '',
    createdAt: reminderData.createdAt || Date.now(),
    isFired: false,
    firedAt: null
  };
  try {
    const storageResult = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const reminders = storageResult[REMINDERS_STORAGE_KEY] || {};
    reminders[reminderId] = reminder;
    await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders });
    await sendBackgroundMessage({
      action: 'SET_ALARM',
      reminderId: reminderId,
      alarmTime: alarmTime
    });
    return reminderId;
  } catch (error) {
    console.error(
      'Editor SGD: Erro ao salvar lembrete ou agendar alarme.',
      error
    );
    if (!reminderData.id) {
      try {
        const currentRemindersResult = await chrome.storage.sync.get(
          REMINDERS_STORAGE_KEY
        );
        const currentReminders =
          currentRemindersResult[REMINDERS_STORAGE_KEY] || {};
        if (currentReminders[reminderId]) {
          delete currentReminders[reminderId];
          await chrome.storage.sync.set({
            [REMINDERS_STORAGE_KEY]: currentReminders
          });
        }
      } catch (cleanupError) {
        console.error(
          'Erro ao limpar storage após falha no alarme (rollback).',
          cleanupError
        );
      }
    }
    throw error;
  }
}

async function deleteReminder(reminderId) {
  try {
    sendBackgroundMessage({
      action: 'CLEAR_ALARM',
      reminderId: reminderId
    }).catch(error => {
      console.warn(
        `Editor SGD: Não foi possível garantir que o alarme ${reminderId} foi limpo no background:`,
        error
      );
    });
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const reminders = result[REMINDERS_STORAGE_KEY] || {};
    if (reminders[reminderId]) {
      delete reminders[reminderId];
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders });
    }
  } catch (error) {
    console.error(`Editor SGD: Erro ao excluir lembrete ${reminderId}.`, error);
    throw error;
  }
}

async function deleteMultipleReminders(reminderIds) {
  if (!reminderIds || reminderIds.length === 0) return;
  try {
    const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
    const reminders = result[REMINDERS_STORAGE_KEY] || {};
    let changed = false;
    for (const id of reminderIds) {
      if (reminders[id]) {
        delete reminders[id];
        changed = true;
        sendBackgroundMessage({ action: 'CLEAR_ALARM', reminderId: id }).catch(
          err => {
            console.warn(
              `Erro ao limpar alarme durante exclusão em massa (${id}):`,
              err
            );
          }
        );
      }
    }
    if (changed) {
      await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders });
    }
  } catch (error) {
    console.error(`Editor SGD: Erro ao excluir múltiplos lembretes.`, error);
    throw error;
  }
}