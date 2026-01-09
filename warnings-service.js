/**
 * @file warnings-service.js
 * Serviço para gerenciar avisos do sistema usando a API REST do Firestore
 */

const WARNINGS_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/warnings`;

/**
 * Busca todos os avisos do sistema
 */
async function getWarnings() {
  try {
    const response = await fetch(`${WARNINGS_BASE_URL}?key=${FIREBASE_API_KEY}&orderBy=date desc&pageSize=20`);
    if (!response.ok) {
        // Se a coleção não existir ou der erro, retorna vazio, mas loga
        console.warn('Coleção de avisos não encontrada ou erro ao buscar. (Pode ser normal se for o primeiro uso)');
        return [];
    }
    
    const result = await response.json();
    // fromFirestore function is defined in system-status-service.js which is loaded before this script?
    // Wait, system-status-service.js defines it locally. We need to redefine or reuse. 
    // Since scripts share global scope in content scripts (if consistent), let's check.
    // However, safest to redefine helper here to avoid dependency order issues or just copy it.
    
    const warnings = (result.documents || []).map(fromFirestoreWarning);
    return warnings;
  } catch (error) {
    console.error('Erro ao buscar avisos:', error);
    return [];
  }
}

/**
 * Cria um novo aviso (protected functionality in logic, but API allows if rules allow)
 * @param {Object} warningData - { title, message, type, author, date }
 */
async function createWarning(warningData) {
  try {
    const fields = toFirestoreWarning(warningData);
    
    // Firestore REST API create document
    const response = await fetch(`${WARNINGS_BASE_URL}?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Erro ao criar aviso no Firestore');
    }
    
    return true;
  } catch (error) {
    console.error('Erro ao criar aviso:', error);
    throw error;
  }
}

/**
 * Deleta um aviso
 * @param {string} id - ID do documento
 */
async function deleteWarning(id) {
    try {
        const response = await fetch(`${WARNINGS_BASE_URL}/${id}?key=${FIREBASE_API_KEY}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Erro ao deletar aviso');
        }
        return true;
    } catch (error) {
        console.error('Erro ao deletar aviso:', error);
        throw error;
    }
}

/**
 * Atualiza um aviso (PATCH)
 * @param {string} id - ID do documento
 * @param {Object} updates - Campos a atualizar
 */
async function updateWarning(id, updates) {
    try {
        const fields = toFirestoreWarning(updates);
        // Mask: required for PATCH in Firestore REST to update only specific fields
        const updateMask = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');

        const url = `${WARNINGS_BASE_URL}/${id}?key=${FIREBASE_API_KEY}${updateMask ? '&' + updateMask : ''}`;
        
        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Erro ao atualizar aviso');
        }
        return true;
    } catch (error) {
        console.error('Erro ao atualizar aviso:', error);
        throw error;
    }
}

// Helpers copiados para isolamento e segurança
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

// Expor globalmente
window.warningsService = {
    getWarnings,
    createWarning,
    deleteWarning,
    updateWarning
};
