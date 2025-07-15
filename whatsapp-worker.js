const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const admin = require('firebase-admin');
require('dotenv').config();

// --- INICIALIZAÇÃO DOS SERVIÇOS ---
// Firebase
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    });
    console.log('[WORKER] ✅ Conectado ao Firebase Admin.');
} catch (e) {
    console.error('[WORKER ERROR] ❌ Falha ao conectar ao Firebase:', e);
    process.exit(1);
}
const db = admin.firestore();

// Conexão com MongoDB
console.log('[WORKER] ⏳ Conectando ao MongoDB...');
mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('[WORKER] ✅ Conectado ao MongoDB com sucesso.');
    
    const store = new MongoStore({ mongoose: mongoose });

    // Inicialização do Cliente WhatsApp
    console.log('[WORKER] 🚀 Inicializando cliente WhatsApp com MongoStore...');
    const client = new Client({
        authStrategy: new RemoteAuth({
            store,
            clientId: 'default',
            backupSyncIntervalMs: 60000
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // QR Code
    client.on('qr', async (qr) => {
        console.log('[WORKER] 📷 QR Code gerado.');
        try {
            const qrImageUrl = await qrcode.toDataURL(qr);
            await db.collection('whatsapp_status').doc('session').set({
                qrCodeUrl: qrImageUrl,
                status: 'QR_CODE_READY',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error('[WORKER ERROR] ❌ Falha ao salvar QR Code:', err);
        }
    });

    client.on('ready', async () => {
        console.log('[WORKER] ✅ Cliente WhatsApp conectado e pronto!');
        await db.collection('whatsapp_status').doc('session').set({
            status: 'CONNECTED',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    });

    client.on('remote_session_saved', () => {
        console.log('[WORKER] 💾 Sessão salva no MongoDB com sucesso.');
    });

    client.on('disconnected', async (reason) => {
        console.log('[WORKER] ⚠️ Cliente desconectado. Motivo:', reason);
        await db.collection('whatsapp_status').doc('session').set({
            status: 'DISCONNECTED',
            reason,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        if (reason !== 'LOGOUT') {
            console.log('[WORKER] 🔁 Tentando reinicializar cliente...');
            client.initialize().catch(err => {
                console.error('[WORKER ERROR] ❌ Falha ao reinicializar o cliente:', err);
            });
        } else {
            console.warn('[WORKER] ⚠️ Sessão encerrada (LOGOUT). Novo QR será necessário.');
            await store.delete('default');
            client.initialize();
        }
    });

    // Inicialização segura
    client.initialize().catch(err => console.error('[WORKER ERROR] ❌ Falha na inicialização:', err));

    // API interna
    const app = express();
    app.use(express.json());

    const PORT = process.env.PORT || 3001;

    app.get('/ping', (req, res) => {
        console.log(`[WORKER] 📡 Ping recebido em: ${new Date().toISOString()}`);
        res.status(200).json({ status: 'ok', service: 'whatsapp-worker' });
    });

    app.post('/send-message', async (req, res) => {
        const { number, message } = req.body;
        if (!number || !message) {
            return res.status(400).json({ error: 'Número e mensagem são obrigatórios.' });
        }

        const chatId = `${number.replace(/\D/g, '')}@c.us`;
        try {
            const isRegistered = await client.isRegisteredUser(chatId);
            if (!isRegistered) {
                console.error(`[WORKER] ❌ Número não registrado no WhatsApp: ${number}`);
                return res.status(404).json({ success: false, error: 'Número não tem WhatsApp.' });
            }

            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();

            const delay = Math.floor(Math.random() * 3000) + 1000;
            setTimeout(async () => {
                await client.sendMessage(chatId, message);
                await chat.clearState();
            }, delay);

            res.status(200).json({ success: true, message: 'Ordem de envio recebida com botão.' });

        } catch (error) {
            console.error(`[WORKER ERROR] ❌ Erro ao enviar mensagem para ${number}:`, error);
            res.status(500).json({ success: false, error: 'Erro interno ao processar mensagem.' });
        }
    });

    // ✅ Inicia o servidor Express
    app.listen(PORT, () => {
        console.log(`[WORKER] 🌐 Servidor HTTP iniciado na porta ${PORT}`);
    });

}).catch(err => {
    console.error('[WORKER ERROR] ❌ Falha ao conectar ao MongoDB:', err);
});
