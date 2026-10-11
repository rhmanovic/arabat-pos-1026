import type { CommonResources } from './en.js';

/** النصوص العربية المشتركة بين التطبيقات الثلاثة (namespace "common"). */
export const commonAr: CommonResources = {
  appName: 'عربات POS',
  interfaces: {
    manager: 'الإدارة',
    pos: 'نقطة البيع',
    platform: 'إدارة المنصة',
  },
  language: {
    label: 'اللغة',
    ar: 'العربية',
    en: 'English',
  },
  actions: {
    retry: 'إعادة المحاولة',
    signIn: 'تسجيل الدخول',
    signOut: 'تسجيل الخروج',
    back: 'رجوع',
    openMenu: 'فتح القائمة',
    closeMenu: 'إغلاق القائمة',
  },
  status: {
    loading: 'جارٍ التحميل…',
    apiOnline: 'الخادم متصل',
    apiDegraded: 'الخادم يعمل جزئياً',
    apiOffline: 'تعذّر الوصول إلى الخادم',
    apiChecking: 'جارٍ فحص الخادم…',
  },
  auth: {
    email: 'البريد الإلكتروني',
    password: 'كلمة المرور',
    signInUnavailableTitle: 'تسجيل الدخول غير متاح بعد',
    signInUnavailableBody:
      'حسابات المستخدمين والجلسات تُسلَّم في المرحلة M1. حتى ذلك الحين كل الصفحات المحمية مقفلة.',
    accessDenied: 'ليست لديك صلاحية لعرض هذه الصفحة.',
  },
  nav: {
    comingSoon: 'قريباً في {{milestone}}',
  },
  errors: {
    title: 'حدث خطأ ما',
    notFoundTitle: 'الصفحة غير موجودة',
    notFoundBody: 'الصفحة التي تبحث عنها غير موجودة.',
    requestId: 'رقم المرجع: {{id}}',
    UNAUTHENTICATED: 'يرجى تسجيل الدخول للمتابعة.',
    FORBIDDEN: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
    VALIDATION_FAILED: 'بعض الحقول غير صحيحة، يرجى مراجعتها.',
    NOT_FOUND: 'العنصر المطلوب غير موجود.',
    ROUTE_NOT_FOUND: 'العنوان المطلوب غير موجود.',
    CONFLICT: 'تم تعديل هذا السجل من مستخدم آخر. أعد التحميل وحاول مجدداً.',
    RATE_LIMITED: 'محاولات كثيرة. يرجى الانتظار ثم المحاولة.',
    SERVICE_UNAVAILABLE: 'الخدمة غير متاحة مؤقتاً.',
    NETWORK: 'تعذّر الاتصال بالخادم. تحقق من الاتصال.',
    UNKNOWN: 'حدث خطأ غير متوقع.',
  },
};
