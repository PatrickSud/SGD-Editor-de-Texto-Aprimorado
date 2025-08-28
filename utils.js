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
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }
  return str.replace(/[&<>"']/g, m => map[m])
}

/**
 * Valida se uma URL usa um protocolo seguro (http, https, mailto).
 * @param {string} url - A URL a ser validada.
 * @returns {boolean} Verdadeiro se a URL for válida e segura.
 */
function isValidUrl(url) {
  try {
    let normalizedUrl = url
    // Tenta normalizar se não tiver protocolo.
    if (!/^[a-zA-Z]+:\/\//.test(url) && !url.startsWith('mailto:')) {
      normalizedUrl = 'https://' + url
    }
    const parsedUrl = new URL(normalizedUrl)
    // Verifica se o protocolo final é seguro.
    return ['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)
  } catch (e) {
    return false
  }
}

/**
 * Localiza o textarea alvo na página (SGD).
 * Utiliza os seletores definidos em config.js.
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
 * Formata um objeto Date para o formato esperado pelo input datetime-local (YYYY-MM-DDTHH:mm),
 * considerando o fuso horário local do usuário.
 * @param {Date} date - O objeto Date a ser formatado.
 * @returns {string} A string formatada.
 */
function getLocalDateTimeString(date) {
  // Ajuste necessário para que o input datetime-local mostre a hora correta localmente
  // (toISOString() retorna em UTC, então compensamos o offset do fuso horário)
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  // Verifica se a data resultante é válida
  if (isNaN(localDate.getTime())) {
    // Fallback se a data original era inválida
    return getLocalDateTimeString(new Date())
  }
  // Retorna os primeiros 16 caracteres (YYYY-MM-DDTHH:mm)
  return localDate.toISOString().slice(0, 16)
}

// --- UTILITÁRIOS DE EXTRAÇÃO DE CONTEÚDO (Para IA) ---

/**
 * Tenta extrair o conteúdo relevante da página (descrição inicial, trâmites) para a IA.
 * Esta função depende da estrutura do SGD.
 * @returns {string} O conteúdo extraído concatenado.
 */
function extractPageContentForAI() {
  let content = ''

  // 1. Extrair a descrição inicial da solicitação
  for (const selector of SUPPORT_REQUEST_DESCRIPTION_SELECTORS) {
    const element = document.querySelector(selector)
    if (element) {
      // Pega value (se input/textarea) ou textContent
      const text = element.value || element.textContent || ''
      if (text.trim()) {
        content += 'Descrição Inicial:\n' + text.trim() + '\n\n'
        break
      }
    }
  }

  // 2. Extrair os trâmites anteriores
  for (const selector of TRAMITES_TABLE_SELECTORS) {
    const tableBody = document.querySelector(selector)
    if (tableBody && tableBody.rows && tableBody.rows.length > 0) {
      content += 'Trâmites Anteriores:\n'
      // Itera pelas linhas da tabela de trâmites
      for (const row of tableBody.rows) {
        // A estrutura exata das células depende do SGD. Assumindo colunas comuns (Data, Usuário, Descrição).
        // Tentamos extrair de forma resiliente.
        if (row.cells.length >= 3) {
          // Exemplo hipotético de extração. Ajuste os índices das células se necessário.
          const cell1 = row.cells[0]?.textContent.trim() || ''
          // Geralmente pula-se a coluna de status/tipo
          const cell2 = row.cells[2]?.textContent.trim() || ''
          const cell3 = row.cells[3]?.textContent.trim() || ''

          // Formatação simples para a IA entender o contexto
          content += `[${cell1}] ${cell2}: ${cell3}\n`
        }
      }
      break
    }
  }

  return content.trim()
}

/**
 * Gera um hash numérico simples de uma string (não criptográfico).
 * @param {string} str A string de entrada.
 * @returns {number} O hash gerado.
 */
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0 // Converte para um inteiro de 32bit.
  }
  return hash
}
