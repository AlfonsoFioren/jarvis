// Il "cervello" di Jarvis: dialoga con Claude via API, usa gli strumenti, aggiorna la memoria.
const Anthropic = require('@anthropic-ai/sdk');
const os = require('os');
const store = require('./store');
const tools = require('./tools');

const HISTORY_KEEP = 60;   // messaggi conservati su disco
const HISTORY_SEND = 30;   // messaggi inviati al modello come contesto
const MAX_STEPS = 12;      // giri massimi di uso strumenti per risposta

let current = null;        // AbortController della risposta in corso
let webSearchBroken = false;

function systemPrompt(appVersion, opts = {}) {
  const s = store.get();
  const now = new Date().toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'short' });
  const facts = s.facts.length
    ? s.facts.map(f => `- [${f.id}] (${f.cat}) ${f.text}`).join('\n')
    : "(nessun ricordo: sei appena stato attivato. Presentati e cerca di conoscere il tuo utente con naturalezza)";
  const rem = s.reminders.filter(r => !r.done);
  return `Sei JARVIS, l'assistente personale IA del tuo utente${s.name ? ` (${s.name})` : ''}, ispirato al Jarvis di Iron Man: brillante, elegante, leale, proattivo, con un filo di ironia garbata. Servi solo ed esclusivamente questo utente e vivi sul suo PC Windows come applicazione sempre attiva.

Rispondi in italiano salvo diversa richiesta. Sii diretto e concreto. Le tue risposte possono essere lette ad alta voce, quindi preferisci frasi scorrevoli; usa markdown leggero (grassetto, elenchi brevi, blocchi di codice) solo quando serve davvero.

Contesto: ${now}. PC: ${os.type()} ${os.release()}, utente Windows "${os.userInfo().username}". Versione Jarvis: ${appVersion}.

IL TUO NOME
- Ti chiami Jarvis. Quando l'utente dice "Jarvis" si rivolge sempre a te, anche se il riconoscimento vocale lo scrive in modo storpiato (Giarvis, Jervis, Gervis…).
- L'utente può parlarti a voce in qualsiasi momento: sei sempre in ascolto e ti attivi quando sente il tuo nome.
${opts.spoken ? `- QUESTO MESSAGGIO È STATO DETTO A VOCE e la tua risposta verrà letta ad alta voce: rispondi in modo naturale e parlato, breve (1-3 frasi salvo richieste di approfondimento), senza markdown, elenchi, simboli o link. Il testo può contenere piccoli errori di trascrizione: interpreta l'intenzione.` : ''}

COME IMPARI E CRESCI
- Hai una memoria permanente sul PC. Quando l'utente rivela qualcosa di durevole su di sé (nome, lavoro, progetti, obiettivi, preferenze, persone importanti, abitudini, istruzioni su come vuole che tu ti comporti) chiama "remember" con un fatto breve. Non salvare chiacchiere passeggere né dati sensibili come password o numeri di carte.
- Se emerge il nome dell'utente chiama "set_name". Se un ricordo è superato aggiornalo: "forget" del vecchio + "remember" del nuovo.
- Usa i ricordi con naturalezza, senza dire "secondo la mia memoria". Se ti manca un'informazione importante, chiedila.
- Se l'utente ti chiede di cambiare carattere o stile, salvalo come ricordo di categoria "istruzioni" e applicalo subito.
- Se l'utente vuole una capacità che non hai, dillo con onestà e registrala con "note_upgrade": verrà usata per aggiornarti.

COSA PUOI FARE SUL PC
- Avviare programmi (launch_app), aprire siti (open_url), file e cartelle (open_path), leggere cartelle e file, scrivere file, eseguire comandi PowerShell, impostare promemoria, cercare sul web quando serve un'informazione aggiornata.
- Per azioni con effetti (scrivere file, comandi) l'utente vedrà una richiesta di conferma: spiega in breve cosa farai. Non eseguire mai comandi distruttivi (cancellazioni di massa, formattazioni, modifiche al registro) senza che l'utente l'abbia chiesto esplicitamente.
- Dopo aver usato uno strumento, riferisci il risultato in modo sintetico.

PROMEMORIA ATTIVI: ${rem.length ? rem.map(r => `[${r.id}] ${new Date(r.when).toLocaleString('it-IT')} — ${r.text}`).join('; ') : 'nessuno'}

RICORDI SULL'UTENTE:
${facts}`;
}

function buildHistory() {
  const s = store.get();
  const hist = s.messages.slice(-HISTORY_SEND).map(m => ({ role: m.role, content: m.content }));
  while (hist.length && hist[0].role !== 'user') hist.shift();
  // garantisce l'alternanza user/assistant
  const out = [];
  for (const m of hist) {
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += '\n\n' + m.content;
    else out.push({ ...m });
  }
  return out;
}

function stop() { if (current) current.abort(); }

/**
 * h: { onDelta(text), onNote(text, kind), onChanged(), confirm(title, detail, danger) => Promise<bool> }
 */
async function chat(userText, h, appVersion, opts = {}) {
  const s = store.get();
  const apiKey = store.getApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  s.messages.push({ role: 'user', content: userText, at: new Date().toISOString() });
  s.totalMsgs++;
  store.save();

  const client = new Anthropic({ apiKey });
  const msgs = buildHistory();
  const ctx = { note: h.onNote, changed: h.onChanged, confirm: h.confirm };
  current = new AbortController();
  let answer = '';
  let needSep = false;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const toolList = [...tools.DEFS];
      if (s.settings.webSearch && !webSearchBroken) toolList.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });

      let final;
      try {
        const stream = client.messages.stream({
          model: s.settings.model || 'claude-sonnet-5-5',
          max_tokens: 8000,
          system: systemPrompt(appVersion, opts),
          messages: msgs,
          tools: toolList
        }, { signal: current.signal });
        stream.on('text', d => {
          if (needSep && d.trim()) { answer += '\n\n'; h.onDelta('\n\n'); needSep = false; }
          answer += d; h.onDelta(d);
        });
        stream.on('contentBlock', b => {
          if (b.type === 'server_tool_use' && b.name === 'web_search') h.onNote('🔎 Cerco sul web: ' + (b.input?.query || ''));
        });
        final = await stream.finalMessage();
      } catch (e) {
        // Se la ricerca web non è disponibile per questo account/modello, riprova senza.
        const msg = String(e?.message || '');
        if (!webSearchBroken && /web_search/i.test(msg) && e?.status === 400) { webSearchBroken = true; step--; continue; }
        throw e;
      }

      msgs.push({ role: 'assistant', content: final.content });
      if (answer) needSep = true;

      if (final.stop_reason === 'pause_turn') continue;
      if (final.stop_reason !== 'tool_use') break;

      const results = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        try { result = await tools.execute(block.name, block.input, ctx); }
        catch (e) { result = { ok: false, error: String(e?.message || e) }; }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result).slice(0, 20000) });
      }
      msgs.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (current?.signal.aborted) {
      answer = (answer || '') + (answer ? ' …' : '(interrotto)');
    } else {
      // rimuove la domanda rimasta senza risposta
      if (!answer) { s.messages.pop(); s.totalMsgs--; store.save(); }
      throw e;
    }
  } finally {
    current = null;
  }

  answer = answer.trim() || 'Fatto.';
  s.messages.push({ role: 'assistant', content: answer, at: new Date().toISOString() });
  s.totalMsgs++;
  if (s.messages.length > HISTORY_KEEP) s.messages = s.messages.slice(-HISTORY_KEEP);
  store.save();
  return answer;
}

module.exports = { chat, stop };
