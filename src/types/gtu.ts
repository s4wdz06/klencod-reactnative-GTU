export type RoleSlug = 'super_admin' | 'admin' | 'wilaya_rep' | 'member' | (string & {});

export function hasUserPermission(
  user: { roleSlug?: string; permissions?: string[] } | null | undefined,
  ...keys: string[]
): boolean {
  if (!user) return false;
  if (user.roleSlug === 'super_admin') return true;
  const perms = user.permissions || [];
  return keys.some((k) => perms.includes(k));
}

export interface Wilaya {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  region: string;
  isActive: boolean;
  membersCount?: number;
  communesRepresented?: number;
  communesTotal?: number;
  percentage?: number;
}

export interface Commune {
  id: number;
  officialId?: number;
  wilayaId: number;
  wilayaCode: string;
  dairaAr: string;
  nameAr: string;
  nameEn: string;
  membersCount?: number;
}

export interface Institution {
  id: number;
  nameAr: string;
  type: string;
  wilayaId?: number | null;
  isActive: boolean;
}

export interface UserProfile {
  id: number;
  userId: number;
  firstName: string;
  lastName: string;
  birthDate: string;
  birthPlace: string;
  birthWilayaId: number | null;
  birthCommuneId: number | null;
  phone: string;
  residenceWilayaId: number | null;
  residenceCommuneId: number | null;
  avatarUrl: string;
  bio: string;
  skills: string;
  experience: string;
  privacyShowPhone: boolean;
  privacyShowBirthDate: boolean;
  privacyShowEmail: boolean;
  privacyAllowDm: boolean;
  notifyMessages: boolean;
  notifyAnnouncements: boolean;
  notifyEvents: boolean;
  notifyProposals: boolean;
}

export interface GraduationRecord {
  id: number;
  userId: number;
  specialty: string;
  graduationYear: number;
  institutionId: number | null;
  institutionName: string;
  degreeLevel: string;
  extraInfo: string;
}

export interface CurrentUser {
  id: number;
  uid: string;
  username: string;
  email: string;
  nationalMemberNumber: string;
  roleSlug: RoleSlug;
  roleNameAr: string;
  roleLevel: number;
  assignedWilayaCode: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  profile: UserProfile | null;
  graduation: GraduationRecord | null;
  residenceWilaya: Wilaya | null;
  residenceCommune: Commune | null;
  unreadNotifications: number;
  permissions: string[];
  needsProfileCompletion: boolean;
}

export interface GraduateCard {
  userId: number;
  username: string;
  nationalMemberNumber: string;
  roleSlug: RoleSlug;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string;
  bio: string;
  skills: string;
  wilayaCode: string;
  wilayaName: string;
  communeId: number | null;
  communeName: string;
  specialty: string;
  graduationYear: number | null;
  institutionName: string;
  privacyAllowDm: boolean;
  createdAt: string;
  phone: string | null;
  birthDate: string | null;
  email: string | null;
}

export interface DashboardStats {
  kpis: {
    totalGraduates: number;
    representedWilayas: number;
    representedCommunes: number;
    activeMembers: number;
    newMembers: number;
    proposalsCount: number;
    initiativesCount: number;
    eventsCount: number;
    messagesCount: number;
  };
  byWilaya: Array<{ code: string; nameAr: string; count: number; percentage: number }>;
  byGraduationYear: Array<{ year: number; count: number }>;
  topGraduationYears: Array<{ year: number; count: number }>;
  growth: {
    daily: Array<{ label: string; value: number }>;
    monthly: Array<{ label: string; value: number }>;
    yearly: Array<{ label: string; value: number }>;
  };
}

export interface ConversationItem {
  id: number;
  type: 'national' | 'wilaya_group' | 'direct' | 'official_channel';
  title: string;
  groupId: number | null;
  wilayaId?: number | null;
  slug?: string;
  isMember: boolean;
  otherUserId?: number | null;
  otherAvatar?: string;
  isOnline?: boolean;
  unreadCount?: number;
  memberCount?: number;
  onlineCount?: number;
  lastMessagePreview?: string;
  lastMessageSender?: string;
  lastMessageAt: string;
}

export interface MessageReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface ReplyPreview {
  id: number;
  senderName: string;
  content: string;
  attachmentName?: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number;
  replyToId?: number | null;
  replyTo?: ReplyPreview | null;
  content: string;
  attachmentUrl: string;
  attachmentName: string;
  attachmentType: string;
  isOfficial: boolean;
  isPinned?: boolean;
  editedAt?: string | null;
  createdAt: string;
  senderName: string;
  senderAvatar: string;
  senderRole: RoleSlug;
  senderMemberNo: string;
  reactions?: MessageReactionSummary[];
  clientTempId?: string;
  pending?: boolean;
}

export interface ProposalItem {
  id: number;
  authorId: number;
  authorName: string;
  title: string;
  description: string;
  category: string;
  kind: 'proposal' | 'initiative';
  wilayaId: number | null;
  wilayaName: string | null;
  wilayaCode: string | null;
  status: string;
  adminResponse: string;
  rejectionReason: string;
  supportersCount: number;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    id: number;
    previousStatus: string;
    newStatus: string;
    note: string;
    createdAt: string;
  }>;
}

export interface EventItem {
  id: number;
  title: string;
  description: string;
  eventType: string;
  eventDate: string;
  location: string;
  meetingUrl: string;
  wilayaId: number | null;
  wilayaName: string | null;
  wilayaCode: string | null;
  organizerName: string;
  maxSeats: number | null;
  registrationUrl: string;
  attendingCount: number;
  declinedCount: number;
  myStatus: 'attending' | 'declined' | null;
  attendeesPreview: Array<{ userId: number; name: string }>;
}

export interface AnnouncementItem {
  id: number;
  title: string;
  content: string;
  scope: 'national' | 'wilaya';
  targetWilayaId: number | null;
  wilayaName: string | null;
  wilayaCode: string | null;
  isPinned: boolean;
  attachmentUrl: string;
  publishedAt: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

export interface RoleDefinition {
  id: number;
  slug: string;
  nameAr: string;
  description: string;
  level: number;
  isSystem: boolean;
  usersCount?: number;
}

export interface PermissionDefinitionItem {
  id: number;
  key: string;
  nameAr: string;
  category: string;
  description: string;
  allowedRoles: string;
  isSystem: boolean;
}

export interface UserPermissionOverrideItem {
  id: number;
  userId: number;
  permissionKey: string;
  effect: 'allow' | 'deny';
  note: string;
  updatedAt: string;
}

export interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  nationalMemberNumber: string;
  roleId: number;
  roleSlug: string;
  roleNameAr: string;
  assignedWilayaCode: string;
  isActive: boolean;
  hasPassword?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  firstName: string | null;
  lastName: string | null;
  phone?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
  birthWilayaCode?: string | null;
  birthWilayaName?: string | null;
  birthCommuneName?: string | null;
  wilayaCode?: string | null;
  wilayaName: string | null;
  communeName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  skills?: string | null;
  experience?: string | null;
  specialty?: string | null;
  graduationYear?: number | null;
  institutionName?: string | null;
  degreeLevel?: string | null;
  extraInfo?: string | null;
  privacyShowPhone?: boolean;
  privacyShowBirthDate?: boolean;
  privacyShowEmail?: boolean;
  privacyAllowDm?: boolean;
  overridesCount: number;
  activeSessionsCount: number;
}

export interface AdminOverviewData {
  kpis: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    activeSessionsCount: number;
    pendingReportsCount: number;
    pendingProposalsCount: number;
    totalRolesCount: number;
    totalPermissionsCount: number;
    totalOverridesCount: number;
  };
  usersByRole: Array<{ roleSlug: string; nameAr: string; count: number }>;
  recentAuditLogs: Array<{
    id: number;
    action: string;
    entityType: string;
    details: string;
    createdAt: string;
    actorUsername: string | null;
  }>;
}

export interface UserSessionRow {
  id: number;
  deviceInfo: string;
  ipAddress: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
