'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const { MpvController } = require('./mpv.js');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(__dirname, 'assets', 'icon.png');
const PID_FILE = path.join(ROOT, 'data', 'server.pid');

function getPort() {
  let port = 8080;
  try {
    const content = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^\s*PORT\s*=\s*(\d+)/m.exec(content);
    if (m) port = parseInt(m[1], 10);
  } catch { /* usa padrão */ }
  return port;
}

const PORT = getPort();
const BASE = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let tray = null;
let serverChild = null;
let mpv = null;
let mpvMediaId = null;
let progressTimer = null;

function isServerUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/system/info', timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Inicia o servidor como daemon DETACHED: continua rodando mesmo depois que o
 * aplicativo (Electron) for fechado. Grava o PID em data/server.pid para
 * permitir reiniciar/parar pela bandeja. Se já estiver rodando, apenas reutiliza.
 */
async function startServer() {
  if (await isServerUp()) return;
  return new Promise((resolve, reject) => {
    try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
    serverChild = spawn(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,   // roda independente do app
      stdio: 'ignore',  // logs vão para data/logs via pino
    });
    serverChild.unref();
    serverChild.on('error', (err) => reject(err));
    try { fs.writeFileSync(PID_FILE, String(serverChild.pid)); } catch { /* ok */ }

    const deadline = Date.now() + 30000;
    const poll = async () => {
      if (await isServerUp()) return resolve();
      if (Date.now() > deadline) return reject(new Error('servidor não iniciou a tempo'));
      setTimeout(poll, 500);
    };
    poll();
  });
}

function stopServer() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* já encerrou */ }
    }
  } catch { /* sem pid */ }
  if (serverChild) { serverChild = null; }
}

function waitServerDown(timeout = 8000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
      isServerUp().then((up) => {
        if (!up) return resolve();
        if (Date.now() > deadline) return resolve();
        setTimeout(poll, 400);
      });
    };
    poll();
  });
}

async function restartServer() {
  stopServer();
  await waitServerDown();
  await startServer();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(BASE);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'ShelfCast',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(BASE);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', () => {
    // Fecha o app de verdade (libera o terminal). O servidor é um daemon
    // detached e continua rodando em background.
    app.isQuitting = true;
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  // Em algumas distros Linux, sair do HTML fullscreen deixa a janela presa em
  // tela cheia e sem responder. Força a restauração nesse caso.
  mainWindow.on('leave-html-full-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }
  });

  mainWindow.on('enter-full-screen', () => notifyRenderer('window:fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => notifyRenderer('window:fullscreen-changed', false));
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON);
  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('ShelfCast');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir ShelfCast', click: () => { if (!mainWindow) createWindow(); else mainWindow.show(); } },
    { label: 'Web (navegador)', click: () => shell.openExternal(BASE) },
    { type: 'separator' },
    { label: 'Reiniciar servidor', click: () => restartServer().catch((e) => console.error('falha ao reiniciar servidor:', e.message)) },
    { label: 'Parar servidor', click: () => stopServer() },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// ------------------------- mpv -------------------------

function notifyRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function saveProgress(position, finished, duration) {
  if (!mpvMediaId) return;
  const body = JSON.stringify({ position: Math.floor(position || 0), duration: Math.floor(duration || 0), finished: !!finished });
  const req = http.request(`${BASE}/api/media/${mpvMediaId}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', () => {});
  req.end(body);
}

function startProgressPolling() {
  clearInterval(progressTimer);
  progressTimer = setInterval(async () => {
    if (mpv && mpv.isRunning) {
      const pos = await mpv.getPosition().catch(() => null);
      const dur = await mpv.getDuration().catch(() => null);
      if (typeof pos === 'number') saveProgress(pos, false, dur);
    }
  }, 5000);
}

async function playInMpv({ id, url, title }) {
  if (mpv && mpv.isRunning) mpv.stop();
  mpv = new MpvController();
  mpvMediaId = id;
  notifyRenderer('mpv:started', { id, title: title || '' });

  try {
    await mpv.start(url, {
      onProgress: () => {},
      onEnded: async () => {
        const pos = mpv ? await mpv.getPosition().catch(() => null) : null;
        const dur = mpv ? await mpv.getDuration().catch(() => null) : null;
        saveProgress(pos, true, dur);
        clearInterval(progressTimer);
      },
      onClose: async () => {
        clearInterval(progressTimer);
        const pos = mpv ? await mpv.getPosition().catch(() => null) : null;
        const dur = mpv ? await mpv.getDuration().catch(() => null) : null;
        if (typeof pos === 'number') saveProgress(pos, false, dur);
        notifyRenderer('mpv:closed', { id: mpvMediaId });
        mpv = null;
        mpvMediaId = null;
      },
    });
    startProgressPolling();
    return { ok: true };
  } catch (err) {
    notifyRenderer('mpv:closed', { id: mpvMediaId, error: err.message });
    mpv = null;
    mpvMediaId = null;
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('dialog:pickFolder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    title: 'Selecionar pasta de mídia local',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('mpv:available', async () => {
  return new Promise((resolve) => {
    const child = spawn('mpv', ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
});

ipcMain.handle('mpv:play', async (_e, opts) => {
  try { return await playInMpv(opts || {}); } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('mpv:stop', async () => {
  if (mpv) { mpv.stop(); mpv = null; }
  return { ok: true };
});

ipcMain.handle('mpv:state', async () => {
  return { running: !!(mpv && mpv.isRunning) };
});

ipcMain.handle('window:setFullScreen', (_e, full) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!!full);
    return { ok: true };
  }
  return { ok: false };
});

// ------------------------- app -------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      createWindow();
      createTray();
    } catch (err) {
      console.error('Erro ao iniciar a aplicação:', err.message);
      app.isQuitting = true;
      app.quit();
    }
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    clearInterval(progressTimer);
    if (mpv) { mpv.stop(); mpv = null; }
    // O servidor é um daemon DETACHED: não é encerrado aqui — continua rodando.
    // Para encerrá-lo, use a bandeja → "Parar servidor".
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
