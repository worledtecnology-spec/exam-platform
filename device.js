// =====================================================================
//  التعرّف على جهاز الطالب + المتصفح الآمن Safe Exam Browser (SEB)
// =====================================================================

// هل الطالب يفتح المنصة من داخل Safe Exam Browser؟ (SEB يضيف «SEB/» إلى هوية المتصفح)
export const inSEB = () => /\bSEB\b|SEB\//i.test(navigator.userAgent) || !!(window.SafeExamBrowser);

// نوع النظام من حيث دعم SEB: ويندوز وماك وآيباد/آيفون مدعومة — أندرويد وغيرها لا
export function osKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return "iphone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ipad";
  if (/Android/.test(ua)) return "android";
  if (/CrOS/.test(ua)) return "chromeos";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}
export const sebSupported = k => ["windows", "mac", "ipad", "iphone"].includes(k || osKind());

const OS_AR = { iphone: "آيفون (iOS)", ipad: "آيباد (iPadOS)", android: "أندرويد", windows: "ويندوز", mac: "ماك (macOS)", chromeos: "كروم بوك", linux: "لينكس", other: "غير معروف" };
const TYPE_AR = { mobile: "موبايل", tablet: "تابلت", desktop: "لابتوب / كمبيوتر" };
export const osLabel = k => OS_AR[k] || k || "—";
export const typeLabel = k => TYPE_AR[k] || k || "—";

function browserOf(ua) {
  const m = (re, n) => { const x = ua.match(re); return x ? `${n} ${x[1].split(".")[0]}` : null; };
  if (inSEB()) return m(/SEB\/([\d.]+)/, "Safe Exam Browser") || "Safe Exam Browser";
  return m(/Edg(?:A|iOS)?\/([\d.]+)/, "Edge") || m(/SamsungBrowser\/([\d.]+)/, "Samsung Internet") || m(/OPR\/([\d.]+)/, "Opera")
    || m(/CriOS\/([\d.]+)/, "Chrome") || m(/FxiOS\/([\d.]+)/, "Firefox") || m(/Firefox\/([\d.]+)/, "Firefox")
    || m(/Chrome\/([\d.]+)/, "Chrome") || m(/Version\/([\d.]+).*Safari/, "Safari") || "متصفح آخر";
}
function osVersion(ua, k) {
  let x;
  if (k === "android" && (x = ua.match(/Android ([\d.]+)/))) return x[1];
  if ((k === "iphone" || k === "ipad") && (x = ua.match(/OS (\d+[_\d]*) like Mac/))) return x[1].replace(/_/g, ".");
  if (k === "windows" && (x = ua.match(/Windows NT ([\d.]+)/))) return { "10.0": "10/11", "6.3": "8.1", "6.1": "7" }[x[1]] || x[1];
  if (k === "mac" && (x = ua.match(/Mac OS X ([\d_]+)/))) return x[1].replace(/_/g, ".");
  return "";
}

// يرجع وصفًا مختصرًا للجهاز يُحفظ مع محاولة الطالب ويظهر في التقارير
export async function deviceInfo() {
  const ua = navigator.userAgent, k = osKind();
  const touch = navigator.maxTouchPoints > 0;
  const minSide = Math.min(screen.width, screen.height);
  let type = k === "iphone" ? "mobile" : k === "ipad" ? "tablet"
    : k === "android" ? (/Mobile/.test(ua) ? "mobile" : "tablet")
      : touch && minSide < 600 ? "mobile" : "desktop";
  let model = k === "iphone" ? "iPhone" : k === "ipad" ? "iPad" : "";
  if (k === "android") { const x = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build|\))/); if (x && !/^K$/.test(x[1].trim())) model = x[1].trim(); }
  let ver = osVersion(ua, k);
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues(["model", "platformVersion"]);
      if (h.model) model = h.model;
      if (k === "windows" && h.platformVersion) ver = parseInt(h.platformVersion, 10) >= 13 ? "11" : "10";
      if (navigator.userAgentData.mobile === true && type === "desktop") type = "mobile";
    }
  } catch { /* غير متاح */ }
  return {
    os: k, osVer: ver, type, model: String(model).slice(0, 60), browser: browserOf(ua), seb: inSEB(),
    screen: `${screen.width}×${screen.height}`, ua: ua.slice(0, 280)
  };
}
export function deviceText(d) {
  if (!d) return "—";
  return [typeLabel(d.type), osLabel(d.os) + (d.osVer ? " " + d.osVer : ""), d.model, d.browser].filter(Boolean).join(" • ") + (d.seb ? " • 🔒 SEB" : "");
}

// رابط فتح المنصة داخل SEB: نفس رابط ملف الإعدادات لكن ببروتوكول sebs://
export function sebLink() {
  const base = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  return base.replace(/^https:/, "sebs:").replace(/^http:/, "seb:") + "seb/exam.seb";
}
export const SEB_DOWNLOAD = {
  windows: "https://safeexambrowser.org/download_en.html",
  mac: "https://safeexambrowser.org/download_en.html",
  ipad: "https://apps.apple.com/app/id1155002964",
  iphone: "https://apps.apple.com/app/id1155002964"
};
