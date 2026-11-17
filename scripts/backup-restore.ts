import 'dotenv/config';
import fs from 'node:fs';
import { db } from '../src/db/index.ts';
import {
  announcements,
  events,
  graduationRecords,
  institutions,
  permissions,
  platformSettings,
  profiles,
  proposals,
  roles,
  users,
} from '../src/db/schema.ts';

async function main() {
  const mode = process.argv[2] || 'backup';
  const filePath = process.argv[3] || `gtu-backup-${new Date().toISOString().slice(0, 10)}.json`;

  if (mode === 'backup') {
    const payload = {
      exportedAt: new Date().toISOString(),
      platform: 'GTU-Algeria',
      data: {
        roles: await db.select().from(roles),
        permissions: await db.select().from(permissions),
        institutions: await db.select().from(institutions),
        platformSettings: await db.select().from(platformSettings),
        users: await db.select({
          id: users.id,
          uid: users.uid,
          username: users.username,
          email: users.email,
          nationalMemberNumber: users.nationalMemberNumber,
          roleSlug: users.roleSlug,
          isActive: users.isActive,
          createdAt: users.createdAt,
        }).from(users),
        profiles: await db.select().from(profiles),
        graduationRecords: await db.select().from(graduationRecords),
        proposals: await db.select().from(proposals),
        events: await db.select().from(events),
        announcements: await db.select().from(announcements),
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    console.log(`Backup written to ${filePath}`);
  } else if (mode === 'restore') {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(raw?.data?.platformSettings)) {
      for (const s of raw.data.platformSettings) {
        await db
          .insert(platformSettings)
          .values({ key: s.key, value: String(s.value), category: s.category || 'general' })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: { value: String(s.value), updatedAt: new Date() },
          });
      }
    }
    console.log(`Restore completed from ${filePath}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
