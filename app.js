/**
 * @file app.js
 * Nível de página/extensão: observers, FAB, cronômetro, notificações.
 * Carregado por: manifest.json (content_scripts), depois de editor-ui.js e antes de main.js
 */

// ─── AUTO-CAPITALIZAÇÃO DE TEXTO ───────────────────────────────────────────
// Valor em memória lido de settings.preferences.enableAutoCapitalize.
// Atualizado ao carregar a extensão e ao vivo caso outra aba altere a
// preferência (chrome.storage.onChanged), seguindo o mesmo padrão usado
// para sgdDebugLogsEnabled em config.js.
let autoCapitalizeEnabled = false

/**
 * Capitaliza a primeira letra do texto e a primeira letra após pontuação
 * de final de frase (. ! ?) ou quebra de linha, preservando a posição do
 * cursor no textarea.
 * @param {HTMLTextAreaElement} textArea
 */
function aplicarAutoCapitalizacao(textArea) {
  const originalText = textArea.value
  const { selectionStart, selectionEnd } = textArea
  const capitalizedText = originalText.replace(
    /(^\s*|[.!?]\s+|\n\s*)([a-zçáàãâéêíóôõú])/g,
    (match, espacoOuPontuacao, letra) => espacoOuPontuacao + letra.toUpperCase()
  )
  if (capitalizedText === originalText) return
  textArea.value = capitalizedText
  textArea.setSelectionRange(selectionStart, selectionEnd)
}

/**
 * Observa mudanças no DOM para lidar com carregamento dinâmico (AJAX) do SGD.
 */
function observeForTextArea() {
  const observer = new MutationObserver(async (mutations, obs) => {
    const textArea = getTargetTextArea()
    if (textArea) {
      if (typeof applyOcultarPreVisualizacaoSiteSetting === 'function') {
        await applyOcultarPreVisualizacaoSiteSetting()
      }
      if (!textArea.dataset.enhanced) {
        await initializeEditorInstance(textArea, 'main', {
          includePreview: true,
          includeQuickSteps: true,
          includeThemeToggle: true,
          includeNotes: true,
          includeReminders: true
        })
      }
    }
  })

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }
}


// --- CONTROLE DE EXIBIÇÃO DA PRÉ-VISUALIZAÇÃO NATIVA DO SITE (SGD) ---
async function applyOcultarPreVisualizacaoSiteSetting() {
  const settings = await getSettings()
  const forcarOcultar =
    settings.preferences?.ocultarPreVisualizacaoSite === true

  // Verifica se o painel de preview da extensão está visível na tela
  const previewContainer = document.getElementById(
    'editor-preview-container-main'
  )
  const extPreviewVisivel =
    previewContainer && previewContainer.style.display !== 'none'

  // Oculta se o preview da extensão estiver visível OU se a opção de ocultação forçada estiver ativada
  const ocultar = extPreviewVisivel || forcarOcultar

  // Elemento do preview
  const divPreview = document.getElementById('descricaoTramitePreview')
  if (divPreview) {
    const trPreview = divPreview.closest('tr')
    if (trPreview) {
      trPreview.style.display = ocultar ? 'none' : ''
    }
  }

  // Label "Pré-visualizar:"
  const labels = document.querySelectorAll('td.tableCadastroLabel')
  labels.forEach(td => {
    if (td.textContent.trim().includes('Pré-visualizar:')) {
      const trLabel = td.closest('tr')
      if (trLabel) {
        trLabel.style.display = ocultar ? 'none' : ''
      }
    }
  })
}

// --- CONTROLE DE COMPORTAMENTO DOS DROPDOWNS (hover/click) ---
let dropdownClickHandlers = [] // mantido por compatibilidade, não usamos mais handlers por botão
let documentClickCloser = null
let documentDropdownToggleDelegated = null

async function applyDropdownBehaviorSetting() {
  const settings = await getSettings()
  const behavior = settings.preferences?.dropdownBehavior || 'hover'
  const body = document.body

  if (behavior === 'click') {
    body.classList.add('dropdown-click-mode')
    body.classList.remove('dropdown-hover-mode')
    setupClickDropdowns()
    removeHoverDropdowns()
  } else {
    body.classList.add('dropdown-hover-mode')
    body.classList.remove('dropdown-click-mode')
    setupHoverDropdowns()
    removeClickDropdowns()
  }
}

function setupHoverDropdowns() {
  // Sem necessidade de listeners específicos; CSS controla no modo hover
}

function removeHoverDropdowns() {
  // Sem listeners para remover no modo hover
}

function setupClickDropdowns() {
  // Evita múltiplas instalações
  if (documentDropdownToggleDelegated) return

  // Fecha todos os dropdowns abertos
  const closeAll = () => {
    document
      .querySelectorAll('.dropdown.open')
      .forEach(d => d.classList.remove('open'))
  }

  // Instala o fechador global (clique fora)
  documentClickCloser = e => {
    if (!e.target.closest('.dropdown')) {
      closeAll()
    }
  }
  document.addEventListener('click', documentClickCloser, true)

  // Delegação: funciona para dropdowns na toolbar, barra fixa e modais
  documentDropdownToggleDelegated = e => {
    const trigger = e.target.closest('.dropdown > button')
    if (!trigger) return
    // Garante que seja um dropdown nosso (toolbar, barra fixa ou modal de nossa extensão)
    if (
      !trigger.closest('.editor-container, .fixed-toolbar, .se-modal-content')
    )
      return
    e.preventDefault()
    e.stopPropagation()
    const dropdown = trigger.closest('.dropdown')
    if (!dropdown) return
    // Fecha outros
    document.querySelectorAll('.dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open')
    })
    // Alterna atual
    dropdown.classList.toggle('open')
  }
  document.addEventListener('click', documentDropdownToggleDelegated, true)

  // Observação: não interrompemos a propagação dentro do conteúdo para permitir
  // que os cliques cheguem ao listener delegado da toolbar
}

function removeClickDropdowns() {
  // Remove delegação
  if (documentDropdownToggleDelegated) {
    document.removeEventListener('click', documentDropdownToggleDelegated, true)
    documentDropdownToggleDelegated = null
  }
  // Remove handlers antigos caso existam
  if (dropdownClickHandlers.length) {
    dropdownClickHandlers.forEach(({ btn, handler }) => {
      try {
        btn.removeEventListener('click', handler)
      } catch { }
    })
    dropdownClickHandlers = []
  }
  if (documentClickCloser) {
    document.removeEventListener('click', documentClickCloser, true)
    documentClickCloser = null
  }
  // Garante que nenhum permaneça aberto
  document
    .querySelectorAll('.dropdown.open')
    .forEach(d => d.classList.remove('open'))
}

/**
 * Verifica se existem lembretes pendentes que ainda não foram notificados
 * nesta sessão do navegador e exibe o toast para eles.
 */

/**
 * Configura os atalhos de teclado para um textarea do Editor Básico.
 * @param {HTMLTextAreaElement} textArea - O textarea que receberá os atalhos.
 */

async function initializeExtension() {
  const settings = await getSettings()
  applyUiSettings(settings)

  // Auto-capitalização: carrega o valor atual e mantém sincronizado ao vivo
  // caso o usuário altere a preferência (mesma aba ou outra guia aberta).
  autoCapitalizeEnabled = settings.preferences?.enableAutoCapitalize !== false
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[SETTINGS_STORAGE_KEY]) {
        const novasPreferencias = changes[SETTINGS_STORAGE_KEY].newValue?.preferences
        if (novasPreferencias && Object.prototype.hasOwnProperty.call(novasPreferencias, 'enableAutoCapitalize')) {
          autoCapitalizeEnabled = novasPreferencias.enableAutoCapitalize !== false
        }
      }
    })
  }
  document.addEventListener('input', e => {
    if (!autoCapitalizeEnabled) return
    if (e.target.tagName !== 'TEXTAREA') return
    aplicarAutoCapitalizacao(e.target)
  })

  await loadSavedTheme()
  // Aplica comportamento de dropdowns conforme preferência global
  if (typeof applyDropdownBehaviorSetting === 'function') {
    await applyDropdownBehaviorSetting()
  }
  if (typeof applyOcultarPreVisualizacaoSiteSetting === 'function') {
    await applyOcultarPreVisualizacaoSiteSetting()
  }
  SpeechService.initialize() // Inicializa o serviço de reconhecimento de voz
  observeForTextArea()
  document.addEventListener('keydown', handleShortcutListener)

  // Event listener global para botões de modais
  document.addEventListener('click', async e => {
    const button = e.target.closest('button[data-action="share-extension"]')
    if (button) {
      e.preventDefault()
      const extensionUrl =
        'https://chromewebstore.google.com/detail/sgd-powertools/gheenkbjmfijkelccofdnlcfbfeinfpe'
      try {
        await navigator.clipboard.writeText(extensionUrl)
        showNotification('Link da extensão copiado!', 'success')
      } catch (err) {
        console.error('Falha ao copiar o link:', err)
        showNotification('Erro ao copiar o link.', 'error')
      }
    }
  })

  // Cria os elementos flutuantes
  initializeScrollToTopButton()
  await createFloatingActionButtons()
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
  await checkAndShowPendingWarningToasts()
  createSpeechCommandHint()

  // --- NOVA LÓGICA DO EDITOR BÁSICO GLOBAL ---
  // 1. Inicializa a barra de ferramentas básica (ela começa oculta)
  await initializeFixedBasicToolbar()

  // 2. Listener global para 'focusin' (pega o foco em textareas)
  document.addEventListener('focusin', e => {
    if (e.target.tagName !== 'TEXTAREA') return

    // Ignora o textarea que já tem o editor COMPLETO
    if (e.target.closest('.editor-master-container')) {
      // Se estamos focando no editor principal, escondemos o básico
      const toolbar = document.getElementById('fixed-basic-toolbar')
      if (toolbar) toolbar.classList.remove('visible')
      activeBasicEditor = null
      return
    }

    // É um textarea básico!
    clearTimeout(hideToolbarTimeout)
    activeBasicEditor = e.target

    const toolbar = document.getElementById('fixed-basic-toolbar')
    if (toolbar) {
      toolbar.classList.add('visible')
    }

    // Adiciona destaque
    e.target.classList.add('basic-editor-focused')

    // Adiciona listeners de atalhos se ainda não existir
    if (!e.target._basicEditorShortcutsAdded) {
      e.target._basicEditorShortcutsAdded = true
      setupBasicEditorKeyboardShortcuts(e.target)
    }
  })

  // 3. Listener global para 'focusout' (esconde a barra)
  document.addEventListener('focusout', e => {
    if (e.target.tagName !== 'TEXTAREA') return

    // Remove o destaque
    e.target.classList.remove('basic-editor-focused')

    // Esconde a barra após um pequeno delay (permite cliques na própria barra)
    hideToolbarTimeout = setTimeout(() => {
      const toolbar = document.getElementById('fixed-basic-toolbar')
      // Só esconde se o mouse não estiver sobre a barra
      if (toolbar && !toolbar.matches(':hover')) {
        toolbar.classList.remove('visible')
        activeBasicEditor = null
      }
    }, 200)
  })
  // --- FIM DA NOVA LÓGICA ---

  observeForSscAttachmentField()
  observeForSolutionResponseRadio()
  observeForClassificationDefault()
  observeForSscAttachmentField()
  observeForSolutionResponseRadio()
  observeForClassificationDefault()

  if (window.location.pathname.includes('/sgsc/faces/ssc.html')) {
    iniciarVerificacaoDuplicidadeSSC()
  }

  // Independente do gate de pathname acima: observa o DOM continuamente e injeta
  // o botão manual sempre que o campo cadSscForm:assunto aparecer na página.
  // Ver comentário em duplicate-checker.js (seção 9) sobre o motivo.
  observarCampoAssuntoParaBotaoDuplicidade()

  await checkVersionAndShowWhatsNew()
  await checkVersionAndShowWhatsNew()

  // Inicializa a verificação de pendências
  await initializePendingBadge()

  // Verifica se deve abrir o painel de pendências automaticamente (via URL param)
  const urlParams = new URLSearchParams(window.location.search)
  if (
    urlParams.get('open_sgd_panel') === 'true' &&
    !sessionStorage.getItem('tabsToClear') &&
    sessionStorage.getItem('autoOpenPendingPanel') !== 'true'
  ) {
    // Delay um pouco maior para garantir que tudo (estilos, serviços) foi carregado
    setTimeout(async () => {
      if (typeof openInfoPanel === 'function') {
        try {
          await openInfoPanel()

          // Aguarda o modal ser injetado no DOM antes de tentar clicar na aba
          let attempts = 0
          const targetTabName = urlParams.get('target_tab') || 'pending'
          const clickTargetTab = () => {
            const targetTab = document.querySelector(
              `.ip-nav-item[data-target="${targetTabName}"]`
            )
            if (targetTab) {
              targetTab.click()
            } else if (attempts < 10) {
              attempts++
              setTimeout(clickTargetTab, SGD_TAB_NAV_RETRY_MS)
            }
          }

          // Inicia a tentativa de focar na aba
          setTimeout(clickTargetTab, SGD_TAB_NAV_INITIAL_DELAY_MS)
        } catch (error) {
          console.error('Erro ao abrir painel via parâmetro URL:', error)
        }
      } else {
        console.warn(
          'Função openInfoPanel não encontrada ao tentar abrir via parâmetro URL.'
        )
      }
    }, 1000)
  }

  // Verifica se deve abrir um aviso específico diretamente pelo parâmetro URL
  const openWarningId = urlParams.get('open_warning_id')
  if (openWarningId && typeof window.openWarningDetailModal === 'function') {
    setTimeout(async () => {
      try {
        const warnings = await window.warningsService.getWarnings()
        const warning = warnings.find(w => w.id === openWarningId)
        if (warning) {
          // Marca como lido e atualiza notificações
          if (typeof window.markWarningAsRead === 'function') {
            await window.markWarningAsRead(warning.id)
          }

          // Fecha o toast na aba atual, se existir
          const toastEl = document.getElementById(`sgd-toast-${warning.id}`)
          if (toastEl) {
            toastEl.style.animation = 'sgdToastOut 0.3s ease forwards'
            setTimeout(() => toastEl.remove(), SGD_TOAST_FADE_MS)
          }

          // Sincroniza fechamento do toast com as demais abas
          if (window.sgdChannel) {
            window.sgdChannel.postMessage({ action: 'CLOSE_TOAST', id: warning.id })
          }

          // Abre o modal de detalhes do aviso
          window.openWarningDetailModal(
            warning.id,
            warning.title,
            warning.message,
            warning.type || 'info',
            !!warning.requiredReading
          )
        } else {
          console.warn('[SGD - PowerTools] Aviso não encontrado:', openWarningId)
        }
      } catch (err) {
        console.error('[SGD - PowerTools] Erro ao abrir aviso via URL:', err)
      }
    }, 1000)
  }
}

/**
 * NOVO: Alterna a posição da barra de ferramentas fixa entre left, top, right, bottom.
 */
async function cycleToolbarPosition(toolbarElement) {
  const positions = ['left', 'top', 'right', 'bottom']
  let currentPosition = 'left'

  // Encontra a posição atual
  for (const pos of positions) {
    if (toolbarElement.classList.contains(`position-${pos}`)) {
      currentPosition = pos
      break
    }
  }

  // Calcula a próxima posição
  const currentIndex = positions.indexOf(currentPosition)
  const nextPosition = positions[(currentIndex + 1) % positions.length]

  // Remove todas as classes de posição
  positions.forEach(pos => toolbarElement.classList.remove(`position-${pos}`))

  // Adiciona a nova classe de posição
  toolbarElement.classList.add(`position-${nextPosition}`)

  // Salva a preferência no storage
  const settings = await getSettings()
  if (!settings.uiSettings) settings.uiSettings = {}
  settings.uiSettings.toolbarPosition = nextPosition
  await saveSettings(settings)
}

/**
 * NOVO: Cria a barra de ferramentas básica fixa (Singleton)
 * e a injeta no <body>.
 */
async function initializeFixedBasicToolbar() {
  if (
    document.getElementById('fixed-basic-toolbar') ||
    sharedToolbarInitialized
  )
    return
  sharedToolbarInitialized = true

  const sharedToolbar = document.createElement('div')
  sharedToolbar.id = 'fixed-basic-toolbar'
  // Começa oculta
  sharedToolbar.className = 'fixed-toolbar'

  // Carrega a posição salva
  const settings = await getSettings()
  const savedPosition = settings.uiSettings?.toolbarPosition || 'left'
  sharedToolbar.classList.add(`position-${savedPosition}`)

  // Gera o HTML da barra de ferramentas com as opções básicas
  sharedToolbar.innerHTML = await createEditorToolbarHtml('shared-basic', {
    includePreview: false,
    includeFormatting: true,
    includeLists: true,
    includeLink: true,
    includeImage: true,
    includeColors: true,
    includeEmoji: true,
    includeQuickChange: false,
    includeManageSteps: false,
    includeUsername: false,
    includeAI: false,
    includeQuickSteps: false,
    includeReminders: false,
    includeNotes: false,
    includeThemeToggle: false
  })

  document.body.appendChild(sharedToolbar)
  applyCurrentTheme(sharedToolbar)
  setupSharedToolbarListeners(sharedToolbar)
  // Aplica visibilidade das preferências também na barra fixa
  updateToolbarButtonVisibility(sharedToolbar)
}

/**
 * NOVO: Configura os listeners para a barra de ferramentas compartilhada.
 */
function setupSharedToolbarListeners(toolbarElement) {
  // Impede que o textarea perca o foco ao clicar na barra de ferramentas
  toolbarElement.addEventListener('mousedown', e => {
    clearTimeout(hideToolbarTimeout)
    if (activeBasicEditor) {
      e.preventDefault()
    }
  })

  // Dropdowns do editor básico: abrir/fechar via clique, independente do modo global
  toolbarElement.addEventListener('click', e => {
    const trigger = e.target.closest('.dropdown > button')
    if (!trigger || !toolbarElement.contains(trigger)) return
    e.preventDefault()
    e.stopPropagation()
    const dropdown = trigger.closest('.dropdown')
    const willOpen = !dropdown.classList.contains('open')
    toolbarElement
      .querySelectorAll('.dropdown.open')
      .forEach(d => d.classList.remove('open'))
    if (willOpen) dropdown.classList.add('open')
  })

  // Bloqueia comportamento de hover nos dropdowns da barra fixa
  toolbarElement.querySelectorAll('.dropdown').forEach(dropdown => {
    const button = dropdown.querySelector(':scope > button')
    const content = dropdown.querySelector('.dropdown-content')
    if (!button || !content) return

    // Impede que eventos de mouse afetem a abertura/fechamento
    const preventHover = e => {
      e.stopPropagation()
    }
    button.addEventListener('mouseenter', preventHover)
    button.addEventListener('mouseleave', preventHover)
    content.addEventListener('mouseenter', preventHover)
    content.addEventListener('mouseleave', preventHover)
  })

  // Fecha ao clicar fora da barra
  if (!toolbarElement._outsideClickHandler) {
    toolbarElement._outsideClickHandler = ev => {
      if (!toolbarElement.contains(ev.target)) {
        toolbarElement
          .querySelectorAll('.dropdown.open')
          .forEach(d => d.classList.remove('open'))
      }
    }
    document.addEventListener(
      'click',
      toolbarElement._outsideClickHandler,
      true
    )
  }

  // Listener de clique: executa as ações
  toolbarElement.addEventListener('click', e => {
    const button = e.target.closest('button[data-action]')
    if (!button) return

    // Ação de mover toolbar não precisa de editor ativo
    if (button.dataset.action === 'move-toolbar') {
      cycleToolbarPosition(toolbarElement)
      return
    }

    if (!activeBasicEditor) {
      showNotification('Clique em um campo de texto para editá-lo.', 'info')
      return
    }

    switch (button.dataset.action) {
      case 'bold':
        applyFormatting(activeBasicEditor, 'strong')
        break
      case 'italic':
        applyFormatting(activeBasicEditor, 'em')
        break
      case 'underline':
        applyFormatting(activeBasicEditor, 'u')
        break
      case 'numbered':
        insertListItem(
          activeBasicEditor,
          `<b>${getNextMainNumber(activeBasicEditor)}. </b>`
        )
        break
      case 'sub-numbered': {
        const { main, sub } = getNextSubNumber(activeBasicEditor)
        insertListItem(activeBasicEditor, `<b>${main}.${sub}. </b>`)
        break
      }
      case 'lettered':
        insertListItem(
          activeBasicEditor,
          `<b>${getNextLetter(activeBasicEditor)}. </b>`
        )
        break
      case 'bullet':
        insertBullet(activeBasicEditor)
        break
      case 'link':
        openLinkModal(activeBasicEditor)
        break
      case 'insert-image':
        openImageUploadModal(activeBasicEditor)
        break
      // 'color', 'highlight', 'emoji', 'list' tratadas pelos próprios pickers/dropdowns
    }

    if (
      !['color', 'highlight', 'emoji', 'list'].includes(button.dataset.action)
    ) {
      activeBasicEditor.focus()
    }
  })

  // Pickers de cor
  createColorPicker(
    document.getElementById('color-picker-shared-basic'),
    color => {
      if (activeBasicEditor) {
        applyFormatting(activeBasicEditor, 'span', { style: `color:${color}` })
        activeBasicEditor.focus()
      }
    }
  )
  setupPickerHover(toolbarElement, 'color', 'color-picker-shared-basic')

  createColorPicker(
    document.getElementById('highlight-picker-shared-basic'),
    color => {
      if (activeBasicEditor) {
        applyFormatting(activeBasicEditor, 'span', {
          style: `background-color:${color}`
        })
        activeBasicEditor.focus()
      }
    }
  )
  setupPickerHover(toolbarElement, 'highlight', 'highlight-picker-shared-basic')

  createEmojiPicker(
    document.getElementById('emoji-picker-shared-basic'),
    emojiHtml => {
      if (activeBasicEditor) {
        insertAtCursor(activeBasicEditor, emojiHtml)
        activeBasicEditor.focus()
      }
    }
  )
  setupPickerHover(toolbarElement, 'emoji', 'emoji-picker-shared-basic')
}

/**
 * Monitora quando o campo de descrição para anexar SSC aparece e preenche automaticamente.
 */
function observeForSscAttachmentField() {
  const fillSscField = async field => {
    // Só preenche se o campo estiver vazio e não tiver sido preenchido automaticamente antes
    if (field && !field.dataset.autoFilled && field.value.trim() === '') {
      const defaultText = `[saudacao],
 
Verificamos que já há um atendimento de mesmo assunto registrado: <a href="https://suporte.dominioatendimento.com/sgsc/faces/ssc.html?ssc=XXXXXX" style="color: rgb(255, 128, 0); font-weight: bold;">Solicitação XXXXXX</a>
 
Por gentileza, seguir acompanhando no atendimento mencionado acima.
 
Seguimos à disposição!`

      // Processa as variáveis do texto (substitui [saudacao] pela saudação apropriada)
      const processedText = await resolveVariablesInText(defaultText)

      field.value = processedText
      field.dataset.autoFilled = 'true'

      // Cria e insere o aviso acima do campo
      createSscFieldWarning(field)

      // Dispara evento de input para garantir que o sistema detecte a mudança
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  /**
   * Cria e insere um aviso acima do campo de texto quando ele é preenchido automaticamente.
   * @param {HTMLTextAreaElement} field - O campo textarea que foi preenchido.
   */
  const createSscFieldWarning = field => {
    // Verifica se o aviso já existe para evitar duplicatas
    const existingWarning =
      field.parentNode?.querySelector('.ssc-field-warning')
    if (existingWarning) return

    // Cria o elemento de aviso
    const warning = document.createElement('div')
    warning.className = 'ssc-field-warning'
    warning.innerHTML = `
      <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 10px; margin-bottom: 10px; color: #856404; font-size: 13px;">
        <strong>⚠️ Atenção:</strong>
        <ul style="margin: 8px 0 0 20px; padding: 0;">
          <li>Substitua <strong>XXXXXX</strong> na URL pelo número informado no link da Solicitação.</li>
          <li>Na Solicitação, informe o <strong>Número da SSC</strong>.</li>
        </ul>
      </div>
    `

    // Insere o aviso antes do campo (ou antes do label se existir)
    const parent = field.parentNode
    if (parent) {
      // Tenta encontrar o label do campo para inserir o aviso depois dele
      const label = parent.querySelector(`label[for="${field.id}"]`)
      if (label) {
        label.parentNode.insertBefore(warning, label.nextSibling)
      } else {
        // Se não encontrar o label, insere antes do campo
        parent.insertBefore(warning, field)
      }
    }
  }

  const observer = new MutationObserver((mutations, obs) => {
    const sscDescricaoField = document.getElementById(
      'sscAnexarSscForm:descricao'
    )
    if (sscDescricaoField) {
      fillSscField(sscDescricaoField).catch(console.error)
    }
  })

  // Observa mudanças no DOM
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    })
  }

  // Também verifica imediatamente caso o campo já exista
  const sscDescricaoField = document.getElementById(
    'sscAnexarSscForm:descricao'
  )
  if (sscDescricaoField) {
    fillSscField(sscDescricaoField).catch(console.error)
  }
}

function observeForSolutionResponseRadio() {
  const choice = (window.__sgdUserRadioChoice ||= {})
  const apply = () => {
    const names = [
      'cadSscForm:tipoRespostaCliente',
      'sscForm:tipoRespostaCliente'
    ]
    names.forEach(name => {
      const group = document.querySelectorAll(
        `input[type="radio"][name="${name}"]`
      )
      if (!group || group.length === 0) return
      group.forEach(r => {
        if (!r._sgdBound) {
          r._sgdBound = true
          r.addEventListener('change', async () => {
            // Se a mudança foi programática (via r.click() abaixo), evitamos re-execução infinita
            if (r._isProgrammaticChange) return

            choice[name] = r.value
            currentGcClassification = r.value === '1' ? 'info' : 'solution'

            // Atualiza os dropdowns da UI
            document
              .querySelectorAll('.editor-container')
              .forEach(container => loadQuickChangeOptions(container))

            // Aguarda um pouco para o SGD terminar sua própria atualização nativa
            // (carregaDescricaoTramiteSaudacaoBySituacaoTipoResposta)
            setTimeout(async () => {
              const textArea = getTargetTextArea()
              if (textArea) {
                const situationSelects = [
                  document.getElementById('cadSscForm:situacaoTramite'),
                  document.getElementById('sscForm:situacaoTramite'),
                  document.getElementById('ssForm:situacaoTramite')
                ]
                // Re-checa se ainda é Respondido ao Cliente
                const currentSituation = situationSelects.find(s => s && s.value === '3')

                if (currentSituation) {
                  const parts = extractContentParts(textArea.value)
                  // Forçamos o uso dos padrões da nova classificação (useTemporary = false)
                  const newText = await addGreetingAndClosing(
                    parts.content,
                    false
                  )
                  if (newText !== textArea.value) {
                    textArea.value = newText
                    textArea.dispatchEvent(
                      new Event('input', { bubbles: true })
                    )
                  }
                }
              }
            }, 800) // Aumentado para 800ms para sincronizar com outras partes do código
          })
        }
      })

      // Se o usuário já fez uma escolha nesta sessão, garantimos que ela seja respeitada
      // mesmo após re-renderizações do SGD (AJAX)
      if (choice[name]) {
        const preferredRadio = Array.from(group).find(
          r => r.value === choice[name]
        )
        if (preferredRadio && !preferredRadio.checked) {
          preferredRadio._isProgrammaticChange = true
          preferredRadio.click()
          delete preferredRadio._isProgrammaticChange
          currentGcClassification = choice[name] === '1' ? 'info' : 'solution'
        }
        return
      }

      const anyChecked = Array.from(group).some(r => r.checked)
      if (anyChecked) {
        const checkedRadio = Array.from(group).find(r => r.checked)
        if (checkedRadio) {
          currentGcClassification =
            checkedRadio.value === '1' ? 'info' : 'solution'
        }
        return
      }
      const sol = document.querySelector(
        `input[type="radio"][name="${name}"][value="2"]`
      )
      if (sol && !sol.checked && !sol.disabled) sol.click()
    })
  }
  const observer = new MutationObserver(() => apply())
  if (document.body)
    observer.observe(document.body, { childList: true, subtree: true })
  apply()
}

function observeForClassificationDefault() {
  const applyFor = async select => {
    if (!select) return

    // Verifica se a funcionalidade de classificação automática padrão está habilitada
    const isEnabled = await isClassificationDefaultEnabled()
    if (!isEnabled) return

    const options = Array.from(select.options)
    let seenTodas = false
    options.forEach(opt => {
      const isTodas =
        opt.value === '0' && opt.textContent.trim().toUpperCase() === 'TODAS'
      if (isTodas) {
        if (seenTodas) opt.remove()
        seenTodas = true
      }
    })
    const settings = await getSettings()
    if (!settings.uiSettings) settings.uiSettings = {}
    let preferredValue = settings.uiSettings.classificationDefaultValue
    if (!preferredValue) {
      const tecnicaOpt = Array.from(select.options).find(
        o => o.textContent.trim().toUpperCase() === 'TÉCNICA'
      )
      if (tecnicaOpt) {
        preferredValue = tecnicaOpt.value
        settings.uiSettings.classificationDefaultValue = preferredValue
        await saveSettings(settings)
      }
    }
    if (!preferredValue) {
      const firstValid = Array.from(select.options).find(o => o.value !== '0')
      if (firstValid) preferredValue = firstValid.value
    }
    const current = select.options[select.selectedIndex]?.value
    if (preferredValue && current !== preferredValue) {
      select.value = preferredValue
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (!select._classificationDefaultAttached) {
      select._classificationDefaultAttached = true
      select.addEventListener('change', async () => {
        // Apenas salva a última classificação se a funcionalidade estiver ativa
        const active = await isClassificationDefaultEnabled()
        if (!active) return

        const s = await getSettings()
        if (!s.uiSettings) s.uiSettings = {}
        s.uiSettings.classificationDefaultValue = select.value
        await saveSettings(s)
      })
    }
  }
  const handle = () => {
    const el = document.getElementById('cadSscForm:classificacao')
    if (el) applyFor(el)
  }
  const observer = new MutationObserver(() => handle())
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true })
  }
  handle()
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
      const data = await getGreetingsAndClosings(
        getSelectedResponseClassification()
      )
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
    }
  }, 250) // A verificação ocorre 4 vezes por segundo, é rápido e leve.
}

/**
 * Monitora a seleção de usuário do SGD e atualiza dinamicamente o nome
 * nos locais onde a variável [usuario] foi inserida.
 * @param {HTMLTextAreaElement} textArea - O elemento textarea do editor principal.
 */
function setupUserSelectionListener(textArea) {
  const userSelect = document.getElementById(
    typeof USER_NAME_SELECT_ID !== 'undefined'
      ? USER_NAME_SELECT_ID
      : 'cadSscForm:usuario'
  )
  if (!userSelect) return

  const typedInput = document.getElementById(
    typeof USER_NAME_INPUT_ID !== 'undefined'
      ? USER_NAME_INPUT_ID
      : 'cadSscForm:nome'
  )

  const computeFirstName = () => {
    if (userSelect.value === '-3') {
      const typedValue = typedInput ? typedInput.value.trim() : ''
      if (typedValue) {
        return typedValue.split(' ')[0]
      }
      return 'Usuário'
    }
    const selectedOption = userSelect.options[userSelect.selectedIndex]
    const fullName = selectedOption ? selectedOption.textContent.trim() : ''
    return fullName.split(' ')[0] || 'Usuário'
  }

  const updateUserVariableSpans = () => {
    const newUserName = computeFirstName()
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
      }
    }
  }

  userSelect.addEventListener('change', () => {
    updateUserVariableSpans()
  })

  if (typedInput) {
    typedInput.addEventListener('input', () => {
      if (userSelect.value === '-3') {
        updateUserVariableSpans()
      }
    })
  }

  // Atualiza imediatamente se já estiver em "Não cadastrado"
  if (userSelect.value === '-3') {
    updateUserVariableSpans()
  }
}

/**
 * Cria e exibe um popup para troca rápida de saudações ou encerramentos.
 * @param {'greetings'|'closings'} type - O tipo de item a ser exibido.
 * @param {HTMLElement} triggerElement - O ícone que acionou o popup.
 */

// --- STOPWATCH LOGIC ---

let stopwatchInterval = null
let stopwatchState = {
  startTime: null,
  accumulatedTime: 0,
  isRunning: false,
  lastActiveDate: null
}

/**
 * Inicializa o cronômetro lendo do storage e verificando reset diário.
 */
async function initializeStopwatch() {
  const data = await chrome.storage.local.get(['stopwatchState'])
  if (data.stopwatchState) {
    stopwatchState = data.stopwatchState
  }

  const today = new Date().toISOString().split('T')[0]

  // Reset diário se a data mudou
  if (stopwatchState.lastActiveDate !== today) {
    resetStopwatch()
  } else {
    // Restaura o estado
    if (stopwatchState.isRunning) {
      startStopwatchTicker()
    }
    updateStopwatchDisplay()
    updateStopwatchIcon()
  }
}

function toggleStopwatch() {
  if (stopwatchState.isRunning) {
    pauseStopwatch()
  } else {
    startStopwatch()
  }
}

function startStopwatch() {
  stopwatchState.isRunning = true
  stopwatchState.startTime = Date.now()
  stopwatchState.lastActiveDate = new Date().toISOString().split('T')[0]

  saveStopwatchState()
  startStopwatchTicker()
  updateStopwatchIcon()
}

function pauseStopwatch() {
  if (!stopwatchState.isRunning) return

  // Acumula o tempo decorrido no segmento atual
  const now = Date.now()
  stopwatchState.accumulatedTime += now - stopwatchState.startTime
  stopwatchState.startTime = null // Reseta o início do segmento
  stopwatchState.isRunning = false

  saveStopwatchState()
  stopStopwatchTicker()
  updateStopwatchDisplay() // Garante que mostre o valor exato final
  updateStopwatchIcon()
}

function resetStopwatch() {
  stopwatchState = {
    startTime: null,
    accumulatedTime: 0,
    isRunning: false,
    lastActiveDate: new Date().toISOString().split('T')[0]
  }
  saveStopwatchState()
  stopStopwatchTicker()
  stopStopwatchTicker()
  updateStopwatchDisplay()
  updateStopwatchIcon()
}

function setStopwatchTime() {
  const timerText = document.getElementById('fab-timer-text')
  const timerInput = document.getElementById('fab-timer-input')

  if (!timerText || !timerInput) return

  // Pausa se estiver rodando para evitar inconsistências
  if (stopwatchState.isRunning) {
    pauseStopwatch()
  }

  // Prepara o input
  let currentMs = stopwatchState.accumulatedTime
  if (stopwatchState.isRunning && stopwatchState.startTime) {
    currentMs += Date.now() - stopwatchState.startTime
  }

  timerInput.value = formatTime(currentMs)

  // Alterna visibilidade
  timerText.style.display = 'none'
  timerInput.style.display = 'inline-block'

  // Adiciona classe de edição para manter visível
  const wrapper = document.getElementById('fab-stopwatch-wrapper')
  if (wrapper) wrapper.classList.add('is-editing')

  // Foca e seleciona tudo
  setTimeout(() => {
    timerInput.focus()
    timerInput.select()
  }, 10)
}

function handleStopwatchInputComplete(save = true) {
  const timerText = document.getElementById('fab-timer-text')
  const timerInput = document.getElementById('fab-timer-input')

  if (!timerText || !timerInput) return
  if (timerInput.style.display === 'none') return

  if (save) {
    const milliseconds = parseTimeString(timerInput.value)
    if (milliseconds !== null) {
      stopwatchState.accumulatedTime = milliseconds
      stopwatchState.isRunning = false
      saveStopwatchState()
    } else {
      // Opcional: mostrar erro discreto ou apenas não salvar
    }
  }

  // Volta ao estado normal
  timerInput.style.display = 'none'
  timerText.style.display = 'inline-block'

  // Remove classe de edição
  const wrapper = document.getElementById('fab-stopwatch-wrapper')
  if (wrapper) wrapper.classList.remove('is-editing')

  updateStopwatchDisplay()
  updateStopwatchIcon()
}

function parseTimeString(timeString) {
  const parts = timeString.split(':')
  if (parts.length !== 3) return null

  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(parts[2], 10)

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null

  return (hours * 3600 + minutes * 60 + seconds) * 1000
}

function startStopwatchTicker() {
  stopStopwatchTicker() // Evita múltiplos intervalos
  stopwatchInterval = setInterval(updateStopwatchDisplay, 1000)
  updateStopwatchDisplay() // Atualiza imediatamente
}

function stopStopwatchTicker() {
  if (stopwatchInterval) {
    clearInterval(stopwatchInterval)
    stopwatchInterval = null
  }
}

function updateStopwatchIcon() {
  const btn = document.getElementById('fab-timer-toggle')
  const wrapper = document.getElementById('fab-stopwatch-wrapper')

  if (btn) {
    btn.textContent = stopwatchState.isRunning ? '⏸️' : '▶️'
    btn.title = stopwatchState.isRunning
      ? 'Pausar (Ctrl+Alt+T)'
      : 'Iniciar (Ctrl+Alt+T)'
  }

  if (wrapper) {
    wrapper.classList.toggle('is-running', stopwatchState.isRunning)
  }
}

function updateStopwatchDisplay() {
  const timerText = document.getElementById('fab-timer-text')
  if (!timerText) return

  let totalMilliseconds = stopwatchState.accumulatedTime

  if (stopwatchState.isRunning && stopwatchState.startTime) {
    totalMilliseconds += Date.now() - stopwatchState.startTime
  }

  // Atualiza as cores baseadas no tempo
  // 1 hora = 3.600.000 ms
  // 1 hora e 30 minutos = 5.400.000 ms
  const isDanger = totalMilliseconds >= 5400000
  const isWarning = totalMilliseconds >= 3600000 && !isDanger

  timerText.classList.toggle('timer-warning', isWarning)
  timerText.classList.toggle('timer-danger', isDanger)

  timerText.textContent = formatTime(totalMilliseconds)
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const pad = num => num.toString().padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function saveStopwatchState() {
  chrome.storage.local.set({ stopwatchState })
}

// ----------------------

/**
 * Cria os botões flutuantes (FAB) e seus menus.
 */
async function createFloatingActionButtons() {
  if (document.getElementById('fab-container')) return

  const fabContainer = document.createElement('div')
  fabContainer.id = 'fab-container'
  fabContainer.className = 'fab-container'

  // Carrega a ordem salva ou usa a padrão
  const data = await chrome.storage.local.get([
    'fabOptionsOrder',
    'fabWidgetsOrder'
  ])

  const defaultOptionsOrder = [
    'fab-wrapper-info',
    'fab-wrapper-notes',
    'fab-wrapper-reminders',
    'fab-wrapper-quicksteps',
    'fab-wrapper-manage'
  ]
  const defaultWidgetsOrder = ['fab-copy-ssc-wrapper', 'fab-stopwatch-wrapper']

  const optionsOrder = data.fabOptionsOrder || defaultOptionsOrder
  const widgetsOrder = data.fabWidgetsOrder || defaultWidgetsOrder

  // Mapa de conteúdo dos botões de opções
  const optionsContent = {
    'fab-wrapper-info': `
        <button type="button" class="fab-pin-btn" title="Fixar" data-target="fab-wrapper-info">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" class="fab-button fab-option shine-effect" data-action="fab-info-panel" data-tooltip="Central de Informações">ℹ️</button>
        <span class="fab-badge"></span>
    `,
    'fab-wrapper-notes': `
        <button type="button" class="fab-pin-btn" title="Fixar" data-target="fab-wrapper-notes">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" class="fab-button fab-option shine-effect" data-action="fab-notes" data-tooltip="Anotações">✍️</button>
    `,
    'fab-wrapper-reminders': `
        <button type="button" class="fab-pin-btn" title="Fixar" data-target="fab-wrapper-reminders">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" class="fab-button fab-option shine-effect" data-action="fab-reminders" data-tooltip="Gerenciar Lembretes">⏰</button>
    `,
    'fab-wrapper-quicksteps': `
        <button type="button" class="fab-pin-btn" title="Fixar" data-target="fab-wrapper-quicksteps">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" class="fab-button fab-option shine-effect" data-action="fab-quick-steps" data-tooltip="Trâmites">⚡</button>
    `,
    'fab-wrapper-manage': `
        <button type="button" class="fab-pin-btn" title="Fixar" data-target="fab-wrapper-manage">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" class="fab-button fab-option shine-effect" data-action="fab-manage-steps" data-tooltip="Configurações">⚙️</button>
    `
  }

  // Mapa de conteúdo dos widgets laterais
  const widgetsContent = {
    'fab-copy-ssc-wrapper': `
        <button type="button" class="fab-pin-btn" title="Fixar Link SSC" data-target="fab-copy-ssc-wrapper">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" id="fab-copy-ssc-link" class="stopwatch-btn" title="Copiar Link SSC">🔗</button>
    `,
    'fab-stopwatch-wrapper': `
        <button type="button" class="fab-pin-btn" title="Fixar Cronômetro" data-target="fab-stopwatch-wrapper">
          <svg viewBox="0 0 24 24"><path d="M12,2A3,3 0 0,1 15,5V11L17,13V15H13V21L12,22L11,21V15H7V13L9,11V5A3,3 0 0,1 12,2Z" /></svg>
        </button>
        <button type="button" id="fab-timer-toggle" class="stopwatch-btn" title="Iniciar/Pausar">▶️</button>
        <span id="fab-timer-text">00:00:00</span>
        <input type="text" id="fab-timer-input" class="fab-timer-input" style="display: none;" placeholder="00:00:00" />
        <button type="button" id="fab-timer-reset" class="stopwatch-btn" title="Zerar">↺</button>
        <button type="button" id="fab-timer-set" class="stopwatch-btn" title="Definir Tempo">✎</button>
    `
  }

  // Monta o HTML das opções baseado na ordem
  let optionsHtml = ''
  optionsOrder.forEach(id => {
    if (optionsContent[id]) {
      optionsHtml += `<div class="fab-option-wrapper" id="${id}" draggable="true">${optionsContent[id]}</div>`
    }
  })

  // Monta o HTML dos widgets baseado na ordem
  const widgetClassMap = {
    'fab-copy-ssc-wrapper': 'fab-copy-ssc-wrapper',
    'fab-stopwatch-wrapper': 'fab-stopwatch-wrapper'
  }
  let widgetsHtml = ''
  widgetsOrder.forEach(id => {
    if (widgetsContent[id]) {
      widgetsHtml += `<div class="${widgetClassMap[id] || id}" id="${id}" draggable="true">${widgetsContent[id]}</div>`
    }
  })

  fabContainer.innerHTML = `
    <div class="fab-options" id="fab-options">
      ${optionsHtml}
    </div>
    <button type="button" class="fab-button main-fab" title="Ações Rápidas">+</button>
    <div class="fab-lateral-widgets" id="fab-lateral-widgets">
      ${widgetsHtml}
    </div>
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
      case 'fab-info-panel':
        // Marca pendências como vistas ao abrir o painel
        handleInfoPanelOpen()
        openInfoPanel()
        break

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

  // Listeners para os botões do cronômetro (Wrapper dedicado)
  fabContainer.addEventListener('click', e => {
    // Verifica se o clique foi no botão de Copiar Link SSC
    const copySscBtn = e.target.closest('#fab-copy-ssc-link')
    if (copySscBtn) {
      e.stopPropagation()
      copySscLink()
      return
    }


    // Verifica se o clique foi no botão de Toggle (Play/Pause)
    const toggleBtn = e.target.closest('#fab-timer-toggle')
    if (toggleBtn) {
      e.stopPropagation()
      toggleStopwatch()
      return
    }

    // Verifica botões de controle (Reset / Set)
    const resetBtn = e.target.closest('#fab-timer-reset')
    const setBtn = e.target.closest('#fab-timer-set')

    if (resetBtn) {
      e.stopPropagation()
      resetStopwatch()
    } else if (setBtn) {
      e.stopPropagation()
      setStopwatchTime()
    }
  })

  // Listeners para o input do cronômetro
  fabContainer.addEventListener('keydown', e => {
    if (e.target.id === 'fab-timer-input') {
      if (e.key === 'Enter') {
        handleStopwatchInputComplete(true)
      } else if (e.key === 'Escape') {
        handleStopwatchInputComplete(false)
      }
    }
  })

  fabContainer.addEventListener('focusout', e => {
    if (e.target.id === 'fab-timer-input') {
      // Pequeno delay para permitir que o clique em botões de salvar (se existissem) ocorresse
      // Mas aqui usamos focusout para completar a edição
      handleStopwatchInputComplete(true)
    }
  })

  // Atalho global para o cronômetro
  document.addEventListener('keydown', e => {
    // Ctrl + Alt + T
    if (e.ctrlKey && e.altKey && e.code === 'KeyT') {
      e.preventDefault()
      toggleStopwatch()

      // Feedback visual via notificação
      const status = stopwatchState.isRunning
        ? '⏱️ Cronômetro Iniciado'
        : '⏱️ Cronômetro Pausado'
      if (typeof showNotification === 'function') {
        showNotification(status)
      }
    }
  })

  // Listener para os botões de Pin (Fixar)
  fabContainer.addEventListener('click', e => {
    const pinBtn = e.target.closest('.fab-pin-btn')
    if (pinBtn) {
      e.stopPropagation()
      const targetId = pinBtn.dataset.target
      toggleFabPin(targetId)
    }
  })

  // Initialize Stopwatch functionality
  initializeStopwatch()
  // Inicializa o estado dos Pins
  initializeFabPins()
  // Configura reordenação via Drag and Drop
  setupFabDragAndDrop()

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
      finalPosition = `${e.clientY < midY ? 'top' : 'bottom'}-${e.clientX < midX ? 'left' : 'right'
        }`
    }
    fabContainer.className = `fab-container ${finalPosition}`
    await saveFabPosition(finalPosition)
    adjustGoToTopButtonPosition(finalPosition) // Ajusta o botão 'Ir ao Topo'
    dropZones.forEach(zone => zone.classList.remove('active'))
  })
}

/**
 * Configura a funcionalidade de arrastar e soltar para reordenar os botões do FAB.
 */
function setupFabDragAndDrop() {
  const containers = [
    document.getElementById('fab-options'),
    document.getElementById('fab-lateral-widgets')
  ]

  containers.forEach(container => {
    if (!container) return

    container.addEventListener('dragstart', e => {
      const draggable = e.target.closest('[draggable="true"]')
      if (!draggable) return

      draggable.classList.add('is-dragging')
      e.dataTransfer.setData('text/plain', draggable.id)
      e.dataTransfer.effectAllowed = 'move'
    })

    container.addEventListener('dragend', e => {
      const draggable = e.target.closest('[draggable="true"]')
      if (draggable) {
        draggable.classList.remove('is-dragging')
      }

      // Remove classes de drag-over de todos os itens
      container
        .querySelectorAll('.drag-over')
        .forEach(el => el.classList.remove('drag-over'))

      // Salva a nova ordem
      saveFabItemsOrder(container.id)
    })

    container.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      const draggable = container.querySelector('.is-dragging')
      if (!draggable) return

      const afterElement = getDragAfterElement(container, e.clientY, e.clientX)
      if (afterElement == null) {
        container.appendChild(draggable)
      } else {
        container.insertBefore(draggable, afterElement)
      }

      // Feedback visual do alvo
      container.querySelectorAll('[draggable="true"]').forEach(el => {
        if (el !== draggable) {
          el.classList.remove('drag-over')
        }
      })
    })
  })
}

/**
 * Determina qual elemento está logo após a posição do mouse durante o arraste.
 */
function getDragAfterElement(container, y, x) {
  const draggableElements = [
    ...container.querySelectorAll('[draggable="true"]:not(.is-dragging)')
  ]

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect()

      // Para fab-options (vertical)
      if (container.id === 'fab-options') {
        const offset = y - box.top - box.height / 2
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child }
        } else {
          return closest
        }
      }
      // Para fab-lateral-widgets (horizontal)
      else {
        const offset = x - box.left - box.width / 2
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child }
        } else {
          return closest
        }
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element
}

/**
 * Salva a ordem atual dos itens de um container no storage.
 */
async function saveFabItemsOrder(containerId) {
  const container = document.getElementById(containerId)
  if (!container) return

  const items = [...container.querySelectorAll('[draggable="true"]')]
  const order = items.map(item => item.id)

  if (containerId === 'fab-options') {
    await chrome.storage.local.set({ fabOptionsOrder: order })
  } else if (containerId === 'fab-lateral-widgets') {
    await chrome.storage.local.set({ fabWidgetsOrder: order })
  }
}

/**
 * Captura as informações da Solicitação de Suporte (SSC) atual e copia
 * um texto de trâmite formatado com link dinâmico para a área de transferência.
 */
function copySscLink() {
  const hidden =
    document.querySelector('input[id*="ssc"]') ||
    document.querySelector('input[name*="ssc"]')

  let ssc = null
  if (hidden && hidden.value) {
    ssc = hidden.value.trim()
  } else {
    const params = new URLSearchParams(window.location.search)
    ssc = params.get('ssc')
  }

  const numeroEl = document.querySelector('#td\\:numero')
  const assuntoEl = document.querySelector('#td\\:assunto')

  if (!ssc || !numeroEl || !assuntoEl) {
    if (typeof showNotification === 'function') {
      showNotification(
        'Não foi possível capturar as informações da SSC nesta página.',
        'error'
      )
    } else {
      alert('❌ Não foi possível capturar todas as informações.')
    }
    return
  }

  const numero = numeroEl.innerText.trim()
  const assunto = assuntoEl.innerText.trim()

  const textToCopy = `Então, verifiquei que estamos avaliando esse mesmo assunto em outra Solicitação de Suporte.

Caso queira acessar a outra Solicitação, poderá acessar pelo link: <input name="" type="button" button style="background: #fa6400; border-radius: 5px; padding: 3px; cursor: pointer; color: #fff; border: none;" onclick="window.open(' https://suporte.dominioatendimento.com/sgsc/faces/ssc.html?ssc=${ssc}')" value="SSC ${numero} - ${assunto}, Clique aqui!"></button>

Sigo a disposição.`

  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      if (typeof showNotification === 'function') {
        showNotification(
          'Link da SSC copiado com sucesso! Gerado Trâmite com o link para o cliente.',
          'success'
        )
      }
    })
    .catch(err => {
      console.error('Erro ao copiar o link da Solicitação de Suporte: ', err)
      if (typeof showNotification === 'function') {
        showNotification(
          'Erro ao copiar o link da Solicitação de Suporte.',
          'error'
        )
      }
    })
}

// URL do assistente de suporte IAgente
const IAGENTE_URL =
  'https://tria.plugsocial.online/?assunto=sped&codigoCliente=96797&identificacaoRevenda=3'

/**
 * Abre o IAgente em uma janela dedicada do navegador (estilo "app", sem barra
 * de endereço), ou traz para frente a janela já existente.
 *
 * A janela é criada e gerenciada pelo service worker, pois a API chrome.windows
 * não está disponível em content scripts.
 *
 * Por que janela dedicada (e não iframe embutido): o assistente Botpress/Tria
 * não inicia a conversa quando carregado dentro de um iframe de outra origem
 * (detecção de frame no lado da Tria). Em janela própria, a Tria volta a ser a
 * página principal e funciona normalmente, com maximizar/redimensionar nativos.
 */
async function toggleIAgenteWindow() {
  try {
    const url = window.sgdPermissions?.getIAgenteUrl ? await window.sgdPermissions.getIAgenteUrl() : IAGENTE_URL
    chrome.runtime.sendMessage(
      { action: 'IAGENTE_OPEN_WINDOW', url: url },
      resp => {
        if (chrome.runtime.lastError) return
        if (resp && typeof resp.open === 'boolean') {
          updateIAgenteFabState(resp.open)
        }
      }
    )
  } catch (e) {
    /* Ignora falhas de mensageria. */
  }
}

/**
 * Consulta o service worker sobre o estado atual da janela do IAgente e
 * sincroniza o botão flutuante (útil ao carregar/recarregar a página).
 */
function refreshIAgenteFabState() {
  try {
    chrome.runtime.sendMessage({ action: 'IAGENTE_GET_STATE' }, resp => {
      if (chrome.runtime.lastError) return
      if (resp && typeof resp.open === 'boolean') {
        updateIAgenteFabState(resp.open)
      }
    })
  } catch (e) {
    /* Ignora. */
  }
}

/**
 * Sincroniza o estado visual do botão IAgente com a janela dedicada.
 * @param {boolean} isOpen - Se a janela do IAgente está aberta.
 */
function updateIAgenteFabState(isOpen) {
  const btn = document.getElementById('iagente-scroll-btn')
  if (!btn) return
  btn.classList.toggle('active', isOpen)
  btn.title = isOpen
    ? 'IAgente - Trazer janela para frente'
    : 'IAgente - Solicitar Suporte'
}

// Mantém o botão sincronizado quando a janela do IAgente é aberta ou fechada a
// partir de qualquer guia: o service worker transmite o estado para todas as
// abas do SGD sempre que a janela é criada ou encerrada.
try {
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.action === 'IAGENTE_WINDOW_STATE') {
      updateIAgenteFabState(!!message.open)
    }
  })
} catch (e) {
  /* Ambiente sem chrome.runtime; ignora. */
}

/**
 * Gerencia o estado de "Fixar" (Pin) dos menus do FAB.
 */
async function initializeFabPins() {
  const data = await chrome.storage.local.get(['fabPinnedState'])
  const pinnedState = data.fabPinnedState || {}

  // Aplica o estado salvo
  Object.keys(pinnedState).forEach(targetId => {
    if (pinnedState[targetId]) {
      const element = document.getElementById(targetId)
      if (element) {
        element.classList.add('is-pinned')
        const pinBtn = element.querySelector('.fab-pin-btn')
        if (pinBtn) pinBtn.classList.add('active')
      }
    }
  })

  updateFabOptionsPinnedState()
}

async function toggleFabPin(targetId) {
  const element = document.getElementById(targetId)
  if (!element) return

  const isPinned = element.classList.toggle('is-pinned')

  // Atualiza visual do botão
  const pinBtn = element.querySelector('.fab-pin-btn')
  if (pinBtn) pinBtn.classList.toggle('active', isPinned)

  // Salva no storage
  const data = await chrome.storage.local.get(['fabPinnedState'])
  const pinnedState = data.fabPinnedState || {}
  pinnedState[targetId] = isPinned
  await chrome.storage.local.set({ fabPinnedState: pinnedState })

  // Se for uma ferramenta do menu de opções, atualiza o estado do container pai
  if (targetId.startsWith('fab-wrapper-')) {
    updateFabOptionsPinnedState()
  }
}

/**
 * Verifica se existem ferramentas fixadas dentro das opções rápidas
 * e aplica a classe no container pai para mantê-lo visível.
 */
function updateFabOptionsPinnedState() {
  const optionsContainer = document.getElementById('fab-options')
  if (!optionsContainer) return

  const hasPinnedItems = optionsContainer.querySelector('.is-pinned') !== null
  optionsContainer.classList.toggle('has-pinned-items', hasPinnedItems)
}

/**
 * Ajusta a posição do botão 'Ir ao Topo' com base na posição do FAB.
 * @param {string} fabPosition - A posição atual do FAB (ex: 'bottom-right').
 */
function adjustGoToTopButtonPosition(fabPosition) {
  const btnGroup = document.getElementById('scroll-btn-group')
  if (!btnGroup) return

  // Se o FAB estiver em qualquer canto direito, move o grupo para a esquerda.
  if (fabPosition.includes('right')) {
    btnGroup.style.left = '25px'
    btnGroup.style.right = 'auto'
  } else {
    // Caso contrário, volta para a posição padrão (direita).
    btnGroup.style.right = '25px'
    btnGroup.style.left = 'auto'
  }
}

/**
 * Cria e gerencia um botão de rolagem flutuante dinâmico.
 * O botão alterna entre 'Ir ao Topo' e 'Ir para Baixo' e fica
 * visível apenas se a página tiver uma barra de rolagem.
 */
async function initializeScrollToTopButton() {
  // Grupo que contém o botão IAgente e o botão Ir ao Topo lado a lado
  const btnGroup = document.createElement('div')
  btnGroup.id = 'scroll-btn-group'

  // TODO: Liberar o botão IAgente para todos os usuários quando aprovado.
  // Por enquanto restrito a usuários com Modo Dev ativo na Central de Informações
  // (isInfoDevModeEnabled) ou que já sejam editores (sgdPermissions.isEditor) ou que possuam acesso ativo.
  try {
    const hasAccess = window.sgdPermissions?.hasIAgenteAccess ? await window.sgdPermissions.hasIAgenteAccess() : false
    if (hasAccess) {
      const iagenteBtn = document.createElement('button')
      iagenteBtn.id = 'iagente-scroll-btn'
      iagenteBtn.className = 'shine-effect'
      iagenteBtn.title = 'IAgente - Solicitar Suporte'
      iagenteBtn.innerHTML = '<img src="https://suporte.dominioatendimento.com/central/imagens/tria10.png" alt="IAgente" class="iagente-scroll-icon">'
      iagenteBtn.addEventListener('click', toggleIAgenteWindow)
      btnGroup.appendChild(iagenteBtn)
      // Sincroniza o estado do botão com a janela do IAgente (caso já esteja aberta).
      refreshIAgenteFabState()
    }
  } catch (e) {
    // Falha no setup do IAgente nunca deve impedir a criação do botão de scroll.
    console.error('Erro ao inicializar o botão IAgente:', e)
  }

  // Botão Ir ao Topo / Ir para o Final (à direita)
  const scrollButton = document.createElement('button')
  scrollButton.id = 'floating-scroll-top-btn'
  scrollButton.className = 'shine-effect'
  btnGroup.appendChild(scrollButton)

  document.body.appendChild(btnGroup)

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

  // Retorna true quando a janela está pequena demais para exibir os botões flutuantes.
  // Os limiares espelham FAB_MIN_WINDOW_WIDTH / FAB_MIN_WINDOW_HEIGHT (config.js).
  // A media query CSS já oculta visualmente os elementos; esta função mantém
  // a classe .visible sincronizada para que eventos de scroll não a reativem.
  const isWindowTooSmall = () =>
    window.innerWidth < FAB_MIN_WINDOW_WIDTH ||
    window.innerHeight < FAB_MIN_WINDOW_HEIGHT

  // Função para verificar se o botão deve estar visível
  const updateButtonVisibility = () => {
    // Oculta se a janela for pequena demais, independente de haver barra de rolagem
    if (isWindowTooSmall() || document.body.scrollHeight <= window.innerHeight) {
      scrollButton.classList.remove('visible')
    } else {
      scrollButton.classList.add('visible')
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
    ai: '.ai-master-button:not(.pinned-ai-button)',
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
      
      if (key === 'separator1') {
        const isAiVisible = buttonsVisibility.ai !== false
        elementToToggle.style.display =
          (buttonsVisibility[key] === false || !isAiVisible) ? 'none' : ''
      } else {
        elementToToggle.style.display =
          buttonsVisibility[key] === false ? 'none' : ''
      }

      if (key === 'speechToText') {
        const micSeparator = editorContainer.querySelector(
          '[data-id="mic-separator"]'
        )
        if (micSeparator) {
          // No Opera, sempre oculta o separador do microfone
          const shouldHide =
            buttonsVisibility[key] === false || isOperaBrowser()
          micSeparator.style.display = shouldHide ? 'none' : ''
        }
      }

      if (key === 'ai') {
        const pinnedWrapper = editorContainer.querySelector('.pinned-ai-wrapper')
        if (pinnedWrapper) {
          const pinnedAIButtons = settings.pinnedAIButtons || []
          const hasPinnedButtons = pinnedAIButtons.length > 0
          pinnedWrapper.style.display =
            (buttonsVisibility[key] === false || !hasPinnedButtons) ? 'none' : 'flex'
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
    goToTopButton.style.display = visibility.goToTop === false ? 'none' : ''
  }
  const iagenteScrollBtn = document.getElementById('iagente-scroll-btn')
  if (iagenteScrollBtn) {
    iagenteScrollBtn.style.display = visibility.iagente === false ? 'none' : ''
  }

  // Novo: visibilidade do botão "Pesquisar Resposta" clonado
  const clonedSearchButtons = document.querySelectorAll('.cloned-search-button')
  clonedSearchButtons.forEach(btn => {
    btn.style.display = visibility.searchAnswerButton === false ? 'none' : ''
  })
}

/**
 * Atualiza os rótulos dos botões de formatação em todas as toolbars abertas.
 */
async function updateAllToolbarButtonLabels() {
  const settings = await getSettings()
  const buttonLabelType = settings.uiSettings?.buttonLabelType || 'symbol'

  // Define os rótulos baseado na configuração
  const boldLabel = buttonLabelType === 'text' ? '<b>Negrito</b>' : '<b>B</b>'
  const italicLabel = buttonLabelType === 'text' ? '<i>Itálico</i>' : '<i>I</i>'
  const underlineLabel =
    buttonLabelType === 'text' ? '<u>Sublinhado</u>' : '<u>U</u>'

  // Atualiza todas as toolbars abertas
  document.querySelectorAll('.editor-container').forEach(container => {
    const boldBtn = container.querySelector('[data-action="bold"]')
    const italicBtn = container.querySelector('[data-action="italic"]')
    const underlineBtn = container.querySelector('[data-action="underline"]')

    if (boldBtn) boldBtn.innerHTML = boldLabel
    if (italicBtn) italicBtn.innerHTML = italicLabel
    if (underlineBtn) underlineBtn.innerHTML = underlineLabel
  })
}

function applyAllVisibilitySettings() {
  // Atualiza todas as barras de ferramentas
  document
    .querySelectorAll('.editor-container, .fixed-toolbar')
    .forEach(container => {
      updateToolbarButtonVisibility(container)
    })
  // Atualiza os elementos globais
  applyGlobalVisibilitySettings()
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
initializeExtension()
// ─────────────────────────────────────────────────────────────────────────────


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
    let count = firedReminders.length

    // Contagem real de avisos não lidos (array direto, sem .data)
    const data = await chrome.storage.local.get([
      'warningsLastReadTime',
      'infoDevMode',
      'cachedWarnings',
      'ignoredWarnings',
      'subscribedChannels',
      'warningChannels',
      'readWarningIds',
      'readWarnings'
    ])
    const rawWarnings = Array.isArray(data.cachedWarnings) ? data.cachedWarnings : []
    const ignoredIds = Array.isArray(data.ignoredWarnings) ? data.ignoredWarnings : []
    const readWarningIds = Array.isArray(data.readWarningIds) ? data.readWarningIds : []
    const readWarnings = Array.isArray(data.readWarnings) ? data.readWarnings : []
    const currentChannels = data.warningChannels || WARNING_CHANNELS;
    const subscribed = data.subscribedChannels ? [...data.subscribedChannels] : [...currentChannels];
 
    // Registra recebimento dos avisos no Firebase
    const currentUser = window.sgdPermissions?.currentUser;
    if (currentUser && window.warningsService?.recordWarningReceipt) {
      rawWarnings.forEach(w => {
        const wChannel = w.channel || 'Geral';
        const isAllowed = window.sgdPermissions?.allowedChannels?.includes(wChannel) ?? (window.sgdPermissions?.isEditor ? true : wChannel === 'Geral');
        if (subscribed.includes(wChannel) && isAllowed) {
          if (typeof isUserRecipient === 'function' && isUserRecipient(w, currentUser)) {
            window.warningsService.recordWarningReceipt(w.id, currentUser);
          }
        }
      });
    }
 
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const nowMs = Date.now()
    const lastReadTime = data.warningsLastReadTime || 0
 
    const nowIso = new Date().toISOString()
    const unreadWarnings = rawWarnings.filter(w => {
      if (typeof isUserRecipient === 'function' && !isUserRecipient(w, currentUser)) return false
      if (w.isTest && !data.infoDevMode && !w.onlySelf) return false
      if (ignoredIds.includes(w.id) || readWarningIds.includes(w.id) || readWarnings.includes(w.id)) return false
      const wChannel = w.channel || 'Geral';
      const isAllowed = window.sgdPermissions?.allowedChannels?.includes(wChannel) ?? (window.sgdPermissions?.isEditor ? true : wChannel === 'Geral');
      if (!subscribed.includes(wChannel) || !isAllowed) return false;
      
      if (w.archived) return false
      if (w.publishedAt && nowIso < w.publishedAt) return false
 
      if (!w.date) return false
      const wTime = new Date(w.date).getTime()
 
      let isExpired = false
      if (w.expiresAt) {
        isExpired = nowMs > new Date(w.expiresAt).getTime()
      } else {
        isExpired = nowMs - wTime >= SEVEN_DAYS_MS
      }
 
      return !isExpired && wTime > lastReadTime
    })
    const unreadCount = unreadWarnings.length
    const hasUnreadWarning = unreadCount > 0
    count += unreadCount

    if (count > 0) {
      badge.textContent = count
      badge.style.display = 'flex'
      bellIcon.classList.add('pulsing')

      // Vermelho: tem lembretes disparados | Azul: só avisos não lidos
      if (firedReminders.length > 0) {
        badge.style.backgroundColor = 'var(--action-red)'
      } else if (hasUnreadWarning) {
        // Cor baseada no tipo do aviso mais crítico
        const hasDanger = unreadWarnings.some(w => w.type === 'danger')
        const hasWarning = unreadWarnings.some(w => w.type === 'warning')
        const hasSuccess = unreadWarnings.some(w => w.type === 'success')
        if (hasDanger) badge.style.backgroundColor = 'var(--action-red)'
        else if (hasWarning) badge.style.backgroundColor = 'var(--action-yellow)'
        else if (hasSuccess) badge.style.backgroundColor = 'var(--action-green)'
        else badge.style.backgroundColor = 'var(--action-blue)'
      }
    } else {
      badge.style.display = 'none'
      bellIcon.classList.remove('pulsing')
    }
  } catch (error) {
    console.error('SGD - PowerTools: Erro ao atualizar status de notificação.', error)
  }
}

/**
 * Verifica e exibe alertas flutuantes (toasts) para avisos ativos e pendentes de visualização ou leitura.
 */
async function checkAndShowPendingWarningToasts() {
  if (typeof showSgdToast !== 'function') return;
  try {
    const data = await chrome.storage.local.get([
      'warningsLastReadTime',
      'infoDevMode',
      'cachedWarnings',
      'ignoredWarnings',
      'subscribedChannels',
      'warningChannels',
      'readWarningIds',
      'readWarnings'
    ]);

    const rawWarnings = Array.isArray(data.cachedWarnings) ? data.cachedWarnings : [];
    const ignoredIds = Array.isArray(data.ignoredWarnings) ? data.ignoredWarnings : [];
    const readWarningIds = Array.isArray(data.readWarningIds) ? data.readWarningIds : [];
    const readWarnings = Array.isArray(data.readWarnings) ? data.readWarnings : [];
    const currentChannels = data.warningChannels || WARNING_CHANNELS;
    const subscribed = data.subscribedChannels ? [...data.subscribedChannels] : [...currentChannels];

    const nowMs = Date.now();
    const nowIso = new Date().toISOString();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    for (const w of rawWarnings) {
      if (w.archived) continue;
      if (w.isTest && !data.infoDevMode && !w.onlySelf) continue;
      if (w.publishedAt && nowIso < w.publishedAt) continue;

      if (!w.date) continue;
      const wTime = new Date(w.date).getTime();

      let isExpired = false;
      if (w.expiresAt) {
        isExpired = nowMs > new Date(w.expiresAt).getTime();
      } else {
        isExpired = nowMs - wTime >= SEVEN_DAYS_MS;
      }
      if (isExpired) continue;

      const wChannel = w.channel || 'Geral';
      const isAllowed = window.sgdPermissions?.allowedChannels?.includes(wChannel) ?? (window.sgdPermissions?.isEditor ? true : wChannel === 'Geral');
      if (!subscribed.includes(wChannel) || !isAllowed) continue;

      // Valida se o usuário atual é destinatário do aviso (targetUsers / onlySelf)
      const currentUserName = window.sgdPermissions?.currentUser;
      if (typeof isUserRecipient === 'function') {
        if (!isUserRecipient(w, currentUserName)) {
          continue;
        }
      }

      // Se já foi lido ou ignorado
      if (readWarningIds.includes(w.id) || readWarnings.includes(w.id) || ignoredIds.includes(w.id)) continue;

      const requiredReading = !!w.requiredReading;
      if (requiredReading) {
        // Leitura obrigatória: exibe indefinidamente (duração 0) até interação
        showSgdToast(w.id, w.title, w.message, w.type || 'info', 0, true);
      } else {
        // Aviso comum: exibe se estiver dentro do tempo de visualização (3 minutos)
        const toastDuration = 180000; // 3 minutos
        const ageMs = nowMs - wTime;
        if (ageMs < toastDuration) {
          const remainingDuration = toastDuration - ageMs;
          showSgdToast(w.id, w.title, w.message, w.type || 'info', remainingDuration, false);
        }
      }
    }
  } catch (error) {
    console.error('SGD - PowerTools: Erro ao verificar avisos pendentes na inicialização.', error);
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
        'SGD - PowerTools: Ponto de injeção do ícone de sino não encontrado.'
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
// Inicializa canal de sincronização de avisos entre abas
const sgdChannel = new BroadcastChannel('sgd_warnings_channel');
window.sgdChannel = sgdChannel;

sgdChannel.onmessage = (event) => {
  if (event.data.action === 'CLOSE_TOAST' && event.data.id) {
    const toastEl = document.getElementById(`sgd-toast-${event.data.id}`);
    if (toastEl) {
      toastEl.style.animation = 'sgdToastOut 0.3s ease forwards';
      setTimeout(() => toastEl.remove(), SGD_TOAST_FADE_MS);
    }
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Adicionada nova condição para atualizar o badge
  if (message.action === 'UPDATE_NOTIFICATION_BADGE') {
    updateNotificationStatus()
  }

  // Exibe notificação in-page quando um lembrete dispara
  if (message.action === 'SHOW_IN_PAGE_NOTIFICATION' && message.reminder) {
    showInPageNotification(message.reminder)
  }

  if (message.action === 'SHOW_TOAST' && message.id && message.title && message.message) {
    if (message.onlySelf) {
      const currentUserName = window.sgdPermissions?.currentUser;
      if (!message.author || !currentUserName || message.author.trim().toLowerCase() !== currentUserName.trim().toLowerCase()) {
        return;
      }
    }
    showSgdToast(message.id, message.title, message.message, message.type || 'info', message.duration, message.requiredReading);
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

  // Acionado pelo Service Worker (alarme de 15min)
  if (message.action === 'TRIGGER_PENDING_CHECK') {
    console.log('Main: Recebido pedido de verificação de pendências.')
    checkNewPendings().then(async result => {
      updatePendingBadgeUI(result)

      // Se houver novas pendências, solicita notificação ao SW
      if (result.newCount > 0) {
        chrome.runtime.sendMessage({
          action: 'SHOW_GENERIC_NOTIFICATION',
          title: 'Novas Pendências no SGD',
          message: `Você tem ${result.newCount} nova(s) pendência(s). Total: ${result.total}`
        })
      }
    })
  }
})

/**
 * Função principal para inicializar todas as funcionalidades do editor.
 */
async function initializeEnhancedEditor() {
  await loadSavedTheme()
  const settings = await getSettings()
  applyUiSettings(settings)

  if (settings.preferences.dropdownBehavior === 'click') {
    document.body.classList.add('dropdown-click-mode')
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        findAndEnhanceTextareas()
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true
  })

  findAndEnhanceTextareas()
  await initializeNotesPanel()

  // Verifica se o painel de atendimentos seguidos deve ser criado
  initializeFollowedAttendancesPanel()

  checkVersionAndShowWhatsNew()
}

// --- CONTROLE DE NOVIDADES DA VERSÃO ---

/**
 * Compara a versão atual com a última vista e exibe o modal de novidades se necessário.
 */
async function checkVersionAndShowWhatsNew() {
  try {
    const currentVersion = chrome.runtime.getManifest().version // Ex: "2.9.6.1" ou "2.9.7"
    const lastSeenVersion = await getLastSeenVersion()

    const versionParts = currentVersion.split('.')
    const noteworthyVersion = versionParts.slice(0, 3).join('.') // Ex: "2.9.6" ou "2.9.7"

    // Compara a versão "notável" com a última versão "notável" vista
    if (noteworthyVersion !== lastSeenVersion) {
      // (Ex: vai procurar por '2.9.6' no RELEASE_NOTES, mesmo se a versão for '2.9.6.1')
      // buildNotesToShow (release-notes.js) já cuida do merge com MINOR_RELEASE_NOTES.
      const notesToShow = buildNotesToShow(noteworthyVersion, lastSeenVersion)
      if (notesToShow) {
        showWhatsNewModal(notesToShow)
        // Salva a versão "notável" como a última vista para evitar reexibir em subversões
        await setLastSeenVersion(noteworthyVersion)
      }
    }
  } catch (error) {
    console.error(
      'SGD - PowerTools: Erro ao verificar a versão para novidades.',
      error
    )
  }
}

// --- GESTÃO DE NOTIFICAÇÕES DE PENDÊNCIAS ---

/**
 * Inicializa a verificação de pendências e o badge.
 */
async function initializePendingBadge() {
  // Tenta carregar o último resultado salvo para exibição imediata
  const lastResult = await getLastPendingResult()
  if (lastResult) {
    updatePendingBadgeUI(lastResult)
  }

  // Verifica se precisamos fazer um fetch novo (ex: cache muito antigo)
  // Por enquanto, confiamos no polling do Service Worker, mas se não tiver cache,
  // podemos fazer um fetch inicial (com debounce/jitter se necessário, mas aqui é um por aba)
  if (!lastResult) {
    // Delay aleatório curto para evitar pico no reload de várias abas
    setTimeout(async () => {
      const result = await checkNewPendings()
      updatePendingBadgeUI(result)
    }, Math.random() * 5000)
  }
}

/**
 * Atualiza a interface do badge de pendências.
 * @param {object} result - Resultado do checkNewPendings.
 */
function updatePendingBadgeUI(result) {
  const fabBadge = document.querySelector('.fab-option-wrapper .fab-badge')
  const infoBtn = document.querySelector(
    '.fab-button[data-action="fab-info-panel"]'
  )

  if (!fabBadge || !infoBtn) return

  if (result.total > 0) {
    let badgeText = `${result.total}`
    if (result.newCount > 0) {
      badgeText += ` | ${result.newCount}`
      fabBadge.classList.add('has-new')
      infoBtn.classList.add('pulsing-alert')
    } else {
      fabBadge.classList.remove('has-new')
      infoBtn.classList.remove('pulsing-alert')
    }
    fabBadge.textContent = badgeText
    fabBadge.style.display = 'flex'
  } else {
    fabBadge.style.display = 'none'
    infoBtn.classList.remove('pulsing-alert')
  }
}

/**
 * Ação ao abrir o painel de informações: marca pendências como vistas.
 */
async function handleInfoPanelOpen() {
  const result = await getLastPendingResult()
  if (result && result.currentIds) {
    await markPendingsAsSeen(result.currentIds)
    // Atualiza a UI para remover o contador de novos
    result.newCount = 0
    result.newItems = []
    await savePendingResult(result)
    updatePendingBadgeUI(result)
  }
}

// --- FIM GESTÃO DE NOTIFICAÇÕES ---

// --- INICIALIZAÇÃO SEGURA ---

// A inicialização principal ocorre via initializeExtension() acima.
// observeForTextArea() já é chamado dentro de initializeExtension().

// Fila de limpeza automática de filtros em múltiplas guias
const tabsToClearStr = sessionStorage.getItem('tabsToClear')
const isExecutingQueue = !!tabsToClearStr

if (tabsToClearStr) {
  try {
    const tabsToClear = JSON.parse(tabsToClearStr)
    if (tabsToClear && tabsToClear.length > 0) {
      const nextUrl = tabsToClear[0]
      const currentUrl = window.location.href

      const targetFiltro = getFiltroParam(nextUrl)
      const currentFiltro = getFiltroParam(currentUrl)

      const isCorrectPage =
        currentUrl.includes('filtro-listas.html') &&
        (!targetFiltro || targetFiltro === currentFiltro)

      if (isCorrectPage) {
        // Remove esta guia da fila
        tabsToClear.shift()
        if (tabsToClear.length > 0) {
          sessionStorage.setItem('tabsToClear', JSON.stringify(tabsToClear))
        } else {
          sessionStorage.removeItem('tabsToClear')
          sessionStorage.setItem('autoOpenPendingPanel', 'true')
        }

        console.log('[SGD - PowerTools] Limpando filtros da guia ativa: ' + (currentFiltro || 'padrão'))
        setTimeout(() => {
          if (typeof resetSiteFilter === 'function') {
            resetSiteFilter().catch(err =>
              console.error('Erro ao resetar filtros automaticamente:', err)
            )
          }
        }, 600)
      } else {
        console.log('[SGD - PowerTools] Redirecionando para a guia na fila de limpeza: ' + (targetFiltro || 'padrão'))
        window.location.href = nextUrl
      }
    }
  } catch (e) {
    console.error('[SGD - PowerTools] Erro ao processar fila de limpeza de filtros:', e)
    sessionStorage.removeItem('tabsToClear')
  }
}

// Reabertura automática do painel de informações após conclusão da limpeza
if (sessionStorage.getItem('autoOpenPendingPanel') === 'true' && !isExecutingQueue) {
  sessionStorage.removeItem('autoOpenPendingPanel')
  setTimeout(() => {
    if (typeof openInfoPanel === 'function') {
      console.log('[SGD - PowerTools] Reabrindo Painel de Pendências após limpeza de filtros...')
      openInfoPanel('pending').catch(err =>
        console.error('Erro ao reabrir painel de pendências:', err)
      )
    }
  }, 500)
}
