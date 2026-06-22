/**
 * @file warnings-service.js
 * Serviço para gerenciar avisos do sistema usando a API REST do Firebase Realtime Database
 * OTIMIZADO: Estratégia "Metadata Check" para avisos.
 * Migrado do Firestore para o Realtime Database (cota por bandwidth em vez de contagem de leituras).
 */

const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com';
const RTDB_WARNINGS_URL = `${RTDB_BASE_URL}/warnings`;
const RTDB_WARNINGS_META_URL = `${RTDB_BASE_URL}/metadata/warnings`;

async function touchWarningsMetadata(warningDataOrArray) {
  try {
    const now = new Date().toISOString();
    const patchData = { lastUpdated: now };
    
    const allChannels = [
      'Geral', 'AT', 'Onvio', 'Onvio Processos/Messenger',
      'Folha de pagamento', 'Escrita Fiscal', 'Contabilidade',
      'Serviços Digitais', 'Fila 61', 'Fila 62'
    ];

    const dataArray = Array.isArray(warningDataOrArray) 
      ? warningDataOrArray 
      : [warningDataOrArray];

    let hasValidData = false;

    for (const data of dataArray) {
      if (data) {
        hasValidData = true;
        if (data.isTest) {
          patchData.lastTestUpdated = now;
        } else if (data.targetUsers && Array.isArray(data.targetUsers) && data.targetUsers.length > 0) {
          for (const user of data.targetUsers) {
            const userKey = safeFirebaseKey(user);
            if (userKey) {
              patchData[`user_${userKey}`] = now;
            }
          }
        } else if (data.channel) {
          const channelKey = safeFirebaseKey(data.channel);
          if (channelKey) {
            patchData[`channel_${channelKey}`] = now;
          }
        } else {
          patchData.lastTestUpdated = now;
          for (const ch of allChannels) {
            patchData[`channel_${safeFirebaseKey(ch)}`] = now;
          }
        }
      }
    }

    if (!hasValidData) {
      patchData.lastTestUpdated = now;
      for (const ch of allChannels) {
        patchData[`channel_${safeFirebaseKey(ch)}`] = now;
      }
    }

    await fetch(`${RTDB_WARNINGS_META_URL}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchData)
    });
  } catch (e) { console.warn('Falha meta avisos:', e); }
}

async function getWarnings(forceRefresh = false) {
  try {
    const storage = await chrome.storage.local.get([
      'cachedWarnings',
      'warningsMetaSignature',
      'infoDevMode',
      'subscribedChannels',
      'warningChannels',
      'allowedChannels',
      'currentUser',
      'isCurrentUserEditor'
    ]);
    let cachedData = storage.cachedWarnings || [];
    const localSignature = storage.warningsMetaSignature;
    let serverSignature = null;
    const currentUser = storage.currentUser;

    if (!forceRefresh) {
      try {
        const metaResponse = await fetch(`${RTDB_WARNINGS_META_URL}.json`, { cache: 'no-store' });
        if (metaResponse.ok) {
          const metaDoc = await metaResponse.json();
          if (metaDoc) {
            const isDevMode = !!(storage.infoDevMode);
            const isEditor = !!(storage.infoDevMode || storage.isCurrentUserEditor || window.sgdPermissions?.isEditor);
            const activeChannelsList = storage.warningChannels || [
              'Geral', 'AT', 'Onvio', 'Onvio Processos/Messenger',
              'Folha de pagamento', 'Escrita Fiscal', 'Contabilidade',
              'Serviços Digitais', 'Fila 61', 'Fila 62'
            ];
            const subscribed = storage.subscribedChannels ? [...storage.subscribedChannels] : [...activeChannelsList];
            let allowed = storage.allowedChannels ? [...storage.allowedChannels] : ['Geral'];

            if (!isEditor && allowed.length >= activeChannelsList.length) {
              allowed = ['Geral'];
            }

            let hasChanges = false;
            if (typeof localSignature !== 'object' || !localSignature) {
              hasChanges = true;
            } else {
              if (isDevMode && metaDoc.lastTestUpdated !== localSignature.lastTestUpdated) {
                hasChanges = true;
              }
              if (!hasChanges && currentUser) {
                const userKey = `user_${safeFirebaseKey(currentUser)}`;
                if (metaDoc[userKey] !== localSignature[userKey]) {
                  hasChanges = true;
                }
              }
              if (!hasChanges) {
                const activeSubscribedChannels = subscribed.filter(c => allowed.includes(c));
                for (const channel of activeSubscribedChannels) {
                  const key = `channel_${safeFirebaseKey(channel)}`;
                  if (metaDoc[key] !== localSignature[key]) {
                    hasChanges = true;
                    break;
                  }
                }
              }
              // Fallback se não há chaves específicas (compatibilidade com registros antigos)
              const hasSpecificKeys = Object.keys(metaDoc).some(k => k.startsWith('channel_') || k.startsWith('user_') || k === 'lastTestUpdated');
              if (!hasSpecificKeys && metaDoc.lastUpdated !== localSignature.lastUpdated) {
                hasChanges = true;
              }
            }

            if (!hasChanges) {
              return cachedData;
            }
            serverSignature = metaDoc;
          }
        }
      } catch (e) { }
    }

    const response = await fetch(`${RTDB_WARNINGS_URL}.json?orderBy="date"&limitToLast=20`, { cache: 'no-store' });
    if (!response.ok) return cachedData || [];

    const result = await response.json();
    if (!result || typeof result !== 'object') return cachedData || [];

    // Realtime DB retorna um objeto { "-id1": { ... }, "-id2": { ... } }
    // Converte para array e ordena por data (mais recente primeiro)
    const warnings = Object.entries(result).map(([id, data]) => ({ id, ...data }));
    warnings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Filtra localmente os avisos direcionados que não pertencem ao usuário atual
    const isEditor = !!(storage.infoDevMode || storage.isCurrentUserEditor || window.sgdPermissions?.isEditor);
    const filteredWarnings = warnings.filter(w => {
      if (isEditor) return true; // Editor visualiza todos
      if (w.targetUsers && Array.isArray(w.targetUsers) && w.targetUsers.length > 0) {
        if (!currentUser) return false;
        const normalizeName = (name) => {
          if (!name) return '';
          return name
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ');
        };
        const normCurrentUser = normalizeName(currentUser);
        return w.targetUsers.some(u => normalizeName(u) === normCurrentUser);
      }
      return true;
    });

    await chrome.storage.local.set({
      cachedWarnings: filteredWarnings,
      warningsMetaSignature: serverSignature || { lastUpdated: new Date().toISOString() }
    });

    return filteredWarnings;
  } catch (error) {
    console.error('Erro ao buscar avisos:', error);
    const fallback = await chrome.storage.local.get('cachedWarnings');
    return fallback.cachedWarnings || [];
  }
}

async function createWarning(warningData) {
  try {
    const { id, ...data } = warningData;
    const response = await fetch(`${RTDB_WARNINGS_URL}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Erro ao criar aviso');
    await touchWarningsMetadata(warningData);
    // Notifica o service worker para verificar e disparar o toast imediatamente
    chrome.runtime.sendMessage({ action: 'WARNING_CREATED' }).catch(() => {});
    
    // Grava Log de Auditoria
    if (window.sgdPermissions?.writeAuditLog) {
      await window.sgdPermissions.writeAuditLog('CREATE_WARNING', data.title || 'Aviso sem título', `Canal: ${data.channel || 'Geral'}`);
    }
    
    return true;
  } catch (error) {
    console.error('Erro ao criar aviso:', error);
    throw error;
  }
}

async function deleteWarning(id) {
  try {
    let title = 'Aviso sem título';
    let doc = null;
    try {
      const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
      if (fetchResponse.ok) {
        doc = await fetchResponse.json();
        if (doc) title = doc.title || title;
      }
    } catch (_) {}

    const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Erro ao deletar');
    await touchWarningsMetadata(doc);

    // Grava Log de Auditoria
    if (window.sgdPermissions?.writeAuditLog) {
      await window.sgdPermissions.writeAuditLog('DELETE_WARNING', title, `ID: ${id}`);
    }
    
    return true;
  } catch (error) { throw error; }
}

async function updateWarning(id, updates) {
  try {
    let oldDoc = null;
    try {
      const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
      if (fetchResponse.ok) {
        oldDoc = await fetchResponse.json();
      }
    } catch (_) {}

    const { id: _, ...data } = updates;
    const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Erro ao atualizar');

    let newDoc = null;
    try {
      const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
      if (fetchResponse.ok) {
        newDoc = await fetchResponse.json();
      }
    } catch (_) {}

    await touchWarningsMetadata([oldDoc, newDoc || updates]);
    // Notifica o service worker para verificar e disparar o toast imediatamente se necessário
    chrome.runtime.sendMessage({ action: 'WARNING_CREATED' }).catch(() => {});

    // Grava Log de Auditoria
    if (window.sgdPermissions?.writeAuditLog) {
      let action = 'EDIT_WARNING';
      let details = `Canal: ${data.channel || 'Geral'}`;
      if (updates.archived === true) {
        action = 'ARCHIVE_WARNING';
        details = 'Aviso arquivado';
      } else if (updates.archived === false) {
        action = 'UNARCHIVE_WARNING';
        details = 'Aviso desarquivado';
      }
      await window.sgdPermissions.writeAuditLog(action, data.title || updates.title || 'Aviso sem título', details);
    }
    
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
