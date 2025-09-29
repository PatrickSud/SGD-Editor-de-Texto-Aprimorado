/**
 * @file editor-core.js
 * Lógica central do editor: inserção, formatação, e gerenciamento do painel de visualização
 */

/**
 * Foca o elemento de edição (sempre o textarea)
 */
function focusEditor(textArea) {
  if (textArea && document.activeElement !== textArea) {
    textArea.focus()
  }
}

/**
 * Implementação para inserir texto/HTML no cursor do textarea
 */
function insertAtCursor(textArea, text, options = { prefixNewLine: false }) {
  if (!textArea) return

  if (document.activeElement !== textArea) {
    textArea.focus()
  }

  const { selectionStart, selectionEnd, value, scrollTop } = textArea

  let textToInsert = text
  if (options.prefixNewLine) {
    // Adiciona \n se não estiver no início e o caractere anterior não for \n
    if (selectionStart > 0 && value[selectionStart - 1] !== '\n') {
      textToInsert = '\n' + textToInsert
    }
  }

  // Converte <br> para \n para consistência no textarea
  textToInsert = textToInsert.replace(/<br\s*\/?>/gi, '\n')

  textArea.value =
    value.substring(0, selectionStart) +
    textToInsert +
    value.substring(selectionEnd)

  // Reposiciona o cursor
  const newCursorPosition = selectionStart + textToInsert.length
  textArea.setSelectionRange(newCursorPosition, newCursorPosition)
  textArea.scrollTop = scrollTop

  // Dispara evento input para que o site hospedeiro e o painel de visualização detectem a mudança.
  textArea.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Implementação para aplicar formatação (envolver com tags) no textarea.
 * Inclui lógica de toggle: se o texto já estiver formatado, remove a formatação.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 * @param {string} tag - A tag HTML (ex: 'strong', 'em', 'span').
 * @param {object} attributes - Atributos para a tag (ex: {style: 'color:red'}).
 */
function applyFormatting(textArea, tag, attributes = {}) {
  if (!textArea) return

  if (document.activeElement !== textArea) {
    textArea.focus()
  }

  const { selectionStart, selectionEnd, value, scrollTop } = textArea
  const selectedText = value.substring(selectionStart, selectionEnd)

  // Segurança: Escapar valores dos atributos para o HTML fonte.
  const attrString = Object.entries(attributes)
    .map(([k, v]) => `${k}="${escapeHTML(v)}"`)
    .join(' ')

  const openTag = `<${tag}${attrString ? ' ' + attrString : ''}>`
  const closeTag = `</${tag}>`

  // NOVA LÓGICA DE TOGGLE: Verifica se o texto selecionado já está formatado
  let finalText = selectedText
  let isAlreadyFormatted = false

  if (selectedText) {
    // Verifica se o texto já está envolvido pela tag atual
    if (selectedText.startsWith(openTag) && selectedText.endsWith(closeTag)) {
      isAlreadyFormatted = true
      // Remove as tags para obter o texto sem formatação
      finalText = selectedText.slice(openTag.length, -closeTag.length)
    } else {
      // Para tags sem atributos, também verifica versões simplificadas
      if (!attrString) {
        const simpleOpenTag = `<${tag}>`
        const simpleCloseTag = `</${tag}>`
        if (
          selectedText.startsWith(simpleOpenTag) &&
          selectedText.endsWith(simpleCloseTag)
        ) {
          isAlreadyFormatted = true
          finalText = selectedText.slice(
            simpleOpenTag.length,
            -simpleCloseTag.length
          )
        }
      }
    }
  }

  // Aplica a formatação ou remove conforme necessário
  const textToInsert = isAlreadyFormatted
    ? finalText
    : `${openTag}${selectedText}${closeTag}`

  textArea.value =
    value.substring(0, selectionStart) +
    textToInsert +
    value.substring(selectionEnd)

  if (selectedText) {
    const newCursorPosition = selectionStart + textToInsert.length
    textArea.setSelectionRange(newCursorPosition, newCursorPosition)
  } else {
    // Se não havia seleção, posiciona o cursor DENTRO das tags (apenas se aplicando formatação)
    if (!isAlreadyFormatted) {
      const newCursorPosition = selectionStart + openTag.length
      textArea.setSelectionRange(newCursorPosition, newCursorPosition)
    }
  }

  textArea.scrollTop = scrollTop
  // Dispara evento input.
  textArea.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Remove todas as formatações (negrito, itálico, sublinhado) do texto selecionado.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 */
function removeFormatting(textArea) {
  if (!textArea) return

  if (document.activeElement !== textArea) {
    textArea.focus()
  }

  const { selectionStart, selectionEnd, value, scrollTop } = textArea
  const selectedText = value.substring(selectionStart, selectionEnd)

  if (!selectedText) {
    // Se não há seleção, não faz nada
    return
  }

  // Remove todas as tags de formatação do texto selecionado
  let cleanedText = selectedText

  // Lista de tags de formatação para remover (abertura e fechamento)
  const formattingTags = [
    '<strong>',
    '</strong>',
    '<b>',
    '</b>',
    '<em>',
    '</em>',
    '<i>',
    '</i>',
    '<u>',
    '</u>'
  ]

  // Remove cada tag de formatação
  formattingTags.forEach(tag => {
    // Usa regex global para remover todas as ocorrências da tag
    const regex = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    cleanedText = cleanedText.replace(regex, '')
  })

  // Substitui o texto selecionado pelo texto limpo
  textArea.value =
    value.substring(0, selectionStart) +
    cleanedText +
    value.substring(selectionEnd)

  // Reposiciona o cursor no final do texto limpo
  const newCursorPosition = selectionStart + cleanedText.length
  textArea.setSelectionRange(newCursorPosition, newCursorPosition)
  textArea.scrollTop = scrollTop

  // Dispara evento input para atualizar o preview e outros listeners
  textArea.dispatchEvent(new Event('input', { bubbles: true }))
}

// --- GERENCIAMENTO E SINCRONIZAÇÃO DO PAINEL DE VISUALIZAÇÃO ---

/**
 * Remove scripts do conteúdo para segurança (Sanitização simples).
 * @param {string} html - O conteúdo HTML a ser sanitizado.
 * @returns {string} O HTML sanitizado.
 */
function sanitizeHtml(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Remove elementos perigosos
  doc
    .querySelectorAll('script, iframe, object, embed, form, meta')
    .forEach(el => el.remove())

  // Itera sobre todos os elementos restantes para limpar atributos perigosos.
  doc.querySelectorAll('*').forEach(element => {
    const attributes = Array.from(element.attributes)
    for (const attribute of attributes) {
      const attrName = attribute.name.toLowerCase()
      // Remove manipuladores de eventos (onclick, onload, etc.).
      if (attrName.startsWith('on')) {
        element.removeAttribute(attribute.name)
      }
      // Sanitiza atributos href/src para previnir XSS via javascript:
      if (attrName === 'href' || attrName === 'src') {
        if (!isValidUrl(attribute.value.trim())) {
          element.removeAttribute(attribute.name)
        }
      }
    }
  })

  return doc.body.innerHTML
}

/**
 * Cria o container de visualização e o anexa ao DOM.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 * @param {string} instanceId - O ID da instância do editor.
 */
function createPreviewContainer(textArea, instanceId) {
  const previewContainer = document.createElement('div')
  previewContainer.id = `editor-preview-container-${instanceId}`
  previewContainer.classList.add('editor-preview-container')

  // Estrutura com wrapper para o conteúdo, permitindo que o botão fique fixo.
  previewContainer.innerHTML = `
    <button type="button" id="preview-pin-btn-${instanceId}" class="preview-pin-btn" title="Fixar/Liberar tamanho do painel">
        📌
    </button>
    <div class="preview-scroll-wrapper">
        <div id="preview-content-${instanceId}" class="preview-content"></div>
    </div>
  `

  // Insere após o textarea no DOM (como irmão, dentro do masterContainer)
  if (textArea.parentNode) {
    textArea.parentNode.insertBefore(previewContainer, textArea.nextSibling)
  }

  return previewContainer
}

/**
 * Atualiza o painel de visualização com o conteúdo do textarea.
 * @param {HTMLTextAreaElement} textArea - O textarea fonte.
 */
function updatePreview(textArea) {
  const instanceId = textArea.dataset.enhanced
  const previewContainer = document.getElementById(
    `editor-preview-container-${instanceId}`
  )
  if (!previewContainer) return

  let rawHtml = textArea.value

  // Converte as quebras de linha do textarea para a tag <br>
  rawHtml = rawHtml.replace(/\n/g, '<br>')

  const sanitizedHtml = sanitizeHtml(rawHtml)

  const previewContent = document.getElementById(
    `preview-content-${instanceId}`
  )
  if (!previewContent) return

  // Evita atualizações desnecessárias se o conteúdo for o mesmo
  if (previewContent.innerHTML === sanitizedHtml) return

  previewContent.innerHTML = sanitizedHtml

  // Ajusta links para abrir em nova aba por segurança e conveniência.
  previewContent.querySelectorAll('a[href]').forEach(link => {
    link.target = '_blank'
    if (!link.rel || !link.rel.includes('noopener')) {
      link.rel = link.rel
        ? `${link.rel} noopener noreferrer`
        : 'noopener noreferrer'
    }
  })
}

/**
 * Alterna a visibilidade do painel de visualização.
 * @param {HTMLTextAreaElement} textArea - O textarea associado.
 */
async function togglePreview(textArea) {
  const instanceId = textArea.dataset.enhanced
  const previewContainer = document.getElementById(
    `editor-preview-container-${instanceId}`
  )
  const toggleButton = document.querySelector(
    `#editor-container-${instanceId} [data-action="toggle-preview"]`
  )

  if (!previewContainer || !toggleButton) return

  const isVisible = previewContainer.style.display !== 'none'

  if (isVisible) {
    previewContainer.style.display = 'none'
    toggleButton.innerHTML = '👁️'
    toggleButton.title = 'Mostrar Visualização (Ctrl+Alt+V)'
    await savePreviewState(false)
  } else {
    // Antes de mostrar, garante que o conteúdo está atualizado
    updatePreview(textArea)
    previewContainer.style.display = 'block'
    toggleButton.innerHTML = '📝'
    toggleButton.title = 'Ocultar Visualização (Ctrl+Alt+V)'
    await savePreviewState(true)
  }
}
