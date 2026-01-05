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

    // Identificar índice da coluna "Responsável"
    let responsibleColIndex = -1
    const headers = dataTable.querySelectorAll('thead th')
    headers.forEach((th, index) => {
        if (th.innerText.toLowerCase().includes('responsável')) {
            responsibleColIndex = index
        }
    })

    // Detectar Filtro do Site Ativo (Session State)
    // Detectar Filtros do Site Ativos (Session State)
    const filterIds = [
        { id: 'filtrosForm:responsavel', label: 'Responsável', default: '0' },
        { id: 'filtrosForm:sistema', label: 'Sistema', default: '0' },
        { id: 'filtrosForm:modulo', label: 'Módulo', default: '0' },
        { id: 'filtrosForm:topicoSuporte', label: 'Tópico', default: '0' },
        { id: 'filtrosForm:situacao', label: 'Situação', default: '0' },
        { id: 'filtrosForm:classificacaoSSC', label: 'Classificação', default: '0' },
        { id: 'filtrosForm:meioAcesso', label: 'Meio de Acesso', default: '0' },
        { id: 'filtrosForm:origem', label: 'Subtópico', default: '0' },
        { id: 'filtrosForm:palavraChave', label: 'Palavra-chave', type: 'text', default: '' }
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
                    if ((selectedOption && selectedOption.hasAttribute('selected')) || val !== '0') {
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
        siteFilter.name = activeFilters.length === 1 ? activeFilters[0] : `${activeFilters.length} filtros ativos`
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
        // Verifica classes tableListaRowWarningBlue (Prioridade Azul) e tableListaRowWarning (Prioridade Amarela)
        const isPrioritaria = cells[0].classList.contains('tableListaRowWarningBlue') || 
                              cells[0].classList.contains('tableListaRowWarning')

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

        // Responsável (Dinâmico)
        let responsible = 'Desconhecido'
        if (responsibleColIndex > -1 && cells[responsibleColIndex]) {
            responsible = cells[responsibleColIndex].innerText.trim()
        }

        // Verifica se é "Em SS" (texto vermelho)
        // O SGD coloca style="color: red;" no TR ou no A quando há retorno de SS
        const rowStyle = (row.getAttribute('style') || '').toLowerCase()
        const anchorStyle = anchor ? (anchor.getAttribute('style') || '').toLowerCase() : ''
        const isEmSS = rowStyle.includes('color: red') || anchorStyle.includes('color: red')

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
          responsible,
          isPrioritaria,
          isEmSS
        })
    
      } catch (err) {
      }
    })

    return { items: pendingItems, siteFilter }
  } catch (error) { throw error }
}

async function resetSiteFilter() {
    const isOnFilterPage = window.location.href.includes('filtro-listas.html')
    
    if (isOnFilterPage) {
        
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

        // 1. Reseta Selects
        filterIds.forEach(id => {
            const select = document.getElementById(id)
            if (select) {
                select.value = '0'
                select.selectedIndex = 0
                select.dispatchEvent(new Event('change', { bubbles: true }))
            }
        })

        // 2. Reseta Input Texto
        const textInput = document.getElementById('filtrosForm:palavraChave')
        if (textInput) {
            textInput.value = ''
            textInput.dispatchEvent(new Event('input', { bubbles: true }))
            textInput.dispatchEvent(new Event('change', { bubbles: true }))
        }

        // 3. Clica em Pesquisar/Atualizar
        const btn = document.getElementById('filtrosForm:atualizarBtn') || 
                    document.querySelector('button[id*="pesquisar"]') || 
                    document.querySelector('input[type="submit"][value*="Pesquisar"]') ||
                    document.querySelector('a[onclick*="pesquisar"]') ||
                    document.getElementById('filtrosForm:pesquisar')

        if (btn) {
            await new Promise(r => setTimeout(r, 150)) // Delay leve
            btn.click()
            return true
        } else {
             console.warn('Botão de pesquisar não encontrado.')
        }

    } else {
        alert('Redirecionando para a página de Pendências para limpar os filtros...')
        window.location.href = 'https://sgd.dominiosistemas.com.br/sgpub/faces/filtro-listas.html'
        return true
    }
    
    return false
}

/**
 * Verifica se há novas pendências comparando com as últimas visualizadas.
 * @returns {Promise<{total: number, newCount: number, newItems: Array<object>}>}
 */
async function checkNewPendings() {
  try {
    const { items: currentItems } = await fetchPendingItems()
    const result = await chrome.storage.local.get(['lastSeenPendingIds'])
    const lastSeenIds = result.lastSeenPendingIds || []

    const newItems = currentItems.filter(item => !lastSeenIds.includes(item.id))

    const resultData = {
      total: currentItems.length,
      newCount: newItems.length,
      newItems: newItems,
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
        if (t.name === 'Aguardando SS') { t.name = 'Em SS'; changed = true; }
        if (t.name === 'Aguardando SA/NE') { t.name = 'Em SA/NE'; changed = true; }
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