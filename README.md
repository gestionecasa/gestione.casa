# gestione.casa

App client-side statica per Hey Casa.

## Sviluppo locale

Avvia il server statico di sviluppo:

```sh
make dev
```

Poi apri:

```text
http://localhost:8765/
```

Il server di sviluppo vive in `contrib/dev-server.py`. Non contiene logica applicativa:
serve solo i file statici dalla root del progetto con header no-cache.

## PWA e service worker

In locale (`localhost`, `127.0.0.1`, `::1`) la app non registra il service worker.
Se nel browser ne esiste uno vecchio, `assets/pwa.js` prova a deregistrarlo al load.

Il file `sw.js` resta usato per deploy/PWA reali, fuori dal localhost.
