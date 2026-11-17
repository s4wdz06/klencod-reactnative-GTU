import React, { useState } from 'react';
import { Bell, BellOff, BellRing, CheckCircle2, Download, RefreshCw, Send, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA.ts';
import { usePushNotifications } from '../hooks/usePushNotifications.ts';
import { useAuth } from '../context/AuthContext.tsx';

export const PWAInstallButton: React.FC<{ variant?: 'header' | 'inline' }> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
          variant === 'header'
            ? 'border border-[#D3AD68]/40 bg-[#173D53] text-[#F3F6F8] hover:bg-[#1e4d68]'
            : 'bg-[#102D40] text-white hover:bg-[#173D53]'
        }`}
      >
        <Download className="w-3.5 h-3.5 text-[#D3AD68]" />
        <span>تثبيت التطبيق</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[#D3AD68]/40 px-3 py-1.5 text-xs font-medium text-[#102D40] dark:text-[#F3F6F8] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-[#D3AD68]" />
          <span>تثبيت على iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#224b64] p-6 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-[#102D40] dark:text-white">تثبيت منصة GTU على جهازك</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-500 hover:text-slate-800 dark:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-sm text-[#172B38] dark:text-slate-200 list-decimal list-inside leading-relaxed">
                <li>اضغط على زر المشاركة (Share) في شريط سفاري.</li>
                <li>اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.</li>
                <li>أكّد الإضافة لتشغيل منصة GTU كتطبيق مستقل وتفعيل إشعارات الخلفية.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-lg bg-[#102D40] py-2 text-sm font-medium text-white hover:bg-[#173D53]"
              >
                حسناً
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const PushNotificationBanner: React.FC = () => {
  const { user } = useAuth();
  const { isSupported, permission, isSubscribed, busy, enablePush } = usePushNotifications(!!user);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('gtu_push_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (!user || !isSupported || isSubscribed || permission === 'granted' || permission === 'denied' || dismissed) {
    return null;
  }

  return (
    <div className="bg-[#173D53] text-white border-b border-[#24526e] px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 no-print">
      <div className="flex items-center gap-2.5 text-xs">
        <BellRing className="w-4 h-4 text-[#D3AD68] shrink-0" />
        <span>
          فعّل إشعارات الهاتف الفورية لتصلك التنبيهات والرسائل في أعلى شاشة الهاتف حتى عندما يكون التطبيق مغلقاً أو غير فعال.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={() => void enablePush()}
          className="px-3 py-1.5 rounded-lg bg-[#D3AD68] hover:bg-[#c59d55] text-[#102D40] text-xs font-bold cursor-pointer disabled:opacity-60"
        >
          {busy ? 'جاري التفعيل...' : 'تفعيل إشعارات الهاتف'}
        </button>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem('gtu_push_banner_dismissed', '1');
            } catch {
              // ignore
            }
          }}
          className="p-1 text-slate-300 hover:text-white cursor-pointer"
          aria-label="إخفاء"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export const PushNotificationControlCard: React.FC = () => {
  const { user } = useAuth();
  const {
    isSupported,
    permission,
    isSubscribed,
    busy,
    error,
    enablePush,
    disablePush,
    sendTestPush,
  } = usePushNotifications(!!user);
  const [testNotice, setTestNotice] = useState('');

  const handleTest = async () => {
    setTestNotice('');
    const res = await sendTestPush();
    if (res) {
      setTestNotice(
        res.sent > 0
          ? `تم إرسال الإشعار الفوري بنجاح إلى ${res.sent} جهاز مشترك.`
          : 'تم إرسال إشعار تجريبي على هذا الجهاز.'
      );
    }
  };

  return (
    <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#102D40] dark:bg-[#173D53] flex items-center justify-center shrink-0">
            {isSubscribed ? (
              <BellRing className="w-5 h-5 text-[#D3AD68]" />
            ) : (
              <Bell className="w-5 h-5 text-slate-300" />
            )}
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#102D40] dark:text-white flex items-center gap-2">
              <span>إشعارات الهاتف في الخلفية (أعلى الشاشة)</span>
              {isSubscribed && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#27866F]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  مفعلة
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
              تظهر الرسائل الخاصة، الإعلانات الوطنية، وتنبيهات الفعاليات في شريط الإشعارات أعلى الهاتف حتى ولو كان التطبيق مغلقاً أو غير نشط.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isSupported ? (
            <span className="text-xs text-amber-600 dark:text-amber-300">
              المتصفح الحالي لا يدعم إشعارات الخلفية (ثبّت التطبيق على الشاشة الرئيسية أولاً).
            </span>
          ) : permission === 'denied' ? (
            <span className="text-xs text-red-600 dark:text-red-300">
              تم حظر الإشعارات — يرجى السماح بالإشعارات من إعدادات المتصفح أو الهاتف.
            </span>
          ) : isSubscribed ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTest()}
                className="px-3.5 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6e5b] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                <span>تجربة إشعار الهاتف</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void disablePush()}
                className="px-3.5 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>إيقاف على هذا الجهاز</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void enablePush()}
              className="px-4 py-2 rounded-lg bg-[#102D40] hover:bg-[#173D53] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60 border border-[#D3AD68]/40"
            >
              <BellRing className="w-3.5 h-3.5 text-[#D3AD68]" />
              <span>{busy ? 'جاري التفعيل...' : 'تفعيل الإشعارات الفورية'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {testNotice && (
        <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-[#27866F] dark:text-emerald-300">
          {testNotice}
        </div>
      )}
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { offlineSyncBanner, pendingOfflineCount } = useAuth();

  if (isOnline && !offlineSyncBanner) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 no-print">
      {!isOnline && (
        <div className="flex items-center gap-2.5 rounded-lg bg-[#102D40] border border-[#D3AD68] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
          <WifiOff className="w-4 h-4 text-[#D3AD68] shrink-0" />
          <div>
            <div>الوضع دون اتصال — يتم عرض البيانات المخزنة محلياً.</div>
            {pendingOfflineCount > 0 && (
              <div className="text-[11px] text-[#D3AD68] mt-0.5 tabular-nums">
                {pendingOfflineCount} عنصر في قائمة انتظار المزامنة عند عودة الإنترنت
              </div>
            )}
          </div>
        </div>
      )}
      {isOnline && offlineSyncBanner && (
        <div className="flex items-center gap-2 rounded-lg bg-[#27866F] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
          <RefreshCw className="w-4 h-4 shrink-0" />
          <span>{offlineSyncBanner}</span>
        </div>
      )}
    </div>
  );
};

