/**
 * @file duplicate-checker.js
 * Verifica se existe outro atendimento pendente do mesmo cliente
 * com assunto semelhante ao ticket atual, e notifica o analista.
 *
 * Estratégia:
 * 1. Lê clienteId e assunto do ticket atual via DOM
 * 2. Abre sscs-pendentes.html invisível (fora da tela)
 * 3. Reseta filtros de situação e responsável para "Todos"
 * 4. Clica em Atualizar e aguarda a tabela renderizar
 * 5. Lê os tickets, filtra por assunto similar
 * 6. Fecha a janela e exibe modal se encontrar duplicatas
 */

/**
 * Compara dois assuntos por palavras-chave.
 * Retorna true se tiver 2 ou mais palavras relevantes em comum.
 * @param {string} assuntoAtual
 * @param {string} assuntoPendente
 * @returns {boolean}
 */
function _assuntosSemelhantes(assuntoAtual, assuntoPendente) {
  const extrairPalavras = texto =>
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .split(/\s+/)
      .map(p => p.replace(/[^a-z]/g, ''))
      .filter(p => p.length > 4)

  const palavrasAtual = extrairPalavras(assuntoAtual)
  const assuntoPendenteLower = assuntoPendente
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const matches = palavrasAtual.filter(p => assuntoPendenteLower.includes(p))
  return matches.length >= 2
}

/**
 * Abre a janela de SSCs do cliente, reseta filtros,
 * aguarda renderização e retorna os tickets encontrados.
 * @param {string} clienteId
 * @returns {Promise<Array<{subject: string, link: string, dias: string, status: string}>>}
 */
function _buscarTicketsDoCliente(clienteId) {
  return new Promise((resolve) => {
    const janela = window.open(
      `https://sgd.dominiosistemas.com.br/sgsc/faces/sscs-pendentes.html?clienteID=${clienteId}`,
      '_blank',
      'width=1,height=1,left=-9999,top=-9999'
    )

    if (!janela) {
      console.warn('[DuplicateChecker] Janela bloqueada pelo navegador.')
      resolve([])
      return
    }

    // Etapa 1 — aguarda página inicial carregar e reseta filtros
    setTimeout(() => {
      try {
        const doc = janela.document

        const situacao = doc.getElementById('relSscForm:situacao')
        if (situacao) {
          situacao.value = '0'
          situacao.dispatchEvent(new janela.Event('change', { bubbles: true }))
        }

        const responsavel = doc.getElementById('relSscForm:responsavel')
        if (responsavel) {
          responsavel.value = '0'
          responsavel.dispatchEvent(new janela.Event('change', { bubbles: true }))
        }

        const btnAtualizar = doc.getElementById('relSscForm:atualizarBtn')
        if (btnAtualizar) {
          btnAtualizar.click()
        } else {
          console.warn('[DuplicateChecker] Botão Atualizar não encontrado.')
          janela.close()
          resolve([])
          return
        }
      } catch (e) {
        console.warn('[DuplicateChecker] Erro ao resetar filtros:', e)
        janela.close()
        resolve([])
      }
    }, 4000)

    // Etapa 2 — aguarda tabela recarregar após clique e lê os dados
    setTimeout(() => {
      try {
        const doc = janela.document
        const rows = doc.querySelectorAll('table.tablesorter tbody tr')
        const tickets = []

        rows.forEach(row => {
          const cells = row.querySelectorAll('td')
          if (cells.length < 5) return

          const anchor = cells[4]?.querySelector('a') ||
                         row.querySelector('td a')
          if (!anchor) return

          const subject = anchor.textContent?.trim()
          const href = anchor.getAttribute('href')
          const link = href?.startsWith('http')
            ? href
            : `https://sgd.dominiosistemas.com.br${href}`

          const dias = cells[2]?.textContent?.trim() || '?'

          // Status via imagem (mesmo padrão do pending-service.js)
          const imgStatus = cells[cells.length - 1]?.querySelector('img')
          const status = imgStatus?.getAttribute('title') ||
                         cells[cells.length - 1]?.textContent?.trim() ||
                         'Desconhecido'

          if (subject) {
            tickets.push({ subject, link, dias, status })
          }
        })

        janela.close()
        resolve(tickets)
      } catch (e) {
        console.warn('[DuplicateChecker] Erro ao ler tabela:', e)
        janela.close()
        resolve([])
      }
    }, 9000)
  })
}

/**
 * Exibe o modal com os tickets duplicados confirmados.
 * @param {Array} duplicatas
 * @param {string} assuntoAtual
 */
function _exibirModalDuplicatas(duplicatas, assuntoAtual) {
  const listaHtml = duplicatas.map(item => `
    <div style="
      padding: 10px 12px;
      margin-bottom: 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--bg-primary);
      font-size: 13px;
      line-height: 1.6;
    ">
      <div style="font-weight: bold; margin-bottom: 4px;">
        <a href="${item.link}" target="_blank" rel="noopener noreferrer"
           style="color: var(--accent-color);">
          ${escapeHTML(item.subject)}
        </a>
      </div>
      <div style="font-size: 12px; color: var(--text-color-muted);">
        📅 Aberto há <strong>${item.dias}</strong> dia(s) &nbsp;|&nbsp;
        📌 ${escapeHTML(item.status)}
      </div>
    </div>
  `).join('')

  const modal = createModal(
    '⚠️ Atendimento Similar Encontrado',
    `<p style="margin-bottom: 12px; font-size: 13px;">
       Este cliente já possui atendimento(s) pendente(s) com assunto semelhante a
       <strong>"${escapeHTML(assuntoAtual)}"</strong>:
     </p>
     <div style="max-height: 350px; overflow-y: auto; padding-right: 4px;">
       ${listaHtml}
     </div>
     <p style="margin-top: 12px; font-size: 12px; color: var(--text-color-muted);">
       Verifique se este atendimento já está sendo tratado antes de prosseguir.
     </p>`,
    (_modalContent, closeModal) => {
      closeModal()
    }
  )

  const saveBtn = modal.querySelector('#modal-save-btn')
  if (saveBtn) saveBtn.textContent = 'Entendido, continuar'

  const cancelBtn = modal.querySelector('#modal-cancel-btn')
  if (cancelBtn) cancelBtn.remove()

  document.body.appendChild(modal)
}

/**
 * Ponto de entrada principal.
 * Chamado pelo main.js quando a página ssc.html carrega.
 */
async function verificarDuplicatas() {
  if (!window.location.pathname.includes('/sgsc/faces/ssc.html')) return

  // Verifica se o recurso está ativado nas configurações
  const settings = await getSettings()
  if (settings.preferences?.enableDuplicateChecker !== true) {
    console.log('[DuplicateChecker] Detector de duplicatas desativado nas preferências.')
    return
  }

  // Lê dados do ticket atual
  const clienteLink = document.querySelector('#td\\:cliente a')
  if (!clienteLink) return

  const clienteId = new URLSearchParams(
    clienteLink.href.split('?')[1]
  ).get('clienteID')
  if (!clienteId) return

  const assuntoAtual = document.querySelector('#td\\:assunto')
    ?.textContent?.trim()
  if (!assuntoAtual || assuntoAtual === 'N/A') return

  const numeroAtual = document.querySelector('#td\\:numero')
    ?.textContent?.trim()

  console.log('[DuplicateChecker] Iniciando verificação para cliente:', clienteId, '| assunto:', assuntoAtual)

  // Busca todos os tickets do cliente
  const tickets = await _buscarTicketsDoCliente(clienteId)
  console.log('[DuplicateChecker] Total tickets do cliente:', tickets.length)

  if (!tickets.length) return

  // Filtra por assunto similar, excluindo o ticket atual
  const duplicatas = tickets.filter(item => {
    // Exclui o próprio ticket atual pelo número no link
    const sscMatch = item.link?.match(/[?&]ssc=(\d+)/)
    const numeroPendente = sscMatch ? sscMatch[1] : null
    if (numeroPendente === numeroAtual) return false

    return _assuntosSemelhantes(assuntoAtual, item.subject)
  })

  console.log('[DuplicateChecker] Duplicatas encontradas:', duplicatas.length)

  if (!duplicatas.length) return

  _exibirModalDuplicatas(duplicatas, assuntoAtual)
}