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
  if (typeof str !== 'string') return ''
  return str.replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m]
  )
}

/**
 * Limpa uma string para ser usada com segurança como chave do Firebase.
 * @param {string} str 
 * @returns {string}
 */
function cleanFirebaseKey(str) {
  if (!str) return 'unknown_user'
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
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
 * Manipula o clique para ativar o modo desenvolvedor exclusivo do Painel SGD
 * @param {Event} event - Evento de clique
 */
/**
 * Abre o Painel de Informações e Alertas.
 * @param {string} initialTabId - ID da aba que deve ser aberta inicialmente
 */
async function openInfoPanel(initialTabId = 'pending') {
  console.log('[DEBUG] openInfoPanel called with initialTabId:', initialTabId);

  // Evita criar múltiplos modais se o painel já existir
  const existingModal = document.getElementById('info-panel-modal')
  if (existingModal) {
    existingModal.remove()
  }

  // Injeta estilos necessários
  injectDevSwitchStyles()

  // 1. Carregar estados persistentes do modo desenvolvedor e aba Controle de Acesso
  const infoDevMode = await isInfoDevModeEnabled() // Ativado via Cliques no Painel
  developerMode = infoDevMode // Para este painel, usamos o modo específico

  const storageResult = await chrome.storage.local.get(['accessControlTabUnlocked'])
  const accessControlTabUnlocked = storageResult.accessControlTabUnlocked === true

  // 1.1 Inicializar / atualizar permissões do usuário logado
  if (window.sgdPermissions) {
    // Re-verifica devMode, pois pode ter mudado desde a inicialização automática
    if (infoDevMode) {
      window.sgdPermissions.isEditor = true
      window.sgdPermissions.isDevMode = true
    } else if (!window.sgdPermissions.initialized) {
      await window.sgdPermissions.init()
    }
  }
  const isEditor = !!(window.sgdPermissions?.isEditor)
  const currentUserName = window.sgdPermissions?.currentUser || null

  const equipeATEnabled = await isEquipeATEnabled()

  const allSections = [
    { id: 'pending', icon: '⏳', label: 'Pendências' },
    { id: 'team-status', icon: '👥', label: 'Equipe AT' },
    { id: 'instabilities', icon: '🚨', label: 'Instabilidades' },
    { id: 'notices', icon: '📢', label: 'Avisos' },
    { id: 'forms', icon: '📝', label: 'Formulários & Documentos' },
    { id: 'ai-chains', icon: '🤖', label: 'AI Chains - Assistentes' },
    { id: 'extensions', icon: '🧩', label: 'Extensões & Apps' },
    { id: 'access-control', icon: '🔐', label: 'Controle de Acesso' }
  ]

  // Filtrar seções baseado na chave Equipe AT, Modo Dev e permissão de Editor/Desbloqueio
  const sections = allSections.filter(section => {
    // Equipe AT aparece exclusivamente se estiver habilitada, independente do modo dev
    if (section.id === 'team-status') {
      return equipeATEnabled
    }

    // Controle de Acesso visível apenas se desbloqueado nas Configurações
    if (section.id === 'access-control') {
      return accessControlTabUnlocked
    }

    // Outras abas aparecem se estiver em modo dev
    if (developerMode) return true

    // Seções públicas
    const publicSections = [
      'pending',
      'instabilities',
      'notices',
      'forms',
      'ai-chains',
      'extensions'
    ]
    return publicSections.includes(section.id)
  })

  const activeSectionId = sections.some(s => s.id === initialTabId) ? initialTabId : (sections[0] ? sections[0].id : 'pending')

  // HTML do rodapé da sidebar (Interruptores de Opções)
  const permBadgeHtml = currentUserName
    ? `<div class="ip-dev-toggle-wrapper" style="margin-bottom: 10px; flex-direction: column; align-items: flex-start; gap: 4px;">
        <span style="font-size: 10px; opacity: 0.6; font-weight: 400;">Logado como</span>
        <div style="display: flex; align-items: center; gap: 6px; width: 100%;">
          <span style="font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${escapeHTML(currentUserName)}">${escapeHTML(currentUserName.split(' ')[0])}</span>
          <span style="font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; background: ${isEditor ? 'var(--action-green, #22c55e)' : 'var(--border-color)'}; color: ${isEditor ? '#fff' : 'var(--text-color-muted)'}; white-space: nowrap;">${isEditor ? '✏️ Editor' : '👁️ Vizualizador'}</span>
        </div>
      </div>`
    : ''

  const sidebarFooterHtml = `
    <div class="ip-sidebar-footer">
      ${permBadgeHtml}
      <div class="ip-dev-toggle-wrapper">
        <span>Modo Dev</span>
        <label class="ip-switch" title="Mostrar/Ocultar Modo Desenvolvedor do Painel">
          <input type="checkbox" id="ip-dev-mode-switch" ${infoDevMode ? 'checked' : ''}>
          <span class="ip-slider round"></span>
        </label>
      </div>
    </div>
  `

  // Estrutura Base do Modal
  const sidebarHtml = `
    <div class="ip-sidebar">
      <div class="ip-sidebar-header" style="user-select: none;">
        Painel
      </div>
      <div style="flex: 1; overflow-y: auto;">
        ${sections
      .map(
        (s, index) => `
          <div id="ip-nav-${s.id}" class="ip-nav-item ${s.id === activeSectionId ? 'active' : ''}" data-target="${s.id
          }">
            <span class="ip-nav-icon">${s.icon}</span>
            <span class="ip-nav-label">${s.label}</span>
          </div>
        `
      )
      .join('')}
      </div>
      ${sidebarFooterHtml}
    </div>
  `

  // Geradores de Conteúdo (Mock)
  const contentHtml = `
    <div class="ip-content-area">
      ${sections
      .map(
        (s, index) => `
        <div id="ip-section-${s.id}" class="ip-section ${s.id === activeSectionId ? 'active' : ''
          }">
          ${s.id === 'team-status' ? '' : `<h3 class="ip-section-title">${s.icon} ${s.label}</h3>`}
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

  // --- Lógica de Navegação ---
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
      console.log(`[DEBUG] Navigation item clicked. Target: ${targetId}`);

      // Indicador de lido/não lido para Avisos
      if (targetId === 'notices') {
        const noticeIcon = item.querySelector('.ip-nav-icon')
        if (noticeIcon) noticeIcon.classList.remove('has-unread-warnings')
        chrome.storage.local.set({ warningsLastReadTime: Date.now(), readWarningIds: [] })
      }

      const targetSection = modal.querySelector(`#ip-section-${targetId}`)
      if (targetSection) {
        targetSection.classList.add('active')

        if (targetId === 'pending') loadPendingItems(targetSection)
        if (targetId === 'forms') loadForms(targetSection, 'forms')
        if (targetId === 'ai-chains') {
          loadForms(targetSection, 'ai')

          const searchInput = targetSection.querySelector('#ai-chains-search')
          if (searchInput && !searchInput.dataset.listenerSet) {
            searchInput.addEventListener(
              'input',
              debounce(e => {
                loadForms(targetSection, 'ai', e.target.value)
              }, 300)
            )
            searchInput.dataset.listenerSet = 'true'
          }
        }

        // Lógica de Busca e Ordenação para Equipe AT (Team Status)
        if (targetId === 'team-status') {
          const teamSearchInput = targetSection.querySelector('#team-search')
          const teamSortSelect =
            targetSection.querySelector('#team-sort-filter')

          if (teamSearchInput && !teamSearchInput.dataset.listenerSet) {
            teamSearchInput.addEventListener(
              'input',
              debounce(() => loadTeamStatus(targetSection, false), 300)
            )
            teamSearchInput.dataset.listenerSet = 'true'
          }
          if (teamSortSelect && !teamSortSelect.dataset.listenerSet) {
            teamSortSelect.addEventListener('change', () =>
              loadTeamStatus(targetSection, false)
            )
            teamSortSelect.dataset.listenerSet = 'true'
          }

          const teamStatusFilter = targetSection.querySelector(
            '#team-status-filter'
          )
          if (teamStatusFilter && !teamStatusFilter.dataset.listenerSet) {
            teamStatusFilter.addEventListener('change', () =>
              loadTeamStatus(targetSection, false)
            )
            teamStatusFilter.dataset.listenerSet = 'true'
          }

          // Listener para o botão de visualização
          const toggleViewBtn = targetSection.querySelector(
            '#toggle-team-view-btn'
          )
          if (toggleViewBtn && !toggleViewBtn.dataset.listenerSet) {
            toggleViewBtn.addEventListener('click', async () => {
              const result = await chrome.storage.local.get(['teamViewMode'])
              const currentMode = result.teamViewMode || 'normal'
              const newMode = currentMode === 'normal' ? 'compact' : 'normal'
              await chrome.storage.local.set({ teamViewMode: newMode })
              loadTeamStatus(targetSection, false) // Recarrega com novo modo
            })
            toggleViewBtn.dataset.listenerSet = 'true'
          }

          // Listener para teste de notificação (apenas dev)
          const testNotifyBtn = targetSection.querySelector(
            '#test-notification-btn'
          )
          if (testNotifyBtn && !testNotifyBtn.dataset.listenerSet) {
            testNotifyBtn.addEventListener('click', () => {
              if (!('Notification' in window)) {
                alert('Este navegador não suporta notificações de desktop.')
              } else if (Notification.permission === 'granted') {
                new Notification('Teste de Notificação', {
                  body: 'Esta é uma notificação de teste do Painel SGD.',
                  icon: chrome.runtime.getURL('icons/icon128.png'), // Tenta ícone da extensão ou fallback
                  requireInteraction: true
                })
              } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                  if (permission === 'granted') {
                    new Notification('Teste de Notificação', {
                      body: 'Obrigado! As notificações agora estão ativas.',
                      icon: chrome.runtime.getURL('icons/icon128.png')
                    })
                  }
                })
              } else {
                alert('Permissão para notificações foi negada.')
              }
            })
            testNotifyBtn.dataset.listenerSet = 'true'
          }

          loadTeamStatus(targetSection, false)
        }

        if (targetId === 'instabilities') {
          loadSystemsStatus(targetSection, false)
          const refreshBtn = targetSection.querySelector('#refresh-systems-btn')
          if (refreshBtn) {
            const newBtn = refreshBtn.cloneNode(true)
            refreshBtn.parentNode.replaceChild(newBtn, refreshBtn)
            newBtn.addEventListener('click', () => {
              loadSystemsStatus(targetSection, true)
            })
          }
        }

        if (targetId === 'notices') loadWarnings(targetSection, false)
        if (targetId === 'access-control') loadAccessControl(targetSection)
      }
    })
  })

  // --- Lógica do Botão de Notificação e Refresh (Pendências) ---
  const pendingSection = modal.querySelector('#ip-section-pending')
  if (pendingSection) {
    const refreshBtn = pendingSection.querySelector('#refresh-pending-btn')
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () =>
        loadPendingItems(pendingSection)
      )
    }

    const notifyBtn = pendingSection.querySelector('#toggle-notification-btn')
    if (notifyBtn) {
      const updateNotifyBtnState = enabled => {
        if (enabled) {
          notifyBtn.innerHTML =
            '🔔 <span style="margin-left: 4px;">Notificações Ativas</span>'
          notifyBtn.classList.add('active-notification')
          notifyBtn.title = 'Notificações Ativadas'
          notifyBtn.style.opacity = '1'
        } else {
          notifyBtn.innerHTML =
            '🔕 <span style="margin-left: 4px;">Notificações Inativas</span>'
          notifyBtn.classList.remove('active-notification')
          notifyBtn.title = 'Notificações Desativadas'
          notifyBtn.style.opacity = '0.7'
        }
      }

      chrome.storage.sync.get(['extensionSettingsData'], result => {
        const settings = result.extensionSettingsData || {}
        const prefs = settings.preferences || {}
        updateNotifyBtnState(prefs.enablePendingNotifications === true)
      })

      notifyBtn.addEventListener('click', async () => {
        const result = await chrome.storage.sync.get(['extensionSettingsData'])
        let settings = result.extensionSettingsData || { preferences: {} }
        if (!settings.preferences) settings.preferences = {}

        const newState = !(
          settings.preferences.enablePendingNotifications === true
        )
        settings.preferences.enablePendingNotifications = newState

        await chrome.storage.sync.set({ extensionSettingsData: settings })
        updateNotifyBtnState(newState)
      })
    }

    // Configurar listeners para os filtros
    const searchInput = pendingSection.querySelector('#pending-search')
    const statusFilter = pendingSection.querySelector('#pending-status-filter')
    const tagFilter = pendingSection.querySelector('#pending-tag-filter')
    const sortSelect = pendingSection.querySelector('#pending-sort')
    const responsibleFilter = pendingSection.querySelector(
      '#pending-responsible-filter'
    )
    const criticalFilter = pendingSection.querySelector(
      '#pending-critical-filter'
    )

    const applyFiltersHandler = () => {
      if (allPendingItems.length > 0) {
        applyPendingFilters(pendingSection)
      }
    }

    if (searchInput)
      searchInput.addEventListener('input', debounce(applyFiltersHandler, 300))
    if (statusFilter)
      statusFilter.addEventListener('change', applyFiltersHandler)
    if (tagFilter) tagFilter.addEventListener('change', applyFiltersHandler)
    if (sortSelect) sortSelect.addEventListener('change', applyFiltersHandler)
    if (criticalFilter)
      criticalFilter.addEventListener('change', applyFiltersHandler)
    if (responsibleFilter) {
      responsibleFilter.addEventListener('change', e => {
        // NOVO: Salva a preferência sempre que o usuário mudar
        const selectedValue = e.target.value
        chrome.storage.local.set({ preferredResponsible: selectedValue })

        applyFiltersHandler()
      })
    }
  }

  const devModeSwitch = modal.querySelector('#ip-dev-mode-switch')
  if (devModeSwitch) {
    devModeSwitch.addEventListener('click', async e => {
      const isChecking = e.target.checked
      const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com'

      if (isChecking) {
        // Previne a mudança imediata até a verificação/solicitação
        e.preventDefault()

        const userName = window.sgdPermissions?.currentUser
        const userId = window.sgdPermissions?.currentUserId
        const userKey = userId || (window.sgdPermissions ? cleanFirebaseKey(userName) : 'unknown_user')

        if (!userName) {
          showNotification('Erro: Nome do usuário não identificado.', 'error')
          return
        }

        // Exibe status de carregamento no interruptor ou via notificação
        showNotification('Verificando status de solicitação...', 'info')

        try {
          const res = await fetch(`${RTDB_BASE_URL}/dev_requests/${userKey}.json`, { cache: 'no-store' })
          let reqData = null
          if (res.ok) {
            reqData = await res.json()
          }

          if (reqData && reqData.status === 'approved') {
            // Se já está aprovado, ativa o modo dev
            await chrome.storage.local.set({ 
              infoDevMode: true
            })
            
            if (window.sgdPermissions) {
              window.sgdPermissions.isDevMode = true
              window.sgdPermissions.isEditor = true
              if (typeof window.sgdPermissions.registerUserActivity === 'function') {
                await window.sgdPermissions.registerUserActivity(userName)
              }
            }
            
            modal.remove()
            openInfoPanel()
            showNotification('Modo desenvolvedor ativado com sucesso!', 'success')
            return
          }

          if (reqData && reqData.status === 'pending') {
            // Se está pendente
            const pendingModalHtml = `
              <div style="padding: 10px; color: var(--text-color-main); font-size: 13px; line-height: 1.5;">
                <p style="margin-bottom: 12px;">Sua solicitação de acesso ao <strong>Modo Desenvolvedor</strong> foi enviada e está atualmente <strong>pendente</strong> de aprovação por um Editor Master.</p>
                <div style="padding: 10px; background: color-mix(in srgb, var(--action-yellow, #eab308) 10%, var(--background-secondary)); border: 1px solid color-mix(in srgb, var(--action-yellow, #eab308) 30%, var(--border-color)); border-radius: 4px; display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 18px;">⏳</span>
                  <span>Solicitação enviada em ${new Date(reqData.requestedAt).toLocaleDateString('pt-BR')} às ${new Date(reqData.requestedAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
              </div>
            `
            const pendingModal = createModal(
              'Solicitação Pendente',
              pendingModalHtml,
              (content, closePendingModal) => {
                closePendingModal()
              },
              {
                isManagementModal: false,
                modalId: 'dev-pending-modal'
              }
            )
            const saveBtn = pendingModal.querySelector('#modal-save-btn')
            if (saveBtn) saveBtn.style.display = 'none' // Não precisa de botão salvar
            const cancelBtn = pendingModal.querySelector('#modal-cancel-btn')
            if (cancelBtn) cancelBtn.textContent = 'Fechar'

            document.body.appendChild(pendingModal)
            return
          }

          // Se não há solicitação ou foi rejeitada
          const isRejected = reqData && reqData.status === 'rejected'
          const requestModalHtml = `
            <div style="padding: 10px; color: var(--text-color-main); font-size: 13px; line-height: 1.5;">
              <p style="margin-bottom: 12px;">
                O <strong>Modo Desenvolvedor</strong> é um ambiente restrito que permite acesso a recursos experimentais, gerenciamento avançado de avisos e ferramentas de depuração do sistema.
              </p>
              <p style="margin-bottom: 16px;">
                Se você precisa de acesso a essas ferramentas, poderá enviar uma solicitação que será avaliada pelos editores do sistema.
              </p>
              ${isRejected ? `
                <div style="padding: 10px; background: color-mix(in srgb, var(--action-red, #ef4444) 10%, var(--background-secondary)); border: 1px solid color-mix(in srgb, var(--action-red, #ef4444) 30%, var(--border-color)); border-radius: 4px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; color: var(--action-red, #ef4444);">
                  <span style="font-size: 18px;">⚠️</span>
                  <span>Sua solicitação anterior foi rejeitada em ${new Date(reqData.rejectedAt).toLocaleDateString('pt-BR')}. Você pode enviar uma nova solicitação caso necessário.</span>
                </div>
              ` : ''}
              <p style="font-weight: bold; margin-bottom: 8px;">Deseja enviar uma solicitação de acesso?</p>
            </div>
          `

          const requestModal = createModal(
            'Solicitação de Acesso',
            requestModalHtml,
            async (content, closeRequestModal) => {
              const confirmBtn = requestModal.querySelector('#modal-save-btn')
              if (confirmBtn) {
                confirmBtn.disabled = true
                confirmBtn.textContent = 'Enviando...'
              }

              try {
                const patchRes = await fetch(`${RTDB_BASE_URL}/dev_requests/${userKey}.json`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userName: userName,
                    userId: userId || '',
                    status: 'pending',
                    requestedAt: new Date().toISOString()
                  })
                })

                if (patchRes.ok) {
                  showNotification('Solicitação enviada com sucesso! Um Editor Master irá avaliar.', 'success')
                  closeRequestModal()
                } else {
                  showNotification('Erro ao enviar solicitação.', 'error')
                  if (confirmBtn) {
                    confirmBtn.disabled = false
                    confirmBtn.textContent = 'Solicitar Acesso'
                  }
                }
              } catch (err) {
                console.error(err)
                showNotification('Erro ao conectar com o servidor.', 'error')
                if (confirmBtn) {
                  confirmBtn.disabled = false
                  confirmBtn.textContent = 'Solicitar Acesso'
                }
              }
            },
            {
              isManagementModal: false,
              modalId: 'dev-request-modal'
            }
          )

          const saveBtn = requestModal.querySelector('#modal-save-btn')
          if (saveBtn) {
            saveBtn.textContent = 'Solicitar Acesso'
            saveBtn.style.background = 'var(--primary-color, #6366f1)'
            saveBtn.style.color = '#fff'
          }

          document.body.appendChild(requestModal)

        } catch (error) {
          console.error(error)
          showNotification('Erro ao verificar status com o servidor.', 'error')
        }
      } else {
        // Desativando (sem senha)
        await chrome.storage.local.set({ 
          infoDevMode: false
        })
        if (window.sgdPermissions) {
          window.sgdPermissions.isDevMode = false
          // Recarrega permissões locais sem forçar refetch para atualizar isEditor
          await window.sgdPermissions.init()
        }
        modal.remove()
        openInfoPanel()
      }
    })
  }

  // Mensagem de desenvolvimento no rodapé do conteúdo (apenas se dev)
  if (developerMode) {
    const devMessage = document.createElement('div')
    devMessage.style.cssText =
      'padding: 12px 16px; margin-top: 16px; background-color: color-mix(in srgb, var(--action-yellow) 15%, transparent); border: 1px solid color-mix(in srgb, var(--action-yellow) 30%, transparent); border-radius: var(--border-radius-sm); color: var(--text-color-main); font-size: 13px;'
    devMessage.innerHTML =
      '<strong>⚠️ Modo Desenvolvedor Ativo:</strong> Você tem acesso a recursos experimentais e de edição.'
    modal.querySelector('.ip-content-area').appendChild(devMessage)
  }

  document.body.appendChild(modal)

  // Dispara o clique na aba inicial para carregar seu conteúdo adequadamente
  const initialNav = modal.querySelector(`#ip-nav-${activeSectionId}`);
  if (initialNav) {
    initialNav.click();
  }
}

// Variável global para armazenar os itens pendentes carregados
let allPendingItems = []
let filteredPendingItems = []
let allPendingTabs = null
let activePendingTabId = 'all'
let acOnlyShowTeamAT = false

// #region agent log
// Global click listener to detect if clicks are happening but handler is missed
document.addEventListener('click', e => {
  if (
    e.target.matches('.ip-add-tag-btn') ||
    e.target.closest('.ip-add-tag-btn')
  ) {
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'info-panel.js:globalClick',
        message: 'Click detected on tag button',
        data: {
          target: e.target.className,
          isWindowOpenTagManagerDefined:
            typeof window.openTagManager !== 'undefined'
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        hypothesisId: 'A'
      })
    }).catch(() => { })
  }
})
// #endregion

// Cache para tags
let availableTagsCache = []
let pendingTagsMapCache = {}

// Controle do modo desenvolvedor
let developerMode = false

/**
 * Verifica se o modo desenvolvedor específico do painel está ativo
 */
function isInfoDevModeEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get(['infoDevMode'], result => {
      resolve(result.infoDevMode === true)
    })
  })
}

/**
 * Verifica se a aba Equipe AT está ativa no storage
 */
/**
 * Verifica se a aba Equipe AT está ativa no storage
 */
function isEquipeATEnabled() {
  return new Promise(resolve => {
    chrome.storage.local.get(['equipeATEnabled'], result => {
      // Se for a primeira vez e não houver valor, assume false (desabilitado por padrão)
      const enabled = result.equipeATEnabled === true
      resolve(enabled)
    })
  })
}

/**
 * Injeta os estilos CSS para o interruptor do modo desenvolvedor
 */
function injectDevSwitchStyles() {
  if (document.getElementById('ip-dev-switch-styles')) return

  const style = document.createElement('style')
  style.id = 'ip-dev-switch-styles'
  style.textContent = `
    .ip-sidebar-footer {
      margin-top: auto;
      padding: 16px;
      border-top: 1px solid var(--border-color);
      background-color: rgba(0, 0, 0, 0.05);
    }
    .ip-dev-toggle-wrapper {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-color-main);
      font-weight: 600;
    }
    /* The Switch - the box around the slider */
    .ip-switch {
      position: relative;
      display: inline-block;
      width: 34px;
      height: 20px;
    }
    /* Hide default HTML checkbox */
    .ip-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    /* The slider */
    .ip-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 34px;
    }
    .ip-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .ip-slider {
      background-color: var(--primary-color);
    }
    input:focus + .ip-slider {
      box-shadow: 0 0 1px var(--primary-color);
    }
    input:checked + .ip-slider:before {
      transform: translateX(14px);
    }
    .ip-team-member-card.is-pinned {
      border: 2px solid var(--primary-color) !important;
      background-color: color-mix(in srgb, var(--primary-color) 5%, var(--bg-card)) !important;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }
    .ip-team-member-card.is-dimmed {
      opacity: 0.5;
      filter: grayscale(0.5);
      border-left: 4px solid var(--border-color) !important;
    }
    .ip-team-member-card.is-dimmed:hover {
      opacity: 0.8;
      filter: grayscale(0);
    }
    .ip-card-quick-actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
      margin-left: 4px;
    }
    .ip-action-icon-btn {
      background: none;
      border: none;
      padding: 2px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s;
      color: var(--text-color-muted);
      opacity: 0.2; /* Mesmo padrão sutil de pendências */
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ip-team-member-card:hover .ip-action-icon-btn {
      opacity: 0.6;
    }
    .ip-action-icon-btn:hover {
      transform: scale(1.2);
      opacity: 1 !important;
      color: var(--text-color-main);
    }
    .ip-action-icon-btn.active-pin {
      color: var(--primary-color);
      opacity: 1 !important;
    }
    .ip-action-icon-btn.active-hide {
      color: var(--action-red);
      opacity: 0.8;
    }
    .ip-action-icon-btn.active-hide:hover {
       opacity: 1 !important;
    }
    /* ── Access Control Panel ── */
    .ip-access-current-user {
      background: color-mix(in srgb, var(--primary-color, #6366f1) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--primary-color, #6366f1) 20%, transparent);
      border-radius: var(--border-radius-sm, 6px);
      padding: 10px 14px;
      margin-bottom: 4px;
    }
    .ip-access-editor-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-color);
      gap: 8px;
    }
    .ip-access-editor-row:last-child {
      border-bottom: none;
    }
    .ip-access-editor-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .ip-access-editor-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color-main);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ip-access-editor-meta {
      font-size: 11px;
      color: var(--text-color-muted);
    }
    .ip-access-you-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--primary-color, #6366f1) 15%, transparent);
      color: var(--primary-color, #6366f1);
    }
    .ip-access-add-section {
      padding: 4px 0;
    }
    @keyframes acBlink {
      0% {
        opacity: 0.7;
        box-shadow: 0 0 4px rgba(234, 179, 8, 0.3);
      }
      100% {
        opacity: 1;
        box-shadow: 0 0 12px rgba(234, 179, 8, 0.7);
      }
    }
    .ac-pending-dev-request-row {
      animation: acBlink 1.5s infinite alternate;
      border: 1px solid var(--action-yellow, #eab308) !important;
      background: color-mix(in srgb, var(--action-yellow, #eab308) 12%, var(--background-secondary, #f3f4f6)) !important;
    }
    .ac-channel-checkbox, 
    .ac-new-profile-channel-checkbox, 
    .ac-viewer-select-checkbox {
      position: static !important;
      opacity: 1 !important;
      width: 14px !important;
      height: 14px !important;
      appearance: checkbox !important;
      -webkit-appearance: checkbox !important;
      cursor: pointer !important;
      margin: 0 4px 0 0 !important;
      display: inline-block !important;
    }
  `
  document.head.appendChild(style)
}

/**
 * Obtém o nome do usuário atual do SGD
 * @returns {string} Nome do usuário
 */
function getCurrentUserName() {
  if (window.sgdPermissions && window.sgdPermissions.currentUser) {
    return window.sgdPermissions.currentUser
  }
  // Tenta obter o nome do usuário do elemento do topo do SGD (navbar-link b)
  const userNameElement = document.querySelector('.navbar-link b')

  if (userNameElement) {
    // Remove os &nbsp; (no JS aparecem como \u00A0)
    return userNameElement.textContent.replace(/\u00A0/g, ' ').trim()
  }

  // Fallback para outros elementos se mudar
  const fallbackElement = document.querySelector('.user-info, .usuario-nome')
  return fallbackElement ? fallbackElement.textContent.trim() : 'Usuário SGD'
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

  const responsibleFilter =
    sectionElement.querySelector('#pending-responsible-filter')?.value || ''

  const criticalFilter = sectionElement.querySelector(
    '#pending-critical-filter'
  )?.checked

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

    if (tagFilter) {
      const itemTags = pendingTagsMapCache[item.id] || []
      if (!itemTags.includes(tagFilter)) {
        return false
      }
    }

    // Filtro de Responsável
    if (responsibleFilter) {
      if (item.responsible !== responsibleFilter) {
        return false
      }
    }

    // Filtro de Críticos (>40h ou >2 dias estimados)
    if (criticalFilter) {
      const isCriticalPrecise =
        item.hoursSinceUpdate !== null && item.hoursSinceUpdate >= 40
      const isCriticalEstimated =
        item.estimatedDaysSinceUpdate !== null &&
        item.estimatedDaysSinceUpdate > 2

      if (!isCriticalPrecise && !isCriticalEstimated) {
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
  filteredPendingItems = filteredItems

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
    // Lógica para mostrar o responsável:
    // Mostrar apenas se o filtro de responsável estiver vazio (Todos)
    // E se houver mais de um responsável distinto na lista filtrada.
    const uniqueResponsibles = new Set(
      filteredItems.map(i => i.responsible).filter(Boolean)
    )
    const showResponsible = !responsibleFilter && uniqueResponsibles.size > 1

    container.innerHTML = filteredItems
      .map(item => createPendingCard(item, showResponsible))
      .join('')

    // Attach listeners after rendering cards
    container.querySelectorAll('.ip-add-tag-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        openTagManager(this, this.dataset.pendingId)
      })
    })
  }
  const openAllBtn = sectionElement.querySelector('#open-all-pending-btn')
  if (openAllBtn) {
    const uniqueResponsibleSet = new Set(
      filteredItems.map(i => i.responsible).filter(Boolean)
    )
    const enable = !!responsibleFilter || uniqueResponsibleSet.size === 1
    openAllBtn.disabled = !enable
    openAllBtn.style.opacity = enable ? '1' : '0.5'
    openAllBtn.title = enable
      ? 'Abrir todos os chamados filtrados'
      : 'Filtre por um único responsável para habilitar'
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
  const openAllBtn = sectionElement.querySelector('#open-all-pending-btn')
  if (openAllBtn && !openAllBtn.dataset.bound) {
    openAllBtn.addEventListener('click', () => {
      const itemsToOpen = filteredPendingItems || []
      const count = itemsToOpen.length
      if (count === 0) return
      const proceed = confirm(
        `Você está prestes a abrir ${count} abas. Deseja continuar?`
      )
      if (!proceed) return
      itemsToOpen.forEach(item => {
        if (item.link) window.open(item.link, '_blank')
      })
    })
    openAllBtn.dataset.bound = '1'
  }

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
    const result = await fetchPendingItems()
    
    let activeItems = []
    let activeFilter = null

    if (result.tabs && result.tabs.length > 1) {
      allPendingTabs = result.tabs
      if (!allPendingTabs.some(t => t.id === activePendingTabId)) {
        activePendingTabId = 'all'
      }
      const activeTab = allPendingTabs.find(t => t.id === activePendingTabId) || allPendingTabs[0]
      activeItems = activeTab.items
      activeFilter = activeTab.siteFilter
      
      renderPendingTabs(sectionElement)
    } else {
      allPendingTabs = null
      activePendingTabId = 'all'
      activeItems = result.items || []
      activeFilter = result.siteFilter
      
      const existingTabs = sectionElement.querySelector('.ip-pending-tabs-container')
      if (existingTabs) existingTabs.remove()
    }

    allPendingItems = activeItems

    // Gerenciar Aviso de Filtro do Site com base na guia selecionada
    const currentActiveTab = allPendingTabs 
      ? allPendingTabs.find(t => t.id === activePendingTabId) 
      : { siteFilter: activeFilter, url: null }
      
    manageSiteFilterWarning(sectionElement, currentActiveTab)

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

    // Atualiza o select de filtro de responsável
    const responsibleSelect = sectionElement.querySelector(
      '#pending-responsible-filter'
    )
    if (responsibleSelect) {
      // 1. Tenta recuperar a preferência salva
      const storage = await chrome.storage.local.get(['preferredResponsible'])
      const savedResponsible = storage.preferredResponsible || ''

      // Se a preferência não estiver na lista atual (ex: usuário saiu da lista), mantém o valor atual do select ou vazio
      const currentVal = responsibleSelect.value || savedResponsible

      const responsibles = [
        ...new Set(activeItems.map(i => i.responsible).filter(Boolean))
      ].sort()

      responsibleSelect.innerHTML = `
            <option value="">Todos Responsáveis</option>
            ${responsibles.map(r => `<option value="${escapeHTML(r)}">${escapeHTML(r)}</option>`).join('')}
        `

      // 2. Restaura a seleção se ela existir na lista
      if (responsibles.includes(currentVal)) {
        responsibleSelect.value = currentVal
      } else if (currentVal !== '' && responsibles.length > 0) {
        responsibleSelect.value = ''
        chrome.storage.local.remove('preferredResponsible')
      }

      // Se houver apenas 1 ou nenhum responsável, esconde o filtro pois é desnecessário
      if (responsibles.length <= 1) {
        responsibleSelect.style.display = 'none'
      } else {
        responsibleSelect.style.display = ''
      }
    }

    if (activeItems.length === 0) {
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

function renderPendingTabs(sectionElement) {
  const titleEl = sectionElement.parentNode.querySelector('.ip-section-title') || sectionElement.querySelector('.ip-section-title')
  if (!titleEl) return
  
  let tabsContainer = titleEl.querySelector('.ip-pending-tabs-container')
  if (!tabsContainer) {
    tabsContainer = document.createElement('div')
    tabsContainer.className = 'ip-pending-tabs-container'
    titleEl.appendChild(tabsContainer)
  }
  
  tabsContainer.innerHTML = allPendingTabs.map(tab => {
    const isActive = tab.id === activePendingTabId
    return `
      <button class="ip-pending-tab-btn ${isActive ? 'active' : ''}" 
              data-tab-id="${tab.id}" 
              title="${escapeHTML(tab.name)}">
        ${escapeHTML(tab.name)} <span>(${tab.items.length})</span>
      </button>
    `
  }).join('')

  tabsContainer.querySelectorAll('.ip-pending-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tabId
      activePendingTabId = tabId
      
      const activeTab = allPendingTabs.find(t => t.id === activePendingTabId)
      if (activeTab) {
        allPendingItems = activeTab.items
        
        // Re-render tabs to update active states
        renderPendingTabs(sectionElement)
        
        // Update warning banner for this tab
        manageSiteFilterWarning(sectionElement, activeTab)
        
        // Dynamically update the responsible select filter for the new active tab
        const responsibleSelect = sectionElement.querySelector('#pending-responsible-filter')
        if (responsibleSelect) {
          const currentVal = responsibleSelect.value
          const responsibles = [
            ...new Set(allPendingItems.map(i => i.responsible).filter(Boolean))
          ].sort()
          responsibleSelect.innerHTML = `
                <option value="">Todos Responsáveis</option>
                ${responsibles.map(r => `<option value="${escapeHTML(r)}">${escapeHTML(r)}</option>`).join('')}
            `
          if (responsibles.includes(currentVal)) {
            responsibleSelect.value = currentVal
          } else {
            responsibleSelect.value = ''
          }
          if (responsibles.length <= 1) {
            responsibleSelect.style.display = 'none'
          } else {
            responsibleSelect.style.display = ''
          }
        }

        // Apply filters
        applyPendingFilters(sectionElement)
      }
    })
  })
}

function manageSiteFilterWarning(sectionElement, activeTab) {
  const existingWarning = sectionElement.querySelector('.ip-site-filter-warning')
  if (existingWarning) existingWarning.remove()

  const siteFilter = activeTab.siteFilter
  if (siteFilter && siteFilter.active) {
    const headerRow = sectionElement.querySelector('.ip-pending-header-row')
    if (headerRow) {
      const warningDiv = document.createElement('div')
      warningDiv.className = 'ip-site-filter-warning'
      warningDiv.style.cssText =
        'background: #fff3cd; color: #856404; padding: 8px 12px; margin: 0 10px 10px 10px; border-radius: 4px; border: 1px solid #ffeeba; display: flex; align-items: center; justify-content: space-between; font-size: 12px;'
      warningDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 14px;">⚠️</span>
              <span><strong>Filtro do site ativo:</strong> ${escapeHTML(siteFilter.name || 'Desconhecido')}</span>
          </div>
          <button id="reset-site-filter-btn" class="ip-pulse-warning-btn">CORREÇÃO: Ver Todos</button>
      `
      headerRow.parentNode.insertBefore(warningDiv, headerRow.nextSibling)

      const resetBtn = warningDiv.querySelector('#reset-site-filter-btn')

      resetBtn.addEventListener('click', async () => {
        resetBtn.disabled = true
        const originalText = resetBtn.innerText
        resetBtn.innerText = 'Limpando...'
        warningDiv.style.opacity = '0.7'

        try {
          if (typeof resetSiteFilter === 'function') {
            // Identifica quais URLs precisam ser limpas
            let urlsToClear = []
            if (activeTab.id === 'all') {
              const filteredTabs = allPendingTabs.filter(
                t => t.id !== 'all' && t.siteFilter && t.siteFilter.active
              )
              urlsToClear = filteredTabs.map(t => t.url)
            } else {
              if (activeTab.url) {
                urlsToClear = [activeTab.url]
              } else {
                urlsToClear = [
                  'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html'
                ]
              }
            }

            if (urlsToClear.length > 0) {
              sessionStorage.setItem('tabsToClear', JSON.stringify(urlsToClear))

              const firstUrl = urlsToClear[0]
              const currentUrl = window.location.href
              const targetFiltro = getFiltroParam(firstUrl)
              const currentFiltro = getFiltroParam(currentUrl)
              const isCorrectPage =
                currentUrl.includes('filtro-listas.html') &&
                (!targetFiltro || targetFiltro === currentFiltro)

              if (isCorrectPage) {
                const queue = JSON.parse(sessionStorage.getItem('tabsToClear'))
                queue.shift()
                if (queue.length > 0) {
                  sessionStorage.setItem('tabsToClear', JSON.stringify(queue))
                } else {
                  sessionStorage.removeItem('tabsToClear')
                  sessionStorage.setItem('autoOpenPendingPanel', 'true')
                }

                await resetSiteFilter(firstUrl)
              } else {
                window.location.href = firstUrl
              }
            } else {
              resetBtn.disabled = false
              resetBtn.innerText = originalText
              warningDiv.style.opacity = '1'
            }
          } else {
            throw new Error('Função de limpar filtro não encontrada.')
          }
        } catch (err) {
          console.error(err)
          alert(
            'Não conseguimos limpar o filtro automaticamente. Por favor, limpe manualmente no site de pendências.'
          )
          resetBtn.disabled = false
          resetBtn.innerText = originalText
          warningDiv.style.opacity = '1'
        }
      })
    }
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
 * Converte horas decimais para formato HH:MM
 * @param {number} decimalHours - Horas em formato decimal (ex: 40.5)
 * @returns {string} Tempo formatado como HH:MM
 */
function formatHoursToHHMM(decimalHours) {
  const hours = Math.floor(decimalHours)
  const minutes = Math.round((decimalHours - hours) * 60)
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

/**
 * Cria o HTML para um card de pendência.
 * ATUALIZADO: Suporte a SLA nulo (traço).
 */
function createPendingCard(item, showResponsible = false) {
  const statusClass = getStatusClass(item.status)

  // Tags
  let tagsRenderList = []
  const renderedTagIds = new Set()

  if (item.isPrioritaria) {
    const priorityTag = availableTagsCache.find(
      t => t.name.toLowerCase() === 'prioridade'
    )
    if (priorityTag) {
      tagsRenderList.push(priorityTag)
      renderedTagIds.add(priorityTag.id)
    }
  }
  if (item.isEmSS) {
    const ssTag = availableTagsCache.find(t => t.name.toLowerCase() === 'em ss')
    if (ssTag) {
      tagsRenderList.push(ssTag)
      renderedTagIds.add(ssTag.id)
    }
  }

  const storedTagIds = pendingTagsMapCache[item.id] || []
  storedTagIds.forEach(id => {
    if (renderedTagIds.has(id)) return
    const def = availableTagsCache.find(t => t.id === id)
    if (def) {
      tagsRenderList.push(def)
      renderedTagIds.add(def.id)
    }
  })

  const tagsHtml = tagsRenderList
    .map(tagDef => {
      return `<span class="ip-tag-badge" style="background-color: ${tagDef.color}20; color: ${tagDef.color}; border-color: ${tagDef.color}40;">${escapeHTML(tagDef.name)}</span>`
    })
    .join('')

  const responsibleHtml =
    showResponsible && item.responsible
      ? `<div class="ip-pending-responsible-item" title="Responsável: ${escapeHTML(item.responsible)}" style="margin-left: 8px; font-weight: 600; font-size: 12px; color: var(--text-color-muted); display: flex; align-items: center; gap: 4px; border-left: 1px solid var(--border-color); padding-left: 8px;">
         <span style="font-size: 14px;">👤</span>${escapeHTML(item.responsible)}
       </div>`
      : ''

  // --- LÓGICA DE SLA VISUAL ---
  let slaBadgeHtml = ''
  let slaClass = ''
  let icon = ''
  let styleClass = ''
  let tooltip = ''

  // Visualização baseada na precisão do tempo
  const showHours =
    developerMode &&
    item.hoursSinceUpdate !== null &&
    item.hoursSinceUpdate !== undefined

  // Mostrar dias se não mostrar horas e tiver dias calculados (para usuários comuns OU fallback dev)
  const showDays =
    !showHours && typeof item.estimatedDaysSinceUpdate === 'number'

  if (showHours) {
    const hours = Math.floor(item.hoursSinceUpdate)
    const exactTime = formatHoursToHHMM(item.hoursSinceUpdate)

    if (hours >= 72) {
      icon = '☠️'
      styleClass = 'fatal'
      slaClass = 'border-fatal-time'
      tooltip = `Atrasado (${hours - 48}h além do prazo) | Tempo: ${exactTime}`
    } else if (hours >= 48) {
      icon = '💣'
      styleClass = 'critical'
      slaClass = 'border-critical-time'
      tooltip = `Estourado há ${hours - 48} horas | Tempo: ${exactTime}`
    } else if (hours >= 44) {
      icon = '🔥'
      styleClass = 'urgent'
      slaClass = 'border-urgent-time'
      tooltip = `Faltam ${48 - hours} horas para o prazo | Tempo: ${exactTime}`
    } else if (hours >= 40) {
      icon = '⏳'
      styleClass = 'warning'
      slaClass = 'border-warning-time'
      tooltip = `Atenção: ${hours} horas corridas | Tempo: ${exactTime}`
    } else if (hours >= 30) {
      icon = '👀'
      styleClass = 'notice'
      slaClass = 'border-notice-time'
      tooltip = `Fique atento (${hours}h) | Tempo: ${exactTime}`
    } else {
      icon = '✅'
      styleClass = 'normal'
      slaClass = 'border-normal-time'
      tooltip = `Dentro do prazo (${hours}h) | Tempo: ${exactTime}`
    }

    slaBadgeHtml = `<span class="ip-time-badge ${styleClass}" title="${tooltip}">${icon} ${hours}h</span>`
  } else if (showDays) {
    // Estimativa em DIAS (Visão para Usuário Comum)
    const days = Math.max(0, item.estimatedDaysSinceUpdate)
    icon = '≈'
    styleClass = 'notice'
    tooltip = 'Dias corridos desde o último trâmite'
    slaBadgeHtml = `<span class="ip-time-badge ${styleClass}" title="${tooltip}" style="opacity: 0.6;">${days}D</span>`
  } else if (developerMode) {
    // Caso SLA Indefinido (Solicitação Antiga)
    // Exibe traço e remove borda colorida de urgência (Somente em DEV)
    slaClass = ''
    tooltip = 'Solicitação antiga: cronômetro preciso não iniciado.'
    slaBadgeHtml = `<span class="ip-time-badge normal" title="${tooltip}" style="opacity: 0.6; filter: grayscale(1);">⏱️ -</span>`
  }

  return `
        <div class="ip-pending-card ${statusClass}" data-id="${item.id}">
            <div class="ip-pending-header">
                <div class="ip-pending-id-row" style="width: 100%; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="ip-pending-id" title="N.º da Solicitação: ${escapeHTML(item.id)}">${escapeHTML(item.id)}</span>
                        ${slaBadgeHtml}
                        <span class="ip-meta-item" title="Dias em aberto">📅 ${escapeHTML(item.dias)}d</span>
                        <span class="ip-meta-item" title="Quantidade de trâmites">🔄 ${escapeHTML(item.qtdTramites)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 4px;">
                         <div class="ip-tags-container">${tagsHtml}</div>
                         <button class="ip-add-tag-btn" title="Gerenciar Tags" data-pending-id="${item.id}">🏷️</button>
                         ${responsibleHtml}
                    </div>
                </div>
            </div>
            
            <div class="ip-pending-subject">
                <a href="${escapeHTML(item.link)}" target="_blank" style="color: inherit; text-decoration: none;" title="${escapeHTML(item.subject)}">
                    ${escapeHTML(item.subject)}
                </a>
            </div>

            <div class="ip-pending-footer">
                <span class="ip-pending-status" title="${escapeHTML(item.status)}" style="max-width: 65%;">
                    <span class="ip-status-dot"></span>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.status)}</span>
                </span>
                
                <div style="display: flex; align-items: center; gap: 10px; margin-left: auto;">
                    <div class="ip-date-container" style="text-align: right; font-size: 10px; opacity: 0.7;">
                        <span title="Data de Abertura: ${escapeHTML(item.dataAbertura)}">${escapeHTML(item.dataAbertura)}</span> | <span title="Último Trâmite: ${escapeHTML(item.dataUltimoTramite)}">${escapeHTML(item.dataUltimoTramite)}</span>
                    </div>
                </div>
            </div>
        </div>
    `
}

// #region Avisos (Warnings)
/**
 * Carrega e renderiza os avisos.
 * ATUALIZADO: Suporta forceRefresh
 */
/**
 * Renderiza as tags/pills interativas de canais de avisos.
 */
async function renderChannelPills(sectionElement) {
  const container = sectionElement.querySelector('.warnings-channels-filter')
  if (!container) return

  const storage = await chrome.storage.local.get(['subscribedChannels', 'warningChannels'])
  const activeChannelsList = storage.warningChannels || WARNING_CHANNELS
  let subscribed = storage.subscribedChannels ? [...storage.subscribedChannels] : [...activeChannelsList]
  
  // Geral é sempre selecionado e não pode ser desativado
  if (!subscribed.includes('Geral')) {
    subscribed.push('Geral')
  }

  // Remove pills antigas mantendo o cabeçalho/span
  container.querySelectorAll('.channel-pill').forEach(el => el.remove())

  activeChannelsList.forEach(channel => {
    const isSub = subscribed.includes(channel)
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = `channel-pill ${isSub ? 'active' : ''}`
    pill.textContent = (isSub ? '✓ ' : '') + channel
    
    // Estilos inline para visual premium de acordo com o tema
    pill.style.cssText = `
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 20px;
      border: 1px solid var(--border-color);
      background: ${isSub ? 'var(--primary-color)' : 'var(--background-main)'};
      color: ${isSub ? '#ffffff' : 'var(--text-color-muted)'};
      cursor: ${channel === 'Geral' ? 'default' : 'pointer'};
      transition: all 0.2s ease;
      opacity: ${channel === 'Geral' ? '0.8' : '1'};
      font-family: inherit;
    `

    if (channel !== 'Geral') {
      pill.style.cursor = 'pointer';
      pill.addEventListener('mouseenter', () => {
        if (!subscribed.includes(channel)) {
          pill.style.background = 'var(--background-hover)'
          pill.style.color = 'var(--text-color-main)'
        }
      })
      pill.addEventListener('mouseleave', () => {
        const activeNow = subscribed.includes(channel)
        pill.style.background = activeNow ? 'var(--primary-color)' : 'var(--background-main)'
        pill.style.color = activeNow ? '#ffffff' : 'var(--text-color-muted)'
      })

      pill.addEventListener('click', async (e) => {
        e.preventDefault();
        const idx = subscribed.indexOf(channel)
        if (idx > -1) {
          subscribed.splice(idx, 1)
        } else {
          subscribed.push(channel)
        }
        await chrome.storage.local.set({ subscribedChannels: subscribed })
        
        // Dispara sincronização com o badge
        chrome.runtime.sendMessage({ action: 'UPDATE_NOTIFICATION_BADGE' }).catch(() => {})
        
        // Atualiza botões e recarrega a lista com os filtros atualizados
        await renderChannelPills(sectionElement)
        await loadWarnings(sectionElement, false)
      })
    }

    container.appendChild(pill)
  })
}

async function loadWarnings(sectionElement, forceRefresh = false) {
  let listContainer = sectionElement.querySelector('#warnings-list')
  const activeTab = sectionElement.dataset.activeTab || 'active'

  // Se não existir o listContainer, cria a estrutura inicial
  if (!listContainer) {
    // Cabeçalho da seção com botão de novo aviso (se dev/editor)
    const headerHtml = `
      <div class="ip-section-header" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px;">
              <div class="ip-section-desc" style="margin-bottom: 0;">Fique por dentro dos comunicados e avisos importantes.</div>
              ${(developerMode || window.sgdPermissions?.isEditor) ? `<button id="new-warning-btn" class="ip-add-closing-btn" style="width: auto; white-space: nowrap;">+ Novo Aviso</button>` : ''}
          </div>
          
          <!-- Sub-abas de navegação -->
          <div style="display: flex; gap: 8px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-top: 8px; width: 100%;">
              <button id="warn-tab-active" class="action-btn small-btn" style="background: var(--accent-color, #3b82f6); color: white; border: none; padding: 4px 12px; cursor: pointer; font-size: 11px; border-radius: 4px; font-weight: 600;">Ativos</button>
              <button id="warn-tab-archive" class="action-btn small-btn secondary-btn" style="background: transparent; color: var(--text-color-main); border: 1px solid var(--border-color); padding: 4px 12px; cursor: pointer; font-size: 11px; border-radius: 4px;">Arquivo / Histórico</button>
          </div>

          <!-- Canais de Notificação -->
          <div class="warnings-channels-filter" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding: 12px; background: var(--background-secondary); border: 1px solid var(--border-color); border-radius: 8px; width: 100%;">
              <span style="font-size: 12px; font-weight: 600; color: var(--text-color-main); width: 100%; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
                📬 Meus Canais (Selecione para receber notificações):
              </span>
          </div>
      </div>
      <div id="warnings-list" class="ip-grid">
           <div class="ip-loading-container">
              <div class="ip-spinner"></div>
              <span>Carregando avisos...</span>
          </div>
      </div>
    `

    sectionElement.innerHTML = headerHtml
    listContainer = sectionElement.querySelector('#warnings-list')

    // Listener do botão de criar
    const newBtn = sectionElement.querySelector('#new-warning-btn')
    if (newBtn) {
      newBtn.addEventListener('click', () => openCreateWarningModal(null))
    }

    // Listeners das sub-abas
    const activeBtn = sectionElement.querySelector('#warn-tab-active')
    const archiveBtn = sectionElement.querySelector('#warn-tab-archive')
    
    if (activeBtn && archiveBtn) {
      activeBtn.addEventListener('click', () => {
        sectionElement.dataset.activeTab = 'active'
        activeBtn.style.background = 'var(--accent-color, #3b82f6)'
        activeBtn.style.color = 'white'
        activeBtn.style.border = 'none'
        archiveBtn.style.background = 'transparent'
        archiveBtn.style.color = 'var(--text-color-main)'
        archiveBtn.style.border = '1px solid var(--border-color)'
        loadWarnings(sectionElement, false)
      })
      archiveBtn.addEventListener('click', () => {
        sectionElement.dataset.activeTab = 'archive'
        archiveBtn.style.background = 'var(--accent-color, #3b82f6)'
        archiveBtn.style.color = 'white'
        archiveBtn.style.border = 'none'
        activeBtn.style.background = 'transparent'
        activeBtn.style.color = 'var(--text-color-main)'
        activeBtn.style.border = '1px solid var(--border-color)'
        loadWarnings(sectionElement, false)
      })
    }
  }

  // Renderiza/Atualiza as pills de canais
  await renderChannelPills(sectionElement)

  if (forceRefresh) {
    listContainer.innerHTML = `
      <div class="ip-loading-container">
          <div class="ip-spinner"></div>
          <span>Atualizando...</span>
      </div>
    `
  }

  try {
    if (typeof window.warningsService === 'undefined') {
      throw new Error('Serviço de avisos não carregado.')
    }

    let warnings = await window.warningsService.getWarnings(forceRefresh)
    const isEditor = !!(developerMode || window.sgdPermissions?.isEditor)
    const nowMs = Date.now()
    const nowIso = new Date().toISOString()
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

    // Mapeia e classifica os avisos com flags de estado
    const classified = warnings.map(w => {
      const isArchived = !!w.archived
      const isExpired = w.expiresAt 
        ? (nowMs > new Date(w.expiresAt).getTime())
        : (w.date ? (nowMs - new Date(w.date).getTime() >= SEVEN_DAYS_MS) : false)
      const isScheduled = w.publishedAt ? (nowIso < w.publishedAt) : false

      return {
        ...w,
        isArchived,
        isExpired,
        isScheduled
      }
    })

    // Aplica filtragem baseada na aba ativa (Ativos vs Arquivo)
    if (activeTab === 'active') {
      warnings = classified.filter(w => {
        // Usuários comuns não vêm arquivados, expirados ou agendados no futuro
        if (!isEditor) {
          return !w.isArchived && !w.isExpired && !w.isScheduled
        }
        // Editores vêm agendados na lista de ativos para gerenciamento
        return !w.isArchived && !w.isExpired
      })
    } else {
      // Arquivo/Histórico
      warnings = classified.filter(w => {
        if (!isEditor) {
          return (w.isArchived || w.isExpired) && !w.isScheduled
        }
        return w.isArchived || w.isExpired
      })
    }

    // [NOVO] Filtro de Teste
    if (!developerMode) {
      warnings = warnings.filter(w => !w.isTest || w.onlySelf)
    }

    // [NOVO] Filtro Apenas para o Autor
    const activeUserName = getCurrentUserName();
    warnings = warnings.filter(w => {
      if (w.onlySelf) {
        return w.author && activeUserName && w.author.trim().toLowerCase() === activeUserName.trim().toLowerCase()
      }
      return true
    })

    // --- 2. Filtro de Ignorados (Storage) ---
    const storage = await new Promise(resolve =>
      chrome.storage.local.get(['ignoredWarnings'], resolve)
    )
    const ignoredIds = storage.ignoredWarnings || []
    warnings = warnings.filter(w => !ignoredIds.includes(w.id))

    // --- 2.5 Filtro de Canais Assinados e Permitidos ---
    const subStorage = await chrome.storage.local.get(['subscribedChannels', 'warningChannels'])
    const activeChannelsList = subStorage.warningChannels || WARNING_CHANNELS
    const subscribed = subStorage.subscribedChannels ? [...subStorage.subscribedChannels] : [...activeChannelsList]
    const allowed = window.sgdPermissions?.allowedChannels || [...activeChannelsList]
    warnings = warnings.filter(w => {
      const wChannel = w.channel || 'Geral'
      return subscribed.includes(wChannel) && allowed.includes(wChannel)
    })

    const listContainer = sectionElement.querySelector('#warnings-list')
    if (!listContainer) return

    // Registra recebimento e visualização no Firebase para o usuário logado (apenas para ativos)
    const currentUser = window.sgdPermissions?.currentUser;
    if (currentUser && window.warningsService && activeTab === 'active') {
      warnings.forEach(w => {
        if (!w.isScheduled) {
          if (typeof window.warningsService.recordWarningReceipt === 'function') {
            window.warningsService.recordWarningReceipt(w.id, currentUser);
          }
          if (typeof window.warningsService.recordWarningView === 'function') {
            window.warningsService.recordWarningView(w.id, currentUser);
          }
        }
      });
    }

    // Busca todas as métricas se for Editor
    let allMetrics = {};
    if (isEditor && window.warningsService?.getAllWarningMetrics) {
      try {
        allMetrics = await window.warningsService.getAllWarningMetrics();
      } catch (err) {
        console.warn('[SGD Warnings] Falha ao carregar métricas:', err);
      }
    }

    if (warnings.length === 0) {
      listContainer.innerHTML = `
                <div class="ip-empty-state">
                    <span style="font-size: 24px;">✅</span>
                    <h4>Nenhum aviso no momento</h4>
                    <p>Tudo tranquilo por aqui.</p>
                </div>
            `
      listContainer.style.display = 'flex'
      listContainer.style.justifyContent = 'center'
    } else {
      listContainer.style.display = 'flex'
      listContainer.style.flexDirection = 'column'
      listContainer.style.gap = '16px'
      listContainer.innerHTML = warnings.map(w => createWarningCard(w, allMetrics[w.id] || {})).join('')

      // Adicionar listeners para botões de edição/exclusão (apenas editores)
      if (developerMode || window.sgdPermissions?.isEditor) {
        // Listener para o botão de ver detalhes de métricas
        listContainer.querySelectorAll('.ip-warn-view-metrics-btn').forEach(btn => {
          btn.addEventListener('click', async e => {
            e.stopPropagation();
            const warnId = btn.dataset.id;
            const warning = warnings.find(w => w.id === warnId);
            if (!warning) return;

            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = 'Carregando...';

            try {
              if (window.warningsService?.getWarningMetrics) {
                const metrics = await window.warningsService.getWarningMetrics(warnId);
                openWarningMetricsModal(warning, metrics);
              }
            } catch (err) {
              console.error(err);
              alert('Erro ao carregar detalhes de métricas: ' + err.message);
            } finally {
              btn.disabled = false;
              btn.textContent = originalText;
            }
          });
        });
        listContainer.querySelectorAll('.ip-warn-edit-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            const card = e.target.closest('.ip-card')
            const warnId = card.dataset.id
            // Encontra o objeto completo do array (não temos aqui, mas podemos pegar dos atributos ou recarregar)
            // Melhor: ao renderizar, já colocar os dados no dataset ou buscar do array 'warnings' que está no escopo
            const warning = warnings.find(w => w.id === warnId)
            if (warning) openCreateWarningModal(warning)
          })
        })

        listContainer.querySelectorAll('.ip-warn-delete-btn').forEach(btn => {
          btn.addEventListener('click', async e => {
            if (confirm('Tem certeza que deseja excluir este aviso?')) {
              const card = e.target.closest('.ip-card')
              const warnId = card.dataset.id
              try {
                await window.warningsService.deleteWarning(warnId)
                card.remove()
                // Se não sobrar nada, reload para mostrar empty state
                if (listContainer.children.length === 0)
                  loadWarnings(sectionElement)
              } catch (err) {
                alert('Erro ao excluir: ' + err.message)
              }
            }
          })
        })

        listContainer.querySelectorAll('.ip-warn-archive-btn').forEach(btn => {
          btn.addEventListener('click', async e => {
            e.stopPropagation()
            const card = e.target.closest('.ip-card')
            const warnId = card.dataset.id
            const warning = warnings.find(w => w.id === warnId)
            if (warning) {
              btn.disabled = true
              try {
                await window.warningsService.updateWarning(warnId, { archived: true, title: warning.title })
                showNotification('Aviso arquivado com sucesso!', 'success')
                loadWarnings(sectionElement, false)
              } catch (err) {
                alert('Erro ao arquivar: ' + err.message)
                btn.disabled = false
              }
            }
          })
        })

        listContainer.querySelectorAll('.ip-warn-unarchive-btn').forEach(btn => {
          btn.addEventListener('click', async e => {
            e.stopPropagation()
            const card = e.target.closest('.ip-card')
            const warnId = card.dataset.id
            const warning = warnings.find(w => w.id === warnId)
            if (warning) {
              btn.disabled = true
              try {
                await window.warningsService.updateWarning(warnId, { 
                  archived: false, 
                  expiresAt: null, 
                  date: new Date().toISOString(),
                  title: warning.title
                })
                showNotification('Aviso reativado (desarquivado) com sucesso!', 'success')
                loadWarnings(sectionElement, false)
              } catch (err) {
                alert('Erro ao desarquivar: ' + err.message)
                btn.disabled = false
              }
            }
          })
        })
      }

      // Adicionar listeners para botões de ignorar (para todos)
      listContainer.querySelectorAll('.ip-warn-ignore-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          const card = e.target.closest('.ip-card')
          const warnId = card.dataset.id

          // Salvar no storage
          chrome.storage.local.get(['ignoredWarnings'], result => {
            const ignored = result.ignoredWarnings || []
            if (!ignored.includes(warnId)) {
              ignored.push(warnId)
              chrome.storage.local.set({ ignoredWarnings: ignored }, () => {
                card.style.opacity = '0'
                card.style.transform = 'translateX(20px)'
                card.style.transition = 'all 0.3s ease'
                setTimeout(() => {
                  card.remove()
                  if (listContainer.children.length === 0)
                    loadWarnings(sectionElement)
                }, 300)
              })
            }
          })
        })
      })

      // Verificar indicadores de não lido
      checkUnreadWarnings(warnings)
    }
  } catch (error) {
    console.error(error)
    const listContainer = sectionElement.querySelector('#warnings-list')
    if (listContainer) {
      listContainer.innerHTML = `
                <div class="ip-error-state">
                    <span>⚠️</span>
                    <p>Erro ao carregar avisos.</p>
                </div>
            `
    }
  }
}

// #region Equipe AT (Team Status)
let allTeamMembers = []

/**
 * Carrega e renderiza o status da equipe.
 * @param {HTMLElement} sectionElement - O elemento da seção.
 * @param {boolean} forceRefresh - Se true, força atualização do servidor.
 */
async function loadTeamStatus(sectionElement, forceRefresh = false) {
  const container = sectionElement.querySelector('#team-status-container')
  const footer = sectionElement.querySelector('#team-status-footer')
  const refreshBtn = sectionElement.querySelector('#refresh-team-status-btn')
  const searchInput = sectionElement.querySelector('#team-search')
  const sortSelect = sectionElement.querySelector('#team-sort-filter')
  const statusSelect = sectionElement.querySelector('#team-status-filter')

  if (!container) return

  // Se não for forceRefresh e já tivermos dados, não mostramos spinner completo para evitar flicker
  const hasData = allTeamMembers.length > 0
  if (forceRefresh || !hasData) {
    container.innerHTML = `
      <div class="ip-loading-container">
        <div class="ip-spinner"></div>
        <span>Carregando status da equipe...</span>
      </div>
    `
  }

  if (refreshBtn) {
    refreshBtn.disabled = true
    // Garante que o listener só é adicionado uma vez se for a primeira carga
    if (!refreshBtn.dataset.listenerSet) {
      refreshBtn.addEventListener('click', () =>
        loadTeamStatus(sectionElement, true)
      )
      refreshBtn.dataset.listenerSet = 'true'
    }
  }

  try {
    // Busca dados se for forceRefresh ou se o cache estiver vazio
    if (forceRefresh || !hasData) {
      if (typeof window.teamService === 'undefined') {
        throw new Error('Serviço de status da equipe não carregado.')
      }

      let data
      if (forceRefresh) {
        data = await window.teamService.refreshTeamStatus()
      } else {
        data = await window.teamService.getTeamStatus()
      }

      const rawMembers = data?.members || []
      const timestamp = data?.timestamp

      // Unificação e Deduplicação inicial
      const seen = new Set()
      allTeamMembers = rawMembers.filter(m => {
        const key = m.name?.trim().toLowerCase().replace(/\s+/g, ' ') || ''
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Atualiza timestamp no topo
      const timestampSpan = sectionElement.querySelector(
        '#team-status-timestamp'
      )
      if (timestampSpan) {
        if (timestamp) {
          const formattedTime =
            window.teamService.formatTeamStatusTimestamp(timestamp)
          
          const lastUpdateDate = new Date(timestamp)
          const timeDiffMs = Date.now() - lastUpdateDate.getTime()
          const isOutdated = !isNaN(timeDiffMs) && timeDiffMs > 60 * 60 * 1000

          if (isOutdated) {
            const hours = Math.floor(timeDiffMs / (1000 * 60 * 60))
            const minutes = Math.floor((timeDiffMs % (1000 * 60 * 60)) / (1000 * 60))
            const timeAgoText = hours > 0 ? `${hours}h e ${minutes}m` : `${minutes}m`
            timestampSpan.innerHTML = `🕐 <strong>${formattedTime}</strong> <span class="ip-timestamp-alert-badge" title="Os dados não são atualizados há ${timeAgoText}">⚠️ Desatualizado (${hours}h+)</span>`
            timestampSpan.style.color = 'var(--action-red)'
          } else {
            timestampSpan.innerHTML = `🕐 <strong>${formattedTime}</strong>`
            timestampSpan.style.color = 'var(--text-color-muted)'
          }
          timestampSpan.title = 'Última atualização recebida'
        } else {
          timestampSpan.innerHTML = ''
          timestampSpan.style.color = 'var(--text-color-muted)'
        }
      }

      // Oculta footer se tiver dados, mostra apenas se estiver aguardando inicialização
      if (footer) {
        if (!timestamp) {
          footer.innerHTML = '⚠️ Aguardando dados...'
          footer.style.display = 'block'
        } else {
          footer.style.display = 'none'
        }
      }
    }

    // --- APLICAÇÃO DE FILTROS E ORDENAÇÃO ---

    // 1. Busca preferências (PIN, HIDE, WATCH, VIEW_MODE)
    const prefs = await chrome.storage.local.get([
      'pinnedTechnicians',
      'hiddenTechnicians',
      'monitoredTechnicians',
      'teamViewMode'
    ])
    const pinnedList = Array.isArray(prefs.pinnedTechnicians)
      ? prefs.pinnedTechnicians
      : []
    const hiddenList = Array.isArray(prefs.hiddenTechnicians)
      ? prefs.hiddenTechnicians
      : []
    const monitoredList = Array.isArray(prefs.monitoredTechnicians)
      ? prefs.monitoredTechnicians
      : []
    const isCompactMode = prefs.teamViewMode === 'compact'

    // Aplica o modo de visualização no container
    if (isCompactMode) {
      container.classList.add('view-compact')
    } else {
      container.classList.remove('view-compact')
    }

    // 2. Filtro de Busca
    const searchTerm = searchInput?.value?.toLowerCase()?.trim() || ''
    let filteredMembers = allTeamMembers.filter(m => {
      const name = m.name?.toLowerCase() || ''
      return name.includes(searchTerm)
    })

    // 2a. Filtro de Status Específico
    const statusFilterValue = statusSelect?.value || 'all'
    if (statusFilterValue !== 'all') {
      filteredMembers = filteredMembers.filter(m => {
        const status = (m.currentStatus || '').trim().toLowerCase()
        const isNaFila =
          status === 'conversando' ||
          status === 'ocioso' ||
          status.includes('na fila')
        const isSemStatus = !status

        if (statusFilterValue === 'na-fila') return isNaFila
        if (statusFilterValue === 'sem-status') return isSemStatus
        if (statusFilterValue === 'fora-fila') return !isNaFila && !isSemStatus
        return true
      })
    }

    // 3. Enriquecer com flags de preferência
    filteredMembers.forEach(m => {
      const key = m.name?.trim().toLowerCase().replace(/\s+/g, ' ') || ''
      m.isPinned = pinnedList.includes(key)
      m.isHidden = hiddenList.includes(key)
      m.isMonitored = monitoredList.includes(key)
    })

    // 3. Verifica alertas para técnicos monitorados
    checkTeamAlerts(filteredMembers)

    // 4. Ordenação
    const sortValue = sortSelect?.value || 'not-ready'

    filteredMembers.sort((a, b) => {
      // Prioridade global: Fixados (Pinned) -> Resto -> Ocultos (Hidden)
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      if (a.isHidden && !b.isHidden) return 1
      if (!a.isHidden && b.isHidden) return -1

      // Dentro de cada categoria, aplica a ordenação escolhida
      if (sortValue === 'name') {
        return a.name.localeCompare(b.name)
      } else if (sortValue === 'time') {
        // Assume formato HH:MM:SS para duração
        const timeA = a.duration || '00:00:00'
        const timeB = b.duration || '00:00:00'
        return timeB.localeCompare(timeA)
      } else {
        // Padrão: Not Ready (%)
        return (b.percentNotReady || 0) - (a.percentNotReady || 0)
      }
    })

    // Renderiza lista
    if (filteredMembers.length === 0) {
      container.innerHTML = `
        <div class="ip-empty-state">
          <span style="font-size: 24px;">🔍</span>
          <h4>Nenhum técnico encontrado</h4>
          <p>${searchTerm ? 'Tente mudar o termo da busca.' : 'A lista está vazia.'}</p>
        </div>
      `
      container.style.display = 'flex'
    } else {
      container.style.display = 'grid'
      container.style.gridTemplateColumns =
        'repeat(auto-fill, minmax(220px, 1fr))'
      container.style.gap = '12px'
      container.innerHTML = filteredMembers.map(createTeamMemberCard).join('')
    }

    // --- CÁLCULO DE ESTATÍSTICAS (Baseado nos itens FILTRADOS, mas contagem global é melhor para resumo) ---
    // O usuário pediu "Total de técnicos que estão sendo demonstrados na listagem", então usamos filteredMembers para o Total
    // Mas Na Fila/Fora da Fila geralmente queremos do todo ou do filtro? Vamos assumir do filtro atual para ser consistente com "Total".

    let countNaFila = 0
    let countForaFila = 0
    let countSemStatus = 0

    filteredMembers.forEach(m => {
      const status = (m.currentStatus || '').trim()
      const statusLower = status.toLowerCase()

      if (!status) {
        countSemStatus++
      } else if (
        statusLower === 'conversando' ||
        statusLower === 'ocioso' ||
        statusLower.includes('na fila')
      ) {
        countNaFila++
      } else {
        countForaFila++
      }
    })

    const statsBar = sectionElement.querySelector('#team-stats-bar')
    if (statsBar) {
      statsBar.innerHTML = `
        <div style="display: flex; align-items: center; gap: 3px; color: var(--text-color-main);" title="Total de técnicos listados">
          <span style="font-size: 10px;">👥</span> <strong>${filteredMembers.length}</strong> <span style="font-size: 9px;">Total</span>
        </div>
        <div style="width: 1px; height: 10px; background: var(--border-color); margin: 0 2px;"></div>
        <div style="display: flex; align-items: center; gap: 3px; color: var(--action-green);" title="Técnicos Na Fila: Conversando, Ocioso ou Na Fila">
          <span style="font-size: 8px;">🟢</span> <strong>${countNaFila}</strong> <span style="font-size: 9px;">Na Fila</span>
        </div>
        <div style="width: 1px; height: 10px; background: var(--border-color); margin: 0 2px;"></div>
        <div style="display: flex; align-items: center; gap: 3px; color: var(--action-yellow-hover);" title="Técnicos Fora da Fila: Pausa, Refeição, etc">
          <span style="font-size: 8px;">🔴</span> <strong>${countForaFila}</strong> <span style="font-size: 9px;">Fora</span>
        </div>
        <div style="width: 1px; height: 10px; background: var(--border-color); margin: 0 2px;"></div>
        <div style="display: flex; align-items: center; gap: 3px; color: var(--text-color-muted);" title="Sem Status Definido: Vazio ou nulo">
          <span style="font-size: 8px;">⚪</span> <strong>${countSemStatus}</strong> <span style="font-size: 9px;">N/A</span>
        </div>
      `
    }
  } catch (error) {
    console.error('[Team Status] Erro:', error)
    container.innerHTML = `
      <div class="ip-error-state">
        <span class="ip-error-icon">⚠️</span>
        <h4>Erro ao carregar status</h4>
        <p>${escapeHTML(error.message)}</p>
      </div>
    `
  } finally {
    if (refreshBtn) refreshBtn.disabled = false
  }
}

function createTeamMemberCard(member) {
  const badgeClass =
    window.teamService?.getTeamStatusBadgeClass(member.percentNotReady) ||
    'badge-success'
  const statusEmoji =
    window.teamService?.getTeamStatusEmoji(member.status) || '⚪'

  // Define a cor da porcentagem baseado na gravidade
  let percentColor = 'var(--action-green)' // Padrão: verde
  if (member.percentNotReady > 20) {
    percentColor = 'var(--action-red)'
  } else if (member.percentNotReady > 16) {
    percentColor = 'var(--action-yellow)'
  }

  // Verifica status Fora da Fila
  const statusStr = (member.currentStatus || '').trim().toLowerCase()
  const isNaFila =
    statusStr === 'conversando' ||
    statusStr === 'ocioso' ||
    statusStr.includes('na fila')
  const isSemStatus = !statusStr
  const isForaFila = !isNaFila && !isSemStatus

  return `
    <div class="ip-card ip-team-member-card ${member.isPinned ? 'is-pinned' : ''} ${member.isHidden ? 'is-dimmed' : ''} ${isForaFila ? 'is-fora-fila' : ''}" 
         style="padding: 12px; border-left: 4px solid ${percentColor} !important;"
         data-name="${escapeHTML(member.name)}">
      
      <div style="display: flex; flex-direction: column; gap: 6px;">
        
        <!-- Linha 1: Nome e Badge -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between;">
           <div style="font-weight: 600; font-size: 13px; color: var(--text-color-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;" title="${escapeHTML(member.name)}">
              ${escapeHTML(member.name)}
           </div>
           <span class="ip-card-badge ${badgeClass}" style="font-size: 10px; padding: 2px 6px; flex-shrink: 0;">
              ${statusEmoji} ${escapeHTML(member.status)}
           </span>
        </div>

        <!-- Linha 2 e Detalhes -->
        <div style="font-size: 11px; color: var(--text-color-muted); display: flex; flex-direction: column; gap: 2px;" class="ip-team-details">
            
            <!-- Linha de Indisponibilidade + Ações -->
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-weight: 600; color: ${percentColor};">📊 ${escapeHTML(member.percentFormatted)} Indisponível</span>
              
              <div class="ip-card-quick-actions">
                <button class="ip-action-icon-btn watch-btn ${member.isMonitored ? 'active-watch' : ''}" title="${member.isMonitored ? 'Parar monitoramento' : 'Alertar se crítico'}" style="${member.isMonitored ? 'opacity: 1; color: var(--action-blue);' : ''}">
                  ${member.isMonitored ? '🔔' : '🔕'}
                </button>
                <button class="ip-action-icon-btn pin-btn ${member.isPinned ? 'active-pin' : ''}" title="${member.isPinned ? 'Desafixar técnico' : 'Fixar técnico no topo'}">
                  📌
                </button>
                <button class="ip-action-icon-btn hide-btn ${member.isHidden ? 'active-hide' : ''}" title="${member.isHidden ? 'Mostrar técnico normalmente' : 'Ocultar técnico no final'}">
                  ${member.isHidden ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <span class="ip-compact-hidden">${member.presence ? `📍 Presença: <strong>${escapeHTML(member.presence)}</strong>` : ''}</span>
            <span class="ip-compact-hidden">${member.currentStatus ? `💬 Status: <strong>${escapeHTML(member.currentStatus)}</strong>` : ''}</span>
            <span class="ip-compact-hidden">${member.duration && member.duration !== '00:00:00' ? `⏱️ Tempo: <strong>${escapeHTML(member.duration)}</strong>` : ''}</span>
        </div>

      </div>
    </div>
  `
}

// Funções para gerenciar PIN, HIDE e WATCH
async function toggleTechnicianPreference(name, type) {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ')
  let storageKey
  if (type === 'pin') storageKey = 'pinnedTechnicians'
  else if (type === 'hide') storageKey = 'hiddenTechnicians'
  else if (type === 'watch') storageKey = 'monitoredTechnicians'

  const result = await chrome.storage.local.get([storageKey])
  let list = Array.isArray(result[storageKey]) ? result[storageKey] : []

  if (list.includes(key)) {
    list = list.filter(item => item !== key)
  } else {
    list.push(key)

    // Lógica exclusiva para pin/hide (watch é independente)
    if (type !== 'watch') {
      const otherKey =
        type === 'pin' ? 'hiddenTechnicians' : 'pinnedTechnicians'
      const otherResult = await chrome.storage.local.get([otherKey])
      let otherList = Array.isArray(otherResult[otherKey])
        ? otherResult[otherKey]
        : []
      if (otherList.includes(key)) {
        otherList = otherList.filter(item => item !== key)
        await chrome.storage.local.set({ [otherKey]: otherList })
      }
    } else {
      // Se ativou o monitoramento (watch), solicita permissão de notificação se necessário
      if (
        'Notification' in window &&
        Notification.permission !== 'granted' &&
        Notification.permission !== 'denied'
      ) {
        Notification.requestPermission()
      }
    }
  }

  await chrome.storage.local.set({ [storageKey]: list })

  // Recarrega apenas a seção de status da equipe
  const section = document.querySelector('#ip-section-team-status')
  if (section) loadTeamStatus(section, false)
}

// Verifica alertas para técnicos monitorados
function checkTeamAlerts(members) {
  members.forEach(m => {
    if (m.isMonitored && m.percentNotReady > 20) {
      // Verifica se já notificou recentemente para evitar spam (cache em memória ou storage)
      const alertKey = `alert_${m.name}_${new Date().getHours()}`
      if (!sessionStorage.getItem(alertKey)) {
        const message = `⚠️ ${m.name} atingiu ${m.percentFormatted} de indisponibilidade!`

        // Notificação Nativa do Navegador (Web API)
        if ('Notification' in window && Notification.permission === 'granted') {
          const notification = new Notification('Alerta de Indisponibilidade', {
            body: message,
            icon: chrome.runtime.getURL('icons/icon128.png'),
            requireInteraction: true,
            tag: alertKey // Evita duplicação nativa se suportado
          })

          // Fecha automaticamente após 75 segundos (75000 ms)
          setTimeout(() => {
            notification.close()
          }, 75000)
        } else {
          // Fallback para toast interno se permissão negada
          showNotification(message, 'warning')
        }

        sessionStorage.setItem(alertKey, 'true')
      }
    }
  })
}

// Event delegation para os botões do card
document.addEventListener('click', e => {
  const pinBtn = e.target.closest('.pin-btn')
  const hideBtn = e.target.closest('.hide-btn')
  const watchBtn = e.target.closest('.watch-btn')

  if (pinBtn || hideBtn || watchBtn) {
    const card = e.target.closest('.ip-team-member-card')
    const name = card?.dataset.name
    if (name) {
      let type = 'pin'
      if (hideBtn) type = 'hide'
      if (watchBtn) type = 'watch'
      toggleTechnicianPreference(name, type)
    }
  }
})

// --- MONITORAMENTO EM BACKGROUND ---
let backgroundMonitorInterval = null

async function runBackgroundMonitoring() {
  // Se o painel estiver aberto e visível, o loadTeamStatus já cuida disso (evita chamada dupla)
  // Mas para garantir, podemos verificar se o painel existe no DOM
  const panelExists = document.getElementById('info-panel-modal')
  if (panelExists) return

  // --- VERIFICAÇÃO DE HORÁRIO ---
  // Horários alvo: 09:30, 10:30, 11:30, 14:30, 15:30, 16:30
  // Tolerância: +/- 1 minuto para garantir execução
  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()

  // Lista de horários permitidos (Hora, Minuto)
  const allowedTimes = [
    { h: 9, m: 30 },
    { h: 10, m: 30 },
    { h: 11, m: 30 },
    { h: 14, m: 30 },
    { h: 15, m: 30 },
    { h: 16, m: 30 }
  ]

  const isTargetTime = allowedTimes.some(time => {
    return (
      currentHour === time.h &&
      currentMinute >= time.m &&
      currentMinute <= time.m + 2
    )
  })

  if (!isTargetTime) {
    // Se não for horário alvo, não executa nada pesado
    return
  }

  // Verifica se já rodou neste horário (evita spam no minuto de tolerância)
  const lastRunKey = `monitor_last_run_${currentHour}_${Math.floor(currentMinute / 10)}`
  if (sessionStorage.getItem(lastRunKey)) return
  sessionStorage.setItem(lastRunKey, 'true')

  try {
    // Verifica se há técnicos monitorados antes de fazer requisição
    const prefs = await chrome.storage.local.get(['monitoredTechnicians'])
    const monitoredList = Array.isArray(prefs.monitoredTechnicians)
      ? prefs.monitoredTechnicians
      : []

    if (monitoredList.length === 0) return // Ninguém pra monitorar, economiza recursos

    if (typeof window.teamService === 'undefined') return

    // Busca dados silenciosamente
    const data = await window.teamService.getTeamStatus() // Usa cache se possível ou busca novo
    // Para monitoramento real, talvez devêssemos forçar refresh se o cache for velho?
    // O teamService.getTeamStatus() geralmente tem cache de 1min. Se quisermos background real,
    // podemos usar refreshTeamStatus se o lastUpdate for muito antigo.
    // Por enquanto, vamos confiar na lógica padrão do serviço.

    let members = data?.members || []

    // Filtra apenas os monitorados para checagem
    const monitoredMembers = members.filter(m => {
      const key = m.name?.trim().toLowerCase().replace(/\s+/g, ' ') || ''
      return monitoredList.includes(key)
    })

    // Marca flag para o checkTeamAlerts funcionar
    monitoredMembers.forEach(m => (m.isMonitored = true))

    checkTeamAlerts(monitoredMembers)
  } catch (error) {
    console.warn('[Background Monitor] Erro ao verificar status:', error)
  }
}

// Inicia o monitoramento (executa a cada 60 segundos)
if (!backgroundMonitorInterval) {
  backgroundMonitorInterval = setInterval(runBackgroundMonitoring, 60000)
  // Executa uma vez após 5s para garantir inicialização
  setTimeout(runBackgroundMonitoring, 5000)
}
// #endregion Status da Equipe

/**
 * Processa HTML seguro (White-list simples)
 * Permite: b, strong, i, em, u, br, p, ul, ol, li, a (com href)
 */
function processSafeHTML(text) {
  if (!text) return ''

  // 1. Escapa tudo para neutralizar scripts e tags não permitidas
  let safe = escapeHTML(text)

  // Restaura entidades HTML originais (ex: &nbsp;, &amp;, &lt;, &gt;) para evitar exibição de caracteres indesejados
  safe = safe.replace(/&amp;([a-zA-Z0-9#]+);/g, '&$1;')

  // 2. Des-escapa tags permitidas (sem atributos, exceto A)
  // Tags simples: <b>, </b>, <strong>, </strong>, etc.
  const tags = ['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'div', 'span', 'font', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
  tags.forEach(tag => {
    // Regex para abrir e fechar
    // <tag> -> &lt;tag&gt;
    const regexOpen = new RegExp(`&lt;${tag}&gt;`, 'gi')
    safe = safe.replace(regexOpen, `<${tag}>`)

    // </tag> -> &lt;/tag&gt;
    const regexClose = new RegExp(`&lt;/${tag}&gt;`, 'gi')
    safe = safe.replace(regexClose, `</${tag}>`)
  })

  // 3. Trata tag <a href="..."> especificamente
  // Formato escapado: &lt;a\s+href=&quot;(.*?)&quot;&gt;
  safe = safe.replace(
    /&lt;a\s+href=&quot;(.*?)&quot;.*?&gt;/gi,
    (match, url) => {
      let fixedUrl = url.trim()
      // Se não começa com protocolo ou barra (link relativo ao site), adiciona https://
      if (fixedUrl && !/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(fixedUrl)) {
        fixedUrl = 'https://' + fixedUrl
      }
      return `<a href="${fixedUrl}" target="_blank">`
    }
  )
  safe = safe.replace(/&lt;\/a&gt;/gi, '</a>')

  // 4. Trata tag <img ...> especificamente
  // Permitir src, alt e style.
  // Regex generosa para capturar atributos comuns escapados
  safe = safe.replace(/&lt;img\s+(.*?)&gt;/gi, (match, attrs) => {
    // Des-escapar aspas para os atributos funcionarem
    let fixedAttrs = attrs.replace(/&quot;/g, '"')
    // Limpeza de segurança básica: garantir que não tenha eventos on...
    if (/on\w+\s*=/i.test(fixedAttrs) || /javascript:/i.test(fixedAttrs)) {
      return '' // Recusa se tiver script
    }
    return `<img ${fixedAttrs}>`
  })

  // 5. Trata tags com atributos específicos para estilização e estrutura (como style, color, size, data-teams, etc.)
  safe = safe.replace(/&lt;(span|div|p|font|h1|h2|h3|h4|h5|h6|hr|ul|ol|li)\s+(.*?)&gt;/gi, (match, tag, attrs) => {
    const decodedAttrs = attrs.replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()
    // Segurança: se tiver eventos on... ou link de javascript:, remove atributos
    if (/on\w+\s*=/i.test(decodedAttrs) || /javascript:/i.test(decodedAttrs)) {
      return `<${tag}>`
    }
    return `<${tag} ${decodedAttrs}>`
  })

  // Mantém quebras de linha normais como <br> se não estiverem dentro de tags que já dão bloco?
  // O usuário pode usar <br> explícito agora. Mas para compatibilidade com texto plano antigo:
  // Se o texto não parece ter tags HTML, talvez devêssemos converter \n.
  // Mas o usuário pediu suporte a HTML, então <br> é esperado.
  // Vamos converter \n apenas se não houver tags de bloco detectadas para evitar duplicação ou quebra de layout?
  // Simples: converte \n para <br> E deixa os <br> explícitos.
  safe = safe.replace(/\n/g, '<br>')

  return safe
}

/**
 * Cria o HTML do card de aviso
 */
function createWarningCard(warning, metrics = {}) {
  const typeClass =
    warning.type === 'danger'
      ? 'badge-danger'
      : warning.type === 'warning'
        ? 'badge-warning'
        : warning.type === 'success'
          ? 'badge-success'
          : 'badge-info'

  const typeLabel =
    warning.type === 'danger'
      ? 'Importante'
      : warning.type === 'warning'
        ? 'Alerta'
        : warning.type === 'success'
          ? 'Novidade'
          : 'Informativo'

  // Formata a data (timestamp string do Firestore ISO)
  let dateStr = 'Data desconhecida'
  if (warning.date) {
    try {
      const date = new Date(warning.date)
      dateStr = date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch (e) { }
  }

  const messageHtml = processSafeHTML(warning.message || '')

  // Autor só aparece no modo desenvolvedor
  const authorHtml = developerMode
    ? `
        <div style="font-size: 11px; color: var(--text-color-muted); display: flex; align-items: center; gap: 4px;">
            ✍️ ${escapeHTML(warning.author || 'Usuário')}
        </div>
    `
    : ''

  const ignoreBtn = `<button class="ip-warn-ignore-btn" style="background:none; border:none; cursor:pointer; font-size:11px; color: var(--text-color-muted); text-decoration: underline; padding: 0; margin-right: 4px;" title="Não mostrar novamente">Ocultar</button>`

  // [NOVO] Badge de Teste
  const testBadge = warning.isTest
    ? `<span style="background-color: #607d8b; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 6px; border: 1px dashed white;">TESTE / DEV</span>`
    : ''

  const channelBadge = `<span class="ip-card-badge" style="background-color: var(--background-secondary); border: 1px solid var(--border-color); color: var(--text-color-muted); font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: normal; margin-left: 4px;">${escapeHTML(warning.channel || 'Geral')}</span>`

  const isArchived = warning.isArchived || warning.isExpired
  const archiveBtn = (developerMode || window.sgdPermissions?.isEditor)
    ? (isArchived
        ? `<button class="ip-warn-unarchive-btn" style="background:none; border:none; cursor:pointer; font-size:14px; padding:0; line-height:1; margin-right:4px;" title="Desarquivar (Mover para Ativos)">📤</button>`
        : `<button class="ip-warn-archive-btn" style="background:none; border:none; cursor:pointer; font-size:14px; padding:0; line-height:1; margin-right:4px;" title="Arquivar">📥</button>`
      )
    : ''

  const actionsHtml = `
        <div style="display:flex; gap:10px; align-items:center;">
            ${testBadge} ${ignoreBtn}
            ${(developerMode || window.sgdPermissions?.isEditor)
      ? `
                ${archiveBtn}
                <button class="ip-warn-edit-btn" style="background:none; border:none; cursor:pointer; font-size:14px; padding:0; line-height:1;" title="Editar">✏️</button>
                <button class="ip-warn-delete-btn" style="background:none; border:none; cursor:pointer; font-size:14px; padding:0; line-height:1;" title="Excluir">🗑️</button>
            `
      : ''
    }
            ${channelBadge}
            <span class="ip-card-badge ${typeClass}">${escapeHTML(typeLabel)}</span>
        </div>
    `

  // Exibição de métricas para editores
  let metricsHtml = ''
  if (developerMode || window.sgdPermissions?.isEditor) {
    const receiptsCount = Object.keys(metrics.receipts || {}).length
    const viewsCount = Object.keys(metrics.views || {}).length
    metricsHtml = `
      <div class="ip-warn-metrics" style="margin-top: 8px; padding: 6px 10px; background: var(--background-secondary); border: 1px solid var(--border-color); border-radius: 4px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <span>📊 <b>Métricas:</b> <span style="color: var(--action-blue, #3b82f6); font-weight: 700;">${receiptsCount}</span> Receberam | <span style="color: var(--action-green, #22c55e); font-weight: 700;">${viewsCount}</span> Visualizaram</span>
        <button class="ip-warn-view-metrics-btn" data-id="${escapeHTML(warning.id)}" style="background: none; border: none; color: var(--primary-color, #6366f1); font-weight: bold; cursor: pointer; padding: 0; font-size: 11px; text-decoration: underline; font-family: inherit;">Ver Detalhes</button>
      </div>
    `
  }

  let scheduleHtml = ''
  if (developerMode || window.sgdPermissions?.isEditor) {
    if (warning.publishedAt) {
      const pDate = new Date(warning.publishedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      scheduleHtml += `<span style="color: #e67e22; font-weight: bold; margin-right: 10px;" title="Agendado para esta data">📅 Agendado: ${pDate}</span>`
    }
    if (warning.expiresAt) {
      const eDate = new Date(warning.expiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      scheduleHtml += `<span style="color: #e74c3c; font-weight: bold;" title="Expira nesta data">⏳ Expira: ${eDate}</span>`
    }
  }

  return `
        <div class="ip-card ip-card-${warning.type || 'info'}" data-id="${warning.id}" ${warning.isTest ? 'style="border-style: dashed;"' : ''}>
            <div class="ip-card-header">
                <h4 class="ip-card-title">${warning.title || 'Aviso'}</h4>
                ${actionsHtml}
            </div>
            <div class="ip-card-content">${messageHtml}</div>
            ${metricsHtml}
            <div class="ip-card-updated" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--border-color);">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span>🕒 Criado: ${dateStr}</span>
                    ${scheduleHtml ? `<div style="margin-top: 4px; font-size: 10px; display: flex; flex-wrap: wrap; gap: 4px;">${scheduleHtml}</div>` : ''}
                </div>
                ${authorHtml}
            </div>
        </div>
    `
}

/**
 * Abre modal com os detalhes de métricas de recebimento e visualização do aviso
 */
function openWarningMetricsModal(warning, metrics) {
  const receipts = Object.values(metrics.receipts || {});
  const views = Object.values(metrics.views || {});

  // Ordena por data decrescente
  receipts.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  views.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  const formatDate = (isoString) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '—';
    }
  };

  const receiptsRows = receipts.length > 0
    ? receipts.map(r => `
        <tr style="border-bottom: 1px solid var(--border-color, #e5e7eb);">
          <td style="padding: 8px; font-size: 12px; color: var(--text-color-main);">${escapeHTML(r.name)}</td>
          <td style="padding: 8px; font-size: 12px; color: var(--text-color-muted); text-align: right; white-space: nowrap;">${formatDate(r.timestamp)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="2" style="padding: 16px; font-size: 12px; color: var(--text-color-muted); text-align: center;">Nenhum registro de recebimento.</td></tr>`;

  const viewsRows = views.length > 0
    ? views.map(v => `
        <tr style="border-bottom: 1px solid var(--border-color, #e5e7eb);">
          <td style="padding: 8px; font-size: 12px; color: var(--text-color-main);">${escapeHTML(v.name)}</td>
          <td style="padding: 8px; font-size: 12px; color: var(--text-color-muted); text-align: right; white-space: nowrap;">${formatDate(v.timestamp)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="2" style="padding: 16px; font-size: 12px; color: var(--text-color-muted); text-align: center;">Nenhum registro de visualização.</td></tr>`;

  const modalHtml = `
    <div style="padding: 10px; max-height: 650px; display: flex; flex-direction: column;">
      <p style="font-size: 13px; color: var(--text-color-muted); margin-bottom: 15px; margin-top: 0;">
        Alcance do aviso: <b>"${escapeHTML(warning.title)}"</b>
      </p>
      
      <div style="display: flex; gap: 16px; align-items: stretch; overflow: hidden; flex: 1;">
        <!-- Tabela Recebidos -->
        <div style="flex: 1; background: var(--background-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column;">
          <h5 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: var(--action-blue, #3b82f6); display: flex; justify-content: space-between;">
            <span>📬 Receberam</span>
            <span>${receipts.length}</span>
          </h5>
          <div style="overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; flex: 1; min-height: 250px; max-height: 400px;">
            <table style="width: 100%; border-collapse: collapse; background: var(--background-main);">
              <thead>
                <tr style="background: var(--background-secondary); border-bottom: 1px solid var(--border-color); position: sticky; top: 0; z-index: 1;">
                  <th style="padding: 8px; font-size: 11px; text-align: left; color: var(--text-color-muted); background: var(--background-secondary);">Usuário</th>
                  <th style="padding: 8px; font-size: 11px; text-align: right; color: var(--text-color-muted); background: var(--background-secondary);">Quando</th>
                </tr>
              </thead>
              <tbody>
                ${receiptsRows}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Tabela Visualizados -->
        <div style="flex: 1; background: var(--background-secondary); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; display: flex; flex-direction: column;">
          <h5 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 700; color: var(--action-green, #22c55e); display: flex; justify-content: space-between;">
            <span>👁️ Visualizaram</span>
            <span>${views.length}</span>
          </h5>
          <div style="overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; flex: 1; min-height: 250px; max-height: 400px;">
            <table style="width: 100%; border-collapse: collapse; background: var(--background-main);">
              <thead>
                <tr style="background: var(--background-secondary); border-bottom: 1px solid var(--border-color); position: sticky; top: 0; z-index: 1;">
                  <th style="padding: 8px; font-size: 11px; text-align: left; color: var(--text-color-muted); background: var(--background-secondary);">Usuário</th>
                  <th style="padding: 8px; font-size: 11px; text-align: right; color: var(--text-color-muted); background: var(--background-secondary);">Quando</th>
                </tr>
              </thead>
              <tbody>
                ${viewsRows}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
        <button id="close-metrics-btn" class="ip-add-closing-btn" style="width: auto; padding: 8px 20px;">Fechar</button>
      </div>
    </div>
  `;

  const modal = createModal(
    'Métricas do Aviso',
    modalHtml,
    null,
    {
      isManagementModal: false,
      modalId: 'warning-metrics-modal',
      showShareButton: false
    }
  );

  const defaultActions = modal.querySelector('.se-modal-actions');
  if (defaultActions) defaultActions.remove();

  modal.style.zIndex = '10003';

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#close-metrics-btn');
  const xBtn = modal.querySelector('.se-close-modal-btn');

  const cleanup = () => modal.remove();

  if (closeBtn) closeBtn.addEventListener('click', cleanup);
  if (xBtn) xBtn.addEventListener('click', cleanup);
}

/**
 * Verifica avisos não lidos e atualiza indicador visual no sidebar
 */
function checkUnreadWarnings(warnings) {
  if (!warnings || warnings.length === 0) return

  chrome.storage.local.get(['warningsLastReadTime'], result => {
    const lastRead = result.warningsLastReadTime || 0
    const newestWarning = warnings[0] // Assumindo ordenação por data desc

    if (newestWarning && newestWarning.date) {
      const newestDate = new Date(newestWarning.date).getTime()
      if (newestDate > lastRead) {
        // Tem aviso novo!
        // Achar o ícone na sidebar e colocar a bolinha (via classe CSS)
        // Como o modal pode ser recriado, precisamos garantir que o seletor funcione
        const navItem = document.querySelector('#ip-nav-notices .ip-nav-icon')
        // Mas espere, o seletor #ip-nav-notices precisa existir. Vamos adicionar ID no ip-nav-item
        if (navItem) {
          navItem.classList.add('has-unread-warnings')

          // Adicionar estilo inline se CSS não tiver carregado (fallback)
          if (!document.getElementById('unread-style-inject')) {
            const style = document.createElement('style')
            style.id = 'unread-style-inject'
            style.textContent = `
                            .has-unread-warnings { position: relative; }
                            .has-unread-warnings::after {
                                content: '';
                                position: absolute;
                                top: -2px;
                                right: -2px;
                                width: 8px;
                                height: 8px;
                                background-color: var(--action-red);
                                border-radius: 50%;
                                border: 1px solid var(--background-secondary);
                            }
                         `
            document.head.appendChild(style)
          }
        }
      }
    }
  })
}

/**
 * Insere HTML na posição do cursor em um elemento contenteditable
 * @param {HTMLElement} editor 
 * @param {string} html 
 */
function insertHtmlAtContenteditable(editor, html) {
  editor.focus()
  const sel = window.getSelection()
  if (sel.getRangeAt && sel.rangeCount) {
    let range = sel.getRangeAt(0)
    if (editor.contains(range.commonAncestorContainer)) {
      range.deleteContents()
      const el = document.createElement('div')
      el.innerHTML = html
      const frag = document.createDocumentFragment()
      let node, lastNode
      while ((node = el.firstChild)) {
        lastNode = frag.appendChild(node)
      }
      range.insertNode(frag)
      if (lastNode) {
        range = range.cloneRange()
        range.setStartAfter(lastNode)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    } else {
      editor.innerHTML += html
    }
  } else {
    editor.innerHTML += html
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Abre modal para criar ou editar aviso
 * @param {Object} existingWarning - (Opcional) Objeto do aviso para edição
 */
function openCreateWarningModal(existingWarning = null) {
  // Remover modal anterior se existir
  const existing = document.getElementById('create-warning-modal')
  if (existing) existing.remove()

  const isEdit = !!existingWarning
  const titleVal = isEdit ? escapeHTML(existingWarning.title) : ''
  const msgVal = isEdit ? (existingWarning.message || '') : ''
  const typeVal = isEdit ? existingWarning.type : 'info'
  const isTestVal = isEdit ? existingWarning.isTest : false
  const onlySelfVal = isEdit && existingWarning.onlySelf ? 'checked' : ''
  // Em caso de reedição, desmarca por padrão. Para novos, marca por padrão.
  const notifyVal = isEdit ? '' : 'checked'
  const notifyLabel = isEdit ? 'Reenviar notificação' : 'Enviar notificação'
  const notifyDesc = isEdit
    ? 'Se marcado, a notificação será enviada novamente para os usuários.'
    : 'Se marcado, os usuários receberão um alerta visual no SGD.'
  const requiredReadingVal = isEdit && existingWarning.requiredReading ? 'checked' : ''
  const channelVal = isEdit ? (existingWarning.channel || 'Geral') : 'Geral'

  // Helper para formatar data ISO de forma segura para o campo datetime-local
  const formatDateForInput = (isoString) => {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      const tzOffset = date.getTimezoneOffset() * 60000
      return (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16)
    } catch (_) {
      return ''
    }
  }

  const publishedAtVal = isEdit ? formatDateForInput(existingWarning.publishedAt) : ''
  const expiresAtVal = isEdit ? formatDateForInput(existingWarning.expiresAt) : ''

  const fieldStyle =
    'display: block; width: 100%; margin-bottom: 12px; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--background-main); color: var(--text-color-main);'

  const modalHtml = `
        <div style="padding: 10px;">
            <label style="display:block; margin-bottom:4px; font-size:12px;">Título</label>
            <input type="text" id="warn-title" style="${fieldStyle}" placeholder="Ex: Nova Atualização do Sistema Programada" value="${titleVal}">

            <label style="display:block; margin-bottom:4px; font-size:12px;">Mensagem</label>
            <div class="editor-toolbar warn-toolbar" style="margin-bottom: 4px; border: 1px solid var(--border-color); border-radius: 4px; display: flex; align-items: center; gap: 4px; padding: 4px; background: var(--background-secondary);">
                <div class="dropdown">
                    <button type="button" class="warn-tool-btn" data-action="font-size-menu" title="Tamanho da Fonte" style="font-size: 13px; font-weight: 600; padding: 4px 8px;">Aa</button>
                    <div class="dropdown-content">
                        <button type="button" class="warn-font-size-btn" data-size="2" style="font-size: 11px;">Pequeno</button>
                        <button type="button" class="warn-font-size-btn" data-size="3" style="font-size: 13px;">Médio</button>
                        <button type="button" class="warn-font-size-btn" data-size="5" style="font-size: 16px;">Grande</button>
                    </div>
                </div>
                <button type="button" class="warn-tool-btn" data-action="bold" title="Negrito"><b>B</b></button>
                <button type="button" class="warn-tool-btn" data-action="italic" title="Itálico"><i>I</i></button>
                <button type="button" class="warn-tool-btn" data-action="underline" title="Sublinhado"><u>U</u></button>
                <div class="toolbar-separator"></div>
                <button type="button" class="warn-tool-btn" data-action="link" title="Inserir Hiperlink">🔗</button>
                <button type="button" class="warn-tool-btn" data-action="numbered" title="Lista Numerada">🔢</button>
                <button type="button" class="warn-tool-btn" data-action="bullet" title="Marcador">&bull;</button>
                <div class="toolbar-separator"></div>
                <button type="button" class="warn-tool-btn" data-action="emoji" title="Emojis">😀</button>
                <button type="button" class="warn-tool-btn" data-action="color" title="Cor do Texto">🎨</button>
                <button type="button" class="warn-tool-btn" data-action="highlight" title="Cor de Destaque">🖌️</button>
            </div>
            <div id="warn-message" contenteditable="true" placeholder="Detalhes do aviso..." style="${fieldStyle} min-height: 120px; max-height: 250px; overflow-y: auto; margin-bottom: 4px; resize: vertical;">${msgVal}</div>
            <div style="font-size: 11px; color: var(--text-color-muted); margin-bottom: 12px; opacity: 0.8;">
                Dica: Você poderá usar a barra de ferramentas acima para formatar sua mensagem.
            </div>
            
            <div style="display: flex; gap: 15px; margin-bottom: 12px;">
                <div style="flex: 1;">
                    <label style="display:block; margin-bottom:4px; font-size:12px;">Tipo</label>
                    <select id="warn-type" style="${fieldStyle}">
                        <option value="info" ${typeVal === 'info' ? 'selected' : ''}>ℹ️ Informativo</option>
                        <option value="success" ${typeVal === 'success' ? 'selected' : ''}>✨ Novidade</option>
                        <option value="warning" ${typeVal === 'warning' ? 'selected' : ''}>⚠️ Alerta</option>
                        <option value="danger" ${typeVal === 'danger' ? 'selected' : ''}>🚨 Importante</option>
                    </select>
                </div>
                <div style="flex: 1;">
                    <label style="display:block; margin-bottom:4px; font-size:12px;">Canal de Comunicação</label>
                    <select id="warn-channel" style="${fieldStyle}">
                        ${(() => {
                           const allowed = [...(window.sgdPermissions?.allowedChannels || WARNING_CHANNELS)];
                           if (channelVal && !allowed.includes(channelVal)) {
                             allowed.push(channelVal);
                           }
                           return allowed.map(ch => `<option value="${ch}" ${channelVal === ch ? 'selected' : ''}>${ch}</option>`).join('');
                        })()}
                    </select>
                </div>
            </div>

            <div style="display: flex; gap: 15px; margin-bottom: 12px;">
                <div style="flex: 1;">
                    <label style="display:block; margin-bottom:4px; font-size:12px;">📅 Agendar Publicação (Opcional)</label>
                    <input type="datetime-local" id="warn-published-at" style="${fieldStyle}" value="${publishedAtVal}">
                </div>
                <div style="flex: 1;">
                    <label style="display:block; margin-bottom:4px; font-size:12px;">⏳ Expiração Customizada (Opcional)</label>
                    <input type="datetime-local" id="warn-expires-at" style="${fieldStyle}" value="${expiresAtVal}">
                </div>
            </div>

            <div style="padding: 10px; background-color: var(--background-secondary); border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 12px;">
                <div class="form-checkbox-group" style="margin-top: 0;">
                    <input type="checkbox" id="warn-notify" ${notifyVal}>
                    <label for="warn-notify" style="font-weight: 600;">🔔 ${notifyLabel}</label>
                </div>
                <p style="font-size: 11px; color: var(--text-color-muted); margin: 4px 0 0 24px;">
                    ${notifyDesc}
                </p>
            </div>

            <div style="padding: 10px; background-color: var(--background-secondary); border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 15px;">
                <div class="form-checkbox-group" style="margin-top: 0;">
                    <input type="checkbox" id="warn-required-reading" ${requiredReadingVal}>
                    <label for="warn-required-reading" style="font-weight: 600;">⚠️ Leitura Obrigatória</label>
                </div>
                <p style="font-size: 11px; color: var(--text-color-muted); margin: 4px 0 0 24px;">
                    Se marcado, os usuários deverão visualizar o aviso em tela cheia por pelo menos 10 segundos antes de fechar.
                </p>
            </div>

            <div style="margin-bottom: 16px; padding: 10px; background-color: var(--background-secondary); border-radius: 4px; border: 1px dashed var(--border-color);">
                <div class="form-checkbox-group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="warn-is-test" ${isTestVal ? 'checked' : ''} style="width: auto; margin: 0;">
                    <label for="warn-is-test" style="font-weight: 600; color: var(--text-color-main); font-size: 13px; cursor: pointer;">Modo de Teste / Demonstração</label>
                </div>
                <div style="font-size: 11px; color: var(--text-color-muted); margin-top: 4px; margin-left: 24px;">
                    Se marcado, este aviso aparecerá <b>apenas</b> para usuários com "Modo Desenvolvedor" ativado e não enviará notificações para a equipe geral.
                </div>
            </div>

            <div style="margin-bottom: 16px; padding: 10px; background-color: var(--background-secondary); border-radius: 4px; border: 1px dashed var(--border-color);">
                <div class="form-checkbox-group" style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="warn-only-self" ${onlySelfVal} style="width: auto; margin: 0;">
                    <label for="warn-only-self" style="font-weight: 600; color: var(--text-color-main); font-size: 13px; cursor: pointer;">Apenas para mim (Somente o autor)</label>
                </div>
                <div style="font-size: 11px; color: var(--text-color-muted); margin-top: 4px; margin-left: 24px;">
                    Se marcado, este aviso e suas notificações serão exibidos <b>apenas</b> para o seu usuário.
                </div>
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
                <button id="cancel-warn-btn" style="padding: 8px 16px; background: transparent; border: 1px solid var(--border-color); color: var(--text-color-main); border-radius: 4px; cursor: pointer;">Cancelar</button>
                <button id="save-warn-btn" class="ip-add-closing-btn" style="width: auto;">${isEdit ? 'Atualizar Aviso' : 'Publicar Aviso'}</button>
            </div>
        </div>
    `

  const modal = createModal(
    isEdit ? 'Editar Aviso' : 'Novo Aviso',
    modalHtml,
    null,
    {
      isManagementModal: false,
      modalId: 'create-warning-modal',
      showShareButton: false
    }
  )

  // Remover o rodapé padrão do createModal para não duplicar botões
  const defaultActions = modal.querySelector('.se-modal-actions')
  if (defaultActions) defaultActions.remove()

  modal.style.zIndex = '10002'

  // Pickers flutuantes locais
  const emojiPickerDiv = document.createElement('div')
  emojiPickerDiv.className = 'picker emoji-picker-warn'
  emojiPickerDiv.style.cssText = 'position: absolute; display: none; grid-template-columns: repeat(8, 26px); gap: 2px; padding: 6px; background: var(--background-main); border: 1px solid var(--border-color); border-radius: 4px; max-height: 200px; overflow-y: auto; z-index: 10006; box-shadow: var(--shadow-md);'

  const colorPickerDiv = document.createElement('div')
  colorPickerDiv.className = 'picker color-picker-warn'
  colorPickerDiv.style.cssText = 'position: absolute; display: none; grid-template-columns: repeat(4, 26px); gap: 4px; padding: 6px; background: var(--background-main); border: 1px solid var(--border-color); border-radius: 4px; z-index: 10006; box-shadow: var(--shadow-md);'

  const highlightPickerDiv = document.createElement('div')
  highlightPickerDiv.className = 'picker highlight-picker-warn'
  highlightPickerDiv.style.cssText = 'position: absolute; display: none; grid-template-columns: repeat(4, 26px); gap: 4px; padding: 6px; background: var(--background-main); border: 1px solid var(--border-color); border-radius: 4px; z-index: 10006; box-shadow: var(--shadow-md);'

  document.body.appendChild(emojiPickerDiv)
  document.body.appendChild(colorPickerDiv)
  document.body.appendChild(highlightPickerDiv)

  document.body.appendChild(modal)

  const messageEditor = modal.querySelector('#warn-message')

  // Handler para tamanho da fonte no dropdown
  modal.querySelectorAll('.warn-font-size-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      messageEditor.focus()
      const size = btn.dataset.size
      if (size) {
        document.execCommand('fontSize', false, size)
      }
      // Fecha o dropdown removendo a classe open do dropdown pai
      const dropdown = btn.closest('.dropdown')
      if (dropdown) {
        dropdown.classList.remove('open')
      }
    })
  })

  // Evitar que cliques nos pickers tirem o foco/seleção do contenteditable
  colorPickerDiv.addEventListener('mousedown', e => e.preventDefault())
  highlightPickerDiv.addEventListener('mousedown', e => e.preventDefault())
  emojiPickerDiv.addEventListener('mousedown', e => e.preventDefault())

  // Inicializa pickers com callbacks
  if (typeof createColorPicker === 'function') {
    createColorPicker(colorPickerDiv, (color) => {
      messageEditor.focus()
      document.execCommand('foreColor', false, color)
    })
    createColorPicker(highlightPickerDiv, (color) => {
      messageEditor.focus()
      document.execCommand('hiliteColor', false, color)
    })
  }

  if (typeof createEmojiPicker === 'function') {
    createEmojiPicker(emojiPickerDiv, (emojiHtml, emojiChar) => {
      const emojiValue = emojiChar ? `<span style="font-size: 19px;">${emojiChar}</span>` : emojiHtml
      insertHtmlAtContenteditable(messageEditor, emojiValue)
    })
  }

  const showPicker = (btn, pickerDiv) => {
    emojiPickerDiv.style.display = 'none'
    colorPickerDiv.style.display = 'none'
    highlightPickerDiv.style.display = 'none'

    const rect = btn.getBoundingClientRect()
    pickerDiv.style.top = `${rect.bottom + window.scrollY + 2}px`
    pickerDiv.style.left = `${rect.left + window.scrollX}px`
    pickerDiv.style.display = 'grid'

    const closeHandler = (ev) => {
      if (!pickerDiv.contains(ev.target) && !btn.contains(ev.target)) {
        pickerDiv.style.display = 'none'
        document.removeEventListener('click', closeHandler, true)
      }
    }
    document.addEventListener('click', closeHandler, true)
  }

  const cleanup = () => {
    emojiPickerDiv.remove()
    colorPickerDiv.remove()
    highlightPickerDiv.remove()
    modal.remove()
  }

  // Handlers da barra de ferramentas
  modal.querySelectorAll('.warn-tool-btn').forEach(btn => {
    const action = btn.dataset.action
    if (!action) return

    // Evita perda de foco/seleção no contenteditable ao interagir com a barra
    btn.addEventListener('mousedown', e => {
      e.preventDefault()
    })

    btn.addEventListener('click', e => {
      e.preventDefault()
      messageEditor.focus()

      switch (action) {
        case 'bold':
          document.execCommand('bold', false, null)
          break
        case 'italic':
          document.execCommand('italic', false, null)
          break
        case 'underline':
          document.execCommand('underline', false, null)
          break
        case 'link': {
          const sel = window.getSelection()
          let savedRange = null
          if (sel.rangeCount > 0) {
            savedRange = sel.getRangeAt(0).cloneRange()
          }

          const url = prompt('URL:', 'https://')
          if (url) {
            const text = prompt('Texto:', 'Clique aqui')
            const linkHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: rgb(255, 128, 0); font-weight: bold;">${text}</a>`

            if (savedRange) {
              sel.removeAllRanges()
              sel.addRange(savedRange)
            }
            insertHtmlAtContenteditable(messageEditor, linkHtml)
          }
          break
        }
        case 'numbered':
          document.execCommand('insertOrderedList', false, null)
          break
        case 'bullet':
          document.execCommand('insertUnorderedList', false, null)
          break
        case 'emoji':
          showPicker(btn, emojiPickerDiv)
          break
        case 'color':
          showPicker(btn, colorPickerDiv)
          break
        case 'highlight':
          showPicker(btn, highlightPickerDiv)
          break
      }
    })
  })

  // Handlers padrão do modal
  const onlySelfCheckbox = modal.querySelector('#warn-only-self')
  const isTestCheckbox = modal.querySelector('#warn-is-test')
  if (onlySelfCheckbox && isTestCheckbox) {
    onlySelfCheckbox.addEventListener('change', () => {
      if (onlySelfCheckbox.checked) {
        isTestCheckbox.checked = true
      }
    })
  }
  const saveBtn = modal.querySelector('#save-warn-btn')
  const cancelBtn = modal.querySelector('#cancel-warn-btn')

  cancelBtn.addEventListener('click', () => cleanup())

  // Fechamento pelo botão X padrão do modal
  const closeBtn = modal.querySelector('.se-close-modal-btn')
  if (closeBtn) {
    closeBtn.addEventListener('click', () => cleanup())
  }

  saveBtn.addEventListener('click', async () => {
    const title = modal.querySelector('#warn-title').value.trim()
    const textContent = messageEditor.textContent.trim()
    const message = messageEditor.innerHTML.trim()
    const type = modal.querySelector('#warn-type').value
    const channel = modal.querySelector('#warn-channel').value
    const onlySelf = modal.querySelector('#warn-only-self').checked
    const isTest = modal.querySelector('#warn-is-test').checked || onlySelf
    const notify = modal.querySelector('#warn-notify').checked
    const requiredReading = modal.querySelector('#warn-required-reading').checked
    const author = getCurrentUserName()

    const publishedAtInput = modal.querySelector('#warn-published-at').value
    const expiresAtInput = modal.querySelector('#warn-expires-at').value
    const publishedAt = publishedAtInput ? new Date(publishedAtInput).toISOString() : null
    const expiresAt = expiresAtInput ? new Date(expiresAtInput).toISOString() : null

    if (!title || !textContent) {
      alert('Preencha título e mensagem.')
      return
    }

    saveBtn.disabled = true
    saveBtn.textContent = 'Salvando...'

    try {
      if (isEdit) {
        const date = notify ? new Date().toISOString() : existingWarning.date
        await window.warningsService.updateWarning(existingWarning.id, {
          title,
          message,
          type,
          author,
          isTest,
          onlySelf,
          notify,
          requiredReading,
          channel,
          publishedAt,
          expiresAt,
          archived: existingWarning.archived || false,
          date
        })
      } else {
        await window.warningsService.createWarning({
          title,
          message,
          type,
          author,
          isTest,
          onlySelf,
          notify,
          requiredReading,
          channel,
          publishedAt,
          expiresAt,
          archived: false,
          date: new Date().toISOString()
        })
      }



      cleanup()

      const warningsSection = document.querySelector('#ip-section-notices')
      if (warningsSection) {
        loadWarnings(warningsSection)
      }
    } catch (err) {
      console.error(err)
      alert('Erro ao salvar: ' + err.message)
      saveBtn.disabled = false
      saveBtn.textContent = isEdit ? 'Atualizar Aviso' : 'Publicar Aviso'
    }
  })
}
// #endregion

// #region agent log
// Verify if window.openTagManager is set
fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    location: 'info-panel.js:init',
    message: 'Exposing functions to window',
    data: { before: typeof window.openTagManager },
    timestamp: Date.now(),
    sessionId: 'debug-session',
    hypothesisId: 'C'
  })
}).catch(() => { })
// #endregion

/**
 * Abre o gerenciador de tags para um item específico.
 * @param {HTMLElement} btnElement Botão clicado
 * @param {string} pendingId ID da pendência
 */
async function openTagManager(btnElement, pendingId) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'info-panel.js:window.openTagManager',
      message: 'Function called from window',
      data: { pendingId },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'C'
    })
  }).catch(() => { })
  // #endregion

  // Remove qualquer popup existente
  const existingPopup = document.querySelector('.ip-tag-popup')
  if (existingPopup) existingPopup.remove()

  const popup = document.createElement('div')
  popup.className = 'ip-tag-popup'

  const item = allPendingItems.find(i => i.id === pendingId)
  const currentTags = pendingTagsMapCache[pendingId] || []

  // Identificar IDs das tags automáticas para este item
  const autoTagIds = new Set()

  if (item) {
    if (item.isPrioritaria) {
      const priorityTag = availableTagsCache.find(
        t => t.name.toLowerCase() === 'prioridade'
      )
      if (priorityTag) autoTagIds.add(priorityTag.id)
    }
    if (item.isEmSS) {
      const ssTag = availableTagsCache.find(
        t => t.name.toLowerCase() === 'em ss'
      )
      if (ssTag) autoTagIds.add(ssTag.id)
    }
  }

  let tagsListHtml = availableTagsCache
    .map(tag => {
      const isAuto = autoTagIds.has(tag.id)
      const isChecked = currentTags.includes(tag.id) || isAuto ? 'checked' : ''
      const isDisabled = isAuto ? 'disabled' : ''
      const tooltip = isAuto
        ? ' title="Esta tag é automática baseada no status da SSC e não pode ser removida." '
        : ''
      const opacityStyle = isAuto ? ' opacity: 0.7; cursor: not-allowed; ' : ''

      return `
            <div class="ip-tag-row" ${tooltip} style="${opacityStyle}">
                <label class="ip-tag-option" style="flex: 1; ${isAuto ? 'cursor: not-allowed;' : ''}">
                    <input type="checkbox" value="${tag.id}" ${isChecked} ${isDisabled}>
                    <span class="ip-tag-color" style="background-color: ${tag.color}"></span>
                    ${escapeHTML(tag.name)}
                    ${isAuto ? '<span style="font-size: 10px; margin-left: 4px; color: var(--text-color-muted);">(Auto)</span>' : ''}
                </label>
                <button class="ip-tag-delete-btn" data-tag-id="${tag.id}" title="Excluir Tag" ${isDisabled}>🗑️</button>
            </div>
        `
    })
    .join('')

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
    newTagBtn.addEventListener('click', function (e) {
      e.stopPropagation()
      if (window.showNewTagInput) {
        window.showNewTagInput(this, pendingId)
      } else {
        console.error('Função showNewTagInput não encontrada no window')
        // Fallback
        if (typeof showNewTagInput === 'function') {
          showNewTagInput(this, pendingId)
        }
      }
    })
  }

  const checkboxes = popup.querySelectorAll('input[type="checkbox"]')
  checkboxes.forEach(cb => {
    cb.addEventListener('change', function () {
      toggleTag(pendingId, this.value)
    })
  })

  // Delete buttons listener
  const deleteBtns = popup.querySelectorAll('.ip-tag-delete-btn')
  deleteBtns.forEach(btn => {
    btn.addEventListener('click', async function (e) {
      e.stopPropagation() // Impede fechar ou marcar checkbox
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
            const tagFilterSelect = pendingSection.querySelector(
              '#pending-tag-filter'
            )
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
  const closeHandler = e => {
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
window.showNewTagInput = function (btnElement, pendingId) {
  // Tenta encontrar o container correto (footer do popup)
  const container =
    btnElement.closest('.ip-tag-popup-footer') || btnElement.parentElement
  if (!container) return

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
    saveBtn.addEventListener('click', e => {
      e.stopPropagation() // Prevent closing popup
      if (window.saveNewTag) {
        window.saveNewTag(pendingId)
      } else {
        console.error('Função saveNewTag não encontrada')
      }
    })
  }

  // Prevent closing when clicking inputs
  const inputs = container.querySelectorAll('input')
  inputs.forEach(input => {
    input.addEventListener('click', e => e.stopPropagation())
  })
}

/**
 * Exclui uma tag
 */
window.deleteTag = async function (tagId) {
  await deleteCustomTag(tagId)
}

/**
 * Salva a nova tag e a adiciona ao item.
 */
window.saveNewTag = async function (pendingId) {
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
    const card = document.querySelector(
      `.ip-pending-card[data-id="${pendingId}"]`
    )
    if (card) {
      const tagsContainer = card.querySelector('.ip-tags-container')

      // Recalcular lista completa de tags (Auto + Manual) para renderização correta
      const item = allPendingItems.find(i => i.id === pendingId)
      let tagsRenderList = []
      const renderedTagIds = new Set()

      if (item) {
        // 1. Tag de Prioridade (Automática)
        if (item.isPrioritaria) {
          const priorityTag = availableTagsCache.find(
            t => t.name.toLowerCase() === 'prioridade'
          )
          if (priorityTag) {
            tagsRenderList.push(priorityTag)
            renderedTagIds.add(priorityTag.id)
          }
        }

        // 2. Tag de Em SS (Automática)
        if (item.isEmSS) {
          const ssTag = availableTagsCache.find(
            t => t.name.toLowerCase() === 'em ss'
          )
          if (ssTag) {
            tagsRenderList.push(ssTag)
            renderedTagIds.add(ssTag.id)
          }
        }
      }

      // 3. Tags do Usuário
      const userTags = pendingTagsMapCache[pendingId] || []
      userTags.forEach(id => {
        if (renderedTagIds.has(id)) return // Evita duplicidade

        const tagDef = availableTagsCache.find(t => t.id === id)
        if (tagDef) {
          tagsRenderList.push(tagDef)
          renderedTagIds.add(tagDef.id)
        }
      })

      const tagsHtml = tagsRenderList
        .map(tagDef => {
          return `<span class="ip-tag-badge" style="background-color: ${tagDef.color}20; color: ${tagDef.color}; border-color: ${tagDef.color}40;">${escapeHTML(tagDef.name)}</span>`
        })
        .join('')

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
        <div class="ip-pending-header-row">
          <p class="ip-section-desc" style="margin-bottom: 0;">Status atual dos sistemas e recomendações de contorno.</p>
          <button id="refresh-systems-btn" class="action-btn secondary-btn compact" title="Atualizar status">
            <span>🔄</span>
          </button>
        </div>
        <div id="systems-status-container" class="ip-grid">
          <div class="ip-loading-container">
            <div class="ip-spinner"></div>
            <span>Carregando status dos sistemas...</span>
          </div>
        </div>
      `

    case 'team-status':
      return `
        <div class="ip-pending-controls" style="flex-wrap: wrap; gap: 12px;">
          

          <div class="ip-filter-group" style="flex: 1; min-width: 300px;">
            <div class="ip-search-wrapper" style="flex: 1.5; display: flex; align-items: center; gap: 8px;">
              <span class="ip-search-icon">🔍</span>
              <input type="text" id="team-search" placeholder="Buscar técnico..." class="ip-filter-input compact" style="flex: 1;">
              
              <!-- Stats Bar movida para dentro da search wrapper, ao lado direito -->
              <div id="team-stats-bar" class="ip-team-stats-bar" style="display: flex; gap: 8px; font-size: 10px; font-weight: 500; align-items: center; padding: 0 4px;">
                 <span style="opacity: 0.7;">...</span>
              </div>
            </div>
            
            <div style="display: flex; gap: 4px; align-items: center;">
              <span style="font-size: 11px; color: var(--text-color-muted);">Filtrar:</span>
              <select id="team-status-filter" class="ip-filter-select compact" style="width: 100px;">
                <option value="all">Todos os Status</option>
                <option value="na-fila">🟢 Na Fila</option>
                <option value="fora-fila">🔴 Fora da Fila</option>
                <option value="sem-status">⚪ Sem Status</option>
              </select>
            </div>

            <div style="display: flex; gap: 4px; align-items: center;">
              <span style="font-size: 11px; color: var(--text-color-muted);">Ordenar:</span>
              <select id="team-sort-filter" class="ip-filter-select compact" style="width: 110px;">
                <option value="not-ready">📊 Indisponibilidade</option>
                <option value="name">🔤 Alfabética</option>
                <option value="time">⏱️ Tempo</option>
              </select>
            </div>
            <button id="toggle-team-view-btn" class="action-btn secondary-btn compact" title="Alternar Visualização (Compacta/Detalhada)">
              <span>👁️</span>
            </button>
            <button id="refresh-team-status-btn" class="action-btn secondary-btn compact" title="Atualizar status">
              <span>🔄</span>
            </button>
            <!-- Botão de teste de notificação (apenas modo dev) -->
            ${developerMode
          ? `
            <button id="test-notification-btn" class="action-btn secondary-btn compact" title="Testar Notificação" style="color: var(--action-blue);">
              <span>🔔</span>
            </button>`
          : ''
        }
            
            <!-- Timestamp movido para o topo -->
            <span id="team-status-timestamp" style="font-size: 11px; color: var(--text-color-muted); margin-left: 6px; white-space: nowrap;"></span>
          </div>
        </div>
        <div id="team-status-container" class="ip-grid" style="margin-top: 16px;">
          <div class="ip-loading-container">
            <div class="ip-spinner"></div>
            <span>Carregando dados da equipe...</span>
          </div>
        </div>
        <div id="team-status-footer" class="ip-status-footer" style="margin-top: 16px; padding: 8px 12px; background: var(--bg-secondary); border-radius: var(--border-radius-sm); font-size: 11px; color: var(--text-color-muted); text-align: center;">
          Aguardando dados...
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
         <div class="ip-pending-controls" style="margin-bottom: 12px; display: flex; gap: 8px;">
           <div class="ip-search-wrapper" style="flex: 1; display: flex; align-items: center; gap: 8px;">
             <span class="ip-search-icon">🔍</span>
             <input type="text" id="ai-chains-search" placeholder="Buscar assistente..." class="ip-filter-input compact" style="flex: 1;">
           </div>
         </div>
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


                        <select id="pending-responsible-filter" class="ip-filter-select compact" title="Filtrar por Responsável">
                            <option value="">Todos Responsáveis</option>
                        </select>

                        <select id="pending-tag-filter" class="ip-filter-select compact" title="Filtrar por Tag">
                            <option value="">Todas as Tags</option>
                            ${availableTagsCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                        </select>

                        <div class="form-checkbox-group" style="display:flex; align-items:center; margin-left:8px;" title="Mostrar apenas chamados com mais de 40h sem interação">
                            <input type="checkbox" id="pending-critical-filter" style="width:16px; height:16px;">
                            <label for="pending-critical-filter" style="color:#dc2626; font-weight:bold; font-size:12px; margin-left:4px; cursor:pointer;">⚠️ Críticos (>40h)</label>
                        </div>

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
                        <button id="toggle-notification-btn" class="action-btn small-btn enhanced-btn" title="Carregando estado..." style="width: auto; height: 28px; padding: 0 10px; display: flex; align-items: center; justify-content: center; white-space: nowrap; font-size: 11px; line-height: 1;">🔔 <span style="margin-left: 4px;">Notificações</span></button>
                        <button id="refresh-pending-btn" class="action-btn small-btn enhanced-btn compact" title="Atualizar lista">🔄</button>
                        <button id="open-all-pending-btn" class="action-btn small-btn enhanced-btn compact" title="Filtre por um único responsável para habilitar" disabled style="opacity: 0.5;">Abrir Todas</button>
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

    case 'access-control':
      return `
        <p class="ip-section-desc">Gerencie quem pode criar, editar e excluir avisos na Central de Informações.</p>
        <div id="access-control-container">
          <div class="ip-loading-container">
            <div class="ip-spinner"></div>
            <span>Carregando permissões...</span>
          </div>
        </div>
      `

    default:
      return '<p>Seção em desenvolvimento...</p>'
  }
}

/**
 * Carrega e renderiza o painel de Controle de Acesso.
 * Permite a editores gerenciar a lista de outros editores.
 * @param {HTMLElement} sectionElement - Elemento da seção de controle de acesso
 */
async function loadAccessControl(sectionElement) {
  const container = sectionElement.querySelector('#access-control-container')
  if (!container) return

  const settings = await getSettings()
  const enableTeamManagement = settings.preferences?.enableTeamManagement === true

  // Mostra loading
  container.innerHTML = `
    <div class="ip-loading-container">
      <div class="ip-spinner"></div>
      <span>Carregando lista de permissões...</span>
    </div>
  `

  try {
    if (!window.sgdPermissions) {
      throw new Error('Serviço de permissões não está disponível.')
    }

    // Força atualização da lista de editores, visualizadores e perfis de canais
    let editors = await window.sgdPermissions.refreshEditors()
    let viewers = window.sgdPermissions.viewersList || []

    if (acOnlyShowTeamAT) {
      editors = editors.filter(e => e.isEquipeAT === true)
      viewers = viewers.filter(v => v.isEquipeAT === true)
    }

    const profiles = await window.sgdPermissions.getChannelProfiles()
    const currentUserNorm = (window.sgdPermissions.currentUser || '').trim().toLowerCase()
    const isMaster = !!window.sgdPermissions.isMaster

    const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com'
    let pendingRequestsHtml = ''
    if (isMaster) {
      try {
        const devRes = await fetch(`${RTDB_BASE_URL}/dev_requests.json`, { cache: 'no-store' })
        if (devRes.ok) {
          const devRequests = await devRes.json() || {}
          
          const renderDevRequestRow = (userKey, req) => {
            const reqDate = req.requestedAt ? new Date(req.requestedAt).toLocaleDateString('pt-BR') : '—'
            return `
              <div class="ip-access-editor-row ac-pending-dev-request-row" data-user-key="${escapeHTML(userKey)}" style="display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; border-radius: var(--border-radius-sm, 4px); margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="ip-access-editor-info">
                    <span class="ip-access-editor-name" style="font-weight: 600; font-size: 13px; color: var(--text-color-main); display: flex; align-items: center; gap: 6px;">
                      🛠️ Solicitação Modo Dev: ${escapeHTML(req.userName)}
                    </span>
                    <span class="ip-access-editor-meta" style="display: block; font-size: 11px; color: var(--text-color-muted); margin-top: 2px;">
                      Solicitado em ${reqDate}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="action-btn ac-approve-dev-btn" data-user-key="${escapeHTML(userKey)}" data-user-name="${escapeHTML(req.userName)}" data-user-id="${escapeHTML(req.userId || '')}" style="font-size: 11px; padding: 4px 8px; background: var(--action-green, #22c55e); color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Aprovar</button>
                    <button class="action-btn secondary-btn compact ac-reject-dev-btn" data-user-key="${escapeHTML(userKey)}" data-user-name="${escapeHTML(req.userName)}" style="font-size: 11px; padding: 4px 8px; color: var(--action-red, #ef4444); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;">Rejeitar</button>
                  </div>
                </div>
              </div>
            `
          }

          pendingRequestsHtml = Object.entries(devRequests)
            .filter(([key, val]) => val && val.status === 'pending')
            .map(([key, val]) => renderDevRequestRow(key, val))
            .join('')
        }
      } catch (err) {
        console.warn('[SGD Access Control] Erro ao carregar solicitações de modo dev:', err)
      }
    }

    const renderEditorRow = (editor) => {
      const isSelf = editor.name.trim().toLowerCase() === currentUserNorm
      const addedDate = editor.addedAt ? new Date(editor.addedAt).toLocaleDateString('pt-BR') : '—'
      const channels = editor.allowedChannels || [...(window.sgdPermissions?.channels || WARNING_CHANNELS)]
      const hasAllChannels = channels.length === (window.sgdPermissions?.channels || WARNING_CHANNELS).length
      const channelsText = hasAllChannels ? 'Todos os canais' : (channels.join(', ') || 'Nenhum canal')
      const roleLabel = editor.role === 'master' ? 'Master' : 'Comum'

      // Cargo: Master pode ver select, Comum vê apenas badge de texto
      const roleSelectorHtml = isMaster
        ? `
          <select class="ac-editor-role-select" data-editor-id="${escapeHTML(editor.id)}" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); outline: none;">
            <option value="comum" ${editor.role === 'comum' ? 'selected' : ''}>Comum</option>
            <option value="master" ${editor.role === 'master' ? 'selected' : ''}>Master</option>
          </select>
        `
        : `
          <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: var(--background-secondary); border: 1px solid var(--border-color); color: var(--text-color-muted); font-weight: 600;">${escapeHTML(roleLabel)}</span>
        `

      // Botão Limitar: Apenas Master pode limitar/alterar canais de outros Editores
      const limitBtnHtml = isMaster
        ? `<button class="action-btn small-btn ac-toggle-channels-btn" data-editor-id="${escapeHTML(editor.id)}" style="font-size: 10px; padding: 2px 6px; white-space: nowrap; border: 1px solid var(--border-color);">✏️ Limitar</button>`
        : ''

      // Remover: Apenas Master pode remover editores
      const removeBtnHtml = isMaster
        ? `
          <button class="action-btn secondary-btn compact ip-access-remove-btn"
            data-editor-id="${escapeHTML(editor.id)}"
            data-editor-name="${escapeHTML(editor.name)}"
            ${isSelf && editors.length <= 1 ? 'disabled title="Não é possível remover o único editor"' : ''}
            style="font-size: 11px; padding: 3px 8px; color: var(--action-red, #ef4444); border: 1px solid var(--border-color);"
          >
            Remover
          </button>
        `
        : ''

      const isEquipeAT = editor.isEquipeAT === true
      const teamBtnHtml = enableTeamManagement
        ? `
          <button class="action-btn small-btn ac-toggle-team-at-btn" 
            data-user-id="${escapeHTML(editor.id)}" 
            data-user-name="${escapeHTML(editor.name)}" 
            data-is-editor="true" 
            data-current-status="${isEquipeAT}"
            style="font-size: 10px; padding: 2px 6px; white-space: nowrap; border: 1px solid var(--border-color); background: ${isEquipeAT ? 'var(--action-green, #22c55e)' : 'var(--background-main)'}; color: ${isEquipeAT ? 'white' : 'var(--text-color-main)'}; cursor: pointer; border-radius: 4px;">
            ${isEquipeAT ? '👥 Ativo Equipe AT' : '👥 Ativar Equipe AT'}
          </button>
        `
        : ''

      // Aplicação de Perfil individual na lista de editores (apenas Master)
      const profileSelectHtml = isMaster
        ? `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px;">
            <span style="font-size: 10px; font-weight: bold; color: var(--text-color-muted);">Aplicar Perfil:</span>
            <select class="ac-apply-profile-select" style="font-size: 10px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main);">
              <option value="">Selecionar Perfil...</option>
              ${profiles.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
            </select>
          </div>
        `
        : ''

      return `
        <div class="ip-access-editor-row" data-editor-id="${escapeHTML(editor.id)}" style="display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; background: color-mix(in srgb, var(--primary-color, #6366f1) 8%, var(--background-secondary, #f3f4f6)); border: 1px solid color-mix(in srgb, var(--primary-color, #6366f1) 30%, var(--border-color, #e5e7eb)); border-radius: var(--border-radius-sm, 4px); margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="ip-access-editor-info">
              <span class="ip-access-editor-name" style="font-weight: 600; font-size: 13px; color: var(--text-color-main); display: flex; align-items: center; gap: 6px;">
                ✏️ ${escapeHTML(editor.name)}
                ${isSelf ? '<span class="ip-access-you-badge" style="background: var(--accent-color, #6366f1); color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 4px; margin-left: 5px; font-weight: 500;">Você</span>' : ''}
              </span>
              <span class="ip-access-editor-meta" style="display: block; font-size: 11px; color: var(--text-color-muted); margin-top: 2px;">
                Adicionado em ${addedDate}${editor.addedBy ? ` por ${escapeHTML(editor.addedBy)}` : ''}
              </span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${teamBtnHtml}
              ${roleSelectorHtml}
              ${removeBtnHtml}
            </div>
          </div>

          <div class="ac-channels-container" style="font-size: 11px; color: var(--text-color-muted); background: var(--background-main); padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                <strong>Canais:</strong> <span class="ac-channels-text" style="color: var(--text-color-main); font-weight: 500;">${escapeHTML(channelsText)}</span>
              </span>
              ${limitBtnHtml}
            </div>
            
            <div class="ac-channels-checkboxes" style="display: none; margin-top: 8px; border-top: 1px dashed var(--border-color); padding-top: 6px;">
              ${profileSelectHtml}
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; margin-bottom: 8px;">
                ${(window.sgdPermissions?.channels || WARNING_CHANNELS).map(ch => {
                  const checked = channels.includes(ch) ? 'checked' : ''
                  return `
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--text-color-main);">
                      <input type="checkbox" class="ac-channel-checkbox" value="${escapeHTML(ch)}" ${checked} style="width: auto; margin: 0;">
                      ${escapeHTML(ch)}
                    </label>
                  `
                }).join('')}
              </div>
              <div style="display: flex; gap: 6px; justify-content: flex-end;">
                <button class="action-btn small-btn ac-select-all-channels-btn" style="font-size: 10px; border: 1px solid var(--border-color);">Todos</button>
                <button class="action-btn small-btn ac-save-channels-btn" data-id="${escapeHTML(editor.id)}" data-type="editor" style="font-size: 10px; background: var(--action-green, #22c55e); color: white; border: none; padding: 3px 8px;">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      `
    }

    const renderViewerRow = (viewer) => {
      const addedDate = viewer.firstSeen ? new Date(viewer.firstSeen).toLocaleDateString('pt-BR') : '—'
      const channels = viewer.allowedChannels || [...(window.sgdPermissions?.channels || WARNING_CHANNELS)]
      const hasAllChannels = channels.length === (window.sgdPermissions?.channels || WARNING_CHANNELS).length
      const channelsText = hasAllChannels ? 'Todos os canais' : (channels.join(', ') || 'Nenhum canal')

      // Tornar Editor: Apenas Master pode promover visualizadores a editores
      const promoteBtnHtml = isMaster
        ? `<button class="action-btn small-btn ac-promote-editor-btn" data-viewer-id="${escapeHTML(viewer.id)}" data-viewer-name="${escapeHTML(viewer.name)}" style="font-size: 10px; padding: 2px 6px; white-space: nowrap; border: none; background: var(--action-blue, #3b82f6); color: white; cursor: pointer;">✏️ Tornar Editor</button>`
        : ''

      const isEquipeAT = viewer.isEquipeAT === true
      const teamBtnHtml = enableTeamManagement
        ? `
          <button class="action-btn small-btn ac-toggle-team-at-btn" 
            data-user-id="${escapeHTML(viewer.id)}" 
            data-user-name="${escapeHTML(viewer.name)}" 
            data-is-editor="false" 
            data-current-status="${isEquipeAT}"
            style="font-size: 10px; padding: 2px 6px; white-space: nowrap; border: 1px solid var(--border-color); background: ${isEquipeAT ? 'var(--action-green, #22c55e)' : 'var(--background-main)'}; color: ${isEquipeAT ? 'white' : 'var(--text-color-main)'}; cursor: pointer; border-radius: 4px;">
            ${isEquipeAT ? '👥 Ativo Equipe AT' : '👥 Ativar Equipe AT'}
          </button>
        `
        : ''

      // Todos os editores (Master e Comum) podem limitar/atualizar os canais de Visualizadores
      return `
        <div class="ip-access-viewer-row" data-viewer-id="${escapeHTML(viewer.id)}" style="display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; background: var(--background-secondary, #f3f4f6); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm, 4px); margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="ac-viewer-select-checkbox" data-viewer-id="${escapeHTML(viewer.id)}" style="width: 15px; height: 15px; margin: 0; cursor: pointer;">
              <div class="ip-access-editor-info">
                <span class="ip-access-editor-name" style="font-weight: 500; font-size: 13px; color: var(--text-color-main);">
                  👁️ ${escapeHTML(viewer.name)}
                </span>
                <span class="ip-access-editor-meta" style="display: block; font-size: 11px; color: var(--text-color-muted); margin-top: 2px;">
                  Primeiro acesso em ${addedDate}
                </span>
              </div>
            </div>
          </div>

          <div class="ac-channels-container" style="font-size: 11px; color: var(--text-color-muted); background: var(--background-main); padding: 8px 10px; border-radius: 4px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;">
                <strong>Canais:</strong> <span class="ac-channels-text" style="color: var(--text-color-main); font-weight: 500;">${escapeHTML(channelsText)}</span>
              </span>
              <div style="display: flex; gap: 6px; align-items: center;">
                ${promoteBtnHtml}
                ${teamBtnHtml}
                <button class="action-btn small-btn ac-toggle-channels-btn" data-viewer-id="${escapeHTML(viewer.id)}" style="font-size: 10px; padding: 2px 6px; white-space: nowrap; border: 1px solid var(--border-color);">✏️ Limitar</button>
              </div>
            </div>
            
            <div class="ac-channels-checkboxes" style="display: none; margin-top: 8px; border-top: 1px dashed var(--border-color); padding-top: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px;">
                <span style="font-size: 10px; font-weight: bold; color: var(--text-color-muted);">Aplicar Perfil:</span>
                <select class="ac-apply-profile-select" style="font-size: 10px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main);">
                  <option value="">Selecionar Perfil...</option>
                  ${profiles.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
                </select>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; margin-bottom: 8px;">
                ${(window.sgdPermissions?.channels || WARNING_CHANNELS).map(ch => {
                  const checked = channels.includes(ch) ? 'checked' : ''
                  return `
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--text-color-main);">
                       <input type="checkbox" class="ac-channel-checkbox" value="${escapeHTML(ch)}" ${checked} style="width: auto; margin: 0;">
                      ${escapeHTML(ch)}
                    </label>
                  `
                }).join('')}
              </div>
              <div style="display: flex; gap: 6px; justify-content: flex-end;">
                <button class="action-btn small-btn ac-select-all-channels-btn" style="font-size: 10px; border: 1px solid var(--border-color);">Todos</button>
                <button class="action-btn small-btn ac-save-channels-btn" data-id="${escapeHTML(viewer.id)}" data-type="viewer" style="font-size: 10px; background: var(--action-green, #22c55e); color: white; border: none; padding: 3px 8px;">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      `
    }

    // Perfil de Canais UI HTML
    const profilesHtml = `
      <div class="ac-profiles-section" style="margin-top: 10px; padding: 12px; background: var(--background-secondary, #f3f4f6); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm, 4px);">
        <div id="ac-toggle-profiles-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
          <strong style="font-size: 13px; color: var(--text-color-main); display: flex; align-items: center; gap: 6px;">
            📋 Perfis de Canais
          </strong>
          <span id="ac-profiles-arrow" style="font-size: 11px; color: var(--text-color-muted); font-weight: 600;">▶ Expandir</span>
        </div>
        
        <div id="ac-profiles-content" style="display: none; margin-top: 10px; border-top: 1px dashed var(--border-color); padding-top: 10px;">
          <p style="font-size: 11px; color: var(--text-color-muted); margin: 4px 0 10px 0;">
            Você poderá salvar perfis de canais pré-definidos para aplicar em lote ou individualmente.
          </p>

          <!-- Form para criar perfil -->
          <div style="display: flex; gap: 8px; flex-direction: column; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-color);">
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="text" id="ac-profile-name" placeholder="Ex: Suporte N1, Plantão..." style="flex: 1; padding: 6px 10px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--background-main); color: var(--text-color-main); box-sizing: border-box;">
              <button id="ac-save-profile-btn" class="action-btn small-btn" style="background: var(--primary-color, #6366f1); color: white; border: none; padding: 6px 12px; cursor: pointer; font-size: 12px; border-radius: 4px; font-weight: bold;">Salvar Novo Perfil</button>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;">
              ${(window.sgdPermissions?.channels || WARNING_CHANNELS).map(ch => `
                <label style="display: flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; color: var(--text-color-main);">
                  <input type="checkbox" class="ac-new-profile-channel-checkbox" value="${escapeHTML(ch)}" style="width: auto; margin: 0;">
                  ${escapeHTML(ch)}
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Lista de perfis salvos -->
          <div id="ac-profiles-list" style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${profiles.length > 0
              ? profiles.map(p => `
                <span class="ac-profile-pill" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 20px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main);" title="Canais: ${escapeHTML(p.channels.join(', '))}">
                  ${escapeHTML(p.name)}
                  <button class="ac-delete-profile-btn" data-profile-id="${escapeHTML(p.id)}" style="background: none; border: none; padding: 0; margin: 0; cursor: pointer; font-size: 10px; opacity: 0.6; line-height: 1;">❌</button>
                </span>
              `).join('')
              : '<p style="color: var(--text-color-muted); font-size: 11px; width: 100%; margin: 0;">Nenhum perfil de canais salvo ainda.</p>'
            }
          </div>
        </div>
      </div>
    `

    container.innerHTML = `
      <div class="ip-access-current-user" style="padding: 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm, 4px); display: flex; align-items: center; justify-content: space-between;">
        <div>
          <span style="font-size: 12px; color: var(--text-color-muted);">Você está logado como:</span>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
            <span style="font-weight: 700; font-size: 14px; color: var(--text-color-main);">${escapeHTML(window.sgdPermissions.currentUser || 'Desconhecido')}</span>
            <span style="font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; background: var(--action-green, #22c55e); color: #fff;">✏️ Editor</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${enableTeamManagement ? `
            <button id="ac-filter-team-btn" class="action-btn secondary-btn compact" title="Filtrar membros da Equipe AT" style="font-size: 12px; padding: 6px 12px; border: 1px solid var(--border-color); background: ${acOnlyShowTeamAT ? 'var(--primary-color, #6366f1)' : 'var(--background-main)'}; color: ${acOnlyShowTeamAT ? '#fff' : 'var(--text-color-main)'}; font-weight: ${acOnlyShowTeamAT ? 'bold' : 'normal'}; cursor: pointer;">
              👥 ${acOnlyShowTeamAT ? 'Apenas Equipe AT' : 'Filtrar Equipe AT'}
            </button>
          ` : ''}
          ${isMaster ? `
            <button id="ac-config-channels-btn" class="action-btn secondary-btn compact" title="Configurar canais disponíveis" style="font-size: 12px; padding: 6px 12px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); cursor: pointer;">⚙️ Canais</button>
            <button id="ac-audit-logs-btn" class="action-btn secondary-btn compact" title="Ver logs de auditoria" style="font-size: 12px; padding: 6px 12px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); cursor: pointer;">📋 Auditoria</button>
          ` : ''}
          <button id="ac-refresh-btn" class="action-btn secondary-btn compact" title="Atualizar lista" style="font-size: 12px; padding: 6px 12px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); cursor: pointer;">🔄 Atualizar</button>
        </div>
      </div>

      <!-- Perfis de Canais no Topo -->
      ${profilesHtml}

      <div style="margin: 16px 0; border-top: 1px solid var(--border-color);"></div>

      <!-- Seção de Editores com busca dedicada -->
      <div style="margin-bottom: 12px;">
        <strong style="font-size: 14px; color: var(--text-color-main);">✏️ Editores (${editors.length})</strong>
      </div>
      <div style="margin-bottom: 12px;">
        <input 
          type="text" 
          id="ac-search-editors-input" 
          placeholder="🔎 Pesquisar editor por nome..." 
          class="ip-filter-input" 
          style="width: 100%; padding: 8px 12px; font-size: 13px; border-radius: var(--border-radius-sm, 4px); border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); box-sizing: border-box;"
        >
      </div>

      <div id="ip-editors-list" style="margin-bottom: 16px;">
        ${pendingRequestsHtml}
        ${editors.length > 0
          ? editors.map(renderEditorRow).join('')
          : '<p style="color: var(--text-color-muted); font-size: 13px; text-align: center; padding: 16px 0;">Nenhum editor cadastrado ainda.</p>'
        }
      </div>

      <div style="margin: 20px 0; border-top: 1px solid var(--border-color);"></div>

      <!-- Seção de Visualizadores com busca dedicada -->
      <div style="margin-bottom: 12px;">
        <strong style="font-size: 14px; color: var(--text-color-main);">👁️ Visualizadores Capturados (${viewers.length})</strong>
        <p style="font-size: 11px; color: var(--text-color-muted); margin: 4px 0 0 0;">
          Técnicos que utilizaram a extensão. Limite seus canais de visualização individualmente ou em lote.
        </p>
      </div>
      <!-- Ações em Lote -->
      <div class="bulk-actions-card" style="padding: 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm, 4px); margin-bottom: 12px;">
        <h5 style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; color: var(--text-color-main);">⚡ Ações em Lote para Selecionados (<span id="ac-selected-count">0</span>):</h5>
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px;">
          <!-- Pesquisa de visualizadores inline à esquerda -->
          <input 
            type="text" 
            id="ac-search-viewers-input" 
            placeholder="🔎 Pesquisar visualizador..." 
            class="ip-filter-input" 
            style="padding: 5px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); min-width: 150px; max-width: 200px; margin: 0; box-sizing: border-box;"
          >
          <div style="border-left: 1px solid var(--border-color); height: 20px; margin: 0 4px; flex-shrink: 0;"></div>
          
          <!-- Selecione um Perfil -->
          <select id="bulk-profile-select" style="padding: 5px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); min-width: 140px;">
            <option value="">Selecione um Perfil...</option>
            ${profiles.map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('')}
          </select>
          <!-- Aplicar perfil -->
          <button id="bulk-apply-profile-btn" class="action-btn small-btn" style="background: var(--primary-color, #6366f1); color: white; border: none; padding: 5px 12px; cursor: pointer; font-size: 12px; border-radius: 4px; font-weight: bold; white-space: nowrap;" disabled>Aplicar Perfil</button>
          
          <span style="font-size: 12px; color: var(--text-color-muted); font-weight: bold; white-space: nowrap; margin-left: 6px;">Canais:</span>
          
          <!-- Dropdown de Canais -->
          <select id="bulk-channel-select" style="padding: 5px 8px; font-size: 12px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); min-width: 110px;">
            <option value="all">Todos os Canais</option>
            ${(window.sgdPermissions?.channels || WARNING_CHANNELS).map(ch => `<option value="${escapeHTML(ch)}">${escapeHTML(ch)}</option>`).join('')}
          </select>
          
          <!-- Habilitar -->
          <button id="bulk-enable-channel-btn" class="action-btn small-btn" style="background: var(--action-green, #22c55e); color: white; border: none; padding: 5px 12px; cursor: pointer; font-size: 12px; border-radius: 4px; white-space: nowrap;" disabled>Habilitar</button>
          <!-- Desabilitar -->
          <button id="bulk-disable-channel-btn" class="action-btn small-btn" style="background: var(--action-red, #ef4444); color: white; border: none; padding: 5px 12px; cursor: pointer; font-size: 12px; border-radius: 4px; white-space: nowrap;" disabled>Desabilitar</button>
        </div>
      </div>      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-left: 12px;">
        <input type="checkbox" id="ac-select-all-viewers" style="width: 15px; height: 15px; margin: 0; cursor: pointer;">
        <label for="ac-select-all-viewers" style="font-size: 12px; cursor: pointer; font-weight: 600; color: var(--text-color-main);">Selecionar Todos</label>
      </div>

      <div id="ip-viewers-list">
        ${viewers.length > 0
          ? viewers.map(renderViewerRow).join('')
          : '<p style="color: var(--text-color-muted); font-size: 13px; text-align: center; padding: 16px 0;">Nenhum visualizador registrado ainda.</p>'
        }
      </div>
    `

    // ── Listeners ──

    // Botão de Auditoria click
    const auditBtn = container.querySelector('#ac-audit-logs-btn')
    if (auditBtn) {
      auditBtn.addEventListener('click', async () => {
        auditBtn.disabled = true
        const origText = auditBtn.textContent
        auditBtn.textContent = 'Carregando...'
        try {
          const logs = await window.sgdPermissions.getAuditLogs()
          openAuditLogsModal(logs)
        } catch (e) {
          alert('Erro ao carregar logs: ' + e.message)
        } finally {
          auditBtn.disabled = false
          auditBtn.textContent = origText
        }
      })
    }

    // Botão de Configuração de Canais click
    const configChannelsBtn = container.querySelector('#ac-config-channels-btn')
    if (configChannelsBtn) {
      configChannelsBtn.addEventListener('click', async () => {
        configChannelsBtn.disabled = true
        const origText = configChannelsBtn.textContent
        configChannelsBtn.textContent = 'Carregando...'
        try {
          const channels = await window.sgdPermissions.loadActiveChannels()
          openConfigChannelsModal(channels, sectionElement)
        } catch (e) {
          alert('Erro ao carregar canais: ' + e.message)
        } finally {
          configChannelsBtn.disabled = false
          configChannelsBtn.textContent = origText
        }
      })
    }

    // Alteração de Cargo (Comum vs Master)
    container.querySelectorAll('.ac-editor-role-select').forEach(select => {
      select.addEventListener('change', async () => {
        const editorId = select.dataset.editorId
        const newRole = select.value
        const row = select.closest('.ip-access-editor-row')
        const editorName = row ? row.querySelector('.ip-access-editor-name').textContent.trim().split('\n')[0] : 'Editor'

        const confirmed = confirm(`Alterar o cargo de "${editorName}" para "${newRole === 'master' ? 'Master' : 'Comum'}"?`)
        if (!confirmed) {
          loadAccessControl(sectionElement)
          return
        }

        select.disabled = true
        const success = await window.sgdPermissions.updateEditorRole(editorId, newRole)
        if (success) {
          showNotification('Cargo atualizado com sucesso!', 'success')
          loadAccessControl(sectionElement)
        } else {
          showNotification('Erro ao atualizar cargo.', 'error')
          select.disabled = false
        }
      })
    })

    // Salvar Perfil de Canais
    const saveProfileBtn = container.querySelector('#ac-save-profile-btn')
    if (saveProfileBtn) {
      saveProfileBtn.addEventListener('click', async () => {
        const nameInput = container.querySelector('#ac-profile-name')
        const profileName = nameInput ? nameInput.value.trim() : ''
        if (!profileName) {
          alert('Por favor, informe o nome do perfil.')
          return
        }

        const checkedBoxes = container.querySelectorAll('.ac-new-profile-channel-checkbox:checked')
        const selectedChannels = Array.from(checkedBoxes).map(cb => cb.value)
        if (selectedChannels.length === 0) {
          alert('Selecione pelo menos um canal para o perfil.')
          return
        }

        saveProfileBtn.disabled = true
        saveProfileBtn.textContent = 'Salvando...'
        const success = await window.sgdPermissions.saveChannelProfile(profileName, selectedChannels)
        if (success) {
          showNotification(`Perfil "${profileName}" salvo com sucesso!`, 'success')
          loadAccessControl(sectionElement)
        } else {
          showNotification('Erro ao salvar perfil.', 'error')
          saveProfileBtn.disabled = false
          saveProfileBtn.textContent = 'Salvar Novo Perfil'
        }
      })
    }

    // Excluir Perfil de Canais
    container.querySelectorAll('.ac-delete-profile-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const profileId = btn.dataset.profileId
        const confirmed = confirm(`Excluir o perfil de canais "${profileId}"?`)
        if (!confirmed) return

        btn.disabled = true
        const success = await window.sgdPermissions.deleteChannelProfile(profileId)
        if (success) {
          showNotification('Perfil excluído com sucesso.', 'success')
          loadAccessControl(sectionElement)
        } else {
          showNotification('Erro ao excluir perfil.', 'error')
          btn.disabled = false
        }
      })
    })

    // Aplicar Perfil Individual nos Checkboxes
    container.querySelectorAll('.ac-apply-profile-select').forEach(select => {
      select.addEventListener('change', () => {
        const profileId = select.value
        if (!profileId) return

        const profile = profiles.find(p => p.id === profileId)
        if (!profile) return

        const checkboxesDiv = select.closest('.ac-channels-container').querySelector('.ac-channels-checkboxes')
        if (checkboxesDiv) {
          const checkboxes = checkboxesDiv.querySelectorAll('.ac-channel-checkbox')
          checkboxes.forEach(cb => {
            cb.checked = profile.channels.includes(cb.value)
          })
        }
      })
    })

    // Ação em lote com Perfil de Canais
    const bulkProfileSelect = container.querySelector('#bulk-profile-select')
    const bulkApplyProfileBtn = container.querySelector('#bulk-apply-profile-btn')

    // Filtrar editores dinamicamente (busca local)
    const searchEditorsInput = container.querySelector('#ac-search-editors-input')
    if (searchEditorsInput) {
      searchEditorsInput.addEventListener('input', () => {
        const rawQuery = searchEditorsInput.value || ''
        const query = rawQuery.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        
        container.querySelectorAll('.ip-access-editor-row').forEach(row => {
          const nameSpan = row.querySelector('.ip-access-editor-name')
          const nameText = nameSpan ? nameSpan.textContent : ''
          const normName = nameText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          row.style.display = normName.includes(query) ? 'flex' : 'none'
        })
      })
    }

    // Filtrar visualizadores dinamicamente (busca local)
    const searchViewersInput = container.querySelector('#ac-search-viewers-input')
    if (searchViewersInput) {
      searchViewersInput.addEventListener('input', () => {
        const rawQuery = searchViewersInput.value || ''
        const query = rawQuery.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        
        container.querySelectorAll('.ip-access-viewer-row').forEach(row => {
          const nameSpan = row.querySelector('.ip-access-editor-name')
          const nameText = nameSpan ? nameSpan.textContent : ''
          const normName = nameText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          row.style.display = normName.includes(query) ? 'flex' : 'none'
        })
      })
    }

    // Alternar visualização da seção de perfis de canais
    const profilesHeader = container.querySelector('#ac-toggle-profiles-header')
    const profilesContent = container.querySelector('#ac-profiles-content')
    const profilesArrow = container.querySelector('#ac-profiles-arrow')
    if (profilesHeader && profilesContent && profilesArrow) {
      profilesHeader.addEventListener('click', () => {
        const isHidden = profilesContent.style.display === 'none'
        profilesContent.style.display = isHidden ? 'block' : 'none'
        profilesArrow.textContent = isHidden ? '▼ Recolher' : '▶ Expandir'
      })
    }

    // Promover visualizador a editor
    container.querySelectorAll('.ac-promote-editor-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const viewerId = btn.dataset.viewerId
        const viewerName = btn.dataset.viewerName
        const confirmed = confirm(`Promover "${viewerName}" para Editor?\n(Isso removerá da lista de visualizadores e ativará automaticamente o Modo DEV para ele na próxima abertura)`)
        if (!confirmed) return

        btn.disabled = true
        btn.textContent = 'Promovendo...'

        const success = await window.sgdPermissions.promoteViewerToEditor(viewerId, viewerName)
        if (success) {
          showNotification(`"${viewerName}" promovido a Editor com sucesso!`, 'success')
          loadAccessControl(sectionElement) // Recarrega
        } else {
          btn.disabled = false
          btn.textContent = '✏️ Tornar Editor'
          showNotification('Erro ao promover visualizador. Tente novamente.', 'error')
        }
      })
    })

    // Remover editor
    container.querySelectorAll('.ip-access-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const editorId = btn.dataset.editorId
        const editorName = btn.dataset.editorName
        const confirmed = confirm(`Remover "${editorName}" da lista de editores?`)
        if (!confirmed) return

        btn.disabled = true
        btn.textContent = 'Removendo...'

        const success = await window.sgdPermissions.removeEditor(editorId)
        if (success) {
          showNotification(`Editor "${editorName}" removido com sucesso.`, 'success')
          loadAccessControl(sectionElement) // Recarrega
        } else {
          btn.disabled = false
          btn.textContent = 'Remover'
          showNotification('Erro ao remover editor. Tente novamente.', 'error')
        }
      })
    })

    // Alternar visualização de checkboxes de canais
    container.querySelectorAll('.ac-toggle-channels-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.ac-channels-container')
        const checkboxesDiv = card.querySelector('.ac-channels-checkboxes')
        const isHidden = checkboxesDiv.style.display === 'none'
        checkboxesDiv.style.display = isHidden ? 'block' : 'none'
        btn.textContent = isHidden ? 'Fechar' : '✏️ Limitar'
      })
    })

    // Botão "Todos os Canais" nos checkboxes individuais
    container.querySelectorAll('.ac-select-all-channels-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const checkboxesContainer = btn.closest('.ac-channels-checkboxes')
        const checkboxes = checkboxesContainer.querySelectorAll('.ac-channel-checkbox')
        const allChecked = Array.from(checkboxes).every(cb => cb.checked)
        checkboxes.forEach(cb => cb.checked = !allChecked)
      })
    })

    // Salvar canais individuais
    container.querySelectorAll('.ac-save-channels-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        const type = btn.dataset.type
        const containerDiv = btn.closest('.ac-channels-checkboxes')
        const checkboxes = containerDiv.querySelectorAll('.ac-channel-checkbox')
        const allowedChannels = Array.from(checkboxes)
          .filter(cb => cb.checked)
          .map(cb => cb.value)

        btn.disabled = true
        btn.textContent = 'Salvando...'

        let success = false
        if (type === 'editor') {
          success = await window.sgdPermissions.updateEditorChannels(id, allowedChannels)
        } else {
          success = await window.sgdPermissions.updateViewerChannels(id, allowedChannels)
        }

        if (success) {
          showNotification('Canais permitidos atualizados com sucesso.', 'success')
          loadAccessControl(sectionElement)
        } else {
          btn.disabled = false
          btn.textContent = 'Salvar'
          showNotification('Erro ao atualizar canais.', 'error')
        }
      })
    })

    // Seleção em lote de Visualizadores
    const selectAllViewers = container.querySelector('#ac-select-all-viewers')
    const viewerCheckboxes = container.querySelectorAll('.ac-viewer-select-checkbox')
    const selectedCountSpan = container.querySelector('#ac-selected-count')
    const bulkEnableBtn = container.querySelector('#bulk-enable-channel-btn')
    const bulkDisableBtn = container.querySelector('#bulk-disable-channel-btn')

    const updateBulkButtonsState = () => {
      const checkedCount = Array.from(viewerCheckboxes).filter(cb => cb.checked).length
      selectedCountSpan.textContent = checkedCount
      const disabled = checkedCount === 0
      bulkEnableBtn.disabled = disabled
      bulkDisableBtn.disabled = disabled
      if (bulkApplyProfileBtn) {
        bulkApplyProfileBtn.disabled = disabled || !bulkProfileSelect.value
      }
    }

    if (selectAllViewers) {
      selectAllViewers.addEventListener('change', () => {
        const isChecked = selectAllViewers.checked
        viewerCheckboxes.forEach(cb => cb.checked = isChecked)
        updateBulkButtonsState()
      })
    }

    viewerCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const allChecked = Array.from(viewerCheckboxes).every(item => item.checked)
        if (selectAllViewers) selectAllViewers.checked = allChecked
        updateBulkButtonsState()
      })
    })

    // Botões de Ação em Lote (Canais)
    const handleBulkAction = async (action) => {
      const selectedIds = Array.from(viewerCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.viewerId)

      if (selectedIds.length === 0) return

      const channelSelect = container.querySelector('#bulk-channel-select')
      const channel = channelSelect.value

      const actionText = action === 'enable' ? 'Habilitar' : 'Desabilitar'
      const channelName = channel === 'all' ? 'Todos os canais' : `o canal "${channel}"`
      
      const confirmed = confirm(`${actionText} ${channelName} para os ${selectedIds.length} visualizadores selecionados?`)
      if (!confirmed) return

      bulkEnableBtn.disabled = true
      bulkDisableBtn.disabled = true
      const origText = action === 'enable' ? 'Habilitando...' : 'Desabilitando...'
      if (action === 'enable') bulkEnableBtn.textContent = origText
      else bulkDisableBtn.textContent = origText

      const success = await window.sgdPermissions.bulkUpdateViewersChannels(selectedIds, channel, action)
      if (success) {
        showNotification(`Ação em lote executada com sucesso!`, 'success')
        loadAccessControl(sectionElement)
      } else {
        showNotification(`Erro ao executar ação em lote.`, 'error')
        updateBulkButtonsState()
        bulkEnableBtn.textContent = 'Habilitar'
        bulkDisableBtn.textContent = 'Desativar'
      }
    }

    if (bulkEnableBtn) bulkEnableBtn.addEventListener('click', () => handleBulkAction('enable'))
    if (bulkDisableBtn) bulkDisableBtn.addEventListener('click', () => handleBulkAction('disable'))

    // Ação em Lote com Perfil
    if (bulkProfileSelect && bulkApplyProfileBtn) {
      bulkProfileSelect.addEventListener('change', updateBulkButtonsState)
      
      bulkApplyProfileBtn.addEventListener('click', async () => {
        const selectedIds = Array.from(viewerCheckboxes)
          .filter(cb => cb.checked)
          .map(cb => cb.dataset.viewerId)

        if (selectedIds.length === 0) return

        const profileId = bulkProfileSelect.value
        const profile = profiles.find(p => p.id === profileId)
        if (!profile) return

        const confirmed = confirm(`Aplicar o perfil "${profile.name}" (Canais: ${profile.channels.join(', ')}) para os ${selectedIds.length} visualizadores selecionados?`)
        if (!confirmed) return

        bulkApplyProfileBtn.disabled = true
        bulkApplyProfileBtn.textContent = 'Aplicando...'

        const promises = selectedIds.map(id => window.sgdPermissions.updateViewerChannels(id, profile.channels))
        try {
          await Promise.all(promises)
          showNotification('Perfil aplicado em lote com sucesso!', 'success')
          loadAccessControl(sectionElement)
        } catch (err) {
          console.error(err)
          showNotification('Erro ao aplicar perfil em lote.', 'error')
          updateBulkButtonsState()
          bulkApplyProfileBtn.textContent = 'Aplicar Perfil'
        }
      })
    }

    // Alterna o filtro de Equipe AT
    const filterTeamBtn = container.querySelector('#ac-filter-team-btn')
    if (filterTeamBtn) {
      filterTeamBtn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        acOnlyShowTeamAT = !acOnlyShowTeamAT
        loadAccessControl(sectionElement)
      })
    }

    // Atualizar lista
    const refreshBtn = container.querySelector('#ac-refresh-btn')
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        window.sgdPermissions.invalidateCache()
        loadAccessControl(sectionElement)
      })
    }
    
    // Evita que cliques nos checkboxes e selects sejam capturados e cancelados por scripts externos da página
    container.querySelectorAll('input[type="checkbox"], select').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
      })
    })

    // Ações de solicitação do Modo Dev (Aprovar / Rejeitar)
    container.querySelectorAll('.ac-approve-dev-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userKey = btn.dataset.userKey
        const userName = btn.dataset.userName
        const userId = btn.dataset.userId
        
        const confirmed = confirm(`Aprovar a solicitação de Modo Dev para "${userName}"?`)
        if (!confirmed) return
        
        btn.disabled = true
        btn.textContent = 'Aprovando...'
        
        try {
          const res = await fetch(`${RTDB_BASE_URL}/dev_requests/${userKey}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'approved',
              approvedAt: new Date().toISOString(),
              approvedBy: window.sgdPermissions.currentUser || 'Master Editor'
            })
          })
          if (res.ok) {
            showNotification(`Solicitação de Modo Dev para "${userName}" aprovada com sucesso!`, 'success')
            loadAccessControl(sectionElement)
          } else {
            showNotification('Erro ao aprovar solicitação no servidor.', 'error')
            btn.disabled = false
            btn.textContent = 'Aprovar'
          }
        } catch (e) {
          console.error(e)
          showNotification('Erro ao conectar ao Firebase.', 'error')
          btn.disabled = false
          btn.textContent = 'Aprovar'
        }
      })
    })

    container.querySelectorAll('.ac-reject-dev-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userKey = btn.dataset.userKey
        const userName = btn.dataset.userName
        
        const confirmed = confirm(`Rejeitar a solicitação de Modo Dev para "${userName}"?`)
        if (!confirmed) return
        
        btn.disabled = true
        btn.textContent = 'Rejeitando...'
        
        try {
          const res = await fetch(`${RTDB_BASE_URL}/dev_requests/${userKey}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'rejected',
              rejectedAt: new Date().toISOString(),
              rejectedBy: window.sgdPermissions.currentUser || 'Master Editor'
            })
          })
          if (res.ok) {
            showNotification(`Solicitação de Modo Dev para "${userName}" rejeitada.`, 'success')
            loadAccessControl(sectionElement)
          } else {
            showNotification('Erro ao rejeitar solicitação no servidor.', 'error')
            btn.disabled = false
            btn.textContent = 'Rejeitar'
          }
        } catch (e) {
          console.error(e)
          showNotification('Erro ao conectar ao Firebase.', 'error')
          btn.disabled = false
          btn.textContent = 'Rejeitar'
        }
      })
    })

    // Alterna o status da Equipe AT
    container.querySelectorAll('.ac-toggle-team-at-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        
        const userId = btn.dataset.userId
        const userName = btn.dataset.userName
        const isEditor = btn.dataset.isEditor === 'true'
        const currentStatus = btn.dataset.currentStatus === 'true'
        
        btn.disabled = true
        btn.textContent = 'Aguarde...'
        
        const success = await window.sgdPermissions.toggleUserEquipeAT(userId, isEditor, currentStatus)
        if (success) {
          showNotification(`Usuário "${userName}" ${!currentStatus ? 'ativado na' : 'removido da'} Equipe AT!`, 'success')
          loadAccessControl(sectionElement)
        } else {
          showNotification('Erro ao alterar status da Equipe AT.', 'error')
          btn.disabled = false
          btn.textContent = currentStatus ? '👥 Ativo Equipe AT' : '👥 Ativar Equipe AT'
        }
      })
    })

  } catch (error) {
    console.error('[SGD Permissions] Erro ao carregar controle de acesso:', error)
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--text-color-muted);">
        <p style="font-size: 32px; margin-bottom: 8px;">⚠️</p>
        <p style="font-size: 13px;">Erro ao carregar dados de permissões.</p>
        <p style="font-size: 12px; opacity: 0.7;">${escapeHTML(error.message)}</p>
        <button id="ac-retry-btn" class="action-btn secondary-btn compact" style="margin-top: 12px;">Tentar novamente</button>
      </div>
    `
    const retryBtn = container.querySelector('#ac-retry-btn')
    if (retryBtn) retryBtn.addEventListener('click', () => loadAccessControl(sectionElement))
  }
}

/**
 * Abre modal com os logs de auditoria
 */
function openAuditLogsModal(logs) {
  const formatDate = (isoString) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '—';
    }
  };

  const logsRows = logs.length > 0
    ? logs.map(log => `
        <tr style="border-bottom: 1px solid var(--border-color, #e5e7eb);">
          <td style="padding: 10px; font-size: 12px; color: var(--text-color-main); font-weight: 600;">${escapeHTML(log.operatorName)}</td>
          <td style="padding: 10px; font-size: 11px; color: var(--text-color-main);">
            <span class="ip-card-badge" style="background: var(--background-secondary); border: 1px solid var(--border-color); color: var(--text-color-muted); font-size: 10px; padding: 2px 6px; border-radius: 4px;">${escapeHTML(log.action)}</span>
          </td>
          <td style="padding: 10px; font-size: 12px; color: var(--text-color-main);">${escapeHTML(log.target)}</td>
          <td style="padding: 10px; font-size: 12px; color: var(--text-color-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(log.details || '')}">${escapeHTML(log.details || '')}</td>
          <td style="padding: 10px; font-size: 11px; color: var(--text-color-muted); text-align: right; white-space: nowrap;">${formatDate(log.timestamp)}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" style="padding: 16px; font-size: 12px; color: var(--text-color-muted); text-align: center;">Nenhum log de auditoria encontrado.</td></tr>`;

  const modalHtml = `
    <div style="padding: 10px; max-height: 650px; display: flex; flex-direction: column;">
      <p style="font-size: 13px; color: var(--text-color-muted); margin-bottom: 15px; margin-top: 0;">
        Histórico de ações administrativas realizadas na Central de Informações SGD.
      </p>
      
      <div style="overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px; flex: 1; min-height: 300px; max-height: 450px;">
        <table style="width: 100%; border-collapse: collapse; background: var(--background-main);">
          <thead>
            <tr style="background: var(--background-secondary); border-bottom: 1px solid var(--border-color); position: sticky; top: 0; z-index: 1;">
              <th style="padding: 10px; font-size: 11px; text-align: left; color: var(--text-color-muted); background: var(--background-secondary); position: sticky; top: 0;">Operador</th>
              <th style="padding: 10px; font-size: 11px; text-align: left; color: var(--text-color-muted); background: var(--background-secondary); position: sticky; top: 0;">Ação</th>
              <th style="padding: 10px; font-size: 11px; text-align: left; color: var(--text-color-muted); background: var(--background-secondary); position: sticky; top: 0;">Alvo</th>
              <th style="padding: 10px; font-size: 11px; text-align: left; color: var(--text-color-muted); background: var(--background-secondary); position: sticky; top: 0;">Detalhes</th>
              <th style="padding: 10px; font-size: 11px; text-align: right; color: var(--text-color-muted); background: var(--background-secondary); position: sticky; top: 0;">Data/Hora</th>
            </tr>
          </thead>
          <tbody>
            ${logsRows}
          </tbody>
        </table>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
        <button id="close-audit-logs-btn" class="ip-add-closing-btn" style="width: auto; padding: 8px 20px;">Fechar</button>
      </div>
    </div>
  `;

  const modal = createModal(
    'Log de Auditoria',
    modalHtml,
    null,
    {
      isManagementModal: false,
      modalId: 'audit-logs-modal',
      showShareButton: false
    }
  );

  const defaultActions = modal.querySelector('.se-modal-actions');
  if (defaultActions) defaultActions.remove();

  modal.style.zIndex = '10003';

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#close-audit-logs-btn');
  const xBtn = modal.querySelector('.se-close-modal-btn');

  const cleanup = () => modal.remove();

  if (closeBtn) closeBtn.addEventListener('click', cleanup);
  if (xBtn) xBtn.addEventListener('click', cleanup);
}

function openConfigChannelsModal(initialChannels, sectionElement) {
  let channels = [...initialChannels]

  function renderChannelsList(modalBody) {
    const listDiv = modalBody.querySelector('#cc-channels-list')
    if (!listDiv) return
    
    listDiv.innerHTML = channels.map((ch, idx) => `
      <div class="cc-channel-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input type="text" class="cc-channel-input" data-idx="${idx}" value="${escapeHTML(ch)}" style="flex: 1; padding: 6px 10px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--background-main); color: var(--text-color-main); box-sizing: border-box;">
        <button class="action-btn secondary-btn compact cc-delete-btn" data-idx="${idx}" title="Excluir canal" style="color: var(--action-red, #ef4444); border: 1px solid var(--border-color); background: var(--background-main); cursor: pointer; padding: 6px 10px;">❌</button>
      </div>
    `).join('')

    // Add delete listeners
    listDiv.querySelectorAll('.cc-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const idx = parseInt(btn.dataset.idx)
        const name = channels[idx]
        if (confirm(`Tem certeza que deseja excluir o canal "${name}"?\n(Avisos existentes neste canal não serão excluídos, mas novos avisos não poderão ser criados nele.)`)) {
          channels.splice(idx, 1)
          renderChannelsList(modalBody)
        }
      })
    })

    // Stop propagation on inputs so host page scripts don't intercept typing
    listDiv.querySelectorAll('.cc-channel-input').forEach(input => {
      input.addEventListener('click', e => e.stopPropagation())
      input.addEventListener('keydown', e => e.stopPropagation())
      input.addEventListener('input', e => {
        const idx = parseInt(input.dataset.idx)
        channels[idx] = input.value.trim()
      })
    })
  }

  const modalHtml = `
    <div style="padding: 10px; max-height: 600px; display: flex; flex-direction: column; width: 450px; box-sizing: border-box;">
      <p style="font-size: 13px; color: var(--text-color-muted); margin-bottom: 12px; margin-top: 0;">
        Gerencie os canais de avisos disponíveis para cadastro e visualização.
      </p>

      <!-- Seção para Adicionar Novo Canal -->
      <div style="display: flex; gap: 8px; margin-bottom: 15px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
        <input type="text" id="cc-new-channel-name" placeholder="Nome do novo canal..." style="flex: 1; padding: 8px 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--background-main); color: var(--text-color-main); box-sizing: border-box;">
        <button id="cc-add-channel-btn" class="action-btn small-btn" style="background: var(--primary-color, #6366f1); color: white; border: none; padding: 8px 16px; cursor: pointer; font-size: 13px; border-radius: 4px; font-weight: bold;">Adicionar</button>
      </div>

      <!-- Lista de Canais Atuais -->
      <div style="flex: 1; overflow-y: auto; max-height: 350px; padding-right: 4px;" id="cc-channels-list-container">
        <div id="cc-channels-list"></div>
      </div>

      <!-- Footer do Modal -->
      <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <button id="cc-cancel-btn" class="action-btn secondary-btn compact" style="padding: 8px 16px; border: 1px solid var(--border-color); background: var(--background-main); color: var(--text-color-main); cursor: pointer;">Cancelar</button>
        <button id="cc-save-btn" class="action-btn small-btn" style="background: var(--action-green, #22c55e); color: white; border: none; padding: 8px 20px; cursor: pointer; font-size: 13px; border-radius: 4px; font-weight: bold;">Salvar Alterações</button>
      </div>
    </div>
  `

  const modal = createModal(
    'Configurar Canais',
    modalHtml,
    null,
    {
      isManagementModal: false,
      modalId: 'config-channels-modal',
      showShareButton: false
    }
  )

  const defaultActions = modal.querySelector('.se-modal-actions')
  if (defaultActions) defaultActions.remove()

  modal.style.zIndex = '10003'
  document.body.appendChild(modal)

  const modalBody = modal.querySelector('.se-modal-body') || modal
  renderChannelsList(modalBody)

  // Adicionar canal logic
  const newChannelInput = modal.querySelector('#cc-new-channel-name')
  const addChannelBtn = modal.querySelector('#cc-add-channel-btn')

  if (newChannelInput) {
    newChannelInput.addEventListener('click', e => e.stopPropagation())
    newChannelInput.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        addChannelBtn.click()
      }
    })
  }

  if (addChannelBtn) {
    addChannelBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const newName = newChannelInput ? newChannelInput.value.trim() : ''
      if (!newName) {
        alert('Por favor, digite o nome do canal.')
        return
      }
      if (channels.includes(newName)) {
        alert('Este canal já existe!')
        return
      }
      channels.push(newName)
      if (newChannelInput) newChannelInput.value = ''
      renderChannelsList(modalBody)
    })
  }

  // Cancelar e Fechar listeners
  const cleanup = () => modal.remove()
  const cancelBtn = modal.querySelector('#cc-cancel-btn')
  const xBtn = modal.querySelector('.se-close-modal-btn')

  if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cleanup(); })
  if (xBtn) xBtn.addEventListener('click', (e) => { e.stopPropagation(); cleanup(); })

  // Salvar logic
  const saveBtn = modal.querySelector('#cc-save-btn')
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation()

      // Filtra e valida os canais antes de salvar
      const finalChannels = channels
        .map(ch => ch.trim())
        .filter(ch => ch !== '')

      if (finalChannels.length === 0) {
        alert('Pelo menos um canal deve ser configurado!')
        return
      }

      saveBtn.disabled = true
      saveBtn.textContent = 'Salvando...'

      const success = await window.sgdPermissions.saveActiveChannels(finalChannels)
      if (success) {
        showNotification('Canais atualizados com sucesso!', 'success')
        cleanup()
        // Recarrega o controle de acesso para refletir os novos canais nos filtros/dropdowns
        if (sectionElement) loadAccessControl(sectionElement)
      } else {
        alert('Erro ao salvar os canais. Tente novamente.')
        saveBtn.disabled = false
        saveBtn.textContent = 'Salvar Alterações'
      }
    })
  }
}


/**
 * Carrega e renderiza os formulários na seção correspondente
 * @param {HTMLElement} sectionElement - Elemento da seção de formulários
 * @param {string} filterType - Tipo de filtro ('forms' ou 'ai')
 */

async function loadForms(
  sectionElement,
  filterType = 'forms',
  searchQuery = ''
) {
  // Define o seletor do container baseado no filtro/seção
  const containerId =
    filterType === 'ai' ? '#ai-chains-container' : '#forms-container'
  const container = sectionElement.querySelector(containerId)
  if (!container) return

  try {
    // Buscar dados dos formulários
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'info-panel.js:loadForms',
        message: 'Function entry',
        data: { filterType, containerId },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'A'
      })
    }).catch(() => { })
    // #endregion

    const formsData = await fetchFormsData()

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'info-panel.js:loadForms',
        message: 'Forms data received',
        data: {
          hasData: !!formsData,
          hasCategories: !!formsData?.categories,
          categoriesCount: formsData?.categories?.length,
          isArray: Array.isArray(formsData)
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'A'
      })
    }).catch(() => { })
    // #endregion

    if (!formsData || !formsData.categories) {
      // #region agent log
      fetch(
        'http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: 'info-panel.js:loadForms',
            message: 'Invalid forms data',
            data: {
              hasData: !!formsData,
              hasCategories: !!formsData?.categories
            },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'A'
          })
        }
      ).catch(() => { })
      // #endregion
      throw new Error('Dados de formulários inválidos')
    }

    // Filtragem simples baseada no título da categoria (Case Insensitive)
    // Se for 'ai', pega categorias que contenham "AI", "Chain", "Assistente" ou termos associados de IA/Chain
    // Se for 'forms', pega o resto.
    const filteredCategories = formsData.categories
      .filter(cat => {
        const title = cat.category.toLowerCase()
        const isAiCategory =
          title.includes('ai') ||
          title.includes('chain') ||
          title.includes('assistente') ||
          title.includes('apoio') ||
          title.includes('filas') ||
          title.includes('módulo') ||
          title.includes('folha') ||
          title.includes('fiscal') ||
          title.includes('contabilidade') ||
          title.includes('relatório') ||
          title.includes('utilitário') ||
          title === 'outros' ||
          title === 'at' ||
          (cat.items && cat.items.some(item => item.url && (item.url.includes('aiplatform') || item.url.includes('ai-chains'))))

        return filterType === 'ai' ? isAiCategory : !isAiCategory
      })
      .map(cat => {
        if (searchQuery && searchQuery.trim() !== '') {
          const query = searchQuery.toLowerCase().trim()
          const filteredItems = cat.items.filter(item => {
            return (
              (item.title && item.title.toLowerCase().includes(query)) ||
              (item.description &&
                item.description.toLowerCase().includes(query))
            )
          })
          return { ...cat, items: filteredItems }
        }
        return cat
      })
      .filter(cat => cat.items.length > 0)

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
          fetch(
            'http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                location: 'info-panel.js:loadForms',
                message: 'Processing item',
                data: {
                  category: category.category,
                  itemIndex,
                  itemType: item.type,
                  hasTitle: !!item.title,
                  hasClosingData: !!item.closingData
                },
                timestamp: Date.now(),
                sessionId: 'debug-session',
                runId: 'run1',
                hypothesisId: 'C'
              })
            }
          ).catch(() => { })
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
              const closingDataKeys = item.closingData
                ? Object.keys(item.closingData)
                : []
              fetch(
                'http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    location: 'info-panel.js:loadForms',
                    message: 'Processing action-closing item',
                    data: {
                      hasClosingData,
                      closingDataKeys,
                      hasTitle: !!item.closingData?.title,
                      hasContent: !!item.closingData?.content
                    },
                    timestamp: Date.now(),
                    sessionId: 'debug-session',
                    runId: 'run1',
                    hypothesisId: 'C'
                  })
                }
              ).catch(() => { })

              if (!item.closingData) {
                throw new Error('closingData is missing')
              }
              const jsonString = JSON.stringify(item.closingData)
              const encoded = encodeURIComponent(jsonString)
              fetch(
                'http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    location: 'info-panel.js:loadForms',
                    message: 'action-closing encoding success',
                    data: {
                      jsonLength: jsonString.length,
                      encodedLength: encoded.length
                    },
                    timestamp: Date.now(),
                    sessionId: 'debug-session',
                    runId: 'run1',
                    hypothesisId: 'E'
                  })
                }
              ).catch(() => { })
            } catch (error) {
              fetch(
                'http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    location: 'info-panel.js:loadForms',
                    message: 'action-closing encoding error',
                    data: { error: error.message, stack: error.stack },
                    timestamp: Date.now(),
                    sessionId: 'debug-session',
                    runId: 'run1',
                    hypothesisId: 'E'
                  })
                }
              ).catch(() => { })
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

            const closingData = JSON.parse(
              decodeURIComponent(card.dataset.closing)
            )
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
            btn.style.background =
              'linear-gradient(135deg, #dc3545, #c82333) !important'

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

/**
 * @file system-status-ui.js
 * Funções de UI para gerenciar status dos sistemas com Firestore
 * Adicionar essas funções ao final do info-panel.js
 */

/**
 * Carrega e renderiza os status dos sistemas do Firestore
 * ATUALIZADO: Suporta forceRefresh
 */
async function loadSystemsStatus(sectionElement, forceRefresh = false) {
  const container = sectionElement.querySelector('#systems-status-container')
  if (!container) return

  // Mostra loading se for refresh forçado ou estiver vazio
  if (
    forceRefresh ||
    !container.innerHTML.trim() ||
    container.innerHTML.includes('ip-empty-state')
  ) {
    container.innerHTML = `
        <div class="ip-loading-container">
          <div class="ip-spinner"></div>
          <span>Carregando status dos sistemas...</span>
        </div>
      `
  }

  try {
    // 1. Carrega status oficial e estatísticas de usuários em paralelo
    // Passa forceRefresh para o serviço
    const [systems, userReports] = await Promise.all([
      getSystemsStatus(forceRefresh),
      window.systemStatusService.getRecentReportsStats()
    ])

    // 2. Renderiza combinando os dados (Incluindo Relatos)
    renderSystemsStatus(container, systems, userReports)
  } catch (error) {
    console.error('Erro ao carregar status dos sistemas:', error)
    container.innerHTML = `
      <div class="ip-error-state">
        <span class="ip-error-icon">⚠️</span>
        <h4>Erro ao carregar status</h4>
        <p>${escapeHTML(error.message)}</p>
      </div>
    `
  }
}

/**
 * Renderiza os cards de status dos sistemas com votação/relatos
 */
function renderSystemsStatus(container, systems, userReports = {}) {
  if (!systems || systems.length === 0) {
    container.innerHTML = `
      <div class="ip-empty-state">
        <span style="font-size: 24px;">📊</span>
        <h4>Nenhum sistema configurado</h4>
        <p>Configure os sistemas no Firebase Firestore.</p>
      </div>
    `
    return
  }

  let html = ''

  systems.forEach(system => {
    const badgeClass = getStatusBadgeClass(system.status)
    const statusLabel = getStatusLabel(system.status)

    // Dados de reportes de usuários
    const reportCount = userReports[system.id] || 0

    // Lógica visual do Downdetector (Barra de intensidade)
    const maxReportsReference = 20
    const intensityPct = Math.min(
      (reportCount / maxReportsReference) * 100,
      100
    )

    let intensityColor = 'var(--action-green)'
    let intensityLabel = 'Poucos Relatos'

    if (reportCount > 2) {
      intensityColor = 'var(--action-yellow)'
      intensityLabel = 'Possível Instabilidade'
    }
    if (reportCount > 5) {
      intensityColor = 'var(--action-red)'
      intensityLabel = 'Muitos Relatos'
    }

    // Verifica se o usuário já reportou recentemente
    const lastReportTime = localStorage.getItem(`last_report_${system.id}`)
    const COOLDOWN = 30 * 60 * 1000
    const canReport =
      !lastReportTime || Date.now() - parseInt(lastReportTime) > COOLDOWN

    const reportBtnHtml = `
        <button class="ip-report-btn ${canReport ? '' : 'disabled'}" 
                data-system-id="${system.id}" 
                title="${canReport ? 'Reportar que estou com problemas neste sistema' : 'Você já reportou recentemente'}">
            ${canReport ? '✋ Tenho Problemas' : '✅ Reportado'}
        </button>
    `

    // Permitimos HTML no workaround para suportar links inseridos pelo botão de hiperlink
    const workaroundHtml = system.workaround
      ? `<div class="ip-system-workaround"><strong>💡 Orientação:</strong> ${system.workaround}</div>`
      : ''

    // Botão de edição (modo dev)
    const editButtonHtml = developerMode
      ? `<button class="ip-edit-system-btn" data-system-id="${escapeHTML(system.id)}" title="Editar status">✏️</button>`
      : ''

    html += `
      <div class="ip-card system-status-card" data-system-id="${escapeHTML(system.id)}">
        <div class="ip-card-header">
          <div class="system-header-left">
              <h4 class="ip-card-title">${escapeHTML(system.name)}</h4>
          </div>
          <div class="system-header-right">
             <span class="ip-card-badge ${badgeClass}">${statusLabel}</span>
             ${editButtonHtml}
          </div>
        </div>
        
        <div class="ip-card-content">
  
        <div class="ip-system-message">${system.message}</div>
          ${workaroundHtml}
        </div>
        
        <div class="ip-system-reports-area">
            <div class="ip-reports-header">
                <span class="reports-count">${reportCount} relatos na última hora</span>
                <span class="reports-label" style="color: ${intensityColor}">${intensityLabel}</span>
            </div>
            <div class="ip-reports-bar-bg">
                <div class="ip-reports-bar-fill" style="width: ${intensityPct}%; background-color: ${intensityColor}"></div>
            </div>
        </div>

        <div class="ip-system-footer">
            <div class="ip-footer-left">
                ${system.updatedAt
        ? `<div class="ip-card-updated" title="Última Atualização Oficial"><span>🕒</span> ${new Date(
          system.updatedAt
        ).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })}</div>`
        : ''
      }
            </div>
            <div class="ip-reports-actions">
                ${reportBtnHtml}
            </div>
        </div>
      </div>
    `
  })

  container.innerHTML = html

  // Listeners dos botões de Reportar
  container.querySelectorAll('.ip-report-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      if (btn.classList.contains('disabled')) return

      const sysId = btn.dataset.systemId
      const originalText = btn.textContent
      btn.textContent = 'Enviando...'
      btn.classList.add('disabled')

      try {
        await window.systemStatusService.reportUserInstability(sysId)
        localStorage.setItem(`last_report_${sysId}`, Date.now())
        btn.textContent = '✅ Reportado'
        if (typeof showNotification === 'function') {
          showNotification(
            'Obrigado! Seu relato ajuda outros usuários.',
            'success'
          )
        } else {
          alert('Obrigado! Seu relato ajuda outros usuários.')
        }
        setTimeout(() => {
          const section = document.querySelector('#ip-section-instabilities')
          if (section) loadSystemsStatus(section, false)
        }, 1200)
      } catch (err) {
        console.error(err)
        btn.textContent = originalText
        btn.classList.remove('disabled')
        if (typeof showNotification === 'function') {
          showNotification('Erro ao enviar relato.', 'error')
        }
      }
    })
  })

  // Listeners de Edição (Dev)
  if (developerMode) {
    container.querySelectorAll('.ip-edit-system-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation()
        const systemId = btn.dataset.systemId
        const system = systems.find(s => s.id === systemId)
        if (system) openSystemEditModal(system)
      })
    })
  }
}

/**
 * Abre modal para editar status de um sistema
 * @param {object} system - Dados do sistema
 */
function openSystemEditModal(system) {
  const modalContent = `
    <div class="ip-edit-modal-container">
      <div class="ip-field-group">
        <label class="ip-field-label">Status do Sistema</label>
        <select id="edit-system-status" class="ip-filter-select compact" style="width: auto; height: 36px; max-width: 250px; min-width: 180px;">
          <option value="operational" ${system.status === 'operational' ? 'selected' : ''}>✅ Operacional</option>
          <option value="warning" ${system.status === 'warning' ? 'selected' : ''}>⚠️ Atenção</option>
          <option value="error" ${system.status === 'error' ? 'selected' : ''}>🔴 Instabilidade</option>
          <option value="down" ${system.status === 'down' ? 'selected' : ''}>❌ Fora do Ar</option>
        </select>
      </div>

      <div class="ip-field-group">
        <label class="ip-field-label">Mensagem de Status</label>
        <textarea 
          id="edit-system-message" 
          rows="2" 
          class="ip-filter-input ip-edit-textarea" 
          style="width: 100%; max-width: none; min-height: 60px;"
          placeholder="Descreva o que está acontecendo..."
        >${escapeHTML(system.message)}</textarea>
        <p style="font-size: 10px; color: var(--text-color-muted); margin-top: 4px;">Dica: Você poderá usar HTML (ex: &lt;b&gt;, &lt;br&gt;).</p>
      </div>

      <div class="ip-field-group">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label class="ip-field-label" style="margin-bottom: 0;">Orientação (Opcional)</label>
          <button id="add-link-btn" class="action-btn secondary-btn compact" title="Inserir Hiperlink" style="font-size: 11px; padding: 2px 8px;">
            🔗 Inserir Link
          </button>
        </div>
        <textarea 
          id="edit-system-workaround" 
          rows="2" 
          class="ip-filter-input ip-edit-textarea" 
          style="width: 100%; max-width: none; min-height: 60px;"
          placeholder="Ex: Tente recarregar a página."
        >${escapeHTML(system.workaround || '')}</textarea>
        <p style="font-size: 10px; color: var(--text-color-muted); margin-top: 4px;">Dica: Você poderá usar HTML para formatar sua mensagem.</p>
      </div>

      <div class="ip-field-group">
        <div style="display: flex; align-items: center; gap: 8px; padding: 10px; background-color: var(--background-secondary); border-radius: 4px; border: 1px dashed var(--border-color);">
          <input type='checkbox' id='auto-publish-warning' style='width: 16px; height: 16px; margin: 0; cursor: pointer; accent-color: var(--primary-color); border: 2px solid var(--border-color); border-radius: 3px; flex-shrink: 0;'>
          <label for='auto-publish-warning' style='font-weight: 600; color: var(--text-color-main); font-size: 13px; cursor: pointer; margin: 0;'>📢 Publicar um Aviso sobre esta alteração</label>
        </div>
      </div>

      <div style="font-size: 11px; color: var(--text-color-muted); margin-top: 10px;">
        ${system.updatedAt ? `Última atualização: ${new Date(system.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}
      </div>
    </div>
  `

  // Título padrão para o modal (será sobrescrito com HTML abaixo)
  const modalTitle = `Editar Status: ${system.name}`

  const modal = createModal(
    modalTitle,
    modalContent,
    async (modalBody, closeModal) => {
      const saveBtn = modal.querySelector('#modal-save-btn')
      const newStatus = modal.querySelector('#edit-system-status').value
      const newMessage = modal
        .querySelector('#edit-system-message')
        .value.trim()
      const newWorkaround = modal
        .querySelector('#edit-system-workaround')
        .value.trim()
      const autoPublishWarning = modal.querySelector(
        '#auto-publish-warning'
      ).checked

      if (!newMessage) {
        alert('Por favor, insira uma mensagem de status.')
        return
      }

      if (saveBtn) {
        saveBtn.disabled = true
        saveBtn.textContent = 'Salvando...'
      }

      try {
        const now = new Date().toISOString()
        await updateSystemStatus(system.id, {
          status: newStatus,
          message: newMessage,
          workaround: newWorkaround,
          updatedAt: now
        })

        // Se checkbox marcado, criar aviso automaticamente
        if (autoPublishWarning) {
          try {
            // Mapear status para tipo de aviso
            let warningType = 'info'
            if (newStatus === 'down' || newStatus === 'error') {
              warningType = 'danger'
            } else if (newStatus === 'warning') {
              warningType = 'warning'
            } else if (newStatus === 'operational') {
              warningType = 'success'
            }

            // Formatar o status para exibição
            const statusLabel = getStatusLabel(newStatus)

            // Compor mensagem do aviso (sem o status, que vai no título)
            let warningMessage = newMessage

            if (newWorkaround) {
              warningMessage += `<br><strong>💡 Orientação:</strong> ${newWorkaround}`
            }

            // Criar aviso
            await window.warningsService.createWarning({
              title: `Status do Sistema: ${system.name} - ${statusLabel}`,
              message: warningMessage,
              type: warningType,
              author: getCurrentUserName(),
              isTest: false,
              date: now
            })
          } catch (warningError) {
            console.error('Erro ao criar aviso automático:', warningError)
            // Não bloqueia o salvamento do status mesmo se o aviso falhar
          }
        }

        const sectionElement = document.querySelector(
          '#ip-section-instabilities'
        )
        if (sectionElement) {
          loadSystemsStatus(sectionElement)
        }

        closeModal()
      } catch (error) {
        console.error('Erro ao salvar:', error)
        alert('❌ Erro ao salvar alterações.')
        if (saveBtn) {
          saveBtn.disabled = false
          saveBtn.textContent = 'Salvar Alterações'
        }
      }
    },
    {
      isManagementModal: true,
      modalId: 'edit-system-modal',
      showShareButton: false
    }
  )

  // Injetar o título estilizado diretamente no cabeçalho do modal para aceitar HTML
  const headerTitle = modal.querySelector('.se-modal-header h3')
  if (headerTitle) {
    headerTitle.innerHTML = `<span>✏️</span> Editar Status: <span class="ip-system-name-highlight">${escapeHTML(system.name)}</span>`
  }

  // Adicionar funcionalidade ao botão de link
  const addLinkBtn = modal.querySelector('#add-link-btn')
  const workaroundTextarea = modal.querySelector('#edit-system-workaround')
  const statusSelect = modal.querySelector('#edit-system-status')
  const messageTextarea = modal.querySelector('#edit-system-message')

  // Modelos de mensagens padrão por status
  const statusTemplates = {
    operational: 'Todos os serviços operando normalmente.',
    warning:
      'Lentidão intermitente ou comportamento inesperado em XXXXX. Equipe técnica monitorando.',
    error: 'Indisponibilidade momentânea no XXXXX devido a XXXXX.',
    down: 'Serviço fora do ar devido a XXXXX.'
  }

  if (statusSelect && messageTextarea) {
    statusSelect.addEventListener('change', () => {
      const selectedStatus = statusSelect.value
      const currentMessage = messageTextarea.value.trim()

      // Só preenche se a mensagem estiver vazia ou for um dos templates antigos
      const isDefault =
        Object.values(statusTemplates).some(t => currentMessage === t) ||
        currentMessage === ''

      if (isDefault && statusTemplates[selectedStatus]) {
        messageTextarea.value = statusTemplates[selectedStatus]
        messageTextarea.focus()

        // Se houver XXXXX, seleciona para facilitar a substituição
        const index = messageTextarea.value.indexOf('XXXXX')
        if (index !== -1) {
          messageTextarea.setSelectionRange(index, index + 5)
        }
      }
    })
  }

  if (addLinkBtn && workaroundTextarea) {
    addLinkBtn.addEventListener('click', () => {
      if (typeof openLinkModal === 'function') {
        openLinkModal(workaroundTextarea, {
          hideButtonOption: true,
          zIndex: 10005
        })
      } else {
        // Fallback redundante
        const url = prompt('URL:', 'https://')
        if (url) {
          const text = prompt('Texto:', 'Clique aqui')
          const linkHtml = `<a href="${url}" target="_blank" style="color: var(--primary-color); text-decoration: underline;">${text}</a>`
          insertAtCursor(workaroundTextarea, linkHtml)
        }
      }
    })
  }

  // Ajustar labels dos botões padrão do createModal
  const saveBtn = modal.querySelector('#modal-save-btn')
  const cancelBtn = modal.querySelector('#modal-cancel-btn')

  if (saveBtn) saveBtn.innerHTML = '<span>💾</span> Salvar'
  if (cancelBtn) cancelBtn.textContent = 'Fechar'

  document.body.appendChild(modal)
}
