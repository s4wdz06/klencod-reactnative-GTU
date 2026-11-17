import React, { useEffect, useState } from 'react';
import {
  Award,
  Calendar,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  Megaphone,
  MessageSquare,
  Shield,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import {
  AnnouncementItem,
  Commune,
  DashboardStats,
  EventItem,
  ProposalItem,
  Wilaya,
} from '../types/gtu.ts';
import { CohortYearChart, GrowthChart, WilayaDistributionChart } from '../components/Charts.tsx';
import { AppRoute } from './LandingPage.tsx';

export const DashboardPage: React.FC<{ onNavigate: (r: AppRoute) => void }> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [myProposals, setMyProposals] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiRequest<DashboardStats>('/api/dashboard/stats'),
      apiRequest<{ announcements: AnnouncementItem[] }>('/api/announcements'),
      apiRequest<{ events: EventItem[] }>('/api/events'),
      apiRequest<{ proposals: ProposalItem[] }>('/api/proposals'),
    ])
      .then(([s, a, e, p]) => {
        setStats(s);
        setAnnouncements(a.announcements.slice(0, 4));
        setEvents(e.events.slice(0, 4));
        setMyProposals(p.proposals.filter((item) => item.authorId === user?.id).slice(0, 4));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) {
    return <div className="p-10 text-center text-sm text-slate-500">جاري تحميل مؤشرات لوحة القيادة الوطنية...</div>;
  }

  const kpis = stats?.kpis;

  return (
    <div className="space-y-6">
      {/* Personal Member Summary Banner */}
      <div className="rounded-xl bg-[#102D40] text-white p-6 flex flex-wrap items-center justify-between gap-4 border border-[#1e465f]">
        <div className="space-y-1">
          <div className="text-xs text-[#D3AD68] font-medium">
            {user?.roleNameAr} · رقم العضوية{' '}
            <span className="font-mono-tabular">{user?.nationalMemberNumber}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold font-display">
            مرحباً، {user?.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user?.username}
          </h1>
          <div className="text-xs text-slate-300 flex flex-wrap items-center gap-3">
            <span>{user?.residenceWilaya ? `ولاية ${user.residenceWilaya.nameAr}` : ''}</span>
            {user?.residenceCommune && <span>· بلدية {user.residenceCommune.nameAr}</span>}
            {user?.graduation && <span>· دفعة {user.graduation.graduationYear}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('groups')}
            className="px-4 py-2 rounded-lg bg-[#173D53] hover:bg-[#1e4d68] text-xs font-medium border border-[#2c5d7a] cursor-pointer"
          >
            المجموعات الولائية
          </button>
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            className="px-4 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-xs font-bold cursor-pointer"
          >
            الشات الوطني ({kpis?.messagesCount ?? 0})
          </button>
        </div>
      </div>

      {/* 9 National KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'إجمالي الخريجين', val: kpis?.totalGraduates ?? 0 },
          { label: 'الولايات الممثلة', val: `${kpis?.representedWilayas ?? 0} / 58` },
          { label: 'البلديات الممثلة', val: `${kpis?.representedCommunes ?? 0} / 1541` },
          { label: 'الأعضاء النشطون (30 يوم)', val: kpis?.activeMembers ?? 0 },
          { label: 'الأعضاء الجدد (30 يوم)', val: kpis?.newMembers ?? 0 },
          { label: 'الاقتراحات', val: kpis?.proposalsCount ?? 0 },
          { label: 'المبادرات', val: kpis?.initiativesCount ?? 0 },
          { label: 'اللقاءات والمواعيد', val: kpis?.eventsCount ?? 0 },
          { label: 'الرسائل المنشورة', val: kpis?.messagesCount ?? 0 },
          { label: 'إشعارات غير مقروءة', val: user?.unreadNotifications ?? 0 },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4"
          >
            <div className="text-xl font-bold text-[#102D40] dark:text-white font-mono-tabular">
              {kpi.val}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7">
            <GrowthChart
              daily={stats.growth.daily}
              monthly={stats.growth.monthly}
              yearly={stats.growth.yearly}
            />
          </div>
          <div className="lg:col-span-5">
            <WilayaDistributionChart items={stats.byWilaya} />
          </div>
          <div className="lg:col-span-12">
            <CohortYearChart items={stats.byGraduationYear} />
          </div>
        </div>
      )}

      {/* Personal Activity & Latest Updates */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#102D40] dark:text-white flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-[#D3AD68]" />
              <span>أحدث الإعلانات الرسمية</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('announcements')}
              className="text-xs text-[#27866F] hover:underline cursor-pointer"
            >
              الكل
            </button>
          </div>
          <div className="space-y-3">
            {announcements.length === 0 ? (
              <p className="text-xs text-slate-400">لا توجد إعلانات.</p>
            ) : (
              announcements.map((a) => (
                <div key={a.id} className="border-b border-[#dce4ea] dark:border-[#1e465f] last:border-0 pb-2.5">
                  <div className="text-xs font-semibold text-[#102D40] dark:text-white">{a.title}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-0.5">
                    {new Date(a.publishedAt).toLocaleDateString('ar-DZ')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#102D40] dark:text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#27866F]" />
              <span>المواعيد واللقاءات القادمة</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('events')}
              className="text-xs text-[#27866F] hover:underline cursor-pointer"
            >
              الكل
            </button>
          </div>
          <div className="space-y-3">
            {events.length === 0 ? (
              <p className="text-xs text-slate-400">لا توجد فعاليات قادمة.</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="border-b border-[#dce4ea] dark:border-[#1e465f] last:border-0 pb-2.5">
                  <div className="text-xs font-semibold text-[#102D40] dark:text-white">{e.title}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-0.5">
                    {e.eventType} · {new Date(e.eventDate).toLocaleDateString('ar-DZ')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-[#102D40] dark:text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#173D53] dark:text-[#D3AD68]" />
              <span>اقتراحاتك المرسلة</span>
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('proposals')}
              className="text-xs text-[#27866F] hover:underline cursor-pointer"
            >
              تقديم اقتراح
            </button>
          </div>
          <div className="space-y-3">
            {myProposals.length === 0 ? (
              <p className="text-xs text-slate-400">لم ترسل اقتراحات بعد.</p>
            ) : (
              myProposals.map((p) => (
                <div key={p.id} className="border-b border-[#dce4ea] dark:border-[#1e465f] last:border-0 pb-2.5">
                  <div className="text-xs font-semibold text-[#102D40] dark:text-white">{p.title}</div>
                  <div className="text-[11px] text-[#27866F] mt-0.5">الحالة: {p.status}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ProfilePage: React.FC<{ onNavigate: (r: AppRoute) => void }> = ({ onNavigate }) => {
  const { user, refreshUser, logout } = useAuth();
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [sessions, setSessions] = useState<Array<{ id: number; deviceInfo: string; createdAt: string; isCurrent: boolean }>>([]);
  const [activity, setActivity] = useState<{ messagesCount: number; proposals: any[]; events: any[] } | null>(null);

  const [form, setForm] = useState({
    firstName: user?.profile?.firstName || '',
    lastName: user?.profile?.lastName || '',
    phone: user?.profile?.phone || '',
    email: user?.email || '',
    bio: user?.profile?.bio || '',
    skills: user?.profile?.skills || '',
    experience: user?.profile?.experience || '',
    specialty: user?.graduation?.specialty || 'تقنيات حضرية',
    graduationYear: String(user?.graduation?.graduationYear || ''),
    institutionName: user?.graduation?.institutionName || '',
    residenceWilayaCode: user?.residenceWilaya?.code || '',
    residenceCommuneId: String(user?.residenceCommune?.id || ''),
    privacyShowPhone: user?.profile?.privacyShowPhone ?? false,
    privacyShowBirthDate: user?.profile?.privacyShowBirthDate ?? false,
    privacyShowEmail: user?.profile?.privacyShowEmail ?? false,
    privacyAllowDm: user?.profile?.privacyAllowDm ?? true,
    notifyMessages: user?.profile?.notifyMessages ?? true,
    notifyAnnouncements: user?.profile?.notifyAnnouncements ?? true,
    notifyEvents: user?.profile?.notifyEvents ?? true,
    notifyProposals: user?.profile?.notifyProposals ?? true,
    avatarDataUrl: '',
  });

  const [passForm, setPassForm] = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
    apiRequest<{ sessions: any[] }>('/api/auth/sessions').then((d) => setSessions(d.sessions)).catch(() => {});
    apiRequest<any>('/api/profile/activity').then(setActivity).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.residenceWilayaCode) return;
    apiRequest<{ communes: Commune[] }>(`/api/wilayas/${form.residenceWilayaCode}/communes`)
      .then((d) => setCommunes(d.communes))
      .catch(() => {});
  }, [form.residenceWilayaCode]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('');
    setErrorMsg('');
    try {
      await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          ...form,
          residenceCommuneId: form.residenceCommuneId ? Number(form.residenceCommuneId) : undefined,
          graduationYear: form.graduationYear ? Number(form.graduationYear) : undefined,
        }),
      });
      await refreshUser();
      setStatusMsg('تم حفظ تحديثات الملف الشخصي وإعدادات الخصوصية بنجاح.');
    } catch (err: any) {
      setErrorMsg(err.message || 'تعذر حفظ التعديلات');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('');
    setErrorMsg('');
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(passForm),
      });
      setPassForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
      setStatusMsg('تم تغيير كلمة المرور بنجاح.');
    } catch (err: any) {
      setErrorMsg(err.message || 'تعذر تغيير كلمة المرور');
    }
  };

  const handleRevokeSession = async (id: number) => {
    await apiRequest(`/api/auth/sessions/${id}`, { method: 'DELETE' });
    setSessions((s) => s.filter((item) => item.id !== id));
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm('هل أنت متأكد من حذف حسابك نهائياً من منصة GTU؟ لا يمكن التراجع عن هذا الإجراء.')) {
      return;
    }
    await apiRequest('/api/account', { method: 'DELETE' });
    await logout();
    onNavigate('landing');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {user?.profile?.avatarUrl ? (
            <img
              src={user.profile.avatarUrl}
              alt={user.username}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-xl object-cover border border-[#dce4ea]"
            />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-[#102D40] text-[#D3AD68] flex items-center justify-center font-bold text-xl">
              {user?.profile?.firstName?.slice(0, 1) || 'G'}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-[#102D40] dark:text-white">
              {user?.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user?.username}
            </h1>
            <div className="text-xs text-slate-500 dark:text-slate-300 mt-1 flex flex-wrap gap-2">
              <span className="font-mono-tabular font-semibold text-[#27866F]">{user?.nationalMemberNumber}</span>
              <span>·</span>
              <span>انضم في {user ? new Date(user.createdAt).toLocaleDateString('ar-DZ') : ''}</span>
              <span>·</span>
              <span>{user?.roleNameAr}</span>
            </div>
          </div>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-300 flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Award className="w-4 h-4 text-[#D3AD68]" />
            دفعة {user?.graduation?.graduationYear}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-4 h-4 text-[#27866F]" />
            {user?.residenceWilaya?.nameAr}
          </span>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      <form
        onSubmit={handleSaveProfile}
        className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 space-y-6"
      >
        <h2 className="text-base font-bold text-[#102D40] dark:text-white flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-[#27866F]" />
          <span>تحديث البيانات الشخصية والمهنية ومكان الإقامة</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1">الاسم</label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">اللقب</label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">رقم الهاتف</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">ولاية الإقامة</label>
            <select
              value={form.residenceWilayaCode}
              onChange={(e) => setForm({ ...form, residenceWilayaCode: e.target.value, residenceCommuneId: '' })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              <option value="">اختر الولاية</option>
              {wilayas.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} - {w.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">بلدية الإقامة</label>
            <select
              value={form.residenceCommuneId}
              onChange={(e) => setForm({ ...form, residenceCommuneId: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              <option value="">اختر البلدية</option>
              {communes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">تحديث الصورة الشخصية</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const r = new FileReader();
                r.onload = () => setForm({ ...form, avatarDataUrl: String(r.result || '') });
                r.readAsDataURL(file);
              }}
              className="w-full text-xs text-slate-500 file:ml-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-[#173D53] file:text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1">نبذة مهنية</label>
            <textarea
              rows={3}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="مثال: مهندس دولة في التقنيات الحضرية، مهتم بالتهيئة العمرانية ونظم المعلومات الجغرافية GIS..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">المهارات والخبرات المهنية</label>
            <textarea
              rows={3}
              value={form.skills}
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
              placeholder="AutoCAD, QGIS, التعمير، تسيير الشبكات الحضرية..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
        </div>

        {/* Privacy & Notification Preferences */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[#dce4ea] dark:border-[#1e465f]">
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-[#102D40] dark:text-[#D3AD68] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>إعدادات الخصوصية (الافتراضي: مخفي عن الأعضاء)</span>
            </h3>
            {(
              [
                ['privacyShowPhone', 'إظهار رقم الهاتف للأعضاء المسجلين'],
                ['privacyShowBirthDate', 'إظهار تاريخ الميلاد للأعضاء المسجلين'],
                ['privacyShowEmail', 'إظهار البريد الإلكتروني في الدليل'],
                ['privacyAllowDm', 'السماح للأعضاء بمراسلتي عبر الرسائل الخاصة'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
                  className="accent-[#102D40]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-[#102D40] dark:text-[#D3AD68] flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span>تفضيلات الإشعارات</span>
            </h3>
            {(
              [
                ['notifyMessages', 'إشعارات الرسائل الجديدة'],
                ['notifyAnnouncements', 'إشعارات الإعلانات الوطنية والولائية'],
                ['notifyEvents', 'تذكيرات المواعيد والفعاليات'],
                ['notifyProposals', 'تحديثات الرد على الاقتراحات'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
                  className="accent-[#27866F]"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 rounded-lg bg-[#102D40] hover:bg-[#173D53] text-white text-sm font-bold cursor-pointer"
        >
          حفظ تعديلات الملف الشخصي
        </button>
      </form>

      {/* Password, Sessions & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleChangePassword}
          className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3"
        >
          <h3 className="text-sm font-bold text-[#102D40] dark:text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#D3AD68]" />
            <span>تغيير كلمة المرور</span>
          </h3>
          <input
            type="password"
            required
            placeholder="كلمة المرور الحالية"
            value={passForm.currentPassword}
            onChange={(e) => setPassForm({ ...passForm, currentPassword: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="كلمة المرور الجديدة"
            value={passForm.newPassword}
            onChange={(e) => setPassForm({ ...passForm, newPassword: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="تأكيد كلمة المرور الجديدة"
            value={passForm.confirmNewPassword}
            onChange={(e) => setPassForm({ ...passForm, confirmNewPassword: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[#173D53] hover:bg-[#102D40] text-white text-xs font-bold cursor-pointer"
          >
            تحديث كلمة المرور
          </button>
        </form>

        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4">
          <h3 className="text-sm font-bold text-[#102D40] dark:text-white">إدارة الجلسات النشطة ونشاطك</h3>
          {activity && (
            <div className="text-xs text-slate-600 dark:text-slate-300 flex gap-4 pb-3 border-b border-[#dce4ea] dark:border-[#1e465f]">
              <span>الرسائل: {activity.messagesCount}</span>
              <span>الاقتراحات: {activity.proposals.length}</span>
              <span>الفعاليات: {activity.events.length}</span>
            </div>
          )}
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] text-xs"
              >
                <div>
                  <div className="font-medium truncate max-w-[220px]">{s.deviceInfo}</div>
                  <div className="text-[11px] text-slate-500">
                    {new Date(s.createdAt).toLocaleString('ar-DZ')}
                    {s.isCurrent ? ' · الجلسة الحالية' : ''}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.id)}
                    className="text-red-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>إنهاء</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between">
            <span className="text-xs text-slate-500">حذف الحساب نهائياً وفق سياسة الخصوصية</span>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>حذف الحساب</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
