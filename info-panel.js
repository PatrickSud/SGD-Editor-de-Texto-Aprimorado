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
    { id: 'extensions', icon: '🧩', label: 'Extensões' },
    { id: 'team', icon: '👨‍💻', label: 'Técnicos' },
    { id: 'reports', icon: '📊', label: 'Relatórios' },
    { id: 'forms', icon: '📝', label: 'Formulários & Documentos' },
    { id: 'commands', icon: '💻', label: 'SQL & Comandos' }
  ]

  // Filtrar seções baseado no modo desenvolvedor
  const sections = developerMode
    ? allSections
    : allSections.filter(
        section => section.id === 'pending' || section.id === 'forms'
      )

  // Estrutura Base do Modal
  const sidebarHtml = `
    <div class="ip-sidebar">
      <div class="ip-sidebar-header" id="developer-mode-trigger">
        Central de Informações SGD
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
          loadForms(targetSection)
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

    // Carrega automaticamente as pendências se esta for a seção ativa
    if (pendingSection.classList.contains('active')) {
      loadPendingItems(pendingSection)
    }

    // Configurar listeners para os filtros
    const searchInput = pendingSection.querySelector('#pending-search')
    const statusFilter = pendingSection.querySelector('#pending-status-filter')

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
  const statusClass = getStatusClass(item.status)

  return `
        <div class="ip-pending-card ${statusClass}">
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
              Lentidão generalizada no acesso ao módulo de Lançamentos. Equipe de infraestrutura já acionada.
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
              <h4 class="ip-card-title">Integração Bancária</h4>
              <span class="ip-card-badge badge-warning">Atenção</span>
            </div>
            <div class="ip-card-content">
              Atraso na conciliação de alguns bancos (Itau, Bradesco).
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
              <strong>Reunião Geral:</strong> Sexta-feira às 14h. Pauta: Novas métricas de qualidade.
              <br><span style="font-size: 11px; color: var(--text-color-muted);">Postado hoje por Coordenação</span>
            </div>
          </li>
          <li class="ip-list-item">
            <div>
              <strong>Atualização do SGD:</strong> Nova versão será implantada hoje à noite. Salvem seus trabalhos.
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
              <h4 class="ip-card-title">JSON Formatter</h4>
            </div>
            <div class="ip-card-content">
              Facilita a visualização de payloads e logs em JSON.
              <a href="#" class="ip-link-btn">Instalar</a>
            </div>
          </div>
          <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">ColorZilla</h4>
            </div>
            <div class="ip-card-content">
              Picker de cores avançado e gerador de gradientes.
              <a href="#" class="ip-link-btn">Instalar</a>
            </div>
          </div>
        </div>
      `

    case 'team':
      return `
         <p class="ip-section-desc">Status da equipe técnica e escalas.</p>
         <div class="ip-card">
            <div class="ip-card-header">
              <h4 class="ip-card-title">Plantão N2</h4>
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
                    <h4 class="ip-card-title" style="margin-bottom: 8px;">Top Solucionadores (Semana)</h4>
                     <ol style="padding-left: 20px; color: var(--text-color-muted);">
                        <li>Maria Souza - 45 chamados</li>
                        <li>Carlos Pereira - 42 chamados</li>
                        <li>Ana Costa - 38 chamados</li>
                    </ol>
                </div>
                 <div class="ip-card">
                    <h4 class="ip-card-title" style="margin-bottom: 8px;">Minhas Métricas</h4>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                        <div style="text-align: center;">
                            <span style="display: block; font-size: 24px; font-weight: bold; color: var(--primary-color);">12</span>
                            <span style="font-size: 12px;">Resolvidos</span>
                        </div>
                         <div style="text-align: center;">
                            <span style="display: block; font-size: 24px; font-weight: bold; color: var(--action-orange);">4.8</span>
                            <span style="font-size: 12px;">Satisfação</span>
                        </div>
                    </div>
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

                        <select id="pending-sort" class="ip-filter-select compact" title="Ordenar por">
                            <option value="dias-desc">Dias ▼</option>
                            <option value="dias-asc">Dias ▲</option>
                            <option value="tramites-desc">Trâmites ▼</option>
                            <option value="tramites-asc">Trâmites ▲</option>
                            <option value="data-desc">Data recente</option>
                            <option value="data-asc">Data antiga</option>
                        </select>
                    </div>
                    <button id="refresh-pending-btn" class="action-btn small-btn enhanced-btn compact" title="Atualizar lista">🔄</button>
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
        <p class="ip-section-desc">Cheat sheet de comandos SQL e úteis.</p>
        
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
 */
async function loadForms(sectionElement) {
  const container = sectionElement.querySelector('#forms-container')
  if (!container) return

  try {
    // Buscar dados dos formulários
    const formsData = await fetchFormsData()

    if (!formsData || !formsData.categories) {
      throw new Error('Dados de formulários inválidos')
    }

    // Renderizar categorias e itens
    let html = ''

    formsData.categories.forEach(category => {
      html += `
        <div class="ip-forms-category">
          <h4 class="ip-forms-category-title">${escapeHTML(
            category.category
          )}</h4>
          <div class="ip-forms-grid">
      `

      category.items.forEach(item => {
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
        }
      })

      html += `
          </div>
        </div>
      `
    })

    container.innerHTML = html

    // Adicionar event listeners para documentos
    container.querySelectorAll('.ip-form-document').forEach(card => {
      card.addEventListener('click', () => {
        const content = card.getAttribute('data-content')
        showDocumentModal(content)
      })
    })
  } catch (error) {
    console.error('Erro ao carregar formulários:', error)
    container.innerHTML = `
      <div class="ip-error-container">
        <span style="color: var(--action-red); font-size: 24px;">⚠️</span>
        <p>Erro ao carregar formulários</p>
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
  const modal = createModal({
    title: '📄 Visualizar Documento',
    content: `
      <div style="max-height: 60vh; overflow-y: auto; padding: 16px;">
        ${content}
      </div>
    `,
    size: 'medium',
    showClose: true
  })

  document.body.appendChild(modal)
}
