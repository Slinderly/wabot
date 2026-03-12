const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * UTILIDADES DE LIMPIEZA Y FORMATO
 */
function sanitizeUrl(u) {
    try {
        const parsed = new URL(u);
        if (parsed.hostname.includes('youtu.be')) parsed.search = ''; 
        return parsed.toString();
    } catch (e) { return u; }
}

function numberToEmoji(n) {
    const emojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
    return n < 10 ? emojis[n] : `${n}.`;
}

/**
 * OBTENER INFORMACIÓN DE FORMATOS (yt-dlp -j)
 */
function fetchInfo(url) {
    return new Promise((resolve, reject) => {
        const py = spawn('python3', ['-m', 'yt_dlp', '-j', '--no-warnings', sanitizeUrl(url)]);
        let data = '';
        let errData = '';

        py.stdout.on('data', d => { data += d.toString(); });
        py.stderr.on('data', d => { errData += d.toString(); });

        py.on('close', (code) => {
            if (code !== 0) return reject(new Error(errData || 'Error al obtener info'));
            try { 
                resolve(JSON.parse(data)); 
            } catch (e) { 
                reject(new Error('Error al parsear JSON de yt-dlp')); 
            }
        });
    });
}

/**
 * DESCARGA Y ENVÍO DINÁMICO
 * Solución para evitar errores de extensión y "videos fantasma"
 */
async function downloadAndSend(sock, jid, url, format, saveLog, addConsoleLog) {
    const baseFilename = `vid_${Date.now()}`; 
    addConsoleLog(`⬇️ Descargando: ${url}`);
    
    try {
        await sock.sendMessage(jid, { text: "⏳ Descargando video..." });
    } catch (e) {
        addConsoleLog(`❌ Error conexión socket: ${e.message}`);
        return; 
    }

    const args = [
        '-m', 'yt_dlp', 
        '-f', format,
        '--merge-output-format', 'mp4',
        '-o', `${baseFilename}.%(ext)s`, // Deja que yt-dlp decida la extensión final
        '--no-check-certificate',
        '--no-warnings',
        sanitizeUrl(url)
    ];

    const py = spawn('python3', args);
    let stderrBuffer = '';

    py.stderr.on('data', (d) => { stderrBuffer += d.toString(); });

    py.on('close', async (code) => {
        // Buscamos el archivo que empiece con nuestro ID (puede ser .mp4, .mkv, .webm)
        const files = fs.readdirSync('./');
        const downloadedFile = files.find(f => f.startsWith(baseFilename));

        if (code === 0 && downloadedFile) {
            try {
                addConsoleLog(`✅ Descarga exitosa: ${downloadedFile}. Enviando...`);
                await sock.sendMessage(jid, { text: "📤 Enviando archivo..." });

                const fileBuffer = fs.readFileSync(downloadedFile);

                await sock.sendMessage(jid, { 
                    video: fileBuffer, 
                    caption: `✅ Video descargado con éxito`,
                    mimetype: 'video/mp4' // Forzamos MP4 para que WhatsApp lo reconozca
                });
                
                saveLog(url, "Video", 'OK');
            } catch(e) {
                addConsoleLog(`❌ Error en envío: ${e.message}`);
                await sock.sendMessage(jid, { text: `❌ No pude enviarte el archivo.` }).catch(()=>{});
            } finally {
                if (downloadedFile && fs.existsSync(downloadedFile)) fs.unlinkSync(downloadedFile);
            }
        } else {
            addConsoleLog(`❌ Falló yt-dlp (Code ${code}): ${stderrBuffer}`);
            await sock.sendMessage(jid, { text: `❌ Falló la descarga. Verifica el formato o el enlace.` }).catch(()=>{});
            saveLog(url, 'Error', 'Failed');
            if (downloadedFile && fs.existsSync(downloadedFile)) fs.unlinkSync(downloadedFile);
        }
    });
}

/**
 * MANEJADOR PRINCIPAL DE MENSAJES
 */
async function handleDownload(sock, m, userState, saveLog, addConsoleLog) {
    const jid = m.key.remoteJid;
    const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
    const state = userState.get(jid) || {};
    const urlMatch = text.match(/https?:\/\/[^\s]+/);

    // 1. Detección inicial de URL
    if (urlMatch && !state.step) {
        const url = urlMatch[0];
        userState.set(jid, { url, step: 'menu' });
        await sock.sendMessage(jid, { 
            text: `🎬 *Video Detectado*\n\n1️⃣ Calidad Automática (Mejor)\n2️⃣ Elegir Resolución\n\nResponde con el número de tu opción.` 
        });
        return true;
    }

    // 2. Selección de Menú Principal
    if (state.step === 'menu') {
        if (text === '1') {
            const bestFormat = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
            downloadAndSend(sock, jid, state.url, bestFormat, saveLog, addConsoleLog);
            userState.delete(jid);
            return true;
        } 
        
        if (text === '2') {
            await sock.sendMessage(jid, { text: "🔍 Analizando resoluciones disponibles..." });
            try {
                const info = await fetchInfo(state.url);
                const unique = {};
                
                (info.formats || []).forEach(f => {
                    if (f.resolution && f.vcodec !== 'none') {
                        const res = f.resolution;
                        const isMp4 = f.ext === 'mp4' || (f.vcodec || '').includes('avc');
                        // Preferimos MP4 si la resolución es la misma
                        if (!unique[res] || (isMp4 && !unique[res].isMp4)) {
                            unique[res] = { ...f, isMp4 };
                        }
                    }
                });

                const formats = Object.values(unique).sort((a,b) => (b.height||0) - (a.height||0));
                
                if (!formats.length) throw new Error("No se encontraron formatos de video.");

                let menu = "📊 *Resoluciones Disponibles:*\n";
                formats.forEach((f, i) => {
                    menu += `\n${numberToEmoji(i+1)} ${f.resolution} ${f.isMp4 ? '(MP4)' : ''}`;
                });
                menu += `\n\nResponde con el número de la resolución deseada.`;
                
                userState.set(jid, { step: 'select', url: state.url, formats });
                await sock.sendMessage(jid, { text: menu });
            } catch (e) {
                addConsoleLog(`❌ Error fetchInfo: ${e.message}`);
                await sock.sendMessage(jid, { text: "❌ Error al leer los formatos del video." });
                userState.delete(jid);
            }
            return true;
        }
    }

    // 3. Selección de Resolución Específica
    if (state.step === 'select') {
        const idx = parseInt(text) - 1;
        if (!isNaN(idx) && state.formats && state.formats[idx]) {
            const f = state.formats[idx];
            // Intentamos combinar la resolución elegida con el mejor audio disponible
            const specificFormat = `${f.format_id}+bestaudio/best`;
            downloadAndSend(sock, jid, state.url, specificFormat, saveLog, addConsoleLog);
            userState.delete(jid);
        } else {
            await sock.sendMessage(jid, { text: "⚠️ Selección inválida. Proceso cancelado." });
            userState.delete(jid);
        }
        return true;
    }

    return false; 
}

module.exports = { handleDownload };