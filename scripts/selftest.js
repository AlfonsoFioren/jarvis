// Test automatico eseguito su Windows in GitHub Actions:
// 1) la voce neurale sintetizza una frase  2) Whisper la trascrive  3) si verifica che "Jarvis" venga riconosciuto.
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  const report = {};
  const t0 = Date.now();
  const { MsEdgeTTS } = require('msedge-tts');
  try {
    const voices = await new MsEdgeTTS().getVoices();
    report.voci_italiane = voices.filter(v => v.Locale === 'it-IT').map(v => v.ShortName);
  } catch (e) { report.voci_errore = String(e.message || e); }

  const voice = require('../src/voice');
  const phrase = 'Jarvis, apri il browser e ricordami di chiamare Marco domani mattina.';
  let mp3;
  for (const v of voice.VOICES) {
    try {
      const b = await voice.synth('Prova voce.', { voice: v.id });
      report['voce_' + v.id] = 'ok ' + b.length + ' byte';
    } catch (e) { report['voce_' + v.id] = 'ERRORE ' + (e.message || e); }
  }
  mp3 = await voice.synth(phrase, { voice: voice.DEFAULT_VOICE });
  report.tts_ms = Date.now() - t0;
  fs.writeFileSync(path.join(os.tmpdir(), 'jarvis-test.mp3'), mp3);

  const { MPEGDecoder } = require('mpg123-decoder');
  const dec = new MPEGDecoder(); await dec.ready;
  const { channelData, sampleRate } = dec.decode(new Uint8Array(mp3));
  dec.free();
  const src = channelData[0];
  const ratio = sampleRate / 16000;
  const pcm = new Float32Array(Math.floor(src.length / ratio));
  for (let i = 0; i < pcm.length; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    pcm[i] = (src[i0] || 0) * (1 - f) + (src[i0 + 1] || 0) * f;
  }
  report.audio_secondi = +(pcm.length / 16000).toFixed(2);

  const { load } = require('../src/stt-worker');
  for (const model of ['base', 'small']) {
    const t1 = Date.now();
    const t = await load(path.join(os.tmpdir(), 'jarvis-models'), model);
    report[model + '_caricamento_ms'] = Date.now() - t1;
    const t2 = Date.now();
    const out = await t(pcm, { language: 'italian', task: 'transcribe' });
    report[model + '_trascrizione_ms'] = Date.now() - t2;
    report[model + '_testo'] = out.text;
  }

  global.window = { jarvis: {} }; global.navigator = {};
  require('../renderer/listen.js');
  for (const model of ['base', 'small']) {
    const txt = report[model + '_testo'] || '';
    report[model + '_wake'] = window.JarvisEars._wake(txt);
    report[model + '_comando'] = window.JarvisEars._extractCommand(txt);
  }
  console.log('SELFTEST ' + JSON.stringify(report, null, 2));
  if (!report.small_wake) { console.error('Parola di attivazione NON riconosciuta'); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('SELFTEST FALLITO', e); process.exit(1); });
