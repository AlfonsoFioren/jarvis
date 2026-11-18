// Riconoscimento vocale locale (Whisper) in un processo separato, così l'interfaccia resta fluida.
// Il modello si scarica una sola volta (prima volta) e poi funziona offline, sul PC dell'utente.
const path = require('path');

const MODELS = {
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small'
};

let transcriber = null;
let loading = null;
let loadedKey = null;

const port = process.parentPort;
const post = m => port ? port.postMessage(m) : process.send?.(m);

async function load(cacheDir, key) {
  if (transcriber && loadedKey === key) return transcriber;
  if (loading && loadedKey === key) return loading;
  loadedKey = key;
  loading = (async () => {
    const { pipeline, env } = require('@huggingface/transformers');
    env.cacheDir = cacheDir;
    env.allowLocalModels = false;
    const files = {};
    const t = await pipeline('automatic-speech-recognition', MODELS[key] || MODELS.small, {
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      device: 'cpu',
      progress_callback: p => {
        if (p.status === 'progress' && p.total) {
          files[p.file] = { loaded: p.loaded, total: p.total };
          const tot = Object.values(files).reduce((a, f) => a + f.total, 0);
          const got = Object.values(files).reduce((a, f) => a + f.loaded, 0);
          post({ type: 'progress', percent: Math.round(got / tot * 100), mb: Math.round(tot / 1048576) });
        }
      }
    });
    // riscaldamento: la prima inferenza è sempre più lenta
    await t(new Float32Array(16000), { language: 'italian', task: 'transcribe' }).catch(() => {});
    transcriber = t;
    return t;
  })();
  try { return await loading; }
  catch (e) { transcriber = null; loading = null; loadedKey = null; throw e; }
}

async function handle(msg) {
  try {
    if (msg.type === 'init') {
      await load(msg.cacheDir, msg.model);
      post({ type: 'ready', model: loadedKey });
    } else if (msg.type === 'transcribe') {
      const t = await load(msg.cacheDir, msg.model);
      const audio = msg.audio instanceof Float32Array ? msg.audio : new Float32Array(msg.audio);
      const started = Date.now();
      const out = await t(audio, { language: 'italian', task: 'transcribe' });
      post({ type: 'result', id: msg.id, text: String(out?.text || '').trim(), ms: Date.now() - started });
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, error: String(e?.message || e) });
  }
}

if (port) port.on('message', e => handle(e.data));
else process.on('message', handle);

module.exports = { load, MODELS };
