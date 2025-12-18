/**
 * @file info-panel.js
 * Implementação do Painel de Informações e Alertas (Dashboard).
 */

/**
 * Escapa caracteres HTML para prevenir XSS.
 * @param {string} str - String a ser escapada.
 * @returns {string} String escapada.
 */
function escapeHTML(str) {
  return str.replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m])
  )
}

/**
 * Função debounce para limitar a frequência de execução de funções.
 * @param {Function} func - Função a ser executada.
 * @param {number} wait - Tempo de espera em milissegundos.
 * @returns {Function} Função debounced.
 */
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * Manipula o clique para ativar o modo desenvolvedor
 * @param {Event} event - Evento de clique
 */
function handleDeveloperModeClick(event) {
  const now = Date.now()

  // Reset contador se passou mais de 3 segundos desde o último clique
  if (now - lastClickTime > 3000) {
    clickCount = 0
  }

  clickCount++
  lastClickTime = now

  // Feedback visual
  const element = event.currentTarget
  element.style.backgroundColor =
    'color-mix(in srgb, var(--action-blue) 20%, transparent)'
  setTimeout(() => {
    element.style.backgroundColor = ''
  }, 200)

  // Ativar modo desenvolvedor após 5 cliques
  if (clickCount >= 5 && !developerMode) {
    developerMode = true
    clickCount = 0

    // Mostrar mensagem de confirmação
    const toast = document.createElement('div')
    toast.style.cssText =
      'position: fixed; top: 20px; right: 20px; padding: 12px 16px; background-color: var(--action-green); color: white; border-radius: var(--border-radius-sm); z-index: 10000; font-size: 14px;'
    toast.textContent = '✅ Modo desenvolvedor ativado!'
    document.body.appendChild(toast)

    setTimeout(() => {
      document.body.removeChild(toast)
    }, 3000)

    // Recarregar o painel para mostrar todas as seções
    const modal = document.querySelector('.ip-modal')
    if (modal) {
      document.body.removeChild(modal)
    }
    openInfoPanel()
  }
}

/**
 * Abre o Painel de Informações e Alertas.
 */
function openInfoPanel() {
  const allSections = [
    { id: 'pending', icon: '⏳', label: 'Pendências' },
    { id: 'instabilities', icon: '🚨', label: 'Instabilidades' },
    { id: 'notices', icon: '📢', label: 'Avisos' },
    { id: 'forms', icon: '📝', label: 'Formulários & Documentos' },
    { id: 'ai-chains', icon: '🤖', label: 'AI Chains - Assistentes' },
    { id: 'extensions', icon: '🧩', label: 'Extensões & Apps' },
    { id: 'team', icon: '👨‍💻', label: 'Técnicos' },
    { id: 'reports', icon: '📊', label: 'Relatórios' },
    { id: 'commands', icon: '💻', label: 'SQL & Comandos' }
  ]

  // Filtrar seções baseado no modo desenvolvedor
  const sections = developerMode
    ? allSections
    : allSections.filter(
        section =>
          section.id === 'pending' ||
          section.id === 'ai-chains' ||
          section.id === 'forms' ||
          section.id === 'extensions'
      )

  // Estrutura Base do Modal
  const sidebarHtml = `
    <div class="ip-sidebar">
      <div class="ip-sidebar-header" id="developer-mode-trigger">
        Painel
      </div>
      ${sections
        .map(
          (s, index) => `
        <div class="ip-nav-item ${index === 0 ? 'active' : ''}" data-target="${
            s.id
          }">
          <span class="ip-nav-icon">${s.icon}</span>
          <span class="ip-nav-label">${s.label}</span>
        </div>
      `
        )
        .join('')}
    </div>
  `

  // Geradores de Conteúdo (Mock)
  const contentHtml = `
    <div class="ip-content-area">
      ${sections
        .map(
          (s, index) => `
        <div id="ip-section-${s.id}" class="ip-section ${
            index === 0 ? 'active' : ''
          }">
          <h3 class="ip-section-title">${s.icon} ${s.label}</h3>
          ${getSectionContent(s.id)}
        </div>
      `
        )
        .join('')}
    </div>
  `

  // Cria o Modal usando a função existente
  const modal = createModal(
    'Central de Informações SGD',
    sidebarHtml + contentHtml,
    null,
    {
      isManagementModal: true,
      modalId: 'info-panel-modal',
      showShareButton: false
    }
  )

  // Adiciona lógica de navegação
  const navItems = modal.querySelectorAll('.ip-nav-item')
  const contentSections = modal.querySelectorAll('.ip-section')

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Remove active class
      navItems.forEach(n => n.classList.remove('active'))
      contentSections.forEach(s => s.classList.remove('active'))

      // Add active class
      item.classList.add('active')
      const targetId = item.dataset.target
      const targetSection = modal.querySelector(`#ip-section-${targetId}`)
      if (targetSection) {
        targetSection.classList.add('active')

        // Se a seção for de pendências, carrega/atualiza os dados
        if (targetId === 'pending') {
          loadPendingItems(targetSection)
        }

        // Se a seção for de formulários, carrega os dados
        if (targetId === 'forms') {
          loadForms(targetSection, 'forms')
        }

        // Se a seção for de AI Chains, carrega os dados
        if (targetId === 'ai-chains') {
           loadForms(targetSection, 'ai')
        }
      }
    })
  })

  // Configura o listener para o botão de atualizar na aba de pendências
  const pendingSection = modal.querySelector('#ip-section-pending')
  if (pendingSection) {
    const refreshBtn = pendingSection.querySelector('#refresh-pending-btn')
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadPendingItems(pendingSection)
      })
    }

    // Configuração do botão de Notificação
    const notifyBtn = pendingSection.querySelector('#toggle-notification-btn')
    if (notifyBtn) {
        // Função para atualizar visual do botão
        const updateNotifyBtnState = (enabled) => {
            if (enabled) {
                notifyBtn.textContent = '🔔'
                notifyBtn.classList.add('active-notification')
                notifyBtn.title = 'Notificações Ativadas\nVocê receberá alertas na tela durante as verificações periódicas (4x por hora).'
                notifyBtn.style.opacity = '1'
            } else {
                notifyBtn.textContent = '🔕'
                notifyBtn.classList.remove('active-notification')
                notifyBtn.title = 'Notificações Desativadas\nO sistema verificará pendências silenciosamente 4x por hora, mas não exibirá alertas na tela.'
                notifyBtn.style.opacity = '0.6'
            }
        }

        // Carregar estado inicial
        chrome.storage.sync.get(['extensionSettingsData'], (result) => {
            const settings = result.extensionSettingsData || {}
            const prefs = settings.preferences || {}
            // Padrão false
            const isEnabled = prefs.enablePendingNotifications === true
            updateNotifyBtnState(isEnabled)
        })

        // Listener de clique
        notifyBtn.addEventListener('click', async () => {
             const result = await chrome.storage.sync.get(['extensionSettingsData'])
             let settings = result.extensionSettingsData || { preferences: {} }
             if (!settings.preferences) settings.preferences = {}
             
             // Alternar
             const currentState = settings.preferences.enablePendingNotifications === true
             const newState = !currentState
             
             settings.preferences.enablePendingNotifications = newState
             
             await chrome.storage.sync.set({ extensionSettingsData: settings })
             updateNotifyBtnState(newState)
        })
    }

    // Carrega automaticamente as pendências se esta for a seção ativa
    if (pendingSection.classList.contains('active')) {
      loadPendingItems(pendingSection)
    }

    // Configurar listeners para os filtros
    const searchInput = pendingSection.querySelector('#pending-search')
    const statusFilter = pendingSection.querySelector('#pending-status-filter')
    const tagFilter = pendingSection.querySelector('#pending-tag-filter')
    const sortSelect = pendingSection.querySelector('#pending-sort')

    const applyFiltersHandler = () => {
      if (allPendingItems.length > 0) {
        applyPendingFilters(pendingSection)
      }
    }

    if (searchInput) {
      searchInput.addEventListener('input', debounce(applyFiltersHandler, 300))
    }
    if (statusFilter) {
      statusFilter.addEventListener('change', applyFiltersHandler)
    }
    if (tagFilter) {
      tagFilter.addEventListener('change', applyFiltersHandler)
    }
    if (sortSelect) {
      sortSelect.addEventListener('change', applyFiltersHandler)
    }
  }

  // Adicionar handler para o modo desenvolvedor
  const devTrigger = modal.querySelector('#developer-mode-trigger')
  if (devTrigger) {
    devTrigger.addEventListener('click', handleDeveloperModeClick)
  }

  // Adicionar mensagem de desenvolvimento no final do modal
  const devMessage = document.createElement('div')
  devMessage.style.cssText =
    'padding: 12px 16px; margin-top: 16px; background-color: color-mix(in srgb, var(--action-yellow) 15%, transparent); border: 1px solid color-mix(in srgb, var(--action-yellow) 30%, transparent); border-radius: var(--border-radius-sm); color: var(--text-color-main); font-size: 13px;'
  devMessage.innerHTML =
    '<strong>⚠️ Em Desenvolvimento:</strong> Esta funcionalidade ainda está sendo desenvolvida.'
  modal.querySelector('.ip-content-area').appendChild(devMessage)

  document.body.appendChild(modal)
}

// Variável global para armazenar os itens pendentes carregados
let allPendingItems = []

// #region agent log
// Global click listener to detect if clicks are happening but handler is missed
document.addEventListener('click', (e) => {
  if (e.target.matches('.ip-add-tag-btn') || e.target.closest('.ip-add-tag-btn')) {
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:globalClick',message:'Click detected on tag button',data:{target: e.target.className, isWindowOpenTagManagerDefined: typeof window.openTagManager !== 'undefined'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  }
});
// #endregion

// Cache para tags
let availableTagsCache = []
let pendingTagsMapCache = {}

// Controle do modo desenvolvedor
let developerMode = false
let clickCount = 0
let lastClickTime = 0

/**
 * Obtém o nome do usuário atual do SGD
 * @returns {string} Nome do usuário
 */
function getCurrentUserName() {
  // Tenta obter o nome do usuário do elemento na página do SGD
  const userNameElement = document.querySelector(
    '.user-info, .usuario-nome, [class*="user"], [class*="nome"]'
  )
  return userNameElement ? userNameElement.textContent.trim() : 'Usuário SGD'
}

/**
 * Aplica filtros e ordenação aos itens pendentes e atualiza a exibição.
 * @param {HTMLElement} sectionElement - O elemento da seção de pendências.
 */
function applyPendingFilters(sectionElement) {
  const container = sectionElement.querySelector('#pending-list-container')
  const statsContainer = sectionElement.querySelector('#pending-stats')

  if (!container || allPendingItems.length === 0) return

  // Obter valores dos filtros
  const searchText = (
    sectionElement.querySelector('#pending-search')?.value || ''
  ).toLowerCase()
  const statusFilter =
    sectionElement.querySelector('#pending-status-filter')?.value || ''
  const tagFilter =
    sectionElement.querySelector('#pending-tag-filter')?.value || ''

  const sortOption =
    sectionElement.querySelector('#pending-sort')?.value || 'dias-desc'

  // Aplicar filtros
  let filteredItems = allPendingItems.filter(item => {
    // Filtro de busca
    if (
      searchText &&
      !(
        item.id.toLowerCase().includes(searchText) ||
        item.subject.toLowerCase().includes(searchText)
      )
    ) {
      return false
    }

    // Filtro de status
    if (statusFilter) {
      const statusClass = getStatusClass(item.status)
      if (statusFilter === 'outro' && statusClass !== 'status-outro') {
        return false
      }
      if (
        statusFilter !== 'outro' &&
        statusClass !== `status-${statusFilter}`
      ) {
        return false
      }
    }

    // Filtro de Tags
    if (tagFilter) {
      const itemTags = pendingTagsMapCache[item.id] || []
      if (!itemTags.includes(tagFilter)) {
        return false
      }
    }

    return true
  })

  // Aplicar ordenação
  filteredItems.sort((a, b) => {
    const diasA = parseInt(a.dias) || 0
    const diasB = parseInt(b.dias) || 0
    const tramitesA = parseInt(a.qtdTramites) || 0
    const tramitesB = parseInt(b.qtdTramites) || 0

    switch (sortOption) {
      case 'dias-desc':
        return diasB - diasA
      case 'dias-asc':
        return diasA - diasB
      case 'tramites-desc':
        return tramitesB - tramitesA
      case 'tramites-asc':
        return tramitesA - tramitesB
      case 'data-desc':
        // Ordenar por data do último trâmite (mais recente primeiro)
        return new Date(b.dataUltimoTramite) - new Date(a.dataUltimoTramite)
      case 'data-asc':
        // Ordenar por data do último trâmite (mais antigo primeiro)
        return new Date(a.dataUltimoTramite) - new Date(b.dataUltimoTramite)
      default:
        return diasB - diasA
    }
  })

  // Atualizar estatísticas
  if (statsContainer) {
    statsContainer.innerHTML = `
            <span class="ip-stat-item">Total: <strong>${allPendingItems.length}</strong></span>
            <span class="ip-stat-item">Filtrado: <strong>${filteredItems.length}</strong></span>
        `
  }

  // Renderizar itens filtrados
  if (filteredItems.length === 0) {
    container.innerHTML = `
            <div class="ip-empty-state">
                <span style="font-size: 24px;">🔍</span>
                <h4>Nenhuma pendência encontrada</h4>
                <p>Tente ajustar os filtros ou buscar por outros termos.</p>
            </div>
        `
  } else {
    container.innerHTML = filteredItems
      .map(item => createPendingCard(item))
      .join('')
      
    // Attach listeners after rendering cards
    container.querySelectorAll('.ip-add-tag-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            openTagManager(this, this.dataset.pendingId)
        })
    })
  }
}

/**
 * Carrega e renderiza os itens pendentes na seção fornecida.
 * @param {HTMLElement} sectionElement - O elemento da seção de pendências.
 */
async function loadPendingItems(sectionElement) {
  const container = sectionElement.querySelector('#pending-list-container')
  const refreshBtn = sectionElement.querySelector('#refresh-pending-btn')
  const statsContainer = sectionElement.querySelector('#pending-stats')

  if (!container) return

  // Estado de Loading
  container.innerHTML = `
        <div class="ip-loading-container">
            <div class="ip-spinner"></div>
            <span>Buscando pendências...</span>
        </div>
    `

  if (statsContainer) {
    statsContainer.innerHTML = `
            <span class="ip-stat-item">Total: <strong>0</strong></span>
            <span class="ip-stat-item">Filtrado: <strong>0</strong></span>
        `
  }

  if (refreshBtn) refreshBtn.disabled = true

  try {
    // fetchPendingItems deve estar disponível globalmente via pending-service.js
    const items = await fetchPendingItems()
    allPendingItems = items
    
    // Carregar Tags e Mapa
    availableTagsCache = await getAvailableTags()
    pendingTagsMapCache = await getPendingTagsMap()

    // Atualiza o select de filtro de tags caso ele já tenha sido renderizado (refresh)
    const tagFilterSelect = sectionElement.querySelector('#pending-tag-filter')
    if (tagFilterSelect) {
        const currentVal = tagFilterSelect.value
        tagFilterSelect.innerHTML = `
            <option value="">Todas as Tags</option>
            ${availableTagsCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
        `
        tagFilterSelect.value = currentVal
    }

    if (items.length === 0) {
      container.innerHTML = `
                <div class="ip-empty-state">
                    <span style="font-size: 24px;">🎉</span>
                    <h4>Nenhuma pendência encontrada!</h4>
                    <p>Você zerou suas pendências.</p>
                </div>
            `
    } else {
      // Aplicar filtros iniciais
      applyPendingFilters(sectionElement)
    }
  } catch (error) {
    container.innerHTML = `
            <div class="ip-error-state">
                <span class="ip-error-icon">⚠️</span>
                <h4>Erro ao carregar pendências</h4>
                <p>${escapeHTML(error.message)}</p>
                <p style="font-size: 12px; margin-top: 10px;">Verifique se você está logado no SGD e tente novamente.</p>
            </div>
        `
  } finally {
    if (refreshBtn) refreshBtn.disabled = false
  }
}

/**
 * Retorna a classe CSS de status baseada no texto da situação.
 * @param {string} status - O texto da situação.
 * @returns {string} Classe CSS.
 */
function getStatusClass(status) {
  if (!status) return 'status-outro'
  const s = status.toLowerCase()

  if (s.includes('aguardando resposta - interna'))
    return 'status-aguardando-interna'
  if (s.includes('respondido - interna')) return 'status-respondido-interna'

  if (s.includes('em análise') || s.includes('técnico')) return 'status-analise'
  if (s.includes('respondido')) return 'status-respondido'
  if (s.includes('aguardando')) return 'status-aguardando'

  return 'status-outro'
}

/**
 * Cria o HTML para um card de pendência.
 * @param {object} item - Objeto da pendência.
 * @returns {string} HTML do card.
 */
function createPendingCard(item) {
// #region agent log
fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:createPendingCard',message:'Creating card',data:{id: item.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
// #endregion
  const statusClass = getStatusClass(item.status)
  const prioritariaIcon = item.isPrioritaria ? '<span class="ip-prioritaria-icon" title="Solicitação marcada como prioritária">⚠️</span>' : ''
  
  // Tags
  const itemTags = pendingTagsMapCache[item.id] || []
  const tagsHtml = itemTags.map(tagId => {
    const tagDef = availableTagsCache.find(t => t.id === tagId)
    if (!tagDef) return ''
    return `<span class="ip-tag-badge" style="background-color: ${tagDef.color}20; color: ${tagDef.color}; border-color: ${tagDef.color}40;">${escapeHTML(tagDef.name)}</span>`
  }).join('')

  return `
        <div class="ip-pending-card ${statusClass}" data-id="${item.id}">
            <div class="ip-pending-header">
                <div class="ip-pending-id-row">
                    <span class="ip-pending-id" title="N.º da Solicitação: ${escapeHTML(
                      item.id
                    )}">${escapeHTML(item.id)}</span>
                    <span class="ip-meta-item" title="Dias em aberto">📅 ${escapeHTML(
                      item.dias
                    )}d</span>
                    <span class="ip-meta-item" title="Quantidade de trâmites">🔄 ${escapeHTML(
                      item.qtdTramites
                    )}</span>
                    ${prioritariaIcon}
                    <div class="ip-tags-container">${tagsHtml}</div>
                    <button class="ip-add-tag-btn" title="Gerenciar Tags" data-pending-id="${item.id}">🏷️</button>
                </div>
                <div class="ip-date-container">
                    <span class="ip-pending-date" title="Data de Abertura: ${escapeHTML(
                      item.dataAbertura
                    )}">${escapeHTML(item.dataAbertura)}</span>
                    <span class="ip-separator">|</span>
                    <span class="ip-last-tramite" title="Último Trâmite: ${escapeHTML(
                      item.dataUltimoTramite
                    )}">${escapeHTML(item.dataUltimoTramite)}</span>
                </div>
            </div>
            
            <div class="ip-pending-subject">
                <a href="${escapeHTML(
                  item.link
                )}" target="_blank" style="color: inherit; text-decoration: none;" title="${escapeHTML(
    item.subject
  )}">
                    ${escapeHTML(item.subject)}
                </a>
            </div>

            <div class="ip-pending-footer">
                <span class="ip-pending-status" title="${escapeHTML(
                  item.status
                )}">
                    <span class="ip-status-dot"></span>
                    ${escapeHTML(item.status)}
                </span>
                <a href="${escapeHTML(
                  item.link
                )}" target="_blank" class="ip-pending-action-btn">Abrir ↗</a>
            </div>
        </div>
    `
}

// #region agent log
// Verify if window.openTagManager is set
fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:init',message:'Exposing functions to window',data:{before: typeof window.openTagManager},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
// #endregion

/**
 * Abre o gerenciador de tags para um item específico.
 * @param {HTMLElement} btnElement Botão clicado
 * @param {string} pendingId ID da pendência
 */
async function openTagManager(btnElement, pendingId) {
// #region agent log
fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:window.openTagManager',message:'Function called from window',data:{pendingId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
// #endregion

    // Remove qualquer popup existente
    const existingPopup = document.querySelector('.ip-tag-popup')
    if (existingPopup) existingPopup.remove()

    const popup = document.createElement('div')
    popup.className = 'ip-tag-popup'
    
    const currentTags = pendingTagsMapCache[pendingId] || []
    
    let tagsListHtml = availableTagsCache.map(tag => {
        const isChecked = currentTags.includes(tag.id) ? 'checked' : ''
        return `
            <div class="ip-tag-row">
                <label class="ip-tag-option" style="flex: 1;">
                    <input type="checkbox" value="${tag.id}" ${isChecked}>
                    <span class="ip-tag-color" style="background-color: ${tag.color}"></span>
                    ${escapeHTML(tag.name)}
                </label>
                <button class="ip-tag-delete-btn" data-tag-id="${tag.id}" title="Excluir Tag">🗑️</button>
            </div>
        `
    }).join('')

    popup.innerHTML = `
        <div class="ip-tag-popup-header">Gerenciar Tags</div>
        <div class="ip-tag-popup-list">${tagsListHtml}</div>
        <div class="ip-tag-popup-footer">
             <button class="ip-tag-new-btn" data-pending-id="${pendingId}">+ Nova Tag</button>
        </div>
    `

    // Posicionamento
    const rect = btnElement.getBoundingClientRect()
    popup.style.top = `${rect.bottom + window.scrollY + 5}px`
    popup.style.left = `${rect.left + window.scrollX}px`
    
    document.body.appendChild(popup)

    // Attach listeners for popup elements
    const newTagBtn = popup.querySelector('.ip-tag-new-btn')
    if (newTagBtn) {
        newTagBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.showNewTagInput) {
                window.showNewTagInput(this, pendingId)
            } else {
                 console.error('Função showNewTagInput não encontrada no window');
                 // Fallback
                 if (typeof showNewTagInput === 'function') {
                    showNewTagInput(this, pendingId);
                 }
            }
        })
    }

    const checkboxes = popup.querySelectorAll('input[type="checkbox"]')
    checkboxes.forEach(cb => {
        cb.addEventListener('change', function() {
            toggleTag(pendingId, this.value)
        })
    })

    // Delete buttons listener
    const deleteBtns = popup.querySelectorAll('.ip-tag-delete-btn')
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation(); // Impede fechar ou marcar checkbox
            if (confirm('Tem certeza que deseja excluir esta tag?')) {
                const tagId = this.dataset.tagId
                if (window.deleteTag) {
                    await window.deleteTag(tagId)
                    // Atualiza cache local
                    availableTagsCache = availableTagsCache.filter(t => t.id !== tagId)
                    // Fecha o popup atual pois a lista mudou
                    if (popup && popup.parentElement) popup.remove()
                    
                    // Atualiza filtros
                    const pendingSection = document.querySelector('#ip-section-pending')
                    if (pendingSection) {
                        const tagFilterSelect = pendingSection.querySelector('#pending-tag-filter')
                        if (tagFilterSelect) {
                            tagFilterSelect.innerHTML = `
                                <option value="">Todas as Tags</option>
                                ${availableTagsCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                            `
                        }
                        // Refresh UI do card
                         refreshPendingCardUI(pendingId)
                    }
                }
            }
        })
    })

    // Fechar ao clicar fora
    const closeHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== btnElement) {
            popup.remove()
            document.removeEventListener('click', closeHandler)
        }
    }
    setTimeout(() => document.addEventListener('click', closeHandler), 100)
}

/**
 * Alterna a tag e atualiza a UI.
 */
async function toggleTag(pendingId, tagId) {
    const newTags = await togglePendingTag(pendingId, tagId)
    pendingTagsMapCache[pendingId] = newTags
    
    // Re-renderiza o card específico ou atualiza a lista se estiver filtrada
    refreshPendingCardUI(pendingId)
}

/**
 * Mostra input para criar nova tag
 */
window.showNewTagInput = function(btnElement, pendingId) {
    // Tenta encontrar o container correto (footer do popup)
    const container = btnElement.closest('.ip-tag-popup-footer') || btnElement.parentElement
    if (!container) return;

    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px;">
            <input type="text" id="new-tag-name" placeholder="Nome" class="ip-new-tag-input" style="flex: 1;" autofocus>
            <input type="color" id="new-tag-color" value="#2196f3" class="ip-new-tag-color">
            <button id="save-tag-btn" class="ip-save-tag-btn">OK</button>
        </div>
    `
    // Attach listener for the new button
    const saveBtn = container.querySelector('#save-tag-btn')
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing popup
            if (window.saveNewTag) {
                window.saveNewTag(pendingId);
            } else {
                console.error('Função saveNewTag não encontrada');
            }
        })
    }
    
    // Prevent closing when clicking inputs
    const inputs = container.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('click', (e) => e.stopPropagation());
    });
}

/**
 * Exclui uma tag
 */
window.deleteTag = async function(tagId) {
    await deleteCustomTag(tagId)
}

/**
 * Salva a nova tag e a adiciona ao item.
 */
window.saveNewTag = async function(pendingId) {
    const nameInput = document.querySelector('#new-tag-name')
    const colorInput = document.querySelector('#new-tag-color')
    
    if (!nameInput || !nameInput.value.trim()) {
        console.warn('Nome da tag vazio')
        return
    }

    const newTag = await createCustomTag(nameInput.value.trim(), colorInput.value)
    availableTagsCache.push(newTag)
    
    // Atualiza a UI do popup (fecha e reabre para simplificar)
    const existingPopup = document.querySelector('.ip-tag-popup')
    if (existingPopup) existingPopup.remove()
    
    // Adiciona a nova tag ao item automaticamente
    if (window.toggleTag) {
        await window.toggleTag(pendingId, newTag.id)
    }
    
    // Atualiza os filtros
    const pendingSection = document.querySelector('#ip-section-pending')
    if (pendingSection) {
        const tagFilterSelect = pendingSection.querySelector('#pending-tag-filter')
        if (tagFilterSelect) {
             tagFilterSelect.innerHTML = `
                <option value="">Todas as Tags</option>
                ${availableTagsCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
            `
        }
    }
}

/**
 * Atualiza apenas a visualização de tags de um card específico para evitar reload total.
 */
function refreshPendingCardUI(pendingId) {
    // Se tiver filtro de tag ativo, talvez o item suma da lista, então reload completo é mais seguro para consistência
    const pendingSection = document.querySelector('#ip-section-pending')
    const tagFilter = pendingSection.querySelector('#pending-tag-filter')
    
    if (tagFilter && tagFilter.value) {
        applyPendingFilters(pendingSection)
    } else {
        // Atualização local para performance
        const card = document.querySelector(`.ip-pending-card[data-id="${pendingId}"]`)
        if (card) {
             const tagsContainer = card.querySelector('.ip-tags-container')
             const itemTags = pendingTagsMapCache[pendingId] || []
             const tagsHtml = itemTags.map(tagId => {
                const tagDef = availableTagsCache.find(t => t.id === tagId)
                if (!tagDef) return ''
                return `<span class="ip-tag-badge" style="background-color: ${tagDef.color}20; color: ${tagDef.color}; border-color: ${tagDef.color}40;">${escapeHTML(tagDef.name)}</span>`
             }).join('')
             tagsContainer.innerHTML = tagsHtml
        }
    }
}

/**
 * Retorna o conteúdo HTML (mockado ou estrutura) para cada seção.
 */
function getSectionContent(sectionId) {
  switch (sectionId) {
    case 'instabilities':
      return `
        <p class="ip-section-desc">Status atual dos sistemas e recomendações de contorno.</p>
        <div class="ip-grid">
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Sistema Contábil</h4>
              <span class="ip-card-badge badge-danger">Instabilidade</span>
            </div>
            <div class="ip-card-content">
              Lentidão generalizada no acesso ao módulo de Escrita Fiscal. Equipe de desenvolvimento já acionada.
              <br><strong>Contorno:</strong> Aguardar normalização.
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Portal do Cliente</h4>
              <span class="ip-card-badge badge-success">Operacional</span>
            </div>
            <div class="ip-card-content">
              Todos os serviços operando normalmente.
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Conta Digital</h4>
              <span class="ip-card-badge badge-warning">Atenção</span>
            </div>
            <div class="ip-card-content">
              Atraso na conciliação com Honorários.
            </div>
          </div>
        </div>
      `

    case 'notices':
      return `
        <p class="ip-section-desc">Avisos importantes da coordenação e comunicados internos.</p>
         <ul class="ip-list">
          <li class="ip-list-item">
            <div>
              <strong>Atualização Dominio:</strong> Nova versão será implantada hoje à noite. Vide Link informativo.
              <br><span style="font-size: 11px; color: var(--text-color-muted);">Postado ontem por Infra</span>
            </div>
          </li>
          <li class="ip-list-item">
            <div>
              <strong>Festa de Fim de Ano:</strong> Confirmar presença até o dia 15/12.
              <br><span style="font-size: 11px; color: var(--text-color-muted);">Postado por RH</span>
            </div>
          </li>
        </ul>
      `

    case 'extensions':
      return `
        <p class="ip-section-desc">Extensões recomendadas e ferramentas úteis para produtividade.</p>
        <div class="ip-grid">
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Sider - Assistente de IA</h4>
            </div>
            <div class="ip-card-content">
              Assistente de IA para ajudar com a escrita e melhorar a produtividade.
              <a
                href="https://chromewebstore.google.com/detail/sider-chatgpt-sidebar-%2B-g/difoiogjjojoaoomphldepapgpbgkhkb"
                class="ip-link-btn"
                target="_blank"
                rel="noopener noreferrer"
              >Instalar</a>
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">LanguageTool - Corretor inteligente</h4>
            </div>
            <div class="ip-card-content">
              Corretor gramatical e de estilo para melhorar a qualidade dos textos.
              <a
                href="https://chromewebstore.google.com/detail/ai-grammar-checker-paraph/oldceeleldhonbafppcapldpdifcinji"
                class="ip-link-btn"
                target="_blank"
                rel="noopener noreferrer"
              >Instalar</a>
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">aText</h4>
            </div>
            <div class="ip-card-content">
              Ferramenta de expansão de texto e automação.
              <a
                href="https://www.trankynam.com/atext/"
                class="ip-link-btn"
                target="_blank"
                rel="noopener noreferrer"
              >Instalar</a>
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Assistente Técnico</h4>
            </div>
            <div class="ip-card-content">
              Automatize instalações e atualizações da Domínio Sistemas.
              <a
                href="https://github.com/PatrickSud/assistente-tecnico/releases/latest/download/Assistente_Tecnico.exe"
                class="ip-link-btn"
                target="_blank"
                rel="noopener noreferrer"
              >Instalar</a>
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Lightshot</h4>
            </div>
            <div class="ip-card-content">
              Captura de tela rápida e fácil com ferramentas de edição integradas.
              <a
                href="https://app.prntscr.com/build/setup-lightshot.exe"
                class="ip-link-btn"
                target="_blank"
                rel="noopener noreferrer"
              >Instalar</a>
            </div>
          </div>
        </div>
      `

    case 'team':
      return `
         <p class="ip-section-desc">Status da equipe.</p>
         <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Time Daniel Rodrigues</h4>
              <span class="ip-card-badge badge-info">Hoje</span>
            </div>
            <div class="ip-card-content">
              <ul class="ip-list">
                <li class="ip-list-item">Patrick Godoy (08:00 - 18:00)</li>
                <li class="ip-list-item">João Silva (09:00 - 19:00)</li>
              </ul>
            </div>
          </div>
      `

    case 'reports':
      return `
            <p class="ip-section-desc">Ranking de performance e dados da conta.</p>
            <div class="ip-grid">
                <div class="ip-card">
                    <h4 class="ip-card-title" style="margin-bottom: 8px;">Top Produtividade (Semana)</h4>
                     <ol style="padding-left: 20px; color: var(--text-color-muted);">
                        <li>Patrick Godoy - 45 chamados</li>
                        <li>Carlos Pereira - 42 chamados</li>
                        <li>Ana Costa - 38 chamados</li>
                    </ol>
                </div>
                 <div class="ip-card">
                    <h4 class="ip-card-title" style="margin-bottom: 8px;">Minhas Métricas</h4>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                        <div style="text-align: center;">
                            <span style="display: block; font-size: 24px; font-weight: bold; color: var(--primary-color);">12</span>
                            <span style="font-size: 12px;">Votados</span>
                        </div>
                         <div style="text-align: center;">
                            <span style="display: block; font-size: 24px; font-weight: bold; color: var(--action-orange);">0.0%</span>
                            <span style="font-size: 12px;">Insatisfação</span>
                        </div>
                    </div>
                </div>
            </div>
        `

    case 'ai-chains':
      return `
         <p class="ip-section-desc">Assistentes inteligentes e padrões de fluxos.</p>
         <div id="ai-chains-container" class="ip-forms-container">
           <div class="ip-loading-container">
             <div class="ip-spinner"></div>
             <span>Carregando assistentes...</span>
           </div>
         </div>
      `

    case 'forms':
      return `
         <p class="ip-section-desc">Links rápidos para formulários e documentos internos.</p>
         <div id="forms-container" class="ip-forms-container">
           <div class="ip-loading-container">
             <div class="ip-spinner"></div>
             <span>Carregando formulários...</span>
           </div>
         </div>
      `

    case 'pending':
      return `
            <div class="ip-pending-header-row">

                <div class="ip-pending-controls">
                    <div class="ip-filter-group">
                        <input type="text" id="pending-search" placeholder="🔍 Buscar..." class="ip-filter-input compact" title="Buscar por ID ou assunto">
                        <select id="pending-status-filter" class="ip-filter-select compact" title="Filtrar por status">
                            <option value="">Todos status</option>
                            <option value="analise">Em análise</option>
                            <option value="respondido">Respondido</option>
                            <option value="aguardando">Aguardando</option>
                            <option value="aguardando-interna">Aguard. Interna</option>
                            <option value="respondido-interna">Resp. Interna</option>
                            <option value="outro">Outros</option>
                        </select>

                        <select id="pending-tag-filter" class="ip-filter-select compact" title="Filtrar por Tag">
                            <option value="">Todas as Tags</option>
                            ${availableTagsCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                        </select>

                        <select id="pending-sort" class="ip-filter-select compact" title="Ordenar por">
                            <option value="dias-desc">Dias ▼</option>
                            <option value="dias-asc">Dias ▲</option>
                            <option value="tramites-desc">Trâmites ▼</option>
                            <option value="tramites-asc">Trâmites ▲</option>
                            <option value="data-desc">Data recente</option>
                            <option value="data-asc">Data antiga</option>
                        </select>
                    </div>
                    <div class="ip-actions-group">
                        <button id="toggle-notification-btn" class="action-btn small-btn enhanced-btn compact" title="Carregando estado...">🔔</button>
                        <button id="refresh-pending-btn" class="action-btn small-btn enhanced-btn compact" title="Atualizar lista">🔄</button>
                    </div>
                </div>
            </div>
            <div id="pending-list-container" class="ip-grid">
                <div class="ip-loading-container">
                    <div class="ip-spinner"></div>
                    <span>Buscando pendências...</span>
                </div>
            </div>
            <div class="ip-pending-stats" id="pending-stats">
                <span class="ip-stat-item">Total: <strong>0</strong></span>
                <span class="ip-stat-item">Filtrado: <strong>0</strong></span>
            </div>
        `

    case 'commands':
      return `
        <p class="ip-section-desc">Cheat sheet de comandos SQL e úteis. Comunidade</p>
        
        <div class="ip-card">
            <h4 class="ip-card-title">Reset de Senha Admin</h4>
            <div class="ip-code-block">
                UPDATE usuarios SET senha = '123' WHERE usuario = 'ADMIN';
                <button class="ip-copy-btn" title="Copiar">📋</button>
            </div>
        </div>

        <div class="ip-card" style="margin-top: 10px;">
            <h4 class="ip-card-title">Listar Tabelas Bloqueadas</h4>
            <div class="ip-code-block">
                SELECT * FROM pg_locks pl LEFT JOIN pg_stat_activity psa ON pl.pid = psa.pid;
                <button class="ip-copy-btn" title="Copiar">📋</button>
            </div>
        </div>
      `

    default:
      return '<p>Seção em desenvolvimento...</p>'
  }
}

/**
 * Carrega e renderiza os formulários na seção correspondente
 * @param {HTMLElement} sectionElement - Elemento da seção de formulários
 * @param {string} filterType - Tipo de filtro ('forms' ou 'ai')
 */
async function loadForms(sectionElement, filterType = 'forms') {
  // Define o seletor do container baseado no filtro/seção
  const containerId = filterType === 'ai' ? '#ai-chains-container' : '#forms-container'
  const container = sectionElement.querySelector(containerId)
  if (!container) return

  try {
    // Buscar dados dos formulários
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'Function entry',data:{filterType,containerId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    const formsData = await fetchFormsData()
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'Forms data received',data:{hasData:!!formsData,hasCategories:!!formsData?.categories,categoriesCount:formsData?.categories?.length,isArray:Array.isArray(formsData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    if (!formsData || !formsData.categories) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'Invalid forms data',data:{hasData:!!formsData,hasCategories:!!formsData?.categories},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      throw new Error('Dados de formulários inválidos')
    }

    // Filtragem simples baseada no título da categoria (Case Insensitive)
    // Se for 'ai', pega categorias que contenham "AI", "Chain" ou "Assistente"
    // Se for 'forms', pega o resto.
    const filteredCategories = formsData.categories.filter(cat => {
        const title = cat.category.toLowerCase()
        const isAiCategory = title.includes('ai') || title.includes('chain') || title.includes('assistente')
        
        return filterType === 'ai' ? isAiCategory : !isAiCategory
    })

    // Renderizar categorias e itens
    let html = ''
    
    if (filteredCategories.length === 0) {
        html = `
            <div class="ip-empty-state">
                <h4>Nenhum item encontrado nesta seção.</h4>
            </div>
        `
    } else {
        filteredCategories.forEach(category => {
          html += `
            <div class="ip-forms-category">
              <h4 class="ip-forms-category-title">${escapeHTML(
                category.category
              )}</h4>
              <div class="ip-forms-grid">
          `

          category.items.forEach((item, itemIndex) => {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'Processing item',data:{category:category.category,itemIndex,itemType:item.type,hasTitle:!!item.title,hasClosingData:!!item.closingData},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            
            if (item.type === 'link') {
              html += `
                <a href="${escapeHTML(
                  item.url
                )}" target="_blank" class="ip-form-card">
                  <div class="ip-form-icon">${item.icon}</div>
                  <div class="ip-form-content">
                    <h5 class="ip-form-title">${escapeHTML(item.title)}</h5>
                    <p class="ip-form-desc">${escapeHTML(item.description)}</p>
                  </div>
                  <div class="ip-form-arrow">↗</div>
                </a>
              `
            } else if (item.type === 'document') {
              html += `
                <div class="ip-form-card ip-form-document" data-content="${escapeHTML(
                  item.content
                )}">
                  <div class="ip-form-icon">${item.icon}</div>
                  <div class="ip-form-content">
                    <h5 class="ip-form-title">${escapeHTML(item.title)}</h5>
                    <p class="ip-form-desc">${escapeHTML(item.description)}</p>
                  </div>
                  <div class="ip-form-arrow">📄</div>
                </div>
              `
            } else if (item.type === 'action-closing') {
              // #region agent log
              try {
                const hasClosingData = !!item.closingData
                const closingDataKeys = item.closingData ? Object.keys(item.closingData) : []
                fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'Processing action-closing item',data:{hasClosingData,closingDataKeys,hasTitle:!!item.closingData?.title,hasContent:!!item.closingData?.content},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                
                if (!item.closingData) {
                  throw new Error('closingData is missing')
                }
                const jsonString = JSON.stringify(item.closingData)
                const encoded = encodeURIComponent(jsonString)
                fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'action-closing encoding success',data:{jsonLength:jsonString.length,encodedLength:encoded.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              } catch (error) {
                fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'info-panel.js:loadForms',message:'action-closing encoding error',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
                throw error
              }
              // #endregion
              
              const closingDataEncoded = encodeURIComponent(
                JSON.stringify(item.closingData)
              )
              html += `
                <div class="ip-form-card ip-form-action" data-closing="${closingDataEncoded}">
                  <div class="ip-form-icon">${item.icon}</div>
                  <div class="ip-form-content">
                    <h5 class="ip-form-title">${escapeHTML(item.title)}</h5>
                    <p class="ip-form-desc">${escapeHTML(item.description)}</p>
                    <button class="ip-add-closing-btn enhanced-btn" style="margin-top: 12px;">
                      <span class="ip-btn-icon">➕</span>
                      <span class="ip-btn-text">Adicionar aos meus encerramentos</span>
                    </button>
                  </div>
                </div>
              `
            }
          })

          html += `
              </div>
            </div>
          `
        })
    }

    container.innerHTML = html

    // Adicionar event listeners para documentos
    container.querySelectorAll('.ip-form-document').forEach(card => {
      card.addEventListener('click', () => {
        const content = card.getAttribute('data-content')
        showDocumentModal(content)
      })
    })

    // Adicionar event listeners para ações (add-closing)
    container.querySelectorAll('.ip-form-action').forEach(card => {
      const btn = card.querySelector('.ip-add-closing-btn')
      if (btn) {
        btn.addEventListener('click', async e => {
          e.stopPropagation()
          const btnIcon = btn.querySelector('.ip-btn-icon')
          const btnText = btn.querySelector('.ip-btn-text')
          const originalIcon = btnIcon.textContent
          const originalText = btnText.textContent
          
          try {
            // Estado de carregamento
            btnIcon.textContent = '⏳'
            btnText.textContent = 'Adicionando...'
            btn.disabled = true
            
            const closingData = JSON.parse(decodeURIComponent(card.dataset.closing))
            await addClosingToPersonal(closingData)
            
            // Estado de sucesso
            btn.classList.add('success')
            btnIcon.textContent = '✓'
            btnText.textContent = 'Adicionado com sucesso!'
            
            setTimeout(() => {
              btn.classList.remove('success')
              btnIcon.textContent = originalIcon
              btnText.textContent = originalText
              btn.disabled = false
            }, 2500)
          } catch (error) {
            console.error(error)
            // Estado de erro
            btnIcon.textContent = '⚠️'
            btnText.textContent = 'Erro ao adicionar'
            btn.style.background = 'linear-gradient(135deg, #dc3545, #c82333) !important'
            
            setTimeout(() => {
              btnIcon.textContent = originalIcon
              btnText.textContent = originalText
              btn.style.background = ''
              btn.disabled = false
            }, 2500)
          }
        })
      }
    })
  } catch (error) {
    console.error('Erro ao carregar formulários:', error)
    container.innerHTML = `
      <div class="ip-error-container">
        <span style="color: var(--action-red); font-size: 24px;">⚠️</span>
        <p>Erro ao carregar dados</p>
        <small>${escapeHTML(error.message)}</small>
      </div>
    `
  }
}

/**
 * Exibe modal com conteúdo do documento
 * @param {string} content - Conteúdo HTML do documento
 */
function showDocumentModal(content) {
  const modal = createModal(
    '📄 Visualizar Documento',
    `
      <div style="max-height: 60vh; overflow-y: auto; padding: 16px;">
        ${content}
      </div>
    `,
    null,
    {
      size: 'medium',
      showClose: true
    }
  )

  document.body.appendChild(modal)
}

/**
 * Adiciona um encerramento aos dados pessoais do usuário
 * @param {object} closingData - Dados do encerramento
 */
async function addClosingToPersonal(closingData) {
  if (!closingData || !closingData.title || !closingData.content) {
    throw new Error('Dados do encerramento inválidos')
  }

  // Função global do storage.js
  if (
    typeof getGreetingsAndClosings !== 'function' ||
    typeof saveGreetingsAndClosings !== 'function'
  ) {
    throw new Error('Funções de armazenamento não disponíveis')
  }

  const data = await getGreetingsAndClosings()

  // Verifica duplicidade pelo título
  const exists = data.closings.some(c => c.title === closingData.title)
  if (exists) {
    if (
      !confirm(
        `O encerramento "${closingData.title}" já existe. Deseja adicionar uma cópia?`
      )
    ) {
      return
    }
  }

  const newClosing = {
    id: `cls-${Date.now()}`,
    title: closingData.title,
    content: closingData.content,
    shortcut: closingData.shortcut || '',
    order: data.closings.length
  }

  data.closings.push(newClosing)
  await saveGreetingsAndClosings(data)

  // Tenta notificar sucesso
  if (typeof showNotification === 'function') {
    showNotification('Encerramento adicionado com sucesso!', 'success')
  } else {
    alert('Encerramento adicionado com sucesso!')
  }
}
