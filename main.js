// Jarvis — processo principale: finestra, icona nella barra di sistema, scorciatoia, avvio con Windows,
// promemoria e aggiornamenti automatici da GitHub.
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, shell, Notification, session } = require('electron');
const path = require('path');
const store = require('./src/store');
const brain = require('./src/brain');
const voice = require('./src/voice');
const stt = require('./src/stt');

let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { console.warn('updater non disponibile', e); }

// Repository GitHub da cui arrivano gli aggiornamenti ("utente/repo"). Può essere cambiato dalle Impostazioni.
const DEFAULT_UPDATE_REPO = 'AlfonsoFioren/jarvis';

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('it.personale.jarvis');

let win = null, tray = null, quitting = false;
let updateState = { status: 'idle', detail: '' };
const pendingConfirms = new Map();

const ICON = path.join(__dirname, 'build', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'build', 'tray.png');

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  send('ui:focus');
}

function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 420, minHeight: 520,
    backgroundColor: '#05080d', show: false, autoHideMenuBar: true, title: 'Jarvis', icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
}

function createTray() {
  const img = nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Jarvis');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Apri Jarvis', click: showWindow },
    { label: 'Cerca aggiornamenti', click: () => checkUpdates(true) },
    { type: 'separator' },
    { label: 'Esci', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', () => (win && win.isVisible() && win.isFocused()) ? win.hide() : showWindow());
}

// ---------------- impostazioni di sistema ----------------
function applyAutostart() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.get().settings.autostart, args: ['--hidden'] });
}

function applyHotkey(oldKey) {
  if (oldKey) try { globalShortcut.unregister(oldKey); } catch {}
  const key = store.get().settings.hotkey || 'Alt+J';
  try {
    const ok = globalShortcut.register(key, () => (win && win.isVisible() && win.isFocused()) ? win.hide() : showWindow());
    if (!ok) console.warn('Scorciatoia occupata', key);
    return ok;
  } catch { return false; }
}

// ---------------- promemoria ----------------
function checkReminders() {
  const s = store.get();
  const now = Date.now();
  let changed = false;
  for (const r of s.reminders) {
    if (!r.done && new Date(r.when).getTime() <= now) {
      r.done = true; changed = true;
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Jarvis — Promemoria', body: r.text, icon: ICON });
        n.on('click', showWindow); n.show();
      }
      send('reminder:fire', r);
    }
  }
  if (changed) {
    s.reminders = s.reminders.filter(r => !r.done || now - new Date(r.when).getTime() < 7 * 864e5);
    store.save(); send('state:changed');
  }
}

// ---------------- aggiornamenti ----------------
function setUpdate(status, detail = '') { updateState = { status, detail }; send('update:status', updateState); }

function configureUpdater() {
  if (!autoUpdater || !app.isPackaged) return false;
  const repo = (store.get().settings.updateRepo || DEFAULT_UPDATE_REPO || '').trim();
  const m = repo.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  const builtIn = require('fs').existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  if (m) autoUpdater.setFeedURL({ provider: 'github', owner: m[1], repo: m[2], releaseType: 'release' });
  else if (!builtIn) { setUpdate('off', 'Canale aggiornamenti non impostato'); return false; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  return true;
}

let updaterWired = false;
function checkUpdates(manual = false) {
  if (!configureUpdater()) { if (manual) showWindow(); return; }
  if (!updaterWired) {
    updaterWired = true;
    autoUpdater.on('checking-for-update', () => setUpdate('checking', 'Controllo aggiornamenti…'));
    autoUpdater.on('update-available', i => setUpdate('downloading', `Scarico la versione ${i.version}…`));
    autoUpdater.on('update-not-available', () => setUpdate('latest', 'Sei aggiornato'));
    autoUpdater.on('download-progress', p => setUpdate('downloading', `Scarico aggiornamento… ${Math.round(p.percent)}%`));
    autoUpdater.on('update-downloaded', i => {
      setUpdate('ready', `Versione ${i.version} pronta`);
      if (Notification.isSupported()) new Notification({ title: 'Jarvis', body: `Aggiornamento ${i.version} pronto: riavviami per installarlo.`, icon: ICON }).show();
    });
    autoUpdater.on('error', e => setUpdate('error', 'Errore aggiornamento: ' + (e?.message || e).toString().slice(0, 160)));
  }
  autoUpdater.checkForUpdates().catch(e => setUpdate('error', String(e?.message || e).slice(0, 160)));
}

// ---------------- IPC ----------------
function publicState() {
  const s = store.get();
  return {
    name: s.name, facts: s.facts, messages: s.messages.slice(-60), totalMsgs: s.totalMsgs,
    reminders: s.reminders.filter(r => !r.done), upgrades: s.upgrades,
    settings: s.settings, hasKey: !!store.getApiKey(), version: app.getVersion(),
    dataFile: store.FILE(), update: updateState, packaged: app.isPackaged
  };
}

ipcMain.handle('state:get', () => publicState());

ipcMain.handle('chat:send', async (_e, payload) => {
  const text = typeof payload === 'string' ? payload : payload?.text;
  const spoken = typeof payload === 'object' && !!payload?.spoken;
  try {
    const answer = await brain.chat(String(text || ''), {
      onDelta: d => send('chat:delta', d),
      onNote: (t, kind) => send('chat:note', { text: t, kind }),
      onChanged: () => send('state:changed'),
      confirm: (title, detail, danger) => new Promise(resolve => {
        const id = store.newId('c');
        pendingConfirms.set(id, resolve);
        if (win && !win.isVisible()) showWindow();
        send('confirm:ask', { id, title, detail, danger: !!danger });
      })
    }, app.getVersion(), { spoken });
    return { ok: true, answer };
  } catch (e) {
    let msg = String(e?.message || e);
    if (msg === 'NO_KEY') msg = 'Manca la chiave API: aprila nelle Impostazioni.';
    else if (e?.status === 401) msg = 'Chiave API non valida. Controllala nelle Impostazioni.';
    else if (e?.status === 429) msg = 'Troppe richieste o credito esaurito: attendi un attimo o controlla il credito su console.anthropic.com.';
    else if (e?.status === 529 || e?.status === 503) msg = 'I server di Claude sono sovraccarichi: riprova tra poco.';
    else if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) msg = 'Nessuna connessione a internet.';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('chat:stop', () => brain.stop());
ipcMain.handle('confirm:answer', (_e, { id, ok }) => { const r = pendingConfirms.get(id); if (r) { pendingConfirms.delete(id); r(!!ok); } });

ipcMain.handle('memory:forget', (_e, id) => { const s = store.get(); s.facts = s.facts.filter(f => f.id !== id); store.save(); return publicState(); });
ipcMain.handle('memory:add', (_e, text) => {
  text = String(text || '').trim(); if (!text) return publicState();
  store.get().facts.push({ id: store.newId('m'), text, cat: 'istruzioni', at: new Date().toISOString() }); store.save(); return publicState();
});
ipcMain.handle('reminder:cancel', (_e, id) => { const s = store.get(); s.reminders = s.reminders.filter(r => r.id !== id); store.save(); return publicState(); });
ipcMain.handle('upgrades:clear', () => { store.get().upgrades = []; store.save(); return publicState(); });
ipcMain.handle('chat:clear', () => { store.get().messages = []; store.save(); return publicState(); });
ipcMain.handle('state:wipe', () => {
  const s = store.get(); const keep = { settings: s.settings, apiKeyEnc: s.apiKeyEnc };
  Object.assign(s, JSON.parse(JSON.stringify(store.DEFAULTS)), keep); store.save(); return publicState();
});

ipcMain.handle('settings:set', (_e, patch) => {
  const s = store.get();
  if (typeof patch.apiKey === 'string') store.setApiKey(patch.apiKey);
  const oldHotkey = s.settings.hotkey;
  const allowed = ['model', 'autostart', 'voice', 'voiceName', 'webSearch', 'hotkey', 'updateRepo', 'listen', 'sttModel', 'ttsVoice', 'ttsRate', 'followUp'];
  for (const k of allowed) if (k in patch) s.settings[k] = patch[k];
  store.save();
  if ('autostart' in patch) applyAutostart();
  let hotkeyOk = true;
  if ('hotkey' in patch && patch.hotkey !== oldHotkey) hotkeyOk = applyHotkey(oldHotkey);
  if ('updateRepo' in patch) checkUpdates();
  if ('sttModel' in patch) stt.setModel(patch.sttModel);
  return { ...publicState(), hotkeyOk };
});

ipcMain.handle('update:check', () => { checkUpdates(true); return updateState; });
ipcMain.handle('update:install', () => { if (autoUpdater && updateState.status === 'ready') { quitting = true; store.flush(); autoUpdater.quitAndInstall(false, true); } });
ipcMain.handle('open:external', (_e, url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); });
ipcMain.handle('open:dataFolder', () => shell.showItemInFolder(store.FILE()));

// ---------------- voce e ascolto ----------------
ipcMain.handle('tts:voices', () => ({ voices: voice.VOICES, def: voice.DEFAULT_VOICE }));
ipcMain.handle('tts:synth', async (_e, text) => {
  const s = store.get().settings;
  try {
    const buf = await voice.synth(String(text || '').slice(0, 3000), { voice: s.ttsVoice || voice.DEFAULT_VOICE, rate: s.ttsRate || '-4%' });
    return { ok: true, audio: new Uint8Array(buf) };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
ipcMain.handle('stt:init', () => stt.init(store.get().settings.sttModel || 'small', {
  progress: st => send('stt:status', st), ready: st => send('stt:status', st), error: st => send('stt:status', st)
}));
ipcMain.handle('stt:transcribe', async (_e, audio) => {
  try { const r = await stt.transcribe(audio); return { ok: true, text: r.text, ms: r.ms }; }
  catch (e) { return { ok: false, error: String(e?.message || e) }; }
});
ipcMain.handle('stt:stop', () => stt.stop());
ipcMain.handle('ui:wake', () => { if (win && !win.isVisible()) win.showInactive(); });

// ---------------- avvio ----------------
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; store.flush(); stt.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* resta attivo nella barra di sistema */ });

app.whenReady().then(() => {
  store.load();
  Menu.setApplicationMenu(null);
  const media = p => p === 'media' || p === 'audioCapture' || p === 'speaker-selection';
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(media(perm) || perm === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => media(perm) || perm === 'clipboard-sanitized-write');
  createWindow(!process.argv.includes('--hidden'));
  createTray();
  applyAutostart();
  applyHotkey();
  setInterval(checkReminders, 20 * 1000); checkReminders();
  setTimeout(() => checkUpdates(), 5000);
  setInterval(() => { if (updateState.status !== 'ready') checkUpdates(); }, 60 * 60 * 1000);
});
