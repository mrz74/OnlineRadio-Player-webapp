"use strict";

/* ---------- Segédfüggvény: soha ne álljon le az egész script amiatt,
   mert egy DOM elem hiányzik (pl. nem minden fájl lett frissítve
   egyszerre a szerveren) - inkább írjon figyelmeztetést a konzolra. ---------- */
function on(el, event, handler) {
  if (!el) {
    console.warn(`[radio] Hiányzó elem, "${event}" esemény nem lett bekötve.`);
    return;
  }
  el.addEventListener(event, handler);
}

/* ---------- Alapértelmezett csatornalista (közvetlenül a kódba égetve,
   hogy file://-ként megnyitva se legyen fetch/CORS-probléma) ---------- */

const DEFAULT_STATIONS = [
  { name: "Retro Rádió", url: "https://icast.connectmedia.hu/5002/live.mp3", genre: "Retro" },
  { name: "Rádió 1", url: "https://icast.connectmedia.hu/5202/live.mp3", genre: "Sláger" },
  { name: "Rocker Rádió", url: "https://rockerradio.online/live.mp3", genre: "Rock" },
  { name: "Sláger FM", url: "https://slagerfm.netregator.hu:7813/slagerfm128.mp3", genre: "Sláger" },
  { name: "BBC World Service", url: "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service", genre: "Hírek" },
  { name: "Aktív Rádió", url: "https://aktivradio.hu:8443/aktiv.mp3", genre: "Sláger" },
];

/* ---------- Állapot és tárolás ---------- */

const LS_STATIONS = "radio_stations_v1";
const LS_FAVORITES = "radio_favorites_v1";
const LS_SETTINGS = "radio_settings_v1";

let stations = [];
let filteredStations = [];
let favorites = new Set();
let settings = { volume: 80, lastStationUrl: null, sortColumn: null, sortReverse: false };
let currentStation = null;
let currentIndex = -1; // az aktuálisan szóló csatorna indexe a filteredStations-ban (navigáláshoz)
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimer = null;
let manualStop = false;

const audio = document.getElementById("audioEl");
const stationNameEl = document.getElementById("stationName");
const statusTextEl = document.getElementById("statusText");
const playBtn = document.getElementById("playBtn");
const playIcon = document.getElementById("playIcon");
const stopBtn = document.getElementById("stopBtn");
const volumeSlider = document.getElementById("volumeSlider");
const volumePct = document.getElementById("volumePct");
const searchInput = document.getElementById("searchInput");
const addBtn = document.getElementById("addBtn");
const favFilterBtn = document.getElementById("favFilterBtn");
const reloadBtn = document.getElementById("reloadBtn");
const dataBtn = document.getElementById("dataBtn");
const importFileInput = document.getElementById("importFileInput");
const stationListEl = document.getElementById("stationList");
const liveIndicator = document.getElementById("liveIndicator");
const vuMeterEl = document.getElementById("vuMeter");

["audio", "stationNameEl", "statusTextEl", "playBtn", "stopBtn", "volumeSlider",
 "volumePct", "searchInput", "addBtn", "favFilterBtn", "reloadBtn", "stationListEl"]
  .forEach((varName) => {
    const val = { audio, stationNameEl, statusTextEl, playBtn, stopBtn, volumeSlider,
      volumePct, searchInput, addBtn, favFilterBtn, reloadBtn, stationListEl }[varName];
    if (!val) {
      console.error(
        `[radio] HIÁNYZIK a(z) "${varName}" elem a HTML-ből - töltsd fel újra az ` +
        `index.html-t is, ne csak az app.js-t/stations.csv-t!`
      );
    }
  });

/* ---------- Play/pause SVG ikon váltása ---------- */

const PLAY_PATH = '<path d="M8 5v14l11-7z"/>';
const PAUSE_PATH = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';

function setPlayIcon(isPlaying) {
  if (!playIcon) return;
  playIcon.innerHTML = isPlaying ? PAUSE_PATH : PLAY_PATH;
}

/* ---------- Dekoratív VU-mérő (csak vizuális effekt) ---------- */

const VU_BAR_COUNT = 14;
let vuBars = [];
let vuAnimationTimer = null;

function setupVuMeter() {
  if (!vuMeterEl) return;
  vuMeterEl.innerHTML = "";
  vuBars = [];
  for (let i = 0; i < VU_BAR_COUNT; i++) {
    const bar = document.createElement("div");
    bar.className = "bar";
    vuMeterEl.appendChild(bar);
    vuBars.push(bar);
  }
}

function pulseVuMeter() {
  vuBars.forEach((bar) => {
    const h = 2 + Math.round(Math.random() * 12);
    bar.style.height = `${h}px`;
  });
}

function setVuActive(active) {
  if (active) {
    if (vuAnimationTimer) return;
    vuAnimationTimer = setInterval(pulseVuMeter, 160);
  } else {
    clearInterval(vuAnimationTimer);
    vuAnimationTimer = null;
    vuBars.forEach((bar) => { bar.style.height = "2px"; });
  }
  if (liveIndicator) liveIndicator.classList.toggle("on", active);
}

/* ---------- Betöltés / mentés ---------- */

/* ---------- CSV betöltés (kódolás-felismeréssel: UTF-8 vagy Windows-1250,
   ugyanúgy mint a desktop verzióban - pl. Jegyzettömbben mentett CSV is
   jó lesz) ---------- */

function decodeWithFallback(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("\uFFFD")) {
    return utf8.replace(/^\uFEFF/, ""); // BOM eltávolítása, ha van
  }
  try {
    return new TextDecoder("windows-1250").decode(buffer);
  } catch (err) {
    return utf8;
  }
}

function splitCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      result.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  const urlIdx = headers.indexOf("url");
  const genreIdx = headers.indexOf("genre");
  if (nameIdx === -1 || urlIdx === -1) return [];

  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const name = (cols[nameIdx] || "").trim();
    const url = (cols[urlIdx] || "").trim();
    const genre = genreIdx >= 0 ? (cols[genreIdx] || "").trim() : "";
    if (name && url) result.push({ name, url, genre });
  }
  return result;
}

async function fetchStationsCSV() {
  const resp = await fetch("stations.csv", { cache: "no-store" });
  if (!resp.ok) throw new Error(`stations.csv HTTP ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  const text = decodeWithFallback(buffer);
  const parsed = parseCSV(text);
  if (parsed.length === 0) throw new Error("A stations.csv üres vagy hibás formátumú");
  return parsed;
}

/* ---------- Állapot betöltés / mentés ---------- */

async function loadInitialData() {
  try {
    const savedStations = localStorage.getItem(LS_STATIONS);
    if (savedStations) {
      stations = JSON.parse(savedStations);
    } else {
      stations = await fetchStationsCSV();
      saveStations();
    }
  } catch (err) {
    console.warn("stations.csv nem elérhető, alapértelmezett lista használata:", err);
    stations = DEFAULT_STATIONS.map((s) => ({ ...s }));
    saveStations();
  }

  if (!Array.isArray(stations) || stations.length === 0) {
    stations = DEFAULT_STATIONS.map((s) => ({ ...s }));
    saveStations();
  }

  try {
    const savedFav = localStorage.getItem(LS_FAVORITES);
    favorites = new Set(savedFav ? JSON.parse(savedFav) : []);
  } catch (err) {
    favorites = new Set();
  }

  try {
    const savedSettings = localStorage.getItem(LS_SETTINGS);
    if (savedSettings) {
      settings = Object.assign(settings, JSON.parse(savedSettings));
    }

  } catch (err) {
    /* marad az alapértelmezett settings */
  }
}

function saveStations() {
  try {
    localStorage.setItem(LS_STATIONS, JSON.stringify(stations));
  } catch (err) {
    console.error("Nem sikerült elmenteni a csatornalistát:", err);
  }
}
function saveFavorites() {
  try {
    localStorage.setItem(LS_FAVORITES, JSON.stringify([...favorites]));
  } catch (err) {
    console.error("Nem sikerült elmenteni a kedvenceket:", err);
  }
}
function saveSettings() {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  } catch (err) {
    console.error("Nem sikerült elmenteni a beállításokat:", err);
  }
}

/* ---------- Szűrés / rendezés / lista renderelés ---------- */

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  let list = stations;
  if (favFilterBtn.classList.contains("btn-active")) {
    list = list.filter((s) => favorites.has(s.url));
  }
  if (query) {
    list = list.filter((s) => s.name.toLowerCase().includes(query));
  }
  filteredStations = [...list];
  applySortToFiltered();
  renderList();
}

function applySortToFiltered() {
  const col = settings.sortColumn;
  if (!col) return;
  filteredStations.sort((a, b) => {
    const av = (a[col] || "").toLowerCase();
    const bv = (b[col] || "").toLowerCase();
    if (av < bv) return settings.sortReverse ? 1 : -1;
    if (av > bv) return settings.sortReverse ? -1 : 1;
    return 0;
  });
  updateSortHeaders();
}

function updateSortHeaders() {
  document.querySelectorAll(".arrow").forEach((el) => {
    const col = el.dataset.col;
    if (col === settings.sortColumn) {
      el.textContent = settings.sortReverse ? "▼" : "▲";
    } else {
      el.textContent = "↕";
    }
  });
}

function renderList() {
  stationListEl.innerHTML = "";
  filteredStations.forEach((st, idx) => {
    const tr = document.createElement("tr");
    if (currentStation && st.url === currentStation.url) {
      tr.classList.add("selected");
    }

    const favTd = document.createElement("td");
    favTd.className = "fav-star";
    favTd.textContent = favorites.has(st.url) ? "★" : "☆";
    favTd.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(st);
    });

    const nameTd = document.createElement("td");
    nameTd.textContent = st.name;

    const genreTd = document.createElement("td");
    genreTd.textContent = st.genre || "";

    const actionsTd = document.createElement("td");
    const menuBtn = document.createElement("button");
    menuBtn.className = "row-menu-btn";
    menuBtn.textContent = "⋮";
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showContextMenu(e, st);
    });
    actionsTd.appendChild(menuBtn);

    tr.appendChild(favTd);
    tr.appendChild(nameTd);
    tr.appendChild(genreTd);
    tr.appendChild(actionsTd);

    tr.addEventListener("click", () => selectAndPlay(st, idx));

    stationListEl.appendChild(tr);
  });
}

document.querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (settings.sortColumn === col) {
      settings.sortReverse = !settings.sortReverse;
    } else {
      settings.sortColumn = col;
      settings.sortReverse = false;
    }
    saveSettings();
    applySortToFiltered();
    renderList();
  });
});

/* ---------- Kedvencek ---------- */

function toggleFavorite(station) {
  if (favorites.has(station.url)) {
    favorites.delete(station.url);
  } else {
    favorites.add(station.url);
  }
  saveFavorites();
  applyFilters();
}

on(favFilterBtn, "click", () => {
  favFilterBtn.classList.toggle("btn-active");
  applyFilters();
});

/* ---------- Keresés ---------- */

on(searchInput, "input", applyFilters);

/* ---------- Lejátszás ---------- */

function selectAndPlay(station, indexInFiltered) {
  if (currentStation && currentStation.url === station.url) {
    togglePlayPause();
    return;
  }
  manualStop = false;
  reconnectAttempt = 0;
  clearTimeout(reconnectTimer);

  currentStation = station;
  currentIndex = indexInFiltered;
  stationNameEl.textContent = station.name;
  statusTextEl.textContent = "Csatlakozás...";
  setPlayIcon(true);

  audio.src = station.url;
  audio.play().catch(() => {
    /* a hibát az 'error'/'stalled' esemény kezeli lejjebb */
  });

  updateMediaSession(station);
  settings.lastStationUrl = station.url;
  saveSettings();
  renderList();
}

function displayStationWithoutPlaying(station, indexInFiltered) {
  // Induláskor CSAK megjeleníti/kijelöli az utoljára hallgatott
  // csatornát - nem indítja el automatikusan a lejátszást. Így az
  // app sosem próbál kattintás nélkül csatlakozni semmihez (ha az a
  // csatorna épp nem elérhető, ezt csak akkor tapasztalod, amikor te
  // magad megnyomod a lejátszás gombot).
  currentStation = station;
  currentIndex = indexInFiltered;
  stationNameEl.textContent = station.name;
  statusTextEl.textContent = "Utoljára hallgatott csatorna - nyomd meg a lejátszás gombot";
  renderList();
}

function togglePlayPause() {
  if (!currentStation) return;
  if (audio.paused) {
    manualStop = false;
    audio.play().catch(() => {});
    setPlayIcon(true);
    statusTextEl.textContent = "Streaming...";
  } else {
    audio.pause();
    setPlayIcon(false);
    statusTextEl.textContent = "Szüneteltetve";
  }
  updatePlaybackState();
}

function stopPlayback() {
  manualStop = true;
  clearTimeout(reconnectTimer);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  setPlayIcon(false);
  setVuActive(false);
  statusTextEl.textContent = "Leállítva";
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = "none";
  }
}

on(playBtn, "click", () => {
  if (!currentStation) {
    if (filteredStations.length > 0) {
      selectAndPlay(filteredStations[0], 0);
    }
    return;
  }
  togglePlayPause();
});

on(stopBtn, "click", stopPlayback);

on(audio, "playing", () => {
  statusTextEl.textContent = "Streaming...";
  reconnectAttempt = 0;
  setVuActive(true);
  updatePlaybackState();
});

on(audio, "pause", () => {
  setVuActive(false);
});

on(audio, "waiting", () => {
  statusTextEl.textContent = "Pufferelés...";
});

on(audio, "error", () => {
  if (manualStop || !currentStation) return;
  const err = audio.error;
  console.warn("[radio] Audio hiba:", err ? `kód ${err.code}` : "ismeretlen");
  attemptReconnect("Hálózati hiba vagy megszakadt kapcsolat");
});

on(audio, "stalled", () => {
  if (manualStop || !currentStation) return;
  attemptReconnect("A stream elakadt");
});

on(audio, "ended", () => {
  // Élő rádiónál rendszerint nem kellene "véget érnie", de ha a szerver
  // egyszerűen lezárja a kapcsolatot, ez az esemény fut le hiba helyett -
  // ugyanúgy kezeljük, mint egy megszakadást.
  if (manualStop || !currentStation) return;
  attemptReconnect("A stream lezárult");
});

function attemptReconnect(reason) {
  if (manualStop || !currentStation) return;
  reconnectAttempt += 1;
  if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
    statusTextEl.textContent = "Hiba: nem sikerült csatlakozni";
    setPlayIcon(false);
    setVuActive(false);
    return;
  }
  const waitS = Math.min(5 * reconnectAttempt, 20);
  statusTextEl.textContent = `Megszakadt a kapcsolat – újrapróbálkozás ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} (${waitS} mp múlva)...`;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (manualStop || !currentStation) return;
    statusTextEl.textContent = "Csatlakozás...";
    const url = currentStation.url;
    audio.src = "";
    audio.src = url;
    audio.play().catch(() => {});
  }, waitS * 1000);
}

/* ---------- Hangerő ---------- */

on(volumeSlider, "input", () => {
  const v = parseInt(volumeSlider.value, 10);
  audio.volume = v / 100;
  volumePct.textContent = `${v}%`;
  settings.volume = v;
  saveSettings();
});

/* ---------- Media Session (zárolt képernyő / értesítési sáv vezérlők) ---------- */

function updateMediaSession(station) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: station.name,
    artist: station.genre || "Magyar Online Rádió Player",
    album: "Élő adás",
    artwork: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
  navigator.mediaSession.setActionHandler("play", () => togglePlayPause());
  navigator.mediaSession.setActionHandler("pause", () => togglePlayPause());
  navigator.mediaSession.setActionHandler("stop", () => stopPlayback());
  navigator.mediaSession.setActionHandler("previoustrack", () => playRelative(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => playRelative(1));
  updatePlaybackState();
}

function updatePlaybackState() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
}

function playRelative(delta) {
  if (filteredStations.length === 0) return;
  let idx = currentIndex >= 0 ? currentIndex : 0;
  idx = (idx + delta + filteredStations.length) % filteredStations.length;
  selectAndPlay(filteredStations[idx], idx);
}

/* ---------- Csatorna hozzáadás / szerkesztés / törlés ---------- */

const overlay = document.getElementById("dialogOverlay");
const dialogTitle = document.getElementById("dialogTitle");
const dlgName = document.getElementById("dlgName");
const dlgUrl = document.getElementById("dlgUrl");
const dlgGenre = document.getElementById("dlgGenre");
const dlgError = document.getElementById("dlgError");
const dlgSave = document.getElementById("dlgSave");
const dlgCancel = document.getElementById("dlgCancel");

let editingStation = null; // null = új csatorna hozzáadása

function openDialog(title, station) {
  editingStation = station || null;
  dialogTitle.textContent = title;
  dlgName.value = station ? station.name : "";
  dlgUrl.value = station ? station.url : "";
  dlgGenre.value = station ? station.genre || "" : "";
  dlgError.textContent = "";
  overlay.classList.remove("hidden");
  dlgName.focus();
}

function closeDialog() {
  overlay.classList.add("hidden");
  editingStation = null;
}

document.addEventListener("keydown", (e) => {
  if (overlay.classList.contains("hidden")) return;
  if (e.key === "Enter") {
    e.preventDefault();
    dlgSave.click();
  } else if (e.key === "Escape") {
    closeDialog();
  }
});

on(addBtn, "click", () => openDialog("Csatorna hozzáadása", null));

on(reloadBtn, "click", async () => {
  if (
    !confirm(
      "Ez felülírja a jelenlegi listát (beleértve a kézzel hozzáadott/szerkesztett csatornákat is) a stations.csv tartalmával. A kedvencek megmaradnak. Folytatod?"
    )
  ) {
    return;
  }
  try {
    stations = await fetchStationsCSV();
    saveStations();
    applyFilters();
    alert(`Sikeresen frissítve: ${stations.length} csatorna betöltve a stations.csv-ből.`);
  } catch (err) {
    alert(`Nem sikerült beolvasni a stations.csv-t:\n${err.message}`);
  }
});

/* ---------- Adatok exportálása / importálása (mentés fájlba,
   visszatöltés fájlból) - hogy egy böngésző-adattörlés (pl.
   hibakereséshez) ne veszítse el véglegesen a kedvenceket/egyedi
   csatornákat. ---------- */

function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    stations,
    favorites: [...favorites],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `radio-player-mentes-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      alert("A fájl nem érvényes JSON - nem sikerült beolvasni.");
      return;
    }
    if (!Array.isArray(data.stations)) {
      alert("A fájl nem tartalmaz érvényes csatornalistát.");
      return;
    }
    const validStations = data.stations.filter(
      (s) => s && typeof s.name === "string" && typeof s.url === "string" && s.name && s.url
    );
    if (validStations.length === 0) {
      alert("A fájlban nem található egyetlen érvényes csatorna sem.");
      return;
    }
    const favCount = Array.isArray(data.favorites) ? data.favorites.length : 0;
    if (
      !confirm(
        `Ez felülírja a jelenlegi csatornalistát (${validStations.length} csatorna) és a kedvenceket ` +
          `(${favCount} db) a fájl tartalmával. Folytatod?`
      )
    ) {
      return;
    }
    stations = validStations.map((s) => ({
      name: s.name,
      url: s.url,
      genre: typeof s.genre === "string" ? s.genre : "",
    }));
    favorites = new Set(Array.isArray(data.favorites) ? data.favorites : []);
    saveStations();
    saveFavorites();
    applyFilters();
    alert(`Sikeresen visszatöltve: ${stations.length} csatorna, ${favorites.size} kedvenc.`);
  };
  reader.onerror = () => {
    alert("Nem sikerült beolvasni a fájlt.");
  };
  reader.readAsText(file);
}

/* ---------- Állomáslista frissítése a radio-browser.info
   közösségi adatbázisból: csak az ÚJ csatornákat adja hozzá, a
   meglévőket (és a kedvenceket) nem módosítja. ---------- */

const RADIO_BROWSER_SERVERS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
];

async function fetchHungarianStations(limit = 500) {
  const query = new URLSearchParams({
    country: "Hungary",
    order: "clickcount",
    reverse: "true",
    limit: String(limit),
    hidebroken: "true",
  });
  let lastError = null;
  for (const base of RADIO_BROWSER_SERVERS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(`${base}/json/stations/search?${query}`, { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data
        .map((st) => ({
          name: (st.name || "").trim(),
          url: (st.url_resolved || st.url || "").trim(),
          genre: ((st.tags || "").split(",")[0] || "").trim(),
        }))
        .filter((st) => st.name && /^https?:\/\//i.test(st.url));
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Egyik szerver sem érhető el (${lastError && lastError.message}).`);
}

function normUrl(url) {
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function findNewStations(existing, fetched) {
  const knownUrls = new Set(existing.map((s) => normUrl(s.url)));
  const knownNames = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  const result = [];
  for (const st of fetched) {
    const nu = normUrl(st.url);
    const nn = st.name.trim().toLowerCase();
    if (knownUrls.has(nu) || knownNames.has(nn)) continue;
    knownUrls.add(nu);
    knownNames.add(nn);
    result.push(st);
  }
  return result;
}

async function updateStationList() {
  let fetched;
  try {
    fetched = await fetchHungarianStations();
  } catch (err) {
    alert(`Nem sikerült a letöltés:\n${err.message}`);
    return;
  }
  // HTTPS oldalról a böngésző nem játszik le sima http:// streamet
  // (kevert tartalom), ezért ilyenkor csak a https címűeket ajánljuk.
  const httpsOnly = location.protocol === "https:";
  if (httpsOnly) fetched = fetched.filter((st) => /^https:/i.test(st.url));

  const fresh = findNewStations(stations, fetched);
  if (fresh.length === 0) {
    alert("Nincs új csatorna, a listád naprakész.");
    return;
  }
  const note = httpsOnly ? "\n(Csak a https címen elérhetők, mert az oldal is https-en fut.)" : "";
  if (!confirm(`${fresh.length} új csatorna található.${note}\n\nHozzáadod a listához? A meglévő csatornáid és a kedvenceid nem változnak.`)) {
    return;
  }
  stations.push(...fresh);
  saveStations();
  applyFilters();
  alert(`${fresh.length} új csatorna hozzáadva.`);
}

on(dataBtn, "click", (event) => {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "⬇ Mentés fájlba (kedvencek + csatornák)";
  exportBtn.addEventListener("click", () => {
    closeContextMenu();
    exportData();
  });

  const importBtn = document.createElement("button");
  importBtn.textContent = "⬆ Visszatöltés fájlból";
  importBtn.addEventListener("click", () => {
    closeContextMenu();
    importFileInput.click();
  });

  const updateBtn = document.createElement("button");
  updateBtn.textContent = "🌐 Állomáslista frissítése (új csatornák)";
  updateBtn.addEventListener("click", () => {
    closeContextMenu();
    updateStationList();
  });

  menu.appendChild(updateBtn);
  menu.appendChild(exportBtn);
  menu.appendChild(importBtn);
  document.body.appendChild(menu);

  const rect = event.target.getBoundingClientRect();
  const menuWidth = 300;
  let left = rect.left;
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 8;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  openMenu = menu;
});

on(importFileInput, "change", () => {
  const file = importFileInput.files && importFileInput.files[0];
  if (file) {
    importDataFromFile(file);
  }
  importFileInput.value = ""; // hogy ugyanaz a fájl újra kiválasztható legyen
});

on(dlgCancel, "click", closeDialog);
on(overlay, "click", (e) => {
  if (e.target === overlay) closeDialog();
});

on(dlgSave, "click", () => {
  const name = dlgName.value.trim();
  const url = dlgUrl.value.trim();
  const genre = dlgGenre.value.trim();

  if (!name || !url) {
    dlgError.textContent = "A név és az URL megadása kötelező.";
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    dlgError.textContent = "Az URL-nek http:// vagy https:// -sal kell kezdődnie.";
    return;
  }
  const duplicate = stations.some(
    (s) =>
      s.name.toLowerCase() === name.toLowerCase() &&
      (!editingStation || s.name.toLowerCase() !== editingStation.name.toLowerCase())
  );
  if (duplicate) {
    dlgError.textContent = "Már van ilyen nevű csatorna a listában.";
    return;
  }

  if (editingStation) {
    const wasCurrent = currentStation && currentStation.url === editingStation.url;
    editingStation.name = name;
    editingStation.url = url;
    editingStation.genre = genre;
    if (wasCurrent) {
      stationNameEl.textContent = name;
    }
  } else {
    stations.push({ name, url, genre });
  }
  saveStations();
  closeDialog();
  applyFilters();
});

function deleteStation(station) {
  if (!confirm(`Biztosan törlöd ezt a csatornát?\n\n${station.name}`)) return;
  stations = stations.filter((s) => s.url !== station.url);
  favorites.delete(station.url);
  saveStations();
  saveFavorites();
  if (currentStation && currentStation.url === station.url) {
    stopPlayback();
    currentStation = null;
    stationNameEl.textContent = "Nincs kiválasztott csatorna";
  }
  applyFilters();
}

/* ---------- Kontextusmenü (szerkesztés / törlés / kedvenc) ---------- */

let openMenu = null;

function closeContextMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
}

function showContextMenu(event, station) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";

  const favBtn = document.createElement("button");
  favBtn.textContent = favorites.has(station.url)
    ? "Eltávolítás a kedvencekből"
    : "Hozzáadás a kedvencekhez";
  favBtn.addEventListener("click", () => {
    toggleFavorite(station);
    closeContextMenu();
  });

  const hr1 = document.createElement("hr");

  const editBtn = document.createElement("button");
  editBtn.textContent = "Szerkesztés...";
  editBtn.addEventListener("click", () => {
    closeContextMenu();
    openDialog("Csatorna szerkesztése", station);
  });

  const delBtn = document.createElement("button");
  delBtn.textContent = "Törlés...";
  delBtn.addEventListener("click", () => {
    closeContextMenu();
    deleteStation(station);
  });

  menu.appendChild(favBtn);
  menu.appendChild(hr1);
  menu.appendChild(editBtn);
  menu.appendChild(delBtn);
  document.body.appendChild(menu);

  const rect = event.target.getBoundingClientRect();
  const menuWidth = 200;
  let left = rect.left;
  if (left + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 8;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  openMenu = menu;
}

document.addEventListener("click", (e) => {
  if (openMenu && !openMenu.contains(e.target)) {
    closeContextMenu();
  }
});

/* ---------- Indítás ---------- */

async function init() {
  try {
    setupVuMeter();
    await loadInitialData();

    volumeSlider.value = settings.volume;
    volumePct.textContent = `${settings.volume}%`;
    audio.volume = settings.volume / 100;

    applyFilters();

    if (settings.lastStationUrl) {
      const idx = filteredStations.findIndex((s) => s.url === settings.lastStationUrl);
      const st = stations.find((s) => s.url === settings.lastStationUrl);
      if (st) {
        displayStationWithoutPlaying(st, idx);
      }
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  } catch (err) {
    console.error("Hiba az alkalmazás indításakor:", err);
    statusTextEl.textContent = "Hiba az induláskor - nyisd meg a konzolt (F12) a részletekért";
  }
}

init();
