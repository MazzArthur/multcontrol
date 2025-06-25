// ==UserScript==
// @name         Alerta de Ataques (Tribal Wars)
// @namespace    @@marcosvinicius.santosmarques
// @icon         https://i.imgur.com/7WgHTT8.gif
// @description  Detecta novos ataques a chegar no Tribal Wars e envia alertas.
// @include      http*://*.*game.php*
// @version      1.3 // Versão com Userscript API Key para autenticacao automatica
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      http://code.jquery.com/jquery-1.12.4.min.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
// ==/UserScript==

(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[TW ATTACK ALERT] Script 'Alerta de Ataques' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    // --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---
    // Será preenchido dinamicamente pelo servidor
    const FIREBASE_CLIENT_CONFIG = {};
    // --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

    // --- CAMPO PARA USERSCRIPT API KEY (Gerada no Dashboard MULTCONTROL) ---
    const USERSCRIPT_API_KEY = ""; // Esta será a chave única do usuário injetada.
    // --- FIM DO CAMPO PARA USERSCRIPT API KEY --

    // --- CAMPO PARA ID TOKEN DO USUÁRIO (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_AUTH_ID_TOKEN = ""; // Este valor será ignorado.

    // *************************** CONFIGURAÇÃO *************************** //
    const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert";
    const CHECK_INTERVAL_MS = 5000;

    const NATIVE_NOTIFICATION_TITLE = "ATAQUES A CHEGAR NO TRIBAL WARS!";
    const NATIVE_NOTIFICATION_ICON = "https://dsbr.innogamescdn.com/asset/75cb846c/graphic/unit/att.webp";
    // ************************* /CONFIGURAÇÃO ************************** //

    let lastKnownIncomingsCount = GM_getValue('lastKnownIncomings', 0);
    console.log(`[TW ATTACK ALERT] Última contagem de ataques conhecida: ${lastKnownIncomingsCount}`);

    // Inicializa Firebase Client SDK no script
    var authClient;
    try {
        if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
            firebase.initializeApp(FIREBASE_CLIENT_CONFIG);
            authClient = firebase.auth();
            console.log('[TW Script - Ataque] Firebase Client SDK inicializado com config injetada.');
        } else {
            console.warn('[TW Script - Ataque] Firebase Client SDK não inicializado. Config ausente ou inválida. O token dinâmico não funcionará.');
        }
    } catch (e) {
        console.error('[TW Script ERROR - Ataque] Erro ao inicializar Firebase Client SDK no script:', e);
    }


    // --- FUNÇÕES AUXILIARES ---
    function getNickname() {
        const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
        return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
    }
    function getVillageId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('village');
    }

    // sendAttackAlert agora gerencia a obtenção do token e o envio
    async function sendAttackAlert(message) { // Adicionado 'async'
        return new Promise(async (resolve, reject) => {
            let idTokenFinalForRequest;
            const CACHED_ID_TOKEN_KEY = 'cachedFirebaseIdToken_attack'; // Chave única para este script
            const CACHED_TOKEN_EXPIRY_KEY = 'cachedFirebaseIdTokenExpiry_attack';
            const now = Date.now();

            const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
            const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

            if (cachedToken && cachedExpiry && now < cachedExpiry - (5 * 60 * 1000)) { // Expira 5min antes
                idTokenFinalForRequest = cachedToken;
                console.log('[TW Script - Ataque] Usando ID Token do cache.');
            } else {
                console.log('[TW Script - Ataque] ID Token expirado ou não encontrado no cache. Obtendo novo...');
                try {
                    if (!USERSCRIPT_API_KEY || USERSCRIPT_API_KEY === "") {
                        console.error('[TW Script - Ataque ERROR] USERSCRIPT_API_KEY nao configurada! Copie o script do dashboard APOS LOGIN.');
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
                        console.error('[TW Script - Ataque ERROR] Firebase Client SDK ou authClient não está disponível. Não é possível fazer login com Custom Token.');
                        return reject(new Error("Firebase Client SDK não disponível."));
                    }
                    await authClient.signInWithCustomToken(customToken);
                    console.log('[TW Script - Ataque] Login com Custom Token bem-sucedido no script.');

                    idTokenFinalForRequest = await authClient.currentUser.getIdToken();
                    const expirationTime = authClient.currentUser.stsTokenManager.expirationTime;
                    GM_setValue(CACHED_ID_TOKEN_KEY, idTokenFinalForRequest);
                    GM_setValue(CACHED_TOKEN_EXPIRY_KEY, expirationTime);
                    console.log('[TW Script - Ataque] ID Token fresco obtido e salvo no cache.');

                } catch (error) {
                    console.error('[TW Script - Ataque ERROR] Erro na autenticacao ou obtencao de Custom Token:', error);
                    return reject(new Error("Falha na autenticacao do script."));
                }
            }

            // Mensagem para o servidor
            const fullMessage = `🚨⚔️ ATAQUE(S) NOVO(S)! Mensagem: ${message}`;
            console.log(`[TW ATTACK ALERT] Tentando enviar alerta: "${fullMessage}" para ${ALERT_SERVER_URL}`);

            if (typeof GM_xmlhttpRequest === 'undefined') {
                console.error('[TW ATTACK ALERT ERROR] GM_xmlhttpRequest NÃO está definido. Verifique a permissão @grant no cabeçalho do script!');
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
                onload: function(response) { console.log("[TW ATTACK ALERT] Alerta enviado com sucesso.", response.responseText); resolve(response); },
                onerror: function(error) { console.error("[TW ATTACK ALERT] Erro de rede ao enviar alerta.", error); reject(error); }
            });
        });
    }

    function showNativeNotification(title, body, villageId) {
        console.log(`[TW ATTACK ALERT] Tentando mostrar notificação nativa: "${title}" - "${body}"`);
        if (!("Notification" in window)) {
            console.warn("[TW ATTACK ALERT] Este navegador não suporta notificações de desktop.");
        } else if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: NATIVE_NOTIFICATION_ICON });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(function (permission) {
                if (permission === "granted") {
                    new Notification(title, { body: body, icon: NATIVE_NOTIFICATION_ICON }); // Use NATIVE_NOTIFICATION_ICON
                } else { console.warn("[TW ATTACK ALERT] Permissão para notificações negada."); }
            }).catch(error => {
                console.error("[TW ATTACK ALERT] Erro ao solicitar permissão de notificação:", error);
            });
        }
    }

    // --- LÓGICA PRINCIPAL DE VERIFICAÇÃO DE ATAQUES ---
    async function checkIncomings() { // Adicionado 'async'
        const incomingsAmountSpan = document.getElementById('incomings_amount');
        const nickname = getNickname();
        const villageId = getVillageId();
        let currentIncomingsCount = 0;
        if (incomingsAmountSpan) {
            currentIncomingsCount = parseInt(incomingsAmountSpan.textContent.trim(), 10);
            if (isNaN(currentIncomingsCount)) { currentIncomingsCount = 0; }
        }

        if (currentIncomingsCount > lastKnownIncomingsCount && currentIncomingsCount > 0) {
            const message = `ATAQUE(S) NOVO(S)! Conta "${nickname}" tem ${currentIncomingsCount} ataque(s) a chegar!`;
            await sendAttackAlert(message); // Adicionado 'await'
            showNativeNotification(NATIVE_NOTIFICATION_TITLE, `A conta "${nickname}" tem ${currentIncomingsCount} ataque(s) a chegar!`, villageId);
        } else if (currentIncomingsCount < lastKnownIncomingsCount) {
            console.log('[TW ATTACK ALERT] Contagem de ataques diminuiu.');
        } else if (currentIncomingsCount === 0 && lastKnownIncomingsCount > 0) {
            console.log('[TW ATTACK ALERT] Todos os ataques anteriores foram processados.');
        }

        if (currentIncomingsCount !== lastKnownIncomingsCount) {
            lastKnownIncomingsCount = currentIncomingsCount;
            GM_setValue('lastKnownIncomings', lastKnownIncomingsCount);
        }
    }

    setInterval(async function() { // Adicionado 'async'
        await checkIncomings(); // Adicionado 'await'
    }, CHECK_INTERVAL_MS);
    
    // Chamada inicial
    (async () => { // Função auto-executável async para a chamada inicial
        await checkIncomings();
    })();
})();