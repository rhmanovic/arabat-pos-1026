# قاموس المصطلحات المعتمدة في الدليل

كل مصطلح هنا منسوخ **حرفيًا** من نصوص الواجهة العربية. لا يستخدم الدليل مرادفًا من عنده.

- **العمود الأول:** المصطلح كما يظهر في الواجهة العربية.
- **العمود الثاني:** المقابل في الكود: مفتاح الترجمة (أو مفتاح الصلاحية / القالب) ثم النص
  الإنجليزي كما يظهر في الواجهة الإنجليزية.
- **العمود الثالث:** تعريف من سطر واحد للموظف.

بادئات المفاتيح: `common:` النصوص المشتركة (`packages/i18n/src/locales/ar.ts`)، `pos:` نقطة
البيع (`apps/pos-web/src/i18n/ar.ts`)، `manager:` الإدارة (`apps/manager-web/src/i18n/ar.ts`).
ملاحظة: كل نصوص الواجهة تأتي من هذه الملفات الثلاثة فقط؛ لم يُعثر على نص عربي مكتوب مباشرة
داخل الشاشات (عدا اسمي اللغتين «العربية» و«English»).

---

## 1. الواجهات والدخول

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| عربات POS | `common:appName` · Arabat POS | اسم النظام. |
| نقطة البيع | `common:interfaces.pos` · Point of Sale | واجهة الكاشير التي يتم فيها البيع والورديات والمرتجعات. |
| الإدارة | `common:interfaces.manager` · Manager | واجهة إدارة الشركة والفروع والمخزون والتقارير. |
| فتح نقطة البيع | `manager:top.openPos` · Open Point of Sale | زر في واجهة الإدارة للانتقال إلى نقطة البيع لمن يملك صلاحيتها. |
| اختر الشركة | `common:auth.chooseMerchant` · Choose a company | خطوة الدخول لمن يعمل في أكثر من شركة. |
| اختر الفرع | `common:auth.chooseBranch` · Choose a branch | خطوة دخول نقطة البيع: كل جلسة كاشير تعمل في فرع واحد. |
| تغيير الشركة | `manager:top.switchCompany` · Switch company | الانتقال إلى شركة أخرى ينتمي إليها المستخدم. |
| الفرع | `pos:branch`، `manager:top.branchContext` · Branch | موقع من مواقع الشركة؛ في الإدارة يحدد الفرع الذي تُعرض بياناته. |
| كل الفروع | `manager:top.allBranches` · All branches | عرض بيانات كل الفروع المسموح للمستخدم برؤيتها. |
| قفل | `common:lock.lockNow` · Lock | قفل شاشة نقطة البيع فورًا دون تسجيل الخروج. |
| نقطة البيع مقفلة | `common:lock.title` · POS locked | شاشة تظهر بعد 5 دقائق دون استخدام أو بعد الضغط على «قفل». |
| فتح القفل | `common:lock.unlock` · Unlock | إدخال كلمة مرور نفس المستخدم للعودة إلى العمل. |
| الدخول بحساب آخر | `common:lock.otherUser` · Sign in as someone else | خروج من الجلسة المقفلة ليدخل موظف آخر بحسابه. |
| نسيت كلمة المرور؟ | `common:auth.forgotPassword` · Forgot your password? | طلب رابط إعادة تعيين كلمة المرور بالبريد. |
| قبول الدعوة | `common:invite.submit` · Accept invitation | الخطوة التي ينضم بها الموظف إلى الشركة ويختار كلمة مروره. |

## 2. الأشخاص والأدوار

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المالك | `manager:employees.owner` · Owner (`is_owner`) | صاحب حساب الشركة؛ يملك كل الصلاحيات ولا يمكن إيقافه. |
| مدير الشركة | قالب `company_manager` · Company Manager | دور إداري لكل الفروع بدون نقطة البيع افتراضيًا. |
| مدير الفرع | قالب `branch_manager` · Branch Manager | دور إداري لفرع واحد بدون نقطة البيع افتراضيًا. |
| مشرف | قالب `supervisor` · Supervisor | دور في نقطة البيع بصلاحيات أوسع من الكاشير (إلغاء البيع، الخصم فوق الحد، الحركات النقدية). |
| كاشير | قالب `cashier` · Cashier؛ `pos:sale.cashier` | الموظف الذي يبيع في نقطة البيع. |
| طاقم المطبخ | قالب `kitchen` · Kitchen staff | دور يستخدم شاشة المطبخ فقط. |
| الدور | `manager:employees.role` · Role | مجموعة صلاحيات تُسند للموظف في فرع أو في كل الفروع. |
| الصلاحيات | `manager:roles.permissions` · Permissions | ما يُسمح للموظف بعمله؛ يفرضها الخادم مهما ظهر في الشاشة. |
| افتراضي / مخصص | `manager:roles.template` / `manager:roles.custom` · Default / Custom | دور جاء مع النظام / دور أنشأته الشركة. |
| دعوة موظف | `manager:employees.invite` · Invite employee | إرسال رابط بالبريد لينضم الموظف ويختار كلمة مروره. |
| مدعو | `manager:common.invited` · Invited | موظف أُرسلت له دعوة ولم يقبلها بعد. |
| دعوات معلّقة | `manager:employees.tabInvitations` · Pending invitations | الدعوات التي لم تُقبل بعد. |
| إيقاف / تفعيل | `manager:common.deactivate` / `manager:common.activate` · Deactivate / Activate | منع موظف أو فرع من العمل / إعادته؛ الإيقاف يخرجه من كل الأجهزة فورًا. |

## 3. البيع في نقطة البيع

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| عملية البيع الحالية | `pos:sale.cart` · Current sale | السلة: الأصناف التي يجري بيعها الآن. |
| ابحث أو امسح الباركود | `pos:sale.search` · Search or scan barcode | خانة البحث بالاسم أو رمز الصنف أو مسح الباركود. |
| نفد / منخفض | `pos:sale.outOfStock` / `pos:sale.lowStock` · Out / Low | شارة على الصنف: لا يوجد مخزون / المخزون عند حد التنبيه أو أقل. |
| المجموع | `pos:sale.subtotal` · Subtotal | قيمة الأصناف قبل الخصومات. |
| الخصومات | `pos:sale.discounts` · Discounts | مجموع خصومات الأصناف وخصم الفاتورة. |
| الإجمالي | `pos:sale.total` · Total | المبلغ الذي يدفعه العميل. |
| خصم على الفاتورة | `pos:sale.orderDiscount` · Discount on sale | خصم على عملية البيع كلها يوزَّع على الأصناف. |
| السعر الجديد (د.ك) | `pos:sale.priceOverride` · New price (KWD) | تعديل سعر صنف في عملية البيع؛ يحتاج صلاحية «تعديل الأسعار». |
| تم تعديل السعر | `pos:sale.overridden` · Price changed | علامة على صنف بيع بسعر غير سعره الأصلي. |
| الدفع | `pos:sale.pay` · Pay | فتح نافذة الدفع. |
| إضافة دفعة | `pos:sale.addPayment` · Add payment | الدفع بأكثر من طريقة في نفس عملية البيع. |
| النقد المستلم (د.ك) | `pos:sale.tendered` · Cash received (KWD) | المبلغ النقدي الذي سلّمه العميل. |
| المبلغ بالضبط | `pos:sale.exact` · Exact | العميل دفع المبلغ المطلوب بلا باقٍ. |
| المتبقي | `pos:sale.remaining` · Remaining | ما بقي من الإجمالي دون دفع. |
| الباقي للعميل | `pos:sale.change` · Change | النقد الذي يُعاد للعميل عند دفعه أكثر من المطلوب. |
| إتمام البيع | `pos:sale.complete` · Complete sale | تسجيل عملية البيع نهائيًا وخصم المخزون. |
| الإيصال / رقم الإيصال | `pos:sale.receipt` / `pos:sale.receiptNo` · Receipt / Receipt no. | المستند المطبوع للعميل ورقمه الذي يُستخدم في المرتجع. |
| طباعة الإيصال | `pos:sale.print` · Print receipt | طباعة الإيصال. |
| عملية بيع جديدة | `pos:sale.newSale` · New sale | بدء عملية بيع فارغة بعد الإتمام. |
| مسح | `pos:sale.clear` · Clear | تفريغ عملية البيع الحالية (يحتاج ضغطة تأكيد). |
| تعليق | `pos:sale.suspend` · Hold | حفظ عملية البيع جانبًا لإكمالها لاحقًا؛ لا تحجز مخزونًا. |
| المبيعات المعلّقة | `pos:sale.heldSales` · Held sales | قائمة عمليات البيع المعلّقة في الفرع. |
| استئناف | `pos:sale.resume` · Resume | إعادة عملية بيع معلّقة إلى السلة. |
| حذف | `pos:sale.discard` · Discard | حذف عملية بيع معلّقة نهائيًا. |
| آخر المبيعات | `pos:sale.recent` · Recent sales | مبيعات الوردية الحالية، ومنها إعادة طباعة الإيصال. |
| العميل | `pos:customer.label` · Customer | العميل المسجّل المرتبط بعملية البيع. |
| عميل عابر | `pos:customer.walkIn` · Walk-in | بيع بدون عميل مسجّل. |
| عميل جديد | `pos:customer.new` · New customer | إنشاء ملف عميل بسيط (الاسم والهاتف). |

## 4. المرتجعات والاسترجاع

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المرتجعات | `pos:returns.open`، `manager:nav.refunds` · Returns | شاشة إرجاع الأصناف المباعة. |
| استرجاع | `pos:returns.refund` · Refund | إرجاع أصناف وإعادة قيمتها للعميل. |
| استبدال | `pos:returns.exchange` · Exchange | إرجاع أصناف وأخذ أصناف جديدة في نفس العملية. |
| إلغاء البيع | `pos:returns.void` · Cancel sale | إلغاء عملية بيع كاملة من الوردية المفتوحة؛ يعود المبلغ والمخزون كاملين. |
| إعادة للمخزون | `pos:returns.restock` · Back to stock | إرجاع الصنف إلى المخزون (لا يُختار للتالف). |
| يُعاد إلى | `pos:returns.payBack` · Pay back | طريقة الدفع التي يعود إليها مبلغ الاسترجاع. |
| رصيد المرتجع | `pos:returns.credit` · Return credit | قيمة الأصناف المرتجعة التي تُحتسب في الاستبدال. |
| مهلة الإرجاع (أيام) | `manager:sales.refundWindow` · Return window (days) | المدة التي يُقبل فيها الإرجاع بدون اعتماد. |
| حد اعتماد الاسترجاع (د.ك) | `manager:sales.refundLimit` · Refund approval limit (KWD) | الاسترجاع فوق هذا المبلغ يحتاج اعتمادًا. |
| بانتظار الاعتماد | `manager:refunds.status_pending_approval` · Waiting for approval | استرجاع سُجّل وينتظر قرار من يملك صلاحية الاعتماد. |
| اعتماد / رفض | `manager:refunds.approve` / `manager:refunds.reject` · Approve / Reject | قرار على استرجاع معلّق. |
| مسحوب | `manager:refunds.status_cancelled` · Withdrawn | طلب استرجاع معلّق تم سحبه. |
| إيصال استرجاع | `pos:returns.receiptTitle` · Refund receipt | المستند المطبوع لعملية الاسترجاع. |
| نشاط غير اعتيادي | `manager:refunds.tabActivity` · Unusual activity | تبويب يميّز الموظفين ذوي نسبة الاسترجاع العالية أو الإرجاع المتأخر. |

## 5. الوردية والصندوق والنقد

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| الوردية | `pos:shift.current` · Shift | فترة مسؤولية الكاشير عن صندوق، تبدأ بعدّ الدرج وتنتهي بعدّه. |
| فتح وردية | `pos:shift.openTitle` · Open a shift | اختيار الصندوق وعدّ النقد لبدء العمل؛ لا بيع بدون وردية مفتوحة. |
| إغلاق الوردية | `pos:shift.close` · Close shift | عدّ الدرج في نهاية العمل وتسجيل الفرق. |
| الوردية والنقد | `pos:shift.manage` · Shift & cash | شاشة الوردية في نقطة البيع: الحركات النقدية والإغلاق. |
| الصندوق | `pos:shift.register` · Register | جهاز البيع ودرجه في الفرع؛ وردية واحدة مفتوحة لكل صندوق. |
| الدرج | `common:errors.INSUFFICIENT_CASH`، `pos:shift.expected` · drawer (Expected cash in drawer) | مكان النقد في الصندوق؛ رصيده ينتقل من وردية إلى التالية. |
| درج الصندوق | `manager:cash.settlesInDrawer` · Register drawer | المكان الذي يُسجَّل فيه النقد المستلم من المبيعات. |
| النقد الافتتاحي | `pos:shift.openingCash` · Opening cash | النقد في الدرج عند فتح الوردية. |
| النقد المتوقع في الدرج | `pos:shift.expected` · Expected cash in drawer | ما يجب أن يكون في الدرج حسب الحركات المسجلة. |
| النقد المعدود | `pos:shift.counted`، `manager:cash.counted` · Counted cash | ما عدّه الموظف فعليًا. |
| عدّ الأوراق والعملات | `pos:shift.countNotes` · Count notes and coins | العدّ بإدخال عدد كل فئة بدل الإجمالي. |
| الفرق | `pos:shift.discrepancy` · Difference | النقد المعدود ناقص النقد المتوقع. |
| متوازنة / زيادة / عجز | `pos:shift.outcome_balanced` / `_over` / `_short` · Balanced / Over / Short | نتيجة الإغلاق: الفرق ضمن المقبول / النقد أكثر / النقد أقل. |
| الفرق المقبول (د.ك) | `manager:cash.tolerance` · Accepted difference (KWD) | الفرق الذي تُعد الوردية ضمنه متوازنة. |
| إيداع نقدي / سحب نقدي | `pos:shift.cashIn` / `pos:shift.cashOut` · Cash in / Cash out | تسجيل نقد يدخل الدرج / يخرج منه مع سبب. |
| الحركات النقدية | `pos:shift.movements` · Cash movements | كل إيداع وسحب نقدي في الوردية. |
| سحب إلى الخزينة | `pos:shift.reason_safe_drop` · Drop to treasury | نقل نقد من الدرج إلى خزينة الفرع. |
| تعزيز من الخزينة | `pos:shift.reason_float_top_up` · Top-up from treasury | نقل نقد من خزينة الفرع إلى الدرج. |
| تبديل فكّة (لا يغيّر المبلغ) | `pos:shift.reason_change_received` · Change swap (amount unchanged) | تبديل فئات النقد دون تغيير الرصيد. |
| تصحيح | `pos:shift.reason_correction` · Correction | حركة لتصحيح خطأ نقدي سابق. |
| مصروف نثري | `pos:shift.reason_petty_expense` · Petty expense | مصروف صغير يُدفع من الدرج مع تصنيفه. |
| دفعة لمورد | `pos:shift.reason_supplier_payment` · Supplier payment | دفع نقدي لمورد من الدرج أو الخزينة. |
| إيداع بنكي | `pos:shift.reason_bank_deposit`، `manager:cashCustody.deposit` · Bank deposit / Deposit to bank | إخراج النقد من الدرج أو الخزينة إلى حساب بنكي للشركة. |
| الخزينة | `manager:cashCustody.treasury` · Treasury | مكان النقد الخاص بكل فرع خارج الأدراج. |
| إدارة النقدية | `manager:nav.cash` · Cash custody | شاشة أرصدة الخزائن والأدراج وتحويلاتها. |
| إجمالي النقد | `manager:dashboard.totalCash` · Total cash on hand | الخزائن + الأدراج + ما هو قيد النقل. |
| جرد | `manager:cashCustody.count` · Count | عدّ النقد فعليًا ومقارنته بالرصيد في النظام. |
| لم تُجرد بعد | `manager:cashCustody.notCounted` · Not yet counted | خزينة أو صندوق لم يُسجَّل له جرد افتتاحي. |
| كشف | `manager:cashCustody.statement` · Statement | كل الحركات على خزينة أو صندوق مع الرصيد. |
| تحويل نقدي | `manager:cashCustody.transfer` · Transfer cash | نقل نقد بين صندوق وخزينة فرعه. |
| تحويل لفرع آخر | `manager:cashCustody.sendToBranch` · Send to branch | إرسال نقد من خزينة فرع إلى خزينة فرع آخر. |
| قيد النقل | `manager:cashCustody.inTransit` · In transit | نقد خرج من الفرع المرسِل ولم يؤكد الفرع المستلم استلامه. |
| تأكيد الاستلام | `manager:cashCustody.receive` · Confirm receipt | الفرع المستلم يسجل المبلغ الذي وصل فعلًا. |
| صرف مصروف / دفعة مورد | `manager:cashCustody.pay` · Pay expense / supplier | صرف من خزينة الفرع. |
| مصروف | `manager:cashCustody.kind_expense` · Expense | صرف نقدي حقيقي له تصنيف. |
| عكس | `manager:cashCustody.reverse` · Reverse | تصحيح صرف خاطئ بسجل جديد يعيد المبلغ؛ الأصل لا يُحذف. |
| إغلاق الوردية بواسطة المدير | `manager:cash.forceCloseTitle` · Close this shift as manager | إغلاق وردية كاشير من الإدارة مع ذكر السبب. |
| إغلاق إجباري بدون جرد | `manager:cash.forcedUncounted` · forced, not counted | إغلاق من المدير دون عدّ؛ لا يُسجَّل فرق ويجب جرد الصندوق لاحقًا. |
| فروقات النقد | `manager:cash.tabDiscrepancies` · Cash discrepancies | تقرير الزيادة والعجز حسب الموظف والصندوق. |
| بين الورديات | `manager:cash.betweenShifts` · Between shifts | فرق ظهر عند فتح الوردية التالية، لا يُحمَّل على من فتحها. |

## 6. المخزون والتحويلات والمشتريات

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المخزون | `manager:inventory.title` · Inventory | الكميات المتوفرة في كل فرع. |
| المتوفر | `manager:inventory.onHand` · On hand | الكمية الحالية للصنف في الفرع. |
| حد التنبيه | `manager:inventory.setThreshold` · Set alert | الكمية التي يُعتبر الصنف عندها منخفضًا. |
| مخزون منخفض / نفد المخزون / سالب | `manager:inventory.low` / `manager:inventory.out` / `manager:inventory.status_negative` · Low stock / Out of stock / Negative | حالة رصيد الصنف. |
| أصناف متتبَّعة | `manager:inventory.tracked` · Tracked items | أصناف يُسجَّل لها مخزون (الخدمات لا). |
| تعديل جديد | `manager:inventory.newAdjustment` · New adjustment | مستند يغيّر الكميات يدويًا بسبب محدد. |
| رصيد افتتاحي / زيادة / نقص / جرد | `manager:inventory.kind_opening` / `kind_increase` / `kind_decrease` / `kind_count` · Opening stock / Increase / Decrease / Stock count | أنواع تعديل المخزون. |
| ترحيل التعديل | `manager:inventory.submit` · Post adjustment | حفظ التعديل نهائيًا؛ لا يمكن تعديله أو حذفه بعد ذلك. |
| سجل الحركات | `manager:inventory.tabMovements` · Movement history | كل حركة دخلت أو خرجت من المخزون. |
| متوسط التكلفة | `manager:inventory.avgCost` · Average cost | تكلفة الوحدة بالمتوسط المرجّح. |
| قيمة المخزون | `manager:inventory.value` · Stock value | الكمية × متوسط التكلفة. |
| تحويلات المخزون | `manager:transfers.title` · Stock transfers | نقل بضاعة من فرع إلى فرع. |
| مطلوب / معتمد / في الطريق / مستلم | `manager:transfers.status_*` · Requested / Approved / In transit / Received | مراحل تحويل المخزون. |
| إرسال / استلام | `manager:transfers.dispatch` / `manager:transfers.receive` · Dispatch / Receive | خروج البضاعة من المصدر / وصولها إلى الوجهة. |
| الناقص | `manager:transfers.missing` · Missing | ما أُرسل ولم يصل. |
| الموردون | `manager:purchasing.suppliersTitle` · Suppliers | الجهات التي تشتري منها الشركة. |
| أوامر الشراء | `manager:purchasing.ordersTitle` · Purchase orders | طلبات الشراء من الموردين. |
| مسودة | `manager:purchasing.status_draft` · Draft | أمر شراء لم يُرسل بعد ويمكن تعديله. |
| إرسال للاعتماد | `manager:purchasing.submit` · Submit for approval | إرسال أمر الشراء لمن يعتمده. |
| مستلم جزئيًا | `manager:purchasing.status_partially_received` · Partly received | وصل جزء من الكميات المطلوبة. |
| استلام شحنة | `manager:purchasing.receive` · Receive delivery | إدخال البضاعة الواصلة إلى المخزون. |
| إغلاق المتبقي | `manager:purchasing.close` · Close remaining | إنهاء أمر شراء لن يصل باقيه، مع السبب. |

## 7. المنتجات والعملاء

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المنتجات | `manager:nav.products` · Products | تعريفات ما تبيعه الشركة وأسعاره. |
| التصنيف | `manager:catalog.category` · Category | مجموعة لترتيب المنتجات في نقطة البيع والتقارير. |
| الأنواع | `manager:catalog.variants` · Variants | مقاسات أو ألوان للمنتج الواحد، لكل منها سعر ومخزون. |
| رمز SKU | `manager:catalog.sku` · SKU | رمز داخلي فريد للصنف. |
| الباركود | `manager:catalog.barcodes` · Barcodes | الرمز الذي يُمسح عند البيع. |
| سعر البيع / التكلفة | `manager:catalog.price` / `manager:catalog.cost` · Price / Cost | سعر بيع الصنف / تكلفة شرائه (لا يراها الكاشير). |
| سلعة / خدمة (بدون مخزون) | `manager:catalog.typeStandard` / `manager:catalog.typeService` · Goods / Service (no stock) | نوع المنتج. |
| أرشفة / مؤرشف / استعادة | `manager:catalog.archive` / `archived` / `restore` · Archive / Archived / Restore | إخفاء منتج من البيع دون حذفه / إعادته. |
| التوفر في الفروع | `manager:catalog.availability` · Branch availability | الفروع التي يُباع فيها المنتج. |
| العملاء | `manager:customers.title` · Customers | ملفات العملاء ومشترياتهم. |
| الملاحظات | `manager:customers.notes` · Notes | ملاحظات على العميل؛ لا تُعدَّل ولا تُحذف. |
| صافي الإنفاق | `manager:customers.netSpend` · Net spend | إجمالي مشتريات العميل ناقص ما استرده. |

## 8. المطعم

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| الطاولات | `pos:restaurant.tables` · Tables | شاشة طاولات الفرع وطلباتها في نقطة البيع. |
| صالة / سفري / استلام | `pos:restaurant.type_dine_in` / `type_takeaway` / `type_pickup` · Dine-in / Takeaway / Pickup | نوع طلب المطعم. |
| بيع سريع | `pos:restaurant.retailSale` · Quick sale | الانتقال إلى شاشة البيع العادية. |
| إرسال للمطبخ | `pos:restaurant.sendToKitchen` · Send to kitchen | إرسال الأصناف إلى شاشة المطبخ. |
| ملاحظة للمطبخ | `pos:restaurant.note` · Kitchen note | ملاحظة تظهر للمطبخ مع الصنف. |
| نقل الطاولة / دمج | `pos:restaurant.moveTable` / `pos:restaurant.combine` · Move table / Combine | نقل الطلب لطاولة أخرى / ضم طلب آخر إليه؛ لا يغيّر المبالغ. |
| دفع الفاتورة | `pos:restaurant.payBill` · Pay bill | دفع أصناف مختارة من الطلب؛ يمكن تقسيم الطلب على عدة فواتير. |
| إلغاء الصنف | `pos:restaurant.cancelItem` · Cancel item | إلغاء صنف من الطلب؛ بعد الإرسال للمطبخ يحتاج صلاحية وسببًا. |
| الإضافات | `manager:restaurant.tabModifiers` · Modifiers | خيارات تظهر عند طلب الصنف (الحجم، درجة الطهي…). |
| الوصفة | `manager:restaurant.recipe` · Recipe | المكونات التي تُخصم من المخزون لكل صنف مباع. |
| محطات المطبخ | `manager:restaurant.stations` · Kitchen stations | أقسام المطبخ التي تُوجَّه إليها الأصناف. |
| المطبخ | `pos:kitchen.title` · Kitchen | شاشة المطبخ: جديد، قيد التحضير، جاهز. |

## 9. الإدارة المالية والتقارير والاشتراك

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| سياسة البيع | `manager:sales.policy` · Selling policy | حد الخصم ومهلة الإرجاع وحد اعتماد الاسترجاع. |
| أكبر خصم بدون مشرف (%) | `manager:sales.maxDiscount` · Largest discount without a supervisor (%) | الحد الأعلى للخصم لمن لا يملك صلاحية تجاوزه. |
| القناة | `manager:sales.channel` · Channel | مصدر البيع: «نقطة البيع» أو «إلكتروني». |
| طرق الدفع | `manager:nav.payments` · Payment methods | نقدًا، بطاقة، تحويل بنكي، وغيرها، مع رسومها. |
| الحسابات المالية | `manager:nav.accounts` · Financial accounts | الخزائن والحسابات البنكية التي تستقر فيها المدفوعات. |
| رسوم المعالجة | `manager:cash.feeType`، `manager:sales.fees` · Processing fee(s) | رسوم تُحسب على كل دفعة حسب طريقة الدفع. |
| بوابة الدفع | `manager:cash.gateway` · Payment gateway | مزوّد الدفع الإلكتروني؛ المتاح حاليًا «تجريبية (مدفوعات اختبار فقط)». |
| المتجر الإلكتروني | `manager:online.title` · Online store | بيع المنتجات عبر الإنترنت. |
| مسودة (مخفي) / منشور / موقوف مؤقتًا (تصفح فقط) | `manager:online.store_*` · Draft (hidden) / Published / Paused (browse only) | حالة المتجر الإلكتروني. |
| فرع التجهيز | `manager:online.branch` · Fulfilment branch | الفرع الذي يجهّز الطلبات الإلكترونية ويُخصم من مخزونه. |
| يحتاج مراجعة | `manager:online.status_needs_attention` · Needs attention | طلب مدفوع تعذّر تجهيزه تلقائيًا. |
| صافي المبيعات | `manager:reports.netSales` · Net sales | إجمالي المبيعات ناقص الخصومات. |
| الصافي بعد المرتجعات | `manager:reports.netAfterRefunds` · Net after refunds | صافي المبيعات ناقص مرتجعات الفترة. |
| إجمالي الربح | `manager:reports.grossProfit` · Gross profit | الصافي بعد المرتجعات ناقص تكلفة البضاعة. |
| المحصّل | `manager:reports.collected` · Collected | المبالغ المستلمة فعلًا عن المبيعات. |
| صافي النقد | `manager:reports.netCash` · Net cash | المبيعات النقدية − المرتجعات النقدية + الإيداع − السحب. |
| تصدير CSV | `manager:reports.exportCsv` · Export CSV | تنزيل جدول التقرير لفتحه في برنامج جداول. |
| الاشتراك / الباقة الحالية | `manager:subscription.title` / `manager:subscription.current` · Subscription / Current plan | باقة الشركة وحدودها؛ يغيّرها فريق المنصة فقط. |

---

## 10. مصطلحات وردت في طلب التأسيس ولم توجد بنصها في الواجهة

| المصطلح المقترح | ما وُجد في الواجهة فعلًا | القرار في الدليل |
|---|---|---|
| تعليق البيع | الزر «تعليق»، والرسالة «تم تعليق عملية البيع»، والقائمة «المبيعات المعلّقة» | نكتب «تعليق» للزر و«عملية البيع المعلّقة» للنتيجة. |
| درج النقد | «الدرج»، «درج الصندوق»، «النقد المتوقع في الدرج» | نستخدم «الدرج». |
| تجاوز | لا يوجد مصطلح مستقل؛ يرد فقط في «خصومات تتجاوز الحد» (اسم صلاحية) وفي رسالة «هذا الخصم يتجاوز الحد المسموح لك. اطلب مشرفًا.» | لا نستخدم «تجاوز» كمصطلح؛ نصف الحالة بنص الرسالة. |
| إقفال الشهر | غير موجود: لا شاشة ولا نص ولا ميزة | لا يدخل الدليل. |
| وردية، مرتجع، خزينة | موجودة كما هي («الوردية»، «المرتجعات»، «الخزينة») | معتمدة (انظر الجداول أعلاه). |

---

## 11. تناقضات في الواجهة نفسها (للقرار والتوحيد)

المفهوم نفسه مكتوب بأكثر من صيغة. لا يُصحَّح شيء في الكود في هذه المرحلة؛ هذه القائمة للقرار.
عمود «الصيغة المقترحة للدليل» هو ما سيستخدمه الكاتب مؤقتًا إلى أن يصدر قرار، مع ذكر النص كما يظهر
في الشاشة عند الإشارة إلى زر أو عنوان بعينه.

| # | المفهوم | الصيغ الموجودة (المفتاح) | الصيغة المقترحة للدليل |
|---|---|---|---|
| ت-1 | Refund (الاسترجاع) | «استرجاع» (`pos:returns.refund`)، «المرتجعات» (`manager:reports.refunds`)، «استرداد» و«المسترد» و«رقم الاسترداد» (`manager:customers.refundCount_*`، `customers.refunded`، `customers.refundNumber`) مقابل «المسترجع» و«رقم الاسترجاع» (`manager:sales.refunded`، `refunds.number`) | «استرجاع» للعملية، و«المرتجعات» للشاشة. |
| ت-2 | رصيد الاستبدال | «رصيد المرتجع» (`pos:returns.credit`)، «رصيد الاستبدال» (`manager:refunds.credit`)، «رصيد استبدال» (`manager:reports.exchangeCredit`) | «رصيد الاستبدال». |
| ت-3 | إلغاء عملية البيع (void) | «إلغاء البيع» (`pos:returns.void`)، «إلغاء بيع» (`pos:returns.kind_void`، `manager:refunds.kind_void`)، «فاتورة ملغاة» (`manager:reports.move_sale_void`)، «مبيعات ملغاة» (`manager:refunds.voids`)، «إلغاء المبيعات» (صلاحية `sales.void`) | «إلغاء البيع». |
| ت-4 | عنوان شاشة المرتجعات | القائمة «المرتجعات» (`manager:nav.refunds`)، عنوان الصفحة «المرتجعات والاسترجاع» (`manager:refunds.title`)، وفي نقطة البيع «المرتجعات والاستبدال» (`pos:returns.title`) | نذكر اسم القائمة «المرتجعات». |
| ت-5 | تعديل المخزون | «تعديل» و«تعديلات المخزون» (`manager:inventory.*`) مقابل «تسوية» و«تسويات المخزون» (`manager:reports.move_adjustment`، `reports.adjustments`) | «تعديل». |
| ت-6 | Category | «التصنيف»/«التصنيفات» (`manager:catalog.*`، `nav.categories`) مقابل «الفئة»/«الفئات»/«بدون فئة» (`manager:reports.category`، `reports.uncategorized`، `restaurant.routedCategories`، `restaurant.stationsHint`) | «التصنيف». |
| ت-7 | المخزون المتتبَّع | «متتبَّعة» (`manager:inventory.tracked`، `common:errors.NOT_STOCK_TRACKED`) مقابل «المتابعة»/«متابع» (`manager:reports.trackedItems`، `restaurant.noStock`، `restaurant.recipeTracked`) | «متتبَّع». |
| ت-8 | Out of stock | «نفد» (`pos:sale.outOfStock`، `manager:inventory.status_out`) مقابل «نافد» (`manager:reports.stock_out`) | «نفد». |
| ت-9 | Cancelled | «ملغى» (`pos:restaurant.status_cancelled`، `manager:transfers.status_cancelled`، `purchasing.status_cancelled`) مقابل «ملغي» (`manager:online.status_cancelled`، `subscription.status_cancelled`) — اختلاف في الرسم | «ملغى». |
| ت-10 | خطة الاشتراك | «الباقة»/«باقتك» (`manager:subscription.*`) مقابل «خطة الاشتراك»/«الخطة» (`common:errors.PLAN_LIMIT_REACHED`، `PLAN_FEATURE_UNAVAILABLE`، `PLAN_CHANGE_BLOCKED`) | «الباقة»، مع نقل نص الرسالة كما هو. |
| ت-11 | الشركة | «الشركة» (أغلب النصوص)، «المنشأة» (`manager:nav.sectionOrganization`)، «التاجر» (`common:errors.PLAN_CHANGE_BLOCKED`) | «الشركة». |
| ت-12 | الفرق المقبول للصندوق | «الفرق المقبول (د.ك)» (`manager:cash.tolerance`) مقابل «هامش الصندوق» (`manager:reports.def_discrepancy`) | «الفرق المقبول». |
| ت-13 | النقد المتوقع | «النقد المتوقع في الدرج» (`pos:shift.expected`) مقابل «المتوقع في الصندوق» (`pos:shift.expectedInDrawer`) و«الرصيد في النظام» (`manager:cashCustody.expected`) | «النقد المتوقع في الدرج». |
| ت-14 | النقد المعدود | «النقد المعدود (د.ك)» (`pos:shift.counted`) مقابل «المبلغ المعدود (د.ك)» (`manager:cashCustody.countedCash`) | «النقد المعدود». |
| ت-15 | النقد الافتتاحي | «النقد الافتتاحي» (`pos:shift.openingCash`، `manager:cash.openingFloat`) مقابل «نقد الافتتاح» (`manager:reports.openingFloat`) | «النقد الافتتاحي». |
| ت-16 | نتيجة الإغلاق | «متوازنة» (`pos:shift.outcome_balanced`، `manager:cash.outcome_balanced`) مقابل «متوازن» (`manager:reports.balanced`) | «متوازنة». |
| ت-17 | Cash in / Cash out مقابل الإيداع البنكي والسحب إلى الخزينة | «إيداع نقدي» (إدخال نقد إلى الدرج) و«إيداع بنكي» (إخراج نقد إلى البنك) يشتركان في كلمة «إيداع» بمعنيين متعاكسين؛ و«سحب نقدي» (أي إخراج من الدرج) و«سحب إلى الخزينة» (نوع من السحب) | ليس تكرارًا لفظيًا بل لبس في المعنى: يُشرح صراحة في القسمين 09 و26. |
| ت-18 | كلمة «التحويلات» | القائمة «التحويلات» (`manager:nav.transfers`) = تحويلات المخزون، وتبويب «التحويلات» (`manager:cashCustody.tabTransfers`) = تحويلات النقد، و«تحويل بنكي» = طريقة دفع | نكتب دائمًا «تحويلات المخزون» أو «تحويل نقدي» بحسب المقصود. |
| ت-19 | «زيادة» | نتيجة إغلاق الوردية (`pos:shift.outcome_over`) ونوع تعديل مخزون (`manager:inventory.kind_increase`) | ليس تناقضًا؛ ينبَّه إليه في القسمين 07 و16. |
| ت-20 | «الباقي» | «الباقي للعميل» و«الباقي» = Change (`pos:sale.change`، `manager:sales.change`)، و«ادفع الباقي» = الجزء غير المدفوع (`pos:restaurant.splitHint`)، و«المتبقي» = Remaining (`pos:sale.remaining`) | «الباقي للعميل» للنقد المُعاد، و«المتبقي» لما لم يُدفع. |
| ت-21 | المرسَل | «المرسل» (`manager:reports.dispatched`) مقابل «المُرسل» (`manager:transfers.dispatched`) — تشكيل فقط | «المُرسل». |
| ت-22 | الشحنات | «الشحنات» (`manager:purchasing.receipts`) مقابل «دفعات استلام» (`manager:reports.receiptsWord`) | «الشحنات». |
| ت-23 | حد التنبيه | «حد التنبيه» (`manager:inventory.setThreshold`، `manager:reports.threshold`) مقابل «تنبيه عند» (`manager:inventory.threshold`، عنوان عمود) | «حد التنبيه». |
