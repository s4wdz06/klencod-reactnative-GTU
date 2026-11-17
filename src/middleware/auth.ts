import { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { auditLogs, permissions, roles, userPermissions, userSessions, users } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { computeEffectivePermissions } from '../lib/rbac.ts';
import {
  generateNationalMemberNumber,
  hashSessionToken,
  parseCookies,
  verifySignedSessionToken,
} from '../lib/security.ts';

export interface AuthenticatedDbUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  nationalMemberNumber: string;
  roleId: number;
  roleSlug: string;
  roleLevel: number;
  assignedWilayaCode: string;
  isActive: boolean;
  permissions: string[];
}

export interface AuthRequest extends Request {
  dbUser?: AuthenticatedDbUser;
  sessionId?: number;
}

export async function loadEffectivePermissionsForUser(
  userId: number,
  roleSlug: string
): Promise<string[]> {
  const [allPerms, overrides] = await Promise.all([
    db.select({ key: permissions.key, allowedRoles: permissions.allowedRoles }).from(permissions),
    db
      .select({
        permissionKey: userPermissions.permissionKey,
        effect: userPermissions.effect,
      })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId)),
  ]);
  return computeEffectivePermissions(roleSlug, allPerms, overrides);
}

export function userHasAnyPermission(user: AuthenticatedDbUser | undefined, keys: string[]): boolean {
  if (!user) return false;
  if (user.roleSlug === 'super_admin') return true;
  return keys.some((k) => user.permissions.includes(k));
}

export async function resolveAuthFromHeaderOrCookie(
  authHeader?: string,
  cookieHeader?: string
): Promise<{ user: AuthenticatedDbUser; sessionId?: number } | null> {
  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(cookieHeader);
    if (cookies.gtu_session) {
      token = cookies.gtu_session;
    }
  }

  if (!token) return null;

  // 1. Check server-signed GTU session token
  if (token.startsWith('gtu_')) {
    const verified = verifySignedSessionToken(token);
    if (!verified) return null;
    const tokenHash = hashSessionToken(token);
    const now = new Date();
    const sessionRows = await db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.tokenHash, tokenHash),
          eq(userSessions.userId, verified.userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now)
        )
      )
      .limit(1);

    if (sessionRows.length === 0) return null;

    const userRows = await db
      .select({
        id: users.id,
        uid: users.uid,
        username: users.username,
        email: users.email,
        nationalMemberNumber: users.nationalMemberNumber,
        roleId: users.roleId,
        roleSlug: users.roleSlug,
        assignedWilayaCode: users.assignedWilayaCode,
        isActive: users.isActive,
        roleLevel: roles.level,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, verified.userId))
      .limit(1);

    if (userRows.length === 0 || !userRows[0].isActive) return null;
    const u = userRows[0];
    const effectivePerms = await loadEffectivePermissionsForUser(u.id, u.roleSlug);
    return {
      user: {
        id: u.id,
        uid: u.uid,
        username: u.username,
        email: u.email || '',
        nationalMemberNumber: u.nationalMemberNumber,
        roleId: u.roleId,
        roleSlug: u.roleSlug,
        roleLevel: u.roleLevel,
        assignedWilayaCode: u.assignedWilayaCode || '',
        isActive: u.isActive,
        permissions: effectivePerms,
      },
      sessionId: sessionRows[0].id,
    };
  }

  // 2. Check Firebase Auth ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const existing = await db
      .select({
        id: users.id,
        uid: users.uid,
        username: users.username,
        email: users.email,
        nationalMemberNumber: users.nationalMemberNumber,
        roleId: users.roleId,
        roleSlug: users.roleSlug,
        assignedWilayaCode: users.assignedWilayaCode,
        isActive: users.isActive,
        roleLevel: roles.level,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.uid, decoded.uid))
      .limit(1);

    if (existing.length > 0) {
      const u = existing[0];
      if (!u.isActive) return null;
      const effectivePerms = await loadEffectivePermissionsForUser(u.id, u.roleSlug);
      return {
        user: {
          id: u.id,
          uid: u.uid,
          username: u.username,
          email: u.email || '',
          nationalMemberNumber: u.nationalMemberNumber,
          roleId: u.roleId,
          roleSlug: u.roleSlug,
          roleLevel: u.roleLevel,
          assignedWilayaCode: u.assignedWilayaCode || '',
          isActive: u.isActive,
          permissions: effectivePerms,
        },
      };
    }

    // First-time Google user: upsert into users safely
    const allUsers = await db.select({ id: users.id }).from(users).limit(1);
    const isFirstUser = allUsers.length === 0;
    const targetRoleSlug = isFirstUser ? 'super_admin' : 'member';
    const [roleRow] = await db
      .select()
      .from(roles)
      .where(eq(roles.slug, targetRoleSlug))
      .limit(1);

    const safeBase = (decoded.email?.split('@')[0] || `gtu_${decoded.uid.slice(0, 8)}`)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 20);
    const uniqueUsername = `${safeBase}_${decoded.uid.slice(0, 4).toLowerCase()}`;
    const year = new Date().getFullYear();
    const memberNo = generateNationalMemberNumber(year, Math.floor(100000 + Math.random() * 899999));

    const [inserted] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        username: uniqueUsername,
        email: decoded.email || '',
        nationalMemberNumber: memberNo,
        roleId: roleRow.id,
        roleSlug: roleRow.slug,
        isActive: true,
        acceptedTerms: true,
        acceptedTermsAt: new Date(),
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email: decoded.email || '', lastLoginAt: new Date() },
      })
      .returning();

    const effectivePerms = await loadEffectivePermissionsForUser(inserted.id, inserted.roleSlug);
    return {
      user: {
        id: inserted.id,
        uid: inserted.uid,
        username: inserted.username,
        email: inserted.email || '',
        nationalMemberNumber: inserted.nationalMemberNumber,
        roleId: inserted.roleId,
        roleSlug: inserted.roleSlug,
        roleLevel: roleRow.level,
        assignedWilayaCode: inserted.assignedWilayaCode || '',
        isActive: inserted.isActive,
        permissions: effectivePerms,
      },
    };
  } catch {
    return null;
  }
}

export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const resolved = await resolveAuthFromHeaderOrCookie(
      req.headers.authorization,
      req.headers.cookie
    );
    if (resolved) {
      req.dbUser = resolved.user;
      req.sessionId = resolved.sessionId;
    }
  } catch (err) {
    console.error('optionalAuth error:', err);
  }
  next();
};

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const resolved = await resolveAuthFromHeaderOrCookie(
      req.headers.authorization,
      req.headers.cookie
    );
    if (!resolved) {
      return res.status(401).json({ error: 'يرجى تسجيل الدخول للوصول إلى هذه الخدمة.' });
    }
    req.dbUser = resolved.user;
    req.sessionId = resolved.sessionId;
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    return res.status(401).json({ error: 'جلسة غير صالحة أو منتهية الصلاحية.' });
  }
};

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.dbUser) {
      return res.status(401).json({ error: 'مطلوب تسجيل الدخول.' });
    }
    if (!allowedRoles.includes(req.dbUser.roleSlug)) {
      return res.status(403).json({ error: 'ليس لديك الصلاحية اللازمة لتنفيذ هذا الإجراء.' });
    }
    next();
  };
};

export const requirePermission = (...requiredKeys: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.dbUser) {
      return res.status(401).json({ error: 'مطلوب تسجيل الدخول.' });
    }
    if (!userHasAnyPermission(req.dbUser, requiredKeys)) {
      return res.status(403).json({
        error: 'ليس لديك الصلاحية المطلوبة لتنفيذ هذا الإجراء في لوحة الإدارة.',
      });
    }
    next();
  };
};

export async function writeAuditLog(params: {
  actorId?: number | null;
  action: string;
  entityType: string;
  entityId?: string | number;
  details?: string;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      actorId: params.actorId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId !== undefined ? String(params.entityId) : '',
      details: params.details || '',
      ipAddress: params.ipAddress || '',
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}
