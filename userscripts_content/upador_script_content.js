// ==UserScript==
// @name         Upador Automatico editado + Coleta Recompensa + Refresh Automatico + Alerta de Construcao
// @icon         https://i.imgur.com/7WgHTT8.gif
// @description  Script construtor para game tribalwars, realiza upagem "Upar" dos edificios do game, script realiza a atividade em formato inicial resolvendo as Quest do game, e apos o termino das Quest o script realiza upagem de acordo com perfil pre definido pelo autor do script. Pode ser modificado a alteracao de como e feita a upagem, pelo proprio usuario. Tambem coleta recompensas de construcao e inclui refresh automatico da pagina e alerta de construcao.
// @author       MazzArthur
// @include      http*://*.*game.php*
// @version      0.0.9 // Versao com alerta de construcao adicionado
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @require      http://code.jquery.com/jquery-1.12.4.min.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com  <-- ESTA LINHA FOI ADICIONADA/CONFIRMADA AQUI
// ==/UserScript==

/*##############################################

Logica inicial de Programacao obtida, atraves de um tutorial
      Denominado "Os 5 primeiros dias - Modo Novato"
              Imagens Tambem do Mesmo
                    Autoria : senson

https://forum.tribalwars.com.br/index.php?threads/os-5-primeiros-dias-modo-novato.334845/#post-3677800

##############################################*/

//*************************** CONFIGURACAO ***************************//
// Escolha Tempo de espera minimo e maximo entre acoes (em milissegundos)
const Min_Tempo_Espera = 800;
const Max_Tempo_Espera = 900;

// Etapa_1: Upar O bot automaticamente em Serie Edificios
const Etapa = "Etapa_1";
// Escolha se voce deseja que o bot enfileire os edificios na ordem definida (= true) ou
// assim que um predio estiver disponivel para a fila de construcao (= false)
const Construcao_Edificios_Ordem = true;

// --- CONFIGURACAO DE REFRESH AUTOMATICO ---
const Auto_Refresh_Ativado = true; // Define se o refresh automatico esta ativo (true/false)
const Intervalo_Refresh_Minutos = 30; // Intervalo para o refresh automatico em minutos (Ex: 30 = 30 minutos)
// --- FIM DA CONFIGURACAO DE REFRESH AUTOMATICO ---

// --- CONFIGURACAO DE ALERTA DE CONSTRUCAO ---
const ALERTA_CONSTRUCAO_ATIVADO = true; // Ativa/desativa o envio de alerta para o site
const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert"; // URL do seu servidor de alertas
// Variavel para controlar o ultimo alerta enviado e evitar duplicacao rapida
let lastBuildingAlertSent = { id: null, timestamp: 0 };
const ALERT_COOLDOWN_MS = 5000; // 5 segundos de cooldown para o mesmo alerta
// --- FIM DA CONFIGURACAO DE ALERTA DE CONSTRUCAO ---

// --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---
const FIREBASE_CLIENT_CONFIG = {};
// --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

// --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
// POR FAVOR, SUBSTITUA "SEU_ID_TOKEN_AQUI" PELO SEU TOKEN REAL.
// SEM ISSO, A FUNCIONALIDADE DE ALERTA NAO VAI FUNCIONAR.
const FIREBASE_AUTH_ID_TOKEN = "TOKEN_EXEMPLO_IGNORADO_PELO_SCRIPT"; // Este valor será ignorado. O token será obtido dinamicamente.
// --- FIM DO CAMPO PARA ID TOKEN ---

//*************************** /CONFIGURACAO ***************************//

// Constantes (NAO DEVE SER ALTERADAS)
const Visualizacao_Geral = "OVERVIEW_VIEW";
const Edificio_Principal = "HEADQUARTERS_VIEW";


// --- FUNCOES GLOBAIS (FORA DA IIFE) PARA ACESSO POR OUTRAS FUNCOES GLOBAIS ---

// Inicializa Firebase Client SDK no script (fora das funções para ser global)
// Isso deve ser feito APENAS UMA VEZ por script.
var authClient; // Declarado aqui para ser acessível globalmente no script
try {
    if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
        firebase.initializeApp(FIREBASE_CLIENT_CONFIG);
        authClient = firebase.auth();
        console.log('[TW Script] Firebase Client SDK inicializado com config injetada.');
    } else {
        console.warn('[TW Script] Firebase Client SDK não inicializado no script. FIREBASE_CLIENT_CONFIG ausente ou inválida. O token dinâmico não funcionará.');
    }
} catch (e) {
    console.error('[TW Script ERROR] Erro ao inicializar Firebase Client SDK no script:', e);
}


// --- FUNCOES AUXILIARES PARA ALERTA DE CONSTRUCAO ---
function getNickname() {
    const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
    if (!nicknameElement) {
        console.warn('[TW Script] Nickname element (#menu_row...) nao encontrado. Retornando "Desconhecido". Isso pode ocorrer se voce nao estiver na tela principal ou a estrutura HTML mudou.');
    }
    return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
}

function getBuildingName(buildingId) {
    const buildingNames = {
        "main": "Edificio Principal",
        "wood": "Bosque",
        "stone": "Jazida de Argila",
        "iron": "Mina de Ferro",
        "storage": "Armazem",
        "farm": "Fazenda",
        "barracks": "Quartel",
        "smith": "Ferreiro",
        "wall": "Muralha",
        "hide": "Esconderijo",
        "market": "Mercado",
        "statue": "Estatua",
        "place": "Ponto de Reuniao",
        "academy": "Academia",
        "stable": "Estabulo",
        "garage": "Oficina",
        "snob": "Corte de Nobres",
        "watchtower": "Torre de Vigia",
        "hospital": "Hospital",
        "church": "Igreja",
        "trade": "Posto de Trocas"
    };
    const parts = buildingId.split('_');
    const namePart = parts[2];
    const levelPart = parts[3];
    const name = buildingNames[namePart] || namePart;
    return `${name} Nv. ${levelPart}`;
}

// sendBuildingAlert agora retorna uma Promise
async function sendBuildingAlert(buildingId) { // Adicionado 'async'
    return new Promise(async (resolve, reject) => { // Adicionado 'async' aqui também
        if (!ALERTA_CONSTRUCAO_ATIVADO) {
            console.log('[TW Script] Alerta de construcao desativado nas configuracoes.');
            return resolve(); // Resolve imediatamente se desativado
        }

        // --- Obtem o ID Token FRESCO do Firebase Client ---
        let idToken;
        try {
            // Verifica se authClient esta inicializado e se ha um usuario logado
            if (typeof authClient === 'undefined' || !authClient.currentUser) {
                console.error('[TW Script ERROR] Nenhum usuario logado no Firebase no script ou authClient nao inicializado. Login necessario no dashboard.');
                return reject(new Error("Usuario nao autenticado ou Firebase Client nao inicializado."));
            }
            idToken = await authClient.currentUser.getIdToken(); // OBTÉM TOKEN FRESCO
            console.log('[TW Script] ID Token fresco obtido com sucesso.');
        } catch (error) {
            console.error('[TW Script ERROR] Erro ao obter ID Token fresco no script:', error);
            return reject(error); // Rejeita se o token nao puder ser obtido
        }
        // --- FIM: Obtem o ID Token FRESCO ---


        // Verifica se este mesmo alerta foi enviado muito recentemente
        const currentTime = Date.now();
        if (lastBuildingAlertSent.id === buildingId && (currentTime - lastBuildingAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
            console.log(`[TW Script] Alerta para ${buildingId} ignorado: cooldown ativo.`);
            return resolve(); // Resolve se estiver em cooldown
        }

        const nickname = getNickname();
        const buildingName = getBuildingName(buildingId);
        const message = `🛠️ Construcao Iniciada: "${buildingName}" na conta "${nickname}"!`;

        console.log(`[TW Script] ENVIANDO ALERTA DE CONSTRUCAO: "${message}" para ${ALERT_SERVER_URL}`);

        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[TW Script ERROR] GM_xmlhttpRequest NAO esta definido. Verifique a permissao @grant no cabecalho do script!');
            return reject(new Error("GM_xmlhttpRequest nao definido.")); // Rejeita se GM_xmlhttpRequest nao estiver disponivel
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: ALERT_SERVER_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}` // Adiciona o token de autenticacao FRESCO
            },
            data: JSON.stringify({ message: message }),
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    console.log("[TW Script] Alerta de construcao enviado com sucesso. Resposta do servidor:", response.responseText);
                    // Atualiza o estado do ultimo alerta enviado apenas se for bem-sucedido
                    lastBuildingAlertSent = { id: buildingId, timestamp: currentTime };
                    resolve(response); // Resolve a Promise em sucesso
                } else {
                    console.error(`[TW Script] Erro ao enviar alerta de construcao. Status: ${response.status}. Resposta: ${response.responseText || 'N/A'}`);
                    reject(new Error(`Erro ao enviar alerta: Status ${response.status}`)); // Rejeita em erro HTTP
                }
            },
            onerror: function(error) {
                console.error("[TW Script] Erro de rede ao enviar alerta de construcao:", error);
                reject(error); // Rejeita em erro de rede
            }
        });
    });
}
// --- FIM DAS FUNCOES AUXILIARES PARA ALERTA DE CONSTRUCAO ---


// --- FUNCOES DE COLETA DE RECOMPENSAS (tambem movidas para o escopo global) ---
function esperarQuestlines(callback) {
    const intervalo = setInterval(() => {
        if (typeof unsafeWindow.Questlines !== 'undefined' && unsafeWindow.Questlines) { // Usar unsafeWindow aqui
            clearInterval(intervalo);
            callback();
        }
    }, 500);
}

function abrirRecompensas() {
    if (typeof unsafeWindow.Questlines === 'undefined' || !unsafeWindow.Questlines) { // Usar unsafeWindow aqui
        console.warn('[TW Script] Questlines nao esta definido. Nao foi possivel abrir o popup de recompensas.');
        return;
    }
    unsafeWindow.Questlines.showDialog(0, 'main-tab'); // Usar unsafeWindow aqui
    console.log('[TW Script] Popup de recompensas aberto.');

    setTimeout(() => {
        unsafeWindow.Questlines.selectTabById('main-tab', 0); // Usar unsafeWindow aqui
        console.log('[TW Script] Aba "main-tab" selecionada.');

        setTimeout(() => {
            const abas = document.querySelectorAll("#popup_box_quest > div > div > div.quest-popup-header > div > ul > li > a");
            if (abas.length > 1) {
                abas.forEach((aba, i) => {
                    if (!aba.classList.contains("active")) {
                        console.log(`[TW Script] Clicando na aba ${i + 1}.`);
                        aba.click();
                        setTimeout(coletarRecompensas, 1000);
                    } else {
                        console.log(`[TW Script] Aba ${i + 1} ja esta ativa.`);
                    }
                });
            } else {
                console.log('[TW Script] Somente uma aba disponivel.');
                coletarRecompensas();
            }
        }, 1500);
    }, 1000);
}

function coletarRecompensas() {
    const botoes = document.querySelectorAll('#reward-system-rewards > tr > td:nth-child(6) > a:not(.btn-disabled)'); // Adicionei ':not(.btn-disabled)'
    if (botoes.length === 0) {
        console.log('[TW Script] Nenhuma recompensa disponivel para coleta.');
        setTimeout(simularEsc, 1000);
    } else {
        console.log(`[TW Script] Encontrados ${botoes.length} botoes de recompensa.`);
        let i = 0;
        const collectNext = () => { // Usar funcao para controlar loop
            if (i < botoes.length) {
                const btn = botoes[i];
                if (btn && !btn.classList.contains('btn-disabled')) { // Verificar se o botao nao esta desabilitado
                    btn.click();
                    console.log(`[TW Script] Clicado no botao de recompensa ${i + 1}.`);
                } else {
                    console.log(`[TW Script] Botao ${i + 1} ja coletado ou desabilitado.`);
                }
                i++;
                setTimeout(collectNext, 500); // Pequeno atraso entre cliques para processamento
            } else {
                console.log('[TW Script] Todas as recompensas visiveis foram clicadas.');
                // Apos tentar coletar todos os botoes visiveis, fecha o popup ou reavalia
                setTimeout(() => {
                    const remainingButtons = document.querySelectorAll('#reward-system-rewards > tr > td:nth-child(6) > a:not(.btn-disabled)');
                    if (remainingButtons.length > 0) {
                        console.log('[TW Script] Ainda ha recompensas apos a coleta. Tentando coletar novamente.');
                        coletarRecompensas(); // Chama recursivamente se ainda houver botoes
                    } else {
                        simularEsc(); // Fecha o popup se nao houver mais botoes
                    }
                }, 1500); // Atraso para o estado da UI se atualizar
            }
        };
        collectNext(); // Inicia o processo de coleta
    }
}

function simularEsc() {
    const eventoEsc = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(eventoEsc);
    console.log('[TW Script] Tecla ESC simulada. Popup fechado.');
}
// --- FIM DAS FUNCOES DE COLETA DE RECOMPENSAS ---


(function() {
    'use strict';

    console.log("-- Script do Tribal Wars ativado --");

    // --- LOGICA DE REFRESH AUTOMATICO ---
    if (Auto_Refresh_Ativado) {
        const refreshIntervalMs = Intervalo_Refresh_Minutos * 60 * 1000;
        console.log(`[TW Script] Refresh automatico ativado a cada ${Intervalo_Refresh_Minutos} minutos.`);
        setInterval(() => {
            console.log("[TW Script] Realizando refresh automatico da pagina...");
            location.reload();
        }, refreshIntervalMs);
    }
    // --- FIM DA LOGICA DE REFRESH AUTOMATICO ---

    // Inicia a coleta de recompensas logo que o Questlines estiver disponivel
    // A logica agora espera por unsafeWindow.Questlines
    esperarQuestlines(abrirRecompensas);

    if (Etapa == "Etapa_1"){
        // executeEtapa1 vai conter o setInterval para Proxima_Construcao
        executarEtapa1();
    }

})(); // Fim da IIFE principal

// Logica para "Completar Gratis" - Este bloco nao foi modificado pela sugestao de async/await
// Mas se o botao de 'Finalizar' esta em outra parte da pagina, esta logica pode nao ser ativada.
// MANTIDO DO SEU CÓDIGO ANTERIOR PARA O CASO DE SER A LÓGICA ATIVA
setInterval(function(){
    var text="";
    var tr=$('[id="buildqueue"]').find('tr').eq(1);
    if (tr.length > 0) {
        text=tr.find('td').eq(1).find('span').eq(0).text().split(" ").join("").split("\n").join("");
        var timeSplit=text.split(':');

        if(timeSplit.length >= 3 && (timeSplit[0]*60*60+timeSplit[1]*60+timeSplit[2]*1 < 3*60)){
            console.log("[TW Script] Completar Gratis em " + text);
            tr.find('td').eq(2).find('a').eq(2).click(); // Clica no botao de completar da fila
            setTimeout(function() {
                $('[class="btn btn-confirm-yes"]').click(); // Clica no botao de confirmacao
                // Manter abrirRecompensas aqui, pois o usuario deseja que a coleta ocorra apos o "Completar Gratis"
                abrirRecompensas();
            }, 500);
        }
    } else {
        const buildQueueElement = document.querySelector('#buildqueue');
        if (buildQueueElement && buildQueueElement.children.length === 0) {
            console.log("[TW Script] Fila de construcao vazia. Realizando refresh da pagina em 30 segundos...");
            setTimeout(() => {
                location.reload();
            }, 30000);
        }
    }
}, 2000);


function executarEtapa1(){
    let Evoluir_vilas = getEvoluir_vilas();
    console.log("Estado atual da vila: " + Evoluir_vilas);

    if (Evoluir_vilas == Edificio_Principal){
        setInterval(function(){
            Proxima_Construcao(); // Proxima_Construcao agora é async e lida com o await
        }, 1000);

    } else if (Evoluir_vilas == Visualizacao_Geral){
        document.getElementById("l_main").children[0].children[0].click();
    }
}

function getEvoluir_vilas(){
    let currentUrl = window.location.href;
    if (currentUrl.includes("screen=overview")){
        return Visualizacao_Geral;
    }
    else if (currentUrl.endsWith('main') || currentUrl.includes("screen=main")){
        return Edificio_Principal;
    }
    return null;
}

// Proxima_Construcao agora é async
async function Proxima_Construcao(){ // Adicionado 'async'
    let Construcao_proximo_edificio = getConstrucao_proximo_edificio();
    if (Construcao_proximo_edificio !== undefined && Construcao_proximo_edificio !== null){
        let delay = Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera);
        console.log(`[TW Script] Tentando construir ${Construcao_proximo_edificio.id} em ${delay}ms`);

        try {
            // AQUI: await a Promise antes de continuar
            await sendBuildingAlert(Construcao_proximo_edificio.id);
            console.log("[TW Script] Alerta de construcao enviado (await). Prossiga com o clique.");
        } catch (error) {
            console.error("[TW Script] Falha no envio do alerta, mas continuando com o clique:", error.message);
            // Decide se quer parar ou continuar mesmo com erro no envio do alerta
        }

        setTimeout(function() {
            Construcao_proximo_edificio.click();
            console.log("[TW Script] Clicado em " + Construcao_proximo_edificio.id);
        }, delay);
    } else {
        console.log("[TW Script] Nenhum edificio disponivel para construcao no momento ou fila de construcao cheia.");
    }
}

function getConstrucao_proximo_edificio() {
    let Construcao_Edifcios_Serie = getConstrucao_Edifcios_Serie();
    let instituir = null;
    for (let i = 0; i < Construcao_Edifcios_Serie.length; i++) {
        var proximoId = Construcao_Edifcios_Serie[i];
        let proximo_edificio = document.getElementById(proximoId);

        if (proximo_edificio) {
            let isClickable = !proximo_edificio.classList.contains('btn-disabled');
            let isVisible = proximo_edificio.offsetWidth > 0 || proximo_edificio.offsetHeight > 0;
            let currentLevelElement = proximo_edificio.querySelector('.build_options > span');

            let currentLevel = 0;
            if (currentLevelElement) {
                const match = currentLevelElement.textContent.match(/Nivel (\d+)/);
                if (match) {
                    currentLevel = parseInt(match[1]);
                }
            }

            const idParts = proximoId.split('_');
            const targetLevel = parseInt(idParts[idParts.length - 1]);

            if (isVisible && isClickable && currentLevel < targetLevel){
                instituir = proximo_edificio;
                if (Construcao_Edificios_Ordem){
                    break;
                }
            }
        }
    }
    return instituir;
}

function getConstrucao_Edifcios_Serie() {
    // A ordem de construcao foi atualizada com base na sua prioridade.
    const Sequencia_Construcao = [
        // Foco em recursos iniciais e Edificio Principal
        "main_buildlink_wood_1", // Construcao Madeira 1
        "main_buildlink_stone_1", // Construcao Argila 1
        "main_buildlink_iron_1", // Construcao Ferro 1
        "main_buildlink_wood_2", // Construcao Madeira 2
        "main_buildlink_stone_2", // Construcao Argila 2
        "main_buildlink_main_2", // Construcao Edificio Principal 2
        "main_buildlink_main_3", // Construcao Edificio Principal 3
        "main_buildlink_barracks_1", // Construcao Quartel 1
        "main_buildlink_wood_3", // Construcao Madeira 3
        "main_buildlink_stone_3", // Construcao Argila 3
        "main_buildlink_barracks_2", // Construcao Quartel 2

        //------------- Atacar Aldeia Barbara ------------------//
        "main_buildlink_storage_2", // Construcao Armazem 2
        "main_buildlink_iron_2", // Construcao Ferro 2
        "main_buildlink_storage_3", // Construcao Armazem 3

        //---------------- Recrutar Lanceiro -----------------//
        "main_buildlink_barracks_3", // Construcao Quartel 3
        "main_buildlink_statue_1", // Construcao Estatua 1
        "main_buildlink_farm_2", // Construcao Fazenda 2
        "main_buildlink_iron_3", // Construcao Ferro 3
        "main_buildlink_main_4", // Construcao Edificio Principal 4
        "main_buildlink_storage_4", // Construcao Armazem 4
        "main_buildlink_storage_5", // Construcao Armazem 5
        "main_buildlink_storage_6", // Construcao Armazem 6
        "main_buildlink_main_5", // Construcao Edificio Principal 5
        "main_buildlink_smith_1", // Construcao Ferreiro 1
        "main_buildlink_wood_4", // Construcao Madeira 4
        "main_buildlink_stone_4", // Construcao Argila 4

        //---------------- Recrutar Paladino - Escolher Bandeira - -----------------//
        "main_buildlink_wall_1", // Construcao Muralha 1
        "main_buildlink_hide_2", // Construcao Esconderijo 2
        "main_buildlink_hide_3", // Construcao Esconderijo 3
        "main_buildlink_wood_5", // Construcao Madeira 5
        "main_buildlink_stone_5", // Construcao Argila 5
        "main_buildlink_market_1", // Construcao Mercado 1
        "main_buildlink_wood_6", // Construcao Madeira 6
        "main_buildlink_stone_6", // Construcao Argila 6
        "main_buildlink_wood_7", // Construcao Madeira 7
        "main_buildlink_stone_7", // Construcao Argila 7
        "main_buildlink_iron_4", // Construcao Ferro 4
        "main_buildlink_iron_5", // Construcao Ferro 5
        "main_buildlink_iron_6", // Construcao Ferro 6
        "main_buildlink_wood_8", // Construcao Madeira 8
        "main_buildlink_stone_8", // Construcao Argila 8
        "main_buildlink_iron_7", // Construcao Ferro 7
        "main_buildlink_wood_9", // Construcao Madeira 9
        "main_buildlink_stone_9", // Construcao Argila 9
        "main_buildlink_wood_10", // Construcao Madeira 10
        "main_buildlink_stone_10", // Construcao Argila 10
        "main_buildlink_farm_3", // Construcao Fazenda 3
        "main_buildlink_farm_4", // Construcao Fazenda 4
        "main_buildlink_farm_5", // Construcao Fazenda 5
        "main_buildlink_farm_6", // Construcao Fazenda 6

        //---------------- https://image.prntscr.com/image/oMwaEPpCR2_1XaHzlMaobg.png - -----------------//
        "main_buildlink_wood_11", // Construcao Madeira 11
        "main_buildlink_stone_11", // Construcao Argila 11
        "main_buildlink_wood_12", // Construcao Madeira 12
        "main_buildlink_stone_12", // Construcao Argila 12
        "main_buildlink_storage_7", // Construcao Armazem 7
        "main_buildlink_storage_8", // Construcao Armazem 8
        "main_buildlink_iron_8", // Construcao Ferro 8
        "main_buildlink_storage_9", // Construcao Armazem 9
        "main_buildlink_storage_10", // Construcao Armazem 10
        "main_buildlink_iron_9", // Construcao Ferro 9
        "main_buildlink_iron_10", // Construcao Ferro 10
        "main_buildlink_farm_7", // Construcao Fazenda 7
        "main_buildlink_farm_8", // Construcao Fazenda 8
        "main_buildlink_farm_9", // Construcao Fazenda 9
        "main_buildlink_farm_10", // Construcao Fazenda 10

        //---------------- https://image.prntscr.com/image/n6tBlPGORAq9RmqSVccTKg.png - -----------------//
        "main_buildlink_wood_13", // Construcao Madeira 13
        "main_buildlink_stone_13", // Construcao Argila 13
        "main_buildlink_iron_11", // Construcao Ferro 11
        "main_buildlink_iron_12", // Construcao Ferro 12
        "main_buildlink_main_6", // Construcao Edificio Principal 6
        "main_buildlink_main_7", // Construcao Edificio Principal 7
        "main_buildlink_main_8", // Construcao Edificio Principal 8
        "main_buildlink_main_9", // Construcao Edificio Principal 9
        "main_buildlink_main_10", // Construcao Edificio Principal 10

        //---------------- https://image.prntscr.com/image/3pioalUXRK6AH9wNYnRxyQ.png - -----------------//
        "main_buildlink_wood_14", // Construcao Madeira 14
        "main_buildlink_stone_14", // Construcao Argila 14
        "main_buildlink_wood_15", // Construcao Madeira 15
        "main_buildlink_stone_15", // Construcao Argila 15
        "main_buildlink_wood_16", // Construcao Madeira 16
        "main_buildlink_stone_16", // Construcao Argila 16
        "main_buildlink_storage_11", // Construcao Armazem 11
        "main_buildlink_wood_17", // Construcao Madeira 17
        "main_buildlink_stone_17", // Construcao Argila 17
        "main_buildlink_iron_13", // Construcao Ferro 13
        "main_buildlink_iron_14", // Construcao Ferro 14
        "main_buildlink_wood_18", // Construcao Madeira 18
        "main_buildlink_storage_12", // Construcao Armazem 12
        "main_buildlink_stone_18", // Construcao Argila 18
        "main_buildlink_wood_19", // Construcao Madeira 19
        "main_buildlink_stone_19", // Construcao Argila 19
        "main_buildlink_iron_15", // Construcao Ferro 15
        "main_buildlink_iron_16", // Construcao Ferro 16
        "main_buildlink_storage_13", // Construcao Armazem 13
        "main_buildlink_wood_20", // Construcao Madeira 20
        "main_buildlink_stone_20", // Construcao Argila 20
        "main_buildlink_iron_17", // Construcao Ferro 17
        "main_buildlink_wood_21", // Construcao Madeira 21
        "main_buildlink_iron_18", // Construcao Ferro 18
        "main_buildlink_storage_14", // Construcao Armazem 14
        "main_buildlink_storage_15", // Construcao Armazem 15
        "main_buildlink_storage_16", // Construcao Armazem 16
        "main_buildlink_storage_17", // Construcao Armazem 17
        "main_buildlink_storage_18", // Construcao Armazem 18
        "main_buildlink_storage_19", // Construcao Armazem 19
        "main_buildlink_storage_20", // Construcao Armazem 20
        "main_buildlink_storage_21", // Construcao Armazem 21
        "main_buildlink_wood_21", // Construcao Madeira 21
        "main_buildlink_stone_21", // Construcao Argila 21
        "main_buildlink_wood_22", // Construcao Madeira 22
        "main_buildlink_stone_22", // Construcao Argila 22
        "main_buildlink_wood_23", // Construcao Madeira 23
        "main_buildlink_stone_23", // Construcao Argila 23
        "main_buildlink_iron_19", // Construcao Ferro 19
        "main_buildlink_iron_20", // Construcao Ferro 20
        "main_buildlink_farm_11", // Construcao Fazenda 11
        "main_buildlink_farm_12", // Construcao Fazenda 12
        "main_buildlink_farm_13", // Construcao Fazenda 13
        "main_buildlink_farm_14", // Construcao Fazenda 14
        "main_buildlink_farm_15", // Construcao Fazenda 15
        "main_buildlink_main_11", // Construcao Edificio Principal 11
        "main_buildlink_main_12", // Construcao Edificio Principal 12
        "main_buildlink_main_13", // Construcao Edificio Principal 13
        "main_buildlink_main_14", // Construcao Edificio Principal 14
        "main_buildlink_main_15", // Construcao Edificio Principal 15
        "main_buildlink_main_16", // Construcao Edificio Principal 16
        "main_buildlink_main_17", // Construcao Edificio Principal 17
        "main_buildlink_main_18", // Construcao Edificio Principal 18
        "main_buildlink_main_19", // Construcao Edificio Principal 19
        "main_buildlink_main_20", // Construcao Edificio Principal 20
        "main_buildlink_iron_21", // Construcao Ferro 21
        "main_buildlink_wood_24", // Construcao Madeira 24
        "main_buildlink_stone_24", // Construcao Argila 24
        "main_buildlink_iron_22", // Construcao Ferro 22
        "main_buildlink_wood_25", // Construcao Madeira 25
        "main_buildlink_stone_25", // Construcao Argila 25
        "main_buildlink_storage_22", // Construcao Armazem 22
        "main_buildlink_storage_23", // Construcao Armazem 23
        "main_buildlink_storage_24", // Construcao Armazem 24
        "main_buildlink_storage_25", // Construcao Armazem 25
        "main_buildlink_storage_26", // Construcao Armazem 26
        "main_buildlink_storage_27", // Construcao Armazem 27
        "main_buildlink_iron_23", // Construcao Ferro 23
        "main_buildlink_wood_26", // Construcao Madeira 26
        "main_buildlink_stone_26", // Construcao Argila 26
        "main_buildlink_iron_24", // Construcao Ferro 24
        "main_buildlink_wood_27", // Construcao Madeira 27
        "main_buildlink_stone_27", // Construcao Argila 27
        "main_buildlink_iron_25", // Construcao Ferro 25
        "main_buildlink_wood_28", // Construcao Madeira 28
        "main_buildlink_stone_28", // Construcao Argila 28
        "main_buildlink_iron_26", // Construcao Ferro 26
        "main_buildlink_wood_29", // Construcao Madeira 29
        "main_buildlink_stone_29", // Construcao Argila 29
        "main_buildlink_iron_27", // Construcao Ferro 27
        "main_buildlink_wood_30", // Construcao Madeira 30
        "main_buildlink_stone_30", // Construcao Argila 30
        "main_buildlink_iron_28", // Construcao Ferro 28
        "main_buildlink_iron_29", // Construcao Ferro 29
        "main_buildlink_iron_30", // Construcao Ferro 30
        "main_buildlink_storage_28", // Construcao Armazem 28
        "main_buildlink_storage_29", // Construcao Armazem 29
        "main_buildlink_storage_30" // Construcao Armazem 30
    ];

    return Sequencia_Construcao;
}