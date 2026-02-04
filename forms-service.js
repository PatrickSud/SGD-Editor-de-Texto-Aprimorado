/**
 * @file forms-service.js
 * Serviço para gerenciar dados de formulários e documentos.
 * Suporta configuração remota via GitHub Gist com fallback local.
 */

// Dados padrão (fallback caso a internet falhe)
const DEFAULT_FORMS_DATA = {
  categories: [
    {
      category: 'Documentos e Formulários Úteis',
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
        },
        {
          type: 'link',
          title: 'Fluxo de atendimento fone',
          description: 'Manual de Suporte ao Cliente',
          url: 'https://trten-my.sharepoint.com.mcas.ms/personal/artur_bortolotto_thomsonreuters_com/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fartur%5Fbortolotto%5Fthomsonreuters%5Fcom%2FDocuments%2FArquivos%20de%20Chat%20do%20Microsoft%20Teams%2FFluxo%20de%20atendimento%20fone%202026%202%201%20%281%29%2Epdf&parent=%2Fpersonal%2Fartur%5Fbortolotto%5Fthomsonreuters%5Fcom%2FDocuments%2FArquivos%20de%20Chat%20do%20Microsoft%20Teams&ga=1',
          icon: '📞'
        },
        {
          type: 'link',
          title: 'Padrão de Atendimento - Accountability',
          description: 'Reportar inconsistencias no Padrão de Atendimento',
          url: 'https://forms.office.com.mcas.ms/pages/responsepage.aspx?id=ZLjMYhpqXUuOHDl97BqCWM59WIRDW35Lmh6MTWauMJxUN1ZRUU5OUEhXOUpHMlFKTEI1UkVPRk84Vy4u',
          icon: '📋'
        },
        {
          type: 'link',
          title: 'Accountability (N1) - Tipos de Account',
          description: 'Tipos de Account e suas explicações',
          url: 'https://app.powerbi.com/groups/me/apps/2aec974d-9cbd-4b35-825e-5c115d49e6ce/reports/8029b738-f1a6-413d-8bd0-ed1fe17891c6/7acf0c34f6fd5737d792?ctid=62ccb864-6a1a-4b5d-8e1c-397dec1a8258&experience=power-bi',
          icon: '⚖️'
        },
        {
          type: 'link',
          title: 'Metas 2026',
          description: 'Metas de atendimento - 2026',
          url: 'https://app.powerbi.com/groups/me/apps/2aec974d-9cbd-4b35-825e-5c115d49e6ce/reports/7b0c10f0-f5fd-436d-aad3-8c3d8f83d322?ctid=62ccb864-6a1a-4b5d-8e1c-397dec1a8258&experience=power-bi',
          icon: '🎯'
        },
        {
          type: 'link',
          title: 'Processos do Time',
          description: 'Relatórios e formulários úteis para técnicos',
          url: 'https://app.powerbi.com/groups/me/apps/2aec974d-9cbd-4b35-825e-5c115d49e6ce/reports/d482aaa3-8c34-41c9-8af2-905fd2230e08/ReportSection58e02daa68a06633c20b?ctid=62ccb864-6a1a-4b5d-8e1c-397dec1a8258&experience=power-bi',
          icon: '📂'
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
          description: 'Fila AT',
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
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/bdcf2679-98c5-4201-98bd-2c53ee07e63e',
          icon: '🤖'
        }
      ]
    },
    {
      category: 'Outros',
      items: [
        {
          type: 'link',
          title: 'Assistente - Cadastro SA/NE',
          description: 'Peça para a IA sugerir cadastro SAM/NE/SAL/SAIL para o modulo desejado.',
          url: 'https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/3ef5f8c0-721e-4ee1-bf3a-48e37ec9f9e2?sidebar=instructions_auto',
          icon: '🤖'
        }
      ]
    },
    {
      category: 'Procedimentos e Outros',
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
        },
        {
          type: 'action-closing',
          title: 'Encerramento - NE + AT',
          description: 'Encerramento para atendimentos com encaminhamento para Área Técnica vinculados a NE.',
          icon: '💡',
          closingData: {
            title: 'NE + AT',
            content: `Caso não haja mais dúvidas, pedimos a gentileza de <a href="https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=6671&palavraChave=Concluir%20atendimento&modulosSelecionados=0&intencaoID=0" target="_blank" style="color: rgb(255, 101, 0); position: relative; display: inline-block; background: linear-gradient(90deg, rgb(255, 101, 0) 0%, rgb(255, 150, 50) 50%, rgb(255, 101, 0) 100%); background-size: 200% 100%; animation: fadeSlide 2s ease-in-out infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;"><b>concluir este atendimento</b></a> para que o mesmo fique no status <b>"Pendente - Domínio Sistemas"</b>. Dessa forma, vocês poderão acompanhar a evolução da correção diretamente pelo sistema e serão notificados assim que a atualização com a solução estiver disponível.
    
Se surgir alguma dúvida sobre o atendimento ou sobre o andamento da correção, estamos aqui para ajudar!
    
Conheça mais sobre como funciona a <img src="https://suporte.dominioatendimento.com/central/imagens/modulos/modulo_25.png" style="width: 20px; height: 20px; vertical-align: middle;"> <b><span style="color:#fa6400">Área Técnica</span></b> do sistema Domínio, <a href="https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=8811&palavraChave=treinamento%20%C3%A1rea%20tecnica&modulosSelecionados=0&intencaoID=0" target="_blank" style="color: rgb(255, 101, 0); position: relative; display: inline-block; background: linear-gradient(90deg, rgb(255, 101, 0) 0%, rgb(255, 150, 50) 50%, rgb(255, 101, 0) 100%); background-size: 200% 100%; animation: fadeSlide 2s ease-in-out infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;"><b>clique aqui</b></a>.<style>  @keyframes fadeSlide {    0% { background-position: 200% 0; }    100% { background-position: -200% 0; }  }  </style>

Desejamos a todos uma ótima semana! <nobr style='font-size:19px;'>&#127775;</nobr> <nobr style='font-size:18px;'>&#128075;</nobr>`
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

    // Envia mensagem para o Service Worker fazer o fetch (bypass CORS)
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'FETCH_FORMS_DATA', url: urlWithCacheBust },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Erro de comunicação com SW:', chrome.runtime.lastError)
            resolve(DEFAULT_FORMS_DATA)
            return
          }

          if (response && response.success) {
            console.log('📝 Forms Service: Dados remotos carregados com sucesso via SW')
            const remoteData = response.data

            if (Array.isArray(remoteData)) {
              resolve({ categories: remoteData })
            } else {
              resolve(remoteData)
            }
          } else {
            console.warn('📝 Forms Service: SW falhou ao buscar dados:', response?.error)
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
    return DEFAULT_FORMS_DATA
  }
}

// Exportar para uso global (compatibilidade com info-panel.js)
if (typeof window !== 'undefined') {
  window.fetchFormsData = fetchFormsData
}
