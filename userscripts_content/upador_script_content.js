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
// @grant        GM_setValue
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @require      http://code.jquery.com/jquery-1.12.4.min.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js
// @connect      multcontrol.onrender.com
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
// Será preenchido dinamicamente pelo servidor
const FIREBASE_CLIENT_CONFIG = {};
// --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG --

// --- CAMPO PARA USERSCRIPT API KEY (Gerada no Dashboard MULTCONTROL) ---
// Será preenchido dinamicamente pelo servidor
const USERSCRIPT_API_KEY = "";
// --- FIM DO CAMPO PARA USERSCRIPT API KEY --

// --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
const FIREBASE_AUTH_ID_TOKEN = ""; // Este valor será ignorado. O script obterá o token dinamicamente.
// --- FIM DO CAMPO PARA ID TOKEN ---

// Constantes (NAO DEVE SER ALTERADAS)
const Visualizacao_Geral = "OVERVIEW_VIEW";
const Edificio_Principal = "HEADQUARTERS_VIEW";


// --- FUNCOES GLOBAIS (FORA DA IIFE) PARA ACESSO POR OUTRAS FUNCOES GLOBAIS ---

// Inicializa Firebase Client SDK no script (fora das funcoes para ser global)
var authClient; // Declarado aqui para ser acessivel globalmente no script
try {
    if (typeof firebase !== 'undefined' && FIREBASE_CLIENT_CONFIG && Object.keys(FIREBASE_CLIENT_CONFIG).length > 0) {
        firebase.initializeApp(FIREBASE_CLIENT_CONFIG);
        authClient = firebase.auth();
        console.log('[TW Script] Firebase Client SDK inicializado com config injetada.');
    } else {
        console.warn('[TW Script] Firebase Client SDK nao inicializado no script. FIREBASE_CLIENT_CONFIG ausente ou invalida. O token dinamico nao funcionara.');
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

// sendBuildingAlert agora gerencia a obtencao do token e o envio
async function sendBuildingAlert(buildingId) {
    return new Promise(async (resolve, reject) => {
        if (!ALERTA_CONSTRUCAO_ATIVADO) {
            console.log('[TW Script] Alerta de construcao desativado nas configuracoes.');
            return resolve();
        }

        let idTokenForAlert; // Este sera o ID Token FRESCO final para a requisicao
        const CACHED_ID_TOKEN_KEY = 'cachedFirebaseIdToken';
        const CACHED_TOKEN_EXPIRY_KEY = 'cachedFirebaseIdTokenExpiry';
        const now = Date.now();

        // Tentar usar token do cache GM_setValue
        const cachedToken = GM_getValue(CACHED_ID_TOKEN_KEY);
        const cachedExpiry = GM_getValue(CACHED_TOKEN_EXPIRY_KEY);

        if (cachedToken && cachedExpiry && now < cachedExpiry - (5 * 60 * 1000)) { // Expira 5min antes
            idTokenForAlert = cachedToken;
            console.log('[TW Script] Usando ID Token do cache.');
        } else {
            console.log('[TW Script] ID Token expirado ou nao encontrado no cache. Obtendo novo...');
            try {
                if (!USERSCRIPT_API_KEY || USERSCRIPT_API_KEY === "") {
                    console.error('[TW Script ERROR] USERSCRIPT_API_KEY nao configurada! Cole a chave gerada no dashboard no script.');
                    return reject(new Error("Userscript API Key ausente."));
                }

                // 1. Pede um Custom Token fresco do seu servidor Render usando a Userscript API Key
                const tokenResponse = await new Promise((res, rej) => {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: "https://multcontrol.onrender.com/api/get_fresh_id_token", // NOVA ROTA NO SEU SERVER
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${USERSCRIPT_API_KEY}` // Usa a Userscript API Key aqui
                        },
                        // Opcional: pode enviar o UID aqui se o server exigir, mas o server ja obterá do token injetado no processo de key generation
                        // data: JSON.stringify({ uid: 'seu_uid_aqui_se_necessario' }),
                        onload: function(response) { res(response); },
                        onerror: function(error) { rej(error); }
                    });
                });

                if (tokenResponse.status !== 200) {
                    throw new Error(`Falha ao obter Custom Token: Status ${tokenResponse.status}. Resposta: ${tokenResponse.responseText}`);
                }
                const customTokenData = JSON.parse(tokenResponse.responseText);
                const customToken = customTokenData.customToken;

                // 2. Fazer login no Firebase Client com o Custom Token
                if (typeof authClient === 'undefined' || !firebase) {
                    console.error('[TW Script ERROR] Firebase Client SDK ou authClient nao esta disponivel. Nao é possivel fazer login com Custom Token.');
                    return reject(new Error("Firebase Client SDK nao disponivel."));
                }
                await authClient.signInWithCustomToken(customToken);
                console.log('[TW Script] Login com Custom Token bem-sucedido no script.');

                // 3. Obter o ID Token final (curto prazo) e armazenar no cache
                const idTokenResult = await authClient.currentUser.getIdTokenResult(); // Obtém o objeto completo do token
                idTokenForAlert = idTokenResult.token; // O token JWT real
                const expirationTime = idTokenResult.expirationTime; // Tempo de expiracao em ms
                GM_setValue(CACHED_ID_TOKEN_KEY, idTokenForAlert);
                GM_setValue(CACHED_TOKEN_EXPIRY_KEY, expirationTime);
                console.log('[TW Script] ID Token fresco obtido e salvo no cache.');

            } catch (error) {
                console.error('[TW Script ERROR] Erro na autenticacao ou obtencao de Custom Token:', error);
                return reject(new Error("Falha na autenticacao do script."));
            }
        }

        // Verifica se este mesmo alerta foi enviado muito recentemente
        const currentTime = Date.now();
        if (lastBuildingAlertSent.id === buildingId && (currentTime - lastBuildingAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
            console.log(`[TW Script] Alerta para ${buildingId} ignorado: cooldown ativo.`);
            return resolve(); // Resolve se estiver em cooldown
        }

        const nickname = getNickname();
        const buildingName = getBuildingName(buildingId);
        const message = `ðŸ› ï¸ Construcao Iniciada: "${buildingName}" na conta "${nickname}"!`;

        console.log(`[TW Script] ENVIANDO ALERTA DE CONSTRUCAO: "${message}" para ${ALERT_SERVER_URL}`);

        if (typeof GM_xmlhttpRequest === 'undefined') {
            console.error('[TW Script ERROR] GM_xmlhttpRequest NAO esta definido. Verifique a permissao @grant no cabecalho do script!');
            return reject(new Error("GM_xmlhttpRequest nao definido."));
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: ALERT_SERVER_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idTokenForAlert}` // Adiciona o token de autenticacao FRESCO
            },
            data: JSON.stringify({ message: message }),
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    console.log("[TW Script] Alerta de construcao enviado com sucesso. Resposta do servidor:", response.responseText);
                    lastBuildingAlertSent = { id: buildingId, timestamp: currentTime };
                    resolve(response); // Resolve a Promise em sucesso
                } else {
                    console.error(`[TW Script] Erro ao enviar alerta de construcao. Status: ${response.status}. Resposta: ${response.responseText || 'N/A'}`);
                    reject(new Error(`Erro ao enviar alerta: Status ${response.status}`));
                }
            },
            onerror: function(error) {
                console.error("[TW Script] Erro de rede ao enviar alerta de construcao:", error);
                reject(error);
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

// Logica para "Completar Gratis"
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
async function Proxima_Construcao(){
    // Esta função agora busca o PRÓXIMO objetivo na sequência, mesmo que não haja recursos ainda.
    let Construcao_proximo_edificio_element = getConstrucao_proximo_edificio();

    if (Construcao_proximo_edificio_element !== null){
        // Verifica se o edifício é realmente clicável (tem recursos e não está em construção)
        let isClickable = !Construcao_proximo_edificio_element.classList.contains('btn-disabled');
        let isVisible = Construcao_proximo_edificio_element.offsetWidth > 0 || Construcao_proximo_edificio_element.offsetHeight > 0;

        if (isClickable && isVisible) {
            let delay = Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera);
            console.log(`[TW Script] Tentando construir ${getBuildingName(Construcao_proximo_edificio_element.id)} (ID: ${Construcao_proximo_edificio_element.id}) em ${delay}ms`);

            try {
                // Tenta enviar o alerta ANTES de clicar na construção
                await sendBuildingAlert(Construcao_proximo_edificio_element.id);
                console.log("[TW Script] Alerta de construcao enviado (aguardando confirmação). Prosseguindo com o clique.");
            } catch (error) {
                console.error("[TW Script] Falha no envio do alerta, mas continuando com o clique:", error.message);
                // Decide se quer parar ou continuar mesmo com erro no envio do alerta
            }

            // Atraso antes do clique real para simular comportamento humano
            setTimeout(function() {
                Construcao_proximo_edificio_element.click();
                console.log("[TW Script] Clicado em " + getBuildingName(Construcao_proximo_edificio_element.id));
            }, delay);
        } else {
            // Se o edifício não estiver clicável ou visível (falta de recursos, em construção, etc.),
            // loga a mensagem e o script simplesmente ESPERA a próxima iteração do setInterval
            // para tentar o MESMO edifício novamente.
            console.log(`[TW Script] Edificio ${getBuildingName(Construcao_proximo_edificio_element.id)} (ID: ${Construcao_proximo_edificio_element.id}) nao esta pronto para construcao (recursos insuficientes, ja em construcao, ou nao visivel). Esperando...`);
        }
    } else {
        console.log("[TW Script] Todos os edificios na sequencia atingiram o nivel alvo. Nenhuma construcao pendente.");
        // Opcional: Se desejar, pode adicionar um refresh aqui ou pausar o script
        // setTimeout(() => { location.reload(); }, 60000); // Exemplo: refresh após 1 minuto se tudo estiver construído
    }
}

// FUNÇÃO MODIFICADA PARA SEMPRE BUSCAR O PRIMEIRO OBJETIVO NA SEQUÊNCIA
function getConstrucao_proximo_edificio() {
    let Sequencia_Construcao = getConstrucao_Edifcios_Serie(); // Obtém a lista completa
    for (let i = 0; i < Sequencia_Construcao.length; i++) {
        var proximoId = Sequencia_Construcao[i];
        let proximo_edificio_element = document.getElementById(proximoId);

        if (proximo_edificio_element) {
            let currentLevelElement = proximo_edificio_element.querySelector('.build_options > span');
            let currentLevel = 0;
            if (currentLevelElement) {
                const match = currentLevelElement.textContent.match(/Nivel (\d+)/);
                if (match) {
                    currentLevel = parseInt(match[1]);
                }
            }

            const idParts = proximoId.split('_');
            const targetLevel = parseInt(idParts[idParts.length - 1]);

            // Se o nível atual do edifício é MENOR que o nível alvo especificado na Sequencia_Construcao,
            // então este é o próximo edifício que precisamos construir.
            // Retornamos ele, independentemente de estar clicável no momento (isso é verificado em Proxima_Construcao).
            if (currentLevel < targetLevel){
                return proximo_edificio_element; // Retorna o elemento DOM
            }
        }
    }
    return null; // Retorna null se todos os edifícios na sequência já atingiram o nível alvo.
}

function getConstrucao_Edifcios_Serie() {
    const Sequencia_Construcao = [
        "main_buildlink_wood_1", //Construcao Bosque Nv. 1
        "main_buildlink_stone_1", //Construcao Jazida de Argila Nv. 1
        "main_buildlink_iron_1", //Construcao Mina de Ferro Nv. 1
        "main_buildlink_wood_2", //Construcao Bosque Nv. 2
        "main_buildlink_stone_2", //Construcao Jazida de Argila Nv. 2
        "main_buildlink_main_2", //Construcao Edificio Principal Nv. 2
        "main_buildlink_main_3", //Construcao Edificio Principal Nv. 3
        "main_buildlink_barracks_1", //Construcao Quartel Nv. 1
        "main_buildlink_wood_3", //Construcao Bosque Nv. 3
        "main_buildlink_stone_3", //Construcao Jazida de Argila Nv. 3
        "main_buildlink_barracks_2", //Construcao Quartel Nv. 2
        "main_buildlink_market_1", //Construcao Mercado Nv. 1
        "main_buildlink_storage_2", //Construcao Armazem Nv. 2
        "main_buildlink_iron_2", //Construcao Mina de Ferro Nv. 2
        "main_buildlink_storage_3", //Construcao Armazem Nv. 3
        "main_buildlink_barracks_3", //Construcao Quartel Nv. 3
        "main_buildlink_statue_1", //Construcao Estatua Nv. 1
        "main_buildlink_farm_2", //Construcao Fazenda Nv. 2
        "main_buildlink_iron_3", //Construcao Mina de Ferro Nv. 3
        "main_buildlink_main_4", //Construcao Edificio Principal Nv. 4
        "main_buildlink_storage_4", //Construcao Armazem Nv. 4
        "main_buildlink_storage_5", //Construcao Armazem Nv. 5
        "main_buildlink_storage_6", //Construcao Armazem Nv. 6
        "main_buildlink_main_5", //Construcao Edificio Principal Nv. 5
        "main_buildlink_smith_1", //Construcao Ferreiro Nv. 1
        "main_buildlink_wood_4", //Construcao Bosque Nv. 4
        "main_buildlink_stone_4", //Construcao Jazida de Argila Nv. 4
        "main_buildlink_wall_1", //Construcao Muralha Nv. 1
        "main_buildlink_hide_2", //Construcao Esconderijo Nv. 2
        "main_buildlink_hide_3", //Construcao Esconderijo Nv. 3
        "main_buildlink_wood_5", //Construcao Bosque Nv. 5
        "main_buildlink_stone_5", //Construcao Jazida de Argila Nv. 5
        "main_buildlink_wood_6", //Construcao Bosque Nv. 6
        "main_buildlink_stone_6", //Construcao Jazida de Argila Nv. 6
        "main_buildlink_wood_7", //Construcao Bosque Nv. 7
        "main_buildlink_stone_7", //Construcao Jazida de Argila Nv. 7
        "main_buildlink_iron_4", //Construcao Mina de Ferro Nv. 4
        "main_buildlink_iron_5", //Construcao Mina de Ferro Nv. 5
        "main_buildlink_iron_6", //Construcao Mina de Ferro Nv. 6
        "main_buildlink_wood_8", //Construcao Bosque Nv. 8
        "main_buildlink_stone_8", //Construcao Jazida de Argila Nv. 8
        "main_buildlink_iron_7", //Construcao Mina de Ferro Nv. 7
        "main_buildlink_wood_9", //Construcao Bosque Nv. 9
        "main_buildlink_stone_9", //Construcao Jazida de Argila Nv. 9
        "main_buildlink_wood_10", //Construcao Bosque Nv. 10
        "main_buildlink_stone_10", //Construcao Jazida de Argila Nv. 10
        "main_buildlink_farm_3", //Construcao Fazenda Nv. 3
        "main_buildlink_farm_4", //Construcao Fazenda Nv. 4
        "main_buildlink_farm_5", //Construcao Fazenda Nv. 5
        "main_buildlink_farm_6", //Construcao Fazenda Nv. 6
        "main_buildlink_wood_11", //Construcao Bosque Nv. 11
        "main_buildlink_stone_11", //Construcao Jazida de Argila Nv. 11
        "main_buildlink_wood_12", //Construcao Bosque Nv. 12
        "main_buildlink_stone_12", //Construcao Jazida de Argila Nv. 12
        "main_buildlink_storage_7", //Construcao Armazem Nv. 7
        "main_buildlink_storage_8", //Construcao Armazem Nv. 8
        "main_buildlink_iron_8", //Construcao Mina de Ferro Nv. 8
        "main_buildlink_storage_9", //Construcao Armazem Nv. 9
        "main_buildlink_storage_10", //Construcao Armazem Nv. 10
        "main_buildlink_iron_9", //Construcao Mina de Ferro Nv. 9
        "main_buildlink_iron_10", //Construcao Mina de Ferro Nv. 10
        "main_buildlink_farm_7", //Construcao Fazenda Nv. 7
        "main_buildlink_farm_8", //Construcao Fazenda Nv. 8
        "main_buildlink_farm_9", //Construcao Fazenda Nv. 9
        "main_buildlink_farm_10", //Construcao Fazenda Nv. 10
        "main_buildlink_wood_13", //Construcao Bosque Nv. 13
        "main_buildlink_stone_13", //Construcao Jazida de Argila Nv. 13
        "main_buildlink_iron_11", //Construcao Mina de Ferro Nv. 11
        "main_buildlink_iron_12", //Construcao Mina de Ferro Nv. 12
        "main_buildlink_main_6", //Construcao Edificio Principal Nv. 6
        "main_buildlink_main_7", //Construcao Edificio Principal Nv. 7
        "main_buildlink_main_8", //Construcao Edificio Principal Nv. 8
        "main_buildlink_main_9", //Construcao Edificio Principal Nv. 9
        "main_buildlink_main_10", //Construcao Edificio Principal Nv. 10
        "main_buildlink_wood_14", //Construcao Bosque Nv. 14
        "main_buildlink_stone_14", //Construcao Jazida de Argila Nv. 14
        "main_buildlink_wood_15", //Construcao Bosque Nv. 15
        "main_buildlink_stone_15", //Construcao Jazida de Argila Nv. 15
        "main_buildlink_wood_16", //Construcao Bosque Nv. 16
        "main_buildlink_stone_16", //Construcao Jazida de Argila Nv. 16
        "main_buildlink_storage_11", //Construcao Armazem Nv. 11
        "main_buildlink_wood_17", //Construcao Bosque Nv. 17
        "main_buildlink_stone_17", //Construcao Jazida de Argila Nv. 17
        "main_buildlink_iron_13", //Construcao Mina de Ferro Nv. 13
        "main_buildlink_iron_14", //Construcao Mina de Ferro Nv. 14
        "main_buildlink_wood_18", //Construcao Bosque Nv. 18
        "main_buildlink_storage_12", //Construcao Armazem Nv. 12
        "main_buildlink_stone_18", //Construcao Jazida de Argila Nv. 18
        "main_buildlink_wood_19", //Construcao Bosque Nv. 19
        "main_buildlink_stone_19", //Construcao Jazida de Argila Nv. 19
        "main_buildlink_iron_15", //Construcao Mina de Ferro Nv. 15
        "main_buildlink_iron_16", //Construcao Mina de Ferro Nv. 16
        "main_buildlink_storage_13", //Construcao Armazem Nv. 13
        "main_buildlink_wood_20", //Construcao Bosque Nv. 20
        "main_buildlink_stone_20", //Construcao Jazida de Argila Nv. 20
        "main_buildlink_iron_17", //Construcao Mina de Ferro Nv. 17
        "main_buildlink_wood_21", //Construcao Bosque Nv. 21
        "main_buildlink_iron_18", //Construcao Mina de Ferro Nv. 18
        "main_buildlink_storage_14", //Construcao Armazem Nv. 14
        "main_buildlink_storage_15", //Construcao Armazem Nv. 15
        "main_buildlink_storage_16", //Construcao Armazem Nv. 16
        "main_buildlink_storage_17", //Construcao Armazem Nv. 17
        "main_buildlink_storage_18", //Construcao Armazem Nv. 18
        "main_buildlink_storage_19", //Construcao Armazem Nv. 19
        "main_buildlink_storage_20", //Construcao Armazem Nv. 20
        "main_buildlink_storage_21", //Construcao Armazem Nv. 21
        "main_buildlink_wood_21", //Construcao Bosque Nv. 21
        "main_buildlink_stone_21", //Construcao Jazida de Argila Nv. 21
        "main_buildlink_wood_22", //Construcao Bosque Nv. 22
        "main_buildlink_stone_22", //Construcao Jazida de Argila Nv. 22
        "main_buildlink_wood_23", //Construcao Bosque Nv. 23
        "main_buildlink_stone_23", //Construcao Jazida de Argila Nv. 23
        "main_buildlink_iron_19", //Construcao Mina de Ferro Nv. 19
        "main_buildlink_iron_20", //Construcao Mina de Ferro Nv. 20
        "main_buildlink_farm_11", //Construcao Fazenda Nv. 11
        "main_buildlink_farm_12", //Construcao Fazenda Nv. 12
        "main_buildlink_farm_13", //Construcao Fazenda Nv. 13
        "main_buildlink_farm_14", //Construcao Fazenda Nv. 14
        "main_buildlink_farm_15", //Construcao Fazenda Nv. 15
        "main_buildlink_main_11", //Construcao Edificio Principal Nv. 11
        "main_buildlink_main_12", //Construcao Edificio Principal Nv. 12
        "main_buildlink_main_13", //Construcao Edificio Principal Nv. 13
        "main_buildlink_main_14", //Construcao Edificio Principal Nv. 14
        "main_buildlink_main_15", //Construcao Edificio Principal Nv. 15
        "main_buildlink_main_16", //Construcao Edificio Principal Nv. 16
        "main_buildlink_main_17", //Construcao Edificio Principal Nv. 17
        "main_buildlink_main_18", //Construcao Edificio Principal Nv. 18
        "main_buildlink_main_19", //Construcao Edificio Principal Nv. 19
        "main_buildlink_main_20", //Construcao Edificio Principal Nv. 20
        "main_buildlink_iron_21", //Construcao Mina de Ferro Nv. 21
        "main_buildlink_wood_24", //Construcao Bosque Nv. 24
        "main_buildlink_stone_24", //Construcao Jazida de Argila Nv. 24
        "main_buildlink_iron_22", //Construcao Mina de Ferro Nv. 22
        "main_buildlink_wood_25", //Construcao Bosque Nv. 25
        "main_buildlink_stone_25", //Construcao Jazida de Argila Nv. 25
        "main_buildlink_storage_22", //Construcao Armazem Nv. 22
        "main_buildlink_storage_23", //Construcao Armazem Nv. 23
        "main_buildlink_storage_24", //Construcao Armazem Nv. 24
        "main_buildlink_storage_25", //Construcao Armazem Nv. 25
        "main_buildlink_storage_26", //Construcao Armazem Nv. 26
        "main_buildlink_storage_27", //Construcao Armazem Nv. 27
        "main_buildlink_iron_23", //Construcao Mina de Ferro Nv. 23
        "main_buildlink_wood_26", //Construcao Bosque Nv. 26
        "main_buildlink_stone_26", //Construcao Jazida de Argila Nv. 26
        "main_buildlink_iron_24", //Construcao Mina de Ferro Nv. 24
        "main_buildlink_wood_27", //Construcao Bosque Nv. 27
        "main_buildlink_stone_27", //Construcao Jazida de Argila Nv. 27
        "main_buildlink_iron_25", //Construcao Mina de Ferro Nv. 25
        "main_buildlink_wood_28", //Construcao Bosque Nv. 28
        "main_buildlink_stone_28", //Construcao Jazida de Argila Nv. 28
        "main_buildlink_iron_26", //Construcao Mina de Ferro Nv. 26
        "main_buildlink_wood_29", //Construcao Bosque Nv. 29
        "main_buildlink_stone_29", //Construcao Jazida de Argila Nv. 29
        "main_buildlink_iron_27", //Construcao Mina de Ferro Nv. 27
        "main_buildlink_wood_30", //Construcao Bosque Nv. 30
        "main_buildlink_stone_30", //Construcao Jazida de Argila Nv. 30
        "main_buildlink_iron_28", //Construcao Mina de Ferro Nv. 28
        "main_buildlink_iron_29", //Construcao Mina de Ferro Nv. 29
        "main_buildlink_iron_30", //Construcao Mina de Ferro Nv. 30
        "main_buildlink_storage_28", //Construcao Armazem Nv. 28
        "main_buildlink_storage_29", //Construcao Armazem Nv. 29
        "main_buildlink_storage_30", //Construcao Armazem Nv. 30
        "main_buildlink_market_2", //Construcao Mercado Nv. 2
        "main_buildlink_market_3", //Construcao Mercado Nv. 3
        "main_buildlink_market_4", //Construcao Mercado Nv. 4
        "main_buildlink_market_5", //Construcao Mercado Nv. 5
        "main_buildlink_market_6", //Construcao Mercado Nv. 6
        "main_buildlink_market_7", //Construcao Mercado Nv. 7
        "main_buildlink_market_8", //Construcao Mercado Nv. 8
        "main_buildlink_market_9", //Construcao Mercado Nv. 9
        "main_buildlink_market_10", //Construcao Mercado Nv. 10
        "main_buildlink_market_11", //Construcao Mercado Nv. 11
        "main_buildlink_market_12", //Construcao Mercado Nv. 12
        "main_buildlink_market_13", //Construcao Mercado Nv. 13
        "main_buildlink_market_14", //Construcao Mercado Nv. 14
        "main_buildlink_market_15", //Construcao Mercado Nv. 15
        "main_buildlink_market_16", //Construcao Mercado Nv. 16
        "main_buildlink_market_17", //Construcao Mercado Nv. 17
        "main_buildlink_market_18", //Construcao Mercado Nv. 18
        "main_buildlink_market_19", //Construcao Mercado Nv. 19
        "main_buildlink_market_20", //Construcao Mercado Nv. 20
        "main_buildlink_market_21", //Construcao Mercado Nv. 21
        "main_buildlink_market_22", //Construcao Mercado Nv. 22
        "main_buildlink_market_23", //Construcao Mercado Nv. 23
        "main_buildlink_market_24", //Construcao Mercado Nv. 24
        "main_buildlink_market_25", //Construcao Mercado Nv. 25
        "main_buildlink_barracks_4", //Q Nv. 4
        "main_buildlink_stable_1", //E Nv. 1
        "main_buildlink_smith_2", //F Nv. 2
        "main_buildlink_barracks_5", //Q Nv. 5
        "main_buildlink_stable_2", //E Nv. 2
        "main_buildlink_smith_3", //F Nv. 3
        "main_buildlink_barracks_6", //Q Nv. 6
        "main_buildlink_stable_3", //E Nv. 3
        "main_buildlink_smith_4", //F Nv. 4
        "main_buildlink_barracks_7", //Q Nv. 7
        "main_buildlink_stable_4", //E Nv. 4
        "main_buildlink_smith_5", //F Nv. 5
        "main_buildlink_barracks_8", //Q Nv. 8
        "main_buildlink_stable_5", //E Nv. 5
        "main_buildlink_smith_6", //F Nv. 6
        "main_buildlink_barracks_9", //Q Nv. 9
        "main_buildlink_stable_6", //E Nv. 6
        "main_buildlink_smith_7", //F Nv. 7
        "main_buildlink_barracks_10", //Q Nv. 10
        "main_buildlink_stable_7", //E Nv. 7
        "main_buildlink_smith_8", //F Nv. 8
        "main_buildlink_barracks_11", //Q Nv. 11
        "main_buildlink_stable_8", //E Nv. 8
        "main_buildlink_smith_9", //F Nv. 9
        "main_buildlink_barracks_12", //Q Nv. 12
        "main_buildlink_stable_9", //E Nv. 9
        "main_buildlink_smith_10", //F Nv. 10
        "main_buildlink_barracks_13", //Q Nv. 13
        "main_buildlink_stable_10", //E Nv. 10
        "main_buildlink_smith_11", //F Nv. 11
        "main_buildlink_barracks_14", //Q Nv. 14
        "main_buildlink_stable_11", //E Nv. 11
        "main_buildlink_smith_12", //F Nv. 12
        "main_buildlink_barracks_15", //Q Nv. 15
        "main_buildlink_stable_12", //E Nv. 12
        "main_buildlink_smith_13", //F Nv. 13
        "main_buildlink_barracks_16", //Q Nv. 16
        "main_buildlink_stable_13", //E Nv. 13
        "main_buildlink_smith_14", //F Nv. 14
        "main_buildlink_barracks_17", //Q Nv. 17
        "main_buildlink_stable_14", //E Nv. 14
        "main_buildlink_smith_15", //F Nv. 15
        "main_buildlink_barracks_18", //Q Nv. 18
        "main_buildlink_stable_15", //E Nv. 15
        "main_buildlink_smith_16", //F Nv. 16
        "main_buildlink_barracks_19", //Q Nv. 19
        "main_buildlink_stable_16", //E Nv. 16
        "main_buildlink_smith_17", //F Nv. 17
        "main_buildlink_barracks_20", //Q Nv. 20
        "main_buildlink_stable_17", //E Nv. 17
        "main_buildlink_smith_18", //F Nv. 18
        "main_buildlink_barracks_21", //Q Nv. 21
        "main_buildlink_stable_18", //E Nv. 18
        "main_buildlink_smith_19", //F Nv. 19
        "main_buildlink_barracks_22", //Q Nv. 22
        "main_buildlink_stable_19", //E Nv. 19
        "main_buildlink_smith_20", //F Nv. 20
        "main_buildlink_barracks_23", //Q Nv. 23
        "main_buildlink_stable_20", //E Nv. 20
        "main_buildlink_barracks_24", //Q Nv. 24
        "main_buildlink_barracks_25", //Q Nv. 25
        "main_buildlink_academy_1", //Construcao Academia Nv. 1
        "main_buildlink_academy_2", //Construcao Academia Nv. 2
        "main_buildlink_academy_3", //Construcao Academia Nv. 3
        "main_buildlink_place_1", //Construcao Ponto de Reunião Nv. 1
        "main_buildlink_garage_1", //Construcao Oficina Nv. 1
        "main_buildlink_garage_2", //Construcao Oficina Nv. 2
        "main_buildlink_garage_3", //Construcao Oficina Nv. 3
        "main_buildlink_garage_4", //Construcao Oficina Nv. 4
        "main_buildlink_garage_5", //Construcao Oficina Nv. 5
        "main_buildlink_garage_6", //Construcao Oficina Nv. 6
        "main_buildlink_garage_7", //Construcao Oficina Nv. 7
        "main_buildlink_garage_8", //Construcao Oficina Nv. 8
        "main_buildlink_garage_9", //Construcao Oficina Nv. 9
        "main_buildlink_garage_10", //Construcao Oficina Nv. 10
        "main_buildlink_garage_11", //Construcao Oficina Nv. 11
        "main_buildlink_garage_12", //Construcao Oficina Nv. 12
        "main_buildlink_garage_13", //Construcao Oficina Nv. 13
        "main_buildlink_garage_14", //Construcao Oficina Nv. 14
        "main_buildlink_garage_15", //Construcao Oficina Nv. 15
        "main_buildlink_snob_1", //Construcao Corte de Nobres Nv. 1
        "main_buildlink_snob_2", //Construcao Corte de Nobres Nv. 2
        "main_buildlink_snob_3", //Construcao Corte de Nobres Nv. 3
        "main_buildlink_wall_2", //Construcao Muralha Nv. 2
        "main_buildlink_wall_3", //Construcao Muralha Nv. 3
        "main_buildlink_wall_4", //Construcao Muralha Nv. 4
        "main_buildlink_wall_5", //Construcao Muralha Nv. 5
        "main_buildlink_wall_6", //Construcao Muralha Nv. 6
        "main_buildlink_wall_7", //Construcao Muralha Nv. 7
        "main_buildlink_wall_8", //Construcao Muralha Nv. 8
        "main_buildlink_wall_9", //Construcao Muralha Nv. 9
        "main_buildlink_wall_10", //Construcao Muralha Nv. 10
        "main_buildlink_wall_11", //Construcao Muralha Nv. 11
        "main_buildlink_wall_12", //Construcao Muralha Nv. 12
        "main_buildlink_wall_13", //Construcao Muralha Nv. 13
        "main_buildlink_wall_14", //Construcao Muralha Nv. 14
        "main_buildlink_wall_15", //Construcao Muralha Nv. 15
        "main_buildlink_wall_16", //Construcao Muralha Nv. 16
        "main_buildlink_wall_17", //Construcao Muralha Nv. 17
        "main_buildlink_wall_18", //Construcao Muralha Nv. 18
        "main_buildlink_wall_19", //Construcao Muralha Nv. 19
        "main_buildlink_wall_20", //Construcao Muralha Nv. 20
        "main_buildlink_watchtower_1", //Construcao Torre de Vigia Nv. 1
        "main_buildlink_watchtower_2", //Construcao Torre de Vigia Nv. 2
        "main_buildlink_watchtower_3", //Construcao Torre de Vigia Nv. 3
        "main_buildlink_watchtower_4", //Construcao Torre de Vigia Nv. 4
        "main_buildlink_watchtower_5", //Construcao Torre de Vigia Nv. 5
        "main_buildlink_watchtower_6", //Construcao Torre de Vigia Nv. 6
        "main_buildlink_watchtower_7", //Construcao Torre de Vigia Nv. 7
        "main_buildlink_watchtower_8", //Construcao Torre de Vigia Nv. 8
        "main_buildlink_watchtower_9", //Construcao Torre de Vigia Nv. 9
        "main_buildlink_watchtower_10", //Construcao Torre de Vigia Nv. 10
        "main_buildlink_watchtower_11", //Construcao Torre de Vigia Nv. 11
        "main_buildlink_watchtower_12", //Construcao Torre de Vigia Nv. 12
        "main_buildlink_watchtower_13", //Construcao Torre de Vigia Nv. 13
        "main_buildlink_watchtower_14", //Construcao Torre de Vigia Nv. 14
        "main_buildlink_watchtower_15", //Construcao Torre de Vigia Nv. 15
        "main_buildlink_watchtower_16", //Construcao Torre de Vigia Nv. 16
        "main_buildlink_watchtower_17", //Construcao Torre de Vigia Nv. 17
        "main_buildlink_watchtower_18", //Construcao Torre de Vigia Nv. 18
        "main_buildlink_watchtower_19", //Construcao Torre de Vigia Nv. 19
        "main_buildlink_watchtower_20", //Construcao Torre de Vigia Nv. 20
        "main_buildlink_hospital_1", //Construcao Hospital Nv. 1
        "main_buildlink_hospital_2", //Construcao Hospital Nv. 2
        "main_buildlink_hospital_3", //Construcao Hospital Nv. 3
        "main_buildlink_hospital_4", //Construcao Hospital Nv. 4
        "main_buildlink_hospital_5", //Construcao Hospital Nv. 5
        "main_buildlink_hospital_6", //Construcao Hospital Nv. 6
        "main_buildlink_hospital_7", //Construcao Hospital Nv. 7
        "main_buildlink_hospital_8", //Construcao Hospital Nv. 8
        "main_buildlink_hospital_9", //Construcao Hospital Nv. 9
        "main_buildlink_hospital_10", //Construcao Hospital Nv. 10
        "main_buildlink_hospital_11", //Construcao Hospital Nv. 11
        "main_buildlink_hospital_12", //Construcao Hospital Nv. 12
        "main_buildlink_hospital_13", //Construcao Hospital Nv. 13
        "main_buildlink_hospital_14", //Construcao Hospital Nv. 14
        "main_buildlink_hospital_15", //Construcao Hospital Nv. 15
        "main_buildlink_hospital_16", //Construcao Hospital Nv. 16
        "main_buildlink_hospital_17", //Construcao Hospital Nv. 17
        "main_buildlink_hospital_18", //Construcao Hospital Nv. 18
        "main_buildlink_hospital_19", //Construcao Hospital Nv. 19
        "main_buildlink_hospital_20", //Construcao Hospital Nv. 20
        "main_buildlink_hospital_21", //Construcao Hospital Nv. 21
        "main_buildlink_hospital_22", //Construcao Hospital Nv. 22
        "main_buildlink_hospital_23", //Construcao Hospital Nv. 23
        "main_buildlink_hospital_24", //Construcao Hospital Nv. 24
        "main_buildlink_hospital_25", //Construcao Hospital Nv. 25
        "main_buildlink_hospital_26", //Construcao Hospital Nv. 26
        "main_buildlink_hospital_27", //Construcao Hospital Nv. 27
        "main_buildlink_hospital_28", //Construcao Hospital Nv. 28
        "main_buildlink_hospital_29", //Construcao Hospital Nv. 29
        "main_buildlink_hospital_30", //Construcao Hospital Nv. 30
        "main_buildlink_church_1", //Construcao Igreja Nv. 1
        "main_buildlink_church_2", //Construcao Igreja Nv. 2
        "main_buildlink_church_3", //Construcao Igreja Nv. 3
        "main_buildlink_trade_1", //Construcao Posto de Trocas Nv. 1
        "main_buildlink_trade_2", //Construcao Posto de Trocas Nv. 2
        "main_buildlink_trade_3", //Construcao Posto de Trocas Nv. 3
        "main_buildlink_farm_16", //Construcao Fazenda Nv. 16
        "main_buildlink_farm_17", //Construcao Fazenda Nv. 17
        "main_buildlink_farm_18", //Construcao Fazenda Nv. 18
        "main_buildlink_farm_19", //Construcao Fazenda Nv. 19
        "main_buildlink_farm_20", //Construcao Fazenda Nv. 20
        "main_buildlink_farm_21", //Construcao Fazenda Nv. 21
        "main_buildlink_farm_22", //Construcao Fazenda Nv. 22
        "main_buildlink_farm_23", //Construcao Fazenda Nv. 23
        "main_buildlink_farm_24", //Construcao Fazenda Nv. 24
        "main_buildlink_farm_25", //Construcao Fazenda Nv. 25
        "main_buildlink_farm_26", //Construcao Fazenda Nv. 26
        "main_buildlink_farm_27", //Construcao Fazenda Nv. 27
        "main_buildlink_farm_28", //Construcao Fazenda Nv. 28
        "main_buildlink_farm_29", //Construcao Fazenda Nv. 29
        "main_buildlink_farm_30", //Construcao Fazenda Nv. 30
        "main_buildlink_main_21", //Construcao Edificio Principal Nv. 21
        "main_buildlink_main_22", //Construcao Edificio Principal Nv. 22
        "main_buildlink_main_23", //Construcao Edificio Principal Nv. 23
        "main_buildlink_main_24", //Construcao Edificio Principal Nv. 24
        "main_buildlink_main_25", //Construcao Edificio Principal Nv. 25
        "main_buildlink_main_26", //Construcao Edificio Principal Nv. 26
        "main_buildlink_main_27", //Construcao Edificio Principal Nv. 27
        "main_buildlink_main_28", //Construcao Edificio Principal Nv. 28
        "main_buildlink_main_29", //Construcao Edificio Principal Nv. 29
        "main_buildlink_main_30" //Construcao Edificio Principal Nv. 30
    ];

    return Sequencia_Construcao;
}
