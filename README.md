# ❄ SNOWBALL WARFARE

Stilisierter Multiplayer-Schneeballshooter im Schneesturm.
**Ein Treffer – und du bist raus.**

Ein komplett statisches Browser-Spiel: Three.js für die Optik, PeerJS/WebRTC für
das Multiplayer-Netzwerk. Kein Server-Prozess, kein Account, kein Download –
läuft auf jedem Static-Host (Vercel, GitHub Pages, Netlify …).

---

## Spielprinzip

| | |
|---|---|
| **Ziel** | 15 Eliminierungen pro Runde |
| **Treffer** | Ein Körpertreffer schaltet den Gegner aus |
| **Wurf** | Linksklick halten lädt die Wucht auf, loslassen wirft – währenddessen friert die Welt ein (Zeitlupe) |
| **Zielhilfe** | Beim Aufladen zeigt eine gepunktete Bahn samt Aufschlagring die echte Flugkurve (Schwerkraft, Luftwiderstand, Wind) |
| **Respawn** | Automatisch nach 3,2 Sekunden |
| **Karte** | Hügel, dichter Fichtenwald, Holzhütte, gefrorener See |
| **Bots** | 0–5 KI-Gegner (Frost, Yeti, Eiswolf) füllen den Raum |

### Steuerung

| Taste | Aktion |
|---|---|
| `W A S D` | Bewegen |
| `Shift` | Sprinten |
| `Space` | Springen |
| `Maus` | Zielen |
| `Linke Maustaste` | Schneeball aufladen (Welt friert ein, Ziellinie erscheint) & werfen |
| `Tab` | Rangliste |
| `M` | Ton an/aus |
| `F` | FPS-Anzeige (mit Render-Skalierung) |
| `Esc` | Pause |

---

## Multiplayer

Es gibt keinen dedizierten Server. Der **Host ist autoritativ**:

1. Ein Spieler erstellt einen Raum und erhält einen 5-stelligen Code (z. B. `9RYRF`).
2. Der Host läuft im Browser und simuliert Bewegung, Flugbahnen, Treffer und Punkte.
3. Gäste verbinden sich über den Code per WebRTC-Datenkanal (PeerJS-Signalisierung).
4. Der Host schickt 20-mal pro Sekunde Snapshots, Gäste senden Eingaben und Würfe.

Damit funktioniert das Spiel auf Vercel & Co., ohne WebSocket-Server.
Maximal 8 menschliche Spieler pro Raum, beliebig viele Zuschauer-Bots.

---

## Tests

```bash
node tools/test-round.mjs   # Wurf, Treffer, Kill, Respawn, Schutz, Ablehnungen
```

Der Test läuft die autoritative Simulation (`public/shared/sim.js`) ohne Browser
durch und prüft Treffer, Punktestand, Respawn-Timer und Spawn-Schutz.

## Performance

Das Spiel hält die Bildrate selbst: Ein Governor skaliert die Renderauflösung
(1.00× → 0.60×) und schaltet bei Bedarf Bloom, Schneefall, Glitzer und Nebel
ab, ohne Simulation oder Netzwerk zu verändern. Die aktuelle Stufe steht in der
optionalen FPS-Anzeige (`F`).

## Lokal starten

```bash
npm install          # nur für den Dev-Server nötig
npm start            # http://localhost:5173
```

Der Server (`serve.mjs`) liefert nur Dateien aus `public/` aus.
Three.js und PeerJS liegen bereits gebündelt unter `public/vendor/`,
im Spielbetrieb wird also nichts von einem CDN geladen.

### Debug-Modus

`http://localhost:5173/?debug=1` aktiviert Test-Hooks:

```js
__sbw.G              // Spielzustand
__sbw.step(1/60)     // einen Frame manuell simulieren
__sbw.startHost()    // Raum erstellen
__sbw.startJoin('CODE')
__capture(900)       // Screenshot als Data-URL
```

---

## Deployment (Vercel)

1. Projekt mit dem GitHub-Repo verbinden.
2. **Root Directory:** `public`
3. **Framework Preset:** Other / kein Build-Schritt
4. Deploy – fertig. Es werden ausschließlich statische Dateien ausgeliefert.

`public/vercel.json` setzt langfristiges Caching für die Vendor-Dateien.

---

## Projektstruktur

```
snowball-war/
├─ public/
│  ├─ index.html          Menü, HUD, Pause, Death-Screen
│  ├─ styles.css          UI-Design
│  ├─ src/
│  │  ├─ main.js          Loop, Input, Wurf, Post-Processing, HUD
│  │  ├─ scene.js         Terrain, Wald, Hütte, Licht, Schneefall
│  │  ├─ character.js     Spielermodelle & First-Person-Hand
│  │  ├─ fx.js            Partikel, Fußspuren, Einschläge
│  │  ├─ audio.js         komplett synthetisierter Sound (WebAudio)
│  │  └─ net.js           PeerJS-Host/Gast, Raumcodes
│  ├─ shared/
│  │  ├─ world.js         Terrainmathematik, Spawns, Hindernisse
│  │  └─ sim.js           autoritative Simulation (Host)
│  ├─ vendor/             three.js r187, peerjs
│  └─ vercel.json         Header & Caching für Vercel
└─ serve.mjs              Dev-Server
```

---

## Technik-Highlights

- **Rendering:** HDR-Render-Target (HalfFloat) → Threshold/Bloom → ACES-Tonemapping,
  kalte Farbkorrektur, Filmkorn, Vignette, chromatische Aberration.
- **Welt:** prozedurales Terrain mit Vertex-Farben, Fichten-Instancing in Clustern,
  Schneekappen, Wurzeldriften, gefrorener See mit Rissen, Hütte mit Rauch & Eisenzapfen.
- **Atmosphäre:** Custom-Sky-Shader mit Sonnenscheibe und Cirrus, exponentielle
  Distanznebel, 7.500 Schneeflocken (GPU-Punkte) und glitzernde Eiskristalle.
- **Physik:** parabelfliegende Schneebälle mit Sub-Stepping, Boden-/Objekt-/Körper-
  Kollision, Host-autoritativ mit Spawn-Schutz.
- **Figuren:** prozedurale Stilisierung mit großem Kopf, klobigen Fäustlingen und Stiefeln;
  der Kopf ist **eine** modellierte Fläche (Schädel, Brauenwulst, Wangen, Kinn, Nase) statt
  gestapelter Kugeln, Augen und Mund sind hochauflösende Decals auf der echten Oberfläche,
  Mütze und Haaransatz sind berechnete Profile; Kugelgelenke an Schulter, Ellbogen, Hüfte
  und Knie verhindern Lücken bei jeder Beugung.
- **Animation:** gewichtsbasierter Lauf-Zyklus (Fersenkontakt → Abdruck → Abstoß), Becken-
  und Oberkörper-Gegendrehung, Armpendel mit Ellbogenbeuge, Lean in Kurven, Blinzeln,
  Atem-Idle mit gelegentlichem Blick, Wurf in Schlüsselposen (Ausholen → Schnapp → Nach-
  schwingen) und Treffer-Flinch; alle Übergänge werden weich geblendet.
- **Game Feel:** Zeitlupen-Freeze beim Aufladen, Ziellinie mit Aufschlagring, FOV-Kick,
  Kamera-Recoil, Landestaub, Fußspuren und Atemwolken.
- **Sound:** Wind, Schritte, Wurf, Einschläge und UI-Töne live per WebAudio synthetisiert.

---

© 2026 · Ein Treffer. Tot.
