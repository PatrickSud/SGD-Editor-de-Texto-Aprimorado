/**
 * @file ai-service.js
 * Interface para comunicação com a API do Gemini
 */

const GEMINI_API_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'

/**
 * Configuração padrão para as chamadas de API
 */
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.6,
  topP: 1,
  topK: 32,
  maxOutputTokens: 4096
}

/**
 * Chamada genérica para a API do Gemini
 */
async function callGeminiAPI(apiKey, contents, systemInstruction = null) {
  if (!apiKey) {
    throw new Error('A chave de API do Gemini não está configurada.')
  }

  const payload = {
    contents: contents,
    generationConfig: DEFAULT_GENERATION_CONFIG
  }

  if (systemInstruction) {
    payload.system_instruction = systemInstruction
  }

  try {
    const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json()
      const errorMessage =
        errorData.error?.message || `HTTP error! status: ${response.status}`

      // Verifica se o modelo está sobrecarregado
      if (errorMessage.toLowerCase().includes('overloaded')) {
        throw new Error(
          'O modelo de IA está sobrecarregado no momento. Por favor, tente novamente em alguns instantes.'
        )
      }

      // Verifica se o erro é de cota excedida e traduz a mensagem
      if (errorMessage.toLowerCase().includes('quota')) {
        throw new Error(
          'Limite de requisições à IA excedido. Muitas solicitações em um curto período. Por favor, aguarde um minuto e tente novamente.'
        )
      }

      if (
        response.status === 403 ||
        (response.status === 400 && errorMessage.includes('API key not valid'))
      ) {
        throw new Error('Chave de API inválida ou não informada.')
      }
      throw new Error(`Erro na API Gemini: ${errorMessage}`)
    }

    const data = await response.json()
    if (
      !data.candidates ||
      data.candidates.length === 0 ||
      !data.candidates[0].content
    ) {
      throw new Error('A API não retornou resultados válidos. Tente novamente.')
    }

    return data.candidates[0].content.parts[0].text
  } catch (error) {
    console.error('Erro ao chamar a API Gemini:', error)
    throw error
  }
}

/**
 * Corrige ortografia e gramática de um texto
 */
async function correctText(apiKey, text) {
  const systemInstruction = {
    parts: [
      {
        text: 'Persona: Você é um revisor de texto meticuloso, especializado em comunicação de suporte técnico em Português do Brasil.\nTarefa: Corrija a ortografia, gramática e pontuação do texto a seguir.\nRegras Estritas:\n\nNão altere o significado: Reescreva o texto de forma concisa e bem escrita, preservando o significado original e a intenção do autor.\n\nNão adicione informações: Sua função é exclusivamente corrigir, não criar ou complementar o conteúdo.\n\nPreserve o HTML: Mantenha todas as tags HTML (como <b>, <i>, <span>) exatamente como estão no texto original. Utilize Enter simples para quebras de linha.\n\nTom: O tom deve permanecer profissional e direto.\nSaída: Retorne APENAS o texto corrigido, sem qualquer introdução, comentário ou explicação.'
      }
    ]
  }

  const contents = [
    {
      role: 'user',
      parts: [{ text: text }]
    }
  ]

  return await callGeminiAPI(apiKey, contents, systemInstruction)
}

/**
 * Gera um texto profissional a partir de tópicos fornecidos
 */
async function generateFromTopics(apiKey, topics) {
  const systemInstruction = {
    parts: [
      {
        text: 'Persona: Você é um redator técnico especialista, focado em transformar tópicos em uma comunicação clara e objetiva.\nTarefa: Converta os tópicos fornecidos pelo analista em um texto técnico coeso e bem estruturado para ser usado como o corpo de um Trâmite de suporte.\nRegras Estritas:\n1. Apenas o Conteúdo: Sua resposta deve conter APENAS o desenvolvimento dos tópicos. NÃO inclua saudações, introduções, comentários ou encerramentos.\n2. Linguagem Clara: Utilize uma linguagem profissional e didática.\n3. Formatação: Utilize Enter simples para quebras de linha. Use negrito (<b>) para destacar elementos importantes e listas numeradas (<b>1. </b>) se os tópicos indicarem um passo a passo. Use &bull; para Marcador.\n4. Estilo: Adapte seu estilo de escrita para ser o mais similar possível aos exemplos de respostas anteriores fornecidos.\nSaída: Retorne exclusivamente o texto gerado.'
      }
    ]
  }

  const samples = await getUserResponseSamples()
  const fewShotExamples = []

  if (samples.length > 0) {
    fewShotExamples.push({
      role: 'user',
      parts: [{ text: 'Exemplo de como eu escrevo:' }]
    })
    fewShotExamples.push({ role: 'model', parts: [{ text: samples[0] }] })
  }
  if (samples.length > 1) {
    fewShotExamples.push({
      role: 'user',
      parts: [{ text: 'Outro exemplo do meu estilo:' }]
    })
    fewShotExamples.push({ role: 'model', parts: [{ text: samples[1] }] })
  }

  const userPrompt = {
    role: 'user',
    parts: [{ text: `Tópicos a serem abordados: ${topics}` }]
  }

  const contents = [...fewShotExamples, userPrompt]

  return await callGeminiAPI(apiKey, contents, systemInstruction)
}

/**
 * Analisa o histórico de um chamado e gera um resumo e sugestão de ação
 */
async function summarizeSupportRequest(apiKey, extractedContent) {
  const systemInstruction = {
    parts: [
      {
        text: 'Você é um analista de suporte sênior. Analise o histórico do chamado e retorne 2 seções, usando "---" como separador.\n\n[RESUMO]\nCrie um texto unificado que comece com um parágrafo de resumo (2-3 frases) sobre o problema central e o estado atual. Em seguida, adicione uma lista de bullet points com os fatos e eventos mais cruciais do histórico, sem repetir informações. Não inicie sua resposta com asteriscos ou qualquer outro caractere especial.\n---\n[PRÓXIMA AÇÃO]\nRecomende a próxima ação mais lógica para o analista. Seja conciso e use um tom de sugestão (ex: "Considerar...", "Sugerimos verificar...", "Pode ser útil solicitar...").'
      }
    ]
  }

  const contents = [
    {
      role: 'user',
      parts: [
        { text: `Histórico da Solicitação para analisar:\n${extractedContent}` }
      ]
    }
  ]

  return await callGeminiAPI(apiKey, contents, systemInstruction)
}

/**
 * Completa um rascunho de resposta (Co-piloto)
 */
async function completeDraft(apiKey, extractedContent, currentDraft) {
  const systemInstruction = {
    parts: [
      {
        text: 'Você é um "co-piloto" de suporte técnico para um analista. Sua tarefa é transformar o rascunho do analista em uma resposta final, profissional e completa em Português Brasileiro. Utilize o histórico do chamado como contexto para entender o problema. Melhore a clareza, a gramática e a formatação do texto. Se o rascunho for apenas uma ideia inicial, desenvolva-a. Use formatação HTML (<b>, <br>, listas) para legibilidade. Responda APENAS com o texto finalizado. SIGA O ESTILO DE ESCRITA E FORMATAÇÃO DOS EXEMPLOS FORNECIDOS.'
      }
    ]
  }

  const samples = await getUserResponseSamples()
  const fewShotExamples = []

  if (samples.length > 0) {
    fewShotExamples.push({
      role: 'user',
      parts: [{ text: 'Exemplo de uma resposta completa que eu escrevi:' }]
    })
    fewShotExamples.push({ role: 'model', parts: [{ text: samples[0] }] })
  }
  if (samples.length > 1) {
    fewShotExamples.push({
      role: 'user',
      parts: [{ text: 'Outro exemplo do meu estilo de resposta:' }]
    })
    fewShotExamples.push({ role: 'model', parts: [{ text: samples[1] }] })
  }

  const userPrompt = {
    role: 'user',
    parts: [
      {
        text: `**Histórico do Chamado (Contexto):**\n${extractedContent}\n\n**Rascunho do Analista (Para Completar):**\n${currentDraft}`
      }
    ]
  }

  const contents = [...fewShotExamples, userPrompt]

  return await callGeminiAPI(apiKey, contents, systemInstruction)
}

/**
 * Testa a conexão com a API do Gemini usando uma chave
 */
async function testApiKey(apiKey) {
  try {
    const systemInstruction = {
      parts: [{ text: 'Responda apenas com a palavra "OK".' }]
    }
    const contents = [{ role: 'user', parts: [{ text: 'Teste' }] }]
    const response = await callGeminiAPI(apiKey, contents, systemInstruction)
    return response.trim().toLowerCase() === 'ok'
  } catch (error) {
    throw error
  }
}
