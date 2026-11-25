(() => {
  const css = document.createElement("style");
  css.textContent = `
  #nova-tip{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;max-width:280px;
    padding:6px 10px;border-radius:8px;background:rgba(20,20,20,.96);color:#fff;
    font:500 12px/1.3 'Outfit','Segoe UI',sans-serif;letter-spacing:.2px;
    border:1px solid rgba(255,255,255,.12);box-shadow:0 6px 20px rgba(0,0,0,.5);
    opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  #nova-tip.show{opacity:1;transform:none}`;
  document.head.appendChild(css);

  const tip = document.createElement("div");
  tip.id = "nova-tip";
  document.body.appendChild(tip);

  let cur = null,
    timer = null;

  function hide() {
    clearTimeout(timer);
    timer = null;
    cur = null;
    tip.classList.remove("show");
  }

  function place(el) {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.top - t.height - 8;
    if (y < 4) y = r.bottom + 8;
    x = Math.max(4, Math.min(x, window.innerWidth - t.width - 4));
    y = Math.max(4, Math.min(y, window.innerHeight - t.height - 4));
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      const el = e.target.closest && e.target.closest("[title],[data-tip]");
      if (!el) {
        if (cur) hide();
        return;
      }
      if (el.hasAttribute("title")) {
        const t = el.getAttribute("title");
        if (t) el.setAttribute("data-tip", t);
        el.removeAttribute("title");
      }
      const text = el.getAttribute("data-tip");
      if (!text) return;
      if (el === cur) return;
      hide();
      cur = el;
      timer = setTimeout(() => {
        tip.textContent = text;
        tip.style.left = "-9999px";
        tip.classList.add("show");
        place(el);
      }, 350);
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (cur && !cur.contains(e.relatedTarget)) hide();
    },
    true,
  );
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("blur", hide);
})();
