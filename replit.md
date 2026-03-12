# wabot - Replit Configuration

## Overview

**wabot** is a WhatsApp bot built with Node.js that allows users to download videos from YouTube, TikTok, and other platforms directly through WhatsApp. The bot uses Baileys library to interface with WhatsApp Web, yt-dlp for video downloading, and a modern dark-themed web dashboard for monitoring.

Key features:
- WhatsApp connection via QR code scanning
- Interactive terminal-style menus for video format selection
- Video download from YouTube, TikTok, and other platforms via yt-dlp
- Web dashboard with real-time console, download history, and QR code display
- `sudo <command>` support for shell command execution from WhatsApp
- JSON-based logging (no database required)

## User Preferences

Preferred communication style: Simple, everyday language. Spanish preferred.

## System Architecture

### Backend (Node.js + Express)
- **Entry point**: `server.js` — starts the Express web server and the WhatsApp bot simultaneously
- **WhatsApp layer**: Uses `@whiskeysockets/baileys` to connect to WhatsApp Web via multi-file auth state stored in `auth/` directory
- **Message handling**: Tracks per-user conversation state using in-memory `Map` (`userState`), guides users through a multi-step interactive menu flow (URL detection → format selection → download)
- **Download module**: `dl.js` handles the download logic by spawning `python3 -m yt_dlp` as a child process, saving files locally, sending to user via WhatsApp, and auto-deleting after 40 seconds
- **Console logging**: Real-time console buffer tracks all bot activity; updates pushed to web dashboard via `/api/info` endpoint

### Frontend (Static HTML)
- **Dashboard**: `public/index.html` — dark GitHub-style single-page dashboard that polls `/api/info` every 2 seconds
- Features:
  - Real-time console display (500-line buffer, scrolling)
  - Scannable QR code for WhatsApp authentication
  - Connection status badge (Conectado/Esperando QR/Desconectado)
  - Recent downloads table with status indicators

### Data Storage
- **JSON Logs**: `data/logs.json` — stores activity log entries (URL, title, status, timestamp). Keeps last 100 entries.
- **In-memory console**: `consoleBuffer` array (500 lines max) tracks real-time bot activity
- **In-memory state**: `userState` Map tracks active user conversation steps; resets on bot restart
- **File system**: Downloaded videos temporarily stored in project root, auto-deleted after 40 seconds

### Authentication
- WhatsApp authentication uses Baileys' `useMultiFileAuthState`, persisting session credentials in `auth/` directory
- No user-facing login for web dashboard — open access intended for bot owner only

### API
- `GET /` — serves the dashboard HTML
- `GET /api/info` — returns JSON with `status` (connection state), `qr` (base64 QR image), `logs` (last 10 download entries), and `console` (last 50 console lines)

## External Dependencies

| Dependency | Purpose |
|---|---|
| `@whiskeysockets/baileys` | WhatsApp Web API client for sending/receiving messages |
| `express` | Web server for control dashboard and REST API |
| `pino` | Logger used internally by Baileys |
| `qrcode` | Generates base64 QR code image for web dashboard |
| `qrcode-terminal` | Prints QR code to terminal as fallback |
| `yt-dlp` (Python) | Video downloading from YouTube, TikTok, etc. — must be installed as Python module (`python3 -m yt_dlp`) |
| `python3` | Runtime required for yt-dlp; must be available in environment |

### Environment Variables Required
None required. Port defaults to 5000, configurable via `PORT` env var.

### Notes for the Agent
- The `auth/` directory must be writable; stores WhatsApp session files
- The `data/` directory stores JSON logs; created automatically if missing
- yt-dlp must be installed: `pip install yt-dlp`
- Downloaded video files are created in working directory (project root) and auto-cleaned after 40 seconds
- `main.py` is not used; primary download path uses `spawn('python3', ['-m', 'yt_dlp', ...])`
- Web dashboard polls `/api/info` every 2 seconds for real-time updates

## Recent Changes (Latest Session)

1. **Removed PostgreSQL** — eliminated `pg` dependency, all data now JSON-based
2. **JSON Logging System** — logs saved to `data/logs.json`, console buffer in memory
3. **Real-Time Console** — web dashboard now shows live console output (500-line buffer, 2-second polling)
4. **Project Renamed** — `wabot` (previously "whatsapp-bot")
5. **Enhanced UI** — improved dark dashboard with two-column layout, terminal styling, better status indicators
6. **Terminal Commands** — improved `sudo` command output formatting and logging
7. **Interactive Menus** — refined WhatsApp messages with better terminal-style formatting

## File Structure
```
wabot/
├── server.js           # Main Express + Baileys bot
├── dl.js               # Download handler module
├── package.json        # Dependencies
├── public/
│   └── index.html      # Web dashboard
├── auth/               # WhatsApp session files (auto-created)
├── data/               # JSON data directory (auto-created)
│   └── logs.json       # Download/activity logs
└── replit.md           # This file
```
