// Memoria permanente di Jarvis: un file JSON nella cartella dati dell'utente.
// La chiave API è cifrata con il portachiavi di Windows (safeStorage / DPAPI).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = () => path.join(app.getPath('userData'), 'jarvis-data.json');

const DEFAULTS = {
  name: '',
  facts: [],            // { id, text, cat, at }
  messages: [],         // { role: 'user'|'assistant', content, at }
  totalMsgs: 0,
  reminders: [],        // { id, when, text, done }
  upgrades: [],         // { id, text, at }
  settings: {
    model: 'claude-sonnet-5-5',
    autostart: true,
    voice: false,
    voiceName: '',
    webSearch: true,
    hotkey: 'Alt+J',
    updateRepo: ''      // "utente/repo" su GitHub
  },
  apiKeyEnc: ''
};

let data = null;
let timer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    data = { ...DEFAULTS, ...raw, settings: { ...DEFAULTS.settings, ...(raw.settings || {}) } };
  } catch {
    data = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return data;
}

function get() { return data || load(); }

function writeNow() {
  const f = FILE();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { writeNow(); } catch (e) { console.error('save', e); } }, 300);
}

function flush() { clearTimeout(timer); try { writeNow(); } catch (e) { console.error('flush', e); } }

function setApiKey(key) {
  key = String(key || '').trim();
  if (!key) { get().apiKeyEnc = ''; save(); return; }
  if (safeStorage.isEncryptionAvailable()) {
    get().apiKeyEnc = 'enc:' + safeStorage.encryptString(key).toString('base64');
  } else {
    get().apiKeyEnc = 'raw:' + Buffer.from(key).toString('base64');
  }
  save();
}

function getApiKey() {
  const v = get().apiKeyEnc || '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString();
  } catch (e) { console.error('apikey', e); }
  return process.env.ANTHROPIC_API_KEY || '';
}

const newId = (p = 'm') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

module.exports = { load, get, save, flush, setApiKey, getApiKey, newId, DEFAULTS, FILE };
