// ============================================================================
// NOTAS DE VERSÃO — GUIA DE ESTRUTURA (leia antes de editar este arquivo)
// ============================================================================
//
// Este arquivo controla o popup "O que há de novo" (showWhatsNewModal, em
// ui-components.js) e a lógica de disparo (checkVersionAndShowWhatsNew, em
// app.js). Existem DOIS objetos com finalidades diferentes:
//
// 1) RELEASE_NOTES  → NOTAS "OFICIAIS" (SEMPRE visíveis ao usuário)
//    - Chave = versão "notável", com APENAS 3 dígitos: 'X.Y.Z' (ex: '3.0.7').
//      NUNCA use aqui uma chave com 4 dígitos (ex: '3.0.7.1') — o código só
//      procura por versões de 3 dígitos (versionParts.slice(0, 3)), então uma
//      chave de 4 dígitos aqui NUNCA aciona o popup sozinha, mas ainda assim
//      aparece (incorretamente) na lista de "versões anteriores" do modal.
//    - Cada entrada é: { title: 'texto do cabeçalho', features: [...] }.
//    - O popup dispara quando os 3 primeiros dígitos da versão instalada
//      (manifest.json → version) mudam em relação à última versão "vista"
//      pelo usuário (lastSeenVersion, salva em storage).
//    - Sempre que subir uma versão "cheia" (X.Y.Z), crie aqui uma nova
//      entrada. Se essa versão só está consolidando hotfixes que já estavam
//      em MINOR_RELEASE_NOTES (ver abaixo), deixe features: [] e adicione
//      `consolidates: 'X.Y.Z_anterior'` — o merge automático do código
//      preenche o popup com o conteúdo desses hotfixes. Se a versão também
//      trouxer novidades próprias, escreva-as aqui em features.
//    - Campo opcional `consolidates`: aponta explicitamente qual chave de
//      MINOR_RELEASE_NOTES deve ser mesclada no popup desta versão. É o
//      "porto seguro": o código tenta primeiro usar os hotfixes da versão
//      que o usuário realmente viu (lastSeenVersion), mas se o usuário
//      estiver com o storage limpo, instalação nova, ou tiver "pulado"
//      versões, cai para este campo — assim o popup NUNCA fica vazio por
//      causa do histórico pessoal de quem está atualizando.
//
// 2) MINOR_RELEASE_NOTES → NOTAS INTERNAS DE HOTFIX (NUNCA exibidas isoladamente)
//    - Use para versões de 4 dígitos (X.Y.Z.W), ou seja, hotfixes/patches
//      que saem entre uma versão "notável" e a próxima e que NÃO merecem
//      (ou não devem, por serem pequenos demais) gerar um popup próprio.
//    - Chave = a versão "notável" ANTERIOR (3 dígitos) à qual os hotfixes
//      pertencem — ex: hotfixes 3.0.6.1, 3.0.6.2, 3.0.6.3 e 3.0.6.4 ficam
//      todos sob a chave '3.0.6', não sob suas próprias versões.
//    - Valor = array de { version: 'X.Y.Z.W', features: [...] }, um item por
//      hotfix, na ordem em que forem lançados.
//    - Esse conteúdo é mesclado automaticamente pelo código em DOIS lugares:
//        a) no popup da PRÓXIMA versão notável (X.Y.(Z+1) ou X.(Y+1).0), que
//           concatena essas features às da nova versão quando o usuário
//           atualiza direto do hotfix mais recente;
//        b) na seção "versões anteriores" do próprio modal, aninhado sob o
//           bloco da versão notável correspondente (ex: sob '3.0.6').
//
// RESUMO PRÁTICO:
//   - Lançou um hotfix pequeno (X.Y.Z.W)?      → MINOR_RELEASE_NOTES['X.Y.Z']
//   - Lançou uma versão nova e "notável" (X.Y.Z)? → RELEASE_NOTES['X.Y.Z']
//   - JAMAIS crie em RELEASE_NOTES uma chave com 4 dígitos.
//
// OCULTANDO UM ITEM ESPECÍFICO DO POPUP
//   Qualquer item dentro de um array "features" (em RELEASE_NOTES ou em
//   MINOR_RELEASE_NOTES) pode ser escrito de duas formas:
//     - string simples            → sempre aparece no popup e no histórico.
//     - { text: '...', hidden: true } → fica documentado aqui no código,
//       mas NÃO é exibido nem no popup "O que há de novo" nem no histórico
//       de versões anteriores. Útil para itens técnicos/internos que não
//       precisam ser comunicados ao usuário final.
//   Exemplo:
//     features: [
//       'Item normal, sempre visível',
//       { text: 'Item interno, não deve aparecer ao usuário', hidden: true }
//     ]
// ============================================================================

/**
 * Filtra e normaliza uma lista de features, removendo os itens marcados
 * como { hidden: true } e convertendo objetos { text, hidden } em texto puro.
 * Usada por showWhatsNewModal (ui-components.js) ao montar o popup e o
 * histórico de versões anteriores.
 * @param {Array<string|{text: string, hidden?: boolean}>} features
 * @returns {string[]}
 */
function getVisibleFeatures(features) {
  return (features || [])
    .filter(f => !(f && typeof f === 'object' && f.hidden))
    .map(f => (f && typeof f === 'object' ? f.text : f))
}

/**
 * Monta o objeto de notas pronto para showWhatsNewModal, para uma versão
 * notável (X.Y.Z), já mesclando os hotfixes acumulados em
 * MINOR_RELEASE_NOTES quando aplicável (ver `consolidates` no topo do arquivo).
 *
 * IMPORTANTE: esta é a ÚNICA função que deve montar as notas de uma versão.
 * Qualquer lugar do código que precise exibir "o que há de novo" (popup
 * automático em app.js, botão manual em quick-messages.js, etc.) deve
 * chamar esta função em vez de ler RELEASE_NOTES[versão] diretamente —
 * senão o merge com os hotfixes não acontece e o popup aparece vazio.
 *
 * @param {string} noteworthyVersion - Versão notável (3 dígitos) a exibir.
 * @param {string|null} [lastSeenVersion] - Última versão vista pelo usuário (opcional).
 * @returns {{title: string, features: Array}|null} Notas prontas, ou null se a versão não existir em RELEASE_NOTES.
 */
function buildNotesToShow(noteworthyVersion, lastSeenVersion) {
  if (typeof RELEASE_NOTES === 'undefined' || !RELEASE_NOTES[noteworthyVersion]) {
    return null
  }

  let notesToShow = RELEASE_NOTES[noteworthyVersion]
  const minorKey =
    typeof MINOR_RELEASE_NOTES !== 'undefined' && MINOR_RELEASE_NOTES[lastSeenVersion]
      ? lastSeenVersion
      : notesToShow.consolidates

  if (typeof MINOR_RELEASE_NOTES !== 'undefined' && MINOR_RELEASE_NOTES[minorKey]) {
    const minorFeatures = MINOR_RELEASE_NOTES[minorKey].reduce(
      (acc, item) => acc.concat(item.features || []),
      []
    )
    notesToShow = {
      ...notesToShow,
      features: [...notesToShow.features, ...minorFeatures]
    }
  }

  return notesToShow
}

const RELEASE_NOTES = {
  '3.0.8': {
    title: '🚀 Consolidação e Novidades da Versão 3.0.8',
    features: [
      '<b>🚨 Pendências & Alertas:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Alerta de Pendências (novo):</b> Widget lateral opcional na borda direita que lista suas SSCs por faixa de tempo — o marcador pisca quando uma pendência cruza o prazo. Ative na guia Pendências › botão "Alerta".</li>' +
      '<li><b>Guia Pendências reformulada:</b> Passa a mostrar suas SSCs pendentes direto da lista de Solicitações do SGD, com o tempo desde o último trâmite calculado em horas úteis (desconsiderando fins de semana e feriados).</li>' +
      '<li><b>Responsável monitorado:</b> Novo seletor para escolher de qual responsável ver as pendências — útil para líderes e gestores que acompanham vários usuários.</li>' +
      '<li><b>Notificações mais estáveis:</b> Corrigido bug que impedia o toast de novas pendências de aparecer, e a pílula de aviso no FAB agora expande e recolhe sozinha mostrando a descrição completa.</li>' +
      '</ul>',

      '<b>💬 Resumir Solicitação com IA:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>O resumo gerado pela IA agora também lê o log do chat e a transcrição da ligação, trazendo mais contexto.</li>' +
      '<li>Imagens e arquivos enviados pelo cliente no chat aparecem automaticamente na seção "Anexos" do resumo, com link direto pra abrir.</li>' +
      '<li>A seção "Dados de Acesso" passa a identificar credenciais (e-mail, senha, código) informadas pelo cliente durante o chat, mesmo quando pergunta e resposta estão em mensagens separadas.</li>' +
      '</ul>',

      '<b>🌐 Central de Links (novo):</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Novo painel no FAB com um repositório colaborativo de links de suporte por canal — guias Comunidade, Pessoal e Pendências, com curtidas, busca e agrupamento por tipo (SS/SSC/SA/NE).</li>' +
      '</ul>',

      '<b>🔍 Verificação de Duplicidade:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Novas opções em Configurações > Preferências para usar (ou não) Inteligência Artificial e/ou o Fallback por palavras-chave, com um atalho rápido (⚙️) direto no widget de aviso.</li>' +
      '</ul>',

      '<b>💬 Visualizador de Chat (novo):</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Botão "Visualizar Chat" nos anexos .txt do atendimento: abre a conversa formatada, com abas de Arquivos e Transcrição, busca, imagens em tela cheia e resumo com IA.</li>' +
      '<li>Baseado na ideia original de Ruan Fiori Marcelino.</li>' +
      '</ul>'
    ],
    consolidates: '3.0.7'
  },
  '3.0.7': {
    title: '🚀 Consolidação e Ajustes da Versão 3.0.7',
    features: [],
    consolidates: '3.0.6'
  },
  '3.0.6': {
    title: '🚀 Consolidação e Novidades da Versão 3.0.6',
    features: [
      '<b>🤖 Recursos de IA & Sugestores:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Sugestor de SAM:</b> Nova ferramenta para gerar sugestão estruturada de SAM de forma automática via IA.</li>' +
      '<li><b>Menu de IA:</b> Botões unificados em um menu suspenso com suporte a fixação (PIN) individual.</li>' +
      '<li><b>Sugestor de SS:</b> Estabilizações na coleta de trâmite confidencial e envio para a API da Thomson Reuters.</li>' +
      '</ul>',

      '<b>📢 Painel de Avisos & Comunicados (Master):</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Editor WYSIWYG:</b> Novo editor visual integrado para formatação rica de comunicados.</li>' +
      '<li><b>Leitura Obrigatória:</b> Modal de leitura obrigatória para avisos críticos com temporizador de 10 segundos.</li>' +
      '<li><b>Controle Avançado:</b> Suporte a agendamento, expiração em 7 dias, arquivamento manual e auditoria.</li>' +
      '</ul>',

      '<b>👥 Equipe AT & Presença:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Ordem de Pausa:</b> Controle visual dinâmico com cores em tempo real do status de pausa dos técnicos.</li>' +
      '<li><b>Visualização Compacta:</b> Cards de equipe otimizados omitindo rótulos desnecessários e mantendo a ordenação.</li>' +
      '</ul>',

      '<b>🪟 Interface & Usabilidade:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>IAplug em Janela Dedicada:</b> O assistente Tria agora abre em janela popup estilo App (lembra tamanho e posição).</li>' +
      '<li><b>Responsividade dos Botões:</b> Ocultação automática de botões flutuantes (FAB, IAplug) em telas muito pequenas (menores que 680×450px).</li>' +
      '<li><b>Drag & Drop no FAB:</b> Reordenação visual por clique e arraste dos atalhos do menu flutuante.</li>' +
      '<li><b>Verificador Otimizado:</b> Checagem de SSCs duplicadas feita em segundo plano com restauração automática de filtros.</li>' +
      '</ul>'
    ]
  },
  '3.0.5': {
    title: '🚀 Consolidação e Novidades da Versão 3.0.5',
    features: [
      '<b>🤖 Recursos de IA & Sugestores:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Sugestor de SAM:</b> Nova ferramenta para gerar sugestão estruturada de SAM de forma automática via IA.</li>' +
      '<li><b>Menu de IA:</b> Botões unificados em um menu suspenso com suporte a fixação (PIN) individual.</li>' +
      '<li><b>Sugestor de SS:</b> Estabilizações na coleta de trâmite confidencial e envio para a API da Thomson Reuters.</li>' +
      '</ul>',

      '<b>📢 Painel de Avisos & Comunicados (Master):</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Editor WYSIWYG:</b> Novo editor visual integrado para formatação rica de comunicados.</li>' +
      '<li><b>Leitura Obrigatória:</b> Modal de leitura obrigatória para avisos críticos com temporizador de 10 segundos.</li>' +
      '<li><b>Controle Avançado:</b> Suporte a agendamento, expiração em 7 dias, arquivamento manual e auditoria.</li>' +
      '</ul>',

      '<b>👥 Equipe AT & Presença:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Ordem de Pausa:</b> Controle visual dinâmico com cores em tempo real do status de pausa dos técnicos.</li>' +
      '<li><b>Visualização Compacta:</b> Cards de equipe otimizados omitindo rótulos desnecessários e mantendo a ordenação.</li>' +
      '</ul>',

      '<b>🪟 Interface & Usabilidade:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>IAplug em Janela Dedicada:</b> O assistente Tria agora abre em janela popup estilo App (lembra tamanho e posição).</li>' +
      '<li><b>Responsividade dos Botões:</b> Ocultação automática de botões flutuantes (FAB, IAplug) em telas muito pequenas (menores que 680×450px).</li>' +
      '<li><b>Drag & Drop no FAB:</b> Reordenação visual por clique e arraste dos atalhos do menu flutuante.</li>' +
      '<li><b>Verificador Otimizado:</b> Checagem de SSCs duplicadas feita em segundo plano com restauração automática de filtros.</li>' +
      '</ul>'
    ]
  },
  '3.0.4': {
    title: '👁️ Melhorias no Preview — Versão 3.0.4',
    features: [
      '<b>🔄 Ocultação Inteligente do Preview do SGD:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Agora, ao clicar em <b>Mostrar Visualização</b> no editor da extensão, a pré-visualização nativa do SGD é automaticamente ocultada para evitar redundância.</li>' +
      '<li>Ao fechar/ocultar a visualização da extensão, o preview nativo do SGD é exibido novamente de forma automática.</li>' +
      '</ul>',

      '<b>⚙️ Nova Preferência:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      "<li>Nova opção de configuração <i><b>Ocultar o campo 'Pré-visualizar:' nativo do SGD</b></i> (desabilitada por padrão).</li>" +
      '<li>Quando ativada pelo usuário, a pré-visualização do SGD permanecerá oculta mesmo que a visualização da extensão esteja fechada.</li>' +
      '</ul>',

      '<b>🚨 Central de Informações SGD</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li> <b>Instabilidades:</b> Adicionados novos sistemas à lista de monitoramento de instabilidades: <b>Processos</b>, <b>Messenger</b>, <b>FGTS</b> e <b>DCTFWeb</b>.</li>' +
      '<li> <b>Modo Dev:</b> O interruptor do <b>Modo Dev</b> agora fica permanentemente visível no rodapé e requer autenticação com senha para ativação.</li>' +
      '</ul>',

      '<b>🔧 Correções e Melhorias:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Quando a fila do atendimento não é identificada automaticamente, a IA agora realiza uma <b>melhoria genérica do texto</b> em vez de exibir erro — garantindo que o técnico sempre receba uma resposta útil.</li>' +
      '<li>Corrigido o funcionamento de chains específicas das filas de <b>ECD/ECF</b> e demais filas que não estavam respondendo corretamente.</li>' +
      '<li>Corrigido problema onde o usuário "Não Informado" preenchia incorretamente a saudação como "Bom dia Não!".</li>' +
      '</ul>'
    ]
  },
  '3.0.3': {
    title: '🤖 Novidades — Versão 3.0.3',
    features: [
      '<b>🪄 Melhorar Texto com IA:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>O botão <b>Melhorar Texto</b> agora utiliza inteligência artificial das Thomson Reuters (Chains das filas) para completar e aprimorar o rascunho do técnico automaticamente.</li>' +
      '<li>A IA identifica automaticamente a fila do atendimento e direciona para a chain especializada correta, sem necessidade de seleção manual.</li>' +
      '<li>Atendimentos classificados como <b>Performance</b> são direcionados diretamente para a chain especializada, sem passar pela etapa de roteamento.</li>' +
      '</ul>',

      '<b>📄 Resumir Solicitação com IA:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Novo botão <b>Resumir Solicitação</b> analisa todo o histórico do atendimento e gera automaticamente um resumo estruturado com: Resumo do Problema, Fatos Relevantes e Próxima Ação Sugerida.</li>' +
      '<li>Assim como o Melhorar Texto, o roteamento para a chain correta acontece de forma automática com base no conteúdo do atendimento.</li>' +
      '<li>Para atendimentos de <b>Performance</b>, a análise é inserida diretamente no campo de descrição, sem abrir o modal.</li>' +
      '</ul>',

      '<p style="margin-top: 8px; padding: 8px 12px; background: rgba(250, 100, 0, 0.1); border-left: 3px solid #fa6400; border-radius: 4px; font-size: 12px; max-width: 100%;">⚡ Estas funcionalidades utilizam as chains internas da Thomson Reuters, é necessário estar autenticado na plataforma de IA para utilizá-las.</p>'
    ]
  },
  '3.0.2': {
    title: '🐛 Correções de Bugs — Versão 3.0.2',
    features: [
      '<b>📄 Leitura de chats e transcrições corrigida:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Corrigido problema onde chats longos não eram lidos corretamente devido ao tamanho do conteúdo. Agora tanto chats quanto transcrições são processados de forma completa e confiável.</li>' +
      '</ul>',

      '<b>🤖 Sugestor de SS — Coleta de trâmite confidencial:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>O Sugestor de SS agora coleta corretamente as informações do trâmite confidencial, garantindo que o contexto completo do atendimento seja enviado para a IA.</li>' +
      '</ul>',

      '<b>📋 Botão de validação com liderança:</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Adicionado botão dentro da sugestão de SS para copiar e enviar a sugestão ao líder antes de abrir o chamado — especialmente útil para analistas em período de aprendizado.</li>' +
      '</ul>',

      '<small>⚡ Em breve lançamos uma versão com novidades. Esta versão foi liberada antecipadamente para corrigir problemas que estavam impactando o uso.</small>'
    ]
  },
  '3.0.1': {
    title: '✨ Novidades da Versão 3.0.1',
    features: [
      '<b>🤖 Sugestor de SS integrado ao Editor</b>' +
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li>Plugin que lê uma SSC no SGD, envia o conteúdo para uma chain de IA e preenche automaticamente o formulário de cadastro de SS — eliminando trabalho manual repetitivo.</li>' +
      '<li>O botão <b>✨ Sugerir SS</b> agora aparece diretamente na <b>toolbar do editor</b>, disponível apenas nas páginas de SSC.</li>' +
      '<li>Abaixo deixo um site sobre o manual de uso da nova funcionalidade.</li>' +
      '<li><a href="https://sugestorss.netlify.app" target="_blank" style="color:#1565c0;">📖 Manual de uso</a></li>' +
      '</ul>'
    ]
  },
  '3.0.0': {
    title: '🚀 Lançamento Oficial 3.0.0',
    features: [
      '<b>🧭 Central de Informações SGD & Produtividade</b>',
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Central de Informações SGD:</b> consolidação das abas e fluxos, incluindo <i>AI Chains</i> para assistentes inteligentes.</li>' +
      '<li><b>Tags e Filtros:</b> gestão de TAGS, filtro por tags e <i>filtro por responsável</i> com persistência automática da escolha.</li>' +
      '<li><b>SLA Inteligente:</b> cálculo por dias úteis, diferenciação entre tempo online (preciso) e offline (estimado), tooltip em <b>HH:MM</b> e exibição <b>~ XD</b> para estimados.</li>' +
      '<li><b>Cronômetro no FAB:</b> ferramenta integrada com Pause/Reset/Edição, fixação individual (Pin) e persistência de estado.</li>' +
      '<li><b>Layout & UX:</b> cards de pendência aprimorados e otimizações gerais de desempenho.</li>' +
      '</ul>',
      '<b>👥 Monitoramento & Equipe AT</b>',
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Monitor de Instabilidades:</b> acompanhamento em tempo real com histórico transparente, modelos inteligentes e hiperlinks nas orientações.</li>' +
      '<li><b>Avisos Aprimorados:</b> identidade visual por tipo, ocultar avisos lidos, expiração automática em 7 dias e criação mais ágil.</li>' +
      '<li><b>Publicação Automática:</b> geração de avisos ao alterar status de sistemas com títulos descritivos e autoria automática.</li>' +
      '<li><b>Notificações Inteligentes:</b> monitor de segundo plano respeita o filtro de responsável e permite monitoramento flexível de toda a equipe.</li>' +
      '<li><b>Detecção de Filtros:</b> alerta detalhado de filtros ativos e ocultação do seletor de responsável quando não necessário.</li>' +
      '</ul>',
      '<b>⚙️ Automações</b>',
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>Detecção & Limpeza de Filtros:</b> integração com filtros do SGD para carregar todas as pendências com um clique.</li>' +
      '<li><b>Abertura Automática de Anotações:</b> notas rápidas vinculadas a links abrem automaticamente ao acessar páginas relacionadas.</li>' +
      '<li><b>Encerramentos:</b> ajustes em mensagens automáticas ao anexar SS duplicada para uma comunicação mais clara.</li>' +
      '<li><b>Navegação & Notificações:</b> cliques mais flexíveis nas notificações e seleção confiável da aba de pendências via links.</li>' +
      '</ul>'
    ]
  },
  '2.9.9': {
    title: '✨ Novidades da Versão 2.9.9',
    features: [
      '<b>🚀 Central de Informações SGD (Em Desenvolvimento):</b>',
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
      '<li><b>🤖 Nova Aba AI Chains:</b> Assistentes inteligentes e fluxos agora têm sua própria seção dedicada.</li>' +
      '<li><b>🏷️ Gestão de TAGS:</b> Classifique pendências com Tags coloridas (<i>Em SS</i>, <i>Em SA/NE</i>, <i>Prioridade</i> e personalizadas).</li>' +
      '<li><b>🔍 Filtro por Tags:</b> Visualize rapida\mente chamados por categoria na lista de pendências.</li>' +
      '<li><b>🔔 Controle de Notificações:</b> Ative/desative alertas visuais na tela (verificação continua em background).</li>' +
      '</ul>'
    ]
  },
  '2.9.8': {
    title: '✨ Novidades da Versão 2.9.8',
    features: [
      '<b>ℹ️ NOVO: Painel Central de Informações SGD</b> - Acesse através do ícone ℹ️ na barra de flutuante de Acesso Rápido "+". <br><small>⚠️ Em Desenvolvimento: Esta funcionalidade ainda está sendo aprimorada e pode apresentar comportamentos inesperados.</small>',
      '<b>📝 Formulários & Documentos:</b> Nova aba com dados gerenciados remotamente via GitHub Gist para atualizações instantâneas.',
      '<b>🔄 <u>Novo Encerramento Padrão:</u></b> Adicionado o encerramento "<b>Acesso Remoto</b>", disponível para todos os usuários, essa nova assinatura auxilia o cliente a utilizar o Calling Card para Acesso remoto.',
      '<b>🎯 Filtros Avançados:</b> Sistema de filtros em tempo real para pendências com busca por número, assunto e descrição.',
      '<b>🐛 Correções de Erros</b> e otimizado desempenho do Painel "<b>Central de Informações SGD."</b>',
      '<b>🎨 Interface Aprimorada:</b> Novos estilos CSS para cards de formulários com efeitos hover e design consistente.'
    ]
  },
  '2.9.7': {
    title: '✨ Novidades da Versão 2.9.7',
    features: [
      '<b>Reorganização de 🔃 Importar/Exportar:</b> A funcionalidade de Importar/Exportar foi movida das Configurações para o <b>Painel de Trâmites</b>, facilitando o acesso.',
      '<b>Nova Interface de Importação:</b> O modal de importação/exportação foi redesenhado para uma melhor experiência, com visualização clara dos itens.',
      '<b>Melhorias de Estabilidade:</b> Ajustes internos para garantir maior fluidez e correção de pequenos bugs.'
    ]
  },
  '2.9.6': {
    title: '✨ Novidades da Versão 2.9.6',
    features: [
      '<b>✨ O que há de novo?</b> <br>Agora você verá esta janela sempre que a extensão for atualizada com novidades.',
      '<b>Editor Básico:</b> Nova barra de ferramentas simplificada implementada no SGD, com suporte a atalhos de teclado para melhor usabilidade em qualquer área de texto.',
      '<b>Arraste e Solte para Saudações/Encerramentos:</b> Implementada funcionalidade de arrastar e soltar para reordenar saudações e encerramentos no editor.',
      '<b>📸 Modal de Redimensionamento de Imagem com Slider:</b> Implementado um novo modal de redimensionamento de imagem com slider, substituindo as opções de tamanho fixo.',
      "<b>Novo Emoji e melhoria:</b> Adicionado novo emoji '⌛' ao seletor de emojis e corrigido o emoji de alerta '⚠️'.",
      '<b>Atualização de Visuals e Feedback de Drag-and-Drop:</b> Melhorias visuais para listas de <b>saudações/encerramentos</b> durante operações de <b>arrastar e soltar</b>.',
      '<b>⚡ Edição inline de categorias nos Trâmites Rápidos:</b> Permite editar, diretamente na toolbar dos <b>Trâmites Rápidos</b>, o nome das categorias.',
      '<b>Menus Flutuantes Configuráveis:</b> Adicionada configuração de comportamento para menus flutuantes, permitindo alternar entre abertura por <i><b>hover</b></i> ou <i><b>clique</b></i>. (Localizado em <u><b>Configurações</b></u> > <u><b>Preferências</b></u>)',
      '<b>Nova Categoria pré-preenchida:</b> Ao adicionar uma nova categoria, o campo passa a ser pré-preenchido com a categoria atualmente selecionada.',
      '<b>🏷️ Usuário não cadastrado:</b> Ao informar "Usuário Não cadastrado", o campo <i><b>Nome do usuário</b></i> passa a ser preenchido automaticamente com o nome digitado.',
      '<b>Filtro e Validação de Selects de Situação:</b> Aprimoramentos na validação automática de selects, impedindo ações quando valores inadequados são selecionados (ex.: <i><b>"Em análise"</b></i>), e melhoria da lógica de auto-preenchimento.',
      '<b>Correção em atalhos de teclado:</b> Corrigido o bug ao definir atalhos, garantindo funcionamento consistente.',
      '<b>🔍 Pesquisar Resposta:</b> Adicionado botão para pesquisar respostas diretamente, agilizando a busca.',
      '<b>Outros ajustes:</b> Correções de bugs e melhorias de interface para uma experiência mais fluida.'
    ]
  }
}

// Hotfixes/patches (4 dígitos) agrupados pela versão notável anterior (3 dígitos).
// NÃO exibidos isoladamente — ver guia completo no topo do arquivo.
const MINOR_RELEASE_NOTES = {
  '3.0.8': [
    {
      version: '3.0.8.1',
      features: [
        '<b>💬 Visualizador de Chat:</b> novo botão nos anexos de conversa (.txt) que abre o atendimento formatado — com Arquivos, Transcrição, busca, visualização de imagens e resumo com IA.',
        '<b>📞 Transcrição da ligação:</b> botão "Visualizar" ao lado do campo Transcrição abre a conversa telefônica formatada, com busca.'
      ]
    }
  ],
  '3.0.7': [
    {
      version: '3.0.7.2',
      features: [
        // Conteúdo agora resumido em RELEASE_NOTES['3.0.8'] (grupo "Ajustes de Interface").
        { text: '<b>⚠️ Widget de SSCs Parecidas:</b> Agora é possível expandir/recolher clicando em qualquer ponto da barra vermelha de aviso, não apenas no botão "▾".', hidden: true },
        { text: '<b>🔍 Pesquisar Resposta:</b> Botão reposicionado para ficar ao lado esquerdo do botão "Gravar" (ou "Visualizar", quando aplicável) na toolbar.', hidden: true },
        { text: '<b>⚡ Botão "Continuar":</b> Passa a ser ocultado automaticamente da toolbar quando o botão nativo "Gravar e Continuar" está desabilitado (ex: ao habilitar "Cadastro com IA").', hidden: true }
      ]
    },
    {
      version: '3.0.7.3',
      features: [
        // Conteúdo agora resumido em RELEASE_NOTES['3.0.8'] (grupo "Pendências & Alertas").
        { text: '<b>🔔 Correção de Notificações:</b> Corrigido o bug que impedia a exibição das notificações Toast de novas pendências na tela.', hidden: true },
        // Puramente técnico/backend (sem impacto visível pro usuário) — nunca deve aparecer no popup.
        { text: '<b>⚡ Otimização de Consumo (Firestore):</b> Intervalo do monitor de equipe alterado para 15 minutos e implementação de cache inteligente de 5 minutos nas abas de Instabilidade e Equipe para evitar erros 429.', hidden: true }
      ]
    },
    {
      version: '3.0.7.4',
      features: [
        // Conteúdo agora resumido em RELEASE_NOTES['3.0.8'] (grupos "Pendências & Alertas", "Verificação de Duplicidade" e "Central de Links").
        { text: '<b>🔔 Notificação de Pendências Redesenhada:</b> A pílula de pendências novas no FAB agora expande brevemente mostrando a descrição completa (ex: "4 pendências (1 nova)") e recolhe sozinha — passe o mouse sobre ela a qualquer momento para conferir. Habilitada por padrão, repete o lembrete a cada 1h enquanto não for vista, e não exibe mais o toast no canto superior direito.', hidden: true },
        { text: '<b>🔍 Verificação de Duplicidade Configurável:</b> Novas opções em Configurações > Preferências para usar (ou não) Inteligência Artificial e/ou o Fallback por palavras-chave na Verificação de Duplicidade, com um atalho rápido (⚙️) direto no widget de aviso.', hidden: true },
        { text: '<b>🌐 Central de Links:</b> Novo painel no FAB (🌐) com um repositório colaborativo de links de suporte por canal — guias Comunidade, Pessoal e Pendências, com curtidas, salvamento, busca e agrupamento por tipo (SS/SSC/SA/NE).', hidden: true }
      ]
    },
    {
      version: '3.0.7.5',
      features: [
        { text: '<b>🤖 IAplug - Novo link AT:</b> Adicionado um terceiro link regional (AT) em Central de Informações > Controle de Acesso > 🤖 IAplug, ao lado dos já existentes Sul e Sudeste.', hidden: true },
        { text: '<b>🔗 Gerenciar Links do IAplug:</b> Novo modal (botão "🔗 Gerenciar Links" dentro de "Configurar IAplug por Unidades") para editar o link de cada equipe, migrar as unidades de um link para outro, inativar/reativar links e criar novos links além dos 3 fixos.', hidden: true }
      ]
    },
    {
      version: '3.0.7.6',
      features: [
        // Conteúdo agora resumido em RELEASE_NOTES['3.0.8'] (grupo "Pendências & Alertas").
        { text: '<b>📋 Pendências reformuladas:</b> A guia Pendências agora mostra as suas SSCs pendentes (aquelas em que você é o responsável), capturadas diretamente da lista de Solicitações do SGD. O tempo desde o último trâmite passou a ser calculado em horas úteis, desconsiderando fins de semana e feriados.', hidden: true },
        { text: '<b>👤 Responsável monitorado:</b> Novo seletor no topo da guia Pendências para escolher de qual responsável ver as pendências — útil para líderes e gestores que enxergam vários usuários. A escolha fica salva e evita a limitação de 1.000 registros da primeira página.', hidden: true },
        { text: '<b>🛡️ Mais estável:</b> As buscas de pendências passaram a ser coordenadas entre as abas do SGD, evitando requisições simultâneas na mesma sessão (que faziam a página vir em branco).', hidden: true },
        { text: '<b>🐞 Debug de pendências:</b> Logs [PENDING] (via sgdDebug.ativar() no console) para diagnosticar filtros, responsável usado, contagem de linhas e coalescing.', hidden: true }
      ]
    },
    {
      version: '3.0.7.7',
      features: [
        // Conteúdo agora resumido em RELEASE_NOTES['3.0.8'] (grupo "Pendências & Alertas").
        { text: '<b>🚨 Alerta de Pendências (novo):</b> Widget lateral opcional que fica na borda direita e, ao clicar, lista suas SSCs por faixa de tempo — o marcador pisca quando uma pendência cruza o prazo. Ative na guia Pendências › botão "Alerta" e ajuste faixa de alerta, som, N2 e mais na engrenagem.', hidden: true },
        { text: '<b>📋 Pendências (ajuste):</b> Removido o filtro de responsável duplicado ("Todos os Responsáveis") da guia Pendências; a seleção de responsável passa a ser feita apenas pelo seletor "Responsável monitorado", evitando confusão (especialmente para líderes/gestores).', hidden: true }
      ]
    },
    {
      version: '3.0.7.8',
      features: [
        // Conteúdo agora resumido em RELEASE_NOTES['3.0.8'] (grupo "IA no Resumo de Solicitação").
        { text: '<b>💬 Resumir Solicitação lê o Chat:</b> Ao resumir uma SSC, a IA agora também lê o log do chat e a transcrição da ligação (quando disponíveis), trazendo mais contexto pro resumo gerado.', hidden: true },
        { text: '<b>📎 Anexos do Chat no Resumo:</b> Imagens e arquivos enviados pelo cliente durante o chat agora aparecem automaticamente na seção "Anexos" do modal de resumo, com link direto pra abrir.', hidden: true },
        { text: '<b>🔐 Dados de Acesso mais completos:</b> A seção "Dados de Acesso" do resumo agora também identifica credenciais (e-mail, senha, código) informadas pelo cliente durante o chat, mesmo quando pergunta e resposta estão em mensagens separadas.', hidden: true }
      ]
    }
  ],
  '3.0.6': [
    {
      version: '3.0.6.1',
      features: [
        { text: '<b>🤖 Verificação de Duplicidade:</b> Removido o alerta (toast) de "IA indisponível" ao usuário, mantendo a informação apenas no console.', hidden: true },
        { text: '<b>📢 Painel de Avisos:</b> Corrigido o bug ao colar/editar links com tags aninhadas ou comentários do clipboard, com suporte a Ctrl+Clique e tooltip explicativo.', hidden: true }
      ]
    },
    {
      version: '3.0.6.2',
      features: [
        { text: '<b>🤖 Verificação de Duplicidade:</b> Otimizado o período de busca para 60 dias, adicionado cache local de 10 minutos por cliente, desconsideração de termos genéricos (stop-words) na comparação e interrupção precoce na leitura da tabela.', hidden: true },
        { text: '<b>⚙️ Console de Debug:</b> Ocultado o hash do ViewState e mensagens verbosas do console, com a inclusão de um relatório estruturado de candidatos quando o modo de depuração estiver ativo.', hidden: true }
      ]
    },
    {
      version: '3.0.6.3',
      features: [
        '<b>🤖 Sugerir SAM:</b> Corrigido bug que travava a busca de SAMs similares sem resposta, com aumento do tempo máximo de espera para 3 minutos.'
      ]
    },
    {
      version: '3.0.6.4',
      features: [
        '<b>⚡ Trâmites Padrões:</b> Novos botões <b>"Salvar e Continuar"</b> e <b>"Importar"</b> no modal de Adicionar Trâmite, além de suporte a <b>arrastar (drag-and-drop)</b> um arquivo .json de backup direto sobre o editor para importar.',
        '<b>📤 Trâmites Rápidos:</b> Novo botão <b>"Exportar"</b> ao lado de "+ Adicionar" na toolbar, com modal dedicado e correção do checkbox de categoria ao selecionar trâmites individuais.',
        { text: '<b>🤖 Verificação de Duplicidade:</b> Novo botão <b>"Verificar duplicidade"</b> na tela de cadastro de SSC, com checkbox de verificação automática (dispara 7s após parar de digitar o assunto, com contagem regressiva visual).', hidden: true },
        '<b>🔠 Auto-capitalização de Texto:</b> Nova preferência (ativada por padrão) que capitaliza automaticamente a primeira letra de frases ao digitar nos campos de texto. Configurável em Configurações → Auto-capitalização de Texto.'
      ]
    }
  ],
  '2.9.9': [
    {
      version: '2.9.9.2',
      features: [
        '<b>📝 Ajuste na mensagem de anexo de SS:</b> Alterado o encerramento padrão de "<b>Obrigado.</b>" para "<b>Seguimos à disposição!</b>" na mensagem automática ao anexar Solicitação de Suporte duplicada.',
        '<b>🐛 Correção de notificações:</b> Corrigido problema onde notificações de "Novas Pendências no SGD" apareciam duplicadas quando havia múltiplas abas abertas.',
        '<b>🧩 Seção Extensões & Apps liberada:</b> A seção "<b>Extensões & Apps</b>" do Painel agora está disponível para todos os usuários terem acesso a ferramentas úteis para produtividade.'
      ]
    },
    {
      version: '2.9.9.3',
      features: [
        '<b>🔗 Integração com Filtros de Pendências:</b> O painel agora detecta filtros ativos no SGD (Responsável, Sistema, etc.) e permite limpá-los com um clique para carregar todas as pendências corretamente.',
        '<b>👤 Filtro de Responsável:</b> Adicionado novo filtro na aba de Pendências para visualizar chamados agrupados por responsável (útil para quem visualiza mais de um responsável).',
        '<b>✨ Tags Automáticas:</b> Melhorada detecção de <b>Prioridade</b> e <b>Em SS</b>, com atribuição automática de tags.',
        '<b>🎨 Layout aprimorado:</b> Ajuste na exibição de datas e nomes nos cards de pendência para melhor aproveitamento de espaço.'
      ]
    },
    {
      version: '2.9.9.4',
      features: [
        '<b>🔍 Detecção Inteligente de Filtros:</b> O alerta de filtros ativos no SGD agora mostra exatamente o que está filtrado (ex: Sistema, Responsável, Situação).',
        '<b>🧠 Notificações Inteligentes:</b> O alerta de filtro de responsável é automaticamente ocultado caso você só tenha permissão para visualizar suas próprias pendências.',
        '<b>🪄 Interface Fluida:</b> O seletor de "Responsável" no Painel agora se oculta automaticamente quando não houver necessidade de filtragem (apenas um responsável na lista).'
      ]
    },
    {
      version: '2.9.9.5',
      features: [
        '<b>🚨 Monitor de Instabilidades:</b> Lançamento oficial da aba para acompanhamento do status dos sistemas em tempo real.',
        '<b>✏️ Gestão de Status Aprimorada:</b> Interface de edição redesenhada com maior espaço lateral (700px) e foco no conteúdo.',
        '<b>📢 Avisos Inteligentes:</b> Preenchimento automático de mensagens padrão ao selecionar um status (Operacional, Instabilidade, Fora do Ar), com seleção automática de campos para preenchimento rápido.',
        '<b>🔗 Hiperlinks em Orientações:</b> Agora é possível inserir links clicáveis nas orientações através do modal padrão de hiperlinks da extensão.',
        '<b>🕒 Histórico Transparente:</b> Exibição da data e hora exata da última atualização diretamente nos cards e no modal de edição.',
        '<b>🎨 UX Refinada:</b> Títulos unificados, destaque visual para o nome do sistema em edição e fluxo de salvamento otimizado sem interrupções.'
      ]
    },
    {
      version: '2.9.9.6',
      features: [
        '<b>📢 Aba de Avisos Aprimorada:</b> Gestão completa de comunicados internos com suporte a HTML e formatação segura.',
        '<b>🏷️ Identidade Visual por Tipo:</b> Cada aviso agora possui uma borda lateral e ícones específicos conforme a categoria (<i>Informativo</i>, <i>Novidade</i>, <i>Alerta</i> e <i>Importante</i>).',
        '<b>🙈 Gestão de Leitura:</b> Opção "<b>Ocultar</b>" integrada em cada card, permitindo que cada usuário dispense avisos já lidos individualmente.',
        '<b>🧹 Limpeza Automática:</b> Implementada expiração automática de avisos após <b>7 dias</b>, mantendo o painel sempre atualizado.',
        '<b>👤 Identificação de Autoria:</b> Captura automática do nome do publicador diretamente do SGD (visível apenas para desenvolvedores).',
        '<b>⚡ UX & Agilidade:</b> Interface de criação mais compacta, atualização automática da lista após salvar e ações movidas para o cabeçalho do card para melhor aproveitamento de espaço.'
      ]
    },
    {
      version: '2.9.9.8',
      features: [
        '<b>⏱️ Cronômetro Integrado ao FAB:</b> Nova ferramenta para gestão de tempo com suporte a Pause, Reset e Edição Manual.',
        '<b>📌 Fixação Individual (Pin):</b> Agora cada item do menu de Acesso Rápido pode ser fixado individualmente.',
        '<b>🔍 Visibilidade & Persistência:</b> O cronômetro permanece visível enquanto estiver em execução e salva seu estado automaticamente entre as novas páginas.',
        '<b>🐛 Correções Visuais:</b> Ajuste na formatação de links em Avisos e botão para Inserir Links.'
      ]
    },
    {
      version: '2.9.9.9',
      features: [
        '<b>👤 Persistência de Filtro por Responsável:</b> Agora sua escolha de responsável no painel de pendências é salva automaticamente e restaurada ao abrir a extensão.',
        '<b>🔔 Notificações Inteligentes:</b> O monitor de segundo plano agora respeita seu filtro de responsável. Você receberá notificações apenas das novas pendências do responsável selecionado.',
        '<b>🎯 Monitoramento Flexível:</b> Ao selecionar "Todos Responsáveis", a extensão volta a monitorar e notificar sobre toda a equipe.',
        '<b>⏱️ SLA Inteligente e Dias Úteis:</b>',
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li><b>🧠 Adoção Inteligente:</b> Diferencia automaticamente chamados <u>precisos</u> (online) e <u>estimados</u> (offline) com base na chegada.</li>' +
        '<li><b>⌚ Tooltip em HH:MM:</b> Exibição de tempo exato em <b>HH:MM</b> nos casos precisos diretamente no badge de SLA.</li>' +
        '<li><b>📅 Dias Úteis:</b> Cálculo de SLA considera apenas dias úteis, com feriados recorrentes (01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20, 12-25).</li>' +
        '<li><b>~ XD para Offline:</b> Chamados estimados exibem <b>~ 1D, ~ 2D</b> com opacidade reduzida e tooltip explicativo.</li>' +
        '</ul>',
        '<b>⚡ Otimizações Gerais:</b> Ajustes de performance e correções visuais na extensão.'
      ]
    },
    {
      version: '2.9.9.7',
      features: [
        '<b>📢 Publicação Automática de Avisos:</b> Ao editar status de sistemas, agora é possível publicar automaticamente um aviso para toda equipe através de um checkbox na interface de edição.',
        '<b>✨ Títulos Descritivos:</b> Os avisos gerados incluem automaticamente o nome do sistema e o novo status no título (ex: "<i>Status do Sistema: Dominio Web - Fora do Ar</i>").',
        '<b>👤 Autoria Automática:</b> Captura automática do nome do responsável pela alteração usando a identificação do usuário logado.',
        '<b>📝 Abertura Automática de Anotações:</b> Anotações Rápidas vinculadas a links específicos agora abrem automaticamente ao acessar a página, com scroll suave até a nota.',
        '<b>🔔 Notificações mais Flexíveis:</b> Agora é possível clicar em qualquer lugar da notificação de pendências (não apenas no botão "Visualizar") para acessar a lista.',
        '<b>⚡ Navegação Inteligente:</b> Melhorada a confiabilidade ao abrir o painel via links, com sistema de tentativas automáticas para garantir que a aba de pendências seja selecionada corretamente.'
      ]
    }
  ],
  '2.9.6': [
    {
      version: '2.9.6.1',
      features: [
        '<b>Melhoria ao gravar trâmites:</b> Habilitar automaticamente a opção "<b>Solução</b>" ao cadastrar ou responder atendimento.',
        '<b>Melhoria na classificação:</b> Manter a classificação padrão (ultima selecionada) e remover duplicatas de "Todas" durante o cadastro.'
      ]
    }
  ]
}
