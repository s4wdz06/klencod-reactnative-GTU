import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest, flushOfflineQueue, getOfflineQueue, setAuthToken } from '../lib/api.ts';
import { ChatMessage, CurrentUser, NotificationItem } from '../types/gtu.ts';
import { useOnlineStatus } from '../hooks/usePWA.ts';

export type WsEventPayload =
  | { type: 'connected'; userId: number }
  | { type: 'message:new'; message: ChatMessage }
  | {
      type: 'message:updated';
      conversationId: number;
      messageId: number;
      content: string;
      editedAt: string;
    }
  | { type: 'message:deleted'; messageId: number; conversationId: number }
  | { type: 'message:pinned'; conversationId: number; messageId: number; isPinned: boolean }
  | {
      type: 'message:reaction';
      conversationId: number;
      messageId: number;
      actorUserId: number;
      emoji: string;
      isAdded: boolean;
      counts: Array<{ emoji: string; count: number }>;
    }
  | {
      type: 'typing';
      conversationId: number;
      userId: number;
      displayName: string;
      isTyping: boolean;
    }
  | { type: 'room:presence'; conversationId: number; onlineCount: number }
  | {
      type: 'conversation:updated';
      conversationId: number;
      lastMessageAt: string;
      lastMessagePreview: string;
      lastMessageSender: string;
      senderId: number;
    }
  | {
      type: 'conversation:read';
      conversationId: number;
      readerId: number;
      lastReadMessageId: number;
    }
  | { type: 'notification:new'; notification: NotificationItem };

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  login: (identifier: string, password: string) => Promise<CurrentUser>;
  register: (payload: Record<string, unknown>) => Promise<CurrentUser>;
  loginWithGoogle: () => Promise<CurrentUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  subscribeWs: (handler: (ev: WsEventPayload) => void) => () => void;
  sendWs: (payload: Record<string, unknown>) => boolean;
  isWsConnected: boolean;
  offlineSyncBanner: string | null;
  pendingOfflineCount: number;
  refreshOfflineCount: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('gtu_theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [offlineSyncBanner, setOfflineSyncBanner] = useState<string | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState<number>(() => getOfflineQueue().length);
  const [isWsConnected, setIsWsConnected] = useState(false);

  const isOnline = useOnlineStatus();
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(ev: WsEventPayload) => void>>(new Set());

  const refreshOfflineCount = useCallback(() => {
    setPendingOfflineCount(getOfflineQueue().length);
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem('gtu_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiRequest<{ user: CurrentUser }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  // Bootstrap session from HttpOnly cookie or Firebase Auth state
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const res = await apiRequest<{ user: CurrentUser }>('/api/auth/me');
        if (mounted) setUser(res.user);
      } catch {
        // Check Firebase Auth if cookie session isn't set
        const unsub = onAuthStateChanged(auth, async (fbUser) => {
          if (fbUser && mounted) {
            try {
              const idToken = await fbUser.getIdToken();
              setAuthToken(idToken);
              const res = await apiRequest<{ user: CurrentUser }>('/api/auth/firebase', {
                method: 'POST',
              });
              if (mounted) setUser(res.user);
            } catch {
              if (mounted) setUser(null);
            }
          }
          if (mounted) setLoading(false);
        });
        return () => unsub();
      }
      if (mounted) setLoading(false);
    };
    init();
    return () => {
      mounted = false;
    };
  }, []);

  // Real-time WebSocket connection when authenticated
  useEffect(() => {
    if (!user) {
      setIsWsConnected(false);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let closedByCleanup = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsWsConnected(true);
        if (pingTimer) window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as WsEventPayload & { type: string };
          if ((parsed as { type: string }).type === 'pong') return;
          if (parsed.type === 'connected') {
            setIsWsConnected(true);
          }
          if (parsed.type === 'notification:new') {
            setUser((prev) =>
              prev ? { ...prev, unreadNotifications: prev.unreadNotifications + 1 } : prev
            );
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted' &&
              'serviceWorker' in navigator &&
              document.visibilityState !== 'visible'
            ) {
              const notif = parsed.notification;
              void navigator.serviceWorker.ready
                .then(async (reg) => {
                  const sub = await reg.pushManager?.getSubscription().catch(() => null);
                  if (!sub) {
                    await reg.showNotification(notif.title, {
                      body: notif.body,
                      icon: '/pwa-192x192.png',
                      badge: '/pwa-192x192.png',
                      dir: 'rtl',
                      lang: 'ar',
                      tag: `gtu-notif-${notif.id}`,
                      data: { url: notif.link || '/?route=notifications' },
                    });
                  }
                })
                .catch(() => {});
            }
          }
          for (const listener of listenersRef.current) {
            listener(parsed);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setIsWsConnected(false);
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    };

    connectWs();

    return () => {
      closedByCleanup = true;
      setIsWsConnected(false);
      if (pingTimer) window.clearInterval(pingTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [user?.id]);

  // Automatic sync when connection returns
  useEffect(() => {
    if (!isOnline || !user) return;
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    flushOfflineQueue().then(({ synced }) => {
      refreshOfflineCount();
      if (synced > 0) {
        setOfflineSyncBanner(`تمت مزامنة ${synced} عملية محفوظة محلياً مع الخادم بنجاح.`);
        window.setTimeout(() => setOfflineSyncBanner(null), 5000);
      }
    });
  }, [isOnline, user, refreshOfflineCount]);

  const subscribeWs = useCallback((handler: (ev: WsEventPayload) => void) => {
    listenersRef.current.add(handler);
    return () => {
      listenersRef.current.delete(handler);
    };
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await apiRequest<{ token: string; user: CurrentUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (payload: Record<string, unknown>) => {
    const res = await apiRequest<{ token: string; user: CurrentUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    setAuthToken(idToken);
    const res = await apiRequest<{ user: CurrentUser }>('/api/auth/firebase', {
      method: 'POST',
    });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        theme,
        toggleTheme,
        login,
        register,
        loginWithGoogle,
        logout,
        refreshUser,
        subscribeWs,
        sendWs,
        isWsConnected,
        offlineSyncBanner,
        pendingOfflineCount,
        refreshOfflineCount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
