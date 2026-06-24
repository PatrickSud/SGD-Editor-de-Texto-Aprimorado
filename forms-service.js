/**
 * @file forms-service.js
 * Serviço para gerenciar dados de formulários e documentos.
 * Suporta configuração remota via GitHub Gist com fallback local.
 */
// Dados padrão (fallback caso a internet falhe)
const DEFAULT_FORMS_DATA = {
  "categories": [
    {
      "category": "Documentos e Formulários Úteis",
      "items": [
        {
          "type": "link",
          "title": "Filas Domínio",
          "description": "Planilha informativa de filas",
          "url": "https://trten-my.sharepoint.com.mcas.ms/:x:/g/personal/tiago_antunes_thomsonreuters_com/Eb5JfTHhiy9LhY8F8QR9zlMBABA-8hmLahcBaDBZ1HFAkQ?e=yVa3KA&ovuser=62ccb864-6a1a-4b5d-8e1c-397dec1a8258%2CPatrick.Godoy%40thomsonreuters.com&clickparams=eyJBcHBOYW1lIjoiVGVhbXMtRGVza3RvcCIsIkFwcFVe9zao3D",
          "icon": "📊"
        },
        {
          "type": "link",
          "title": "Migração Onvio",
          "description": "Solicitação de Migração Processos/Messenger",
          "url": "https://forms.office.com/pages/responsepage.aspx?id=ZLjMYhpqXUuOHDl97BqCWM4bBsZAv8FKs97c0LWt0g9UNDRVMEcxUzhCTllTNVBURFFBS0lTQUIzTy4u&route=shorturl",
          "icon": "☁️"
        },
        {
          "type": "link",
          "title": "Genesys Instabilidade",
          "description": "Notificar instabilidade no sistema Genesys",
          "url": "https://forms.office.com.mcas.ms/pages/responsepage.aspx?id=ZLjMYhpqXUuOHDl97BqCWPbHowoOAepDna1oDZ3k4exUQ1FFWkZMQlk4UVpZMEY3UTdWVldNMlZCSS4u&route=shorturl",
          "icon": "🚨"
        },
        {
          "type": "link",
          "title": "Fluxo de atendimento fone",
          "description": "Manual de Suporte ao Cliente",
          "url": "https://trten-my.sharepoint.com.mcas.ms/personal/artur_bortolotto_thomsonreuters_com/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fartur%5Fbortolotto%5Fthomsonreuters%5Fcom%2FDocuments%2FArquivos%20de%20Chat%20do%20Microsoft%20Teams%2FFluxo%20de%20atendimento%20fone%202026%202%201%20%281%29%2Epdf&parent=%2Fpersonal%2Fartur%5Fbortolotto%5Fthomsonreuters%5Fcom%2FDocuments%2FArquivos%20de%20Chat%20do%20Microsoft%20Teams&ga=1",
          "icon": "📞"
        },
        {
          "type": "link",
          "title": "Padrão de Atendimento - Accountability",
          "description": "Reportar inconsistencias no Padrão de Atendimento",
          "url": "https://forms.office.com.mcas.ms/pages/responsepage.aspx?id=ZLjMYhpqXUuOHDl97BqCWM59WIRDW35Lmh6MTWauMJxUN1ZRUU5OUEhXOUpHMlFKTEI1UkVPRk84Vy4u",
          "icon": "📋"
        },
        {
          "type": "link",
          "title": "Accountability (N1) - Tipos de Account",
          "description": "Tipos de Account e suas explicações",
          "url": "https://app.powerbi.com/groups/me/apps/2aec974d-9cbd-4b35-825e-5c115d49e6ce/reports/8029b738-f1a6-413d-8bd0-ed1fe17891c6/7acf0c34f6fd5737d792?ctid=62ccb864-6a1a-4b5d-8e1c-397dec1a8258&experience=power-bi",
          "icon": "⚖️"
        },
        {
          "type": "link",
          "title": "Metas 2026",
          "description": "Metas de atendimento - 2026",
          "url": "https://app.powerbi.com/groups/me/apps/2aec974d-9cbd-4b35-825e-5c115d49e6ce/reports/7b0c10f0-f5fd-436d-aad3-8c3d8f83d322?ctid=62ccb864-6a1a-4b5d-8e1c-397dec1a8258&experience=power-bi",
          "icon": "🎯"
        },
        {
          "type": "link",
          "title": "Processos do Time",
          "description": "Central com relatórios e formulários úteis para técnicos",
          "url": "https://app.powerbi.com/groups/me/apps/2aec974d-9cbd-4b35-825e-5c115d49e6ce/reports/d482aaa3-8c34-41c9-8af2-905fd2230e08/ReportSection58e02daa68a06633c20b?ctid=62ccb864-6a1a-4b5d-8e1c-397dec1a8258&experience=power-bi",
          "icon": "📂"
        }
      ]
    },
    {
      "category": "Apoio e Geral",
      "items": [
        {
          "type": "link",
          "title": "SGD Interno",
          "description": "Dúvidas gerais",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/1cea8592-8748-47bd-8c4b-5318d6599045?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Analisador de SSCs Recentes",
          "description": "Consultar SSCs recentes do mesmo cliente",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/1c742809-5c60-4e38-9432-cd350906de7c?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Apoio ao Suporte",
          "description": "Boas práticas telefone/laptop",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/4f0e3f37-e63f-4188-8c15-373eb75c77c8?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assistente Suporte",
          "description": "Padrões e assuntos por fila",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/bf79bed3-d1f2-4b9c-b08a-a7c0551eb4dc?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assistente - Conceitos",
          "description": "Dúvidas conceituais",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/32b16228-9d6f-4bf6-b9ce-18ea59c2095d?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assistente - Cadastro de SSs",
          "description": "Manual Cadastro de SSs",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/27921542-92d4-408a-a3cb-bb4372553e43?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assistente - Cadastro SA/NE",
          "description": "Peça para a IA sugerir cadastro SAM/NE/SAL/SAIL para o modulo desejado.",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/3ef5f8c0-721e-4ee1-bf3a-48e37ec9f9e2?sidebar=instructions_auto",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assistente - Pesquisa Central",
          "description": "Pesquisa Central por imagens e texto",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/60b4c57b-2858-460f-aaeb-65cb4cd100e1?chain_builder=true",
          "icon": "🤖"
        }
      ]
    },
    {
      "category": "Filas & Módulos",
      "items": [
        {
          "type": "link",
          "title": "Assuntos Fila 3",
          "description": "Onvio Gestão e Portal do Cliente",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/ec6d18b1-955b-426a-a34d-622065fd982a?sidebar=instructions",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assuntos Fila 41",
          "description": "Domínio Processos",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/1672b454-2cff-46fb-89d8-b939b0a5385b?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assuntos Fila 42",
          "description": "Domínio Messenger",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/b787e0c7-2608-4ae6-97e5-b128c205c194?chain_builder=true&sidebar=instructions_auto",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assuntos Fila 5",
          "description": "Fila AT",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/db7162a0-ad9b-4c19-85c4-315169a1ef43?sidebar=instructions_auto",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assuntos Fila 61",
          "description": "Honorários e demais módulos",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/01138fe4-aecd-48bc-a958-e8ef1006f487?chain_builder=true&sidebar=instructions_auto",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Assuntos Fila 62",
          "description": "Secundários (OnBalance, CCT, Busca, Sefaz, API)",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/bdcf2679-98c5-4201-98bd-2c53ee07e63e",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Domínio Processos",
          "description": "Dúvidas gerais",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/98d8e94a-f795-44fe-aa86-ab8b4471e202?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Domínio Cobranças",
          "description": "Dúvidas gerais",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/26858ea4-9ffd-479a-8125-5f127341d34d?chain_builder=true",
          "icon": "🤖"
        }
      ]
    },
    {
      "category": "Folha de Pagamento",
      "items": [
        {
          "type": "link",
          "title": "Novo Portal do Empregado",
          "description": "Domínio Para Você (Fila 3)",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/9631a5ff-16d7-4f9b-b3f4-28f5562b8749?chain_builder=true&sidebar=instructions_auto",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FOLHA - Consulta SA/NE",
          "description": "Extrator DIRF",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/e68e988c-403d-4917-91e3-2b5344ac5e8a?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FOLHA - Dúvidas Gerais",
          "description": "Dúvidas gerais (sem anexos)",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/0a365547-b3e1-4008-bbbd-afee1596dcf6?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FOLHA - Rubricas com Fórmulas",
          "description": "Consulta de Rubricas com Fórmulas",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/b653d9c8-da78-4880-9347-e08a8c97c145?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FOLHA - Analisador de INSS",
          "description": "Analisador de arquivo de INSS",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/efb4ae5e-191c-4cbe-9a68-8ef4ed3497af?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FOLHA - Rubricas Fórmulas (5.2)",
          "description": "Rúbricas com Fórmulas (GPT 5.2)",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/9692b101-98e8-4d62-9948-918e90904e31?chain_builder=true",
          "icon": "🤖"
        }
      ]
    },
    {
      "category": "Fiscal & Contabilidade",
      "items": [
        {
          "type": "link",
          "title": "FISCONT - Soluções",
          "description": "Buscador de Soluções e SA/NE",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/a84ee410-18f0-4f99-bc65-566b8340e6f8?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Contabilidade Digital",
          "description": "Dúvidas gerais",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/af573701-d00c-4fac-89c8-0e7ea6af3434?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Contabilidade - ECF",
          "description": "Análise erro ECF P200/P400",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/d66d4161-c01a-498a-95d8-229a4a884e26?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FISCONT - Assistente",
          "description": "Assistente virtual FISCONT",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/f4e61162-241e-477b-851e-c28e1470b519?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FISCONT - Reforma Tributária",
          "description": "Dúvidas sobre reforma tributária",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/dbc04d2e-4157-4369-b8af-2877a798dba1?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "FISCONT - Kolossus Auditor",
          "description": "Auditoria e análises",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/0f1088b3-b410-468c-9039-00932d4c13df?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Escrita/Contab/Lalur/Patrimônio",
          "description": "Análise de embasamento legal",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/7e04fbb6-cdef-450f-89b5-d83c392583ba?chain_builder=true",
          "icon": "🤖"
        }
      ]
    },
    {
      "category": "Relatórios & Utilitários",
      "items": [
        {
          "type": "link",
          "title": "Gerador de Relatórios - BGR",
          "description": "Criar arquivo BGR com consultas SQL",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/c5c03c64-1577-4e1d-bf7a-61723a450449?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Gerador de Relatórios - Computados",
          "description": "Criação de Computados",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/7459b824-1a6b-4548-9a3a-6716e1dc5a79?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Performance",
          "description": "Dúvidas Gerais",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/b2a13bb9-d13a-42d8-ad98-a77cd2a8eb10?chain_builder=true",
          "icon": "🤖"
        },
        {
          "type": "link",
          "title": "Listagem de SANE's e SAIL's",
          "description": "Geral",
          "url": "https://aiplatform.thomsonreuters.com/ai-platform/ai-chains/use/bcda651a-1518-4808-97b1-439ad9ca1306?chain_builder=true",
          "icon": "🤖"
        }
      ]
    },
    {
      "category": "Procedimentos e Outros",
      "items": [
        {
          "type": "action-closing",
          "title": "Encerramento - Acesso Remoto",
          "description": "Encerramento orientando instalação do Calling Card para Acesso Remoto.",
          "icon": "🖥️",
          "closingData": {
            "title": "Acesso Remoto",
            "content": "<span style=\"color:#FF7F00;\">___________________________________________________________________________________________</span> \n <b>Você sabia?! Nosso suporte via acesso remoto pode ser ainda mais ágil! </b><nobr style='font-size:20px;'>&#9757;</nobr></b><nobr style='font-size:20px;'>&#129299;</nobr> \n Pesquise pela ferramenta “<b>Acesso Remoto - Domínio Sistemas</b>”, instalada em sua máquina: <img src=\"https://www.dropbox.com/scl/fi/495canzpdjs211hh6la45/acesso.gif?rlkey=5khplj8wi64db0xyv2rsrql5a&st=y923wzze&raw=1\" width=\"200\" height=\"32\" border=\"0\" alt=\"iniciar\"> ou clique na imagem abaixo para baixar e instalar! \n <a href=\"https://download.dominiosistemas.com.br/Suporte/AcessoRemoto/LogMeInRescueCallingCard.msi\" target=\"_blank\"> \n <img src=\"https://www.dropbox.com/scl/fi/byeq2k2diaqq9wqv2sk3r/acesso_icon.png?rlkey=qky0l9byalcwojsi04xpq7o88&st=ybvth8cw&raw=1\" width=\"250\" height=\"118\" border=\"0\" alt=\"acesso_remoto\"></a> \n [finalizacao]! <nobr style='font-size:18px;'>&#10024;</nobr>"
          }
        },
        {
          "type": "action-closing",
          "title": "Encerramento - NE + AT",
          "description": "Encerramento para atendimentos com encaminhamento para Área Técnica vinculados a NE.",
          "icon": "💡",
          "closingData": {
            "title": "NE + AT",
            "content": "Caso não haja mais dúvidas, pedimos a gentileza de <a href=\"https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=6671&palavraChave=Concluir%20atendimento&modulosSelecionados=0&intencaoID=0\" target=\"_blank\" style=\"color: rgb(255, 101, 0); position: relative; display: inline-block; background: linear-gradient(90deg, rgb(255, 101, 0) 0%, rgb(255, 150, 50) 50%, rgb(255, 101, 0) 100%); background-size: 200% 100%; animation: fadeSlide 2s ease-in-out infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;\"><b>concluir este atendimento</b></a> para que o mesmo fique no status <b>\"Pendente - Domínio Sistemas\"</b>. Dessa forma, vocês poderão acompanhar a evolução da correção diretamente pelo sistema e serão notificados assim que a atualização com a solução estiver disponível.\n    \nSe surgir alguma dúvida sobre o atendimento ou sobre o andamento da correção, estamos aqui para ajudar!\n    \nConheça mais sobre como funciona a <img src=\"https://suporte.dominioatendimento.com/central/imagens/modulos/modulo_25.png\" style=\"width: 20px; height: 20px; vertical-align: middle;\"> <b><span style=\"color:#fa6400\">Área Técnica</span></b> do sistema Domínio, <a href=\"https://suporte.dominioatendimento.com/central/faces/solucao.html?codigo=8811&palavraChave=treinamento%20%C3%A1rea%20tecnica&modulosSelecionados=0&intencaoID=0\" target=\"_blank\" style=\"color: rgb(255, 101, 0); position: relative; display: inline-block; background: linear-gradient(90deg, rgb(255, 101, 0) 0%, rgb(255, 150, 50) 50%, rgb(255, 101, 0) 100%); background-size: 200% 100%; animation: fadeSlide 2s ease-in-out infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;\"><b>clique aqui</b></a>.<style>  @keyframes fadeSlide {    0% { background-position: 200% 0; }    100% { background-position: -200% 0; }  }  </style>\n\nDesejamos a todos uma ótima semana! <nobr style='font-size:19px;'>&#127775;</nobr> <nobr style='font-size:18px;'>&#128075;</nobr>"
          }
        },
        {
          "type": "action-closing",
          "title": "Encerramento - IA Suporte",
          "description": "Encerramento com informações sobre o suporte via IA.",
          "icon": "🤖",
          "closingData": {
            "title": "IA Suporte",
            "content": "<span style=\"color:#FF7F00;\">_______________________________________________________________________________</span>  \n A IA treinada com o melhor do conhecimento humano, pronta para resolver suas dúvidas na hora. \n  \n <nobr style='font-size:18px;'>&#128269;</nobr> Como acessar: \n  \n <b>No Domínio Contábil:</b> Clique no ícone <img src=\"https://www.dropbox.com/scl/fi/v3br46q5h440ybxqy41rd/baixados.png?rlkey=ox5zlti5ovpllfttaz9r4144v&st=trarz5yj&dl&raw=1\" width=\"24\" height=\"20\" border=\"0\" alt=\"iniciar\"> e tire suas dúvidas agora mesmo \n <b>Fora do Domínio Contábil:</b> Dentro das Solicitações de Suporte ao Cliente no Onvio, clique no botão <b>[<img src=\"https://www.dropbox.com/scl/fi/v3br46q5h440ybxqy41rd/baixados.png?rlkey=ox5zlti5ovpllfttaz9r4144v&st=trarz5yj&dl&raw=1\" width=\"24\" height=\"20\" border=\"0\" alt=\"iniciar\"> Suporte Chat]</b> — <a href=\"https://suporte.dominioatendimento.com/sgsc/faces/sscs.html\" target=\"_blank\">Clique aqui</a> \n  \n <nobr style='font-size:18px;'>&#128348;</nobr><b>Disponível 24h por dia, 7 dias por semana</b> — com especialista humano sempre disponível no horário comercial!Bom dia, <span data-variable=\"usuario\">Jefferson</span>! Tudo bem? Espero que sim! <nobr style='font-size:18px;'>&#128516;</nobr><!--Saudação--> \n [finalizacao]! <nobr style='font-size:18px;'>&#10024;</nobr>"
          }
        }
      ]
    },
    {
      "category": "Extensões & Apps",
      "items": [
        {
          "type": "link",
          "title": "Sider - Assistente de IA",
          "description": "Assistente de IA para ajudar com a escrita e melhorar a produtividade.",
          "url": "https://chromewebstore.google.com/detail/sider-chatgpt-sidebar-%2B-g/difoiogjjojoaoomphldepapgpbgkhkb",
          "icon": "🧩"
        },
        {
          "type": "link",
          "title": "LanguageTool - Corretor inteligente",
          "description": "Corretor gramatical e de estilo para melhorar a qualidade dos textos.",
          "url": "https://chromewebstore.google.com/detail/ai-grammar-checker-paraph/oldceeleldhonbafppcapldpdifcinji",
          "icon": "🧩"
        },
        {
          "type": "link",
          "title": "aText",
          "description": "Ferramenta de expansão de texto e automação.",
          "url": "https://www.trankynam.com/atext/",
          "icon": "🧩"
        },
        {
          "type": "link",
          "title": "Assistente Técnico",
          "description": "Automatize instalações e atualizações da Domínio Sistemas.",
          "url": "https://github.com/PatrickSud/assistente-tecnico/releases/latest/download/Assistente_Tecnico.exe",
          "icon": "🧩"
        },
        {
          "type": "link",
          "title": "Lightshot",
          "description": "Captura de tela rápida e fácil com ferramentas de edição integradas.",
          "url": "https://app.prntscr.com/build/setup-lightshot.exe",
          "icon": "🧩"
        }
      ]
    }
  ]
}

// URL Raw do Gist do GitHub (Obsoleto, migrado para Firebase RTDB)
const REMOTE_CONFIG_URL =
  'https://gist.githubusercontent.com/PatrickSud/a5c191a645d21494ac6f245a56dc32df/raw/forms-config.json'

const RTDB_FORMS_CONFIG_URL = '/permissions/forms_config.json'
const FORMS_CACHE_KEY = 'cachedFormsData'
const FORMS_CACHE_TIME_KEY = 'cachedFormsCacheTime'
const FORMS_CACHE_TTL = 30 * 60 * 1000 // 30 minutos em ms

/**
 * Busca dados de formulários, priorizando configuração remota no Firebase RTDB com fallback local e cache.
 * @param {boolean} forceRefresh - Se true, ignora o cache e busca do servidor
 * @returns {Promise<Object>} Dados de formulários
 */
async function fetchFormsData(forceRefresh = false) {
  try {
    if (!forceRefresh) {
      const stored = await chrome.storage.local.get([FORMS_CACHE_KEY, FORMS_CACHE_TIME_KEY])
      const cacheTime = stored[FORMS_CACHE_TIME_KEY] || 0
      const isValid = (Date.now() - cacheTime) < FORMS_CACHE_TTL

      if (isValid && stored[FORMS_CACHE_KEY] && typeof stored[FORMS_CACHE_KEY] === 'object') {
        console.log('📝 Forms Service: Usando dados em cache local')
        return stored[FORMS_CACHE_KEY]
      }
    }

    console.log('📝 Forms Service: Buscando dados remotos do Firebase RTDB...')
    
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'READ_PERMISSIONS_ACTION', path: RTDB_FORMS_CONFIG_URL },
        async (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Erro de comunicação com SW:', chrome.runtime.lastError)
            resolve(DEFAULT_FORMS_DATA)
            return
          }

          if (response && response.success) {
            let data = response.data
            
            // Se retornar null, o nó não existe no RTDB. Realiza o seed se o usuário for Master.
            if (!data) {
              console.log('📝 Forms Service: Nó de configuração não encontrado no RTDB. Usando DEFAULT_FORMS_DATA.')
              data = DEFAULT_FORMS_DATA
              
              if (window.sgdPermissions && window.sgdPermissions.isMaster) {
                console.log('📝 Forms Service: Usuário é Master. Seedando dados padrão no RTDB...')
                chrome.runtime.sendMessage({
                  action: 'WRITE_PERMISSIONS_ACTION',
                  path: RTDB_FORMS_CONFIG_URL,
                  method: 'PUT',
                  data: DEFAULT_FORMS_DATA
                }, (writeRes) => {
                  if (writeRes && writeRes.success) {
                    console.log('📝 Forms Service: Seed concluído com sucesso.')
                  } else {
                    console.warn('📝 Forms Service: Erro ao realizar o seed no RTDB.')
                  }
                })
              }
            }

            console.log('📝 Forms Service: Dados remotos carregados com sucesso')
            await chrome.storage.local.set({
              [FORMS_CACHE_KEY]: data,
              [FORMS_CACHE_TIME_KEY]: Date.now()
            })
            resolve(data)
          } else {
            console.warn('📝 Forms Service: Falhou ao buscar dados do RTDB:', response?.error)
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
