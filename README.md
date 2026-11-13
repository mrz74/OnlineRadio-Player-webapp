# Magyar Online Rádió Player - Webapp (PWA)

Ez ugyanaz a rádiólejátszó, csak böngészőben futó, telepíthető webappként
(PWA). Nem kell hozzá Android Studio, nincs build lépés - csak fel kell
tenni valahova, ahonnan a telefon eléri.

## Amit tud

- Csatornalista `stations.csv`-ből (kódolás-felismeréssel), keresés,
  Csatorna/Műfaj szerinti rendezés
- Kedvencek (★, kattintható), "csak kedvencek" szűrő
- Csatorna hozzáadása/szerkesztése/törlése (⋮ menü soronként, + gomb)
- Automatikus újracsatlakozás hálózati megszakadás esetén (5 próbálkozás,
  növekvő várakozással), a stream végét jelző `ended` eseményt is kezeli
- Lejátszás/szünet/leállítás megbízható, vektoros (SVG) ikonokkal - nem
  betűtípus-glifával, így minden eszközön egyformán jelenik meg
- Régi kvarc kijelző stílus: a `Segment14` betűtípus `@font-face`-fel
  beágyazva, mélyített "üveg" panelen, dekoratív animált VU-mérővel és
  "ÉLŐ ADÁS" jelzéssel lejátszás közben
- Zárolt képernyő / értesítési sáv vezérlők (Media Session API):
  lejátszás/szünet/leállítás/előző/következő csatorna
- Telepíthető (PWA), hálózat-elsőbbségű Service Worker (mindig a
  legfrissebb verziót tölti be, nem ragad be régi cache)
- Dialógus Enter-rel menthető, Escape-pel bezárható
- **Induláskor csak megjeleníti** az utoljára hallgatott csatornát, nem
  próbál automatikusan csatlakozni hozzá - a kapcsolódás csak akkor
  indul, ha ténylegesen megnyomod a lejátszás gombot
- **Adatok mentése/visszatöltése** ("💾" gomb): a kedvencek és a kézzel
  hozzáadott/szerkesztett csatornák egy `.json` fájlba menthetők, majd
  onnan visszatölthetők - hasznos, ha egy böngésző-adattörlés (pl.
  hibaelhárításhoz) törölné a helyi tárolt adatokat

## Miért tud háttérben szólni / értesítési sávban vezérelhető lenni?

A `<audio>` elem + a böngésző beépített **Media Session API**-ja miatt.
Ha a Chrome-ban telepíted az appot ("Hozzáadás a kezdőképernyőhöz"), a
rádió a zárolt képernyőn és az értesítési sávban is megjelenik
lejátszás/szünet gombokkal, és háttérben (más appra váltva, kikapcsolt
képernyővel) is szól - ameddig magát az appot nem zárod be teljesen
(pl. kihúzod a legutóbbi alkalmazások közül).

**Korlát**: ez nem 100%-ban ugyanolyan megbízható, mint egy natív app
foreground service-e - hosszabb inaktivitás vagy alacsony memória esetén
Android időnként leállíthatja a háttérben futó lapokat. A gyakorlatban
Chrome-on ez a legtöbbször jól működik, de ha ez kritikus, egy natív
Kotlin/ExoPlayer alapú app (amit korábban elkezdtem) ebben megbízhatóbb.

## Mi NEM működik böngészőből (natív app-limitáció)

- **"Most szól" számcím** - ez az Icecast szerver a hangfolyamba ágyazott
  (ICY) metaadata, amit a böngésző `<audio>` eleme nem tesz elérhetővé
  JavaScript számára. Ehhez egy szerver oldali proxy kellene, ami
  kicsomagolja és külön csatornán (pl. WebSocket) elküldi - ha ez fontos,
  szólj, és megcsinálom, de kell hozzá egy hosztolt backend is.
- **http:// (nem https://) stream-ek** böngészőben, ha az oldal maga
  https-en fut, blokkolva lehetnek (kevert tartalom). A csatolt listában
  a BBC World Service http-s - ha nem szól, cseréld le egy https-es URL-re.

## Telepítés a telefonodra

Ahhoz, hogy telepíthető legyen (Add to Home Screen) és a Media Session is
működjön, **https-en vagy localhost-on** kell futnia - fájlként megnyitva
(`file://`) a böngésző korlátozásai miatt nem minden funkció megy.

**Legegyszerűbb - ingyenes statikus hosting:**

1. Hozz létre egy ingyenes GitHub repót, töltsd fel ezt a mappát TELJES
   egészében (`index.html`, `app.js`, `styles.css`, `manifest.json`,
   `service-worker.js`, `stations.csv`, `icons/`, `fonts/`)
2. Kapcsold be a GitHub Pages-t a repó Settings > Pages menüjében
3. A kapott `https://<felhasználónév>.github.io/<repónév>/` címet nyisd
   meg a telefonod Chrome-jában
4. Chrome menü (⋮) > **"Alkalmazás telepítése"** / "Hozzáadás a
   kezdőképernyőhöz"

Alternatívák: Netlify, Vercel, Cloudflare Pages - mindegyik ingyenes,
és csak ezt a mappát kell rájuk feltölteni (nincs build lépés).

**Otthoni hálózaton tesztelésre** (nem installálható PWA-ként https
nélkül, de böngészőben kipróbálható):
```
python -m http.server 8000
```
majd a telefonról (ugyanazon wifin) `http://<géped-IP-je>:8000`.

## Csatornalista (stations.csv)

A lista most már **ugyanúgy a `stations.csv`-ből töltődik be**, mint a
desktop verziónál - nincs a kódba égetve. Formátum ugyanaz:

```
name,url,genre
Kedvenc Rádióm,https://valodi-stream-cim/stream.mp3,Pop
```

- UTF-8 és Windows-1250 (Jegyzettömb "ANSI") kódolást egyaránt felismeri.
- **Első indításkor** beolvassa a `stations.csv`-t, és elmenti a böngésző
  `localStorage`-ába - onnantól minden hozzáadás/szerkesztés/törlés ott
  történik (a fájlt böngészőből nem tudja közvetlenül visszaírni, ez
  böngészős biztonsági korlát).
- Ha utólag módosítod a `stations.csv`-t a szerveren, és szeretnéd, hogy
  az app is lássa, nyomd meg a keresősáv melletti **⟳ "Frissítés a
  stations.csv-ből"** gombot - ez felülírja a jelenlegi listát a fájl
  tartalmával (megerősítést kér, mert a kézzel hozzáadott csatornák
  felülíródnak; a kedvencek megmaradnak, mert azok külön tárolódnak).
- **Ha a `stations.csv` bármiért nem elérhető** (pl. elfelejtetted
  feltölteni, vagy `file://`-ként nyitod meg fájlként), az app automatikusan
  egy beépített, néhány elemes alapértelmezett listára vált vésztartalékként
  - így sosem marad teljesen üres.
- A `localStorage`-ban tárolt adatok (csatornalista-módosítások, kedvencek,
  beállítások) **csak azon az egy telefonon/böngészőben** érvényesek, nem
  szinkronizálódnak automatikusan másik eszközre.

## Ha mégis szeretnél egy letölthető .apk fájlt

Ez a webapp (változtatás nélkül) becsomagolható **Trusted Web Activity**-vel
valódi, telepíthető `.apk`-vá a Google **Bubblewrap** CLI-vel:

```
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://<a-te-hosztolt-url-ed>/manifest.json
bubblewrap build
```

Ehhez kell: Node.js (megvan), és a Bubblewrap letölti magának a szükséges
Android SDK/JDK-t (internetkapcsolat kell hozzá, kb. 1-2 GB). Az így
gyártott apk ugyanezt a webes kódot futtatja egy Chrome "csomagolásban",
tehát semmit nem kell újraírni hozzá - csak ezt a build lépést kell
lefuttatnod a saját gépeden.

## Amit érdemes lehet még hozzáadni

1. **Szerver oldali ICY metaadat proxy** - "most szól" cím megjelenítéséhez.
2. **Cloud szinkronizáció** a csatornalistához/kedvencekhez (pl. egy
   egyszerű backend + fiók), hogy több eszközön is ugyanaz legyen.
3. **Bitráta kijelzés** - CORS-korlátok miatt a legtöbb Icecast szerver
   nem engedi lekérdezni böngészőből; csak akkor működne, ha a szerver
   küld `Access-Control-Allow-Origin` fejlécet.
