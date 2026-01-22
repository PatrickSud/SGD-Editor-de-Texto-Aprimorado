/**
 * @file bi-scraper.js
 * Content Script para extração de dados do Power BI (NotReady by Agent).
 * Este script roda APENAS na máquina do Master PC (Coordenador) e envia dados para o Firestore.
 */

(function () {
  'use strict';

  const SCRAPER_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos
  const INITIAL_DELAY_MS = 5000; // Aguarda 5 segundos para o Power BI carregar
  const MASTER_PC_KEY = 'isMasterPC';

  let scraperIntervalId = null;
  let controlPanel = null;

  // ===== FUNÇÕES PRINCIPAIS =====

  /**
   * Verifica se esta máquina está configurada como Master PC.
   */
  async function isMasterPC() {
    try {
      const result = await chrome.storage.local.get([MASTER_PC_KEY]);
      return result[MASTER_PC_KEY] === true;
    } catch (error) {
      console.error('[BI Scraper] Erro ao verificar status de Master PC:', error);
      return false;
    }
  }

  /**
   * Configura esta máquina como Master PC (ou desativa).
   */
  async function setMasterPC(enabled) {
    try {
      await chrome.storage.local.set({ [MASTER_PC_KEY]: enabled });
      console.log(`%c[BI Scraper] Master PC ${enabled ? 'ATIVADO ✅' : 'DESATIVADO ❌'}`,
        `color: ${enabled ? '#4CAF50' : '#f44336'}; font-weight: bold; font-size: 14px;`);

      if (enabled) {
        console.log('[BI Scraper] Esta máquina agora irá enviar dados do Power BI para o Firestore.');
        startScraperLoop();
      } else {
        if (scraperIntervalId) {
          clearInterval(scraperIntervalId);
          scraperIntervalId = null;
          console.log('[BI Scraper] Loop de scraping interrompido.');
        }
      }

      updateControlPanel();
      return true;
    } catch (error) {
      console.error('[BI Scraper] Erro ao definir status de Master PC:', error);
      return false;
    }
  }

  /**
   * Extrai dados da tabela "NotReady by Agent" (name, %notReady, alocation).
   */
  function scrapeData() {
    const allCells = document.querySelectorAll('div[role="gridcell"], td');

    if (allCells.length === 0) {
      console.warn('[BI Scraper] Nenhuma célula encontrada. O Power BI pode ainda estar carregando.');
      return [];
    }

    console.log(`[BI Scraper] Encontradas ${allCells.length} células.`);

    const teamMap = new Map(); // Mapa para consolidar dados por nome do técnico

    function normalizeKey(name) {
      if (!name) return '';
      return name.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    // Percorre as células procurando padrões
    for (let i = 0; i < allCells.length; i++) {
      const cellText = allCells[i].textContent?.trim() || '';

      // PADRÃO 1: [Nome] seguido de [% Not Ready]
      // Geralmente em tabelas de resumo de indisponibilidade
      if (i < allCells.length - 1) {
        const nextCellText = allCells[i + 1].textContent?.trim() || '';
        const percentMatch = nextCellText.match(/^(\d+[,.]?\d*)\s*%$/);

        if (percentMatch) {
          const name = cellText;
          if (isValidName(name)) {
            const percentValue = parseFloat(percentMatch[1].replace(',', '.'));

            // Filtro de 0% e 100%
            if (percentValue > 0 && percentValue < 100) {
              const key = normalizeKey(name);
              if (!teamMap.has(key)) {
                teamMap.set(key, { name: name });
              }
              const member = teamMap.get(key);
              member.percentNotReady = percentValue;
              member.percentFormatted = nextCellText;
              member.status = percentValue > 20 ? 'Crítico' : percentValue > 16 ? 'Alerta' : 'Normal';
            }
          }
        }
      }

      // PADRÃO 2: [Coord] -> [Nome] -> [Alloc] -> [Presence] -> [Status] -> [Time]
      // Geralmente na tabela "Técnica Fone - Status dos técnicos"
      if (i < allCells.length - 5) {
        const potentialTime = allCells[i + 5].textContent?.trim() || '';
        // Verifica se a célula i+5 tem formato de tempo HH:MM:SS
        if (/^\d{2}:\d{2}:\d{2}$/.test(potentialTime)) {
          const name = allCells[i + 1].textContent?.trim() || '';
          if (isValidName(name)) {
            const key = normalizeKey(name);
            if (!teamMap.has(key)) {
              teamMap.set(key, { name: name });
            }
            const member = teamMap.get(key);
            member.presence = allCells[i + 3].textContent?.trim() || '';
            member.currentStatus = allCells[i + 4].textContent?.trim() || '';
            member.duration = potentialTime;
          }
        }
      }
    }

    // Auxiliar para validar nomes
    function isValidName(name) {
      if (!name || name.length < 3 || name.length > 50) return false;
      const clean = name.trim().toLowerCase();
      if (clean.includes('selecionar') || clean === 'total' || clean === 'name' || clean === 'técnico(a)') return false;
      if (/^\d/.test(clean)) return false;
      return true;
    }

    // Converte o mapa para array e limpa registros incompletos ou indesejados
    const teamData = Array.from(teamMap.values()).filter(m => {
      // Se tivermos a porcentagem, aplicamos o filtro de 0/100 já feito no loop
      // Mas garantimos que o nome seja válido e não seja um cabeçalho
      return m.name && m.name.toLowerCase() !== 'técnico(a)';
    });

    // Ordena primariamente por porcentagem (se houver) ou nome
    teamData.sort((a, b) => {
      if (a.percentNotReady !== undefined && b.percentNotReady !== undefined) {
        return b.percentNotReady - a.percentNotReady;
      }
      return a.name.localeCompare(b.name);
    });

    console.log(`%c[BI Scraper] Consolidados ${teamData.length} registros da equipe.`,
      teamData.length > 0 ? 'color: #4CAF50; font-weight: bold;' : 'color: #f44336; font-weight: bold;');

    return teamData;
  }

  /**
   * Envia os dados extraídos para o Service Worker.
   */
  async function sendDataToServiceWorker(data) {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'UPDATE_TEAM_STATUS',
        data: {
          members: data,
          timestamp: new Date().toISOString(),
          source: 'power_bi_not_ready'
        }
      });

      if (response?.success) {
        console.log('%c[BI Scraper] ✅ Dados enviados com sucesso para o Firestore!',
          'color: #4CAF50; font-weight: bold;');
        console.log(`[BI Scraper] ${response.membersCount || data.length} membros sincronizados.`);
        updateLastSync();
      } else {
        console.error('[BI Scraper] Falha ao enviar dados:', response?.error);
      }
    } catch (error) {
      console.error('[BI Scraper] Erro ao comunicar com o Service Worker:', error);
    }
  }

  /**
   * Função principal que faz o scraping e envia os dados.
   */
  async function scrapeAndSend() {
    console.log('[BI Scraper] Iniciando extração de dados...');

    const data = scrapeData();

    if (data.length > 0) {
      await sendDataToServiceWorker(data);
    } else {
      console.warn('[BI Scraper] Nenhum dado extraído. Verifique se a tabela "NotReady by Agent" está visível.');
    }

    return data;
  }

  /**
   * Inicia o loop de scraping.
   */
  async function startScraperLoop() {
    if (scraperIntervalId) {
      clearInterval(scraperIntervalId);
    }

    const isMaster = await isMasterPC();

    if (!isMaster) {
      console.log('%c[BI Scraper] Esta máquina NÃO é o Master PC.', 'color: #FF9800; font-weight: bold;');
      return;
    }

    console.log('%c[BI Scraper] Master PC detectado! Iniciando loop de scraping a cada 2 minutos.',
      'color: #4CAF50; font-weight: bold;');

    setTimeout(async () => {
      await scrapeAndSend();
      scraperIntervalId = setInterval(scrapeAndSend, SCRAPER_INTERVAL_MS);
    }, INITIAL_DELAY_MS);
  }

  // ===== PAINEL DE CONTROLE FLUTUANTE =====

  /**
   * Cria o painel de controle flutuante na página.
   */
  async function createControlPanel() {
    if (controlPanel) {
      controlPanel.remove();
    }

    const isMaster = await isMasterPC();

    controlPanel = document.createElement('div');
    controlPanel.id = 'bi-scraper-control-panel';
    controlPanel.innerHTML = `
      <style>
        #bi-scraper-control-panel {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #bi-scraper-control-panel .bi-panel {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 12px;
          padding: 16px;
          min-width: 300px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
          display: none;
        }
        #bi-scraper-control-panel .bi-panel.open {
          display: block;
          animation: slideUp 0.3s ease;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        #bi-scraper-control-panel .bi-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        #bi-scraper-control-panel .bi-logo {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
        }
        #bi-scraper-control-panel .bi-title {
          color: #fff;
          font-size: 14px;
          font-weight: 600;
        }
        #bi-scraper-control-panel .bi-subtitle {
          color: rgba(255,255,255,0.5);
          font-size: 11px;
        }
        #bi-scraper-control-panel .bi-status {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 8px;
          margin-bottom: 12px;
        }
        #bi-scraper-control-panel .bi-status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #f44336;
        }
        #bi-scraper-control-panel .bi-status-dot.active {
          background: #4CAF50;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(76, 175, 80, 0); }
        }
        #bi-scraper-control-panel .bi-status-text {
          color: #fff;
          font-size: 13px;
        }
        #bi-scraper-control-panel .bi-last-sync {
          color: rgba(255,255,255,0.5);
          font-size: 11px;
          margin-left: auto;
        }
        #bi-scraper-control-panel .bi-info {
          background: rgba(102, 126, 234, 0.1);
          border: 1px solid rgba(102, 126, 234, 0.3);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 12px;
          font-size: 11px;
          color: rgba(255,255,255,0.7);
        }
        #bi-scraper-control-panel .bi-actions {
          display: flex;
          gap: 8px;
        }
        #bi-scraper-control-panel .bi-btn {
          flex: 1;
          padding: 10px 16px;
          border: none;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        #bi-scraper-control-panel .bi-btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
        }
        #bi-scraper-control-panel .bi-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
        #bi-scraper-control-panel .bi-btn-danger {
          background: linear-gradient(135deg, #f44336 0%, #e91e63 100%);
          color: #fff;
        }
        #bi-scraper-control-panel .bi-btn-danger:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 20px rgba(244, 67, 54, 0.4);
        }
        #bi-scraper-control-panel .bi-btn-secondary {
          background: rgba(255,255,255,0.1);
          color: #fff;
        }
        #bi-scraper-control-panel .bi-btn-secondary:hover {
          background: rgba(255,255,255,0.2);
        }
        #bi-scraper-control-panel .bi-fab {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
          transition: all 0.3s;
          margin-left: auto;
        }
        #bi-scraper-control-panel .bi-fab:hover {
          transform: scale(1.1);
          box-shadow: 0 6px 30px rgba(102, 126, 234, 0.6);
        }
        #bi-scraper-control-panel .bi-fab.active {
          background: linear-gradient(135deg, #4CAF50 0%, #8BC34A 100%);
        }
      </style>
      
      <div class="bi-panel" id="bi-panel">
        <div class="bi-header">
          <div class="bi-logo">📊</div>
          <div>
            <div class="bi-title">SGD BI Scraper</div>
            <div class="bi-subtitle">NotReady by Agent Monitor</div>
          </div>
        </div>
        
        <div class="bi-status">
          <div class="bi-status-dot ${isMaster ? 'active' : ''}" id="bi-status-dot"></div>
          <span class="bi-status-text" id="bi-status-text">${isMaster ? 'Master PC Ativo' : 'Master PC Inativo'}</span>
          <span class="bi-last-sync" id="bi-last-sync">-</span>
        </div>
        
        <div class="bi-info">
          📌 Certifique-se de que a tabela <b>"NotReady by Agent"</b> (com name e %notReady) está visível na tela.
        </div>
        
        <div class="bi-actions">
          ${isMaster ? `
            <button class="bi-btn bi-btn-secondary" id="bi-btn-test">🔄 Executar</button>
            <button class="bi-btn bi-btn-danger" id="bi-btn-toggle">❌ Desativar</button>
          ` : `
            <button class="bi-btn bi-btn-primary" id="bi-btn-toggle">✅ Ativar Master PC</button>
          `}
        </div>
      </div>
      
      <button class="bi-fab ${isMaster ? 'active' : ''}" id="bi-fab" title="SGD BI Scraper">
        ${isMaster ? '✅' : '📊'}
      </button>
    `;

    document.body.appendChild(controlPanel);

    // Event listeners
    const fab = controlPanel.querySelector('#bi-fab');
    const panel = controlPanel.querySelector('#bi-panel');
    const toggleBtn = controlPanel.querySelector('#bi-btn-toggle');
    const testBtn = controlPanel.querySelector('#bi-btn-test');

    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
    });

    toggleBtn.addEventListener('click', async () => {
      const currentState = await isMasterPC();
      await setMasterPC(!currentState);
    });

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.textContent = '⏳ Executando...';
        testBtn.disabled = true;
        await scrapeAndSend();
        testBtn.textContent = '🔄 Executar';
        testBtn.disabled = false;
      });
    }

    document.addEventListener('click', (e) => {
      if (controlPanel && !controlPanel.contains(e.target)) {
        panel.classList.remove('open');
      }
    });
  }

  /**
   * Atualiza o painel de controle com o estado atual.
   */
  async function updateControlPanel() {
    if (!controlPanel) return;

    const isMaster = await isMasterPC();

    const statusDot = controlPanel.querySelector('#bi-status-dot');
    const statusText = controlPanel.querySelector('#bi-status-text');
    const fab = controlPanel.querySelector('#bi-fab');
    const actionsContainer = controlPanel.querySelector('.bi-actions');

    if (statusDot) {
      statusDot.classList.toggle('active', isMaster);
    }
    if (statusText) {
      statusText.textContent = isMaster ? 'Master PC Ativo' : 'Master PC Inativo';
    }
    if (fab) {
      fab.classList.toggle('active', isMaster);
      fab.textContent = isMaster ? '✅' : '📊';
    }
    if (actionsContainer) {
      actionsContainer.innerHTML = isMaster ? `
        <button class="bi-btn bi-btn-secondary" id="bi-btn-test">🔄 Executar</button>
        <button class="bi-btn bi-btn-danger" id="bi-btn-toggle">❌ Desativar</button>
      ` : `
        <button class="bi-btn bi-btn-primary" id="bi-btn-toggle">✅ Ativar Master PC</button>
      `;

      const toggleBtn = actionsContainer.querySelector('#bi-btn-toggle');
      const testBtn = actionsContainer.querySelector('#bi-btn-test');

      toggleBtn?.addEventListener('click', async () => {
        const currentState = await isMasterPC();
        await setMasterPC(!currentState);
      });

      testBtn?.addEventListener('click', async () => {
        testBtn.textContent = '⏳ Executando...';
        testBtn.disabled = true;
        await scrapeAndSend();
        testBtn.textContent = '🔄 Executar';
        testBtn.disabled = false;
      });
    }
  }

  /**
   * Atualiza o timestamp da última sincronização.
   */
  function updateLastSync() {
    if (!controlPanel) return;

    const lastSyncEl = controlPanel.querySelector('#bi-last-sync');
    if (lastSyncEl) {
      const now = new Date();
      lastSyncEl.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
  }

  // ===== INICIALIZAÇÃO =====

  async function init() {
    // Verifica se o modo desenvolvedor está ativo antes de carregar o painel
    const storage = await chrome.storage.local.get(['developerMode']);
    if (!storage.developerMode) {
      console.log('[BI Scraper] Modo Desenvolvedor desativado. O painel de controle não será carregado.');
      return;
    }

    await new Promise(resolve => setTimeout(resolve, INITIAL_DELAY_MS));
    createControlPanel();
    startScraperLoop();
    console.log('%c[BI Scraper] Script carregado! Clique no botão 📊 no canto inferior direito.',
      'color: #667eea; font-weight: bold;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
