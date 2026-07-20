/**
 * @file pending-service.js
 * Serviço responsável por extrair e processar os dados de pendências do SGD.
 */

/**
 * URL da página de filtro de listas do SGD.
 */
const PENDING_ITEMS_URL =
  'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html'

const HOLIDAYS = new Set([
  '01-01',
  '04-21',
  '05-01',
  '09-07',
  '10-12',
  '11-02',
  '11-15',
  '11-20',
  '12-25'
])

function isBusinessDay(date) {
  const d = new Date(date)
  const day = d.getDay()
  if (day === 0 || day === 6) return false
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const key = `${mm}-${dd}`
  return !HOLIDAYS.has(key)
}

function calculateBusinessTimeMs(startTs, endTs) {
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return 0
  if (endTs <= startTs) return 0
  const dayMs = 24 * 60 * 60 * 1000
  let sum = 0
  const startDay = new Date(startTs)
  startDay.setHours(0, 0, 0, 0)
  let cur = startDay.getTime()
  while (cur < endTs) {
    const dayStart = cur
    const dayEnd = dayStart + dayMs
    const overlapStart = Math.max(startTs, dayStart)
    const overlapEnd = Math.min(endTs, dayEnd)
    if (overlapEnd > overlapStart && isBusinessDay(dayStart)) {
      sum += overlapEnd - overlapStart
    }
    cur = dayEnd
  }
  return sum
}

/**
 * Definição ÚNICA da régua de status das pendências (fonte de verdade
 * compartilhada entre o card do painel, o widget lateral e o alerta 🚨).
 *
 * Os limiares (minHours) são medidos em HORAS ÚTEIS (ver
 * calculateBusinessTimeMs). Cada faixa tem dois atributos independentes:
 * - `countable`: entra na contagem/agrupamento de "atenção" do widget e no
 *   "Abrir Xh+". As duas faixas mais baixas (Recente e No prazo) são
 *   apenas informativas: NÃO contam, NÃO abrem e NÃO notificam.
 * - `notify`: pode gerar uma notificação (piscar/bipar) ao ser alcançada.
 *   "Atrasado" (72h+) é `countable` (segue contando/abrindo) mas NÃO
 *   notifica mais — já passou do prazo, não há novo alerta a dar.
 *
 * rank cresce com a gravidade (0 = recente ... 7 = atrasado), usado para
 * ordenar as faixas e para detectar quando uma SSC "sobe" de faixa (só sobe
 * gera notificação; nunca ao cair, ex.: reset por novo trâmite).
 */
const PENDING_SLA_TIERS = {
  fatal: {
    rank: 7,
    icon: '☠️',
    label: 'Atrasado',
    minHours: 72,
    countable: true,
    notify: false, // já passou do prazo: não gera nova notificação
    color: '#7f1d1d',
    bg: '#fef2f2'
  },
  estourado: {
    rank: 6,
    icon: '💣',
    label: 'Estourado',
    minHours: 48,
    countable: true,
    notify: true,
    color: '#dc2626',
    bg: '#fef2f2'
  },
  urgent: {
    rank: 5,
    icon: '🧨',
    label: 'Urgente',
    minHours: 46,
    countable: true,
    notify: true,
    color: '#ea580c',
    bg: '#fff7ed'
  },
  critical: {
    rank: 4,
    icon: '🔥',
    label: 'Crítico',
    minHours: 42,
    countable: true,
    notify: true,
    color: '#f97316',
    bg: '#fff7ed'
  },
  warning: {
    rank: 3,
    icon: '⏳',
    label: 'Atenção',
    minHours: 36,
    countable: true,
    notify: true,
    color: '#f59e0b',
    bg: '#fffbeb'
  },
  notice: {
    rank: 2,
    icon: '👀',
    label: 'Fique atento',
    minHours: 30,
    countable: true,
    notify: true,
    color: '#65a30d',
    bg: '#f7fee7'
  },
  'no-prazo': {
    rank: 1,
    icon: '🕓',
    label: 'No prazo',
    minHours: 24,
    countable: false,
    notify: false,
    color: '#3b82f6',
    bg: '#eff6ff'
  },
  recente: {
    rank: 0,
    icon: '✅',
    label: 'Recente',
    minHours: 0,
    countable: false,
    notify: false,
    color: '#3b82f6',
    bg: '#eff6ff'
  }
}

/**
 * Calcula e grava `rangeLabel` em cada faixa (ex.: "30h a <36h", "72h+"), a
 * partir do minHours da PRÓPRIA faixa e do minHours da PRÓXIMA faixa acima —
 * assim o texto nunca fica dessincronizado dos limiares acima.
 */
;(function computeSlaRangeLabels(tiers) {
  const ascending = Object.keys(tiers).sort((a, b) => tiers[a].rank - tiers[b].rank)
  ascending.forEach((key, idx) => {
    const meta = tiers[key]
    const nextKey = ascending[idx + 1]
    if (!nextKey) {
      meta.rangeLabel = `${meta.minHours}h+`
    } else if (idx === 0) {
      meta.rangeLabel = `<${tiers[nextKey].minHours}h`
    } else {
      meta.rangeLabel = `${meta.minHours}h a <${tiers[nextKey].minHours}h`
    }
  })
})(PENDING_SLA_TIERS)

/**
 * Ordem das faixas "countable" (mais grave primeiro), usada para agrupar e
 * contar as pendências em atenção no widget lateral e no botão "Abrir Xh+".
 */
const PENDING_SLA_COUNTABLE_ORDER = [
  'fatal',
  'estourado',
  'urgent',
  'critical',
  'warning',
  'notice'
]

/**
 * Ordem das faixas informativas (fora da contagem/alerta), mais alta primeiro.
 */
const PENDING_SLA_INFORMATIVE_ORDER = ['no-prazo', 'recente']

/**
 * Menor limiar considerado "faixa de atenção" (entra na contagem e pode
 * notificar). Derivado da menor faixa contável, para não repetir o número
 * mágico 30.
 */
const PENDING_SLA_ATTENTION_MIN_HOURS = Math.min(
  ...Object.values(PENDING_SLA_TIERS)
    .filter(t => t.countable)
    .map(t => t.minHours)
)

/**
 * Extrai as horas (úteis) desde o último trâmite de uma pendência.
 * Prefere o valor preciso (hoursSinceUpdate); se só houver a estimativa em
 * dias (usuário comum / SSC antiga), converte para horas aproximadas.
 * @param {object} item
 * @returns {number|null} horas, ou null se não houver como estimar.
 */
function getPendingHoursSinceUpdate(item) {
  if (item && Number.isFinite(item.hoursSinceUpdate)) {
    return item.hoursSinceUpdate
  }
  if (item && Number.isFinite(item.estimatedDaysSinceUpdate)) {
    return item.estimatedDaysSinceUpdate * 24
  }
  return null
}

/**
 * Classifica uma pendência em uma faixa de SLA (fonte de verdade única).
 * @param {object} item - Item de pendência (usa hoursSinceUpdate/estimated).
 * @returns {{tier:string, rank:number, icon:string, label:string,
 *   countable:boolean, color:string, bg:string, hours:(number|null),
 *   rangeLabel:string}}
 */
function classificarSlaPendencia(item) {
  const hours = getPendingHoursSinceUpdate(item)
  let tierKey = 'no-prazo'

  if (hours !== null) {
    const h = Math.floor(hours)
    if (h >= PENDING_SLA_TIERS.fatal.minHours) tierKey = 'fatal'
    else if (h >= PENDING_SLA_TIERS.estourado.minHours) tierKey = 'estourado'
    else if (h >= PENDING_SLA_TIERS.urgent.minHours) tierKey = 'urgent'
    else if (h >= PENDING_SLA_TIERS.critical.minHours) tierKey = 'critical'
    else if (h >= PENDING_SLA_TIERS.warning.minHours) tierKey = 'warning'
    else if (h >= PENDING_SLA_TIERS.notice.minHours) tierKey = 'notice'
    else if (h >= PENDING_SLA_TIERS['no-prazo'].minHours) tierKey = 'no-prazo'
    else tierKey = 'recente'
  }

  const meta = PENDING_SLA_TIERS[tierKey]

  return {
    tier: tierKey,
    rank: meta.rank,
    icon: meta.icon,
    label: meta.label,
    countable: meta.countable,
    notify: meta.notify,
    color: meta.color,
    bg: meta.bg,
    hours,
    rangeLabel: meta.rangeLabel
  }
}

/**
 * Indica se a pendência está em faixa de atenção (>=30h úteis): entra na
 * contagem do widget e pode sinalizar o usuário. Itens "No prazo" retornam false.
 * @param {object} item
 * @returns {boolean}
 */
function isPendenciaEmAtencao(item) {
  return classificarSlaPendencia(item).countable === true
}

// Mapa persistido {sscId: rank} do ÚLTIMO tier conhecido de cada pendência,
// usado para detectar quando uma SSC "sobe" para faixa de atenção (>=30h).
const PENDING_TIER_RANKS_KEY = 'pendingTierRanks'
// Flag persistida: há pelo menos uma SSC que acabou de cruzar para atenção e
// ainda não foi vista pelo usuário (o widget usa isso para tremer/piscar 🚨).
const PENDING_WIDGET_HAS_NEW_KEY = 'pendingWidgetHasNew'

/**
 * Avalia, a cada ciclo, quais pendências SUBIRAM para uma NOVA faixa desde a
 * última verificação (ex.: 24h → 30h → 36h → 42h → 46h → 48h → 72h). Gera uma
 * notificação a cada faixa nova alcançada — não só na primeira vez que entra
 * na "zona de atenção" — mas nunca duas vezes na mesma faixa (a pendência
 * pode ficar horas parada em "Atenção" sem repetir o alerta) e nunca ao CAIR
 * de faixa (ex.: novo trâmite reseta o relógio). Faixas com `notify:false`
 * (Recente, No prazo, Atrasado) nunca disparam alerta, mesmo que a pendência
 * "suba" para elas. Persiste o mapa de ranks e, se houve alguma faixa nova
 * notificável, marca a flag que faz o widget sinalizar. NÃO sinaliza no
 * primeiro povoamento (baseline), para não alertar sobre pendências que já
 * estavam antigas na instalação.
 *
 * @param {Array<object>} items - Pendências atuais do usuário (todas as faixas).
 * @param {number} [alertMinRank] - Rank mínimo (faixa) a partir do qual
 *   notificar. Padrão = rank de "Fique atento" (30h); o usuário pode ajustar
 *   para uma faixa inferior ou superior. Use um valor alto (ex.: 99) para
 *   NÃO alertar em nenhuma faixa (só contagem).
 * @returns {Promise<{escalatedIds:string[], hasNew:boolean}>}
 */
async function evaluatePendingEscalation(items, alertMinRank) {
  try {
    const minRank = Number.isFinite(alertMinRank)
      ? alertMinRank
      : PENDING_SLA_TIERS.notice.rank
    const currentItems = Array.isArray(items) ? items : []
    const storage = await chrome.storage.local.get([
      PENDING_TIER_RANKS_KEY,
      PENDING_WIDGET_HAS_NEW_KEY
    ])
    const prevRanks = storage[PENDING_TIER_RANKS_KEY]
    const isBaseline = !prevRanks || typeof prevRanks !== 'object'
    const prev = isBaseline ? {} : prevRanks

    const currentRanks = {}
    const escalatedIds = []

    currentItems.forEach(item => {
      const classification = classificarSlaPendencia(item)
      const { rank, tier } = classification
      currentRanks[item.id] = rank
      if (isBaseline) return
      const prevRank = Object.prototype.hasOwnProperty.call(prev, item.id)
        ? prev[item.id]
        : 0
      const tierMeta = PENDING_SLA_TIERS[tier]
      const tierNotifies = tierMeta ? tierMeta.notify !== false : true
      // Só notifica ao SUBIR de faixa (nunca ao cair) e apenas se a NOVA
      // faixa notificar e atingir o rank mínimo escolhido pelo usuário.
      if (rank > prevRank && rank >= minRank && tierNotifies) {
        escalatedIds.push(item.id)
      }
    })

    const toSave = { [PENDING_TIER_RANKS_KEY]: currentRanks }
    let hasNew = storage[PENDING_WIDGET_HAS_NEW_KEY] === true
    if (escalatedIds.length > 0) {
      hasNew = true
      toSave[PENDING_WIDGET_HAS_NEW_KEY] = true
    }
    await chrome.storage.local.set(toSave)

    return { escalatedIds, hasNew }
  } catch (error) {
    console.error('PendingService: erro ao avaliar cruzamento de SLA:', error)
    return { escalatedIds: [], hasNew: false }
  }
}

/**
 * Limpa a flag de "nova pendência em atenção" (o widget para de piscar).
 * Chamado quando o usuário abre/expande o widget ou a guia de pendências.
 */
async function clearPendingWidgetHasNew() {
  try {
    await chrome.storage.local.set({ [PENDING_WIDGET_HAS_NEW_KEY]: false })
  } catch (error) {
    console.error('PendingService: erro ao limpar flag do widget:', error)
  }
}

/**
 * Remove elementos span ocultos e retorna o texto limpo.
 * @param {HTMLElement} cell - A célula da tabela.
 * @returns {string} Texto limpo.
 */
function cleanDateText(cell) {
  if (!cell) return ''
  const clone = cell.cloneNode(true)
  const spans = clone.querySelectorAll('span')
  spans.forEach(span => span.remove())
  return clone.innerText.trim().replace(/\s+/g, ' ')
}

/**
 * Recupera o mapa de tempos de chegada do storage.
 */
async function getPendingArrivalTimes() {
  const result = await chrome.storage.local.get(['pendingArrivalTimes'])
  return result.pendingArrivalTimes || {}
}

/**
 * Salva o mapa de tempos de chegada.
 */
async function savePendingArrivalTimes(timesMap) {
  await chrome.storage.local.set({ pendingArrivalTimes: timesMap })
}

/**
 * Busca e processa a lista de pendências.
 * @returns {Promise<Array<object>>} Uma promessa que resolve com um array de objetos de pendência.
 */
function getFiltroParam(url) {
  if (!url) return null
  const match = url.match(/[?&]filtro=(\d+)/)
  return match ? match[1] : null
}

function parsePendingPage(doc, arrivalTimes, now, arrivalTimesState) {
  const dataTable = doc.querySelector('table.tablesorter')

  if (!dataTable) {
    const passwordInput = doc.querySelector('input[type="password"]')
    const loginForm =
      doc.querySelector('form[action*="login"]') ||
      doc.querySelector('#login-form')

    if (passwordInput || loginForm) {
      throw new Error('Você não está logado no SGD. Por favor, faça login.')
    }

    const errorMsg = doc.querySelector(
      '.ui-messages-error-summary, .erro'
    )?.innerText
    if (errorMsg) {
      throw new Error(`Erro no SGD: ${errorMsg.trim()}`)
    }

    console.warn(
      'PendingService: Tabela não encontrada e não parece ser login. Layout pode ter mudado.'
    )
    return { items: [], siteFilter: { active: false, name: null } }
  }

  // Identificar índice da coluna "Responsável"
  let responsibleColIndex = -1
  const headers = dataTable.querySelectorAll('thead th')
  headers.forEach((th, index) => {
    if (th.innerText.toLowerCase().includes('responsável')) {
      responsibleColIndex = index
    }
  })

  // Detectar Filtro do Site Ativo (Session State)
  const filterIds = [
    { id: 'filtrosForm:responsavel', label: 'Responsável', default: '0' },
    { id: 'filtrosForm:sistema', label: 'Sistema', default: '0' },
    { id: 'filtrosForm:modulo', label: 'Módulo', default: '0' },
    { id: 'filtrosForm:topicoSuporte', label: 'Tópico', default: '0' },
    { id: 'filtrosForm:situacao', label: 'Situação', default: '0' },
    {
      id: 'filtrosForm:classificacaoSSC',
      label: 'Classificação',
      default: '0'
    },
    { id: 'filtrosForm:meioAcesso', label: 'Meio de Acesso', default: '0' },
    { id: 'filtrosForm:origem', label: 'Subtópico', default: '0' },
    {
      id: 'filtrosForm:palavraChave',
      label: 'Palavra-chave',
      type: 'text',
      default: ''
    }
  ]

  const siteFilter = {
    active: false,
    name: null
  }

  const activeFilters = []

  filterIds.forEach(f => {
    const el = doc.getElementById(f.id)
    if (el) {
      const val = el.value
      // Verifica se o valor é diferente do padrão
      if (val && val !== f.default) {
        let isReallyActive = false
        if (f.type === 'text') {
          isReallyActive = val.trim() !== ''
        } else {
          // Para selects com "selected" explícito no HTML estático ou valor atual
          const selectedOption = el.querySelector(`option[value="${val}"]`)
          // Se tiver selected ou o valor for diferente do default (assumindo value do select correto)
          if (
            (selectedOption && selectedOption.hasAttribute('selected')) ||
            val !== '0'
          ) {
            isReallyActive = true
          }
        }

        if (isReallyActive) {
          // Exceção para Responsável: Se houver apenas 1 opção (além de Todos), não considerar filtro ativo
          // Pois o usuário provavelmente não tem permissão para ver outros
          if (f.id === 'filtrosForm:responsavel') {
            const options = el.querySelectorAll('option')
            if (options.length <= 2) {
              isReallyActive = false
            }
          }
        }

        if (isReallyActive) {
          let label = f.label

          if (f.type === 'text') {
            if (val.trim()) label += `: "${val.trim()}"`
          } else {
            // Para selects, tenta pegar o texto da option selecionada
            const selectedOption = el.querySelector(`option[value="${val}"]`)
            if (selectedOption) {
              label += `: ${selectedOption.innerText.trim()}`
            }
          }

          activeFilters.push(label)
        }
      }
    }
  })

  if (activeFilters.length > 0) {
    siteFilter.active = true
    siteFilter.name =
      activeFilters.length === 1
        ? activeFilters[0]
        : `${activeFilters.length} filtros ativos`
  }

  const rows = dataTable.querySelectorAll('tbody > tr')
  const pendingItems = []

  rows.forEach(row => {
    const cells = row.cells

    if (cells.length < 13) return

    try {
      // ID: Coluna 0
      const id = cells[0].innerText.trim()

      // Verifica se a pendência é prioritária
      const isPrioritaria =
        cells[0].classList.contains('tableListaRowWarningBlue') ||
        cells[0].classList.contains('tableListaRowWarning')

      // Data Abertura: Coluna 1 (Limpa spans ocultos)
      const dataAbertura = cleanDateText(cells[1])

      // Dias: Coluna 2
      const dias = cells[2].innerText.trim()

      // Último Trâmite: Coluna 3 (Limpa spans ocultos)
      const dataUltimoTramite = cleanDateText(cells[3])

      // Qtd Trâmites: Coluna 4
      const qtdTramites = cells[4].innerText.trim()

      // --- DETECÇÃO DE NOVO TRÂMITE PARA RESET DE TEMPO ---
      if (arrivalTimes[id]) {
        let record = arrivalTimes[id]

        // Migração de legado (se for apenas número) ou inicialização de objeto
        if (typeof record !== 'object') {
          record = {
            ts: record,
            precise: true,
            lastTramiteDate: dataUltimoTramite
          }
          arrivalTimes[id] = record
          arrivalTimesState.changed = true
        } else {
          // FIX: Recuperação de Desastre (Healer)
          if (record.precise && now - record.ts < 1000 * 60 * 60) {
            const matches = [
              ...(record.lastTramiteDate || '').matchAll(
                /(\d{2})\/(\d{2})\/(\d{4})/g
              )
            ]

            if (matches.length > 0) {
              let maxTramTs = 0
              for (const m of matches) {
                const d = parseInt(m[1], 10)
                const mo = parseInt(m[2], 10) - 1
                const y = parseInt(m[3], 10)
                const t = new Date(y, mo, d).getTime()
                if (t > maxTramTs) maxTramTs = t
              }

              if (now - maxTramTs > 24 * 60 * 60 * 1000) {
                record.ts = maxTramTs
                record.precise = false
                arrivalTimesState.changed = true
              }
            }
          }

          const currentDate = dataUltimoTramite

          if (record.lastTramiteDate === undefined) {
            record.lastTramiteDate = currentDate
            arrivalTimesState.changed = true
          } else if (record.lastTramiteDate !== currentDate) {
            record.ts = now
            record.precise = true
            record.lastTramiteDate = currentDate
            arrivalTimesState.changed = true
          }
        }
      }

      // --- CÁLCULO DE SLA APRIMORADO COM PRECISÃO ---
      let hoursSinceUpdate = null
      let timePrecision = null
      let estimatedDaysSinceUpdate = null

      if (arrivalTimes[id]) {
        const record = arrivalTimes[id]
        const arrivalTs =
          typeof record === 'object' && record?.ts ? record.ts : record
        const isPrecise = typeof record === 'object' ? !!record.precise : true
        const businessMs = calculateBusinessTimeMs(arrivalTs, now)

        if (isPrecise) {
          hoursSinceUpdate = Math.max(0, businessMs / (1000 * 60 * 60))
          timePrecision = 'preciso'
          estimatedDaysSinceUpdate = Math.max(
            0,
            Math.floor(businessMs / (1000 * 60 * 60 * 24))
          )
        } else {
          estimatedDaysSinceUpdate = Math.max(
            0,
            Math.floor(businessMs / (1000 * 60 * 60 * 24))
          )
          timePrecision = 'estimado'
        }
      } else {
        const m = (dataUltimoTramite || '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
        if (m) {
          const d = parseInt(m[1], 10)
          const mo = parseInt(m[2], 10) - 1
          const y = parseInt(m[3], 10)
          const tramiteTs = new Date(y, mo, d).getTime()
          const businessMs = calculateBusinessTimeMs(tramiteTs, now)
          estimatedDaysSinceUpdate = Math.max(
            0,
            Math.floor(businessMs / (1000 * 60 * 60 * 24))
          )
          timePrecision = 'estimado'
        }
      }

      // Assunto e Link
      const anchor = cells[5].querySelector('a')
      let subject = 'Sem assunto'
      let link = '#'

      if (anchor) {
        subject = anchor.innerText.trim()
        const href = anchor.getAttribute('href')
        if (href) {
          link = href.startsWith('http')
            ? href
            : `https://sgd.dominiosistemas.com.br${href.startsWith('/') ? '' : '/sgpub/faces/'}${href}`
        }
      }

      // Responsável
      let responsible = 'Desconhecido'
      if (responsibleColIndex > -1 && cells[responsibleColIndex]) {
        responsible = cells[responsibleColIndex].innerText.trim()
      }

      // Em SS
      const rowStyle = (row.getAttribute('style') || '').toLowerCase()
      const anchorStyle = anchor
        ? (anchor.getAttribute('style') || '').toLowerCase()
        : ''
      const isEmSS =
        rowStyle.includes('color: red') || anchorStyle.includes('color: red')

      // Status
      let status = 'Desconhecido'
      const imgStatus = cells[12].querySelector('img')
      if (imgStatus) {
        status = imgStatus.getAttribute('title') || 'Status indefinido'
      } else {
        status = cells[12].innerText.trim() || 'Sem status'
      }

      pendingItems.push({
        id,
        dataAbertura,
        dias,
        dataUltimoTramite,
        qtdTramites,
        subject,
        link,
        status,
        responsible,
        isPrioritaria,
        isEmSS,
        hoursSinceUpdate,
        timePrecision,
        estimatedDaysSinceUpdate
      })
    } catch (err) {}
  })

  return { items: pendingItems, siteFilter }
}

/**
 * Busca e processa a lista de pendências.
 * @returns {Promise<object>} Uma promessa que resolve com um objeto contendo os itens e informações de abas.
 */
/**
 * Busca as pendências do usuário. Delegador para a nova fonte (sscs.html),
 * que serializa TODAS as buscas pelo SgdRequestCoordinator. Mantém a assinatura
 * antiga para que os consumidores (info-panel, badge do FAB, alarme de 15 min)
 * sigam funcionando sem alteração.
 * @param {object} [opts] - { force, maxAgeMs } repassados ao coordenador.
 */
async function fetchPendingItems(opts = {}) {
  return fetchSscPendingItems(opts)
}

/**
 * @deprecated Fonte ANTIGA (filtro-listas.html), descontinuada em favor da
 * sscs.html. Mantida apenas para referência/rollback; não é mais chamada.
 */
async function fetchPendingItemsLegacy() {
  try {
    // 1. Carrega os tempos precisos salvos
    const arrivalTimes = await getPendingArrivalTimes()
    const arrivalTimesState = { changed: false }
    const now = Date.now()

    const response = await fetch(PENDING_ITEMS_URL, {
      credentials: 'include', // Envia cookies de sessão
      cache: 'no-cache'
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'Sessão expirada. Por favor, faça login novamente no SGD.'
        )
      }
      throw new Error(`Erro ao acessar o SGD: ${response.status}`)
    }

    const htmlText = await response.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlText, 'text/html')

    // Parse the current page
    const primaryResult = parsePendingPage(doc, arrivalTimes, now, arrivalTimesState)

    // Check if multiple tabs exist
    const tabElements = doc.querySelectorAll('#navigationTab ul li')
    if (tabElements.length > 1) {
      const tabs = []
      const fetchPromises = []

      tabElements.forEach(li => {
        const anchor = li.querySelector('a')
        if (anchor) {
          const href = anchor.getAttribute('href')
          const fullUrl = href.startsWith('http') ? href : `https://sgd.dominiosistemas.com.br/sgpub/faces/${href}`
          const span = anchor.querySelector('span')
          const rawText = span ? span.innerText.replace(/\u00A0/g, ' ').trim() : anchor.innerText.trim()

          const match = rawText.match(/(.*?)\s*\((\d+)\)$/)
          const name = match ? match[1].trim() : rawText

          const isCurrent = li.id === 'current'

          const tabObj = {
            id: getFiltroParam(fullUrl) || fullUrl,
            name: name,
            url: fullUrl,
            items: isCurrent ? primaryResult.items : [],
            siteFilter: isCurrent ? primaryResult.siteFilter : { active: false, name: null },
            isCurrent: isCurrent
          }

          tabs.push(tabObj)

          if (!isCurrent) {
            fetchPromises.push(
              fetch(fullUrl, { credentials: 'include', cache: 'no-cache' })
                .then(res => {
                  if (!res.ok) throw new Error(`Erro ao buscar aba: ${res.status}`)
                  return res.text()
                })
                .then(text => {
                  const tabDoc = parser.parseFromString(text, 'text/html')
                  const tabResult = parsePendingPage(tabDoc, arrivalTimes, now, arrivalTimesState)
                  tabObj.items = tabResult.items
                  tabObj.siteFilter = tabResult.siteFilter
                })
                .catch(err => {
                  console.error(`Erro ao carregar a aba ${name}:`, err)
                })
            )
          }
        }
      })

      // Wait for all other tabs to load
      await Promise.all(fetchPromises)

      // Create "Todas" (All) tab
      // Merge all items without duplication (by id)
      const allItemsMap = new Map()
      tabs.forEach(t => {
        t.items.forEach(item => {
          if (!allItemsMap.has(item.id)) {
            allItemsMap.set(item.id, item)
          }
        })
      })
      const mergedItems = Array.from(allItemsMap.values())

      // Find if any tab has an active filter
      const anyTabHasFilter = tabs.some(t => t.siteFilter.active)
      let combinedFilterName = null
      if (anyTabHasFilter) {
        const filters = tabs
          .filter(t => t.siteFilter.active)
          .map(t => `${t.name}: ${t.siteFilter.name}`)
        combinedFilterName = filters.join(' | ')
      }

      const allTabObj = {
        id: 'all',
        name: 'Todas',
        url: null,
        items: mergedItems,
        siteFilter: { active: anyTabHasFilter, name: combinedFilterName }
      }

      const finalTabs = [allTabObj, ...tabs]

      if (arrivalTimesState.changed) {
        await savePendingArrivalTimes(arrivalTimes)
      }

      return {
        items: mergedItems, // For backwards compatibility
        siteFilter: allTabObj.siteFilter, // For backwards compatibility
        tabs: finalTabs
      }
    } else {
      if (arrivalTimesState.changed) {
        await savePendingArrivalTimes(arrivalTimes)
      }
      return {
        items: primaryResult.items,
        siteFilter: primaryResult.siteFilter,
        tabs: null
      }
    }
  } catch (error) {
    throw error
  }
}

async function resetSiteFilter(targetUrl) {
  const currentUrl = window.location.href
  const targetFiltro = targetUrl ? getFiltroParam(targetUrl) : null
  const currentFiltro = getFiltroParam(currentUrl)

  const isOnTargetPage =
    currentUrl.includes('filtro-listas.html') &&
    (!targetFiltro || targetFiltro === currentFiltro)

  if (isOnTargetPage) {
    const filterIds = [
      'filtrosForm:responsavel',
      'filtrosForm:sistema',
      'filtrosForm:modulo',
      'filtrosForm:topicoSuporte',
      'filtrosForm:situacao',
      'filtrosForm:classificacaoSSC',
      'filtrosForm:meioAcesso',
      'filtrosForm:origem'
    ]

    // 1. Reseta Selects (sem disparar eventos change para evitar enfileiramento AJAX do JSF/RichFaces)
    filterIds.forEach(id => {
      const select = document.getElementById(id)
      if (select) {
        select.value = '0'
        select.selectedIndex = 0
      }
    })

    // 2. Reseta Input Texto
    const textInput = document.getElementById('filtrosForm:palavraChave')
    if (textInput) {
      textInput.value = ''
    }

    // 3. Clica em Pesquisar/Atualizar
    const btn =
      document.getElementById('filtrosForm:atualizarBtn') ||
      document.querySelector('button[id*="pesquisar"]') ||
      document.querySelector('input[type="submit"][value*="Pesquisar"]') ||
      document.querySelector('a[onclick*="pesquisar"]') ||
      document.getElementById('filtrosForm:pesquisar')

    if (btn) {
      await new Promise(r => setTimeout(r, 250)) // Delay para estabilizar

      const form = btn.form || document.getElementById('filtrosForm')
      if (form) {
        console.log('[SGD - PowerTools] Submetendo formulário com campo oculto para JSF...')
        let hiddenInput = form.querySelector(`input[name="${btn.name}"]`)
        if (!hiddenInput) {
          hiddenInput = document.createElement('input')
          hiddenInput.type = 'hidden'
          hiddenInput.name = btn.name
          hiddenInput.value = btn.value
          form.appendChild(hiddenInput)
        }
        form.submit()
      } else {
        btn.click()
      }
      return true
    } else {
      console.warn('Botão de pesquisar não encontrado.')
    }
  } else {
    const redirectUrl =
      targetUrl ||
      'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html'
    sessionStorage.setItem('tabsToClear', JSON.stringify([redirectUrl]))
    window.location.href = redirectUrl
    return true
  }

  return false
}

/**
 * Verifica se há novas pendências comparando com as últimas visualizadas.
 * Considera o filtro de responsável persistente definido pelo usuário.
 * @returns {Promise<{total: number, newCount: number, newItems: Array<object>}>}
 */
async function checkNewPendings() {
  try {
    const { items: currentItems } = await fetchPendingItems()

    // Recupera IDs vistos e a preferência de filtro de responsável
    const storage = await chrome.storage.local.get([
      'lastSeenPendingIds',
      'preferredResponsible',
      'pendingArrivalTimes'
    ])
    const lastSeenIds = storage.lastSeenPendingIds || []
    const arrivalTimes = storage.pendingArrivalTimes || {}
    let arrivalTimesChanged = false

    // A pílula do FAB conta apenas os itens acionáveis (N1); os de N2 (aguardando
    // outro setor) aparecem só dentro da guia. A fonte já traz só as do usuário.
    let monitoredItems = currentItems.filter(i => i.nivel === 'N1')

    // Verifica novos itens apenas dentro do conjunto monitorado
    const newItems = monitoredItems.filter(
      item => !lastSeenIds.includes(item.id)
    )

    // REGISTRO DE TIMESTAMP COM ADOÇÃO INTELIGENTE (Preciso/Estimado)
    const now = Date.now()
    const parseDMY = str => {
      // sscs.html usa ano com 2 dígitos (ex.: 16/07/26); aceitamos 2 ou 4.
      const m = (str || '').match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
      if (!m) return null
      const d = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10) - 1
      let y = parseInt(m[3], 10)
      if (y < 100) y += 2000
      const dt = new Date(y, mo, d)
      return dt.getTime()
    }

    currentItems.forEach(item => {
      // Se é um item novo (nunca visto antes), salvamos o timestamp de chegada com a regra de adoção inteligente
      if (!arrivalTimes[item.id] && !lastSeenIds.includes(item.id)) {
        const tramiteTs = parseDMY(item.dataUltimoTramite)
        if (tramiteTs) {
          const diffMs = now - tramiteTs
          if (diffMs < 60 * 60 * 1000) {
            // Cenário Recente: preciso
            arrivalTimes[item.id] = {
              ts: now,
              precise: true,
              lastTramiteDate: item.dataUltimoTramite
            }
          } else {
            // Cenário Retroativo: estimado (offline)
            arrivalTimes[item.id] = {
              ts: tramiteTs,
              precise: false,
              lastTramiteDate: item.dataUltimoTramite
            }
          }
        } else {
          // Fallback: quando não foi possível extrair a data, considera preciso no momento
          arrivalTimes[item.id] = {
            ts: now,
            precise: true,
            lastTramiteDate: item.dataUltimoTramite
          }
        }
        arrivalTimesChanged = true
      }
    })

    // Limpeza de IDs antigos
    if (currentItems.length > 0) {
      const currentIdsSet = new Set(currentItems.map(i => i.id))
      Object.keys(arrivalTimes).forEach(storedId => {
        if (!currentIdsSet.has(storedId)) {
          delete arrivalTimes[storedId]
          arrivalTimesChanged = true
        }
      })
    }

    if (arrivalTimesChanged) {
      await savePendingArrivalTimes(arrivalTimes)
    }

    // O total exibido na notificação deve refletir o que o usuário escolheu ver
    const resultData = {
      total: monitoredItems.length,
      newCount: newItems.length,
      newItems: newItems,
      // Importante: salvamos TODOS os IDs atuais (currentItems) para evitar que,
      // ao trocar de filtro, itens antigos de outros responsáveis apareçam como novos.
      currentIds: currentItems.map(i => i.id)
    }

    await savePendingResult(resultData)
    return resultData
  } catch (error) {
    console.error('PendingService: Erro ao verificar novas pendências:', error)
    return { total: 0, newCount: 0, newItems: [], error: error.message }
  }
}

/**
 * Marca as pendências atuais como visualizadas.
 * @param {Array<string>} ids - Lista de IDs das pendências atuais.
 */
async function markPendingsAsSeen(ids) {
  if (!ids || !Array.isArray(ids)) return
  await chrome.storage.local.set({ lastSeenPendingIds: ids })
}

/**
 * Recupera o último resultado de pendências salvo no storage.
 * @returns {Promise<{total: number, newCount: number, newItems: Array<object>}|null>}
 */
async function getLastPendingResult() {
  const result = await chrome.storage.local.get(['lastPendingCheckResult'])
  return result.lastPendingCheckResult || null
}

/**
 * Salva o resultado da verificação de pendências.
 * @param {object} result
 */
async function savePendingResult(result) {
  await chrome.storage.local.set({ lastPendingCheckResult: result })
}

// --- GESTÃO DE TAGS ---

const DEFAULT_TAGS = [
  { id: 'tag-ss', name: 'Em SS', color: '#ff9800' }, // Laranja
  { id: 'tag-sa-ne', name: 'Em SA/NE', color: '#2196f3' }, // Azul
  { id: 'tag-prioridade', name: 'Prioridade', color: '#f44336' } // Vermelho
]

/**
 * Inicializa as tags no storage se não existirem.
 */
async function initializeTags() {
  const data = await chrome.storage.local.get(['pendingTags', 'pendingTagsMap'])

  if (!data.pendingTags) {
    await chrome.storage.local.set({ pendingTags: DEFAULT_TAGS })
  } else {
    // Migração de nomes antigos para novos (apenas na inicialização)
    let tags = data.pendingTags
    let changed = false

    // Migração de nomes
    tags = tags.map(t => {
      if (t.name === 'Aguardando SS') {
        t.name = 'Em SS'
        changed = true
      }
      if (t.name === 'Aguardando SA/NE') {
        t.name = 'Em SA/NE'
        changed = true
      }
      return t
    })

    // Adicionar tag "Prioridade" se não existir
    if (!tags.some(t => t.name === 'Prioridade')) {
      tags.push({ id: 'tag-prioridade', name: 'Prioridade', color: '#f44336' })
      changed = true
    }

    if (changed) {
      await chrome.storage.local.set({ pendingTags: tags })
    }
  }

  if (!data.pendingTagsMap) {
    await chrome.storage.local.set({ pendingTagsMap: {} })
  }
}

/**
 * Retorna a lista de tags disponíveis.
 * @returns {Promise<Array<{id: string, name: string, color: string}>>}
 */
async function getAvailableTags() {
  const data = await chrome.storage.local.get(['pendingTags'])
  return data.pendingTags || DEFAULT_TAGS
}

/**
 * Cria uma nova tag customizada.
 * @param {string} name Nome da tag
 * @param {string} color Cor da tag (hex)
 * @returns {Promise<object>} A tag criada
 */
async function createCustomTag(name, color) {
  const tags = await getAvailableTags()
  const newTag = {
    id: `tag-${Date.now()}`,
    name,
    color
  }
  tags.push(newTag)
  await chrome.storage.local.set({ pendingTags: tags })
  return newTag
}

/**
 * Remove uma tag customizada.
 * @param {string} tagId ID da tag a ser removida
 */
async function deleteCustomTag(tagId) {
  // Remove da lista de definições
  let tags = await getAvailableTags()
  tags = tags.filter(t => t.id !== tagId)
  await chrome.storage.local.set({ pendingTags: tags })

  // Remove referências nos itens
  const map = await getPendingTagsMap()
  let changed = false

  for (const pendingId in map) {
    if (map[pendingId].includes(tagId)) {
      map[pendingId] = map[pendingId].filter(t => t !== tagId)
      if (map[pendingId].length === 0) delete map[pendingId]
      changed = true
    }
  }

  if (changed) {
    await chrome.storage.local.set({ pendingTagsMap: map })
  }
}

/**
 * Retorna o mapa de tags associadas aos IDs de pendência.
 * @returns {Promise<object>} Mapa { pendingId: [tagId, ...] }
 */
async function getPendingTagsMap() {
  const data = await chrome.storage.local.get(['pendingTagsMap'])
  return data.pendingTagsMap || {}
}

/**
 * Alterna uma tag para uma pendência específica.
 * @param {string} pendingId ID da pendência
 * @param {string} tagId ID da tag
 * @returns {Promise<Array<string>>} Nova lista de tags para este ID
 */
async function togglePendingTag(pendingId, tagId) {
  const map = await getPendingTagsMap()
  let currentTags = map[pendingId] || []

  if (currentTags.includes(tagId)) {
    currentTags = currentTags.filter(t => t !== tagId)
  } else {
    currentTags.push(tagId)
  }

  map[pendingId] = currentTags

  // Limpeza básica: remove entradas vazias para não inflar o storage
  if (currentTags.length === 0) {
    delete map[pendingId]
  }

  await chrome.storage.local.set({ pendingTagsMap: map })
  return currentTags
}

// Inicializa as tags ao carregar o script (se não existir)
initializeTags().catch(err => console.error('Erro ao inicializar tags:', err))
