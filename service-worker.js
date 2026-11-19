const CACHE_NAME = "radio-player-shell-v7";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./fonts/ChakraPetch-Regular.ttf",
  "./fonts/ChakraPetch-Bold.ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Csak a saját app-shell fájljainkat kezeljük; a rádió stream-eket
  // (más domain, élő adás) mindig a hálózatról kérjük le, változtatás
  // nélkül.
  if (url.origin !== self.location.origin) {
    return;
  }

  // A stations.csv-t SOSE cache-eljük - mindig friss legyen, amikor a
  // felhasználó frissíti az oldalt vagy megnyomja a "Frissítés" gombot.
  if (url.pathname.endsWith("stations.csv")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  // Az app-shell fájloknál (HTML/JS/CSS) HÁLÓZAT-ELSŐBBSÉG: mindig
  // megpróbáljuk a friss verziót letölteni, és csak akkor esünk vissza a
  // gyorsítótárazott verzióra, ha nincs internet. Így egy feltöltött
  // frissítés azonnal látszik, nem ragad be a régi verzió a cache-ben.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
