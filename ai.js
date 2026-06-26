/* ===================================================================
   GTR_AI — 浏览器内纯 JS 推理（与 Python 训练管线编码完全一致）
   依赖：cards.js (GTR_CARDS)、ai_model.js (GTR_AI_MODEL)、engine.js (运行时 Game)
   =================================================================== */
(function (global) {
  'use strict';
  const CARDS = global.GTR_CARDS;
  const ROLE_LIST = CARDS.ROLE_LIST;
  const isJack = c => c === 'Jack';
  const matOf = c => (isJack(c) ? null : CARDS.BY_NAME[c].material);
  const valOf = c => (isJack(c) ? 0 : CARDS.MATERIALS[CARDS.BY_NAME[c].material].value);
  const roleOf = c => (isJack(c) ? null : CARDS.MATERIALS[CARDS.BY_NAME[c].material].role);

  let M = null, NAME_IDX, MAT_IDX, ROLE_IDX, PH_IDX, MT_IDX, TC_IDX, MATS, NB;
  function ensure() {
    if (M) return true;
    M = global.GTR_AI_MODEL;
    if (!M) return false;
    const idx = M.idx;
    NAME_IDX = {}; idx.NAMES.forEach((n, i) => NAME_IDX[n] = i);
    MAT_IDX = {}; idx.MATERIALS.forEach((n, i) => MAT_IDX[n] = i);
    ROLE_IDX = {}; idx.ROLES.forEach((n, i) => ROLE_IDX[n] = i);
    PH_IDX = {}; idx.PHASES.forEach((n, i) => PH_IDX[n] = i);
    MT_IDX = {}; idx.MOVE_TYPES.forEach((n, i) => MT_IDX[n] = i);
    TC_IDX = {}; idx.THINK_CHOICES.forEach((n, i) => TC_IDX[n] = i);
    MATS = idx.MATERIALS; NB = idx.NAMES.length;
    return true;
  }
  function available() { return ensure(); }

  // ---------- 编码（镜像 encode.py）----------
  function encodeState(sd) {
    ensure();
    const f = [];
    const push = (...xs) => { for (const x of xs) f.push(x); };
    const oh = (i, n) => { for (let k = 0; k < n; k++) f.push(k === i ? 1 : 0); };
    const matCounts = (cards) => { const v = new Array(6).fill(0); for (const c of cards) { const m = matOf(c); if (m != null) v[MAT_IDX[m]]++; } return v; };
    const matCountsM = (mats) => { const v = new Array(6).fill(0); for (const m of mats) if (m != null) v[MAT_IDX[m]]++; return v; };
    const nameMulti = (names) => { const v = new Array(NB).fill(0); for (const c of names) { const i = NAME_IDX[c]; if (i != null) v[i]++; } return v; };
    const roleCounts = (roles) => { const v = new Array(6).fill(0); for (const r of roles) v[ROLE_IDX[r]]++; return v; };

    const pid = sd.pid, p = sd.players[pid];
    oh(sd.phase in PH_IDX ? PH_IDX[sd.phase] : -1, 4);
    oh(sd.led_role != null ? ROLE_IDX[sd.led_role] : -1, 6);
    push(p.tokens_len / 6, sd.current === pid ? 1 : 0, sd.leader === pid ? 1 : 0);
    push(p.influence / 12, p.clientele.length / 12, p.vault_len / 12, p.hand_len / 12, p.stockpile.length / 12, p.inprog.length / 6);
    { const hm = nameMulti(p.hand); for (let i = 0; i < NB; i++) push(hm[i] / 3); }
    push(p.jacks);
    { const rc = roleCounts(p.clientele); for (let i = 0; i < 6; i++) push(rc[i] / 4); }
    { const sc = matCounts(p.stockpile); for (let i = 0; i < 6; i++) push(sc[i] / 4); }
    { const cm = nameMulti(p.completed); for (let i = 0; i < NB; i++) push(cm[i]); }
    { const im = matCountsM(p.inprog.map(s => s.material)); for (let i = 0; i < 6; i++) push(im[i] / 3); }
    { let rem = 0; for (const s of p.inprog) rem += Math.max(0, s.value - s.mat_len); push(rem / 6); }
    for (let k = 1; k <= 4; k++) {
      if (k < sd.n) {
        const o = sd.players[(pid + k) % sd.n];
        push(o.influence / 12, o.clientele.length / 12, o.vault_len / 12, o.hand_len / 12, o.stockpile.length / 12, o.inprog.length / 6);
        const orc = roleCounts(o.clientele); for (let i = 0; i < 6; i++) push(orc[i] / 4);
        const osc = matCounts(o.stockpile); for (let i = 0; i < 6; i++) push(osc[i] / 4);
        const ocm = nameMulti(o.completed); for (let i = 0; i < NB; i++) push(ocm[i]);
      } else {
        for (let i = 0; i < 6 + 6 + 6 + NB; i++) push(0);
      }
    }
    { const pm = matCounts(sd.pool); for (let i = 0; i < 6; i++) push(pm[i] / 6); }
    push(sd.pool.length / 12);
    for (const m of MATS) push(sd.sites[m].intown / 6);
    for (const m of MATS) push(sd.sites[m].out / 6);
    push(sd.deck_len / 144, sd.jack_pile / 6, sd.n / 5, Math.min(sd.turn_no, 200) / 200);
    return Float32Array.from(f);
  }

  function encodeMove(sd, mv) {
    ensure();
    const f = [];
    const oh = (i, n) => { for (let k = 0; k < n; k++) f.push(k === i ? 1 : 0); };
    const pid = sd.pid, p = sd.players[pid];
    oh(MT_IDX[mv.type], M.idx.MOVE_TYPES.length);
    let role = null, mat = null, name = null, completes = 0, cardval = 0, tc = null;
    const t = mv.type;
    if (t === 'lead_jack') role = mv.role;
    else if (t === 'lead_card' || t === 'follow_card') { const c = p.hand[mv.index]; role = roleOf(c); mat = matOf(c); cardval = valOf(c) / 3; }
    else if (t === 'laborer') { mat = matOf(sd.pool[mv.pool]); }
    else if (t === 'patron') { role = roleOf(sd.pool[mv.pool]); }
    else if (t === 'merchant') { const c = p.stockpile[mv.stock]; mat = matOf(c); cardval = valOf(c) / 3; }
    else if (t === 'legionary') mat = mv.material;
    else if (t === 'found') { const c = p.hand[mv.index]; name = c; mat = matOf(c); cardval = valOf(c) / 3; role = roleOf(c); }
    else if (t === 'fill') {
      const st = p.inprog.find(x => x.id === mv.sid);
      const src = mv.src === 'hand' ? p.hand : p.stockpile;
      mat = matOf(src[mv.index]);
      if (st) {
        const need = st.value - st.mat_len;
        completes = (need <= 1 || (p.has_scriptorium && mat === 'Marble') || (st.power === 'villa' && mv.role === 'Architect')) ? 1 : 0;
      }
    } else if (t === 'think_choice') tc = mv.choice;
    oh(role != null ? ROLE_IDX[role] : -1, 6);
    oh(mat != null ? MAT_IDX[mat] : -1, 6);
    oh(name != null && NAME_IDX[name] != null ? NAME_IDX[name] : -1, NB);
    oh(tc != null ? TC_IDX[tc] : -1, 3);
    f.push(completes, cardval);
    return Float32Array.from(f);
  }

  // ---------- 前向（MLP）----------
  function linRelu(layer, x) {
    const W = layer.W, b = layer.b, out = new Float32Array(W.length);
    for (let o = 0; o < W.length; o++) {
      let s = b[o]; const Wo = W[o];
      for (let i = 0; i < x.length; i++) s += Wo[i] * x[i];
      out[o] = s > 0 ? s : 0;
    }
    return out;
  }
  function linRaw(layer, x) {
    const W = layer.W, b = layer.b, out = new Float32Array(W.length);
    for (let o = 0; o < W.length; o++) { let s = b[o]; const Wo = W[o]; for (let i = 0; i < x.length; i++) s += Wo[i] * x[i]; out[o] = s; }
    return out;
  }
  function trunkOf(sv) {
    let h = linRelu(M.trunk[0], sv);
    h = linRelu(M.trunk[1], h);
    return h;
  }
  function scoreMove(h, mvVec) {
    const x = new Float32Array(h.length + mvVec.length);
    x.set(h, 0); x.set(mvVec, h.length);
    const a = linRelu(M.move[0], x);
    return linRaw(M.move[1], a)[0];
  }

  // ---------- 从 engine.js 实时状态构造归一化 dict ----------
  function normalizeLive(G, pid) {
    const s = G.state;
    const player = (i) => {
      const p = G.P(i);
      const d = {
        influence: p.influence, hand_len: p.hand.length,
        clientele: p.clientele.map(c => c.role), stockpile: p.stockpile.slice(),
        vault_len: p.vault.length, completed: p.completed.map(c => c.name),
        inprog: p.inProgress.map(st => ({ id: st.id, material: st.material, value: st.value, power: st.power, mat_len: st.materials.length })),
        tokens_len: (s.tokens[i] || []).length, has_scriptorium: G.hasPower(i, 'scriptorium')
      };
      if (i === pid) { d.hand = p.hand.slice(); d.jacks = p.hand.filter(isJack).length; }
      else { d.hand = []; d.jacks = 0; }
      return d;
    };
    const ph = (s.pending && s.pending.type === 'thinker') ? 'thinker' : s.phase;
    const sites = {}; CARDS.MATERIAL_LIST.forEach(m => sites[m] = { intown: s.sites[m].inTown, out: s.sites[m].out });
    return {
      n: s.nPlayers, pid, current: s.current, leader: s.leaderIndex, phase: ph, led_role: s.ledRole,
      turn_no: s.turnNo, deck_len: s.deck.length, jack_pile: s.jackPile, pool: s.pool.slice(),
      sites, players: s.players.map((_, i) => player(i))
    };
  }

  // ---------- 合法动作枚举（镜像 engine.py.legal_moves，读 engine.js 状态）----------
  function matOk(G, pid, st, cmat) {
    if (cmat === st.material) return true;
    if (st.isStatue && cmat === 'Marble') return true;
    if (G.hasPower(pid, 'tower') && cmat === 'Rubble') return true;
    if (G.hasPower(pid, 'road') && st.material === 'Stone') return true;
    if (G.hasPower(pid, 'scriptorium') && cmat === 'Marble') return true;
    return false;
  }
  function decisionPid(G) {
    const s = G.state;
    if (s.pending) return s.pending.pid;
    if (s.phase === 'lead') return s.leaderIndex;
    return s.current;
  }
  function legalMoves(G) {
    const s = G.state;
    if (s.over) return [];
    if (s.pending) {
      if (s.pending.type === 'thinker') {
        const mv = [{ type: 'think_choice', choice: 'refill' }, { type: 'think_choice', choice: 'draw1' }];
        if (s.jackPile > 0) mv.push({ type: 'think_choice', choice: 'jack' });
        return mv;
      }
      return [];
    }
    const pid = decisionPid(G);
    const p = G.P(pid);
    if (s.phase === 'lead') {
      const mv = [{ type: 'think' }]; let jd = false;
      p.hand.forEach((c, i) => {
        if (isJack(c)) { if (!jd) { jd = true; ROLE_LIST.forEach(r => mv.push({ type: 'lead_jack', index: i, role: r })); } }
        else mv.push({ type: 'lead_card', index: i });
      });
      return mv;
    }
    if (s.phase === 'follow') {
      const led = s.ledRole, mv = [{ type: 'think' }];
      p.hand.forEach((c, i) => { if (!isJack(c) && roleOf(c) === led) mv.push({ type: 'follow_card', index: i }); });
      for (let i = 0; i < p.hand.length; i++) if (isJack(p.hand[i])) { mv.push({ type: 'follow_jack', index: i }); break; }
      return mv;
    }
    // actions
    const role = G.currentRole(); const mv = [];
    if (role === 'Laborer') {
      const seen = new Set(); s.pool.forEach((c, i) => { const m = matOf(c); if (!seen.has(m)) { seen.add(m); mv.push({ type: 'laborer', pool: i }); } });
    } else if (role === 'Patron') {
      if (p.clientele.length < G.clienteleLimit(pid)) { const seen = new Set(); s.pool.forEach((c, i) => { const r = roleOf(c); if (!seen.has(r)) { seen.add(r); mv.push({ type: 'patron', pool: i }); } }); }
    } else if (role === 'Merchant') {
      if (p.vault.length < G.vaultLimit(pid)) { const seen = new Set(); p.stockpile.forEach((c, i) => { const m = matOf(c); if (!seen.has(m)) { seen.add(m); mv.push({ type: 'merchant', stock: i }); } }); }
    } else if (role === 'Legionary') {
      const mats = new Set(); p.hand.forEach(c => { if (!isJack(c)) mats.add(matOf(c)); }); mats.forEach(m => mv.push({ type: 'legionary', material: m }));
    } else if (role === 'Craftsman' || role === 'Architect') {
      const seen = new Set();
      p.hand.forEach((c, i) => {
        if (isJack(c) || seen.has(c)) return;
        if (p.inProgress.some(x => x.name === c) || p.completed.some(x => x.name === c)) return;
        const m = matOf(c); if (s.sites[m].inTown <= 0) return;
        seen.add(c); mv.push({ type: 'found', index: i, role });
      });
      p.inProgress.forEach(st => {
        const cards = role === 'Craftsman' ? p.hand : p.stockpile; const srcname = role === 'Craftsman' ? 'hand' : 'stock';
        const seen2 = new Set();
        cards.forEach((c, i) => { if (isJack(c)) return; const m = matOf(c); if (!matOk(G, pid, st, m)) return; if (!seen2.has(m)) { seen2.add(m); mv.push({ type: 'fill', sid: st.id, src: srcname, index: i, role }); } });
      });
    }
    mv.push({ type: 'end_actor' });
    return mv;
  }

  // ---------- 把抽象动作映射到 engine.js 命令 ----------
  function applyMove(G, mv) {
    const s = G.state;
    switch (mv.type) {
      case 'think': return s.phase === 'lead' ? G.leaderThink() : G.followThink();
      case 'lead_card': return G.leaderLead({ kind: 'card', index: mv.index });
      case 'lead_jack': return G.leaderLead({ kind: 'jack', index: mv.index, role: mv.role });
      case 'follow_card': return G.followWith({ kind: 'card', index: mv.index });
      case 'follow_jack': return G.followWith({ kind: 'jack', index: mv.index, role: s.ledRole });
      case 'think_choice': return G.resolveThinker({ choice: mv.choice });
      case 'laborer': return G.doLaborer({ poolIndex: mv.pool });
      case 'patron': return G.doPatron({ index: mv.pool });
      case 'merchant': return G.doMerchant({ index: mv.stock });
      case 'legionary': return G.doLegionary({ material: mv.material });
      case 'found': return G.layFoundation(mv.role, { handIndex: mv.index });
      case 'fill': return G.addMaterial(mv.role, mv.src === 'stock'
        ? { index: mv.index, structureId: mv.sid, source: 'stockpile' }
        : { index: mv.index, structureId: mv.sid });
      case 'end_actor': return G.endActor();
    }
  }

  // ---------- 自动结算 AI 座位的附加 pending（镜像 Python 自动逻辑）----------
  function resolvePending(G) {
    const s = G.state; let guard = 0;
    while (s.pending && s.pending.type !== 'thinker' && guard++ < 60) {
      const pid = s.pending.pid, t = s.pending.type;
      if (t === 'patronBonus') {
        if (!s.pending.barUsed && G.hasPower(pid, 'bar')) G.resolvePatronBonus({ take: 'bar' });
        else G.resolvePatronBonus({ take: 'done' });
      } else if (t === 'basilicaBonus') {
        G.resolveBasilicaBonus({});
      } else if (t === 'prison') {
        let best = null, bv = -1;
        s.players.forEach(o => {
          if (o.id === pid) return;
          o.completed.forEach((st, j) => {
            if (G.P(pid).completed.some(x => x.name === st.name) || G.P(pid).inProgress.some(x => x.name === st.name)) return;
            if (st.value > bv) { bv = st.value; best = { targetPid: o.id, structIndex: j }; }
          });
        });
        if (best) G.resolvePrison(best); else G.resolvePrison({ skip: true });
      } else { s.pending = null; }
    }
  }

  // ---------- 主入口：让当前 AI 座位走一步 ----------
  function act(G) {
    if (!ensure()) return false;
    resolvePending(G);
    if (G.state.over) return true;
    const pid = decisionPid(G);
    const moves = legalMoves(G);
    if (!moves.length) return false;
    if (moves.length === 1) { applyMove(G, moves[0]); return true; }
    const sd = normalizeLive(G, pid);
    const h = trunkOf(encodeState(sd));
    let bi = 0, bs = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      const sc = scoreMove(h, encodeMove(sd, moves[i]));
      if (sc > bs) { bs = sc; bi = i; }
    }
    applyMove(G, moves[bi]);
    return true;
  }

  global.GTR_AI = {
    available, encodeState, encodeMove, normalizeLive, legalMoves, applyMove,
    resolvePending, act, trunkOf, scoreMove, decisionPid
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.GTR_AI;
})(typeof window !== 'undefined' ? window : globalThis);
