// Orecchie di Jarvis: microfono sempre attivo, rilevamento della voce (VAD) e parola di attivazione "Jarvis".
// L'audio viene trascritto in locale (Whisper) solo quando qualcuno parla.
(() => {
  const SR = 16000;
  const CHUNK = 2048;                 // 128 ms a 16 kHz
  const PRE_ROLL = 3;                 // blocchi tenuti prima dell'inizio del parlato
  const END_SILENCE_MS = 750;
  const MIN_SPEECH_MS = 350;
  const MAX_UTTERANCE_MS = 15000;

  // varianti con cui Whisper può scrivere "Jarvis"
  const WAKE = /\b(j|g|gi|ch|dj|y|h)[ae]r?[vbw][iy]s+e?\b/i;
  const STRICT_WAKE = /\b(jarvis|giarvis|jarvi|jervis|gervis|jarbis|giarvi|charvis|jarviss|jarvys|jarwis|giarbis|jarves|harvis|jarvice|jarvise)\b/i;
  const STOP_WORDS = /\b(basta|stop|fermati|zitto|silenzio|smettila|ferma)\b/i;
  // frasi che Whisper "inventa" sul rumore
  const HALLUCINATIONS = /^\W*(sottotitoli\b.*|.*amara\.org.*|grazie per la visione.*|grazie a tutti per la visione.*|iscriviti al canale.*|musica|applausi|risate|silenzio|grazie\.?)\W*$|^\s*[\[(].*[\])]\s*$|^\W*$/i;

  const ears = {
    enabled: false, state: 'off', stream: null, ctx: null, node: null,
    onCommand: () => {}, onWake: () => {}, onStop: () => {}, onState: () => {}, onHeard: () => {},
    busy: () => false,          // Jarvis sta pensando
    speaking: () => false,      // Jarvis sta parlando
    awaitUntil: 0,              // fino a quando accetta un comando senza dire "Jarvis"
    followUpMs: 6000
  };

  let noise = 0.004, speaking = false, buf = [], pre = [], silentMs = 0, speechMs = 0, queue = Promise.resolve();

  function setState(s, detail = '') { ears.state = s; ears.onState(s, detail); }

  function rms(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }

  function onChunk(input) {
    const chunk = new Float32Array(input);
    const level = rms(chunk);
    const ms = chunk.length / SR * 1000;
    const threshold = Math.max(noise * 3.2, 0.012);
    if (!speaking) {
      pre.push(chunk); if (pre.length > PRE_ROLL) pre.shift();
      if (level > threshold) { speaking = true; buf = [...pre]; pre = []; silentMs = 0; speechMs = 0; }
      else noise = noise * 0.97 + level * 0.03;
      return;
    }
    buf.push(chunk);
    speechMs += ms;
    if (level < threshold * 0.75) silentMs += ms; else silentMs = 0;
    if (silentMs >= END_SILENCE_MS || speechMs >= MAX_UTTERANCE_MS) {
      speaking = false;
      const voiced = speechMs - silentMs;
      const audio = concat(buf); buf = [];
      if (voiced >= MIN_SPEECH_MS) queue = queue.then(() => handleUtterance(audio)).catch(() => {});
    }
  }

  function concat(chunks) {
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  function extractCommand(text) {
    const m = text.match(STRICT_WAKE) || text.match(WAKE);
    if (!m) return null;
    return text.slice(m.index + m[0].length).replace(/^[\s,.!?;:\-–]+/, '').trim();
  }

  async function handleUtterance(audio) {
    if (!ears.enabled) return;
    const jarvisTalking = ears.speaking();
    const res = await window.jarvis.transcribe(audio);
    if (!res.ok) { ears.onHeard('', res.error); return; }
    const text = res.text.replace(/\s+/g, ' ').trim();
    if (!text || HALLUCINATIONS.test(text)) return;
    ears.onHeard(text);

    const hasWake = STRICT_WAKE.test(text) || WAKE.test(text);

    // mentre Jarvis parla: solo "Jarvis, basta/stop" lo interrompe
    if (jarvisTalking) {
      if (hasWake && STOP_WORDS.test(text)) ears.onStop();
      else if (STOP_WORDS.test(text) && text.split(' ').length <= 3) ears.onStop();
      return;
    }
    if (ears.busy()) return;

    if (hasWake) {
      const cmd = extractCommand(text);
      if (cmd && cmd.replace(/\W/g, '').length > 2) { ears.awaitUntil = 0; ears.onCommand(cmd); }
      else { ears.awaitUntil = Date.now() + 8000; ears.onWake(); }
      return;
    }
    if (Date.now() < ears.awaitUntil) { ears.awaitUntil = 0; ears.onCommand(text); }
  }

  ears.start = async function () {
    if (ears.enabled) return true;
    try {
      ears.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      setState('error', 'Microfono non disponibile: controlla Impostazioni di Windows › Privacy › Microfono (“Consenti alle app desktop”).');
      return false;
    }
    ears.ctx = new AudioContext({ sampleRate: SR });
    const src = ears.ctx.createMediaStreamSource(ears.stream);
    ears.node = ears.ctx.createScriptProcessor(CHUNK, 1, 1);
    ears.node.onaudioprocess = e => { if (ears.enabled) onChunk(e.inputBuffer.getChannelData(0)); };
    const mute = ears.ctx.createGain(); mute.gain.value = 0;
    src.connect(ears.node); ears.node.connect(mute); mute.connect(ears.ctx.destination);
    ears.enabled = true;
    setState('listening');
    return true;
  };

  ears.stop = function () {
    ears.enabled = false; speaking = false; buf = []; pre = [];
    try { ears.node?.disconnect(); } catch {}
    try { ears.stream?.getTracks().forEach(t => t.stop()); } catch {}
    try { ears.ctx?.close(); } catch {}
    ears.stream = ears.ctx = ears.node = null;
    setState('off');
  };

  /** Dopo una risposta di Jarvis: per qualche secondo accetta una domanda senza dire "Jarvis". */
  ears.openFollowUp = function () { if (ears.followUpMs > 0) ears.awaitUntil = Date.now() + ears.followUpMs; };

  // esposto per i test
  ears._extractCommand = extractCommand;
  ears._wake = t => STRICT_WAKE.test(t) || WAKE.test(t);

  window.JarvisEars = ears;
})();
