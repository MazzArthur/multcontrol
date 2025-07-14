// ==UserScript==
// @name         Upador Automático v0.2.0 - Dinâmico
// @icon         https://i.imgur.com/7WgHTT8.gif
// @description  Script que busca a ordem de construção dinamicamente da plataforma MULTCONTROL.
// @author       MazzArthur
// @include      http*://*.*game.php*
// @version      0.2.0
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @require      http://code.jquery.com/jquery-1.12.4.min.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
// ==/UserScript==

(async function() {
    'use strict';

    //*************************** CONFIGURAÇÃO ***************************//
    const Min_Tempo_Espera = 800;
    const Max_Tempo_Espera = 900;
    const Auto_Refresh_Ativado = true;
    const Intervalo_Refresh_Minutos = 30;
    const ALERTA_CONSTRUCAO_ATIVADO = true;

    // --- CONSTANTES DA PLATAFORMA ---
    const API_BASE_URL = "https://multcontrol.onrender.com";
    const ALERT_SERVER_URL = `${API_BASE_URL}/alert`;

    // --- CAMPOS QUE SERÃO INJETADOS PELA PLATAFORMA ---
    const FIREBASE_CLIENT_CONFIG = {};
    const USERSCRIPT_API_KEY = "";

    // --- VARIÁVEIS DE CONTROLE ---
    let activeBuildOrder = null; // Cache para a ordem de construção da sessão
    let lastBuildingAlertSent = { id: null, timestamp: 0 };
    const ALERT_COOLDOWN_MS = 5000;
    const Visualizacao_Geral = "OVERVIEW_VIEW";
    const Edificio_Principal = "HEADQUARTERS_VIEW";
    var authClient;

    // ============================================================================
    // == INICIALIZAÇÃO E AUTENTICAÇÃO ==
    // ============================================================================
    try {
        if (typeof firebase !== 'undefined' && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
            if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CLIENT_CONFIG);
            authClient = firebase.auth();
        } else {
            console.warn('[TW Script] Configs do Firebase ausentes.');
        }
    } catch (e) { console.error('[TW Script ERROR] Falha na inicialização do Firebase:', e); }

    async function getFreshIdToken() {
        const CACHED_ID_TOKEN_KEY = 'cachedFirebaseIdToken';
        const CACHED_TOKEN_EXPIRY_KEY = 'cachedFirebaseIdTokenExpiry';
        const now = Date.now();
        const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
        const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && now < cachedExpiry - (5 * 60 * 1000)) {
            return cachedToken;
        }
        try {
            if (!USERSCRIPT_API_KEY) throw new Error("USERSCRIPT_API_KEY nao configurada!");
            const tokenResponse = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST", url: `${API_BASE_URL}/api/get_fresh_id_token`,
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${USERSCRIPT_API_KEY}` },
                    onload: res => resolve(res), onerror: err => reject(err)
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
            console.error('[TW Script ERROR] Falha no processo de autenticação:', error);
            return null;
        }
    }
    
    // ============================================================================
    // == LÓGICA DE NICKNAME E ORDEM DE CONSTRUÇÃO DINÂMICA ==
    // ============================================================================

    function getCurrentGameAccount() {
        const world = window.location.hostname.split('.')[0];
        const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
        if (!nicknameElement) {
            console.warn("[TW Script] Seletor principal de nickname não encontrado.");
            return null;
        }
        const nickname = nicknameElement.textContent.trim();
        return { nickname: nickname, world: world, fullNickname: `${world} - ${nickname}` };
    }

    async function registerNickname() {
        try {
            const account = getCurrentGameAccount();
            if (!account) throw new Error('Não foi possível detectar a conta do jogo.');
            
            const idToken = await getFreshIdToken();
            if (!idToken) throw new Error('Não foi possível obter token para registrar nickname.');

            await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'POST', url: `${API_BASE_URL}/api/nicknames/register`,
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                    data: JSON.stringify({ nickname: account.fullNickname }),
                    onload: res => (res.status >= 200 && res.status < 300) ? resolve(res) : reject(new Error(`Status: ${res.status}`)),
                    onerror: err => reject(err)
                });
            });
            console.log(`[TW Script] Nickname '${account.fullNickname}' verificado/registrado na plataforma.`);
        } catch (error) {
            console.error('[TW Script ERROR] Falha ao registrar nickname:', error);
        }
    }

    async function getDynamicBuildOrder() {
        const CACHE_DURATION_MS = 60 * 60 * 1000; // Cache de 1 hora
        const account = getCurrentGameAccount();
        if (!account) throw new Error("Não foi possível identificar a conta do jogo para buscar a ordem.");

        const cacheKey = `buildOrderCache_${account.fullNickname}`;
        const cachedData = GM_getValue(cacheKey, null);

        if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION_MS)) {
            console.log(`%c[TW Script] Ordem de construção carregada do CACHE.`, 'color: orange; font-weight: bold;');
            return cachedData.order;
        }

        try {
            const idToken = await getFreshIdToken();
            if (!idToken) throw new Error("Não foi possível autenticar para buscar a ordem.");

            console.log(`[TW Script] Buscando ordem de construção para: ${account.fullNickname}`);
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${API_BASE_URL}/api/active-build-order/${encodeURIComponent(account.fullNickname)}`,
                    headers: { 'Authorization': `Bearer ${idToken}` },
                    onload: res => resolve(res),
                    onerror: err => reject(err)
                });
            });

            if (response.status === 200) {
                const data = JSON.parse(response.responseText);
                const newOrder = data.order.map(item => `main_buildlink_${item.building}_${item.level}`);
                GM_setValue(cacheKey, { order: newOrder, timestamp: Date.now() });
                console.log(`%c[TW Script] Ordem de construção personalizada de ${newOrder.length} passos carregada da plataforma.`, 'color: lightgreen; font-weight: bold;');
                return newOrder;
            } else {
                console.log("[TW Script] Nenhum perfil atribuído. Usando ordem de construção padrão do script.");
                const defaultOrder = getDefaultBuildOrder();
                GM_setValue(cacheKey, { order: defaultOrder, timestamp: Date.now() });
                return defaultOrder;
            }
        } catch (error) {
            console.error("[TW Script ERROR] Falha ao buscar ordem de construção. Usando ordem do cache (se disponível) ou padrão.", error);
            return cachedData ? cachedData.order : getDefaultBuildOrder();
        }
    }

    function getDefaultBuildOrder() {
        return [
            "main_buildlink_wood_1","main_buildlink_stone_1","main_buildlink_iron_1","main_buildlink_wood_2","main_buildlink_stone_2","main_buildlink_main_2","main_buildlink_main_3",
            "main_buildlink_barracks_1","main_buildlink_wood_3","main_buildlink_stone_3","main_buildlink_barracks_2","main_buildlink_market_1","main_buildlink_storage_2",
            "main_buildlink_iron_2","main_buildlink_storage_3","main_buildlink_barracks_3","main_buildlink_statue_1","main_buildlink_farm_2","main_buildlink_iron_3",
            "main_buildlink_main_4","main_buildlink_storage_4","main_buildlink_storage_5","main_buildlink_storage_6","main_buildlink_main_5","main_buildlink_smith_1",
            "main_buildlink_wood_4","main_buildlink_stone_4","main_buildlink_wall_1","main_buildlink_hide_2","main_buildlink_hide_3","main_buildlink_wood_5","main_buildlink_stone_5",
            "main_buildlink_wood_6","main_buildlink_stone_6","main_buildlink_wood_7","main_buildlink_stone_7","main_buildlink_iron_4","main_buildlink_iron_5","main_buildlink_iron_6",
            "main_buildlink_wood_8","main_buildlink_stone_8","main_buildlink_iron_7","main_buildlink_wood_9","main_buildlink_stone_9","main_buildlink_wood_10","main_buildlink_stone_10",
            "main_buildlink_farm_3","main_buildlink_farm_4","main_buildlink_farm_5","main_buildlink_farm_6","main_buildlink_wood_11","main_buildlink_stone_11","main_buildlink_wood_12",
            "main_buildlink_stone_12","main_buildlink_storage_7","main_buildlink_storage_8","main_buildlink_iron_8","main_buildlink_storage_9","main_buildlink_storage_10",
            "main_buildlink_iron_9","main_buildlink_iron_10","main_buildlink_farm_7","main_buildlink_farm_8","main_buildlink_farm_9","main_buildlink_farm_10","main_buildlink_wood_13",
            "main_buildlink_stone_13","main_buildlink_iron_11","main_buildlink_iron_12","main_buildlink_main_6","main_buildlink_main_7","main_buildlink_main_8","main_buildlink_main_9",
            "main_buildlink_main_10","main_buildlink_wood_14","main_buildlink_stone_14","main_buildlink_wood_15","main_buildlink_stone_15","main_buildlink_wood_16",
            "main_buildlink_stone_16","main_buildlink_storage_11","main_buildlink_wood_17","main_buildlink_stone_17","main_buildlink_iron_13","main_buildlink_iron_14",
            "main_buildlink_wood_18","main_buildlink_storage_12","main_buildlink_stone_18","main_buildlink_wood_19","main_buildlink_stone_19","main_buildlink_iron_15",
            "main_buildlink_iron_16","main_buildlink_storage_13","main_buildlink_wood_20","main_buildlink_stone_20","main_buildlink_iron_17","main_buildlink_wood_21",
            "main_buildlink_iron_18","main_buildlink_storage_14","main_buildlink_storage_15","main_buildlink_storage_16","main_buildlink_storage_17","main_buildlink_storage_18",
            "main_buildlink_storage_19","main_buildlink_storage_20","main_buildlink_storage_21","main_buildlink_wood_21","main_buildlink_stone_21","main_buildlink_wood_22",
            "main_buildlink_stone_22","main_buildlink_wood_23","main_buildlink_stone_23","main_buildlink_iron_19","main_buildlink_iron_20","main_buildlink_farm_11",
            "main_buildlink_farm_12","main_buildlink_farm_13","main_buildlink_farm_14","main_buildlink_farm_15","main_buildlink_main_11","main_buildlink_main_12",
            "main_buildlink_main_13","main_buildlink_main_14","main_buildlink_main_15","main_buildlink_main_16","main_buildlink_main_17","main_buildlink_main_18",
            "main_buildlink_main_19","main_buildlink_main_20","main_buildlink_iron_21","main_buildlink_wood_24","main_buildlink_stone_24","main_buildlink_iron_22",
            "main_buildlink_wood_25","main_buildlink_stone_25","main_buildlink_storage_22","main_buildlink_storage_23","main_buildlink_storage_24","main_buildlink_storage_25",
            "main_buildlink_storage_26","main_buildlink_storage_27","main_buildlink_iron_23","main_buildlink_wood_26","main_buildlink_stone_26","main_buildlink_iron_24",
            "main_buildlink_wood_27","main_buildlink_stone_27","main_buildlink_iron_25","main_buildlink_wood_28","main_buildlink_stone_28","main_buildlink_iron_26",
            "main_buildlink_wood_29","main_buildlink_stone_29","main_buildlink_iron_27","main_buildlink_wood_30","main_buildlink_stone_30","main_buildlink_iron_28",
            "main_buildlink_iron_29","main_buildlink_iron_30","main_buildlink_storage_28","main_buildlink_storage_29","main_buildlink_storage_30","main_buildlink_farm_16",
            "main_buildlink_farm_17","main_buildlink_farm_18","main_buildlink_farm_19","main_buildlink_farm_20","main_buildlink_market_2","main_buildlink_market_3",
            "main_buildlink_market_4","main_buildlink_market_5","main_buildlink_market_6","main_buildlink_market_7","main_buildlink_market_8","main_buildlink_market_9",
            "main_buildlink_market_10","main_buildlink_market_11","main_buildlink_market_12","main_buildlink_market_13","main_buildlink_market_14","main_buildlink_market_15",
            "main_buildlink_market_16","main_buildlink_market_17","main_buildlink_market_18","main_buildlink_market_19","main_buildlink_market_20","main_buildlink_market_21",
            "main_buildlink_market_22","main_buildlink_market_23","main_buildlink_market_24","main_buildlink_market_25","main_buildlink_farm_21","main_buildlink_farm_22",
            "main_buildlink_farm_23","main_buildlink_farm_24","main_buildlink_farm_25","main_buildlink_barracks_4","main_buildlink_stable_1","main_buildlink_smith_2",
            "main_buildlink_barracks_5","main_buildlink_stable_2","main_buildlink_smith_3","main_buildlink_barracks_6","main_buildlink_stable_3","main_buildlink_smith_4",
            "main_buildlink_barracks_7","main_buildlink_stable_4","main_buildlink_smith_5","main_buildlink_barracks_8","main_buildlink_stable_5","main_buildlink_smith_6",
            "main_buildlink_barracks_9","main_buildlink_stable_6","main_buildlink_smith_7","main_buildlink_barracks_10","main_buildlink_stable_7","main_buildlink_smith_8",
            "main_buildlink_barracks_11","main_buildlink_stable_8","main_buildlink_smith_9","main_buildlink_barracks_12","main_buildlink_stable_9","main_buildlink_smith_10",
            "main_buildlink_barracks_13","main_buildlink_stable_10","main_buildlink_smith_11","main_buildlink_barracks_14","main_buildlink_stable_11","main_buildlink_smith_12",
            "main_buildlink_barracks_15","main_buildlink_stable_12","main_buildlink_smith_13","main_buildlink_barracks_16","main_buildlink_stable_13","main_buildlink_smith_14",
            "main_buildlink_barracks_17","main_buildlink_stable_14","main_buildlink_smith_15","main_buildlink_barracks_18","main_buildlink_stable_15","main_buildlink_smith_16",
            "main_buildlink_barracks_19","main_buildlink_stable_16","main_buildlink_smith_17","main_buildlink_barracks_20","main_buildlink_stable_17","main_buildlink_smith_18",
            "main_buildlink_barracks_21","main_buildlink_stable_18","main_buildlink_smith_19","main_buildlink_barracks_22","main_buildlink_stable_19","main_buildlink_smith_20",
            "main_buildlink_barracks_23","main_buildlink_stable_20","main_buildlink_barracks_24","main_buildlink_barracks_25","main_buildlink_academy_1","main_buildlink_academy_2",
            "main_buildlink_academy_3","main_buildlink_farm_26","main_buildlink_farm_27","main_buildlink_farm_28","main_buildlink_farm_29","main_buildlink_farm_30",
            "main_buildlink_place_1","main_buildlink_garage_1","main_buildlink_garage_2","main_buildlink_garage_3","main_buildlink_garage_4","main_buildlink_garage_5",
            "main_buildlink_garage_6","main_buildlink_garage_7","main_buildlink_garage_8","main_buildlink_garage_9","main_buildlink_garage_10","main_buildlink_garage_11",
            "main_buildlink_garage_12","main_buildlink_garage_13","main_buildlink_garage_14","main_buildlink_garage_15","main_buildlink_snob_1","main_buildlink_snob_2",
            "main_buildlink_snob_3","main_buildlink_wall_2","main_buildlink_wall_3","main_buildlink_wall_4","main_buildlink_wall_5","main_buildlink_wall_6","main_buildlink_wall_7",
            "main_buildlink_wall_8","main_buildlink_wall_9","main_buildlink_wall_10","main_buildlink_wall_11","main_buildlink_wall_12","main_buildlink_wall_13",
            "main_buildlink_wall_14","main_buildlink_wall_15","main_buildlink_wall_16","main_buildlink_wall_17","main_buildlink_wall_18","main_buildlink_wall_19",
            "main_buildlink_wall_20","main_buildlink_watchtower_1","main_buildlink_watchtower_2","main_buildlink_watchtower_3","main_buildlink_watchtower_4",
            "main_buildlink_watchtower_5","main_buildlink_watchtower_6","main_buildlink_watchtower_7","main_buildlink_watchtower_8","main_buildlink_watchtower_9",
            "main_buildlink_watchtower_10","main_buildlink_watchtower_11","main_buildlink_watchtower_12","main_buildlink_watchtower_13","main_buildlink_watchtower_14",
            "main_buildlink_watchtower_15","main_buildlink_watchtower_16","main_buildlink_watchtower_17","main_buildlink_watchtower_18","main_buildlink_watchtower_19",
            "main_buildlink_watchtower_20","main_buildlink_hospital_1","main_buildlink_hospital_2","main_buildlink_hospital_3","main_buildlink_hospital_4",
            "main_buildlink_hospital_5","main_buildlink_hospital_6","main_buildlink_hospital_7","main_buildlink_hospital_8","main_buildlink_hospital_9",
            "main_buildlink_hospital_10","main_buildlink_hospital_11","main_buildlink_hospital_12","main_buildlink_hospital_13","main_buildlink_hospital_14",
            "main_buildlink_hospital_15","main_buildlink_hospital_16","main_buildlink_hospital_17","main_buildlink_hospital_18","main_buildlink_hospital_19",
            "main_buildlink_hospital_20","main_buildlink_hospital_21","main_buildlink_hospital_22","main_buildlink_hospital_23","main_buildlink_hospital_24",
            "main_buildlink_hospital_25","main_buildlink_hospital_26","main_buildlink_hospital_27","main_buildlink_hospital_28","main_buildlink_hospital_29",
            "main_buildlink_hospital_30","main_buildlink_church_1","main_buildlink_church_2","main_buildlink_church_3","main_buildlink_trade_1",
            "main_buildlink_trade_2","main_buildlink_trade_3","main_buildlink_main_21","main_buildlink_main_22","main_buildlink_main_23",
            "main_buildlink_main_24","main_buildlink_main_25","main_buildlink_main_26","main_buildlink_main_27","main_buildlink_main_28",
            "main_buildlink_main_29","main_buildlink_main_30"
        ];
    }
    
    // --- LÓGICA DE EXECUÇÃO PRINCIPAL ---
    
    async function getConstrucao_proximo_edificio() {
        let sequencia = await getDynamicBuildOrder();
        for (const proximoId of sequencia) {
            let elemento = document.getElementById(proximoId);
            if (elemento) {
                return elemento;
            }
        }
        return null;
    }

    async function Proxima_Construcao() {
        let proximoEdificio = await getConstrucao_proximo_edificio();
        if (proximoEdificio && !proximoEdificio.classList.contains('btn-disabled')) {
            let delay = Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera);
            await sendBuildingAlert(proximoEdificio.id);
            setTimeout(() => proximoEdificio.click(), delay);
        }
    }
    
    function executarEtapa1() {
        if (document.location.href.includes("screen=main")) {
            setInterval(Proxima_Construcao, 2000);
        } else {
            document.querySelector("#l_main a")?.click();
        }
    }

    // --- PONTO DE ENTRADA DO SCRIPT ---
    console.log("-- Script do Tribal Wars v0.2.0 ativado --");
    await registerNickname();
    if (Auto_Refresh_Ativado) setInterval(() => location.reload(), Intervalo_Refresh_Minutos * 60 * 1000);
    esperarQuestlines(abrirRecompensas);
    executarEtapa1();

    // Lógica para "Completar Gratis"
    setInterval(() => {
        var tr = $('#buildqueue').find('tr').eq(1);
        if (tr.length > 0) {
            var timeSplit = tr.find('td').eq(1).find('span').eq(0).text().split(':');
            if (timeSplit.length >= 3 && (parseInt(timeSplit[0])*3600 + parseInt(timeSplit[1])*60 + parseInt(timeSplit[2])) < 180) {
                tr.find('td').eq(2).find('a').eq(2).click();
                setTimeout(() => $('.btn-confirm-yes').click(), 500);
            }
        }
    }, 2000);

})();
