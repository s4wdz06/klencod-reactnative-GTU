import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.ts';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushPermissionState = NotificationPermission | 'unsupported';

export function usePushNotifications(isAuthenticated: boolean) {
  const isSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<PushPermissionState>(() =>
    isSupported ? Notification.permission : 'unsupported'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const syncExistingSubscription = useCallback(async () => {
    if (!isSupported || !isAuthenticated) {
      setIsSubscribed(false);
      return;
    }
    try {
      setPermission(Notification.permission);
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await apiRequest('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: existing.toJSON() }),
        });
        setIsSubscribed(true);
      } else if (Notification.permission === 'granted') {
        const { publicKey } = await apiRequest<{ publicKey: string }>('/api/push/vapid-public-key');
        const created = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await apiRequest('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify({ subscription: created.toJSON() }),
        });
        setIsSubscribed(true);
      } else {
        setIsSubscribed(false);
      }
    } catch {
      // ignore background sync failures (e.g. iframe restrictions)
    }
  }, [isSupported, isAuthenticated]);

  useEffect(() => {
    void syncExistingSubscription();
  }, [syncExistingSubscription]);

  const enablePush = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('هذا المتصفح لا يدعم إشعارات الخلفية الفورية.');
      return false;
    }
    setBusy(true);
    setError('');
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setError('لم يتم منح إذن الإشعارات في المتصفح أو الهاتف.');
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await apiRequest<{ publicKey: string }>('/api/push/vapid-public-key');
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await apiRequest('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      setIsSubscribed(true);

      // Immediate local heads-up confirmation via Service Worker
      await reg.showNotification('تم تفعيل إشعارات GTU الجزائر', {
        body: 'ستصلك تنبيهات المنصة في أعلى الهاتف حتى عندما يكون التطبيق غير فعال.',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        dir: 'rtl',
        lang: 'ar',
        tag: 'gtu-push-enabled',
      });

      return true;
    } catch (err: any) {
      setError(err?.message || 'تعذر تفعيل إشعارات الهاتف الفورية.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [isSupported]);

  const disablePush = useCallback(async () => {
    if (!isSupported) return;
    setBusy(true);
    setError('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await apiRequest('/api/push/subscribe', {
          method: 'DELETE',
          body: JSON.stringify({ endpoint }),
        });
      }
      setIsSubscribed(false);
    } catch (err: any) {
      setError(err?.message || 'تعذر إيقاف الإشعارات الفورية.');
    } finally {
      setBusy(false);
    }
  }, [isSupported]);

  const sendTestPush = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiRequest<{ sent: number; failed: number; totalDevices: number }>(
        '/api/push/test',
        { method: 'POST' }
      );
      if (res.sent === 0 && isSupported && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification('GTU الجزائر — اختبار الإشعارات', {
          body: 'إشعار تجريبي في أعلى الشاشة للتأكد من الجاهزية.',
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          dir: 'rtl',
          lang: 'ar',
          tag: `gtu-local-test-${Date.now()}`,
        });
      }
      return res;
    } catch (err: any) {
      setError(err?.message || 'تعذر إرسال الإشعار التجريبي.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [isSupported]);

  return {
    isSupported,
    permission,
    isSubscribed,
    busy,
    error,
    enablePush,
    disablePush,
    sendTestPush,
  };
}
