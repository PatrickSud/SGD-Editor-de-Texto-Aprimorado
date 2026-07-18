/**
 * @file links-panel.js
 * UI do Repositório Colaborativo de Links por Canal (aberto pelo FAB).
 *
 * Estrutura:
 *   - Abas: Guia Pessoal | Guia Comunidade (+ Pendências, só Master).
 *   - Barra: seletor de canal, ordenação, busca (debounce) e "Adicionar link".
 *   - Chips de tipo: Todos / SS / SAM / NE (filtro multisseleção).
 *   - Item de link compacto: título, badge de tipo, curtidas, salvamentos,
 *     ações de curtir/salvar/abrir (e moderar, no caso do Master).
 *
 * Consome a camada de dados window.sgdLinksService (links-service.js) e reaproveita
 * showNotification (ui-components.js), applyCurrentTheme (storage.js), escapeHTML
 * e isValidUrl (utils.js).
 */

const LINKS_PANEL_MODAL_ID = 'links-panel-modal'
const LINKS_PANEL_PREFS_KEY = 'linksPanelUiPrefs'

// Estado da sessão do painel (persistido parcialmente em chrome.storage.local).
const linksPanelState = {
  tab: 'community', // 'community' | 'personal' | 'pending'
  channel: 'Geral',
  types: [], // subconjunto de ['ss','sam','ne']; vazio = todos
  query: '',
  sort: 'relevance' // 'relevance' | 'recent' | 'saved'
}

let linksSearchDebounce = null

// Rótulos amigáveis dos tipos.
// Rótulos de exibição. A chave interna 'sam' é mantida (dados no RTDB, detecção
// por "Solicitação de Melhoria"), mas o usuário vê "SA".
const TYPE_LABELS = { ss: 'SS', ssc: 'SSC', sam: 'SA', ne: 'NE', geral: 'Geral' }

// Ordem das seções quando a lista é agrupada por tipo.
const TYPE_ORDER = ['ss', 'ssc', 'sam', 'ne', 'geral']

// ─── PREFERÊNCIAS DE UI ──────────────────────────────────────────────────────

/** Carrega preferências salvas (canal/ordenação/tipos/aba). */
async function loadLinksPanelPrefs() {
  try {
    const stored = await chrome.storage.local.get([LINKS_PANEL_PREFS_KEY])
    const prefs = stored[LINKS_PANEL_PREFS_KEY] || {}
    if (prefs.channel) linksPanelState.channel = prefs.channel
    if (['relevance', 'recent', 'saved'].includes(prefs.sort)) linksPanelState.sort = prefs.sort
    if (Array.isArray(prefs.types)) linksPanelState.types = prefs.types
    if (prefs.tab) linksPanelState.tab = prefs.tab
  } catch (e) { /* usa defaults */ }
}

/** Persiste as preferências relevantes. */
function saveLinksPanelPrefs() {
  const { tab, channel, types, sort } = linksPanelState
  chrome.storage.local.set({ [LINKS_PANEL_PREFS_KEY]: { tab, channel, types, sort } })
}

// ─── EXTRAÇÃO AUTOMÁTICA (ASSUNTO + URL DA PÁGINA ATUAL) ─────────────────────

/**
 * Extrai o "Assunto" da página atual do SGD (leve, sem varrer trâmites).
 * Espelha a heurística de utils.js (getContentCellByLabel).
 * @returns {string} Texto do assunto, ou '' se não encontrado.
 */
function extractCurrentPageSubject() {
  const clean = txt => (txt || '').replace(/assunto:/i, '').replace(/\s+/g, ' ').trim()
  const valueSelector = 'td[colspan="5"], td.tableVisualizacaoHtml, td.textofixo'
  try {
    const labels = Array.from(document.querySelectorAll(
      'td.tableVisualizacaoLabel, td.tableVisualizacaoDestaque, td.tableVisualizacaoField b'
    ))
    for (const label of labels) {
      const text = (label.innerText || '').trim().toLowerCase()
      if (!text.startsWith('assunto:')) continue

      // Caso 1: rótulo e valor na mesma célula (ex.: tableVisualizacaoField).
      const inline = clean(label.closest('td') && label.closest('td').innerText)
      if (inline) return inline

      // Caso 2: valor na mesma linha do rótulo (célula irmã).
      const row = label.closest('tr')
      let valueCell = row && row.querySelector(valueSelector)
      if (valueCell) return clean(valueCell.innerText)

      // Caso 3 (SS): o valor fica em uma <tr> SEGUINTE à do rótulo (HTML do SGD
      // coloca "Assunto:" e o texto em linhas adjacentes). Procura nas próximas.
      let probe = row
      let hops = 0
      while (probe && hops < 4) {
        probe = probe.nextElementSibling
        hops++
        if (probe && probe.matches && probe.matches('tr')) {
          valueCell = probe.querySelector(valueSelector)
          if (valueCell) {
            const val = clean(valueCell.innerText)
            if (val) return val
          }
        }
      }
    }
  } catch (e) { /* silencioso */ }
  return ''
}

/**
 * Detecta o tipo (SS/SAM/NE) a partir da URL e de elementos da página atual.
 *   - SS:  .../ss.html?ss=NNNN
 *   - SAM/NE: .../sa.html?sa=NNNN — desambiguado pelo <td class="titulo">:
 *       "Solicitação de Melhoria" => SAM ; "Notificação de Erro" => NE
 * @param {string} url
 * @returns {'ss'|'sam'|'ne'|'geral'}
 */
function detectLinkTypeFromPage(url) {
  const u = (url || '').toLowerCase()
  // SSC antes de SS (o padrão "ssc" contém "ss").
  if (/\/ssc\.html/.test(u) || /[?&]ssc=/.test(u)) return 'ssc'
  if (/\/ss\.html/.test(u) || /[?&]ss=/.test(u)) return 'ss'
  if (/\/sa\.html/.test(u) || /[?&]sa=/.test(u)) {
    try {
      const titulos = Array.from(document.querySelectorAll('td.titulo'))
        .map(t => (t.textContent || '').trim().toLowerCase())
        .join(' | ')
      if (/solicita[cç][aã]o de melhoria/.test(titulos)) return 'sam'
      if (/notifica[cç][aã]o de erro/.test(titulos)) return 'ne'
    } catch (e) { /* silencioso */ }
  }
  return 'geral'
}

/**
 * Monta os dados de link a partir da página atual (URL + assunto/título + tipo).
 * @returns {{url: string, title: string, type: string}}
 */
function buildAutoLinkFromPage() {
  const subject = extractCurrentPageSubject()
  const title = subject || (document.title || '').trim() || 'Link sem título'
  const url = window.location.href
  return { url, title, type: detectLinkTypeFromPage(url) }
}

/**
 * Busca o valor de um campo rotulado por <b> em td.tableVisualizacaoField.
 * (SS/SAM/NE — ex.: "<b>Sistema:</b> Domínio Contábil").
 * @param {string[]} labels Rótulos normalizados aceitos (ex.: ['sistema']).
 * @returns {string}
 */
function fieldValueByBoldLabel(labels) {
  const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const tds = Array.from(document.querySelectorAll('td.tableVisualizacaoField'))
  for (const td of tds) {
    const b = td.querySelector('b')
    if (!b) continue
    const label = norm(b.textContent).replace(/:$/, '').trim()
    if (labels.includes(label)) {
      const full = (td.textContent || '').replace(/\s+/g, ' ').trim()
      const bText = (b.textContent || '').replace(/\s+/g, ' ').trim()
      return full.startsWith(bText) ? full.slice(bText.length).trim() : full.replace(bText, '').trim()
    }
  }
  return ''
}

/**
 * Extrai Sistema e Módulo da página atual.
 *   - SSC: células por id (td:sistema_nome / td:modulo_nome), valor dentro de <a>.
 *   - SS/SAM/NE: rótulo em <b> dentro de td.tableVisualizacaoField.
 * @returns {{system: string, module: string}}
 */
function extractSystemAndModule() {
  let system = '', module = ''
  try {
    const sscSystem = document.getElementById('td:sistema_nome')
    const sscModule = document.getElementById('td:modulo_nome')
    if (sscSystem) system = (sscSystem.textContent || '').replace(/\s+/g, ' ').trim()
    if (sscModule) module = (sscModule.textContent || '').replace(/\s+/g, ' ').trim()
    if (!system) system = fieldValueByBoldLabel(['sistema'])
    if (!module) module = fieldValueByBoldLabel(['modulo'])
  } catch (e) { /* silencioso */ }
  return { system, module }
}

// ─── ABERTURA DO PAINEL ──────────────────────────────────────────────────────

/**
 * Abre (ou foca) o painel do repositório de links.
 */
async function openLinksPanel() {
  const existing = document.getElementById(LINKS_PANEL_MODAL_ID)
  if (existing) {
    existing.querySelector('.lp-search-input') && existing.querySelector('.lp-search-input').focus()
    return
  }
  await loadLinksPanelPrefs()

  const ALL = window.sgdLinksService.ALL_CHANNELS
  const channels = window.sgdLinksService.getLinkChannels()
  if (linksPanelState.channel !== ALL && !channels.includes(linksPanelState.channel)) {
    linksPanelState.channel = channels[0] || 'Geral'
  }
  // Quem não modera não deve iniciar na aba de pendências.
  if (linksPanelState.tab === 'pending' && !window.sgdLinksService.canModerate()) {
    linksPanelState.tab = 'community'
  }

  const modal = document.createElement('div')
  modal.className = 'editor-modal lp-modal'
  modal.id = LINKS_PANEL_MODAL_ID
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-label', 'Central de Links')
  applyCurrentTheme(modal)

  modal.innerHTML = buildPanelShellHtml(channels)
  document.body.appendChild(modal)

  wirePanelEvents(modal)
  renderLinksContent()

  // Acessibilidade: Esc fecha; foco inicial na busca.
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLinksPanel()
  })
  requestAnimationFrame(() => {
    const s = modal.querySelector('.lp-search-input')
    if (s) s.focus()
  })
}

/** Fecha o painel. */
function closeLinksPanel() {
  const modal = document.getElementById(LINKS_PANEL_MODAL_ID)
  if (modal && document.body.contains(modal)) document.body.removeChild(modal)
}

// ─── MONTAGEM DO SHELL (HTML ESTÁTICO) ───────────────────────────────────────

/**
 * Monta o HTML base do painel (cabeçalho, abas, barra e área de conteúdo).
 * @param {string[]} channels
 * @returns {string}
 */
function buildPanelShellHtml(channels) {
  const ALL = window.sgdLinksService.ALL_CHANNELS
  const canModerate = window.sgdLinksService.canModerate()
  const allOption =
    `<option value="${ALL}" ${linksPanelState.channel === ALL ? 'selected' : ''}>Todos os canais</option>`
  const channelOptions = allOption + channels.map(c =>
    `<option value="${escapeHTML(c)}" ${c === linksPanelState.channel ? 'selected' : ''}>${escapeHTML(c)}</option>`
  ).join('')

  const pendingTab = canModerate
    ? `<button type="button" class="lp-tab" data-tab="pending" role="tab" aria-selected="false">🛡️ Pendências</button>`
    : ''

  const chips = ['ss', 'ssc', 'sam', 'ne'].map(t => {
    const active = linksPanelState.types.includes(t)
    return `<button type="button" class="lp-chip ${active ? 'active' : ''}" data-type="${t}" aria-pressed="${active}">${TYPE_LABELS[t]}</button>`
  }).join('')
  const allActive = linksPanelState.types.length === 0

  return `
    <div class="se-modal-content lp-content">
      <div class="se-modal-header lp-header">
        <h3>🌐 Central de Links</h3>
        <button type="button" class="se-close-modal-btn lp-close" title="Fechar" aria-label="Fechar">&times;</button>
      </div>

      <div class="lp-tabs" role="tablist">
        <button type="button" class="lp-tab" data-tab="community" role="tab" aria-selected="false">🤝 Comunidade</button>
        <button type="button" class="lp-tab" data-tab="personal" role="tab" aria-selected="false">❤️ Pessoal</button>
        ${pendingTab}
      </div>

      <div class="lp-toolbar">
        <label class="lp-field lp-channel-field">
          <span class="lp-field-label">Canal</span>
          <select class="lp-channel-select" aria-label="Selecionar canal">${channelOptions}</select>
        </label>
        <label class="lp-field lp-sort-field">
          <span class="lp-field-label">Ordenar</span>
          <select class="lp-sort-select" aria-label="Ordenar por">
            <option value="relevance" ${linksPanelState.sort === 'relevance' ? 'selected' : ''}>Relevância</option>
            <option value="recent" ${linksPanelState.sort === 'recent' ? 'selected' : ''}>Mais recentes</option>
            <option value="saved" ${linksPanelState.sort === 'saved' ? 'selected' : ''}>Mais salvos</option>
          </select>
        </label>
        <div class="lp-search-wrap">
          <input type="text" class="lp-search-input" placeholder="Buscar por título ou URL..." aria-label="Buscar links" value="${escapeHTML(linksPanelState.query)}" />
        </div>
        <div class="lp-chips" role="group" aria-label="Filtro por tipo">
          <button type="button" class="lp-chip ${allActive ? 'active' : ''}" data-type="all" aria-pressed="${allActive}">Todos</button>
          ${chips}
        </div>
        <button type="button" class="lp-add-btn action-btn" title="Adicionar link">➕ Adicionar</button>
      </div>

      <div class="lp-body" aria-live="polite"></div>
    </div>
  `
}

// ─── EVENTOS ─────────────────────────────────────────────────────────────────

/**
 * Registra os listeners do painel (delegação de eventos onde faz sentido).
 * @param {HTMLElement} modal
 */
function wirePanelEvents(modal) {
  // Fechar (botão X e clique no backdrop).
  modal.querySelector('.lp-close').addEventListener('click', closeLinksPanel)
  modal.addEventListener('mousedown', e => { if (e.target === modal) closeLinksPanel() })

  // Abas.
  modal.querySelectorAll('.lp-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      linksPanelState.tab = btn.dataset.tab
      saveLinksPanelPrefs()
      renderLinksContent()
    })
  })

  // Canal.
  modal.querySelector('.lp-channel-select').addEventListener('change', e => {
    linksPanelState.channel = e.target.value
    saveLinksPanelPrefs()
    renderLinksContent()
  })

  // Ordenação.
  modal.querySelector('.lp-sort-select').addEventListener('change', e => {
    linksPanelState.sort = e.target.value
    saveLinksPanelPrefs()
    renderLinksContent()
  })

  // Busca (debounce ~200ms).
  modal.querySelector('.lp-search-input').addEventListener('input', e => {
    const val = e.target.value
    clearTimeout(linksSearchDebounce)
    linksSearchDebounce = setTimeout(() => {
      linksPanelState.query = val
      renderLinksContent()
    }, 200)
  })

  // Chips de tipo.
  modal.querySelector('.lp-chips').addEventListener('click', e => {
    const chip = e.target.closest('.lp-chip')
    if (!chip) return
    const type = chip.dataset.type
    if (type === 'all') {
      linksPanelState.types = []
    } else {
      const idx = linksPanelState.types.indexOf(type)
      if (idx >= 0) linksPanelState.types.splice(idx, 1)
      else linksPanelState.types.push(type)
    }
    saveLinksPanelPrefs()
    syncChipsUi(modal)
    renderLinksContent()
  })

  // Adicionar link.
  modal.querySelector('.lp-add-btn').addEventListener('click', () => openAddLinkForm())

  // Ações na lista (delegação): curtir, salvar, abrir, moderar.
  modal.querySelector('.lp-body').addEventListener('click', handleListAction)
}

/** Atualiza o estado visual (active/aria-pressed) dos chips. */
function syncChipsUi(modal) {
  const allActive = linksPanelState.types.length === 0
  modal.querySelectorAll('.lp-chip').forEach(chip => {
    const type = chip.dataset.type
    const active = type === 'all' ? allActive : linksPanelState.types.includes(type)
    chip.classList.toggle('active', active)
    chip.setAttribute('aria-pressed', String(active))
  })
}

/** Sincroniza destaque das abas conforme o estado. */
function syncTabsUi() {
  const modal = document.getElementById(LINKS_PANEL_MODAL_ID)
  if (!modal) return
  modal.querySelectorAll('.lp-tab').forEach(btn => {
    const active = btn.dataset.tab === linksPanelState.tab
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-selected', String(active))
  })
  // Na aba de pendências mantemos APENAS o seletor de canal (a guia escolhe o
  // próprio canal, incluindo "Todos"); ordenação, busca, adicionar e chips somem.
  const isPending = linksPanelState.tab === 'pending'
  const toolbar = modal.querySelector('.lp-toolbar')
  const chips = modal.querySelector('.lp-chips')
  const sortField = modal.querySelector('.lp-sort-field')
  const searchWrap = modal.querySelector('.lp-search-wrap')
  const addBtn = modal.querySelector('.lp-add-btn')
  if (toolbar) toolbar.style.display = '' // sempre visível (contém o seletor de canal)
  if (chips) chips.style.display = isPending ? 'none' : ''
  if (sortField) sortField.style.display = isPending ? 'none' : ''
  if (searchWrap) searchWrap.style.display = isPending ? 'none' : ''
  if (addBtn) addBtn.style.display = isPending ? 'none' : ''
}

// ─── RENDERIZAÇÃO DE CONTEÚDO ────────────────────────────────────────────────

/** Decide e renderiza a view atual conforme o estado. */
async function renderLinksContent() {
  const modal = document.getElementById(LINKS_PANEL_MODAL_ID)
  if (!modal) return
  syncTabsUi()
  const body = modal.querySelector('.lp-body')
  body.innerHTML = `<div class="lp-loading">Carregando...</div>`

  try {
    if (linksPanelState.tab === 'personal') return renderPersonalList(body)
    if (linksPanelState.tab === 'pending') return renderPendingList(body)
    return renderCommunityList(body)
  } catch (e) {
    body.innerHTML = `<div class="lp-empty">Não foi possível carregar. Tente novamente.</div>`
    sgdWarn('[Links] Erro ao renderizar conteúdo:', e)
  }
}

/** Renderiza a lista da Comunidade (canal atual ou "Todos"). */
async function renderCommunityList(body) {
  const svc = window.sgdLinksService
  const channel = linksPanelState.channel
  const isAll = channel === svc.ALL_CHANNELS

  if (!isAll && !svc.canAccessChannel(channel)) {
    body.innerHTML = `<div class="lp-empty">Você não tem acesso ao canal <b>${escapeHTML(channel)}</b>.</div>`
    return
  }

  let links = isAll ? await svc.fetchCommunityLinksAll() : await svc.fetchCommunityLinks(channel)
  links = svc.filterLinks(links, { query: linksPanelState.query, types: linksPanelState.types })

  if (!links.length) {
    const where = isAll ? 'em nenhum canal ainda' : 'neste canal ainda'
    body.innerHTML = `<div class="lp-empty">Nenhum link ${linksPanelState.query ? 'encontrado' : where}.<br><span class="lp-empty-hint">Seja o primeiro a contribuir usando ➕ Adicionar.</span></div>`
    return
  }

  // Agrupa por tipo (seções); dentro de cada seção aplica a ordenação escolhida.
  let html = ''
  for (const t of TYPE_ORDER) {
    const grp = links.filter(l => l.type === t)
    if (!grp.length) continue
    const sorted = svc.sortCommunityLinks(grp, linksPanelState.sort)
    const flags = await Promise.all(sorted.map(l => svc.isSavedToPersonal(l)))
    html += groupHeaderHtml(t) + sorted.map((l, i) => renderCommunityItemHtml(l, flags[i], isAll)).join('')
  }
  body.innerHTML = `<div class="lp-list">${html}</div>`
}

/** Renderiza a Guia Pessoal (local), filtrando pelo canal (ou "Todos"). */
async function renderPersonalList(body) {
  const svc = window.sgdLinksService
  const channel = linksPanelState.channel
  const isAll = channel === svc.ALL_CHANNELS

  let links = await svc.getPersonalLinks()
  if (!isAll) links = links.filter(l => (l.channel || '') === channel)
  // Aplica busca e filtro de tipo também no Pessoal (mesma UX).
  links = svc.filterLinks(links.map(l => ({ ...l, likeCount: 0, saveCount: 0 })), {
    query: linksPanelState.query, types: linksPanelState.types
  })

  if (!links.length) {
    body.innerHTML = `<div class="lp-empty">Sua guia pessoal está vazia${isAll ? '' : ' neste canal'}.<br><span class="lp-empty-hint">Salve links da Comunidade no ❤ ou use ➕ Adicionar.</span></div>`
    return
  }

  // Agrupa por tipo (seções); dentro de cada seção, mais recentes primeiro.
  let html = ''
  for (const t of TYPE_ORDER) {
    const grp = links.filter(l => l.type === t)
    if (!grp.length) continue
    grp.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    html += groupHeaderHtml(t) + grp.map(renderPersonalItemHtml).join('')
  }
  body.innerHTML = `<div class="lp-list">${html}</div>`
}

/** Renderiza a fila de pendências (moderadores), por canal ou "Todos". */
async function renderPendingList(body) {
  const svc = window.sgdLinksService
  if (!svc.canModerate()) {
    body.innerHTML = `<div class="lp-empty">Apenas moderadores acessam esta guia.</div>`
    return
  }
  const channel = linksPanelState.channel
  const isAll = channel === svc.ALL_CHANNELS
  const scope = isAll ? 'todos os canais' : channel

  const pending = isAll ? await svc.fetchPendingAll() : await svc.fetchPendingLinks(channel)
  if (!pending.length) {
    body.innerHTML = `<div class="lp-empty">Sem pendências em <b>${escapeHTML(scope)}</b>. 🎉</div>`
    return
  }
  // No modo "Todos", ordena por mais antigos primeiro (fila justa de revisão).
  pending.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  body.innerHTML = `
    <div class="lp-pending-hint">Revisando <b>${escapeHTML(scope)}</b> — ${pending.length} item(ns) aguardando.</div>
    <div class="lp-list">${pending.map(l => renderPendingItemHtml(l, true)).join('')}</div>`
}

// ─── TEMPLATES DE ITEM ───────────────────────────────────────────────────────

/** Cabeçalho de seção por tipo (ex.: "SS ─────────"). */
function groupHeaderHtml(type) {
  return `<div class="lp-group-header"><span class="lp-group-title">${escapeHTML(TYPE_LABELS[type] || type)}</span></div>`
}

/** Badge de tipo. */
function typeBadge(type) {
  const label = TYPE_LABELS[type] || 'Geral'
  return `<span class="lp-badge lp-badge-${escapeHTML(type)}">${escapeHTML(label)}</span>`
}

/** Chip de canal (usado no modo "Todos"). */
function channelChip(channel) {
  if (!channel) return ''
  return `<span class="lp-badge lp-badge-channel">${escapeHTML(channel)}</span>`
}

/**
 * Formata a data de adição de forma curta/relativa:
 * hoje / ontem / há N dias (até 7) / dd/mm/aaaa.
 * @param {number} ms Timestamp em milissegundos.
 * @returns {string}
 */
function formatAddedDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  if (days < 7) return `há ${days} dias`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Data absoluta completa (para o atributo title/tooltip). */
function formatFullDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR')
}

/**
 * Monta a "cauda" de metadados (autor/origem + data) já pronta para inserção.
 * @param {string} leading Fragmento HTML já escapado (ex.: autor/origem) ou ''.
 * @param {number} ms Timestamp de adição.
 * @returns {string}
 */
function metaTailHtml(leading, ms) {
  const added = formatAddedDate(ms)
  const parts = []
  if (leading) parts.push(`<span class="lp-meta-author">${leading}</span>`)
  if (added) parts.push(`<span class="lp-meta-date" title="${escapeHTML(formatFullDate(ms))}">${added}</span>`)
  return parts.join(' · ')
}

/** Item da Comunidade. `showChannel` liga o chip de canal (modo "Todos"). */
function renderCommunityItemHtml(link, saved, showChannel) {
  const canModerate = window.sgdLinksService.canModerate()
  const author = link.authorName ? `por ${escapeHTML(link.authorName)}` : ''
  const editBtn = canModerate
    ? `<button type="button" class="lp-icon-btn lp-edit" data-id="${escapeHTML(link.id)}" title="Editar" aria-label="Editar link">✏️</button>`
    : ''
  const removeBtn = canModerate
    ? `<button type="button" class="lp-icon-btn lp-remove" data-id="${escapeHTML(link.id)}" title="Remover (moderação)" aria-label="Remover link">🗑️</button>`
    : ''
  const chip = showChannel ? channelChip(link.channel) + ' ' : ''
  return `
    <div class="lp-item" data-id="${escapeHTML(link.id)}" data-channel="${escapeHTML(link.channel || '')}">
      <div class="lp-item-main">
        <a class="lp-item-title" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(link.url)}">${escapeHTML(link.title)}</a>
        <div class="lp-item-meta">${chip}${typeBadge(link.type)} ${metaTailHtml(author, link.createdAt)}</div>
      </div>
      <div class="lp-item-actions">
        <button type="button" class="lp-icon-btn lp-like ${link.likedByMe ? 'active' : ''}" data-id="${escapeHTML(link.id)}" data-liked="${link.likedByMe}" aria-pressed="${link.likedByMe}" title="Curtir">👍 <span class="lp-count">${link.likeCount}</span></button>
        <button type="button" class="lp-icon-btn lp-save ${saved ? 'active' : ''}" data-id="${escapeHTML(link.id)}" data-saved="${saved}" aria-pressed="${saved}" title="${saved ? 'Salvo no Pessoal' : 'Salvar no Pessoal'}">${saved ? '❤️' : '🤍'} <span class="lp-count">${link.saveCount}</span></button>
        ${editBtn}${removeBtn}
      </div>
    </div>`
}

/** Item da Guia Pessoal. Usa o chip de canal no mesmo estilo do modo "Todos". */
function renderPersonalItemHtml(link) {
  const origin = link.source === 'community' ? '🤝 Comunidade' : '✍️ Meu'
  const chip = link.channel ? channelChip(link.channel) + ' ' : ''
  return `
    <div class="lp-item" data-id="${escapeHTML(link.id)}" data-channel="${escapeHTML(link.channel || '')}">
      <div class="lp-item-main">
        <a class="lp-item-title" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(link.url)}">${escapeHTML(link.title)}</a>
        <div class="lp-item-meta">${chip}${typeBadge(link.type)} ${metaTailHtml(origin, link.addedAt)}</div>
      </div>
      <div class="lp-item-actions">
        <button type="button" class="lp-icon-btn lp-edit-personal" data-id="${escapeHTML(link.id)}" title="Editar" aria-label="Editar link">✏️</button>
        <button type="button" class="lp-icon-btn lp-remove-personal" data-id="${escapeHTML(link.id)}" title="Remover do Pessoal" aria-label="Remover do pessoal">🗑️</button>
      </div>
    </div>`
}

/** Item da fila de pendências. `showChannel` exibe o canal de destino. */
function renderPendingItemHtml(link, showChannel) {
  const author = link.authorName ? `por ${escapeHTML(link.authorName)}` : ''
  const chip = showChannel ? channelChip(link.channel) + ' ' : ''
  return `
    <div class="lp-item lp-item-pending" data-id="${escapeHTML(link.id)}" data-channel="${escapeHTML(link.channel || '')}">
      <div class="lp-item-main">
        <a class="lp-item-title" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(link.url)}">${escapeHTML(link.title)}</a>
        <div class="lp-item-meta">${chip}${typeBadge(link.type)} ${metaTailHtml(author, link.createdAt)}</div>
      </div>
      <div class="lp-item-actions">
        <button type="button" class="lp-icon-btn lp-edit-pending" data-id="${escapeHTML(link.id)}" title="Editar antes de aprovar" aria-label="Editar contribuição">✏️</button>
        <button type="button" class="lp-icon-btn lp-approve" data-id="${escapeHTML(link.id)}" title="Aprovar" aria-label="Aprovar">✅</button>
        <button type="button" class="lp-icon-btn lp-reject" data-id="${escapeHTML(link.id)}" title="Rejeitar" aria-label="Rejeitar">❌</button>
      </div>
    </div>`
}

// ─── AÇÕES NA LISTA ──────────────────────────────────────────────────────────

/**
 * Handler único (delegado) para curtir/salvar/remover/aprovar/rejeitar.
 * @param {Event} e
 */
async function handleListAction(e) {
  const svc = window.sgdLinksService
  const btn = e.target.closest('button')
  if (!btn) return
  const id = btn.dataset.id
  // O canal vem do próprio item (essencial no modo "Todos", onde a lista mistura
  // canais); cai para o canal selecionado quando o item não informa.
  const item = btn.closest('.lp-item')
  const channel = (item && item.dataset.channel) || linksPanelState.channel

  // Curtir: ação única por usuário (endosso). Se já curtiu, informa e não repete.
  if (btn.classList.contains('lp-like')) {
    if (btn.dataset.liked === 'true') {
      showNotification('Você já curtiu este link. 👍', 'info')
      return
    }
    btn.disabled = true
    const res = await svc.toggleLike(channel, id, true)
    btn.disabled = false
    if (res.ok) {
      // Atualiza o botão no lugar (sem re-render/refetch).
      btn.dataset.liked = 'true'
      btn.classList.add('active')
      btn.setAttribute('aria-pressed', 'true')
      const countEl = btn.querySelector('.lp-count')
      if (countEl && typeof res.likeCount === 'number') countEl.textContent = res.likeCount
    } else {
      showNotification('Não foi possível registrar a curtida. Tente novamente.', 'error')
    }
    return
  }

  // Salvar/remover do Pessoal (UI otimista, sem reler o canal).
  if (btn.classList.contains('lp-save')) {
    const alreadySaved = btn.dataset.saved === 'true'
    btn.disabled = true
    const links = await svc.fetchCommunityLinks(channel) // cache quente, custo ~zero
    const link = links.find(l => l.id === id)
    if (!link) { btn.disabled = false; return }

    let newSaveCount
    if (alreadySaved) {
      const personal = await svc.getPersonalLinks()
      const match = personal.find(p => p.sourceId === id || p.urlNorm === link.urlNorm)
      const res = match ? await svc.removeFromPersonal(match.id) : { ok: true }
      newSaveCount = res.saveCount
      showNotification('Removido do Pessoal.', 'info')
    } else {
      const res = await svc.saveCommunityLinkToPersonal(link)
      newSaveCount = res.saveCount
      showNotification('Salvo na sua Guia Pessoal! ❤️', 'success')
    }
    btn.disabled = false

    // Atualiza coração + contador no lugar.
    const nowSaved = !alreadySaved
    const countEl = btn.querySelector('.lp-count')
    const cnt = (typeof newSaveCount === 'number') ? newSaveCount : (countEl ? countEl.textContent : '0')
    btn.dataset.saved = String(nowSaved)
    btn.classList.toggle('active', nowSaved)
    btn.setAttribute('aria-pressed', String(nowSaved))
    btn.title = nowSaved ? 'Salvo no Pessoal' : 'Salvar no Pessoal'
    btn.innerHTML = `${nowSaved ? '❤️' : '🤍'} <span class="lp-count">${escapeHTML(String(cnt))}</span>`
    return
  }

  // Editar (Comunidade) — moderadores.
  if (btn.classList.contains('lp-edit')) {
    const links = await svc.fetchCommunityLinks(channel)
    const link = links.find(l => l.id === id)
    if (link) openEditForm('community', { id, channel, title: link.title, url: link.url, type: link.type })
    return
  }

  // Editar contribuição pendente — moderadores.
  if (btn.classList.contains('lp-edit-pending')) {
    const pend = await svc.fetchPendingLinks(channel)
    const link = pend.find(l => l.id === id)
    if (link) openEditForm('pending', { id, channel, title: link.title, url: link.url, type: link.type })
    return
  }

  // Editar item do Pessoal.
  if (btn.classList.contains('lp-edit-personal')) {
    const list = await svc.getPersonalLinks()
    const link = list.find(l => l.id === id)
    if (link) openEditForm('personal', { id, channel: link.channel, title: link.title, url: link.url, type: link.type })
    return
  }

  // Remover do Pessoal (aba pessoal).
  if (btn.classList.contains('lp-remove-personal')) {
    await svc.removeFromPersonal(id)
    showNotification('Removido do Pessoal.', 'info')
    renderLinksContent()
    return
  }

  // Moderação: remover aprovado.
  if (btn.classList.contains('lp-remove')) {
    if (!confirm('Remover este link do canal? Esta ação não pode ser desfeita.')) return
    const res = await svc.removeCommunityLink(channel, id)
    showNotification(res.ok ? 'Link removido.' : 'Falha ao remover.', res.ok ? 'success' : 'error')
    renderLinksContent()
    return
  }

  // Moderação: aprovar.
  if (btn.classList.contains('lp-approve')) {
    btn.disabled = true
    const res = await svc.approvePendingLink(channel, id)
    showNotification(res.ok ? 'Link aprovado e publicado!' : 'Falha ao aprovar.', res.ok ? 'success' : 'error')
    renderLinksContent()
    return
  }

  // Moderação: rejeitar.
  if (btn.classList.contains('lp-reject')) {
    if (!confirm('Rejeitar (descartar) esta contribuição?')) return
    const res = await svc.rejectPendingLink(channel, id)
    showNotification(res.ok ? 'Contribuição descartada.' : 'Falha ao rejeitar.', res.ok ? 'success' : 'error')
    renderLinksContent()
    return
  }
}

// ─── FORMULÁRIO DE ADIÇÃO ────────────────────────────────────────────────────

/**
 * Abre o formulário de adição de link. No Pessoal salva localmente; na
 * Comunidade envia para aprovação (ou publica direto, se editor). Preenche
 * automaticamente Título/URL/Tipo e mostra Sistema/Módulo da página atual.
 */
function openAddLinkForm() {
  const toPersonal = linksPanelState.tab === 'personal'
  const channels = window.sgdLinksService.getLinkChannels()
  const auto = buildAutoLinkFromPage()

  // No formulário é obrigatório escolher um canal real (sem "Todos"). Se o
  // painel estiver em "Todos", pré-seleciona o primeiro canal da lista.
  const preselect = linksPanelState.channel === window.sgdLinksService.ALL_CHANNELS
    ? (channels[0] || 'Geral')
    : linksPanelState.channel
  const channelOptions = channels.map(c =>
    `<option value="${escapeHTML(c)}" ${c === preselect ? 'selected' : ''}>${escapeHTML(c)}</option>`
  ).join('')
  const typeOptions = ['geral', 'ss', 'ssc', 'sam', 'ne'].map(t =>
    `<option value="${t}" ${t === auto.type ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`
  ).join('')

  const canPublishDirect = window.sgdLinksService.canModerate()
  const destinoLabel = toPersonal
    ? 'Será salvo apenas na sua Guia Pessoal.'
    : (canPublishDirect
      ? 'Como editor, será publicado diretamente na Comunidade.'
      : 'Será enviado para aprovação de um moderador antes de aparecer na Comunidade.')

  // Contexto da página atual (ajuda a decidir o canal). Só aparece se houver.
  const { system, module } = extractSystemAndModule()
  const infoParts = []
  if (system) infoParts.push(`<span><b>Sistema:</b> ${escapeHTML(system)}</span>`)
  if (module) infoParts.push(`<span><b>Módulo:</b> ${escapeHTML(module)}</span>`)
  const contextInfo = infoParts.length
    ? `<div class="lp-form-info" title="Informações da página atual">${infoParts.join('')}</div>`
    : ''

  const contentHtml = `
    <div class="lp-form">
      <p class="lp-form-hint">${destinoLabel}</p>
      <label class="lp-form-field">
        <span>Título / Assunto</span>
        <input type="text" class="lp-form-title" value="${escapeHTML(auto.title)}" placeholder="Ex.: Honorários - Relação Contas a Receber..." />
      </label>
      <label class="lp-form-field">
        <span>URL</span>
        <input type="text" class="lp-form-url" value="${escapeHTML(auto.url)}" placeholder="https://..." />
      </label>
      <div class="lp-form-row">
        <label class="lp-form-field">
          <span>Tipo</span>
          <select class="lp-form-type">${typeOptions}</select>
        </label>
        <label class="lp-form-field">
          <span>Canal</span>
          <select class="lp-form-channel">${channelOptions}</select>
        </label>
      </div>
      ${contextInfo}
    </div>`

  const modal = createModal(
    toPersonal ? 'Adicionar link ao Pessoal' : 'Contribuir com link',
    contentHtml,
    async (bodyEl, closeModal) => {
      const title = bodyEl.querySelector('.lp-form-title').value.trim()
      const url = bodyEl.querySelector('.lp-form-url').value.trim()
      const type = bodyEl.querySelector('.lp-form-type').value
      const channel = bodyEl.querySelector('.lp-form-channel').value

      if (!isValidUrl(url)) { showNotification('URL inválida. Verifique o endereço.', 'error'); return }
      if (!title) { showNotification('Informe um título/assunto.', 'error'); return }

      if (toPersonal) {
        const res = await window.sgdLinksService.addPersonalLink({ url, title, type, channel })
        if (res.ok) { showNotification('Adicionado ao Pessoal!', 'success'); closeModal(); renderLinksContent() }
        else if (res.reason === 'duplicado') showNotification('Esse link já está no seu Pessoal.', 'info')
        else showNotification('Não foi possível adicionar.', 'error')
        return
      }

      const res = await window.sgdLinksService.submitCommunityLink({ url, title, type, channel })
      if (res.ok) {
        showNotification(
          res.direct ? 'Publicado na Comunidade! 🎉' : 'Enviado para aprovação. Obrigado por contribuir! 🙌',
          'success'
        )
        closeModal()
        if (res.direct) renderLinksContent()
      } else if (res.reason === 'duplicado') {
        handleDuplicateOnSubmit(res.duplicate, channel, closeModal)
      } else if (res.reason === 'sem-permissao-canal') {
        showNotification('Você não tem permissão para contribuir neste canal.', 'error')
      } else {
        showNotification('Não foi possível enviar. Tente novamente.', 'error')
      }
    },
    { modalId: 'lp-add-modal' }
  )
  document.body.appendChild(modal)
}

/**
 * Abre o formulário de EDIÇÃO de um link já existente.
 * @param {'community'|'pending'|'personal'} scope Onde o link vive.
 * @param {object} data { id, channel?, title, url, type }.
 */
function openEditForm(scope, data) {
  const isPersonal = scope === 'personal'
  const channels = window.sgdLinksService.getLinkChannels()
  const typeOptions = ['geral', 'ss', 'ssc', 'sam', 'ne'].map(t =>
    `<option value="${t}" ${t === data.type ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`
  ).join('')
  // Canal só é editável no Pessoal (mover entre canais na Comunidade exigiria
  // recriar o registro; aqui o canal fica fixo).
  const channelField = isPersonal
    ? `<label class="lp-form-field">
         <span>Canal</span>
         <select class="lp-form-channel">${channels.map(c =>
           `<option value="${escapeHTML(c)}" ${c === data.channel ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('')}</select>
       </label>`
    : `<label class="lp-form-field">
         <span>Canal</span>
         <input type="text" class="lp-form-channel-fixed" value="${escapeHTML(data.channel || '')}" disabled />
       </label>`

  const contentHtml = `
    <div class="lp-form">
      <p class="lp-form-hint">Edite as informações e salve.</p>
      <label class="lp-form-field">
        <span>Título / Assunto</span>
        <input type="text" class="lp-form-title" value="${escapeHTML(data.title || '')}" />
      </label>
      <label class="lp-form-field">
        <span>URL</span>
        <input type="text" class="lp-form-url" value="${escapeHTML(data.url || '')}" />
      </label>
      <div class="lp-form-row">
        <label class="lp-form-field">
          <span>Tipo</span>
          <select class="lp-form-type">${typeOptions}</select>
        </label>
        ${channelField}
      </div>
    </div>`

  const modal = createModal(
    'Editar link',
    contentHtml,
    async (bodyEl, closeModal) => {
      const title = bodyEl.querySelector('.lp-form-title').value.trim()
      const url = bodyEl.querySelector('.lp-form-url').value.trim()
      const type = bodyEl.querySelector('.lp-form-type').value
      if (!isValidUrl(url)) { showNotification('URL inválida. Verifique o endereço.', 'error'); return }
      if (!title) { showNotification('Informe um título/assunto.', 'error'); return }

      const svc = window.sgdLinksService
      let res
      if (scope === 'community') {
        res = await svc.updateCommunityLink(data.channel, data.id, { title, url, type })
      } else if (scope === 'pending') {
        res = await svc.updatePendingLink(data.channel, data.id, { title, url, type })
      } else {
        const channel = bodyEl.querySelector('.lp-form-channel').value
        res = await svc.updatePersonalLink(data.id, { title, url, type, channel })
      }

      if (res && res.ok) {
        showNotification('Link atualizado!', 'success')
        closeModal()
        renderLinksContent()
      } else {
        showNotification('Não foi possível salvar a edição.', 'error')
      }
    },
    { modalId: 'lp-edit-modal' }
  )
  document.body.appendChild(modal)
}

/**
 * Trata o caso de duplicata na submissão: oferece curtir o existente.
 * @param {object} duplicate Resultado de findDuplicateLink.
 * @param {string} channel
 * @param {Function} closeModal
 */
async function handleDuplicateOnSubmit(duplicate, channel, closeModal) {
  const where = duplicate && duplicate.where
  if (where === 'pending') {
    showNotification('Esse link já está aguardando aprovação. 👍', 'info')
    closeModal()
    return
  }
  // Já aprovado: oferece curtir em vez de duplicar.
  const link = duplicate.link
  if (confirm('Esse link já existe na Comunidade. Deseja curtir o link existente?')) {
    if (link && !link.likedByMe) await window.sgdLinksService.toggleLike(channel, link.id, true)
    showNotification('Curtida registrada no link existente. 👍', 'success')
  }
  closeModal()
  renderLinksContent()
}

// ─── SINCRONIZAÇÃO ENTRE ABAS ────────────────────────────────────────────────
try {
  const syncCh = new BroadcastChannel('sgd-links-sync')
  syncCh.onmessage = () => {
    if (document.getElementById(LINKS_PANEL_MODAL_ID)) renderLinksContent()
  }
} catch (e) { /* BroadcastChannel indisponível */ }

// ─── EXPORT GLOBAL ───────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.openLinksPanel = openLinksPanel
  window.closeLinksPanel = closeLinksPanel
}