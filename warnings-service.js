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

window.warningsService = { getWarnings, createWarning, deleteWarning, updateWarning };
