import React, { useEffect, useState } from 'react';
import {
  Bell,
  Calendar,
  Check,
  Clock,
  Lightbulb,
  MapPin,
  Megaphone,
  Pin,
  Plus,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest, enqueueOfflineAction, loadDraft, saveDraft } from '../lib/api.ts';
import { useOnlineStatus } from '../hooks/usePWA.ts';
import { PushNotificationControlCard } from '../components/PWAComponents.tsx';
import {
  AnnouncementItem,
  EventItem,
  NotificationItem,
  ProposalItem,
  Wilaya,
} from '../types/gtu.ts';

const PROPOSAL_STATUSES = ['جديد', 'قيد الدراسة', 'مقبول', 'قيد التنفيذ', 'تم التنفيذ', 'مرفوض'];
const EVENT_TYPES = [
  'لقاء وطني',
  'اجتماع ولائي',
  'لقاء مهني',
  'ملتقى خريجين',
  'يوم دراسي',
  'مبادرة اجتماعية',
  'لقاء لم الشمل',
];

export const ProposalsAndInitiativesPage: React.FC<{ defaultKind: 'proposal' | 'initiative' }> = ({
  defaultKind,
}) => {
  const { user, refreshOfflineCount } = useAuth();
  const isOnline = useOnlineStatus();
  const isAdmin =
    user?.roleSlug === 'super_admin' || Boolean(user?.permissions?.includes('manage_proposals'));

  const [items, setItems] = useState<ProposalItem[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    title: loadDraft<string>('prop_title') || '',
    description: loadDraft<string>('prop_desc') || '',
    category: defaultKind === 'initiative' ? 'مبادرة مهنية' : 'اقتراح تطويري',
    kind: defaultKind,
    wilayaCode: '',
  });
  const [msg, setMsg] = useState('');

  // Admin modal state
  const [editingProp, setEditingProp] = useState<ProposalItem | null>(null);
  const [adminStatus, setAdminStatus] = useState('قيد الدراسة');
  const [adminResponse, setAdminResponse] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const loadData = () => {
    const params = new URLSearchParams({ kind: defaultKind });
    if (statusFilter) params.set('status', statusFilter);
    apiRequest<{ proposals: ProposalItem[] }>(`/api/proposals?${params.toString()}`)
      .then((d) => setItems(d.proposals))
      .catch(() => {});
  };

  useEffect(() => {
    setForm((f) => ({ ...f, kind: defaultKind }));
    loadData();
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, [defaultKind, statusFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (!isOnline) {
      enqueueOfflineAction({
        type: 'proposal',
        url: '/api/proposals',
        payload: { ...form, kind: defaultKind },
        label: form.title,
      });
      refreshOfflineCount();
      setForm({ title: '', description: '', category: 'اقتراح تطويري', kind: defaultKind, wilayaCode: '' });
      saveDraft('prop_title', '');
      saveDraft('prop_desc', '');
      setShowForm(false);
      setMsg('تم حفظ الاقتراح في قائمة الانتظار وسيتم إرساله تلقائياً عند عودة الاتصال.');
      return;
    }

    await apiRequest('/api/proposals', {
      method: 'POST',
      body: JSON.stringify({ ...form, kind: defaultKind }),
    });
    setForm({ title: '', description: '', category: 'اقتراح تطويري', kind: defaultKind, wilayaCode: '' });
    saveDraft('prop_title', '');
    saveDraft('prop_desc', '');
    setShowForm(false);
    setMsg('تم إيداع مساهمتك بنجاح.');
    loadData();
  };

  const handleSupport = async (id: number) => {
    await apiRequest(`/api/proposals/${id}/support`, { method: 'POST' });
    loadData();
  };

  const handleAdminUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProp) return;
    await apiRequest(`/api/proposals/${editingProp.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: adminStatus,
        adminResponse,
        rejectionReason,
      }),
    });
    setEditingProp(null);
    loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-[#D3AD68]" />
            <span>{defaultKind === 'initiative' ? 'المبادرات الوطنية والولائية' : 'الاقتراحات والتطوير'}</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            تقديم الأفكار والمشاريع، متابعة مراحل دراستها، والاطلاع على ردود الإدارة وسجل التطور
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="px-4 py-2 rounded-lg bg-[#27866F] hover:bg-[#1f6d5a] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{defaultKind === 'initiative' ? 'إطلاق مبادرة جديدة' : 'تقديم اقتراح جديد'}</span>
        </button>
      </div>

      {msg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-xs text-emerald-800 dark:text-emerald-200">
          {msg}
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setStatusFilter('')}
          className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
            statusFilter === ''
              ? 'bg-[#102D40] text-white border-[#102D40]'
              : 'bg-white dark:bg-[#102D40] border-[#dce4ea] dark:border-[#1e465f]'
          }`}
        >
          الكل
        </button>
        {PROPOSAL_STATUSES.map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer ${
              statusFilter === st
                ? 'bg-[#102D40] text-white border-[#102D40]'
                : 'bg-white dark:bg-[#102D40] border-[#dce4ea] dark:border-[#1e465f]'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1">العنوان *</label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => {
                  setForm({ ...form, title: e.target.value });
                  saveDraft('prop_title', e.target.value);
                }}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">التصنيف</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              >
                <option value="اقتراح تطويري">اقتراح تطويري</option>
                <option value="مبادرة مهنية">مبادرة مهنية</option>
                <option value="مبادرة اجتماعية">مبادرة اجتماعية</option>
                <option value="اقتراح تنظيمي">اقتراح تنظيمي</option>
                <option value="تطوير تقني">تطوير تقني</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">الولاية المعنية (اختياري - اتركه فارغاً للوطني)</label>
            <select
              value={form.wilayaCode}
              onChange={(e) => setForm({ ...form, wilayaCode: e.target.value })}
              className="w-full sm:w-72 px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              <option value="">نطاق وطني (جميع الولايات)</option>
              {wilayas.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} - {w.nameAr}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">شرح الفكرة والأهداف *</label>
            <textarea
              required
              rows={4}
              value={form.description}
              onChange={(e) => {
                setForm({ ...form, description: e.target.value });
                saveDraft('prop_desc', e.target.value);
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold cursor-pointer"
            >
              إرسال وحفظ
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg border border-[#dce4ea] text-xs cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="space-y-4">
        {items.length === 0 ? (
          <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-12 text-center text-sm text-slate-400">
            لا توجد مساهمات مسجلة في هذا القسم حالياً.
          </div>
        ) : (
          items.map((p) => (
            <div
              key={p.id}
              className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-300 mb-1">
                    <span>{p.category}</span>
                    <span> · </span>
                    <span>{p.wilayaName ? `ولاية ${p.wilayaName}` : 'وطني'}</span>
                    <span> · </span>
                    <span>بواسطة {p.authorName}</span>
                    <span> · </span>
                    <span>{new Date(p.createdAt).toLocaleDateString('ar-DZ')}</span>
                  </div>
                  <h3 className="text-base font-bold text-[#102D40] dark:text-white">{p.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#27866F]">{p.status}</span>
                  <button
                    type="button"
                    onClick={() => handleSupport(p.id)}
                    className="px-3 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] hover:bg-[#F3F6F8] dark:hover:bg-[#173D53] text-xs font-medium flex items-center gap-1 cursor-pointer tabular-nums"
                  >
                    <ThumbsUp className="w-3.5 h-3.5 text-[#D3AD68]" />
                    <span>{p.supportersCount}</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingProp(p);
                        setAdminStatus(p.status);
                        setAdminResponse(p.adminResponse || '');
                        setRejectionReason(p.rejectionReason || '');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#102D40] text-white text-xs cursor-pointer"
                    >
                      معالجة
                    </button>
                  )}
                </div>
              </div>

              <p className="text-sm text-[#172B38] dark:text-slate-200 leading-relaxed">{p.description}</p>

              {(p.adminResponse || p.rejectionReason) && (
                <div className="p-3 rounded-lg bg-[#F3F6F8] dark:bg-[#0b202e] text-xs space-y-1">
                  <div className="font-bold text-[#102D40] dark:text-[#D3AD68]">رد الإدارة:</div>
                  {p.adminResponse && <div>{p.adminResponse}</div>}
                  {p.rejectionReason && <div className="text-red-600">سبب الرفض: {p.rejectionReason}</div>}
                </div>
              )}

              {p.history && p.history.length > 0 && (
                <div className="pt-2 border-t border-[#dce4ea] dark:border-[#1e465f] text-[11px] text-slate-500 dark:text-slate-300 space-y-1">
                  <div className="font-semibold flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>سجل التطور:</span>
                  </div>
                  {p.history.map((h) => (
                    <div key={h.id}>
                      {new Date(h.createdAt).toLocaleDateString('ar-DZ')} — <strong>{h.newStatus}</strong>
                      {h.note ? `: ${h.note}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {editingProp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleAdminUpdate}
            className="w-full max-w-md rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-[#102D40] dark:text-white">
              تحديث حالة: {editingProp.title}
            </h3>
            <select
              value={adminStatus}
              onChange={(e) => setAdminStatus(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              {PROPOSAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <textarea
              rows={3}
              placeholder="رد وتوجيهات الإدارة..."
              value={adminResponse}
              onChange={(e) => setAdminResponse(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            {adminStatus === 'مرفوض' && (
              <textarea
                rows={2}
                required
                placeholder="سبب الرفض (إلزامي)..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-red-300 bg-[#F3F6F8] dark:bg-[#0b202e]"
              />
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer"
              >
                حفظ وتحديث
              </button>
              <button
                type="button"
                onClick={() => setEditingProp(null)}
                className="px-4 py-2 rounded-lg border border-[#dce4ea] text-xs cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export const EventsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate =
    user?.roleSlug === 'super_admin' || Boolean(user?.permissions?.includes('manage_events'));

  const [events, setEvents] = useState<EventItem[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    eventType: 'لقاء مهني',
    eventDate: '',
    location: '',
    meetingUrl: '',
    wilayaCode: '',
    organizerName: 'إدارة المنصة الوطنية GTU',
    maxSeats: '',
  });

  const loadEvents = () => {
    apiRequest<{ events: EventItem[] }>('/api/events').then((d) => setEvents(d.events)).catch(() => {});
  };

  useEffect(() => {
    loadEvents();
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        maxSeats: form.maxSeats ? Number(form.maxSeats) : null,
      }),
    });
    setShowCreate(false);
    setForm({
      title: '',
      description: '',
      eventType: 'لقاء مهني',
      eventDate: '',
      location: '',
      meetingUrl: '',
      wilayaCode: '',
      organizerName: 'إدارة المنصة الوطنية GTU',
      maxSeats: '',
    });
    loadEvents();
  };

  const handleRsvp = async (eventId: number, status: 'attending' | 'declined') => {
    await apiRequest(`/api/events/${eventId}/rsvp`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    loadEvents();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#27866F]" />
            <span>المواعيد واللقاءات والفعاليات</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            جدول اللقاءات الوطنية، الاجتماعات الولائية، الأيام الدراسية، ولقاءات لم الشمل
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreate((s) => !s)}
            className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة فعالية جديدة</span>
          </button>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <input
              type="text"
              required
              placeholder="عنوان الفعالية *"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="sm:col-span-2 px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <select
              value={form.eventType}
              onChange={(e) => setForm({ ...form, eventType: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              required
              value={form.eventDate}
              onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <input
              type="text"
              placeholder="المكان أو القاعة"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <select
              value={form.wilayaCode}
              onChange={(e) => setForm({ ...form, wilayaCode: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              <option value="">الولاية (وطني إذا فارغ)</option>
              {wilayas.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} - {w.nameAr}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="الجهة المنظمة"
              value={form.organizerName}
              onChange={(e) => setForm({ ...form, organizerName: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <input
              type="number"
              placeholder="عدد المقاعد (اختياري)"
              value={form.maxSeats}
              onChange={(e) => setForm({ ...form, maxSeats: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
            <input
              type="url"
              placeholder="رابط الاجتماع عن بعد (اختياري)"
              value={form.meetingUrl}
              onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            />
          </div>
          <textarea
            required
            rows={3}
            placeholder="تفاصيل ومحاور الفعالية..."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />
          <button type="submit" className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer">
            نشر الفعالية
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {events.map((ev) => (
          <div
            key={ev.id}
            className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-2.5">
              <div className="text-xs text-[#27866F] font-semibold">
                {ev.eventType} · {new Date(ev.eventDate).toLocaleString('ar-DZ')}
              </div>
              <h3 className="text-lg font-bold text-[#102D40] dark:text-white">{ev.title}</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{ev.description}</p>

              <div className="text-xs text-slate-500 dark:text-slate-300 space-y-1 pt-2">
                {ev.location && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#D3AD68]" />
                    <span>{ev.location}</span>
                  </div>
                )}
                <div>المنظم: {ev.organizerName}</div>
                <div className="font-mono-tabular">
                  المؤكدون للحضور: {ev.attendingCount}
                  {ev.maxSeats ? ` / ${ev.maxSeats}` : ''}
                </div>
                {ev.meetingUrl && (
                  <div>
                    رابط اللقاء:{' '}
                    <a href={ev.meetingUrl} target="_blank" rel="noreferrer" className="underline text-[#27866F]">
                      فتح الرابط
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-[#dce4ea] dark:border-[#1e465f]">
              <button
                type="button"
                onClick={() => handleRsvp(ev.id, 'attending')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold cursor-pointer ${
                  ev.myStatus === 'attending'
                    ? 'bg-[#27866F] text-white'
                    : 'bg-[#F3F6F8] dark:bg-[#0b202e] text-[#102D40] dark:text-white'
                }`}
              >
                {ev.myStatus === 'attending' ? 'تم تأكيد حضورك' : 'تأكيد الحضور'}
              </button>
              <button
                type="button"
                onClick={() => handleRsvp(ev.id, 'declined')}
                className={`px-4 py-2 rounded-lg text-xs font-medium cursor-pointer ${
                  ev.myStatus === 'declined'
                    ? 'bg-red-600 text-white'
                    : 'border border-[#dce4ea] dark:border-[#24526e]'
                }`}
              >
                اعتذار
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const AnnouncementsPage: React.FC = () => {
  const { user } = useAuth();
  const canPublish =
    user?.roleSlug === 'super_admin' || Boolean(user?.permissions?.includes('publish_announcements'));
  const isAdmin =
    user?.roleSlug === 'super_admin' || Boolean(user?.permissions?.includes('publish_announcements'));

  const [list, setList] = useState<AnnouncementItem[]>([]);
  const [wilayas, setWilayas] = useState<Wilaya[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '',
    content: '',
    scope: 'national',
    wilayaCode: '',
    isPinned: false,
  });

  const loadAnns = () => {
    apiRequest<{ announcements: AnnouncementItem[] }>('/api/announcements')
      .then((d) => setList(d.announcements))
      .catch(() => {});
  };

  useEffect(() => {
    loadAnns();
    apiRequest<{ wilayas: Wilaya[] }>('/api/wilayas').then((d) => setWilayas(d.wilayas)).catch(() => {});
  }, []);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/announcements', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setForm({ title: '', content: '', scope: 'national', wilayaCode: '', isPinned: false });
    setShowCreate(false);
    loadAnns();
  };

  const handleTogglePin = async (ann: AnnouncementItem) => {
    await apiRequest(`/api/announcements/${ann.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPinned: !ann.isPinned }),
    });
    loadAnns();
  };

  const handleDelete = async (id: number) => {
    await apiRequest(`/api/announcements/${id}`, { method: 'DELETE' });
    loadAnns();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-[#D3AD68]" />
            <span>الإعلانات والأخبار الرسمية</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-300 mt-1">
            البيانات الرسمية، التوجيهات، والأخبار الوطنية والولائية لمنصة GTU
          </p>
        </div>
        {canPublish && (
          <button
            type="button"
            onClick={() => setShowCreate((s) => !s)}
            className="px-4 py-2 rounded-lg bg-[#102D40] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>نشر إعلان جديد</span>
          </button>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={handlePublish}
          className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] p-5 space-y-4"
        >
          <input
            type="text"
            required
            placeholder="عنوان الإعلان الرسمي *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
            >
              {user?.roleSlug !== 'wilaya_rep' && <option value="national">نطاق وطني (جميع الأعضاء)</option>}
              <option value="wilaya">نطاق ولائي محدد</option>
            </select>
            {form.scope === 'wilaya' && (
              <select
                required
                value={form.wilayaCode}
                onChange={(e) => setForm({ ...form, wilayaCode: e.target.value })}
                className="px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
              >
                <option value="">اختر الولاية المستهدفة</option>
                {wilayas.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code} - {w.nameAr}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={form.isPinned}
                onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
              />
              <span>تثبيت الإعلان في الأعلى</span>
            </label>
          </div>
          <textarea
            required
            rows={4}
            placeholder="نص البيان أو الإعلان..."
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#dce4ea] dark:border-[#24526e] bg-[#F3F6F8] dark:bg-[#0b202e]"
          />
          <button type="submit" className="px-5 py-2 rounded-lg bg-[#27866F] text-white text-xs font-bold cursor-pointer">
            نشر وإرسال الإشعارات
          </button>
        </form>
      )}

      <div className="space-y-4">
        {list.map((ann) => (
          <div
            key={ann.id}
            className={`rounded-xl bg-white dark:bg-[#102D40] border p-5 space-y-2 ${
              ann.isPinned ? 'border-[#D3AD68]' : 'border-[#dce4ea] dark:border-[#1e465f]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-300">
                  {ann.isPinned ? 'مثبت · ' : ''}
                  {ann.scope === 'wilaya' && ann.wilayaName ? `ولاية ${ann.wilayaName}` : 'إعلان وطني'}
                  {' · '}
                  {new Date(ann.publishedAt).toLocaleDateString('ar-DZ')}
                </div>
                <h3 className="text-base font-bold text-[#102D40] dark:text-white mt-1">{ann.title}</h3>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTogglePin(ann)}
                    className="p-1.5 rounded border border-[#dce4ea] dark:border-[#24526e] cursor-pointer"
                    title="تثبيت / إلغاء التثبيت"
                  >
                    <Pin className={`w-3.5 h-3.5 ${ann.isPinned ? 'text-[#D3AD68]' : 'text-slate-400'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(ann.id)}
                    className="p-1.5 rounded border border-[#dce4ea] dark:border-[#24526e] text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm text-[#172B38] dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {ann.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const NotificationsPage: React.FC = () => {
  const { refreshUser } = useAuth();
  const [list, setList] = useState<NotificationItem[]>([]);

  const load = () => {
    apiRequest<{ notifications: NotificationItem[] }>('/api/notifications')
      .then((d) => setList(d.notifications))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const markRead = async (id: number) => {
    await apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' });
    load();
    refreshUser();
  };

  const markAllRead = async () => {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    load();
    refreshUser();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[#102D40] dark:text-white font-display flex items-center gap-2">
          <Bell className="w-5 h-5 text-[#D3AD68]" />
          <span>مركز الإشعارات</span>
        </h1>
        <button
          type="button"
          onClick={markAllRead}
          className="px-3.5 py-1.5 rounded-lg border border-[#dce4ea] dark:border-[#24526e] text-xs font-medium hover:bg-white dark:hover:bg-[#173D53] flex items-center gap-1.5 cursor-pointer"
        >
          <Check className="w-3.5 h-3.5 text-[#27866F]" />
          <span>تحديد الكل كمقروء</span>
        </button>
      </div>

      <PushNotificationControlCard />

      <div className="rounded-xl bg-white dark:bg-[#102D40] border border-[#dce4ea] dark:border-[#1e465f] divide-y divide-[#dce4ea] dark:divide-[#1e465f]">
        {list.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">لا توجد إشعارات في السجل.</div>
        ) : (
          list.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex items-start justify-between gap-4 ${
                n.isRead ? 'opacity-75' : 'bg-[#F3F6F8]/60 dark:bg-[#173D53]/30'
              }`}
            >
              <div>
                <div className="text-sm font-bold text-[#102D40] dark:text-white">{n.title}</div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{n.body}</p>
                <div className="text-[11px] text-slate-400 mt-1">
                  {new Date(n.createdAt).toLocaleString('ar-DZ')}
                </div>
              </div>
              {!n.isRead && (
                <button
                  type="button"
                  onClick={() => markRead(n.id)}
                  className="text-xs text-[#27866F] font-semibold hover:underline shrink-0 cursor-pointer"
                >
                  تمت القراءة
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
