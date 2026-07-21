/**
 * @file client-info-service.js
 * Consulta de Cliente (Domínio Web) — painel flutuante que consulta a API interna
 * do escritório e exibe as informações do cliente detectado na página do SGD.
 *
 * Ponto crítico de arquitetura:
 *   A página do SGD roda em HTTPS e a API interna é HTTP (mixed content). Por isso
 *   o fetch NÃO é feito aqui (content script, contexto da página) — quem busca é o
 *   service worker, via mensagem { action: 'FETCH_CLIENT_INFO' }. O SW roda em
 *   contexto de extensão e, com a host_permission declarada no manifest, não sofre
 *   bloqueio de mixed content nem de CORS.
 *
 * Visibilidade da lupa:
 *   A lupa SÓ aparece quando há um clienteID detectável na página. Se não houver,
 *   o botão é ocultado (o grupo fica só com IAplug + Ir ao Topo, lado a lado).
 *   A visibilidade é reavaliada periodicamente para acompanhar a navegação do SGD.
 *
 * Modos de visualização (toggle "Simplificado" no cabeçalho):
 *   - Simplificado (padrão): esconde Jenkins e Tempo aproximado e encurta os
 *     valores (ver-cont-106A06.10 -> 106A06.10; srv-srvcontabil32003 -> 32003;
 *     DWAGNFE001VW-PD-AZV -> NFE001; DWAGDA085VW-PD-AZV -> DA085). Código e
 *     Tamanho DB ficam iguais.
 *   - Completo: mostra tudo exatamente como a API devolve.
 *
 * Preferências (guardadas em sync storage, seção preferences):
 *   - enableClientInfo     : liga/desliga o recurso (padrão: true)
 *   - clientInfoAutoFetch   : consulta automática ao detectar o cliente (padrão: false)
 *   - clientInfoSimplified  : modo simplificado (padrão: true)
 */

;(function () {
  if (!location.hostname.includes('sgd.dominiosistemas.com.br')) return

  // ─── Constantes ────────────────────────────────────────────────────────────
  const ENABLE_PREF_KEY = 'enableClientInfo'
  const AUTO_PREF_KEY = 'clientInfoAutoFetch'
  const SIMPLE_PREF_KEY = 'clientInfoSimplified'
  const FAB_ID = 'sgd-client-info-fab'
  const PANEL_ID = 'sgd-client-info-panel'
  const GROUP_ID = 'scroll-btn-group'
  const VISIBILITY_POLL_MS = 1500 // reavalia se há cliente na página (acompanha navegação)

  // Colunas escondidas no modo simplificado (casam pelo texto do header da API).
  const SIMPLE_HIDE_HEADER_RE = /jenkins|tempo/i

  // Renomeia os cabeçalhos exibidos (aplica nos dois modos). Os que não estão
  // aqui (Engine, Tamanho DB, Jenkins, Tempo aproximado) ficam como vêm da API.
  const HEADER_RENAME = {
    'Código de Cliente': 'Cliente',
    'Versão do Banco de Dados': 'Versão Domínio',
    'Servidor SEFAZ': 'SEFAZ',
    'Servidor Busca NFe': 'Busca NFe',
    'Servidor Agente de Comunicação': 'Agente de Comunicação'
  }

  /** Aplica o rótulo curto do cabeçalho, se houver. */
  function renomearHeader(h) {
    return HEADER_RENAME[h] || h
  }

  // Ícones brancos (SVG) da lupa e do X — mais nítidos que o emoji e sempre brancos.
  const ICON_SEARCH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"></circle><line x1="15.5" y1="15.5" x2="21" y2="21"></line></svg>'
  const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>'

  let fabObserver = null
  let outsideBindTimer = null
  let visibilityTimer = null
  let lastClientId = null
  let networkErrorSuppressAuto = false // se a última consulta falhou (fora da rede), não abrir sozinho
  let simplifiedMode = true // atualizado a partir das preferências
  let lastResult = null // { clienteId, parsed } — para re-render ao trocar de modo sem nova consulta

  // ─── Regras de "tradução" (usadas apenas no fallback) ────────────────────────
  // A API já devolve os campos traduzidos em "headers". Estas regras só entram em
  // ação se algum dia a API retornar valores soltos sem "headers".
  const CLIENT_FIELD_RULES = [
    { test: v => v.startsWith('ver-cont'), label: 'Versão do Banco de Dados' },
    { test: v => v.startsWith('srv-srvcontabil'), label: 'Engine' },
    { test: v => v.startsWith('srv-srvunsmodelos'), label: 'Banco Modelo' },
    { test: v => v.startsWith('DWAGNFE'), label: 'Servidor Busca NFe' },
    { test: v => v.startsWith('DWAGSEF'), label: 'Servidor SEFAZ' },
    { test: v => v.startsWith('DWAGDA'), label: 'Servidor Agente de Comunicação' },
    { test: v => v.startsWith('DMS Ponto'), label: 'Grupo do Ponto' },
    { test: v => v === 'TRADM-REMOVED', label: 'Removido do DW' },
    { test: v => v === 'TRADM-SkipUpdateDB', label: 'Pulando atualizações' },
    { test: v => v === 'TRADM-SkipSendBackupNuvem', label: 'Não está enviando backups para nuvem' },
    { test: v => v === 'TRADM-Support', label: 'Parâmetros de Suporte' },
    { test: v => v === 'STOPPED', label: 'Banco de Dados Parado' }
  ]

  /**
   * Traduz um valor solto para o nome amigável da coluna (usado só no fallback).
   * @param {string} value
   * @returns {string} rótulo amigável ou 'Desconhecido'
   */
  function traduzirCampo(value) {
    const v = String(value == null ? '' : value).trim()
    const regra = CLIENT_FIELD_RULES.find(r => r.test(v))
    return regra ? regra.label : 'Desconhecido'
  }

  /**
   * Encurta um valor para o modo simplificado. É um "no-op" para valores que não
   * casam com nenhum padrão (ex.: Código de Cliente, Tamanho DB), então pode ser
   * aplicado a todas as células com segurança.
   *   ver-cont-106A06.10        -> 106A06.10
   *   srv-srvcontabil32003      -> 32003
   *   srv-srvunsmodelos123      -> 123
   *   DWAGNFE001VW-PD-AZV       -> NFE001
   *   DWAGSEF015VW-PD-AZV       -> SEF015
   *   DWAGDA085VW-PD-AZV        -> DA085
   * @param {string} value
   * @returns {string}
   */
  function simplificarValor(value) {
    const v = String(value == null ? '' : value).trim()
    if (v.startsWith('ver-cont-')) return v.slice('ver-cont-'.length)
    let m = v.match(/^srv-srvcontabil(.+)$/)
    if (m) return m[1]
    m = v.match(/^srv-srvunsmodelos(.+)$/)
    if (m) return m[1]
    // Servidores DWAG*: pega as letras + números logo após "DWAG" (antes de "VW").
    m = v.match(/^DWAG([A-Z]+\d+)/)
    if (m) return m[1]
    return v
  }

  /**
   * Normaliza o JSON da API em { headers: string[], rows: string[][] }.
   *
   * Formato atual da API (GET /api/client/{id}):
   *   {
   *     "code": "79751",
   *     "headers": ["Código de Cliente","Versão do Banco de Dados","Engine", ...],
   *     "rows": [["ver-cont-106A06.10","srv-srvcontabil93601", ...]],
   *     "db_size_human": "10.16 GB", "jenkins_human": "8min",
   *     "tempo_aproximado_human": "10min", ...
   *   }
   * A PRÓPRIA API já traduz os campos (mesma lógica da função get_column_name) e
   * monta headers/rows — por isso "Servidor SEFAZ" pode aparecer repetido quando
   * o cliente tem dois DWAGSEF e nenhum DWAGNFE.
   *
   * Sutileza: "headers" tem uma coluna a mais ("Código de Cliente") que NÃO está
   * em "rows" — o valor dela vem no campo de topo "code". Então, quando
   * headers.length === row.length + 1, prefixamos o code na linha.
   *
   * O bloco de fallback (traduzirCampo) só é usado se a API algum dia devolver
   * apenas valores soltos, sem headers.
   *
   * @param {*} raw JSON devolvido pela API
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function normalizeClientData(raw) {
    if (raw && Array.isArray(raw.headers) && Array.isArray(raw.rows)) {
      const headers = raw.headers.map(h => String(h == null ? '' : h))
      const rows = raw.rows.map(r => {
        const vals = (Array.isArray(r) ? r : [r]).map(v => String(v == null ? '' : v))
        if (headers.length === vals.length + 1 && raw.code != null) {
          return [String(raw.code), ...vals]
        }
        return vals
      })
      return { headers, rows }
    }

    // ── Fallback defensivo: valores soltos, sem headers ──
    const valores = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw).filter(v => typeof v === 'string')
        : [raw]
    const headers = []
    const linha = []
    valores.forEach(v => {
      const val = String(v == null ? '' : v).trim()
      if (!val) return
      const label = traduzirCampo(val)
      headers.push(label === 'Desconhecido' ? val : label)
      linha.push(val)
    })
    return { headers, rows: linha.length ? [linha] : [] }
  }

  /**
   * Aplica o modo de visualização sobre os dados normalizados.
   * No completo, devolve os dados como estão. No simplificado, esconde as colunas
   * Jenkins/Tempo aproximado e encurta os valores das demais.
   * @param {{headers:string[], rows:string[][]}} parsed
   * @param {boolean} simplified
   * @returns {{headers:string[], rows:string[][]}}
   */
  function toDisplay(parsed, simplified) {
    if (!simplified || !parsed) return parsed
    const keep = []
    parsed.headers.forEach((h, i) => { if (!SIMPLE_HIDE_HEADER_RE.test(h)) keep.push(i) })
    const headers = keep.map(i => parsed.headers[i])
    const rows = parsed.rows.map(r => keep.map(i => simplificarValor(r[i] != null ? r[i] : '')))
    return { headers, rows }
  }

  // ─── Detecção do clienteID na página ─────────────────────────────────────────
  /**
   * Tenta descobrir o clienteID: primeiro pela URL (?clienteID=), depois pelo
   * onclick do botão de pendentes (mesma técnica já usada no duplicate-checker).
   * @returns {string|null}
   */
  function detectarClienteId() {
    try {
      const fromUrl = new URLSearchParams(location.search).get('clienteID')
      if (fromUrl && /^\d+$/.test(fromUrl)) return fromUrl
    } catch {}

    // Fallback: qualquer elemento cujo onclick contenha clienteID=NNN
    const candidatos = document.querySelectorAll('[onclick*="clienteID="]')
    for (const el of candidatos) {
      const m = (el.getAttribute('onclick') || '').match(/clienteID=(\d+)/)
      if (m) return m[1]
    }
    return null
  }

  // ─── Comunicação com o service worker (faz o fetch da API HTTP) ───────────────
  /**
   * @param {string} clienteId
   * @returns {Promise<{ok:boolean, data?:*, error?:string}>}
   */
  function fetchClientInfo(clienteId) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ action: 'FETCH_CLIENT_INFO', clienteId }, resp => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message })
            return
          }
          resolve(resp || { ok: false, error: 'Sem resposta do service worker.' })
        })
      } catch (err) {
        resolve({ ok: false, error: String(err) })
      }
    })
  }

  // ─── UI: lupa flutuante + painel ─────────────────────────────────────────────
  function esc(str) {
    // Reaproveita o escapeHTML global se existir; senão, fallback local.
    if (typeof escapeHTML === 'function') return escapeHTML(str)
    return String(str == null ? '' : str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]))
  }

  /** Alterna o ícone da lupa: lupa fechado, X aberto. */
  function setFabOpen(isOpen) {
    const fab = document.getElementById(FAB_ID)
    if (!fab) return
    fab.innerHTML = isOpen ? ICON_CLOSE : ICON_SEARCH
    fab.classList.toggle('sgd-ci-fab-open', isOpen)
    fab.title = isOpen ? 'Fechar consulta' : 'Consultar cliente (Domínio Web)'
  }

  /**
   * Insere a lupa no grupo de botões flutuantes, respeitando a prioridade pedida:
   * ao lado do IAplug (se existir) > ao lado do "Ir ao Topo" > no lugar dele.
   * @param {HTMLElement} fab
   * @returns {boolean} true se conseguiu inserir no grupo
   */
  function placeFabInGroup(fab) {
    const group = document.getElementById(GROUP_ID)
    if (!group) return false
    fab.classList.remove('sgd-ci-fab-standalone')
    const iaplug = group.querySelector('#iaplug-scroll-btn')
    const scrollTop = group.querySelector('#floating-scroll-top-btn')
    if (iaplug) iaplug.insertAdjacentElement('afterend', fab)
    else if (scrollTop) scrollTop.insertAdjacentElement('beforebegin', fab)
    else group.appendChild(fab)
    return true
  }

  /** Observa o DOM até o grupo de botões aparecer e então realoca a lupa. */
  function observeForGroup(fab) {
    if (fabObserver) return
    fabObserver = new MutationObserver(() => {
      if (document.getElementById(GROUP_ID)) {
        const current = document.getElementById(FAB_ID)
        if (current) placeFabInGroup(current)
        fabObserver.disconnect()
        fabObserver = null
      }
    })
    fabObserver.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      if (fabObserver) { fabObserver.disconnect(); fabObserver = null }
    }, 15000)
  }

  function ensureFab() {
    if (document.getElementById(FAB_ID)) return
    const fab = document.createElement('button')
    fab.id = FAB_ID
    fab.type = 'button'
    fab.title = 'Consultar cliente (Domínio Web)'
    fab.setAttribute('aria-label', 'Consultar cliente')
    fab.innerHTML = ICON_SEARCH
    fab.addEventListener('click', onFabClick)

    if (!placeFabInGroup(fab)) {
      fab.classList.add('sgd-ci-fab-standalone')
      document.body.appendChild(fab)
      observeForGroup(fab)
    }
  }

  /** Remove apenas a lupa (mantém o resto). Usado quando não há cliente na página. */
  function removeFabOnly() {
    if (fabObserver) { fabObserver.disconnect(); fabObserver = null }
    document.getElementById(FAB_ID)?.remove()
  }

  function fecharPainel() {
    unbindOutside()
    document.getElementById(PANEL_ID)?.remove()
    setFabOpen(false)
  }

  function removeUi() {
    unbindOutside()
    if (fabObserver) { fabObserver.disconnect(); fabObserver = null }
    document.getElementById(FAB_ID)?.remove()
    document.getElementById(PANEL_ID)?.remove()
  }

  async function onFabClick() {
    // Se o painel já estiver aberto, fecha (toggle).
    if (document.getElementById(PANEL_ID)) { fecharPainel(); return }

    const clienteId = detectarClienteId()
    if (!clienteId) return // sem cliente na página não há o que consultar
    renderPanel({ state: 'loading', clienteId })
    buscarEExibir(clienteId)
  }

  /**
   * Consulta e exibe. Em modo silencioso (usado pelo disparo automático), se a
   * consulta falhar NÃO mostra o painel de erro nem abre nada — apenas marca a
   * supressão, para não incomodar quem está fora da rede. O usuário verá o aviso
   * só quando clicar na lupa manualmente.
   * @param {string} clienteId
   * @param {{silentOnError?: boolean}} [options]
   */
  async function buscarEExibir(clienteId, options) {
    const silentOnError = !!(options && options.silentOnError)
    if (!silentOnError) renderPanel({ state: 'loading', clienteId })
    const resp = await fetchClientInfo(clienteId)
    if (!resp.ok) {
      networkErrorSuppressAuto = true
      if (silentOnError) return
      renderPanel({ state: 'error', clienteId, error: resp.error })
      return
    }
    networkErrorSuppressAuto = false
    const parsed = normalizeClientData(resp.data)
    lastResult = { clienteId, parsed }
    renderPanel({ state: 'ok', clienteId, parsed })
  }

  // Fecha o painel ao clicar fora dele (e ao apertar Esc). Usa captura para
  // funcionar mesmo se a página interromper a propagação do evento.
  function onOutsideInteraction(e) {
    const panel = document.getElementById(PANEL_ID)
    if (!panel) return
    if (e.type === 'keydown') {
      if (e.key === 'Escape') fecharPainel()
      return
    }
    const fab = document.getElementById(FAB_ID)
    if (panel.contains(e.target) || (fab && fab.contains(e.target))) return
    fecharPainel()
  }

  function bindOutside() {
    unbindOutside()
    const delay = (typeof SGD_CLICK_GUARD_DELAY_MS !== 'undefined') ? SGD_CLICK_GUARD_DELAY_MS : 100
    outsideBindTimer = setTimeout(() => {
      document.addEventListener('mousedown', onOutsideInteraction, true)
      document.addEventListener('keydown', onOutsideInteraction, true)
    }, delay)
  }

  function unbindOutside() {
    clearTimeout(outsideBindTimer)
    document.removeEventListener('mousedown', onOutsideInteraction, true)
    document.removeEventListener('keydown', onOutsideInteraction, true)
  }

  /** Ancora o painel logo acima da lupa, no lado da tela em que ela estiver. */
  function positionPanel(panel) {
    const fab = document.getElementById(FAB_ID)
    if (!fab) return
    const r = fab.getBoundingClientRect()
    if (!r.width && !r.height) return
    const margin = 12
    panel.style.top = 'auto'
    panel.style.bottom = Math.max(8, window.innerHeight - r.top + margin) + 'px'
    const onLeft = r.left < window.innerWidth / 2
    if (onLeft) {
      panel.style.left = Math.max(8, r.left) + 'px'
      panel.style.right = 'auto'
    } else {
      panel.style.right = Math.max(8, window.innerWidth - r.right) + 'px'
      panel.style.left = 'auto'
    }
  }

  /**
   * (Re)desenha o painel flutuante.
   * @param {{state:'loading'|'ok'|'error', clienteId?:string, parsed?:object, error?:string}} opts
   */
  function renderPanel(opts) {
    document.getElementById(PANEL_ID)?.remove()

    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.className = 'sgd-client-info-panel'

    let bodyHtml = ''
    if (opts.state === 'loading') {
      bodyHtml = `
        <div class="sgd-ci-loading">
          <div class="sgd-ci-hourglass">⏳</div>
          <div class="sgd-ci-loading-title">Consultando...</div>
          <div class="sgd-ci-loading-sub">Aguarde enquanto buscamos os dados</div>
        </div>`
    } else if (opts.state === 'error') {
      bodyHtml = `
        <div class="sgd-ci-loading sgd-ci-error">
          <div class="sgd-ci-error-icon">⚠️</div>
          <div class="sgd-ci-loading-title">Não foi possível consultar o cliente ${esc(opts.clienteId)}</div>
          <div class="sgd-ci-error-detail">${esc(opts.error || '')}</div>
          <div class="sgd-ci-loading-sub">A consulta só funciona dentro da rede do escritório ou conectado ao Zscaler. Conecte-se e tente novamente.</div>
          <button type="button" id="sgd-ci-retry-btn">Tentar novamente</button>
        </div>`
    } else if (opts.state === 'ok') {
      const display = toDisplay(opts.parsed, simplifiedMode)
      const headers = display?.headers || []
      const rows = display?.rows || []
      if (!headers.length || !rows.length) {
        bodyHtml = `<div class="sgd-ci-loading"><div class="sgd-ci-loading-sub">Nenhuma informação retornada para o cliente ${esc(opts.clienteId)}.</div></div>`
      } else {
        const ths = headers.map(h => `<th>${esc(renomearHeader(h))}</th>`).join('')
        const trs = rows.map(r => {
          const tds = headers.map((_, i) => `<td>${esc(r[i] != null ? r[i] : '')}</td>`).join('')
          return `<tr>${tds}</tr>`
        }).join('')
        bodyHtml = `
          <div class="sgd-ci-table-wrap">
            <table class="sgd-ci-table">
              <thead><tr>${ths}</tr></thead>
              <tbody>${trs}</tbody>
            </table>
          </div>`
      }
    }

    panel.innerHTML = `
      <div class="sgd-ci-header">
        <span class="sgd-ci-title">🔍 Consulta Domínio Web</span>
        <div class="sgd-ci-header-actions">
          <label class="sgd-ci-toggle" title="Modo simplificado (esconde Jenkins/Tempo e encurta os valores)">
            <input type="checkbox" id="sgd-ci-simple-toggle" />
            <span class="sgd-ci-toggle-track"><span class="sgd-ci-toggle-thumb"></span></span>
            <span class="sgd-ci-toggle-text">Simplificado</span>
          </label>
          <label class="sgd-ci-toggle" title="Consultar automaticamente ao abrir um cliente (fica salvo)">
            <input type="checkbox" id="sgd-ci-auto-toggle" />
            <span class="sgd-ci-toggle-track"><span class="sgd-ci-toggle-thumb"></span></span>
            <span class="sgd-ci-toggle-text">Automático</span>
          </label>
          <button type="button" class="sgd-ci-close" aria-label="Fechar">✕</button>
        </div>
      </div>
      <div class="sgd-ci-body">${bodyHtml}</div>`

    document.body.appendChild(panel)
    positionPanel(panel)
    setFabOpen(true)
    bindOutside()

    // Wiring dos botões
    panel.querySelector('.sgd-ci-close')?.addEventListener('click', fecharPainel)

    // Toggle "Simplificado" — reflete o modo atual, salva a preferência e
    // re-renderiza o resultado já carregado (sem nova consulta à API).
    const simpleToggle = panel.querySelector('#sgd-ci-simple-toggle')
    if (simpleToggle) {
      simpleToggle.checked = simplifiedMode
      simpleToggle.addEventListener('change', () => {
        simplifiedMode = simpleToggle.checked
        setPref(SIMPLE_PREF_KEY, simplifiedMode)
        if (lastResult) renderPanel({ state: 'ok', clienteId: lastResult.clienteId, parsed: lastResult.parsed })
      })
    }

    // Toggle "Automático" — reflete e altera a preferência salva.
    const autoToggle = panel.querySelector('#sgd-ci-auto-toggle')
    if (autoToggle) {
      getPrefs().then(p => { autoToggle.checked = p.auto })
      autoToggle.addEventListener('change', () => setPref(AUTO_PREF_KEY, autoToggle.checked))
    }

    panel.querySelector('#sgd-ci-retry-btn')?.addEventListener('click', () => {
      if (opts.clienteId) buscarEExibir(opts.clienteId)
    })
  }

  // ─── Ciclo de vida / preferências ─────────────────────────────────────────────
  async function getPrefs() {
    try {
      if (typeof getSettings === 'function') {
        const settings = await getSettings()
        const prefs = settings?.preferences || {}
        return {
          enabled: prefs[ENABLE_PREF_KEY] !== false, // padrão: habilitado
          auto: prefs[AUTO_PREF_KEY] === true,         // padrão: manual
          simplified: prefs[SIMPLE_PREF_KEY] !== false // padrão: simplificado
        }
      }
    } catch {}
    return { enabled: true, auto: false, simplified: true }
  }

  /**
   * Persiste uma preferência da seção "preferences". Como saveSettings faz merge
   * só no nível de topo, mesclamos "preferences" manualmente para não apagar as
   * outras preferências.
   * @param {string} key
   * @param {*} value
   */
  async function setPref(key, value) {
    try {
      if (typeof getSettings === 'function' && typeof saveSettings === 'function') {
        const settings = await getSettings()
        const preferences = { ...(settings?.preferences || {}), [key]: value }
        await saveSettings({ preferences })
      }
    } catch {}
  }

  /**
   * Mostra a lupa só se houver cliente na página; caso contrário oculta o botão
   * e fecha o painel. Em modo automático, abre a consulta quando um NOVO cliente
   * é detectado (sem reabrir se o painel já estiver aberto).
   */
  async function refreshVisibility() {
    const { enabled, auto } = await getPrefs()
    const clienteId = enabled ? detectarClienteId() : null

    if (clienteId) {
      ensureFab()
      if (auto && !networkErrorSuppressAuto && clienteId !== lastClientId && !document.getElementById(PANEL_ID)) {
        buscarEExibir(clienteId, { silentOnError: true })
      }
    } else {
      fecharPainel()
      removeFabOnly()
    }
    lastClientId = clienteId
  }

  function startVisibilityLoop() {
    if (visibilityTimer) return
    visibilityTimer = setInterval(refreshVisibility, VISIBILITY_POLL_MS)
  }

  function stopVisibilityLoop() {
    clearInterval(visibilityTimer)
    visibilityTimer = null
  }

  async function start() {
    const prefs = await getPrefs()
    simplifiedMode = prefs.simplified
    startVisibilityLoop()
    await refreshVisibility()
  }

  function stop() {
    stopVisibilityLoop()
    lastClientId = null
    removeUi()
  }

  async function init() {
    const { enabled } = await getPrefs()
    if (enabled) start()

    // Reage a mudanças de preferência ao vivo (outra aba ou o próprio painel de config)
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'sync') return
        if (typeof SETTINGS_STORAGE_KEY !== 'undefined' && changes[SETTINGS_STORAGE_KEY]) {
          const prefs = await getPrefs()
          simplifiedMode = prefs.simplified
          if (prefs.enabled) start()
          else stop()
        }
      })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
