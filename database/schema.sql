-- GTU – المنصة الوطنية لخريجي التقنيات الحضرية في الجزائر
-- PostgreSQL Reference DDL Schema (20 Core Tables + Settings, Sessions & Blocks)

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  description TEXT DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1,
  is_system BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  allowed_roles TEXT NOT NULL DEFAULT '["super_admin"]',
  is_system BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT 'allow',
  note TEXT DEFAULT '',
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, permission_key)
);
CREATE INDEX IF NOT EXISTS user_permissions_user_idx ON user_permissions(user_id);

CREATE TABLE IF NOT EXISTS wilayas (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'الشمال',
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS communes (
  id SERIAL PRIMARY KEY,
  official_id INTEGER,
  wilaya_id INTEGER NOT NULL REFERENCES wilayas(id) ON DELETE CASCADE,
  wilaya_code TEXT NOT NULL,
  daira_ar TEXT DEFAULT '',
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  UNIQUE (wilaya_id, name_ar)
);
CREATE INDEX IF NOT EXISTS communes_wilaya_code_idx ON communes(wilaya_code);

CREATE TABLE IF NOT EXISTS institutions (
  id SERIAL PRIMARY KEY,
  name_ar TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'جامعة / معهد',
  wilaya_id INTEGER REFERENCES wilayas(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  national_member_number TEXT NOT NULL UNIQUE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  role_slug TEXT NOT NULL DEFAULT 'member',
  assigned_wilaya_code TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  accepted_terms BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_terms_at TIMESTAMP,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_role_slug_idx ON users(role_slug);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT DEFAULT '',
  birth_place TEXT DEFAULT '',
  birth_wilaya_id INTEGER REFERENCES wilayas(id),
  birth_commune_id INTEGER REFERENCES communes(id),
  phone TEXT DEFAULT '',
  residence_wilaya_id INTEGER REFERENCES wilayas(id),
  residence_commune_id INTEGER REFERENCES communes(id),
  avatar_url TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  experience TEXT DEFAULT '',
  privacy_show_phone BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_show_birth_date BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_show_email BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_allow_dm BOOLEAN NOT NULL DEFAULT TRUE,
  notify_messages BOOLEAN NOT NULL DEFAULT TRUE,
  notify_announcements BOOLEAN NOT NULL DEFAULT TRUE,
  notify_events BOOLEAN NOT NULL DEFAULT TRUE,
  notify_proposals BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS profiles_res_wilaya_idx ON profiles(residence_wilaya_id);
CREATE INDEX IF NOT EXISTS profiles_res_commune_idx ON profiles(residence_commune_id);

CREATE TABLE IF NOT EXISTS graduation_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL DEFAULT 'تقنيات حضرية',
  graduation_year INTEGER NOT NULL,
  institution_id INTEGER REFERENCES institutions(id),
  institution_name TEXT NOT NULL DEFAULT '',
  degree_level TEXT DEFAULT 'ليسانس / ماستر / مهندس',
  extra_info TEXT DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS grad_year_idx ON graduation_records(graduation_year);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  description TEXT DEFAULT '',
  wilaya_id INTEGER REFERENCES wilayas(id),
  is_national BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_group TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  participant_one_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  participant_two_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  attachment_url TEXT DEFAULT '',
  attachment_name TEXT DEFAULT '',
  attachment_type TEXT DEFAULT '',
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conv_created_idx ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS proposals (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'اقتراح تطويري',
  kind TEXT NOT NULL DEFAULT 'proposal',
  wilaya_id INTEGER REFERENCES wilayas(id),
  status TEXT NOT NULL DEFAULT 'جديد',
  assigned_to_id INTEGER REFERENCES users(id),
  admin_response TEXT DEFAULT '',
  rejection_reason TEXT DEFAULT '',
  supporters_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals(status);

CREATE TABLE IF NOT EXISTS proposal_updates (
  id SERIAL PRIMARY KEY,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id),
  previous_status TEXT DEFAULT '',
  new_status TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_date TIMESTAMP NOT NULL,
  location TEXT DEFAULT '',
  meeting_url TEXT DEFAULT '',
  wilaya_id INTEGER REFERENCES wilayas(id),
  organizer_name TEXT NOT NULL DEFAULT 'إدارة المنصة الوطنية GTU',
  max_seats INTEGER,
  registration_url TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_date_idx ON events(event_date);

CREATE TABLE IF NOT EXISTS event_attendees (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'attending',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'national',
  target_wilaya_id INTEGER REFERENCES wilayas(id),
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_url TEXT DEFAULT '',
  published_at TIMESTAMP NOT NULL DEFAULT NOW(),
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS announcements_pinned_date_idx ON announcements(is_pinned, published_at);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  resolution_note TEXT DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT DEFAULT '',
  details TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_info TEXT DEFAULT 'متصفح ويب',
  ip_address TEXT DEFAULT '',
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocked_users (
  id SERIAL PRIMARY KEY,
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

-- Chat scalability & world-class messaging upgrades
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS messages_conv_deleted_id_idx ON messages(conversation_id, is_deleted, id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS message_reactions_msg_idx ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS conversation_reads (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);


