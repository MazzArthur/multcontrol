const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js'); // Mudamos de LocalAuth para RemoteAuth
const qrcode = require('qrcode');
const admin = require('firebase-admin');
require('dotenv').config();

// --- Conexão com Firebase ---
try {
    const buff = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64');
    const serviceAccountJson = buff.toString('utf-8');
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[WORKER] Conectado ao Firebase.');
} catch (e) {
    console.error('[WORKER ERROR] Falha ao conectar ao Firebase:', e);
    process.exit(1);
}
const db = admin.firestore();

// =================================================================
// == NOVA LÓGICA PARA SALVAR A SESSÃO NO FIRESTORE ==
// =================================================================
// Criamos um "Store" que diz à biblioteca como salvar/carregar do Firestore
const { FirestoreStore } = require('wwebjs-mongo'); // Usaremos a estrutura, mas adaptada
class CustomFirestoreStore {
    constructor() {
        this.sessionRef = db.collection('whatsapp_sessions').doc('auth_session');
    }
    async save(session) {
        await this.sessionRef.set(session);
    }
    async sessionExists(session) {
        const doc = await this.sessionRef.get();
        return doc.exists;
    }
    async extract(session) {
        const doc = await this.sessionRef.get();
        return doc.exists ? doc.data() : null;
    }
    async delete(session) {
        await this.sessionRef.delete();
    }
}

const store = new CustomFirestoreStore();
// =================================================================

// --- Configuração do Worker ---
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001; 

// --- Inicialização do Cliente WhatsApp com a nova estratégia ---
console.log('[WORKER] Inicializando cliente WhatsApp com RemoteAuth...');
const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000 // Salva a sessão no Firestore a cada 5 minutos
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// --- Eventos do Cliente WhatsApp (permanecem os mesmos) ---
client.on('qr', async (qr) => {
    console.log('[WORKER] QR Code recebido. Salvando no Firestore para o painel de admin...');
    try {
        const qrImageUrl = await qrcode.toDataURL(qr);
        await db.collection('whatsapp_status').doc('session').set({
            qrCodeUrl: qrImageUrl,
            status: 'QR_CODE_READY'
        });
    } catch (err) { console.error('[WORKER ERROR] Falha ao salvar QR Code:', err); }
});

client.on('ready', async () => {
    console.log('[WORKER] Cliente WhatsApp está pronto e conectado!');
    await db.collection('whatsapp_status').doc('session').set({ status: 'CONNECTED' });
});

client.on('remote_session_saved', () => {
    console.log('[WORKER] Sessão salva com sucesso no Firestore!');
});

// ... outros eventos como 'disconnected' ...

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
