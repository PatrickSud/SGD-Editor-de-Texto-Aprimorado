const RELEASE_NOTES = {
  '2.9.8': {
    title: '✨ Novidades da Versão 2.9.8',
    features: [
      '<b>Novo Encerramento Padrão:</b> Adicionado o encerramento "Acesso Remoto", disponível para todos os usuários, facilitando o suporte técnico.'
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
