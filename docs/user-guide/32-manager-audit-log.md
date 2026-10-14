# 32 — «سجل التدقيق»: التصفية بالفترة والإجراء ونوع السجل، قراءة التفاصيل (القيمة قبل → بعد)، «تصدير CSV»

<!--
بطاقة القسم (للكاتب والمراجع؛ تبقى تعليقًا مخفيًا ولا تُعرض للموظف):
- الملف: 32-manager-audit-log.md
- الدور المستهدف: المالك، مدير الشركة (على «كل الفروع»)
- الشاشات: /manager/audit (العنوان والوصف، حقلا «من» و«إلى»، حقل التصفية بالإجراء مع قائمة الاقتراحات، قائمة «نوع
  السجل»، الجدول، عدّاد الصفحات، زر «تصدير CSV»)؛ للإحالة في التحقيقين: /manager/products/:productId (قسم «سجل الأسعار
  والتكاليف»)، /manager/shifts و/manager/shifts/:shiftId («الحركات النقدية»)، /manager/sales («المبيعات غير الاعتيادية»)
- الصلاحيات: audit.read (نطاق merchant ⇒ تعمل فقط بإسناد «كل الفروع» أو للمالك)، manager.access؛ للإحالات: catalog.read
  (سجل الأسعار)، shifts.view_all (الورديات)، sales.read (المبيعات)
- قواعد العمل: BR-163، BR-187، BR-191 (وللسياق: BR-182، BR-184، BR-020؛ ADR-0071، ADR-0093، ADR-0104)
- قرارات: ق-7 (جدول الرموز بالعربية)، ق-29 (صيغة من يمنح الصلاحية)، ت-24 («استرجاع» للمبيعات فقط)، ت-18 («التحويلات»)
- مفاتيح الترجمة المستخدمة:
  manager:nav.audit، manager:nav.sectionOrganization، manager:nav.products، manager:nav.shifts، manager:nav.roles،
  manager:nav.dashboard، common:actions.openMenu، manager:top.allBranches، manager:roles.merchantScope،
  manager:audit.title، manager:audit.subtitle، manager:audit.when، manager:audit.actor، manager:audit.action،
  manager:audit.target، manager:audit.targetType، manager:audit.targetId، manager:audit.ip، manager:audit.details،
  manager:audit.filterAction، manager:audit.allTargets، manager:audit.empty، manager:audit.export،
  manager:audit.unknownUser، manager:audit.actor_user، manager:audit.actor_operator، manager:audit.actor_system،
  manager:audit.actor_anonymous، manager:inventory.from، manager:inventory.to، manager:inventory.count،
  manager:catalog.previous، manager:catalog.next، manager:catalog.pageOf،
  manager:catalog.priceHistory، manager:catalog.changedAt، manager:catalog.changedWhat، manager:catalog.fromTo،
  manager:catalog.changedBy، manager:catalog.price،
  manager:cash.movements، manager:cash.reason_other، manager:cash.note، manager:cash.employee، manager:cash.tabDiscrepancies،
  manager:cash.tabVariances، manager:sales.flagFilter، manager:sales.flag_price_override، manager:sales.flag_supervised،
  manager:sales.policy، manager:sales.clearThreshold، manager:sales.clearThresholdHint، pos:shift.cashOut،
  مفاتيح manager:perm باسم الصلاحية (manager.access، audit.read)،
  common:auth.accessDenied، common:errors.title، common:errors.VALIDATION_FAILED، common:errors.NETWORK،
  common:actions.retry
- سلوك متحقق منه في الكود:
  * الوصول (navigation.ts: { key: 'audit', anyOf: ['audit.read'], section: 'organization' }؛ routes.tsx →
    guard('audit.read', <AuditLogPage />)؛ audit.controller.ts → @RequirePermission('manager', 'audit.read')؛
    catalog.ts: 'audit.read' scope merchant؛ templates.ts: company_manager فقط). صلاحية بنطاق merchant لا تعمل إلا
    بإسناد «كل الفروع» (session-context.service.ts → effectivePermissions)، والمالك يملكها دائمًا.
  * القائمة (audit.service.ts → listForMerchant): أحداث الشركة فقط (a.merchant_id = الشركة، مع RLS)؛ الأحداث بلا
    merchant_id لا تظهر أبدًا: auth.login.failed، auth.account_locked (login.service.ts → login، notifyLocked)،
    auth.password_reset.requested / completed (password-reset.service.ts)، platform.login.*، platform.mfa.failed
    (platform-auth.service.ts)، platform.plan.* (platform.service.ts، merchantId null). أحداث فريق المنصة على الشركة
    (platform.merchant.created / suspended / reactivated / closed / owner_frozen / owner_released /
    ownership_transferred، platform.subscription.changed) تظهر بـ actorType operator. تسجيل الخروج لا يُسجَّل.
    عرض «سجل التدقيق» نفسه لا يُسجَّل؛ التصدير يُسجَّل report.exported (report: 'audit'، section: 'entries'، from، to،
    rows) عبر POST reports/exports (@Authenticated، الخطأ يُتجاهل .catch).
  * الترتيب الأحدث أولًا (occurred_at desc). PAGE_SIZE = 50 (الخادم يقبل حتى 100). from / to أيام محلية بمنطقة الشركة
    (withinLocalDays، merchantTimezone)، شاملة للطرفين؛ تاريخ بصيغة غير صالحة يُتجاهل في الواجهة. «الوقت» يُنسَّق بساعة
    الجهاز (AdjustmentsPage.tsx → formatDateTime، Intl.DateTimeFormat بلا timeZone، أرقام لاتينية).
  * التصفية بالإجراء (AuditLogPage.tsx): نص حر بعد 300 ms، position(lower(..)) ⇒ جزء من الرمز بلا تمييز لحالة الأحرف؛
    الحد 60 حرفًا (contracts audit.ts → optionalText(60)) وإلا VALIDATION_FAILED في ErrorState. الاقتراحات (datalist) =
    كل رموز الشركة المستخدمة حتى الآن (select distinct action). المثال في النص «price» لا يطابق أي رمز موجود في الكود.
  * «نوع السجل»: قائمة من أنواع الأسطر المعروضة في الصفحة الحالية فقط (targetTypes من list.data.entries) مع القيمة
    المختارة؛ «كل أنواع السجلات» = بلا تصفية. التصفية بالموظف (actorId) موجودة في الخادم ولا يوجد لها حقل في الواجهة.
  * أي تغيير في التصفية يعيد إلى الصفحة 1. العدّاد inventory.count «{{count}} صنف» (يعدّ أحداثًا).
  * الأعمدة: «الوقت»، «من» (actorName = users.full_name؛ user بلا اسم → «مستخدم محذوف»؛ غير user → التسمية + شارة)،
    «الإجراء» (الرمز كما هو، ltr)، «السجل» (targetType · أول 8 أحرف من targetId، مخفي تحت md)، «التفاصيل»
    (summarizeDetails ثم « · IP»، مخفي تحت lg). لا يُفتح السطر.
  * summarizeDetails: قيمة null تُحذف؛ كائن فيه from أو to في المستوى الأول → «key: from → to» (الفارغ «—»)؛ كائن آخر →
    JSON (لذلك diffFields المخزَّن تحت changes يظهر changes: {"field":{"from":..,"to":..}})؛ مصفوفة → join(', ')، فمصفوفة
    كائنات تظهر «[object Object]» (product.updated → variants، product.created → variants، sale.completed →
    priceOverrides، employee.roles_changed → before / after، employee.invited → assignments). جُرّب بنسخة من الدالة.
  * sales.settings_updated (sales.service.ts → updateSettings): كل الإعدادات من → إلى في كل حفظ ولو لم تتغير، والمبالغ
    بالفلس (refundApprovalLimit، cashOutOtherLimit، cashOutOtherShiftLimit، maxRegisterTolerance، expenseApprovalLimit،
    supplierPaymentApprovalLimit، adjustmentApprovalLimit).
  * CSV (exportCsv): الأسطر المعروضة في الصفحة الحالية فقط (≤ 50)، الأعمدة when/actor/action/targetType/targetId (كاملًا)
    /ip/details؛ الاسم audit-<from|all>-<to|all>-p<page>.csv؛ BOM لقراءة العربية (reports/shared.tsx → toCsv). الزر
    معطّل إذا كانت الصفحة فارغة.
  * لا تعديل ولا حذف: audit_log إدراج فقط (AuditService.recordIn / record). record() يبتلع الخطأ ويكتب في سجل الخادم.
  * سعر الصنف (catalog.service.ts → updateProduct، saveVariants، history): product.updated مع before {status، name =
    nameEn ?? nameAr}، changes (حقول المنتج)، variants [{variantId، price {from,to}، cost {from,to}}]؛ وسطر في
    price_history لكل تغيير سعر أو تكلفة (القسم 27). تعديل السعر في نقطة البيع لعملية واحدة: sale.completed →
    priceOverrides، وsale.override_granted (actor = المشرف المعتمِد، details: cashierUserId، permissions، note).
  * الدرج: لا يوجد في الكود أي حدث أو زر لفتح الدرج («no sale» / open drawer): بحث drawer / no_sale / open_drawer / kick في
    apps وpackages بلا نتيجة وظيفية. أقرب الأدلة: shift.cash_out / shift.cash_in (details: movementId، amount، reason؛
    الملاحظة لا تُكتب في التدقيق — shifts.service.ts → createMovement)، cart.cleared / cart.line_removed (amount، lineCount؛
    من «تسجيل مسح السلة من (د.ك)»، الافتراضي 5.000 — sales.service.ts → recordCartEvent، SalePage.tsx → trace)،
    sale.reprinted، sale.voided، shift.closed / shift.force_closed (expected، counted، discrepancy = counted − expected)،
    shift.opened (difference بين الورديات)، auth.pos.locked / unlocked.
  * قائمة الرموز في الجدول مستخرجة من استدعاءات recordIn / record ومساعدات record في كل الوحدات (grep على
    apps/api/src/modules)، وتشمل فقط ما يُكتب بـ merchant_id.
- رُوجع على الالتزام: 227af7d
- الحالة: مسودة
-->

## الهدف من الشاشة

«سجل التدقيق» يعرض كل إجراء مسجَّل في شركتك: من فعله، ومتى، وعلى أي سجل، وما الذي تغيّر.
تحتاجه للتحقيق في حادثة، أو لمراجعة تغيير في سعر أو إعداد أو صلاحية.

## من يستطيع استخدامها

| الدور | ماذا يستطيع هنا |
|---|---|
| المالك | يرى السجل كاملًا، ويصفّيه، ويصدّره. |
| مدير الشركة | مثل المالك، إذا أُسند إليه دوره على «كل الفروع». إذا أُسند إلى فروع محددة فلا تظهر له الشاشة. |
| مدير الفرع، أمين الخزينة، مشرف، كاشير، طاقم المطبخ | لا يرونها في الأدوار الافتراضية. |

الصلاحيات المطلوبة: «استخدام تطبيق الإدارة» و«عرض سجل التدقيق».

- «عرض سجل التدقيق» صلاحية «على مستوى الشركة فقط». تعمل فقط إذا أُسند الدور على «كل الفروع».
- من يملكها يرى أحداث كل الفروع. لا يوجد سجل تدقيق لفرع واحد.
- يمنحها لموظف آخر: المالك، أو مدير يملك «إدارة الموظفين» وجميع صلاحيات الدور الذي يمنحه. انظر قسم «الموظفون والدعوات وإسناد الأدوار والإيقاف».

## قبل أن تبدأ

- ادخل إلى «الإدارة». انظر قسم «واجهة الإدارة».
- اعرف اليوم التقريبي للحادثة. التصفية بالتاريخ تختصر البحث كثيرًا.
- على الجوال لا يظهر عمودا «السجل» و«التفاصيل». للتحقيق استخدم الحاسوب بشاشة عريضة، أو «تصدير CSV».

## الخطوات

### فتح الشاشة

على الحاسوب:

1. من القائمة الجانبية، تحت «المنشأة»، اختر «سجل التدقيق».

على الجوال:

1. اضغط زر القائمة ☰ («فتح القائمة») في أعلى الشاشة.
2. اختر «سجل التدقيق».

يظهر العنوان «سجل التدقيق»، وتحته: «كل إجراء مسجَّل في شركتك: تسجيلات الدخول، الإعدادات، الأسعار، المخزون، النقد، المبيعات والمرتجعات. السجلات دائمة ولا يمكن تعديلها.»

### قراءة الجدول

<!-- صورة مقترحة: جدول «سجل التدقيق» بأعمدته الخمسة وسطر فيه «التفاصيل» بصيغة «من → إلى». -->

الأحداث مرتبة من الأحدث إلى الأقدم. كل صفحة تعرض 50 حدثًا.

| العمود | ماذا يعرض |
|---|---|
| «الوقت» | تاريخ الحدث ووقته بساعة جهازك. |
| «من» | اسم الموظف الذي قام بالإجراء. أو جهة أخرى (انظر الجدول التالي). |
| «الإجراء» | رمز الإجراء بالإنجليزية، مثل `shift.opened`. معانيها في «رموز الإجراءات الشائعة» أدناه. |
| «السجل» | نوع السجل الذي تأثر، ثم أول 8 خانات من رقمه، مثل `shift · 0190a1b2`. |
| «التفاصيل» | ما سجّله النظام عن الحدث، ثم عنوان IP للجهاز في آخر السطر. |

ما يظهر في عمود «من»:

| ما يظهر | معناه |
|---|---|
| اسم موظف | موظف أو المالك قام بالإجراء من حسابه. |
| «مستخدم محذوف» | حساب لم يعد موجودًا. |
| «مشغّل المنصة» | فريق المنصة غيّر شيئًا في شركتك، مثل الباقة أو حالة الحساب. |
| «النظام» | إجراء تلقائي، مثل انتهاء عملية بيع معلّقة. |
| «مجهول» | شخص بلا حساب، مثل متسوق في المتجر الإلكتروني. |

- عمود «السجل» يختفي على الشاشات الصغيرة. وعمود «التفاصيل» يختفي على الجوال والأجهزة اللوحية.
- لا يُفتح السطر بالضغط عليه. كل ما يُعرض موجود في الجدول نفسه.
- أسفل الجدول عدّاد الأحداث، مثل «120 صنف». الرقم هو عدد الأحداث، رغم كلمة «صنف».
- للتنقل بين الصفحات اضغط «السابق» أو «التالي». بينهما رقم الصفحة، مثل «صفحة 1 من 3».

### التصفية بالفترة

1. اختر تاريخ البداية في «من».
2. اختر تاريخ النهاية في «إلى».
3. يتحدث الجدول وحده. يعود إلى الصفحة الأولى.

- اليومان «من» و«إلى» داخلان في النتيجة.
- الأيام تُقطع عند منتصف الليل بالمنطقة الزمنية للشركة. انظر قسم «إنشاء حساب الشركة».
- يكفي أحد الحقلين. «من» وحده يعرض كل ما بعده.
- لإلغاء التصفية امسح التاريخ من الحقل.

### التصفية بالإجراء

1. اكتب جزءًا من رمز الإجراء في الحقل «تصفية حسب الإجراء (مثل refund أو shift أو price)».
2. تظهر تحت الحقل اقتراحات بكل الرموز التي استُخدمت في شركتك. اختر واحدًا منها، أو أكمل الكتابة.
3. انتظر لحظة. يتحدث الجدول بعد أن تتوقف عن الكتابة.

- البحث بجزء من الرمز. كتابة `refund` تعرض `refund.requested` و`refund.approved` وكل رمز فيه هذه الكلمة.
- الأحرف الكبيرة والصغيرة سواء.
- كتابة `price` لا تعرض شيئًا. لا يوجد رمز إجراء فيه هذه الكلمة. لتغيير السعر انظر «من غيّر سعر هذا الصنف؟» أدناه.
- الحد 60 حرفًا.
- لإلغاء التصفية امسح الحقل.

### التصفية بنوع السجل

1. افتح قائمة «نوع السجل».
2. اختر نوعًا، مثل `product` أو `shift`.
3. لإلغاء التصفية اختر «كل أنواع السجلات».

**مهم:** القائمة تعرض فقط الأنواع الموجودة في الصفحة المعروضة الآن.
إذا لم تجد النوع الذي تريده فضيّق الفترة أو صفِّ بالإجراء أولًا، حتى يظهر في الصفحة.

أنواع شائعة:

| النوع | السجل |
|---|---|
| `sale` | عملية بيع. |
| `refund` | استرجاع، أو إلغاء بيع، أو استبدال. |
| `shift` | وردية، وحركاتها النقدية. |
| `product` / `category` | منتج / تصنيف. |
| `stock_adjustment` / `stock_transfer` | تعديل مخزون / تحويل مخزون. |
| `purchase_order` / `supplier` | أمر شراء / مورد. |
| `cash_disbursement` / `cash_transfer` | صرف من الخزينة / تحويل نقدي. |
| `membership` / `role` | موظف / دور. |
| `session` | جلسة دخول. |
| `merchant` / `branch` | الشركة وإعداداتها / فرع. |
| `report` | عرض تقرير أو تصديره. |

### قراءة التفاصيل (القيمة قبل → بعد)

عمود «التفاصيل» سطر واحد. أجزاؤه مفصولة بنقطة `·`. وفي آخره عنوان IP، مثل `10.0.0.5`.
الكلمات فيه بالإنجليزية كما خزّنها النظام. تظهر بثلاث صور:

| الصورة | مثال | كيف تقرؤها |
|---|---|---|
| قيمة واحدة | `amount: 15.000 · reason: other` | المبلغ `15.000 د.ك`، والسبب «أخرى». |
| قبل → بعد | `maxDiscountPercent: 10 → 15` | القيمة كانت 10 وأصبحت 15. |
| تغييرات بين أقواس | `changes: {"contactPhone":{"from":null,"to":"22223333"}}` | الحقل `contactPhone`: `from` القيمة القديمة (فارغة هنا)، و`to` الجديدة. |

- الصورة الثالثة تظهر عند تعديل بيانات الشركة أو فرع أو موظف أو مورد أو منتج أو تصنيف. لا يُكتب فيها إلا الحقل الذي تغيّر.
- `null` أو `—` يعني أن القيمة كانت فارغة.
- `true` تعني مفعّل، و`false` تعني غير مفعّل.

**تنبيه عن تعديل «سياسة البيع»:** يسجّل الحدث كل الإعدادات في كل حفظ، حتى التي لم تتغير. ابحث عن السطر الذي اختلف طرفاه.
والمبالغ فيه بالفلس، بلا فاصلة عشرية.
مثال: `refundApprovalLimit: 20000 → 25000` يعني أن «حد اعتماد الاسترجاع (د.ك)» تغيّر من `20.000 د.ك` إلى `25.000 د.ك`. (20000 ÷ 1000 = 20.000، و25000 ÷ 1000 = 25.000)

**تنبيه عن `[object Object]`:** بعض الأحداث تعرض هذه العبارة بدل محتواها. لا يمكن قراءته من هذه الشاشة ولا من الملف المصدَّر.
اقرأ المحتوى من الشاشة الخاصة به:

| الحدث | الجزء الذي لا يُقرأ | أين تجده |
|---|---|---|
| `product.updated`، `product.created` | `variants` (الأسعار والتكاليف) | «سجل الأسعار والتكاليف» في صفحة المنتج. انظر قسم «المنتجات». |
| `sale.completed` | `priceOverrides` (تعديل السعر في البيع) | تفاصيل العملية في «المبيعات». انظر قسم «سجل المبيعات». |
| `employee.roles_changed`، `employee.invited` | الأدوار والفروع | ملف الموظف الحالي. انظر قسم «الموظفون والدعوات وإسناد الأدوار والإيقاف». |

### تصدير CSV

1. ضع التصفية التي تريدها.
2. انتقل إلى الصفحة التي تريد تصديرها.
3. اضغط «تصدير CSV» في أعلى الشاشة.
4. يُنزَّل ملف إلى جهازك. افتحه في برنامج جداول.

- **الملف يحوي الصفحة المعروضة فقط**، أي 50 حدثًا على الأكثر. لتصدير أكثر انتقل إلى كل صفحة واضغط «تصدير CSV» مرة لكل صفحة.
- أعمدة الملف: «الوقت»، «من»، «الإجراء»، «نوع السجل»، «معرّف السجل»، «عنوان IP»، «التفاصيل».
- «معرّف السجل» في الملف كامل، لا أول 8 خانات فقط.
- الملف مفيد على الجوال: فيه العمودان المخفيان في الشاشة.
- الزر معطّل إذا لم يظهر أي حدث.
- كل تصدير يُسجَّل في السجل نفسه بالرمز `report.exported`، ومعه `report: audit` وعدد الأسطر.

### رموز الإجراءات الشائعة

الجدول يشرح الرموز كما تظهر في عمود «الإجراء». لا يظهر في شركتك إلا ما حدث فعلًا.

#### الدخول والجلسات

| الرمز | المعنى |
|---|---|
| `auth.login.succeeded` | دخول ناجح إلى الإدارة أو نقطة البيع. |
| `auth.interface.switched` | انتقال من الإدارة إلى نقطة البيع، أو العكس. |
| `auth.branch.switched` | تغيير الفرع في نقطة البيع. |
| `auth.merchant.switched` | الانتقال إلى شركة أخرى. |
| `auth.pos.locked` / `auth.pos.unlocked` | قفل شاشة نقطة البيع / فتح قفلها بكلمة المرور. |
| `auth.password_changed` | تغيير كلمة المرور من «حسابي». |
| `auth.session_revoked` / `auth.sessions_revoked_others` | إنهاء جلسة جهاز واحد / إنهاء كل الجلسات الأخرى من «حسابي». |

#### الموظفون والأدوار

| الرمز | المعنى |
|---|---|
| `employee.invited` / `employee.invitation_accepted` | إرسال دعوة / قبولها. |
| `employee.invitation_resent` / `employee.invitation_revoked` | إعادة إرسال الدعوة / إلغاؤها. |
| `employee.updated` | تعديل ملف الموظف (قبل → بعد). |
| `employee.roles_changed` | تغيير أدوار الموظف أو فروعه. |
| `employee.activated` / `employee.deactivated` | تفعيل الموظف / إيقافه. |
| `employee.sessions_revoked` | «إنهاء كل الجلسات» لموظف. |
| `employee.login_unlocked` | «فك قفل تسجيل الدخول» لموظف. |
| `employee.password_reset_sent` | إرسال بريد إعادة تعيين كلمة المرور لموظف. |
| `role.created` / `role.updated` / `role.deleted` | إنشاء دور / تعديل صلاحياته (المضاف والمحذوف) / حذفه. |

#### الشركة والإعدادات

| الرمز | المعنى |
|---|---|
| `merchant.registered` | إنشاء حساب الشركة. |
| `merchant.profile.updated` | تعديل «بيانات الشركة» (قبل → بعد). |
| `merchant.timezone_changed` | تغيير المنطقة الزمنية (`from` القديمة، `to` الجديدة). |
| `branch.created` / `branch.updated` | إضافة فرع / تعديل بياناته. |
| `branch.activated` / `branch.deactivated` | تفعيل فرع / إيقافه. |
| `sales.settings_updated` | تعديل «سياسة البيع». |
| `inventory.settings_updated` | تعديل «إعدادات المخزون». |
| `payment_method.created` / `payment_method.updated` | إنشاء طريقة دفع / تعديلها. |
| `financial_account.created` / `financial_account.updated` | إنشاء حساب مالي / تعديله. |
| `period.closed` | «إقفال الشهر». |
| `merchant.ownership_transfer.started` / `merchant.ownership_transfer.cancelled` | بدء نقل الملكية / إلغاؤه. |
| `merchant.ownership_transferred` | اكتمال نقل الملكية. |

#### المنتجات

| الرمز | المعنى |
|---|---|
| `product.created` / `product.updated` | إنشاء منتج / حفظ تعديل عليه، ومنه تغيير السعر أو التكلفة. |
| `product.archived` / `product.restored` | أرشفة منتج / استعادته. |
| `product.image_added` / `product.image_removed` | رفع صورة / حذفها. |
| `category.created` / `category.updated` | إنشاء تصنيف / تعديله. |
| `category.archived` / `category.restored` | أرشفة تصنيف / استعادته. |

#### البيع في نقطة البيع

| الرمز | المعنى |
|---|---|
| `sale.completed` | إتمام عملية بيع. التفاصيل: رقم الإيصال والإجمالي والخصومات. |
| `sale.completed_exchange` | عملية البيع الجديدة في استبدال. |
| `sale.override_granted` | مشرف اعتمد استثناءً على جهاز كاشير. في «من» اسم المشرف. |
| `sale.override_refused` | محاولة موافقة مشرف رُفضت (كلمة مرور خاطئة، أو المشرف لا يملك ما يُطلب). |
| `sale.reprinted` | طباعة نسخة من إيصال. |
| `cart.cleared` / `cart.line_removed` | مسح السلة / إزالة صنف منها، بقيمة تساوي حد التسجيل أو أكثر. |
| `order.suspended` | «تعليق» عملية بيع. |
| `order.cancelled` | حذف عملية بيع معلّقة. |
| `order.expired` | انتهاء عملية بيع معلّقة تلقائيًا. في «من»: «النظام». |

#### المرتجعات

| الرمز | المعنى |
|---|---|
| `refund.completed` | استرجاع تم مباشرة. |
| `refund.requested` | استرجاع ينتظر الاعتماد. التفاصيل تذكر أسبابه. |
| `refund.approved` / `refund.rejected` | اعتماد استرجاع معلّق / رفضه. |
| `refund.cancelled` | سحب طلب استرجاع معلّق. |
| `refund.exchange` | استبدال. |
| `sale.voided` | «إلغاء البيع». |

#### الوردية والدرج

| الرمز | المعنى |
|---|---|
| `shift.opened` | فتح وردية. التفاصيل: المتوقع والمعدود والفرق. |
| `shift.closed` | إغلاق الوردية. `discrepancy` هو الفرق؛ السالب عجز. |
| `shift.force_closed` | «إغلاق الوردية بواسطة المدير». `counted: false` يعني بدون جرد. |
| `shift.cash_in` / `shift.cash_out` | «إيداع نقدي» / «سحب نقدي». `reason` نوع الحركة. |
| `shift.cash_out_requested` | سحب فوق الحد ينتظر اعتماد مدير. |
| `shift.cash_out_approved` / `shift.cash_out_rejected` | اعتماد السحب المعلّق / رفضه. |
| `shift.cash_out_withdrawn` | سحب الكاشير لطلب السحب. |
| `register.created` / `register.updated` | إنشاء صندوق / تعديله. |
| `register.activated` / `register.deactivated` | تفعيل صندوق / إيقافه. |
| `cash.variance.followup` | تسجيل متابعة فرق نقدي. |

قيم `reason` في الحركات النقدية:

| القيمة | الحركة |
|---|---|
| `safe_drop` / `float_top_up` | «سحب إلى الخزينة» / «تعزيز من الخزينة». |
| `change_received` | «تبديل فكّة (لا يغيّر المبلغ)». |
| `petty_expense` / `supplier_payment` | «مصروف نثري» / «دفعة لمورد». |
| `bank_deposit` | «إيداع بنكي». |
| `correction` / `other` | «تصحيح» / «أخرى». |

#### الخزينة والبنك

| الرمز | المعنى |
|---|---|
| `cash.counted` | جرد خزينة أو صندوق من «إدارة النقدية». |
| `cash.transfer.created` | «تحويل نقدي» بين صندوق وخزينة. |
| `cash.disbursement.created` / `cash.disbursement.reversed` | صرف مصروف أو دفعة مورد من الخزينة / عكسه. |
| `cash.payout_request.created` | صرف فوق الحد ينتظر الاعتماد. |
| `cash.payout_request.approved` / `cash.payout_request.rejected` / `cash.payout_request.withdrawn` | اعتماده / رفضه / سحبه. |
| `cash.deposit.created` | «إيداع بنكي» من الخزينة. |
| `cash.deposit.confirmed` / `cash.deposit.returned` | تأكيد الإيداع في البنك / إرجاعه إلى الخزينة. |
| `cash.branch_transfer.sent` / `cash.branch_transfer.received` / `cash.branch_transfer.cancelled` | إرسال نقد لفرع آخر / تأكيد استلامه / إلغاؤه. |
| `bank.reconciled` | حفظ «المطابقة البنكية». |

#### المخزون

| الرمز | المعنى |
|---|---|
| `inventory.adjusted` | تعديل مخزون رُحِّل مباشرة. |
| `inventory.adjustment_requested` | تعديل فوق الحد ينتظر الاعتماد. |
| `inventory.adjustment_approved` / `inventory.adjustment_rejected` / `inventory.adjustment_withdrawn` | اعتماده / رفضه / سحبه. |
| `inventory.threshold_set` | ضبط «حد التنبيه». |
| `inventory.damaged_return_disposed` | «تسجيل التصفية» لمرتجع محتجز. |
| `transfer.requested` / `transfer.approved` / `transfer.cancelled` | طلب تحويل مخزون / اعتماده / إلغاؤه. |
| `transfer.dispatched` / `transfer.received` | إرسال التحويل / استلامه. |
| `transfer.received_with_discrepancy` | استلام بكمية مختلفة عن المُرسل. |
| `transfer.recalled` | استرجاع التحويل إلى الفرع المصدر. |
| `transfer.loss_requested` / `transfer.loss_posted` | «تسجيل خسارة» ينتظر الاعتماد / شُطب مباشرة. |
| `transfer.loss_approved` / `transfer.loss_rejected` | اعتماد الخسارة / رفضها. |

#### المشتريات والعملاء

| الرمز | المعنى |
|---|---|
| `supplier.created` / `supplier.updated` | إضافة مورد / تعديله. |
| `purchase_order.created` / `purchase_order.updated` | إنشاء أمر شراء / تعديل مسودته. |
| `purchase_order.submitted` / `purchase_order.approved` | «إرسال للاعتماد» / اعتماده. |
| `purchase_order.received` | «استلام شحنة». |
| `purchase_order.cancelled` / `purchase_order.closed` | إلغاء الأمر / «إغلاق المتبقي». |
| `customer.created` / `customer.updated` | إضافة عميل / تعديل بياناته. |
| `customer.activated` / `customer.deactivated` | تفعيل عميل / إيقافه. |
| `customer.note_added` | إضافة ملاحظة على عميل. |

#### التقارير وفريق المنصة

| الرمز | المعنى |
|---|---|
| `report.viewed` | فتح تقرير. التفاصيل: اسمه والفترة والفروع والموظف. |
| `report.exported` | «تصدير CSV» من تقرير أو من هذا السجل. |
| `platform.subscription.changed` | فريق المنصة غيّر باقة الاشتراك. |
| `platform.merchant.suspended` / `platform.merchant.reactivated` / `platform.merchant.closed` | فريق المنصة أوقف حساب الشركة / أعاد تفعيله / أغلقه. |
| `platform.merchant.owner_frozen` / `platform.merchant.owner_released` | فريق المنصة جمّد حساب المالك / رفع التجميد. |
| `platform.merchant.ownership_transferred` | فريق المنصة نقل الملكية. |

أحداث المتجر الإلكتروني تبدأ بـ`online.`، مثل `online.order_placed` (طلب جديد من متسوق) و`online.order_paid` (دُفع الطلب).
وأحداث المطعم تبدأ بـ`restaurant.`، مثل `restaurant.item_cancelled` (إلغاء صنف من طلب).

#### ما لا يظهر في السجل

| ما لا يظهر | السبب |
|---|---|
| محاولات الدخول بكلمة مرور خاطئة، وإيقاف الدخول بعدها | تُسجَّل بلا شركة، فلا تراها أي شركة. |
| طلب رابط إعادة تعيين كلمة المرور، واستخدامه | تُسجَّل بلا شركة. |
| تسجيل الخروج | لا يُسجَّل. |
| فتح «سجل التدقيق» نفسه | لا يُسجَّل. التصدير وحده يُسجَّل. |
| فتح الدرج | النظام لا يسجّله. انظر «من فتح الدرج بلا بيع؟» أدناه. |

ما تراه بدلًا من ذلك: `employee.login_unlocked` عندما يفك مدير قفل موظف.

### تحقيق: «من غيّر سعر هذا الصنف؟»

أسرع طريق هو «سجل الأسعار والتكاليف» في صفحة المنتج. «سجل التدقيق» يؤكد الوقت وعنوان الجهاز.

مثال: سعر عصير برتقال تغيّر من `0.750 د.ك` إلى `0.850 د.ك`، ولا تعرف من غيّره.

1. من القائمة الجانبية اختر «المنتجات».
2. افتح المنتج.
3. انزل إلى «سجل الأسعار والتكاليف».
4. ابحث عن سطر «سعر البيع» في عمود «ماذا»، وفيه `0.750 د.ك → 0.850 د.ك` في «من → إلى».
5. اقرأ «متى» و«بواسطة». هذا هو الجواب.
6. للتأكيد افتح «سجل التدقيق».
7. اختر يوم التغيير في «من» و«إلى».
8. اكتب `product.updated` في حقل التصفية.
9. ابحث عن السطر في الوقت نفسه وباسم الشخص نفسه.
10. اقرأ في «التفاصيل» اسم المنتج بعد `before:`، وعنوان IP في آخر السطر.

- في التفاصيل يظهر الاسم الإنجليزي للمنتج إن وُجد، مثل `"name":"Orange juice"`.
- قيم السعر نفسها تظهر هنا `variants: [object Object]`. اقرأها من «سجل الأسعار والتكاليف».
- `changes: {}` يعني أن بيانات المنتج الأخرى لم تتغير.
- التكلفة في «سجل الأسعار والتكاليف» يراها من يملك «إدارة الأسعار والتكلفة».
- انظر قسم «المنتجات».

**إذا كان السعر تغيّر في عملية بيع واحدة فقط**، فهذا تعديل سعر في نقطة البيع، لا تغيير في سعر المنتج:

1. من القائمة الجانبية اختر «المبيعات».
2. من قائمة «المبيعات غير الاعتيادية» اختر «سعر معدَّل».
3. افتح العملية لترى السعر الأصلي والجديد والسبب. انظر قسم «سجل المبيعات».
4. إذا كانت الإشارة «اعتماد مشرف» أيضًا فاكتب `sale.override_granted` في حقل التصفية في «سجل التدقيق».
5. السطر في وقت العملية يحمل في «من» اسم المشرف الذي وافق.

### تحقيق: «من فتح الدرج بلا بيع؟»

**النظام لا يسجّل فتح الدرج.** لا يوجد في نقطة البيع زر لفتح الدرج بلا بيع، ولا رمز إجراء لذلك في السجل.
لا تستطيع معرفة من فتح الدرج من النظام.

ما تستطيعه: البحث عن آثار نقد خرج أو عملية بدأت ثم اختفت. راجع هذه الأدلة بالترتيب، في يوم الحادثة:

| الدليل | اكتب في حقل التصفية | ماذا تبحث عنه |
|---|---|---|
| نقص في الدرج عند الإغلاق | `shift.closed` | `discrepancy` بإشارة سالبة، مثل `discrepancy: -5.000`. |
| سحب نقدي «أخرى» | `shift.cash_out` | `reason: other` ومبلغه. |
| سلة مُسحت بعد إضافة أصناف | `cart.` | `cart.cleared` أو `cart.line_removed` ومبلغها `amount`. |
| نسخة إيصال طُبعت | `sale.reprinted` | رقم الإيصال `receiptNumber`. |
| عملية أُلغيت أو استُرجعت | `sale.voided` أو `refund` | من قام بها ومتى. |
| من كان على الجهاز | `auth.pos` | أوقات قفل الشاشة وفتحها، واسم من فتحها. |

مثال: الوردية أُغلقت والنقد المتوقع `120.000 د.ك` والمعدود `115.000 د.ك`.
يظهر في التفاصيل `discrepancy: -5.000`، أي عجز `5.000 د.ك`. (115.000 − 120.000 = −5.000)
وفي اليوم نفسه سطر `cart.cleared` بتفاصيل `amount: 7.500 · lineCount: 3`.
معناه: عملية بثلاثة أصناف بـ`7.500 د.ك` مُسحت دون بيع. اسأل الموظف في عمود «من» عنها.

خطوات مراجعة سحب «أخرى»:

1. في «سجل التدقيق» اكتب `shift.cash_out` في حقل التصفية.
2. ابحث عن `reason: other` في «التفاصيل».
3. سجّل الوقت والاسم في «من».
4. من القائمة الجانبية اختر «الورديات».
5. افتح وردية هذا الشخص في ذلك اليوم. اسمه في عمود «الموظف».
6. في «الحركات النقدية» اقرأ «ملاحظة» الحركة «أخرى».

- **وصف حركة «أخرى» لا يُكتب في سجل التدقيق.** تجده في تفاصيل الوردية فقط. انظر قسم «الصناديق، متابعة الورديات».
- `cart.cleared` يُسجَّل فقط إذا كانت قيمة السلة تساوي «تسجيل مسح السلة من (د.ك)» أو أكثر. الافتراضي `5.000 د.ك`، ويُغيَّر من «سياسة البيع».
- العجز نفسه ومتابعته تجدهما في «فروقات النقد» و«متابعة الفروقات». انظر قسم «الصناديق، متابعة الورديات».
- هذه أدلة، لا إثبات. فتح الدرج دون أي حركة لا يترك أثرًا.

## ماذا يحدث بعد التنفيذ

| الأثر | ماذا يحدث |
|---|---|
| المخزون | لا يتأثر. |
| النقدية | لا تتأثر. |
| سجل التدقيق | فتح الشاشة والتصفية لا يُسجَّلان. كل «تصدير CSV» يُسجَّل بالرمز `report.exported`، مع الفترة وعدد الأسطر. |
| ما يراه العميل | لا يتأثر. |

- **لا أحد يستطيع تعديل حدث أو حذفه**، ولا المالك. هذا ما يجعل السجل دليلًا.
- الشاشة للقراءة فقط. لا يوجد فيها زر يغيّر شيئًا.

## حالات تحتاج شخصًا ثانيًا أو اعتمادًا

| الحالة | من يتدخل | كيف |
|---|---|---|
| موظف يحتاج رؤية «سجل التدقيق» | المالك، أو مدير يملك «إدارة الموظفين» وجميع صلاحيات الدور الذي يمنحه | يسند له دورًا فيه «عرض سجل التدقيق» على «كل الفروع» من «الموظفون». |
| مدير الشركة لا يرى الشاشة | المالك | يتأكد أن دوره مسند على «كل الفروع»، لا على فرع محدد. |

## رسائل الخطأ الشائعة

| الرسالة كما تظهر | معناها | ماذا تفعل |
|---|---|---|
| «ليست لديك صلاحية لعرض هذه الصفحة.» | لا تملك «عرض سجل التدقيق» على «كل الفروع». | اطلبها من المالك إن كنت تحتاجها. |
| «لا توجد أحداث مطابقة لهذه التصفية.» | التصفية لا تطابق أي حدث. | وسّع الفترة، أو اكتب جزءًا أقصر من الرمز، أو اختر «كل أنواع السجلات». |
| «حدث خطأ ما» ثم «بعض الحقول غير صحيحة، يرجى مراجعتها.» | النص في حقل التصفية أطول من 60 حرفًا. | اكتب جزءًا أقصر من الرمز. |
| «حدث خطأ ما» ثم «تعذّر الاتصال بالخادم. تحقق من الاتصال.» | الجهاز غير متصل. | تحقق من الاتصال، ثم اضغط «إعادة المحاولة». |

## تنبيهات

- **الوقت بساعة جهازك، والتصفية بأيام الشركة.** إذا اختلفت منطقة جهازك عن منطقة الشركة فقد ترى حدثًا قرب منتصف الليل بتاريخ يوم آخر.
- **رمز «الإجراء» ليس رسالة خطأ.** هو اسم تقني ثابت. معانيها في «رموز الإجراءات الشائعة».
- **«من» في العمود غير «من» في التاريخ.** العمود «من» هو الشخص. الحقل «من» هو تاريخ بداية الفترة.
- **لا توجد تصفية باسم الموظف.** لمراجعة موظف واحد صدّر الصفحات، ثم صفِّ عمود «من» في برنامج الجداول.
- **`refund` في السجل للمرتجعات فقط.** استرجاع التحويل يظهر `transfer.recalled`.
- **«التحويلات» كلمتان مختلفتان هنا:** `transfer.` لتحويلات المخزون، و`cash.transfer` و`cash.branch_transfer` للنقد.
- **الأرقام في `sales.settings_updated` بالفلس.** اقسمها على 1000.

## أسئلة تدريب

1. أين تجد «سجل التدقيق»؟ ومن يراه افتراضيًا؟
   - **الإجابة:** في القائمة الجانبية تحت «المنشأة». يراه المالك، ومدير الشركة إذا أُسند دوره على «كل الفروع».
2. تريد كل ما يخص المرتجعات يوم 2026-10-12. ماذا تفعل؟
   - **الإجابة:** أختار 2026-10-12 في «من» و«إلى»، وأكتب `refund` في حقل التصفية.
3. ظهر `refundApprovalLimit: 20000 → 30000` في تفاصيل `sales.settings_updated`. ماذا تغيّر؟
   - **الإجابة:** «حد اعتماد الاسترجاع (د.ك)» من `20.000 د.ك` إلى `30.000 د.ك`. الأرقام بالفلس. (30000 ÷ 1000 = 30.000)
4. ضغطت «تصدير CSV» والسجل فيه 120 حدثًا. كم حدثًا في الملف؟
   - **الإجابة:** 50 حدثًا فقط، وهي الصفحة المعروضة. أصدّر كل صفحة على حدة.
5. من غيّر سعر صنف؟ أين تنظر أولًا؟
   - **الإجابة:** في «سجل الأسعار والتكاليف» في صفحة المنتج: «متى» و«من → إلى» و«بواسطة». ثم أؤكد بـ`product.updated` في «سجل التدقيق».
6. هل يخبرك النظام من فتح الدرج بلا بيع؟
   - **الإجابة:** لا. النظام لا يسجّل فتح الدرج. أراجع العجز عند الإغلاق `shift.closed`، والسحب «أخرى» `shift.cash_out`، ومسح السلة `cart.cleared`، ونسخ الإيصالات `sale.reprinted`.
