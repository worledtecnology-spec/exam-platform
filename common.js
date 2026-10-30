// أدوات مشتركة بين صفحة الطالب ولوحة الأدمن
export const FB = "https://www.gstatic.com/firebasejs/10.12.2";

export function isConfigured(cfg) {
  return !!(cfg && cfg.apiKey && !/ضع|xxxx/.test(cfg.apiKey) && cfg.projectId && cfg.projectId !== "your-project");
}

// توحيد الاسم العربي لمنع الدخول المكرر بتغيير الهمزات أو المسافات
export function normalizeName(s) {
  return String(s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/\s+/g, " ").trim().toLowerCase();
}

export function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function seededShuffle(arr, seedStr) {
  let s = parseInt(hashStr(seedStr).slice(0, 7), 36) || 1;
  const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem("qz_device");
    if (!id) { id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem("qz_device", id); }
    return id;
  } catch { return "nostore-" + hashStr(navigator.userAgent + screen.width + "x" + screen.height); }
}

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function fmtDateTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = n => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
export const LETTERS = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];

// ---- الأمان
// منع تضمين المنصة داخل موقع آخر (Clickjacking)
export function frameGuard() {
  if (window.top !== window.self) {
    try { window.top.location = window.self.location.href; } catch { document.documentElement.innerHTML = ""; }
  }
}
// Firebase App Check (اختياري) — يمنع أي برنامج غير موقعك من استخدام قاعدة البيانات
export async function initAppCheck(app, siteKey) {
  if (!siteKey) return;
  try {
    const m = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js");
    m.initializeAppCheck(app, { provider: new m.ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
  } catch (e) { console.warn("App Check", e); }
}
// تنظيف المعرّفات قبل وضعها في الصفحة
export const sid = s => String(s ?? "").replace(/[^A-Za-z0-9_\-]/g, "");
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const safeImg = s => typeof s === "string" && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : "";

// ---- الهوية: الاسم والقسم والشعارين
export function brandHtml(S, cls = "") {
  const logo = (src, side, alt) => `<div class="brand-logo ${side}"><img src="${esc(src || "")}" alt="${alt}"><span class="logo-ph">${alt}</span></div>`;
  return `<div class="brand-bar ${cls}">${logo(S.logoRight, "r", "شعار الجامعة")}<div class="brand-mid">${S.logoCenter ? `<img class="dept-logo" src="${esc(S.logoCenter)}" alt="">` : ""}<div class="bm-txt"><h1>${esc(S.platformName)}</h1>${S.department ? `<p>${esc(S.department)}</p>` : ""}</div></div>${logo(S.logoLeft, "l", "شعار الكلية")}</div>`;
}
// إظهار مكان بديل لو صورة الشعار غير موجودة (بدون أكواد داخل الصفحة لتوافق CSP)
export function wireLogos(root = document) {
  root.querySelectorAll(".brand-logo img").forEach(img => {
    const fail = () => img.closest(".brand-logo").classList.add("missing");
    if (!img.getAttribute("src")) return fail();
    img.addEventListener("error", fail, { once: true });
    if (img.complete && !img.naturalWidth) fail();
  });
}

// المسافة بين نقطتين بالمتر
export function distanceM(a, b) {
  const R = 6371000, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// هل الطالب داخل نطاق المكان المحدد؟
export function geoCheck(loc, fence, maxAcc = 500) {
  if (!loc) return { ok: false, reason: "noloc" };
  const d = Math.round(distanceM(loc, fence));
  if (loc.accuracy > maxAcc) return { ok: false, reason: "inaccurate", d };
  const ok = d <= fence.radius + Math.min(loc.accuracy || 0, 100);
  return { ok, reason: ok ? "" : "far", d };
}
