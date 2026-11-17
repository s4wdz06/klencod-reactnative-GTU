import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. roles
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(), // 'super_admin' | 'admin' | 'wilaya_rep' | 'member' | custom roles
  nameAr: text('name_ar').notNull(),
  description: text('description').default(''),
  level: integer('level').notNull().default(1), // 100 super_admin, 70 admin, 40 wilaya_rep, 10 member
  isSystem: boolean('is_system').notNull().default(false),
});

// 2. permissions
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  category: text('category').notNull(),
  description: text('description').default(''),
  allowedRoles: text('allowed_roles').notNull().default('["super_admin"]'), // JSON array of role slugs
  isSystem: boolean('is_system').notNull().default(false),
});

// 2b. user_permissions (per-user granular allow/deny overrides)
export const userPermissions = pgTable(
  'user_permissions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    permissionKey: text('permission_key').notNull(),
    effect: text('effect').notNull().default('allow'), // 'allow' | 'deny'
    note: text('note').default(''),
    grantedBy: integer('granted_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_permissions_user_key_idx').on(table.userId, table.permissionKey),
    index('user_permissions_user_idx').on(table.userId),
  ]
);

// 3. wilayas (58 official Algerian wilayas)
export const wilayas = pgTable('wilayas', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // '01'..'58'
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  region: text('region').notNull().default('الشمال'), // الشمال | الهضاب العليا | الجنوب
  isActive: boolean('is_active').notNull().default(true),
});

// 4. communes (1541 official Algerian communes)
export const communes = pgTable(
  'communes',
  {
    id: serial('id').primaryKey(),
    officialId: integer('official_id'),
    wilayaId: integer('wilaya_id')
      .references(() => wilayas.id, { onDelete: 'cascade' })
      .notNull(),
    wilayaCode: text('wilaya_code').notNull(),
    dairaAr: text('daira_ar').default(''),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
  },
  (table) => [
    uniqueIndex('communes_wilaya_name_idx').on(table.wilayaId, table.nameAr),
    index('communes_wilaya_code_idx').on(table.wilayaCode),
  ]
);

// 5. institutions
export const institutions = pgTable('institutions', {
  id: serial('id').primaryKey(),
  nameAr: text('name_ar').notNull().unique(),
  type: text('type').notNull().default('جامعة / معهد'),
  wilayaId: integer('wilaya_id').references(() => wilayas.id),
  isActive: boolean('is_active').notNull().default(true),
});

// 6. users
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(), // Firebase Auth UID or internal UUID for credential users
    username: text('username').notNull().unique(),
    email: text('email').default(''),
    passwordHash: text('password_hash').default(''), // scrypt salt:hash
    nationalMemberNumber: text('national_member_number').notNull().unique(), // GTU-YYYY-XXXXXX
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    roleSlug: text('role_slug').notNull().default('member'),
    assignedWilayaCode: text('assigned_wilaya_code').default(''),
    isActive: boolean('is_active').notNull().default(true),
    acceptedTerms: boolean('accepted_terms').notNull().default(false),
    acceptedTermsAt: timestamp('accepted_terms_at'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('users_role_slug_idx').on(table.roleSlug),
    index('users_created_at_idx').on(table.createdAt),
  ]
);

// 7. profiles
export const profiles = pgTable(
  'profiles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    birthDate: text('birth_date').default(''), // YYYY-MM-DD (private by default)
    birthPlace: text('birth_place').default(''),
    birthWilayaId: integer('birth_wilaya_id').references(() => wilayas.id),
    birthCommuneId: integer('birth_commune_id').references(() => communes.id),
    phone: text('phone').default(''), // private by default
    residenceWilayaId: integer('residence_wilaya_id').references(() => wilayas.id),
    residenceCommuneId: integer('residence_commune_id').references(() => communes.id),
    avatarUrl: text('avatar_url').default(''),
    bio: text('bio').default(''),
    skills: text('skills').default(''),
    experience: text('experience').default(''),
    privacyShowPhone: boolean('privacy_show_phone').notNull().default(false),
    privacyShowBirthDate: boolean('privacy_show_birth_date').notNull().default(false),
    privacyShowEmail: boolean('privacy_show_email').notNull().default(false),
    privacyAllowDm: boolean('privacy_allow_dm').notNull().default(true),
    notifyMessages: boolean('notify_messages').notNull().default(true),
    notifyAnnouncements: boolean('notify_announcements').notNull().default(true),
    notifyEvents: boolean('notify_events').notNull().default(true),
    notifyProposals: boolean('notify_proposals').notNull().default(true),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('profiles_res_wilaya_idx').on(table.residenceWilayaId),
    index('profiles_res_commune_idx').on(table.residenceCommuneId),
  ]
);

// 8. graduation_records
export const graduationRecords = pgTable(
  'graduation_records',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    specialty: text('specialty').notNull().default('تقنيات حضرية'),
    graduationYear: integer('graduation_year').notNull(),
    institutionId: integer('institution_id').references(() => institutions.id),
    institutionName: text('institution_name').notNull().default(''),
    degreeLevel: text('degree_level').default('ليسانس / ماستر / مهندس'),
    extraInfo: text('extra_info').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('grad_year_idx').on(table.graduationYear)]
);

// 9. groups
export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  description: text('description').default(''),
  wilayaId: integer('wilaya_id').references(() => wilayas.id),
  isNational: boolean('is_national').notNull().default(false),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 10. group_members
export const groupMembers = pgTable(
  'group_members',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roleInGroup: text('role_in_group').notNull().default('member'),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('group_members_unique_idx').on(table.groupId, table.userId)]
);

// 11. conversations
export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'national' | 'wilaya_group' | 'direct' | 'official_channel'
  title: text('title').notNull(),
  groupId: integer('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  participantOneId: integer('participant_one_id').references(() => users.id, { onDelete: 'cascade' }),
  participantTwoId: integer('participant_two_id').references(() => users.id, { onDelete: 'cascade' }),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 12. messages
export const messages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    senderId: integer('sender_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    replyToId: integer('reply_to_id'),
    content: text('content').notNull(),
    attachmentUrl: text('attachment_url').default(''),
    attachmentName: text('attachment_name').default(''),
    attachmentType: text('attachment_type').default(''),
    isOfficial: boolean('is_official').notNull().default(false),
    isPinned: boolean('is_pinned').notNull().default(false),
    isDeleted: boolean('is_deleted').notNull().default(false),
    editedAt: timestamp('edited_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('messages_conv_created_idx').on(table.conversationId, table.createdAt),
    index('messages_conv_deleted_id_idx').on(table.conversationId, table.isDeleted, table.id),
  ]
);

// 12b. message_reactions (emoji reactions on messages)
export const messageReactions = pgTable(
  'message_reactions',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('message_reactions_unique_idx').on(table.messageId, table.userId, table.emoji),
    index('message_reactions_msg_idx').on(table.messageId),
  ]
);

// 12c. conversation_reads (unread tracking & read receipts per conversation)
export const conversationReads = pgTable(
  'conversation_reads',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    lastReadMessageId: integer('last_read_message_id').notNull().default(0),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('conversation_reads_unique_idx').on(table.conversationId, table.userId)]
);

// 13. proposals (and initiatives)
export const proposals = pgTable(
  'proposals',
  {
    id: serial('id').primaryKey(),
    authorId: integer('author_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull().default('اقتراح تطويري'), // 'اقتراح تطويري' | 'مبادرة مهنية' | 'مبادرة اجتماعية' | 'تنظيمية'
    kind: text('kind').notNull().default('proposal'), // 'proposal' | 'initiative'
    wilayaId: integer('wilaya_id').references(() => wilayas.id),
    status: text('status').notNull().default('جديد'), // 'جديد' | 'قيد الدراسة' | 'مقبول' | 'قيد التنفيذ' | 'تم التنفيذ' | 'مرفوض'
    assignedToId: integer('assigned_to_id').references(() => users.id),
    adminResponse: text('admin_response').default(''),
    rejectionReason: text('rejection_reason').default(''),
    supportersCount: integer('supporters_count').notNull().default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('proposals_status_idx').on(table.status)]
);

// 14. proposal_updates
export const proposalUpdates = pgTable('proposal_updates', {
  id: serial('id').primaryKey(),
  proposalId: integer('proposal_id')
    .references(() => proposals.id, { onDelete: 'cascade' })
    .notNull(),
  actorId: integer('actor_id').references(() => users.id),
  previousStatus: text('previous_status').default(''),
  newStatus: text('new_status').notNull(),
  note: text('note').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 15. events
export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    eventType: text('event_type').notNull(), // 'لقاء وطني' | 'اجتماع ولائي' | 'لقاء مهني' | 'ملتقى خريجين' | 'يوم دراسي' | 'مبادرة اجتماعية' | 'لقاء لم الشمل'
    eventDate: timestamp('event_date').notNull(),
    location: text('location').default(''),
    meetingUrl: text('meeting_url').default(''),
    wilayaId: integer('wilaya_id').references(() => wilayas.id),
    organizerName: text('organizer_name').notNull().default('إدارة المنصة الوطنية GTU'),
    maxSeats: integer('max_seats'),
    registrationUrl: text('registration_url').default(''),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('events_date_idx').on(table.eventDate)]
);

// 16. event_attendees
export const eventAttendees = pgTable(
  'event_attendees',
  {
    id: serial('id').primaryKey(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').notNull().default('attending'), // 'attending' | 'declined'
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('event_attendees_unique_idx').on(table.eventId, table.userId)]
);

// 17. announcements
export const announcements = pgTable(
  'announcements',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    scope: text('scope').notNull().default('national'), // 'national' | 'wilaya'
    targetWilayaId: integer('target_wilaya_id').references(() => wilayas.id),
    isPinned: boolean('is_pinned').notNull().default(false),
    attachmentUrl: text('attachment_url').default(''),
    publishedAt: timestamp('published_at').defaultNow().notNull(),
    authorId: integer('author_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('announcements_pinned_date_idx').on(table.isPinned, table.publishedAt)]
);

// 18. notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(), // 'message' | 'announcement' | 'proposal' | 'event' | 'account' | 'admin'
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link').default(''),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_user_read_idx').on(table.userId, table.isRead)]
);

// 19. reports (moderation & abuse reports)
export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  reporterId: integer('reporter_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  targetType: text('target_type').notNull(), // 'message' | 'user' | 'proposal'
  targetId: integer('target_id').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'reviewed' | 'resolved' | 'dismissed'
  reviewedBy: integer('reviewed_by').references(() => users.id),
  resolutionNote: text('resolution_note').default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 20. audit_logs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorId: integer('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').default(''),
    details: text('details').default(''),
    ipAddress: text('ip_address').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_created_idx').on(table.createdAt)]
);

// 21. platform_settings (dynamic platform config without code edits)
export const platformSettings = pgTable('platform_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  category: text('category').notNull().default('general'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 22. user_sessions (active session management & password recovery tokens)
export const userSessions = pgTable('user_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  deviceInfo: text('device_info').default('متصفح ويب'),
  ipAddress: text('ip_address').default(''),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 23. blocked_users (privacy block list for direct messaging)
export const blockedUsers = pgTable(
  'blocked_users',
  {
    id: serial('id').primaryKey(),
    blockerId: integer('blocker_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    blockedId: integer('blocked_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('blocked_users_pair_idx').on(table.blockerId, table.blockedId)]
);

// 24. push_subscriptions (Web Push endpoints for mobile/desktop background notifications)
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent').default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('push_subscriptions_user_idx').on(table.userId)]
);

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  graduationRecords: many(graduationRecords),
  proposals: many(proposals),
  notifications: many(notifications),
  permissionOverrides: many(userPermissions),
  pushSubscriptions: many(pushSubscriptions),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
  residenceWilaya: one(wilayas, { fields: [profiles.residenceWilayaId], references: [wilayas.id] }),
  residenceCommune: one(communes, { fields: [profiles.residenceCommuneId], references: [communes.id] }),
}));

export const wilayasRelations = relations(wilayas, ({ many }) => ({
  communes: many(communes),
}));

export const communesRelations = relations(communes, ({ one }) => ({
  wilaya: one(wilayas, { fields: [communes.wilayaId], references: [wilayas.id] }),
}));
