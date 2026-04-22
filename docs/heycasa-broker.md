# HeyCasa Broker — Protocollo WebSocket

Documento di riferimento per integrare il broker in qualsiasi codebase client.

---

## Panoramica

Il broker è un server HTTP + WebSocket leggero scritto in Python che espone
comandi di rete LAN (ping, scan, services) attraverso una connessione WebSocket
persistente. Dispone anche di una modalità CLI `--learn` per costruire una mappa
persistente della rete locale (`broker.map`).
Non esegue shell arbitrarie: accetta solo i comandi definiti in questo documento.

**Stack**: Python 3.12, libreria standard, nessuna dipendenza esterna.

---

## Endpoint

| Tipo       | URL                          | Scopo                        |
|------------|------------------------------|------------------------------|
| HTTP GET   | `http://<host>:29001/`       | Pagina di test browser       |
| WebSocket  | `ws://<host>:29001/ws`       | Canale comandi               |
| HTTP GET   | `http://<host>:29001/assets/` | Asset statici                |

**Porta default**: `29001`  
**Bind default**: `0.0.0.0` (raggiungibile da tutti i device della LAN)

---

## Connessione WebSocket

### Handshake

Connessione WebSocket standard RFC 6455 verso `ws://<host>:29001/ws`.

Il broker non richiede autenticazione.

### Messaggio di benvenuto (server → client)

Appena stabilita la connessione, il broker invia **senza che il client lo chieda**:

```json
{
  "type": "hello",
  "data": {
    "local_ip": "192.168.1.42"
  }
}
```

`local_ip` è l'IP LAN rilevato automaticamente dal broker. Usarlo per mostrare
a quale macchina ci si è connessi.

### Riconnessione

Il broker non implementa logica di riconnessione. Il client deve gestirla:
alla chiusura della socket, ritentare la connessione (es. dopo 1-2 secondi).

---

## Formato messaggi

### Richiesta (client → server)

**Formato preferito — JSON con id:**

```json
{
  "id": 1,
  "command": "ping 192.168.1.1"
}
```

| Campo     | Tipo    | Obbligatorio | Descrizione                                      |
|-----------|---------|--------------|--------------------------------------------------|
| `id`      | integer | no           | Identificatore della richiesta, restituito nella risposta |
| `command` | string  | sì           | Comando da eseguire (vedi sezione Comandi)        |

**Formato alternativo — testo semplice:**

Il broker accetta anche un messaggio testuale (WebSocket opcode `0x1`) con il
solo testo del comando, es. `scan` o `ping 192.168.1.1`. Utile per test rapidi
da terminale WebSocket. In questo caso `id` sarà `null` nella risposta.

### Risposta (server → client)

Tutti i messaggi di risposta hanno `"type": "result"`:

```json
{
  "type": "result",
  "id": 1,
  "ok": true,
  "command": "ping",
  "elapsed_ms": 12.3,
  "data": { ... }
}
```

| Campo        | Tipo           | Descrizione                                         |
|--------------|----------------|-----------------------------------------------------|
| `type`       | string         | Sempre `"result"`                                   |
| `id`         | integer\|null  | Lo stesso `id` della richiesta, o `null`            |
| `ok`         | boolean        | `true` se il comando è andato a buon fine           |
| `command`    | string         | Nome del comando eseguito                           |
| `elapsed_ms` | float          | Tempo di esecuzione in millisecondi                 |
| `data`       | object         | Payload del risultato (varia per comando)           |

---

## Comandi

### `help`

Lista i comandi disponibili.

**Richiesta:**
```json
{ "id": 1, "command": "help" }
```

**Risposta `data`:**
```json
{
  "commands": ["help", "info", "ping <host>", "scan", "scan <cidr>", "services <host>"]
}
```

---

### `info`

Informazioni sul processo broker.

**Richiesta:**
```json
{ "id": 2, "command": "info" }
```

**Risposta `data`:**
```json
{
  "host": "nome-macchina",
  "local_ip": "192.168.1.42",
  "pid": 12345
}
```

---

### `ping <host>`

Esegue un ping ICMP verso un host o IP. Usa il comando `ping -c 1` del sistema.

**Richiesta:**
```json
{ "id": 3, "command": "ping 192.168.1.1" }
```

**Risposta `data` (ok):**
```json
{
  "ok": true,
  "host": "192.168.1.1",
  "elapsed_ms": 4.2,
  "output": "PING 192.168.1.1 ... 1 packets transmitted, 1 received ..."
}
```

**Risposta `data` (fallimento):**
```json
{
  "ok": false,
  "host": "192.168.1.99",
  "elapsed_ms": 1002.0,
  "output": "..."
}
```

`output` è lo stdout/stderr grezzo del comando `ping`.

**Casi di errore `data`:**

| Condizione              | `data.error`              |
|-------------------------|---------------------------|
| Host non specificato    | `"missing host"`          |
| `ping` non trovato      | `"ping command not found"`|
| Timeout                 | `"timeout"`               |

---

### `scan` / `scan <cidr>`

Scansione ping parallela della rete. Senza argomento usa la `/24` dell'IP locale.
Esplora fino a 256 host con 64 thread in parallelo, timeout per host 0.8 s.

**Richiesta senza argomento:**
```json
{ "id": 4, "command": "scan" }
```

**Richiesta con CIDR:**
```json
{ "id": 5, "command": "scan 10.0.0.0/24" }
```

**Risposta `data`:**
```json
{
  "ok": true,
  "network": "192.168.1.0/24",
  "count": 3,
  "hosts": [
    { "ip": "192.168.1.1",  "name": "router.local", "elapsed_ms": 1.2 },
    { "ip": "192.168.1.10", "name": null,            "elapsed_ms": 3.8 },
    { "ip": "192.168.1.42", "name": "my-pc.local",   "elapsed_ms": 0.9 }
  ]
}
```

`name` può essere `null` se il reverse DNS non risponde.

---

### `services <host>`

Esegue un port scan sui 24 porte note in parallelo (timeout 0.5 s per porta)
e tenta di recuperare il banner HTTP/HTTPS dal primo porte aperta trovata.

**Richiesta:**
```json
{ "id": 6, "command": "services 192.168.1.1" }
```

**Risposta `data` (ok):**
```json
{
  "ok": true,
  "host": "192.168.1.1",
  "open_ports": [
    { "port": 22,  "service": "ssh"   },
    { "port": 80,  "service": "http"  },
    { "port": 443, "service": "https" }
  ],
  "http_title": "Router Admin",
  "http_server": "mini_httpd/1.30",
  "device_type": "router-or-ap",
  "device_label": "Router / Access Point"
}
```

| Campo          | Tipo         | Descrizione                                                        |
|----------------|--------------|--------------------------------------------------------------------|
| `open_ports`   | array        | Porte aperte trovate, ordinate per numero                          |
| `http_title`   | string\|null | `<title>` della pagina HTTP/HTTPS (se presente)                    |
| `http_server`  | string\|null | Header `Server:` HTTP (se presente)                                |
| `device_type`  | string       | Identificatore della regola in `broker.map` (vuoto se sconosciuto) |
| `device_label` | string       | Etichetta leggibile dalla regola (vuoto se sconosciuto)            |

**Porte sondate** (24 in totale):

| Porta | Servizio    | Porta | Servizio     |
|-------|-------------|-------|--------------|
| 21    | ftp         | 554   | rtsp         |
| 22    | ssh         | 631   | ipp          |
| 23    | telnet      | 1883  | mqtt         |
| 25    | smtp        | 3306  | mysql        |
| 53    | dns         | 3389  | rdp          |
| 80    | http        | 5000  | upnp         |
| 110   | pop3        | 5432  | postgresql   |
| 143   | imap        | 5900  | vnc          |
| 443   | https       | 6379  | redis        |
| 445   | smb         | 7547  | cwmp         |
| 8080  | http-alt    | 8443  | https-alt    |
| 8883  | mqtt-tls    | 9100  | jetdirect    |

Il matching `device_type`/`device_label` viene eseguito leggendo le regole da
`broker.map` (prima corrispondenza vince). Se nessuna regola corrisponde, entrambi
i campi sono stringa vuota — il dispositivo è candidato all'arricchimento via
`make learn`.

**Caso di errore:**
```json
{ "ok": false, "error": "missing host" }
```

---

### Comando sconosciuto o vuoto

**Risposta `ok: false`:**
```json
{
  "type": "result",
  "id": 1,
  "ok": false,
  "command": "foo",
  "elapsed_ms": 0.0,
  "data": {
    "error": "unknown command: foo",
    "hint": "type help"
  }
}
```

---

## Opcode WebSocket gestiti

| Opcode | Significato | Comportamento broker                     |
|--------|-------------|------------------------------------------|
| `0x1`  | Text frame  | Esegue il comando, risponde con JSON     |
| `0x8`  | Close       | Chiude la connessione                    |
| `0x9`  | Ping        | Risponde con Pong (`0xA`) echo del payload |
| altri  | —           | Ignorati silenziosamente                 |

---

## Avvio del broker

### Diretto

```bash
python3 broker.py
# oppure
python3 broker.py --host 0.0.0.0 --port 29001
```

### Make

```bash
make start          # avvio diretto
make learn          # esplora la LAN e scrive broker.map
make learn CIDR=10.0.0.0/24   # stessa cosa su una rete specifica
make build          # build Docker
make run            # Docker con port mapping
make run-lan        # Docker con --network host (consigliato per scan LAN su Linux)
```

### Docker

```bash
docker run --rm -it -p 29001:29001 heycasa/broker:latest
# oppure con rete host per scan LAN completo:
docker run --rm -it --network host heycasa/broker:latest
```

**Nota**: in Docker con port mapping (`-p`) il broker vede solo i pacchetti
instradati, quindi `scan` potrebbe trovare meno host rispetto a `--network host`.

---

## Esempio di integrazione JavaScript

```js
const ws = new WebSocket("ws://192.168.1.42:29001/ws");
let nextId = 1;

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "hello") {
    console.log("Broker IP:", msg.data.local_ip);
    return;
  }

  if (msg.type === "result") {
    console.log(`[${msg.id}] ok=${msg.ok}`, msg.data);
  }
});

function sendCommand(command) {
  ws.send(JSON.stringify({ id: nextId++, command }));
}

ws.addEventListener("open", () => sendCommand("info"));
```

---

## broker.map — Dizionario canonico di riconoscimento

`broker.map` è un file CSV che fa parte della codebase del broker. Non contiene
host scoperti sulla rete: contiene **regole** che insegnano al broker come
riconoscere dispositivi e servizi. Cresce nel tempo attraverso il processo
collaborativo `make learn`.

### Formato

CSV con header, encoding UTF-8, separatore `,`.

| Colonna                | Descrizione                                                          |
|------------------------|----------------------------------------------------------------------|
| `device_type`          | Identificatore snake-case del tipo, es. `hikvision-dvr`             |
| `label`                | Etichetta leggibile, es. `Hikvision DVR / NVR`                      |
| `require_ports`        | Porte che devono essere **tutte** aperte (subset check), es. `80,554` |
| `http_title_contains`  | Sottostringa case-insensitive nel `<title>` HTTP (vuoto = ignora)   |
| `http_server_contains` | Sottostringa case-insensitive nell'header `Server:` (vuoto = ignora) |
| `notes`                | Descrizione libera del tipo di dispositivo                           |

### Logica di matching

Per ogni regola, **tutti** i campi non vuoti devono corrispondere.
Le porte sono un check di sottoinsieme (le porte extra non invalidano la regola).
I campi testo sono substring case-insensitive.
**La prima regola che fa match vince** — l'ordine nel file conta.

### Esempio

```csv
device_type,label,require_ports,http_title_contains,http_server_contains,notes
camera,IP Camera (RTSP),554,,,Dispositivo con stream RTSP sulla porta 554
hikvision-dvr,"Hikvision DVR / NVR","80,554",Hikvision,,Videosorveglianza Hikvision
printer,Stampante di rete (JetDirect),9100,,,HP JetDirect e compatibili
nas,NAS / File Server,"22,445",,,"SSH + SMB attivi — tipico NAS"
```

### Il processo `make learn`

```
make learn
  → scansiona la LAN (ping sweep)
  → per ogni host: probe delle 24 porte note + banner HTTP
  → tenta il match contro broker.map
  → se riconosciuto: stampa il tipo e prosegue
  → se NON riconosciuto: avvia il dialogo interattivo

    ┌─ Dispositivo sconosciuto: 192.168.1.50
    │  Porte aperte : 80 (http), 554 (rtsp)
    │  HTTP title   : Hikvision Web Client
    │  HTTP server  : Hikvision-Webs
    │  MAC          : aa:bb:cc:11:22:33
    └─ [d] descrivi manualmente   [l] prompt LLM   [s] salta

  → [d]: l'utente inserisce i campi della regola manualmente
  → [l]: il broker mostra un prompt pronto da incollare in un LLM;
          l'utente incolla la risposta CSV e il broker la parsifica
  → nuove regole aggiunte a broker.map → git commit automatico
```

### Invocazione CLI

```bash
python3 broker.py --learn                      # scansiona la /24 locale
python3 broker.py --learn --cidr 10.0.0.0/24   # rete specifica
make learn
make learn CIDR=10.0.0.0/24
```

---

## Limiti e note di sicurezza

- Il broker accetta connessioni da qualsiasi IP sulla LAN senza autenticazione.
- Non esegue comandi shell arbitrari: solo `help`, `info`, `ping`, `scan`, `services`.
- La scansione LAN è limitata a 256 host per rete.
- `services` sonda solo le 24 porte note, non è un port scanner generale.
- Il riconoscimento si basa su `broker.map`: se il file è assente nessun host viene classificato.
- Progettato per uso locale (LAN domestica/aziendale privata), non esporre su internet.
