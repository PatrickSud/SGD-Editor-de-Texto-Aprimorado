/**
 * @file chat-viewer-service.js
 * Visualizador de conversas de atendimento (chat .txt) e transcrições telefônicas
 * dentro do SGD. Injeta um botão "Visualizar Chat" ao lado dos anexos .txt de
 * chat (sscpre*.txt) na célula "td:anexo" e abre um modal formatado estilo
 * conversa, com abas de Conversa, Transcrição e Arquivos (mídias).
 *
 * Baseado na extensão independente "Chat TXT Viewer" (autoria original de
 * Ruan Fiori Marcelino), reescrita para integrar-se à SGD - PowerTools:
 * reaproveita escapeHTML, showNotification, o SgdRequestCoordinator (dedup/cache
 * de rede) e as variáveis de tema do projeto; carrega o JSZip sob demanda.
 */

;(function () {
  if (!location.hostname.includes('sgd.dominiosistemas.com.br')) return

  // ─── Constantes ────────────────────────────────────────────────────────────
  const CHAT_VIEWER_PREF_KEY = 'enableChatViewer'
  const CHAT_FETCH_MAX_AGE_MS = 60 * 1000 // reabrir o mesmo arquivo em 1min = instantâneo

  const IMAGE_DOMAINS = ['storage.plug.social']
  const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?.*)?$/i
  const VIDEO_EXT = /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i
  const DOCUMENT_EXT = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|txt|csv)(\?.*)?$/i
  const URL_REGEX = /https?:\/\/[^\s<>"]+/g

  const MSG_REGEX =
    /^(CLIENTE|BOT|ATENDENTE)\s*\((\d{2}\/\d{2}\/\d{4}\s[\d:]+)\):\s*([\s\S]*)/i

  const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/zip': 'zip',
    'text/plain': 'txt',
    'text/csv': 'csv'
  }

  const DOC_COLORS = {
    PDF: '#e53935',
    DOC: '#1565c0',
    DOCX: '#1565c0',
    XLS: '#2e7d32',
    XLSX: '#2e7d32',
    PPT: '#e65100',
    PPTX: '#e65100',
    ZIP: '#6d4c41',
    RAR: '#6d4c41',
    CSV: '#00838f',
    TXT: '#546e7a'
  }

  // ─── Utilitários ─────────────────────────────────────────────────────────────

  /**
   * Escapa HTML para prevenir XSS. Usa a função global do projeto se existir,
   * senão cai num fallback local equivalente.
   * @param {string} str - Texto potencialmente inseguro
   * @returns {string} Texto escapado
   */
  function safeHtml(str) {
    if (typeof escapeHTML === 'function') return escapeHTML(str)
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function decodeHtmlEntities(str) {
    return String(str ?? '')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  }

  // Tags de formatação simples permitidas no corpo do chat (o SGD injeta
  // <strong>, <br> etc. no próprio texto do .txt). Apenas tags SEM atributos
  // são reabilitadas — qualquer coisa com atributo (onerror, href, src...)
  // permanece escapada, preservando a proteção contra XSS.
  const ALLOWED_TAGS = 'strong|b|i|em|u|s|br|p|ul|ol|li'
  const ALLOWED_TAG_RE = new RegExp(`&lt;(/?)(${ALLOWED_TAGS})\\s*/?&gt;`, 'gi')

  /**
   * Escapa o texto (anti-XSS) e depois reabilita somente as tags de formatação
   * da whitelist, sem atributos.
   * @param {string} str - Texto bruto
   * @returns {string} HTML seguro com formatação básica
   */
  function formatText(str) {
    return safeHtml(str).replace(ALLOWED_TAG_RE, (_m, slash, tag) => {
      const t = tag.toLowerCase()
      return t === 'br' ? '<br>' : `<${slash}${t}>`
    })
  }

  function isBlankMessage(text) {
    const s = text
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, '')
      .trim()
    return s === '' || s.toLowerCase() === 'null'
  }

  /**
   * Valida se a URL é http/https antes de usá-la em href/src.
   * @param {string} url - URL a validar
   * @returns {boolean}
   */
  function isSafeUrl(url) {
    try {
      const u = new URL(url)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }

  // Detecção "rápida" só pela URL (sem rede) — fallback quando o typeMap não souber
  function mediaType(url) {
    const clean = url.replace(/[)>\s]+$/, '')
    if (IMAGE_EXT.test(clean)) return 'image'
    try {
      const host = new URL(clean).hostname
      if (IMAGE_DOMAINS.some(d => host.includes(d))) return 'image'
    } catch {}
    if (VIDEO_EXT.test(clean)) return 'video'
    if (DOCUMENT_EXT.test(clean)) return 'document'
    return null
  }

  // Detecção "real": usa o typeMap (resolvido via HEAD) e cai no fallback
  function resolvedType(url, typeMap) {
    const clean = url.replace(/[)>\s]+$/, '')
    return typeMap?.get(clean)?.type ?? mediaType(clean)
  }

  function mimeToType(contentType) {
    const ct = (contentType || '').split(';')[0].trim().toLowerCase()
    if (ct.startsWith('image/')) return 'image'
    if (ct.startsWith('video/')) return 'video'
    if (MIME_TO_EXT[ct]) return 'document'
    return null
  }

  /**
   * Resolve o tipo de cada URL de mídia. Primeiro tenta pela extensão (sem rede);
   * as ambíguas são consultadas via HEAD, mas com concorrência limitada para não
   * disparar dezenas de requisições simultâneas ao storage.
   * @param {Array} messages - Mensagens já parseadas
   * @returns {Promise<Map>} url -> { type, ext }
   */
  async function resolveMediaTypes(messages) {
    const urls = new Set()
    for (const msg of messages) {
      for (const raw of msg.text.match(URL_REGEX) || []) {
        urls.add(raw.replace(/[)>\s]+$/, ''))
      }
    }

    const typeMap = new Map()
    const ambiguous = []

    for (const url of urls) {
      // IMPORTANTE: não assumir tipo pelo domínio aqui. URLs de storage.plug.social
      // vêm sem extensão e podem ser imagem, vídeo OU documento (ex.: PDF). Só o
      // HEAD (Content-Type) diz o tipo real — assumir "imagem" quebrava os PDFs.
      if (IMAGE_EXT.test(url)) typeMap.set(url, { type: 'image' })
      else if (VIDEO_EXT.test(url)) typeMap.set(url, { type: 'video' })
      else if (DOCUMENT_EXT.test(url)) typeMap.set(url, { type: 'document' })
      else ambiguous.push(url)
    }

    // HEAD só para as ambíguas, em lotes de 6 para limitar carga/CORS
    const BATCH = 6
    for (let i = 0; i < ambiguous.length; i += BATCH) {
      const slice = ambiguous.slice(i, i + BATCH)
      await Promise.all(
        slice.map(async url => {
          try {
            const res = await fetch(url, { method: 'HEAD' })
            const ct = res.headers.get('Content-Type') || ''
            const type = mimeToType(ct)
            const ext = MIME_TO_EXT[ct.split(';')[0].trim().toLowerCase()] || null
            typeMap.set(url, { type, ext })
          } catch {
            typeMap.set(url, { type: null, ext: null })
          }
        })
      )
    }

    return typeMap
  }

  function ensureExtension(name, blob) {
    if (/\.[a-z0-9]{2,5}$/i.test(name)) return name
    const ext = MIME_TO_EXT[blob.type]
    return ext ? `${name}.${ext}` : name
  }

  function fileExtIcon(url, typeMap) {
    let ext = url.match(/\.([a-z0-9]+)(\?|$)/i)?.[1]?.toUpperCase()
    if (!ext) ext = typeMap?.get(url)?.ext?.toUpperCase()
    ext = ext || 'FILE'
    const bg = DOC_COLORS[ext] || '#757575'
    return { ext, bg }
  }

  function filename(url) {
    try {
      return decodeURIComponent(url.split('/').pop().split('?')[0]) || url
    } catch {
      return url
    }
  }

  // ─── Rede (via coordinator) ────────────────────────────────────────────────

  /**
   * Baixa o texto do arquivo de chat/transcrição roteando pelo
   * SgdRequestCoordinator (single-flight + cache curto) quando disponível,
   * evitando baixar o mesmo arquivo em paralelo entre abas.
   * @param {string} url - URL do arquivo .txt
   * @returns {Promise<string>} Conteúdo bruto
   */
  async function fetchChatText(url) {
    const producer = async () => {
      const resp = await fetch(url, { credentials: 'include' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return await resp.text()
    }

    if (window.SgdRequestCoordinator?.run) {
      try {
        const { result } = await window.SgdRequestCoordinator.run(
          `chatViewer:${url}`,
          producer,
          { maxAgeMs: CHAT_FETCH_MAX_AGE_MS, persist: false }
        )
        return result
      } catch {
        // Coordinator ocupado/indisponível → busca direta
        return await producer()
      }
    }
    return await producer()
  }

  async function fetchAsBlob(url) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.blob()
  }

  function triggerBlobDownload(blob, name) {
    const blobUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  }

  async function downloadSingleFile(url, name, btnEl) {
    const original = btnEl ? btnEl.innerHTML : null
    try {
      if (btnEl) btnEl.innerHTML = '⏳'
      const blob = await fetchAsBlob(url)
      triggerBlobDownload(blob, ensureExtension(name, blob))
    } catch (err) {
      if (typeof showNotification === 'function') {
        showNotification('Erro ao baixar arquivo: ' + err.message, 'error')
      } else {
        alert('Erro ao baixar arquivo:\n' + err.message)
      }
    } finally {
      if (btnEl && original) btnEl.innerHTML = original
    }
  }

  /**
   * Garante que o JSZip esteja carregado. Ele NÃO é carregado no boot da página:
   * só é injetado (via service worker + chrome.scripting) na primeira vez que o
   * usuário clica em "Baixar tudo", economizando ~96KB no carregamento comum.
   * @returns {Promise<boolean>} true se o JSZip ficou disponível
   */
  async function ensureJSZip() {
    if (typeof JSZip !== 'undefined' || window.JSZip) return true
    try {
      await chrome.runtime.sendMessage({ action: 'LOAD_JSZIP' })
    } catch (err) {
      sgdWarn?.('[ChatViewer] Falha ao pedir injeção do JSZip:', err)
    }
    // Aguarda o script injetado registrar o global (poll curto)
    for (let i = 0; i < 40; i++) {
      if (typeof JSZip !== 'undefined' || window.JSZip) return true
      await new Promise(r => setTimeout(r, 50))
    }
    return typeof JSZip !== 'undefined' || !!window.JSZip
  }

  async function downloadAllAsZip(items, btnEl) {
    const original = btnEl ? btnEl.innerHTML : null

    if (btnEl) btnEl.innerHTML = '⏳ Preparando...'
    const ready = await ensureJSZip()
    if (!ready) {
      if (btnEl && original) btnEl.innerHTML = original
      if (typeof showNotification === 'function') {
        showNotification('Não foi possível carregar o compactador (JSZip).', 'error')
      }
      return
    }

    const ZipLib = window.JSZip || JSZip
    const zip = new ZipLib()
    const usedNames = new Set()

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (btnEl) btnEl.innerHTML = `⏳ Compactando (${i + 1}/${items.length})...`
      try {
        const blob = await fetchAsBlob(item.url)
        const name = ensureExtension(item.filename, blob)
        let finalName = name
        let counter = 1
        while (usedNames.has(finalName)) {
          const dot = name.lastIndexOf('.')
          finalName =
            dot > -1
              ? `${name.slice(0, dot)}(${counter})${name.slice(dot)}`
              : `${name}(${counter})`
          counter++
        }
        usedNames.add(finalName)
        zip.file(finalName, blob)
      } catch (err) {
        sgdWarn?.('[ChatViewer] Falha ao incluir no zip:', item.url, err)
      }
    }

    if (btnEl) btnEl.innerHTML = '📦 Gerando arquivo .zip...'
    const content = await zip.generateAsync({ type: 'blob' })
    triggerBlobDownload(content, 'midias-conversa.zip')

    if (btnEl && original) btnEl.innerHTML = original
  }

  // ─── Rótulos dos participantes ──────────────────────────────────────────────

  /**
   * Rótulo genérico de cada participante. Mantido propositalmente genérico:
   * o usuário logado no SGD (#td:usuario_nome) é o técnico que está VENDO a
   * conversa, não o atendente que participou dela; e o nome do cliente que
   * digita no chat também não corresponde à razão social. Usar esses campos
   * confundia os papéis, então voltamos a Cliente / Atendente / Bot.
   * @param {string} sender - CLIENTE | ATENDENTE | BOT
   * @returns {string}
   */
  function senderLabel(sender) {
    if (sender === 'BOT') return '🤖 Bot'
    if (sender === 'ATENDENTE') return '👤 Atendente'
    if (sender === 'CLIENTE') return '🙋 Cliente'
    return sender
  }

  // ─── Parsers ─────────────────────────────────────────────────────────────────

  function parseTxt(raw) {
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = text.split('\n')
    const messages = []
    let current = null

    for (const line of lines) {
      const match = line.match(MSG_REGEX)
      if (match) {
        if (current) messages.push(current)
        current = {
          sender: match[1].toUpperCase(),
          time: match[2],
          text: match[3]
        }
      } else if (current) {
        current.text += '\n' + line
      }
    }
    if (current) messages.push(current)
    return messages.filter(m => !isBlankMessage(m.text))
  }

  /**
   * Faz o parse da transcrição telefônica, cujo formato é uma tabela
   * "Autor | Horário | Frase". Retorna linhas simples para exibição.
   * @param {string} raw - Conteúdo bruto do arquivo de transcrição
   * @returns {Array<{ autor: string, hora: string, frase: string }>}
   */
  function parseTranscricao(raw) {
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const linhas = []
    for (const linha of text.split('\n')) {
      const limpa = linha.trim()
      if (!limpa) continue
      // Ignora cabeçalho/separadores comuns
      if (/^autor\b/i.test(limpa)) continue
      if (/^[-|+\s]+$/.test(limpa)) continue

      const partes = limpa.split('|').map(p => p.trim())
      if (partes.length >= 3) {
        linhas.push({ autor: partes[0], hora: partes[1], frase: partes.slice(2).join(' | ') })
      } else {
        linhas.push({ autor: '', hora: '', frase: limpa })
      }
    }
    return linhas
  }

  // ─── Extração de mídias ──────────────────────────────────────────────────────

  function extractMedia(messages, typeMap) {
    const images = []
    const videos = []
    const documents = []
    const seen = new Set()
    for (const msg of messages) {
      const urls = msg.text.match(URL_REGEX) || []
      for (const raw of urls) {
        const url = raw.replace(/[)>\s]+$/, '')
        if (seen.has(url)) continue // deduplica mídias repetidas
        seen.add(url)
        const type = resolvedType(url, typeMap)
        const item = { url, sender: msg.sender, time: msg.time }
        if (type === 'image') images.push(item)
        else if (type === 'video') videos.push(item)
        else if (type === 'document') documents.push(item)
      }
    }
    return { images, videos, documents }
  }

  // ─── Renderização segura do corpo da mensagem ────────────────────────────────

  function renderUrl(clean, typeMap) {
    if (!isSafeUrl(clean)) return safeHtml(clean)
    const safeUrl = safeHtml(clean)
    const type = resolvedType(clean, typeMap)

    if (type === 'image') {
      // data-sgd-img-url permite trocar por link de documento se o carregamento
      // falhar (ex.: URL sem extensão que na verdade é um PDF).
      return `<a href="${safeUrl}" target="_blank" rel="noopener" class="sgd-chat-img-link">
                <img src="${safeUrl}" class="sgd-chat-img" alt="imagem" loading="lazy" data-sgd-img-url="${safeUrl}"/>
              </a>`
    }
    if (type === 'video') {
      return `<div class="sgd-chat-video-wrap">
                <video class="sgd-chat-video" controls preload="metadata">
                  <source src="${safeUrl}">
                </video>
              </div>`
    }
    if (type === 'document') {
      const { ext, bg } = fileExtIcon(clean, typeMap)
      return `<a href="${safeUrl}" target="_blank" rel="noopener" download class="sgd-chat-doc-link">
                <span class="sgd-chat-doc-icon" style="background:${safeHtml(bg)}">${safeHtml(ext)}</span>
                <span class="sgd-chat-doc-name">${safeHtml(filename(clean))}</span>
              </a>`
    }
    return `<a href="${safeUrl}" target="_blank" rel="noopener" class="sgd-chat-link">${safeUrl}</a>`
  }

  /**
   * Escapa o texto e transforma URLs http/https em links/mídia clicáveis
   * (via renderUrl), SEM interpretar tags de formatação. Usado no resumo por IA.
   * @param {string} text - Texto plano (pode conter URLs)
   * @param {Map} typeMap - Tipos de mídia resolvidos
   * @returns {string} HTML seguro
   */
  function linkifyText(text, typeMap) {
    const re = new RegExp(URL_REGEX.source, 'g')
    let out = ''
    let lastIndex = 0
    let match
    while ((match = re.exec(text)) !== null) {
      out += safeHtml(text.slice(lastIndex, match.index))
      const rawUrl = match[0]
      const clean = rawUrl.replace(/[)>\s]+$/, '')
      out += renderUrl(clean, typeMap)
      const trailing = rawUrl.slice(clean.length)
      if (trailing) out += safeHtml(trailing)
      lastIndex = match.index + rawUrl.length
    }
    out += safeHtml(text.slice(lastIndex))
    return out
  }

  /**
   * Monta o HTML do corpo da mensagem de forma segura: o texto é sempre escapado
   * (anti-XSS) e apenas as URLs reconhecidas viram links/mídia.
   * @param {string} rawText - Texto bruto da mensagem
   * @param {Map} typeMap - Tipos de mídia resolvidos
   * @returns {string} HTML seguro
   */
  function renderBody(rawText, typeMap) {
    const decoded = decodeHtmlEntities(rawText)
    const re = new RegExp(URL_REGEX.source, 'g')
    let out = ''
    let lastIndex = 0
    let match

    while ((match = re.exec(decoded)) !== null) {
      const before = decoded.slice(lastIndex, match.index)
      out += formatText(before).replace(/\n/g, '<br>')

      const rawUrl = match[0]
      const clean = rawUrl.replace(/[)>\s]+$/, '')
      out += renderUrl(clean, typeMap)

      const trailing = rawUrl.slice(clean.length)
      if (trailing) out += safeHtml(trailing)

      lastIndex = match.index + rawUrl.length
    }
    out += formatText(decoded.slice(lastIndex)).replace(/\n/g, '<br>')

    // Limpeza de <br> em excesso ao redor de mídias
    out = out.replace(/(<br\s*\/?>)+(\s*<a class="sgd-chat-img-link")/gi, '$2')
    out = out.replace(/(<\/a>)\s*(<br\s*\/?>)+/gi, '$1')
    out = out.replace(/^(<br\s*\/?>)+/, '').replace(/(<br\s*\/?>)+$/, '')
    out = out.replace(/(<br\s*\/?>){3,}/gi, '<br><br>')
    return out
  }

  /**
   * Cria um link de documento (chip) para uma URL — usado tanto na renderização
   * normal quanto no fallback quando uma "imagem" na verdade não é imagem.
   * @param {string} url - URL do arquivo
   * @param {Map} typeMap - Tipos resolvidos (para ícone/extensão)
   * @returns {HTMLElement}
   */
  function buildDocLink(url, typeMap) {
    const { ext, bg } = fileExtIcon(url, typeMap)
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener'
    link.setAttribute('download', '')
    link.className = 'sgd-chat-doc-link'

    const icon = document.createElement('span')
    icon.className = 'sgd-chat-doc-icon'
    icon.style.background = bg
    icon.textContent = ext

    const name = document.createElement('span')
    name.className = 'sgd-chat-doc-name'
    name.textContent = filename(url)

    link.appendChild(icon)
    link.appendChild(name)
    return link
  }

  /**
   * Prepara as imagens inline do chat: (1) clicar abre o lightbox DENTRO da
   * interação (não em nova guia), navegável pela galeria; (2) se a imagem
   * falhar ao carregar (era um PDF/arquivo sem extensão), vira link de documento.
   * @param {HTMLElement} container - Elemento que contém as imagens
   * @param {Map} typeMap - Tipos resolvidos
   * @param {Array<string>} gallery - URLs de todas as imagens (para navegar)
   */
  function attachImageFallback(container, typeMap, gallery) {
    const imgs = container.querySelectorAll('img.sgd-chat-img[data-sgd-img-url]')
    for (const img of imgs) {
      const url = img.dataset.sgdImgUrl

      // Abrir no lightbox em vez de navegar para outra guia
      const anchor = img.closest('.sgd-chat-img-link')
      const openHandler = e => {
        e.preventDefault()
        e.stopPropagation()
        openLightbox(url, gallery)
      }
      ;(anchor || img).addEventListener('click', openHandler)

      img.addEventListener('error', () => {
        const target = img.closest('.sgd-chat-img-link') || img
        const docLink = buildDocLink(url, typeMap)
        target.replaceWith(docLink)
      })
    }
  }

  function renderMessage(msg, typeMap, gallery) {
    const textOnly = msg.text
      .replace(URL_REGEX, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, '')
      .trim()
    const urls = msg.text.match(URL_REGEX) || []
    const allMedia =
      urls.length > 0 &&
      urls.every(u => resolvedType(u.replace(/[)>\s]+$/, ''), typeMap) !== null)
    const isMediaOnly = allMedia && textOnly === ''

    const wrapper = document.createElement('div')
    wrapper.className = `sgd-chat-msg sgd-chat-msg--${msg.sender.toLowerCase()}`
    // guarda o texto plano para a busca
    wrapper.dataset.searchText = (senderLabel(msg.sender) + ' ' + textOnly).toLowerCase()

    const senderName = document.createElement('div')
    senderName.className = 'sgd-chat-sender-name'
    senderName.textContent = senderLabel(msg.sender)
    wrapper.appendChild(senderName)

    const bubble = document.createElement('div')
    bubble.className = isMediaOnly
      ? 'sgd-chat-bubble sgd-chat-bubble--media-only'
      : 'sgd-chat-bubble'

    const body = document.createElement('div')
    body.className = 'sgd-chat-body'
    body.innerHTML = renderBody(msg.text, typeMap)
    attachImageFallback(body, typeMap, gallery)

    const footer = document.createElement('div')
    footer.className = 'sgd-chat-footer'

    const time = document.createElement('span')
    time.className = 'sgd-chat-time'
    time.textContent = msg.time.split(' ')[1] ?? msg.time

    footer.appendChild(time)
    bubble.appendChild(body)
    bubble.appendChild(footer)
    wrapper.appendChild(bubble)
    return wrapper
  }

  function makeSectionHeader(label, count) {
    const header = document.createElement('div')
    header.className = 'sgd-media-section-header'
    header.innerHTML = `${safeHtml(label)} <span class="sgd-media-section-count">${count}</span>`
    return header
  }

  // ─── Aba de Mídia ──────────────────────────────────────────────────────────

  /**
   * Monta uma linha de documento para a lista de Documentos da aba Arquivos.
   * @param {{url:string, sender?:string, time?:string}} item
   * @param {Map} typeMap
   * @returns {HTMLElement}
   */
  function buildDocRow(item, typeMap) {
    const { ext, bg } = fileExtIcon(item.url, typeMap)
    const name = filename(item.url)

    const row = document.createElement('div')
    row.className = 'sgd-media-doc-row'

    const icon = document.createElement('span')
    icon.className = 'sgd-media-doc-icon'
    icon.style.background = bg
    icon.textContent = ext

    const info = document.createElement('div')
    info.className = 'sgd-media-doc-info'

    const nameEl = document.createElement('span')
    nameEl.className = 'sgd-media-doc-name'
    nameEl.textContent = name

    const meta = document.createElement('span')
    meta.className = 'sgd-media-doc-meta'
    meta.textContent = [item.sender, item.time].filter(Boolean).join(' · ')

    info.appendChild(nameEl)
    info.appendChild(meta)

    const dl = document.createElement('button')
    dl.className = 'sgd-media-doc-dl'
    dl.title = 'Baixar'
    dl.innerHTML = '⬇'
    dl.addEventListener('click', () => downloadSingleFile(item.url, name, dl))

    row.appendChild(icon)
    row.appendChild(info)
    row.appendChild(dl)
    return row
  }

  function renderMediaTab(media, typeMap) {
    const container = document.createElement('div')
    container.className = 'sgd-media-tab'

    const { images, videos, documents } = media
    const total = images.length + videos.length + documents.length

    if (total === 0) {
      const empty = document.createElement('div')
      empty.className = 'sgd-media-empty'
      empty.innerHTML = '<span>📭</span><p>Nenhuma mídia encontrada nessa conversa.</p>'
      container.appendChild(empty)
      return container
    }

    const allItems = [...images, ...videos, ...documents].map(i => ({
      url: i.url,
      filename: filename(i.url)
    }))

    const dlAll = document.createElement('button')
    dlAll.className = 'sgd-media-download-all'
    dlAll.innerHTML = `⬇ Baixar tudo (${total})`
    dlAll.addEventListener('click', () => downloadAllAsZip(allItems, dlAll))
    container.appendChild(dlAll)

    // Seção de Documentos criada sob demanda: além dos documentos já detectados,
    // recebe imagens que falharem ao carregar (eram PDF/arquivo sem extensão).
    let docHeader = null
    let docList = null
    function ensureDocSection() {
      if (!docList) {
        docHeader = makeSectionHeader('Documentos', 0)
        docList = document.createElement('div')
        docList.className = 'sgd-media-doc-list'
        container.appendChild(docHeader)
        container.appendChild(docList)
      }
      return docList
    }
    function updateDocCount() {
      if (docHeader && docList) {
        const countEl = docHeader.querySelector('.sgd-media-section-count')
        if (countEl) countEl.textContent = docList.children.length
      }
    }

    if (images.length > 0) {
      const imageGallery = images.map(i => i.url)
      const imagesHeader = makeSectionHeader('Imagens', images.length)
      container.appendChild(imagesHeader)
      const grid = document.createElement('div')
      grid.className = 'sgd-media-grid'
      let imgCount = images.length
      for (const item of images) {
        const cell = document.createElement('div')
        cell.className = 'sgd-media-cell'

        const img = document.createElement('img')
        img.src = item.url
        img.loading = 'lazy'
        img.alt = 'imagem'
        img.addEventListener('click', () => openLightbox(item.url, imageGallery))
        // Se não for imagem de verdade (ex.: PDF), migra para Documentos.
        img.addEventListener('error', () => {
          cell.remove()
          imgCount = Math.max(0, imgCount - 1)
          const countEl = imagesHeader.querySelector('.sgd-media-section-count')
          if (countEl) countEl.textContent = imgCount
          if (imgCount === 0) {
            imagesHeader.remove()
            grid.remove()
          }
          ensureDocSection().appendChild(buildDocRow(item, typeMap))
          updateDocCount()
        })

        const info = document.createElement('div')
        info.className = 'sgd-media-cell-info'
        info.textContent = item.time.split(' ')[1]

        const dl = document.createElement('button')
        dl.className = 'sgd-media-cell-dl'
        dl.title = 'Baixar'
        dl.innerHTML = '⬇'
        dl.addEventListener('click', e => {
          e.stopPropagation()
          downloadSingleFile(item.url, filename(item.url), dl)
        })

        cell.appendChild(img)
        cell.appendChild(info)
        cell.appendChild(dl)
        grid.appendChild(cell)
      }
      container.appendChild(grid)
    }

    if (videos.length > 0) {
      container.appendChild(makeSectionHeader('Vídeos', videos.length))
      const grid = document.createElement('div')
      grid.className = 'sgd-media-grid sgd-media-grid--video'
      for (const item of videos) {
        const cell = document.createElement('div')
        cell.className = 'sgd-media-cell sgd-media-cell--video'

        const video = document.createElement('video')
        video.src = item.url
        video.controls = true
        video.preload = 'metadata'
        video.className = 'sgd-media-video'

        const info = document.createElement('div')
        info.className = 'sgd-media-cell-info'
        info.textContent = `${item.sender} · ${item.time.split(' ')[1]}`

        const dl = document.createElement('button')
        dl.className = 'sgd-media-cell-dl'
        dl.title = 'Baixar'
        dl.innerHTML = '⬇'
        dl.addEventListener('click', e => {
          e.stopPropagation()
          downloadSingleFile(item.url, filename(item.url), dl)
        })

        cell.appendChild(video)
        cell.appendChild(info)
        cell.appendChild(dl)
        grid.appendChild(cell)
      }
      container.appendChild(grid)
    }

    if (documents.length > 0) {
      const list = ensureDocSection()
      for (const item of documents) list.appendChild(buildDocRow(item, typeMap))
      updateDocCount()
    }

    return container
  }

  // ─── Aba de Transcrição ──────────────────────────────────────────────────────

  function renderTranscricaoTab(linhas) {
    const container = document.createElement('div')
    container.className = 'sgd-transcricao-tab'

    if (!linhas || linhas.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sgd-media-empty'
      empty.innerHTML = '<span>📞</span><p>Nenhuma transcrição telefônica nesta SSC.</p>'
      container.appendChild(empty)
      return container
    }

    for (const item of linhas) {
      const row = document.createElement('div')
      const autorLower = (item.autor || '').toLowerCase()
      const isCliente = autorLower.startsWith('cliente')
      row.className = `sgd-transcricao-row ${isCliente ? 'sgd-transcricao-row--cliente' : 'sgd-transcricao-row--atendente'}`

      if (item.autor || item.hora) {
        const meta = document.createElement('div')
        meta.className = 'sgd-transcricao-meta'
        meta.textContent = [item.autor, item.hora].filter(Boolean).join(' · ')
        row.appendChild(meta)
      }

      const frase = document.createElement('div')
      frase.className = 'sgd-transcricao-frase'
      frase.textContent = item.frase
      row.appendChild(frase)

      container.appendChild(row)
    }

    return container
  }

  // ─── Lightbox ────────────────────────────────────────────────────────────────

  /**
   * Abre a imagem em um lightbox sobreposto (dentro da interação), com navegação
   * ‹ › entre as imagens da galeria e atalhos de teclado (setas e Esc).
   * @param {string} src - URL da imagem clicada
   * @param {Array<string>} gallery - URLs de todas as imagens do contexto
   */
  function openLightbox(src, gallery) {
    if (!isSafeUrl(src)) return

    // Galeria navegável: só imagens seguras e sem duplicatas, preservando ordem.
    const list = Array.isArray(gallery) && gallery.length
      ? [...new Set(gallery.filter(isSafeUrl))]
      : [src]
    let index = Math.max(0, list.indexOf(src))
    const multiple = list.length > 1

    const lb = document.createElement('div')
    lb.className = 'sgd-chat-lightbox'
    lb.innerHTML = `
      <div class="sgd-chat-lightbox-inner">
        <img src="${safeHtml(list[index])}" alt="imagem" class="sgd-lb-img"/>
        <div class="sgd-lb-actions">
          <span class="sgd-lb-counter"></span>
          <button class="sgd-lb-dl">⬇ Baixar</button>
        </div>
        <button class="sgd-lb-prev" title="Anterior (←)" ${multiple ? '' : 'style="display:none"'}>&#8249;</button>
        <button class="sgd-lb-next" title="Próxima (→)" ${multiple ? '' : 'style="display:none"'}>&#8250;</button>
        <button class="sgd-lb-close" title="Fechar (Esc)">&#x2715;</button>
      </div>`

    const imgEl = lb.querySelector('.sgd-lb-img')
    const counterEl = lb.querySelector('.sgd-lb-counter')

    function render() {
      imgEl.src = list[index]
      counterEl.textContent = multiple ? `${index + 1} / ${list.length}` : ''
    }
    function go(delta) {
      if (!multiple) return
      index = (index + delta + list.length) % list.length
      render()
    }

    lb.querySelector('.sgd-lb-prev').addEventListener('click', e => {
      e.stopPropagation()
      go(-1)
    })
    lb.querySelector('.sgd-lb-next').addEventListener('click', e => {
      e.stopPropagation()
      go(1)
    })
    lb.querySelector('.sgd-lb-dl').addEventListener('click', e => {
      e.stopPropagation()
      downloadSingleFile(list[index], filename(list[index]), e.currentTarget)
    })

    function close() {
      lb.remove()
      document.removeEventListener('keydown', onKey)
    }
    const onKey = e => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }

    lb.querySelector('.sgd-lb-close').addEventListener('click', close)
    lb.addEventListener('click', e => {
      if (e.target === lb) close()
    })
    document.addEventListener('keydown', onKey)

    render()
    document.body.appendChild(lb)
  }

  // ─── Resumo da conversa via IA ───────────────────────────────────────────

  /**
   * Converte HTML/entidades do texto de uma mensagem em texto plano, preservando
   * URLs (que o resumo precisa listar).
   * @param {string} html
   * @returns {string}
   */
  function toPlainText(html) {
    return decodeHtmlEntities(html)
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  /**
   * Monta o prompt de resumo do atendimento (mesmo formato usado no pré-resumo
   * do Sugestor SS), a partir das mensagens do chat e da transcrição telefônica.
   * @param {Array} messages
   * @param {Array|null} transcricao
   * @returns {string}
   */
  function buildResumoPrompt(messages, transcricao) {
    const chatLog = messages
      .map(m => `${senderLabel(m.sender)} (${m.time}): ${toPlainText(m.text)}`)
      .join('\n')

    let extra = ''
    if (transcricao && transcricao.length) {
      const linhas = transcricao
        .map(t => [t.autor, t.hora, t.frase].filter(Boolean).join(' '))
        .join('\n')
      extra = `\n\nTRANSCRIÇÃO TELEFÔNICA:\n${linhas}`
    }

    return `Você receberá o log de um atendimento de suporte via chat entre um cliente e analistas.

Sua tarefa é extrair APENAS as informações relevantes para abertura de um ticket de suporte N2, no seguinte formato:

PROBLEMA RELATADO:
[Descreva em 2-3 frases o problema principal que o cliente reportou]

O QUE JÁ FOI ANALISADO:
[Liste em bullet points com hífen o que foi verificado, testado ou identificado durante o atendimento]

INFORMAÇÕES TÉCNICAS:
[Liste dados técnicos mencionados: empresa, código, senhas, versões, módulos, configurações relevantes. Se não houver, escreva "N/A"]

IMAGENS/ARQUIVOS FORNECIDOS:
[Liste as URLs de imagens ou arquivos que o cliente enviou, uma por linha com hífen. Se não houver, escreva "N/A"]

REGRAS:
- Ignore saudações, mensagens automáticas e despedidas
- Ignore perguntas do bot que não foram respondidas
- Seja objetivo e direto
- Não invente informações que não estão no chat

LOG DO CHAT:
${chatLog}${extra}`
  }

  /**
   * Pede o resumo à IA reutilizando o workflow "resumirChat" já existente no
   * service worker (mesma infra do Sugestor SS). Resolve com o texto do resumo
   * ou rejeita em erro/timeout.
   * @param {Array} messages
   * @param {Array|null} transcricao
   * @returns {Promise<string>}
   */
  function resumirConversaViaIA(messages, transcricao) {
    return new Promise((resolve, reject) => {
      const TIMEOUT_MS = 60000
      const prompt = buildResumoPrompt(messages, transcricao)

      const timeoutId = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener)
        reject(new Error('Tempo esgotado ao gerar o resumo.'))
      }, TIMEOUT_MS)

      const listener = request => {
        if (request.action === 'resumoChatCompleto') {
          clearTimeout(timeoutId)
          chrome.runtime.onMessage.removeListener(listener)
          resolve(request.data)
        } else if (request.action === 'resumoChatErro') {
          clearTimeout(timeoutId)
          chrome.runtime.onMessage.removeListener(listener)
          reject(new Error(request.data || 'Erro ao gerar o resumo.'))
        }
      }

      chrome.runtime.onMessage.addListener(listener)
      chrome.runtime.sendMessage({ action: 'resumirChat', prompt })
    })
  }

  /**
   * Formata o texto do resumo para exibição: escapa (anti-XSS), destaca os
   * cabeçalhos de seção (CAIXA ALTA terminando com ":") em negrito e mantém as
   * quebras de linha.
   * @param {string} text
   * @returns {string} HTML seguro
   */
  function formatResumoHtml(text, typeMap) {
    return text
      .split('\n')
      .map(line => {
        const t = line.trim()
        // Cabeçalhos de seção (CAIXA ALTA terminando com ":") → negrito
        if (t.length > 3 && /^[A-ZÀ-Ÿ0-9 /()\-]+:$/.test(t)) {
          return `<strong>${safeHtml(line)}</strong>`
        }
        // Demais linhas: escapa e torna URLs clicáveis (imagem/doc/link)
        return linkifyText(line, typeMap)
      })
      .join('<br>')
  }

  /**
   * Apresenta o resumo no modal padrão da extensão (createModal), sobreposto ao
   * modal do chat. URLs de imagens/arquivos ficam clicáveis (miniatura abre o
   * lightbox; PDF/arquivo vira chip de documento). Traz botão "Copiar resumo".
   * @param {string} resumoText
   * @param {Map} typeMap - Tipos de mídia resolvidos
   * @param {Array<string>} gallery - Galeria de imagens para o lightbox
   */
  function openResumoModal(resumoText, typeMap, gallery) {
    if (typeof createModal !== 'function') {
      // Fallback improvável: sem o componente de modal, ao menos notifica.
      if (typeof showNotification === 'function') {
        showNotification('Resumo gerado, mas o modal não está disponível.', 'info')
      }
      return
    }

    const contentHtml = `
      <div class="sgd-chat-ai-modal">
        <div class="sgd-chat-ai-modal-text">${formatResumoHtml(resumoText, typeMap)}</div>
        <div class="sgd-chat-ai-modal-actions">
          <button type="button" class="sgd-chat-ai-copy action-btn">📋 Copiar resumo</button>
        </div>
      </div>`

    const modal = createModal('✨ Resumo do atendimento (IA)', contentHtml, null, {
      isManagementModal: true,
      showShareButton: false,
      modalId: 'sgd-chat-ai-resumo-modal'
    })
    // Precisa ficar acima do modal do chat (z-index máximo do overlay)
    modal.style.zIndex = '2147483648'
    document.body.appendChild(modal)

    // Imagens no resumo: clicar abre o lightbox; se não for imagem, vira doc.
    const textEl = modal.querySelector('.sgd-chat-ai-modal-text')
    if (textEl) attachImageFallback(textEl, typeMap, gallery)

    const copyBtn = modal.querySelector('.sgd-chat-ai-copy')
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(resumoText)
          const original = copyBtn.innerHTML
          copyBtn.innerHTML = '✅ Copiado'
          setTimeout(() => { copyBtn.innerHTML = original }, 1500)
        } catch {
          if (typeof showNotification === 'function') {
            showNotification('Não foi possível copiar.', 'error')
          }
        }
      })
    }
  }

  // ─── Modal principal ───────────────────────────────────────────────────────

  function openModal(messages, fname, typeMap, transcricao) {
    document.getElementById('sgd-chat-viewer-modal')?.remove()

    const media = extractMedia(messages, typeMap)
    const totalMedia = media.images.length + media.videos.length + media.documents.length
    const totalTranscricao = transcricao ? transcricao.length : 0
    // Galeria de imagens (ordem da conversa) para navegação ‹ › no lightbox
    const imageGallery = media.images.map(i => i.url)

    const overlay = document.createElement('div')
    overlay.id = 'sgd-chat-viewer-modal'
    overlay.className = 'sgd-chat-overlay'

    const modal = document.createElement('div')
    modal.className = 'sgd-chat-modal'

    // ── Header
    const modalHeader = document.createElement('div')
    modalHeader.className = 'sgd-chat-modal-header'

    const title = document.createElement('span')
    title.className = 'sgd-chat-modal-title'
    title.textContent = `💬 ${fname}`

    const counter = document.createElement('span')
    counter.className = 'sgd-chat-modal-counter'
    counter.textContent = `${messages.length} mensagens`

    const aiBtn = document.createElement('button')
    aiBtn.className = 'sgd-chat-ai-btn'
    aiBtn.title = 'Gerar um resumo do atendimento com IA'
    aiBtn.innerHTML = '✨ Resumir com IA'

    const closeBtn = document.createElement('button')
    closeBtn.className = 'sgd-chat-modal-close'
    closeBtn.innerHTML = '&#x2715;'
    closeBtn.onclick = () => overlay.remove()

    modalHeader.appendChild(title)
    modalHeader.appendChild(counter)
    modalHeader.appendChild(aiBtn)
    modalHeader.appendChild(closeBtn)

    // ── Busca
    const searchWrap = document.createElement('div')
    searchWrap.className = 'sgd-chat-search'
    const searchInput = document.createElement('input')
    searchInput.type = 'text'
    searchInput.placeholder = '🔎 Buscar na conversa...'
    searchInput.className = 'sgd-chat-search-input'
    searchWrap.appendChild(searchInput)

    // ── Abas
    const tabs = document.createElement('div')
    tabs.className = 'sgd-chat-tabs'

    const tabChat = document.createElement('button')
    tabChat.className = 'sgd-chat-tab sgd-chat-tab--active'
    tabChat.textContent = 'Conversa'

    const tabTranscricao = document.createElement('button')
    tabTranscricao.className = 'sgd-chat-tab'
    tabTranscricao.innerHTML = `Transcrição <span class="sgd-tab-badge">${totalTranscricao}</span>`

    const tabMedia = document.createElement('button')
    tabMedia.className = 'sgd-chat-tab'
    tabMedia.innerHTML = `Arquivos <span class="sgd-tab-badge">${totalMedia}</span>`

    tabs.appendChild(tabChat)
    if (totalTranscricao > 0) tabs.appendChild(tabTranscricao)
    tabs.appendChild(tabMedia)

    // ── Painel Conversa
    const panelChat = document.createElement('div')
    panelChat.className = 'sgd-chat-panel sgd-chat-panel--active'

    // ── Resumo por IA: gera 1x (cacheia) e apresenta no modal padrão da extensão
    let aiResumoCache = null
    let aiGenerating = false

    aiBtn.addEventListener('click', async () => {
      if (aiResumoCache) {
        openResumoModal(aiResumoCache, typeMap, imageGallery)
        return
      }
      if (aiGenerating) return

      aiGenerating = true
      const originalBtn = aiBtn.innerHTML
      aiBtn.disabled = true
      aiBtn.innerHTML = '<span class="sgd-chat-btn-spinner"></span> Resumindo...'

      try {
        const resumo = await resumirConversaViaIA(messages, transcricao)
        aiResumoCache = resumo
        openResumoModal(resumo, typeMap, imageGallery)
      } catch (err) {
        if (typeof showNotification === 'function') {
          showNotification('Falha ao resumir a conversa: ' + err.message, 'error')
        } else {
          alert('Falha ao resumir a conversa:\n' + err.message)
        }
      } finally {
        aiGenerating = false
        aiBtn.disabled = false
        aiBtn.innerHTML = originalBtn
      }
    })

    const chatArea = document.createElement('div')
    chatArea.className = 'sgd-chat-area'

    // ── Virtualização dinâmica ──────────────────────────────────────────────
    // Conversas pequenas: renderiza tudo (comportamento simples). Conversas
    // grandes (> VIRTUALIZE_THRESHOLD): renderiza só o bloco final e carrega os
    // blocos anteriores conforme o usuário rola para cima (mantém o DOM leve).
    const VIRTUALIZE_THRESHOLD = 150
    const VCHUNK = 80

    // Itens em ordem (divisores de data + mensagens) — só dados; DOM sob demanda
    const renderItems = []
    let lastDate = null
    for (const msg of messages) {
      const date = msg.time.split(' ')[0]
      if (date !== lastDate) {
        lastDate = date
        renderItems.push({ type: 'divider', date })
      }
      renderItems.push({ type: 'msg', msg })
    }

    function makeItemNode(item) {
      if (item.type === 'divider') {
        const divider = document.createElement('div')
        divider.className = 'sgd-chat-date-divider'
        divider.textContent = `📅 ${item.date}`
        return divider
      }
      return renderMessage(item.msg, typeMap, imageGallery)
    }

    const virtualize = messages.length > VIRTUALIZE_THRESHOLD
    let fullyRendered = false
    let vStart = 0
    let topSentinel = null
    let vObserver = null

    function renderAllItems() {
      const frag = document.createDocumentFragment()
      for (const it of renderItems) frag.appendChild(makeItemNode(it))
      chatArea.innerHTML = ''
      chatArea.appendChild(frag)
      fullyRendered = true
    }

    // Garante todas as mensagens no DOM (a busca precisa varrer tudo).
    function ensureFullyRendered() {
      if (fullyRendered) return
      if (vObserver) { vObserver.disconnect(); vObserver = null }
      if (topSentinel) { topSentinel.remove(); topSentinel = null }
      renderAllItems()
    }

    function prependPreviousChunk() {
      if (!topSentinel || vStart === 0) return
      const newStart = Math.max(0, vStart - VCHUNK)
      const frag = document.createDocumentFragment()
      for (let i = newStart; i < vStart; i++) frag.appendChild(makeItemNode(renderItems[i]))
      const prevHeight = chatArea.scrollHeight
      const prevTop = chatArea.scrollTop
      chatArea.insertBefore(frag, topSentinel.nextSibling)
      // Preserva a posição visual após inserir conteúdo acima do que está à vista
      chatArea.scrollTop = prevTop + (chatArea.scrollHeight - prevHeight)
      vStart = newStart
      if (vStart === 0) {
        if (vObserver) { vObserver.disconnect(); vObserver = null }
        topSentinel.remove()
        topSentinel = null
        fullyRendered = true
      }
    }

    if (!virtualize) {
      renderAllItems()
    } else {
      topSentinel = document.createElement('div')
      topSentinel.className = 'sgd-chat-load-sentinel'
      topSentinel.textContent = '⏳ Carregar mensagens anteriores'
      topSentinel.addEventListener('click', prependPreviousChunk)
      chatArea.appendChild(topSentinel)

      vStart = Math.max(0, renderItems.length - VCHUNK)
      const frag = document.createDocumentFragment()
      for (let i = vStart; i < renderItems.length; i++) {
        frag.appendChild(makeItemNode(renderItems[i]))
      }
      chatArea.appendChild(frag)

      if (vStart === 0) {
        topSentinel.remove()
        topSentinel = null
        fullyRendered = true
      } else {
        vObserver = new IntersectionObserver(
          entries => {
            if (entries.some(e => e.isIntersecting)) prependPreviousChunk()
          },
          { root: chatArea, rootMargin: '200px 0px 0px 0px' }
        )
        vObserver.observe(topSentinel)
      }
    }

    panelChat.appendChild(chatArea)

    // ── Painel Transcrição
    const panelTranscricao = document.createElement('div')
    panelTranscricao.className = 'sgd-chat-panel'
    panelTranscricao.appendChild(renderTranscricaoTab(transcricao))

    // ── Painel Mídia
    const panelMedia = document.createElement('div')
    panelMedia.className = 'sgd-chat-panel'
    panelMedia.appendChild(renderMediaTab(media, typeMap))

    // ── Busca: filtra as mensagens da conversa
    function applySearch() {
      const term = searchInput.value.trim().toLowerCase()
      // Ao buscar, garante que todas as mensagens estejam no DOM (virtualização)
      if (term) ensureFullyRendered()
      const rows = chatArea.querySelectorAll('.sgd-chat-msg')
      let visibleCount = 0
      for (const row of rows) {
        const match = !term || (row.dataset.searchText || '').includes(term)
        row.style.display = match ? '' : 'none'
        if (match) visibleCount++
      }
      // Esconde divisores de data sem mensagens visíveis abaixo? (simples: mantém)
      counter.textContent = term
        ? `${visibleCount} de ${messages.length} mensagens`
        : `${messages.length} mensagens`
    }

    let searchTimeout
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(applySearch, 200)
    })

    // ── Troca de abas
    function activateTab(activeTab, activePanel) {
      for (const t of [tabChat, tabTranscricao, tabMedia]) t.classList.remove('sgd-chat-tab--active')
      for (const p of [panelChat, panelTranscricao, panelMedia]) p.classList.remove('sgd-chat-panel--active')
      activeTab.classList.add('sgd-chat-tab--active')
      activePanel.classList.add('sgd-chat-panel--active')
      // Busca só faz sentido na aba Conversa
      searchWrap.style.display = activePanel === panelChat ? '' : 'none'
    }

    tabChat.addEventListener('click', () => activateTab(tabChat, panelChat))
    tabTranscricao.addEventListener('click', () => activateTab(tabTranscricao, panelTranscricao))
    tabMedia.addEventListener('click', () => activateTab(tabMedia, panelMedia))

    // ── Rodapé com crédito ao autor da ideia original
    const modalFooter = document.createElement('div')
    modalFooter.className = 'sgd-chat-modal-footer'
    modalFooter.textContent = 'Visualizador de Chat — ideia original de Ruan Fiori Marcelino'

    modal.appendChild(modalHeader)
    modal.appendChild(tabs)
    modal.appendChild(searchWrap)
    modal.appendChild(panelChat)
    modal.appendChild(panelTranscricao)
    modal.appendChild(panelMedia)
    modal.appendChild(modalFooter)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)

    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove()
    })

    const onKey = e => {
      if (e.key === 'Escape') {
        overlay.remove()
        document.removeEventListener('keydown', onKey)
      }
    }
    document.addEventListener('keydown', onKey)

    requestAnimationFrame(() => {
      chatArea.scrollTop = chatArea.scrollHeight
    })
  }

  // ─── Detecção e injeção do botão ─────────────────────────────────────────────

  function isChatTxtLink(el) {
    const href = (el.href || '').toLowerCase()
    const download = (el.getAttribute('download') || '').toLowerCase()
    const text = (el.textContent || '').trim().toLowerCase()
    // Prioriza o padrão real do SGD (sscpre*.txt), mas aceita qualquer .txt
    const isTxt =
      /\.txt(\?.*)?$/.test(href) ||
      /\.txt(\?.*)?$/.test(download) ||
      /\.txt(\?.*)?$/.test(text)
    return isTxt
  }

  /**
   * Busca a transcrição telefônica da SSC (campo #transcricaoLigacao) e a parseia.
   * @returns {Promise<Array|null>}
   */
  async function carregarTranscricao() {
    const link = document.querySelector('#transcricaoLigacao a')
    if (!link || !link.href) return null
    try {
      const raw = await fetchChatText(link.href)
      return parseTranscricao(raw)
    } catch (err) {
      sgdWarn?.('[ChatViewer] Falha ao carregar transcrição:', err)
      return null
    }
  }

  function createViewerButton(el) {
    const btn = document.createElement('button')
    btn.className = 'sgd-chat-viewer-btn'
    btn.title = 'Visualizar conversa como chat'
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg> Visualizar Chat`

    const resetBtn = () => {
      btn.disabled = false
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg> Visualizar Chat`
    }

    btn.addEventListener('click', async e => {
      e.preventDefault()
      e.stopPropagation()
      btn.disabled = true
      btn.innerHTML = '<span class="sgd-chat-btn-spinner"></span> Carregando...'
      try {
        const url = el.href || el.src
        const raw = await fetchChatText(url)
        const fname = decodeURIComponent(url.split('/').pop().split('?')[0])
        const messages = parseTxt(raw)

        if (messages.length === 0) {
          if (typeof showNotification === 'function') {
            showNotification('Nenhuma mensagem válida encontrada.', 'warning')
          } else {
            alert('Nenhuma mensagem válida encontrada.')
          }
          return
        }

        btn.innerHTML = '<span class="sgd-chat-btn-spinner"></span> Identificando arquivos...'
        const [typeMap, transcricao] = await Promise.all([
          resolveMediaTypes(messages),
          carregarTranscricao()
        ])

        openModal(messages, fname, typeMap, transcricao)
      } catch (err) {
        if (typeof showNotification === 'function') {
          showNotification('Erro ao carregar o arquivo: ' + err.message, 'error')
        } else {
          alert('Erro ao carregar o arquivo:\n' + err.message)
        }
      } finally {
        resetBtn()
      }
    })
    return btn
  }

  function injectButtons() {
    // Restringe à célula exclusiva da Transcrição/anexos de chat
    const containers = document.querySelectorAll('td[id="td:anexo"]')
    for (const container of containers) {
      const links = container.querySelectorAll('a[href], a[download]')
      for (const el of links) {
        if (!isChatTxtLink(el) || el.dataset.sgdChatViewerInjected) continue
        el.dataset.sgdChatViewerInjected = 'true'
        el.insertAdjacentElement('afterend', createViewerButton(el))
      }
    }
  }

  // ─── Inicialização (respeitando a preferência) ───────────────────────────────

  let observer = null

  function start() {
    injectButtons()
    if (observer) return
    observer = new MutationObserver(() => injectButtons())
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function stop() {
    if (observer) {
      observer.disconnect()
      observer = null
    }
    document
      .querySelectorAll('.sgd-chat-viewer-btn')
      .forEach(btn => btn.remove())
    document
      .querySelectorAll('[data-sgd-chat-viewer-injected]')
      .forEach(el => delete el.dataset.sgdChatViewerInjected)
    document.getElementById('sgd-chat-viewer-modal')?.remove()
  }

  async function isEnabled() {
    try {
      if (typeof getSettings === 'function') {
        const settings = await getSettings()
        return settings?.preferences?.[CHAT_VIEWER_PREF_KEY] !== false
      }
    } catch {}
    return true // padrão: habilitado
  }

  async function init() {
    if (await isEnabled()) start()

    // Reage a mudanças na preferência ao vivo (outra aba ou o próprio painel)
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'sync') return
        if (typeof SETTINGS_STORAGE_KEY !== 'undefined' && changes[SETTINGS_STORAGE_KEY]) {
          if (await isEnabled()) start()
          else stop()
        }
      })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
