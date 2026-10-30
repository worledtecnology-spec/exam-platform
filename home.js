import { SETTINGS } from "./config.js";
import { frameGuard, brandHtml, wireLogos } from "./common.js";
frameGuard();
// الروابط القديمة index.html?exam=... تتحول تلقائيًا لصفحة الطالب
const q = location.search;
if (/[?&]exam=/.test(q)) location.replace("student.html" + q);
document.getElementById("brandSlot").innerHTML = brandHtml(SETTINGS, "big"); wireLogos();
document.title = SETTINGS.platformName;
