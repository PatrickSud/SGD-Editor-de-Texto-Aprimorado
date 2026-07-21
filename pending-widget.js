/**
 * @file pending-widget.js
 * Widget lateral de pendências. Fica colado na borda direita do SGD; ao clicar
 * no marcador (handle) expande lateralmente mostrando as pendências N1 do
 * usuário agrupadas por faixa de SLA (ver classificarSlaPendencia em
 * pending-service.js). O marcador treme/pisca quando uma SSC cruza para faixa
 * de atenção (>=30h) — flag calculada por evaluatePendingEscalation.
 *
 * Controlado pela preferência `enablePendingWidget` (padrão HABILITADO a
 * partir de 2026-07-21 — ver isPendingWidgetEnabled). Não faz
 * requisição própria de rede além do fetchPendingItems já coalescido pelo
 * coordenador — reutiliza o mesmo ciclo do FAB/guia.
 */

// Chave de estado persistido: apenas a POSIÇÃO vertical (compartilhada entre
// abas). O estado recolhido/expandido é PROPOSITALMENTE por-guia (memória
// local, não persistido) — expandir numa aba não replica nas demais.
const PENDING_WIDGET_TOP_KEY = 'pendingWidgetTop'

// Ordem de agrupamento na listagem: as faixas contáveis/de atenção (mais
// grave primeiro) e, depois, as informativas — ambas vêm de pending-service.js
// (fonte de verdade única da régua de SLA).

// Faixas recolhidas pelo usuário (só a lista de chamados some, o cabeçalho
// com o contador continua visível). Propositalmente em memória (não
// persistido) — igual ao estado recolhido/expandido do próprio widget, cada
// guia começa com tudo expandido.
const pendingWidgetCollapsedTiers = new Set()

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

/**
 * Lê a preferência enablePendingWidget. PADRÃO true (habilitado) a partir de
 * 2026-07-21 — só fica desligado com valor EXPLICITAMENTE false (checa
 * `!== false`, não `=== true`), pra que instalações antigas que nunca
 * mexeram nessa preferência migrem sozinhas pro novo padrão, sem precisar de
 * nenhuma escrita/migração no storage.
 */
async function isPendingWidgetEnabled() {
  try {
    if (typeof getSettings !== 'function') return true
    const settings = await getSettings()
    return settings?.preferences?.enablePendingWidget !== false
  } catch (e) {
    return true
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

/**
 * Lê de uma vez as preferências do widget (com defaults).
 * A partir de 2026-07-21 (a pedido do Patrick): Modo Claro, Alerta Sonoro e
 * o próprio widget habilitado passaram a ser o padrão pra instalações novas
 * E antigas — por isso `sound`/`darkMode` abaixo checam o valor que DESLIGA
 * (`!== false` / `=== true`) em vez do que LIGA, garantindo que quem nunca
 * mexeu nessas prefs (instalação antiga ou nova) já caia no novo padrão sem
 * precisar de nenhuma migração/escrita no storage.
 */
async function getPendingWidgetConfig() {
  const cfg = {
    alertTier: 'notice',
    alertDisabled: false,
    openAllTier: 'notice',
    includeLowerTiers: false,
    includeN2: false,
    sound: true,
    repeat: false,
    darkMode: false
  }
  try {
    if (typeof getSettings !== 'function') return cfg
    const p = (await getSettings())?.preferences || {}
    cfg.alertTier = p.pendingWidgetAlertTier || 'notice'
    cfg.openAllTier = p.pendingWidgetOpenAllTier || 'notice'
    cfg.includeN2 = p.pendingWidgetIncludeN2 === true
    // Padrão true (som ligado): só desliga se a pref existir e for false.
    cfg.sound = p.pendingWidgetSound !== false
    cfg.repeat = p.pendingWidgetRepeatAlert === true
    cfg.includeLowerTiers = p.pendingWidgetIncludeLowerTiers === true
    // Padrão false (claro): só vira escuro se a pref existir e for true.
    cfg.darkMode = p.pendingWidgetDarkMode === true
    // Migração de instalações antigas: o valor 'none' (removido do select)
    // agora vira o checkbox separado "Não alertar".
    if (p.pendingWidgetAlertDisabled === true || cfg.alertTier === 'none') {
      cfg.alertDisabled = true
      if (cfg.alertTier === 'none') cfg.alertTier = 'notice'
    }
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

/**
 * Resolve a faixa ATIVA que rege notificação + botão "Abrir": normalmente é
 * `pendingWidgetAlertTier` (o campo único, unificado a pedido do Patrick); se
 * o usuário desligou o alerta (`pendingWidgetAlertDisabled`), passa a usar
 * `pendingWidgetOpenAllTier` (que só existe pra cobrir esse cenário, já que
 * sem alerta não há mais um valor único a compartilhar).
 * @param {object} cfg - Retorno de getPendingWidgetConfig().
 * @returns {string} chave da faixa (ex.: 'notice').
 */
function getPendingWidgetActiveTier(cfg) {
  return cfg && cfg.alertDisabled ? cfg.openAllTier : cfg.alertTier
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
// 5 min (ou até o usuário abrir o painel/widget, o que vier primeiro).
const PENDING_WIDGET_BURST_MS = 5 * 60 * 1000
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
 * Dispara/renova a "rajada" de piscar no marcador — some sozinha após
 * `durationMs` (padrão PENDING_WIDGET_BURST_MS, 5min) OU assim que o usuário
 * abre o painel/widget (o clique já remove a classe `has-new` à parte). NÃO
 * grava o timestamp de origem sozinha — quem dispara decide se isso é um
 * evento novo (`markPendingWidgetBurstOrigin`) ou só um "acompanhar" numa
 * guia nova (ver refreshPendingWidget).
 * @param {HTMLElement} wrap
 * @param {number} [durationMs]
 */
function triggerPendingWidgetBurst(wrap, durationMs) {
  if (!wrap || !wrap.classList.contains('collapsed')) return
  const duration =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : PENDING_WIDGET_BURST_MS
  wrap.classList.add('has-new')
  if (pendingWidgetBurstTimer) clearTimeout(pendingWidgetBurstTimer)
  pendingWidgetBurstTimer = setTimeout(() => {
    wrap.classList.remove('has-new')
  }, duration)
}

/**
 * Marca AGORA como o início de uma nova "rajada" (evento novo de escalonamento
 * ou lembrete periódico). Guias que abrirem enquanto essa rajada ainda está
 * "ativa" (dentro de PENDING_WIDGET_BURST_MS) usam esse timestamp pra saber
 * quanto tempo ainda falta e acompanhar o piscar sem soar de novo.
 */
async function markPendingWidgetBurstOrigin() {
  try {
    await chrome.storage.local.set({
      [PENDING_WIDGET_LAST_BURST_KEY]: Date.now()
    })
  } catch (e) {
    /* ignore */
  }
}

/**
 * Converte a chave de uma faixa (ex.: 'notice') no rank mínimo correspondente.
 * Aceita qualquer faixa da régua, incluindo as informativas (no-prazo/recente).
 * 'none' (valor legado, migrado para o checkbox `alertDisabled`) => 99, nunca alerta.
 */
function pendingAlertTierToMinRank(tier) {
  if (tier === 'none') return 99
  const meta =
    typeof PENDING_SLA_TIERS !== 'undefined' ? PENDING_SLA_TIERS[tier] : null
  return meta && Number.isFinite(meta.rank)
    ? meta.rank
    : PENDING_SLA_TIERS.notice.rank
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
  // Já nasce com sgd-pw-light (novo padrão, 2026-07-21) pra evitar um flash
  // do tema escuro antes do refreshPendingWidget sincronizar a preferência
  // real (que pode ser escuro, se o usuário tiver ligado explicitamente).
  wrap.className = 'collapsed neutral sgd-pw-light'
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
        <label class="sgd-pw-check"><input type="checkbox" class="sgd-pw-dark-mode"> 🌙 Modo escuro</label>
        <label class="sgd-pw-check"><input type="checkbox" class="sgd-pw-alert-disabled"> 🔕 Não alertar (só contagem)</label>

        <div class="sgd-pw-alert-block" style="margin-top:8px;">
          <label class="sgd-pw-settings-label">Alertar a partir de:</label>
          <select class="sgd-pw-alert-tier">
            <option value="recente">✅ Recente (0h+)</option>
            <option value="no-prazo">🕓 No prazo (24h+)</option>
            <option value="notice">👀 Fique atento (30h+)</option>
            <option value="warning">⏳ Atenção (36h+)</option>
            <option value="critical">🔥 Crítico (42h+)</option>
            <option value="urgent">🧨 Urgente (46h+)</option>
            <option value="estourado">💣 Estourado (48h+)</option>
            <option value="fatal">☠️ Atrasado (72h+, não notifica)</option>
          </select>
        </div>

        <div class="sgd-pw-openall-block" style="display:none;margin-top:8px;">
          <label class="sgd-pw-settings-label">Abrir a partir de:</label>
          <select class="sgd-pw-openall-tier">
            <option value="recente">✅ Recente (0h+)</option>
            <option value="no-prazo">🕓 No prazo (24h+)</option>
            <option value="notice">👀 Fique atento (30h+)</option>
            <option value="warning">⏳ Atenção (36h+)</option>
            <option value="critical">🔥 Crítico (42h+)</option>
            <option value="urgent">🧨 Urgente (46h+)</option>
            <option value="estourado">💣 Estourado (48h+)</option>
            <option value="fatal">☠️ Atrasado (72h+)</option>
          </select>
        </div>

        <label class="sgd-pw-check sgd-pw-include-lower-row" style="margin-top:10px;display:none;"><input type="checkbox" class="sgd-pw-include-lower"> Faixas abaixo de 30h também contam e abrem</label>
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

  // --- Recolher/expandir uma faixa: clique (ou Enter/Espaço) no cabeçalho do
  //     grupo. Delegado no container da lista (o HTML é recriado a cada
  //     render, então um listener direto no cabeçalho se perderia). Como já
  //     temos os itens/config da última renderização guardados no wrap, o
  //     toggle só re-renderiza local — sem rebuscar nada. ---
  if (list) {
    const toggleGroup = tier => {
      if (!tier) return
      if (pendingWidgetCollapsedTiers.has(tier)) {
        pendingWidgetCollapsedTiers.delete(tier)
      } else {
        pendingWidgetCollapsedTiers.add(tier)
      }
      renderPendingWidget(wrap._pwLastItems || [], wrap._pwLastCfg || {})
    }
    list.addEventListener('click', e => {
      const header = e.target.closest('.sgd-pw-grp')
      if (!header) return
      toggleGroup(header.dataset.tier)
    })
    list.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const header = e.target.closest('.sgd-pw-grp')
      if (!header) return
      e.preventDefault()
      toggleGroup(header.dataset.tier)
    })
  }

  // --- Checkbox "Modo escuro": alterna o tema do painel (padrão escuro) ---
  const cbDarkMode = wrap.querySelector('.sgd-pw-dark-mode')
  if (cbDarkMode) {
    cbDarkMode.addEventListener('change', async () => {
      await savePendingWidgetPref('pendingWidgetDarkMode', cbDarkMode.checked)
      wrap.classList.toggle('sgd-pw-light', !cbDarkMode.checked)
      refreshPendingWidget() // reaplica as cores de faixa certas pro tema
    })
  }

  // --- Checkbox "Não alertar (só contagem)": alterna qual select aparece ---
  // Desligado (padrão): mostra "Alertar a partir de:" (vale pra alerta + Abrir).
  // Ligado: some o select de alerta e mostra "Abrir a partir de:" no lugar,
  // já que sem alerta não há mais um valor único pra compartilhar.
  const alertBlock = wrap.querySelector('.sgd-pw-alert-block')
  const openAllBlock = wrap.querySelector('.sgd-pw-openall-block')
  const cbAlertDisabled = wrap.querySelector('.sgd-pw-alert-disabled')
  if (cbAlertDisabled) {
    cbAlertDisabled.addEventListener('change', async () => {
      await savePendingWidgetPref(
        'pendingWidgetAlertDisabled',
        cbAlertDisabled.checked
      )
      if (alertBlock) alertBlock.style.display = cbAlertDisabled.checked ? 'none' : ''
      if (openAllBlock) openAllBlock.style.display = cbAlertDisabled.checked ? '' : 'none'
      wrap.classList.remove('has-new')
      if (typeof clearPendingWidgetHasNew === 'function') {
        await clearPendingWidgetHasNew()
      }
      refreshPendingWidget()
    })
  }

  // --- Select da faixa de alerta (também rege o botão "Abrir" quando o
  //     alerta está ligado — campo único, unificado) ---
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

  // --- Select da faixa do botão "Abrir" (só visível com o alerta desligado) ---
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

  // --- Checkbox: estender contagem/agrupamento/Abrir pras faixas <30h ---
  const cbIncludeLower = wrap.querySelector('.sgd-pw-include-lower')
  if (cbIncludeLower) {
    cbIncludeLower.addEventListener('change', async () => {
      await savePendingWidgetPref(
        'pendingWidgetIncludeLowerTiers',
        cbIncludeLower.checked
      )
      refreshPendingWidget()
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
      if (cfg.alertDisabled) {
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
 *
 * Faixa única (unificada, 2026-07-20): a mesma faixa escolhida pelo usuário
 * (`alertTier`, ou `openAllTier` quando o alerta está desligado) rege tanto o
 * botão "Abrir" quanto — se `includeLowerTiers` estiver ligado e a faixa
 * escolhida for abaixo de "Fique atento"/30h — o piso da contagem/agrupamento
 * do widget. Sem isso, o piso de contagem/agrupamento fica sempre fixo em
 * 30h (comportamento de sempre), mesmo que a faixa de alerta/abrir seja mais
 * baixa (nesse caso ela só antecipa a notificação e amplia o que o "Abrir"
 * inclui, sem tirar nada do rodapé informativo).
 * @param {Array<object>} widgetItems - Itens a exibir (N1, e N2 se habilitado).
 * @param {object} [cfg] - Config do widget (ver getPendingWidgetConfig).
 */
async function renderPendingWidget(widgetItems, cfg) {
  const wrap = await ensurePendingWidgetDom()
  const items = Array.isArray(widgetItems) ? widgetItems : []
  // Guarda a última renderização (itens + config) pra permitir recolher/
  // expandir uma faixa sem precisar rebuscar nada — só re-renderiza local.
  wrap._pwLastItems = items
  wrap._pwLastCfg = cfg
  const activeTierKey = getPendingWidgetActiveTier(cfg || {})
  const activeMeta = PENDING_SLA_TIERS[activeTierKey] || PENDING_SLA_TIERS.notice
  const minRankSelected = activeMeta.rank
  const noticeRank = PENDING_SLA_TIERS.notice.rank
  const includeLower = !!(cfg && cfg.includeLowerTiers)
  // Piso da contagem/agrupamento: só desce abaixo de 30h se o usuário ligou
  // "Faixas abaixo de 30h também contam e abrem" E escolheu uma faixa < 30h.
  const countMinRank =
    includeLower && minRankSelected < noticeRank ? minRankSelected : noticeRank
  // Tema do painel (padrão escuro): as cores pastel claras de PENDING_SLA_TIERS
  // ficam ilegíveis num painel escuro, então usamos a paleta alternativa.
  const isDark = !(cfg && cfg.darkMode === false)
  const resolveTierStyle = c => {
    if (isDark) {
      const d =
        typeof PENDING_SLA_DARK_TIER_STYLE !== 'undefined'
          ? PENDING_SLA_DARK_TIER_STYLE[c.tier]
          : null
      if (d) return d
    }
    return { color: c.color, bg: c.bg }
  }

  // Agrupa por faixa de SLA.
  const groups = {}
  items.forEach(it => {
    const c = classificarSlaPendencia(it)
    if (!groups[c.tier]) groups[c.tier] = []
    groups[c.tier].push({ it, c })
  })

  // Itens "em atenção" (>= piso de contagem) — contam no 🚨 e ficam no grupo
  // colorido; o restante cai no rodapé informativo.
  const attention = []
  PENDING_SLA_ALL_ORDER.forEach(tier => {
    if (PENDING_SLA_TIERS[tier].rank >= countMinRank) {
      ;(groups[tier] || []).forEach(g => attention.push(g))
    }
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

  // Botão "Abrir": sempre segue a faixa ATIVA diretamente (independe do piso
  // de contagem acima) — abre tudo a partir do rank escolhido, mesmo que
  // ainda apareça no rodapé informativo por conta do piso não ter descido.
  const openItems = []
  PENDING_SLA_ALL_ORDER.forEach(tier => {
    if (PENDING_SLA_TIERS[tier].rank >= minRankSelected) {
      ;(groups[tier] || []).forEach(g => openItems.push(g))
    }
  })
  wrap._pendingAttentionUrls = openItems
    .map(g => g.it.link)
    .filter(u => u && u !== '#')
  const openAllBtn = wrap.querySelector('.sgd-pw-openall')
  if (openAllBtn) {
    openAllBtn.textContent = `↗ Abrir ${activeMeta.minHours}h+`
    openAllBtn.disabled = wrap._pendingAttentionUrls.length === 0
  }

  // Monta a listagem.
  const listEl = wrap.querySelector('.sgd-pw-list')
  let html = ''

  const n2Tag = it =>
    it && it.nivel === 'N2'
      ? '<span class="sgd-pw-n2" title="Aguardando Suporte Nível 2 (outro setor)">N2</span>'
      : ''

  // Em vez do número da SSC, a linha mostra só o badge de dias em aberto
  // (mesmo dado "📅 Xd" do card do painel) — o badge de tempo sem retorno foi
  // removido a pedido do Patrick.
  const renderRow = (it, meta, style, muted) => {
    const diasLabel =
      it && it.dias !== undefined && it.dias !== null && it.dias !== ''
        ? `${sgdPwEscape(it.dias)}d`
        : '–'
    return `
    <a class="sgd-pw-row${muted ? ' sgd-pw-row-muted' : ''}" style="border-left-color:${style.color};background:${style.bg};"
       href="${sgdPwEscape(it.link)}" target="_blank" rel="noopener noreferrer"
       title="${sgdPwEscape(it.id)} · ${sgdPwEscape(it.subject)}">
      <span class="sgd-pw-badge sgd-pw-badge-days" title="Dias em aberto">📅 ${diasLabel}</span>${n2Tag(it)} · ${sgdPwEscape(it.subject)}
    </a>`
  }

  // Cabeçalho de grupo com contador: "{icon} {label} {count} {faixa de horas}".
  // Clicável — recolhe/expande a lista de chamados daquela faixa (o contador
  // continua visível mesmo recolhido, só a listagem some).
  const renderGroupHeader = (tier, meta, style, itemCount, extraNote, collapsed) => `
    <div class="sgd-pw-grp" data-tier="${sgdPwEscape(tier)}" style="color:${style.color};" role="button" tabindex="0" aria-expanded="${!collapsed}">
      <span class="sgd-pw-grp-toggle">${collapsed ? '▸' : '▾'}</span>
      <span class="sgd-pw-grp-label">${meta.icon} ${sgdPwEscape(meta.label)}</span>
      <span class="sgd-pw-grp-count">${itemCount}</span>
      <span class="sgd-pw-grp-range">${sgdPwEscape(meta.rangeLabel)}${
        extraNote ? ` ${extraNote}` : ''
      }</span>
    </div>`

  let separatorAdded = false
  PENDING_SLA_ALL_ORDER.forEach(tier => {
    const g = groups[tier]
    if (!g || g.length === 0) return
    const meta = g[0].c
    const style = resolveTierStyle(meta)
    const isAttention = meta.rank >= countMinRank
    const collapsed = pendingWidgetCollapsedTiers.has(tier)

    if (!isAttention && !separatorAdded) {
      html += `<div class="sgd-pw-sep"></div>`
      separatorAdded = true
    }

    html += renderGroupHeader(
      tier,
      meta,
      style,
      g.length,
      isAttention
        ? undefined
        : '<span style="font-weight:500;opacity:.8;">(informativo)</span>',
      collapsed
    )
    if (!collapsed) {
      g.forEach(({ it }) => {
        html += renderRow(it, meta, style, !isAttention)
      })
    }
  })

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
    // Notificação só usa a faixa ATIVA quando o alerta está ligado; desligado
    // (checkbox "Não alertar"), nunca escalona, não importa a faixa guardada.
    const minRank = cfg.alertDisabled
      ? 99
      : pendingAlertTierToMinRank(cfg.alertTier)
    const wrap0 = await ensurePendingWidgetDom()

    wrap0.classList.toggle('sgd-pw-light', !cfg.darkMode)
    const cbDarkMode = wrap0.querySelector('.sgd-pw-dark-mode')
    if (cbDarkMode) cbDarkMode.checked = cfg.darkMode

    const cbAlertDisabled = wrap0.querySelector('.sgd-pw-alert-disabled')
    if (cbAlertDisabled) cbAlertDisabled.checked = cfg.alertDisabled
    const alertBlock = wrap0.querySelector('.sgd-pw-alert-block')
    if (alertBlock) alertBlock.style.display = cfg.alertDisabled ? 'none' : ''
    const openAllBlock = wrap0.querySelector('.sgd-pw-openall-block')
    if (openAllBlock) openAllBlock.style.display = cfg.alertDisabled ? '' : 'none'

    const tierSelect = wrap0.querySelector('.sgd-pw-alert-tier')
    if (tierSelect && tierSelect.value !== cfg.alertTier) {
      tierSelect.value = cfg.alertTier
    }
    const openAllSelect = wrap0.querySelector('.sgd-pw-openall-tier')
    if (openAllSelect && openAllSelect.value !== cfg.openAllTier) {
      openAllSelect.value = cfg.openAllTier
    }
    const cbIncludeLower = wrap0.querySelector('.sgd-pw-include-lower')
    if (cbIncludeLower) cbIncludeLower.checked = cfg.includeLowerTiers
    // Essa opção só faz sentido quando a faixa ATIVA (a que de fato conta pra
    // notificar/abrir) está abaixo de 30h — acima disso não há nada "abaixo
    // de 30h" pra incluir, então escondemos a linha inteira.
    const includeLowerRow = wrap0.querySelector('.sgd-pw-include-lower-row')
    if (includeLowerRow) {
      const activeTierKey = getPendingWidgetActiveTier(cfg)
      const activeRank = pendingAlertTierToMinRank(activeTierKey)
      const belowNotice = activeRank < PENDING_SLA_TIERS.notice.rank
      includeLowerRow.style.display = belowNotice ? '' : 'none'
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

    // Decide se dispara/acompanha a rajada de piscar. 3 casos:
    // 1) Cruzamento novo NESTE ciclo (nesta guia) → rajada cheia (5min) + som.
    // 2) Sem cruzamento novo, mas ainda não visto (hasNew) e "repetir" ligado
    //    e já passou o intervalo (~1h) → lembrete periódico: rajada cheia + som.
    // 3) Sem cruzamento novo, ainda não visto, mas a rajada original (de
    //    OUTRA guia/ciclo) ainda está dentro da janela de 5min → esta guia só
    //    ACOMPANHA o piscar pelo tempo que falta, SEM som (ex.: usuário abriu
    //    uma guia nova do SGD enquanto o alerta ainda estava "ativo").
    let doBurst = escalated > 0
    let burstDuration = PENDING_WIDGET_BURST_MS
    let playSound = escalated > 0
    let isNewOrigin = escalated > 0

    if (!doBurst && hasNew) {
      const st = await chrome.storage.local.get([PENDING_WIDGET_LAST_BURST_KEY])
      const last = st[PENDING_WIDGET_LAST_BURST_KEY] || 0
      const elapsed = last > 0 ? Date.now() - last : Infinity

      if (cfg.repeat && elapsed >= PENDING_WIDGET_REPEAT_MS) {
        doBurst = true
        burstDuration = PENDING_WIDGET_BURST_MS
        playSound = true
        isNewOrigin = true
      } else if (elapsed < PENDING_WIDGET_BURST_MS) {
        doBurst = true
        burstDuration = PENDING_WIDGET_BURST_MS - elapsed
        playSound = false
        isNewOrigin = false
      }
    }

    if (doBurst) {
      triggerPendingWidgetBurst(wrap0, burstDuration)
      if (isNewOrigin) await markPendingWidgetBurstOrigin()
      if (playSound && cfg.sound) playPendingBeep()
    }
  } catch (error) {
    console.error('PendingWidget: erro ao atualizar o widget:', error)
  }
}

/**
 * Mostra (uma única vez por usuário) um aviso informando que o Alerta de
 * Pendências passou a vir HABILITADO por padrão a partir de 2026-07-21 — a
 * pedido do Patrick, pra ninguém ser pego de surpresa pela mudança de
 * padrão. Só dispara pra quem NUNCA setou explicitamente
 * `enablePendingWidget` (ou seja, está usando o novo padrão "de fábrica",
 * seja instalação antiga ou nova); quem já ligou/desligou de propósito não
 * vê o aviso. Controlado pela flag `pendingWidgetDefaultOnNotified`, gravada
 * assim que o aviso é exibido, pra não repetir a cada carregamento.
 */
async function maybeNotifyPendingWidgetDefaultOn() {
  try {
    if (typeof getSettings !== 'function') return
    const settings = await getSettings()
    const p = settings?.preferences || {}
    const neverSetExplicitly = p.enablePendingWidget === undefined
    const alreadyNotified = p.pendingWidgetDefaultOnNotified === true
    if (!neverSetExplicitly || alreadyNotified) return

    if (typeof showNotification === 'function') {
      showNotification(
        '🚨 O Alerta de Pendências (widget lateral) agora vem habilitado por padrão. Pra desabilitar, abra a guia Pendências e clique em "Alerta", ou use a engrenagem (⚙️) do próprio widget.',
        'info',
        10000
      )
    }
    await savePendingWidgetPref('pendingWidgetDefaultOnNotified', true)
  } catch (e) {
    /* silencioso */
  }
}

/**
 * Inicializa o widget no carregamento da página (se a preferência permitir).
 */
async function initPendingWidget() {
  await maybeNotifyPendingWidgetDefaultOn()
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
