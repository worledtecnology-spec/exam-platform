// =====================================================================
//  التقارير والتحليلات + قبلي/بعدي + تصدير SPSS
// =====================================================================
import { esc, fmtTime, LETTERS, num } from "./common.js";
import { SETTINGS } from "./config.js";
import { computeReport, computePrePost, GRADE_ORDER, GRADE_LABEL, GRADE_COLOR, isFinished } from "./analytics.js";
import { effectLabel } from "./stats.js";
import { TYPE_LABEL } from "./parser.js";
import { questionsOf } from "./scoring.js";
import { printGradeSheet, printCertificates } from "./print.js";
import { $, S, hooks, scoreOf, statusBadge, warnBadge, nflags, mapLink, byName, pctColor, timelineHtml, shotsHtml, loadEvidence, resultRow, RES_W, sheet, toast, safeName } from "./admin-shared.js";

let repTab = "overview", charts = [], pp = { pre: "", post: "", exp: null };
const fmtP = p => p == null ? "—" : p < 0.001 ? "< 0.001" : p;

export function initReports() {
  document.querySelectorAll("#repTabs button").forEach(b => b.onclick = () => {
    repTab = b.dataset.r;
    document.querySelectorAll("#repTabs button").forEach(x => x.classList.toggle("act", x === b));
    renderReports();
  });
  $("repExam").onchange = () => { $("repGroup").value = ""; renderReports(); };
  $("repGroup").onchange = renderReports;
  $("btnPrint").onclick = printAll;
  $("btnRepXlsx").onclick = exportExcel;
  $("btnGradeSheet").onclick = async () => { const R = await currentReport(); if (!R) return; printGradeSheet({ exam: R.exam, rows: R.rows, absent: R.absent, group: $("repGroup").value, owner: R.exam.ownerName || "" }); };
  $("btnCerts").onclick = async () => { const R = await currentReport(); if (R) printCertificates({ exam: R.exam, rows: R.top }); };
}

export async function currentReport() {
  const e = S.exams[$("repExam").value]; if (!e) return null;
  const A = Object.values(S.attempts).filter(a => a.examId === e.id);
  const roster = e.rosterId ? await hooks.getRoster(e.rosterId) : null;
  const groups = [...new Set([...A.map(a => String(a.group)), ...(roster || []).map(s => String(s.group))])].sort((x, y) => x.localeCompare(y, "ar", { numeric: true }));
  const gs = $("repGroup"), gv = gs.value;
  gs.innerHTML = `<option value="">كل المجموعات</option>` + groups.map(g => `<option value="${esc(g)}">مجموعة ${esc(g)}</option>`).join("");
  gs.value = groups.includes(gv) ? gv : "";
  return computeReport(e, S.keys[e.id] || { answers: {} }, A, { group: gs.value, roster });
}

export async function renderReports(all) {
  charts.forEach(c => c.destroy()); charts = [];
  const body = $("repBody");
  if (repTab === "prepost" && !all) { body.innerHTML = secPrePostShell(); bindPrePost(); return; }
  const R = await currentReport();
  if (!R) { body.innerHTML = `<div class="panel"><div class="empty"><div class="e-ic">📭</div>لا توجد اختبارات بعد</div></div>`; return; }
  const head = `<div class="print-head"><h2>${esc(SETTINGS.institution || "")}</h2><p>تقرير اختبار: <b>${esc(R.exam.course)} — ${esc(R.exam.title)}</b>${$("repGroup").value ? ` • مجموعة ${esc($("repGroup").value)}` : ""} • تاريخ التقرير: ${new Date().toLocaleDateString("ar-EG")}</p></div>`;
  const secs = { overview: secOverview, people: secPeople, items: secItems, groups: secGroups, cheat: secCheat };
  const list = all ? Object.keys(secs) : [repTab];
  const built = list.map(k => ({ k, ...secs[k](R) }));
  body.innerHTML = head + built.map(b => `<div class="rep-sec" id="sec-${b.k}">${b.html}</div>`).join("");
  built.forEach(b => b.after && b.after());
}

// ------------------------------------------------------------- نظرة عامة
function secOverview(R) {
  const s = R.stats, t = R.exam;
  const kpi = (v, l, c = "") => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  const rel = s.reliability, relTxt = rel == null ? (t.drawCount ? "غير متاح مع السحب العشوائي" : "يحتاج 5 طلاب على الأقل") : rel >= 0.8 ? "ثبات مرتفع" : rel >= 0.6 ? "ثبات مقبول" : "ثبات منخفض";
  const gmax = Math.max(1, ...Object.values(R.grades));
  const html = `
    <div class="kpis">
      ${kpi(s.n + (s.inProgress ? ` <small style="font-size:.9rem;color:var(--muted)">+${s.inProgress} جارٍ</small>` : ""), "طالب أدّى الاختبار")}
      ${R.absent.length || t.rosterId ? kpi(s.absent, "طالب غائب (من الكشف)", "bad") : ""}
      ${kpi(s.mean + "%", `متوسط الدرجات (${s.meanScore} من ${s.total})`, "gold")}
      ${kpi(s.passRate + "%", `نسبة النجاح (${s.passN} طالب)`, "ok")}
      ${kpi(s.n - s.passN, "طالب متعثر (راسب)", "bad")}
      ${kpi(s.max + "%", "أعلى درجة")}${kpi(s.min + "%", "أقل درجة")}
      ${kpi(s.median + "%", "الوسيط")}${kpi(s.sd, "الانحراف المعياري")}
      ${kpi(s.avgTime + " د", `متوسط زمن الأداء من ${t.duration} د`)}
      ${kpi(rel ?? "—", `معامل الثبات (ألفا/KR-20) — ${relTxt}`)}
      ${kpi(s.warned, "طالب حاول الغش", "bad")}${kpi(s.locked, "راسب بسبب الغش", "bad")}
      ${s.pending ? kpi(s.pending, "إجابة مقالية تنتظر التصحيح", "gold") : ""}
    </div>
    <div class="charts">
      <div class="panel"><div class="panel-h"><h3>توزيع الدرجات</h3><small style="color:var(--muted)">عدد الطلاب في كل فئة نسبة مئوية</small></div><div class="panel-b"><div class="chart-box"><canvas id="cHist"></canvas></div></div></div>
      <div class="panel"><div class="panel-h"><h3>التقديرات</h3></div><div class="panel-b"><div class="grade-bars">
        ${GRADE_ORDER.filter(g => g !== "x" || R.grades.x).map(g => { const n = R.grades[g];
          return `<div class="gb"><b>${GRADE_LABEL[g]}</b><div class="t"><i style="width:${n / gmax * 100}%;background:${GRADE_COLOR[g]}"></i></div><span>${n} (${s.n ? Math.round(n / s.n * 100) : 0}%)</span></div>`; }).join("")}
      </div>
      <div class="note-box" style="margin:1.2rem 0 0">📌 <b>قراءة سريعة:</b> ${insight(R)}</div></div></div>
    </div>`;
  return {
    html, after: () => {
      if (!window.Chart || !$("cHist")) return;
      charts.push(new Chart($("cHist"), {
        type: "bar",
        data: { labels: R.hist.map((_, i) => `${i * 10}–${i * 10 + 10}%`), datasets: [{ data: R.hist, backgroundColor: R.hist.map((_, i) => i * 10 >= 85 ? "#0f9d6e" : i * 10 >= (t.passMark || 50) ? "#2f6fe4" : "#d91f45"), borderRadius: 8 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
      }));
    }
  };
}
function insight(R) {
  const s = R.stats; if (!s.n) return "لم يُكمل أي طالب الاختبار بعد.";
  const parts = [s.mean >= 75 ? "مستوى الأداء العام مرتفع" : s.mean >= 60 ? "مستوى الأداء العام متوسط" : "مستوى الأداء العام منخفض ويحتاج إلى معالجة"];
  const hard = R.items.filter(i => i.seen && i.level.k === "hard").length, bad = R.items.filter(i => i.d != null && i.d < 0.2).length;
  if (hard) parts.push(`${hard} سؤال صعب (أقل من 35% أجابوه صحيحًا)`);
  if (bad) parts.push(`${bad} سؤال بمعامل تمييز ضعيف يُنصح بمراجعته`);
  if (s.absent) parts.push(`${s.absent} طالب غائب`);
  if (s.warned) parts.push(`${s.warned} طالب رُصدت له محاولات غش`);
  if (R.similar.length) parts.push(`${R.similar.length} حالة تشابه مريب في الإجابات`);
  if (s.pending) parts.push(`${s.pending} إجابة مقالية لم تُصحَّح بعد`);
  return parts.join("، ") + ".";
}

// ------------------------------------------------------------- المتفوقون والمتعثرون
const qCount = r => r.n || 0;
function rankList(rows, kind) {
  if (!rows.length) return `<div class="empty"><div class="e-ic">${kind === "top" ? "🏅" : "🎉"}</div>${kind === "top" ? "لا يوجد طلاب بنسبة 85% فأكثر" : "لا يوجد طلاب متعثرون"}</div>`;
  return rows.map((r, i) => `<div class="rank ${kind === "top" && i < 3 ? "g" + (i + 1) : ""}" style="cursor:pointer" data-act="detail" data-arg="${esc(r.a.id)}">
    <div class="n">${i + 1}</div>
    <div class="who"><b>${esc(r.a.name)}</b><small>مجموعة ${esc(r.a.group)}${r.a.seat ? " • جلوس " + esc(r.a.seat) : ""} • ${r.s}/${r.t} • ${r.timeMin} دقيقة • أجاب ${r.answered}/${qCount(r)}${r.a.violationCount ? ` • ⚠️ ${num(r.a.violationCount)}` : ""}</small></div>
    <div class="pc" style="color:${r.grade.color}">${r.failed ? "راسب" : r.pct + "%"}</div></div>`).join("");
}
function weakTopics(R) {
  const key = (S.keys[R.exam.id] || {}).answers || {};
  const cnt = R.exam.questions.map((q, i) => ({ i, c: R.weak.filter(r => r.per && r.per[q.id] && r.per[q.id].f < 1).length }));
  return cnt.filter(x => x.c).sort((x, y) => y.c - x.c).slice(0, 3).map(x => `س${x.i + 1}`).join("، ") || "—";
}
function secPeople(R) {
  const html = `<div class="people">
    <div class="panel"><div class="panel-h"><h3>🏆 المتفوقون (85% فأكثر)</h3><div class="toolbar"><span class="badge b-ok">${R.top.length} طالب</span><button class="btn ghost sm no-print" data-act="clickId" data-arg="btnCerts">🏅 طباعة الشهادات</button></div></div>${rankList(R.top, "top")}</div>
    <div class="panel"><div class="panel-h"><h3>📉 المتعثرون (أقل من ${R.stats.pass}%)</h3><span class="badge b-w2">${R.weak.length} طالب</span></div>
      ${R.weak.length ? `<div class="note-box" style="margin:1rem 1.25rem 0">الأسئلة الأكثر خطأً بين المتعثرين: ${weakTopics(R)} — يُنصح بإعادة شرحها لهم.</div>` : ""}
      ${rankList(R.weak, "weak")}</div>
  </div>
  ${R.absent.length ? `<div class="panel"><div class="panel-h"><h3>🚷 الغائبون (${R.absent.length})</h3><small style="color:var(--muted)">مقيدون في الكشف ولم يدخلوا الاختبار</small></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>م</th><th>رقم الجلوس</th><th>الاسم</th><th>المجموعة</th></tr></thead><tbody>
    ${R.absent.sort(byName).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.seat)}</td><td class="name">${esc(s.name)}</td><td>${esc(s.group)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
  <div class="panel"><div class="panel-h"><h3>📋 ترتيب جميع الطلاب حسب الدرجة</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>الترتيب</th><th>الطالب</th><th>المجموعة</th><th>الدرجة</th><th>النسبة</th><th>التقدير</th><th>الزمن</th><th>الغش</th></tr></thead><tbody>
  ${[...R.rows].sort((x, y) => y.pct - x.pct || x.timeMin - y.timeMin).map((r, i) => `<tr><td>${i + 1}</td><td class="name">${esc(r.a.name)}</td><td>${esc(r.a.group)}</td><td><span class="score">${r.s} <small>/ ${r.t}</small></span></td><td>${r.pct}%</td><td><b style="color:${r.grade.color}">${r.grade.label}</b></td><td>${r.timeMin} د</td><td>${warnBadge(r.a.violationCount)}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  return { html };
}

// ------------------------------------------------------------- تحليل الأسئلة
const OPT_COLORS = ["#2f6fe4", "#6b5fd6", "#d98a06", "#0aa6b8", "#c2410c", "#7c3aed"];
function secItems(R) {
  const html = `<div class="note-box">🧩 <b>معامل السهولة</b> = متوسط نسبة الصواب (أكبر من 0.75 سهل، 0.35–0.75 متوسط، أقل من 0.35 صعب). <b>معامل التمييز</b> = الفرق بين أداء أعلى 27% وأدنى 27% من الطلاب (0.4 فأكثر ممتاز، أقل من 0.2 يحتاج مراجعة). في شريط التوزيع: الأخضر هو الإجابة الصحيحة والرمادي من لم يُجب. إذا اكتشفت خطأً في مفتاح الإجابة اضغط <b>«تعديل المفتاح»</b> وسيُعاد التصحيح تلقائيًا.</div>
  <div class="panel"><div class="panel-h"><h3>تحليل ${R.items.length} سؤال</h3><button class="btn gold sm no-print" data-act="openKey" data-arg="${esc(R.exam.id)}">🔑 تعديل مفتاح الإجابة / إلغاء سؤال</button></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th style="min-width:240px">السؤال</th><th>النوع</th><th>عدد من عُرض عليهم</th><th>السهولة</th><th>المستوى</th><th>التمييز</th><th style="min-width:180px">توزيع الإجابات</th><th>ملاحظة</th></tr></thead><tbody>
  ${R.items.map(it => {
    const tot = Math.max(1, it.seen);
    const segs = it.isChoice ? it.dist.map((c, j) => c ? `<i style="width:${c / tot * 100}%;background:${j === it.correctIdx ? "#0f9d6e" : OPT_COLORS[j % 6]}" title="${LETTERS[j]}) ${esc(it.q.options[j])}: ${c}">${c / tot >= 0.12 ? LETTERS[j] : ""}</i>` : "").join("") + (it.none ? `<i style="width:${it.none / tot * 100}%;background:#b8c0cf" title="لم يُجب: ${it.none}"></i>` : "")
      : `<i style="width:${it.p * 100}%;background:#0f9d6e">${Math.round(it.p * 100)}%</i>`;
    const note = it.cancelled ? "⛔ ملغى من التصحيح" : it.pending ? `${it.pending} إجابة تنتظر التصحيح` : it.d != null && it.d < 0 ? "⚠️ الأضعف أجابوه أفضل — راجع المفتاح" : it.deadDistractors ? `${it.deadDistractors} بديل لم يختره أحد` : it.seen && it.level.k === "hard" ? "يحتاج إعادة شرح" : "";
    return `<tr style="${it.cancelled ? "opacity:.5" : ""}"><td>${it.n}</td><td>${esc(it.q.text.length > 110 ? it.q.text.slice(0, 110) + "…" : it.q.text)}</td><td><small>${TYPE_LABEL[it.q.type || "mcq"]}</small></td><td>${it.seen}</td>
      <td><b>${it.seen ? it.p : "—"}</b></td><td>${it.seen ? `<span class="diff d-${it.level.k}">${it.level.t}</span>` : "—"}</td><td><b>${it.d ?? "—"}</b><br><small style="color:var(--muted)">${it.dLabel}</small></td>
      <td><div class="dist">${it.seen ? segs : ""}</div></td><td><small style="color:var(--muted)">${note}</small></td></tr>`;
  }).join("")}</tbody></table></div></div>`;
  return { html };
}

// ------------------------------------------------------------- المجموعات
function secGroups(R) {
  const html = `<div class="charts"><div class="panel"><div class="panel-h"><h3>متوسط الدرجات ونسبة النجاح لكل مجموعة</h3></div><div class="panel-b"><div class="chart-box"><canvas id="cGroups"></canvas></div></div></div>
    <div class="panel"><div class="panel-h"><h3>ترتيب المجموعات</h3></div>${[...R.groups].sort((x, y) => y.mean - x.mean).map((g, i) => `<div class="rank ${i < 3 ? "g" + (i + 1) : ""}"><div class="n">${i + 1}</div><div class="who"><b>المجموعة ${esc(g.g)}</b><small>${g.n} طالب • نجاح ${g.passRate}%${g.warned ? ` • ⚠️ ${g.warned}` : ""}</small></div><div class="pc" style="color:${pctColor(g.mean)}">${g.mean}%</div></div>`).join("") || `<div class="empty">لا توجد بيانات</div>`}</div></div>
  <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>المجموعة</th><th>عدد الطلاب</th><th>المتوسط</th><th>أعلى</th><th>أقل</th><th>نسبة النجاح</th><th>الأول على المجموعة</th><th>محاولات غش</th></tr></thead><tbody>
  ${R.groups.map(g => `<tr><td class="name">${esc(g.g)}</td><td>${g.n}</td><td><b>${g.mean}%</b></td><td>${g.max}%</td><td>${g.min}%</td><td>${g.passRate}%</td><td>${esc(g.top?.a.name || "")} (${g.top?.pct}%)</td><td>${g.warned || "—"}</td></tr>`).join("")}
  </tbody></table></div></div>`;
  return {
    html, after: () => {
      if (!window.Chart || !$("cGroups")) return;
      charts.push(new Chart($("cGroups"), {
        type: "bar",
        data: { labels: R.groups.map(g => "م" + g.g), datasets: [{ label: "المتوسط %", data: R.groups.map(g => g.mean), backgroundColor: "#1b2d5c", borderRadius: 6 }, { label: "نسبة النجاح %", data: R.groups.map(g => g.passRate), backgroundColor: "#e8a530", borderRadius: 6 }] },
        options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
      }));
    }
  };
}

// ------------------------------------------------------------- الغش والأدلة
function secCheat(R) {
  const suspects = R.all.filter(a => R.risk[a.id].s > 0 && (a.violationCount || nflags(a) || a.status === "locked" || R.risk[a.id].s >= 20))
    .sort((x, y) => R.risk[y.id].s - R.risk[x.id].s);
  const html = `
    <div class="kpis">
      <div class="kpi bad"><div class="v">${R.stats.totalViolations}</div><div class="l">محاولة غش مرصودة</div></div>
      <div class="kpi bad"><div class="v">${R.stats.locked}</div><div class="l">راسب بسبب الغش (غلق نهائي)</div></div>
      <div class="kpi gold"><div class="v">${R.stats.restarted}</div><div class="l">أُغلق اختباره ومُسحت إجاباته</div></div>
      <div class="kpi gold"><div class="v">${R.all.reduce((s, a) => s + nflags(a), 0)}</div><div class="l">مخالفة ثانوية (نسخ، اختصارات، نظر بعيدًا…)</div></div>
      <div class="kpi"><div class="v">${R.similar.length}</div><div class="l">حالة تشابه مريب في الإجابات</div></div>
      <div class="kpi"><div class="v">${R.fast.length}</div><div class="l">تسليم سريع بشكل غير طبيعي</div></div>
    </div>
    ${R.similar.length ? `<div class="panel"><div class="panel-h"><h3>🔗 تشابه مريب في الإجابات (احتمال نقل)</h3></div>
      ${R.similar.slice(0, 30).map(s => `<div class="susp"><div class="si">🔗</div><div><b>${esc(s.x.a.name)} (م${esc(s.x.a.group)})</b> و <b>${esc(s.y.a.name)} (م${esc(s.y.a.group)})</b><br><small style="color:var(--muted)">نفس الإجابة في ${s.sim}% من الأسئلة، منها <b style="color:var(--danger)">${s.sameWrong} إجابات خاطئة متطابقة</b> — بدء الاختبار: ${fmtTime(s.x.a.startedAtMs)} و ${fmtTime(s.y.a.startedAtMs)}</small></div></div>`).join("")}</div>` : ""}
    ${R.fast.length ? `<div class="panel"><div class="panel-h"><h3>⚡ تسليم سريع بدرجة مرتفعة</h3></div>
      ${R.fast.map(r => `<div class="susp"><div class="si">⚡</div><div><b>${esc(r.a.name)} (م${esc(r.a.group)})</b><br><small style="color:var(--muted)">أنهى في ${r.timeMin} دقيقة من ${R.exam.duration} وحصل على ${r.pct}%</small></div></div>`).join("")}</div>` : ""}
    ${R.sameLoc.length ? `<div class="panel"><div class="panel-h"><h3>📍 أدّوا الاختبار من نفس المكان</h3><small style="color:var(--muted)">مفيد في الاختبارات عن بُعد فقط</small></div>
      ${R.sameLoc.slice(0, 20).map(p => `<div class="susp"><div class="si">📍</div><div><b>${esc(p.x.a.name)}</b> و <b>${esc(p.y.a.name)}</b><br><small style="color:var(--muted)">المسافة بينهما ≈ ${p.d} متر — <a href="${mapLink(p.x.a)}" target="_blank" rel="noopener">الخريطة</a></small></div></div>`).join("")}</div>` : ""}
    <h3 style="font-family:var(--display);color:var(--ink);margin:1.2rem 0 .8rem">🗂️ ملفات الطلاب المشتبه بهم بالأدلة (${suspects.length})</h3>
    ${suspects.length ? suspects.map(a => {
      const rk = R.risk[a.id], sc = scoreOf(a);
      return `<div class="cheat-card ${a.status === "locked" ? "locked" : ""}">
        <div class="ch"><div><b>${esc(a.name)}</b> <small style="color:var(--muted)">• مجموعة ${esc(a.group)}${a.seat ? " • جلوس " + esc(a.seat) : ""} • ${sc ? (sc.failed ? "راسب" : sc.pct + "%") : ""}</small><br>${statusBadge(a)} ${warnBadge(a.violationCount)} ${(a.restarts || 0) ? `<span class="badge b-w1">أُعيد ${num(a.restarts)}×</span>` : ""} ${nflags(a) ? `<span class="badge b-w1">${nflags(a)} ثانوية</span>` : ""}</div>
          <div class="risk"><span style="color:${rk.level.c}">درجة الاشتباه: ${rk.level.t}</span><div class="meter"><i style="width:${rk.s}%;background:${rk.level.c}"></i></div><span>${rk.s}</span></div>
          <button class="btn ghost sm no-print" data-act="detail" data-arg="${esc(a.id)}">التفاصيل</button></div>
        <div class="cb"><div><h4 style="margin-bottom:.6rem;color:var(--ink);font-size:.95rem">🕒 السجل الزمني</h4>${timelineHtml(a)}
          <p style="font-size:.8rem;color:var(--muted);margin-top:.6rem">📍 ${a.location ? esc(a.location.address || `${a.location.lat}, ${a.location.lng}`) : "بدون موقع"} • ${a.touch ? "📱" : "💻"} ${esc(a.screen || "")}${a.faceAI ? " • 🤖 كشف الوجه مفعّل" : ""}</p></div>
          <div><h4 style="margin-bottom:.6rem;color:var(--ink);font-size:.95rem">📷 الأدلة المصوّرة</h4><div class="ev-slot" data-id="${esc(a.id)}"><div class="spinner" style="width:26px;height:26px"></div></div></div></div>
      </div>`;
    }).join("") : `<div class="panel"><div class="empty"><div class="e-ic">🛡️</div>لم تُرصد أي محاولات غش في هذا الاختبار</div></div>`}`;
  return {
    html, after: () => document.querySelectorAll(".ev-slot").forEach(async el => { const list = await loadEvidence(el.dataset.id); el.innerHTML = shotsHtml(list); })
  };
}

// ------------------------------------------------------------- قبلي / بعدي (للبحث)
function secPrePostShell() {
  const E = Object.values(S.exams).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  if (!pp.post) pp.post = $("repExam").value || E[0]?.id || "";
  if (!pp.pre) pp.pre = E.find(e => e.id !== pp.post)?.id || "";
  const opt = sel => E.map(e => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.course)} — ${esc(e.title)}</option>`).join("");
  const groups = [...new Set(Object.values(S.attempts).filter(a => a.examId === pp.pre || a.examId === pp.post).map(a => String(a.group)))].sort((x, y) => x.localeCompare(y, "ar", { numeric: true }));
  if (!pp.exp) pp.exp = new Set(groups);
  return `<div class="panel"><div class="panel-h"><h3>🔬 مقارنة التطبيق القبلي والبعدي</h3><small style="color:var(--muted)">اختبار «ت» • حجم الأثر η² و d • نسبة الكسب المعدّل لبلاك</small></div>
    <div class="panel-b"><div class="grid2">
      <label class="field"><span>الاختبار القبلي</span><select class="input" id="ppPre">${opt(pp.pre)}</select></label>
      <label class="field"><span>الاختبار البعدي</span><select class="input" id="ppPost">${opt(pp.post)}</select></label></div>
      <div class="field"><span>المجموعات <b>التجريبية</b> (غير المحدد = ضابطة)</span><div class="chips-sel" id="ppGroups">${groups.map(g => `<label><input type="checkbox" value="${esc(g)}" ${pp.exp.has(g) ? "checked" : ""}>مجموعة ${esc(g)}</label>`).join("") || "<small style='color:var(--muted)'>لا توجد بيانات بعد</small>"}</div></div>
      <div class="note-box">يُطابَق الطالب بين الاختبارين برقم الجلوس (عند استخدام كشف الأسماء) أو بالاسم والمجموعة. الدرجات محسوبة كنسبة مئوية (من 100).</div>
      <div class="toolbar"><button class="btn primary" id="ppRun">📊 حساب النتائج</button><button class="btn ok" id="ppXlsx">⬇️ تصدير Excel / SPSS</button></div>
    </div></div><div id="ppOut"></div>`;
}
function bindPrePost() {
  $("ppPre").onchange = e => { pp.pre = e.target.value; pp.exp = null; renderReports(); };
  $("ppPost").onchange = e => { pp.post = e.target.value; pp.exp = null; renderReports(); };
  $("ppGroups").onchange = () => { pp.exp = new Set([...document.querySelectorAll("#ppGroups input:checked")].map(i => i.value)); };
  $("ppRun").onclick = runPrePost; $("ppXlsx").onclick = () => exportPrePost();
  if (pp.pre && pp.post && pp.pre !== pp.post) runPrePost();
}
function prePostData() {
  const a = S.exams[pp.pre], b = S.exams[pp.post];
  if (!a || !b || a.id === b.id) { toast("danger", "اختر اختبارين مختلفين", "الاختبار القبلي يجب أن يختلف عن البعدي."); return null; }
  return computePrePost(a, S.keys[a.id] || { answers: {} }, b, S.keys[b.id] || { answers: {} }, Object.values(S.attempts), pp.exp || new Set());
}
function runPrePost() {
  charts.forEach(c => c.destroy()); charts = [];
  const P = prePostData(); if (!P) return;
  const out = $("ppOut");
  if (!P.rows.length) { out.innerHTML = `<div class="panel"><div class="empty"><div class="e-ic">🔍</div>لا يوجد طلاب أدّوا الاختبارين معًا</div></div>`; return; }
  const sideRow = (lbl, x) => x.n ? `<tr><td class="name">${lbl}</td><td>${x.n}</td><td>${x.preMean} <small>(${x.preSd})</small></td><td>${x.postMean} <small>(${x.postSd})</small></td>
    <td class="big-num">${x.paired?.t ?? "—"}</td><td>${x.paired?.df ?? "—"}</td><td class="${x.paired?.p < 0.05 ? "sig-yes" : "sig-no"}"><b>${fmtP(x.paired?.p)}</b><br><small>${effectLabel.p(x.paired?.p)}</small></td>
    <td><b>${x.paired?.eta2 ?? "—"}</b><br><small>${effectLabel.eta2(x.paired?.eta2)}</small></td><td><b>${x.paired?.d ?? "—"}</b><br><small>${effectLabel.d(x.paired?.d)}</small></td><td><b>${x.black ?? "—"}</b><br><small>${effectLabel.black(x.black)}</small></td></tr>` : "";
  const btRow = (lbl, t) => t ? `<tr><td class="name">${lbl}</td><td>${t.m1}</td><td>${t.m2}</td><td class="big-num">${t.t ?? "—"}</td><td>${t.df}</td><td class="${t.p < 0.05 ? "sig-yes" : "sig-no"}"><b>${fmtP(t.p)}</b><br><small>${effectLabel.p(t.p)}</small></td><td><b>${t.eta2 ?? "—"}</b><br><small>${effectLabel.eta2(t.eta2)}</small></td><td><b>${t.d ?? "—"}</b></td></tr>` : "";
  out.innerHTML = `
    <div class="panel"><div class="panel-h"><h3>1️⃣ دلالة الفروق بين التطبيقين القبلي والبعدي (اختبار «ت» للعينات المرتبطة)</h3></div><div class="tbl-wrap"><table class="tbl res-table"><thead><tr><th>المجموعة</th><th>ن</th><th>قبلي م (ع)</th><th>بعدي م (ع)</th><th>قيمة «ت»</th><th>د.ح</th><th>الدلالة</th><th>η²</th><th>d (كوهين)</th><th>الكسب المعدّل (بلاك)</th></tr></thead><tbody>
      ${sideRow("التجريبية", P.exp)}${sideRow("الضابطة", P.ctl)}</tbody></table></div></div>
    ${P.exp.n >= 2 && P.ctl.n >= 2 ? `<div class="panel"><div class="panel-h"><h3>2️⃣ دلالة الفروق بين المجموعتين التجريبية والضابطة (اختبار «ت» لعينتين مستقلتين)</h3></div><div class="tbl-wrap"><table class="tbl res-table"><thead><tr><th>القياس</th><th>م التجريبية</th><th>م الضابطة</th><th>قيمة «ت»</th><th>د.ح</th><th>الدلالة</th><th>η²</th><th>d</th></tr></thead><tbody>
      ${btRow("القبلي (تكافؤ المجموعتين)", P.betweenPre)}${btRow("البعدي", P.betweenPost)}${btRow("الكسب (بعدي − قبلي)", P.betweenGain)}</tbody></table></div></div>` : ""}
    <div class="charts"><div class="panel"><div class="panel-h"><h3>متوسطات التطبيقين</h3></div><div class="panel-b"><div class="chart-box"><canvas id="cPP"></canvas></div></div></div>
      <div class="panel"><div class="panel-h"><h3>📝 الصياغة المقترحة للنتائج</h3></div><div class="panel-b" style="line-height:2;font-size:.95rem">${interpret(P)}</div></div></div>
    <div class="panel"><div class="panel-h"><h3>درجات الطلاب (${P.rows.length})</h3><small style="color:var(--muted)">${P.unmatched.pre || P.unmatched.post ? `غير مطابَقين: ${P.unmatched.pre} في القبلي، ${P.unmatched.post} في البعدي` : ""}</small></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>م</th><th>الطالب</th><th>المجموعة</th><th>النوع</th><th>القبلي %</th><th>البعدي %</th><th>الكسب</th></tr></thead><tbody>
      ${P.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="name">${esc(r.name)}</td><td>${esc(r.group)}</td><td>${r.cond === "exp" ? "تجريبية" : "ضابطة"}</td><td>${r.pre}</td><td>${r.post}</td><td style="color:${r.gain >= 0 ? "var(--ok)" : "var(--danger)"};font-weight:700">${r.gain > 0 ? "+" : ""}${r.gain}</td></tr>`).join("")}</tbody></table></div></div>`;
  if (window.Chart) {
    const ds = [];
    if (P.exp.n) ds.push({ label: "التجريبية", data: [P.exp.preMean, P.exp.postMean], backgroundColor: "#1b2d5c", borderRadius: 6 });
    if (P.ctl.n) ds.push({ label: "الضابطة", data: [P.ctl.preMean, P.ctl.postMean], backgroundColor: "#e8a530", borderRadius: 6 });
    charts.push(new Chart($("cPP"), { type: "bar", data: { labels: ["القبلي", "البعدي"], datasets: ds }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } } }));
  }
}
function interpret(P) {
  const out = [];
  const sideTxt = (lbl, x) => {
    if (!x.n || !x.paired) return;
    const p = x.paired, sig = p.p != null && p.p < 0.05;
    out.push(sig
      ? `توجد فروق ذات دلالة إحصائية عند مستوى (${p.p < 0.01 ? "0.01" : "0.05"}) بين متوسطي درجات المجموعة ${lbl} في التطبيقين القبلي (${x.preMean}) والبعدي (${x.postMean}) لصالح التطبيق ${x.postMean >= x.preMean ? "البعدي" : "القبلي"}، حيث بلغت قيمة «ت» (${p.t}) بدرجات حرية (${p.df})، وبلغ حجم الأثر (η² = ${p.eta2}) وهو حجم أثر ${effectLabel.eta2(p.eta2)}.`
      : `لا توجد فروق ذات دلالة إحصائية بين متوسطي درجات المجموعة ${lbl} في التطبيقين القبلي (${x.preMean}) والبعدي (${x.postMean})، حيث بلغت قيمة «ت» (${p.t ?? "—"}) وهي غير دالة.`);
    if (x.black != null) out.push(`وبلغت نسبة الكسب المعدّل لبلاك للمجموعة ${lbl} (${x.black})، ${x.black >= 1.2 ? "وهي أكبر من الحد الأدنى المقبول (1.2) مما يدل على الفاعلية" : "وهي أقل من الحد المقبول (1.2)"}.`);
  };
  sideTxt("التجريبية", P.exp); sideTxt("الضابطة", P.ctl);
  if (P.betweenPre) out.push(P.betweenPre.p >= 0.05 ? `ولا توجد فروق دالة بين المجموعتين في التطبيق القبلي (ت = ${P.betweenPre.t ?? "—"})، مما يشير إلى تكافؤ المجموعتين قبل التجربة.` : `⚠️ توجد فروق دالة بين المجموعتين في التطبيق القبلي (ت = ${P.betweenPre.t})، أي أن المجموعتين غير متكافئتين — يُنصح باستخدام تحليل التغاير (ANCOVA).`);
  if (P.betweenPost) out.push(P.betweenPost.p < 0.05 ? `كما توجد فروق دالة إحصائيًا بين المجموعتين في التطبيق البعدي لصالح المجموعة ${P.betweenPost.m1 >= P.betweenPost.m2 ? "التجريبية" : "الضابطة"} (ت = ${P.betweenPost.t}، η² = ${P.betweenPost.eta2}).` : `ولا توجد فروق دالة بين المجموعتين في التطبيق البعدي (ت = ${P.betweenPost.t ?? "—"}).`);
  return out.map(x => `<p style="margin-bottom:.6rem">${x}</p>`).join("") || "—";
}
function exportPrePost() {
  const P = prePostData(); if (!P) return;
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }, { RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sheet(P.rows.map((r, i) => ({ ID: i + 1, Seat: r.seat, Name: r.name, Group: r.group, Condition: r.cond === "exp" ? 1 : 2, Pre: r.pre, Post: r.post, Gain: r.gain })), [6, 10, 30, 8, 10, 8, 8, 8]), "SPSS");
  const sumRow = (lbl, x) => x.n ? [{ "البند": `المجموعة ${lbl}: ن`, "القيمة": x.n }, { "البند": "متوسط القبلي (ع)", "القيمة": `${x.preMean} (${x.preSd})` }, { "البند": "متوسط البعدي (ع)", "القيمة": `${x.postMean} (${x.postSd})` },
    { "البند": "قيمة ت (مرتبطة)", "القيمة": x.paired?.t }, { "البند": "د.ح", "القيمة": x.paired?.df }, { "البند": "الدلالة p", "القيمة": fmtP(x.paired?.p) }, { "البند": "η²", "القيمة": x.paired?.eta2 }, { "البند": "d كوهين", "القيمة": x.paired?.d }, { "البند": "الكسب المعدّل لبلاك", "القيمة": x.black }] : [];
  XLSX.utils.book_append_sheet(wb, sheet([...sumRow("التجريبية", P.exp), ...sumRow("الضابطة", P.ctl),
    ...(P.betweenPost ? [{ "البند": "ت مستقلة (البعدي)", "القيمة": P.betweenPost.t }, { "البند": "الدلالة p (البعدي)", "القيمة": fmtP(P.betweenPost.p) }, { "البند": "η² (البعدي)", "القيمة": P.betweenPost.eta2 }] : []),
    ...(P.betweenPre ? [{ "البند": "ت مستقلة (القبلي)", "القيمة": P.betweenPre.t }, { "البند": "الدلالة p (القبلي)", "القيمة": fmtP(P.betweenPre.p) }] : [])], [32, 20]), "النتائج الإحصائية");
  XLSX.writeFile(wb, `قبلي-بعدي-${safeName(S.exams[pp.post].title)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ------------------------------------------------------------- الطباعة وExcel
async function printAll() {
  await renderReports(true);
  await Promise.all([...document.querySelectorAll(".ev-slot")].map(el => loadEvidence(el.dataset.id).then(l => el.innerHTML = shotsHtml(l))));
  setTimeout(() => { window.print(); setTimeout(() => renderReports(), 500); }, 700);
}
async function exportExcel() {
  const R = await currentReport(); if (!R || !R.all.length) return toast("danger", "⚠️ لا توجد بيانات", "لا توجد نتائج لهذا الاختبار بعد.");
  const s = R.stats, wb = XLSX.utils.book_new(); wb.Workbook = { Views: Array(9).fill({ RTL: true }) };
  const statRows = [["المقرر", R.exam.course], ["الاختبار", R.exam.title], ["المجموعة", $("repGroup").value || "كل المجموعات"], ["تاريخ التقرير", new Date().toLocaleString("ar-EG")],
  ["عدد الطلاب", s.n], ["عدد الغائبين", s.absent], ["متوسط الدرجات %", s.mean], ["متوسط الدرجة", `${s.meanScore} من ${s.total}`], ["الوسيط %", s.median], ["الانحراف المعياري", s.sd], ["أعلى درجة %", s.max], ["أقل درجة %", s.min],
  ["درجة النجاح %", s.pass], ["عدد الناجحين", s.passN], ["نسبة النجاح %", s.passRate], ["عدد المتعثرين", s.n - s.passN], ["متوسط زمن الأداء (دقيقة)", s.avgTime], ["معامل الثبات (ألفا / KR-20)", s.reliability ?? "—"],
  ["طلاب حاولوا الغش", s.warned], ["راسبون بسبب الغش", s.locked], ["أُعيدت اختباراتهم بعد المسح", s.restarted], ["حالات تشابه مريب", R.similar.length],
  ...GRADE_ORDER.map(g => [`تقدير ${GRADE_LABEL[g]}`, R.grades[g]])].map(([k, v]) => ({ "البند": k, "القيمة": v }));
  XLSX.utils.book_append_sheet(wb, sheet(statRows, [32, 40]), "ملخص الأداء");
  XLSX.utils.book_append_sheet(wb, sheet([...R.all].sort(byName).map(resultRow), RES_W), "النتائج أبجديًا");
  const person = (r, i) => ({ "م": i + 1, "رقم الجلوس": r.a.seat || "", "اسم الطالب": r.a.name, "المجموعة": r.a.group, "الدرجة": r.s, "من": r.t, "النسبة %": r.pct, "التقدير": r.grade.label, "الزمن (دقيقة)": r.timeMin, "محاولات الغش": r.a.violationCount || 0 });
  XLSX.utils.book_append_sheet(wb, sheet(R.top.map(person), [6, 11, 28, 10, 8, 8, 10, 14, 12, 10]), "المتفوقون");
  XLSX.utils.book_append_sheet(wb, sheet(R.weak.map(person), [6, 11, 28, 10, 8, 8, 10, 14, 12, 10]), "المتعثرون");
  if (R.exam.rosterId) XLSX.utils.book_append_sheet(wb, sheet(R.absent.sort(byName).map((x, i) => ({ "م": i + 1, "رقم الجلوس": x.seat, "اسم الطالب": x.name, "المجموعة": x.group })), [6, 12, 30, 10]), "الغائبون");
  XLSX.utils.book_append_sheet(wb, sheet(R.items.map(it => ({
    "رقم السؤال": it.n, "السؤال": it.q.text, "النوع": TYPE_LABEL[it.q.type || "mcq"], "عُرض على": it.seen, "معامل السهولة": it.p, "المستوى": it.level.t, "معامل التمييز": it.d ?? "", "تقييم التمييز": it.dLabel, "ملغى": it.cancelled ? "نعم" : "",
    ...(it.isChoice ? Object.fromEntries(it.q.options.map((o, j) => [`اختار ${LETTERS[j]}`, it.dist[j] || 0])) : {}), "لم يُجب": it.none
  })), [10, 60, 14, 10, 12, 10, 12, 22, 8]), "تحليل الأسئلة");
  XLSX.utils.book_append_sheet(wb, sheet(R.groups.map(g => ({ "المجموعة": g.g, "عدد الطلاب": g.n, "المتوسط %": g.mean, "أعلى %": g.max, "أقل %": g.min, "نسبة النجاح %": g.passRate, "الأول": g.top?.a.name, "محاولات غش": g.warned })), [10, 12, 12, 10, 10, 14, 28, 12]), "المجموعات");
  const cheatRows = [];
  R.all.forEach(a => {
    (a.violations || []).forEach(v => cheatRows.push({ "اسم الطالب": a.name, "المجموعة": a.group, "النوع": "محاولة غش", "الوصف": v.type, "العقوبة": { warn: "إنذار", restart: "إغلاق ومسح الإجابات", fail: "غلق نهائي ورسوب" }[v.level] || "", "الوقت": fmtTime(v.at), "_t": v.at, "درجة الاشتباه": R.risk[a.id].s }));
    (a.flags || []).forEach(v => cheatRows.push({ "اسم الطالب": a.name, "المجموعة": a.group, "النوع": "مخالفة ثانوية", "الوصف": v.type, "العقوبة": "", "الوقت": fmtTime(v.at), "_t": v.at, "درجة الاشتباه": R.risk[a.id].s }));
  });
  R.similar.forEach(x => cheatRows.push({ "اسم الطالب": `${x.x.a.name} ↔ ${x.y.a.name}`, "المجموعة": `${x.x.a.group} / ${x.y.a.group}`, "النوع": "تشابه إجابات", "الوصف": `تطابق ${x.sim}% منها ${x.sameWrong} إجابات خاطئة متطابقة`, "العقوبة": "", "الوقت": "", "_t": 0, "درجة الاشتباه": "" }));
  cheatRows.sort((x, y) => x["اسم الطالب"].localeCompare(y["اسم الطالب"], "ar") || x._t - y._t).forEach(r => delete r._t);
  XLSX.utils.book_append_sheet(wb, sheet(cheatRows, [30, 12, 16, 55, 20, 14, 12]), "سجل الغش");
  // مصفوفة SPSS: درجة كل طالب في كل سؤال (0 → 1)
  const Q = R.exam.questions;
  XLSX.utils.book_append_sheet(wb, sheet([...R.rows].sort((x, y) => byName(x.a, y.a)).map((r, i) => {
    const o = { ID: i + 1, Seat: r.a.seat || "", Name: r.a.name, Group: r.a.group, Failed: r.failed ? 1 : 0 };
    Q.forEach((q, j) => { o["Q" + (j + 1)] = r.per && r.per[q.id] ? Math.round(r.per[q.id].f * 100) / 100 : ""; });
    o.Total = r.s; o.Percent = r.pct; return o;
  }), [6, 10, 28, 8, 8]), "SPSS");
  XLSX.writeFile(wb, `تقرير-شامل-${safeName(R.exam.course + "-" + R.exam.title)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
