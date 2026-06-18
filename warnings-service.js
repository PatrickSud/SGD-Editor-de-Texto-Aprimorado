/**
 * @file warnings-service.js
 * Serviço para gerenciar avisos do sistema usando a API REST do Firebase Realtime Database
 * OTIMIZADO: Estratégia "Metadata Check" para avisos.
 * Migrado do Firestore para o Realtime Database (cota por bandwidth em vez de contagem de leituras).
 */

const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com';
const RTDB_WARNINGS_URL = `${RTDB_BASE_URL}/warnings`;
const RTDB_WARNINGS_META_URL = `${RTDB_BASE_URL}/metadata/warnings`;

async function touchWarningsMetadata() {
  try {
    const now = new Date().toISOString();
    await fetch(`${RTDB_WARNINGS_META_URL}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastUpdated: now })
    });
  } catch (e) { console.warn('Falha meta avisos:', e); }
}

async function getWarnings(forceRefresh = false) {
  try {
    const storage = await chrome.storage.local.get(['cachedWarnings', 'warningsMetaSignature']);
    let cachedData = storage.cachedWarnings || [];
    const localSignature = storage.warningsMetaSignature;
    let serverSignature = null;

    if (!forceRefresh) {
      try {
        const metaResponse = await fetch(`${RTDB_WARNINGS_META_URL}.json`, { cache: 'no-store' });
        if (metaResponse.ok) {
          const metaDoc = await metaResponse.json();
          serverSignature = metaDoc?.lastUpdated;
        }
      } catch (e) { }

      if (cachedData.length > 0 && serverSignature && serverSignature === localSignature) {
        return cachedData;
      }
    }

    const response = await fetch(`${RTDB_WARNINGS_URL}.json?orderBy="date"&limitToLast=20`, { cache: 'no-store' });
    if (!response.ok) return cachedData || [];

    const result = await response.json();
    if (!result || typeof result !== 'object') return cachedData || [];

    // Realtime DB retorna um objeto { "-id1": { ... }, "-id2": { ... } }
    // Converte para array e ordena por data (mais recente primeiro)
    const warnings = Object.entries(result).map(([id, data]) => ({ id, ...data }));
    warnings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    await chrome.storage.local.set({
      cachedWarnings: warnings,
      warningsMetaSignature: serverSignature || new Date().toISOString()
    });

    return warnings;
  } catch (error) {
    console.error('Erro ao buscar avisos:', error);
    const fallback = await chrome.storage.local.get('cachedWarnings');
    return fallback.cachedWarnings || [];
  }
}

async function createWarning(warningData) {
  try {
    // Remove o campo 'id' se existir (o RTDB gera automaticamente)
    const { id, ...data } = warningData;
    const response = await fetch(`${RTDB_WARNINGS_URL}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Erro ao criar aviso');
    await touchWarningsMetadata();
    // Notifica o service worker para verificar e disparar o toast imediatamente
    chrome.runtime.sendMessage({ action: 'WARNING_CREATED' }).catch(() => {});
    return true;
  } catch (error) {
    console.error('Erro ao criar aviso:', error);
    throw error;
  }
}

async function deleteWarning(id) {
  try {
    const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Erro ao deletar');
    await touchWarningsMetadata();
    return true;
  } catch (error) { throw error; }
}

async function updateWarning(id, updates) {
  try {
    // Remove o campo 'id' das atualizações se existir
    const { id: _, ...data } = updates;
    const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Erro ao atualizar');
    await touchWarningsMetadata();
    return true;
  } catch (error) { throw error; }
}

function safeFirebaseKey(str) {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9]/g, '_') // Substitui não-alfanuméricos por _
    .replace(/_+/g, '_'); // Evita múltiplos _
}

async function recordWarningReceipt(warningId, userName) {
  if (!userName || !warningId) return;
  const safeKey = safeFirebaseKey(userName);
  const now = new Date().toISOString();
  try {
    const storage = await chrome.storage.local.get(['dbReceivedWarnings']);
    const dbReceived = storage.dbReceivedWarnings || {};
    if (dbReceived[warningId]) return; // Já enviou

    const response = await fetch(`${RTDB_BASE_URL}/warning_metrics/${warningId}/receipts/${safeKey}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: userName.trim(), timestamp: now })
    });

    if (response.ok) {
      dbReceived[warningId] = true;
      await chrome.storage.local.set({ dbReceivedWarnings: dbReceived });
    }
  } catch (e) {
    console.warn('[Warnings Service] Erro ao registrar recebimento:', e);
  }
}

async function recordWarningView(warningId, userName) {
  if (!userName || !warningId) return;
  const safeKey = safeFirebaseKey(userName);
  const now = new Date().toISOString();
  try {
    const storage = await chrome.storage.local.get(['dbViewedWarnings']);
    const dbViewed = storage.dbViewedWarnings || {};
    if (dbViewed[warningId]) return; // Já enviou

    const response = await fetch(`${RTDB_BASE_URL}/warning_metrics/${warningId}/views/${safeKey}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: userName.trim(), timestamp: now })
    });

    if (response.ok) {
      dbViewed[warningId] = true;
      await chrome.storage.local.set({ dbViewedWarnings: dbViewed });
    }
  } catch (e) {
    console.warn('[Warnings Service] Erro ao registrar visualização:', e);
  }
}

async function getWarningMetrics(warningId) {
  try {
    const response = await fetch(`${RTDB_BASE_URL}/warning_metrics/${warningId}.json`, { cache: 'no-store' });
    if (!response.ok) return { receipts: {}, views: {} };
    const result = await response.json();
    return result || { receipts: {}, views: {} };
  } catch (error) {
    console.error('[Warnings Service] Erro ao buscar métricas:', error);
    return { receipts: {}, views: {} };
  }
}

async function getAllWarningMetrics() {
  try {
    const response = await fetch(`${RTDB_BASE_URL}/warning_metrics.json`, { cache: 'no-store' });
    if (!response.ok) return {};
    const result = await response.json();
    return result || {};
  } catch (error) {
    console.error('[Warnings Service] Erro ao buscar todas as métricas:', error);
    return {};
  }
}

window.warningsService = { 
  getWarnings, 
  createWarning, 
  deleteWarning, 
  updateWarning,
  recordWarningReceipt,
  recordWarningView,
  getWarningMetrics,
  getAllWarningMetrics
};
