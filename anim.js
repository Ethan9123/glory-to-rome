/* ===================================================================
   GTR_ANIM —— 轻量动画引擎（纯 DOM + CSS transition，无依赖）
   用于让卡牌移动“看得见”：飞行位移 + 翻面揭示 + AI 手部指示器，
   营造真人在桌上摸牌、翻牌、出牌的手感。
   =================================================================== */
(function (global) {
  'use strict';

  function rectOf(elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0) return null;
    return r;
  }

  let enabled = true;
  function setEnabled(v) { enabled = v; }
  function isEnabled() { return enabled; }

  // 飞行一张“幽灵卡”从 fromRect 到 toRect。
  // opts: {faceHTML, backHTML, startFaceDown, endFaceDown, duration, land}
  function fly(opts) {
    return new Promise((resolve) => {
      const { fromRect, toRect } = opts;
      if (!enabled || !fromRect || !toRect) { resolve(); return; }
      const dur = opts.duration || 460;
      const ghost = document.createElement('div');
      ghost.className = 'anim-ghost';
      const inner = document.createElement('div');
      inner.className = 'anim-ghost-inner';
      const faceDown = !!opts.startFaceDown;
      inner.innerHTML = faceDown
        ? `<div class="anim-face back">${opts.backHTML || ''}</div><div class="anim-face front">${opts.faceHTML || ''}</div>`
        : `<div class="anim-face front">${opts.faceHTML || ''}</div><div class="anim-face back">${opts.backHTML || ''}</div>`;
      ghost.appendChild(inner);
      ghost.style.left = fromRect.left + 'px';
      ghost.style.top = fromRect.top + 'px';
      ghost.style.width = fromRect.width + 'px';
      ghost.style.height = fromRect.height + 'px';
      if (faceDown) inner.classList.add('is-flipped');
      document.body.appendChild(ghost);
      // 强制回流，确保初始状态生效
      // eslint-disable-next-line no-unused-expressions
      ghost.getBoundingClientRect();

      const needsFlip = !!opts.startFaceDown !== !!opts.endFaceDown;
      const midT = needsFlip ? Math.max(120, dur * 0.42) : 0;

      requestAnimationFrame(() => {
        ghost.style.transition = `left ${dur}ms cubic-bezier(.22,.7,.25,1), top ${dur}ms cubic-bezier(.22,.7,.25,1),
          width ${dur}ms cubic-bezier(.22,.7,.25,1), height ${dur}ms cubic-bezier(.22,.7,.25,1)`;
        ghost.style.left = toRect.left + 'px';
        ghost.style.top = toRect.top + 'px';
        ghost.style.width = toRect.width + 'px';
        ghost.style.height = toRect.height + 'px';
        ghost.classList.add('flying');
        if (needsFlip) {
          setTimeout(() => {
            inner.style.transition = `transform ${Math.max(140, dur - midT)}ms cubic-bezier(.4,0,.2,1)`;
            inner.classList.toggle('is-flipped', !!opts.endFaceDown);
          }, midT);
        }
      });
      setTimeout(() => {
        ghost.classList.add('landed');
        if (opts.land) opts.land(ghost);
        setTimeout(() => { ghost.remove(); resolve(); }, 170);
      }, dur + 20);
    });
  }

  // 便捷封装：从 DOM 元素/选择器飞到另一个，自动读取卡面 html
  function flyBetween(opts) {
    const fromEl = typeof opts.from === 'string' ? document.querySelector(opts.from) : opts.from;
    const toEl = typeof opts.to === 'string' ? document.querySelector(opts.to) : opts.to;
    const fromRect = rectOf(fromEl) || opts.fromRectFallback;
    const toRect = rectOf(toEl) || opts.toRectFallback;
    if (!fromRect || !toRect) return Promise.resolve();
    return fly(Object.assign({}, opts, { fromRect, toRect }));
  }

  // 多张卡：依次错峰起飞，营造“一张张摸牌”的节奏
  function flySequence(items, opts) {
    opts = opts || {};
    const stagger = opts.stagger != null ? opts.stagger : 90;
    return Promise.all(items.map((it, i) => new Promise((res) => {
      setTimeout(() => { flyBetween(Object.assign({}, opts, it)).then(res); }, i * stagger);
    })));
  }

  /* ---------------- AI “手” 指示器：出手前的意图提示 ---------------- */
  let cursorEl = null;
  function ensureCursor() {
    if (cursorEl) return cursorEl;
    cursorEl = document.createElement('div');
    cursorEl.className = 'anim-cursor hidden';
    cursorEl.innerHTML = '<span class="ac-dot"></span>';
    document.body.appendChild(cursorEl);
    return cursorEl;
  }
  function cursorMoveTo(target, opts) {
    return new Promise((resolve) => {
      const rect = rectOf(target);
      const c = ensureCursor();
      if (!enabled || !rect) { c.classList.add('hidden'); resolve(); return; }
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      c.classList.remove('hidden');
      c.style.left = cx + 'px'; c.style.top = cy + 'px';
      c.classList.add('settle');
      const pause = opts && opts.pause != null ? opts.pause : 360;
      setTimeout(resolve, pause);
    });
  }
  function cursorHide() {
    if (cursorEl) cursorEl.classList.add('hidden');
  }

  // 落点脉冲反馈（材料/随从/建筑“到账”时的轻微提示）
  function pulse(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!enabled || !el) return;
    el.classList.remove('anim-pulse'); void el.offsetWidth; el.classList.add('anim-pulse');
    setTimeout(() => el.classList.remove('anim-pulse'), 560);
  }

  global.GTR_ANIM = { rectOf, fly, flyBetween, flySequence, cursorMoveTo, cursorHide, pulse, setEnabled, isEnabled };
})(typeof window !== 'undefined' ? window : globalThis);
