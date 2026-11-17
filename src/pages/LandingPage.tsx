import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, Calendar, Compass, MapPin, Megaphone, ShieldCheck, Users } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { AnnouncementItem, EventItem, Wilaya } from '../types/gtu.ts';
import { AlgeriaInteractiveMap } from '../components/AlgeriaMap.tsx';
import { PWAInstallButton } from '../components/PWAComponents.tsx';

export type AppRoute =
  | 'landing'
  | 'login'
  | 'register'
  | 'dashboard'
  | 'profile'
  | 'directory'
  | 'map'
  | 'wilayas'
  | 'communes'
  | 'chat'
  | 'groups'
  | 'dm'
  | 'proposals'
  | 'initiatives'
  | 'events'
  | 'announcements'
  | 'notifications'
  | 'reports'
  | 'admin'
  | 'admin_users'
  | 'admin_roles'
  | 'admin_settings'
  | 'privacy'
  | 'terms'
  | 'search';

interface OverviewResponse {
  settings: Record<string, string>;
  stats: {
    totalGraduates: number;
    representedWilayas: number;
    representedCommunes: number;
    totalProposals: number;
    totalEvents: number;
    totalMessages: number;
    totalWilayas: number;
    totalCommunes: number;
  };
  recentAnnouncements: AnnouncementItem[];
  upcomingEvents: EventItem[];
}

export const LandingPage: React.FC<{
  onNavigate: (route: AppRoute) => void;
  isAuthenticated: boolean;
  onEnterAdmin?: () => void;
}> = ({ onNavigate, isAuthenticated, onEnterAdmin }) => {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);

  useEffect(() => {
    apiRequest<OverviewResponse>('/api/public/overview').then(setOverview).catch(() => {});
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, []);

  const settings = overview?.settings || {};
  const stats = overview?.stats;

  return (
    <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] text-[#172B38] dark:text-slate-100">
      {/* Top Bar Contract: Exactly 3 zones */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#102D40]/95 backdrop-blur border-b border-[#dce4ea] dark:border-[#1e465f]">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => onNavigate('landing')}
            className="text-lg font-extrabold tracking-tight text-[#102D40] dark:text-white whitespace-nowrap shrink-0 cursor-pointer font-display"
          >
            GTU الجزائر
          </button>

          {/* Zone 2: 4–5 concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#173D53] dark:text-slate-200">
            <a href="#vision" className="hover:text-[#102D40] dark:hover:text-[#D3AD68] whitespace-nowrap shrink-0 transition-colors">
              الرسالة الوطنية
            </a>
            <a href="#map-section" className="hover:text-[#102D40] dark:hover:text-[#D3AD68] whitespace-nowrap shrink-0 transition-colors">
              الخريطة الوطنية
            </a>
            <a href="#announcements-section" className="hover:text-[#102D40] dark:hover:text-[#D3AD68] whitespace-nowrap shrink-0 transition-colors">
              الإعلانات
            </a>
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="hover:text-[#102D40] dark:hover:text-[#D3AD68] whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              {isAuthenticated ? 'لوحة القيادة' : 'تسجيل الدخول'}
            </button>
            {onEnterAdmin && (
              <button
                type="button"
                onClick={onEnterAdmin}
                className="inline-flex items-center gap-1 text-[#102D40] dark:text-[#D3AD68] hover:text-[#27866F] font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#D3AD68]" />
                <span>لوحة الإدارة</span>
              </button>
            )}
          </nav>

          {/* Zone 3: 1 primary CTA action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => onNavigate(isAuthenticated ? 'dashboard' : 'register')}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#102D40] hover:bg-[#173D53] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer border border-[#D3AD68]/40"
            >
              {isAuthenticated ? 'دخول المنصة' : 'تسجيل عضوية مجانية'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-[#102D40] text-white border-b border-[#1e465f]">
        <div className="max-w-7xl mx-auto px-6 py-14 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <div className="flex items-center gap-3 text-xs text-[#D3AD68] font-medium">
              <span>الجمهورية الجزائرية الديمقراطية الشعبية</span>
              <span aria-hidden="true">·</span>
              <span>المنصة الرسمية GTU</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold leading-tight font-display [text-wrap:balance]">
              {settings.hero_title || 'المنصة الوطنية لخريجي التقنيات الحضرية في الجزائر'}
            </h1>

            <p className="text-base text-slate-200 leading-relaxed max-w-2xl">
              {settings.hero_subtitle ||
                'فضاء رقمي مؤسساتي يجمع خريجي تخصص التقنيات الحضرية عبر 58 ولاية و1541 بلدية لتنسيق المبادرات المهنية، توثيق المسارات الأكاديمية، وتبادل الخبرات الميدانية.'}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate(isAuthenticated ? 'dashboard' : 'register')}
                className="px-6 py-3 rounded-lg bg-[#D3AD68] hover:bg-[#c59d56] text-[#102D40] text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-2"
              >
                <span>{isAuthenticated ? 'الانتقال إلى لوحة القيادة' : 'إنشاء حساب وطني مجاني'}</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('login')}
                className="px-5 py-3 rounded-lg border border-white/25 hover:bg-white/10 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                تسجيل الدخول
              </button>
              <PWAInstallButton variant="header" />
            </div>
          </div>

          <div className="lg:col-span-6 flex">
            <div className="w-full rounded-xl overflow-hidden border border-[#24526e] bg-[#173D53] relative min-h-[280px]">
              <img
                src="/src/assets/images/hero_urban_algeria_1794833538743.jpg"
                alt="التخطيط العمراني المستدام في الجزائر"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#102D40]/75 via-transparent to-transparent" />
              <div className="absolute bottom-4 right-4 left-4 flex items-center justify-between text-xs text-white/90">
                <span>الهندسة والتقنيات الحضرية · رؤية وطنية موحدة</span>
                <span className="font-mono-tabular text-[#D3AD68]">58 WILAYAS</span>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width Real-Time KPI Strip */}
        <div className="border-t border-[#1e465f] bg-[#0b202e]">
          <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <div className="text-2xl font-bold text-white tabular-nums font-mono-tabular">
                {stats ? stats.totalGraduates : '—'}
              </div>
              <div className="text-xs text-slate-300 mt-1">خريج مسجل في المنصة</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#D3AD68] tabular-nums font-mono-tabular">
                {stats ? `${stats.representedWilayas} / 58` : '58'}
              </div>
              <div className="text-xs text-slate-300 mt-1">الولايات الممثلة</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#27866F] tabular-nums font-mono-tabular">
                {stats ? `${stats.representedCommunes} / 1541` : '1541'}
              </div>
              <div className="text-xs text-slate-300 mt-1">البلديات الإدارية الرسمية</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white tabular-nums font-mono-tabular">
                {stats ? stats.totalProposals + stats.totalEvents : '—'}
              </div>
              <div className="text-xs text-slate-300 mt-1">مبادرة وفعالية وطنية</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Institutional Pillars */}
      <section id="vision" className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5">
            <div className="rounded-xl overflow-hidden border border-[#dce4ea] dark:border-[#1e465f] bg-[#102D40] aspect-square max-w-[360px] mx-auto">
              <img
                src="/src/assets/images/gtu_emblem_badge_1794833540044.jpg"
                alt="الختم المؤسساتي لمنصة GTU"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div>
              <div className="text-xs font-semibold text-[#27866F] mb-2">ركائز البنية المؤسساتية لـ GTU</div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#102D40] dark:text-white font-display">
                مجتمع وطني موحد لخريجي التقنيات الحضرية
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="p-5 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f]">
                <Users className="w-5 h-5 text-[#102D40] dark:text-[#D3AD68] mb-3" />
                <h3 className="text-sm font-bold text-[#102D40] dark:text-white mb-1">01. الدليل الوطني المحمي</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  رقم عضوية وطني فريد لكل خريج مع حماية كاملة لبيانات الهاتف وتاريخ الميلاد، وبحث متقدم حسب الولاية والبلدية وسنة التخرج.
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f]">
                <Compass className="w-5 h-5 text-[#27866F] mb-3" />
                <h3 className="text-sm font-bold text-[#102D40] dark:text-white mb-1">02. التغطية الجغرافية الدقيقة</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  ربط إداري معتمد يضم 58 ولاية و1541 بلدية جزائرية مع 58 مجموعة ولائية للتنسيق المحلي.
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f]">
                <Building2 className="w-5 h-5 text-[#D3AD68] mb-3" />
                <h3 className="text-sm font-bold text-[#102D40] dark:text-white mb-1">03. المبادرات والملتقيات</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  فضاء رسمي لتقديم المقترحات المهنية وتتبع مراحل دراستها، وتنظيم الأيام الدراسية ولقاءات لم الشمل.
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f]">
                <ShieldCheck className="w-5 h-5 text-[#27866F] mb-3" />
                <h3 className="text-sm font-bold text-[#102D40] dark:text-white mb-1">04. الشات الفوري والعمل دون اتصال</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  تواصل مباشر في الشات الوطني والمجموعات الولائية مع دعم PWA ومزامنة تلقائية للمسودات والرسائل.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive National Map Preview */}
      <section id="map-section" className="bg-white dark:bg-[#0c2231] border-y border-[#dce4ea] dark:border-[#1e465f] py-16">
        <div className="max-w-7xl mx-auto px-6 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-[#27866F] mb-1">التوزيع الترابي المباشر</div>
              <h2 className="text-2xl font-bold text-[#102D40] dark:text-white font-display">
                الخريطة الوطنية التفاعلية لخريجي التقنيات الحضرية
              </h2>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-300 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-[#D3AD68]" />
              <span>اضغط على أي ولاية لاستعراض بلدياتها وإحصائياتها</span>
            </div>
          </div>

          <AlgeriaInteractiveMap wilayas={wilayas} isAuthenticated={isAuthenticated} />
        </div>
      </section>

      {/* Forum Visual & Announcements / Events */}
      <section id="announcements-section" className="max-w-7xl mx-auto px-6 py-16 space-y-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-5 rounded-xl overflow-hidden border border-[#dce4ea] dark:border-[#1e465f] min-h-[260px]">
            <img
              src="/src/assets/images/urban_forum_banner_1794833539754.jpg"
              alt="لقاءات ومبادرات مهندسي التقنيات الحضرية"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent Announcements */}
            <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#102D40] dark:text-white flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-[#D3AD68]" />
                  <span>أحدث البيانات الرسمية</span>
                </h3>
              </div>
              <div className="space-y-4 flex-1">
                {(overview?.recentAnnouncements || []).length === 0 ? (
                  <p className="text-xs text-slate-400">لا توجد بيانات منشورة حالياً.</p>
                ) : (
                  overview!.recentAnnouncements.map((ann) => (
                    <div key={ann.id} className="border-b border-[#dce4ea] dark:border-[#1e465f] last:border-0 pb-3 last:pb-0">
                      <div className="text-[11px] text-slate-500 dark:text-slate-300 mb-1">
                        {ann.isPinned ? 'مثبت · ' : ''}
                        {new Date(ann.publishedAt).toLocaleDateString('ar-DZ')}
                      </div>
                      <div className="text-sm font-semibold text-[#102D40] dark:text-white">{ann.title}</div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">{ann.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Upcoming Events */}
            <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#102D40] dark:text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#27866F]" />
                  <span>الفعاليات والملتقيات القادمة</span>
                </h3>
              </div>
              <div className="space-y-4 flex-1">
                {(overview?.upcomingEvents || []).length === 0 ? (
                  <p className="text-xs text-slate-400">لا توجد فعاليات مبرمجة حالياً.</p>
                ) : (
                  overview!.upcomingEvents.map((ev) => (
                    <div key={ev.id} className="border-b border-[#dce4ea] dark:border-[#1e465f] last:border-0 pb-3 last:pb-0">
                      <div className="text-[11px] text-[#27866F] font-medium mb-1">
                        {ev.eventType} · {new Date(ev.eventDate).toLocaleDateString('ar-DZ')}
                      </div>
                      <div className="text-sm font-semibold text-[#102D40] dark:text-white">{ev.title}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">{ev.location}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Institutional Footer */}
      <footer className="bg-[#102D40] text-slate-300 border-t border-[#1e465f]">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div>
            <div className="font-bold text-white text-sm">
              GTU – المنصة الوطنية لخريجي التقنيات الحضرية
            </div>
            <div className="mt-1 text-slate-400">
              الجمهورية الجزائرية الديمقراطية الشعبية · {settings.contact_email || 'contact@gtu-algeria.dz'}
            </div>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => onNavigate('privacy')}
              className="hover:text-white cursor-pointer"
            >
              سياسة الخصوصية
            </button>
            <button
              type="button"
              onClick={() => onNavigate('terms')}
              className="hover:text-white cursor-pointer"
            >
              شروط الاستخدام
            </button>
            <button
              type="button"
              onClick={() => onNavigate('register')}
              className="text-[#D3AD68] hover:underline cursor-pointer"
            >
              انضم إلينا
            </button>
            {onEnterAdmin && (
              <button
                type="button"
                onClick={onEnterAdmin}
                className="inline-flex items-center gap-1.5 text-[#D3AD68] hover:text-white font-semibold cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>لوحة تحكم الإدارة المستقلة</span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};
