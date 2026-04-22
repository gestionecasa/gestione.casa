# gestione.casa

App client-side statica per Hey Casa.

## Sviluppo locale

Avvia il server statico di sviluppo via Docker:

```sh
make dev
```

Poi apri:

```text
http://localhost:8765/
```

Il server di sviluppo è il servizio Docker Compose `web`, basato su `httpd:2.4-alpine`.
Non contiene logica applicativa: serve solo i file statici dalla root del progetto con
header no-cache.

Configurazione:

- `docker-compose.yml`: servizio `web` sulla porta `8765`
- `contrib/httpd-dev.conf`: configurazione Apache locale
- `contrib/dev-sw.js`: service worker di sviluppo che si deregistra e pulisce le cache

Per fermarlo:

```sh
make dev-down
```

## Broker LAN

Per cercare dispositivi nella rete locale serve il broker HeyCasa:

```sh
make broker
```

Il broker espone WebSocket su `localhost:29001` e viene usato dalla app per
`scan_lan_devices`, `find_lan_device`, `inspect_lan_device` e `ping_lan_host`.

Per fermarlo:

```sh
make broker-down
```

## PWA e service worker

In locale (`localhost`, `127.0.0.1`, `::1`) la app non registra il service worker.
Se nel browser ne esiste uno vecchio, `assets/pwa.js` prova a deregistrarlo al load.
In piu, il server Docker serve `/sw.js` usando `contrib/dev-sw.js`, non il worker PWA
di produzione.

Il file `sw.js` resta usato per deploy/PWA reali, fuori dal localhost.
