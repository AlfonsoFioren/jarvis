// Gestore del processo di riconoscimento vocale.
const { utilityProcess, app } = require('electron');
const path = require('path');

let child = null;
let seq = 0;
const pending = new Map();
let listeners = { progress: () => {}, ready: () => {}, error: () => {} };
let model = 'small';
let state = { status: 'off', detail: '' };

const cacheDir = () => path.join(app.getPath('userData'), 'models');

function start() {
  if (child) return child;
  child = utilityProcess.fork(path.join(__dirname, 'stt-worker.js'), [], { serviceName: 'Jarvis ascolto', stdio: 'inherit' });
  child.on('message', m => {
    if (m.type === 'progress') { state = { status: 'downloading', detail: `Scarico il modulo di ascolto (${m.mb} MB, solo la prima volta)… ${m.percent}%` }; listeners.progress(state); }
    else if (m.type === 'ready') { state = { status: 'ready', detail: '' }; listeners.ready(state); }
    else if (m.type === 'result' || (m.type === 'error' && m.id != null)) {
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      m.type === 'result' ? p.resolve(m) : p.reject(new Error(m.error));
    } else if (m.type === 'error') { state = { status: 'error', detail: 'Modulo di ascolto non disponibile: ' + m.error }; listeners.error(state); }
  });
  child.on('exit', () => {
    child = null;
    for (const p of pending.values()) p.reject(new Error('processo di ascolto terminato'));
    pending.clear();
    if (state.status !== 'off') { state = { status: 'error', detail: 'Modulo di ascolto riavviato' }; listeners.error(state); }
  });
  return child;
}

function init(m, l) {
  if (l) listeners = { ...listeners, ...l };
  if (m) model = m;
  if (state.status === 'ready' || state.status === 'loading' || state.status === 'downloading') {
    if (state.status === 'ready') listeners.ready(state);
    return state;
  }
  state = { status: 'loading', detail: 'Preparo il modulo di ascolto…' };
  start().postMessage({ type: 'init', cacheDir: cacheDir(), model });
  return state;
}

function transcribe(audio) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    start().postMessage({ type: 'transcribe', id, audio, cacheDir: cacheDir(), model });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout trascrizione')); } }, 60000);
  });
}

function setModel(m) {
  if (m === model) return;
  model = m;
  if (child) { state = { status: 'off', detail: '' }; child.kill(); child = null; }
}

function stop() { state = { status: 'off', detail: '' }; if (child) { child.kill(); child = null; } }

module.exports = { init, transcribe, setModel, stop, getState: () => state };
