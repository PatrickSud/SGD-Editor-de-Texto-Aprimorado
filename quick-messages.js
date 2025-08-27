/**
 * @file quick-messages.js
 * @description Gerenciamento de trâmites rápidos, categorias, modais de gerenciamento e lógica de Drag & Drop.
 */

// --- GERENCIAMENTO DE MENSAGENS RÁPIDAS (Dropdown) ---

/**
 * Carrega e renderiza os trâmites rápidos no dropdown especificado.
 * @param {HTMLElement} editorContainer - O container do editor onde o dropdown está localizado.
 */
async function loadQuickMessages(editorContainer) {
  const data = await getStoredData()
  // Encontra o dropdown dentro do container específico.
  const dropdown = editorContainer.querySelector('.quick-steps-dropdown')
  if (!dropdown) return
  dropdown.innerHTML = ''

  const listContainer = document.createElement('div')
  listContainer.classList.add('quick-steps-list')
  dropdown.appendChild(listContainer)

  // A lógica abaixo já carrega as categorias na ordem em que estão salvas.
  // Garante que a ordem do array de categorias seja refletida na UI.
  data.categories.forEach(category => {
    const categoryContainer = document.createElement('div')
    categoryContainer.className = 'category-container'
    categoryContainer.dataset.categoryId = category.id

    // Segurança: Escapar HTML.
    const shortcutDisplay = category.shortcut
      ? `<span class="category-shortcut-display">(${escapeHTML(
          category.shortcut
        )})</span>`
      : ''
    categoryContainer.innerHTML = `<h5 class="category-title">${escapeHTML(
      category.name
    )} ${shortcutDisplay}</h5>`

    // Filtra e ordena as mensagens pela propriedade 'order'.
    const messagesInCategory = data.messages
      .filter(m => m.categoryId === category.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0))

    const messagesList = document.createElement('div')
    messagesList.className = 'messages-list'
    messagesInCategory.forEach(msg =>
      messagesList.appendChild(createMessageElement(msg, editorContainer))
    )
    categoryContainer.appendChild(messagesList)

    // Listeners de Drag & Drop
    categoryContainer.addEventListener('dragover', handleDragOver)
    categoryContainer.addEventListener('dragleave', handleDragLeave)
    categoryContainer.addEventListener('drop', handleDrop)

    // Listener para recolher/expandir a categoria.
    categoryContainer
      .querySelector('.category-title')
      .addEventListener('click', e => {
        e.currentTarget.parentElement.classList.toggle('collapsed')
      })

    listContainer.appendChild(categoryContainer)
  })

  // Botões de ação no final do dropdown.
  const actionsContainer = document.createElement('div')
  actionsContainer.className = 'quick-steps-actions'

  // Adicionado ícone "+" e removido botão "Gerenciar"
  actionsContainer.innerHTML = `
        <button type="button" class="action-btn add-message-btn">+ Adicionar Novo</button>
    `
  dropdown.appendChild(actionsContainer)

  // Adiciona listener ao botão de ação.
  actionsContainer
    .querySelector('.add-message-btn')
    .addEventListener('click', e => {
      e.preventDefault()
      openMessageModal()
    })
}

/**
 * Cria o elemento DOM para uma mensagem rápida no dropdown.
 * @param {object} message - O objeto da mensagem.
 * @param {HTMLElement} editorContainer - O container do editor associado.
 * @returns {HTMLDivElement} O elemento da mensagem.
 */
function createMessageElement(message, editorContainer) {
  const container = document.createElement('div')
  container.className = 'message-item'
  container.dataset.messageId = message.id

  // Segurança: Escapar HTML. Inclui alça de arraste.
  container.innerHTML = `
        <span class="drag-handle" draggable="true" title="Arraste para mover ou reordenar">⠿</span>
        <span class="message-title">${escapeHTML(message.title)}</span>
        <div class="message-actions">
            <button type="button" class="edit-message-btn" title="Editar">✏️</button>
            <button type="button" class="delete-message-btn" title="Excluir">🗑️</button>
        </div>
    `

  // Listeners de Drag (na alça).
  const handle = container.querySelector('.drag-handle')
  handle.addEventListener('dragstart', handleDragStart)
  handle.addEventListener('dragend', handleDragEnd)

  // Listener de Clique (para inserção).
  container.addEventListener('click', e => {
    // Impede a inserção se o clique for nos botões de ação ou na alça.
    if (
      e.target.closest('.message-actions') ||
      e.target.classList.contains('drag-handle')
    ) {
      return
    }
    e.preventDefault()

    // Determina o textarea alvo associado a este editorContainer.
    let targetTextArea = null
    const masterContainer = editorContainer.closest('.editor-master-container')
    if (masterContainer) {
      targetTextArea = masterContainer.querySelector('textarea[data-enhanced]')
    }

    // insertAtCursor lida com a inserção correta (WYSIWYG ou Textarea).
    if (targetTextArea) {
      insertAtCursor(targetTextArea, message.message)
    } else {
      console.error(
        'Editor SGD: Não foi possível encontrar o textarea associado ao inserir trâmite rápido.'
      )
    }
  })

  // Listeners dos botões de ação.
  container.querySelector('.edit-message-btn').addEventListener('click', e => {
    e.preventDefault()
    e.stopPropagation() // Impede que o clique propague para o container (que causaria inserção).
    openMessageModal(message)
  })
  container
    .querySelector('.delete-message-btn')
    .addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      showConfirmDialog(`Excluir "${escapeHTML(message.title)}"?`, () =>
        removeMessageFromStorage(message.id)
      )
    })
  return container
}

/**
 * Remove uma mensagem do armazenamento e reordena a categoria.
 * @param {string} messageId - O ID da mensagem a ser removida.
 */
async function removeMessageFromStorage(messageId) {
  const data = await getStoredData()
  const messageToRemove = data.messages.find(msg => msg.id === messageId)
  if (!messageToRemove) return

  const categoryId = messageToRemove.categoryId
  data.messages = data.messages.filter(msg => msg.id !== messageId)

  // Reordena as mensagens restantes na categoria para evitar lacunas nos índices 'order'.
  const messagesInCat = data.messages
    .filter(m => m.categoryId === categoryId)
    .sort((a, b) => a.order - b.order)

  messagesInCat.forEach((msg, index) => {
    msg.order = index
  })

  await saveStoredData(data)
  // Recarrega todas as instâncias visíveis para refletir a exclusão.
  reloadAllQuickMessagesInstances()
}

/**
 * Recarrega todas as instâncias de Quick Messages (Main e Modais).
 * Chamado após qualquer alteração nos dados (add, edit, delete, reorder, import).
 */
function reloadAllQuickMessagesInstances() {
  const containers = document.querySelectorAll('.editor-container')
  containers.forEach(container => {
    // Verifica se o container possui um dropdown de trâmites rápidos antes de tentar carregar.
    if (container.querySelector('.quick-steps-dropdown')) {
      loadQuickMessages(container)
    }
  })
}

// --- LÓGICA DE DRAG & DROP (Mensagens - Reordenação e Movimentação) ---

function handleDragStart(e) {
  // Garante que estamos arrastando uma mensagem.
  draggedMessageItem = e.target.closest('.message-item')
  if (draggedMessageItem) {
    // Define os dados de transferência (necessário para Firefox).
    e.dataTransfer.setData('text/plain', draggedMessageItem.dataset.messageId)
    e.dataTransfer.effectAllowed = 'move'
    // Usa timeout para aplicar a classe após o início do arraste (permite que o navegador gere a imagem de arraste).
    setTimeout(() => draggedMessageItem.classList.add('is-dragging'), 0)
  }
}

function handleDragEnd(e) {
  if (draggedMessageItem) {
    draggedMessageItem.classList.remove('is-dragging')
    draggedMessageItem = null
  }
  // Limpa todos os indicadores visuais de arraste (classes CSS).
  document
    .querySelectorAll('.drag-over, .drag-over-top, .drag-over-bottom')
    .forEach(el =>
      el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom')
    )
}

function handleDragOver(e) {
  e.preventDefault() // Necessário para permitir o drop.
  const categoryContainer = e.currentTarget.closest('.category-container')
  if (!categoryContainer || !draggedMessageItem) return

  const targetMessageItem = e.target.closest('.message-item')

  // Limpa indicadores anteriores para garantir que apenas o alvo atual esteja destacado.
  document
    .querySelectorAll('.drag-over-top, .drag-over-bottom')
    .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'))
  categoryContainer.classList.remove('drag-over')

  if (targetMessageItem && targetMessageItem !== draggedMessageItem) {
    // Reordenação sobre um item.
    const rect = targetMessageItem.getBoundingClientRect()
    // Define se o cursor está na metade superior ou inferior do alvo.
    const isBottomHalf = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5
    targetMessageItem.classList.add(
      isBottomHalf ? 'drag-over-bottom' : 'drag-over-top'
    )
  } else if (!targetMessageItem) {
    // Movendo para um espaço vazio na categoria (ex: final da lista ou categoria vazia).
    categoryContainer.classList.add('drag-over')
  }
}

function handleDragLeave(e) {
  const categoryContainer = e.currentTarget.closest('.category-container')
  // Remove os indicadores apenas se o mouse sair completamente da área do container da categoria (verifica e.relatedTarget).
  if (categoryContainer && !categoryContainer.contains(e.relatedTarget)) {
    categoryContainer.classList.remove('drag-over')
    categoryContainer
      .querySelectorAll('.drag-over-top, .drag-over-bottom')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'))
  }
}

/**
 * Manipula o evento de drop para mensagens, atualizando a categoria e a ordem no armazenamento.
 */
async function handleDrop(e) {
  e.preventDefault()

  // Captura o item arrastado antes de chamar handleDragEnd, que reseta a variável global.
  const currentDraggedItem = draggedMessageItem

  if (!currentDraggedItem) return

  const categoryContainer = e.currentTarget.closest('.category-container')
  if (!categoryContainer) return

  // Identifica o alvo real do drop usando a posição do cursor.
  const dropTarget = document.elementFromPoint(e.clientX, e.clientY)
  const targetMessageItem = dropTarget
    ? dropTarget.closest('.message-item')
    : null

  // Limpa todos os indicadores visuais e reseta o estado de drag.
  handleDragEnd(e)

  const messageId = currentDraggedItem.dataset.messageId
  const newCategoryId = categoryContainer.dataset.categoryId

  const data = await getStoredData()
  const messageIndex = data.messages.findIndex(m => m.id === messageId)

  if (messageIndex === -1) return

  const originalCategoryId = data.messages[messageIndex].categoryId
  let needsUpdate = false

  // 1. Atualiza a Categoria (se necessário).
  if (originalCategoryId !== newCategoryId) {
    data.messages[messageIndex].categoryId = newCategoryId
    needsUpdate = true
  }

  // 2. Determina a nova ordem. Simulamos a ordem final dos IDs na lista de destino.

  const messagesList = categoryContainer.querySelector('.messages-list')
  // Cria uma lista temporária dos IDs atuais na lista de destino (como aparecem no DOM).
  let orderedMessageIds = Array.from(messagesList.children).map(
    item => item.dataset.messageId
  )

  // Remove o ID do item arrastado de sua posição atual (se estiver na mesma lista), pois será reinserido.
  orderedMessageIds = orderedMessageIds.filter(id => id !== messageId)

  if (
    targetMessageItem &&
    orderedMessageIds.includes(targetMessageItem.dataset.messageId)
  ) {
    // Solto sobre outro item.
    const targetIndex = orderedMessageIds.indexOf(
      targetMessageItem.dataset.messageId
    )

    // Verifica a posição relativa baseada no centro do alvo (repetido aqui pois o handleDragOver foi limpo).
    const rect = targetMessageItem.getBoundingClientRect()
    const isBottomHalf = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5

    if (isBottomHalf) {
      // Insere após o alvo.
      orderedMessageIds.splice(targetIndex + 1, 0, messageId)
    } else {
      // Insere antes do alvo.
      orderedMessageIds.splice(targetIndex, 0, messageId)
    }
  } else {
    // Solto no container (adiciona ao final da lista).
    orderedMessageIds.push(messageId)
  }

  // 3. Atualiza os valores de 'order' com base na nova lista de IDs sequenciais.
  orderedMessageIds.forEach((id, index) => {
    const msgIndex = data.messages.findIndex(m => m.id === id)
    if (msgIndex > -1 && data.messages[msgIndex].order !== index) {
      data.messages[msgIndex].order = index
      needsUpdate = true
    }
  })

  // 4. Se a categoria mudou, reordena a categoria original para remover lacunas nos índices.
  if (originalCategoryId !== newCategoryId) {
    const originalCatMessages = data.messages
      .filter(m => m.categoryId === originalCategoryId)
      .sort((a, b) => a.order - b.order)

    originalCatMessages.forEach((msg, index) => {
      if (msg.order !== index) {
        msg.order = index
        // needsUpdate já é true.
      }
    })
  }

  if (needsUpdate) {
    await saveStoredData(data)
    // Recarrega todas as listas visíveis para refletir as mudanças de ordem e categoria.
    reloadAllQuickMessagesInstances()
  }
}

// --- LÓGICA DE DRAG & DROP (Categorias - Reordenação no Modal de Gerenciamento) ---

function handleCategoryDragStart(e) {
  draggedCategoryItem = e.target.closest('.category-item')
  if (draggedCategoryItem) {
    e.dataTransfer.effectAllowed = 'move'
    // Usa um tipo MIME customizado para identificar o arraste de categoria.
    e.dataTransfer.setData(
      'text/x-sgd-category-id',
      draggedCategoryItem.dataset.id
    )
    setTimeout(() => draggedCategoryItem.classList.add('is-dragging'), 0)
  }
}

function handleCategoryDragOver(e) {
  e.preventDefault()
  const targetItem = e.target.closest('.category-item')
  // Só mostra indicador se estiver sobre um item diferente do que está sendo arrastado.
  if (targetItem && targetItem !== draggedCategoryItem) {
    const rect = targetItem.getBoundingClientRect()
    // Define se o cursor está na metade superior ou inferior do alvo.
    const isBottomHalf = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5
    targetItem.classList.remove('drag-over-top', 'drag-over-bottom')
    targetItem.classList.add(
      isBottomHalf ? 'drag-over-bottom' : 'drag-over-top'
    )
  }
}

function handleCategoryDragLeave(e) {
  const targetItem = e.target.closest('.category-item')
  if (targetItem) {
    targetItem.classList.remove('drag-over-top', 'drag-over-bottom')
  }
}

function handleCategoryDrop(e) {
  e.preventDefault()
  if (!draggedCategoryItem) return

  const targetItem = e.target.closest('.category-item')
  if (targetItem && targetItem !== draggedCategoryItem) {
    targetItem.classList.remove('drag-over-top', 'drag-over-bottom')

    const rect = targetItem.getBoundingClientRect()
    const isBottomHalf = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5

    const list = targetItem.parentNode
    // Move o elemento no DOM. A ordem final será salva apenas quando o usuário clicar em "Salvar Alterações" (em saveAllCategoryChanges).
    if (isBottomHalf) {
      list.insertBefore(draggedCategoryItem, targetItem.nextSibling)
    } else {
      list.insertBefore(draggedCategoryItem, targetItem)
    }
  }
  handleCategoryDragEnd(e)
}

function handleCategoryDragEnd(e) {
  if (draggedCategoryItem) {
    draggedCategoryItem.classList.remove('is-dragging')
    draggedCategoryItem = null
  }
  // Limpa todos os indicadores visuais.
  document.querySelectorAll('.category-item').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom')
  })
}

// --- MODAIS DE GERENCIAMENTO E CATEGORIAS ---

/**
 * Abre o modal para adicionar ou editar uma mensagem rápida.
 * @param {object | null} data - Os dados da mensagem para edição, ou null para adicionar nova.
 */
async function openMessageModal(data = null) {
  const isEditing = data !== null
  const storedData = await getStoredData()

  // Segurança: Escapar nomes de categorias para as opções do select.
  let categoryOptions = storedData.categories
    .map(
      c =>
        `<option value="${c.id}" ${
          isEditing && data && c.id === data.categoryId ? 'selected' : ''
        }>${escapeHTML(c.name)}</option>`
    )
    .join('')
  categoryOptions += `<option value="--new--">Nova Categoria...</option>`

  // Generate a unique ID for this modal editor instance
  const modalInstanceId = `modal-${Date.now()}`

  // Estrutura HTML do modal
  const modal = createModal(
    `${isEditing ? 'Editar' : 'Adicionar'} Trâmite`,
    `
        <div class="form-group">
            <label for="modal-category-select">Categoria</label>
            <select id="modal-category-select">${categoryOptions}</select>
            <div id="new-category-fields" style="display:none; margin-top: 10px;">
                <input type="text" id="modal-new-category-input" placeholder="Nome da Nova Categoria">
                <div class="shortcut-definition-area">
                    <input type="hidden" id="modal-new-category-shortcut" value="">
                    <button type="button" id="define-shortcut-btn" class="action-btn">Definir Atalho</button>
                    <span id="shortcut-preview-display">Nenhum</span>
                </div>
             </div>
        </div>
        <div class="form-group">
            <label for="modal-title-input">Título</label>
            <input type="text" id="modal-title-input" placeholder="Título" value="${
              isEditing && data ? escapeHTML(data.title) : ''
            }">
        </div>
        <div class="form-group">
            <label for="modal-message-input">Conteúdo</label>
            <textarea id="modal-message-input" placeholder="Conteúdo">${
              isEditing && data ? escapeHTML(data.message) : ''
            }</textarea>
        </div>
    `,
    async (modalContent, closeModal) => {
      // Lógica de salvamento
      const newTitle = modalContent
        .querySelector('#modal-title-input')
        .value.trim()
      // Captura o valor do textarea que agora está aprimorado (e sincronizado pelo editor-core).
      const newMessage = modalContent
        .querySelector('#modal-message-input')
        .value.trim()

      const categorySelect = modalContent.querySelector(
        '#modal-category-select'
      )
      let categoryId = categorySelect.value

      // Lógica para Nova Categoria
      if (categoryId === '--new--') {
        const newCategoryName = modalContent
          .querySelector('#modal-new-category-input')
          .value.trim()

        const newCategoryShortcut = modalContent.querySelector(
          '#modal-new-category-shortcut'
        ).value

        if (!newCategoryName) {
          showNotification('O nome da nova categoria é obrigatório.', 'error')
          return
        }

        // Validação do atalho antes de criar a categoria.
        if (newCategoryShortcut) {
          // ID é null pois a categoria ainda não existe.
          const validation = await validateShortcut(newCategoryShortcut, null)
          if (!validation.valid) {
            showNotification(validation.message, 'error')
            return
          }
        }

        // Adiciona a categoria com o atalho definido (ou vazio).
        const newCategory = await addCategory(
          newCategoryName,
          newCategoryShortcut
        )
        if (newCategory) {
          categoryId = newCategory.id
        } else {
          // Se a criação falhou (ex: nome duplicado), interrompe o salvamento.
          return
        }
      }

      // Validação final e salvamento da mensagem
      if (newTitle && newMessage && categoryId && categoryId !== '--new--') {
        const dataToSave = await getStoredData()
        if (isEditing && data) {
          // Edição: Atualiza a mensagem existente.
          const msgIndex = dataToSave.messages.findIndex(m => m.id === data.id)
          if (msgIndex > -1)
            // Mantém o 'order' e 'id' existentes ao editar, mas atualiza categoria se necessário.
            dataToSave.messages[msgIndex] = {
              ...data,
              title: newTitle,
              message: newMessage,
              categoryId
            }
        } else {
          // Adição: Define a ordem para a nova mensagem (final da lista na categoria).
          const messagesInCat = dataToSave.messages.filter(
            m => m.categoryId === categoryId
          )
          const maxOrder =
            messagesInCat.length > 0
              ? Math.max(...messagesInCat.map(m => m.order || 0))
              : -1

          dataToSave.messages.push({
            id: `msg-${Date.now()}`,
            title: newTitle,
            message: newMessage,
            categoryId,
            order: maxOrder + 1 // Define a nova ordem
          })
        }
        await saveStoredData(dataToSave)
        // Recarrega todas as instâncias visíveis.
        reloadAllQuickMessagesInstances()
        closeModal()
      } else {
        showNotification('Título e Conteúdo são obrigatórios.', 'error')
      }
    }
  )
  document.body.appendChild(modal)

  // Inicializa o editor aprimorado no textarea do modal.
  const modalTextArea = modal.querySelector('#modal-message-input')
  if (modalTextArea) {
    // Modais também usam WYSIWYG para consistência, mas sem o botão de alternar tema.
    // Eles incluem QuickSteps para permitir a inserção de trâmites dentro de outros trâmites.
    // A função initializeEditorInstance é definida em main.js.
    await initializeEditorInstance(modalTextArea, modalInstanceId, {
      includeWysiwyg: true,
      includeQuickSteps: true,
      includeThemeToggle: false
    })
  }

  // Listener para mostrar/esconder campos de nova categoria.
  modal
    .querySelector('#modal-category-select')
    .addEventListener('change', e => {
      modal.querySelector('#new-category-fields').style.display =
        e.target.value === '--new--' ? 'block' : 'none'
    })

  // Listener para o botão de definir atalho da nova categoria.
  modal.querySelector('#define-shortcut-btn').addEventListener('click', e => {
    e.preventDefault()
    openShortcutModalForNewCategory(modal)
  })
}

/**
 * Abre o modal principal de gerenciamento de trâmites (Categorias, Import/Export, Configs IA).
 */
async function openManagementModal() {
  const onSave = async (modalContent, closeModal) => {
    // Salva as alterações de nome, ordem e atalhos das categorias que foram modificadas no DOM.
    const success = await saveAllCategoryChanges(modalContent)
    if (success) {
      // Recarrega as instâncias visíveis para refletir as mudanças nas categorias/ordem.
      await reloadAllQuickMessagesInstances()
      showNotification(
        'Alterações de categorias salvas com sucesso!',
        'success'
      )
      // Não fecha o modal automaticamente para permitir que o usuário continue gerenciando ou exportando.
    }
    // A configuração de IA agora é salva pelo botão dedicado (💾) para feedback imediato.
  }

  // Carrega a chave API atual para o input
  const currentApiKey = await getGeminiApiKey()

  // Estrutura HTML com seções recolhíveis.
  const modal = createModal(
    'Configurações', // Título alterado
    `
        <!-- NOVO: SEÇÃO DE IA -->
        <div class="management-section collapsible-section expanded">
            <h4 class="collapsible-header">▼ Configurações de IA (Gemini)</h4>
            <div class="collapsible-content">
                <p>Insira sua chave de API do Google Gemini para habilitar os recursos de IA (Correção, Geração, Resumo e Busca Inteligente). A chave é salva localmente no seu navegador.</p>
                <div class="form-group">
                    <label for="gemini-api-key-input">Chave da API Gemini</label>
                    <div class="category-form">
                        <input type="password" id="gemini-api-key-input" placeholder="AIzaSy..." value="${escapeHTML(
                          currentApiKey
                        )}">
                        <button type="button" id="save-gemini-key-btn" class="action-btn save-cat-btn" title="Salvar Chave">💾</button>
                        <button type="button" id="toggle-key-visibility-btn" class="action-btn" title="Mostrar/Ocultar Chave">👁️</button>
                    </div>
                </div>
                <p style="font-size: 12px; color: var(--text-color-muted);"><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Obtenha sua chave aqui (Google AI Studio)</a>.</p>
            </div>
        </div>
        <hr>
        <!-- FIM SEÇÃO DE IA -->

        <div class="management-section">
            <h4>Categorias (Arraste para reordenar)</h4>
            <p>Edite o nome inline, defina atalhos ou exclua categorias.</p>
            <div id="category-list" class="category-list"></div>
            <div class="category-form">
                <input type="text" id="new-category-name" placeholder="Nome da Nova Categoria">
                <button type="button" id="add-category-btn" class="action-btn">Adicionar</button>
            </div>
        </div>
        <hr>
        <div class="management-section collapsible-section">
            <h4 class="collapsible-header">▶ Importar / Exportar</h4>
            <div class="collapsible-content">
                <p>Selecione um arquivo .json para importar (os dados serão mesclados) ou exporte os trâmites selecionados.</p>
                <input type="file" id="import-file-input" accept=".json">
                <div class="import-export-actions">
                    <button type="button" id="import-btn" class="action-btn">Importar (Mesclar)</button>
                </div>
                <hr>
                <h4>Selecione os trâmites para exportar:</h4>
                <div id="export-list" class="export-list"></div>
                <div class="import-export-actions">
                    <button type="button" id="export-btn" class="action-btn">Exportar Selecionados</button>
                </div>
            </div>
        </div>`,
    onSave,
    true, // Define como modal de gerenciamento (botões diferentes).
    'management-modal' // ID específico para estilos CSS (marca d'água).
  )

  document.body.appendChild(modal)

  // Listener para as seções recolhíveis (Generalizado).
  modal.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', e => {
      const section = e.target.closest('.collapsible-section')
      // Verifica se o clique foi realmente no header
      if (e.target === header || header.contains(e.target)) {
        section.classList.toggle('expanded')
        // Atualiza o ícone (▶ ou ▼)
        const icon = section.classList.contains('expanded') ? '▼' : '▶'
        // Substitui o primeiro caractere pelo ícone correto, mantendo o texto
        const textContent = header.textContent.substring(1)
        header.textContent = icon + textContent
      }
    })
  })

  // NOVO: Listeners para Configuração de IA
  const apiKeyInput = modal.querySelector('#gemini-api-key-input')

  modal
    .querySelector('#save-gemini-key-btn')
    .addEventListener('click', async e => {
      e.preventDefault()
      const newKey = apiKeyInput.value.trim()
      try {
        // Usamos a função genérica saveSettings de storage.js
        await saveSettings({ geminiApiKey: newKey })
        showNotification('Chave da API Gemini salva com sucesso!', 'success')
        // Garante que o input volte a ser password após salvar
        apiKeyInput.type = 'password'
      } catch (error) {
        showNotification('Erro ao salvar a chave da API.', 'error')
      }
    })

  modal
    .querySelector('#toggle-key-visibility-btn')
    .addEventListener('click', e => {
      e.preventDefault()
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password'
    })

  // Renderiza a lista de categorias.
  await renderCategoryManagementList(modal)

  // Listener do botão Adicionar Categoria.
  modal
    .querySelector('#add-category-btn')
    .addEventListener('click', async e => {
      e.preventDefault()
      const input = modal.querySelector('#new-category-name')
      const name = input.value.trim()
      if (name) {
        // Adiciona nova categoria sem atalho por padrão neste fluxo.
        const newCat = await addCategory(name)
        if (newCat) {
          input.value = ''
          await renderCategoryManagementList(modal)
          // Atualiza a lista de exportação também.
          await renderExportList(modal)
        }
      }
    })

  // Listener do botão Importar.
  modal.querySelector('#import-btn').addEventListener('click', e => {
    e.preventDefault()
    const fileInput = modal.querySelector('#import-file-input')
    if (fileInput.files.length > 0) {
      importQuickMessages(fileInput.files[0], () => {
        // Callback após importação: atualiza as listas no modal.
        renderCategoryManagementList(modal)
        renderExportList(modal)
      })
    } else {
      showNotification('Por favor, selecione um arquivo.', 'info')
    }
  })

  // Renderiza a lista de exportação e listener do botão Exportar.
  await renderExportList(modal)
  modal.querySelector('#export-btn').addEventListener('click', e => {
    e.preventDefault()
    exportQuickMessages(modal)
  })
}

/**
 * Renderiza a lista de categorias no modal de gerenciamento, habilitando edição e reordenação.
 */
async function renderCategoryManagementList(modal) {
  const list = modal.querySelector('#category-list')
  const data = await getStoredData()
  list.innerHTML = ''
  data.categories.forEach(cat => {
    const item = document.createElement('div')
    item.className = 'category-item'
    item.dataset.id = cat.id
    // Armazena o atalho no dataset para manipulação posterior.
    item.dataset.shortcut = cat.shortcut || ''
    // Torna o item arrastável para reordenação.
    item.draggable = true

    // Segurança: Escapar nome e atalho. Adiciona alça de arraste e nome editável (contenteditable).
    item.innerHTML = `
            <span class="drag-handle" title="Arraste para reordenar">⠿</span>
            <button type="button" class="action-btn set-shortcut-btn" title="Definir Atalho">⌨️</button>
            <span class="category-name" contenteditable="true">${escapeHTML(
              cat.name
            )}</span>
            <span class="shortcut-display">${
              escapeHTML(cat.shortcut) || 'Nenhum'
            }</span>
            <button type="button" class="action-btn delete-cat-btn">Excluir</button>
        `

    // Listeners de Drag & Drop para reordenação de categorias.
    item.addEventListener('dragstart', handleCategoryDragStart)
    item.addEventListener('dragover', handleCategoryDragOver)
    item.addEventListener('dragleave', handleCategoryDragLeave)
    item.addEventListener('drop', handleCategoryDrop)
    item.addEventListener('dragend', handleCategoryDragEnd)

    // Listener do botão Definir Atalho.
    item.querySelector('.set-shortcut-btn').addEventListener('click', e => {
      e.preventDefault()
      openShortcutModal(cat, item)
    })

    // Listener do botão Excluir Categoria.
    item.querySelector('.delete-cat-btn').addEventListener('click', async e => {
      e.preventDefault()
      if (data.categories.length > 1) {
        showConfirmDialog(
          `Excluir categoria "${escapeHTML(
            cat.name
          )}"? As mensagens serão movidas para outra categoria.`,
          async () => {
            await deleteCategory(cat.id)
            await renderCategoryManagementList(modal)
            // Atualiza a lista de exportação após exclusão.
            await renderExportList(modal)
          }
        )
      } else {
        showNotification('Não é possível excluir a última categoria.', 'error')
      }
    })
    list.appendChild(item)
  })
}

/**
 * Renderiza a lista de trâmites selecionáveis para exportação no modal de gerenciamento.
 */
async function renderExportList(modal) {
  const exportList = modal.querySelector('#export-list')
  const data = await getStoredData()
  exportList.innerHTML = ''
  const exportBtn = modal.querySelector('#export-btn')

  if (data.messages.length > 0) {
    // Renderiza agrupado por categoria.
    data.categories.forEach(category => {
      // Garante a ordem correta das mensagens na exportação.
      const messagesInCategory = data.messages
        .filter(msg => msg.categoryId === category.id)
        .sort((a, b) => a.order - b.order)

      if (messagesInCategory.length === 0) return

      const categoryContainer = document.createElement('div')
      categoryContainer.className = 'export-category'

      const safeCatId = escapeHTML(category.id)
      // Header da categoria com checkbox para selecionar todos.
      categoryContainer.innerHTML = `
                <div class="export-category-header">
                    <input type="checkbox" class="export-category-checkbox" data-category-id="${safeCatId}" id="export-cat-${safeCatId}">
                    <label for="export-cat-${safeCatId}">${escapeHTML(
        category.name
      )}</label>
                </div>`

      // Lista de mensagens da categoria.
      const messagesHtml = messagesInCategory
        .map(msg => {
          const safeMsgId = escapeHTML(msg.id)
          return `<div class="export-item">
                            <input type="checkbox" class="export-item-checkbox" data-msg-category-id="${safeCatId}" data-message-id="${safeMsgId}" id="export-${safeMsgId}">
                            <label for="export-${safeMsgId}">${escapeHTML(
            msg.title
          )}</label>
                        </div>`
        })
        .join('')

      categoryContainer.innerHTML += `<div class="export-messages-list">${messagesHtml}</div>`
      exportList.appendChild(categoryContainer)
    })

    // Lógica para marcar/desmarcar mensagens ao clicar na categoria (checkbox mestre).
    exportList
      .querySelectorAll('.export-category-checkbox')
      .forEach(catCheckbox => {
        catCheckbox.addEventListener('change', e => {
          const catId = e.target.dataset.categoryId
          exportList
            .querySelectorAll(
              `.export-item-checkbox[data-msg-category-id="${catId}"]`
            )
            .forEach(msgCheckbox => {
              msgCheckbox.checked = e.target.checked
            })
        })
      })
    if (exportBtn) exportBtn.disabled = false
  } else {
    exportList.innerHTML =
      '<span class="no-messages">Nenhum trâmite para exportar.</span>'
    if (exportBtn) exportBtn.disabled = true
  }
}

/**
 * Adiciona uma nova categoria ao armazenamento.
 * @param {string} name - Nome da categoria.
 * @param {string} [shortcut=''] - Atalho opcional (deve ser pré-validado).
 */
async function addCategory(name, shortcut = '') {
  const data = await getStoredData()
  if (!name || name.trim() === '') return null

  // Validação de nome duplicado (case-insensitive).
  if (
    data.categories.some(
      c => c.name.toLowerCase() === name.trim().toLowerCase()
    )
  ) {
    showNotification(`A categoria "${name.trim()}" já existe.`, 'error')
    return null
  }

  // A validação do atalho deve ser feita antes de chamar esta função.

  const newCategory = {
    id: `cat-${Date.now()}`,
    name: name.trim(),
    shortcut: shortcut // Usa o atalho fornecido ou o padrão ''
  }
  // Adiciona ao final da lista (ordem padrão).
  data.categories.push(newCategory)
  await saveStoredData(data)
  return newCategory
}

/**
 * Salva todas as alterações de categorias (nome, ordem, atalhos) feitas no modal de gerenciamento.
 * A ordem é determinada pela ordem dos elementos no DOM (após Drag & Drop).
 */
async function saveAllCategoryChanges(modalContent) {
  const currentData = await getStoredData()
  const items = modalContent.querySelectorAll('.category-item')
  let validationError = false
  const newNames = new Set()
  const newCategories = [] // Array para armazenar as categorias na nova ordem.

  // Itera sobre os itens do DOM na ordem em que aparecem.
  items.forEach(item => {
    if (validationError) return // Interrompe se já houver erro.

    const catId = item.dataset.id
    // Captura o nome editado do contenteditable.
    const newName = item.querySelector('.category-name').textContent.trim()
    // Captura o atalho armazenado no dataset (modificado via openShortcutModal).
    const newShortcut = item.dataset.shortcut || ''

    if (!newName) {
      showNotification('O nome da categoria não pode estar vazio.', 'error')
      validationError = true
      return
    }

    // Verifica duplicidade de nome na lista atualizada.
    if (newNames.has(newName.toLowerCase())) {
      showNotification(`Nome de categoria duplicado: "${newName}"`, 'error')
      validationError = true
      return
    }
    newNames.add(newName.toLowerCase())

    // Adiciona a categoria ao novo array, respeitando a ordem do DOM.
    newCategories.push({
      id: catId,
      name: newName,
      shortcut: newShortcut
    })
  })

  if (validationError) return false

  // Prepara o objeto de dados final com as categorias ordenadas e atualizadas.
  const newData = {
    version: DATA_VERSION,
    categories: newCategories,
    messages: currentData.messages // As mensagens não são modificadas aqui.
  }

  await saveStoredData(newData)
  return true
}

/**
 * Exclui uma categoria e move suas mensagens para outra categoria disponível.
 */
async function deleteCategory(id) {
  const data = await getStoredData()
  // Encontra a primeira categoria disponível para mover as mensagens.
  const defaultCategoryId = data.categories.find(c => c.id !== id)?.id

  if (!defaultCategoryId) {
    // Segurança: não deve acontecer se a validação no botão (mínimo 1 categoria) estiver correta.
    showNotification('Erro ao encontrar categoria substituta.', 'error')
    return
  }

  // Move e reordena as mensagens.
  const messagesToMove = data.messages.filter(msg => msg.categoryId === id)
  const destinationCatMessages = data.messages.filter(
    msg => msg.categoryId === defaultCategoryId
  )

  // Calcula a ordem máxima na categoria de destino.
  let maxOrder =
    destinationCatMessages.length > 0
      ? Math.max(...destinationCatMessages.map(m => m.order))
      : -1

  // Move as mensagens para o final da categoria de destino.
  messagesToMove.forEach(msg => {
    msg.categoryId = defaultCategoryId
    msg.order = ++maxOrder
  })

  data.categories = data.categories.filter(c => c.id !== id)
  await saveStoredData(data)
  // A atualização da UI é feita pelo chamador (renderCategoryManagementList) e reloadAllQuickMessagesInstances.
}

// --- MODAIS DE CAPTURA DE ATALHO ---

/**
 * Abre o modal de captura de atalho para uma categoria existente no modal de gerenciamento.
 * @param {object} category - O objeto da categoria sendo editada.
 * @param {HTMLElement} itemElement - O elemento DOM da categoria na lista de gerenciamento.
 */
function openShortcutModal(category, itemElement) {
  let capturedShortcut = null // Armazena o atalho capturado durante a sessão do modal.

  const onSave = async (modalContent, closeModal) => {
    // Determina o atalho final (o capturado ou o inicial se nada foi pressionado).
    const finalShortcut =
      capturedShortcut === null
        ? itemElement.dataset.shortcut
        : capturedShortcut

    // Se o atalho for vazio (limpo via ESC), salva imediatamente.
    if (finalShortcut === '') {
      itemElement.dataset.shortcut = ''
      itemElement.querySelector('.shortcut-display').textContent = 'Nenhum'
      closeModalAndRemoveListener()
      return
    }

    // Valida o atalho (verifica se está protegido ou em uso por outra categoria).
    const validation = await validateShortcut(finalShortcut, category.id)
    if (validation.valid) {
      // Se válido, atualiza o dataset e o display do item no modal de gerenciamento.
      itemElement.dataset.shortcut = finalShortcut
      itemElement.querySelector('.shortcut-display').textContent =
        escapeHTML(finalShortcut)
      closeModalAndRemoveListener()
    } else {
      showNotification(validation.message, 'error')
      // Não fecha o modal para permitir correção.
    }
  }

  const modal = createModal(
    `Definir Atalho para "${escapeHTML(category.name)}"`,
    `<p>Pressione a combinação de teclas desejada (ex: <b>Alt + 1</b>, <b>Ctrl + Shift + O</b>) e clique em Salvar.<br> Pressione <b>ESC</b> para limpar.</p>
         <div id="shortcut-preview" class="shortcut-preview-box">${
           escapeHTML(itemElement.dataset.shortcut) || 'Aguardando...'
         }</div>
         <p class="shortcut-recommendation"><b>Nota</b>: As alterações só serão efetivadas ao clicar em "<b>Salvar Alterações</b>" na janela de gerenciamento.</p>`,
    onSave
  )

  // Handler para captura de teclas
  const keydownHandler = createKeydownHandler(modal, shortcut => {
    capturedShortcut = shortcut
  })

  // Adiciona o listener com prioridade (useCapture=true).
  document.addEventListener('keydown', keydownHandler, true)

  // Função auxiliar para fechar o modal e remover o listener de teclado.
  const closeModalAndRemoveListener = () => {
    document.removeEventListener('keydown', keydownHandler, true)
    if (document.body.contains(modal)) {
      modal.remove()
    }
  }

  // Garante a remoção do listener ao fechar (via botões de Cancelar/Fechar).
  // Sobrescreve os handlers padrão definidos em createModal.
  modal.querySelector('.se-close-modal-btn').onclick =
    closeModalAndRemoveListener
  const cancelBtn = modal.querySelector('#modal-cancel-btn')
  if (cancelBtn) cancelBtn.onclick = closeModalAndRemoveListener

  document.body.appendChild(modal)
}

/**
 * Abre o modal de captura de atalho para uma nova categoria sendo criada no modal de Adicionar Trâmite.
 * @param {HTMLElement} parentModal - O modal de Adicionar/Editar Trâmite.
 */
function openShortcutModalForNewCategory(parentModal) {
  let capturedShortcut = null
  const shortcutInput = parentModal.querySelector(
    '#modal-new-category-shortcut'
  )
  const shortcutDisplay = parentModal.querySelector('#shortcut-preview-display')

  const initialShortcut = shortcutInput.value

  const onSave = async (modalContent, closeModal) => {
    const finalShortcut =
      capturedShortcut === null ? initialShortcut : capturedShortcut

    if (finalShortcut === '') {
      shortcutInput.value = ''
      shortcutDisplay.textContent = 'Nenhum'
      closeModalAndRemoveListener()
      return
    }

    // Valida contra atalhos existentes (ID é null pois é nova categoria).
    const validation = await validateShortcut(finalShortcut, null)
    if (validation.valid) {
      // Atualiza os campos no modal pai (Adicionar Trâmite).
      shortcutInput.value = finalShortcut
      shortcutDisplay.textContent = escapeHTML(finalShortcut)
      closeModalAndRemoveListener()
    } else {
      showNotification(validation.message, 'error')
      // Não fecha o modal para permitir correção.
    }
  }

  const modal = createModal(
    `Definir Atalho para Nova Categoria`,
    `<p>Pressione a combinação de teclas desejada (ex: Alt+1, Ctrl+Shift+A) e clique em Salvar. Pressione ESC para limpar.</p>
         <div id="shortcut-preview" class="shortcut-preview-box">${
           escapeHTML(initialShortcut) || 'Aguardando...'
         }</div>`,
    onSave
  )

  // Handler para captura de teclas
  const keydownHandler = createKeydownHandler(modal, shortcut => {
    capturedShortcut = shortcut
  })

  // Adiciona o listener com prioridade.
  document.addEventListener('keydown', keydownHandler, true)

  const closeModalAndRemoveListener = () => {
    document.removeEventListener('keydown', keydownHandler, true)
    if (document.body.contains(modal)) {
      modal.remove()
    }
  }

  // Garante a remoção do listener ao fechar (via botões).
  modal.querySelector('.se-close-modal-btn').onclick =
    closeModalAndRemoveListener
  const cancelBtn = modal.querySelector('#modal-cancel-btn')
  if (cancelBtn) cancelBtn.onclick = closeModalAndRemoveListener

  document.body.appendChild(modal)
}

/**
 * Função auxiliar para criar o handler de keydown para captura de atalhos nos modais.
 * @param {HTMLElement} modal - O modal de captura de atalho.
 * @param {Function} setCapturedShortcutCallback - Callback para definir o atalho capturado.
 */
function createKeydownHandler(modal, setCapturedShortcutCallback) {
  return e => {
    // Impede qualquer ação padrão do navegador e impede que o evento chegue a outros listeners (como o do editor principal).
    e.preventDefault()
    e.stopPropagation()

    const modifiers = []
    if (e.ctrlKey) modifiers.push('ctrl')
    if (e.altKey) modifiers.push('alt')
    if (e.shiftKey) modifiers.push('shift')

    const mainKey = e.key.toLowerCase()

    // Tecla ESC limpa o atalho.
    if (mainKey === 'escape') {
      setCapturedShortcutCallback('')
      modal.querySelector('#shortcut-preview').textContent = 'Nenhum (Limpo)'
      return
    }

    // Ignora teclas modificadoras pressionadas sozinhas.
    if (['control', 'alt', 'shift', 'meta'].includes(mainKey)) return

    // Requer pelo menos um modificador.
    if (modifiers.length === 0) {
      modal.querySelector('#shortcut-preview').textContent =
        'Use Ctrl, Alt ou Shift'
      return
    }

    // Constrói a string de combinação (ordenada para consistência).
    modifiers.sort() // Garante ordem consistente (alt+ctrl vs ctrl+alt).
    const combination = [...modifiers, mainKey]
    const capturedShortcut = combination.join('+')

    setCapturedShortcutCallback(capturedShortcut)
    modal.querySelector('#shortcut-preview').textContent =
      escapeHTML(capturedShortcut)
  }
}

// A primeira definição duplicada de _addCategoryInMemory foi removida. A definição correta segue abaixo.

/**
 * Adiciona uma nova categoria a um objeto de dados em memória, sem salvar no armazenamento.
 * Utilizado internamente pelo processo de importação para evitar múltiplas gravações.
 * Se uma categoria com o mesmo nome já existir (localmente ou durante a sessão de importação), retorna a existente.
 * @param {object} data - O objeto de dados completo (com 'categories' e 'messages').
 * @param {string} name - O nome da nova categoria.
 * @returns {object | null} A nova categoria criada ou a existente se o nome já existir.
 */
function _addCategoryInMemory(data, name) {
  if (!name || name.trim() === '') return null

  const trimmedName = name.trim()
  // Validação de nome duplicado (case-insensitive)
  const existingCategory = data.categories.find(
    c => c.name.toLowerCase() === trimmedName.toLowerCase()
  )
  if (existingCategory) {
    // Se a categoria já existe, retorna a existente em vez de criar uma nova.
    return existingCategory
  }

  const newCategory = {
    // Gera um ID único robusto para evitar colisões durante a importação.
    id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: trimmedName,
    shortcut: '' // Atalhos importados são ignorados para prevenir conflitos.
  }
  data.categories.push(newCategory)
  return newCategory
}

/**
 * Função auxiliar que lê o modal e extrai as tarefas de importação selecionadas pelo usuário.
 * @param {HTMLElement} modalBody - O corpo do elemento do modal.
 * @returns {Array<object>} Uma lista de tarefas, onde cada tarefa contém os dados da mensagem e o destino escolhido.
 */
function _getImportTasks(modalBody) {
  const tasks = []
  const selectedCheckboxes = modalBody.querySelectorAll(
    '.import-item-checkbox:checked'
  )

  selectedCheckboxes.forEach(checkbox => {
    const group = checkbox.closest('.import-category')
    const destinationSelect = group.querySelector('.destination-select')
    tasks.push({
      // Os dados da mensagem foram armazenados no dataset durante a criação do modal.
      messageData: JSON.parse(checkbox.dataset.messageContent),
      destinationChoice: destinationSelect.value,
      newCategoryName: group.dataset.importedCategoryName
    })
  })
  return tasks
}

/**
 * Função auxiliar que aplica as tarefas de importação a um objeto de dados.
 * @param {object} data - O objeto de dados atual a ser modificado.
 * @param {Array<object>} tasks - A lista de tarefas gerada por _getImportTasks.
 * @returns {number} O número de trâmites que foram efetivamente adicionados.
 */
function _applyImportTasksToData(data, tasks) {
  const maxOrderMap = new Map()
  let importedCount = 0

  for (const task of tasks) {
    let finalCategoryId

    if (task.destinationChoice === '--create-new--') {
      // Tenta criar a categoria. Se o nome já existir, _addCategoryInMemory retornará a existente.
      const category = _addCategoryInMemory(data, task.newCategoryName)
      finalCategoryId = category ? category.id : null
    } else {
      // Destino é uma categoria existente selecionada pelo ID.
      finalCategoryId = task.destinationChoice
    }

    if (!finalCategoryId) continue // Pula se não conseguiu determinar um destino

    // Calcula a ordem máxima para a categoria de destino (apenas na primeira vez que a categoria é encontrada).
    if (!maxOrderMap.has(finalCategoryId)) {
      const messagesInDest = data.messages.filter(
        m => m.categoryId === finalCategoryId
      )
      maxOrderMap.set(
        finalCategoryId,
        messagesInDest.length > 0
          ? Math.max(...messagesInDest.map(m => m.order || 0))
          : -1
      )
    }

    let currentMaxOrder = maxOrderMap.get(finalCategoryId)
    currentMaxOrder++

    // Adiciona a mensagem ao objeto de dados.
    data.messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: task.messageData.title || 'Trâmite Importado',
      message: task.messageData.message || '',
      categoryId: finalCategoryId,
      order: currentMaxOrder
    })

    maxOrderMap.set(finalCategoryId, currentMaxOrder)
    importedCount++
  }
  return importedCount
}

/**
 * Abre um modal para o usuário selecionar quais trâmites de um arquivo importar.
 * @param {object} importedData - Os dados lidos e migrados do arquivo JSON.
 * @param {Function} onCompleteCallback - Callback a ser executado no final do processo.
 */
async function openImportSelectionModal(importedData, onCompleteCallback) {
  const currentData = await getStoredData()

  if (!currentData || !currentData.categories) {
    showNotification('Falha ao carregar dados locais para importação.', 'error')
    return
  }

  // A restrição que impedia a importação se não houvesse categorias locais foi removida.

  // --- Robustness Improvement: Handle Orphaned Messages ---
  // Identify messages whose category ID is not present in the imported categories list.
  const definedCategoryIds = new Set(importedData.categories.map(cat => cat.id))

  // Create a deep copy of messages to safely modify categoryId for UI grouping purposes.
  // We use this copy for the UI generation process.
  const importedMessages = JSON.parse(JSON.stringify(importedData.messages))
  const orphanedMessages = importedMessages.filter(
    msg => !definedCategoryIds.has(msg.categoryId)
  )

  const categoriesToDisplay = [...importedData.categories]

  if (orphanedMessages.length > 0) {
    const orphanCatId = 'orphan-import-group' // Temporary ID for UI grouping
    const orphanCategory = {
      id: orphanCatId,
      name: 'Trâmites Órfãos (Sem Categoria no Arquivo)'
    }
    categoriesToDisplay.push(orphanCategory)
    // Assign the temporary ID so they are grouped correctly by the filter logic below.
    orphanedMessages.forEach(msg => (msg.categoryId = orphanCatId))
  }
  // ---------------------------------------------------------

  if (importedMessages.length === 0) {
    showNotification('O arquivo não contém trâmites para importar.', 'info')
    return
  }

  // Monta o HTML da interface de seleção
  let selectionHtml = '<div class="import-selection-list">'

  // Iterate over categoriesToDisplay (which includes the orphan group if needed)
  categoriesToDisplay.forEach(importedCategory => {
    // Use the potentially modified importedMessages array for filtering
    const messagesInCategory = importedMessages
      .filter(msg => msg.categoryId === importedCategory.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0))

    // This check is technically redundant now because we only add categories if they have messages (including orphans), but kept for safety.
    if (messagesInCategory.length === 0) return

    // Tenta encontrar uma correspondência por nome nos dados atuais.
    const existingCategoryMatch = currentData.categories.find(
      c => c.name.toLowerCase() === importedCategory.name.toLowerCase()
    )

    // Gera as opções de destino (Mesclar com existentes).
    let destinationOptions = currentData.categories
      .map(
        cat =>
          `<option value="${cat.id}" ${
            existingCategoryMatch && cat.id === existingCategoryMatch.id
              ? 'selected'
              : ''
          }>Mesclar com "${escapeHTML(cat.name)}"</option>`
      )
      .join('')

    // Opção de Criar Nova Categoria. Selecionada por padrão se não houver correspondência (o que inclui o caso de não haver categorias locais).
    const createNewSelected =
      !existingCategoryMatch || currentData.categories.length === 0
        ? 'selected'
        : ''
    destinationOptions += `<option value="--create-new--" ${createNewSelected}>Criar nova categoria "${escapeHTML(
      importedCategory.name
    )}"</option>`

    // Monta o bloco HTML da categoria importada.
    selectionHtml += `
      <div class="import-category" data-imported-category-name="${escapeHTML(
        importedCategory.name
      )}">
        <div class="import-category-header">
          <input type="checkbox" class="import-category-checkbox" id="import-cat-${escapeHTML(
            importedCategory.id
          )}">
          <label for="import-cat-${escapeHTML(
            importedCategory.id
          )}">${escapeHTML(importedCategory.name)}</label>
          <div class="import-category-destination">
            <span>→</span>
            <select class="destination-select">${destinationOptions}</select>
          </div>
        </div>
        <div class="import-messages-list">
          ${messagesInCategory
            .map(
              msg => `
            <div class="import-item">
              <input type="checkbox" class="import-item-checkbox" data-message-content='${escapeHTML(
                JSON.stringify(msg)
              )}'>
              <label>${escapeHTML(msg.title)}</label>
            </div>`
            )
            .join('')}
        </div>
      </div>`
  })
  selectionHtml += '</div>'

  const modalContent = `<p>Selecione os trâmites e defina o destino para cada categoria.</p>${selectionHtml}`

  // Lógica de salvamento (Executa a importação)
  const onSave = async (modalBody, closeModal) => {
    const tasks = _getImportTasks(modalBody)
    if (tasks.length === 0) {
      showNotification('Nenhum trâmite foi selecionado.', 'info')
      return
    }

    // Fluxo de dados seguro: Ler, Modificar, Salvar.
    const dataToSave = await getStoredData() // Lê os dados mais atuais.
    const importedCount = _applyImportTasksToData(dataToSave, tasks) // Modifica o objeto de dados em memória.

    if (importedCount > 0) {
      await saveStoredData(dataToSave) // Salva o objeto modificado.
      showNotification(
        `${importedCount} trâmite(s) importado(s) com sucesso!`,
        'success'
      )
      reloadAllQuickMessagesInstances()
    } else {
      showNotification('Nenhum trâmite foi importado.', 'info')
    }

    if (onCompleteCallback) onCompleteCallback()
    closeModal()
  }

  const modal = createModal(
    'Selecionar Trâmites para Importar',
    modalContent,
    onSave
  )
  document.body.appendChild(modal)

  // Lógica para o checkbox mestre da categoria (Selecionar/Deselecionar todos os trâmites filhos).
  modal.querySelectorAll('.import-category-checkbox').forEach(catCheckbox => {
    catCheckbox.addEventListener('change', e => {
      const parentCategoryDiv = e.target.closest('.import-category')
      parentCategoryDiv
        .querySelectorAll('.import-item-checkbox')
        .forEach(msgCheckbox => {
          msgCheckbox.checked = e.target.checked
        })
    })
  })
}
