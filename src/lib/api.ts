import * as XLSX from 'xlsx';

let authTokenMemory: string | null = null;

export function setAuthToken(token: string | null) {
  authTokenMemory = token;
}

export function getAuthToken(): string | null {
  return authTokenMemory;
}

export async function apiRequest<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (authTokenMemory) {
    headers.Authorization = `Bearer ${authTokenMemory}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || 'استجابة غير متوقعة من الخادم' };
  }

  if (!res.ok) {
    throw new Error(data.error || `خطأ في الاتصال (${res.status})`);
  }

  return data as T;
}

// Offline Drafts & Action Queue (synced cleanly when back online)
const OFFLINE_QUEUE_KEY = 'gtu_offline_action_queue';
const DRAFTS_KEY = 'gtu_saved_drafts';

export interface QueuedOfflineAction {
  id: string;
  type: 'message' | 'proposal';
  url: string;
  payload: Record<string, unknown>;
  createdAt: string;
  label: string;
}

export function getOfflineQueue(): QueuedOfflineAction[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineAction(action: Omit<QueuedOfflineAction, 'id' | 'createdAt'>): QueuedOfflineAction {
  const queue = getOfflineQueue();
  const item: QueuedOfflineAction = {
    ...action,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  queue.push(item);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  return item;
}

export async function flushOfflineQueue(): Promise<{ synced: number; failed: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const remaining: QueuedOfflineAction[] = [];
  let synced = 0;

  for (const item of queue) {
    try {
      await apiRequest(item.url, {
        method: 'POST',
        body: JSON.stringify(item.payload),
      });
      synced += 1;
    } catch {
      remaining.push(item);
    }
  }

  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  return { synced, failed: remaining.length };
}

export function saveDraft(key: string, value: unknown) {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = value;
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return (map[key] as T) ?? null;
  } catch {
    return null;
  }
}

// Export helpers (XLSX, multi-sheet XLSX, CSV with UTF-8 BOM for Arabic Excel, JSON, ZIP)
export function exportToXlsx(filename: string, sheetName: string, rows: Array<Record<string, unknown>>) {
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ ملاحظة: 'لا توجد بيانات' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function buildXlsxBytes(sheetName: string, rows: Array<Record<string, unknown>>): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ ملاحظة: 'لا توجد بيانات' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

export function exportMultiSheetXlsx(
  filename: string,
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>> }>
) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    let cleanName = sheet.name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Sheet';
    let suffix = 1;
    while (usedNames.has(cleanName)) {
      const s = `_${suffix++}`;
      cleanName = cleanName.slice(0, 31 - s.length) + s;
    }
    usedNames.add(cleanName);
    const ws = XLSX.utils.json_to_sheet(
      sheet.rows.length > 0 ? sheet.rows : [{ ملاحظة: 'لا توجد بيانات' }]
    );
    XLSX.utils.book_append_sheet(wb, ws, cleanName);
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const val = String(r[h] ?? '').replace(/"/g, '""');
          return `"${val}"`;
        })
        .join(',')
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportToJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Pure-TS PKZIP builder (STORE method, UTF-8 filename flag 0x0800)
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function exportFilesAsZip(
  zipFilename: string,
  files: Array<{ name: string; data: Uint8Array }>
) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const allParts = [...localParts, ...centralParts, eocd];
  const totalBytes = allParts.reduce((s, p) => s + p.length, 0);
  const archive = new Uint8Array(totalBytes);
  let pos = 0;
  for (const part of allParts) {
    archive.set(part, pos);
    pos += part.length;
  }

  const blob = new Blob([archive.buffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${zipFilename}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
