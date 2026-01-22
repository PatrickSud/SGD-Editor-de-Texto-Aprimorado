/**
 * @file team-service.js
 * Serviço para gerenciar status da equipe usando a API REST do Firestore.
 * Os dados são escritos pelo Master PC (via bi-scraper.js → service-worker.js)
 * e lidos por todos os outros clientes.
 * 
 * DADOS CAPTURADOS:
 * - name: Nome do agente
 * - percentNotReady: Porcentagem de tempo indisponível (número)
 * - percentFormatted: Porcentagem formatada (string, ex: "75,93 %")
 * - allocation: Área do agente (ex: "Área Técnica Fone")
 * - status: Classificação ("Crítico", "Alerta", "Normal")
 */

// Reutiliza as constantes de configuração do Firebase já existentes no projeto
const TEAM_PROJECT_ID = 'sgd-extension';
const TEAM_API_KEY = 'AIzaSyBJgLpNfiycnIr-OybbfAOAuIa4ZU3nBbY';
const TEAM_STATUS_URL = `https://firestore.googleapis.com/v1/projects/${TEAM_PROJECT_ID}/databases/(default)/documents/team_status/current`;

/**
 * Converte o formato do Firestore REST para objeto JS.
 * @param {Object} doc - Documento do Firestore
 * @returns {Object} Objeto JS convertido
 */
function fromFirestoreTeamStatus(doc) {
    if (!doc || !doc.fields) return null;

    const fields = doc.fields;
    const data = {};

    // Converte timestamp
    if (fields.timestamp?.timestampValue) {
        data.timestamp = fields.timestamp.timestampValue;
    }

    // Converte source
    if (fields.source?.stringValue) {
        data.source = fields.source.stringValue;
    }

    // Converte members (array)
    if (fields.members?.arrayValue?.values) {
        data.members = fields.members.arrayValue.values.map(memberValue => {
            const memberFields = memberValue.mapValue?.fields || {};
            return {
                name: memberFields.name?.stringValue || '',
                percentNotReady: parseFloat(memberFields.percentNotReady?.doubleValue || memberFields.percentNotReady?.integerValue || 0),
                percentFormatted: memberFields.percentFormatted?.stringValue || '0 %',
                allocation: memberFields.allocation?.stringValue || '',
                status: memberFields.status?.stringValue || 'Normal',
                presence: memberFields.presence?.stringValue || '',
                currentStatus: memberFields.currentStatus?.stringValue || '',
                duration: memberFields.duration?.stringValue || ''
            };
        });
    } else {
        data.members = [];
    }

    return data;
}

/**
 * Converte objeto JS para o formato do Firestore REST.
 * @param {Object} data - Dados a serem convertidos
 * @returns {Object} Objeto no formato do Firestore
 */
function toFirestoreTeamStatus(data) {
    const fields = {};

    // Timestamp
    if (data.timestamp) {
        fields.timestamp = { timestampValue: data.timestamp };
    }

    // Source
    if (data.source) {
        fields.source = { stringValue: data.source };
    }

    // Members (array de maps)
    if (data.members && Array.isArray(data.members)) {
        fields.members = {
            arrayValue: {
                values: data.members.map(member => ({
                    mapValue: {
                        fields: {
                            name: { stringValue: member.name || '' },
                            percentNotReady: { doubleValue: member.percentNotReady || 0 },
                            percentFormatted: { stringValue: member.percentFormatted || '0 %' },
                            allocation: { stringValue: member.allocation || '' },
                            status: { stringValue: member.status || 'Normal' },
                            presence: { stringValue: member.presence || '' },
                            currentStatus: { stringValue: member.currentStatus || '' },
                            duration: { stringValue: member.duration || '' }
                        }
                    }
                }))
            }
        };
    }

    return { fields };
}

/**
 * Busca o status atual da equipe do Firestore.
 * Esta função é usada por todos os clientes (não-Master) para ler os dados.
 * @returns {Promise<{members: Array, timestamp: string, source: string}|null>}
 */
async function getTeamStatus() {
    try {
        // Tenta usar cache local primeiro (reduz leituras do Firestore)
        const storage = await chrome.storage.local.get(['cachedTeamStatus', 'teamStatusLastFetch']);
        const cached = storage.cachedTeamStatus;
        const lastFetch = storage.teamStatusLastFetch;

        // Cache válido por 30 segundos
        const CACHE_TTL_MS = 30 * 1000;
        if (cached && lastFetch && (Date.now() - lastFetch) < CACHE_TTL_MS) {
            console.log('[Team Service] Usando dados do cache local.');
            return cached;
        }

        // Busca do Firestore
        const response = await fetch(`${TEAM_STATUS_URL}?key=${TEAM_API_KEY}`);

        if (!response.ok) {
            // Se o documento não existir (404), retorna dados vazios
            if (response.status === 404) {
                return {
                    members: [],
                    timestamp: null,
                    source: null
                };
            }
            throw new Error(`Erro ao buscar status da equipe: ${response.status}`);
        }

        const doc = await response.json();
        const data = fromFirestoreTeamStatus(doc);

        // Atualiza cache local
        await chrome.storage.local.set({
            cachedTeamStatus: data,
            teamStatusLastFetch: Date.now()
        });

        return data;
    } catch (error) {
        console.error('[Team Service] Erro ao buscar status:', error);

        // Fallback para cache local em caso de erro
        const fallback = await chrome.storage.local.get('cachedTeamStatus');
        return fallback.cachedTeamStatus || { members: [], timestamp: null, source: null };
    }
}

/**
 * Salva o status da equipe no Firestore.
 * Esta função é usada apenas pelo Service Worker quando recebe dados do Master PC.
 * @param {Object} data - Dados a serem salvos
 * @returns {Promise<boolean>}
 */
async function saveTeamStatus(data) {
    try {
        const firestoreData = toFirestoreTeamStatus(data);

        const response = await fetch(`${TEAM_STATUS_URL}?key=${TEAM_API_KEY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firestoreData)
        });

        if (!response.ok) {
            const errorDetail = await response.json();
            throw new Error(`Erro ao salvar no Firestore: ${errorDetail.error?.message || response.statusText}`);
        }

        console.log('[Team Service] Status da equipe salvo com sucesso.');
        return true;
    } catch (error) {
        console.error('[Team Service] Erro ao salvar status:', error);
        throw error;
    }
}

/**
 * Força atualização do cache local.
 * @returns {Promise<Object|null>}
 */
async function refreshTeamStatus() {
    // Limpa o cache para forçar nova busca
    await chrome.storage.local.remove(['cachedTeamStatus', 'teamStatusLastFetch']);
    return await getTeamStatus();
}

/**
 * Formata o timestamp para exibição amigável.
 * @param {string} timestamp - Timestamp ISO
 * @returns {string} Data/hora formatada
 */
function formatTeamStatusTimestamp(timestamp) {
    if (!timestamp) return 'Nunca atualizado';

    try {
        const date = new Date(timestamp);
        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return 'Data inválida';
    }
}

/**
 * Retorna a classe CSS do badge baseado na porcentagem de NotReady.
 * @param {number} percentNotReady - Porcentagem de tempo indisponível
 * @returns {string} Classe CSS
 */
function getTeamStatusBadgeClass(percentNotReady) {
    if (percentNotReady > 20) return 'badge-danger';   // Vermelho: > 20%
    if (percentNotReady > 16) return 'badge-warning';  // Amarelo: > 16%
    return 'badge-success';                             // Verde: <= 16%
}

/**
 * Retorna o emoji do status baseado na porcentagem.
 * @param {string} status - Status ("Crítico", "Alerta", "Normal")
 * @returns {string} Emoji
 */
function getTeamStatusEmoji(status) {
    switch (status) {
        case 'Crítico': return '🔴';
        case 'Alerta': return '🟡';
        case 'Normal': return '🟢';
        default: return '⚪';
    }
}

// Expõe o serviço globalmente para uso em outros scripts
window.teamService = {
    getTeamStatus,
    saveTeamStatus,
    refreshTeamStatus,
    formatTeamStatusTimestamp,
    getTeamStatusBadgeClass,
    getTeamStatusEmoji
};
