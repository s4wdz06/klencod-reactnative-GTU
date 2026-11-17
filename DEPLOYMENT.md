# دليل نشر منصة GTU الوطنية

## 1. المتطلبات الأساسية
- Node.js 22+
- قاعدة بيانات PostgreSQL (Cloud SQL أو خادم PostgreSQL قياسي)
- متغيرات البيئة التالية:
  - `SQL_HOST`
  - `SQL_DB_NAME`
  - `SQL_USER`
  - `SQL_PASSWORD`
  - `SQL_ADMIN_USER`
  - `SQL_ADMIN_PASSWORD`
  - `SESSION_SECRET`
  - `PORT=3000`

## 2. تطبيق مخطط قاعدة البيانات
يمكن تطبيق المخطط باستخدام Drizzle Kit:
```bash
npx drizzle-kit push --config=src/db/drizzle.config.ts
```
أو عبر ملف SQL المرجعي في `database/schema.sql`.

## 3. البناء والتشغيل للإنتاج
```bash
npm run build
NODE_ENV=production npm start
```
عند أول طلب لواجهة `/api/*`، تقوم المنصة تلقائياً وبشكل آمن (Idempotent) بتهيئة الأدوار، الصلاحيات، 58 ولاية، 1541 بلدية، المؤسسات الجامعية، والمجموعات الولائية.
