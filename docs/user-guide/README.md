# دليل المستخدم — عربات POS

هذا الدليل يستخدمه مدير الشركة لتدريب موظفيه على العمل اليومي في النظام.
هذه الصفحة هي نقطة البداية: من يقرأ الدليل، وماذا يغطي، وبأي ترتيب يُدرَّس.

> **مصدر الحقيقة:** كل اسم شاشة أو زر أو رسالة في الدليل مأخوذ حرفيًا من ملفات الترجمة
> العربية في الكود. ما لا يوجد في الكود لا يدخل الدليل. انظر `WRITING_RULES.md`.

ملفات الأساس:

| الملف | الغرض |
|---|---|
| `README.md` | الجمهور، النطاق، الفهرس، جدول التتبع (هذا الملف) |
| `SECTION_TEMPLATE.md` | القالب الذي يلتزم به كل قسم |
| `GLOSSARY.md` | المصطلحات المعتمدة كما تظهر في الواجهة، وقائمة التناقضات |
| `WRITING_RULES.md` | قواعد الكتابة لكل الجلسات القادمة |

---

## 1. جمهور الدليل وأدواره

الأدوار أدناه هي **قوالب الأدوار الافتراضية** التي تُنشأ لكل شركة جديدة
(`packages/permissions/src/templates.ts`). المالك ليس دورًا بل صفة في حساب الموظف.
القوالب قابلة للتعديل من شاشة «الأدوار والصلاحيات»، لذلك قد تختلف صلاحيات موظف معيّن
في شركتك عمّا هو مكتوب هنا. الدليل يصف القوالب الافتراضية فقط.

### الكاشير — `cashier`
- **الواجهة:** نقطة البيع فقط (لا يدخل الإدارة).
- **يستطيع:** الدخول إلى نقطة البيع في فرعه، فتح ورديته وإغلاقها، البيع، رؤية المنتجات،
  تطبيق الخصم **ضمن الحد المسموح**، البحث عن العملاء وإضافة عميل جديد، تنفيذ الاسترجاع
  والاستبدال، استقبال طلبات المطعم (إذا كانت وحدة المطعم مفعّلة).
- **لا يستطيع افتراضيًا:** الخصم فوق الحد، تعديل السعر، إلغاء البيع، اعتماد الاسترجاع،
  الإيداع أو السحب النقدي من الدرج (أُزيلت من الكاشير بقرار المالك — BR-079)، أي تقرير.
- **الصلاحيات:** `pos.access`، `sales.create`، `shifts.operate`، `catalog.read`،
  `customers.read`، `sales.discount`، `refunds.create`، `customers.create`، `restaurant.orders`.

### المشرف — `supervisor`
- **الواجهة:** نقطة البيع فقط (القالب لا يتضمن `manager.access`).
- **يستطيع:** كل ما يستطيعه الكاشير، وأيضًا: الخصم فوق الحد، تعديل السعر، إلغاء البيع،
  الحركات النقدية في الدرج (إيداع نقدي / سحب نقدي)، تعديل بيانات العملاء، عرض المخزون
  وسجل المبيعات، إلغاء أصناف أُرسلت للمطبخ، استخدام شاشة المطبخ.
  يحمل صلاحية «اعتماد الاسترجاع المقيّد» — انظر الملاحظة م-1 في القسم 5.
- **الصلاحيات الإضافية:** `sales.read`، `sales.discount.override_limit`، `sales.price_override`،
  `sales.void`، `refunds.approve`، `shifts.view_all`، `cash.move`، `customers.manage`،
  `inventory.read`، `restaurant.void_item`، `kitchen.access`.

### مدير الفرع — `branch_manager`
- **الواجهة:** الإدارة فقط، لفرعه المسند إليه (لا يدخل نقطة البيع افتراضيًا — BR-014).
- **يستطيع:** متابعة المبيعات والمرتجعات واعتماد الاسترجاع، إعداد الصناديق ومتابعة الورديات
  وإغلاقها بواسطة المدير، عرض المنتجات (بدون تعديلها)، المخزون وتعديلاته وطلب التحويلات
  وإرسالها واستلامها، الموردين وأوامر الشراء واستلام الشحنات (بدون اعتماد أوامر الشراء)،
  العملاء، إعداد المطعم في فرعه، الطلبات الإلكترونية، تقارير المبيعات والمخزون،
  موظفي فرعه، بيانات الفرع وإعداداته.
- **لا يستطيع افتراضيًا:** التقارير المالية، إدارة النقدية، طرق الدفع، الأدوار، إنشاء الفروع،
  تعديل الأسعار والتكلفة، اعتماد التحويلات وأوامر الشراء.
- **الصلاحيات:** `manager.access`، `sales.read`، `refunds.approve`، `registers.manage`،
  `shifts.view_all`، `catalog.read`، `inventory.read`، `inventory.adjust`، `inventory.transfer`،
  `purchasing.read`، `purchasing.manage`، `purchasing.receive`، `customers.read`،
  `customers.create`، `customers.manage`، `restaurant.manage`، `restaurant.void_item`،
  `online.orders`، `reports.sales`، `reports.inventory`، `employees.read`، `employees.manage`،
  `branches.read`، `branches.update`.

### مدير الشركة — `company_manager`
- **الواجهة:** الإدارة فقط، لكل الفروع عادةً (لا يدخل نقطة البيع افتراضيًا).
- **يستطيع:** كل ما يستطيعه مدير الفرع، وأيضًا: إدارة المنتجات والتصنيفات والأسعار والتكلفة،
  اعتماد التحويلات وأوامر الشراء، التقارير المالية، طرق الدفع والرسوم، إعداد المتجر
  الإلكتروني، إدارة الأدوار، إنشاء الفروع وإيقافها، تعديل بيانات الشركة.
- **لا يستطيع افتراضيًا:** «إدارة النقدية» والإيداع البنكي (`cash.custody` و`cash.deposit` ليستا
  في القالب) — انظر الملاحظة م-3.
- **الصلاحيات الإضافية على مدير الفرع:** `catalog.manage`، `catalog.prices.manage`،
  `inventory.transfer.approve`، `purchasing.approve`، `online.manage`، `reports.financial`،
  `payments.settings`، `roles.manage`، `branches.manage`، `merchant.settings.read`،
  `merchant.settings.update`، `audit.read`.

### المالك — صفة الحساب (ليس دورًا)
- **الواجهة:** الإدارة ونقطة البيع، في كل الفروع.
- **يستطيع:** كل شيء، بما فيه «إدارة النقدية» والإيداع البنكي. لا يمكن لأي مستخدم آخر
  إيقافه أو تعديل صلاحياته (BR-020). يُنشأ حساب المالك عند تسجيل الشركة (BR-040).

### دور إضافي موجود في الكود: طاقم المطبخ — `kitchen`
- **الواجهة:** نقطة البيع، ويدخل مباشرة إلى شاشة «المطبخ» فقط.
- **الصلاحيات:** `pos.access`، `kitchen.access`، `catalog.read`.
- يُدرَّب على القسم 10 فقط.

---

## 2. نطاق الدليل

- **داخل النطاق:** واجهة نقطة البيع (`/pos`) وواجهة الإدارة (`/manager`).
- **خارج النطاق:** واجهة إدارة المنصة (`/platform`) — خاصة بفريق المنصة ولا يصل إليها
  حساب الشركة (BR-015). وكذلك واجهة المتجر العام للعملاء (`/store`)؛ يُذكر أثرها فقط
  في قسم المتجر الإلكتروني من جهة الإدارة.
- الدليل يصف ما هو موجود في النظام الآن. ما ليس موجودًا (مثل «إقفال الشهر»، البيع دون
  اتصال، نقاط الولاء) لا يُذكر كميزة.

---

## 3. الفهرس الكامل (بترتيب التدريب المقترح)

المسارات في هذا الجدول للمراجعة الداخلية فقط؛ لا تُكتب في متن الأقسام (انظر `WRITING_RULES.md`).
«ق» = قاعدة عمل من `docs/BUSINESS_RULES.md`.

### الجزء الأول — نقطة البيع (الكاشير والمشرف)

| # | الملف | العنوان | الدور المستهدف | الشاشات (المسار) | الصلاحيات المطلوبة | قواعد العمل |
|---|---|---|---|---|---|---|
| 01 | `01-getting-started.md` | الدخول إلى النظام وقفل الشاشة | الجميع | `/pos/login`، `/manager/login`، `/pos/forgot-password`، `/pos/reset-password`، `/pos/accept-invite`، `/manager/accept-invite`، شاشة القفل، اختيار الشركة والفرع، تبديل اللغة | `pos.access` أو `manager.access` | BR-013، BR-014، BR-016، BR-022، BR-041، BR-042، BR-043، BR-044، BR-160 |
| 02 | `02-pos-open-shift.md` | فتح الوردية | الكاشير، المشرف | `/pos/shift` (فتح وردية) و`/pos/` قبل فتح الوردية | `shifts.operate` | BR-027، BR-072، BR-073، BR-077، BR-079 |
| 03 | `03-pos-selling.md` | البيع والدفع والإيصال | الكاشير | `/pos/` (البحث والمسح، التصنيفات، السلة، الدفع، الإيصال، آخر المبيعات) | `sales.create` | BR-018، BR-050، BR-062، BR-070، BR-080، BR-083، BR-084، BR-086 |
| 04 | `04-pos-discounts-price.md` | الخصم وتعديل السعر | الكاشير، المشرف | `/pos/` (نافذة تعديل السطر، خصم على الفاتورة) | `sales.discount`، `sales.discount.override_limit`، `sales.price_override` | BR-026، BR-080، BR-081، BR-082، BR-033 |
| 05 | `05-pos-customer-held-sales.md` | العميل على الفاتورة والمبيعات المعلّقة | الكاشير | `/pos/` (اختيار عميل، عميل جديد، تعليق، المبيعات المعلّقة) | `customers.read`، `customers.create`، `sales.create` | BR-085، BR-110، BR-111، BR-113، BR-114 |
| 06 | `06-pos-returns.md` | المرتجعات والاستبدال وإلغاء البيع | الكاشير، المشرف | `/pos/returns` | `refunds.create`، `sales.create` (للاستبدال)، `sales.void` (لإلغاء البيع) | BR-034، BR-035، BR-090، BR-091، BR-092، BR-093، BR-094 |
| 07 | `07-pos-cash-movements.md` | الحركات النقدية في الدرج | المشرف (ومن مُنح الصلاحية) | `/pos/shift` (إيداع نقدي، سحب نقدي) | `cash.move`، `cash.deposit` (للإيداع البنكي) | BR-075، BR-076، BR-087، BR-088 |
| 08 | `08-pos-close-shift.md` | إغلاق الوردية وقراءة النتيجة | الكاشير، المشرف | `/pos/shift` (إغلاق الوردية، نتيجة الإغلاق) | `shifts.operate` | BR-073، BR-074، BR-077، BR-126 |
| 09 | `09-pos-restaurant-orders.md` | الطاولات وطلبات المطعم | الكاشير، المشرف | `/pos/tables`، `/pos/tables/orders/:orderId` | `restaurant.orders`، `sales.create` (للدفع)، `restaurant.void_item` (لإلغاء صنف أُرسل) | BR-130 حتى BR-139 |
| 10 | `10-pos-kitchen.md` | شاشة المطبخ | طاقم المطبخ، المشرف | `/pos/kitchen` | `kitchen.access` | BR-135، BR-138 |

### الجزء الثاني — الإدارة (مدير الفرع ومدير الشركة والمالك)

| # | الملف | العنوان | الدور المستهدف | الشاشات (المسار) | الصلاحيات المطلوبة | قواعد العمل |
|---|---|---|---|---|---|---|
| 11 | `11-manager-basics.md` | واجهة الإدارة ولوحة التحكم | مدير الفرع، مدير الشركة، المالك | `/manager/` (لوحة التحكم)، القائمة الجانبية، اختيار الفرع في الشريط العلوي، تغيير الشركة، فتح نقطة البيع | `manager.access` | BR-013، BR-014، BR-021، BR-046، BR-126a |
| 12 | `12-manager-sales-refunds.md` | المبيعات والمرتجعات واعتماد الاسترجاع وسياسة البيع | مدير الفرع، مدير الشركة | `/manager/sales`، `/manager/sales/:saleId`، `/manager/refunds` | `sales.read`، `refunds.approve`، `merchant.settings.update` (لسياسة البيع) | BR-034، BR-050، BR-081، BR-090 حتى BR-095، BR-121 |
| 13 | `13-manager-shifts-registers.md` | الورديات والصناديق وفروقات النقد | مدير الفرع، مدير الشركة | `/manager/shifts`، `/manager/shifts/:shiftId`، `/manager/registers` | `shifts.view_all`، `registers.manage` | BR-027، BR-072، BR-073، BR-074، BR-077، BR-078، BR-126 |
| 14 | `14-manager-cash-custody.md` | إدارة النقدية (الخزينة، الجرد، التحويلات، المصروفات، الإيداع) | المالك (ومن مُنح الصلاحية) | `/manager/cash` | `cash.custody`، `cash.deposit` | BR-075، BR-076، BR-078، BR-079، BR-087، BR-088، BR-089، BR-126a |
| 15 | `15-manager-products.md` | المنتجات والتصنيفات | مدير الشركة | `/manager/products`، `/manager/products/new`، `/manager/products/:productId`، `/manager/categories` | `catalog.read`، `catalog.manage`، `catalog.prices.manage` | BR-049، BR-050، BR-051، BR-052 |
| 16 | `16-manager-inventory.md` | المخزون والتعديلات وسجل الحركات | مدير الفرع، مدير الشركة | `/manager/inventory`، `/manager/inventory/adjustments`، `/manager/inventory/adjustments/new`، `/manager/inventory/adjustments/:adjustmentId`، `/manager/inventory/movements` | `inventory.read`، `inventory.adjust`، `merchant.settings.update` (لإعدادات المخزون) | BR-060 حتى BR-066 |
| 17 | `17-manager-purchasing.md` | الموردون وأوامر الشراء واستلام الشحنات | مدير الفرع، مدير الشركة | `/manager/suppliers`، `/manager/purchasing`، `/manager/purchasing/new`، `/manager/purchasing/:orderId` | `purchasing.read`، `purchasing.manage`، `purchasing.approve`، `purchasing.receive` | BR-100، BR-101، BR-102، BR-087 |
| 18 | `18-manager-stock-transfers.md` | تحويلات المخزون بين الفروع | مدير الفرع، مدير الشركة | `/manager/transfers`، `/manager/transfers/new`، `/manager/transfers/:transferId` | `inventory.read`، `inventory.transfer`، `inventory.transfer.approve` | BR-103، BR-104، BR-144 |
| 19 | `19-manager-customers.md` | العملاء | مدير الفرع، مدير الشركة | `/manager/customers`، `/manager/customers/:customerId` | `customers.read`، `customers.create`، `customers.manage` | BR-110 حتى BR-114 |
| 20 | `20-manager-reports.md` | التقارير | مدير الفرع، مدير الشركة، المالك | `/manager/reports` (المبيعات، المدفوعات والنقد، المصروفات، الورديات، المخزون، المشتريات) | `reports.sales`، `reports.financial`، `reports.inventory` | BR-120 حتى BR-129، BR-126a |
| 21 | `21-manager-employees-roles.md` | الموظفون والدعوات والأدوار والصلاحيات | مدير الفرع، مدير الشركة، المالك | `/manager/employees`، `/manager/employees/:membershipId`، `/manager/roles` | `employees.read`، `employees.manage`، `roles.manage` | BR-020، BR-023، BR-024، BR-025، BR-044، BR-045، BR-046، BR-048، BR-151 |
| 22 | `22-manager-branches-company.md` | الفروع وبيانات الشركة والاشتراك | مدير الشركة، المالك | `/manager/branches`، `/manager/settings`، `/manager/subscription` | `branches.read`، `branches.update`، `branches.manage`، `merchant.settings.read`، `merchant.settings.update` | BR-004، BR-047، BR-072، BR-150، BR-151، BR-153، BR-155، BR-156 |
| 23 | `23-manager-payment-methods.md` | طرق الدفع والحسابات المالية | مدير الشركة، المالك | `/manager/payments`، `/manager/accounts` | `payments.settings` | BR-070، BR-071، BR-076، BR-086، BR-143 |
| 24 | `24-manager-restaurant-setup.md` | إعداد المطعم | مدير الفرع، مدير الشركة | `/manager/restaurant` (الإعداد، الطاولات والمحطات، الإضافات، القائمة) | `restaurant.manage` | BR-130 حتى BR-137 |
| 25 | `25-manager-online-store.md` | المتجر الإلكتروني وطلباته | مدير الفرع (الطلبات)، مدير الشركة | `/manager/online` (الطلبات، إعدادات المتجر، المنتجات المعروضة) | `online.orders`، `online.manage` | BR-140 حتى BR-149، BR-161 |

**المجموع: 25 قسمًا** (10 لنقطة البيع، 15 للإدارة).

### مسارات التدريب حسب الدور

| الدور | الأقسام بالترتيب |
|---|---|
| الكاشير | 01، 02، 03، 04 (الجزء الخاص بالخصم ضمن الحد)، 05، 06، 08؛ و09 إذا كانت وحدة المطعم مفعّلة |
| المشرف | مسار الكاشير كاملًا + 04 كاملًا + 06 (إلغاء البيع) + 07 + 10 |
| طاقم المطبخ | 01، 10 |
| مدير الفرع | 01، 11، 12، 13، 16، 17، 18، 19، 20 (تبويبا المبيعات والمخزون والمشتريات)، 21، 22 (الفروع فقط)، 24، 25 (الطلبات) |
| مدير الشركة | مسار مدير الفرع + 15، 20 كاملًا، 22، 23، 25 كاملًا |
| المالك | كل الأقسام، وخاصة 14 |

---

## 4. جدول تتبع الحالة

الحالات: **لم يبدأ** / **مسودة** / **مراجع**. يُحدَّث هذا الجدول في نهاية كل جلسة كتابة.

| # | الملف | الحالة | تاريخ آخر تحديث | ملاحظات |
|---|---|---|---|---|
| 01 | `01-getting-started.md` | لم يبدأ | — | |
| 02 | `02-pos-open-shift.md` | لم يبدأ | — | |
| 03 | `03-pos-selling.md` | لم يبدأ | — | |
| 04 | `04-pos-discounts-price.md` | لم يبدأ | — | ينتظر قرار م-2 |
| 05 | `05-pos-customer-held-sales.md` | لم يبدأ | — | |
| 06 | `06-pos-returns.md` | لم يبدأ | — | ينتظر قرار م-1 |
| 07 | `07-pos-cash-movements.md` | لم يبدأ | — | |
| 08 | `08-pos-close-shift.md` | لم يبدأ | — | |
| 09 | `09-pos-restaurant-orders.md` | لم يبدأ | — | |
| 10 | `10-pos-kitchen.md` | لم يبدأ | — | |
| 11 | `11-manager-basics.md` | لم يبدأ | — | |
| 12 | `12-manager-sales-refunds.md` | لم يبدأ | — | ينتظر قرار م-1 |
| 13 | `13-manager-shifts-registers.md` | لم يبدأ | — | |
| 14 | `14-manager-cash-custody.md` | لم يبدأ | — | ينتظر قرار م-3 |
| 15 | `15-manager-products.md` | لم يبدأ | — | |
| 16 | `16-manager-inventory.md` | لم يبدأ | — | |
| 17 | `17-manager-purchasing.md` | لم يبدأ | — | |
| 18 | `18-manager-stock-transfers.md` | لم يبدأ | — | |
| 19 | `19-manager-customers.md` | لم يبدأ | — | |
| 20 | `20-manager-reports.md` | لم يبدأ | — | |
| 21 | `21-manager-employees-roles.md` | لم يبدأ | — | |
| 22 | `22-manager-branches-company.md` | لم يبدأ | — | |
| 23 | `23-manager-payment-methods.md` | لم يبدأ | — | |
| 24 | `24-manager-restaurant-setup.md` | لم يبدأ | — | |
| 25 | `25-manager-online-store.md` | لم يبدأ | — | |

---

## 5. ملاحظات مفتوحة تؤثر على كتابة الأقسام

هذه ملاحظات وُجدت أثناء جلسة التأسيس (2026-10-13). لا تُكتب الأقسام المتأثرة بها
بشكل نهائي قبل قرار المالك. لم يُعدَّل أي كود أو وثيقة هندسية بسببها.

- **م-1 — اعتماد الاسترجاع في نقطة البيع غير موجود في الواجهة.** واجهة برمجة نقطة البيع
  تحتوي على اعتماد الاسترجاع، لكن شاشة «المرتجعات والاستبدال» لا تعرض زر اعتماد؛ تظهر
  فقط رسالة «يجب أن يعتمد مشرف هذا الاسترجاع.» ويبقى الطلب «بانتظار الاعتماد». الاعتماد
  الفعلي متاح فقط في الإدارة (تبويب «بانتظار الاعتماد» في صفحة المرتجعات). والمشرف لا يملك
  دخول الإدارة في قالبه، فلا توجد شاشة يعتمد منها رغم امتلاكه الصلاحية.
- **م-2 — لا يوجد «تجاوز» من مشرف على نفس الجهاز.** رسالة «هذا الخصم يتجاوز الحد المسموح لك.
  اطلب مشرفًا.» تظهر للكاشير، لكن لا توجد نافذة يدخل فيها المشرف كلمة مروره للموافقة.
  الموجود فقط: قفل الشاشة و«الدخول بحساب آخر». يجب تحديد الإجراء الذي يُدرَّب عليه الموظف.
- **م-3 — إدارة النقدية للمالك فقط افتراضيًا.** لا يوجد قالب دور يحمل `cash.custody` أو
  `cash.deposit`، فصفحة «إدارة النقدية» والإيداع البنكي من الدرج لا تظهر إلا للمالك أو لمن
  يُمنح الصلاحية في دور مخصص.
- **م-4 — «سجل التدقيق».** صلاحية «عرض سجل التدقيق» موجودة في قائمة الصلاحيات، لكن لا توجد
  شاشة لسجل التدقيق في الإدارة. الدليل يذكر أن العمليات «تُسجَّل» دون أن يحيل الموظف إلى شاشة.
