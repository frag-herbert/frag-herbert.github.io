# Frag Herbert – dein Stellplatzbuch

Stellplätze sammeln, beschreiben und wiederfinden. Statische Web-App ohne Server: alle Daten liegen in der Datenbank des Browsers,
gesichert wird mit einer Backup-Datei. Ohne Build-Werkzeug, ohne Fremdskripte (MapLibre GL liegt unter `maplibre/`).

| Datei | Aufgabe |
|---|---|
| `app.js`, `app.css`, `blatt.js` | Oberfläche, ziehbares Blatt |
| `karte.js`, `kartenstil.js` | Karte (MapLibre), Ebenen |
| `daten.js` | Datenschicht für die Oberfläche, Fotos verkleinern (EXIF samt GPS fällt weg) |
| `plaetze.js` | Rechenregeln: Nächte, Zusammenführen, Koordinaten lesen, fremde Daten prüfen |
| `speicher.js` | IndexedDB |
| `backup.js`, `zip.js` | Backup erstellen, prüfen, einspielen |
| `abgleich.js` | Abgleich eines Imports mit dem Bestand: Gruppen, Fragen, Auflösen (Regeln ohne Oberfläche) |
| `import.js` | GPX, KML/KMZ, GeoJSON, Google Takeout, CSV, Fotos mit GPS → geprüfte Vorschau, rückgängig machbar |
| `ha.js` | Verbindung zu Home Assistant: Anmeldung, Stand holen, Bilder (nur lesen, siehe unten) |
| `info.js` | Texte Datenschutz und Lizenzen (Einstellungen) |
| `sw.js` | Offline: App-Dateien, angesehene Kartenkacheln |

```bash
tools/server.py                      # http://localhost:8790/ (nur dieser Rechner)
tools/pruefen.py                     # Versionen, Vollständigkeit, Lizenzdateien, Datenschutztext, keine privaten Angaben
tools/test.py <ausgabeordner>        # Durchlauf in WebKit und Chromium (Playwright)
tools/uebergang.py <git-Ref> [ordner] # Update von <git-Ref> auf den Arbeitsstand: Daten müssen erhalten bleiben
```

**Neue Version:** `VERSION` in `app.js` und `sw.js` erhöhen, die `?v=` der geänderten Dateien überall angleichen, `tools/pruefen.py`, `tools/test.py`.

**Veröffentlichen:** Push auf `main` → `.github/workflows/seite.yml` prüft mit `tools/pruefen.py` und stellt nur bei Erfolg
die App-Dateien (ohne `tools/`) auf <https://frag-herbert.github.io/>. Vorher lokal `tools/test.py` und `tools/uebergang.py <zuletzt veröffentlicht>`.

## Testversion (0.x)

Bis 1.0 zeigt die App „Testversion“ und erinnert früher an Backups. Funktionen dürfen sich ändern, **gespeicherte Daten nicht verloren gehen**.

## Datenformat

Tester haben echte Daten in ihrem Browser. Jede neue Version muss Datenbank und Backups jeder früheren Version lesen können.

- **Datenbank** (`speicher.js`, `FASSUNG`): Aufbau nur über neue Schritte `if (e.oldVersion < N)` ändern, bestehende nie anfassen.
  Felder in den Datensätzen dürfen dazukommen; fehlende Felder müssen beim Lesen einen Vorgabewert bekommen (`aufbereiten`).
- **Backup** (`backup.js`, `FASSUNG`): neue Felder sind erlaubt, solange ältere Versionen sie übergehen können. Ändert sich die Bedeutung
  eines Feldes, Fassung erhöhen; ältere Fassungen werden weiter eingelesen. Ein Backup aus einer neueren Fassung lehnt die App mit Hinweis ab.
- Vor jeder Veröffentlichung: `tools/uebergang.py <zuletzt veröffentlichter Commit>`.

## Home Assistant (optional, nur lesen)

Wer eine eigene Home Assistant mit der Integration `frag_herbert` hat, kann sich unter Einstellungen → Home Assistant verbinden.

- Anmeldung über die Anmeldeseite von HA (OAuth, `client_id` = Adresse der App); Token nur in diesem Browser.
- `GET <HA>/api/frag_herbert/stand` (ganzer Stand im Datenformat unten, `quelle: "ha"`) und `…/foto/<ID>[?groesse=vorschau]`, beide mit Token.
  Die Adresse der App muss in HA unter `cors_allowed_origins` stehen.
- Die Plätze aus HA liegen in einer **eigenen Datenbank** (`frag-herbert-ha`); umschalten unter Einstellungen → Plätze (lädt neu).
  Dort ist alles nur zum Ansehen: Bearbeiten ist ausgeblendet, `speicher.js` lehnt jedes Schreiben ab.
- Nächte: `naechte` (von Hand) vor `naechte_auto` (aus den Messungen in HA) vor „Übernachtung“.
- Test: `tools/test.py` startet `tools/server.py` mit einer HA-Attrappe (`HERBERT_HA_ATTRAPPE`).
- Schreiben nach HA kommt später (Abgleich mit Stand-Nummer und Warteschlange).

## Lizenz

Eigener Code: [MIT](LICENSE). Bestandteile Dritter und Kartenquellen: [HINWEISE.md](HINWEISE.md); wegen der Luftbilder von EOX (CC BY-NC-SA) nicht kommerziell.
