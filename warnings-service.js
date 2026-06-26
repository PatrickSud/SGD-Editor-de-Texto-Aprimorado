/**
 * @file warnings-service.js
 * Serviço para gerenciar avisos do sistema usando a API REST do Firebase Realtime Database
 * OTIMIZADO: Estratégia "Metadata Check" para avisos.
 * Migrado do Firestore para o Realtime Database (cota por bandwidth em vez de contagem de leituras).
 */

const RTDB_BASE_URL = 'https://sgd-extension-default-rtdb.firebaseio.com';
const RTDB_WARNINGS_URL = `${RTDB_BASE_URL}/warnings`;
const RTDB_WARNINGS_META_URL = `${RTDB_BASE_URL}/metadata/warnings`;

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
        let metaDoc = null;
        try {
          const swResponse = await chrome.runtime.sendMessage({ 
            action: 'READ_PERMISSIONS_ACTION', 
            path: '/metadata/warnings.json' 
          });
          if (swResponse && swResponse.success) {
            metaDoc = swResponse.data;
          }
        } catch (e) {
          const metaResponse = await fetch(`${RTDB_WARNINGS_META_URL}.json`, { cache: 'no-store' });
          if (metaResponse.ok) {
            metaDoc = await metaResponse.json();
          }
        }

        if (metaDoc) {
          const isDevMode = !!(storage.infoDevMode);
          const isEditor = !!(storage.infoDevMode || storage.isCurrentUserEditor || window.sgdPermissions?.isEditor);
          const activeChannelsList = storage.warningChannels || [
            'Geral', 'AT', 'Onvio', 'Dominio Processos/Messenger',
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
      } catch (e) { }
    }

    let result = null;
    try {
      const swResponse = await chrome.runtime.sendMessage({ action: 'FETCH_WARNINGS_DATA' });
      if (swResponse && swResponse.success) {
        result = swResponse.data;
      } else {
        throw new Error(swResponse ? swResponse.error : 'Erro na resposta do SW');
      }
    } catch (e) {
      const response = await fetch(`${RTDB_WARNINGS_URL}.json?orderBy="date"&limitToLast=20`, { cache: 'no-store' });
      if (response.ok) {
        result = await response.json();
      }
    }

    if (!result || typeof result !== 'object') return cachedData || [];

    const warnings = Object.entries(result).map(([id, data]) => ({ id, ...data }));
    warnings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const isEditor = !!(storage.infoDevMode || storage.isCurrentUserEditor || window.sgdPermissions?.isEditor);
    const filteredWarnings = warnings.filter(w => {
      if (isEditor) return true;
      if (w.targetUsers && Array.isArray(w.targetUsers) && w.targetUsers.length > 0) {
        if (!currentUser) return false;
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
    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'WRITE_WARNING_ACTION',
        type: 'create',
        data: warningData
      });
      if (!swResponse || !swResponse.success) {
        throw new Error(swResponse ? swResponse.error : 'Erro no SW');
      }
    } catch (swErr) {
      const { id, ...data } = warningData;
      const response = await fetch(`${RTDB_WARNINGS_URL}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Erro ao criar aviso');
      
      await fetch(`${RTDB_WARNINGS_META_URL}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastUpdated: new Date().toISOString() })
      }).catch(() => {});
    }

    chrome.runtime.sendMessage({ action: 'WARNING_CREATED' }).catch(() => {});
    
    if (window.sgdPermissions?.writeAuditLog) {
      await window.sgdPermissions.writeAuditLog('CREATE_WARNING', warningData.title || 'Aviso sem título', `Canal: ${warningData.channel || 'Geral'}`);
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
      const swRead = await chrome.runtime.sendMessage({ 
        action: 'READ_PERMISSIONS_ACTION', 
        path: `/warnings/${id}.json` 
      });
      if (swRead && swRead.success) {
        doc = swRead.data;
      }
      if (doc) title = doc.title || title;
    } catch (_) {
      try {
        const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
        if (fetchResponse.ok) {
          doc = await fetchResponse.json();
          if (doc) title = doc.title || title;
        }
      } catch (_) {}
    }

    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'WRITE_WARNING_ACTION',
        type: 'delete',
        id: id
      });
      if (!swResponse || !swResponse.success) {
        throw new Error(swResponse ? swResponse.error : 'Erro no SW');
      }
    } catch (swErr) {
      const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Erro ao deletar');
      
      await fetch(`${RTDB_WARNINGS_META_URL}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastUpdated: new Date().toISOString() })
      }).catch(() => {});
    }

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
      const swRead = await chrome.runtime.sendMessage({ 
        action: 'READ_PERMISSIONS_ACTION', 
        path: `/warnings/${id}.json` 
      });
      if (swRead && swRead.success) oldDoc = swRead.data;
    } catch (_) {
      try {
        const fetchResponse = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`);
        if (fetchResponse.ok) oldDoc = await fetchResponse.json();
      } catch (_) {}
    }

    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'WRITE_WARNING_ACTION',
        type: 'update',
        id: id,
        data: updates
      });
      if (!swResponse || !swResponse.success) {
        throw new Error(swResponse ? swResponse.error : 'Erro no SW');
      }
    } catch (swErr) {
      const { id: _, ...data } = updates;
      const response = await fetch(`${RTDB_WARNINGS_URL}/${id}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Erro ao atualizar');
      
      await fetch(`${RTDB_WARNINGS_META_URL}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastUpdated: new Date().toISOString() })
      }).catch(() => {});
    }

    chrome.runtime.sendMessage({ action: 'WARNING_CREATED' }).catch(() => {});

    if (window.sgdPermissions?.writeAuditLog) {
      let action = 'EDIT_WARNING';
      let details = `Canal: ${updates.channel || 'Geral'}`;
      if (updates.archived === true) {
        action = 'ARCHIVE_WARNING';
        details = 'Aviso arquivado';
      } else if (updates.archived === false) {
        action = 'UNARCHIVE_WARNING';
        details = 'Aviso desarquivado';
      }
      await window.sgdPermissions.writeAuditLog(action, updates.title || 'Aviso sem título', details);
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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_');
}

async function recordWarningReceipt(warningId, userName) {
  if (!userName || !warningId) return;
  const safeKey = safeFirebaseKey(userName);
  const now = new Date().toISOString();
  try {
    const storage = await chrome.storage.local.get(['dbReceivedWarnings', 'cachedWarnings']);
    const dbReceived = storage.dbReceivedWarnings || {};
    if (dbReceived[warningId]) return;

    let reason = 'Aviso geral ou não encontrado em cache';
    const cached = storage.cachedWarnings || [];
    const w = cached.find(x => x.id === warningId);
    if (w) {
      const wChannel = w.channel || 'Geral';
      if (w.onlySelf) {
        reason = `Aviso criado exclusivamente para o autor (Apenas para mim) no canal "${wChannel}"`;
      } else if (w.targetUsers && Array.isArray(w.targetUsers) && w.targetUsers.length > 0) {
        reason = `Direcionado para colaboradores específicos (${w.targetUsers.join(', ')}) no canal "${wChannel}"`;
      } else {
        reason = `Aviso geral enviado para o canal "${wChannel}"`;
      }
    }

    const payload = {
      name: userName.trim(),
      timestamp: now,
      reason: reason,
      userAgent: navigator.userAgent,
      version: chrome.runtime.getManifest().version,
      isEditor: !!(window.sgdPermissions?.isEditor),
      isDevMode: !!(window.sgdPermissions?.isDevMode)
    };

    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'WRITE_PERMISSIONS_ACTION',
        path: `/warning_metrics/${warningId}/receipts/${safeKey}.json`,
        method: 'PUT',
        data: payload
      });
      if (swResponse && swResponse.success) {
        dbReceived[warningId] = true;
        await chrome.storage.local.set({ dbReceivedWarnings: dbReceived });
      }
    } catch (swErr) {
      const response = await fetch(`${RTDB_BASE_URL}/warning_metrics/${warningId}/receipts/${safeKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        dbReceived[warningId] = true;
        await chrome.storage.local.set({ dbReceivedWarnings: dbReceived });
      }
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
    const storage = await chrome.storage.local.get(['dbViewedWarnings', 'cachedWarnings']);
    const dbViewed = storage.dbViewedWarnings || {};
    if (dbViewed[warningId]) return;

    let reason = 'Visualizado';
    const cached = storage.cachedWarnings || [];
    const w = cached.find(x => x.id === warningId);
    if (w) {
      const wChannel = w.channel || 'Geral';
      if (w.onlySelf) {
        reason = `Visualizado pelo autor do aviso (Apenas para mim) no canal "${wChannel}"`;
      } else if (w.targetUsers && Array.isArray(w.targetUsers) && w.targetUsers.length > 0) {
        reason = `Visualizado por colaborador direcionado em lista específica (${w.targetUsers.join(', ')}) no canal "${wChannel}"`;
      } else {
        reason = `Visualizado pelo colaborador inscrito no canal "${wChannel}"`;
      }
    }

    const payload = {
      name: userName.trim(),
      timestamp: now,
      reason: reason,
      userAgent: navigator.userAgent,
      version: chrome.runtime.getManifest().version,
      isEditor: !!(window.sgdPermissions?.isEditor),
      isDevMode: !!(window.sgdPermissions?.isDevMode)
    };

    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'WRITE_PERMISSIONS_ACTION',
        path: `/warning_metrics/${warningId}/views/${safeKey}.json`,
        method: 'PUT',
        data: payload
      });
      if (swResponse && swResponse.success) {
        dbViewed[warningId] = true;
        await chrome.storage.local.set({ dbViewedWarnings: dbViewed });
      }
    } catch (swErr) {
      const response = await fetch(`${RTDB_BASE_URL}/warning_metrics/${warningId}/views/${safeKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        dbViewed[warningId] = true;
        await chrome.storage.local.set({ dbViewedWarnings: dbViewed });
      }
    }
  } catch (e) {
    console.warn('[Warnings Service] Erro ao registrar visualização:', e);
  }
}

async function getWarningMetrics(warningId) {
  try {
    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'READ_PERMISSIONS_ACTION',
        path: `/warning_metrics/${warningId}.json`
      });
      if (swResponse && swResponse.success) {
        return swResponse.data || { receipts: {}, views: {} };
      }
    } catch (swErr) {}
    
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
    try {
      const swResponse = await chrome.runtime.sendMessage({
        action: 'READ_PERMISSIONS_ACTION',
        path: '/warning_metrics.json'
      });
      if (swResponse && swResponse.success) {
        return swResponse.data || {};
      }
    } catch (swErr) {}

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
