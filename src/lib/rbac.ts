export interface PermissionDefinition {
  key: string;
  allowedRoles: string;
}

export interface UserPermissionOverride {
  permissionKey: string;
  effect: string; // 'allow' | 'deny'
}

export function parseAllowedRoles(allowedRolesJson: string): string[] {
  try {
    const parsed = JSON.parse(allowedRolesJson);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

export function computeEffectivePermissions(
  roleSlug: string,
  allPermissions: PermissionDefinition[],
  userOverrides: UserPermissionOverride[] = []
): string[] {
  // super_admin retains master governance over all defined permissions
  if (roleSlug === 'super_admin') {
    return Array.from(new Set(allPermissions.map((p) => p.key)));
  }

  const effective = new Set<string>();
  for (const perm of allPermissions) {
    const roles = parseAllowedRoles(perm.allowedRoles);
    if (roles.includes(roleSlug)) {
      effective.add(perm.key);
    }
  }

  for (const ov of userOverrides) {
    if (ov.effect === 'allow') {
      effective.add(ov.permissionKey);
    } else if (ov.effect === 'deny') {
      effective.delete(ov.permissionKey);
    }
  }

  return Array.from(effective);
}
