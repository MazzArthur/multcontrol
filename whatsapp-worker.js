const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const admin = require('firebase-admin');
require('dotenv').config();

// --- INICIALIZAÇÃO DOS SERVIÇOS ---

// Conexão com Firebase (para atualizar o status no painel de admin)
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    });
    console.log('[WORKER] Conectado ao Firebase Admin.');
} catch (e) {
    console.error('[WORKER ERROR] Falha ao conectar ao Firebase:', e);
    process.exit(1);
}
const db = admin.firestore();

// Conexão com MongoDB (para salvar a sessão do WhatsApp)
console.log('[WORKER] Tentando conectar ao MongoDB...');
mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log('[WORKER] Conectado ao MongoDB com sucesso.');
    
    const store = new MongoStore({ mongoose: mongoose });
    
    // --- Inicialização do Cliente WhatsApp ---
    // Esta parte só roda DEPOIS de conectar ao MongoDB
    console.log('[WORKER] Inicializando cliente WhatsApp com MongoStore...');
    const client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000 // Salva a sessão a cada 5 minutos, se houver mudanças
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    // --- Eventos do Cliente WhatsApp ---
    client.on('qr', async (qr) => {
        console.log('[WORKER] QR Code recebido. Salvando no Firestore para o painel de admin...');
        try {
            const qrImageUrl = await qrcode.toDataURL(qr);
            await db.collection('whatsapp_status').doc('session').set({
                qrCodeUrl: qrImageUrl,
                status: 'QR_CODE_READY',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) { console.error('[WORKER ERROR] Falha ao salvar QR Code:', err); }
    });

    client.on('ready', async () => {
        console.log('[WORKER] Cliente WhatsApp está pronto e conectado!');
        await db.collection('whatsapp_status').doc('session').set({ status: 'CONNECTED' });
    });

    client.on('remote_session_saved', () => {
        console.log('[WORKER] Sessão salva com sucesso no MongoDB!');
    });

    client.on('disconnected', async (reason) => {
        console.log('[WORKER] Cliente foi desconectado:', reason);
        await db.collection('whatsapp_status').doc('session').set({ status: 'DISCONNECTED' });
        client.initialize(); 
    });

    client.initialize().catch(err => console.error('[WORKER ERROR] Falha na inicialização do cliente:', err));


    // --- API interna do Worker ---
    const app = express();
    app.use(express.json());
    const PORT = process.env.PORT || 3001;

    app.get('/ping', (req, res) => {
        console.log(`[WORKER] Ping recebido em: ${new Date().toISOString()}`);
        res.status(200).json({ status: 'ok', service: 'whatsapp-worker' });
    });

    app.post('/send-message', async (req, res) => {
        const { number, message } = req.body;
        if (!number || !message) return res.status(400).json({ error: 'Número e mensagem são obrigatórios.' });
        
        const chatId = `${number.replace(/\D/g, '')}@c.us`;
        try {
            const isRegistered = await client.isRegisteredUser(chatId);
            if (!isRegistered) {
                console.error(`[WORKER] Tentativa de envio para número não registrado: ${number}`);
                return res.status(404).json({ success: false, error: 'Este número não tem WhatsApp.' });
            }
            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();
            const delay = Math.floor(Math.random() * 3000) + 1000;
            setTimeout(async () => {
                await client.sendMessage(chatId, message);
                await chat.clearState();
            }, delay);
            res.status(200).json({ success: true, message: 'Ordem de envio recebida.' });
        } catch (error) {
            console.error(`[WORKER ERROR] Falha ao processar mensagem para ${number}:`, error);
            res.status(500).json({ success: false, error: 'Falha ao processar a mensagem.' });
        }
    });

    app.listen(PORT, () => {
        console.log(`[WORKER] Servidor do Worker rodando na porta ${PORT}`);
    });

}).catch(err => {
    console.error('[WORKER CRITICAL] Não foi possível conectar ao MongoDB! O Worker não será iniciado.', err);
    process.exit(1);
});
