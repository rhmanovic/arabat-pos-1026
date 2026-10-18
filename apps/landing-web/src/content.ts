// All landing-page text. Edit here to change the copy; both languages share the same keys.
export type Language = 'ar' | 'en';

export const content = {
  ar: {
    brand: 'عربات POS',
    switchLanguage: 'English',
    signIn: 'تسجيل الدخول',
    heroTitle: 'نظام نقاط البيع وإدارة أعمالك في مكان واحد',
    heroText:
      'بيع من الكاشير، تابع المخزون والفروع والموظفين، واطّلع على تقاريرك من لوحة الإدارة. مصمم للمحلات والمطاعم والمتاجر في الكويت، بالعربي والإنجليزي.',
    openManager: 'لوحة الإدارة',
    openPos: 'شاشة الكاشير',
    featuresTitle: 'كل ما يحتاجه نشاطك التجاري',
    features: [
      {
        title: 'نقطة بيع سريعة',
        text: 'شاشة كاشير مستقلة باللمس، بالدينار الكويتي وثلاث خانات عشرية.',
      },
      { title: 'المخزون', text: 'حركات مخزون دقيقة، تحويلات بين الفروع، وجرد وتسويات بموافقة.' },
      { title: 'فروع متعددة', text: 'كل فرع بموظفيه وصناديقه، وصلاحيات محددة لكل موظف.' },
      { title: 'الصلاحيات والأمان', text: 'أدوار وصلاحيات قابلة للتعديل، وسجل لكل عملية مالية.' },
      { title: 'التقارير', text: 'مبيعات وأرباح ومخزون ونقدية حسب الفترة والفرع.' },
      { title: 'متجر إلكتروني', text: 'متجر أونلاين مرتبط بنفس المنتجات والمخزون.' },
    ],
    footer: 'عربات POS',
  },
  en: {
    brand: 'Arabat POS',
    switchLanguage: 'العربية',
    signIn: 'Sign in',
    heroTitle: 'Point of sale and business management in one place',
    heroText:
      'Sell at the till, follow stock, branches and staff, and read your reports in the management dashboard. Built for shops, restaurants and stores in Kuwait, in Arabic and English.',
    openManager: 'Management',
    openPos: 'Cashier',
    featuresTitle: 'Everything your business needs',
    features: [
      {
        title: 'Fast point of sale',
        text: 'A dedicated touch cashier screen, in Kuwaiti dinars with three decimals.',
      },
      {
        title: 'Inventory',
        text: 'Accurate stock movements, branch transfers, counts and approved adjustments.',
      },
      {
        title: 'Multiple branches',
        text: 'Each branch with its own staff and registers, and precise rights per employee.',
      },
      {
        title: 'Roles and security',
        text: 'Configurable roles and permissions, and an audit trail of every financial action.',
      },
      { title: 'Reports', text: 'Sales, profit, stock and cash by period and branch.' },
      { title: 'Online store', text: 'An online store on the same products and stock.' },
    ],
    footer: 'Arabat POS',
  },
} as const;
