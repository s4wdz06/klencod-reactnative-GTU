import React, { useState } from 'react';

interface DataPoint {
  label: string;
  value: number;
}

export const GrowthChart: React.FC<{
  daily: DataPoint[];
  monthly: DataPoint[];
  yearly: DataPoint[];
}> = ({ daily, monthly, yearly }) => {
  const [period, setPeriod] = useState<'daily' | 'monthly' | 'yearly'>('monthly');
  const data = period === 'daily' ? daily : period === 'monthly' ? monthly : yearly;
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-bold text-[#102D40] dark:text-white">منحنى نمو التسجيلات</h3>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
            تطور انضمام خريجي التقنيات الحضرية عبر الفترات الزمنية
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-[#F3F6F8] dark:bg-[#0b202e] rounded-lg">
          {(
            [
              ['daily', 'يومي'],
              ['monthly', 'شهري'],
              ['yearly', 'سنوي'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                period === key
                  ? 'bg-white dark:bg-[#173D53] text-[#102D40] dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-[#102D40]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="h-44 flex items-center justify-center text-sm text-slate-400">
          لا توجد بيانات تسجيل كافية لهذه الفترة بعد.
        </div>
      ) : (
        <div className="h-52 flex items-end gap-2 pt-6 pb-2 overflow-x-auto">
          {data.map((pt) => {
            const heightPct = Math.max(8, Math.round((pt.value / maxVal) * 100));
            return (
              <div key={pt.label} className="flex-1 min-w-[44px] flex flex-col items-center gap-1.5 group">
                <span className="text-[11px] font-semibold text-[#102D40] dark:text-[#D3AD68] tabular-nums">
                  {pt.value}
                </span>
                <div className="w-full max-w-[36px] h-36 bg-[#F3F6F8] dark:bg-[#0b202e] rounded-t-md flex items-end overflow-hidden">
                  <div
                    className="w-full bg-[#173D53] group-hover:bg-[#27866F] transition-all rounded-t-md"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-500 dark:text-slate-300 font-mono-tabular truncate max-w-[60px]">
                  {pt.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const WilayaDistributionChart: React.FC<{
  items: Array<{ code: string; nameAr: string; count: number; percentage: number }>;
}> = ({ items }) => {
  const top = items.slice(0, 10);
  const maxCount = Math.max(...top.map((i) => i.count), 1);

  return (
    <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
      <div className="mb-4">
        <h3 className="text-base font-bold text-[#102D40] dark:text-white">ترتيب الولايات حسب عدد المسجلين</h3>
        <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
          أعلى الولايات تمثيلاً ونسبة مساهمة كل ولاية
        </p>
      </div>
      {top.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">لم تُسجل ولايات بعد.</div>
      ) : (
        <div className="space-y-3">
          {top.map((item) => {
            const widthPct = Math.max(4, Math.round((item.count / maxCount) * 100));
            return (
              <div key={item.code} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#172B38] dark:text-slate-100">
                    <span className="font-mono-tabular text-slate-400 ml-1.5">{item.code}</span>
                    {item.nameAr}
                  </span>
                  <span className="font-mono-tabular text-slate-600 dark:text-slate-300">
                    {item.count} خريج · {item.percentage}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#F3F6F8] dark:bg-[#0b202e] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#27866F] transition-all"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const CohortYearChart: React.FC<{
  items: Array<{ year: number; count: number }>;
}> = ({ items }) => {
  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
      <div className="mb-4">
        <h3 className="text-base font-bold text-[#102D40] dark:text-white">توزيع الخريجين حسب دفعات التخرج</h3>
        <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">أكثر سنوات التخرج تسجيلاً في المنصة</p>
      </div>
      {items.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">لا توجد دفعات مسجلة بعد.</div>
      ) : (
        <div className="h-44 flex items-end gap-2 pt-4 overflow-x-auto">
          {items.map((item) => {
            const h = Math.max(10, Math.round((item.count / maxCount) * 100));
            return (
              <div key={item.year} className="flex-1 min-w-[38px] flex flex-col items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[#102D40] dark:text-[#D3AD68] tabular-nums">
                  {item.count}
                </span>
                <div className="w-full max-w-[32px] h-28 bg-[#F3F6F8] dark:bg-[#0b202e] rounded-t flex items-end overflow-hidden">
                  <div className="w-full bg-[#D3AD68] rounded-t" style={{ height: `${h}%` }} />
                </div>
                <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-300">
                  {item.year}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
