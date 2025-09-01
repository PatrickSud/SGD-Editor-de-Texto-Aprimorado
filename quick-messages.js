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
    const success = await saveAllCategoryChanges(modalContent)
    if (success) {
      await reloadAllQuickMessagesInstances()
      showNotification(
        'Alterações de categorias salvas com sucesso!',
        'success'
      )
    }
  }

  const currentApiKey = await getGeminiApiKey()

  const modal = createModal(
    'Configurações',
    `
        <div class="management-section collapsible-section">
            <h4 class="collapsible-header">▶ 🗃️ Categorias</h4>
            <div class="collapsible-content">
                <p>Edite o nome, defina atalhos ou exclua categorias. (Arraste para reordenar)</p>
                <div id="category-list" class="category-list"></div>
                <div class="category-form">
                    <input type="text" id="new-category-name" placeholder="Nome da Nova Categoria">
                    <button type="button" id="add-category-btn" class="action-btn">Adicionar</button>
                </div>
            </div>
        </div>
        <hr>
        <div class="management-section collapsible-section">
            <h4 class="collapsible-header">▶ 🔃 Importar / Exportar</h4>
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
        </div>
        <hr>
        <div class="management-section collapsible-section">
            <h4 class="collapsible-header">▶ ✨ Configurações de IA (Gemini)</h4>
            <div class="collapsible-content">
                <p>Insira sua chave de API do Google Gemini para habilitar os recursos de IA.</p>
                <div class="form-group">
                    <label for="gemini-api-key-input">Chave da API Gemini</label>
                    <div class="category-form">
                        <input type="text" id="gemini-api-key-input" placeholder="AIzaSy..." value="${escapeHTML(
                          currentApiKey
                        )}">
                         <button type="button" id="save-gemini-key-btn" class="action-btn save-cat-btn" title="Salvar Chave">💾</button>
                    </div>
                     <div class="category-form" style="margin-top: 10px; justify-content: space-between;">
                        <button type="button" id="how-to-get-api-key-link" class="action-btn small-btn">👆 Como obter a chave de API?</button>
                        <button type="button" id="test-api-key-btn" class="action-btn">Testar Conexão</button>
                    </div>
                </div>
            </div>
        </div>`,
    onSave,
    true,
    'management-modal'
  )

  document.body.appendChild(modal)

  // O restante da função continua o mesmo, exceto pela remoção do listener do botão de visibilidade.
  modal.querySelectorAll('.collapsible-header').forEach(header => {
    header.addEventListener('click', e => {
      const section = e.target.closest('.collapsible-section')
      if (e.target === header || header.contains(e.target)) {
        section.classList.toggle('expanded')
        const icon = section.classList.contains('expanded') ? '▼' : '▶'
        const textContent = header.textContent.substring(1)
        header.textContent = icon + textContent
      }
    })
  })

  const apiKeyInput = modal.querySelector('#gemini-api-key-input')

  modal
    .querySelector('#save-gemini-key-btn')
    .addEventListener('click', async e => {
      e.preventDefault()
      const newKey = apiKeyInput.value.trim()
      try {
        await saveSettings({ geminiApiKey: newKey })
        showNotification('Chave da API Gemini salva com sucesso!', 'success')
      } catch (error) {
        showNotification('Erro ao salvar a chave da API.', 'error')
      }
    })

  modal
    .querySelector('#test-api-key-btn')
    .addEventListener('click', async e => {
      e.preventDefault()
      const key = apiKeyInput.value.trim()
      if (!key) {
        showNotification(
          'Por favor, insira uma chave de API para testar.',
          'info'
        )
        return
      }
      const button = e.target
      button.disabled = true
      button.classList.add('ai-loading')
      button.textContent = 'Testando...'

      try {
        const success = await testApiKey(key)
        if (success) {
          showNotification('Conexão com a API bem-sucedida!', 'success')
        }
      } catch (error) {
        showNotification(`Falha na conexão: ${error.message}`, 'error', 5000)
      } finally {
        button.disabled = false
        button.classList.remove('ai-loading')
        button.textContent = 'Testar Conexão'
      }
    })

  modal
    .querySelector('#how-to-get-api-key-link')
    .addEventListener('click', e => {
      e.preventDefault()
      showHowToGetApiKeyModal()
    })

  await renderCategoryManagementList(modal)

  modal
    .querySelector('#add-category-btn')
    .addEventListener('click', async e => {
      e.preventDefault()
      const input = modal.querySelector('#new-category-name')
      const name = input.value.trim()
      if (name) {
        const newCat = await addCategory(name)
        if (newCat) {
          input.value = ''
          await renderCategoryManagementList(modal)
          await renderExportList(modal)
        }
      }
    })

  modal.querySelector('#import-btn').addEventListener('click', e => {
    e.preventDefault()
    const fileInput = modal.querySelector('#import-file-input')
    if (fileInput.files.length > 0) {
      importQuickMessages(fileInput.files[0], () => {
        renderCategoryManagementList(modal)
        renderExportList(modal)
      })
    } else {
      showNotification('Por favor, selecione um arquivo.', 'info')
    }
  })

  await renderExportList(modal)
  modal.querySelector('#export-btn').addEventListener('click', e => {
    e.preventDefault()
    exportQuickMessages(modal)
  })
}

/**
 * Exibe um modal com instruções sobre como obter a chave da API Gemini.
 */
function showHowToGetApiKeyModal() {
  const content = `
    <p>Para usar os recursos de Inteligência Artificial, você precisa de uma chave de API gratuita do Google AI Studio.</p>
    <ol style="padding-left: 20px; line-height: 1.6;">
        <li>Acesse o <i>Google AI Studio</i> clicando no botão abaixo.</li>
        <li>Faça login com sua conta Google, se necessário.</li>
        <li>Clique no botão "<b>Get API key</b>" e aceite os termos.</li>
        <li>Clique no botão "<b>+ Criar chave de API</b>".</li>
        <li>Copie a chave gerada.</li>
        <li>Cole a chave no campo "<b>Chave da API Gemini</b>" nas configurações e clique em salvar.</li>
    </ol>
    <div style="text-align: center; margin-top: 20px;">
     <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="action-btn action-btn-themed">Abrir Google AI Studio</a>
    </div>
    <p style="font-size: 12px; color: var(--text-color-muted); margin-top: 15px;">Sua chave é armazenada de forma segura apenas no seu navegador e nunca é compartilhada.</p>
    `
  showInfoModal('Como Obter uma Chave de API do Gemini', content)
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
    item.dataset.shortcut = cat.shortcut || ''
    item.draggable = true

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

    item.addEventListener('dragstart', handleCategoryDragStart)
    item.addEventListener('dragover', handleCategoryDragOver)
    item.addEventListener('dragleave', handleCategoryDragLeave)
    item.addEventListener('drop', handleCategoryDrop)
    item.addEventListener('dragend', handleCategoryDragEnd)

    item.querySelector('.set-shortcut-btn').addEventListener('click', e => {
      e.preventDefault()
      openShortcutModal(cat, item)
    })

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
    data.categories.forEach(category => {
      const messagesInCategory = data.messages
        .filter(msg => msg.categoryId === category.id)
        .sort((a, b) => a.order - b.order)

      if (messagesInCategory.length === 0) return

      const categoryContainer = document.createElement('div')
      categoryContainer.className = 'export-category'

      const safeCatId = escapeHTML(category.id)
      categoryContainer.innerHTML = `
                <div class="export-category-header">
                    <input type="checkbox" class="export-category-checkbox" data-category-id="${safeCatId}" id="export-cat-${safeCatId}">
                    <label for="export-cat-${safeCatId}">${escapeHTML(
        category.name
      )}</label>
                </div>`

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

  if (
    data.categories.some(
      c => c.name.toLowerCase() === name.trim().toLowerCase()
    )
  ) {
    showNotification(`A categoria "${name.trim()}" já existe.`, 'error')
    return null
  }

  const newCategory = {
    id: `cat-${Date.now()}`,
    name: name.trim(),
    shortcut: shortcut
  }
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
  const newCategories = []

  items.forEach(item => {
    if (validationError) return

    const catId = item.dataset.id
    const newName = item.querySelector('.category-name').textContent.trim()
    const newShortcut = item.dataset.shortcut || ''

    if (!newName) {
      showNotification('O nome da categoria não pode estar vazio.', 'error')
      validationError = true
      return
    }

    if (newNames.has(newName.toLowerCase())) {
      showNotification(`Nome de categoria duplicado: "${newName}"`, 'error')
      validationError = true
      return
    }
    newNames.add(newName.toLowerCase())

    newCategories.push({
      id: catId,
      name: newName,
      shortcut: newShortcut
    })
  })

  if (validationError) return false

  const newData = {
    version: DATA_VERSION,
    categories: newCategories,
    messages: currentData.messages
  }

  await saveStoredData(newData)
  return true
}

/**
 * Exclui uma categoria e move suas mensagens para outra categoria disponível.
 */
async function deleteCategory(id) {
  const data = await getStoredData()
  const defaultCategoryId = data.categories.find(c => c.id !== id)?.id

  if (!defaultCategoryId) {
    showNotification('Erro ao encontrar categoria substituta.', 'error')
    return
  }

  const messagesToMove = data.messages.filter(msg => msg.categoryId === id)
  const destinationCatMessages = data.messages.filter(
    msg => msg.categoryId === defaultCategoryId
  )

  let maxOrder =
    destinationCatMessages.length > 0
      ? Math.max(...destinationCatMessages.map(m => m.order))
      : -1

  messagesToMove.forEach(msg => {
    msg.categoryId = defaultCategoryId
    msg.order = ++maxOrder
  })

  data.categories = data.categories.filter(c => c.id !== id)
  await saveStoredData(data)
}

// --- MODAIS DE CAPTURA DE ATALHO ---

/**
 * Abre o modal de captura de atalho para uma categoria existente no modal de gerenciamento.
 * @param {object} category - O objeto da categoria sendo editada.
 * @param {HTMLElement} itemElement - O elemento DOM da categoria na lista de gerenciamento.
 */
function openShortcutModal(category, itemElement) {
  let capturedShortcut = null
  const initialShortcut = itemElement.dataset.shortcut || ''

  const onSave = async (modalContent, closeModal) => {
    const finalShortcut =
      capturedShortcut === null ? initialShortcut : capturedShortcut

    // Validação de segurança para atalhos protegidos
    if (PROTECTED_SHORTCUTS.includes(finalShortcut)) {
      showNotification(
        `O atalho "${finalShortcut}" é protegido pelo sistema e não pode ser usado.`,
        'error'
      )
      return
    }

    try {
      // Valida e salva diretamente no storage
      await updateCategoryShortcut(category.id, finalShortcut)

      // Atualiza a UI
      itemElement.dataset.shortcut = finalShortcut
      itemElement.querySelector('.shortcut-display').textContent =
        escapeHTML(finalShortcut) || 'Nenhum'
      showNotification('Atalho salvo com sucesso!', 'success')
      closeModalAndRemoveListener()
      // Recarrega os trâmites no dropdown para refletir a mudança de atalho
      reloadAllQuickMessagesInstances()
    } catch (error) {
      showNotification(`Erro ao salvar: ${error.message}`, 'error')
    }
  }

  const modal = createModal(
    `Definir Atalho para "${escapeHTML(category.name)}"`,
    `<p class="text-center">Pressione a combinação de teclas desejada (ex: <b>Alt + 1</b>) e clique em Salvar.</p>
          <div id="shortcut-preview" class="shortcut-preview-box">${
            escapeHTML(initialShortcut) || 'Aguardando...'
          }</div>
         <p class="shortcut-recommendation"><b>Nota</b>: Pressione <b>ESC</b> para limpar o atalho.</p>`,
    onSave
  )

  const keydownHandler = createKeydownHandler(modal, shortcut => {
    capturedShortcut = shortcut
  })

  document.addEventListener('keydown', keydownHandler, true)

  const closeModalAndRemoveListener = () => {
    document.removeEventListener('keydown', keydownHandler, true)
    if (document.body.contains(modal)) {
      modal.remove()
    }
  }

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

    const validation = await validateShortcut(finalShortcut, null)
    if (validation.valid) {
      shortcutInput.value = finalShortcut
      shortcutDisplay.textContent = escapeHTML(finalShortcut)
      closeModalAndRemoveListener()
    } else {
      showNotification(validation.message, 'error')
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

  const keydownHandler = createKeydownHandler(modal, shortcut => {
    capturedShortcut = shortcut
  })

  document.addEventListener('keydown', keydownHandler, true)

  const closeModalAndRemoveListener = () => {
    document.removeEventListener('keydown', keydownHandler, true)
    if (document.body.contains(modal)) {
      modal.remove()
    }
  }

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
    e.preventDefault()
    e.stopPropagation()

    const modifiers = []
    if (e.ctrlKey) modifiers.push('ctrl')
    if (e.altKey) modifiers.push('alt')
    if (e.shiftKey) modifiers.push('shift')

    const mainKey = e.key.toLowerCase()

    if (mainKey === 'escape') {
      setCapturedShortcutCallback('')
      modal.querySelector('#shortcut-preview').textContent = 'Nenhum (Limpo)'
      return
    }

    if (['control', 'alt', 'shift', 'meta'].includes(mainKey)) return

    if (modifiers.length === 0) {
      modal.querySelector('#shortcut-preview').textContent =
        'Use Ctrl, Alt ou Shift'
      return
    }

    modifiers.sort()
    const combination = [...modifiers, mainKey]
    const capturedShortcut = combination.join('+')

    setCapturedShortcutCallback(capturedShortcut)
    modal.querySelector('#shortcut-preview').textContent =
      escapeHTML(capturedShortcut)
  }
}

function _addCategoryInMemory(data, name) {
  if (!name || name.trim() === '') return null

  const trimmedName = name.trim()
  const existingCategory = data.categories.find(
    c => c.name.toLowerCase() === trimmedName.toLowerCase()
  )
  if (existingCategory) {
    return existingCategory
  }

  const newCategory = {
    id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: trimmedName,
    shortcut: ''
  }
  data.categories.push(newCategory)
  return newCategory
}

function _getImportTasks(modalBody) {
  const tasks = []
  const selectedCheckboxes = modalBody.querySelectorAll(
    '.import-item-checkbox:checked'
  )

  selectedCheckboxes.forEach(checkbox => {
    const group = checkbox.closest('.import-category')
    const destinationSelect = group.querySelector('.destination-select')
    tasks.push({
      messageData: JSON.parse(checkbox.dataset.messageContent),
      destinationChoice: destinationSelect.value,
      newCategoryName: group.dataset.importedCategoryName
    })
  })
  return tasks
}

function _applyImportTasksToData(data, tasks) {
  const maxOrderMap = new Map()
  let importedCount = 0

  for (const task of tasks) {
    let finalCategoryId

    if (task.destinationChoice === '--create-new--') {
      const category = _addCategoryInMemory(data, task.newCategoryName)
      finalCategoryId = category ? category.id : null
    } else {
      finalCategoryId = task.destinationChoice
    }

    if (!finalCategoryId) continue

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

async function openImportSelectionModal(importedData, onCompleteCallback) {
  const currentData = await getStoredData()

  if (!currentData || !currentData.categories) {
    showNotification('Falha ao carregar dados locais para importação.', 'error')
    return
  }

  const definedCategoryIds = new Set(importedData.categories.map(cat => cat.id))
  const importedMessages = JSON.parse(JSON.stringify(importedData.messages))
  const orphanedMessages = importedMessages.filter(
    msg => !definedCategoryIds.has(msg.categoryId)
  )

  const categoriesToDisplay = [...importedData.categories]

  if (orphanedMessages.length > 0) {
    const orphanCatId = 'orphan-import-group'
    const orphanCategory = {
      id: orphanCatId,
      name: 'Trâmites Órfãos (Sem Categoria no Arquivo)'
    }
    categoriesToDisplay.push(orphanCategory)
    orphanedMessages.forEach(msg => (msg.categoryId = orphanCatId))
  }

  if (importedMessages.length === 0) {
    showNotification('O arquivo não contém trâmites para importar.', 'info')
    return
  }

  let selectionHtml = '<div class="import-selection-list">'

  categoriesToDisplay.forEach(importedCategory => {
    const messagesInCategory = importedMessages
      .filter(msg => msg.categoryId === importedCategory.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0))

    if (messagesInCategory.length === 0) return

    const existingCategoryMatch = currentData.categories.find(
      c => c.name.toLowerCase() === importedCategory.name.toLowerCase()
    )

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

    const createNewSelected =
      !existingCategoryMatch || currentData.categories.length === 0
        ? 'selected'
        : ''
    destinationOptions += `<option value="--create-new--" ${createNewSelected}>Criar nova categoria "${escapeHTML(
      importedCategory.name
    )}"</option>`

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

  const onSave = async (modalBody, closeModal) => {
    const tasks = _getImportTasks(modalBody)
    if (tasks.length === 0) {
      showNotification('Nenhum trâmite foi selecionado.', 'info')
      return
    }

    const dataToSave = await getStoredData()
    const importedCount = _applyImportTasksToData(dataToSave, tasks)

    if (importedCount > 0) {
      await saveStoredData(dataToSave)
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
