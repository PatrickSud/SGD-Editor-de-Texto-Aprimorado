/**
 * @file editor-ui.js
 * Editor de texto: toolbar, instância, saudações, encerramentos, histórico.
 * Carregado por: manifest.json (content_scripts), antes de app.js e main.js
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

// Variável para armazenar temporariamente saudações e encerramentos removidos
let temporaryGreetingClosing = {
  greeting: '',
  closing: ''
}

let draggedGcItem = null // Variável global para rastrear o item arrastado

// Variável para armazenar a classificação atual (Solução ou Pedir mais informações)
let currentGcClassification = 'solution' // 'solution' (default) ou 'info'

function getSelectedResponseClassification() {
  const radioGroups = [
    'cadSscForm:tipoRespostaCliente',
    'sscForm:tipoRespostaCliente'
  ]

  for (const groupName of radioGroups) {
    const selectedRadio = document.querySelector(
      `input[type="radio"][name="${groupName}"]:checked`
    )
    if (!selectedRadio) continue

    if (selectedRadio.value === '1') {
      return 'info'
    }

    if (selectedRadio.value === '2') {
      return 'solution'
    }
  }

  return 'solution'
}

// --- NOVAS VARIÁVEIS GLOBAIS PARA EDITOR BÁSICO ---
let activeBasicEditor = null
let hideToolbarTimeout = null
let sharedToolbarInitialized = false
let previewSyncInterval = null

/**
 * Extrai apenas o conteúdo interno do texto, removendo saudação e encerramento.
 * @param {string} fullText - O texto completo do textarea.
 * @returns {object} Objeto contendo {greeting, content, closing}
 */
function extractContentParts(fullText) {
  let greeting = ''
  let content = fullText
  let closing = ''

  const greetingIndex = fullText.indexOf(GREETING_SEPARATOR)
  const closingIndex = fullText.lastIndexOf(CLOSING_SEPARATOR)

  // Se há separador de saudação
  if (greetingIndex !== -1) {
    greeting = fullText.substring(0, greetingIndex)
    // Se também há separador de encerramento
    if (closingIndex !== -1 && closingIndex > greetingIndex) {
      content = fullText.substring(
        greetingIndex + GREETING_SEPARATOR.length,
        closingIndex
      )
      closing = fullText.substring(closingIndex + CLOSING_SEPARATOR.length)
    } else {
      // Só tem saudação
      content = fullText.substring(greetingIndex + GREETING_SEPARATOR.length)
    }
  } else if (closingIndex !== -1) {
    // Só tem encerramento (sem saudação)
    content = fullText.substring(0, closingIndex)
    closing = fullText.substring(closingIndex + CLOSING_SEPARATOR.length)
  }

  return {
    greeting: greeting.trim(),
    content: content.trim(),
    closing: closing.trim()
  }
}

/**
 * Adiciona saudação e encerramento ao conteúdo, usando textos salvos ou padrões.
 * @param {string} content - O conteúdo interno atual.
 * @param {boolean} useTemporary - Se deve tentar usar textos temporários salvos.
 * @param {string} forcedClassification - Se fornecido, ignora a detecção automática e usa esta classificação.
 * @returns {Promise<string>} O texto completo com saudação e encerramento.
 */
async function addGreetingAndClosing(
  content,
  useTemporary = true,
  forcedClassification = null
) {
  let greeting = ''
  let closing = ''

  // Tenta usar textos temporários salvos
  if (
    useTemporary &&
    (temporaryGreetingClosing.greeting || temporaryGreetingClosing.closing)
  ) {
    greeting = temporaryGreetingClosing.greeting
    closing = temporaryGreetingClosing.closing

    // Limpa o cache temporário após uso
    temporaryGreetingClosing = { greeting: '', closing: '' }
  } else {
    // Detecta a classificação atual do SGD (Solução ou Pedir mais informações)
    let classification = forcedClassification

    if (!classification) {
      classification = 'solution'
      const infoRadios = [
        document.getElementById('sscForm:tipoRespostaCliente:0'),
        document.getElementById('cadSscForm:tipoRespostaCliente:0')
      ]
      const solutionRadios = [
        document.getElementById('sscForm:tipoRespostaCliente:1'),
        document.getElementById('cadSscForm:tipoRespostaCliente:1')
      ]

      if (infoRadios.some(r => r && r.checked)) {
        classification = 'info'
      } else if (solutionRadios.some(r => r && r.checked)) {
        classification = 'solution'
      }
    }

    // Busca os padrões configurados para a classificação detectada
    const data = await getGreetingsAndClosings(classification)

    if (data.defaultGreetingId) {
      const defaultGreeting = data.greetings.find(
        g => g.id === data.defaultGreetingId
      )
      if (defaultGreeting) {
        greeting = await resolveVariablesInText(defaultGreeting.content)
      }
    }

    if (data.defaultClosingId) {
      const defaultClosing = data.closings.find(
        c => c.id === data.defaultClosingId
      )
      if (defaultClosing) {
        closing = await resolveVariablesInText(defaultClosing.content)
      }
    }
  }

  // Monta o texto final
  let finalText = content

  if (greeting) {
    finalText =
      greeting + GREETING_SEPARATOR + (content ? '\n' : '') + finalText
  }

  if (closing) {
    finalText = finalText + (content ? '\n' : '') + CLOSING_SEPARATOR + closing
  }

  return finalText
}

/**
 * Configura o listener para os selects de situação do trâmite.
 * @param {HTMLTextAreaElement} textArea - O textarea do editor principal.
 */
function setupSituationListener(textArea) {
  // Delays necessários para aguardar o processamento interno do SGD após mudança de situação.
  // SGD_CHANGE_SETTLE: tempo para o SGD processar o evento de change antes de lermos select.value.
  // SGD_NATIVE_FUNCTION_DELAY: tempo para a função nativa do SGD (carregaDescricaoTramite...) executar.
  // SGD_BUTTON_FINISH_DELAY: tempo extra para garantir que o SGD terminou (ex: botão azul de confirmação).
  const SGD_CHANGE_SETTLE_MS = 100
  const SGD_NATIVE_FUNCTION_DELAY_MS = 700
  const SGD_BUTTON_FINISH_DELAY_MS = 1000

  const situationSelects = [
    document.getElementById('cadSscForm:situacaoTramite'),
    document.getElementById('sscForm:situacaoTramite'),
    document.getElementById('ssForm:situacaoTramite')
  ]

  situationSelects.forEach(select => {
    if (!select) return

    select.addEventListener('change', async () => {
      // Limpa cache temporário ao mudar de situação para evitar que padrões de uma situação
      // (ex: Em Análise) sejam levados para outra (ex: Respondido ao Cliente)
      temporaryGreetingClosing = { greeting: '', closing: '' }

      // Pequeno delay para permitir que o SGD processe a mudança internamente
      await new Promise(resolve => setTimeout(resolve, SGD_CHANGE_SETTLE_MS))
      const selectedValue = select.value

      // Aguarda a função nativa do SGD executar primeiro (carregaDescricaoTramiteSaudacaoBySituacaoTipoResposta)
      setTimeout(async () => {
        const currentText = textArea.value
        const currentSelectValue = select.value // Re-checa o valor atual para evitar race conditions

        // Valor 3 = "Respondido ao Cliente"
        // Valor 2 = "Em Análise"
        if (currentSelectValue === '3' || currentSelectValue === '2') {
          // Determina a classificação para buscar os padrões
          let classification = 'solution'
          if (currentSelectValue === '3') {
            // Se for respondido, verifica os rádios de Solução/Info
            const infoRadios = [
              document.getElementById('sscForm:tipoRespostaCliente:0'),
              document.getElementById('cadSscForm:tipoRespostaCliente:0')
            ]
            classification = infoRadios.some(r => r && r.checked)
              ? 'info'
              : 'solution'
          } else {
            // Se for "Em Análise"
            classification = 'analysis'
          }

          // Monta o novo texto (substituindo o que o SGD pode ter inserido)
          const parts = extractContentParts(currentText)

          // Se for "Em Análise", preservamos o conteúdo atual do usuário (parts.content)
          // mas forçamos a classificação 'analysis' para buscar os padrões de saudação/encerramento.
          let newText = ''
          if (currentSelectValue === '3') {
            newText = await addGreetingAndClosing(parts.content, true)
          } else {
            // Para "Em Análise", agora mantemos o conteúdo (parts.content) em vez de limpar
            newText = await addGreetingAndClosing(parts.content, false, 'analysis')
          }

          if (newText !== currentText) {
            textArea.value = newText
            textArea.dispatchEvent(new Event('input', { bubbles: true }))
          }

          // Reforço: após o site terminar possíveis atualizações tardias, reaplica se necessário
          setTimeout(async () => {
            // Garante que a situação ainda é uma das parametrizadas
            if (select.value !== '3' && select.value !== '2') return
            const latestText = textArea.value
            const latestParts = extractContentParts(latestText)
            // Se por acaso removido, reinsere saudação/encerramento
            if (!latestParts.greeting && !latestParts.closing) {
              const reapplied = await addGreetingAndClosing(
                latestParts.content,
                select.value === '3',
                select.value === '3' ? null : 'analysis'
              )
              if (reapplied !== latestText) {
                textArea.value = reapplied
                textArea.dispatchEvent(new Event('input', { bubbles: true }))
              }
            }
          }, SGD_BUTTON_FINISH_DELAY_MS)
        } else {
          // Remover saudação e encerramento (manter apenas conteúdo)
          // Inclui casos como 14 (Em Análise - Técnico), 6 (Aguardando Resposta - Interna) e 4 (Aguardando resposta do Suporte)
          const parts = extractContentParts(currentText)

          // Salva temporariamente se houver saudação ou encerramento
          if (parts.greeting || parts.closing) {
            temporaryGreetingClosing = {
              greeting: parts.greeting,
              closing: parts.closing
            }

            // Atualiza o textarea apenas com o conteúdo interno
            if (parts.content !== currentText) {
              textArea.value = parts.content
              textArea.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }
        }
      }, SGD_NATIVE_FUNCTION_DELAY_MS)
    })
  })
}


/**
 * Inicializa uma instância do editor (main ou modal).
 * @param {HTMLTextAreaElement} textArea - O textarea a ser aprimorado.
 * @param {string} instanceId - ID único para a instância (ex: 'main', 'modal-123').
 * @param {object} options - Opções de configuração.
 */
async function initializeEditorInstance(textArea, instanceId, options = {}) {
  if (!textArea || textArea.dataset.enhanced) return

  // --- INÍCIO: Injeção do Botão "Pesquisar Resposta" ---
  if (instanceId === 'main') {
    const originalSearchButton = document.querySelector(
      'input[value="Pesquisar Resposta"]'
    )
    if (originalSearchButton) {
      let labelSpan = document.querySelector(
        `[id$="${textArea.id.split(':').pop()}Label"]`
      )
      // Fallback para páginas onde o ID do textarea não corresponde ao padrão do label
      if (!labelSpan) {
        labelSpan = document.querySelector('label[id$="descricaoTramiteLabel"]')
      }
      if (labelSpan) {
        const labelCell = labelSpan.closest('td')
        if (labelCell) {
          // Evita duplicar se já existir um botão clonado na mesma célula
          if (!labelCell.querySelector('.cloned-search-button')) {
            const clonedSearchButton = document.createElement('button')
            clonedSearchButton.type = 'button'
            clonedSearchButton.textContent = '🔍'
            clonedSearchButton.className = 'cloned-search-button'
            clonedSearchButton.title = 'Pesquisar Resposta'
            clonedSearchButton.addEventListener('click', e => {
              e.preventDefault()
              const btn = document.querySelector(
                'input[value="Pesquisar Resposta"]'
              )
              if (btn && typeof btn.click === 'function') {
                btn.click()
              }
            })
            labelCell.appendChild(document.createElement('br'))
            labelCell.appendChild(clonedSearchButton)
          }
        }
      }
    }
  }
  // --- FIM: Injeção do Botão ---
  textArea.dataset.enhanced = instanceId

  const {
    includePreview,
    includeQuickSteps,
    includeThemeToggle,
    includeNotes,
    includeReminders,
    includeManageSteps = true,
    includeUsername = true,
    includeQuickStepsDropdown = true
  } = options

  const masterContainer = document.createElement('div')
  masterContainer.classList.add('editor-master-container', 'mode-textarea')

  const editorContainer = document.createElement('div')
  editorContainer.id = `editor-container-${instanceId}`
  editorContainer.classList.add('editor-container')
  editorContainer.innerHTML = await createEditorToolbarHtml(instanceId, {
    includePreview,
    includeQuickSteps,
    includeThemeToggle,
    includeNotes,
    includeReminders,
    includeManageSteps,
    includeUsername,
    includeQuickStepsDropdown
  })

  if (textArea.parentNode) {
    textArea.parentNode.insertBefore(masterContainer, textArea)
    masterContainer.appendChild(editorContainer)
    // Cria um wrapper para o textarea e o preview para o layout vertical
    const contentWrapper = document.createElement('div')
    contentWrapper.className = 'editor-content-wrapper'
    contentWrapper.appendChild(textArea)
    masterContainer.appendChild(contentWrapper)
  } else {
    console.error(
      'SGD - PowerTools: Não foi possível encontrar o elemento pai do textarea.'
    )
    return
  }

  // Botão para limpar o formulário - Movido para ser filho do masterContainer
  const clearButton = document.createElement('button')
  clearButton.type = 'button'
  clearButton.innerHTML = '🗑️'
  clearButton.title = 'Limpar campo de texto'
  clearButton.classList.add('clear-form-btn')
  clearButton.addEventListener('click', () => {
    textArea.value = ''
    // Dispara um evento de input para que outras partes da aplicação (ex: preview) sejam notificadas.
    textArea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  masterContainer.appendChild(clearButton) // Adicionado ao contêiner mestre

  // Aviso de configuração do SGSC descontinuado

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
      const layoutButton = document.getElementById(
        `preview-layout-btn-${instanceId}`
      )
      const masterContainer = textArea.closest('.editor-master-container')

      // Lógica do Pin
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

      // Lógica do Layout
      const setLayoutState = orientation => {
        masterContainer.classList.toggle(
          'vertical-layout',
          orientation === 'vertical'
        )
        layoutButton.innerHTML = orientation === 'vertical' ? '↔️' : '↕️'
        layoutButton.title =
          orientation === 'vertical'
            ? 'Alternar para visualização horizontal'
            : 'Alternar para visualização vertical'
      }

      const initialOrientation = await getPreviewOrientationState()
      setLayoutState(initialOrientation)
      if (initialOrientation === 'vertical') {
        autoGrowTextArea(textArea)
      }

      layoutButton.addEventListener('click', async () => {
        const isVertical = masterContainer.classList.contains('vertical-layout')
        const newOrientation = isVertical ? 'horizontal' : 'vertical'
        setLayoutState(newOrientation)
        await savePreviewOrientationState(newOrientation)

        // Ajusta a altura ao mudar o layout
        if (newOrientation === 'vertical') {
          autoGrowTextArea(textArea)
        } else {
          textArea.style.height = '' // Reseta para o padrão
        }
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

  // Aplica comportamento de dropdowns conforme preferência
  if (typeof applyDropdownBehaviorSetting === 'function') {
    applyDropdownBehaviorSetting()
  }

  if (instanceId === 'main') {
    addSgdActionButtons(masterContainer)
    setupSolutionObserver(textArea)
    setupUserSelectionListener(textArea)
    setupSituationListener(textArea)
    performAutoFill(textArea)

    if (typeof initializeNotesPanel === 'function') {
      initializeNotesPanel()
    }
  }
}

/**
 * Detecta se o usuário está usando o navegador Opera.
 * @returns {boolean} True se for Opera, false caso contrário.
 */
function isOperaBrowser() {
  return /Opera|OPR/.test(navigator.userAgent)
}

/**
 * Cria o HTML da toolbar do editor.
 * (Função ATUALIZADA para aceitar 'options' e corrigir o erro de digitação)
 * @param {string} instanceId - ID da instância.
 * @param {object} options - Objeto contendo flags booleanas para inclusão de botões.
 * @returns {Promise<string>} O HTML da toolbar.
 */
async function createEditorToolbarHtml(instanceId, options = {}) {
  const {
    includePreview = false,
    includeQuickSteps = false,
    includeThemeToggle = false,
    includeNotes = false,
    includeReminders = false,
    includeManageSteps = true,
    includeUsername = true,
    includeQuickStepsDropdown = true,
    includeAI = true,
    includeEmoji = true,
    includeQuickChange = true,
    includeFormatting = true,
    includeLists = true,
    includeLink = true,
    includeImage = true,
    includeColors = true
  } = options

  const settings = await getSettings()
  const buttonsVisibility =
    settings.toolbarButtons || DEFAULT_SETTINGS.toolbarButtons
  const uiSettings = settings.uiSettings || DEFAULT_SETTINGS.uiSettings
  const buttonLabelType = uiSettings.buttonLabelType || 'symbol'

  const isSpeechRecognitionSupported =
    window.SpeechRecognition || window.webkitSpeechRecognition
  const isOpera = isOperaBrowser()
  const shouldShowMicButton = isSpeechRecognitionSupported && !isOpera
  const micButtonDisabled = shouldShowMicButton ? '' : 'disabled'
  const micButtonTitle = shouldShowMicButton
    ? 'Gravar com Microfone'
    : isOpera
      ? 'Reconhecimento de voz não suportado no Opera'
      : 'Reconhecimento de voz não suportado neste navegador'

  const boldLabel = buttonLabelType === 'text' ? '<b>Negrito</b>' : '<b>B</b>'
  const italicLabel = buttonLabelType === 'text' ? '<i>Itálico</i>' : '<i>I</i>'
  const underlineLabel =
    buttonLabelType === 'text' ? '<u>Sublinhado</u>' : '<u>U</u>'

  const micButton =
    shouldShowMicButton && buttonsVisibility.speechToText !== false
      ? `<button type="button" data-action="speech-to-text" class="shine-effect" title="${micButtonTitle}" ${micButtonDisabled}>🎤</button>
       <div class="toolbar-separator" data-id="mic-separator"></div>`
      : ''

  const formattingButtons = includeFormatting
    ? `
      ${micButton}
      <button type="button" data-action="bold" class="shine-effect" title="Negrito (Ctrl+B)">${boldLabel}</button>
      <button type="button" data-action="italic" class="shine-effect" title="Itálico (Ctrl+I)">${italicLabel}</button>
      <button type="button" data-action="underline" class="shine-effect" title="Sublinhado (Ctrl+U)">${underlineLabel}</button>
      ${buttonsVisibility.separator2
      ? '<div class="toolbar-separator" data-id="separator2"></div>'
      : ''
    }
    `
    : ''

  const listButtons =
    includeLists && buttonsVisibility.lists !== false
      ? `
      <div class="dropdown">
        <button type="button" data-action="list" class="shine-effect" title="Listas (Numeração Dinâmica)">☰</button>
        <div class="dropdown-content">
          <button type="button" data-action="numbered">1. Numeração</button>
          <button type="button" data-action="sub-numbered">1.1. Subnumeração</button>
          <button type="button" data-action="lettered">A. Letra</button>
        </div>
      </div>
      ${buttonsVisibility.bullet !== false
        ? `<button type="button" data-action="bullet" class="shine-effect" title="Adicionar Marcador (Ctrl+M)">&bull;</button>`
        : ''
      }
      ${buttonsVisibility.separator3
        ? '<div class="toolbar-separator" data-id="separator3"></div>'
        : ''
      }
    `
      : ''

  const canInsertUsername = isUserNameInsertionAvailable()
  const insertButtons =
    (includeLink && buttonsVisibility.link !== false) ||
      (includeImage && buttonsVisibility.insertImage !== false) ||
      (includeUsername &&
        buttonsVisibility.username !== false &&
        canInsertUsername)
      ? `
      ${includeLink && buttonsVisibility.link !== false
        ? `<button type="button" data-action="link" class="shine-effect" title="Inserir Hiperlink (Ctrl+Alt+H)">🔗</button>`
        : ''
      }
      ${includeImage && buttonsVisibility.insertImage !== false
        ? `<button type="button" data-action="insert-image" class="shine-effect" title="Inserir Imagem (Ctrl+V)">📸</button>`
        : ''
      }
      ${includeUsername &&
        buttonsVisibility.username !== false &&
        canInsertUsername
        ? `<button type="button" data-action="username" class="shine-effect" title="Inserir Nome do Usuário (Alt+Shift+U)">🏷️</button>`
        : ''
      }
      ${buttonsVisibility.separator4
        ? '<div class="toolbar-separator" data-id="separator4"></div>'
        : ''
      }
    `
      : ''

  const colorButtons =
    includeColors &&
      (buttonsVisibility.color !== false ||
        buttonsVisibility.highlight !== false ||
        (includeEmoji && buttonsVisibility.emoji !== false))
      ? `
      ${includeEmoji && buttonsVisibility.emoji !== false
        ? `<button type="button" data-action="emoji" class="shine-effect" title="Emojis (Código HTML)">😀</button>`
        : ''
      }
      ${includeColors && buttonsVisibility.color !== false
        ? `<button type="button" data-action="color" class="shine-effect" title="Cor do Texto">🎨</button>`
        : ''
      }
      ${includeColors && buttonsVisibility.highlight !== false
        ? `<button type="button" data-action="highlight" class="shine-effect" title="Cor de Destaque">🖌️</button>`
        : ''
      }
      ${instanceId === 'shared-basic'
        ? `<button type="button" data-action="move-toolbar" class="move-toolbar-btn" title="Mover Barra de Ferramentas">⇅</button>`
        : ''
      }
      ${buttonsVisibility.separator5
        ? '<div class="toolbar-separator" data-id="separator5"></div>'
        : ''
      }
    `
      : ''

  const quickChangeButton =
    includeQuickChange && buttonsVisibility.quickChange
      ? `
    <div class="dropdown">
      <button type="button" data-action="quick-change" class="shine-effect" title="Trocar Saudação/Encerramento">🔄</button>
      <div class="dropdown-content quick-change-container">
        <span class="loading-placeholder">Carregando...</span>
      </div>
    </div>
  `
      : ''

  const quickStepsHtml =
    includeQuickSteps &&
      includeQuickStepsDropdown &&
      buttonsVisibility.quickSteps
      ? `<div class="dropdown">
        <button type="button" data-action="quick-steps" class="shine-effect" title="Trâmites Rápidos">⚡</button>
        <div class="dropdown-content quick-steps-dropdown"></div>
      </div>`
      : ''

  const remindersHtml =
    includeReminders && buttonsVisibility.reminders
      ? `
      <div class="dropdown">
        <button type="button" class="shine-effect" title="Lembretes">⏰</button>
        <div class="dropdown-content">
          <button type="button" data-action="new-reminder">📅 Novo Lembrete</button>
          <button type="button" data-action="manage-reminders">⏳ Gerenciar Lembretes</button>
        </div>
      </div>
    `
      : ''

  const notesButtonHtml =
    includeNotes && buttonsVisibility.notes
      ? `<button type="button" data-action="toggle-notes" class="shine-effect" title="Anotações">✍️</button>`
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
        <button type="button" data-action="theme-menu-button" class="shine-effect" title="Alterar Tema">🎨</button>
        <div class="dropdown-content">
          ${themeOptionsHtml}
        </div>
      </div>`
  }

  const togglePreviewHtml = includePreview
    ? `<button type="button" data-action="toggle-preview" class="shine-effect" title="Mostrar Visualização (Ctrl+Alt+V)">👁️</button>`
    : ''

  const isSscPage = window.location.pathname.includes('/sgsc/faces/ssc.html')
  if (isSscPage) {
  iniciarVerificacaoDuplicidadeSSC()
  }

  // Independente do gate de pathname acima: observa o DOM continuamente e injeta
  // o botão manual sempre que o campo cadSscForm:assunto aparecer na página.
  // Ver comentário em duplicate-checker.js (seção 9) sobre o motivo.
  observarCampoAssuntoParaBotaoDuplicidade()
  const devMode = await isDevModeEnabled()
  const pinnedAIButtons = settings.pinnedAIButtons || []

  let aiButtonsHtml = ''
  if (includeAI && buttonsVisibility.ai !== false) {
    const renderAIOption = action => {
      const feature = AI_FEATURES[action]
      const isPinned = pinnedAIButtons.includes(action)
      return `
        <div class="ai-option-wrapper">
          <button type="button" data-action="${action}" class="${isPinned ? 'is-pinned' : ''
        }">${feature.icon} ${feature.label}</button>
          <button type="button" class="pin-ai-btn ${isPinned ? 'active' : ''
        }" data-feature="${action}" title="${isPinned ? 'Desafixar' : 'Fixar na toolbar'
        }">📌</button>
        </div>
      `
    }

    let section1Html = renderAIOption('ai-complete-draft')
    if (instanceId === 'main') {
      section1Html += renderAIOption('ai-summarize')
    }

    let aiDropdownContent = section1Html

    if (isSscPage) {
      let section2Html = renderAIOption('sugerir-ss')
      if (FEATURE_SUGERIR_SAM) {
        section2Html += renderAIOption('sugerir-sam')
      }

      aiDropdownContent = `
        <div class="ai-dropdown-sections">
          <div class="ai-section">
            ${section1Html}
          </div>
          <div class="ai-section-separator"></div>
          <div class="ai-section">
            ${section2Html}
          </div>
        </div>
      `
    }

    aiButtonsHtml = `
      <div class="dropdown">
        <button type="button" title="Recursos de IA" class="ai-master-button enhanced-btn">✨ <span class="btn-label">Recursos de IA</span></button>
        <div class="dropdown-content">
          ${aiDropdownContent}
        </div>
      </div>
      ${buttonsVisibility.separator1
        ? '<div class="toolbar-separator" data-id="separator1"></div>'
        : ''
      }
    `
  }

  const pinnedAIButtonsHtml = includeAI && buttonsVisibility.ai !== false
    ? pinnedAIButtons
      .filter(action => {
        if (action === 'ai-summarize' && instanceId !== 'main') return false
        if (['sugerir-ss', 'sugerir-sam'].includes(action) && !isSscPage)
          return false
        if (action === 'sugerir-sam' && !FEATURE_SUGERIR_SAM) return false
        return true
      })
      .map(action => {
        const feature = AI_FEATURES[action]
        return `<button type="button" data-action="${action}" class="shine-effect pinned-ai-button ai-master-button" title="${feature.title}">${feature.icon} <span class="btn-label">${feature.label}</span></button>`
      })
      .join('')
    : ''

  const pinnedAIWrapperHtml = includeAI && buttonsVisibility.ai !== false
    ? `
    <div class="pinned-ai-wrapper" style="display: ${pinnedAIButtonsHtml ? 'flex' : 'none'
    }; align-items: center;">
      <div class="toolbar-separator" data-id="separator-pinned-ai"></div>
      <div class="pinned-ai-list" style="display: flex; gap: 6px;">
        ${pinnedAIButtonsHtml}
      </div>
    </div>
  `
    : ''

  const manageStepsButton = includeManageSteps
    ? '<button type="button" data-action="manage-steps" class="shine-effect" title="Configurações">⚙️</button>'
    : ''

  const separator6 =
    (includeNotes || includeReminders || includeQuickSteps) &&
      buttonsVisibility.separator6
      ? '<div class="toolbar-separator" data-id="separator6"></div>'
      : ''

  return `
    <div class="editor-toolbar">
      ${aiButtonsHtml}
      ${formattingButtons}
      ${listButtons}
      ${insertButtons}
      ${colorButtons}
      
      ${manageStepsButton}
      ${quickChangeButton}
      
      ${quickStepsHtml}
      ${remindersHtml}
      ${notesButtonHtml}
      ${separator6}
      ${togglePreviewHtml}
      ${themeToggleHtml}
      ${pinnedAIWrapperHtml}
    </div>
    
    <div id="emoji-picker-${instanceId}" class="picker"></div>
    <div id="color-picker-${instanceId}" class="picker"></div>
    <div id="highlight-picker-${instanceId}" class="picker"></div>
  `
}

/**
 * Cria e anexa um banner de aviso sobre as configurações do SGSC, se ainda não foi dispensado.
 * Nota: função atualmente não utilizada (aviso descontinuado).
 * @param {HTMLElement} masterContainer - O contêiner principal do editor.
 */
async function createAndAppendSgscWarning(masterContainer) {
  const warningDismissedKey = 'sgscWarningDismissed_v1' // Chave versionada

  // Não mostrar se já foi dispensado
  const stored = await chrome.storage.local.get(warningDismissedKey)
  if (stored[warningDismissedKey] === true) {
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
    chrome.storage.local.set({ [warningDismissedKey]: true })
  })
}

/**
 * Executa o preenchimento automático usando a saudação e/ou encerramento padrão selecionado.
 * @param {HTMLTextAreaElement} textArea - O elemento textarea do editor.
 */
async function performAutoFill(textArea) {
  // Delay para aguardar o SGD aplicar a situação/descrição via carregamento dinâmico.
  const SGD_DYNAMIC_LOAD_DELAY_MS = 800

  if (textArea.value.trim() !== '') {
    return
  }

  // Função auxiliar para obter os selects de situação
  const getSituationSelects = () => [
    document.getElementById('cadSscForm:situacaoTramite'),
    document.getElementById('sscForm:situacaoTramite'),
    document.getElementById('ssForm:situacaoTramite')
  ]

  // Checagem imediata do estado "Em análise" e outras situações que não devem ter saudação/encerramento
  let situationSelects = getSituationSelects()
  const restrictedValues = ['2', '14', '6', '4']
  if (situationSelects.some(s => s && restrictedValues.includes(s.value))) {
    // Se já estiver em uma situação restrita ao carregar, garante remoção de saudação/encerramento
    const parts = extractContentParts(textArea.value)
    if (parts.greeting || parts.closing) {
      textArea.value = parts.content
      textArea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return
  }

  // Aguarda o site aplicar a situação/descrição (carregamento dinâmico), então revalida
  await new Promise(resolve => setTimeout(resolve, SGD_DYNAMIC_LOAD_DELAY_MS))
  situationSelects = getSituationSelects()
  if (situationSelects.some(s => s && restrictedValues.includes(s.value))) {
    const parts = extractContentParts(textArea.value)
    if (parts.greeting || parts.closing) {
      textArea.value = parts.content
      textArea.dispatchEvent(new Event('input', { bubbles: true }))
    }
    return
  }

  // Verifica se o select ssForm:situacaoTramite existe e tem as opções específicas
  const ssFormSelect = document.getElementById('ssForm:situacaoTramite')
  if (ssFormSelect) {
    // Verifica se existem as opções com value "4" ou "5"
    const hasRespondidoOption = Array.from(ssFormSelect.options).some(
      option => option.value === '4'
    )
    const hasConcluidoOption = Array.from(ssFormSelect.options).some(
      option => option.value === '5'
    )

    // Se ambas as opções existirem, não preenche automaticamente
    if (hasRespondidoOption && hasConcluidoOption) {
      return
    }
  }

  const data = await getGreetingsAndClosings(
    getSelectedResponseClassification()
  )

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
 * Carrega as opções de saudação e encerramento, incluindo os botões de "Adicionar Novo" e habilita drag-and-drop.
 * @param {HTMLElement} editorContainer - O contêiner da barra de ferramentas.
 */
async function loadQuickChangeOptions(editorContainer) {
  const container = editorContainer.querySelector('.quick-change-container')
  if (!container) return

  const data = await getGreetingsAndClosings(currentGcClassification)
  let html = ''

  // Adiciona o seletor de classificação no topo
  html += `
    <div class="gc-classification-selector">
      <button type="button" class="classification-btn ${currentGcClassification === 'solution' ? 'active' : ''}" data-class="solution">Solução</button>
      <button type="button" class="classification-btn ${currentGcClassification === 'info' ? 'active' : ''}" data-class="info">Pedir Informações</button>
      <button type="button" class="classification-btn ${currentGcClassification === 'analysis' ? 'active' : ''}" data-class="analysis">Em Análise</button>
    </div>
  `

  // Função auxiliar para criar a lista de itens arrastáveis
  const createItemsHtml = (items, type) => {
    const defaultId =
      type === 'greetings' ? data.defaultGreetingId : data.defaultClosingId

    // Ordena os itens pela propriedade 'order' antes de gerar o HTML
    const sortedItems = items.sort((a, b) => (a.order || 0) - (b.order || 0))

    let itemsHtml = sortedItems
      .map(item => {
        const isActive = item.id === defaultId
        return `
        <div class="quick-change-item gc-item" draggable="true" data-id="${item.id
          }" data-type="${type}" data-order="${item.order || 0}">
          <span class="drag-handle" title="Arraste para reordenar">⠿</span>
          <button type="button" class="set-default-btn ${isActive ? 'active' : ''
          }" title="${isActive ? 'Padrão atual' : 'Definir como padrão'
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
    return itemsHtml
  }

  // Renderiza Saudações
  html += '<div class="gc-list-wrapper">'
  html += '  <div class="gc-list-header">'
  html += '    <h5>Saudações</h5>'
  html += `    <button type="button" class="add-new-item-btn mini-btn" data-type="greetings" title="Adicionar Saudação">+ Adicionar</button>`
  html += '  </div>'
  html += '  <div class="gc-list scrollable" data-list-type="greetings">'
  if (data.greetings && data.greetings.length > 0) {
    html += createItemsHtml(data.greetings, 'greetings')
  }
  html += '  </div>'
  html += '</div>'

  // Renderiza Encerramentos
  html += '<div class="gc-list-wrapper">'
  html += '  <div class="gc-list-header">'
  html += '    <h5>Encerramentos</h5>'
  html += `    <button type="button" class="add-new-item-btn mini-btn" data-type="closings" title="Adicionar Encerramento">+ Adicionar</button>`
  html += '  </div>'
  html += '  <div class="gc-list scrollable" data-list-type="closings">'
  if (data.closings && data.closings.length > 0) {
    html += createItemsHtml(data.closings, 'closings')
  }
  html += '  </div>'
  html += '</div>'

  container.innerHTML = html

  // ADICIONADO: Adiciona listeners de drag-and-drop aos itens e listas
  container
    .querySelectorAll('.quick-change-item[draggable="true"]')
    .forEach(item => {
      item.addEventListener('dragstart', handleGcDragStart)
      item.addEventListener('dragend', handleGcDragEnd)
    })
  container.querySelectorAll('.gc-list').forEach(list => {
    list.addEventListener('dragover', handleGcDragOver)
    list.addEventListener('dragleave', handleGcDragLeave)
    list.addEventListener('drop', handleGcDrop)
  })
}

function handleGcDragStart(e) {
  draggedGcItem = e.target.closest('.quick-change-item')
  if (draggedGcItem) {
    e.dataTransfer.setData('text/plain', draggedGcItem.dataset.id)
    e.dataTransfer.effectAllowed = 'move'
    // Adiciona classe com delay para visualização correta
    requestAnimationFrame(() => {
      draggedGcItem.classList.add('is-dragging')
    })
  }
}

function handleGcDragEnd(e) {
  if (draggedGcItem) {
    draggedGcItem.classList.remove('is-dragging')
  }
  draggedGcItem = null
  // Limpa indicadores visuais de drop
  document
    .querySelectorAll('.gc-item.drag-over-top, .gc-item.drag-over-bottom')
    .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'))
  // Limpa o feedback de todas as listas
  document
    .querySelectorAll('.gc-list.drag-over')
    .forEach(el => el.classList.remove('drag-over'))
}

function handleGcDragOver(e) {
  e.preventDefault() // Necessário para permitir o drop
  if (!draggedGcItem) return

  const targetList = e.currentTarget.closest('.gc-list')
  const targetItem = e.target.closest('.quick-change-item')

  // Verifica se o arraste é válido (mesmo tipo de item: saudação com saudação)
  const draggedType = draggedGcItem.dataset.type
  const targetListType = targetList.dataset.listType

  if (draggedType !== targetListType) {
    e.dataTransfer.dropEffect = 'none' // Indica drop inválido
    targetList.classList.remove('drag-over') // Garante que o feedback seja removido
    return
  } else {
    e.dataTransfer.dropEffect = 'move' // Indica drop válido
    targetList.classList.add('drag-over') // Adiciona feedback visual à lista
  }

  // Limpa indicadores anteriores
  targetList
    .querySelectorAll('.gc-item.drag-over-top, .gc-item.drag-over-bottom')
    .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'))

  if (targetItem && targetItem !== draggedGcItem) {
    const rect = targetItem.getBoundingClientRect()
    const isBottomHalf = (e.clientY - rect.top) / rect.height > 0.5
    targetItem.classList.add(
      isBottomHalf ? 'drag-over-bottom' : 'drag-over-top'
    )
  }
}

function handleGcDragLeave(e) {
  // Remove indicadores se sair da área do item ou da lista
  const targetItem = e.target.closest('.quick-change-item')
  if (targetItem) {
    targetItem.classList.remove('drag-over-top', 'drag-over-bottom')
  }
  // Verifica se saiu da lista inteira
  const list = e.currentTarget.closest('.gc-list')
  if (list && !list.contains(e.relatedTarget)) {
    list.classList.remove('drag-over') // Remove o feedback da lista
    list
      .querySelectorAll('.gc-item.drag-over-top, .gc-item.drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'))
  }
}

async function handleGcDrop(e) {
  e.preventDefault()
  if (!draggedGcItem) return

  const currentDraggedItem = draggedGcItem // Guarda referência antes de limpar
  const targetList = e.currentTarget.closest('.gc-list')
  const targetItem = document
    .elementFromPoint(e.clientX, e.clientY)
    ?.closest('.quick-change-item')

  // Verifica se o drop é válido (mesmo tipo)
  const draggedType = currentDraggedItem.dataset.type
  const targetListType = targetList.dataset.listType
  if (draggedType !== targetListType) {
    handleGcDragEnd(e) // Limpa o estado
    return
  }

  handleGcDragEnd(e) // Limpa o estado visual do drag

  // Pega todos os itens da lista alvo (no DOM) para determinar a nova ordem
  const itemsInList = Array.from(
    targetList.querySelectorAll('.quick-change-item')
  )
  let targetIndex = -1

  if (targetItem && targetItem !== currentDraggedItem) {
    const rect = targetItem.getBoundingClientRect()
    const isBottomHalf = (e.clientY - rect.top) / rect.height > 0.5
    const currentTargetIndex = itemsInList.findIndex(
      item => item === targetItem
    )
    targetIndex = isBottomHalf ? currentTargetIndex + 1 : currentTargetIndex
  } else {
    // Se soltar no espaço vazio da lista (ou sobre ele mesmo), vai para o final
    targetIndex = itemsInList.length
  }

  // Recalcula a ordem
  const data = await getGreetingsAndClosings(currentGcClassification)
  const listKey = draggedType // 'greetings' ou 'closings'

  // Filtra a lista correta e remove o item arrastado temporariamente
  let updatedList = data[listKey].filter(
    item => item.id !== currentDraggedItem.dataset.id
  )

  // Encontra o objeto do item que foi arrastado
  const draggedObject = data[listKey].find(
    item => item.id === currentDraggedItem.dataset.id
  )

  if (draggedObject) {
    // Insere o objeto arrastado na nova posição calculada
    updatedList.splice(targetIndex, 0, draggedObject)
  }

  // Reatribui a propriedade 'order' sequencialmente
  updatedList.forEach((item, index) => {
    item.order = index
  })

  // Atualiza a lista no objeto de dados principal
  data[listKey] = updatedList

  // Salva os dados atualizados
  await saveGreetingsAndClosings(data, false, currentGcClassification)

  // Recarrega o menu para refletir a nova ordem
  const editorContainer = targetList.closest('.editor-container')
  if (editorContainer) {
    loadQuickChangeOptions(editorContainer)
  }
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

      // Ajusta a altura do textarea no modo vertical
      const masterContainer = textArea.closest('.editor-master-container')
      if (
        masterContainer &&
        masterContainer.classList.contains('vertical-layout')
      ) {
        autoGrowTextArea(textArea)
      }
    })

    if (instanceId === 'main') {
      if (previewSyncInterval) clearInterval(previewSyncInterval)
      previewSyncInterval = setInterval(() => {
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

  // --- Listeners para importar trâmites via arraste (drag-and-drop) de arquivo JSON ---
  editorContainer.addEventListener('dragover', e => {
    // Só intercepta arrastes de arquivo do sistema operacional; preserva o
    // comportamento nativo de arrastar texto selecionado dentro do textarea.
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    editorContainer.classList.add('dragging-json-file')
  })

  editorContainer.addEventListener('dragleave', e => {
    // Só remove o destaque quando o cursor realmente sai do container
    // (evita "piscar" ao passar por cima de elementos filhos, como a toolbar).
    if (!editorContainer.contains(e.relatedTarget)) {
      editorContainer.classList.remove('dragging-json-file')
    }
  })

  editorContainer.addEventListener('drop', e => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    editorContainer.classList.remove('dragging-json-file')

    const [file] = e.dataTransfer.files
    if (file) handleTramiteDropImport(file)
  })

  // --- Listeners da Toolbar (Delegação de Eventos) ---
  editorContainer.addEventListener('click', async e => {
    // PIN de recursos de IA
    const pinBtn = e.target.closest('.pin-ai-btn')
    if (pinBtn) {
      e.preventDefault()
      e.stopPropagation()
      const feature = pinBtn.dataset.feature
      const settings = await getSettings()
      let pinned = settings.pinnedAIButtons || []

      const isPinnedNow = pinned.includes(feature)
      if (isPinnedNow) {
        pinned = pinned.filter(f => f !== feature)
      } else {
        pinned.push(feature)
      }

      await saveSettings({ pinnedAIButtons: pinned })

      // Atualização Cirúrgica da UI
      const isPinnedAfter = pinned.includes(feature)

      // 1. Atualiza o botão de PIN e a opacidade da opção no menu
      pinBtn.classList.toggle('active', isPinnedAfter)
      pinBtn.title = isPinnedAfter ? 'Desafixar' : 'Fixar na toolbar'

      const optionBtn = pinBtn.parentElement.querySelector(
        `button[data-action="${feature}"]`
      )
      if (optionBtn) {
        optionBtn.classList.toggle('is-pinned', isPinnedAfter)
      }

      // 2. Atualiza a lista de botões fixados na toolbar
      const pinnedWrapper = editorContainer.querySelector('.pinned-ai-wrapper')
      const pinnedList = editorContainer.querySelector('.pinned-ai-list')

      if (pinnedWrapper && pinnedList) {
        // Filtra e gera o HTML dos botões fixados (reutiliza a lógica do template)
        const pinnedButtonsHtml = pinned
          .filter(action => {
            if (action === 'ai-summarize' && instanceId !== 'main') return false
            if (
              ['sugerir-ss', 'sugerir-sam'].includes(action) &&
              !window.location.pathname.includes('/sgsc/faces/ssc.html')
            )
              return false
            if (action === 'sugerir-sam' && !FEATURE_SUGERIR_SAM) return false
            return true
          })
          .map(action => {
            const f = AI_FEATURES[action]
            return `<button type="button" data-action="${action}" class="shine-effect pinned-ai-button ai-master-button" title="${f.title}">${f.icon} <span class="btn-label">${f.label}</span></button>`
          })
          .join('')

        pinnedList.innerHTML = pinnedButtonsHtml
        pinnedWrapper.style.display = pinnedButtonsHtml ? 'flex' : 'none'
      }
      return
    }

    const themeOption = e.target.closest('.theme-option')
    if (themeOption && themeOption.dataset.themeName) {
      setTheme(themeOption.dataset.themeName)
      return
    }

    const quickChangeContainer = e.target.closest('.quick-change-container')
    if (quickChangeContainer) {
      // Ação: Mudar Classificação (Solução / Info)
      const classBtn = e.target.closest('.classification-btn')
      if (classBtn) {
        currentGcClassification = classBtn.dataset.class
        loadQuickChangeOptions(editorContainer)
        return
      }

      // Ação: Adicionar Novo Item (clique no botão + Adicionar)
      if (e.target.closest('.add-new-item-btn')) {
        const button = e.target.closest('.add-new-item-btn')
        const type = button.dataset.type // 'greetings' ou 'closings'

        // Abre o modal de criação, passando o tipo e um callback para recarregar o menu
        openGreetingClosingModal(
          null,
          type,
          () => {
            loadQuickChangeOptions(editorContainer)
            // Também recarrega a lista no modal de configurações, se estiver aberto
            const mgmtModal = document.getElementById('management-modal')
            if (mgmtModal) renderGreetingsClosingsManagement(mgmtModal)
          },
          currentGcClassification
        )
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
        const data = await getGreetingsAndClosings(currentGcClassification)
        const property =
          type === 'greetings' ? 'defaultGreetingId' : 'defaultClosingId'
        data[property] = data[property] === itemId ? null : itemId
        await saveGreetingsAndClosings(data, false, currentGcClassification)
        showNotification('Padrão atualizado!', 'success', 2000)
        loadQuickChangeOptions(editorContainer) // Recarrega o menu para refletir a mudança
        return
      }

      // Ação: Editar (clique no lápis)
      if (e.target.closest('.edit-item-btn')) {
        const data = await getGreetingsAndClosings(currentGcClassification)
        const item = data[type]?.find(i => i.id === itemId)
        if (item) {
          openGreetingClosingModal(
            item,
            type,
            () => {
              loadQuickChangeOptions(editorContainer)
              // Também recarrega a lista no modal de configurações, se estiver aberto
              const mgmtModal = document.getElementById('management-modal')
              if (mgmtModal) renderGreetingsClosingsManagement(mgmtModal)
            },
            currentGcClassification
          )
        }
        // Deixa o menu fechar
        return
      }

      // Ação: Excluir (clique na lixeira)
      if (e.target.closest('.delete-item-btn')) {
        e.stopPropagation() // Impede o menu de fechar durante a confirmação
        showConfirmDialog(
          `Excluir "${itemElement.querySelector('.quick-change-title').textContent
          }"?`,
          async () => {
            const data = await getGreetingsAndClosings(currentGcClassification)
            data[type] = data[type].filter(i => i.id !== itemId)
            if (
              (type === 'greetings' && data.defaultGreetingId === itemId) ||
              (type === 'closings' && data.defaultClosingId === itemId)
            ) {
              data[
                type === 'greetings' ? 'defaultGreetingId' : 'defaultClosingId'
              ] = null
            }
            await saveGreetingsAndClosings(data, false, currentGcClassification)
            showNotification('Item excluído.', 'success')
            loadQuickChangeOptions(editorContainer)
          }
        )
        return
      }

      // Ação Padrão: Inserir no Texto (clique no título)
      if (e.target.closest('.quick-change-title')) {
        const data = await getGreetingsAndClosings(currentGcClassification)
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
      // Adiciona loading em TODOS os botões mestre de IA da página (pode haver mais de um editor)
      document
        .querySelectorAll('.ai-master-button')
        .forEach(btn => btn.classList.add('ai-loading'))
    }

    const stopAILoading = () => {
      button.disabled = false
      button.classList.remove('ai-loading')
      document
        .querySelectorAll('.ai-master-button')
        .forEach(btn => btn.classList.remove('ai-loading'))
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
        await SpeechService.toggleRecognition(textArea)
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
          // O fluxo agora é assíncrono via WebSocket:
          // handleAISummary abre o modal de seleção de fila e retorna imediatamente.
          // O resultado chega via chrome.runtime.onMessage (resumoCompleto/resumoErro).
          // Por isso não há await nem startAILoading aqui — o loading é gerenciado
          // pela notificação "Enviando para a IA... aguarde ⏳" disparada internamente.
          handleAISummary(textArea)
        }
        break
      case 'ai-complete-draft':
        // Mesmo motivo acima: fluxo assíncrono via WebSocket.
        handleAICompleteDraft(textArea)
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
          setTimeout(() => (button.innerHTML = originalText), SGD_BUTTON_FEEDBACK_MS)
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
      case 'sub-numbered':
      case 'lettered': {
        const { selectionStart, selectionEnd, value } = textArea
        const selectedText = value.substring(selectionStart, selectionEnd)

        // Se uma seleção de múltiplas linhas existir, aplica a formatação em todas
        if (selectionEnd > selectionStart && selectedText.includes('\n')) {
          applyListFormattingToSelection(textArea, action)
        } else {
          // Caso contrário, insere um único item de lista (comportamento original)
          switch (action) {
            case 'numbered':
              insertListItem(
                textArea,
                `<b>${getNextMainNumber(textArea)}. </b>`
              )
              break
            case 'sub-numbered':
              const { main, sub } = getNextSubNumber(textArea)
              insertListItem(textArea, `<b>${main}.${sub}. </b>`)
              break
            case 'lettered':
              insertListItem(textArea, `<b>${getNextLetter(textArea)}. </b>`)
              break
          }
        }
        break
      }
      case 'manage-steps':
        openManagementModal()
        break
      case 'sugerir-ss':
        // Chama a função exposta pelo sugestor-ss.js via window.
        // Ambos os scripts rodam na ssc.html — o window é compartilhado.
        if (typeof window.iniciarSugestao === 'function') {
          startAILoading()
          // O Sugestor SS gerencia o próprio loading visual no overlay,
          // mas precisamos desativar o loading no botão mestre quando terminar.
          const checkFinished = setInterval(() => {
            const overlay = document.getElementById('sugestor-ss-overlay')
            if (!overlay || overlay.style.display === 'none') {
              clearInterval(checkFinished)
              stopAILoading()
            }
          }, 1000)

          window.iniciarSugestao().catch(() => {
            clearInterval(checkFinished)
            stopAILoading()
          })
        } else {
          showNotification(
            'Sugestor SS não disponível. Recarregue a página.',
            'error'
          )
        }
        break

      case 'sugerir-sam':
        startAILoading()
        handleAISuggestSAM().finally(() => stopAILoading())
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
 * Ajusta a altura de um textarea para corresponder ao seu conteúdo.
 * @param {HTMLTextAreaElement} textArea - O elemento textarea.
 */
function autoGrowTextArea(textArea) {
  textArea.style.height = 'auto'
  const maxHeight = 350 // O mesmo valor definido no CSS
  if (textArea.scrollHeight <= maxHeight) {
    textArea.style.height = textArea.scrollHeight + 'px'
  } else {
    textArea.style.height = maxHeight + 'px'
  }
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

  if (typeof applyOcultarPreVisualizacaoSiteSetting === 'function') {
    await applyOcultarPreVisualizacaoSiteSetting()
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
        clonedButton.textContent = 'Visualizar'
      } else if (id === 'sscForm:btnSalvarContinuar') {
        clonedButton.textContent = 'Continuar'
      } else if (id === 'cadSscForm:inserir') {
        clonedButton.textContent = 'Continuar'
      } else {
        clonedButton.textContent =
          originalButton.value || originalButton.textContent || 'Ação'
      }
      clonedButton.className = 'action-btn action-btn-themed enhanced-btn'
      clonedButton.title = `${clonedButton.textContent}`

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


function setupBasicEditorKeyboardShortcuts(textArea) {
  const handleKeydown = e => {
    // Não processa se houver popup de atalhos aberto
    if (document.getElementById('shortcut-popup')) return

    const ctrl = e.ctrlKey
    const alt = e.altKey
    const shift = e.shiftKey
    const key = e.key.toLowerCase()

    // Atalhos básicos de formatação
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

    // Atalhos com Ctrl+Alt
    if (ctrl && alt && !shift) {
      switch (key) {
        case 'h':
          e.preventDefault()
          openLinkModal(textArea)
          return
      }
    }

    // Atalho para inserir nome de usuário (Alt+Shift+U)
    if (!ctrl && alt && shift && e.key === 'U') {
      e.preventDefault()
      insertUserName(textArea)
      return
    }
  }

  textArea.addEventListener('keydown', handleKeydown)

  // Listener para colar imagens
  textArea.addEventListener('paste', e => handleImagePaste(e, textArea))
}


async function createQuickChangePopup(type, triggerElement) {
  // Remove popups antigos para evitar duplicatas
  document.querySelector('.quick-change-popup')?.remove()

  const data = await getGreetingsAndClosings(
    getSelectedResponseClassification()
  )
  const items = data[type]

  if (!items || items.length === 0) {
    showNotification(
      `Nenhum(a) ${type === 'greetings' ? 'saudação' : 'encerramento'
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
        `<button type="button" class="dropdown-option" data-id="${item.id
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
  setTimeout(() => document.addEventListener('click', closePopup, true), SGD_CLICK_GUARD_DELAY_MS)

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

  const data = await getGreetingsAndClosings(
    getSelectedResponseClassification()
  )
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
        `<button type="button" class="dropdown-option" data-id="${item.id
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
  setTimeout(() => document.addEventListener('click', closePopup, true), SGD_CLICK_GUARD_DELAY_MS)

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

