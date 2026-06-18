/**
 * @file permissions-service.js
 * Serviço para gerenciar permissões de Editores e Visualizadores da Central de Informações SGD.
 *
 * Fluxo:
 *   1. Captura o nome do técnico logado do DOM do SGD
 *   2. Busca a lista de editores no Firebase RTDB (com cache local de 30min)
 *   3. Verifica se o técnico é editor e expõe o resultado via window.sgdPermissions
 */

;(function () {
  'use strict'

  // ─── Estado Global ───────────────────────────────────────────────────────────
  window.sgdPermissions = {
    currentUser: null,    // Nome capturado do SGD
    isEditor: false,      // true se o usuário está na lista de editores
    isDevMode: false,     // true se o modo dev está ativo
    initialized: false,  // true após a primeira verificação
    editorsList: [],      // Lista de editores [{id, name, addedAt, addedBy, allowedChannels}]
    viewersList: [],      // Lista de visualizadores [{id, name, firstSeen, lastSeen, allowedChannels}]
    allowedChannels: []   // Canais permitidos para o usuário atual
  }

  // ─── Captura do Nome do Técnico Logado ───────────────────────────────────────

  /**
   * Tenta capturar o nome do técnico logado diretamente do DOM do SGD.
   * Tenta múltiplos seletores conhecidos por ordem de prioridade.
   * @returns {string|null} Nome completo ou null se não encontrado
   */
  function captureLoggedUserName() {
    // Seletor principal: barra de navegação superior do SGD
    const navBarName = document.querySelector('p.navbar-text.navbar-right a b')
    if (navBarName && navBarName.textContent.trim()) {
      return navBarName.textContent.trim()
    }

    // Seletor secundário: elemento de usuário logado
    const userNameEl = document.getElementById('td:usuario_nome')
    if (userNameEl && userNameEl.textContent.trim()) {
      const fullName = userNameEl.textContent.trim().replace(/\s+/g, ' ')
      if (fullName.toLowerCase() !== 'não informado') {
        return fullName
      }
    }

    // Seletor terciário: elementos alternativos
    const altSelectors = [
      '[id*="usuario_nome"]',
      '[name*="usuario_nome"]',
      '.navbar-right .navbar-link b',
      '.navbar-right a b'
    ]

    for (const selector of altSelectors) {
      try {
        const el = document.querySelector(selector)
        if (el && el.textContent.trim()) {
          return el.textContent.trim()
        }
      } catch (_) { /* seletor inválido, ignora */ }
    }

    return null
  }

  // ─── Cache e Fetch dos Editores e Visualizadores ─────────────────────────────

  /**
   * Busca a lista de editores do Firebase RTDB com cache local de 30 minutos.
   * @param {boolean} forceRefresh - Se true, ignora o cache e busca do servidor
   * @returns {Promise<Array>} Lista de editores [{id, name, addedAt, addedBy, allowedChannels}]
   */
  async function getEditorsList(forceRefresh = false) {
    try {
      if (!forceRefresh) {
        const stored = await chrome.storage.local.get([PERMISSIONS_CACHE_KEY, 'permissionsCacheTime'])
        const cacheTime = stored.permissionsCacheTime || 0
        const isValid = (Date.now() - cacheTime) < PERMISSIONS_CACHE_TTL

        if (isValid && Array.isArray(stored[PERMISSIONS_CACHE_KEY])) {
          return stored[PERMISSIONS_CACHE_KEY]
        }
      }

      const response = await fetch(`${RTDB_EDITORS_URL}.json`, { cache: 'no-store' })
      if (!response.ok) {
        const fallback = await chrome.storage.local.get(PERMISSIONS_CACHE_KEY)
        return fallback[PERMISSIONS_CACHE_KEY] || []
      }

      const result = await response.json()
      if (!result || typeof result !== 'object') {
        await chrome.storage.local.set({
          [PERMISSIONS_CACHE_KEY]: [],
          permissionsCacheTime: Date.now()
        })
        return []
      }

      const editorsList = Object.entries(result).map(([id, data]) => ({
        id,
        name: data.name || '',
        addedAt: data.addedAt || '',
        addedBy: data.addedBy || '',
        allowedChannels: data.allowedChannels || [...WARNING_CHANNELS]
      }))

      await chrome.storage.local.set({
        [PERMISSIONS_CACHE_KEY]: editorsList,
        permissionsCacheTime: Date.now()
      })

      return editorsList
    } catch (error) {
      console.warn('[SGD Permissions] Erro ao buscar lista de editores:', error)
      const fallback = await chrome.storage.local.get(PERMISSIONS_CACHE_KEY)
      return fallback[PERMISSIONS_CACHE_KEY] || []
    }
  }

  /**
   * Busca a lista de visualizadores do Firebase RTDB com cache local de 30 minutos.
   * @param {boolean} forceRefresh - Se true, ignora o cache e busca do servidor
   * @returns {Promise<Array>} Lista de visualizadores [{id, name, firstSeen, lastSeen, allowedChannels}]
   */
  async function getViewersList(forceRefresh = false) {
    try {
      if (!forceRefresh) {
        const stored = await chrome.storage.local.get([VIEWERS_CACHE_KEY, 'viewersCacheTime'])
        const cacheTime = stored.viewersCacheTime || 0
        const isValid = (Date.now() - cacheTime) < PERMISSIONS_CACHE_TTL

        if (isValid && Array.isArray(stored[VIEWERS_CACHE_KEY])) {
          return stored[VIEWERS_CACHE_KEY]
        }
      }

      const response = await fetch(`${RTDB_VIEWERS_URL}.json`, { cache: 'no-store' })
      if (!response.ok) {
        const fallback = await chrome.storage.local.get(VIEWERS_CACHE_KEY)
        return fallback[VIEWERS_CACHE_KEY] || []
      }

      const result = await response.json()
      if (!result || typeof result !== 'object') {
        await chrome.storage.local.set({
          [VIEWERS_CACHE_KEY]: [],
          viewersCacheTime: Date.now()
        })
        return []
      }

      const viewersList = Object.entries(result).map(([id, data]) => ({
        id,
        name: data.name || '',
        firstSeen: data.firstSeen || '',
        lastSeen: data.lastSeen || '',
        allowedChannels: data.allowedChannels || [...WARNING_CHANNELS]
      }))

      viewersList.sort((a, b) => a.name.localeCompare(b.name))

      await chrome.storage.local.set({
        [VIEWERS_CACHE_KEY]: viewersList,
        viewersCacheTime: Date.now()
      })

      return viewersList
    } catch (error) {
      console.warn('[SGD Permissions] Erro ao buscar lista de visualizadores:', error)
      const fallback = await chrome.storage.local.get(VIEWERS_CACHE_KEY)
      return fallback[VIEWERS_CACHE_KEY] || []
    }
  }

  /**
   * Invalida o cache de permissões, forçando nova busca na próxima verificação.
   */
  async function invalidatePermissionsCache() {
    await chrome.storage.local.set({ 
      permissionsCacheTime: 0,
      viewersCacheTime: 0 
    })
  }

  // ─── Verificação de Editor ────────────────────────────────────────────────────

  /**
   * Normaliza um nome para comparação (lowercase, sem acentos, sem espaços extras).
   * @param {string} name
   * @returns {string}
   */
  function normalizeName(name) {
    if (!name) return ''
    return name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
  }

  /**
   * Verifica se o técnico logado é um editor e carrega seus canais permitidos.
   * Também considera o Modo Dev como bypass.
   * @returns {Promise<boolean>}
   */
  async function isCurrentUserEditor() {
    const devData = await chrome.storage.local.get(['infoDevMode', 'developerModeEnabled'])
    const isDevMode = !!(devData.infoDevMode || devData.developerModeEnabled)

    if (isDevMode) {
      window.sgdPermissions.isDevMode = true
    }

    const userName = window.sgdPermissions.currentUser
    if (!userName) {
      if (isDevMode) {
        window.sgdPermissions.isEditor = true
        window.sgdPermissions.allowedChannels = [...WARNING_CHANNELS]
        await chrome.storage.local.set({ 
          allowedChannels: [...WARNING_CHANNELS], 
          isCurrentUserEditor: true 
        })
        return true
      }
      return false
    }

    const editors = await getEditorsList()
    const normalizedUserName = normalizeName(userName)

    const matchedEditor = editors.find(editor => normalizeName(editor.name) === normalizedUserName)
    const found = !!matchedEditor || isDevMode
    window.sgdPermissions.isEditor = found
    
    let allowed = [...WARNING_CHANNELS]
    if (matchedEditor) {
      allowed = matchedEditor.allowedChannels || [...WARNING_CHANNELS]
      // Ativa automaticamente o Modo Dev para editores cadastrados
      await chrome.storage.local.set({ 
        infoDevMode: true
      })
      window.sgdPermissions.isDevMode = true
    } else if (isDevMode) {
      allowed = [...WARNING_CHANNELS]
    } else {
      const viewers = await getViewersList()
      const matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUserName)
      if (matchedViewer) {
        allowed = matchedViewer.allowedChannels || [...WARNING_CHANNELS]
      }
    }
    
    window.sgdPermissions.allowedChannels = allowed
    await chrome.storage.local.set({ 
      allowedChannels: allowed, 
      isCurrentUserEditor: found 
    })
    
    return found
  }

  // ─── Registro Automático de Usuários ──────────────────────────────────────────

  /**
   * Registra a atividade do usuário atual no Firebase.
   * @param {string} userName 
   */
  async function registerUserActivity(userName) {
    if (!userName) return
    
    const normalizedUser = normalizeName(userName)
    const nowStr = new Date().toISOString()
    
    try {
      // Obter estado atual do Modo Dev
      const devData = await chrome.storage.local.get(['infoDevMode', 'developerModeEnabled'])
      const isDevMode = !!(devData.infoDevMode || devData.developerModeEnabled)

      // 1. Busca listas atualizadas
      const editors = await getEditorsList(true)
      const matchedEditor = editors.find(e => normalizeName(e.name) === normalizedUser)
      
      if (isDevMode) {
        if (matchedEditor) {
          // Atualiza lastSeen do editor no Firebase
          await fetch(`${RTDB_EDITORS_URL}/${matchedEditor.id}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSeen: nowStr })
          })
          
          const allowed = matchedEditor.allowedChannels || [...WARNING_CHANNELS]
          await chrome.storage.local.set({ 
            allowedChannels: allowed,
            isCurrentUserEditor: true
          })
          window.sgdPermissions.allowedChannels = allowed
          window.sgdPermissions.isEditor = true
        } else {
          // Novo editor com canais padrão
          const defaultChannels = [...WARNING_CHANNELS]
          const response = await fetch(`${RTDB_EDITORS_URL}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: userName.trim(),
              addedAt: nowStr,
              addedBy: 'Auto Dev Mode',
              allowedChannels: defaultChannels,
              lastSeen: nowStr
            })
          })
          
          if (response.ok) {
            await chrome.storage.local.set({ 
              allowedChannels: defaultChannels,
              isCurrentUserEditor: true
            })
            window.sgdPermissions.allowedChannels = defaultChannels
            window.sgdPermissions.isEditor = true
          }
        }

        // Remove do viewers se existir duplicata
        const viewers = await getViewersList(true)
        const matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUser)
        if (matchedViewer) {
          await fetch(`${RTDB_VIEWERS_URL}/${matchedViewer.id}.json`, {
            method: 'DELETE'
          })
        }
        
        await invalidatePermissionsCache()
        return
      }
      
      if (matchedEditor) {
        // Atualiza lastSeen do editor no Firebase
        await fetch(`${RTDB_EDITORS_URL}/${matchedEditor.id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastSeen: nowStr })
        })
        
        const allowed = matchedEditor.allowedChannels || [...WARNING_CHANNELS]
        await chrome.storage.local.set({ 
          allowedChannels: allowed,
          isCurrentUserEditor: true
        })
        window.sgdPermissions.allowedChannels = allowed
        window.sgdPermissions.isEditor = true
        return
      }
      
      const viewers = await getViewersList(true)
      const matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUser)
      
      if (matchedViewer) {
        // Atualiza lastSeen do visualizador
        await fetch(`${RTDB_VIEWERS_URL}/${matchedViewer.id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastSeen: nowStr })
        })
        
        const allowed = matchedViewer.allowedChannels || [...WARNING_CHANNELS]
        await chrome.storage.local.set({ 
          allowedChannels: allowed,
          isCurrentUserEditor: false
        })
        window.sgdPermissions.allowedChannels = allowed
        window.sgdPermissions.isEditor = false
      } else {
        // Cadastra novo visualizador com todos os canais liberados por padrão
        const defaultChannels = [...WARNING_CHANNELS]
        const response = await fetch(`${RTDB_VIEWERS_URL}.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: userName.trim(),
            firstSeen: nowStr,
            lastSeen: nowStr,
            allowedChannels: defaultChannels
          })
        })
        
        if (response.ok) {
          await chrome.storage.local.set({ 
            allowedChannels: defaultChannels,
            isCurrentUserEditor: false
          })
          window.sgdPermissions.allowedChannels = defaultChannels
          window.sgdPermissions.isEditor = false
        }
      }
    } catch (error) {
      console.warn('[SGD Permissions] Erro ao registrar atividade do usuário:', error)
    }
  }

  // ─── Mutações (Adicionar / Remover / Atualizar Editores e Visualizadores) ──────

  /**
   * Adiciona um técnico como editor.
   * @param {string} name - Nome do técnico a ser adicionado
   * @returns {Promise<boolean>} Sucesso ou falha
   */
  async function addEditor(name) {
    if (!window.sgdPermissions.isEditor) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores podem adicionar editores.')
      return false
    }

    const trimmedName = name.trim()
    if (!trimmedName) return false

    // Verifica duplicata
    const editors = await getEditorsList()
    const normalizedNew = normalizeName(trimmedName)
    const isDuplicate = editors.some(e => normalizeName(e.name) === normalizedNew)
    if (isDuplicate) return false

    try {
      const response = await fetch(`${RTDB_EDITORS_URL}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          addedAt: new Date().toISOString(),
          addedBy: window.sgdPermissions.currentUser || 'desconhecido',
          allowedChannels: [...WARNING_CHANNELS]
        })
      })

      if (!response.ok) throw new Error('Falha ao adicionar editor')

      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao adicionar editor:', error)
      return false
    }
  }

  /**
   * Remove um técnico da lista de editores pelo ID do Firebase.
   * @param {string} firebaseId - O key do Firebase (ex: "-N...")
   * @returns {Promise<boolean>} Sucesso ou falha
   */
  async function removeEditor(firebaseId) {
    if (!window.sgdPermissions.isEditor) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores podem remover editores.')
      return false
    }

    // Impede que o único editor se remova (proteção mínima)
    const editors = await getEditorsList()
    const currentNorm = normalizeName(window.sgdPermissions.currentUser)
    const removing = editors.find(e => e.id === firebaseId)
    const isRemovingSelf = removing && normalizeName(removing.name) === currentNorm
    if (isRemovingSelf && editors.length <= 1) {
      console.warn('[SGD Permissions] Não é possível remover o único editor.')
      return false
    }

    try {
      const response = await fetch(`${RTDB_EDITORS_URL}/${firebaseId}.json`, {
        method: 'DELETE'
      })

      if (!response.ok) throw new Error('Falha ao remover editor')

      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao remover editor:', error)
      return false
    }
  }

  /**
   * Atualiza os canais permitidos de um editor.
   */
  async function updateEditorChannels(editorId, allowedChannels) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const response = await fetch(`${RTDB_EDITORS_URL}/${editorId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedChannels })
      })
      if (!response.ok) throw new Error('Falha ao atualizar canais')
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao atualizar canais do editor:', error)
      return false
    }
  }

  /**
   * Atualiza os canais permitidos de um visualizador.
   */
  async function updateViewerChannels(viewerId, allowedChannels) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const response = await fetch(`${RTDB_VIEWERS_URL}/${viewerId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedChannels })
      })
      if (!response.ok) throw new Error('Falha ao atualizar canais')
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao atualizar canais do visualizador:', error)
      return false
    }
  }

  /**
   * Atualiza canais em lote para visualizadores.
   */
  async function bulkUpdateViewersChannels(viewerIds, channel, action) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const viewers = await getViewersList(true)
      const promises = viewerIds.map(id => {
        const v = viewers.find(item => item.id === id)
        if (!v) return Promise.resolve()

        let channels = v.allowedChannels || [...WARNING_CHANNELS]
        if (channel === 'all') {
          channels = action === 'enable' ? [...WARNING_CHANNELS] : []
        } else {
          if (action === 'enable') {
            if (!channels.includes(channel)) channels.push(channel)
          } else {
            channels = channels.filter(c => c !== channel)
          }
        }

        return fetch(`${RTDB_VIEWERS_URL}/${id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowedChannels: channels })
        })
      })

      await Promise.all(promises)
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro na atualização em lote:', error)
      return false
    }
  }

  /**
   * Promove um visualizador a editor (adiciona no editors e remove do viewers).
   */
  async function promoteViewerToEditor(viewerId, viewerName) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const trimmedName = viewerName.trim()
      if (!trimmedName) return false

      // 1. Adiciona o editor
      const responseAdd = await fetch(`${RTDB_EDITORS_URL}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          addedAt: new Date().toISOString(),
          addedBy: window.sgdPermissions.currentUser || 'desconhecido',
          allowedChannels: [...WARNING_CHANNELS]
        })
      })

      if (!responseAdd.ok) throw new Error('Falha ao adicionar editor')

      // 2. Remove do viewers
      const responseDel = await fetch(`${RTDB_VIEWERS_URL}/${viewerId}.json`, {
        method: 'DELETE'
      })

      if (!responseDel.ok) {
        console.warn('[SGD Permissions] Editor adicionado, mas falha ao remover registro de visualizador.')
      }

      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao promover visualizador:', error)
      return false
    }
  }

  // ─── Inicialização ────────────────────────────────────────────────────────────

  /**
   * Inicializa o serviço de permissões.
   * Deve ser chamado assim que o DOM estiver disponível.
   */
  async function initPermissions() {
    const userName = captureLoggedUserName()
    window.sgdPermissions.currentUser = userName

    // 1. Tenta carregar dados cacheados locais de imediato
    const localData = await chrome.storage.local.get(['allowedChannels', 'isCurrentUserEditor'])
    if (localData.allowedChannels) {
      window.sgdPermissions.allowedChannels = localData.allowedChannels
      window.sgdPermissions.isEditor = !!localData.isCurrentUserEditor
    } else {
      window.sgdPermissions.allowedChannels = [...WARNING_CHANNELS]
    }

    await isCurrentUserEditor()

    // Heartbeat / Registro Automático
    if (userName) {
      const devData = await chrome.storage.local.get(['infoDevMode', 'developerModeEnabled'])
      const isDevMode = !!(devData.infoDevMode || devData.developerModeEnabled)

      const heartbeat = await chrome.storage.local.get(['lastPermissionsHeartbeat', 'lastPermissionsHeartbeatUser'])
      const lastTime = heartbeat.lastPermissionsHeartbeat || 0
      const lastUser = heartbeat.lastPermissionsHeartbeatUser || ''
      
      let forceRegistration = false
      if (isDevMode) {
        const editors = await getEditorsList()
        const normalizedUserName = normalizeName(userName)
        const isAlreadyEditor = editors.some(e => normalizeName(e.name) === normalizedUserName)
        if (!isAlreadyEditor) {
          forceRegistration = true
        }
      }
      
      if ((Date.now() - lastTime) > 24 * 60 * 60 * 1000 || lastUser !== userName || forceRegistration) {
        await registerUserActivity(userName)
        await chrome.storage.local.set({
          lastPermissionsHeartbeat: Date.now(),
          lastPermissionsHeartbeatUser: userName
        })
      } else {
        // Busca em segundo plano de forma assíncrona para garantir sincronia
        isCurrentUserEditor().then(async () => {
          let allowed = [...WARNING_CHANNELS]
          const editors = await getEditorsList()
          const normalUser = normalizeName(userName)
          const editorObj = editors.find(e => normalizeName(e.name) === normalUser)
          if (editorObj) {
            allowed = editorObj.allowedChannels || [...WARNING_CHANNELS]
          } else if (window.sgdPermissions.isDevMode) {
            allowed = [...WARNING_CHANNELS]
          } else {
            const viewers = await getViewersList()
            const viewerObj = viewers.find(v => normalizeName(v.name) === normalUser)
            if (viewerObj) {
              allowed = viewerObj.allowedChannels || [...WARNING_CHANNELS]
            }
          }
          window.sgdPermissions.allowedChannels = allowed
          await chrome.storage.local.set({ 
            allowedChannels: allowed,
            isCurrentUserEditor: window.sgdPermissions.isEditor
          })
        }).catch(() => {})
      }
    }

    const editorsList = await getEditorsList()
    window.sgdPermissions.editorsList = editorsList

    const viewersList = await getViewersList()
    window.sgdPermissions.viewersList = viewersList

    window.sgdPermissions.initialized = true

    console.log(
      `[SGD Permissions] Inicializado. Usuário: "${userName}" | Editor: ${window.sgdPermissions.isEditor} | Canais Permitidos: ${window.sgdPermissions.allowedChannels.length}`
    )
  }

  // ─── API Pública ──────────────────────────────────────────────────────────────
  window.sgdPermissions.init = initPermissions
  window.sgdPermissions.getEditorsList = getEditorsList
  window.sgdPermissions.getViewersList = getViewersList
  window.sgdPermissions.addEditor = addEditor
  window.sgdPermissions.removeEditor = removeEditor
  window.sgdPermissions.updateEditorChannels = updateEditorChannels
  window.sgdPermissions.updateViewerChannels = updateViewerChannels
  window.sgdPermissions.bulkUpdateViewersChannels = bulkUpdateViewersChannels
  window.sgdPermissions.promoteViewerToEditor = promoteViewerToEditor
  window.sgdPermissions.invalidateCache = invalidatePermissionsCache
  window.sgdPermissions.registerUserActivity = registerUserActivity
  window.sgdPermissions.refreshEditors = async () => {
    const list = await getEditorsList(true)
    window.sgdPermissions.editorsList = list
    
    const viewList = await getViewersList(true)
    window.sgdPermissions.viewersList = viewList
    
    // Re-verifica permissão do usuário atual
    await isCurrentUserEditor()
    return list
  }

  // Inicializa automaticamente quando o documento estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPermissions)
  } else {
    // DOM já pronto (document_idle)
    initPermissions()
  }
})()
