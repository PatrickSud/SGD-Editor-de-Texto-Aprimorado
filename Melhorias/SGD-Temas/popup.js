document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('ext-toggle');
  const contrastToggle = document.getElementById('contrast-toggle');
  const select = document.getElementById('theme-select');

  chrome.storage.local.get(['sgdEnabled', 'sgdTheme', 'sgdSmartContrast'], (data) => {
    toggle.checked = data.sgdEnabled !== false;
    contrastToggle.checked = data.sgdSmartContrast || false;
    select.value = data.sgdTheme || 'padrao-mode';
  });

  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ sgdEnabled: toggle.checked }, notifyPage);
  });

  contrastToggle.addEventListener('change', () => {
    chrome.storage.local.set({ sgdSmartContrast: contrastToggle.checked }, notifyPage);
  });

  select.addEventListener('change', () => {
    chrome.storage.local.set({ sgdTheme: select.value }, notifyPage);
  });

  function notifyPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'refreshTheme' });
      }
    });
  }
});