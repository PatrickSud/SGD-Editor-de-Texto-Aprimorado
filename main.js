/**
 * @file main.js
 * @description Ponto de entrada principal da extensão. Inicializa o editor, configura listeners e observa mudanças na página.
 */

// --- INICIALIZAÇÃO ROBUSTA (MutationObserver) ---

// Variável para guardar o último conteúdo conhecido do textarea, para a verificação periódica.
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
  const {
    includePreview,
    includeQuickSteps,
    includeThemeToggle,
    includeNotes,
    includeReminders
  } = options

  if (!textArea || textArea.dataset.enhanced) return

  const masterContainer = document.createElement('div')
  masterContainer.classList.add('editor-master-container', 'mode-textarea')

  const editorContainer = document.createElement('div')
  editorContainer.id = `editor-container-${instanceId}`
  editorContainer.classList.add('editor-container')
  editorContainer.innerHTML = createEditorToolbarHtml(
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

  textArea.dataset.enhanced = instanceId

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

  if (includeQuickSteps) {
    if (instanceId === 'main') {
      await getStoredData()
    }
    loadQuickMessages(editorContainer)
  }

  if (instanceId === 'main') {
    addSgdActionButtons(masterContainer)
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
 * @returns {string} O HTML da toolbar.
 */
function createEditorToolbarHtml(
  instanceId,
  includeQuickSteps,
  includeThemeToggle,
  includePreview,
  includeNotes,
  includeReminders
) {
  const separatorHtml = '<div class="toolbar-separator"></div>'

  const quickStepsHtml = includeQuickSteps
    ? `<div class="dropdown">
        <button type="button" data-action="quick-steps" title="Trâmites Rápidos">⚡</button>
        <div class="dropdown-content quick-steps-dropdown"></div>
      </div>`
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

  const notesButtonHtml = includeNotes
    ? `<button type="button" data-action="toggle-notes" title="Anotações">✍️</button>`
    : ''

  let remindersHtml = ''
  if (includeReminders) {
    remindersHtml = `
      <div class="dropdown">
        <button type="button" title="Lembretes">⏰</button>
        <div class="dropdown-content">
          <button type="button" data-action="new-reminder">📅 Novo Lembrete</button>
          <button type="button" data-action="manage-reminders">⏳ Gerenciar Lembretes</button>
        </div>
      </div>
    `
  }

  let aiButtonsHtml = `
      <div class="dropdown">
        <button type="button" title="Recursos de IA (Gemini)" class="ai-master-button">✨</button>
        <div class="dropdown-content">
          <button type="button" data-action="ai-correct">🪄 Melhorar Texto</button> 
          <!-- <button type="button" data-action="ai-generate">💡 Gerar por Tópicos</button> -->
          <!-- <button type="button" data-action="ai-complete-draft">🚀 Completar Rascunho</button> -->
          ${
            instanceId === 'main'
              ? '<!-- <button type="button" data-action="ai-summarize">📄 Resumir Solicitação</button> -->'
              : ''
          }
        </div>
      </div>
  `

  return `
    <div class="editor-toolbar">
      ${aiButtonsHtml}
      ${separatorHtml}
      <button type="button" data-action="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
      <button type="button" data-action="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
      <button type="button" data-action="underline" title="Sublinhado (Ctrl+U)"><u>U</u></button>
      ${separatorHtml}
      <div class="dropdown">
        <button type="button" data-action="list" title="Listas (Numeração Dinâmica)">☰</button>
        <div class="dropdown-content">
          <button type="button" data-action="numbered">1. Numeração</button>
          <button type="button" data-action="sub-numbered">1.1. Subnumeração</button>
          <button type="button" data-action="lettered">A. Letra</button>
        </div>
      </div>
      <button type="button" data-action="bullet" title="Adicionar Marcador (Ctrl+M)">&bull;</button>
      ${separatorHtml}
      <button type="button" data-action="link" title="Inserir Hiperlink (Ctrl+Alt+H)">🔗</button>
      <button type="button" data-action="emoji" title="Emojis (Código HTML)">😀</button>
      <button type="button" data-action="username" title="Inserir Nome do Usuário (Alt+Shift+U)">🏷️</button>
      ${separatorHtml}
      <button type="button" data-action="color" title="Cor do Texto">🎨</button>
      <button type="button" data-action="highlight" title="Cor de Destaque">🖌️</button>
      ${separatorHtml}
      <button type="button" data-action="manage-steps" title="Configurações">⚙️</button>
      ${quickStepsHtml}
      ${remindersHtml}
      ${notesButtonHtml}
      ${separatorHtml}
      ${togglePreviewHtml}
      ${themeToggleHtml}
    </div>
    <div id="emoji-picker-${instanceId}" class="picker"></div>
    <div id="color-picker-${instanceId}" class="picker"></div>
    <div id="highlight-picker-${instanceId}" class="picker"></div>
  `
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

  // --- Listeners do Textarea ---
  if (includePreview) {
    textArea.addEventListener('input', () => {
      updatePreview(textArea)
      lastKnownTextAreaValue = textArea.value
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

  // --- Listeners da Toolbar (Delegação de Eventos) ---
  editorContainer.addEventListener('click', async e => {
    const themeOption = e.target.closest('.theme-option')
    if (themeOption && themeOption.dataset.themeName) {
      setTheme(themeOption.dataset.themeName)
      return
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
      case 'color':
        createColorPicker(
          document.getElementById(`color-picker-${instanceId}`),
          color =>
            applyFormatting(textArea, 'span', { style: `color:${color}` })
        )
        break
      case 'highlight':
        createColorPicker(
          document.getElementById(`highlight-picker-${instanceId}`),
          color =>
            applyFormatting(textArea, 'span', {
              style: `background-color:${color}`
            })
        )
        break
      case 'emoji':
        createEmojiPicker(
          document.getElementById(`emoji-picker-${instanceId}`),
          emojiHtml => insertAtCursor(textArea, emojiHtml)
        )
        break
    }

    if (['color', 'highlight', 'emoji'].includes(action)) {
      setupPickerHover(
        editorContainer,
        action,
        `${action}-picker-${instanceId}`
      )
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
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

        // --- LÓGICA DE COLETA DE AMOSTRAS E SUGESTÕES ---
        const textArea = getTargetTextArea()
        if (textArea) {
          const content = textArea.value.trim()
          // Salva se o conteúdo for relevante para treinar a IA
          if (content.length > 150) {
            saveUserResponseSample(content)
          }
          // Registra o uso para possível sugestão de trâmite
          if (content.length >= MIN_SUGGESTION_LENGTH) {
            logResponseUsage(content)
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

// --- LÓGICA DE SUGESTÃO DE TRÂMITES ---
/**
 * Verifica se existem sugestões pendentes e exibe uma notificação para a primeira.
 */
async function checkForAndDisplaySuggestions() {
  const suggestions = await getSuggestedTramites()
  if (suggestions.length === 0) return

  const suggestion = suggestions[0] // Pega a primeira sugestão da lista

  const message =
    'Notamos que você usa esta resposta com frequência. Deseja salvá-la como um trâmite?'

  // A notificação não expira automaticamente (duração 0) e tem um callback
  showNotification(message, 'suggestion', 0, () => {
    // Ao clicar na notificação:
    // 1. Abre o modal de mensagem preenchido com o conteúdo sugerido.
    openMessageModal({
      title: `Sugestão (usada ${suggestion.count} vezes)`,
      message: suggestion.content,
      categoryId: null // Nenhuma categoria pré-selecionada
    })
    // 2. Remove esta sugestão da lista de pendentes para não mostrar novamente.
    clearSuggestion(suggestion.hash)
  })
}

// --- EXECUÇÃO PRINCIPAL ---

/**
 * Função de inicialização principal que carrega o tema e inicia a observação.
 */
async function initializeExtension() {
  await loadSavedTheme()
  observeForTextArea()
  document.addEventListener('keydown', handleShortcutListener)
  initializeScrollToTopButton()

  const textArea = getTargetTextArea()
  if (textArea) {
    await initializeEditorInstance(textArea, 'main', {
      includePreview: true,
      includeQuickSteps: true,
      includeThemeToggle: true,
      includeNotes: true,
      includeReminders: true
    })
  }

  if (typeof initializeNotesPanel === 'function') {
    initializeNotesPanel()
  }

  // Verifica por sugestões de trâmites ao carregar a página
  checkForAndDisplaySuggestions()
}

/**
 * Cria e gerencia o botão flutuante 'Ir ao Topo'.
 */
function initializeScrollToTopButton() {
  const button = document.createElement('button')
  button.id = 'floating-scroll-top-btn'
  button.title = 'Ir ao topo'
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7"/>
    </svg>`

  document.body.appendChild(button)

  window.addEventListener('scroll', () => {
    if (window.scrollY > 200) {
      button.classList.add('visible')
    } else {
      button.classList.remove('visible')
    }
  })

  button.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  })
}

initializeExtension()
