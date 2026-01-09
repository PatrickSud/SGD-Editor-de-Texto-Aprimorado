/**
 * @file warnings-service.js
 * Serviço para gerenciar avisos do sistema usando a API REST do Firestore
 * OTIMIZADO: Estratégia "Metadata Check" para avisos.
 */

const WARNINGS_PROJECT_ID = "sgd-extension";
const WARNINGS_API_KEY = "AIzaSyBJgLpNfiycnIr-OybbfAOAuIa4ZU3nBbY";
const WARNINGS_BASE_URL = `https://firestore.googleapis.com/v1/projects/${WARNINGS_PROJECT_ID}/databases/(default)/documents/warnings`;
const WARNINGS_METADATA_URL = `https://firestore.googleapis.com/v1/projects/${WARNINGS_PROJECT_ID}/databases/(default)/documents/metadata/warnings`;

async function touchWarningsMetadata() {
  try {
    const now = new Date().toISOString();
    const fields = { lastUpdated: { timestampValue: now } };
    await fetch(`${WARNINGS_METADATA_URL}?key=${WARNINGS_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
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
        const metaResponse = await fetch(`${WARNINGS_METADATA_URL}?key=${WARNINGS_API_KEY}`);
        if (metaResponse.ok) {
          const metaDoc = await metaResponse.json();
          serverSignature = metaDoc.fields?.lastUpdated?.timestampValue;
        }
      } catch (e) { }

      if (cachedData.length > 0 && serverSignature && serverSignature === localSignature) {
        return cachedData;
      }
    }

    const response = await fetch(`${WARNINGS_BASE_URL}?key=${WARNINGS_API_KEY}&orderBy=date desc&pageSize=20`);
    if (!response.ok) return cachedData || [];

    const result = await response.json();
    const warnings = (result.documents || []).map(fromFirestoreWarning);

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
    const fields = toFirestoreWarning(warningData);
    const response = await fetch(`${WARNINGS_BASE_URL}?key=${WARNINGS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!response.ok) throw new Error('Erro ao criar aviso');
    await touchWarningsMetadata();
    return true;
  } catch (error) {
    console.error('Erro ao criar aviso:', error);
    throw error;
  }
}

async function deleteWarning(id) {
  try {
    const response = await fetch(`${WARNINGS_BASE_URL}/${id}?key=${WARNINGS_API_KEY}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Erro ao deletar');
    await touchWarningsMetadata();
    return true;
  } catch (error) { throw error; }
}

async function updateWarning(id, updates) {
  try {
    const fields = toFirestoreWarning(updates);
    const updateMask = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');
    const response = await fetch(`${WARNINGS_BASE_URL}/${id}?key=${WARNINGS_API_KEY}&${updateMask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!response.ok) throw new Error('Erro ao atualizar');
    await touchWarningsMetadata();
    return true;
  } catch (error) { throw error; }
}

function fromFirestoreWarning(doc) {
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

function toFirestoreWarning(obj) {
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

window.warningsService = { getWarnings, createWarning, deleteWarning, updateWarning };
