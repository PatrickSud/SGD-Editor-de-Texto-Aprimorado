/**
 * @file duplicate-checker.js
 * Verificador automático de SSCs com assunto parecido, do mesmo cliente,
 * dentro de um período de 60 dias.
 */

const DEBUG_ENABLED = true
const DUPLICATE_CHECKER_MAX_DAYS = 60

const COMPARA_STOP_WORDS = new Set([
  'erro', 'erros', 'sistema', 'sistemas', 'suporte', 'problema', 'problemas',
  'ajuda', 'duvida', 'duvidas', 'cliente', 'clientes', 'favor', 'urgente',
  'solicitacao', 'solicitacoes', 'atendimento', 'atendimentos', 'chamado',
  'chamados', 'cadastro', 'cadastros', 'configuracao',
  'configuracoes', 'verificacao', 'mensagem', 'mensagens',
  'usuario', 'usuarios', 'modulo', 'modulos', 'dados'
])

const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutos de cache
const CACHE_KEY = 'sgd_ssc_duplicate_cache'

function logDebug(...args) {
  if (DEBUG_ENABLED) {
    console.log(...args)
  }
}

async function obterCandidatosDoCache(clienteId) {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY)
    const cache = result[CACHE_KEY] || {}
    const entry = cache[clienteId]
    if (entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS) {
      logDebug(`[DEBUG] Cache HIT para o cliente ${clienteId}. Usando candidatos do cache.`)
      return entry.candidatos
    }
  } catch (err) {
    logDebug('[DEBUG] Erro ao ler do cache:', err)
  }
  return null
}

async function salvarCandidatosNoCache(clienteId, candidatos) {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY)
    const cache = result[CACHE_KEY] || {}

    // Remove registros expirados para economizar espaço
    const agora = Date.now()
    for (const id in cache) {
      if (agora - cache[id].timestamp >= CACHE_TTL_MS) {
        delete cache[id]
      }
    }

    cache[clienteId] = {
      candidatos,
      timestamp: agora
    }

    await chrome.storage.local.set({ [CACHE_KEY]: cache })
    logDebug(`[DEBUG] Candidatos salvos no cache para o cliente ${clienteId}.`)
  } catch (err) {
    logDebug('[DEBUG] Erro ao salvar no cache:', err)
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 1. NORMALIZAÇÃO E COMPARAÇÃO DE TEXTO
// ─────────────────────────────────────────────────────────────────────────────

function normalizarTextoSSC(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function extrairPalavrasChaveSSC(texto) {
  return normalizarTextoSSC(texto)
    .split(/[\s\-\/]+/)
    .filter(palavra => palavra.length > 4 && !COMPARA_STOP_WORDS.has(palavra))
}

function calcularSimilaridadeSSC(assuntoAtual, assuntoCandidato) {
  const palavrasAtual = extrairPalavrasChaveSSC(assuntoAtual)
  const palavrasCandidato = new Set(extrairPalavrasChaveSSC(assuntoCandidato))

  let matches = 0
  for (const palavra of palavrasAtual) {
    if (palavrasCandidato.has(palavra)) matches++
  }
  return matches >= 2
}

function montarPromptComparacaoSSC(assuntoAtual, candidatos) {
  const listaTexto = candidatos
    .map((c, i) => `${i}: "${c.assunto}"`)
    .join('\n')

  return `Você está comparando o ASSUNTO de uma solicitação de suporte (SSC) com uma lista de outras SSCs do mesmo cliente, para identificar se alguma trata do MESMO problema técnico, mesmo usando palavras diferentes (sinônimos, abreviações ou descrições do mesmo evento).

ASSUNTO ATUAL:
"${assuntoAtual}"

LISTA DE CANDIDATOS (índice: assunto):
${listaTexto}

INSTRUÇÕES:
- Responda APENAS com um JSON, sem nenhum texto antes ou depois, no formato: {"indices": [0, 2, 5]}
- Inclua apenas os índices que tratam do MESMO problema, mesmo com palavras diferentes.
- Se nenhum candidato for relacionado, responda: {"indices": []}
- Não inclua explicações, comentários ou texto fora do JSON.`
}

function compararSSCsComIA(assuntoAtual, candidatos) {
  return new Promise((resolve, reject) => {
    const prompt = montarPromptComparacaoSSC(assuntoAtual, candidatos)

    const onResponse = (message) => {
      if (message.action === 'comparacaoSSCCompleta') {
        chrome.runtime.onMessage.removeListener(onResponse)
        try {
          const limpo = message.data.replace(/```json|```/g, '').trim()
          const parsed = JSON.parse(limpo)
          resolve(Array.isArray(parsed.indices) ? parsed.indices : [])
        } catch (e) {
          reject(new Error('Resposta da IA em formato inválido: ' + e.message))
        }
      } else if (message.action === 'comparacaoSSCErro') {
        chrome.runtime.onMessage.removeListener(onResponse)
        reject(new Error(message.data))
      }
    }

    chrome.runtime.onMessage.addListener(onResponse)
    chrome.runtime.sendMessage({ action: 'compararSSCsSimilares', prompt })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BUSCA VIA FETCH (SEM JANELA)
// ─────────────────────────────────────────────────────────────────────────────

async function buscarDocumentoSSCsPendentes(clienteId) {
  const urlBase = `${window.location.origin}/sgsc/faces/sscs-pendentes.html`
  const urlVerificacao = `${urlBase}?clienteID=${clienteId}`
  const parser = new DOMParser()

  // 1a. GET sem clienteID: captura o estado real dos filtros que o usuário deixou.
  // É feito sem o parâmetro clienteID para evitar que o servidor pré-preencha
  // automaticamente os campos (ex: relSscForm:clientes) com o cliente da SSC atual.
  const resEstadoUsuario = await fetch(urlBase, { credentials: 'same-origin' })
  if (!resEstadoUsuario.ok) throw new Error(`Erro ao capturar estado do usuário: ${resEstadoUsuario.status}`)

  const docEstadoUsuario = parser.parseFromString(await resEstadoUsuario.text(), 'text/html')
  const formEstado = docEstadoUsuario.getElementById('relSscForm')

  const clientesOriginal = docEstadoUsuario.getElementById('relSscForm:clientes')?.value ?? ''
  const unidadeNomeOriginal = docEstadoUsuario.getElementById('relSscForm:unidadeNome')?.value ?? ''
  const situacaoOriginal = docEstadoUsuario.getElementById('relSscForm:situacao')?.value ?? '0'
  const responsavelOriginal = docEstadoUsuario.getElementById('relSscForm:responsavel')?.value ?? '0'
  const classificacaoOriginal = docEstadoUsuario.getElementById('relSscForm:classificacao')?.value ?? '0'

  logDebug('[RESTORE-DEBUG] Estado real do usuário (GET sem clienteID):')
  logDebug('[RESTORE-DEBUG]   relSscForm:clientes     =', JSON.stringify(clientesOriginal))
  logDebug('[RESTORE-DEBUG]   relSscForm:unidadeNome  =', JSON.stringify(unidadeNomeOriginal))
  logDebug('[RESTORE-DEBUG]   relSscForm:situacao     =', JSON.stringify(situacaoOriginal))
  logDebug('[RESTORE-DEBUG]   relSscForm:responsavel  =', JSON.stringify(responsavelOriginal))
  logDebug('[RESTORE-DEBUG]   relSscForm:classificacao=', JSON.stringify(classificacaoOriginal))

  // 1b. GET com clienteID: carrega o formulário para a verificação
  const resInicial = await fetch(urlVerificacao, { credentials: 'same-origin' })
  if (!resInicial.ok) throw new Error(`Erro ao carregar SSCs Pendentes: ${resInicial.status}`)

  const docInicial = parser.parseFromString(await resInicial.text(), 'text/html')
  const form = docInicial.getElementById('relSscForm')
  if (!form) throw new Error('Formulário relSscForm não encontrado')

  const actionUrl = form.action || urlVerificacao

  // 2. POST de verificação: busca todas as SSCs do cliente (filtros zerados)
  const paramsVerificacao = new URLSearchParams(new FormData(form))
  paramsVerificacao.set('relSscForm:situacao', '0')
  paramsVerificacao.set('relSscForm:responsavel', '0')
  paramsVerificacao.set('relSscForm:atualizarBtn', 'relSscForm:atualizarBtn')

  const resVerificacao = await fetch(actionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: paramsVerificacao.toString(),
    credentials: 'same-origin'
  })
  if (!resVerificacao.ok) throw new Error(`Erro ao buscar resultados: ${resVerificacao.status}`)

  const docVerificacao = parser.parseFromString(await resVerificacao.text(), 'text/html')

  // 3. POST de restauração: devolve a sessão ao estado real do usuário.
  // Usa o ViewState retornado pela verificação (o anterior foi consumido pelo JSF).
  const viewStateAtualizado = docVerificacao.querySelector('[name="javax.faces.ViewState"]')?.value

  const paramsRestauracao = new URLSearchParams(formEstado ? new FormData(formEstado) : {})
  paramsRestauracao.set('relSscForm:clientes', clientesOriginal)
  paramsRestauracao.set('relSscForm:unidadeNome', unidadeNomeOriginal)
  paramsRestauracao.set('relSscForm:situacao', situacaoOriginal)
  paramsRestauracao.set('relSscForm:responsavel', responsavelOriginal)
  paramsRestauracao.set('relSscForm:classificacao', classificacaoOriginal)
  paramsRestauracao.set('relSscForm:atualizarBtn', 'relSscForm:atualizarBtn')
  if (viewStateAtualizado) {
    paramsRestauracao.set('javax.faces.ViewState', viewStateAtualizado)
  }

  logDebug('[RESTORE-DEBUG] Payload do POST de restauração (desconsiderando ViewState):')
  if (DEBUG_ENABLED) {
    for (const [k, v] of paramsRestauracao.entries()) {
      if (k === 'javax.faces.ViewState') continue
      console.log(`[RESTORE-DEBUG]   ${k} = ${JSON.stringify(v)}`)
    }
  }

  try {
    const resRestauracao = await fetch(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: paramsRestauracao.toString(),
      credentials: 'same-origin'
    })
    const docRestauracao = parser.parseFromString(await resRestauracao.text(), 'text/html')
    logDebug('[RESTORE-DEBUG] Status da restauração:', resRestauracao.status)
    logDebug('[RESTORE-DEBUG]   relSscForm:clientes    no doc restaurado =',
      JSON.stringify(docRestauracao.getElementById('relSscForm:clientes')?.value))
    logDebug('[RESTORE-DEBUG]   relSscForm:unidadeNome no doc restaurado =',
      JSON.stringify(docRestauracao.getElementById('relSscForm:unidadeNome')?.value))
  } catch (e) {
    if (DEBUG_ENABLED) {
      console.warn('[RESTORE-DEBUG] Erro no POST de restauração:', e)
    }
  }

  return docVerificacao
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LEITURA DA TABELA DE RESULTADOS
// ─────────────────────────────────────────────────────────────────────────────

function lerResultadosTabelaSSC(doc, sscAtualId) {
  const linhas = doc.querySelectorAll('table.tableSorter tbody tr')
  logDebug(`[DEBUG] Encontradas ${linhas.length} linhas na tabela table.tableSorter`)

  // Coleta os valores de dias válidos para verificar a ordenação
  const diasValores = []
  for (const tr of linhas) {
    const diasTd = tr.querySelector('td[id^="td:dias_"]')
    if (!diasTd) continue
    const dias = parseInt(diasTd.textContent.trim(), 10)
    if (!isNaN(dias)) {
      diasValores.push(dias)
    }
  }

  // Detecta se a tabela está ordenada de forma crescente ou decrescente
  let ordenadoCrescente = diasValores.length > 1
  let ordenadoDecrescente = diasValores.length > 1

  for (let i = 1; i < diasValores.length; i++) {
    if (diasValores[i] < diasValores[i - 1]) {
      ordenadoCrescente = false
    }
    if (diasValores[i] > diasValores[i - 1]) {
      ordenadoDecrescente = false
    }
  }

  logDebug(`[DEBUG] Tabela ordenada por dias crescente: ${ordenadoCrescente}`)
  logDebug(`[DEBUG] Tabela ordenada por dias decrescente: ${ordenadoDecrescente}`)

  // Se estiver ordenado de forma decrescente, revertemos as linhas para processar as mais novas
  // primeiro, permitindo o uso do early break (interrupção precoce)
  const linhasParaProcessar = ordenadoDecrescente ? Array.from(linhas).reverse() : Array.from(linhas)
  const usarEarlyBreak = ordenadoCrescente || ordenadoDecrescente

  const candidatos = []

  for (const tr of linhasParaProcessar) {
    const diasTd = tr.querySelector('td[id^="td:dias_"]')
    const assuntoTd = tr.querySelector('td[id^="td:assunto_"]')
    if (!diasTd || !assuntoTd) continue

    const dias = parseInt(diasTd.textContent.trim(), 10)
    if (isNaN(dias)) continue

    if (dias > DUPLICATE_CHECKER_MAX_DAYS) {
      if (usarEarlyBreak) {
        logDebug(`[DEBUG] Interrupção precoce da varredura na linha com ${dias} dias (limite: ${DUPLICATE_CHECKER_MAX_DAYS})`)
        break
      }
      continue
    }

    const link = assuntoTd.querySelector('a')
    if (!link) continue

    if (sscAtualId && link.href.includes(`ssc=${sscAtualId}`)) continue

    const assunto = link.textContent.trim()

    // Ignora solicitações ainda não finalizadas pelo técnico anterior (o SGD
    // exibe esse texto como assunto/descrição enquanto o cadastro do
    // atendimento não foi concluído) — não fazem sentido como candidatos.
    if (normalizarTextoSSC(assunto) === 'aguardando preenchimento') {
      logDebug(`[DEBUG] Candidato ignorado (ainda "Aguardando preenchimento"): ${link.href}`)
      continue
    }

    candidatos.push({
      assunto,
      href: link.href,
      dias
    })
  }

  // Se revertemos as linhas, revertemos o array de candidatos final para manter o alinhamento
  if (ordenadoDecrescente) {
    candidatos.reverse()
  }

  return candidatos
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INDICADOR VISUAL (TEXTO PISCANDO)
// ─────────────────────────────────────────────────────────────────────────────

function injetarEstiloWidgetSSC() {
  if (document.getElementById('ssc-duplicate-style')) return
  const style = document.createElement('style')
  style.id = 'ssc-duplicate-style'
  style.textContent = `
    @keyframes sscDuplicateBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    #ssc-duplicate-widget {
      position: fixed;
      bottom: 25px;
      right: 70px;
      z-index: 999999;
      box-shadow: -2px 2px 12px rgba(0,0,0,0.3);
      border-radius: 8px 0 0 8px;
      overflow: hidden;
      max-width: 290px;
      animation: sscDuplicateBlink 1.2s infinite;
    }
    #ssc-duplicate-widget.expanded {
      animation: none;
    }
    #ssc-duplicate-widget-header {
      background: #d9534f;
      color: #fff;
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }
    #ssc-duplicate-widget-header .ssc-widget-title {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #ssc-duplicate-widget-header button {
      background: rgba(255,255,255,0.25);
      border: none;
      color: #fff;
      cursor: pointer;
      border-radius: 4px;
      width: 22px;
      height: 22px;
      font-size: 12px;
      line-height: 1;
    }
    #ssc-duplicate-widget-body {
      display: none;
      background: #fff;
      padding: 6px 10px;
      max-height: 220px;
      overflow-y: auto;
    }
    #ssc-duplicate-widget.expanded #ssc-duplicate-widget-body {
      display: block;
    }
    #ssc-duplicate-widget-body a {
      display: block;
      font-size: 12px;
      padding: 5px 0;
      border-bottom: 1px solid #eee;
      color: #d9534f;
      text-decoration: none;
    }
    #ssc-duplicate-widget-body a:last-child {
      border-bottom: none;
    }
  `
  document.head.appendChild(style)
}

function posicionarWidgetAoLadoDoBotaoScroll(widget) {
  const grupo = document.getElementById('scroll-btn-group')
  if (!grupo) return

  const MARGEM_INFERIOR = 20

  const rectGrupo = grupo.getBoundingClientRect()
  const alturaWidget = widget.offsetHeight

  let topDesejado = rectGrupo.top + rectGrupo.height / 2 - alturaWidget / 2

  const limiteInferior = window.innerHeight - MARGEM_INFERIOR - alturaWidget
  if (topDesejado > limiteInferior) {
    topDesejado = limiteInferior
  }

  widget.style.bottom = 'auto'
  widget.style.top = `${topDesejado}px`
  widget.style.transform = 'none'
  widget.style.right = `${window.innerWidth - rectGrupo.left + 10}px`
}

function exibirWidgetDuplicidadeSSC(resultados) {
  if (document.getElementById('ssc-duplicate-widget')) return

  injetarEstiloWidgetSSC()

  const plural = resultados.length > 1 ? 's' : ''
  const itensHtml = resultados
    .map(item => {
      const href = item.href + (item.href.includes('?') ? '&' : '?') + 'sgd-from-widget=1'
      return `<a href="${href}" target="_blank">${escapeHTML(item.assunto)} — ${item.dias}d</a>`
    })
    .join('')

  const widget = document.createElement('div')
  widget.id = 'ssc-duplicate-widget'
  widget.innerHTML = `
    <div id="ssc-duplicate-widget-header">
      <span class="ssc-widget-title">⚠️ ${resultados.length} SSC${plural} parecida${plural}!</span>
      <button type="button" data-action="toggle" title="Expandir/Recolher">▲</button>
      <button type="button" data-action="close" title="Fechar">×</button>
    </div>
    <div id="ssc-duplicate-widget-body">${itensHtml}</div>
  `

  widget.querySelector('[data-action="toggle"]').addEventListener('click', e => {
    e.stopPropagation()
    const expandido = widget.classList.toggle('expanded')
    e.currentTarget.textContent = expandido ? '▾' : '▲'
    posicionarWidgetAoLadoDoBotaoScroll(widget)
  })

  widget.querySelector('[data-action="close"]').addEventListener('click', e => {
    e.stopPropagation()
    widget.remove()
  })

  document.body.appendChild(widget)
  posicionarWidgetAoLadoDoBotaoScroll(widget)
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. FLUXO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

let verificacaoDuplicidadeEmAndamento = false

async function iniciarVerificacaoDuplicidadeSSC() {
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.has('permitirUsarTramiteSscComoResposta')) {
    logDebug('[DEBUG] Modo "copiar trâmite" detectado — verificação de duplicidade ignorada.')
    return
  }
  if (urlParams.has('sgd-from-widget')) {
    logDebug('[DEBUG] SSC aberta pelo widget de duplicidade — verificação ignorada.')
    return
  }

  // Impede que uma nova execução comece enquanto outra ainda está em andamento
  if (verificacaoDuplicidadeEmAndamento) {
    logDebug('[DEBUG] Verificação já em andamento, ignorando nova chamada.')
    return
  }
  verificacaoDuplicidadeEmAndamento = true

  try {
    const btnPendentes = document.querySelector('input[value="SSCs Pendentes"]')
    if (!btnPendentes) return

    const onclickAttr = btnPendentes.getAttribute('onclick') || ''
    const match = onclickAttr.match(/clienteID=(\d+)/)
    if (!match) return
    const clienteId = match[1]

    const assuntoEl = document.querySelector('#td\\:assunto')
    const assuntoAtual = assuntoEl?.innerText?.trim()
    if (!assuntoAtual) return

    // O próprio atendimento ainda não foi finalizado pelo técnico anterior
    // (assunto placeholder) — não há conteúdo real para basear a busca.
    if (normalizarTextoSSC(assuntoAtual) === 'aguardando preenchimento') {
      logDebug('[DEBUG] Atendimento atual está "Aguardando preenchimento" — verificação de duplicidade ignorada.')
      return
    }

    const sscHiddenInput = document.querySelector('input[id*="ssc"]') || document.querySelector('input[name*="ssc"]')
    let sscAtualId = sscHiddenInput?.value?.trim() || null
    if (!sscAtualId) {
      const params = new URLSearchParams(window.location.search)
      sscAtualId = params.get('ssc')
    }

    logDebug('[DEBUG] clienteId:', clienteId, '| sscAtualId:', sscAtualId, '| assuntoAtual:', assuntoAtual)

    try {
      let candidatos = await obterCandidatosDoCache(clienteId)

      if (!candidatos) {
        const doc = await buscarDocumentoSSCsPendentes(clienteId)
        // Passamos null para lerResultadosTabelaSSC para obter todos os candidatos do cliente
        // e salvá-los no cache de forma genérica.
        candidatos = lerResultadosTabelaSSC(doc, null)
        await salvarCandidatosNoCache(clienteId, candidatos)
      }

      // Filtra o sscAtualId da busca para a comparação do caso atual
      const candidatosElegiveis = candidatos.filter(c => !(sscAtualId && c.href.includes(`ssc=${sscAtualId}`)))
      logDebug('[DEBUG] Candidatos elegíveis coletados para comparação:', candidatosElegiveis)

      if (candidatosElegiveis.length === 0) {
        logDebug('[DEBUG] Nenhum candidato elegível encontrado para comparação.')
        return
      }

      let usarIA = false
      try {
        if (window.sgdPermissions && typeof window.sgdPermissions.hasDuplicateCheckerIAAccess === 'function') {
          usarIA = await window.sgdPermissions.hasDuplicateCheckerIAAccess()
        }
      } catch (errAccess) {
        logDebug('[DEBUG] Erro ao verificar permissão do Verificador de Duplicidade IA:', errAccess)
      }

      let resultados = []
      if (usarIA) {
        try {
          const indicesParecidos = await compararSSCsComIA(assuntoAtual, candidatosElegiveis)
          resultados = indicesParecidos.map(i => candidatosElegiveis[i]).filter(Boolean)
          logDebug('[DEBUG] Resultados parecidos identificados pela IA:', resultados)
        } catch (erroIA) {
          console.error('[Verificador de Duplicidade] Erro na comparação por IA. Usando fallback por palavras-chave:', erroIA)
          resultados = candidatosElegiveis.filter(c => calcularSimilaridadeSSC(assuntoAtual, c.assunto))
          logDebug('[DEBUG] Resultados parecidos identificados pelo fallback:', resultados)
        }
      } else {
        logDebug('[DEBUG] Uso de IA desativado para este usuário. Executando fallback local de palavras-chave.')
        resultados = candidatosElegiveis.filter(c => calcularSimilaridadeSSC(assuntoAtual, c.assunto))
      }

      const relatorio = candidatosElegiveis.map(c => {
        const ehValido = resultados.some(r => r.href === c.href)
        return {
          assunto: c.assunto,
          dias: c.dias,
          statusParaOUsuario: ehValido ? '⚠️ VÁLIDO (Apresentado no Widget)' : '✅ IGNORADO (Diferente)'
        }
      })
      logDebug('[DEBUG] Relatório de Comparação de Candidatos:', relatorio)

      if (resultados.length > 0) {
        exibirWidgetDuplicidadeSSC(resultados)
      }
    } catch (erro) {
      console.error('[Verificador de Duplicidade] Erro:', erro)
    }

  } finally {
    verificacaoDuplicidadeEmAndamento = false
  }
}