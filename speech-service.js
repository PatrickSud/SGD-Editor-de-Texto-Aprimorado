/**
 * @file speech-service.js
 * @description Gerencia a funcionalidade de reconhecimento de voz (Speech-to-Text).
 */

// Verifica se a API de Reconhecimento de Voz está disponível no navegador
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition

/**
 * @module SpeechService
 * @description Módulo que gerencia a funcionalidade de reconhecimento de voz (Speech-to-Text).
 */
const SpeechService = (() => {
  // --- Estado do Módulo ---
  let recognition = null
  let isListening = false
  let finalTranscript = ''
  let targetTextArea = null
  let transcriptHistory = []

  // NOVO: Variáveis para guardar o estado inicial do textarea
  let initialTextBeforeCursor = ''
  let initialTextAfterCursor = ''

  /**
   * Atualiza o conteúdo do textarea, posicionando o cursor corretamente.
   * @param {string} interimTranscript - O texto provisório que está sendo transcrito.
   */
  function updateTextAreaUI(interimTranscript = '') {
    if (!targetTextArea) return

    const newContent = finalTranscript + interimTranscript
    // Usa o estado inicial para a reconstrução da UI
    targetTextArea.value = initialTextBeforeCursor + newContent + initialTextAfterCursor

    targetTextArea.dataset.interimText = newContent

    const cursorPosition = (initialTextBeforeCursor + newContent).length
    targetTextArea.selectionStart = cursorPosition
    targetTextArea.selectionEnd = cursorPosition
  }

  /**
   * Capitaliza a primeira letra do texto se necessário, útil para inícios de frases.
   */
  function applyAutoCapitalization(text, previousText = '') {
    if (!text || text.length === 0) return text

    const shouldCapitalize =
      previousText.length === 0 ||
      previousText.match(/[.!?]\s*$/) ||
      previousText.match(/\n\s*$/) ||
      previousText.match(/\n\n\s*$/)

    if (shouldCapitalize) {
      return text.charAt(0).toUpperCase() + text.slice(1)
    }
    return text
  }

  /**
   * Processa uma string de texto, substituindo palavras-chave de comando por sua pontuação.
   */
  function processVoiceCommands(text) {
    if (!text) return text

    const commandMap = [
      { triggers: ['ponto de exclamação', 'ponto de exclamacao', 'exclamação', 'exclamacao'], replacement: '!' },
      { triggers: ['ponto de interrogação', 'ponto de interrogacao', 'interrogação', 'interrogacao'], replacement: '?' },
      { triggers: ['ponto e vírgula', 'ponto e virgula'], replacement: ';' },
      { triggers: ['dois pontos'], replacement: ':' },
      { triggers: ['ponto final', 'ponto.', 'ponto'], replacement: '.' },
      { triggers: ['vírgula', 'virgula'], replacement: ',' },
      { triggers: ['ponto'], replacement: '.' }
    ]

    let processedText = ` ${text.toLowerCase()} `

    commandMap.forEach(command => {
      const regex = new RegExp(` (${command.triggers.join('|')}) `, 'g')
      processedText = processedText.replace(regex, command.replacement)
    })

    processedText = processedText
      .trim()
      .replace(/\s+([,.!?;:])/g, '$1')
      .replace(/([,.!?;:])(?=\S)/g, '$1 ')
      .replace(/[ \t]+/g, ' ')

    return processedText
  }
  
    /**
   * Detecta se o texto contém comandos de ação sem executá-los.
   */
  function detectActionCommands(transcript) {
    if (!transcript) return false
    const lowerTranscript = transcript.toLowerCase().trim()
    const actionCommandPatterns = [
      { pattern: /\b(parar|terminar|encerrar|parar ditado|parar gravação)\b/ },
      { pattern: /\b(limpar|limpar tudo|apagar tudo)\b/ },
      { pattern: /\b(apagar|apagar palavra|apagar última palavra)\b/ },
      { pattern: /\b(nova linha|quebra de linha|parágrafo)\b/ },
      { pattern: /\b(selecionar tudo)\b/ }
    ]
    return actionCommandPatterns.some(({ pattern }) => pattern.test(lowerTranscript))
  }

  /**
   * Detecta e executa comandos de ação que manipulam o estado do editor.
   */
  function detectAndProcessActionCommands(transcript) {
    if (!transcript) return false
    const lowerTranscript = transcript.toLowerCase().trim()

    const actionCommands = {
      parar: stop,
      terminar: stop,
      encerrar: stop,
      'parar ditado': stop,
      'parar gravação': stop,
      limpar: () => {
        if (targetTextArea) {
          finalTranscript = ''
          transcriptHistory = []
          
          // CORREÇÃO: Restaura o conteúdo usando o estado inicial salvo
          targetTextArea.value = initialTextBeforeCursor + initialTextAfterCursor
          
          const cursorPosition = initialTextBeforeCursor.length
          targetTextArea.selectionStart = cursorPosition
          targetTextArea.selectionEnd = cursorPosition
          
          targetTextArea.dispatchEvent(new Event('input', { bubbles: true }))
          showNotification('Texto ditado limpo.', 'info', 2000)
        }
      },
      'limpar tudo': () => actionCommands.limpar(),
      'apagar tudo': () => actionCommands.limpar(),
      apagar: () => {
        if (targetTextArea && finalTranscript.length > 0) {
          const words = finalTranscript.trim().split(' ')
          words.pop()
          finalTranscript = words.join(' ') + (words.length > 0 ? ' ' : '')
          transcriptHistory = [finalTranscript]
          updateTextAreaUI()
          showNotification('Última palavra apagada.', 'info', 2000)
        }
      },
      'apagar palavra': () => actionCommands.apagar(),
      'apagar última palavra': () => actionCommands.apagar(),
      'selecionar tudo': () => {
        if (targetTextArea) {
          targetTextArea.focus()
          targetTextArea.select()
        }
      },
      'nova linha': () => {
        if (targetTextArea) {
          // CORREÇÃO: Adiciona a quebra de linha à transcrição final
          finalTranscript += '\n'
          transcriptHistory.push(finalTranscript)
          updateTextAreaUI()
        }
      },
      'quebra de linha': () => actionCommands['nova linha'](),
      parágrafo: () => {
        if (targetTextArea) {
          // CORREÇÃO: Adiciona duas quebras de linha à transcrição final
          finalTranscript += '\n\n'
          transcriptHistory.push(finalTranscript)
          updateTextAreaUI()
        }
      }
    }

    const sortedCommands = Object.keys(actionCommands).sort((a, b) => b.length - a.length)
    for (const command of sortedCommands) {
      const regex = new RegExp(`\\b${command}\\b`)
      if (regex.test(lowerTranscript)) {
        actionCommands[command]()
        return true
      }
    }
    return false
  }

  /**
   * Atualiza a aparência do botão do microfone.
   */
  function updateMicButtonState(isActive) {
    const micButtons = document.querySelectorAll('[data-action="speech-to-text"]')
    micButtons.forEach(button => {
      if (isActive) {
        button.classList.add('active-mic')
        button.title = 'Parar Gravação'
      } else {
        button.classList.remove('active-mic')
        button.title = 'Gravar com Microfone'
      }
    })
  }

  /**
   * Inicia a sessão de reconhecimento de voz.
   */
  function start(textArea) {
    if (isListening) return
    if (!recognition) {
      console.error('Editor SGD: Serviço de reconhecimento de voz não inicializado.')
      return
    }

    targetTextArea = textArea

    // CORREÇÃO: Salva o estado inicial do textarea
    const cursorPosition = textArea.selectionStart || textArea.value.length
    initialTextBeforeCursor = textArea.value.substring(0, cursorPosition)
    initialTextAfterCursor = textArea.value.substring(cursorPosition)

    finalTranscript = ''
    transcriptHistory = ['']
    delete targetTextArea.dataset.interimText

    try {
      recognition.start()
      isListening = true
      updateMicButtonState(true)
      document.getElementById('speech-command-hint')?.classList.add('visible')
      showNotification('Microfone ativado! Verifique algumas dicas em Comandos de Voz!', 'success', 4000)
    } catch (e) {
      console.error('Editor SGD: Erro ao iniciar o reconhecimento de voz.', e)
      isListening = false
      updateMicButtonState(false)
    }
  }

  /**
   * Para a sessão de reconhecimento de voz manualmente.
   */
  function stop() {
    if (!isListening) return
    if (recognition) {
      recognition.stop()
    }
    isListening = false
    updateMicButtonState(false)
    document.getElementById('speech-command-hint')?.classList.remove('visible')
    showNotification('Microfone desativado.', 'info', 2000)
  }

  /**
   * Inicializa a API de Reconhecimento de Voz e configura os eventos.
   */
  function initialize() {
    if (!SpeechRecognition) {
      console.error('Editor SGD: A API de Reconhecimento de Voz não é suportada neste navegador.')
      return
    }

    recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'pt-BR'

    recognition.onresult = event => {
      let interimTranscript = ''
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          if (detectAndProcessActionCommands(transcript)) {
            interimTranscript = ''
            break
          }
          const processedText = processVoiceCommands(transcript)
          const fullPreviousText = initialTextBeforeCursor + finalTranscript
          let textToAppend = applyAutoCapitalization(processedText, fullPreviousText)
          if (fullPreviousText.length > 0 && !/[\s\n]$/.test(fullPreviousText)) {
            textToAppend = ' ' + textToAppend
          }
          finalTranscript += textToAppend
          transcriptHistory.push(finalTranscript)
        } else {
            const fullInterimText = interimTranscript + transcript;
            if (detectActionCommands(fullInterimText)) {
                interimTranscript = ''; 
            } else {
                interimTranscript += transcript;
            }
        }
      }
      if (targetTextArea) {
        updateTextAreaUI(interimTranscript)
      }
    }

    recognition.onend = () => {
      if (isListening) {
        recognition.start()
      } else {
        if (targetTextArea) {
          targetTextArea.value = initialTextBeforeCursor + finalTranscript + initialTextAfterCursor
          delete targetTextArea.dataset.interimText
          finalTranscript = ''
          transcriptHistory = []
          initialTextBeforeCursor = ''
          initialTextAfterCursor = ''
        }
        updateMicButtonState(false)
      }
    }

    recognition.onerror = event => {
      console.error('Erro no reconhecimento de voz:', event.error)
      if (event.error === 'no-speech') {
        showNotification('Nenhuma fala foi detectada. Tente novamente.', 'info')
      } else if (event.error === 'not-allowed') {
        showNotification('Permissão para usar o microfone foi negada.', 'error')
      }
      document.getElementById('speech-command-hint')?.classList.remove('visible')
      stop()
    }
  }

  /**
   * Função pública para alternar (iniciar/parar) o reconhecimento de voz.
   */
  function toggleRecognition(textArea) {
    if (isListening) {
      stop()
    } else {
      start(textArea)
    }
  }

  return {
    initialize,
    toggleRecognition
  }
})()