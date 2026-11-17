import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Globe,
  GraduationCap,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Megaphone,
  Menu,
  MessageSquare,
  Moon,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Sliders,
  Sun,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  apiRequest,
  buildXlsxBytes,
  exportFilesAsZip,
  exportMultiSheetXlsx,
  exportToCsv,
  exportToJson,
  exportToXlsx,
} from '../lib/api.ts';
import {
  AdminOverviewData,
  AdminUserRow,
  AnnouncementItem,
  EventItem,
  Institution,
  PermissionDefinitionItem,
  ProposalItem,
  RoleDefinition,
  UserPermissionOverrideItem,
  UserSessionRow,
  Wilaya,
  hasUserPermission,
} from '../types/gtu.ts';

type AdminTab =
  | 'overview'
  | 'users'
  | 'roles'
  | 'permissions'
  | 'moderation'
  | 'community'
  | 'geography'
  | 'settings'
  | 'security';

const SETTING_LABELS: Record<string, string> = {
  platform_name: 'الاسم الرسمي للمنصة',
  platform_short_name: 'الاسم المختصر (الشعار)',
  platform_country: 'الدولة / المرجعية الوطنية',
  primary_color: 'اللون الأساسي للمؤسسة',
  accent_gold: 'اللون الذهبي الثانوي',
  accent_green: 'اللون الأخضر الثانوي',
  contact_email: 'البريد الإلكتروني الرسمي للتواصل',
  contact_phone: 'رقم الهاتف الرسمي',
  hero_title: 'العنوان الرئيسي في الصفحة الأولى',
  hero_subtitle: 'النص التعريفي في الواجهة الرئيسية',
  privacy_policy_text: 'نص سياسة الخصوصية وحماية البيانات',
  terms_of_use_text: 'نص شروط الاستخدام والعضوية',
};

const PROPOSAL_STATUSES = [
  'جديد',
  'قيد الدراسة',
  'مقبول',
  'قيد التنفيذ',
  'تم التنفيذ',
  'مرفوض',
];

function parseRolesArr(jsonStr: string): string[] {
  try {
    const parsed = JSON.parse(jsonStr || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const ADMIN_TABS: AdminTab[] = [
  'overview',
  'users',
  'roles',
  'permissions',
  'moderation',
  'community',
  'geography',
  'settings',
  'security',
];

function getInitialAdminTab(): AdminTab {
  if (typeof window === 'undefined') return 'overview';
  const seg = window.location.pathname.replace(/^\/admin\/?/, '').split('/')[0] as AdminTab;
  return ADMIN_TABS.includes(seg) ? seg : 'overview';
}

export const AdminPortal: React.FC<{
  onExitToPlatform: () => void;
}> = ({ onExitToPlatform }) => {
  const { user, loading, theme, toggleTheme, login, loginWithGoogle, logout, refreshUser } =
    useAuth();

  // Admin gate login form state (only used when unauthenticated)
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Navigation & feedback
  const [activeTab, setActiveTabState] = useState<AdminTab>(getInitialAdminTab);
  const setActiveTab = useCallback((next: AdminTab) => {
    setActiveTabState(next);
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      const targetPath = next === 'overview' ? '/admin' : `/admin/${next}`;
      if (window.location.pathname !== targetPath) {
        window.history.replaceState({}, '', targetPath);
      }
    }
  }, []);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Core Admin State
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [rolesList, setRolesList] = useState<RoleDefinition[]>([]);
  const [permissionsList, setPermissionsList] = useState<PermissionDefinitionItem[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [modReports, setModReports] = useState<any[]>([]);
  const [recentMessages, setRecentMessages] = useState<any[]>([]);
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [eventsList, setEventsList] = useState<EventItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [settingsList, setSettingsList] = useState<
    Array<{ key: string; value: string; category: string }>
  >([]);

  // Filters & Sorting
  const [userSearch, setUserSearch] = useState('');
  const [userWilayaFilter, setUserWilayaFilter] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [userSortBy, setUserSortBy] = useState<'wilaya' | 'name' | 'year' | 'member_no' | 'newest'>('wilaya');
  const [exportWilayaCode, setExportWilayaCode] = useState('');
  const [showAllWilayaCards, setShowAllWilayaCards] = useState(false);
  const [showWilayaExportGrid, setShowWilayaExportGrid] = useState(true);
  const [permSearch, setPermSearch] = useState('');
  const [permCategoryFilter, setPermCategoryFilter] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [msgSearch, setMsgSearch] = useState('');
  const [propStatusFilter, setPropStatusFilter] = useState('');

  // Full Member Dossier, Password Reset, Edit Profile, & Create User Modals
  const [inspectedUser, setInspectedUser] = useState<AdminUserRow | null>(null);
  const [editingMemberMode, setEditingMemberMode] = useState(false);
  const [memberEditForm, setMemberEditForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    birthDate: '',
    birthPlace: '',
    residenceWilayaCode: '',
    specialty: '',
    graduationYear: '',
    institutionName: '',
    bio: '',
    skills: '',
  });
  const [passwordModalUser, setPasswordModalUser] = useState<AdminUserRow | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    phone: '',
    birthDate: '',
    birthPlace: '',
    residenceWilayaCode: '16',
    specialty: 'تقنيات حضرية',
    graduationYear: String(new Date().getFullYear()),
    institutionName: '',
    roleSlug: 'member',
    password: '',
  });

  // Inline wilaya rep assignment map
  const [pendingWilayaByUser, setPendingWilayaByUser] = useState<Record<number, string>>({});

  // Modals: Per-User Permission Overrides
  const [overrideUser, setOverrideUser] = useState<AdminUserRow | null>(null);
  const [overrideState, setOverrideState] = useState<
    Record<string, { effect: 'inherit' | 'allow' | 'deny'; note: string }>
  >({});
  const [overrideBaseRolePerms, setOverrideBaseRolePerms] = useState<Set<string>>(new Set());
  const [overrideSaving, setOverrideSaving] = useState(false);

  // Modals: User Sessions
  const [sessionsUser, setSessionsUser] = useState<AdminUserRow | null>(null);
  const [sessionsList, setSessionsList] = useState<UserSessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Role create / edit state
  const [showNewRoleModal, setShowNewRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [roleForm, setRoleForm] = useState({ slug: '', nameAr: '', description: '', level: 30 });

  // Custom permission create modal
  const [showNewPermModal, setShowNewPermModal] = useState(false);
  const [permForm, setPermForm] = useState({
    key: '',
    nameAr: '',
    category: 'صلاحيات مخصصة',
    description: '',
  });

  // Proposal moderation modal
  const [editingProposal, setEditingProposal] = useState<ProposalItem | null>(null);
  const [propModForm, setPropModForm] = useState({
    status: 'قيد الدراسة',
    adminResponse: '',
    rejectionReason: '',
  });

  // Geography & Community quick forms
  const [newCommune, setNewCommune] = useState({
    wilayaCode: '16',
    nameAr: '',
    nameEn: '',
    dairaAr: '',
  });
  const [newInst, setNewInst] = useState({ nameAr: '', type: 'معهد تقنيات حضرية' });
  const [newAnn, setNewAnn] = useState({
    title: '',
    content: '',
    scope: 'national' as 'national' | 'wilaya',
    wilayaCode: '16',
    isPinned: false,
  });
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    eventType: 'لقاء مهني',
    eventDate: '',
    location: '',
    wilayaCode: '',
  });

  const canEnterPortal = hasUserPermission(
    user,
    'view_admin_panel',
    'manage_platform',
    'manage_roles',
    'manage_permissions',
    'manage_users',
    'moderate_chat',
    'manage_proposals',
    'manage_events',
    'publish_announcements',
    'manage_geography',
    'view_audit_logs',
    'manage_backups'
  );

  const notify = (type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const loadTabData = useCallback(async () => {
    if (!user || !canEnterPortal) return;
    try {
      const promises: Array<Promise<unknown>> = [
        apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)),
      ];

      if (hasUserPermission(user, 'view_admin_panel')) {
        promises.push(
          apiRequest<AdminOverviewData>('/api/admin/overview')
            .then(setOverview)
            .catch(() => {})
        );
      }
      if (
        hasUserPermission(
          user,
          'view_admin_panel',
          'manage_users',
          'manage_permissions',
          'manage_user_sessions'
        )
      ) {
        promises.push(
          apiRequest<{ users: AdminUserRow[] }>('/api/admin/users')
            .then((d) => setUsersList(d.users))
            .catch(() => {})
        );
      }
      if (
        hasUserPermission(user, 'view_admin_panel', 'manage_roles', 'manage_permissions', 'manage_users')
      ) {
        promises.push(
          apiRequest<{ roles: RoleDefinition[] }>('/api/admin/roles')
            .then((d) => setRolesList(d.roles))
            .catch(() => {})
        );
        promises.push(
          apiRequest<{ permissions: PermissionDefinitionItem[] }>('/api/admin/permissions')
            .then((d) => setPermissionsList(d.permissions))
            .catch(() => {})
        );
      }
      if (hasUserPermission(user, 'moderate_chat')) {
        promises.push(
          apiRequest<{ reports: any[] }>('/api/admin/reports')
            .then((d) => setModReports(d.reports))
            .catch(() => {}),
          apiRequest<{ messages: any[] }>('/api/admin/messages')
            .then((d) => setRecentMessages(d.messages))
            .catch(() => {})
        );
      }
      if (hasUserPermission(user, 'manage_proposals', 'publish_announcements', 'manage_events')) {
        promises.push(
          apiRequest<{ proposals: ProposalItem[] }>('/api/proposals')
            .then((d) => setProposals(d.proposals))
            .catch(() => {}),
          apiRequest<{ announcements: AnnouncementItem[] }>('/api/announcements')
            .then((d) => setAnnouncements(d.announcements))
            .catch(() => {}),
          apiRequest<{ events: EventItem[] }>('/api/events')
            .then((d) => setEventsList(d.events))
            .catch(() => {})
        );
      }
      if (hasUserPermission(user, 'manage_geography')) {
        promises.push(
          apiRequest<{ institutions: Institution[] }>('/api/institutions')
            .then((d) => setInstitutions(d.institutions))
            .catch(() => {})
        );
      }
      if (hasUserPermission(user, 'view_admin_panel', 'manage_platform')) {
        promises.push(
          apiRequest<{ settings: Array<{ key: string; value: string; category: string }> }>(
            '/api/admin/settings'
          )
            .then((d) => setSettingsList(d.settings))
            .catch(() => {})
        );
      }
      if (hasUserPermission(user, 'view_audit_logs')) {
        promises.push(
          apiRequest<{ logs: any[] }>('/api/admin/audit-logs')
            .then((d) => setAuditLogs(d.logs))
            .catch(() => {})
        );
      }

      await Promise.all(promises);
    } catch {
      // individual calls catch safely
    }
  }, [user, canEnterPortal]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Available Admin Modules filtered dynamically by effective permissions
  const navSections = useMemo(() => {
    const all: Array<{
      id: AdminTab;
      label: string;
      icon: React.ReactNode;
      visible: boolean;
    }> = [
      {
        id: 'overview',
        label: 'النظرة العامة الإدارية',
        icon: <Activity className="w-4 h-4" />,
        visible: hasUserPermission(user, 'view_admin_panel'),
      },
      {
        id: 'users',
        label: 'الأعضاء والصلاحيات الفردية',
        icon: <Users className="w-4 h-4" />,
        visible: hasUserPermission(user, 'manage_users', 'manage_permissions', 'manage_user_sessions'),
      },
      {
        id: 'roles',
        label: 'الأدوار الوظيفية',
        icon: <UserCog className="w-4 h-4" />,
        visible: hasUserPermission(user, 'manage_roles', 'manage_permissions'),
      },
      {
        id: 'permissions',
        label: 'مصفوفة الصلاحيات الشاملة',
        icon: <KeyRound className="w-4 h-4" />,
        visible: hasUserPermission(user, 'manage_permissions', 'manage_roles'),
      },
      {
        id: 'moderation',
        label: 'البلاغات ومراقبة المحادثات',
        icon: <ShieldAlert className="w-4 h-4" />,
        visible: hasUserPermission(user, 'moderate_chat'),
      },
      {
        id: 'community',
        label: 'الاقتراحات والفعاليات والإعلانات',
        icon: <Megaphone className="w-4 h-4" />,
        visible: hasUserPermission(
          user,
          'manage_proposals',
          'publish_announcements',
          'manage_events'
        ),
      },
      {
        id: 'geography',
        label: 'النظام الجغرافي والمؤسسات',
        icon: <Globe className="w-4 h-4" />,
        visible: hasUserPermission(user, 'manage_geography'),
      },
      {
        id: 'settings',
        label: 'إعدادات المنصة والهوية',
        icon: <Settings className="w-4 h-4" />,
        visible: hasUserPermission(user, 'manage_platform'),
      },
      {
        id: 'security',
        label: 'سجل العمليات والنسخ الاحتياطي',
        icon: <Database className="w-4 h-4" />,
        visible: hasUserPermission(user, 'view_audit_logs', 'manage_backups'),
      },
    ];
    return all.filter((s) => s.visible);
  }, [user]);

  useEffect(() => {
    if (navSections.length > 0 && !navSections.some((s) => s.id === activeTab)) {
      setActiveTab(navSections[0].id);
    }
  }, [navSections, activeTab]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#071620] text-white text-sm">
        جاري التحقق من صلاحيات بوابة الإدارة المستقلة GTU...
      </div>
    );
  }

  // Dedicated Admin Login Gate
  if (!user) {
    const handleAdminLogin = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoginError('');
      setLoginBusy(true);
      try {
        await login(loginId, loginPass);
      } catch (err: any) {
        setLoginError(err.message || 'تعذر تسجيل الدخول');
      } finally {
        setLoginBusy(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#0b1f2d] text-white flex flex-col justify-center px-4 py-10">
        <div className="max-w-md w-full mx-auto">
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={onExitToPlatform}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة إلى المنصة الوطنية</span>
            </button>
            <span className="text-xs font-bold text-[#D3AD68]">GTU ADMIN</span>
          </div>

          <div className="rounded-xl bg-[#102D40] border border-[#1e465f] p-7">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[#1e465f]">
              <div className="w-10 h-10 rounded-lg bg-[#173D53] flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-[#D3AD68]" />
              </div>
              <div>
                <h1 className="text-lg font-bold font-display text-white">
                  لوحة الإدارة المستقلة والحوكمة
                </h1>
                <p className="text-xs text-slate-300 mt-0.5">
                  دخول مخصص للمسؤولين المخولين لإدارة الصلاحيات والمنصة
                </p>
              </div>
            </div>

            {loginError && (
              <div className="mb-4 p-3 rounded-lg bg-red-950/60 border border-red-700 text-xs text-red-200">
                {loginError}
              </div>
            )}

            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  اسم المستخدم أو البريد الإلكتروني
                </label>
                <input
                  type="text"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-[#24526e] bg-[#081a26] text-white focus:outline-none focus:border-[#D3AD68]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  كلمة المرور
                </label>
                <input
                  type="password"
                  required
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-[#24526e] bg-[#081a26] text-white focus:outline-none focus:border-[#D3AD68]"
                />
              </div>
              <button
                type="submit"
                disabled={loginBusy}
                className="w-full py-2.5 rounded-lg bg-[#D3AD68] hover:bg-[#c59d55] text-[#102D40] text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loginBusy ? 'جاري التحقق من الصلاحيات...' : 'دخول إلى لوحة الإدارة'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
              <div className="flex-1 h-px bg-[#1e465f]" />
              <span>أو</span>
              <div className="flex-1 h-px bg-[#1e465f]" />
            </div>

            <button
              type="button"
              disabled={loginBusy}
              onClick={async () => {
                setLoginError('');
                setLoginBusy(true);
                try {
                  await loginWithGoogle();
                } catch (err: any) {
                  setLoginError(err.message || 'تعذر الدخول عبر Google');
                } finally {
                  setLoginBusy(false);
                }
              }}
              className="w-full py-2.5 rounded-lg border border-[#24526e] bg-[#0b202e] hover:bg-[#173D53] text-sm font-medium text-white transition-colors cursor-pointer"
            >
              الدخول بحساب Google الإداري
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Logged in, but user does NOT have permission to access Admin Portal
  if (!canEnterPortal) {
    return (
      <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-7 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-[#102D40] dark:text-white font-display">
            صلاحيات غير كافية لدخول لوحة الإدارة
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            الحساب المسجل حالياً (<span className="font-mono-tabular font-bold">@{user.username}</span> ·{' '}
            {user.roleNameAr}) لا يمتلك صلاحية الولوج إلى بوابة الإدارة المستقلة.
          </p>
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            <button
              type="button"
              onClick={onExitToPlatform}
              className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer"
            >
              العودة إلى المنصة الوطنية
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
              }}
              className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold cursor-pointer"
            >
              تسجيل الدخول بحساب آخر
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==================== Handlers ====================
  const handleChangeUserRole = async (u: AdminUserRow, nextRoleSlug: string, wilayaCode?: string) => {
    try {
      const code =
        wilayaCode !== undefined
          ? wilayaCode
          : nextRoleSlug === 'wilaya_rep'
          ? pendingWilayaByUser[u.id] ?? u.assignedWilayaCode ?? ''
          : '';
      await apiRequest(`/api/admin/users/${u.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleSlug: nextRoleSlug, assignedWilayaCode: code }),
      });
      notify('ok', `تم تحديث دور العضو @${u.username} بنجاح.`);
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleToggleUserStatus = async (u: AdminUserRow) => {
    try {
      await apiRequest(`/api/admin/users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      notify('ok', !u.isActive ? `تم تفعيل حساب @${u.username}.` : `تم تعليق حساب @${u.username} وإنهاء جلساته.`);
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleDeleteUser = async (u: AdminUserRow) => {
    if (
      !window.confirm(
        `هل أنت متأكد من حذف حساب @${u.username} (${u.nationalMemberNumber}) نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`
      )
    ) {
      return;
    }
    try {
      await apiRequest(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      notify('ok', `تم حذف حساب @${u.username} نهائياً.`);
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const openUserOverridesModal = async (u: AdminUserRow) => {
    try {
      const res = await apiRequest<{
        permissions: PermissionDefinitionItem[];
        overrides: UserPermissionOverrideItem[];
      }>(`/api/admin/users/${u.id}/permissions`);

      const baseSet = new Set<string>();
      for (const p of res.permissions) {
        if (parseRolesArr(p.allowedRoles).includes(u.roleSlug)) {
          baseSet.add(p.key);
        }
      }
      const map: Record<string, { effect: 'inherit' | 'allow' | 'deny'; note: string }> = {};
      for (const p of res.permissions) {
        const found = res.overrides.find((o) => o.permissionKey === p.key);
        map[p.key] = found
          ? { effect: found.effect, note: found.note || '' }
          : { effect: 'inherit', note: '' };
      }
      setOverrideBaseRolePerms(baseSet);
      setOverrideState(map);
      setOverrideUser(u);
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const saveUserOverrides = async () => {
    if (!overrideUser) return;
    setOverrideSaving(true);
    try {
      const overrides = Object.entries(overrideState)
        .filter(([, val]) => val.effect === 'allow' || val.effect === 'deny')
        .map(([permissionKey, val]) => ({
          permissionKey,
          effect: val.effect,
          note: val.note,
        }));
      await apiRequest(`/api/admin/users/${overrideUser.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ overrides }),
      });
      notify('ok', `تم حفظ الاستثناءات الفردية للعضو @${overrideUser.username} وتطبيقها فوراً.`);
      setOverrideUser(null);
      await loadTabData();
      if (overrideUser.id === user.id) await refreshUser();
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setOverrideSaving(false);
    }
  };

  const openUserSessionsModal = async (u: AdminUserRow) => {
    setSessionsUser(u);
    setSessionsLoading(true);
    try {
      const res = await apiRequest<{ sessions: UserSessionRow[] }>(
        `/api/admin/users/${u.id}/sessions`
      );
      setSessionsList(res.sessions);
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setSessionsLoading(false);
    }
  };

  const revokeUserSession = async (targetUserId: number, sessionId: number | 'all') => {
    try {
      await apiRequest(`/api/admin/users/${targetUserId}/sessions/${sessionId}`, {
        method: 'DELETE',
      });
      const res = await apiRequest<{ sessions: UserSessionRow[] }>(
        `/api/admin/users/${targetUserId}/sessions`
      );
      setSessionsList(res.sessions);
      notify('ok', sessionId === 'all' ? 'تم إنهاء جميع الجلسات النشطة للعضو.' : 'تم إنهاء الجلسة.');
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Roles CRUD
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingRole) {
        await apiRequest(`/api/admin/roles/${editingRole.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            nameAr: roleForm.nameAr,
            description: roleForm.description,
            level: Number(roleForm.level),
          }),
        });
        notify('ok', `تم تحديث الدور "${roleForm.nameAr}" بنجاح.`);
      } else {
        await apiRequest('/api/admin/roles', {
          method: 'POST',
          body: JSON.stringify(roleForm),
        });
        notify('ok', `تم إنشاء الدور الجديد "${roleForm.nameAr}" بنجاح.`);
      }
      setShowNewRoleModal(false);
      setEditingRole(null);
      setRoleForm({ slug: '', nameAr: '', description: '', level: 30 });
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleDeleteRole = async (r: RoleDefinition) => {
    if (!window.confirm(`حذف الدور المخصص "${r.nameAr}"؟ سيتم نقل أعضائه إلى دور "عضو خريج".`)) {
      return;
    }
    try {
      await apiRequest(`/api/admin/roles/${r.id}`, { method: 'DELETE' });
      notify('ok', `تم حذف الدور "${r.nameAr}".`);
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Permissions Matrix CRUD
  const togglePermRole = (permKey: string, roleSlug: string) => {
    if (roleSlug === 'super_admin') return;
    setPermissionsList((prev) =>
      prev.map((p) => {
        if (p.key !== permKey) return p;
        const arr = parseRolesArr(p.allowedRoles);
        const next = arr.includes(roleSlug)
          ? arr.filter((s) => s !== roleSlug)
          : [...arr, roleSlug];
        return { ...p, allowedRoles: JSON.stringify(next) };
      })
    );
  };

  const toggleAllForRoleColumn = (roleSlug: string, grant: boolean) => {
    if (roleSlug === 'super_admin') return;
    setPermissionsList((prev) =>
      prev.map((p) => {
        const arr = parseRolesArr(p.allowedRoles);
        const next = grant
          ? Array.from(new Set([...arr, roleSlug]))
          : arr.filter((s) => s !== roleSlug);
        return { ...p, allowedRoles: JSON.stringify(next) };
      })
    );
  };

  const handleSaveMatrix = async () => {
    try {
      const payload = permissionsList.map((p) => ({
        key: p.key,
        allowedRoles: parseRolesArr(p.allowedRoles),
      }));
      await apiRequest('/api/admin/permissions', {
        method: 'PUT',
        body: JSON.stringify({ permissions: payload }),
      });
      await refreshUser();
      await loadTabData();
      notify('ok', 'تم حفظ مصفوفة الصلاحيات وتفعيلها فوراً عبر الخادم.');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleCreatePermission = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/permissions', {
        method: 'POST',
        body: JSON.stringify({ ...permForm, allowedRoles: ['super_admin'] }),
      });
      setShowNewPermModal(false);
      setPermForm({ key: '', nameAr: '', category: 'صلاحيات مخصصة', description: '' });
      notify('ok', 'تمت إضافة الصلاحية المخصصة إلى المصفوفة.');
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleDeleteCustomPerm = async (p: PermissionDefinitionItem) => {
    if (!window.confirm(`حذف الصلاحية المخصصة "${p.nameAr}"؟`)) return;
    try {
      await apiRequest(`/api/admin/permissions/${p.id}`, { method: 'DELETE' });
      notify('ok', 'تم حذف الصلاحية المخصصة.');
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Batch Geo Import (CSV or JSON)
  const handleBatchGeoImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '').trim();
        let communesPayload: Array<Record<string, string>> = [];
        if (file.name.toLowerCase().endsWith('.json')) {
          const parsed = JSON.parse(text);
          communesPayload = Array.isArray(parsed) ? parsed : parsed.communes || [];
        } else {
          // Parse CSV: wilayaCode,nameAr,nameEn,dairaAr
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          const startIdx = lines[0]?.toLowerCase().includes('wilaya') ? 1 : 0;
          for (let i = startIdx; i < lines.length; i++) {
            const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
            if (cols[0] && cols[1]) {
              communesPayload.push({
                wilayaCode: cols[0],
                nameAr: cols[1],
                nameEn: cols[2] || cols[1],
                dairaAr: cols[3] || '',
              });
            }
          }
        }
        const res = await apiRequest<{ processed: number }>('/api/admin/geography/import', {
          method: 'POST',
          body: JSON.stringify({ communes: communesPayload }),
        });
        notify('ok', `تم استيراد ومعالجة ${res.processed} بلدية بنجاح.`);
        await loadTabData();
      } catch (err: any) {
        notify('err', err.message || 'تعذر قراءة ملف البلديات.');
      }
    };
    reader.readAsText(file);
  };

  // Filtered & Sorted Users
  const sortUsersList = useCallback(
    (list: AdminUserRow[], mode = userSortBy) => {
      const copy = [...list];
      copy.sort((a, b) => {
        if (mode === 'name') {
          const na = `${a.firstName || ''} ${a.lastName || ''} ${a.username}`.trim();
          const nb = `${b.firstName || ''} ${b.lastName || ''} ${b.username}`.trim();
          return na.localeCompare(nb, 'ar');
        }
        if (mode === 'year') {
          return (b.graduationYear || 0) - (a.graduationYear || 0);
        }
        if (mode === 'member_no') {
          return (a.nationalMemberNumber || '').localeCompare(b.nationalMemberNumber || '');
        }
        if (mode === 'newest') {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        // Default: 'wilaya' (01 -> 58 then alphabetical name)
        const wa = a.wilayaCode || '99';
        const wb = b.wilayaCode || '99';
        if (wa !== wb) return wa.localeCompare(wb);
        const na = `${a.firstName || ''} ${a.lastName || ''} ${a.username}`.trim();
        const nb = `${b.firstName || ''} ${b.lastName || ''} ${b.username}`.trim();
        return na.localeCompare(nb, 'ar');
      });
      return copy;
    },
    [userSortBy]
  );

  const filteredUsers = useMemo(() => {
    const base = usersList.filter((u) => {
      if (userWilayaFilter && u.wilayaCode !== userWilayaFilter) return false;
      if (userRoleFilter && u.roleSlug !== userRoleFilter) return false;
      if (userStatusFilter === 'active' && !u.isActive) return false;
      if (userStatusFilter === 'suspended' && u.isActive) return false;
      if (userSearch.trim()) {
        const q = userSearch.trim().toLowerCase();
        const hay = `${u.firstName || ''} ${u.lastName || ''} ${u.username} ${u.email || ''} ${
          u.phone || ''
        } ${u.nationalMemberNumber} ${u.wilayaName || ''} ${u.wilayaCode || ''} ${
          u.communeName || ''
        } ${u.specialty || ''} ${u.institutionName || ''} ${u.graduationYear || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sortUsersList(base);
  }, [usersList, userWilayaFilter, userRoleFilter, userStatusFilter, userSearch, sortUsersList]);

  const toMemberExportRows = useCallback(
    (rows: AdminUserRow[]) =>
      rows.map((u, idx) => ({
        الترتيب: idx + 1,
        'رقم العضوية الوطني': u.nationalMemberNumber,
        'الاسم واللقب': u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : u.username,
        'اسم المستخدم': u.username,
        'رقم الهاتف': u.phone || '—',
        'البريد الإلكتروني': u.email || '—',
        'تاريخ الميلاد': u.birthDate || '—',
        'مكان الميلاد': u.birthPlace || '—',
        'ولاية الميلاد': u.birthWilayaName
          ? `${u.birthWilayaCode || ''} - ${u.birthWilayaName}`
          : '—',
        'بلدية الميلاد': u.birthCommuneName || '—',
        'رمز الولاية': u.wilayaCode || '—',
        'ولاية الإقامة': u.wilayaName || '—',
        'بلدية الإقامة': u.communeName || '—',
        التخصص: u.specialty || '—',
        'سنة التخرج': u.graduationYear || '—',
        'المؤسسة الجامعية': u.institutionName || '—',
        'الشهادة / المستوى': u.degreeLevel || '—',
        المهارات: u.skills || '—',
        الخبرات: u.experience || '—',
        'الدور الوظيفي': u.roleNameAr,
        'الولاية المكلف بها': u.assignedWilayaCode || '—',
        الحالة: u.isActive ? 'نشط' : 'معلق',
        'تاريخ التسجيل': new Date(u.createdAt).toLocaleDateString('ar-DZ'),
        'آخر دخول': u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ar-DZ') : '—',
      })),
    []
  );

  const wilayaBuckets = useMemo(() => {
    const map = new Map<string, { code: string; nameAr: string; members: AdminUserRow[] }>();
    for (const w of wilayas) {
      map.set(w.code, { code: w.code, nameAr: w.nameAr, members: [] });
    }
    for (const u of sortUsersList(usersList, 'wilaya')) {
      const code = u.wilayaCode || '00';
      const existing = map.get(code);
      if (existing) {
        existing.members.push(u);
      } else {
        map.set(code, {
          code,
          nameAr: u.wilayaName || 'غير محددة الولاية',
          members: [u],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [wilayas, usersList, sortUsersList]);

  const handleDownloadAllSorted = (format: 'xlsx' | 'multi_xlsx' | 'csv' | 'json' | 'zip') => {
    const sortedAll = sortUsersList(filteredUsers.length > 0 ? filteredUsers : usersList);
    const dateTag = new Date().toISOString().slice(0, 10);
    if (sortedAll.length === 0) {
      notify('err', 'لا توجد بيانات أعضاء لتصديرها.');
      return;
    }

    if (format === 'xlsx') {
      exportToXlsx(`GTU-all-members-sorted-${dateTag}`, 'كل الأعضاء مرتبين', toMemberExportRows(sortedAll));
      notify('ok', `تم تحميل ملف Excel شامل لـ ${sortedAll.length} عضو مرتبين.`);
    } else if (format === 'multi_xlsx') {
      const sheets = [
        { name: 'كل الأعضاء مرتبين', rows: toMemberExportRows(sortedAll) },
        ...wilayaBuckets
          .filter((b) => b.members.length > 0)
          .map((b) => ({
            name: `${b.code}-${b.nameAr}`,
            rows: toMemberExportRows(sortUsersList(b.members, 'name')),
          })),
      ];
      exportMultiSheetXlsx(`GTU-members-by-wilaya-${dateTag}`, sheets);
      notify('ok', 'تم تحميل مصنف Excel يحتوي على ورقة شاملة وورقة مستقلة لكل ولاية.');
    } else if (format === 'zip') {
      const zipFiles = wilayaBuckets
        .filter((b) => b.members.length > 0)
        .map((b) => {
          const rows = toMemberExportRows(sortUsersList(b.members, 'name'));
          return {
            name: `wilaya-${b.code}-${b.nameAr}.xlsx`,
            data: buildXlsxBytes(`${b.code}-${b.nameAr}`, rows),
          };
        });
      zipFiles.unshift({
        name: `00-كل-الأعضاء-مرتبين.xlsx`,
        data: buildXlsxBytes('كل الأعضاء مرتبين', toMemberExportRows(sortedAll)),
      });
      exportFilesAsZip(`GTU-wilayas-files-${dateTag}`, zipFiles);
      notify('ok', `تم تنزيل أرشيف ZIP يحتوي على ${zipFiles.length} ملف Excel مستقل لكل ولاية.`);
    } else if (format === 'csv') {
      exportToCsv(`GTU-all-members-sorted-${dateTag}`, toMemberExportRows(sortedAll));
      notify('ok', 'تم تحميل ملف CSV لجميع الأعضاء المرتبين.');
    } else {
      exportToJson(`GTU-all-members-sorted-${dateTag}`, {
        exportedAt: new Date().toISOString(),
        sortBy: userSortBy,
        total: sortedAll.length,
        members: sortedAll,
      });
      notify('ok', 'تم تحميل ملف JSON لجميع الأعضاء المرتبين.');
    }
  };

  const handleDownloadSingleWilaya = (
    wilayaCode: string,
    format: 'xlsx' | 'csv' | 'json'
  ) => {
    const bucket = wilayaBuckets.find((b) => b.code === wilayaCode);
    if (!bucket) {
      notify('err', 'يرجى اختيار ولاية صالحة.');
      return;
    }
    const sorted = sortUsersList(bucket.members, 'name');
    const dateTag = new Date().toISOString().slice(0, 10);
    const baseName = `GTU-wilaya-${bucket.code}-${bucket.nameAr}-${dateTag}`;
    if (format === 'xlsx') {
      exportToXlsx(baseName, `${bucket.code}-${bucket.nameAr}`, toMemberExportRows(sorted));
    } else if (format === 'csv') {
      if (sorted.length === 0) {
        exportToCsv(baseName, [{ ملاحظة: `لا يوجد أعضاء مسجلون حالياً في ولاية ${bucket.nameAr}` }]);
      } else {
        exportToCsv(baseName, toMemberExportRows(sorted));
      }
    } else {
      exportToJson(baseName, {
        wilayaCode: bucket.code,
        wilayaName: bucket.nameAr,
        totalMembers: sorted.length,
        exportedAt: new Date().toISOString(),
        members: sorted,
      });
    }
    notify('ok', `تم تحميل ملف ولاية ${bucket.nameAr} (${sorted.length} عضو).`);
  };

  const openMemberDossier = (u: AdminUserRow, startInEdit = false) => {
    setInspectedUser(u);
    setEditingMemberMode(startInEdit);
    setMemberEditForm({
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      phone: u.phone || '',
      email: u.email || '',
      birthDate: u.birthDate || '',
      birthPlace: u.birthPlace || '',
      residenceWilayaCode: u.wilayaCode || '',
      specialty: u.specialty || '',
      graduationYear: u.graduationYear ? String(u.graduationYear) : '',
      institutionName: u.institutionName || '',
      bio: u.bio || '',
      skills: u.skills || '',
    });
  };

  const handleSaveMemberProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedUser) return;
    try {
      await apiRequest(`/api/admin/users/${inspectedUser.id}/profile`, {
        method: 'PATCH',
        body: JSON.stringify(memberEditForm),
      });
      notify('ok', `تم تحديث كافة بيانات العضو @${inspectedUser.username} بنجاح.`);
      setEditingMemberMode(false);
      setInspectedUser(null);
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleAdminResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModalUser) return;
    try {
      await apiRequest(`/api/admin/users/${passwordModalUser.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: newPasswordInput }),
      });
      notify('ok', `تم تعيين كلمة المرور الجديدة للحساب @${passwordModalUser.username} بنجاح.`);
      setPasswordModalUser(null);
      setNewPasswordInput('');
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const handleCreateUserByAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUserForm),
      });
      notify('ok', `تم إنشاء الحساب @${newUserForm.username} بنجاح.`);
      setShowNewUserModal(false);
      setNewUserForm({
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        phone: '',
        birthDate: '',
        birthPlace: '',
        residenceWilayaCode: '16',
        specialty: 'تقنيات حضرية',
        graduationYear: String(new Date().getFullYear()),
        institutionName: '',
        roleSlug: 'member',
        password: '',
      });
      await loadTabData();
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const permCategories = Array.from(new Set(permissionsList.map((p) => p.category)));
  const filteredPerms = permissionsList.filter((p) => {
    if (permCategoryFilter && p.category !== permCategoryFilter) return false;
    if (permSearch.trim()) {
      const q = permSearch.trim().toLowerCase();
      if (!`${p.nameAr} ${p.key} ${p.description}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const filteredAuditLogs = auditLogs.filter((l) => {
    if (!auditSearch.trim()) return true;
    const q = auditSearch.trim().toLowerCase();
    return `${l.action} ${l.actorUsername || ''} ${l.details || ''} ${l.entityType}`.toLowerCase().includes(q);
  });

  const filteredMessages = recentMessages.filter((m) => {
    if (!msgSearch.trim()) return true;
    const q = msgSearch.trim().toLowerCase();
    return `${m.content} ${m.senderName} ${m.conversationTitle}`.toLowerCase().includes(q);
  });

  const filteredProposals = proposals.filter((p) =>
    propStatusFilter ? p.status === propStatusFilter : true
  );

  const canManagePerms = hasUserPermission(user, 'manage_permissions');
  const canManageUsers = hasUserPermission(user, 'manage_users');
  const canDeleteUsers = hasUserPermission(user, 'delete_users');
  const canManageSessions = hasUserPermission(user, 'manage_user_sessions');
  const canManageRoles = hasUserPermission(user, 'manage_roles');
  const canManageSettings = hasUserPermission(user, 'manage_platform');
  const canManageBackups = hasUserPermission(user, 'manage_backups');

  return (
    <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] text-[#172B38] dark:text-slate-100 flex">
      {/* Standalone Admin Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0c2231] text-white border-l border-[#1e465f] shrink-0">
        <div className="p-5 border-b border-[#1e465f]">
          <div className="text-base font-extrabold font-display tracking-tight text-white">
            GTU الإدارة والحوكمة
          </div>
          <div className="text-[11px] text-[#D3AD68] mt-0.5">
            بوابة التحكم الكامل بالصلاحيات والنظام
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navSections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === item.id
                  ? 'bg-[#173D53] text-[#D3AD68] font-bold'
                  : 'text-slate-200 hover:bg-[#173D53]/60'
              }`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-[#1e465f] space-y-1.5">
          <div className="px-3 py-2 rounded-lg bg-[#081824] text-[11px]">
            <div className="font-bold text-white truncate">
              {user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username}
            </div>
            <div className="text-[#D3AD68] truncate mt-0.5">{user.roleNameAr}</div>
          </div>
          <button
            type="button"
            onClick={onExitToPlatform}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-200 hover:bg-white/5 cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للمنصة الرئيسية</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-300 hover:bg-white/5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 bg-[#0c2231] text-white h-full flex flex-col p-4 overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e465f]">
              <span className="font-bold text-sm">GTU الإدارة والحوكمة</span>
              <button type="button" onClick={() => setMobileNavOpen(false)} className="p-1 text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 py-3 space-y-1">
              {navSections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs ${
                    activeTab === item.id ? 'bg-[#173D53] text-[#D3AD68] font-bold' : 'text-slate-200'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onExitToPlatform}
              className="mt-2 flex items-center gap-2 px-3 py-2 text-xs text-slate-200"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة للمنصة الرئيسية</span>
            </button>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}

      {/* Main Standalone Admin Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 3-Zone Top Bar Contract */}
        <header className="sticky top-0 z-30 bg-white dark:bg-[#102D40] border-b border-[#dce4ea] dark:border-[#1e465f] px-4 sm:px-6 py-3 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e]"
              aria-label="قائمة الإدارة"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-300 truncate whitespace-nowrap">
              <span className="font-bold text-[#102D40] dark:text-white">بوابة الإدارة المستقلة</span>
              <span className="mx-1.5">/</span>
              <span>{navSections.find((n) => n.id === activeTab)?.label || 'النظرة العامة'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={loadTabData}
              className="p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] cursor-pointer"
              title="تحديث البيانات"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] cursor-pointer"
              aria-label="تبديل المظهر"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#D3AD68]" />
              ) : (
                <Moon className="w-4 h-4 text-[#102D40]" />
              )}
            </button>
            <button
              type="button"
              onClick={onExitToPlatform}
              className="px-3.5 py-2 rounded-lg bg-[#102D40] hover:bg-[#173D53] text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
            >
              العودة للمنصة
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {banner && (
            <div
              className={`p-3.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                banner.type === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
              }`}
            >
              <span>{banner.text}</span>
              <button type="button" onClick={() => setBanner(null)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ==================== 1. OVERVIEW ==================== */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                  النظرة العامة على الحوكمة والصلاحيات
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                  مؤشرات حية لقاعدة بيانات المنصة والأدوار الوظيفية والاستثناءات والجلسات النشطة
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'إجمالي الحسابات', value: overview?.kpis.totalUsers ?? usersList.length },
                  { label: 'الأدوار الوظيفية', value: overview?.kpis.totalRolesCount ?? rolesList.length },
                  { label: 'الصلاحيات المعرفة', value: overview?.kpis.totalPermissionsCount ?? permissionsList.length },
                  { label: 'استثناءات الأعضاء الفردية', value: overview?.kpis.totalOverridesCount ?? 0 },
                  { label: 'الحسابات النشطة', value: overview?.kpis.activeUsers ?? 0 },
                  { label: 'الحسابات المعلقة', value: overview?.kpis.suspendedUsers ?? 0 },
                  { label: 'الجلسات النشطة حالياً', value: overview?.kpis.activeSessionsCount ?? 0 },
                  {
                    label: 'بلاغات ومقترحات معلقة',
                    value:
                      (overview?.kpis.pendingReportsCount ?? 0) +
                      (overview?.kpis.pendingProposalsCount ?? 0),
                  },
                ].map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4"
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-300">{kpi.label}</div>
                    <div className="text-2xl font-extrabold font-mono-tabular text-[#102D40] dark:text-white mt-1.5">
                      {kpi.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
                  <h2 className="text-sm font-bold mb-4">توزيع الأعضاء حسب الدور الوظيفي</h2>
                  <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f] text-xs">
                    {(overview?.usersByRole || []).map((r) => (
                      <div key={r.roleSlug} className="py-2.5 flex items-center justify-between">
                        <div>
                          <span className="font-semibold">{r.nameAr}</span>
                          <span className="text-slate-400 mr-2 font-mono-tabular">({r.roleSlug})</span>
                        </div>
                        <span className="font-mono-tabular font-bold text-[#27866F]">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
                  <h2 className="text-sm font-bold mb-4">أحدث العمليات الإدارية المسجلة</h2>
                  <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f] text-xs">
                    {(overview?.recentAuditLogs || []).length === 0 ? (
                      <p className="text-slate-400 py-4">لا توجد عمليات مسجلة بعد.</p>
                    ) : (
                      (overview?.recentAuditLogs || []).map((log) => (
                        <div key={log.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0 truncate">
                            <span className="font-mono-tabular font-bold text-[#102D40] dark:text-[#D3AD68]">
                              {log.action}
                            </span>
                            <span className="text-slate-500 dark:text-slate-300 mr-1.5">
                              · {log.actorUsername || 'النظام'} · {log.details}
                            </span>
                          </div>
                          <span className="font-mono-tabular text-[11px] text-slate-400 shrink-0">
                            {new Date(log.createdAt).toLocaleDateString('ar-DZ')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
                <h2 className="text-sm font-bold mb-3">
                  صلاحياتك الفعالة في الجلسة الحالية ({user.permissions.length} صلاحية)
                </h2>
                <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {user.permissions.join(' · ') || 'لا توجد صلاحيات مخصصة'}
                </div>
              </div>
            </div>
          )}

          {/* ==================== 2. USERS, FULL DOSSIERS, EXPORTS & OVERRIDES ==================== */}
          {activeTab === 'users' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                    سجل الأعضاء الكامل والتحكم وتصدير ملفات الولايات
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                    عرض وتعديل كامل معلومات الأعضاء، تعيين كلمات المرور، التحكم بالصلاحيات، وتنزيل ملفات كل ولاية أو كل الأعضاء مرتبين
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canManageUsers && (
                    <button
                      type="button"
                      onClick={() => setShowNewUserModal(true)}
                      className="px-4 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>إضافة عضو / مسؤول</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3.5 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>طباعة القائمة</span>
                  </button>
                </div>
              </div>

              {/* Export & Download Center: All Sorted + Individual Wilaya Files */}
              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold flex items-center gap-2 text-[#102D40] dark:text-white">
                      <FileSpreadsheet className="w-4 h-4 text-[#27866F]" />
                      <span>مركز تحميل ملفات الأعضاء مرتبين وملفات كل ولاية منفردة</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-300 mt-0.5">
                      يتضمن كل ملف كافة بيانات العضو (الهوية، الهاتف، البريد، الميلاد، الإقامة، البلدية، التخصص، المؤسسة، سنة التخرج، الدور، الحالة).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowWilayaExportGrid((v) => !v)}
                    className="text-xs font-semibold text-[#102D40] dark:text-[#D3AD68] hover:underline cursor-pointer"
                  >
                    {showWilayaExportGrid ? 'إخفاء شبكة الولايات' : 'إظهار شبكة تحميل كل ولاية'}
                  </button>
                </div>

                {/* Global Sorted Exports */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadAllSorted('xlsx')}
                    className="px-3.5 py-2 rounded-lg bg-[#102D40] hover:bg-[#173D53] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#D3AD68]" />
                    <span>تحميل كل الأعضاء مرتبين (Excel)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadAllSorted('multi_xlsx')}
                    className="px-3.5 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>مصنف Excel مقسّم لكل ولاية</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadAllSorted('zip')}
                    className="px-3.5 py-2 rounded-lg bg-[#D3AD68] hover:bg-[#c29b54] text-[#102D40] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileArchive className="w-3.5 h-3.5" />
                    <span>تحميل أرشيف ZIP (ملف مستقل لكل ولاية)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadAllSorted('csv')}
                    className="px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold cursor-pointer"
                  >
                    CSV مرتب
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadAllSorted('json')}
                    className="px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold cursor-pointer"
                  >
                    JSON مرتب
                  </button>
                </div>

                {/* Single Wilaya Quick Selector */}
                <div className="pt-3 border-t border-[#dce4ea] dark:border-[#1e465f] flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-bold text-[#102D40] dark:text-white">
                    تحميل ملف ولاية محددة وحدها:
                  </span>
                  <select
                    value={exportWilayaCode}
                    onChange={(e) => setExportWilayaCode(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  >
                    <option value="">اختر الولاية...</option>
                    {wilayaBuckets.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.code} - {b.nameAr} ({b.members.length} عضو)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!exportWilayaCode}
                    onClick={() => handleDownloadSingleWilaya(exportWilayaCode, 'xlsx')}
                    className="px-3 py-1.5 rounded-lg bg-[#102D40] text-white text-xs font-bold disabled:opacity-40 cursor-pointer"
                  >
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    disabled={!exportWilayaCode}
                    onClick={() => handleDownloadSingleWilaya(exportWilayaCode, 'csv')}
                    className="px-3 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    disabled={!exportWilayaCode}
                    onClick={() => handleDownloadSingleWilaya(exportWilayaCode, 'json')}
                    className="px-3 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold disabled:opacity-40 cursor-pointer"
                  >
                    JSON
                  </button>
                </div>

                {/* Individual Wilaya Export Grid */}
                {showWilayaExportGrid && (
                  <div className="pt-3 border-t border-[#dce4ea] dark:border-[#1e465f] space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">
                        تحميل فوري لكل ولاية منفردة (مرتبة أبجدياً):
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAllWilayaCards((v) => !v)}
                        className="text-[11px] font-semibold text-[#27866F] hover:underline cursor-pointer"
                      >
                        {showAllWilayaCards
                          ? 'عرض الولايات التي بها أعضاء فقط'
                          : `عرض جميع الولايات (${wilayaBuckets.length})`}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-60 overflow-y-auto pl-1">
                      {wilayaBuckets
                        .filter((b) => showAllWilayaCards || b.members.length > 0)
                        .map((b) => (
                          <div
                            key={b.code}
                            className="p-2.5 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] border border-[#dce4ea]/70 dark:border-[#1e465f] flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-bold truncate">
                                <span className="font-mono-tabular text-[#27866F] ml-1">{b.code}</span>
                                {b.nameAr}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono-tabular">
                                {b.members.length} عضو
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleDownloadSingleWilaya(b.code, 'xlsx')}
                                className="px-2 py-1 rounded bg-[#102D40] text-white text-[10px] font-bold cursor-pointer"
                                title={`تنزيل Excel لولاية ${b.nameAr}`}
                              >
                                XLSX
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadSingleWilaya(b.code, 'csv')}
                                className="px-2 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] text-[10px] font-semibold cursor-pointer"
                                title={`تنزيل CSV لولاية ${b.nameAr}`}
                              >
                                CSV
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Filter & Sort toolbar */}
              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
                <div className="md:col-span-2 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="ابحث بالاسم، الهاتف، البريد، رقم العضوية، التخصص، المؤسسة..."
                    className="w-full pr-9 pl-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <select
                  value={userWilayaFilter}
                  onChange={(e) => setUserWilayaFilter(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                >
                  <option value="">كل الولايات ({usersList.length})</option>
                  {wilayaBuckets.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} - {b.nameAr} ({b.members.length})
                    </option>
                  ))}
                </select>
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                >
                  <option value="">كل الأدوار الوظيفية</option>
                  {rolesList.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {r.nameAr}
                    </option>
                  ))}
                </select>
                <select
                  value={userStatusFilter}
                  onChange={(e) => setUserStatusFilter(e.target.value as any)}
                  className="px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                >
                  <option value="all">جميع الحالات ({usersList.length})</option>
                  <option value="active">الحسابات النشطة</option>
                  <option value="suspended">الحسابات المعلقة</option>
                </select>
                <select
                  value={userSortBy}
                  onChange={(e) => setUserSortBy(e.target.value as any)}
                  className="px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] font-semibold"
                >
                  <option value="wilaya">الترتيب: حسب الولاية (01←58)</option>
                  <option value="name">الترتيب: أبجدياً (أ←ي)</option>
                  <option value="year">الترتيب: سنة التخرج</option>
                  <option value="member_no">الترتيب: رقم العضوية</option>
                  <option value="newest">الترتيب: الأحدث تسجيلاً</option>
                </select>
              </div>

              {/* Complete Member Information Table */}
              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F3F6F8] dark:bg-[#0b202e] text-slate-600 dark:text-slate-300 border-b border-[#dce4ea] dark:border-[#1e465f]">
                    <tr>
                      <th className="py-3 px-3 text-center font-bold">#</th>
                      <th className="py-3 px-4 text-right font-bold">العضو ومعلومات الاتصال</th>
                      <th className="py-3 px-4 text-right font-bold">رقم العضوية والميلاد</th>
                      <th className="py-3 px-4 text-right font-bold">الإقامة (الولاية / البلدية)</th>
                      <th className="py-3 px-4 text-right font-bold">التكوين والتخرج</th>
                      <th className="py-3 px-4 text-right font-bold">الدور والتكليف</th>
                      <th className="py-3 px-3 text-center font-bold">الحالة</th>
                      <th className="py-3 px-4 text-right font-bold">التحكم الكامل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                    {filteredUsers.map((u, idx) => {
                      const isSelf = u.id === user.id;
                      const isTargetSuper = u.roleSlug === 'super_admin';
                      const canEditTarget =
                        canManageUsers && !isSelf && (!isTargetSuper || user.roleSlug === 'super_admin');
                      const selectedWilaya =
                        pendingWilayaByUser[u.id] !== undefined
                          ? pendingWilayaByUser[u.id]
                          : u.assignedWilayaCode || '';

                      return (
                        <tr key={u.id} className="hover:bg-[#F3F6F8]/60 dark:hover:bg-[#173D53]/30">
                          <td className="py-3 px-3 text-center font-mono-tabular text-slate-400">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-[#102D40] dark:text-white">
                              {u.firstName ? `${u.firstName} ${u.lastName || ''}` : u.username}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-300 font-mono-tabular">
                              @{u.username}
                              {u.email ? ` · ${u.email}` : ''}
                            </div>
                            {u.phone && (
                              <div className="text-[11px] text-[#27866F] font-mono-tabular mt-0.5">
                                {u.phone}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono-tabular font-semibold whitespace-nowrap">
                              {u.nationalMemberNumber}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-0.5">
                              {u.birthDate ? `ميلاد: ${u.birthDate}` : '—'}
                              {u.birthPlace ? ` (${u.birthPlace})` : ''}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-semibold">
                              {u.wilayaCode ? `${u.wilayaCode} - ` : ''}
                              {u.wilayaName || '—'}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-300">
                              {u.communeName || '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-[200px]">
                            <div className="font-medium truncate">
                              {u.specialty || '—'} {u.graduationYear ? `(${u.graduationYear})` : ''}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-300 truncate">
                              {u.institutionName || '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <select
                                value={u.roleSlug}
                                disabled={!canEditTarget}
                                onChange={(e) => handleChangeUserRole(u, e.target.value)}
                                className="px-2 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] text-xs disabled:opacity-60"
                              >
                                {rolesList
                                  .filter(
                                    (r) =>
                                      r.slug !== 'super_admin' ||
                                      user.roleSlug === 'super_admin' ||
                                      u.roleSlug === 'super_admin'
                                  )
                                  .map((r) => (
                                    <option key={r.slug} value={r.slug}>
                                      {r.nameAr}
                                    </option>
                                  ))}
                              </select>
                              {u.roleSlug === 'wilaya_rep' && (
                                <select
                                  value={selectedWilaya}
                                  disabled={!canEditTarget}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setPendingWilayaByUser((prev) => ({ ...prev, [u.id]: val }));
                                    handleChangeUserRole(u, 'wilaya_rep', val);
                                  }}
                                  className="px-2 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] text-xs"
                                >
                                  <option value="">اختر الولاية...</option>
                                  {wilayas.map((w) => (
                                    <option key={w.code} value={w.code}>
                                      {w.code} - {w.nameAr}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              disabled={!canEditTarget}
                              onClick={() => handleToggleUserStatus(u)}
                              className={`px-2.5 py-1 rounded text-[11px] font-bold whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                                u.isActive
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                              }`}
                            >
                              {u.isActive ? 'نشط' : 'معلق'}
                            </button>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openMemberDossier(u, false)}
                                className="px-2.5 py-1 rounded bg-[#102D40] text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
                                title="عرض وتعديل كامل معلومات العضو"
                              >
                                <Eye className="w-3 h-3 text-[#D3AD68]" />
                                <span>كل المعلومات</span>
                              </button>
                              {canManageUsers && (!isTargetSuper || user.roleSlug === 'super_admin') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPasswordModalUser(u);
                                    setNewPasswordInput('');
                                  }}
                                  className="px-2 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#0b202e] text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
                                  title="تعيين / تغيير كلمة المرور"
                                >
                                  <KeyRound className="w-3 h-3 text-[#27866F]" />
                                  <span>كلمة المرور</span>
                                </button>
                              )}
                              {canManagePerms && u.roleSlug !== 'super_admin' && (
                                <button
                                  type="button"
                                  onClick={() => openUserOverridesModal(u)}
                                  className="px-2.5 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#0b202e] hover:border-[#D3AD68] text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  صلاحيات ({u.overridesCount})
                                </button>
                              )}
                              {canManageSessions && (
                                <button
                                  type="button"
                                  onClick={() => openUserSessionsModal(u)}
                                  className="px-2.5 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#0b202e] text-[11px] font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  الجلسات ({u.activeSessionsCount})
                                </button>
                              )}
                              {canDeleteUsers && !isSelf && u.roleSlug !== 'super_admin' && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(u)}
                                  className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                                  title="حذف الحساب نهائياً"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 3. ROLES MANAGEMENT ==================== */}
          {activeTab === 'roles' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                    إدارة الأدوار الوظيفية والهرمية
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                    إنشاء أدوار مخصصة جديدة (مثل: مشرف وطني، منسق إعلامي، لجنة علمية) وتحديد مستواها وصلاحياتها
                  </p>
                </div>
                {canManageRoles && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRole(null);
                      setRoleForm({ slug: '', nameAr: '', description: '', level: 30 });
                      setShowNewRoleModal(true);
                    }}
                    className="px-4 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة دور وظيفي جديد</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rolesList.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-sm font-bold text-[#102D40] dark:text-white">
                            {r.nameAr}
                          </h2>
                          <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-1 font-mono-tabular">
                            {r.slug} · المستوى {r.level} · {r.isSystem ? 'دور نظام أساسي' : 'دور مخصص'} ·{' '}
                            {r.usersCount || 0} عضو
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
                        {r.description || 'لا يوجد وصف مسجل لهذا الدور.'}
                      </p>
                    </div>

                    {canManageRoles && (
                      <div className="flex items-center justify-between pt-3 border-t border-[#dce4ea] dark:border-[#1e465f]">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRole(r);
                            setRoleForm({
                              slug: r.slug,
                              nameAr: r.nameAr,
                              description: r.description || '',
                              level: r.level,
                            });
                            setShowNewRoleModal(true);
                          }}
                          className="text-xs font-semibold text-[#102D40] dark:text-[#D3AD68] hover:underline cursor-pointer"
                        >
                          تعديل التسمية والوصف
                        </button>
                        {!r.isSystem && (
                          <button
                            type="button"
                            onClick={() => handleDeleteRole(r)}
                            className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                          >
                            حذف الدور
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ==================== 4. FULL PERMISSIONS MATRIX ==================== */}
          {activeTab === 'permissions' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                    مصفوفة الصلاحيات الشاملة (RBAC Matrix)
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                    التحكم التام بكل الصلاحيات عبر جميع الأدوار. كل تعديل يُطبق مباشرة على مسارات الخادم وواجهات المستخدم.
                  </p>
                </div>
                {canManagePerms && (
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowNewPermModal(true)}
                      className="px-3.5 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40] text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة صلاحية مخصصة</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveMatrix}
                      className="px-4 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>حفظ مصفوفة الصلاحيات</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Filter permissions */}
              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={permSearch}
                    onChange={(e) => setPermSearch(e.target.value)}
                    placeholder="ابحث باسم الصلاحية أو المفتاح البرمجي..."
                    className="w-full pr-9 pl-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <select
                  value={permCategoryFilter}
                  onChange={(e) => setPermCategoryFilter(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                >
                  <option value="">كل التصنيفات ({permissionsList.length})</option>
                  {permCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F3F6F8] dark:bg-[#0b202e] border-b border-[#dce4ea] dark:border-[#1e465f]">
                    <tr>
                      <th className="py-3 px-4 text-right font-bold min-w-[260px]">
                        الصلاحية والوصف
                      </th>
                      {rolesList.map((r) => (
                        <th key={r.slug} className="py-3 px-3 text-center font-bold min-w-[120px]">
                          <div>{r.nameAr}</div>
                          <div className="text-[10px] font-mono-tabular font-normal text-slate-400 mt-0.5">
                            {r.slug}
                          </div>
                          {canManagePerms && r.slug !== 'super_admin' && (
                            <div className="flex items-center justify-center gap-2 mt-1 text-[10px] font-normal">
                              <button
                                type="button"
                                onClick={() => toggleAllForRoleColumn(r.slug, true)}
                                className="text-[#27866F] hover:underline cursor-pointer"
                              >
                                الكل
                              </button>
                              <span className="text-slate-300">/</span>
                              <button
                                type="button"
                                onClick={() => toggleAllForRoleColumn(r.slug, false)}
                                className="text-red-500 hover:underline cursor-pointer"
                              >
                                سحب
                              </button>
                            </div>
                          )}
                        </th>
                      ))}
                      {canManagePerms && <th className="py-3 px-3 text-center">إجراء</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                    {filteredPerms.map((p) => {
                      const allowed = parseRolesArr(p.allowedRoles);
                      return (
                        <tr key={p.key} className="hover:bg-[#F3F6F8]/60 dark:hover:bg-[#173D53]/30">
                          <td className="py-3 px-4">
                            <div className="font-bold text-[#102D40] dark:text-white">{p.nameAr}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-0.5">
                              {p.category} · <span className="font-mono-tabular">{p.key}</span>
                            </div>
                            {p.description && (
                              <div className="text-[11px] text-slate-400 mt-0.5">{p.description}</div>
                            )}
                          </td>
                          {rolesList.map((r) => {
                            const checked = r.slug === 'super_admin' || allowed.includes(r.slug);
                            return (
                              <td key={r.slug} className="py-3 px-3 text-center">
                                <input
                                  type="checkbox"
                                  disabled={!canManagePerms || r.slug === 'super_admin'}
                                  checked={checked}
                                  onChange={() => togglePermRole(p.key, r.slug)}
                                  className="w-4 h-4 accent-[#102D40] cursor-pointer disabled:cursor-not-allowed"
                                />
                              </td>
                            );
                          })}
                          {canManagePerms && (
                            <td className="py-3 px-3 text-center">
                              {!p.isSystem ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomPerm(p)}
                                  className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                                  title="حذف الصلاحية المخصصة"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400">أساسية</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 5. MODERATION (REPORTS & MESSAGES) ==================== */}
          {activeTab === 'moderation' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                  الإشراف على المحتوى والبلاغات
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                  مراجعة بلاغات الأعضاء ومراقبة رسائل الشات الوطني والمجموعات الولائية
                </p>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3">
                <h2 className="text-sm font-bold">البلاغات الواردة ({modReports.length})</h2>
                {modReports.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4">لا توجد بلاغات مسجلة حالياً.</p>
                ) : (
                  <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                    {modReports.map((r) => (
                      <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div>
                          <div className="font-bold">
                            {r.targetType} #{r.targetId} · {r.reason}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            المبلغ: @{r.reporterUsername || r.reporterId} · الحالة: {r.status} ·{' '}
                            {new Date(r.createdAt).toLocaleString('ar-DZ')}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {r.targetType === 'message' && r.status === 'pending' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await apiRequest(`/api/messages/${r.targetId}`, { method: 'DELETE' }).catch(() => {});
                                await apiRequest(`/api/admin/reports/${r.id}`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ status: 'resolved', resolutionNote: 'تم حذف الرسالة المخالفة' }),
                                });
                                notify('ok', 'تم حذف الرسالة وإغلاق البلاغ.');
                                await loadTabData();
                              }}
                              className="px-2.5 py-1.5 rounded bg-red-600 text-white text-[11px] font-bold cursor-pointer"
                            >
                              حذف الرسالة وإغلاق
                            </button>
                          )}
                          {r.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiRequest(`/api/admin/reports/${r.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ status: 'resolved' }),
                                  });
                                  await loadTabData();
                                }}
                                className="px-2.5 py-1.5 rounded bg-[#27866F] text-white text-[11px] font-bold cursor-pointer"
                              >
                                تمت المعالجة
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiRequest(`/api/admin/reports/${r.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ status: 'dismissed' }),
                                  });
                                  await loadTabData();
                                }}
                                className="px-2.5 py-1.5 rounded border border-[#dce4ea] dark:border-[#24526e] text-[11px] cursor-pointer"
                              >
                                تجاهل
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-[#D3AD68]" />
                    <span>مراقبة أحدث رسائل الشات ({filteredMessages.length})</span>
                  </h2>
                  <input
                    type="text"
                    value={msgSearch}
                    onChange={(e) => setMsgSearch(e.target.value)}
                    placeholder="تصفية الرسائل..."
                    className="px-3 py-1.5 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f] max-h-96 overflow-y-auto">
                  {filteredMessages.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4">لا توجد رسائل مطابقة.</p>
                  ) : (
                    filteredMessages.map((m) => (
                      <div key={m.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-[#102D40] dark:text-white">
                            {m.senderName} <span className="text-slate-400 font-normal">في {m.conversationTitle}</span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300 mt-1 break-words">{m.content}</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/api/messages/${m.id}`, { method: 'DELETE' });
                            notify('ok', 'تم حذف الرسالة.');
                            await loadTabData();
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded shrink-0 cursor-pointer"
                          title="حذف الرسالة"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== 6. COMMUNITY (PROPOSALS, ANNOUNCEMENTS, EVENTS) ==================== */}
          {activeTab === 'community' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                  إدارة الاقتراحات والإعلانات والفعاليات
                </h1>
              </div>

              {hasUserPermission(user, 'manage_proposals') && (
                <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-bold">الاقتراحات والمبادرات ({filteredProposals.length})</h2>
                    <select
                      value={propStatusFilter}
                      onChange={(e) => setPropStatusFilter(e.target.value)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    >
                      <option value="">كل الحالات</option>
                      {PROPOSAL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                    {filteredProposals.map((p) => (
                      <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div>
                          <div className="font-bold text-[#102D40] dark:text-white">{p.title}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {p.authorName} · {p.category} · الحالة: {p.status} · تأييد: {p.supportersCount}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProposal(p);
                            setPropModForm({
                              status: p.status,
                              adminResponse: p.adminResponse || '',
                              rejectionReason: p.rejectionReason || '',
                            });
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#102D40] text-white text-xs font-semibold cursor-pointer"
                        >
                          معالجة والرد
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {hasUserPermission(user, 'publish_announcements') && (
                  <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
                    <h2 className="text-sm font-bold">نشر وإدارة الإعلانات الرسمية</h2>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          await apiRequest('/api/announcements', {
                            method: 'POST',
                            body: JSON.stringify(newAnn),
                          });
                          setNewAnn({ title: '', content: '', scope: 'national', wilayaCode: '16', isPinned: false });
                          notify('ok', 'تم نشر الإعلان الرسمي.');
                          await loadTabData();
                        } catch (err: any) {
                          notify('err', err.message);
                        }
                      }}
                      className="space-y-3"
                    >
                      <input
                        type="text"
                        required
                        placeholder="عنوان الإعلان الرسمي"
                        value={newAnn.title}
                        onChange={(e) => setNewAnn({ ...newAnn, title: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      />
                      <textarea
                        rows={3}
                        required
                        placeholder="محتوى البيان أو الخبر..."
                        value={newAnn.content}
                        onChange={(e) => setNewAnn({ ...newAnn, content: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      />
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <select
                          value={newAnn.scope}
                          onChange={(e) => setNewAnn({ ...newAnn, scope: e.target.value as any })}
                          className="px-3 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                        >
                          <option value="national">نطاق وطني</option>
                          <option value="wilaya">نطاق ولائي</option>
                        </select>
                        {newAnn.scope === 'wilaya' && (
                          <select
                            value={newAnn.wilayaCode}
                            onChange={(e) => setNewAnn({ ...newAnn, wilayaCode: e.target.value })}
                            className="px-3 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                          >
                            {wilayas.map((w) => (
                              <option key={w.code} value={w.code}>
                                {w.code} - {w.nameAr}
                              </option>
                            ))}
                          </select>
                        )}
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newAnn.isPinned}
                            onChange={(e) => setNewAnn({ ...newAnn, isPinned: e.target.checked })}
                          />
                          <span>تثبيت</span>
                        </label>
                        <button
                          type="submit"
                          className="px-4 py-1.5 rounded-lg bg-[#27866F] text-white font-bold cursor-pointer"
                        >
                          نشر
                        </button>
                      </div>
                    </form>

                    <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f] max-h-64 overflow-y-auto pt-2">
                      {announcements.map((a) => (
                        <div key={a.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="truncate font-medium">{a.title}</div>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiRequest(`/api/announcements/${a.id}`, { method: 'DELETE' });
                              await loadTabData();
                            }}
                            className="p-1 text-red-600 cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {hasUserPermission(user, 'manage_events') && (
                  <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
                    <h2 className="text-sm font-bold flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#D3AD68]" />
                      <span>إدارة المواعيد والفعاليات</span>
                    </h2>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        try {
                          await apiRequest('/api/events', {
                            method: 'POST',
                            body: JSON.stringify(newEvent),
                          });
                          setNewEvent({
                            title: '',
                            description: '',
                            eventType: 'لقاء مهني',
                            eventDate: '',
                            location: '',
                            wilayaCode: '',
                          });
                          notify('ok', 'تمت جدولة الفعالية.');
                          await loadTabData();
                        } catch (err: any) {
                          notify('err', err.message);
                        }
                      }}
                      className="space-y-3"
                    >
                      <input
                        type="text"
                        required
                        placeholder="عنوان الفعالية أو الملتقى"
                        value={newEvent.title}
                        onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      />
                      <textarea
                        rows={2}
                        required
                        placeholder="تفاصيل الفعالية..."
                        value={newEvent.description}
                        onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="datetime-local"
                          required
                          value={newEvent.eventDate}
                          onChange={(e) => setNewEvent({ ...newEvent, eventDate: e.target.value })}
                          className="px-3 py-1.5 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                        />
                        <input
                          type="text"
                          placeholder="المكان أو الرابط"
                          value={newEvent.location}
                          onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                          className="px-3 py-1.5 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                        />
                      </div>
                      <button
                        type="submit"
                        className="px-4 py-1.5 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer"
                      >
                        إنشاء فعالية
                      </button>
                    </form>

                    <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f] max-h-64 overflow-y-auto pt-2">
                      {eventsList.map((ev) => (
                        <div key={ev.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="truncate font-medium">
                            {ev.title} · <span className="text-slate-400">{ev.attendingCount} مؤكد</span>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await apiRequest(`/api/events/${ev.id}`, { method: 'DELETE' });
                              await loadTabData();
                            }}
                            className="p-1 text-red-600 cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== 7. GEOGRAPHY & INSTITUTIONS ==================== */}
          {activeTab === 'geography' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                  النظام الجغرافي الإداري والمؤسسات الجامعية
                </h1>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await apiRequest('/api/admin/communes', {
                        method: 'POST',
                        body: JSON.stringify(newCommune),
                      });
                      setNewCommune({ wilayaCode: '16', nameAr: '', nameEn: '', dairaAr: '' });
                      notify('ok', 'تمت إضافة البلدية وربطها بالولاية.');
                      await loadTabData();
                    } catch (err: any) {
                      notify('err', err.message);
                    }
                  }}
                  className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3"
                >
                  <h2 className="text-sm font-bold">إضافة بلدية جديدة</h2>
                  <select
                    value={newCommune.wilayaCode}
                    onChange={(e) => setNewCommune({ ...newCommune, wilayaCode: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  >
                    {wilayas.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} - {w.nameAr}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="اسم البلدية بالعربية"
                    value={newCommune.nameAr}
                    onChange={(e) => setNewCommune({ ...newCommune, nameAr: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                  <input
                    type="text"
                    placeholder="الدائرة"
                    value={newCommune.dairaAr}
                    onChange={(e) => setNewCommune({ ...newCommune, dairaAr: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                  <button type="submit" className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer">
                    إضافة البلدية
                  </button>
                </form>

                <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3">
                  <h2 className="text-sm font-bold">استيراد دفعة بلديات (CSV / JSON)</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
                    يدعم ملفات JSON أو CSV بصيغة: wilayaCode,nameAr,nameEn,dairaAr لإضافة أو تحديث التقسيم الإداري.
                  </p>
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>اختر ملف CSV أو JSON</span>
                    <input type="file" accept=".json,.csv" onChange={handleBatchGeoImport} className="hidden" />
                  </label>
                </div>

                <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3">
                  <h2 className="text-sm font-bold">إضافة مؤسسة جامعية أو معهد</h2>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await apiRequest('/api/admin/institutions', {
                          method: 'POST',
                          body: JSON.stringify(newInst),
                        });
                        setNewInst({ nameAr: '', type: 'معهد تقنيات حضرية' });
                        notify('ok', 'تمت إضافة المؤسسة.');
                        await loadTabData();
                      } catch (err: any) {
                        notify('err', err.message);
                      }
                    }}
                    className="space-y-2.5"
                  >
                    <input
                      type="text"
                      required
                      placeholder="اسم المعهد أو الجامعة"
                      value={newInst.nameAr}
                      onChange={(e) => setNewInst({ ...newInst, nameAr: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                    <input
                      type="text"
                      placeholder="نوع المؤسسة"
                      value={newInst.type}
                      onChange={(e) => setNewInst({ ...newInst, type: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                    <button type="submit" className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer">
                      إضافة المؤسسة
                    </button>
                  </form>
                </div>
              </div>

              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
                <h2 className="text-sm font-bold mb-3">المؤسسات والمعاهد المعتمدة ({institutions.length})</h2>
                <div className="divide-y divide-[#dce4ea] dark:divide-[#1e465f] max-h-72 overflow-y-auto text-xs">
                  {institutions.map((inst) => (
                    <div key={inst.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-semibold">{inst.nameAr}</span>
                        <span className="text-slate-400 mr-2">· {inst.type}</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await apiRequest(`/api/admin/institutions/${inst.id}`, { method: 'DELETE' });
                            await loadTabData();
                          } catch (err: any) {
                            notify('err', err.message);
                          }
                        }}
                        className="p-1 text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ==================== 8. PLATFORM SETTINGS ==================== */}
          {activeTab === 'settings' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await apiRequest('/api/admin/settings', {
                    method: 'PUT',
                    body: JSON.stringify({ settings: settingsList }),
                  });
                  notify('ok', 'تم حفظ إعدادات المنصة وتحديثها مباشرة.');
                } catch (err: any) {
                  notify('err', err.message);
                }
              }}
              className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-5"
            >
              <div>
                <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
                  إعدادات المنصة والهوية والنصوص القانونية
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                  تعديل جميع إعدادات العلامة والألوان والتواصل والسياسات ديناميكياً من قاعدة البيانات
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {settingsList.map((s, idx) => (
                  <div key={s.key} className={s.value.length > 90 ? 'md:col-span-2' : ''}>
                    <label className="block text-xs font-bold mb-1">
                      {SETTING_LABELS[s.key] || s.key}{' '}
                      <span className="text-[11px] font-mono-tabular font-normal text-slate-400">
                        ({s.key})
                      </span>
                    </label>
                    {s.value.length > 90 ? (
                      <textarea
                        rows={3}
                        disabled={!canManageSettings}
                        value={s.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSettingsList((prev) => prev.map((it, i) => (i === idx ? { ...it, value: v } : it)));
                        }}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      />
                    ) : (
                      <input
                        type="text"
                        disabled={!canManageSettings}
                        value={s.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSettingsList((prev) => prev.map((it, i) => (i === idx ? { ...it, value: v } : it)));
                        }}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      />
                    )}
                  </div>
                ))}
              </div>

              {canManageSettings && (
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-lg bg-[#102D40] hover:bg-[#173D53] text-white text-xs font-bold cursor-pointer"
                >
                  حفظ إعدادات المنصة
                </button>
              )}
            </form>
          )}

          {/* ==================== 9. SECURITY, AUDIT LOGS & BACKUP ==================== */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {canManageBackups && (
                <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-bold flex items-center gap-2">
                      <Database className="w-4 h-4 text-[#27866F]" />
                      <span>النسخ الاحتياطي والاستعادة الشاملة (JSON)</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                      تصدير الأدوار والصلاحيات والاستثناءات والإعدادات والأعضاء أو استعادة البيانات من ملف JSON
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const data = await apiRequest('/api/admin/backup');
                        exportToJson(`gtu-backup-${new Date().toISOString().slice(0, 10)}`, data);
                      }}
                      className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تنزيل نسخة احتياطية</span>
                    </button>
                    <label className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5 text-[#27866F]" />
                      <span>استعادة من ملف</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const r = new FileReader();
                          r.onload = async () => {
                            try {
                              const parsed = JSON.parse(String(r.result || '{}'));
                              const res = await apiRequest<{ restoredItems: number }>('/api/admin/restore', {
                                method: 'POST',
                                body: JSON.stringify(parsed),
                              });
                              notify('ok', `تمت استعادة ${res.restoredItems} سجل بنجاح.`);
                              await loadTabData();
                            } catch (err: any) {
                              notify('err', err.message || 'تعذر استعادة النسخة الاحتياطية.');
                            }
                          };
                          r.readAsText(file);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#D3AD68]" />
                    <span>سجل العمليات الإدارية والأمنية ({filteredAuditLogs.length})</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="بحث في السجل..."
                      className="px-3 py-1.5 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                    <button
                      type="button"
                      onClick={() => exportToCsv('gtu-audit-logs', filteredAuditLogs)}
                      className="px-3 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold cursor-pointer"
                    >
                      تصدير CSV
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F3F6F8] dark:bg-[#0b202e] sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3 text-right">العملية</th>
                        <th className="py-2.5 px-3 text-right">المنفذ</th>
                        <th className="py-2.5 px-3 text-right">التفاصيل</th>
                        <th className="py-2.5 px-3 text-right">التوقيت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                      {filteredAuditLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="py-2.5 px-3 font-mono-tabular font-bold text-[#102D40] dark:text-[#D3AD68]">
                            {log.action}
                          </td>
                          <td className="py-2.5 px-3">{log.actorUsername || 'النظام'}</td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{log.details || '—'}</td>
                          <td className="py-2.5 px-3 font-mono-tabular text-[11px] text-slate-400 whitespace-nowrap">
                            {new Date(log.createdAt).toLocaleString('ar-DZ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ==================== MODAL: PER-USER PERMISSION OVERRIDES ==================== */}
      {overrideUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f]">
            <div className="p-5 border-b border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-[#102D40] dark:text-white flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-[#D3AD68]" />
                  <span>
                    تخصيص الصلاحيات الفردية: {overrideUser.firstName ? `${overrideUser.firstName} ${overrideUser.lastName}` : overrideUser.username}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
                  @{overrideUser.username} · الدور الأساسي: {overrideUser.roleNameAr}
                </p>
              </div>
              <button type="button" onClick={() => setOverrideUser(null)} className="p-1.5 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
              {permissionsList.map((p) => {
                const inherited = overrideBaseRolePerms.has(p.key);
                const cur = overrideState[p.key] || { effect: 'inherit', note: '' };
                const effectiveResult =
                  cur.effect === 'allow' ? true : cur.effect === 'deny' ? false : inherited;

                return (
                  <div key={p.key} className="py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[#102D40] dark:text-white">{p.nameAr}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        الوراثة من الدور: {inherited ? 'مسموح' : 'غير مسموح'} · النتيجة الفعلية:{' '}
                        <strong className={effectiveResult ? 'text-[#27866F]' : 'text-red-600'}>
                          {effectiveResult ? 'مفعل' : 'محجوب'}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e]">
                      {(
                        [
                          ['inherit', 'موروث'],
                          ['allow', 'منح استثنائي'],
                          ['deny', 'حجب استثنائي'],
                        ] as const
                      ).map(([eff, lbl]) => (
                        <button
                          key={eff}
                          type="button"
                          onClick={() =>
                            setOverrideState((prev) => ({
                              ...prev,
                              [p.key]: { effect: eff, note: cur.note },
                            }))
                          }
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap cursor-pointer ${
                            cur.effect === eff
                              ? eff === 'allow'
                                ? 'bg-[#27866F] text-white'
                                : eff === 'deny'
                                ? 'bg-red-600 text-white'
                                : 'bg-[#102D40] text-white'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  const reset: typeof overrideState = {};
                  for (const p of permissionsList) reset[p.key] = { effect: 'inherit', note: '' };
                  setOverrideState(reset);
                }}
                className="px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إعادة ضبط الكل للوراثة
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideUser(null)}
                  className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={overrideSaving}
                  onClick={saveUserOverrides}
                  className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {overrideSaving ? 'جاري الحفظ...' : 'حفظ الاستثناءات الفردية'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: USER SESSIONS ==================== */}
      {sessionsUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">جلسات الدخول: @{sessionsUser.username}</h3>
                <p className="text-xs text-slate-500">عرض وإنهاء الجلسات النشطة قسرياً</p>
              </div>
              <button type="button" onClick={() => setSessionsUser(null)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {sessionsLoading ? (
              <div className="py-6 text-center text-xs text-slate-400">جاري تحميل الجلسات...</div>
            ) : sessionsList.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">لا توجد جلسات مسجلة لهذا العضو.</div>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-[#dce4ea] dark:divide-[#1e465f] text-xs">
                {sessionsList.map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{s.deviceInfo || 'متصفح ويب'}</div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        IP: {s.ipAddress || '—'} · إنشاء: {new Date(s.createdAt).toLocaleString('ar-DZ')} ·{' '}
                        {s.revokedAt ? 'منتهية/ملغاة' : 'نشطة'}
                      </div>
                    </div>
                    {!s.revokedAt && (
                      <button
                        type="button"
                        onClick={() => revokeUserSession(sessionsUser.id, s.id)}
                        className="px-2.5 py-1 rounded bg-red-600 text-white text-[11px] font-bold shrink-0 cursor-pointer"
                      >
                        إنهاء
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-2 border-t border-[#dce4ea] dark:border-[#1e465f]">
              <button
                type="button"
                onClick={() => revokeUserSession(sessionsUser.id, 'all')}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
              >
                إنهاء جميع الجلسات النشطة
              </button>
              <button
                type="button"
                onClick={() => setSessionsUser(null)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CREATE / EDIT ROLE ==================== */}
      {showNewRoleModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveRole}
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-4"
          >
            <h3 className="text-base font-bold">
              {editingRole ? `تعديل الدور: ${editingRole.nameAr}` : 'إنشاء دور وظيفي جديد'}
            </h3>
            {!editingRole && (
              <div>
                <label className="block text-xs font-semibold mb-1">المعرف البرمجي (بالإنجليزية)</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: media_coordinator"
                  value={roleForm.slug}
                  onChange={(e) => setRoleForm({ ...roleForm, slug: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الدور بالعربية</label>
              <input
                type="text"
                required
                placeholder="مثال: منسق الإعلام الوطني"
                value={roleForm.nameAr}
                onChange={(e) => setRoleForm({ ...roleForm, nameAr: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">المستوى الهرمي (1 إلى 99)</label>
              <input
                type="number"
                min={1}
                max={editingRole?.slug === 'super_admin' ? 100 : 99}
                disabled={editingRole?.slug === 'super_admin'}
                value={roleForm.level}
                onChange={(e) => setRoleForm({ ...roleForm, level: Number(e.target.value) })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الوصف</label>
              <textarea
                rows={2}
                value={roleForm.description}
                onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewRoleModal(false)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer"
              >
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: CREATE CUSTOM PERMISSION ==================== */}
      {showNewPermModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePermission}
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-4"
          >
            <h3 className="text-base font-bold">إضافة صلاحية مخصصة جديدة</h3>
            <div>
              <label className="block text-xs font-semibold mb-1">المفتاح البرمجي (بالإنجليزية)</label>
              <input
                type="text"
                required
                placeholder="مثال: approve_wilaya_budgets"
                value={permForm.key}
                onChange={(e) => setPermForm({ ...permForm, key: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">اسم الصلاحية بالعربية</label>
              <input
                type="text"
                required
                value={permForm.nameAr}
                onChange={(e) => setPermForm({ ...permForm, nameAr: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التصنيف</label>
              <input
                type="text"
                value={permForm.category}
                onChange={(e) => setPermForm({ ...permForm, category: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الوصف</label>
              <textarea
                rows={2}
                value={permForm.description}
                onChange={(e) => setPermForm({ ...permForm, description: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewPermModal(false)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer"
              >
                إضافة
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: PROCESS PROPOSAL ==================== */}
      {editingProposal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiRequest(`/api/proposals/${editingProposal.id}/status`, {
                  method: 'PATCH',
                  body: JSON.stringify(propModForm),
                });
                setEditingProposal(null);
                notify('ok', 'تم تحديث حالة الاقتراح وإشعار صاحبه.');
                await loadTabData();
              } catch (err: any) {
                notify('err', err.message);
              }
            }}
            className="w-full max-w-lg rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-4"
          >
            <h3 className="text-base font-bold">{editingProposal.title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-300 leading-relaxed">
              {editingProposal.description}
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1">الحالة الجديدة</label>
              <select
                value={propModForm.status}
                onChange={(e) => setPropModForm({ ...propModForm, status: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              >
                {PROPOSAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">الرد الرسمي</label>
              <textarea
                rows={3}
                value={propModForm.adminResponse}
                onChange={(e) => setPropModForm({ ...propModForm, adminResponse: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            {propModForm.status === 'مرفوض' && (
              <div>
                <label className="block text-xs font-semibold mb-1 text-red-600">سبب الرفض (إلزامي)</label>
                <textarea
                  rows={2}
                  required
                  value={propModForm.rejectionReason}
                  onChange={(e) => setPropModForm({ ...propModForm, rejectionReason: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-red-300 bg-red-50/40 dark:bg-[#0b202e]"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingProposal(null)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer"
              >
                حفظ التحديث
              </button>
            </div>
          </form>
        </div>
      )}
      {/* ==================== MODAL: FULL MEMBER DOSSIER & EDIT ==================== */}
      {inspectedUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] overflow-hidden">
            <div className="p-5 border-b border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between gap-4 bg-[#F3F6F8]/60 dark:bg-[#0b202e]/60">
              <div className="flex items-center gap-3 min-w-0">
                {inspectedUser.avatarUrl ? (
                  <img
                    src={inspectedUser.avatarUrl}
                    alt={inspectedUser.username}
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-full object-cover border border-[#D3AD68]"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-[#102D40] text-[#D3AD68] flex items-center justify-center font-bold text-sm">
                    {(inspectedUser.firstName || inspectedUser.username).slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-[#102D40] dark:text-white truncate">
                    {inspectedUser.firstName
                      ? `${inspectedUser.firstName} ${inspectedUser.lastName || ''}`
                      : inspectedUser.username}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-300 font-mono-tabular truncate">
                    @{inspectedUser.username} · {inspectedUser.nationalMemberNumber} ·{' '}
                    {inspectedUser.roleNameAr}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canManageUsers &&
                  (inspectedUser.roleSlug !== 'super_admin' || user.roleSlug === 'super_admin') && (
                    <button
                      type="button"
                      onClick={() => setEditingMemberMode((v) => !v)}
                      className="px-3 py-1.5 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer"
                    >
                      {editingMemberMode ? 'عرض الملف' : 'تعديل البيانات'}
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setInspectedUser(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {editingMemberMode ? (
              <form onSubmit={handleSaveMemberProfile} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">الاسم</label>
                    <input
                      type="text"
                      required
                      value={memberEditForm.firstName}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, firstName: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">اللقب</label>
                    <input
                      type="text"
                      required
                      value={memberEditForm.lastName}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, lastName: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">رقم الهاتف</label>
                    <input
                      type="text"
                      value={memberEditForm.phone}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">البريد الإلكتروني</label>
                    <input
                      type="email"
                      value={memberEditForm.email}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, email: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">تاريخ الميلاد</label>
                    <input
                      type="text"
                      value={memberEditForm.birthDate}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, birthDate: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">مكان الميلاد</label>
                    <input
                      type="text"
                      value={memberEditForm.birthPlace}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, birthPlace: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">ولاية الإقامة</label>
                    <select
                      value={memberEditForm.residenceWilayaCode}
                      onChange={(e) =>
                        setMemberEditForm({ ...memberEditForm, residenceWilayaCode: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    >
                      <option value="">— غير محددة —</option>
                      {wilayas.map((w) => (
                        <option key={w.code} value={w.code}>
                          {w.code} - {w.nameAr}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">سنة التخرج</label>
                    <input
                      type="number"
                      value={memberEditForm.graduationYear}
                      onChange={(e) =>
                        setMemberEditForm({ ...memberEditForm, graduationYear: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">التخصص</label>
                    <input
                      type="text"
                      value={memberEditForm.specialty}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, specialty: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">المؤسسة أو المعهد</label>
                    <input
                      type="text"
                      value={memberEditForm.institutionName}
                      onChange={(e) =>
                        setMemberEditForm({ ...memberEditForm, institutionName: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold mb-1">المهارات</label>
                    <input
                      type="text"
                      value={memberEditForm.skills}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, skills: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold mb-1">النبذة التعريفية</label>
                    <textarea
                      rows={2}
                      value={memberEditForm.bio}
                      onChange={(e) => setMemberEditForm({ ...memberEditForm, bio: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingMemberMode(false)}
                    className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg bg-[#27866F] text-white font-bold cursor-pointer"
                  >
                    حفظ التعديلات
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl bg-[#F3F6F8] dark:bg-[#0b202e] p-4 space-y-2">
                    <div className="font-bold text-[#102D40] dark:text-[#D3AD68] flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5" />
                      <span>معلومات الهوية والاتصال والميلاد</span>
                    </div>
                    <div>الهاتف: <strong className="font-mono-tabular">{inspectedUser.phone || '—'}</strong></div>
                    <div className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-slate-400" />
                      <span>البريد: <strong className="font-mono-tabular">{inspectedUser.email || '—'}</strong></span>
                    </div>
                    <div>تاريخ الميلاد: <strong className="font-mono-tabular">{inspectedUser.birthDate || '—'}</strong></div>
                    <div>مكان الميلاد: <strong>{inspectedUser.birthPlace || '—'}</strong></div>
                    <div>
                      ولاية وبلدية الميلاد:{' '}
                      <strong>
                        {inspectedUser.birthWilayaName
                          ? `${inspectedUser.birthWilayaCode} - ${inspectedUser.birthWilayaName}`
                          : '—'}
                        {inspectedUser.birthCommuneName ? ` / ${inspectedUser.birthCommuneName}` : ''}
                      </strong>
                    </div>
                    <div>
                      كلمة المرور:{' '}
                      <strong>{inspectedUser.hasPassword ? 'مفعّلة ومشفّرة' : 'غير معينة (Google)'}</strong>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#F3F6F8] dark:bg-[#0b202e] p-4 space-y-2">
                    <div className="font-bold text-[#102D40] dark:text-[#D3AD68] flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>الإقامة والمسار الأكاديمي والمهني</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#27866F]" />
                      <span>
                        الإقامة:{' '}
                        <strong>
                          {inspectedUser.wilayaCode
                            ? `${inspectedUser.wilayaCode} - ${inspectedUser.wilayaName}`
                            : '—'}
                          {inspectedUser.communeName ? ` / ${inspectedUser.communeName}` : ''}
                        </strong>
                      </span>
                    </div>
                    <div>التخصص: <strong>{inspectedUser.specialty || '—'}</strong></div>
                    <div>سنة التخرج: <strong className="font-mono-tabular">{inspectedUser.graduationYear || '—'}</strong></div>
                    <div>المؤسسة الجامعية: <strong>{inspectedUser.institutionName || '—'}</strong></div>
                    <div>المستوى / الشهادة: <strong>{inspectedUser.degreeLevel || '—'}</strong></div>
                    <div>تاريخ التسجيل: <strong className="font-mono-tabular">{new Date(inspectedUser.createdAt).toLocaleString('ar-DZ')}</strong></div>
                    <div>
                      آخر دخول:{' '}
                      <strong className="font-mono-tabular">
                        {inspectedUser.lastLoginAt
                          ? new Date(inspectedUser.lastLoginAt).toLocaleString('ar-DZ')
                          : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                {(inspectedUser.bio || inspectedUser.skills || inspectedUser.experience || inspectedUser.extraInfo) && (
                  <div className="rounded-xl bg-[#F3F6F8] dark:bg-[#0b202e] p-4 space-y-2">
                    {inspectedUser.bio && (
                      <div><strong>النبذة:</strong> {inspectedUser.bio}</div>
                    )}
                    {inspectedUser.skills && (
                      <div><strong>المهارات:</strong> {inspectedUser.skills}</div>
                    )}
                    {inspectedUser.experience && (
                      <div><strong>الخبرات:</strong> {inspectedUser.experience}</div>
                    )}
                    {inspectedUser.extraInfo && (
                      <div><strong>معلومات إضافية:</strong> {inspectedUser.extraInfo}</div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#dce4ea] dark:border-[#1e465f]">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        exportToXlsx(
                          `GTU-member-${inspectedUser.nationalMemberNumber}`,
                          inspectedUser.username,
                          toMemberExportRows([inspectedUser])
                        )
                      }
                      className="px-3.5 py-2 rounded-lg bg-[#27866F] text-white font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تنزيل ملف العضو (Excel)</span>
                    </button>
                    {canManageUsers &&
                      (inspectedUser.roleSlug !== 'super_admin' || user.roleSlug === 'super_admin') && (
                        <button
                          type="button"
                          onClick={() => {
                            setPasswordModalUser(inspectedUser);
                            setNewPasswordInput('');
                          }}
                          className="px-3.5 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-[#D3AD68]" />
                          <span>تعيين كلمة مرور</span>
                        </button>
                      )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectedUser(null)}
                    className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] cursor-pointer"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL: ADMIN RESET PASSWORD ==================== */}
      {passwordModalUser && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleAdminResetPassword}
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#27866F]" />
                <span>تعيين كلمة مرور: @{passwordModalUser.username}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPasswordModalUser(null)}
                className="cursor-pointer text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">كلمة المرور الجديدة (8 أحرف على الأقل)</label>
              <input
                type="text"
                required
                minLength={8}
                placeholder="أدخل كلمة المرور الجديدة..."
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] font-mono-tabular"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasswordModalUser(null)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer"
              >
                حفظ كلمة المرور
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: CREATE NEW USER / ADMIN BY ADMIN ==================== */}
      {showNewUserModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateUserByAdmin}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#27866F]" />
                <span>إضافة عضو أو مسؤول جديد مباشرة</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowNewUserModal(false)}
                className="cursor-pointer text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">الاسم *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.firstName}
                  onChange={(e) => setNewUserForm({ ...newUserForm, firstName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">اللقب *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.lastName}
                  onChange={(e) => setNewUserForm({ ...newUserForm, lastName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">اسم المستخدم (إنجليزي) *</label>
                <input
                  type="text"
                  required
                  value={newUserForm.username}
                  onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">كلمة المرور (8+ أحرف) *</label>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  value={newUserForm.phone}
                  onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">ولاية الإقامة</label>
                <select
                  value={newUserForm.residenceWilayaCode}
                  onChange={(e) =>
                    setNewUserForm({ ...newUserForm, residenceWilayaCode: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                >
                  {wilayas.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.code} - {w.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">الدور الوظيفي</label>
                <select
                  value={newUserForm.roleSlug}
                  onChange={(e) => setNewUserForm({ ...newUserForm, roleSlug: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                >
                  {rolesList
                    .filter((r) => r.slug !== 'super_admin' || user.roleSlug === 'super_admin')
                    .map((r) => (
                      <option key={r.slug} value={r.slug}>
                        {r.nameAr}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">التخصص</label>
                <input
                  type="text"
                  value={newUserForm.specialty}
                  onChange={(e) => setNewUserForm({ ...newUserForm, specialty: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">سنة التخرج</label>
                <input
                  type="number"
                  value={newUserForm.graduationYear}
                  onChange={(e) =>
                    setNewUserForm({ ...newUserForm, graduationYear: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewUserModal(false)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#27866F] text-white font-bold cursor-pointer"
              >
                إنشاء الحساب
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
