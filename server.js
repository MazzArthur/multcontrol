const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto'); // Adicionado para gerar chaves seguras
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
// Esta função agora injeta USERSCRIPT_API_KEY e FIREBASE_CLIENT_CONFIG
function readScriptFileAsBase64(fileName, userscriptApiKeyToInject) { // userscriptApiKeyToInject é a chave que será injetada
    try {
        const filePath = path.resolve(__dirname, 'userscripts_content', fileName);
        let fileContent = fs.readFileSync(filePath, 'utf8');

        // --- INJEÇÃO DA FIREBASE_CLIENT_CONFIG ---
        const configPlaceholderRegex = /(const\s+FIREBASE_CLIENT_CONFIG\s*=\s*){};/;
        let configInjected = false;
        const firebaseClientConfig = getFirebaseClientConfig(); 

        if (configPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(
                configPlaceholderRegex,
                `$1${JSON.stringify(firebaseClientConfig)};`
            );
            configInjected = true;
        } else {
            const configLine = `// --- CAMPO PARA FIREBASE CLIENT CONFIG (Gerado pelo Dashboard MULTCONTROL) ---\n// Será preenchido dinamicamente pelo servidor\nconst FIREBASE_CLIENT_CONFIG = ${JSON.stringify(firebaseClientConfig)};\n// --- FIM DO CAMPO PARA FIREBASE CLIENT CONFIG ---\n\n`;
            fileContent = configLine + fileContent;
            configInjected = true;
            console.warn(`[SERVER] Placeholder FIREBASE_CLIENT_CONFIG NÃO ENCONTRADO em ${fileName}. Adicionado no início do arquivo.`);
        }
        console.log(`[SERVER] Injeção de config Firebase em ${fileName}: ${configInjected ? 'SUCESSO' : 'FALHA'}.`);


        // --- INJEÇÃO DA USERSCRIPT_API_KEY ---
        const userscriptKeyPlaceholderRegex = /(const\s+USERSCRIPT_API_KEY\s*=\s*)"";/; // Procura por 'const USERSCRIPT_API_KEY = "";'
        let userscriptKeyInjected = false;

        if (userscriptKeyPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(
                userscriptKeyPlaceholderRegex,
                `$1"${userscriptApiKeyToInject || 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD'}";` // Injete a Userscript API Key
            );
            userscriptKeyInjected = true;
        } else {
            const userscriptKeyLine = `// --- CAMPO PARA USERSCRIPT API KEY (Gerada no Dashboard MULTCONTROL) ---\nconst USERSCRIPT_API_KEY = "${userscriptApiKeyToInject || 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD'}";\n// --- FIM DO CAMPO PARA USERSCRIPT API KEY ---\n\n`;
            fileContent = userscriptKeyLine + fileContent;
            userscriptKeyInjected = true;
            console.warn(`[SERVER] Placeholder USERSCRIPT_API_KEY NÃO ENCONTRADO em ${fileName}. Adicionado no início do arquivo.`);
        }
        console.log(`[SERVER] Injeção de Userscript API Key em ${fileName}: ${userscriptKeyInjected ? 'SUCESSO' : 'FALHA'}.`);


        // --- ZERAR O FIREBASE_AUTH_ID_TOKEN antigo (se existir) ---
        const oldIdTokenPlaceholderRegex = /(const\s+FIREBASE_AUTH_ID_TOKEN\s*=\s*)[^;]*;/;
        if (oldIdTokenPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(
                oldIdTokenPlaceholderRegex,
                `$1"";` // Zera o token antigo, não vamos mais usá-lo diretamente
            );
        }
        
        return Buffer.from(fileContent).toString('base64');

    } catch (error) {
        console.error(`[SERVER ERROR] Falha ao ler, injetar config/key ou codificar o script ${fileName} para Base64:`, error);
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
    
    let userscriptKey = 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD'; // Default para caso não consiga gerar
    const idToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;

    if (idToken) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const uid = decodedToken.uid;

            // Obtém ou gera a Userscript API Key para o usuário
            const keyDoc = await db.collection('userscriptKeys').doc(uid).get();
            if (keyDoc.exists) {
                userscriptKey = keyDoc.data().userscriptKey;
                console.log(`[SERVER] Userscript API Key existente para UID: ${uid} carregada.`);
            } else {
                userscriptKey = crypto.randomBytes(32).toString('hex'); // Gera uma nova chave
                await db.collection('userscriptKeys').doc(uid).set({
                    uid: uid,
                    userscriptKey: userscriptKey,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`[SERVER] Nova Userscript API Key gerada e salva para UID: ${uid}.`);
            }
        } catch (error) {
            console.error('[SERVER ERROR] Erro ao obter/gerar Userscript API Key para dashboard:', error);
            // Continua, mas com chave padrão
        }
    } else {
        console.warn('[SERVER] Nenhum ID Token na rota /dashboard.html. Não é possível gerar Userscript API Key.');
    }


    const captchaScriptBase64 = readScriptFileAsBase64('captcha_script_content.js', userscriptKey); 
    const upadorScriptBase64 = readScriptFileAsBase64('upador_script_content.js', userscriptKey);
    const ataquesScriptBase64 = readScriptFileAsBase64('ataques_script_content.js', userscriptKey);

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
    const authToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null; // Este será o Custom Token

    if (!message || !authToken) { // Mudei de idToken para authToken para clarificar
        return res.status(400).send('Mensagem de alerta ou Token de autenticação (Custom Token) ausente.');
    }

    try {
        // Verifica o Custom Token
        const decodedToken = await admin.auth().verifyIdToken(authToken); // Firebase Admin SDK pode verificar Custom Tokens
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
        console.error('[SERVER ERROR] Erro ao verificar Token (Custom Token) ou salvar alerta:', error);
        res.status(401).send('Não autorizado ou erro ao processar alerta. Token inválido/expirado.');
    }
});


// REMOVEMOS A ROTA app.get('/alerts') pois o frontend buscará diretamente do Firestore agora.

// NOVA ROTA: Para o userscript obter um Custom Token fresco usando a Userscript API Key
app.post('/api/get_fresh_id_token', async (req, res) => {
    const userscriptApiKey = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null; // Userscript API Key no header

    if (!userscriptApiKey) {
        return res.status(401).json({ error: 'Userscript API Key ausente.' });
    }

    try {
        // Busca a Userscript API Key no Firestore para obter o UID
        const querySnapshot = await db.collection('userscriptKeys').where('userscriptKey', '==', userscriptApiKey).limit(1).get();

        if (querySnapshot.empty) {
            console.warn('[SERVER] Tentativa de obter token com Userscript API Key inválida.');
            return res.status(401).json({ error: 'Userscript API Key inválida.' });
        }

        const uid = querySnapshot.docs[0].data().uid;

        // Cria um Custom Token para este UID
        const customToken = await admin.auth().createCustomToken(uid);

        console.log(`[SERVER] Custom Token fresco gerado com sucesso para UID: ${uid}`);
        res.json({ customToken: customToken });

    } catch (error) {
        console.error('[SERVER ERROR] Erro ao obter Custom Token com Userscript API Key:', error);
        res.status(401).json({ error: 'Não autorizado ou erro ao gerar Custom Token.' });
    }
});


// Servidor Express escutando na porta
app.listen(PORT, () => {
    // Estas mensagens de log são para o seu console do Render, mostrando onde o servidor está rodando.
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Página de login disponível em https://multcontrol.onrender.com/`);
    console.log(`Endpoint de alerta (POST): https://multcontrol.onrender.com/alert`);
    console.log(`Endpoint para obter scripts com token (GET): https://multcontrol.onrender.com/get_userscripts_with_token`);
    console.log(`Endpoint para obter Custom Token (POST): https://multcontrol.onrender.com/api/get_fresh_id_token`);
});