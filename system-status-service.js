/**
 * @file system-status-service.js
 * Serviço para gerenciar status de sistemas usando a API REST do Firestore
 * (Evita erros de CSP do Manifest V3)
 */

const FIREBASE_PROJECT_ID = "sgd-extension";
const FIREBASE_API_KEY = "AIzaSyBJgLpNfiycnIr-OybbfAOAuIa4ZU3nBbY";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/systemStatus`;

/**
 * Converte o formato bizarro de campos do Firestore REST para um objeto limpo
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

/**
 * Converte um objeto JS para o formato de campos do Firestore REST
 */
function toFirestore(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id' || key === 'lastModified') continue;
    
    if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else if (Number.isInteger(value)) fields[key] = { integerValue: value.toString() };
    else if (typeof value === 'number') fields[key] = { doubleValue: value };
  }
  return { fields };
}

/**
 * Busca o status atual de todos os sistemas
 */
async function getSystemsStatus() {
  try {
    const response = await fetch(`${BASE_URL}?key=${FIREBASE_API_KEY}`);
    if (!response.ok) throw new Error('Erro ao buscar dados do Firestore');
    
    const result = await response.json();
    const systems = (result.documents || []).map(fromFirestore);
    
    // Ordenar por campo 'order'
    systems.sort((a, b) => (a.order || 0) - (b.order || 0));

    await chrome.storage.local.set({ cachedSystemsStatus: systems });
    return systems;
  } catch (error) {
    console.error('Erro ao buscar status:', error);
    const cached = await chrome.storage.local.get('cachedSystemsStatus');
    return cached.cachedSystemsStatus || [];
  }
}

/**
 * Atualiza o status de um sistema (PATCH)
 */
async function updateSystemStatus(systemId, updates) {
  try {
    const fields = toFirestore(updates);
    
    // No REST, precisamos especificar quais campos estamos atualizando (mask)
    const updateMask = Object.keys(updates).map(k => `updateMask.fieldPaths=${k}`).join('&');
    
    const response = await fetch(`${BASE_URL}/${systemId}?key=${FIREBASE_API_KEY}&${updateMask}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Erro ao atualizar Firestore');
    }
    
    return true;
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    throw error;
  }
}

/**
 * Cria ou substitui um sistema (com o método POST/PATCH do REST)
 */
async function setSystemStatus(systemId, data) {
  try {
    const fields = toFirestore(data);
    const response = await fetch(`${BASE_URL}/${systemId}?key=${FIREBASE_API_KEY}`, {
      method: 'PATCH', // Usamos PATCH aqui para "upsert" (criar ou atualizar)
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });

    if (!response.ok) throw new Error('Erro ao salvar no Firestore');
    return true;
  } catch (error) {
    console.error('Erro ao criar/atualizar:', error);
    throw error;
  }
}

/**
 * Como estamos usando REST puro, não temos o listener em tempo real real-time.
 * Vamos simular chamando a cada vez que o usuário abre o painel ou manualmente.
 */
function subscribeToSystemsStatus(callback) {
  // Chamada inicial
  getSystemsStatus().then(callback);
  
  // No REST, poderíamos fazer um polling, mas para economizar requisições,
  // vamos apenas avisar que a função foi registrada.
  console.log('REST Mode: Listener simulado ativado.');
}

/**
 * Tradutores de UI (mantidos para compatibilidade com info-panel.js)
 */
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

// Expor globalmente
window.initializeSystemsInFirestore = async function() {
  if (typeof initializeSystemsInFirestore === 'function') {
      return await initializeSystemsInFirestore();
  }
};
