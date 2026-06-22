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

  const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com'

  // ─── Estado Global ───────────────────────────────────────────────────────────
  window.sgdPermissions = {
    currentUser: null,    // Nome capturado do SGD
    currentUserId: null,  // ID capturado do SGD (Ex: "776356")
    isEditor: false,      // true se o usuário está na lista de editores
    isMaster: false,      // true se o usuário atual é Master Editor
    role: 'comum',        // cargo do usuário ('master' ou 'comum')
    isDevMode: false,     // true se o modo dev está ativo
    initialized: false,  // true após a primeira verificação
    editorsList: [],      // Lista de editores [{id, name, addedAt, addedBy, allowedChannels, role}]
    viewersList: [],      // Lista de visualizadores [{id, name, firstSeen, lastSeen, allowedChannels}]
    allowedChannels: [],  // Canais permitidos para o usuário atual
    channels: []          // Lista de canais carregados dinamicamente
  }

  function getChannelsFallback() {
    return (window.sgdPermissions && window.sgdPermissions.channels && window.sgdPermissions.channels.length > 0)
      ? [...window.sgdPermissions.channels]
      : [...WARNING_CHANNELS]
  }

  function getViewerAllowedChannels(allowedChannels) {
    const allChs = getChannelsFallback()
    if (!allowedChannels || !Array.isArray(allowedChannels) || allowedChannels.length >= allChs.length) {
      return ['Geral']
    }
    return allowedChannels
  }

  // ─── Captura do Nome e ID do Técnico Logado ──────────────────────────────────

  /**
   * Tenta capturar o ID numérico do usuário logado a partir de links de perfil no DOM.
   * @returns {string|null} ID do usuário ou null se não encontrado
   */
  function captureLoggedUserId() {
    const userLinks = document.querySelectorAll('a[href*="alt-usuario.html"]')
    for (const link of userLinks) {
      const href = link.getAttribute('href')
      if (href) {
        const match = href.match(/[?&]usuario=(\d+)/)
        if (match && match[1]) {
          return match[1]
        }
      }
    }
    return null
  }

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
        allowedChannels: data.allowedChannels || getChannelsFallback(),
        role: data.role || 'comum',
        lastSeen: data.lastSeen || '',
        isEquipeAT: data.isEquipeAT === true
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
        allowedChannels: getViewerAllowedChannels(data.allowedChannels),
        isEquipeAT: data.isEquipeAT === true
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
    const devData = await chrome.storage.local.get(['developerModeEnabled'])
    const isDevMode = devData.developerModeEnabled === true

    if (isDevMode) {
      window.sgdPermissions.isDevMode = true
      window.sgdPermissions.role = 'master'
      window.sgdPermissions.isMaster = true
    }

    const userName = window.sgdPermissions.currentUser
    const userId = window.sgdPermissions.currentUserId

    if (!userName) {
      if (isDevMode) {
        window.sgdPermissions.isEditor = true
        window.sgdPermissions.allowedChannels = getChannelsFallback()
        await chrome.storage.local.set({ 
          allowedChannels: getChannelsFallback(), 
          isCurrentUserEditor: true 
        })
        return true
      }
      return false
    }

    const editors = await getEditorsList()
    const normalizedUserName = normalizeName(userName)

    // 1. Tenta buscar por ID e depois por Nome
    let matchedEditor = null
    if (userId) {
      matchedEditor = editors.find(editor => editor.id === userId)
    }
    if (!matchedEditor) {
      matchedEditor = editors.find(editor => normalizeName(editor.name) === normalizedUserName)
    }

    // Verifica se o usuário tem solicitação de Modo Dev aprovada no Firebase
    const infoDevData = await chrome.storage.local.get(['infoDevMode'])
    const hasLocalInfoDev = infoDevData.infoDevMode === true
    let isApprovedDev = false
    const userKey = userId || cleanFirebaseKey(userName)

    if (hasLocalInfoDev) {
      try {
        const res = await fetch(`${RTDB_BASE_URL}/dev_requests/${userKey}.json`, { cache: 'no-store' })
        if (res.ok) {
          const reqData = await res.json()
          if (reqData && reqData.status === 'approved') {
            isApprovedDev = true
          }
        }
      } catch (err) {
        console.warn('[SGD Permissions] Erro ao verificar solicitação do Modo Dev:', err)
      }
    }

    const found = !!matchedEditor || isDevMode || isApprovedDev
    window.sgdPermissions.isEditor = found
    
    let allowed = getChannelsFallback()
    let role = 'comum'

    if (matchedEditor) {
      allowed = matchedEditor.allowedChannels || getChannelsFallback()
      role = matchedEditor.role || 'comum'
      // Ativa automaticamente o Modo Dev para editores cadastrados
      await chrome.storage.local.set({ 
        infoDevMode: true
      })
      window.sgdPermissions.isDevMode = true
    } else if (isDevMode) {
      allowed = getChannelsFallback()
      role = 'master'
      window.sgdPermissions.isDevMode = true
    } else if (isApprovedDev) {
      // Usuário comum aprovado no modo Dev
      const viewers = await getViewersList()
      let matchedViewer = null
      if (userId) {
        matchedViewer = viewers.find(v => v.id === userId)
      }
      if (!matchedViewer) {
        matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUserName)
      }
      if (matchedViewer) {
        allowed = getViewerAllowedChannels(matchedViewer.allowedChannels)
      } else {
        allowed = ['Geral']
      }
      role = 'comum'
      window.sgdPermissions.isDevMode = true
      await chrome.storage.local.set({ 
        infoDevMode: true
      })
    } else {
      const viewers = await getViewersList()
      let matchedViewer = null
      if (userId) {
        matchedViewer = viewers.find(v => v.id === userId)
      }
      if (!matchedViewer) {
        matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUserName)
      }
      if (matchedViewer) {
        allowed = getViewerAllowedChannels(matchedViewer.allowedChannels)
      } else {
        allowed = ['Geral']
      }
      // Se não é editor nem tem dev mode manual, garante limpeza do infoDevMode
      await chrome.storage.local.set({ 
        infoDevMode: false
      })
      window.sgdPermissions.isDevMode = false
    }
    
    window.sgdPermissions.allowedChannels = allowed
    window.sgdPermissions.role = role
    window.sgdPermissions.isMaster = (role === 'master' || isDevMode)

    await chrome.storage.local.set({ 
      allowedChannels: allowed, 
      isCurrentUserEditor: found 
    })

    // Sincroniza estado de ativação da Equipe AT do Firebase com o storage local
    let isUserEquipeAT = false
    if (matchedEditor) {
      isUserEquipeAT = matchedEditor.isEquipeAT === true
    } else {
      const viewers = await getViewersList()
      let matchedViewer = null
      if (userId) {
        matchedViewer = viewers.find(v => v.id === userId)
      }
      if (!matchedViewer) {
        matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUserName)
      }
      if (matchedViewer) {
        isUserEquipeAT = matchedViewer.isEquipeAT === true
      }
    }
    const currentEquipeATEnabled = (await chrome.storage.local.get(['equipeATEnabled'])).equipeATEnabled === true
    if (isUserEquipeAT !== currentEquipeATEnabled) {
      await chrome.storage.local.set({ equipeATEnabled: isUserEquipeAT })
    }
    
    return found
  }

  /**
   * Sincroniza as configurações remotas do Firebase e as salva no storage local.
   */
  async function syncRemoteConfig() {
    try {
      const response = await fetch(`${RTDB_BASE_URL}/config.json`, { cache: 'no-store' })
      if (response.ok) {
        const remoteConfig = await response.json()
        if (remoteConfig && typeof remoteConfig === 'object') {
          await chrome.storage.local.set({ remoteConfig })
        }
      }
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao sincronizar configurações remotas do Firebase:', e)
    }
  }

  /**
   * Limpa uma string para ser usada com segurança como chave do Firebase.
   * @param {string} str 
   * @returns {string}
   */
  function cleanFirebaseKey(str) {
    if (!str) return 'unknown_user'
    return str
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
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
    const userId = window.sgdPermissions.currentUserId
    const userKey = userId || cleanFirebaseKey(userName)
    
    try {
      // 1. Busca listas atualizadas
      const editors = await getEditorsList(true)
      let matchedEditor = null
      if (userId) {
        matchedEditor = editors.find(e => e.id === userId)
      }
      if (!matchedEditor) {
        matchedEditor = editors.find(e => normalizeName(e.name) === normalizedUser)
      }
      
      if (matchedEditor) {
        // Atualiza lastSeen do editor no Firebase
        await fetch(`${RTDB_EDITORS_URL}/${matchedEditor.id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lastSeen: nowStr })
        })
        
        const allowed = matchedEditor.allowedChannels || getChannelsFallback()
        const existingRole = matchedEditor.role || 'comum'
        await chrome.storage.local.set({ 
          allowedChannels: allowed,
          isCurrentUserEditor: true
        })
        window.sgdPermissions.allowedChannels = allowed
        window.sgdPermissions.isEditor = true
        window.sgdPermissions.role = existingRole
        window.sgdPermissions.isMaster = (existingRole === 'master')
        return
      }
      
      const viewers = await getViewersList(true)
      let matchedViewer = null
      if (userId) {
        matchedViewer = viewers.find(v => v.id === userId)
      }
      if (!matchedViewer) {
        matchedViewer = viewers.find(v => normalizeName(v.name) === normalizedUser)
      }
      
      if (matchedViewer) {
        const allowed = getViewerAllowedChannels(matchedViewer.allowedChannels)
        const patchData = { lastSeen: nowStr }
        
        const allChs = getChannelsFallback()
        if (matchedViewer.allowedChannels && Array.isArray(matchedViewer.allowedChannels) && matchedViewer.allowedChannels.length >= allChs.length) {
          patchData.allowedChannels = allowed
        }

        // Atualiza lastSeen do visualizador
        await fetch(`${RTDB_VIEWERS_URL}/${matchedViewer.id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchData)
        })
        
        await chrome.storage.local.set({ 
          allowedChannels: allowed,
          isCurrentUserEditor: false
        })
        window.sgdPermissions.allowedChannels = allowed
        window.sgdPermissions.isEditor = false
      } else {
        // Cadastra novo visualizador via PUT usando a chave gerada por userId
        const defaultChannels = ['Geral']
        const response = await fetch(`${RTDB_VIEWERS_URL}/${userKey}.json`, {
          method: 'PUT',
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
   * Grava um log de auditoria no Firebase RTDB.
   * @param {string} action - Nome da ação executada
   * @param {string} target - Alvo da ação (ex: nome do usuário ou título do aviso)
   * @param {string} details - Detalhes adicionais (opcional)
   */
  async function writeAuditLog(action, target, details = '') {
    try {
      const operatorId = window.sgdPermissions.currentUserId || 'unknown_id'
      const operatorName = window.sgdPermissions.currentUser || 'Desconhecido'
      const timestamp = new Date().toISOString()
      
      await fetch(`${RTDB_BASE_URL}/audit_logs.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId,
          operatorName,
          action,
          target,
          details,
          timestamp
        })
      })
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao gravar log de auditoria:', e)
    }
  }

  /**
   * Obtém os logs de auditoria do Firebase RTDB.
   * @returns {Promise<Array>}
   */
  async function getAuditLogs() {
    try {
      const response = await fetch(`${RTDB_BASE_URL}/audit_logs.json?orderBy="timestamp"&limitToLast=100`, { cache: 'no-store' })
      if (!response.ok) return []
      const result = await response.json()
      if (!result || typeof result !== 'object') return []
      
      const logs = Object.entries(result).map(([id, data]) => ({
        id,
        ...data
      }))
      logs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      return logs
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao carregar logs de auditoria:', e)
      return []
    }
  }

  /**
   * Adiciona um técnico como editor.
   * @param {string} name - Nome do técnico a ser adicionado
   * @param {string} userId - ID do técnico a ser adicionado (opcional)
   * @returns {Promise<boolean>} Sucesso ou falha
   */
  async function addEditor(name, userId = '') {
    if (!window.sgdPermissions.isMaster) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores master podem adicionar editores.')
      return false
    }

    const trimmedName = name.trim()
    if (!trimmedName) return false

    const targetKey = userId || cleanFirebaseKey(trimmedName)

    // Verifica duplicata
    const editors = await getEditorsList()
    const normalizedNew = normalizeName(trimmedName)
    const isDuplicate = editors.some(e => normalizeName(e.name) === normalizedNew || e.id === targetKey)
    if (isDuplicate) return false

    try {
      const response = await fetch(`${RTDB_EDITORS_URL}/${targetKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          addedAt: new Date().toISOString(),
          addedBy: window.sgdPermissions.currentUser || 'desconhecido',
          allowedChannels: getChannelsFallback(),
          role: 'comum'
        })
      })

      if (!response.ok) throw new Error('Falha ao adicionar editor')

      await writeAuditLog('ADD_EDITOR', trimmedName, `ID: ${targetKey}, Cargo: comum`)
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao adicionar editor:', error)
      return false
    }
  }

  /**
   * Remove um técnico da lista de editores pelo ID do Firebase.
   * @param {string} firebaseId - O key do Firebase (ex: "776356" ou "-N...")
   * @returns {Promise<boolean>} Sucesso ou falha
   */
  async function removeEditor(firebaseId) {
    if (!window.sgdPermissions.isMaster) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores master podem remover editores.')
      return false
    }

    const editors = await getEditorsList()
    const currentNorm = normalizeName(window.sgdPermissions.currentUser)
    const currentUserId = window.sgdPermissions.currentUserId
    
    const removing = editors.find(e => e.id === firebaseId)
    if (!removing) return false

    const isRemovingSelf = firebaseId === currentUserId || normalizeName(removing.name) === currentNorm
    if (isRemovingSelf && editors.length <= 1) {
      console.warn('[SGD Permissions] Não é possível remover o único editor.')
      return false
    }

    try {
      const response = await fetch(`${RTDB_EDITORS_URL}/${firebaseId}.json`, {
        method: 'DELETE'
      })

      if (!response.ok) throw new Error('Falha ao remover editor')

      // Adiciona o usuário removido de volta à lista de visualizadores
      const nowStr = new Date().toISOString()
      const viewerData = {
        name: removing.name.trim(),
        firstSeen: removing.addedAt || nowStr,
        lastSeen: removing.lastSeen || nowStr,
        allowedChannels: getViewerAllowedChannels(removing.allowedChannels),
        isEquipeAT: removing.isEquipeAT === true
      }

      try {
        const responseViewer = await fetch(`${RTDB_VIEWERS_URL}/${firebaseId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viewerData)
        })
        if (!responseViewer.ok) {
          console.warn('[SGD Permissions] Editor removido, mas falha ao recriar registro como visualizador.')
        }
      } catch (errViewer) {
        console.warn('[SGD Permissions] Erro ao cadastrar visualizador pós-remoção:', errViewer)
      }

      await writeAuditLog('REMOVE_EDITOR', removing.name, `ID: ${firebaseId}`)
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
    if (!window.sgdPermissions.isMaster) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores master podem alterar canais de editores.')
      return false
    }
    try {
      const editors = await getEditorsList()
      const editorObj = editors.find(e => e.id === editorId)
      const name = editorObj ? editorObj.name : 'Desconhecido'

      const response = await fetch(`${RTDB_EDITORS_URL}/${editorId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedChannels })
      })
      if (!response.ok) throw new Error('Falha ao atualizar canais')
      
      await writeAuditLog('UPDATE_EDITOR_CHANNELS', name, `Canais: ${allowedChannels.join(', ') || 'Nenhum'}`)
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao atualizar canais do editor:', error)
      return false
    }
  }

  /**
   * Atualiza o cargo de um editor (Master vs Comum).
   */
  async function updateEditorRole(editorId, role) {
    if (!window.sgdPermissions.isMaster) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores master podem alterar cargos.')
      return false
    }
    try {
      const editors = await getEditorsList()
      const editorObj = editors.find(e => e.id === editorId)
      const name = editorObj ? editorObj.name : 'Desconhecido'

      const response = await fetch(`${RTDB_EDITORS_URL}/${editorId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      })
      if (!response.ok) throw new Error('Falha ao atualizar cargo')

      await writeAuditLog('UPDATE_EDITOR_ROLE', name, `Cargo: ${role}`)
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao atualizar cargo do editor:', error)
      return false
    }
  }

  /**
   * Atualiza os canais permitidos de um visualizador.
   */
  async function updateViewerChannels(viewerId, allowedChannels) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const viewers = await getViewersList()
      const viewerObj = viewers.find(v => v.id === viewerId)
      const name = viewerObj ? viewerObj.name : 'Desconhecido'

      const response = await fetch(`${RTDB_VIEWERS_URL}/${viewerId}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedChannels })
      })
      if (!response.ok) throw new Error('Falha ao atualizar canais')

      await writeAuditLog('UPDATE_VIEWER_CHANNELS', name, `Canais: ${allowedChannels.join(', ') || 'Nenhum'}`)
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

        let channels = getViewerAllowedChannels(v.allowedChannels)
        if (channel === 'all') {
          channels = action === 'enable' ? getChannelsFallback() : ['Geral']
        } else {
          if (action === 'enable') {
            if (!channels.includes(channel)) channels.push(channel)
          } else {
            channels = channels.filter(c => c !== channel)
          }
        }
        if (!channels.includes('Geral')) {
          channels.unshift('Geral')
        }

        return fetch(`${RTDB_VIEWERS_URL}/${id}.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowedChannels: channels })
        })
      })

      await Promise.all(promises)
      await writeAuditLog('BULK_UPDATE_VIEWERS_CHANNELS', `${viewerIds.length} usuários`, `Canal: ${channel}, Ação: ${action}`)
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro na atualização em lote:', error)
      return false
    }
  }

  /**
   * Promove um visualizador a editor.
   */
  async function promoteViewerToEditor(viewerId, viewerName, role = 'comum') {
    if (!window.sgdPermissions.isMaster) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores master podem promover usuários.')
      return false
    }
    try {
      const trimmedName = viewerName.trim()
      if (!trimmedName) return false

      // 1. Adiciona o editor usando o viewerId como chave via PUT
      const viewers = await getViewersList()
      const viewerObj = viewers.find(v => v.id === viewerId)
      const isEquipeAT = viewerObj ? viewerObj.isEquipeAT === true : false

      const responseAdd = await fetch(`${RTDB_EDITORS_URL}/${viewerId}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          addedAt: new Date().toISOString(),
          addedBy: window.sgdPermissions.currentUser || 'desconhecido',
          allowedChannels: getChannelsFallback(),
          role: role,
          isEquipeAT: isEquipeAT
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

      await writeAuditLog('PROMOTE_EDITOR', trimmedName, `ID: ${viewerId}, Cargo: ${role}`)
      await invalidatePermissionsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao promover visualizador:', error)
      return false
    }
  }

  // Perfis de Canais CRUD
  async function getChannelProfiles() {
    try {
      const response = await fetch(`${RTDB_BASE_URL}/permissions/channel_profiles.json`, { cache: 'no-store' })
      if (!response.ok) return []
      const result = await response.json()
      if (!result || typeof result !== 'object') return []
      return Object.entries(result).map(([id, data]) => ({
        id,
        name: data.name || '',
        channels: data.channels || []
      }))
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao buscar perfis de canais:', e)
      return []
    }
  }

  async function saveChannelProfile(name, channels) {
    if (!window.sgdPermissions.isEditor) return false
    const key = cleanFirebaseKey(name)
    try {
      const response = await fetch(`${RTDB_BASE_URL}/permissions/channel_profiles/${key}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, channels })
      })
      if (response.ok) {
        await writeAuditLog('SAVE_CHANNEL_PROFILE', name, `Canais: ${channels.join(', ')}`)
        return true
      }
      return false
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao salvar perfil de canais:', e)
      return false
    }
  }

  async function deleteChannelProfile(profileId) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const response = await fetch(`${RTDB_BASE_URL}/permissions/channel_profiles/${profileId}.json`, {
        method: 'DELETE'
      })
      if (response.ok) {
        await writeAuditLog('DELETE_CHANNEL_PROFILE', profileId)
        return true
      }
      return false
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao excluir perfil de canais:', e)
      return false
    }
  }

  // Grupos de Visualizadores CRUD (Armazenamento Local)
  async function getViewerGroups() {
    try {
      const local = await chrome.storage.local.get(['viewerGroups'])
      return local.viewerGroups || []
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao buscar grupos de visualizadores do storage local:', e)
      return []
    }
  }

  async function saveViewerGroup(name, viewers) {
    if (!window.sgdPermissions.isEditor) return false
    const key = cleanFirebaseKey(name)
    try {
      const local = await chrome.storage.local.get(['viewerGroups'])
      let groups = local.viewerGroups || []
      groups = groups.filter(g => g.id !== key)
      groups.push({ id: key, name, viewers })
      await chrome.storage.local.set({ viewerGroups: groups })
      await writeAuditLog('SAVE_VIEWER_GROUP_LOCAL', name, `Visualizadores: ${viewers.length} usuários`)
      return true
    } catch (err) {
      console.error('[SGD Permissions] Erro ao salvar grupo localmente:', err)
      return false
    }
  }

  async function deleteViewerGroup(groupId) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      const local = await chrome.storage.local.get(['viewerGroups'])
      let groups = local.viewerGroups || []
      groups = groups.filter(g => g.id !== groupId)
      await chrome.storage.local.set({ viewerGroups: groups })
      await writeAuditLog('DELETE_VIEWER_GROUP_LOCAL', groupId)
      return true
    } catch (err) {
      console.error('[SGD Permissions] Erro ao excluir grupo localmente:', err)
      return false
    }
  }

  // Canais Dinâmicos CRUD
  async function loadActiveChannels() {
    try {
      const response = await fetch(`${RTDB_BASE_URL}/permissions/channels.json`, { cache: 'no-store' })
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data) && data.length > 0) {
          window.sgdPermissions.channels = data
          await chrome.storage.local.set({ warningChannels: data })
          return data
        }
      }
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao buscar canais do Firebase:', e)
    }
    // Fallback para storage local ou constante global WARNING_CHANNELS
    const stored = await chrome.storage.local.get(['warningChannels'])
    const list = stored.warningChannels || [...WARNING_CHANNELS]
    window.sgdPermissions.channels = list
    return list
  }

  async function saveActiveChannels(channelsList) {
    if (!window.sgdPermissions.isEditor || window.sgdPermissions.role !== 'master') return false
    try {
      const response = await fetch(`${RTDB_BASE_URL}/permissions/channels.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channelsList)
      })
      if (response.ok) {
        window.sgdPermissions.channels = channelsList
        await chrome.storage.local.set({ warningChannels: channelsList })
        await writeAuditLog('UPDATE_CHANNELS', 'Canais', `Novos canais: ${channelsList.join(', ')}`)
        return true
      }
      return false
    } catch (e) {
      console.error('[SGD Permissions] Erro ao salvar canais:', e)
      return false
    }
  }

  /**
   * Alterna o status da Equipe AT de um usuário no Firebase.
   */
  async function toggleUserEquipeAT(userId, isEditor, currentStatus) {
    if (!window.sgdPermissions.isEditor) return false
    const url = isEditor ? `${RTDB_EDITORS_URL}/${userId}.json` : `${RTDB_VIEWERS_URL}/${userId}.json`
    const targetStatus = !currentStatus
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEquipeAT: targetStatus })
      })
      if (response.ok) {
        const listName = isEditor ? 'editores' : 'visualizadores'
        await writeAuditLog('TOGGLE_EQUIPE_AT', userId, `Ação: ${targetStatus ? 'Ativar' : 'Desativar'} na Equipe AT (${listName})`)
        await invalidatePermissionsCache()
        return true
      }
      return false
    } catch (e) {
      console.error('[SGD Permissions] Erro ao toggle Equipe AT:', e)
      return false
    }
  }

  // ─── Inicialização ────────────────────────────────────────────────────────────

  /**
   * Inicializa o serviço de permissões.
   * Deve ser chamado assim que o DOM estiver disponível.
   */
  async function initPermissions() {
    // Sincroniza configurações remotas em segundo plano
    syncRemoteConfig().catch(err => console.warn('[SGD Permissions] Falha ao sincronizar configs:', err))

    const userName = captureLoggedUserName()
    const userId = captureLoggedUserId()
    window.sgdPermissions.currentUser = userName
    window.sgdPermissions.currentUserId = userId
    if (userName) {
      chrome.storage.local.set({ currentUser: userName }).catch(() => {});
    }

    // Carrega canais dinâmicos antes de mais nada
    await loadActiveChannels()

    // 1. Tenta carregar dados cacheados locais de imediato
    const localData = await chrome.storage.local.get(['allowedChannels', 'isCurrentUserEditor'])
    if (localData.allowedChannels) {
      window.sgdPermissions.allowedChannels = localData.allowedChannels
      window.sgdPermissions.isEditor = !!localData.isCurrentUserEditor
    } else {
      window.sgdPermissions.allowedChannels = getChannelsFallback()
    }

    await isCurrentUserEditor()

    // Heartbeat / Registro Automático
    if (userName) {
      const heartbeat = await chrome.storage.local.get(['lastPermissionsHeartbeat', 'lastPermissionsHeartbeatUser'])
      const lastTime = heartbeat.lastPermissionsHeartbeat || 0
      const lastUser = heartbeat.lastPermissionsHeartbeatUser || ''
      
      if ((Date.now() - lastTime) > 24 * 60 * 60 * 1000 || lastUser !== userName) {
        await registerUserActivity(userName)
        await chrome.storage.local.set({
          lastPermissionsHeartbeat: Date.now(),
          lastPermissionsHeartbeatUser: userName
        })
      } else {
        // Busca em segundo plano de forma assíncrona para garantir sincronia
        isCurrentUserEditor().then(async () => {
          let allowed = getChannelsFallback()
          const editors = await getEditorsList()
          const normalUser = normalizeName(userName)
          
          let editorObj = null
          if (userId) {
            editorObj = editors.find(e => e.id === userId)
          }
          if (!editorObj) {
            editorObj = editors.find(e => normalizeName(e.name) === normalUser)
          }

          if (editorObj) {
            allowed = editorObj.allowedChannels || getChannelsFallback()
          } else if (window.sgdPermissions.isDevMode) {
            allowed = getChannelsFallback()
          } else {
            const viewers = await getViewersList()
            let viewerObj = null
            if (userId) {
              viewerObj = viewers.find(v => v.id === userId)
            }
            if (!viewerObj) {
              viewerObj = viewers.find(v => normalizeName(v.name) === normalUser)
            }
            if (viewerObj) {
              allowed = getViewerAllowedChannels(viewerObj.allowedChannels)
            } else {
              allowed = ['Geral']
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
  window.sgdPermissions.updateEditorRole = updateEditorRole
  window.sgdPermissions.updateViewerChannels = updateViewerChannels
  window.sgdPermissions.bulkUpdateViewersChannels = bulkUpdateViewersChannels
  window.sgdPermissions.promoteViewerToEditor = promoteViewerToEditor
  window.sgdPermissions.invalidateCache = invalidatePermissionsCache
  window.sgdPermissions.registerUserActivity = registerUserActivity
  window.sgdPermissions.getChannelProfiles = getChannelProfiles
  window.sgdPermissions.saveChannelProfile = saveChannelProfile
  window.sgdPermissions.deleteChannelProfile = deleteChannelProfile
  window.sgdPermissions.getViewerGroups = getViewerGroups
  window.sgdPermissions.saveViewerGroup = saveViewerGroup
  window.sgdPermissions.deleteViewerGroup = deleteViewerGroup
  window.sgdPermissions.loadActiveChannels = loadActiveChannels
  window.sgdPermissions.saveActiveChannels = saveActiveChannels
  window.sgdPermissions.getAuditLogs = getAuditLogs
  window.sgdPermissions.writeAuditLog = writeAuditLog
  window.sgdPermissions.toggleUserEquipeAT = toggleUserEquipeAT
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
