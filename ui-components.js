/**
 * @file ui-components.js
 * @description Funções para criar e gerenciar componentes de UI (Modais, Pickers, Diálogos, Painel de Anotações).
 */

// --- ESTADO GLOBAL DO MÓDULO ---
let saveNotesTimeout // Timeout para debouncing do salvamento de anotações
let notesDataCache = null // Cache dos dados das anotações para evitar múltiplas leituras

// --- FUNÇÕES UTILITÁRIAS DE UI ---

/**
 * Cria um modal genérico. Não fecha ao clicar fora (no backdrop).
 * @param {string} title - Título do modal.
 * @param {string} contentHtml - Conteúdo HTML do corpo do modal.
 * @param {function(HTMLElement, Function): void | null} onSave - Callback executado ao salvar. Null se não houver botão de salvar.
 * @param {boolean} isManagementModal - Se é o modal de gerenciamento (muda os botões).
 * @param {string | null} modalId - ID opcional para o modal.
 * @returns {HTMLDivElement} O elemento modal criado.
 */
function createModal(
  title,
  contentHtml,
  onSave,
  isManagementModal = false,
  modalId = null
) {
  const modal = document.createElement('div')
  modal.className = 'editor-modal'

  if (modalId) {
    modal.id = modalId
  }

  applyCurrentTheme(modal)

  let buttonsHtml = ''
  if (isManagementModal) {
    buttonsHtml =
      (onSave
        ? `<button type="button" id="modal-save-btn" class="action-btn">Salvar Alterações</button>`
        : '') +
      `<button type="button" id="modal-cancel-btn" class="action-btn">Fechar</button>`
  } else {
    buttonsHtml = `<button type="button" id="modal-save-btn" class="action-btn">Salvar</button><button type="button" id="modal-cancel-btn" class="action-btn">Cancelar</button>`
  }

  modal.innerHTML = `
        <div class="se-modal-content">
            <div class="se-modal-header"><h3>${escapeHTML(
              title
            )}</h3><button type="button" class="se-close-modal-btn" title="Fechar">&times;</button></div>
            <div class="se-modal-body">${contentHtml}</div>
            <div class="se-modal-actions">${buttonsHtml}</div>
        </div>
    `

  const closeModal = () => {
    if (document.body.contains(modal)) {
      document.body.removeChild(modal)
    }
  }

  const saveBtn = modal.querySelector('#modal-save-btn')
  if (onSave && saveBtn) {
    saveBtn.addEventListener('click', e => {
      e.preventDefault()
      onSave(modal.querySelector('.se-modal-body'), closeModal)
    })
  }

  const cancelBtn = modal.querySelector('#modal-cancel-btn')
  if (cancelBtn) {
    cancelBtn.onclick = e => {
      e.preventDefault()
      closeModal()
    }
  }

  const closeBtn = modal.querySelector('.se-close-modal-btn')
  if (closeBtn) {
    closeBtn.onclick = e => {
      e.preventDefault()
      closeModal()
    }
  }

  return modal
}

/**
 * Exibe uma notificação (toast) no canto superior direito.
 */
function showNotification(message, type = 'info', duration = 3000) {
  let container = document.getElementById('notification-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'notification-container'
    document.body.appendChild(container)
  }

  const notification = document.createElement('div')
  notification.className = `editor-notification ${type}`

  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️'
  }

  notification.innerHTML = `
    <span class="notification-icon">${icons[type] || icons['info']}</span>
    <span>${escapeHTML(message)}</span>
  `

  container.appendChild(notification)

  setTimeout(() => {
    notification.classList.add('fade-out')
    setTimeout(() => {
      if (container.contains(notification)) {
        container.removeChild(notification)
      }
    }, 500)
  }, duration - 500)
}

/**
 * Exibe um diálogo de confirmação simples.
 */
function showConfirmDialog(message, onConfirm) {
  const dialog = createModal(
    'Confirmação',
    `<p>${message}</p>`,
    (content, closeModal) => {
      onConfirm()
      closeModal()
    }
  )
  const saveBtn = dialog.querySelector('#modal-save-btn')
  if (saveBtn) saveBtn.textContent = 'Confirmar'
  document.body.appendChild(dialog)
}

// --- GERENCIAMENTO DE LEMBRETES (UI) ---

/**
 * Abre o modal para criar um novo lembrete ou editar um existente.
 */
function openNewReminderModal(existingReminder = null) {
  const isEditing = existingReminder !== null

  const now = new Date()
  const minDateTime = getLocalDateTimeString(now)

  let defaultDateTime
  if (isEditing) {
    const originalDate = new Date(existingReminder.dateTime)
    if (originalDate < now) {
      const defaultTime = new Date(now.getTime() + 60 * 60 * 1000)
      defaultDateTime = getLocalDateTimeString(defaultTime)
    } else {
      defaultDateTime = getLocalDateTimeString(originalDate)
    }
  } else {
    const defaultTime = new Date(now.getTime() + 60 * 60 * 1000)
    defaultDateTime = getLocalDateTimeString(defaultTime)
  }

  const titleValue = isEditing ? existingReminder.title : ''
  const descriptionValue = isEditing ? existingReminder.description || '' : ''

  const currentPageUrl = window.location.href
  let initialUrl = ''

  if (isEditing) {
    initialUrl = existingReminder.url || ''
  } else {
    initialUrl = currentPageUrl
  }

  const isUrlIncluded = initialUrl !== ''

  const modal = createModal(
    `${isEditing ? 'Editar' : 'Novo'} Lembrete 📅`,
    `
     <div class="form-group">
        <label for="reminder-title">Título*</label>
        <input type="text" id="reminder-title" placeholder="Ex: Retornar ligação do cliente X" value="${escapeHTML(
          titleValue
        )}" required>
     </div>
     <div class="form-group">
        <label for="reminder-datetime">Data e Hora do Alerta*</label>
        <input type="datetime-local" id="reminder-datetime" min="${minDateTime}" value="${defaultDateTime}" required>
     </div>
     <div class="form-group">
        <label for="reminder-description">Descrição (Opcional)</label>
        <textarea id="reminder-description" placeholder="Detalhes sobre o lembrete..." rows="3" style="min-height: 80px;">${escapeHTML(
          descriptionValue
        )}</textarea>
     </div>
     
     <div class="form-group url-group">
        <label for="reminder-url">URL do Chamado (SGD)</label>
        <input type="text" id="reminder-url" placeholder="https://sgd.dominiosistemas.com.br/..." value="${escapeHTML(
          initialUrl
        )}">
        
        <div class="form-checkbox-group">
            <input type="checkbox" id="reminder-include-url" ${
              isUrlIncluded ? 'checked' : ''
            }>
            <label for="reminder-include-url">Incluir link do chamado no alerta</label>
        </div>
     </div>
    `,
    async (modalContent, closeModal) => {
      const title = modalContent.querySelector('#reminder-title').value.trim()
      const dateTime = modalContent.querySelector('#reminder-datetime').value
      const description = modalContent
        .querySelector('#reminder-description')
        .value.trim()

      const urlInput = modalContent.querySelector('#reminder-url')
      const url = urlInput.value.trim()

      if (!title || !dateTime) {
        showNotification('Título e Data/Hora são obrigatórios.', 'error')
        return
      }

      if (url && !isValidUrl(url)) {
        showNotification(
          'URL inválida ou insegura. Verifique o link do chamado.',
          'error'
        )
        return
      }

      const dataToSave = {
        title,
        dateTime,
        description,
        url
      }

      if (isEditing) {
        dataToSave.id = existingReminder.id
        dataToSave.createdAt = existingReminder.createdAt
      }

      try {
        await saveReminder(dataToSave)
        showNotification(
          `Lembrete ${isEditing ? 'atualizado' : 'agendado'} com sucesso!`,
          'success'
        )
        closeModal()

        const managementModal = document.getElementById(
          'reminders-management-modal'
        )
        if (managementModal) {
          renderRemindersList(managementModal)
        }
      } catch (error) {
        showNotification(`Erro ao agendar: ${error.message}`, 'error')
      }
    }
  )

  document.body.appendChild(modal)

  const checkbox = modal.querySelector('#reminder-include-url')
  const urlInput = modal.querySelector('#reminder-url')

  let storedUrl = initialUrl

  const toggleUrlField = () => {
    if (checkbox.checked) {
      urlInput.disabled = false
      if (!urlInput.value) {
        urlInput.value = storedUrl || currentPageUrl
      }
    } else {
      if (urlInput.value) {
        storedUrl = urlInput.value
      }
      urlInput.disabled = true
      urlInput.value = ''
    }
  }

  checkbox.addEventListener('change', toggleUrlField)

  toggleUrlField()
}

/**
 * Abre o modal de gerenciamento de lembretes agendados e configurações.
 */
async function openRemindersManagementModal() {
  const settings = await getSettings()
  const retentionDays = settings.reminderRetentionDays

  const modal = createModal(
    'Gerenciamento de Lembretes ⏳',
    `
        <div class="management-section">
            <h4>Lembretes Ativos e Recentes</h4>
            <p>Gerencie seus lembretes. Lembretes disparados ficam visíveis pelo período configurado abaixo.</p>
            
            <div id="bulk-actions-container" style="display: none;">
                <span id="selected-count-info"></span>
                <button type="button" id="bulk-delete-btn" class="action-btn delete-cat-btn small-btn" disabled>Excluir Selecionados</button>
            </div>

            <div id="reminders-list" class="category-list"></div>
        </div>

        <div class="management-section">
             <div class="reminder-settings-form">
                <label for="retention-days">Remover automaticamente lembretes disparados após:</label>
                <input type="number" id="retention-days" min="1" max="30" value="${retentionDays}">
                <span>dias</span>
                <button type="button" id="save-retention-btn" class="action-btn save-cat-btn">Salvar</button>
            </div>
        </div>
        `,
    null,
    true,
    'reminders-management-modal'
  )

  const actionsContainer = modal.querySelector('.se-modal-actions')
  if (actionsContainer) {
    const newReminderBtn = document.createElement('button')
    newReminderBtn.type = 'button'
    newReminderBtn.className = 'action-btn add-message-btn'
    newReminderBtn.textContent = '📅 Novo Lembrete'
    newReminderBtn.title = 'Agendar um novo lembrete'
    newReminderBtn.style.marginRight = 'auto'

    newReminderBtn.addEventListener('click', e => {
      e.preventDefault()
      openNewReminderModal()
    })

    actionsContainer.insertBefore(newReminderBtn, actionsContainer.firstChild)
  }

  document.body.appendChild(modal)

  setupReminderManagementListeners(modal)

  await renderRemindersList(modal)
}

/**
 * Configura os listeners para a seção de configurações e ações em massa.
 */
function setupReminderManagementListeners(modal) {
  const saveBtn = modal.querySelector('#save-retention-btn')
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const input = modal.querySelector('#retention-days')
      const days = parseInt(input.value, 10)

      if (isNaN(days) || days < 1 || days > 30) {
        showNotification(
          'Por favor, insira um valor entre 1 e 30 dias.',
          'error'
        )
        return
      }

      try {
        await saveSettings({ reminderRetentionDays: days })
        showNotification('Configurações de retenção salvas.', 'success')
        await renderRemindersList(modal)
      } catch (error) {
        showNotification(
          `Erro ao salvar configurações: ${error.message}`,
          'error'
        )
      }
    })
  }

  const bulkDeleteBtn = modal.querySelector('#bulk-delete-btn')
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
      const checkedItems = modal.querySelectorAll(
        '#reminders-list .reminder-checkbox:checked'
      )
      if (checkedItems.length === 0) return

      const idsToDelete = Array.from(checkedItems).map(cb => cb.dataset.id)

      showConfirmDialog(
        `Tem certeza que deseja excluir ${idsToDelete.length} lembrete(s) selecionado(s)?`,
        async () => {
          try {
            await deleteMultipleReminders(idsToDelete)
            showNotification(
              `${idsToDelete.length} lembrete(s) excluído(s).`,
              'success'
            )
            await renderRemindersList(modal)
          } catch (error) {
            showNotification('Erro durante a exclusão em massa.', 'error')
          }
        }
      )
    })
  }
}

/**
 * Atualiza a visibilidade e o estado dos controles de ação em massa.
 */
function updateBulkActionsState(modal) {
  const bulkActionsContainer = modal.querySelector('#bulk-actions-container')
  const bulkDeleteBtn = modal.querySelector('#bulk-delete-btn')
  const selectedCountInfo = modal.querySelector('#selected-count-info')

  const firedRemindersExist =
    modal.querySelectorAll('#reminders-list .fired-reminder').length > 0
  const checkedItemsCount = modal.querySelectorAll(
    '#reminders-list .reminder-checkbox:checked'
  ).length

  if (firedRemindersExist) {
    bulkActionsContainer.style.display = 'flex'
  } else {
    bulkActionsContainer.style.display = 'none'
  }

  bulkDeleteBtn.disabled = checkedItemsCount === 0
  selectedCountInfo.textContent =
    checkedItemsCount > 0
      ? `${checkedItemsCount} selecionados`
      : firedRemindersExist
      ? 'Selecione lembretes disparados para excluir'
      : ''
}

/**
 * Renderiza a lista de lembretes ativos e disparados no modal de gerenciamento.
 */
async function renderRemindersList(modal) {
  const list = modal.querySelector('#reminders-list')
  list.innerHTML = 'Carregando...'

  const remindersMap = await getReminders()

  const reminders = Object.values(remindersMap).sort((a, b) => {
    if (a.isFired && !b.isFired) return 1
    if (!a.isFired && b.isFired) return -1
    if (a.isFired) {
      return (b.firedAt || 0) - (a.firedAt || 0)
    } else {
      return new Date(a.dateTime) - new Date(b.dateTime)
    }
  })

  if (reminders.length === 0) {
    list.innerHTML =
      '<p style="text-align: center; color: var(--text-color-muted); padding: 20px 0;">Nenhum lembrete ativo ou recente.</p>'
    updateBulkActionsState(modal)
    return
  }

  list.innerHTML = ''

  reminders.forEach(reminder => {
    const item = document.createElement('div')
    item.className = `category-item reminder-item ${
      reminder.isFired ? 'fired-reminder' : ''
    }`
    item.dataset.id = reminder.id

    let statusDisplayHtml = ''
    let actionsHtml = ''
    let icon = '⏰'
    let checkboxHtml = ''

    if (reminder.isFired) {
      icon = '✅'
      checkboxHtml = `<input type="checkbox" class="reminder-checkbox" data-id="${reminder.id}" title="Selecionar para exclusão em massa">`

      const firedTime = new Date(reminder.firedAt)
      const formattedFiredTime = firedTime.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      })

      const today = new Date().toDateString()
      const firedDay = firedTime.toDateString()

      let dayPrefix = 'Hoje'
      if (today !== firedDay) {
        dayPrefix = firedTime.toLocaleDateString('pt-BR')
      }

      statusDisplayHtml = `<span class="shortcut-display">Disparado ${dayPrefix} às ${formattedFiredTime}</span>`

      if (reminder.url && isValidUrl(reminder.url)) {
        actionsHtml += `<a href="${escapeHTML(
          reminder.url
        )}" target="_blank" class="action-btn open-link-btn" title="Abrir Chamado Vinculado">🔗</a>`
      }

      actionsHtml += `
                <button type="button" class="action-btn edit-reminder-btn reschedule-btn" title="Reagendar este lembrete">🔄️</button>
                <button type="button" class="action-btn dismiss-now-btn" title="Remover da lista agora">Dispensar</button>
            `
    } else {
      const dateTime = new Date(reminder.dateTime)
      const formattedDate = dateTime.toLocaleDateString('pt-BR')
      const formattedTime = dateTime.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      })

      statusDisplayHtml = `<span class="shortcut-display">${formattedDate} às ${formattedTime}</span>`
      actionsHtml = `
                <button type="button" class="action-btn edit-reminder-btn" title="Editar/Reagendar">✏️</button>
                <button type="button" class="action-btn delete-cat-btn delete-reminder-btn" title="Cancelar Lembrete">🗑️</button>
            `
    }

    item.innerHTML = `
            ${checkboxHtml}
            <span class="reminder-icon">${icon}</span>
            <div class="reminder-details">
                <span class="category-name">${escapeHTML(reminder.title)}</span>
                <span class="reminder-description">${escapeHTML(
                  reminder.description || ''
                )}</span>
            </div>
            ${statusDisplayHtml}
            <div class="reminder-actions-container">
                ${actionsHtml}
            </div>
        `

    const checkbox = item.querySelector('.reminder-checkbox')
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        updateBulkActionsState(modal)
      })
    }

    const deleteBtn = item.querySelector('.delete-reminder-btn')
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async e => {
        e.preventDefault()
        showConfirmDialog(
          `Cancelar o lembrete "${escapeHTML(reminder.title)}"?`,
          async () => {
            await handleDeleteReminder(reminder.id, modal)
          }
        )
      })
    }

    const editBtn = item.querySelector('.edit-reminder-btn')
    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.preventDefault()
        openNewReminderModal(reminder)
      })
    }

    const dismissBtn = item.querySelector('.dismiss-now-btn')
    if (dismissBtn) {
      dismissBtn.addEventListener('click', async e => {
        e.preventDefault()
        await handleDeleteReminder(reminder.id, modal)
      })
    }

    list.appendChild(item)
  })

  updateBulkActionsState(modal)
}

/**
 * Função auxiliar para lidar com a exclusão/dispensa de lembretes no modal de gerenciamento.
 */
async function handleDeleteReminder(reminderId, modal) {
  try {
    await deleteReminder(reminderId)
    showNotification('Lembrete removido.', 'success')
    await renderRemindersList(modal)
  } catch (error) {
    showNotification('Erro ao remover lembrete.', 'error')
  }
}

// --- PICKERS (Seletores de Cor e Emoji) ---

function setupPickerHover(editorContainer, actionName, pickerId) {
  const button = editorContainer.querySelector(`[data-action="${actionName}"]`)
  const picker = document.getElementById(pickerId)
  if (!button || !picker) return

  const show = () => {
    clearTimeout(pickerHideTimeout)
    document
      .querySelectorAll('.picker')
      .forEach(p => (p.style.display = 'none'))

    picker.style.display = 'grid'
    const buttonRect = button.getBoundingClientRect()
    const containerRect = editorContainer.getBoundingClientRect()
    picker.style.top = `${buttonRect.bottom - containerRect.top + 5}px`
    picker.style.left = `${buttonRect.left - containerRect.left}px`

    const pickerRect = picker.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    if (pickerRect.right > viewportWidth) {
      const newLeft = buttonRect.right - containerRect.left - pickerRect.width
      picker.style.left = `${Math.max(5, newLeft)}px`
    }
  }

  const hide = () => {
    pickerHideTimeout = setTimeout(() => {
      picker.style.display = 'none'
    }, 300)
  }

  button.addEventListener('mouseover', show)
  button.addEventListener('mouseout', hide)
  picker.addEventListener('mouseover', () => clearTimeout(pickerHideTimeout))
  picker.addEventListener('mouseout', hide)
}

function createColorPicker(pickerElement, onColorSelect) {
  pickerElement.innerHTML = PICKER_COLORS.map(
    color =>
      `<button type="button" class="color-swatch" style="background-color:${color};" data-color="${color}"></button>`
  ).join('')

  pickerElement.addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch')
    if (swatch) {
      e.stopPropagation()
      e.preventDefault()
      onColorSelect(swatch.dataset.color)
      pickerElement.style.display = 'none'
    }
  })
}

function createEmojiPicker(pickerElement, onEmojiSelect) {
  pickerElement.innerHTML = PICKER_EMOJIS.map(emoji => {
    const safeEmojiCode = emoji.code.replace('&', '&amp;')
    return `<button 
                    type="button" 
                    class="emoji-swatch" 
                    title="${emoji.char}" 
                    data-code="<nobr style='font-size:17px;'>${safeEmojiCode}</nobr>"
                >${emoji.char}</button>`
  }).join('')

  pickerElement.addEventListener('click', e => {
    const swatch = e.target.closest('.emoji-swatch')
    if (swatch) {
      e.stopPropagation()
      e.preventDefault()
      const emojiHtmlToInsert = swatch.dataset.code
      if (emojiHtmlToInsert) {
        onEmojiSelect(emojiHtmlToInsert)
      }
      pickerElement.style.display = 'none'
    }
  })
}

// --- PAINEL DE ANOTAÇÕES (SISTEMA DE BLOCOS) ---

/**
 * Renderiza todos os blocos de anotações na UI.
 * Adicionado um botão de edição (lápis) ao lado do título.
 */
function renderNotesBlocks() {
  const container = document.getElementById('notes-list-container')
  if (!container || !notesDataCache) return

  container.innerHTML = ''
  const fragment = document.createDocumentFragment()

  notesDataCache.blocks.forEach(block => {
    const blockEl = document.createElement('div')
    blockEl.className = 'note-block'
    blockEl.dataset.blockId = block.id

    if (block.id === notesDataCache.activeBlockId) {
      blockEl.classList.add('active')
    }

    blockEl.innerHTML = `
            <div class="note-block-header" title="Clique para expandir, clique duplo no título ou no lápis para renomear.">
                <span class="note-title">${escapeHTML(block.title)}</span>
                <button type="button" class="edit-title-btn" title="Editar Título">✏️</button>
                <div class="note-block-actions">
                    <button type="button" class="delete-note-btn" title="Excluir Bloco">&times;</button>
                </div>
            </div>
            <div class="note-block-content">
                <textarea placeholder="Conteúdo do bloco...">${escapeHTML(
                  block.content
                )}</textarea>
            </div>
        `
    fragment.appendChild(blockEl)
  })

  container.appendChild(fragment)
}

/**
 * Cria a estrutura HTML do painel de anotações e a anexa ao body.
 */
function createNotesPanel() {
  if (document.getElementById('notes-side-panel')) return

  const panel = document.createElement('div')
  panel.id = 'notes-side-panel'
  panel.innerHTML = `
        <div class="notes-panel-header">
            <h4>Anotações Rápidas</h4>
            <button type="button" class="notes-panel-close-btn" title="Fechar Painel">&times;</button>
        </div>
        <div class="notes-panel-body" id="notes-list-container"></div>
        <div class="notes-panel-footer">
            <button type="button" id="add-note-block-btn" class="action-btn">Adicionar Bloco</button>
        </div>
    `
  document.body.appendChild(panel)
  applyCurrentTheme(panel)

  panel
    .querySelector('.notes-panel-close-btn')
    .addEventListener('click', toggleNotesPanel)
  document
    .getElementById('add-note-block-btn')
    .addEventListener('click', handleAddNoteBlock)

  const listContainer = document.getElementById('notes-list-container')
  listContainer.addEventListener('input', handleAutoSave)
  listContainer.addEventListener('click', handleBlockClick)
  listContainer.addEventListener('dblclick', handleTitleRenameStart)
}

/**
 * Alterna a visibilidade do painel de anotações.
 */
function toggleNotesPanel() {
  const panel = document.getElementById('notes-side-panel')
  if (panel) {
    panel.classList.toggle('visible')
  }
}

/**
 * Lida com o salvamento automático do conteúdo de um bloco.
 */
function handleAutoSave(e) {
  if (e.target.tagName !== 'TEXTAREA') return

  clearTimeout(saveNotesTimeout)
  const blockEl = e.target.closest('.note-block')
  if (!blockEl || !notesDataCache) return

  const blockId = blockEl.dataset.blockId
  const newContent = e.target.value

  saveNotesTimeout = setTimeout(() => {
    const block = notesDataCache.blocks.find(b => b.id === blockId)
    if (block && block.content !== newContent) {
      block.content = newContent
      saveNotes(notesDataCache)
    }
  }, 750)
}

/**
 * Adiciona um novo bloco de anotações.
 */
async function handleAddNoteBlock() {
  if (!notesDataCache) return
  _exitAllTitleEditModes()

  const newBlockId = `note-${Date.now()}`
  const newBlock = {
    id: newBlockId,
    title: `Novo Bloco ${notesDataCache.blocks.length + 1}`,
    content: ''
  }

  notesDataCache.blocks.push(newBlock)
  notesDataCache.activeBlockId = newBlockId

  await saveNotes(notesDataCache)
  renderNotesBlocks()
}

/**
 * Função central para lidar com cliques nos blocos.
 * Agora também verifica cliques no novo botão de editar.
 */
function handleBlockClick(e) {
  const editBtn = e.target.closest('.edit-title-btn')
  const deleteBtn = e.target.closest('.delete-note-btn')
  const header = e.target.closest('.note-block-header')

  if (editBtn) {
    e.stopPropagation()
    const titleEl = header.querySelector('.note-title')
    if (titleEl) {
      startTitleEdit(titleEl)
    }
  } else if (deleteBtn) {
    e.stopPropagation()
    const blockEl = e.target.closest('.note-block')
    const block = notesDataCache.blocks.find(
      b => b.id === blockEl.dataset.blockId
    )
    showConfirmDialog(
      `Tem certeza que deseja excluir o bloco "${escapeHTML(block.title)}"?`,
      async () => {
        notesDataCache.blocks = notesDataCache.blocks.filter(
          b => b.id !== block.id
        )
        if (
          notesDataCache.activeBlockId === block.id &&
          notesDataCache.blocks.length > 0
        ) {
          notesDataCache.activeBlockId = notesDataCache.blocks[0].id
        } else if (notesDataCache.blocks.length === 0) {
          notesDataCache.activeBlockId = null
        }
        await saveNotes(notesDataCache)
        renderNotesBlocks()
      }
    )
  } else if (header && !header.classList.contains('is-editing')) {
    const blockEl = header.closest('.note-block')
    document
      .querySelectorAll('#notes-list-container .note-block')
      .forEach(el => {
        if (el !== blockEl) el.classList.remove('active')
      })
    blockEl.classList.toggle('active')
    notesDataCache.activeBlockId = blockEl.classList.contains('active')
      ? blockEl.dataset.blockId
      : null
    saveNotes(notesDataCache)
  }
}

/**
 * Inicia a renomeação do título de um bloco com duplo clique.
 */
function handleTitleRenameStart(e) {
  const titleEl = e.target.closest('.note-title')
  if (titleEl) {
    startTitleEdit(titleEl)
  }
}

/**
 * Função auxiliar para entrar no modo de edição do título.
 */
function startTitleEdit(titleEl) {
  _exitAllTitleEditModes()

  const header = titleEl.closest('.note-block-header')
  header.classList.add('is-editing')
  titleEl.contentEditable = true
  titleEl.focus()

  const range = document.createRange()
  range.selectNodeContents(titleEl)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)

  titleEl.addEventListener('keydown', handleTitleKeydown)
  titleEl.addEventListener('blur', handleTitleBlur)
}

/**
 * Lida com eventos de teclado durante a edição do título.
 */
function handleTitleKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.target.blur()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    const titleEl = e.target
    const blockId = titleEl.closest('.note-block').dataset.blockId
    const originalTitle = notesDataCache.blocks.find(
      b => b.id === blockId
    )?.title
    titleEl.textContent = originalTitle
    titleEl.blur()
  }
}

/**
 * Lida com o evento de saída de foco (blur) durante a edição do título.
 */
function handleTitleBlur(e) {
  const titleEl = e.target
  const newTitle = titleEl.textContent.trim()
  const blockId = titleEl.closest('.note-block').dataset.blockId

  titleEl.removeEventListener('keydown', handleTitleKeydown)
  titleEl.removeEventListener('blur', handleTitleBlur)

  const block = notesDataCache.blocks.find(b => b.id === blockId)

  if (block) {
    if (newTitle && newTitle !== block.title) {
      block.title = newTitle
      saveNotes(notesDataCache)
    } else if (!newTitle) {
      titleEl.textContent = block.title
    }
  }

  titleEl.contentEditable = false
  const header = titleEl.closest('.note-block-header')
  if (header) {
    header.classList.remove('is-editing')
  }
}

/**
 * Função auxiliar para garantir que todos os modos de edição de título sejam finalizados.
 */
function _exitAllTitleEditModes() {
  document
    .querySelectorAll(
      '#notes-list-container .note-title[contenteditable="true"]'
    )
    .forEach(el => {
      el.blur()
    })
}

/**
 * Inicializa o painel de anotações (cria a estrutura e carrega os dados).
 */
async function initializeNotesPanel() {
  createNotesPanel()
  notesDataCache = await getSavedNotes()
  renderNotesBlocks()
}
