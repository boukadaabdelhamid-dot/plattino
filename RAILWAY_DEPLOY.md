# Deploying Midanic to Railway

دليل نشر مشروع Midanic كاملاً على Railway (web-store + ERP + api-server + Postgres).

---

## 📋 الملخص

ستحتاج إلى إنشاء **4 خدمات** في مشروع Railway واحد:

1. **Postgres** (قاعدة البيانات)
2. **api-server** (الواجهة البرمجية)
3. **web-store** (متجر العملاء)
4. **erp** (لوحة الإدارة)

---

## 🚀 الخطوة 1: إنشاء حساب Railway

1. افتح [railway.app](https://railway.app) → **Login with GitHub**
2. وافق على ربط حسابك
3. ستحصل على رصيد ترحيبي $5

---

## 🐘 الخطوة 2: إنشاء قاعدة البيانات Postgres

1. **New Project** → **Provision PostgreSQL**
2. انتظر حتى يصبح جاهزاً (~30 ثانية)
3. اضغط على الخدمة → **Variables** → انسخ `DATABASE_URL`

---

## 🔧 الخطوة 3: نشر API Server

1. في نفس المشروع: **+ New** → **GitHub Repo** → اختر `midanic` repo
2. **Settings** → **Service Settings**:
   - **Service Name:** `api-server`
   - **Root Directory:** اتركه فارغاً (المشروع كله)
   - **Config Path:** `artifacts/api-server/railway.json` (يستخدم Nixpacks تلقائياً)
3. **Variables** أضِف:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   JWT_SECRET=<أنشئ سراً عشوائياً 32 حرفاً>
   PORT=3000
   NODE_ENV=production
   ALLOWED_ORIGINS=https://midanic.com,https://admin.midanic.com,https://www.midanic.com
   AUTO_SEED=true
   ```
4. **صور المنتجات (Object Storage)** — اختر أحد الخيارين:

   **خيار A — Railway Volume (موصى به للبداية):**
   - في نفس المشروع: **+ New** → **Volume** → اختر اسماً مثل `uploads`
   - في إعدادات Volume: **Mount Path** = `/data/uploads`
   - في Variables الـ api-server أضف:
     ```
     STORAGE_LOCAL_PATH=/data/uploads
     ```

   **خيار B — Google Cloud Storage (أفضل للإنتاج الجاد):**
   - أنشئ Service Account على GCP وحمّل مفتاح JSON
   - في Variables الـ api-server أضف:
     ```
     GOOGLE_CREDENTIALS_JSON=<محتوى ملف JSON كاملاً>
     PUBLIC_OBJECT_SEARCH_PATHS=/<bucket-name>/public
     PRIVATE_OBJECT_DIR=/<bucket-name>/private
     ```

5. **Settings** → **Networking** → **Generate Domain** (يعطيك `api-server-xxx.up.railway.app`)
6. انتظر النشر الأول (~3-5 دقائق)

---

## 🛒 الخطوة 4: نشر Web Store

1. **+ New** → **GitHub Repo** → نفس الـ repo
2. **Settings**:
   - **Service Name:** `web-store`
   - **Config Path:** `artifacts/web-store/railway.json`
3. **Variables**:
   ```
   PORT=3000
   VITE_API_URL=https://<api-server-domain>
   ```
   (انسخ دومين api-server من الخطوة السابقة)
4. **Networking** → **Generate Domain**

---

## 🏢 الخطوة 5: نشر ERP

1. **+ New** → **GitHub Repo** → نفس الـ repo
2. **Settings**:
   - **Service Name:** `erp`
   - **Config Path:** `artifacts/erp/railway.json`
3. **Variables**:
   ```
   PORT=3000
   VITE_API_URL=https://<api-server-domain>
   ```
4. **Networking** → **Generate Domain**

---

## 🗄️ الخطوة 6: ترحيل قاعدة البيانات

من جهازك (أو Replit):

```bash
# تصدير DATABASE_URL من Railway
export DATABASE_URL="<رابط Postgres من Railway>"

# تطبيق المخطط وإنشاء الجداول
pnpm --filter @workspace/db run push

# (اختياري) seed بيانات الإدارة الافتراضية — admin@midanic.com / admin1234
pnpm --filter @workspace/api-server exec tsx src/seed.ts
```

أو استخدم **Railway CLI** لتشغيل الأوامر مباشرة:
```bash
npm i -g @railway/cli
railway login
railway link
# تطبيق المخطط على Postgres في Railway
DATABASE_URL="<رابط Postgres>" railway run pnpm --filter @workspace/db run push
# seed الإدارة
DATABASE_URL="<رابط Postgres>" railway run pnpm --filter @workspace/api-server exec tsx src/seed.ts
```

---

## 🌐 الخطوة 7: ربط الدومين الخاص

لكل خدمة (web-store, erp, api-server):

1. **Settings** → **Networking** → **+ Custom Domain**
2. أدخل الدومين:
   - `midanic.com` و `www.midanic.com` لـ web-store
   - `admin.midanic.com` لـ erp
   - `api.midanic.com` لـ api-server
3. Railway سيعطيك سطر **CNAME** أو **A record**
4. عند مزود الدومين (GoDaddy/Namecheap/...):
   - أضف الـ DNS records التي أعطاك إياها Railway
5. انتظر 10 دقائق - 1 ساعة لانتشار DNS
6. Railway يصدر شهادة HTTPS تلقائياً ✅

**بعد ربط الدومين**، حدّث متغير `ALLOWED_ORIGINS` في api-server وأعد النشر.

---

## 📱 الخطوة 8: تطبيق الموبايل (Expo)

في `artifacts/mobile-store/.env`:
```
EXPO_PUBLIC_API_URL=https://api.midanic.com
```

ثم بناء APK:
```bash
cd artifacts/mobile-store
npx eas build --platform android --profile preview
```

---

## 🔄 التحديثات المستقبلية

كل `git push` على `main` يطلق إعادة بناء ونشر تلقائي على Railway لكل الخدمات الثلاث (api/web/erp).

لا حاجة لأي إجراء يدوي.

---

## ⚠️ ملاحظات مهمة

### Object Storage (صور المنتجات)
التخزين الحالي يعتمد على Replit Object Storage. للنشر على Railway:
- **خيار 1:** ضع `GOOGLE_CREDENTIALS_JSON` (Service Account) في Variables
- **خيار 2:** استخدم Cloudinary / S3 / Railway Volume (يحتاج تعديل لاحق)

بدون أحدهما، endpoints رفع/تحميل الصور ستفشل، لكن باقي المشروع يعمل طبيعياً.

### WebSocket
يعمل مباشرة على Railway بدون تعديل (الإشعارات الفورية فعّالة ✅).

### تكلفة متوقعة
- Postgres: ~$3-5/شهر
- api-server: ~$3-5/شهر
- web-store: ~$2-3/شهر
- erp: ~$2-3/شهر
- **المجموع: ~$10-16/شهر**

---

## 🆘 استكشاف الأخطاء

### Build فشل
- تحقق من Logs في Railway → Deployments → آخر deployment
- تأكد أن `pnpm-lock.yaml` موجود في الـ repo

### الموقع لا يفتح
- تحقق من **Networking** → الدومين موجود
- تحقق من Logs → لا توجد أخطاء startup
- تحقق من `PORT` env = 3000

### قاعدة البيانات لا تتصل
- تأكد أن `DATABASE_URL` يستخدم `${{Postgres.DATABASE_URL}}` (بـ Reference Variable)
- ليس نسخاً مباشراً للنص

### CORS errors
- حدّث `ALLOWED_ORIGINS` في api-server
- أعد نشر api-server (Deployments → Redeploy)
