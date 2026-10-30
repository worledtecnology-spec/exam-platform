// =====================================================================
//  التصحيح: سحب الأسئلة من البنك + تصحيح كل نوع + نصوص العرض
// =====================================================================
import { seededShuffle } from "./common.js";
import { normAr } from "./parser.js";

// اختيار أسئلة الطالب من بنك الأسئلة بتوزيع متوازن حسب المستوى
export function pickQuestions(exam, seed) {
  const all = exam.questions, n = exam.drawCount | 0;
  let ids = all.map(q => q.id);
  if (n > 0 && n < all.length) {
    const groups = {};
    all.forEach(q => (groups[q.level || "_"] = groups[q.level || "_"] || []).push(q.id));
    const quotas = Object.entries(groups).map(([k, arr]) => { const v = n * arr.length / all.length; return { k, c: Math.floor(v), rem: v - Math.floor(v) }; });
    let left = n - quotas.reduce((s, x) => s + x.c, 0);
    [...quotas].sort((a, b) => b.rem - a.rem).forEach(x => { if (left > 0) { x.c++; left--; } });
    const picked = new Set();
    quotas.forEach(x => seededShuffle(groups[x.k], seed + "|" + x.k).slice(0, x.c).forEach(id => picked.add(id)));
    ids = ids.filter(id => picked.has(id));
  }
  return exam.shuffle ? seededShuffle(ids, seed) : ids;
}
export function questionsOf(a, exam) {
  if (!exam) return [];
  if (a && Array.isArray(a.qIds) && a.qIds.length) { const m = Object.fromEntries(exam.questions.map(q => [q.id, q])); return a.qIds.map(id => m[id]).filter(Boolean); }
  return exam.questions;
}
const keyAnswers = k => (k && k.answers) ? k.answers : (k || {});

export function isAnswered(q, v) {
  const t = q.type || "mcq";
  if (v === undefined || v === null) return false;
  if (t === "match") return Array.isArray(v) && v.some(x => x != null && x >= 0);
  if (t === "order") return Array.isArray(v) && v.length > 0;
  if (t === "fill" || t === "essay") return String(v).trim() !== "";
  return true;
}

// نتيجة سؤال واحد: f = نسبة الصواب (0 → 1)
export function qResult(q, key, v, manual) {
  const t = q.type || "mcq";
  if (!isAnswered(q, v)) return { f: 0, answered: false };
  switch (t) {
    case "mcq": case "tf": return { f: v === key ? 1 : 0, answered: true, wrong: v !== key };
    case "match": { const c = (key || []).filter((k, i) => v[i] === k).length; return { f: key && key.length ? c / key.length : 0, answered: true }; }
    case "order": { const c = (key || []).filter((k, i) => v[i] === k).length; return { f: key && key.length ? c / key.length : 0, answered: true }; }
    case "fill": { const ok = (key || []).some(a => normAr(a) === normAr(v)); return { f: ok ? 1 : 0, answered: true }; }
    case "essay": if (manual == null) return { f: 0, answered: true, pending: true }; return { f: Math.max(0, Math.min(1, manual / (q.points || 1))), answered: true };
  }
  return { f: 0, answered: true };
}

// درجة محاولة كاملة
export function scoreAttempt(a, exam, keyDoc) {
  if (!exam || !keyDoc) return null;
  const key = keyAnswers(keyDoc), cancelled = keyDoc.cancelled || {};
  const qs = questionsOf(a, exam);
  let s = 0, t = 0, pending = 0; const per = {};
  qs.forEach(q => {
    if (cancelled[q.id]) return;
    const p = q.points || 1; t += p;
    const r = qResult(q, key[q.id], a.answers ? a.answers[q.id] : undefined, a.manual ? a.manual[q.id] : undefined);
    let pts = r.f * p;
    if (r.wrong && exam.negative > 0) pts -= exam.negative * p;
    if (r.pending) pending++;
    s += pts; per[q.id] = { ...r, pts: Math.round(pts * 100) / 100, of: p };
  });
  const failed = a.status === "locked";
  s = failed ? 0 : Math.max(0, Math.round(s * 100) / 100);
  return { s, t, pct: t ? Math.round(s / t * 1000) / 10 : 0, pending, failed, per, n: qs.length };
}

// نصوص العرض للمراجعة
export function answerText(q, v) {
  if (!isAnswered(q, v)) return "لم يُجب";
  switch (q.type || "mcq") {
    case "mcq": case "tf": return q.options[v] ?? "—";
    case "match": return q.left.map((l, i) => `${l} ← ${v[i] != null && v[i] >= 0 ? q.right[v[i]] : "—"}`).join("  •  ");
    case "order": return v.map(i => q.items[i]).join(" ← ");
    default: return String(v);
  }
}
export function correctText(q, key) {
  switch (q.type || "mcq") {
    case "mcq": case "tf": return q.options[key] ?? "—";
    case "match": return q.left.map((l, i) => `${l} ← ${q.right[key[i]]}`).join("  •  ");
    case "order": return (key || []).map(i => q.items[i]).join(" ← ");
    case "fill": return (key || []).join(" أو ");
    case "essay": return key || "(يُصحَّح يدويًا)";
  }
  return "";
}
