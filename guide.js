// =====================================================================
//  عارض دليل الاستخدام: شاشة فهرس + شاشة مستقلة لكل مكوّن
// =====================================================================
import { esc } from "./common.js";

export function mountGuide(root, sections, title) {
  let cur = -1;
  const render = () => {
    if (cur < 0) {
      root.innerHTML = `<div class="g-index"><h2 class="g-title">📘 ${esc(title)}</h2>
        <p class="g-sub">اختر الجزء الذي تريد شرحه — كل جزء في شاشة مستقلة بخطوات مرقّمة.</p>
        <div class="g-grid">${sections.map((s, i) => `<button class="g-tile" data-i="${i}"><span class="g-ic">${s.icon}</span><b>${esc(s.title)}</b><small>${s.steps.length} خطوات</small></button>`).join("")}</div></div>`;
    } else {
      const s = sections[cur];
      root.innerHTML = `<div class="g-sec">
        <div class="g-top"><button class="btn ghost sm" data-home="1">☰ كل الأقسام</button><span class="g-count">${cur + 1} / ${sections.length}</span></div>
        <h2 class="g-title"><span>${s.icon}</span> ${esc(s.title)}</h2>
        ${s.intro ? `<p class="g-intro">${esc(s.intro)}</p>` : ""}
        <ol class="g-steps">${s.steps.map(([t, d], i) => `<li><span class="g-n">${i + 1}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join("")}</ol>
        <div class="g-nav">
          <button class="btn ghost" data-step="-1" ${cur === 0 ? "disabled" : ""}>→ ${cur > 0 ? esc(sections[cur - 1].title) : "السابق"}</button>
          <button class="btn primary" data-step="1" ${cur === sections.length - 1 ? "disabled" : ""}>${cur < sections.length - 1 ? esc(sections[cur + 1].title) : "التالي"} ←</button>
        </div></div>`;
    }
    root.scrollTop = 0;
  };
  root.onclick = e => {
    const t = e.target.closest("[data-i],[data-home],[data-step]"); if (!t) return;
    if (t.dataset.i != null) cur = +t.dataset.i;
    else if (t.dataset.home) cur = -1;
    else cur = Math.max(0, Math.min(sections.length - 1, cur + +t.dataset.step));
    render();
  };
  render();
}
