/**
 * @file text-processor.js
 * Lida com a substituição de variáveis dinâmicas em strings de texto.
 */

/**
 * Processa uma string e substitui todas as variáveis dinâmicas conhecidas.
 * @param {string} text - O texto a ser processado, contendo variáveis como [usuario].
 * @returns {Promise<string>} O texto com as variáveis substituídas.
 */
async function resolveVariablesInText(text) {
  let processedText = text

  if (processedText.includes('[usuario]')) {
    const userName = await _getUserNameLogic()
    const userHtml = `<span data-variable="usuario">${userName}</span>`
    processedText = processedText.replace(/\[usuario\]/g, userHtml)
  }

  if (processedText.includes('[saudacao]')) {
    const greeting = _getGreetingLogic()
    processedText = processedText.replace(/\[saudacao\]/g, greeting)
  }

  if (processedText.includes('[finalizacao]')) {
    const farewell = _getFarewellLogic()
    processedText = processedText.replace(/\[finalizacao\]/g, farewell)
  }

  if (processedText.includes('[solicitacao]')) {
    const requestNumber = await _getRequestNumberLogic()
    processedText = processedText.replace(/\[solicitacao\]/g, requestNumber)
  }

  return processedText
}

/**
 * Lógica para obter o nome do primeiro usuário.
 * @returns {Promise<string>} O primeiro nome do usuário como texto puro.
 */
async function _getUserNameLogic() {
  const getFirstName = element => {
    if (element && element.textContent) {
      const fullName = element.textContent.trim()
      return fullName.split(' ')[0]
    }
    return null
  }

  const userSelectElement = document.getElementById('cadSscForm:usuario')
  let firstName = ''

  if (userSelectElement && userSelectElement.value > 0) {
    const selectedOption =
      userSelectElement.options[userSelectElement.selectedIndex]
    firstName = getFirstName(selectedOption)
  }

  if (!firstName) {
    const userNameElement = document.getElementById('td:usuario_nome')
    firstName = getFirstName(userNameElement)
  }

  if (firstName) {
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()
  }
  return '' // Fallback
}

/**
 * Lógica para a saudação baseada na hora do dia.
 * @returns {string} A saudação apropriada.
 */
function _getGreetingLogic() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) {
    return 'Bom dia'
  } else if (hour >= 12 && hour < 18) {
    return 'Boa tarde'
  } else {
    return 'Boa noite'
  }
}

/**
 * Lógica para obter o número da solicitação da página.
 * @returns {Promise<string>} O número da solicitação como texto puro.
 */
async function _getRequestNumberLogic() {
  // Tentativa 1: ID específico
  const elementById = document.getElementById('td:numero');
  if (elementById && elementById.textContent) {
    const number = elementById.textContent.trim();
    if (/^\d+$/.test(number)) {
      return number;
    }
  }

  // Tentativa 2: Célula que contém "Número:"
  const allTds = document.querySelectorAll('td.tableVisualizacaoField');
  for (const td of allTds) {
    const boldTag = td.querySelector('b');
    if (boldTag && (boldTag.innerText || '').trim().toLowerCase() === 'número:') {
      // O número é o texto do nó seguinte ao <b>
      const numberTextNode = boldTag.nextSibling;
      if (numberTextNode && numberTextNode.nodeType === Node.TEXT_NODE) {
          const number = numberTextNode.textContent.trim();
          if (/^\d+$/.test(number)) {
              return number;
          }
      }
      // Fallback se o número não for um text node (improvável, mas seguro)
      const fullText = td.textContent || '';
      const match = fullText.match(/Número:\s*(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }

  return ''; // Retorna vazio se não encontrar
}

/**
 * Lógica para a finalização baseada no dia e hora.
 * @returns {string} A finalização apropriada.
 */
function _getFarewellLogic() {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const hour = now.getHours()

  if (dayOfWeek === 0 || dayOfWeek === 1) {
    return 'Ótima semana'
  }
  if (dayOfWeek === 5) {
    return 'Ótimo final de semana'
  }
  if (dayOfWeek >= 2 && dayOfWeek <= 4) {
    if (hour >= 5 && hour < 12) {
      return 'Ótimo dia'
    } else if (hour >= 12 && hour < 18) {
      return 'Ótima tarde'
    } else {
      return 'Ótima noite'
    }
  }
  return 'Ótimo final de semana'
}
