// =====================================================================
//  رصد الكلام بالميكروفون (يعمل على جهاز الطالب فقط — لا يُرسل الصوت إلا كمقطع قصير كدليل)
//  الفكرة: نقيس طاقة الصوت في نطاق الكلام البشري (300–3400 هرتز) ونقارنها بضوضاء المكان
//  المتعلَّمة تلقائيًا. كلام متواصل لعدة ثوانٍ = «حديث بجوار الطالب».
// =====================================================================

export function voiceSupported() {
  return !!(window.AudioContext || window.webkitAudioContext);
}

// opts: { talkSec, onTalk(info), onLevel(level 0..1, speaking) }
export function startVoice(stream, opts = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const track = stream && stream.getAudioTracks()[0];
  if (!AC || !track) return null;
  const ac = new AC();
  const src = ac.createMediaStreamSource(new MediaStream([track]));
  const an = ac.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.3;
  src.connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const hz = ac.sampleRate / an.fftSize;
  const lo = Math.max(1, Math.floor(100 / hz)), hi = Math.min(bins.length - 1, Math.ceil(4000 / hz));
  const lo0 = Math.max(1, Math.floor(60 / hz)), hi0 = Math.min(bins.length - 1, Math.ceil(8000 / hz));
  const talkSec = opts.talkSec || 3;
  const STEP = 100;                       // ms بين كل قياس
  let floor = null;                        // ضوضاء المكان (dB) — تتعلم تلقائيًا
  const hist = [], dbh = [];               // آخر 2 ثانية: هل كان هناك كلام؟ + تذبذب الصوت (المقاطع)
  let talkMs = 0, cooldownUntil = 0, warmUntil = Date.now() + 4000, armed = false;

  const tick = () => {
    if (ac.state === "suspended") ac.resume().catch(() => { });
    an.getFloatFrequencyData(bins);
    let band = 0, all = 0;
    for (let i = lo0; i <= hi0; i++) {
      const p = Math.pow(10, bins[i] / 10);
      all += p; if (i >= lo && i <= hi) band += p;
    }
    const db = 10 * Math.log10(band + 1e-12), ratio = band / (all + 1e-12);
    if (floor === null) floor = db;
    // الضوضاء تُحدَّث ببطء عندما لا يوجد كلام، وبسرعة لو المكان أصبح أهدأ
    const speechNow = db > floor + 12 && ratio > 0.6 && db > -75;
    if (!speechNow) floor = db < floor ? floor * 0.8 + db * 0.2 : floor * 0.985 + db * 0.015;
    hist.push(speechNow ? 1 : 0); if (hist.length > 20) hist.shift();
    dbh.push(db); if (dbh.length > 20) dbh.shift();
    // الكلام = صوت أعلى من ضوضاء المكان + يتذبذب بإيقاع المقاطع (الأصوات الثابتة كالمروحة والتكييف لا تُحسب)
    const swing = dbh.length >= 10 ? Math.max(...dbh) - Math.min(...dbh) : 0;
    const active = hist.length >= 10 && hist.reduce((a, b) => a + b, 0) / hist.length >= 0.4 && swing >= 9;
    const now = Date.now();
    if (now < warmUntil) { talkMs = 0; return; }
    const before = talkMs;
    talkMs = active ? talkMs + STEP : Math.max(0, talkMs - STEP * 2);
    if (!armed && talkMs >= 800 && now > cooldownUntil) { armed = true; opts.onStart && opts.onStart(); }
    if (talkMs === 0) armed = false;
    void before;
    opts.onLevel && opts.onLevel(Math.max(0, Math.min(1, (db - floor) / 30)), active);
    if (talkMs >= talkSec * 1000 && now > cooldownUntil) {
      talkMs = 0; armed = false; cooldownUntil = now + 8000;
      opts.onTalk && opts.onTalk({ at: now, db: Math.round(db - floor) });
    }
  };
  const int = setInterval(tick, STEP);
  return {
    stop() { clearInterval(int); try { src.disconnect(); } catch { } ac.close().catch(() => { }); },
    pause(ms = 4000) { warmUntil = Date.now() + ms; talkMs = 0; }
  };
}

// تسجيل مقطع صوتي قصير كدليل (يعيد data URL أو null)
export function recordClip(stream, ms = 6000, maxBytes = 150000) {
  return new Promise(resolve => {
    const track = stream && stream.getAudioTracks()[0];
    if (!track || typeof MediaRecorder === "undefined") return resolve(null);
    const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
    const type = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
    let rec;
    try { rec = new MediaRecorder(new MediaStream([track]), { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24000 }); }
    catch { return resolve(null); }
    const parts = [];
    rec.ondataavailable = e => e.data && e.data.size && parts.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(parts, { type: rec.mimeType || type || "audio/webm" });
      if (!blob.size || blob.size > maxBytes) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).replace(/^data:audio\/([a-z0-9.+-]+);[^,]*base64,/i, "data:audio/$1;base64,"));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    };
    try { rec.start(); setTimeout(() => { try { rec.stop(); } catch { resolve(null); } }, ms); } catch { resolve(null); }
  });
}
