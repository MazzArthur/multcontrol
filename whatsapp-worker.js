const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const admin = require('firebase-admin');
require('dotenv').config();

// --- Configuração do Worker ---
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001; 

// --- Conexão com Firebase ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[WORKER] Conectado ao Firebase.');
} catch (e) {
    console.error('[WORKER ERROR] Falha ao conectar ao Firebase:', e.message);
}
const db = admin.firestore();

// --- Inicialização do Cliente WhatsApp ---
console.log('[WORKER] Inicializando cliente WhatsApp...');
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// --- Eventos do Cliente WhatsApp ---
client.on('qr', async (qr) => {
    console.log('[WORKER] QR Code recebido. Salvando no Firestore...');
    try {
        const qrImageUrl = await qrcode.toDataURL(qr);
        await db.collection('whatsapp_status').doc('session').set({
            qrCodeUrl: qrImageUrl,
            status: 'QR_CODE_READY',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('[WORKER] QR Code salvo. Escaneie pelo painel de admin.');
    } catch (err) {
        console.error('[WORKER ERROR] Falha ao gerar ou salvar QR Code:', err);
    }
});

client.on('ready', async () => {
    console.log('[WORKER] Cliente WhatsApp está pronto e conectado!');
    await db.collection('whatsapp_status').doc('session').set({
        status: 'CONNECTED',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
});

client.on('disconnected', async (reason) => {
    console.log('[WORKER] Cliente foi desconectado:', reason);
    await db.collection('whatsapp_status').doc('session').set({
        status: 'DISCONNECTED',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    client.initialize(); // Tenta reconectar
});

client.initialize().catch(err => console.error('[WORKER ERROR] Falha na inicialização do cliente:', err));

// --- API interna do Worker ---

// ROTA DE "PING" PARA MANTER O WORKER ATIVO
app.post('/send-message', async (req, res) => {
    const { number, message } = req.body;
    if (!number || !message) {
        return res.status(400).json({ error: 'Número e mensagem são obrigatórios.' });
    }

    const chatId = `${number.replace(/\D/g, '')}@c.us`;

    try {
        // --- VALIDAÇÃO ADICIONADA ---
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            console.error(`[WORKER ERROR] Tentativa de envio para número não registrado no WhatsApp: ${number}`);
            return res.status(404).json({ success: false, error: 'Este número não parece ter WhatsApp.' });
        }

        // Simula "digitando..." para parecer mais humano
        const chat = await client.getChatById(chatId);
        await chat.sendStateTyping();
        
        // Adiciona um atraso aleatório antes de enviar
        const delay = Math.floor(Math.random() * 3000) + 1000; // Atraso de 1 a 4 segundos
        setTimeout(async () => {
            await client.sendMessage(chatId, message);
            console.log(`[WORKER] Mensagem enviada para ${number}`);
            await chat.clearState(); // Limpa o status "digitando"
        }, delay);
        
        // Responde imediatamente ao servidor principal, sem esperar o envio
        res.status(200).json({ success: true, message: 'Ordem de envio recebida.' });

    } catch (error) {
        console.error(`[WORKER ERROR] Falha ao processar mensagem para ${number}:`, error);
        res.status(500).json({ success: false, error: 'Falha ao processar a mensagem.' });
    }
});

app.listen(PORT, () => {
    console.log(`[WORKER] Servidor do Worker rodando na porta ${PORT}`);
});
