// =====================================================================
//  «أذن المراقب»: فهم الكلام المسموع أثناء الاختبار (التعرّف على الكلام في المتصفح)
//  الهدف مش أي كلام — الهدف: هل حد بيملي الإجابات أو بيقرأ السؤال/الاختيارات أو بيتكلم عن الغش؟
//  ١) إملاء إجابة: «الإجابة ب» • «اختار ج» • «رقم ٣ صح» • «السؤال الخامس د» • «أ ب ج د ب…»
//  ٢) قراءة نص سؤال أو اختيار من أسئلة الاختبار بصوت مسموع
//  ٣) كلام عن الغش: «ابعتلي» • «صوّر السؤال» • «واتساب» • «جوجل» • «شات جي بي تي»
//  يعمل على Chrome و Edge و Samsung Internet و Safari — المتصفحات اللي مش بتدعمه يكمل فيها رصد الصوت العادي
// =====================================================================

export const speechSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// توحيد الحروف العربية عشان المقارنة تبقى عادلة (همزات، تاء مربوطة، تشكيل، أرقام هندية…)
export function norm(s) {
  return String(s || "").toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[^؀-ۿa-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
const STOP = new Set("في من الي الى علي على عن مع هو هي هم انت انا احنا ده دي دا اللي التي الذي الذين ما ماذا لماذا كيف هل او ام ثم لا لم لن ان كان كانت يكون تكون بين كل بعض غير عند لكن لان حتى قد ذلك هذا هذه تلك هنا هناك ايه ازاي ليه فين امتي مين يعني كده بس طيب خلاص اه لا ايوه".split(" "));
const words = s => norm(s).split(" ").filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.replace(/^(وال|بال|كال|فال|لل|ال)(?=..)/, ""));

// حروف وأرقام الاختيارات كما ينطقها المصريون وكما يكتبها محرك التعرّف
const LETTER = /^(ا|الف|ب|بي|بيه|باء|با|ج|جيم|جي|جيه|د|دال|دي|ديه|a|b|c|d)$/;
const NUMBER = /^(1|2|3|4|5|واحد|اتنين|اثنين|تلاته|ثلاثه|اربعه|خمسه|الاول|الاولي|اول|التاني|الثاني|تاني|التانيه|الثانيه|التالت|الثالث|تالت|التالته|الثالثه|الرابع|رابع|الرابعه|الخامس)$/;
const TF = /^(صح|صحيح|غلط|خطا|خطأ|خاطئ|خاطيه|صواب)$/;
const TRIGGER = /^(اجابه|الاجابه|اجابته|الاجابات|اجابات|جواب|الجواب|حل|الحل|حله|اختار|اختر|اختاري|اختارو|اختيار|الاختيار|علم|علمي|حط|حطي|دوس|دوسي|اضغط|اكتب|اكتبي|رقم|حرف|الحرف|السؤال|سؤال|سوال|السوال|اللي|الصح|الصحيح)$/;
const CHEAT = /(ابعت ?لي|ابعتلي|ابعتهولي|صورلي|صور ?السؤال|صور ?الاسئله|واتس|الجروب|جروب|جوجل|شات ?جي ?بي ?تي|chatgpt|gpt|قولي ?الاجابه|قلي ?الاجابه|الاجابه ?ايه|حليت ?ايه|جاوبت ?ايه|اختارت ?ايه|عملت ?ايه ?في ?السؤال)/;

// يبني «بصمة» أسئلة الاختبار: كلمات كل سؤال وكل اختيار
export function buildContext(questions) {
  const Q = [];
  (questions || []).forEach((q, i) => {
    const opts = [].concat(q.options || [], q.left || [], q.right || [], q.items || []).map(t => ({ t: String(t), w: [...new Set(words(t))] })).filter(o => o.w.length);
    Q.push({ i, text: String(q.text || ""), w: [...new Set(words(q.text))], opts });
  });
  return Q;
}

// يفحص جملة مسموعة ويرجع { kind, label } لو فيها غش، أو null
export function analyze(said, ctx) {
  const n = norm(said); if (!n) return null;
  const tk = n.split(" ");
  // ١) إملاء إجابة: كلمة دالة + حرف/رقم/صح-غلط خلال 3 كلمات
  for (let i = 0; i < tk.length; i++) {
    if (!TRIGGER.test(tk[i])) continue;
    for (let j = i + 1; j <= Math.min(tk.length - 1, i + 3); j++)
      if (LETTER.test(tk[j]) || TF.test(tk[j]) || (NUMBER.test(tk[j]) && j + 1 < tk.length && (LETTER.test(tk[j + 1]) || TF.test(tk[j + 1])))) return { kind: "dictate", label: "إملاء إجابات بصوت مسموع" };
    // «الإجابة الأولى/التانية/رقم ٣» = إشارة لاختيار
    if (/^(اجابه|الاجابه|الحل|حل|اختار|اختر|الاختيار|اختيار)$/.test(tk[i]) && tk[i + 1] && NUMBER.test(tk[i + 1])) return { kind: "dictate", label: "إملاء إجابات بصوت مسموع" };
  }
  // سلسلة حروف/صح-غلط ورا بعض (أ ب ج د ب / صح غلط صح) = إملاء مجموعة إجابات
  let run = 0, best = 0;
  tk.forEach(w => { run = LETTER.test(w) || TF.test(w) ? run + 1 : NUMBER.test(w) ? run : 0; best = Math.max(best, run); });
  if (best >= 3) return { kind: "dictate", label: "إملاء مجموعة إجابات بصوت مسموع" };
  // ٢) كلام عن الغش
  if (CHEAT.test(n)) return { kind: "cheatTalk", label: "حديث عن الغش أو طلب الإجابات" };
  // ٣) قراءة نص سؤال أو اختيار من الاختبار
  const sw = new Set(words(said)); if (sw.size < 2) return null;
  for (const q of ctx || []) {
    const hitQ = q.w.filter(w => sw.has(w)).length;
    if (q.w.length && (hitQ >= 4 || (hitQ >= 3 && hitQ / q.w.length >= 0.5))) return { kind: "readQ", label: `قراءة نص السؤال ${q.i + 1} بصوت مسموع` };
    for (const o of q.opts) {
      const h = o.w.filter(w => sw.has(w)).length;
      if (o.w.length >= 2 && h >= 2 && h / o.w.length >= 0.6) return { kind: "readA", label: `نطق نص إجابة من السؤال ${q.i + 1} بصوت مسموع` };
    }
  }
  return null;
}

// يشغّل التعرّف على الكلام بشكل مستمر ويعيد تشغيله تلقائيًا
// opts: { lang, getContext(), onHit({kind,label,said}), onState(state) }
export function startSpeech(opts = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { opts.onState && opts.onState("unsupported"); return null; }
  let rec = null, alive = true, paused = false, backoff = 400, lastHit = 0, fails = 0;
  const handle = said => {
    if (!alive || paused) return;
    const r = analyze(said, opts.getContext ? opts.getContext() : []);
    if (!r) return;
    const now = Date.now(); if (now - lastHit < 8000) return; lastHit = now;
    opts.onHit && opts.onHit({ ...r, said: String(said).trim().slice(0, 140) });
  };
  const start = () => {
    if (!alive) return;
    try {
      rec = new SR();
      rec.lang = opts.lang || "ar-EG"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 2;
      let interim = "";
      rec.onresult = e => {
        fails = 0; backoff = 400;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) { interim = ""; for (let k = 0; k < res.length; k++) handle(res[k].transcript); }
          else { interim = res[0].transcript; if (interim.split(" ").length >= 4) handle(interim); }
        }
      };
      rec.onerror = e => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") { alive = false; opts.onState && opts.onState("denied:" + e.error); }
        else if (e.error === "network") { fails++; backoff = Math.min(30000, 2000 * fails); }
      };
      rec.onend = () => { rec = null; if (alive) setTimeout(start, backoff); };
      rec.start();
      opts.onState && opts.onState("on");
    } catch (err) { fails++; if (alive) setTimeout(start, Math.min(30000, 2000 * fails)); }
  };
  start();
  return {
    stop() { alive = false; try { rec && rec.abort(); } catch { } },
    pause(ms = 4000) { paused = true; setTimeout(() => { paused = false; }, ms); }
  };
}
