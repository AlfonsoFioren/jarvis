# Jarvis — assistente personale IA per Windows

App desktop (Electron) che vive nella barra di sistema, si avvia con Windows e usa Claude via API.

## Funzioni (v1.0.0)
- Chat con streaming, personalità "Jarvis", risposte a voce (sintesi vocale di Windows)
- Memoria permanente locale: impara fatti, preferenze, istruzioni; pannello per vederli/cancellarli
- Strumenti sul PC: avviare programmi, aprire siti/file/cartelle, leggere e scrivere file, comandi PowerShell (sempre con conferma), info di sistema
- Promemoria con notifica di Windows
- Ricerca sul web
- Lista "Evoluzione": le capacità richieste che non ha ancora, da passare allo sviluppatore
- Scorciatoia globale (default Alt+J), avvio automatico, aggiornamenti automatici da GitHub Releases

## Dati
`%APPDATA%\Jarvis\jarvis-data.json` (la chiave API è cifrata con DPAPI di Windows).

## Rilasciare un aggiornamento
1. Aumenta `version` in `package.json` (es. 1.0.1)
2. `git commit -am "..." && git tag v1.0.1 && git push && git push --tags`
3. GitHub Actions costruisce l'installer e pubblica la Release; Jarvis sui PC si aggiorna da solo.

## Sviluppo
```
npm install
npm start
```
