/* ===================================================================
   Glory to Rome 电子版 —— 界面与交互 (本地热座)
   依赖 cards.js / engine.js
   =================================================================== */
(function () {
  'use strict';
  const CARDS = window.GTR_CARDS, ENGINE = window.GTR_ENGINE;
  const { ROLE_ZH, MATERIAL_LIST, ROLE_LIST, BY_NAME, MATERIALS } = CARDS;
  const isJack = c => c === 'Jack';
  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  let G = null;                 // 引擎实例
  const ui = {
    revealedFor: -1,            // 当前已揭示手牌的玩家
    handoffEnabled: true,       // 是否启用“交接设备”遮罩
    beginner: false,
    sel: [],                    // 带头/跟随时选中的手牌下标
    act: null,                  // 动作阶段子状态
    toast: '',
    coach: true,                // 教学提示条
    tut: 0,                     // 教程当前页
    aiSeats: new Set(),         // 由 AI 控制的座位
    aiBusy: false,              // AI 行动调度锁
    aiNoModel: false            // 模型缺失则回退随机
  };
  const isAI = (pid) => ui.aiSeats.has(pid);

  // 懒加载 AI 模型权重（约 5MB，仅在需要时载入）
  let _aiModelLoading = null;
  function ensureAIModel() {
    if (window.GTR_AI_MODEL) return Promise.resolve(true);
    if (_aiModelLoading) return _aiModelLoading;
    _aiModelLoading = new Promise((res) => {
      const s = document.createElement('script'); s.src = 'ai_model.js';
      s.onload = () => res(true); s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return _aiModelLoading;
  }

  /* ------------------ 启动界面 ------------------ */
  let playerCount = 2;
  let aiCount = 1;
  function initSetup() {
    const cb = $('#playerCountBtns'); cb.innerHTML = '';
    [2, 3, 4, 5].forEach(n => {
      const b = el('button', n === playerCount ? 'active' : '', String(n));
      b.onclick = () => { playerCount = n; if (aiCount > n - 1) aiCount = n - 1; initSetup(); };
      cb.appendChild(b);
    });
    const ab = $('#aiCountBtns'); ab.innerHTML = '';
    for (let k = 0; k <= playerCount - 1; k++) {
      const b = el('button', k === aiCount ? 'active' : '', String(k));
      b.onclick = () => { aiCount = k; initSetup(); };
      ab.appendChild(b);
    }
    const human = playerCount - aiCount;
    $('#aiHint').textContent = aiCount > 0 ? `（${human} 真人 + ${aiCount} 台 AI）` : '（全部真人热座）';
    const ni = $('#nameInputs'); ni.innerHTML = '';
    const defaults = ['玩家一', '玩家二', '玩家三', '玩家四', '玩家五'];
    for (let i = 0; i < human; i++) {
      const inp = el('input'); inp.id = 'pname' + i; inp.value = defaults[i]; inp.maxLength = 10;
      ni.appendChild(inp);
    }
  }
  $('#startBtn').onclick = async () => {
    const human = playerCount - aiCount;
    const names = [];
    for (let i = 0; i < human; i++) names.push(($('#pname' + i).value || ('玩家' + (i + 1))).trim());
    ui.aiSeats = new Set();
    for (let i = human; i < playerCount; i++) { names.push('🤖 AI-' + (i - human + 1)); ui.aiSeats.add(i); }
    ui.beginner = $('#optBeginner').checked;
    if (human <= 1) ui.handoffEnabled = false;   // 仅一个真人时无需交接遮罩
    if (aiCount > 0) {
      const sb = $('#startBtn'); sb.textContent = '正在载入 AI 模型…'; sb.disabled = true;
      const okm = await ensureAIModel();
      sb.textContent = '开始游戏'; sb.disabled = false;
      ui.aiNoModel = !okm;
    }
    G = new ENGINE.Game(names, {});
    if (ui.beginner) G.state.beginner = true;
    ui.revealedFor = -1; ui.sel = []; ui.act = null; ui.aiBusy = false;
    $('#setup').classList.add('hidden');
    $('#game').classList.remove('hidden');
    render();
  };
  $('#tutorialBtn').onclick = () => showTutorial(0);
  initSetup();

  /* ------------------ 顶部按钮 ------------------ */
  $('#refBtn').onclick = showRef;
  $('#logBtn').onclick = showLog;
  $('#menuBtn').onclick = showMenu;

  function showRef() {
    const ov = $('#overlay'); ov.classList.remove('hidden');
    const modal = el('div', 'modal'); modal.style.textAlign = 'center';
    modal.appendChild(el('h2', '', '参考卡 · 角色与流程'));
    if (useCardArt()) {
      const img = el('img', 'refimg'); img.src = 'assets/playermat.png'; img.alt = '参考卡';
      modal.appendChild(img);
    } else {
      modal.appendChild(buildTextReference());
    }
    modal.appendChild(el('div', '', '<br>'));
    modal.appendChild(btn('关闭', 'btn primary', () => ov.classList.add('hidden')));
    ov.innerHTML = ''; ov.appendChild(modal);
  }
  // 原创文字参考（用于不含官方卡面的公开版本）
  function buildTextReference() {
    const wrap = el('div', ''); wrap.style.textAlign = 'left';
    const roleRows = [
      ['Thinker 思考者', '—', '抽牌：补满手牌 / 多抽1张 / 取1个Jack'],
      ['Laborer 劳工', 'Rubble 碎石', '从供应区取材料 → 库存'],
      ['Craftsman 工匠', 'Wood 木材', '用手牌奠基或加料建造'],
      ['Architect 建筑师', 'Concrete 混凝土', '用库存奠基或加料建造'],
      ['Legionary 军团兵', 'Brick 砖块', '向供应区+左右邻居索取材料 → 库存'],
      ['Merchant 商人', 'Stone 石料', '把库存材料卖入金库（计分）'],
      ['Patron 资助人', 'Marble 大理石', '从供应区雇随从（每回合额外动作）']
    ];
    let html = '<table class="scoretable"><tr><th>角色</th><th>材料</th><th>作用</th></tr>';
    roleRows.forEach(r => { html += `<tr><td style="text-align:left">${r[0]}</td><td>${r[1]}</td><td style="text-align:left">${r[2]}</td></tr>`; });
    html += '</table>';
    html += `<p style="color:var(--muted);margin-top:10px;font-size:13px;line-height:1.7">
      <b>回合</b>：带头者「带头」一个角色或「思考」；其余玩家「跟随」或「思考」。然后带头者起、顺时针，每人按
      <i>带头/跟随 + 同角色随从数</i> 执行动作。<br>
      <b>建造</b>：奠基(出地基牌+取对应Site) → 放入1~3个同色材料 → 完成后影响力+价值并获得功能。<br>
      <b>影响力</b>同时限制随从与金库上限，并计为分数。<br>
      <b>结束</b>：牌库抽空 / 城内Site用尽 / Catacomb完成 / Forum集齐每种随从 / 投降。<br>
      <b>计分</b>：影响力 + 金库材料价值 + 商人奖励(各材料最多+3) + 建筑分(Statue+3、Wall每2材料+1)。</p>`;
    wrap.innerHTML = html;
    return wrap;
  }

  /* ================== 渲染入口 ================== */
  function render() {
    if (!G) return;
    const s = G.state;
    // 顶栏
    $('#turnInfo').textContent = `第 ${s.turnNo} 回合`;
    $('#deckCount').textContent = s.deck.length;
    $('#jackCount').textContent = s.jackPile;
    $('#phaseBanner').textContent = phaseText();
    renderSites();
    renderPool();
    renderPlayers();
    renderControl();
    renderHand();
    renderCoach();
    // 结束
    if (s.over) { showGameOver(); }
    // 交接遮罩
    maybeHandoff();
    // AI 行动调度
    scheduleAI();
  }

  /* ------------------ AI 自动行动 ------------------ */
  function scheduleAI() {
    if (!G || G.state.over) return;
    const owner = decisionOwner();
    if (owner < 0 || !isAI(owner)) return;
    if (ui.aiBusy) return;
    ui.aiBusy = true;
    setTimeout(aiTick, 460);
  }
  function aiTick() {
    ui.aiBusy = false;
    if (!G || G.state.over) { render(); return; }
    const owner = decisionOwner();
    if (owner < 0 || !isAI(owner)) { render(); return; }
    try {
      if (!(window.GTR_AI && GTR_AI.available() && !ui.aiNoModel && GTR_AI.act(G))) {
        // 无模型时回退随机
        GTR_AI.resolvePending(G);
        const mvs = GTR_AI.legalMoves(G);
        if (mvs.length) GTR_AI.applyMove(G, mvs[Math.floor(Math.random() * mvs.length)]);
      }
    } catch (e) { console.error('AI error', e); }
    render();
  }

  function phaseText() {
    const s = G.state;
    if (s.over) return '游戏结束';
    if (s.pending) {
      if (s.pending.type === 'thinker') return '思考结算';
      if (s.pending.type === 'prison') return 'Prison 夺取';
      if (s.pending.type === 'fountain') return 'Fountain 选择';
      if (s.pending.type === 'patronBonus') return '资助人附加随从';
      if (s.pending.type === 'basilicaBonus') return 'Basilica 附加';
    }
    if (s.phase === 'lead') return '带头阶段';
    if (s.phase === 'follow') return '跟随阶段';
    if (s.phase === 'actions') return '动作阶段 · ' + ROLE_ZH[s.ledRole];
    return '';
  }

  function decisionOwner() {
    const s = G.state;
    if (s.over) return -1;
    if (s.pending) return s.pending.pid;
    if (s.phase === 'lead') return s.leaderIndex;
    if (s.phase === 'follow' || s.phase === 'actions') return s.current;
    return -1;
  }

  /* ------------------ 场地条 ------------------ */
  function renderSites() {
    const bar = $('#sitesBar'); bar.innerHTML = '';
    bar.appendChild(el('span', '', '<b style="color:var(--muted);font-size:12px">场地 Sites：</b>'));
    MATERIAL_LIST.forEach(m => {
      const info = MATERIALS[m], st = G.state.sites[m];
      const chip = el('div', 'site-chip');
      chip.style.borderColor = info.color;
      chip.innerHTML = `<span class="sname" style="color:${info.color}">${m}</span>
        <span class="scount">城内 ${st.inTown} · 城外 ${st.out}</span>
        <span class="sval">${info.zh} · 价值${info.value}</span>`;
      bar.appendChild(chip);
    });
  }

  /* ------------------ 供应区 ------------------ */
  function renderPool() {
    const pool = $('#pool'); pool.innerHTML = '';
    $('#poolCount').textContent = G.state.pool.length;
    const owner = decisionOwner();
    const labMode = G.state.phase === 'actions' && !G.state.pending && G.currentRole() === 'Laborer';
    const patMode = G.state.phase === 'actions' && !G.state.pending && G.currentRole() === 'Patron';
    const archMode = ui.act && ui.act.role === 'Architect' && ui.act.step === 'fillSource' && G.hasPower(owner, 'archway');
    const stairMode = ui.act && ui.act.mode === 'stairwaySource' && ui.act.source === 'pool';
    G.state.pool.forEach((c, i) => {
      const card = renderCard(c, { zone: 'pool', index: i });
      if (labMode || patMode || archMode || stairMode) card.classList.add('selectable');
      pool.appendChild(card);
    });
    if (!G.state.pool.length) pool.appendChild(el('span', '', '<span style="color:var(--muted);font-size:12px">（空）</span>'));
  }

  /* ------------------ 玩家区 ------------------ */
  function renderPlayers() {
    const zone = $('#playersZone'); zone.innerHTML = '';
    const s = G.state, owner = decisionOwner();
    s.players.forEach(p => {
      const camp = el('div', 'camp');
      if (p.id === owner) camp.classList.add('active');
      if (p.id === s.leaderIndex) camp.classList.add('leader');
      // 头部
      const head = el('div', 'camp-head');
      head.innerHTML = `<span class="camp-name">${p.name}</span>
        <span class="camp-infl">影响力 <b>${p.influence}</b> · 随从 ${p.clientele.length}/${G.clienteleLimit(p.id)} · 金库 ${p.vault.length}/${G.vaultLimit(p.id)} · 手牌 ${p.hand.length}</span>`;
      camp.appendChild(head);

      // 完成的建筑
      const cz = el('div', 'subzone');
      cz.appendChild(el('div', 'sz-label', `已完成建筑 (${p.completed.length})`));
      const cr = el('div', 'structrow');
      p.completed.forEach((st, i) => cr.appendChild(renderStruct(st, { owner: p.id, index: i, completed: true })));
      if (!p.completed.length) cr.appendChild(hintSpan('—'));
      cz.appendChild(cr); camp.appendChild(cz);

      // 在建
      const iz = el('div', 'subzone');
      iz.appendChild(el('div', 'sz-label', `在建 (${p.inProgress.length})`));
      const ir = el('div', 'structrow');
      p.inProgress.forEach((st) => ir.appendChild(renderStruct(st, { owner: p.id, inprog: true })));
      if (!p.inProgress.length) ir.appendChild(hintSpan('—'));
      iz.appendChild(ir); camp.appendChild(iz);

      // 随从
      const clz = el('div', 'subzone');
      clz.appendChild(el('div', 'sz-label', `随从 Clientele (${p.clientele.length})`));
      const clr = el('div', 'structrow');
      p.clientele.forEach((cl, i) => {
        const m = matForRole(cl.role);
        const chip = el('div', 'struct');
        chip.style.background = MATERIALS[m] ? MATERIALS[m].color : '#777';
        chip.style.color = '#fff';
        chip.innerHTML = `${ROLE_ZH[cl.role]}<span class="prog"> ${cl.fresh ? '·新' : ''}</span>`;
        chip.title = `${cl.name} (${cl.role})`;
        // Coliseum 抓取目标
        if (ui.act && ui.act.mode === 'coliseum' && p.id !== owner) {
          chip.classList.add('selectable');
          chip.dataset.z = 'client'; chip.dataset.o = p.id; chip.dataset.i = i;
        }
        clr.appendChild(chip);
      });
      if (!p.clientele.length) clr.appendChild(hintSpan('—'));
      clz.appendChild(clr); camp.appendChild(clz);

      // 库存 + 金库
      const mz = el('div', 'subzone');
      mz.appendChild(el('div', 'sz-label', `库存 Stockpile (${p.stockpile.length}) · 金库 Vault (${p.vault.length})`));
      const mr = el('div', 'structrow');
      // 库存按材料分组成 chip
      const stockSel = ui.act && (ui.act.mode === 'merchantPick' || ui.act.mode === 'archFill' || ui.act.mode === 'stairwaySource') && p.id === owner;
      const byMat = {};
      p.stockpile.forEach((c, i) => { const m = BY_NAME[c].material; (byMat[m] = byMat[m] || []).push(i); });
      MATERIAL_LIST.forEach(m => {
        if (!byMat[m]) return;
        const chip = el('div', 'struct');
        chip.style.background = MATERIALS[m].color; chip.style.color = '#fff';
        chip.innerHTML = `${MATERIALS[m].zh}<span class="prog"> ×${byMat[m].length}</span>`;
        chip.title = `${m} ×${byMat[m].length}`;
        if (stockSel) { chip.classList.add('selectable'); chip.dataset.z = 'stock'; chip.dataset.o = p.id; chip.dataset.m = m; chip.dataset.i = byMat[m][0]; }
        mr.appendChild(chip);
      });
      if (!p.stockpile.length) mr.appendChild(hintSpan('库存空'));
      // 金库（背面）
      const vchip = el('div', 'struct'); vchip.style.background = '#3a2f22'; vchip.style.color = 'var(--gold)';
      vchip.innerHTML = `金库 ×${p.vault.length}`; vchip.title = '金库内容对所有人隐藏';
      mr.appendChild(vchip);
      mz.appendChild(mr); camp.appendChild(mz);

      zone.appendChild(camp);
    });
  }

  function hintSpan(t) { return el('span', '', `<span style="color:var(--muted);font-size:11px">${t}</span>`); }
  function matForRole(role) { return MATERIAL_LIST.find(m => MATERIALS[m].role === role); }

  function renderStruct(st, o) {
    const chip = el('div', 'struct' + (o.completed ? ' done' : ''));
    const info = MATERIALS[st.material] || { color: '#777' };
    chip.style.background = info.color;
    chip.style.color = info.text || '#fff';
    let label = st.name;
    if (o.inprog) label += `<span class="prog"> ${st.materials.length}/${st.value}${st.outOfTown ? ' 城外' : ''}</span>`;
    else label += `<span class="prog"> ▣${st.value}</span>`;
    chip.innerHTML = label;
    if (st.public) chip.classList.add('pub');
    chip.title = `${st.name} · ${st.material} 价值${st.value}\n${BY_NAME[st.name] ? BY_NAME[st.name].zh : ''}`;
    // 选择：在建(加料目标) / 已完成(Prison/Stairway目标)
    if (o.inprog && ui.act && ui.act.mode === 'fillTarget' && o.owner === decisionOwner()) {
      chip.classList.add('selectable'); chip.dataset.z = 'inprog'; chip.dataset.o = o.owner; chip.dataset.sid = st.id;
    }
    if (o.completed && ui.act && ui.act.mode === 'prisonTarget' && o.owner !== decisionOwner()) {
      chip.classList.add('selectable'); chip.dataset.z = 'completed'; chip.dataset.o = o.owner; chip.dataset.i = o.index;
    }
    if (o.completed && ui.act && ui.act.mode === 'stairwayTarget' && o.owner !== decisionOwner()) {
      chip.classList.add('selectable'); chip.dataset.z = 'completed'; chip.dataset.o = o.owner; chip.dataset.i = o.index;
    }
    return chip;
  }

  /* ------------------ 卡牌渲染（真实卡面图片 + 降级样式） ------------------ */
  const cardImgPath = (c) => 'assets/cards/' + (isJack(c) ? 'Jack' : String(c).replace(/ /g, '_')) + '.jpg';

  function styledCardHTML(card, c) {
    if (isJack(c)) {
      card.classList.add('jack');
      card.innerHTML = `<div class="chead">JACK</div><div class="crole">百搭 · 任意角色</div>
        <div class="cfoot"><span>Wild</span><span>♦</span></div>`;
    } else {
      const b = BY_NAME[c], info = MATERIALS[b.material];
      card.innerHTML =
        `<div class="chead" style="background:${info.color};color:${info.text}">${c}<span>▣${b.value}</span></div>
         <div class="crole" style="background:${shade(info.color)};color:#fff">${ROLE_ZH[b.role]} · ${b.role}</div>
         <div class="cfoot"><span>${info.zh}</span><span>${b.material}</span></div>`;
    }
  }

  const useCardArt = () => !(window.GTR_CONFIG && window.GTR_CONFIG.cardArt === false);

  function renderCard(c, opts) {
    opts = opts || {};
    const art = useCardArt();
    const card = el('div', 'card' + (art ? ' img' : '') + (opts.mini ? ' mini' : ''));
    let border, tip;
    if (isJack(c)) { border = '#caa23f'; tip = 'Jack：可带头或跟随任意角色（不能思考者）。'; }
    else {
      const b = BY_NAME[c], info = MATERIALS[b.material]; border = info.color;
      tip = `${c}\n角色：${ROLE_ZH[b.role]} (${b.role})  材料：${info.zh} ${b.material} 价值${b.value}\n功能：${b.zh}`;
    }
    if (art) {
      card.style.borderColor = border;
      const img = el('img'); img.src = cardImgPath(c); img.alt = c; img.draggable = false;
      img.onerror = function () { // 图片缺失时降级为纯样式卡
        card.classList.remove('img'); card.style.borderColor = '';
        if (img.parentNode) card.removeChild(img); styledCardHTML(card, c);
      };
      card.appendChild(img);
    } else {
      styledCardHTML(card, c);
    }
    card.title = tip;
    if (opts.zone != null) { card.dataset.z = opts.zone; card.dataset.i = opts.index; if (opts.owner != null) card.dataset.o = opts.owner; }
    if (opts.selectable) card.classList.add('selectable');
    if (opts.selected) card.classList.add('selected');
    return card;
  }
  function shade(hex) { // 角色行用更深的色
    try { const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
      r = (r * .55) | 0; g = (g * .55) | 0; b = (b * .55) | 0; return `rgb(${r},${g},${b})`; } catch (e) { return '#0006'; }
  }

  /* ------------------ 手牌 ------------------ */
  function renderHand() {
    const owner = decisionOwner();
    const hand = $('#hand'); hand.innerHTML = '';
    if (owner < 0) { $('#handOwner').textContent = ''; return; }
    const p = G.P(owner);
    $('#handOwner').textContent = `（${p.name}）`;
    if (isAI(owner)) { // AI 手牌隐藏（仅显示牌背数量）
      for (let i = 0; i < p.hand.length; i++) hand.appendChild(el('div', 'card facedown', '&nbsp;'));
      if (!p.hand.length) hand.appendChild(hintSpan('（无手牌）'));
      return;
    }
    const s = G.state;
    // 何时手牌可选
    let selectable = false, selectHandler = null;
    if (!s.pending && s.phase === 'lead') { selectable = true; }
    else if (!s.pending && s.phase === 'follow') { selectable = true; }
    else if (!s.pending && s.phase === 'actions') {
      const r = G.currentRole();
      if (r === 'Craftsman' && ui.act && ui.act.mode === 'foundCard') selectable = true;
      if (r === 'Craftsman' && ui.act && ui.act.mode === 'fillSource') selectable = true;
      if (r === 'Architect' && ui.act && ui.act.mode === 'foundCard') selectable = true;
      if (r === 'Patron' && ui.act && ui.act.mode === 'patronHand') selectable = true;
      if (r === 'Merchant' && ui.act && ui.act.mode === 'merchHand') selectable = true;
      if (r === 'Laborer' && ui.act && ui.act.dockHand) selectable = true;
    } else if (s.pending && s.pending.type === 'thinker' && ui.act && ui.act.mode === 'latrine') selectable = true;
    else if (s.pending && s.pending.type === 'patronBonus' && ui.act && ui.act.mode === 'aqBonus') selectable = true;
    else if (s.pending && s.pending.type === 'basilicaBonus') selectable = true;

    p.hand.forEach((c, i) => {
      const isSel = ui.sel.includes(i);
      const card = renderCard(c, { zone: 'hand', index: i, owner });
      if (selectable) card.classList.add('selectable');
      if (isSel) card.classList.add('selected');
      hand.appendChild(card);
    });
    if (!p.hand.length) hand.appendChild(hintSpan('（无手牌）'));
  }

  /* ================== 中央点击分发 ================== */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-z]');
    if (!t || !G) return;
    const zone = t.dataset.z, idx = +t.dataset.i, owner = t.dataset.o != null ? +t.dataset.o : null, mat = t.dataset.m, sid = t.dataset.sid != null ? +t.dataset.sid : null;
    onCardClick(zone, idx, owner, mat, sid);
  });

  function onCardClick(zone, idx, owner, mat, sid) {
    const s = G.state;
    // 带头/跟随：手牌多选
    if (!s.pending && (s.phase === 'lead' || s.phase === 'follow') && zone === 'hand') {
      toggleSel(idx); return;
    }
    if (s.pending && s.pending.type === 'thinker' && ui.act && ui.act.mode === 'latrine' && zone === 'hand') {
      G.resolveThinker({ discard: idx, choice: ui.act.choice }); afterEngine(); return;
    }
    if (s.pending && s.pending.type === 'patronBonus' && ui.act && ui.act.mode === 'aqBonus' && zone === 'hand') {
      do_(G.resolvePatronBonus({ take: 'aqueduct', index: idx })); return;
    }
    if (s.pending && s.pending.type === 'basilicaBonus' && zone === 'hand') {
      do_(G.resolveBasilicaBonus({ take: true, index: idx })); return;
    }
    if (s.phase !== 'actions' || s.pending) { handlePendingClicks(zone, idx, owner, mat, sid); return; }

    const role = G.currentRole();
    // —— 劳工 ——
    if (role === 'Laborer') {
      if (zone === 'pool') { ui.act = ui.act || {}; ui.act.poolIndex = idx; refreshAct(); }
      else if (zone === 'hand' && ui.act && ui.act.dockHand) { ui.act.handIndex = idx; refreshAct(); }
      return;
    }
    // —— 资助人 ——
    if (role === 'Patron') {
      if (zone === 'pool') { do_(G.doPatron({ index: idx })); }
      else if (zone === 'hand' && ui.act && ui.act.mode === 'patronHand') { do_(G.doPatron({ source: 'hand', index: idx })); }
      return;
    }
    // —— 商人 ——
    if (role === 'Merchant') {
      if (zone === 'stock') { do_(G.doMerchant({ index: idx })); }
      else if (zone === 'hand' && ui.act && ui.act.mode === 'merchHand') { do_(G.doMerchant({ source: 'hand', index: idx })); }
      return;
    }
    // —— 建造（工匠/建筑师）——
    if (role === 'Craftsman' || role === 'Architect') {
      handleBuildClick(role, zone, idx, owner, mat, sid); return;
    }
  }

  function handlePendingClicks(zone, idx, owner, mat, sid) {
    // Prison / Stairway / Coliseum 目标点击
    if (ui.act && ui.act.mode === 'prisonTarget' && zone === 'completed') {
      do_(G.resolvePrison({ targetPid: owner, structIndex: idx })); return;
    }
    if (ui.act && ui.act.mode === 'stairwayTarget' && zone === 'completed') {
      ui.act.targetPid = owner; ui.act.structIndex = idx; ui.act.mode = 'stairwaySource';
      ui.act.source = G.P(decisionOwner()).stockpile.length ? 'stockpile' : 'pool';
      ui.toast = '选择库存(或Archway供应区)中与该建筑同材料的材料'; refreshAct(); return;
    }
    if (ui.act && ui.act.mode === 'stairwaySource' && (zone === 'stock' || zone === 'pool')) {
      do_(G.doStairway({ targetPid: ui.act.targetPid, structIndex: ui.act.structIndex, source: zone === 'pool' ? 'pool' : 'stockpile', index: idx })); return;
    }
    if (ui.act && ui.act.mode === 'coliseum' && zone === 'client') {
      ui.act.coliseum = ui.act.coliseum || []; ui.act.coliseum.push({ pid: owner, clientIndex: idx });
      ui.toast = '已标记抓取目标，可继续标记或点“确定军团兵”'; refreshAct(); return;
    }
  }

  function handleBuildClick(role, zone, idx, owner, mat, sid) {
    ui.act = ui.act || {};
    // 奠基：选手牌
    if (ui.act.mode === 'foundCard' && zone === 'hand') {
      const c = G.P(decisionOwner()).hand[idx];
      if (isJack(c)) { toast('Jack 不能作为地基'); return; }
      ui.act.foundIndex = idx;
      if (BY_NAME[c].power === 'statue') { ui.act.mode = 'statueSite'; toast('Statue：选择放置的 Site 材料'); refreshAct(); }
      else { ui.act.mode = 'foundConfirm'; refreshAct(); }
      return;
    }
    // 加料：选在建建筑
    if (ui.act.mode === 'fillTarget' && zone === 'inprog') {
      ui.act.structureId = sid; ui.act.mode = 'fillSource';
      toast(role === 'Craftsman' ? '选择手牌材料放入' : '选择库存材料放入（Archway 可点供应区）');
      refreshAct(); return;
    }
    // 加料来源
    if (ui.act.mode === 'fillSource') {
      if (role === 'Craftsman' && zone === 'hand') { do_(G.addMaterial('Craftsman', { index: idx, structureId: ui.act.structureId })); return; }
      if (role === 'Architect' && zone === 'stock') { do_(G.addMaterial('Architect', { index: idx, structureId: ui.act.structureId, source: 'stockpile' })); return; }
      if (role === 'Architect' && zone === 'pool') { do_(G.addMaterial('Architect', { index: idx, structureId: ui.act.structureId, source: 'pool' })); return; }
    }
  }

  function toggleSel(i) {
    const k = ui.sel.indexOf(i);
    if (k >= 0) ui.sel.splice(k, 1); else ui.sel.push(i);
    renderHand(); renderControl();
  }

  /* ================== 控制区 ================== */
  function renderControl() {
    const s = G.state, bar = $('#actionbar'), prompt = $('#prompt');
    bar.innerHTML = ''; prompt.innerHTML = '';
    if (s.over) { prompt.innerHTML = '<span class="em">游戏结束</span>'; return; }
    const _owner = decisionOwner();
    if (_owner >= 0 && isAI(_owner)) { prompt.innerHTML = `<span class="em">🤖 ${G.P(_owner).name} 行动中…</span>`; return; }
    if (ui.toast) { prompt.innerHTML = `<span class="em">${ui.toast}</span>`; ui.toast = ''; }

    if (s.pending) {
      if (s.pending.type === 'thinker') return renderThinker();
      if (s.pending.type === 'prison') return renderPrison();
      if (s.pending.type === 'fountain') return renderFountain();
      if (s.pending.type === 'patronBonus') return renderPatronBonus();
      if (s.pending.type === 'basilicaBonus') return renderBasilicaBonus();
    }
    if (s.phase === 'lead') return renderLead();
    if (s.phase === 'follow') return renderFollow();
    if (s.phase === 'actions') return renderActions();
  }

  function btn(label, cls, fn) { const b = el('button', cls || ''); b.textContent = label; b.onclick = fn; return b; }

  /* ---- 带头 ---- */
  function renderLead() {
    const s = G.state, lead = s.leaderIndex, bar = $('#actionbar');
    setPrompt(`轮到 <span class="em">${G.P(lead).name}</span>：选择手牌<b>带头</b>一个角色，或<b>思考</b>抽牌。`);
    bar.appendChild(btn('思考（抽牌，结束回合）', 'btn', () => { ui.act = { mode: 'leadThink' }; do_(G.leaderThink()); }));
    const opts = leadOptions(lead, ui.sel);
    opts.forEach(o => bar.appendChild(btn(o.label, 'btn primary', () => doLead(o))));
    if (ui.sel.length) bar.appendChild(btn('清除选择', 'btn ghost', () => { ui.sel = []; renderHand(); renderControl(); }));
    if (!ui.sel.length) bar.appendChild(hintBtn('↑ 点击手牌选择要打出的牌'));
  }
  function leadOptions(pid, sel) {
    const hand = G.P(pid).hand, cards = sel.map(i => hand[i]); const opts = [];
    if (!cards.length) return opts;
    const jacks = cards.filter(isJack).length, normals = cards.filter(c => !isJack(c));
    const roles = new Set(normals.map(c => BY_NAME[c].role));
    if (cards.length === 1) {
      if (isJack(cards[0])) opts.push({ kind: 'jack', needRole: true, label: '带头 Jack →选角色' });
      else opts.push({ kind: 'card', role: BY_NAME[cards[0]].role, label: `带头【${ROLE_ZH[BY_NAME[cards[0]].role]}】` });
    }
    if (cards.length === 2 && jacks === 0 && roles.size === 1) {
      opts.push({ kind: 'petition', needRole: true, label: '请愿(2张)→选角色' });
      if (G.hasPower(pid, 'circus')) opts.push({ kind: 'circus', needRole: true, label: 'Circus(2张)→选角色' });
    }
    if (G.hasPower(pid, 'palace') && cards.length >= 1 && roles.size <= 1) {
      const role = normals.length ? BY_NAME[normals[0]].role : null;
      opts.push({ kind: 'palace', role, needRole: role == null, label: `Palace ×${cards.length}` + (role ? `【${ROLE_ZH[role]}】` : '→选角色') });
    }
    return opts;
  }
  function doLead(o) {
    const finish = (role) => {
      let sel;
      if (o.kind === 'card') sel = { kind: 'card', index: ui.sel[0] };
      else if (o.kind === 'jack') sel = { kind: 'jack', index: ui.sel[0], role };
      else sel = { kind: o.kind, indices: ui.sel.slice(), role };
      const r = G.leaderLead(sel);
      if (!r.ok) { toast(r.error); return; }
      ui.sel = []; ui.act = null; afterEngine();
    };
    if (o.needRole) pickRole(finish); else finish(o.role);
  }

  /* ---- 跟随 ---- */
  function renderFollow() {
    const s = G.state, pid = s.current, bar = $('#actionbar');
    setPrompt(`<span class="em">${G.P(pid).name}</span>：跟随【${ROLE_ZH[s.ledRole]}】，或思考。`);
    bar.appendChild(btn('思考（抽牌）', 'btn', () => { do_(G.followThink()); }));
    const opts = followOptions(pid, ui.sel, s.ledRole);
    opts.forEach(o => bar.appendChild(btn(o.label, 'btn primary', () => doFollow(o))));
    if (ui.sel.length) bar.appendChild(btn('清除选择', 'btn ghost', () => { ui.sel = []; renderHand(); renderControl(); }));
    if (!ui.sel.length) bar.appendChild(hintBtn('↑ 点击手牌选择跟随用的牌（须与带头角色一致）'));
  }
  function followOptions(pid, sel, ledRole) {
    const hand = G.P(pid).hand, cards = sel.map(i => hand[i]); const opts = [];
    if (!cards.length) return opts;
    const jacks = cards.filter(isJack).length, normals = cards.filter(c => !isJack(c));
    const roles = new Set(normals.map(c => BY_NAME[c].role));
    if (cards.length === 1) {
      if (isJack(cards[0])) opts.push({ kind: 'jack', label: `用 Jack 跟随【${ROLE_ZH[ledRole]}】` });
      else if (BY_NAME[cards[0]].role === ledRole) opts.push({ kind: 'card', label: `跟随【${ROLE_ZH[ledRole]}】` });
    }
    if (cards.length === 2 && jacks === 0 && roles.size === 1 && [...roles][0] !== ledRole) {
      opts.push({ kind: 'petition', label: `请愿(2张)→跟随【${ROLE_ZH[ledRole]}】` });
      if (G.hasPower(pid, 'circus')) opts.push({ kind: 'circus', label: `Circus(2张)→【${ROLE_ZH[ledRole]}】` });
    }
    if (G.hasPower(pid, 'palace') && cards.length >= 1 && roles.size <= 1) {
      const role = normals.length ? BY_NAME[normals[0]].role : ledRole;
      if (role === ledRole || !normals.length) opts.push({ kind: 'palace', label: `Palace ×${cards.length}→【${ROLE_ZH[ledRole]}】` });
    }
    return opts;
  }
  function doFollow(o) {
    const ledRole = G.state.ledRole; let sel;
    if (o.kind === 'card') sel = { kind: 'card', index: ui.sel[0] };
    else if (o.kind === 'jack') sel = { kind: 'jack', index: ui.sel[0], role: ledRole };
    else sel = { kind: o.kind, indices: ui.sel.slice(), role: ledRole };
    const r = G.followWith(sel);
    if (!r.ok) { toast(r.error); return; }
    ui.sel = []; ui.act = null; afterEngine();
  }

  /* ---- 思考结算 ---- */
  function renderThinker() {
    const s = G.state, pend = s.pending, pid = pend.pid, p = G.P(pid), bar = $('#actionbar');
    const lim = G.handLimit(pid);
    setPrompt(`<span class="em">${p.name}</span> 思考：选择一项（手牌上限 ${lim}，当前 ${p.hand.length}）。`);
    // 预弃牌
    if (pend.canVomit) bar.appendChild(btn('Vomitorium：弃光全部手牌再选', 'btn', () => { ui.act = { choice: 'refill', vomit: true }; doThink('refill', 'all'); }));
    if (pend.canLatrine) bar.appendChild(btn('Latrine：先弃1张（点手牌）', 'btn', () => { ui.act = { mode: 'latrine', choice: 'refill' }; toast('点击要弃掉的手牌'); renderHand(); }));
    // 主选择
    if (s.jackPile > 0) bar.appendChild(btn('取 1 张 Jack', 'btn gold', () => doThink('jack')));
    if (p.hand.length < lim) bar.appendChild(btn(`补满手牌至 ${lim}`, 'btn primary', () => doThink('refill')));
    bar.appendChild(btn('多抽 1 张', 'btn', () => doThink('draw1')));
  }
  function doThink(choice, discard) {
    const r = G.resolveThinker({ choice, discard: discard || null });
    if (!r.ok) { toast(r.error); return; }
    ui.act = null; afterEngine();
  }

  /* ---- Prison ---- */
  function renderPrison() {
    const pid = G.state.pending.pid, bar = $('#actionbar');
    ui.act = ui.act || { mode: 'prisonTarget' };
    if (!ui.act.mode) ui.act.mode = 'prisonTarget';
    setPrompt(`<span class="em">${G.P(pid).name}</span> 的 Prison：点击对手<b>已完成建筑</b>夺取（你将给对方 3 影响力），或放弃。`);
    bar.appendChild(btn('放弃夺取', 'btn ghost', () => { do_(G.resolvePrison({ skip: true })); }));
    renderPlayers();
  }

  /* ---- Fountain ---- */
  function renderFountain() {
    const pend = G.state.pending, pid = pend.pid, card = pend.card, bar = $('#actionbar');
    setPrompt(`<span class="em">${G.P(pid).name}</span> Fountain：翻出 <b>${card}</b>（${BY_NAME[card].role}/${BY_NAME[card].material}）。如何使用？`);
    bar.appendChild(btn('作为地基（奠基）', 'btn primary', () => {
      if (BY_NAME[card].power === 'statue') { pickSite(m => do_(G.resolveFountain({ use: 'foundation', statueSite: m }))); }
      else do_(G.resolveFountain({ use: 'foundation' }));
    }));
    const inprog = G.P(pid).inProgress.filter(st => canFill(pid, st, card));
    inprog.forEach(st => bar.appendChild(btn(`放入 ${st.name}`, 'btn', () => do_(G.resolveFountain({ use: 'fill', structureId: st.id })))));
    bar.appendChild(btn('收入手牌', 'btn ghost', () => do_(G.resolveFountain({ use: 'hand' }))));
  }
  function canFill(pid, st, card) {
    const cmat = BY_NAME[card].material;
    if (cmat === st.material) return true;
    if (st.isStatue && cmat === 'Marble') return true;
    if (G.hasPower(pid, 'tower') && cmat === 'Rubble') return true;
    if (G.hasPower(pid, 'road') && st.material === 'Stone') return true;
    if (G.hasPower(pid, 'scriptorium') && cmat === 'Marble') return true;
    return false;
  }

  /* ---- 资助人附加随从 (Bar / Aqueduct) ---- */
  function renderPatronBonus() {
    const pend = G.state.pending, pid = pend.pid, bar = $('#actionbar');
    setPrompt(`<span class="em">${G.P(pid).name}</span>：本次资助人动作可获得<b>额外随从</b>（同一动作内）。`);
    if (!pend.barUsed && G.hasPower(pid, 'bar'))
      bar.appendChild(btn('Bar：额外从牌库抽 1 个随从', 'btn gold', () => do_(G.resolvePatronBonus({ take: 'bar' }))));
    if (!pend.aqUsed && G.hasPower(pid, 'aqueduct'))
      bar.appendChild(btn('Aqueduct：额外从手牌雇 1 个随从（点手牌）', 'btn gold', () => { ui.act = { mode: 'aqBonus' }; toast('点击手牌中要雇佣的牌'); renderHand(); }));
    bar.appendChild(btn('不再追加，继续', 'btn primary', () => do_(G.resolvePatronBonus({ take: 'done' }))));
  }

  /* ---- Basilica 附加 (手牌→金库) ---- */
  function renderBasilicaBonus() {
    const pid = G.state.pending.pid, bar = $('#actionbar');
    ui.act = { mode: 'basilicaBonus' };
    setPrompt(`<span class="em">${G.P(pid).name}</span> Basilica：可<b>额外</b>从手牌存 1 张材料入金库（点手牌），或跳过。`);
    bar.appendChild(btn('不追加，继续', 'btn primary', () => do_(G.resolveBasilicaBonus({}))));
    renderHand();
  }

  /* ---- 动作阶段 ---- */
  function renderActions() {
    const s = G.state, pid = s.current, role = G.currentRole(), bar = $('#actionbar');
    const remain = G.actorTokens(pid).length;
    setPrompt(`<span class="em">${G.P(pid).name}</span> 执行【${ROLE_ZH[role]} ${role}】动作 · 剩余 <b>${remain}</b> 个`);
    ui.act = ui.act || {};
    ui.act.role = role;

    if (role === 'Laborer') renderLaborer();
    else if (role === 'Patron') renderPatron();
    else if (role === 'Merchant') renderMerchant();
    else if (role === 'Legionary') renderLegionary();
    else if (role === 'Craftsman' || role === 'Architect') renderBuild(role);
    else if (role === 'Thinker') { setPrompt(`<span class="em">${G.P(pid).name}</span>：额外思考动作（剩余 ${remain}）`); bar.appendChild(btn('进行思考', 'btn primary', () => { do_(G.doThinkerToken()); })); }

    bar.appendChild(btn('结束我的动作', 'btn ghost', () => { ui.act = null; do_(G.endActor()); }));
  }

  function renderLaborer() {
    const pid = G.state.current, bar = $('#actionbar');
    const dock = G.hasPower(pid, 'dock');
    ui.act.dockHand = dock;
    let info = '点击<b>供应区</b>一张材料取走';
    if (dock) info += '；Dock：可<b>额外</b>点击手牌材料一并取走';
    setPrompt(`劳工：${info}。` + selInfo());
    if (ui.act.poolIndex != null || ui.act.handIndex != null) {
      bar.appendChild(btn('确定取材料', 'btn primary', () => {
        do_(G.doLaborer({ poolIndex: ui.act.poolIndex, handIndex: dock ? ui.act.handIndex : null }));
      }));
      bar.appendChild(btn('重选', 'btn ghost', () => { ui.act.poolIndex = ui.act.handIndex = null; refreshAct(); }));
    }
    renderHand(); renderPool();
  }
  function selInfo() {
    let t = '';
    if (ui.act && ui.act.poolIndex != null) t += ` [供应区:${G.state.pool[ui.act.poolIndex]}]`;
    if (ui.act && ui.act.handIndex != null) t += ` [手牌:${G.P(G.state.current).hand[ui.act.handIndex]}]`;
    return t ? `<span class="em">${t}</span>` : '';
  }

  function renderPatron() {
    const pid = G.state.current, bar = $('#actionbar');
    setPrompt('资助人：点击<b>供应区</b>一张牌雇为随从。' + (G.P(pid).clientele.length >= G.clienteleLimit(pid) ? ' <span class="em">随从已满！</span>' : ''));
    if (G.hasPower(pid, 'bar')) bar.appendChild(btn('Bar：从牌库抽1张为随从', 'btn', () => do_(G.doPatron({ source: 'deck' }))));
    if (G.hasPower(pid, 'aqueduct')) bar.appendChild(btn('Aqueduct：从手牌取随从（点手牌）', 'btn', () => { ui.act.mode = 'patronHand'; toast('点击手牌中要雇佣的牌'); renderHand(); }));
    renderPool();
  }

  function renderMerchant() {
    const pid = G.state.current, bar = $('#actionbar');
    ui.act.mode = ui.act.mode || 'merchantPick';
    setPrompt('商人：点击<b>库存</b>材料存入金库。' + (G.P(pid).vault.length >= G.vaultLimit(pid) ? ' <span class="em">金库已满！</span>' : ''));
    if (G.hasPower(pid, 'basilica')) bar.appendChild(btn('Basilica：从手牌存入金库（点手牌）', 'btn', () => { ui.act.mode = 'merchHand'; toast('点击手牌材料存入金库'); renderHand(); }));
    if (G.hasPower(pid, 'atrium')) bar.appendChild(btn('Atrium：从牌库暗抽存入金库', 'btn', () => do_(G.doMerchant({ source: 'deck' }))));
    renderPlayers();
  }

  function renderLegionary() {
    const pid = G.state.current, p = G.P(pid), bar = $('#actionbar');
    setPrompt('军团兵：选择索取的材料（须手牌中有该材料示意）。' + (G.hasPower(pid, 'bridge') ? ' <span class="em">Bridge：向全场+库存索取</span>' : ''));
    const owned = new Set(p.hand.filter(c => !isJack(c)).map(c => BY_NAME[c].material));
    MATERIAL_LIST.forEach(m => {
      const b = btn(`索取 ${MATERIALS[m].zh} ${m}`, 'btn primary', () => {
        if (G.hasPower(pid, 'coliseum')) { ui.act = { mode: 'coliseum', material: m, coliseum: [] }; setPrompt('Coliseum：可点击对手<b>随从</b>抓入金库（角色须与所索材料一致），然后确定。'); renderActionsExtra(m); }
        else do_(G.doLegionary({ material: m }));
      });
      if (!owned.has(m)) b.disabled = true;
      bar.appendChild(b);
    });
  }
  function renderActionsExtra(m) {
    const bar = $('#actionbar'); bar.innerHTML = '';
    bar.appendChild(btn(`确定军团兵（索取 ${m}）`, 'btn primary', () => do_(G.doLegionary({ material: m, coliseum: ui.act.coliseum }))));
    bar.appendChild(btn('取消', 'btn ghost', () => { ui.act = null; renderControl(); }));
    bar.appendChild(btn('结束我的动作', 'btn ghost', () => { ui.act = null; do_(G.endActor()); }));
    renderPlayers();
  }

  function renderBuild(role) {
    const pid = G.state.current, bar = $('#actionbar');
    ui.act.mode = ui.act.mode || 'choose';
    const remain = G.actorTokens(pid).length;
    if (ui.act.mode === 'choose') {
      setPrompt(`${ROLE_ZH[role]}：选择<b>奠基</b>或<b>加料/完成</b>。`);
      bar.appendChild(btn('奠基（出地基）', 'btn primary', () => { ui.act.mode = 'foundCard'; toast('点击手牌中要作为地基的牌'); renderHand(); }));
      bar.appendChild(btn('加材料 / 完成', 'btn primary', () => {
        if (!G.P(pid).inProgress.length) { toast('你没有在建建筑'); return; }
        ui.act.mode = 'fillTarget'; toast('点击你的一座在建建筑'); renderPlayers();
      }));
      if (role === 'Craftsman' && G.hasPower(pid, 'fountain')) bar.appendChild(btn('Fountain：翻牌库', 'btn gold', () => do_(G.fountainDraw())));
      if (role === 'Architect' && G.hasPower(pid, 'stairway')) bar.appendChild(btn('Stairway：公开对手建筑', 'btn gold', () => { ui.act.mode = 'stairwayTarget'; toast('点击对手一座已完成建筑'); renderPlayers(); }));
    } else if (ui.act.mode === 'foundCard') {
      setPrompt('奠基：点击手牌中的地基牌。' + selInfo()); renderHand();
      bar.appendChild(btn('返回', 'btn ghost', () => { ui.act.mode = 'choose'; refreshAct(); }));
    } else if (ui.act.mode === 'statueSite') {
      setPrompt('Statue：选择放置的 Site 材料。');
      MATERIAL_LIST.forEach(m => bar.appendChild(btn(`${MATERIALS[m].zh}(价值${MATERIALS[m].value})`, 'btn', () => { ui.act.statueSite = m; ui.act.mode = 'foundConfirm'; refreshAct(); })));
    } else if (ui.act.mode === 'foundConfirm') {
      const c = G.P(pid).hand[ui.act.foundIndex];
      const siteMat = ui.act.statueSite || BY_NAME[c].material;
      const canOut = G.state.sites[siteMat].out > 0 && remain >= (G.hasPower(pid, 'tower') ? 1 : 2);
      setPrompt(`奠基 <b>${c}</b>（${siteMat} Site）。城内剩 ${G.state.sites[siteMat].inTown}，城外剩 ${G.state.sites[siteMat].out}。`);
      bar.appendChild(btn('城内奠基', 'btn primary', () => doLay(role, false)));
      const ob = btn(`城外奠基（${G.hasPower(pid, 'tower') ? '1' : '2'}动作）`, 'btn', () => doLay(role, true));
      if (!canOut) ob.disabled = true; bar.appendChild(ob);
      bar.appendChild(btn('返回', 'btn ghost', () => { ui.act.mode = 'foundCard'; ui.act.statueSite = null; refreshAct(); }));
    } else if (ui.act.mode === 'fillTarget') {
      setPrompt('加料：点击你的一座在建建筑作为目标。'); renderPlayers();
      bar.appendChild(btn('返回', 'btn ghost', () => { ui.act.mode = 'choose'; refreshAct(); }));
    } else if (ui.act.mode === 'fillSource') {
      const st = G.P(pid).inProgress.find(x => x.id === ui.act.structureId);
      setPrompt(`加料到 <b>${st ? st.name : ''}</b>：${role === 'Craftsman' ? '点击手牌材料' : '点击库存材料' + (G.hasPower(pid, 'archway') ? '（Archway 可点供应区）' : '')}。`);
      if (role === 'Craftsman') renderHand(); else { renderPlayers(); renderPool(); }
      bar.appendChild(btn('返回', 'btn ghost', () => { ui.act.mode = 'fillTarget'; refreshAct(); }));
    } else if (ui.act.mode === 'stairwayTarget') {
      setPrompt('Stairway：点击对手一座已完成建筑。'); renderPlayers();
      bar.appendChild(btn('取消', 'btn ghost', () => { ui.act.mode = 'choose'; refreshAct(); }));
    } else if (ui.act.mode === 'stairwaySource') {
      setPrompt('Stairway：点击你库存(或Archway供应区)中与该建筑同材料的材料。'); renderPlayers(); renderPool();
      bar.appendChild(btn('取消', 'btn ghost', () => { ui.act.mode = 'choose'; refreshAct(); }));
    }
  }
  function doLay(role, outOfTown) {
    const r = G.layFoundation(role, { handIndex: ui.act.foundIndex, statueSite: ui.act.statueSite, outOfTown });
    if (!r.ok) { toast(r.error); return; }
    ui.act = null; afterEngine();
  }

  function refreshAct() { renderControl(); renderHand(); renderPool(); renderPlayers(); }
  function hintBtn(t) { const b = el('button', 'btn ghost'); b.textContent = t; b.disabled = true; return b; }
  function setPrompt(html) { $('#prompt').innerHTML = html; }
  function toast(msg) { ui.toast = msg; $('#prompt').innerHTML = `<span class="em">${msg}</span>`; }

  /* 引擎调用包装 */
  function do_(result) { if (result && !result.ok) { toast(result.error); return; } ui.act = null; afterEngine(); }
  function afterEngine() { render(); }

  /* ================== 角色 / Site 选择弹窗 ================== */
  function pickRole(cb) {
    const ov = $('#overlay'); ov.classList.remove('hidden');
    const modal = el('div', 'modal');
    modal.appendChild(el('h2', '', '选择角色'));
    const row = el('div', 'role-pick');
    ROLE_LIST.forEach(r => { const b = btn(`${ROLE_ZH[r]} ${r}`, 'btn primary', () => { ov.classList.add('hidden'); cb(r); }); row.appendChild(b); });
    modal.appendChild(row);
    modal.appendChild(btn('取消', 'btn ghost', () => ov.classList.add('hidden')));
    ov.innerHTML = ''; ov.appendChild(modal);
  }
  function pickSite(cb) {
    const ov = $('#overlay'); ov.classList.remove('hidden');
    const modal = el('div', 'modal'); modal.appendChild(el('h2', '', 'Statue：选择 Site 材料'));
    const row = el('div', 'role-pick');
    MATERIAL_LIST.forEach(m => row.appendChild(btn(`${MATERIALS[m].zh}(价值${MATERIALS[m].value})`, 'btn', () => { ov.classList.add('hidden'); cb(m); })));
    modal.appendChild(row); ov.innerHTML = ''; ov.appendChild(modal);
  }

  /* ================== 交接遮罩 ================== */
  function maybeHandoff() {
    const owner = decisionOwner();
    if (owner < 0 || G.state.over) return;
    if (isAI(owner)) return;   // AI 座位无需交接
    if (!ui.handoffEnabled) { ui.revealedFor = owner; return; }
    if (ui.revealedFor === owner) return;
    // 显示交接
    const ov = $('#overlay'); ov.classList.remove('hidden');
    const modal = el('div', 'modal handoff');
    modal.innerHTML = `<div class="big">请将设备交给</div><div class="who">${G.P(owner).name}</div>
      <p style="color:var(--muted)">其他玩家请勿偷看手牌</p>`;
    const b = btn('我准备好了，揭示手牌', 'btn gold', () => { ui.revealedFor = owner; ov.classList.add('hidden'); render(); });
    modal.appendChild(b);
    ov.innerHTML = ''; ov.appendChild(modal);
  }

  /* ================== 游戏结束 ================== */
  function showGameOver() {
    const o = G.state.over; if (!o) return;
    const ov = $('#overlay'); ov.classList.remove('hidden');
    const modal = el('div', 'modal');
    modal.appendChild(el('h2', '', '🏆 游戏结束'));
    modal.appendChild(el('p', '', `结束原因：${o.reason}。胜者：<b style="color:var(--gold)">${o.winner != null ? G.P(o.winner).name : '—'}</b>`));
    const tbl = el('table', 'scoretable');
    tbl.innerHTML = `<tr><th>玩家</th><th>影响力</th><th>金库</th><th>商人奖励</th><th>建筑分</th><th>总分</th></tr>`;
    o.scores.slice().sort((a, b) => b.total - a.total).forEach(sc => {
      const tr = el('tr', sc.id === o.winner ? 'winner' : '');
      tr.innerHTML = `<td>${sc.name}</td><td>${sc.influence}</td><td>${sc.vault}</td><td>${sc.merchantBonus}</td><td>${sc.structureVP}</td><td>${sc.total}</td>`;
      tbl.appendChild(tr);
    });
    modal.appendChild(tbl);
    modal.appendChild(btn('再来一局', 'btn primary', () => { $('#overlay').classList.add('hidden'); $('#game').classList.add('hidden'); $('#setup').classList.remove('hidden'); G = null; }));
    ov.innerHTML = ''; ov.appendChild(modal);
  }

  /* ================== 日志 / 菜单 ================== */
  function showLog() {
    const ov = $('#logModal'); ov.classList.remove('hidden');
    const modal = el('div', 'modal'); modal.appendChild(el('h2', '', '游戏日志'));
    const box = el('div', '', '');
    G.state.log.slice().reverse().forEach(l => box.appendChild(el('div', 'logline', `<b>[${l.t}]</b> ${l.text}`)));
    modal.appendChild(box);
    modal.appendChild(btn('关闭', 'btn ghost', () => ov.classList.add('hidden')));
    ov.innerHTML = ''; ov.appendChild(modal);
  }
  /* ================== 新手教程 ================== */
  function tutSlide(title, html) {
    const s = el('div', 'tut-slide');
    s.appendChild(el('h3', '', title));
    const b = el('div', 'tut-body'); b.innerHTML = html; s.appendChild(b);
    return s;
  }
  function roleLegend() {
    const wrap = el('div', 'rolelegend');
    [['Laborer', '劳工', '从公共区拿材料'], ['Craftsman', '工匠', '用手牌盖建筑'],
     ['Architect', '建筑师', '用库存盖建筑'], ['Legionary', '军团兵', '向邻居抢材料'],
     ['Merchant', '商人', '卖材料赚分'], ['Patron', '资助人', '雇随从帮你行动']
    ].forEach(([role, zh, desc]) => {
      const m = matForRole(role), color = MATERIALS[m].color;
      const r = el('div', 'rolerow');
      r.innerHTML = `<span class="rolepill" style="background:${color}"></span>
        <span><span class="rname">${zh} ${role}</span><br><span class="rdesc">${MATERIALS[m].zh} · ${desc}</span></span>`;
      wrap.appendChild(r);
    });
    return wrap;
  }
  function cardExamples(list) {
    const row = el('div', 'tut-cards');
    list.forEach(([name, cap]) => {
      const wrap = el('div', 'tut-cardwrap');
      wrap.appendChild(renderCard(name, {}));
      wrap.appendChild(el('div', 'cap', cap));
      row.appendChild(wrap);
    });
    return row;
  }
  function zoneMap() {
    const wrap = el('div', 'zonemap');
    [['手牌 Hand', '你能打出的牌。'],
     ['随从 Clientele', '帮你额外行动的人（数量上限 = 影响力）。'],
     ['库存 Stockpile', '囤着的材料，没有上限。'],
     ['金库 Vault', '卖掉的材料 = 分数（上限 = 影响力，且对所有人保密）。'],
     ['影响力 Influence', '从 2 开始；盖好建筑就增加。它决定随从/金库上限，并直接计为分数。'],
     ['建筑 Buildings', '在建的地基 + 已完成的建筑（提供专属能力与分数）。']
    ].forEach(([t, d]) => { const c = el('div', 'zonecell'); c.innerHTML = `<div class="zt">${t}</div><div class="zd">${d}</div>`; wrap.appendChild(c); });
    return wrap;
  }
  function flowSteps(steps) {
    const w = el('div', 'flow');
    steps.forEach((t, i) => { const s = el('div', 'flowstep'); s.innerHTML = `<span class="num">${i + 1}</span><span class="ft">${t}</span>`; w.appendChild(s); });
    return w;
  }

  const TUT = [
    () => tutSlide('欢迎来到罗马！🏛️', `
      <p>公元 64 年，罗马大火，全城需要重建。你扮演一位罗马贵族，靠<b>帮忙重建</b>来积累<b>声望与财富</b>。</p>
      <div class="big-goal">🎯 <b>一句话目标</b>：游戏结束时，谁的<b>分数（胜利点）</b>最高谁就赢。<br>
        分数主要来自：<b>影响力</b> ＋ <b>卖材料赚的钱（金库）</b> ＋ <b>盖好的建筑</b>。</div>
      <p>2–5 人轮流玩。规则看着多，但跟着这个教程一页页走，几分钟就能上手。点「下一页 ›」开始。</p>`),

    () => { const s = tutSlide('最关键的一点：一张牌有 5 种身份', `
      <p>游戏里几乎所有牌都是 <b>Order 牌</b>。同一张牌，你要决定它<b>变成什么</b> —— 这是本游戏最有趣的取舍：</p>
      <ul>
        <li>① <b>角色指令</b> —— 打出去，决定你这一手做什么</li>
        <li>② <b>随从 Client</b> —— 以后每个回合帮你多行动一次</li>
        <li>③ <b>材料 Material</b> —— 用来盖建筑</li>
        <li>④ <b>建筑 Building</b> —— 盖好后给你专属能力 ＋ 分数</li>
        <li>⑤ <b>金钱 Vault</b> —— 把材料卖掉换成分数</li>
      </ul>
      <p><b>牌的颜色 = 它代表的角色</b>。记住这 6 个颜色，就懂了一半 👇</p>`);
      s.appendChild(roleLegend()); return s; },

    () => { const s = tutSlide('六种角色长什么样', `
      <p>下面每张牌的<b>颜色和左边的角色名</b>就告诉你它是什么角色。鼠标悬停可放大看清功能：</p>`);
      s.appendChild(cardExamples([['Bar', '黄=劳工'], ['Dock', '绿=工匠'], ['Tower', '灰=建筑师'], ['School', '红=军团兵'], ['Catacomb', '蓝=商人'], ['Statue', '紫=资助人'], ['Jack', 'Jack百搭']]));
      const b = el('div', 'tut-body'); b.innerHTML = `<p style="margin-top:10px"><b>Jack</b> 是百搭牌，可以当任意角色（不能当思考者）。用完会还回去。</p>`;
      s.appendChild(b); return s; },

    () => { const s = tutSlide('你的桌面（Camp）有哪些区域', `
      <p>每个玩家面前都有一块“营地”，分成几个区域。看懂它们，就看懂了局势：</p>`);
      s.appendChild(zoneMap());
      const b = el('div', 'tut-body'); b.innerHTML = `<p style="margin-top:8px">💡 <b>影响力</b>是核心：它既是<b>分数</b>，又决定你能<b>养多少随从</b>、<b>金库能放多少</b>。盖建筑 = 同时变强又得分。</p>`;
      s.appendChild(b); return s; },

    () => { const s = tutSlide('一个回合是怎么走的', `<p>每回合有一名<b>带头者</b>（轮流当）。流程是：</p>`);
      s.appendChild(flowSteps([
        '<b>带头者</b>二选一：① <b>带头</b>——打出一张牌，决定本回合<b>所有人</b>的角色；或 ② <b>思考</b>——不带头，抽牌补满手牌，回合直接结束。',
        '其他人按顺时针，各自二选一：<b>跟随</b>（打出<b>同色</b>的牌）或 <b>思考</b>（抽牌）。',
        '然后从带头者起、顺时针，每人执行这个角色的动作。',
        '动作次数 = <b>带头/跟随 1 次</b> ＋ <b>每个“该角色的随从”再 +1 次</b>。'
      ]));
      const b = el('div', 'tut-body'); b.innerHTML = `<p style="margin-top:8px">⭐ <b>重点</b>：就算你这回合选了“思考”，你的<b>随从照样会行动</b>！所以随从越多，滚雪球越快。</p>`;
      s.appendChild(b); return s; },

    () => tutSlide('六种角色分别做什么', `
      <ul>
        <li><b>🟡 劳工 Laborer</b>：从中间的<b>供应区</b>拿一张材料，放进你的库存。</li>
        <li><b>🟢 工匠 Craftsman</b>：用<b>手牌</b>盖建筑（开新地基，或往地基里加材料）。</li>
        <li><b>⚪ 建筑师 Architect</b>：用<b>库存</b>里的材料盖建筑。</li>
        <li><b>🔴 军团兵 Legionary</b>：指定一种材料，从供应区和<b>左右邻居手里</b>各抢一张。</li>
        <li><b>🔵 商人 Merchant</b>：把库存里的材料<b>卖进金库</b>（= 分数）。</li>
        <li><b>🟣 资助人 Patron</b>：从供应区雇一个<b>随从</b>（以后每回合帮你多行动）。</li>
        <li><b>⚫ 思考者 Thinker</b>（就是“思考”）：抽牌 —— 补满手牌 / 多抽 1 张 / 拿 1 张 Jack。</li>
      </ul>`),

    () => { const s = tutSlide('怎么盖一座建筑（最主要的得分方式）', `<p>盖建筑分三步，盖好后<b>立刻 +影响力</b>并永久获得它的能力：</p>`);
      s.appendChild(flowSteps([
        '<b>奠基</b>：用工匠/建筑师，打出一张牌当“地基”，并拿一张<b>同色</b>的“场地(Site)”垫在下面。',
        '<b>加材料</b>：往地基里放<b>同色</b>材料。工匠从<b>手牌</b>放，建筑师从<b>库存</b>放。',
        '<b>完成</b>：材料数量够了就完成！建筑的<b>价值(1~3)</b>= 需要的材料数，也是它给的影响力。'
      ]));
      const b = el('div', 'tut-body'); b.innerHTML = `<p style="margin-top:8px">例：一座价值 1 的<b>木</b>建筑（如 Palisade），只要放 <b>1 个木材料</b>就完成，+1 影响力并获得“免疫军团兵”的能力。</p>`;
      s.appendChild(b); return s; },

    () => tutSlide('游戏什么时候结束 & 怎么算赢', `
      <p><b>满足任意一条，游戏立即结束：</b></p>
      <ul>
        <li>牌库抽空，或 中间的“城内场地”用完</li>
        <li>有人完成 <b>Catacomb</b>（蓝色，会直接结束游戏）</li>
        <li>有人完成 <b>Forum</b> 且<b>集齐每种角色的随从</b> → 该玩家<b>立即获胜</b></li>
        <li>其他人一致同意向某人投降</li>
      </ul>
      <div class="big-goal">🏆 <b>最终计分</b> ＝ 影响力 ＋ 金库里材料的价值 ＋ 商人奖励（每种材料金库最多者 +3）＋ 建筑加分（Statue +3、Wall 每 2 材料 +1）。<br>
        分最高者获胜；平手则<b>手牌多</b>的人赢。</div>`),

    () => tutSlide('新手 4 条建议 💡', `
      <ul>
        <li><b>别只盯一种角色</b>：均衡发展，手里各色牌都留一点更灵活。</li>
        <li><b>早点盖 1–2 座便宜建筑</b>（价值 1 或 2）：快速拿到影响力和能力，滚起来。</li>
        <li><b>随从是雪球核心</b>：用资助人多雇随从，但注意别超过影响力上限。</li>
        <li><b>不知道做什么就“思考”</b>：补满手牌、保留更多选择，永远不亏。</li>
      </ul>
      <p>真正的乐趣在于把“一张牌的 5 种用途”和“建筑能力的组合”玩出花来 —— 多玩两局就有感觉了。</p>`),

    () => tutSlide('准备好了！开始你的第一局 ▶', `
      <ul>
        <li>游戏中随时点顶栏 <b>「参考卡」</b> 复习角色与流程，点 <b>「日志」</b> 看记录。</li>
        <li><b>鼠标悬停任意卡牌</b> 可放大并看到中文功能说明。</li>
        <li>开局时屏幕会提示“把设备交给某玩家”，<b>轮流操作</b>、互不偷看手牌。</li>
        <li>左下角的 <b>💡 教学提示</b> 会一步步告诉你现在该做什么（可在“菜单”里关闭）。</li>
      </ul>
      <p>建议第一局选 <b>2 人</b> 轻松上手。关掉这个教程，填好名字，点<b>「开始游戏」</b>吧！祝你 —— <b>Glory to Rome!</b> 🏛️</p>`)
  ];

  function showTutorial(idx) { ui.tut = idx || 0; $('#overlay').classList.remove('hidden'); renderTutorial(); }
  function renderTutorial() {
    const ov = $('#overlay'), total = TUT.length, i = Math.max(0, Math.min(ui.tut, total - 1));
    ui.tut = i;
    const modal = el('div', 'modal tut-modal');
    modal.appendChild(el('h2', '', `📖 新手教程 <span class="tut-step">${i + 1} / ${total}</span>`));
    modal.appendChild(TUT[i]());
    const nav = el('div', 'tut-nav');
    const prev = btn('‹ 上一页', 'btn ghost', () => { ui.tut--; renderTutorial(); }); if (i === 0) prev.disabled = true;
    const dots = el('div', 'tut-dots');
    for (let k = 0; k < total; k++) { const d = el('div', 'tut-dot' + (k === i ? ' on' : '')); d.onclick = () => { ui.tut = k; renderTutorial(); }; dots.appendChild(d); }
    const next = (i < total - 1)
      ? btn('下一页 ›', 'btn primary', () => { ui.tut++; renderTutorial(); })
      : btn(G ? '继续游戏 ▶' : '知道了，去开始 ▶', 'btn gold', () => ov.classList.add('hidden'));
    nav.appendChild(prev); nav.appendChild(dots); nav.appendChild(next);
    modal.appendChild(nav);
    const foot = el('div', ''); foot.style.cssText = 'text-align:center;margin-top:8px';
    foot.appendChild(btn('关闭教程', 'btn ghost', () => ov.classList.add('hidden')));
    modal.appendChild(foot);
    ov.innerHTML = ''; ov.appendChild(modal);
  }

  /* ================== 教学提示条 ================== */
  function renderCoach() {
    const coach = $('#coach'); if (!coach || !G) return;
    const owner = decisionOwner();
    if (owner >= 0 && isAI(owner)) {
      coach.classList.remove('hidden');
      coach.innerHTML = `<span class="ico">🤖</span><span>${G.P(owner).name} 思考中…（神经网络 AI）</span>`;
      return;
    }
    const tip = ui.coach ? coachTip() : null;
    if (tip) {
      coach.classList.remove('hidden');
      coach.innerHTML = `<span class="ico">💡</span><span>${tip}</span><span class="x" title="关闭提示（可在菜单重新开启）">✕</span>`;
      coach.querySelector('.x').onclick = () => { ui.coach = false; coach.classList.add('hidden'); };
    } else coach.classList.add('hidden');
  }
  function coachTip() {
    const s = G.state;
    if (s.over) return null;
    if (s.pending) {
      const t = s.pending.type;
      if (t === 'thinker') return '思考：从下面选一种抽牌方式（一般选「补满手牌」最稳）。';
      if (t === 'patronBonus') return '你有 Bar / Aqueduct：本次资助人动作还能额外多雇一个随从。';
      if (t === 'basilicaBonus') return '你有 Basilica：可以再从手牌多卖一张材料进金库。';
      if (t === 'prison') return 'Prison：点对手一座已完成的建筑，把它的能力抢过来。';
      if (t === 'fountain') return 'Fountain：决定这张从牌库翻出来的牌怎么用（奠基 / 加料 / 收手牌）。';
      return null;
    }
    if (s.phase === 'lead') return '你是带头者：点一张手牌 →（下方出现）点「带头【角色】」决定本回合大家做什么；没有想做的就点「思考」抽牌。';
    if (s.phase === 'follow') return `跟随阶段：想做【${ROLE_ZH[s.ledRole]}】就出一张<b>同色</b>牌跟随；否则点「思考」抽牌（你的随从稍后照样会行动）。`;
    if (s.phase === 'actions') {
      const r = G.currentRole();
      const tips = {
        Laborer: '劳工：点供应区一张材料，拿进你的库存。',
        Craftsman: '工匠：用手牌「奠基」开一座新建筑，或给在建建筑「加材料/完成」。',
        Architect: '建筑师：用<b>库存</b>的材料盖建筑（奠基出手牌、加料用库存）。',
        Legionary: '军团兵：选一种你<b>手里有</b>的材料，向供应区和左右邻居索取。',
        Merchant: '商人：点<b>库存</b>里的材料卖进金库，换成分数。',
        Patron: '资助人：点供应区一张牌雇成随从（以后每回合多行动一次）。',
        Thinker: '额外思考：抽牌。'
      };
      return (tips[r] || '') + ' 做完后可点「结束我的动作」。';
    }
    return null;
  }

  // 调试钩子（仅供自动化测试用，不影响正常游戏）
  window.__GTR_DEBUG = { getG: () => G, render, setAct: (a) => { ui.act = a; } };

  function showMenu() {
    const ov = $('#overlay'); ov.classList.remove('hidden');
    const modal = el('div', 'modal'); modal.appendChild(el('h2', '', '菜单'));
    const body = el('div', 'modal-body');
    const t = el('label', '', `<input type="checkbox" ${ui.handoffEnabled ? 'checked' : ''}> 启用“交接设备”遮罩（隐藏手牌）`);
    t.querySelector('input').onchange = e => { ui.handoffEnabled = e.target.checked; };
    body.appendChild(t);
    body.appendChild(el('div', '', '<div style="height:8px"></div>'));
    const cch = el('label', '', `<input type="checkbox" ${ui.coach ? 'checked' : ''}> 显示「💡 教学提示」（新手提示条）`);
    cch.querySelector('input').onchange = e => { ui.coach = e.target.checked; render(); };
    body.appendChild(cch);
    body.appendChild(el('div', '', '<div style="height:10px"></div>'));
    body.appendChild(btn('📖 打开新手教程', 'btn gold', () => { ov.classList.add('hidden'); showTutorial(0); }));
    body.appendChild(el('p', '', '<br><b>投降</b>：其他所有玩家投降给某人，则其立即获胜。'));
    const row = el('div', 'row');
    G.state.players.forEach(p => row.appendChild(btn('投降给 ' + p.name, 'btn', () => { ov.classList.add('hidden'); G.surrender(p.id); render(); })));
    body.appendChild(row);
    modal.appendChild(body);
    modal.appendChild(btn('回到开始界面（放弃本局）', 'btn ghost', () => { ov.classList.add('hidden'); $('#game').classList.add('hidden'); $('#setup').classList.remove('hidden'); G = null; }));
    modal.appendChild(document.createTextNode(' '));
    modal.appendChild(btn('关闭', 'btn primary', () => ov.classList.add('hidden')));
    ov.innerHTML = ''; ov.appendChild(modal);
  }

})();
