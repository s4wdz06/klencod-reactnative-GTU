import React, { useEffect, useState } from 'react';
import { Mail, MapPin, Search, Users } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { Commune, GraduateCard, Wilaya } from '../types/gtu.ts';
import { AlgeriaInteractiveMap } from '../components/AlgeriaMap.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { AppRoute } from './LandingPage.tsx';

export const DirectoryPage: React.FC<{
  onStartDirectChat: (targetUserId: number) => void;
}> = ({ onStartDirectChat }) => {
  const { user } = useAuth();
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [graduates, setGraduates] = useState<GraduateCard[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [wilayaCode, setWilayaCode] = useState('');
  const [communeId, setCommuneId] = useState('');
  const [graduationYear, setGraduationYear] = useState('');
  const [sort, setSort] = useState<'newest' | 'name' | 'year'>('newest');

  useEffect(() => {
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!wilayaCode) {
      setCommunes([]);
      setCommuneId('');
      return;
    }
    apiRequest<{ communes: Commune[] }>(`/api/wilayas/${wilayaCode}/communes`)
      .then((d) => setCommunes(d.communes))
      .catch(() => setCommunes([]));
  }, [wilayaCode]);

  const fetchGraduates = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (wilayaCode) params.set('wilayaCode', wilayaCode);
    if (communeId) params.set('communeId', communeId);
    if (graduationYear) params.set('graduationYear', graduationYear);
    params.set('sort', sort);

    apiRequest<{ graduates: GraduateCard[] }>(`/api/graduates?${params.toString()}`)
      .then((d) => setGraduates(d.graduates))
      .catch(() => setGraduates([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchGraduates();
  }, [wilayaCode, communeId, graduationYear, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
            دليل الخريجين الوطني
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            دليل خاص بالأعضاء المسجلين فقط · تخفى بيانات الهاتف وتاريخ الميلاد افتراضياً حفاظاً على الخصوصية
          </p>
        </div>
        <div className="text-xs font-mono-tabular text-[#27866F] font-semibold">
          النتائج: {graduates.length}
        </div>
      </div>

      {/* Multi-criteria filter bar */}
      <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchGraduates()}
              placeholder="ابحث بالاسم أو اللقب أو رقم العضوية..."
              className="w-full pr-9 pl-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>

          <select
            value={wilayaCode}
            onChange={(e) => {
              setWilayaCode(e.target.value);
              setCommuneId('');
            }}
            className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          >
            <option value="">جميع الولايات (58)</option>
            {wilayas.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} - {w.nameAr}
              </option>
            ))}
          </select>

          <select
            disabled={!wilayaCode}
            value={communeId}
            onChange={(e) => setCommuneId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] disabled:opacity-50"
          >
            <option value="">جميع البلديات</option>
            {communes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameAr}
              </option>
            ))}
          </select>

          <input
            type="number"
            placeholder="سنة التخرج"
            value={graduationYear}
            onChange={(e) => setGraduationYear(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />

          <div className="flex gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              <option value="newest">الأحدث تسجيلاً</option>
              <option value="name">حسب الاسم</option>
              <option value="year">حسب سنة التخرج</option>
            </select>
            <button
              type="button"
              onClick={fetchGraduates}
              className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer"
            >
              بحث
            </button>
          </div>
        </div>
      </div>

      {/* Results Grid */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">جاري تحميل الدليل الوطني...</div>
      ) : graduates.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-12 text-center text-sm text-slate-500">
          لا توجد نتائج مطابقة لشروط البحث المحددة.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {graduates.map((g) => (
            <div
              key={g.userId}
              className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  {g.avatarUrl ? (
                    <img
                      src={g.avatarUrl}
                      alt={g.fullName}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-xl object-cover border border-[#dce4ea] shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-[#102D40] text-[#D3AD68] flex items-center justify-center font-bold text-base shrink-0">
                      {g.firstName.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-[#102D40] dark:text-white truncate">
                      {g.fullName}
                    </h3>
                    <div className="text-xs font-mono-tabular text-[#27866F]">{g.nationalMemberNumber}</div>
                  </div>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                  <div>
                    الولاية والبلدية: <strong className="text-[#102D40] dark:text-white">{g.wilayaName}</strong>
                    {g.communeName ? ` · ${g.communeName}` : ''}
                  </div>
                  <div>
                    التخرج: <span className="font-mono-tabular">{g.graduationYear || '—'}</span> · {g.specialty}
                  </div>
                  {g.institutionName && <div className="truncate text-slate-500">{g.institutionName}</div>}
                  {g.phone && <div>الهاتف: <span className="font-mono-tabular">{g.phone}</span></div>}
                  {g.email && <div>البريد: {g.email}</div>}
                </div>

                {g.bio && (
                  <p className="text-xs text-slate-500 dark:text-slate-300 line-clamp-2 pt-2 border-t border-[#dce4ea] dark:border-[#1e465f]">
                    {g.bio}
                  </p>
                )}
              </div>

              {g.userId !== user?.id && g.privacyAllowDm && (
                <button
                  type="button"
                  onClick={() => onStartDirectChat(g.userId)}
                  className="w-full py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] text-xs font-semibold text-[#102D40] dark:text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5 text-[#27866F]" />
                  <span>مراسلة خاصة</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const NationalMapPage: React.FC = () => {
  const { user } = useAuth();
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);

  useEffect(() => {
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
          الخريطة الوطنية التفاعلية – الجزائر (58 ولاية)
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
          استعراض التوزيع الوطني لخريجي التقنيات الحضرية عبر الولايات والبلديات دون كشف البيانات الشخصية الحساسة.
        </p>
      </div>
      <AlgeriaInteractiveMap wilayas={wilayas} isAuthenticated={Boolean(user)} />
    </div>
  );
};

export const WilayasAndCommunesPage: React.FC<{
  mode: 'wilayas' | 'communes';
  onNavigate?: (r: AppRoute) => void;
}> = ({ mode }) => {
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [selectedWilaya, setSelectedWilaya] = useState<string>('03');
  const [communes, setCommunes] = useState<Commune[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, []);

  useEffect(() => {
    if (mode === 'communes' && selectedWilaya) {
      apiRequest<{ communes: Commune[] }>(`/api/wilayas/${selectedWilaya}/communes`)
        .then((d) => setCommunes(d.communes))
        .catch(() => setCommunes([]));
    }
  }, [mode, selectedWilaya]);

  if (mode === 'wilayas') {
    const filtered = wilayas.filter(
      (w) => !search.trim() || w.nameAr.includes(search.trim()) || w.code.includes(search.trim())
    );
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
              الولايات الجزائرية (58 ولاية)
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
              التقسيم الإداري الرسمي المعتمد مع إحصائيات التمثيل والبلديات لكل ولاية
            </p>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث عن ولاية..."
            className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40] w-64"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((w) => (
            <div
              key={w.code}
              className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-4 flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-mono-tabular text-[#D3AD68] font-bold">
                  {w.code} · {w.region}
                </div>
                <div className="text-sm font-bold text-[#102D40] dark:text-white mt-0.5">{w.nameAr}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-1 tabular-nums">
                  {w.communesTotal} بلدية · {w.communesRepresented || 0} ممثلة
                </div>
              </div>
              <div className="text-left">
                <div className="text-lg font-bold text-[#27866F] font-mono-tabular">{w.membersCount || 0}</div>
                <div className="text-[10px] text-slate-400">{w.percentage || 0}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const filteredCommunes = communes.filter(
    (c) => !search.trim() || c.nameAr.includes(search.trim()) || c.dairaAr.includes(search.trim())
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display">
            دليل البلديات الإدارية الرسمية (1541 بلدية)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            اختر الولاية لعرض جميع بلدياتها المرتبطة رسمياً وعدد الخريجين في كل بلدية
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedWilaya}
            onChange={(e) => setSelectedWilaya(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40]"
          >
            {wilayas.map((w) => (
              <option key={w.code} value={w.code}>
                {w.code} - {w.nameAr}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث عن بلدية أو دائرة..."
            className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40]"
          />
        </div>
      </div>

      <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F3F6F8] dark:bg-[#0b202e] text-xs text-slate-500 dark:text-slate-300">
            <tr>
              <th className="py-3 px-4 text-right">الرمز</th>
              <th className="py-3 px-4 text-right">البلدية</th>
              <th className="py-3 px-4 text-right">الدائرة</th>
              <th className="py-3 px-4 text-right">الاسم اللاتيني</th>
              <th className="py-3 px-4 text-left">الأعضاء المسجلون</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
            {filteredCommunes.map((c) => (
              <tr key={c.id} className="hover:bg-[#F3F6F8]/60 dark:hover:bg-[#173D53]/40">
                <td className="py-2.5 px-4 font-mono-tabular text-xs text-slate-500">{c.officialId || c.id}</td>
                <td className="py-2.5 px-4 font-semibold text-[#102D40] dark:text-white flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#27866F]" />
                  <span>{c.nameAr}</span>
                </td>
                <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300">{c.dairaAr}</td>
                <td className="py-2.5 px-4 text-xs text-slate-500">{c.nameEn}</td>
                <td className="py-2.5 px-4 text-left font-mono-tabular font-semibold text-[#27866F]">
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {c.membersCount || 0}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
