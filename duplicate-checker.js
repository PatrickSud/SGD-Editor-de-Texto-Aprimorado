/**
 * @file duplicate-checker.js
 * Verificador automático de SSCs com assunto parecido, do mesmo cliente,
 * dentro de um período de 90 dias.
 */

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
    .filter(palavra => palavra.length > 4)
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. JANELA OCULTA — ESPERA DE CARREGAMENTO POR TROCA DE DOCUMENTO
// ─────────────────────────────────────────────────────────────────────────────

function aguardarNovoDocumentoCarregado(win, documentoAnterior) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now()
    const TIMEOUT_MS = 15000

    const checarPronto = () => {
      try {
        if (win.closed) {
          reject(new Error('Janela foi fechada antes do carregamento terminar.'))
          return
        }
        const documentoTrocou = win.document !== documentoAnterior
        const carregamentoCompleto = win.document.readyState === 'complete'

        if (documentoTrocou && carregamentoCompleto) {
          resolve(win.document)
          return
        }
      } catch (e) {
        // Ignora erros temporários de acesso durante a transição de página
      }

      if (Date.now() - inicio > TIMEOUT_MS) {
        reject(new Error('Timeout ao aguardar carregamento da página de SSCs Pendentes.'))
        return
      }

      setTimeout(checarPronto, 150)
    }

    checarPronto()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LEITURA DA TABELA DE RESULTADOS
// ─────────────────────────────────────────────────────────────────────────────

function lerResultadosTabelaSSC(win, assuntoAtual, sscAtualId) {
  const linhas = win.document.querySelectorAll('table.tableSorter tbody tr')
  console.log('[DEBUG] Total de linhas na tabela:', linhas.length)

  const resultados = []

  linhas.forEach(tr => {
    const diasTd = tr.querySelector('td[id^="td:dias_"]')
    const assuntoTd = tr.querySelector('td[id^="td:assunto_"]')
    if (!diasTd || !assuntoTd) return

    const dias = parseInt(diasTd.textContent.trim(), 10)
    const link = assuntoTd.querySelector('a')
    const assuntoCandidato = link ? link.textContent.trim() : '(sem link)'

    console.log('[DEBUG] Linha encontrada — assunto:', assuntoCandidato, '| dias:', dias, '| href:', link?.href)

    if (isNaN(dias) || dias > 90) {
      console.log('[DEBUG]   -> descartada: fora do prazo de 90 dias')
      return
    }
    if (!link) return

    if (sscAtualId && link.href.includes(`ssc=${sscAtualId}`)) {
      console.log('[DEBUG]   -> descartada: é a própria SSC atual')
      return
    }

    const parecido = calcularSimilaridadeSSC(assuntoAtual, assuntoCandidato)
    console.log('[DEBUG]   -> parecido com a atual?', parecido)
    if (!parecido) return

    resultados.push({
      assunto: assuntoCandidato,
      href: link.href,
      dias
    })
  })

  return resultados
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
      bottom: 80px;
      right: 0;
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
  const botaoScroll = document.getElementById('floating-scroll-top-btn')

  // Se o botão não existe ou não está visível, mantém a posição padrão do CSS
  if (!botaoScroll || !botaoScroll.classList.contains('visible')) return

  const MARGEM_INFERIOR = 20 // espaço mínimo entre o widget e o fundo da tela

  const rectBotao = botaoScroll.getBoundingClientRect()
  const alturaWidget = widget.offsetHeight

  let topDesejado = rectBotao.top + rectBotao.height / 2 - alturaWidget / 2

  // Não deixa o widget passar do limite inferior da tela
  const limiteInferior = window.innerHeight - MARGEM_INFERIOR - alturaWidget
  if (topDesejado > limiteInferior) {
    topDesejado = limiteInferior
  }

  widget.style.bottom = 'auto'
  widget.style.top = `${topDesejado}px`
  widget.style.transform = 'none'
  widget.style.right = `${window.innerWidth - rectBotao.left + 10}px`
}

function exibirWidgetDuplicidadeSSC(resultados) {
  if (document.getElementById('ssc-duplicate-widget')) return

  injetarEstiloWidgetSSC()

  const plural = resultados.length > 1 ? 's' : ''
  const itensHtml = resultados
    .map(item => `<a href="${item.href}" target="_blank">${escapeHTML(item.assunto)} — ${item.dias}d</a>`)
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
  if (verificacaoDuplicidadeEmAndamento) {
    console.log('[DEBUG] Verificação já em andamento, ignorando nova chamada.')
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

    const sscHiddenInput = document.querySelector('input[id*="ssc"]') || document.querySelector('input[name*="ssc"]')
    let sscAtualId = sscHiddenInput?.value?.trim() || null
    if (!sscAtualId) {
      const params = new URLSearchParams(window.location.search)
      sscAtualId = params.get('ssc')
    }

    const url = `${window.location.origin}/sgsc/faces/sscs-pendentes.html?clienteID=${clienteId}`
    console.log('[DEBUG] clienteId:', clienteId, '| sscAtualId:', sscAtualId, '| assuntoAtual:', assuntoAtual)

    const nomeJanela = `sgd-duplicate-checker-${Date.now()}`

    let win
    try {
      win = window.open(url, nomeJanela, 'width=300,height=300,left=-3000,top=-3000')
      if (win) {
        win.blur()
        window.focus()
      }
    } catch (e) {
      win = null
    }

    if (!win) {
      showNotification(
        '🔒 Não foi possível verificar atendimentos semelhantes — permita pop-ups para este site.',
        'error',
        6000
      )
      return
    }

    try {
      const documentoEmBranco = win.document
      await aguardarNovoDocumentoCarregado(win, documentoEmBranco)

      const situacaoSelect = win.document.getElementById('relSscForm:situacao')
      const responsavelSelect = win.document.getElementById('relSscForm:responsavel')
      const atualizarBtn = win.document.getElementById('relSscForm:atualizarBtn')

      console.log('[DEBUG] Elementos encontrados na janela?', !!situacaoSelect, !!responsavelSelect, !!atualizarBtn)

      if (!situacaoSelect || !responsavelSelect || !atualizarBtn) {
        win.close()
        return
      }

      situacaoSelect.value = '0'
      situacaoSelect.dispatchEvent(new Event('change', { bubbles: true }))

      await new Promise(r => setTimeout(r, 500))

      const responsavelSelectAtualizado = win.document.getElementById('relSscForm:responsavel')
      responsavelSelectAtualizado.value = '0'
      responsavelSelectAtualizado.dispatchEvent(new Event('change', { bubbles: true }))

      console.log('[DEBUG] Situação:', situacaoSelect.value, '| Responsável:', responsavelSelectAtualizado.value)

      const documentoAntesDoClique = win.document
      atualizarBtn.click()
      await aguardarNovoDocumentoCarregado(win, documentoAntesDoClique)

      console.log('[DEBUG] Novo documento carregado após Atualizar.')

      const resultados = lerResultadosTabelaSSC(win, assuntoAtual, sscAtualId)
      console.log('[DEBUG] Resultados finais:', resultados)
      win.close()

    if (resultados.length > 0) {
            exibirWidgetDuplicidadeSSC(resultados)
          }
    } catch (erro) {
      console.error('[Verificador de Duplicidade] Erro:', erro)
      if (win && !win.closed) win.close()
    }
  } finally {
    verificacaoDuplicidadeEmAndamento = false
  }
}