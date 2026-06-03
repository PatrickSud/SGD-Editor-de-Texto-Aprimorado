/**
 * SGD Custom Themes - Content Script Otimizado
 * Foco: Performance, Isolamento e Estabilidade
 */

// 1. Estado Local (Cache para evitar chamadas assíncronas repetitivas)
let state = {
  enabled: true,
  theme: 'padrao-mode',
  smartContrast: false,
  disponiveis: [
    'padrao-mode', 'serenidade-mode', 'lumen-mode', 
    'pink-mode', 'forest-mode', 'dark-graphite-mode', 
    'dark-mode', 'tokyo-night-mode'
  ]
};

// Seletor para ignorar elementos do editor aprimorado
const EXCLUDE_SELECTOR = ':not(.editor-container):not(.editor-modal):not(#notes-side-panel):not(.editor-preview-container)';

/**
 * Limpa estilos legados de forma eficiente
 * @param {HTMLElement} root - O nó raiz para busca (default: document)
 */
function limparEstilosLegados(root = document) {
  if (!state.enabled) return;

  // 1. Limpeza de Atributos de Fundo (BGCOLOR e Estilos Inline de Background)
  // Otimização: Buscamos apenas elementos que não estão dentro dos containers protegidos
  const bgElements = root.querySelectorAll(`[bgcolor]${EXCLUDE_SELECTOR}, [style*="background"]${EXCLUDE_SELECTOR}, [style*="BACKGROUND"]${EXCLUDE_SELECTOR}`);
  
  bgElements.forEach(el => {
    // Verificação dupla de segurança para isolamento de escopo
    if (el.closest('.editor-container, .editor-modal, #notes-side-panel, .editor-preview-container')) return;

    if (el.hasAttribute('bgcolor')) el.removeAttribute('bgcolor');
    
    if (el.style.backgroundColor || el.style.background) {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
    }
  });

  // 2. Correção de Cores de Texto (Tags FONT e Estilos Inline de Color)
  const textElements = root.querySelectorAll(`font[color]${EXCLUDE_SELECTOR}, span[style*="color"]${EXCLUDE_SELECTOR}, td[style*="color"]${EXCLUDE_SELECTOR}`);
  
  textElements.forEach(el => {
    if (el.closest('.editor-container, .editor-modal, #notes-side-panel, .editor-preview-container')) return;

    if (el.hasAttribute('color')) el.removeAttribute('color');
    el.style.setProperty('color', 'var(--text-color-main)', 'important');
  });

  // 3. Detecção e correção de conflitos de contraste (Branco sobre Branco / Escuro sobre Escuro)
  const isDark = state.theme.includes('dark') || state.theme.includes('night') || state.theme.includes('forest') || state.theme.includes('graphite');
  
  if (isDark) {
    // Busca elementos com cores fixas que podem causar conflito em temas escuros
    root.querySelectorAll(`span${EXCLUDE_SELECTOR}, div${EXCLUDE_SELECTOR}, b${EXCLUDE_SELECTOR}, td${EXCLUDE_SELECTOR}, font${EXCLUDE_SELECTOR}`).forEach(el => {
      const style = window.getComputedStyle(el);
      const bgColor = style.backgroundColor;
      const color = style.color;

      // Se o fundo ainda estiver branco/claro por algum motivo, forçamos a transparência
      if (bgColor === 'rgb(255, 255, 255)' || bgColor === 'white' || bgColor === '#ffffff' || bgColor === 'rgb(239, 239, 239)') {
        el.style.setProperty('background-color', 'transparent', 'important');
      }

      // Se a cor do texto for preta/escura, forçamos a cor clara do tema
      if (color === 'rgb(0, 0, 0)' || color === 'black' || color === '#000000' || color === 'rgb(51, 51, 51)') {
        el.style.setProperty('color', 'var(--text-color-main)', 'important');
      }
    });
  }

  // 4. Filtro de Contraste Inteligente (Imagens e Ícones legados)
  if (state.smartContrast) {
    root.querySelectorAll(`img${EXCLUDE_SELECTOR}, input[type="image"]${EXCLUDE_SELECTOR}`).forEach(img => {
      // Se for tema escuro, inverte ícones que provavelmente têm fundo branco ou são escuros demais
      if (isDark) {
        img.style.setProperty('filter', 'contrast(1.1) brightness(0.9) invert(0.85) hue-rotate(180deg)', 'important');
        img.style.setProperty('mix-blend-mode', 'screen', 'important');
      } else {
        img.style.removeProperty('filter');
        img.style.removeProperty('mix-blend-mode');
      }
    });
  }
}

/**
 * Aplica o tema configurado no elemento HTML
 */
function applyTheme() {
  const htmlElement = document.documentElement;
  
  // Remove temas anteriores
  htmlElement.classList.remove(...state.disponiveis);
  
  if (state.enabled) {
    htmlElement.classList.add(state.theme);
    limparEstilosLegados();
  }
}

/**
 * Carrega configurações do storage e inicializa
 */
function init() {
  chrome.storage.local.get(['sgdEnabled', 'sgdTheme', 'sgdSmartContrast'], (data) => {
    state.enabled = data.sgdEnabled !== false;
    state.theme = data.sgdTheme || 'padrao-mode';
    state.smartContrast = data.sgdSmartContrast || false;
    
    applyTheme();
  });
}

// Debounce para o MutationObserver (Evita processamento excessivo)
let debounceTimer;
const observer = new MutationObserver((mutations) => {
  if (!state.enabled) return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Otimização: Em vez de processar todo o documento, 
    // poderíamos processar apenas mutations.addedNodes, 
    // mas para sistemas legados com tabelas complexas, o processamento global debounced é mais seguro.
    limparEstilosLegados();
  }, 150); // Delay de 150ms para agrupar mudanças do DOM
});

// Listener para mudanças no storage (Sincronização em tempo real entre abas)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.sgdEnabled) state.enabled = changes.sgdEnabled.newValue;
  if (changes.sgdTheme) state.theme = changes.sgdTheme.newValue;
  if (changes.sgdSmartContrast) state.smartContrast = changes.sgdSmartContrast.newValue;
  applyTheme();
});

// Listener para mensagens manuais (caso necessário)
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'refreshTheme') {
    init();
  }
});

// Inicialização em estágios
init();
window.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  observer.observe(document.body || document.documentElement, { 
    childList: true, 
    subtree: true 
  });
});

window.addEventListener('load', () => {
  // Garantia final após carregamento de todos os recursos
  limparEstilosLegados();
});
