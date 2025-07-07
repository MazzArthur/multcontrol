const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname));

// Middlewares
app.use(cors());
app.use(express.json());

// Configuração do Helmet para Content Security Policy (CSP)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "https://www.gstatic.com", 
                "https://apis.google.com", 
                "https://identitytoolkit.googleapis.com",
                "'unsafe-inline'"
            ], 
            connectSrc: [
                "'self'", 
                "https://multcontrol.onrender.com", 
                "https://securetoken.googleapis.com", 
                "https://firestore.googleapis.com", 
                "https://identitytoolkit.googleapis.com"
            ], 
            imgSrc: ["'self'", "data:", "https://i.imgur.com", "https://www.google.com", "https://dsbr.innogamescdn.com"],
            styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
}));

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

// --- FUNÇÕES AUXILIARES (sem alterações) ---
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

function readScriptFileAsBase64(fileName, userscriptApiKeyToInject) {
    try {
        const filePath = path.resolve(__dirname, 'userscripts_content', fileName);
        let fileContent = fs.readFileSync(filePath, 'utf8');
        const configPlaceholderRegex = /(const\s+FIREBASE_CLIENT_CONFIG\s*=\s*){};/;
        const firebaseClientConfig = getFirebaseClientConfig(); 
        if (configPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(
                configPlaceholderRegex,
                `$1${JSON.stringify(firebaseClientConfig)};`
            );
        } else {
            const configLine = `const FIREBASE_CLIENT_CONFIG = ${JSON.stringify(firebaseClientConfig)};\n`;
            fileContent = configLine + fileContent;
        }
        const userscriptKeyPlaceholderRegex = /(const\s+USERSCRIPT_API_KEY\s*=\s*)"";/;
        if (userscriptKeyPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(
                userscriptKeyPlaceholderRegex,
                `$1"${userscriptApiKeyToInject || 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD'}";`
            );
        } else {
            const userscriptKeyLine = `const USERSCRIPT_API_KEY = "${userscriptApiKeyToInject || 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD'}";\n`;
            fileContent = userscriptKeyLine + fileContent;
        }
        const oldIdTokenPlaceholderRegex = /(const\s+FIREBASE_AUTH_ID_TOKEN\s*=\s*)[^;]*;/;
        if (oldIdTokenPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(oldIdTokenPlaceholderRegex, `$1"";`);
        }
        return Buffer.from(fileContent).toString('base64');
    } catch (error) {
        console.error(`[SERVER ERROR] Falha ao processar o script ${fileName}:`, error);
        return Buffer.from(`// Erro: Não foi possível carregar o script ${fileName}.`).toString('base64');
    }
}

// --- ROTAS DE PÁGINAS ---

// Rota para a página de login
app.get('/', (req, res) => {
    const firebaseConfig = getFirebaseClientConfig();
    res.render('index', { firebaseConfig: firebaseConfig });
});

// Rota para a página de dashboard
app.get('/dashboard.html', async (req, res) => {
    const firebaseConfig = getFirebaseClientConfig();
    const captchaScriptBase64 = readScriptFileAsBase64('captcha_script_content.js', 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD'); 
    const upadorScriptBase64 = readScriptFileAsBase64('upador_script_content.js', 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD');
    const ataquesScriptBase64 = readScriptFileAsBase64('ataques_script_content.js', 'CHAVE_AUSENTE_FAZER_LOGIN_NO_DASHBOARD');
    res.render('dashboard', {
        firebaseConfig: firebaseConfig,
        captchaScriptBase64: captchaScriptBase64,
        upadorScriptBase64: upadorScriptBase64,
        ataquesScriptBase64: ataquesScriptBase64
    });
});

// Rota para a página de Personalização
app.get('/personalizar', (req, res) => {
    const firebaseConfig = getFirebaseClientConfig();
    res.render('personalizar', { firebaseConfig: firebaseConfig });
});

// Rota para o userscript obter um Custom Token fresco
app.post('/api/get_fresh_id_token', async (req, res) => {
    const userscriptApiKey = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;
    if (!userscriptApiKey) {
        return res.status(401).json({ error: 'Userscript API Key ausente.' });
    }
    try {
        const querySnapshot = await db.collection('userscriptKeys').where('userscriptKey', '==', userscriptApiKey).limit(1).get();
        if (querySnapshot.empty) {
            return res.status(401).json({ error: 'Userscript API Key inválida.' });
        }
        const uid = querySnapshot.docs[0].data().uid;
        const customToken = await admin.auth().createCustomToken(uid);
        res.json({ customToken: customToken });
    } catch (error) {
        console.error('[SERVER ERROR] Erro interno na rota /api/get_fresh_id_token:', error);
        res.status(500).json({ error: 'Erro interno ao gerar Custom Token.' });
    }
});
// *******************************************************************
// ** NOVA ROTA DE API PARA SERVIR O CONTEÚDO BRUTO DE UM SCRIPT **
// *******************************************************************
app.get('/api/get-raw-script/:scriptName', (req, res) => {
    const scriptName = req.params.scriptName;
    // Validação simples para segurança, permitindo apenas caracteres alfanuméricos e underscore
    if (!/^[a-zA-Z0-9_]+$/.test(scriptName)) {
        return res.status(400).send('Nome de script inválido.');
    }

    const filePath = path.join(__dirname, 'userscripts_content', `${scriptName}_content.js`);

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error(`[SERVER ERROR] Não foi possível ler o arquivo de script: ${filePath}`, err);
            return res.status(404).send('Arquivo de script não encontrado.');
        }
        // Define o tipo de conteúdo como texto puro para o navegador interpretar corretamente
        res.setHeader('Content-Type', 'text/plain');
        res.send(data);
    });
});


// --- ROTAS DE API EXISTENTES (sem alterações) ---

// Rota para receber e salvar alertas (POST)
app.post('/alert', async (req, res) => {
    const { message } = req.body;
    const authToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;
    if (!message || !authToken) {
        return res.status(400).send('Mensagem de alerta ou Token de autenticação (Custom Token) ausente.');
    }
    try {
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const newAlert = {
            message: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: decodedToken.uid,
            userEmail: decodedToken.email || 'N/A'
        };
        await db.collection('alerts').add(newAlert);
        res.status(200).send('Alerta recebido e salvo com sucesso!');
    } catch (error) {
        console.error('[SERVER ERROR] Erro ao verificar Token ou salvar alerta:', error);
        res.status(401).send('Não autorizado ou erro ao processar alerta.');
    }
});

// Rota para o dashboard obter os scripts com o token preenchido
app.get('/get_userscripts_with_token', async (req, res) => {
    const idToken = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;
    if (!idToken) {
        return res.status(401).json({ error: 'Não autorizado. Token de autenticação ausente.' });
    }
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;
        let userscriptKey;
        const keyDoc = await db.collection('userscriptKeys').doc(uid).get();
        if (keyDoc.exists) {
            userscriptKey = keyDoc.data().userscriptKey;
        } else {
            userscriptKey = crypto.randomBytes(32).toString('hex');
            await db.collection('userscriptKeys').doc(uid).set({
                uid: uid,
                userscriptKey: userscriptKey,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        const captchaScriptBase64 = readScriptFileAsBase64('captcha_script_content.js', userscriptKey); 
        const upadorScriptBase64 = readScriptFileAsBase64('upador_script_content.js', userscriptKey);
        const ataquesScriptBase64 = readScriptFileAsBase64('ataques_script_content.js', userscriptKey);
        res.json({
            captchaScriptBase64: captchaScriptBase64,
            upadorScriptBase64: upadorScriptBase64,
            ataquesScriptBase64: ataquesScriptBase64
        });
    } catch (error) {
        console.error('[SERVER ERROR] Erro interno na rota /get_userscripts_with_token:', error);
        res.status(500).json({ error: 'Erro interno ao gerar scripts.' });
    }
});

// Rota para o userscript obter um Custom Token fresco
app.post('/api/get_fresh_id_token', async (req, res) => {
    const userscriptApiKey = req.headers.authorization ? req.headers.authorization.split('Bearer ')[1] : null;
    if (!userscriptApiKey) {
        return res.status(401).json({ error: 'Userscript API Key ausente.' });
    }
    try {
        const querySnapshot = await db.collection('userscriptKeys').where('userscriptKey', '==', userscriptApiKey).limit(1).get();
        if (querySnapshot.empty) {
            return res.status(401).json({ error: 'Userscript API Key inválida.' });
        }
        const uid = querySnapshot.docs[0].data().uid;
        const customToken = await admin.auth().createCustomToken(uid);
        res.json({ customToken: customToken });
    } catch (error) {
        console.error('[SERVER ERROR] Erro interno na rota /api/get_fresh_id_token:', error);
        res.status(500).json({ error: 'Erro interno ao gerar Custom Token.' });
    }
});


// Servidor Express escutando na porta
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
