# قاموس المصطلحات المعتمدة في الدليل

كل مصطلح هنا منسوخ **حرفيًا** من نصوص الواجهة العربية. لا يستخدم الدليل مرادفًا من عنده.

- **العمود الأول:** المصطلح كما يظهر في الواجهة العربية.
- **العمود الثاني:** المقابل في الكود: مفتاح الترجمة (أو مفتاح الصلاحية / القالب) ثم النص
  الإنجليزي كما يظهر في الواجهة الإنجليزية.
- **العمود الثالث:** تعريف من سطر واحد للموظف.

بادئات المفاتيح: `common:` النصوص المشتركة (`packages/i18n/src/locales/ar.ts`)، `pos:` نقطة
البيع (`apps/pos-web/src/i18n/ar.ts`)، `manager:` الإدارة (`apps/manager-web/src/i18n/ar.ts`).
ملاحظة: كل نصوص الواجهة تأتي من هذه الملفات الثلاثة فقط؛ لم يُعثر على نص عربي مكتوب مباشرة
داخل الشاشات (عدا اسمي اللغتين «العربية» و«English»). الاستثناء: «سجل التدقيق» يعرض أسماء
الإجراءات وتفاصيلها كما خزّنها النظام بالإنجليزية (انظر ق-7 في `README.md`).

آخر تحديث: 2026-10-13، على الالتزام `4a4c4db`. الصفوف الجديدة في هذا التحديث معلّمة بـ ★.

---

## 1. الواجهات والدخول والحساب

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
| ★ تسجيل الدخول / تسجيل الخروج | `common:actions.signIn` / `common:actions.signOut` · Sign in / Sign out | بدء الجلسة بالبريد وكلمة المرور / إنهاؤها؛ الخروج لا يغلق الوردية. |
| ★ الانتقال إلى {{app}} | `common:auth.switchTo` · Go to {{app}} | زر في أعلى الإدارة للانتقال إلى نقطة البيع لمن يملك صلاحيتها. |
| ★ إعادة تعيين كلمة المرور / إرسال الرابط | `common:auth.forgotTitle` / `common:auth.forgotSend` · Reset your password / Send link | شاشة طلب رابط كلمة مرور جديدة بالبريد؛ الرابط صالح 30 دقيقة. |
| ★ انضم إلى فريقك | `common:invite.title` · Join your team | شاشة قبول الدعوة؛ الدعوة صالحة 7 أيام. |
| ★ اللغة | `common:language.label` · Language | اختيار «العربية» أو «English» للواجهة. |
| ★ الخادم متصل / تعذّر الوصول إلى الخادم | `common:status.apiOnline` / `common:status.apiOffline` · Server online / Server unreachable | حالة الاتصال الظاهرة في شاشات الدخول. |
| ★ يوجد تحديث جديد للنظام… / تحديث الآن | `pos:update.available` / `pos:update.reload` · A new version… / Update now | شريط في نقطة البيع: أكمل البيع الحالي ثم حدّث. |
| ★ حسابي | `manager:nav.account`، `manager:account.title` · My account | صفحة المستخدم نفسه في الإدارة: كلمة المرور والأجهزة. |
| ★ تغيير كلمة المرور | `manager:account.changePassword` · Change password | تغيير كلمة مرورك بإدخال الحالية؛ يُنهي جلساتك الأخرى ويبقى هذا الجهاز. |
| ★ كلمة المرور الحالية | `manager:account.currentPassword` · Current password | كلمة مرورك الآن، مطلوبة لتغييرها. |
| ★ الأجهزة المسجَّل دخولها | `manager:account.sessions` · Signed-in devices | كل جلسة حية لحسابك في كل شركة وتطبيق. |
| ★ هذا الجهاز | `manager:account.thisDevice` · This device | الجلسة التي تستخدمها الآن. |
| ★ تسجيل الخروج من كل مكان آخر | `manager:account.endOthers` · Sign out everywhere else | إنهاء كل جلساتك ما عدا هذا الجهاز. |

## 2. الأشخاص والأدوار

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المالك | `manager:employees.owner` · Owner (`is_owner`) | صاحب حساب الشركة؛ يملك كل الصلاحيات ولا يمكن إيقافه. |
| مدير الشركة | قالب `company_manager` · Company Manager | دور إداري لكل الفروع بدون نقطة البيع افتراضيًا. |
| مدير الفرع | قالب `branch_manager` · Branch Manager | دور إداري لفرع واحد بدون نقطة البيع افتراضيًا. |
| مشرف | قالب `supervisor` · Supervisor | دور في نقطة البيع بصلاحيات أوسع من الكاشير (إلغاء البيع، الخصم فوق الحد، تعديل السعر، البيع المجاني، الحركات النقدية)، ويعتمد هذه الاستثناءات على جهاز الكاشير. |
| كاشير | قالب `cashier` · Cashier؛ `pos:sale.cashier` | الموظف الذي يبيع في نقطة البيع. |
| ★ أمين الخزينة | قالب `treasurer` · Treasurer | دور في الإدارة لعهدة النقد: الجرد والتحويل والإيداع البنكي والتقارير المالية، بلا بيع. |
| طاقم المطبخ | قالب `kitchen` · Kitchen staff | دور يستخدم شاشة المطبخ فقط. |
| الدور | `manager:employees.role` · Role | مجموعة صلاحيات تُسند للموظف في فرع أو في كل الفروع. |
| الصلاحيات | `manager:roles.permissions` · Permissions | ما يُسمح للموظف بعمله؛ يفرضها الخادم مهما ظهر في الشاشة. |
| افتراضي / مخصص | `manager:roles.template` / `manager:roles.custom` · Default / Custom | دور جاء مع النظام / دور أنشأته الشركة. |
| دعوة موظف | `manager:employees.invite` · Invite employee | إرسال رابط بالبريد لينضم الموظف ويختار كلمة مروره. |
| مدعو | `manager:common.invited` · Invited | موظف أُرسلت له دعوة ولم يقبلها بعد. |
| دعوات معلّقة | `manager:employees.tabInvitations` · Pending invitations | الدعوات التي لم تُقبل بعد. |
| إيقاف / تفعيل | `manager:common.deactivate` / `manager:common.activate` · Deactivate / Activate | منع موظف أو فرع من العمل / إعادته؛ الإيقاف يخرجه من كل الأجهزة فورًا. |
| ★ إنهاء كل الجلسات | `manager:employees.endSessions` · End all sessions | إخراج موظف من كل أجهزته دون إيقافه. |
| ★ فك قفل تسجيل الدخول | `manager:employees.unlock` · Clear sign-in lock | إعادة السماح بالدخول لموظف أُوقف دخوله بعد كلمات مرور خاطئة. |
| ★ أدوار خاملة | `manager:branches.dormantTitle` · dormant roles | أدوار بقيت في فرع موقوف؛ عند إعادة تفعيله تختار إبقاءها أو إلغاءها. |
| ★ الملكية | `manager:company.ownership` · Ownership | قسم في «الإعدادات» يراه المالك فقط لنقل ملكية الشركة. |
| ★ نقل الملكية | `manager:company.startTransfer` · Transfer ownership | بدء نقل الملكية إلى عضو آخر بعد إعادة كتابة كلمة مرورك. |
| ★ المالك الجديد | `manager:company.newOwner` · New owner | العضو الذي تُرشّحه للملكية. |
| ★ رمز التأكيد | `manager:company.transferCode` · Confirmation code | الرمز الذي يصل المرشَّح بالبريد ليقبل الملكية. |
| ★ قبول الملكية | `manager:company.acceptOwnership` · Accept ownership | خطوة المرشَّح الأخيرة؛ بعدها يصبح المالك ويصبح المالك السابق عضوًا عاديًا. |
| ★ إلغاء النقل | `manager:company.cancelTransfer` · Cancel transfer | إلغاء نقل لم يقبله المرشَّح بعد. |

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
| السعر الجديد (د.ك) | `pos:sale.priceOverride` · New price (KWD) | تعديل سعر صنف في عملية البيع؛ يحتاج صلاحية «تعديل الأسعار» أو موافقة مشرف. |
| ★ سبب تعديل السعر | `pos:sale.priceReason` · Reason for the price change | سبب إلزامي عند تغيير سعر الصنف. |
| ★ سعر القائمة | `pos:sale.listPrice` · List price | السعر الأصلي للصنف قبل التعديل. |
| تم تعديل السعر | `pos:sale.overridden` · Price changed | علامة على صنف بيع بسعر غير سعره الأصلي. |
| ★ يتجاوز صلاحياتك: يجب أن يعتمده مشرف عند الدفع. | `pos:sale.needsSupervisor` | تنبيه في نافذة تعديل السطر عندما يحتاج التعديل موافقة مشرف. |
| ★ مطلوب موافقة مشرف | `pos:sale.supervisorTitle` · Supervisor approval needed | قسم داخل نافذة «الدفع» يُدخل فيه المشرف بريده وكلمة مروره على جهاز الكاشير. |
| ★ بريد المشرف / كلمة مرور المشرف | `pos:sale.supervisorEmail` / `supervisorPassword` · Supervisor e-mail / password | بيانات دخول المشرف نفسه؛ لا يعتمد أحد لنفسه. |
| ★ اعتماد | `pos:sale.authorise` · Authorise | زر المشرف لمنح الموافقة لمرة واحدة على هذه العملية. |
| ★ اعتمدها {{name}}. | `pos:sale.authorisedBy` · Authorised by {{name}}. | تأكيد أن الموافقة صدرت؛ تبقى العملية على وردية الكاشير. |
| ★ خصم يتجاوز الحد / تعديل سعر / بيع مجاني | `pos:sale.right_*` · Discount above limit / Price change / Free sale | ما يُطلب له موافقة المشرف (يُذكر تحت عنوان «مطلوب موافقة مشرف»). |
| ★ سبب البيع المجاني | `pos:sale.zeroTotalReason` · Reason for the free sale | سبب إلزامي لعملية بيع بدون مبلغ؛ تظهر في «المبيعات غير الاعتيادية». |
| الدفع | `pos:sale.pay` · Pay | فتح نافذة الدفع. |
| إضافة دفعة | `pos:sale.addPayment` · Add payment | الدفع بأكثر من طريقة في نفس عملية البيع. |
| النقد المستلم (د.ك) | `pos:sale.tendered` · Cash received (KWD) | المبلغ النقدي الذي سلّمه العميل. |
| المبلغ بالضبط | `pos:sale.exact` · Exact | العميل دفع المبلغ المطلوب بلا باقٍ. |
| ★ المرجع (جهاز الدفع / التحويل) | `pos:sale.referenceRequired` · Reference (terminal / transfer) | رقم من جهاز البطاقة أو التحويل، إلزامي عند تفعيل ذلك في «سياسة البيع». |
| المتبقي | `pos:sale.remaining` · Remaining | ما بقي من الإجمالي دون دفع. |
| الباقي للعميل | `pos:sale.change` · Change | النقد الذي يُعاد للعميل عند دفعه أكثر من المطلوب. |
| إتمام البيع | `pos:sale.complete` · Complete sale | تسجيل عملية البيع نهائيًا وخصم المخزون. |
| الإيصال / رقم الإيصال | `pos:sale.receipt` / `pos:sale.receiptNo` · Receipt / Receipt no. | المستند المطبوع للعميل ورقمه الذي يُستخدم في المرتجع. |
| طباعة الإيصال | `pos:sale.print` · Print receipt | طباعة الإيصال. |
| ★ طباعة نسخة / نسخة {{count}} | `pos:sale.printCopy` / `pos:sale.copyNumber` · Print copy / Copy {{count}} | كل طباعة بعد الأولى نسخة مرقّمة ومسجّلة. |
| عملية بيع جديدة | `pos:sale.newSale` · New sale | بدء عملية بيع فارغة بعد الإتمام. |
| مسح | `pos:sale.clear` · Clear | تفريغ عملية البيع الحالية (يحتاج ضغطة «تأكيد المسح»)؛ المسح فوق مبلغ تحدده الشركة يُسجَّل. |
| تعليق | `pos:sale.suspend` · Hold | حفظ عملية البيع جانبًا لإكمالها لاحقًا؛ لا تحجز مخزونًا، وتُحذف بعد المدة التي تحددها الشركة. |
| المبيعات المعلّقة | `pos:sale.heldSales` · Held sales | قائمة عمليات البيع المعلّقة في الفرع. |
| استئناف | `pos:sale.resume` · Resume | إعادة عملية بيع معلّقة إلى السلة. |
| حذف | `pos:sale.discard` · Discard | حذف عملية بيع معلّقة نهائيًا. |
| آخر المبيعات | `pos:sale.recent` · Recent sales | مبيعات الوردية الحالية، والبحث عن أي إيصال في الفرع برقمه، ومنها إعادة الطباعة. |
| العميل | `pos:customer.label` · Customer | العميل المسجّل المرتبط بعملية البيع. |
| عميل عابر | `pos:customer.walkIn` · Walk-in | بيع بدون عميل مسجّل. |
| عميل جديد | `pos:customer.new` · New customer | إنشاء ملف عميل بسيط (الاسم والهاتف). |

## 4. المرتجعات والاسترجاع

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| المرتجعات | `pos:returns.open`، `manager:nav.refunds` · Returns | شاشة إرجاع الأصناف المباعة. |
| استرجاع | `pos:returns.refund` · Refund | إرجاع أصناف وإعادة قيمتها للعميل. |
| استبدال | `pos:returns.exchange` · Exchange | إرجاع أصناف وأخذ أصناف جديدة في نفس العملية. |
| إلغاء البيع | `pos:returns.void` · Cancel sale | إلغاء عملية بيع كاملة من ورديتك المفتوحة وبدون مرتجعات؛ يعود المبلغ والمخزون كاملين. |
| إعادة للمخزون | `pos:returns.restock` · Back to stock | إرجاع الصنف إلى المخزون (لا يُختار للتالف). |
| يُعاد إلى | `pos:returns.payBack` · Pay back | طريقة الدفع التي يعود إليها مبلغ الاسترجاع. |
| رصيد المرتجع | `pos:returns.credit` · Return credit | قيمة الأصناف المرتجعة التي تُحتسب في الاستبدال (الصيغة المعتمدة: «رصيد الاستبدال» — ت-2). |
| مهلة الإرجاع (أيام) | `manager:sales.refundWindow` · Return window (days) | المدة التي يُقبل فيها الإرجاع بدون اعتماد. |
| حد اعتماد الاسترجاع (د.ك) | `manager:sales.refundLimit` · Refund approval limit (KWD) | الاسترجاع فوق هذا المبلغ يحتاج اعتمادًا. |
| ★ استرجاع المبيعات الخاصة يحتاج شخصًا ثانيًا | `manager:sales.ownSaleApproval` · Own-sale refunds need a second person | إعداد: استرجاع عملية سجّلها الطالب بنفسه ينتظر الاعتماد مهما كان المبلغ. |
| ★ أنت من سجّل عملية البيع هذه | `pos:returns.approvalReason_own_sale` · You rang up this sale | سبب ظهور «يجب أن يعتمد مشرف هذا الاسترجاع.» للكاشير. |
| ★ هاتف العميل أو اسمه (اختياري) | `pos:returns.customerContact` · Customer phone or name | يُحفظ مع طلب الاسترجاع المعلّق ليراه من يعتمده. |
| بانتظار الاعتماد | `manager:refunds.status_pending_approval` · Waiting for approval | استرجاع سُجّل وينتظر قرار من يملك صلاحية الاعتماد في الإدارة. |
| اعتماد / رفض | `manager:refunds.approve` / `manager:refunds.reject` · Approve / Reject | قرار على استرجاع معلّق. |
| مسحوب | `manager:refunds.status_cancelled` · Withdrawn | طلب استرجاع معلّق تم سحبه. |
| إيصال استرجاع | `pos:returns.receiptTitle` · Refund receipt | المستند المطبوع لعملية الاسترجاع. |
| نشاط غير اعتيادي | `manager:refunds.tabActivity` · Unusual activity | تبويب يميّز الموظفين ذوي نسبة الاسترجاع العالية أو الإرجاع المتأخر. |
| ★ مرتجعات محتجزة | `manager:inventory.tabReturns` · Held returns | أصناف مرتجعة لم تُعَد إلى المخزون القابل للبيع (تالفة، معيبة). |
| ★ محتجز / تمت التصفية | `manager:inventory.returns_held` / `returns_disposed` · Held / Disposed | حالة المرتجع المحتجز قبل تسجيل ما جرى له وبعده. |
| ★ تسجيل التصفية | `manager:inventory.dispose` · Record disposal | تسجيل ما جرى للبضاعة المحتجزة (أُتلفت، أُعيدت للمورد…) مع ملاحظة إلزامية. |

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
| ★ جرد النقد الأعمى | `manager:sales.blindCount` · Blind cash count | إعداد في «سياسة البيع»: الكاشير يعدّ الدرج دون أن يرى المتوقع، ويظهر الفرق بعد العدّ. |
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
| تصحيح | `pos:shift.reason_correction` · Correction | عكس جزء أو كل حركة «أخرى» سابقة في نفس الوردية. |
| مصروف نثري | `pos:shift.reason_petty_expense` · Petty expense | مصروف صغير يُدفع من الدرج مع تصنيفه. |
| دفعة لمورد | `pos:shift.reason_supplier_payment` · Supplier payment | دفع نقدي لمورد من الدرج أو الخزينة. |
| إيداع بنكي | `pos:shift.reason_bank_deposit`، `manager:cashCustody.deposit` · Bank deposit / Deposit to bank | إخراج النقد من الدرج أو الخزينة إلى حساب بنكي للشركة؛ يبقى «في الطريق» حتى يؤكده شخص ثانٍ. |
| ★ رقم قسيمة الإيداع | `pos:shift.depositSlip`، `manager:cashCustody.depositReference` · Deposit slip number | الرقم المطبوع على قسيمة البنك، إلزامي لكل إيداع بنكي. |
| ★ بانتظار الاعتماد / سحب الطلب | `pos:shift.status_pending` / `pos:shift.withdraw` · Waiting for approval / Withdraw request | سحب نقدي فوق الحد ينتظر مديرًا؛ لا يخرج النقد قبل الاعتماد، ويمكن سحب الطلب. |
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
| ★ مدفوعات بانتظار الاعتماد / طلب اعتماد | `manager:cashCustody.awaitingApproval` / `requestApproval` · Payments awaiting approval / Request approval | صرف من الخزينة فوق الحد ينتظر أمين عهدة ثانيًا. |
| مصروف | `manager:cashCustody.kind_expense` · Expense | صرف نقدي حقيقي له تصنيف. |
| عكس | `manager:cashCustody.reverse` · Reverse | تصحيح صرف خاطئ بسجل جديد يعيد المبلغ؛ الأصل لا يُحذف. |
| ★ إيداعات في الطريق | `manager:cashCustody.depositsInTransit` · Deposits in transit | إيداعات بنكية مسجّلة لم يؤكدها شخص ثانٍ من جهة البنك بعد. |
| ★ تأكيد في البنك / إرجاع إلى الخزينة | `manager:cashCustody.confirmDeposit` / `returnDeposit` · Confirm at bank / Return to treasury | قرار على إيداع في الطريق: وصل البنك / عاد النقد إلى الخزينة مع سبب. |
| ★ المطابقة البنكية / مطابقة | `manager:cash.reconciliation` / `manager:cash.reconcile` · Bank reconciliation / Reconcile | تعليم القيود التي ظهرت في كشف البنك وإدخال رصيد الكشف وتفسير أي فرق. |
| إغلاق الوردية بواسطة المدير | `manager:cash.forceCloseTitle` · Close this shift as manager | إغلاق وردية كاشير من الإدارة مع ذكر السبب. |
| إغلاق إجباري بدون جرد | `manager:cash.forcedUncounted` · forced, not counted | إغلاق من المدير دون عدّ؛ لا يُسجَّل فرق ويجب جرد الصندوق لاحقًا. |
| فروقات النقد | `manager:cash.tabDiscrepancies` · Cash discrepancies | تقرير الزيادة والعجز حسب الموظف والصندوق. |
| ★ متابعة الفروقات | `manager:cash.tabVariances` · Variance follow-up | كل فرق نقدي مسجّل وما تقرر بشأنه. |
| ★ مُفسَّر / مُسوَّى / مشطوب | `manager:cash.followup_explained` / `_settled` / `_written_off` · Explained / Settled / Written off | نتيجة متابعة الفرق؛ التسوية والشطب يحتاجان «إدارة النقدية». |
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
| ★ مُرحَّل / بانتظار الاعتماد / مرفوض / مسحوب | `manager:inventory.status_*` · Posted / Waiting for approval / Rejected / Withdrawn | حالة تعديل المخزون؛ فوق حد الشركة بالتكلفة ينتظر شخصًا ثانيًا. |
| ★ اعتماد / رفض (التعديل) | `manager:inventory.decide` · Approve / Reject | قرار شخص ثانٍ يملك «تعديل المخزون» على تعديل معلّق. |
| ★ جرد مخزون أعمى | `manager:sales.blindStockCount` · Blind stock count | العادّ يُدخل ما عدّه دون رؤية الكمية الدفترية؛ يظهر الفرق بعد الترحيل. |
| سجل الحركات | `manager:inventory.tabMovements` · Movement history | كل حركة دخلت أو خرجت من المخزون. |
| متوسط التكلفة | `manager:inventory.avgCost` · Average cost | تكلفة الوحدة بالمتوسط المرجّح. |
| قيمة المخزون | `manager:inventory.value` · Stock value | الكمية × متوسط التكلفة. |
| تحويلات المخزون | `manager:transfers.title` · Stock transfers | نقل بضاعة من فرع إلى فرع. |
| مطلوب / معتمد / في الطريق / مستلم | `manager:transfers.status_*` · Requested / Approved / In transit / Received | مراحل تحويل المخزون. |
| إرسال / استلام | `manager:transfers.dispatch` / `manager:transfers.receive` · Dispatch / Receive | خروج البضاعة من المصدر / وصولها إلى الوجهة. |
| الناقص | `manager:transfers.missing` · Missing | ما أُرسل ولم يصل. |
| ★ خسائر التحويل / تسجيل خسارة | `manager:transfers.losses` / `manager:transfers.claimLoss` · Transfer losses / Record loss | شطب النقص مع تفسير؛ فوق حد الشركة يبتّ فيه معتمد الفرع المصدر. |
| ★ استرجاع (التحويل) / مسترجَع | `manager:transfers.recall` / `status_recalled` · Recall / Recalled | إعادة بضاعة تحويل في الطريق إلى الفرع المصدر (غير «استرجاع» المبيعات — ت-24). |
| الموردون | `manager:purchasing.suppliersTitle` · Suppliers | الجهات التي تشتري منها الشركة. |
| ★ كشف حساب | `manager:purchasing.statement` · Statement | البضاعة المستلمة بتكلفة الطلب مقابل النقد المدفوع للمورد، مع «رصيد مرحَّل». |
| ★ المستلم − المدفوع | `manager:purchasing.balanceOwed` · Received − paid | الرصيد الجاري في كشف حساب المورد؛ الموجب مستحق للمورد. |
| أوامر الشراء | `manager:purchasing.ordersTitle` · Purchase orders | طلبات الشراء من الموردين. |
| مسودة | `manager:purchasing.status_draft` · Draft | أمر شراء لم يُرسل بعد ويمكن تعديله. |
| إرسال للاعتماد | `manager:purchasing.submit` · Submit for approval | إرسال أمر الشراء لمن يعتمده. |
| ★ تاريخ المستند / تاريخ التسليم | `manager:purchasing.documentDate` / `receivedOn` · Document date / Delivery date | اليوم ما لم يُحدد؛ 7 أيام للخلف على الأكثر؛ لا يقع في شهر مقفل. |
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
| ★ سجل الأسعار والتكاليف | `manager:catalog.priceHistory` · Price and cost history | كل تغيير في سعر البيع أو التكلفة: متى، ماذا، من → إلى، بواسطة؛ التكلفة لمن يملك صلاحيتها. |
| سلعة / خدمة (بدون مخزون) | `manager:catalog.typeStandard` / `manager:catalog.typeService` · Goods / Service (no stock) | نوع المنتج. |
| أرشفة / مؤرشف / استعادة | `manager:catalog.archive` / `archived` / `restore` · Archive / Archived / Restore | إخفاء منتج من البيع دون حذفه / إعادته؛ لا يُؤرشف صنف ما زال له رصيد. |
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
| ★ اليوم ({{date}}) | `manager:dashboard.todayTitle` · Today | مؤشرات اليوم في لوحة التحكم لمن يملك «تقارير المبيعات». |
| ★ صافي مبيعات اليوم / استرجاعات اليوم / الصافي بعد الاسترجاعات / ورديات مفتوحة | `manager:dashboard.todaySales_*` / `todayRefunds_*` / `todayNet` / `openShifts` | أرقام اليوم مقارنة بالأمس («أمس: …»)؛ يُقطع اليوم عند منتصف الليل بتوقيت الشركة. |
| ★ الرقابة الداخلية | `manager:dashboard.controlsTitle` · Internal controls | تنبيهات في لوحة التحكم بما ينتظر الاعتماد أو المتابعة، أو «لا توجد تنبيهات رقابية.» |
| سياسة البيع | `manager:sales.policy` · Selling policy | حد الخصم ومهلة الإرجاع وحدود الاعتماد والعدّ الأعمى وحدود تعديل السعر وإعدادات أخرى. |
| أكبر خصم بدون مشرف (%) | `manager:sales.maxDiscount` · Largest discount without a supervisor (%) | الحد الأعلى للخصم لمن لا يملك صلاحية تجاوزه؛ يُحسب مجتمعًا لكل صنف. |
| ★ أدنى / أعلى تعديل للسعر (% من سعر القائمة) | `manager:sales.priceFloor` / `priceCeiling` | حدود لتعديل السعر لا يتجاوزها أحد، ولا تشملها موافقة المشرف. |
| ★ المبيعات غير الاعتيادية | `manager:sales.flagFilter`، `manager:reports.exceptions` · Unusual sales | مبيعات مجانية أو فوق حد الخصم أو بسعر معدَّل أو باعتماد مشرف. |
| ★ بيع مجاني / فوق حد الخصم / سعر معدَّل / اعتماد مشرف | `manager:sales.flag_*` · Free / Above limit / Price changed / Supervised | إشارات على عملية البيع في سجل المبيعات. |
| القناة | `manager:sales.channel` · Channel | مصدر البيع: «نقطة البيع» أو «إلكتروني». |
| طرق الدفع | `manager:nav.payments` · Payment methods | نقدًا، بطاقة، تحويل بنكي، وغيرها، مع رسومها. |
| الحسابات المالية | `manager:nav.accounts` · Financial accounts | الخزائن والحسابات البنكية التي تستقر فيها المدفوعات. |
| رسوم المعالجة | `manager:cash.feeType`، `manager:sales.fees` · Processing fee(s) | رسوم تُحسب على كل دفعة حسب طريقة الدفع. |
| ★ الرسوم عند الاسترجاع | `manager:cash.refundFeePolicy` · Fees on refunds | هل يحتفظ المزوّد برسومه أم تُستردّ بالتناسب، حسب عقدك. |
| بوابة الدفع | `manager:cash.gateway` · Payment gateway | مزوّد الدفع الإلكتروني؛ المتاح حاليًا «تجريبية (مدفوعات اختبار فقط)». |
| المتجر الإلكتروني | `manager:online.title` · Online store | بيع المنتجات عبر الإنترنت. |
| مسودة (مخفي) / منشور / موقوف مؤقتًا (تصفح فقط) | `manager:online.store_*` · Draft (hidden) / Published / Paused (browse only) | حالة المتجر الإلكتروني. |
| فرع التجهيز | `manager:online.branch` · Fulfilment branch | الفرع الذي يجهّز الطلبات الإلكترونية ويُخصم من مخزونه. |
| يحتاج مراجعة | `manager:online.status_needs_attention` · Needs attention | طلب مدفوع تعذّر تجهيزه تلقائيًا. |
| صافي المبيعات | `manager:reports.netSales` · Net sales | إجمالي المبيعات ناقص الخصومات. |
| الصافي بعد المرتجعات | `manager:reports.netAfterRefunds` · Net after refunds | صافي المبيعات ناقص مرتجعات الفترة (انظر ت-25). |
| إجمالي الربح | `manager:reports.grossProfit` · Gross profit | الصافي بعد المرتجعات ناقص تكلفة البضاعة؛ يذكر ما استُبعد من مبيعات بلا تكلفة. |
| المحصّل | `manager:reports.collected` · Collected | المبالغ المستلمة فعلًا عن المبيعات. |
| صافي النقد | `manager:reports.netCash` · Net cash | المبيعات النقدية − المرتجعات النقدية + الإيداع − السحب. |
| ★ كيف تُحسب هذه الأرقام | `manager:reports.definitions` · How these figures are calculated | تعريفات أرقام التقارير داخل الشاشة نفسها. |
| تصدير CSV | `manager:reports.exportCsv`، `manager:audit.export` · Export CSV | تنزيل جدول التقرير أو سجل التدقيق لفتحه في برنامج جداول؛ كل عرض وتصدير للتقارير يُسجَّل. |
| الاشتراك / الباقة الحالية | `manager:subscription.title` / `manager:subscription.current` · Subscription / Current plan | باقة الشركة وحدودها؛ يغيّرها فريق المنصة فقط. |
| ★ المنطقة الزمنية | `manager:company.timezone` · Time zone | منطقة الشركة التي تُقطع عندها كل الأيام في القوائم والكشوف والتقارير؛ تغييرها يعيد قطع الأيام السابقة. |

### 9.1 الرقابة والإقفال

| المصطلح في الواجهة | المقابل في الكود | التعريف |
|---|---|---|
| ★ سجل التدقيق | `manager:nav.audit`، `manager:audit.title` · Audit log | كل إجراء مسجَّل في الشركة؛ السجلات دائمة ولا يمكن تعديلها. |
| ★ الوقت / من / الإجراء / السجل / التفاصيل | `manager:audit.when` / `actor` / `action` / `target` / `details` | أعمدة سجل التدقيق؛ «التفاصيل» تُظهر القيمة القديمة → الجديدة للحقول المعدّلة. |
| ★ موظف / مشغّل المنصة / النظام / مجهول | `manager:audit.actor_*` · Employee / Platform operator / System / Anonymous | من قام بالإجراء. |
| ★ مستخدم محذوف | `manager:audit.unknownUser` · Deleted user | إجراء قام به حساب لم يعد موجودًا. |
| ★ إقفال الفترات | `manager:nav.periods`، `manager:periods.title` · Period close | شاشة إقفال الأشهر بالترتيب مع حزمة أرقام محفوظة لكل شهر. |
| ★ مقفل / جاهز للإقفال / مفتوح / الشهر الحالي | `manager:periods.status_*` · Closed / Ready to close / Open / Current month | حالة الشهر. |
| ★ إقفال الشهر | `manager:periods.close` · Close month | إقفال نهائي لا تراجع عنه؛ بعده لا يُقبل مستند مؤرخ داخل الشهر. |
| ★ حزمة نهاية الشهر | `manager:periods.packTitle` · Month-end pack | أرقام الشهر (المبيعات، الربح، النقد، المخزون، التحصيلات) محفوظة عند الإقفال، أو حية لشهر مفتوح. |
| ★ بنود مفتوحة تنتقل إلى الشهر التالي | `manager:periods.openItems` · Open items carried forward | ما زال ينتظر قرارًا عند حساب الحزمة (فروقات، تحويلات، اعتمادات، فواتير معلّقة). |
| ★ هذا التاريخ يقع في فترة مقفلة… | `common:errors.PERIOD_CLOSED` | رسالة عند تأريخ أمر شراء أو تسليم داخل شهر مقفل. |

---

## 10. مصطلحات وردت في طلب التأسيس ولم توجد بنصها في الواجهة

| المصطلح المقترح | ما وُجد في الواجهة فعلًا | القرار في الدليل |
|---|---|---|
| تعليق البيع | الزر «تعليق»، والرسالة «تم تعليق عملية البيع»، والقائمة «المبيعات المعلّقة» | نكتب «تعليق» للزر و«عملية البيع المعلّقة» للنتيجة. |
| درج النقد | «الدرج»، «درج الصندوق»، «النقد المتوقع في الدرج» | نستخدم «الدرج». |
| تجاوز | لا يوجد مصطلح مستقل؛ يرد في «خصومات تتجاوز الحد» (اسم صلاحية)، وفي رسالة «هذا الخصم يتجاوز الحد المسموح لك. اطلب مشرفًا.»، و«خصم يتجاوز الحد»، و«تجاوز المالك» | لا نستخدم «تجاوز» كمصطلح؛ نصف الحالة بنص الرسالة، ونسمّي الحل «موافقة مشرف». |
| إقفال الشهر | ★ موجود الآن: «إقفال الفترات» (القائمة والعنوان) و«إقفال الشهر» (الزر) | معتمد: «إقفال الفترات» للشاشة و«إقفال الشهر» للفعل. لا نكتب «الفترات» وحدها. |
| موافقة المشرف | ★ «مطلوب موافقة مشرف» (عنوان القسم في نافذة الدفع)، والزر «اعتماد» | معتمد: «موافقة المشرف». |
| وردية، مرتجع، خزينة | موجودة كما هي («الوردية»، «المرتجعات»، «الخزينة») | معتمدة (انظر الجداول أعلاه). |

---

## 11. تناقضات في الواجهة نفسها (للتوحيد)

المفهوم نفسه مكتوب بأكثر من صيغة. لا يُصحَّح شيء في الكود في هذه المرحلة. عند الإشارة إلى زر أو
عنوان بعينه يُنقل النص كما يظهر في الشاشة؛ وفي الشرح يُستخدم عمود «الصيغة في الدليل».

- **ت-1 إلى ت-23: معتمدة بقرار المالك (ق-5، 2026-10-13).**
- **ت-24 إلى ت-27: جديدة في هذا التحديث، مقترحة وتنتظر القرار (ق-8).**

| # | المفهوم | الصيغ الموجودة (المفتاح) | الصيغة في الدليل | الحالة |
|---|---|---|---|---|
| ت-1 | Refund (الاسترجاع) | «استرجاع» (`pos:returns.refund`)، «المرتجعات» (`manager:reports.refunds`)، «استرداد» و«المسترد» و«رقم الاسترداد» (`manager:customers.refundCount_*`، `customers.refunded`، `customers.refundNumber`) مقابل «المسترجع» و«رقم الاسترجاع» (`manager:sales.refunded`، `refunds.number`) | «استرجاع» للعملية، و«المرتجعات» للشاشة. | معتمدة |
| ت-2 | رصيد الاستبدال | «رصيد المرتجع» (`pos:returns.credit`)، «رصيد الاستبدال» (`manager:refunds.credit`)، «رصيد استبدال» (`manager:reports.exchangeCredit`) | «رصيد الاستبدال». | معتمدة |
| ت-3 | إلغاء عملية البيع (void) | «إلغاء البيع» (`pos:returns.void`)، «إلغاء بيع» (`pos:returns.kind_void`، `manager:refunds.kind_void`)، «فاتورة ملغاة» (`manager:reports.move_sale_void`)، «مبيعات ملغاة» (`manager:refunds.voids`)، «إلغاء المبيعات» (صلاحية `sales.void`) | «إلغاء البيع». | معتمدة |
| ت-4 | عنوان شاشة المرتجعات | القائمة «المرتجعات» (`manager:nav.refunds`)، عنوان الصفحة «المرتجعات والاسترجاع» (`manager:refunds.title`)، وفي نقطة البيع «المرتجعات والاستبدال» (`pos:returns.title`) | نذكر اسم القائمة «المرتجعات». | معتمدة |
| ت-5 | تعديل المخزون | «تعديل» و«تعديلات المخزون» (`manager:inventory.*`) مقابل «تسوية» و«تسويات المخزون» (`manager:reports.move_adjustment`، `reports.adjustments`) | «تعديل». | معتمدة |
| ت-6 | Category | «التصنيف»/«التصنيفات» (`manager:catalog.*`، `nav.categories`) مقابل «الفئة»/«الفئات»/«بدون فئة» (`manager:reports.category`، `reports.uncategorized`، `reports.byCategory`، `restaurant.routedCategories`، `restaurant.stationsHint`) | «التصنيف». | معتمدة |
| ت-7 | المخزون المتتبَّع | «متتبَّعة» (`manager:inventory.tracked`، `common:errors.NOT_STOCK_TRACKED`) مقابل «المتابعة»/«متابع» (`manager:reports.trackedItems`، `restaurant.noStock`، `restaurant.recipeTracked`) | «متتبَّع». | معتمدة |
| ت-8 | Out of stock | «نفد» (`pos:sale.outOfStock`، `manager:inventory.status_out`) مقابل «نافد» (`manager:reports.stock_out`) | «نفد». | معتمدة |
| ت-9 | Cancelled | «ملغى» (`pos:restaurant.status_cancelled`، `manager:transfers.status_cancelled`، `purchasing.status_cancelled`، `cashCustody.status_cancelled`) مقابل «ملغي» (`manager:online.status_cancelled`، `subscription.status_cancelled`) — اختلاف في الرسم | «ملغى». | معتمدة |
| ت-10 | خطة الاشتراك | «الباقة»/«باقتك» (`manager:subscription.*`) مقابل «خطة الاشتراك»/«الخطة» (`common:errors.PLAN_LIMIT_REACHED`، `PLAN_FEATURE_UNAVAILABLE`، `PLAN_CHANGE_BLOCKED`) | «الباقة»، مع نقل نص الرسالة كما هو. | معتمدة |
| ت-11 | الشركة | «الشركة» (أغلب النصوص)، «المنشأة» (`manager:nav.sectionOrganization`)، «التاجر» (`common:errors.PLAN_CHANGE_BLOCKED`) | «الشركة». | معتمدة |
| ت-12 | الفرق المقبول للصندوق | «الفرق المقبول (د.ك)» (`manager:cash.tolerance`) مقابل «هامش الصندوق» (`manager:reports.def_discrepancy`) | «الفرق المقبول». | معتمدة |
| ت-13 | النقد المتوقع | «النقد المتوقع في الدرج» (`pos:shift.expected`) مقابل «المتوقع في الصندوق» (`pos:shift.expectedInDrawer`) و«الرصيد في النظام» (`manager:cashCustody.expected`) | «النقد المتوقع في الدرج». | معتمدة |
| ت-14 | النقد المعدود | «النقد المعدود (د.ك)» (`pos:shift.counted`) مقابل «المبلغ المعدود (د.ك)» (`manager:cashCustody.countedCash`) | «النقد المعدود». | معتمدة |
| ت-15 | النقد الافتتاحي | «النقد الافتتاحي» (`pos:shift.openingCash`، `manager:cash.openingFloat`) مقابل «نقد الافتتاح» (`manager:reports.openingFloat`) | «النقد الافتتاحي». | معتمدة |
| ت-16 | نتيجة الإغلاق | «متوازنة» (`pos:shift.outcome_balanced`، `manager:cash.outcome_balanced`) مقابل «متوازن» (`manager:reports.balanced`) | «متوازنة». | معتمدة |
| ت-17 | Cash in / Cash out مقابل الإيداع البنكي والسحب إلى الخزينة | «إيداع نقدي» (إدخال نقد إلى الدرج) و«إيداع بنكي» (إخراج نقد إلى البنك) يشتركان في كلمة «إيداع» بمعنيين متعاكسين؛ و«سحب نقدي» (أي إخراج من الدرج) و«سحب إلى الخزينة» (نوع من السحب) | ليس تكرارًا لفظيًا بل لبس في المعنى: يُشرح صراحة في القسمين 10 و29. | معتمدة |
| ت-18 | كلمة «التحويلات» | القائمة «التحويلات» (`manager:nav.transfers`) = تحويلات المخزون، وتبويب «التحويلات» (`manager:cashCustody.tabTransfers`) = تحويلات النقد، و«تحويل بنكي» = طريقة دفع | نكتب دائمًا «تحويلات المخزون» أو «تحويل نقدي» بحسب المقصود. | معتمدة |
| ت-19 | «زيادة» | نتيجة إغلاق الوردية (`pos:shift.outcome_over`) ونوع تعديل مخزون (`manager:inventory.kind_increase`) | ليس تناقضًا؛ ينبَّه إليه في القسمين 07 و19. | معتمدة |
| ت-20 | «الباقي» | «الباقي للعميل» و«الباقي» = Change (`pos:sale.change`، `manager:sales.change`)، و«ادفع الباقي» = الجزء غير المدفوع (`pos:restaurant.splitHint`)، و«المتبقي» = Remaining (`pos:sale.remaining`) | «الباقي للعميل» للنقد المُعاد، و«المتبقي» لما لم يُدفع. | معتمدة |
| ت-21 | المرسَل | «المرسل» (`manager:reports.dispatched`) مقابل «المُرسل» (`manager:transfers.dispatched`) — تشكيل فقط | «المُرسل». | معتمدة |
| ت-22 | الشحنات | «الشحنات» (`manager:purchasing.receipts`) مقابل «دفعات استلام» (`manager:reports.receiptsWord`) | «الشحنات». | معتمدة |
| ت-23 | حد التنبيه | «حد التنبيه» (`manager:inventory.setThreshold`، `manager:reports.threshold`) مقابل «تنبيه عند» (`manager:inventory.threshold`، عنوان عمود) | «حد التنبيه». | معتمدة |
| ت-24 | كلمة «استرجاع» | «استرجاع» = Refund للمبيعات (`pos:returns.refund`) مقابل «استرجاع» = Recall لتحويل مخزون في الطريق (`manager:transfers.recall`، `recallTitle`، `status_recalled` «مسترجَع»، `recalledBy` «استرجعه») | «استرجاع التحويل» دائمًا مع كلمة «التحويل» في القسم 20؛ و«استرجاع» وحدها للمبيعات فقط. | مقترحة |
| ت-25 | الصافي بعد المرتجعات | «الصافي بعد المرتجعات» و«المرتجعات» (`manager:reports.netAfterRefunds`، `reports.refunds`) مقابل «الصافي بعد الاسترجاعات» و«استرجاعات اليوم» و«الاسترجاعات» (`manager:dashboard.todayNet`، `dashboard.todayRefunds_*`، `periods.netAfterRefunds`، `periods.refunds_*`) | «الصافي بعد المرتجعات» في الشرح؛ تُنقل عناوين لوحة التحكم والحزمة كما هي. | مقترحة |
| ت-26 | طريقة الدفع | «طريقة الدفع» (`manager:nav.payments`، `reports.method`، `pos:sale.payWith`) مقابل «وسيلة الدفع» (`manager:periods.method`، `periods.collections`) | «طريقة الدفع». | مقترحة |
| ت-27 | الشحنة / التسليم | «الشحنات» و«استلام شحنة» (`manager:purchasing.receipts`، `purchasing.receive`) مقابل «تاريخ التسليم» و«تسليم {{date}}» (`purchasing.receivedOn`، `receivedOnLabel`) و«تسليمات» (`manager:periods.documents`) | «الشحنة» للمستند، و«تاريخ التسليم» لاسم الحقل كما هو. | مقترحة |

ملاحظة: «إقفال» (الشهر) و«إغلاق» (الوردية، المتبقي في أمر الشراء) ليسا تناقضًا؛ مفهومان مختلفان
ويُكتب كل منهما كما هو.
