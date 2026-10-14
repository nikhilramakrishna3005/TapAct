// TapAct app-shell service worker.
// Activity records live only in localStorage and are never sent over the network,
// so this worker only ever caches the public app shell: the HTML page, hashed
// build assets, the manifest and icons.
const CACHE_NAME = "tapact-shell-v2";
const SHELL_URL = "/";
const PRECACHE_URLS = [
  SHELL_URL,
  "/manifest.webmanifest",
  "/pwa-icons/icon-192.png",
  "/pwa-icons/icon-512.png",
  "/pwa-icons/apple-touch-icon.png",
];

function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/pwa-icons/") ||
    url.pathname === "/manifest.webmanifest"
  );
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE_URLS);
  // Pull in the build assets referenced by the shell so the first offline launch works.
  const shell = await cache.match(SHELL_URL);
  if (!shell) return;
  const html = await shell.text();
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) ?? []);
  await Promise.all(
    [...assets].map((asset) => cache.add(asset).catch(() => undefined)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function safeNotificationPath(raw) {
  try {
    const url = new URL(String(raw || ""), self.location.origin);
    if (url.origin !== self.location.origin || url.pathname !== "/") return "/?tab=duels";
    if (url.searchParams.get("tab") !== "duels") return "/?tab=duels";
    const duel = url.searchParams.get("duel");
    if (duel && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(duel)) {
      return "/?tab=duels";
    }
    const next = new URL("/", self.location.origin);
    next.searchParams.set("tab", "duels");
    if (duel) next.searchParams.set("duel", duel);
    return `${next.pathname}${next.search}`;
  } catch {
    return "/?tab=duels";
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.slice(0, 80) : "TapAct";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 180) : "";
  const target = safeNotificationPath(payload.url);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/pwa-icons/icon-192.png",
      badge: "/pwa-icons/icon-192.png",
      tag: typeof payload.tag === "string" ? payload.tag.slice(0, 80) : "tapact",
      data: { url: target },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeNotificationPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if (typeof client.navigate === "function") {
          await client.navigate(target);
        }
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === SHELL_URL) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(SHELL_URL)) ?? Response.error()),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
