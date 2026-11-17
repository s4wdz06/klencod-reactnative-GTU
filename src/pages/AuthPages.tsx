import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { Commune, Institution, Wilaya } from '../types/gtu.ts';
import { AppRoute } from './LandingPage.tsx';

export const LoginPage: React.FC<{
  onNavigate: (r: AppRoute) => void;
  onEnterAdmin?: () => void;
}> = ({ onNavigate, onEnterAdmin }) => {
  const { login, loginWithGoogle } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Recovery modal state
  const [showRecover, setShowRecover] = useState(false);
  const [recUsername, setRecUsername] = useState('');
  const [recMemberNo, setRecMemberNo] = useState('');
  const [recBirthDate, setRecBirthDate] = useState('');
  const [recNewPass, setRecNewPass] = useState('');
  const [recMsg, setRecMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(identifier, password);
      onNavigate('dashboard');
    } catch (err: any) {
      setError(err.message || 'تعذر تسجيل الدخول');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setSubmitting(true);
    try {
      const u = await loginWithGoogle();
      onNavigate(u.needsProfileCompletion ? 'register' : 'dashboard');
    } catch (err: any) {
      setError(err.message || 'تعذر تسجيل الدخول عبر Google');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecMsg('');
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/recover-password', {
        method: 'POST',
        body: JSON.stringify({
          username: recUsername,
          nationalMemberNumber: recMemberNo,
          birthDate: recBirthDate,
          newPassword: recNewPass,
        }),
      });
      setRecMsg(res.message);
    } catch (err: any) {
      setRecMsg(err.message || 'تعذر استعادة كلمة المرور');
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] flex flex-col justify-center py-10 px-4">
      <div className="max-w-md w-full mx-auto">
        <button
          type="button"
          onClick={() => onNavigate('landing')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#173D53] dark:text-slate-300 hover:underline mb-5 cursor-pointer"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span>العودة إلى الرئيسية</span>
        </button>

        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-7">
          <div className="mb-6">
            <div className="text-xs font-bold text-[#D3AD68]">GTU الجزائر</div>
            <h1 className="text-2xl font-bold text-[#102D40] dark:text-white mt-1 font-display">
              تسجيل الدخول إلى المنصة الوطنية
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
              أدخل بيانات حسابك للوصول إلى الدليل الوطني، الشات، والفعاليات.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#172B38] dark:text-slate-200 mb-1.5">
                اسم المستخدم أو البريد الإلكتروني
              </label>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="مثال: ahmed_urban"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] text-[#172B38] dark:text-white focus:outline-none focus:border-[#102D40]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-[#172B38] dark:text-slate-200">كلمة المرور</label>
                <button
                  type="button"
                  onClick={() => setShowRecover(true)}
                  className="text-xs text-[#27866F] hover:underline cursor-pointer"
                >
                  استعادة كلمة المرور؟
                </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] text-[#172B38] dark:text-white focus:outline-none focus:border-[#102D40]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-[#102D40] hover:bg-[#173D53] text-white text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'جاري التحقق...' : 'دخول إلى المنصة'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <div className="flex-1 h-px bg-[#dce4ea] dark:bg-[#1e465f]" />
            <span>أو</span>
            <div className="flex-1 h-px bg-[#dce4ea] dark:bg-[#1e465f]" />
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogle}
            className="w-full py-2.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#0b202e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] text-sm font-medium text-[#102D40] dark:text-white transition-colors cursor-pointer"
          >
            المتابعة باستخدام حساب Google
          </button>

          <div className="mt-6 text-center text-xs text-slate-500 dark:text-slate-300 space-y-2.5">
            <div>
              خريج جديد؟{' '}
              <button
                type="button"
                onClick={() => onNavigate('register')}
                className="font-bold text-[#27866F] hover:underline cursor-pointer"
              >
                أنشئ عضويتك الوطنية مجاناً
              </button>
            </div>
            {onEnterAdmin && (
              <div className="pt-2 border-t border-[#dce4ea] dark:border-[#1e465f]">
                <button
                  type="button"
                  onClick={onEnterAdmin}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#102D40] dark:text-[#D3AD68] hover:underline cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#D3AD68]" />
                  <span>الدخول إلى لوحة تحكم الإدارة المستقلة</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showRecover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6">
            <h3 className="text-base font-bold text-[#102D40] dark:text-white flex items-center gap-2 mb-3">
              <KeyRound className="w-4 h-4 text-[#D3AD68]" />
              <span>استعادة كلمة المرور</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-300 mb-4">
              أدخل اسم المستخدم، رقم العضوية الوطني، وتاريخ الميلاد للتحقق وإعادة تعيين كلمة المرور.
            </p>
            <form onSubmit={handleRecover} className="space-y-3">
              <input
                type="text"
                required
                placeholder="اسم المستخدم"
                value={recUsername}
                onChange={(e) => setRecUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
              <input
                type="text"
                required
                placeholder="رقم العضوية الوطني (مثال: GTU-2026-000001A)"
                value={recMemberNo}
                onChange={(e) => setRecMemberNo(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
              <input
                type="date"
                required
                value={recBirthDate}
                onChange={(e) => setRecBirthDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
              <input
                type="password"
                required
                placeholder="كلمة المرور الجديدة (8 أحرف على الأقل)"
                value={recNewPass}
                onChange={(e) => setRecNewPass(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
              {recMsg && <p className="text-xs text-[#27866F] font-medium">{recMsg}</p>}
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer"
                >
                  تأكيد التعيين
                </button>
                <button
                  type="button"
                  onClick={() => setShowRecover(false)}
                  className="px-4 py-2 rounded-lg border border-[#dce4ea] text-xs cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export const RegisterPage: React.FC<{ onNavigate: (r: AppRoute) => void }> = ({ onNavigate }) => {
  const { user, register, refreshUser } = useAuth();
  const isGoogleCompletion = Boolean(user && user.needsProfileCompletion);

  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [birthCommunes, setBirthCommunes] = useState<Commune[]>([]);
  const [resCommunes, setResCommunes] = useState<Commune[]>([]);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    birthDate: '',
    birthPlace: '',
    birthWilayaCode: '',
    birthCommuneId: '',
    phone: '',
    email: user?.email || '',
    avatarDataUrl: '',
    specialty: 'تسيير التقنيات الحضرية',
    graduationYear: String(new Date().getFullYear() - 2),
    institutionId: '',
    institutionName: '',
    extraInfo: '',
    residenceWilayaCode: '',
    residenceCommuneId: '',
    username: '',
    password: '',
    confirmPassword: '',
    acceptedTerms: false,
  });

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
    apiRequest<{ institutions: Institution[] }>('/api/institutions')
      .then((d) => setInstitutions(d.institutions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.birthWilayaCode) {
      setBirthCommunes([]);
      return;
    }
    apiRequest<{ communes: Commune[] }>(`/api/wilayas/${form.birthWilayaCode}/communes`)
      .then((d) => setBirthCommunes(d.communes))
      .catch(() => setBirthCommunes([]));
  }, [form.birthWilayaCode]);

  useEffect(() => {
    if (!form.residenceWilayaCode) {
      setResCommunes([]);
      return;
    }
    apiRequest<{ communes: Commune[] }>(`/api/wilayas/${form.residenceWilayaCode}/communes`)
      .then((d) => setResCommunes(d.communes))
      .catch(() => setResCommunes([]));
  }, [form.residenceWilayaCode]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('حجم الصورة الشخصية يجب ألا يتجاوز 2 ميغابايت.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, avatarDataUrl: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (isGoogleCompletion) {
        await apiRequest('/api/auth/complete-profile', {
          method: 'POST',
          body: JSON.stringify({
            ...form,
            birthCommuneId: Number(form.birthCommuneId),
            residenceCommuneId: Number(form.residenceCommuneId),
            graduationYear: Number(form.graduationYear),
            institutionId: form.institutionId ? Number(form.institutionId) : null,
          }),
        });
        await refreshUser();
        onNavigate('dashboard');
      } else {
        await register({
          ...form,
          birthCommuneId: Number(form.birthCommuneId),
          residenceCommuneId: Number(form.residenceCommuneId),
          graduationYear: Number(form.graduationYear),
          institutionId: form.institutionId ? Number(form.institutionId) : null,
        });
        onNavigate('dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'تعذر إتمام التسجيل');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button
            type="button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#173D53] dark:text-slate-300 hover:underline cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>العودة إلى الرئيسية</span>
          </button>
          <span className="text-xs font-bold text-[#D3AD68]">GTU – التسجيل الوطني المجاني</span>
        </div>

        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-6 sm:p-8">
          <div className="border-b border-[#dce4ea] dark:border-[#1e465f] pb-5 mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
                <UserPlus className="w-6 h-6 text-[#27866F]" />
                <span>
                  {isGoogleCompletion
                    ? 'استكمال ملف الخريج الوطني'
                    : 'استمارة التسجيل والانضمام لخريجي التقنيات الحضرية'}
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                التسجيل مجاني ومفتوح لجميع خريجي التخصص. يتم إنشاء رقم عضوية وطني فريد تلقائياً عند الإتمام.
              </p>
            </div>
            <ShieldCheck className="w-6 h-6 text-[#D3AD68] shrink-0" />
          </div>

          {error && (
            <div className="mb-6 p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Section 1: Personal Info */}
            <div>
              <h2 className="text-sm font-bold text-[#102D40] dark:text-[#D3AD68] mb-4 pb-2 border-b border-[#dce4ea] dark:border-[#1e465f]">
                01. البيانات الشخصية
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">الاسم *</label>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">اللقب *</label>
                  <input
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">تاريخ الميلاد *</label>
                  <input
                    type="date"
                    required
                    value={form.birthDate}
                    onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">مكان الميلاد *</label>
                  <input
                    type="text"
                    required
                    value={form.birthPlace}
                    onChange={(e) => setForm({ ...form, birthPlace: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">ولاية الميلاد *</label>
                  <select
                    required
                    value={form.birthWilayaCode}
                    onChange={(e) =>
                      setForm({ ...form, birthWilayaCode: e.target.value, birthCommuneId: '' })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  >
                    <option value="">اختر ولاية الميلاد</option>
                    {wilayas.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} - {w.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">بلدية الميلاد *</label>
                  <select
                    required
                    disabled={!form.birthWilayaCode}
                    value={form.birthCommuneId}
                    onChange={(e) => setForm({ ...form, birthCommuneId: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] disabled:opacity-50"
                  >
                    <option value="">اختر بلدية الميلاد</option>
                    {birthCommunes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">رقم الهاتف * (محفوظ بسرية)</label>
                  <input
                    type="tel"
                    required
                    placeholder="0550 00 00 00"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">البريد الإلكتروني (اختياري)</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">صورة شخصية (اختيارية)</label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleAvatarUpload}
                    className="w-full text-xs text-slate-500 file:ml-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-[#173D53] file:text-white cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Academic Info */}
            <div>
              <h2 className="text-sm font-bold text-[#102D40] dark:text-[#D3AD68] mb-4 pb-2 border-b border-[#dce4ea] dark:border-[#1e465f]">
                02. البيانات الأكاديمية
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">التخصص الدقيق *</label>
                  <input
                    type="text"
                    required
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">سنة التخرج *</label>
                  <input
                    type="number"
                    required
                    min={1975}
                    max={new Date().getFullYear() + 2}
                    value={form.graduationYear}
                    onChange={(e) => setForm({ ...form, graduationYear: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">المؤسسة أو المعهد الجامعي *</label>
                  <select
                    value={form.institutionId}
                    onChange={(e) => {
                      const found = institutions.find((i) => String(i.id) === e.target.value);
                      setForm({
                        ...form,
                        institutionId: e.target.value,
                        institutionName: found?.nameAr || form.institutionName,
                      });
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  >
                    <option value="">اختر المؤسسة الجامعية</option>
                    {institutions.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold mb-1">معلومات أكاديمية إضافية (اختياري)</label>
                  <input
                    type="text"
                    placeholder="أو اكتب اسم المؤسسة إذا لم تكن مدرجة، وموضوع مذكرة التخرج..."
                    value={form.extraInfo}
                    onChange={(e) => setForm({ ...form, extraInfo: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Geographic Info */}
            <div>
              <h2 className="text-sm font-bold text-[#102D40] dark:text-[#D3AD68] mb-4 pb-2 border-b border-[#dce4ea] dark:border-[#1e465f]">
                03. البيانات الجغرافية لمكان الإقامة
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">ولاية الإقامة *</label>
                  <select
                    required
                    value={form.residenceWilayaCode}
                    onChange={(e) =>
                      setForm({ ...form, residenceWilayaCode: e.target.value, residenceCommuneId: '' })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  >
                    <option value="">اختر ولاية الإقامة</option>
                    {wilayas.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} - {w.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">بلدية الإقامة *</label>
                  <select
                    required
                    disabled={!form.residenceWilayaCode}
                    value={form.residenceCommuneId}
                    onChange={(e) => setForm({ ...form, residenceCommuneId: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] disabled:opacity-50"
                  >
                    <option value="">اختر بلدية الإقامة</option>
                    {resCommunes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Section 4: Account Credentials (skipped if Google completion) */}
            {!isGoogleCompletion && (
              <div>
                <h2 className="text-sm font-bold text-[#102D40] dark:text-[#D3AD68] mb-4 pb-2 border-b border-[#dce4ea] dark:border-[#1e465f]">
                  04. بيانات الحساب
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1">اسم المستخدم (بالإنجليزية) *</label>
                    <input
                      type="text"
                      required
                      placeholder="ahmed_gtu"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">كلمة المرور (8 أحرف+) *</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">تأكيد كلمة المرور *</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={form.confirmPassword}
                      onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2.5 pt-2">
              <input
                id="terms-accept"
                type="checkbox"
                required
                checked={form.acceptedTerms}
                onChange={(e) => setForm({ ...form, acceptedTerms: e.target.checked })}
                className="mt-1 h-4 w-4 accent-[#102D40]"
              />
              <label htmlFor="terms-accept" className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                أوافق على{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('terms')}
                  className="font-bold text-[#102D40] dark:text-[#D3AD68] underline cursor-pointer"
                >
                  شروط الاستخدام
                </button>{' '}
                و{' '}
                <button
                  type="button"
                  onClick={() => onNavigate('privacy')}
                  className="font-bold text-[#102D40] dark:text-[#D3AD68] underline cursor-pointer"
                >
                  سياسة الخصوصية ومعالجة البيانات
                </button>
                .
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-[#dce4ea] dark:border-[#1e465f]">
              <button
                type="submit"
                disabled={submitting}
                className="px-7 py-3 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-sm font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting ? 'جاري إنشاء العضوية...' : 'إتمام التسجيل واستصدار رقم العضوية'}
              </button>
              {!isGoogleCompletion && (
                <button
                  type="button"
                  onClick={() => onNavigate('login')}
                  className="text-xs text-[#173D53] dark:text-slate-300 hover:underline cursor-pointer"
                >
                  لديك حساب مسبقاً؟ تسجيل الدخول
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
