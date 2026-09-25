# Wunschliste

Gaming-Wunschliste im Pixel-Stil (wie der Enchantment Tracker).
Produktlink einfügen → Foto, Name und aktueller Preis des genauen Produkts (inkl. Farbe/Größe aus dem Link).

## Funktionen

- **Link rein, Produkt raus:** Name, Bild der richtigen Variante und Preis direkt aus dem Shop
  (Shopify, WooCommerce, Amazon, Shopware, Magento, JTL, PrestaShop, Next.js-Shops u.v.m.)
- **Immer in Euro:** Dollar, Pfund, Franken usw. werden mit EZB-Kursen umgerechnet;
  wenn der Shop selbst einen Euro-Preis hat, wird der genommen
- **Preise aktualisieren** beim Öffnen der Seite (alle Listen), nicht beim Wechseln der Liste;
  zusätzlich per Knopf „Aktualisieren“ für die offene Liste
- **Mehrere Listen** (z.B. Main, Weihnachten), umbenennen, löschen
- **Login nur mit Namen:** Listen werden im Worker gespeichert und sind auf allen Geräten gleich.
  Unbekannter Name = neues Konto
- **Preis eingeben**, wenn keiner oder nur ein unsicherer gefunden wurde
- Sortiert nach Preis (teuerstes zuerst), Gesamtpreis der Liste oben
- Als App auf den Startbildschirm legbar

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | die komplette Seite (Design, Preiserkennung, Listen, Login) |
| `worker.js` | Cloudflare Worker: liefert die Seite aus, Proxy für Shopseiten (`/proxy`), Konten und Speicher (`/api`), Diagnose (`/debug`) |
| `wrangler.jsonc` | Einstellungen für Cloudflare (Name des Workers, Speicher für Konten) |
| `.assetsignore` | Dateien, die nicht öffentlich ausgeliefert werden |
| `test.html` | Testseite: prüft viele echte Produktlinks und zeigt, was erkannt wird |
| `favicon.svg`, `*.png`, `manifest.webmanifest` | Icons und App-Einstellungen |

## Veröffentlichen (Cloudflare)

Der Worker ist mit diesem Repo verbunden: jeder Push auf `main` wird automatisch gebaut und veröffentlicht.
Der Speicher für die Konten (Durable Object `Account`) wird dabei automatisch angelegt.

Wichtig: `"name"` in `wrangler.jsonc` muss zum Namen des Workers in Cloudflare passen.

## Fehlersuche

- **Preis falsch oder fehlt:** auf den Preis tippen → zeigt, woher er stammt.
- **Diagnose eines Shops:** `https://<worker>.workers.dev/debug?url=<produktlink>` zeigt,
  was der Shop dem Worker zurückliefert (Titel, Meta-Daten, alle Preis-Stellen).
- **Viele Shops auf einmal testen:** `https://<worker>.workers.dev/test.html`

## Hinweis

Ohne Passwort kann jeder, der die Adresse und einen Benutzernamen kennt, diese Liste sehen und ändern.
