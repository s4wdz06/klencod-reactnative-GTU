import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

interface SwPushMessageData {
  json(): unknown;
  text(): string;
}

interface SwExtendableEvent extends Event {
  waitUntil(f: Promise<unknown>): void;
}

interface SwPushEvent extends SwExtendableEvent {
  data: SwPushMessageData | null;
}

interface SwNotificationEvent extends SwExtendableEvent {
  notification: Notification & { data?: { url?: string } };
  action: string;
}

interface SwPushSubscriptionChangeEvent extends SwExtendableEvent {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
}

interface SwWindowClient {
  url: string;
  focused: boolean;
  focus(): Promise<SwWindowClient>;
  navigate?(url: string): Promise<SwWindowClient | null>;
}

interface SwClients {
  matchAll(options?: { type?: 'window' | 'worker' | 'sharedworker' | 'all'; includeUncontrolled?: boolean }): Promise<SwWindowClient[]>;
  openWindow(url: string): Promise<SwWindowClient | null>;
  claim(): Promise<void>;
}

declare global {
  interface Window {
    __WB_MANIFEST?: Array<{ url: string; revision: string | null } | string>;
  }
}

interface SwGlobalScope {
  registration: ServiceWorkerRegistration;
  clients: SwClients;
  location: Location;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install', listener: (ev: SwExtendableEvent) => void): void;
  addEventListener(type: 'activate', listener: (ev: SwExtendableEvent) => void): void;
  addEventListener(type: 'push', listener: (ev: SwPushEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (ev: SwNotificationEvent) => void): void;
  addEventListener(type: 'pushsubscriptionchange', listener: (ev: SwPushSubscriptionChangeEvent) => void): void;
}

const sw = self as unknown as SwGlobalScope;

// Clean old precaches and precache Vite assets
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// Cache Google Fonts stylesheets & font files
registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

// Background Web Push -> Heads-up notification at the top of the phone even when app is closed/inactive
sw.addEventListener('push', (event) => {
  let payload: {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
    type?: string;
  } = {};

  if (event.data) {
    try {
      payload = (event.data.json() as typeof payload) || {};
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'GTU الجزائر — إشعار جديد';
  const body = payload.body || 'لديك تحديث جديد في المنصة الوطنية لخريجي التقنيات الحضرية.';
  const targetUrl = payload.url || '/';
  const tag = payload.tag || `gtu-push-${Date.now()}`;

  const notificationOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
  } = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    dir: 'rtl',
    lang: 'ar',
    tag,
    renotify: true,
    vibrate: [200, 100, 200],
    requireInteraction: false,
    data: { url: targetUrl },
  };

  event.waitUntil(sw.registration.showNotification(title, notificationOptions));
});

// Tap notification banner -> Focus existing app window or open target page
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || '/';
  const targetUrl = new URL(rawUrl, sw.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await sw.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of windowClients) {
        if (client.url.startsWith(sw.location.origin)) {
          await client.focus();
          if (client.navigate && rawUrl !== '/') {
            await client.navigate(targetUrl).catch(() => null);
          }
          return;
        }
      }

      await sw.clients.openWindow(targetUrl);
    })()
  );
});

// Automatically re-register push subscription if browser refreshes endpoint keys
sw.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch('/api/push/vapid-public-key');
        if (!keyRes.ok) return;
        const { publicKey } = (await keyRes.json()) as { publicKey?: string };
        if (!publicKey) return;

        const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
        const base64 = (publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const applicationServerKey = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          applicationServerKey[i] = rawData.charCodeAt(i);
        }

        const subscription =
          event.newSubscription ||
          (await sw.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }));

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        });
      } catch {
        // silent retry on next user visit
      }
    })()
  );
});
