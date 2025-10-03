/**
 * @file main.js
 * Ponto de entrada principal da extensão
 */

function createHistoryManager(initialState) {
  let history = [initialState]
  let position = 0

  return {
    add(state) {
      // Se o ponteiro não estiver no final, remove o histórico futuro (redo)
      if (position < history.length - 1) {
        history = history.slice(0, position + 1)
      }
      // Evita adicionar estados duplicados consecutivos
      if (history[position] === state) {
        return
      }
      history.push(state)
      position = history.length - 1

      // Limita o tamanho do histórico para não consumir muita memória
      if (history.length > 50) {
        history.shift()
        position--
      }
    },
    undo() {
      if (position > 0) {
        position--
        return history[position]
      }
      return null // Não há mais o que desfazer
    },
    redo() {
      if (position < history.length - 1) {
        position++
        return history[position]
      }
      return null // Não há mais o que refazer
    }
  }
}

// --- INICIALIZAÇÃO ROBUSTA (MutationObserver) ---

let lastKnownTextAreaValue = ''

/**
 * Observa mudanças no DOM para lidar com carregamento dinâmico (AJAX) do SGD.
 */
function observeForTextArea() {
  const observer = new MutationObserver(async (mutations, obs) => {
    const textArea = getTargetTextArea()
    if (textArea && !textArea.dataset.enhanced) {
      await initializeEditorInstance(textArea, 'main', {
        includePreview: true,
        includeQuickSteps: true,
        includeThemeToggle: true,
        includeNotes: true,
        includeReminders: true
      })
    }
  })

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }
}

/**
 * Inicializa uma instância do editor (main ou modal).
 * @param {HTMLTextAreaElement} textArea - O textarea a ser aprimorado.
 * @param {string} instanceId - ID único para a instância (ex: 'main', 'modal-123').
 * @param {object} options - Opções de configuração.
 */
async function initializeEditorInstance(textArea, instanceId, options = {}) {
  if (!textArea || textArea.dataset.enhanced) return
  textArea.dataset.enhanced = instanceId

  const {
    includePreview,
    includeQuickSteps,
    includeThemeToggle,
    includeNotes,
    includeReminders
  } = options

  const masterContainer = document.createElement('div')
  masterContainer.classList.add('editor-master-container', 'mode-textarea')

  const editorContainer = document.createElement('div')
  editorContainer.id = `editor-container-${instanceId}`
  editorContainer.classList.add('editor-container')
  editorContainer.innerHTML = await createEditorToolbarHtml(
    instanceId,
    includeQuickSteps,
    includeThemeToggle,
    includePreview,
    includeNotes,
    includeReminders
  )

  if (textArea.parentNode) {
    textArea.parentNode.insertBefore(masterContainer, textArea)
    masterContainer.appendChild(editorContainer)
    masterContainer.appendChild(textArea)
  } else {
    console.error(
      'Editor SGD: Não foi possível encontrar o elemento pai do textarea.'
    )
    return
  }

  // Adiciona o aviso de configuração do SGSC apenas na instância principal
  if (instanceId === 'main') {
    createAndAppendSgscWarning(masterContainer)
  }

  if (includePreview) {
    const previewContainer = createPreviewContainer(textArea, instanceId)
    applyCurrentTheme(previewContainer)

    const isVisible = await getPreviewState()
    const toggleButton = editorContainer.querySelector(
      '[data-action="toggle-preview"]'
    )

    if (isVisible) {
      previewContainer.style.display = 'block'
      if (toggleButton) {
        toggleButton.innerHTML = '📝'
        toggleButton.title = 'Ocultar Visualização (Ctrl+Alt+V)'
      }
    } else {
      previewContainer.style.display = 'none'
      if (toggleButton) {
        toggleButton.innerHTML = '👁️'
        toggleButton.title = 'Mostrar Visualização (Ctrl+Alt+V)'
      }
    }

    if (instanceId === 'main') {
      const pinButton = document.getElementById(`preview-pin-btn-${instanceId}`)
      const setPinState = isResizable => {
        previewContainer.classList.toggle('resizable', isResizable)
        pinButton.classList.toggle('unpinned', isResizable)
        pinButton.title = isResizable
          ? 'Fixar tamanho do painel'
          : 'Liberar para redimensionar'
      }
      const initialResizableState = await getPreviewResizableState()
      setPinState(initialResizableState)
      pinButton.addEventListener('click', async () => {
        const currentStateIsResizable =
          previewContainer.classList.contains('resizable')
        const newState = !currentStateIsResizable
        setPinState(newState)
        await savePreviewResizableState(newState)
      })
    }
    updatePreview(textArea)
  }

  applyCurrentTheme(textArea)
  updateThemeOnElements()

  setupEditorInstanceListeners(
    textArea,
    editorContainer,
    instanceId,
    includePreview
  )

  loadQuickChangeOptions(editorContainer) // <-- ADICIONE ESTA LINHA

  updateToolbarButtonVisibility(editorContainer)

  if (includeQuickSteps) {
    if (instanceId === 'main') {
      await getStoredData()
    }
    loadQuickMessages(editorContainer)
  }

  if (instanceId === 'main') {
    addSgdActionButtons(masterContainer)
    setupSolutionObserver(textArea)
    setupUserSelectionListener(textArea)
    performAutoFill(textArea)
  }
}

/**
 * Cria o HTML da toolbar do editor.
 * @param {string} instanceId - ID da instância.
 * @param {boolean} includeQuickSteps - Se deve incluir o botão de Trâmites Rápidos.
 * @param {boolean} includeThemeToggle - Se deve incluir o botão de Tema.
 * @param {boolean} includePreview - Se deve incluir o botão de Alternar Visualização.
 * @param {boolean} includeNotes - Se deve incluir o botão de Anotações.
 * @param {boolean} includeReminders - Se deve incluir os botões de Lembretes.
 * @returns {Promise<string>} O HTML da toolbar. (Retorno agora é uma Promise)
 */
async function createEditorToolbarHtml(
  instanceId,
  includeQuickSteps,
  includeThemeToggle,
  includePreview,
  includeNotes,
  includeReminders
) {
  const settings = await getSettings() // Carrega as configurações
  const buttonsVisibility =
    settings.toolbarButtons || DEFAULT_SETTINGS.toolbarButtons

  // ADICIONAR ESTA VERIFICAÇÃO NO INÍCIO DA FUNÇÃO
  const isSpeechRecognitionSupported =
    window.SpeechRecognition || window.webkitSpeechRecognition
  const micButtonDisabled = isSpeechRecognitionSupported ? '' : 'disabled'
  const micButtonTitle = isSpeechRecognitionSupported
    ? 'Gravar com Microfone'
    : 'Reconhecimento de voz não suportado neste navegador'

  // --- LÓGICA DE VISIBILIDADE APLICADA ---

  // Botões de formatação sempre visíveis
  const formattingButtons = `
    <button type="button" data-action="speech-to-text" title="${micButtonTitle}" ${micButtonDisabled}>🎤</button>
    <div class="toolbar-separator" data-id="mic-separator"></div>
    <button type="button" data-action="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
    <button type="button" data-action="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
    <button type="button" data-action="underline" title="Sublinhado (Ctrl+U)"><u>U</u></button>
    ${
      buttonsVisibility.separator2
        ? '<div class="toolbar-separator" data-id="separator2"></div>'
        : ''
    }
  `

  const listButtons = `
      <div class="dropdown">
        <button type="button" data-action="list" title="Listas (Numeração Dinâmica)">☰</button>
        <div class="dropdown-content">
          <button type="button" data-action="numbered">1. Numeração</button>
          <button type="button" data-action="sub-numbered">1.1. Subnumeração</button>
          <button type="button" data-action="lettered">A. Letra</button>
        </div>
      </div>
      <button type="button" data-action="bullet" title="Adicionar Marcador (Ctrl+M)">&bull;</button>
      ${
        buttonsVisibility.separator3
          ? '<div class="toolbar-separator" data-id="separator3"></div>'
          : ''
      }
    `

  const insertButtons = `
      <button type="button" data-action="link" title="Inserir Hiperlink (Ctrl+Alt+H)">🔗</button>
      ${
        buttonsVisibility.insertImage
          ? '<button type="button" data-action="insert-image" title="Inserir Imagem (Ctrl+V)">📸</button>'
          : ''
      }
      <button type="button" data-action="username" title="Inserir Nome do Usuário (Alt+Shift+U)">🏷️</button>
      ${
        buttonsVisibility.separator4
          ? '<div class="toolbar-separator" data-id="separator4"></div>'
          : ''
      }
    `

  const colorButtons = `
      <button type="button" data-action="emoji" title="Emojis (Código HTML)">😀</button>
      <button type="button" data-action="color" title="Cor do Texto">🎨</button>
      <button type="button" data-action="highlight" title="Cor de Destaque">🖌️</button>
      ${
        buttonsVisibility.separator5
          ? '<div class="toolbar-separator" data-id="separator5"></div>'
          : ''
      }
    `

  const quickChangeButton = buttonsVisibility.quickChange
    ? `
    <div class="dropdown">
      <button type="button" data-action="quick-change" title="Trocar Saudação/Encerramento">🔄</button>
      <div class="dropdown-content quick-change-container">
        <span class="loading-placeholder">Carregando...</span>
      </div>
    </div>
  `
    : ''

  const quickStepsHtml = includeQuickSteps
    ? `<div class="dropdown">
        <button type="button" data-action="quick-steps" title="Trâmites Rápidos">⚡</button>
        <div class="dropdown-content quick-steps-dropdown"></div>
      </div>`
    : ''

  const remindersHtml = includeReminders
    ? `
      <div class="dropdown">
        <button type="button" title="Lembretes">⏰</button>
        <div class="dropdown-content">
          <button type="button" data-action="new-reminder">📅 Novo Lembrete</button>
          <button type="button" data-action="manage-reminders">⏳ Gerenciar Lembretes</button>
        </div>
      </div>
    `
    : ''

  const notesButtonHtml = includeNotes
    ? `<button type="button" data-action="toggle-notes" title="Anotações">✍️</button>`
    : ''

  let themeToggleHtml = ''
  if (includeThemeToggle) {
    const themeOptionsHtml = THEMES.map(
      themeKey =>
        `<button type="button" class="theme-option" data-theme-name="${themeKey}">
        <span class="theme-icon">${THEME_ICONS[themeKey]}</span>
        <span>${THEME_NAMES[themeKey]}</span>
      </button>`
    ).join('')

    themeToggleHtml = `
      <div class="dropdown">
        <button type="button" data-action="theme-menu-button" title="Alterar Tema">🎨</button>
        <div class="dropdown-content">
          ${themeOptionsHtml}
        </div>
      </div>`
  }

  const togglePreviewHtml = includePreview
    ? `<button type="button" data-action="toggle-preview" title="Ocultar Visualização (Ctrl+Alt+V)">📝</button>`
    : ''

  let aiButtonsHtml = ''
  const devMode = await isDevModeEnabled()

  if (devMode) {
    aiButtonsHtml = `
      <div class="dropdown">
        <button type="button" title="Recursos de IA (Gemini)" class="ai-master-button">✨</button>
        <div class="dropdown-content">
          <button type="button" data-action="ai-correct">🪄 Melhorar Texto</button>
          <button type="button" data-action="ai-generate">💡 Gerar por Tópicos</button>
          <button type="button" data-action="ai-complete-draft">🚀 Completar Rascunho</button>
          ${
            instanceId === 'main'
              ? '<button type="button" data-action="ai-summarize">📄 Resumir Solicitação</button>'
              : ''
          }
        </div>
      </div>
      ${
        buttonsVisibility.separator1
          ? '<div class="toolbar-separator" data-id="separator1"></div>'
          : ''
      }
    `
  }

  return `
    <div class="editor-toolbar">
      ${aiButtonsHtml}
      ${formattingButtons}
      ${listButtons}
      ${insertButtons}
      ${colorButtons}
      
      <button type="button" data-action="manage-steps" title="Configurações">⚙️</button>
      ${quickChangeButton}
      
      ${quickStepsHtml}
      ${remindersHtml}
      ${notesButtonHtml}
      ${
        buttonsVisibility.separator6
          ? '<div class="toolbar-separator" data-id="separator6"></div>'
          : ''
      }
      ${togglePreviewHtml}
      ${themeToggleHtml}
    </div>
    <div id="emoji-picker-${instanceId}" class="picker"></div>
    <div id="color-picker-${instanceId}" class="picker"></div>
    <div id="highlight-picker-${instanceId}" class="picker"></div>
  `
}

/**
 * Cria e anexa um banner de aviso sobre as configurações do SGSC, se ainda não foi dispensado.
 * @param {HTMLElement} masterContainer - O contêiner principal do editor.
 */
function createAndAppendSgscWarning(masterContainer) {
  const warningDismissedKey = 'sgscWarningDismissed_v1' // Chave versionada

  // Não mostrar se já foi dispensado
  if (localStorage.getItem(warningDismissedKey) === 'true') {
    return
  }

  const warningBanner = document.createElement('div')
  warningBanner.className = 'sgsc-warning-banner'
  warningBanner.innerHTML = `
    <p>
      <strong>Atenção:</strong><span class="warning-text"> Para o correto funcionamento das 🔄 Saudações/Encerramentos, apague as configurações do SGD em </span><strong>SGSC > Gerenciar > Configuração de saudação e conclusão de trâmite</strong>.
    </p>
    <button type="button" class="dismiss-warning-btn">Dispensar</button>
  `

  masterContainer.appendChild(warningBanner)

  const dismissButton = warningBanner.querySelector('.dismiss-warning-btn')
  dismissButton.addEventListener('click', () => {
    warningBanner.style.display = 'none'
    localStorage.setItem(warningDismissedKey, 'true')
  })
}

/**
 * Executa o preenchimento automático usando a saudação e/ou encerramento padrão selecionado.
 * @param {HTMLTextAreaElement} textArea - O elemento textarea do editor.
 */
async function performAutoFill(textArea) {
  if (textArea.value.trim() !== '') {
    return
  }

  const data = await getGreetingsAndClosings()

  if (!data.defaultGreetingId && !data.defaultClosingId) {
    return
  }

  let greetingContent = ''
  let closingContent = ''

  if (data.defaultGreetingId) {
    const defaultGreeting = data.greetings.find(
      g => g.id === data.defaultGreetingId
    )
    if (defaultGreeting) {
      greetingContent = await resolveVariablesInText(defaultGreeting.content)
    }
  }

  if (data.defaultClosingId) {
    const defaultClosing = data.closings.find(
      c => c.id === data.defaultClosingId
    )
    if (defaultClosing) {
      closingContent = await resolveVariablesInText(defaultClosing.content)
    }
  }

  let finalContent = ''
  let cursorPosition = -1

  if (greetingContent && closingContent) {
    // Usa ambos os separadores para delimitar claramente cada seção
    finalContent = `${greetingContent}${GREETING_SEPARATOR}${CLOSING_SEPARATOR}${closingContent}`
    cursorPosition = greetingContent.length + GREETING_SEPARATOR.length
  } else if (greetingContent) {
    finalContent = greetingContent + GREETING_SEPARATOR
  } else if (closingContent) {
    finalContent = CLOSING_SEPARATOR + closingContent
  }

  if (finalContent) {
    // Passamos a nova opção para a função de inserção
    insertAtCursor(textArea, finalContent, { preventScroll: true })

    if (cursorPosition !== -1) {
      // Também aplicamos a opção 'preventScroll' ao focar para posicionar o cursor
      textArea.focus({ preventScroll: true })
      textArea.setSelectionRange(cursorPosition, cursorPosition)
    }

    textArea.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/**
 * Carrega as opções de saudação e encerramento, incluindo os botões de "Adicionar Novo".
 * @param {HTMLElement} editorContainer - O contêiner da barra de ferramentas.
 */
async function loadQuickChangeOptions(editorContainer) {
  const container = editorContainer.querySelector('.quick-change-container')
  if (!container) return

  const data = await getGreetingsAndClosings()
  let html = ''

  // Função auxiliar para criar a lista de itens
  const createItemsHtml = (items, type) => {
    const defaultId =
      type === 'greetings' ? data.defaultGreetingId : data.defaultClosingId
    let itemsHtml = items
      .map(item => {
        const isActive = item.id === defaultId
        return `
        <div class="quick-change-item" data-id="${item.id}" data-type="${type}">
          <button type="button" class="set-default-btn ${
            isActive ? 'active' : ''
          }" title="${
          isActive ? 'Padrão atual' : 'Definir como padrão'
        }">⭐</button>
          <span class="quick-change-title" title="Inserir no texto">${escapeHTML(
            item.title
          )}</span>
          <div class="quick-change-actions">
            <button type="button" class="edit-item-btn" title="Editar">✏️</button>
            <button type="button" class="delete-item-btn" title="Excluir">🗑️</button>
          </div>
        </div>
      `
      })
      .join('')
    // Adiciona o botão "Adicionar Novo" ao final da lista de itens
    itemsHtml += `<button type="button" class="add-new-item-btn" data-type="${type}">+ Adicionar</button>`
    return itemsHtml
  }

  if (data.greetings && data.greetings.length > 0) {
    html += '<h5>Saudações</h5>'
    html += createItemsHtml(data.greetings, 'greetings')
  } else {
    // Se não houver saudações, mostra apenas o botão de adicionar
    html += '<h5>Saudações</h5>'
    html += `<button type="button" class="add-new-item-btn" data-type="greetings">+ Adicionar Saudação</button>`
  }

  if (data.closings && data.closings.length > 0) {
    html += '<h5>Encerramentos</h5>'
    html += createItemsHtml(data.closings, 'closings')
  } else {
    // Se não houver encerramentos, mostra apenas o botão de adicionar
    html += '<h5>Encerramentos</h5>'
    html += `<button type="button" class="add-new-item-btn" data-type="closings">+ Adicionar Encerramento</button>`
  }

  container.innerHTML = html
}

/**
 * Substitui a parte de saudação ou encerramento do texto no editor.
 * @param {HTMLTextAreaElement} textArea - O campo de texto.
 * @param {'greetings'|'closings'} type - A parte a ser substituída.
 * @param {string} newContent - O novo conteúdo a ser inserido.
 */
function replaceTextPart(textArea, type, newContent) {
  const fullText = textArea.value
  let newText = ''

  if (type === 'greetings') {
    // Usa o separador específico de saudação
    const greetingSep = GREETING_SEPARATOR
    const firstSeparatorIndex = fullText.indexOf(greetingSep)
    
    if (firstSeparatorIndex !== -1) {
      // Se há um separador de saudação, substitui tudo ANTES dele
      const restOfText = fullText.substring(firstSeparatorIndex)
      newText = newContent + restOfText
    } else {
      // Se não há separador, anexa o conteúdo existente depois da nova saudação
      newText = newContent + greetingSep + fullText
    }
  } else if (type === 'closings') {
    // Usa o separador específico de encerramento
    const closingSep = CLOSING_SEPARATOR
    const lastSeparatorIndex = fullText.lastIndexOf(closingSep)
    
    if (lastSeparatorIndex !== -1) {
      // Se há um separador de encerramento, substitui tudo DEPOIS dele
      const startOfText = fullText.substring(0, lastSeparatorIndex)
      newText = startOfText + closingSep + newContent
    } else {
      // Se não há separador, anexa o encerramento com um separador no meio
      newText = fullText + closingSep + newContent
    }
  }

  if (newText && newText !== fullText) {
    textArea.value = newText
    textArea.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/**
 * Configura os listeners de eventos para uma instância específica do editor.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 * @param {HTMLElement} editorContainer - O container da toolbar.
 * @param {string} instanceId - O ID da instância.
 * @param {boolean} includePreview - Se o painel de visualização está habilitado para esta instância.
 */
function setupEditorInstanceListeners(
  textArea,
  editorContainer,
  instanceId,
  includePreview
) {
  if (!textArea) return

  // --- Inicialização do Gerenciador de Histórico ---
  const history = createHistoryManager(textArea.value)
  let debounceTimeout
  let performingUndoRedo = false // Flag para evitar loop no listener de input

  /**
   * Atualiza o valor do textarea com um estado do histórico.
   * @param {string | null} newState - O novo conteúdo para o textarea.
   */
  const updateTextAreaState = newState => {
    if (newState === null) return
    performingUndoRedo = true // Ativa a flag
    const currentScrollTop = textArea.scrollTop
    textArea.value = newState
    // Dispara o evento de input para que o preview seja atualizado
    textArea.dispatchEvent(new Event('input', { bubbles: true }))
    textArea.scrollTop = currentScrollTop
    // Reseta a flag após a atualização do DOM
    requestAnimationFrame(() => {
      performingUndoRedo = false
    })
  }

  // --- Listeners do Textarea ---
  if (includePreview) {
    textArea.addEventListener('input', () => {
      updatePreview(textArea)
      lastKnownTextAreaValue = textArea.value

      // Adiciona o estado ao histórico com um debounce para não salvar a cada tecla
      if (!performingUndoRedo) {
        clearTimeout(debounceTimeout)
        debounceTimeout = setTimeout(() => {
          history.add(textArea.value)
        }, 400) // Aguarda 400ms de inatividade para salvar
      }
    })

    if (instanceId === 'main') {
      setInterval(() => {
        if (textArea.value !== lastKnownTextAreaValue) {
          lastKnownTextAreaValue = textArea.value
          updatePreview(textArea)
        }
      }, 1000)
    }
  }

  const handleKeydown = e => {
    if (document.getElementById('shortcut-popup')) return

    const ctrl = e.ctrlKey
    const alt = e.altKey
    const shift = e.shiftKey
    const key = e.key.toLowerCase()

    // --- LÓGICA DE UNDO/REDO ---
    if (ctrl && !alt && !shift) {
      if (key === 'z') {
        e.preventDefault()
        const prevState = history.undo()
        updateTextAreaState(prevState)
        return
      }
      if (key === 'y') {
        e.preventDefault()
        const nextState = history.redo()
        updateTextAreaState(nextState)
        return
      }
    }

    // --- Demais Atalhos ---
    if (ctrl && !alt && !shift) {
      switch (key) {
        case 'b':
          e.preventDefault()
          applyFormatting(textArea, 'strong')
          return
        case 'i':
          e.preventDefault()
          applyFormatting(textArea, 'em')
          return
        case 'u':
          e.preventDefault()
          applyFormatting(textArea, 'u')
          return
        case 'm':
          e.preventDefault()
          insertBullet(textArea)
          return
      }
    }

    if (ctrl && alt && !shift) {
      switch (key) {
        case 'h':
          e.preventDefault()
          openLinkModal(textArea)
          return
        case 'v':
          e.preventDefault()
          if (includePreview) togglePreview(textArea)
          return
      }
    }

    if (instanceId === 'main' && !ctrl && alt && shift && e.key === 'U') {
      e.preventDefault()
      insertUserName(textArea)
      return
    }
  }

  textArea.addEventListener('keydown', handleKeydown)

  // --- Listener para colar imagens ---
  textArea.addEventListener('paste', e => handleImagePaste(e, textArea))

  // --- Listeners da Toolbar (Delegação de Eventos) ---
  editorContainer.addEventListener('click', async e => {
    const themeOption = e.target.closest('.theme-option')
    if (themeOption && themeOption.dataset.themeName) {
      setTheme(themeOption.dataset.themeName)
      return
    }

    const quickChangeContainer = e.target.closest('.quick-change-container')
    if (quickChangeContainer) {
      // Ação: Adicionar Novo Item (clique no botão + Adicionar)
      if (e.target.closest('.add-new-item-btn')) {
        const button = e.target.closest('.add-new-item-btn')
        const type = button.dataset.type // 'greetings' ou 'closings'

        // Abre o modal de criação, passando o tipo e um callback para recarregar o menu
        openGreetingClosingModal(null, type, () => {
          loadQuickChangeOptions(editorContainer)
          // Também recarrega a lista no modal de configurações, se estiver aberto
          const mgmtModal = document.getElementById('management-modal')
          if (mgmtModal) renderGreetingsClosingsManagement(mgmtModal)
        })
        // Deixa o menu fechar naturalmente
        return
      }

      const itemElement = e.target.closest('.quick-change-item')
      if (!itemElement) return

      const itemId = itemElement.dataset.id
      const type = itemElement.dataset.type

      // Ação: Definir como Padrão (clique na estrela)
      if (e.target.closest('.set-default-btn')) {
        e.stopPropagation() // Impede o menu de fechar
        const data = await getGreetingsAndClosings()
        const property =
          type === 'greetings' ? 'defaultGreetingId' : 'defaultClosingId'
        data[property] = data[property] === itemId ? null : itemId
        await saveGreetingsAndClosings(data)
        showNotification('Padrão atualizado!', 'success', 2000)
        loadQuickChangeOptions(editorContainer) // Recarrega o menu para refletir a mudança
        return
      }

      // Ação: Editar (clique no lápis)
      if (e.target.closest('.edit-item-btn')) {
        const data = await getGreetingsAndClosings()
        const item = data[type]?.find(i => i.id === itemId)
        if (item) {
          openGreetingClosingModal(item, type, () => {
            loadQuickChangeOptions(editorContainer)
            // Também recarrega a lista no modal de configurações, se estiver aberto
            const mgmtModal = document.getElementById('management-modal')
            if (mgmtModal) renderGreetingsClosingsManagement(mgmtModal)
          })
        }
        // Deixa o menu fechar
        return
      }

      // Ação: Excluir (clique na lixeira)
      if (e.target.closest('.delete-item-btn')) {
        e.stopPropagation() // Impede o menu de fechar durante a confirmação
        showConfirmDialog(
          `Excluir "${
            itemElement.querySelector('.quick-change-title').textContent
          }"?`,
          async () => {
            const data = await getGreetingsAndClosings()
            data[type] = data[type].filter(i => i.id !== itemId)
            if (
              (type === 'greetings' && data.defaultGreetingId === itemId) ||
              (type === 'closings' && data.defaultClosingId === itemId)
            ) {
              data[
                type === 'greetings' ? 'defaultGreetingId' : 'defaultClosingId'
              ] = null
            }
            await saveGreetingsAndClosings(data)
            showNotification('Item excluído.', 'success')
            loadQuickChangeOptions(editorContainer)
          }
        )
        return
      }

      // Ação Padrão: Inserir no Texto (clique no título)
      if (e.target.closest('.quick-change-title')) {
        const data = await getGreetingsAndClosings()
        const item = data[type]?.find(i => i.id === itemId)
        if (item) {
          const resolvedContent = await resolveVariablesInText(item.content)
          replaceTextPart(textArea, type, resolvedContent)
        }
        // Deixa o menu fechar
        return
      }
    }

    if (e.target.closest('.dropdown')) {
      if (e.target.closest('.message-item')) return
    }

    const button = e.target.closest('button[data-action]')
    if (!button) return

    if (
      !button.dataset.action.match(
        /list|quick-steps|theme-menu-button|manage-steps/
      )
    ) {
      e.preventDefault()
    }

    const action = button.dataset.action

    const startAILoading = () => {
      button.disabled = true
      button.classList.add('ai-loading')
      const masterButton = editorContainer.querySelector('.ai-master-button')
      if (masterButton) masterButton.classList.add('ai-loading')
    }

    const stopAILoading = () => {
      button.disabled = false
      button.classList.remove('ai-loading')
      const masterButton = editorContainer.querySelector('.ai-master-button')
      if (masterButton) masterButton.classList.remove('ai-loading')
    }

    switch (action) {
      case 'bold':
        applyFormatting(textArea, 'strong')
        break
      case 'italic':
        applyFormatting(textArea, 'em')
        break
      case 'underline':
        applyFormatting(textArea, 'u')
        break
      case 'speech-to-text':
        SpeechService.toggleRecognition(textArea)
        break
      case 'ai-correct':
        startAILoading()
        await handleAICorrection(textArea)
        stopAILoading()
        break
      case 'ai-generate':
        openAIGenerationModal(textArea)
        break
      case 'ai-summarize':
        if (instanceId === 'main') {
          startAILoading()
          await handleAISummary(textArea)
          stopAILoading()
        }
        break
      case 'ai-complete-draft':
        startAILoading()
        await handleAICompleteDraft(textArea)
        stopAILoading()
        break
      case 'link':
        openLinkModal(textArea)
        break
      case 'insert-image':
        openImageUploadModal(textArea)
        break
      case 'bullet':
        insertBullet(textArea)
        break
      case 'username':
        if (instanceId === 'main') {
          insertUserName(textArea)
        } else {
          const originalText = button.innerHTML
          button.innerHTML = 'Indisponível'
          setTimeout(() => (button.innerHTML = originalText), 1500)
        }
        break
      case 'toggle-preview':
        if (includePreview) togglePreview(textArea)
        break
      case 'toggle-notes':
        toggleNotesPanel()
        break
      case 'new-reminder':
        openNewReminderModal()
        break
      case 'manage-reminders':
        openRemindersManagementModal()
        break
      case 'numbered':
        insertListItem(textArea, `<b>${getNextMainNumber(textArea)}. </b>`)
        break
      case 'sub-numbered':
        const { main, sub } = getNextSubNumber(textArea)
        insertListItem(textArea, `<b>${main}.${sub}. </b>`)
        break
      case 'lettered':
        insertListItem(textArea, `<b>${getNextLetter(textArea)}. </b>`)
        break
      case 'manage-steps':
        openManagementModal()
        break
    }
  })

  // --- Nova seção para inicializar os seletores uma única vez ---
  // Inicializa o seletor de cores
  createColorPicker(
    document.getElementById(`color-picker-${instanceId}`),
    color => applyFormatting(textArea, 'span', { style: `color:${color}` })
  )
  setupPickerHover(editorContainer, 'color', `color-picker-${instanceId}`)

  // Inicializa o seletor de destaques
  createColorPicker(
    document.getElementById(`highlight-picker-${instanceId}`),
    color =>
      applyFormatting(textArea, 'span', { style: `background-color:${color}` })
  )
  setupPickerHover(
    editorContainer,
    'highlight',
    `highlight-picker-${instanceId}`
  )

  // Inicializa o seletor de emojis
  createEmojiPicker(
    document.getElementById(`emoji-picker-${instanceId}`),
    emojiHtml => insertAtCursor(textArea, emojiHtml)
  )
  setupPickerHover(editorContainer, 'emoji', `emoji-picker-${instanceId}`)

  // --- NOVA FUNCIONALIDADE: Detecção de estado de formatação ---
  // Adiciona listeners para detectar mudanças na posição do cursor e atualizar o estado dos botões
  textArea.addEventListener('keyup', () =>
    updateFormattingButtonsState(textArea, editorContainer)
  )
  textArea.addEventListener('mouseup', () =>
    updateFormattingButtonsState(textArea, editorContainer)
  )

  // Atualiza o estado inicial dos botões
  updateFormattingButtonsState(textArea, editorContainer)
}

/**
 * Atualiza o estado visual dos botões de formatação baseado na posição do cursor.
 * Verifica se o texto ao redor do cursor está envolto por tags de formatação.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 * @param {HTMLElement} editorContainer - O container do editor.
 */
function updateFormattingButtonsState(textArea, editorContainer) {
  if (!textArea || !editorContainer) return

  const cursorPosition = textArea.selectionStart
  const text = textArea.value

  // Função auxiliar para verificar se o cursor está dentro de uma tag específica
  const isInsideTag = (openTag, closeTag) => {
    // Procura pela tag de abertura mais próxima antes do cursor
    const beforeCursor = text.substring(0, cursorPosition)
    const lastOpenIndex = beforeCursor.lastIndexOf(openTag)

    if (lastOpenIndex === -1) return false

    // Verifica se há uma tag de fechamento correspondente após o cursor
    const afterOpenTag = text.substring(lastOpenIndex + openTag.length)
    const closeIndex = afterOpenTag.indexOf(closeTag)

    if (closeIndex === -1) return false

    // Verifica se o cursor está entre a tag de abertura e fechamento
    const tagEndPosition = lastOpenIndex + openTag.length + closeIndex
    return cursorPosition <= tagEndPosition
  }

  // Mapeamento dos botões de formatação e suas tags correspondentes
  const formattingButtons = [
    { action: 'bold', tags: ['<strong>', '</strong>', '<b>', '</b>'] },
    { action: 'italic', tags: ['<em>', '</em>', '<i>', '</i>'] },
    { action: 'underline', tags: ['<u>', '</u>'] }
  ]

  // Atualiza o estado de cada botão
  formattingButtons.forEach(({ action, tags }) => {
    const button = editorContainer.querySelector(`[data-action="${action}"]`)
    if (!button) return

    // Verifica se o cursor está dentro de alguma das tags correspondentes
    let isActive = false
    for (let i = 0; i < tags.length; i += 2) {
      if (isInsideTag(tags[i], tags[i + 1])) {
        isActive = true
        break
      }
    }

    // Adiciona ou remove a classe CSS baseado no estado
    if (isActive) {
      button.classList.add('active-formatting-btn')
    } else {
      button.classList.remove('active-formatting-btn')
    }
  })
}

/**
 * Alterna a visibilidade do painel de visualização e salva o estado.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 */
async function togglePreview(textArea) {
  const instanceId = textArea.dataset.enhanced
  const previewContainer = document.getElementById(
    `editor-preview-container-${instanceId}`
  )
  const toggleButton = document.querySelector(
    `#editor-container-${instanceId} [data-action="toggle-preview"]`
  )

  if (!previewContainer) return

  const isVisible = previewContainer.style.display !== 'none'

  if (isVisible) {
    previewContainer.style.display = 'none'
    if (toggleButton) {
      toggleButton.innerHTML = '👁️'
      toggleButton.title = 'Mostrar Visualização (Ctrl+Alt+V)'
    }
  } else {
    previewContainer.style.display = 'block'
    updatePreview(textArea) // Atualiza imediatamente ao mostrar.
    if (toggleButton) {
      toggleButton.innerHTML = '📝'
      toggleButton.title = 'Ocultar Visualização (Ctrl+Alt+V)'
    }
  }

  // Salva o estado apenas para a instância principal (persistência).
  if (instanceId === 'main') {
    await savePreviewState(!isVisible)
  }
}

function addSgdActionButtons(masterContainer) {
  const actionButtonIds = [
    'cadSscForm:btnSalvar',
    'cadSscForm:gravarVisualizar',
    'cadSscForm:inserir',
    'cadSscForm:btnTramitar',
    'sscForm:gravarTramiteBtn',
    'sscForm:btnSalvarContinuar',
    'sscForm:btnTramitar',
    'ssForm:gravarTramiteBtn',
    'ssForm:btnTramitar'
  ]

  const toolbar = masterContainer.querySelector('.editor-toolbar')
  if (!toolbar) return

  const actionGroup = document.createElement('div')
  actionGroup.className = 'sgd-toolbar-action-group'

  actionButtonIds.forEach(id => {
    const originalButton = document.getElementById(id)

    if (originalButton && !originalButton.disabled) {
      const clonedButton = document.createElement('button')
      clonedButton.type = 'button'
      if (id === 'cadSscForm:gravarVisualizar') {
        clonedButton.textContent = 'Gravar e Visualizar'
      } else {
        clonedButton.textContent =
          originalButton.value || originalButton.textContent || 'Ação'
      }
      clonedButton.className = 'action-btn action-btn-themed'
      clonedButton.title = `Executar ação: ${clonedButton.textContent}`

      clonedButton.addEventListener('click', e => {
        e.preventDefault()

        // --- LÓGICA DE COLETA DE AMOSTRAS ---
        const textArea = getTargetTextArea()
        if (textArea) {
          const content = textArea.value.trim()
          // Salva se o conteúdo for relevante para treinar a IA
          if (content.length > 150) {
            saveUserResponseSample(content)
          }
        }
        // --- FIM DA LÓGICA ---

        originalButton.click()
      })
      actionGroup.appendChild(clonedButton)
    }
  })

  if (actionGroup.children.length > 0) {
    toolbar.appendChild(actionGroup)
  }
}

/**
 * Verifica se existem lembretes pendentes que ainda não foram notificados
 * nesta sessão do navegador e exibe o toast para eles.
 */

async function initializeExtension() {
  const settings = await getSettings()
  applyUiSettings(settings)

  await loadSavedTheme()
  SpeechService.initialize() // Inicializa o serviço de reconhecimento de voz
  observeForTextArea()
  document.addEventListener('keydown', handleShortcutListener)

  // Cria os elementos flutuantes
  initializeScrollToTopButton()
  createFloatingActionButtons()
  setupFabListeners()

  // Aplica visibilidade inicial aos elementos globais
  applyGlobalVisibilitySettings()

  const fabPosition = await getFabPosition()
  const fabContainer = document.getElementById('fab-container')
  if (fabContainer) {
    fabContainer.classList.add(fabPosition)
    adjustGoToTopButtonPosition(fabPosition)
  }

  if (typeof initializeNotesPanel === 'function') {
    initializeNotesPanel()
  }

  createAndInjectBellIcon()
  await updateNotificationStatus()
  createSpeechCommandHint()
}

/**
 * Monitora o textarea principal e corrige automaticamente o conteúdo quando a função
 * "Utilizar Solução" do SGD é usada, substituindo os textos padrão pelos do usuário.
 * @param {HTMLTextAreaElement} textArea - O elemento textarea do editor principal.
 */
function setupSolutionObserver(textArea) {
  let lastKnownValue = textArea.value

  // Usamos um intervalo para verificar mudanças, pois a função do site
  // altera o valor do campo sem disparar eventos de input padrão.
  setInterval(async () => {
    // Se o valor não mudou, não faz nada.
    if (textArea.value === lastKnownValue) {
      return
    }

    // O valor mudou, então atualizamos nossa referência.
    lastKnownValue = textArea.value

    // Busca os elementos ocultos do SGD que contêm os textos padrão.
    const siteGreetingEl = document.getElementById('cadSscForm:textoInicial')
    const siteClosingEl = document.getElementById('cadSscForm:textoFinal')

    // Se os elementos de referência não existirem, não podemos continuar.
    if (!siteGreetingEl || !siteClosingEl) {
      return
    }

    const siteDefaultGreeting = siteGreetingEl.value
    const siteDefaultClosing = siteClosingEl.value
    const currentText = textArea.value

    // Heurística de detecção: o texto atual começa e termina com os padrões do site?
    // Usamos trim() para ignorar espaços em branco extras.
    if (
      currentText.trim().startsWith(siteDefaultGreeting.trim()) &&
      currentText.trim().endsWith(siteDefaultClosing.trim())
    ) {
      console.log(
        "SGD Extensão: Botão 'Utilizar Solução' detectado. Corrigindo o texto..."
      )

      // 1. Extrai o conteúdo da solução (o "miolo").
      const greetingLength = siteDefaultGreeting.length
      const closingLength = siteDefaultClosing.length
      const solutionText = currentText
        .substring(greetingLength, currentText.length - closingLength)
        .trim()

      // 2. Busca as configurações de saudação/encerramento do usuário na extensão.
      const data = await getGreetingsAndClosings()
      let userGreeting = ''
      let userClosing = ''

      if (data.defaultGreetingId) {
        const defaultGreeting = data.greetings.find(
          g => g.id === data.defaultGreetingId
        )
        if (defaultGreeting) {
          userGreeting = await resolveVariablesInText(defaultGreeting.content)
        }
      }

      if (data.defaultClosingId) {
        const defaultClosing = data.closings.find(
          c => c.id === data.defaultClosingId
        )
        if (defaultClosing) {
          userClosing = await resolveVariablesInText(defaultClosing.content)
        }
      }

      // Se o usuário não tem nenhum padrão configurado, não fazemos a substituição.
      if (!userGreeting && !userClosing) {
        return
      }

      // 3. Remonta o texto com os padrões do usuário.
      // Usamos os separadores específicos para delimitar cada seção.
      let newText = ''
      
      if (userGreeting) {
        newText += userGreeting + GREETING_SEPARATOR
      }
      
      newText += solutionText
      
      if (userClosing) {
        newText += CLOSING_SEPARATOR + userClosing
      }

      // 4. Atualiza o textarea e dispara um evento para o painel de visualização atualizar.
      textArea.value = newText
      textArea.dispatchEvent(new Event('input', { bubbles: true }))

      showNotification(
        'Saudação/Encerramento aplicados à solução!',
        'info',
        2500
      )
    }
  }, 250) // A verificação ocorre 4 vezes por segundo, é rápido e leve.
}

/**
 * Monitora a seleção de usuário do SGD e atualiza dinamicamente o nome
 * nos locais onde a variável [usuario] foi inserida.
 * @param {HTMLTextAreaElement} textArea - O elemento textarea do editor principal.
 */
function setupUserSelectionListener(textArea) {
  const userSelect = document.getElementById('cadSscForm:usuario')
  if (!userSelect) return

  userSelect.addEventListener('change', () => {
    // Pega o primeiro nome do usuário recém-selecionado.
    const selectedOption = userSelect.options[userSelect.selectedIndex]
    const fullName = selectedOption.textContent.trim()
    const newUserName = fullName.split(' ')[0] || 'Usuário'
    const capitalizedUserName =
      newUserName.charAt(0).toUpperCase() + newUserName.slice(1).toLowerCase()

    const currentText = textArea.value

    // Usa uma expressão regular para encontrar todos os spans de usuário
    // e substituir apenas o conteúdo dentro deles, preservando o span.
    const regex = /(<span data-variable="usuario">)(.*?)(<\/span>)/g

    if (currentText.match(regex)) {
      const newText = currentText.replace(regex, `$1${capitalizedUserName}$3`)

      if (currentText !== newText) {
        textArea.value = newText
        textArea.dispatchEvent(new Event('input', { bubbles: true }))
        showNotification(
          `Nome de usuário atualizado para ${capitalizedUserName}.`,
          'info',
          2000
        )
      }
    }
  })
}

/**
 * Cria e exibe um popup para troca rápida de saudações ou encerramentos.
 * @param {'greetings'|'closings'} type - O tipo de item a ser exibido.
 * @param {HTMLElement} triggerElement - O ícone que acionou o popup.
 */
async function createQuickChangePopup(type, triggerElement) {
  // Remove popups antigos para evitar duplicatas
  document.querySelector('.quick-change-popup')?.remove()

  const data = await getGreetingsAndClosings()
  const items = data[type]

  if (!items || items.length === 0) {
    showNotification(
      `Nenhum(a) ${
        type === 'greetings' ? 'saudação' : 'encerramento'
      } cadastrado(a).`,
      'info'
    )
    return
  }

  const popup = document.createElement('div')
  popup.className = 'quick-change-popup'
  applyCurrentTheme(popup)

  const buttonsHtml = items
    .map(
      item =>
        `<button type="button" class="dropdown-option" data-id="${
          item.id
        }">${escapeHTML(item.title)}</button>`
    )
    .join('')
  popup.innerHTML = buttonsHtml

  document.body.appendChild(popup)

  // Posiciona o popup ao lado do ícone
  const triggerRect = triggerElement.getBoundingClientRect()
  popup.style.top = `${triggerRect.top}px`
  popup.style.left = `${triggerRect.right + 5}px`

  // Listener para fechar ao clicar fora
  const closePopup = e => {
    if (!popup.contains(e.target)) {
      popup.remove()
      document.removeEventListener('click', closePopup, true)
    }
  }
  setTimeout(() => document.addEventListener('click', closePopup, true), 100)

  // Listener para seleção de item
  popup.addEventListener('click', async e => {
    const button = e.target.closest('.dropdown-option')
    if (button) {
      const itemId = button.dataset.id
      const item = items.find(i => i.id === itemId)
      if (item) {
        const textArea = getTargetTextArea()
        const resolvedContent = await resolveVariablesInText(item.content)
        replaceTextPart(textArea, type, resolvedContent)
      }
      popup.remove()
      document.removeEventListener('click', closePopup, true)
    }
  })
}

/**
 * Encontra um bloco de texto interativo no editor e o substitui por um novo conteúdo.
 * @param {string} type - 'greeting' ou 'closing'.
 * @param {string} oldId - O ID do item que será substituído.
 * @param {string} newContentHtml - O novo conteúdo HTML (já processado e com o novo span).
 */
function replaceInteractiveText(type, oldId, newContentHtml) {
  const textArea = getTargetTextArea()
  if (!textArea) return

  const currentText = textArea.value

  // Expressão regular para encontrar o span específico pelo tipo e ID
  const regex = new RegExp(
    `<span data-interactive-type="${type}" data-item-id="${oldId}">([\\s\\S]*?)<\\/span>`,
    'g'
  )

  if (currentText.match(regex)) {
    textArea.value = currentText.replace(regex, newContentHtml)
    textArea.dispatchEvent(new Event('input', { bubbles: true })) // Atualiza o preview
    showNotification('Item atualizado com sucesso!', 'success', 2000)
  } else {
    console.warn('Bloco de texto interativo para substituição não encontrado.')
  }
}

/**
 * Cria e exibe um popup para troca de um item interativo (saudação/encerramento).
 * @param {HTMLElement} targetSpan - O elemento span que foi clicado no preview.
 */
async function createInteractiveChangePopup(targetSpan) {
  document.querySelector('.quick-change-popup')?.remove()

  const type =
    targetSpan.dataset.interactiveType === 'greeting' ? 'greetings' : 'closings'
  const currentId = targetSpan.dataset.itemId

  const data = await getGreetingsAndClosings()
  const items = data[type]

  if (!items || items.length <= 1) return // Não mostra o menu se só houver uma opção

  const popup = document.createElement('div')
  popup.className = 'quick-change-popup'
  applyCurrentTheme(popup)

  // Filtra o item atual da lista para não aparecer como opção de troca
  const buttonsHtml = items
    .filter(item => item.id !== currentId)
    .map(
      item =>
        `<button type="button" class="dropdown-option" data-id="${
          item.id
        }">${escapeHTML(item.title)}</button>`
    )
    .join('')

  if (!buttonsHtml) return // Não mostra menu se não houver outras opções

  popup.innerHTML = buttonsHtml
  document.body.appendChild(popup)

  const targetRect = targetSpan.getBoundingClientRect()
  popup.style.top = `${targetRect.bottom + 5}px`
  popup.style.left = `${targetRect.left}px`

  const closePopup = e => {
    if (!popup.contains(e.target)) {
      popup.remove()
      document.removeEventListener('click', closePopup, true)
    }
  }
  setTimeout(() => document.addEventListener('click', closePopup, true), 100)

  popup.addEventListener('click', async e => {
    const button = e.target.closest('.dropdown-option')
    if (button) {
      const newItemId = button.dataset.id
      const newItem = items.find(i => i.id === newItemId)
      if (newItem) {
        // Gera o novo HTML com o span correto
        const newContentHtml = await processAndWrapText(
          newItem,
          type.slice(0, -1)
        )
        // Chama a função de substituição
        replaceInteractiveText(type.slice(0, -1), currentId, newContentHtml)
      }
      popup.remove()
      document.removeEventListener('click', closePopup, true)
    }
  })
}

function createFloatingActionButtons() {
  if (document.getElementById('fab-container')) return
  const fabContainer = document.createElement('div')
  fabContainer.id = 'fab-container'
  fabContainer.className = 'fab-container'

  fabContainer.innerHTML = `
    <div class="fab-options">
      <button type="button" class="fab-button fab-option" data-action="fab-notes" data-tooltip="Anotações">✍️</button>
      <button type="button" class="fab-button fab-option" data-action="fab-reminders" data-tooltip="Gerenciar Lembretes">⏰</button>
      <button type="button" class="fab-button fab-option" data-action="fab-quick-steps" data-tooltip="Trâmites">⚡</button>
      <button type="button" class="fab-button fab-option" data-action="fab-manage-steps" data-tooltip="Configurações">⚙️</button>
    </div>
    <button type="button" class="fab-button main-fab" title="Ações Rápidas">+</button>
  `
  document.body.appendChild(fabContainer)

  const dropZoneContainer = document.createElement('div')
  dropZoneContainer.id = 'fab-drop-zone-container'
  dropZoneContainer.className = 'fab-drop-zone-container'
  dropZoneContainer.innerHTML = `
    <div class="fab-drop-zone" id="fab-drop-zone-tl" data-position="top-left"></div>
    <div class="fab-drop-zone" id="fab-drop-zone-tr" data-position="top-right"></div>
    <div class="fab-drop-zone" id="fab-drop-zone-bl" data-position="bottom-left"></div>
    <div class="fab-drop-zone" id="fab-drop-zone-br" data-position="bottom-right"></div>
  `
  document.body.appendChild(dropZoneContainer)
}

function setupFabListeners() {
  const fabContainer = document.getElementById('fab-container')
  if (!fabContainer) return

  const mainFab = fabContainer.querySelector('.main-fab')
  const dropZoneContainer = document.getElementById('fab-drop-zone-container')
  const dropZones = dropZoneContainer.querySelectorAll('.fab-drop-zone')

  fabContainer.addEventListener('click', e => {
    const actionButton = e.target.closest('.fab-option')
    if (!actionButton) return

    switch (actionButton.dataset.action) {
      case 'fab-quick-steps':
        openQuickInserterPanel()
        break
      case 'fab-reminders':
        openRemindersManagementModal()
        break
      case 'fab-notes':
        toggleNotesPanel()
        break
      case 'fab-manage-steps':
        openManagementModal()
        break
    }
  })

  let isDragging = false,
    offsetX,
    offsetY
  mainFab.addEventListener('mousedown', e => {
    isDragging = true
    fabContainer.classList.add('dragging')
    dropZoneContainer.classList.add('visible')
    const rect = fabContainer.getBoundingClientRect()
    offsetX = e.clientX - rect.left
    offsetY = e.clientY - rect.top
    e.preventDefault()
  })

  document.addEventListener('mousemove', e => {
    if (!isDragging) return
    fabContainer.style.left = `${e.clientX - offsetX}px`
    fabContainer.style.top = `${e.clientY - offsetY}px`
    fabContainer.className = 'fab-container dragging'
    dropZones.forEach(zone => {
      const rect = zone.getBoundingClientRect()
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        zone.classList.add('active')
      } else {
        zone.classList.remove('active')
      }
    })
  })

  document.addEventListener('mouseup', async e => {
    if (!isDragging) return
    isDragging = false
    fabContainer.classList.remove('dragging')
    dropZoneContainer.classList.remove('visible')
    fabContainer.style.left = ''
    fabContainer.style.top = ''

    const activeZone = dropZoneContainer.querySelector('.fab-drop-zone.active')
    let finalPosition = ''
    if (activeZone) {
      finalPosition = activeZone.dataset.position
    } else {
      const midX = window.innerWidth / 2,
        midY = window.innerHeight / 2
      finalPosition = `${e.clientY < midY ? 'top' : 'bottom'}-${
        e.clientX < midX ? 'left' : 'right'
      }`
    }
    fabContainer.className = `fab-container ${finalPosition}`
    await saveFabPosition(finalPosition)
    adjustGoToTopButtonPosition(finalPosition) // Ajusta o botão 'Ir ao Topo'
    dropZones.forEach(zone => zone.classList.remove('active'))
  })
}

/**
 * Ajusta a posição do botão 'Ir ao Topo' com base na posição do FAB.
 * @param {string} fabPosition - A posição atual do FAB (ex: 'bottom-right').
 */
function adjustGoToTopButtonPosition(fabPosition) {
  const goToTopButton = document.getElementById('floating-scroll-top-btn')
  if (!goToTopButton) return

  // Se o FAB estiver em qualquer canto direito, move o botão 'Ir ao Topo' para a esquerda.
  if (fabPosition.includes('bottom-right')) {
    goToTopButton.style.left = '25px'
    goToTopButton.style.right = 'auto'
  } else {
    // Caso contrário, volta para a posição padrão (direita).
    goToTopButton.style.right = '25px'
    goToTopButton.style.left = 'auto'
  }
}

/**
 * Cria e gerencia um botão de rolagem flutuante dinâmico.
 * O botão alterna entre 'Ir ao Topo' e 'Ir para Baixo' e fica
 * visível apenas se a página tiver uma barra de rolagem.
 */
function initializeScrollToTopButton() {
  const scrollButton = document.createElement('button')
  scrollButton.id = 'floating-scroll-top-btn'
  document.body.appendChild(scrollButton)

  // SVGs para os dois estados do botão
  const svgGoTop = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>`

  const svgGoBottom = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5v14m7-7l-7 7-7-7"/>
    </svg>`

  let currentAction = 'down' // Estado que controla a ação do clique

  // --- CORREÇÃO APLICADA AQUI ---
  // Define o estado visual inicial do botão logo após a criação.
  scrollButton.title = 'Ir para o final'
  scrollButton.innerHTML = svgGoBottom
  // --- FIM DA CORREÇÃO ---

  // Função para verificar se o botão deve estar visível
  const updateButtonVisibility = () => {
    // O botão só é visível se a altura do conteúdo for maior que a da janela
    if (document.body.scrollHeight > window.innerHeight) {
      scrollButton.classList.add('visible')
    } else {
      scrollButton.classList.remove('visible')
    }
  }

  // Função para atualizar o ícone e a dica de ferramenta do botão
  const updateButtonState = () => {
    const scrollPosition = window.scrollY

    // Se o usuário rolou mais de 200px, a ação é SUBIR
    if (scrollPosition > 200) {
      if (currentAction !== 'up') {
        currentAction = 'up'
        scrollButton.title = 'Ir ao topo'
        scrollButton.innerHTML = svgGoTop
      }
    } else {
      // Caso contrário, a ação é DESCER
      if (currentAction !== 'down') {
        currentAction = 'down'
        scrollButton.title = 'Ir para o final'
        scrollButton.innerHTML = svgGoBottom
      }
    }
  }

  // Listener de clique que usa o estado 'currentAction' para decidir o que fazer
  scrollButton.addEventListener('click', () => {
    if (currentAction === 'up') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    }
  })

  // Listener para atualizar o estado do botão durante a rolagem
  window.addEventListener('scroll', updateButtonState, { passive: true })

  // Listener para atualizar a visibilidade do botão quando a janela for redimensionada
  window.addEventListener('resize', updateButtonVisibility, { passive: true })

  // Executa as verificações iniciais ao carregar a página
  updateButtonVisibility()
  updateButtonState()
}

async function updateToolbarButtonVisibility(editorContainer) {
  if (!editorContainer) return

  const settings = await getSettings()
  const buttonsVisibility = settings.toolbarButtons || {}

  // Mapeamento completo de chaves para seletores de botões
  const buttonSelectors = {
    link: '[data-action="link"]',
    insertImage: '[data-action="insert-image"]',
    emoji: '[data-action="emoji"]',
    username: '[data-action="username"]',
    color: '[data-action="color"]',
    highlight: '[data-action="highlight"]',
    lists: '[data-action="list"]',
    bullet: '[data-action="bullet"]',
    speechToText: '[data-action="speech-to-text"]',
    reminders: '[title="Lembretes"]',
    quickSteps: '[data-action="quick-steps"]',
    quickChange: '[data-action="quick-change"]',
    notes: '[data-action="toggle-notes"]',
    separator1: '[data-id="separator1"]',
    separator2: '[data-id="separator2"]',
    separator3: '[data-id="separator3"]',
    separator4: '[data-id="separator4"]',
    separator5: '[data-id="separator5"]',
    separator6: '[data-id="separator6"]'
  }

  for (const key in buttonSelectors) {
    const button = editorContainer.querySelector(buttonSelectors[key])
    if (button) {
      // Para dropdowns, precisamos pegar o elemento pai
      const elementToToggle = button.closest('.dropdown') || button
      elementToToggle.style.display =
        buttonsVisibility[key] === false ? 'none' : ''
      if (key === 'speechToText') {
        const micSeparator = editorContainer.querySelector(
          '[data-id="mic-separator"]'
        )
        if (micSeparator) {
          micSeparator.style.display =
            buttonsVisibility[key] === false ? 'none' : ''
        }
      }
    }
  }
}

async function applyGlobalVisibilitySettings() {
  const settings = await getSettings()
  const visibility = settings.toolbarButtons || {}

  const fabContainer = document.getElementById('fab-container')
  if (fabContainer) {
    fabContainer.style.display = visibility.fab === false ? 'none' : 'flex'
  }

  const goToTopButton = document.getElementById('floating-scroll-top-btn')
  if (goToTopButton) {
    // A visibilidade do botão também depende do scroll, então usamos uma classe
    goToTopButton.style.display = visibility.goToTop === false ? 'none' : ''
  }
}

function applyAllVisibilitySettings() {
  // Atualiza todas as barras de ferramentas
  document.querySelectorAll('.editor-container').forEach(container => {
    updateToolbarButtonVisibility(container)
  })
  // Atualiza os elementos globais
  applyGlobalVisibilitySettings()
}

initializeExtension()

// --- FUNÇÕES PARA GERENCIAR BADGE DE NOTIFICAÇÃO DO FAB ---

/**
 * Verifica lembretes disparados e atualiza o badge de notificação no FAB.
 */
/**
 * Verifica lembretes e atualiza o estado do ícone de sino (badge e pulso).
 */
async function updateNotificationStatus() {
  const bellIcon = document.getElementById('sgd-notification-bell')
  if (!bellIcon) return

  const badge = bellIcon.querySelector('.notification-badge')
  if (!badge) return

  try {
    const reminders = await getReminders()
    const firedReminders = Object.values(reminders).filter(r => r.isFired)
    const count = firedReminders.length

    if (count > 0) {
      badge.textContent = count
      badge.style.display = 'flex'
      bellIcon.classList.add('pulsing')
    } else {
      badge.style.display = 'none'
      bellIcon.classList.remove('pulsing')
    }
  } catch (error) {
    console.error('Editor SGD: Erro ao atualizar status de notificação.', error)
  }
}

/**
 * Cria o ícone de sino e o injeta na barra de navegação principal do SGD.
 */
function createAndInjectBellIcon() {
  // Se o sino já existir, não faz nada
  if (document.getElementById('sgd-notification-bell')) return

  // Verifica se estamos em uma página onde o sino deve ser injetado
  // (não em páginas de login ou outras páginas específicas)
  const currentPath = window.location.pathname
  if (currentPath.includes('login.html') || currentPath.includes('logout')) {
    return // Não injeta o sino em páginas de login/logout
  }

  // Encontra o elemento de referência (o nome do usuário) para injetar o sino antes dele
  const targetLink = document.querySelector(
    'p.navbar-text.navbar-right a[href*="alt-usuario.html"]'
  )
  if (!targetLink) {
    // Só mostra o aviso se não estivermos em uma página de login
    if (!currentPath.includes('login')) {
      console.warn(
        'Editor SGD: Ponto de injeção do ícone de sino não encontrado.'
      )
    }
    return
  }
  const targetContainer = targetLink.parentElement

  // Cria o elemento do sino
  const bellElement = document.createElement('div')
  bellElement.id = 'sgd-notification-bell'
  bellElement.title = 'Notificações Pendentes'
  bellElement.innerHTML = `
    🔔
    <div class="notification-badge" style="display: none;"></div>
  `

  // Adiciona o evento de clique para abrir o painel
  bellElement.addEventListener('click', () => {
    openFiredRemindersPanel()
  })

  // Insere o sino na página, antes do nome do usuário
  targetContainer.parentNode.insertBefore(bellElement, targetContainer)
}

// --- LISTENER PARA NOTIFICAÇÕES DE LEMBRETES NA PÁGINA ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Adicionada nova condição para atualizar o badge
  if (message.action === 'UPDATE_NOTIFICATION_BADGE') {
    updateNotificationStatus()
  }

  // Exibe notificação in-page quando um lembrete dispara
  if (message.action === 'SHOW_IN_PAGE_NOTIFICATION' && message.reminder) {
    showInPageNotification(message.reminder)
  }

  if (message.action === 'CLOSE_IN_PAGE_NOTIFICATION' && message.reminderId) {
    const notification = document.getElementById(
      `in-page-notification-${message.reminderId}`
    )
    if (notification) {
      // Reutiliza a função de fade-out para uma remoção suave
      notification.classList.add('fade-out')
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification)
        }
      }, 400)
    }
  }
})
