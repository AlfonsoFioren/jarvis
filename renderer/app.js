(() => {
  const J = window.jarvis;
  const $ = id => document.getElementById(id);
  const log = $('log'), input = $('input'), reactor = $('reactor');
  let st = null, busy = false, voiceOn = false, liveBody = null, liveText = '';

  // ---------- testo / markdown minimo e sicuro ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  }
  function md(src) {
    const parts = String(src).split(/```(\w*)\n?([\s\S]*?)(?:```|$)/g);
    let html = '';
    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 0) {
        const blocks = parts[i].split(/\n{2,}/);
        for (const b of blocks) {
          if (!b.trim()) continue;
          const lines = b.split('\n');
          if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l) || !l.trim())) {
            const ordered = /^\s*\d/.test(lines[0]);
            html += (ordered ? '<ol>' : '<ul>') + lines.filter(l => l.trim()).map(l => '<li>' + inline(esc(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))) + '</li>').join('') + (ordered ? '</ol>' : '</ul>');
          } else {
            html += '<p>' + lines.map(l => inline(esc(l.replace(/^#{1,6}\s+/, '')))).join('<br>') + '</p>';
          }
        }
      } else if (i % 3 === 2) {
        html += '<pre><button class="ghost small copy">Copia</button><code>' + esc(parts[i]) + '</code></pre>';
      }
    }
    return html;
  }
  const plain = s => String(s).replace(/```[\s\S]*?```/g, ' (codice sullo schermo) ').replace(/[*_`#>]/g, '').replace(/https?:\/\/\S+/g, 'link');

  // ---------- chat UI ----------
  function scroll() { log.scrollTop = log.scrollHeight; }
  function addMsg(role, text) {
    log.querySelector('.empty')?.remove();
    const d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'u' : 'j');
    if (role === 'user') d.textContent = text;
    else { d.innerHTML = '<div class="who">JARVIS</div><div class="body"></div>'; d.querySelector('.body').innerHTML = md(text); }
    log.appendChild(d); scroll();
    return d.querySelector('.body') || d;
  }
  function addNote(text, kind = '') {
    const d = document.createElement('div'); d.className = 'note ' + kind; d.textContent = text;
    log.appendChild(d); scroll();
  }
  function renderEmpty() {
    log.innerHTML = `<div class="empty"><div class="reactor big"></div>
      <p><b>${st?.name ? 'Bentornato, ' + esc(st.name) + '.' : 'Buongiorno. Sono Jarvis.'}</b></p>
      <p>Vivo sul tuo PC e imparo da ogni conversazione. Posso aprire programmi e siti, gestire file, ricordarti le cose, cercare sul web e aiutarti a ragionare su qualsiasi cosa.</p>
      <p style="font-size:13px">Prova: <i>"Mi chiamo… e lavoro su…"</i> · <i>"Apri Chrome"</i> · <i>"Ricordami alle 18 di chiamare Marco"</i></p>
      <p style="font-size:12px">Scorciatoia: <b>${esc(st?.settings?.hotkey || 'Alt+J')}</b> da qualsiasi programma</p></div>`;
  }
  function renderChat() {
    log.innerHTML = '';
    if (!st.messages.length) renderEmpty();
    else st.messages.forEach(m => addMsg(m.role, m.content));
  }

  // ---------- pannello ----------
  function itemEl(title, sub, onDel) {
    const el = document.createElement('div'); el.className = 'item';
    el.innerHTML = '<span class="t"><span class="cat"></span></span>' + (onDel ? '<button title="Elimina">✕</button>' : '');
    el.querySelector('.cat').textContent = sub || '';
    el.querySelector('.t').append(document.createTextNode(title));
    if (onDel) el.querySelector('button').onclick = onDel;
    return el;
  }
  function renderPanel() {
    const mem = $('mem'); mem.innerHTML = '';
    if (!st.facts.length) mem.innerHTML = '<p class="hint">Ancora nessun ricordo. Raccontami qualcosa di te.</p>';
    [...st.facts].reverse().forEach(f => mem.appendChild(itemEl(f.text, f.cat, async () => { st = await J.forget(f.id); renderPanel(); })));
    $('sFacts').textContent = st.facts.length;
    $('sMsgs').textContent = st.totalMsgs;
    $('sLevel').textContent = 1 + Math.floor(Math.sqrt(st.facts.length * 4 + st.totalMsgs / 5));

    const rem = $('rem'); rem.innerHTML = '';
    if (!st.reminders.length) rem.innerHTML = '<p class="hint">Nessun promemoria attivo.</p>';
    st.reminders.slice().sort((a, b) => a.when.localeCompare(b.when)).forEach(r =>
      rem.appendChild(itemEl(r.text, new Date(r.when).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }), async () => { st = await J.cancelReminder(r.id); renderPanel(); })));

    const evo = $('evo'); evo.innerHTML = '';
    if (!st.upgrades.length) evo.innerHTML = '<p class="hint">Nessuna richiesta. Quando chiedi a Jarvis qualcosa che non sa ancora fare, finisce qui.</p>';
    st.upgrades.forEach(u => evo.appendChild(itemEl(u.text, new Date(u.at).toLocaleDateString('it-IT'))));

    const s = st.settings;
    $('model').value = s.model; $('webSearch').checked = s.webSearch; $('autostart').checked = s.autostart;
    if (document.activeElement !== $('hotkey')) $('hotkey').value = s.hotkey;
    if (document.activeElement !== $('updateRepo')) $('updateRepo').value = s.updateRepo || '';
    $('apiKey').placeholder = st.hasKey ? '•••••••• (chiave salvata)' : 'sk-ant-…';
    $('ver').textContent = `Jarvis v${st.version} · dati in ${st.dataFile}`;
    voiceOn = !!s.voice; $('voiceBtn').classList.toggle('on', voiceOn);
    $('ttsVoice').value = s.ttsVoice; $('ttsRate').value = s.ttsRate; $('listen').checked = !!s.listen;
    $('followUp').checked = !!s.followUp; $('sttModel').value = s.sttModel;
    renderUpdate(st.update);
  }
  function renderUpdate(u) {
    if (!u) return;
    $('updInfo').textContent = u.detail || '';
    const ready = u.status === 'ready';
    $('updateBar').hidden = !ready;
    if (ready) $('updateText').textContent = '✦ ' + u.detail + ': nuove capacità in arrivo.';
  }
  async function refresh(full = false) {
    st = await J.getState();
    if (full) renderChat();
    renderPanel();
    $('onboard').classList.toggle('open', !st.hasKey);
  }

  // ---------- voce (neurale, frase per frase) ----------
  const speaker = (() => {
    let items = [], playing = false, audio = null, gen = 0, onIdle = null;
    const sysVoice = () => speechSynthesis.getVoices().find(v => /^it/i.test(v.lang));
    function fallback(text) {
      return new Promise(res => {
        const u = new SpeechSynthesisUtterance(text);
        const v = sysVoice(); if (v) u.voice = v; u.lang = 'it-IT';
        u.onend = u.onerror = res; speechSynthesis.speak(u);
      });
    }
    async function loop(myGen) {
      playing = true; setVisual();
      while (items.length && myGen === gen) {
        const it = items.shift();
        const res = await it.audio;
        if (myGen !== gen) break;
        if (res && res.ok) {
          await new Promise(resolve => {
            const url = URL.createObjectURL(new Blob([res.audio], { type: 'audio/mpeg' }));
            audio = new Audio(url);
            audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
            audio.play().catch(resolve);
          });
        } else await fallback(it.text);
      }
      if (myGen === gen) { playing = false; audio = null; setVisual(); const f = onIdle; onIdle = null; f && f(); }
    }
    return {
      say(text) {
        text = plain(text).replace(/\s+/g, ' ').trim();
        if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
        items.push({ text, audio: J.synth(text) });   // la sintesi parte subito, in parallelo alla riproduzione
        if (!playing) loop(gen);
      },
      stop() { gen++; items = []; playing = false; onIdle = null; try { audio?.pause(); } catch {} speechSynthesis.cancel(); setVisual(); },
      isSpeaking: () => playing,
      whenIdle(fn) { if (!playing && !items.length) fn(); else onIdle = fn; }
    };
  })();

  // Divide il testo in arrivo in frasi complete da leggere appena pronte.
  const chunker = {
    idx: 0, on: false,
    reset(on) { this.idx = 0; this.on = on; },
    feed(full, final = false) {
      if (!this.on) return;
      for (let guard = 0; guard < 50; guard++) {
        const rest = full.slice(this.idx);
        if (!rest) return;
        if (rest.startsWith('```')) {                     // salta i blocchi di codice
          const close = rest.indexOf('```', 3);
          if (close < 0) return;
          this.idx += close + 3; continue;
        }
        const fence = rest.indexOf('```');
        const scope = fence >= 0 ? rest.slice(0, fence) : rest;
        let cut = -1;
        if (fence >= 0 || final) cut = scope.length;
        else {
          const re = /[.!?…:;](?=\s)|\n/g; let m;
          while ((m = re.exec(scope))) if (m.index >= 25) cut = m.index + 1;
        }
        if (cut <= 0) { if (fence === 0) continue; return; }
        speaker.say(scope.slice(0, cut));
        this.idx += cut;
        if (fence < 0) return;
      }
    }
  };

  function setVisual() {
    reactor.classList.toggle('speaking', speaker?.isSpeaking?.() || false);
    reactor.classList.toggle('listening', !busy && JarvisEars.state === 'listening' && Date.now() < JarvisEars.awaitUntil);
  }

  function chime() {
    try {
      const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(660, c.currentTime); o.frequency.exponentialRampToValueAtTime(990, c.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.18, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.26); setTimeout(() => c.close(), 400);
    } catch {}
  }

  // ---------- invio ----------
  function setBusy(b) {
    busy = b; reactor.classList.toggle('busy', b);
    $('send').hidden = b; $('stop').hidden = !b;
    setStatus();
  }
  function setStatus(extra) {
    const model = ({ 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-haiku-5-5': 'Haiku 5.5' }[st?.settings?.model] || st?.settings?.model || '');
    let t;
    if (extra) t = extra;
    else if (busy) t = 'Elaboro…';
    else if (sttDetail) t = sttDetail;
    else if (JarvisEars.state === 'listening') t = Date.now() < JarvisEars.awaitUntil ? '🎙 Ti ascolto…' : 'In ascolto · dì «Jarvis» · ' + model;
    else t = 'Online · ' + model;
    $('status').textContent = t;
    $('earBtn').classList.toggle('on', JarvisEars.state === 'listening');
    $('mic').classList.toggle('live', JarvisEars.state === 'listening' && Date.now() < JarvisEars.awaitUntil);
    setVisual();
  }

  async function sendMsg(text, spoken = false) {
    text = text.trim(); if (!text || busy) return;
    if (!st.hasKey) { $('onboard').classList.add('open'); return; }
    speaker.stop();
    addMsg('user', (spoken ? '🎙 ' : '') + text);
    liveText = ''; liveBody = addMsg('assistant', ''); liveBody.classList.add('cursor');
    chunker.reset(spoken || voiceOn);
    setBusy(true);
    const res = await J.send(text, spoken);
    liveBody.classList.remove('cursor');
    if (res.ok) {
      liveBody.innerHTML = md(res.answer);
      // se lo streaming si è interrotto o non c'era, legge ciò che manca
      if (chunker.on) { if (!liveText) chunker.idx = 0; chunker.feed(liveText || res.answer, true); }
    } else { liveBody.closest('.msg').remove(); addNote('⚠ ' + res.error, 'err'); if (spoken) speaker.say('Mi dispiace, c\'è stato un problema. ' + res.error); }
    liveBody = null; setBusy(false);
    if (spoken && st.settings.followUp) speaker.whenIdle(() => { JarvisEars.openFollowUp(); setStatus(); });
    st = await J.getState(); renderPanel(); if (!spoken) input.focus();
  }

  J.onDelta(d => { if (!liveBody) return; liveText += d; liveBody.innerHTML = md(liveText); scroll(); chunker.feed(liveText); });
  J.onNote(({ text, kind }) => {
    if (liveBody) { const m = liveBody.closest('.msg'); const n = document.createElement('div'); n.className = 'note ' + (kind || ''); n.textContent = text; log.insertBefore(n, m); scroll(); }
    else addNote(text, kind);
  });
  J.onChanged(async () => { st = await J.getState(); renderPanel(); });
  J.onConfirm(({ id, title, detail, danger }) => {
    $('mTitle').textContent = title; $('mDetail').textContent = detail;
    $('mYes').className = 'ghost ' + (danger ? 'danger' : 'primary');
    $('modal').classList.add('open');
    const done = ok => { $('modal').classList.remove('open'); J.answerConfirm(id, ok); };
    $('mYes').onclick = () => done(true); $('mNo').onclick = () => done(false);
  });
  J.onReminder(r => { addNote('⏰ Promemoria: ' + r.text, 'learn'); speaker.say('Promemoria: ' + r.text); refresh(); });
  J.onUpdate(u => { if (st) st.update = u; renderUpdate(u); });
  J.onFocus(() => input.focus());

  $('form').addEventListener('submit', e => { e.preventDefault(); const t = input.value; input.value = ''; autosize(); sendMsg(t); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('form').requestSubmit(); } });
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; input.style.overflowY = input.scrollHeight > 180 ? 'auto' : 'hidden'; };
  input.addEventListener('input', autosize);
  $('stop').onclick = () => J.stop();
  log.addEventListener('click', e => {
    if (e.target.classList.contains('copy')) {
      navigator.clipboard.writeText(e.target.nextElementSibling.textContent).then(() => { e.target.textContent = 'Copiato'; setTimeout(() => e.target.textContent = 'Copia', 1200); });
    }
  });
  $('mic').onclick = async () => {
    if (JarvisEars.state !== 'listening') { await setListen(true); if (JarvisEars.state !== 'listening') return; }
    speaker.stop(); chime(); JarvisEars.awaitUntil = Date.now() + 8000; setStatus();
    setTimeout(setStatus, 8100);
  };
  $('earBtn').onclick = () => setListen(JarvisEars.state !== 'listening');

  // ---------- pannello: eventi ----------
  $('panelBtn').onclick = () => document.querySelector('.app').classList.toggle('nopanel');
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== 'tab-' + b.dataset.tab);
  });
  $('voiceBtn').onclick = async () => {
    voiceOn = !voiceOn; if (!voiceOn) speaker.stop();
    st = await J.setSettings({ voice: voiceOn }); renderPanel();
    addNote(voiceOn ? 'Risposte a voce attivate' : 'Risposte a voce disattivate');
  };
  $('addMem').onsubmit = async e => { e.preventDefault(); const t = $('addMemText').value; $('addMemText').value = ''; st = await J.addMemory(t); renderPanel(); };
  $('copyEvo').onclick = () => navigator.clipboard.writeText('Aggiorna Jarvis con queste capacità:\n' + st.upgrades.map(u => '- ' + u.text).join('\n'));
  $('clearEvo').onclick = async () => { st = await J.clearUpgrades(); renderPanel(); };
  $('saveKey').onclick = async () => { const k = $('apiKey').value.trim(); if (!k) return; $('apiKey').value = ''; st = await J.setSettings({ apiKey: k }); renderPanel(); addNote('Chiave API salvata'); };
  $('model').onchange = async e => { st = await J.setSettings({ model: e.target.value }); renderPanel(); setBusy(false); };
  $('webSearch').onchange = async e => { st = await J.setSettings({ webSearch: e.target.checked }); };
  $('autostart').onchange = async e => { st = await J.setSettings({ autostart: e.target.checked }); };
  $('ttsVoice').onchange = async e => { st = await J.setSettings({ ttsVoice: e.target.value }); speaker.stop(); speaker.say('Buonasera. Così suona la mia nuova voce.'); };
  $('ttsRate').onchange = async e => { st = await J.setSettings({ ttsRate: e.target.value }); speaker.stop(); speaker.say('Parlerò a questa velocità.'); };
  $('testVoice').onclick = () => { speaker.stop(); speaker.say(`Buonasera${st.name ? ' ' + st.name : ''}. Sono Jarvis, sempre al suo servizio.`); };
  $('listen').onchange = e => setListen(e.target.checked);
  $('followUp').onchange = async e => { st = await J.setSettings({ followUp: e.target.checked }); JarvisEars.followUpMs = e.target.checked ? 6000 : 0; };
  $('sttModel').onchange = async e => {
    st = await J.setSettings({ sttModel: e.target.value });
    if (JarvisEars.state === 'listening') { JarvisEars.stop(); await setListen(true); }
  };
  $('hotkey').onchange = async e => { const r = await J.setSettings({ hotkey: e.target.value.trim() || 'Alt+J' }); st = r; renderPanel(); if (!r.hotkeyOk) addNote('Scorciatoia non disponibile, prova un\'altra combinazione', 'err'); };
  $('updateRepo').onchange = async e => { st = await J.setSettings({ updateRepo: e.target.value.trim() }); renderPanel(); };
  $('checkUpd').onclick = async () => renderUpdate(await J.checkUpdate());
  $('updateInstall').onclick = () => J.installUpdate();
  $('openData').onclick = () => J.openDataFolder();
  const ask = (title, detail) => new Promise(res => {
    $('mTitle').textContent = title; $('mDetail').textContent = detail; $('mYes').className = 'ghost danger';
    $('modal').classList.add('open');
    $('mYes').onclick = () => { $('modal').classList.remove('open'); res(true); };
    $('mNo').onclick = () => { $('modal').classList.remove('open'); res(false); };
  });
  $('clearChat').onclick = async () => { if (await ask('Nuova conversazione?', 'La chat viene svuotata, i ricordi restano.')) { st = await J.clearChat(); renderChat(); renderPanel(); } };
  $('wipe').onclick = async () => { if (await ask('Reset totale?', 'Cancella conversazioni, ricordi, promemoria. Jarvis ripartirà da zero.')) { st = await J.wipe(); renderChat(); renderPanel(); } };
  $('obSave').onclick = async () => {
    const k = $('obKey').value.trim();
    if (!/^sk-ant-/.test(k)) { $('obErr').textContent = 'La chiave dovrebbe iniziare con sk-ant-'; return; }
    st = await J.setSettings({ apiKey: k }); $('obKey').value = '';
    $('onboard').classList.remove('open'); renderPanel(); input.focus();
  };

  // ---------- avvio ----------
  // ---------- orecchie ----------
  let sttDetail = '';
  async function setListen(on) {
    if (!on) {
      JarvisEars.stop(); sttDetail = '';
      if (st.settings.listen) st = await J.setSettings({ listen: false });
      setStatus(); renderPanel(); return;
    }
    if (!st.settings.listen) st = await J.setSettings({ listen: true });
    renderPanel();
    const s0 = await J.sttInit();
    if (s0.status !== 'ready') { sttDetail = s0.detail || 'Preparo il modulo di ascolto…'; setStatus(); return; } // partirà su "ready"
    sttDetail = '';
    await JarvisEars.start(); setStatus();
  }
  J.onSttStatus(async s => {
    if (s.status === 'ready') {
      sttDetail = '';
      if (st.settings.listen && JarvisEars.state !== 'listening') { await JarvisEars.start(); addNote('👂 Ascolto attivo: chiamami dicendo «Jarvis».', 'learn'); }
    } else if (s.status === 'error') { sttDetail = ''; addNote('⚠ ' + s.detail, 'err'); }
    else sttDetail = s.detail;
    setStatus();
  });
  JarvisEars.busy = () => busy;
  JarvisEars.speaking = () => speaker.isSpeaking();
  JarvisEars.onState = (state, detail) => { if (state === 'error' && detail) addNote('⚠ ' + detail, 'err'); setStatus(); };
  JarvisEars.onHeard = t => { if (t) $('heard').textContent = 'Ultima frase sentita: «' + t + '»'; };
  JarvisEars.onWake = () => { J.wake(); speaker.stop(); chime(); speaker.say('Sì?'); setStatus(); setTimeout(setStatus, 8100); };
  JarvisEars.onCommand = text => { J.wake(); chime(); sendMsg(text, true); };
  JarvisEars.onStop = () => { speaker.stop(); if (busy) J.stop(); };

  async function loadVoices() {
    const { voices } = await J.ttsVoices();
    $('ttsVoice').innerHTML = voices.map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('');
    $('ttsVoice').value = st.settings.ttsVoice;
  }

  refresh(true).then(async () => {
    await loadVoices(); renderPanel();
    JarvisEars.followUpMs = st.settings.followUp ? 6000 : 0;
    setBusy(false); input.focus();
    if (st.settings.listen && st.hasKey) setListen(true);
  });
})();
