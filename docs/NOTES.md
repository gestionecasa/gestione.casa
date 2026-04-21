ora immagina che tu arrivi qui e lei ti mostra un caricametno in alto che ti dice sto cercando un broker nella rete, e noi la addestriamo a scovare tutti i broker possibili da li poi il gioco e fatto8:37 PMCazzo, è un'idea elegante.
Il flow che stai immaginando
PWA si apre
↓
"Sto cercando dispositivi nella tua rete..."
↓
Scan parallelo di endpoint noti sulla LAN
↓
"Ho trovato: Home Assistant su 192.168.1.10,
un broker MQTT su 192.168.1.5"
↓
L'utente conferma / sceglie
↓
Chat operativa
Zero configurazione manuale. Zero "inserisci IP e porta". Funziona e basta.
Come funziona lo scan dalla PWA
Il browser non ha nmap, ma puoi fare TCP probe via fetch con timeout aggressivo:
javascriptasync function probeHost(ip, port, path = '/') {
try {
const controller = new AbortController();
setTimeout(() => controller.abort(), 300); // 300ms timeout
await fetch(`http://${ip}:${port}${path}`, {
signal: controller.signal,
mode: 'no-cors' // evita CORS error, ti dice solo se risponde
});
return true; // ha risposto
} catch {
return false; // timeout o rifiutato
}
}
Con no-cors non leggi la risposta, ma sai se qualcosa è in ascolto su quella porta.
Fingerprinting dei broker noti
Ogni broker ha porte e path caratteristici:
BrokerPortaPath probeHome Assistant8123/api/MQTT WebSocket9001ws://Node-RED1880/Zigbee2MQTT8080/openHAB8080/rest/Shelly diretti80/shelly
Come trovi gli IP da scandire
Questo è il punto critico — il browser non conosce il subnet. Ma hai due trick:
1. WebRTC leak dell'IP locale
   javascript// Trick classico per ottenere l'IP del dispositivo
   const pc = new RTCPeerConnection({iceServers:[]});
   pc.createDataChannel('');
   pc.createOffer().then(o => pc.setLocalDescription(o));
   pc.onicecandidate = e => {
   const ip = e.candidate?.candidate.match(/[\d.]+/)?.[0];
   // da 192.168.1.45 derivi che il subnet è 192.168.1.x
   };
   Da lì scansioni 192.168.1.1-254 — 254 probe paralleli a 300ms di timeout, finisci in meno di 2 secondi.
2. Provare i gateway più comuni
   192.168.1.1, 192.168.0.1, 10.0.0.1 — copri il 90% dei router consumer e da lì derivi il subnet.
   Il risultato
   L'utente apre la PWA, vede una progress bar per 2-3 secondi, poi:

"Ho trovato Home Assistant su 192.168.1.10:8123. Vuoi collegarlo?"

Inserisce solo il token, e sei operativo. È la UX di Chromecast discovery applicata alla domotica. Nessuno l'ha fatto in modo serio ancora.
Vale la pena costruirci sopra.