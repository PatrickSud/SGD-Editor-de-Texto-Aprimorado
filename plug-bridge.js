/**
 * PLUG Bridge
 * --------------
 * Roda DENTRO do iframe da Tria (https://tria.plugsocial.online/*), em todos os frames.
 *
 * Objetivo: fazer a conversa do PLUG persistir mesmo quando a página do SGD é
 * recarregada e compartilhá-la entre guias.
 *
 * Como a Tria provavelmente guarda a sessão da conversa em `sessionStorage`
 * (que é isolado por documento e perdido a cada recarga do iframe), este script
 * espelha o `sessionStorage` para o `localStorage` (que é compartilhado por origem
 * e persiste entre recargas e guias) e o restaura no início do carregamento,
 * antes do app da Tria inicializar.
 *
 * Observação: por rodar na origem da Tria, este script tem acesso ao storage dela,
 * o que não é possível a partir do domínio do SGD (política de mesma origem).
 */
(function () {
  'use strict'

  const PREFIX = '__plug_persist__:'

  /**
   * Restaura as chaves persistidas (localStorage) de volta para o sessionStorage.
   * Executado o mais cedo possível para que o app da Tria leia a sessão anterior.
   */
  function restoreSession() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const lsKey = localStorage.key(i)
        if (!lsKey || !lsKey.startsWith(PREFIX)) continue

        const realKey = lsKey.slice(PREFIX.length)
        // Não sobrescreve um valor que já exista nesta sessão (evita conflitos).
        if (sessionStorage.getItem(realKey) === null) {
          sessionStorage.setItem(realKey, localStorage.getItem(lsKey))
        }
      }
    } catch (e) {
      /* Storage pode estar indisponível em alguns contextos; ignora com segurança. */
    }
  }

  /**
   * Persiste o conteúdo atual do sessionStorage no localStorage (com prefixo).
   */
  function persistSession() {
    try {
      // Remove chaves persistidas que não existem mais na sessão atual.
      const currentKeys = new Set()
      for (let i = 0; i < sessionStorage.length; i++) {
        const sKey = sessionStorage.key(i)
        if (sKey) currentKeys.add(sKey)
      }

      const toRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const lsKey = localStorage.key(i)
        if (lsKey && lsKey.startsWith(PREFIX)) {
          const realKey = lsKey.slice(PREFIX.length)
          if (!currentKeys.has(realKey)) toRemove.push(lsKey)
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k))

      // Salva/atualiza as chaves atuais da sessão.
      for (let i = 0; i < sessionStorage.length; i++) {
        const sKey = sessionStorage.key(i)
        if (sKey) localStorage.setItem(PREFIX + sKey, sessionStorage.getItem(sKey))
      }
    } catch (e) {
      /* Ignora falhas de storage. */
    }
  }

  // Restaura imediatamente (run_at: document_start garante execução antes do app).
  restoreSession()

  // Salva periodicamente para capturar novas mensagens durante a conversa.
  setInterval(persistSession, 2000)

  // Salva também ao sair/ocultar a página, garantindo o estado mais recente.
  window.addEventListener('pagehide', persistSession)
  window.addEventListener('beforeunload', persistSession)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistSession()
  })

  // Sincroniza entre guias: ao detectar mudança no localStorage feita por outra
  // guia, reflete no sessionStorage local (efetivo no próximo carregamento da Tria).
  window.addEventListener('storage', e => {
    if (e.key && e.key.startsWith(PREFIX) && e.newValue !== null) {
      try {
        sessionStorage.setItem(e.key.slice(PREFIX.length), e.newValue)
      } catch (err) {
        /* Ignora. */
      }
    }
  })
})()
