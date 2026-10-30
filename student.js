import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, onSnapshot, serverTimestamp, arrayUnion }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, SETTINGS } from "./config.js";
import { isConfigured, normalizeName, hashStr, seededShuffle, esc, mmss, fmtDateTime, LETTERS, frameGuard, initAppCheck } from "./common.js";
import { pickQuestions, isAnswered } from "./scoring.js";
import { TYPE_LABEL } from "./parser.js";
import { loadFaceDetector, detectFaces, faceReady } from "./face.js";

const $ = id => document.getElementById(id);
const PEN = SETTINGS.penalties && SETTINGS.penalties.length ? SETTINGS.penalties : ["warn", "restart", "fail"];
const PEN_TEXT = { warn: "إنذار أحمر وتكمل الاختبار", restart: "إغلاق الاختبار ومسح جميع إجاباتك ثم تبدأ من جديد", fail: "غلق نهائي و<b>رسوب في الاختبار</b>" };
const ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة"];
const MAIN_SCREENS = ["scrLoading", "scrConfig", "scrLogin", "scrRules", "scrWait", "scrRestart", "scrDone", "scrFail", "scrBlocked"];
function show(id) {
  MAIN_SCREENS.forEach(s => $(s).classList.toggle("hidden", s !== id));
  const inExam = id === "scrExam";
  ["scrExam", "examTop", "watermark"].forEach(x => $(x).classList.toggle("hidden", !inExam));
  $("selfcam").classList.toggle("hidden", !(inExam && camStream));
  $("hero").classList.toggle("hidden", inExam);
  $("sMain").classList.toggle("hidden", inExam);
  $("credits").classList.toggle("hidden", inExam);
  const st = { scrLogin: 0, scrRules: 1, scrWait: 1, scrRestart: 2, scrDone: 2, scrFail: 2, scrBlocked: 2 }[id];
  document.querySelectorAll("#steps span").forEach((s, i) => s.classList.toggle("on", st !== undefined && i <= st));
  window.scrollTo(0, 0);
}
function toast(msg, ms = 4000) { const t = $("sToast"); t.innerHTML = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms); }
$("platformName").textContent = SETTINGS.platformName;
$("institution").textContent = SETTINGS.institution || "";
document.title = SETTINGS.platformName;
$("inGroup").innerHTML = `<option value="">— اختر رقم مجموعتك —</option>` +
  Array.from({ length: SETTINGS.groupsCount || 30 }, (_, i) => `<option value="${i + 1}">المجموعة ${i + 1}</option>`).join("");

// ---------------------------------------------------------------- state
let db, exams = {}, exam = null, qById = {}, order = [], optOrder = {}, cur = 0, qPos = 0;
let attemptRef = null, attemptId = "", lockRef = null, me = {}, seatInfo = null, attemptData = null;
let loc = null, locErr = null, answers = {}, violations = 0, flagsSent = 0, restarts = 0;
let running = false, lastViol = 0, startMs = 0, endAt = 0, extraMin = 0, timerInt = null, saveTimer = null, fsEntered = false;
let camStream = null, camOk = false, snapInt = null, hbInt = null, guardInt = null, faceInt = null, base = { w: 0, h: 0 };
let unsubAtt = null, lastMsgAt = 0, selfStatus = null, qDeadline = 0, faceOn = false, faceGrace = 0;
const media = {};
let deviceId = ""; // = هوية الطالب المجهولة في Firebase (ثابتة على نفس الجهاز والمتصفح)
frameGuard();
const params = new URLSearchParams(location.search);
const isTouch = matchMedia("(pointer:coarse)").matches;
const noBack = () => !!(exam && (exam.noBack || exam.perQSec > 0));

// ---------------------------------------------------------------- boot
(async function boot() {
  if (!isConfigured(firebaseConfig)) { show("scrConfig"); return; }
  const app = initializeApp(firebaseConfig);
  await initAppCheck(app, SETTINGS.appCheckSiteKey);
  db = getFirestore(app);
  try { const cred = await signInAnonymously(getAuth(app)); deviceId = cred.user.uid; }
  catch (e) { console.error(e); blocked("⚠️", "تعذّر الاتصال الآمن بالمنصة", "تأكد من اتصالك بالإنترنت ثم أعد تحميل الصفحة. (للمشرف: فعّل Anonymous في Firebase ← Authentication ← Sign-in method)"); return; }
  try { await loadExams(); } catch (e) { console.error(e); blocked("⚠️", "تعذّر الاتصال بالمنصة", "تأكد من اتصالك بالإنترنت ثم أعد تحميل الصفحة."); return; }
  show("scrLogin");
  getLocation();
})();

function windowState(e, now = Date.now()) {
  if (e.openAt && now < e.openAt) return "soon";
  if (e.closeAt && now > e.closeAt) return "closed";
  return "open";
}
async function loadExams() {
  const snap = await getDocs(query(collection(db, "exams"), where("active", "==", true)));
  exams = {}; snap.forEach(d => exams[d.id] = { id: d.id, ...d.data() });
  const sel = $("inExam");
  const list = Object.values(exams).filter(e => windowState(e) !== "closed").sort((a, b) => (a.course || "").localeCompare(b.course || "", "ar"));
  if (!list.length) { sel.innerHTML = `<option value="">لا توجد اختبارات متاحة الآن</option>`; sel.disabled = true; return; }
  sel.innerHTML = `<option value="">— اختر المقرر —</option>` + list.map(e => {
    const soon = windowState(e) === "soon";
    return `<option value="${e.id}" ${soon ? "disabled" : ""}>${esc(e.course)} — ${esc(e.title)}${soon ? ` (يبدأ ${fmtDateTime(e.openAt)})` : ""}</option>`;
  }).join("");
  const pre = params.get("exam");
  if (pre) {
    if (exams[pre] && windowState(exams[pre]) === "open") { sel.value = pre; sel.disabled = true; }
    else loginError(exams[pre] && windowState(exams[pre]) === "soon" ? `هذا الاختبار يبدأ ${fmtDateTime(exams[pre].openAt)}.` : "هذا الاختبار غير متاح حاليًا (لم يُفتح بعد أو تم إغلاقه).");
  }
  onExamChange();
}
function onExamChange() {
  const e = exams[$("inExam").value];
  const roster = !!(e && e.rosterId);
  $("modeRoster").classList.toggle("hidden", !roster);
  $("modeOpen").classList.toggle("hidden", roster);
  seatInfo = null; $("seatCard").classList.add("hidden");
}
$("inExam").onchange = onExamChange;

// ---- البحث برقم الجلوس
let seatT;
$("inSeat").oninput = () => { clearTimeout(seatT); seatInfo = null; $("seatCard").classList.add("hidden"); seatT = setTimeout(lookupSeat, 600); };
async function lookupSeat() {
  const e = exams[$("inExam").value]; const seat = toLatin($("inSeat").value.trim());
  if (!e || !e.rosterId || !seat) return null;
  const c = $("seatCard"); c.className = "seat-card"; c.innerHTML = `<div class="spinner" style="width:22px;height:22px;margin:0"></div>`;
  try {
    const d = await getDoc(doc(db, "students", e.rosterId + "_" + seat));
    if (!d.exists()) { c.className = "seat-card bad"; c.innerHTML = "⚠️ رقم الجلوس غير موجود في كشف هذا المقرر. تأكد من الرقم أو راجع المراقب."; seatInfo = null; return null; }
    seatInfo = { seat, ...d.data() };
    c.className = "seat-card ok"; c.innerHTML = `<div class="av">${esc((seatInfo.name || "?").trim()[0])}</div><div><b>${esc(seatInfo.name)}</b><small>رقم الجلوس ${esc(seat)} • المجموعة ${esc(seatInfo.group)}</small></div><span>✓</span>`;
    return seatInfo;
  } catch (err) { console.error(err); c.className = "seat-card bad"; c.textContent = "تعذّر التحقق، حاول مرة أخرى."; return null; }
}
const toLatin = s => String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\s/g, "");

// ---------------------------------------------------------------- location
function getLocation() {
  setLoc("wait", "جارٍ تحديد موقعك تلقائيًا…", "اسمح للمتصفح بالوصول إلى الموقع عند ظهور الطلب");
  if (!navigator.geolocation) { locErr = "المتصفح لا يدعم تحديد الموقع"; setLoc("bad", locErr, ""); return; }
  navigator.geolocation.getCurrentPosition(async p => {
    loc = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy), address: "" };
    locErr = null;
    setLoc("ok", "تم تحديد موقعك ✓", `دقة التحديد ≈ ${loc.accuracy} متر`);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&zoom=16&accept-language=ar`);
      const j = await r.json();
      if (j && j.display_name) { loc.address = j.display_name.slice(0, 250); setLoc("ok", "تم تحديد موقعك ✓", loc.address); }
    } catch { }
  }, err => {
    loc = null;
    locErr = err.code === 1 ? "تم رفض إذن الوصول إلى الموقع" : "تعذّر تحديد الموقع";
    setLoc("bad", locErr, err.code === 1 ? "افتح إعدادات الموقع في المتصفح واسمح بالوصول ثم اضغط «إعادة المحاولة»" : "تأكد من تشغيل خدمة الموقع (GPS) ثم اضغط «إعادة المحاولة»", true);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}
function setLoc(kind, t, d, retry) {
  const b = $("locBox"); b.className = "loc " + kind;
  b.innerHTML = `<div class="pin">${kind === "ok" ? "✅" : kind === "bad" ? "⚠️" : "📍"}</div>
    <div style="flex:1"><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></div>
    ${retry ? `<button class="btn ghost sm" id="btnLocRetry">إعادة المحاولة</button>` : ""}`;
  if (retry) $("btnLocRetry").onclick = getLocation;
}

// ---------------------------------------------------------------- login
function loginError(msg) { const e = $("loginErr"); e.textContent = msg; e.classList.toggle("hidden", !msg); }
$("btnNext").onclick = async () => {
  loginError("");
  const exId = $("inExam").value;
  if (!exId || !exams[exId]) return loginError("من فضلك اختر المقرر.");
  const e = exams[exId];
  if (e.rosterId) {
    if (!toLatin($("inSeat").value.trim())) return loginError("من فضلك اكتب رقم الجلوس.");
    if (!seatInfo || seatInfo.seat !== toLatin($("inSeat").value.trim())) { await lookupSeat(); if (!seatInfo) return loginError("رقم الجلوس غير صحيح."); }
    me = { name: seatInfo.name, group: String(seatInfo.group), seat: seatInfo.seat };
  } else {
    const name = $("inName").value.trim().replace(/\s+/g, " ");
    const group = $("inGroup").value;
    if (name.split(" ").length < 3 || name.length < 8) return loginError("من فضلك اكتب اسمك ثلاثيًا على الأقل.");
    if (/[0-9٠-٩@#$%]/.test(name)) return loginError("الاسم يجب أن يحتوي على حروف فقط.");
    if (!group) return loginError("من فضلك اختر رقم المجموعة.");
    me = { name, group, seat: "" };
  }
  if (SETTINGS.requireLocation && !loc) return loginError("يجب السماح بتحديد الموقع لدخول الاختبار.");

  const btn = $("btnNext"); btn.disabled = true; btn.textContent = "جارٍ التحقق…";
  try {
    // الأسئلة محمية: لا تُقرأ إلا أثناء موعد الاختبار
    let qd = null;
    try { qd = await getDoc(doc(db, "examQuestions", exId)); } catch (err) { console.warn(err); }
    if (!qd || !qd.exists()) return blocked("⏳", "الاختبار غير متاح الآن", "لم يبدأ موعد الاختبار بعد أو تم إغلاقه. حاول مرة أخرى في الموعد المحدد.");
    exam = { ...e, questions: qd.data().questions || [] };
    qById = Object.fromEntries(exam.questions.map(q => [q.id, q]));
    attemptId = me.seat ? `${exId}_s${me.seat}` : exId + "_" + hashStr(normalizeName(me.name) + "|" + me.group);
    attemptRef = doc(db, "attempts", attemptId);
    lockRef = doc(db, "deviceLocks", exId + "_" + deviceId);

    let ex;
    try { ex = await getDoc(attemptRef); }
    catch (err) { if (err.code === "permission-denied") return requestReturnOther(); throw err; }
    if (ex.exists()) {
      const a = ex.data();
      if (a.status === "in_progress" || a.status === "suspended") return waitingRoom(a);
      if (a.status === "locked") return failScreen(a.lockedReason);
      blocked("⛔", "لقد دخلت هذا الاختبار من قبل", "لا يُسمح بدخول الاختبار أكثر من مرة. إذا كانت هناك مشكلة تواصل مع المشرف.");
      return;
    }
    const lk = await getDoc(lockRef);
    if (lk.exists() && lk.data().attemptId !== attemptId)
      return blocked("📵", "هذا الجهاز مُستخدَم بالفعل", "تم استخدام هذا الجهاز لدخول نفس الاختبار باسم طالب آخر. لا يُسمح بدخول أكثر من طالب من نفس الجهاز.");

    renderRules();
    $("agree").checked = false;
    show("scrRules");
    await runChecks();
  } catch (err) {
    console.error(err); loginError("تعذّر الاتصال، حاول مرة أخرى.");
  } finally { btn.disabled = false; btn.textContent = "متابعة ←"; }
};
$("btnBack").onclick = () => { stopCamera(); clearInterval(faceInt); show("scrLogin"); };

function renderRules() {
  $("rTitle").textContent = exam.title;
  const n = exam.drawCount > 0 && exam.drawCount < exam.questions.length ? exam.drawCount : exam.questions.length;
  $("rChips").innerHTML = `<span class="chip blue">📚 ${esc(exam.course)}</span><span class="chip">📝 ${n} سؤال</span>
    <span class="chip">⏱️ ${exam.duration} دقيقة</span><span class="chip blue">👤 ${esc(me.name)} — مجموعة ${esc(me.group)}${me.seat ? ` — جلوس ${esc(me.seat)}` : ""}</span>`;
  const R = [];
  R.push(["⏱️", "الوقت محسوب", "يبدأ العدّاد عند الضغط على «ابدأ الاختبار» ويُسلَّم تلقائيًا عند انتهاء الوقت.", ""]);
  if (exam.perQSec > 0) R.push(["⏳", `وقت محدد لكل سؤال: ${exam.perQSec} ثانية`, "عند انتهاء وقت السؤال ينتقل الاختبار للسؤال التالي تلقائيًا ولا يمكن الرجوع إليه.", ""]);
  else if (exam.noBack) R.push(["🔒", "لا يمكن الرجوع للسؤال السابق", "بعد الانتقال للسؤال التالي لا يمكنك العودة لتعديل إجابتك.", ""]);
  if (exam.negative > 0) R.push(["➖", "توجد درجة سالبة", `كل إجابة خاطئة في أسئلة الاختيار والصح والخطأ يُخصم عليها ${exam.negative === 0.25 ? "ربع" : exam.negative === 0.5 ? "نصف" : exam.negative >= 0.33 && exam.negative < 0.34 ? "ثلث" : exam.negative} درجة السؤال. اترك السؤال إن لم تكن متأكدًا.`, ""]);
  R.push(["🔀", "أسئلتك بترتيب خاص بك", "كل طالب يرى أسئلة واختيارات بترتيب مختلف" + (exam.drawCount > 0 && exam.drawCount < exam.questions.length ? "، وتُسحب الأسئلة عشوائيًا من بنك الأسئلة." : "."), ""]);
  R.push(["🚫", "أي خروج من صفحة الاختبار = محاولة غش", "فتح تطبيق أو تبويب أو نافذة أخرى، تقسيم الشاشة، الخروج من ملء الشاشة، إيقاف الكاميرا" + (exam.faceAI ? "، الابتعاد عن الكاميرا أو ظهور شخص آخر" : "") + "، أو إغلاق الصفحة — كلها تُرصد وتُصوَّر وتُرسل للمشرف فورًا.", "red"]);
  R.push(["⚖️", "عقوبات محاولات الغش", PEN.map((p, i) => `المرة ${ORD[i] || i + 1}: ${PEN_TEXT[p]}`).join("<br>"), "red"]);
  $("rulesList").innerHTML = R.map(([ic, b, s, c]) => `<div class="rule ${c}"><div class="ic">${ic}</div><div><b>${b}</b><small>${s}</small></div></div>`).join("");
}

// ---------------------------------------------------------------- pre-exam checks
let checks = {};
function renderChecks() {
  const rows = [
    ["id", "بيانات الطالب", me.seat ? "تم التحقق من رقم الجلوس" : "تم التحقق من الاسم والمجموعة"],
    ["loc", "تحديد الموقع", loc ? "تم تحديد موقعك" : "غير متاح"],
    exam.camera ? ["cam", "الكاميرا", camOk ? "تعمل بشكل سليم" : checks.cam === "wait" ? "جارٍ التشغيل…" : "مطلوبة — اسمح بالوصول للكاميرا"] : null,
    exam.camera && exam.faceAI ? ["face", "كشف الوجه", checks.faceMsg || "…"] : null,
    ["screen", "شاشة واحدة فقط", checks.screen ? "لا توجد شاشات إضافية" : "افصل الشاشة الإضافية ثم أعد المحاولة"],
    ["net", "الاتصال بالإنترنت", navigator.onLine ? "متصل" : "غير متصل"]
  ].filter(Boolean);
  $("checks").innerHTML = rows.map(([k, t, d]) => {
    const st = k === "id" ? true : k === "loc" ? (!!loc || !SETTINGS.requireLocation) : k === "cam" ? (checks.cam === "wait" ? "wait" : camOk) : k === "face" ? checks.face : k === "net" ? navigator.onLine : checks.screen;
    return `<div class="chk ${st === "wait" ? "wait" : st ? "ok" : "bad"}"><i>${st === "wait" ? "…" : st ? "✓" : "✕"}</i><div><b>${t}</b><small>${esc(d)}</small></div></div>`;
  }).join("");
  updateStartBtn();
}
function allChecksOk() {
  return (!exam.camera || camOk) && (!(exam.camera && exam.faceAI) || checks.face === true) && checks.screen && navigator.onLine && (!SETTINGS.requireLocation || loc);
}
function updateStartBtn() { $("btnStart").disabled = !($("agree").checked && allChecksOk()); }
$("agree").onchange = updateStartBtn;

async function runChecks() {
  checks = { screen: !(SETTINGS.blockMultiScreen && window.screen && window.screen.isExtended === true) };
  $("camSetup").classList.toggle("hidden", !exam.camera);
  renderChecks();
  if (exam.camera) { checks.cam = "wait"; renderChecks(); await startCamera(); }
  if (exam.camera && exam.faceAI) startFaceCheck();
  renderChecks();
}
async function startCamera() {
  $("btnCamRetry").classList.add("hidden");
  $("camTag").textContent = "جارٍ تشغيل الكاميرا…";
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    $("camPreview").srcObject = camStream; $("camLive").srcObject = camStream;
    camOk = true; checks.cam = true; $("camTag").textContent = "● الكاميرا تعمل";
    camStream.getVideoTracks()[0].onended = () => { camOk = false; if (running) violation("إيقاف الكاميرا أثناء الاختبار"); };
  } catch (e) {
    console.error(e); camOk = false; checks.cam = false; camStream = null;
    $("camTag").textContent = e.name === "NotAllowedError" ? "تم رفض إذن الكاميرا" : "لا توجد كاميرا متاحة";
    $("btnCamRetry").classList.remove("hidden");
  }
  renderChecks();
}
$("btnCamRetry").onclick = async () => { checks.cam = "wait"; renderChecks(); await startCamera(); if (exam.faceAI) startFaceCheck(); };
function stopCamera() { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; camOk = false; }

async function startFaceCheck() {
  checks.face = "wait"; checks.faceMsg = "جارٍ تحميل كشف الوجه بالذكاء الاصطناعي…"; renderChecks();
  const ok = await loadFaceDetector();
  if (!ok) { faceOn = false; checks.face = true; checks.faceMsg = "تعذّر تشغيل كشف الوجه على هذا الجهاز — ستُستخدم الصور فقط"; renderChecks(); return; }
  faceOn = true;
  let good = 0;
  clearInterval(faceInt);
  faceInt = setInterval(() => {
    if (running || $("scrRules").classList.contains("hidden")) return;
    const r = detectFaces($("camPreview")); if (!r) return;
    const g = $("camGuide");
    if (r.count === 1) { good++; g.className = "cam-guide ok"; if (good >= 2) { checks.face = true; checks.faceMsg = "تم التعرف على وجهك ✓"; } }
    else { good = 0; g.className = "cam-guide bad"; checks.face = false; checks.faceMsg = r.count === 0 ? "لا يظهر وجهك — اجلس أمام الكاميرا في مكان مضاء" : "يظهر أكثر من شخص أمام الكاميرا"; }
    renderChecks();
  }, 700);
}

// ---------------------------------------------------------------- evidence (صور الكاميرا)
function snapshot() {
  if (!camStream) return null;
  const cands = [$("camLive"), $("camPreview")].filter(x => x.srcObject && x.offsetParent !== null);
  cands.forEach(x => { if (x.paused) x.play().catch(() => { }); });
  const v = cands.find(x => x.videoWidth && !x.paused);
  if (!v) return null;
  const c = document.createElement("canvas"); const w = 320, h = Math.round(320 * v.videoHeight / v.videoWidth);
  c.width = w; c.height = h; const g = c.getContext("2d");
  g.drawImage(v, 0, 0, w, h);
  let sum = 0; const px = g.getImageData(0, 0, w, h).data;
  for (let i = 0; i < px.length; i += 40) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
  const bright = sum / (px.length / 40);
  g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, h - 18, w, 18);
  g.fillStyle = "#fff"; g.font = "11px sans-serif"; g.textAlign = "right";
  g.fillText(`${me.name} • م${me.group} • ${new Date().toLocaleTimeString("ar-EG")}`, w - 6, h - 5);
  return { img: c.toDataURL("image/jpeg", 0.6), bright };
}
async function saveEvidence(kind, type) {
  const s = snapshot(); if (!s) return null;
  if (s.bright < 18 && kind !== "violation") flag("الكاميرا مغطاة أو الصورة مظلمة جدًا");
  const p = addDoc(collection(db, "attempts", attemptId, "evidence"), { at: Date.now(), kind, type: type || "", img: s.img, dark: s.bright < 18 }).catch(console.error);
  await Promise.race([p, new Promise(r => setTimeout(r, 4000))]);
  return s.img;
}

// ---------------------------------------------------------------- Telegram
function tg(text, photo) {
  if (!SETTINGS.telegramRelayUrl || !exam || !exam.notifyChat) return;
  try {
    fetch(SETTINGS.telegramRelayUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ chat: exam.notifyChat, text, photo: photo ? photo.split(",")[1] : "" }) }).catch(() => { });
  } catch { }
}
const who = () => `👤 ${me.name}\n👥 مجموعة ${me.group}${me.seat ? ` • جلوس ${me.seat}` : ""}\n📚 ${exam.course} — ${exam.title}`;

// ---------------------------------------------------------------- start / resume
$("btnStart").onclick = async () => {
  if (!allChecksOk()) return;
  const btn = $("btnStart"); btn.disabled = true; btn.textContent = "جارٍ البدء…";
  enterFullscreen();
  const now = Date.now();
  const qIds = pickQuestions(exam, attemptId);
  try {
    await setDoc(attemptRef, {
      examId: exam.id, examTitle: exam.title, course: exam.course, owner: exam.owner || "",
      name: me.name, nameKey: normalizeName(me.name), group: me.group, seat: me.seat || "", rosterId: exam.rosterId || "",
      uid: deviceId, deviceId, location: loc, locationError: locErr, camera: !!camOk, faceAI: !!(exam.faceAI && faceOn),
      status: "in_progress", startedAt: serverTimestamp(), startedAtMs: now, durationMin: exam.duration,
      qIds, answers: {}, qPos: 0, restarts: 0, violations: [], violationCount: 0, flags: [], flagCount: 0, qCount: qIds.length,
      screen: `${screen.width}×${screen.height}`, touch: isTouch, lastSeenMs: now,
      userAgent: navigator.userAgent.slice(0, 200)
    });
    setDoc(lockRef, { attemptId, examId: exam.id, uid: deviceId, name: me.name, at: serverTimestamp() }).catch(() => { });
  } catch (e) {
    console.error(e); exitFullscreen();
    btn.disabled = false; btn.textContent = "ابدأ الاختبار الآن";
    return blocked("⛔", "لا يمكن بدء الاختبار", "يبدو أن هذا الطالب دخل الاختبار بالفعل من جهاز آخر.");
  }
  beginExam({ startedAtMs: now, qIds, answers: {}, qPos: 0, violationCount: 0, restarts: 0, extraMin: 0 });
  setTimeout(() => saveEvidence("start", "صورة بداية الاختبار"), 800);
};

// غرفة الانتظار: الطالب خرج من الاختبار (انقطاع كهرباء/إنترنت أو إغلاق الصفحة)
async function waitingRoom(a) {
  attemptData = a;
  me = { name: a.name, group: String(a.group), seat: a.seat || "" };
  const sameDevice = (a.uid || a.deviceId) === deviceId;
  if (a.status === "suspended") {
    if (!sameDevice && !((a.resumeGrant || 0) > (a.resumeUsed || 0))) return requestReturn(a, sameDevice);
    return showRestartScreen(a);
  }
  if ((a.resumeGrant || 0) > (a.resumeUsed || 0)) return grantedReady(a);
  requestReturn(a, sameDevice);
}
function requestReturn(a, sameDevice) {
  show("scrWait");
  $("waitMsg").innerHTML = "تم إرسال طلب عودة للمراقب. انتظر موافقته وستعود لاختبارك <b>بنفس إجاباتك ودون احتساب مخالفة</b>.";
  $("btnReturnPenalty").classList.toggle("hidden", !sameDevice || a.status === "suspended");
  $("btnGranted").classList.add("hidden");
  updateDoc(attemptRef, { resumeReq: Date.now() }).catch(console.error);
  tg(`⏳ طلب عودة للاختبار\n${who()}\nافتح لوحة المشرف للسماح له بالعودة.`);
  listenAttempt();
}
function grantedReady(a) {
  show("scrWait");
  $("waitMsg").innerHTML = "<b style='color:var(--ok)'>وافق المراقب على عودتك ✓</b><br>اضغط الزر للمتابعة من حيث توقفت.";
  $("btnGranted").classList.remove("hidden"); $("btnReturnPenalty").classList.add("hidden");
  $("btnGranted").onclick = () => doResume(a, true);
}
$("btnReturnPenalty").onclick = () => doResume(attemptData, false);

// الطالب يحاول العودة من جهاز/متصفح آخر: لا يستطيع قراءة محاولته حتى يوافق المراقب
let unsubReq = null;
function requestReturnOther() {
  show("scrWait");
  $("waitMsg").innerHTML = "هذا الاختبار بدأ من <b>جهاز آخر</b>. تم إرسال طلب للمراقب لنقل اختبارك لهذا الجهاز — انتظر موافقته.";
  $("btnReturnPenalty").classList.add("hidden"); $("btnGranted").classList.add("hidden");
  const ref = doc(db, "resumeRequests", attemptId);
  setDoc(ref, { uid: deviceId, at: Date.now(), examId: exam.id, owner: exam.owner || "", name: me.name, group: me.group, seat: me.seat || "", granted: false, denied: false })
    .catch(err => { console.error(err); blocked("⛔", "لا يمكن الدخول", "تعذّر إرسال طلب العودة. راجع المراقب."); });
  tg(`⏳ طلب عودة من جهاز آخر\n${who()}\nافتح لوحة المشرف للسماح له.`);
  if (unsubReq) unsubReq();
  unsubReq = onSnapshot(ref, async snap => {
    const r = snap.data(); if (!r) return;
    if (r.denied) { unsubReq(); unsubReq = null; return blocked("⛔", "رفض المراقب طلبك", "لا يُسمح لك بالدخول للاختبار من هذا الجهاز. راجع المراقب."); }
    if (r.granted) {
      unsubReq(); unsubReq = null;
      try { const d = await getDoc(attemptRef); if (d.exists()) { const a = d.data(); attemptData = a; grantedReady(a); } }
      catch (err) { console.error(err); }
    }
  }, err => console.warn(err));
}

async function doResume(a, granted) {
  enterFullscreen();
  if (exam.camera) { await startCamera(); if (exam.faceAI) faceOn = await loadFaceDetector(); }
  const upd = { lastSeenMs: Date.now() };
  if (granted) { upd.resumeUsed = a.resumeGrant || 0; upd.deviceId = deviceId; }
  updateDoc(attemptRef, upd).catch(console.error);
  if (granted && (a.uid || a.deviceId) !== deviceId) setDoc(lockRef, { attemptId, examId: exam.id, uid: deviceId, name: me.name, at: serverTimestamp() }).catch(() => { });
  if (a.status === "suspended") return showRestartScreen(a);
  // استرجاع الإجابات المحفوظة على الجهاز إن كانت أحدث
  const local = readLocal();
  let ans = a.answers || {};
  if (local && (local.restarts || 0) === (a.restarts || 0) && local.at > (a.lastSeenMs || 0)) ans = { ...ans, ...local.answers };
  beginExam({ ...a, answers: ans, qPos: Math.max(a.qPos || 0, local && (local.restarts || 0) === (a.restarts || 0) ? local.qPos || 0 : 0) });
  if (Date.now() >= endAt) return finalize(true);
  if (granted) toast("✓ تمت عودتك للاختبار بنفس إجاباتك");
  else violation("الخروج من صفحة الاختبار ثم العودة إليها", true);
  if (exam.camera && !camOk) setTimeout(() => violation("الكاميرا غير مفعّلة بعد العودة للاختبار", true), 3000);
}

// ---------------------------------------------------------------- local backup (offline)
const LKEY = () => "qz_ans_" + attemptId;
function writeLocal() { try { localStorage.setItem(LKEY(), JSON.stringify({ answers, qPos, restarts, at: Date.now() })); } catch { } }
function readLocal() { try { return JSON.parse(localStorage.getItem(LKEY()) || "null"); } catch { return null; } }
function clearLocal() { try { localStorage.removeItem(LKEY()); } catch { } }

// ---------------------------------------------------------------- exam
function beginExam(a) {
  answers = { ...(a.answers || {}) }; violations = a.violationCount || 0; restarts = a.restarts || 0;
  extraMin = a.extraMin || 0; startMs = a.startedAtMs;
  order = (a.qIds && a.qIds.length ? a.qIds : pickQuestions(exam, attemptId)).filter(id => qById[id]);
  optOrder = {};
  order.forEach(id => {
    const q = qById[id], t = q.type || "mcq";
    if (t === "mcq") optOrder[id] = exam.shuffleOptions ? seededShuffle(q.options.map((_, i) => i), attemptId + id) : q.options.map((_, i) => i);
    else if (t === "tf") optOrder[id] = q.options.map((_, i) => i);
    else if (t === "order") optOrder[id] = seededShuffle(q.items.map((_, i) => i), attemptId + id);
  });
  computeEnd();
  qPos = Math.min(a.qPos || 0, order.length - 1);
  cur = noBack() ? qPos : 0;
  $("barTitle").textContent = `${exam.course} — ${exam.title}`;
  $("barWho").textContent = `${me.name} • مجموعة ${me.group}${me.seat ? " • جلوس " + me.seat : ""}`;
  $("qOf").textContent = order.length; $("ansTotal").textContent = order.length;
  $("btnPrev").classList.toggle("hidden", noBack());
  $("navNote").classList.toggle("hidden", !noBack());
  const wm = `${me.name} • م${me.group}${me.seat ? " • " + me.seat : ""} • ${deviceId.slice(-5)}`;
  $("watermark").innerHTML = Array.from({ length: 40 }, () => `<span>${esc(wm)}</span>`).join("");
  updateWarnBadge();
  show("scrExam");
  if (camStream) { const cl = $("camLive"); if (!cl.srcObject) cl.srcObject = camStream; cl.play().catch(() => { }); }
  running = true; selfStatus = "in_progress";
  qDeadline = 0; renderQ(); renderNav(); tick();
  startTimers();
  listenAttempt();
}
function computeEnd() {
  endAt = startMs + (exam.duration + (extraMin || 0)) * 60000;
  if (exam.closeAt) endAt = Math.min(endAt, exam.closeAt + (extraMin || 0) * 60000);
}
function startTimers() {
  [timerInt, hbInt, snapInt, guardInt].forEach(clearInterval);
  timerInt = setInterval(tick, 1000);
  hbInt = setInterval(() => updateDoc(attemptRef, { lastSeenMs: Date.now() }).catch(() => { }), 30000);
  if (exam.camera) snapInt = setInterval(() => saveEvidence("periodic", "صورة دورية"), (SETTINGS.snapshotEveryMin || 2) * 60000);
  setTimeout(() => { base = { w: innerWidth, h: innerHeight }; }, 1200);
  guardInt = setInterval(guardTick, 1500);
  startFaceMonitor();
}

// ---- عرض الأسئلة بكل أنواعها
const ptsText = p => p === 1 ? "درجة واحدة" : p === 2 ? "درجتان" : `${p} درجات`;
function renderQ() {
  const q = qById[order[cur]], t = q.type || "mcq";
  if (noBack() && exam.perQSec > 0 && !qDeadline) qDeadline = Date.now() + exam.perQSec * 1000;
  $("qNo").textContent = cur + 1;
  $("qPts").textContent = ptsText(q.points || 1);
  $("qType").textContent = TYPE_LABEL[t] || "";
  $("qText").textContent = q.text;
  renderImage(q);
  const box = $("qOpts"); box.className = "opts t-" + t;
  if (t === "mcq" || t === "tf") {
    box.innerHTML = optOrder[q.id].map((oi, pos) =>
      `<button class="opt ${answers[q.id] === oi ? "sel" : ""}" data-i="${oi}"><span class="lt">${LETTERS[pos] || pos + 1}</span><span>${esc(q.options[oi])}</span></button>`).join("");
    box.querySelectorAll(".opt").forEach(b => b.onclick = () => { setAns(q.id, +b.dataset.i); renderQ(); });
  } else if (t === "match") {
    const v = Array.isArray(answers[q.id]) ? answers[q.id] : q.left.map(() => -1);
    box.innerHTML = `<p class="hint">اختر لكل عنصر من العمود الأول ما يناسبه من القائمة:</p>` + q.left.map((l, i) => `
      <div class="mrow ${v[i] >= 0 ? "done" : ""}"><div class="ml"><span class="lt">${i + 1}</span>${esc(l)}</div><div class="arr">⟵</div>
      <select class="input msel" data-i="${i}"><option value="-1">— اختر —</option>${q.right.map((r, j) => `<option value="${j}" ${v[i] === j ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></div>`).join("");
    box.querySelectorAll(".msel").forEach(s => s.onchange = () => {
      const arr = Array.isArray(answers[q.id]) ? [...answers[q.id]] : q.left.map(() => -1);
      arr[+s.dataset.i] = +s.value; setAns(q.id, arr); s.closest(".mrow").classList.toggle("done", +s.value >= 0);
    });
  } else if (t === "order") {
    const v = Array.isArray(answers[q.id]) ? answers[q.id] : optOrder[q.id];
    const touched = Array.isArray(answers[q.id]);
    box.innerHTML = `<p class="hint">رتّب العناصر بالضغط على الأسهم ▲ ▼ (الأول في الأعلى):</p><ol class="olist">${v.map((ii, pos) => `
      <li><span class="lt">${pos + 1}</span><span class="otx">${esc(q.items[ii])}</span>
      <span class="oarr"><button data-p="${pos}" data-d="-1" ${pos === 0 ? "disabled" : ""}>▲</button><button data-p="${pos}" data-d="1" ${pos === v.length - 1 ? "disabled" : ""}>▼</button></span></li>`).join("")}</ol>
      ${touched ? `<p class="hint ok">✓ تم حفظ ترتيبك</p>` : `<button class="btn ghost sm" id="btnKeepOrder">✓ اعتماد هذا الترتيب كإجابتي</button>`}`;
    box.querySelectorAll(".oarr button").forEach(b => b.onclick = () => {
      const arr = [...v], p = +b.dataset.p, d = +b.dataset.d;
      [arr[p], arr[p + d]] = [arr[p + d], arr[p]]; setAns(q.id, arr); renderQ();
    });
    const k = $("btnKeepOrder"); if (k) k.onclick = () => { setAns(q.id, [...v]); renderQ(); };
  } else if (t === "fill") {
    box.innerHTML = `<input class="input fill-in" id="fillIn" autocomplete="off" spellcheck="false" placeholder="اكتب الإجابة هنا" value="${esc(answers[q.id] || "")}">`;
    $("fillIn").oninput = e => setAns(q.id, e.target.value, true);
  } else if (t === "essay") {
    box.innerHTML = `<textarea class="input essay-in" id="essayIn" rows="8" spellcheck="false" placeholder="اكتب إجابتك هنا…">${esc(answers[q.id] || "")}</textarea><small class="hint" id="essayCnt"></small>`;
    const ta = $("essayIn"), cnt = () => $("essayCnt").textContent = `${(ta.value.trim().match(/\S+/g) || []).length} كلمة`;
    ta.oninput = () => { setAns(q.id, ta.value, true); cnt(); }; cnt();
  }
  $("btnPrev").disabled = cur === 0;
  const last = cur === order.length - 1;
  $("btnNextQ").textContent = last ? "مراجعة وتسليم ✓" : "التالي ←";
  $("btnNextQ").className = "btn " + (last ? "gold" : "primary");
}
async function renderImage(q) {
  const box = $("qImg");
  if (q.img == null && !q.imgUrl) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  if (q.imgUrl) { box.innerHTML = `<img src="${esc(q.imgUrl)}" alt="">`; return; }
  const id = q.img;
  if (!media[id]) {
    box.innerHTML = `<div class="spinner" style="width:28px;height:28px"></div>`;
    try { const d = await getDoc(doc(db, "media", String(id))); media[id] = d.exists() ? d.data().data : ""; } catch { media[id] = ""; }
  }
  if (qById[order[cur]] === q) box.innerHTML = media[id] ? `<img src="${media[id]}" alt="">` : "";
}
function renderNav() {
  $("qNav").innerHTML = order.map((id, i) =>
    `<button class="${isAnswered(qById[id], answers[id]) ? "done" : ""} ${i === cur ? "cur" : ""}" data-i="${i}" ${noBack() && i !== cur ? "disabled" : ""}>${i + 1}</button>`).join("");
  $("qNav").querySelectorAll("button").forEach(b => b.onclick = () => go(+b.dataset.i));
  const n = order.filter(id => isAnswered(qById[id], answers[id])).length;
  $("ansCount").textContent = n;
  $("progBar").style.width = (n / order.length * 100) + "%";
}
function go(i) {
  if (i < 0 || i >= order.length || i === cur) return;
  if (noBack() && i < cur) return;
  cur = i; if (noBack()) { qPos = Math.max(qPos, cur); qDeadline = 0; saveSoon(); }
  renderQ(); renderNav();
}
function setAns(qid, v, typing) {
  if (!running) return;
  answers[qid] = v; writeLocal();
  if (typing) renderNav(); else renderNav();
  saveSoon();
}
function saveSoon() {
  writeLocal();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => updateDoc(attemptRef, { answers, qPos, lastSeenMs: Date.now() }).catch(console.error), 800);
}
$("btnPrev").onclick = () => go(cur - 1);
$("btnNextQ").onclick = () => { if (cur < order.length - 1) go(cur + 1); else askSubmit(); };
$("btnSubmit").onclick = askSubmit;

function askSubmit() {
  const left = order.filter(id => !isAnswered(qById[id], answers[id])).length;
  $("confirmMsg").innerHTML = left
    ? `<b style="color:var(--danger)">لم تُجب عن ${left} ${left <= 10 ? "أسئلة" : "سؤالًا"}.</b><br>بعد التسليم لا يمكنك تعديل إجاباتك.`
    : "أجبت عن جميع الأسئلة 👏 — بعد التسليم لا يمكنك تعديل إجاباتك.";
  $("confirmOverlay").classList.remove("hidden");
}
$("btnCancel").onclick = () => $("confirmOverlay").classList.add("hidden");
$("btnConfirm").onclick = () => { $("confirmOverlay").classList.add("hidden"); finalize(false); };

function tick() {
  const left = (endAt - Date.now()) / 1000;
  const t = $("timer"); t.textContent = mmss(left);
  t.classList.toggle("low", left <= 60);
  if (left <= 0 && running) return finalize(true);
  const qt = $("qTimer");
  if (running && exam.perQSec > 0 && qDeadline) {
    const ql = Math.ceil((qDeadline - Date.now()) / 1000);
    qt.classList.remove("hidden"); qt.querySelector("b").textContent = Math.max(0, ql); qt.classList.toggle("low", ql <= 5);
    if (ql <= 0) { if (cur < order.length - 1) go(cur + 1); else finalize(true); }
  } else qt.classList.add("hidden");
}

function stopExam(keepCamera) {
  running = false;
  [timerInt, hbInt, snapInt, guardInt, faceInt].forEach(clearInterval); clearTimeout(saveTimer);
  ["warnOverlay", "confirmOverlay", "msgOverlay"].forEach(x => $(x).classList.add("hidden"));
  exitFullscreen();
  if (!keepCamera) stopCamera();
}

async function finalize(auto, byAdmin) {
  if (!running) return;
  const endShot = exam.camera ? saveEvidence("end", auto ? "صورة نهاية الوقت" : "صورة لحظة التسليم") : null;
  selfStatus = "submitted";
  stopExam(true);
  const n = order.filter(id => isAnswered(qById[id], answers[id])).length;
  $("doneTitle").textContent = byAdmin ? "أنهى المراقب اختبارك" : "تم تسليم الاختبار بنجاح";
  $("doneMsg").innerHTML = `${byAdmin ? "تم إنهاء الاختبار بواسطة المراقب وحفظ إجاباتك." : auto ? "انتهى الوقت وتم تسليم إجاباتك تلقائيًا." : "تم استلام إجاباتك."}<br>
    أجبت عن <b>${n}</b> من <b>${order.length}</b> سؤال. تم حفظ إجاباتك وإرسالها لأستاذ المقرر.`;
  show("scrDone");
  const ss = $("saveState"); ss.textContent = navigator.onLine ? "جارٍ حفظ إجاباتك…" : "⏳ في انتظار عودة الإنترنت لإرسال إجاباتك — لا تغلق الصفحة";
  try {
    await endShot;
    if (!byAdmin) await updateDoc(attemptRef, { answers, qPos, status: "submitted", submittedAt: serverTimestamp(), submittedAtMs: Date.now(), autoSubmitted: !!auto });
    ss.textContent = "✓ تم حفظ إجاباتك على الخادم"; ss.style.color = "var(--ok)"; clearLocal();
  } catch (e) {
    console.error(e); ss.textContent = "⚠️ لم يكتمل الحفظ — لا تغلق الصفحة وتأكد من الإنترنت"; ss.style.color = "var(--danger)";
  }
  stopCamera(); if (unsubAtt) { unsubAtt(); unsubAtt = null; }
}

// ---------------------------------------------------------------- التحكم المباشر من المراقب
function listenAttempt() {
  if (unsubAtt) return;
  unsubAtt = onSnapshot(attemptRef, snap => {
    if (!snap.exists()) {
      if (running) { stopExam(); blocked("↺", "ألغى المراقب محاولتك", "يمكنك الآن إعادة تحميل الصفحة والدخول للاختبار من جديد."); }
      return;
    }
    const a = snap.data(); attemptData = a;
    if ((a.extraMin || 0) !== extraMin && running) {
      const diff = (a.extraMin || 0) - extraMin; extraMin = a.extraMin || 0; computeEnd(); tick();
      if (diff > 0) toast(`⏱ أضاف المراقب ${diff} ${diff <= 10 ? "دقائق" : "دقيقة"} لوقتك`, 6000);
    }
    if (a.msg && a.msg.at > lastMsgAt) {
      const first = lastMsgAt === 0 && a.msg.at < Date.now() - 120000; lastMsgAt = a.msg.at;
      if (!first && running) { $("msgText").textContent = a.msg.text; $("msgOverlay").classList.remove("hidden"); try { navigator.vibrate && navigator.vibrate(200); } catch { } }
    }
    if (running && a.status === "submitted" && selfStatus !== "submitted") finalize(false, true);
    if (running && a.status === "locked" && selfStatus !== "locked") { selfStatus = "locked"; stopExam(); failScreen(a.lockedReason || "قرار المراقب"); }
    if (!running && !$("scrWait").classList.contains("hidden") && (a.resumeGrant || 0) > (a.resumeUsed || 0)) {
      if (a.status === "suspended") { $("waitMsg").innerHTML = "<b style='color:var(--ok)'>وافق المراقب ✓</b>"; return showRestartScreen(a); }
      grantedReady(a);
    }
  }, err => console.warn(err));
}
$("btnMsgOk").onclick = () => $("msgOverlay").classList.add("hidden");

// ---------------------------------------------------------------- anti-cheat: سلّم العقوبات
function updateWarnBadge() {
  const b = $("warnBadge");
  b.classList.toggle("hidden", violations === 0);
  b.textContent = `⚠️ إنذار ${violations} من ${PEN.length}`;
}
async function violation(type, force) {
  if (!running) return;
  const now = Date.now();
  if (!force && now - lastViol < 2500) return;
  lastViol = now; faceGrace = now + 10000;
  violations++;
  const level = PEN[Math.min(violations, PEN.length) - 1];
  const v = { type, at: now, level };
  const upd = { violations: arrayUnion(v), violationCount: violations, lastViolationAt: serverTimestamp(), lastSeenMs: now };
  const shot = exam.camera ? saveEvidence("violation", type) : Promise.resolve(null);
  if (level === "fail") {
    Object.assign(upd, { answers, status: "locked", failed: true, lockedReason: type, submittedAt: serverTimestamp(), submittedAtMs: now });
    selfStatus = "locked"; stopExam(true);
    failScreen(type);
    try { await updateDoc(attemptRef, upd); } catch (e) { console.error(e); }
    shot.then(img => tg(`⛔ رسوب — غلق نهائي للاختبار\n${who()}\nالسبب: ${type}\nإجمالي المحاولات: ${violations}`, img)).finally(stopCamera);
    clearLocal(); if (unsubAtt) { unsubAtt(); unsubAtt = null; }
    return;
  }
  if (level === "restart") {
    restarts++;
    Object.assign(upd, { answers: {}, qPos: 0, status: "suspended", restarts });
    answers = {}; qPos = 0; cur = 0; selfStatus = "suspended";
    stopExam(true); clearLocal();
    showRestartScreen({ ...attemptData, status: "suspended" }, type);
  } else {
    Object.assign(upd, { answers });
    updateWarnBadge();
    $("warnWhy").textContent = type;
    const next = PEN[violations];
    $("warnNext").innerHTML = next === "restart" ? "إذا تكررت سيتم إغلاق الاختبار ومسح جميع إجاباتك." : next === "fail" ? "إذا تكررت سيتم غلق الاختبار نهائيًا واعتبارك راسبًا." : "تم تسجيل الإنذار.";
    $("warnOverlay").classList.remove("hidden");
    try { navigator.vibrate && navigator.vibrate([300, 120, 300]); } catch { }
  }
  try { await updateDoc(attemptRef, upd); } catch (e) { console.error(e); }
  shot.then(img => tg(`${level === "restart" ? "🗑 إنذار ثانٍ — إغلاق ومسح الإجابات" : "🚨 محاولة غش — إنذار أول"}\n${who()}\nالسبب: ${type}`, img));
}
function showRestartScreen(a, type) {
  attemptData = a;
  const next = PEN[Math.max(a.violationCount || 0, violations)];
  $("restartMsg").innerHTML = `تم رصد محاولة غش${type ? ` (<b>${esc(type)}</b>)` : ""}، لذلك <b>تم إغلاق الاختبار ومسح جميع إجاباتك</b>. يمكنك الدخول مرة أخرى والإجابة من البداية — <b>الوقت مستمر ولن يتوقف</b>.`;
  document.querySelector("#scrRestart .final-warn").innerHTML = next === "fail" || !next ? "⚠️ أي محاولة غش أخرى = <b>غلق نهائي ورسوب في الاختبار</b>" : "⚠️ تكرار الغش سيؤدي لعقوبات أشد";
  show("scrRestart");
}
$("btnRestart").onclick = async () => {
  const a = attemptData || {};
  enterFullscreen();
  if (exam.camera && !camStream) { await startCamera(); if (exam.faceAI) faceOn = await loadFaceDetector(); }
  const now = Date.now();
  const upd = { status: "in_progress", answers: {}, qPos: 0, lastSeenMs: now };
  if ((a.resumeGrant || 0) > (a.resumeUsed || 0)) { upd.resumeUsed = a.resumeGrant; upd.deviceId = deviceId; }
  const st = a.startedAtMs || startMs;
  try { await updateDoc(attemptRef, upd); } catch (e) { console.error(e); }
  clearLocal();
  beginExam({ ...a, startedAtMs: st, answers: {}, qPos: 0, violationCount: a.violationCount || violations, restarts: a.restarts || restarts });
  toast("بدأت الإجابة من جديد — بالتوفيق");
};

function failScreen(reason) {
  $("failMsg").innerHTML = `تم غلق الاختبار نهائيًا بسبب تكرار محاولات الغش${reason ? `<br><small>آخر مخالفة: ${esc(reason)}</small>` : ""}.`;
  show("scrFail");
}

// مخالفات ثانوية: تُسجَّل كأدلة للمشرف دون إنذار
let flagQueue = [], flagTimer = null, lastFlag = {};
function flag(type) {
  if (!running || flagsSent > 150) return;
  const now = Date.now();
  if (lastFlag[type] && now - lastFlag[type] < 5000) return;
  lastFlag[type] = now; flagsSent++;
  flagQueue.push({ type, at: now });
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => {
    const q = flagQueue; flagQueue = [];
    updateDoc(attemptRef, { flags: arrayUnion(...q), flagCount: flagsSent }).catch(console.error);
  }, 1500);
}
$("btnResume").onclick = () => { $("warnOverlay").classList.add("hidden"); enterFullscreen(); lastViol = Date.now(); faceGrace = Date.now() + 5000; };

// ---- كشف الوجه أثناء الاختبار
function startFaceMonitor() {
  clearInterval(faceInt);
  if (!(exam.camera && exam.faceAI && faceOn && faceReady())) { $("faceState").textContent = ""; return; }
  let none = 0, multi = 0, away = 0;
  faceInt = setInterval(() => {
    if (!running) return;
    const r = detectFaces($("camLive")); if (!r) return;
    const fs = $("faceState");
    fs.textContent = r.count === 1 ? (r.away ? "👀" : "🙂") : r.count === 0 ? "❓" : "👥";
    fs.className = "face-state " + (r.count === 1 && !r.away ? "ok" : "bad");
    if (Date.now() < faceGrace) { none = multi = away = 0; return; }
    none = r.count === 0 ? none + 1 : 0;
    multi = r.count > 1 ? multi + 1 : 0;
    away = r.count === 1 && r.away ? away + 1 : 0;
    if (none >= (SETTINGS.faceAbsentSec || 8)) { none = 0; violation("عدم ظهور الطالب أمام الكاميرا (ترك مكانه أو غطّى الكاميرا)"); }
    else if (multi >= (SETTINGS.faceMultiSec || 2)) { multi = 0; violation("ظهور أكثر من شخص أمام الكاميرا"); }
    else if (away >= (SETTINGS.faceAwaySec || 5)) { away = 0; flag("النظر بعيدًا عن الشاشة لفترة"); }
  }, 1000);
}

document.addEventListener("visibilitychange", () => { if (document.hidden) violation("مغادرة صفحة الاختبار (فتح تطبيق أو تبويب أو شاشة أخرى)"); });
window.addEventListener("blur", () => setTimeout(() => { if (running && !document.hasFocus()) violation("الانتقال إلى نافذة أو برنامج آخر"); }, 400));
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) { fsEntered = true; setTimeout(() => { base = { w: innerWidth, h: innerHeight }; }, 600); return; }
  if (fsEntered && running && $("warnOverlay").classList.contains("hidden")) violation("الخروج من وضع ملء الشاشة");
});
let rzT;
window.addEventListener("resize", () => {
  if (!running || !SETTINGS.detectSplitScreen) return;
  clearTimeout(rzT);
  rzT = setTimeout(() => {
    if (!base.w || document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && isTouch) return; // لوحة مفاتيح الموبايل
    if (innerWidth < base.w * 0.8 || innerHeight < base.h * 0.7) violation("تصغير نافذة الاختبار أو تقسيم الشاشة");
    else if (innerWidth > base.w) base = { w: innerWidth, h: innerHeight };
  }, 700);
});
function guardTick() {
  if (!running) return;
  if (SETTINGS.detectDevTools && !isTouch && !document.fullscreenElement && (outerWidth - innerWidth > 220 || outerHeight - innerHeight > 260)) violation("فتح أدوات المطوّر (Developer Tools)");
  if (SETTINGS.blockMultiScreen && window.screen && window.screen.isExtended === true) violation("توصيل شاشة إضافية أثناء الاختبار");
  if (exam.camera && camStream) { const t = camStream.getVideoTracks()[0]; if (!t || t.readyState === "ended") { camOk = false; camStream = null; violation("إيقاف الكاميرا أثناء الاختبار"); } else if (t.muted) flag("الكاميرا لا ترسل صورة (مكتومة)"); }
}
const setNet = () => { $("netBanner").classList.toggle("hidden", navigator.onLine); if (!navigator.onLine) flag("انقطاع الاتصال بالإنترنت"); else if (running) saveSoon(); };
window.addEventListener("online", setNet); window.addEventListener("offline", setNet);
window.addEventListener("beforeprint", () => violation("محاولة طباعة الاختبار"));
document.documentElement.addEventListener("mouseleave", () => { if (running && !isTouch) flag("خروج مؤشر الفأرة خارج صفحة الاختبار"); });
window.addEventListener("beforeunload", e => { if (running) { writeLocal(); e.preventDefault(); e.returnValue = ""; } });
const FLAG_EV = { copy: "محاولة نسخ نص", cut: "محاولة قص نص", paste: "محاولة لصق نص", contextmenu: "محاولة فتح القائمة (الزر الأيمن)", dragstart: "محاولة سحب محتوى" };
const isField = t => t && /INPUT|TEXTAREA|SELECT/.test(t.tagName);
["copy", "cut", "paste", "contextmenu", "dragstart", "selectstart"].forEach(ev =>
  document.addEventListener(ev, e => {
    if (ev === "selectstart" && isField(e.target)) return;
    if (running || ev === "contextmenu") { e.preventDefault(); if (FLAG_EV[ev] && running) flag(FLAG_EV[ev]); }
  }));
document.addEventListener("keydown", e => {
  if (!running) return;
  const k = (e.key || "").toLowerCase();
  if (e.key === "PrintScreen") { e.preventDefault(); violation("محاولة تصوير الشاشة (Print Screen)"); try { navigator.clipboard.writeText(""); } catch { } return; }
  if (e.metaKey && e.shiftKey && ["3", "4", "5", "s"].includes(k)) { e.preventDefault(); violation("محاولة تصوير الشاشة"); return; }
  if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(k))) { e.preventDefault(); flag("محاولة فتح أدوات المطوّر"); return; }
  if ((e.ctrlKey || e.metaKey) && ["c", "v", "x", "p", "s", "u", "a", "f", "t", "n", "w", "r"].includes(k)) { e.preventDefault(); flag(`استخدام اختصار لوحة المفاتيح (Ctrl+${k.toUpperCase()})`); }
  if (e.altKey && e.key === "Tab") flag("محاولة التنقل بين البرامج (Alt+Tab)");
  if (e.key === "Meta" || e.key === "OS") flag("الضغط على زر Windows");
});
window.addEventListener("keyup", e => { if (running && e.key === "PrintScreen") { violation("محاولة تصوير الشاشة (Print Screen)"); try { navigator.clipboard.writeText(""); } catch { } } });

function enterFullscreen() {
  if (!SETTINGS.requireFullscreen) return;
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn && !document.fullscreenElement) { try { const p = fn.call(el, { navigationUI: "hide" }); p && p.catch && p.catch(() => { }); } catch { } }
}
function exitFullscreen() {
  fsEntered = false;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
}
function blocked(ic, title, msg) {
  $("blkIc").textContent = ic; $("blkTitle").textContent = title; $("blkMsg").textContent = msg;
  show("scrBlocked");
}
