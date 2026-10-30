// =====================================================================
//  التحليلات والتقارير (بدون واجهة)
// =====================================================================
import { scoreAttempt, questionsOf } from "./scoring.js";
import { mean, median, sdPop, round, cronbachAlpha, pairedT, indepT, blackGain } from "./stats.js";

export function gradeOf(pct, pass = 50, failed = false) {
  if (failed) return { key: "x", label: "راسب (غش)", color: "#9b1030" };
  if (pct == null) return { key: "na", label: "—", color: "#9aa3b8" };
  if (pct >= 85) return { key: "a", label: "ممتاز", color: "#0f9d6e" };
  if (pct >= 75) return { key: "b", label: "جيد جدًا", color: "#2f6fe4" };
  if (pct >= 65) return { key: "c", label: "جيد", color: "#6b5fd6" };
  if (pct >= pass) return { key: "d", label: "مقبول", color: "#d98a06" };
  return { key: "f", label: "ضعيف (راسب)", color: "#d91f45" };
}
export const GRADE_ORDER = ["a", "b", "c", "d", "f", "x"];
export const GRADE_LABEL = { a: "ممتاز", b: "جيد جدًا", c: "جيد", d: "مقبول", f: "ضعيف (راسب)", x: "راسب بسبب الغش" };
export const GRADE_COLOR = { a: "#0f9d6e", b: "#2f6fe4", c: "#6b5fd6", d: "#d98a06", f: "#d91f45", x: "#9b1030" };

export function isExpired(a, now = Date.now()) {
  return (a.status === "in_progress" || a.status === "suspended") && now > a.startedAtMs + ((a.durationMin || 0) + (a.extraMin || 0)) * 60000 + 60000;
}
export function isFinished(a, now) { return a.status === "submitted" || a.status === "locked" || isExpired(a, now); }

function haversine(a, b) {
  const R = 6371000, t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function computeReport(exam, keyDoc, attemptsAll, opts = {}) {
  const pass = exam.passMark || 50, now = opts.now || Date.now();
  const key = (keyDoc && keyDoc.answers) || {}, cancelled = (keyDoc && keyDoc.cancelled) || {};
  const Q = exam.questions;
  const all = attemptsAll.filter(a => a.examId === exam.id && (!opts.group || String(a.group) === String(opts.group)));
  const done = all.filter(a => isFinished(a, now));

  const rows = done.map(a => {
    const sc = scoreAttempt(a, exam, keyDoc);
    const end = a.submittedAtMs || Math.min(now, a.startedAtMs + (a.durationMin + (a.extraMin || 0)) * 60000);
    return { a, ...sc, grade: gradeOf(sc.pct, pass, sc.failed), timeMin: round((end - a.startedAtMs) / 60000, 1), answered: Object.keys(a.answers || {}).length };
  });
  const pcts = rows.map(r => r.pct);

  const hist = Array(10).fill(0);
  pcts.forEach(p => hist[Math.min(9, Math.floor(p / 10))]++);
  const grades = Object.fromEntries(GRADE_ORDER.map(g => [g, 0]));
  rows.forEach(r => grades[r.grade.key]++);

  // ---- تحليل الأسئلة
  const valid = rows.filter(r => !r.failed);
  const items = Q.map((q, i) => {
    const R = valid.filter(r => r.per[q.id] || (cancelled[q.id] && questionsOf(r.a, exam).some(x => x.id === q.id)));
    const withQ = valid.filter(r => r.per[q.id]);
    const isChoice = q.type === "mcq" || q.type === "tf" || !q.type;
    const dist = isChoice ? q.options.map(() => 0) : []; let none = 0;
    withQ.forEach(r => { const v = r.a.answers?.[q.id]; if (!r.per[q.id].answered) none++; else if (isChoice) dist[v] = (dist[v] || 0) + 1; });
    const fs = withQ.map(r => r.per[q.id].f);
    const p = fs.length ? mean(fs) : 0;
    const sorted = [...withQ].sort((x, y) => y.pct - x.pct), g = Math.max(1, Math.round(withQ.length * 0.27));
    const up = sorted.slice(0, g), lo = sorted.slice(-g);
    const d = withQ.length >= 4 ? mean(up.map(r => r.per[q.id].f)) - mean(lo.map(r => r.per[q.id].f)) : null;
    const pending = withQ.filter(r => r.per[q.id].pending).length;
    return {
      q, n: i + 1, seen: R.length, p: round(p), d: d == null ? null : round(d), dist, none, isChoice, pending,
      correctIdx: isChoice ? key[q.id] : null, cancelled: !!cancelled[q.id],
      deadDistractors: isChoice ? dist.filter((c, j) => j !== key[q.id] && c === 0).length : 0,
      level: p > 0.75 ? { k: "easy", t: "سهل" } : p >= 0.35 ? { k: "mid", t: "متوسط" } : { k: "hard", t: "صعب" },
      dLabel: d == null ? "—" : d >= 0.4 ? "ممتاز" : d >= 0.3 ? "جيد" : d >= 0.2 ? "مقبول" : d >= 0 ? "ضعيف — يُراجَع" : "سالب — يُعدَّل أو يُلغى"
    };
  });

  // ---- الثبات (ألفا كرونباخ / KR-20) عندما يجيب الجميع على نفس الأسئلة
  let reliability = null;
  const sameSet = !exam.drawCount || exam.drawCount >= Q.length;
  if (sameSet) {
    const qs = Q.filter(q => !cancelled[q.id]);
    reliability = cronbachAlpha(valid.filter(r => r.pending === 0).map(r => qs.map(q => r.per[q.id] ? r.per[q.id].f : 0)));
  }

  // ---- المجموعات
  const gmap = {};
  rows.forEach(r => (gmap[r.a.group] = gmap[r.a.group] || []).push(r));
  const groups = Object.entries(gmap).map(([g, R]) => {
    const p = R.map(r => r.pct), best = [...R].sort((x, y) => y.pct - x.pct)[0];
    return { g, n: R.length, mean: round(mean(p), 1), max: Math.max(...p), min: Math.min(...p), passRate: round(R.filter(r => r.pct >= pass).length / R.length * 100, 1), top: best, warned: R.filter(r => r.a.violationCount > 0).length };
  }).sort((x, y) => String(x.g).localeCompare(String(y.g), "ar", { numeric: true }));

  // ---- مؤشرات الغش
  const mcqQ = Q.filter(q => (q.type === "mcq" || !q.type) && q.options && q.options.length >= 3);
  const similar = [];
  if (mcqQ.length >= 8) for (let i = 0; i < valid.length; i++) for (let j = i + 1; j < valid.length; j++) {
    const A = valid[i].a.answers || {}, B = valid[j].a.answers || {};
    let both = 0, same = 0, sameWrong = 0;
    mcqQ.forEach(q => { if (A[q.id] === undefined || B[q.id] === undefined) return; both++; if (A[q.id] === B[q.id]) { same++; if (A[q.id] !== key[q.id]) sameWrong++; } });
    const sim = both ? same / both : 0;
    if (both >= 8 && sameWrong >= Math.max(4, Math.ceil(mcqQ.length * 0.25)) && sim >= 0.85) similar.push({ x: valid[i], y: valid[j], sameWrong, sim: Math.round(sim * 100), both });
  }
  similar.sort((x, y) => y.sameWrong - x.sameWrong);
  const fast = valid.filter(r => r.timeMin < exam.duration * 0.25 && r.pct >= 70 && r.n >= 5);
  const sameLoc = [];
  const located = rows.filter(r => r.a.location && r.a.location.accuracy <= 60);
  for (let i = 0; i < located.length; i++) for (let j = i + 1; j < located.length; j++) {
    const d = haversine(located[i].a.location, located[j].a.location);
    if (d < 15) sameLoc.push({ x: located[i], y: located[j], d: Math.round(d) });
  }
  const simIds = new Set(similar.flatMap(s => [s.x.a.id, s.y.a.id])), fastIds = new Set(fast.map(r => r.a.id));
  const risk = {};
  all.forEach(a => {
    let s = (a.violationCount || 0) * 30 + (a.status === "locked" ? 25 : 0) + Math.min(a.flagCount || (a.flags || []).length || 0, 10) * 3
      + (simIds.has(a.id) ? 20 : 0) + (fastIds.has(a.id) ? 10 : 0) + (!a.location ? 5 : 0);
    s = Math.min(100, s);
    risk[a.id] = { s, level: s >= 60 ? { k: "h", t: "مرتفع", c: "#d91f45" } : s >= 30 ? { k: "m", t: "متوسط", c: "#d98a06" } : s > 0 ? { k: "l", t: "منخفض", c: "#2f6fe4" } : { k: "0", t: "لا يوجد", c: "#0f9d6e" } };
  });

  // ---- الغياب (إذا كان الاختبار مرتبطًا بكشف أسماء)
  let absent = [];
  if (opts.roster) {
    const seen = new Set(all.map(a => String(a.seat)));
    absent = opts.roster.filter(s => (!opts.group || String(s.group) === String(opts.group)) && !seen.has(String(s.seat)));
  }

  const times = rows.map(r => r.timeMin);
  const stats = {
    registered: all.length, n: rows.length, inProgress: all.length - rows.length, absent: absent.length,
    mean: round(mean(pcts), 1), median: round(median(pcts), 1), sd: round(sdPop(pcts), 1),
    max: pcts.length ? Math.max(...pcts) : 0, min: pcts.length ? Math.min(...pcts) : 0,
    meanScore: round(mean(rows.map(r => r.s)), 1), total: rows[0]?.t ?? Q.reduce((s, q) => s + (cancelled[q.id] ? 0 : (q.points || 1)), 0),
    passN: rows.filter(r => r.pct >= pass && !r.failed).length, passRate: rows.length ? round(rows.filter(r => r.pct >= pass && !r.failed).length / rows.length * 100, 1) : 0,
    avgTime: round(mean(times), 1), locked: all.filter(a => a.status === "locked").length,
    warned: all.filter(a => a.violationCount > 0).length, totalViolations: all.reduce((s, a) => s + (a.violationCount || 0), 0),
    restarted: all.filter(a => (a.restarts || 0) > 0).length, pending: rows.reduce((s, r) => s + r.pending, 0),
    reliability, pass
  };
  const top = rows.filter(r => r.pct >= 85 && !r.failed).sort((x, y) => y.pct - x.pct || x.timeMin - y.timeMin);
  const weak = rows.filter(r => r.pct < pass || r.failed).sort((x, y) => x.pct - y.pct);
  return { exam, rows, stats, hist, grades, items, groups, similar, fast, sameLoc, risk, top, weak, all, absent };
}

// ---- مقارنة قبلي/بعدي (للبحث العلمي)
export function computePrePost(pre, preKey, post, postKey, attempts, expGroups) {
  const ident = a => a.seat ? "s:" + a.seat : "n:" + (a.nameKey || a.name) + "|" + a.group;
  const finished = (ex, k) => {
    const m = {};
    attempts.filter(a => a.examId === ex.id && isFinished(a)).forEach(a => { const sc = scoreAttempt(a, ex, k); m[ident(a)] = { a, pct: sc.pct, s: sc.s, t: sc.t, failed: sc.failed }; });
    return m;
  };
  const A = finished(pre, preKey), B = finished(post, postKey);
  const rows = Object.keys(A).filter(id => B[id]).map(id => {
    const a = B[id].a, cond = expGroups.has(String(a.group)) ? "exp" : "ctl";
    return { id, name: a.name, group: a.group, seat: a.seat || "", pre: A[id].pct, post: B[id].pct, preS: A[id].s, postS: B[id].s, gain: round(B[id].pct - A[id].pct, 1), cond };
  }).sort((x, y) => x.name.localeCompare(y.name, "ar"));
  const side = c => {
    const R = rows.filter(r => r.cond === c), x = R.map(r => r.pre), y = R.map(r => r.post);
    return { n: R.length, preMean: round(mean(x), 1), preSd: round(sdPop(x), 1), postMean: round(mean(y), 1), postSd: round(sdPop(y), 1), paired: pairedT(x, y), black: blackGain(x, y, 100) };
  };
  const exp = side("exp"), ctl = side("ctl");
  const E = rows.filter(r => r.cond === "exp"), C = rows.filter(r => r.cond === "ctl");
  return {
    rows, exp, ctl,
    betweenPre: indepT(E.map(r => r.pre), C.map(r => r.pre)),
    betweenPost: indepT(E.map(r => r.post), C.map(r => r.post)),
    betweenGain: indepT(E.map(r => r.gain), C.map(r => r.gain)),
    unmatched: { pre: Object.keys(A).length - rows.length, post: Object.keys(B).length - rows.length }
  };
}
