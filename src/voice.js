// Voce di Jarvis: voci neurali italiane di Microsoft (le stesse di "Leggi ad alta voce" di Edge).
// Gratuite, nessuna chiave. Se il servizio non risponde, l'interfaccia usa le voci di Windows.
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const VOICES = [
  { id: 'it-IT-GiuseppeMultilingualNeural', label: 'Giuseppe — maschile, caldo e naturale (consigliata)' },
  { id: 'it-IT-DiegoNeural', label: 'Diego — maschile, profondo e pacato' },
  { id: 'it-IT-IsabellaNeural', label: 'Isabella — femminile, morbida' },
  { id: 'it-IT-ElsaNeural', label: 'Elsa — femminile, chiara' }
];
const DEFAULT_VOICE = VOICES[0].id;

let tts = null;
let currentVoice = null;
let queue = Promise.resolve();

async function ensure(voice) {
  if (tts && currentVoice === voice) return tts;
  try { tts?.close(); } catch {}
  tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  currentVoice = voice;
  return tts;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function collect(stream, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const t = setTimeout(() => reject(new Error('timeout sintesi vocale')), timeoutMs);
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    stream.on('close', () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    stream.on('error', e => { clearTimeout(t); reject(e); });
  });
}

async function synthOnce(text, voice, rate, pitch) {
  const engine = await ensure(voice);
  const { audioStream } = engine.toStream(escapeXml(text), { rate, pitch });
  const buf = await collect(audioStream);
  if (!buf.length) throw new Error('audio vuoto');
  return buf;
}

/** Restituisce un Buffer MP3. Le richieste sono serializzate su un'unica connessione. */
function synth(text, { voice = DEFAULT_VOICE, rate = '-4%', pitch = '-2Hz' } = {}) {
  const job = queue.then(async () => {
    try { return await synthOnce(text, voice, rate, pitch); }
    catch (e) {
      // connessione caduta: riprova una volta con una connessione nuova
      tts = null; currentVoice = null;
      return await synthOnce(text, voice, rate, pitch);
    }
  });
  queue = job.catch(() => {});
  return job;
}

module.exports = { synth, VOICES, DEFAULT_VOICE };
