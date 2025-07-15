// ==UserScript==
// @name         Alerta de Captcha v1.1 - MultControl
// @icon         https://i.imgur.com/p5aYWUF.gif
// @description  Script para detectar e alertar sobre Captchas, com atualizações automáticas.
// @author       MazzArthur
// @include      http*://*.*game.php*
// @version      1.1.0
// @updateURL    https://multcontrol.onrender.com/scripts/captcha.meta.js
// @downloadURL  https://multcontrol.onrender.com/scripts/captcha.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @require      http://code.jquery.com/jquery-1.12.4.min.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
// ==/UserScript==

(function() {
    'use strict';

    //*************************** CONFIGURAÇÃO E CONSTANTES GLOBAIS ***************************//
    const API_BASE_URL = "https://multcontrol.onrender.com";
    const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert";
    const ALERT_COOLDOWN_MS = 15000; // 15 segundos de cooldown
    let lastCaptchaAlertSent = { id: null, timestamp: 0 };

    // --- VARIÁVEIS DE CONTROLE ---
    let authClient;
    let FIREBASE_CLIENT_CONFIG = {};
    let USERSCRIPT_API_KEY = '';
    let captchaCheckIntervalId = null;

    // ============================================================================
    // == LÓGICA DE CONFIGURAÇÃO E MIGRAÇÃO DE CHAVES ==
    // ============================================================================
    function setupConfig() {
        const hardcodedConfig = {}; // Suas configs injetadas podem estar aqui
        const hardcodedApiKey = "";   // Sua API key injetada pode estar aqui

        let storedConfig = GM_getValue("FIREBASE_CLIENT_CONFIG", null);
        let storedApiKey = GM_getValue("USERSCRIPT_API_KEY", null);

        if (storedConfig && storedApiKey) {
            FIREBASE_CLIENT_CONFIG = storedConfig;
            USERSCRIPT_API_KEY = storedApiKey;
            console.log('[TW Captcha Script] Configurações carregadas do armazenamento local.');
            return true;
        }

        if (Object.keys(hardcodedConfig).length > 0 && hardcodedApiKey) {
            GM_setValue("FIREBASE_CLIENT_CONFIG", hardcodedConfig);
            GM_setValue("USERSCRIPT_API_KEY", hardcodedApiKey);
            FIREBASE_CLIENT_CONFIG = hardcodedConfig;
            USERSCRIPT_API_KEY = hardcodedApiKey;
            console.log('[TW Captcha Script] Chaves migradas com sucesso para o armazenamento local!');
            return true;
        }

        alert("MULTCONTROL (Captcha): Chaves de configuração não encontradas! Por favor, instale o script novamente a partir do seu dashboard.");
        return false;
    }

    // ============================================================================
    // == SEÇÃO DE FUNÇÕES ==
    // ============================================================================

    // --- FUNÇÕES DE AUTENTICAÇÃO E API ---
    function initializeFirebase() {
        try {
            if (typeof firebase !== 'undefined' && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
                if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CLIENT_CONFIG);
                authClient = firebase.auth();
            } else { console.warn('[TW Captcha Script] Configs do Firebase ausentes.'); }
        } catch (e) { console.error('[TW Captcha Script ERROR] Falha na inicialização do Firebase:', e); }
    }

    async function getFreshIdToken() {
        const CACHED_ID_TOKEN_KEY = 'cachedFirebaseIdToken'; // Usa o mesmo cache do outro script
        const CACHED_TOKEN_EXPIRY_KEY = 'cachedFirebaseIdTokenExpiry';
        const now = Date.now();
        const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
        const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && now < cachedExpiry - 300000) { // 5 min de margem
            return cachedToken;
        }
        try {
            if (!USERSCRIPT_API_KEY) throw new Error("USERSCRIPT_API_KEY nao configurada!");
            const tokenResponse = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST", url: `${API_BASE_URL}/api/get_fresh_id_token`,
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${USERSCRIPT_API_KEY}` },
                    onload: resolve, onerror: reject
                });
            });
            if (tokenResponse.status !== 200) throw new Error(`Falha ao obter Custom Token: Status ${tokenResponse.status}`);
            const { customToken } = JSON.parse(tokenResponse.responseText);
            if (!authClient) throw new Error("Firebase authClient nao esta disponivel.");
            await authClient.signInWithCustomToken(customToken);
            const idTokenResult = await authClient.currentUser.getIdTokenResult();
            GM_setValue(CACHED_ID_TOKEN_KEY, idTokenResult.token);
            GM_setValue(CACHED_TOKEN_EXPIRY_KEY, new Date(idTokenResult.expirationTime).getTime());
            return idTokenResult.token;
        } catch (error) {
            console.error('[TW Captcha Script ERROR] Falha no processo de autenticação:', error);
            return null;
        }
    }

    function getCurrentGameAccount() {
        const world = window.location.hostname.split('.')[0];
        const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
        if (!nicknameElement) { return null; }
        const nickname = nicknameElement.textContent.trim();
        return { nickname: nickname, world: world, fullNickname: `${world} - ${nickname}` };
    }

    // --- FUNÇÕES DE ALERTA DE CAPTCHA ---
    async function sendCaptchaAlert() {
        const currentTime = Date.now();
        const alertId = 'captcha_alert';
        if (lastCaptchaAlertSent.id === alertId && (currentTime - lastCaptchaAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
            console.log(`[TW Captcha Script] Alerta de captcha ignorado: cooldown ativo.`);
            return;
        }
        try {
            const account = getCurrentGameAccount();
            if (!account) throw new Error('Não foi possível obter a conta do jogo.');
            const idToken = await getFreshIdToken();
            if (!idToken) throw new Error('Não foi possível obter o token de autenticação para o alerta.');

            const fullMessage = `CAPTCHA NECESSARIO! Conta "${account.fullNickname}"`;
            console.log(`[TW Captcha Script] ENVIANDO ALERTA DE CAPTCHA: "${fullMessage}"`);

            GM_xmlhttpRequest({
                method: "POST",
                url: ALERT_SERVER_URL,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
                data: JSON.stringify({ message: fullMessage }),
                onload: function(response) {
                    console.log("[TW Captcha Script] Alerta enviado com sucesso.", response.responseText);
                    lastCaptchaAlertSent = { id: alertId, timestamp: Date.now() };
                },
                onerror: function(error) { console.error("[TW Captcha Script] Erro de rede ao enviar alerta.", error); }
            });
        } catch (error) { console.error('[TW Captcha Script ERROR] Falha ao enviar o alerta:', error); }
    }

    function showNativeNotification(title, body) {
        console.log(`[TW Captcha Script] Exibindo notificação: "${title}"`);
        GM_notification({
            title: title,
            text: body,
            image: "https://i.imgur.com/7WgHTT8.gif",
            highlight: true,
            timeout: 0 // A notificação não desaparecerá sozinha
        });
    }

    // --- PONTO DE ENTRADA E LÓGICA PRINCIPAL ---
    function main() {
        console.log("-- Script de Alerta de Captcha v1.0.0 ativado --");
        initializeFirebase();

        captchaCheckIntervalId = setInterval(async () => {
            const captchaButton = document.querySelector("#inner-border > table > tbody > tr:nth-child(1) > td > a");
            if (captchaButton) {
                console.log("%c[TW Captcha Script] CAPTCHA DETECTADO!", "color: red; font-size: 16px; font-weight: bold;");

                // Para o detector para não enviar múltiplos alertas
                clearInterval(captchaCheckIntervalId);

                const account = getCurrentGameAccount();
                const nickname = account ? account.fullNickname : "Desconhecido";

                // Envia o alerta para o servidor
                await sendCaptchaAlert();

                // Mostra notificação nativa persistente
                showNativeNotification("⚠️ CAPTCHA DETECTADO! ⚠️", `A conta "${nickname}" precisa de intervenção.`);

                // Clica no botão para expor o captcha na tela
                captchaButton.click();

                // Tenta deslogar por segurança após um tempo
                 setTimeout(function() {
                     const logoutButton = document.querySelector("#linkContainer > a:nth-child(7)");
                     if (logoutButton) {
                         console.log("[TW Captcha Script] Deslogando por segurança...");
                         logoutButton.click();
                     }
                 }, 2000);
            }
        }, 7000); // Verifica a cada 7 segundos
    }

    // Inicia o script
    if (setupConfig()) {
        main();
    }

})();
