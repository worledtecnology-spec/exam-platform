// =====================================================================
//  الطباعة الرسمية: كشف الدرجات + شهادات التفوق
// =====================================================================
import { esc, fmtDateTime, fmtTime, safeImg } from "./common.js";
import { pledgeClauses } from "./pledge.js";
import { deviceText } from "./device.js";
import { SETTINGS } from "./config.js";

const FONT = `<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">`;
const BASE = `*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"IBM Plex Sans Arabic","Cairo",sans-serif;color:#18213a;background:#fff}
.toolbar{position:fixed;bottom:14px;left:14px;display:flex;gap:8px;z-index:9}
.toolbar button{font:700 14px "Cairo",sans-serif;border:0;border-radius:999px;padding:10px 18px;cursor:pointer;background:#1b2d5c;color:#fff}
@media print{.toolbar{display:none}}`;

export function openPrint(title, css, body) {
  const w = window.open("", "_blank");
  if (!w) { alert("اسمح بالنوافذ المنبثقة لهذا الموقع لتتمكن من الطباعة."); return null; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>${FONT}<style>${BASE}${css}</style></head>
    <body><div class="toolbar"><button id="pPrint">🖨️ طباعة / حفظ PDF</button><button id="pClose" style="background:#69748f">إغلاق</button></div>${body}</body></html>`);
  w.document.close();
  // الأزرار تُربط من هنا (بدون أكواد داخل الصفحة) لتتوافق مع سياسة الأمان CSP
  w.document.getElementById("pPrint").onclick = () => w.print();
  w.document.getElementById("pClose").onclick = () => w.close();
  const go = () => setTimeout(() => { try { w.focus(); w.print(); } catch { } }, 500);
  (w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready.then(go) : go());
  return w;
}
const today = () => new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

// ------------------------------------------------------------- كشف الدرجات
export function printGradeSheet({ exam, rows, absent = [], group = "", owner = "" }) {
  const list = [
    ...rows.map(r => ({ seat: r.a.seat || "", name: r.a.name, group: r.a.group, s: r.s, t: r.t, pct: r.pct, grade: r.grade.label, color: r.grade.color, note: noteOf(r), failed: r.failed })),
    ...absent.map(s => ({ seat: s.seat, name: s.name, group: s.group, s: "—", t: "", pct: "—", grade: "غائب", color: "#69748f", note: "لم يحضر الاختبار", absent: true }))
  ].sort((x, y) => x.name.localeCompare(y.name, "ar", { sensitivity: "base" }));
  const present = rows.length, passed = rows.filter(r => !r.failed && r.pct >= (exam.passMark || 50)).length;
  const hasSeat = list.some(x => x.seat);
  const css = `@page{size:A4;margin:14mm 12mm}
  .head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:3px double #1b2d5c;padding-bottom:10px;margin-bottom:14px}
  .head .r{font-weight:700;line-height:1.8;font-size:13px}.head .l{text-align:left;font-size:12px;line-height:1.9;color:#333}
  .seal{width:74px;height:74px;border-radius:50%;border:2px solid #1b2d5c;display:grid;place-items:center;font:800 11px "Cairo";color:#1b2d5c;text-align:center;line-height:1.3}
  h1{font:800 22px "Cairo";text-align:center;color:#1b2d5c;margin:4px 0}
  .meta{display:flex;justify-content:center;gap:22px;flex-wrap:wrap;font-size:13px;margin-bottom:12px}.meta b{color:#1b2d5c}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{background:#1b2d5c;color:#fff;padding:7px 6px;font-weight:700;border:1px solid #1b2d5c}
  td{border:1px solid #b8c0cf;padding:6px;text-align:center}
  td.n{text-align:right;font-weight:600}
  tr:nth-child(even) td{background:#f5f7fb}
  tr.abs td{color:#69748f;font-style:italic}
  tr.fail td{background:#fff0f3!important}
  .sum{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin:12px 0;font-size:12.5px}
  .sum span{border:1px solid #cfd6e6;border-radius:8px;padding:5px 12px}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:34px;text-align:center;font-size:13px;font-weight:700;page-break-inside:avoid}
  .sign div{border-top:1px dashed #69748f;padding-top:6px}
  .stamp{margin:22px auto 0;width:110px;height:110px;border:2px dashed #b8c0cf;border-radius:50%;display:grid;place-items:center;color:#9aa3b8;font-size:12px}
  thead{display:table-header-group}tr{page-break-inside:avoid}`;
  const body = `
  <div class="head">
    <div class="r">${esc(SETTINGS.platformName)}<br>${esc(SETTINGS.department || "")}</div>
    <div class="seal">كشف<br>درجات<br>رسمي</div>
    <div class="l">التاريخ: ${today()}<br>${owner ? "أستاذ المقرر: " + esc(owner) : ""}</div>
  </div>
  <h1>كشف درجات اختبار: ${esc(exam.title)}</h1>
  <div class="meta"><span>المقرر: <b>${esc(exam.course)}</b></span>${group ? `<span>المجموعة: <b>${esc(group)}</b></span>` : ""}<span>الدرجة العظمى: <b>${rows[0]?.t ?? exam.totalPoints ?? ""}</b></span><span>درجة النجاح: <b>${exam.passMark || 50}%</b></span></div>
  <table><thead><tr><th>م</th>${hasSeat ? "<th>رقم الجلوس</th>" : ""}<th>اسم الطالب</th><th>المجموعة</th><th>الدرجة</th><th>النسبة</th><th>التقدير</th><th>ملاحظات</th></tr></thead><tbody>
  ${list.map((x, i) => `<tr class="${x.absent ? "abs" : ""} ${x.failed ? "fail" : ""}"><td>${i + 1}</td>${hasSeat ? `<td>${esc(x.seat)}</td>` : ""}<td class="n">${esc(x.name)}</td><td>${esc(x.group)}</td>
    <td><b>${x.s}</b>${x.t ? ` / ${x.t}` : ""}</td><td>${x.pct}${x.pct !== "—" ? "%" : ""}</td><td style="color:${x.color};font-weight:700">${esc(x.grade)}</td><td style="font-size:11px">${esc(x.note)}</td></tr>`).join("")}
  </tbody></table>
  <div class="sum"><span>عدد المقيدين: <b>${list.length}</b></span><span>الحاضرون: <b>${present}</b></span><span>الغائبون: <b>${absent.length}</b></span><span>الناجحون: <b>${passed}</b></span><span>الراسبون: <b>${present - passed}</b></span><span>نسبة النجاح: <b>${present ? Math.round(passed / present * 1000) / 10 : 0}%</b></span></div>
  <div class="sign"><div>أستاذ المقرر</div><div>رئيس القسم</div><div>وكيل الكلية لشئون التعليم والطلاب</div></div>
  <div class="stamp">خاتم الكلية</div>
  <p dir="ltr" style="text-align:center;font-size:10px;color:#9aa3b8;margin-top:14px">© 2026 All Rights Reserved — Designed &amp; Developed by Dr. Alaa Dawood</p>`;
  return openPrint(`كشف درجات — ${exam.course} — ${exam.title}`, css, body);
}
function noteOf(r) {
  if (r.failed) return "راسب بسبب تكرار الغش";
  const n = [];
  if (r.pending) n.push("لم يكتمل تصحيح المقالي");
  if ((r.a.restarts || 0) > 0) n.push("أُعيد بسبب مخالفة");
  else if (r.a.violationCount) n.push(`إنذار غش (${r.a.violationCount})`);
  if (r.a.status !== "submitted") n.push("لم يسلّم — انتهى الوقت");
  return n.join(" • ");
}

// ------------------------------------------------------------- شهادات التفوق
export function printCertificates({ exam, rows }) {
  if (!rows.length) { alert("لا يوجد طلاب متفوقون (85% فأكثر) في هذا الاختبار."); return; }
  const css = `@page{size:A4 landscape;margin:0}
  .cert{width:297mm;height:210mm;padding:12mm;page-break-after:always;position:relative;background:#fffdf7}
  .frame{position:absolute;inset:10mm;border:3px solid #1b2d5c;outline:1.5px solid #e8a530;outline-offset:-9px;border-radius:6px}
  .corner{position:absolute;width:70px;height:70px;border:3px solid #e8a530}
  .c1{top:16mm;right:16mm;border-left:0;border-bottom:0}.c2{top:16mm;left:16mm;border-right:0;border-bottom:0}
  .c3{bottom:16mm;right:16mm;border-left:0;border-top:0}.c4{bottom:16mm;left:16mm;border-right:0;border-top:0}
  .in{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 30mm}
  .inst{font:700 15px "Cairo";color:#1b2d5c;letter-spacing:.3px}
  .title{font:700 64px "Amiri",serif;color:#1b2d5c;margin:4mm 0 2mm;line-height:1.1}
  .title span{color:#c98a10}
  .lead{font-size:18px;color:#444;margin-top:2mm}
  .name{font:700 46px "Amiri",serif;color:#0d1b3d;margin:5mm 0 3mm;padding:0 14mm 2mm;border-bottom:2px solid #e8a530}
  .txt{font-size:18px;line-height:2;color:#333;max-width:210mm}
  .txt b{color:#1b2d5c}
  .medal{position:absolute;left:26mm;top:50%;transform:translateY(-50%)}
  .foot{display:flex;justify-content:space-between;width:100%;margin-top:12mm;font:700 15px "Cairo";color:#1b2d5c}
  .foot div{min-width:60mm;border-top:1.5px dashed #9aa3b8;padding-top:2mm}`;
  const medal = `<svg class="medal" width="120" height="170" viewBox="0 0 120 170"><path d="M30 0h22l18 60H48z" fill="#1b2d5c"/><path d="M90 0H68L50 60h22z" fill="#2a3f78"/>
    <circle cx="60" cy="110" r="52" fill="#e8a530"/><circle cx="60" cy="110" r="42" fill="#f6c766" stroke="#c98a10" stroke-width="3"/>
    <path d="M60 84l8 17 18 2-13 12 4 18-17-9-17 9 4-18-13-12 18-2z" fill="#fff"/></svg>`;
  const body = rows.map(r => `<div class="cert"><div class="frame"></div><div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div>
    ${medal}<div class="in">
      <div class="inst">${esc(SETTINGS.department || "")}</div>
      <div class="title">شهادة <span>تفوق</span></div>
      <div class="lead">يسعدنا أن نمنح هذه الشهادة إلى الطالب / الطالبة</div>
      <div class="name">${esc(r.a.name)}</div>
      <div class="txt">تقديرًا لتفوقه في اختبار <b>«${esc(exam.title)}»</b> بمقرر <b>«${esc(exam.course)}»</b><br>
        وحصوله على <b>${r.s}</b> من <b>${r.t}</b> درجة بنسبة <b>${r.pct}%</b> وتقدير <b>${esc(r.grade.label)}</b><br>متمنين له دوام التفوق والنجاح.</div>
      <div class="foot"><div>التاريخ: ${today()}</div><div>أستاذ المقرر</div><div>رئيس القسم</div></div>
    </div></div>`).join("");
  return openPrint(`شهادات التفوق — ${exam.title}`, css, body);
}

// ------------------------------------------------------------- محضر غش إلكتروني
const LVL = { record: "خرق مسجّل (خصم من الدرجة)", warn: "إنذار", restart: "غلق الاختبار ومسح الإجابات", fail: "غلق نهائي ورسوب" };
export function printCheatReport({ exam, a, evidence = [], owner = "" }) {
  const C = pledgeClauses(exam, SETTINGS.penalties);
  const V = (a.violations || []).slice().sort((x, y) => x.at - y.at);
  const F = (a.flags || []).slice().sort((x, y) => x.at - y.at);
  const shots = evidence.filter(e => (e.kind === "violation" || e.kind === "talk" || e.kind === "flag") && safeImg(e.img)).slice(0, 24);
  const no = `${(exam.id || "EX").slice(0, 6).toUpperCase()}-${String(a.id || "").slice(-6).toUpperCase()}`;
  const status = a.status === "locked" ? "غلق نهائي — راسب بسبب الغش" : a.restarts ? `أُعيد الاختبار ${a.restarts} مرة بسبب مخالفات` : V.length ? `${V.length} خرق مسجّل` : "لا توجد خروقات مسجلة";
  const css = `@page{size:A4;margin:13mm 12mm}
  .head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:3px double #8b1d2c;padding-bottom:10px;margin-bottom:12px}
  .head .r{font-weight:700;line-height:1.8;font-size:13px}.head .l{text-align:left;font-size:12px;line-height:1.9;color:#333}
  .seal{width:78px;height:78px;border-radius:50%;border:2px solid #8b1d2c;display:grid;place-items:center;font:800 11px "Cairo";color:#8b1d2c;text-align:center;line-height:1.3}
  h1{font:800 22px "Cairo";text-align:center;color:#8b1d2c;margin:2px 0 10px}
  h2{font:800 15px "Cairo";color:#1b2d5c;margin:14px 0 6px;border-right:4px solid #8b1d2c;padding-right:8px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{border:1px solid #b8c0cf;padding:6px 7px;text-align:right;vertical-align:top}
  th{background:#f1f3f8;color:#1b2d5c;width:22%}
  .vt th{background:#8b1d2c;color:#fff;width:auto;text-align:center}.vt td{text-align:center}.vt td.t{text-align:right}
  .pl{border:1px solid #e5d6a8;background:#fffdf5;border-radius:8px;padding:8px 12px;font-size:12px;line-height:1.8}
  .pl ol{margin:4px 0 0;padding-right:18px}.pl li{margin-bottom:3px}
  .ok{color:#0f7a4f;font-weight:700}.bad{color:#b4232c;font-weight:700}
  .shots{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .shots figure{margin:0;border:1px solid #b8c0cf;border-radius:6px;overflow:hidden;page-break-inside:avoid}
  .shots img{width:100%;display:block}.shots figcaption{font-size:9.5px;padding:3px 4px;background:#f6f7fb;line-height:1.4}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:30px;text-align:center;font-size:13px;font-weight:700;page-break-inside:avoid}
  .sign div{border-top:1px dashed #69748f;padding-top:6px}
  .note{font-size:11px;color:#555;margin-top:8px;line-height:1.7}`;
  const body = `
  <div class="head">
    <div class="r">${esc(SETTINGS.platformName)}<br>${esc(SETTINGS.department || "")}</div>
    <div class="seal">محضر<br>غش<br>إلكتروني</div>
    <div class="l">رقم المحضر: <b>${esc(no)}</b><br>تاريخ التحرير: ${today()}</div>
  </div>
  <h1>محضر إثبات حالة غش في اختبار إلكتروني</h1>
  <h2>أولًا: بيانات الاختبار والطالب</h2>
  <table>
    <tr><th>المقرر / الاختبار</th><td>${esc(exam.course || a.course)} — ${esc(exam.title || a.examTitle)}</td></tr>
    <tr><th>اسم الطالب</th><td><b>${esc(a.name)}</b></td></tr>
    <tr><th>المجموعة / رقم الجلوس</th><td>${esc(a.group)}${a.seat ? ` / ${esc(a.seat)}` : ""}</td></tr>
    <tr><th>بدء الاختبار / التسليم</th><td>${fmtDateTime(a.startedAtMs)} ← ${a.submittedAtMs ? fmtDateTime(a.submittedAtMs) : "لم يسلّم"}</td></tr>
    <tr><th>الجهاز المستخدم</th><td>${esc(a.device ? deviceText(a.device) : "—")}</td></tr>
    <tr><th>الموقع</th><td>${a.location ? `${esc(a.location.address || "")} (${a.location.lat}, ${a.location.lng})${a.geoDist != null ? ` — يبعد ${a.geoDist} م عن مركز الكلية` : ""}` : esc(a.locationError || "غير متاح")}</td></tr>
    <tr><th>الحالة النهائية</th><td class="${a.status === "locked" ? "bad" : ""}">${esc(status)}</td></tr>
    <tr><th>إجراء المشرف</th><td>${a.decision ? `<b>${esc(({ none: "لا إجراء", notice: "لفت نظر / تنبيه", deduct: `خصم ${a.decision.deduct} درجة`, retake: "إعادة الاختبار", fail: "اعتباره راسبًا (غش)", refer: "إحالة للتحقيق (محضر غش)" })[a.decision.type] || "")}</b>${a.decision.note ? ` — ${esc(a.decision.note)}` : ""}${a.decision.by ? ` <small>(${esc(a.decision.by)} — ${fmtDateTime(a.decision.at)})</small>` : ""}` : "لم يُحدد بعد"}</td></tr>
  </table>
  <h2>ثانيًا: إقرار الطالب (ميثاق الاختبار)</h2>
  <div class="pl">${a.pledge ? `<span class="ok">✍️ وقّع الطالب إلكترونيًا بالموافقة على ميثاق الاختبار</span> باسم «<b>${esc(a.pledge.name)}</b>» بتاريخ ${fmtDateTime(a.pledge.at)} (إصدار ${esc(a.pledge.v || "")})، وأقر بالبنود التالية:` : `<span class="bad">لا يوجد توقيع إلكتروني مسجل لهذه المحاولة.</span> بنود الميثاق المعمول به:`}
    <ol>${C.map(c => `<li><b>${esc(c.t)}:</b> ${c.d}</li>`).join("")}</ol></div>
  <h2>ثالثًا: المخالفات المرصودة (${V.length} محاولة غش)</h2>
  ${V.length ? `<table class="vt"><thead><tr><th>م</th><th>التوقيت</th><th>نوع المخالفة</th><th>الإجراء المتخذ</th></tr></thead><tbody>
    ${V.map((v, i) => `<tr><td>${i + 1}</td><td>${fmtTime(v.at)}</td><td class="t">${esc(v.type)}</td><td>${esc(LVL[v.level] || "")}</td></tr>`).join("")}</tbody></table>` : `<p class="ok">لم تُرصد محاولات غش.</p>`}
  ${F.length ? `<h2>رابعًا: مخالفات ثانوية (${F.length})</h2><table class="vt"><thead><tr><th>م</th><th>التوقيت</th><th>الملاحظة</th></tr></thead><tbody>
    ${F.slice(0, 60).map((f, i) => `<tr><td>${i + 1}</td><td>${fmtTime(f.at)}</td><td class="t">${esc(f.type)}</td></tr>`).join("")}</tbody></table>` : ""}
  <h2>${F.length ? "خامسًا" : "رابعًا"}: الأدلة المصوّرة (${shots.length})</h2>
  ${shots.length ? `<div class="shots">${shots.map(e => `<figure><img src="${esc(safeImg(e.img))}" alt=""><figcaption>${fmtTime(e.at)} — ${esc(e.type || "")}${e.audio ? " 🎙️ (يوجد تسجيل صوتي على المنصة)" : ""}</figcaption></figure>`).join("")}</div>` : `<p>لا توجد صور مسجلة.</p>`}
  <p class="note">حُرِّر هذا المحضر آليًا من سجلات ${esc(SETTINGS.platformName)}، والتوقيتات مسجلة لحظة وقوع كل مخالفة. التسجيلات الصوتية وباقي الأدلة محفوظة على المنصة ويمكن الرجوع إليها.${owner ? ` أستاذ المقرر: ${esc(owner)}.` : ""}</p>
  <div class="sign"><div>المراقب</div><div>أستاذ المقرر</div><div>رئيس الكنترول / وكيل الكلية</div></div>
  <p dir="ltr" style="text-align:center;font-size:10px;color:#9aa3b8;margin-top:14px">© 2026 All Rights Reserved — Designed &amp; Developed by Dr. Alaa Dawood</p>`;
  return openPrint(`محضر غش — ${a.name}`, css, body);
}

// ------------------------------------------------------------- قائمة الطلاب الذين سُجلت عليهم خروقات
export function printCheatersList({ exam, rows, owner = "" }) {
  const byExam = {};
  rows.forEach(r => { const k = r.a.examId; (byExam[k] = byExam[k] || { course: r.a.course, title: r.a.examTitle, list: [] }).list.push(r); });
  const css = `@page{size:A4 landscape;margin:12mm}
  .head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:3px double #8b1d2c;padding-bottom:10px;margin-bottom:12px}
  .head .r{font-weight:700;line-height:1.8;font-size:13px}.head .l{text-align:left;font-size:12px;line-height:1.9;color:#333}
  .seal{width:74px;height:74px;border-radius:50%;border:2px solid #8b1d2c;display:grid;place-items:center;font:800 11px "Cairo";color:#8b1d2c;text-align:center;line-height:1.3}
  h1{font:800 21px "Cairo";text-align:center;color:#8b1d2c;margin:2px 0 8px}
  h2{font:800 14px "Cairo";color:#1b2d5c;margin:14px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  th{background:#8b1d2c;color:#fff;padding:6px;border:1px solid #8b1d2c}
  td{border:1px solid #b8c0cf;padding:5px 6px;text-align:center;vertical-align:top}
  td.n{text-align:right;font-weight:700}td.t{text-align:right;font-size:10.5px;line-height:1.6}
  tr:nth-child(even) td{background:#f8f9fc}thead{display:table-header-group}tr{page-break-inside:avoid}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:28px;text-align:center;font-size:13px;font-weight:700;page-break-inside:avoid}
  .sign div{border-top:1px dashed #69748f;padding-top:6px}`;
  const body = `
  <div class="head"><div class="r">${esc(SETTINGS.platformName)}<br>${esc(SETTINGS.department || "")}</div><div class="seal">قائمة<br>الخروقات</div><div class="l">التاريخ: ${today()}<br>${owner ? "أستاذ المقرر: " + esc(owner) : ""}</div></div>
  <h1>قائمة الطلاب الذين سُجلت عليهم خروقات أثناء الاختبار</h1>
  ${Object.values(byExam).map(g => `<h2>📚 ${esc(g.course)} — ${esc(g.title)} (${g.list.length} طالب)</h2>
  <table><thead><tr><th>م</th><th>اسم الطالب</th><th>رقم الجلوس</th><th>المجموعة</th><th>عدد الخروقات</th><th style="width:38%">الخروقات المسجلة</th><th>الدرجة</th><th>الإجراء</th></tr></thead><tbody>
  ${g.list.map((r, i) => `<tr><td>${i + 1}</td><td class="n">${esc(r.a.name)}</td><td>${esc(r.a.seat || "—")}</td><td>${esc(r.a.group)}</td><td><b>${(r.a.violationCount || 0) + (r.a.history || []).reduce((s, h) => s + (h.violationCount || 0), 0)}</b>${(r.a.history || []).length ? `<br><small>أعاد ${r.a.history.length}</small>` : ""}</td>
    <td class="t">${[...(r.a.history || []).flatMap(h => (h.violations || []).map(v => ({ ...v, old: 1 }))), ...(r.a.violations || [])].sort((x, y) => x.at - y.at).map(v => `${fmtTime(v.at)} — ${esc(v.type)}${v.old ? " <i>(قبل الإعادة)</i>" : ""}`).join("<br>")}</td>
    <td>${r.sc ? `${r.sc.s} / ${r.sc.t}` : "—"}</td><td>${esc(r.dec || "")}</td></tr>`).join("")}</tbody></table>`).join("")}
  <div class="sign"><div>المراقب</div><div>أستاذ المقرر</div><div>رئيس الكنترول / وكيل الكلية</div></div>
  <p dir="ltr" style="text-align:center;font-size:10px;color:#9aa3b8;margin-top:14px">© 2026 All Rights Reserved — Designed &amp; Developed by Dr. Alaa Dawood</p>`;
  return openPrint("قائمة الطلاب — الخروقات", css, body);
}

// ------------------------------------------------------------- كشف الطلاب الملتزمين (سلّموا بدون أي إنذارات) — أبجديًا بالدرجات
// تجميع الصفوف حسب الاختبار (كل اختبار في جدول منفصل) — مرتبة أبجديًا داخل كل اختبار
function byExamGroups(rows) {
  const G = {};
  rows.forEach(r => { const k = r.a.examId || "-"; (G[k] = G[k] || { course: r.a.course, title: r.a.examTitle, list: [] }).list.push(r); });
  return Object.values(G).sort((x, y) => `${x.course} ${x.title}`.localeCompare(`${y.course} ${y.title}`, "ar"));
}
export function printCleanList({ title = "", rows, owner = "" }) {
  const css = `@page{size:A4;margin:13mm 12mm}
  .head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:3px double #0f7a4f;padding-bottom:10px;margin-bottom:12px}
  .head .r{font-weight:700;line-height:1.8;font-size:13px}.head .l{text-align:left;font-size:12px;line-height:1.9;color:#333}
  .seal{width:74px;height:74px;border-radius:50%;border:2px solid #0f7a4f;display:grid;place-items:center;font:800 11px "Cairo";color:#0f7a4f;text-align:center;line-height:1.3}
  h1{font:800 20px "Cairo";text-align:center;color:#0f7a4f;margin:2px 0 4px}.sub{text-align:center;margin-bottom:10px;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}th{background:#0f7a4f;color:#fff;padding:7px 6px;border:1px solid #0f7a4f}
  td{border:1px solid #b8c0cf;padding:6px;text-align:center}td.n{text-align:right;font-weight:700}tr:nth-child(even) td{background:#f4fbf7}
  thead{display:table-header-group}tr{page-break-inside:avoid}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:30px;text-align:center;font-size:13px;font-weight:700}.sign div{border-top:1px dashed #69748f;padding-top:6px}
  .exh{font:800 15px "Cairo";color:#0f7a4f;margin:14px 0 6px;border-right:5px solid #0f7a4f;padding-right:8px}.exh small{color:#555;font-weight:600}`;
  const body = `<div class="head"><div class="r">${esc(SETTINGS.platformName)}<br>${esc(SETTINGS.department || "")}</div><div class="seal">كشف<br>الملتزمين</div><div class="l">التاريخ: ${today()}<br>${owner ? "أستاذ المقرر: " + esc(owner) : ""}</div></div>
  <h1>كشف الطلاب الذين سلّموا الاختبار بدون أي إنذارات</h1><div class="sub">${esc(title)} — عدد الطلاب: <b>${rows.length}</b></div>
  ${byExamGroups(rows).map((G, gi, AG) => `${AG.length > 1 ? `<h2 class="exh"${gi ? ' style="page-break-before:always"' : ""}>📚 ${esc(G.course)} — ${esc(G.title)} <small>(${G.list.length} طالب)</small></h2>` : `<div class="sub">📚 ${esc(G.course)} — ${esc(G.title)}</div>`}
  <table><thead><tr><th>م</th><th>اسم الطالب</th><th>رقم الجلوس</th><th>المجموعة</th><th>الدرجة</th><th>النسبة</th><th>التقدير</th><th>وقت التسليم</th></tr></thead><tbody>
  ${G.list.map((r, i) => `<tr><td>${i + 1}</td><td class="n">${esc(r.a.name)}</td><td>${esc(r.a.seat || "—")}</td><td>${esc(r.a.group)}</td><td><b>${r.sc ? r.sc.s : "—"}</b>${r.sc ? ` / ${r.sc.t}` : ""}</td><td>${r.sc ? r.sc.pct + "%" : "—"}</td><td style="color:${r.g ? r.g.color : "#333"};font-weight:700">${esc(r.g ? r.g.label : "")}</td><td>${fmtDateTime(r.a.submittedAtMs)}</td></tr>`).join("")}
  </tbody></table>`).join("")}
  <div class="sign"><div>المراقب</div><div>أستاذ المقرر</div><div>رئيس الكنترول</div></div>
  <p dir="ltr" style="text-align:center;font-size:10px;color:#9aa3b8;margin-top:14px">© 2026 All Rights Reserved — Designed &amp; Developed by Dr. Alaa Dawood</p>`;
  return openPrint("كشف الطلاب الملتزمين", css, body);
}

// ------------------------------------------------------------- كشف المخالفين بالأدلة الكاملة — طالب في كل صفحة
export function printViolatorsReport({ title = "", rows, owner = "" }) {
  const css = `@page{size:A4;margin:11mm}
  .head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border-bottom:3px double #8b1d2c;padding-bottom:8px;margin-bottom:10px}
  .head .r{font-weight:700;line-height:1.7;font-size:12.5px}.head .l{text-align:left;font-size:11.5px;line-height:1.8;color:#333}
  .seal{width:70px;height:70px;border-radius:50%;border:2px solid #8b1d2c;display:grid;place-items:center;font:800 10.5px "Cairo";color:#8b1d2c;text-align:center;line-height:1.3}
  h1{font:800 19px "Cairo";text-align:center;color:#8b1d2c;margin:2px 0 6px}
  .idx{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:6px}.idx th{background:#8b1d2c;color:#fff;padding:5px;border:1px solid #8b1d2c}.idx td{border:1px solid #c9cfdc;padding:4px 6px;text-align:center}.idx td.n{text-align:right;font-weight:700}
  .st{page-break-before:always}.st h2{font:800 16px "Cairo";color:#1b2d5c;margin:0 0 6px;border-right:5px solid #8b1d2c;padding-right:8px}
  .kv{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 10px;font-size:11.5px;margin-bottom:6px}.kv div{background:#f4f6fb;border-radius:6px;padding:4px 7px}.kv b{color:#1b2d5c}
  .sug{border:2px solid #8b1d2c;border-radius:8px;padding:6px 10px;margin:6px 0;font-size:12.5px;background:#fff5f6}.sug.l0,.sug.l1{border-color:#b45309;background:#fffbeb}
  table.v{width:100%;border-collapse:collapse;font-size:11px}table.v th{background:#f1f3f8;color:#1b2d5c;padding:4px;border:1px solid #c9cfdc}table.v td{border:1px solid #c9cfdc;padding:3px 6px;text-align:right}
  .shots{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:6px}.shots figure{margin:0;border:1px solid #c9cfdc;border-radius:5px;overflow:hidden;page-break-inside:avoid}.shots img{width:100%;display:block}.shots figcaption{font-size:8.5px;padding:2px 4px;background:#f6f7fb;line-height:1.35}
  h3{font:800 12.5px "Cairo";color:#8b1d2c;margin:8px 0 4px}.muted{color:#69748f;font-size:11px}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:14px;text-align:center;font-size:11.5px;font-weight:700}.sign div{border-top:1px dashed #69748f;padding-top:5px}`;
  const LV = { record: "خرق مسجّل", warn: "إنذار", restart: "مسح وإعادة", fail: "رسوب" };
  const GR = byExamGroups(rows); const NO = new Map(); GR.forEach(g => g.list.forEach((r, k) => NO.set(r, k + 1))); rows = GR.flatMap(g => g.list); const multi = GR.length > 1;
  const body = `<div class="head"><div class="r">${esc(SETTINGS.platformName)}<br>${esc(SETTINGS.department || "")}</div><div class="seal">كشف<br>المخالفين<br>بالأدلة</div><div class="l">التاريخ: ${today()}<br>${owner ? "أستاذ المقرر: " + esc(owner) : ""}</div></div>
  <h1>كشف الطلاب المخالفين — الخروقات والأدلة والإجراء المقترح</h1><p class="muted" style="text-align:center">${esc(title)} — عدد الطلاب: <b>${rows.length}</b> (مرتب أبجديًا)</p>
  ${GR.map(G => `<h3 style="font-size:13.5px;color:#1b2d5c">📚 ${esc(G.course)} — ${esc(G.title)} (${G.list.length} طالب)</h3>
  <table class="idx"><thead><tr><th>م</th><th>اسم الطالب</th><th>الجلوس</th><th>المجموعة</th><th>الخروقات</th><th>ملاحظات</th><th>درجة ما أجاب عنه</th><th>مقترح المنصة</th><th>قرار المشرف</th></tr></thead><tbody>
  ${G.list.map((r, i) => `<tr><td>${i + 1}</td><td class="n">${esc(r.a.name)}</td><td>${esc(r.a.seat || "—")}</td><td>${esc(r.a.group)}</td><td><b>${r.V.length}</b></td><td>${r.F.length}</td><td>${r.sc ? `${r.sc.earned} / ${r.sc.t} (أجاب ${r.sc.answered}/${r.sc.n})` : "—"}</td><td>${esc(r.sug.t)}</td><td>${esc(r.dec || "لم يُحدد")}</td></tr>`).join("")}</tbody></table>`).join("")}
  ${rows.map((r, i) => `<section class="st">${multi ? `<div class="muted" style="margin-bottom:3px">📚 ${esc(r.a.course)} — ${esc(r.a.examTitle)}</div>` : ""}<h2>${NO.get(r) || i + 1}. ${esc(r.a.name)} ${r.sug.report ? "— 🧾 مطلوب تحرير محضر غش" : ""}</h2>
    <div class="kv"><div>الجلوس: <b>${esc(r.a.seat || "—")}</b></div><div>المجموعة: <b>${esc(r.a.group)}</b></div><div>المقرر: <b>${esc(r.a.course)}</b></div><div>الاختبار: <b>${esc(r.a.examTitle)}</b></div>
      <div>بدأ: <b>${fmtDateTime(r.a.startedAtMs)}</b></div><div>سلّم: <b>${r.a.submittedAtMs ? fmtDateTime(r.a.submittedAtMs) : "لم يسلّم"}</b></div><div>الجهاز: <b>${esc(r.dev || "—")}</b></div><div>الميثاق: <b>${r.a.pledge ? "وقّع ✓ " + fmtDateTime(r.a.pledge.at) : "—"}</b></div>
      <div>أجاب عن: <b>${r.sc ? `${r.sc.answered} من ${r.sc.n}` : "—"}</b></div><div>درجة ما أجاب عنه: <b>${r.sc ? `${r.sc.earned} / ${r.sc.t}` : "—"}</b></div><div>الدرجة بعد القرار: <b>${r.sc ? `${r.sc.s} / ${r.sc.t}` : "—"}</b></div><div>مرات الإعادة: <b>${(r.a.history || []).length}</b></div></div>
    <div class="sug l${r.sug.lvl}">💡 <b>مقترح المنصة:</b> ${esc(r.sug.t)} <span class="muted">(${esc(r.sug.why)})</span>${r.dec ? `<br>⚖️ <b>قرار المشرف:</b> ${esc(r.dec)}${r.a.decision && r.a.decision.note ? ` — ${esc(r.a.decision.note)}` : ""}` : ""}</div>
    <h3>🚨 الخروقات (${r.V.length})</h3>
    ${r.V.length ? `<table class="v"><thead><tr><th style="width:28px">م</th><th style="width:90px">التوقيت</th><th>الخرق</th></tr></thead><tbody>${r.V.map((v, k) => `<tr><td>${k + 1}</td><td>${fmtTime(v.at)}</td><td>${esc(v.type)}${v.old ? " <i class='muted'>(قبل الإعادة)</i>" : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">لا توجد خروقات — ملاحظات سلوك فقط.</p>`}
    ${r.F.length ? `<h3>👀 ملاحظات السلوك (${r.F.length})</h3><table class="v"><tbody>${r.F.slice(0, 40).map(f => `<tr><td style="width:90px">${fmtTime(f.at)}</td><td>${esc(String(f.type).replace(/^🔎\s*/, ""))}</td></tr>`).join("")}</tbody></table>` : ""}
    <h3>📷 الأدلة المصوّرة (${r.shots.length})</h3>
    ${r.shots.length ? `<div class="shots">${r.shots.map(e => `<figure><img src="${esc(safeImg(e.img))}" alt=""><figcaption>${fmtTime(e.at)} — ${esc(e.type || "")}${e.audio ? " 🎙️ تسجيل صوتي على المنصة" : ""}</figcaption></figure>`).join("")}</div>` : `<p class="muted">لا توجد صور.</p>`}
    <div class="sign"><div>المراقب</div><div>أستاذ المقرر</div><div>رئيس الكنترول</div></div></section>`).join("")}
  <p dir="ltr" style="text-align:center;font-size:10px;color:#9aa3b8;margin-top:14px">© 2026 All Rights Reserved — Designed &amp; Developed by Dr. Alaa Dawood</p>`;
  return openPrint("كشف المخالفين بالأدلة", css, body);
}
