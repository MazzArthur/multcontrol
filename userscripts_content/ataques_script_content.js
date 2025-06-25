// ==UserScript==
// @name        Alerta de Ataques (Tribal Wars)
// @namespace   @@marcosvinicius.santosmarques
// @icon        https://i.imgur.com/7WgHTT8.gif
// @description Detecta novos ataques a chegar no Tribal Wars e envia alertas.
// @include     http*://*.*game.php*
// @version     1.2 // Versão com ID Token para alertas segmentados (Gerado por MULTCONTROL)
// @grant       GM_xmlhttpRequest
// @grant       GM_notification
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       unsafeWindow
// @require     http://code.jquery.com/jquery-1.12.4.min.js
// ==/UserScript==

(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[TW ATTACK ALERT] Script 'Alerta de Ataques' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    // --- CAMPO PARA ID TOKEN DO USUÁRIO (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_AUTH_ID_TOKEN = "N/A"; // Será preenchido dinamicamente
    // --- FIM DO CAMPO PARA ID TOKEN ---

    // *************************** CONFIGURAÇÃO *************************** //
    const ALERT_SERVER_URL = "http://localhost:3000/alert";
    const CHECK_INTERVAL_MS = 5000;

    // REMOVIDO EMOJI DA MENSAGEM PADRÃO
    const NATIVE_NOTIFICATION_TITLE = "ATAQUES A CHEGAR NO TRIBAL WARS!"; 
    const NATIVE_NOTIFICATION_ICON = "https://dsbr.innogamescdn.com/asset/75cb846c/graphic/unit/att.webp";
    // ************************* /CONFIGURAÇÃO ************************** //

    let lastKnownIncomingsCount = GM_getValue('lastKnownIncomings', 0);
    console.log(`[TW ATTACK ALERT] Última contagem de ataques conhecida: ${lastKnownIncomingsCount}`);

    // --- FUNÇÕES AUXILIARES ---
    function getNickname() {
        const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
        return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
    }
    function getVillageId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('village');
    }

    function sendAttackAlert(message) {
        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[TW ATTACK ALERT ERROR] GM_xmlhttpRequest NÃO está definido. Verifique a permissão @grant no cabeçalho do script!');
            return;
        }
        if (!FIREBASE_AUTH_ID_TOKEN || FIREBASE_AUTH_ID_TOKEN === "N/A") {
            console.error('[TW ATTACK ALERT ERROR] ID Token Firebase não configurado! Cole o script do dashboard MULTCONTROL.');
            return;
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: ALERT_SERVER_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${FIREBASE_AUTH_ID_TOKEN}`
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
                    new Notification(title, { body: body, icon: icon });
                } else { console.warn("[TW ATTACK ALERT] Permissão para notificações negada."); }
            }).catch(error => {
                console.error("[TW ATTACK ALERT] Erro ao solicitar permissão de notificação:", error);
            });
        }
    }

    // --- LÓGICA PRINCIPAL DE VERIFICAÇÃO DE ATAQUES ---
    function checkIncomings() {
        const incomingsAmountSpan = document.getElementById('incomings_amount');
        const nickname = getNickname();
        const villageId = getVillageId();
        let currentIncomingsCount = 0;
        if (incomingsAmountSpan) {
            currentIncomingsCount = parseInt(incomingsAmountSpan.textContent.trim(), 10);
            if (isNaN(currentIncomingsCount)) { currentIncomingsCount = 0; }
        }

        if (currentIncomingsCount > lastKnownIncomingsCount && currentIncomingsCount > 0) {
            // REMOVIDO EMOJI DA MENSAGEM
            const message = `ATAQUE(S) NOVO(S)! Conta "${nickname}" tem ${currentIncomingsCount} ataque(s) a chegar!`;
            sendAttackAlert(message);
            // REMOVIDO EMOJI DO TÍTULO DA NOTIFICAÇÃO NATIVA
            showNativeNotification("ATAQUES A CHEGAR NO TRIBAL WARS!", `A conta "${nickname}" tem ${currentIncomingsCount} ataque(s) a chegar!`, villageId);
        } else if (currentIncomingsCount < lastKnownIncomingsCount) {
            // Apenas loga se o número de ataques diminuiu
        } else if (currentIncomingsCount === 0 && lastKnownIncomingsCount > 0) {
            // Apenas loga se todos os ataques anteriores foram processados
        }

        if (currentIncomingsCount !== lastKnownIncomingsCount) {
            lastKnownIncomingsCount = currentIncomingsCount;
            GM_setValue('lastKnownIncomings', lastKnownIncomingsCount);
        }
    }

    setInterval(checkIncomings, CHECK_INTERVAL_MS);
    checkIncomings();
})();