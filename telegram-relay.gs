/**
 * =====================================================================
 *  مُرسِل إشعارات تيليجرام — يُنشر مجانًا على Google Apps Script
 * =====================================================================
 *  1) افتح https://script.google.com ← New project ← امسح الموجود والصق هذا الملف كاملًا
 *  2) اكتب توكن البوت مكان «ضع_توكن_البوت_هنا» (من @BotFather)
 *  3) Deploy ← New deployment ← النوع: Web app
 *        Execute as: Me      |      Who has access: Anyone
 *  4) انسخ رابط الـ Web app والصقه في config.js ← telegramRelayUrl
 *  التوكن يبقى محفوظًا هنا فقط ولا يظهر للطلاب.
 */
const BOT_TOKEN = "ضع_توكن_البوت_هنا";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const chat = String(body.chat || "").trim();
    const text = String(body.text || "").slice(0, 1000);
    if (!chat || !text) return out_("missing");

    // حماية بسيطة من الإغراق: 40 رسالة كحد أقصى لكل محادثة في الدقيقة
    const cache = CacheService.getScriptCache();
    const k = "n_" + chat + "_" + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(k) || 0);
    if (n > 40) return out_("rate");
    cache.put(k, String(n + 1), 120);

    const api = "https://api.telegram.org/bot" + BOT_TOKEN;
    if (body.photo) {
      const blob = Utilities.newBlob(Utilities.base64Decode(body.photo), "image/jpeg", "evidence.jpg");
      UrlFetchApp.fetch(api + "/sendPhoto", { method: "post", payload: { chat_id: chat, caption: text, photo: blob }, muteHttpExceptions: true });
    } else {
      UrlFetchApp.fetch(api + "/sendMessage", { method: "post", payload: { chat_id: chat, text: text }, muteHttpExceptions: true });
    }
    return out_("ok");
  } catch (err) {
    return out_("error: " + err);
  }
}
function doGet() { return out_("relay is running"); }
function out_(s) { return ContentService.createTextOutput(s); }
