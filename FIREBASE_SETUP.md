# 🔥 Guia de Configuração do Firebase Firestore para Status de Sistemas

## 📋 Passo 1: Criar Projeto no Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/)
2. Clique em **"Adicionar projeto"** (ou "Add project")
3. Digite um nome para o projeto (ex: `sgd-extension`)
4. Desabilite o Google Analytics (opcional)
5. Clique em **"Criar projeto"**

---

## 🌐 Passo 2: Adicionar App Web

1. No painel do projeto, clique no ícone **Web** (`</>`)
2. Digite um nome para o app (ex: `SGD Extension`)
3. **NÃO** marque "Configurar Firebase Hosting"
4. Clique em **"Registrar app"**
5. **COPIE** o objeto `firebaseConfig` que aparece na tela

Exemplo:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyBXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto-id",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxxxxxxxxxx"
};
```

---

## 🗄️ Passo 3: Criar Firestore Database

1. No menu lateral, clique em **"Firestore Database"**
2. Clique em **"Criar banco de dados"**
3. Escolha o modo:
   - **Modo de produção** (recomendado) - com regras de segurança
   - Ou **Modo de teste** (apenas para desenvolvimento inicial)
4. Escolha uma localização (ex: `southamerica-east1` para São Paulo)
5. Clique em **"Ativar"**

---

## 🔐 Passo 4: Configurar Regras de Segurança

1. Vá em **Firestore Database** > **Regras**
2. Substitua as regras pelo seguinte código:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Permitir leitura pública da coleção systemStatus
    match /systemStatus/{document} {
      allow read: if true;  // Todos podem ler
      allow write: if request.auth != null;  // Apenas usuários autenticados podem escrever
    }
  }
}
```

3. Clique em **"Publicar"**

---

## 📦 Passo 5: Inicializar Dados no Firestore

### Opção A: Usando o Console do Firebase (Manual)

1. Vá em **Firestore Database** > **Dados**
2. Clique em **"Iniciar coleção"**
3. ID da coleção: `systemStatus`
4. Clique em **"Próximo"**

Para CADA sistema, adicione um documento:

#### Documento 1: Onvio
- **ID do documento:** `onvio`
- **Campos:**
  ```
  name: "Onvio" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 1 (number)
  ```

#### Documento 2: Portal do Cliente
- **ID do documento:** `portal-cliente`
- **Campos:**
  ```
  name: "Portal do Cliente" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 2 (number)
  ```

#### Documento 3: Dominio Web
- **ID do documento:** `dominio-web`
- **Campos:**
  ```
  name: "Dominio Web" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 3 (number)
  ```

#### Documento 4: Dominio Sistemas
- **ID do documento:** `dominio-sistemas`
- **Campos:**
  ```
  name: "Dominio Sistemas" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 4 (number)
  ```

#### Documento 5: Integração API's
- **ID do documento:** `integracao-apis`
- **Campos:**
  ```
  name: "Integração API's" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 5 (number)
  ```

#### Documento 6: Comunicação eSocial
- **ID do documento:** `comunicacao-esocial`
- **Campos:**
  ```
  name: "Comunicação eSocial" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 6 (number)
  ```

#### Documento 7: Notificação de Erro no Sistema
- **ID do documento:** `notificacao-erro`
- **Campos:**
  ```
  name: "Notificação de Erro no Sistema" (string)
  status: "operational" (string)
  message: "Todos os serviços operando normalmente." (string)
  workaround: "" (string)
  order: 7 (number)
  ```

### Opção B: Usando Console do Navegador (Automático)

1. Carregue a extensão no navegador
2. Abra a página do SGD
3. Abra o Console do Navegador (F12)
4. Cole e execute o seguinte código:

```javascript
// Execute isso no console do navegador UMA VEZ para inicializar
initializeSystemsInFirestore();
```

---

## ⚙️ Passo 6: Configurar a Extensão

1. Abra o arquivo `system-status-service.js`
2. Na linha 8-15, **SUBSTITUA** o `firebaseConfig` pelo que você copiou do Firebase:

```javascript
const firebaseConfig = {
  apiKey: "SUA_API_KEY_AQUI",
  authDomain: "seu-projeto.firebaseapp.com",
  projectId: "seu-projeto-id",
  storageBucket: "seu-projeto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxxxxxxxxxx"
};
```

3. Salve o arquivo

---

## 🧪 Passo 7: Testar

1. Recarregue a extensão no Chrome
2. Abra o SGD
3. Abra a **Central de Informações SGD**
4. Ative o **modo desenvolvedor** (clique 5x no título "Painel")
5. Clique na aba **🚨 Instabilidades**
6. Os sistemas devem carregar do Firestore
7. Com modo desenvolvedor ativo, você verá um botão **✏️** em cada sistema
8. Clique para editar e teste a atualização em tempo real

---

## 📝 Como Usar

### Para Atualizar Status de um Sistema:

1. **Ative o modo desenvolvedor** na Central de Informações
2. Acesse a aba **Instabilidades**
3. Clique no botão **✏️** no sistema que deseja atualizar
4. Altere:
   - **Status:** Operacional, Atenção, Instabilidade ou Fora do Ar
   - **Mensagem:** Descrição do status atual
   - **Contorno (opcional):** Instruções para os usuários
5. Clique em **"Salvar Alterações"**
6. ✅ **TODOS os usuários** da extensão verão a atualização em **tempo real**!

### Valores de Status Disponíveis:

- `operational` - ✅ Verde - Operacional
- `warning` - ⚠️ Amarelo - Atenção
- `error` - 🔴 Vermelho - Instabilidade
- `down` - ❌ Vermelho - Fora do Ar

---

## 🔍 Troubleshooting

### Erro: "Firebase não inicializado"
- Verifique se o `firebaseConfig` está correto no `system-status-service.js`
- Verifique se o Firestore está ativado no console do Firebase

### Erro ao salvar alterações
- Verifique as regras de segurança no Firestore
- Certifique-se de que a coleção `systemStatus` existe

### Sistemas não aparecem
- Verifique console do navegador (F12) para erros
- Certifique-se de que os documentos existem no Firestore
- Tente executar `initializeSystemsInFirestore()` no console

### Cache desatualizado
- O sistema usa cache local, mas atualiza em tempo real
- Se necessário, limpe o cache: `chrome.storage.local.clear()`

---

## 🎯 Recursos

- **Atualizações em tempo real** - Mudanças são exibidas instantaneamente
- **Cache local** - Funciona mesmo sem internet (dados anteriores)
- **Fallback automático** - Se Firebase falhar, usa dados padrão
- **Interface de edição** - Apenas modo desenvolvedor
- **Multi-usuário** - Todos veem as mesmas informações

---

## 📞 Suporte

Se tiver problemas:
1. Check console do navegador (F12)
2. Verifique console do Firebase
3. Confirme que as permissões do Firestore estão corretas
