// =====================================================================
//  كشف الوجه بالذكاء الاصطناعي — MediaPipe Face Detector
//  يعمل بالكامل داخل متصفح الطالب، ولا يُرسل أي فيديو لأي خادم.
// =====================================================================
const VER = "0.10.14";
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detector = null, loading = null, lastTs = 0;

export function loadFaceDetector() {
  if (detector) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    const vision = await import(LIB);
    const files = await vision.FilesetResolver.forVisionTasks(WASM);
    const make = delegate => vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", minDetectionConfidence: 0.55
    });
    try { detector = await make("GPU"); } catch { detector = await make("CPU"); }
    return true;
  })().catch(e => { console.warn("face detector unavailable", e); loading = null; return false; });
  return loading;
}
export const faceReady = () => !!detector;

// يرجع: { count, away } — away = الطالب يلتفت بعيدًا عن الشاشة
export function detectFaces(video) {
  if (!detector || !video || !video.videoWidth || video.readyState < 2) return null;
  let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
  let res;
  try { res = detector.detectForVideo(video, ts); } catch (e) { console.warn(e); return null; }
  const dets = (res && res.detections) || [];
  let away = false;
  if (dets.length === 1) {
    const k = dets[0].keypoints || [];
    // نقاط BlazeFace: 0 العين اليمنى، 1 العين اليسرى، 2 طرف الأنف
    if (k.length >= 3) {
      const midX = (k[0].x + k[1].x) / 2, eyeD = Math.abs(k[0].x - k[1].x) || 1e-3;
      const yaw = (k[2].x - midX) / eyeD;
      const pitch = (k[2].y - (k[0].y + k[1].y) / 2) / eyeD;
      away = Math.abs(yaw) > 0.42 || pitch < 0.25 || pitch > 1.45;
    }
  }
  return { count: dets.length, away };
}
