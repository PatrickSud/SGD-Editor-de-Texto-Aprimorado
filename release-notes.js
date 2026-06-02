const RELEASE_NOTES = {
  '3.0.5.1': {
    title: '🔧 Correções de Estabilidade — Versão 3.0.5.1',
    features: [
      '<b>🔄 Estabilidade em Saudações/Encerramentos:</b>' +
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li>Melhorada a sincronização com o SGD para evitar falhas na classificação ao carregar a página e garantida a preservação do conteúdo digitado ao alternar entre situações.' +
        '</ul>'
    ]
  },
  '3.0.5': {
    title: '✨ Novidades da Versão 3.0.5',
    features: [
      '<b>📋 Classificação de Saudações e Encerramentos:</b>' +
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li><b>Novas Categorias:</b> Agora você pode salvar saudações e encerramentos específicos para três situações: <b>Solução</b>, <b>Pedir Informações</b> e <b>Em Análise</b>.</li>' +
        '<li><b>Troca Inteligente:</b> Ao alternar entre as opções no SGD ou mudar a situação do trâmite, o editor troca automaticamente o texto pelos padrões definidos na categoria correspondente.</li>' +
        '<li><b>Gestão Independente:</b> Cada aba permite definir favoritos, editar e excluir itens de forma isolada, garantindo a mensagem certa para cada contexto de atendimento.</li>' +
        '</ul>',

      '<b>✨ Sugestor de SAM com IA:</b>' +
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li>Novo botão <b>Sugerir SAM</b> na toolbar da SSC, ao lado do Sugerir SS.</li>' +
        '<li>O técnico descreve o problema com suas próprias palavras e a IA estrutura a sugestão de SAM automaticamente.</li>' +
        '<li>Opção de leitura do atendimento completo para geração da SAM sem precisar digitar nada.</li>' +
        '<li>Busca automática por SAMs similares já cadastradas antes de gerar uma nova, evitando duplicatas.</li>' +
        '</ul>',

      '<b>🤖 Menu de Recursos de IA:</b>' +
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li><b>Integração:</b> Os botões Sugerir SS e Sugerir SAM agora estão organizados dentro de um novo menu suspenso chamado <b>Recursos de IA</b>.</li>' +
        '<li><b>📌 Fixação (PIN) Individual:</b> Agora você pode fixar seus recursos de IA favoritos diretamente na toolbar! Basta clicar no ícone de pin 📌 dentro do menu para criar um atalho rápido.</li>' +
        '</ul>',

      '<b>🔗 Copiar Link SSC diretamente do FAB (Menu Flutuante):</b>' +
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li>Novo botão flutuante <b>🔗 Copiar Link SSC</b> disponível no menu de Acesso Rápido (FAB).</li>' +
        '<li>Permite copiar rapidamente o link da SSC, formatando um texto pronto para envio ao cliente em um novo trâmite que existe outra SSC de mesmo assunto.</li>' +
        '</ul>',

      '<b>↕️ Reordenação e PIN no FAB (Menu Flutuante):</b>' +
        '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li>Implementada a funcionalidade de reordenação por clique e arraste (Drag and Drop) para todos os botões do menu flutuante (FAB).</li>' +
        '<li>Melhorado o funcionamento do PIN no FAB.</li>' +
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

const MINOR_RELEASE_NOTES = {
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
