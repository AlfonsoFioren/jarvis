// Strumenti che Jarvis può usare sul PC.
// Le azioni potenzialmente rischiose (scrivere file, eseguire comandi) chiedono SEMPRE conferma all'utente.
const { shell, app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const MAX_READ = 100 * 1024;

function resolvePath(p) {
  p = String(p || '').trim().replace(/^["']|["']$/g, '');
  p = p.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? process.env[v.toUpperCase()] ?? `%${v}%`);
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  const special = { desktop: 'desktop', scrivania: 'desktop', documenti: 'documents', documents: 'documents',
    download: 'downloads', downloads: 'downloads', immagini: 'pictures', pictures: 'pictures',
    musica: 'music', music: 'music', video: 'videos', videos: 'videos', home: 'home' };
  const first = p.split(/[\\/]/)[0].toLowerCase();
  if (special[first] && !path.isAbsolute(p)) {
    p = path.join(app.getPath(special[first]), p.slice(first.length));
  }
  if (!path.isAbsolute(p)) p = path.join(os.homedir(), p);
  return path.normalize(p);
}

function startMenuDirs() {
  const dirs = [];
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (process.env.ProgramData) dirs.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  dirs.push(app.getPath('desktop'));
  return dirs;
}

function findShortcuts(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) findShortcuts(full, out, depth + 1);
    else if (/\.(lnk|url|appref-ms)$/i.test(e.name)) out.push({ name: e.name.replace(/\.(lnk|url|appref-ms)$/i, ''), full });
  }
  return out;
}

function runPowershell(command, timeoutMs = 60000) {
  return new Promise(resolve => {
    const shellExe = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const args = process.platform === 'win32'
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
         '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + command]
      : ['-lc', command];
    execFile(shellExe, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const clip = s => (s || '').length > 8000 ? s.slice(0, 8000) + '\n…(troncato)' : (s || '');
      resolve({ exitCode: err ? (err.code ?? 1) : 0, stdout: clip(stdout), stderr: clip(stderr), timedOut: !!(err && err.killed) });
    });
  });
}

// ---------------- definizioni ----------------
const DEFS = [
  { name: 'remember', description: "Salva un fatto durevole sull'utente nella memoria permanente (nome, lavoro, progetti, obiettivi, preferenze, persone, abitudini, istruzioni su come comportarti).",
    input_schema: { type: 'object', properties: {
      text: { type: 'string', description: "Fatto breve in terza persona, es. 'Lavora nel campo informatico'" },
      category: { type: 'string', enum: ['identità', 'lavoro', 'progetti', 'obiettivi', 'preferenze', 'persone', 'abitudini', 'istruzioni', 'generale'] } },
      required: ['text'] } },
  { name: 'forget', description: 'Elimina un ricordo superato o che l\'utente vuole cancellare, tramite id.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'set_name', description: "Imposta il nome con cui chiamare l'utente.",
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'open_url', description: 'Apre un sito web nel browser predefinito.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'launch_app', description: "Avvia un programma installato cercandolo per nome nel menu Start e sul desktop (es. 'Chrome', 'Word', 'Spotify', 'Visual Studio Code').",
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'open_path', description: "Apre un file o una cartella con il programma predefinito. Percorsi tipo 'Desktop\\file.txt', 'Documenti', '~\\Downloads' o assoluti.",
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'list_dir', description: 'Elenca il contenuto di una cartella.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'read_file', description: 'Legge un file di testo (max 100 KB).',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: "Crea o sovrascrive un file di testo. Chiede conferma all'utente.",
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'run_powershell', description: "Esegue un comando PowerShell sul PC e restituisce l'output. Chiede SEMPRE conferma all'utente mostrando il comando. Usalo per azioni di sistema che gli altri strumenti non coprono.",
    input_schema: { type: 'object', properties: {
      command: { type: 'string' }, reason: { type: 'string', description: "Spiegazione breve in italiano di cosa fa, mostrata all'utente" } },
      required: ['command', 'reason'] } },
  { name: 'system_info', description: 'Informazioni sul PC: sistema, CPU, RAM, spazio, cartelle utente, data/ora.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'set_reminder', description: "Imposta un promemoria: all'ora indicata Jarvis mostra una notifica e lo annuncia.",
    input_schema: { type: 'object', properties: {
      when: { type: 'string', description: 'Data e ora in formato ISO 8601 con fuso orario locale, es. 2026-11-19T09:30:00+01:00' },
      text: { type: 'string' } }, required: ['when', 'text'] } },
  { name: 'list_reminders', description: 'Elenca i promemoria attivi.', input_schema: { type: 'object', properties: {} } },
  { name: 'cancel_reminder', description: 'Annulla un promemoria tramite id.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'note_upgrade', description: "Registra una capacità che l'utente vorrebbe e che ancora non hai (es. leggere le email, controllare la domotica). Finisce nella lista 'Evoluzione' che l'utente passerà allo sviluppatore per aggiornarti.",
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }
];

// ---------------- esecuzione ----------------
async function execute(name, input, ctx) {
  const s = store.get();
  input = input || {};
  switch (name) {
    case 'remember': {
      const text = String(input.text || '').trim();
      if (!text) return { ok: false };
      const dup = s.facts.find(f => f.text.toLowerCase() === text.toLowerCase());
      if (dup) return { ok: true, id: dup.id, note: 'già noto' };
      const id = store.newId('m');
      s.facts.push({ id, text, cat: input.category || 'generale', at: new Date().toISOString() });
      store.save(); ctx.note('✦ Ho imparato: ' + text, 'learn'); ctx.changed();
      return { ok: true, id };
    }
    case 'forget': {
      const n = s.facts.length;
      s.facts = s.facts.filter(f => f.id !== input.id);
      store.save(); ctx.changed();
      if (n !== s.facts.length) ctx.note('Ricordo aggiornato');
      return { ok: n !== s.facts.length };
    }
    case 'set_name':
      s.name = String(input.name || '').trim(); store.save(); ctx.changed(); return { ok: true };
    case 'open_url': {
      const url = String(input.url || '');
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Solo indirizzi http/https' };
      await shell.openExternal(url); ctx.note('↗ Apro ' + url); return { ok: true };
    }
    case 'launch_app': {
      const q = String(input.name || '').toLowerCase().trim();
      if (!q) return { ok: false };
      const all = startMenuDirs().flatMap(d => findShortcuts(d));
      const score = n => { n = n.toLowerCase(); if (n === q) return 3; if (n.startsWith(q)) return 2; if (n.includes(q)) return 1; return 0; };
      const best = all.map(a => ({ ...a, sc: score(a.name) })).filter(a => a.sc > 0)
        .sort((a, b) => b.sc - a.sc || a.name.length - b.name.length);
      if (!best.length) return { ok: false, error: 'Programma non trovato nel menu Start. Prova con un nome diverso o usa run_powershell.' };
      const err = await shell.openPath(best[0].full);
      if (err) return { ok: false, error: err };
      ctx.note('▶ Avvio ' + best[0].name);
      return { ok: true, avviato: best[0].name, alternative: best.slice(1, 4).map(b => b.name) };
    }
    case 'open_path': {
      const p = resolvePath(input.path);
      if (!fs.existsSync(p)) return { ok: false, error: 'Percorso inesistente: ' + p };
      if (/\.(exe|bat|cmd|ps1|vbs|js|msi|scr|com)$/i.test(p)) {
        const ok = await ctx.confirm('Eseguire questo programma?', p);
        if (!ok) return { ok: false, error: "L'utente ha rifiutato" };
      }
      const err = await shell.openPath(p);
      if (err) return { ok: false, error: err };
      ctx.note('↗ Apro ' + p); return { ok: true, path: p };
    }
    case 'list_dir': {
      const p = resolvePath(input.path);
      try {
        const items = fs.readdirSync(p, { withFileTypes: true }).slice(0, 300).map(e => {
          let size; try { if (e.isFile()) size = fs.statSync(path.join(p, e.name)).size; } catch {}
          return (e.isDirectory() ? '[cartella] ' : '') + e.name + (size != null ? ` (${size} byte)` : '');
        });
        return { ok: true, path: p, items };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    case 'read_file': {
      const p = resolvePath(input.path);
      try {
        const st = fs.statSync(p);
        const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
        const fd = fs.openSync(p, 'r'); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
        return { ok: true, path: p, size: st.size, truncated: st.size > MAX_READ, content: buf.toString('utf8') };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    case 'write_file': {
      const p = resolvePath(input.path);
      const exists = fs.existsSync(p);
      const preview = String(input.content || '').slice(0, 600);
      const ok = await ctx.confirm(exists ? 'Sovrascrivere questo file?' : 'Creare questo file?', p + '\n\n' + preview + (String(input.content).length > 600 ? '\n…' : ''));
      if (!ok) return { ok: false, error: "L'utente ha rifiutato" };
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(input.content ?? ''), 'utf8');
        ctx.note('💾 Salvato ' + p); return { ok: true, path: p };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    case 'run_powershell': {
      const ok = await ctx.confirm('Eseguire questo comando?', (input.reason ? input.reason + '\n\n' : '') + input.command, true);
      if (!ok) return { ok: false, error: "L'utente ha rifiutato" };
      ctx.note('⚙ Eseguo comando…');
      return await runPowershell(String(input.command));
    }
    case 'system_info': {
      const gb = n => (n / 1024 ** 3).toFixed(1) + ' GB';
      return {
        os: `${os.type()} ${os.release()} (${os.arch()})`, host: os.hostname(), utente: os.userInfo().username,
        cpu: os.cpus()[0]?.model, core: os.cpus().length, ram_totale: gb(os.totalmem()), ram_libera: gb(os.freemem()),
        acceso_da_ore: (os.uptime() / 3600).toFixed(1), ora_locale: new Date().toString(),
        cartelle: { home: os.homedir(), desktop: app.getPath('desktop'), documenti: app.getPath('documents'), download: app.getPath('downloads') }
      };
    }
    case 'set_reminder': {
      const when = new Date(input.when);
      if (isNaN(when)) return { ok: false, error: 'Data non valida' };
      const id = store.newId('r');
      s.reminders.push({ id, when: when.toISOString(), text: String(input.text), done: false });
      store.save(); ctx.changed();
      ctx.note('⏰ Promemoria: ' + when.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) + ' — ' + input.text);
      return { ok: true, id };
    }
    case 'list_reminders':
      return { reminders: s.reminders.filter(r => !r.done) };
    case 'cancel_reminder': {
      const r = s.reminders.find(x => x.id === input.id);
      if (!r) return { ok: false };
      s.reminders = s.reminders.filter(x => x.id !== input.id); store.save(); ctx.changed();
      return { ok: true };
    }
    case 'note_upgrade': {
      s.upgrades.push({ id: store.newId('u'), text: String(input.text), at: new Date().toISOString() });
      store.save(); ctx.changed(); ctx.note('🧬 Aggiunto alla lista Evoluzione: ' + input.text, 'learn');
      return { ok: true };
    }
    default:
      return { ok: false, error: 'Strumento sconosciuto: ' + name };
  }
}

module.exports = { DEFS, execute, resolvePath, runPowershell };
