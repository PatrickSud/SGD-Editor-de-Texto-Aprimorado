# Regras de Estilo de Codificação - SGD Editor de Texto Aprimorado

Este documento define as regras de estilo de codificação que devem ser seguidas para manter a consistência do projeto.

## 1. Estrutura Geral dos Arquivos

### 1.1 Cabeçalho de Arquivo

```javascript
/**
 * @file nome-do-arquivo.js
 * Descrição breve do propósito do arquivo
 */
```

### 1.2 Organização de Código

- **Constantes globais** no topo do arquivo
- **Funções auxiliares** antes das funções principais
- **Funções principais** organizadas por funcionalidade
- **Event listeners** agrupados por contexto

## 2. Convenções de Nomenclatura

### 2.1 Variáveis e Funções

- **camelCase** para variáveis e funções
- **Nomes descritivos** que explicam o propósito
- **Prefixo de tipo** para elementos DOM: `modal`, `button`, `container`, `list`

```javascript
// ✅ Correto
const targetTextArea = document.querySelector('textarea')
const quickStepsDropdown = container.querySelector('.quick-steps-dropdown')
const isListening = false

// ❌ Incorreto
const txt = document.querySelector('textarea')
const qsd = container.querySelector('.quick-steps-dropdown')
const listening = false
```

### 2.2 Constantes

- **UPPER_SNAKE_CASE** para constantes globais
- **Nomes descritivos** com contexto

```javascript
// ✅ Correto
const REMINDERS_STORAGE_KEY = 'remindersData'
const GEMINI_API_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
const DEFAULT_SETTINGS = {
  // configurações
}

// ❌ Incorreto
const key = 'remindersData'
const endpoint = 'https://...'
```

### 2.3 IDs e Classes CSS

- **kebab-case** para IDs e classes CSS
- **Prefixo descritivo** para elementos da extensão

```javascript
// ✅ Correto
'quick-inserter-panel'
'se-modal-content'
'qi-category-item'

// ❌ Incorreto
'panel'
'content'
'item'
```

## 3. Formatação e Indentação

### 3.1 Indentação

- **2 espaços** para indentação
- **Consistência** em todo o arquivo

### 3.2 Quebras de Linha

- **Máximo 100 caracteres** por linha
- **Quebra lógica** em operadores e vírgulas
- **Alinhamento** de parâmetros em funções longas

```javascript
// ✅ Correto
const modal = createModal(
  'Título do Modal',
  contentHtml,
  onSave,
  true,
  'modal-id'
)

// ❌ Incorreto
const modal = createModal(
  'Título do Modal',
  contentHtml,
  onSave,
  true,
  'modal-id'
)
```

### 3.3 Espaçamento

- **1 linha em branco** entre funções
- **Espaço** antes e depois de operadores
- **Sem espaço** antes de vírgulas e pontos e vírgulas

```javascript
// ✅ Correto
function functionOne() {
  const result = a + b
  return result
}

function functionTwo() {
  // código
}

// ❌ Incorreto
function functionOne() {
  const result = a + b
  return result
}
function functionTwo() {
  // código
}
```

## 4. Comentários e Documentação

### 4.1 Comentários de Função

```javascript
/**
 * Descrição clara do que a função faz.
 * @param {HTMLElement} textArea - O textarea alvo para inserção
 * @param {string} text - O texto a ser inserido
 * @param {object} options - Opções de inserção
 * @returns {void}
 */
function insertAtCursor(textArea, text, options = {}) {
  // implementação
}
```

### 4.2 Comentários Inline

- **Explicar o "porquê"**, não o "o que"
- **Comentários em português** para consistência
- **Comentários de seção** para organizar código

```javascript
// ✅ Correto
// CORREÇÃO: Restaura o conteúdo usando o estado inicial salvo
targetTextArea.value = initialTextBeforeCursor + initialTextAfterCursor

// Segurança: Escapar HTML para prevenir XSS
const safeContent = escapeHTML(userInput)

// --- FUNÇÕES DE DRAG & DROP ---
function handleDragStart(e) {
  // implementação
}
```

## 5. Estruturas de Controle

### 5.1 Condicionais

- **Early return** para reduzir aninhamento
- **Operador ternário** para atribuições simples
- **Parênteses** para clareza em condições complexas

```javascript
// ✅ Correto
if (!textArea) return

const isActive = condition ? true : false

if ((condition1 && condition2) || (condition3 && condition4)) {
  // código
}

// ❌ Incorreto
if (textArea) {
  if (condition) {
    if (anotherCondition) {
      // código aninhado
    }
  }
}
```

### 5.2 Loops

- **for...of** para arrays
- **forEach** para operações simples
- **map/filter** para transformações

```javascript
// ✅ Correto
for (const message of messages) {
  // processar mensagem
}

messages.forEach(msg => {
  // operação simples
})

const filteredMessages = messages.filter(msg => msg.active)

// ❌ Incorreto
for (let i = 0; i < messages.length; i++) {
  const message = messages[i]
  // código
}
```

## 6. Manipulação de DOM

### 6.1 Seleção de Elementos

- **querySelector** para elementos únicos
- **querySelectorAll** para múltiplos elementos
- **Verificação de existência** antes de usar

```javascript
// ✅ Correto
const textArea = document.querySelector('textarea[data-enhanced]')
if (!textArea) return

const buttons = document.querySelectorAll('.action-btn')
buttons.forEach(button => {
  // processar botão
})

// ❌ Incorreto
const textArea = document.querySelector('textarea[data-enhanced]')
textArea.value = 'texto' // pode causar erro se não existir
```

### 6.2 Criação de Elementos

- **createElement** para elementos complexos
- **innerHTML** para HTML simples
- **Escape HTML** para conteúdo do usuário

```javascript
// ✅ Correto
const container = document.createElement('div')
container.className = 'message-container'

// Para HTML simples
container.innerHTML = `
  <span class="message-title">${escapeHTML(message.title)}</span>
  <button class="action-btn">Ação</button>
`

// ❌ Incorreto
container.innerHTML = `<span>${userInput}</span>` // XSS risk
```

## 7. Tratamento de Erros

### 7.1 Try-Catch

- **Try-catch** para operações assíncronas
- **Logs de erro** com contexto
- **Fallbacks** quando possível

```javascript
// ✅ Correto
try {
  const result = await someAsyncOperation()
  return result
} catch (error) {
  console.error('Erro ao executar operação:', error)
  showNotification('Erro na operação', 'error')
  return null
}

// ❌ Incorreto
const result = await someAsyncOperation() // pode falhar
return result
```

### 7.2 Validação de Entrada

- **Verificação de tipos** e valores
- **Validação de parâmetros** em funções públicas
- **Mensagens de erro** claras

```javascript
// ✅ Correto
function insertAtCursor(textArea, text, options = {}) {
  if (!textArea || typeof textArea.value !== 'string') {
    console.error('Editor SGD: textArea inválido')
    return
  }

  if (typeof text !== 'string') {
    console.error('Editor SGD: texto inválido')
    return
  }

  // implementação
}
```

## 8. Funções Assíncronas

### 8.1 Async/Await

- **async/await** preferido sobre Promises
- **Aguardar** operações assíncronas
- **Tratamento de erro** adequado

```javascript
// ✅ Correto
async function loadData() {
  try {
    const data = await getStoredData()
    const settings = await getSettings()
    return { data, settings }
  } catch (error) {
    console.error('Erro ao carregar dados:', error)
    return null
  }
}

// ❌ Incorreto
function loadData() {
  getStoredData().then(data => {
    getSettings().then(settings => {
      // código aninhado
    })
  })
}
```

## 9. Estruturas de Dados

### 9.1 Objetos

- **Propriedades organizadas** logicamente
- **Destructuring** para acessar propriedades
- **Spread operator** para cópias

```javascript
// ✅ Correto
const message = {
  id: `msg-${Date.now()}`,
  title: newTitle,
  message: newMessage,
  categoryId,
  order: maxOrder + 1
}

const { title, message: content } = message
const updatedMessage = { ...message, title: 'Novo Título' }

// ❌ Incorreto
const message = {
  order: maxOrder + 1,
  id: `msg-${Date.now()}`,
  message: newMessage,
  title: newTitle,
  categoryId
}
```

### 9.2 Arrays

- **Métodos funcionais** quando apropriado
- **Imutabilidade** quando possível
- **Verificação de existência** antes de acessar

```javascript
// ✅ Correto
const activeMessages = messages.filter(msg => msg.active)
const messageTitles = messages.map(msg => msg.title)
const hasMessages = messages.length > 0

// ❌ Incorreto
const activeMessages = []
for (let i = 0; i < messages.length; i++) {
  if (messages[i].active) {
    activeMessages.push(messages[i])
  }
}
```

## 10. Específico do Projeto

### 10.1 Chrome Extension APIs

- **Verificação de disponibilidade** das APIs
- **Tratamento de erros** específico do Chrome
- **Fallbacks** para funcionalidades opcionais

```javascript
// ✅ Correto
if (typeof chrome !== 'undefined' && chrome.storage) {
  try {
    await chrome.storage.sync.set({ key: value })
  } catch (error) {
    console.error('Erro ao salvar no Chrome storage:', error)
  }
} else {
  console.warn('Chrome storage não disponível')
}
```

### 10.2 Event Listeners

- **Remoção** de listeners quando necessário
- **Event delegation** para elementos dinâmicos
- **Prevenção de duplicação**

```javascript
// ✅ Correto
function setupListeners() {
  const button = document.querySelector('.action-btn')
  if (button) {
    button.addEventListener('click', handleClick)
  }
}

function cleanupListeners() {
  const button = document.querySelector('.action-btn')
  if (button) {
    button.removeEventListener('click', handleClick)
  }
}

// Event delegation
document.addEventListener('click', e => {
  if (e.target.matches('.dynamic-button')) {
    handleDynamicClick(e)
  }
})
```

## 11. Performance e Otimização

### 11.1 Debouncing e Throttling

- **Debounce** para eventos frequentes
- **Throttle** para operações contínuas
- **RequestAnimationFrame** para animações

```javascript
// ✅ Correto
let searchTimeout
function handleSearchInput(e) {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    performSearch(e.target.value)
  }, 300)
}

function updateUI() {
  requestAnimationFrame(() => {
    // atualizar UI
  })
}
```

### 11.2 Memoização

- **Cache** para operações custosas
- **Lazy loading** para recursos pesados
- **Cleanup** de recursos não utilizados

```javascript
// ✅ Correto
const cache = new Map()

function expensiveOperation(key) {
  if (cache.has(key)) {
    return cache.get(key)
  }

  const result = performExpensiveOperation(key)
  cache.set(key, result)
  return result
}
```

## 12. Acessibilidade

### 12.1 Atributos ARIA

- **aria-label** para elementos sem texto
- **aria-expanded** para elementos colapsáveis
- **role** para elementos customizados

```javascript
// ✅ Correto
button.setAttribute('aria-label', 'Fechar modal')
button.setAttribute('aria-expanded', 'false')
button.setAttribute('role', 'button')
```

### 12.2 Navegação por Teclado

- **Tabindex** apropriado
- **Eventos de teclado** para atalhos
- **Focus management** em modais

```javascript
// ✅ Correto
function handleKeydown(e) {
  if (e.key === 'Escape') {
    closeModal()
  } else if (e.key === 'Enter' && e.ctrlKey) {
    saveData()
  }
}

// Focus management
function openModal() {
  modal.style.display = 'block'
  const firstInput = modal.querySelector('input')
  if (firstInput) {
    firstInput.focus()
  }
}
```

## 13. Segurança

### 13.1 Sanitização

- **Escape HTML** para conteúdo do usuário
- **Validação de URLs** antes de usar
- **Sanitização** de dados antes de armazenar

```javascript
// ✅ Correto
function displayUserContent(userInput) {
  const safeContent = escapeHTML(userInput)
  element.innerHTML = `<span>${safeContent}</span>`
}

function validateUrl(url) {
  try {
    const urlObj = new URL(url)
    return ['http:', 'https:'].includes(urlObj.protocol)
  } catch {
    return false
  }
}
```

### 13.2 Dados Sensíveis

- **Não logar** informações sensíveis
- **Validação** de entrada do usuário
- **Sanitização** antes de enviar para APIs

```javascript
// ✅ Correto
function logApiCall(endpoint, success) {
  console.log(`API call to ${endpoint}: ${success ? 'success' : 'failed'}`)
  // Não logar a chave da API
}

// ❌ Incorreto
console.log(`API call with key: ${apiKey}`) // Exposição de dados sensíveis
```

## 14. Testes e Debugging

### 14.1 Logs de Debug

- **Console.log** para desenvolvimento
- **Console.error** para erros
- **Console.warn** para avisos

```javascript
// ✅ Correto
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info:', data)
}

console.error('Erro crítico:', error)
console.warn('Aviso: funcionalidade não disponível')
```

### 14.2 Validação de Estado

- **Verificação de estado** antes de operações
- **Validação de dados** em funções críticas
- **Fallbacks** para estados inválidos

```javascript
// ✅ Correto
function updateUI(data) {
  if (!data || typeof data !== 'object') {
    console.warn('Dados inválidos para atualização da UI')
    return
  }

  // atualizar UI
}
```

## 15. Convenções Específicas do Projeto

### 15.1 Notificações

- **showNotification** para feedback do usuário
- **Tipos consistentes**: 'success', 'error', 'warning', 'info'
- **Duração apropriada** para cada tipo

```javascript
// ✅ Correto
showNotification('Operação realizada com sucesso!', 'success', 3000)
showNotification('Erro ao salvar dados', 'error', 5000)
showNotification('Aviso: dados não salvos', 'warning', 4000)
```

### 15.2 Modais

- **createModal** para modais padrão
- **Estrutura consistente** de HTML
- **Event listeners** organizados

```javascript
// ✅ Correto
const modal = createModal(
  'Título do Modal',
  `
    <div class="form-group">
      <label for="input-id">Label</label>
      <input type="text" id="input-id" placeholder="Placeholder">
    </div>
  `,
  async (modalContent, closeModal) => {
    // lógica de salvamento
  }
)
```

### 15.3 Armazenamento

- **getStoredData/saveStoredData** para dados principais
- **getSettings/saveSettings** para configurações
- **Tratamento de erro** consistente

```javascript
// ✅ Correto
async function saveUserData(data) {
  try {
    await saveStoredData(data)
    showNotification('Dados salvos com sucesso!', 'success')
  } catch (error) {
    console.error('Erro ao salvar dados:', error)
    showNotification('Erro ao salvar dados', 'error')
  }
}
```

---

## Resumo das Regras Principais

1. **Consistência**: Siga os padrões estabelecidos no código existente
2. **Legibilidade**: Código deve ser fácil de entender e manter
3. **Segurança**: Sempre sanitize dados do usuário
4. **Performance**: Otimize para operações frequentes
5. **Acessibilidade**: Considere usuários com necessidades especiais
6. **Documentação**: Comente código complexo e funções públicas
7. **Tratamento de Erro**: Sempre trate erros adequadamente
8. **Testabilidade**: Escreva código que seja fácil de testar

Estas regras devem ser seguidas em todo o projeto para manter a consistência e qualidade do código.
