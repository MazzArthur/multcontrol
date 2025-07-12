const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { FirestoreStore } = require('wwebjs-mongo'); // <-- Importa da nova biblioteca
const qrcode = require('qrcode');
const admin = require('firebase-admin');
require('dotenv').config();

// --- Configuração do Worker ---
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3001; 

// --- Conexão com Firebase ---
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('[WORKER] Conectado ao Firebase.');
} catch (e) {
    console.error('[WORKER ERROR] Falha ao conectar ao Firebase:', e);
    process.exit(1);
}
const db = admin.firestore();

// =================================================================
// == USANDO A BIBLIOTECA OFICIAL PARA O STORE ==
// =================================================================
console.log('[WORKER] Configurando FirestoreStore para salvar a sessão...');
const store = new FirestoreStore({
    database: db
});
// =================================================================

// --- Inicialização do Cliente WhatsApp com a nova estratégia ---
console.log('[WORKER] Inicializando cliente WhatsApp com RemoteAuth e FirestoreStore...');
const client = new Client({
    authStrategy: new RemoteAuth({
        store: store,
        backupSyncIntervalMs: 300000 // Salva a sessão a cada 5 minutos
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// --- Eventos do Cliente WhatsApp (sem alterações) ---
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
    console.log('[WORKER] Sessão salva com sucesso no Firestore via wwebjs-mongo!');
});

client.on('disconnected', async (reason) => {
    console.log('[WORKER] Cliente foi desconectado:', reason);
    await db.collection('whatsapp_status').doc('session').set({ status: 'DISCONNECTED' });
    client.initialize(); 
});

client.initialize().catch(err => console.error('[WORKER ERROR] Falha na inicialização do cliente:', err));


// --- API interna do Worker (sem alterações) ---
app.get('/ping', (req, res) => { /* ... */ });
app.post('/send-message', async (req, res) => { /* ... */ });

app.listen(PORT, () => {
    console.log(`[WORKER] Servidor do Worker rodando na porta ${PORT}`);
});
