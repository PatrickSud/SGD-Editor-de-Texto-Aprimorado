/**
 * @file ui-components.js
 * Funções para criar e gerenciar componentes de UI (Modais, Pickers, Diálogos, Painel de Anotações)
 */

let saveNotesTimeout
let notesDataCache = null

/**
 * Cria o HTML para um card de lembrete com o novo estilo moderno.
 * @param {object} reminder - O objeto do lembrete.
 * @param {string} type - O tipo de lembrete ('active', 'pending', 'acknowledged').
 * @returns {string} O HTML do card.
 */
function createReminderCardHtml(reminder, type) {
  const priorityClass = `priority-${reminder.priority || 'medium'}`
  const hasUrl = reminder.url && isValidUrl(reminder.url)
  const hasDescription =
    reminder.description && reminder.description.trim() !== ''

  // A lógica dos botões permanece a mesma
  const openUrlButton = hasUrl
    ? `<button class="action-btn secondary" data-action="open-url" title="Abrir Link">🔗</button>`
    : ''
  const removeButton = `<button class="action-btn destructive" data-action="remove" title="Remover">🗑️</button>`
  const editButton = `<button class="action-btn secondary" data-action="edit" title="Editar">✏️</button>`
  const completeButton = `<button class="action-btn primary" data-action="complete" title="Concluir">✅</button>`
  const snoozeButton = `<button class="action-btn primary" data-action="snooze" title="Adiar">⏰</button>`
  let actionsHtml = ''

  let statusText = ''
  const historyText =
    reminder.snoozeCount > 0 ? `(Adiado ${reminder.snoozeCount}x)` : ''

  switch (type) {
    case 'active':
      statusText = `Para ${new Date(reminder.dateTime).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })}`
      actionsHtml = openUrlButton + editButton + removeButton
      break
    case 'pending':
      statusText = `Desde ${new Date(reminder.firedAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })}`
      actionsHtml =
        openUrlButton +
        completeButton +
        snoozeButton +
        editButton +
        removeButton
      break
    case 'acknowledged':
      statusText = `Em ${new Date(reminder.firedAt).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })}`
      actionsHtml = openUrlButton + editButton + removeButton
      break
  }

  // ESTRUTURA ATUALIZADA: Descrição movida para o seu próprio container de conteúdo.
  return `
    <div class="reminder-card ${priorityClass} ${type}" data-id="${
    reminder.id
  }">
      <div class="card-header">
        <div class="card-header-main">
          <h5 class="card-title">${escapeHTML(reminder.title)}</h5>
          <div class="card-details-row">
            <span class="card-status">${statusText}</span>
            <span class="card-history">${historyText}</span>
          </div>
        </div>
        <div class="card-actions">${actionsHtml}</div>
      </div>
      ${
        hasDescription
          ? `
      <div class="card-content">
        <p class="description-snippet">${escapeHTML(reminder.description)}</p>
      </div>
      `
          : ''
      }
    </div>`
}

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

  // Foca o primeiro botão ou input para acessibilidade
  requestAnimationFrame(() => {
    const focusable = modal.querySelector('button, input, textarea, select')
    if (focusable) {
      focusable.focus()
    }
  })

  return modal
}

/**
 * Exibe uma notificação (toast) no canto superior direito.
 * Adicionada a opção de um callback `onClick`.
 */
function showNotification(
  message,
  type = 'info',
  duration = 3000,
  onClick = null
) {
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
    info: 'ℹ️',
    suggestion: '💡' // Ícone para sugestões
  }

  notification.innerHTML = `
    <span class="notification-icon">${icons[type] || icons['info']}</span>
    <span>${escapeHTML(message)}</span>
  `

  if (onClick) {
    notification.style.cursor = 'pointer'
    notification.title = 'Clique para ver'
    notification.addEventListener('click', () => {
      onClick()
      // Remove a notificação imediatamente após o clique.
      if (container.contains(notification)) {
        container.removeChild(notification)
      }
    })
  }

  container.appendChild(notification)

  // Apenas auto-remove se não for clicável ou se a duração for especificada
  if (duration > 0) {
    setTimeout(() => {
      notification.classList.add('fade-out')
      setTimeout(() => {
        if (container.contains(notification)) {
          container.removeChild(notification)
        }
      }, 500)
    }, duration - 500)
  }
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

/**
 * Exibe um modal informativo simples, apenas com botão de fechar.
 */
function showInfoModal(title, contentHtml) {
  const infoModal = createModal(
    title,
    contentHtml,
    null, // Sem botão de salvar
    true // Usa o layout com botão "Fechar"
  )
  document.body.appendChild(infoModal)
}

/**
 * Exibe um modal com instruções para inserir imagem via área de transferência.
 */
function showImagePasteModal() {
  const title = 'Inserir Imagem'
  const content = `
    <div class="image-paste-instructions">
      <div class="instruction-icon">🖼️</div>
      <h4>Como inserir uma imagem:</h4>
      <ol>
        <li>Copie uma imagem para a área de transferência <kbd>Ctrl+C</kbd></li>
        <li>Posicione o cursor no editor onde deseja inserir a imagem</li>
        <li>Pressione <kbd>Ctrl+V</kbd> para colar a imagem</li>
      </ol>
      <p class="note">A imagem será inserida no texto conforme o tamanho selecionado.</p>
    </div>
  `
  showInfoModal(title, content)
}

/**
 * Abre um modal para inserir imagem com opções de colar ou upload de arquivo.
 * @param {HTMLTextAreaElement} textArea - O textarea onde a imagem será inserida.
 */
function openImageUploadModal(textArea) {
  const title = 'Inserir Imagem'
  const content = `
    <div class="image-upload-modal-content">
      <div class="upload-instructions">
        <h4>Como inserir uma imagem:</h4>
        <div class="upload-option">
          <div class="option-icon">📋</div>
          <div class="option-content">
            <p><strong>Opção 1:</strong> Cole a imagem da área de transferência</p>
            <p class="instruction-text">Posicione o cursor no editor e pressione <kbd>Ctrl+V</kbd></p>
          </div>
        </div>
        
        <div class="upload-option">
          <div class="option-icon">📁</div>
          <div class="option-content">
            <p><strong>Opção 2:</strong> Selecione um arquivo do computador</p>
            <div class="file-input-container">
              <label for="image-upload-input" class="file-input-label">
                <span class="file-input-text">Escolher arquivo...</span>
                <input type="file" id="image-upload-input" accept="image/*" style="display: none;">
              </label>
            </div>
          </div>
        </div>
      </div>
      
      <div class="upload-preview-container" id="upload-preview-container" style="display: none;">
        <h4>Pré-visualização:</h4>
        <img id="upload-preview" class="upload-preview-image" alt="Pré-visualização da imagem">
      </div>
    </div>
  `

  const modal = createModal(
    title,
    content,
    null // Sem botão de salvar, apenas fechar
  )

  // Adiciona listener para upload de arquivo
  const fileInput = modal.querySelector('#image-upload-input')
  const previewContainer = modal.querySelector('#upload-preview-container')
  const previewImage = modal.querySelector('#upload-preview')

  fileInput.addEventListener('change', event => {
    const file = event.target.files[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = function (e) {
        const imageDataUrl = e.target.result

        // Mostra pré-visualização
        previewImage.src = imageDataUrl
        previewContainer.style.display = 'block'

        // Fecha o modal atual e abre o modal de redimensionamento
        modal.remove()
        openImageSizeModal(textArea, imageDataUrl)
      }
      reader.readAsDataURL(file)
    }
  })

  document.body.appendChild(modal)
}

/**
 * Abre um modal para redimensionar uma imagem antes de inserir no editor.
 * @param {HTMLTextAreaElement} textArea - O textarea onde a imagem será inserida.
 * @param {string} imageDataUrl - A URL de dados da imagem em Base64.
 */
function openImageSizeModal(textArea, imageDataUrl) {
  const title = 'Redimensionar Imagem'
  const content = `
    <div class="image-size-modal-content">
      <div class="image-preview-container">
        <h4>Imagem:</h4>
        <img src="${imageDataUrl}" alt="Pré-visualização da imagem" class="modal-image-preview" id="image-preview">
      </div>
      
      <div class="size-options-container">
        <h4>Escolha o tamanho:</h4>
        <!-- Aplica a classe image-options para centralizar as opções de tamanho -->
        <div class="image-options">
          <div class="image-size-option" data-value="small">
            <h5>Pequena</h5>
            <p>400px</p>
            <input type="radio" name="image-size" value="small" data-size="400" style="display: none;">
          </div>
          <div class="image-size-option active" data-value="medium">
            <h5>Média</h5>
            <p>600px</p>
            <input type="radio" name="image-size" value="medium" data-size="600" checked style="display: none;">
          </div>
          <div class="image-size-option" data-value="large">
            <h5>Grande</h5>
            <p>800px</p>
            <input type="radio" name="image-size" value="large" data-size="800" style="display: none;">
          </div>
          <div class="image-size-option" data-value="custom">
            <h5>Personalizado</h5>
            <p>Custom</p>
            <input type="radio" name="image-size" value="custom" style="display: none;">
          </div>
        </div>
        
        <div class="custom-size-inputs" id="custom-size-inputs" style="display: none;">
          <div class="form-group">
            <label for="custom-width">Largura (px):</label>
            <input type="number" id="custom-width" min="50" max="2000" value="400">
          </div>
          <div class="form-group">
            <label for="custom-height">Altura (px):</label>
            <input type="number" id="custom-height" min="50" max="2000" value="auto">
            <small>Deixe vazio ou 0 para manter proporção</small>
          </div>
        </div>
      </div>
    </div>
  `

  const modal = createModal(title, content, (modalContent, closeModal) => {
    // Captura o tamanho selecionado pelo usuário
    const selectedSize = modalContent.querySelector(
      'input[name="image-size"]:checked'
    ).value
    let imageHtml = ''

    if (selectedSize === 'small') {
      imageHtml = `<img src="${imageDataUrl}" alt="Imagem colada" width="400" height="auto">`
    } else if (selectedSize === 'medium') {
      imageHtml = `<img src="${imageDataUrl}" alt="Imagem colada" width="600" height="auto">`
    } else if (selectedSize === 'large') {
      imageHtml = `<img src="${imageDataUrl}" alt="Imagem colada" width="800" height="auto">`
    } else if (selectedSize === 'custom') {
      const customWidth = modalContent.querySelector('#custom-width').value
      const customHeight = modalContent.querySelector('#custom-height').value

      if (customHeight && customHeight > 0) {
        imageHtml = `<img src="${imageDataUrl}" alt="Imagem colada" width="${customWidth}" height="${customHeight}">`
      } else {
        imageHtml = `<img src="${imageDataUrl}" alt="Imagem colada" width="${customWidth}" height="auto">`
      }
    }

    // Insere a imagem no editor
    insertAtCursor(textArea, imageHtml)
    closeModal()
  })

  // Adiciona listeners para mostrar/ocultar inputs personalizados e gerenciar seleção visual
  const customInputs = modal.querySelector('#custom-size-inputs')
  const sizeOptions = modal.querySelectorAll('input[name="image-size"]')
  const sizeOptionDivs = modal.querySelectorAll('.image-size-option')

  // Adiciona lógica de clique para as novas opções de tamanho
  sizeOptionDivs.forEach(optionDiv => {
    optionDiv.addEventListener('click', () => {
      // Remove a classe active de todas as opções
      sizeOptionDivs.forEach(div => div.classList.remove('active'))

      // Adiciona a classe active à opção clicada
      optionDiv.classList.add('active')

      // Marca o radio button correspondente
      const radioInput = optionDiv.querySelector('input[type="radio"]')
      radioInput.checked = true

      // Mostra/oculta inputs personalizados
      if (radioInput.value === 'custom') {
        customInputs.style.display = 'block'
      } else {
        customInputs.style.display = 'none'
      }
    })
  })

  // Mantém compatibilidade com os listeners originais
  sizeOptions.forEach(option => {
    option.addEventListener('change', () => {
      if (option.value === 'custom') {
        customInputs.style.display = 'block'
      } else {
        customInputs.style.display = 'none'
      }
    })
  })

  document.body.appendChild(modal)
}

/**
 * Exibe um modal com instruções sobre como obter a chave de API do Gemini.
 */
function showHowToGetApiKeyModal() {
  const title = 'Como Obter uma Chave de API do Google Gemini'
  const content = `
    <div class="info-modal-content">
        <p>Para usar os recursos de Inteligência Artificial, você precisa de uma chave de API gratuita do Google AI Studio.</p>
        <ol>
            <li>Acesse o site do <b><a href="https://aistudio.google.com/app" target="_blank">Google AI Studio</a></b> e faça login com sua conta Google.</li>
            <li>Na janela exibida, clique em <b>"Get API key"</b> e aceite os termos.</li>
            <li>Clique em <b>"Create API key"</b> (Criar chave de API).</li>
            <li>Uma chave será gerada (começando com <code>AIzaSy...</code>). Copie essa chave.</li>
            <li>Volte para as configurações da extensão e cole a chave no campo "Chave da API Gemini".</li>
        </ol>
        <p>Sua chave é armazenada de forma segura apenas no seu navegador.</p>
    </div>
  `
  showInfoModal(title, content)
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
  const recurrenceValue = isEditing
    ? existingReminder.recurrence || 'none'
    : 'none'
  const priorityValue = isEditing ? existingReminder.priority || 'low' : 'low'

  const currentPageUrl = window.location.href
  let initialUrl = currentPageUrl
  let isUrlIncluded = false // Checkbox desmarcado por padrão para novos lembretes

  if (isEditing) {
    initialUrl = existingReminder.url || currentPageUrl
    // Marca a caixa apenas se um URL foi salvo anteriormente no lembrete
    isUrlIncluded = !!existingReminder.url
  }

  const modal = createModal(
    `${isEditing ? 'Editar' : 'Novo'} Lembrete 📅`,
    `
     <div class="form-group">
        <label for="reminder-title">Título*</label>
        <input type="text" id="reminder-title" placeholder="Ex: Retornar ligação do cliente X" value="${escapeHTML(
          titleValue
        )}" required>
     </div>
     <div class="form-row">
       <div class="form-group">
          <label for="reminder-datetime">Data e Hora do Alerta*</label>
          <input type="datetime-local" id="reminder-datetime" min="${minDateTime}" value="${defaultDateTime}" required>
       </div>
       <div class="form-group">
          <label for="reminder-priority">Prioridade</label>
          <select id="reminder-priority">
              <option value="low" ${
                priorityValue === 'low' ? 'selected' : ''
              }>Baixa</option>
              <option value="medium" ${
                priorityValue === 'medium' ? 'selected' : ''
              }>Média</option>
              <option value="high" ${
                priorityValue === 'high' ? 'selected' : ''
              }>Alta</option>
          </select>
       </div>
       <div class="form-group">
          <label for="reminder-recurrence">Repetir</label>
          <select id="reminder-recurrence">
              <option value="none" ${
                recurrenceValue === 'none' ? 'selected' : ''
              }>Nunca</option>
              <option value="daily" ${
                recurrenceValue === 'daily' ? 'selected' : ''
              }>Diariamente</option>
              <option value="weekly" ${
                recurrenceValue === 'weekly' ? 'selected' : ''
              }>Semanalmente</option>
              <option value="monthly" ${
                recurrenceValue === 'monthly' ? 'selected' : ''
              }>Mensalmente</option>
          </select>
       </div>
      </div>
     <div class="form-group">
        <label for="reminder-description">Descrição (Opcional)</label>
        <textarea id="reminder-description" placeholder="Detalhes sobre o lembrete..." rows="3" style="min-height: 80px;">${escapeHTML(
          descriptionValue
        )}</textarea>
     </div>
     <div class="form-group url-group">
        <label for="reminder-url">Página atual</label>
        <input type="text" id="reminder-url" placeholder="https://sgd.dominiosistemas.com.br/..." value="${escapeHTML(
          initialUrl
        )}">
        <div class="form-checkbox-group">
            <input type="checkbox" id="reminder-include-url" ${
              isUrlIncluded ? 'checked' : ''
            }>
            <label for="reminder-include-url">Incluir Página atual no lembrete?</label>
        </div>
     </div>
    `,
    async (modalContent, closeModal) => {
      const title = modalContent.querySelector('#reminder-title').value.trim()
      const dateTime = modalContent.querySelector('#reminder-datetime').value
      const description = modalContent
        .querySelector('#reminder-description')
        .value.trim()
      const recurrence = modalContent.querySelector(
        '#reminder-recurrence'
      ).value
      const priority = modalContent.querySelector('#reminder-priority').value
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
        recurrence,
        priority,
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
        
            <div id="reminders-list" class="category-list"></div>
        </div>
        
        <div class="management-section">
             <div class="reminder-settings-form">
                <label for="retention-days">Remover automaticamente lembretes concluídos após:</label>
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
 * Configura os listeners para a seção de configurações.
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
}

/**
 * Renderiza a lista de lembretes no modal de gerenciamento com as seções Pendentes, Ativos e Concluídos.
 */
async function renderRemindersList(modal) {
  const list = modal.querySelector('#reminders-list')
  list.innerHTML = 'Carregando...'

  const remindersData = await getReminders()
  const allReminders = Object.values(remindersData)

  const activeReminders = allReminders
    .filter(r => !r.isFired && !r.firedAt)
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
  const pendingReminders = allReminders
    .filter(r => r.isFired)
    .sort((a, b) => (a.firedAt || 0) - (b.firedAt || 0))
  const acknowledgedReminders = allReminders
    .filter(r => !r.isFired && r.firedAt)
    .sort((a, b) => (b.firedAt || 0) - (a.firedAt || 0))

  if (allReminders.length === 0) {
    list.innerHTML =
      '<p class="empty-reminders-message">Nenhum lembrete para exibir.</p>'
    return
  }

  const pendingHtml =
    pendingReminders.length > 0
      ? `<h6>Pendentes</h6>` +
        pendingReminders.map(r => createReminderCardHtml(r, 'pending')).join('')
      : ''
  const activeHtml =
    activeReminders.length > 0
      ? `<h6>Ativos</h6>` +
        activeReminders.map(r => createReminderCardHtml(r, 'active')).join('')
      : ''
  const acknowledgedHtml =
    acknowledgedReminders.length > 0
      ? `<h6>Concluídos</h6>` +
        acknowledgedReminders
          .map(r => createReminderCardHtml(r, 'acknowledged'))
          .join('')
      : ''

  const sections = [pendingHtml, activeHtml, acknowledgedHtml].filter(Boolean)
  list.innerHTML = sections.join('')

  list.querySelectorAll('.reminder-card').forEach(card => {
    // Lógica de expansão do card
    card.addEventListener('click', e => {
      if (!e.target.closest('button')) {
        // Não expande se o clique for em um botão
        card.classList.toggle('expanded')
      }
    })

    const reminderId = card.dataset.id
    const reminder = allReminders.find(r => r.id === reminderId)
    if (!reminder) return

    card
      .querySelector('[data-action="edit"]')
      ?.addEventListener('click', () => openNewReminderModal(reminder))
    card
      .querySelector('[data-action="snooze"]')
      ?.addEventListener('click', () =>
        openSnoozeModal(reminder, () => renderRemindersList(modal))
      )
    card
      .querySelector('[data-action="remove"]')
      ?.addEventListener('click', () =>
        showConfirmDialog('Remover permanentemente?', async () => {
          await deleteReminder(reminderId)
          renderRemindersList(modal)
        })
      )
    card
      .querySelector('[data-action="open-url"]')
      ?.addEventListener('click', () => window.open(reminder.url, '_blank'))

    card
      .querySelector('[data-action="complete"]')
      ?.addEventListener('click', async () => {
        card.classList.add('completing')
        await new Promise(resolve => setTimeout(resolve, 400)) // Espera a animação

        const reminders = await getReminders()
        const reminderToComplete = reminders[reminderId]
        if (reminderToComplete) {
          reminderToComplete.isFired = false
          reminderToComplete.firedAt = Date.now()

          // Se for recorrente, agenda o próximo
          if (
            reminderToComplete.recurrence &&
            reminderToComplete.recurrence !== 'none'
          ) {
            const nextDateTime = calculateNextRecurrence(
              reminderToComplete.dateTime,
              reminderToComplete.recurrence
            )
            reminderToComplete.dateTime = nextDateTime
            reminderToComplete.isFired = false
            reminderToComplete.firedAt = null
          }

          await saveAllReminders(reminders)
          chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
          renderRemindersList(modal) // Re-renderiza a lista
        }
      })
  })
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
  const currentPageUrl = window.location.href

  notesDataCache.blocks.forEach(block => {
    const blockEl = document.createElement('div')
    blockEl.className = 'note-block'
    blockEl.dataset.blockId = block.id

    if (block.associatedUrl && block.associatedUrl === currentPageUrl) {
      blockEl.classList.add('active', 'context-match')
      notesDataCache.activeBlockId = block.id
    } else if (block.id === notesDataCache.activeBlockId) {
      blockEl.classList.add('active')
    }

    const openLinkBtn = block.associatedUrl
      ? `<button type="button" class="open-link-btn-note" title="Abrir chamado vinculado">↗️</button>`
      : ''

    blockEl.innerHTML = `
            <div class="note-block-header" title="Clique para expandir, clique duplo no título para renomear.">
                <span class="note-title">${escapeHTML(block.title)}</span>
                <div class="note-block-actions">
                    ${openLinkBtn}
                    <button type="button" class="link-note-btn" title="Vincular/desvincular anotação a este chamado">🔗</button>
                    <button type="button" class="edit-title-btn" title="Editar Título">✏️</button>
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

// Armazena a referência do handler para poder removê-lo depois
let notesPanelOutsideClickHandler = null

/**
 * Alterna a visibilidade do painel de anotações e gerencia o listener de clique externo.
 */
function toggleNotesPanel() {
  const panel = document.getElementById('notes-side-panel')
  if (panel) {
    const isVisible = panel.classList.toggle('visible')

    // Sempre remove o listener antigo antes de decidir se precisa de um novo
    if (notesPanelOutsideClickHandler) {
      document.removeEventListener('mousedown', notesPanelOutsideClickHandler)
      notesPanelOutsideClickHandler = null
    }

    // Se o painel agora está visível, adiciona um novo listener
    if (isVisible) {
      // Define o handler do clique externo
      notesPanelOutsideClickHandler = e => {
        const toggleButton = document.querySelector(
          '[data-action="toggle-notes"]'
        )

        // Se o clique foi fora do painel E não foi no botão de abrir, fecha o painel
        if (
          panel &&
          !panel.contains(e.target) &&
          toggleButton &&
          !toggleButton.contains(e.target)
        ) {
          toggleNotesPanel() // A chamada recursiva irá remover o listener
        }
      }

      // Adiciona o listener com um pequeno delay para evitar que o mesmo clique que abriu, feche-o.
      requestAnimationFrame(() => {
        document.addEventListener('mousedown', notesPanelOutsideClickHandler)
      })
    }
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
  const openLinkBtn = e.target.closest('.open-link-btn-note')
  const linkBtn = e.target.closest('.link-note-btn')
  const editBtn = e.target.closest('.edit-title-btn')
  const deleteBtn = e.target.closest('.delete-note-btn')
  const header = e.target.closest('.note-block-header')

  if (openLinkBtn) {
    e.stopPropagation()
    const blockEl = openLinkBtn.closest('.note-block')
    const block = notesDataCache.blocks.find(
      b => b.id === blockEl.dataset.blockId
    )
    if (block && block.associatedUrl) {
      window.open(block.associatedUrl, '_blank')
    }
  } else if (linkBtn) {
    e.stopPropagation()
    const blockEl = linkBtn.closest('.note-block')
    handleLinkNoteToggle(blockEl.dataset.blockId)
  } else if (editBtn) {
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
 * Função auxiliar para garantir que todos os modos de edição de título sejam finalizados.
 */
async function handleLinkNoteToggle(blockId) {
  if (!notesDataCache) return
  const block = notesDataCache.blocks.find(b => b.id === blockId)
  if (!block) return
  const currentPageUrl = window.location.href

  if (block.associatedUrl === currentPageUrl) {
    block.associatedUrl = null
    showNotification('Anotação desvinculada deste chamado.', 'info')
  } else {
    block.associatedUrl = currentPageUrl
    showNotification('Anotação vinculada a este chamado.', 'success')
  }
  await saveNotes(notesDataCache)
  renderNotesBlocks()
}

/**
 * Inicializa o painel de anotações (cria a estrutura e carrega os dados).
 */
async function initializeNotesPanel() {
  createNotesPanel()
  notesDataCache = await getSavedNotes()
  renderNotesBlocks()
}

/**
 * Exibe um modal estilizado com o resumo do chamado.
 * @param {string} summaryText - O texto do resumo (parágrafo + tópicos).
 * @param {string} nextActionText - O texto da sugestão de próxima ação.
 * @param {object} relevantData - Dados extraídos da página.
 * @param {function(string): void} onInsert - Callback para inserir o conteúdo no editor.
 */
function showSummaryModal(summaryText, nextActionText, relevantData, onInsert) {
  const formatTimeAgo = timestamp => {
    if (!timestamp) return 'Data não encontrada'
    const now = new Date()
    const past = new Date(timestamp)
    const diffInSeconds = Math.floor((now - past) / 1000)
    const minutes = Math.floor(diffInSeconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 1) return `Há ${days} dias`
    if (days === 1) return `Há 1 dia`
    if (hours > 1) return `Há ${hours} horas`
    if (hours === 1) return `Há 1 hora`
    if (minutes > 1) return `Há ${minutes} minutos`
    return 'Há poucos instantes'
  }

  // Função para transformar texto com asteriscos em HTML de lista
  const formatSummaryToHtml = text => {
    let html = ''
    const lines = text.split('\n').filter(line => line.trim() !== '')
    let inList = false

    lines.forEach(line => {
      line = line.trim()
      if (line.startsWith('*')) {
        if (!inList) {
          html += '<ul>'
          inList = true
        }
        html += `<li>${escapeHTML(line.substring(1).trim())}</li>`
      } else {
        if (inList) {
          html += '</ul>'
          inList = false
        }
        html += `<p>${escapeHTML(line)}</p>`
      }
    })

    if (inList) {
      html += '</ul>'
    }
    return html.replace(/<p><\/p>/g, '') // Limpa parágrafos vazios
  }

  const openingDate = relevantData.openingDate
    ? new Date(relevantData.openingDate).toLocaleString('pt-BR')
    : 'Não encontrada'
  const timeAgo = formatTimeAgo(relevantData.openingDate)

  let relevantDataHtml = `<div class="data-item"><span class="data-label">Abertura:</span><span class="data-value">${openingDate} (${timeAgo})</span></div>`

  if (relevantData.attachments && relevantData.attachments.length > 0) {
    const attachmentList = relevantData.attachments
      .map(att => {
        // Validação de segurança para garantir que a URL é segura
        if (isValidUrl(att.fileUrl)) {
          return `<li><a href="${escapeHTML(
            att.fileUrl
          )}" target="_blank" title="Abrir anexo em nova guia">${escapeHTML(
            att.fileName
          )}</a></li>`
        }
        return `<li>${escapeHTML(att.fileName)} (Link inválido)</li>`
      })
      .join('')
    relevantDataHtml += `<div class="data-item attachments"><span class="data-label">Anexos:</span><ul class="data-value">${attachmentList}</ul></div>`
  }

  if (relevantData.accessData && relevantData.accessData.length > 0) {
    const accessList = relevantData.accessData
      .map(data => `<li>${escapeHTML(data)}</li>`)
      .join('')
    relevantDataHtml += `<div class="data-item attachments"><span class="data-label">Acesso:</span><ul class="data-value">${accessList}</ul></div>`
  }

  const summaryHtml = formatSummaryToHtml(summaryText)

  const modalContentHtml = `
    <div class="summary-modal-content">
      <div class="summary-card resume">
        <h5><span class="section-icon">📄</span>Resumo</h5>
        <div class="summary-card-content">${summaryHtml}</div>
      </div>
      <div class="summary-card action">
        <h5><span class="section-icon">🚀</span>Próxima Ação Sugerida</h5>
        <p>${nextActionText.replace(/\n/g, '<br>')}</p>
      </div>
      <div class="summary-section relevant-data-section">
        <h4><span class="section-icon">📊</span> Dados Relevantes</h4>
        ${relevantDataHtml}
      </div>
      <div class="ai-disclaimer">
        Conteúdo gerado por IA. Verifique as informações antes de usar.
      </div>
    </div>
  `

  const modal = createModal(
    'Análise do Chamado',
    modalContentHtml,
    (modalBody, closeModal) => {
      const contentToInsert = `<b>Resumo:</b><br>${summaryText}`
      onInsert(contentToInsert)
      closeModal()
    }
  )

  const saveBtn = modal.querySelector('#modal-save-btn')
  if (saveBtn) saveBtn.textContent = 'Inserir Resumo no Editor'

  document.body.appendChild(modal)
}

/**
 * Exibe uma notificação flutuante (toast) de lembrete dentro da página do SGD por 10 segundos.
 * @param {object} reminder - O objeto do lembrete enviado pelo service worker.
 */
function showInPageNotification(reminder) {
  let container = document.getElementById('in-page-notification-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'in-page-notification-container'
    document.body.appendChild(container)
  }

  const notificationId = `in-page-notification-${reminder.id}`
  if (document.getElementById(notificationId)) return

  const notification = document.createElement('div')
  notification.id = notificationId
  notification.className = 'in-page-notification'
  // Adiciona a classe de prioridade para a estilização da borda colorida
  notification.classList.add(`priority-${reminder.priority || 'medium'}`)
  applyCurrentTheme(notification)

  const hasUrl = reminder.url && reminder.url.startsWith('http')
  const openUrlButtonHtml = hasUrl
    ? `<button type="button" class="action-btn open-url-btn">🔗 Abrir Link</button>`
    : ''

  notification.innerHTML = `
    <div class="in-page-notification-header">
      <span class="notification-icon">⏰</span>
      <h5 class="in-page-notification-title">${escapeHTML(reminder.title)}</h5>
      <button type="button" class="dismiss-btn" title="Dispensar">&times;</button>
    </div>
    <div class="in-page-notification-body">${
      reminder.description ? `<p>${escapeHTML(reminder.description)}</p>` : ''
    }</div>
    <div class="in-page-notification-actions">
      ${openUrlButtonHtml}
      <button type="button" class="action-btn snooze-btn-main">⏰ Adiar</button>
      <button type="button" class="action-btn complete-btn-main">✅ Concluir</button>
    </div>
  `
  // O controle de exibição agora é feito centralmente no service worker

  container.appendChild(notification)

  let wasInteractedWith = false

  const notificationTimeout = setTimeout(() => {
    if (wasInteractedWith) return

    notification.classList.remove('visible')
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification)
      }
    }, 400)

    // Tempo esgotado: Pede para o service worker atualizar o badge em TODAS as abas
    chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
  }, 30000) // 30 segundos

  const handleInteraction = async actionFn => {
    if (wasInteractedWith) return
    wasInteractedWith = true
    clearTimeout(notificationTimeout)

    try {
      await actionFn()
      // Avisa outras abas para fecharem a mesma notificação
      chrome.runtime.sendMessage({
        action: 'BROADCAST_DISMISS',
        reminderId: reminder.id
      })
    } catch (error) {
      showNotification(`Erro ao processar lembrete: ${error.message}`, 'error')
    }
  }

  // O botão 'X' (dismiss-btn) agora apenas fecha o toast e ativa o sino
  notification.querySelector('.dismiss-btn').addEventListener('click', () => {
    if (wasInteractedWith) return
    wasInteractedWith = true
    clearTimeout(notificationTimeout)

    // Apenas remove o elemento visual
    notification.classList.remove('visible')
    setTimeout(() => {
      if (notification.parentNode)
        notification.parentNode.removeChild(notification)
    }, 400)

    // Ativa o sino de notificação imediatamente
    chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
  })

  // O botão "Concluir" (complete-btn-main) marca o lembrete como concluído
  notification
    .querySelector('.complete-btn-main')
    .addEventListener('click', () =>
      handleInteraction(async () => {
        const reminders = await getReminders()
        const reminderToComplete = reminders[reminder.id]
        if (reminderToComplete) {
          reminderToComplete.isFired = false
          reminderToComplete.firedAt = Date.now()

          // Se for recorrente, agenda o próximo
          if (
            reminderToComplete.recurrence &&
            reminderToComplete.recurrence !== 'none'
          ) {
            const nextDateTime = calculateNextRecurrence(
              reminderToComplete.dateTime,
              reminderToComplete.recurrence
            )
            reminderToComplete.dateTime = nextDateTime
            reminderToComplete.isFired = false
            reminderToComplete.firedAt = null
          }

          await saveAllReminders(reminders)
          chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
        }
      })
    )

  // CORREÇÃO: O botão 'Abrir Link' agora apenas abre o link, sem fechar o toast ou concluir o lembrete
  const openUrlBtn = notification.querySelector('.open-url-btn')
  if (openUrlBtn) {
    openUrlBtn.addEventListener('click', () => {
      window.open(reminder.url, '_blank')
    })
  }

  const snoozeBtn = notification.querySelector('.snooze-btn-main')
  if (snoozeBtn) {
    // ALTERADO: Agora abre o modal de opções ao invés de adiar por um tempo fixo.
    snoozeBtn.addEventListener('click', () => {
      handleInteraction(() => {}) // Fecha o toast
      openSnoozeModal(reminder, null) // Abre o modal de opções
    })
  }

  requestAnimationFrame(() => {
    notification.classList.add('visible')
  })
}

/**
 * Abre um painel flutuante para exibir lembretes pendentes e já disparados.
 */
async function openFiredRemindersPanel() {
  if (document.getElementById('fired-reminders-panel')) {
    document.getElementById('fired-reminders-panel').remove()
    return
  }

  const remindersData = await getReminders()
  const allReminders = Object.values(remindersData)

  const activeReminders = allReminders
    .filter(r => r.isFired === false && !r.firedAt)
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
  const pendingReminders = allReminders
    .filter(r => r.isFired === true)
    .sort((a, b) => (a.firedAt || 0) - (b.firedAt || 0))
  const acknowledgedReminders = allReminders
    .filter(r => r.isFired === false && r.firedAt)
    .sort((a, b) => (b.firedAt || 0) - (a.firedAt || 0))

  const isEmpty =
    pendingReminders.length === 0 &&
    acknowledgedReminders.length === 0 &&
    activeReminders.length === 0

  const panel = document.createElement('div')
  panel.id = 'fired-reminders-panel'
  applyCurrentTheme(panel)

  // Usa a função compartilhada para criar os cards com o novo estilo moderno

  let panelContentHtml

  // NOVO: Lógica para exibir o painel mesmo quando vazio.
  if (isEmpty) {
    panelContentHtml = `<div class="empty-reminders-message">Não existem notificações ou lembretes ativos.</div>`
    updateNotificationStatus() // Garante que o sino não fique pulsando
  } else {
    const pendingHtml =
      pendingReminders.length > 0
        ? `<h6>Pendentes</h6>` +
          pendingReminders
            .map(r => createReminderCardHtml(r, 'pending'))
            .join('')
        : ''
    const activeHtml =
      activeReminders.length > 0
        ? `<h6>Ativos</h6>` +
          activeReminders.map(r => createReminderCardHtml(r, 'active')).join('')
        : ''
    const acknowledgedHtml =
      acknowledgedReminders.length > 0
        ? `<h6>Concluídos</h6>` +
          acknowledgedReminders
            .map(r => createReminderCardHtml(r, 'acknowledged'))
            .join('')
        : ''

    const sections = [pendingHtml, activeHtml, acknowledgedHtml].filter(Boolean)
    panelContentHtml = sections.join('<hr class="fired-reminders-separator">')
  }

  panel.innerHTML = `
    <div class="fired-reminders-header">
        <h6>Notificações</h6>
        <div class="fired-reminders-header-actions">
            <button type="button" class="action-btn small-btn new-reminder-btn" title="Novo Lembrete">⏰ Novo</button>
            <button type="button" class="action-btn small-btn manage-reminders-btn" title="Gerenciar Lembretes">⏳ Gerenciar</button>
        </div>
    </div>
    <div class="fired-reminders-list">${panelContentHtml}</div>`

  document.body.appendChild(panel)

  // Posicionamento e Listeners
  const bellIcon = document.getElementById('sgd-notification-bell')
  if (bellIcon) {
    const bellRect = bellIcon.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()

    // Calcula a posição abaixo do sino
    let topPos = bellRect.bottom + window.scrollY + 5
    let leftPos = bellRect.left + window.scrollX

    // Ajusta a posição horizontal para evitar que o painel saia da tela
    if (leftPos + panelRect.width > window.innerWidth) {
      leftPos = bellRect.right + window.scrollX - panelRect.width
    }

    panel.style.position = 'absolute'
    panel.style.top = `${topPos}px`
    panel.style.left = `${Math.max(10, leftPos)}px`
  }

  // --- NOVA LÓGICA DE FECHAMENTO ---
  // Função para fechar o painel e remover o listener de clique externo
  const closePanelAndCleanup = () => {
    document.removeEventListener('click', clickOutsideHandler, true)
    panel.classList.remove('visible')
    setTimeout(() => {
      if (panel.parentNode) panel.remove()
    }, 300)
  }

  // Handler que verifica se o clique foi fora do painel
  const clickOutsideHandler = event => {
    if (!panel.contains(event.target) && !bellIcon.contains(event.target)) {
      closePanelAndCleanup()
    }
  }

  // Adiciona o listener no próximo ciclo de eventos para evitar fechar ao abrir
  requestAnimationFrame(() => {
    document.addEventListener('click', clickOutsideHandler, true)
  })

  // Atualiza os listeners dos botões para usar a nova função de fechamento
  panel.querySelector('.new-reminder-btn').addEventListener('click', () => {
    closePanelAndCleanup()
    openNewReminderModal()
  })
  panel.querySelector('.manage-reminders-btn').addEventListener('click', () => {
    closePanelAndCleanup()
    openRemindersManagementModal()
  })

  panel.querySelectorAll('.reminder-card').forEach(card => {
    // Lógica de expansão do card
    card.addEventListener('click', e => {
      if (!e.target.closest('button')) {
        // Não expande se o clique for em um botão
        card.classList.toggle('expanded')
      }
    })
  })

  panel.querySelectorAll('.reminder-card').forEach(item => {
    const reminderId = item.dataset.id
    if (!reminderId) return

    item.querySelector('[data-action="edit"]')?.addEventListener('click', e => {
      e.stopPropagation()
      const reminder = allReminders.find(r => r.id === reminderId)
      if (reminder) {
        closePanelAndCleanup()
        openNewReminderModal(reminder)
      }
    })

    item
      .querySelector('[data-action="open-url"]')
      ?.addEventListener('click', e => {
        e.stopPropagation()
        const reminder = allReminders.find(r => r.id === reminderId)
        if (reminder && reminder.url) window.open(reminder.url, '_blank')
      })

    item
      .querySelector('[data-action="remove"]')
      ?.addEventListener('click', e => {
        e.stopPropagation()
        showConfirmDialog(
          'Tem certeza que deseja remover este lembrete permanentemente?',
          async () => {
            await deleteReminder(reminderId)
            chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
            closePanelAndCleanup()
          }
        )
      })

    item
      .querySelector('[data-action="snooze"]')
      ?.addEventListener('click', e => {
        e.stopPropagation()
        const reminder = allReminders.find(r => r.id === reminderId)
        if (reminder) openSnoozeModal(reminder, closePanelAndCleanup)
      })

    item
      .querySelector('[data-action="complete"]')
      ?.addEventListener('click', async e => {
        e.stopPropagation()
        const reminders = await getReminders()
        const reminderToComplete = reminders[reminderId]
        if (reminderToComplete) {
          if (
            reminderToComplete.recurrence &&
            reminderToComplete.recurrence !== 'none'
          ) {
            const nextDate = getNextRecurrenceDate(
              new Date(reminderToComplete.dateTime),
              reminderToComplete.recurrence
            )
            if (nextDate) {
              reminderToComplete.dateTime = nextDate.toISOString()
              reminderToComplete.isFired = false
              reminderToComplete.firedAt = null
              await saveReminder(reminderToComplete)
            } else {
              await deleteReminder(reminderId)
            }
          } else {
            reminderToComplete.isFired = false
            await saveAllReminders(reminders)
          }
          chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
          closePanelAndCleanup()
        }
      })
  })

  requestAnimationFrame(() => panel.classList.add('visible'))
}

/**
 * Abre um modal com opções para adiar um lembrete.
 * @param {object} reminder - O lembrete a ser adiado.
 * @param {function} onComplete - Callback a ser chamado após a ação.
 */
function openSnoozeModal(reminder, onComplete) {
  const calculateSnoozeTime = minutes =>
    new Date(Date.now() + minutes * 60 * 1000).toISOString()

  const snoozeOptions = [
    { label: '15 Minutos', time: calculateSnoozeTime(15) },
    { label: '1 Hora', time: calculateSnoozeTime(60) },
    {
      label: 'Amanhã (9:00)',
      time: (() => {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(9, 0, 0, 0)
        return d.toISOString()
      })()
    }
  ]

  let buttonsHtml = snoozeOptions
    .map(
      opt =>
        `<button type="button" class="action-btn" data-time="${opt.time}">${opt.label}</button>`
    )
    .join('')
  buttonsHtml += `<button type="button" class="action-btn define-btn">Definir...</button>` // Novo botão "Definir"

  const modal = createModal(
    'Adiar Lembrete',
    `<p>Adiar "${escapeHTML(reminder.title)}" para:</p>`,
    null,
    true
  )

  const actionsContainer = modal.querySelector('.se-modal-actions')
  actionsContainer.innerHTML = buttonsHtml

  actionsContainer
    .querySelectorAll('.action-btn:not(.define-btn)')
    .forEach(btn => {
      btn.addEventListener('click', async () => {
        const reminders = await getReminders()
        const reminderToSnooze = reminders[reminder.id]
        if (reminderToSnooze) {
          reminderToSnooze.dateTime = btn.dataset.time
          reminderToSnooze.isFired = false
          reminderToSnooze.isSnoozed = true // Adicione esta linha
          await saveReminder(reminderToSnooze)
          chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' })
          modal.querySelector('.se-close-modal-btn').click()
          if (onComplete) onComplete()
        }
      })
    })

  // Listener para o novo botão "Definir"
  actionsContainer
    .querySelector('.define-btn')
    .addEventListener('click', () => {
      modal.querySelector('.se-close-modal-btn').click()
      if (onComplete) onComplete()
      openNewReminderModal(reminder) // Abre o modal de edição completo
    })

  document.body.appendChild(modal)
}

function createSpeechCommandHint() {
  const hintContainer = document.createElement('div')
  hintContainer.id = 'speech-command-hint'
  hintContainer.className = 'speech-command-hint' // Começa oculto

  hintContainer.innerHTML = `
    <div class="speech-hint-title">🎤 Comandos de Voz</div>
    <div class="speech-hint-columns">
        <div class="speech-hint-column">
          <strong>Pontuação</strong>
          <ul>
            <li>Vírgula<span>,</span></li>
            <li>Ponto<span>.</span></li>
            <li>Exclamação<span>!</span></li>
            <li>Interrogação<span>?</span></li>
            <li>Dois pontos<span>:</span></li>
          </ul>
        </div>
        <div class="speech-hint-column">
          <strong>Ações</strong>
          <ul>
            <li>Nova linha<span>↵</span></li>
            <li>Apagar<span>⌫</span></li>
            <li>Limpar<span>🗑</span></li>
            <li>Parar<span>⏹</span></li>
          </ul>
        </div>
    </div>
  `
  document.body.appendChild(hintContainer)
  return hintContainer
}
