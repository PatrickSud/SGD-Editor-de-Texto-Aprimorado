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
    // A flag 'g' (global) garante que todas as ocorrências sejam substituídas
    processedText = processedText.replace(/\[usuario\]/g, userName)
  }

  if (processedText.includes('[saudacao]')) {
    const greeting = _getGreetingLogic()
    processedText = processedText.replace(/\[saudacao\]/g, greeting)
  }

  if (processedText.includes('[finalizacao]')) {
    const farewell = _getFarewellLogic()
    processedText = processedText.replace(/\[finalizacao\]/g, farewell)
  }

  return processedText
}

/**
 * Lógica para obter o nome do primeiro usuário.
 * @returns {Promise<string>} O primeiro nome do usuário.
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
  return 'Usuário' // Fallback
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
 * Lógica para a finalização baseada no dia e hora, com as novas regras.
 * @returns {string} A finalização apropriada.
 */
function _getFarewellLogic() {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 (Domingo) a 6 (Sábado)
  const hour = now.getHours()

  // Domingo (0) ou Segunda-feira (1)
  if (dayOfWeek === 0 || dayOfWeek === 1) {
    return 'ótima semana'
  }

  // Sexta-feira (5)
  if (dayOfWeek === 5) {
    return 'Ótimo final de semana!'
  }

  // Terça (2) a Quinta (4) - o Sábado (6) é ignorado e cairá no 'else' final
  if (dayOfWeek >= 2 && dayOfWeek <= 4) {
    if (hour >= 5 && hour < 12) {
      return 'Ótimo dia!'
    } else if (hour >= 12 && hour < 18) {
      return 'Ótima tarde!'
    } else {
      return 'Ótima noite!'
    }
  }

  // Fallback para qualquer outro caso (como Sábado)
  return 'Ótimo final de semana!'
}
