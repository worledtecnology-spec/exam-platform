import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, onSnapshot, serverTimestamp, arrayUnion }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, SETTINGS } from "./config.js";
import { isConfigured, normalizeName, hashStr, seededShuffle, esc, mmss, fmtDateTime, LETTERS, frameGuard, initAppCheck, brandHtml, wireLogos, geoCheck, geoDecide } from "./common.js";
import { pickQuestions, isAnswered } from "./scoring.js";
import { TYPE_LABEL } from "./parser.js";
import { loadFaceDetector, detectFaces, faceReady, loadObjectDetector, detectObjects, objectsReady } from "./face.js";
import { startVoice, recordClip } from "./audio.js";
import { startSpeech, buildContext, speechSupported } from "./speech.js";
import { deviceInfo, inSEB, osKind, sebSupported, sebLink, osLabel, typeLabel, SEB_DOWNLOAD } from "./device.js";
let devInfo = null; deviceInfo().then(d => devInfo = d).catch(() => { });
import { mountGuide } from "./guide.js";
import { STUDENT_GUIDE } from "./guide-content.js";
import { pledgeClauses, PLEDGE_VER } from "./pledge.js";

const $ = id => document.getElementById(id);
const PEN = SETTINGS.penalties && SETTINGS.penalties.length ? SETTINGS.penalties : ["warn", "restart", "fail"];
const PEN_TEXT = { warn: "إنذار أحمر وتكمل الاختبار", restart: "إغلاق الاختبار ومسح جميع إجاباتك ثم تبدأ من جديد", fail: "غلق نهائي و<b>رسوب في الاختبار</b>" };
const ORD = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة"];
const ORDM = ["أول", "ثانٍ", "ثالث", "رابع", "خامس"];
const MAIN_SCREENS = ["scrLoading", "scrConfig", "scrLogin", "scrRules", "scrWait", "scrRestart", "scrDone", "scrFail", "scrBlocked", "scrSEB", "scrPledge", "scrGuide", "scrContact"];
let loggedIn = false, lastMain = "scrLogin";
function show(id) {
  MAIN_SCREENS.forEach(s => $(s).classList.toggle("hidden", s !== id));
  if (id !== "scrGuide" && id !== "scrContact" && id !== "scrExam") lastMain = id;
  const sub = id === "scrGuide" ? "guide" : id === "scrContact" ? "contact" : "exam";
  $("sNav").classList.toggle("hidden", !loggedIn || id === "scrExam");
  document.querySelectorAll("#sNav button").forEach(b => b.classList.toggle("act", b.dataset.go === sub));
  const inExam = id === "scrExam";
  ["scrExam", "examTop", "watermark"].forEach(x => $(x).classList.toggle("hidden", !inExam));
  $("selfcam").classList.toggle("hidden", !(inExam && camStream));
  document.body.classList.toggle("cam-on", !!(inExam && camStream));
  $("hero").classList.toggle("hidden", inExam);
  $("sMain").classList.toggle("hidden", inExam);
  $("credits").classList.toggle("hidden", inExam);
  const st = { scrLogin: 0, scrPledge: 1, scrRules: 1, scrWait: 1, scrRestart: 2, scrDone: 2, scrFail: 2, scrBlocked: 2 }[id];
  document.querySelectorAll("#steps li").forEach((s, i) => { s.classList.toggle("on", st !== undefined && i <= st); s.classList.toggle("done", st !== undefined && i < st); });
  window.scrollTo(0, 0);
}
function toast(msg, ms = 4000) { const t = $("sToast"); t.innerHTML = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), ms); }
$("brandSlot").innerHTML = brandHtml(SETTINGS); wireLogos();
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
// التنقل حر دائمًا: الطالب يرجع لأي سؤال ويعدّل إجابته حتى يسلّم الاختبار
const noBack = () => false;
// رصد الكلام بالميكروفون: مفعّل مع الكاميرا ما لم يُعطّله المشرف لهذا الاختبار
const micOn = () => !!(exam && exam.camera && exam.mic !== false);
let micOk = false, voice = null, talkCount = 0, clipP = null, camLostShown = false, camErr = "";

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
  getLocation(false);
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
  $("hallBox").classList.toggle("hidden", !(e && e.hallLock));
}
$("inHall").addEventListener("input", e => { e.target.value = toLatin(e.target.value).replace(/\D/g, "").slice(0, 6); });
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
// ---- تحديد الموقع: سريع (شبكة/واي فاي) ← دقيق (GPS) ← متابعة مستمرة لتحسين الدقة
let locWatch = null, locAt = 0, locCode = 0, locBusy = false;
function setLocFrom(p) {
  const acc = Math.round(p.coords.accuracy);
  if (loc && Date.now() - locAt < 60000 && acc > (loc.accuracy || 9e9) + 20) return; // نحتفظ بالأدق
  loc = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: acc, address: (loc && loc.address) || "" };
  locAt = Date.now(); locErr = null; locCode = 0;
}
// متصفح داخل تطبيق (فيسبوك/ماسنجر/إنستجرام/تيليجرام…) — غالبًا بيرفض الموقع
const isInApp = () => /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|Snapchat|TikTok|musical_ly|Telegram|; wv\)/i.test(navigator.userAgent);
const chromeIntent = () => `intent://${location.href.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
async function permState() { try { return (await navigator.permissions.query({ name: "geolocation" })).state; } catch { return "unknown"; } }
function locHelp() { // نص مختصر (يُستخدم في رسائل الخطأ)
  const k = deviceKind();
  return k === "ios" ? "الإعدادات ← الخصوصية ← خدمات الموقع ← Safari ← «أثناء الاستخدام» + «الموقع الدقيق»."
    : k === "android" ? "اضغط 🔒 جنب الرابط ← الأذونات ← الموقع ← «سماح»."
      : "اضغط 🔒 جنب الرابط ← الموقع ← «سماح»، وشغّل الواي فاي.";
}
function locSteps(code, perm) {
  const k = deviceKind();
  if (isInApp()) return { t: "إنت فاتح الرابط من جوه تطبيق (فيسبوك / ماسنجر / تيليجرام…)", s: k === "ios" ? ["اضغط ⋯ أو علامة البوصلة ← «فتح في Safari»", "أو انسخ الرابط والصقه في Safari"] : ["اضغط الزر الأخضر «فتح في Chrome» تحت", "أو اضغط ⋮ فوق ← «فتح في Chrome / المتصفح»"], chrome: k === "android" };
  if (code === 1 || perm === "denied") return {
    t: "المتصفح قافل إذن الموقع للمنصة دي (حتى لو الموقع شغال في الموبايل)",
    s: k === "ios" ? ["الإعدادات ← الخصوصية والأمان ← خدمات الموقع ← شغّلها", "انزل لـ Safari (أو Chrome) ← اختار «أثناء الاستخدام» وفعّل «الموقع الدقيق»", "ارجع هنا واضغط «حدد موقعي تاني»"]
      : k === "android" ? ["اضغط علامة 🔒 (أو ⚙️) اللي جنب رابط الموقع فوق", "الأذونات ← الموقع ← «سماح» (أو «إعادة ضبط الأذونات»)", "لو مش موجودة: Chrome ⋮ ← الإعدادات ← إعدادات المواقع ← الموقع ← شيل المنصة من «محظور»", "ولو لسه: إعدادات الموبايل ← التطبيقات ← Chrome ← الأذونات ← الموقع ← «السماح أثناء الاستخدام»", "ارجع واضغط «حدد موقعي تاني»"]
        : ["اضغط علامة 🔒 جنب رابط الموقع ← الموقع ← «سماح»", "في ويندوز: الإعدادات ← الخصوصية ← الموقع ← شغّله للمتصفح", "حدّث الصفحة واضغط «حدد موقعي تاني»"]
  };
  return {
    t: "الجهاز مش قادر يحدد مكانك دلوقتي (الإشارة ضعيفة جوه المبنى)",
    s: k === "ios" ? ["اتأكد إن «الموقع الدقيق» شغال للمتصفح", "شغّل الواي فاي حتى لو مش متوصل بشبكة", "قرّب من شباك أو باب واضغط «حدد موقعي تاني»"]
      : k === "android" ? ["شغّل الواي فاي حتى لو مش متوصل بشبكة (بيساعد في تحديد المكان)", "الإعدادات ← الموقع ← خدمات الموقع ← فعّل «دقة الموقع من Google»", "افتح خرائط جوجل ثواني لحد ما تحدد مكانك وارجع", "قرّب من شباك أو باب واضغط «حدد موقعي تاني»"]
        : ["شغّل الواي فاي على اللابتوب (بيحدد مكانه منه)", "أو استخدم الموبايل بدل اللابتوب", "اضغط «حدد موقعي تاني»"]
  };
}
function getPos(high, timeout, maxAge) {
  return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: high, timeout, maximumAge: maxAge }));
}
async function locateNow() {
  if (!navigator.geolocation) { locErr = "المتصفح لا يدعم تحديد الموقع"; locCode = -1; return null; }
  // ١) سريع: دقة عادية (الشبكة/الواي فاي) — بيشتغل جوه المباني  ٢) لو فشل: GPS بمهلة أطول
  try { setLocFrom(await getPos(false, 10000, 300000)); }
  catch (e1) {
    locCode = (e1 && e1.code) || 0;
    if (locCode === 1) { locErr = "تم رفض إذن الوصول إلى الموقع"; return null; }
    try { setLocFrom(await getPos(true, 20000, 0)); }
    catch (e2) { locCode = (e2 && e2.code) || 0; locErr = locCode === 1 ? "تم رفض إذن الوصول إلى الموقع" : "تعذّر تحديد الموقع"; }
  }
  if (loc && !locWatch && navigator.geolocation.watchPosition) { // تحسين الدقة في الخلفية
    try { locWatch = navigator.geolocation.watchPosition(setLocFrom, () => { }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }); } catch { /* */ }
  }
  return loc;
}
function locBox(kind, title, inner, btn) {
  const b = $("locBox"); b.className = "loc " + kind;
  b.innerHTML = `<div class="pin">${kind === "ok" ? "✅" : kind === "bad" ? "⚠️" : "📍"}</div><div style="flex:1"><div class="t">${esc(title)}</div>${inner || ""}</div>${btn || ""}`;
}
async function getLocation(fromTap) {
  if (locBusy) return; locBusy = true;
  const perm = await permState();
  // قبل أول طلب: نخلي الطالب يضغط بنفسه (المتصفح بيقفل الإذن لو اتطلب كتير من غير ضغط)
  if (!fromTap && perm !== "granted" && !isInApp()) {
    locBusy = false;
    locBox("wait", "📍 الخطوة الأولى: حدد موقعك", `<div class="d">اضغط الزر واختار <b>«سماح»</b> لما المتصفح يسألك عن الموقع.</div>`, `<button class="btn primary sm" id="btnLocGo">📍 حدد موقعي</button>`);
    $("btnLocGo").onclick = () => getLocation(true);
    return;
  }
  let sec = 0; locBox("wait", "جارٍ تحديد موقعك…", `<div class="d">اختار «سماح» لو المتصفح سألك — <b id="locSec">0</b> ث</div>`);
  const tmr = setInterval(() => { const e = $("locSec"); if (e) e.textContent = ++sec; }, 1000);
  await locateNow();
  clearInterval(tmr); locBusy = false;
  if (loc) {
    locBox("ok", "تم تحديد موقعك ✓", `<div class="d">دقة التحديد ≈ ${loc.accuracy} متر</div>`);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.lat}&lon=${loc.lng}&zoom=16&accept-language=ar`);
      const j = await r.json();
      if (j && j.display_name) { loc.address = j.display_name.slice(0, 250); locBox("ok", "تم تحديد موقعك ✓", `<div class="d">${esc(loc.address)}</div>`); }
    } catch { }
    loginError("");
    return;
  }
  await showLocFail();
}
async function showLocFail() {
  const h = locSteps(locCode, await permState());
  locBox("bad", h.t, `<ol class="loc-steps">${h.s.map(x => `<li>${esc(x)}</li>`).join("")}</ol>${h.chrome ? `<a class="btn ok sm" href="${esc(chromeIntent())}">🌐 فتح في Chrome</a>` : ""}`, `<button class="btn primary sm" id="btnLocRetry">🔄 حدد موقعي تاني</button>`);
  $("btnLocRetry").onclick = () => getLocation(true);
}
// تحديث الموقع قبل الدخول (يستخدم آخر قراءة حديثة لو موجودة)
async function refreshLoc() {
  if (loc && Date.now() - locAt < 45000) return loc;
  await locateNow();
  return loc;
}
const fenceOf = e => e && e.geoLock ? { ...SETTINGS.geoFence, ...(e.geo || {}) } : null;
function geoMsg(g, f) {
  if (g.reason === "noloc") return "يجب السماح بتحديد الموقع — هذا الاختبار متاح داخل الكلية فقط.";
  if (g.reason === "inaccurate") return "تحديد موقعك غير دقيق. شغّل الـ GPS (أو الواي فاي على اللابتوب) واخرج قريبًا من نافذة، ثم أعد المحاولة.";
  return `⛔ هذا الاختبار متاح فقط داخل ${f.name || "الكلية"}. موقعك الحالي يبعد حوالي ${g.d >= 1000 ? (g.d / 1000).toFixed(1) + " كم" : g.d + " متر"} عن مكان الاختبار.`;
}
function setLoc(kind, t, d, retry) {
  const b = $("locBox"); b.className = "loc " + kind;
  b.innerHTML = `<div class="pin">${kind === "ok" ? "✅" : kind === "bad" ? "⚠️" : "📍"}</div>
    <div style="flex:1"><div class="t">${esc(t)}</div><div class="d">${esc(d)}</div></div>
    ${retry ? `<button class="btn ghost sm" id="btnLocRetry">إعادة المحاولة</button>` : ""}`;
  if (retry) $("btnLocRetry").onclick = () => getLocation(true);
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
  // تحديد الموقع إلزامي قبل الدخول — لا يمكن تجاوزه
  if (SETTINGS.requireLocation && !loc) {
    const bn = $("btnNext"); bn.disabled = true; bn.textContent = "📍 جارٍ تحديد موقعك…";
    await refreshLoc();
    bn.disabled = false; bn.textContent = "متابعة ←";
    if (!loc) { await showLocFail(); $("locBox").scrollIntoView({ block: "center", behavior: "smooth" }); return loginError("📍 لازم نحدد موقعك الأول عشان تدخل — اتبع الخطوات اللي ظاهرة في خانة الموقع فوق."); }
    setLoc("ok", "تم تحديد موقعك ✓", `دقة التحديد ≈ ${loc.accuracy} متر`);
  }
  // فتح الاختبار لمجموعات محددة: نقرأ حالة الاختبار الحالية من القاعدة (قد يكون المشرف فتح/أغلق مجموعة الآن)
  try { const fr = await getDoc(doc(db, "exams", exId)); if (fr.exists()) Object.assign(e, fr.data()); } catch { /* نكمل بآخر نسخة */ }
  if (!e.active) return loginError("هذا الاختبار مغلق الآن.");
  if (e.groupGate && !(e.openGroups || []).map(String).includes(String(me.group)))
    return loginError(`⏳ الاختبار غير مفتوح للمجموعة ${me.group} الآن. انتظر حتى يفتحه المشرف لمجموعتك ثم اضغط «متابعة» مرة أخرى.`);
  // رمز القاعة: لا يدخل إلا من يرى الرمز المعروض داخل القاعة (يتغير كل 45 ثانية ويتحقق منه Firebase)
  if (e.hallLock) {
    const code = toLatin($("inHall").value.trim());
    if (!/^\d{6}$/.test(code)) return loginError("اكتب رمز القاعة (6 أرقام) المعروض الآن على شاشة القاعة.");
    const pref = doc(db, "hallPass", exId + "_" + deviceId);
    let okPass = false;
    try { const ex0 = await getDoc(pref); okPass = ex0.exists() && ex0.data().code === code; } catch { /* */ }
    if (!okPass) {
      try { await setDoc(pref, { examId: exId, uid: deviceId, code, name: me.name, group: me.group, at: serverTimestamp() }); }
      catch (err) { console.warn(err); return loginError("⛔ رمز القاعة غير صحيح أو انتهت صلاحيته — اكتب الرمز المعروض حاليًا على شاشة القاعة (بيتغير كل 45 ثانية)."); }
    }
  }
  // المتصفح الآمن: إلزامي على الأجهزة التي تدعمه، والباقي يكمل بالمراقبة المشددة
  if (e.seb && sebSupported() && !inSEB()) return showSEB(exId);

  const btn = $("btnNext"); btn.disabled = true; btn.textContent = "جارٍ التحقق…";
  // الاختبار داخل الكلية فقط: التحقق من موقع الطالب قبل أي شيء
  const fence = fenceOf(e);
  if (fence) {
    btn.textContent = "جارٍ التحقق من موقعك…";
    await refreshLoc();
    const g = geoDecide(loc, fence, !!SETTINGS.geoStrict);
    if (loc) setLoc(g.ok ? "ok" : "bad", g.ok ? (g.verified ? `أنت داخل ${fence.name || "مكان الاختبار"} ✓` : "تم — تقدر تكمل") : "خارج مكان الاختبار", g.ok ? `دقة التحديد ≈ ${loc.accuracy} متر` : `يبعد حوالي ${g.d} متر`, !g.ok);
    if (!g.ok && (SETTINGS.geoBlockFar || !SETTINGS.smooth)) { btn.disabled = false; btn.textContent = "متابعة ←"; return loginError(geoMsg(g, fence)); }
  }
  try {
    // الأسئلة محمية: لا تُقرأ إلا أثناء موعد الاختبار
    let qd = null;
    try { qd = await getDoc(doc(db, "examQuestions", exId)); } catch (err) { console.warn(err); }
    if (!qd || !qd.exists()) return blocked("⏳", "الاختبار غير متاح الآن", "لم يبدأ موعد الاختبار بعد أو تم إغلاقه. حاول مرة أخرى في الموعد المحدد.");
    exam = { ...e, questions: qd.data().questions || [] };
    loggedIn = true;
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
    showPledge();
  } catch (err) {
    console.error(err); loginError("تعذّر الاتصال، حاول مرة أخرى.");
  } finally { btn.disabled = false; btn.textContent = "متابعة ←"; }
};
// ---------------------------------------------------------------- ميثاق الاختبار
let pledge = null;
function showPledge() {
  const C = pledgeClauses(exam, PEN);
  $("plBody").innerHTML = `<p class="pl-intro">أنا الطالب/ة <b>${esc(me.name)}</b> — المجموعة <b>${esc(me.group)}</b>${me.seat ? ` — رقم الجلوس <b>${esc(me.seat)}</b>` : ""}، في اختبار <b>${esc(exam.course)} — ${esc(exam.title)}</b>، أتعهد بالآتي:</p>
    <ol class="pl-list">${C.map(c => `<li><span class="pl-n">${c.ic}</span><div><b>${esc(c.t)}</b><p>${c.d}</p></div></li>`).join("")}</ol>`;
  $("plAgree").checked = false; $("plOk").disabled = true; $("plErr").classList.add("hidden");
  show("scrPledge"); $("plBody").scrollTop = 0;
}
$("plAgree").onchange = () => { $("plOk").disabled = !$("plAgree").checked; };
$("plOk").onclick = async () => {
  if (!$("plAgree").checked) return;
  pledge = { v: PLEDGE_VER, at: Date.now(), name: me.name, clauses: pledgeClauses(exam, PEN).length };
  $("agree").checked = true;
  show("scrRules");
  await runChecks();
};
$("plBack").onclick = () => show("scrLogin");
$("btnBack").onclick = () => { stopCamera(); clearInterval(faceInt); show("scrLogin"); };

function renderRules() {
  $("rTitle").textContent = exam.title;
  const n = exam.drawCount > 0 && exam.drawCount < exam.questions.length ? exam.drawCount : exam.questions.length;
  $("rChips").innerHTML = `<span class="chip blue">📚 ${esc(exam.course)}</span><span class="chip">📝 ${n} سؤال</span>
    <span class="chip">⏱️ ${exam.duration} دقيقة</span><span class="chip blue">👤 ${esc(me.name)} — م${esc(me.group)}${me.seat ? ` — ${esc(me.seat)}` : ""}</span>`;
  const R = [];
  R.push(["⏱️", "الوقت محسوب ويُسلَّم الاختبار تلقائيًا عند انتهائه", ""]);
  if (exam.seb) R.push(inSEB() ? ["🔒", "أنت داخل المتصفح الآمن — الجهاز مقفول على الاختبار لحد ما تسلّم", ""] : ["🛡️", "جهازك مش بيدعم المتصفح الآمن، فالاختبار هيشتغل بالمراقبة المشددة (ملء الشاشة + الكاميرا + الميكروفون)", ""]);
  R.push(["↔️", "تقدر تتنقل بين الأسئلة وترجع لأي سؤال وتعدّل إجابتك في أي وقت قبل «تسليم الاختبار»", ""]);
  if (exam.negative > 0) R.push(["➖", "توجد درجة سالبة للإجابة الخاطئة — اترك السؤال إن لم تكن متأكدًا", ""]);
  if (exam.camera) R.push(["📷", "الكاميرا" + (micOn() ? " والميكروفون" : "") + " لازم يفضلوا شغالين طول الاختبار", ""]);
  if (SETTINGS.silentMode) {
    R.push(["🚫", SETTINGS.leaveFails ? "<b>فتح أي تطبيق أو تبويب أو برنامج تاني أو الخروج من صفحة الاختبار = غلق الاختبار فورًا والرسوب</b>" : "<b>فتح أي تطبيق أو تبويب تاني أو الخروج من صفحة الاختبار = خرق بيتسجل عليك بالأدلة</b>. هيظهرلك إنذار باسم كل خرق، و<b>تكرار الخروقات بيعرّضك لمحضر غش</b> — والمشرف هو اللي بيحدد الإجراء. الاختبار مش هيتقفل عليك", "red"]);
    if (exam.camera) R.push(["🔎", "سلوكك طول الاختبار بيتسجل بالصور" + (micOn() ? " والصوت" : "") + " والتوقيت ويراجعه المشرف (الكلام، ظهور موبايل أو شخص تاني، السماعات…)", ""]);
  } else {
    if (micOn()) R.push(["🎙️", "الكلام مع أي حد أثناء الاختبار بيترصد بالميكروفون ويتسجّل كدليل — تكراره = محاولة غش", "red"]);
    if (micOn() && SETTINGS.speechWatch !== false && exam.speech !== false) R.push(["👂", "المنصة بتفهم الكلام: لو اتقال السؤال أو الإجابات (زي «الإجابة ب» أو «اختار ج») أو اتطلبت إجابات = <b>خرق غش فوري</b> بالصورة والصوت — ممنوع تقرأ الأسئلة أو الإجابات بصوت حتى لنفسك", "red"]);
    if (exam.camera && exam.faceAI) R.push(["📵", "ظهور موبايل أو شخص تاني أمام الكاميرا = غش • تكرار النظر بعيدًا 3 مرات = غش", "red"]);
    if (exam.camera) R.push(["🎧", "ممنوع السماعات (بلوتوث أو سلك) والكاميرات الافتراضية، وممنوع تصوير الشاشة أو فتح المنصة في تبويب تاني", "red"]);
    R.push(["🚫", "الخروج من صفحة الاختبار أو فتح أي تطبيق أو شاشة أخرى" + (exam.camera ? " أو الابتعاد عن الكاميرا" : "") + " = محاولة غش", "red"]);
    R.push(["⚖️", PEN.map((p, i) => `<b>${i + 1}</b> ${({ warn: "إنذار", restart: "مسح الإجابات والبدء من جديد", fail: "غلق نهائي ورسوب" })[p]}`).join(" ← "), "red"]);
  }
  $("rulesList").innerHTML = R.map(([ic, t, c]) => `<div class="rule ${c}"><div class="ic">${ic}</div><div>${t}</div></div>`).join("");
}

// ---------------------------------------------------------------- pre-exam checks
let checks = {};
function renderChecks() {
  const rows = [
    ["id", "بيانات الطالب", me.seat ? "تم التحقق من رقم الجلوس" : "تم التحقق من الاسم والمجموعة"],
    exam.geoLock ? ["geo", "مكان الاختبار", checks.geo && checks.geo.ok ? (checks.geo.verified ? `داخل النطاق — على بعد ${checks.geo.d} م` : "تعذّر التأكد من موقعك بدقة — مسموح بالدخول") : checks.geo ? "خارج مكان الاختبار" : "…"] : ["loc", "تحديد الموقع", loc ? "تم تحديد موقعك" : "مطلوب — اسمح بالموقع"],
    exam.camera ? ["cam", "الكاميرا", camOk ? "تعمل بشكل سليم" : checks.cam === "wait" ? "جارٍ التشغيل…" : "مطلوبة — اسمح بالوصول للكاميرا"] : null,
    micOn() ? ["mic", "الميكروفون", micOk ? "يعمل بشكل سليم" : checks.cam === "wait" ? "جارٍ التشغيل…" : "مطلوب — اسمح بالوصول للميكروفون"] : null,
    exam.camera ? ["dev", "سماعات وكاميرا افتراضية", checks.devMsg || "…"] : null,
    exam.camera && exam.faceAI ? ["face", "كشف الوجه", checks.faceMsg || "…"] : null,
    ["screen", "شاشة واحدة فقط", checks.screen ? "لا توجد شاشات إضافية" : "افصل الشاشة الإضافية ثم أعد المحاولة"],
    ["net", "الاتصال بالإنترنت", navigator.onLine ? "متصل" : "غير متصل"]
  ].filter(Boolean);
  $("checks").innerHTML = rows.map(([k, t, d]) => {
    const st = k === "id" ? true : k === "geo" ? !!(checks.geo && checks.geo.ok) : k === "loc" ? (!!loc || !SETTINGS.requireLocation) : k === "cam" ? (checks.cam === "wait" ? "wait" : camOk) : k === "mic" ? (checks.cam === "wait" ? "wait" : micOk) : k === "dev" ? checks.dev !== false : k === "face" ? checks.face : k === "net" ? navigator.onLine : checks.screen;
    return `<div class="chk ${st === "wait" ? "wait" : st ? "ok" : "bad"}"><i>${st === "wait" ? "…" : st ? "✓" : "✕"}</i><div><b>${t}</b><small>${esc(d)}</small></div></div>`;
  }).join("");
  updateStartBtn();
}
function allChecksOk() {
  if (SETTINGS.smooth) return navigator.onLine && (!SETTINGS.requireLocation || !!loc) && (!exam.geoLock || !checks.geo || checks.geo.ok || !SETTINGS.geoBlockFar);
  return (!exam.geoLock || (checks.geo && checks.geo.ok)) && (!exam.camera || camOk) && (!micOn() || micOk) && (!exam.camera || checks.dev !== false) && checks.screen && navigator.onLine && (!SETTINGS.requireLocation || !SETTINGS.geoStrict || loc);
}
function updateStartBtn() { $("btnStart").disabled = !($("agree").checked && allChecksOk()); }
$("agree").onchange = updateStartBtn;

async function runChecks() {
  checks = { screen: !(SETTINGS.blockMultiScreen && window.screen && window.screen.isExtended === true) };
  if (exam.geoLock) { const f = fenceOf(exam); checks.geo = geoDecide(loc, f, !!SETTINGS.geoStrict); }
  $("camSetup").classList.toggle("hidden", !exam.camera);
  renderChecks();
  if (exam.camera) { checks.cam = "wait"; renderChecks(); await startCamera(); }
  if (exam.camera && exam.faceAI) startFaceCheck();
  renderChecks();
}
async function startCamera() {
  $("btnCamRetry").classList.add("hidden"); $("camHelp").classList.add("hidden");
  $("camTag").textContent = "جارٍ تشغيل الكاميرا…";
  const video = { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } };
  const audio = micOn() ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false;
  stopCamera();
  let err = null;
  try { camStream = await navigator.mediaDevices.getUserMedia({ video, audio }); }
  catch (e) {
    err = e; camStream = null;
    // لو الميكروفون هو المرفوض: نجرب الكاميرا وحدها لنعرف أيهما المشكلة
    if (audio) { try { camStream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); err = Object.assign(new Error("mic"), { name: e.name, mic: true }); } catch (e2) { err = e2; } }
  }
  const vt = camStream && camStream.getVideoTracks()[0], at = camStream && camStream.getAudioTracks()[0];
  camOk = !!(vt && vt.readyState === "live"); micOk = !!(at && at.readyState === "live");
  checks.cam = camOk;
  if (camStream) { $("camPreview").srcObject = camStream; $("camLive").srcObject = camStream; $("camLive").play().catch(() => { }); }
  if (vt) vt.onended = () => camLost("إيقاف الكاميرا أثناء الاختبار");
  if (at) at.onended = () => camLost("إيقاف الميكروفون أثناء الاختبار");
  await checkMediaDevices();
  const okAll = camOk && (!micOn() || micOk);
  if (okAll) { camErr = ""; $("camTag").textContent = micOn() ? "● الكاميرا والميكروفون يعملان" : "● الكاميرا تعمل"; }
  else {
    if (err) console.error(err);
    const which = !camOk ? "الكاميرا" : "الميكروفون";
    camErr = !err ? `${which} لا يعمل` : err.name === "NotAllowedError" || err.name === "SecurityError" ? `تم رفض إذن ${which}` : err.name === "NotReadableError" || err.name === "AbortError" ? `${which} مشغول في تطبيق آخر — اقفل أي تطبيق يستخدمه (زووم، واتساب، الكاميرا…)` : err.name === "NotFoundError" || err.name === "OverconstrainedError" ? `لا يوجد ${which === "الكاميرا" ? "كاميرا" : "ميكروفون"} في هذا الجهاز` : `تعذّر تشغيل ${which}`;
    $("camTag").textContent = camErr;
    $("btnCamRetry").classList.remove("hidden");
    showCamHelp(err && (err.name === "NotAllowedError" || err.name === "SecurityError"));
    autoRetryCamera(err && err.name);
  }
  renderChecksSafe();
  return okAll;
}
// ---- كاميرا افتراضية (OBS / ManyCam…) أو سماعة بلوتوث = ممنوع
const VIRTUAL_CAM = /obs|virtual|manycam|xsplit|snap camera|splitcam|e2esoft|vcam|mmhmm|camtwist|youcam|webcamoid|fake ?web|nvidia broadcast/i;
const WIRELESS = /airpods|buds|bluetooth|hands-?free|\bwh-|\bwf-|jabra|beats|bose|soundcore|earbud|tws|headset|سماع/i;
async function checkMediaDevices() {
  checks.dev = true; checks.devMsg = "لا توجد كاميرا افتراضية أو سماعات";
  const vt = camStream && camStream.getVideoTracks()[0], at = camStream && camStream.getAudioTracks()[0];
  if (vt && VIRTUAL_CAM.test(vt.label || "")) { checks.dev = false; checks.devMsg = `كاميرا افتراضية غير مسموحة (${vt.label}) — استخدم كاميرا الجهاز الحقيقية`; return checks.dev; }
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* */ }
  const hs = [at && at.label, ...list.filter(d => d.kind === "audiooutput" && d.deviceId === "default").map(d => d.label)].filter(Boolean).find(l => WIRELESS.test(l));
  if (hs) { checks.dev = false; checks.devMsg = `افصل السماعة أولًا (${hs}) ثم اضغط «إعادة تشغيل الكاميرا»`; }
  return checks.dev;
}
if (navigator.mediaDevices) navigator.mediaDevices.addEventListener?.("devicechange", async () => {
  if (!exam || !exam.camera) return;
  const ok = await checkMediaDevices();
  if (running && !ok) violation("توصيل سماعة أو كاميرا افتراضية أثناء الاختبار");
  else renderChecksSafe();
});
function renderChecksSafe() { if (!running && exam) { try { renderChecks(); } catch { /* شاشة أخرى */ } } }

// شرح فتح الكاميرا والميكروفون حسب نوع الجهاز (المتصفح لا يسمح لأي موقع بتغيير إعدادات الجهاز بنفسه)
function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Mac/.test(ua)) return "mac";
  return "win";
}
function showCamHelp(denied) {
  const what = micOn() ? "الكاميرا والميكروفون" : "الكاميرا";
  const S = {
    android: [`اضغط على علامة 🔒 (أو ⓘ) بجوار رابط الموقع أعلى الشاشة ← «الأذونات» ← فعّل ${what}.`, `لو مش ظاهرة: إعدادات الموبايل ← التطبيقات ← Chrome ← الأذونات ← ${what} ← «السماح».`, "ارجع للصفحة — المنصة هتشغّلها تلقائيًا."],
    ios: [`الإعدادات ← Safari (أو Chrome) ← ${what} ← «السماح».`, `أو اضغط «aA» بجوار الرابط ← إعدادات موقع الويب ← ${what} ← «السماح».`, "ارجع للصفحة واضغط «إعادة تشغيل الكاميرا»."],
    win: [`اضغط على علامة 🔒 بجوار رابط الموقع ← فعّل ${what} ← أعد تحميل الصفحة لو طُلب منك.`, `لو لسه مقفولة: إعدادات ويندوز ← الخصوصية والأمان ← الكاميرا / الميكروفون ← فعّل «السماح للتطبيقات» و«السماح لتطبيقات سطح المكتب».`, "اقفل أي برنامج تاني بيستخدم الكاميرا (زووم، تيمز، واتساب)."],
    mac: [`اضغط على علامة 🔒 بجوار رابط الموقع ← فعّل ${what}.`, `لو لسه مقفولة: إعدادات النظام ← الخصوصية والأمان ← الكاميرا / الميكروفون ← فعّل المتصفح.`, "اقفل أي برنامج تاني بيستخدم الكاميرا."]
  }[deviceKind()];
  $("camHelp").innerHTML = `<b>${denied ? "🔐 الإذن مقفول — افتحه كده:" : "🛠️ جرّب الخطوات دي:"}</b><ol>${S.map(x => `<li>${esc(x)}</li>`).join("")}</ol><small>لن يُسمح ببدء الاختبار إلا بعد تشغيل ${what}.</small>`;
  $("camHelp").classList.remove("hidden");
}
// إعادة المحاولة تلقائيًا: عند تغيير الإذن من الإعدادات أو عند تحرّر الكاميرا من تطبيق آخر
let camRetryT = 0, permWatch = false;
function autoRetryCamera(errName) {
  clearTimeout(camRetryT);
  if (!permWatch && navigator.permissions && navigator.permissions.query) {
    permWatch = true;
    ["camera", "microphone"].forEach(n => navigator.permissions.query({ name: n }).then(st => {
      st.onchange = () => { if (st.state === "granted" && !(camOk && (!micOn() || micOk))) startCamera().then(ok => { if (ok && running) camRestored(); }); };
    }).catch(() => { }));
  }
  if (errName === "NotReadableError" || errName === "AbortError" || errName === "NotFoundError" || !errName)
    camRetryT = setTimeout(() => { if (!(camOk && (!micOn() || micOk))) startCamera().then(ok => { if (ok && running) camRestored(); }); }, 5000);
  document.addEventListener("visibilitychange", onVisRetry);
}
function onVisRetry() {
  if (document.hidden || (camOk && (!micOn() || micOk))) return;
  document.removeEventListener("visibilitychange", onVisRetry);
  startCamera().then(ok => { if (ok && running) camRestored(); });
}

// أثناء الاختبار: الكاميرا أو الميكروفون اتقفلوا → محاولة غش + إيقاف الاختبار لحين تشغيلهم
function camLost(type) {
  if (!running || !exam.camera) return;
  camOk = !!(camStream && camStream.getVideoTracks()[0] && camStream.getVideoTracks()[0].readyState === "live");
  micOk = !!(camStream && camStream.getAudioTracks()[0] && camStream.getAudioTracks()[0].readyState === "live");
  if (voice) { voice.stop(); voice = null; }
  if (!camLostShown) { camLostShown = true; violation(type, true); }
  if (!running) return;
  if (SETTINGS.smooth) { // لا نوقف الطالب — نحاول إعادة التشغيل بهدوء كل 15 ثانية
    clearTimeout(camLost.t);
    const again = () => { if (!running || (camOk && (!micOn() || micOk))) return; startCamera().then(ok => { if (ok && running) camRestored(); else camLost.t = setTimeout(again, 15000); }); };
    camLost.t = setTimeout(again, 15000);
    return;
  }
  $("warnOverlay").classList.add("hidden");
  $("cbWhy").textContent = type;
  $("camBlock").classList.remove("hidden");
}
function camRestored() {
  camLostShown = false;
  $("camBlock").classList.add("hidden"); enterFullscreen(); lastViol = Date.now();
  const cl = $("camLive"); cl.srcObject = camStream; cl.play().catch(() => { });
  startVoiceMonitor();
  faceGrace = Date.now() + 5000;
}
$("cbRetry").onclick = async () => {
  $("cbRetry").disabled = true; $("cbRetry").textContent = "جارٍ التشغيل…";
  const ok = await startCamera();
  $("cbRetry").disabled = false; $("cbRetry").textContent = "🔄 تشغيل الكاميرا والمتابعة";
  if (ok) camRestored(); else $("cbWhy").textContent = camErr || "لسه مش شغالة";
};

// ---- رصد الكلام بالميكروفون
let speech = null, speechCtx = null, speechCount = 0, speechState = "";
function startSpeechWatch() {
  if (speech) { speech.stop(); speech = null; }
  if (!running || !micOn() || !micOk || SETTINGS.speechWatch === false || exam.speech === false || !speechSupported()) return;
  speechCtx = buildContext(order.map(id => qById[id]).filter(Boolean));
  speech = startSpeech({
    lang: SETTINGS.speechLang || "ar-EG",
    getContext: () => speechCtx,
    onState: st => { if (st === speechState) return; speechState = st; if (st.startsWith("denied")) flag("🔎 تعذّر تشغيل «فهم الكلام» على هذا الجهاز — يكمل رصد الصوت العادي"); },
    onHit: onSpeechHit
  });
}
// الطالب (أو حد جنبه) قال السؤال أو الإجابات أو اتكلم عن الغش ← خرق فوري بالصورة + مقطع صوتي
async function onSpeechHit(h) {
  if (!running) return;
  speechCount++;
  const type = `${h.label}: «${h.said.slice(0, 90)}»`;
  recordMajor(type);
  const clip = await Promise.race([clipP || recordClip(camStream, 5000), new Promise(r => setTimeout(() => r(null), 7000))]);
  clipP = null;
  if (clip && running) saveEvidence("talk", `🎙️ تسجيل صوتي — ${h.label}`.slice(0, 280), clip);
}
function startVoiceMonitor() {
  if (voice) { voice.stop(); voice = null; }
  startSpeechWatch();
  if (!running || !micOn() || !micOk || !camStream) return;
  voice = startVoice(camStream, {
    talkSec: SETTINGS.talkSec || 3,
    onStart: () => { if (!clipP) clipP = recordClip(camStream, 6000); },
    onTalk: onTalk
  });
}
async function onTalk() {
  if (!running) return;
  talkCount++;
  const per = SETTINGS.talkPerViolation || 3;
  const clip = clipP ? await Promise.race([clipP, new Promise(r => setTimeout(() => r(null), 7000))]) : null;
  clipP = null;
  if (!running) return;
  flag(`🔎 رصد صوت كلام بجوار الطالب (المرة ${talkCount})`);
  saveEvidence("talk", `صوت كلام — المرة ${talkCount}`, clip).then(img => { if (talkCount === 1 || talkCount % per === 0) tg(`🎙️ رصد كلام (المرة ${talkCount})\n${who()}`, img); });
  if (SETTINGS.silentMode) return conduct("min", `كلام أثناء الاختبار (المرة ${talkCount})`);
  if (talkCount % per === 0) violation(`التحدث أثناء الاختبار (تكرر رصد الكلام ${talkCount} مرات)`);
  else toast(`🎙️ تم رصد صوت كلام — ممنوع التحدث أثناء الاختبار (${talkCount % per} من ${per})`, 4500);
}
function stopCamera() { if (voice) { voice.stop(); voice = null; } if (speech) { speech.stop(); speech = null; } if (camStream) camStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); camStream = null; camOk = false; micOk = false; }

async function startFaceCheck() {
  checks.face = "wait"; checks.faceMsg = "جارٍ تحميل كشف الوجه بالذكاء الاصطناعي…"; renderChecks();
  loadObjectDetector(); // يُحمَّل في الخلفية: كشف الموبايل والكتب والأشخاص
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
async function saveEvidence(kind, type, audio) {
  const s = snapshot(); if (!s) return null;
  if (s.bright < 18 && kind !== "violation") flag("الكاميرا مغطاة أو الصورة مظلمة جدًا");
  const p = addDoc(collection(db, "attempts", attemptId, "evidence"), { at: Date.now(), kind, type: type || "", img: s.img, dark: s.bright < 18, ...(audio ? { audio } : {}) }).catch(console.error);
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
  if (exam.geoLock) {
    const f = fenceOf(exam); await refreshLoc(); checks.geo = geoDecide(loc, f, !!SETTINGS.geoStrict); renderChecks();
    if (!checks.geo.ok && (SETTINGS.geoBlockFar || !SETTINGS.smooth)) { $("startErr").textContent = geoMsg(checks.geo, f); $("startErr").classList.remove("hidden"); return; }
    $("startErr").classList.add("hidden");
  }
  if (!allChecksOk()) return;
  const btn = $("btnStart"); btn.disabled = true; btn.textContent = "جارٍ البدء…";
  enterFullscreen();
  const now = Date.now();
  const qIds = pickQuestions(exam, attemptId);
  try {
    await setDoc(attemptRef, {
      examId: exam.id, examTitle: exam.title, course: exam.course, owner: exam.owner || "",
      name: me.name, nameKey: normalizeName(me.name), group: me.group, seat: me.seat || "", rosterId: exam.rosterId || "",
      uid: deviceId, deviceId, pledge: pledge || null, device: devInfo || null, seb: inSEB(), mic: !!micOk, geoLock: !!exam.geoLock, geoDist: checks.geo && checks.geo.d != null ? checks.geo.d : null, geoVerified: !!(checks.geo && checks.geo.verified), location: loc, locationError: locErr, camera: !!camOk, faceAI: !!(exam.faceAI && faceOn),
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
  if (exam.camera) { await startCamera(); if (exam.faceAI) { loadObjectDetector(); faceOn = await loadFaceDetector(); } }
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
}

// ---------------------------------------------------------------- local backup (offline)
const LKEY = () => "qz_ans_" + attemptId;
function writeLocal() { try { localStorage.setItem(LKEY(), JSON.stringify({ answers, qPos, restarts, at: Date.now() })); } catch { } }
function readLocal() { try { return JSON.parse(localStorage.getItem(LKEY()) || "null"); } catch { return null; } }
function clearLocal() { try { localStorage.removeItem(LKEY()); } catch { } }

// ---------------------------------------------------------------- exam
function beginExam(a) {
  answers = { ...(a.answers || {}) }; violations = a.violationCount || 0; restarts = a.restarts || 0; myViol = (a.violations || []).slice(); warnItems = myViol.map(v => ({ kind: "maj", text: v.type, at: v.at })); minorCount = (a.flagCount || 0) ? Math.min(a.flagCount, 3) : 0; lastEventAt = 0; lastCheer = Date.now();
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
  camLostShown = false; $("camBlock").classList.add("hidden"); renderWarnList(); renderConduct(); placeSelfcam();
  if (SETTINGS.smooth && exam.camera && checks.dev === false) setTimeout(() => violation(`بدأ الاختبار مع ${checks.devMsg || "سماعة / كاميرا افتراضية"}`, true), 3000);
  if (SETTINGS.smooth && checks.screen === false) setTimeout(() => violation("بدأ الاختبار مع شاشة إضافية متصلة", true), 3200);
  if (exam.geoLock && checks.geo && checks.geo.verified && !checks.geo.ok) setTimeout(() => violation(`خارج مكان الاختبار — يبعد حوالي ${checks.geo.d} متر عن ${fenceOf(exam).name || "القاعة"}`, true), 2700);
  else if (exam.geoLock && checks.geo && !checks.geo.verified) setTimeout(() => record(checks.geo.reason === "noloc" ? `دخل بدون تحديد موقع (${locErr || "غير متاح"})` : `تعذّر التأكد من وجوده داخل ${fenceOf(exam).name || "مكان الاختبار"} (دقة الموقع ≈ ${loc ? loc.accuracy : "؟"} م، يبعد ≈ ${checks.geo.d ?? "؟"} م)`), 2500);
  if (exam.camera && (!camOk || (micOn() && !micOk))) setTimeout(() => camLost(!camOk ? "الكاميرا غير مفعّلة أثناء الاختبار" : "الميكروفون غير مفعّل أثناء الاختبار"), 2500);
  else startVoiceMonitor();
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

// ===== تنبيهات قرب انتهاء الوقت =====
const TIME_ALERTS = [
  { sec: 600, lvl: "warn", title: "متبقي 10 دقائق على انتهاء الاختبار", sub: "راجع الأسئلة التي لم تُجب عنها (المربعات غير الملوّنة)." },
  { sec: 300, lvl: "warn", title: "متبقي 5 دقائق فقط!", sub: "أكمل إجاباتك الآن — سيُسلَّم الاختبار تلقائيًا عند انتهاء الوقت." },
  { sec: 60, lvl: "low", title: "متبقي دقيقة واحدة!", sub: "سيتم تسليم إجاباتك تلقائيًا خلال دقيقة." },
  { sec: 15, lvl: "low", title: "15 ثانية…", sub: "جارٍ الاستعداد للتسليم التلقائي." }
];
let alertsFired = null, taTimer = 0;
function alertBeep(times) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ac = alertBeep.ac || (alertBeep.ac = new AC()); ac.resume?.();
    for (let i = 0; i < times; i++) {
      const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + i * 0.28;
      o.type = "sine"; o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.start(t0); o.stop(t0 + 0.22);
    }
  } catch { /* بدون صوت */ }
  try { navigator.vibrate?.(times > 1 ? [200, 100, 200] : 200); } catch { /* */ }
}
function showTimeAlert(a) {
  const el = $("timeAlert");
  $("taTitle").textContent = a.title; $("taSub").textContent = a.sub;
  el.classList.remove("hidden", "warn", "low"); el.classList.add(a.lvl);
  void el.offsetWidth; el.classList.add("show");
  alertBeep(a.lvl === "low" ? 2 : 1); if (voice) voice.pause(2500);
  clearTimeout(taTimer); taTimer = setTimeout(hideTimeAlert, a.sec <= 15 ? 15000 : 7000);
}
function hideTimeAlert() { const el = $("timeAlert"); el.classList.remove("show"); el.classList.add("hidden"); }
$("taClose").onclick = hideTimeAlert;
function checkTimeAlerts(left) {
  const total = (endAt - startMs) / 1000;
  if (!alertsFired) { // أول مرة: لا نعرض تنبيهات لعتبات تجاوزها الطالب بالفعل أو أكبر من نصف المدة
    alertsFired = new Set(TIME_ALERTS.filter(a => left <= a.sec || a.sec >= total / 2).map(a => a.sec));
    return;
  }
  const a = TIME_ALERTS.find(x => left <= x.sec && !alertsFired.has(x.sec));
  if (!a) return;
  TIME_ALERTS.filter(x => left <= x.sec).forEach(x => alertsFired.add(x.sec));
  showTimeAlert(a);
}

function tick() {
  const left = (endAt - Date.now()) / 1000;
  if (running && left > 0) checkTimeAlerts(left);
  const t = $("timer"); t.textContent = mmss(left);
  t.classList.toggle("low", left <= 60);
  const t2 = $("timer2"); t2.textContent = mmss(left);
  const total = Math.max(1, endAt - startMs), frac = Math.max(0, Math.min(1, (endAt - Date.now()) / total));
  $("tbarFill").style.width = (frac * 100) + "%";
  $("sideTimer").classList.toggle("warn", left <= 300 && left > 60);
  $("sideTimer").classList.toggle("low", left <= 60);
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
  hideTimeAlert(); hideStudentWarn(); alertsFired = null; if ($("mConduct")) $("mConduct").classList.add("hidden");
  if (voice) { voice.stop(); voice = null; } $("camBlock").classList.add("hidden");
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
    أجبت عن <b>${n}</b> من <b>${order.length}</b> سؤال. تم حفظ إجاباتك وإرسالها لأستاذ المقرر.${violSummary()}`;
  show("scrDone");
  if (inSEB()) { const q = $("sebQuit"); q.href = new URL("seb-quit.html", location.href).href; q.classList.remove("hidden"); }
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
// ---- قائمة الإنذارات على الشاشة (بتتحدث مع كل إنذار — بدون إيقاف الاختبار)
let warnItems = [];
function addWarnItem(kind, text) {
  if (!SETTINGS.studentWarnings) return;
  warnItems.push({ kind, text, at: Date.now() });
  renderWarnList();
}
function renderWarnList() {
  const html = warnItems.slice().reverse().slice(0, 30).map(w => `<li class="${w.kind}"><time>${new Date(w.at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</time><span>${w.kind === "maj" ? "🚨" : "👀"} ${esc(w.text)}</span></li>`).join("");
  const majors = warnItems.filter(w => w.kind === "maj").length;
  $("wlList").innerHTML = html; $("wlPopList").innerHTML = html || "<li>لا توجد إنذارات</li>";
  $("wlCount").textContent = warnItems.length;
  $("wlBox").classList.toggle("hidden", !warnItems.length);
  const b = $("warnBadge");
  b.classList.toggle("hidden", !warnItems.length);
  b.textContent = `⚠️ إنذارات: ${majors}${warnItems.length > majors ? ` • ملاحظات: ${warnItems.length - majors}` : ""}`;
}
$("warnBadge").onclick = () => { renderWarnList(); $("warnPop").classList.toggle("hidden"); };
$("wlPopClose").onclick = () => $("warnPop").classList.add("hidden");
function updateWarnBadge() {
  if (SETTINGS.silentMode && SETTINGS.studentWarnings) return renderWarnList();
  const b = $("warnBadge");
  b.classList.toggle("hidden", violations === 0);
  b.textContent = SETTINGS.silentMode ? `⚠️ إنذارات: ${violations}` : `⚠️ إنذار ${violations} من ${PEN.length}`;
}
// ---- إنذار على الشاشة بدون إيقاف الاختبار (شريط يظهر أعلى الشاشة ويختفي لوحده)
let vwT = 0, vwLast = {}, vwPending = null;
function studentWarn(title, sub, lvl = "low", ic = "⚠️", replay, listText) {
  if (!SETTINGS.studentWarnings || !running) return;
  if (!replay && lvl !== "good") addWarnItem(lvl === "low" ? "maj" : "min", listText || title);
  if (document.hidden) { vwPending = [title, sub, lvl, ic]; return; } // يظهر أول ما يرجع للاختبار
  const k = title.replace(/\d+/g, ""); if (vwLast[k] && Date.now() - vwLast[k] < 8000) return; vwLast[k] = Date.now();
  const el = $("vWarn");
  $("vwIc").textContent = ic; $("vwTitle").textContent = title; $("vwSub").textContent = sub || "";
  el.classList.remove("hidden", "warn", "low", "good"); el.classList.add(lvl); void el.offsetWidth; el.classList.add("show");
  if (lvl === "low") { alertBeep(1); try { navigator.vibrate && navigator.vibrate(250); } catch { } }
  if (voice) voice.pause(2500);
  clearTimeout(vwT); vwT = setTimeout(hideStudentWarn, lvl === "good" ? 5000 : 8000);
}
// ---- محرّك السلوك: رسالة باسم الخرق + ما سيترتب عليه + تصعيد حسب التكرار + تشجيع للملتزم
const WARN_MAP = [
  [/تبويب|تطبيق|مغادرة صفحة|نافذة أو برنامج/, "خرجت من صفحة الاختبار", "فتح أي تطبيق أو تبويب تاني ممنوع — ارجع وركّز في اختبارك"],
  [/موبايل/, "ظهر موبايل أمام الكاميرا", "استخدام الموبايل أثناء الاختبار غش — شيله بعيد فورًا"],
  [/شخص آخر|أكثر من شخص/, "ظهر شخص تاني جنبك", "لازم تمتحن لوحدك — أي مساعدة من حد بتتحسب غش"],
  [/عدم ظهور الطالب/, "مش ظاهر قدام الكاميرا", "خليك قاعد قدام الكاميرا ووشك واضح"],
  [/الكاميرا غير مفعّلة|إيقاف الكاميرا|الكاميرا لا ترسل|مغطاة|مظلمة/, "الكاميرا مقفولة أو متغطية", "شغّل الكاميرا وخلي وشك ظاهر — الاختبار مراقب"],
  [/الميكروفون/, "الميكروفون مقفول", "شغّل الميكروفون — الاختبار مراقب بالصوت"],
  [/سماعة/, "فيه سماعة متوصلة", "السماعات ممنوعة — افصلها فورًا"],
  [/كاميرا افتراضية|صورة الكاميرا ثابتة/, "صورة الكاميرا مش حقيقية", "استخدم كاميرا جهازك الحقيقية — الفيديو المزيف غش"],
  [/تصوير الشاشة/, "حاولت تصوّر الشاشة", "تصوير الأسئلة أو نشرها ممنوع"],
  [/خارج مكان الاختبار/, "إنت خارج مكان الاختبار", "لازم تمتحن من جوه القاعة"],
  [/شاشة إضافية/, "فيه شاشة إضافية متوصلة", "افصل أي شاشة إضافية"],
  [/النظر بعيدًا/, "بتبص بعيد عن الشاشة", "ركّز في شاشتك — النظر يمين وشمال بيتسجل عليك"],
  [/إملاء/, "اتسمعت بتملي إجابات", "قول الإجابات أو إملاؤها لحد = غش صريح — صوتك وصورتك اتسجلوا"],
  [/بصوت مسموع/, "اتسمعت بتقرأ السؤال أو الإجابة بصوت", "قراءة الأسئلة أو الإجابات بصوت عالي ممنوعة — صوتك وصورتك اتسجلوا"],
  [/حديث عن الغش/, "اتسمعت بتطلب أو تدي إجابات", "طلب الإجابات أو إرسال الأسئلة لحد = غش — صوتك وصورتك اتسجلوا"],
  [/كلام/, "اتكلمت أثناء الاختبار", "الكلام مع أي حد ممنوع — صوتك اتسجّل"],
  [/ملء الشاشة/, "خرجت من وضع ملء الشاشة", "خليك في ملء الشاشة لحد ما تسلّم"],
  [/نسخ|لصق|قص |سحب|اختصار|القائمة/, "حاولت تنسخ أو تستخدم اختصارات", "النسخ واللصق والاختصارات ممنوعة"],
  [/أدوات المطوّر/, "فتحت أدوات المطوّر", "ممنوع العبث بصفحة الاختبار"],
  [/كتاب|ورق/, "ظهر كتاب أو ورق قدام الكاميرا", "شيل أي كتب أو أوراق من قدامك"],
  [/جهاز آخر/, "ظهر جهاز تاني قدام الكاميرا", "شيل أي أجهزة تانية من قدامك"],
  [/إضافة في المتصفح/, "فيه إضافة في المتصفح بتتدخل في الاختبار", "اقفل إضافات المتصفح"],
  [/تبويب أو نافذة أخرى/, "فتحت المنصة في تبويب تاني", "خليك في تبويب واحد"],
  [/موقع/, "مش متأكدين إنك جوه مكان الاختبار", "خليك جوه القاعة"]
];
let minorCount = 0, lastEventAt = 0, lastCheer = 0;
const firstName = () => String(me && me.name || "").split(" ")[0];
function conductLevel() {
  const m = violations, n = minorCount;
  if (m >= 3 || n >= 10) return { c: "red", t: "🔴 معرّض لمحضر غش", esc: "🚨 تحذير شديد: إنت معرّض لتحرير محضر غش رسمي وإحالتك للتحقيق — راجع نفسك والتزم فورًا" };
  if (m === 2 || n >= 6) return { c: "orange", t: "🟠 تحت الملاحظة الشديدة", esc: "⚠️ تكرار الخروقات بيعرّضك لإجراءات من المشرف: خصم درجات أو إلغاء الاختبار" };
  if (m === 1 || n >= 3) return { c: "yellow", t: "🟡 تحت الملاحظة", esc: "اتسجّل عليك بالأدلة والمشرف شايفه — لو اتكرر هيتاخد معاك إجراء" };
  return { c: "green", t: "🟢 ملتزم", esc: "دي ملاحظة بسيطة — التزم عشان ماتتحولش لإنذار" };
}
function conduct(kind, type) {
  if (!running) return;
  lastEventAt = Date.now();
  if (kind === "min") minorCount++;
  const m = WARN_MAP.find(([re]) => re.test(type)) || [null, String(type).replace(/^🔎\s*/, "").replace(/\s*\(.*?\)\s*$/, ""), "التزم بميثاق الاختبار"];
  const L = conductLevel();
  const title = kind === "maj" ? `🚨 إنذار رقم ${violations}: ${m[1]}` : `تنبيه: ${m[1]}`;
  studentWarn(title, `${m[2]}. ${L.esc}`, kind === "maj" ? "low" : "warn", kind === "maj" ? "🚨" : "👀", false, m[1]);
  renderConduct();
}
const REPORT_TXT = { green: "🧾 محضر الغش: لا يوجد ✓", yellow: "🧾 محضر الغش: لا يوجد — لكن انت تحت الملاحظة", orange: "🧾 محضر الغش: <b>قريب</b> — خرق تاني ويتحرر لك محضر", red: "🧾 محضر الغش: <b>هيتم تحرير محضر غش ليك</b>" };
function renderConduct() {
  const L = conductLevel(), el = $("conduct"); if (!el) return;
  const mc = $("mConduct");
  if (mc) { mc.className = "m-conduct " + L.c; mc.innerHTML = `<b>${L.c === "green" ? "🟢 ملتزم" : L.t}</b> • ${REPORT_TXT[L.c]}`; mc.classList.toggle("hidden", !running); }
  el.className = "conduct " + L.c;
  el.innerHTML = L.c === "green"
    ? `<b>حالتك: 🟢 ملتزم</b><small>${violations || minorCount ? "كمّل كده — التزامك بيتسجل" : `ممتاز يا ${esc(firstName())} 👏 كمّل بنفس التركيز`}</small>`
    : `<b>حالتك: ${L.t}</b><small>${L.esc}</small>`;
  el.innerHTML += `<div class="rep-line">${REPORT_TXT[L.c]}</div>`;
  $("warnBadge").classList.toggle("red", L.c === "red" || L.c === "orange");
  const ps = $("wlPopState"); if (ps) { ps.textContent = L.t; ps.className = "wl-state " + L.c; }
}
// تشجيع الطالب الملتزم: رسالة إيجابية لو مفيش أي ملاحظة لفترة
setInterval(() => {
  if (!running || !SETTINGS.studentWarnings || document.hidden) return;
  const now = Date.now(), quietFor = now - Math.max(lastEventAt, startMs || now);
  if (quietFor < 5 * 60000 || now - lastCheer < 7 * 60000) return;
  lastCheer = now;
  const clean = !violations && !minorCount;
  const msgs = clean
    ? [`👏 ممتاز يا ${firstName()}! التزامك متسجّل`, `🌟 أداء ملتزم ومتميز يا ${firstName()}`, `💪 كمّل كده يا ${firstName()} — إنت ملتزم بالميثاق`]
    : [`👍 أحسنت يا ${firstName()} — التزامك اتحسّن`, `✅ كده تمام يا ${firstName()} — كمّل بنفس الالتزام`];
  studentWarn(msgs[Math.floor(Math.random() * msgs.length)], clean ? "ركّز في أسئلتك وبالتوفيق ❤️" : "آخر ٥ دقايق مفيش ولا ملاحظة — استمر", "good", "🏅");
  renderConduct();
}, 30000);
function hideStudentWarn() { const el = $("vWarn"); el.classList.remove("show"); el.classList.add("hidden"); }
$("vwClose").onclick = hideStudentWarn;
document.addEventListener("visibilitychange", () => { if (!document.hidden && vwPending) { const p = vwPending; vwPending = null; setTimeout(() => studentWarn(p[0], p[1], p[2], p[3], true), 400); } });
// تسجيل صامت: لا يظهر للطالب أي شيء — يُسجَّل للمشرف بالصورة والتوقيت
const lastRec = {};
function record(type) {
  if (!running) return;
  const now = Date.now(), key = type.replace(/\(.*?\)|\d+/g, "").trim();
  if (lastRec[key] && now - lastRec[key] < 6000) return;
  lastRec[key] = now;
  flag("🔎 " + type);
  conduct("min", type);
  if (exam && exam.camera) saveEvidence("flag", type).then(img => { if (!lastRec["tg:" + key] || now - lastRec["tg:" + key] > 60000) { lastRec["tg:" + key] = now; tg(`🔎 سلوك مسجّل\n${who()}\n${type}`, img); } });
}
// الخروقات الكبيرة: تُسجَّل وتُخصم من الدرجة — بدون إخراج الطالب ولا تنبيهه أثناء الاختبار
const MAJOR = /إملاء|بصوت مسموع|حديث عن الغش|خارج مكان الاختبار|بدأ الاختبار مع|موبايل|شخص آخر|أكثر من شخص|إيقاف الكاميرا|إيقاف الميكروفون|الكاميرا غير مفعّلة|الميكروفون غير مفعّل|سماعة|كاميرا افتراضية|تصوير الشاشة|تبويب أو نافذة أخرى|صورة الكاميرا ثابتة|عدم ظهور الطالب|شاشة إضافية/;
let myViol = [], lastMajor = {}, leaveStart = 0;
function recordMajor(type, leave) {
  if (!running) return;
  const now = Date.now(), key = leave ? "leave" : type.replace(/\(.*?\)|\d+/g, "").trim();
  if (lastMajor[key] && now - lastMajor[key] < (leave ? 4000 : 10000)) return;
  lastMajor[key] = now;
  violations++;
  const v = { type, at: now, level: "record" };
  myViol.push(v);
  updateWarnBadge();
  conduct("maj", type);
  updateDoc(attemptRef, { violations: arrayUnion(v), violationCount: violations, lastViolationAt: serverTimestamp(), lastSeenMs: now }).catch(console.error);
  const shot = exam.camera && !document.hidden ? saveEvidence("violation", type) : Promise.resolve(null);
  shot.then(img => tg(`🚨 خرق مسجّل (${violations})\n${who()}\n${type}`, img));
}
async function violation(type, force, leave) {
  if (!running) return;
  if (SETTINGS.silentMode && !(leave && SETTINGS.leaveFails)) return leave || MAJOR.test(type) ? recordMajor(type, leave) : record(type);
  const now = Date.now();
  if (!force && now - lastViol < 2500) return;
  lastViol = now; faceGrace = now + 10000; if (voice) voice.pause(9000);
  violations++;
  const level = leave && SETTINGS.leaveFails ? "fail" : PEN[Math.min(violations, PEN.length) - 1];
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
    const next = PEN[violations], failAt = PEN.indexOf("fail") + 1, left = failAt > 0 ? failAt - violations - 1 : 0;
    $("warnTitle").textContent = `إنذار ${ORDM[violations - 1] || violations}!`;
    $("warnNext").innerHTML = next === "restart" ? "إذا تكررت سيتم إغلاق الاختبار ومسح جميع إجاباتك." : next === "fail" ? "⚠️ <b>ده آخر إنذار</b> — أي مخالفة تانية = غلق الاختبار نهائيًا واعتبارك راسبًا." : `راجع نفسك والتزم بميثاق الاختبار — فاضل لك ${left === 1 ? "<b>فرصة واحدة</b>" : `<b>${left}</b> فرص`} قبل غلق الاختبار نهائيًا.`;
    $("warnOverlay").classList.remove("hidden");
    try { navigator.vibrate && navigator.vibrate([300, 120, 300]); } catch { }
  }
  try { await updateDoc(attemptRef, upd); } catch (e) { console.error(e); }
  shot.then(img => tg(`${level === "restart" ? "🗑 إغلاق ومسح الإجابات" : `🚨 محاولة غش — إنذار ${ORDM[violations - 1] || violations}`}\n${who()}\nالسبب: ${type}`, img));
}
function showRestartScreen(a, type) {
  attemptData = a;
  const next = PEN[Math.max(a.violationCount || 0, violations)];
  if (a.retakeFresh) {
    $("rsIc").textContent = "↺"; $("rsTitle").textContent = "فرصة جديدة لإعادة الاختبار"; $("btnRestart").textContent = "ابدأ الاختبار من جديد";
    $("restartMsg").innerHTML = `<b>المشرف سمحلك تعيد الاختبار من الأول</b> بوقت جديد كامل (<b>${exam.duration} دقيقة</b>). إجاباتك القديمة اتمسحت، وخروقاتك السابقة متسجلة عند المشرف.`;
    document.querySelector("#scrRestart .final-warn").innerHTML = "⚠️ دي فرصة جديدة — التزم بميثاق الاختبار، لأن تكرار الخروقات بيعرّضك لمحضر غش";
    return show("scrRestart");
  }
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
  let st = a.startedAtMs || startMs;
  const wasRetake = !!a.retakeFresh;
  if (a.retakeFresh) { st = now; violations = 0; Object.assign(upd, { startedAt: serverTimestamp(), startedAtMs: now, retakeFresh: false }); a.retakeFresh = false; myViol = []; warnItems = []; minorCount = 0; }
  try { await updateDoc(attemptRef, upd); } catch (e) { console.error(e); }
  clearLocal();
  beginExam({ ...a, startedAtMs: st, answers: {}, qPos: 0, violationCount: wasRetake ? 0 : (a.violationCount || violations), violations: wasRetake ? [] : a.violations, flagCount: wasRetake ? 0 : a.flagCount, restarts: a.restarts || restarts });
  toast("بدأت الإجابة من جديد — بالتوفيق");
};

// ملخص الخروقات للطالب في نهاية الاختبار
function violSummary() {
  const V = myViol.slice().sort((x, y) => x.at - y.at);
  if (!V.length) return `<div class="vs ok">🏅 <b>طالب ملتزم ومتميز!</b> لم يُسجَّل عليك أي خرق${minorCount ? ` (و${minorCount} ملاحظة بسيطة بس)` : ""} — شكرًا لالتزامك بميثاق الاختبار يا ${esc(firstName())} ❤️</div>`;
  return `<div class="vs bad"><b>⚠️ تم تسجيل ${V.length === 1 ? "خرق واحد" : V.length === 2 ? "خرقين" : V.length + (V.length <= 10 ? " خروقات" : " خرقًا")} عليك أثناء الاختبار:</b>
    <ol>${V.slice(0, 12).map(v => `<li><span>${new Date(v.at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> ${esc(v.type)}</li>`).join("")}</ol>
    <p>الخروقات دي مسجلة عليك بالأدلة (صور وتوقيتات)، و<b>المشرف هيراجعها ويحدد الإجراء</b> حسب ميثاق الاختبار اللي وافقت عليه${V.length >= 3 ? " — <b>وإنت معرّض لتحرير محضر غش</b>" : ""}.</p></div>`;
}
function failScreen(reason) {
  $("failMsg").innerHTML = SETTINGS.silentMode
    ? `تم غلق الاختبار نهائيًا لأنك <b>خرجت من صفحة الاختبار</b> (فتح تطبيق أو تبويب أو برنامج آخر) — وده مخالف لميثاق الاختبار اللي وقّعت عليه.${reason ? `<br><small>${esc(reason)}</small>` : ""}<br><small>لو ده حصل غصب عنك (مكالمة أو عطل)، كلّم المراقب فورًا.</small>`
    : `تم غلق الاختبار نهائيًا بسبب تكرار محاولات الغش${reason ? `<br><small>آخر مخالفة: ${esc(reason)}</small>` : ""}.`;
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
$("btnResume").onclick = () => { $("warnOverlay").classList.add("hidden"); enterFullscreen(); lastViol = Date.now(); faceGrace = Date.now() + 5000; if (voice) voice.pause(4000); };

// ---- كشف الوجه أثناء الاختبار
function startFaceMonitor() {
  clearInterval(faceInt);
  if (!(exam.camera && exam.faceAI && ((faceOn && faceReady()) || objectsReady()))) { $("faceState").textContent = ""; if (exam.camera && exam.faceAI && !objectsReady()) loadObjectDetector().then(ok => { if (ok && running) startFaceMonitor(); }); return; }
  let none = 0, multi = 0, away = 0, phone = 0, people = 0, book = 0, lap = 0, t = 0;
  faceInt = setInterval(() => {
    if (!running) return;
    t++;
    const grace = Date.now() < faceGrace;
    const r = faceOn && faceReady() ? detectFaces($("camLive")) : null;
    if (r) {
      const fs = $("faceState");
      fs.textContent = r.count === 1 ? (r.away ? "👀" : "🙂") : r.count === 0 ? "❓" : "👥";
      fs.className = "face-state " + (r.count === 1 && !r.away ? "ok" : "bad");
      // إطار الكاميرا: أخضر = تمام، أحمر = تحذير فوري (بيبص بعيد / مش ظاهر / أكتر من شخص)
      const bad = !(r.count === 1 && !r.away), sc = $("selfcam");
      sc.classList.toggle("bad", bad); sc.classList.toggle("good", !bad);
      $("faceMsg").textContent = !bad ? "" : r.count === 0 ? "⚠️ اظهر قدام الكاميرا" : r.count > 1 ? "⚠️ فيه حد جنبك!" : "⚠️ بص في الشاشة";
      if (grace) { none = multi = away = 0; }
      else {
        none = r.count === 0 ? none + 1 : 0;
        multi = r.count > 1 ? multi + 1 : 0;
        away = r.count === 1 && r.away ? away + 1 : 0;
        if (none >= (SETTINGS.faceAbsentSec || 6)) { none = 0; violation("عدم ظهور الطالب أمام الكاميرا (ترك مكانه أو غطّى الكاميرا)"); }
        else if (multi >= (SETTINGS.faceMultiSec || 2)) { multi = 0; violation("ظهور أكثر من شخص أمام الكاميرا"); }
        else if (away >= (SETTINGS.faceAwaySec || 4)) {
          away = 0; awayCount++;
          const per = SETTINGS.awayPerViolation || 3;
          flagEv(`النظر بعيدًا عن الشاشة يمين/شمال (المرة ${awayCount})`);
          if (SETTINGS.silentMode) conduct("min", `النظر بعيدًا عن الشاشة (المرة ${awayCount})`);
          if (!SETTINGS.silentMode) {
            if (awayCount % per === 0) violation(`تكرار النظر بعيدًا عن الشاشة (${awayCount} مرات)`);
            else toast(`👀 ركّز في شاشتك — تم رصد النظر بعيدًا (${awayCount % per} من ${per})`, 3500);
          }
        }
      }
    }
    // كل ثانيتين: البحث عن موبايل / كتاب / شخص آخر / جهاز آخر أمام الكاميرا
    if (t % 2 === 0 && objectsReady()) {
      const o = detectObjects($("camLive"));
      if (o && !grace) {
        phone = o.phone ? phone + 1 : 0;
        people = o.persons > 1 ? people + 1 : 0;
        book = o.book ? book + 1 : 0;
        lap = o.laptop ? lap + 1 : 0;
        if (phone >= 2) { phone = 0; violation("ظهور موبايل أمام الكاميرا"); }
        else if (people >= 2) { people = 0; violation("وجود شخص آخر بجوار الطالب"); }
        else if (book >= 3) { book = 0; flagEv("ظهور كتاب أو ورق أمام الكاميرا"); }
        else if (lap >= 3) { lap = 0; flagEv("ظهور جهاز آخر (لابتوب/تابلت) أمام الكاميرا"); }
      }
    }
  }, 1000);
}
let awayCount = 0, lastFlagEv = 0;
// مخالفة ثانوية + صورة دليل (صورة كل 20 ثانية على الأكثر لتوفير المساحة)
function flagEv(type) {
  flag(type);
  if (SETTINGS.silentMode && !/النظر بعيدًا/.test(type)) conduct("min", type);
  if (exam && exam.camera && Date.now() - lastFlagEv > 20000) { lastFlagEv = Date.now(); saveEvidence("flag", type); }
}

// فتح المنصة في تبويب أو نافذة أخرى أثناء الاختبار
try {
  const bc = new BroadcastChannel("exam-platform-tabs");
  bc.onmessage = e => { if (running && e.data === "hello") { violation("فتح المنصة في تبويب أو نافذة أخرى أثناء الاختبار"); bc.postMessage("busy"); } else if (!running && e.data === "busy") blocked("⛔", "الاختبار مفتوح في تبويب آخر", "لا يُسمح بفتح المنصة في أكثر من تبويب أثناء الاختبار. ارجع للتبويب الأصلي."); };
  bc.postMessage("hello");
} catch { /* متصفح قديم */ }
// إخفاء الأسئلة فور فقدان التركيز (يُفسد لقطات الشاشة والنوافذ الجانبية)
const setUnfocused = on => document.body.classList.toggle("unfocused", !!(on && running));
window.addEventListener("blur", () => setUnfocused(true));
window.addEventListener("focus", () => setUnfocused(false));
document.addEventListener("visibilitychange", () => setUnfocused(document.hidden));
// إضافات المتصفح التي تحقن محتوى في الصفحة (مساعدات الذكاء الاصطناعي، المترجمات…)
const OWN = new Set([...document.body.children]);
let injSeen = 0;
new MutationObserver(ms => {
  if (!running) return;
  for (const m of ms) for (const n of m.addedNodes) {
    if (n.nodeType !== 1 || OWN.has(n) || /^(SCRIPT|STYLE|LINK)$/.test(n.nodeName)) continue;
    if (n.parentNode !== document.body && n.parentNode !== document.documentElement) continue;
    if (injSeen++ < 5) flagEv(`إضافة في المتصفح تتدخل في صفحة الاختبار (${(n.id || n.nodeName).toString().slice(0, 40)})`);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!running) return;
  if (document.hidden) { leaveStart = leaveStart || Date.now(); violation("فتح تطبيق أو تبويب آخر / مغادرة صفحة الاختبار", true, true); }
  else if (leaveStart) {
    const sec = Math.round((Date.now() - leaveStart) / 1000); leaveStart = 0;
    flag(`🔎 رجع لصفحة الاختبار بعد ${sec} ثانية خارجها`);
    if (exam.camera) setTimeout(() => saveEvidence("flag", `لحظة العودة للاختبار بعد ${sec} ثانية`), 800);
  }
});
window.addEventListener("blur", () => setTimeout(() => { if (running && !document.hasFocus()) violation("الانتقال إلى نافذة أو برنامج آخر", true, true); }, (SETTINGS.leaveGraceSec || 3) * 1000));
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
// صورة الكاميرا ثابتة تمامًا (صورة أو فيديو مزيف أو كاميرا متجمدة) — الكاميرا الحقيقية فيها تشويش دائمًا
let prevPx = null, frozenN = 0;
function frozenCheck() {
  const v = $("camLive"); if (!v || !v.videoWidth) return;
  const c = frozenCheck.c || (frozenCheck.c = document.createElement("canvas")); c.width = 32; c.height = 24;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(v, 0, 0, 32, 24);
  const px = g.getImageData(0, 0, 32, 24).data;
  if (prevPx) { let d = 0; for (let i = 0; i < px.length; i += 4) d += Math.abs(px[i] - prevPx[i]) + Math.abs(px[i + 1] - prevPx[i + 1]); d /= (px.length / 4);
    frozenN = d < 0.08 ? frozenN + 1 : 0;
    if (frozenN >= 20) { frozenN = 0; violation("صورة الكاميرا ثابتة تمامًا (صورة أو فيديو مزيف أو كاميرا مغطاة)"); } }
  prevPx = px;
}
function guardTick() {
  if (!running) return;
  if (SETTINGS.detectDevTools && !isTouch && !document.fullscreenElement && (outerWidth - innerWidth > 220 || outerHeight - innerHeight > 260)) violation("فتح أدوات المطوّر (Developer Tools)");
  if (SETTINGS.blockMultiScreen && window.screen && window.screen.isExtended === true) violation("توصيل شاشة إضافية أثناء الاختبار");
  if (exam.camera && !camLostShown) {
    const t = camStream && camStream.getVideoTracks()[0], m = camStream && camStream.getAudioTracks()[0];
    if (!t || t.readyState === "ended") camLost(t ? "إيقاف الكاميرا أثناء الاختبار" : "الكاميرا غير مفعّلة أثناء الاختبار");
    else if (micOn() && (!m || m.readyState === "ended")) camLost("إيقاف الميكروفون أثناء الاختبار");
    else if (t.muted) flag("الكاميرا لا ترسل صورة (مكتومة)");
    else frozenCheck();
  }
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
function showSEB(exId) {
  const k = osKind(), d = devInfo;
  $("sebDev").textContent = d ? `${typeLabel(d.type)} — ${osLabel(d.os)}` : osLabel(k);
  $("sebGet").href = SEB_DOWNLOAD[k] || SEB_DOWNLOAD.windows;
  $("sebOpen").href = sebLink(exId);
  $("sebBack").onclick = () => show("scrLogin");
  show("scrSEB");
}
function blocked(ic, title, msg) {
  $("blkIc").textContent = ic; $("blkTitle").textContent = title; $("blkMsg").textContent = msg;
  show("scrBlocked");
}

// ---------------------------------------------------------------- دليل الطالب + التواصل (بعد تسجيل الدخول فقط)
let guideMounted = false, lastSend = 0;
$("sNav").onclick = e => {
  const b = e.target.closest("[data-go]"); if (!b || !loggedIn) return;
  if (b.dataset.go === "guide") { if (!guideMounted) { mountGuide($("scrGuide"), STUDENT_GUIDE, "دليل الطالب"); guideMounted = true; } show("scrGuide"); }
  else if (b.dataset.go === "contact") { $("cWho").textContent = `${me.name} — مجموعة ${me.group}${me.seat ? " — جلوس " + me.seat : ""} — ${exam.course}`; $("cErr").classList.add("hidden"); show("scrContact"); }
  else show(lastMain);
};
$("btnSend").onclick = async () => {
  const text = $("cText").value.trim(), phone = $("cPhone").value.replace(/[^\d+]/g, "").slice(0, 20);
  const er = m => { $("cErr").textContent = m; $("cErr").classList.toggle("hidden", !m); };
  er(""); $("cOk").classList.add("hidden");
  if (!loggedIn || !exam) return;
  if (text.length < 5) return er("اكتب رسالتك أولًا.");
  if (Date.now() - lastSend < 60000) return er("انتظر دقيقة قبل إرسال رسالة أخرى.");
  const b = $("btnSend"); b.disabled = true; b.textContent = "جارٍ الإرسال…";
  try {
    await addDoc(collection(db, "messages"), {
      uid: deviceId, owner: exam.owner || "", examId: exam.id, course: exam.course || "", examTitle: exam.title || "",
      name: me.name, group: String(me.group), seat: me.seat || "", subject: $("cSubject").value, phone, text: text.slice(0, 1200), at: Date.now(), read: false
    });
    lastSend = Date.now(); $("cText").value = ""; $("cOk").classList.remove("hidden");
  } catch (err) { console.error(err); er("تعذّر الإرسال، حاول مرة أخرى."); }
  finally { b.disabled = false; b.textContent = "إرسال الرسالة"; }
};

// الكاميرا على اللابتوب: جوه العمود الجانبي فوق العداد (عشان ماتغطيش زر التسليم) — وعلى الموبايل في الشريط العلوي
const deskMQ = window.matchMedia("(min-width: 861px)");
function placeSelfcam() {
  const sc = $("selfcam"), side = document.querySelector(".qnav-card");
  if (!sc || !side) return;
  if (deskMQ.matches) {
    let top = side.querySelector(".side-top");
    if (!top) { top = document.createElement("div"); top.className = "side-top"; const t = $("sideTimer"); t.parentElement.insertBefore(top, t); top.appendChild(t); }
    if (sc.parentElement !== top) top.prepend(sc);
    sc.classList.add("in-side");
  }
  else { if (sc.parentElement !== document.body) document.body.appendChild(sc); sc.classList.remove("in-side"); }
}
deskMQ.addEventListener ? deskMQ.addEventListener("change", placeSelfcam) : deskMQ.addListener(placeSelfcam);
