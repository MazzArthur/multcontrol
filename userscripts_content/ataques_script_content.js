// ==UserScript==
// @name         Alerta de Ataques (Tribal Wars)
// @namespace    @@marcosvinicius.santosmarques
// @icon         https://i.imgur.com/7WgHTT8.gif
// @description  Detecta novos ataques a chegar no Tribal Wars e envia alertas.
// @include      http*://*.*game.php*
// @version      1.3.1 // Versão com correção do erro de expirationTime
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

//*************************** CONFIGURAÇÃO ***************************//
const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert";
const CHECK_INTERVAL_MS = 5000;

const NATIVE_NOTIFICATION_TITLE = "ATAQUES A CHEGAR NO TRIBAL WARS!";
const NATIVE_NOTIFICATION_ICON = "https://dsbr.innogamescdn.com/asset/75cb846c/graphic/unit/att.webp";
// ************************* /CONFIGURAÇÃO ************************** //

let lastKnownIncomingsCount = GM_getValue('lastKnownIncomings', 0);
console.log(`[TW ATTACK ALERT] Última contagem de ataques conhecida: ${lastKnownIncomingsCount}`);

// --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---
// Será preenchido dinamicamente pelo servidor
const FIREBASE_CLIENT_CONFIG = {};
// --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

// --- CAMPO PARA USERSCRIPT API KEY (Gerada no Dashboard MULTCONTROL) ---
const USERSCRIPT_API_KEY = ""; // Placeholder, será preenchido pelo servidor
// --- FIM DO CAMPO PARA USERSCRIPT API KEY --

// Inicializa Firebase Client SDK no script
let appClient;
let authClient;
let currentUserFirebase = null; // Para armazenar o usuario logado no Tampermonkey

try {
    if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
        appClient = firebase.initializeApp(FIREBASE_CLIENT_CONFIG, "TWAttackApp-" + Date.now()); // Nome único
        authClient = appClient.auth();
        console.log('[TW ATTACK ALERT] Firebase Client SDK inicializado com config injetada.');
    } else {
        console.warn('[TW ATTACK ALERT] Firebase Client SDK não inicializado. Config ausente ou inválida. O token dinâmico não funcionará.');
    }
} catch (e) {
    console.error('[TW ATTACK ALERT ERROR] Erro ao inicializar Firebase Client SDK no script:', e);
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
        let idTokenForAlert;
        const CACHED_ID_TOKEN_KEY = 'twmc_attack_id_token'; // Chave única para este script
        const CACHED_TOKEN_EXPIRY_KEY = 'twmc_attack_id_token_expiry';
        const now = Date.now();

        const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
        const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && now < cachedExpiry - (5 * 60 * 1000)) { // Expira 5min antes
            idTokenForAlert = cachedToken;
            console.log('[TW Script - Ataque] Usando ID Token do cache.');
        } else {
            console.log('[TW Script - Ataque] ID Token expirado ou não encontrado no cache. Obtendo novo...');
            try {
                if (!currentUserFirebase || typeof currentUserFirebase.getIdToken !== 'function') {
                    console.error('[TW Script - Ataque ERROR] Usuario Firebase nao autenticado no script. Nao ha como obter ID Token.');
                    // Tenta autenticar se não houver user logado (só se authClient estiver disponível)
                    if (authClient && USERSCRIPT_API_KEY && USERSCRIPT_API_KEY !== "") {
                        try {
                            const tokenResponse = await new Promise((res, rej) => {
                                GM_xmlhttpRequest({
                                    method: "POST",
                                    url: "https://multcontrol.onrender.com/api/get_fresh_id_token",
                                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${USERSCRIPT_API_KEY}` },
                                    onload: function(response) { res(response); },
                                    onerror: function(error) { rej(error); }
                                });
                            });

                            if (tokenResponse.status !== 200) {
                                throw new Error(`Falha ao obter Custom Token: Status ${tokenResponse.status}. Resposta: ${tokenResponse.responseText}`);
                            }
                            const customTokenData = JSON.parse(tokenResponse.responseText);
                            const customToken = customTokenData.customToken;
                            
                            await authClient.signInWithCustomToken(customToken);
                            currentUserFirebase = authClient.currentUser; // Define o usuario logado globalmente
                            console.log('[TW Script - Ataque] Login com Custom Token bem-sucedido no script.');

                        } catch (error) {
                            console.error('[TW Script - Ataque ERROR] Falha no login com Userscript API Key ou Custom Token:', error.message);
                            return reject(new Error("Falha na autenticacao do script com Userscript API Key."));
                        }
                    } else {
                        console.error('[TW Script - Ataque ERROR] Autenticação do script falhou: USERSCRIPT_API_KEY ausente ou Firebase Client nao inicializado.');
                        return reject(new Error("Autenticacao do script falhou."));
                    }
                }
                
                const idTokenResult = await currentUserFirebase.getIdTokenResult(); // Usa o usuario atual logado
                idTokenForAlert = idTokenResult.token; // O token JWT real
                const expirationTime = idTokenResult.expirationTime; // <-- CORRIGIDO: Obtem direto de idTokenResult
                GM_setValue(CACHED_ID_TOKEN_KEY, idTokenForAlert);
                GM_setValue(CACHED_TOKEN_EXPIRY_KEY, new Date(expirationTime).getTime()); // Armazena como timestamp
                console.log('[TW Script - Ataque] ID Token fresco obtido e salvo no cache.');

            } catch (error) {
                console.error('[TW Script ERROR] Erro na autenticacao ou obtencao de ID Token fresco:', error);
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
                "Authorization": `Bearer ${idTokenForAlert}`
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

// --- LÓGICA PRINCIPAL DO SCRIPT ---
(function() {
    'use strict';

    console.log("----------------------------------------------------------------------------------");
    console.log("[TW ATTACK ALERT] Script 'Alerta de Ataques' iniciado.");
    console.log("----------------------------------------------------------------------------------");

    if (authClient) { // Só entra aqui se o Firebase Client SDK foi inicializado
        authClient.onAuthStateChanged(async (user) => {
            if (user) {
                console.log(`[TW ATTACK ALERT] Usuario Firebase logado: ${user.email} (UID: ${user.uid}).`);
                currentUserFirebase = user; // Define o usuario logado globalmente
                
                // --- AQUI COMEÇA A LÓGICA PRINCIPAL DO SEU SCRIPT DE ATAQUES ---
                setInterval(async function() { // Torne a função do setInterval async
                    const incomingsAmountSpan = document.getElementById('incomings_amount');
                    const nickname = getNickname();
                    const villageId = getVillageId();
                    let currentIncomingsCount = 0;
                    if (incomingsAmountSpan) {
                        currentIncomingsCount = parseInt(incomingsAmountSpan.textContent.trim(), 10);
                        if (isNaN(currentIncomingsCount)) { currentIncomingsCount = 0; }
                    }

                    if (currentIncomingsCount > lastKnownIncomingsCount && currentIncomingsCount > 0) {
                        const message = `"${nickname}" tem ${currentIncomingsCount} ataque(s) a chegar!`;
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
                }, CHECK_INTERVAL_MS);
                
                // Chamada inicial (imediata)
                (async () => {
                    await checkIncomings();
                })();
                // --- FIM DA LÓGICA PRINCIPAL DO SEU SCRIPT DE ATAQUES ---

            } else {
                console.warn('[TW ATTACK ALERT] Nenhum usuario Firebase logado. Tentando login com Userscript API Key...');
                // Tenta autenticar se não houver user logado (só se authClient estiver disponível)
                if (authClient && USERSCRIPT_API_KEY && USERSCRIPT_API_KEY !== "") {
                    try {
                        const tokenResponse = await new Promise((res, rej) => {
                            GM_xmlhttpRequest({
                                method: "POST",
                                url: "https://multcontrol.onrender.com/api/get_fresh_id_token",
                                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${USERSCRIPT_API_KEY}` },
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
                        console.log('[TW ATTACK ALERT] Login com Custom Token bem-sucedido no script. onAuthStateChanged será disparado novamente.');

                    } catch (error) {
                        console.error('[TW ATTACK ALERT ERROR] Falha no login com Userscript API Key ou Custom Token:', error.message);
                        console.warn('[TW ATTACK ALERT] Alertas não serão enviados devido a falha de autenticação.');
                    }
                } else {
                    console.error('[TW ATTACK ALERT ERROR] Autenticação do script falhou: USERSCRIPT_API_KEY ausente ou Firebase Client não inicializado.');
                    console.warn('[TW ATTACK ALERT] Alertas não serão enviados devido a falha de autenticação.');
                }
            }
        });
    } else {
        console.error('[TW ATTACK ALERT ERROR] Firebase Client SDK ou authClient não está disponível. Não é possível monitorar o estado de autenticação.');
        console.warn('[TW ATTACK ALERT] Alertas não serão enviados.');
    }
})();
