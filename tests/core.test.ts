import assert from 'node:assert/strict';
import algeriaGeo from '../src/data/algeria-wilayas-communes.json' with { type: 'json' };
import {
  generateNationalMemberNumber,
  generateSignedSessionToken,
  hashPassword,
  normalizeArabic,
  verifyPassword,
  verifySignedSessionToken,
} from '../src/lib/security.ts';
import { computeEffectivePermissions, parseAllowedRoles } from '../src/lib/rbac.ts';

function runTests() {
  // 1. Official Algeria 58 Wilayas & 1541 Communes integrity
  assert.equal(algeriaGeo.wilayas.length, 58, 'Must contain exactly 58 official Algerian wilayas');
  assert.equal(algeriaGeo.communes.length, 1541, 'Must contain exactly 1541 official Algerian communes');

  const wilayaCodes = new Set(algeriaGeo.wilayas.map((w) => w.code));
  assert.equal(wilayaCodes.size, 58, 'All 58 wilaya codes must be unique');

  // Verify no duplicate (wilayaCode, nameAr) and all communes belong to valid wilaya
  const communeKeys = new Set<string>();
  for (const c of algeriaGeo.communes) {
    assert.ok(wilayaCodes.has(c.wilayaCode), `Commune ${c.nameAr} references valid wilaya ${c.wilayaCode}`);
    const key = `${c.wilayaCode}::${c.nameAr}`;
    assert.ok(!communeKeys.has(key), `Duplicate commune detected: ${key}`);
    communeKeys.add(key);
  }

  // Verify Laghouat (03) has 24 official communes
  const laghouatCommunes = algeriaGeo.communes.filter((c) => c.wilayaCode === '03');
  assert.equal(laghouatCommunes.length, 24, 'Laghouat (03) must have 24 communes');

  // 2. Password scrypt hashing & timing-safe verification
  const hash = hashPassword('GTU_StrongPass2026');
  assert.ok(hash.startsWith('scrypt$'), 'Password hash must use scrypt prefix');
  assert.ok(!hash.includes('GTU_StrongPass2026'), 'Password must never be stored in plaintext');
  assert.equal(verifyPassword('GTU_StrongPass2026', hash), true, 'Valid password must verify');
  assert.equal(verifyPassword('WrongPassword', hash), false, 'Invalid password must fail');

  // 3. Signed session tokens
  const { token } = generateSignedSessionToken(42, 'uid_test_42');
  const parsed = verifySignedSessionToken(token);
  assert.deepEqual(parsed, { userId: 42, uid: 'uid_test_42' });
  assert.equal(verifySignedSessionToken(token + 'tampered'), null, 'Tampered token must be rejected');

  // 4. National member number format
  const memberNo = generateNationalMemberNumber(2026, 7);
  assert.match(memberNo, /^GTU-2026-000007[0-9A-F]{2}$/);

  // 5. Arabic normalization for unified search
  assert.equal(normalizeArabic('الأغواط'), normalizeArabic('الاغواط'));
  assert.equal(normalizeArabic('مدرسة تقنية'), normalizeArabic('مدرسه تقنيه'));

  // 6. RBAC resolution, custom roles, per-user allow/deny overrides & super_admin safeguard
  assert.deepEqual(parseAllowedRoles('["admin","wilaya_rep"]'), ['admin', 'wilaya_rep']);
  assert.deepEqual(parseAllowedRoles('invalid-json'), []);

  const samplePermissions = [
    { key: 'view_admin_panel', allowedRoles: '["super_admin","admin","wilaya_rep"]' },
    { key: 'manage_users', allowedRoles: '["super_admin","admin"]' },
    { key: 'manage_roles', allowedRoles: '["super_admin"]' },
    { key: 'publish_announcements', allowedRoles: '["super_admin","admin","wilaya_rep","regional_coord"]' },
  ];

  // Role inheritance without overrides
  const memberPerms = computeEffectivePermissions('member', samplePermissions);
  assert.deepEqual(memberPerms, []);

  const adminPerms = computeEffectivePermissions('admin', samplePermissions);
  assert.deepEqual(adminPerms.sort(), ['manage_users', 'publish_announcements', 'view_admin_panel']);

  const customRolePerms = computeEffectivePermissions('regional_coord', samplePermissions);
  assert.deepEqual(customRolePerms, ['publish_announcements']);

  // Per-user allow & deny overrides
  const overriddenMember = computeEffectivePermissions('member', samplePermissions, [
    { permissionKey: 'view_admin_panel', effect: 'allow' },
    { permissionKey: 'publish_announcements', effect: 'allow' },
  ]);
  assert.deepEqual(overriddenMember.sort(), ['publish_announcements', 'view_admin_panel']);

  const restrictedAdmin = computeEffectivePermissions('admin', samplePermissions, [
    { permissionKey: 'manage_users', effect: 'deny' },
    { permissionKey: 'manage_roles', effect: 'allow' },
  ]);
  assert.deepEqual(restrictedAdmin.sort(), ['manage_roles', 'publish_announcements', 'view_admin_panel']);

  // super_admin always retains all defined permissions regardless of allowedRoles or deny overrides
  const superAdminPerms = computeEffectivePermissions(
    'super_admin',
    [{ key: 'manage_roles', allowedRoles: '[]' }, ...samplePermissions],
    [{ permissionKey: 'manage_roles', effect: 'deny' }]
  );
  assert.deepEqual(
    superAdminPerms.sort(),
    ['manage_roles', 'manage_users', 'publish_announcements', 'view_admin_panel']
  );

  console.log('All GTU core & RBAC tests passed (58 wilayas, 1541 communes, scrypt auth, sessions, Arabic search, RBAC).');
}

runTests();
