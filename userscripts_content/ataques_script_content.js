// ==UserScript==
// @name         Alerta de Ataques (Tribal Wars)
// @namespace    @@marcosvinicius.santosmarques
// @icon         https://i.imgur.com/7WgHTT8.gif
// @description  Detecta novos ataques a chegar no Tribal Wars e envia alertas.
// @include      http*://*.*game.php*
// @version      1.2 // Versão com ID Token para alertas segmentados (Gerado por MULTCONTROL)
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
    const FIREBASE_CLIENT_CONFIG = {}; // Será preenchido dinamicamente pelo servidor
    // --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

    // --- CAMPO PARA ID TOKEN DO USUÁRIO (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_AUTH_ID_TOKEN = "TOKEN_EXEMPLO_IGNORADO_PELO_SCRIPT"; // Este valor será ignorado.
    // --- FIM DO CAMPO PARA ID TOKEN ---

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

    // sendAttackAlert agora é async
    async function sendAttackAlert(message) { // Adicionado 'async'
        // --- Obtem o ID Token FRESCO do Firebase Client ---
        let idToken;
        try {
            if (typeof authClient === 'undefined' || !authClient.currentUser) {
                console.error('[TW ATTACK ALERT ERROR] Nenhum usuário logado no Firebase no script ou authClient nao inicializado. Login necessário no dashboard.');
                return; // Não tente enviar alerta se não há usuário logado
            }
            idToken = await authClient.currentUser.getIdToken(); // OBTÉM TOKEN FRESCO
            console.log('[TW ATTACK ALERT] ID Token fresco obtido com sucesso.');
        } catch (error) {
            console.error('[TW ATTACK ALERT ERROR] Erro ao obter ID Token fresco no script:', error);
            return; // Não tente enviar alerta se o token não puder ser obtido
        }
        // --- FIM: Obtem o ID Token FRESCO ---


        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[TW ATTACK ALERT ERROR] GM_xmlhttpRequest NÃO está definido. Verifique a permissão @grant no cabeçalho do script!');
            return;
        }
        // Mensagem para o servidor
        console.log(`[TW ATTACK ALERT] Tentando enviar alerta: "${message}" para ${ALERT_SERVER_URL}`);

        GM_xmlhttpRequest({
            method: "POST",
            url: ALERT_SERVER_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}` // Use o token FRESCO
            },
            data: JSON.stringify({ message: message }),
            onload: function(response) { console.log("[TW ATTACK ALERT] Alerta enviado com sucesso.", response.responseText); },
            onerror: function(error) { console.error("[TW ATTACK ALERT] Erro de rede ao enviar alerta.", error); }
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