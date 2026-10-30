// =====================================================================
//  إحصاء البحث العلمي: اختبار "ت"، حجم الأثر، الكسب المعدّل لبلاك، الثبات
// =====================================================================
export const mean = x => x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0;
export const median = x => { if (!x.length) return 0; const s = [...x].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const sdPop = x => { if (x.length < 2) return 0; const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
export const sdSample = x => { if (x.length < 2) return 0; const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)); };
export const round = (v, d = 2) => v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;

// ---- دالة بيتا غير التامة المنتظمة (Numerical Recipes)
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
// القيمة الاحتمالية ثنائية الطرف لاختبار "ت"
export function pTwoTailed(t, df) { if (!isFinite(t) || df <= 0) return null; return ibeta(df / (df + t * t), df / 2, 0.5); }

// اختبار "ت" للعينات المرتبطة (قبلي/بعدي لنفس الطلاب)
export function pairedT(pre, post) {
  const n = Math.min(pre.length, post.length); if (n < 2) return null;
  const d = post.slice(0, n).map((v, i) => v - pre[i]);
  const md = mean(d), sd = sdSample(d);
  if (sd === 0) return { n, df: n - 1, meanDiff: round(md), t: null, p: md === 0 ? 1 : 0, eta2: md === 0 ? 0 : 1, d: null };
  const t = md / (sd / Math.sqrt(n)), df = n - 1;
  return { n, df, meanDiff: round(md), sdDiff: round(sd), t: round(t, 3), p: round(pTwoTailed(t, df), 4), eta2: round(t * t / (t * t + df), 3), d: round(md / sd, 2) };
}
// اختبار "ت" لعينتين مستقلتين (تجريبية/ضابطة)
export function indepT(a, b) {
  const n1 = a.length, n2 = b.length; if (n1 < 2 || n2 < 2) return null;
  const m1 = mean(a), m2 = mean(b), v1 = sdSample(a) ** 2, v2 = sdSample(b) ** 2, df = n1 + n2 - 2;
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / df);
  if (sp === 0) return { n1, n2, df, t: null, p: m1 === m2 ? 1 : 0, eta2: null, d: null, m1: round(m1), m2: round(m2) };
  const t = (m1 - m2) / (sp * Math.sqrt(1 / n1 + 1 / n2));
  return { n1, n2, df, m1: round(m1), m2: round(m2), t: round(t, 3), p: round(pTwoTailed(t, df), 4), eta2: round(t * t / (t * t + df), 3), d: round((m1 - m2) / sp, 2) };
}
// نسبة الكسب المعدّل لبلاك (الدرجة العظمى = max)
export function blackGain(pre, post, max) {
  const g = pre.map((x, i) => (max - x) > 0 ? (post[i] - x) / (max - x) + (post[i] - x) / max : null).filter(v => v != null);
  return g.length ? round(mean(g), 2) : null;
}
// معامل ألفا كرونباخ (يساوي KR-20 للأسئلة ثنائية الدرجة)
export function cronbachAlpha(matrix) { // matrix[student][item] بين 0 و 1
  const n = matrix.length, k = n ? matrix[0].length : 0; if (n < 5 || k < 2) return null;
  const itemVar = Array.from({ length: k }, (_, j) => sdPop(matrix.map(r => r[j])) ** 2).reduce((s, v) => s + v, 0);
  const tot = sdPop(matrix.map(r => r.reduce((s, v) => s + v, 0))) ** 2;
  return tot > 0 ? round((k / (k - 1)) * (1 - itemVar / tot), 2) : null;
}
export const effectLabel = {
  eta2: v => v == null ? "—" : v >= 0.14 ? "كبير" : v >= 0.06 ? "متوسط" : v >= 0.01 ? "صغير" : "ضعيف جدًا",
  d: v => v == null ? "—" : Math.abs(v) >= 0.8 ? "كبير" : Math.abs(v) >= 0.5 ? "متوسط" : Math.abs(v) >= 0.2 ? "صغير" : "ضعيف جدًا",
  p: v => v == null ? "—" : v < 0.01 ? "دالة عند 0.01" : v < 0.05 ? "دالة عند 0.05" : "غير دالة",
  black: v => v == null ? "—" : v >= 1.2 ? "فاعلية مقبولة (≥ 1.2)" : "أقل من الحد المقبول (1.2)"
};
