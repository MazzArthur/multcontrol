// ==UserScript==
// @name        Upador Automatico editado + Coleta Recompensa + Refresh Automatico + Alerta de Construcao
// @icon        https://i.imgur.com/7WgHTT8.gif
// @description Script construtor para game tribalwars, realiza upagem "Upar" dos edificios do game, script realiza a atividade em formato inicial resolvendo as Quest do game, e apos o termino das Quest o script realiza upagem de acordo com perfil pre definido pelo autor do script. Pode ser modificado a alteracao de como e feita a upagem, pelo proprio usuario. Tambem coleta recompensas de construcao e inclui refresh automatico da pagina e alerta de construcao.
// @author      MazzArthur
// @include     http*://*.*game.php*
// @version     0.1.1 // Versao corrigida para script invalido (caracteres invisíveis)
// @grant       GM_getResourceText
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       unsafeWindow
// @grant       GM_xmlhttpRequest
// @require     http://code.jquery.com/jquery-1.12.4.min.js
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

// --- CAMPO PARA ID TOKEN DO USUARIO (Gerado pelo Dashboard MULTCONTROL) ---
// POR FAVOR, SUBSTITUA "SEU_ID_TOKEN_AQUI" PELO SEU TOKEN REAL.
// SEM ISSO, A FUNCIONALIDADE DE ALERTA NAO VAI FUNCIONAR.
const FIREBASE_AUTH_ID_TOKEN = "SEU_ID_TOKEN_AQUI";
// --- FIM DO CAMPO PARA ID TOKEN ---

// Constantes do jogo
const Visualizacao_Geral = "OVERVIEW_VIEW";
const Edificio_Principal = "HEADQUARTERS_VIEW";
//*************************** /CONFIGURACAO ***************************//


// --- FUNCOES GLOBAIS (ACESSO DIRETO AS CONSTANTES DO ESCOPO GLOBAL) ---

// Nova funcao para remover acentos e cedilhas
function removerAcentosECedilhas(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ç/g, "c")
        .replace(/Ç/g, "C");
}

function getNickname() {
    const nicknameElement = document.querySelector("#menu_row > td:nth-child(11) > table > tbody > tr:nth-child(1) > td > a");
    if (!nicknameElement) {
        console.warn('[TW Script] Nickname element (#menu_row...) nao encontrado. Retornando "Desconhecido". Isso pode ocorrer se voce nao estiver na tela principal ou a estrutura HTML mudou.');
    }
    return nicknameElement ? removerAcentosECedilhas(nicknameElement.textContent.trim()) : "Desconhecido";
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
        "stable": "Estabulos",
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
    // Aplica a remocao de acentos e cedilhas ao nome do edificio
    const name = removerAcentosECedilhas(buildingNames[namePart] || namePart);
    return `${name} Nv. ${levelPart}`;
}

function sendBuildingAlert(buildingId) {
    if (!ALERTA_CONSTRUCAO_ATIVADO) {
        console.log('[TW Script] Alerta de construcao desativado nas configuracoes.');
        return;
    }

    // Verifica se o token foi preenchido
    if (!FIREBASE_AUTH_ID_TOKEN || FIREBASE_AUTH_ID_TOKEN === "SEU_ID_TOKEN_AQUI" || FIREBASE_AUTH_ID_TOKEN === "N/A") {
        console.error('[TW Script ERROR] ID Token Firebase nao configurado! Por favor, atualize a constante FIREBASE_AUTH_ID_TOKEN no script.');
        return;
    }

    // Verifica se este mesmo alerta foi enviado muito recentemente
    const currentTime = Date.now();
    if (lastBuildingAlertSent.id === buildingId && (currentTime - lastBuildingAlertSent.timestamp < ALERT_COOLDOWN_MS)) {
        console.log(`[TW Script] Alerta para ${buildingId} ignorado: cooldown ativo.`);
        return;
    }

    const nickname = getNickname();
    const buildingName = getBuildingName(buildingId); // getBuildingName ja remove acentos/cedilhas
    const message = `Construcao Iniciada: "${buildingName}" na conta "${nickname}"!`;

    console.log(`[TW Script] ENVIANDO ALERTA DE CONSTRUCAO: "${message}" para ${ALERT_SERVER_URL}`);

    if (typeof GM_xmlhttpRequest === 'undefined') {
        console.error('[TW Script ERROR] GM_xmlhttpRequest NAO esta definido. Verifique a permissao @grant no cabecalho do script!');
        return;
    }

    GM_xmlhttpRequest({
        method: "POST",
        url: ALERT_SERVER_URL,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${FIREBASE_AUTH_ID_TOKEN}` // Adiciona o token de autenticacao
        },
        data: JSON.stringify({ message: message }),
        onload: function(response) {
            if (response.status >= 200 && response.status < 300) {
                console.log("[TW Script] Alerta de construcao enviado com sucesso. Resposta do servidor:", response.responseText);
                // Atualiza o estado do ultimo alerta enviado apenas se for bem-sucedido
                lastBuildingAlertSent = { id: buildingId, timestamp: currentTime };
            } else {
                console.error(`[TW Script] Erro ao enviar alerta de construcao. Status: ${response.status}. Resposta: ${response.responseText || 'N/A'}`);
            }
        },
        onerror: function(error) {
            console.error("[TW Script] Erro de rede ao enviar alerta de construcao:", error);
        }
    });
}

function esperarQuestlines(callback) {
    const maxRetries = 20; // Tentar por 10 segundos (20 * 500ms)
    let retries = 0;
    const intervalo = setInterval(() => {
        if (typeof unsafeWindow.Questlines !== 'undefined' && unsafeWindow.Questlines) {
            clearInterval(intervalo);
            callback();
        } else if (retries >= maxRetries) {
            clearInterval(intervalo);
            console.warn('[TW Script] Variavel Questlines nao foi definida apos varias tentativas. Nao foi possivel abrir o popup de recompensas.');
        }
        retries++;
    }, 500);
}

function abrirRecompensas() {
    if (typeof unsafeWindow.Questlines === 'undefined' || !unsafeWindow.Questlines) {
        console.warn('[TW Script] Questlines nao esta definido. Nao foi possivel abrir o popup de recompensas.');
        return;
    }
    unsafeWindow.Questlines.showDialog(0, 'main-tab');
    console.log('[TW Script] Popup de recompensas aberto.');

    setTimeout(() => {
        unsafeWindow.Questlines.selectTabById('main-tab', 0);
        console.log('[TW Script] Aba "main-tab" selecionada.');

        setTimeout(() => {
            const abas = document.querySelectorAll("#popup_box_quest > div > div > div.quest-popup-header > div > ul > li > a");
            if (abas.length > 0) { // Verifica se ha pelo menos uma aba
                abas.forEach((aba, i) => {
                    if (!aba.classList.contains("active")) {
                        console.log(`[TW Script] Clicando na aba ${i + 1}.`);
                        aba.click();
                        // Pequeno atraso para a aba carregar, antes de tentar coletar
                        setTimeout(coletarRecompensas, 750);
                    } else {
                        console.log(`[TW Script] Aba ${i + 1} ja esta ativa. Tentando coletar recompensas nela.`);
                        coletarRecompensas();
                    }
                });
            } else {
                console.log('[TW Script] Nenhuma aba de recompensa encontrada. Tentando coletar recompensas diretamente.');
                coletarRecompensas();
            }
        }, 1500); // Atraso para as abas serem visiveis e clicaveis
    }, 1000); // Atraso para o popup abrir
}

function coletarRecompensas() {
    // Seleciona todos os botoes de "Coletar Recompensa" que NAO estao desabilitados
    const botoes = document.querySelectorAll('#reward-system-rewards > tr > td:nth-child(6) > a:not(.btn-disabled)');

    if (botoes.length === 0) {
        console.log('[TW Script] Nenhuma recompensa disponivel para coleta.');
        setTimeout(simularEsc, 1000); // Fecha o popup se nao houver recompensas
    } else {
        console.log(`[TW Script] Encontrados ${botoes.length} botoes de recompensa para coletar.`);
        let i = 0;
        const collectNext = () => {
            if (i < botoes.length) {
                const btn = botoes[i];
                if (btn && !btn.classList.contains('btn-disabled')) {
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


function getPaginaAtual(){ // Nome mais descritivo para a funcao
    let currentUrl = window.location.href;
    if (currentUrl.includes("screen=overview")){
        return Visualizacao_Geral;
    }
    else if (currentUrl.endsWith('main') || currentUrl.includes("screen=main")){
        return Edificio_Principal;
    }
    return null;
}

function gerenciarConstrucao() { // Nome da funcao alterado
    // Tenta finalizar construcao gratuita primeiro
    const freeFinishButton = document.querySelector('.free_finish_button');
    if (freeFinishButton && !freeFinishButton.classList.contains('btn-disabled')) {
        console.log('[TW Script] Botao de finalizacao gratuita encontrado! Clicando...');
        freeFinishButton.click();
        // Apos clicar, espera um pouco para o jogo processar e entao tenta coletar recompensas
        setTimeout(() => {
            console.log('[TW Script] Finalizacao gratuita clicada. Verificando recompensas...');
            // Chame abrirRecompensas aqui, pois eh comum ganhar recompensas ao finalizar construcoes.
            if (document.querySelector('.quest-icon.new-quests')) {
                esperarQuestlines(abrirRecompensas); // Garante que Questlines esteja disponivel
            }
        }, 1500); // Atraso para o jogo processar a finalizacao
        return; // Nao prossegue com a construcao normal se houver finalizacao gratuita
    }

    // Se nao houver finalizacao gratuita, tenta construir o proximo edificio
    let proximoEdificio = getProximoEdificioParaConstrucao(); // Nome da funcao alterado
    if (proximoEdificio) {
        let delay = Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera);
        console.log(`[TW Script] Tentando construir ${proximoEdificio.id} em ${delay}ms`);

        sendBuildingAlert(proximoEdificio.id); // Envia alerta antes do clique
        console.log("[TW Script] Alerta de construcao solicitado ANTES do clique para garantir registro.");

        setTimeout(function() {
            proximoEdificio.click();
            console.log("[TW Script] Clicado em " + proximoEdificio.id);
        }, delay);
    } else {
        console.log("[TW Script] Nenhum edificio disponivel para construcao no momento ou fila de construcao cheia.");
    }
}

function getProximoEdificioParaConstrucao() { // Nome da funcao alterado
    let sequenciaConstrucao = getSequenciaConstrucaoConfig(); // Nome da funcao alterado
    let edificioEncontrado = null;
    for (let i = 0; i < sequenciaConstrucao.length; i++) {
        let proximoId = sequenciaConstrucao[i];
        let elementoEdificio = document.getElementById(proximoId);

        if (elementoEdificio) {
            let isClickable = !elementoEdificio.classList.contains('btn-disabled');
            let isVisible = elementoEdificio.offsetWidth > 0 || elementoEdificio.offsetHeight > 0;
            let currentLevelElement = elementoEdificio.querySelector('.build_options > span');

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
                edificioEncontrado = elementoEdificio;
                if (Construcao_Edificios_Ordem){
                    break; // Se a ordem e importante, pega o primeiro disponivel e sai
                }
            }
        }
    }
    return edificioEncontrado;
}

function getSequenciaConstrucaoConfig() {
    // A ordem de construcao foi atualizada com base na sua prioridade, item por item.
    const Sequencia_Construcao = [
        "main_buildlink_main_1",
        "main_buildlink_wood_1",
        "main_buildlink_stone_1",
        "main_buildlink_iron_1",
        "main_buildlink_wood_2",
        "main_buildlink_stone_2",
        "main_buildlink_main_2",
        "main_buildlink_main_3",
        "main_buildlink_barracks_1",
        "main_buildlink_wood_3",
        "main_buildlink_stone_3",
        "main_buildlink_barracks_2",
        "main_buildlink_storage_2",
        "main_buildlink_iron_2",
        "main_buildlink_storage_3",
        "main_buildlink_barracks_3",
        "main_buildlink_statue_1",
        "main_buildlink_farm_2",
        "main_buildlink_iron_3",
        "main_buildlink_main_4",
        "main_buildlink_storage_4",
        "main_buildlink_storage_5",
        "main_buildlink_storage_6",
        "main_buildlink_main_5",
        "main_buildlink_smith_1",
        "main_buildlink_wood_4",
        "main_buildlink_stone_4",
        "main_buildlink_wall_1",
        "main_buildlink_hide_2",
        "main_buildlink_hide_3",
        "main_buildlink_wood_5",
        "main_buildlink_stone_5",
        "main_buildlink_market_1",
        "main_buildlink_wood_6",
        "main_buildlink_stone_6",
        "main_buildlink_wood_7",
        "main_buildlink_stone_7",
        "main_buildlink_iron_4",
        "main_buildlink_iron_5",
        "main_buildlink_iron_6",
        "main_buildlink_wood_8",
        "main_buildlink_stone_8",
        "main_buildlink_iron_7",
        "main_buildlink_wood_9",
        "main_buildlink_stone_9",
        "main_buildlink_wood_10",
        "main_buildlink_stone_10",
        "main_buildlink_farm_3",
        "main_buildlink_farm_4",
        "main_buildlink_farm_5",
        "main_buildlink_farm_6",
        "main_buildlink_wood_11",
        "main_buildlink_stone_11",
        "main_buildlink_wood_12",
        "main_buildlink_stone_12",
        "main_buildlink_storage_7",
        "main_buildlink_storage_8",
        "main_buildlink_iron_8",
        "main_buildlink_storage_9",
        "main_buildlink_storage_10",
        "main_buildlink_iron_9",
        "main_buildlink_iron_10",
        "main_buildlink_farm_7",
        "main_buildlink_farm_8",
        "main_buildlink_farm_9",
        "main_buildlink_farm_10",
        "main_buildlink_wood_13",
        "main_buildlink_stone_13",
        "main_buildlink_iron_11",
        "main_buildlink_iron_12",
        "main_buildlink_main_6",
        "main_buildlink_main_7",
        "main_buildlink_main_8",
        "main_buildlink_main_9",
        "main_buildlink_main_10",
        "main_buildlink_wood_14",
        "main_buildlink_stone_14",
        "main_buildlink_wood_15",
        "main_buildlink_stone_15",
        "main_buildlink_wood_16",
        "main_buildlink_stone_16",
        "main_buildlink_storage_11",
        "main_buildlink_wood_17",
        "main_buildlink_stone_17",
        "main_buildlink_iron_13",
        "main_buildlink_iron_14",
        "main_buildlink_wood_18",
        "main_buildlink_storage_12",
        "main_buildlink_stone_18",
        "main_buildlink_wood_19",
        "main_buildlink_stone_19",
        "main_buildlink_iron_15",
        "main_buildlink_iron_16",
        "main_buildlink_storage_13",
        "main_buildlink_wood_20",
        "main_buildlink_stone_20",
        "main_buildlink_iron_17",
        "main_buildlink_wood_21",
        "main_buildlink_iron_18",
        "main_buildlink_storage_14",
        "main_buildlink_storage_15",
        "main_buildlink_storage_16",
        "main_buildlink_storage_17",
        "main_buildlink_storage_18",
        "main_buildlink_storage_19",
        "main_buildlink_storage_20",
        "main_buildlink_storage_21",
        "main_buildlink_wood_21", // duplicado, manter se for intencional
        "main_buildlink_stone_21",
        "main_buildlink_wood_22",
        "main_buildlink_stone_22",
        "main_buildlink_wood_23",
        "main_buildlink_stone_23",
        "main_buildlink_iron_19",
        "main_buildlink_iron_20",
        "main_buildlink_farm_11",
        "main_buildlink_farm_12",
        "main_buildlink_farm_13",
        "main_buildlink_farm_14",
        "main_buildlink_farm_15",
        "main_buildlink_main_11",
        "main_buildlink_main_12",
        "main_buildlink_main_13",
        "main_buildlink_main_14",
        "main_buildlink_main_15",
        "main_buildlink_main_16",
        "main_buildlink_main_17",
        "main_buildlink_main_18",
        "main_buildlink_main_19",
        "main_buildlink_main_20",
        "main_buildlink_iron_21",
        "main_buildlink_wood_24",
        "main_buildlink_stone_24",
        "main_buildlink_iron_22",
        "main_buildlink_wood_25",
        "main_buildlink_stone_25",
        "main_buildlink_storage_22",
        "main_buildlink_storage_23",
        "main_buildlink_storage_24",
        "main_buildlink_storage_25",
        "main_buildlink_storage_26",
        "main_buildlink_storage_27",
        "main_buildlink_iron_23",
        "main_buildlink_wood_26",
        "main_buildlink_stone_26",
        "main_buildlink_iron_24",
        "main_buildlink_wood_27",
        "main_buildlink_stone_27",
        "main_buildlink_iron_25",
        "main_buildlink_wood_28",
        "main_buildlink_stone_28",
        "main_buildlink_iron_26",
        "main_buildlink_wood_29",
        "main_buildlink_stone_29",
        "main_buildlink_iron_27",
        "main_buildlink_wood_30",
        "main_buildlink_stone_30",
        "main_buildlink_iron_28",
        "main_buildlink_iron_29",
        "main_buildlink_iron_30",
        "main_buildlink_storage_28",
        "main_buildlink_storage_29",
        "main_buildlink_storage_30"
    ];

    return Sequencia_Construcao;
}


// --- INICIALIZADOR DO SCRIPT ---
// Essa funcao sera o "motor" que garantira que o script execute as acoes de forma continua.
function startScript() {
    console.log('[TW Script] Iniciando o script Upador Automatico + Coleta Recompensa + Refresh Automatico + Alerta de Construcao v0.1.1');
    console.log('[TW Script] Verifique o console (F12) para logs de atividade.');

    // Inicia a coleta de recompensas logo no inicio, caso haja alguma pendente
    esperarQuestlines(abrirRecompensas);

    // Loop principal de automacao (construcao, verificacao de finalizacao gratuita, coleta)
    // Este loop sera executado a cada Min_Tempo_Espera a Max_Tempo_Espera + 1000ms
    setInterval(() => {
        const randomDelay = Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera);
        console.log(`[TW Script] Novo ciclo de automacao em ${randomDelay}ms...`);

        const currentView = getPaginaAtual(); // Usando o nome corrigido da funcao

        if (currentView === Edificio_Principal) {
            gerenciarConstrucao(); // Nova funcao que tenta finalizar gratuito ou constroi
        } else if (currentView === Visualizacao_Geral) {
            console.log('[TW Script] Atualmente na visualizacao geral. Navegando para o Edificio Principal para construcao...');
            // Tenta clicar no link para o Edificio Principal
            const mainBuildingLink = document.getElementById("l_main"); // ID do link do edificio principal
            if (mainBuildingLink) {
                mainBuildingLink.click();
            } else {
                console.warn('[TW Script] Link para o Edificio Principal (l_main) nao encontrado. Nao foi possivel navegar.');
            }
        }

        // Verificacao e coleta de recompensas (periodicamente, nao no mesmo ritmo da construcao)
        // O ideal eh verificar se o icone de notificacao de recompensa esta visivel.
        if (document.querySelector('.quest-icon.new-quests')) { // Verifica se o icone de notificacao de novas quests esta visivel
            console.log('[TW Script] Notificacao de nova recompensa detectada. Tentando abrir recompensas...');
            abrirRecompensas();
        }

    }, Math.floor(Math.random() * (Max_Tempo_Espera - Min_Tempo_Espera) + Min_Tempo_Espera) + 1000); // Adiciona um atraso base ao intervalo do ciclo principal

    // Configuracao do Auto Refresh (executa em um intervalo separado)
    if (Auto_Refresh_Ativado) {
        const refreshIntervalMs = Intervalo_Refresh_Minutos * 60 * 1000;
        setInterval(() => {
            console.log(`[TW Script] Realizando refresh automatico da pagina apos ${Intervalo_Refresh_Minutos} minutos.`);
            location.reload();
        }, refreshIntervalMs);
    }
}

// Garante que o 'startScript' so seja chamado quando o DOM estiver completamente carregado.
// Isso evita erros de elementos nao encontrados.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startScript);
} else {
    startScript(); // Se o DOM ja estiver carregado (acontece em alguns casos), chama imediatamente
}
