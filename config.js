// =====================================================================
//  إعدادات المنصة — عدّل هذا الملف فقط
// =====================================================================

// 1) الصق هنا إعدادات مشروع Firebase الخاص بك
//    (Firebase Console ← Project settings ← Your apps ← Web app ← Config)
export const firebaseConfig = {
  apiKey: "AIzaSyAQt2JWnTEMaYX6RCyRWvzrxeLA8nQ1h7w",
  authDomain: "elctronictest.firebaseapp.com",
  projectId: "elctronictest",
  storageBucket: "elctronictest.firebasestorage.app",
  messagingSenderId: "627325144436",
  appId: "1:627325144436:web:617fb0e8cd3ecd7d657021"
};

// 2) المشرفون الرئيسيون: الـ UID (من Authentication ← Users) أو البريد — نفس المكتوب في firestore.rules
//    المشرف الرئيسي يرى كل شيء ويضيف المعلمين. المعلم يرى مواده فقط.
export const SUPER_ADMINS = ["dralaadawood@gmail.com", "W1OrqQiz3ZRJY0TDzIeYZHGWjkx2"];   // UID أو البريد

// 3) إعدادات عامة
export const SETTINGS = {
  platformName: "منصة الاختبارات الإلكترونية",
  department: "قسم تكنولوجيا التعليم والحاسب الآلي",
  // الشعارات: ضع الصور في مجلد assets بنفس الأسماء (PNG بخلفية شفافة أفضل)
  logoRight: "assets/logo-university.png",   // شعار الجامعة — يمين
  logoLeft: "assets/logo-faculty.png",       // شعار الكلية — يسار
  logoCenter: "assets/logo-department.png",  // شعار القسم — بجانب اسم المنصة
  groupsCount: 30,          // عدد المجموعات في القائمة المنسدلة (عند عدم استخدام كشف أسماء)

  // سلّم العقوبات: كل محاولة غش تنقل الطالب للخطوة التالية
  //   "warn"    = إنذار أحمر ويكمل الاختبار
  //   "restart" = إغلاق الاختبار ومسح كل إجاباته ثم يدخل من جديد ويبدأ من الأول
  //   "fail"    = غلق نهائي ورسوب في الاختبار (الدرجة صفر)
  penalties: ["warn", "restart", "fail"],

  requireLocation: true,    // لا يبدأ الطالب إلا بعد السماح بتحديد موقعه

  // موقع أداء الاختبار (يُفعَّل لكل اختبار من «داخل الكلية فقط»)
  // الإحداثيات والنطاق الافتراضيان — ويمكن تعديلهما لكل اختبار من لوحة المشرف
  geoFence: {
    name: "كلية التربية النوعية — جامعة الزقازيق",
    lat: 30.5952407,
    lng: 31.5102294,
    radius: 300,            // نصف قطر المنطقة المسموحة بالمتر حول المركز
    maxAccuracy: 500        // لو دقة تحديد موقع الطالب أسوأ من كذا متر يُطلب منه إعادة المحاولة
  },
  requireFullscreen: true,  // فتح الاختبار في وضع ملء الشاشة
  snapshotEveryMin: 2,      // صورة دورية من الكاميرا كل كم دقيقة
  blockMultiScreen: true,   // منع البدء إذا كانت هناك شاشة إضافية متصلة
  detectDevTools: true,     // رصد فتح أدوات المطوّر
  detectSplitScreen: true,  // رصد تصغير النافذة أو تقسيم الشاشة

  // كشف الوجه بالذكاء الاصطناعي (يعمل على جهاز الطالب نفسه — لا تُرسل الفيديوهات لأي خادم)
  faceAbsentSec: 8,         // غياب الوجه عن الكاميرا أكثر من كذا ثانية = محاولة غش
  faceMultiSec: 2,          // ظهور أكثر من وجه أكثر من كذا ثانية = محاولة غش
  faceAwaySec: 5,           // النظر بعيدًا عن الشاشة أكثر من كذا ثانية = مخالفة ثانوية (تُسجَّل كدليل)

  // إشعارات تيليجرام على الموبايل (اختياري) — الصق رابط Google Apps Script بعد نشر ملف telegram-relay.gs
  telegramRelayUrl: "",

  // حماية إضافية (اختياري): مفتاح reCAPTCHA v3 لتفعيل Firebase App Check — راجع دليل التشغيل
  appCheckSiteKey: ""
};
