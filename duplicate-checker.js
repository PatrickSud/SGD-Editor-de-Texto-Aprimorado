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
    .split(/\s+/)
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
// 2. JANELA OCULTA — ABERTURA, NAVEGAÇÃO E ESPERA DE CARREGAMENTO
// ─────────────────────────────────────────────────────────────────────────────

function aguardarCarregamentoJanelaSSC(win, aguardarNavegacaoIniciar = false) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now()
    const TIMEOUT_MS = 15000

    const checarPronto = () => {
      try {
        if (win.closed) {
          reject(new Error('Janela foi fechada antes do carregamento terminar.'))
          return
        }
        if (win.document.readyState === 'complete') {
          resolve()
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

    // Se for depois de um clique que recarrega a página, espera 300ms
    // pra garantir que a navegação já começou antes de checar
    setTimeout(checarPronto, aguardarNavegacaoIniciar ? 300 : 0)
  })
}

function lerResultadosTabelaSSC(win, assuntoAtual) {
  const linhas = win.document.querySelectorAll('table.tableSorter tbody tr')
  const resultados = []

  linhas.forEach(tr => {
    const diasTd = tr.querySelector('td[id^="td:dias_"]')
    const assuntoTd = tr.querySelector('td[id^="td:assunto_"]')
    if (!diasTd || !assuntoTd) return

    const dias = parseInt(diasTd.textContent.trim(), 10)
    if (isNaN(dias) || dias > 90) return

    const link = assuntoTd.querySelector('a')
    if (!link) return

    const assunto = link.textContent.trim()
    if (!calcularSimilaridadeSSC(assuntoAtual, assunto)) return

    resultados.push({
      assunto,
      href: link.href,
      dias
    })
  })

  return resultados
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INDICADOR VISUAL (TEXTO PISCANDO)
// ─────────────────────────────────────────────────────────────────────────────

function injetarEstiloPiscandoSSC() {
  if (document.getElementById('ssc-duplicate-style')) return
  const style = document.createElement('style')
  style.id = 'ssc-duplicate-style'
  style.textContent = `
    @keyframes sscDuplicateBlink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }
    #ssc-duplicate-indicator {
      margin-left: 10px;
      color: #d9534f;
      font-weight: bold;
      cursor: pointer;
      animation: sscDuplicateBlink 1.2s infinite;
      font-size: 13px;
      vertical-align: middle;
    }
  `
  document.head.appendChild(style)
}

function exibirIndicadorDuplicidadeSSC(btnPendentes, resultados) {
  if (document.getElementById('ssc-duplicate-indicator')) return

  injetarEstiloPiscandoSSC()

  const plural = resultados.length > 1 ? 's' : ''
  const indicador = document.createElement('span')
  indicador.id = 'ssc-duplicate-indicator'
  indicador.textContent = `${resultados.length} SSC${plural} parecida${plural}`

  indicador.addEventListener('click', () => abrirModalResultadosSSC(resultados))

  btnPendentes.insertAdjacentElement('afterend', indicador)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MODAL DE RESULTADOS
// ─────────────────────────────────────────────────────────────────────────────

function abrirModalResultadosSSC(resultados) {
  const itensHtml = resultados
    .map(item => `
      <li style="margin-bottom: 10px;">
        <a href="${item.href}" target="_blank">${escapeHTML(item.assunto)}</a>
        <span style="color: var(--text-color-muted); font-size: 12px;"> — ${item.dias} dia${item.dias !== 1 ? 's' : ''} aberto</span>
      </li>
    `)
    .join('')

  const contentHtml = `
    <p>Encontramos as seguintes SSCs com assunto parecido, do mesmo cliente, abertas há até 90 dias:</p>
    <ul style="margin-top: 10px; padding-left: 20px;">
      ${itensHtml}
    </ul>
  `

  showInfoModal('🔎 SSCs Parecidas Encontradas', contentHtml)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. FLUXO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

let verificacaoDuplicidadeEmAndamento = false

async function iniciarVerificacaoDuplicidadeSSC() {
  // Impede que uma nova execução comece enquanto outra ainda está em andamento
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

    const url = `${window.location.origin}/sgsc/faces/sscs-pendentes.html?clienteID=${clienteId}`

    // Nome único por execução — evita reaproveitar uma janela de uma execução anterior
    const nomeJanela = `sgd-duplicate-checker-${Date.now()}`

    let win
    try {
      win = window.open(url, nomeJanela, 'width=300,height=300,left=-3000,top=-3000')
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
      await aguardarCarregamentoJanelaSSC(win)

      const situacaoSelect = win.document.getElementById('relSscForm:situacao')
      const responsavelSelect = win.document.getElementById('relSscForm:responsavel')
      const atualizarBtn = win.document.getElementById('relSscForm:atualizarBtn')

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

      const loadPromise = aguardarCarregamentoJanelaSSC(win, true)
      atualizarBtn.click()
      await loadPromise

      const resultados = lerResultadosTabelaSSC(win, assuntoAtual)
      win.close()

      if (resultados.length > 0) {
        exibirIndicadorDuplicidadeSSC(btnPendentes, resultados)
      }
    } catch (erro) {
      console.error('[Verificador de Duplicidade] Erro:', erro)
      if (win && !win.closed) win.close()
    }
  } finally {
    verificacaoDuplicidadeEmAndamento = false
  }
}