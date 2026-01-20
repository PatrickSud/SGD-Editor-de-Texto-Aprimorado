const RELEASE_NOTES = {
  '2.9.9': {
    title: '✨ Novidades da Versão 2.9.9',
    features: [
      '<b>🚀 Central de Informações SGD (Em Desenvolvimento):</b>',
      '<ul style="margin-top: 5px; margin-bottom: 10px; padding-left: 20px;">' +
        '<li><b>🤖 Nova Aba AI Chains:</b> Assistentes inteligentes e fluxos agora têm sua própria seção dedicada.</li>' +
        '<li><b>🏷️ Gestão de TAGS:</b> Classifique pendências com Tags coloridas (<i>Em SS</i>, <i>Em SA/NE</i>, <i>Prioridade</i> e personalizadas).</li>' +
        '<li><b>🔍 Filtro por Tags:</b> Visualize rapida\mente chamados por categoria na lista de pendências.</li>' +
        '<li><b>🔔 Controle de Notificações:</b> Ative/desative alertas visuais na tela (verificação continua em background).</li>' +
      '</ul>',
      '<b>⚡ Otimizações Gerais:</b> Ajustes de performance e correções visuais na extensão.'
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
        '<b>🤖 Modelos Inteligentes:</b> Preenchimento automático de mensagens padrão ao selecionar um status (Operacional, Instabilidade, Fora do Ar), com seleção automática de campos para preenchimento rápido.',
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
