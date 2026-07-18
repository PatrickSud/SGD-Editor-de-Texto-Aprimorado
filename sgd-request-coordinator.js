/**
 * @file sgd-request-coordinator.js
 * Coordenador único e serializado de requisições ao SGD.
 *
 * Objetivo: garantir que NUNCA existam duas requisições simultâneas usando a
 * mesma sessão do SGD — nem entre abas diferentes do navegador, nem dentro da
 * mesma aba (como acontecia com o antigo `Promise.all` das sub-abas). O SGD
 * passou a devolver página em branco quando detecta concorrência na mesma
 * sessão, então toda captura de dados (alarme de 15 min, abertura manual do
 * painel e carregamento de aba) precisa passar por este ponto de controle.
 *
 * Estratégia:
 *   1. navigator.locks -> mutex nomeado, compartilhado por TODAS as abas do
 *      mesmo domínio no mesmo perfil. Só um "dono" executa por vez.
 *   2. single-flight / coalescing -> ao entrar no lock, se já existe um
 *      resultado recente (gravado por outra aba ou por uma chamada anterior),
 *      devolve o cache em vez de refazer o fetch. Assim, N abas que acordam no
 *      mesmo alarme resultam em 1 requisição só.
 *   3. runSequential -> helper para substituir Promise.all: quando uma operação
 *      precisa buscar várias sub-visões, elas são buscadas UMA POR VEZ.
 *
 * Importante: em caso de timeout ao esperar o lock, o coordenador JAMAIS faz
 * uma busca paralela — ele devolve o último resultado conhecido (mesmo velho)
 * ou sinaliza SGD_COORDINATOR_BUSY. A garantia de não-concorrência é absoluta.
 */

const SgdRequestCoordinator = (function () {
  // Prefixo dos locks (namespace por origem/perfil, compartilhado entre abas).
  const LOCK_PREFIX = 'sgd-coord:'
  // Prefixo das chaves de cache no chrome.storage.local (compartilhado entre abas).
  const RESULT_PREFIX = 'sgdCoordResult:'
  // Tempo padrão máximo esperando o lock antes de desistir (sem buscar em paralelo).
  const DEFAULT_WAIT_TIMEOUT_MS = 45000

  // Fila em memória usada APENAS como fallback quando navigator.locks não existe
  // (serializa dentro da própria aba; não coordena entre abas).
  const tabQueues = new Map()

  function isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.locks
  }

  /**
   * Lê o resultado em cache compartilhado.
   * @returns {Promise<{at:number, result:*}|null>}
   */
  async function readCache(key) {
    const storeKey = RESULT_PREFIX + key
    try {
      const obj = await chrome.storage.local.get([storeKey])
      return obj[storeKey] || null
    } catch (e) {
      return null
    }
  }

  /**
   * Grava o resultado no cache compartilhado (falha silenciosa: cache cheio
   * ou erro de storage nunca deve derrubar a busca em si).
   */
  async function writeCache(key, result, at) {
    const storeKey = RESULT_PREFIX + key
    try {
      await chrome.storage.local.set({ [storeKey]: { at, result } })
    } catch (e) {
      /* noop */
    }
  }

  /**
   * Fallback intra-aba: encadeia os workers em série usando uma cauda de Promise.
   */
  function inTabQueue(lockName, worker) {
    const prev = tabQueues.get(lockName) || Promise.resolve()
    const next = prev.then(worker, worker)
    tabQueues.set(
      lockName,
      next.catch(() => {})
    )
    return next
  }

  /**
   * Adquire o lock nomeado e executa `worker` como dono exclusivo.
   * Usa navigator.locks quando disponível; senão, cai na fila intra-aba.
   */
  async function acquire(lockName, waitTimeoutMs, worker) {
    if (!isSupported()) {
      return inTabQueue(lockName, worker)
    }

    const controller = waitTimeoutMs > 0 ? new AbortController() : null
    let timer = null
    if (controller) {
      timer = setTimeout(() => controller.abort(), waitTimeoutMs)
    }
    try {
      const options = { mode: 'exclusive' }
      if (controller) options.signal = controller.signal
      return await navigator.locks.request(lockName, options, worker)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * Ponto único de execução serializada.
   *
   * @param {string} key - chave lógica da operação (define lock e slot de cache).
   * @param {() => Promise<*>} producer - função que faz a busca REAL (deve ser
   *   internamente sequencial; use runSequential no lugar de Promise.all).
   * @param {object} [opts]
   * @param {number} [opts.maxAgeMs=0] - se o cache for mais novo que isso,
   *   reutiliza sem refazer a busca (coalescing entre abas do mesmo ciclo).
   * @param {boolean} [opts.force=false] - ignora o frescor do cache (ex.: botão
   *   "Atualizar"). Continua serializado pelo lock.
   * @param {number} [opts.waitTimeoutMs=45000] - tempo máximo esperando o lock.
   * @param {boolean} [opts.persist=true] - grava o resultado no cache compartilhado.
   * @returns {Promise<{result:*, fromCache:boolean, stale:boolean, at:number}>}
   */
  async function run(key, producer, opts = {}) {
    const {
      maxAgeMs = 0,
      force = false,
      waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
      persist = true
    } = opts

    // Caminho rápido: cache fresco o bastante, sem sequer disputar o lock.
    if (!force && maxAgeMs > 0) {
      const cached = await readCache(key)
      if (cached && Date.now() - cached.at < maxAgeMs) {
        return { result: cached.result, fromCache: true, stale: false, at: cached.at }
      }
    }

    const lockName = LOCK_PREFIX + key
    try {
      return await acquire(lockName, waitTimeoutMs, async () => {
        // Recheca DENTRO do lock: outra aba pode ter acabado de buscar enquanto
        // esperávamos. Se sim, aproveitamos o resultado dela (single-flight).
        if (!force && maxAgeMs > 0) {
          const cached = await readCache(key)
          if (cached && Date.now() - cached.at < maxAgeMs) {
            return { result: cached.result, fromCache: true, stale: false, at: cached.at }
          }
        }
        // Somos o dono único -> executa a busca real.
        const result = await producer()
        const at = Date.now()
        if (persist) await writeCache(key, result, at)
        return { result, fromCache: false, stale: false, at }
      })
    } catch (err) {
      // Desistimos de esperar o lock: NUNCA buscamos em paralelo. Devolvemos o
      // último resultado conhecido (mesmo velho) ou sinalizamos "ocupado".
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        const cached = await readCache(key)
        if (cached) {
          return { result: cached.result, fromCache: true, stale: true, at: cached.at }
        }
        const busy = new Error('SGD_COORDINATOR_BUSY')
        busy.code = 'SGD_COORDINATOR_BUSY'
        throw busy
      }
      throw err
    }
  }

  /**
   * Devolve o último resultado em cache (ou null), sem disputar lock nem buscar.
   * Útil para pintar a UI instantaneamente antes de uma atualização.
   */
  async function getCached(key) {
    const cached = await readCache(key)
    return cached ? cached.result : null
  }

  /**
   * Idade (ms) do resultado em cache, ou Infinity se não houver.
   */
  async function getCacheAge(key) {
    const cached = await readCache(key)
    return cached ? Date.now() - cached.at : Infinity
  }

  /**
   * Invalida o cache de uma chave (força nova busca na próxima chamada).
   */
  async function invalidate(key) {
    try {
      await chrome.storage.local.remove([RESULT_PREFIX + key])
    } catch (e) {
      /* noop */
    }
  }

  /**
   * Substituto sequencial de Promise.all: itera UM POR VEZ, aguardando cada
   * chamada terminar antes de iniciar a próxima. Use dentro de um `producer`
   * para buscar várias sub-visões sem concorrência na mesma sessão.
   *
   * @param {Array<*>} items
   * @param {(item:*, index:number) => Promise<*>} iterator
   * @returns {Promise<Array<*>>}
   */
  async function runSequential(items, iterator) {
    const results = []
    for (let i = 0; i < items.length; i++) {
      results.push(await iterator(items[i], i))
    }
    return results
  }

  return {
    run,
    getCached,
    getCacheAge,
    invalidate,
    runSequential,
    isSupported,
    LOCK_PREFIX,
    RESULT_PREFIX
  }
})()

if (typeof window !== 'undefined') {
  window.SgdRequestCoordinator = SgdRequestCoordinator
}
