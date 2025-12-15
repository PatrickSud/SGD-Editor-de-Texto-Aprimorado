/**
 * @file forms-service.js
 * Serviço para gerenciar dados de formulários e documentos.
 * Suporta configuração remota via GitHub Gist com fallback local.
 */

// Dados padrão (fallback caso a internet falhe)
const DEFAULT_FORMS_DATA = {
  categories: [
    {
      category: 'Formulários Úteis',
      items: [
        {
          type: 'link',
          title: 'Filas Domínio',
          description: 'Planilha informativa de filas',
          url: 'https://trten-my.sharepoint.com.mcas.ms/:x:/g/personal/tiago_antunes_thomsonreuters_com/Eb5JfTHhiy9LhY8F8QR9zlMBABA-8hmLahcBaDBZ1HFAkQ?e=yVa3KA&ovuser=62ccb864-6a1a-4b5d-8e1c-397dec1a8258%2CPatrick.Godoy%40thomsonreuters.com&clickparams=eyJBcHBOYW1lIjoiVGVhbXMtRGVza3RvcCIsIkFwcFVe9zao3D',
          icon: '📊'
        },
        {
          type: 'link',
          title: 'Migração Onvio',
          description: 'Solicitação de Migração Processos/Messenger',
          url: 'https://forms.office.com/pages/responsepage.aspx?id=ZLjMYhpqXUuOHDl97BqCWM4bBsZAv8FKs97c0LWt0g9UNDRVMEcxUzhCTllTNVBURFFBS0lTQUIzTy4u&route=shorturl',
          icon: '☁️'
        },
        {
          type: 'link',
          title: 'Genesys Instabilidade',
          description: 'Notificar instabilidade no sistema Genesys',
          url: 'https://forms.office.com.mcas.ms/pages/responsepage.aspx?id=ZLjMYhpqXUuOHDl97BqCWPbHowoOAepDna1oDZ3k4exUQ1FFWkZMQlk4UVpZMEY3UTdWVldNMlZCSS4u&route=shorturl',
          icon: '🚨'
        }
      ]
    },
    {
      category: 'AI Chains - Assistentes',
      items: [
        {
          type: 'link',
          title: 'Assuntos Fila 3',
          description: 'Onvio Gestão e Portal do Cliente',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/ec6d18b1-955b-426a-a34d-622065fd982a?sidebar=instructions',
          icon: '🤖'
        },
        {
          type: 'link',
          title: 'Novo Portal do Empregado',
          description: 'Domínio Para Você (Fila 3)',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/9631a5ff-16d7-4f9b-b3f4-28f5562b8749?chain_builder=true&sidebar=instructions_auto',
          icon: '🤖'
        },
        {
          type: 'link',
          title: 'Assuntos Fila 41',
          description: 'Domínio Processos',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/5b28725a-42d4-4de7-926b-430cde10f85c?chain_builder=true&sidebar=instructions_auto',
          icon: '🤖'
        },
        {
          type: 'link',
          title: 'Assuntos Fila 42',
          description: 'Domínio Messenger',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/b787e0c7-2608-4ae6-97e5-b128c205c194?chain_builder=true&sidebar=instructions_auto',
          icon: '🤖'
        },
        {
          type: 'link',
          title: 'Assuntos Fila 5',
          description: 'Contábil e Impostos',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/db7162a0-ad9b-4c19-85c4-315169a1ef43?sidebar=instructions_auto',
          icon: '🤖'
        },
        {
          type: 'link',
          title: 'Assuntos Fila 61',
          description: 'Honorários e demais módulos',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/01138fe4-aecd-48bc-a958-e8ef1006f487?chain_builder=true&sidebar=instructions_auto',
          icon: '🤖'
        },
        {
          type: 'link',
          title: 'Assuntos Fila 62',
          description: 'Secundários (OnBalance, CCT, Busca, Sefaz, API)',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/bdcf2679-98c5-4201-98bd-2c53ee07e63e?sidebar=instructions_auto',
          icon: '🤖'
        }
      ]
    },
    {
      category: 'Documentos e Procedimentos',
      items: [
        {
          type: 'action-closing',
          title: 'Encerramento - Acesso Remoto',
          description: 'Encerramento orientando instalação do Calling Card para Acesso Remoto.',
          icon: '🖥️',
          closingData: {
            title: 'Acesso Remoto',
            content: `<b>Você sabia?! Nosso suporte via acesso remoto pode ser ainda mais ágil! </b><nobr style='font-size:20px;'>&#9757;</nobr></b><nobr style='font-size:20px;'>&#129299;</nobr>
            Pesquise pela ferramenta “<b>Acesso Remoto - Domínio Sistemas</b>”, instalada em sua máquina: <img src="https://www.dropbox.com/scl/fi/495canzpdjs211hh6la45/acesso.gif?rlkey=5khplj8wi64db0xyv2rsrql5a&st=y923wzze&raw=1"  width="200" height="32" border="0" alt="iniciar"> ou clique na imagem abaixo para baixar e instalar! 
 <a href="https://download.dominiosistemas.com.br/Suporte/AcessoRemoto/LogMeInRescueCallingCard.msi" target="_blank">
 <img src="https://www.dropbox.com/scl/fi/byeq2k2diaqq9wqv2sk3r/acesso_icon.png?rlkey=qky0l9byalcwojsi04xpq7o88&st=ybvth8cw&raw=1"  width="250" height="118" border="0" alt="acesso_remoto"></a>
 [finalizacao]! <nobr style='font-size:18px;'>&#10024;</nobr>`
          }
        }
      ]
    }
  ]
}

// URL Raw do Gist do GitHub
const REMOTE_CONFIG_URL =
  'https://gist.githubusercontent.com/PatrickSud/a5c191a645d21494ac6f245a56dc32df/raw/forms-config.json'

/**
 * Busca dados de formulários, priorizando configuração remota com fallback local.
 * @returns {Promise<Object>} Dados de formulários
 */
async function fetchFormsData() {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Function entry',data:{hasUrl:!!REMOTE_CONFIG_URL,url:REMOTE_CONFIG_URL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
  // #endregion
  
  // Se não há URL configurada, retorna dados locais
  if (!REMOTE_CONFIG_URL || REMOTE_CONFIG_URL.trim() === '') {
    console.log('📝 Forms Service: Usando dados locais (URL não configurada)')
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Using local data - no URL',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    return DEFAULT_FORMS_DATA
  }

  try {
    console.log('📝 Forms Service: Buscando dados remotos...')
    // Adiciona timestamp único para evitar cache
    const timestamp = new Date().getTime()
    const urlWithCacheBust = `${REMOTE_CONFIG_URL}?t=${timestamp}`
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Sending message to SW',data:{url:urlWithCacheBust},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    // Envia mensagem para o Service Worker fazer o fetch (bypass CORS)
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { action: 'FETCH_FORMS_DATA', url: urlWithCacheBust },
            (response) => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'SW response received',data:{hasResponse:!!response,success:response?.success,hasData:!!response?.data,dataType:typeof response?.data,isArray:Array.isArray(response?.data),error:response?.error,chromeError:chrome.runtime.lastError?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                if (chrome.runtime.lastError) {
                    console.warn('Erro de comunicação com SW:', chrome.runtime.lastError)
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'SW communication error',data:{error:chrome.runtime.lastError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                    // #endregion
                    resolve(DEFAULT_FORMS_DATA)
                    return
                }
                
                if (response && response.success) {
                    console.log('📝 Forms Service: Dados remotos carregados com sucesso via SW')
                    const remoteData = response.data
                    
                    // #region agent log
                    const dataStructure = {
                      isArray: Array.isArray(remoteData),
                      hasCategories: !!(remoteData && remoteData.categories),
                      categoriesCount: Array.isArray(remoteData) ? remoteData.length : (remoteData?.categories?.length || 0),
                      firstCategoryName: Array.isArray(remoteData) ? remoteData[0]?.category : remoteData?.categories?.[0]?.category,
                      firstCategoryItemsCount: Array.isArray(remoteData) ? remoteData[0]?.items?.length : remoteData?.categories?.[0]?.items?.length
                    }
                    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Remote data structure',data:dataStructure,timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    
                    if (Array.isArray(remoteData)) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Resolving with array format',data:{categoriesCount:remoteData.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                        // #endregion
                        resolve({ categories: remoteData })
                    } else {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Resolving with object format',data:{hasCategories:!!remoteData.categories},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                        // #endregion
                        resolve(remoteData)
                    }
                } else {
                    console.warn('📝 Forms Service: SW falhou ao buscar dados:', response?.error)
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'SW fetch failed',data:{error:response?.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                    // #endregion
                    resolve(DEFAULT_FORMS_DATA)
                }
            }
        )
    })
  } catch (error) {
    console.warn(
      '📝 Forms Service: Erro inesperado, usando fallback local:',
      error.message
    )
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/25d49048-d157-41a6-b992-3f42235cf282',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'forms-service.js:fetchFormsData',message:'Unexpected error',data:{error:error.message,stack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    return DEFAULT_FORMS_DATA
  }
}

// Exportar para uso global (compatibilidade com info-panel.js)
if (typeof window !== 'undefined') {
  window.fetchFormsData = fetchFormsData
}
