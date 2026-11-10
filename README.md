# عز لوجستيك | AZZ LOGISTICS

منصة تعليمية عربية مستقلة في الإدارة والخدمات اللوجستية وسلاسل الإمداد: اختبارات تفاعلية للمقررات، مكتبة تعليمية، مكتبة أفلام، وحسابات طلاب موحدة مع توثيق رقم الجوال.

> منصة مستقلة وغير تابعة رسميًا للجامعة السعودية الإلكترونية.

## المحتوى

| الصفحة | الوصف |
|---|---|
| `index.html` | الصفحة الرئيسية: المقررات، الاختبارات، المشاريع، المهارات، وجولة تعريفية |
| `business-administration.html` | اختبار مبادئ إدارة الأعمال |
| `purchasing-102.html` | اختبار المشتريات 102 |
| `inventory.html` | اختبار إدارة المخزون والمخازن |
| `library.html` | المكتبة التعليمية: دروس، مستكشف المدن والموانئ والمطارات السعودية، وتتبع التقدم |
| `films.html` | مكتبة الأفلام اللوجستية (روابط خارجية مرخّصة) |
| `register.html` | تسجيل الطالب وتوثيق الجوال |

الموقع يعمل كتطبيق قابل للإضافة إلى الشاشة الرئيسية (PWA) عبر `manifest.webmanifest` و`sw.js`. في الآيفون: افتح الموقع في Safari ← مشاركة ← إضافة إلى الشاشة الرئيسية.

## البنية

```
├── *.html, *.png, sw.js, manifest.webmanifest   الواجهة (ملفات ثابتة، RTL)
├── server/          خادم Node.js بدون اعتماديات خارجية
│   ├── main.js          نقطة التشغيل
│   ├── app.js           المسارات، الجلسات، وقائمة الملفات العامة المسموح بعرضها
│   ├── store.js         قاعدة بيانات SQLite (node:sqlite)
│   ├── twilio.js        التحقق من الجوال عبر Twilio Verify
│   └── student-admin.js أداة الإدارة لاعتماد الطلاب
├── test/            اختبارات الخادم (node --test)
├── analytics/       خدمة تحليلات اختيارية (Python / FastAPI / Plotly)
├── infra/k8s/       قوالب Kubernetes اختيارية
└── render.yaml      إعداد النشر على Render
```

## التشغيل محليًا

المتطلبات: Node.js 24.

```bash
cp .env.example .env
# ضع قيمة APP_SECRET (32 حرفًا عشوائيًا على الأقل):
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm start          # http://localhost:3000
npm test
```

اترك متغيرات Twilio فارغة لتعطيل إرسال الرسائل محليًا؛ الخادم يرفض طلبات التحقق بأمان عند غياب الإعداد.

### إدارة الطلاب

التسجيل وتوثيق الجوال لا يمنحان صلاحية الوصول؛ يلزم اعتماد مستقل من الإدارة:

```bash
npm run student -- list
npm run student -- approved <student-id> <operator-name>
```

## إضافة صفحة جديدة

الخادم يعرض فقط الملفات المسجلة في `publicFiles` داخل `server/app.js`. عند إضافة صفحة جديدة أضفها هناك، وإلا ستُرجع 404. اختبار `every local link reachable from the homepage is served` في `test/security.test.js` يكشف أي رابط داخلي غير مسجل.

## النشر

- **Render:** عبر `render.yaml` (يتطلب قرصًا دائمًا لقاعدة SQLite). التفاصيل وخطوات تفعيل الرسائل الحقيقية في [`VERIFY-DEPLOYMENT.md`](VERIFY-DEPLOYMENT.md).
- **استضافة ثابتة** (GitHub Pages / Netlify): الصفحات والاختبارات تعمل، لكن التسجيل والتحقق يتطلبان الخادم.
- **CI:** يشغّل GitHub Actions الأمر `npm test` على كل طلب دمج (`.github/workflows/verify.yml`).

## خدمة التحليلات (اختيارية)

خدمة معزولة لا تصل إلى بيانات الطلاب وتتطلب مفتاح API. انظر [`analytics/README.md`](analytics/README.md).

```bash
cd analytics
pip install -r requirements.txt pytest httpx
pytest
```
