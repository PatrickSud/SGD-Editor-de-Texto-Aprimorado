// token-extractor.js
// Tenta extrair o cookie 'accessToken' até 5 vezes com 1s de intervalo.
// Isso cobre o caso onde a página já carregou mas o cookie ainda está
// sendo setado pelo servidor após o redirecionamento do PingID.

(() => {
  const COOKIE_NAME = 'accessToken';
  const MAX_TENTATIVAS = 5;
  const INTERVALO_MS = 1000;

  let tentativa = 0;

  function tentarExtrair() {
    tentativa++;
    console.log(`[Sugestor SS] token-extractor tentativa ${tentativa}/${MAX_TENTATIVAS}...`);

    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === COOKIE_NAME && value) {
        console.log(`[Sugestor SS] Cookie encontrado na tentativa ${tentativa}.`);
        chrome.runtime.sendMessage({ action: 'tokenExtracted', token: value });
        return;
      }
    }

    // Não achou — tenta de novo se ainda tiver tentativas
    if (tentativa < MAX_TENTATIVAS) {
      setTimeout(tentarExtrair, INTERVALO_MS);
    } else {
      console.warn('[Sugestor SS] Cookie não encontrado após todas as tentativas.');
      chrome.runtime.sendMessage({ action: 'tokenExtractionFailed' });
    }
  }

  tentarExtrair();
})();