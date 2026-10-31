import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, onSnapshot, writeBatch, updateDoc, deleteDoc, serverTimestamp, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, SETTINGS, SUPER_ADMINS, SUPER_NAME } from "./config.js";
import { isConfigured, esc, fmtDateTime, fmtTime, mmss, LETTERS, frameGuard, initAppCheck, sid, num, normalizeName } from "./common.js";
import { parseWordText, parseRows, wordHtmlToText, TYPE_LABEL, LEVEL_LABEL, splitAccepted, normAr } from "./parser.js";
import { questionsOf, answerText, correctText, isAnswered } from "./scoring.js";
import { gradeOf, isExpired, isFinished, computeReport } from "./analytics.js";
import { printGradeSheet } from "./print.js";
import { $, S, hooks, scoreOf, passOf, nflags, pctColor, mapLink, byName, statusBadge, warnBadge, toast, loadEvidence, shotsHtml, timelineHtml, resultRow, RES_W, sheet, safeName } from "./admin-shared.js";
import { initReports, renderReports } from "./reports.js";
import { mountGuide } from "./guide.js";
import { ADMIN_GUIDE } from "./guide-content.js";

const view = id => ["vLogin", "vConfig", "vApp"].forEach(v => $(v).classList.toggle("hidden", v !== id));
$("sideInst").textContent = SETTINGS.department || "";
if (!isConfigured(firebaseConfig)) { view("vConfig"); throw new Error("config"); }
frameGuard();
const app = initializeApp(firebaseConfig);
await initAppCheck(app, SETTINGS.appCheckSiteKey);
const db = S.db = getFirestore(app), auth = S.auth = getAuth(app);
S.qs = {}; S.reqs = {}; S.msgs = {};
let guideMounted = false;

let firstAttemptsSnap = true, unsubs = [], unread = 0, soundOn = true, notifOn = false, seenAlerts = 0, parsed = null, rosterParsed = null;
try { soundOn = localStorage.getItem("qz_sound") !== "0"; notifOn = localStorage.getItem("qz_notif") === "1" && Notification.permission === "granted"; } catch { }
$("swSound").classList.toggle("on", soundOn); $("swNotif").classList.toggle("on", notifOn);
const isMine = e => S.me.isSuper || (e && e.owner === S.me.email);
const visibleExams = () => Object.values(S.exams).filter(isMine).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

// ======================================================= auth + الصلاحيات
$("lForgot").onclick = async () => {
  const er = $("lErr"), em = $("lEmail").value.trim();
  if (!em) { er.textContent = "اكتب بريدك الإلكتروني أولًا ثم اضغط «نسيت كلمة المرور؟»."; er.classList.remove("hidden"); return; }
  try {
    auth.languageCode = "ar";
    await sendPasswordResetEmail(auth, em);
    er.innerHTML = "✅ تم إرسال رابط تعيين كلمة مرور جديدة إلى بريدك — افتحه (راجع الـ Spam أيضًا) ثم ادخل بكلمة المرور الجديدة.";
    er.classList.add("ok-msg");
  } catch (err) { er.textContent = "تعذّر الإرسال" + (err && err.code ? `  [${err.code}]` : ""); er.classList.remove("ok-msg"); }
  er.classList.remove("hidden");
};
$("loginForm").onsubmit = async e => {
  e.preventDefault(); const er = $("lErr"); er.classList.add("hidden"); er.classList.remove("ok-msg");
  $("lBtn").disabled = true; $("lBtn").textContent = "جارٍ الدخول…";
  try { await signInWithEmailAndPassword(auth, $("lEmail").value.trim(), $("lPass").value); }
  catch (err) {
    const c = (err && err.code) || "";
    const M = {
      "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة — أو الحساب غير موجود في Firebase ← Authentication ← Users.",
      "auth/wrong-password": "كلمة المرور غير صحيحة.",
      "auth/user-not-found": "هذا البريد غير مسجّل في Firebase ← Authentication ← Users.",
      "auth/invalid-email": "صيغة البريد غير صحيحة.",
      "auth/operation-not-allowed": "طريقة الدخول بالبريد وكلمة المرور غير مفعّلة: Firebase ← Authentication ← Sign-in method ← Email/Password ← Enable.",
      "auth/configuration-not-found": "خدمة Authentication غير مفعّلة في مشروع Firebase: افتح Authentication واضغط Get started ثم فعّل Email/Password.",
      "auth/unauthorized-domain": "دومين الموقع غير مضاف: Firebase ← Authentication ← Settings ← Authorized domains ← أضف دومين GitHub Pages.",
      "auth/too-many-requests": "محاولات كثيرة — انتظر بضع دقائق أو أعد تعيين كلمة المرور من Firebase.",
      "auth/network-request-failed": "مشكلة في الاتصال بالإنترنت أو أن متصفحك يحجب Firebase.",
      "auth/user-disabled": "هذا الحساب موقوف من Firebase ← Authentication ← Users.",
      "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "مفتاح apiKey في config.js غير صحيح.",
      "auth/firebase-app-check-token-is-invalid.": "App Check مفعّل بدون مفتاح صحيح في config.js — عطّل Enforcement لـ Authentication في App Check."
    };
    er.textContent = (M[c] || "تعذّر الدخول") + (c ? `  [${c}]` : "");
    er.classList.remove("hidden"); console.error(err);
  }
  finally { $("lBtn").disabled = false; $("lBtn").textContent = "دخول"; }
};
const logout = () => signOut(auth);
$("btnLogout").onclick = logout; $("btnLogoutM").onclick = logout; $("btnLogoutTop").onclick = logout;
function renderMe() {
  const role = S.me.isSuper ? "مشرف رئيسي" : "معلم";
  $("meEmail").innerHTML = `${esc(S.me.name)}<span class="role-tag">${role}</span><span class="me-mail" dir="ltr">${esc(S.me.email)}</span>`;
  $("ubName").textContent = S.me.name; $("ubRole").textContent = `${role} • ${S.me.email}`;
  const parts = String(S.me.name).replace(/^(د\.|أ\.د\.|أ\.|م\.)\s*/, "").trim();
  $("ubAv").textContent = parts.charAt(0) || "👤";
}

onAuthStateChanged(auth, async user => {
  unsubs.forEach(u => u()); unsubs = [];
  if (!user) { view("vLogin"); return; }
  const email = user.email;
  const isSuper = SUPER_ADMINS.includes(user.uid) || SUPER_ADMINS.map(x => x.toLowerCase()).includes(String(email).toLowerCase());
  let prof = null;
  try { const d = await getDoc(doc(db, "staff", email)); if (d.exists()) prof = d.data(); } catch { }
  if (!isSuper && !prof) {
    view("vLogin"); const er = $("lErr"); er.textContent = "هذا الحساب غير مسجل كمشرف أو معلم في المنصة."; er.classList.remove("hidden");
    return signOut(auth);
  }
  Object.assign(S.me, { email, isSuper, name: prof?.name || (isSuper ? (SUPER_NAME || "المشرف الرئيسي") : email), tgChat: prof?.tgChat || "" });
  renderMe();
  document.querySelectorAll(".super-only").forEach(x => x.classList.toggle("hidden", !isSuper));
  $("sName").value = S.me.name; $("sChat").value = S.me.tgChat;
  $("tgState").innerHTML = SETTINGS.telegramRelayUrl ? "✓ رابط الإرسال (Relay) مضبوط في config.js" : "⚠️ لم يُضبط <code>telegramRelayUrl</code> في config.js بعد";
  view("vApp"); startListeners();
});

// ======================================================= tabs
const curTab = () => document.querySelector(".tab:not(.hidden)")?.id.replace("tab-", "");
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
  document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("act", x.dataset.tab === b.dataset.tab));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("hidden", t.id !== "tab-" + b.dataset.tab));
  if (b.dataset.tab === "live") markRead();
  if (b.dataset.tab === "results") renderResults();
  if (b.dataset.tab === "reports") renderReports();
  if (b.dataset.tab === "guide" && !guideMounted) { mountGuide($("adminGuide"), ADMIN_GUIDE, "دليل استخدام المنصة للمشرف والمعلم"); guideMounted = true; }
  if (b.dataset.tab === "messages") renderMessages();
  window.scrollTo(0, 0);
});

// ======================================================= live data
function permError(e) {
  console.error(e);
  if (e && e.code === "permission-denied") toast("danger", "لا تملك الصلاحية", "تأكد من إضافة بريدك في firestore.rules أو في قائمة المعلمين.", 0);
}
let repTimer;
function startListeners() {
  const me = S.me;
  unsubs.push(onSnapshot(collection(db, "exams"), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "removed") { delete S.exams[ch.doc.id]; delete S.keys[ch.doc.id]; delete S.qs[ch.doc.id]; }
      else S.exams[ch.doc.id] = { id: ch.doc.id, ...ch.doc.data(), questions: S.qs[ch.doc.id] || [] };
    });
    Promise.all(visibleExams().filter(e => !S.keys[e.id]).map(async e => {
      const [k, q] = await Promise.all([getDoc(doc(db, "keys", e.id)), getDoc(doc(db, "examQuestions", e.id))]);
      S.keys[e.id] = k.exists() ? { answers: k.data().answers || {}, cancelled: k.data().cancelled || {} } : { answers: {}, cancelled: {} };
      S.qs[e.id] = q.exists() ? (q.data().questions || []) : [];
      if (S.exams[e.id]) S.exams[e.id].questions = S.qs[e.id];
    })).then(() => { fillExamSelects(); renderAll(); }).catch(permError);
  }, permError));

  const attQ = me.isSuper ? collection(db, "attempts") : query(collection(db, "attempts"), where("owner", "==", me.email));
  unsubs.push(onSnapshot(attQ, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id, nu = ch.type === "removed" ? null : { id, ...ch.doc.data() }, old = S.attempts[id];
      if (!firstAttemptsSnap && nu) detectEvents(old, nu);
      if (nu) S.attempts[id] = nu; else { delete S.attempts[id]; delete S.evCache[id]; }
      if (nu && old && (nu.violationCount !== old.violationCount || nu.status !== old.status)) delete S.evCache[id];
    });
    firstAttemptsSnap = false;
    renderAll();
  }, permError));

  const rosQ = me.isSuper ? collection(db, "rosters") : query(collection(db, "rosters"), where("owner", "==", me.email));
  unsubs.push(onSnapshot(rosQ, snap => {
    snap.docChanges().forEach(ch => { if (ch.type === "removed") { delete S.rosters[ch.doc.id]; delete S.rosterStudents[ch.doc.id]; } else S.rosters[ch.doc.id] = { id: ch.doc.id, ...ch.doc.data() }; });
    renderRosters(); fillRosterSelect();
  }, permError));

  const reqQ = me.isSuper ? collection(db, "resumeRequests") : query(collection(db, "resumeRequests"), where("owner", "==", me.email));
  let firstReq = true;
  unsubs.push(onSnapshot(reqQ, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id, nu = ch.type === "removed" ? null : { id, ...ch.doc.data() }, old = S.reqs[id];
      if (!firstReq && nu && !nu.granted && !nu.denied && (!old || nu.at > old.at)) notify("warn", "⏳ طلب عودة من جهاز آخر", `${nu.name} — مجموعة ${nu.group}${nu.seat ? " — جلوس " + nu.seat : ""}`, id, true);
      if (nu) S.reqs[id] = nu; else delete S.reqs[id];
    });
    firstReq = false; renderRequests();
  }, permError));

  const msgQ = me.isSuper ? collection(db, "messages") : query(collection(db, "messages"), where("owner", "==", me.email));
  let firstMsg = true;
  unsubs.push(onSnapshot(msgQ, snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === "removed") { delete S.msgs[ch.doc.id]; return; }
      const m = { id: ch.doc.id, ...ch.doc.data() };
      if (!firstMsg && ch.type === "added") { toast("info", "📨 رسالة جديدة من طالب", `${m.name} — ${m.subject}`, 7000); if (soundOn) beep("ok"); }
      S.msgs[ch.doc.id] = m;
    });
    firstMsg = false; renderMessages();
  }, permError));

  if (me.isSuper) unsubs.push(onSnapshot(collection(db, "staff"), snap => {
    snap.docChanges().forEach(ch => { if (ch.type === "removed") delete S.staff[ch.doc.id]; else S.staff[ch.doc.id] = { id: ch.doc.id, ...ch.doc.data() }; });
    renderTeachers();
  }, permError));
}
setInterval(() => { if (curTab() === "live") { renderRunning(); renderRequests(); } }, 1000);

function renderAll() {
  renderStats(); renderRunning(); renderRequests(); renderFeed(); renderExams(); updatePending();
  if (curTab() === "results") renderResults();
  if (curTab() === "reports") { clearTimeout(repTimer); repTimer = setTimeout(() => { if (!document.querySelector("#ppOut")) renderReports(); }, 1200); }
}
const myAttempts = () => Object.values(S.attempts).filter(a => S.me.isSuper || isMine(S.exams[a.examId]) || a.owner === S.me.email);

// ======================================================= التنبيهات
const LV = { warn: ["danger", "🚨 محاولة غش — إنذار أول"], restart: ["danger", "🗑 إنذار ثانٍ — أُغلق اختباره ومُسحت إجاباته"], fail: ["lock", "⛔ رسوب — غلق نهائي بسبب الغش"] };
function detectEvents(old, a) {
  const who = `${a.name} — مجموعة ${a.group}${a.seat ? " — جلوس " + a.seat : ""}`;
  if (!old) { if (a.status === "in_progress") notify("info", "🟢 بدأ طالب الاختبار", `${who}\n${a.course}`, a.id, false); return; }
  if ((a.violationCount || 0) > (old.violationCount || 0)) {
    const v = (a.violations || []).slice(-1)[0] || {};
    const [kind, title] = LV[v.level] || (a.status === "locked" ? LV.fail : LV.warn);
    notify(kind, title, `${who}\nالسبب: ${v.type || a.lockedReason || ""}`, a.id, true);
  } else if ((a.resumeReq || 0) > (old.resumeReq || 0)) {
    notify("warn", "⏳ طلب عودة للاختبار", `${who}\nافتح «طلبات العودة» للسماح له`, a.id, true);
  } else if (old.status !== a.status && a.status === "submitted") {
    notify("ok", "✅ تم تسليم اختبار", `${who}\n${a.course}`, a.id, false);
  } else if (old.status === "suspended" && a.status === "in_progress") {
    notify("info", "↺ أعاد الدخول بعد مسح إجاباته", who, a.id, false);
  }
}
function notify(kind, title, body, attemptId, important) {
  toast(kind, title, body, important ? 9000 : 4500);
  if (soundOn) beep(kind);
  if (important) {
    unread++; updateUnread(); flashUntil[attemptId] = Date.now() + 2500;
    if (notifOn && "Notification" in window && Notification.permission === "granted") {
      try { const n = new Notification(title, { body, tag: attemptId + kind, requireInteraction: kind === "lock" }); n.onclick = () => { window.focus(); window.__detail(attemptId); n.close(); }; } catch { }
    }
  }
}
function updateUnread() { const c = $("alertCnt"); c.textContent = unread; c.classList.toggle("hidden", !unread); document.title = (unread ? `(${unread}) 🚨 ` : "") + "لوحة المشرف"; }
function markRead() { unread = 0; updateUnread(); }
$("btnClearAlerts").onclick = () => { markRead(); seenAlerts = Date.now(); renderFeed(); };
let actx;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = kind === "lock" ? [880, 660, 880, 660, 880] : kind === "danger" || kind === "warn" ? [880, 660, 880] : kind === "ok" ? [660, 990] : [740];
    seq.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.17;
      o.type = kind === "lock" || kind === "danger" ? "square" : "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.16);
    });
  } catch { }
}
document.addEventListener("click", () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch { } }, { once: true });
$("swSound").onclick = () => { soundOn = !soundOn; $("swSound").classList.toggle("on", soundOn); try { localStorage.setItem("qz_sound", soundOn ? "1" : "0"); } catch { } if (soundOn) beep("ok"); };
$("swNotif").onclick = async () => {
  if (!("Notification" in window)) return toast("danger", "غير مدعوم", "المتصفح لا يدعم إشعارات سطح المكتب.");
  if (!notifOn) {
    notifOn = (await Notification.requestPermission()) === "granted";
    toast(notifOn ? "ok" : "danger", notifOn ? "تم تفعيل الإشعارات 🔔" : "تم رفض الإشعارات", notifOn ? "ستصلك إشعارات الغش حتى لو كانت اللوحة في الخلفية." : "اسمح بالإشعارات من إعدادات المتصفح.");
  } else notifOn = false;
  $("swNotif").classList.toggle("on", notifOn);
  try { localStorage.setItem("qz_notif", notifOn ? "1" : "0"); } catch { }
};
const flashUntil = {};
const fl = id => (flashUntil[id] || 0) > Date.now() ? "flash" : "";

// ======================================================= المتابعة
const running = a => (a.status === "in_progress") && !isExpired(a);
function renderStats() {
  const A = myAttempts();
  $("stRun").textContent = A.filter(running).length;
  $("stDone").textContent = A.filter(a => a.status === "submitted").length;
  $("stWarn").textContent = A.reduce((s, a) => s + (a.violationCount || 0), 0);
  const L = A.filter(a => a.status === "locked").length;
  $("stLock").textContent = L; $("stLockCard").classList.toggle("hot", L > 0);
}
const pendingReq = a => a.resumeReq && (a.status === "in_progress" || a.status === "suspended") && !isExpired(a) && a.resumeReq > Math.max(a.resumeGrantedAt || 0, a.resumeDeniedAt || 0);
const pendingOther = r => !r.granted && !r.denied && S.attempts[r.id] && (S.attempts[r.id].status === "in_progress" || S.attempts[r.id].status === "suspended") && !isExpired(S.attempts[r.id]);
function renderRequests() {
  const R = myAttempts().filter(pendingReq), O = Object.values(S.reqs).filter(pendingOther);
  $("reqPanel").classList.toggle("hidden", !R.length && !O.length);
  $("reqList").innerHTML = R.map(a => `<div class="susp"><div class="si">⏳</div><div style="flex:1"><b>${esc(a.name)}</b> <small style="color:var(--muted)">• مجموعة ${esc(a.group)}${a.seat ? " • جلوس " + esc(a.seat) : ""} • ${esc(a.course)}</small><br>
    <small style="color:var(--muted)">من نفس الجهاز • طلب العودة ${fmtTime(a.resumeReq)} • آخر اتصال ${fmtTime(a.lastSeenMs)} • محاولات الغش ${num(a.violationCount)}${a.status === "suspended" ? " • (اختباره مُغلق بعد مسح الإجابات)" : ""}</small></div>
    <div class="row-acts"><button class="btn ok sm" data-act="grant" data-arg="${sid(a.id)}">✓ سماح بالعودة</button><button class="btn ghost sm" data-act="deny" data-arg="${sid(a.id)}">رفض</button></div></div>`).join("")
  + O.map(r => { const a = S.attempts[r.id]; return `<div class="susp"><div class="si">📱</div><div style="flex:1"><b>${esc(a.name)}</b> <small style="color:var(--muted)">• مجموعة ${esc(a.group)}${a.seat ? " • جلوس " + esc(a.seat) : ""} • ${esc(a.course)}</small><br>
    <small style="color:var(--danger)">⚠️ من <b>جهاز آخر</b> — تأكد أنه الطالب نفسه قبل الموافقة • ${fmtTime(r.at)} • محاولات الغش ${num(a.violationCount)}</small></div>
    <div class="row-acts"><button class="btn ok sm" data-act="grantOther" data-arg="${sid(r.id)}">✓ نقل الاختبار للجهاز الجديد</button><button class="btn ghost sm" data-act="denyOther" data-arg="${sid(r.id)}">رفض</button></div></div>`; }).join("");
}
function renderRunning() {
  const R = myAttempts().filter(running).sort((x, y) => (y.violationCount || 0) - (x.violationCount || 0) || byName(x, y));
  $("runBadge").textContent = `${R.length} طالب`;
  if (!R.length) { $("runBody").innerHTML = `<tr><td colspan="8"><div class="empty"><div class="e-ic">🪑</div>لا يوجد طلاب داخل الاختبار الآن</div></td></tr>`; return; }
  $("runBody").innerHTML = R.map(a => {
    const e = S.exams[a.examId], qs = questionsOf(a, e), total = qs.length || a.qCount || 0;
    const n = e ? qs.filter(q => isAnswered(q, a.answers?.[q.id])).length : Object.keys(a.answers || {}).length, pct = total ? n / total * 100 : 0;
    const left = (a.startedAtMs + (a.durationMin + (a.extraMin || 0)) * 60000 - Date.now()) / 1000;
    const online = Date.now() - (a.lastSeenMs || a.startedAtMs) < 75000;
    return `<tr data-id="${esc(a.id)}" class="${fl(a.id)}" style="cursor:pointer" data-act="detail" data-arg="${esc(a.id)}">
      <td class="name"><span class="online ${online ? "on" : "off"}" title="${online ? "متصل" : "غير متصل"}"></span>${esc(a.name)}${a.camera ? " 📷" : ""}${a.faceAI ? "🤖" : ""}</td><td>${esc(a.group)}</td><td>${esc(a.course)}</td>
      <td><div style="display:flex;align-items:center;gap:.5rem"><div class="bar" style="flex:1"><i style="width:${pct}%;background:var(--info)"></i></div><small>${n}/${total}</small></div></td>
      <td>${warnBadge(a.violationCount)}${a.restarts ? ` <span class="badge b-w1" title="أُعيد">↺${num(a.restarts)}</span>` : ""}</td><td>${nflags(a) ? `<span class="badge b-w1">${nflags(a)}</span>` : "—"}</td>
      <td style="direction:ltr;text-align:right;font-weight:700;${left < 120 ? "color:var(--danger)" : ""}">${mmss(left)}${a.extraMin ? ` <small style="color:var(--ok)">+${num(a.extraMin)}</small>` : ""}</td>
      <td data-act="noop"><div class="row-acts"><button class="icon-btn" title="إضافة وقت" data-act="extend" data-arg="${esc(a.id)}">⏱</button><button class="icon-btn" title="رسالة" data-act="msg" data-arg="${esc(a.id)}">💬</button><button class="icon-btn" title="إنهاء اختباره" data-act="end" data-arg="${esc(a.id)}">⏹</button></div></td></tr>`;
  }).join("");
}
function renderFeed() {
  const items = [];
  myAttempts().forEach(a => {
    (a.violations || []).forEach(v => items.push({ at: v.at, kind: v.level === "fail" || (!v.level && a.status === "locked") ? "lock" : "danger", a, text: v.type + (v.level ? ` ← ${({ warn: "إنذار", restart: "إغلاق ومسح الإجابات", fail: "رسوب" })[v.level]}` : "") }));
    if (a.status === "submitted" && a.submittedAtMs) items.push({ at: a.submittedAtMs, kind: "ok", a, text: a.endedByAdmin ? "أنهى المراقب اختباره" : a.autoSubmitted ? "تم التسليم تلقائيًا بانتهاء الوقت" : "تم تسليم الاختبار" });
    if (a.startedAtMs) items.push({ at: a.startedAtMs, kind: "info", a, text: "بدأ الاختبار" + (a.location ? "" : " — بدون تحديد موقع") + (a.camera ? " — الكاميرا مفعّلة" : "") });
    if (a.resumeReq) items.push({ at: a.resumeReq, kind: "warn", a, text: "طلب العودة للاختبار" });
  });
  items.sort((x, y) => y.at - x.at);
  const ic = { lock: "⛔", danger: "🚨", ok: "✅", info: "🟢", warn: "⏳" };
  const tt = { lock: "رسوب بسبب الغش", danger: "محاولة غش", ok: "تسليم", info: "دخول", warn: "طلب عودة" };
  $("feed").innerHTML = items.length ? items.slice(0, 150).map(it => `
    <div class="feed-item ${it.kind === "warn" ? "danger" : it.kind}" style="cursor:pointer;${it.at > seenAlerts && (it.kind === "danger" || it.kind === "lock") ? "background:#fff8f9" : ""}" data-act="detail" data-arg="${esc(it.a.id)}">
      <div class="fi">${ic[it.kind]}</div>
      <div><b>${tt[it.kind]}: ${esc(it.a.name)}</b><small>مجموعة ${esc(it.a.group)} • ${esc(it.a.course)}<br>${esc(it.text)}</small></div>
      <time>${fmtTime(it.at)}</time></div>`).join("")
    : `<div class="empty"><div class="e-ic">🔕</div>لا توجد تنبيهات بعد</div>`;
}

// ======================================================= التحكم المباشر
function ask({ title, label, type = "text", value = "", placeholder = "", ok = "تأكيد" }) {
  return new Promise(res => {
    $("modalCard").innerHTML = `<div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">${title}</h3><button class="btn ghost sm" id="aX">✕</button></div>
      <div class="mb"><label class="field"><span>${label}</span>${type === "textarea" ? `<textarea class="input" id="aIn" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="input" id="aIn" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>
      <button class="btn gold block" id="aOk">${ok}</button></div>`;
    $("modal").classList.remove("hidden"); setTimeout(() => $("aIn").focus(), 50);
    const done = v => { closeModal(); res(v); };
    $("aX").onclick = () => done(null); $("aOk").onclick = () => done($("aIn").value.trim());
    $("aIn").onkeydown = e => { if (e.key === "Enter" && type !== "textarea") done($("aIn").value.trim()); };
  });
}
window.__extend = async id => {
  const a = S.attempts[id]; const v = await ask({ title: `⏱ إضافة وقت لـ ${esc(a.name)}`, label: "عدد الدقائق الإضافية", type: "number", value: "5", ok: "إضافة الوقت" });
  const m = parseInt(v, 10); if (!m) return;
  try { await updateDoc(doc(db, "attempts", id), { extraMin: (a.extraMin || 0) + m }); toast("ok", "✓ تمت الإضافة", `${m} دقيقة لـ ${a.name}`); } catch (e) { permError(e); }
};
window.__msg = async id => {
  const a = S.attempts[id]; const t = await ask({ title: `💬 رسالة إلى ${esc(a.name)}`, label: "نص الرسالة (تظهر للطالب فورًا)", type: "textarea", placeholder: "مثال: انتبه، باقي 10 دقائق", ok: "إرسال" });
  if (!t) return;
  try { await updateDoc(doc(db, "attempts", id), { msg: { text: t, at: Date.now() } }); toast("ok", "✓ تم الإرسال", a.name); } catch (e) { permError(e); }
};
$("btnMsgAll").onclick = async () => {
  const R = myAttempts().filter(running); if (!R.length) return toast("danger", "لا يوجد طلاب", "لا يوجد طلاب داخل الاختبار الآن.");
  const t = await ask({ title: `📢 رسالة لكل الطلاب (${R.length})`, label: "نص الرسالة", type: "textarea", ok: "إرسال للجميع" }); if (!t) return;
  const b = writeBatch(db), at = Date.now(); R.forEach(a => b.update(doc(db, "attempts", a.id), { msg: { text: t, at } }));
  try { await b.commit(); toast("ok", "✓ تم الإرسال", `${R.length} طالب`); } catch (e) { permError(e); }
};
window.__end = async id => {
  const a = S.attempts[id]; if (!confirm(`إنهاء اختبار «${a.name}» الآن وحفظ إجاباته الحالية؟`)) return;
  try { await updateDoc(doc(db, "attempts", id), { status: "submitted", submittedAt: serverTimestamp(), submittedAtMs: Date.now(), endedByAdmin: true }); } catch (e) { permError(e); }
};
window.__grant = async id => {
  const a = S.attempts[id];
  try { await updateDoc(doc(db, "attempts", id), { resumeGrant: (a.resumeUsed || 0) + 1, resumeGrantedAt: Date.now() }); toast("ok", "✓ تم السماح بالعودة", a.name); } catch (e) { permError(e); }
};
window.__grantOther = async id => {
  const a = S.attempts[id], r = S.reqs[id]; if (!a || !r) return;
  try {
    const b = writeBatch(db);
    b.update(doc(db, "attempts", id), { uid: r.uid, resumeGrant: (a.resumeUsed || 0) + 1, resumeGrantedAt: Date.now() });
    b.update(doc(db, "resumeRequests", id), { granted: true });
    await b.commit(); toast("ok", "✓ تم نقل الاختبار", a.name);
  } catch (e) { permError(e); }
};
window.__denyOther = async id => { try { await updateDoc(doc(db, "resumeRequests", id), { denied: true }); } catch (e) { permError(e); } };
window.__deny = async id => { try { await updateDoc(doc(db, "attempts", id), { resumeDeniedAt: Date.now() }); } catch (e) { permError(e); } };
window.__failNow = async id => {
  const a = S.attempts[id]; if (!confirm(`اعتبار «${a.name}» راسبًا وغلق اختباره نهائيًا؟`)) return;
  try { await updateDoc(doc(db, "attempts", id), { status: "locked", failed: true, lockedReason: "قرار المراقب", submittedAtMs: Date.now(), submittedAt: serverTimestamp() }); closeModal(); } catch (e) { permError(e); }
};

// ======================================================= تفاصيل الطالب + ورقة الإجابة
function answerSheetHtml(a) {
  const e = S.exams[a.examId], k = S.keys[a.examId]; if (!e || !k) return "";
  const sc = scoreOf(a), qs = questionsOf(a, e);
  return `<div class="ans-sheet">${qs.map((q, i) => {
    const r = sc.per[q.id], cancelled = k.cancelled && k.cancelled[q.id];
    const v = a.answers ? a.answers[q.id] : undefined;
    const cls = cancelled ? "none" : !r || !r.answered ? "none" : r.pending ? "pend" : r.f >= 1 ? "ok" : r.f > 0 ? "part" : "bad";
    const essay = (q.type === "essay");
    return `<div class="ans-item ${cls}"><span class="apts">${cancelled ? "ملغى" : r ? `${r.pts} / ${r.of}` : ""}</span>
      <div class="aq">${i + 1}. ${esc(q.text)} <small style="color:var(--faint)">(${TYPE_LABEL[q.type || "mcq"]})</small></div>
      ${essay ? `<div class="essay-box">${esc(v || "— لم يُجب —")}</div><div class="aa">الإجابة النموذجية: <b style="color:var(--ok)">${esc(k.answers[q.id] || "—")}</b></div>
        ${isAnswered(q, v) ? `<div class="grade-in"><span>الدرجة:</span><input class="input" type="number" min="0" max="${q.points || 1}" step="0.5" value="${a.manual && a.manual[q.id] != null ? num(a.manual[q.id]) : ""}" data-a="${sid(a.id)}" data-q="${q.id}" data-max="${q.points || 1}"><span>من ${q.points || 1}</span><button class="btn ok sm" data-act="saveGrade" data-this="1">حفظ</button></div>` : ""}`
      : `<div class="aa">إجابة الطالب: <b>${esc(answerText(q, v))}</b><br>الإجابة الصحيحة: <b style="color:var(--ok)">${esc(correctText(q, k.answers[q.id]))}</b></div>`}
    </div>`;
  }).join("")}</div>`;
}
window.__saveGrade = async btn => {
  const inp = btn.parentElement.querySelector("input"), v = parseFloat(inp.value), max = +inp.dataset.max;
  if (isNaN(v) || v < 0 || v > max) return toast("danger", "درجة غير صحيحة", `اكتب رقمًا من 0 إلى ${max}`);
  try {
    await updateDoc(doc(db, "attempts", inp.dataset.a), { [`manual.${inp.dataset.q}`]: v });
    btn.textContent = "✓ تم"; btn.disabled = true;
    const it = btn.closest(".ans-item"); if (it) it.classList.replace("pend", "ok");
  } catch (e) { permError(e); }
};
window.__detail = async id => {
  const a = S.attempts[id]; if (!a) return;
  const sc = scoreOf(a), gr = sc ? gradeOf(sc.pct, passOf(a), sc.failed) : null;
  const live = running(a);
  $("modalCard").innerHTML = `
    <div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">${esc(a.name)}</h3><button class="btn ghost sm" id="mClose">✕</button></div>
    <div class="mb">
      <dl class="kv">
        <dt>المجموعة</dt><dd>${esc(a.group)}${a.seat ? ` • رقم الجلوس ${esc(a.seat)}` : ""}</dd>
        <dt>المقرر / الاختبار</dt><dd>${esc(a.course)} — ${esc(a.examTitle)}</dd>
        <dt>الحالة</dt><dd>${statusBadge(a)} ${num(a.restarts) ? `<span class="badge b-w1">أُعيد ${num(a.restarts)}×</span>` : ""}</dd>
        <dt>الدرجة</dt><dd>${sc ? `<span class="score">${sc.s} <small>/ ${sc.t}</small></span> (${sc.pct}%) — <b style="color:${gr.color}">${gr.label}</b>${sc.pending ? ` <span class="badge b-run">${sc.pending} مقالي ينتظر التصحيح</span>` : ""}` : "—"}</dd>
        <dt>البدء / التسليم</dt><dd>${fmtDateTime(a.startedAtMs)} ← ${fmtDateTime(a.submittedAtMs)}${a.extraMin ? ` • وقت إضافي ${num(a.extraMin)} د` : ""}</dd>
        <dt>الموقع</dt><dd>${a.geoLock ? `<b style="color:var(--ok)">📍 داخل الكلية</b>${a.geoDist != null ? ` (يبعد ${num(a.geoDist)} م عن المركز)` : ""}<br>` : ""}${a.location ? `<a href="${mapLink(a)}" target="_blank" rel="noopener">📍 فتح على الخريطة</a><br><small style="color:var(--muted)">${esc(a.location.address || `${a.location.lat}, ${a.location.lng}`)} (±${num(a.location.accuracy)}م)</small>` : `<span style="color:var(--danger)">${esc(a.locationError || "غير متاح")}</span>`}</dd>
        <dt>الجهاز</dt><dd><small style="color:var(--muted);word-break:break-all">${a.touch ? "📱 جهاز لمس" : "💻 كمبيوتر"} • شاشة ${esc(a.screen || "")}${a.faceAI ? " • 🤖 كشف الوجه" : ""}<br>${esc(a.userAgent || "")}</small></dd>
      </dl>
      ${live ? `<div class="toolbar" style="margin-bottom:1rem"><button class="btn ghost sm" data-act="extend" data-arg="${esc(a.id)}">⏱ إضافة وقت</button><button class="btn ghost sm" data-act="msg" data-arg="${esc(a.id)}">💬 رسالة</button><button class="btn ghost sm" data-act="end" data-arg="${esc(a.id)}">⏹ إنهاء اختباره</button></div>` : ""}
      ${pendingReq(a) ? `<div class="toolbar" style="margin-bottom:1rem"><button class="btn ok sm" data-act="grant" data-arg="${esc(a.id)}">✓ السماح بالعودة</button></div>` : ""}
      <h4 style="margin:1rem 0 .6rem;color:var(--ink)">📝 ورقة الإجابة</h4>
      ${answerSheetHtml(a)}
      <h4 style="margin:1.2rem 0 .6rem;color:var(--ink)">📷 الأدلة المصوّرة</h4>
      <div id="mShots"><div class="spinner" style="width:28px;height:28px"></div></div>
      <h4 style="margin:1.2rem 0 .6rem;color:var(--ink)">🕒 السجل الزمني (${num(a.violationCount)} محاولة غش • ${nflags(a)} ثانوية)</h4>
      ${timelineHtml(a)}
      <div style="display:flex;gap:.6rem;margin-top:1.5rem;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:1.2rem">
        <button class="btn danger sm" id="mReset">↺ السماح له بإعادة الاختبار من الصفر</button>
        ${a.status !== "locked" ? `<button class="btn ghost sm" style="color:var(--danger)" data-act="failNow" data-arg="${esc(a.id)}">⛔ اعتباره راسبًا (غش)</button>` : ""}
      </div>
      <p style="font-size:.8rem;color:var(--faint);margin-top:.5rem">إعادة السماح تحذف محاولته وأدلتها بالكامل ليتمكن من الدخول من جديد.</p>
    </div>`;
  $("modal").classList.remove("hidden");
  $("mClose").onclick = closeModal;
  $("mReset").onclick = async () => {
    if (!confirm(`حذف محاولة «${a.name}» وأدلتها والسماح له بالدخول من جديد؟`)) return;
    try { await deleteAttempts([a]); closeModal(); toast("ok", "✓ تم", `يمكن الآن لـ ${a.name} دخول الاختبار من جديد.`); } catch (e) { permError(e); }
  };
  const ev = await loadEvidence(id);
  if ($("mShots")) $("mShots").innerHTML = shotsHtml(ev);
};
function closeModal() { $("modal").classList.add("hidden"); }
$("modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
async function deleteAttempts(list) {
  const refs = [];
  for (const a of list) {
    const ev = await getDocs(collection(db, "attempts", a.id, "evidence")).catch(() => ({ docs: [] }));
    ev.docs.forEach(d => refs.push(d.ref));
    if (S.reqs[a.id]) refs.push(doc(db, "resumeRequests", a.id));
    refs.push(doc(db, "attempts", a.id));
    if (a.deviceId) refs.push(doc(db, "deviceLocks", a.examId + "_" + a.deviceId));
  }
  for (let i = 0; i < refs.length; i += 400) { const b = writeBatch(db); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
}

// ======================================================= الاختبارات: رفع الأسئلة
const drop = $("drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, () => drop.classList.add("over")));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("over")));
$("nFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $("dropTitle").textContent = "جارٍ قراءة " + f.name + "…";
  try {
    const ext = f.name.split(".").pop().toLowerCase(), buf = await f.arrayBuffer();
    if (ext === "docx") {
      const html = (await mammoth.convertToHtml({ arrayBuffer: buf })).value;
      const root = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html").body.firstChild;
      const w = wordHtmlToText(root);
      parsed = parseWordText(w.text, w.images); parsed.images = w.images;
    } else if (["xlsx", "xls", "csv"].includes(ext)) {
      const wb = XLSX.read(buf, { type: "array" });
      parsed = parseRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false })); parsed.images = [];
    } else if (ext === "doc") throw new Error("صيغة .doc القديمة غير مدعومة — افتح الملف في وورد واحفظه بصيغة .docx");
    else throw new Error("صيغة غير مدعومة. استخدم ملف وورد .docx أو إكسل .xlsx");
    if (!$("nTitle").value.trim()) $("nTitle").value = f.name.replace(/\.[^.]+$/, "");
    $("dropTitle").textContent = "✓ " + f.name;
    renderPreview();
  } catch (err) {
    console.error(err); parsed = null; $("preview").classList.add("hidden");
    $("dropTitle").textContent = "اسحب ملف الأسئلة هنا أو اضغط للاختيار";
    toast("danger", "⚠️ تعذّرت قراءة الملف", err.message || String(err), 8000);
  }
  e.target.value = "";
};
function previewQ(q, key, i, images) {
  const t = q.type || "mcq";
  let body = "";
  if (t === "mcq" || t === "tf") body = `<ul>${q.options.map((o, j) => `<li class="${key === j ? "c" : ""}">${LETTERS[j]}) ${esc(o)}</li>`).join("")}</ul>`;
  else if (t === "match") body = `<ul>${q.left.map((l, j) => `<li class="c">${esc(l)} ← ${esc(q.right[key[j]])}</li>`).join("")}${q.right.filter((_, j) => !key.includes(j)).map(r => `<li>➕ اختيار زائد: ${esc(r)}</li>`).join("")}</ul>`;
  else if (t === "order") body = `<ul>${key.map((ii, j) => `<li class="c">${j + 1}. ${esc(q.items[ii])}</li>`).join("")}</ul>`;
  else if (t === "fill") body = `<ul><li class="c">${key.map(esc).join(" أو ")}</li></ul>`;
  else body = `<ul><li>${key ? "الإجابة النموذجية: " + esc(key) : "يُصحَّح يدويًا"}</li></ul>`;
  const img = q.img != null && images && images[q.img] ? `<img src="${images[q.img]}" style="max-height:120px;border-radius:10px;margin:.3rem 0">` : q.imgUrl ? `<img src="${esc(q.imgUrl)}" style="max-height:120px;border-radius:10px;margin:.3rem 0">` : "";
  return `<div class="preview-q"><div class="pq">${i + 1}. ${esc(q.text)} <em>(${TYPE_LABEL[t]} • ${q.points} ${q.points === 1 ? "درجة" : "درجات"}${q.level ? " • " + LEVEL_LABEL[q.level] : ""})</em></div>${img}${body}</div>`;
}
function renderPreview() {
  const { questions, key, errors, images } = parsed;
  const pts = questions.reduce((s, q) => s + q.points, 0);
  const byType = Object.entries(questions.reduce((m, q) => (m[q.type] = (m[q.type] || 0) + 1, m), {})).map(([t, n]) => `${TYPE_LABEL[t]} ${n}`).join(" • ");
  const lv = questions.reduce((m, q) => (m[q.level || "_"] = (m[q.level || "_"] || 0) + 1, m), {});
  $("pvTitle").innerHTML = `معاينة: <span style="color:var(--ok)">${questions.length} سؤال</span> • ${pts} درجة<br><small style="color:var(--muted);font-weight:600">${byType}${lv.easy || lv.mid || lv.hard ? ` — سهل ${lv.easy || 0} • متوسط ${lv.mid || 0} • صعب ${lv.hard || 0}` : ""}</small>`;
  $("pvErr").innerHTML = errors.length ? `<div class="perr"><b>⚠️ ${errors.length} ملاحظة — هذه الأسئلة لن تُضاف حتى تصحّحها في الملف:</b><ul>${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "";
  $("pvList").innerHTML = questions.map((q, i) => previewQ(q, key[q.id], i, images)).join("")
    || `<div class="empty"><div class="e-ic">🤔</div>لم يتم التعرف على أي سؤال. راجع تنسيق الملف أو استخدم النموذج الجاهز.</div>`;
  $("btnPublish").disabled = !questions.length;
  $("preview").classList.remove("hidden");
  $("preview").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("btnCancelUp").onclick = () => { parsed = null; $("preview").classList.add("hidden"); $("dropTitle").textContent = "اسحب ملف الأسئلة هنا أو اضغط للاختيار"; };
async function compressImage(dataUrl, max = 760) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  let out = c.toDataURL("image/jpeg", 0.8); if (out.length > 650000) out = c.toDataURL("image/jpeg", 0.5);
  return out;
}
const toLocalInput = ms => { if (!ms) return ""; const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocalInput = v => v ? new Date(v).getTime() : null;
$("btnPublish").onclick = async () => {
  const course = $("nCourse").value.trim(), title = $("nTitle").value.trim(), duration = parseInt($("nDur").value, 10);
  const passMark = Math.min(100, Math.max(1, parseInt($("nPass").value, 10) || 50));
  const openAt = fromLocalInput($("nOpen").value), closeAt = fromLocalInput($("nClose").value);
  const drawCount = Math.max(0, parseInt($("nDraw").value, 10) || 0);
  if (!course) return toast("danger", "⚠️ بيانات ناقصة", "اكتب اسم المادة.");
  if (!title) return toast("danger", "⚠️ بيانات ناقصة", "اكتب عنوان الاختبار.");
  if (!(duration > 0)) return toast("danger", "⚠️ بيانات ناقصة", "اكتب مدة صحيحة بالدقائق.");
  if (openAt && closeAt && closeAt <= openAt) return toast("danger", "⚠️ مواعيد غير صحيحة", "وقت الإغلاق يجب أن يكون بعد وقت الفتح.");
  if (drawCount && drawCount >= parsed.questions.length) toast("info", "ملاحظة", "عدد الأسئلة لكل طالب ≥ عدد الأسئلة في الملف، سيأخذ كل طالب كل الأسئلة.");
  const b = $("btnPublish"); b.disabled = true; b.textContent = "جارٍ النشر…";
  try {
    const ref = doc(collection(db, "exams")), id = ref.id;
    const questions = parsed.questions.map(q => ({ ...q }));
    const done = {};
    for (const q of questions) {
      if (q.img == null) continue;
      if (!done[q.img]) {
        b.textContent = "جارٍ رفع الصور…";
        const mid = `${id}_m${q.img}`;
        await setDoc(doc(db, "media", mid), { data: await compressImage(parsed.images[q.img]), examId: id, owner: S.me.email });
        done[q.img] = mid;
      }
      q.img = done[q.img];
    }
    const batch = writeBatch(db);
    batch.set(ref, {
      course, title, duration, passMark, openAt, closeAt, drawCount: drawCount >= questions.length ? 0 : drawCount,
      negative: +$("nNeg").value, perQSec: Math.max(0, parseInt($("nPerQ").value, 10) || 0), noBack: $("nNoBack").value === "1",
      shuffle: $("nShuffle").value === "1", shuffleOptions: $("nShuffleOpt").value === "1",
      camera: $("nCam").value === "1", faceAI: $("nCam").value === "1" && $("nFace").value === "1", active: true,
      geoLock: $("nGeo").value === "1", geo: { ...SETTINGS.geoFence, radius: Math.max(50, parseInt($("nRadius").value, 10) || SETTINGS.geoFence.radius) },
      rosterId: $("nRoster").value || "", owner: S.me.email, ownerName: S.me.name, notifyChat: S.me.tgChat || "",
      qCount: questions.length, totalPoints: questions.reduce((s, q) => s + q.points, 0),
      createdAt: serverTimestamp(), createdAtMs: Date.now()
    });
    batch.set(doc(db, "examQuestions", id), { questions, owner: S.me.email });
    batch.set(doc(db, "keys", id), { answers: parsed.key, cancelled: {} });
    S.keys[id] = { answers: parsed.key, cancelled: {} }; S.qs[id] = questions;
    await batch.commit();
    toast("ok", "✅ تم نشر الاختبار", `${title} — اعرض رابط الطلاب أو رمز QR من بطاقة الاختبار.`);
    $("btnCancelUp").click(); $("nTitle").value = ""; $("nOpen").value = ""; $("nClose").value = "";
  } catch (e) { permError(e); toast("danger", "⚠️ فشل النشر", e.message); }
  finally { b.disabled = false; b.textContent = "🚀 حفظ ونشر الاختبار"; }
};

// ======================================================= بطاقات الاختبارات
const studentLink = id => new URL("student.html?exam=" + id, location.href).href;
function windowText(e) {
  const now = Date.now();
  if (e.openAt && now < e.openAt) return `<span class="badge b-exp">⏳ يُفتح ${fmtDateTime(e.openAt)}</span>`;
  if (e.closeAt && now > e.closeAt) return `<span class="badge b-w0">⌛ انتهى موعده</span>`;
  return e.closeAt ? `<span class="badge b-w0">يُغلق ${fmtDateTime(e.closeAt)}</span>` : "";
}
function renderExams() {
  const E = visibleExams();
  $("courseList").innerHTML = [...new Set(E.map(e => e.course))].map(c => `<option value="${esc(c)}">`).join("");
  $("examCards").innerHTML = E.length ? E.map(e => {
    const A = Object.values(S.attempts).filter(a => a.examId === e.id);
    const n = e.drawCount ? `${e.drawCount} من ${e.qCount}` : e.qCount || e.questions.length;
    return `<div class="ecard ${e.active ? "on" : ""}">
      <div class="course">${esc(e.course)}${S.me.isSuper && e.ownerName ? ` <small style="color:var(--muted);font-weight:600">• ${esc(e.ownerName)}</small>` : ""}</div><h4>${esc(e.title)}</h4>
      <div class="row"><span class="chip blue">📝 ${n} سؤال</span><span class="chip blue">⏱️ ${e.duration} د</span><span class="chip blue">✔ ${e.passMark || 50}%</span>${e.camera ? `<span class="chip">📷${e.faceAI ? " 🤖" : ""}</span>` : ""}${e.geoLock ? `<span class="chip">📍 داخل الكلية</span>` : ""}${e.rosterId ? `<span class="chip">👥 ${esc(S.rosters[e.rosterId]?.name || "كشف")}</span>` : ""}${e.negative ? `<span class="chip">➖ سالب</span>` : ""}${e.noBack || e.perQSec ? `<span class="chip">🔒 بلا رجوع</span>` : ""}</div>
      <div class="row"><span class="badge ${e.active ? "b-ok" : "b-w0"}">${e.active ? "● مفتوح للطلاب" : "○ مغلق"}</span>${windowText(e)}<span class="badge b-w0">👥 ${A.length}</span>${A.some(a => a.violationCount) ? `<span class="badge b-w2">⚠️ ${A.filter(a => a.violationCount).length}</span>` : ""}</div>
      <div class="acts">
        <button class="btn ${e.active ? "ghost" : "ok"} sm" data-act="toggle" data-arg="${esc(e.id)}">${e.active ? "⏸ إغلاق" : "▶ فتح"}</button>
        <button class="btn primary sm" data-act="qr" data-arg="${esc(e.id)}">🔗 الرابط و QR</button>
        <div class="dropdown"><button class="btn ghost sm" data-act="dd" data-this="1">⋯ المزيد</button><div class="dd-menu">
          <button data-act="openKey" data-arg="${esc(e.id)}">🔑 مفتاح الإجابة / إلغاء سؤال</button>
          <button data-act="edit" data-arg="${esc(e.id)}">⚙️ تعديل الإعدادات</button>
          <hr><button data-act="report" data-arg="${esc(e.id)}">📊 التقرير</button>
          <button data-act="sheet" data-arg="${esc(e.id)}">🖨️ كشف الدرجات</button>
          <hr><button data-act="del" data-arg="${esc(e.id)}" style="color:var(--danger)">🗑 حذف الاختبار</button>
        </div></div>
      </div></div>`;
  }).join("") : `<div class="panel" style="grid-column:1/-1"><div class="empty"><div class="e-ic">📭</div>لم تنشر أي اختبار بعد — ارفع ملف الأسئلة بالأعلى</div></div>`;
}
window.__dd = btn => { const d = btn.parentElement; const open = !d.classList.contains("open"); document.querySelectorAll(".dropdown.open").forEach(x => x.classList.remove("open")); d.classList.toggle("open", open); };
document.addEventListener("click", e => { if (!e.target.closest(".dropdown")) document.querySelectorAll(".dropdown.open").forEach(x => x.classList.remove("open")); });
window.__toggle = async id => { try { await updateDoc(doc(db, "exams", id), { active: !S.exams[id].active }); } catch (e) { permError(e); } };
window.__report = id => { $("repExam").value = id; document.querySelector('.side [data-tab="reports"]').click(); };
window.__sheet = async id => {
  const e = S.exams[id], roster = e.rosterId ? await getRoster(e.rosterId) : null;
  const R = computeReport(e, S.keys[id] || { answers: {} }, Object.values(S.attempts).filter(a => a.examId === id), { roster });
  printGradeSheet({ exam: e, rows: R.rows, absent: R.absent, owner: e.ownerName || "" });
};

// ---- QR
let qrLib = null;
async function loadQR() {
  if (window.qrcode) return window.qrcode;
  if (!qrLib) qrLib = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.appendChild(s); });
  return qrLib;
}
async function qrSvg(text) { const q = (await loadQR())(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); }
window.__qr = async id => {
  const e = S.exams[id], url = studentLink(id);
  $("modalCard").innerHTML = `<div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">🔗 رابط الطلاب</h3><button class="btn ghost sm" id="mClose">✕</button></div>
    <div class="mb center"><p style="font-weight:700;color:var(--ink)">${esc(e.course)} — ${esc(e.title)}</p><div class="qr-box" id="qrBox"><div class="spinner"></div></div>
    <input class="input" value="${esc(url)}" dir="ltr" readonly data-act="select" data-this="1" style="margin:.8rem 0">
    <div class="toolbar" style="justify-content:center"><button class="btn primary" id="qCopy">📋 نسخ الرابط</button><button class="btn gold" id="qFull">🖥️ عرض على الداتا شو</button></div></div>`;
  $("modal").classList.remove("hidden"); $("mClose").onclick = closeModal;
  $("qCopy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("ok", "✓ تم نسخ الرابط", url); } catch { } };
  try {
    const svg = await qrSvg(url); $("qrBox").innerHTML = svg;
    $("qFull").onclick = () => {
      const f = document.createElement("div"); f.className = "qr-full";
      f.innerHTML = `<h2>📱 امسح الرمز لدخول الاختبار</h2>${svg}<h2 style="font-size:clamp(1.1rem,2.5vw,1.8rem)">${esc(e.course)} — ${esc(e.title)}</h2><p>${esc(url)}</p><small style="color:var(--faint)">اضغط في أي مكان للإغلاق</small>`;
      f.onclick = () => { f.remove(); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); };
      document.body.appendChild(f); closeModal(); document.documentElement.requestFullscreen?.().catch(() => { });
    };
  } catch { $("qrBox").innerHTML = "تعذّر تحميل مولد QR — استخدم الرابط."; }
};

// ---- تعديل الإعدادات
window.__edit = id => {
  const e = S.exams[id];
  const sel = (v, a, b) => `<option value="1" ${v ? "selected" : ""}>${a}</option><option value="0" ${!v ? "selected" : ""}>${b}</option>`;
  $("modalCard").innerHTML = `<div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">⚙️ تعديل إعدادات الاختبار</h3><button class="btn ghost sm" id="mClose">✕</button></div>
    <div class="mb"><div class="grid2">
      <label class="field"><span>اسم المادة</span><input class="input" id="eCourse" value="${esc(e.course)}"></label>
      <label class="field"><span>عنوان الاختبار</span><input class="input" id="eTitle" value="${esc(e.title)}"></label>
      <label class="field"><span>المدة (دقيقة)</span><input class="input" id="eDur" type="number" value="${e.duration}"></label>
      <label class="field"><span>درجة النجاح (%)</span><input class="input" id="ePass" type="number" value="${e.passMark || 50}"></label>
      <label class="field"><span>يُفتح من</span><input class="input" id="eOpen" type="datetime-local" value="${toLocalInput(e.openAt)}"></label>
      <label class="field"><span>يُغلق في</span><input class="input" id="eClose" type="datetime-local" value="${toLocalInput(e.closeAt)}"></label>
      <label class="field"><span>عدد الأسئلة لكل طالب (0 = الكل)</span><input class="input" id="eDraw" type="number" value="${e.drawCount || 0}"></label>
      <label class="field"><span>وقت لكل سؤال (ثانية)</span><input class="input" id="ePerQ" type="number" value="${e.perQSec || 0}"></label>
      <label class="field"><span>الدرجة السالبة</span><select class="input" id="eNeg">${[["0", "لا توجد"], ["0.25", "ربع"], ["0.3333", "ثلث"], ["0.5", "نصف"]].map(([v, t]) => `<option value="${v}" ${Math.abs((e.negative || 0) - v) < 0.001 ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="field"><span>التنقل</span><select class="input" id="eNoBack">${sel(e.noBack, "ممنوع الرجوع", "حر")}</select></label>
      <label class="field"><span>ترتيب الأسئلة</span><select class="input" id="eSh">${sel(e.shuffle, "عشوائي", "ثابت")}</select></label>
      <label class="field"><span>ترتيب الاختيارات</span><select class="input" id="eShO">${sel(e.shuffleOptions, "عشوائي", "ثابت")}</select></label>
      <label class="field"><span>الكاميرا</span><select class="input" id="eCam">${sel(e.camera, "مفعّلة", "بدون")}</select></label>
      <label class="field"><span>كشف الوجه</span><select class="input" id="eFace">${sel(e.faceAI, "مفعّل", "غير مفعّل")}</select></label>
      <label class="field"><span>📍 مكان أداء الاختبار</span><select class="input" id="eGeo">${sel(e.geoLock, "داخل الكلية فقط", "من أي مكان")}</select></label>
      <label class="field"><span>نطاق السماح (متر)</span><input class="input" id="eRadius" type="number" min="50" max="5000" value="${num((e.geo || SETTINGS.geoFence).radius, 300)}"></label>
      <label class="field"><span>خط العرض (Latitude)</span><input class="input" id="eLat" dir="ltr" value="${num((e.geo || SETTINGS.geoFence).lat)}"></label>
      <label class="field"><span>خط الطول (Longitude)</span><input class="input" id="eLng" dir="ltr" value="${num((e.geo || SETTINGS.geoFence).lng)}"></label>
      <div class="field" style="grid-column:1/-1"><button class="btn ghost sm" id="eHere" type="button">📍 اجعل موقعي الحالي هو مركز الكلية</button> <a class="btn ghost sm" id="eMap" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${num((e.geo || SETTINGS.geoFence).lat)},${num((e.geo || SETTINGS.geoFence).lng)}">🗺 عرض على الخريطة</a><small id="eHereMsg" style="color:var(--muted);display:block;margin-top:.4rem">نصيحة: افتح هذه الشاشة وأنت داخل الكلية واضغط الزر لتحديد المركز بدقة.</small></div>
      <label class="field"><span>كشف الطلاب</span><select class="input" id="eRoster">${rosterOptions(e.rosterId)}</select></label>
      <label class="field"><span>الحالة</span><select class="input" id="eAct">${sel(e.active, "مفتوح للطلاب", "مغلق")}</select></label>
    </div><p style="font-size:.82rem;color:var(--muted);margin-bottom:.8rem">تغيير عدد الأسئلة أو الكشف لا يؤثر على الطلاب الذين بدأوا بالفعل.</p><button class="btn gold block" id="eSave">💾 حفظ التعديلات</button></div>`;
  $("modal").classList.remove("hidden"); $("mClose").onclick = closeModal;
  $("eHere").onclick = () => {
    $("eHereMsg").textContent = "جارٍ تحديد موقعك…";
    navigator.geolocation.getCurrentPosition(p => {
      $("eLat").value = p.coords.latitude.toFixed(6); $("eLng").value = p.coords.longitude.toFixed(6);
      $("eMap").href = `https://www.google.com/maps?q=${p.coords.latitude},${p.coords.longitude}`;
      $("eHereMsg").textContent = `✓ تم — دقة التحديد ≈ ${Math.round(p.coords.accuracy)} متر. اضغط «حفظ التعديلات».`;
    }, () => { $("eHereMsg").textContent = "تعذّر تحديد موقعك — اسمح للمتصفح بالوصول للموقع."; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  $("eSave").onclick = async () => {
    try {
      await updateDoc(doc(db, "exams", id), {
        course: $("eCourse").value.trim() || e.course, title: $("eTitle").value.trim() || e.title,
        duration: parseInt($("eDur").value, 10) || e.duration, passMark: parseInt($("ePass").value, 10) || 50,
        openAt: fromLocalInput($("eOpen").value), closeAt: fromLocalInput($("eClose").value),
        drawCount: Math.max(0, parseInt($("eDraw").value, 10) || 0), perQSec: Math.max(0, parseInt($("ePerQ").value, 10) || 0), negative: +$("eNeg").value,
        noBack: $("eNoBack").value === "1", shuffle: $("eSh").value === "1", shuffleOptions: $("eShO").value === "1",
        camera: $("eCam").value === "1", faceAI: $("eCam").value === "1" && $("eFace").value === "1", rosterId: $("eRoster").value || "", active: $("eAct").value === "1",
        geoLock: $("eGeo").value === "1",
        geo: { ...SETTINGS.geoFence, ...(e.geo || {}), radius: Math.max(50, parseInt($("eRadius").value, 10) || 300), lat: Number($("eLat").value) || SETTINGS.geoFence.lat, lng: Number($("eLng").value) || SETTINGS.geoFence.lng }
      });
      closeModal(); toast("ok", "✓ تم الحفظ", e.title);
    } catch (err) { permError(err); }
  };
};

// ---- مفتاح الإجابة + إلغاء سؤال + إعادة التصحيح
window.__openKey = id => {
  const e = S.exams[id], k = S.keys[id] || { answers: {}, cancelled: {} };
  k.cancelled = k.cancelled || {};
  $("modalCard").innerHTML = `<div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">🔑 مفتاح الإجابة — ${esc(e.title)}</h3><button class="btn ghost sm" id="mClose">✕</button></div>
    <div class="mb"><div class="note-box">عدّل الإجابة الصحيحة أو ألغِ السؤال من التصحيح، وسيُعاد حساب درجات <b>كل الطلاب</b> تلقائيًا.</div>
    ${e.questions.map((q, i) => {
      const t = q.type || "mcq", v = k.answers[q.id];
      let body;
      if (t === "mcq" || t === "tf") body = `<div class="key-opts">${q.options.map((o, j) => `<label><input type="radio" name="k_${q.id}" value="${j}" ${v === j ? "checked" : ""}> ${LETTERS[j]}) ${esc(o)}</label>`).join("")}</div>`;
      else if (t === "fill") body = `<input class="input" data-fill="${q.id}" value="${esc((v || []).join(" | "))}" placeholder="الإجابات المقبولة بينها |">`;
      else if (t === "essay") body = `<textarea class="input" data-essay="${q.id}" rows="2" placeholder="الإجابة النموذجية">${esc(v || "")}</textarea>`;
      else body = `<small style="color:var(--muted)">${esc(correctText(q, v))}</small>`;
      return `<div class="key-q ${k.cancelled[q.id] ? "cancelled" : ""}"><div class="kh"><b>${i + 1}. ${esc(q.text)}</b><label style="white-space:nowrap;font-size:.85rem;color:var(--danger)"><input type="checkbox" data-cancel="${q.id}" ${k.cancelled[q.id] ? "checked" : ""}> إلغاء السؤال</label></div>${body}</div>`;
    }).join("")}
    <button class="btn gold block" id="kSave">💾 حفظ وإعادة التصحيح</button></div>`;
  $("modal").classList.remove("hidden"); $("mClose").onclick = closeModal;
  document.querySelectorAll("[data-cancel]").forEach(c => c.onchange = () => c.closest(".key-q").classList.toggle("cancelled", c.checked));
  $("kSave").onclick = async () => {
    const answers = { ...k.answers }, cancelled = {};
    e.questions.forEach(q => {
      const r = document.querySelector(`input[name="k_${q.id}"]:checked`); if (r) answers[q.id] = +r.value;
      const f = document.querySelector(`[data-fill="${q.id}"]`); if (f) { const acc = splitAccepted(f.value); if (acc.length) answers[q.id] = acc; }
      const es = document.querySelector(`[data-essay="${q.id}"]`); if (es) answers[q.id] = es.value.trim();
      if (document.querySelector(`[data-cancel="${q.id}"]`).checked) cancelled[q.id] = true;
    });
    try {
      await setDoc(doc(db, "keys", id), { answers, cancelled });
      S.keys[id] = { answers, cancelled }; closeModal(); renderAll(); if (curTab() === "reports") renderReports();
      toast("ok", "✓ تم تحديث المفتاح", "أُعيد تصحيح جميع الطلاب.");
    } catch (err) { permError(err); }
  };
};

window.__del = async id => {
  const e = S.exams[id]; const A = Object.values(S.attempts).filter(a => a.examId === id);
  if (!confirm(`حذف «${e.title}» نهائيًا${A.length ? ` مع نتائج وأدلة ${A.length} طالب` : ""}؟\nلا يمكن التراجع. (يمكنك بدلًا من ذلك «إغلاق» الاختبار)`)) return;
  try {
    await deleteAttempts(A);
    const refs = [doc(db, "exams", id), doc(db, "keys", id), doc(db, "examQuestions", id)];
    const locks = await getDocs(query(collection(db, "deviceLocks"), where("examId", "==", id))).catch(() => ({ forEach() { } }));
    locks.forEach(l => refs.push(l.ref));
    [...new Set(e.questions.filter(q => q.img != null).map(q => q.img))].forEach(m => refs.push(doc(db, "media", String(m))));
    const b = writeBatch(db); refs.forEach(r => b.delete(r)); await b.commit();
    toast("ok", "✓ تم الحذف", e.title);
  } catch (err) { permError(err); }
};

// ======================================================= كشوف الطلاب
const toLatin = s => String(s ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\s/g, "").replace(/[^\w\-]/g, "");
function rosterOptions(sel) {
  const R = Object.values(S.rosters).filter(r => S.me.isSuper || r.owner === S.me.email).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return `<option value="">بدون كشف — يكتب الطالب اسمه ويختار مجموعته</option>` + R.map(r => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(r.name)} (${r.count} طالب) — دخول برقم الجلوس</option>`).join("");
}
function fillRosterSelect() { const v = $("nRoster").value; $("nRoster").innerHTML = rosterOptions(v); }
$("rsFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false }).map(r => r.map(c => String(c ?? "").trim()));
    const h = rows.findIndex(r => r.some(c => /اسم|الاسم|name/i.test(c)));
    let sC = 0, nC = 1, gC = 2;
    if (h >= 0) {
      const H = rows[h].map(c => normAr(c));
      sC = H.findIndex(c => /جلوس|رقم|seat|id|كود/.test(c)); nC = H.findIndex(c => /اسم|name/.test(c)); gC = H.findIndex(c => /مجموع|فصل|سكشن|group|section/.test(c));
      rows = rows.slice(h + 1);
    }
    if (sC < 0 || nC < 0) throw new Error("لم أجد عمودي «رقم الجلوس» و«اسم الطالب».");
    const seen = new Set(), errs = [], list = [];
    rows.forEach((r, i) => {
      const seat = toLatin(r[sC]), name = (r[nC] || "").replace(/\s+/g, " ").trim(), group = toLatin(gC >= 0 ? r[gC] : "") || "1";
      if (!seat && !name) return;
      if (!seat || !name) return errs.push(`الصف ${i + 2}: رقم الجلوس أو الاسم فارغ.`);
      if (seen.has(seat)) return errs.push(`رقم الجلوس ${seat} مكرر.`);
      seen.add(seat); list.push({ seat, name, group });
    });
    rosterParsed = list;
    if (!$("rsName").value.trim()) $("rsName").value = f.name.replace(/\.[^.]+$/, "");
    $("rsDrop").textContent = "✓ " + f.name;
    const groups = [...new Set(list.map(s => s.group))];
    $("rsPreview").innerHTML = `${errs.length ? `<div class="perr"><b>⚠️ ${errs.length} ملاحظة (سيتم تجاهل هذه الصفوف):</b><ul>${errs.slice(0, 10).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <div class="panel-h" style="padding:0 0 .8rem;border:0"><h3>${list.length} طالب في ${groups.length} مجموعة</h3><div class="toolbar"><button class="btn ghost" id="rsCancel">إلغاء</button><button class="btn gold" id="rsSave">💾 حفظ الكشف</button></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>رقم الجلوس</th><th>الاسم</th><th>المجموعة</th></tr></thead><tbody>${list.slice(0, 8).map(s => `<tr><td>${esc(s.seat)}</td><td class="name">${esc(s.name)}</td><td>${esc(s.group)}</td></tr>`).join("")}${list.length > 8 ? `<tr><td colspan="3" style="color:var(--muted)">… و ${list.length - 8} طالب آخر</td></tr>` : ""}</tbody></table></div>`;
    $("rsPreview").classList.remove("hidden");
    $("rsCancel").onclick = () => { rosterParsed = null; $("rsPreview").classList.add("hidden"); $("rsDrop").textContent = "اسحب ملف الإكسل هنا أو اضغط للاختيار"; };
    $("rsSave").onclick = saveRoster;
  } catch (err) { console.error(err); toast("danger", "⚠️ تعذّرت قراءة الكشف", err.message || String(err), 8000); }
  e.target.value = "";
};
async function saveRoster() {
  const name = $("rsName").value.trim(); if (!name) return toast("danger", "اكتب اسم الكشف", "");
  if (!rosterParsed?.length) return;
  const b0 = $("rsSave"); b0.disabled = true; b0.textContent = "جارٍ الحفظ…";
  try {
    const ref = doc(collection(db, "rosters")), rid = ref.id;
    for (let i = 0; i < rosterParsed.length; i += 400) {
      const b = writeBatch(db);
      rosterParsed.slice(i, i + 400).forEach(s => b.set(doc(db, "students", `${rid}_${s.seat}`), { rosterId: rid, seat: s.seat, name: s.name, group: s.group, owner: S.me.email }));
      await b.commit();
    }
    await setDoc(ref, { name, owner: S.me.email, count: rosterParsed.length, groups: [...new Set(rosterParsed.map(s => s.group))], createdAtMs: Date.now() });
    S.rosterStudents[rid] = rosterParsed.slice();
    toast("ok", "✓ تم حفظ الكشف", `${name} — ${rosterParsed.length} طالب. اختره عند إنشاء الاختبار.`);
    $("rsCancel").click(); $("rsName").value = "";
  } catch (err) { permError(err); b0.disabled = false; b0.textContent = "💾 حفظ الكشف"; }
}
async function getRoster(rid) {
  if (S.rosterStudents[rid]) return S.rosterStudents[rid];
  const q = S.me.isSuper ? query(collection(db, "students"), where("rosterId", "==", rid)) : query(collection(db, "students"), where("rosterId", "==", rid), where("owner", "==", S.me.email));
  try { const s = await getDocs(q); S.rosterStudents[rid] = s.docs.map(d => d.data()); } catch (e) { permError(e); S.rosterStudents[rid] = []; }
  return S.rosterStudents[rid];
}
hooks.getRoster = getRoster;
function renderRosters() {
  const R = Object.values(S.rosters).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  $("rosterCards").innerHTML = R.length ? R.map(r => {
    const used = Object.values(S.exams).filter(e => e.rosterId === r.id);
    return `<div class="ecard on"><div class="course">👥 كشف طلاب</div><h4>${esc(r.name)}</h4>
      <div class="row"><span class="chip blue">🧑‍🎓 ${r.count} طالب</span><span class="chip blue">${(r.groups || []).length} مجموعة</span><span class="chip">📝 ${used.length} اختبار</span></div>
      <div class="acts"><button class="btn primary sm" data-act="viewRoster" data-arg="${esc(r.id)}">👁 عرض الطلاب</button><button class="btn ghost sm" style="color:var(--danger)" data-act="delRoster" data-arg="${esc(r.id)}">🗑 حذف</button></div></div>`;
  }).join("") : `<div class="panel" style="grid-column:1/-1"><div class="empty"><div class="e-ic">📑</div>لا توجد كشوف بعد</div></div>`;
}
window.__viewRoster = async rid => {
  const r = S.rosters[rid], L = (await getRoster(rid)).slice().sort(byName);
  $("modalCard").innerHTML = `<div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">${esc(r.name)} (${L.length})</h3><button class="btn ghost sm" id="mClose">✕</button></div>
    <div class="mb"><input class="input" id="rvSearch" placeholder="🔍 بحث" style="margin-bottom:.8rem"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>م</th><th>رقم الجلوس</th><th>الاسم</th><th>المجموعة</th></tr></thead><tbody id="rvBody"></tbody></table></div></div>`;
  $("modal").classList.remove("hidden"); $("mClose").onclick = closeModal;
  const draw = () => { const q = $("rvSearch").value.trim(); $("rvBody").innerHTML = L.filter(s => !q || s.name.includes(q) || String(s.seat).includes(q)).map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.seat)}</td><td class="name">${esc(s.name)}</td><td>${esc(s.group)}</td></tr>`).join(""); };
  $("rvSearch").oninput = draw; draw();
};
window.__delRoster = async rid => {
  const r = S.rosters[rid], used = Object.values(S.exams).filter(e => e.rosterId === rid);
  if (!confirm(`حذف كشف «${r.name}»؟${used.length ? `\n⚠️ مستخدم في ${used.length} اختبار — لن يستطيع الطلاب الدخول برقم الجلوس لهذه الاختبارات.` : ""}`)) return;
  try {
    const L = await getRoster(rid);
    const refs = L.map(s => doc(db, "students", `${rid}_${s.seat}`)).concat(doc(db, "rosters", rid));
    for (let i = 0; i < refs.length; i += 400) { const b = writeBatch(db); refs.slice(i, i + 400).forEach(x => b.delete(x)); await b.commit(); }
    toast("ok", "✓ تم حذف الكشف", r.name);
  } catch (e) { permError(e); }
};

// ======================================================= النتائج
function fillExamSelects() {
  const E = visibleExams();
  const opts = E.map(e => `<option value="${e.id}">${esc(e.course)} — ${esc(e.title)}</option>`).join("");
  const r = $("rExam"), rv = r.value;
  r.innerHTML = `<option value="">كل الاختبارات</option>` + opts; r.value = S.exams[rv] ? rv : "";
  const p = $("repExam"), pv = p.value;
  p.innerHTML = E.length ? opts : `<option value="">لا توجد اختبارات</option>`; p.value = S.exams[pv] ? pv : (E[0]?.id || "");
  fillRosterSelect();
}
["rExam", "rGroup", "rStatus"].forEach(id => $(id).onchange = renderResults);
$("rSearch").oninput = renderResults;
function updatePending() {
  const n = myAttempts().filter(a => isFinished(a) && (scoreOf(a)?.pending || 0) > 0).length;
  $("pendCnt").textContent = n; $("pendCnt").classList.toggle("hidden", !n);
}
function currentRows() {
  const ex = $("rExam").value, st = $("rStatus").value, q = $("rSearch").value.trim();
  let R = myAttempts().filter(a => !ex || a.examId === ex);
  const groups = [...new Set(R.map(a => String(a.group)))].sort((x, y) => x.localeCompare(y, "ar", { numeric: true }));
  const gs = $("rGroup"), gv = gs.value;
  gs.innerHTML = `<option value="">كل المجموعات</option>` + groups.map(g => `<option value="${esc(g)}">مجموعة ${esc(g)}</option>`).join("");
  gs.value = groups.includes(gv) ? gv : "";
  if (gs.value) R = R.filter(a => String(a.group) === gs.value);
  if (st === "warned") R = R.filter(a => a.violationCount > 0);
  else if (st === "pending") R = R.filter(a => (scoreOf(a)?.pending || 0) > 0);
  else if (st) R = R.filter(a => a.status === st);
  if (q) R = R.filter(a => (a.name || "").includes(q) || String(a.seat || "").includes(q));
  return R.sort(byName);
}
function renderResults() {
  const R = currentRows();
  $("rCount").textContent = `${R.length} طالب`;
  const ex = S.exams[$("rExam").value];
  const pend = ex ? Object.values(S.attempts).filter(a => a.examId === ex.id && isFinished(a) && (scoreOf(a)?.pending || 0) > 0).length : 0;
  $("btnEssays").classList.toggle("hidden", !pend); $("btnEssays").textContent = `✍️ تصحيح المقالي (${pend})`;
  $("rBody").innerHTML = R.length ? R.map((a, i) => {
    const sc = scoreOf(a), gr = sc ? gradeOf(sc.pct, passOf(a), sc.failed) : null;
    return `<tr data-id="${esc(a.id)}">
      <td style="color:var(--faint)">${i + 1}</td><td class="name">${esc(a.name)}${a.seat ? `<br><small style="color:var(--muted);font-weight:500">جلوس ${esc(a.seat)}</small>` : ""}</td><td>${esc(a.group)}</td><td>${esc(a.course)}</td>
      <td>${sc ? `<span class="score">${sc.s} <small>/ ${sc.t}</small></span>${sc.pending ? `<br><small style="color:var(--info)">✍️ ${sc.pending} للتصحيح</small>` : ""}` : "—"}</td>
      <td>${sc ? `<div style="display:flex;align-items:center;gap:.5rem"><div class="bar" style="flex:1"><i style="width:${sc.pct}%;background:${pctColor(sc.pct)}"></i></div><small style="font-weight:700">${sc.pct}%</small></div>` : "—"}</td>
      <td>${gr ? `<b style="color:${gr.color};font-size:.85rem">${gr.label}</b>` : "—"}</td>
      <td>${statusBadge(a)}</td><td>${warnBadge(a.violationCount)}</td>
      <td>${a.location ? `<a href="${mapLink(a)}" target="_blank" rel="noopener" title="${esc(a.location.address || "")}">📍</a>` : `<small style="color:var(--danger)">—</small>`}</td>
      <td><small>${fmtDateTime(a.submittedAtMs)}</small></td>
      <td><button class="btn ghost sm" data-act="detail" data-arg="${esc(a.id)}">ورقة الإجابة</button></td></tr>`;
  }).join("") : `<tr><td colspan="12"><div class="empty"><div class="e-ic">📋</div>لا توجد نتائج مطابقة</div></td></tr>`;
}
$("btnExport").onclick = () => {
  const R = currentRows();
  if (!R.length) return toast("danger", "⚠️ لا توجد بيانات", "لا توجد نتائج لتصديرها.");
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sheet(R.map(resultRow), RES_W), "النتائج");
  const ex = S.exams[$("rExam").value];
  XLSX.writeFile(wb, `نتائج-${safeName(ex ? `${ex.course}-${ex.title}` : "كل-الاختبارات")}-${new Date().toISOString().slice(0, 10)}.xlsx`);
};
// ---- شيت الدرجات لكل المقررات (ورقة لكل مقرر + ورقة مجمّعة) — مرتب أبجديًا
const sheetName = (n, used) => { let b = String(n).replace(/[\[\]:*?/\\]/g, "-").slice(0, 28) || "مقرر", x = b, i = 2; while (used.has(x)) x = b.slice(0, 26) + " " + i++; used.add(x); return x; };
$("btnAllCourses").onclick = async () => {
  const E = visibleExams();
  if (!E.length) return toast("danger", "لا توجد اختبارات", "أنشئ اختبارًا أولًا.");
  const b = $("btnAllCourses"); b.disabled = true; b.textContent = "جارٍ التجهيز…";
  try {
    const byCourse = {};
    E.forEach(e => (byCourse[e.course || "بدون اسم"] = byCourse[e.course || "بدون اسم"] || []).push(e));
    const wb = XLSX.utils.book_new(), used = new Set(), all = [], views = [];
    const today = new Date().toLocaleDateString("ar-EG");
    const ar = (x, y) => (x || "").localeCompare(y || "", "ar", { sensitivity: "base" });
    for (const course of Object.keys(byCourse).sort(ar)) {
      const exs = byCourse[course].sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
      const studs = {};
      const keyOf = a => a.seat ? "s" + a.seat : normalizeName(a.name) + "|" + a.group;
      const totals = {};
      for (const e of exs) {
        if (e.rosterId) (await getRoster(e.rosterId)).forEach(r => { const k = "s" + r.seat; studs[k] = studs[k] || { seat: r.seat, name: r.name, group: String(r.group), sc: {} }; });
        Object.values(S.attempts).filter(a => a.examId === e.id && isFinished(a)).forEach(a => {
          const k = keyOf(a), sc = scoreOf(a); if (!sc) return;
          const g = gradeOf(sc.pct, e.passMark || 50, sc.failed);
          studs[k] = studs[k] || { seat: a.seat || "", name: a.name, group: String(a.group), sc: {} };
          studs[k].sc[e.id] = { s: sc.s, t: sc.t, pct: sc.pct, grade: g.label, failed: sc.failed, pending: sc.pending };
          totals[e.id] = totals[e.id] || sc.t;
          all.push({ "المقرر": course, "رقم الجلوس": a.seat || "", "اسم الطالب": a.name, "المجموعة": a.group, "الاختبار": e.title, "الدرجة": sc.s, "الدرجة العظمى": sc.t, "النسبة %": sc.pct, "التقدير": g.label,
            "ملاحظات": sc.failed ? "راسب بسبب الغش" : sc.pending ? "لم يكتمل تصحيح المقالي" : (a.violationCount ? `محاولات غش: ${num(a.violationCount)}` : "") });
        });
      }
      const list = Object.values(studs).sort((x, y) => ar(x.name, y.name) || String(x.group).localeCompare(String(y.group), "ar", { numeric: true }));
      const head = ["م", "رقم الجلوس", "اسم الطالب", "المجموعة"];
      exs.forEach(e => head.push(`${e.title} (من ${totals[e.id] ?? e.totalPoints ?? ""})`, `تقدير: ${e.title}`));
      const multi = exs.length > 1;
      if (multi) head.push("المجموع", "من", "النسبة %");
      const rows = list.map((st, i) => {
        const r = [i + 1, st.seat, st.name, st.group]; let s = 0, t = 0;
        exs.forEach(e => {
          const x = st.sc[e.id];
          if (!x) { r.push("غائب", "—"); t += totals[e.id] ?? e.totalPoints ?? 0; }
          else { r.push(x.s, x.failed ? "راسب (غش)" : x.grade); s += x.s; t += x.t; }
        });
        if (multi) r.push(Math.round(s * 100) / 100, t, t ? Math.round(s / t * 1000) / 10 : 0);
        return r;
      });
      const aoa = [[`${SETTINGS.platformName} — ${SETTINGS.department || ""}`], [`كشف درجات مقرر: ${course}`], [`عدد الطلاب: ${list.length} • عدد الاختبارات: ${exs.length} • تاريخ الاستخراج: ${today}`], [], head, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!merges"] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: head.length - 1 } }));
      ws["!cols"] = head.map((h, i) => ({ wch: i === 2 ? 30 : i === 0 ? 5 : i === 1 ? 12 : i === 3 ? 9 : Math.max(10, Math.min(28, String(h).length + 2)) }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + rows.length, c: head.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, sheetName(course, used)); views.push({ RTL: true });
    }
    all.sort((x, y) => ar(x["المقرر"], y["المقرر"]) || ar(x["اسم الطالب"], y["اسم الطالب"]) || ar(x["الاختبار"], y["الاختبار"]));
    const wsAll = sheet(all.map((r, i) => ({ "م": i + 1, ...r })), [5, 22, 11, 30, 9, 22, 8, 10, 9, 14, 24]);
    XLSX.utils.book_append_sheet(wb, wsAll, sheetName("كل المقررات", used)); views.push({ RTL: true });
    wb.Workbook = { Views: views };
    XLSX.writeFile(wb, `درجات-كل-المقررات-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast("ok", "✓ تم تجهيز الشيت", `${Object.keys(byCourse).length} مقرر — ورقة لكل مقرر مرتبة أبجديًا + ورقة مجمّعة`);
  } catch (e) { console.error(e); toast("danger", "تعذّر التجهيز", e.message || ""); }
  finally { b.disabled = false; b.textContent = "📚 شيت الدرجات لكل المقررات"; }
};
$("btnResSheet").onclick = () => { const id = $("rExam").value; if (!id) return toast("danger", "اختر اختبارًا", "اختر الاختبار من القائمة أولًا لطباعة كشف درجاته."); window.__sheet(id); };
$("btnEssays").onclick = () => {
  const e = S.exams[$("rExam").value]; if (!e) return;
  const k = S.keys[e.id] || { answers: {} };
  const items = [];
  Object.values(S.attempts).filter(a => a.examId === e.id && isFinished(a) && a.status !== "locked").sort(byName).forEach(a => {
    questionsOf(a, e).filter(q => q.type === "essay" && isAnswered(q, a.answers?.[q.id]) && (a.manual?.[q.id] == null)).forEach(q => items.push({ a, q }));
  });
  $("modalCard").innerHTML = `<div class="mh"><h3 style="font-family:var(--display);color:var(--ink)">✍️ تصحيح الأسئلة المقالية (${items.length})</h3><button class="btn ghost sm" id="mClose">✕</button></div>
    <div class="mb"><div class="ans-sheet">${items.map(({ a, q }) => `<div class="ans-item pend"><div class="aq">${esc(q.text)}</div>
      <div class="aa">الطالب: <b>${esc(a.name)}</b> • مجموعة ${esc(a.group)}<br>الإجابة النموذجية: <b style="color:var(--ok)">${esc(k.answers[q.id] || "—")}</b></div>
      <div class="essay-box">${esc(a.answers[q.id])}</div>
      <div class="grade-in"><span>الدرجة:</span><input class="input" type="number" min="0" max="${q.points || 1}" step="0.5" data-a="${sid(a.id)}" data-q="${q.id}" data-max="${q.points || 1}"><span>من ${q.points || 1}</span><button class="btn ok sm" data-act="saveGrade" data-this="1">حفظ</button></div></div>`).join("") || `<div class="empty">لا توجد إجابات تنتظر التصحيح 🎉</div>`}</div></div>`;
  $("modal").classList.remove("hidden"); $("mClose").onclick = closeModal;
};

// ======================================================= المعلمون
$("btnAddTeacher").onclick = async () => {
  const name = $("tName").value.trim(), email = $("tEmail").value.trim().toLowerCase(), pass = $("tPass").value;
  if (!name || !email) return toast("danger", "بيانات ناقصة", "اكتب الاسم والبريد.");
  if (pass.length < 6) return toast("danger", "كلمة المرور قصيرة", "6 أحرف على الأقل.");
  const b = $("btnAddTeacher"); b.disabled = true; b.textContent = "جارٍ الإضافة…";
  let sec;
  try {
    sec = initializeApp(firebaseConfig, "sec-" + Date.now());
    const sa = getAuth(sec);
    let existed = false;
    try { await createUserWithEmailAndPassword(sa, email, pass); } catch (e) { if (e.code === "auth/email-already-in-use") existed = true; else throw e; }
    await signOut(sa).catch(() => { });
    await setDoc(doc(db, "staff", email), { name, email, role: "teacher", createdAtMs: Date.now() });
    toast("ok", "✓ تمت إضافة المعلم", existed ? `${name} — الحساب موجود مسبقًا ويدخل بكلمة مروره الحالية.` : `${name} — يدخل بالبريد وكلمة المرور التي كتبتها.`, 8000);
    $("tName").value = $("tEmail").value = $("tPass").value = "";
  } catch (e) { console.error(e); toast("danger", "تعذّرت الإضافة", e.code === "auth/invalid-email" ? "البريد غير صحيح." : e.code === "auth/weak-password" ? "كلمة المرور ضعيفة." : (e.message || "")); }
  finally { if (sec) deleteApp(sec).catch(() => { }); b.disabled = false; b.textContent = "إضافة المعلم"; }
};
function renderTeachers() {
  const T = Object.values(S.staff).filter(s => s.role === "teacher").sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
  $("teacherList").innerHTML = T.length ? T.map(t => {
    const n = Object.values(S.exams).filter(e => e.owner === t.id).length;
    return `<div class="rank"><div class="n">🧑‍🏫</div><div class="who"><b>${esc(t.name)}</b><small dir="ltr" style="display:block;text-align:right">${esc(t.id)}</small><small>${n} اختبار${t.tgChat ? " • 📱 تيليجرام مفعّل" : ""}</small></div>
      <button class="btn ghost sm" style="color:var(--danger)" data-act="delTeacher" data-arg="${esc(t.id)}">إيقاف</button></div>`;
  }).join("") : `<div class="empty"><div class="e-ic">🧑‍🏫</div>لم تُضف معلمين بعد</div>`;
}
window.__delTeacher = async id => {
  if (!confirm(`إيقاف صلاحية «${S.staff[id]?.name}»؟ لن يستطيع الدخول للوحة (اختباراته تبقى ظاهرة لك).`)) return;
  try { await deleteDoc(doc(db, "staff", id)); } catch (e) { permError(e); }
};

// ======================================================= الإعدادات
$("btnSaveProfile").onclick = async () => {
  const name = $("sName").value.trim() || S.me.name, tgChat = $("sChat").value.trim();
  try {
    await setDoc(doc(db, "staff", S.me.email), S.me.isSuper ? { name, tgChat, email: S.me.email, role: "super" } : { name, tgChat }, { merge: true });
    Object.assign(S.me, { name, tgChat }); renderMe();
    const mine = Object.values(S.exams).filter(e => e.owner === S.me.email && (e.notifyChat !== tgChat || e.ownerName !== name));
    if (mine.length) { const b = writeBatch(db); mine.forEach(e => b.update(doc(db, "exams", e.id), { notifyChat: tgChat, ownerName: name })); await b.commit(); }
    toast("ok", "✓ تم الحفظ", mine.length ? `وتم تحديث ${mine.length} اختبار.` : "");
  } catch (e) { permError(e); }
};
$("btnTestTg").onclick = () => {
  const chat = $("sChat").value.trim();
  if (!SETTINGS.telegramRelayUrl) return toast("danger", "الرابط غير مضبوط", "اكتب telegramRelayUrl في config.js أولًا.");
  if (!chat) return toast("danger", "اكتب رقم المحادثة", "Chat ID");
  fetch(SETTINGS.telegramRelayUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ chat, text: `✅ رسالة تجريبية من ${SETTINGS.platformName}\nستصلك هنا تنبيهات الغش وطلبات العودة.` }) })
    .then(() => toast("ok", "✓ تم الإرسال", "افتح تيليجرام للتأكد من وصول الرسالة.")).catch(() => toast("danger", "تعذّر الإرسال", "تحقق من الرابط."));
};

// ======================================================= التقارير
window.__openKeyFromReport = id => window.__openKey(id);
initReports();

// ======================================================= رسائل الطلاب
function renderMessages() {
  const all = Object.values(S.msgs).sort((a, b) => num(b.at) - num(a.at));
  const unreadN = all.filter(m => !m.read).length;
  $("msgCnt").textContent = unreadN; $("msgCnt").classList.toggle("hidden", !unreadN);
  if (curTab() !== "messages") return;
  const L = $("mFilter").value === "unread" ? all.filter(m => !m.read) : all;
  $("msgList").innerHTML = L.length ? L.map(m => `<div class="msg-item ${m.read ? "" : "unread"}">
    <div class="msg-h"><b>${esc(m.name)}</b><small>مجموعة ${esc(m.group)}${m.seat ? " • جلوس " + esc(m.seat) : ""} • ${esc(m.course)} — ${esc(m.examTitle)}</small><time>${fmtDateTime(num(m.at))}</time></div>
    <div class="msg-sub">📌 ${esc(m.subject)}${m.phone ? ` • 📞 <span dir="ltr">${esc(m.phone)}</span>` : ""}</div>
    <div class="msg-t">${esc(m.text)}</div>
    <div class="row-acts">${m.read ? "" : `<button class="btn ok sm" data-act="msgRead" data-arg="${sid(m.id)}">✓ تمييز كمقروءة</button>`}<button class="btn ghost sm" style="color:var(--danger)" data-act="msgDel" data-arg="${sid(m.id)}">🗑 حذف</button></div>
  </div>`).join("") : `<div class="empty"><div class="e-ic">📭</div>لا توجد رسائل</div>`;
}
$("mFilter").onchange = renderMessages;
window.__msgRead = async id => { try { await updateDoc(doc(db, "messages", id), { read: true }); } catch (e) { permError(e); } };
window.__msgDel = async id => { if (!confirm("حذف هذه الرسالة؟")) return; try { await deleteDoc(doc(db, "messages", id)); } catch (e) { permError(e); } };
$("btnReadAll").onclick = async () => {
  const U = Object.values(S.msgs).filter(m => !m.read); if (!U.length) return;
  try { for (let i = 0; i < U.length; i += 400) { const b = writeBatch(db); U.slice(i, i + 400).forEach(m => b.update(doc(db, "messages", m.id), { read: true })); await b.commit(); } } catch (e) { permError(e); }
};
