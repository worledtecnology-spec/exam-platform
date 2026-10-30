// =====================================================================
//  الطباعة الرسمية: كشف الدرجات + شهادات التفوق
// =====================================================================
import { esc } from "./common.js";
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
    <div class="r">${esc(SETTINGS.institution || "")}<br>${esc(SETTINGS.department || "")}</div>
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
      <div class="inst">${esc(SETTINGS.institution || "")}${SETTINGS.department ? " — " + esc(SETTINGS.department) : ""}</div>
      <div class="title">شهادة <span>تفوق</span></div>
      <div class="lead">يسعدنا أن نمنح هذه الشهادة إلى الطالب / الطالبة</div>
      <div class="name">${esc(r.a.name)}</div>
      <div class="txt">تقديرًا لتفوقه في اختبار <b>«${esc(exam.title)}»</b> بمقرر <b>«${esc(exam.course)}»</b><br>
        وحصوله على <b>${r.s}</b> من <b>${r.t}</b> درجة بنسبة <b>${r.pct}%</b> وتقدير <b>${esc(r.grade.label)}</b><br>متمنين له دوام التفوق والنجاح.</div>
      <div class="foot"><div>التاريخ: ${today()}</div><div>أستاذ المقرر</div><div>رئيس القسم</div></div>
    </div></div>`).join("");
  return openPrint(`شهادات التفوق — ${exam.title}`, css, body);
}
