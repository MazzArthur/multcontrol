// ==UserScript==
// @name                Upador Automatico editado + Coleta Recompensa + Refresh Automático + Alerta de Construção
// @icon                https://i.imgur.com/7WgHTT8.gif
// @description         Script construtor para game tribalwars, realiza upagem “Upar” dos edifícios do game, script realiza a atividade em formato inicial resolvendo as Quest do game, e após o término das Quest o script realiza upagem de acordo com perfil pré definido pelo autor do script. Pode ser modificado a alteração de como é feita a upagem, pelo próprio usuário. Também coleta recompensas de construção e inclui refresh automático da página e alerta de construção.
// @author              MazzArthur
// @include             http*://*.*game.php*
// @version             0.0.9 // Versão com alerta de construção adicionado
// @grant               GM_getResourceText
// @grant               GM_addStyle
// @grant               GM_getValue
// @grant               unsafeWindow
// @grant               GM_xmlhttpRequest
// @require             http://code.jquery.com/jquery-1.12.4.min.js
// ==/UserScript==

/*##############################################

Logica inicial de Programação obtida, atraves de um tutorial
      Denominado "Os 5 primeiros dias - Modo Novato"
              Imagens Também do Mesmo
                 Autoria : senson

https://forum.tribalwars.com.br/index.php?threads/os-5-primeiros-dias-modo-novato.334845/#post-3677800

##############################################*/

//*************************** CONFIGURAÇÃO ***************************//
// Escolha Tempo de espera mínimo e máximo entre ações (em milissegundos)
const Min_Tempo_Espera = 800;
const Max_Tempo_Espera = 900;

// Etapa_1: Upar O bot automaticamente em Série Edificios
const Etapa = "Etapa_1";
// Escolha se você deseja que o bot enfileire os edifícios na ordem definida (= true) ou
// assim que um prédio estiver disponível para a fila de construção (= false)
const Construção_Edificios_Ordem = true;

// --- CONFIGURAÇÃO DE REFRESH AUTOMÁTICO ---
const Auto_Refresh_Ativado = true; // Define se o refresh automático está ativo (true/false)
const Intervalo_Refresh_Minutos = 30; // Intervalo para o refresh automático em minutos (Ex: 30 = 30 minutos)
// --- FIM DA CONFIGURAÇÃO DE REFRESH AUTOMÁTICO ---

// --- CONFIGURACAO DE ALERTA DE CONSTRUCAO ---
const ALERTA_CONSTRUCAO_ATIVADO = true; // Ativa/desativa o envio de alerta para o site
const ALERT_SERVER_URL = "https://multcontrol.onrender.com/alert"; // URL do seu servidor de alertas
// Variável para controlar o último alerta enviado e evitar duplicação rápida
let lastBuildingAlertSent = { id: null, timestamp: 0 };
const ALERT_COOLDOWN_MS = 5000; // 5 segundos de cooldown para o mesmo alerta
// --- FIM DA CONFIGURAÇÃO DE ALERTA DE CONSTRUÇÃO ---

// --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
// POR FAVOR, SUBSTITUA "SEU_ID_TOKEN_AQUI" PELO SEU TOKEN REAL.
// SEM ISSO, A FUNCIONALIDADE DE ALERTA NAO VAI FUNCIONAR.
const FIREBASE_AUTH_ID_TOKEN = "SEU_ID_TOKEN_AQUI";
// --- FIM DO CAMPO PARA ID TOKEN ---

//*************************** /CONFIGURAÇÃO ***************************//

// Constantes (NÃO DEVE SER ALTERADAS)
const Visualização_Geral = "OVERVIEW_VIEW";
const Edificio_Principal = "HEADQUARTERS_VIEW";


// --- FUNÇÕES GLOBAIS (FORA DA IIFE) PARA ACESSO POR OUTRAS FUNÇÕES GLOBAIS ---

// --- FUNÇÕES AUXILIARES PARA ALERTA DE CONSTRUÇÃO ---
function getNickname() {
    const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
    if (!nicknameElement) {
        console.warn('[TW Script] Nickname element (#menu_row...) não encontrado. Retornando "Desconhecido". Isso pode ocorrer se você não estiver na tela principal ou a estrutura HTML mudou.');
    }
    return nicknameElement ? nicknameElement.textContent.trim() : "Desconhecido";
}

function getBuildingName(buildingId) {
    const buildingNames = {
        "main": "Edifício Principal",
        "wood": "Bosque",
        "stone": "Jazida de Argila",
        "iron": "Mina de Ferro",
        "storage": "Armazém",
        "farm": "Fazenda",
        "barracks": "Quartel",
        "smith": "Ferreiro",
        "wall": "Muralha",
        "hide": "Esconderijo",
        "market": "Mercado",
        "statue": "Estátua",
        "place": "Ponto de Reunião",
        "academy": "Academia",
        "stable": "Estábulo",
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

function sendBuildingAlert(buildingId) {
    if (!ALERTA_CONSTRUCAO_ATIVADO) {
        console.log('[TW Script] Alerta de construção desativado nas configurações.');
        return;
    }

    // Verifica se este mesmo alerta foi enviado muito recentemente
    const currentTime = Date.now();
    if (lastBuildingAlertSent.id === buildingId && (currentTime - lastBuildingAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
        console.log(`[TW Script] Alerta para ${buildingId} ignorado: cooldown ativo.`);
        return;
    }

    const nickname = getNickname();
    const buildingName = getBuildingName(buildingId);
    const message = `🛠️ Construção Iniciada: "${buildingName}" na conta "${nickname}"!`;

    console.log(`[TW Script] ENVIANDO ALERTA DE CONSTRUÇÃO: "${message}" para ${ALERT_SERVER_URL}`);

    if (typeof GM_xmlhttpRequest === 'undefined') {
        console.error('[TW Script ERROR] GM_xmlhttpRequest NÃO está definido. Verifique a permissão @grant no cabeçalho do script!');
        return;
    }

    GM_xmlhttpRequest({
        method: "POST",
        url: ALERT_SERVER_URL,
        headers: {
            "Content-Type": "application/json"
        },
        data: JSON.stringify({ message: message }),
        onload: function(response) {
            if (response.status >= 200 && response.status < 300) {
                console.log("[TW Script] Alerta de construção enviado com sucesso. Resposta do servidor:", response.responseText);
                // Atualiza o estado do último alerta enviado apenas se for bem-sucedido
                lastBuildingAlertSent = { id: buildingId, timestamp: currentTime };
            } else {
                console.error(`[TW Script] Erro ao enviar alerta de construção. Status: ${response.status}. Resposta: ${response.responseText || 'N/A'}`);
            }
        },
        onerror: function(error) {
            console.error("[TW Script] Erro de rede ao enviar alerta de construção:", error);
        }
    });
}
// --- FIM DAS FUNÇÕES AUXILIARES PARA ALERTA DE CONSTRUÇÃO ---


// --- FUNÇÕES DE COLETA DE RECOMPENSAS (também movidas para o escopo global) ---
function esperarQuestlines(callback) {
    const intervalo = setInterval(() => {
        if (typeof Questlines !== 'undefined') {
            clearInterval(intervalo);
            callback();
        }
    }, 500);
}

function abrirRecompensas() {
    if (typeof Questlines === 'undefined') {
        console.warn('[TW Script] Questlines não está definido. Não foi possível abrir o popup de recompensas.');
        return;
    }
    Questlines.showDialog(0, 'main-tab');
    console.log('[TW Script] Popup de recompensas aberto.');

    setTimeout(() => {
        Questlines.selectTabById('main-tab', 0);
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
                        console.log(`[TW Script] Aba ${i + 1} já está ativa.`);
                    }
                });
            } else {
                console.log('[TW Script] Somente uma aba disponível.');
                coletarRecompensas();
            }
        }, 1500);
    }, 1000);
}

function coletarRecompensas() {
    const botoes = document.querySelectorAll('#reward-system-rewards > tr > td:nth-child(6) > a');
    if (botoes.length === 0) {
        console.log('[TW Script] Nenhuma recompensa disponível para coleta.');
        setTimeout(simularEsc, 1000);
    } else {
        console.log(`[TW Script] Encontrados ${botoes.length} botões de recompensa.`);
        botoes.forEach((btn, i) => {
            let cliques = 0;
            const maxCliques = 5;
            const intervaloClique = setInterval(() => {
                if (btn && cliques < maxCliques) {
                    btn.click();
                    cliques++;
                    console.log(`[TW Script] Clique ${cliques} no botão de recompensa ${i + 1}.`);
                } else {
                    clearInterval(intervaloClique);
                    console.log(`[TW Script] Finalizado o clique no botão de recompensa ${i + 1}.`);
                }
            }, 1000);
        });
        setTimeout(simularEsc, (botoes.length * 1000) + 1000);
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
// --- FIM DAS FUNÇÕES DE COLETA DE RECOMPENSAS ---


(function() {
    'use strict';

    console.log("-- Script do Tribal Wars ativado --");

    // --- LÓGICA DE REFRESH AUTOMÁTICO ---
    if (Auto_Refresh_Ativado) {
        const refreshIntervalMs = Intervalo_Refresh_Minutos * 60 * 1000;
        console.log(`[TW Script] Refresh automático ativado a cada ${Intervalo_Refresh_Minutos} minutos.`);
        setInterval(() => {
            console.log("[TW Script] Realizando refresh automático da página...");
            location.reload();
        }, refreshIntervalMs);
    }
    // --- FIM DA LÓGICA DE REFRESH AUTOMÁTICO ---

    // Inicia a coleta de recompensas logo que o Questlines estiver disponível
    esperarQuestlines(abrirRecompensas);

    if (Etapa == "Etapa_1"){
        executarEtapa1();
    }

})(); // Fim da IIFE principal

// Lógica para "Completar Grátis"
setInterval(function(){
    var text="";
    var tr=$('[id="buildqueue"]').find('tr').eq(1);
    if (tr.length > 0) {
        text=tr.find('td').eq(1).find('span').eq(0).text().split(" ").join("").split("\n").join("");
        var timeSplit=text.split(':');

        if(timeSplit.length >= 3 && (timeSplit[0]*60*60+timeSplit[1]*60+timeSplit[2]*1 < 3*60)){
            console.log("[TW Script] Completar Grátis em " + text);
            tr.find('td').eq(2).find('a').eq(2).click();
            setTimeout(function() {
                $('[class="btn btn-confirm-yes"]').click();
                // Manter abrirRecompensas aqui, pois o usuário deseja que a coleta ocorra após o "Completar Grátis"
                abrirRecompensas();
            }, 500);
        }
    } else {
        const buildQueueElement = document.querySelector('#buildqueue');
        if (buildQueueElement && buildQueueElement.children.length === 0) {
            console.log("[TW Script] Fila de construção vazia. Realizando refresh da página em 30 segundos...");
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
            Proxima_Construção();
        }, 1000);

    } else if (Evoluir_vilas == Visualização_Geral){
        document.getElementById("l_main").children[0].children[0].click();
    }
}

function getEvoluir_vilas(){
    let currentUrl = window.location.href;
    if (currentUrl.includes("screen=overview")){
        return Visualização_Geral;
    }
    else if (currentUrl.endsWith('main') || currentUrl.includes("screen=main")){
        return Edificio_Principal;
    }
    return null;
}

function Proxima_Construção(){
    let Construção_proximo_edificio = getConstrução_proximo_edificio();
    if (Construção_proximo_edificio !== undefined && Construção_proximo_edificio !== null){
        let delay = Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera);
        console.log(`[TW Script] Tentando construir ${Construção_proximo_edificio.id} em ${delay}ms`);

        // ENVIAR ALERTA AQUI, APENAS UMA VEZ PARA A CONSTRUÇÃO (com controle de cooldown)
        sendBuildingAlert(Construção_proximo_edificio.id);
        console.log("[TW Script] Alerta de construção solicitado ANTES do clique para garantir registro.");

        setTimeout(function() {
            Construção_proximo_edificio.click();
            console.log("[TW Script] Clicado em " + Construção_proximo_edificio.id);
        }, delay);
    } else {
        console.log("[TW Script] Nenhum edifício disponível para construção no momento ou fila de construção cheia.");
    }
}

function getConstrução_proximo_edificio() {
    let Construção_Edifcios_Serie = getConstrução_Edifcios_Serie();
    let instituir = null;
    for (let i = 0; i < Construção_Edifcios_Serie.length; i++) {
        var proximoId = Construção_Edifcios_Serie[i];
        let próximo_edifício = document.getElementById(proximoId);

        if (próximo_edifício) {
            let isClickable = !próximo_edifício.classList.contains('btn-disabled');
            let isVisible = próximo_edifício.offsetWidth > 0 || próximo_edifício.offsetHeight > 0;
            let currentLevelElement = próximo_edifício.querySelector('.build_options > span');

            let currentLevel = 0;
            if (currentLevelElement) {
                const match = currentLevelElement.textContent.match(/Nível (\d+)/);
                if (match) {
                    currentLevel = parseInt(match[1]);
                }
            }

            const idParts = proximoId.split('_');
            const targetLevel = parseInt(idParts[idParts.length - 1]);

            if (isVisible && isClickable && currentLevel < targetLevel){
                instituir = próximo_edifício;
                if (Construção_Edificios_Ordem){
                    break;
                }
            }
        }
    }
    return instituir;
}

function getConstrução_Edifcios_Serie() {
    // A ordem de construção foi atualizada com base na sua prioridade.
    const Sequência_Construção = [
        // Foco em recursos iniciais e Edifício Principal
        "main_buildlink_wood_1", // Construção Madeira 1
        "main_buildlink_stone_1", // Construção Argila 1
        "main_buildlink_iron_1", // Construção Ferro 1
        "main_buildlink_wood_2", // Construção Madeira 2
        "main_buildlink_stone_2", // Construção Argila 2
        "main_buildlink_main_2", // Construção Edificio Principal 2
        "main_buildlink_main_3", // Construção Edificio Principal 3
        "main_buildlink_barracks_1", // Construção Quartel 1
        "main_buildlink_wood_3", // Construção Madeira 3
        "main_buildlink_stone_3", // Construção Argila 3
        "main_buildlink_barracks_2", // Construção Quartel 2

        //------------- Atacar Aldeia Barbara ------------------//
        "main_buildlink_storage_2", // Construção Armazém 2
        "main_buildlink_iron_2", // Construção Ferro 2
        "main_buildlink_storage_3", // Construção Armazém 3

        //---------------- Recrutar Lanceiro -----------------//
        "main_buildlink_barracks_3", // Construção Quartel 3
        "main_buildlink_statue_1", // Construção Estatua 1
        "main_buildlink_farm_2", // Construção Fazenda 2
        "main_buildlink_iron_3", // Construção Ferro 3
        "main_buildlink_main_4", // Construção Edificio Principal 4
        "main_buildlink_storage_4", // Construção Armazém 4
        "main_buildlink_storage_5", // Construção Armazém 5
        "main_buildlink_storage_6", // Construção Armazém 6
        "main_buildlink_main_5", // Construção Edificio Principal 5
        "main_buildlink_smith_1", // Construção Ferreiro 1
        "main_buildlink_wood_4", // Construção Madeira 4
        "main_buildlink_stone_4", // Construção Argila 4

        //---------------- Recrutar Paladino - Escolher Bandeira -  -----------------//
        "main_buildlink_wall_1", // Construção Muralha 1
        "main_buildlink_hide_2", // Construção Esconderijo 2
        "main_buildlink_hide_3", // Construção Esconderijo 3
        "main_buildlink_wood_5", // Construção Madeira 5
        "main_buildlink_stone_5", // Construção Argila 5
        "main_buildlink_market_1", // Construção Mercado 1
        "main_buildlink_wood_6", // Construção Madeira 6
        "main_buildlink_stone_6", // Construção Argila 6
        "main_buildlink_wood_7", // Construção Madeira 7
        "main_buildlink_stone_7", // Construção Argila 7
        "main_buildlink_iron_4", // Construção Ferro 4
        "main_buildlink_iron_5", // Construção Ferro 5
        "main_buildlink_iron_6", // Construção Ferro 6
        "main_buildlink_wood_8", // Construção Madeira 8
        "main_buildlink_stone_8", // Construção Argila 8
        "main_buildlink_iron_7", // Construção Ferro 7
        "main_buildlink_wood_9", // Construção Madeira 9
        "main_buildlink_stone_9", // Construção Argila 9
        "main_buildlink_wood_10", // Construção Madeira 10
        "main_buildlink_stone_10", // Construção Argila 10
        "main_buildlink_farm_3", // Construção Fazenda 3
        "main_buildlink_farm_4", // Construção Fazenda 4
        "main_buildlink_farm_5", // Construção Fazenda 5
        "main_buildlink_farm_6", // Construção Fazenda 6

        //---------------- https://image.prntscr.com/image/oMwaEPpCR2_1XaHzlMaobg.png -  -----------------//
        "main_buildlink_wood_11", // Construção Madeira 11
        "main_buildlink_stone_11", // Construção Argila 11
        "main_buildlink_wood_12", // Construção Madeira 12
        "main_buildlink_stone_12", // Construção Argila 12
        "main_buildlink_storage_7", // Construção Armazém 7
        "main_buildlink_storage_8", // Construção Armazém 8
        "main_buildlink_iron_8", // Construção Ferro 8
        "main_buildlink_storage_9", // Construção Armazém 9
        "main_buildlink_storage_10", // Construção Armazém 10
        "main_buildlink_iron_9", // Construção Ferro 9
        "main_buildlink_iron_10", // Construção Ferro 10
        "main_buildlink_farm_7", // Construção Fazenda 7
        "main_buildlink_farm_8", // Construção Fazenda 8
        "main_buildlink_farm_9", // Construção Fazenda 9
        "main_buildlink_farm_10", // Construção Fazenda 10

        //---------------- https://image.prntscr.com/image/n6tBlPGORAq9RmqSVccTKg.png -  -----------------//
        "main_buildlink_wood_13", // Construção Madeira 13
        "main_buildlink_stone_13", // Construção Argila 13
        "main_buildlink_iron_11", // Construção Ferro 11
        "main_buildlink_iron_12", // Construção Ferro 12
        "main_buildlink_main_6", // Construção Edificio Principal 6
        "main_buildlink_main_7", // Construção Edificio Principal 7
        "main_buildlink_main_8", // Construção Edificio Principal 8
        "main_buildlink_main_9", // Construção Edificio Principal 9
        "main_buildlink_main_10", // Construção Edificio Principal 10

        //---------------- https://image.prntscr.com/image/3pioalUXRK6AH9wNYnRxyQ.png -  -----------------//
        "main_buildlink_wood_14", // Construção Madeira 14
        "main_buildlink_stone_14", // Construção Argila 14
        "main_buildlink_wood_15", // Construção Madeira 15
        "main_buildlink_stone_15", // Construção Argila 15
        "main_buildlink_wood_16", // Construção Madeira 16
        "main_buildlink_stone_16", // Construção Argila 16
        "main_buildlink_storage_11", // Construção Armazém 11
        "main_buildlink_wood_17", // Construção Madeira 17
        "main_buildlink_stone_17", // Construção Argila 17
        "main_buildlink_iron_13", // Construção Ferro 13
        "main_buildlink_iron_14", // Construção Ferro 14
        "main_buildlink_wood_18", // Construção Madeira 18
        "main_buildlink_storage_12", // Construção Armazém 12
        "main_buildlink_stone_18", // Construção Argila 18
        "main_buildlink_wood_19", // Construção Madeira 19
        "main_buildlink_stone_19", // Construção Argila 19
        "main_buildlink_iron_15", // Construção Ferro 15
        "main_buildlink_iron_16", // Construção Ferro 16
        "main_buildlink_storage_13", // Construção Armazém 13
        "main_buildlink_wood_20", // Construção Madeira 20
        "main_buildlink_stone_20", // Construção Argila 20
        "main_buildlink_iron_17", // Construção Ferro 17
        "main_buildlink_wood_21", // Construção Madeira 21
        "main_buildlink_iron_18", // Construção Ferro 18
        "main_buildlink_storage_14", // Construção Armazém 14
        "main_buildlink_storage_15", // Construção Armazém 15
        "main_buildlink_storage_16", // Construção Armazém 16
        "main_buildlink_storage_17", // Construção Armazém 17
        "main_buildlink_storage_18", // Construção Armazém 18
        "main_buildlink_storage_19", // Construção Armazém 19
        "main_buildlink_storage_20", // Construção Armazém 20
        "main_buildlink_storage_21", // Construção Armazém 21
        "main_buildlink_wood_21", // Construção Madeira 21
        "main_buildlink_stone_21", // Construção Argila 21
        "main_buildlink_wood_22", // Construção Madeira 22
        "main_buildlink_stone_22", // Construção Argila 22
        "main_buildlink_wood_23", // Construção Madeira 23
        "main_buildlink_stone_23", // Construção Argila 23
        "main_buildlink_iron_19", // Construção Ferro 19
        "main_buildlink_iron_20", // Construção Ferro 20
        "main_buildlink_farm_11", // Construção Fazenda 11
        "main_buildlink_farm_12", // Construção Fazenda 12
        "main_buildlink_farm_13", // Construção Fazenda 13
        "main_buildlink_farm_14", // Construção Fazenda 14
        "main_buildlink_farm_15", // Construção Fazenda 15
        "main_buildlink_main_11", // Construção Edificio Principal 11
        "main_buildlink_main_12", // Construção Edificio Principal 12
        "main_buildlink_main_13", // Construção Edificio Principal 13
        "main_buildlink_main_14", // Construção Edificio Principal 14
        "main_buildlink_main_15", // Construção Edificio Principal 15
        "main_buildlink_main_16", // Construção Edificio Principal 16
        "main_buildlink_main_17", // Construção Edificio Principal 17
        "main_buildlink_main_18", // Construção Edificio Principal 18
        "main_buildlink_main_19", // Construção Edificio Principal 19
        "main_buildlink_main_20", // Construção Edificio Principal 20
        "main_buildlink_iron_21", // Construção Ferro 21
        "main_buildlink_wood_24", // Construção Madeira 24
        "main_buildlink_stone_24", // Construção Argila 24
        "main_buildlink_iron_22", // Construção Ferro 22
        "main_buildlink_wood_25", // Construção Madeira 25
        "main_buildlink_stone_25", // Construção Argila 25
        "main_buildlink_storage_22", // Construção Armazém 22
        "main_buildlink_storage_23", // Construção Armazém 23
        "main_buildlink_storage_24", // Construção Armazém 24
        "main_buildlink_storage_25", // Construção Armazém 25
        "main_buildlink_storage_26", // Construção Armazém 26
        "main_buildlink_storage_27", // Construção Armazém 27
        "main_buildlink_iron_23", // Construção Ferro 23
        "main_buildlink_wood_26", // Construção Madeira 26
        "main_buildlink_stone_26", // Construção Argila 26
        "main_buildlink_iron_24", // Construção Ferro 24
        "main_buildlink_wood_27", // Construção Madeira 27
        "main_buildlink_stone_27", // Construção Argila 27
        "main_buildlink_iron_25", // Construção Ferro 25
        "main_buildlink_wood_28", // Construção Madeira 28
        "main_buildlink_stone_28", // Construção Argila 28
        "main_buildlink_iron_26", // Construção Ferro 26
        "main_buildlink_wood_29", // Construção Madeira 29
        "main_buildlink_stone_29", // Construção Argila 29
        "main_buildlink_iron_27", // Construção Ferro 27
        "main_buildlink_wood_30", // Construção Madeira 30
        "main_buildlink_stone_30", // Construção Argila 30
        "main_buildlink_iron_28", // Construção Ferro 28
        "main_buildlink_iron_29", // Construção Ferro 29
        "main_buildlink_iron_30", // Construção Ferro 30
        "main_buildlink_storage_28", // Construção Armazém 28
        "main_buildlink_storage_29", // Construção Armazém 29
        "main_buildlink_storage_30" // Construção Armazém 30
    ];

    return Sequência_Construção;
}
