// ==UserScript==
// @name         Alerta de Ataques v2.1 - Auto-Update Inteligente
// @icon         https://i.imgur.com/p5aYWUF.gif
// @description  Verifica por novos ataques e envia alertas para a plataforma MULTCONTROL.
// @author       MazzArthur & Gemini
// @include      http*://*.*game.php*
// @version      2.0.0
// @updateURL    https://multcontrol.onrender.com/scripts/ataques.meta.js
// @downloadURL  https://multcontrol.onrender.com/scripts/ataques.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
// ==/UserScript==

(function() {
    'use strict';

    // --- VARIÁVEIS GLOBAIS DE CONFIGURAÇÃO ---
    let FIREBASE_CLIENT_CONFIG = {};
    let USERSCRIPT_API_KEY = "";

    // ============================================================================
    // == LÓGICA DE CONFIGURAÇÃO E MIGRAÇÃO DE CHAVES ==
    // ============================================================================
    function setupConfig() {
        const hardcodedConfig = {}; 
        const hardcodedApiKey = "";

        let storedConfig = GM_getValue("FIREBASE_CLIENT_CONFIG", null);
        let storedApiKey = GM_getValue("USERSCRIPT_API_KEY", null);

        if (storedConfig && storedApiKey) {
            FIREBASE_CLIENT_CONFIG = storedConfig;
            USERSCRIPT_API_KEY = storedApiKey;
            console.log('[TW ATTACK ALERT] Configurações carregadas do armazenamento local.');
            return true;
        }
        
        if (Object.keys(hardcodedConfig).length > 0 && hardcodedApiKey) {
            console.log('[TW ATTACK ALERT] Chaves injetadas detectadas. Migrando para o armazenamento local...');
            GM_setValue("FIREBASE_CLIENT_CONFIG", hardcodedConfig);
            GM_setValue("USERSCRIPT_API_KEY", hardcodedApiKey);
            FIREBASE_CLIENT_CONFIG = hardcodedConfig;
            USERSCRIPT_API_KEY = hardcodedApiKey;
            console.log('[TW ATTACK ALERT] Chaves migradas com sucesso!');
            return true;
        }

        alert("MULTCONTROL [Alerta de Ataques]: Chaves de configuração não encontradas! Por favor, instale o script novamente a partir do seu dashboard.");
        return false;
    }

    // --- PONTO DE ENTRADA DO SCRIPT ---
    if (setupConfig()) {
        main();
    }

    async function main() {
        const CHECK_INTERVAL_MS = 10000;
        const API_BASE_URL = "https://multcontrol.onrender.com";
        const ALERT_SERVER_URL = `${API_BASE_URL}/alert`;
        var authClient;

        try {
            if (typeof firebase !== 'undefined' && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
                if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CLIENT_CONFIG, "AttackAlertApp");
                authClient = firebase.auth();
            }
        } catch (e) { console.error('[TW ATTACK ALERT ERROR] Falha na inicialização do Firebase:', e); }

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
        
        function getGameData() {
            const world = window.location.hostname.split('.')[0];
            const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
            const nickname = nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
            return { world, nickname, fullNickname: `${world} - ${nickname}` };
        }

        async function sendAttackAlert(attackCount) {
            try {
                const idToken = await getFreshIdToken();
                if (!idToken) throw new Error("Falha ao obter token para alerta.");
                const { fullNickname } = getGameData();
                const message = `⚔️ ATAQUE(S) NOVO(S)! ${attackCount} ataque(s) a caminho da conta "${fullNickname}"!`;
                await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "POST", url: ALERT_SERVER_URL,
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
                        data: JSON.stringify({ message: message }),
                        onload: res => (res.status < 300) ? resolve(res) : reject(new Error(`Status: ${res.status}`)),
                        onerror: reject
                    });
                });
            } catch (error) {
                console.error("[TW ATTACK ALERT ERROR] Falha no envio do alerta:", error);
            }
        }

        function checkIncomings() {
            const incomingsElement = document.querySelector('a.attack');
            const currentIncomings = incomingsElement ? parseInt(incomingsElement.textContent.trim(), 10) : 0;
            const lastKnownCountKey = `last_attack_count_${getGameData().fullNickname}`;
            const lastKnownCount = GM_getValue(lastKnownCountKey, 0);

            if (currentIncomings > 0 && currentIncomings > lastKnownCount) {
                console.log(`[TW ATTACK ALERT] Novo ataque detectado! De ${lastKnownCount} para ${currentIncomings}.`);
                sendAttackAlert(currentIncomings);
            }
            GM_setValue(lastKnownCountKey, currentIncomings);
        }

        console.log("[TW ATTACK ALERT] Script de Alerta de Ataques iniciado.");
        checkIncomings();
        setInterval(checkIncomings, CHECK_INTERVAL_MS);
    }
})();
