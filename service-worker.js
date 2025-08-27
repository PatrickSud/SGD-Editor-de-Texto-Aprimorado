/**
 * @file service-worker.js
 * @description Background service worker para lidar com alarmes, notificações e análise de IA.
 */

// Chaves de storage importadas de config.js
const REMINDERS_STORAGE_KEY = 'remindersData';
const RESPONSE_LOG_KEY = 'userResponseLog';
const STORAGE_KEY = 'quickMessagesData';

// --- LÓGICA DE SUGESTÃO DE NOVOS TRÂMITES ---

/**
 * Função auxiliar para gerar um hash simples de um texto.
 * @param {string} str O texto para gerar o hash.
 * @returns {number} O hash gerado.
 */
function simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Converte para 32bit integer
    }
    return hash;
}

/**
 * Lida com o registro de uma resposta enviada pelo usuário.
 * @param {string} text - O texto da resposta.
 */
async function handleResponseLogging(text) {
    if (!text || text.trim().length < 50) return;

    try {
        const hash = simpleHash(text.trim());
        const result = await chrome.storage.local.get(RESPONSE_LOG_KEY);
        const log = result[RESPONSE_LOG_KEY] || {};

        if (log[hash]) {
            log[hash].count++;
            log[hash].lastUsed = Date.now();
        } else {
            log[hash] = {
                text: text, // Armazena o texto original na primeira vez
                count: 1,
                lastUsed: Date.now()
            };
        }

        await chrome.storage.local.set({ [RESPONSE_LOG_KEY]: log });

    } catch (error) {
        console.warn("Service Worker: Erro ao registrar resposta.", error);
    }
}

/**
 * Analisa as respostas registradas e, se encontrar um bom candidato, o salva como sugestão.
 */
async function runResponseAnalysisAndSuggestNewTramite() {
    try {
        const logResult = await chrome.storage.local.get(RESPONSE_LOG_KEY);
        const log = logResult[RESPONSE_LOG_KEY] || {};

        const dataResult = await chrome.storage.sync.get(STORAGE_KEY);
        const data = dataResult[STORAGE_KEY] || { messages: [] };

        const savedHashes = new Set(data.messages.map(msg => simpleHash(msg.message.trim())));

        let bestCandidate = null;

        for (const hash in log) {
            const entry = log[hash];
            if (entry.count >= 3 && !savedHashes.has(parseInt(hash))) {
                if (!bestCandidate || entry.count > bestCandidate.count) {
                    bestCandidate = entry;
                }
            }
        }

        if (bestCandidate) {
            await chrome.storage.local.set({ 'newTramiteSuggestion': bestCandidate.text });
            delete log[simpleHash(bestCandidate.text.trim())];
            await chrome.storage.local.set({ [RESPONSE_LOG_KEY]: log });
        }
    } catch(error) {
        console.warn("Service Worker: Erro durante análise de respostas.", error);
    }
}

// --- LISTENER DE MENSAGENS E ALARMES ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            if (message.action === 'LOG_SENT_RESPONSE') {
                await handleResponseLogging(message.text);
                sendResponse({ success: true });
            } else if (message.action === 'SET_ALARM') {
                if (message.reminderId && message.alarmTime) {
                    await chrome.alarms.create(message.reminderId, { when: message.alarmTime });
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Missing parameters for SET_ALARM.' });
                }
            } else if (message.action === 'CLEAR_ALARM') {
                if (message.reminderId) {
                    await chrome.alarms.clear(message.reminderId);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'Missing parameter for CLEAR_ALARM.' });
                }
            } else {
                sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error(`Service Worker: Erro ao processar mensagem ${message.action}:`, error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // Indica resposta assíncrona
});

chrome.runtime.onInstalled.addListener(() => {
    // Alarme para análise de respostas, roda a cada 4 horas
    chrome.alarms.create('analyzeResponsesAlarm', { periodInMinutes: 240 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'analyzeResponsesAlarm') {
        await runResponseAnalysisAndSuggestNewTramite();
    } else if (alarm.name.startsWith('reminder-')) {
        await handleReminderAlarm(alarm);
    }
});


// --- LÓGICA DE LEMBRETES E NOTIFICAÇÕES ---

async function getReminders() {
    try {
        const result = await chrome.storage.sync.get(REMINDERS_STORAGE_KEY);
        return result[REMINDERS_STORAGE_KEY] || {};
    } catch (error) {
        console.error('Service Worker: Erro ao carregar lembretes.', error);
        return {};
    }
}

async function handleReminderAlarm(alarm) {
    const reminderId = alarm.name;
    const reminders = await getReminders();
    const reminder = reminders[reminderId];

    if (reminder) {
        reminder.isFired = true;
        reminder.firedAt = Date.now();
        await chrome.storage.sync.set({ [REMINDERS_STORAGE_KEY]: reminders });
        showReminderNotification(reminder);
    } else {
        console.warn(`Service Worker: Lembrete não encontrado no storage: ${reminderId}`);
    }
}

function showReminderNotification(reminder) {
    const notificationId = reminder.id;
    const hasUrl = reminder.url && reminder.url.startsWith('http');
    const buttons = [];
    if (hasUrl) {
        buttons.push({ title: 'Abrir Solicitação' });
    }
    buttons.push({ title: 'Dispensar' });

    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'logo.png',
        title: reminder.title || 'Lembrete SGD',
        message: reminder.description || 'Verificar chamado agendado.',
        priority: 2,
        buttons: buttons,
        requireInteraction: true
    });
}

async function clearNotificationAndAlarm(notificationId) {
    try {
        await chrome.alarms.clear(notificationId);
        await chrome.notifications.clear(notificationId);
    } catch (error) {
        console.error(`Service Worker: Erro ao limpar notificação/alarme ${notificationId}:`, error);
    }
}

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith('reminder-')) return;
    const reminders = await getReminders();
    const reminder = reminders[notificationId];
    if (!reminder) {
        chrome.notifications.clear(notificationId);
        return;
    }
    const hasUrl = reminder.url && reminder.url.startsWith('http');
    if (hasUrl && buttonIndex === 0) {
        chrome.tabs.create({ url: reminder.url });
    }
    await clearNotificationAndAlarm(notificationId);
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (!notificationId.startsWith('reminder-')) return;
    const reminders = await getReminders();
    const reminder = reminders[notificationId];
    if (reminder && reminder.url && reminder.url.startsWith('http')) {
        chrome.tabs.create({ url: reminder.url });
    }
    await clearNotificationAndAlarm(notificationId);
});

chrome.notifications.onClosed.addListener(async (notificationId, byUser) => {
    if (byUser && notificationId.startsWith('reminder-')) {
        await clearNotificationAndAlarm(notificationId);
    }
});