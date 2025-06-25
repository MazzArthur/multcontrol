// ==UserScript==
// @name          Alerta de Captcha (FUSAO FINAL E LIMPISSIMA)
// @version       3.3 // Versao com ID Token para alertas segmentados (Gerado por MULTCONTROL)
// @description   Detecta Captcha, alerta via web/nativa e realiza cliques no Tribal Wars.
// @include       *
// @grant         GM_xmlhttpRequest
// @grant         GM_notification
// ==/UserScript==

(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[Tampermonkey DEBUG] Script 'Alerta de Captcha (FUSAO FINAL)' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    // --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
    const FIREBASE_AUTH_ID_TOKEN = "N/A"; // Sera preenchido dinamicamente
    // --- FIM DO CAMPO PARA ID TOKEN ---

    const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert";

    function sendAlert(message) {
        if (!FIREBASE_AUTH_ID_TOKEN || FIREBASE_AUTH_ID_TOKEN === "N/A") {
            console.error('[Tampermonkey ERROR] ID Token Firebase nao configurado! Cole o script do dashboard MULTCONTROL.');
            return;
        }

        // Mensagem para o servidor (SEM ACENTOS, SEM EMOJI)
        console.log(`[Tampermonkey] Tentando enviar alerta: "${message}" para ${ALERT_SERVER_URL}`);

        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[Tampermonkey ERROR] GM_xmlhttpRequest NAO esta definido. Verifique a permissao @grant no cabecalho do script!');
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

    const captchaCheckInterval = setInterval(function() {
        const initialButton = document.querySelector("#inner-border > table > tbody > tr:nth-child(1) > td > a");

        if (initialButton) {
            clearInterval(captchaCheckInterval);
            const nickname = getNickname();
            // MENSAGEM PARA O SERVIDOR (SEM ACENTOS, SEM EMOJI)
            const captchaMessage = `CAPTCHA NECESSARIO! A conta "${nickname}" precisa resolver um Captcha agora!`;
            sendAlert(captchaMessage);
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
