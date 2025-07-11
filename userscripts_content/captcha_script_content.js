// ==UserScript==
// @name         Alerta de Captcha (FUSAO FINAL E LIMPISSIMA)
// @icon         SUA_URL_DO_ICONE_AQUI_SE_TIVER (ex: https://i.imgur.com/seulink.gif)
// @description  Seu script para detectar e alertar sobre Captchas.
// @author       MazzArthur
// @include      http*://*.*game.php*
// @version      0.1.2 // Incrementada a versão para a correção de autenticação
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
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

// --- CAMPO PARA USERSCRIPT API KEY (Gerada no Dashboard MULTCONTROL) ---
const USERSCRIPT_API_KEY = ""; // Placeholder, será preenchido pelo servidor
// --- FIM DO CAMPO PARA USERSCRIPT API KEY --

//*************************** /CONFIGURACAO ***************************//

// Inicializa Firebase Client SDK no script e gerencia autenticação
let appClient;
let authClient;
let currentUserFirebase = null; // Para armazenar o usuario logado no Tampermonkey

try {
    if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
        appClient = firebase.initializeApp(FIREBASE_CLIENT_CONFIG, "TWCaptchaApp-" + Date.now()); // Nome único
        authClient = appClient.auth();
        console.log('[TW Script - Captcha] Firebase Client SDK inicializado com config injetada.');
    } else {
        console.warn('[TW Script - Captcha] Firebase Client SDK não inicializado. Config ausente ou inválida. O token dinâmico não funcionará.');
    }
} catch (e) {
    console.error('[TW Script ERROR - Captcha] Erro ao inicializar Firebase Client SDK no script:', e);
}


// --- FUNÇÕES AUXILIARES ---
function getNickname() {
    const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
    if (!nicknameElement) {
        console.warn('[TW Script - Captcha] Nickname element (#menu_row...) nao encontrado. Retornando "Desconhecido". Isso pode ocorrer se a estrutura HTML mudou.');
    }
    return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
}

// sendAlert agora é async e gerencia o token
async function sendAlert(message) { // Removido 'user' como parametro, usaremos currentUserFirebase
    return new Promise(async (resolve, reject) => {
        if (!ALERTA_CAPTCHA_ATIVADO) {
            console.log('[TW Script - Captcha] Alerta de captcha desativado nas configuracoes.');
            return resolve();
        }

        let idTokenForAlert;
        const CACHED_ID_TOKEN_KEY = 'twmc_captcha_id_token'; // Chave única
        const CACHED_TOKEN_EXPIRY_KEY = 'twmc_captcha_id_token_expiry';
        const now = Date.now();

        const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
        const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && now < cachedExpiry - (5 * 60 * 1000)) { // Expira 5min antes
            idTokenForAlert = cachedToken;
            console.log('[TW Script - Captcha] Usando ID Token do cache.');
        } else {
            console.log('[TW Script - Captcha] ID Token expirado ou não encontrado no cache. Obtendo novo...');
            try {
                if (!currentUserFirebase || typeof currentUserFirebase.getIdToken !== 'function') {
                    console.error('[TW Script - Captcha ERROR] Usuario Firebase nao autenticado no script. Nao ha como obter ID Token.');
                    return reject(new Error("Usuario Firebase nao autenticado no script."));
                }
                idTokenForAlert = await currentUserFirebase.getIdToken();
                const idTokenResult = await currentUserFirebase.getIdTokenResult();
                GM_setValue(CACHED_ID_TOKEN_KEY, idTokenForAlert);
                GM_setValue(CACHED_TOKEN_EXPIRY_KEY, new Date(idTokenResult.expirationTime).getTime());
                console.log('[TW Script - Captcha] ID Token fresco obtido e salvo no cache.');

            } catch (error) {
                console.error('[TW Script - Captcha ERROR] Erro ao obter ID Token fresco:', error);
                return reject(new Error("Falha ao obter ID Token fresco."));
            }
        }

        const currentTime = Date.now();
        const alertId = 'captcha_alert'; // Um ID fixo
        if (lastCaptchaAlertSent.id === alertId && (currentTime - lastCaptchaAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
            console.log(`[TW Script - Captcha] Alerta de captcha ignorado: cooldown ativo.`);
            return resolve();
        }

        const fullMessage = `CAPTCHA NECESSARIO! Conta "${getNickname()}"`;

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
                "Authorization": `Bearer ${idTokenForAlert}`
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

    // Espera pelo estado de autenticacao do Firebase
    if (authClient) { // Só entra aqui se o Firebase Client SDK foi inicializado
        authClient.onAuthStateChanged(async (user) => {
            if (user) {
                console.log(`[TW Script - Captcha] Usuario Firebase logado: ${user.email} (UID: ${user.uid}).`);
                currentUserFirebase = user; // Define o usuario logado globalmente
                
                // --- AQUI COMEÇA A LÓGICA PRINCIPAL DO SEU SCRIPT DE CAPTCHA ---
                const captchaCheckInterval = setInterval(async function() { // Torne a função do setInterval async
                    const initialButton = document.querySelector("#inner-border > table > tbody > tr:nth-child(1) > td > a");

                    if (initialButton) {
                        clearInterval(captchaCheckInterval);
                        const nickname = getNickname();
                        const captchaMessage = `CAPTCHA NECESSARIO! A conta "${nickname}" precisa resolver um Captcha agora!`;
                        
                        await sendAlert(captchaMessage); // Adicionado 'await'
                        
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
                // --- FIM DA LÓGICA PRINCIPAL DO SEU SCRIPT DE CAPTCHA ---

            } else {
                console.warn('[TW Script - Captcha] Nenhum usuario Firebase logado. Tentando login com Userscript API Key...');
                // Tenta autenticar se não houver user logado (só se authClient estiver disponível)
                if (authClient && USERSCRIPT_API_KEY && USERSCRIPT_API_KEY !== "") {
                    try {
                        const tokenResponse = await new Promise((res, rej) => {
                            GM_xmlhttpRequest({
                                method: "POST",
                                url: "https://multcontrol.onrender.com/api/get_fresh_id_token",
                                headers: { "Authorization": `Bearer ${USERSCRIPT_API_KEY}` },
                                onload: function(response) { res(response); },
                                onerror: function(error) { rej(error); }
                            });
                        });

                        if (tokenResponse.status !== 200) {
                            throw new Error(`Falha ao obter Custom Token: Status ${tokenResponse.status}. Resposta: ${tokenResponse.responseText}`);
                        }
                        const customTokenData = JSON.parse(tokenResponse.responseText);
                        const customToken = customTokenData.customToken;
                        
                        // Faz login com Custom Token
                        await authClient.signInWithCustomToken(customToken);
                        // Após o signInWithCustomToken, onAuthStateChanged será disparado novamente com o usuário.
                        // A lógica principal será iniciada no novo disparo.
                        console.log('[TW Script - Captcha] Login com Custom Token bem-sucedido no script. onAuthStateChanged será disparado novamente.');

                    } catch (error) {
                        console.error('[TW Script ERROR - Captcha] Falha no login com Userscript API Key ou Custom Token:', error.message);
                        console.warn('[TW Script - Captcha] Alertas não serão enviados devido a falha de autenticação.');
                    }
                } else {
                    console.error('[TW Script ERROR - Captcha] Autenticação do script falhou: USERSCRIPT_API_KEY ausente ou Firebase Client não inicializado.');
                    console.warn('[TW Script - Captcha] Alertas não serão enviados devido a falha de autenticação.');
                }
            }
        });
    } else {
        console.error('[TW Script ERROR - Captcha] Firebase Client SDK ou authClient não está disponível. Não é possível monitorar o estado de autenticação.');
        console.warn('[TW Script - Captcha] Alertas não serão enviados.');
    }
})();
