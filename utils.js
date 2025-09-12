/**
 * @file utils.js
 * @description Funções utilitárias gerais, de segurança e auxiliares.
 */

// --- UTILITÁRIOS GERAIS E DE SEGURANÇA ---

/**
 * Escapa caracteres HTML para prevenir XSS.
 * @param {string} str - A string a ser escapada.
 * @returns {string} A string escapada.
 */
function escapeHTML(str) {
  if (typeof str !== 'string') return ''
  return str.replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m])
  )
}

/**
 * Valida se uma URL usa um protocolo seguro (http, https, mailto).
 * @param {string} url - A URL a ser validada.
 * @returns {boolean} Verdadeiro se a URL for válida e segura.
 */
function isValidUrl(url) {
  try {
    let normalizedUrl = url
    if (!/^[a-zA-Z]+:\/\//.test(url) && !url.startsWith('mailto:')) {
      normalizedUrl = 'https://' + url
    }
    const parsedUrl = new URL(normalizedUrl)
    return ['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)
  } catch (e) {
    return false
  }
}

/**
 * Localiza o textarea alvo na página (SGD).
 * @returns {HTMLTextAreaElement | null} O elemento textarea ou null.
 */
function getTargetTextArea() {
  for (const selector of TARGET_TEXTAREA_SELECTORS) {
    const textArea = document.querySelector(selector)
    if (textArea) return textArea
  }
  return null
}

/**
 * Formata um objeto Date para o formato esperado pelo input datetime-local.
 * @param {Date} date - O objeto Date a ser formatado.
 * @returns {string} A string formatada.
 */
function getLocalDateTimeString(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    date = new Date()
  }
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

// --- UTILITÁRIOS DE EXTRAÇÃO DE CONTEÚDO (Para IA) ---

/**
 * Extrai conteúdo e dados relevantes da página.
 * @returns {{rawContent: string, relevantData: object}} Objeto com o conteúdo para a IA e dados estruturados.
 */
function extractPageContentForAI() {
  let rawContent = ''
  const relevantData = {
    openingDate: null,
    accessData: new Set(), // Usar Set para evitar duplicatas
    attachments: []
  }

  const getContentCellByLabel = labelTextKeywords => {
    const labels = Array.from(
      document.querySelectorAll(
        'td.tableVisualizacaoLabel, td.tableVisualizacaoDestaque, td.tableVisualizacaoField b'
      )
    )
    for (const label of labels) {
      const labelText = (label.innerText || '').trim().toLowerCase()
      if (labelTextKeywords.some(keyword => labelText.startsWith(keyword))) {
        return label
          .closest('tr')
          .querySelector(
            'td[colspan="5"], td.tableVisualizacaoHtml, td.textofixo'
          )
      }
    }
    return null
  }

  const subjectCell = getContentCellByLabel(['assunto:'])
  if (subjectCell)
    rawContent +=
      'Assunto: ' +
      (subjectCell.innerText || '').replace(/Assunto:/i, '').trim() +
      '\n\n'

  const descriptionCell = getContentCellByLabel([
    'descrição:',
    'descreva de forma detalhada'
  ])
  if (descriptionCell)
    rawContent +=
      'Descrição Inicial:\n' + (descriptionCell.innerText || '').trim() + '\n\n'

  // Captura dados de acesso explícitos
  const accessDataCell = getContentCellByLabel([
    'informações do banco de dados:'
  ])
  if (accessDataCell) {
    const accessText = (accessDataCell.innerText || '').trim()
    if (accessText) relevantData.accessData.add(accessText)
  }

  document.querySelectorAll('tr').forEach(row => {
    const rowText = (row.innerText || '').trim()
    if (rowText.includes('Entrada:') && !relevantData.openingDate) {
      const scriptTag = row.querySelector('script')
      if (scriptTag) {
        const match = scriptTag.innerHTML.match(/ajustarTempo\((\d+)/)
        if (match && match[1]) relevantData.openingDate = parseInt(match[1], 10)
      }
    }
    if (rowText.startsWith('Anexo:')) {
      row.querySelectorAll('a[href*="anexoss"]').forEach(link => {
        relevantData.attachments.push({
          fileName: (link.innerText || '').trim(),
          fileUrl: link.href
        })
      })
    }
  })

  const tramites = []
  const fullTramiteTextForCredentialScan = [] // Array para armazenar texto de todos os trâmites

  document.querySelectorAll('table.tableVisualizacao').forEach(table => {
    const headerRow = table.querySelector('tr')
    if (
      headerRow &&
      (headerRow.innerText || '').includes('Número:') &&
      (headerRow.innerText || '').includes('Usuário:')
    ) {
      try {
        const dateElement = Array.from(headerRow.querySelectorAll('td')).find(
          td =>
            (td.innerText || '').includes('Data:') ||
            (td.innerText || '').includes('Entrada:')
        )
        const userElement = Array.from(headerRow.querySelectorAll('td')).find(
          td => (td.innerText || '').includes('Usuário:')
        )
        const descriptionElement = table.querySelector(
          '.textofixo div, td[colspan="12"], td[colspan="6"]'
        )

        const date = dateElement
          ? (dateElement.innerText || '').replace(/Data:|Entrada:/i, '').trim()
          : 'N/A'
        const user = userElement
          ? (userElement.innerText || '').replace(/Usuário:/i, '').trim()
          : 'Sistema'
        let description =
          descriptionElement && descriptionElement.innerText
            ? descriptionElement.innerText.replace(/^Descrição:/i, '').trim()
            : ''

        if (description && description.toLowerCase() !== 'nenhuma') {
          tramites.push(`[${date}] ${user}:\n${description}`)
          fullTramiteTextForCredentialScan.push(description)
        }

        const anexoRow = Array.from(table.querySelectorAll('tr')).find(tr =>
          (tr.innerText || '').trim().startsWith('Anexo:')
        )
        if (anexoRow) {
          anexoRow.querySelectorAll('a[href*="anexoss"]').forEach(link => {
            relevantData.attachments.push({
              fileName: (link.innerText || '').trim(),
              fileUrl: link.href
            })
          })
        }
      } catch (e) {
        console.warn('Erro ao processar uma tabela de trâmite:', e)
      }
    }
  })

  // Nova lógica para encontrar dados de acesso dentro dos trâmites
  const credentialRegex =
    /(?:usu[áa]rio|login|email|senha|acesso|user|password)[\s:]*[\w\.\-@]+/gi
  const allTramitesText = fullTramiteTextForCredentialScan.join('\n')
  const matches = allTramitesText.match(credentialRegex)
  if (matches) {
    matches.forEach(match => relevantData.accessData.add(match.trim()))
  }

  if (tramites.length > 0) {
    rawContent += 'Trâmites Anteriores:\n' + tramites.join('\n---\n')
  }

  relevantData.accessData = Array.from(relevantData.accessData)
  return { rawContent: rawContent.trim(), relevantData }
}

/**
 * Gera um hash numérico simples de uma string.
 * @param {string} str A string de entrada.
 * @returns {number} O hash gerado.
 */
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash
}

/**
 * Calcula a próxima data de um alarme recorrente.
 * @param {Date} lastDate A última data do alarme.
 * @param {string} recurrence A regra ('daily', 'weekly', 'monthly').
 * @returns {Date | null} A nova data ou null se a recorrência for 'none'.
 */
function getNextRecurrenceDate(lastDate, recurrence) {
  if (!recurrence || recurrence === 'none') return null

  const nextDate = new Date(lastDate.getTime())
  switch (recurrence) {
    case 'daily':
      nextDate.setDate(nextDate.getDate() + 1)
      break
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7)
      break
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1)
      break
    default:
      return null
  }
  return nextDate
}

/**
 * Formata uma data para um formato relativo e legível.
 * @param {string | Date} dateInput - A data a ser formatada.
 * @returns {string} A data formatada de forma relativa (ex: "Amanhã às 10:00").
 */
function formatRelativeTime(dateInput) {
  const date = new Date(dateInput)
  const now = new Date()
  const diffInSeconds = (date.getTime() - now.getTime()) / 1000
  const diffInDays = Math.round(diffInSeconds / (60 * 60 * 24))

  const timeFormat = { hour: '2-digit', minute: '2-digit' }
  const timeString = date.toLocaleTimeString('pt-BR', timeFormat)
  const dateFormat = { day: '2-digit', month: '2-digit' }
  const dateString = date.toLocaleDateString('pt-BR', dateFormat)

  if (diffInDays === 0) return `Hoje, ${timeString}`
  if (diffInDays === 1) return `Amanhã, ${timeString}`
  if (diffInDays === -1) return `Ontem, ${timeString}`

  if (diffInSeconds > 0) {
    if (diffInDays < 7) return `Em ${diffInDays} dias, ${timeString}`
  } else {
    if (diffInDays > -7) return `Há ${-diffInDays} dias`
  }

  return `Em ${dateString}`
}
