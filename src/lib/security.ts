import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import firebaseConfig from '../../firebase-applet-config.json';

const SECRET_SEED =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(`gtu-algeria:${firebaseConfig.projectId}:${firebaseConfig.apiKey}`)
    .digest('hex');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function generateSignedSessionToken(userId: number, uid: string): {
  token: string;
  tokenHash: string;
} {
  const nonce = crypto.randomBytes(24).toString('hex');
  const payload = `${userId}.${uid}.${nonce}`;
  const sig = crypto.createHmac('sha256', SECRET_SEED).update(payload).digest('hex');
  const token = `gtu_${payload}.${sig}`;
  const tokenHash = hashSessionToken(token);
  return { token, tokenHash };
}

export function verifySignedSessionToken(token: string): { userId: number; uid: string } | null {
  if (!token || !token.startsWith('gtu_')) return null;
  const raw = token.slice(4);
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [userIdStr, uid, nonce, sig] = parts;
  if (!/^[0-9a-f]{64}$/i.test(sig)) return null;
  const payload = `${userIdStr}.${uid}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', SECRET_SEED).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  const userId = Number(userIdStr);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return { userId, uid };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateNationalMemberNumber(year: number, seqId: number): string {
  const padded = String(seqId).padStart(6, '0');
  const suffix = crypto.randomBytes(1).toString('hex').toUpperCase();
  return `GTU-${year}-${padded}${suffix}`;
}

export function sanitizeText(value: unknown, maxLen = 2000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>]/g, '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLen);
}

export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .trim();
}

// Simple rate limiter for auth endpoints
const attemptsMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxAttempts = 15, windowMs = 15 * 60 * 1000): {
  allowed: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  const entry = attemptsMap.get(key);
  if (!entry || entry.resetAt <= now) {
    attemptsMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= maxAttempts) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    cookies[k] = decodeURIComponent(v);
  }
  return cookies;
}

const ALLOWED_UPLOAD_MIMES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

export function saveBase64Upload(
  dataUrl: string,
  originalName?: string
): { url: string; fileName: string; mimeType: string } | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const ext = ALLOWED_UPLOAD_MIMES.get(mimeType);
  if (!ext) {
    throw new Error('نوع الملف غير مدعوم. الأنواع المسموحة: JPG, PNG, WebP, PDF');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength > 2 * 1024 * 1024) {
    throw new Error('حجم الملف يتجاوز الحد الأقصى المسموح به (2 ميغابايت)');
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const safeId = crypto.randomUUID();
  const filename = `${safeId}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return {
    url: `/api/uploads/${filename}`,
    fileName: sanitizeText(originalName || `attachment${ext}`, 120) || `attachment${ext}`,
    mimeType,
  };
}
