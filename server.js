const { 
    makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { spawn } = require('child_process');
const dl = require('./dl');

const app = express();
const userState = new Map();

// --- CONFIGURACIÓN DE RUTAS Y ENTORNO ---
const AUTH_DIR = path.join(__dirname, 'auth');
const DATA_DIR = path.join(__dirname, 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// Detectar si estamos en Railway o en Windows (Local)
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';

/**
 * IMPORTANTE: Esta es la ruta al ejecutable de Python.
 * En Railway, usamos el que está dentro del entorno virtual (.venv) 
 * que creamos con nixpacks.toml.
 */
const pythonPath = isRailway ? '/app/.venv/bin/python' : 'python';

// Asegurar que las carpetas existan al iniciar
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sock;
let qrCodeData = null;
let connectionStatus = "Desconectado";
let consoleBuffer = [];

console.log(`[SISTEMA] Entorno: ${isRailway ? 'RAILWAY' : 'LOCAL (Windows)'}`);
console.log(`[SISTEMA] Usando ejecutable Python en: ${pythonPath}`);

// --- FUNCIONES DE LOGGING ---

function saveLog(url, title, status, error = null) {
    let logs = [];
    if (fs.existsSync(LOGS_FILE)) {
        try {
            logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
        } catch (e) { logs = []; }
    }
    
    const newLog = {
        id: Date.now(),
        url,
        title: title || 'Unknown',
        status,
        error: error || null,
        created_at: new Date().toISOString()
    };
    
    logs.unshift(newLog);
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs.slice(0, 100), null, 2));
    addConsoleLog(`[${status}] ${url}`);
}

function addConsoleLog(message) {
    const logLine = {
        timestamp: new Date().toISOString(),
        message
    };
    consoleBuffer.unshift(logLine);
    if (consoleBuffer.length > 500) consoleBuffer = consoleBuffer.slice(0, 500);
    console.log(`[LOG] ${message}`);
}

// --- SERVIDOR WEB ---

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/info', async (req, res) => {
    let qrImg = null;
    try {
        if (qrCodeData) qrImg = await QRCode.toDataURL(qrCodeData);
    } catch (e) { console.error("Error generando QR DataURL", e); }

    let history = [];
    if (fs.existsSync(LOGS_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8')).slice(0, 10);
        } catch(e) {}
    }

    res.json({ 
        status: connectionStatus, 
        qr: qrImg, 
        logs: history,
        console: consoleBuffer.slice(0, 50)
    });
});

// --- LÓGICA DE WHATSAPP ---

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    if (sock) sock.ev.removeAllListeners();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['WABOT', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = "Esperando QR";
            qrcodeTerminal.generate(qr, { small: true });
            addConsoleLog("QR generado. Por favor, escanea con tu celular.");
        }

        if (connection === 'open') {
            qrCodeData = null;
            connectionStatus = "Conectado";
            addConsoleLog("✅ WhatsApp Conectado Correctamente");
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "Desconectado";
            addConsoleLog(`⚠️ Conexión cerrada. ¿Reconectando?: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            } else {
                addConsoleLog("❌ Sesión cerrada permanentemente. Borrando datos de autenticación...");
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                setTimeout(startBot, 2000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        if (!text) return;

        addConsoleLog(`📩 Mensaje de ${jid.replace('@s.whatsapp.net', '')}: ${text.substring(0, 30)}...`);

        /**
         * NOTA: He agregado 'pythonPath' como argumento. 
         * Asegúrate de actualizar tu archivo dl.js para que reciba este parámetro 
         * y lo use en el spawn de main.py.
         */
        const handled = await dl.handleDownload(sock, m, userState, saveLog, addConsoleLog, pythonPath);

        if (!handled && !m.key.remoteJid.endsWith('@g.us')) {
            await sock.sendMessage(jid, { 
                text: "🎥 *WABOT - BOLIVIA*\n\nHola. Envíame un enlace de YouTube o TikTok para descargarlo." 
            });
        }
    });
}

// Iniciar
startBot();

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    addConsoleLog(`🚀 Servidor Web escuchando en puerto ${PORT}`);
});
