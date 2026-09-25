# Wishly

**Wishly** – Gaming-Wunschliste im Pixel-Stil (wie der Enchantment Tracker).
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
- **Als App installierbar:** Knopf „APP INSTALLIEREN“ (ist sichtbar, solange die App nicht installiert ist;
  kann der Browser nicht direkt installieren, zeigt er die Schritte für Android, iPhone, Samsung, PC).
  Eigenes Icon, Vollbild, startet auch ohne Netz, erscheint im **Teilen-Menü** anderer Apps,
  Kurzbefehl „Produkt hinzufügen“ beim langen Tippen aufs Icon

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | die komplette Seite (Design, Preiserkennung, Listen, Login) |
| `worker.js` | Cloudflare Worker: liefert die Seite aus, Proxy für Shopseiten (`/proxy`), Konten und Speicher (`/api`), Diagnose (`/debug`) |
| `wrangler.jsonc` | Einstellungen für Cloudflare (Name des Workers, Speicher für Konten) |
| `.assetsignore` | Dateien, die nicht öffentlich ausgeliefert werden |
| `test.html` | Testseite: prüft viele echte Produktlinks und zeigt, was erkannt wird |
| `favicon.svg`, `*.png`, `manifest.webmanifest` | Icons und App-Einstellungen |
| `sw.js` | Service Worker: App-Start ohne Netz (Preise und Konten werden nie zwischengespeichert) |

## Adressen

- `https://wishly.adri-cb7.workers.dev/` (Standard, Worker heißt `wishly`)
- `https://dnoadrian.at/wishly/` – über eine Worker-Route `dnoadrian.at/wishly*` (Domain muss in Cloudflare sein).
  Die Seite verwendet nur relative Pfade und funktioniert deshalb unter beiden Adressen.

## Veröffentlichen (Cloudflare)

Jeder Push auf `main` wird von GitHub Actions (`.github/workflows/deploy.yml`) mit `wrangler deploy` veröffentlicht.
Dafür braucht das Repo zwei Secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` – in Cloudflare: Profil → API Tokens → Create Token → Vorlage „Edit Cloudflare Workers“
- `CLOUDFLARE_ACCOUNT_ID` – die Konto-ID (steht in der Dashboard-Adresse `dash.cloudflare.com/<konto-id>/…`)

Veröffentlichung von Hand: Actions → Cloudflare Deploy → Run workflow.
Der Speicher für die Konten (Durable Object `Account`) und die Route `dnoadrian.at/wishly*` stehen in `wrangler.jsonc`.

## Fehlersuche

- **Preis falsch oder fehlt:** auf den Preis tippen → zeigt, woher er stammt.
- **Diagnose eines Shops:** `https://<worker>.workers.dev/debug?url=<produktlink>` zeigt,
  was der Shop dem Worker zurückliefert (Titel, Meta-Daten, alle Preis-Stellen).
- **Viele Shops auf einmal testen:** `https://<worker>.workers.dev/test.html`

## Hinweis

Ohne Passwort kann jeder, der die Adresse und einen Benutzernamen kennt, diese Liste sehen und ändern.
