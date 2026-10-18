// All landing-page text. Edit here to change the copy; both languages share the same keys.
// Prices in the till preview are display strings (KWD, 3 decimals), never computed.
export type Language = 'ar' | 'en';

export const CONTACT_EMAIL = 'info@arabatapp.com';

export interface Feature {
  icon: string;
  title: string;
  text: string;
}

const ar = {
  pageTitle: 'عربات POS | نظام نقاط البيع وإدارة الأعمال في الكويت',
  nav: { home: 'الرئيسية', features: 'المميزات', why: 'لماذا عربات', start: 'ابدأ الآن' },
  switchLanguage: 'English',
  signIn: 'تسجيل الدخول',
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
      { title: 'أنشئ حساب شركتك', text: 'سجّل اسم الشركة والفرع الأول خلال دقائق.' },
      { title: 'أضف منتجاتك وفريقك', text: 'المنتجات والأسعار والمخزون، ثم ادعُ موظفيك بأدوارهم.' },
      { title: 'ابدأ البيع', text: 'افتح الوردية من شاشة الكاشير وابدأ البيع فوراً.' },
    ],
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
  pageTitle: 'Arabat POS | Point of sale and business management in Kuwait',
  nav: { home: 'Home', features: 'Features', why: 'Why Arabat', start: 'Get started' },
  switchLanguage: 'العربية',
  signIn: 'Sign in',
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
        title: 'Create your company account',
        text: 'Register your company and first branch in minutes.',
      },
      {
        title: 'Add your products and team',
        text: 'Products, prices and stock, then invite your staff with their roles.',
      },
      { title: 'Start selling', text: 'Open a shift on the till and start selling right away.' },
    ],
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
