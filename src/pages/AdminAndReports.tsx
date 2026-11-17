import React, { useEffect, useState } from 'react';
import {
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  Settings,
  Shield,
  Upload,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest, exportToCsv, exportToJson, exportToXlsx } from '../lib/api.ts';
import { Wilaya } from '../types/gtu.ts';

export const ReportsPage: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [activeReport, setActiveReport] = useState<
    | 'total'
    | 'wilaya'
    | 'commune'
    | 'year'
    | 'institution'
    | 'monthly'
    | 'proposals'
    | 'events'
  >('wilaya');

  useEffect(() => {
    apiRequest('/api/reports/summary').then(setSummary).catch(() => {});
  }, []);

  if (!summary) {
    return <div className="p-10 text-center text-sm text-slate-400">جاري تجهيز التقارير الإحصائية...</div>;
  }

  const getActiveRows = (): Array<Record<string, unknown>> => {
    switch (activeReport) {
      case 'total':
        return summary.graduatesDirectoryExport || [];
      case 'wilaya':
        return summary.byWilaya || [];
      case 'commune':
        return summary.byCommune || [];
      case 'year':
        return summary.byGraduationYear || [];
      case 'institution':
        return summary.byInstitution || [];
      case 'monthly':
        return summary.monthlyRegistrations || [];
      case 'proposals':
        return summary.proposalsSummary || [];
      case 'events':
        return summary.eventsSummary || [];
    }
  };

  const rows = getActiveRows();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#D3AD68]" />
            <span>مركز التقارير والإحصائيات الرسمية</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            تصدير تقارير الخريجين والولايات والفعاليات بصيغ PDF وExcel وCSV وJSON مع حماية البيانات الحساسة
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-[#D3AD68]" />
            <span>طباعة / PDF</span>
          </button>
          <button
            type="button"
            onClick={() => exportToXlsx(`gtu-report-${activeReport}`, 'GTU', rows)}
            className="px-3.5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            onClick={() => exportToCsv(`gtu-report-${activeReport}`, rows)}
            className="px-3.5 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportToJson(`gtu-report-${activeReport}`, summary)}
            className="px-3.5 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-white dark:bg-[#102D40] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSON</span>
          </button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap gap-1.5 no-print">
        {(
          [
            ['wilaya', 'حسب الولاية'],
            ['commune', 'حسب البلدية'],
            ['year', 'حسب سنة التخرج'],
            ['institution', 'حسب المؤسسة'],
            ['monthly', 'التسجيلات الشهرية'],
            ['total', 'إجمالي الخريجين'],
            ['proposals', 'الاقتراحات'],
            ['events', 'الفعاليات'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setActiveReport(k)}
            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
              activeReport === k
                ? 'bg-[#102D40] text-white border-[#102D40]'
                : 'bg-white dark:bg-[#102D40] border-[#dce4ea] dark:border-[#1e465f]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Printable Report Header */}
      <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 overflow-x-auto">
        <div className="mb-4 pb-3 border-b border-[#dce4ea] dark:border-[#1e465f] flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-[#102D40] dark:text-white">
              GTU – التقرير الإحصائي الرسمي ({rows.length} سجل)
            </div>
            <div className="text-xs text-slate-500">
              تاريخ الاستخراج: {new Date().toLocaleString('ar-DZ')}
            </div>
          </div>
          <div className="text-xs font-mono-tabular text-[#27866F]">
            إجمالي الخريجين: {summary.totalGraduates}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">لا توجد بيانات في هذا التقرير حالياً.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-[#F3F6F8] dark:bg-[#0b202e] text-slate-600 dark:text-slate-300">
              <tr>
                {Object.keys(rows[0]).map((col) => (
                  <th key={col} className="py-2.5 px-3 text-right font-bold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
              {rows.map((r, idx) => (
                <tr key={idx}>
                  {Object.values(r).map((val, cIdx) => (
                    <td key={cIdx} className="py-2 px-3 tabular-nums">
                      {String(val ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export const AdminConsolePage: React.FC<{
  initialSection?: 'overview' | 'users' | 'roles' | 'settings';
}> = ({ initialSection = 'overview' }) => {
  const { user } = useAuth();
  const isSuperAdmin = user?.roleSlug === 'super_admin';

  const [section, setSection] = useState<'overview' | 'users' | 'roles' | 'geo' | 'settings' | 'backup'>(
    initialSection === 'users'
      ? 'users'
      : initialSection === 'roles'
      ? 'roles'
      : initialSection === 'settings'
      ? 'settings'
      : 'users'
  );

  const [usersList, setUsersList] = useState<any[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [permissionsList, setPermissionsList] = useState<any[]>([]);
  const [modReports, setModReports] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [settingsList, setSettingsList] = useState<Array<{ key: string; value: string; category: string }>>([]);
  const [msg, setMsg] = useState('');

  // Geo form
  const [newCommune, setNewCommune] = useState({ wilayaCode: '03', nameAr: '', nameEn: '', dairaAr: '' });
  const [newInst, setNewInst] = useState({ nameAr: '', type: 'معهد تقنيات حضرية' });

  useEffect(() => {
    setSection(
      initialSection === 'users'
        ? 'users'
        : initialSection === 'roles'
        ? 'roles'
        : initialSection === 'settings'
        ? 'settings'
        : 'users'
    );
  }, [initialSection]);

  const loadAll = () => {
    apiRequest<{ users: any[] }>('/api/admin/users').then((d) => setUsersList(d.users)).catch(() => {});
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
    apiRequest<{ permissions: any[] }>('/api/admin/permissions')
      .then((d) => setPermissionsList(d.permissions))
      .catch(() => {});
    apiRequest<{ reports: any[] }>('/api/admin/reports').then((d) => setModReports(d.reports)).catch(() => {});
    apiRequest<{ logs: any[] }>('/api/admin/audit-logs').then((d) => setAuditLogs(d.logs)).catch(() => {});
    apiRequest<{ settings: any[] }>('/api/admin/settings')
      .then((d) => setSettingsList(d.settings))
      .catch(() => {});
  };

  useEffect(() => {
    loadAll();
  }, []);

  const updateUserRole = async (targetId: number, roleSlug: string, assignedWilayaCode = '') => {
    setMsg('');
    await apiRequest(`/api/admin/users/${targetId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ roleSlug, assignedWilayaCode }),
    });
    setMsg('تم تحديث صلاحية العضو بنجاح.');
    loadAll();
  };

  const toggleUserActive = async (targetId: number, isActive: boolean) => {
    await apiRequest(`/api/admin/users/${targetId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    loadAll();
  };

  const togglePermissionRole = (permKey: string, roleSlug: string) => {
    setPermissionsList((prev) =>
      prev.map((p) => {
        if (p.key !== permKey) return p;
        const arr: string[] = JSON.parse(p.allowedRoles || '[]');
        const next = arr.includes(roleSlug) ? arr.filter((r) => r !== roleSlug) : [...arr, roleSlug];
        return { ...p, allowedRoles: JSON.stringify(next) };
      })
    );
  };

  const savePermissions = async () => {
    const payload = permissionsList.map((p) => ({
      key: p.key,
      allowedRoles: JSON.parse(p.allowedRoles || '[]'),
    }));
    await apiRequest('/api/admin/permissions', {
      method: 'PUT',
      body: JSON.stringify({ permissions: payload }),
    });
    setMsg('تم حفظ مصفوفة الصلاحيات بنجاح.');
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings: settingsList }),
    });
    setMsg('تم تحديث إعدادات المنصة دون تعديل الكود.');
  };

  const handleAddCommune = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/admin/communes', { method: 'POST', body: JSON.stringify(newCommune) });
    setNewCommune({ wilayaCode: '03', nameAr: '', nameEn: '', dairaAr: '' });
    setMsg('تمت إضافة البلدية وربطها بالولاية بنجاح.');
    loadAll();
  };

  const handleAddInstitution = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/admin/institutions', { method: 'POST', body: JSON.stringify(newInst) });
    setNewInst({ nameAr: '', type: 'معهد تقنيات حضرية' });
    setMsg('تمت إضافة المؤسسة الجامعية بنجاح.');
  };

  const handleDownloadBackup = async () => {
    const data = await apiRequest('/api/admin/backup');
    exportToJson(`gtu-backup-${new Date().toISOString().slice(0, 10)}`, data);
  };

  const handleRestoreUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        setMsg(`تمت استعادة ${res.restoredItems} سجل من النسخة الاحتياطية بنجاح.`);
        loadAll();
      } catch (err: any) {
        setMsg(err.message || 'تعذر قراءة ملف النسخة الاحتياطية.');
      }
    };
    r.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#D3AD68]" />
            <span>لوحة الإدارة المركزية والحوكمة</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            إدارة الأعضاء والصلاحيات (RBAC)، البلاغات، الجغرافيا الإدارية، الإعدادات، والنسخ الاحتياطي
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['users', 'المستخدمون والبلاغات'],
              ['roles', 'مصفوفة الصلاحيات'],
              ['geo', 'الولايات والمؤسسات'],
              ['settings', 'إعدادات المنصة'],
              ['backup', 'النسخ الاحتياطي والسجل'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSection(k)}
              className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
                section === k
                  ? 'bg-[#102D40] text-white border-[#102D40]'
                  : 'bg-white dark:bg-[#102D40] border-[#dce4ea] dark:border-[#1e465f]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs text-emerald-800 dark:text-emerald-200">
          {msg}
        </div>
      )}

      {section === 'users' && (
        <div className="space-y-6">
          <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 overflow-x-auto">
            <h2 className="text-sm font-bold mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#27866F]" />
              <span>إدارة الحسابات والأدوار ({usersList.length})</span>
            </h2>
            <table className="w-full text-xs">
              <thead className="bg-[#F3F6F8] dark:bg-[#0b202e]">
                <tr>
                  <th className="py-2.5 px-3 text-right">الاسم</th>
                  <th className="py-2.5 px-3 text-right">رقم العضوية</th>
                  <th className="py-2.5 px-3 text-right">الولاية</th>
                  <th className="py-2.5 px-3 text-right">الدور الوظيفي</th>
                  <th className="py-2.5 px-3 text-right">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
                {usersList.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-3 font-semibold">
                      {u.firstName ? `${u.firstName} ${u.lastName}` : u.username}
                      <div className="text-[11px] text-slate-400">@{u.username}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono-tabular">{u.nationalMemberNumber}</td>
                    <td className="py-2.5 px-3">{u.wilayaName || '—'}</td>
                    <td className="py-2.5 px-3">
                      <select
                        value={u.roleSlug}
                        disabled={u.id === user?.id}
                        onChange={(e) => updateUserRole(u.id, e.target.value)}
                        className="px-2 py-1 rounded border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                      >
                        <option value="member">عضو خريج</option>
                        <option value="wilaya_rep">ممثل الولاية</option>
                        <option value="admin">مدير المنصة</option>
                        {isSuperAdmin && <option value="super_admin">المسؤول العام</option>}
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        disabled={u.id === user?.id}
                        onClick={() => toggleUserActive(u.id, !u.isActive)}
                        className={`px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer ${
                          u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {u.isActive ? 'نشط' : 'معلق'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
            <h2 className="text-sm font-bold mb-3">مراجعة البلاغات ({modReports.length})</h2>
            {modReports.length === 0 ? (
              <p className="text-xs text-slate-400">لا توجد بلاغات مفتوحة.</p>
            ) : (
              <div className="space-y-2">
                {modReports.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] flex items-center justify-between text-xs"
                  >
                    <div>
                      <strong>{r.targetType} #{r.targetId}</strong> — {r.reason}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiRequest(`/api/admin/reports/${r.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: 'resolved' }),
                        });
                        loadAll();
                      }}
                      className="px-2.5 py-1 rounded bg-[#27866F] text-white cursor-pointer"
                    >
                      {r.status === 'resolved' ? 'تمت المعالجة' : 'إغلاق البلاغ'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'roles' && (
        <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4 overflow-x-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">مصفوفة الصلاحيات حسب الدور الوظيفي</h2>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={savePermissions}
                className="px-4 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer"
              >
                حفظ التغييرات
              </button>
            )}
          </div>
          <table className="w-full text-xs">
            <thead className="bg-[#F3F6F8] dark:bg-[#0b202e]">
              <tr>
                <th className="py-2.5 px-3 text-right">الصلاحية</th>
                <th className="py-2.5 px-3 text-center">المسؤول العام</th>
                <th className="py-2.5 px-3 text-center">مدير المنصة</th>
                <th className="py-2.5 px-3 text-center">ممثل الولاية</th>
                <th className="py-2.5 px-3 text-center">العضو</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
              {permissionsList.map((p) => {
                const allowed: string[] = JSON.parse(p.allowedRoles || '[]');
                return (
                  <tr key={p.key}>
                    <td className="py-2.5 px-3 font-medium">
                      {p.nameAr}
                      <div className="text-[10px] text-slate-400">{p.category}</div>
                    </td>
                    {(['super_admin', 'admin', 'wilaya_rep', 'member'] as const).map((r) => (
                      <td key={r} className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          disabled={!isSuperAdmin || r === 'super_admin'}
                          checked={allowed.includes(r)}
                          onChange={() => togglePermissionRole(p.key, r)}
                          className="accent-[#102D40]"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {section === 'geo' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleAddCommune}
            className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3"
          >
            <h2 className="text-sm font-bold">إضافة بلدية للنظام الجغرافي</h2>
            <select
              value={newCommune.wilayaCode}
              onChange={(e) => setNewCommune({ ...newCommune, wilayaCode: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <input
              type="text"
              placeholder="الدائرة"
              value={newCommune.dairaAr}
              onChange={(e) => setNewCommune({ ...newCommune, dairaAr: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer">
              إضافة البلدية
            </button>
          </form>

          <form
            onSubmit={handleAddInstitution}
            className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3"
          >
            <h2 className="text-sm font-bold">إضافة مؤسسة أو معهد تقنيات حضرية</h2>
            <input
              type="text"
              required
              placeholder="اسم الجامعة أو المعهد"
              value={newInst.nameAr}
              onChange={(e) => setNewInst({ ...newInst, nameAr: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <input
              type="text"
              placeholder="نوع المؤسسة (معهد / جامعة)"
              value={newInst.type}
              onChange={(e) => setNewInst({ ...newInst, type: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer">
              إضافة المؤسسة
            </button>
          </form>
        </div>
      )}

      {section === 'settings' && (
        <form
          onSubmit={saveSettings}
          className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4"
        >
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#D3AD68]" />
            <span>إعدادات المنصة والهوية والنصوص القانونية</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {settingsList.map((s, idx) => (
              <div key={s.key} className={s.value.length > 100 ? 'md:col-span-2' : ''}>
                <label className="block text-xs font-semibold mb-1">{s.key}</label>
                {s.value.length > 100 ? (
                  <textarea
                    rows={3}
                    value={s.value}
                    disabled={!isSuperAdmin}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettingsList((prev) => prev.map((it, i) => (i === idx ? { ...it, value: val } : it)));
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                ) : (
                  <input
                    type="text"
                    value={s.value}
                    disabled={!isSuperAdmin}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSettingsList((prev) => prev.map((it, i) => (i === idx ? { ...it, value: val } : it)));
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
                  />
                )}
              </div>
            ))}
          </div>
          {isSuperAdmin && (
            <button type="submit" className="px-6 py-2.5 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer">
              حفظ الإعدادات
            </button>
          )}
        </form>
      )}

      {section === 'backup' && (
        <div className="space-y-6">
          {isSuperAdmin && (
            <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#27866F]" />
                  <span>النسخ الاحتياطي والاستعادة (JSON)</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  تصدير نسخة احتياطية كاملة أو استعادة الإعدادات والمؤسسات والإعلانات من ملف JSON
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تنزيل نسخة احتياطية</span>
                </button>
                <label className="px-4 py-2 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-[#27866F]" />
                  <span>استعادة من ملف</span>
                  <input type="file" accept=".json" onChange={handleRestoreUpload} className="hidden" />
                </label>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5">
            <h2 className="text-sm font-bold mb-3">سجل العمليات الإدارية والأمنية (Audit Logs)</h2>
            <div className="max-h-96 overflow-y-auto divide-y divide-[#dce4ea] dark:divide-[#1e465f] text-xs">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <span className="font-mono-tabular font-bold text-[#102D40] dark:text-[#D3AD68]">
                      {log.action}
                    </span>
                    <span className="text-slate-500 mr-2">
                      · {log.actorUsername || 'النظام'} · {log.details}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono-tabular shrink-0">
                    {new Date(log.createdAt).toLocaleString('ar-DZ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
