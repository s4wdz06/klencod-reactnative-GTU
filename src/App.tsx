import React, { useEffect, useState } from 'react';
import {
  Bell,
  Building2,
  Calendar,
  Compass,
  FileText,
  Home,
  Lightbulb,
  LogOut,
  Map as MapIcon,
  Megaphone,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Shield,
  Sun,
  User,
  Users,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import {
  OfflineIndicator,
  PWAInstallButton,
  PushNotificationBanner,
} from './components/PWAComponents.tsx';
import { AppRoute, LandingPage } from './pages/LandingPage.tsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.tsx';
import { DashboardPage, ProfilePage } from './pages/DashboardAndProfile.tsx';
import { DirectoryPage, NationalMapPage, WilayasAndCommunesPage } from './pages/DirectoryAndGeo.tsx';
import { ChatWorkspacePage } from './pages/ChatWorkspace.tsx';
import {
  AnnouncementsPage,
  EventsPage,
  NotificationsPage,
  ProposalsAndInitiativesPage,
} from './pages/CommunityPages.tsx';
import { ReportsPage } from './pages/AdminAndReports.tsx';
import { AdminPortal } from './pages/AdminPortal.tsx';
import { LegalPage, UnifiedSearchPage } from './pages/LegalAndSearch.tsx';
import { apiRequest } from './lib/api.ts';
import { hasUserPermission } from './types/gtu.ts';

const GTUShell: React.FC<{ onEnterAdmin: () => void }> = ({ onEnterAdmin }) => {
  const { user, loading, theme, toggleTheme, logout } = useAuth();
  const [route, setRoute] = useState<AppRoute>(() => {
    if (typeof window === 'undefined') return 'landing';
    const qRoute = new URLSearchParams(window.location.search).get('route') as AppRoute | null;
    return qRoute || 'landing';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [directConvId, setDirectConvId] = useState<number | null>(null);

  const navigate = (next: AppRoute) => {
    if (
      next === 'admin' ||
      next === 'admin_users' ||
      next === 'admin_roles' ||
      next === 'admin_settings'
    ) {
      setMobileMenuOpen(false);
      onEnterAdmin();
      return;
    }
    setRoute(next);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartDirectChat = async (targetUserId: number) => {
    try {
      const res = await apiRequest<{ conversation: { id: number } }>('/api/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
      setDirectConvId(res.conversation.id);
      navigate('dm');
    } catch (err: any) {
      window.alert(err.message || 'تعذر فتح المحادثة الخاصة');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F3F6F8] dark:bg-[#071620] text-[#102D40] dark:text-white text-sm">
        جاري تحميل المنصة الوطنية GTU...
      </div>
    );
  }

  // Public views or Google profile completion
  if (user?.needsProfileCompletion && route !== 'privacy' && route !== 'terms') {
    return (
      <>
        <RegisterPage onNavigate={navigate} />
        <OfflineIndicator />
      </>
    );
  }

  if (route === 'privacy' || route === 'terms') {
    return (
      <>
        <LegalPage mode={route} onNavigate={navigate} />
        <OfflineIndicator />
      </>
    );
  }

  if (!user) {
    if (route === 'login') {
      return (
        <>
          <LoginPage onNavigate={navigate} onEnterAdmin={onEnterAdmin} />
          <OfflineIndicator />
        </>
      );
    }
    if (route === 'register') {
      return (
        <>
          <RegisterPage onNavigate={navigate} />
          <OfflineIndicator />
        </>
      );
    }
    return (
      <>
        <LandingPage onNavigate={navigate} isAuthenticated={false} onEnterAdmin={onEnterAdmin} />
        <OfflineIndicator />
      </>
    );
  }

  // Authenticated user viewing public landing explicitly
  if (route === 'landing') {
    return (
      <>
        <LandingPage onNavigate={navigate} isAuthenticated={true} onEnterAdmin={onEnterAdmin} />
        <OfflineIndicator />
      </>
    );
  }

  // If user just logged in while route was 'login' or 'register', show dashboard
  const effectiveRoute: AppRoute = route === 'login' || route === 'register' ? 'dashboard' : route;

  const canEnterAdminPortal = hasUserPermission(
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
  const canReports = hasUserPermission(user, 'export_reports');

  const rawNavItems: Array<{ id: AppRoute; label: string; icon: React.ReactNode; show?: boolean }> = [
    { id: 'dashboard', label: 'لوحة القيادة', icon: <Home className="w-4 h-4" /> },
    { id: 'directory', label: 'دليل الخريجين', icon: <Users className="w-4 h-4" /> },
    { id: 'map', label: 'الخريطة الوطنية', icon: <MapIcon className="w-4 h-4" /> },
    { id: 'wilayas', label: 'الولايات (58)', icon: <Compass className="w-4 h-4" /> },
    { id: 'communes', label: 'البلديات (1541)', icon: <Building2 className="w-4 h-4" /> },
    { id: 'chat', label: 'الشات الوطني', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'groups', label: 'المجموعات الولائية', icon: <Users className="w-4 h-4" /> },
    { id: 'dm', label: 'المحادثات الخاصة', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'proposals', label: 'الاقتراحات', icon: <Lightbulb className="w-4 h-4" /> },
    { id: 'initiatives', label: 'المبادرات', icon: <Lightbulb className="w-4 h-4" /> },
    { id: 'events', label: 'المواعيد والفعاليات', icon: <Calendar className="w-4 h-4" /> },
    { id: 'announcements', label: 'الإعلانات والأخبار', icon: <Megaphone className="w-4 h-4" /> },
    { id: 'notifications', label: `الإشعارات (${user.unreadNotifications})`, icon: <Bell className="w-4 h-4" /> },
    { id: 'search', label: 'البحث الموحد', icon: <Search className="w-4 h-4" /> },
    { id: 'profile', label: 'ملفي الشخصي', icon: <User className="w-4 h-4" /> },
    { id: 'reports', label: 'التقارير والتصدير', icon: <FileText className="w-4 h-4" />, show: canReports },
  ];
  const navItems = rawNavItems.filter((item) => item.show !== false);

  return (
    <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] text-[#172B38] dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#102D40] text-white border-l border-[#1e465f] shrink-0 no-print">
        <div className="p-5 border-b border-[#1e465f]">
          <button
            type="button"
            onClick={() => navigate('landing')}
            className="text-right w-full cursor-pointer"
          >
            <div className="text-lg font-extrabold font-display tracking-tight text-white">
              GTU الجزائر
            </div>
            <div className="text-[11px] text-[#D3AD68] mt-0.5">
              المنصة الوطنية لخريجي التقنيات الحضرية
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                effectiveRoute === item.id
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
          {canEnterAdminPortal && (
            <button
              type="button"
              onClick={onEnterAdmin}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold bg-[#173D53] text-[#D3AD68] hover:bg-[#1e4c66] cursor-pointer"
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span className="truncate">لوحة الإدارة المستقلة</span>
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('landing');
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-red-300 hover:bg-white/5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 bg-[#102D40] text-white h-full flex flex-col p-4 overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[#1e465f]">
              <span className="font-bold text-base">GTU الجزائر</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 py-3 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs ${
                    effectiveRoute === item.id ? 'bg-[#173D53] text-[#D3AD68] font-bold' : 'text-slate-200'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            {canEnterAdminPortal && (
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onEnterAdmin();
                }}
                className="mt-2 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#173D53] text-xs font-bold text-[#D3AD68]"
              >
                <Shield className="w-4 h-4" />
                <span>لوحة الإدارة المستقلة</span>
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('landing');
              }}
              className="mt-3 flex items-center gap-2 px-3 py-2 text-xs text-red-300"
            >
              <LogOut className="w-4 h-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white dark:bg-[#102D40] border-b border-[#dce4ea] dark:border-[#1e465f] px-4 sm:px-6 py-3 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-[#102D40] dark:text-white"
              aria-label="القائمة"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-300 truncate">
              <span className="font-bold text-[#102D40] dark:text-white">GTU</span>
              <span className="mx-1.5">/</span>
              <span>{navItems.find((n) => n.id === effectiveRoute)?.label || 'لوحة القيادة'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {canEnterAdminPortal && (
              <button
                type="button"
                onClick={onEnterAdmin}
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#102D40] text-[#D3AD68] text-xs font-bold whitespace-nowrap cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>بوابة الإدارة</span>
              </button>
            )}
            <PWAInstallButton variant="inline" />
            <button
              type="button"
              onClick={() => navigate('notifications')}
              className="relative p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] cursor-pointer"
              aria-label="الإشعارات"
            >
              <Bell className="w-4 h-4 text-[#102D40] dark:text-white" />
              {user.unreadNotifications > 0 && (
                <span className="absolute -top-1 -left-1 px-1.5 py-0.2 rounded-full bg-[#27866F] text-white text-[10px] font-mono-tabular">
                  {user.unreadNotifications}
                </span>
              )}
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
              onClick={() => navigate('profile')}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] text-xs font-semibold cursor-pointer"
            >
              <span className="truncate max-w-[120px]">
                {user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.username}
              </span>
            </button>
          </div>
        </header>

        <PushNotificationBanner />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {effectiveRoute === 'dashboard' && <DashboardPage onNavigate={navigate} />}
          {effectiveRoute === 'profile' && <ProfilePage onNavigate={navigate} />}
          {effectiveRoute === 'directory' && <DirectoryPage onStartDirectChat={handleStartDirectChat} />}
          {effectiveRoute === 'map' && <NationalMapPage />}
          {effectiveRoute === 'wilayas' && <WilayasAndCommunesPage mode="wilayas" />}
          {effectiveRoute === 'communes' && <WilayasAndCommunesPage mode="communes" />}
          {effectiveRoute === 'chat' && <ChatWorkspacePage initialFilter="all" />}
          {effectiveRoute === 'groups' && <ChatWorkspacePage initialFilter="groups" />}
          {effectiveRoute === 'dm' && (
            <ChatWorkspacePage initialFilter="dm" initialDirectConvId={directConvId} />
          )}
          {effectiveRoute === 'proposals' && <ProposalsAndInitiativesPage defaultKind="proposal" />}
          {effectiveRoute === 'initiatives' && <ProposalsAndInitiativesPage defaultKind="initiative" />}
          {effectiveRoute === 'events' && <EventsPage />}
          {effectiveRoute === 'announcements' && <AnnouncementsPage />}
          {effectiveRoute === 'notifications' && <NotificationsPage />}
          {effectiveRoute === 'search' && <UnifiedSearchPage onNavigate={navigate} />}
          {effectiveRoute === 'reports' && canReports && <ReportsPage />}
        </main>
      </div>

      <OfflineIndicator />
    </div>
  );
};

const isAdminLocation = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.location.pathname.startsWith('/admin')) return true;
  if (window.location.hash.startsWith('#/admin')) return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('portal') === 'admin';
};

const RootRouter: React.FC = () => {
  const [isAdminPortal, setIsAdminPortal] = useState<boolean>(isAdminLocation);

  useEffect(() => {
    const syncFromLocation = () => setIsAdminPortal(isAdminLocation());
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, []);

  useEffect(() => {
    document.title = isAdminPortal
      ? 'لوحة تحكم الإدارة المستقلة | GTU الجزائر'
      : 'GTU – المنصة الوطنية لخريجي التقنيات الحضرية في الجزائر';
  }, [isAdminPortal]);

  const enterAdminPortal = () => {
    if (!window.location.pathname.startsWith('/admin')) {
      window.history.pushState({}, '', '/admin');
    }
    setIsAdminPortal(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const exitAdminPortal = () => {
    if (isAdminLocation()) {
      window.history.pushState({}, '', '/');
    }
    setIsAdminPortal(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isAdminPortal) {
    return (
      <>
        <AdminPortal onExitToPlatform={exitAdminPortal} />
        <OfflineIndicator />
      </>
    );
  }

  return <GTUShell onEnterAdmin={enterAdminPortal} />;
};

export default function App() {
  return (
    <AuthProvider>
      <RootRouter />
    </AuthProvider>
  );
}