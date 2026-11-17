import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  announcements,
  communes,
  conversations,
  events,
  groups,
  institutions,
  permissions,
  platformSettings,
  roles,
  wilayas,
} from './schema.ts';
import algeriaGeo from '../data/algeria-wilayas-communes.json' with { type: 'json' };

const WILAYA_REGIONS: Record<string, string> = {
  '01': 'الجنوب', '02': 'الشمال', '03': 'الهضاب العليا', '04': 'الهضاب العليا', '05': 'الهضاب العليا',
  '06': 'الشمال', '07': 'الجنوب', '08': 'الجنوب', '09': 'الشمال', '10': 'الشمال',
  '11': 'الجنوب', '12': 'الهضاب العليا', '13': 'الشمال', '14': 'الهضاب العليا', '15': 'الشمال',
  '16': 'الشمال', '17': 'الهضاب العليا', '18': 'الشمال', '19': 'الهضاب العليا', '20': 'الهضاب العليا',
  '21': 'الشمال', '22': 'الشمال', '23': 'الشمال', '24': 'الشمال', '25': 'الشمال',
  '26': 'الشمال', '27': 'الشمال', '28': 'الهضاب العليا', '29': 'الشمال', '30': 'الجنوب',
  '31': 'الشمال', '32': 'الهضاب العليا', '33': 'الجنوب', '34': 'الهضاب العليا', '35': 'الشمال',
  '36': 'الشمال', '37': 'الجنوب', '38': 'الهضاب العليا', '39': 'الجنوب', '40': 'الهضاب العليا',
  '41': 'الهضاب العليا', '42': 'الشمال', '43': 'الشمال', '44': 'الشمال', '45': 'الهضاب العليا',
  '46': 'الشمال', '47': 'الجنوب', '48': 'الشمال', '49': 'الجنوب', '50': 'الجنوب',
  '51': 'الجنوب', '52': 'الجنوب', '53': 'الجنوب', '54': 'الجنوب', '55': 'الجنوب',
  '56': 'الجنوب', '57': 'الجنوب', '58': 'الجنوب',
};

const OFFICIAL_INSTITUTIONS = [
  { nameAr: 'معهد تسيير التقنيات الحضرية – جامعة قسنطينة 3 صالح بوبنيدر', type: 'معهد تقنيات حضرية', wilayaCode: '25' },
  { nameAr: 'معهد تسيير التقنيات الحضرية – جامعة محمد بوضياف المسيلة', type: 'معهد تقنيات حضرية', wilayaCode: '28' },
  { nameAr: 'معهد تسيير التقنيات الحضرية – جامعة العربي بن مهيدي أم البواقي', type: 'معهد تقنيات حضرية', wilayaCode: '04' },
  { nameAr: 'جامعة العلوم والتكنولوجيا محمد بوضياف وهران (USTO-MB)', type: 'جامعة', wilayaCode: '31' },
  { nameAr: 'جامعة الجزائر 1 بن يوسف بن خدة', type: 'جامعة', wilayaCode: '16' },
  { nameAr: 'جامعة قاصدي مرباح ورقلة', type: 'جامعة', wilayaCode: '30' },
  { nameAr: 'جامعة فرحات عباس سطيف 1', type: 'جامعة', wilayaCode: '19' },
  { nameAr: 'جامعة عمار ثليجي الأغواط', type: 'جامعة', wilayaCode: '03' },
  { nameAr: 'جامعة باجي مختار عنابة', type: 'جامعة', wilayaCode: '23' },
  { nameAr: 'جامعة أبو بكر بلقايد تلمسان', type: 'جامعة', wilayaCode: '13' },
  { nameAr: 'جامعة الحاج لخضر باتنة 1', type: 'جامعة', wilayaCode: '05' },
  { nameAr: 'جامعة محمد خيضر بسكرة', type: 'جامعة', wilayaCode: '07' },
  { nameAr: 'جامعة عبد الحميد ابن باديس مستغانم', type: 'جامعة', wilayaCode: '27' },
  { nameAr: 'جامعة زيان عاشور الجلفة', type: 'جامعة', wilayaCode: '17' },
  { nameAr: 'المدرسة الوطنية العليا للتقنيات الحضرية / معهد وطني آخر', type: 'مؤسسة تكوين عليا', wilayaCode: '16' },
];

const DEFAULT_ROLES = [
  { slug: 'super_admin', nameAr: 'المسؤول العام (Super Admin)', description: 'صلاحيات كاملة لإدارة المنصة والإعدادات والنسخ الاحتياطية والصلاحيات والأدوار', level: 100, isSystem: true },
  { slug: 'admin', nameAr: 'مدير المنصة (Admin)', description: 'إدارة الحسابات والبلاغات والإعلانات والفعاليات والاقتراحات', level: 70, isSystem: true },
  { slug: 'wilaya_rep', nameAr: 'ممثل الولاية', description: 'متابعة أعضاء الولاية وتنظيم المجموعة الولائية واقتراح اللقاءات المحلية', level: 40, isSystem: true },
  { slug: 'member', nameAr: 'عضو خريج', description: 'إدارة الملف الشخصي وتصفح الدليل والتواصل والمشاركة في المبادرات', level: 10, isSystem: true },
];

const DEFAULT_PERMISSIONS = [
  {
    key: 'view_admin_panel',
    nameAr: 'الدخول إلى لوحة الإدارة المستقلة',
    category: 'الإدارة والحوكمة',
    description: 'يسمح بالولوج إلى بوابة الإدارة المستقلة والاطلاع على نظرة عامة على النظام.',
    allowedRoles: JSON.stringify(['super_admin', 'admin', 'wilaya_rep']),
    isSystem: true,
  },
  {
    key: 'manage_platform',
    nameAr: 'إدارة إعدادات المنصة والهوية',
    category: 'الإدارة والحوكمة',
    description: 'تعديل اسم المنصة والألوان والروابط والنصوص القانونية وسياسة الخصوصية.',
    allowedRoles: JSON.stringify(['super_admin']),
    isSystem: true,
  },
  {
    key: 'manage_roles',
    nameAr: 'إنشاء وتعديل وحذف الأدوار الوظيفية',
    category: 'الصلاحيات والأدوار',
    description: 'إضافة أدوار وظيفية مخصصة وتحديد مستوياتها الهرمية وأوصافها.',
    allowedRoles: JSON.stringify(['super_admin']),
    isSystem: true,
  },
  {
    key: 'manage_permissions',
    nameAr: 'التحكم بمصفوفة الصلاحيات والاستثناءات الفردية',
    category: 'الصلاحيات والأدوار',
    description: 'تعديل مصفوفة صلاحيات الأدوار ومنح أو حجب صلاحيات استثنائية لأي عضو.',
    allowedRoles: JSON.stringify(['super_admin']),
    isSystem: true,
  },
  {
    key: 'manage_users',
    nameAr: 'إدارة حسابات الأعضاء وتعيين الأدوار',
    category: 'إدارة الأعضاء',
    description: 'تغيير أدوار الأعضاء وتعيين ممثلي الولايات وتفعيل الحسابات أو تعليقها.',
    allowedRoles: JSON.stringify(['super_admin', 'admin']),
    isSystem: true,
  },
  {
    key: 'delete_users',
    nameAr: 'حذف حسابات الأعضاء نهائياً',
    category: 'إدارة الأعضاء',
    description: 'صلاحية حساسة تتيح حذف حساب عضو وجميع بياناته من قاعدة البيانات.',
    allowedRoles: JSON.stringify(['super_admin']),
    isSystem: true,
  },
  {
    key: 'manage_user_sessions',
    nameAr: 'مراقبة وإنهاء جلسات الأعضاء النشطة',
    category: 'الأمان والبيانات',
    description: 'عرض الأجهزة المتصلة لحسابات الأعضاء وإنهاء الجلسات قسرياً.',
    allowedRoles: JSON.stringify(['super_admin', 'admin']),
    isSystem: true,
  },
  {
    key: 'view_directory_private_info',
    nameAr: 'الاطلاع على البيانات الخاصة في الدليل',
    category: 'إدارة الأعضاء',
    description: 'رؤية أرقام الهواتف وتواريخ الميلاد والبريد للأعضاء رغم إخفائها الافتراضي.',
    allowedRoles: JSON.stringify(['super_admin', 'admin']),
    isSystem: true,
  },
  {
    key: 'manage_geography',
    nameAr: 'إدارة واستيراد الولايات والبلديات والمؤسسات',
    category: 'النظام الجغرافي',
    description: 'إضافة البلديات واستيراد القوائم الإدارية وإدارة المعاهد والجامعات.',
    allowedRoles: JSON.stringify(['super_admin', 'admin']),
    isSystem: true,
  },
  {
    key: 'publish_announcements',
    nameAr: 'نشر وتثبيت وتعديل الإعلانات الرسمية',
    category: 'التواصل والإعلام',
    description: 'إصدار بيانات رسمية وتثبيتها وإرسال تنبيهات للمستخدمين.',
    allowedRoles: JSON.stringify(['super_admin', 'admin', 'wilaya_rep']),
    isSystem: true,
  },
  {
    key: 'moderate_chat',
    nameAr: 'الإشراف على المحادثات ومراجعة البلاغات',
    category: 'التواصل والإعلام',
    description: 'مراقبة رسائل الشات وحذف المخالفة ومعالجة بلاغات الأعضاء.',
    allowedRoles: JSON.stringify(['super_admin', 'admin', 'wilaya_rep']),
    isSystem: true,
  },
  {
    key: 'manage_proposals',
    nameAr: 'معالجة الاقتراحات والمبادرات والرد عليها',
    category: 'المجتمع والمبادرات',
    description: 'تغيير حالة الاقتراحات والمبادرات وتدوين الرد الرسمي أو أسباب الرفض.',
    allowedRoles: JSON.stringify(['super_admin', 'admin']),
    isSystem: true,
  },
  {
    key: 'manage_events',
    nameAr: 'إنشاء وتنظيم وإلغاء المواعيد والفعاليات',
    category: 'الفعاليات',
    description: 'جدولة الملتقيات الوطنية والاجتماعات الولائية وإدارتها.',
    allowedRoles: JSON.stringify(['super_admin', 'admin', 'wilaya_rep']),
    isSystem: true,
  },
  {
    key: 'export_reports',
    nameAr: 'تصدير التقارير الإحصائية المتقدمة',
    category: 'التقارير',
    description: 'استخراج تقارير Excel وCSV وJSON والطباعة الرسمية.',
    allowedRoles: JSON.stringify(['super_admin', 'admin', 'wilaya_rep']),
    isSystem: true,
  },
  {
    key: 'view_audit_logs',
    nameAr: 'الاطلاع على سجل العمليات الإدارية والأمنية',
    category: 'الأمان والبيانات',
    description: 'تصفح وتصدير سجل المراجعة الكامل للعمليات الحساسة.',
    allowedRoles: JSON.stringify(['super_admin', 'admin']),
    isSystem: true,
  },
  {
    key: 'manage_backups',
    nameAr: 'تصدير واستعادة النسخ الاحتياطية',
    category: 'الأمان والبيانات',
    description: 'إنشاء نسخ احتياطية JSON شاملة للمنصة أو استعادة البيانات منها.',
    allowedRoles: JSON.stringify(['super_admin']),
    isSystem: true,
  },
];

const DEFAULT_SETTINGS = [
  { key: 'platform_name', value: 'المنصة الوطنية لخريجي التقنيات الحضرية', category: 'brand' },
  { key: 'platform_short_name', value: 'GTU', category: 'brand' },
  { key: 'platform_country', value: 'الجمهورية الجزائرية الديمقراطية الشعبية', category: 'brand' },
  { key: 'primary_color', value: '#102D40', category: 'appearance' },
  { key: 'accent_gold', value: '#D3AD68', category: 'appearance' },
  { key: 'accent_green', value: '#27866F', category: 'appearance' },
  { key: 'contact_email', value: 'contact@gtu-algeria.dz', category: 'contact' },
  { key: 'contact_phone', value: '+213 21 00 00 00', category: 'contact' },
  { key: 'hero_title', value: 'الفضاء الرقمي الوطني الموحد لخريجي التقنيات الحضرية في الجزائر', category: 'content' },
  { key: 'hero_subtitle', value: 'شبكة مهنية واجتماعية وإدارية تجمع مهندسي وتقنيي التسيير والتقنيات الحضرية عبر 58 ولاية و1541 بلدية لتبادل الخبرات وتنسيق المبادرات.', category: 'content' },
  { key: 'privacy_policy_text', value: 'تلتزم منصة GTU بحماية البيانات الشخصية للأعضاء وفق التشريع الجزائري المعمول به. يتم تشفير كلمات المرور بخوارزميات آمنة، وتُخفى أرقام الهواتف وتواريخ الميلاد افتراضياً عن بقية الأعضاء ولا تُعرض إلا بموافقة صاحب الحساب. يحق لكل عضو تعديل بياناته أو طلب حذف حسابه في أي وقت.', category: 'legal' },
  { key: 'terms_of_use_text', value: 'التسجيل في المنصة مخصص لخريجي وطلبة تخصص التقنيات الحضرية والهندسة الحضرية في الجزائر. يلتزم العضو بصحة البيانات المقدمة واحترام أخلاقيات الحوار المهني وعدم نشر محتوى مخالف أو بيانات شخصية للغير دون إذن.', category: 'legal' },
];

let seedPromise: Promise<void> | null = null;
let seededDone = false;

export async function ensureDatabaseSeeded(): Promise<void> {
  if (seededDone) return;
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  await seedPromise;
}

async function runSeed(): Promise<void> {
  // Check if roles & wilayas already populated
  const [{ value: wilayaCount }] = await db.select({ value: count() }).from(wilayas);

  // Ensure all default system roles exist & are flagged isSystem: true
  await db.insert(roles).values(DEFAULT_ROLES).onConflictDoNothing();
  for (const r of DEFAULT_ROLES) {
    await db.update(roles).set({ isSystem: true }).where(eq(roles.slug, r.slug));
  }

  // Ensure all default system permissions exist & retain descriptions/system flag
  await db.insert(permissions).values(DEFAULT_PERMISSIONS).onConflictDoNothing();
  for (const p of DEFAULT_PERMISSIONS) {
    await db
      .update(permissions)
      .set({ isSystem: true, description: p.description })
      .where(eq(permissions.key, p.key));
  }

  const [{ value: settingsCount }] = await db.select({ value: count() }).from(platformSettings);
  if (settingsCount === 0) {
    await db.insert(platformSettings).values(DEFAULT_SETTINGS).onConflictDoNothing();
  }

  if (wilayaCount < 58) {
    const wilayaRows = algeriaGeo.wilayas.map((w) => ({
      code: w.code,
      nameAr: w.nameAr,
      nameEn: w.nameEn,
      region: WILAYA_REGIONS[w.code] || 'الشمال',
      isActive: true,
    }));
    await db.insert(wilayas).values(wilayaRows).onConflictDoNothing();
  }

  const allWilayas = await db.select().from(wilayas);
  const wilayaIdByCode = new Map(allWilayas.map((w) => [w.code, w.id]));

  const [{ value: communeCount }] = await db.select({ value: count() }).from(communes);
  if (communeCount < 1500) {
    const communeRows = algeriaGeo.communes
      .map((c) => {
        const wId = wilayaIdByCode.get(c.wilayaCode);
        if (!wId) return null;
        return {
          officialId: c.id,
          wilayaId: wId,
          wilayaCode: c.wilayaCode,
          dairaAr: c.dairaAr,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    for (let i = 0; i < communeRows.length; i += 300) {
      const batch = communeRows.slice(i, i + 300);
      await db.insert(communes).values(batch).onConflictDoNothing();
    }
  }

  const [{ value: instCount }] = await db.select({ value: count() }).from(institutions);
  if (instCount === 0) {
    await db
      .insert(institutions)
      .values(
        OFFICIAL_INSTITUTIONS.map((inst) => ({
          nameAr: inst.nameAr,
          type: inst.type,
          wilayaId: wilayaIdByCode.get(inst.wilayaCode) || null,
          isActive: true,
        }))
      )
      .onConflictDoNothing();
  }

  // Ensure national chat, official announcements channel, and 58 wilaya groups + conversations exist
  const [{ value: groupCount }] = await db.select({ value: count() }).from(groups);
  if (groupCount < 59) {
    const nationalGroupSlug = 'national-general';
    await db
      .insert(groups)
      .values({
        slug: nationalGroupSlug,
        nameAr: 'الشات الوطني العام لخريجي التقنيات الحضرية',
        description: 'فضاء التواصل الوطني الموحد لجميع خريجي التخصص عبر كافة ولايات الجزائر.',
        isNational: true,
      })
      .onConflictDoNothing();

    for (const w of allWilayas) {
      await db
        .insert(groups)
        .values({
          slug: `wilaya-${w.code}`,
          nameAr: `مجموعة خريجي ولاية ${w.nameAr}`,
          description: `الفضاء الولائي لخريجي التقنيات الحضرية في ولاية ${w.nameAr} (${w.code}).`,
          wilayaId: w.id,
          isNational: false,
        })
        .onConflictDoNothing();
    }

    const allGroups = await db.select().from(groups);
    const existingConvs = await db.select().from(conversations);
    const existingGroupIds = new Set(existingConvs.map((c) => c.groupId).filter(Boolean));
    const hasOfficial = existingConvs.some((c) => c.type === 'official_channel');

    if (!hasOfficial) {
      await db.insert(conversations).values({
        type: 'official_channel',
        title: 'قناة إعلانات وتوجيهات الإدارة الرسمية',
      });
    }

    const convsToInsert = allGroups
      .filter((g) => !existingGroupIds.has(g.id))
      .map((g) => ({
        type: g.isNational ? 'national' : 'wilaya_group',
        title: g.nameAr,
        groupId: g.id,
      }));

    if (convsToInsert.length > 0) {
      await db.insert(conversations).values(convsToInsert);
    }
  }

  // Seed initial official welcome announcement & founding event if none exist
  const [{ value: annCount }] = await db.select({ value: count() }).from(announcements);
  if (annCount === 0) {
    await db.insert(announcements).values({
      title: 'الإطلاق الرسمي للمنصة الوطنية لخريجي التقنيات الحضرية – GTU',
      content:
        'يسعدنا الإعلان عن الافتتاح الرسمي للفضاء الرقمي الوطني الموحد لخريجي التقنيات الحضرية في الجزائر. ندعو جميع الخريجين عبر الولايات الـ 58 إلى التسجيل المجاني لاستصدار رقم العضوية الوطني، وتوثيق مسارهم الأكاديمي والمهني، والانضمام إلى المجموعات الولائية.',
      scope: 'national',
      isPinned: true,
    });
  }

  const [{ value: evCount }] = await db.select({ value: count() }).from(events);
  if (evCount === 0) {
    const nextMonth = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    await db.insert(events).values({
      title: 'الملتقى الوطني الأول لخريجي التقنيات الحضرية في الجزائر',
      description:
        'لقاء وطني جامع لمناقشة آفاق مهنة مهندس وتقني التسيير والتقنيات الحضرية، تبادل الخبرات الميدانية في التهيئة العمرانية، وتنسيق المبادرات الولائية.',
      eventType: 'ملتقى خريجين',
      eventDate: nextMonth,
      location: 'الجزائر العاصمة – قصر الثقافة / مشاركة رقمية متزامنة',
      wilayaId: wilayaIdByCode.get('16') || null,
      organizerName: 'اللجنة التنظيمية للمنصة الوطنية GTU',
      maxSeats: 300,
    });
  }

  seededDone = true;
}
