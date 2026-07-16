/**
 * @file links-service.js
 * Camada de dados do Repositório Colaborativo de Links por Canal.
 *
 * Responsabilidades:
 *   - Guia Comunidade: links aprovados, particionados por canal no Firebase RTDB,
 *     com cache local (TTL) + sincronização entre abas via BroadcastChannel.
 *   - Fila de Aprovação: toda contribuição entra pendente e um Master aprova/rejeita.
 *   - Guia Pessoal: 100% local (chrome.storage.local), privada e por técnico.
 *   - Interações: curtir (like) e salvar no Pessoal (coração), contagem de salvamentos.
 *   - Deduplicação de URL na inserção.
 *
 * Padrões reaproveitados da extensão:
 *   - RTDB via chrome.runtime.sendMessage (READ/WRITE_PERMISSIONS_ACTION).
 *   - Cache local no mesmo formato de forms-service.js (chave de dados + chave de tempo + TTL).
 *   - window.sgdPermissions para identidade/role/canais permitidos.
 *   - isValidUrl (utils.js) para validação.
 *   - sgdLog/sgdWarn/sgdError (config.js) para logs controlados.
 */

// ─── CONSTANTES DE RTDB E CACHE ──────────────────────────────────────────────
// Os caminhos ficam sob /permissions (mesma raiz já usada por forms_config e
// pelas listas de editores/visualizadores), e sempre terminam em ".json"
// porque o service worker apenas concatena o caminho à RTDB_BASE_URL.
const RTDB_LINKS_BASE = '/permissions/community_links'
const RTDB_LINKS_PENDING_BASE = '/permissions/community_links_pending'

// Cache por canal: prefixo + channelKey. Guardamos também o timestamp por canal.
const LINKS_CACHE_PREFIX = 'cachedCommunityLinks_'
const LINKS_CACHE_TIME_PREFIX = 'cachedCommunityLinksTime_'
const LINKS_CACHE_TTL = 30 * 60 * 1000 // 30 minutos em ms

// Guia Pessoal (somente local, por técnico).
const PERSONAL_LINKS_KEY = 'personalLinksData'

// Estado local de "curtido por mim" (não vai para o RTDB). Guardamos os IDs
// curtidos namespaced por canal ("channelKey:linkId") para evitar colisões.
// Isso mantém o payload de cada link constante (só um inteiro likeCount no
// servidor) e escalável, independentemente da popularidade.
const VOTED_LINKS_KEY = 'votedLinkIds'

// Tipos de link (subcategorias). 'geral' cobre links que não se encaixam.
const LINK_TYPES = ['ss', 'ssc', 'sam', 'ne', 'geral']

// Valor especial usado na UI para representar "Todos os canais".
const ALL_CHANNELS = '__all__'

// Canal de sincronização entre abas (mesmo padrão usado no restante da extensão).
let sgdLinksChannel = null
try {
  sgdLinksChannel = new BroadcastChannel('sgd-links-sync')
} catch (e) {
  sgdLinksChannel = null
}

// ─── HELPERS DE IDENTIDADE E CANAIS ──────────────────────────────────────────

/**
 * Retorna a identidade do técnico logado a partir de window.sgdPermissions.
 * @returns {{id: string, name: string}} id/nome (com fallbacks seguros).
 */
function getLinksUserIdentity() {
  const p = (typeof window !== 'undefined' && window.sgdPermissions) || {}
  const name = p.currentUser || 'Desconhecido'
  // Sem ID do SGD, usamos uma chave estável derivada do nome para votos/autoria.
  const id = p.currentUserId || cleanLinksKey(normalizeName(name)) || 'anon'
  return { id: String(id), name }
}

/**
 * Indica se o usuário atual é Master (mantido para compatibilidade e bypass de Dev).
 * @returns {boolean}
 */
function isLinksMaster() {
  return !!(window.sgdPermissions && window.sgdPermissions.isMaster)
}

/**
 * Indica se o usuário pode moderar (aprovar/rejeitar/remover).
 * Qualquer editor cadastrado modera — nível master OU comum — respeitando
 * seus canais permitidos (verificados por canal em canAccessChannel).
 * @returns {boolean}
 */
function canModerate() {
  const p = window.sgdPermissions || {}
  return !!(p.isEditor || p.isMaster)
}

/**
 * Verifica se o usuário atual pode contribuir/interagir com um canal.
 * Master vê tudo; demais respeitam allowedChannels quando definido.
 * @param {string} channel Nome do canal.
 * @returns {boolean}
 */
function canAccessChannel(channel) {
  if (isLinksMaster()) return true
  const allowed = (window.sgdPermissions && window.sgdPermissions.allowedChannels) || []
  if (!allowed.length) return true // sem restrição configurada => libera
  return allowed.map(normalizeName).includes(normalizeName(channel))
}

/**
 * Lista de canais disponíveis. Prefere os canais dinâmicos do sgdPermissions,
 * caindo para WARNING_CHANNELS (config.js) como padrão.
 * @returns {string[]}
 */
function getLinkChannels() {
  const dyn = (window.sgdPermissions && window.sgdPermissions.channels) || []
  const base = dyn.length ? dyn : (typeof WARNING_CHANNELS !== 'undefined' ? WARNING_CHANNELS : [])
  return [...base]
}

/**
 * Canais que o usuário atual pode acessar (para agregações "Todos").
 * @returns {string[]}
 */
function getAccessibleChannels() {
  return getLinkChannels().filter(c => canAccessChannel(c))
}

/**
 * Converte um nome de canal em uma chave segura para o Firebase RTDB
 * (não pode conter . $ # [ ] / nem espaços problemáticos).
 * @param {string} value
 * @returns {string}
 */
function cleanLinksKey(value) {
  if (!value) return ''
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[.#$/\[\]]/g, '_') // caracteres proibidos no RTDB
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
    .trim()
}

// ─── HELPERS DE URL (NORMALIZAÇÃO E DEDUPLICAÇÃO) ────────────────────────────

// Parâmetros de rastreamento que não alteram o destino real do link.
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'mc_cid', 'mc_eid', 'ref', 'source'
]

/**
 * Normaliza uma URL para comparação de duplicidade:
 *   - garante esquema, minúsculo no host, remove hash e "/" final,
 *   - remove parâmetros de rastreamento conhecidos.
 * @param {string} url
 * @returns {string} URL normalizada (ou string vazia se inválida).
 */
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return ''
  try {
    let raw = url.trim()
    if (!/^[a-zA-Z]+:\/\//.test(raw) && !raw.startsWith('mailto:')) {
      raw = 'https://' + raw
    }
    const u = new URL(raw)
    if (u.protocol === 'mailto:') return `mailto:${u.pathname.toLowerCase()}`
    u.hostname = u.hostname.toLowerCase()
    u.hash = ''
    TRACKING_PARAMS.forEach(p => u.searchParams.delete(p))
    // Reconstrói sem barra final no path (exceto raiz).
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    const search = u.searchParams.toString()
    return `${u.protocol}//${u.host}${path}${search ? '?' + search : ''}`.toLowerCase()
  } catch (e) {
    return ''
  }
}

/**
 * Gera um ID curto e único para links locais (Pessoal) e comparações.
 * @returns {string}
 */
function genLinkId() {
  return 'lnk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

// ─── ACESSO AO RTDB (VIA SERVICE WORKER) ─────────────────────────────────────

/**
 * Lê um caminho do RTDB através do service worker.
 * @param {string} path Caminho terminando em ".json".
 * @returns {Promise<any>} Dados do nó (ou null se não existir).
 */
function rtdbRead(path) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(
        { action: 'READ_PERMISSIONS_ACTION', path },
        response => {
          if (chrome.runtime.lastError) {
            sgdWarn('[Links] Erro de comunicação (read):', chrome.runtime.lastError)
            resolve(null)
            return
          }
          resolve(response && response.success ? response.data : null)
        }
      )
    } catch (e) {
      sgdError('[Links] Falha inesperada no rtdbRead:', e)
      resolve(null)
    }
  })
}

/**
 * Escreve/atualiza/remove um caminho do RTDB através do service worker.
 * @param {string} path Caminho terminando em ".json".
 * @param {'PUT'|'PATCH'|'POST'|'DELETE'} method Método HTTP.
 * @param {any} [data] Corpo (para PUT/PATCH/POST).
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
function rtdbWrite(path, method, data) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(
        { action: 'WRITE_PERMISSIONS_ACTION', path, method, data },
        response => {
          if (chrome.runtime.lastError) {
            sgdWarn('[Links] Erro de comunicação (write):', chrome.runtime.lastError)
            resolve({ success: false, error: chrome.runtime.lastError.message })
            return
          }
          resolve(response || { success: false, error: 'Sem resposta do service worker' })
        }
      )
    } catch (e) {
      sgdError('[Links] Falha inesperada no rtdbWrite:', e)
      resolve({ success: false, error: e.message })
    }
  })
}

// ─── ESTADO LOCAL DE CURTIDAS ("CURTIDO POR MIM") ────────────────────────────

/**
 * Monta a chave local de uma curtida (namespaced por canal).
 * @param {string} channel
 * @param {string} linkId
 * @returns {string}
 */
function votedKey(channel, linkId) {
  return `${cleanLinksKey(channel)}:${linkId}`
}

/**
 * Lê o conjunto de IDs curtidos localmente (objeto { "canal:id": true }).
 * @returns {Promise<Object>}
 */
async function getVotedMap() {
  try {
    const stored = await chrome.storage.local.get([VOTED_LINKS_KEY])
    const map = stored[VOTED_LINKS_KEY]
    return map && typeof map === 'object' ? map : {}
  } catch (e) {
    return {}
  }
}

/**
 * Marca/desmarca localmente que o usuário curtiu um link.
 * @param {string} channel
 * @param {string} linkId
 * @param {boolean} liked
 */
async function setVotedLocal(channel, linkId, liked) {
  const map = await getVotedMap()
  const k = votedKey(channel, linkId)
  if (liked) map[k] = true
  else delete map[k]
  await chrome.storage.local.set({ [VOTED_LINKS_KEY]: map })
}

// ─── NORMALIZAÇÃO DE REGISTROS ───────────────────────────────────────────────

/**
 * Converte o objeto bruto do RTDB (mapa {id: link}) em array normalizado.
 * A contagem de curtidas vem do inteiro `likeCount`; para compatibilidade,
 * se o link ainda tiver o mapa antigo `likes/{userId}`, deriva a contagem dele.
 * O "curtido por mim" NÃO vem do servidor — é resolvido depois via estado local
 * (ver applyVotedState), mantendo o payload do servidor constante e escalável.
 * @param {object|null} raw Mapa retornado pelo RTDB.
 * @param {string} channel Nome do canal (para preencher o campo channel).
 * @returns {Array<object>} Lista de links normalizados.
 */
function normalizeLinksMap(raw, channel) {
  if (!raw || typeof raw !== 'object') return []
  return Object.keys(raw).map(id => {
    const l = raw[id] || {}
    // Compat: prioriza likeCount (novo modelo); cai para o tamanho do mapa antigo.
    let likeCount = Number(l.likeCount)
    if (!Number.isFinite(likeCount)) {
      likeCount = (l.likes && typeof l.likes === 'object') ? Object.keys(l.likes).length : 0
    }
    return {
      id,
      url: l.url || '',
      urlNorm: l.urlNorm || normalizeUrl(l.url || ''),
      title: l.title || '',
      type: LINK_TYPES.includes(l.type) ? l.type : 'geral',
      channel: l.channel || channel,
      authorId: l.authorId || '',
      authorName: l.authorName || '',
      createdAt: l.createdAt || 0,
      saveCount: Number(l.saveCount) || 0,
      likeCount: Math.max(0, likeCount),
      likedByMe: false, // preenchido por applyVotedState
      status: l.status || 'approved'
    }
  })
}

/**
 * Preenche `likedByMe` de cada link a partir do estado local do usuário.
 * @param {Array<object>} list
 * @param {string} channel
 * @returns {Promise<Array<object>>} A mesma lista, com likedByMe atualizado.
 */
async function applyVotedState(list, channel) {
  const map = await getVotedMap()
  list.forEach(l => { l.likedByMe = !!map[votedKey(channel, l.id)] })
  return list
}

// ─── GUIA COMUNIDADE: LEITURA (COM CACHE) ────────────────────────────────────

/**
 * Busca os links aprovados de um canal, priorizando cache local válido.
 * @param {string} channel Nome do canal.
 * @param {boolean} [forceRefresh=false] Ignora o cache.
 * @returns {Promise<Array<object>>} Lista de links normalizados.
 */
async function fetchCommunityLinks(channel, forceRefresh = false) {
  const key = cleanLinksKey(channel)
  const dataKey = LINKS_CACHE_PREFIX + key
  const timeKey = LINKS_CACHE_TIME_PREFIX + key

  try {
    if (!forceRefresh) {
      const stored = await chrome.storage.local.get([dataKey, timeKey])
      const cacheTime = stored[timeKey] || 0
      const isValid = (Date.now() - cacheTime) < LINKS_CACHE_TTL
      if (isValid && Array.isArray(stored[dataKey])) {
        sgdLog(`[Links] Cache válido para canal "${channel}"`)
        // Recalcula "curtido por mim" a partir do estado local (pode ter mudado).
        return applyVotedState(stored[dataKey], channel)
      }
    }

    const raw = await rtdbRead(`${RTDB_LINKS_BASE}/${key}.json`)
    const list = normalizeLinksMap(raw, channel)
    await chrome.storage.local.set({ [dataKey]: list, [timeKey]: Date.now() })
    sgdLog(`[Links] ${list.length} link(s) carregado(s) do RTDB para "${channel}"`)
    return applyVotedState(list, channel)
  } catch (e) {
    sgdWarn('[Links] Erro ao buscar links da comunidade, retornando cache/vazio:', e)
    const stored = await chrome.storage.local.get([dataKey])
    return Array.isArray(stored[dataKey]) ? applyVotedState(stored[dataKey], channel) : []
  }
}

/**
 * Atualiza um link específico dentro do cache local do canal, sem reler o RTDB.
 * Usado pela UI otimista (curtir/salvar) para manter o cache coerente com a tela.
 * @param {string} channel
 * @param {string} linkId
 * @param {Object} patch Campos a mesclar no link (ex.: { likeCount, saveCount }).
 */
async function patchCachedLink(channel, linkId, patch) {
  const key = cleanLinksKey(channel)
  const dataKey = LINKS_CACHE_PREFIX + key
  try {
    const stored = await chrome.storage.local.get([dataKey])
    const list = stored[dataKey]
    if (!Array.isArray(list)) return
    const idx = list.findIndex(l => l.id === linkId)
    if (idx < 0) return
    list[idx] = { ...list[idx], ...patch }
    await chrome.storage.local.set({ [dataKey]: list })
  } catch (e) {
    sgdWarn('[Links] Falha ao atualizar cache local do link:', e)
  }
}

/**
 * Invalida o cache de um canal (força releitura na próxima chamada) e
 * notifica outras abas para recarregarem.
 * @param {string} channel
 */
async function invalidateChannelCache(channel) {
  const key = cleanLinksKey(channel)
  await chrome.storage.local.remove([LINKS_CACHE_PREFIX + key, LINKS_CACHE_TIME_PREFIX + key])
  if (sgdLinksChannel) {
    try { sgdLinksChannel.postMessage({ type: 'invalidate', channel }) } catch (e) {}
  }
}

/**
 * Busca e mescla os links aprovados de TODOS os canais acessíveis (opção "Todos").
 * Cada link mantém seu campo `channel` para exibição/ações por item.
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<Array<object>>}
 */
async function fetchCommunityLinksAll(forceRefresh = false) {
  const channels = getAccessibleChannels()
  const lists = await Promise.all(channels.map(c => fetchCommunityLinks(c, forceRefresh)))
  return lists.flat()
}

/**
 * Busca e mescla as pendências de TODOS os canais acessíveis (opção "Todos").
 * @returns {Promise<Array<object>>}
 */
async function fetchPendingAll() {
  if (!canModerate()) return []
  const channels = getAccessibleChannels()
  const lists = await Promise.all(channels.map(c => fetchPendingLinks(c)))
  return lists.flat()
}

// ─── DEDUPLICAÇÃO ────────────────────────────────────────────────────────────

/**
 * Procura um link com a mesma URL normalizada (aprovado ou pendente) no canal.
 * @param {string} channel
 * @param {string} url URL candidata.
 * @returns {Promise<{found: boolean, where?: 'approved'|'pending', link?: object}>}
 */
async function findDuplicateLink(channel, url) {
  const urlNorm = normalizeUrl(url)
  if (!urlNorm) return { found: false }
  const key = cleanLinksKey(channel)

  const approved = await fetchCommunityLinks(channel)
  const hitApproved = approved.find(l => l.urlNorm === urlNorm)
  if (hitApproved) return { found: true, where: 'approved', link: hitApproved }

  const rawPending = await rtdbRead(`${RTDB_LINKS_PENDING_BASE}/${key}.json`)
  const pending = normalizeLinksMap(rawPending, channel)
  const hitPending = pending.find(l => l.urlNorm === urlNorm)
  if (hitPending) return { found: true, where: 'pending', link: hitPending }

  return { found: false }
}

// ─── GUIA COMUNIDADE: CONTRIBUIÇÃO (FILA DE APROVAÇÃO) ───────────────────────

/**
 * Contribui com um link para a comunidade.
 * Editores/moderadores publicam DIRETO no nó aprovado; demais entram na fila de
 * aprovação. Valida URL, respeita canais permitidos e evita duplicatas.
 * @param {{url: string, title: string, type: string, channel: string}} input
 * @returns {Promise<{ok: boolean, reason?: string, duplicate?: object, direct?: boolean}>}
 */
async function submitCommunityLink(input) {
  const { url, title, type, channel } = input || {}

  if (!isValidUrl(url)) return { ok: false, reason: 'url-invalida' }
  if (!title || !title.trim()) return { ok: false, reason: 'titulo-vazio' }
  if (!channel) return { ok: false, reason: 'canal-vazio' }
  if (!canAccessChannel(channel)) return { ok: false, reason: 'sem-permissao-canal' }

  const dup = await findDuplicateLink(channel, url)
  if (dup.found) return { ok: false, reason: 'duplicado', duplicate: dup }

  const me = getLinksUserIdentity()
  const key = cleanLinksKey(channel)
  const base = {
    url: url.trim(),
    urlNorm: normalizeUrl(url),
    title: title.trim(),
    type: LINK_TYPES.includes(type) ? type : 'geral',
    channel,
    authorId: me.id,
    authorName: me.name,
    createdAt: Date.now(),
    saveCount: 0
  }

  // Editor/moderador: publica direto na Comunidade (sem passar pela fila).
  if (canModerate()) {
    const record = { ...base, status: 'approved', likeCount: 0, approvedAt: Date.now(), approvedBy: me.name }
    const res = await rtdbWrite(`${RTDB_LINKS_BASE}/${key}.json`, 'POST', record)
    if (!res.success) return { ok: false, reason: 'erro-rtdb' }
    await invalidateChannelCache(channel)
    sgdLog('[Links] Editor publicou direto na Comunidade:', record.title)
    return { ok: true, direct: true }
  }

  // Demais usuários: entra na fila de aprovação.
  const record = { ...base, status: 'pending' }
  const res = await rtdbWrite(`${RTDB_LINKS_PENDING_BASE}/${key}.json`, 'POST', record)
  if (!res.success) return { ok: false, reason: 'erro-rtdb' }
  sgdLog('[Links] Contribuição enviada para aprovação:', record.title)
  return { ok: true, direct: false }
}

/**
 * Monta um "patch" seguro de edição a partir de campos livres.
 * Só inclui campos válidos; recalcula urlNorm quando a URL muda.
 * @param {{title?: string, url?: string, type?: string, channel?: string}} input
 * @returns {Object}
 */
function buildLinkPatch(input) {
  const patch = {}
  if (input && typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim()
  if (input && typeof input.url === 'string' && isValidUrl(input.url)) {
    patch.url = input.url.trim()
    patch.urlNorm = normalizeUrl(input.url)
  }
  if (input && LINK_TYPES.includes(input.type)) patch.type = input.type
  if (input && typeof input.channel === 'string' && input.channel) patch.channel = input.channel
  return patch
}

// ─── GUIA COMUNIDADE: MODERAÇÃO (SOMENTE MASTER) ─────────────────────────────

/**
 * Lista os itens pendentes de um canal (para a tela de moderação do Master).
 * @param {string} channel
 * @returns {Promise<Array<object>>}
 */
async function fetchPendingLinks(channel) {
  if (!canModerate()) return []
  if (!canAccessChannel(channel)) return []
  const key = cleanLinksKey(channel)
  const raw = await rtdbRead(`${RTDB_LINKS_PENDING_BASE}/${key}.json`)
  return normalizeLinksMap(raw, channel)
}

/**
 * Aprova um item pendente: move para o nó de aprovados e remove da fila.
 * @param {string} channel
 * @param {string} pendingId ID do item na fila.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function approvePendingLink(channel, pendingId) {
  if (!canModerate() || !canAccessChannel(channel)) return { ok: false, reason: 'sem-permissao' }
  const key = cleanLinksKey(channel)

  const pending = await rtdbRead(`${RTDB_LINKS_PENDING_BASE}/${key}/${pendingId}.json`)
  if (!pending) return { ok: false, reason: 'nao-encontrado' }

  const approvedRecord = {
    url: pending.url,
    urlNorm: pending.urlNorm || normalizeUrl(pending.url),
    title: pending.title,
    type: LINK_TYPES.includes(pending.type) ? pending.type : 'geral',
    channel,
    authorId: pending.authorId || '',
    authorName: pending.authorName || '',
    createdAt: pending.createdAt || Date.now(),
    approvedAt: Date.now(),
    approvedBy: getLinksUserIdentity().name,
    saveCount: Number(pending.saveCount) || 0,
    likeCount: Number(pending.likeCount) || 0,
    status: 'approved'
  }

  // POST no nó de aprovados (gera novo push id) e depois remove o pendente.
  const res = await rtdbWrite(`${RTDB_LINKS_BASE}/${key}.json`, 'POST', approvedRecord)
  if (!res.success) return { ok: false, reason: 'erro-ao-aprovar' }

  await rtdbWrite(`${RTDB_LINKS_PENDING_BASE}/${key}/${pendingId}.json`, 'DELETE')
  await invalidateChannelCache(channel)
  return { ok: true }
}

/**
 * Rejeita (remove) um item da fila de aprovação.
 * @param {string} channel
 * @param {string} pendingId
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function rejectPendingLink(channel, pendingId) {
  if (!canModerate() || !canAccessChannel(channel)) return { ok: false, reason: 'sem-permissao' }
  const key = cleanLinksKey(channel)
  const res = await rtdbWrite(`${RTDB_LINKS_PENDING_BASE}/${key}/${pendingId}.json`, 'DELETE')
  return res.success ? { ok: true } : { ok: false, reason: 'erro-ao-rejeitar' }
}

/**
 * Remove um link já aprovado (moderação/limpeza). Somente Master.
 * @param {string} channel
 * @param {string} linkId
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function removeCommunityLink(channel, linkId) {
  if (!canModerate() || !canAccessChannel(channel)) return { ok: false, reason: 'sem-permissao' }
  const key = cleanLinksKey(channel)
  const res = await rtdbWrite(`${RTDB_LINKS_BASE}/${key}/${linkId}.json`, 'DELETE')
  if (res.success) await invalidateChannelCache(channel)
  return res.success ? { ok: true } : { ok: false, reason: 'erro-ao-remover' }
}

/**
 * Edita um link já aprovado (título/URL/tipo). Moderadores, canal permitido.
 * @param {string} channel
 * @param {string} linkId
 * @param {{title?: string, url?: string, type?: string}} patchInput
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function updateCommunityLink(channel, linkId, patchInput) {
  if (!canModerate() || !canAccessChannel(channel)) return { ok: false, reason: 'sem-permissao' }
  const patch = buildLinkPatch(patchInput)
  if (!Object.keys(patch).length) return { ok: false, reason: 'nada-a-atualizar' }
  const key = cleanLinksKey(channel)
  const res = await rtdbWrite(`${RTDB_LINKS_BASE}/${key}/${linkId}.json`, 'PATCH', patch)
  if (!res.success) return { ok: false, reason: 'erro-ao-editar' }
  await patchCachedLink(channel, linkId, patch)
  return { ok: true }
}

/**
 * Edita um item ainda pendente (antes de aprovar). Moderadores, canal permitido.
 * @param {string} channel
 * @param {string} pendingId
 * @param {{title?: string, url?: string, type?: string}} patchInput
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function updatePendingLink(channel, pendingId, patchInput) {
  if (!canModerate() || !canAccessChannel(channel)) return { ok: false, reason: 'sem-permissao' }
  const patch = buildLinkPatch(patchInput)
  if (!Object.keys(patch).length) return { ok: false, reason: 'nada-a-atualizar' }
  const key = cleanLinksKey(channel)
  const res = await rtdbWrite(`${RTDB_LINKS_PENDING_BASE}/${key}/${pendingId}.json`, 'PATCH', patch)
  return res.success ? { ok: true } : { ok: false, reason: 'erro-ao-editar' }
}

// ─── INTERAÇÃO: CURTIR ───────────────────────────────────────────────────────

/**
 * Alterna a curtida do usuário atual em um link aprovado (modelo escalável).
 *
 * Em vez de um mapa likes/{userId} (que incharia o payload conforme a curtida
 * fica popular), guardamos apenas um inteiro `likeCount` no servidor e o estado
 * "curtido por mim" localmente (chrome.storage.local). Isso mantém o tamanho de
 * cada link constante, independentemente de quantas curtidas ele tenha.
 *
 * Atualiza o cache local no lugar (sem invalidar/reler o canal), suportando a
 * UI otimista. Retorna a nova contagem para a tela refletir imediatamente.
 *
 * Observações de trade-off:
 *  - Anti-curtida-dupla é por dispositivo (estado local).
 *  - O incremento é "ler-somar-gravar" (sem transação): uma corrida rara entre
 *    dois usuários no mesmo instante pode causar off-by-one. Tolerável p/ likes.
 *
 * @param {string} channel
 * @param {string} linkId
 * @param {boolean} liked Estado desejado (true = curtir, false = descurtir).
 * @returns {Promise<{ok: boolean, likeCount?: number}>}
 */
async function toggleLike(channel, linkId, liked) {
  const key = cleanLinksKey(channel)
  const path = `${RTDB_LINKS_BASE}/${key}/${linkId}/likeCount.json`

  const current = Number(await rtdbRead(path)) || 0
  const next = Math.max(0, current + (liked ? 1 : -1))

  const res = await rtdbWrite(path, 'PUT', next)
  if (!res.success) return { ok: false }

  await setVotedLocal(channel, linkId, liked)
  await patchCachedLink(channel, linkId, { likeCount: next })
  return { ok: true, likeCount: next }
}

// ─── GUIA PESSOAL (SOMENTE LOCAL) ────────────────────────────────────────────

/**
 * Lê a lista pessoal do técnico (chrome.storage.local).
 * @returns {Promise<Array<object>>}
 */
async function getPersonalLinks() {
  try {
    const stored = await chrome.storage.local.get([PERSONAL_LINKS_KEY])
    return Array.isArray(stored[PERSONAL_LINKS_KEY]) ? stored[PERSONAL_LINKS_KEY] : []
  } catch (e) {
    sgdWarn('[Links] Erro ao ler guia pessoal:', e)
    return []
  }
}

/**
 * Persiste a lista pessoal e notifica outras abas.
 * @param {Array<object>} list
 */
async function savePersonalLinks(list) {
  await chrome.storage.local.set({ [PERSONAL_LINKS_KEY]: list })
  if (sgdLinksChannel) {
    try { sgdLinksChannel.postMessage({ type: 'personal-updated' }) } catch (e) {}
  }
}

/**
 * Adiciona um link diretamente à guia pessoal (uso manual, sem comunidade).
 * @param {{url: string, title: string, type?: string, channel?: string}} input
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function addPersonalLink(input) {
  const { url, title, type, channel } = input || {}
  if (!isValidUrl(url)) return { ok: false, reason: 'url-invalida' }
  if (!title || !title.trim()) return { ok: false, reason: 'titulo-vazio' }

  const list = await getPersonalLinks()
  const urlNorm = normalizeUrl(url)
  if (list.some(l => l.urlNorm === urlNorm)) return { ok: false, reason: 'duplicado' }

  list.push({
    id: genLinkId(),
    url: url.trim(),
    urlNorm,
    title: title.trim(),
    type: LINK_TYPES.includes(type) ? type : 'geral',
    channel: channel || 'Geral',
    source: 'own',
    sourceId: null,
    addedAt: Date.now()
  })
  await savePersonalLinks(list)
  return { ok: true }
}

/**
 * Edita um link da guia pessoal (local): título/URL/tipo/canal.
 * @param {string} personalId
 * @param {{title?: string, url?: string, type?: string, channel?: string}} patchInput
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function updatePersonalLink(personalId, patchInput) {
  const list = await getPersonalLinks()
  const idx = list.findIndex(l => l.id === personalId)
  if (idx < 0) return { ok: false, reason: 'nao-encontrado' }
  const patch = buildLinkPatch(patchInput)
  if (!Object.keys(patch).length) return { ok: false, reason: 'nada-a-atualizar' }
  list[idx] = { ...list[idx], ...patch }
  await savePersonalLinks(list)
  return { ok: true }
}

/**
 * Verifica se um link da comunidade já está salvo no Pessoal.
 * @param {object} communityLink
 * @returns {Promise<boolean>}
 */
async function isSavedToPersonal(communityLink) {
  const list = await getPersonalLinks()
  const urlNorm = communityLink.urlNorm || normalizeUrl(communityLink.url)
  return list.some(l => l.urlNorm === urlNorm)
}

/**
 * Salva (coração) um link da comunidade no Pessoal e incrementa o contador
 * de salvamentos no RTDB. Idempotente: se já existe, não duplica.
 * @param {object} communityLink Link normalizado da comunidade.
 * @returns {Promise<{ok: boolean, saveCount?: number}>}
 */
async function saveCommunityLinkToPersonal(communityLink) {
  const list = await getPersonalLinks()
  const urlNorm = communityLink.urlNorm || normalizeUrl(communityLink.url)
  if (list.some(l => l.urlNorm === urlNorm)) return { ok: true }

  list.push({
    id: genLinkId(),
    url: communityLink.url,
    urlNorm,
    title: communityLink.title,
    type: communityLink.type || 'geral',
    channel: communityLink.channel || 'Geral',
    source: 'community',
    sourceId: communityLink.id || null,
    addedAt: Date.now()
  })
  await savePersonalLinks(list)

  // Incrementa saveCount no RTDB e atualiza o cache no lugar (UI otimista),
  // sem invalidar/reler o canal inteiro.
  let saveCount
  if (communityLink.channel && communityLink.id) {
    const key = cleanLinksKey(communityLink.channel)
    const path = `${RTDB_LINKS_BASE}/${key}/${communityLink.id}/saveCount.json`
    const current = Number(await rtdbRead(path)) || 0
    saveCount = current + 1
    await rtdbWrite(path, 'PUT', saveCount)
    await patchCachedLink(communityLink.channel, communityLink.id, { saveCount })
  }
  return { ok: true, saveCount }
}

/**
 * Remove um link do Pessoal. Se veio da comunidade, decrementa saveCount.
 * @param {string} personalId ID local do item no Pessoal.
 * @returns {Promise<{ok: boolean, channel?: string, sourceId?: string, saveCount?: number}>}
 */
async function removeFromPersonal(personalId) {
  const list = await getPersonalLinks()
  const item = list.find(l => l.id === personalId)
  if (!item) return { ok: false }

  const next = list.filter(l => l.id !== personalId)
  await savePersonalLinks(next)

  let saveCount
  if (item.source === 'community' && item.channel && item.sourceId) {
    const key = cleanLinksKey(item.channel)
    const path = `${RTDB_LINKS_BASE}/${key}/${item.sourceId}/saveCount.json`
    const current = Number(await rtdbRead(path)) || 0
    saveCount = Math.max(0, current - 1)
    await rtdbWrite(path, 'PUT', saveCount)
    await patchCachedLink(item.channel, item.sourceId, { saveCount })
  }
  return { ok: true, channel: item.channel, sourceId: item.sourceId, saveCount }
}

// ─── ORDENAÇÃO E BUSCA (CLIENT-SIDE) ─────────────────────────────────────────

/**
 * Ordena uma lista de links da comunidade por critério.
 * 'relevance' = score combinando curtidas + salvamentos e recência.
 * @param {Array<object>} links
 * @param {'relevance'|'recent'|'saved'} [mode='relevance']
 * @returns {Array<object>} Nova lista ordenada.
 */
function sortCommunityLinks(links, mode = 'relevance') {
  const arr = [...links]
  if (mode === 'recent') {
    return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  }
  if (mode === 'saved') {
    return arr.sort((a, b) => (b.saveCount || 0) - (a.saveCount || 0))
  }
  // Relevância: (curtidas + salvamentos*2) decaindo com a idade (em horas).
  const now = Date.now()
  const score = l => {
    const ageHours = Math.max(0, (now - (l.createdAt || now)) / 3_600_000)
    const weight = (l.likeCount || 0) + (l.saveCount || 0) * 2
    return (weight + 1) / Math.pow(ageHours + 2, 0.4)
  }
  return arr.sort((a, b) => score(b) - score(a))
}

/**
 * Filtra links por texto (título/URL) e por tipos selecionados.
 * @param {Array<object>} links
 * @param {{query?: string, types?: string[]}} [opts]
 * @returns {Array<object>}
 */
function filterLinks(links, opts = {}) {
  const query = normalizeName(opts.query || '')
  const types = Array.isArray(opts.types) ? opts.types : []
  return links.filter(l => {
    if (types.length && !types.includes(l.type)) return false
    if (!query) return true
    const hay = normalizeName(`${l.title} ${l.url}`)
    return hay.includes(query)
  })
}

// ─── EXPORTS GLOBAIS ─────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.sgdLinksService = {
    // constantes úteis à UI
    LINK_TYPES,
    ALL_CHANNELS,
    // identidade / canais
    getLinksUserIdentity,
    isLinksMaster,
    canModerate,
    canAccessChannel,
    getLinkChannels,
    getAccessibleChannels,
    // comunidade
    fetchCommunityLinks,
    fetchCommunityLinksAll,
    invalidateChannelCache,
    findDuplicateLink,
    submitCommunityLink,
    toggleLike,
    // moderação
    fetchPendingLinks,
    fetchPendingAll,
    approvePendingLink,
    rejectPendingLink,
    removeCommunityLink,
    updateCommunityLink,
    updatePendingLink,
    // pessoal
    getPersonalLinks,
    addPersonalLink,
    updatePersonalLink,
    isSavedToPersonal,
    saveCommunityLinkToPersonal,
    removeFromPersonal,
    // utilidades de exibição
    sortCommunityLinks,
    filterLinks,
    normalizeUrl
  }
}
