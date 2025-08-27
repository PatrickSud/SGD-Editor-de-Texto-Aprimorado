/**
 * @file features.js
 * @description Implementação de funcionalidades específicas: Atalhos (com filtro), Inserções Especiais (Nome, Links, Listas Dinâmicas), Importação/Exportação e Recursos de IA.
 */

// --- FUNÇÕES AUXILIARES DE INSERÇÃO E LISTAS (Dinâmicas) ---

/**
 * Helper para obter o conteúdo do editor (sempre do textarea, que é a fonte da verdade).
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 * @returns {string} O conteúdo HTML do editor.
 */
function getEditorContent(textArea) {
  return textArea.value
}

/**
 * Calcula o próximo número principal (1., 2., 3.) baseado no conteúdo existente.
 * Analisa o HTML para encontrar a maior numeração usada até o momento.
 */
function getNextMainNumber(textArea) {
  const content = getEditorContent(textArea)
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

/**
 * Calcula a próxima letra (A., B., C.) baseado no conteúdo existente.
 */
function getNextLetter(textArea) {
  const content = getEditorContent(textArea)
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

/**
 * Calcula o próximo sub-número (ex: 1.1., 1.2., 2.1.) baseado no contexto do último item de lista principal inserido no texto.
 */
function getNextSubNumber(textArea) {
  const content = getEditorContent(textArea)

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
  // --- LÓGICA: Prioridade para o <select> da tela de cadastro ---
  const userSelectElement = document.getElementById(USER_NAME_SELECT_ID)
  let firstName = ''

  // Verifica se o elemento de seleção existe e se um usuário válido foi escolhido (value > 0 no SGD)
  if (userSelectElement && userSelectElement.value > 0) {
    const selectedOption =
      userSelectElement.options[userSelectElement.selectedIndex]

    if (selectedOption && selectedOption.textContent) {
      const fullName = selectedOption.textContent.trim()
      firstName = fullName.split(' ')[0]
    }
  }

  // --- LÓGICA ORIGINAL (FALLBACK): Se não encontrou na lista, busca o nome do usuário logado ---
  if (!firstName) {
    const userNameElement = document.getElementById(USER_NAME_LOGGED_ID)
    if (userNameElement && userNameElement.textContent) {
      const fullName = userNameElement.textContent.trim()
      firstName = fullName.split(' ')[0]
    }
  }

  if (firstName) {
    // Capitaliza o nome (Primeira letra maiúscula, resto minúscula)
    firstName =
      firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
    // insertAtCursor lida com a inserção correta (WYSIWYG ou Textarea).
    insertAtCursor(textArea, firstName)
  } else {
    console.warn(
      'Editor SGD: Elemento com nome de usuário não encontrado em nenhuma das fontes.'
    )
  }
}

/**
 * Abre o modal para inserir um hiperlink.
 * @param {HTMLTextAreaElement} textArea - O textarea alvo.
 */
function openLinkModal(textArea) {
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
     <div class="link-as-button-container">
        <input type="checkbox" id="modal-link-as-button">
        <label for="modal-link-as-button">Inserir como botão</label>
     </div>`,
    (modalContent, closeModal) => {
      let urlInput = modalContent.querySelector('#modal-url-input').value.trim()
      const text = modalContent.querySelector('#modal-text-input').value.trim()
      const asButton = modalContent.querySelector(
        '#modal-link-as-button'
      ).checked

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

      // --- LÓGICA DE GERAÇÃO DO LINK ATUALIZADA ---
      if (asButton) {
        // Gera um link <a> estilizado como botão inline (Estilo padrão SGD).
        const buttonStyle = [
          'display: inline-block',
          'background-color: #fa6400', // Cor padrão SGD
          'border-radius: 5px',
          'padding: 4px 8px',
          'color: #ffffff',
          'text-decoration: none',
          'border: none',
          'font-size: 14px',
          'font-family: sans-serif',
          'margin: 2px 0'
        ].join('; ')

        linkHtml = `<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer" style="${buttonStyle}">${sanitizedText}</a>`
      } else {
        linkHtml = `<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer" style="color: rgb(255, 128, 0);"><b>${sanitizedText} </b><img alt="Link" src="https://sgd.dominiosistemas.com.br/ckfiles/images/ui-expressive-55x55-15(7).png" style="width: 25px; height: 25px; vertical-align: middle;"></a>`
      }

      insertAtCursor(textArea, linkHtml)
      closeModal()
    }
  )
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
  // Extrai o conteúdo usando a função utilitária (definida em utils.js)
  const requestContent = extractPageContentForAI()

  if (!requestContent.trim() || requestContent.length < 50) {
    showNotification(
      'Não foi possível encontrar conteúdo suficiente na página para resumir.',
      'info'
    )
    return
  }

  try {
    const apiKey = await getGeminiApiKey()
    // summarizeSupportRequest definido em ai-service.js
    const summaryText = await summarizeSupportRequest(apiKey, requestContent)

    if (summaryText) {
      // Formata o resumo antes de inserir (convertendo \n para <br> para o editor HTML)
      const formattedSummary = `<b>Resumo da Solicitação (Gerado por IA):</b><br>${summaryText.replace(
        /\n/g,
        '<br>'
      )}<br><br>--<br><br>`
      insertAtCursor(textArea, formattedSummary, { prefixNewLine: true })
      showNotification('Resumo gerado com sucesso!', 'success')
    }
  } catch (error) {
    handleAIError(error)
  }
}

// --- LÓGICA DE ATALHOS (Posição Fixa, Navegação por Teclado e Filtro Inteligente) ---

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

  if (!textArea) return

  // Verifica se o foco está no textarea principal OU no editor WYSIWYG principal.
  let isActive = false
  if (activeElement === textArea) {
    isActive = true
  } else {
    // Nota: O suporte a WYSIWYG foi removido nas versões anteriores, mas mantemos a checagem para compatibilidade futura se for reintroduzido.
    const mainWysiwygContent = document.querySelector(
      '#wysiwyg-container-main .wysiwyg-content'
    )
    if (activeElement === mainWysiwygContent) {
      isActive = true
    }
  }

  // Só dispara se o foco estiver no editor principal.
  if (!isActive) return

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

  // Verifica se a combinação corresponde a um atalho de categoria.
  const data = await getStoredData()
  const category = data.categories.find(c => c.shortcut === combinationString)

  if (category) {
    e.preventDefault()
    e.stopPropagation()
    // Garante que as mensagens estejam ordenadas corretamente ao exibir o popup.
    const messages = data.messages
      .filter(m => m.categoryId === category.id)
      .sort((a, b) => a.order - b.order)

    showShortcutPopup(textArea, messages)
  }
}

/**
 * Exibe o popup de atalhos com navegação por teclado e filtro (agora inteligente).
 * @param {HTMLTextAreaElement} textArea - O textarea alvo para inserção.
 * @param {Array<object>} messages - As mensagens da categoria acionada.
 */
function showShortcutPopup(textArea, messages) {
  // Remove popup anterior se existir (garantia).
  document.getElementById('shortcut-popup')?.remove()
  if (messages.length === 0) return

  // O popup de atalho é sempre relativo ao editor principal.
  const editorContainer = document.getElementById('editor-container-main')
  if (!editorContainer) return

  const popup = document.createElement('div')
  popup.id = 'shortcut-popup'
  applyCurrentTheme(popup)
  editorContainer.appendChild(popup)

  // Estrutura do popup atualizada com indicador de IA
  popup.innerHTML = `
      <div id="shortcut-filter-display">Filtro: <span class="filter-text"></span><span class="ia-indicator" style="display: none;" title="Busca Inteligente Ativa">✨ (IA)</span></div>
      <div id="shortcut-items-container"></div>
  `

  const itemsContainer = popup.querySelector('#shortcut-items-container')
  const filterDisplay = popup.querySelector(
    '#shortcut-filter-display .filter-text'
  )
  const iaIndicator = popup.querySelector(
    '#shortcut-filter-display .ia-indicator'
  ) // NOVO

  // Estado do popup
  let filterString = ''
  let filteredMessages = [...messages] // Cópia da lista original
  let activeIndex = 0
  let isSearchingIA = false // NOVO: Flag para busca IA

  // --- Funções de Renderização e Navegação ---

  // Obtém os elementos DOM dos itens atualmente visíveis (exceto o "no-results")
  const getItems = () =>
    itemsContainer.querySelectorAll('.shortcut-item:not(.no-results)')

  // Garante que o item selecionado esteja visível na área de scroll.
  const ensureVisible = index => {
    const items = getItems()
    if (items[index]) {
      items[index].scrollIntoView({ block: 'nearest' })
    }
  }

  // Renderiza a lista de itens com base no filtro aplicado.
  const renderItems = () => {
    // Limpa o container
    itemsContainer.innerHTML = ''

    // NOVO: Estado de carregamento IA
    if (isSearchingIA) {
      itemsContainer.innerHTML = `<div class="shortcut-item no-results ai-loading">Buscando com IA... ✨</div>`
      return
    }

    if (filteredMessages.length === 0) {
      itemsContainer.innerHTML = `<div class="shortcut-item no-results">Nenhum resultado encontrado</div>`
      activeIndex = 0
      return
    }

    // Renderiza os itens filtrados usando DocumentFragment para performance.
    const fragment = document.createDocumentFragment()
    filteredMessages.forEach((m, index) => {
      const item = document.createElement('div')
      // Define a classe 'active-item' apenas para o primeiro item após a renderização
      item.className = `shortcut-item ${index === 0 ? 'active-item' : ''}`
      item.dataset.messageId = m.id
      item.dataset.index = index
      item.textContent = m.title // Usa textContent para segurança e performance
      fragment.appendChild(item)
    })
    itemsContainer.appendChild(fragment)

    activeIndex = 0 // Reseta o índice ativo para o primeiro item visível
    ensureVisible(0)
  }

  // NOVO: Função para realizar a busca inteligente via IA.
  const performIntelligentSearch = async query => {
    isSearchingIA = true
    iaIndicator.style.display = 'inline'
    renderItems() // Mostra o indicador de carregamento

    try {
      const apiKey = await getGeminiApiKey()
      // searchQuickMessages definido em ai-service.js
      const relevantIds = await searchQuickMessages(apiKey, query, messages)

      // Cria um mapa para acesso rápido à ordem de relevância retornada pela IA
      const relevanceOrder = new Map(
        relevantIds.map((id, index) => [id, index])
      )

      // Filtra e ordena as mensagens originais de acordo com a ordem da IA
      filteredMessages = messages
        .filter(m => relevanceOrder.has(m.id))
        .sort((a, b) => relevanceOrder.get(a.id) - relevanceOrder.get(b.id))
    } catch (error) {
      handleAIError(error)
      // Fallback para busca local simples se a IA falhar
      iaIndicator.style.display = 'none' // Esconde indicador IA no fallback
      filteredMessages = messages.filter(m =>
        m.title.toLowerCase().includes(query.toLowerCase())
      )
    } finally {
      isSearchingIA = false
      renderItems() // Renderiza os resultados finais
    }
  }

  // Atualiza o estado do filtro e decide o tipo de busca. (Agora Async)
  const updateFilter = async newFilter => {
    filterString = newFilter
    filterDisplay.textContent = filterString || '(Digite para filtrar)'

    // Lógica de busca dinâmica e intuitiva:
    if (filterString.length === 0) {
      // Filtro vazio: busca local (lista original)
      filteredMessages = [...messages]
      iaIndicator.style.display = 'none'
      renderItems()
    } else if (filterString.length >= 3) {
      // Filtro longo (3+ chars): inicia a busca inteligente
      await performIntelligentSearch(filterString)
    } else {
      // Filtro curto (1-2 chars): busca local simples por título
      filteredMessages = messages.filter(m =>
        m.title.toLowerCase().includes(filterString.toLowerCase())
      )
      iaIndicator.style.display = 'none'
      renderItems()
    }
  }

  // Seleciona o item e fecha o popup.
  const selectItem = index => {
    // NOVO: Impede seleção se a busca estiver em andamento
    if (isSearchingIA) return

    if (filteredMessages.length === 0 || !filteredMessages[index]) return

    const message = filteredMessages[index]
    if (message) {
      // insertAtCursor lida com a inserção correta.
      insertAtCursor(textArea, message.message)
    }

    // Fechar o popup (o MutationObserver cuidará da limpeza do listener).
    if (editorContainer.contains(popup)) {
      popup.remove()
    }
  }

  // Handler principal de teclado para navegação e filtragem. (Agora Async)
  const navigatePopup = async e => {
    // NOVO: Impede navegação enquanto busca IA estiver ativa
    if (isSearchingIA && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }

    // 1. Handle Navigation/Action Keys (Setas, Enter, Escape)
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      // Impede que a tecla mova o cursor no textarea/wysiwyg.
      e.preventDefault()
      e.stopPropagation()

      const items = getItems()
      const numItems = filteredMessages.length

      // Se não houver itens, apenas Escape funciona
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
          selectItem(activeIndex)
          break
        case 'Escape':
          if (editorContainer.contains(popup)) {
            popup.remove()
          }
          break
      }
      return
    }

    // 2. Handle Backspace (para o filtro)
    if (e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      if (filterString.length > 0) {
        await updateFilter(filterString.slice(0, -1)) // Chamada async
      }
      return
    }

    // 3. Handle Printable Characters (Filtering)
    // Verifica se a tecla é um caractere único e não uma combinação de Ctrl/Meta (Alt é permitido para caracteres especiais/AltGr)
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      e.stopPropagation()
      await updateFilter(filterString + e.key) // Chamada async
    }
  }

  // --- Inicialização do Popup ---

  // Renderização inicial
  updateFilter('')

  // Lógica de Posicionamento (Posição fixa dentro do editor)
  const toolbar = editorContainer.querySelector('.editor-toolbar')
  if (toolbar) {
    // Posiciona centralizado abaixo da toolbar.
    popup.style.top = `${toolbar.offsetHeight + 8}px`
    popup.style.left = `50%`
    popup.style.transform = 'translateX(-50%)'
  } else {
    // Fallback se a toolbar não for encontrada.
    popup.style.top = '10px'
    popup.style.left = '10px'
  }

  // Listener para fechar ao clicar fora.
  const clickOutsideHandler = e => {
    if (!popup.contains(e.target)) {
      if (editorContainer.contains(popup)) {
        popup.remove()
      }
    }
  }

  // Adiciona listener com useCapture=true (usando o novo navigatePopup async)
  document.addEventListener('keydown', navigatePopup, true)

  // Adiciona listener de clique fora.
  setTimeout(() => {
    // Adicionado com pequeno delay para evitar que o clique que abriu o popup o feche imediatamente.
    document.addEventListener('click', clickOutsideHandler, true)
  }, 0)

  // Usa MutationObserver para limpar robustamente os listeners quando o popup é removido.
  const observer = new MutationObserver((mutationsList, observer) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        mutation.removedNodes.forEach(node => {
          if (node === popup) {
            document.removeEventListener('keydown', navigatePopup, true)
            document.removeEventListener('click', clickOutsideHandler, true)
            observer.disconnect()
            // Retorna o foco ao editor ativo após fechar.
            focusEditor(textArea)
          }
        })
      }
    }
  })
  // Observa o container pai (editorContainer) para remoção do filho (popup).
  observer.observe(editorContainer, { childList: true })

  // Handle clicks (Delegação de eventos no container de itens).
  itemsContainer.addEventListener('click', async event => {
    const item = event.target.closest('.shortcut-item')
    // Verifica se o clique não foi no item "Nenhum resultado" ou "Carregando"
    if (item && !item.classList.contains('no-results') && item.dataset.index) {
      const index = parseInt(item.dataset.index)
      selectItem(index)
    }
  })
}
/**
 * Inicia o processo de importação de trâmites a partir de um arquivo JSON.
 * @param {File} file - O arquivo JSON selecionado pelo usuário.
 * @param {Function} onCompleteCallback - Função a ser chamada após a conclusão.
 */
function importQuickMessages(file, onCompleteCallback) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);

      // Validação básica da estrutura do arquivo
      if (!data || !Array.isArray(data.categories) || !Array.isArray(data.messages)) {
        throw new Error("O arquivo não parece ser um backup válido da extensão.");
      }

      // Migra os dados importados para a versão mais recente, se necessário
      const migratedData = await runDataMigration(data);
      
      // Abre o modal de seleção para o usuário escolher o que importar.
      // A função openImportSelectionModal já existe em `quick-messages.js`.
      await openImportSelectionModal(migratedData, onCompleteCallback);

    } catch (error) {
      console.error("Erro ao importar arquivo:", error);
      showNotification(`Erro ao importar: ${error.message}`, "error");
    }
  };
  reader.onerror = () => {
      showNotification("Não foi possível ler o arquivo selecionado.", "error");
  };
  reader.readAsText(file);
}


/**
 * Exporta os trâmites selecionados no modal de gerenciamento para um arquivo JSON.
 * @param {HTMLElement} modal - O elemento do modal de gerenciamento.
 */
async function exportQuickMessages(modal) {
  const selectedMessageIds = Array.from(
    modal.querySelectorAll(".export-item-checkbox:checked")
  ).map(cb => cb.dataset.messageId);

  if (selectedMessageIds.length === 0) {
    showNotification("Nenhum trâmite selecionado para exportar.", "info");
    return;
  }

  const data = await getStoredData();
  const categoriesToExport = new Map();
  const messagesToExport = [];

  // Filtra as mensagens selecionadas e suas respectivas categorias
  data.messages.forEach(msg => {
    if (selectedMessageIds.includes(msg.id)) {
      messagesToExport.push(msg);
      if (!categoriesToExport.has(msg.categoryId)) {
        const category = data.categories.find(c => c.id === msg.categoryId);
        if (category) {
          categoriesToExport.set(category.id, category);
        }
      }
    }
  });

  const exportData = {
    version: DATA_VERSION,
    categories: Array.from(categoriesToExport.values()),
    messages: messagesToExport
  };

  // Cria um arquivo Blob para download
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup_tramites_sgd_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification(`${messagesToExport.length} trâmite(s) exportado(s) com sucesso!`, "success");
}