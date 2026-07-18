/**
 * @file pending-widget.js
 * Widget lateral de pendências. Fica colado na borda direita do SGD; ao clicar
 * no marcador (handle) expande lateralmente mostrando as pendências N1 do
 * usuário agrupadas por faixa de SLA (ver classificarSlaPendencia em
 * pending-service.js). O marcador treme/pisca quando uma SSC cruza para faixa
 * de atenção (>=30h) — flag calculada por evaluatePendingEscalation.
 *
 * Controlado pela preferência `enablePendingWidget` (padrão desligado). Não faz
 * requisição própria de rede além do fetchPendingItems já coalescido pelo
 * coordenador — reutiliza o mesmo ciclo do FAB/guia.
 */

// Chave de estado persistido: apenas a POSIÇÃO vertical (compartilhada entre
// abas). O estado recolhido/expandido é PROPOSITALMENTE por-guia (memória
// local, não persistido) — expandir numa aba não replica nas demais.
const PENDING_WIDGET_TOP_KEY = 'pendingWidgetTop'

// Ordem das faixas contáveis (mais grave primeiro) na listagem.
const PENDING_WIDGET_TIER_ORDER = [
  'fatal',
  'critical',
  'urgent',
  'warning',
  'notice'
]

/** Escape defensivo (usa o global escapeHTML se existir). */
function sgdPwEscape(str) {
  if (typeof escapeHTML === 'function') return escapeHTML(str)
  return String(str == null ? '' : str).replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m])
  )
}

/** Lê a preferência enablePendingWidget (padrão false). */
async function isPendingWidgetEnabled() {
  try {
    if (typeof getSettings !== 'function') return false
    const settings = await getSettings()
    return settings?.preferences?.enablePendingWidget === true
  } catch (e) {
    return false
  }
}

/** Lê a faixa a partir da qual alertar (padrão 'notice'). */
async function getPendingWidgetAlertTier() {
  try {
    if (typeof getSettings !== 'function') return 'notice'
    const settings = await getSettings()
    return settings?.preferences?.pendingWidgetAlertTier || 'notice'
  } catch (e) {
    return 'notice'
  }
}

/** Lê de uma vez as preferências do widget (com defaults). */
async function getPendingWidgetConfig() {
  const cfg = {
    alertTier: 'notice',
    openAllTier: 'notice',
    includeN2: false,
    sound: false,
    repeat: false
  }
  try {
    if (typeof getSettings !== 'function') return cfg
    const p = (await getSettings())?.preferences || {}
    cfg.alertTier = p.pendingWidgetAlertTier || 'notice'
    cfg.openAllTier = p.pendingWidgetOpenAllTier || 'notice'
    cfg.includeN2 = p.pendingWidgetIncludeN2 === true
    cfg.sound = p.pendingWidgetSound === true
    cfg.repeat = p.pendingWidgetRepeatAlert === true
  } catch (e) {
    /* usa defaults */
  }
  return cfg
}

/** Grava uma preferência do widget (chrome.storage.sync). */
async function savePendingWidgetPref(key, value) {
  try {
    const result = await chrome.storage.sync.get(['extensionSettingsData'])
    const settings = result.extensionSettingsData || { preferences: {} }
    if (!settings.preferences) settings.preferences = {}
    settings.preferences[key] = value
    await chrome.storage.sync.set({ extensionSettingsData: settings })
  } catch (e) {
    console.error(`PendingWidget: erro ao salvar ${key}:`, e)
  }
}

/** Grava a faixa de alerta na preferência (chrome.storage.sync). */
async function setPendingWidgetAlertTier(tier) {
  await savePendingWidgetPref('pendingWidgetAlertTier', tier)
}

/** Desabilita o widget na preferência (chrome.storage.sync). */
async function setPendingWidgetDisabled() {
  try {
    const result = await chrome.storage.sync.get(['extensionSettingsData'])
    const settings = result.extensionSettingsData || { preferences: {} }
    if (!settings.preferences) settings.preferences = {}
    settings.preferences.enablePendingWidget = false
    await chrome.storage.sync.set({ extensionSettingsData: settings })
  } catch (e) {
    console.error('PendingWidget: erro ao desabilitar o widget:', e)
  }
}

// Duração de uma "rajada" de piscar (ms) e intervalo mínimo para repetir.
const PENDING_WIDGET_BURST_MS = 9000
const PENDING_WIDGET_REPEAT_MS = 60 * 60 * 1000 // ~1h
const PENDING_WIDGET_LAST_BURST_KEY = 'pendingWidgetLastBurstAt'
let pendingWidgetBurstTimer = null

/** Toca um bip curto (WebAudio) — melhor esforço; pode exigir gesto do usuário. */
function playPendingBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.36)
    osc.onended = () => ctx.close()
  } catch (e) {
    /* silencioso */
  }
}

/**
 * Dispara uma rajada de piscar no marcador (some sozinha após alguns segundos)
 * e registra o horário para o controle de repetição.
 */
function triggerPendingWidgetBurst(wrap) {
  if (!wrap || !wrap.classList.contains('collapsed')) return
  wrap.classList.add('has-new')
  if (pendingWidgetBurstTimer) clearTimeout(pendingWidgetBurstTimer)
  pendingWidgetBurstTimer = setTimeout(() => {
    wrap.classList.remove('has-new')
  }, PENDING_WIDGET_BURST_MS)
  try {
    chrome.storage.local.set({
      [PENDING_WIDGET_LAST_BURST_KEY]: Date.now()
    })
  } catch (e) {
    /* ignore */
  }
}

/**
 * Converte a faixa configurada no rank mínimo para disparar o alerta.
 * 'none' => 99 (nunca alerta, só contagem).
 */
function pendingAlertTierToMinRank(tier) {
  if (tier === 'none') return 99
  const meta =
    typeof PENDING_SLA_TIERS !== 'undefined' ? PENDING_SLA_TIERS[tier] : null
  return meta && Number.isFinite(meta.rank) ? meta.rank : 1
}

/** Remove o widget do DOM (quando a preferência está desligada). */
function destroyPendingWidget() {
  const el = document.getElementById('sgd-pending-widget')
  if (el) el.remove()
}

/**
 * Garante que o DOM do widget exista e esteja com os eventos ligados.
 * Restaura posição vertical e estado recolhido do storage.
 */
async function ensurePendingWidgetDom() {
  let wrap = document.getElementById('sgd-pending-widget')
  if (wrap) return wrap

  wrap = document.createElement('div')
  wrap.id = 'sgd-pending-widget'
  wrap.className = 'collapsed neutral'
  wrap.innerHTML = `
    <button class="sgd-pw-handle" type="button" aria-label="Abrir painel de pendências">
      <span class="sgd-pw-icon">🚨</span>
      <span class="sgd-pw-count" style="display:none;"></span>
    </button>
    <div class="sgd-pw-panel">
      <div class="sgd-pw-header">
        <span class="sgd-pw-title">Minhas pendências</span>
        <button class="sgd-pw-openall" type="button">↗ Abrir 30h+</button>
        <button class="sgd-pw-gear" type="button" title="Configurar alerta" aria-label="Configurar alerta">⚙️</button>
      </div>
      <div class="sgd-pw-settings" style="display:none;">
        <label class="sgd-pw-settings-label">Alertar a partir de:</label>
        <select class="sgd-pw-alert-tier">
          <option value="notice">👀 Fique atento (30h+)</option>
          <option value="warning">⏳ Atenção (40h+)</option>
          <option value="urgent">🔥 Urgente (44h+)</option>
          <option value="critical">💣 Estourado (48h+)</option>
          <option value="fatal">☠️ Atrasado (72h+)</option>
          <option value="none">🔕 Não alertar (só contagem)</option>
        </select>
        <label class="sgd-pw-settings-label" style="margin-top:10px;">Botão "Abrir" a partir de:</label>
        <select class="sgd-pw-openall-tier">
          <option value="notice">👀 Fique atento (30h+)</option>
          <option value="warning">⏳ Atenção (40h+)</option>
          <option value="urgent">🔥 Urgente (44h+)</option>
          <option value="critical">💣 Estourado (48h+)</option>
          <option value="fatal">☠️ Atrasado (72h+)</option>
        </select>
        <label class="sgd-pw-check"><input type="checkbox" class="sgd-pw-include-n2"> Incluir pendências N2</label>
        <label class="sgd-pw-check"><input type="checkbox" class="sgd-pw-sound"> Alerta sonoro (bip ao cruzar a faixa)</label>
        <label class="sgd-pw-check"><input type="checkbox" class="sgd-pw-repeat"> Repetir alerta se não visto (~1x/h)</label>
        <button class="sgd-pw-simulate" type="button">🧪 Simular alerta (teste)</button>
        <button class="sgd-pw-disable" type="button">Desabilitar Alerta de Pendências</button>
        <p class="sgd-pw-disable-hint">Para reativar depois, abra a guia <b>Pendências</b> e clique em <b>Alerta</b>.</p>
      </div>
      <div class="sgd-pw-list"></div>
    </div>`
  document.body.appendChild(wrap)

  // Começa SEMPRE recolhido nesta aba (estado de expansão é por-guia, não
  // persistido). Só restauramos a posição vertical, que é compartilhada.
  try {
    const st = await chrome.storage.local.get([PENDING_WIDGET_TOP_KEY])
    const top = st[PENDING_WIDGET_TOP_KEY]
    if (Number.isFinite(top)) {
      wrap.style.top = `${clampPendingWidgetTop(top)}px`
    }
  } catch (e) {
    /* mantém defaults */
  }

  bindPendingWidgetEvents(wrap)
  return wrap
}

/** Limita a posição vertical dentro da janela visível. */
function clampPendingWidgetTop(top) {
  const h = 120
  const max = Math.max(0, window.innerHeight - h)
  return Math.min(Math.max(0, top), max)
}

/** Liga clique (toggle), arraste vertical e o botão "Abrir 30h+". */
function bindPendingWidgetEvents(wrap) {
  const handle = wrap.querySelector('.sgd-pw-handle')
  const openAll = wrap.querySelector('.sgd-pw-openall')

  // --- Arraste vertical na borda + clique para expandir/recolher ---
  let dragging = false
  let moved = false
  let startY = 0
  let startTop = 0

  const onMove = e => {
    if (!dragging) return
    const dy = e.clientY - startY
    if (Math.abs(dy) > 5) moved = true
    const newTop = clampPendingWidgetTop(startTop + dy)
    wrap.style.top = `${newTop}px`
  }

  const onUp = async () => {
    if (!dragging) return
    dragging = false
    wrap.classList.remove('dragging')
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (moved) {
      const top = parseInt(wrap.style.top, 10)
      try {
        await chrome.storage.local.set({ [PENDING_WIDGET_TOP_KEY]: top })
      } catch (e) {
        /* ignore */
      }
    }
  }

  handle.addEventListener('mousedown', e => {
    dragging = true
    moved = false
    startY = e.clientY
    startTop = wrap.getBoundingClientRect().top
    wrap.classList.add('dragging')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    e.preventDefault()
  })

  handle.addEventListener('click', () => {
    // Se acabou de arrastar, não alterna (o mouseup já tratou a posição).
    if (moved) {
      moved = false
      return
    }
    const willOpen = wrap.classList.contains('collapsed')
    // Estado de expansão é apenas desta aba — não persiste no storage.
    wrap.classList.toggle('collapsed', !willOpen)
    // Abrir = visto: para de piscar e limpa a flag persistida.
    if (willOpen) {
      wrap.classList.remove('has-new')
      if (typeof clearPendingWidgetHasNew === 'function') {
        clearPendingWidgetHasNew()
      }
    }
  })

  // Fecha automaticamente ao clicar fora do widget (quando expandido).
  document.addEventListener('mousedown', e => {
    if (wrap.classList.contains('collapsed')) return
    if (wrap.contains(e.target)) return
    wrap.classList.add('collapsed')
  })

  // --- Engrenagem: alterna entre a LISTA e a tela de configurações ---
  // Ao abrir as configurações, a lista some (fica só as configs); ao fechar,
  // a lista volta. Facilita o usuário focar nas opções.
  const gear = wrap.querySelector('.sgd-pw-gear')
  const settings = wrap.querySelector('.sgd-pw-settings')
  const list = wrap.querySelector('.sgd-pw-list')
  if (gear && settings) {
    gear.addEventListener('click', () => {
      const showingSettings = settings.style.display !== 'none'
      if (showingSettings) {
        settings.style.display = 'none'
        if (list) list.style.display = ''
        gear.classList.remove('active')
      } else {
        settings.style.display = 'block'
        if (list) list.style.display = 'none'
        gear.classList.add('active')
      }
    })
  }

  // --- Select da faixa de alerta ---
  const tierSelect = wrap.querySelector('.sgd-pw-alert-tier')
  if (tierSelect) {
    tierSelect.addEventListener('change', async () => {
      await setPendingWidgetAlertTier(tierSelect.value)
      // Reinicia o estado de "novo" (a régua mudou) e reavalia.
      wrap.classList.remove('has-new')
      if (typeof clearPendingWidgetHasNew === 'function') {
        await clearPendingWidgetHasNew()
      }
      refreshPendingWidget()
    })
  }

  // --- Select da faixa do botão "Abrir" ---
  const openAllTierSelect = wrap.querySelector('.sgd-pw-openall-tier')
  if (openAllTierSelect) {
    openAllTierSelect.addEventListener('change', async () => {
      await savePendingWidgetPref(
        'pendingWidgetOpenAllTier',
        openAllTierSelect.value
      )
      refreshPendingWidget() // atualiza o rótulo e o conjunto do botão
    })
  }

  // --- Checkboxes de configuração ---
  const cbN2 = wrap.querySelector('.sgd-pw-include-n2')
  if (cbN2) {
    cbN2.addEventListener('change', async () => {
      await savePendingWidgetPref('pendingWidgetIncludeN2', cbN2.checked)
      refreshPendingWidget()
    })
  }
  const cbSound = wrap.querySelector('.sgd-pw-sound')
  if (cbSound) {
    cbSound.addEventListener('change', async () => {
      await savePendingWidgetPref('pendingWidgetSound', cbSound.checked)
      if (cbSound.checked) playPendingBeep() // amostra imediata
    })
  }
  const cbRepeat = wrap.querySelector('.sgd-pw-repeat')
  if (cbRepeat) {
    cbRepeat.addEventListener('change', async () => {
      await savePendingWidgetPref('pendingWidgetRepeatAlert', cbRepeat.checked)
    })
  }

  // --- Simular alerta (teste): faz o marcador piscar/bipar como se uma
  //     nova pendência tivesse cruzado a faixa configurada. ---
  const simulateBtn = wrap.querySelector('.sgd-pw-simulate')
  if (simulateBtn) {
    simulateBtn.addEventListener('click', async () => {
      const cfg = await getPendingWidgetConfig()
      if (cfg.alertTier === 'none') {
        if (typeof showNotification === 'function') {
          showNotification(
            'Alerta configurado como "Não alertar": só a contagem é exibida.',
            'info',
            4000
          )
        }
        return
      }
      // Recolhe (o piscar acontece no marcador) e dispara a rajada + som.
      const settingsEl = wrap.querySelector('.sgd-pw-settings')
      const listEl = wrap.querySelector('.sgd-pw-list')
      if (settingsEl) settingsEl.style.display = 'none'
      if (listEl) listEl.style.display = ''
      const gearEl = wrap.querySelector('.sgd-pw-gear')
      if (gearEl) gearEl.classList.remove('active')
      wrap.classList.add('collapsed')
      wrap.classList.remove('neutral')
      const iconEl = wrap.querySelector('.sgd-pw-icon')
      if (iconEl) iconEl.textContent = '🚨'
      triggerPendingWidgetBurst(wrap)
      if (cfg.sound) playPendingBeep()
    })
  }

  // --- Atalho para desabilitar o widget ---
  const disableBtn = wrap.querySelector('.sgd-pw-disable')
  if (disableBtn) {
    disableBtn.addEventListener('click', async () => {
      await setPendingWidgetDisabled()
      if (typeof showNotification === 'function') {
        showNotification(
          'Alerta de Pendências desativado. Reative na guia Pendências › botão "Alerta".',
          'info',
          6000
        )
      }
      destroyPendingWidget()
    })
  }

  // --- Abrir 30h+ (todas as faixas de atenção em novas guias) ---
  openAll.addEventListener('click', () => {
    const urls = (wrap._pendingAttentionUrls || []).slice()
    if (urls.length === 0) return
    try {
      chrome.runtime.sendMessage({ action: 'ABRIR_TODAS_SSCS', urls })
    } catch (e) {
      // Fallback: abre a primeira aba diretamente se o SW não responder.
      window.open(urls[0], '_blank')
    }
  })
}

/**
 * Renderiza o conteúdo do widget a partir das pendências do usuário.
 * A animação de "piscar" NÃO é decidida aqui (ver triggerPendingWidgetBurst).
 * @param {Array<object>} widgetItems - Itens a exibir (N1, e N2 se habilitado).
 * @param {object} [cfg] - Config do widget (usa openAllTier para o botão "Abrir").
 */
async function renderPendingWidget(widgetItems, cfg) {
  const wrap = await ensurePendingWidgetDom()
  const items = Array.isArray(widgetItems) ? widgetItems : []
  const openAllTier = (cfg && cfg.openAllTier) || 'notice'

  // Agrupa por faixa de SLA.
  const groups = {}
  items.forEach(it => {
    const c = classificarSlaPendencia(it)
    if (!groups[c.tier]) groups[c.tier] = []
    groups[c.tier].push({ it, c })
  })

  // Coleta os itens em faixa de atenção (>=30h) — contam e vão no "Abrir 30h+".
  const attention = []
  PENDING_WIDGET_TIER_ORDER.forEach(tier => {
    ;(groups[tier] || []).forEach(g => attention.push(g))
  })
  const count = attention.length

  // Estado do marcador: vermelho quando há atenção, cinza neutro quando não há.
  wrap.classList.toggle('neutral', count === 0)
  const iconEl = wrap.querySelector('.sgd-pw-icon')
  const countEl = wrap.querySelector('.sgd-pw-count')
  iconEl.textContent = '🚨'
  if (count > 0) {
    countEl.textContent = String(count)
    countEl.style.display = ''
  } else {
    countEl.style.display = 'none'
  }

  // Segurança: sem itens em atenção não há o que piscar.
  if (count === 0) wrap.classList.remove('has-new')

  // Botão "Abrir": abre as SSCs a partir da faixa configurada (openAllTier).
  // O conjunto e o rótulo (ex.: "Abrir 48h+") acompanham a seleção.
  const openAllMeta =
    typeof PENDING_SLA_TIERS !== 'undefined'
      ? PENDING_SLA_TIERS[openAllTier] || PENDING_SLA_TIERS.notice
      : { rank: 1, minHours: 30 }
  const openAllItems = attention.filter(g => g.c.rank >= openAllMeta.rank)
  wrap._pendingAttentionUrls = openAllItems
    .map(g => g.it.link)
    .filter(u => u && u !== '#')
  const openAllBtn = wrap.querySelector('.sgd-pw-openall')
  if (openAllBtn) {
    openAllBtn.textContent = `↗ Abrir ${openAllMeta.minHours}h+`
    openAllBtn.disabled = wrap._pendingAttentionUrls.length === 0
  }

  // Monta a listagem.
  const listEl = wrap.querySelector('.sgd-pw-list')
  let html = ''

  const n2Tag = it =>
    it && it.nivel === 'N2'
      ? '<span class="sgd-pw-n2" title="Aguardando Suporte Nível 2 (outro setor)">N2</span>'
      : ''

  const renderRow = (it, c) => `
    <a class="sgd-pw-row" style="border-left-color:${c.color};background:${c.bg};"
       href="${sgdPwEscape(it.link)}" target="_blank" rel="noopener noreferrer"
       title="${sgdPwEscape(it.subject)}">
      <b>${sgdPwEscape(it.id)}</b>${n2Tag(it)} · ${sgdPwEscape(it.subject)}
    </a>`

  PENDING_WIDGET_TIER_ORDER.forEach(tier => {
    const g = groups[tier]
    if (!g || g.length === 0) return
    const meta = g[0].c
    html += `<div class="sgd-pw-grp" style="color:${meta.color};">${meta.icon} ${sgdPwEscape(
      meta.label
    )} — ${sgdPwEscape(meta.rangeLabel)}</div>`
    g.forEach(({ it, c }) => {
      html += renderRow(it, c)
    })
  })

  // Seção informativa "No prazo (<30h)": não conta, não sinaliza.
  const noPrazo = groups['no-prazo'] || []
  if (noPrazo.length > 0) {
    const meta = noPrazo[0].c
    html += `<div class="sgd-pw-sep"></div>`
    html += `<div class="sgd-pw-grp" style="color:#64748b;">${meta.icon} ${sgdPwEscape(
      meta.label
    )} — &lt;30h <span style="font-weight:500;opacity:.8;">(informativo)</span></div>`
    noPrazo.forEach(({ it }) => {
      html += `
        <a class="sgd-pw-row" style="border-left-color:#cbd5e1;background:#f8fafc;color:#64748b;"
           href="${sgdPwEscape(it.link)}" target="_blank" rel="noopener noreferrer"
           title="${sgdPwEscape(it.subject)}">
          <b style="color:#475569;">${sgdPwEscape(it.id)}</b> · ${sgdPwEscape(it.subject)}
        </a>`
    })
  }

  if (!html) {
    html = `<div class="sgd-pw-empty">Nenhuma pendência sua no momento. 🎉</div>`
  }

  listEl.innerHTML = html
}

/**
 * Atualiza o widget: verifica a preferência, busca as pendências (coalescido
 * pelo coordenador), avalia o cruzamento de 30h e renderiza.
 * @param {object} [opts] - Repassado a fetchPendingItems (ex.: {force:true}).
 */
async function refreshPendingWidget(opts = {}) {
  try {
    const enabled = await isPendingWidgetEnabled()
    if (!enabled) {
      destroyPendingWidget()
      return
    }
    if (typeof fetchPendingItems !== 'function') return

    // Lê as preferências e sincroniza os controles do painel de config.
    const cfg = await getPendingWidgetConfig()
    const minRank = pendingAlertTierToMinRank(cfg.alertTier)
    const wrap0 = await ensurePendingWidgetDom()
    const tierSelect = wrap0.querySelector('.sgd-pw-alert-tier')
    if (tierSelect && tierSelect.value !== cfg.alertTier) {
      tierSelect.value = cfg.alertTier
    }
    const openAllSelect = wrap0.querySelector('.sgd-pw-openall-tier')
    if (openAllSelect && openAllSelect.value !== cfg.openAllTier) {
      openAllSelect.value = cfg.openAllTier
    }
    const cbN2 = wrap0.querySelector('.sgd-pw-include-n2')
    if (cbN2) cbN2.checked = cfg.includeN2
    const cbSound = wrap0.querySelector('.sgd-pw-sound')
    if (cbSound) cbSound.checked = cfg.sound
    const cbRepeat = wrap0.querySelector('.sgd-pw-repeat')
    if (cbRepeat) cbRepeat.checked = cfg.repeat

    const result = await fetchPendingItems(opts)
    const allItems = (result && result.items) || []
    const items = cfg.includeN2
      ? allItems.filter(i => i.nivel === 'N1' || i.nivel === 'N2')
      : allItems.filter(i => i.nivel === 'N1')

    let hasNew = false
    let escalated = 0
    if (typeof evaluatePendingEscalation === 'function') {
      const evalRes = await evaluatePendingEscalation(items, minRank)
      hasNew = !!evalRes.hasNew
      escalated = (evalRes.escalatedIds || []).length
    }

    await renderPendingWidget(items, cfg)

    // Se o widget está aberto, o usuário já viu — limpa o estado de "novo".
    const isCollapsed = wrap0.classList.contains('collapsed')
    if (hasNew && !isCollapsed) {
      wrap0.classList.remove('has-new')
      if (typeof clearPendingWidgetHasNew === 'function') {
        await clearPendingWidgetHasNew()
      }
      return
    }

    // Decide se dispara a rajada de piscar: cruzamento novo neste ciclo, ou
    // (com "repetir" ligado) lembrete periódico enquanto não visto.
    let doBurst = escalated > 0
    if (!doBurst && hasNew && cfg.repeat) {
      const st = await chrome.storage.local.get([PENDING_WIDGET_LAST_BURST_KEY])
      const last = st[PENDING_WIDGET_LAST_BURST_KEY] || 0
      if (Date.now() - last >= PENDING_WIDGET_REPEAT_MS) doBurst = true
    }

    if (doBurst) {
      triggerPendingWidgetBurst(wrap0)
      if (cfg.sound) playPendingBeep()
    }
  } catch (error) {
    console.error('PendingWidget: erro ao atualizar o widget:', error)
  }
}

/**
 * Inicializa o widget no carregamento da página (se a preferência permitir).
 */
async function initPendingWidget() {
  const enabled = await isPendingWidgetEnabled()
  if (!enabled) {
    destroyPendingWidget()
    return
  }
  await refreshPendingWidget()
}

// Exposição explícita no escopo global (compat. com o mundo isolado).
if (typeof window !== 'undefined') {
  window.initPendingWidget = initPendingWidget
  window.refreshPendingWidget = refreshPendingWidget
  window.renderPendingWidget = renderPendingWidget
  window.destroyPendingWidget = destroyPendingWidget
}
