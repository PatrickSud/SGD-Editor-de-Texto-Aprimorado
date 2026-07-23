/**
 * @file ssc-pending-service.js
 * Nova fonte de dados das pendências do usuário, capturada da página
 * https://sgd.dominiosistemas.com.br/sgsc/faces/sscs.html (a mesma família de
 * grade do duplicate-checker). Substitui a fonte antiga (filtro-listas.html).
 *
 * Regras principais:
 *  - As "pendências do técnico" são as SSCs em que a COLUNA "Responsável"
 *    (td:responsavel_tecnico_*) está preenchida com o usuário (ver
 *    isMinhaSscPendencia). No SGD elas correspondem às SSCs que ele está
 *    efetivamente analisando (situação "Em Análise").
 *  - A busca no servidor filtra por Situação = Pendentes e Responsável = um id
 *    ESPECÍFICO (nunca "Todos", que devolveria o limite de 1000 da 1ª página).
 *    O id vem: (1) da escolha salva pelo usuário; (2) do único responsável real
 *    do select (técnico comum); ou (3) da seleção manual (gestor) — ver
 *    resolverResponsavelAlvo.
 *  - Todo o fluxo de rede é SEQUENCIAL e roda dentro de um único producer do
 *    SgdRequestCoordinator, garantindo que nunca haja duas requisições
 *    simultâneas na mesma sessão do SGD (nem entre abas, nem dentro da aba).
 *
 * Produz objetos no MESMO formato do modelo antigo (createPendingCard) e
 * reutiliza os helpers globais de SLA/tempo de chegada de pending-service.js.
 */

// Caminho (mesmo host da página atual) da lista de SSCs.
const SSC_PENDING_LIST_PATH = '/sgsc/faces/sscs.html'

// Filtros aplicados nos POSTs de busca (ajustáveis):
//  - Situação -3 = "Pendente Suporte Nível 1" (pendentes com o técnico) -> N1.
//  - Situação -2 = "Pendente Suporte Nível 2" (aguardando outro setor)  -> N2.
//  - Classificação 0 = "Todas" (não limita por TÉCNICA/FUNCIONAL/etc.).
const SSC_PENDING_SITUACAO_N1 = '-3'
const SSC_PENDING_SITUACAO_N2 = '-2'
const SSC_PENDING_CLASSIFICACAO = '0'

// Janela de coalescing: buscas repetidas dentro desse intervalo reutilizam o
// último resultado (uma requisição por ciclo entre todas as abas).
const SSC_PENDING_COALESCE_MS = 60 * 1000

// Chave lógica usada no coordenador (define o lock e o slot de cache).
const SSC_PENDING_COORD_KEY = 'ssc-pendings'

// Chave de storage do responsável monitorado (escolha salva pelo usuário).
const SSC_MONITORED_RESP_KEY = 'sscMonitoredResponsavelId'

// Chave de storage da seleção de UNIDADES monitoradas (escolha salva pelo
// usuário na guia Pendências). Valores possíveis:
//   - ausente/undefined -> usa a seleção da sessão do SGD + auto (drill-down);
//   - 'ALL'             -> força TODAS as unidades;
//   - array de ids      -> usa exatamente essas unidades.
const SSC_MONITORED_UNIDADES_KEY = 'sscMonitoredUnidades'

/**
 * Log de depuração das pendências, gated pelo sgdDebug global (config.js).
 * Silencioso por padrão; ative no console da página com: sgdDebug.ativar()
 */
function logPendingDebug(...args) {
  if (typeof sgdLog === 'function') sgdLog('[PENDING]', ...args)
}

/**
 * Converte "DD/MM/AA" ou "DD/MM/AAAA" (com hora opcional) em timestamp.
 * A sscs.html usa ano com 2 dígitos (ex.: 16/07/26).
 */
function parseSscDateToTs(str) {
  const m = (str || '').match(/(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (!m) return null
  const d = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10) - 1
  let y = parseInt(m[3], 10)
  if (y < 100) y += 2000
  return new Date(y, mo, d).getTime()
}

/**
 * Lê o texto de uma célula da linha pelo prefixo do id (ex.: "td:dias_").
 */
function sscCellText(tr, idPrefix) {
  const td = tr.querySelector(`td[id^="${idPrefix}"]`)
  return td ? td.textContent.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Extrai os timestamps (ms) de uma célula de data do SGD, que vem como
 * <span oculto>ts</span><script>document.write(ajustarTempo(inicioMs, agoraMs,
 * "dd/MM/yy HH:mm"))</script>. O fetch/DOMParser NÃO executa o script, então
 * lemos os números direto do texto — o início é o timestamp do evento (ex.:
 * último trâmite) e o segundo é o horário do servidor.
 * @returns {{startTs:number, endTs:(number|null)}|null}
 */
function extractSscTime(cell) {
  if (!cell) return null
  const raw = cell.textContent || ''
  const m = raw.match(/ajustarTempo\(\s*(\d+)\s*,\s*(\d+)\s*,/)
  if (m) {
    return { startTs: parseInt(m[1], 10), endTs: parseInt(m[2], 10) }
  }
  // Fallback: primeiro número longo (span oculto de ordenação = início em ms).
  const n = raw.match(/(\d{12,})/)
  if (n) return { startTs: parseInt(n[1], 10), endTs: null }
  return null
}

/**
 * Formata um timestamp (ms) como "DD/MM/AA HH:MM" (padrão exibido pelo SGD).
 */
function formatSscTimestamp(ms) {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${pad(
    d.getFullYear() % 100
  )} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Texto limpo de uma célula: remove <script> e <span> (chave de ordenação
 * oculta) antes de ler o texto. Usado como fallback quando não há ajustarTempo.
 */
function cleanSscCellText(cell) {
  if (!cell) return ''
  const clone = cell.cloneNode(true)
  clone.querySelectorAll('script, span').forEach(el => el.remove())
  return clone.textContent.trim().replace(/\s+/g, ' ')
}

/**
 * Lê as opções do <select> de responsável: [{id, name}] (inclui "Todos"=0).
 */
function parseResponsavelOptions(doc) {
  const sel = doc.getElementById('relSscForm:responsavel')
  if (!sel) return []
  return Array.from(sel.querySelectorAll('option')).map(o => ({
    id: o.value,
    name: (o.textContent || '').trim()
  }))
}

/**
 * Decide o responsável ALVO da busca — NUNCA "Todos" (evita o limite de 1000):
 *   1. usa a escolha salva pelo usuário (se ainda existir na lista);
 *   2. senão, se houver exatamente 1 responsável real, usa-o (técnico comum);
 *   3. senão (gestor/ambíguo), retorna null -> a UI pede a seleção.
 * @returns {Promise<string|null>}
 */
async function resolverResponsavelAlvo(doc) {
  const options = parseResponsavelOptions(doc)
  const validIds = new Set(options.map(o => o.id))
  const stored = await chrome.storage.local.get([SSC_MONITORED_RESP_KEY])
  const savedId = stored[SSC_MONITORED_RESP_KEY]
  if (savedId && savedId !== '0' && validIds.has(savedId)) return savedId
  // Usuário limpou a seleção de propósito (string vazia salva) -> volta ao
  // prompt "Selecione um responsável", sem auto-selecionar.
  if (savedId === '') return null
  const reais = options.filter(o => o.id && o.id !== '0')
  if (reais.length === 1) return reais[0].id
  return null
}

/**
 * Critério de "minha pendência": a coluna Responsável preenchida (≠ "-").
 * Isolado para facilitar ajuste futuro (ex.: casar pelo login exato).
 */
function isMinhaSscPendencia(item) {
  const r = (item.responsible || '').trim()
  return r !== '' && r !== '-'
}

/**
 * Aplica o "healer" de tempo de chegada (detecção de novo trâmite) para um id
 * já rastreado. Usado só como fallback quando a célula não traz ajustarTempo.
 */
function applySscArrivalHealer(id, dataUltimoTramite, arrivalTimes, now, state) {
  if (!arrivalTimes[id]) return
  let record = arrivalTimes[id]

  if (typeof record !== 'object') {
    record = { ts: record, precise: true, lastTramiteDate: dataUltimoTramite }
    arrivalTimes[id] = record
    state.changed = true
    return
  }

  if (record.precise && now - record.ts < 1000 * 60 * 60) {
    const matches = [
      ...(record.lastTramiteDate || '').matchAll(/(\d{2})\/(\d{2})\/(\d{2,4})/g)
    ]
    if (matches.length > 0) {
      let maxTramTs = 0
      for (const mm of matches) {
        const ts = parseSscDateToTs(mm[0])
        if (ts && ts > maxTramTs) maxTramTs = ts
      }
      if (maxTramTs && now - maxTramTs > 24 * 60 * 60 * 1000) {
        record.ts = maxTramTs
        record.precise = false
        state.changed = true
      }
    }
  }

  if (record.lastTramiteDate === undefined) {
    record.lastTramiteDate = dataUltimoTramite
    state.changed = true
  } else if (record.lastTramiteDate !== dataUltimoTramite) {
    record.ts = now
    record.precise = true
    record.lastTramiteDate = dataUltimoTramite
    state.changed = true
  }
}

/**
 * Calcula o SLA (horas úteis precisas ou dias estimados) via arrivalTimes.
 * Fallback quando não há timestamps do ajustarTempo.
 */
function computeSscSla(id, dataUltimoTramite, arrivalTimes, now) {
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
    const tramiteTs = parseSscDateToTs(dataUltimoTramite)
    if (tramiteTs) {
      const businessMs = calculateBusinessTimeMs(tramiteTs, now)
      estimatedDaysSinceUpdate = Math.max(
        0,
        Math.floor(businessMs / (1000 * 60 * 60 * 24))
      )
      timePrecision = 'estimado'
    }
  }

  return { hoursSinceUpdate, timePrecision, estimatedDaysSinceUpdate }
}

/**
 * Faz o parse da grade table.tableSorter da sscs.html para o modelo de item.
 * Retorna TODAS as linhas (o filtro de "minhas" é aplicado depois).
 */
function parseSscPendingPage(doc, arrivalTimes, now, arrivalTimesState) {
  const table = doc.querySelector('table.tableSorter, table.tablesorter')

  if (!table) {
    const passwordInput = doc.querySelector('input[type="password"]')
    const loginForm =
      doc.querySelector('form[action*="login"]') ||
      doc.querySelector('#login-form')
    if (passwordInput || loginForm) {
      throw new Error('Você não está logado no SGD. Por favor, faça login.')
    }
    console.warn(
      'SscPendingService: grade table.tableSorter não encontrada. Layout pode ter mudado ou a página veio em branco.'
    )
    return { items: [] }
  }

  const rows = table.querySelectorAll('tbody tr')
  const items = []

  rows.forEach(tr => {
    // Só linhas de dados têm células com id "td:...". Ignora cabeçalho/layout.
    // A célula do número da SSC tem DOIS padrões de id na grade do SGD:
    //   - "td:seq_revenda_N"        -> linhas normais
    //   - "td:sequencial_revenda_N" -> linhas DESTACADAS/prioritárias (coloridas)
    // As demais células (assunto, dias, responsável, etc.) usam os mesmos ids nos
    // dois casos. Antes reconhecíamos só o 1º padrão, então as SSCs prioritárias
    // (fundo amarelo / fonte vermelha) eram silenciosamente descartadas e nunca
    // apareciam na guia Pendências nem no widget. Reconhecemos os dois padrões.
    const idCell = tr.querySelector(
      'td[id^="td:seq_revenda_"], td[id^="td:sequencial_revenda_"]'
    )
    const assuntoCell = tr.querySelector('td[id^="td:assunto_"]')
    if (!idCell || !assuntoCell) return

    // Sinais visuais da grade do SGD — presentes no HTML (classe/style inline),
    // portanto legíveis via fetch()+DOMParser (o CSS externo não é aplicado, mas
    // esses marcadores estão no próprio elemento):
    //   - Fundo AMARELO/AZUL: classe tableListaRowWarning(Blue) na célula do
    //     número  => SSC PRIORITÁRIA  => tag "Prioridade".
    //   - Fonte VERMELHA: style inline "color:red" na linha/assunto/célula
    //     => SSC com retorno de SS   => tag "Em SS".
    // São independentes: uma SSC pode ser prioritária E ter retorno de SS (as
    // duas linhas coloridas ao mesmo tempo).
    const isPrioritaria =
      idCell.classList.contains('tableListaRowWarning') ||
      idCell.classList.contains('tableListaRowWarningBlue')
    const anchorEl = assuntoCell.querySelector('a')
    const estilosInline = (
      (tr.getAttribute('style') || '') +
      ';' +
      (idCell.getAttribute('style') || '') +
      ';' +
      (anchorEl ? anchorEl.getAttribute('style') || '' : '')
    )
      .toLowerCase()
      .replace(/\s+/g, '')
    const isEmSS = estilosInline.includes('color:red')

    try {
      const id = idCell.textContent.trim()
      if (!id) return

      const dias = sscCellText(tr, 'td:dias_')
      const qtdTramites = sscCellText(tr, 'td:qnd_tramites_')

      // Datas: as células trazem <span oculto>ts</span> + <script>ajustarTempo(
      // inicioMs, agoraMs, "dd/MM/yy HH:mm")</script>. Como o fetch/DOMParser não
      // executa scripts, extraímos os timestamps precisos (ms) diretamente.
      const entradaCell = tr.querySelector('td[id^="td:entrada_"]')
      const tramiteCell = tr.querySelector('td[id^="td:ultimo_tramite_"]')
      const aberturaTime = extractSscTime(entradaCell)
      const tramiteTime = extractSscTime(tramiteCell)
      const dataAbertura =
        aberturaTime && Number.isFinite(aberturaTime.startTs)
          ? formatSscTimestamp(aberturaTime.startTs)
          : cleanSscCellText(entradaCell)
      const dataUltimoTramite =
        tramiteTime && Number.isFinite(tramiteTime.startTs)
          ? formatSscTimestamp(tramiteTime.startTs)
          : cleanSscCellText(tramiteCell)
      const modulo = sscCellText(tr, 'td:nome_modulo_')
      const responsible = sscCellText(tr, 'td:responsavel_tecnico_')
      const alocacao = sscCellText(tr, 'td:alocacao_responsavel_tecnico_')

      // Assunto + link (href relativo -> absoluto)
      const anchor = assuntoCell.querySelector('a')
      let subject = assuntoCell.textContent.trim() || 'Sem assunto'
      let link = '#'
      if (anchor) {
        subject = anchor.textContent.trim() || subject
        const href = anchor.getAttribute('href')
        if (href && href !== 'javascript:void(0)') {
          link = href.startsWith('http')
            ? href
            : `${window.location.origin}${href.startsWith('/') ? '' : '/'}${href}`
        }
      }

      // Situação: título da imagem em td:situacao_figura_
      const situacaoCell = tr.querySelector('td[id^="td:situacao_figura_"]')
      const situacaoImg = situacaoCell ? situacaoCell.querySelector('img') : null
      const status = situacaoImg
        ? situacaoImg.getAttribute('title') ||
          situacaoImg.getAttribute('alt') ||
          'Sem status'
        : (situacaoCell ? situacaoCell.textContent.trim() : '') || 'Sem status'

      // SLA: horas ÚTEIS desde o último trâmite (exclui fins de semana e
      // feriados via calculateBusinessTimeMs), usando os timestamps precisos do
      // ajustarTempo — início = último trâmite, fim = horário do servidor.
      // Sem depender do relógio local nem de rastreamento de chegada.
      // Fallback para o método antigo (arrivalTimes/data) se não houver ts.
      let sla
      if (tramiteTime && Number.isFinite(tramiteTime.startTs)) {
        const endTs = Number.isFinite(tramiteTime.endTs) ? tramiteTime.endTs : now
        const businessMs = calculateBusinessTimeMs(tramiteTime.startTs, endTs)
        sla = {
          hoursSinceUpdate: Math.max(0, businessMs / (1000 * 60 * 60)),
          timePrecision: 'preciso',
          estimatedDaysSinceUpdate: Math.max(
            0,
            Math.floor(businessMs / (1000 * 60 * 60 * 24))
          )
        }
      } else {
        applySscArrivalHealer(
          id,
          dataUltimoTramite,
          arrivalTimes,
          now,
          arrivalTimesState
        )
        sla = computeSscSla(id, dataUltimoTramite, arrivalTimes, now)
      }

      items.push({
        id,
        dataAbertura,
        dias,
        dataUltimoTramite,
        qtdTramites,
        subject,
        link,
        status,
        responsible,
        modulo,
        alocacao,
        isPrioritaria,
        isEmSS,
        hoursSinceUpdate: sla.hoursSinceUpdate,
        timePrecision: sla.timePrecision,
        estimatedDaysSinceUpdate: sla.estimatedDaysSinceUpdate
      })
    } catch (err) {
      /* linha malformada: ignora */
    }
  })

  return { items }
}

/**
 * Executa o fluxo JSF sequencial contra a sscs.html:
 *   1. GET  -> captura formulário, ViewState, filtros do usuário e a lista de
 *              responsáveis; decide o responsável alvo (nunca "Todos").
 *   Se não houver responsável definido (gestor sem escolha) -> devolve
 *   needsSelection=true SEM disparar POST (evita a busca com "Todos").
 *   2. POST -> busca com Situação=Pendentes, Responsável=alvo, Classif.=Todas.
 *   3. POST -> restaura os filtros originais do usuário (bom cidadão).
 *
 * NÃO faz nenhuma chamada paralela: cada await conclui antes do próximo.
 * @returns {Promise<{docBusca:(Document|null), responsaveis:Array, responsavelUsado:(string|null), needsSelection:boolean}>}
 */
async function buscarDocumentoSscPendentes() {
  const url = `${window.location.origin}${SSC_PENDING_LIST_PATH}`
  const parser = new DOMParser()

  // 1. GET: estado atual (form + ViewState + filtros + responsáveis)
  const resInicial = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-cache'
  })
  if (!resInicial.ok) {
    if (resInicial.status === 401 || resInicial.status === 403) {
      throw new Error('Sessão expirada. Por favor, faça login novamente no SGD.')
    }
    throw new Error(`Erro ao acessar o SGD: ${resInicial.status}`)
  }

  const docInicial = parser.parseFromString(await resInicial.text(), 'text/html')
  const form = docInicial.getElementById('relSscForm')
  if (!form) {
    const passwordInput = docInicial.querySelector('input[type="password"]')
    if (passwordInput) {
      throw new Error('Você não está logado no SGD. Por favor, faça login.')
    }
    throw new Error('Formulário relSscForm não encontrado na sscs.html.')
  }

  const actionUrl = form.action || url
  const responsaveis = parseResponsavelOptions(docInicial).filter(
    o => o.id && o.id !== '0'
  )

  // Snapshot dos filtros do usuário (para restaurar depois)
  const situacaoOriginal =
    docInicial.getElementById('relSscForm:situacao')?.value ?? '0'
  const responsavelOriginal =
    docInicial.getElementById('relSscForm:responsavel')?.value ?? '0'
  const classificacaoOriginal =
    docInicial.getElementById('relSscForm:classificacao')?.value ?? '0'

  const alvo = await resolverResponsavelAlvo(docInicial)

  logPendingDebug(
    'GET sscs.html ->',
    resInicial.status,
    '| responsáveis disponíveis:',
    responsaveis.length,
    '| responsável(original):',
    responsavelOriginal,
    '| responsável(alvo):',
    alvo
  )

  if (!alvo) {
    // Gestor/ambíguo sem escolha salva: NUNCA buscar com "Todos".
    logPendingDebug('Sem responsável definido — pedindo seleção (needsSelection).')
    return {
      docN1: null,
      docN2: null,
      responsaveis,
      responsavelUsado: null,
      needsSelection: true
    }
  }

  // Filtros herdados da sessão do SGD que distorcem a CONTAGEM de pendências.
  // O SGD lembra o último filtro usado; se o técnico filtrou por 1 cliente
  // (tipicamente 1 unidade + 1 cliente) para ver as SSCs daquele cliente, a
  // consulta de pendências herda isso e mostra um número FALSO (só daquele
  // cliente). Regras (definidas com o Patrick):
  //   - Cliente: pendência é por TÉCNICO, nunca por cliente. Se houver um
  //     cliente específico selecionado, forçamos "Todos" na busca.
  //   - Unidades: "Todas" e multi-seleção são o modo de trabalho normal do
  //     técnico e são PRESERVADAS. Só forçamos "Todas as Unidades" no cenário
  //     problemático de 1 única unidade marcada JUNTO com um cliente específico
  //     (indício de drill-down por cliente).
  // Tudo isso vale só nos POSTs de busca; o POST de restauração reusa o form
  // original (FormData(form)), devolvendo cliente e unidades como estavam.
  const todosCheckboxes = Array.from(
    form.querySelectorAll('input[type="checkbox"]')
  )
  const nomeCurto = el => (el.getAttribute('name') || '').split(':').pop()
  const unidadeBoxes = todosCheckboxes.filter(b => nomeCurto(b) === 'unidades')
  const unidadeName = unidadeBoxes[0] ? unidadeBoxes[0].getAttribute('name') : null
  const masterUnidade = todosCheckboxes.find(
    b => nomeCurto(b) === 'inputCheckUnidadeTodas'
  )
  const unidadesMarcadas = unidadeBoxes.filter(b => b.checked).length

  // Lista de unidades disponíveis (id + nome do <label>) para a UI da guia.
  const unidadesDisponiveis = unidadeBoxes.map(b => {
    const lab = b.id ? form.querySelector(`label[for="${b.id}"]`) : null
    return {
      id: b.value,
      name: lab ? lab.textContent.trim() : b.value,
      checked: b.checked
    }
  })
  const idsValidos = new Set(unidadeBoxes.map(b => b.value))

  const clienteSelect = Array.from(form.querySelectorAll('select')).find(
    s => nomeCurto(s) === 'clientes'
  )
  const clienteName = clienteSelect ? clienteSelect.getAttribute('name') : null
  const clienteValor = clienteSelect ? clienteSelect.value : '0'
  const clienteEspecifico =
    !!clienteName && clienteValor && clienteValor !== '0' && clienteValor !== 'NONE'

  // Seleção de unidades escolhida pelo usuário na guia Pendências (storage).
  //   'ALL' -> todas | array -> custom | ausente -> usa a sessão + auto.
  const storedUni = await chrome.storage.local.get([SSC_MONITORED_UNIDADES_KEY])
  const savedUnidades = storedUni[SSC_MONITORED_UNIDADES_KEY]
  let unidadesModo = 'sessao'
  let unidadesCustom = []
  if (savedUnidades === 'ALL') {
    unidadesModo = 'all'
  } else if (Array.isArray(savedUnidades) && savedUnidades.length) {
    unidadesCustom = savedUnidades.filter(id => idsValidos.has(id))
    if (unidadesCustom.length) unidadesModo = 'custom'
  }

  // Auto: só "abre" as unidades no cenário 1 unidade + cliente específico
  // (drill-down por cliente) — e apenas quando NÃO há escolha manual salva.
  const forcarUnidadesTodas =
    unidadesModo === 'sessao' &&
    clienteEspecifico &&
    !!unidadeName &&
    unidadesMarcadas === 1

  // Quais unidades a busca REALMENTE usa (para reportar à UI).
  let unidadesUsadas
  if (unidadesModo === 'all' || forcarUnidadesTodas) {
    unidadesUsadas = unidadeBoxes.map(b => b.value)
  } else if (unidadesModo === 'custom') {
    unidadesUsadas = unidadesCustom.slice()
  } else {
    unidadesUsadas = unidadeBoxes.filter(b => b.checked).map(b => b.value)
  }

  if (clienteEspecifico || unidadesModo !== 'sessao') {
    logPendingDebug(
      `Filtros da busca -> cliente${clienteEspecifico ? '=Todos(forçado)' : '(inalterado)'} | ` +
        `unidades modo=${unidadesModo}${forcarUnidadesTodas ? '+autoTodas' : ''} ` +
        `(${unidadesUsadas.length}/${unidadeBoxes.length}) (restaura ao final).`
    )
  }

  // Aplica cliente + unidades ao corpo de UMA busca (não mexe no form/DOM, só
  // nos params daquela requisição). A restauração reusa o form original.
  function aplicarFiltrosBusca(params) {
    // Cliente: pendência é por técnico; um cliente específico é sempre limpo.
    if (clienteEspecifico && clienteName) params.set(clienteName, '0')
    if (!unidadeName) return

    if (unidadesModo === 'all' || forcarUnidadesTodas) {
      params.delete(unidadeName)
      unidadeBoxes.forEach(b => params.append(unidadeName, b.value))
      if (masterUnidade) params.set(masterUnidade.getAttribute('name'), 'on')
    } else if (unidadesModo === 'custom') {
      params.delete(unidadeName)
      unidadesCustom.forEach(id => params.append(unidadeName, id))
      if (masterUnidade) {
        if (unidadesCustom.length === unidadeBoxes.length) {
          params.set(masterUnidade.getAttribute('name'), 'on')
        } else {
          params.delete(masterUnidade.getAttribute('name'))
        }
      }
    }
    // modo 'sessao' sem auto: mantém o que veio no FormData (seleção do SGD).
  }

  // Helper: um POST de busca por situação, encadeando o ViewState. Devolve o
  // documento e o ViewState atualizado para a próxima requisição (JSF exige
  // o ViewState mais recente a cada POST no mesmo view).
  async function postBusca(situacao, viewStateOverride) {
    const params = new URLSearchParams(new FormData(form))
    params.delete('relSscForm:incluirSSCBtn')
    params.delete('relSscForm:incluirSSCHiddenBtn')
    params.set('relSscForm:situacao', situacao)
    params.set('relSscForm:responsavel', alvo)
    params.set('relSscForm:classificacao', SSC_PENDING_CLASSIFICACAO)
    aplicarFiltrosBusca(params)
    params.set('relSscForm:atualizarBtn', 'relSscForm:atualizarBtn')
    if (viewStateOverride) params.set('javax.faces.ViewState', viewStateOverride)
    const res = await fetch(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      credentials: 'same-origin'
    })
    if (!res.ok) throw new Error(`Erro ao buscar pendências: ${res.status}`)
    const doc = parser.parseFromString(await res.text(), 'text/html')
    const vs = doc.querySelector('[name="javax.faces.ViewState"]')?.value
    return { doc, vs, status: res.status }
  }

  // 2a. POST N1 (situação -3): usa o ViewState do GET (já presente no FormData).
  const buscaN1 = await postBusca(SSC_PENDING_SITUACAO_N1)
  logPendingDebug('POST N1 (-3, responsável=' + alvo + ') ->', buscaN1.status)

  // 2b. POST N2 (situação -2): encadeia o ViewState devolvido pelo N1.
  const buscaN2 = await postBusca(SSC_PENDING_SITUACAO_N2, buscaN1.vs)
  logPendingDebug('POST N2 (-2, responsável=' + alvo + ') ->', buscaN2.status)

  // 3. POST de restauração: devolve os filtros originais do usuário, usando o
  // ViewState mais recente (o devolvido pelo N2).
  try {
    const paramsRestauracao = new URLSearchParams(new FormData(form))
    paramsRestauracao.delete('relSscForm:incluirSSCBtn')
    paramsRestauracao.delete('relSscForm:incluirSSCHiddenBtn')
    paramsRestauracao.set('relSscForm:situacao', situacaoOriginal)
    paramsRestauracao.set('relSscForm:responsavel', responsavelOriginal)
    paramsRestauracao.set('relSscForm:classificacao', classificacaoOriginal)
    paramsRestauracao.set('relSscForm:atualizarBtn', 'relSscForm:atualizarBtn')
    if (buscaN2.vs) {
      paramsRestauracao.set('javax.faces.ViewState', buscaN2.vs)
    }
    await fetch(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramsRestauracao.toString(),
      credentials: 'same-origin'
    })
  } catch (e) {
    console.warn('SscPendingService: falha ao restaurar filtros do usuário:', e)
  }

  return {
    docN1: buscaN1.doc,
    docN2: buscaN2.doc,
    responsaveis,
    responsavelUsado: alvo,
    needsSelection: false,
    unidades: unidadesDisponiveis,
    unidadesUsadas,
    unidadesModo
  }
}

/**
 * Producer real (não serializado por si só) usado pelo coordenador.
 * Retorna { items, siteFilter, tabs, responsaveis, responsavelUsado,
 * needsSelection } no formato esperado pela UI.
 */
async function produceSscPendingItems() {
  const arrivalTimes = await getPendingArrivalTimes()
  const arrivalTimesState = { changed: false }
  const now = Date.now()

  logPendingDebug('Buscando pendências na sscs.html...')
  const busca = await buscarDocumentoSscPendentes()

  if (busca.needsSelection) {
    return {
      items: [],
      siteFilter: { active: false, name: null },
      tabs: null,
      responsaveis: busca.responsaveis,
      responsavelUsado: null,
      needsSelection: true,
      unidades: busca.unidades || [],
      unidadesUsadas: busca.unidadesUsadas || [],
      unidadesModo: busca.unidadesModo || 'sessao'
    }
  }

  // Parseia cada consulta, filtra as "minhas" (coluna Responsável preenchida)
  // e marca o nível de origem (N1 = pendente com o técnico; N2 = aguardando
  // outro setor). O mesmo mapa de arrivalTimes é compartilhado entre as duas.
  const parseTagged = (doc, nivel) => {
    const r = parseSscPendingPage(doc, arrivalTimes, now, arrivalTimesState)
    const mine = r.items.filter(isMinhaSscPendencia)
    mine.forEach(i => {
      i.nivel = nivel
    })
    return { total: r.items.length, mine }
  }

  const n1 = parseTagged(busca.docN1, 'N1')
  const n2 = parseTagged(busca.docN2, 'N2')

  if (arrivalTimesState.changed) {
    await savePendingArrivalTimes(arrivalTimes)
  }

  // Merge com dedup por id (um SSC não deve estar em N1 e N2; se ocorrer, N1 vence).
  const byId = new Map()
  n1.mine.forEach(i => byId.set(i.id, i))
  n2.mine.forEach(i => {
    if (!byId.has(i.id)) byId.set(i.id, i)
  })
  const all = Array.from(byId.values())
  const itemsN1 = all.filter(i => i.nivel === 'N1')
  const itemsN2 = all.filter(i => i.nivel === 'N2')

  logPendingDebug(
    `Parse N1: ${n1.total} linha(s)/${itemsN1.length} minhas | N2: ${n2.total}/${itemsN2.length} minhas | responsável=${busca.responsavelUsado}`
  )

  const noFilter = { active: false, name: null }
  const tabs = [
    { id: 'all', name: 'Todas', items: all, siteFilter: noFilter },
    { id: 'n1', name: 'Pendente N1', items: itemsN1, siteFilter: noFilter },
    { id: 'n2', name: 'Aguardando N2', items: itemsN2, siteFilter: noFilter }
  ]

  return {
    items: all,
    siteFilter: noFilter,
    tabs,
    responsaveis: busca.responsaveis,
    responsavelUsado: busca.responsavelUsado,
    needsSelection: false,
    unidades: busca.unidades || [],
    unidadesUsadas: busca.unidadesUsadas || [],
    unidadesModo: busca.unidadesModo || 'sessao'
  }
}

/**
 * Ponto de entrada da nova fonte. TODA busca passa por aqui e é serializada
 * pelo SgdRequestCoordinator (lock cross-tab + coalescing single-flight).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - ignora o coalescing (ex.: botão Atualizar).
 * @param {number} [opts.maxAgeMs] - janela de reutilização do cache.
 * @returns {Promise<{items:Array, siteFilter:object, tabs:null, responsaveis:Array, responsavelUsado:(string|null), needsSelection:boolean}>}
 */
async function fetchSscPendingItems(opts = {}) {
  const { force = false, maxAgeMs = SSC_PENDING_COALESCE_MS } = opts

  if (typeof SgdRequestCoordinator === 'undefined') {
    // Fallback defensivo: sem coordenador, ainda roda sequencialmente.
    logPendingDebug('SgdRequestCoordinator ausente — rodando sem lock (fallback).')
    return produceSscPendingItems()
  }

  const { result, fromCache, stale } = await SgdRequestCoordinator.run(
    SSC_PENDING_COORD_KEY,
    produceSscPendingItems,
    { force, maxAgeMs }
  )
  logPendingDebug(
    `Entregando ${result.items.length} pendência(s) | needsSelection=${!!result.needsSelection} fromCache=${fromCache} stale=${!!stale} force=${force}`
  )
  return result
}
