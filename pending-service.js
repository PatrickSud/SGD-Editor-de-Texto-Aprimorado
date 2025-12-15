/**
 * @file pending-service.js
 * Serviço responsável por extrair e processar os dados de pendências do SGD.
 */

/**
 * URL da página de filtro de listas do SGD.
 */
const PENDING_ITEMS_URL = 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html'

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
 * Busca e processa a lista de pendências.
 * @returns {Promise<Array<object>>} Uma promessa que resolve com um array de objetos de pendência.
 */
async function fetchPendingItems() {
  try {
    const response = await fetch(PENDING_ITEMS_URL, {
        credentials: 'include', // Envia cookies de sessão
        cache: 'no-cache'
    })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Sessão expirada. Por favor, faça login novamente no SGD.')
      }
      throw new Error(`Erro ao acessar o SGD: ${response.status}`)
    }

    const htmlText = await response.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(htmlText, 'text/html')

    // Verificação robusta de login
    const dataTable = doc.querySelector('table.tablesorter')
    
    if (!dataTable) {
        const passwordInput = doc.querySelector('input[type="password"]')
        const loginForm = doc.querySelector('form[action*="login"]') || doc.querySelector('#login-form')
        
        if (passwordInput || loginForm) {
             throw new Error('Você não está logado no SGD. Por favor, faça login.')
        }
        
        const errorMsg = doc.querySelector('.ui-messages-error-summary, .erro')?.innerText
        if (errorMsg) {
            throw new Error(`Erro no SGD: ${errorMsg.trim()}`)
        }
        
        console.warn('PendingService: Tabela não encontrada e não parece ser login. Layout pode ter mudado.')
        return [] 
    }

    const rows = dataTable.querySelectorAll('tbody > tr')
    const pendingItems = []

    rows.forEach(row => {
      const cells = row.cells

      if (cells.length < 13) return

      try {
        // ID: Coluna 0
        const id = cells[0].innerText.trim()
        
        // Verifica se a pendência é prioritária (classe tableListaRowWarningBlue na célula do ID)
        const isPrioritaria = cells[0].classList.contains('tableListaRowWarningBlue')

        // Data Abertura: Coluna 1 (Limpa spans ocultos)
        const dataAbertura = cleanDateText(cells[1])

        // Dias: Coluna 2
        const dias = cells[2].innerText.trim()

        // Último Trâmite: Coluna 3 (Limpa spans ocultos)
        const dataUltimoTramite = cleanDateText(cells[3])

        // Qtd Trâmites: Coluna 4
        const qtdTramites = cells[4].innerText.trim()

        // Assunto e Link: Coluna 5
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

        // Status: Coluna 12
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
          isPrioritaria
        })
      } catch (err) {
        console.warn('Erro ao processar linha de pendência:', err, row)
      }
    })

    return pendingItems

  } catch (error) {
    console.error('PendingService: Falha ao buscar pendências.', error)
    throw error
  }
}
