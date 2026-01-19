/**
 * @file features.js
 * Implementação de funcionalidades específicas: Atalhos, Inserções Especiais, Importação/Exportação e Recursos de IA
 */

/**
 * Helper para obter o conteúdo do editor (sempre do textarea, que é a fonte da verdade)
 */
function getEditorContent(textArea) {
  return textArea.value
}

/**
 * Verifica se a funcionalidade de inserção de nome de usuário está disponível na página.
 * @returns {boolean} Retorna true se o seletor de usuário existe.
 */
function isUserNameInsertionAvailable() {
  const userSelectElement = document.getElementById(USER_NAME_SELECT_ID)
  const userLoggedElement = document.getElementById(USER_NAME_LOGGED_ID)

  // Debug: Log dos elementos encontrados
  console.log(
    'Editor SGD: Debug username elements - USER_NAME_SELECT_ID:',
    USER_NAME_SELECT_ID,
    'found:',
    !!userSelectElement
  )
  console.log(
    'Editor SGD: Debug username elements - USER_NAME_LOGGED_ID:',
    USER_NAME_LOGGED_ID,
    'found:',
    !!userLoggedElement
  )

  // Tenta encontrar elementos alternativos se os principais não existirem
  let alternativeFound = false
  if (!userSelectElement && !userLoggedElement) {
    // Procura por elementos que possam conter o nome do usuário
    const possibleSelectors = [
      'select[name*="usuario"]',
      'select[id*="usuario"]',
      'td:contains("usuario")',
      '[id*="usuario_nome"]',
      '[name*="usuario_nome"]'
    ]

    for (const selector of possibleSelectors) {
      try {
        const element = document.querySelector(selector)
        if (element) {
          console.log(
            'Editor SGD: Elemento alternativo encontrado:',
            selector,
            element
          )
          alternativeFound = true
          break
        }
      } catch (e) {
        // Ignora seletores inválidos
      }
    }
  }

  // Retorna true se pelo menos um dos elementos existe ou se encontrou alternativa
  return !!(userSelectElement || userLoggedElement || alternativeFound)
}

/**
 * Calcula o próximo número principal (1., 2., 3.) baseado no conteúdo existente.
 * Analisa o HTML para encontrar a maior numeração usada até o momento.
 */
function calculateNextMainNumber(content) {
  // Regex para encontrar <b>X. </b> onde X é um número. (Flags 'gim': global, case-insensitive, multiline)
  const regex = /<b>(\d+)\.\s*<\/b>/gim
  // Extrai todos os matches
  const matches = [...content.matchAll(regex)]

  if (matches.length === 0) {
    return 1 // Começa em 1 se não houver listas.
  }

  // Encontra o maior número usado até agora
  let maxNum = 0
  matches.forEach(match => {
    const num = parseInt(match[1], 10)
    if (!isNaN(num) && num > maxNum) {
      maxNum = num
    }
  })

  return maxNum + 1
}

function getNextMainNumber(textArea) {
  const content = getEditorContent(textArea)
  return calculateNextMainNumber(content)
}

/**
 * Calcula a próxima letra (A., B., C.) baseado no conteúdo existente.
 */
function calculateNextLetter(content) {
  // Regex para encontrar <b>X. </b> onde X é uma letra.
  const regex = /<b>([A-Z])\.\s*<\/b>/gim
  const matches = [...content.matchAll(regex)]

  if (matches.length === 0) {
    return 'A'
  }

  // Encontra a letra mais alta usada até agora (A=65, Z=90)
  let maxCharCode = 0
  matches.forEach(match => {
    const charCode = match[1].toUpperCase().charCodeAt(0)
    if (charCode > maxCharCode) {
      maxCharCode = charCode
    }
  })

  // Verifica overflow (depois de Z)
  if (maxCharCode >= 90) {
    // Implementação simples: para em Z se já estiver no limite.
    // Para suportar AA, AB, etc., a regex e a lógica precisariam ser mais complexas.
    return 'Z'
  }

  return String.fromCharCode(maxCharCode + 1)
}

function getNextLetter(textArea) {
  const content = getEditorContent(textArea)
  return calculateNextLetter(content)
}

/**
 * Calcula o próximo sub-número (ex: 1.1., 1.2., 2.1.) baseado no contexto do último item de lista principal inserido no texto.
 */
function calculateNextSubNumber(content) {
  // 1. Encontra o último item relevante (principal ou sub) para determinar o contexto principal.
  // Regex que captura o número principal do último item inserido, independentemente de ter sub-número ou não.
  // Ex: Captura '1' de '<b>1. </b>' ou '1' de '<b>1.2. </b>'.
  const lastItemRegex = /<b>(\d+)(?:\.\d+)?\.\s*<\/b>/gim

  const matches = [...content.matchAll(lastItemRegex)]

  if (matches.length === 0) {
    // Nenhuma lista numérica encontrada, começa em 1.1
    return { main: 1, sub: 1 }
  }

  // Pega o número principal do último match encontrado no texto.
  const lastMatch = matches[matches.length - 1]
  const mainNum = parseInt(lastMatch[1], 10)

  if (isNaN(mainNum)) return { main: 1, sub: 1 } // Fallback de segurança

  // 2. Agora, encontramos o maior sub-número especificamente para este mainNum
  // Criamos uma regex dinâmica para procurar por <b>mainNum.X. </b>
  const specificSubRegex = new RegExp(
    `<b>${mainNum}\\.(\\d+)\\.\\s*<\\/b>`,
    'gim'
  )
  const subMatches = [...content.matchAll(specificSubRegex)]

  if (subMatches.length === 0) {
    // O número principal existe (ou foi o último usado), mas ainda não tem sub-itens. Começa em X.1.
    return { main: mainNum, sub: 1 }
  }

  // Calcula o maior sub-número encontrado para esse número principal.
  let maxSub = 0
  subMatches.forEach(match => {
    const subNum = parseInt(match[1], 10)
    if (!isNaN(subNum) && subNum > maxSub) {
      maxSub = subNum
    }
  })

  return { main: mainNum, sub: maxSub + 1 }
}

function getNextSubNumber(textArea) {
  const content = getEditorContent(textArea)
  return calculateNextSubNumber(content)
}

/**
 * Aplica formatação de lista a uma seleção de múltiplas linhas.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo.
 * @param {'numbered'|'sub-numbered'|'lettered'} listType - O tipo de lista.
 */
function applyListFormattingToSelection(textArea, listType) {
  const { selectionStart, selectionEnd, value, scrollTop } = textArea
  const selectedText = value.substring(selectionStart, selectionEnd)
  const lines = selectedText.split('\n')

  const contentBefore = value.substring(0, selectionStart)
  let formattedLines = []

  switch (listType) {
    case 'numbered': {
      let currentNumber = calculateNextMainNumber(contentBefore)
      formattedLines = lines.map(line => {
        if (line.trim() !== '') {
          return `<b>${currentNumber++}. </b>${line}`
        }
        return line
      })
      break
    }
    case 'lettered': {
      let currentLetterCode = calculateNextLetter(contentBefore).charCodeAt(0)
      formattedLines = lines.map(line => {
        if (line.trim() !== '') {
          const letter = String.fromCharCode(currentLetterCode)
          // Avança para a próxima letra, parando em 'Z'
          if (currentLetterCode < 90) {
            currentLetterCode++
          }
          return `<b>${letter}. </b>${line}`
        }
        return line
      })
      break
    }
    case 'sub-numbered': {
      let { main, sub } = calculateNextSubNumber(contentBefore)
      formattedLines = lines.map(line => {
        if (line.trim() !== '') {
          return `<b>${main}.${sub++}. </b>${line}`
        }
        return line
      })
      break
    }
  }

  const newText = formattedLines.join('\n')

  // Substitui o texto e atualiza o estado do editor
  textArea.value =
    value.substring(0, selectionStart) + newText + value.substring(selectionEnd)

  textArea.setSelectionRange(selectionStart, selectionStart + newText.length)
  textArea.scrollTop = scrollTop
  textArea.dispatchEvent(new Event('input', { bubbles: true }))
  focusEditor(textArea)
}

/**
 * Insere um item de lista com prefixo de nova linha.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo.
 * @param {string} itemText - O texto do item da lista (ex: '1. ').
 */
function insertListItem(textArea, itemText) {
  insertAtCursor(textArea, itemText, { prefixNewLine: true })
}

/**
 * Insere um marcador (&bull;) sem quebra de linha.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo.
 */
function insertBullet(textArea) {
  insertAtCursor(textArea, '&bull; ')
}

/**
 * Insere o nome do usuário logado ou selecionado no formulário (Específico do SGD).
 * Utiliza constantes de config.js.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo.
 */
function insertUserName(textArea) {
  const getFirstName = element => {
    if (element && element.textContent) {
      const fullName = element.textContent.trim()
      return fullName.split(' ')[0]
    }
    return null
  }

  const userSelectElement = document.getElementById(USER_NAME_SELECT_ID)
  let firstName = ''

  if (userSelectElement) {
    if (userSelectElement.value === '-3') {
      // "Não cadastrado" → usa o nome digitado no input
      const typedInput = document.getElementById(
        typeof USER_NAME_INPUT_ID !== 'undefined' ? USER_NAME_INPUT_ID : 'cadSscForm:nome'
      )
      const typedValue = typedInput ? typedInput.value.trim() : ''
      if (typedValue) {
        firstName = typedValue.split(' ')[0]
      }
    } else if (parseInt(userSelectElement.value, 10) > 0) {
      const selectedOption =
        userSelectElement.options[userSelectElement.selectedIndex]
      firstName = getFirstName(selectedOption)
    }
  }

  if (!firstName) {
    const userNameElement = document.getElementById(USER_NAME_LOGGED_ID)
    firstName = getFirstName(userNameElement)
  }

  if (firstName) {
    const capitalizedName =
      firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
    insertAtCursor(textArea, capitalizedName)
  } else {
    showNotification('Nome de usuário não encontrado.', 'error')
  }
}

/**
 * Abre o modal para inserir um hiperlink.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo.
 */
function openLinkModal(textArea, options = {}) {
  const { hideButtonOption = false, zIndex = null } = options;

  // Tenta obter o texto selecionado do editor ativo.
  let selectedText = ''

  selectedText = textArea.value.substring(
    textArea.selectionStart,
    textArea.selectionEnd
  )

  const modal = createModal(
    'Inserir Hiperlink',
    `<div class="form-group">
        <label for="modal-url-input">URL</label>
        <input type="text" id="modal-url-input" placeholder="https://exemplo.com">
     </div>
     <div class="form-group">
        <label for="modal-text-input">Texto a ser exibido</label>
        <input type="text" id="modal-text-input" placeholder="Texto a ser exibido" value="${escapeHTML(
          selectedText
        )}">
     </div>
     ${!hideButtonOption ? `
     <div class="link-as-button-container">
        <input type="checkbox" id="modal-link-as-button">
        <label for="modal-link-as-button">Inserir como botão</label>
     </div>` : ''}`,
    (modalContent, closeModal) => {
      let urlInput = modalContent.querySelector('#modal-url-input').value.trim()
      const text = modalContent.querySelector('#modal-text-input').value.trim()
      const asButton = modalContent.querySelector('#modal-link-as-button')?.checked || false

      if (!urlInput) {
        showNotification('A URL é obrigatória.', 'error')
        return
      }

      if (!isValidUrl(urlInput)) {
        showNotification(
          'URL inválida ou insegura. Use http, https ou mailto.',
          'error'
        )
        return
      }

      let finalUrl = urlInput
      if (
        !/^[a-zA-Z]+:\/\//.test(finalUrl) &&
        !finalUrl.startsWith('mailto:')
      ) {
        finalUrl = 'https://' + finalUrl
      }

      const linkText = text || finalUrl
      const sanitizedText = escapeHTML(linkText)
      const sanitizedUrl = escapeHTML(finalUrl)

      let linkHtml

      if (asButton) {
        const buttonStyle =
          'display: inline-block; background-color: #fa6400; border-radius: 5px; padding: 4px 8px; color: #ffffff; text-decoration: none; border: none; font-size: 14px; font-family: sans-serif; margin: 2px 0;'
        linkHtml = `<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer" style="${buttonStyle}">${sanitizedText}</a>`
      } else {
        linkHtml = `<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer" style="color: rgb(255, 128, 0);"><b>${sanitizedText} </b><img alt="Link" src="https://sgd.dominiosistemas.com.br/ckfiles/images/ui-expressive-55x55-15(7).png" style="width: 25px; height: 25px; vertical-align: middle;"></a>`
      }

      insertAtCursor(textArea, linkHtml)
      closeModal()
    }
  )

  if (zIndex) {
    modal.style.zIndex = zIndex;
  }

  document.body.appendChild(modal)
}

// --- LÓGICA DE IA (Integração com ai-service.js) ---

/**
 * Função auxiliar para lidar com erros de IA e exibir notificações.
 */
function handleAIError(error) {
  console.error('Erro na operação de IA:', error)
  let message = error.message || 'Ocorreu um erro inesperado na IA.'
  // Adiciona contexto se for erro de chave de API
  if (message.includes('API key') || message.includes('Chave de API')) {
    message += ' Verifique suas configurações (⚙️).'
  }
  showNotification(message, 'error', 5000)
}

/**
 * Manipula a ação de correção de texto via IA.
 */
async function handleAICorrection(textArea) {
  const originalText = getEditorContent(textArea)
  if (!originalText.trim()) {
    showNotification('Nenhum texto para corrigir.', 'info')
    return
  }

  try {
    const apiKey = await getGeminiApiKey()
    // correctText definido em ai-service.js
    const correctedText = await correctText(apiKey, originalText)

    if (correctedText && correctedText.trim() !== originalText.trim()) {
      // Substitui o conteúdo inteiro
      textArea.value = correctedText
      textArea.dispatchEvent(new Event('input', { bubbles: true }))
      showNotification('Texto corrigido com sucesso!', 'success')
    } else if (correctedText) {
      showNotification('Nenhuma correção necessária ou encontrada.', 'info')
    }
  } catch (error) {
    handleAIError(error)
  }
}

/**
 * Abre o modal para geração de texto a partir de tópicos.
 */
function openAIGenerationModal(textArea) {
  const modal = createModal(
    '💡 Gerar Texto por Tópicos (IA)',
    `<div class="form-group">
            <label for="modal-ai-topics">Tópicos ou Palavras-chave</label>
            <textarea id="modal-ai-topics" placeholder="Ex: Cliente ligou, problema no acesso, senha resetada, aguardando confirmação." style="min-height: 120px;"></textarea>
         </div>
         <p style="font-size: 12px; color: var(--text-color-muted);">Descreva os pontos principais que devem constar no texto final.</p>
        `,
    async (modalContent, closeModal) => {
      const topics = modalContent.querySelector('#modal-ai-topics').value.trim()

      if (!topics) {
        showNotification('Por favor, insira os tópicos para geração.', 'error')
        return
      }

      // Feedback de carregamento no botão Salvar do modal
      const saveBtn = modalContent
        .closest('.se-modal-content')
        .querySelector('#modal-save-btn')
      saveBtn.disabled = true
      saveBtn.classList.add('ai-loading')
      saveBtn.textContent = 'Gerando... ✨'

      try {
        const apiKey = await getGeminiApiKey()
        // generateFromTopics definido em ai-service.js
        const generatedText = await generateFromTopics(apiKey, topics)

        if (generatedText) {
          insertAtCursor(textArea, generatedText, { prefixNewLine: true })
          showNotification('Texto gerado com sucesso!', 'success')
          closeModal()
        }
      } catch (error) {
        handleAIError(error)
      } finally {
        // Restaura o botão caso o modal não tenha sido fechado (ex: erro)
        if (saveBtn) {
          saveBtn.disabled = false
          saveBtn.classList.remove('ai-loading')
          saveBtn.textContent = 'Gerar e Inserir'
        }
      }
    }
  )

  const saveBtn = modal.querySelector('#modal-save-btn')
  if (saveBtn) saveBtn.textContent = 'Gerar e Inserir'

  document.body.appendChild(modal)
  modal.querySelector('#modal-ai-topics').focus()
}

/**
 * Manipula a ação de resumir a solicitação de suporte via IA.
 */
async function handleAISummary(textArea) {
  const { rawContent, relevantData } = extractPageContentForAI()

  if (!rawContent || rawContent.length < 50) {
    showNotification(
      'Não foi possível encontrar conteúdo suficiente na página para resumir.',
      'info'
    )
    return
  }

  try {
    const apiKey = await getGeminiApiKey()
    const rawApiResponse = await summarizeSupportRequest(apiKey, rawContent)

    if (rawApiResponse) {
      // Processa a resposta da IA com 2 seções
      const sections = rawApiResponse.split('---')
      const summaryText = (sections[0] || '').replace('[RESUMO]', '').trim()
      const nextActionText = (sections[1] || '')
        .replace('[PRÓXIMA AÇÃO]', '')
        .trim()

      // Chama o modal com os novos dados
      showSummaryModal(
        summaryText,
        nextActionText,
        relevantData,
        contentToInsert => {
          const formattedContent = `${contentToInsert.replace(
            /\n/g,
            '<br>'
          )}<br><br>--<br><br>`
          insertAtCursor(textArea, formattedContent, { prefixNewLine: true })
          showNotification('Resumo inserido com sucesso!', 'success')
        }
      )
    }
  } catch (error) {
    handleAIError(error)
  }
}

/**
 * Manipula a ação de completar o rascunho via IA (Co-piloto).
 */
async function handleAICompleteDraft(textArea) {
  const currentDraft = getEditorContent(textArea)
  if (!currentDraft.trim()) {
    showNotification(
      'Digite um rascunho ou algumas ideias antes de usar o co-piloto.',
      'info'
    )
    return
  }

  const requestContent = extractPageContentForAI()

  try {
    const apiKey = await getGeminiApiKey()
    // completeDraft definido em ai-service.js
    const completedText = await completeDraft(
      apiKey,
      requestContent,
      currentDraft
    )

    if (completedText) {
      // Substitui o conteúdo inteiro
      textArea.value = completedText
      textArea.dispatchEvent(new Event('input', { bubbles: true }))
      showNotification('Rascunho completado com sucesso!', 'success')
    }
  } catch (error) {
    handleAIError(error)
  }
}

// --- LÓGICA DE ATALHOS (Posição Fixa, Navegação por Teclado e Filtro) ---

/**
 * Listener global para detectar atalhos de categoria.
 * @param {KeyboardEvent} e - O evento de teclado.
 */
async function handleShortcutListener(e) {
  // Não ativa se qualquer modal estiver aberto.
  if (document.querySelector('.editor-modal')) return

  // Não aciona se o popup já estiver aberto (o listener do popup tem prioridade).
  if (document.getElementById('shortcut-popup')) return

  const activeElement = document.activeElement
  const textArea = getTargetTextArea()
  
  // Verifica se há um editor básico ativo (variável global do main.js)
  const basicEditor = typeof activeBasicEditor !== 'undefined' ? activeBasicEditor : null

  // Verifica se o foco está no textarea principal OU no editor básico OU no editor WYSIWYG principal.
  let isActive = false
  let targetTextArea = null
  
  if (textArea && activeElement === textArea) {
    isActive = true
    targetTextArea = textArea
  } else if (basicEditor && activeElement === basicEditor) {
    // Editor básico está ativo
    isActive = true
    targetTextArea = basicEditor
  } else {
    // Nota: O suporte a WYSIWYG foi removido nas versões anteriores, mas mantemos a checagem para compatibilidade futura se for reintroduzido.
    const mainWysiwygContent = document.querySelector(
      '#wysiwyg-container-main .wysiwyg-content'
    )
    if (activeElement === mainWysiwygContent) {
      isActive = true
      targetTextArea = textArea
    }
  }

  // Só dispara se o foco estiver no editor principal ou básico.
  if (!isActive || !targetTextArea) return

  const mainKey = e.key.toLowerCase()

  // Evita conflito com os atalhos de formatação já tratados no listener do editor (main.js).
  // Esta checagem é necessária para evitar que o popup abra ao tentar usar Ctrl+B, etc.
  if (
    (e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      ['b', 'i', 'u', 'm'].includes(mainKey)) ||
    (e.ctrlKey && e.altKey && !e.shiftKey && ['h', 'v'].includes(mainKey)) ||
    (!e.ctrlKey && e.altKey && e.shiftKey && e.key === 'U')
  ) {
    return
  }

  // Constrói a string de combinação (ex: alt+ctrl+1)
  const modifiers = []
  if (e.ctrlKey) modifiers.push('ctrl')
  if (e.altKey) modifiers.push('alt')
  if (e.shiftKey) modifiers.push('shift')

  // Ignora teclas modificadoras pressionadas sozinhas.
  if (['control', 'alt', 'shift', 'meta'].includes(mainKey)) return
  // Requer pelo menos um modificador.
  if (modifiers.length === 0) return

  modifiers.sort()
  const combinationString = [...modifiers, mainKey].join('+')

  // --- LÓGICA DE DESPACHO DE ATALHOS ---

  // 1. Prioridade 1: Atalhos de Inserção Direta (Saudações e Encerramentos)
  const greetingsData = await getGreetingsAndClosings()
  const allItems = [...greetingsData.greetings, ...greetingsData.closings]
  const directInsertItem = allItems.find(
    item => item.shortcut === combinationString
  )

  if (directInsertItem) {
    e.preventDefault()
    e.stopPropagation()
    const resolvedContent = await resolveVariablesInText(
      directInsertItem.content
    )
    insertAtCursor(targetTextArea, resolvedContent, { prefixNewLine: true })
    return // Atalho processado, encerra a função.
  }

  // 2. Prioridade 2: Atalhos de Categoria (Trâmites Rápidos)
  const data = await getStoredData()
  const category = data.categories.find(c => c.shortcut === combinationString)

  if (category) {
    e.preventDefault()
    e.stopPropagation()
    // Garante que as mensagens estejam ordenadas corretamente ao exibir o popup.
    const messages = data.messages
      .filter(m => m.categoryId === category.id)
      .sort((a, b) => a.order - b.order)

    showShortcutPopup(targetTextArea, messages)
    return // Atalho processado, encerra a função.
  }
}

/**
 * Exibe o popup de atalhos com navegação por teclado e filtro.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo para inserção.
 * @param {Array<object>} messages - As mensagens da categoria acionada.
 */
function showShortcutPopup(textArea, messages) {
  // Remove popup anterior se existir (garantia).
  document.getElementById('shortcut-popup')?.remove()
  if (messages.length === 0) return

  // Verifica se é o editor principal ou o editor básico
  const editorContainer = document.getElementById('editor-container-main')
  const isBasicEditor = !textArea.closest('.editor-master-container')
  
  // Se for editor básico e não houver container principal, adiciona ao body
  const targetContainer = isBasicEditor && !editorContainer ? document.body : (editorContainer || document.body)

  const popup = document.createElement('div')
  popup.id = 'shortcut-popup'
  applyCurrentTheme(popup)
  targetContainer.appendChild(popup)

  // Estrutura do popup
  popup.innerHTML = `
      <div id="shortcut-filter-display">Filtro: <span class="filter-text"></span></div>
      <div id="shortcut-items-container"></div>
  `

  const itemsContainer = popup.querySelector('#shortcut-items-container')
  const filterDisplay = popup.querySelector(
    '#shortcut-filter-display .filter-text'
  )

  // Estado do popup
  let filterString = ''
  let filteredMessages = [...messages] // Cópia da lista original
  let activeIndex = 0

  // --- Funções de Renderização e Navegação ---

  const getItems = () =>
    itemsContainer.querySelectorAll('.shortcut-item:not(.no-results)')

  const ensureVisible = index => {
    const items = getItems()
    if (items[index]) {
      items[index].scrollIntoView({ block: 'nearest' })
    }
  }

  const renderItems = () => {
    itemsContainer.innerHTML = ''

    if (filteredMessages.length === 0) {
      itemsContainer.innerHTML = `<div class="shortcut-item no-results">Nenhum resultado encontrado</div>`
      activeIndex = 0
      return
    }

    const fragment = document.createDocumentFragment()
    filteredMessages.forEach((m, index) => {
      const item = document.createElement('div')
      item.className = `shortcut-item ${index === 0 ? 'active-item' : ''}`
      item.dataset.messageId = m.id
      item.dataset.index = index
      item.textContent = m.title
      fragment.appendChild(item)
    })
    itemsContainer.appendChild(fragment)

    activeIndex = 0
    ensureVisible(0)
  }

  const updateFilter = newFilter => {
    filterString = newFilter
    filterDisplay.textContent = filterString || '(Digite para filtrar)'

    if (filterString) {
      filteredMessages = messages.filter(m =>
        m.title.toLowerCase().includes(filterString.toLowerCase())
      )
    } else {
      filteredMessages = [...messages]
    }
    renderItems()
  }

  const selectItem = async index => {
    if (filteredMessages.length === 0 || !filteredMessages[index]) return

    const message = filteredMessages[index]
    if (message) {
      const resolvedContent = await resolveVariablesInText(message.message)
      insertAtCursor(textArea, resolvedContent)
    }

    if (targetContainer.contains(popup) || isBasicEditor) {
      popup.remove()
    }
  }

  const navigatePopup = async e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()

      const items = getItems()
      const numItems = filteredMessages.length

      if (numItems === 0 && e.key !== 'Escape') return

      switch (e.key) {
        case 'ArrowDown':
          if (items[activeIndex])
            items[activeIndex].classList.remove('active-item')
          activeIndex = (activeIndex + 1) % numItems
          if (items[activeIndex])
            items[activeIndex].classList.add('active-item')
          ensureVisible(activeIndex)
          break
        case 'ArrowUp':
          if (items[activeIndex])
            items[activeIndex].classList.remove('active-item')
          activeIndex = (activeIndex - 1 + numItems) % numItems
          if (items[activeIndex])
            items[activeIndex].classList.add('active-item')
          ensureVisible(activeIndex)
          break
        case 'Enter':
          await selectItem(activeIndex)
          break
        case 'Escape':
          if (targetContainer.contains(popup) || isBasicEditor) {
            popup.remove()
          }
          break
      }
      return
    }

    if (e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      if (filterString.length > 0) {
        updateFilter(filterString.slice(0, -1))
      }
      return
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      updateFilter(filterString + e.key)
    }
  }

  // --- Inicialização do Popup ---

  updateFilter('')

  // Posicionamento do popup
  if (isBasicEditor) {
    // Para editor básico: centraliza na tela
    popup.style.position = 'fixed'
    popup.style.top = '50%'
    popup.style.left = '50%'
    popup.style.transform = 'translate(-50%, -50%)'
    popup.style.zIndex = '10000'
  } else {
    // Para editor principal: abaixo da toolbar
    const toolbar = targetContainer.querySelector('.editor-toolbar')
    if (toolbar) {
      popup.style.top = `${toolbar.offsetHeight + 8}px`
      popup.style.left = `50%`
      popup.style.transform = 'translateX(-50%)'
    } else {
      popup.style.top = '10px'
      popup.style.left = '10px'
    }
  }

  const clickOutsideHandler = e => {
    if (!popup.contains(e.target)) {
      if (targetContainer.contains(popup) || isBasicEditor) {
        popup.remove()
      }
    }
  }

  document.addEventListener('keydown', navigatePopup, true)

  // O listener é adicionado no próximo ciclo de eventos para evitar capturar o mesmo clique que abriu o popup.
  requestAnimationFrame(() => {
    document.addEventListener('click', clickOutsideHandler, true)
  })

  const observer = new MutationObserver((mutationsList, observer) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        mutation.removedNodes.forEach(node => {
          if (node === popup) {
            document.removeEventListener('keydown', navigatePopup, true)
            document.removeEventListener('click', clickOutsideHandler, true)
            observer.disconnect()
            focusEditor(textArea)
          }
        })
      }
    }
  })

  observer.observe(editorContainer, { childList: true })

  itemsContainer.addEventListener('click', async event => {
    const item = event.target.closest('.shortcut-item')
    if (item && !item.classList.contains('no-results') && item.dataset.index) {
      const index = parseInt(item.dataset.index)
      await selectItem(index)
    }
  })
}

/**
 * Inicia o processo de importação de trâmites a partir de um arquivo JSON.
 * @param {File} file - O arquivo JSON selecionado pelo usuário.
 * @param {Function} onCompleteCallback - Função a ser chamada após a conclusão.
 */
function importQuickMessages(file, onCompleteCallback) {
  const reader = new FileReader()
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result)

      if (
        !data ||
        !Array.isArray(data.categories) ||
        !Array.isArray(data.messages)
      ) {
        throw new Error(
          'O arquivo não parece ser um backup válido da extensão.'
        )
      }

      const migratedData = await runDataMigration(data)

      await openImportSelectionModal(migratedData, onCompleteCallback)
    } catch (error) {
      console.error('Erro ao importar arquivo:', error)
      showNotification(`Erro ao importar: ${error.message}`, 'error')
    }
  }
  reader.onerror = () => {
    showNotification('Não foi possível ler o arquivo selecionado.', 'error')
  }
  reader.readAsText(file)
}

/**
 * Exporta os trâmites selecionados no modal de gerenciamento para um arquivo JSON.
 * @param {HTMLElement} modal - O elemento do modal de gerenciamento.
 */
async function exportQuickMessages(modal) {
  const selectedMessageIds = Array.from(
    modal.querySelectorAll('.export-item-checkbox:checked')
  ).map(cb => cb.dataset.messageId)

  if (selectedMessageIds.length === 0) {
    showNotification('Nenhum trâmite selecionado para exportar.', 'info')
    return
  }

  const data = await getStoredData()
  const categoriesToExport = new Map()
  const messagesToExport = []

  data.messages.forEach(msg => {
    if (selectedMessageIds.includes(msg.id)) {
      messagesToExport.push(msg)
      if (!categoriesToExport.has(msg.categoryId)) {
        const category = data.categories.find(c => c.id === msg.categoryId)
        if (category) {
          categoriesToExport.set(category.id, category)
        }
      }
    }
  })

  const exportData = {
    version: DATA_VERSION,
    categories: Array.from(categoriesToExport.values()),
    messages: messagesToExport
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `backup_tramites_sgd_${new Date()
    .toISOString()
    .slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  showNotification(
    `${messagesToExport.length} trâmite(s) exportado(s) com sucesso!`,
    'success'
  )
}
