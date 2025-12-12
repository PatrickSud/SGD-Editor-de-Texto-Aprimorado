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
      category: 'Documentos e Procedimentos',
      items: []
    }
  ]
}

// TODO: Cole aqui a URL Raw do seu Gist do GitHub
const REMOTE_CONFIG_URL =
  'https://gist.githubusercontent.com/PatrickSud/a5c191a645d21494ac6f245a56dc32df/raw/f210de00294da63ec65a43349c9c698208deff12/forms-config.json'

/**
 * Busca dados de formulários, priorizando configuração remota com fallback local.
 * @returns {Promise<Object>} Dados de formulários
 */
async function fetchFormsData() {
  // Se não há URL configurada, retorna dados locais
  if (!REMOTE_CONFIG_URL || REMOTE_CONFIG_URL.trim() === '') {
    console.log('📝 Forms Service: Usando dados locais (URL não configurada)')
    return DEFAULT_FORMS_DATA
  }

  try {
    console.log('📝 Forms Service: Buscando dados remotos...')
    // Adiciona timestamp único para evitar cache
    const timestamp = new Date().getTime()
    const urlWithCacheBust = `${REMOTE_CONFIG_URL}?t=${timestamp}`
    const response = await fetch(urlWithCacheBust, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const remoteData = await response.json()
    console.log('📝 Forms Service: Dados remotos carregados com sucesso')

    // Se os dados são um array, converter para o formato esperado { categories: [...] }
    if (Array.isArray(remoteData)) {
      return { categories: remoteData }
    }

    return remoteData
  } catch (error) {
    console.warn(
      '📝 Forms Service: Falha ao buscar dados remotos, usando fallback local:',
      error.message
    )
    return DEFAULT_FORMS_DATA
  }
}

// Exportar para uso global (compatibilidade com info-panel.js)
if (typeof window !== 'undefined') {
  window.fetchFormsData = fetchFormsData
}
