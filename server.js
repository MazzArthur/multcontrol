const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');
const helmet = require('helmet');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIGURAÇÃO E MIDDLEWARES ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname));
app.use(cors());
app.use(express.json());
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [ "'self'", "https://www.gstatic.com", "https://apis.google.com", "https://identitytoolkit.googleapis.com", "'unsafe-inline'" ], 
            connectSrc: [ "'self'", "https://multcontrol.onrender.com", "https://*.googleapis.com", "https://firestore.googleapis.com" ], 
            imgSrc: ["'self'", "data:", "https://i.imgur.com", "https://www.google.com", "https://dsbr.innogamescdn.com"],
            styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
}));

// --- INICIALIZAÇÃO DO FIREBASE ADMIN ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
    console.log('[SERVER] Firebase Admin SDK inicializado com sucesso.');
} catch (e) {
    console.error('[SERVER ERROR] Falha ao inicializar Firebase Admin SDK:', e);
    process.exit(1);
}
const db = admin.firestore();

// --- FUNÇÕES AUXILIARES ---
function getFirebaseClientConfig() {
    return {
        apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID, storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID, appId: process.env.FIREBASE_APP_ID,
        measurementId: process.env.FIREBASE_MEASUREMENT_ID
    };
}
// --- MIDDLEWARE DE AUTENTICAÇÃO PARA APIs ---
const requireAuth = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1] || null;
    if (!idToken) return res.status(401).json({ error: 'Token de autenticação ausente.' });
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = { uid: decodedToken.uid, email: decodedToken.email };
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Falha na autenticação.' });
    }
};
function readScriptFileAsBase64(fileName, userscriptApiKeyToInject) {
    try {
        const filePath = path.resolve(__dirname, 'userscripts_content', fileName);
        let fileContent = fs.readFileSync(filePath, 'utf8');
        const configPlaceholderRegex = /(const\s+FIREBASE_CLIENT_CONFIG\s*=\s*){};/;
        const firebaseClientConfig = getFirebaseClientConfig(); 
        if (configPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(configPlaceholderRegex, `$1${JSON.stringify(firebaseClientConfig)};`);
        } else {
            fileContent = `const FIREBASE_CLIENT_CONFIG = ${JSON.stringify(firebaseClientConfig)};\n` + fileContent;
        }
        const userscriptKeyPlaceholderRegex = /(const\s+USERSCRIPT_API_KEY\s*=\s*)"";/;
        if (userscriptKeyPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(userscriptKeyPlaceholderRegex, `$1"${userscriptApiKeyToInject || 'CHAVE_AUSENTE'}";`);
        }
        const oldIdTokenPlaceholderRegex = /(const\s+FIREBASE_AUTH_ID_TOKEN\s*=\s*)[^;]*;/;
        if (oldIdTokenPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(oldIdTokenPlaceholderRegex, `$1"";`);
        }
        return Buffer.from(fileContent).toString('base64');
    } catch (error) {
        console.error(`[SERVER ERROR] Falha ao processar o script ${fileName}:`, error);
        return Buffer.from(`// Erro ao carregar script ${fileName}.`).toString('base64');
    }
}


// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => {
    res.render('index', { firebaseConfig: getFirebaseClientConfig() });
});
app.get('/dashboard.html', (req, res) => {
    res.render('dashboard', { firebaseConfig: getFirebaseClientConfig() });
});
app.get('/personalizar', (req, res) => {
    res.render('personalizar', { firebaseConfig: getFirebaseClientConfig() });
});

app.get('/admin-wpp', (req, res) => {
    // Esta rota agora não tem o 'requireAuth'. A verificação será feita na própria página.
    // Nós passamos o UID do admin para a página para que ela possa fazer a verificação.
    res.render('admin-whatsapp', { 
        firebaseConfig: getFirebaseClientConfig(),
        adminUid: process.env.ADMIN_UID 
    });
});


// ===========================================
// ** ROTAS DE API **
// ===========================================
// --- API DE CONFIGURAÇÕES DO USUÁRIO ---
app.get('/api/user/settings', requireAuth, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) {
            return res.status(200).json({}); // Retorna objeto vazio se não houver configurações
        }
        res.status(200).json(userDoc.data());
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configurações.' });
    }
});

app.post('/api/user/settings', requireAuth, async (req, res) => {
    const { whatsappNumber } = req.body;
    if (!whatsappNumber) {
        return res.status(400).json({ error: 'Número de WhatsApp é obrigatório.' });
    }
    try {
        // 'set' com 'merge: true' cria o documento se não existir ou atualiza o campo se existir
        await db.collection('users').doc(req.user.uid).set({
            whatsappNumber: whatsappNumber
        }, { merge: true });
        res.status(200).json({ message: 'Configurações salvas com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar configurações.' });
    }
});
// --- API DE GERENCIAMENTO DE ORDENS DE CONSTRUÇÃO ---
app.get('/api/build-orders', requireAuth, async (req, res) => {
    try {
        const snapshot = await db.collection('buildOrders').where('userId', '==', req.user.uid).orderBy('createdAt', 'desc').get();
        const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(profiles);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar ordens. Verifique se o índice do Firestore foi criado.' }); }
});

app.post('/api/build-orders', requireAuth, async (req, res) => {
    const { profileName, order } = req.body;
    if (!profileName || !order) return res.status(400).json({ error: 'Nome do perfil e ordem são obrigatórios.' });
    try {
        const newProfile = { userId: req.user.uid, profileName, order, createdAt: admin.firestore.FieldValue.serverTimestamp() };
        const docRef = await db.collection('buildOrders').add(newProfile);
        res.status(201).json({ id: docRef.id, ...newProfile });
    } catch (error) { res.status(500).json({ error: 'Erro ao criar ordem.' }); }
});

app.put('/api/build-orders/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { profileName, order } = req.body;
    if (!profileName || !order) return res.status(400).json({ error: 'Nome e ordem são obrigatórios.' });
    try {
        const docRef = db.collection('buildOrders').doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) return res.status(404).json({ error: 'Perfil não encontrado.' });
        await docRef.update({ profileName, order });
        res.status(200).json({ message: 'Perfil atualizado.' });
    } catch (error) { res.status(500).json({ error: 'Erro ao atualizar ordem.' }); }
});

app.delete('/api/build-orders/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const docRef = db.collection('buildOrders').doc(id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) return res.status(404).json({ error: 'Perfil não encontrado.' });
        await docRef.delete();
        res.status(200).json({ message: 'Perfil deletado.' });
    } catch (error) { res.status(500).json({ error: 'Erro ao deletar ordem.' }); }
});

// --- API DE GERAÇÃO DE SCRIPTS ---
app.get('/api/get-raw-script/:scriptName', requireAuth, (req, res) => {
    const scriptName = req.params.scriptName;
    if (!/^[a-zA-Z0-9_]+$/.test(scriptName)) return res.status(400).send('Nome de script inválido.');
    const filePath = path.join(__dirname, 'userscripts_content', `${scriptName}_script_content.js`);
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('Arquivo de script não encontrado.');
        res.setHeader('Content-Type', 'text/plain').send(data);
    });
});

app.post('/api/generate-custom-script', requireAuth, async (req, res) => {
    const { order } = req.body;
    if (!order || !Array.isArray(order)) return res.status(400).json({ error: 'A ordem de construção é obrigatória.' });
    try {
        const filePath = path.join(__dirname, 'userscripts_content', `upador_script_content.js`);
        let scriptText = fs.readFileSync(filePath, 'utf8');

        const newOrderString = order.map(item => `        "main_buildlink_${item.building}_${item.level}"`).join(',\n');
        const newFunctionString = `function getConstrucao_Edifcios_Serie() {\n    const Sequencia_Construcao = [\n${newOrderString}\n    ];\n\n    return Sequencia_Construcao;\n}`;
        const regex = /function\s+getConstrucao_Edifcios_Serie\s*\(\)\s*\{[\s\S]*?\}/i;
        if (regex.test(scriptText)) scriptText = scriptText.replace(regex, newFunctionString);

        const firebaseClientConfig = getFirebaseClientConfig();
        const configRegex = /(const\s+FIREBASE_CLIENT_CONFIG\s*=\s*){};/;
        if (configRegex.test(scriptText)) scriptText = scriptText.replace(configRegex, `$1${JSON.stringify(firebaseClientConfig)};`);
        
        let userscriptApiKey;
        const keyDoc = await db.collection('userscriptKeys').doc(req.user.uid).get();
        if (keyDoc.exists) {
            userscriptApiKey = keyDoc.data().userscriptKey;
        } else {
            userscriptApiKey = crypto.randomBytes(32).toString('hex');
            await db.collection('userscriptKeys').doc(req.user.uid).set({ uid: req.user.uid, userscriptKey: userscriptApiKey, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        const keyRegex = /(const\s+USERSCRIPT_API_KEY\s*=\s*)"";/;
        if (keyRegex.test(scriptText)) scriptText = scriptText.replace(keyRegex, `$1"${userscriptApiKey}";`);

        res.setHeader('Content-Type', 'text/plain').send(scriptText);
    } catch (error) {
        console.error('[SERVER ERROR] Falha ao gerar script personalizado:', error);
        res.status(500).json({ error: 'Erro interno ao gerar o script.' });
    }
});


// --- ROTAS DE AUTENTICAÇÃO E ALERTA DOS SCRIPTS ---
app.post('/alert', async (req, res) => {
    const { message } = req.body;
    const authToken = req.headers.authorization?.split('Bearer ')[1] || null;
    if (!message || !authToken) return res.status(400).send('Mensagem ou token de autenticação ausente.');
    try {
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const userId = decodedToken.uid;
        
        await db.collection('alerts').add({
            message: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            userEmail: decodedToken.email || 'N/A'
        });

        if (message.toUpperCase().includes('CAPTCHA') || message.toUpperCase().includes('ATAQUE')) {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists && userDoc.data().whatsappNumber) {
                const userPhoneNumber = userDoc.data().whatsappNumber;
                const workerUrl = process.env.WHATSAPP_WORKER_URL;
                if (workerUrl) {
                    axios.post(`${workerUrl}/send-message`, {
                        number: userPhoneNumber,
                        message: `🚨 ALERTA MULTCONTROL 🚨\n\n${message}`
                    }).catch(err => console.error("[SERVER ERROR] Erro ao se comunicar com o WhatsApp Worker:", err.message));
                }
            }
        }
        res.status(200).send('Alerta recebido com sucesso!');
    } catch (error) { 
        console.error('[SERVER ERROR] Erro na rota /alert:', error);
        res.status(401).send('Não autorizado ou erro ao processar alerta.'); 
    }
});

app.post('/api/get_fresh_id_token', async (req, res) => {
    const userscriptApiKey = req.headers.authorization?.split('Bearer ')[1] || null;
    if (!userscriptApiKey) return res.status(401).json({ error: 'Userscript API Key ausente.' });
    try {
        const querySnapshot = await db.collection('userscriptKeys').where('userscriptKey', '==', userscriptApiKey).limit(1).get();
        if (querySnapshot.empty) return res.status(401).json({ error: 'Userscript API Key inválida.' });
        const uid = querySnapshot.docs[0].data().uid;
        const customToken = await admin.auth().createCustomToken(uid);
        res.json({ customToken: customToken });
    } catch (error) { res.status(500).json({ error: 'Erro interno ao gerar Custom Token.' }); }
});

// **ROTA ORIGINAL RESTAURADA**
app.get('/get_userscripts_with_token', requireAuth, async (req, res) => {
    try {
        let userscriptKey;
        const keyDoc = await db.collection('userscriptKeys').doc(req.user.uid).get();
        if (keyDoc.exists) {
            userscriptKey = keyDoc.data().userscriptKey;
        } else {
            userscriptKey = crypto.randomBytes(32).toString('hex');
            await db.collection('userscriptKeys').doc(req.user.uid).set({ uid: req.user.uid, userscriptKey: userscriptKey, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        const captchaScriptBase64 = readScriptFileAsBase64('captcha_script_content.js', userscriptKey); 
        const upadorScriptBase64 = readScriptFileAsBase64('upador_script_content.js', userscriptKey);
        const ataquesScriptBase64 = readScriptFileAsBase64('ataques_script_content.js', userscriptKey);
        res.json({ captchaScriptBase64, upadorScriptBase64, ataquesScriptBase64 });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno ao gerar scripts.' });
    }
});


// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
