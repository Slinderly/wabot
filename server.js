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
const AUTH_DIR = 'auth';
const DATA_DIR = 'data';
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// Detectar si estamos en Railway o en Windows (Local)
const isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';
// En Railway usamos el Python del entorno virtual, en PC el global
const pythonPath = isRailway ? '/app/.venv/bin/python' : 'python';

// Asegurar que las carpetas existan para evitar errores de escritura
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- EJEMPLO DE CÓMO USAR EL SPAWN CORREGIDO ---
// Cuando necesites llamar a tu main.py, hazlo así:
/*
const pythonProcess = spawn(pythonPath, ['main.py', argumento1, argumento2]);
*/

console.log(`[SISTEMA] Entorno: ${isRailway ? 'Railway' : 'Local (Windows)'}`);
console.log(`[SISTEMA] Usando Python en: ${pythonPath}`);

let sock;
let qrCodeData = null;
let connectionStatus = "Desconectado";
let consoleBuffer = [];

// Asegurar que existe el directorio de datos
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Función para guardar logs en JSON
function saveLog(url, title, status, error = null) {
    let logs = [];
    if (fs.existsSync(LOGS_FILE)) {
        logs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
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
    
    // Agregar a buffer de consola
    addConsoleLog(`[${status}] ${url}`);
}

// Función para agregar línea a la consola en tiempo real
function addConsoleLog(message) {
    const logLine = {
        timestamp: new Date().toISOString(),
        message
    };
    consoleBuffer.unshift(logLine);
    
    // Guardar últimas 500 líneas
    if (consoleBuffer.length > 500) {
        consoleBuffer = consoleBuffer.slice(0, 500);
    }
    
    console.log(`[CONSOLE] ${message}`);
}

// --- MIDDLEWARES Y RUTAS WEB ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/info', async (req, res) => {
    let qrImg = null;
    if (qrCodeData) qrImg = await QRCode.toDataURL(qrCodeData);

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
        browser: ['wabot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = qr;
            connectionStatus = "Esperando QR";
            qrcodeTerminal.generate(qr, { small: true });
            addConsoleLog("Esperando escaneo de QR...");
        }

        if (connection === 'open') {
            qrCodeData = null;
            connectionStatus = "Conectado";
            console.log('✅ WhatsApp conectado');
            addConsoleLog("✅ WhatsApp conectado");
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            connectionStatus = "Reconectando...";
            addConsoleLog(`⚠️ Desconectado. Reconectando en 5s...`);
            if (code === 401) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        if (!text) return;

        addConsoleLog(`📨 Mensaje de ${jid.split('@')[0]}: ${text.substring(0, 50)}`);

        // Manejo de descargas
        const handled = await dl.handleDownload(sock, m, userState, saveLog, addConsoleLog);

        // Respuesta por defecto
        if (!handled) {
            await sock.sendMessage(jid, { 
                text: "🎥 *WABOT*\n\nEnvíame una URL para descargar el video." 
            });
        }
    });
}

// Inicializar bot
startBot();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🌐 wabot en puerto ${PORT}`);
    addConsoleLog("🚀 wabot iniciado");
});
