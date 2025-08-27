/**
 * @file ai-service.js
 * @description Interface para comunicação com a API do Gemini.
 */

// Usaremos o modelo Flash por ser rápido e eficiente para essas tarefas.
const GEMINI_API_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent'

/**
 * Configuração padrão para as chamadas de API.
 */
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.6, // Um pouco mais baixo para respostas mais consistentes
  topP: 1,
  topK: 32,
  maxOutputTokens: 4096
}

/**
 * Chamada genérica para a API do Gemini.
 * Utiliza system_instruction para maior robustez (Gemini 1.5+).
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
      if (
        response.status === 403 ||
        (response.status === 400 && errorMessage.includes('API key not valid'))
      ) {
        throw new Error(
          'Chave de API inválida ou sem permissão. Verifique nas configurações.'
        )
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

    // Retorna o texto gerado
    return data.candidates[0].content.parts[0].text
  } catch (error) {
    console.error('Erro ao chamar a API Gemini:', error)
    throw error
  }
}

// --- FUNÇÕES ESPECÍFICAS DE IA ---

/**
 * 1. Corrige ortografia e gramática de um texto.
 */
async function correctText(apiKey, text) {
  const systemInstruction = {
    parts: [
      {
        text: 'Você é um assistente de escrita profissional para suporte técnico em Português Brasileiro. Sua tarefa é corrigir a ortografia e a gramática do texto fornecido, mantendo o significado original e o tom profissional. O texto pode conter formatação HTML (<b>, <i>, <br>, <span>). Preserve a formatação HTML original o máximo possível. Responda APENAS com o texto corrigido, sem introduções ou explicações.'
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
 * 2. Gera um texto profissional a partir de tópicos fornecidos.
 */
async function generateFromTopics(apiKey, topics) {
  const systemInstruction = {
    parts: [
      {
        text: 'Você é um assistente de suporte técnico. Elabore uma resposta profissional e clara para um chamado de suporte em Português Brasileiro, abordando os tópicos fornecidos pelo analista. Estruture a resposta de forma lógica. Utilize formatação HTML básica (<b> para destaques, <br> para quebras de linha, listas numeradas como <b>1. </b>) para melhorar a legibilidade. Responda apenas com o texto gerado.'
      }
    ]
  }

  const contents = [
    {
      role: 'user',
      parts: [{ text: `Tópicos a serem abordados: ${topics}` }]
    }
  ]

  return await callGeminiAPI(apiKey, contents, systemInstruction)
}

/**
 * 3. Resume a solicitação de suporte com base no conteúdo extraído da página.
 */
async function summarizeSupportRequest(apiKey, extractedContent) {
  const systemInstruction = {
    parts: [
      {
        text: 'Você é um analista de suporte técnico. Sua tarefa é analisar o histórico da solicitação de suporte fornecido (Descrição Inicial e Trâmites Anteriores). Identifique o problema principal do cliente, os passos chave já realizados e o estado atual. Gere um resumo conciso e objetivo (máximo 4 frases ou bullet points). Responda apenas com o resumo em Português Brasileiro.'
      }
    ]
  }

  const contents = [
    {
      role: 'user',
      parts: [
        { text: `Histórico da Solicitação para resumir:\n${extractedContent}` }
      ]
    }
  ]

  return await callGeminiAPI(apiKey, contents, systemInstruction)
}
