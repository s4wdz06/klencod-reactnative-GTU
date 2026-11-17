import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import * as webpush from 'web-push';
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  announcements,
  auditLogs,
  blockedUsers,
  communes,
  conversationReads,
  conversations,
  eventAttendees,
  events,
  graduationRecords,
  groupMembers,
  groups,
  institutions,
  messageReactions,
  messages,
  notifications,
  permissions,
  platformSettings,
  profiles,
  proposalUpdates,
  proposals,
  pushSubscriptions,
  reports,
  roles,
  userPermissions,
  userSessions,
  users,
  wilayas,
} from './src/db/schema.ts';
import { ensureDatabaseSeeded } from './src/db/seed.ts';
import {
  AuthRequest,
  loadEffectivePermissionsForUser,
  optionalAuth,
  requireAuth,
  requirePermission,
  resolveAuthFromHeaderOrCookie,
  userHasAnyPermission,
  writeAuditLog,
} from './src/middleware/auth.ts';
import { parseAllowedRoles } from './src/lib/rbac.ts';
import {
  checkRateLimit,
  generateNationalMemberNumber,
  generateSignedSessionToken,
  hashPassword,
  normalizeArabic,
  sanitizeText,
  saveBase64Upload,
  verifyPassword,
} from './src/lib/security.ts';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const httpServer = http.createServer(app);

app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Serve uploaded attachments safely
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
app.get('/api/uploads/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename);
  const fullPath = path.join(UPLOAD_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'الملف غير موجود' });
  }
  res.sendFile(fullPath);
});

// Health endpoint (fast, no eager DB probe)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'GTU National Platform', timestamp: new Date().toISOString() });
});

// Lazy idempotent DB seeding on first API request
app.use('/api', async (_req, res, next) => {
  try {
    await ensureDatabaseSeeded();
    next();
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(503).json({ error: 'تعذر الاتصال بقاعدة البيانات حالياً. يرجى المحاولة بعد لحظات.' });
  }
});

// ==================== WebSocket Hub (Room Pub/Sub, Presence, Typing & Notifications) ====================
interface WsClient {
  ws: WebSocket;
  userId: number;
  username: string;
  displayName: string;
  rooms: Set<number>;
  isAlive: boolean;
  lastTypingAt: number;
}
const wsClients = new Set<WsClient>();
const wsClientsByUser = new Map<number, Set<WsClient>>();
const wsRoomSubscribers = new Map<number, Set<WsClient>>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function getRoomOnlineCount(convId: number): number {
  const subs = wsRoomSubscribers.get(convId);
  if (!subs || subs.size === 0) return 0;
  const uniqueUsers = new Set<number>();
  for (const c of subs) {
    if (c.ws.readyState === WebSocket.OPEN) uniqueUsers.add(c.userId);
  }
  return uniqueUsers.size;
}

function broadcastToRoom(convId: number, payload: unknown, excludeUserId?: number) {
  const subs = wsRoomSubscribers.get(convId);
  if (!subs || subs.size === 0) return;
  const serialized = JSON.stringify(payload);
  for (const client of subs) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (excludeUserId !== undefined && client.userId === excludeUserId) continue;
    client.ws.send(serialized);
  }
}

function broadcastRoomPresence(convId: number) {
  broadcastToRoom(convId, {
    type: 'room:presence',
    conversationId: convId,
    onlineCount: getRoomOnlineCount(convId),
  });
}

function subscribeClientToRoom(client: WsClient, convId: number) {
  if (!Number.isFinite(convId) || convId <= 0) return;
  if (client.rooms.has(convId)) return;
  client.rooms.add(convId);
  let set = wsRoomSubscribers.get(convId);
  if (!set) {
    set = new Set();
    wsRoomSubscribers.set(convId, set);
  }
  set.add(client);
  broadcastRoomPresence(convId);
}

function unsubscribeClientFromRoom(client: WsClient, convId: number) {
  if (!client.rooms.has(convId)) return;
  client.rooms.delete(convId);
  const set = wsRoomSubscribers.get(convId);
  if (set) {
    set.delete(client);
    if (set.size === 0) {
      wsRoomSubscribers.delete(convId);
    } else {
      broadcastRoomPresence(convId);
    }
  }
}

async function registerWsClient(ws: WebSocket, userId: number, username: string): Promise<WsClient> {
  let displayName = username;
  try {
    const [prof] = await db
      .select({ firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (prof) displayName = `${prof.firstName} ${prof.lastName}`.trim() || username;
  } catch {
    // fallback to username
  }

  const client: WsClient = {
    ws,
    userId,
    username,
    displayName,
    rooms: new Set(),
    isAlive: true,
    lastTypingAt: 0,
  };
  wsClients.add(client);
  let userSet = wsClientsByUser.get(userId);
  if (!userSet) {
    userSet = new Set();
    wsClientsByUser.set(userId, userSet);
  }
  userSet.add(client);
  return client;
}

function unregisterWsClient(client: WsClient) {
  wsClients.delete(client);
  const userSet = wsClientsByUser.get(client.userId);
  if (userSet) {
    userSet.delete(client);
    if (userSet.size === 0) wsClientsByUser.delete(client.userId);
  }
  for (const convId of Array.from(client.rooms)) {
    unsubscribeClientFromRoom(client, convId);
  }
}

httpServer.on('upgrade', (req, socket, head) => {
  try {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    if (urlObj.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  } catch {
    socket.destroy();
  }
});

// Keep-alive heartbeat to prune dead sockets cleanly at scale
const wsHeartbeatTimer = setInterval(() => {
  for (const client of wsClients) {
    if (!client.isAlive) {
      try {
        client.ws.terminate();
      } catch {
        // ignore
      }
      unregisterWsClient(client);
      continue;
    }
    client.isAlive = false;
    try {
      client.ws.ping();
    } catch {
      // ignore
    }
  }
}, 30000);
wsHeartbeatTimer.unref?.();

wss.on('connection', async (ws, req) => {
  let clientRecord: WsClient | null = null;
  try {
    const urlObj = new URL(req.url || '/ws', 'http://localhost');
    const tokenParam = urlObj.searchParams.get('token') || '';
    const authHeader = tokenParam ? `Bearer ${tokenParam}` : req.headers.authorization;
    const resolved = await resolveAuthFromHeaderOrCookie(authHeader, req.headers.cookie);
    if (resolved) {
      clientRecord = await registerWsClient(ws, resolved.user.id, resolved.user.username);
      ws.send(JSON.stringify({ type: 'connected', userId: resolved.user.id }));
    }
  } catch {
    // Allow auth via first message if cookie wasn't attached
  }

  ws.on('pong', () => {
    if (clientRecord) clientRecord.isAlive = true;
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'auth' && typeof msg.token === 'string') {
        const resolved = await resolveAuthFromHeaderOrCookie(`Bearer ${msg.token}`, req.headers.cookie);
        if (resolved && !clientRecord) {
          clientRecord = await registerWsClient(ws, resolved.user.id, resolved.user.username);
          ws.send(JSON.stringify({ type: 'connected', userId: resolved.user.id }));
        }
      } else if (msg.type === 'ping') {
        if (clientRecord) clientRecord.isAlive = true;
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (clientRecord && msg.type === 'room:join') {
        const convId = Number(msg.conversationId);
        if (convId > 0) {
          const [conv] = await db
            .select({
              id: conversations.id,
              type: conversations.type,
              participantOneId: conversations.participantOneId,
              participantTwoId: conversations.participantTwoId,
            })
            .from(conversations)
            .where(eq(conversations.id, convId))
            .limit(1);
          if (
            conv &&
            (conv.type !== 'direct' ||
              conv.participantOneId === clientRecord.userId ||
              conv.participantTwoId === clientRecord.userId)
          ) {
            subscribeClientToRoom(clientRecord, convId);
          }
        }
      } else if (clientRecord && msg.type === 'room:leave') {
        const convId = Number(msg.conversationId);
        if (convId > 0) unsubscribeClientFromRoom(clientRecord, convId);
      } else if (clientRecord && (msg.type === 'typing:start' || msg.type === 'typing:stop')) {
        const convId = Number(msg.conversationId);
        if (convId > 0 && clientRecord.rooms.has(convId)) {
          const now = Date.now();
          if (msg.type === 'typing:start' && now - clientRecord.lastTypingAt < 1200) return;
          clientRecord.lastTypingAt = now;
          broadcastToRoom(
            convId,
            {
              type: 'typing',
              conversationId: convId,
              userId: clientRecord.userId,
              displayName: clientRecord.displayName,
              isTyping: msg.type === 'typing:start',
            },
            clientRecord.userId
          );
        }
      }
    } catch {
      // ignore malformed ws frames
    }
  });

  ws.on('close', () => {
    if (clientRecord) {
      unregisterWsClient(clientRecord);
    }
  });
});

function broadcastEvent(payload: unknown, targetUserIds?: number[]) {
  const serialized = JSON.stringify(payload);
  if (targetUserIds) {
    const sentSockets = new Set<WebSocket>();
    for (const uid of targetUserIds) {
      const userSockets = wsClientsByUser.get(uid);
      if (!userSockets) continue;
      for (const client of userSockets) {
        if (client.ws.readyState === WebSocket.OPEN && !sentSockets.has(client.ws)) {
          sentSockets.add(client.ws);
          client.ws.send(serialized);
        }
      }
    }
    return;
  }
  for (const client of wsClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(serialized);
  }
}

let cachedVapidKeys: { publicKey: string; privateKey: string } | null = null;
let vapidInitPromise: Promise<{ publicKey: string; privateKey: string } | null> | null = null;

async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (cachedVapidKeys) return cachedVapidKeys;
  if (vapidInitPromise) return vapidInitPromise;

  vapidInitPromise = (async () => {
    try {
      let publicKey = process.env.VAPID_PUBLIC_KEY || '';
      let privateKey = process.env.VAPID_PRIVATE_KEY || '';

      if (!publicKey || !privateKey) {
        const rows = await db
          .select()
          .from(platformSettings)
          .where(inArray(platformSettings.key, ['vapid_public_key', 'vapid_private_key']));
        for (const r of rows) {
          if (r.key === 'vapid_public_key') publicKey = r.value;
          if (r.key === 'vapid_private_key') privateKey = r.value;
        }
      }

      if (!publicKey || !privateKey) {
        const generated = webpush.generateVAPIDKeys();
        publicKey = generated.publicKey;
        privateKey = generated.privateKey;
        await db
          .insert(platformSettings)
          .values([
            { key: 'vapid_public_key', value: publicKey, category: 'internal_push' },
            { key: 'vapid_private_key', value: privateKey, category: 'internal_push' },
          ])
          .onConflictDoNothing();
      }

      const subject = process.env.VAPID_SUBJECT || 'mailto:contact@gtu-algeria.dz';
      webpush.setVapidDetails(subject, publicKey, privateKey);
      cachedVapidKeys = { publicKey, privateKey };
      return cachedVapidKeys;
    } catch (err) {
      console.error('VAPID initialization error:', err);
      return null;
    } finally {
      vapidInitPromise = null;
    }
  })();

  return vapidInitPromise;
}

async function sendWebPushToUser(
  userId: number,
  payload: { title: string; body: string; url?: string; tag?: string; type?: string }
): Promise<{ sent: number; failed: number; totalDevices: number }> {
  try {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (subs.length === 0) return { sent: 0, failed: 0, totalDevices: 0 };

    const keys = await ensureVapidKeys();
    if (!keys) return { sent: 0, failed: subs.length, totalDevices: subs.length };

    const serialized = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            serialized,
            { TTL: 86400, urgency: 'high' }
          );
          sent += 1;
        } catch (err: any) {
          failed += 1;
          const status = err?.statusCode;
          if (status === 404 || status === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).catch(() => {});
          }
        }
      })
    );

    return { sent, failed, totalDevices: subs.length };
  } catch (err) {
    console.error('Web Push delivery error:', err);
    return { sent: 0, failed: 1, totalDevices: 0 };
  }
}

async function createAndPushNotification(params: {
  userId: number;
  type: string;
  title: string;
  body: string;
  link?: string;
}) {
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        link: params.link || '',
      })
      .returning();
    broadcastEvent({ type: 'notification:new', notification: row }, [params.userId]);
    void sendWebPushToUser(params.userId, {
      title: params.title,
      body: params.body,
      url: params.link || '/?route=notifications',
      tag: `gtu-notif-${row.id}`,
      type: params.type,
    });
    return row;
  } catch (err) {
    console.error('Notification error:', err);
    return null;
  }
}

// ==================== Helper: Load Full User Payload ====================
async function getFullUserPayload(userId: number) {
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRow) return null;
  const [roleRow] = await db.select().from(roles).where(eq(roles.id, userRow.roleId)).limit(1);
  const [profileRow] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const [gradRow] = await db
    .select()
    .from(graduationRecords)
    .where(eq(graduationRecords.userId, userId))
    .orderBy(desc(graduationRecords.id))
    .limit(1);
  const [{ value: unreadNotifications }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

  const userPermissionsList = await loadEffectivePermissionsForUser(userRow.id, userRow.roleSlug);

  let resWilaya = null;
  let resCommune = null;
  if (profileRow?.residenceWilayaId) {
    const [w] = await db.select().from(wilayas).where(eq(wilayas.id, profileRow.residenceWilayaId)).limit(1);
    resWilaya = w || null;
  }
  if (profileRow?.residenceCommuneId) {
    const [c] = await db.select().from(communes).where(eq(communes.id, profileRow.residenceCommuneId)).limit(1);
    resCommune = c || null;
  }

  return {
    id: userRow.id,
    uid: userRow.uid,
    username: userRow.username,
    email: userRow.email,
    nationalMemberNumber: userRow.nationalMemberNumber,
    roleSlug: userRow.roleSlug,
    roleNameAr: roleRow?.nameAr || 'عضو خريج',
    roleLevel: roleRow?.level || 10,
    assignedWilayaCode: userRow.assignedWilayaCode || '',
    isActive: userRow.isActive,
    createdAt: userRow.createdAt,
    lastLoginAt: userRow.lastLoginAt,
    profile: profileRow || null,
    graduation: gradRow || null,
    residenceWilaya: resWilaya,
    residenceCommune: resCommune,
    unreadNotifications: Number(unreadNotifications || 0),
    permissions: userPermissionsList,
    needsProfileCompletion: !profileRow || !gradRow,
  };
}

// ==================== Public Overview & Settings ====================
app.get('/api/public/overview', async (_req, res) => {
  try {
    const settingsRows = await db.select().from(platformSettings);
    const settingsMap: Record<string, string> = {};
    for (const s of settingsRows) {
      if (s.category !== 'internal_push') {
        settingsMap[s.key] = s.value;
      }
    }

    const [{ value: totalGraduates }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isActive, true));

    const [{ value: representedWilayas }] = await db
      .select({ value: sql<number>`COUNT(DISTINCT ${profiles.residenceWilayaId})` })
      .from(profiles);

    const [{ value: representedCommunes }] = await db
      .select({ value: sql<number>`COUNT(DISTINCT ${profiles.residenceCommuneId})` })
      .from(profiles);

    const [{ value: totalProposals }] = await db.select({ value: count() }).from(proposals);
    const [{ value: totalEvents }] = await db.select({ value: count() }).from(events);
    const [{ value: totalMessages }] = await db
      .select({ value: count() })
      .from(messages)
      .where(eq(messages.isDeleted, false));

    const recentAnnouncements = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        content: announcements.content,
        scope: announcements.scope,
        isPinned: announcements.isPinned,
        publishedAt: announcements.publishedAt,
      })
      .from(announcements)
      .where(eq(announcements.scope, 'national'))
      .orderBy(desc(announcements.isPinned), desc(announcements.publishedAt))
      .limit(4);

    const upcomingEvents = await db
      .select({
        id: events.id,
        title: events.title,
        eventType: events.eventType,
        eventDate: events.eventDate,
        location: events.location,
        organizerName: events.organizerName,
      })
      .from(events)
      .orderBy(desc(events.eventDate))
      .limit(3);

    res.json({
      settings: settingsMap,
      stats: {
        totalGraduates: Number(totalGraduates || 0),
        representedWilayas: Number(representedWilayas || 0),
        representedCommunes: Number(representedCommunes || 0),
        totalProposals: Number(totalProposals || 0),
        totalEvents: Number(totalEvents || 0),
        totalMessages: Number(totalMessages || 0),
        totalWilayas: 58,
        totalCommunes: 1541,
      },
      recentAnnouncements,
      upcomingEvents,
    });
  } catch (err) {
    console.error('Public overview error:', err);
    res.status(500).json({ error: 'تعذر تحميل بيانات المنصة العامة' });
  }
});

// ==================== Geography Routes (58 Wilayas & 1541 Communes) ====================
app.get('/api/wilayas', async (_req, res) => {
  try {
    const allWilayas = await db.select().from(wilayas).orderBy(wilayas.code);
    const memberCounts = await db
      .select({
        wilayaId: profiles.residenceWilayaId,
        membersCount: count(),
        communesRepresented: sql<number>`COUNT(DISTINCT ${profiles.residenceCommuneId})`,
      })
      .from(profiles)
      .groupBy(profiles.residenceWilayaId);

    const communeTotals = await db
      .select({
        wilayaId: communes.wilayaId,
        communesTotal: count(),
      })
      .from(communes)
      .groupBy(communes.wilayaId);

    const countMap = new Map(memberCounts.map((m) => [m.wilayaId, m]));
    const communeMap = new Map(communeTotals.map((c) => [c.wilayaId, Number(c.communesTotal || 0)]));

    const totalAll = memberCounts.reduce((acc, m) => acc + Number(m.membersCount || 0), 0);

    const result = allWilayas.map((w) => {
      const m = countMap.get(w.id);
      const membersCount = Number(m?.membersCount || 0);
      return {
        ...w,
        membersCount,
        communesRepresented: Number(m?.communesRepresented || 0),
        communesTotal: communeMap.get(w.id) || 0,
        percentage: totalAll > 0 ? Number(((membersCount / totalAll) * 100).toFixed(1)) : 0,
      };
    });

    res.json({ wilayas: result, totalGraduates: totalAll });
  } catch (err) {
    console.error('Wilayas fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل قائمة الولايات' });
  }
});

app.get('/api/wilayas/:code/communes', async (req, res) => {
  try {
    const code = sanitizeText(req.params.code, 4).padStart(2, '0');
    const list = await db
      .select()
      .from(communes)
      .where(eq(communes.wilayaCode, code))
      .orderBy(communes.nameAr);

    const counts = await db
      .select({
        communeId: profiles.residenceCommuneId,
        membersCount: count(),
      })
      .from(profiles)
      .groupBy(profiles.residenceCommuneId);

    const countMap = new Map(counts.map((c) => [c.communeId, Number(c.membersCount || 0)]));
    res.json({
      communes: list.map((c) => ({
        ...c,
        membersCount: countMap.get(c.id) || 0,
      })),
    });
  } catch (err) {
    console.error('Communes fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل بلديات الولاية' });
  }
});

app.get('/api/wilayas/:code/details', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const code = sanitizeText(req.params.code, 4).padStart(2, '0');
    const [w] = await db.select().from(wilayas).where(eq(wilayas.code, code)).limit(1);
    if (!w) return res.status(404).json({ error: 'الولاية غير موجودة' });

    const communeList = await db
      .select()
      .from(communes)
      .where(eq(communes.wilayaId, w.id))
      .orderBy(communes.nameAr);

    const counts = await db
      .select({
        communeId: profiles.residenceCommuneId,
        membersCount: count(),
      })
      .from(profiles)
      .where(eq(profiles.residenceWilayaId, w.id))
      .groupBy(profiles.residenceCommuneId);
    const countMap = new Map(counts.map((c) => [c.communeId, Number(c.membersCount || 0)]));

    const [{ value: totalGraduates }] = await db.select({ value: count() }).from(profiles);
    const wilayaMembersCount = counts.reduce((acc, c) => acc + Number(c.membersCount || 0), 0);

    // Only expose member cards to authenticated users (zero private phone/birthDate)
    let members: Array<Record<string, unknown>> = [];
    if (req.dbUser) {
      const memberRows = await db
        .select({
          userId: users.id,
          nationalMemberNumber: users.nationalMemberNumber,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          avatarUrl: profiles.avatarUrl,
          bio: profiles.bio,
          communeId: profiles.residenceCommuneId,
        })
        .from(profiles)
        .innerJoin(users, eq(profiles.userId, users.id))
        .where(and(eq(profiles.residenceWilayaId, w.id), eq(users.isActive, true)))
        .limit(50);

      const communeNameMap = new Map(communeList.map((c) => [c.id, c.nameAr]));
      members = memberRows.map((m) => ({
        ...m,
        communeName: m.communeId ? communeNameMap.get(m.communeId) || '' : '',
      }));
    }

    res.json({
      wilaya: w,
      stats: {
        membersCount: wilayaMembersCount,
        communesTotal: communeList.length,
        communesRepresented: counts.filter((c) => Number(c.membersCount) > 0).length,
        percentage:
          Number(totalGraduates || 0) > 0
            ? Number(((wilayaMembersCount / Number(totalGraduates)) * 100).toFixed(1))
            : 0,
      },
      communes: communeList.map((c) => ({
        ...c,
        membersCount: countMap.get(c.id) || 0,
      })),
      members,
    });
  } catch (err) {
    console.error('Wilaya details error:', err);
    res.status(500).json({ error: 'تعذر تحميل تفاصيل الولاية' });
  }
});

app.get('/api/institutions', async (_req, res) => {
  try {
    const list = await db
      .select()
      .from(institutions)
      .where(eq(institutions.isActive, true))
      .orderBy(institutions.nameAr);
    res.json({ institutions: list });
  } catch (err) {
    console.error('Institutions error:', err);
    res.status(500).json({ error: 'تعذر تحميل قائمة المؤسسات الجامعية' });
  }
});

// ==================== Authentication & Registration ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const rate = checkRateLimit(`reg:${ip}`, 20, 15 * 60 * 1000);
    if (!rate.allowed) {
      return res.status(429).json({ error: `تم تجاوز حد المحاولات. حاول بعد ${rate.retryAfterSec} ثانية.` });
    }

    const {
      firstName,
      lastName,
      birthDate,
      birthPlace,
      birthWilayaCode,
      birthCommuneId,
      phone,
      email,
      avatarDataUrl,
      specialty,
      graduationYear,
      institutionId,
      institutionName,
      extraInfo,
      residenceWilayaCode,
      residenceCommuneId,
      username,
      password,
      confirmPassword,
      acceptedTerms,
    } = req.body || {};

    const cleanFirst = sanitizeText(firstName, 60);
    const cleanLast = sanitizeText(lastName, 60);
    const cleanUsername = sanitizeText(username, 40).toLowerCase();
    const cleanPhone = sanitizeText(phone, 24);
    const cleanEmail = sanitizeText(email, 120).toLowerCase();
    const cleanBirthDate = sanitizeText(birthDate, 20);
    const cleanBirthPlace = sanitizeText(birthPlace, 100);
    const cleanSpecialty = sanitizeText(specialty, 120) || 'تقنيات حضرية';
    const gradYearNum = Number(graduationYear);

    if (!cleanFirst || !cleanLast) {
      return res.status(400).json({ error: 'الاسم واللقب مطلوبان.' });
    }
    if (!cleanBirthDate || !cleanBirthPlace || !birthWilayaCode || !birthCommuneId) {
      return res.status(400).json({ error: 'بيانات الميلاد الكاملة (التاريخ والمكان والولاية والبلدية) مطلوبة.' });
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      return res.status(400).json({ error: 'رقم الهاتف الصحيح مطلوب.' });
    }
    if (!residenceWilayaCode || !residenceCommuneId) {
      return res.status(400).json({ error: 'ولاية وبلدية الإقامة مطلوبتان.' });
    }
    if (!Number.isInteger(gradYearNum) || gradYearNum < 1970 || gradYearNum > new Date().getFullYear() + 2) {
      return res.status(400).json({ error: 'يرجى إدخال سنة تخرج صحيحة.' });
    }
    if (!cleanUsername || !/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanUsername)) {
      return res.status(400).json({
        error: 'اسم المستخدم يجب أن يحتوي على 3 إلى 32 حرفاً إنجليزياً أو أرقاماً فقط.',
      });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تتكون من 8 أحرف على الأقل.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
    }
    if (!acceptedTerms) {
      return res.status(400).json({ error: 'يجب الموافقة على شروط الاستخدام وسياسة الخصوصية.' });
    }

    // Check username uniqueness & duplicate phone/email
    const existingUsername = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, cleanUsername))
      .limit(1);
    if (existingUsername.length > 0) {
      return res.status(409).json({ error: 'اسم المستخدم مستعمل مسبقاً، يرجى اختيار اسم آخر.' });
    }

    if (cleanEmail) {
      const existingEmail = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, cleanEmail))
        .limit(1);
      if (existingEmail.length > 0) {
        return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً في المنصة.' });
      }
    }

    const existingPhone = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.phone, cleanPhone))
      .limit(1);
    if (existingPhone.length > 0) {
      return res.status(409).json({ error: 'رقم الهاتف مرتبط بحساب مسجل مسبقاً.' });
    }

    // Validate wilaya <-> commune relationships strictly
    const [birthW] = await db
      .select()
      .from(wilayas)
      .where(eq(wilayas.code, String(birthWilayaCode).padStart(2, '0')))
      .limit(1);
    const [birthC] = await db
      .select()
      .from(communes)
      .where(eq(communes.id, Number(birthCommuneId)))
      .limit(1);
    if (!birthW || !birthC || birthC.wilayaId !== birthW.id) {
      return res.status(400).json({ error: 'بلدية الميلاد لا تتبع ولاية الميلاد المختارة.' });
    }

    const [resW] = await db
      .select()
      .from(wilayas)
      .where(eq(wilayas.code, String(residenceWilayaCode).padStart(2, '0')))
      .limit(1);
    const [resC] = await db
      .select()
      .from(communes)
      .where(eq(communes.id, Number(residenceCommuneId)))
      .limit(1);
    if (!resW || !resC || resC.wilayaId !== resW.id) {
      return res.status(400).json({ error: 'بلدية الإقامة لا تتبع ولاية الإقامة المختارة.' });
    }

    let avatarUrl = '';
    if (avatarDataUrl) {
      const saved = saveBase64Upload(avatarDataUrl, 'avatar.png');
      if (saved) avatarUrl = saved.url;
    }

    // First account becomes super_admin cleanly; all subsequent accounts are members
    const existingAny = await db.select({ id: users.id }).from(users).limit(1);
    const roleSlug = existingAny.length === 0 ? 'super_admin' : 'member';
    const [roleRow] = await db.select().from(roles).where(eq(roles.slug, roleSlug)).limit(1);

    const passwordHash = hashPassword(password);
    const uid = `gtu_${crypto.randomUUID()}`;
    const [{ value: userTotal }] = await db.select({ value: count() }).from(users);
    const nationalMemberNumber = generateNationalMemberNumber(new Date().getFullYear(), Number(userTotal || 0) + 1);

    const [newUser] = await db
      .insert(users)
      .values({
        uid,
        username: cleanUsername,
        email: cleanEmail,
        passwordHash,
        nationalMemberNumber,
        roleId: roleRow.id,
        roleSlug: roleRow.slug,
        isActive: true,
        acceptedTerms: true,
        acceptedTermsAt: new Date(),
        lastLoginAt: new Date(),
      })
      .returning();

    await db.insert(profiles).values({
      userId: newUser.id,
      firstName: cleanFirst,
      lastName: cleanLast,
      birthDate: cleanBirthDate,
      birthPlace: cleanBirthPlace,
      birthWilayaId: birthW.id,
      birthCommuneId: birthC.id,
      phone: cleanPhone,
      residenceWilayaId: resW.id,
      residenceCommuneId: resC.id,
      avatarUrl,
    });

    let resolvedInstName = sanitizeText(institutionName, 160);
    let resolvedInstId: number | null = institutionId ? Number(institutionId) : null;
    if (resolvedInstId) {
      const [instRow] = await db.select().from(institutions).where(eq(institutions.id, resolvedInstId)).limit(1);
      if (instRow) resolvedInstName = instRow.nameAr;
      else resolvedInstId = null;
    }

    await db.insert(graduationRecords).values({
      userId: newUser.id,
      specialty: cleanSpecialty,
      graduationYear: gradYearNum,
      institutionId: resolvedInstId,
      institutionName: resolvedInstName || 'معهد / جامعة وطنية للتقنيات الحضرية',
      extraInfo: sanitizeText(extraInfo, 500),
    });

    // Auto-join national group & residence wilaya group
    const targetGroups = await db
      .select()
      .from(groups)
      .where(or(eq(groups.isNational, true), eq(groups.wilayaId, resW.id)));
    if (targetGroups.length > 0) {
      await db
        .insert(groupMembers)
        .values(targetGroups.map((g) => ({ groupId: g.id, userId: newUser.id, roleInGroup: 'member' })))
        .onConflictDoNothing();
    }

    // Create signed session
    const { token, tokenHash } = generateSignedSessionToken(newUser.id, newUser.uid);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(userSessions).values({
      userId: newUser.id,
      tokenHash,
      deviceInfo: sanitizeText(req.headers['user-agent'], 120) || 'متصفح ويب',
      ipAddress: ip,
      expiresAt,
    });

    await createAndPushNotification({
      userId: newUser.id,
      type: 'account',
      title: 'مرحباً بك في المنصة الوطنية GTU',
      body: `تم تفعيل عضويتك الوطنية برقم ${nationalMemberNumber} وانضمامك التلقائي لمجموعة ولاية ${resW.nameAr}.`,
      link: '/dashboard',
    });

    await writeAuditLog({
      actorId: newUser.id,
      action: 'USER_REGISTERED',
      entityType: 'users',
      entityId: newUser.id,
      details: `تسجيل عضو جديد (${nationalMemberNumber}) - ولاية ${resW.nameAr}`,
      ipAddress: ip,
    });

    res.cookie('gtu_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });

    const userPayload = await getFullUserPayload(newUser.id);
    res.status(201).json({ token, user: userPayload });
  } catch (err: any) {
    console.error('Register error:', err);
    res.status(500).json({ error: err?.message || 'حدث خطأ أثناء إنشاء الحساب' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const { identifier, password } = req.body || {};
    const cleanId = sanitizeText(identifier, 120).toLowerCase();
    const rate = checkRateLimit(`login:${ip}:${cleanId}`, 10, 15 * 60 * 1000);
    if (!rate.allowed) {
      return res.status(429).json({
        error: `تم تجاوز الحد الأقصى لمحاولات الدخول. يرجى الانتظار ${rate.retryAfterSec} ثانية.`,
      });
    }

    if (!cleanId || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
    }

    const [userRow] = await db
      .select()
      .from(users)
      .where(or(eq(users.username, cleanId), eq(users.email, cleanId)))
      .limit(1);

    if (!userRow || !userRow.passwordHash || !verifyPassword(password, userRow.passwordHash)) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    }

    if (!userRow.isActive) {
      return res.status(403).json({ error: 'تم تعليق هذا الحساب من طرف الإدارة.' });
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userRow.id));

    const { token, tokenHash } = generateSignedSessionToken(userRow.id, userRow.uid);
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(userSessions).values({
      userId: userRow.id,
      tokenHash,
      deviceInfo: sanitizeText(req.headers['user-agent'], 120) || 'متصفح ويب',
      ipAddress: ip,
      expiresAt,
    });

    res.cookie('gtu_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 14 * 24 * 60 * 60 * 1000,
    });

    const userPayload = await getFullUserPayload(userRow.id);
    res.json({ token, user: userPayload });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'تعذر إتمام تسجيل الدخول' });
  }
});

app.post('/api/auth/firebase', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userPayload = await getFullUserPayload(req.dbUser!.id);
    res.json({ user: userPayload });
  } catch (err) {
    console.error('Firebase sync error:', err);
    res.status(500).json({ error: 'تعذر مزامنة الحساب' });
  }
});

app.post('/api/auth/complete-profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const {
      firstName,
      lastName,
      birthDate,
      birthPlace,
      birthWilayaCode,
      birthCommuneId,
      phone,
      specialty,
      graduationYear,
      institutionId,
      institutionName,
      extraInfo,
      residenceWilayaCode,
      residenceCommuneId,
    } = req.body || {};

    const cleanFirst = sanitizeText(firstName, 60);
    const cleanLast = sanitizeText(lastName, 60);
    const cleanPhone = sanitizeText(phone, 24);
    const gradYearNum = Number(graduationYear);

    if (!cleanFirst || !cleanLast || !residenceWilayaCode || !residenceCommuneId || !gradYearNum) {
      return res.status(400).json({ error: 'يرجى استكمال جميع الحقول الإلزامية.' });
    }

    const [resW] = await db
      .select()
      .from(wilayas)
      .where(eq(wilayas.code, String(residenceWilayaCode).padStart(2, '0')))
      .limit(1);
    const [resC] = await db
      .select()
      .from(communes)
      .where(eq(communes.id, Number(residenceCommuneId)))
      .limit(1);
    if (!resW || !resC || resC.wilayaId !== resW.id) {
      return res.status(400).json({ error: 'بلدية الإقامة لا تتبع الولاية المختارة.' });
    }

    let birthWId: number | null = null;
    let birthCId: number | null = null;
    if (birthWilayaCode && birthCommuneId) {
      const [bw] = await db
        .select()
        .from(wilayas)
        .where(eq(wilayas.code, String(birthWilayaCode).padStart(2, '0')))
        .limit(1);
      const [bc] = await db.select().from(communes).where(eq(communes.id, Number(birthCommuneId))).limit(1);
      if (bw && bc && bc.wilayaId === bw.id) {
        birthWId = bw.id;
        birthCId = bc.id;
      }
    }

    await db
      .insert(profiles)
      .values({
        userId,
        firstName: cleanFirst,
        lastName: cleanLast,
        birthDate: sanitizeText(birthDate, 20),
        birthPlace: sanitizeText(birthPlace, 100),
        birthWilayaId: birthWId,
        birthCommuneId: birthCId,
        phone: cleanPhone,
        residenceWilayaId: resW.id,
        residenceCommuneId: resC.id,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          firstName: cleanFirst,
          lastName: cleanLast,
          birthDate: sanitizeText(birthDate, 20),
          birthPlace: sanitizeText(birthPlace, 100),
          birthWilayaId: birthWId,
          birthCommuneId: birthCId,
          phone: cleanPhone,
          residenceWilayaId: resW.id,
          residenceCommuneId: resC.id,
          updatedAt: new Date(),
        },
      });

    const existingGrad = await db
      .select()
      .from(graduationRecords)
      .where(eq(graduationRecords.userId, userId))
      .limit(1);
    if (existingGrad.length === 0) {
      let resolvedInstName = sanitizeText(institutionName, 160);
      let resolvedInstId: number | null = institutionId ? Number(institutionId) : null;
      if (resolvedInstId) {
        const [inst] = await db.select().from(institutions).where(eq(institutions.id, resolvedInstId)).limit(1);
        if (inst) resolvedInstName = inst.nameAr;
      }
      await db.insert(graduationRecords).values({
        userId,
        specialty: sanitizeText(specialty, 120) || 'تقنيات حضرية',
        graduationYear: gradYearNum,
        institutionId: resolvedInstId,
        institutionName: resolvedInstName || 'معهد / جامعة وطنية للتقنيات الحضرية',
        extraInfo: sanitizeText(extraInfo, 500),
      });
    }

    const targetGroups = await db
      .select()
      .from(groups)
      .where(or(eq(groups.isNational, true), eq(groups.wilayaId, resW.id)));
    if (targetGroups.length > 0) {
      await db
        .insert(groupMembers)
        .values(targetGroups.map((g) => ({ groupId: g.id, userId, roleInGroup: 'member' })))
        .onConflictDoNothing();
    }

    const userPayload = await getFullUserPayload(userId);
    res.json({ user: userPayload });
  } catch (err) {
    console.error('Complete profile error:', err);
    res.status(500).json({ error: 'تعذر حفظ بيانات الخريج' });
  }
});

app.post('/api/auth/logout', optionalAuth, async (req: AuthRequest, res) => {
  try {
    if (req.sessionId) {
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, req.sessionId));
    }
    res.clearCookie('gtu_session');
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'تعذر تسجيل الخروج' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userPayload = await getFullUserPayload(req.dbUser!.id);
    res.json({ user: userPayload });
  } catch (err) {
    console.error('Auth me error:', err);
    res.status(500).json({ error: 'تعذر تحميل بيانات العضو' });
  }
});

app.get('/api/auth/sessions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select({
        id: userSessions.id,
        deviceInfo: userSessions.deviceInfo,
        ipAddress: userSessions.ipAddress,
        createdAt: userSessions.createdAt,
        expiresAt: userSessions.expiresAt,
        revokedAt: userSessions.revokedAt,
      })
      .from(userSessions)
      .where(and(eq(userSessions.userId, req.dbUser!.id), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.createdAt));

    res.json({
      sessions: list.map((s) => ({ ...s, isCurrent: s.id === req.sessionId })),
    });
  } catch (err) {
    console.error('Sessions error:', err);
    res.status(500).json({ error: 'تعذر جلب الجلسات النشطة' });
  }
});

app.delete('/api/auth/sessions/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.id, id), eq(userSessions.userId, req.dbUser!.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error('Revoke session error:', err);
    res.status(500).json({ error: 'تعذر إنهاء الجلسة' });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.' });
    }
    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ error: 'كلمتا المرور غير متطابقتين.' });
    }
    const [u] = await db.select().from(users).where(eq(users.id, req.dbUser!.id)).limit(1);
    if (u?.passwordHash && (!currentPassword || !verifyPassword(currentPassword, u.passwordHash))) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
    }
    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, req.dbUser!.id));
    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'users',
      entityId: req.dbUser!.id,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'تعذر تغيير كلمة المرور' });
  }
});

app.post('/api/auth/recover-password', async (req, res) => {
  try {
    const ip = req.ip || 'unknown';
    const rate = checkRateLimit(`recover:${ip}`, 5, 15 * 60 * 1000);
    if (!rate.allowed) {
      return res.status(429).json({ error: `تم تجاوز حد المحاولات. حاول بعد ${rate.retryAfterSec} ثانية.` });
    }

    const { username, nationalMemberNumber, birthDate, newPassword } = req.body || {};
    const cleanUsername = sanitizeText(username, 40).toLowerCase();
    const cleanMemberNo = sanitizeText(nationalMemberNumber, 30).toUpperCase();
    const cleanBirthDate = sanitizeText(birthDate, 20);

    if (!cleanUsername || !cleanMemberNo || !cleanBirthDate || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({
        error: 'يرجى إدخال اسم المستخدم ورقم العضوية الوطني وتاريخ الميلاد وكلمة مرور جديدة (8 أحرف+).',
      });
    }

    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.username, cleanUsername), eq(users.nationalMemberNumber, cleanMemberNo)))
      .limit(1);
    if (!u) {
      return res.status(400).json({ error: 'تعذر التحقق من صحة البيانات المقدمة.' });
    }
    const [prof] = await db.select().from(profiles).where(eq(profiles.userId, u.id)).limit(1);
    if (!prof || prof.birthDate !== cleanBirthDate) {
      return res.status(400).json({ error: 'تعذر التحقق من صحة البيانات المقدمة.' });
    }

    await db
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, u.id));
    await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, u.id));

    await writeAuditLog({
      actorId: u.id,
      action: 'PASSWORD_RECOVERED',
      entityType: 'users',
      entityId: u.id,
      ipAddress: ip,
    });
    res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.' });
  } catch (err) {
    console.error('Recover password error:', err);
    res.status(500).json({ error: 'تعذر استعادة كلمة المرور' });
  }
});

// ==================== Profile & Account Management ====================
app.put('/api/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const body = req.body || {};
    const [existingProfile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    if (!existingProfile) {
      return res.status(400).json({ error: 'الملف الشخصي غير مكتمل.' });
    }

    let nextResWilayaId = existingProfile.residenceWilayaId;
    let nextResCommuneId = existingProfile.residenceCommuneId;

    if (body.residenceWilayaCode && body.residenceCommuneId) {
      const [rw] = await db
        .select()
        .from(wilayas)
        .where(eq(wilayas.code, String(body.residenceWilayaCode).padStart(2, '0')))
        .limit(1);
      const [rc] = await db
        .select()
        .from(communes)
        .where(eq(communes.id, Number(body.residenceCommuneId)))
        .limit(1);
      if (!rw || !rc || rc.wilayaId !== rw.id) {
        return res.status(400).json({ error: 'بلدية الإقامة لا تتبع الولاية المختارة.' });
      }
      nextResWilayaId = rw.id;
      nextResCommuneId = rc.id;

      // Auto-join new wilaya group
      const [wGroup] = await db.select().from(groups).where(eq(groups.wilayaId, rw.id)).limit(1);
      if (wGroup) {
        await db
          .insert(groupMembers)
          .values({ groupId: wGroup.id, userId, roleInGroup: 'member' })
          .onConflictDoNothing();
      }
    }

    let avatarUrl = existingProfile.avatarUrl;
    if (body.avatarDataUrl) {
      const saved = saveBase64Upload(body.avatarDataUrl, 'avatar.png');
      if (saved) avatarUrl = saved.url;
    }

    await db
      .update(profiles)
      .set({
        firstName: sanitizeText(body.firstName, 60) || existingProfile.firstName,
        lastName: sanitizeText(body.lastName, 60) || existingProfile.lastName,
        phone: body.phone !== undefined ? sanitizeText(body.phone, 24) : existingProfile.phone,
        residenceWilayaId: nextResWilayaId,
        residenceCommuneId: nextResCommuneId,
        avatarUrl,
        bio: body.bio !== undefined ? sanitizeText(body.bio, 800) : existingProfile.bio,
        skills: body.skills !== undefined ? sanitizeText(body.skills, 500) : existingProfile.skills,
        experience: body.experience !== undefined ? sanitizeText(body.experience, 1000) : existingProfile.experience,
        privacyShowPhone:
          typeof body.privacyShowPhone === 'boolean' ? body.privacyShowPhone : existingProfile.privacyShowPhone,
        privacyShowBirthDate:
          typeof body.privacyShowBirthDate === 'boolean'
            ? body.privacyShowBirthDate
            : existingProfile.privacyShowBirthDate,
        privacyShowEmail:
          typeof body.privacyShowEmail === 'boolean' ? body.privacyShowEmail : existingProfile.privacyShowEmail,
        privacyAllowDm: typeof body.privacyAllowDm === 'boolean' ? body.privacyAllowDm : existingProfile.privacyAllowDm,
        notifyMessages: typeof body.notifyMessages === 'boolean' ? body.notifyMessages : existingProfile.notifyMessages,
        notifyAnnouncements:
          typeof body.notifyAnnouncements === 'boolean'
            ? body.notifyAnnouncements
            : existingProfile.notifyAnnouncements,
        notifyEvents: typeof body.notifyEvents === 'boolean' ? body.notifyEvents : existingProfile.notifyEvents,
        notifyProposals:
          typeof body.notifyProposals === 'boolean' ? body.notifyProposals : existingProfile.notifyProposals,
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId));

    if (body.email !== undefined) {
      await db
        .update(users)
        .set({ email: sanitizeText(body.email, 120).toLowerCase(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    if (body.graduationYear || body.specialty || body.institutionName) {
      const [grad] = await db
        .select()
        .from(graduationRecords)
        .where(eq(graduationRecords.userId, userId))
        .limit(1);
      if (grad) {
        await db
          .update(graduationRecords)
          .set({
            specialty: sanitizeText(body.specialty, 120) || grad.specialty,
            graduationYear: body.graduationYear ? Number(body.graduationYear) : grad.graduationYear,
            institutionName: sanitizeText(body.institutionName, 160) || grad.institutionName,
            extraInfo: body.extraInfo !== undefined ? sanitizeText(body.extraInfo, 500) : grad.extraInfo,
          })
          .where(eq(graduationRecords.id, grad.id));
      }
    }

    const updated = await getFullUserPayload(userId);
    res.json({ user: updated });
  } catch (err: any) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: err?.message || 'تعذر تحديث الملف الشخصي' });
  }
});

app.get('/api/profile/activity', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const myProposals = await db
      .select()
      .from(proposals)
      .where(eq(proposals.authorId, userId))
      .orderBy(desc(proposals.createdAt))
      .limit(10);
    const myEvents = await db
      .select({
        eventId: events.id,
        title: events.title,
        eventDate: events.eventDate,
        status: eventAttendees.status,
      })
      .from(eventAttendees)
      .innerJoin(events, eq(eventAttendees.eventId, events.id))
      .where(eq(eventAttendees.userId, userId))
      .limit(10);
    const [{ value: myMessagesCount }] = await db
      .select({ value: count() })
      .from(messages)
      .where(and(eq(messages.senderId, userId), eq(messages.isDeleted, false)));

    res.json({
      proposals: myProposals,
      events: myEvents,
      messagesCount: Number(myMessagesCount || 0),
    });
  } catch (err) {
    console.error('Activity error:', err);
    res.status(500).json({ error: 'تعذر تحميل نشاط العضو' });
  }
});

app.delete('/api/account', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    await writeAuditLog({
      actorId: userId,
      action: 'ACCOUNT_DELETED_BY_USER',
      entityType: 'users',
      entityId: userId,
    });
    await db.delete(users).where(eq(users.id, userId));
    res.clearCookie('gtu_session');
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'تعذر حذف الحساب' });
  }
});

// ==================== National Dashboard Stats (Real DB Aggregation) ====================
app.get('/api/dashboard/stats', requireAuth, async (req: AuthRequest, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [{ value: totalGraduates }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isActive, true));

    const [{ value: representedWilayas }] = await db
      .select({ value: sql<number>`COUNT(DISTINCT ${profiles.residenceWilayaId})` })
      .from(profiles);

    const [{ value: representedCommunes }] = await db
      .select({ value: sql<number>`COUNT(DISTINCT ${profiles.residenceCommuneId})` })
      .from(profiles);

    const [{ value: activeMembers }] = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.isActive, true), gte(users.lastLoginAt, thirtyDaysAgo)));

    const [{ value: newMembers }] = await db
      .select({ value: count() })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo));

    const [{ value: proposalsCount }] = await db
      .select({ value: count() })
      .from(proposals)
      .where(eq(proposals.kind, 'proposal'));

    const [{ value: initiativesCount }] = await db
      .select({ value: count() })
      .from(proposals)
      .where(eq(proposals.kind, 'initiative'));

    const [{ value: eventsCount }] = await db.select({ value: count() }).from(events);
    const [{ value: messagesCount }] = await db
      .select({ value: count() })
      .from(messages)
      .where(eq(messages.isDeleted, false));

    // Distribution by wilaya (ranked)
    const allWilayas = await db.select().from(wilayas);
    const wilayaLookup = new Map(allWilayas.map((w) => [w.id, w]));
    const byWilayaRaw = await db
      .select({
        wilayaId: profiles.residenceWilayaId,
        count: count(),
      })
      .from(profiles)
      .groupBy(profiles.residenceWilayaId);

    const totalForShare = Number(totalGraduates || 0);
    const byWilaya = byWilayaRaw
      .filter((r) => r.wilayaId !== null)
      .map((r) => {
        const w = wilayaLookup.get(r.wilayaId!);
        const cnt = Number(r.count || 0);
        return {
          code: w?.code || '',
          nameAr: w?.nameAr || 'غير محدد',
          count: cnt,
          percentage: totalForShare > 0 ? Number(((cnt / totalForShare) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.count - a.count);

    // Distribution by graduation year
    const byYearRaw = await db
      .select({
        year: graduationRecords.graduationYear,
        count: count(),
      })
      .from(graduationRecords)
      .groupBy(graduationRecords.graduationYear)
      .orderBy(graduationRecords.graduationYear);

    const byGraduationYear = byYearRaw.map((y) => ({
      year: y.year,
      count: Number(y.count || 0),
    }));

    const topGraduationYears = [...byGraduationYear].sort((a, b) => b.count - a.count).slice(0, 6);

    // Growth curve (daily, monthly, yearly)
    const allUserDates = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .orderBy(users.createdAt);

    const dailyMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();
    const yearlyMap = new Map<string, number>();

    for (const row of allUserDates) {
      const d = new Date(row.createdAt);
      const dayKey = d.toISOString().slice(0, 10);
      const monthKey = d.toISOString().slice(0, 7);
      const yearKey = String(d.getFullYear());
      dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + 1);
      monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + 1);
      yearlyMap.set(yearKey, (yearlyMap.get(yearKey) || 0) + 1);
    }

    res.json({
      kpis: {
        totalGraduates: Number(totalGraduates || 0),
        representedWilayas: Number(representedWilayas || 0),
        representedCommunes: Number(representedCommunes || 0),
        activeMembers: Number(activeMembers || 0),
        newMembers: Number(newMembers || 0),
        proposalsCount: Number(proposalsCount || 0),
        initiativesCount: Number(initiativesCount || 0),
        eventsCount: Number(eventsCount || 0),
        messagesCount: Number(messagesCount || 0),
      },
      byWilaya,
      byGraduationYear,
      topGraduationYears,
      growth: {
        daily: Array.from(dailyMap.entries()).map(([label, value]) => ({ label, value })),
        monthly: Array.from(monthlyMap.entries()).map(([label, value]) => ({ label, value })),
        yearly: Array.from(yearlyMap.entries()).map(([label, value]) => ({ label, value })),
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'تعذر تحميل إحصائيات لوحة القيادة' });
  }
});

// ==================== Graduates National Directory (Auth Required) ====================
app.get('/api/graduates', requireAuth, async (req: AuthRequest, res) => {
  try {
    const q = normalizeArabic(sanitizeText(req.query.q, 100));
    const wilayaCode = sanitizeText(req.query.wilayaCode, 4);
    const communeId = req.query.communeId ? Number(req.query.communeId) : null;
    const gradYear = req.query.graduationYear ? Number(req.query.graduationYear) : null;
    const sort = sanitizeText(req.query.sort, 20) || 'newest';

    const rows = await db
      .select({
        userId: users.id,
        username: users.username,
        email: users.email,
        nationalMemberNumber: users.nationalMemberNumber,
        roleSlug: users.roleSlug,
        createdAt: users.createdAt,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        avatarUrl: profiles.avatarUrl,
        bio: profiles.bio,
        skills: profiles.skills,
        phone: profiles.phone,
        birthDate: profiles.birthDate,
        privacyShowPhone: profiles.privacyShowPhone,
        privacyShowBirthDate: profiles.privacyShowBirthDate,
        privacyShowEmail: profiles.privacyShowEmail,
        privacyAllowDm: profiles.privacyAllowDm,
        residenceWilayaId: profiles.residenceWilayaId,
        residenceCommuneId: profiles.residenceCommuneId,
        specialty: graduationRecords.specialty,
        graduationYear: graduationRecords.graduationYear,
        institutionName: graduationRecords.institutionName,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .leftJoin(graduationRecords, eq(graduationRecords.userId, users.id))
      .where(eq(users.isActive, true));

    const allW = await db.select().from(wilayas);
    const allC = await db.select().from(communes);
    const wMap = new Map(allW.map((w) => [w.id, w]));
    const cMap = new Map(allC.map((c) => [c.id, c]));

    const isAdminViewer = userHasAnyPermission(req.dbUser, ['view_directory_private_info']);

    let filtered = rows
      .map((r) => {
        const w = r.residenceWilayaId ? wMap.get(r.residenceWilayaId) : null;
        const c = r.residenceCommuneId ? cMap.get(r.residenceCommuneId) : null;
        const isSelf = r.userId === req.dbUser!.id;
        return {
          userId: r.userId,
          username: r.username,
          nationalMemberNumber: r.nationalMemberNumber,
          roleSlug: r.roleSlug,
          firstName: r.firstName,
          lastName: r.lastName,
          fullName: `${r.firstName} ${r.lastName}`,
          avatarUrl: r.avatarUrl || '',
          bio: r.bio || '',
          skills: r.skills || '',
          wilayaCode: w?.code || '',
          wilayaName: w?.nameAr || '',
          communeId: c?.id || null,
          communeName: c?.nameAr || '',
          specialty: r.specialty || 'تقنيات حضرية',
          graduationYear: r.graduationYear || null,
          institutionName: r.institutionName || '',
          privacyAllowDm: r.privacyAllowDm,
          createdAt: r.createdAt,
          // Strict privacy enforcement: hide sensitive data unless permitted
          phone: isSelf || isAdminViewer || r.privacyShowPhone ? r.phone : null,
          birthDate: isSelf || isAdminViewer || r.privacyShowBirthDate ? r.birthDate : null,
          email: isSelf || isAdminViewer || r.privacyShowEmail ? r.email : null,
        };
      })
      .filter((item) => {
        if (wilayaCode && item.wilayaCode !== wilayaCode.padStart(2, '0')) return false;
        if (communeId && item.communeId !== communeId) return false;
        if (gradYear && item.graduationYear !== gradYear) return false;
        if (q) {
          const hay = normalizeArabic(
            `${item.firstName} ${item.lastName} ${item.fullName} ${item.nationalMemberNumber} ${item.wilayaName} ${item.communeName} ${item.institutionName} ${item.bio}`
          );
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    if (sort === 'name') {
      filtered.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
    } else if (sort === 'year') {
      filtered.sort((a, b) => (b.graduationYear || 0) - (a.graduationYear || 0));
    } else {
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    res.json({ graduates: filtered, total: filtered.length });
  } catch (err) {
    console.error('Graduates directory error:', err);
    res.status(500).json({ error: 'تعذر تحميل دليل الخريجين' });
  }
});

// ==================== High-Scale Real-Time Chat, Wilaya Groups & Direct Messages ====================
const ALLOWED_CHAT_EMOJIS = ['👍', '❤️', '👏', '🔥', '💡', '✅'] as const;

async function hydrateMessages(
  rows: Array<{
    id: number;
    conversationId: number;
    senderId: number;
    replyToId: number | null;
    content: string;
    attachmentUrl: string | null;
    attachmentName: string | null;
    attachmentType: string | null;
    isOfficial: boolean;
    isPinned: boolean;
    editedAt: Date | null;
    createdAt: Date;
    senderFirstName: string | null;
    senderLastName: string | null;
    senderAvatar: string | null;
    senderRole: string;
    senderMemberNo: string;
  }>,
  viewerUserId: number
) {
  if (rows.length === 0) return [];

  const msgIds = rows.map((r) => r.id);
  const replyIds = Array.from(
    new Set(rows.map((r) => r.replyToId).filter((id): id is number => typeof id === 'number' && id > 0))
  );

  // Batched query 1: Parent reply snippets
  const replyMap = new Map<
    number,
    { id: number; senderName: string; content: string; attachmentName?: string }
  >();
  if (replyIds.length > 0) {
    const replyRows = await db
      .select({
        id: messages.id,
        content: messages.content,
        attachmentName: messages.attachmentName,
        isDeleted: messages.isDeleted,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
      })
      .from(messages)
      .leftJoin(profiles, eq(profiles.userId, messages.senderId))
      .where(inArray(messages.id, replyIds));
    for (const rr of replyRows) {
      replyMap.set(rr.id, {
        id: rr.id,
        senderName: rr.firstName ? `${rr.firstName} ${rr.lastName}` : 'عضو GTU',
        content: rr.isDeleted ? 'رسالة محذوفة' : rr.content.slice(0, 120),
        attachmentName: rr.attachmentName || undefined,
      });
    }
  }

  // Batched query 2: Reactions aggregated per message
  const reactionRows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
    })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, msgIds));

  const reactionMap = new Map<
    number,
    Map<string, { count: number; reactedByMe: boolean }>
  >();
  for (const r of reactionRows) {
    let msgMap = reactionMap.get(r.messageId);
    if (!msgMap) {
      msgMap = new Map();
      reactionMap.set(r.messageId, msgMap);
    }
    const entry = msgMap.get(r.emoji) || { count: 0, reactedByMe: false };
    entry.count += 1;
    if (r.userId === viewerUserId) entry.reactedByMe = true;
    msgMap.set(r.emoji, entry);
  }

  return rows.map((m) => {
    const rMap = reactionMap.get(m.id);
    const reactions = rMap
      ? Array.from(rMap.entries()).map(([emoji, info]) => ({
          emoji,
          count: info.count,
          reactedByMe: info.reactedByMe,
        }))
      : [];
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      replyToId: m.replyToId,
      replyTo: m.replyToId ? replyMap.get(m.replyToId) || null : null,
      content: m.content,
      attachmentUrl: m.attachmentUrl || '',
      attachmentName: m.attachmentName || '',
      attachmentType: m.attachmentType || '',
      isOfficial: m.isOfficial,
      isPinned: m.isPinned,
      editedAt: m.editedAt,
      createdAt: m.createdAt,
      senderName: m.senderFirstName ? `${m.senderFirstName} ${m.senderLastName}` : 'عضو GTU',
      senderAvatar: m.senderAvatar || '',
      senderRole: m.senderRole,
      senderMemberNo: m.senderMemberNo,
      reactions,
    };
  });
}

async function getMessageReactionSummary(messageId: number, viewerUserId: number) {
  const rows = await db
    .select({ emoji: messageReactions.emoji, userId: messageReactions.userId })
    .from(messageReactions)
    .where(eq(messageReactions.messageId, messageId));
  const map = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const r of rows) {
    const entry = map.get(r.emoji) || { count: 0, reactedByMe: false };
    entry.count += 1;
    if (r.userId === viewerUserId) entry.reactedByMe = true;
    map.set(r.emoji, entry);
  }
  return Array.from(map.entries()).map(([emoji, info]) => ({
    emoji,
    count: info.count,
    reactedByMe: info.reactedByMe,
  }));
}

app.get('/api/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;

    // Constant O(1) batched queries regardless of conversation/group count
    const [myGroupRows, allConvs, allGroups, groupCountsRows, myReadsRows] = await Promise.all([
      db.select({ groupId: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId)),
      db.select().from(conversations).orderBy(desc(conversations.lastMessageAt)),
      db.select().from(groups),
      db
        .select({ groupId: groupMembers.groupId, cnt: count() })
        .from(groupMembers)
        .groupBy(groupMembers.groupId),
      db
        .select({
          conversationId: conversationReads.conversationId,
          lastReadMessageId: conversationReads.lastReadMessageId,
        })
        .from(conversationReads)
        .where(eq(conversationReads.userId, userId)),
    ]);

    const myGroupIds = new Set(myGroupRows.map((g) => g.groupId));
    const groupMap = new Map(allGroups.map((g) => [g.id, g]));
    const groupMemberCountMap = new Map(groupCountsRows.map((g) => [g.groupId, Number(g.cnt || 0)]));
    const myReadsMap = new Map(myReadsRows.map((r) => [r.conversationId, r.lastReadMessageId]));

    // Filter visible conversations first
    const candidateConvs = allConvs.filter(
      (c) =>
        c.type === 'national' ||
        c.type === 'official_channel' ||
        c.type === 'wilaya_group' ||
        (c.type === 'direct' && (c.participantOneId === userId || c.participantTwoId === userId))
    );

    const visibleConvIds = candidateConvs.map((c) => c.id);
    const dmPartnerIds = Array.from(
      new Set(
        candidateConvs
          .filter((c) => c.type === 'direct')
          .map((c) => (c.participantOneId === userId ? c.participantTwoId : c.participantOneId))
          .filter((id): id is number => typeof id === 'number' && id > 0)
      )
    );

    // Batch DM partner profiles
    const partnerMap = new Map<number, { name: string; avatar: string }>();
    if (dmPartnerIds.length > 0) {
      const partnerProfiles = await db
        .select({
          userId: profiles.userId,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(inArray(profiles.userId, dmPartnerIds));
      for (const p of partnerProfiles) {
        partnerMap.set(p.userId, {
          name: `${p.firstName} ${p.lastName}`,
          avatar: p.avatarUrl || '',
        });
      }
    }

    // Batch last message per conversation using PostgreSQL DISTINCT ON
    const lastMsgMap = new Map<number, { content: string; senderName: string; id: number }>();
    const unreadCountMap = new Map<number, number>();
    if (visibleConvIds.length > 0) {
      const lastMsgRes = await db.execute(sql`
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id,
          m.id,
          m.content,
          m.attachment_name,
          COALESCE(NULLIF(TRIM(CONCAT(p.first_name, ' ', p.last_name)), ''), 'عضو GTU') AS sender_name
        FROM messages m
        LEFT JOIN profiles p ON p.user_id = m.sender_id
        WHERE m.is_deleted = FALSE AND m.conversation_id = ANY(${visibleConvIds}::int[])
        ORDER BY m.conversation_id, m.id DESC
      `);
      for (const row of lastMsgRes.rows as Array<Record<string, unknown>>) {
        const cid = Number(row.conversation_id);
        const contentStr = String(row.content || '');
        const attachName = String(row.attachment_name || '');
        lastMsgMap.set(cid, {
          id: Number(row.id),
          content: contentStr || (attachName ? `مرفق: ${attachName}` : ''),
          senderName: String(row.sender_name || 'عضو GTU'),
        });
      }

      // Single grouped unread count query (using conversation_reads fallback 0)
      const unreadRes = await db.execute(sql`
        SELECT
          m.conversation_id,
          COUNT(*)::int AS unread_count
        FROM messages m
        LEFT JOIN conversation_reads cr
          ON cr.conversation_id = m.conversation_id AND cr.user_id = ${userId}
        WHERE m.is_deleted = FALSE
          AND m.sender_id <> ${userId}
          AND m.conversation_id = ANY(${visibleConvIds}::int[])
          AND m.id > COALESCE(cr.last_read_message_id, 0)
        GROUP BY m.conversation_id
      `);
      for (const row of unreadRes.rows as Array<Record<string, unknown>>) {
        unreadCountMap.set(Number(row.conversation_id), Number(row.unread_count || 0));
      }
    }

    const visibleConvs = candidateConvs.map((c) => {
      const lastMsg = lastMsgMap.get(c.id);
      const onlineCount = getRoomOnlineCount(c.id);
      if (c.type === 'national' || c.type === 'official_channel') {
        return {
          ...c,
          isMember: true,
          onlineCount,
          unreadCount: myReadsMap.has(c.id) ? unreadCountMap.get(c.id) || 0 : Math.min(unreadCountMap.get(c.id) || 0, 99),
          lastMessagePreview: lastMsg?.content || '',
          lastMessageSender: lastMsg?.senderName || '',
        };
      }
      if (c.type === 'wilaya_group') {
        const g = c.groupId ? groupMap.get(c.groupId) : null;
        const isMember = c.groupId ? myGroupIds.has(c.groupId) : false;
        return {
          ...c,
          wilayaId: g?.wilayaId || null,
          slug: g?.slug || '',
          isMember,
          memberCount: c.groupId ? groupMemberCountMap.get(c.groupId) || 0 : 0,
          onlineCount,
          unreadCount: isMember ? unreadCountMap.get(c.id) || 0 : 0,
          lastMessagePreview: lastMsg?.content || '',
          lastMessageSender: lastMsg?.senderName || '',
        };
      }
      const otherId = c.participantOneId === userId ? c.participantTwoId : c.participantOneId;
      const partner = otherId ? partnerMap.get(otherId) : undefined;
      return {
        ...c,
        title: partner?.name || c.title || 'عضو',
        otherUserId: otherId,
        otherAvatar: partner?.avatar || '',
        isOnline: otherId ? wsClientsByUser.has(otherId) : false,
        isMember: true,
        onlineCount,
        unreadCount: unreadCountMap.get(c.id) || 0,
        lastMessagePreview: lastMsg?.content || '',
        lastMessageSender: lastMsg?.senderName || '',
      };
    });

    res.json({ conversations: visibleConvs });
  } catch (err) {
    console.error('Conversations fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل قائمة المحادثات' });
  }
});

app.post('/api/groups/:groupId/join', requireAuth, async (req: AuthRequest, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const [g] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    if (!g) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    await db
      .insert(groupMembers)
      .values({ groupId, userId: req.dbUser!.id, roleInGroup: 'member' })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    console.error('Join group error:', err);
    res.status(500).json({ error: 'تعذر الانضمام للمجموعة' });
  }
});

app.post('/api/groups/:groupId/leave', requireAuth, async (req: AuthRequest, res) => {
  try {
    const groupId = Number(req.params.groupId);
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, req.dbUser!.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error('Leave group error:', err);
    res.status(500).json({ error: 'تعذر مغادرة المجموعة' });
  }
});

app.post('/api/conversations/direct', requireAuth, async (req: AuthRequest, res) => {
  try {
    const me = req.dbUser!.id;
    const targetUserId = Number(req.body?.targetUserId);
    if (!targetUserId || targetUserId === me) {
      return res.status(400).json({ error: 'معرف العضو غير صالح.' });
    }

    const blocks = await db
      .select()
      .from(blockedUsers)
      .where(
        or(
          and(eq(blockedUsers.blockerId, targetUserId), eq(blockedUsers.blockedId, me)),
          and(eq(blockedUsers.blockerId, me), eq(blockedUsers.blockedId, targetUserId))
        )
      )
      .limit(1);
    if (blocks.length > 0) {
      return res.status(403).json({ error: 'لا يمكن مراسلة هذا العضو بسبب إعدادات الحظر.' });
    }

    const [targetProfile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, targetUserId))
      .limit(1);
    if (!targetProfile || !targetProfile.privacyAllowDm) {
      return res.status(403).json({ error: 'العضو لا يستقبل رسائل خاصة حسب إعدادات الخصوصية لديه.' });
    }

    const p1 = Math.min(me, targetUserId);
    const p2 = Math.max(me, targetUserId);

    const existing = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.type, 'direct'),
          eq(conversations.participantOneId, p1),
          eq(conversations.participantTwoId, p2)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return res.json({ conversation: existing[0] });
    }

    const [created] = await db
      .insert(conversations)
      .values({
        type: 'direct',
        title: `${targetProfile.firstName} ${targetProfile.lastName}`,
        participantOneId: p1,
        participantTwoId: p2,
      })
      .returning();

    res.status(201).json({ conversation: created });
  } catch (err) {
    console.error('Direct conv error:', err);
    res.status(500).json({ error: 'تعذر فتح المحادثة الخاصة' });
  }
});

// High-speed cursor-paginated messages + search + pinned messages + read receipt
app.get('/api/conversations/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const convId = Number(req.params.id);
    const viewerId = req.dbUser!.id;
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
    if (!conv) return res.status(404).json({ error: 'المحادثة غير موجودة' });

    if (
      conv.type === 'direct' &&
      conv.participantOneId !== viewerId &&
      conv.participantTwoId !== viewerId
    ) {
      return res.status(403).json({ error: 'غير مصرح لك بعرض هذه المحادثة.' });
    }

    const rawLimit = Number(req.query.limit) || 50;
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const beforeId = Number(req.query.beforeId) || 0;
    const afterId = Number(req.query.afterId) || 0;
    const searchQuery = sanitizeText(req.query.q, 80);

    const baseSelect = {
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      replyToId: messages.replyToId,
      content: messages.content,
      attachmentUrl: messages.attachmentUrl,
      attachmentName: messages.attachmentName,
      attachmentType: messages.attachmentType,
      isOfficial: messages.isOfficial,
      isPinned: messages.isPinned,
      editedAt: messages.editedAt,
      createdAt: messages.createdAt,
      senderFirstName: profiles.firstName,
      senderLastName: profiles.lastName,
      senderAvatar: profiles.avatarUrl,
      senderRole: users.roleSlug,
      senderMemberNo: users.nationalMemberNumber,
    };

    let orderedRows;
    let hasMore = false;

    if (searchQuery) {
      const normalizedQ = normalizeArabic(searchQuery);
      const recentCandidates = await db
        .select(baseSelect)
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .where(and(eq(messages.conversationId, convId), eq(messages.isDeleted, false)))
        .orderBy(desc(messages.id))
        .limit(500);

      orderedRows = recentCandidates
        .filter((r) => {
          const senderFull = `${r.senderFirstName || ''} ${r.senderLastName || ''}`;
          return normalizeArabic(`${r.content} ${r.attachmentName || ''} ${senderFull}`).includes(normalizedQ);
        })
        .slice(0, limit)
        .reverse();
    } else if (afterId > 0) {
      orderedRows = await db
        .select(baseSelect)
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .where(
          and(
            eq(messages.conversationId, convId),
            eq(messages.isDeleted, false),
            gt(messages.id, afterId)
          )
        )
        .orderBy(messages.id)
        .limit(limit);
    } else {
      const conditions = [eq(messages.conversationId, convId), eq(messages.isDeleted, false)];
      if (beforeId > 0) conditions.push(lt(messages.id, beforeId));

      const descRows = await db
        .select(baseSelect)
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(messages.id))
        .limit(limit + 1);

      if (descRows.length > limit) {
        hasMore = true;
        descRows.pop();
      }
      orderedRows = descRows.reverse();
    }

    const hydrated = await hydrateMessages(orderedRows, viewerId);

    // Only load pinned messages & DM read receipt on initial load (not every scroll page)
    let pinnedMessages: typeof hydrated = [];
    let otherLastReadMessageId = 0;
    if (beforeId === 0 && afterId === 0 && !searchQuery) {
      const pinnedRaw = await db
        .select(baseSelect)
        .from(messages)
        .innerJoin(users, eq(messages.senderId, users.id))
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .where(
          and(
            eq(messages.conversationId, convId),
            eq(messages.isDeleted, false),
            eq(messages.isPinned, true)
          )
        )
        .orderBy(desc(messages.id))
        .limit(5);
      pinnedMessages = await hydrateMessages(pinnedRaw, viewerId);

      if (conv.type === 'direct') {
        const otherId = conv.participantOneId === viewerId ? conv.participantTwoId : conv.participantOneId;
        if (otherId) {
          const [otherRead] = await db
            .select({ lastReadMessageId: conversationReads.lastReadMessageId })
            .from(conversationReads)
            .where(
              and(eq(conversationReads.conversationId, convId), eq(conversationReads.userId, otherId))
            )
            .limit(1);
          otherLastReadMessageId = otherRead?.lastReadMessageId || 0;
        }
      }
    }

    res.json({
      messages: hydrated,
      hasMore,
      nextCursor: hydrated.length > 0 ? hydrated[0].id : null,
      pinnedMessages,
      otherLastReadMessageId,
      onlineCount: getRoomOnlineCount(convId),
    });
  } catch (err) {
    console.error('Messages fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل الرسائل' });
  }
});

app.post('/api/conversations/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const convId = Number(req.params.id);
    const senderId = req.dbUser!.id;

    // Anti-spam / flood protection (30 messages per 10 seconds per user)
    if (!checkRateLimit(`chat_send:${senderId}`, 30, 10_000)) {
      return res.status(429).json({ error: 'تم إرسال عدد كبير من الرسائل بسرعة. يرجى الانتظار بضع ثوانٍ.' });
    }

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId)).limit(1);
    if (!conv) return res.status(404).json({ error: 'المحادثة غير موجودة' });

    const isAdmin = userHasAnyPermission(req.dbUser, ['publish_announcements']);

    if (conv.type === 'official_channel' && !isAdmin) {
      return res.status(403).json({ error: 'النشر في قناة الإعلانات الرسمية مقتصر على أصحاب صلاحية النشر الرسمي.' });
    }

    if (conv.type === 'wilaya_group' && conv.groupId) {
      const [membership] = await db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, conv.groupId), eq(groupMembers.userId, senderId)))
        .limit(1);
      if (!membership) {
        return res.status(403).json({ error: 'يرجى الانضمام إلى المجموعة الولائية أولاً للمشاركة في النقاش.' });
      }
    }

    if (conv.type === 'direct') {
      if (conv.participantOneId !== senderId && conv.participantTwoId !== senderId) {
        return res.status(403).json({ error: 'غير مصرح لك بالإرسال في هذه المحادثة.' });
      }
      const otherId = conv.participantOneId === senderId ? conv.participantTwoId : conv.participantOneId;
      if (otherId) {
        const blocks = await db
          .select()
          .from(blockedUsers)
          .where(
            or(
              and(eq(blockedUsers.blockerId, otherId), eq(blockedUsers.blockedId, senderId)),
              and(eq(blockedUsers.blockerId, senderId), eq(blockedUsers.blockedId, otherId))
            )
          )
          .limit(1);
        if (blocks.length > 0) {
          return res.status(403).json({ error: 'تعذر الإرسال لوجود حظر بين الطرفين.' });
        }
      }
    }

    const cleanContent = sanitizeText(req.body?.content, 3000);
    const clientTempId = sanitizeText(req.body?.clientTempId, 64);
    const rawReplyId = Number(req.body?.replyToId) || 0;
    let replyToId: number | null = null;
    let replyToSnippet: { id: number; senderName: string; content: string; attachmentName?: string } | null = null;

    if (rawReplyId > 0) {
      const [parentMsg] = await db
        .select({
          id: messages.id,
          conversationId: messages.conversationId,
          content: messages.content,
          attachmentName: messages.attachmentName,
          isDeleted: messages.isDeleted,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
        })
        .from(messages)
        .leftJoin(profiles, eq(profiles.userId, messages.senderId))
        .where(and(eq(messages.id, rawReplyId), eq(messages.conversationId, convId)))
        .limit(1);
      if (parentMsg) {
        replyToId = parentMsg.id;
        replyToSnippet = {
          id: parentMsg.id,
          senderName: parentMsg.firstName ? `${parentMsg.firstName} ${parentMsg.lastName}` : 'عضو GTU',
          content: parentMsg.isDeleted ? 'رسالة محذوفة' : parentMsg.content.slice(0, 120),
          attachmentName: parentMsg.attachmentName || undefined,
        };
      }
    }

    let attachmentUrl = '';
    let attachmentName = '';
    let attachmentType = '';
    if (req.body?.attachmentDataUrl) {
      const saved = saveBase64Upload(req.body.attachmentDataUrl, req.body.attachmentName);
      if (saved) {
        attachmentUrl = saved.url;
        attachmentName = saved.fileName;
        attachmentType = saved.mimeType;
      }
    }

    if (!cleanContent && !attachmentUrl) {
      return res.status(400).json({ error: 'لا يمكن إرسال رسالة فارغة.' });
    }

    const isOfficial = conv.type === 'official_channel' || (isAdmin && Boolean(req.body?.isOfficial));

    const [created] = await db
      .insert(messages)
      .values({
        conversationId: convId,
        senderId,
        replyToId,
        content: cleanContent || 'مرفق',
        attachmentUrl,
        attachmentName,
        attachmentType,
        isOfficial,
      })
      .returning();

    await Promise.all([
      db
        .update(conversations)
        .set({ lastMessageAt: created.createdAt })
        .where(eq(conversations.id, convId)),
      db
        .insert(conversationReads)
        .values({
          conversationId: convId,
          userId: senderId,
          lastReadMessageId: created.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [conversationReads.conversationId, conversationReads.userId],
          set: {
            lastReadMessageId: sql`GREATEST(${conversationReads.lastReadMessageId}, ${created.id})`,
            updatedAt: new Date(),
          },
        }),
    ]);

    const [prof] = await db
      .select({ firstName: profiles.firstName, lastName: profiles.lastName, avatarUrl: profiles.avatarUrl })
      .from(profiles)
      .where(eq(profiles.userId, senderId))
      .limit(1);

    const payload = {
      ...created,
      replyTo: replyToSnippet,
      reactions: [],
      clientTempId: clientTempId || undefined,
      senderName: prof ? `${prof.firstName} ${prof.lastName}` : req.dbUser!.username,
      senderAvatar: prof?.avatarUrl || '',
      senderRole: req.dbUser!.roleSlug,
      senderMemberNo: req.dbUser!.nationalMemberNumber,
    };

    const previewText = cleanContent.slice(0, 100) || (attachmentName ? `مرفق: ${attachmentName}` : 'رسالة جديدة');

    if (conv.type === 'direct') {
      const otherId = conv.participantOneId === senderId ? conv.participantTwoId : conv.participantOneId;
      const targets = otherId ? [senderId, otherId] : [senderId];
      broadcastEvent({ type: 'message:new', message: payload }, targets);
      broadcastEvent(
        {
          type: 'conversation:updated',
          conversationId: convId,
          lastMessageAt: created.createdAt,
          lastMessagePreview: previewText,
          lastMessageSender: payload.senderName,
          senderId,
        },
        targets
      );
      if (otherId) {
        await createAndPushNotification({
          userId: otherId,
          type: 'message',
          title: `رسالة خاصة من ${payload.senderName}`,
          body: previewText,
          link: '/?route=dm',
        });
      }
    } else {
      // Room-targeted pub/sub: O(room subscribers) instead of O(all connected sockets)
      broadcastToRoom(convId, { type: 'message:new', message: payload });
      // Also notify sender's other devices & update conversation list metadata lightly
      broadcastEvent({
        type: 'conversation:updated',
        conversationId: convId,
        lastMessageAt: created.createdAt,
        lastMessagePreview: previewText,
        lastMessageSender: payload.senderName,
        senderId,
      });

      // Batched non-blocking Web Push for wilaya group members currently not in the room
      if (conv.type === 'wilaya_group' && conv.groupId) {
        const roomSubs = wsRoomSubscribers.get(convId);
        const activeRoomUserIds = new Set<number>([senderId]);
        if (roomSubs) {
          for (const sc of roomSubs) activeRoomUserIds.add(sc.userId);
        }

        void (async () => {
          try {
            const subRows = await db
              .select({
                id: pushSubscriptions.id,
                userId: pushSubscriptions.userId,
                endpoint: pushSubscriptions.endpoint,
                p256dh: pushSubscriptions.p256dh,
                auth: pushSubscriptions.auth,
              })
              .from(pushSubscriptions)
              .innerJoin(groupMembers, eq(groupMembers.userId, pushSubscriptions.userId))
              .where(eq(groupMembers.groupId, conv.groupId!))
              .limit(300);

            const offlineSubs = subRows.filter((s) => !activeRoomUserIds.has(s.userId));
            if (offlineSubs.length === 0) return;
            const keys = await ensureVapidKeys();
            if (!keys) return;

            const pushBody = JSON.stringify({
              title: `${conv.title || 'مجموعة ولائية'} — ${payload.senderName}`,
              body: previewText,
              url: '/?route=groups',
              tag: `gtu-msg-${created.id}`,
              type: 'message',
            });

            await Promise.allSettled(
              offlineSubs.map(async (sub) => {
                try {
                  await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    pushBody,
                    { TTL: 86400, urgency: 'high' }
                  );
                } catch (err: any) {
                  if (err?.statusCode === 404 || err?.statusCode === 410) {
                    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).catch(() => {});
                  }
                }
              })
            );
          } catch {
            // silent background push batch failure
          }
        })();
      }
    }

    res.status(201).json({ message: payload });
  } catch (err: any) {
    console.error('Send message error:', err);
    res.status(500).json({ error: err?.message || 'تعذر إرسال الرسالة' });
  }
});

app.post('/api/conversations/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const convId = Number(req.params.id);
    const userId = req.dbUser!.id;
    let lastReadMessageId = Number(req.body?.lastReadMessageId) || 0;

    if (lastReadMessageId <= 0) {
      const [latest] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, convId), eq(messages.isDeleted, false)))
        .orderBy(desc(messages.id))
        .limit(1);
      lastReadMessageId = latest?.id || 0;
    }

    if (lastReadMessageId > 0) {
      await db
        .insert(conversationReads)
        .values({
          conversationId: convId,
          userId,
          lastReadMessageId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [conversationReads.conversationId, conversationReads.userId],
          set: {
            lastReadMessageId: sql`GREATEST(${conversationReads.lastReadMessageId}, ${lastReadMessageId})`,
            updatedAt: new Date(),
          },
        });

      const [conv] = await db
        .select({
          type: conversations.type,
          participantOneId: conversations.participantOneId,
          participantTwoId: conversations.participantTwoId,
        })
        .from(conversations)
        .where(eq(conversations.id, convId))
        .limit(1);

      if (conv?.type === 'direct') {
        const otherId = conv.participantOneId === userId ? conv.participantTwoId : conv.participantOneId;
        if (otherId) {
          broadcastEvent(
            {
              type: 'conversation:read',
              conversationId: convId,
              readerId: userId,
              lastReadMessageId,
            },
            [otherId]
          );
        }
      }
    }

    res.json({ ok: true, lastReadMessageId });
  } catch (err) {
    console.error('Mark conversation read error:', err);
    res.status(500).json({ error: 'تعذر تحديث حالة القراءة' });
  }
});

app.patch('/api/messages/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [msg] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!msg || msg.isDeleted) return res.status(404).json({ error: 'الرسالة غير موجودة' });

    if (msg.senderId !== req.dbUser!.id) {
      return res.status(403).json({ error: 'يمكن فقط لصاحب الرسالة تعديلها.' });
    }

    const ageMs = Date.now() - new Date(msg.createdAt).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'انتهت المهلة المتاحة لتعديل هذه الرسالة (24 ساعة).' });
    }

    const cleanContent = sanitizeText(req.body?.content, 3000);
    if (!cleanContent) {
      return res.status(400).json({ error: 'نص الرسالة لا يمكن أن يكون فارغاً.' });
    }

    const editedAt = new Date();
    await db
      .update(messages)
      .set({ content: cleanContent, editedAt })
      .where(eq(messages.id, id));

    const updatePayload = {
      type: 'message:updated',
      conversationId: msg.conversationId,
      messageId: id,
      content: cleanContent,
      editedAt,
    };

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).limit(1);
    if (conv?.type === 'direct') {
      const targets = [conv.participantOneId, conv.participantTwoId].filter((v): v is number => Boolean(v));
      broadcastEvent(updatePayload, targets);
    } else {
      broadcastToRoom(msg.conversationId, updatePayload);
    }

    res.json({ ok: true, content: cleanContent, editedAt });
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'تعذر تعديل الرسالة' });
  }
});

app.post('/api/messages/:id/pin', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [msg] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!msg || msg.isDeleted) return res.status(404).json({ error: 'الرسالة غير موجودة' });

    const canPin = userHasAnyPermission(req.dbUser, ['moderate_chat', 'publish_announcements']);
    if (!canPin) {
      return res.status(403).json({ error: 'ليس لديك صلاحية تثبيت الرسائل.' });
    }

    const nextPinned = req.body?.isPinned !== undefined ? Boolean(req.body.isPinned) : !msg.isPinned;
    await db.update(messages).set({ isPinned: nextPinned }).where(eq(messages.id, id));

    broadcastToRoom(msg.conversationId, {
      type: 'message:pinned',
      conversationId: msg.conversationId,
      messageId: id,
      isPinned: nextPinned,
    });

    res.json({ ok: true, isPinned: nextPinned });
  } catch (err) {
    console.error('Pin message error:', err);
    res.status(500).json({ error: 'تعذر تثبيت الرسالة' });
  }
});

app.post('/api/messages/:id/reactions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const userId = req.dbUser!.id;
    const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';

    if (!ALLOWED_CHAT_EMOJIS.includes(emoji as (typeof ALLOWED_CHAT_EMOJIS)[number])) {
      return res.status(400).json({ error: 'رمز التفاعل غير مدعوم.' });
    }

    if (!checkRateLimit(`chat_react:${userId}`, 40, 10_000)) {
      return res.status(429).json({ error: 'تفاعلات سريعة جداً، يرجى التمهل قليلاً.' });
    }

    const [msg] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!msg || msg.isDeleted) return res.status(404).json({ error: 'الرسالة غير موجودة' });

    const existing = await db
      .select({ id: messageReactions.id })
      .from(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, id),
          eq(messageReactions.userId, userId),
          eq(messageReactions.emoji, emoji)
        )
      )
      .limit(1);

    let isAdded = false;
    if (existing.length > 0) {
      await db.delete(messageReactions).where(eq(messageReactions.id, existing[0].id));
    } else {
      await db.insert(messageReactions).values({ messageId: id, userId, emoji });
      isAdded = true;
    }

    const rawAll = await db
      .select({ emoji: messageReactions.emoji, userId: messageReactions.userId })
      .from(messageReactions)
      .where(eq(messageReactions.messageId, id));

    const summary = await getMessageReactionSummary(id, userId);

    const countsOnly = Array.from(
      rawAll.reduce((acc, r) => {
        acc.set(r.emoji, (acc.get(r.emoji) || 0) + 1);
        return acc;
      }, new Map<string, number>()).entries()
    ).map(([em, countVal]) => ({ emoji: em, count: countVal }));

    const reactionPayload = {
      type: 'message:reaction',
      conversationId: msg.conversationId,
      messageId: id,
      actorUserId: userId,
      emoji,
      isAdded,
      counts: countsOnly,
    };

    const [conv] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).limit(1);
    if (conv?.type === 'direct') {
      const targets = [conv.participantOneId, conv.participantTwoId].filter((v): v is number => Boolean(v));
      broadcastEvent(reactionPayload, targets);
    } else {
      broadcastToRoom(msg.conversationId, reactionPayload);
    }

    res.json({ ok: true, reactions: summary });
  } catch (err) {
    console.error('Reaction error:', err);
    res.status(500).json({ error: 'تعذر تحديث التفاعل' });
  }
});

app.delete('/api/messages/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [msg] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
    if (!msg) return res.status(404).json({ error: 'الرسالة غير موجودة' });

    const canModerate = userHasAnyPermission(req.dbUser, ['moderate_chat']);
    if (msg.senderId !== req.dbUser!.id && !canModerate) {
      return res.status(403).json({ error: 'ليس لديك صلاحية حذف هذه الرسالة.' });
    }

    await db.update(messages).set({ isDeleted: true, isPinned: false }).where(eq(messages.id, id));

    const delPayload = { type: 'message:deleted', messageId: id, conversationId: msg.conversationId };
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).limit(1);
    if (conv?.type === 'direct') {
      const targets = [conv.participantOneId, conv.participantTwoId].filter((v): v is number => Boolean(v));
      broadcastEvent(delPayload, targets);
    } else {
      broadcastToRoom(msg.conversationId, delPayload);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'تعذر حذف الرسالة' });
  }
});

app.post('/api/reports', requireAuth, async (req: AuthRequest, res) => {
  try {
    const targetType = sanitizeText(req.body?.targetType, 20);
    const targetId = Number(req.body?.targetId);
    const reason = sanitizeText(req.body?.reason, 500);
    if (!['message', 'user', 'proposal'].includes(targetType) || !targetId || !reason) {
      return res.status(400).json({ error: 'يرجى تحديد سبب البلاغ.' });
    }
    const [rep] = await db
      .insert(reports)
      .values({
        reporterId: req.dbUser!.id,
        targetType,
        targetId,
        reason,
      })
      .returning();
    res.status(201).json({ report: rep });
  } catch (err) {
    console.error('Create report error:', err);
    res.status(500).json({ error: 'تعذر إرسال البلاغ' });
  }
});

app.post('/api/users/:id/block', requireAuth, async (req: AuthRequest, res) => {
  try {
    const blockedId = Number(req.params.id);
    if (!blockedId || blockedId === req.dbUser!.id) {
      return res.status(400).json({ error: 'معرف غير صالح.' });
    }
    await db
      .insert(blockedUsers)
      .values({ blockerId: req.dbUser!.id, blockedId })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).json({ error: 'تعذر حظر العضو' });
  }
});

// ==================== Proposals & Initiatives ====================
app.get('/api/proposals', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const kind = sanitizeText(req.query.kind, 20);
    const status = sanitizeText(req.query.status, 40);
    const wilayaCode = sanitizeText(req.query.wilayaCode, 4);

    const rows = await db
      .select({
        id: proposals.id,
        authorId: proposals.authorId,
        title: proposals.title,
        description: proposals.description,
        category: proposals.category,
        kind: proposals.kind,
        wilayaId: proposals.wilayaId,
        status: proposals.status,
        adminResponse: proposals.adminResponse,
        rejectionReason: proposals.rejectionReason,
        supportersCount: proposals.supportersCount,
        createdAt: proposals.createdAt,
        updatedAt: proposals.updatedAt,
        authorFirstName: profiles.firstName,
        authorLastName: profiles.lastName,
        wilayaName: wilayas.nameAr,
        wilayaCode: wilayas.code,
      })
      .from(proposals)
      .leftJoin(profiles, eq(profiles.userId, proposals.authorId))
      .leftJoin(wilayas, eq(wilayas.id, proposals.wilayaId))
      .orderBy(desc(proposals.createdAt));

    const updates = await db
      .select()
      .from(proposalUpdates)
      .orderBy(proposalUpdates.createdAt);

    const updatesMap = new Map<number, typeof updates>();
    for (const u of updates) {
      const arr = updatesMap.get(u.proposalId) || [];
      arr.push(u);
      updatesMap.set(u.proposalId, arr);
    }

    const filtered = rows
      .filter((r) => {
        if (kind && r.kind !== kind) return false;
        if (status && r.status !== status) return false;
        if (wilayaCode && r.wilayaCode !== wilayaCode.padStart(2, '0')) return false;
        return true;
      })
      .map((r) => ({
        ...r,
        authorName: r.authorFirstName ? `${r.authorFirstName} ${r.authorLastName}` : 'عضو GTU',
        history: updatesMap.get(r.id) || [],
      }));

    res.json({ proposals: filtered });
  } catch (err) {
    console.error('Proposals fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل الاقتراحات والمبادرات' });
  }
});

app.post('/api/proposals', requireAuth, async (req: AuthRequest, res) => {
  try {
    const title = sanitizeText(req.body?.title, 180);
    const description = sanitizeText(req.body?.description, 4000);
    const category = sanitizeText(req.body?.category, 60) || 'اقتراح تطويري';
    const kind = req.body?.kind === 'initiative' ? 'initiative' : 'proposal';
    const wilayaCode = sanitizeText(req.body?.wilayaCode, 4);

    if (!title || !description) {
      return res.status(400).json({ error: 'يرجى كتابة عنوان الاقتراح وشرح الفكرة.' });
    }

    let wilayaId: number | null = null;
    if (wilayaCode) {
      const [w] = await db
        .select()
        .from(wilayas)
        .where(eq(wilayas.code, wilayaCode.padStart(2, '0')))
        .limit(1);
      if (w) wilayaId = w.id;
    }

    const [created] = await db
      .insert(proposals)
      .values({
        authorId: req.dbUser!.id,
        title,
        description,
        category,
        kind,
        wilayaId,
        status: 'جديد',
      })
      .returning();

    await db.insert(proposalUpdates).values({
      proposalId: created.id,
      actorId: req.dbUser!.id,
      previousStatus: '',
      newStatus: 'جديد',
      note: 'تم إيداع المقترح بنجاح.',
    });

    res.status(201).json({ proposal: created });
  } catch (err) {
    console.error('Create proposal error:', err);
    res.status(500).json({ error: 'تعذر إرسال الاقتراح' });
  }
});

app.post('/api/proposals/:id/support', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [updated] = await db
      .update(proposals)
      .set({ supportersCount: sql`${proposals.supportersCount} + 1` })
      .where(eq(proposals.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'غير موجود' });
    res.json({ proposal: updated });
  } catch (err) {
    console.error('Support proposal error:', err);
    res.status(500).json({ error: 'تعذر تسجيل التأييد' });
  }
});

app.patch(
  '/api/proposals/:id/status',
  requireAuth,
  requirePermission('manage_proposals'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const newStatus = sanitizeText(req.body?.status, 40);
      const validStatuses = ['جديد', 'قيد الدراسة', 'مقبول', 'قيد التنفيذ', 'تم التنفيذ', 'مرفوض'];
      if (!validStatuses.includes(newStatus)) {
        return res.status(400).json({ error: 'حالة الاقتراح غير صالحة.' });
      }
      const adminResponse = sanitizeText(req.body?.adminResponse, 2000);
      const rejectionReason = sanitizeText(req.body?.rejectionReason, 1000);
      const assignedToId = req.body?.assignedToId ? Number(req.body.assignedToId) : null;

      if (newStatus === 'مرفوض' && !rejectionReason) {
        return res.status(400).json({ error: 'يجب توضيح سبب الرفض عند رفض الاقتراح.' });
      }

      const [existing] = await db.select().from(proposals).where(eq(proposals.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'الاقتراح غير موجود.' });

      const [updated] = await db
        .update(proposals)
        .set({
          status: newStatus,
          adminResponse: adminResponse || existing.adminResponse,
          rejectionReason: newStatus === 'مرفوض' ? rejectionReason : existing.rejectionReason,
          assignedToId: assignedToId ?? existing.assignedToId,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, id))
        .returning();

      await db.insert(proposalUpdates).values({
        proposalId: id,
        actorId: req.dbUser!.id,
        previousStatus: existing.status,
        newStatus,
        note: adminResponse || rejectionReason || `تم تحديث الحالة إلى: ${newStatus}`,
      });

      await createAndPushNotification({
        userId: existing.authorId,
        type: 'proposal',
        title: `تحديث حول مقترحك: ${existing.title}`,
        body: `الحالة الجديدة: ${newStatus}${adminResponse ? ` — ${adminResponse}` : ''}`,
        link: '/proposals',
      });

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'PROPOSAL_STATUS_UPDATED',
        entityType: 'proposals',
        entityId: id,
        details: `${existing.status} -> ${newStatus}`,
      });

      res.json({ proposal: updated });
    } catch (err) {
      console.error('Proposal status update error:', err);
      res.status(500).json({ error: 'تعذر تحديث حالة الاقتراح' });
    }
  }
);

// ==================== Events & Meetings ====================
app.get('/api/events', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        eventType: events.eventType,
        eventDate: events.eventDate,
        location: events.location,
        meetingUrl: events.meetingUrl,
        wilayaId: events.wilayaId,
        organizerName: events.organizerName,
        maxSeats: events.maxSeats,
        registrationUrl: events.registrationUrl,
        createdAt: events.createdAt,
        wilayaName: wilayas.nameAr,
        wilayaCode: wilayas.code,
      })
      .from(events)
      .leftJoin(wilayas, eq(events.wilayaId, wilayas.id))
      .orderBy(events.eventDate);

    const attendeesRows = await db
      .select({
        eventId: eventAttendees.eventId,
        userId: eventAttendees.userId,
        status: eventAttendees.status,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
      })
      .from(eventAttendees)
      .leftJoin(profiles, eq(profiles.userId, eventAttendees.userId));

    const result = rows.map((ev) => {
      const evAttendees = attendeesRows.filter((a) => a.eventId === ev.id);
      const attending = evAttendees.filter((a) => a.status === 'attending');
      const declined = evAttendees.filter((a) => a.status === 'declined');
      const myStatus = req.dbUser
        ? evAttendees.find((a) => a.userId === req.dbUser!.id)?.status || null
        : null;
      return {
        ...ev,
        attendingCount: attending.length,
        declinedCount: declined.length,
        myStatus,
        attendeesPreview: req.dbUser
          ? attending.slice(0, 12).map((a) => ({
              userId: a.userId,
              name: a.firstName ? `${a.firstName} ${a.lastName}` : 'عضو GTU',
            }))
          : [],
      };
    });

    res.json({ events: result });
  } catch (err) {
    console.error('Events fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل الفعاليات والمواعيد' });
  }
});

app.post(
  '/api/events',
  requireAuth,
  requirePermission('manage_events'),
  async (req: AuthRequest, res) => {
    try {
      const title = sanitizeText(req.body?.title, 180);
      const description = sanitizeText(req.body?.description, 3000);
      const eventType = sanitizeText(req.body?.eventType, 60) || 'لقاء مهني';
      const eventDate = new Date(req.body?.eventDate);
      const location = sanitizeText(req.body?.location, 240);
      const meetingUrl = sanitizeText(req.body?.meetingUrl, 300);
      const organizerName = sanitizeText(req.body?.organizerName, 160) || 'إدارة المنصة الوطنية GTU';
      const maxSeats = req.body?.maxSeats ? Number(req.body.maxSeats) : null;
      const registrationUrl = sanitizeText(req.body?.registrationUrl, 300);
      const wilayaCode = sanitizeText(req.body?.wilayaCode, 4);

      if (!title || !description || Number.isNaN(eventDate.getTime())) {
        return res.status(400).json({ error: 'يرجى إدخال عنوان الفعالية والوصف والتاريخ الصحيح.' });
      }

      let wilayaId: number | null = null;
      if (wilayaCode) {
        const [w] = await db
          .select()
          .from(wilayas)
          .where(eq(wilayas.code, wilayaCode.padStart(2, '0')))
          .limit(1);
        if (w) wilayaId = w.id;
      }

      const [created] = await db
        .insert(events)
        .values({
          title,
          description,
          eventType,
          eventDate,
          location,
          meetingUrl,
          wilayaId,
          organizerName,
          maxSeats,
          registrationUrl,
          createdBy: req.dbUser!.id,
        })
        .returning();

      const targetEventUsers = wilayaId
        ? await db
            .select({ userId: profiles.userId })
            .from(profiles)
            .where(eq(profiles.residenceWilayaId, wilayaId))
        : await db.select({ userId: users.id }).from(users).where(eq(users.isActive, true));

      for (const tu of targetEventUsers.slice(0, 200)) {
        if (tu.userId === req.dbUser!.id) continue;
        await createAndPushNotification({
          userId: tu.userId,
          type: 'event',
          title: `فعالية جديدة: ${title}`,
          body: `${eventType} · ${location || 'عبر المنصة الوطنية GTU'}`,
          link: '/?route=events',
        });
      }

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'EVENT_CREATED',
        entityType: 'events',
        entityId: created.id,
        details: title,
      });

      res.status(201).json({ event: created });
    } catch (err) {
      console.error('Create event error:', err);
      res.status(500).json({ error: 'تعذر إنشاء الفعالية' });
    }
  }
);

app.post('/api/events/:id/rsvp', requireAuth, async (req: AuthRequest, res) => {
  try {
    const eventId = Number(req.params.id);
    const status = req.body?.status === 'declined' ? 'declined' : 'attending';
    const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!ev) return res.status(404).json({ error: 'الفعالية غير موجودة' });

    if (status === 'attending' && ev.maxSeats) {
      const [{ value: currentCount }] = await db
        .select({ value: count() })
        .from(eventAttendees)
        .where(and(eq(eventAttendees.eventId, eventId), eq(eventAttendees.status, 'attending')));
      if (Number(currentCount || 0) >= ev.maxSeats) {
        return res.status(400).json({ error: 'اكتمل عدد المقاعد المخصص لهذه الفعالية.' });
      }
    }

    await db
      .insert(eventAttendees)
      .values({ eventId, userId: req.dbUser!.id, status })
      .onConflictDoUpdate({
        target: [eventAttendees.eventId, eventAttendees.userId],
        set: { status, updatedAt: new Date() },
      });

    res.json({ ok: true, status });
  } catch (err) {
    console.error('RSVP error:', err);
    res.status(500).json({ error: 'تعذر تسجيل الحضور' });
  }
});

app.delete(
  '/api/events/:id',
  requireAuth,
  requirePermission('manage_events'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [ev] = await db.select().from(events).where(eq(events.id, id)).limit(1);
      if (!ev) return res.status(404).json({ error: 'الفعالية غير موجودة' });
      await db.delete(events).where(eq(events.id, id));
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'EVENT_DELETED',
        entityType: 'events',
        entityId: id,
        details: ev.title,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete event error:', err);
      res.status(500).json({ error: 'تعذر حذف الفعالية' });
    }
  }
);

// ==================== Announcements & News ====================
app.get('/api/announcements', optionalAuth, async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        content: announcements.content,
        scope: announcements.scope,
        targetWilayaId: announcements.targetWilayaId,
        isPinned: announcements.isPinned,
        attachmentUrl: announcements.attachmentUrl,
        publishedAt: announcements.publishedAt,
        wilayaName: wilayas.nameAr,
        wilayaCode: wilayas.code,
      })
      .from(announcements)
      .leftJoin(wilayas, eq(announcements.targetWilayaId, wilayas.id))
      .orderBy(desc(announcements.isPinned), desc(announcements.publishedAt));

    res.json({ announcements: rows });
  } catch (err) {
    console.error('Announcements error:', err);
    res.status(500).json({ error: 'تعذر تحميل الإعلانات' });
  }
});

app.post(
  '/api/announcements',
  requireAuth,
  requirePermission('publish_announcements'),
  async (req: AuthRequest, res) => {
    try {
      const title = sanitizeText(req.body?.title, 200);
      const content = sanitizeText(req.body?.content, 4000);
      const scope = req.body?.scope === 'wilaya' ? 'wilaya' : 'national';
      const isPinned = Boolean(req.body?.isPinned);
      const wilayaCode = sanitizeText(req.body?.wilayaCode, 4);

      if (!title || !content) {
        return res.status(400).json({ error: 'عنوان الإعلان ومحتواه مطلوبان.' });
      }

      if (scope === 'national' && req.dbUser!.roleSlug === 'wilaya_rep') {
        return res.status(403).json({ error: 'ممثل الولاية ينشر إعلانات ولائية فقط.' });
      }

      let targetWilayaId: number | null = null;
      if (scope === 'wilaya' && wilayaCode) {
        const [w] = await db
          .select()
          .from(wilayas)
          .where(eq(wilayas.code, wilayaCode.padStart(2, '0')))
          .limit(1);
        if (w) targetWilayaId = w.id;
      }

      let attachmentUrl = '';
      if (req.body?.attachmentDataUrl) {
        const saved = saveBase64Upload(req.body.attachmentDataUrl, req.body.attachmentName);
        if (saved) attachmentUrl = saved.url;
      }

      const [created] = await db
        .insert(announcements)
        .values({
          title,
          content,
          scope,
          targetWilayaId,
          isPinned,
          attachmentUrl,
          authorId: req.dbUser!.id,
          publishedAt: req.body?.publishedAt ? new Date(req.body.publishedAt) : new Date(),
        })
        .returning();

      // Notify targeted users (all active or wilaya residents)
      const targetUsers = targetWilayaId
        ? await db
            .select({ userId: profiles.userId })
            .from(profiles)
            .where(eq(profiles.residenceWilayaId, targetWilayaId))
        : await db.select({ userId: users.id }).from(users).where(eq(users.isActive, true));

      for (const tu of targetUsers.slice(0, 200)) {
        await createAndPushNotification({
          userId: tu.userId,
          type: 'announcement',
          title: `إعلان رسمي جديد: ${title}`,
          body: content.slice(0, 120),
          link: '/?route=announcements',
        });
      }

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'ANNOUNCEMENT_PUBLISHED',
        entityType: 'announcements',
        entityId: created.id,
        details: title,
      });

      res.status(201).json({ announcement: created });
    } catch (err: any) {
      console.error('Create announcement error:', err);
      res.status(500).json({ error: err?.message || 'تعذر نشر الإعلان' });
    }
  }
);

app.patch(
  '/api/announcements/:id',
  requireAuth,
  requirePermission('publish_announcements'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: 'الإعلان غير موجود' });

      const [updated] = await db
        .update(announcements)
        .set({
          title: sanitizeText(req.body?.title, 200) || existing.title,
          content: sanitizeText(req.body?.content, 4000) || existing.content,
          isPinned: typeof req.body?.isPinned === 'boolean' ? req.body.isPinned : existing.isPinned,
        })
        .where(eq(announcements.id, id))
        .returning();
      res.json({ announcement: updated });
    } catch (err) {
      console.error('Update announcement error:', err);
      res.status(500).json({ error: 'تعذر تعديل الإعلان' });
    }
  }
);

app.delete(
  '/api/announcements/:id',
  requireAuth,
  requirePermission('publish_announcements'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(announcements).where(eq(announcements.id, id));
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete announcement error:', err);
      res.status(500).json({ error: 'تعذر حذف الإعلان' });
    }
  }
);

// ==================== Notifications ====================
app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.dbUser!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    const unreadCount = list.filter((n) => !n.isRead).length;
    res.json({ notifications: list, unreadCount });
  } catch (err) {
    console.error('Notifications fetch error:', err);
    res.status(500).json({ error: 'تعذر تحميل الإشعارات' });
  }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, req.dbUser!.id)));
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'تعذر تحديث حالة الإشعار' });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req: AuthRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, req.dbUser!.id));
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ error: 'تعذر تحديث الإشعارات' });
  }
});

// ==================== Web Push Subscriptions (Background Mobile Notifications) ====================
app.get('/api/push/vapid-public-key', async (_req, res) => {
  const keys = await ensureVapidKeys();
  if (!keys) {
    return res.status(503).json({ error: 'تعذر تهيئة مفاتيح الإشعارات الفورية' });
  }
  res.json({ publicKey: keys.publicKey });
});

app.get('/api/push/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const subs = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, req.dbUser!.id));
    res.json({ subscribedCount: subs.length });
  } catch (err) {
    console.error('Push status error:', err);
    res.status(500).json({ error: 'تعذر التحقق من حالة الإشعارات' });
  }
});

app.post('/api/push/subscribe', requireAuth, async (req: AuthRequest, res) => {
  try {
    const sub = req.body?.subscription || req.body;
    const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint.trim() : '';
    const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh.trim() : '';
    const authKey = typeof sub?.keys?.auth === 'string' ? sub.keys.auth.trim() : '';

    if (!endpoint || !p256dh || !authKey || !endpoint.startsWith('https://')) {
      return res.status(400).json({ error: 'بيانات اشتراك الإشعارات غير صالحة.' });
    }

    const userAgent = sanitizeText(req.headers['user-agent'] || '', 240);

    await db
      .insert(pushSubscriptions)
      .values({
        userId: req.dbUser!.id,
        endpoint,
        p256dh,
        auth: authKey,
        userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: req.dbUser!.id,
          p256dh,
          auth: authKey,
          userAgent,
          updatedAt: new Date(),
        },
      });

    res.json({ ok: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'تعذر حفظ اشتراك الإشعارات' });
  }
});

app.delete('/api/push/subscribe', requireAuth, async (req: AuthRequest, res) => {
  try {
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
    if (endpoint) {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, req.dbUser!.id),
            eq(pushSubscriptions.endpoint, endpoint)
          )
        );
    } else {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, req.dbUser!.id));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'تعذر إلغاء اشتراك الإشعارات' });
  }
});

app.post('/api/push/test', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await sendWebPushToUser(req.dbUser!.id, {
      title: 'GTU الجزائر — اختبار الإشعارات الفورية',
      body: 'تعمل إشعارات المنصة الوطنية بنجاح في أعلى الهاتف حتى عندما يكون التطبيق غير فعال.',
      url: '/?route=notifications',
      tag: `gtu-test-${Date.now()}`,
      type: 'test',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Push test error:', err);
    res.status(500).json({ error: 'تعذر إرسال الإشعار التجريبي' });
  }
});

// ==================== Unified National Search ====================
app.get('/api/search', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const rawQ = sanitizeText(req.query.q, 80);
    const q = normalizeArabic(rawQ);
    if (!q || q.length < 2) {
      return res.json({
        members: [],
        wilayas: [],
        communes: [],
        announcements: [],
        proposals: [],
        events: [],
        groups: [],
      });
    }

    const allW = await db.select().from(wilayas);
    const matchedWilayas = allW
      .filter((w) => normalizeArabic(w.nameAr).includes(q) || w.nameEn.toLowerCase().includes(q) || w.code === rawQ)
      .slice(0, 10);

    const allC = await db.select().from(communes);
    const matchedCommunes = allC
      .filter((c) => normalizeArabic(c.nameAr).includes(q) || c.nameEn.toLowerCase().includes(q))
      .slice(0, 15);

    const allAnns = await db.select().from(announcements).orderBy(desc(announcements.publishedAt));
    const matchedAnns = allAnns
      .filter((a) => normalizeArabic(`${a.title} ${a.content}`).includes(q))
      .slice(0, 10);

    const allProps = await db.select().from(proposals).orderBy(desc(proposals.createdAt));
    const matchedProps = allProps
      .filter((p) => normalizeArabic(`${p.title} ${p.description}`).includes(q))
      .slice(0, 10);

    const allEvs = await db.select().from(events).orderBy(events.eventDate);
    const matchedEvs = allEvs
      .filter((e) => normalizeArabic(`${e.title} ${e.description} ${e.location}`).includes(q))
      .slice(0, 10);

    const allGrps = await db.select().from(groups);
    const matchedGrps = allGrps
      .filter((g) => normalizeArabic(`${g.nameAr} ${g.description}`).includes(q))
      .slice(0, 10);

    // Members only returned for authenticated accounts
    let matchedMembers: Array<Record<string, unknown>> = [];
    if (req.dbUser) {
      const mRows = await db
        .select({
          userId: users.id,
          nationalMemberNumber: users.nationalMemberNumber,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          graduationYear: graduationRecords.graduationYear,
          wilayaName: wilayas.nameAr,
        })
        .from(users)
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .leftJoin(graduationRecords, eq(graduationRecords.userId, users.id))
        .leftJoin(wilayas, eq(profiles.residenceWilayaId, wilayas.id))
        .where(eq(users.isActive, true));

      matchedMembers = mRows
        .filter((m) =>
          normalizeArabic(
            `${m.firstName} ${m.lastName} ${m.nationalMemberNumber} ${m.graduationYear || ''} ${m.wilayaName || ''}`
          ).includes(q)
        )
        .slice(0, 15);
    }

    res.json({
      members: matchedMembers,
      wilayas: matchedWilayas,
      communes: matchedCommunes,
      announcements: matchedAnns,
      proposals: matchedProps,
      events: matchedEvs,
      groups: matchedGrps,
    });
  } catch (err) {
    console.error('Unified search error:', err);
    res.status(500).json({ error: 'تعذر تنفيذ البحث الوطني' });
  }
});

// ==================== Reports & Exports ====================
app.get(
  '/api/reports/summary',
  requireAuth,
  requirePermission('export_reports'),
  async (_req: AuthRequest, res) => {
    try {
      const allW = await db.select().from(wilayas).orderBy(wilayas.code);
      const allC = await db.select().from(communes);
      const wMap = new Map(allW.map((w) => [w.id, w]));
      const cMap = new Map(allC.map((c) => [c.id, c]));

      const graduates = await db
        .select({
          userId: users.id,
          nationalMemberNumber: users.nationalMemberNumber,
          roleSlug: users.roleSlug,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
          residenceWilayaId: profiles.residenceWilayaId,
          residenceCommuneId: profiles.residenceCommuneId,
          graduationYear: graduationRecords.graduationYear,
          institutionName: graduationRecords.institutionName,
          specialty: graduationRecords.specialty,
        })
        .from(users)
        .innerJoin(profiles, eq(profiles.userId, users.id))
        .leftJoin(graduationRecords, eq(graduationRecords.userId, users.id))
        .where(eq(users.isActive, true));

      const byWilayaMap = new Map<string, { code: string; nameAr: string; count: number }>();
      const byCommuneMap = new Map<string, { wilayaName: string; communeName: string; count: number }>();
      const byYearMap = new Map<number, number>();
      const byInstitutionMap = new Map<string, number>();
      const byMonthMap = new Map<string, number>();

      for (const g of graduates) {
        const w = g.residenceWilayaId ? wMap.get(g.residenceWilayaId) : null;
        const c = g.residenceCommuneId ? cMap.get(g.residenceCommuneId) : null;
        if (w) {
          const cur = byWilayaMap.get(w.code) || { code: w.code, nameAr: w.nameAr, count: 0 };
          cur.count += 1;
          byWilayaMap.set(w.code, cur);
        }
        if (c && w) {
          const key = `${w.code}-${c.id}`;
          const cur = byCommuneMap.get(key) || { wilayaName: w.nameAr, communeName: c.nameAr, count: 0 };
          cur.count += 1;
          byCommuneMap.set(key, cur);
        }
        if (g.graduationYear) {
          byYearMap.set(g.graduationYear, (byYearMap.get(g.graduationYear) || 0) + 1);
        }
        const inst = g.institutionName || 'غير محدد';
        byInstitutionMap.set(inst, (byInstitutionMap.get(inst) || 0) + 1);
        const month = new Date(g.createdAt).toISOString().slice(0, 7);
        byMonthMap.set(month, (byMonthMap.get(month) || 0) + 1);
      }

      const proposalsList = await db.select().from(proposals);
      const eventsList = await db.select().from(events);

      res.json({
        totalGraduates: graduates.length,
        byWilaya: Array.from(byWilayaMap.values()).sort((a, b) => b.count - a.count),
        byCommune: Array.from(byCommuneMap.values()).sort((a, b) => b.count - a.count),
        byGraduationYear: Array.from(byYearMap.entries())
          .map(([year, count]) => ({ year, count }))
          .sort((a, b) => b.year - a.year),
        byInstitution: Array.from(byInstitutionMap.entries())
          .map(([institutionName, count]) => ({ institutionName, count }))
          .sort((a, b) => b.count - a.count),
        monthlyRegistrations: Array.from(byMonthMap.entries())
          .map(([month, count]) => ({ month, count }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        proposalsSummary: proposalsList.map((p) => ({
          id: p.id,
          title: p.title,
          kind: p.kind,
          category: p.category,
          status: p.status,
          supportersCount: p.supportersCount,
          createdAt: p.createdAt,
        })),
        eventsSummary: eventsList.map((e) => ({
          id: e.id,
          title: e.title,
          eventType: e.eventType,
          eventDate: e.eventDate,
          location: e.location,
          organizerName: e.organizerName,
        })),
        graduatesDirectoryExport: graduates.map((g) => ({
          nationalMemberNumber: g.nationalMemberNumber,
          fullName: `${g.firstName} ${g.lastName}`,
          wilaya: g.residenceWilayaId ? wMap.get(g.residenceWilayaId)?.nameAr || '' : '',
          commune: g.residenceCommuneId ? cMap.get(g.residenceCommuneId)?.nameAr || '' : '',
          graduationYear: g.graduationYear || '',
          institutionName: g.institutionName || '',
          specialty: g.specialty || '',
          createdAt: g.createdAt,
        })),
      });
    } catch (err) {
      console.error('Reports summary error:', err);
      res.status(500).json({ error: 'تعذر إعداد التقارير' });
    }
  }
);

// ==================== Standalone Admin Panel: Overview, RBAC, Users, Overrides, Sessions, Moderation, Settings & Backups ====================
app.get('/api/admin/overview', requireAuth, requirePermission('view_admin_panel'), async (_req, res) => {
  try {
    const now = new Date();
    const [{ value: totalUsers }] = await db.select({ value: count() }).from(users);
    const [{ value: activeUsers }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isActive, true));
    const [{ value: activeSessionsCount }] = await db
      .select({ value: count() })
      .from(userSessions)
      .where(and(isNull(userSessions.revokedAt), sql`${userSessions.expiresAt} > ${now}`));
    const [{ value: pendingReportsCount }] = await db
      .select({ value: count() })
      .from(reports)
      .where(eq(reports.status, 'pending'));
    const [{ value: pendingProposalsCount }] = await db
      .select({ value: count() })
      .from(proposals)
      .where(inArray(proposals.status, ['جديد', 'قيد الدراسة']));
    const [{ value: totalRolesCount }] = await db.select({ value: count() }).from(roles);
    const [{ value: totalPermissionsCount }] = await db.select({ value: count() }).from(permissions);
    const [{ value: totalOverridesCount }] = await db.select({ value: count() }).from(userPermissions);

    const roleBreakdown = await db
      .select({
        roleSlug: users.roleSlug,
        count: count(),
      })
      .from(users)
      .groupBy(users.roleSlug);

    const allRoles = await db.select().from(roles).orderBy(desc(roles.level));
    const roleMap = new Map(allRoles.map((r) => [r.slug, r.nameAr]));

    const recentAuditLogs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
        actorUsername: users.username,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(10);

    res.json({
      kpis: {
        totalUsers: Number(totalUsers || 0),
        activeUsers: Number(activeUsers || 0),
        suspendedUsers: Math.max(0, Number(totalUsers || 0) - Number(activeUsers || 0)),
        activeSessionsCount: Number(activeSessionsCount || 0),
        pendingReportsCount: Number(pendingReportsCount || 0),
        pendingProposalsCount: Number(pendingProposalsCount || 0),
        totalRolesCount: Number(totalRolesCount || 0),
        totalPermissionsCount: Number(totalPermissionsCount || 0),
        totalOverridesCount: Number(totalOverridesCount || 0),
      },
      usersByRole: roleBreakdown.map((r) => ({
        roleSlug: r.roleSlug,
        nameAr: roleMap.get(r.roleSlug) || r.roleSlug,
        count: Number(r.count || 0),
      })),
      recentAuditLogs,
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'تعذر تحميل ملخص لوحة الإدارة' });
  }
});

// ---- Roles CRUD ----
app.get(
  '/api/admin/roles',
  requireAuth,
  requirePermission('view_admin_panel', 'manage_roles', 'manage_permissions', 'manage_users'),
  async (_req, res) => {
    try {
      const allRoles = await db.select().from(roles).orderBy(desc(roles.level), roles.id);
      const counts = await db
        .select({ roleId: users.roleId, count: count() })
        .from(users)
        .groupBy(users.roleId);
      const countMap = new Map(counts.map((c) => [c.roleId, Number(c.count || 0)]));
      res.json({
        roles: allRoles.map((r) => ({
          ...r,
          usersCount: countMap.get(r.id) || 0,
        })),
      });
    } catch (err) {
      console.error('List roles error:', err);
      res.status(500).json({ error: 'تعذر تحميل الأدوار الوظيفية' });
    }
  }
);

app.post('/api/admin/roles', requireAuth, requirePermission('manage_roles'), async (req: AuthRequest, res) => {
  try {
    const slug = sanitizeText(req.body?.slug, 32)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const nameAr = sanitizeText(req.body?.nameAr, 100);
    const description = sanitizeText(req.body?.description, 300);
    const level = Math.max(1, Math.min(99, Number(req.body?.level) || 20));

    if (!slug || !/^[a-z][a-z0-9_]{2,30}$/.test(slug)) {
      return res.status(400).json({
        error: 'المعرف البرمجي للدور يجب أن يبدأ بحرف إنجليزي صغير (3 إلى 30 حرفاً وأرقاماً و_).',
      });
    }
    if (!nameAr) {
      return res.status(400).json({ error: 'الاسم العربي للدور الوظيفي مطلوب.' });
    }
    const existing = await db.select().from(roles).where(eq(roles.slug, slug)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'يوجد دور وظيفي بنفس المعرف البرمجي مسبقاً.' });
    }

    const [created] = await db
      .insert(roles)
      .values({ slug, nameAr, description, level, isSystem: false })
      .returning();

    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'ROLE_CREATED',
      entityType: 'roles',
      entityId: created.id,
      details: `${nameAr} (${slug}) - مستوى ${level}`,
    });

    res.status(201).json({ role: { ...created, usersCount: 0 } });
  } catch (err) {
    console.error('Create role error:', err);
    res.status(500).json({ error: 'تعذر إنشاء الدور الوظيفي' });
  }
});

app.patch('/api/admin/roles/:id', requireAuth, requirePermission('manage_roles'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الدور الوظيفي غير موجود.' });

    const nameAr = sanitizeText(req.body?.nameAr, 100) || existing.nameAr;
    const description =
      req.body?.description !== undefined ? sanitizeText(req.body.description, 300) : existing.description;
    const rawLevel = req.body?.level !== undefined ? Number(req.body.level) : existing.level;
    const level =
      existing.slug === 'super_admin' ? 100 : Math.max(1, Math.min(99, Number.isFinite(rawLevel) ? rawLevel : existing.level));

    const [updated] = await db
      .update(roles)
      .set({ nameAr, description, level })
      .where(eq(roles.id, id))
      .returning();

    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'ROLE_UPDATED',
      entityType: 'roles',
      entityId: id,
      details: `${updated.nameAr} (${updated.slug})`,
    });

    res.json({ role: updated });
  } catch (err) {
    console.error('Update role meta error:', err);
    res.status(500).json({ error: 'تعذر تحديث الدور الوظيفي' });
  }
});

app.delete('/api/admin/roles/:id', requireAuth, requirePermission('manage_roles'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'الدور غير موجود.' });
    if (existing.isSystem) {
      return res.status(400).json({ error: 'لا يمكن حذف الأدوار الأساسية للنظام.' });
    }

    const [{ value: assignedCount }] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.roleId, id));

    if (Number(assignedCount || 0) > 0) {
      // Reassign users safely to default 'member' role before deleting custom role
      const [memberRole] = await db.select().from(roles).where(eq(roles.slug, 'member')).limit(1);
      if (!memberRole) {
        return res.status(400).json({ error: 'يرجى نقل الأعضاء المرتبطين بهذا الدور قبل حذفه.' });
      }
      await db
        .update(users)
        .set({ roleId: memberRole.id, roleSlug: memberRole.slug, updatedAt: new Date() })
        .where(eq(users.roleId, id));
    }

    // Remove deleted role slug from permissions allowedRoles JSON arrays
    const allPerms = await db.select().from(permissions);
    for (const p of allPerms) {
      const arr = parseAllowedRoles(p.allowedRoles);
      if (arr.includes(existing.slug)) {
        const nextArr = arr.filter((s) => s !== existing.slug);
        await db
          .update(permissions)
          .set({ allowedRoles: JSON.stringify(nextArr) })
          .where(eq(permissions.id, p.id));
      }
    }

    await db.delete(roles).where(eq(roles.id, id));
    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'ROLE_DELETED',
      entityType: 'roles',
      entityId: id,
      details: `${existing.nameAr} (${existing.slug})`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete role error:', err);
    res.status(500).json({ error: 'تعذر حذف الدور الوظيفي' });
  }
});

// ---- Users Management, Full Dossiers, Password Control, Roles & Sessions ----
app.get(
  '/api/admin/users',
  requireAuth,
  requirePermission(
    'view_admin_panel',
    'manage_users',
    'manage_permissions',
    'manage_user_sessions',
    'export_reports'
  ),
  async (_req, res) => {
    try {
      const now = new Date();
      const [
        userRows,
        allGradRows,
        allWilayas,
        allCommunes,
        overrideCounts,
        sessionCounts,
        allRoles,
      ] = await Promise.all([
        db
          .select({
            id: users.id,
            username: users.username,
            email: users.email,
            passwordHash: users.passwordHash,
            nationalMemberNumber: users.nationalMemberNumber,
            roleId: users.roleId,
            roleSlug: users.roleSlug,
            assignedWilayaCode: users.assignedWilayaCode,
            isActive: users.isActive,
            createdAt: users.createdAt,
            lastLoginAt: users.lastLoginAt,
            firstName: profiles.firstName,
            lastName: profiles.lastName,
            phone: profiles.phone,
            birthDate: profiles.birthDate,
            birthPlace: profiles.birthPlace,
            birthWilayaId: profiles.birthWilayaId,
            birthCommuneId: profiles.birthCommuneId,
            residenceWilayaId: profiles.residenceWilayaId,
            residenceCommuneId: profiles.residenceCommuneId,
            avatarUrl: profiles.avatarUrl,
            bio: profiles.bio,
            skills: profiles.skills,
            experience: profiles.experience,
            privacyShowPhone: profiles.privacyShowPhone,
            privacyShowBirthDate: profiles.privacyShowBirthDate,
            privacyShowEmail: profiles.privacyShowEmail,
            privacyAllowDm: profiles.privacyAllowDm,
          })
          .from(users)
          .leftJoin(profiles, eq(profiles.userId, users.id)),
        db.select().from(graduationRecords),
        db.select().from(wilayas),
        db.select().from(communes),
        db
          .select({ userId: userPermissions.userId, count: count() })
          .from(userPermissions)
          .groupBy(userPermissions.userId),
        db
          .select({ userId: userSessions.userId, count: count() })
          .from(userSessions)
          .where(and(isNull(userSessions.revokedAt), sql`${userSessions.expiresAt} > ${now}`))
          .groupBy(userSessions.userId),
        db.select().from(roles),
      ]);

      const gradMap = new Map(allGradRows.map((g) => [g.userId, g]));
      const wMap = new Map(allWilayas.map((w) => [w.id, w]));
      const cMap = new Map(allCommunes.map((c) => [c.id, c]));
      const ovMap = new Map(overrideCounts.map((o) => [o.userId, Number(o.count || 0)]));
      const sessMap = new Map(sessionCounts.map((s) => [s.userId, Number(s.count || 0)]));
      const roleMap = new Map(allRoles.map((r) => [r.slug, r.nameAr]));

      const enriched = userRows
        .map((r) => {
          const resW = r.residenceWilayaId ? wMap.get(r.residenceWilayaId) : null;
          const resC = r.residenceCommuneId ? cMap.get(r.residenceCommuneId) : null;
          const birthW = r.birthWilayaId ? wMap.get(r.birthWilayaId) : null;
          const birthC = r.birthCommuneId ? cMap.get(r.birthCommuneId) : null;
          const grad = gradMap.get(r.id);

          return {
            id: r.id,
            username: r.username,
            email: r.email,
            nationalMemberNumber: r.nationalMemberNumber,
            roleId: r.roleId,
            roleSlug: r.roleSlug,
            roleNameAr: roleMap.get(r.roleSlug) || r.roleSlug,
            assignedWilayaCode: r.assignedWilayaCode,
            isActive: r.isActive,
            hasPassword: Boolean(r.passwordHash && r.passwordHash.length > 0),
            createdAt: r.createdAt,
            lastLoginAt: r.lastLoginAt,
            firstName: r.firstName,
            lastName: r.lastName,
            phone: r.phone || '',
            birthDate: r.birthDate || '',
            birthPlace: r.birthPlace || '',
            birthWilayaCode: birthW?.code || '',
            birthWilayaName: birthW?.nameAr || '',
            birthCommuneName: birthC?.nameAr || '',
            wilayaCode: resW?.code || '',
            wilayaName: resW?.nameAr || '',
            communeName: resC?.nameAr || '',
            avatarUrl: r.avatarUrl || '',
            bio: r.bio || '',
            skills: r.skills || '',
            experience: r.experience || '',
            specialty: grad?.specialty || '',
            graduationYear: grad?.graduationYear || null,
            institutionName: grad?.institutionName || '',
            degreeLevel: grad?.degreeLevel || '',
            extraInfo: grad?.extraInfo || '',
            privacyShowPhone: Boolean(r.privacyShowPhone),
            privacyShowBirthDate: Boolean(r.privacyShowBirthDate),
            privacyShowEmail: Boolean(r.privacyShowEmail),
            privacyAllowDm: r.privacyAllowDm !== false,
            overridesCount: ovMap.get(r.id) || 0,
            activeSessionsCount: sessMap.get(r.id) || 0,
          };
        })
        .sort((a, b) => {
          const wa = a.wilayaCode || '99';
          const wb = b.wilayaCode || '99';
          if (wa !== wb) return wa.localeCompare(wb);
          const na = `${a.firstName || ''} ${a.lastName || ''} ${a.username}`.trim();
          const nb = `${b.firstName || ''} ${b.lastName || ''} ${b.username}`.trim();
          return na.localeCompare(nb, 'ar');
        });

      res.json({ users: enriched });
    } catch (err) {
      console.error('Admin users error:', err);
      res.status(500).json({ error: 'تعذر تحميل قائمة المستخدمين' });
    }
  }
);

app.post(
  '/api/admin/users',
  requireAuth,
  requirePermission('manage_users'),
  async (req: AuthRequest, res) => {
    try {
      const cleanFirst = sanitizeText(req.body?.firstName, 60);
      const cleanLast = sanitizeText(req.body?.lastName, 60);
      const cleanUsername = sanitizeText(req.body?.username, 40).toLowerCase();
      const cleanEmail = sanitizeText(req.body?.email, 120).toLowerCase();
      const cleanPhone = sanitizeText(req.body?.phone, 24);
      const cleanBirthDate = sanitizeText(req.body?.birthDate, 20);
      const cleanBirthPlace = sanitizeText(req.body?.birthPlace, 100);
      const residenceWilayaCode = sanitizeText(req.body?.residenceWilayaCode, 4).padStart(2, '0');
      const residenceCommuneId = req.body?.residenceCommuneId ? Number(req.body.residenceCommuneId) : null;
      const specialty = sanitizeText(req.body?.specialty, 120) || 'تقنيات حضرية';
      const graduationYear = Number(req.body?.graduationYear) || new Date().getFullYear();
      const institutionName =
        sanitizeText(req.body?.institutionName, 160) || 'معهد / جامعة وطنية للتقنيات الحضرية';
      const requestedRoleSlug = sanitizeText(req.body?.roleSlug, 32) || 'member';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (!cleanFirst || !cleanLast || !cleanUsername || !/^[a-zA-Z0-9_.-]{3,32}$/.test(cleanUsername)) {
        return res.status(400).json({ error: 'الاسم واللقب واسم المستخدم الإنجليزي الصحيح مطلوبون.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' });
      }
      if (requestedRoleSlug === 'super_admin' && req.dbUser!.roleSlug !== 'super_admin') {
        return res.status(403).json({ error: 'إنشاء حساب مسؤول عام مقتصر على المسؤول العام.' });
      }

      const existingU = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, cleanUsername))
        .limit(1);
      if (existingU.length > 0) {
        return res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً.' });
      }
      if (cleanEmail) {
        const existingE = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, cleanEmail))
          .limit(1);
        if (existingE.length > 0) {
          return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً.' });
        }
      }

      const [roleRow] = await db.select().from(roles).where(eq(roles.slug, requestedRoleSlug)).limit(1);
      if (!roleRow) return res.status(400).json({ error: 'الدور الوظيفي غير موجود.' });

      let resWId: number | null = null;
      let resCId: number | null = null;
      if (residenceWilayaCode && residenceWilayaCode !== '00') {
        const [rw] = await db.select().from(wilayas).where(eq(wilayas.code, residenceWilayaCode)).limit(1);
        if (rw) {
          resWId = rw.id;
          if (residenceCommuneId) {
            const [rc] = await db
              .select()
              .from(communes)
              .where(and(eq(communes.id, residenceCommuneId), eq(communes.wilayaId, rw.id)))
              .limit(1);
            if (rc) resCId = rc.id;
          }
        }
      }

      const [{ value: userTotal }] = await db.select({ value: count() }).from(users);
      const nationalMemberNumber = generateNationalMemberNumber(
        new Date().getFullYear(),
        Number(userTotal || 0) + 1
      );
      const uid = `gtu_${crypto.randomUUID()}`;

      const [created] = await db
        .insert(users)
        .values({
          uid,
          username: cleanUsername,
          email: cleanEmail,
          passwordHash: hashPassword(password),
          nationalMemberNumber,
          roleId: roleRow.id,
          roleSlug: roleRow.slug,
          assignedWilayaCode: roleRow.slug === 'wilaya_rep' && resWId ? residenceWilayaCode : '',
          isActive: true,
          acceptedTerms: true,
          acceptedTermsAt: new Date(),
        })
        .returning();

      await db.insert(profiles).values({
        userId: created.id,
        firstName: cleanFirst,
        lastName: cleanLast,
        birthDate: cleanBirthDate,
        birthPlace: cleanBirthPlace,
        birthWilayaId: resWId,
        birthCommuneId: resCId,
        phone: cleanPhone,
        residenceWilayaId: resWId,
        residenceCommuneId: resCId,
      });

      await db.insert(graduationRecords).values({
        userId: created.id,
        specialty,
        graduationYear,
        institutionName,
      });

      const targetGroups = await db
        .select()
        .from(groups)
        .where(resWId ? or(eq(groups.isNational, true), eq(groups.wilayaId, resWId)) : eq(groups.isNational, true));
      if (targetGroups.length > 0) {
        await db
          .insert(groupMembers)
          .values(targetGroups.map((g) => ({ groupId: g.id, userId: created.id, roleInGroup: 'member' })))
          .onConflictDoNothing();
      }

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_CREATED_BY_ADMIN',
        entityType: 'users',
        entityId: created.id,
        details: `إنشاء حساب @${cleanUsername} (${roleRow.nameAr})`,
      });

      res.status(201).json({ ok: true, id: created.id });
    } catch (err: any) {
      console.error('Admin create user error:', err);
      res.status(500).json({ error: err?.message || 'تعذر إنشاء الحساب' });
    }
  }
);

app.patch(
  '/api/admin/users/:id/password',
  requireAuth,
  requirePermission('manage_users'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تتكون من 8 أحرف على الأقل.' });
      }
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'الحساب غير موجود.' });
      if (targetUser.roleSlug === 'super_admin' && req.dbUser!.roleSlug !== 'super_admin') {
        return res.status(403).json({ error: 'تغيير كلمة مرور المسؤول العام مقتصر على المسؤول العام.' });
      }

      await db
        .update(users)
        .set({ passwordHash: hashPassword(newPassword), updatedAt: new Date() })
        .where(eq(users.id, targetId));

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_PASSWORD_RESET_BY_ADMIN',
        entityType: 'users',
        entityId: targetId,
        details: `تعيين كلمة مرور جديدة للحساب @${targetUser.username}`,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Admin reset password error:', err);
      res.status(500).json({ error: 'تعذر تحديث كلمة المرور' });
    }
  }
);

app.patch(
  '/api/admin/users/:id/profile',
  requireAuth,
  requirePermission('manage_users'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'الحساب غير موجود.' });
      if (
        targetUser.roleSlug === 'super_admin' &&
        targetUser.id !== req.dbUser!.id &&
        req.dbUser!.roleSlug !== 'super_admin'
      ) {
        return res.status(403).json({ error: 'تعديل ملف المسؤول العام مقتصر على المسؤول العام.' });
      }

      const body = req.body || {};
      const [existingProf] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, targetId))
        .limit(1);

      let nextResWilayaId = existingProf?.residenceWilayaId ?? null;
      let nextResCommuneId = existingProf?.residenceCommuneId ?? null;
      if (body.residenceWilayaCode) {
        const [rw] = await db
          .select()
          .from(wilayas)
          .where(eq(wilayas.code, String(body.residenceWilayaCode).padStart(2, '0')))
          .limit(1);
        if (rw) {
          nextResWilayaId = rw.id;
          if (body.residenceCommuneId) {
            const [rc] = await db
              .select()
              .from(communes)
              .where(and(eq(communes.id, Number(body.residenceCommuneId)), eq(communes.wilayaId, rw.id)))
              .limit(1);
            nextResCommuneId = rc ? rc.id : null;
          }
        }
      }

      if (body.email !== undefined) {
        const cleanEmail = sanitizeText(body.email, 120).toLowerCase();
        await db
          .update(users)
          .set({ email: cleanEmail, updatedAt: new Date() })
          .where(eq(users.id, targetId));
      }

      if (existingProf) {
        await db
          .update(profiles)
          .set({
            firstName: sanitizeText(body.firstName, 60) || existingProf.firstName,
            lastName: sanitizeText(body.lastName, 60) || existingProf.lastName,
            phone: body.phone !== undefined ? sanitizeText(body.phone, 24) : existingProf.phone,
            birthDate:
              body.birthDate !== undefined ? sanitizeText(body.birthDate, 20) : existingProf.birthDate,
            birthPlace:
              body.birthPlace !== undefined ? sanitizeText(body.birthPlace, 100) : existingProf.birthPlace,
            bio: body.bio !== undefined ? sanitizeText(body.bio, 800) : existingProf.bio,
            skills: body.skills !== undefined ? sanitizeText(body.skills, 500) : existingProf.skills,
            experience:
              body.experience !== undefined ? sanitizeText(body.experience, 1000) : existingProf.experience,
            residenceWilayaId: nextResWilayaId,
            residenceCommuneId: nextResCommuneId,
            updatedAt: new Date(),
          })
          .where(eq(profiles.userId, targetId));
      } else {
        await db.insert(profiles).values({
          userId: targetId,
          firstName: sanitizeText(body.firstName, 60) || targetUser.username,
          lastName: sanitizeText(body.lastName, 60) || '',
          phone: sanitizeText(body.phone, 24),
          birthDate: sanitizeText(body.birthDate, 20),
          birthPlace: sanitizeText(body.birthPlace, 100),
          residenceWilayaId: nextResWilayaId,
          residenceCommuneId: nextResCommuneId,
        });
      }

      const [existingGrad] = await db
        .select()
        .from(graduationRecords)
        .where(eq(graduationRecords.userId, targetId))
        .limit(1);
      if (existingGrad) {
        await db
          .update(graduationRecords)
          .set({
            specialty:
              body.specialty !== undefined
                ? sanitizeText(body.specialty, 120) || existingGrad.specialty
                : existingGrad.specialty,
            graduationYear: body.graduationYear ? Number(body.graduationYear) : existingGrad.graduationYear,
            institutionName:
              body.institutionName !== undefined
                ? sanitizeText(body.institutionName, 160) || existingGrad.institutionName
                : existingGrad.institutionName,
            degreeLevel:
              body.degreeLevel !== undefined
                ? sanitizeText(body.degreeLevel, 60) || existingGrad.degreeLevel
                : existingGrad.degreeLevel,
          })
          .where(eq(graduationRecords.id, existingGrad.id));
      }

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_PROFILE_UPDATED_BY_ADMIN',
        entityType: 'users',
        entityId: targetId,
        details: `تحديث بيانات ملف العضو @${targetUser.username}`,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Admin update profile error:', err);
      res.status(500).json({ error: 'تعذر تحديث بيانات العضو' });
    }
  }
);

app.patch(
  '/api/admin/users/:id/role',
  requireAuth,
  requirePermission('manage_users'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      const newRoleSlug = sanitizeText(req.body?.roleSlug, 32);
      const assignedWilayaCode = sanitizeText(req.body?.assignedWilayaCode, 4);

      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'الحساب غير موجود.' });
      if (targetUser.roleSlug === 'super_admin' && req.dbUser!.roleSlug !== 'super_admin') {
        return res.status(403).json({ error: 'تعديل صلاحيات المسؤول العام مقتصر على المسؤول العام فقط.' });
      }
      if (newRoleSlug === 'super_admin' && req.dbUser!.roleSlug !== 'super_admin') {
        return res.status(403).json({ error: 'تعيين المسؤول العام مقتصر على المسؤول العام الحالي فقط.' });
      }

      const [roleRow] = await db.select().from(roles).where(eq(roles.slug, newRoleSlug)).limit(1);
      if (!roleRow) return res.status(400).json({ error: 'الدور الوظيفي غير موجود في النظام.' });

      await db
        .update(users)
        .set({
          roleId: roleRow.id,
          roleSlug: roleRow.slug,
          assignedWilayaCode: assignedWilayaCode ? assignedWilayaCode.padStart(2, '0') : '',
          updatedAt: new Date(),
        })
        .where(eq(users.id, targetId));

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_ROLE_CHANGED',
        entityType: 'users',
        entityId: targetId,
        details: `تم تغيير الدور إلى ${roleRow.nameAr} (${newRoleSlug})${assignedWilayaCode ? ` - ولاية ${assignedWilayaCode}` : ''}`,
      });

      await createAndPushNotification({
        userId: targetId,
        type: 'account',
        title: 'تحديث صلاحيات الحساب',
        body: `تم تحديث دورك داخل المنصة إلى: ${roleRow.nameAr}`,
        link: '/dashboard',
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Update role error:', err);
      res.status(500).json({ error: 'تعذر تحديث صلاحية العضو' });
    }
  }
);

app.patch(
  '/api/admin/users/:id/status',
  requireAuth,
  requirePermission('manage_users'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      if (targetId === req.dbUser!.id) {
        return res.status(400).json({ error: 'لا يمكنك تعطيل حسابك الشخصي.' });
      }
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'الحساب غير موجود.' });
      if (targetUser.roleSlug === 'super_admin' && req.dbUser!.roleSlug !== 'super_admin') {
        return res.status(403).json({ error: 'لا يمكن تعليق حساب المسؤول العام.' });
      }

      const isActive = Boolean(req.body?.isActive);
      await db.update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, targetId));

      if (!isActive) {
        await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, targetId));
      }

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: isActive ? 'USER_ACTIVATED' : 'USER_SUSPENDED',
        entityType: 'users',
        entityId: targetId,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Update user status error:', err);
      res.status(500).json({ error: 'تعذر تحديث حالة الحساب' });
    }
  }
);

app.delete(
  '/api/admin/users/:id',
  requireAuth,
  requirePermission('delete_users'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      if (targetId === req.dbUser!.id) {
        return res.status(400).json({ error: 'لا يمكنك حذف حسابك من لوحة الإدارة.' });
      }
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'الحساب غير موجود.' });
      if (targetUser.roleSlug === 'super_admin') {
        return res.status(403).json({ error: 'لا يمكن حذف حساب المسؤول العام.' });
      }

      await db.delete(users).where(eq(users.id, targetId));
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_DELETED_BY_ADMIN',
        entityType: 'users',
        entityId: targetId,
        details: `حذف حساب @${targetUser.username} (${targetUser.nationalMemberNumber})`,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Admin delete user error:', err);
      res.status(500).json({ error: 'تعذر حذف الحساب' });
    }
  }
);

// ---- Per-User Granular Permission Overrides ----
app.get(
  '/api/admin/users/:id/permissions',
  requireAuth,
  requirePermission('manage_permissions', 'manage_users'),
  async (req, res) => {
    try {
      const targetId = Number(req.params.id);
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'المستخدم غير موجود.' });

      const [roleRow] = await db.select().from(roles).where(eq(roles.id, targetUser.roleId)).limit(1);
      const allPerms = await db.select().from(permissions).orderBy(permissions.id);
      const overrides = await db
        .select()
        .from(userPermissions)
        .where(eq(userPermissions.userId, targetId));

      const effective = await loadEffectivePermissionsForUser(targetUser.id, targetUser.roleSlug);
      res.json({
        user: {
          id: targetUser.id,
          username: targetUser.username,
          roleSlug: targetUser.roleSlug,
          roleNameAr: roleRow?.nameAr || targetUser.roleSlug,
        },
        permissions: allPerms,
        overrides,
        effectivePermissions: effective,
      });
    } catch (err) {
      console.error('Get user permissions error:', err);
      res.status(500).json({ error: 'تعذر تحميل صلاحيات العضو الفردية' });
    }
  }
);

app.put(
  '/api/admin/users/:id/permissions',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      const [targetUser] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
      if (!targetUser) return res.status(404).json({ error: 'المستخدم غير موجود.' });
      if (targetUser.roleSlug === 'super_admin') {
        return res.status(400).json({ error: 'المسؤول العام يمتلك كامل الصلاحيات تلقائياً ولا يحتاج استثناءات.' });
      }

      const items = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
      await db.delete(userPermissions).where(eq(userPermissions.userId, targetId));

      const toInsert = items
        .filter(
          (it: any) =>
            typeof it?.permissionKey === 'string' &&
            (it.effect === 'allow' || it.effect === 'deny')
        )
        .map((it: any) => ({
          userId: targetId,
          permissionKey: sanitizeText(it.permissionKey, 64),
          effect: it.effect as string,
          note: sanitizeText(it.note, 200),
          grantedBy: req.dbUser!.id,
          updatedAt: new Date(),
        }));

      if (toInsert.length > 0) {
        await db.insert(userPermissions).values(toInsert).onConflictDoNothing();
      }

      const effective = await loadEffectivePermissionsForUser(targetUser.id, targetUser.roleSlug);

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_PERMISSION_OVERRIDES_UPDATED',
        entityType: 'user_permissions',
        entityId: targetId,
        details: `تحديث ${toInsert.length} استثناء صلاحية فردي للعضو @${targetUser.username}`,
      });

      await createAndPushNotification({
        userId: targetId,
        type: 'account',
        title: 'تحديث صلاحيات الوصول الفردية',
        body: 'تم تحديث الصلاحيات الخاصة بحسابك من طرف الإدارة.',
        link: '/dashboard',
      });

      res.json({ ok: true, effectivePermissions: effective });
    } catch (err) {
      console.error('Update user permission overrides error:', err);
      res.status(500).json({ error: 'تعذر حفظ استثناءات صلاحيات العضو' });
    }
  }
);

// ---- User Active Sessions Inspection & Force Revocation ----
app.get(
  '/api/admin/users/:id/sessions',
  requireAuth,
  requirePermission('manage_user_sessions'),
  async (req, res) => {
    try {
      const targetId = Number(req.params.id);
      const list = await db
        .select({
          id: userSessions.id,
          deviceInfo: userSessions.deviceInfo,
          ipAddress: userSessions.ipAddress,
          createdAt: userSessions.createdAt,
          expiresAt: userSessions.expiresAt,
          revokedAt: userSessions.revokedAt,
        })
        .from(userSessions)
        .where(eq(userSessions.userId, targetId))
        .orderBy(desc(userSessions.createdAt))
        .limit(30);
      res.json({ sessions: list });
    } catch (err) {
      console.error('Admin user sessions error:', err);
      res.status(500).json({ error: 'تعذر تحميل جلسات العضو' });
    }
  }
);

app.delete(
  '/api/admin/users/:id/sessions/:sessionId',
  requireAuth,
  requirePermission('manage_user_sessions'),
  async (req: AuthRequest, res) => {
    try {
      const targetId = Number(req.params.id);
      const rawSessionId = req.params.sessionId;
      if (rawSessionId === 'all') {
        await db
          .update(userSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(userSessions.userId, targetId), isNull(userSessions.revokedAt)));
      } else {
        const sId = Number(rawSessionId);
        await db
          .update(userSessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(userSessions.id, sId), eq(userSessions.userId, targetId)));
      }

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'USER_SESSION_REVOKED_BY_ADMIN',
        entityType: 'user_sessions',
        entityId: targetId,
        details: rawSessionId === 'all' ? 'إنهاء جميع الجلسات النشطة' : `إنهاء الجلسة #${rawSessionId}`,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Admin revoke session error:', err);
      res.status(500).json({ error: 'تعذر إنهاء الجلسة' });
    }
  }
);

// ---- Global Permissions Matrix & Custom Permissions CRUD ----
app.get(
  '/api/admin/permissions',
  requireAuth,
  requirePermission('view_admin_panel', 'manage_permissions', 'manage_roles'),
  async (_req, res) => {
    try {
      const allRoles = await db.select().from(roles).orderBy(desc(roles.level), roles.id);
      const allPerms = await db.select().from(permissions).orderBy(permissions.category, permissions.id);
      const allOverrides = await db.select().from(userPermissions);
      res.json({
        roles: allRoles,
        permissions: allPerms,
        overridesCount: allOverrides.length,
      });
    } catch (err) {
      console.error('Permissions error:', err);
      res.status(500).json({ error: 'تعذر تحميل الصلاحيات' });
    }
  }
);

app.post(
  '/api/admin/permissions',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req: AuthRequest, res) => {
    try {
      const key = sanitizeText(req.body?.key, 50)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
      const nameAr = sanitizeText(req.body?.nameAr, 120);
      const category = sanitizeText(req.body?.category, 60) || 'صلاحيات مخصصة';
      const description = sanitizeText(req.body?.description, 300);
      const allowedRoles = Array.isArray(req.body?.allowedRoles) ? req.body.allowedRoles : ['super_admin'];

      if (!key || !/^[a-z][a-z0-9_]{2,48}$/.test(key)) {
        return res.status(400).json({
          error: 'مفتاح الصلاحية يجب أن يبدأ بحرف إنجليزي صغير ويحتوي على أحرف وأرقام و_ فقط.',
        });
      }
      if (!nameAr) {
        return res.status(400).json({ error: 'الاسم العربي للصلاحية مطلوب.' });
      }

      const existing = await db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'مفتاح الصلاحية مسجل مسبقاً.' });
      }

      const sanitizedRoles = Array.from(new Set(['super_admin', ...allowedRoles.map(String)]));
      const [created] = await db
        .insert(permissions)
        .values({
          key,
          nameAr,
          category,
          description,
          allowedRoles: JSON.stringify(sanitizedRoles),
          isSystem: false,
        })
        .returning();

      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'PERMISSION_CREATED',
        entityType: 'permissions',
        entityId: created.id,
        details: `${nameAr} (${key})`,
      });

      res.status(201).json({ permission: created });
    } catch (err) {
      console.error('Create permission error:', err);
      res.status(500).json({ error: 'تعذر إضافة الصلاحية' });
    }
  }
);

app.delete(
  '/api/admin/permissions/:id',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const [perm] = await db.select().from(permissions).where(eq(permissions.id, id)).limit(1);
      if (!perm) return res.status(404).json({ error: 'الصلاحية غير موجودة.' });
      if (perm.isSystem) {
        return res.status(400).json({ error: 'لا يمكن حذف الصلاحيات الأساسية للنظام.' });
      }

      await db.delete(userPermissions).where(eq(userPermissions.permissionKey, perm.key));
      await db.delete(permissions).where(eq(permissions.id, id));
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'PERMISSION_DELETED',
        entityType: 'permissions',
        entityId: id,
        details: `${perm.nameAr} (${perm.key})`,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete permission error:', err);
      res.status(500).json({ error: 'تعذر حذف الصلاحية' });
    }
  }
);

app.put(
  '/api/admin/permissions',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req: AuthRequest, res) => {
    try {
      const updates = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
      for (const p of updates) {
        if (p.key && Array.isArray(p.allowedRoles)) {
          const sanitizedRoles = Array.from(new Set(['super_admin', ...p.allowedRoles.map(String)]));
          await db
            .update(permissions)
            .set({ allowedRoles: JSON.stringify(sanitizedRoles) })
            .where(eq(permissions.key, String(p.key)));
        }
      }
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'PERMISSIONS_MATRIX_UPDATED',
        entityType: 'permissions',
        details: `تحديث ${updates.length} صلاحية في المصفوفة`,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Update permissions error:', err);
      res.status(500).json({ error: 'تعذر حفظ الصلاحيات' });
    }
  }
);

// ---- Content Moderation: Reports & Chat Messages Monitor ----
app.get('/api/admin/reports', requireAuth, requirePermission('moderate_chat'), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: reports.id,
        reporterId: reports.reporterId,
        targetType: reports.targetType,
        targetId: reports.targetId,
        reason: reports.reason,
        status: reports.status,
        reviewedBy: reports.reviewedBy,
        resolutionNote: reports.resolutionNote,
        createdAt: reports.createdAt,
        reporterUsername: users.username,
      })
      .from(reports)
      .leftJoin(users, eq(reports.reporterId, users.id))
      .orderBy(desc(reports.createdAt))
      .limit(150);
    res.json({ reports: rows });
  } catch (err) {
    console.error('Reports list error:', err);
    res.status(500).json({ error: 'تعذر تحميل البلاغات' });
  }
});

app.patch('/api/admin/reports/:id', requireAuth, requirePermission('moderate_chat'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const status = sanitizeText(req.body?.status, 30) || 'resolved';
    const resolutionNote = sanitizeText(req.body?.resolutionNote, 500);
    await db
      .update(reports)
      .set({ status, resolutionNote, reviewedBy: req.dbUser!.id })
      .where(eq(reports.id, id));
    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'MODERATION_REPORT_UPDATED',
      entityType: 'reports',
      entityId: id,
      details: `${status}${resolutionNote ? ` - ${resolutionNote}` : ''}`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Update report error:', err);
    res.status(500).json({ error: 'تعذر تحديث البلاغ' });
  }
});

app.get('/api/admin/messages', requireAuth, requirePermission('moderate_chat'), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        content: messages.content,
        isOfficial: messages.isOfficial,
        createdAt: messages.createdAt,
        conversationTitle: conversations.title,
        conversationType: conversations.type,
        senderUsername: users.username,
        senderFirstName: profiles.firstName,
        senderLastName: profiles.lastName,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .innerJoin(users, eq(messages.senderId, users.id))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(messages.isDeleted, false))
      .orderBy(desc(messages.createdAt))
      .limit(100);

    res.json({
      messages: rows.map((m) => ({
        ...m,
        senderName: m.senderFirstName ? `${m.senderFirstName} ${m.senderLastName}` : m.senderUsername,
      })),
    });
  } catch (err) {
    console.error('Admin messages list error:', err);
    res.status(500).json({ error: 'تعذر تحميل رسائل المحادثات' });
  }
});

// ---- Audit Logs ----
app.get('/api/admin/audit-logs', requireAuth, requirePermission('view_audit_logs'), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        actorUsername: users.username,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(250);
    res.json({ logs: rows });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'تعذر تحميل سجل العمليات' });
  }
});

// ---- Geography & Institutions ----
app.post(
  '/api/admin/communes',
  requireAuth,
  requirePermission('manage_geography'),
  async (req: AuthRequest, res) => {
    try {
      const wilayaCode = sanitizeText(req.body?.wilayaCode, 4).padStart(2, '0');
      const nameAr = sanitizeText(req.body?.nameAr, 100);
      const nameEn = sanitizeText(req.body?.nameEn, 100) || nameAr;
      const dairaAr = sanitizeText(req.body?.dairaAr, 100);
      const [w] = await db.select().from(wilayas).where(eq(wilayas.code, wilayaCode)).limit(1);
      if (!w || !nameAr) {
        return res.status(400).json({ error: 'الولاية واسم البلدية مطلوبان.' });
      }
      const [created] = await db
        .insert(communes)
        .values({ wilayaId: w.id, wilayaCode: w.code, dairaAr, nameAr, nameEn })
        .returning();
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'COMMUNE_ADDED',
        entityType: 'communes',
        entityId: created.id,
        details: `${nameAr} (${w.nameAr})`,
      });
      res.status(201).json({ commune: created });
    } catch (err) {
      console.error('Add commune error:', err);
      res.status(500).json({ error: 'تعذر إضافة البلدية (قد تكون مسجلة مسبقاً في هذه الولاية).' });
    }
  }
);

app.post(
  '/api/admin/geography/import',
  requireAuth,
  requirePermission('manage_geography'),
  async (req: AuthRequest, res) => {
    try {
      const entries = Array.isArray(req.body?.communes) ? req.body.communes : [];
      if (entries.length === 0) {
        return res.status(400).json({ error: 'يرجى توفير مصفوفة البلديات للاستيراد.' });
      }
      const allW = await db.select().from(wilayas);
      const wMap = new Map(allW.map((w) => [w.code, w.id]));
      let inserted = 0;
      for (const item of entries) {
        const wCode = String(item.wilayaCode || item.wilaya_code || '').padStart(2, '0');
        const wId = wMap.get(wCode);
        const nameAr = sanitizeText(item.nameAr || item.commune_name, 100);
        const nameEn = sanitizeText(item.nameEn || item.commune_name_ascii, 100) || nameAr;
        if (!wId || !nameAr) continue;
        await db
          .insert(communes)
          .values({
            wilayaId: wId,
            wilayaCode: wCode,
            dairaAr: sanitizeText(item.dairaAr || item.daira_name, 100),
            nameAr,
            nameEn,
          })
          .onConflictDoNothing();
        inserted += 1;
      }
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'GEOGRAPHY_IMPORTED',
        entityType: 'communes',
        details: `معالجة ${inserted} سجل بلدية`,
      });
      res.json({ ok: true, processed: inserted });
    } catch (err) {
      console.error('Import geo error:', err);
      res.status(500).json({ error: 'تعذر استيراد البيانات الجغرافية' });
    }
  }
);

app.post(
  '/api/admin/institutions',
  requireAuth,
  requirePermission('manage_geography'),
  async (req: AuthRequest, res) => {
    try {
      const nameAr = sanitizeText(req.body?.nameAr, 160);
      const type = sanitizeText(req.body?.type, 60) || 'جامعة / معهد';
      if (!nameAr) return res.status(400).json({ error: 'اسم المؤسسة مطلوب' });
      const [created] = await db
        .insert(institutions)
        .values({ nameAr, type, isActive: true })
        .returning();
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'INSTITUTION_ADDED',
        entityType: 'institutions',
        entityId: created.id,
        details: nameAr,
      });
      res.status(201).json({ institution: created });
    } catch (err) {
      console.error('Add institution error:', err);
      res.status(500).json({ error: 'تعذر إضافة المؤسسة' });
    }
  }
);

app.delete(
  '/api/admin/institutions/:id',
  requireAuth,
  requirePermission('manage_geography'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(institutions).where(eq(institutions.id, id));
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'INSTITUTION_DELETED',
        entityType: 'institutions',
        entityId: id,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Delete institution error:', err);
      res.status(500).json({ error: 'تعذر حذف المؤسسة (قد تكون مرتبطة بسجلات تخرج).' });
    }
  }
);

// ---- Platform Settings ----
app.get(
  '/api/admin/settings',
  requireAuth,
  requirePermission('view_admin_panel', 'manage_platform'),
  async (_req, res) => {
    try {
      const rows = await db.select().from(platformSettings).orderBy(platformSettings.id);
      res.json({ settings: rows.filter((r) => r.category !== 'internal_push') });
    } catch (err) {
      console.error('Get settings error:', err);
      res.status(500).json({ error: 'تعذر تحميل الإعدادات' });
    }
  }
);

app.put(
  '/api/admin/settings',
  requireAuth,
  requirePermission('manage_platform'),
  async (req: AuthRequest, res) => {
    try {
      const items = Array.isArray(req.body?.settings) ? req.body.settings : [];
      for (const item of items) {
        if (!item.key || item.value === undefined) continue;
        await db
          .insert(platformSettings)
          .values({
            key: sanitizeText(item.key, 80),
            value: sanitizeText(String(item.value), 5000),
            category: sanitizeText(item.category, 40) || 'general',
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: sanitizeText(String(item.value), 5000), updatedAt: new Date() },
          });
      }
      await writeAuditLog({
        actorId: req.dbUser!.id,
        action: 'PLATFORM_SETTINGS_UPDATED',
        entityType: 'platform_settings',
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('Update settings error:', err);
      res.status(500).json({ error: 'تعذر حفظ إعدادات المنصة' });
    }
  }
);

// ---- Backup & Restore ----
app.get('/api/admin/backup', requireAuth, requirePermission('manage_backups'), async (req: AuthRequest, res) => {
  try {
    const backup = {
      exportedAt: new Date().toISOString(),
      platform: 'GTU-Algeria',
      version: '1.1',
      data: {
        roles: await db.select().from(roles),
        permissions: await db.select().from(permissions),
        userPermissions: await db.select().from(userPermissions),
        institutions: await db.select().from(institutions),
        platformSettings: (await db.select().from(platformSettings)).filter(
          (s) => s.category !== 'internal_push'
        ),
        users: await db
          .select({
            id: users.id,
            uid: users.uid,
            username: users.username,
            email: users.email,
            nationalMemberNumber: users.nationalMemberNumber,
            roleId: users.roleId,
            roleSlug: users.roleSlug,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users),
        profiles: await db.select().from(profiles),
        graduationRecords: await db.select().from(graduationRecords),
        proposals: await db.select().from(proposals),
        events: await db.select().from(events),
        announcements: await db.select().from(announcements),
      },
    };
    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'BACKUP_EXPORTED',
      entityType: 'system',
    });
    res.setHeader('Content-Disposition', `attachment; filename="gtu-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(backup);
  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ error: 'تعذر تصدير النسخة الاحتياطية' });
  }
});

app.post('/api/admin/restore', requireAuth, requirePermission('manage_backups'), async (req: AuthRequest, res) => {
  try {
    const backupData = req.body?.data;
    if (!backupData || typeof backupData !== 'object') {
      return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح.' });
    }
    let restoredItems = 0;
    if (Array.isArray(backupData.platformSettings)) {
      for (const s of backupData.platformSettings) {
        if (!s.key || s.value === undefined) continue;
        await db
          .insert(platformSettings)
          .values({ key: s.key, value: String(s.value), category: s.category || 'general' })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: String(s.value), updatedAt: new Date() },
          });
        restoredItems += 1;
      }
    }
    if (Array.isArray(backupData.institutions)) {
      for (const inst of backupData.institutions) {
        if (!inst.nameAr) continue;
        await db
          .insert(institutions)
          .values({ nameAr: inst.nameAr, type: inst.type || 'جامعة / معهد', isActive: true })
          .onConflictDoNothing();
        restoredItems += 1;
      }
    }
    if (Array.isArray(backupData.announcements)) {
      for (const ann of backupData.announcements) {
        if (!ann.title || !ann.content) continue;
        const existing = await db.select().from(announcements).where(eq(announcements.title, ann.title)).limit(1);
        if (existing.length === 0) {
          await db.insert(announcements).values({
            title: ann.title,
            content: ann.content,
            scope: ann.scope || 'national',
            isPinned: Boolean(ann.isPinned),
          });
          restoredItems += 1;
        }
      }
    }
    await writeAuditLog({
      actorId: req.dbUser!.id,
      action: 'BACKUP_RESTORED',
      entityType: 'system',
      details: `تمت استعادة ${restoredItems} عنصر من النسخة الاحتياطية`,
    });
    res.json({ ok: true, restoredItems });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'تعذر استعادة النسخة الاحتياطية' });
  }
});

// ==================== Vite Dev Middleware or Static Production ====================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: {
          server: httpServer,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GTU National Platform running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
