# Routerly – Specification Document

---

## 1. Descrizione ad Alto Livello

Routerly è un API gateway auto-hostato per Large Language Models (LLM). Il suo scopo è fare da proxy intelligente tra le applicazioni client e i provider di modelli AI (OpenAI, Anthropic, Google Gemini, Ollama, e altri), esponendo endpoint completamente compatibili con le API standard di OpenAI e Anthropic.

L'idea centrale è che un'applicazione già integrata con OpenAI non debba subire alcuna modifica al codice: è sufficiente cambiare l'host e il token di autenticazione per iniziare a usare Routerly. Da quel momento, il sistema si occupa in modo trasparente di decidere quale modello effettivamente soddisferà la richiesta, tracciare i costi, rispettare i budget configurati e garantire la continuità del servizio tramite fallback automatici.

Il routing delle richieste è delegato a un LLM scelto dall'utente (il "modello di routing"). Questo modello riceve la richiesta in ingresso e risponde con una lista pesata di modelli candidati. Il proxy scorre questa lista in ordine di peso decrescente e utilizza il primo modello disponibile che non abbia esaurito il budget configurato. Se tutti i candidati falliscono o sono a budget esaurito, la richiesta viene rigettata con un errore esplicito.

Tutte le configurazioni (modelli, progetti, utenti, soglie) sono salvate su file JSON, con particolare attenzione alla sicurezza (cifratura dei token, gestione dei permessi sui file).

Il sistema è composto da tre componenti:

- **Service**: il cuore del sistema, espone le API compatibili OpenAI/Anthropic, gestisce il routing, il tracciamento dei costi e serve opzionalmente la dashboard.
- **CLI**: interfaccia a riga di comando per la configurazione e amministrazione, con accesso admin completo senza autenticazione (pensata per chi ha accesso diretto alla macchina).
- **Dashboard**: interfaccia web per la gestione visuale di modelli, progetti e utenti, servita opzionalmente dal service e disattivabile.

---

## 2. Business Requirements (BR)

### BR-01 – Compatibilità API
Il sistema deve esporre endpoint che siano drop-in replacement delle API OpenAI e Anthropic, senza richiedere modifiche al codice client esistente.

### BR-02 – Supporto Multi-Provider
Il sistema deve supportare l'integrazione con i principali provider LLM: OpenAI, Anthropic, Google Gemini, Ollama e provider custom tramite endpoint configurabile.

### BR-03 – Routing Intelligente
Il sistema deve delegare la decisione di routing a un LLM configurabile per progetto, che restituisce una lista pesata di modelli candidati. Il proxy seleziona il modello in ordine di peso, con fallback automatico in caso di errore o budget esaurito.

### BR-04 – Gestione dei Costi
Il sistema deve tracciare in tempo reale il consumo di token e il relativo costo per ogni chiamata, aggregando i dati per modello, progetto e periodo (giornaliero, settimanale, mensile).

### BR-05 – Controllo dei Budget
Il sistema deve consentire la definizione di soglie di consumo a livello globale (per modello) e a livello di progetto (per modello associato al progetto), bloccando automaticamente l'uso del modello quando la soglia viene superata.

### BR-06 – Isolamento per Progetto
Ogni progetto deve avere un proprio endpoint e token di autenticazione, garantendo isolamento tra contesti applicativi diversi.

### BR-07 – Gestione Utenti Interna
Il sistema deve prevedere un sistema di utenti con ruoli e permessi per l'accesso alla dashboard, senza impatto sul flusso delle chiamate API.

### BR-08 – Configurazione Persistente su File
Tutta la configurazione deve essere salvata su file JSON, con protezione adeguata per i dati sensibili (token, credenziali).

### BR-09 – Self-Hosting
Il sistema deve poter essere eseguito interamente in locale o su infrastruttura privata, senza dipendenze da servizi cloud esterni (eccetto i provider LLM configurati).

### BR-10 – Interfacce Multiple
Il sistema deve essere gestibile tramite CLI (per utenti tecnici con accesso alla macchina) e tramite dashboard web (per utenti con ruoli di gestione).

---

## 3. Product Requirements Document (PRD)

### 3.1 Obiettivo del Prodotto

Routerly risolve il problema della gestione centralizzata di più provider LLM in contesti multi-progetto, offrendo controllo sui costi, routing automatico e compatibilità totale con gli SDK esistenti.

### 3.2 Utenti Target

- **Sviluppatori e team tecnici** che usano già le API OpenAI/Anthropic e vogliono aggiungere controllo sui costi o routing senza riscrivere il codice.
- **Aziende** che vogliono centralizzare l'accesso ai modelli LLM, separare i budget per progetto e controllare chi accede a cosa.
- **Utenti privati** che vogliono orchestrare modelli locali (Ollama) e cloud in modo trasparente.

### 3.3 Componenti del Prodotto

#### Service
- Proxy HTTP compatibile con le API OpenAI (`/v1/chat/completions`, `/v1/completions`, ecc.) e Anthropic (`/v1/messages`).
- Autenticazione delle richieste tramite token di progetto (Bearer token).
- Invocazione del modello di routing per ogni richiesta in ingresso.
- Selezione del modello in base ai pesi restituiti dal modello di routing, con verifica delle soglie.
- Inoltro della richiesta al modello selezionato e restituzione della risposta al client.
- Tracciamento dei token usati e aggiornamento dei contatori di costo.
- Serving opzionale della dashboard (disattivabile via configurazione).

#### CLI
- Accesso admin completo senza autenticazione.
- Comandi per: aggiungere/modificare/rimuovere modelli, creare/gestire progetti, gestire utenti e ruoli, visualizzare report di consumo, avviare/fermare il service.

#### Dashboard
- Interfaccia web per la gestione visuale.
- Accesso tramite autenticazione utente con ruolo e permessi.
- Viste: modelli registrati, progetti, utenti, report di consumo e costi.
- Possibilità di disattivare completamente la dashboard via configurazione del service.

### 3.4 Modelli di Dati Principali

#### Modello (Provider Model)
- Provider (openai, anthropic, gemini, ollama, custom)
- Endpoint
- Token/credenziali (cifrati)
- Costo per token di input e output (precompilato per i provider principali, sovrascrivibile)
- Soglie di consumo globali (giornaliera, settimanale, mensile)

#### Progetto
- Nome e descrizione
- Endpoint dedicato (es. `/projects/mio-progetto/v1/chat/completions`)
- Token di autenticazione del progetto
- Modello di routing associato
- Lista di modelli associati, ognuno con soglie custom opzionali

#### Utente
- Nome, email, password (hash)
- Ruolo assegnato
- Lista di progetti visibili/gestibili

#### Ruolo
- Nome
- Lista di permessi (es. `project:read`, `project:write`, `model:read`, `user:manage`, ecc.)

### 3.5 Flusso di una Richiesta

1. Il client invia una richiesta all'endpoint del progetto con il token di progetto.
2. Il service autentica la richiesta verificando il token.
3. Il service invia la richiesta al modello di routing configurato per il progetto.
4. Il modello di routing risponde con una lista pesata di modelli candidati in formato JSON.
5. Il service scorre la lista in ordine di peso decrescente e seleziona il primo modello che non ha superato le soglie di budget.
6. Il service inoltra la richiesta al modello selezionato.
7. Il service legge la risposta, estrae i contatori di token, aggiorna i log di costo e consumo.
8. Il service restituisce la risposta al client nel formato atteso (OpenAI o Anthropic).
9. In caso di errore o budget esaurito per il modello selezionato, si passa al candidato successivo. Se tutti falliscono, viene restituito un errore al client.

### 3.6 Formato Risposta del Modello di Routing

```json
{
  "models": [
    { "model": "gpt-4o", "weight": 0.9 },
    { "model": "claude-3-5-sonnet", "weight": 0.7 },
    { "model": "ollama/llama3", "weight": 0.3 }
  ]
}
```

I modelli vengono selezionati in ordine di peso decrescente. Il peso non determina una selezione probabilistica ma una priorità ordinata.

---

## 4. Software Requirements Specification (SRS)

### 4.1 Requisiti Funzionali

#### RF-01 – Registrazione Modelli
Il sistema deve permettere di registrare modelli LLM specificando: provider, endpoint, token/credenziali, costo per token (input/output), soglie di consumo globali.

#### RF-02 – Costi Precompilati
Il sistema deve includere una configurazione predefinita con i costi per token dei principali provider (OpenAI, Anthropic, Gemini). L'utente deve poter sovrascrivere questi valori.

#### RF-03 – Creazione Progetti
Il sistema deve permettere di creare progetti con: nome, endpoint dedicato, token di autenticazione generato automaticamente, modello di routing, lista di modelli associati con soglie opzionali.

#### RF-04 – Autenticazione API
Il service deve autenticare le richieste in ingresso tramite Bearer token associato al progetto. Richieste con token non valido devono essere rigettate con HTTP 401.

#### RF-05 – Invocazione Modello di Routing
Per ogni richiesta autenticata, il service deve invocare il modello di routing del progetto, passando il contenuto della richiesta originale. La risposta deve essere un JSON con la lista pesata di modelli candidati.

#### RF-06 – Selezione Modello con Fallback
Il service deve selezionare il modello con peso più alto tra quelli che non hanno superato le soglie di budget. In caso di errore durante la chiamata, deve passare al candidato successivo. Se tutti i candidati falliscono, deve restituire HTTP 503 con messaggio di errore.

#### RF-07 – Tracciamento Consumi
Il service deve registrare per ogni chiamata: timestamp, progetto, modello usato, token di input/output, costo calcolato, latenza, esito (successo/errore).

#### RF-08 – Verifica Soglie
Prima di selezionare un modello, il service deve verificare che il consumo aggregato (giornaliero, settimanale, mensile) non superi le soglie configurate a livello di progetto o globale. Le soglie di progetto hanno priorità su quelle globali.

#### RF-09 – Compatibilità OpenAI
Il service deve esporre almeno gli endpoint `/v1/chat/completions` e `/v1/models` con payload e risposta conformi alle specifiche OpenAI.

#### RF-10 – Compatibilità Anthropic
Il service deve esporre almeno l'endpoint `/v1/messages` con payload e risposta conformi alle specifiche Anthropic.

#### RF-11 – Gestione Utenti e Ruoli
Il sistema deve supportare la creazione di utenti con email, password (bcrypt o equivalente) e ruolo. I ruoli definiscono i permessi di accesso alle funzionalità della dashboard.

#### RF-12 – Permessi Granulari
Il sistema deve supportare i seguenti permessi: `project:read`, `project:write`, `model:read`, `model:write`, `user:read`, `user:write`, `report:read`.

#### RF-13 – CLI Admin
La CLI deve permettere tutte le operazioni di configurazione senza autenticazione, assumendo accesso admin completo.

#### RF-14 – Dashboard Opzionale
La dashboard deve essere servita dal service sulla stessa porta (path dedicato, es. `/dashboard`) e deve poter essere disabilitata tramite un flag nella configurazione.

#### RF-15 – Persistenza su File JSON
Tutta la configurazione (modelli, progetti, utenti, ruoli) deve essere salvata su file JSON. I file devono essere leggibili dall'amministratore ma i token e le credenziali devono essere cifrati a riposo (es. AES-256).

### 4.2 Requisiti Non Funzionali

#### RNF-01 – Sicurezza dei Token
Tutti i token e le credenziali salvati su file devono essere cifrati. La chiave di cifratura deve essere configurabile tramite variabile d'ambiente e non deve mai essere salvata in chiaro nei file di configurazione.

#### RNF-02 – Latenza Aggiuntiva
Il proxy non deve introdurre più di 200ms di latenza aggiuntiva rispetto alla chiamata diretta al provider (escluso il tempo di risposta del modello di routing).

#### RNF-03 – Affidabilità del Fallback
Il meccanismo di fallback deve essere completato entro il timeout configurato per il progetto. Ogni tentativo su un modello candidato deve rispettare un timeout individuale configurabile.

#### RNF-04 – Portabilità
Il service deve poter essere eseguito su Linux, macOS e Windows, senza dipendenze da servizi esterni oltre ai provider LLM configurati.

#### RNF-05 – Logging
Il sistema deve produrre log strutturati (JSON) per ogni evento rilevante: richieste in ingresso, selezione del modello, errori, aggiornamenti delle soglie.

#### RNF-06 – Configurazione via File e Variabili d'Ambiente
Le impostazioni sensibili (chiave di cifratura, porta del service) devono poter essere fornite tramite variabili d'ambiente, con priorità sulle impostazioni nel file di configurazione.

### 4.3 Stack Tecnologico

- **Service e CLI**: Node.js. Il service espone le API HTTP tramite un framework leggero (es. Fastify o Express). La CLI è un eseguibile Node.js invocabile da terminale.
- **Dashboard**: React. Applicazione single-page servita staticamente dal service (build produzione inclusa nel pacchetto).
- **Persistenza**: file JSON su filesystem, gestiti direttamente dal service tramite lettura/scrittura con lock per evitare race condition.

### 4.4 Struttura dei File di Configurazione

La configurazione è salvata in `~/.routerly/` per convenzione, seguendo lo standard delle applicazioni self-hosted Unix-like. Il percorso può essere sovrascritto tramite la variabile d'ambiente `ROUTERLY_HOME`.

```
~/.routerly/
  config/
    settings.json       # configurazione generale del service (porta, timeout, ecc.)
    models.json         # modelli registrati (credenziali cifrate)
    projects.json       # progetti e modelli associati
    users.json          # utenti e ruoli (password hashate)
    roles.json          # definizione ruoli e permessi
  data/
    usage.json          # log aggregati di consumo e costi
```

La chiave di cifratura per le credenziali deve essere fornita tramite variabile d'ambiente (`ROUTERLY_SECRET_KEY`) e non deve mai comparire nei file di configurazione.

### 4.5 Vincoli Tecnici

- Le API esposte devono essere conformi agli standard OpenAI e Anthropic senza estensioni incompatibili.
- Il sistema di routing deve gestire correttamente sia chiamate in streaming (`stream: true`) che non.
- I file JSON di configurazione non devono contenere mai credenziali in chiaro.
- La dashboard, se attiva, deve richiedere autenticazione separata dal token di progetto.

---

*Documento generato a partire dalle specifiche discusse con l'autore del progetto. Versione 1.0.*
