// All landing-page text. Edit here to change the copy; both languages share the same keys.
// Prices in the till preview are display strings (KWD, 3 decimals), never computed.
export type Language = 'ar' | 'en';

export const CONTACT_EMAIL = 'info@arabatapp.com';

export interface Feature {
  icon: string;
  title: string;
  text: string;
}

/** Trial length as the owner writes it ("14 يوم"); the number is set in the platform. */
function arabicLength(days: number): string {
  return `${days} يوم`;
}
function englishLength(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

const ar = {
  trialLength: arabicLength,
  pageTitle: 'عربات POS — نظام نقاط البيع في الكويت',
  nav: {
    home: 'الرئيسية',
    features: 'المميزات',
    why: 'لماذا عربات',
    pricing: 'الأسعار',
    start: 'ابدأ الآن',
  },
  switchLanguage: 'English',
  signIn: 'تسجيل الدخول',
  signupCta: 'أنشئ حساب وجهّز محلك',
  priceLine: '{price} د.ك سنوياً · تجربة مجانية {length} بدون بطاقة',
  trialLine: 'تجربة مجانية {length} بدون بطاقة',
  pricingLink: 'شاهد تفاصيل الأسعار',
  openMenu: 'فتح القائمة',
  closeMenu: 'إغلاق القائمة',
  hero: {
    lead: 'نظام نقاط البيع وإدارة الأعمال في الكويت',
    title: 'بِع أسرع، وتابع فروعك ومخزونك وأرباحك من مكان واحد',
    subtitle:
      'كاشير سريع للمحلات والمطاعم، ولوحة إدارة كاملة للمالك والمدراء، بالعربي والإنجليزي وبالدينار الكويتي.',
    primary: 'أنشئ حساب شركتك',
    secondary: 'تسجيل الدخول',
  },
  till: {
    title: 'الكاشير — الفرع الرئيسي',
    items: [
      { name: 'قهوة عربية', qty: '1', price: '1.250' },
      { name: 'كرواسون زعتر', qty: '2', price: '1.500' },
      { name: 'عصير برتقال طازج', qty: '1', price: '2.500' },
    ],
    totalLabel: 'الإجمالي',
    total: '5.250',
    currency: 'د.ك',
    pay: 'دفع',
    paid: 'تم البيع ✓',
  },
  trust: {
    label: 'مبني للثقة',
    title: 'أساس متين لأعمالك',
    items: [
      {
        title: 'استضافة سحابية في المنطقة',
        text: 'خوادم Google Cloud في الدوحة واتصال مشفّر بالكامل',
      },
      { title: 'دقة مالية', text: 'الدينار الكويتي بثلاث خانات عشرية بدون أخطاء تقريب' },
      { title: 'عربي وإنجليزي', text: 'كل الشاشات بالعربي والإنجليزي، كل لغة باتجاهها الصحيح' },
      { title: 'سجل لكل عملية', text: 'كل عملية مالية وكل تعديل مسجل باسم من قام به' },
    ],
  },
  power: {
    title: 'شغّل البيع والمخزون والنقدية بدون فوضى',
    text1:
      'عربات تربط المالك والمدير والكاشير في نظام واحد — من فتح الوردية حتى إغلاقها وتسليم الصندوق.',
    text2:
      'تقارير مبيعات وأرباح لحظية، مخزون دقيق في كل فرع، وصلاحيات واضحة لكل موظف — حتى تعرف ماذا يحدث في محلك وأنت بعيد.',
    cta: 'استكشف المميزات',
  },
  dashboard: {
    title: 'لوحة الإدارة — اليوم',
    kpis: [
      { label: 'المبيعات', value: '1,284.750', unit: 'د.ك' },
      { label: 'الفواتير', value: '312', unit: '' },
      { label: 'الربح الإجمالي', value: '421.300', unit: 'د.ك' },
    ],
    chartLabel: 'مبيعات آخر 7 أيام',
    days: ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'],
    branchesLabel: 'الفروع',
    branches: [
      { name: 'السالمية', value: '612.250' },
      { name: 'حولي', value: '418.000' },
      { name: 'الجهراء', value: '254.500' },
    ],
  },
  features: {
    title: 'كل ما يحتاجه نشاطك التجاري',
    text1: 'من شاشة الكاشير إلى لوحة المالك — منصة واحدة ومصدر واحد للأرقام.',
    text2: 'قلل العمل اليدوي، وامنع ضياع المبيعات والمخزون، وامنح المدراء رؤية كاملة.',
    main: [
      { icon: '4', title: 'كاشير سريع', text: 'بحث وباركود وخصومات ودفع مقسّم وإيصال خلال ثوانٍ.' },
      {
        icon: '10',
        title: 'مخزون دقيق',
        text: 'رصيد لكل فرع، جرد وتسويات بموافقة، وتنبيه عند النقص.',
      },
      {
        icon: '15',
        title: 'فروع وموظفون',
        text: 'كل فرع بموظفيه وصناديقه، وصلاحيات محددة لكل دور.',
      },
      {
        icon: '8',
        title: 'نقدية واضحة',
        text: 'ورديات بعدّ الصندوق، مصروفات، إيداعات بنكية وكشف كامل.',
      },
    ] as Feature[],
    allTitle: 'قدرات المنصة الكاملة',
    all: [
      {
        icon: '2',
        title: 'لوحة الإدارة',
        text: 'المالك والمدراء يتابعون المبيعات والفروع والموظفين من مكان واحد.',
      },
      { icon: '3', title: 'الطلبات والمطاعم', text: 'طاولات وإضافات وشاشة مطبخ وتقسيم الفاتورة.' },
      {
        icon: '11',
        title: 'تقارير وأرباح',
        text: 'مبيعات وأرباح ومخزون ونقدية حسب الفترة والفرع والموظف.',
      },
      { icon: '1', title: 'متجر إلكتروني', text: 'متجر أونلاين على نفس المنتجات والمخزون.' },
      {
        icon: '5',
        title: 'المشتريات والموردون',
        text: 'أوامر شراء واستلام جزئي وتحويلات بين الفروع.',
      },
      {
        icon: '6',
        title: 'المرتجعات والاستبدال',
        text: 'مرتجع كامل أو جزئي بموافقة المشرف وإعادة للمخزون.',
      },
      {
        icon: '9',
        title: 'صلاحيات المشرف',
        text: 'موافقة المشرف على الخصم وتغيير السعر والمرتجعات.',
      },
      { icon: '16', title: 'العملاء', text: 'ملف لكل عميل مع سجل مشترياته ومرتجعاته.' },
      {
        icon: '7',
        title: 'طرق دفع متعددة',
        text: 'نقد وبطاقة وتحويل ودفع مقسّم مع رسوم كل طريقة.',
      },
      { icon: '13', title: 'إغلاق الشهر', text: 'إقفال الفترات بالترتيب وحفظ أرقامها.' },
      { icon: '12', title: 'أمان الحسابات', text: 'حساب مالك محمي، ودخول مستقل للإدارة والكاشير.' },
      { icon: '14', title: 'طباعة الإيصالات', text: 'طباعة من المتصفح أو من طابعة الفرع مباشرة.' },
    ] as Feature[],
  },
  why: {
    title: 'نظام ذكي لتنمية تجارتك',
    subtitle: 'أربع ركائز تساعد المحلات والمطاعم في الكويت على العمل بثقة.',
    items: [
      {
        icon: 'why-6',
        title: 'توسّع دون فقدان السيطرة',
        text: 'أضف فروعاً وموظفين مع صلاحيات ووضوح على كل مستوى.',
      },
      {
        icon: 'why-7',
        title: 'مرونة لكل نشاط',
        text: 'محل تجزئة أو مطعم أو عدة فروع — النظام يتكيف معك.',
      },
      {
        icon: 'why-8',
        title: 'تميّز في السوق',
        text: 'متجر إلكتروني وتقارير احترافية تساعدك على النمو.',
      },
      { icon: 'why-9', title: 'شريكك في كل خطوة', text: 'منصة تتطور باستمرار مع احتياجات عملك.' },
    ],
  },
  steps: {
    title: 'ابدأ في ثلاث خطوات',
    items: [
      { title: 'اختر نشاطك', text: 'محل أو مطعم أو كافيه: ضغطة وحدة ونجهّز لك حسابك.' },
      { title: 'جهّز محلك', text: 'اشتغل على أجهزتك، أو اختر أجهزة للتجربة.' },
      { title: 'ابدأ تجربتك المجانية', text: 'أنشئ حسابك وتبدأ تجربتك فوراً، بدون بطاقة.' },
    ],
  },
  teaser: {
    label: 'الأسعار',
    title: 'سعر واحد واضح لكل شركة',
    text: 'النظام كامل باشتراك سنوي واحد مهما كان عدد فروعك، وأجهزة اختيارية حسب احتياجك.',
    cta: 'شاهد الأسعار وجهّز محلك',
  },
  pricing: {
    pageTitle: 'الأسعار | عربات POS',
    lead: 'الأسعار',
    title: 'سعر واحد واضح. بدون مفاجآت.',
    subtitle:
      'اشترك في النظام كاملاً، واختر الأجهزة اللي تحتاجها — وشوف المبلغ النهائي قبل ما ترسل طلبك.',
    perYear: 'سنوياً',
    perCompany: 'لكل شركة — مهما كان عدد الفروع والموظفين',
    once: 'مرة واحدة',
    currency: 'د.ك',
    steps: ['النظام', 'الأجهزة', 'الطلب'],
    stepLabel: 'الخطوة {n} من 3',
    system: {
      title: 'نظامك الكامل',
      text: 'كل اللي يحتاجه محلك من أول يوم، في اشتراك واحد.',
      includes: [
        'كاشير سريع للبيع والمرتجعات والورديات',
        'لوحة إدارة للمالك والمدراء',
        'مخزون لكل فرع مع الجرد والتحويلات',
        'تقارير المبيعات والأرباح والنقدية',
        'فروع وموظفين وصلاحيات بلا رسوم إضافية',
        'متجر إلكتروني ووضع المطاعم',
        'عربي وإنجليزي، والدينار بثلاث خانات',
        'استضافة سحابية آمنة وتحديثات مستمرة',
      ],
      included: 'مضمّن في طلبك',
      next: 'التالي: جهّز محلك',
    },
    devices: {
      title: 'جهّز محلك',
      text: 'أضف الأجهزة اللي تحتاجها — أو تخطَّ هذي الخطوة إذا عندك أجهزتك.',
      add: 'أضف',
      added: 'في السلة',
      increase: 'زيادة',
      decrease: 'إنقاص',
      max: 'الحد الأقصى {n}',
      empty: 'الأجهزة قريباً. تقدر ترسل طلب النظام الآن ونساعدك تختار الأجهزة المناسبة.',
      worksWith: 'النظام يعمل من المتصفح على أي تابلت أو آيباد أو كمبيوتر عندك.',
      next: 'التالي: راجع طلبك',
      skip: 'تخطَّ — عندي أجهزتي',
      back: 'رجوع',
    },
    cart: {
      title: 'طلبك',
      system: 'النظام (سنوياً)',
      devices: 'الأجهزة (مرة واحدة)',
      firstPayment: 'الدفعة الأولى',
      renewal: 'بعدها {amount} د.ك سنوياً للنظام',
      noDevices: 'بدون أجهزة',
      items: '{n} جهاز',
    },
    form: {
      title: 'أرسل طلبك',
      text: 'اكتب بياناتك ونفتح لك حسابك على طول، ويتواصل معك فريقنا لتأكيد الأجهزة وطريقة الدفع والتركيب.',
      business: 'نوع نشاطك',
      businessTypes: { retail: 'محل', restaurant: 'مطعم', cafe: 'كافيه', other: 'أخرى' },
      pickBusiness: 'اختر نوع نشاطك.',
      company: 'اسم المحل (اختياري)',
      contact: 'اسمك',
      phone: 'رقم الهاتف',
      email: 'البريد الإلكتروني',
      password: 'الرقم السري لحسابك',
      passwordHint: '10 أحرف على الأقل',
      submit: 'أرسل الطلب',
      sending: 'جارٍ الإرسال…',
      noPayment: 'لن يتم أي دفع الآن. ندفع فقط بعد التواصل والتأكيد.',
      back: 'رجوع للأجهزة',
      error: 'تعذّر إرسال الطلب. تأكد من البيانات وحاول مرة أخرى.',
      rateLimited: 'وصلنا طلبات كثيرة من هذا الجهاز. حاول لاحقاً أو راسلنا على البريد.',
      unavailable: 'أحد الأجهزة غير متاح للتجربة حالياً. ارجع للأجهزة وغيّر اختيارك.',
      emailTaken: 'هذا الإيميل مسجّل عندنا. سجّل دخولك بدل ما تنشئ حساب جديد.',
      signIn: 'تسجيل الدخول',
    },
    loading: 'جارٍ تحميل الأسعار…',
    loadError: 'تعذّر تحميل الأسعار. حدّث الصفحة أو راسلنا على البريد.',
    faq: {
      title: 'أسئلة شائعة',
      items: [
        {
          q: 'هل السعر لكل فرع؟',
          a: 'لا. الاشتراك السنوي للشركة كاملة، وتضيف فروعك وموظفيك بلا رسوم إضافية.',
        },
        {
          q: 'هل لازم أشتري الأجهزة منكم؟',
          a: 'لا. النظام يعمل من المتصفح على أي تابلت أو آيباد أو كمبيوتر، والأجهزة اختيارية.',
        },
        {
          q: 'كيف أدفع؟',
          a: 'لا يوجد دفع إلكتروني في الصفحة. بعد إرسال طلبك يتواصل معك فريقنا لتأكيد الطلب وطريقة الدفع.',
        },
        {
          q: 'متى أبدأ الاستخدام؟',
          a: 'تقدر تنشئ حساب شركتك وتجرب النظام الآن، ونكمل معك تجهيز الأجهزة بعد تأكيد الطلب.',
        },
      ],
    },
  },
  start: {
    pageTitle: 'جرّب مجاناً | عربات POS',
    steps: ['نشاطك', 'الأجهزة', 'حسابك'],
    business: {
      title: 'وش نوع نشاطك؟',
      text: 'اختر نشاطك ونجهّز لك حسابك على طول.',
      types: { retail: 'محل', restaurant: 'مطعم', cafe: 'كافيه', other: 'نشاط ثاني' },
    },
    devices: {
      title: 'اختر أجهزتك',
      text: 'اختر الأجهزة اللي تبي تجربها مجاناً.',
      worksWith: 'النظام يعمل من المتصفح على أي تابلت أو آيباد أو تلفون عندك.',
      available: 'متاح',
      unavailable: 'غير متاح حالياً',
      add: 'أضف',
      added: 'مختار',
      increase: 'زيادة',
      decrease: 'إنقاص',
      waitlist: 'أضفناك لقائمة الانتظار ونبلغك أول ما يتوفر. تقدر تبدأ تجربتك الحين على أجهزتك.',
      none: 'ما فيه أجهزة للتجربة حالياً. تقدر تبدأ على أجهزتك.',
      next: 'التالي',
      skip: 'تخطَّ، عندي أجهزتي',
    },
    summary: {
      title: 'طلبك',
      own: 'بدون أجهزة (على أجهزتك)',
      system: 'النظام (سنوياً)',
      devices: 'الأجهزة (مرة واحدة)',
      items: '{n} جهاز',
      trial: 'الفترة التجريبية',
      fromDelivery: 'تبدأ من يوم استلام الأجهزة',
      firstPayment: 'الدفعة الأولى بعد التجربة',
      renewal: 'بعدها {amount} د.ك سنوياً للنظام',
    },
    account: {
      title: 'خطوة أخيرة وتبدأ تجربتك',
      fullName: 'اسمك',
      email: 'إيميلك',
      password: 'الرقم السري',
      passwordHint: '10 أحرف على الأقل',
      company: 'اسم المحل (اختياري)',
      trial: 'تجربة مجانية {length}، بدون بطاقة.',
      submit: 'أنشئ حسابي',
      sending: 'جارٍ الإنشاء…',
      emailTaken: 'هذا الإيميل مسجّل عندنا. سجّل دخولك بدل ما تنشئ حساب جديد.',
      signIn: 'تسجيل الدخول',
      unavailable: 'تغيّر توفر أحد الأجهزة. ارجع لخطوة الأجهزة واختر من جديد.',
      rateLimited: 'محاولات كثيرة من هذا الجهاز. حاول بعد شوي.',
      error: 'تعذّر إنشاء الحساب. تأكد من البيانات وحاول مرة ثانية.',
    },
    done: {
      title: 'مبروك! تجربتك المجانية {length} بدأت.',
      devices: 'وصلنا طلب الأجهزة ونتواصل معك لموعد التسليم. التجربة تبدأ من يوم الاستلام.',
      waitlist: 'أضفناك لقائمة الانتظار للأجهزة ونبلغك أول ما تتوفر. تجربتك على أجهزتك بدأت الحين.',
      enter: 'ادخل لوحة التحكم',
    },
    back: 'رجوع',
    loading: 'جارٍ التحميل…',
    loadError: 'تعذّر تحميل الصفحة. حدّثها أو راسلنا على البريد.',
  },
  cta: {
    title: 'جاهز تشغّل محلك على عربات؟',
    text: 'أنشئ حساب شركتك أو سجّل الدخول إلى لوحة الإدارة.',
    primary: 'أنشئ حساب شركتك',
    secondary: 'تسجيل الدخول',
    contactLabel: 'لديك سؤال؟ راسلنا على',
  },
  footer: {
    accent: 'عربات POS',
    headline: 'نمِّ تجارتك مع عربات',
    text: 'نظام نقاط البيع وإدارة الأعمال للمحلات والمطاعم في الكويت.',
    manager: 'لوحة الإدارة',
    pos: 'شاشة الكاشير',
    copyright: 'حقوق النشر © {year} عربات',
  },
};

const en: typeof ar = {
  trialLength: englishLength,
  pageTitle: 'Arabat POS | Point of sale and business management in Kuwait',
  nav: {
    home: 'Home',
    features: 'Features',
    why: 'Why Arabat',
    pricing: 'Pricing',
    start: 'Get started',
  },
  switchLanguage: 'العربية',
  signIn: 'Sign in',
  signupCta: 'Create an account and set up your shop',
  priceLine: '{price} KWD per year · free trial for {length}, no card',
  trialLine: 'Free trial for {length}, no card',
  pricingLink: 'See pricing details',
  openMenu: 'Open menu',
  closeMenu: 'Close menu',
  hero: {
    lead: 'Point of sale and business management in Kuwait',
    title: 'Sell faster, and follow your branches, stock and profit from one place',
    subtitle:
      'A fast till for shops and restaurants, and a complete management dashboard for owners and managers, in Arabic and English and in Kuwaiti dinars.',
    primary: 'Create your company account',
    secondary: 'Sign in',
  },
  till: {
    title: 'Till — Main branch',
    items: [
      { name: 'Arabic coffee', qty: '1', price: '1.250' },
      { name: "Za'atar croissant", qty: '2', price: '1.500' },
      { name: 'Fresh orange juice', qty: '1', price: '2.500' },
    ],
    totalLabel: 'Total',
    total: '5.250',
    currency: 'KWD',
    pay: 'Pay',
    paid: 'Sale completed ✓',
  },
  trust: {
    label: 'Built for trust',
    title: 'A solid foundation for your business',
    items: [
      {
        title: 'Regional cloud hosting',
        text: 'Google Cloud servers in Doha, fully encrypted connections',
      },
      {
        title: 'Financial accuracy',
        text: 'Kuwaiti dinars with three decimals and no rounding errors',
      },
      {
        title: 'Arabic and English',
        text: 'Every screen in Arabic and English, each in its own reading direction',
      },
      {
        title: 'A record of every action',
        text: 'Every financial action and change is logged with who made it',
      },
    ],
  },
  power: {
    title: 'Run sales, stock and cash without the chaos',
    text1:
      'Arabat connects the owner, managers and cashiers in one system — from opening a shift to closing it and handing over the drawer.',
    text2:
      'Live sales and profit reports, accurate stock in every branch, and clear rights for every employee — so you know what happens in your shop even when you are away.',
    cta: 'Explore the features',
  },
  dashboard: {
    title: 'Management — Today',
    kpis: [
      { label: 'Sales', value: '1,284.750', unit: 'KWD' },
      { label: 'Receipts', value: '312', unit: '' },
      { label: 'Gross profit', value: '421.300', unit: 'KWD' },
    ],
    chartLabel: 'Sales, last 7 days',
    days: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    branchesLabel: 'Branches',
    branches: [
      { name: 'Salmiya', value: '612.250' },
      { name: 'Hawalli', value: '418.000' },
      { name: 'Jahra', value: '254.500' },
    ],
  },
  features: {
    title: 'Everything your business needs',
    text1: 'From the till to the owner dashboard — one platform and one source of numbers.',
    text2: 'Less manual work, no lost sales or stock, and full visibility for managers.',
    main: [
      {
        icon: '4',
        title: 'Fast till',
        text: 'Search, barcode, discounts, split payments and a receipt in seconds.',
      },
      {
        icon: '10',
        title: 'Accurate stock',
        text: 'Balances per branch, approved counts and adjustments, low-stock alerts.',
      },
      {
        icon: '15',
        title: 'Branches and staff',
        text: 'Each branch with its own staff and registers, and precise rights per role.',
      },
      {
        icon: '8',
        title: 'Clear cash',
        text: 'Shifts with drawer counts, expenses, bank deposits and full statements.',
      },
    ],
    allTitle: 'The complete platform',
    all: [
      {
        icon: '2',
        title: 'Management dashboard',
        text: 'Owners and managers follow sales, branches and staff from one place.',
      },
      {
        icon: '3',
        title: 'Orders and restaurants',
        text: 'Tables, modifiers, a kitchen display and split bills.',
      },
      {
        icon: '11',
        title: 'Reports and profit',
        text: 'Sales, profit, stock and cash by period, branch and employee.',
      },
      { icon: '1', title: 'Online store', text: 'An online store on the same products and stock.' },
      {
        icon: '5',
        title: 'Purchasing and suppliers',
        text: 'Purchase orders, partial receiving and branch transfers.',
      },
      {
        icon: '6',
        title: 'Returns and exchanges',
        text: 'Full or partial returns with supervisor approval and restocking.',
      },
      {
        icon: '9',
        title: 'Supervisor approvals',
        text: 'Supervisor approval for discounts, price changes and returns.',
      },
      {
        icon: '16',
        title: 'Customers',
        text: 'A profile for every customer with purchases and returns.',
      },
      {
        icon: '7',
        title: 'Many payment methods',
        text: 'Cash, card, transfer and split payments with fees per method.',
      },
      {
        icon: '13',
        title: 'Month closing',
        text: 'Periods closed in order with their figures kept.',
      },
      {
        icon: '12',
        title: 'Account security',
        text: 'A protected owner account and separate sign-in for management and till.',
      },
      {
        icon: '14',
        title: 'Receipt printing',
        text: 'Print from the browser or straight to the branch printer.',
      },
    ],
  },
  why: {
    title: 'A smart system to grow your business',
    subtitle: 'Four pillars that help shops and restaurants in Kuwait work with confidence.',
    items: [
      {
        icon: 'why-6',
        title: 'Grow without losing control',
        text: 'Add branches and staff with rights and visibility at every level.',
      },
      {
        icon: 'why-7',
        title: 'Flexible for every business',
        text: 'A retail shop, a restaurant or many branches — it adapts to you.',
      },
      {
        icon: 'why-8',
        title: 'Stand out in the market',
        text: 'An online store and professional reports that help you grow.',
      },
      {
        icon: 'why-9',
        title: 'Your partner at every step',
        text: 'A platform that keeps evolving with your business.',
      },
    ],
  },
  steps: {
    title: 'Get started in three steps',
    items: [
      {
        title: 'Pick your business',
        text: 'Shop, restaurant or café: one tap and we set up your account.',
      },
      { title: 'Set up your shop', text: 'Use your own devices, or pick devices to try.' },
      {
        title: 'Start your free trial',
        text: 'Create your account and start right away, no card.',
      },
    ],
  },

  teaser: {
    label: 'Pricing',
    title: 'One clear price per company',
    text: 'The complete system on one yearly subscription however many branches you have, plus optional devices for your needs.',
    cta: 'See prices and set up your shop',
  },
  pricing: {
    pageTitle: 'Pricing | Arabat POS',
    lead: 'Pricing',
    title: 'One clear price. No surprises.',
    subtitle:
      'Subscribe to the complete system, pick the devices you need — and see the final amount before you send your request.',
    perYear: 'per year',
    perCompany: 'per company — however many branches and staff',
    once: 'once',
    currency: 'KWD',
    steps: ['System', 'Devices', 'Request'],
    stepLabel: 'Step {n} of 3',
    system: {
      title: 'Your complete system',
      text: 'Everything your shop needs from day one, in one subscription.',
      includes: [
        'A fast till for sales, returns and shifts',
        'A management dashboard for owners and managers',
        'Stock per branch with counts and transfers',
        'Sales, profit and cash reports',
        'Branches, staff and rights at no extra cost',
        'Online store and restaurant mode',
        'Arabic and English, dinars with three decimals',
        'Secure cloud hosting and continuous updates',
      ],
      included: 'Included in your request',
      next: 'Next: set up your shop',
    },
    devices: {
      title: 'Set up your shop',
      text: 'Add the devices you need — or skip this step if you have your own.',
      add: 'Add',
      added: 'In your cart',
      increase: 'More',
      decrease: 'Less',
      max: 'Up to {n}',
      empty:
        'Devices are coming soon. You can request the system now and we will help you choose devices.',
      worksWith: 'The system runs in the browser on any tablet, iPad or computer you already have.',
      next: 'Next: review your request',
      skip: 'Skip — I have my own devices',
      back: 'Back',
    },
    cart: {
      title: 'Your request',
      system: 'System (per year)',
      devices: 'Devices (once)',
      firstPayment: 'First payment',
      renewal: 'then {amount} KWD per year for the system',
      noDevices: 'No devices',
      items: '{n} devices',
    },
    form: {
      title: 'Send your request',
      text: 'Leave your details and we open your account right away; our team will contact you to confirm the devices, payment and installation.',
      business: 'Your business',
      businessTypes: { retail: 'Shop', restaurant: 'Restaurant', cafe: 'Café', other: 'Other' },
      pickBusiness: 'Choose your type of business.',
      company: 'Shop name (optional)',
      contact: 'Your name',
      phone: 'Phone number',
      email: 'E-mail',
      password: 'Password for your account',
      passwordHint: 'At least 10 characters',
      submit: 'Send request',
      sending: 'Sending…',
      noPayment: 'Nothing is charged now. You pay only after we talk and confirm.',
      back: 'Back to devices',
      error: 'The request could not be sent. Check your details and try again.',
      rateLimited: 'Too many requests from this device. Try later or e-mail us.',
      unavailable:
        'One of the devices is not available for a trial right now. Go back and change your choice.',
      emailTaken: 'This e-mail is already registered. Sign in instead of creating a new account.',
      signIn: 'Sign in',
    },
    loading: 'Loading prices…',
    loadError: 'Prices could not be loaded. Reload the page or e-mail us.',
    faq: {
      title: 'Frequently asked questions',
      items: [
        {
          q: 'Is the price per branch?',
          a: 'No. The yearly subscription covers the whole company; add branches and staff at no extra cost.',
        },
        {
          q: 'Do I have to buy the devices from you?',
          a: 'No. The system runs in the browser on any tablet, iPad or computer; devices are optional.',
        },
        {
          q: 'How do I pay?',
          a: 'There is no online payment on this page. After you send your request, our team contacts you to confirm the order and the payment method.',
        },
        {
          q: 'When can I start?',
          a: 'You can create your company account and try the system now; we set up the devices with you once the order is confirmed.',
        },
      ],
    },
  },
  start: {
    pageTitle: 'Free trial | Arabat POS',
    steps: ['Business', 'Devices', 'Account'],
    business: {
      title: 'What kind of business do you run?',
      text: 'Pick your business and we set up your account right away.',
      types: { retail: 'Shop', restaurant: 'Restaurant', cafe: 'Café', other: 'Something else' },
    },
    devices: {
      title: 'Choose your devices',
      text: 'Pick the devices you want to try for free.',
      worksWith: 'The system runs in the browser on any tablet, iPad or phone you already have.',
      available: 'Available',
      unavailable: 'Not available right now',
      add: 'Add',
      added: 'Selected',
      increase: 'More',
      decrease: 'Less',
      waitlist:
        "We added you to the waiting list and will tell you as soon as it's free. You can start your trial now on your own devices.",
      none: 'No devices to try right now. You can start on your own devices.',
      next: 'Next',
      skip: 'Skip, I have my own devices',
    },
    summary: {
      title: 'Your order',
      own: 'No devices (your own)',
      system: 'System (per year)',
      devices: 'Devices (once)',
      items: '{n} devices',
      trial: 'Free trial',
      fromDelivery: 'Starts on the day the devices arrive',
      firstPayment: 'First payment after the trial',
      renewal: 'then {amount} KWD per year for the system',
    },
    account: {
      title: 'One last step',
      fullName: 'Your name',
      email: 'Your e-mail',
      password: 'Password',
      passwordHint: 'At least 10 characters',
      company: 'Shop name (optional)',
      trial: 'Free trial for {length}, no card.',
      submit: 'Create my account',
      sending: 'Creating…',
      emailTaken: 'This e-mail is already registered. Sign in instead.',
      signIn: 'Sign in',
      unavailable: 'A device is no longer available. Go back to the devices and choose again.',
      rateLimited: 'Too many attempts from this device. Try again shortly.',
      error: 'The account could not be created. Check your details and try again.',
    },
    done: {
      title: "You're in! Your free trial has started: {length}.",
      devices:
        'We received your device request and will contact you to arrange delivery. The trial starts on the day you receive them.',
      waitlist:
        "You're on the waiting list for devices and we'll tell you when they're free. Your trial on your own devices has started.",
      enter: 'Go to the dashboard',
    },
    back: 'Back',
    loading: 'Loading…',
    loadError: 'The page could not be loaded. Reload it or e-mail us.',
  },
  cta: {
    title: 'Ready to run your shop on Arabat?',
    text: 'Create your company account or sign in to the management dashboard.',
    primary: 'Create your company account',
    secondary: 'Sign in',
    contactLabel: 'Questions? Write to us at',
  },
  footer: {
    accent: 'Arabat POS',
    headline: 'Grow your business with Arabat',
    text: 'Point of sale and business management for shops and restaurants in Kuwait.',
    manager: 'Management',
    pos: 'Cashier',
    copyright: 'Copyright © {year} Arabat',
  },
};

export const content = { ar, en };
export type Content = typeof ar;
