/**
 * @file info-panel.js
 * Implementação do Painel de Informações e Alertas (Dashboard).
 */

/**
 * Abre o Painel de Informações e Alertas.
 */
function openInfoPanel() {
  const sections = [
    { id: 'instabilities', icon: '🚨', label: 'Instabilidades' },
    { id: 'notices', icon: '📢', label: 'Avisos' },
    { id: 'pending', icon: '⏳', label: 'Pendências' },
    { id: 'extensions', icon: '🧩', label: 'Extensões' },
    { id: 'team', icon: '👨‍💻', label: 'Técnicos' },
    { id: 'reports', icon: '📊', label: 'Relatórios' },
    { id: 'forms', icon: '📝', label: 'Formulários' },
    { id: 'commands', icon: '💻', label: 'SQL & Comandos' }
  ];

  // Estrutura Base do Modal
  const sidebarHtml = `
    <div class="ip-sidebar">
      <div class="ip-sidebar-header">Navegação</div>
      ${sections.map((s, index) => `
        <div class="ip-nav-item ${index === 0 ? 'active' : ''}" data-target="${s.id}">
          <span class="ip-nav-icon">${s.icon}</span>
          <span class="ip-nav-label">${s.label}</span>
        </div>
      `).join('')}
    </div>
  `;

  // Geradores de Conteúdo (Mock)
  const contentHtml = `
    <div class="ip-content-area">
      <div style="padding: 12px 16px; margin-bottom: 16px; background-color: color-mix(in srgb, var(--action-yellow) 15%, transparent); border: 1px solid color-mix(in srgb, var(--action-yellow) 30%, transparent); border-radius: var(--border-radius-sm); color: var(--text-color-main); font-size: 13px;">
        <strong>⚠️ Em Desenvolvimento:</strong> Esta funcionalidade ainda está sendo desenvolvida.
      </div>
      ${sections.map((s, index) => `
        <div id="ip-section-${s.id}" class="ip-section ${index === 0 ? 'active' : ''}">
          <h3 class="ip-section-title">${s.icon} ${s.label}</h3>
          ${getSectionContent(s.id)}
        </div>
      `).join('')}
    </div>
  `;

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
  );

  // Adiciona lógica de navegação
  const navItems = modal.querySelectorAll('.ip-nav-item');
  const contentSections = modal.querySelectorAll('.ip-section');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Remove active class
      navItems.forEach(n => n.classList.remove('active'));
      contentSections.forEach(s => s.classList.remove('active'));

      // Add active class
      item.classList.add('active');
      const targetId = item.dataset.target;
      const targetSection = modal.querySelector(`#ip-section-${targetId}`);
      if (targetSection) {
        targetSection.classList.add('active');
        
        // Se a seção for de pendências, carrega/atualiza os dados
        if (targetId === 'pending') {
            loadPendingItems(targetSection);
        }
      }
    });
  });

  // Configura o listener para o botão de atualizar na aba de pendências
  const pendingSection = modal.querySelector('#ip-section-pending');
  if (pendingSection) {
      const refreshBtn = pendingSection.querySelector('#refresh-pending-btn');
      if (refreshBtn) {
          refreshBtn.addEventListener('click', () => {
              loadPendingItems(pendingSection);
          });
      }
  }

  document.body.appendChild(modal);
}

/**
 * Carrega e renderiza os itens pendentes na seção fornecida.
 * @param {HTMLElement} sectionElement - O elemento da seção de pendências.
 */
async function loadPendingItems(sectionElement) {
    const container = sectionElement.querySelector('#pending-list-container');
    const refreshBtn = sectionElement.querySelector('#refresh-pending-btn');
    
    if (!container) return;

    // Estado de Loading
    container.innerHTML = `
        <div class="ip-loading-container">
            <div class="ip-spinner"></div>
            <span>Buscando pendências...</span>
        </div>
    `;
    
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        // fetchPendingItems deve estar disponível globalmente via pending-service.js
        const items = await fetchPendingItems();

        if (items.length === 0) {
            container.innerHTML = `
                <div class="ip-empty-state">
                    <span style="font-size: 24px;">🎉</span>
                    <h4>Nenhuma pendência encontrada!</h4>
                    <p>Você zerou suas pendências.</p>
                </div>
            `;
        } else {
            container.innerHTML = items.map(item => createPendingCard(item)).join('');
        }

    } catch (error) {
        container.innerHTML = `
            <div class="ip-error-state">
                <span class="ip-error-icon">⚠️</span>
                <h4>Erro ao carregar pendências</h4>
                <p>${escapeHTML(error.message)}</p>
                <p style="font-size: 12px; margin-top: 10px;">Verifique se você está logado no SGD e tente novamente.</p>
            </div>
        `;
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

/**
 * Retorna a classe CSS de status baseada no texto da situação.
 * @param {string} status - O texto da situação.
 * @returns {string} Classe CSS.
 */
function getStatusClass(status) {
    if (!status) return 'status-outro';
    const s = status.toLowerCase();
    
    if (s.includes('aguardando resposta - interna')) return 'status-aguardando-interna';
    if (s.includes('respondido - interna')) return 'status-respondido-interna';
    
    if (s.includes('em análise') || s.includes('técnico')) return 'status-analise';
    if (s.includes('respondido')) return 'status-respondido';
    if (s.includes('aguardando')) return 'status-aguardando';
    
    return 'status-outro';
}

/**
 * Cria o HTML para um card de pendência.
 * @param {object} item - Objeto da pendência.
 * @returns {string} HTML do card.
 */
function createPendingCard(item) {
    const statusClass = getStatusClass(item.status);

    return `
        <div class="ip-pending-card ${statusClass}">
            <div class="ip-pending-header">
                <div class="ip-pending-id-row">
                    <span class="ip-pending-id">${escapeHTML(item.id)}</span>
                    <span class="ip-meta-item" title="Dias em aberto">📅 ${escapeHTML(item.dias)}d</span>
                    <span class="ip-meta-item" title="Quantidade de trâmites">🔄 ${escapeHTML(item.qtdTramites)}</span>
                </div>
                <div class="ip-date-container">
                    <span class="ip-pending-date" title="Data de Abertura: ${escapeHTML(item.dataAbertura)}">${escapeHTML(item.dataAbertura)}</span>
                    <span class="ip-separator">|</span>
                    <span class="ip-last-tramite" title="Último Trâmite: ${escapeHTML(item.dataUltimoTramite)}">${escapeHTML(item.dataUltimoTramite)}</span>
                </div>
            </div>
            
            <div class="ip-pending-subject">
                <a href="${escapeHTML(item.link)}" target="_blank" style="color: inherit; text-decoration: none;" title="${escapeHTML(item.subject)}">
                    ${escapeHTML(item.subject)}
                </a>
            </div>

            <div class="ip-pending-footer">
                <span class="ip-pending-status" title="${escapeHTML(item.status)}">
                    <span class="ip-status-dot"></span>
                    ${escapeHTML(item.status)}
                </span>
                <a href="${escapeHTML(item.link)}" target="_blank" class="ip-pending-action-btn">Abrir ↗</a>
            </div>
        </div>
    `;
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
      `;

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
      `;

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
      `;

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
      `;
    
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
        `;

    case 'forms':
      return `
         <p class="ip-section-desc">Links rápidos para formulários internos.</p>
         <ul class="ip-list">
            <li class="ip-list-item">
                <a href="#" class="ip-link-btn" style="margin:0;">📝 Formulário Rona (Acesso Remoto)</a>
            </li>
             <li class="ip-list-item">
                <a href="#" class="ip-link-btn" style="margin:0;">📝 Solicitação de Férias</a>
            </li>
             <li class="ip-list-item">
                <a href="#" class="ip-link-btn" style="margin:0;">📝 Report de Bug Interno</a>
            </li>
         </ul>
      `;

    case 'pending':
        return `
            <div class="ip-pending-header-row">
                <p class="ip-section-desc" style="margin:0;">Itens pendentes extraídos do filtro de listas.</p>
                <button id="refresh-pending-btn" class="action-btn small-btn enhanced-btn">🔄 Atualizar Lista</button>
            </div>
            <div id="pending-list-container" class="ip-grid">
                <div class="ip-loading-container">
                    <span>Clique em Atualizar para carregar...</span>
                </div>
            </div>
        `;

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
      `;

    default:
      return '<p>Seção em desenvolvimento...</p>';
  }
}
