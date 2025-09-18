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
  let recognition = null // Instância da API de Reconhecimento de Voz
  let isListening = false // Controla se o microfone está ativo
  let finalTranscript = '' // Armazena o texto da SESSÃO ATUAL de transcrição
  let targetTextArea = null // Referência ao <textarea> onde o texto será inserido
  let transcriptHistory = [] // Histórico de transcrições para a função "desfazer"
  let textBeforeCursor = '' // Texto no textarea antes do cursor, no momento da ativação
  let textAfterCursor = '' // Texto no textarea depois do cursor, no momento da ativação

  /**
   * Atualiza o conteúdo do textarea, posicionando o cursor corretamente.
   * @param {string} interimTranscript - O texto provisório que está sendo transcrito.
   */
  function updateTextAreaUI(interimTranscript = '') {
    if (!targetTextArea) return

    const newContent = finalTranscript + interimTranscript
    targetTextArea.value = textBeforeCursor + newContent + textAfterCursor

    // Mantém o dataset.interimText para compatibilidade com a lógica de parada
    targetTextArea.dataset.interimText = newContent

    // Posiciona o cursor no final do texto inserido
    const cursorPosition = (textBeforeCursor + newContent).length
    targetTextArea.selectionStart = cursorPosition
    targetTextArea.selectionEnd = cursorPosition
  }

  /**
   * Capitaliza a primeira letra do texto se necessário, útil para inícios de frases.
   * @param {string} text - O texto a ser capitalizado.
   * @param {string} previousText - O texto anterior para dar contexto (verificar se há pontuação final).
   * @returns {string} O texto com a capitalização aplicada.
   */
  function applyAutoCapitalization(text, previousText = '') {
    if (!text || text.length === 0) return text

    // Verifica se deve capitalizar baseado no contexto
    const shouldCapitalize =
      previousText.length === 0 || // Início do texto
      previousText.match(/[.!?]\s*$/) || // Após ponto, exclamação ou interrogação
      previousText.match(/\n\s*$/) || // Após quebra de linha
      previousText.match(/\n\n\s*$/) // Após parágrafo

    if (shouldCapitalize) {
      return text.charAt(0).toUpperCase() + text.slice(1)
    }

    return text
  }

  /**
   * Processa uma string de texto, substituindo palavras-chave de comando por sua pontuação ou formatação correspondente.
   * @param {string} text - O texto transcrito.
   * @returns {string} O texto limpo e formatado.
   */
  function processVoiceCommands(text) {
    if (!text) return text

    // Comandos de substituição direta. A ordem importa: mais específicos primeiro.
    const commandMap = [
      {
        triggers: [
          'ponto de exclamação',
          'ponto de exclamacao',
          'exclamação',
          'exclamacao'
        ],
        replacement: '!'
      },
      {
        triggers: [
          'ponto de interrogação',
          'ponto de interrogacao',
          'interrogação',
          'interrogacao'
        ],
        replacement: '?'
      },
      { triggers: ['ponto e vírgula', 'ponto e virgula'], replacement: ';' },
      { triggers: ['dois pontos'], replacement: ':' },
      { triggers: ['ponto final', 'ponto.'], replacement: '.' }, // "ponto." para evitar conflito com "ponto"
      { triggers: ['vírgula', 'virgula'], replacement: ',' },
      { triggers: ['ponto'], replacement: '.' },
      {
        triggers: [
          'nova linha',
          'quebra de linha',
          'próxima linha',
          'proxima linha'
        ],
        replacement: '\n'
      },
      {
        triggers: [
          'parágrafo',
          'paragrafo',
          'novo parágrafo',
          'novo paragrafo'
        ],
        replacement: '\n\n'
      },
      { triggers: ['tabulação', 'tabulacao', 'tab'], replacement: '\t' }
    ]

    let processedText = ` ${text.toLowerCase()} ` // Adiciona espaços para garantir a detecção nas bordas

    commandMap.forEach(command => {
      // Adicionamos lógica para tratar quebras de linha de forma especial
      const isNewLineCommand = command.replacement.includes('\n')
      const replacement = isNewLineCommand
        ? command.replacement
        : `${command.replacement} `
      const regex = new RegExp(` (${command.triggers.join('|')}) `, 'g')
      processedText = processedText.replace(regex, replacement)
    })

    // Limpeza final do texto
    processedText = processedText
      .trim() // Remove espaços do início e fim
      .replace(/\s+([,.!?;:])/g, '$1') // Remove espaço antes de pontuação.
      .replace(/([,.!?;:])(?=\S)/g, '$1 ') // Garante espaço após pontuação, se não houver.
      .replace(/[ \t]+/g, ' ') // Normaliza múltiplos espaços e tabs para um só, preservando quebras de linha.

    return processedText
  }

  /**
   * Detecta e executa comandos de ação que manipulam o estado do editor (ex: "limpar", "desfazer", "parar").
   * Esses comandos não inserem texto, mas executam funções específicas.
   * @param {string} transcript - O texto transcrito.
   * @returns {boolean} Retorna `true` se um comando foi detectado e executado.
   */
  function detectAndProcessActionCommands(transcript) {
    if (!transcript) return false

    const lowerTranscript = transcript.toLowerCase().trim()

    // Mapeamento de comandos de ação para funções.
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
          updateTextAreaUI() // Atualiza a UI para remover o texto ditado
          showNotification('Texto ditado limpo.', 'info', 2000)
        }
      },
      'limpar tudo': () => actionCommands.limpar(),
      'apagar tudo': () => actionCommands.limpar(),
      apagar: () => {
        if (targetTextArea && finalTranscript.length > 0) {
          // Remove a última palavra do transcrito final
          const words = finalTranscript.trim().split(' ')
          words.pop()
          finalTranscript = words.join(' ') + (words.length > 0 ? ' ' : '')
          transcriptHistory = [finalTranscript]

          // Atualiza a UI
          updateTextAreaUI()
          showNotification('Última palavra apagada.', 'info', 2000)
        }
      },
      'apagar palavra': () => actionCommands.apagar(),
      'apagar última palavra': () => actionCommands.apagar(),
      desfazer: () => {
        if (transcriptHistory.length > 1) {
          // Remove o último fragmento adicionado
          transcriptHistory.pop()
          // O novo transcrito final é o estado anterior
          finalTranscript =
            transcriptHistory[transcriptHistory.length - 1] || ''

          // Atualiza a UI com o estado restaurado
          updateTextAreaUI()
          showNotification('Última transcrição desfeita.', 'info', 2000)
        } else {
          // Se não há mais histórico, limpa o texto ditado nesta sessão
          actionCommands.limpar()
        }
      },
      'selecionar tudo': () => {
        if (targetTextArea) {
          targetTextArea.focus()
          targetTextArea.select()
        }
      }
    }

    // Verifica se alguma das palavras-chave de comando está na transcrição
    const sortedCommands = Object.keys(actionCommands).sort(
      (a, b) => b.length - a.length
    )

    for (const command of sortedCommands) {
      // Usamos uma expressão regular para encontrar o comando como uma palavra/frase inteira
      const regex = new RegExp(`\\b${command}\\b`)
      if (regex.test(lowerTranscript)) {
        actionCommands[command]()
        return true // Comando executado
      }
    }

    return false // Nenhum comando de ação encontrado
  }

  /**
   * Atualiza a aparência do botão do microfone (ícone e tooltip) para refletir o estado de gravação.
   * @param {boolean} isActive - `true` se o microfone estiver ativo.
   */
  function updateMicButtonState(isActive) {
    const micButtons = document.querySelectorAll(
      '[data-action="speech-to-text"]'
    )
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
   * Configura o estado inicial e começa a escutar o microfone.
   * @param {HTMLTextAreaElement} textArea - O elemento `<textarea>` que receberá a transcrição.
   */
  function start(textArea) {
    if (isListening) return

    if (!recognition) {
      console.error(
        'Editor SGD: Serviço de reconhecimento de voz não inicializado.'
      )
      return
    }

    targetTextArea = textArea

    // Salva o conteúdo ao redor do cursor para permitir a inserção
    const cursorPosition = textArea.selectionStart || textArea.value.length
    textBeforeCursor = textArea.value.substring(0, cursorPosition)
    textAfterCursor = textArea.value.substring(cursorPosition)

    // Reinicia o estado da sessão de transcrição atual
    finalTranscript = ''
    transcriptHistory = ['']
    delete targetTextArea.dataset.interimText

    try {
      recognition.start()
      isListening = true
      updateMicButtonState(true)

      showNotification(
        'Microfone ativado! Comandos: "vírgula", "ponto", "nova linha", "parar", "apagar"',
        'success',
        4000
      )
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
    showNotification('Microfone desativado.', 'info', 2000)
  }

  /**
   * Inicializa a API de Reconhecimento de Voz e configura os eventos.
   * Esta função deve ser chamada uma vez, quando a aplicação é carregada.
   */
  function initialize() {
    if (!SpeechRecognition) {
      console.error(
        'Editor SGD: A API de Reconhecimento de Voz não é suportada neste navegador.'
      )
      return
    }

    // Configurações da API
    recognition = new SpeechRecognition()
    recognition.continuous = true // A gravação continua mesmo após pausas na fala
    recognition.interimResults = true // Retorna resultados parciais para feedback em tempo real
    recognition.lang = 'pt-BR' // Define o idioma

    // --- Event Handlers da API ---

    /**
     * Chamado quando o serviço de reconhecimento de voz retorna um resultado.
     * Este é o coração do serviço, onde a transcrição é processada.
     */
    recognition.onresult = event => {
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript

        if (event.results[i].isFinal) {
          // 1. Verifica se é um comando de ação (parar, limpar, etc.)
          if (detectAndProcessActionCommands(transcript)) {
            interimTranscript = '' // Limpa o texto provisório
            break // Para o processamento se um comando foi executado
          }

          // 2. Se não for um comando de ação, processa o texto para pontuação, etc.
          const processedText = processVoiceCommands(transcript)

          // O contexto para capitalização e espaçamento é todo o texto que precede a nova inserção.
          const fullPreviousText = textBeforeCursor + finalTranscript

          // 3. Aplica capitalização automática com base no contexto real.
          let textToAppend = applyAutoCapitalization(
            processedText,
            fullPreviousText
          )

          // 4. Adiciona um espaço se o texto anterior não terminar com um, para evitar palavras coladas.
          // Isso é feito *depois* da capitalização para não capitalizar um espaço.
          if (
            fullPreviousText.length > 0 &&
            !/[\s\n]$/.test(fullPreviousText)
          ) {
            textToAppend = ' ' + textToAppend
          }

          finalTranscript += textToAppend
          transcriptHistory.push(finalTranscript) // Salva o estado no histórico
        } else {
          interimTranscript += transcript
        }
      }

      // Atualiza a UI com o texto final e provisório
      if (targetTextArea) {
        updateTextAreaUI(interimTranscript)
      }
    }

    /**
     * Chamado quando o serviço de reconhecimento de voz para.
     * Usado para reiniciar a escuta se a parada não foi intencional.
     */
    recognition.onend = () => {
      // Se o estado ainda é "escutando", significa que a API parou sozinha (ex: timeout).
      // Nesse caso, reiniciamos para uma experiência contínua.
      if (isListening) {
        recognition.start()
      } else {
        if (targetTextArea) {
          // Ao parar, finaliza o texto no textarea e limpa os estados de controle.
          targetTextArea.value =
            textBeforeCursor + finalTranscript + textAfterCursor
          delete targetTextArea.dataset.interimText

          // Reseta os estados para a próxima sessão
          finalTranscript = ''
          transcriptHistory = []
          textBeforeCursor = ''
          textAfterCursor = ''
        }
        updateMicButtonState(false)
      }
    }

    /**
     * Chamado quando ocorre um erro no reconhecimento.
     */
    recognition.onerror = event => {
      console.error('Erro no reconhecimento de voz:', event.error)
      if (event.error === 'no-speech') {
        showNotification('Nenhuma fala foi detectada. Tente novamente.', 'info')
      } else if (event.error === 'not-allowed') {
        showNotification('Permissão para usar o microfone foi negada.', 'error')
      }
      stop()
    }
  }

  /**
   * Função pública para alternar (iniciar/parar) o reconhecimento de voz.
   * @param {HTMLTextAreaElement} textArea - O `<textarea>` alvo.
   */
  function toggleRecognition(textArea) {
    if (isListening) {
      stop()
    } else {
      start(textArea)
    }
  }

  // Expõe as funções públicas do módulo.
  return {
    initialize,
    toggleRecognition
  }
})()

// Exemplo de como inicializar o serviço em seu main.js
// document.addEventListener('DOMContentLoaded', () => {
//   SpeechService.initialize();
//   const micButton = document.getElementById('mic-button');
//   const textArea = document.getElementById('editor');
//   micButton.addEventListener('click', () => {
//     SpeechService.toggleRecognition(textArea);
//   });
// });
