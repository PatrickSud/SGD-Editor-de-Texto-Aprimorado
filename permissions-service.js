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
    isMaster: false,      // true se o usuário atual é Master Editor (inclui bypass do Modo Dev)
    isMasterEditor: false,// true SOMENTE se o cargo real cadastrado for 'master' (sem bypass do Modo Dev)
    role: 'comum',        // cargo do usuário ('master' ou 'comum')
    isDevMode: false,     // true se o modo dev está ativo
    initialized: false,  // true após a primeira verificação
    editorsList: [],      // Lista de editores [{id, name, addedAt, addedBy, allowedChannels, role}]
    viewersList: [],      // Lista de visualizadores [{id, name, firstSeen, lastSeen, allowedChannels}]
    allowedChannels: [],  // Canais permitidos para o usuário atual
    channels: []          // Lista de canais carregados dinamicamente
  }

  function normalizeAllowedChannels(channels) {
    if (!channels || !Array.isArray(channels)) return channels
    return channels.map(c => c === 'Onvio Processos/Messenger' ? 'Dominio Processos/Messenger' : c)
  }

  function getChannelsFallback() {
    return (window.sgdPermissions && window.sgdPermissions.channels && window.sgdPermissions.channels.length > 0)
      ? [...window.sgdPermissions.channels]
      : [...WARNING_CHANNELS]
  }

  function getViewerAllowedChannels(allowedChannels) {
    const allChs = getChannelsFallback()
    const normalized = normalizeAllowedChannels(allowedChannels)
    if (!normalized || !Array.isArray(normalized) || normalized.length >= allChs.length) {
      return ['Geral']
    }
    return normalized
  }

  // ─── Captura do Nome e ID do Técnico Logado ──────────────────────────────────

  /**
   * Tenta capturar o ID numérico do usuário logado a partir de links de perfil no DOM.
   * @returns {string|null} ID do usuário ou null se não encontrado
   */
  function captureLoggedUserId() {
    console.log('[SGD Permissions] Iniciando captura do ID de usuário logado...');
    const userLinks = document.querySelectorAll('a[href*="alt-usuario.html"]')
    console.log('[SGD Permissions] Elementos a[href*="alt-usuario.html"] encontrados:', userLinks.length)
    for (const link of userLinks) {
      const href = link.getAttribute('href')
      console.log('[SGD Permissions] Verificando link href:', href)
      if (href) {
        const match = href.match(/[?&]usuario=(\d+)/)
        if (match && match[1]) {
          console.log('[SGD Permissions] ID de usuário capturado com sucesso:', match[1])
          return match[1]
        }
      }
    }
    // Fallback: Tenta procurar no DOM inteiro por qualquer link contendo alt-usuario.html
    console.log('[SGD Permissions] ID não encontrado nos links específicos. Tentando fallback no DOM...')
    const allLinks = document.querySelectorAll('a')
    for (const link of allLinks) {
      const href = link.getAttribute('href') || ''
      if (href.includes('alt-usuario.html')) {
        const match = href.match(/[?&]usuario=(\d+)/)
        if (match && match[1]) {
          console.log('[SGD Permissions] ID de usuário capturado no fallback:', match[1])
          return match[1]
        }
      }
    }
    console.warn('[SGD Permissions] Falha ao capturar ID de usuário logado (todos os seletores retornaram null)')
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

  /**
   * Tenta capturar a unidade do usuário conectando no link alt-usuario.html em background.
   * @param {string} userId - ID do usuário no SGD.
   * @returns {Promise<string|null>} Nome da unidade ou null se falhar.
   */
  async function fetchLoggedUserUnidade(userId) {
    if (!userId) {
      console.warn('[SGD Permissions] fetchLoggedUserUnidade abortado: userId está nulo ou indefinido')
      return null
    }
    
    // Evita consultas excessivas em caso de falhas repetidas (cooldown de 30 minutos)
    try {
      const cache = await chrome.storage.local.get(['lastUnitFetchAttempt'])
      const lastAttempt = cache.lastUnitFetchAttempt || 0
      const cooldownMs = 30 * 60 * 1000 // 30 minutos
      if (Date.now() - lastAttempt < cooldownMs) {
        console.log('[SGD Permissions] Captura de unidade ignorada temporariamente (cooldown de retentativas ativo)')
        return null
      }
      await chrome.storage.local.set({ lastUnitFetchAttempt: Date.now() })
    } catch (_) {}

    console.log('[SGD Permissions] Buscando unidade para o usuário:', userId)
    try {
      // Se já estivermos na própria página do perfil, lemos do DOM diretamente
      if (window.location.href.includes('alt-usuario.html') && window.location.href.includes(`usuario=${userId}`)) {
        console.log('[SGD Permissions] Já estamos na página de alteração do usuário, lendo do DOM...')
        const labels = document.querySelectorAll('td.tableCadastroLabel')
        for (const label of labels) {
          if (label.textContent.trim().startsWith('Unidade:')) {
            const field = label.nextElementSibling
            if (field) {
              const bold = field.querySelector('b')
              const unitName = bold ? bold.textContent.trim() : field.textContent.trim()
              console.log('[SGD Permissions] Unidade capturada do DOM da página atual:', unitName)
              if (unitName) return unitName
            }
          }
        }
      }

      const url = `/comum/faces/alt-usuario.html?usuario=${userId}&cadastro=1`
      console.log('[SGD Permissions] Executando fetch em background para:', url)
      const response = await fetch(url)
      console.log('[SGD Permissions] Fetch background status:', response.status, response.statusText)
      if (!response.ok) return null
      
      const htmlText = await response.text()
      console.log('[SGD Permissions] HTML retornado pelo fetch. Tamanho:', htmlText.length)
      
      const parser = new DOMParser()
      const doc = parser.parseFromString(htmlText, 'text/html')
      const labels = doc.querySelectorAll('td.tableCadastroLabel')
      console.log('[SGD Permissions] td.tableCadastroLabel encontrados no documento:', labels.length)
      
      for (const label of labels) {
        const text = label.textContent.trim()
        if (text.startsWith('Unidade:')) {
          console.log('[SGD Permissions] Label "Unidade:" encontrado.')
          const field = label.nextElementSibling
          if (field) {
            const bold = field.querySelector('b')
            const unitName = bold ? bold.textContent.trim() : field.textContent.trim()
            console.log('[SGD Permissions] Unidade obtida do HTML parseado:', unitName)
            if (unitName) return unitName
          } else {
            console.warn('[SGD Permissions] Próximo elemento irmão da label Unidade não existe')
          }
        }
      }
      
      // Fallback secundário: buscar qualquer td após a palavra "Unidade:"
      console.log('[SGD Permissions] Tentando fallback para encontrar unidade no HTML parseado...')
      const tds = doc.querySelectorAll('td')
      for (let i = 0; i < tds.length; i++) {
        if (tds[i].textContent.trim().startsWith('Unidade:')) {
          if (i + 1 < tds.length) {
            const field = tds[i+1]
            const bold = field.querySelector('b')
            const unitName = bold ? bold.textContent.trim() : field.textContent.trim()
            console.log('[SGD Permissions] Unidade obtida no fallback secundário:', unitName)
            if (unitName) return unitName
          }
        }
      }
      
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao buscar unidade do usuário em background:', e)
    }
    console.warn('[SGD Permissions] Não foi possível encontrar a unidade do usuário.')
    return null
  }

  // ─── Cache e Fetch dos Editores e Visualizadores ─────────────────────────────

  function getPathFromUrl(url) {
    if (!url) return '';
    if (url.startsWith('/')) return url;
    return url.replace(RTDB_BASE_URL, '');
  }

  async function callDatabaseRead(url) {
    const path = getPathFromUrl(url);
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'READ_PERMISSIONS_ACTION',
        path: path
      });
      if (response && response.success) {
        return {
          ok: true,
          json: async () => response.data
        };
      }
      throw new Error(response ? response.error : 'Erro na resposta do SW');
    } catch (e) {
      return fetch(url, { cache: 'no-store' });
    }
  }

  async function callDatabaseWrite(url, method, data) {
    const path = getPathFromUrl(url);
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'WRITE_PERMISSIONS_ACTION',
        path: path,
        method: method,
        data: data
      });
      if (response && response.success) {
        return {
          ok: true,
          json: async () => response.data
        };
      }
      throw new Error(response ? response.error : 'Erro na resposta do SW');
    } catch (e) {
      const options = { method };
      if (data) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(data);
      }
      return fetch(url, options);
    }
  }

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

      const response = await callDatabaseRead(`${RTDB_EDITORS_URL}.json`)
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

      const editorsList = Object.entries(result).map(([id, data]) => 
        normalizeEditorRecord({ id, ...data })
      )

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

      const response = await callDatabaseRead(`${RTDB_VIEWERS_URL}.json`)
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

      const viewersList = Object.entries(result).map(([id, data]) => 
        normalizeViewerRecord({ id, ...data })
      )

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

  // ─── Leitura Individual do Registro do Usuário ────────────────────────────────
  // Em vez de baixar a lista completa de editores/visualizadores (~centenas de
  // registros) só para classificar o usuário atual, lemos diretamente o registro
  // dele pela chave (userId ou chave derivada do nome). Reduz drasticamente o
  // download do RTDB e mantém os dados sempre frescos (sem depender de cache).

  function normalizeEditorRecord(rec) {
    return {
      id: rec.id,
      name: rec.name || '',
      addedAt: rec.addedAt || '',
      addedBy: rec.addedBy || '',
      allowedChannels: normalizeAllowedChannels(rec.allowedChannels) || getChannelsFallback(),
      role: rec.role || 'comum',
      lastSeen: rec.lastSeen || '',
      isEquipeAT: rec.isEquipeAT === true,
      unidade: rec.unidade || '',
      regiao: rec.regiao || '',
      iagenteDisabled: rec.iagenteDisabled === true,
      iagenteIA_Enabled: rec.iagenteIA_Enabled === true,
      duplicateIA_Enabled: rec.duplicateIA_Enabled === true,
      duplicateIA_Disabled: rec.duplicateIA_Disabled === true
    }
  }

  function normalizeViewerRecord(rec) {
    return {
      id: rec.id,
      name: rec.name || '',
      firstSeen: rec.firstSeen || '',
      lastSeen: rec.lastSeen || '',
      allowedChannels: getViewerAllowedChannels(rec.allowedChannels),
      isEquipeAT: rec.isEquipeAT === true,
      unidade: rec.unidade || '',
      regiao: rec.regiao || '',
      iagenteDisabled: rec.iagenteDisabled === true,
      iagenteIA_Enabled: rec.iagenteIA_Enabled === true,
      duplicateIA_Enabled: rec.duplicateIA_Enabled === true,
      duplicateIA_Disabled: rec.duplicateIA_Disabled === true
    }
  }

  /**
   * Lê o registro do próprio usuário em um nó (editors/viewers) pela chave.
   * Tenta primeiro por userId (exato) e depois pela chave derivada do nome,
   * validando o nome neste caso para evitar colisões.
   * @returns {Promise<object|null>} registro bruto {id, ...} ou null
   */
  async function readOwnRecord(baseUrl, userId, userName) {
    const normalizedTarget = normalizeName(userName)
    if (userId) {
      try {
        const res = await callDatabaseRead(`${baseUrl}/${userId}.json`)
        if (res.ok) {
          const data = await res.json()
          if (data && typeof data === 'object') return { id: userId, ...data }
        }
      } catch (_) {}
    }
    const nameKey = cleanFirebaseKey(userName)
    if (nameKey && nameKey !== userId) {
      try {
        const res = await callDatabaseRead(`${baseUrl}/${nameKey}.json`)
        if (res.ok) {
          const data = await res.json()
          if (data && typeof data === 'object' && normalizeName(data.name) === normalizedTarget) {
            return { id: nameKey, ...data }
          }
        }
      } catch (_) {}
    }
    return null
  }

  /**
   * Localiza o registro de editor do usuário: leitura individual primeiro,
   * com fallback para a lista cacheada (preserva o matching original por nome).
   */
  async function matchEditorRecord(userId, userName, normalizedUserName) {
    const rec = await readOwnRecord(RTDB_EDITORS_URL, userId, userName)
    if (rec) return normalizeEditorRecord(rec)
    const editors = await getEditorsList()
    let m = null
    if (userId) m = editors.find(e => e.id === userId)
    if (!m) m = editors.find(e => normalizeName(e.name) === normalizedUserName)
    return m || null
  }

  /**
   * Localiza o registro de visualizador do usuário: leitura individual primeiro,
   * com fallback para a lista cacheada.
   */
  async function matchViewerRecord(userId, userName, normalizedUserName) {
    const rec = await readOwnRecord(RTDB_VIEWERS_URL, userId, userName)
    if (rec) return normalizeViewerRecord(rec)
    const viewers = await getViewersList()
    let m = null
    if (userId) m = viewers.find(v => v.id === userId)
    if (!m) m = viewers.find(v => normalizeName(v.name) === normalizedUserName)
    return m || null
  }

  // ─── Verificação de Editor ────────────────────────────────────────────────────

  // As chamadas a normalizeName agora utilizam a função global declarada em utils.js

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

    const normalizedUserName = normalizeName(userName)

    // 1. Busca o registro do próprio usuário (leitura individual barata, com
    //    fallback para a lista cacheada) — evita baixar a lista completa de editores.
    let matchedEditor = await matchEditorRecord(userId, userName, normalizedUserName)
    // Reaproveitado adiante (ex.: sincronização da Equipe AT) para evitar leituras repetidas.
    let matchedViewer = null

    // Verifica se o usuário tem solicitação de Modo Dev aprovada no Firebase
    const infoDevData = await chrome.storage.local.get(['infoDevMode'])
    const hasLocalInfoDev = infoDevData.infoDevMode === true
    let isApprovedDev = false
    const userKey = userId || cleanFirebaseKey(userName)

    if (hasLocalInfoDev) {
      try {
        const res = await callDatabaseRead(`${RTDB_BASE_URL}/dev_requests/${userKey}.json`)
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
      // Se não tem unidade no Firebase, tenta buscar agora mesmo!
      if (!matchedEditor.unidade && userId) {
        console.log('[SGD Permissions] Unidade não encontrada no matchedEditor. Buscando agora...')
        const unit = await fetchLoggedUserUnidade(userId)
        if (unit) {
          matchedEditor.unidade = unit
          await chrome.storage.local.set({ userUnidade: unit })
          await callDatabaseWrite(`${RTDB_EDITORS_URL}/${matchedEditor.id}.json`, 'PATCH', { unidade: unit })
          console.log('[SGD Permissions] Unidade salva com sucesso para Editor no Firebase:', unit)
        }
      } else if (matchedEditor.unidade) {
        await chrome.storage.local.set({ userUnidade: matchedEditor.unidade })
      }
    } else if (isDevMode) {
      allowed = getChannelsFallback()
      role = 'master'
      window.sgdPermissions.isDevMode = true
    } else if (isApprovedDev) {
      // Usuário comum aprovado no modo Dev
      matchedViewer = await matchViewerRecord(userId, userName, normalizedUserName)
      if (matchedViewer) {
        allowed = getViewerAllowedChannels(matchedViewer.allowedChannels)
        // Se não tem unidade no Firebase, tenta buscar agora mesmo!
        if (!matchedViewer.unidade && userId) {
          console.log('[SGD Permissions] Unidade não encontrada no matchedViewer (Approved Dev). Buscando agora...')
          const unit = await fetchLoggedUserUnidade(userId)
          if (unit) {
            matchedViewer.unidade = unit
            await chrome.storage.local.set({ userUnidade: unit })
            await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${matchedViewer.id}.json`, 'PATCH', { unidade: unit })
            console.log('[SGD Permissions] Unidade salva com sucesso para Viewer no Firebase:', unit)
          }
        } else if (matchedViewer.unidade) {
          await chrome.storage.local.set({ userUnidade: matchedViewer.unidade })
        }
      } else {
        allowed = ['Geral']
      }
      role = 'comum'
      window.sgdPermissions.isDevMode = true
      await chrome.storage.local.set({ 
        infoDevMode: true
      })
    } else {
      matchedViewer = await matchViewerRecord(userId, userName, normalizedUserName)
      if (matchedViewer) {
        allowed = getViewerAllowedChannels(matchedViewer.allowedChannels)
        // Se não tem unidade no Firebase, tenta buscar agora mesmo!
        if (!matchedViewer.unidade && userId) {
          console.log('[SGD Permissions] Unidade não encontrada no matchedViewer. Buscando agora...')
          const unit = await fetchLoggedUserUnidade(userId)
          if (unit) {
            matchedViewer.unidade = unit
            await chrome.storage.local.set({ userUnidade: unit })
            await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${matchedViewer.id}.json`, 'PATCH', { unidade: unit })
            console.log('[SGD Permissions] Unidade salva com sucesso para Viewer no Firebase:', unit)
          }
        } else if (matchedViewer.unidade) {
          await chrome.storage.local.set({ userUnidade: matchedViewer.unidade })
        }
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
    // Cargo Master genuíno (cadastrado no banco), independente do bypass do Modo Dev/5 cliques
    window.sgdPermissions.isMasterEditor = (!!matchedEditor && matchedEditor.role === 'master')

    await chrome.storage.local.set({ 
      allowedChannels: allowed, 
      isCurrentUserEditor: found 
    })

    // Sincroniza estado de ativação da Equipe AT do Firebase com o storage local
    let isUserEquipeAT = false
    if (matchedEditor) {
      isUserEquipeAT = matchedEditor.isEquipeAT === true
    } else {
      // Reaproveita matchedViewer se já carregado; senão faz a leitura individual.
      if (!matchedViewer) {
        matchedViewer = await matchViewerRecord(userId, userName, normalizedUserName)
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
      // Cache com TTL: config remota muda raramente; evita baixar config.json a cada
      // carregamento de página do SGD (grande fonte de leituras no RTDB).
      const cached = await chrome.storage.local.get(['remoteConfig', 'remoteConfigCacheTime'])
      const cacheTime = cached.remoteConfigCacheTime || 0
      if (cached.remoteConfig && (Date.now() - cacheTime) < REMOTE_CONFIG_CACHE_TTL) {
        return
      }

      const response = await callDatabaseRead(`${RTDB_BASE_URL}/config.json`)
      if (response.ok) {
        const remoteConfig = await response.json()
        if (remoteConfig && typeof remoteConfig === 'object') {
          await chrome.storage.local.set({ remoteConfig, remoteConfigCacheTime: Date.now() })
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
      // 1. Localiza o registro do próprio usuário (leitura individual + fallback
      // cacheado) — evita baixar as listas completas no heartbeat.
      const matchedEditor = await matchEditorRecord(userId, userName, normalizedUser)
      
      if (matchedEditor) {
        const patchData = { lastSeen: nowStr }
        // Se o editor ainda não tem unidade no Firebase, tenta buscar e salvar
        if (!matchedEditor.unidade && userId) {
          const unit = await fetchLoggedUserUnidade(userId)
          if (unit) {
            patchData.unidade = unit
            matchedEditor.unidade = unit
            await chrome.storage.local.set({ userUnidade: unit })
          }
        } else if (matchedEditor.unidade) {
          await chrome.storage.local.set({ userUnidade: matchedEditor.unidade })
        }

        // Atualiza lastSeen do editor no Firebase
        await callDatabaseWrite(`${RTDB_EDITORS_URL}/${matchedEditor.id}.json`, 'PATCH', patchData)
        
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
        window.sgdPermissions.isMasterEditor = (existingRole === 'master')
        return
      }
      
      const matchedViewer = await matchViewerRecord(userId, userName, normalizedUser)
      
      if (matchedViewer) {
        const allowed = getViewerAllowedChannels(matchedViewer.allowedChannels)
        const patchData = { lastSeen: nowStr }
        
        // Se o visualizador ainda não tem unidade no Firebase, tenta buscar e salvar
        if (!matchedViewer.unidade && userId) {
          const unit = await fetchLoggedUserUnidade(userId)
          if (unit) {
            patchData.unidade = unit
            matchedViewer.unidade = unit
            await chrome.storage.local.set({ userUnidade: unit })
          }
        } else if (matchedViewer.unidade) {
          await chrome.storage.local.set({ userUnidade: matchedViewer.unidade })
        }

        const allChs = getChannelsFallback()
        if (matchedViewer.allowedChannels && Array.isArray(matchedViewer.allowedChannels) && matchedViewer.allowedChannels.length >= allChs.length) {
          patchData.allowedChannels = allowed
        }

        // Atualiza lastSeen do visualizador
        await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${matchedViewer.id}.json`, 'PATCH', patchData)
        
        await chrome.storage.local.set({ 
          allowedChannels: allowed,
          isCurrentUserEditor: false
        })
        window.sgdPermissions.allowedChannels = allowed
        window.sgdPermissions.isEditor = false
      } else {
        // Cadastra novo visualizador via PUT usando a chave gerada por userId
        const defaultChannels = ['Geral']
        const unit = userId ? await fetchLoggedUserUnidade(userId) : null
        if (unit) {
          await chrome.storage.local.set({ userUnidade: unit })
        }

        const response = await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${userKey}.json`, 'PUT', {
          name: userName.trim(),
          firstSeen: nowStr,
          lastSeen: nowStr,
          allowedChannels: defaultChannels,
          unidade: unit || ''
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
      
      await callDatabaseWrite(`${RTDB_BASE_URL}/audit_logs.json`, 'POST', {
        operatorId,
        operatorName,
        action,
        target,
        details,
        timestamp
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
      const response = await callDatabaseRead(`${RTDB_BASE_URL}/audit_logs.json?orderBy="timestamp"&limitToLast=100`)
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
      const response = await callDatabaseWrite(`${RTDB_EDITORS_URL}/${targetKey}.json`, 'PUT', {
        name: trimmedName,
        addedAt: new Date().toISOString(),
        addedBy: window.sgdPermissions.currentUser || 'desconhecido',
        allowedChannels: getChannelsFallback(),
        role: 'comum'
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
      const response = await callDatabaseWrite(`${RTDB_EDITORS_URL}/${firebaseId}.json`, 'DELETE')

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
        const responseViewer = await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${firebaseId}.json`, 'PUT', viewerData)
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

      const response = await callDatabaseWrite(`${RTDB_EDITORS_URL}/${editorId}.json`, 'PATCH', { allowedChannels })
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

      const response = await callDatabaseWrite(`${RTDB_EDITORS_URL}/${editorId}.json`, 'PATCH', { role })
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

      const response = await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${viewerId}.json`, 'PATCH', { allowedChannels })
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

        return callDatabaseWrite(`${RTDB_VIEWERS_URL}/${id}.json`, 'PATCH', { allowedChannels: channels })
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

      const responseAdd = await callDatabaseWrite(`${RTDB_EDITORS_URL}/${viewerId}.json`, 'PUT', {
        name: trimmedName,
        addedAt: new Date().toISOString(),
        addedBy: window.sgdPermissions.currentUser || 'desconhecido',
        allowedChannels: getChannelsFallback(),
        role: role,
        isEquipeAT: isEquipeAT
      })

      if (!responseAdd.ok) throw new Error('Falha ao adicionar editor')

      // 2. Remove do viewers
      const responseDel = await callDatabaseWrite(`${RTDB_VIEWERS_URL}/${viewerId}.json`, 'DELETE')

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
      const response = await callDatabaseRead(`${RTDB_BASE_URL}/permissions/channel_profiles.json`)
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
      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/permissions/channel_profiles/${key}.json`, 'PUT', { name, channels })
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
      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/permissions/channel_profiles/${profileId}.json`, 'DELETE')
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

  // Grupos de Visualizadores CRUD (Firebase RTDB + Armazenamento Local Fallback)
  async function getViewerGroups() {
    try {
      const response = await callDatabaseRead(`${RTDB_BASE_URL}/permissions/viewer_groups.json`)
      if (response.ok) {
        const result = await response.json()
        if (result && typeof result === 'object') {
          const groups = Object.entries(result).map(([id, data]) => ({
            id,
            name: data.name || '',
            viewers: data.viewers || []
          }))
          // Mantém o storage local sincronizado
          await chrome.storage.local.set({ viewerGroups: groups })
          return groups
        }
      }
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao buscar grupos de visualizadores do Firebase RTDB, usando local:', e)
    }
    // Fallback local
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
      // 1. Salva no Firebase RTDB
      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/permissions/viewer_groups/${key}.json`, 'PUT', { name, viewers })
      if (!response.ok) throw new Error('Falha ao salvar no Firebase')

      // 2. Salva localmente para manter sincronizado
      const local = await chrome.storage.local.get(['viewerGroups'])
      let groups = local.viewerGroups || []
      groups = groups.filter(g => g.id !== key)
      groups.push({ id: key, name, viewers })
      await chrome.storage.local.set({ viewerGroups: groups })

      await writeAuditLog('SAVE_VIEWER_GROUP', name, `Visualizadores: ${viewers.length} usuários`)
      return true
    } catch (err) {
      console.error('[SGD Permissions] Erro ao salvar grupo:', err)
      return false
    }
  }

  async function deleteViewerGroup(groupId) {
    if (!window.sgdPermissions.isEditor) return false
    try {
      // 1. Remove do Firebase RTDB
      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/permissions/viewer_groups/${groupId}.json`, 'DELETE')
      if (!response.ok) throw new Error('Falha ao excluir no Firebase')

      // 2. Remove localmente para manter sincronizado
      const local = await chrome.storage.local.get(['viewerGroups'])
      let groups = local.viewerGroups || []
      groups = groups.filter(g => g.id !== groupId)
      await chrome.storage.local.set({ viewerGroups: groups })

      await writeAuditLog('DELETE_VIEWER_GROUP', groupId)
      return true
    } catch (err) {
      console.error('[SGD Permissions] Erro ao excluir grupo:', err)
      return false
    }
  }

  // Canais Dinâmicos CRUD
  async function loadActiveChannels() {
    try {
      // Cache com TTL: a lista de canais ativos muda raramente; evita baixar
      // channels.json a cada carregamento de página do SGD.
      const cached = await chrome.storage.local.get(['warningChannels', 'channelsCacheTime'])
      const cacheTime = cached.channelsCacheTime || 0
      if (Array.isArray(cached.warningChannels) && cached.warningChannels.length > 0 && (Date.now() - cacheTime) < ACTIVE_CHANNELS_CACHE_TTL) {
        window.sgdPermissions.channels = cached.warningChannels
        return cached.warningChannels
      }

      const response = await callDatabaseRead(`${RTDB_BASE_URL}/permissions/channels.json`)
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data) && data.length > 0) {
          window.sgdPermissions.channels = data
          await chrome.storage.local.set({ warningChannels: data, channelsCacheTime: Date.now() })
          return data
        }
      }
    } catch (e) {
      console.warn('[SGD Permissions] Erro ao buscar canais do Firebase:', e)
    }
    const stored = await chrome.storage.local.get(['warningChannels'])
    const list = stored.warningChannels || [...WARNING_CHANNELS]
    window.sgdPermissions.channels = list
    return list
  }

  async function saveActiveChannels(channelsList) {
    if (!window.sgdPermissions.isEditor || window.sgdPermissions.role !== 'master') return false
    try {
      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/permissions/channels.json`, 'PUT', channelsList)
      if (response.ok) {
        window.sgdPermissions.channels = channelsList
        await chrome.storage.local.set({ warningChannels: channelsList, channelsCacheTime: Date.now() })
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
      const response = await callDatabaseWrite(url, 'PATCH', { isEquipeAT: targetStatus })
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
    syncRemoteConfig().catch(err => console.warn('[SGD Permissions] Falha ao sincronizar configs:', err))

    const userName = captureLoggedUserName()
    const userId = captureLoggedUserId()
    window.sgdPermissions.currentUser = userName
    window.sgdPermissions.currentUserId = userId
    if (userName) {
      chrome.storage.local.set({ currentUser: userName }).catch(() => {});
    }

    await loadActiveChannels()

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
        const jitterMs = Math.floor(Math.random() * 30000);
        setTimeout(async () => {
          try {
            await registerUserActivity(userName)
            await chrome.storage.local.set({
              lastPermissionsHeartbeat: Date.now(),
              lastPermissionsHeartbeatUser: userName
            })
          } catch (e) {
            console.warn('[SGD Permissions] Erro no registro de atividade com jitter:', e);
          }
        }, jitterMs);
      }
      // Sem bloco "else": isCurrentUserEditor() já foi executado acima e definiu
      // allowedChannels/isEditor. A recomputação anterior baixava as listas completas
      // de editores/visualizadores em todo carregamento de página (custo alto no RTDB).
    }

    // As listas completas de editores/visualizadores só são necessárias para os
    // recursos administrativos (painel de gestão e direcionamento de avisos), que
    // são exclusivos de editores. Para os demais usuários, não baixamos as listas
    // completas em todo carregamento de página — grande economia de download do RTDB.
    if (window.sgdPermissions.isEditor) {
      const editorsList = await getEditorsList()
      window.sgdPermissions.editorsList = editorsList

      const viewersList = await getViewersList()
      window.sgdPermissions.viewersList = viewersList
    }

    window.sgdPermissions.initialized = true

    console.log(
      `[SGD Permissions] Inicializado. Usuário: "${userName}" | Editor: ${window.sgdPermissions.isEditor} | Canais Permitidos: ${window.sgdPermissions.allowedChannels.length}`
    )
  }

  function getTabsConfigDiffSummary(oldConfig, newConfig) {
    if (!oldConfig || !oldConfig.categories) return 'Configuração inicial das guias salva'
    if (!newConfig || !newConfig.categories) return 'Configuração das guias limpa/esvaziada'
    
    const changes = []
    const oldCats = oldConfig.categories
    const newCats = newConfig.categories
    
    const oldCatNames = oldCats.map(c => c.category)
    const newCatNames = newCats.map(c => c.category)
    
    const addedCats = newCatNames.filter(n => !oldCatNames.includes(n))
    const removedCats = oldCatNames.filter(n => !newCatNames.includes(n))
    
    if (addedCats.length > 0) {
      changes.push(`Adicionou seções: ${addedCats.join(', ')}`)
    }
    if (removedCats.length > 0) {
      changes.push(`Removeu seções: ${removedCats.join(', ')}`)
    }
    
    oldCats.forEach(oldCat => {
      const newCat = newCats.find(c => c.category === oldCat.category)
      if (newCat) {
        const oldItems = oldCat.items || []
        const newItems = newCat.items || []
        
        const oldTitles = oldItems.map(i => i.title).filter(Boolean)
        const newTitles = newItems.map(i => i.title).filter(Boolean)
        
        const addedItems = newTitles.filter(t => !oldTitles.includes(t))
        const removedItems = oldTitles.filter(t => !newTitles.includes(t))
        
        if (addedItems.length > 0) {
          changes.push(`Na seção "${oldCat.category}", adicionou: ${addedItems.join(', ')}`)
        }
        if (removedItems.length > 0) {
          changes.push(`Na seção "${oldCat.category}", removeu: ${removedItems.join(', ')}`)
        }
        
        oldItems.forEach(oldItem => {
          const newItem = newItems.find(i => i.title === oldItem.title)
          if (newItem) {
            const itemChanges = []
            if (oldItem.description !== newItem.description) itemChanges.push('descrição')
            if (oldItem.url !== newItem.url) itemChanges.push('URL')
            if (oldItem.type !== newItem.type) itemChanges.push('tipo')
            if (oldItem.icon !== newItem.icon) itemChanges.push('ícone')
            if (oldItem.content !== newItem.content) itemChanges.push('conteúdo HTML')
            
            if (itemChanges.length > 0) {
              changes.push(`No card "${oldItem.title}" (${oldCat.category}), modificou: ${itemChanges.join(', ')}`)
            }
          }
        })
      }
    })
    
    if (changes.length === 0) return 'Configuração salva sem alterações'
    const summary = changes.join('; ')
    return summary.length > 400 ? summary.substring(0, 397) + '...' : summary
  }

  async function saveTabsConfig(configData) {
    if (!window.sgdPermissions.isMaster) {
      console.warn('[SGD Permissions] Acesso negado: apenas editores master podem alterar configuração de guias.')
      return false
    }
    try {
      // Recupera configuração antiga para comparar
      const stored = await chrome.storage.local.get(['cachedFormsData'])
      const oldConfig = stored.cachedFormsData
      const diffSummary = getTabsConfigDiffSummary(oldConfig, configData)

      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/permissions/forms_config.json`, 'PUT', configData)
      if (!response.ok) throw new Error('Falha ao atualizar configuração das guias')
      
      await writeAuditLog('UPDATE_TABS_CONFIG', 'configuração de guias', diffSummary)
      await invalidateFormsCache()
      return true
    } catch (error) {
      console.error('[SGD Permissions] Erro ao salvar configuração de guias:', error)
      return false
    }
  }

  async function saveRemoteConfig(configData) {
    if (!window.sgdPermissions.isEditor || window.sgdPermissions.role !== 'master') return false
    try {
      const response = await callDatabaseWrite(`${RTDB_BASE_URL}/config.json`, 'PUT', configData)
      if (response.ok) {
        await chrome.storage.local.set({ remoteConfig: configData, remoteConfigCacheTime: Date.now() })
        await writeAuditLog('UPDATE_REMOTE_CONFIG', 'Configurações Globais', JSON.stringify(configData))
        return true
      }
      return false
    } catch (e) {
      console.error('[SGD Permissions] Erro ao salvar configurações remotas:', e)
      return false
    }
  }

  async function updateUserRegion(userId, isEditor, region) {
    if (!window.sgdPermissions.isEditor) return false
    const url = isEditor ? `${RTDB_EDITORS_URL}/${userId}.json` : `${RTDB_VIEWERS_URL}/${userId}.json`
    try {
      const response = await callDatabaseWrite(url, 'PATCH', { regiao: region })
      if (response.ok) {
        const listName = isEditor ? 'editores' : 'visualizadores'
        await writeAuditLog('UPDATE_USER_REGION', userId, `Região alterada para "${region}" (${listName})`)
        await invalidatePermissionsCache()
        return true
      }
      return false
    } catch (e) {
      console.error('[SGD Permissions] Erro ao atualizar região do usuário:', e)
      return false
    }
  }

  async function toggleUserPLUG(userId, isEditor, currentStatus) {
    if (!window.sgdPermissions.isEditor) return false
    const url = isEditor ? `${RTDB_EDITORS_URL}/${userId}.json` : `${RTDB_VIEWERS_URL}/${userId}.json`
    const targetStatus = !currentStatus
    try {
      // targetStatus aqui é o novo valor de "desativado". Quando o master reativa
      // (targetStatus === false), gravamos iagenteIA_Enabled=true para que o
      // usuário receba a liberação individual mesmo que a unidade dele esteja
      // bloqueada na allowlist (iagente_enabled_unidades). Sem isso, o bloqueio
      // por unidade continuava prevalecendo mesmo com iagenteDisabled=false.
      const payload = {
        iagenteDisabled: targetStatus,
        iagenteIA_Enabled: !targetStatus
      }
      const response = await callDatabaseWrite(url, 'PATCH', payload)
      if (response.ok) {
        const listName = isEditor ? 'editores' : 'visualizadores'
        await writeAuditLog('TOGGLE_USER_PLUG', userId, `Ação: ${targetStatus ? 'Desativar' : 'Ativar'} PLUG (${listName})`)
        await invalidatePermissionsCache()
        return true
      }
      return false
    } catch (e) {
      console.error('[SGD Permissions] Erro ao alternar status do PLUG do usuário:', e)
      return false
    }
  }

  async function toggleUserDuplicateIA(userId, isEditor, currentStatus) {
    if (!window.sgdPermissions.isEditor) return false
    const url = isEditor ? `${RTDB_EDITORS_URL}/${userId}.json` : `${RTDB_VIEWERS_URL}/${userId}.json`
    const targetStatus = !currentStatus
    try {
      const payload = {
        duplicateIA_Enabled: targetStatus,
        duplicateIA_Disabled: !targetStatus
      }
      const response = await callDatabaseWrite(url, 'PATCH', payload)
      if (response.ok) {
        const listName = isEditor ? 'editores' : 'visualizadores'
        await writeAuditLog('TOGGLE_USER_DUPLICATE_IA', userId, `Ação: ${targetStatus ? 'Ativar' : 'Desativar'} Duplicados IA (${listName})`)
        await invalidatePermissionsCache()
        return true
      }
      return false
    } catch (e) {
      console.error('[SGD Permissions] Erro ao alternar status do Duplicados IA do usuário:', e)
      return false
    }
  }

  // ─── Resolvers de Acesso (PLUG / Duplicados) ──────────────────────────────
  // Funções puras e síncronas que concentram a regra de decisão de acesso.
  // São usadas tanto pelas checagens reais (hasPLUGAccess/hasDuplicateCheckerIAAccess,
  // que buscam os dados no Firebase) quanto pelo badge do painel de Controle de Acesso
  // (checkUserPLUGAccessStatus/checkUserDuplicateAccessStatus em info-panel.js, que já
  // tem os dados carregados). Mantendo a decisão em um único lugar, painel e acesso real
  // nunca mais podem divergir por causa de uma ordem de checagem diferente entre os dois.
  // Expostas em window.sgdPermissions para serem reaproveitadas pelo info-panel.js.

  function resolvePLUGAccess({ isMasterBypass, iagenteDisabled, iagenteIA_Enabled, unidade, enabledUnidades }) {
    if (isMasterBypass) {
      return { active: true, reason: 'Master' }
    }
    // Bloqueio individual tem prioridade sobre a liberação individual: se os dois
    // campos estiverem true por engano (ex.: edição manual no Firebase), o usuário
    // fica bloqueado, nunca liberado por acidente.
    if (iagenteDisabled === true) {
      return { active: false, reason: 'Bloqueado individualmente' }
    }
    if (iagenteIA_Enabled === true) {
      return { active: true, reason: 'Ativo individualmente' }
    }
    const unit = unidade ? unidade.trim() : ''
    if (!unit || unit === 'Unidade não capturada') {
      return { active: false, reason: 'Unidade não capturada' }
    }
    const trimmedUnit = unit.toLowerCase()
    const isUnitEnabled = (enabledUnidades || []).some(eu => trimmedUnit === eu.trim().toLowerCase())
    if (!isUnitEnabled) {
      return { active: false, reason: 'Unidade não liberada' }
    }
    return { active: true, reason: 'Ativo' }
  }

  function resolveDuplicateIAAccess({ isMasterBypass, duplicateIA_Enabled, duplicateIA_Disabled, unidade, enabledUnidades }) {
    if (isMasterBypass) {
      return { active: true, reason: 'Master' }
    }
    // Aqui a liberação individual é checada antes do bloqueio (comportamento já
    // existente e mantido de propósito, para não alterar o resultado de nenhum
    // registro em produção nesta refatoração).
    if (duplicateIA_Enabled === true) {
      return { active: true, reason: 'Ativo individualmente' }
    }
    if (duplicateIA_Disabled === true) {
      return { active: false, reason: 'Bloqueado individualmente' }
    }
    const unit = unidade ? unidade.trim() : ''
    if (!unit || unit === 'Unidade não capturada') {
      return { active: false, reason: 'Unidade não capturada' }
    }
    const trimmedUnit = unit.toLowerCase()
    const isUnitEnabled = (enabledUnidades || []).some(eu => trimmedUnit === eu.trim().toLowerCase())
    if (!isUnitEnabled) {
      return { active: false, reason: 'Unidade não liberada' }
    }
    return { active: true, reason: 'Ativo' }
  }

  async function hasDuplicateCheckerIAAccess() {
    const userName = window.sgdPermissions?.currentUser
    const userId = window.sgdPermissions?.currentUserId
    const devData = await chrome.storage.local.get(['developerModeEnabled'])
    const isDevMode = devData.developerModeEnabled === true
    
    // Se for Master/Dev, sempre tem acesso (bypass)
    if (isDevMode || (window.sgdPermissions?.isMaster)) return true
    
    if (!userName) return false
    const normalizedUser = normalizeName(userName)
    
    // 1. Verificar no Firebase se o usuário individual está explicitamente ativado ou desativado
    let duplicateIA_Enabled = false
    let duplicateIA_Disabled = false
    let userUnidade = null

    const matchedEditor = await matchEditorRecord(userId, userName, normalizedUser)
    if (matchedEditor) {
      duplicateIA_Enabled = matchedEditor.duplicateIA_Enabled === true
      duplicateIA_Disabled = matchedEditor.duplicateIA_Disabled === true
      userUnidade = matchedEditor.unidade
    } else {
      const matchedViewer = await matchViewerRecord(userId, userName, normalizedUser)
      if (matchedViewer) {
        duplicateIA_Enabled = matchedViewer.duplicateIA_Enabled === true
        duplicateIA_Disabled = matchedViewer.duplicateIA_Disabled === true
        userUnidade = matchedViewer.unidade
      }
    }

    // 2. Se não temos a unidade cadastrada no matched record, pega do cache local
    if (!userUnidade) {
      const cachedUserInfo = await chrome.storage.local.get(['userUnidade'])
      userUnidade = cachedUserInfo.userUnidade
    }

    // 3. Verificar a unidade contra a allowlist remota (duplicate_enabled_unidades)
    const localConfig = await chrome.storage.local.get(['remoteConfig'])
    const remoteConfig = localConfig.remoteConfig || {}
    const enabledUnidades = remoteConfig.duplicate_enabled_unidades || []

    const result = resolveDuplicateIAAccess({
      isMasterBypass: false, // bypass de Master/Dev já tratado acima, com retorno antecipado
      duplicateIA_Enabled,
      duplicateIA_Disabled,
      unidade: userUnidade,
      enabledUnidades
    })
    return result.active
  }

  async function hasPLUGAccess() {
    const userName = window.sgdPermissions?.currentUser
    const userId = window.sgdPermissions?.currentUserId
    const devData = await chrome.storage.local.get(['developerModeEnabled'])
    const isDevMode = devData.developerModeEnabled === true

    sgdLog('[PLUG Access] Iniciando verificação. userName:', userName, '| userId (currentUserId):', userId, '| isDevMode:', isDevMode, '| isMaster:', window.sgdPermissions?.isMaster)

    // Se for Master/Dev, sempre tem acesso (bypass)
    if (isDevMode || (window.sgdPermissions?.isMaster)) {
      sgdLog('[PLUG Access] Bypass concedido (Dev Mode ou Master).')
      return true
    }

    if (!userName) {
      sgdWarn('[PLUG Access] Negado: currentUser não capturado (userName vazio).')
      return false
    }
    const normalizedUser = normalizeName(userName)

    // 1. Verificar no Firebase se o usuário individual está desativado ou
    //    liberado manualmente (override que ignora o bloqueio por unidade)
    let isIndividualDisabled = false
    let isIndividuallyEnabled = false
    let userUnidade = null

    const matchedEditor = await matchEditorRecord(userId, userName, normalizedUser)
    if (matchedEditor) {
      isIndividualDisabled = matchedEditor.iagenteDisabled === true
      isIndividuallyEnabled = matchedEditor.iagenteIA_Enabled === true
      userUnidade = matchedEditor.unidade
      sgdLog('[PLUG Access] Registro encontrado em EDITORES. id:', matchedEditor.id, '| iagenteDisabled:', matchedEditor.iagenteDisabled, '| iagenteIA_Enabled:', matchedEditor.iagenteIA_Enabled, '| unidade:', matchedEditor.unidade)
    } else {
      const matchedViewer = await matchViewerRecord(userId, userName, normalizedUser)
      if (matchedViewer) {
        isIndividualDisabled = matchedViewer.iagenteDisabled === true
        isIndividuallyEnabled = matchedViewer.iagenteIA_Enabled === true
        userUnidade = matchedViewer.unidade
        sgdLog('[PLUG Access] Registro encontrado em VISUALIZADORES. id:', matchedViewer.id, '| iagenteDisabled:', matchedViewer.iagenteDisabled, '| iagenteIA_Enabled:', matchedViewer.iagenteIA_Enabled, '| unidade:', matchedViewer.unidade)
      } else {
        sgdWarn('[PLUG Access] Nenhum registro encontrado em editores nem visualizadores para userId:', userId, '/ nome:', userName, '— provavelmente caiu no fallback de lista cacheada (até 12h) e não achou o registro lá. Verifique se o ID usado ao ativar no painel bate com este userId.')
      }
    }

    // 2. Se não temos a unidade cadastrada no matched record, pega do cache local
    if (!userUnidade) {
      const cachedUserInfo = await chrome.storage.local.get(['userUnidade'])
      userUnidade = cachedUserInfo.userUnidade
      sgdLog('[PLUG Access] Unidade não veio do registro, usando cache local (userUnidade):', userUnidade)
    }

    // 3. Verificar a unidade contra a allowlist remota (iagente_enabled_unidades)
    const localConfig = await chrome.storage.local.get(['remoteConfig'])
    const remoteConfig = localConfig.remoteConfig || {}
    const enabledUnidades = remoteConfig.iagente_enabled_unidades || []

    const result = resolvePLUGAccess({
      isMasterBypass: false, // bypass de Master/Dev já tratado acima, com retorno antecipado
      iagenteDisabled: isIndividualDisabled,
      iagenteIA_Enabled: isIndividuallyEnabled,
      unidade: userUnidade,
      enabledUnidades
    })

    if (result.active) {
      sgdLog('[PLUG Access] Concedido:', result.reason)
    } else {
      sgdWarn('[PLUG Access] Negado:', result.reason)
    }
    return result.active
  }

  async function getPLUGUrl() {
    const userName = window.sgdPermissions?.currentUser
    const userId = window.sgdPermissions?.currentUserId
    const normalizedUser = normalizeName(userName)
    
    const localConfig = await chrome.storage.local.get(['remoteConfig'])
    const remoteConfig = localConfig.remoteConfig || {}
    
    const defaultSul = 'https://tria.plugsocial.online/?assunto=sped&codigoCliente=96797&identificacaoRevenda=3'
    const urlSul = remoteConfig.iagente_url_sul || defaultSul
    const urlSudeste = remoteConfig.iagente_url_sudeste || urlSul
    
    // 1. Verificar se o usuário tem região explicitamente atribuída no Firebase
    let userRegion = null
    let userUnidade = null
    
    const matchedEditor = await matchEditorRecord(userId, userName, normalizedUser)
    if (matchedEditor) {
      userRegion = matchedEditor.regiao
      userUnidade = matchedEditor.unidade
    } else {
      const matchedViewer = await matchViewerRecord(userId, userName, normalizedUser)
      if (matchedViewer) {
        userRegion = matchedViewer.regiao
        userUnidade = matchedViewer.unidade
      }
    }
    
    if (userRegion === 'sudeste') return urlSudeste
    if (userRegion === 'sul') return urlSul
    
    // 2. Se não temos no Firebase, tentar ler do cache local
    if (!userUnidade) {
      const cachedUserInfo = await chrome.storage.local.get(['userUnidade'])
      userUnidade = cachedUserInfo.userUnidade
    }
    
    // 3. Mapeamento da unidade ou fallback por palavra-chave na unidade
    if (userUnidade) {
      const unitRegionMap = remoteConfig.iagente_unidade_regiao || {}
      const mappedRegion = unitRegionMap[userUnidade.trim()]
      if (mappedRegion === 'sudeste') return urlSudeste
      if (mappedRegion === 'sul') return urlSul
      
      const lowerUnit = userUnidade.toLowerCase()
      const sudesteKeywords = ['campinas', 'sao paulo', 'são paulo', 'sp', 'rio de janeiro', 'rj', 'belo horizonte', 'mg', 'espirito santo', 'espírito santo', 'es', 'sudeste']
      const isSudeste = sudesteKeywords.some(keyword => lowerUnit.includes(keyword))
      if (isSudeste) return urlSudeste
    }
    
    return urlSul
  }

  async function invalidateFormsCache() {
    await chrome.storage.local.set({ 
      cachedFormsCacheTime: 0 
    })
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
  window.sgdPermissions.saveTabsConfig = saveTabsConfig
  window.sgdPermissions.invalidateFormsCache = invalidateFormsCache
  window.sgdPermissions.saveRemoteConfig = saveRemoteConfig
  window.sgdPermissions.updateUserRegion = updateUserRegion
  window.sgdPermissions.toggleUserPLUG = toggleUserPLUG
  window.sgdPermissions.hasPLUGAccess = hasPLUGAccess
  window.sgdPermissions.getPLUGUrl = getPLUGUrl
  window.sgdPermissions.toggleUserDuplicateIA = toggleUserDuplicateIA
  window.sgdPermissions.hasDuplicateCheckerIAAccess = hasDuplicateCheckerIAAccess
  // Resolvers puros compartilhados com o painel (info-panel.js), para que o badge
  // de status e a checagem real de acesso nunca divirjam.
  window.sgdPermissions.resolvePLUGAccess = resolvePLUGAccess
  window.sgdPermissions.resolveDuplicateIAAccess = resolveDuplicateIAAccess

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
