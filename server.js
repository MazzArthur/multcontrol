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
const requireAdmin = (req, res, next) => {
    // Verifica se o UID do usuário logado é o mesmo do ADMIN_UID definido no seu .env
    if (req.user.uid !== process.env.ADMIN_UID) {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }
    next();
};

const requirePremium = async (req, res, next) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        // Verifica se o usuário tem a tier "premium"
        if (userDoc.exists && userDoc.data().subscriptionTier === 'premium') {
            const expiration = userDoc.data().subscriptionExpiresAt;
            // E se a assinatura não tem data de expiração ou ainda não expirou
            if (!expiration || expiration.toDate() > new Date()) {
                return next(); 
            }
        }
        // Se qualquer verificação falhar, nega o acesso.
        return res.status(403).json({ error: 'Recurso exclusivo para assinantes premium.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao verificar a assinatura.' });
    }
};
function readScriptFileAsBase64(fileName, userscriptApiKeyToInject) {
    try {
        const filePath = path.resolve(__dirname, 'userscripts_content', fileName);
        let fileContent = fs.readFileSync(filePath, 'utf8');
        
        const firebaseClientConfig = getFirebaseClientConfig();
        
        // --- MUDANÇA AQUI: Procura pelos novos placeholders ---
        const configPlaceholderRegex = /const\s+hardcodedConfig\s*=\s*{};/;
        const keyPlaceholderRegex = /const\s+hardcodedApiKey\s*=\s*"";/;

        // Injeta a configuração do Firebase
        if (configPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(configPlaceholderRegex, `const hardcodedConfig = ${JSON.stringify(firebaseClientConfig)};`);
        }
        
        // Injeta a chave de API do script
        if (keyPlaceholderRegex.test(fileContent)) {
            fileContent = fileContent.replace(keyPlaceholderRegex, `const hardcodedApiKey = "${userscriptApiKeyToInject || ''}";`);
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

app.get('/atribuicoes', (req, res) => {
    res.render('atribuicoes', { firebaseConfig: getFirebaseClientConfig() });
});

app.get('/admin-wpp', (req, res) => {
    // Esta rota agora não tem o 'requireAuth'. A verificação será feita na própria página.
    // Nós passamos o UID do admin para a página para que ela possa fazer a verificação.
    res.render('admin-whatsapp', { 
        firebaseConfig: getFirebaseClientConfig(),
        adminUid: process.env.ADMIN_UID 
    });
});
// ROTA DE "PING" PARA MANTER O SERVIÇO WEB ATIVO
app.get('/ping', (req, res) => {
    console.log(`[SERVER] Ping recebido em: ${new Date().toISOString()}`);
    res.status(200).json({ 
        status: 'ok', 
        service: 'web-service', 
        timestamp: new Date() 
    });
});
app.get('/admin', (req, res) => {
    // A verificação de segurança agora é feita pelo JavaScript dentro da página
    res.render('admin', { firebaseConfig: getFirebaseClientConfig() });
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
// --- API DE CONFIGURAÇÃO DE ALERTAS ---
app.post('/api/user/settings', requireAuth, requirePremium, async (req, res) => {
    const { whatsappNumber, discordWebhookUrl } = req.body;
    try {
        // Salva ambos os campos. Se um for vazio, ele salva uma string vazia.
        await db.collection('users').doc(req.user.uid).set({
            whatsappNumber: whatsappNumber || '',
            discordWebhookUrl: discordWebhookUrl || ''
        }, { merge: true });
        res.status(200).json({ message: 'Configurações salvas com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar configurações.' });
    }
});
// Rota para o Tampermonkey verificar a VERSÃO do script
app.get('/scripts/upador.meta.js', (req, res) => {
    const filePath = path.join(__dirname, 'userscripts_content', 'upador_script_content.js');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('// Script not found');
        const headerMatch = data.match(/\/\/\s*==UserScript==[\s\S]+?\/\/\s*==\/UserScript==/);
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.send(headerMatch ? headerMatch[0] : '// Header not found');
    });
});

// Rota para o Tampermonkey BAIXAR a versão completa do script
app.get('/scripts/upador.user.js', (req, res) => {
    const filePath = path.join(__dirname, 'userscripts_content', 'upador_script_content.js');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) return res.status(404).send('// Script not found');
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.send(data);
    });
});
// --- API DE GERENCIAMENTO DE ORDENS DE CONSTRUÇÃO ---
app.get('/api/build-orders', requireAuth, async (req, res) => {
    try {
        const snapshot = await db.collection('buildOrders').where('userId', '==', req.user.uid).orderBy('createdAt', 'desc').get();
        const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(profiles);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar ordens. Verifique se o índice do Firestore foi criado.' }); }
});
// Rota para o Tampermonkey verificar a VERSÃO do script de ataques (meta)
app.get('/scripts/ataques.meta.js', (req, res) => {
    const filePath = path.join(__dirname, 'userscripts_content', 'ataques_script_content.js');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Erro ao ler o arquivo do script de ataques:', err);
            return res.status(404).send('// Script not found');
        }
        const headerMatch = data.match(/\/\/\s*==UserScript==[\s\S]+?\/\/\s*==\/UserScript==/);
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');

        // Evitar cache para garantir que o Tampermonkey sempre verifique atualizações
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        res.send(headerMatch ? headerMatch[0] : '// Header not found');
    });
});

// Rota para o Tampermonkey BAIXAR a versão completa do script de ataques
app.get('/scripts/ataques.user.js', (req, res) => {
    const filePath = path.join(__dirname, 'userscripts_content', 'ataques_script_content.js');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Erro ao ler o arquivo do script de ataques:', err);
            return res.status(404).send('// Script not found');
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');

        // Também evitar cache aqui
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        res.send(data);
    });
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
// --- ROTAS DE ADMINISTRAÇÃO ---
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const listUsersResult = await admin.auth().listUsers(1000);
        const users = await Promise.all(
            listUsersResult.users.map(async (userRecord) => {
                const userDoc = await db.collection('users').doc(userRecord.uid).get();
                const subData = userDoc.exists ? userDoc.data() : {};
                return {
                    uid: userRecord.uid,
                    email: userRecord.email,
                    subscriptionTier: subData.subscriptionTier || 'free',
                    subscriptionExpiresAt: subData.subscriptionExpiresAt || null
                };
            })
        );
        res.status(200).json(users);
    } catch (error) {
        console.error("Erro ao listar usuários:", error);
        res.status(500).json({ error: "Erro ao listar usuários." });
    }
});

app.post('/api/admin/grant-premium', requireAuth, requireAdmin, async (req, res) => {
    const { userId, days } = req.body;
    if (!userId || !days) return res.status(400).json({ error: 'userId e days são obrigatórios.' });
    try {
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        
        let currentExpiration = new Date();
        if (userDoc.exists && userDoc.data().subscriptionTier === 'premium' && userDoc.data().subscriptionExpiresAt?.toDate() > new Date()) {
            currentExpiration = userDoc.data().subscriptionExpiresAt.toDate();
        }

        const newExpirationDate = new Date(currentExpiration.getTime() + (parseInt(days) * 24 * 60 * 60 * 1000));

        await userDocRef.set({
            subscriptionTier: 'premium',
            subscriptionExpiresAt: admin.firestore.Timestamp.fromDate(newExpirationDate)
        }, { merge: true });

        res.status(200).json({ message: `Premium concedido para ${userId} por ${days} dias.` });
    } catch (error) {
        console.error("Erro ao conceder premium:", error);
        res.status(500).json({ error: "Erro ao conceder premium." });
    }
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


app.post('/alert', async (req, res) => {
    const { message } = req.body;
    const authToken = req.headers.authorization?.split('Bearer ')[1] || null;
    if (!message || !authToken) return res.status(400).send('Mensagem ou token de autenticação ausente.');

    try {
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const userId = decodedToken.uid;
        
        // Salva o alerta no Firestore
        await db.collection('alerts').add({
            message: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: userId,
            userEmail: decodedToken.email || 'N/A'
        });

        // Verifica se é um alerta que deve gerar notificação
        if (message.toUpperCase().includes('CAPTCHA') || message.toUpperCase().includes('ATAQUE')) {
            const userDoc = await db.collection('users').doc(userId).get();
            
            // Se o usuário não tiver um documento de configurações, não faz nada
            if (userDoc.exists) {
                const userData = userDoc.data();

                // --- Lógica de Notificação por WhatsApp ---
                if (userData.whatsappNumber && process.env.WHATSAPP_WORKER_URL) {
                    const headers = [
                        "🚨 ALERTA MULTCONTROL 🚨", "⚠️ AVISO IMPORTANTE ⚠️",
                        "🔔 Notificação do Sistema 🔔", "‼️ ATENÇÃO NECESSÁRIA ‼️"
                    ];
                    const randomHeader = headers[Math.floor(Math.random() * headers.length)];
                    const finalMessage = `${randomHeader}\n\n${message}`;
                    
                    axios.post(`${process.env.WHATSAPP_WORKER_URL}/send-message`, {
                        number: userData.whatsappNumber,
                        message: finalMessage
                    }).catch(err => console.error("[SERVER ERROR] Erro ao se comunicar com o WhatsApp Worker:", err.message));
                }

                // --- NOVA LÓGICA DE NOTIFICAÇÃO POR DISCORD ---
                if (userData.discordWebhookUrl) {
                    console.log(`[SERVER] Enviando notificação para o Discord do usuário ${userId}.`);
                    
                    const isAttack = message.toUpperCase().includes('ATAQUE');
                    const discordPayload = {
                        // content: `<@${process.env.YOUR_DISCORD_USER_ID}>`, // Descomente e configure no .env para marcar você
                        embeds: [{
                            title: `🚨 Alerta: ${isAttack ? 'Ataque Recebido' : 'Captcha Necessário'}`,
                            description: message,
                            color: isAttack ? 15158332 : 16705372, // Vermelho para ataque, Amarelo para captcha
                            timestamp: new Date().toISOString(),
                            footer: { text: "MULTCONTROL Alertas" }
                        }]
                    };
                    
                    axios.post(userData.discordWebhookUrl, discordPayload)
                         .catch(err => console.error("[SERVER ERROR] Erro ao enviar notificação para o Discord:", err.message));
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
// **NOVA ROTA** para buscar um perfil específico pelo seu ID
app.get('/api/build-orders/:id', requireAuth, async (req, res) => {
    try {
        const docRef = db.collection('buildOrders').doc(req.params.id);
        const doc = await docRef.get();
        if (!doc.exists || doc.data().userId !== req.user.uid) {
            return res.status(404).json({ error: 'Perfil de construção não encontrado.' });
        }
        res.status(200).json({ order: doc.data().order });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar perfil.' });
    }
});

// --- API PARA O SCRIPT VERIFICAR QUAL PERFIL USAR ---

// **NOVA ROTA LEVE** que retorna apenas o ID do perfil ativo para um nickname
app.get('/api/active-profile-id/:nickname', requireAuth, async (req, res) => {
    const { nickname } = req.params;
    if (!nickname) return res.status(400).json({ error: 'Nickname é obrigatório.' });

    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const assignments = userDoc.exists ? userDoc.data().assignments : null;
        const profileId = assignments ? assignments[nickname] : null;

        res.status(200).json({ activeProfileId: profileId }); // Retorna o ID ou null

    } catch (error) {
        res.status(500).json({ error: 'Erro ao verificar perfil ativo.' });
    }
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
// --- NOVAS ROTAS PARA A PÁGINA DE ATRIBUIÇÕES ---
app.get('/api/nicknames', requireAuth, async (req, res) => {
    try {
        const snapshot = await db.collection('users').doc(req.user.uid).collection('nicknames').get();
        const nicknames = snapshot.docs.map(doc => doc.data());
        res.status(200).json(nicknames);
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar nicknames.' }); }
});

app.get('/api/assignments', requireAuth, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        res.status(200).json(userDoc.exists && userDoc.data().assignments ? userDoc.data().assignments : {});
    } catch (error) { res.status(500).json({ error: 'Erro ao buscar atribuições.' }); }
});

app.post('/api/assignments', requireAuth, async (req, res) => {
    try {
        await db.collection('users').doc(req.user.uid).set({ assignments: req.body.assignments }, { merge: true });
        res.status(200).json({ message: 'Atribuições salvas com sucesso!' });
    } catch (error) { res.status(500).json({ error: 'Erro ao salvar atribuições.' }); }
});
// --- NOVA ROTA PARA REGISTRAR NICKNAMES ---
app.post('/api/nicknames/register', requireAuth, async (req, res) => {
    const { nickname } = req.body;
    if (!nickname) {
        return res.status(400).json({ error: 'Nickname é obrigatório.' });
    }

    try {
        const userId = req.user.uid;
        const nicknameRef = db.collection('users').doc(userId).collection('nicknames').doc(nickname);
        
        const doc = await nicknameRef.get();
        if (doc.exists) {
            // O nickname já existe, não precisa fazer nada.
            return res.status(200).json({ message: 'Nickname já registrado.' });
        } else {
            // Salva o novo nickname
            await nicknameRef.set({
                name: nickname,
                registeredAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return res.status(201).json({ message: 'Nickname registrado com sucesso.' });
        }
    } catch (error) {
        console.error('[SERVER ERROR] Erro ao registrar nickname:', error);
        return res.status(500).json({ error: 'Erro interno ao registrar o nickname.' });
    }
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
