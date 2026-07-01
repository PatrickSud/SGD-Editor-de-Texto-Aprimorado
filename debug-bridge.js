/**
 * @file debug-bridge.js
 * Roda no MUNDO PRINCIPAL da página (não no mundo isolado dos content
 * scripts), que é o contexto que o DevTools Console usa por padrão. Expõe
 * "sgdDebug" para que o técnico consiga digitar sgdDebug.ativar() /
 * .desativar() / .status() direto no console (F12), sem precisar trocar o
 * contexto de execução do console manualmente.
 *
 * Precisa ser declarado no manifest.json com "world": "MAIN" — uma tag
 * <script> inline injetada via JS não funciona aqui porque o SGD tem uma
 * Content-Security-Policy que bloqueia scripts inline (a injeção falha
 * silenciosamente). Scripts de content script declarados no manifest não
 * passam pela CSP da página, então esse arquivo funciona de forma confiável.
 *
 * Este arquivo não tem acesso à API chrome.* (isso não é permitido no mundo
 * principal por segurança). Por isso ele só repassa o comando via
 * CustomEvent para o config.js (mundo isolado), que é quem realmente lê/grava
 * no chrome.storage.local e imprime a confirmação no console.
 */
(function () {
  function enviarComando(action) {
    window.dispatchEvent(new CustomEvent('sgd-debug-command', { detail: { action } }))
  }

  window.sgdDebug = {
    ativar() {
      enviarComando('ativar')
    },
    desativar() {
      enviarComando('desativar')
    },
    status() {
      enviarComando('status')
    }
  }
})()
