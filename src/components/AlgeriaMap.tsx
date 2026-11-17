import React, { useMemo, useState } from 'react';
import { MapPin, RotateCcw, Search, Users, ZoomIn, ZoomOut } from 'lucide-react';
import { Commune, Wilaya } from '../types/gtu.ts';
import { apiRequest } from '../lib/api.ts';

// Approximate geographic coordinates [latitude, longitude] for all 58 Algerian Wilaya capitals
const WILAYA_COORDS: Record<string, [number, number]> = {
  '01': [27.87, -0.29], '02': [36.16, 1.33], '03': [33.8, 2.86], '04': [35.87, 7.11],
  '05': [35.55, 6.17], '06': [36.75, 5.08], '07': [34.85, 5.73], '08': [31.62, -2.22],
  '09': [36.47, 2.83], '10': [36.37, 3.9], '11': [22.79, 5.52], '12': [35.4, 8.12],
  '13': [34.88, -1.31], '14': [35.37, 1.32], '15': [36.71, 4.05], '16': [36.75, 3.06],
  '17': [34.67, 3.25], '18': [36.82, 5.76], '19': [36.19, 5.41], '20': [34.83, 0.15],
  '21': [36.87, 6.91], '22': [35.19, -0.63], '23': [36.9, 7.76], '24': [36.46, 7.43],
  '25': [36.36, 6.61], '26': [36.26, 2.75], '27': [35.93, 0.09], '28': [35.7, 4.54],
  '29': [35.39, 0.14], '30': [31.95, 5.32], '31': [35.69, -0.63], '32': [33.68, 1.01],
  '33': [26.5, 8.48], '34': [36.07, 4.76], '35': [36.76, 3.47], '36': [36.76, 8.31],
  '37': [27.67, -8.14], '38': [35.6, 1.81], '39': [33.36, 6.86], '40': [35.43, 7.14],
  '41': [36.28, 7.95], '42': [36.59, 2.44], '43': [36.45, 6.26], '44': [36.26, 1.96],
  '45': [33.26, -0.31], '46': [35.3, -1.14], '47': [32.49, 3.67], '48': [35.73, 0.55],
  '49': [29.26, 0.23], '50': [21.33, 0.95], '51': [34.43, 5.06], '52': [30.13, -2.17],
  '53': [27.19, 2.46], '54': [19.57, 5.77], '55': [33.1, 6.06], '56': [24.55, 9.48],
  '57': [33.92, 5.91], '58': [30.58, 2.88],
};

function projectCoord(lat: number, lng: number): [number, number] {
  // Algeria bbox: lng [-8.7 .. 12.0], lat [18.9 .. 37.2]
  const minLng = -9.2;
  const maxLng = 12.5;
  const minLat = 18.5;
  const maxLat = 37.6;
  const x = ((lng - minLng) / (maxLng - minLng)) * 740 + 30;
  const y = ((maxLat - lat) / (maxLat - minLat)) * 620 + 25;
  return [Math.round(x), Math.round(y)];
}

interface WilayaDetailsResponse {
  wilaya: Wilaya;
  stats: {
    membersCount: number;
    communesTotal: number;
    communesRepresented: number;
    percentage: number;
  };
  communes: Commune[];
  members: Array<{
    userId: number;
    nationalMemberNumber: string;
    firstName: string;
    lastName: string;
    communeName: string;
    bio: string;
  }>;
}

export const AlgeriaInteractiveMap: React.FC<{
  wilayas: Wilaya[];
  isAuthenticated: boolean;
}> = ({ wilayas, isAuthenticated }) => {
  const [zoom, setZoom] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedCode, setSelectedCode] = useState<string>('16');
  const [details, setDetails] = useState<WilayaDetailsResponse | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const maxMembers = useMemo(
    () => Math.max(...wilayas.map((w) => w.membersCount || 0), 1),
    [wilayas]
  );

  const filteredWilayas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return wilayas;
    return wilayas.filter(
      (w) =>
        w.nameAr.includes(q) ||
        w.nameEn.toLowerCase().includes(q) ||
        w.code.includes(q)
    );
  }, [wilayas, search]);

  const handleSelectWilaya = async (code: string) => {
    setSelectedCode(code);
    setLoadingDetails(true);
    try {
      const data = await apiRequest<WilayaDetailsResponse>(`/api/wilayas/${code}/details`);
      setDetails(data);
    } catch {
      setDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  React.useEffect(() => {
    if (wilayas.length > 0 && !details) {
      handleSelectWilaya(selectedCode);
    }
  }, [wilayas.length]);

  const getNodeColor = (count: number, isSelected: boolean) => {
    if (isSelected) return '#D3AD68';
    if (count === 0) return '#CBD5E1';
    const ratio = count / maxMembers;
    if (ratio > 0.66) return '#102D40';
    if (ratio > 0.33) return '#173D53';
    return '#27866F';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Map Canvas */}
      <div className="lg:col-span-7 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن ولاية بالاسم أو الرمز (مثال: الأغواط أو 03)..."
              className="w-full pr-9 pl-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e] text-[#172B38] dark:text-white focus:outline-none focus:border-[#102D40]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.25).toFixed(2))))}
              aria-label="تكبير الخريطة"
              className="p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] text-[#102D40] dark:text-white cursor-pointer"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.85, Number((z - 0.25).toFixed(2))))}
              aria-label="تصغير الخريطة"
              className="p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] text-[#102D40] dark:text-white cursor-pointer"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              aria-label="إعادة ضبط التكبير"
              className="p-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] text-[#102D40] dark:text-white cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* SVG Interactive Algeria Map */}
        <div className="relative overflow-auto rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] border border-[#dce4ea] dark:border-[#1e465f] h-[440px] flex items-center justify-center">
          <svg
            viewBox="0 0 800 680"
            className="w-full h-full transition-transform duration-200"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          >
            {/* Stylized Algeria Territorial Border Silhouette */}
            <path
              d="M 290,45 L 395,38 L 495,36 L 590,42 L 642,60 L 620,130 L 650,220 L 675,310 L 725,405 L 710,490 L 630,575 L 555,635 L 480,620 L 420,645 L 340,590 L 245,515 L 155,445 L 68,385 L 62,330 L 145,270 L 210,200 L 240,120 L 265,68 Z"
              fill="rgba(16, 45, 64, 0.05)"
              stroke="#173D53"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />

            {/* Northern Coastal Focus Inset Guide Line */}
            <rect
              x="250"
              y="32"
              width="390"
              height="105"
              rx="10"
              fill="none"
              stroke="#D3AD68"
              strokeDasharray="4 4"
              strokeOpacity="0.45"
            />

            {/* 58 Wilaya Interactive Nodes */}
            {filteredWilayas.map((w) => {
              const coords = WILAYA_COORDS[w.code] || [35.0, 3.0];
              const [cx, cy] = projectCoord(coords[0], coords[1]);
              const isSelected = selectedCode === w.code;
              const count = w.membersCount || 0;
              const radius = isSelected ? 11 : count > 0 ? Math.min(10, 6 + Math.sqrt(count)) : 5.5;
              const fill = getNodeColor(count, isSelected);

              return (
                <g
                  key={w.code}
                  onClick={() => handleSelectWilaya(w.code)}
                  className="cursor-pointer group"
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius + (isSelected ? 4 : 0)}
                    fill={isSelected ? 'rgba(211, 173, 104, 0.25)' : 'transparent'}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={fill}
                    stroke="#FFFFFF"
                    strokeWidth={isSelected ? 2 : 1.2}
                  />
                  <title>{`${w.code} - ${w.nameAr} (${count} مسجل)`}</title>
                  {(isSelected || count > 0 || zoom >= 1.35) && (
                    <text
                      x={cx}
                      y={cy - radius - 4}
                      textAnchor="middle"
                      fontSize={isSelected ? '11' : '9'}
                      fontWeight={isSelected ? '700' : '500'}
                      fill={isSelected ? '#102D40' : '#334155'}
                      className="select-none pointer-events-none dark:fill-slate-200"
                    >
                      {w.nameAr}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Color Legend */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-300">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#CBD5E1] inline-block" /> لا يوجد مسجلون
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#27866F] inline-block" /> حضور ناشئ
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#173D53] inline-block" /> تمثيل متوسط
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#102D40] inline-block" /> كثافة عالية
            </span>
          </div>
          <span className="tabular-nums">58 ولاية معتمدة</span>
        </div>

        {/* Quick Search Results Strip if filtering */}
        {search.trim() && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {filteredWilayas.slice(0, 12).map((w) => (
              <button
                key={w.code}
                type="button"
                onClick={() => handleSelectWilaya(w.code)}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer ${
                  selectedCode === w.code
                    ? 'bg-[#102D40] text-white border-[#102D40]'
                    : 'bg-[#F3F6F8] dark:bg-[#0b202e] text-[#172B38] dark:text-slate-200 border-[#dce4ea] dark:border-[#24526e]'
                }`}
              >
                {w.code} · {w.nameAr}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected Wilaya Info Panel */}
      <div className="lg:col-span-5 rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
        {loadingDetails || !details ? (
          <div className="py-16 text-center text-sm text-slate-400">جاري تحميل بيانات الولاية...</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-[#dce4ea] dark:border-[#1e465f] pb-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-300">
                  الرمز الإداري <span className="font-mono-tabular">{details.wilaya.code}</span> · {details.wilaya.region}
                </div>
                <h3 className="text-xl font-bold text-[#102D40] dark:text-white mt-1">
                  ولاية {details.wilaya.nameAr}
                </h3>
              </div>
              <MapPin className="w-5 h-5 text-[#D3AD68] shrink-0" />
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e]">
                <div className="text-lg font-bold text-[#102D40] dark:text-white tabular-nums">
                  {details.stats.membersCount}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-300">خريج مسجل</div>
              </div>
              <div className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e]">
                <div className="text-lg font-bold text-[#27866F] tabular-nums">
                  {details.stats.percentage}%
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-300">نسبة التمثيل</div>
              </div>
              <div className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e]">
                <div className="text-lg font-bold text-[#102D40] dark:text-[#D3AD68] tabular-nums">
                  {details.stats.communesRepresented}/{details.stats.communesTotal}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-300">بلديات ممثلة</div>
              </div>
            </div>

            {/* Communes List */}
            <div>
              <h4 className="text-xs font-bold text-[#102D40] dark:text-slate-200 mb-2">
                بلديات ولاية {details.wilaya.nameAr} ({details.communes.length})
              </h4>
              <div className="max-h-44 overflow-y-auto border border-[#dce4ea] dark:border-[#1e465f] rounded-lg divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                {details.communes.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between px-3 py-1.5 text-xs text-[#172B38] dark:text-slate-200"
                  >
                    <span>
                      {c.nameAr}
                      {c.dairaAr ? <span className="text-slate-400 mr-1.5">· دائرة {c.dairaAr}</span> : null}
                    </span>
                    <span className="font-mono-tabular text-slate-500 dark:text-slate-300">
                      {c.membersCount || 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Authenticated Members Preview (zero sensitive info) */}
            <div>
              <h4 className="text-xs font-bold text-[#102D40] dark:text-slate-200 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#27866F]" />
                <span>خريجو الولاية المسجلون</span>
              </h4>
              {!isAuthenticated ? (
                <div className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] text-xs text-slate-600 dark:text-slate-300">
                  حفاظاً على خصوصية الأعضاء، يرجى تسجيل الدخول للاطلاع على قائمة خريجي الولاية.
                </div>
              ) : details.members.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] text-xs text-slate-500">
                  لا يوجد أعضاء مسجلون في هذه الولاية بعد.
                </div>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {details.members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] text-xs"
                    >
                      <div>
                        <div className="font-semibold text-[#102D40] dark:text-white">
                          {m.firstName} {m.lastName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-300">
                          {m.communeName || details.wilaya.nameAr} · {m.nationalMemberNumber}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
