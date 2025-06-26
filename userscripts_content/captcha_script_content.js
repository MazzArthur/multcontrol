// ==UserScript==
// @name         Alerta de Captcha (FUSAO FINAL E LIMPISSIMA)
// @icon         SUA_URL_DO_ICONE_AQUI_SE_TIVER (ex: https://i.imgur.com/seulink.gif)
// @description  Seu script para detectar e alertar sobre Captchas.
// @author       MazzArthur
// @include      http*://*.*game.php*
// @version      0.1.1 // Incrementada a versão
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @require      http://code.jquery.com/jquery-1.12.4.min.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
// ==/UserScript==

//*************************** CONFIGURACAO ***************************//
// --- COLOQUE AQUI AS SUAS CONFIGURAÇÕES ESPECÍFICAS DE CAPTCHA (se houver) ---
const ALERTA_CAPTCHA_ATIVADO = true; // Exemplo
const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert";
let lastCaptchaAlertSent = { id: null, timestamp: 0 };
const ALERT_COOLDOWN_MS = 10000; // 10 segundos de cooldown

// --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---
// Será preenchido dinamicamente pelo servidor
const FIREBASE_CLIENT_CONFIG = {};
// --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

// --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
const FIREBASE_AUTH_ID_TOKEN = ""; // O script obterá o token fresco. Este valor será ignorado.
// --- FIM DO CAMPO PARA ID TOKEN --

//*************************** /CONFIGURACAO ***************************//


// --- FUNCOES AUXILIARES ---
function getNickname() {
    const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
    if (!nicknameElement) {
        console.warn('[TW Script - Captcha] Nickname element (#menu_row...) nao encontrado. Retornando "Desconhecido". Isso pode ocorrer se a estrutura HTML mudou.');
    }
    return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
}

// sendAlert agora é async
async function sendAlert(message, user) { // Adicionado 'user' como parametro
    return new Promise(async (resolve, reject) => {
        if (!ALERTA_CAPTCHA_ATIVADO) {
            console.log('[TW Script - Captcha] Alerta de captcha desativado nas configuracoes.');
            return resolve();
        }

        let idToken;
        try {
            // Verifica se o user foi passado e se ele eh um objeto de usuario valido
            if (!user || typeof user.getIdToken !== 'function') {
                console.error('[Tampermonkey ERROR] Objeto de usuario invalido para obter ID Token. Login necessario no dashboard.');
                return reject(new Error("Usuario invalido para obter ID Token."));
            }
            idToken = await user.getIdToken(); // OBTÉM TOKEN FRESCO DO USUARIO PASSADO
            console.log('[Tampermonkey - Captcha] ID Token fresco obtido com sucesso.');
        } catch (error) {
            console.error('[Tampermonkey - Captcha ERROR] Erro ao obter ID Token fresco no script:', error);
            return reject(error);
        }

        const currentTime = Date.now();
        const alertId = 'captcha_alert'; // Um ID fixo para alertas de captcha
        if (lastCaptchaAlertSent.id === alertId && (currentTime - lastCaptchaAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
            console.log(`[TW Script - Captcha] Alerta de captcha ignorado: cooldown ativo.`);
            return resolve();
        }

        const fullMessage = `CAPTCHA NECESSARIO! Conta "${getNickname()}" precisa resolver um Captcha agora!`; // Use a mensagem completa com nickname

        console.log(`[TW Script - Captcha] ENVIANDO ALERTA DE CAPTCHA: "${fullMessage}" para ${ALERT_SERVER_URL}`);

        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[Tampermonkey - Captcha ERROR] GM_xmlhttpRequest NÃO está definido. Verifique permissão @grant.');
            return reject(new Error("GM_xmlhttpRequest nao definido."));
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: ALERT_SERVER_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            data: JSON.stringify({ message: fullMessage }),
            onload: function(response) { console.log("[Tampermonkey - Captcha] Alerta enviado com sucesso.", response.responseText); resolve(response); },
            onerror: function(error) { console.error("[Tampermonkey - Captcha] Erro de rede ao enviar alerta.", error); reject(error); }
        });
    });
}

function showNativeNotification(title, body, icon = "https://www.google.com/favicon.ico") {
    console.log(`[Tampermonkey - Captcha] Tentando mostrar notificacao nativa: "${title}" - "${body}"`);
    if (!("Notification" in window)) {
        console.warn("[Tampermonkey - Captcha] Este navegador nao suporta notificacoes de desktop.");
    } else if (Notification.permission === "granted") {
        new Notification(title, { body: body, icon: icon });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(function (permission) {
            if (permission === "granted") {
                new Notification(title, { body: body, icon: icon });
            } else {
                console.warn("[Tampermonkey - Captcha] Permissao para notificacoes negada.");
            }
        }).catch(error => {
            console.error("[Tampermonkey - Captcha] Erro ao solicitar permissao de notificacao:", error);
        });
    }
}

// --- LOGICA PRINCIPAL DO SCRIPT ---
(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[Tampermonkey DEBUG] Script 'Alerta de Captcha (FUSAO FINAL)' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    // --- INICIALIZACAO FIREBASE CLIENT E VERIFICACAO DE AUTENTICACAO ---
    let appClient;
    let authClient;

    try {
        if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
            appClient = firebase.initializeApp(FIREBASE_CLIENT_CONFIG, "captchaApp"); // Use um nome diferente para a app
            authClient = appClient.auth();
            console.log('[TW Script - Captcha] Firebase Client SDK inicializado com config injetada.');
        } else {
            console.warn('[TW Script - Captcha] Firebase Client SDK não inicializado. Config ausente ou inválida. O token dinâmico não funcionará.');
        }
    } catch (e) {
        console.error('[TW Script ERROR - Captcha] Erro ao inicializar Firebase Client SDK no script:', e);
    }

    // Espera pelo estado de autenticacao do Firebase
    if (authClient) {
        authClient.onAuthStateChanged(async (user) => {
            if (user) {
                console.log(`[TW Script - Captcha] Usuario Firebase logado: ${user.email} (UID: ${user.uid}).`);
                // --- AQUI COMEÇA A LÓGICA PRINCIPAL DO SEU SCRIPT DE CAPTCHA ---
                // Agora que o usuario esta logado, podemos iniciar a verificacao de captcha e enviar alertas
                const captchaCheckInterval = setInterval(async function() {
                    const initialButton = document.querySelector("#inner-border > table > tbody > tr:nth-child(1) > td > a");

                    if (initialButton) {
                        clearInterval(captchaCheckInterval);
                        const nickname = getNickname();
                        // MENSAGEM PARA O SERVIDOR (SEM ACENTOS, SEM EMOJI)
                        const captchaMessage = `CAPTCHA NECESSARIO! A conta "${nickname}" precisa resolver um Captcha agora!`;
                        
                        // Passa o objeto 'user' para sendAlert
                        await sendAlert(captchaMessage, user); 
                        
                        // Notificação nativa (PODE TER EMOJI e ACENTOS)
                        showNativeNotification("Acao Necessaria!", `A conta "${nickname}" precisa resolver um Captcha!`);
                        initialButton.click();
                        setTimeout(function() {
                            const logoutButton = document.querySelector("#linkContainer > a:nth-child(7)");
                            if (logoutButton) {
                                logoutButton.click();
                            }
                        }, 500);
                    }
                }, 33000); // Verifica a cada 33 segundos
                // --- FIM DA LÓGICA PRINCIPAL DO SEU SCRIPT DE CAPTCHA ---

            } else {
                console.warn('[TW Script - Captcha] Nenhum usuario Firebase logado. Alertas de captcha nao serao enviados.');
                // Pode adicionar uma lógica para notificar o usuário que ele precisa logar no dashboard
            }
        });
    } else {
        console.error('[TW Script - Captcha] authClient nao inicializado. Nao foi possivel monitorar o estado de autenticacao.');
    }
})();
