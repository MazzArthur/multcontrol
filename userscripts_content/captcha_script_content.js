// ==UserScript==
// @name         Alerta de Captcha (FUSAO FINAL E LIMPISSIMA)
// @version      3.3 // Versao com ID Token para alertas segmentados (Gerado por MULTCONTROL)
// @description  Detecta Captcha, alerta via web/nativa e realiza cliques no Tribal Wars.
// @include      http*://*.*game.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js    <-- ADICIONADO
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js   <-- ADICIONADO
// @connect      multcontrol.onrender.com  <-- ADICIONADO
// ==/UserScript==

(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[Tampermonkey DEBUG] Script 'Alerta de Captcha (FUSAO FINAL)' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    // --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_CLIENT_CONFIG = {}; // Será preenchido dinamicamente pelo servidor
    // --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

    // --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_AUTH_ID_TOKEN = "TOKEN_EXEMPLO_IGNORADO_PELO_SCRIPT"; // Este valor será ignorado.
    // --- FIM DO CAMPO PARA ID TOKEN ---

    const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert"; // URL do seu servidor de alertas

    // --- CONFIGURAÇÕES ADICIONAIS PARA O ALERTA DE CAPTCHA (se necessário) ---
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


    // sendAlert agora é async
    async function sendAlert(message) { // Adicionado 'async'
        // --- Obtem o ID Token FRESCO do Firebase Client ---
        let idToken;
        try {
            if (typeof authClient === 'undefined' || !authClient.currentUser) {
                console.error('[Tampermonkey ERROR] Nenhum usuário logado no Firebase no script. Login necessário no dashboard.');
                return; // Não tente enviar alerta se não há usuário logado
            }
            idToken = await authClient.currentUser.getIdToken(); // OBTÉM TOKEN FRESCO
            console.log('[Tampermonkey] ID Token fresco obtido com sucesso.');
        } catch (error) {
            console.error('[Tampermonkey ERROR] Erro ao obter ID Token fresco no script:', error);
            return; // Não tente enviar alerta se o token não puder ser obtido
        }
        // --- FIM: Obtem o ID Token FRESCO ---

        // Mensagem para o servidor (SEM ACENTOS, SEM EMOJI)
        console.log(`[Tampermonkey] Tentando enviar alerta: "${message}" para ${ALERT_SERVER_URL}`);

        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[Tampermonkey ERROR] GM_xmlhttpRequest NAO está definido. Verifique a permissão @grant no cabeçalho do script!');
            return;
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: ALERT_SERVER_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}` // Use o token FRESCO
            },
            data: JSON.stringify({ message: message }),
            onload: function(response) { console.log("[Tampermonkey] Alerta enviado com sucesso.", response.responseText); },
            onerror: function(error) { console.error("[Tampermonkey] Erro de rede ao enviar alerta.", error); }
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
        // Notificação nativa pode ter emojis/acentos (exibição local)
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
            // MENSAGEM PARA O SERVIDOR (SEM ACENTOS, SEM EMOJI)
            const captchaMessage = `CAPTCHA NECESSARIO! A conta "${nickname}" precisa resolver um Captcha agora!`;
            
            await sendAlert(captchaMessage); // Adicionado 'await' aqui
            
            // Notificação nativa (PODE TER EMOJI e ACENTOS)
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