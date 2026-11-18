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

  // Altre frasi, due voci diverse, modello "small" (quello predefinito)
  const toPcm = async buf => {
    const d = new MPEGDecoder(); await d.ready;
    const { channelData, sampleRate } = d.decode(new Uint8Array(buf)); d.free();
    const s0 = channelData[0], r = sampleRate / 16000, o = new Float32Array(Math.floor(s0.length / r));
    for (let i = 0; i < o.length; i++) { const x = i * r, i0 = Math.floor(x), f = x - i0; o[i] = (s0[i0] || 0) * (1 - f) + (s0[i0 + 1] || 0) * f; }
    return o;
  };
  const small = await load(path.join(os.tmpdir(), 'jarvis-models'), 'small');
  const frasi = ['Ehi Jarvis, che tempo fa oggi?', 'Jarvis.', 'Jarvis, apri Spotify.', 'Ok Jarvis, scrivi una mail a Luca.'];
  let ok = 0, tot = 0;
  report.frasi = [];
  for (const v of ['it-IT-DiegoNeural', 'it-IT-IsabellaNeural']) for (const f of frasi) {
    const pcmF = await toPcm(await voice.synth(f, { voice: v }));
    const out = await small(pcmF, { language: 'italian', task: 'transcribe' });
    const w = window.JarvisEars._wake(out.text);
    tot++; if (w) ok++;
    report.frasi.push(`${w ? 'OK ' : 'NO '} [${v.split('-')[2]}] «${f}» → «${out.text.trim()}» → comando: «${window.JarvisEars._extractCommand(out.text) ?? ''}»`);
  }
  report.riconoscimento = `${ok}/${tot}`;
  report.small_wake = report.small_wake && ok >= tot - 1;
  console.log('SELFTEST ' + JSON.stringify(report, null, 2));
  if (!report.small_wake) { console.error('Parola di attivazione NON riconosciuta'); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('SELFTEST FALLITO', e); process.exit(1); });
