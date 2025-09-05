## 📖 Sobre o Projeto

O **SGD - Editor de Texto Aprimorado** é uma extensão para navegador projetada para turbinar a interface de edição de texto do sistema SGD da Domínio Sistemas. A extensão substitui o editor padrão por uma ferramenta moderna e cheia de funcionalidades, otimizando o fluxo de trabalho de analistas de suporte e outros usuários do sistema.

O foco é oferecer uma experiência de escrita mais rica, ágil e personalizável, com recursos que vão desde formatação avançada até automação com atalhos e integração com Inteligência Artificial.

## ✨ Funcionalidades Principais

Esta extensão adiciona uma barra de ferramentas completa e diversas outras melhorias, incluindo:

* **Editor Avançado**: Interface de formatação de texto moderna com opções de **negrito**, _itálico_, <u>sublinhado</u>, cores de texto e de destaque.
* **Temas Personalizáveis**: Múltiplos temas visuais (Claro, Escuro, Floresta, etc.) para adaptar a aparência do editor à sua preferência.
* **Trâmites Rápidos**: Crie, gerencie e insira respostas padrão rapidamente a partir de um menu suspenso. Organize seus trâmites em categorias e reordene com um simples arrastar e soltar.
* **Atalhos Inteligentes**: Associe atalhos de teclado às suas categorias de trâmites para inserir mensagens com máxima agilidade.
* **Painel de Visualização**: Um painel que exibe em tempo real uma prévia do texto formatado em HTML, garantindo que o resultado final seja exatamente o esperado.
* **Recursos de IA (Google Gemini)**:
    * **Melhoria de Texto**: Corrige ortografia e gramática do seu texto com um clique.
    * **Assistente de Escrita**: Gera textos profissionais a partir de tópicos, completa rascunhos e resume o conteúdo da solicitação de suporte.
* **Painel de Anotações Lateral**: Um espaço para anotações rápidas que fica sempre acessível, com suporte a múltiplos blocos de notas.
* **Gerenciador de Lembretes**: Agende lembretes associados a chamados, com notificações no navegador para nunca mais perder um prazo.
* **Importação e Exportação**: Faça backup dos seus trâmites em formato JSON e importe-os em outras instalações da extensão.

## 🏗️ Estrutura do Projeto

O código-fonte é modular e bem organizado, com cada arquivo tendo uma responsabilidade clara para facilitar a manutenção e a evolução do projeto.

* 📄 **`manifest.json`**: Arquivo de manifesto da extensão, definindo permissões, scripts e ícones.
* ⚙️ **`config.js`**: Arquivo central de configurações. Define constantes, seletores de CSS do sistema SGD, temas disponíveis e configurações padrão.
* 🚀 **`main.js`**: Ponto de entrada da extensão. Responsável por inicializar o editor, observar a página do SGD por mudanças e carregar os módulos.
* ✍️ **`editor-core.js`**: Contém a lógica central de formatação e inserção de texto no editor, além de gerenciar o painel de visualização.
* 💡 **`features.js`**: Implementa as funcionalidades mais complexas, como o sistema de atalhos, inserções especiais (nome de usuário, links) e a lógica de integração com a IA.
* ⚡ **`quick-messages.js`**: Gerencia toda a funcionalidade de "Trâmites Rápidos", incluindo a lógica de arrastar e soltar (drag-and-drop) e os modais de gerenciamento.
* 🖼️ **`ui-components.js`**: Uma biblioteca de componentes de UI reutilizáveis, como modais, notificações (toasts) e seletores (emojis, cores).
* 💾 **`storage.js`**: Camada de abstração para interagir com o `chrome.storage`, gerenciando o salvamento e a leitura de todos os dados da extensão (trâmites, anotações, configurações). Inclui um sistema de migração de dados para novas versões.
* 🧠 **`ai-service.js`**: Isola a comunicação com a API do Google Gemini. Prepara os prompts, envia as requisições e processa as respostas da IA. (Em desenvolvimento)
* ⏳ **`service-worker.js`**: Script de fundo que gerencia alarmes para o sistema de lembretes e executa tarefas periódicas, como a análise de uso para sugerir novos trâmites.
* 🛠️ **`utils.js`**: Funções utilitárias usadas em todo o projeto, como sanitização de HTML e extração de conteúdo da página do SGD.
* 🎨 **`editor.css`**: Contém todos os estilos da extensão. Utiliza variáveis CSS para um sistema de temas eficiente e Flexbox para um design responsivo.

## 🚀 Como Instalar

* **Chrome Web Store**:
    1.  Acesse o link da extensão na Chrome Web Store (**[SGD - Editor de Texto Aprimorado](https://chromewebstore.google.com/detail/sgd-editor-de-texto-aprim/gheenkbjmfijkelccofdnlcfbfeinfpe?authuser=0&hl=pt-BR)**).
    2.  Clique em "Usar no Chrome".
    3.  Acesse o site do SGD e a extensão será carregada automaticamente.
