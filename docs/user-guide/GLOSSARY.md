# قاموس المصطلحات

المصطلح العربي في العمود الأول منسوخ حرفيًا من الواجهة العربية. العمود الثاني يذكر
المقابل في الكود: مفتاح الترجمة (`ملف:مفتاح`) والمفهوم البرمجي عند الحاجة.

اختصارات الملفات:
- `common` = `packages/i18n/src/locales/ar.ts`
- `pos` = `apps/pos-web/src/i18n/ar.ts`
- `mgr` = `apps/manager-web/src/i18n/ar.ts`

---

## 1. النظام والدخول

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| عربات POS | `common:appName` | اسم النظام كما يظهر في الواجهة العربية. |
| نقطة البيع | `common:interfaces.pos` — تطبيق `/pos` | التطبيق الذي يبيع منه الكاشير في الفرع. |
| الإدارة | `common:interfaces.manager` — تطبيق `/manager` | تطبيق إدارة الشركة والفروع والتقارير. |
| الشركة | `common:auth.chooseMerchant` — merchant | صاحب الحساب في النظام؛ لكل شركة بياناتها المنفصلة. |
| الفرع | `pos:branch`، `mgr:nav.branches` — branch | موقع عمل للشركة؛ لكل فرع مخزونه وصناديقه وخزينته. |
| الفرع الرئيسي | بيانات افتراضية — `isMain` | الفرع الذي يُنشأ مع الشركة، ولا يمكن إيقافه. |
| كل الفروع | `mgr:top.allBranches` | عرض بيانات كل الفروع المسموح لك بها معًا. |
| تسجيل الدخول / تسجيل الخروج | `common:actions.signIn` / `signOut` | بدء العمل بحسابك وإنهاؤه. |
| نسيت كلمة المرور؟ | `common:auth.forgotPassword` | طلب رابط بالبريد لاختيار كلمة مرور جديدة. |
| قبول الدعوة | `common:invite.submit` — invitation | خطوة انضمام الموظف الجديد عبر الرابط الذي يصله بالبريد. |
| قفل | `common:lock.lockNow` | إيقاف نقطة البيع مؤقتًا حتى تُدخل كلمة مرورك. |
| نقطة البيع مقفلة | `common:lock.title` — screen lock | شاشة تظهر بعد 5 دقائق بدون استخدام أو بعد الضغط على «قفل». |
| فتح القفل | `common:lock.unlock` | العودة للعمل بإدخال كلمة مرور الحساب نفسه. |
| الدخول بحساب آخر | `common:lock.otherUser` | إنهاء العمل بالحساب الحالي ليدخل موظف آخر بحسابه. |
| اللغة | `common:language.label` | التبديل بين العربية والإنجليزية. |

## 2. الأشخاص والأدوار

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المالك | `mgr:employees.owner` — `is_owner` | صاحب الشركة؛ يملك كل الصلاحيات ولا يستطيع أحد تعديله. |
| مدير الشركة | قالب `company_manager` | دور إداري لكل الفروع، بدون نقطة البيع افتراضيًا. |
| مدير الفرع | قالب `branch_manager` | دور إداري لفرع محدد، بدون نقطة البيع افتراضيًا. |
| مشرف | قالب `supervisor` | دور في نقطة البيع بصلاحيات أوسع من الكاشير. |
| كاشير / الكاشير | قالب `cashier`، `pos:sale.cashier` | الموظف الذي يبيع في نقطة البيع. |
| طاقم المطبخ | قالب `kitchen` | دور يستخدم شاشة المطبخ فقط. |
| الموظفون | `mgr:nav.employees` — membership | الأشخاص العاملون في الشركة. |
| دعوة موظف | `mgr:employees.invite` — invitation | إرسال رابط بالبريد لينضم موظف جديد ويختار كلمة مروره. |
| دعوات معلّقة | `mgr:employees.tabInvitations` | دعوات أُرسلت ولم تُقبل بعد. |
| الدور | `mgr:employees.role` — role | مجموعة صلاحيات تُسند للموظف في فرع أو في كل الفروع. |
| الصلاحيات | `mgr:roles.permissions` — permission | ما يُسمح للموظف بعمله؛ تفرضها الإدارة في النظام وليس الشاشة فقط. |
| افتراضي / مخصص | `mgr:roles.template` / `custom` | دور جاء مع النظام / دور أنشأته الشركة. |
| إيقاف / تفعيل | `mgr:common.deactivate` / `activate` | منع موظف أو فرع أو صندوق من العمل / إعادته. |

## 3. الوردية والصندوق والنقد

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| الوردية | `pos:shift.current` — shift | فترة مسؤولية الكاشير عن صندوق، من فتحها إلى إغلاقها. |
| فتح وردية / فتح الوردية | `pos:shift.openTitle` / `open` | بدء الوردية بعدّ النقد الموجود في الدرج. |
| إغلاق الوردية | `pos:shift.close` | إنهاء الوردية بعدّ الدرج؛ يبقى النقد في الصندوق. |
| الوردية والنقد | `pos:shift.manage` | شاشة الوردية في نقطة البيع: النقد المتوقع والحركات والإغلاق. |
| الصندوق | `pos:shift.register` — register | جهاز البيع ومكان النقد في الفرع؛ لكل صندوق درج. |
| الدرج / درج الصندوق | `common:errors.INSUFFICIENT_CASH`، `mgr:cash.settlesInDrawer` — register drawer account | النقد الموجود فعليًا في الصندوق؛ رصيده ينتقل من وردية لأخرى. لا تستخدم الواجهة عبارة «درج النقد». |
| الخزينة | `mgr:cashCustody.treasury` — treasury account | مكان حفظ النقد في الفرع خارج الصناديق؛ لكل فرع خزينة. |
| إدارة النقدية | `mgr:nav.cash` — cash custody | شاشة الإدارة التي تعرض أين النقد: الخزائن والصناديق وقيد النقل. |
| إجمالي النقد | `mgr:cashCustody.total` | نقد الشركة كله: الخزائن + الصناديق + قيد النقل. |
| النقد المتوقع في الدرج | `pos:shift.expected` — expected cash | ما يجب أن يكون في الدرج حسب العمليات المسجلة. |
| النقد المعدود | `pos:shift.counted` | ما عدّه الموظف فعليًا. |
| الفرق | `pos:shift.discrepancy` | النقد المعدود ناقص المتوقع. |
| متوازنة / زيادة / عجز | `pos:shift.outcome_*` | نتيجة الإغلاق: الفرق ضمن المقبول / المعدود أكثر / المعدود أقل. |
| الفرق المقبول (د.ك) | `mgr:cash.tolerance` | أكبر فرق يُعتبر معه الإغلاق «متوازنة». |
| النقد الافتتاحي | `pos:shift.openingFloat` | المبلغ الذي يعدّه الكاشير عند فتح الوردية. |
| جرد | `mgr:cashCustody.count` — cash count | عدّ النقد فعليًا وتسجيله مقابل الرصيد في النظام. |
| رصيد افتتاحي بالجرد | `mgr:cashCustody.source_treasury_opening_count` | أول جرد للخزينة؛ يصبح رصيدها. |
| لم تُجرد بعد / يحتاج جرد | `mgr:cashCustody.notCounted` / `needsCount` | خزينة أو صندوق بلا رصيد مؤكد بعد. |
| كشف | `mgr:cashCustody.statement` — ledger entries | قائمة كل حركات خزينة أو صندوق مع الرصيد. |
| إيداع نقدي | `pos:shift.cashIn` — cash movement (in) | إدخال نقد إلى الدرج أثناء الوردية. |
| سحب نقدي | `pos:shift.cashOut` — cash movement (out) | إخراج نقد من الدرج أثناء الوردية. |
| سحب إلى الخزينة | `pos:shift.reason_safe_drop` — `safe_drop` | نقل نقد من الدرج إلى خزينة الفرع؛ ليس مصروفًا. |
| تعزيز من الخزينة | `pos:shift.reason_float_top_up` — `float_top_up` | نقل نقد من خزينة الفرع إلى الدرج. |
| تبديل فكّة (لا يغيّر المبلغ) | `pos:shift.reason_change_received` — `change_received` | تبديل فئات العملة؛ الرصيد لا يتغيّر. |
| مصروف نثري | `pos:shift.reason_petty_expense` — cash disbursement (expense) | مصروف حقيقي يُدفع من الدرج. |
| مصروف | `mgr:cashCustody.kind_expense` — cash disbursement (expense) | مصروف حقيقي يُدفع من خزينة الفرع، بتصنيف ثابت. |
| دفعة لمورد | `pos:shift.reason_supplier_payment` — cash disbursement (supplier payment) | دفع نقدي لمورد؛ ليس مصروفًا تشغيليًا. |
| إيداع بنكي | `pos:shift.reason_bank_deposit`، `mgr:cashCustody.deposit` — bank deposit | إخراج نقد من الدرج أو الخزينة إلى حساب بنكي. |
| تحويل نقدي | `mgr:cashCustody.transfer` — cash transfer | نقل نقد بين صندوق وخزينة فرعه في الإدارة. |
| تحويل لفرع آخر | `mgr:cashCustody.sendToBranch` — branch cash transfer | إرسال نقد من خزينة فرع إلى خزينة فرع آخر. |
| قيد النقل | `mgr:cashCustody.inTransit` | نقد أُرسل لفرع آخر ولم يؤكد استلامه بعد؛ ما زال من نقد الشركة. |
| عكس | `mgr:cashCustody.reverse` — reversal | تصحيح مصروف أو دفعة بسجل معاكس يعيد النقد؛ السجل الأصلي يبقى. |
| إغلاق الوردية بواسطة المدير | `mgr:cash.forceCloseTitle` — force close | إغلاق مدير لوردية كاشير، مع جرد أو بدونه. |
| إغلاق إجباري بدون جرد | `mgr:cash.forcedUncounted` — `forced_uncounted` | إغلاق مدير بدون عدّ؛ يجب جرد الصندوق قبل الوردية التالية. |
| بين الورديات | `mgr:cash.betweenShifts` | فرق ظهر عندما عدّ الكاشير التالي الدرج عند الفتح. |

## 4. البيع

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| عملية البيع الحالية | `pos:sale.cart` — cart | السلة التي يجهّزها الكاشير قبل الدفع. |
| ابحث أو امسح الباركود | `pos:sale.search` | خانة البحث بالاسم أو الرمز أو الباركود. |
| المجموع / الخصومات / الإجمالي | `pos:sale.subtotal` / `discounts` / `total` | قبل الخصم / مجموع الخصومات / المبلغ المطلوب. |
| الدفع | `pos:sale.pay` | فتح نافذة الدفع. |
| إتمام البيع | `pos:sale.complete` — checkout | تسجيل البيع نهائيًا بعد أن تساوي الدفعات الإجمالي. |
| النقد المستلم (د.ك) | `pos:sale.tendered` | ما سلّمه العميل نقدًا. |
| الباقي للعميل | `pos:sale.change` | الفرق الذي يُرجع للعميل؛ للنقد فقط. |
| المتبقي | `pos:sale.remaining` | ما بقي دون دفع من الإجمالي. |
| إضافة دفعة | `pos:sale.addPayment` — split payment | الدفع بأكثر من طريقة في نفس البيع. |
| الإيصال / رقم الإيصال | `pos:sale.receipt` / `receiptNo` — receipt number | مستند البيع المطبوع ورقمه. |
| طباعة الإيصال | `pos:sale.print` | طباعة الإيصال على طابعة 80 مم. |
| آخر المبيعات | `pos:sale.recent` | مبيعات ورديتك الحالية. |
| مسح | `pos:sale.clear` | تفريغ السلة؛ يحتاج ضغطة ثانية «تأكيد المسح». |
| تعليق | `pos:sale.suspend` — hold (suspended order) | حفظ السلة جانبًا لإكمالها لاحقًا. لا توجد في الواجهة عبارة «تعليق البيع». |
| المبيعات المعلّقة | `pos:sale.heldSales` | قائمة السلات المعلّقة في الفرع. |
| استئناف / حذف | `pos:sale.resume` / `discard` | إعادة سلة معلّقة إلى البيع / التخلص منها. |
| الخصم | `pos:sale.discount` — line discount | تخفيض على صنف، بنسبة أو بمبلغ. |
| خصم على الفاتورة | `pos:sale.orderDiscount` — order discount | تخفيض على البيع كله يوزَّع على الأصناف. |
| أكبر خصم بدون مشرف (%) | `mgr:sales.maxDiscount` | حد الخصم المسموح به لمن لا يملك «خصومات تتجاوز الحد». |
| خصومات تتجاوز الحد | `mgr:perm.sales.discount.override_limit` | صلاحية الخصم فوق الحد. هذا الموضع الوحيد لكلمة «تجاوز» كمفهوم في الواجهة. |
| السعر الجديد (د.ك) / تم تعديل السعر | `pos:sale.priceOverride` / `overridden` — price override | تغيير سعر الصنف عند البيع لمن يملك «تعديل الأسعار». |
| العميل / عميل عابر | `pos:customer.label` / `walkIn` | العميل المسجل على البيع / بيع بدون عميل. |
| نفد / منخفض / المتوفر | `pos:sale.outOfStock` / `lowStock` / `inStock` | حالة مخزون الصنف كما تظهر على بطاقة المنتج. |
| سياسة البيع | `mgr:sales.policy` — sales settings | إعدادات حد الخصم ومهلة الإرجاع وحد الاعتماد. |
| القناة | `mgr:sales.channel` | مصدر البيع: نقطة البيع أو إلكتروني. |

## 5. المرتجعات

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المرتجعات | `pos:returns.open`، `mgr:nav.refunds` | اسم شاشة الإرجاع في نقطة البيع والإدارة. |
| استرجاع | `pos:returns.refund` — refund | إرجاع أصناف وإعادة قيمتها للعميل. |
| استبدال | `pos:returns.exchange` — exchange | إرجاع أصناف وأخذ أصناف جديدة مع دفع الفرق أو استرداده. |
| إلغاء البيع | `pos:returns.void` — sale void | إلغاء بيع كامل من ورديتك المفتوحة قبل أي مرتجع. |
| إعادة للمخزون | `pos:returns.restock` | إرجاع الصنف إلى رصيد المخزون (لا يُستخدم للتالف). |
| يُعاد إلى | `pos:returns.payBack` | طريقة الدفع التي يُعاد إليها المبلغ. |
| مهلة الإرجاع (أيام) | `mgr:sales.refundWindow` — return window | بعدها يحتاج الاسترجاع اعتمادًا. |
| حد اعتماد الاسترجاع (د.ك) | `mgr:sales.refundLimit` — approval limit | فوقه يحتاج الاسترجاع اعتمادًا. |
| بانتظار الاعتماد | `mgr:refunds.status_pending_approval` | استرجاع ينتظر قرار من يملك «اعتماد الاسترجاع المقيّد». |
| اعتماد / رفض | `mgr:refunds.approve` / `reject` | قرار على استرجاع ينتظر. |
| مسحوب | `mgr:refunds.status_cancelled` | استرجاع أُلغي طلبه قبل القرار. |
| رصيد المرتجع / رصيد الاستبدال | `pos:returns.credit` / `mgr:refunds.credit` | قيمة الأصناف المرتجعة المستخدمة لدفع أصناف الاستبدال. |
| نشاط غير اعتيادي | `mgr:refunds.tabActivity` | موظفون نسبة استرجاعهم مرتفعة أو لديهم إرجاع متأخر. |

## 6. المنتجات والمخزون

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المنتجات / منتج جديد | `mgr:catalog.productsTitle` / `newProduct` — product | تعريف ما تبيعه وسعره. |
| التصنيفات | `mgr:catalog.categoriesTitle` — category | تجميع المنتجات في نقطة البيع والتقارير. |
| الأنواع | `mgr:catalog.variants` — variant | صيغ المنتج الواحد، مثل المقاس أو اللون. |
| سلعة / خدمة (بدون مخزون) | `mgr:catalog.typeStandard` / `typeService` | منتج له مخزون / منتج بلا مخزون. |
| سعر البيع / التكلفة | `mgr:catalog.price` / `cost` | سعر العميل / تكلفة الشركة (لا تظهر لمن لا يملك الصلاحية). |
| أرشفة / استعادة / مؤرشف | `mgr:catalog.archive` / `restore` / `archived` | إخفاء منتج دون حذفه / إعادته. المنتجات لا تُحذف. |
| المخزون | `mgr:inventory.title` — stock level | الكميات المتوفرة في كل فرع. |
| المتوفر | `mgr:inventory.onHand` | الكمية الحالية في الفرع. |
| حد التنبيه / تنبيه عند | `mgr:inventory.setThreshold` / `threshold` | الكمية التي يُعتبر الصنف عندها «منخفض». |
| متوسط التكلفة | `mgr:inventory.avgCost` — weighted average cost | التكلفة المرجّحة المتحركة للوحدة. |
| تعديل جديد / ترحيل التعديل | `mgr:inventory.newAdjustment` / `submit` — stock adjustment | مستند يغيّر الكميات يدويًا بسبب محدد؛ لا يُعدَّل بعد ترحيله. |
| رصيد افتتاحي / زيادة / نقص / جرد | `mgr:inventory.kind_*` | أنواع تعديل المخزون. |
| سجل الحركات | `mgr:inventory.tabMovements` — stock ledger | كل حركة مخزون بتاريخها ومصدرها. |
| تحويلات المخزون | `mgr:transfers.title` — stock transfer | نقل بضاعة بين الفروع: طلب، اعتماد، إرسال، استلام. |
| في الطريق | `mgr:transfers.status_in_transit` | بضاعة خرجت من الفرع المرسل ولم تُستلم بعد. |
| الناقص | `mgr:transfers.missing` | ما أُرسل ولم يصل؛ يُسجَّل فرقًا ويُشطب. |
| السماح بالبيع والخصم دون الصفر (مخزون سالب) | `mgr:inventory.allowNegative` | إعداد يسمح بالبيع رغم عدم توفر الكمية؛ معطّل افتراضيًا. |

## 7. المشتريات والعملاء

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| الموردون / مورد جديد | `mgr:purchasing.suppliersTitle` / `newSupplier` — supplier | الجهات التي تشتري منها الشركة. |
| أوامر الشراء / أمر شراء جديد | `mgr:purchasing.ordersTitle` / `newOrder` — purchase order | طلب بضاعة من مورد لفرع محدد. |
| مسودة / بانتظار الاعتماد / معتمد / مستلم جزئيًا / مستلم / مغلق | `mgr:purchasing.status_*` | مراحل أمر الشراء. |
| إرسال للاعتماد | `mgr:purchasing.submit` | نقل المسودة لمرحلة الاعتماد؛ لا يعتمدها من أنشأها (إلا المالك). |
| استلام شحنة | `mgr:purchasing.receive` — goods receipt | إدخال ما وصل من المورد إلى المخزون بتكلفة الأمر. |
| إغلاق المتبقي | `mgr:purchasing.close` | إنهاء أمر لن يصل باقيه، مع ذكر السبب. |
| العملاء / عميل جديد | `mgr:customers.title` / `new` — customer | ملفات العملاء ومشترياتهم. |
| صافي الإنفاق | `mgr:customers.netSpend` | إجمالي مشتريات العميل ناقص ما استُرد له. |

## 8. المطعم والمتجر الإلكتروني

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| الطاولات والطلبات | `pos:restaurant.floor` | شاشة الطاولات وطلبات السفري والاستلام. |
| صالة / سفري / استلام | `pos:restaurant.type_*` | نوع طلب المطعم. |
| إرسال للمطبخ | `pos:restaurant.sendToKitchen` — kitchen ticket | إرسال الأصناف لتظهر في شاشة المطبخ. |
| دفع الفاتورة | `pos:restaurant.payBill` — bill | دفع أصناف مختارة من الطلب. |
| نقل الطاولة / دمج | `pos:restaurant.moveTable` / `combine` | نقل الطلب لطاولة أخرى / ضم طلب آخر إليه؛ لا يغيّر المال. |
| إلغاء الصنف | `pos:restaurant.cancelItem` | إلغاء صنف من الطلب؛ بعد إرساله يحتاج صلاحية «إلغاء أصناف أُرسلت للمطبخ». |
| المطبخ / المحطة | `pos:kitchen.title` / `station` — kitchen station | شاشة تحضير الطلبات / قسم المطبخ الذي يستقبل الصنف. |
| جديد / قيد التحضير / جاهز | `pos:kitchen.column_*` | أعمدة شاشة المطبخ. |
| الإضافات | `mgr:restaurant.tabModifiers` — modifier group | خيارات تُطلب مع الصنف، مثل الحجم. |
| الوصفة | `mgr:restaurant.recipe` — recipe | المكونات التي تُخصم من المخزون عند بيع الصنف. |
| المتجر الإلكتروني | `mgr:nav.online` — online store | البيع عبر الإنترنت من فرع التجهيز. |
| فرع التجهيز | `mgr:online.branch` — fulfilment branch | الفرع الذي يُستخدم مخزونه وأسعاره للطلبات الإلكترونية. |
| يحتاج مراجعة | `mgr:online.status_needs_attention` | طلب دُفع لكن تعذّر تجهيزه تلقائيًا. |

## 9. التقارير والاشتراك

| المصطلح كما في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| صافي المبيعات | `mgr:reports.netSales` | إجمالي المبيعات ناقص الخصومات؛ ليس المبلغ المحصّل. |
| الصافي بعد المرتجعات | `mgr:reports.netAfterRefunds` | صافي المبيعات ناقص مرتجعات الفترة. |
| المحصّل | `mgr:reports.collected` | المبالغ المستلمة فعلًا عن المبيعات. |
| رسوم المعالجة | `mgr:reports.fees` | رسوم كل دفعة حسب طريقة الدفع. |
| إجمالي الربح | `mgr:reports.grossProfit` | لا يظهر إلا مع «التقارير المالية» ومعرفة تكلفة كل الأصناف. |
| تصدير CSV | `mgr:reports.exportCsv` | تنزيل جدول التقرير لفتحه في برنامج جداول. |
| الاشتراك / الباقة الحالية | `mgr:nav.subscription` / `subscription.current` — plan | باقة الشركة وحدودها؛ يغيّرها فريق المنصة فقط. |
| طرق الدفع | `mgr:nav.payments` — payment method | نقدًا، كي نت، فيزا / ماستركارد وغيرها، مع رسومها. |
| الحسابات المالية | `mgr:nav.accounts` — financial account | الخزينة والحسابات البنكية التي تستقر فيها الدفعات. |

## 10. مصطلحات غير موجودة في الواجهة

لا تُستخدم في الدليل:

| المصطلح | الوضع في الكود |
|---|---|
| إقفال الشهر | غير موجود. لا توجد ميزة ولا نص لإقفال فترة محاسبية. |
| درج النقد | غير موجود كنص. الواجهة تقول «الدرج» أو «درج الصندوق». |
| تعليق البيع | غير موجود كنص. الزر «تعليق»، والقائمة «المبيعات المعلّقة». |
| تجاوز (كإجراء موافقة) | لا توجد عملية «تجاوز» بموافقة مشرف. الكلمة تظهر فقط في «خصومات تتجاوز الحد» وفي تلميح «أكبر خصم بدون مشرف». |
| سجل التدقيق (كشاشة) | توجد صلاحية «عرض سجل التدقيق» فقط، بلا شاشة. |

---

## 11. تناقضات في الواجهة نفسها (للقرار)

كل سطر: المفهوم الواحد، والصيغ المختلفة في الواجهة، وأين تظهر. لا يُغيَّر شيء حتى يقرر المالك.

| # | المفهوم | الصيغ في الواجهة | أين تظهر |
|---|---|---|---|
| ت-1 | استرجاع المبلغ (refund) | «استرجاع» / «مرتجع» / «استرداد» | «رقم الاسترجاع» و«المسترجع» (`mgr:refunds`، `mgr:sales.refunded`)؛ «المرتجعات» (`mgr:nav.refunds`، `mgr:reports.refunds`)؛ «رقم الاسترداد» و«المسترد» و«استرداد واحد» (`mgr:customers`) |
| ت-2 | المرتجع النقدي | «مرتجعات نقدية» / «استرجاعات نقدية» / «استرجاع نقدي» | `pos:shift.cashRefunds`، `mgr:cash.cashRefunds`؛ `mgr:reports.custody_cashRefunds`؛ `mgr:cashCustody.source_refund_payment` |
| ت-3 | حركة مخزون الاسترجاع | «استرجاع» / «مرتجع» | `mgr:inventory.type_refund` / `mgr:reports.move_refund` |
| ت-4 | تصنيف المنتج (category) | «التصنيف» / «الفئة» / «الفئات» | `mgr:catalog.category`؛ `mgr:reports.byCategory` و`category` و`uncategorized` «بدون فئة» مقابل `mgr:catalog.noCategory` «بدون تصنيف»؛ `mgr:restaurant.routedCategories` |
| ت-5 | تعديل المخزون (adjustment) | «تعديل» / «تسوية» | «تعديلات المخزون» (`mgr:inventory.adjustmentsTitle`) / «تسويات المخزون» و«تسوية» (`mgr:reports.adjustments`، `move_adjustment`) |
| ت-6 | حركة إلغاء البيع | «إلغاء بيع» / «فاتورة ملغاة» / «مبيعات ملغاة» | `mgr:inventory.type_sale_void` / `mgr:reports.move_sale_void` / `mgr:refunds.voids` |
| ت-7 | استلام المشتريات | «استلام مشتريات» / «استلام بضاعة» / «استلام شحنة» / «دفعات استلام» | `mgr:inventory.type_purchase_receipt` / `mgr:reports.move_purchase_receipt` / `mgr:purchasing.receive` / `mgr:reports.receiptsWord` — وكلمة «دفعات» تعني أيضًا المدفوعات |
| ت-8 | النقد عند فتح الوردية | «النقد الافتتاحي» / «نقد الافتتاح» | `pos:shift.openingFloat`، `mgr:cash.openingFloat` / `mgr:reports.openingFloat` |
| ت-9 | نتيجة الإغلاق المتوازنة | «متوازنة» / «متوازن» | `pos:shift.outcome_balanced`، `mgr:cash.outcome_balanced` / `mgr:reports.balanced` |
| ت-10 | نفاد المخزون | «نفد» / «نافد» | `pos:sale.outOfStock`، `mgr:inventory.status_out` / `mgr:reports.stock_out` |
| ت-11 | حالة الإلغاء | «ملغى» / «ملغي» / «ملغاة» | `mgr:purchasing.status_cancelled`، `mgr:transfers`، `mgr:cashCustody`، `pos:restaurant` / `mgr:online.status_cancelled`، `mgr:subscription.status_cancelled` / `mgr:online.payment_cancelled` |
| ت-12 | باقة الاشتراك (plan) | «الباقة» / «خطة الاشتراك» / «خطة» | `mgr:subscription.*` / `common:errors.PLAN_LIMIT_REACHED`، `PLAN_FEATURE_UNAVAILABLE` |
| ت-13 | مكان النقد في الصندوق | «الصندوق» / «الدرج» / «درج الصندوق» | «النقد المتوقع في الدرج» (`pos:shift.expected`) مقابل «المتوقع في الصندوق» (`pos:shift.expectedInDrawer`)؛ «انقل النقد من الصندوق أولاً» (`common:errors.REGISTER_HAS_CASH`) مقابل «لا يحتوي الدرج…» (`INSUFFICIENT_CASH`) |
| ت-14 | مستند البيع | «عملية البيع» / «الفاتورة» / «الإيصال» | `pos:sale.cart`، `mgr:sales.detail` / «خصم على الفاتورة» (`pos:sale.orderDiscount`) و«خصم الفاتورة» (`mgr:sales.orderDiscount`) و«متوسط الفاتورة» / `pos:sale.receipt` |
| ت-15 | خصم الفاتورة | «خصم على الفاتورة» / «خصم الفاتورة» / «خصومات الفواتير» | `pos:sale.orderDiscount` / `mgr:sales.orderDiscount` / `mgr:reports.orderDiscounts` |
| ت-16 | كلمة «سحب» بثلاثة معانٍ | «سحب نقدي» (إخراج من الدرج) / «سحب إلى الخزينة» (نقل) / «مسحوب» (طلب استرجاع أُلغي) | `pos:shift.cashOut` / `pos:shift.reason_safe_drop`، `mgr:cashCustody.toTreasury` / `mgr:refunds.status_cancelled` |
| ت-17 | كلمة «إيداع» بمعنيين | «إيداع نقدي» (إدخال إلى الدرج) / «إيداع بنكي» (إخراج إلى البنك) | `pos:shift.cashIn` / `pos:shift.reason_bank_deposit` — قد يخلط الموظف بينهما |
| ت-18 | رصيد الاستبدال | «رصيد المرتجع» / «رصيد الاستبدال» / «رصيد استبدال» | `pos:returns.credit` / `mgr:refunds.credit` / `mgr:reports.exchangeCredit` |
| ت-19 | كلمة «القائمة» بمعنيين | قائمة الإجراءات في رأس نقطة البيع / قائمة الطعام | `pos:moreActions` / `pos:restaurant.menu`، `mgr:restaurant.tabMenu` |
| ت-20 | «قيد النقل» و«في الطريق» | نفس الحالة: خرج ولم يُستلم | `mgr:cashCustody.status_in_transit` (نقد) / `mgr:transfers.status_in_transit` (مخزون) |
| ت-21 | اسم تطبيق الإدارة | «الإدارة» / «إدارة الأعمال» / «تطبيق الإدارة» | `common:interfaces.manager` / `mgr:title` / `mgr:perm.manager.access` |
| ت-22 | كلمة «النوع» لأكثر من مفهوم | «الأنواع» = صيغ المنتج / «النوع» = سلعة أو خدمة / «النوع» = نوع التعديل أو الحركة | `mgr:catalog.variants` / `mgr:catalog.type` / `mgr:inventory.kind`، `type` |
| ت-23 | الحالة الموقوفة | «إيقاف» (موظف/فرع/صندوق) / «موقوف» (شركة أو متجر) | `mgr:common.deactivate` / `common:errors.MERCHANT_SUSPENDED`، `mgr:online.store_paused` |
| ت-24 | المصروف | «مصروف نثري» / «مصروف» | `pos:shift.reason_petty_expense` / `mgr:cashCustody.kind_expense` — نفس نوع السجل |
| ت-25 | «الطلبات» | أوامر شراء المورد / طلبات المطعم / الطلبات الإلكترونية | `mgr:purchasing.orders` / `pos:restaurant.order` / `mgr:online.tabOrders` |
| ت-26 | نص قديم في نقطة البيع | «يصبح كتالوج المنتجات متاحاً في المرحلة M2، والبيع في المرحلة M4.» | `pos:register.catalogEmpty` — غير مستخدم في الشاشات حاليًا، ويذكر مراحل تطوير داخلية |
