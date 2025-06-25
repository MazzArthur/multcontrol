const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname)); // Define o diretório de views como o diretório atual

// Middlewares
app.use(cors());
app.use(express.json()); // Para parsear JSON no corpo das requisições

// Configuração do Firebase Admin SDK
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log('[SERVER] Firebase Admin SDK inicializado com sucesso.');
} catch (e) {
    console.error('[SERVER ERROR] Falha ao inicializar Firebase Admin SDK. Verifique FIREBASE_SERVICE_ACCOUNT_KEY no .env:', e);
    process.exit(1);
}

const db = admin.firestore(); // Firestore Admin SDK instance

// Função para obter a configuração do Firebase Client-side a partir das variáveis de ambiente
function getFirebaseClientConfig() {
    return {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        measurementId: process.env.FIREBASE_MEASUREMENT_ID
    };
}

// Função para ler o conteúdo de um arquivo de script e retornar como string Base64
// Esta função AGORA GARANTE que o placeholder exista e substitui o ID_TOKEN e a FIREBASE_CLIENT_CONFIG.
function readScriptFileAsBase64(fileName, idTokenToInject) {
    try {
        const filePath = path.resolve(__dirname, 'userscripts_content', fileName);
        let fileContent = fs.readFileSync(filePath, 'utf8');

        // --- CORREÇÃO AQUI: NOVO REGEX MAIS SEGURO PARA FIREBASE_CLIENT_CONFIG ---
        // Ele procura por 'const FIREBASE_CLIENT_CONFIG = {};'
        // e SUBSTITUI APENAS o '{};' com o JSON real.
        // Isso garante que comentários na mesma linha não sejam bagunçados.
        const configPlaceholderRegex = /(const\s+FIREBASE_CLIENT_CONFIG\s*=\s*){};/;
        let configInjected = false;
        const firebaseClientConfig = getFirebaseClientConfig(); // Obtenha a configuracao

        if (configPlaceholderRegex.test(fileContent)) {
            // Substitui o placeholder APENAS pelo JSON string
            fileContent = fileContent.replace(
                configPlaceholderRegex,
                `$1${JSON.stringify(firebaseClientConfig)};` // Substitui apenas o '{}'
            );
            configInjected = true;
        } else {
            // Fallback: Adiciona a linha se o placeholder nao for encontrado (comentario em linha separada)
            const configLine = `// --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---\n// Será preenchido dinamicamente pelo servidor\nconst FIREBASE_CLIENT_CONFIG = ${JSON.stringify(firebaseClientConfig)};\n// --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG ---\n\n`;
            fileContent = configLine + fileContent;
            configInjected = true;
            console.warn(`[SERVER] Placeholder FIREBASE_CLIENT_CONFIG NÃO ENCONTRADO em ${fileName}. Adicionado no início do arquivo.`);
        }
        console.log(`[SERVER] Injeção de config Firebase em ${fileName}: ${configInjected ? 'SUCESSO' : 'FALHA'}.`);
        // --- FIM DA CORREÇÃO ---


        // --- O código abaixo para FIREBASE_AUTH_ID_TOKEN permanece o mesmo ---
        const tokenPlaceholderRegex = /(const\s+FIREBASE_AUTH_ID_TOKEN\s*=\s*)[^;]*;(\s*\/\/\s*Será preenchido dinamicamente)?/;
        let tokenInjected = false;

        if (tokenPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(
                tokenPlaceholderRegex,
                `$1"${idTokenToInject || 'N/A'}";`
            );
            tokenInjected = true;
        } else {
            const tokenLine = `// --- CAMPO PARA ID TOKEN DO USUÁRIO (Gerado pelo Dashboard MULTCONTROL) ---\nconst FIREBASE_AUTH_ID_TOKEN = "${idTokenToInject || 'N/A'}"; // Será preenchido dinamicamente\n// --- FIM DO CAMPO PARA ID TOKEN ---\n\n`;
            fileContent = tokenLine + fileContent;
            tokenInjected = true;
            console.warn(`[SERVER] Placeholder FIREBASE_AUTH_ID_TOKEN NÃO ENCONTRADO em ${fileName}. Adicionado no início do arquivo.`);
        }
        console.log(`[SERVER] Injeção de token em ${fileName}: ${tokenInjected ? 'SUCESSO' : 'FALHA'}. Valor injetado: ${idTokenToInject ? 'REAL TOKEN' : 'N/A'}`);
        // ... (Restante do código: return Buffer.from(fileContent).toString('base64');) ...
        
        return Buffer.from(fileContent).toString('base64');
    } catch (error) {
        console.error(`[SERVER ERROR] Falha ao ler, injetar token ou codificar o arquivo de script ${fileName} para Base64:`, error);
        return Buffer.from(`// Erro: Não foi possível carregar o script ${fileName}. Verifique o console do servidor.`).toString('base64');
    }
}

// Rota para a página de login
app.get('/', (req, res) => {
    const firebaseConfig = getFirebaseClientConfig();
    res.render('index', { firebaseConfig: firebaseConfig });
});

// Rota para a página de dashboard
app.get('/dashboard.html', async (req, res) => {
    const firebaseConfig = getFirebaseClientConfig();
    
    // Passamos null como idToken para a leitura inicial, pois o token real só é obtido no cliente após o login.
    // O cliente fará uma nova chamada AJAX para /get_userscripts_with_token após autenticar.
    const captchaScriptBase64 = readScriptFileAsBase64('captcha_script_content.js', null); 
    const upadorScriptBase64 = readScriptFileAsBase64('upador_script_content.js', null);
    const ataquesScriptBase64 = readScriptFileAsBase64('ataques_script_content.js', null);

    res.render('dashboard', {
        firebaseConfig: firebaseConfig,
        captchaScriptBase64: captchaScriptBase64,
        upadorScriptBase64: upadorScriptBase64,
        ataquesScriptBase64: ataquesScriptBase64
    });
});

// Rota para receber e salvar alertas (POST) - MANTIDA
app.post('/alert', async (req, res) => {
    const { message } = req.body;
    const idToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;

    if (!message || !idToken) {
        return res.status(400).send('Mensagem de alerta ou ID Token ausente.');
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;
        const userEmail = decodedToken.email || 'N/A';

        const newAlert = {
            message: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            userEmail: userEmail
        };

        await db.collection('alerts').add(newAlert);
        console.log(`[SERVER] Novo alerta salvo para ${userEmail} (UID: ${userId}):`, newAlert);
        res.status(200).send('Alerta recebido e salvo com sucesso!');

    } catch (error) {
        console.error('[SERVER ERROR] Erro ao verificar ID Token ou salvar alerta:', error);
        res.status(401).send('Não autorizado ou erro ao processar alerta.');
    }
});

// REMOVEMOS A ROTA app.get('/alerts') pois o frontend buscará diretamente do Firestore agora.

// Rota para o dashboard obter os scripts com o token preenchido APÓS o login do cliente - MANTIDA
app.get('/get_userscripts_with_token', async (req, res) => {
    const idToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;

    if (!idToken) {
        return res.status(401).json({ error: 'Não autorizado. Token de autenticação ausente.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        // Se o token for válido, o userId pode ser usado para depuração, mas não é estritamente necessário para gerar o script.

        // Agora, lemos os scripts e INJETAMOS o token REAL.
        const captchaScriptBase64 = readScriptFileAsBase64('captcha_script_content.js', idToken);
        const upadorScriptBase64 = readScriptFileAsBase64('upador_script_content.js', idToken);
        const ataquesScriptBase64 = readScriptFileAsBase64('ataques_script_content.js', idToken);

        res.json({
            captchaScriptBase64: captchaScriptBase64,
            upadorScriptBase64: upadorScriptBase64,
            ataquesScriptBase64: ataquesScriptBase64
        });

    } catch (error) {
        console.error('[SERVER ERROR] Erro ao fornecer scripts com token:', error);
        res.status(401).json({ error: 'Não autorizado ou erro ao gerar scripts.' });
    }
});


// Servidor Express escutando na porta
app.listen(PORT, () => {
    // Estas mensagens de log são para o seu console do Render, mostrando onde o servidor está rodando.
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Página de login disponível em https://multcontrol.onrender.com/`);
    console.log(`Endpoint de alerta (POST): https://multcontrol.onrender.com/alert`);
    console.log(`Endpoint para obter scripts com token (GET): https://multcontrol.onrender.com/get_userscripts_with_token`);
});