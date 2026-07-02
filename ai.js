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
  function valueOf(h) {  // 价值头：状态价值 ∈ [-1,1]（对当前行动者）
    const a = linRelu(M.value[0], h);
    return Math.tanh(linRaw(M.value[1], a)[0]);
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
      case 'found': {
        const actor = G.P(decisionPid(G));
        const opts = { handIndex: mv.index };
        // Statue 需显式指定 Site；与 Python 训练引擎一致，放到其自身材料(Marble)的场地
        if (actor && actor.hand[mv.index] === 'Statue') opts.statueSite = 'Marble';
        return G.layFoundation(mv.role, opts);
      }
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

  // ---------- MCTS（确定化 PUCT，仅 2 人；难度=模拟次数）----------
  function jsMargin(G, seat) {
    const sc = G.scoreAll().map(x => x.total);
    let mx = -Infinity; sc.forEach((v, i) => { if (i !== seat && v > mx) mx = v; });
    return Math.max(-1, Math.min(1, (sc[seat] - mx) / 12));
  }
  function determinizeJS(G, pid) {
    const g2 = G.clone(), s = g2.state;
    let unknown = []; const sizes = [], jacks = [];
    s.players.forEach((p, i) => {
      if (i === pid) return;
      const nj = p.hand.filter(c => c !== 'Jack');
      jacks.push([i, p.hand.length - nj.length]); sizes.push([i, nj.length]);
      unknown = unknown.concat(nj); p.hand = [];
    });
    unknown = unknown.concat(s.deck);
    for (let i = unknown.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = unknown[i]; unknown[i] = unknown[j]; unknown[j] = t; }
    sizes.forEach(([i, k]) => { const h = []; for (let x = 0; x < k; x++) h.push(unknown.pop()); s.players[i].hand = h; });
    jacks.forEach(([i, jk]) => { for (let x = 0; x < jk; x++) s.players[i].hand.push('Jack'); });
    s.deck = unknown;
    return g2;
  }
  function makeNode(g) {
    const over = g.state.over;
    return {
      g, terminal: !!over, toMove: over ? -1 : decisionPid(g),
      term: over ? g.state.players.map((_, p) => jsMargin(g, p)) : null,
      moves: null, P: null, N: null, W: null, children: null, expanded: false
    };
  }
  function expandNode(node) {
    const g = node.g, pid = node.toMove;
    node.moves = legalMoves(g);
    const sd = normalizeLive(g, pid), h = trunkOf(encodeState(sd));
    const logits = node.moves.map(m => scoreMove(h, encodeMove(sd, m)));
    const mx = Math.max.apply(null, logits), ex = logits.map(l => Math.exp(l - mx));
    const sm = ex.reduce((a, b) => a + b, 0); node.P = ex.map(e => e / sm);
    const k = node.moves.length; node.N = new Float64Array(k); node.W = new Float64Array(k);
    node.children = new Array(k).fill(null); node.expanded = true;
    const v = valueOf(h), n = g.state.nPlayers, vec = new Array(n);
    for (let p = 0; p < n; p++) vec[p] = (p === pid) ? v : -v;   // 2人零和
    return vec;
  }
  function simulateNode(node, c) {
    if (node.terminal) return node.term;
    if (!node.expanded) return expandNode(node);
    let total = 0; for (let i = 0; i < node.N.length; i++) total += node.N[i];
    const sq = Math.sqrt(total + 1); let bi = 0, bu = -Infinity;
    for (let i = 0; i < node.moves.length; i++) {
      const q = node.N[i] > 0 ? node.W[i] / node.N[i] : 0;
      const u = c * node.P[i] * sq / (1 + node.N[i]);
      if (q + u > bu) { bu = q + u; bi = i; }
    }
    let child = node.children[bi];
    if (!child) { const g2 = node.g.clone(); applyMove(g2, node.moves[bi]); resolvePending(g2); child = makeNode(g2); node.children[bi] = child; }
    const vec = simulateNode(child, c);
    node.N[bi] += 1; node.W[bi] += vec[node.toMove];
    return vec;
  }
  function mctsAct(G, pid, sims, nDet, c) {
    if (!ensure()) return legalMoves(G)[0];  // 模型未载入时兜底，避免直接调用崩溃
    const per = Math.max(1, Math.floor(sims / nDet)); const agg = {}, rep = {};
    for (let d = 0; d < nDet; d++) {
      const root = makeNode(determinizeJS(G, pid));
      for (let s = 0; s < per; s++) simulateNode(root, c);
      if (root.moves) for (let i = 0; i < root.moves.length; i++) {
        const kk = JSON.stringify(root.moves[i]); agg[kk] = (agg[kk] || 0) + root.N[i]; rep[kk] = root.moves[i];
      }
    }
    let best = null, bv = -1; for (const kk in agg) if (agg[kk] > bv) { bv = agg[kk]; best = kk; }
    return best ? rep[best] : legalMoves(G)[0];
  }

  // ---------- 主入口：让当前 AI 座位走一步（difficulty: easy/normal/hard）----------
  function act(G, difficulty) {
    if (!ensure()) return false;
    resolvePending(G);
    if (G.state.over) return true;
    const pid = decisionPid(G);
    const moves = legalMoves(G);
    if (!moves.length) return false;
    if (moves.length === 1) { applyMove(G, moves[0]); return true; }
    difficulty = difficulty || 'normal';
    let chosen;
    if (difficulty === 'hard' && G.state.nPlayers === 2) {   // MCTS（仅2人）
      chosen = mctsAct(G, pid, 112, 7, 1.4);
    } else {
      const sd = normalizeLive(G, pid), h = trunkOf(encodeState(sd));
      const scores = moves.map(m => scoreMove(h, encodeMove(sd, m)));
      let idx = 0;
      if (difficulty === 'easy') {           // 35% 纯随机 + 高温采样：明显更弱，适合新手
        if (Math.random() < 0.35) {
          idx = Math.floor(Math.random() * moves.length);
        } else {
          const T = 1.7, ex = scores.map(s => Math.exp(s / T)), sum = ex.reduce((a, b) => a + b, 0);
          let r = Math.random() * sum, acc = 0;
          for (let i = 0; i < ex.length; i++) { acc += ex[i]; if (r <= acc) { idx = i; break; } }
        }
      } else {                                // normal: 贪婪；hard(≥3人): 也用贪婪
        let bs = -Infinity;
        for (let i = 0; i < scores.length; i++) if (scores[i] > bs) { bs = scores[i]; idx = i; }
      }
      chosen = moves[idx];
    }
    const r = applyMove(G, chosen);
    if (r && r.ok === false) {
      // 兜底：所选动作被引擎拒绝时，退而求其次（结束动作/思考），绝不原地空转
      const fb = moves.find(m => m.type === 'end_actor') || moves.find(m => m.type === 'think') || moves[0];
      if (fb !== chosen) applyMove(G, fb);
    }
    return true;
  }

  global.GTR_AI = {
    available, encodeState, encodeMove, normalizeLive, legalMoves, applyMove,
    resolvePending, act, trunkOf, scoreMove, valueOf, mctsAct, decisionPid
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.GTR_AI;
})(typeof window !== 'undefined' ? window : globalThis);
