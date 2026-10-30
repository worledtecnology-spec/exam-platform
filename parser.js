// =====================================================================
//  تحويل ملف وورد أو إكسل إلى أسئلة اختبار
//  الأنواع: اختيار من متعدد • صح وخطأ • توصيل • ترتيب • إكمال • مقالي
// =====================================================================
import { seededShuffle } from "./common.js";

export const TYPE_LABEL = { mcq: "اختيار من متعدد", tf: "صح وخطأ", match: "توصيل", order: "ترتيب", fill: "إكمال", essay: "مقالي" };
export const LEVEL_LABEL = { easy: "سهل", mid: "متوسط", hard: "صعب" };

const LET = { "أ": 0, "ا": 0, "إ": 0, "آ": 0, "ب": 1, "ج": 2, "د": 3, "ه": 4, "هـ": 4, "و": 5, "ز": 6, "a": 0, "b": 1, "c": 2, "d": 3, "e": 4, "f": 5 };
const TRUE_W = ["صح", "صحيح", "صحيحه", "صواب", "true", "t", "✓", "√", "نعم"];
const FALSE_W = ["خطا", "خطاء", "خاطي", "خاطيء", "خاطئ", "خاطئه", "false", "f", "×", "x", "✗", "لا"];

export function normAr(s) {
  return String(s ?? "").replace(/[ً-ْـ‎‏]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[.،,:؛;!؟?]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
const toLatinDigits = s => String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

const reAns = /^(?:الإجابة|الاجابة|الإجابه|الاجابه|الجواب|answer|correct)\s*(?:الصحيحة|الصحيحه)?\s*[:：\-–=]\s*(.+)$/i;
const reModel = /^(?:الإجابة|الاجابة|الإجابه|الاجابه)\s+(?:النموذجية|النموذجيه)\s*[:：\-–=]\s*(.*)$/;
const rePts = /^(?:الدرجة|الدرجه|درجة|درجه|points?|score)\s*[:：\-–=]\s*([\d٠-٩]+(?:[.,][\d٠-٩]+)?)/i;
const reType = /^(?:النوع|نوع السؤال|type)\s*[:：\-–=]\s*(.+)$/i;
const reLevel = /^(?:المستوى|المستوي|مستوى|مستوي|الصعوبة|الصعوبه|level)\s*[:：\-–=]\s*(.+)$/i;
const reQ = /^(?:س|سؤال|q)?\s*[\d٠-٩]+\s*[\-–.\):\/]\s*/i;
const reOpt = /^[\(\[]?\s*(هـ|[أاإبجدهوزa-fA-F])\s*[\)\]\-–.:]\s*(.+)$/;
const reBullet = /^(?:[\-•●▪◦*✓]\s*|\(?[\d٠-٩]+\s*[\)\-–.]\s*)/;
const reBlank = /\.{3,}|…|_{3,}|\(\s*\)/;
const IMG = /\[\[IMG:(\d+)\]\]/g;
const NO_ANSWER_TYPES = ["match", "order", "essay"];

export function typeOf(s) {
  const n = normAr(s);
  if (/صح|صواب|خطا/.test(n)) return "tf";
  if (/توصيل|مزاوج|وصل|^صل|مطابق/.test(n)) return "match";
  if (/ترتيب|رتب/.test(n)) return "order";
  if (/اكمال|اكمل|فراغ|املا/.test(n)) return "fill";
  if (/مقال|مفتوح|قصير/.test(n)) return "essay";
  if (/اختيار|متعدد|mcq/.test(n)) return "mcq";
  return null;
}
export function levelOf(s) {
  const n = normAr(s);
  if (/سهل|easy/.test(n)) return "easy";
  if (/صعب|hard/.test(n)) return "hard";
  if (/متوسط|وسط|mid|medium/.test(n)) return "mid";
  return "";
}

export function resolveAnswer(ans, options) {
  let s = toLatinDigits(String(ans ?? "").trim()).replace(/^[\(\[]\s*/, "");
  if (!s) return -1;
  const m = s.match(/^(هـ|[أاإآبجدهوزa-fA-F])\s*(?:[\)\]\-–.:]|$)/);
  if (m) { const i = LET[m[1].toLowerCase()]; if (i !== undefined && i < options.length) return i; }
  const d = s.match(/^(\d+)\s*(?:[\)\-–.:]|$)/);
  if (d) { const i = +d[1] - 1; if (i >= 0 && i < options.length) return i; }
  const ns = normAr(s);
  let i = options.findIndex(o => normAr(o) === ns);
  if (i >= 0) return i;
  const isT = TRUE_W.includes(ns), isF = FALSE_W.includes(ns);
  if (isT || isF) {
    i = options.findIndex(o => { const no = normAr(o); return isT ? TRUE_W.includes(no) : FALSE_W.includes(no); });
    if (i >= 0) return i;
  }
  return options.findIndex(o => { const no = normAr(o); return no && (no.startsWith(ns) || ns.startsWith(no)); });
}
export function isTF(ans) { const n = normAr(ans); return TRUE_W.includes(n) || FALSE_W.includes(n); }
const isTFOptions = o => o.length === 2 && isTF(o[0]) && isTF(o[1]);
const num = v => { const n = parseFloat(toLatinDigits(String(v ?? "")).replace(",", ".")); return n > 0 ? n : 1; };
const stripItem = x => { const m = String(x).match(reOpt); return (m ? m[2] : String(x).replace(reBullet, "")).trim(); };
export const splitAccepted = a => String(a ?? "").split(/\s*\|\s*|\s*؛\s*|\s+أو\s+|\s*\/\s*/).map(s => s.trim()).filter(Boolean);

// خلط ثابت يضمن أن الترتيب المعروض ≠ الترتيب الصحيح
function scramble(arr, seed) {
  if (arr.length < 2) return arr.map((_, i) => i);
  const idx = arr.map((_, i) => i);
  for (let t = 0; t < 8; t++) { const s = seededShuffle(idx, seed + "#" + t); if (s.some((v, i) => v !== i)) return s; }
  return idx.slice(1).concat(0);
}

// ------------------------------------------------------------- بناء سؤال واحد من مواصفة موحّدة
// spec: { type?, text, opts[], answer, model, points, level, img, imgUrl }
function buildOne(spec, n) {
  const label = `السؤال ${n}${spec.text ? ` («${spec.text.slice(0, 35)}${spec.text.length > 35 ? "…" : ""}»)` : ""}`;
  let opts = (spec.opts || []).map(o => String(o ?? "").trim()).filter(Boolean);
  const answer = String(spec.answer ?? "").trim();
  let type = spec.type;
  const pairs = opts.filter(o => o.includes("="));
  if (!type) {
    if (pairs.length >= 2 && !answer) type = "match";
    else if (spec.model != null) type = "essay";
    else if (answer && opts.length >= 2) type = isTFOptions(opts) ? "tf" : "mcq";
    else if (answer && isTF(answer)) type = "tf";
    else if (answer) type = "fill";
  }
  if (!spec.text) return { error: `${label}: لا يوجد نص للسؤال.` };
  if (!type) return { error: `${label}: لم تُحدَّد الإجابة الصحيحة.` };
  const q = { type, text: spec.text, points: num(spec.points), level: spec.level || "" };
  if (spec.img != null) q.img = spec.img;
  if (spec.imgUrl) q.imgUrl = spec.imgUrl;
  let key;

  if (type === "mcq" || type === "tf") {
    if (type === "tf" && opts.length < 2) opts = ["صح", "خطأ"];
    if (opts.length < 2) return { error: `${label}: يحتاج إلى اختيارين على الأقل.` };
    if (!answer) return { error: `${label}: لم تُحدَّد الإجابة الصحيحة.` };
    const a = resolveAnswer(answer, opts);
    if (a < 0) return { error: `${label}: لم يتم التعرف على الإجابة «${answer}».` };
    if (type === "mcq" && isTFOptions(opts)) q.type = "tf";
    q.options = opts; key = a;
  } else if (type === "fill") {
    const acc = splitAccepted(answer);
    if (!acc.length) return { error: `${label}: اكتب الإجابة الصحيحة للفراغ (ويمكن كتابة أكثر من إجابة مقبولة بينها |).` };
    if (!reBlank.test(q.text)) q.text += " ……………";
    key = acc;
  } else if (type === "match") {
    const left = [], right = [];
    pairs.forEach(p => {
      const i = p.indexOf("=");
      const l = stripItem(p.slice(0, i)), r = p.slice(i + 1).trim();
      if (r) { right.push(r); if (l) left.push({ l, r: right.length - 1 }); }
    });
    if (left.length < 2) return { error: `${label}: سؤال التوصيل يحتاج زوجين على الأقل بالشكل «العنصر = ما يناسبه».` };
    const perm = scramble(right, spec.text + n); // perm[k] = الفهرس الأصلي للعنصر المعروض رقم k
    q.left = left.map(x => x.l);
    q.right = perm.map(k => right[k]);
    key = left.map(x => perm.indexOf(x.r));
  } else if (type === "order") {
    const items = opts.map(stripItem).filter(Boolean);
    if (items.length < 2) return { error: `${label}: سؤال الترتيب يحتاج عنصرين على الأقل (اكتبها بالترتيب الصحيح).` };
    const perm = scramble(items, spec.text + n);
    q.items = perm.map(k => items[k]);
    key = items.map((_, k) => perm.indexOf(k)); // key[k] = موضع العنصر الصحيح رقم k في القائمة المعروضة
  } else if (type === "essay") {
    key = String(spec.model ?? spec.answer ?? "").trim();
  }
  return { q, key };
}

function finalize(specs, extraErrors = []) {
  const questions = [], key = {}, errors = [];
  specs.forEach((s, i) => {
    const r = buildOne(s, i + 1);
    if (r.error) return errors.push(r.error);
    const id = "q" + (questions.length + 1);
    questions.push({ id, ...r.q }); key[id] = r.key;
  });
  return { questions, key, errors: errors.concat(extraErrors) };
}

// ------------------------------------------------------------- Word
export function parseWordText(raw, images = []) {
  const lines = String(raw).split(/\r?\n/)
    .map(l => l.replace(/[‎‏‪-‮\t ]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const blocks = [], extra = [];
  const nb = () => ({ lines: [], type: null, level: null, points: null, answer: null, model: null });
  let cur = nb();
  const push = () => { blocks.push(cur); cur = nb(); };
  const tgt = field => (cur.lines.length || !blocks.length || blocks[blocks.length - 1][field] != null) ? cur : blocks[blocks.length - 1];
  const pairCount = b => b.lines.filter(x => x.includes("=")).length;
  for (const l of lines) {
    let m;
    if ((m = l.match(reModel))) { cur.model = m[1].trim(); cur.type = cur.type || "essay"; push(); continue; }
    if ((m = l.match(reAns))) { cur.answer = m[1].trim(); push(); continue; }
    if ((m = l.match(rePts))) { const t = tgt("points"); t.points = m[1]; continue; }
    if ((m = l.match(reLevel))) { const t = tgt("level"); t.level = levelOf(m[1]); continue; }
    if ((m = l.match(reType))) {
      const t = typeOf(m[1]);
      if (cur.lines.length > 1 && (NO_ANSWER_TYPES.includes(cur.type) || pairCount(cur) >= 2)) push();
      cur.type = t; continue;
    }
    // الأسئلة التي لا تحتاج سطر «الإجابة» تنتهي ببداية سؤال مرقّم جديد
    if (reQ.test(l) && cur.lines.length && (NO_ANSWER_TYPES.includes(cur.type) || (!cur.type && pairCount(cur) >= 2))) push();
    cur.lines.push(l);
  }
  if (cur.lines.length) {
    if (NO_ANSWER_TYPES.includes(cur.type) || pairCount(cur) >= 2) push();
    else extra.push(`يوجد نص بعد آخر سؤال بدون سطر «الإجابة:» — «${cur.lines[0].replace(IMG, "").slice(0, 40)}» (تم تجاهله).`);
  }

  const specs = blocks.map((b, bi) => {
    let L = b.lines.slice();
    if (bi === 0 && L.length > 1) { // تجاهل العنوان/التعليمات أعلى الملف
      const looksQ = x => /[؟?:：]\s*$|\.{3,}|…|_{3,}|\(\s*\)/.test(x);
      const k = L.findIndex(x => reQ.test(x));
      if (k > 0) { if (!(looksQ(L[0]) && !looksQ(L[k]))) L = L.slice(k); }
      else if (k < 0 && !b.type) { const j = L.findIndex(looksQ); if (j > 0 && j < L.length - 1) L = L.slice(j); }
    }
    let img = null;
    L = L.map(x => { const mm = [...x.matchAll(IMG)]; if (mm.length && img == null) img = +mm[0][1]; return x.replace(IMG, " ").replace(/\s+/g, " ").trim(); }).filter(Boolean);
    const spec = { type: b.type, answer: b.answer, model: b.model, points: b.points, level: b.level, img: img != null && images[img] ? img : null, opts: [] };
    if (!L.length) return { ...spec, text: "" };
    const clean = s => s.replace(reQ, "").replace(/\(\s*\)\s*$/, "").trim();
    const type = b.type;
    const pairs = L.filter(x => x.includes("="));
    if (type === "match" || (!type && pairs.length >= 2 && !b.answer)) {
      spec.text = clean(L.filter(x => !x.includes("=")).join("\n")) || "صِل كل عنصر بما يناسبه:";
      spec.opts = pairs;
    } else if (type === "fill" || type === "essay" || (!type && (b.model != null || (b.answer && !isTF(b.answer) && !L.slice(1).some(x => reOpt.test(x)) && L.length === 1)))) {
      spec.text = clean(L.join("\n"));
    } else {
      // اختيار من متعدد / صح وخطأ / ترتيب: السطور الأولى سؤال، والباقي اختيارات أو عناصر
      let k = L.findIndex((x, i) => i > 0 && (reOpt.test(x) || (type === "order" && /^[\-•●▪◦*]/.test(x))));
      if (k < 0) k = 1;
      spec.text = clean(L.slice(0, k).join("\n"));
      spec.opts = L.slice(k).reduce((acc, x) => {
        const m = x.match(reOpt);
        if (m || type === "order" || !acc.length || k === 1) acc.push(m ? m[2].trim() : x.replace(reBullet, "").trim());
        else acc[acc.length - 1] += " " + x;
        return acc;
      }, []);
    }
    return spec;
  });
  return finalize(specs, extra);
}

// ------------------------------------------------------------- Excel
export function parseRows(rows) {
  rows = rows.map(r => (r || []).map(c => String(c ?? "").trim()));
  const h = rows.findIndex(r => r.some(c => /سؤال|السؤال|question/i.test(c)));
  let qCol = 0, aCol, pCol = -1, tCol = -1, lCol = -1, iCol = -1, oCols;
  if (h >= 0) {
    const H = rows[h].map(c => normAr(c));
    qCol = H.findIndex(c => /سؤال|سوال|question/.test(c)); if (qCol < 0) qCol = 0;
    const find = re => H.findIndex((c, i) => i !== qCol && re.test(c));
    aCol = find(/اجاب|جواب|answer|الصحيح|correct/);
    pCol = find(/درج|point|score|علامه/);
    tCol = find(/^النوع$|^نوع|type/);
    lCol = find(/مستوي|صعوب|level/);
    iCol = find(/صوره|رابط|image|img/);
    const used = [qCol, aCol, pCol, tCol, lCol, iCol];
    oCols = H.map((c, i) => i).filter(i => !used.includes(i) && H[i] && !/^(م|#|رقم|مسلسل|no|n)$/.test(H[i]));
    rows = rows.slice(h + 1);
  } else { qCol = 0; oCols = [1, 2, 3, 4]; aCol = 5; pCol = 6; }
  if (aCol < 0) return { questions: [], key: {}, errors: ["لم أجد عمود «الإجابة الصحيحة» في ملف الإكسل."] };
  const specs = rows.filter(r => r[qCol]).map(r => {
    const type = tCol >= 0 && r[tCol] ? typeOf(r[tCol]) : null;
    const spec = {
      type, text: r[qCol].replace(reQ, "").trim(), opts: oCols.map(c => r[c]), answer: r[aCol],
      points: pCol >= 0 ? r[pCol] : 1, level: lCol >= 0 ? levelOf(r[lCol]) : "", imgUrl: iCol >= 0 && /^https?:\/\//.test(r[iCol]) ? r[iCol] : ""
    };
    if (type === "essay") { spec.model = r[aCol]; spec.answer = ""; }
    if (type === "match" || type === "order") spec.answer = "";
    return spec;
  });
  return finalize(specs);
}

// ------------------------------------------------------------- Word HTML → نص (+ الصور)
// يحافظ على الترقيم التلقائي في وورد ويستخرج الصور كرموز [[IMG:n]]
export function wordHtmlToText(root) {
  const LT = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];
  const out = [], images = [];
  const textOf = (el, skipLists) => [...el.childNodes].map(n => {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1) return "";
    if (n.nodeName === "IMG") { const src = n.getAttribute("src") || ""; if (/^data:image\//.test(src)) { images.push(src); return ` [[IMG:${images.length - 1}]] `; } return ""; }
    if (skipLists && /^(OL|UL)$/.test(n.nodeName)) return "";
    return textOf(n, false);
  }).join("");
  (function walk(node, depth) {
    for (const el of node.children) {
      const tag = el.nodeName;
      if (tag === "OL" || tag === "UL") {
        [...el.children].filter(li => li.nodeName === "LI").forEach((li, i) => {
          const t = textOf(li, true).trim();
          if (t) out.push((depth === 0 ? (tag === "OL" ? `${i + 1}- ` : "") : `${LT[i] || i + 1}) `) + t);
          [...li.children].filter(c => /^(OL|UL)$/.test(c.nodeName)).forEach(c => walk({ children: [c] }, depth + 1));
        });
      } else if (tag === "TABLE") {
        el.querySelectorAll("tr").forEach(tr => {
          const cells = [...tr.querySelectorAll("td,th")].map(td => textOf(td).trim()).filter(Boolean);
          if (cells.length === 2 && !cells.some(c => /=/.test(c))) out.push(`${cells[0]} = ${cells[1]}`); else cells.forEach(c => out.push(c));
        });
      } else if (/^(P|H[1-6]|DIV|BLOCKQUOTE)$/.test(tag)) {
        const t = textOf(el).trim(); if (t) out.push(t);
      } else walk(el, depth);
    }
  })(root, 0);
  return { text: out.join("\n"), images };
}
