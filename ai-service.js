/**
 * @file ai-service.js
 * @description Interface para comunicação com a API do Gemini.
 */

// Usaremos o modelo Flash por ser rápido e eficiente para essas tarefas.
const GEMINI_API_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';

/**
 * Configuração padrão para as chamadas de API.
 */
const DEFAULT_GENERATION_CONFIG = {
  temperature: 0.6, // Um pouco mais baixo para respostas mais consistentes
  topP: 1,
  topK: 32,
  maxOutputTokens: 4096
};

/**
 * Chamada genérica para a API do Gemini.
 * Utiliza system_instruction para maior robustez (Gemini 1.5+).
 */
async function callGeminiAPI(apiKey, contents, systemInstruction = null) {
  if (!apiKey) {
    throw new Error('A chave de API do Gemini não está configurada.');
  }

  const payload = {
    contents: contents,
    generationConfig: DEFAULT_GENERATION_CONFIG
  };

  // NOVO: Adiciona a capacidade de a resposta ser JSON
  payload.response_mime_type = "application/json";


  if (systemInstruction) {
    payload.system_instruction = systemInstruction;
  }

  try {
    const response = await fetch(`${GEMINI_API_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage =
        errorData.error?.message || `HTTP error! status: ${response.status}`;
      if (
        response.status === 403 ||
        (response.status === 400 && errorMessage.includes('API key not valid'))
      ) {
        throw new Error(
          'Chave de API inválida ou sem permissão. Verifique nas configurações.'
        );
      }
      throw new Error(`Erro na API Gemini: ${errorMessage}`);
    }

    const data = await response.json();
    if (
      !data.candidates ||
      data.candidates.length === 0 ||
      !data.candidates[0].content
    ) {
      // Tenta extrair o texto de um possível bloqueio de segurança
      if (data.promptFeedback && data.promptFeedback.blockReason) {
          throw new Error(`A IA bloqueou a resposta: ${data.promptFeedback.blockReason}. Tente reformular seu texto.`);
      }
      throw new Error('A API não retornou resultados válidos. Tente novamente.');
    }

    // Retorna o texto gerado (a IA é instruída a retornar JSON, então o texto será uma string JSON)
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Erro ao chamar a API Gemini:', error);
    throw error;
  }
}

// --- LÓGICA DE APRENDIZADO DE ESTILO (FEW-SHOT PROMPTING) ---

/**
 * Busca amostras de respostas do usuário que são semanticamente relevantes para o contexto atual.
 * @param {string} context - O texto/tópicos atuais para encontrar exemplos relevantes.
 * @param {number} limit - O número máximo de exemplos a retornar.
 * @returns {Promise<Array<object>>} Uma lista de amostras de resposta relevantes.
 */
async function getRelevantResponseSamples(context, limit = 2) {
    const allSamples = await getResponseSamples();
    if (allSamples.length === 0) return [];

    // Para evitar uma chamada de API extra apenas para classificar, usamos uma heurística simples:
    // Pegamos as amostras mais recentes, que são mais prováveis de refletir o estilo atual do usuário.
    // Uma implementação mais avançada poderia usar a API para encontrar as mais relevantes.
    return allSamples.slice(0, limit);
}


// --- FUNÇÕES ESPECÍFICAS DE IA ---

/**
 * 1. Corrige ortografia e gramática de um texto.
 */
async function correctText(apiKey, text) {
  const systemInstruction = {
    parts: [
      {
        text: 'Você é um assistente de escrita profissional para suporte técnico em Português Brasileiro. Sua tarefa é corrigir a ortografia e a gramática do texto fornecido, mantendo o significado original e o tom profissional. O texto pode conter formatação HTML (<b>, <i>, <br>, <span>). Preserve a formatação HTML original o máximo possível. Responda APENAS com o texto corrigido, sem introduções ou explicações, em um objeto JSON com a chave "corrected_text".'
      }
    ]
  };

  const contents = [
    {
      role: 'user',
      parts: [{ text: text }]
    }
  ];

  const resultJson = await callGeminiAPI(apiKey, contents, systemInstruction);
  return JSON.parse(resultJson).corrected_text;
}

/**
 * 2. Gera um texto profissional a partir de tópicos, adaptando-se ao estilo do usuário.
 */
async function generateFromTopics(apiKey, topics) {
    const settings = await getSettings();
    let examplesText = "";

    if (settings.enableStyleAdaptation) {
        const samples = await getRelevantResponseSamples(topics, 2);
        if (samples.length > 0) {
            examplesText = "\n\nUse os seguintes exemplos como referência para o tom, estilo e formatação:\n\n";
            samples.forEach((sample, index) => {
                examplesText += `EXEMPLO DE ESTILO ${index + 1}:\n"""\n${sample.text}\n"""\n\n`;
            });
        }
    }

  const systemInstruction = {
    parts: [
      {
        text: `Você é um assistente de suporte técnico. Elabore uma resposta profissional e clara para um chamado de suporte em Português Brasileiro, abordando os tópicos fornecidos pelo analista. Estruture a resposta de forma lógica. Utilize formatação HTML básica (<b> para destaques, <br> para quebras de linha, listas numeradas como <b>1. </b>) para melhorar a legibilidade. Responda apenas com o texto gerado, em um objeto JSON com a chave "generated_text".` + examplesText
      }
    ]
  };

  const contents = [
    {
      role: 'user',
      parts: [{ text: `Tópicos a serem abordados: ${topics}` }]
    }
  ];

  const resultJson = await callGeminiAPI(apiKey, contents, systemInstruction);
  return JSON.parse(resultJson).generated_text;
}

/**
 * 3. Resume o histórico e extrai entidades chave.
 */
async function summarizeAndExtractEntities(apiKey, extractedContent) {
  const systemInstruction = {
    parts: [
      {
        text: `Você é um analista de suporte sênior. Sua tarefa é analisar o histórico da solicitação de suporte e retornar um resumo estruturado.
        
        Instruções:
        1.  **Resumo**: Gere um resumo conciso (máximo 4 frases) identificando o problema principal, os passos chave realizados e o estado atual.
        2.  **Extração de Entidades**: Identifique e extraia informações-chave como nomes de produtos, versões, códigos de erro, nomes de arquivos, etc.
        3.  **Formato da Resposta**: Retorne um objeto JSON válido com duas chaves:
            - \`summary\`: Uma string contendo o resumo em texto.
            - \`entities\`: Um objeto onde cada chave é uma categoria (ex: "Produtos", "Erros") e o valor é um array de strings com os dados encontrados. Se nenhuma entidade for encontrada, retorne um objeto vazio.
            
        A resposta DEVE ser apenas o objeto JSON.`
      }
    ]
  };

  const contents = [
    {
      role: 'user',
      parts: [
        { text: `Histórico da Solicitação para analisar:\n${extractedContent}` }
      ]
    }
  ];

  const resultJson = await callGeminiAPI(apiKey, contents, systemInstruction);
  return JSON.parse(resultJson);
}


/**
 * 4. Realiza busca inteligente (semântica) nos trâmites rápidos salvos.
 */
async function searchQuickMessages(apiKey, query, messages) {
  if (messages.length === 0 || !query) {
    return [];
  }

  // Prepara os dados das mensagens para o prompt
  const messagesContext = messages
    .map(m => `ID: ${m.id}\nTítulo: ${m.title}\nConteúdo: ${m.message}`)
    .join('\n\n---\n\n');

  const systemInstruction = {
    parts: [
      {
        text: `Você é um motor de busca semântica. Analise a consulta do usuário e a lista de trâmites e retorne uma lista JSON ordenada com os IDs dos trâmites mais relevantes. A resposta deve ser APENAS o array JSON de strings. Exemplo: ["msg-123", "msg-456"]`
      }
    ]
  };

  const prompt = `Consulta do Usuário: "${query}"\n\nTrâmites Salvos:\n${messagesContext}`;

  const contents = [
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  const resultText = await callGeminiAPI(apiKey, contents, systemInstruction);

  try {
    const resultArray = JSON.parse(resultText);
    if (Array.isArray(resultArray)) {
      const validIds = new Set(messages.map(m => m.id));
      return resultArray.filter(id => validIds.has(id));
    }
    return [];
  } catch (e) {
    console.error('A IA não retornou um JSON válido para a busca:', resultText);
    return [];
  }
}

/**
 * 5. Gera uma sugestão de resposta completa com base no contexto (Completar Rascunho).
 */
async function generateFullResponse(apiKey, extractedContent, currentDraft) {
    const settings = await getSettings();
    let examplesText = "";

    if (settings.enableStyleAdaptation) {
        const samples = await getRelevantResponseSamples(extractedContent, 2);
        if (samples.length > 0) {
            examplesText = "\n\nUse os seguintes exemplos como referência para o tom, estilo e formatação:\n\n";
            samples.forEach((sample, index) => {
                examplesText += `EXEMPLO DE ESTILO ${index + 1}:\n"""\n${sample.text}\n"""\n\n`;
            });
        }
    }

    const systemInstruction = {
        parts: [{
            text: `Você é um assistente de suporte técnico sênior. Sua tarefa é criar uma proposta de resposta completa para um chamado em Português Brasileiro. Use o histórico do chamado para entender o contexto e o rascunho do analista como guia para a intenção. Se o rascunho estiver vazio, formule uma resposta apropriada com base no último trâmite. Use formatação HTML (<b>, <br>, listas). Responda apenas com o texto gerado, em um objeto JSON com a chave "generated_text".` + examplesText
        }]
    };

    const prompt = `HISTÓRICO DO CHAMADO:\n${extractedContent}\n\n---FIM DO HISTÓRICO---\n\nRASCUNHO DO ANALISTA:\n${currentDraft}`;

    const contents = [{
        role: 'user',
        parts: [{ text: prompt }]
    }];

    const resultJson = await callGeminiAPI(apiKey, contents, systemInstruction);
    return JSON.parse(resultJson).generated_text;
}