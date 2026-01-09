/**
 * @file system-status-service.js
 * Serviço para gerenciar status de sistemas usando a API REST do Firestore
 * OTIMIZADO: Estratégia "Metadata Check" (Vigia) para economia de leituras e tempo real.
 */

const FIREBASE_PROJECT_ID = "sgd-extension";
const FIREBASE_API_KEY = "AIzaSyBJgLpNfiycnIr-OybbfAOAuIa4ZU3nBbY";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/systemStatus`;
const REPORTS_COLLECTION = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/systemReports`;
// URL do documento "Vigia" que guarda a data da última alteração
const METADATA_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/metadata/systems`;

/**
 * Atualiza o timestamp de controle (O "Vigia")
 */
async function touchMetadata() {
  try {
    const now = new Date().toISOString();
    const fields = { lastUpdated: { timestampValue: now } };
    await fetch(`${METADATA_URL}?key=${FIREBASE_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    });
  } catch (e) {
    console.warn('Falha ao atualizar metadados:', e);
  }
}

/**
 * Converte o formato do Firestore REST para objeto JS (Mantém TODOS os campos/relatos)
 */
function fromFirestore(doc) {
  const fields = doc.fields || {};
  const data = { id: doc.name.split('/').pop() };

  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) data[key] = value.stringValue;
    else if (value.integerValue !== undefined) data[key] = parseInt(value.integerValue);
    else if (value.doubleValue !== undefined) data[key] = parseFloat(value.doubleValue);
    else if (value.booleanValue !== undefined) data[key] = value.booleanValue;
    else if (value.timestampValue !== undefined) data[key] = value.timestampValue;
  }
  return data;
}

function toFirestore(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id') continue;
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (Number.isInteger(value)) fields[key] = { integerValue: value.toString() };
    else if (typeof value === 'number') fields[key] = { doubleValue: value };
  }
  return { fields };
}

/**
 * Busca status com validação inteligente (Metadata Check)
 * @param {boolean} forceRefresh - Se true, ignora o vigia e baixa tudo
 */
async function getSystemsStatus(forceRefresh = false) {
  try {
    // 1. Carrega dados locais
    const storage = await chrome.storage.local.get(['cachedSystemsStatus', 'metadataLastSignature']);
    let cachedData = storage.cachedSystemsStatus || [];
    const localSignature = storage.metadataLastSignature;
    let serverSignature = null;

    // 2. Verifica o "Vigia" (Custo: 1 Leitura)
    if (!forceRefresh) {
      try {
        const metaResponse = await fetch(`${METADATA_URL}?key=${FIREBASE_API_KEY}`);
        if (metaResponse.ok) {
          const metaDoc = await metaResponse.json();
          serverSignature = metaDoc.fields?.lastUpdated?.timestampValue;
        }
      } catch (e) { console.warn('Erro checando meta:', e); }

      // Se assinaturas batem, usa cache
      if (cachedData.length > 0 && serverSignature && serverSignature === localSignature) {
        console.log('✅ Sistemas: Sem alterações (Cache).');
        return cachedData;
      }
    }

    // 3. Baixa atualização completa
    console.log('🔄 Sistemas: Baixando dados atualizados...');
    const response = await fetch(`${BASE_URL}?key=${FIREBASE_API_KEY}`);
    if (!response.ok) throw new Error('Erro ao buscar dados do Firestore');

    const result = await response.json();
    const systems = (result.documents || []).map(fromFirestore);

    // Ordenar
    systems.sort((a, b) => (a.order || 0) - (b.order || 0));

    // 4. Salva cache
    await chrome.storage.local.set({
      cachedSystemsStatus: systems,
      metadataLastSignature: serverSignature || new Date().toISOString()
    });

    return systems;
  } catch (error) {
    console.error('Erro ao buscar status:', error);
    const cached = await chrome.storage.local.get('cachedSystemsStatus');
    return cached.cachedSystemsStatus || [];
  }
}

async function updateSystemStatus(systemId, updates) {
  try {
    const fields = toFirestore(updates);
    const updateMask = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');

    const response = await fetch(`${BASE_URL}/${systemId}?key=${FIREBASE_API_KEY}&${updateMask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) throw new Error('Erro ao atualizar Firestore');
    await touchMetadata(); // Atualiza o vigia
    return true;
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    throw error;
  }
}

async function setSystemStatus(systemId, data) {
  try {
    const fields = toFirestore(data);
    const response = await fetch(`${BASE_URL}/${systemId}?key=${FIREBASE_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) throw new Error('Erro ao salvar no Firestore');
    await touchMetadata();
    return true;
  } catch (error) {
    console.error('Erro ao criar:', error);
    throw error;
  }
}

function subscribeToSystemsStatus(callback) {
  getSystemsStatus(false).then(callback);
}

// Helpers de UI
function getStatusBadgeClass(status) {
  switch (status) {
    case 'operational': return 'badge-success';
    case 'warning': return 'badge-warning';
    case 'error':
    case 'down': return 'badge-danger';
    default: return 'badge-success';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'operational': return 'Operacional';
    case 'warning': return 'Atenção';
    case 'error': return 'Instabilidade';
    case 'down': return 'Fora do Ar';
    default: return 'Desconhecido';
  }
}

/**
 * Captura o nome do usuário logado na barra de navegação do SGD
 */
function getCurrentSgdUser() {
  try {
    const userElement = document.querySelector('.navbar-link b');
    if (userElement) {
      return userElement.textContent.replace(/\u00A0/g, ' ').trim();
    }
  } catch (e) {
    console.warn('Não foi possível obter o nome do usuário:', e);
  }
  return 'Usuário Desconhecido';
}

/**
 * Envia um reporte de instabilidade de um usuário
 */
async function reportUserInstability(systemId) {
  try {
    const userName = getCurrentSgdUser();
    const reportData = {
      systemId: systemId,
      timestamp: new Date().toISOString(),
      userName: userName
    };
    const fields = toFirestore(reportData);
    fields.fields.timestamp = { timestampValue: reportData.timestamp };

    const response = await fetch(`${REPORTS_COLLECTION}?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) {
      const errorDetail = await response.json();
      throw new Error(`Erro ao enviar reporte: ${errorDetail.error?.message || response.statusText}`);
    }
    return true;
  } catch (error) {
    console.error('Erro ao reportar instabilidade:', error);
    throw error;
  }
}

/**
 * Busca a contagem de reportes da última hora
 */
async function getRecentReportsStats() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const query = {
      structuredQuery: {
        from: [{ collectionId: "systemReports" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "timestamp" },
            op: "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: oneHourAgo }
          }
        },
        limit: 500
      }
    };

    const response = await fetch(`${BASE_URL.replace('systemStatus', '')}:runQuery?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });

    if (!response.ok) return {};
    const result = await response.json();
    const stats = {};
    if (Array.isArray(result)) {
      result.forEach(item => {
        if (item.document) {
          const data = fromFirestore(item.document);
          if (data.systemId) {
            stats[data.systemId] = (stats[data.systemId] || 0) + 1;
          }
        }
      });
    }
    return stats;
  } catch (error) {
    console.error('Erro ao buscar estatísticas de reportes:', error);
    return {};
  }
}

window.initializeSystemsInFirestore = async function () {
  if (typeof initializeSystemsInFirestore === 'function') {
    return await initializeSystemsInFirestore();
  }
};

window.systemStatusService = {
  getSystemsStatus,
  updateSystemStatus,
  setSystemStatus,
  subscribeToSystemsStatus,
  getStatusBadgeClass,
  getStatusLabel,
  reportUserInstability,
  getRecentReportsStats
};
