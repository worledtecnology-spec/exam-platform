// =====================================================================
//  الحالة والأدوات المشتركة بين ملفات لوحة المشرف
// =====================================================================
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc, fmtDateTime, fmtTime, num, safeImg } from "./common.js";
import { scoreAttempt } from "./scoring.js";
import { gradeOf, isExpired } from "./analytics.js";

export const $ = id => document.getElementById(id);
export const S = {
  db: null, auth: null, me: { email: "", isSuper: false, name: "", tgChat: "" },
  exams: {}, keys: {}, attempts: {}, rosters: {}, rosterStudents: {}, staff: {}, evCache: {}
};
export const hooks = {}; // detail, openKey, getRoster ... (تُعرَّف في admin.js)

export const scoreOf = a => scoreAttempt(a, S.exams[a.examId], S.keys[a.examId]);
export const passOf = a => S.exams[a.examId]?.passMark || 50;
export const nflags = a => num(a.flagCount) || (Array.isArray(a.flags) ? a.flags.length : 0);
export const pctColor = p => p >= 85 ? "var(--ok)" : p >= 65 ? "var(--info)" : p >= 50 ? "var(--warn)" : "var(--danger)";
export const mapLink = a => a.location && Number.isFinite(+a.location.lat) && Number.isFinite(+a.location.lng) ? `https://www.google.com/maps?q=${+a.location.lat},${+a.location.lng}` : "";
export const byName = (x, y) => (x.name || "").localeCompare(y.name || "", "ar", { sensitivity: "base" }) || String(x.group).localeCompare(String(y.group), "ar", { numeric: true });
export const gradeFor = a => { const sc = scoreOf(a); return sc ? gradeOf(sc.pct, passOf(a), sc.failed) : null; };

export function statusBadge(a) {
  if (a.status === "locked") return `<span class="badge b-lock">⛔ راسب (غش)</span>`;
  if (a.status === "submitted") return `<span class="badge b-ok">✓ تم التسليم</span>`;
  if (isExpired(a)) return `<span class="badge b-exp">⌛ انتهى الوقت</span>`;
  if (a.status === "suspended") return `<span class="badge b-w2">🗑 أُغلق ومُسحت إجاباته</span>`;
  return `<span class="badge b-run">● جارٍ الآن</span>`;
}
export function statusText(a) {
  return a.status === "locked" ? "راسب — غلق نهائي بسبب الغش" : a.status === "submitted" ? (a.endedByAdmin ? "أنهاه المراقب" : a.autoSubmitted ? "تم التسليم (انتهاء الوقت)" : "تم التسليم")
    : isExpired(a) ? "انتهى الوقت دون تسليم" : a.status === "suspended" ? "موقوف — مُسحت إجاباته" : "جارٍ الآن";
}
export function warnBadge(n) { n = num(n); return `<span class="badge b-w${Math.min(n, 2)}">${n ? "⚠️ " + n : "—"}</span>`; }

export function toast(kind, title, body, ms = 4500) {
  const ic = { danger: "🚨", lock: "⛔", ok: "✅", info: "🟢", warn: "⏳" }[kind] || "ℹ️";
  const t = document.createElement("div"); t.className = "toast " + (kind === "warn" ? "danger" : kind);
  t.innerHTML = `<div class="ti">${ic}</div><div><b>${esc(String(title).replace(/^[^؀-ۿA-Za-z0-9]+\s/, ""))}</b><small>${esc(body).replace(/\n/g, "<br>")}</small></div><button class="x">✕</button>`;
  t.querySelector(".x").onclick = () => t.remove();
  $("toasts").prepend(t);
  if (ms) setTimeout(() => t.remove(), ms);
  while ($("toasts").children.length > 5) $("toasts").lastChild.remove();
}

// ---- الأدلة المصوّرة
export async function loadEvidence(id) {
  if (S.evCache[id]) return S.evCache[id];
  try {
    const s = await getDocs(collection(S.db, "attempts", id, "evidence"));
    S.evCache[id] = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => x.at - y.at);
  } catch (e) { console.error(e); S.evCache[id] = []; }
  return S.evCache[id];
}
const KIND = { start: "بداية الاختبار", periodic: "صورة دورية", violation: "لحظة المخالفة", end: "نهاية الاختبار" };
export function shotsHtml(list) {
  if (!list.length) return `<p style="color:var(--faint);font-size:.88rem">لا توجد صور (الكاميرا غير مفعّلة لهذا الاختبار)</p>`;
  list = list.filter(e => safeImg(e.img));
  if (!list.length) return `<p style="color:var(--faint);font-size:.88rem">لا توجد صور صالحة</p>`;
  return `<div class="shots">${list.map(e => `<div class="shot ${e.kind === "violation" ? "v" : ""} ${e.dark ? "dark" : ""}" data-act="zoom" data-this="1" data-cap="${esc((KIND[e.kind] || "") + (e.type && e.kind === "violation" ? " — " + e.type : "") + " • " + fmtTime(e.at))}">
    <img src="${esc(safeImg(e.img))}" alt="" loading="lazy"><span>${e.kind === "violation" ? "🚨 " : ""}${esc(KIND[e.kind] || "")}<br>${fmtTime(e.at)}</span></div>`).join("")}</div>`;
}
window.__zoom = el => {
  const lb = document.createElement("div"); lb.className = "lightbox";
  lb.innerHTML = `<div><img src="${esc(safeImg(el.querySelector("img").getAttribute("src")))}"><p>${esc(el.dataset.cap)}</p></div>`;
  lb.onclick = () => lb.remove(); document.body.appendChild(lb);
};
const LVL = { warn: "إنذار أول", restart: "إغلاق ومسح الإجابات", fail: "غلق نهائي ورسوب" };
export function timelineHtml(a) {
  const ev = [{ at: a.startedAtMs, t: "بدأ الاختبار", c: "s" },
  ...(a.violations || []).map(v => ({ at: v.at, t: `🚨 ${v.type}${v.level ? ` ← ${LVL[v.level] || ""}` : ""}`, c: "v" })),
  ...(a.flags || []).map(f => ({ at: f.at, t: f.type, c: "" })),
  a.resumeReq ? { at: a.resumeReq, t: "⏳ طلب العودة للاختبار", c: "s" } : null,
  a.submittedAtMs ? { at: a.submittedAtMs, t: a.status === "locked" ? "⛔ غلق نهائي — راسب" : a.endedByAdmin ? "أنهاه المراقب" : "تم التسليم", c: a.status === "locked" ? "v" : "s" } : null].filter(Boolean).sort((x, y) => x.at - y.at);
  return `<ul class="tl">${ev.map(e => `<li class="${e.c}"><time>${fmtTime(e.at)}</time>${esc(e.t)}</li>`).join("")}</ul>`;
}

// ---- Excel
export function resultRow(a, i) {
  const sc = scoreOf(a) || { s: "", t: "", pct: "" };
  const g = sc.pct === "" ? null : gradeOf(sc.pct, passOf(a), sc.failed);
  return {
    "م": i + 1, "رقم الجلوس": a.seat || "", "اسم الطالب": a.name, "رقم المجموعة": a.group, "المقرر": a.course, "الاختبار": a.examTitle,
    "الدرجة": sc.s, "الدرجة العظمى": sc.t, "النسبة %": sc.pct, "التقدير": g ? g.label : "",
    "عدد الأسئلة المُجاب عنها": Object.keys(a.answers || {}).length,
    "الحالة": statusText(a), "عدد محاولات الغش": a.violationCount || 0, "مرات إعادة الاختبار": a.restarts || 0, "مخالفات ثانوية": nflags(a),
    "تفاصيل محاولات الغش": (a.violations || []).map(v => `${fmtTime(v.at)}: ${v.type}`).join(" | "),
    "الموقع": a.location ? (a.location.address || `${a.location.lat}, ${a.location.lng}`) : (a.locationError || "غير متاح"),
    "رابط الخريطة": mapLink(a), "وقت البدء": fmtDateTime(a.startedAtMs), "وقت التسليم": fmtDateTime(a.submittedAtMs)
  };
}
export const RES_W = [5, 11, 28, 10, 20, 20, 8, 10, 9, 14, 12, 22, 10, 10, 10, 50, 40, 36, 18, 18];
export function sheet(rows, widths) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "—": "لا توجد بيانات" }]);
  if (widths) ws["!cols"] = widths.map(w => ({ wch: w }));
  if (rows.length) ws["!autofilter"] = { ref: ws["!ref"] };
  return ws;
}
export const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, "-");

// ---- معالج نقرات موحّد بدل onclick داخل HTML (يمنع حقن الأكواد ويسمح بسياسة CSP صارمة)
window.__noop = () => { };
window.__select = el => el.select();
window.__clickId = id => document.getElementById(id)?.click();
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const fn = window["__" + el.dataset.act];
  if (typeof fn === "function") fn(el.dataset.this ? el : el.dataset.arg);
});
