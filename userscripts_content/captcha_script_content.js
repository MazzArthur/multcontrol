// ==UserScript==
// @name         Alerta de Captcha (FUSAO FINAL E LIMPISSIMA)
// @version      3.4 // Versao com Userscript API Key para autenticacao automatica
// @description  Detecta Captcha, alerta via web/nativa e realiza cliques no Tribal Wars.
// @include      http*://*.*game.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
// ==/UserScript==

(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[Tampermonkey DEBUG] Script 'Alerta de Captcha (FUSAO FINAL)' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    // --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---
    // Será preenchido dinamicamente pelo servidor
    const FIREBASE_CLIENT_CONFIG = {};
    // --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

    // --- CAMPO PARA USERSCRIPT API KEY (Gerada no Dashboard MULTCONTROL) ---
    const USERSCRIPT_API_KEY = ""; // Esta será a chave única do usuário injetada.
    // --- FIM DO CAMPO PARA USERSCRIPT API KEY --

    // --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_AUTH_ID_TOKEN = ""; // Este valor será ignorado.

    const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert";

    // --- CONFIGURAÇÕES ADICIONAIS PARA O ALERTA DE CAPTCHA ---
    let lastCaptchaAlertSent = { id: null, timestamp: 0 };
    const ALERT_COOLDOWN_MS = 10000; // 10 segundos de cooldown

    // Inicializa Firebase Client SDK no script
    var authClient;
    try {
        if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
            firebase.initializeApp(FIREBASE_CLIENT_CONFIG);
            authClient = firebase.auth();
            console.log('[TW Script - Captcha] Firebase Client SDK inicializado com config injetada.');
        } else {
            console.warn('[TW Script - Captcha] Firebase Client SDK não inicializado. Config ausente ou inválida. O token dinâmico não funcionará.');
        }
    } catch (e) {
        console.error('[TW Script ERROR - Captcha] Erro ao inicializar Firebase Client SDK no script:', e);
    }


    async function sendAlert(message) { // Funcao para enviar alerta
        return new Promise(async (resolve, reject) => {
            let idTokenFinalForRequest;
            const CACHED_ID_TOKEN_KEY = 'cachedFirebaseIdToken_captcha'; // Chave única para este script
            const CACHED_TOKEN_EXPIRY_KEY = 'cachedFirebaseIdTokenExpiry_captcha';
            const now = Date.now();

            const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
            const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

            if (cachedToken && cachedExpiry && now < cachedExpiry - (5 * 60 * 1000)) { // Expira 5min antes
                idTokenFinalForRequest = cachedToken;
                console.log('[TW Script - Captcha] Usando ID Token do cache.');
            } else {
                console.log('[TW Script - Captcha] ID Token expirado ou não encontrado no cache. Obtendo novo...');
                try {
                    if (!USERSCRIPT_API_KEY || USERSCRIPT_API_KEY === "") {
                        console.error('[TW Script - Captcha ERROR] USERSCRIPT_API_KEY nao configurada! Copie o script do dashboard APOS LOGIN.');
                        return reject(new Error("Userscript API Key ausente."));
                    }
                    
                    const tokenResponse = await new Promise((res, rej) => {
                        GM_xmlhttpRequest({
                            method: "POST",
                            url: "https://multcontrol.onrender.com/api/get_fresh_id_token",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${USERSCRIPT_API_KEY}`
                            },
                            onload: function(response) { res(response); },
                            onerror: function(error) { rej(error); }
                        });
                    });

                    if (tokenResponse.status !== 200) {
                        throw new Error(`Falha ao obter Custom Token: Status ${tokenResponse.status}. Resposta: ${tokenResponse.responseText}`);
                    }
                    const customTokenData = JSON.parse(tokenResponse.responseText);
                    const customToken = customTokenData.customToken;
                    
                    if (typeof authClient === 'undefined' || !firebase) {
                        console.error('[TW Script - Captcha ERROR] Firebase Client SDK ou authClient não está disponível. Não é possível fazer login com Custom Token.');
                        return reject(new Error("Firebase Client SDK não disponível."));
                    }
                    await authClient.signInWithCustomToken(customToken);
                    console.log('[TW Script - Captcha] Login com Custom Token bem-sucedido no script.');

                    idTokenFinalForRequest = await authClient.currentUser.getIdToken();
                    const expirationTime = authClient.currentUser.stsTokenManager.expirationTime;
                    GM_setValue(CACHED_ID_TOKEN_KEY, idTokenFinalForRequest);
                    GM_setValue(CACHED_TOKEN_EXPIRY_KEY, expirationTime);
                    console.log('[TW Script - Captcha] ID Token fresco obtido e salvo no cache.');

                } catch (error) {
                    console.error('[TW Script - Captcha ERROR] Erro na autenticacao ou obtencao de Custom Token:', error);
                    return reject(new Error("Falha na autenticacao do script."));
                }
            }

            const currentTime = Date.now();
            const alertId = 'captcha_alert';
            if (lastCaptchaAlertSent.id === alertId && (currentTime - lastCaptchaAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
                console.log(`[TW Script - Captcha] Alerta de captcha ignorado: cooldown ativo.`);
                return resolve();
            }

            // Mensagem para o servidor
            const fullMessage = `🚨⚠️ CAPTCHA NECESSARIO! Mensagem: ${message}`;
            console.log(`[TW Script - Captcha] Tentando enviar alerta: "${fullMessage}" para ${ALERT_SERVER_URL}`);

            if (typeof GM_xmlhttpRequest === 'undefined') {
                console.error('[TW Script - Captcha ERROR] GM_xmlhttpRequest NAO está definido. Verifique a permissão @grant no cabeçalho do script!');
                return reject(new Error("GM_xmlhttpRequest nao definido."));
            }

            GM_xmlhttpRequest({
                method: "POST",
                url: ALERT_SERVER_URL,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${idTokenFinalForRequest}`
                },
                data: JSON.stringify({ message: fullMessage }),
                onload: function(response) { console.log("[Tampermonkey] Alerta enviado com sucesso.", response.responseText); resolve(response); },
                onerror: function(error) { console.error("[Tampermonkey] Erro de rede ao enviar alerta.", error); reject(error); }
            });
        });
    }

    function getNickname() {
        const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
        if (!nicknameElement) {
            console.warn('[Tampermonkey] Nickname element (#menu_row...) nao encontrado. Retornando "Desconhecido". Isso pode ocorrer se a estrutura HTML mudou.');
        }
        return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
    }

    function showNativeNotification(title, body, icon = "https://www.google.com/favicon.ico") {
        console.log(`[Tampermonkey] Tentando mostrar notificacao nativa: "${title}" - "${body}"`);
        if (!("Notification" in window)) {
            console.warn("[Tampermonkey] Este navegador nao suporta notificacoes de desktop.");
        } else if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: icon });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, { body: body, icon: icon });
                } else {
                    console.warn("[Tampermonkey] Permissao para notificacoes negada.");
                }
            }).catch(error => {
                console.error("[Tampermonkey] Erro ao solicitar permissao de notificacao:", error);
            });
        }
    }

    const captchaCheckInterval = setInterval(async function() { // Adicionado 'async'
        const initialButton = document.querySelector("#inner-border > table > tbody > tr:nth-child(1) > td > a");

        if (initialButton) {
            clearInterval(captchaCheckInterval);
            const nickname = getNickname();
            const captchaMessage = `A conta "${nickname}" precisa resolver um Captcha agora!`;
            
            await sendAlert(captchaMessage); // Adicionado 'await' aqui
            
            showNativeNotification("⚠️ Acao Necessaria! ⚠️", `A conta "${nickname}" precisa resolver um Captcha!`);
            initialButton.click();
            setTimeout(function() {
                const logoutButton = document.querySelector("#linkContainer > a:nth-child(7)");
                if (logoutButton) {
                    logoutButton.click();
                }
            }, 500);
        }
    }, 33000); // Verifica a cada 33 segundos
})();