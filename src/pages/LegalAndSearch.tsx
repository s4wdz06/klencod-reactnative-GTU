import React, { useEffect, useState } from 'react';
import { ArrowRight, Search, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { AppRoute } from './LandingPage.tsx';

export const UnifiedSearchPage: React.FC<{ onNavigate: (r: AppRoute) => void }> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true);
    try {
      const res = await apiRequest(`/api/search?q=${encodeURIComponent(query.trim())}`);
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
          <Search className="w-5 h-5 text-[#D3AD68]" />
          <span>البحث الوطني الموحد</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
          ابحث في الأعضاء، الولايات، البلديات، سنوات التخرج، الإعلانات، الاقتراحات، الفعاليات، والمجموعات
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="اكتب كلمة البحث (مثال: الأغواط، 2022، ملتقى، أحمد)..."
          className="flex-1 px-4 py-2.5 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40]"
        />
        <button
          type="submit"
          className="px-6 py-2.5 rounded-lg bg-[#102D40] text-white text-sm font-bold cursor-pointer"
        >
          {loading ? 'جاري البحث...' : 'بحث'}
        </button>
      </form>

      {results && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            ['الأعضاء', results.members, (m: any) => `${m.firstName} ${m.lastName} · ${m.wilayaName || ''}`, 'directory'],
            ['الولايات', results.wilayas, (w: any) => `${w.code} - ${w.nameAr}`, 'wilayas'],
            ['البلديات', results.communes, (c: any) => `${c.nameAr} (${c.wilayaCode})`, 'communes'],
            ['الإعلانات', results.announcements, (a: any) => a.title, 'announcements'],
            ['الاقتراحات والمبادرات', results.proposals, (p: any) => p.title, 'proposals'],
            ['الفعاليات', results.events, (ev: any) => ev.title, 'events'],
            ['المجموعات', results.groups, (g: any) => g.nameAr, 'groups'],
          ].map(([title, arr, formatFn, navTarget]: any) => (
            <div
              key={title}
              className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[#102D40] dark:text-white">
                  {title} ({arr?.length || 0})
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigate(navTarget)}
                  className="text-xs text-[#27866F] hover:underline cursor-pointer"
                >
                  فتح القسم
                </button>
              </div>
              {!arr || arr.length === 0 ? (
                <p className="text-xs text-slate-400">لا توجد نتائج مطابقة.</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {arr.map((item: any, i: number) => (
                    <li key={i} className="p-2 rounded bg-[#F3F6F8] dark:bg-[#0b202e]">
                      {formatFn(item)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const LegalPage: React.FC<{
  mode: 'privacy' | 'terms';
  onNavigate: (r: AppRoute) => void;
}> = ({ mode, onNavigate }) => {
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    apiRequest<{ settings: Record<string, string> }>('/api/public/overview')
      .then((d) => setSettings(d.settings))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-[#F3F6F8] dark:bg-[#071620] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          type="button"
          onClick={() => onNavigate('landing')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#173D53] dark:text-slate-300 hover:underline mb-5 cursor-pointer"
        >
          <ArrowRight className="w-3.5 h-3.5" />
          <span>العودة</span>
        </button>

        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-8 space-y-5">
          <div className="flex items-center gap-2 text-[#27866F] text-xs font-bold">
            <ShieldCheck className="w-4 h-4" />
            <span>الوثيقة التنظيمية الرسمية – GTU الجزائر</span>
          </div>
          <h1 className="text-2xl font-bold text-[#102D40] dark:text-white font-display">
            {mode === 'privacy' ? 'سياسة الخصوصية وحماية البيانات الشخصية' : 'شروط الاستخدام وميثاق المنصة'}
          </h1>
          <div className="text-sm text-[#172B38] dark:text-slate-200 leading-loose whitespace-pre-wrap">
            {mode === 'privacy'
              ? settings.privacy_policy_text ||
                'تلتزم منصة GTU بحماية البيانات الشخصية لأعضائها وتشفير كلمات المرور، وإخفاء رقم الهاتف وتاريخ الميلاد افتراضياً عن بقية الأعضاء إلا بموافقة صاحب الحساب، مع حق العضو في تعديل بياناته أو حذف حسابه.'
              : settings.terms_of_use_text ||
                'التسجيل في المنصة مخصص لخريجي تخصص التقنيات الحضرية في الجزائر. يلتزم الأعضاء بصحة البيانات واحترام أخلاقيات الحوار المهني.'}
          </div>
        </div>
      </div>
    </div>
  );
};
