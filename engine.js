/* ===================================================================
   Glory to Rome — 规则引擎 (核心40建筑 / Republic 规则 / 2-5人热座)
   纯逻辑，无 DOM。可在浏览器与 Node 下运行。
   UI 通过调用方法驱动；所有状态在 this.state。
   =================================================================== */
(function (global) {
  'use strict';

  const CARDS = (typeof require !== 'undefined') ? require('./cards.js') : global.GTR_CARDS;
  const { MATERIAL_LIST, ROLE_LIST, BY_NAME } = CARDS;

  // ---- 工具 ----
  function makeRng(seed) {
    if (seed == null) return Math.random;
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function isJack(c) { return c === 'Jack'; }
  function materialOf(card) { return isJack(card) ? null : BY_NAME[card].material; }
  function roleOf(card)     { return isJack(card) ? null : BY_NAME[card].role; }
  function valueOf(card)    { return isJack(card) ? 0 : BY_NAME[card].value; }
  function powerOf(card)    { return isJack(card) ? null : BY_NAME[card].power; }

  // ================================================================
  class Game {
    constructor(playerNames, opts = {}) {
      opts = opts || {};
      const rng = makeRng(opts.seed);
      this.rng = rng;
      const n = playerNames.length;
      if (n < 2 || n > 5) throw new Error('玩家数需为 2-5');

      const deck = shuffle(CARDS.buildDeck(), rng); // 144 张

      const players = playerNames.map((name, i) => ({
        id: i, name,
        hand: [],
        clientele: [],      // {name, role, fresh}
        stockpile: [],      // [cardName]
        vault: [],          // [cardName]
        influence: 2,
        completed: [],      // {name, power, material, value, isStatue, public}
        inProgress: []      // {id, name, power, material, value, materials:[], outOfTown}
      }));

      // 发起始手牌 (Republic: 每人5张)
      for (const p of players) for (let k = 0; k < 5; k++) p.hand.push(deck.pop());

      // 起始供应区 + 决定先手 (每人发1张到供应区，字母最靠前者先手)
      const startCards = [];
      for (let i = 0; i < n; i++) startCards.push(deck.pop());
      let leaderIndex = 0;
      let best = startCards[0];
      for (let i = 1; i < n; i++) if (startCards[i] < best) { best = startCards[i]; leaderIndex = i; }
      const pool = startCards.slice();

      // 场地：每种材料 in-town = 人数, 城外 = 6 - 人数
      const sites = {};
      for (const m of MATERIAL_LIST) sites[m] = { inTown: n, out: Math.max(0, 6 - n) };

      this._structSeq = 1;
      this.state = {
        players, deck, pool,
        jackPile: 6,
        sites,
        nPlayers: n,
        leaderIndex,
        turnNo: 1,
        phase: 'lead',          // lead | follow | actions | gameover
        ledRole: null,
        ledInstances: 0,        // 带头打出的“角色实例”数 (Palace 多张/普通1)
        played: {},             // pid -> {cards:[非jack角色牌], jacks:n}  本回合用于带头/跟随的牌
        followQueue: [], fi: 0,
        order: [], oi: 0,
        tokens: {},             // pid -> [{role}]
        ledOrFollowed: {},      // pid -> bool
        didCraftsman: {},       // pid -> bool (用于 Academy)
        publicPowers: new Set(),
        pending: null,          // 等待玩家的子决策 {type, pid, ...}
        endThinkerQueue: [],    // Academy 等回合末思考
        log: [],
        over: null,             // {winner, reason, scores}
        current: leaderIndex
      };
      this.log(`游戏开始：${n} 名玩家。先手为 ${players[leaderIndex].name}（起始牌 ${best}）。`);
    }

    // ---------- 日志 / 视图 ----------
    log(text) { this.state.log.push({ t: this.state.turnNo, text }); }
    P(id) { return this.state.players[id]; }
    cur() { return this.state.current; }

    // ---------- 能力查询 ----------
    hasPower(pid, power) {
      const s = this.state, p = s.players[pid];
      if (s.publicPowers.has(power)) return true;
      if (p.completed.some(x => x.power === power)) return true;
      // Gate: 未完成的 Marble 建筑也提供功能
      if (p.completed.some(x => x.power === 'gate') &&
          p.inProgress.some(x => x.material === 'Marble' && x.power === power)) return true;
      return false;
    }
    // 手牌上限 (思考补牌数)
    handLimit(pid) {
      let h = 5;
      if (this.hasPower(pid, 'shrine')) h += 2;
      if (this.hasPower(pid, 'temple')) h += 4;
      return h;
    }
    clienteleLimit(pid) {
      let base = this.P(pid).influence;
      if (this.hasPower(pid, 'insula')) base += 2;
      if (this.hasPower(pid, 'aqueduct')) base *= 2;
      return base;
    }
    vaultLimit(pid) {
      let v = this.P(pid).influence;
      if (this.hasPower(pid, 'market')) v += 2;
      return v;
    }
    immuneToLegionary(pid) {
      return this.hasPower(pid, 'palisade') || this.hasPower(pid, 'wall');
    }

    // 随从是否匹配某角色 (含 Storeroom / Ludus Magna 万用)
    clientMatches(pid, client, role) {
      if (client.role === role) return true;
      if (role === 'Laborer' && this.hasPower(pid, 'storeroom')) return true;
      if (client.role === 'Merchant' && this.hasPower(pid, 'ludusMagna')) return true;
      return false;
    }

    // ---------- 抽牌 / 结束判定 ----------
    draw(pid, n) {
      const s = this.state, p = s.players[pid], got = [];
      for (let i = 0; i < n; i++) {
        if (s.deck.length === 0) { this.endGame(null, '牌库抽空'); break; }
        const c = s.deck.pop();
        p.hand.push(c); got.push(c);
        if (s.deck.length === 0) { /* 抽完最后一张后结束 */ }
      }
      return got;
    }
    drawRaw(n) { // 抽到“缓冲”而非手牌 (Fountain/Atrium/Bar 等)
      const s = this.state, got = [];
      for (let i = 0; i < n; i++) {
        if (s.deck.length === 0) { this.endGame(null, '牌库抽空'); break; }
        got.push(s.deck.pop());
      }
      return got;
    }

    inTownTotal() {
      return MATERIAL_LIST.reduce((a, m) => a + this.state.sites[m].inTown, 0);
    }

    endGame(winner, reason) {
      if (this.state.over) return;
      const scores = this.scoreAll();
      if (winner == null && !reason.includes('立即获胜')) {
        // 按分数决定胜者，平分则手牌多者
        let bw = 0;
        for (let i = 1; i < scores.length; i++) {
          if (scores[i].total > scores[bw].total) bw = i;
          else if (scores[i].total === scores[bw].total &&
                   this.P(i).hand.length > this.P(bw).hand.length) bw = i;
        }
        winner = bw;
      }
      this.state.phase = 'gameover';
      this.state.over = { winner, reason, scores };
      this.state.pending = null;
      this.log(`游戏结束（${reason}）。胜者：${winner != null ? this.P(winner).name : '—'}。`);
    }

    // 即时获胜 (Forum)
    instantWin(pid, reason) {
      const scores = this.scoreAll();
      this.state.phase = 'gameover';
      this.state.over = { winner: pid, reason, scores };
      this.state.pending = null;
      this.log(`${this.P(pid).name} ${reason}，立即获胜！`);
    }

    checkForum(pid) {
      if (!this.hasPower(pid, 'forum')) return;
      const p = this.P(pid);
      // 需每种角色随从各至少1个 (Storeroom: 任意可当劳工; Ludus Magna: 商人可当任意)
      const need = ROLE_LIST.slice();
      const used = new Array(p.clientele.length).fill(false);
      const ok = need.every(role => {
        for (let i = 0; i < p.clientele.length; i++) {
          if (used[i]) continue;
          if (this.clientMatches(pid, p.clientele[i], role)) { used[i] = true; return true; }
        }
        return false;
      });
      if (ok) this.instantWin(pid, '集齐每种角色随从 (Forum)');
    }

    // ================================================================
    //  阶段 1: 带头 (Leader)
    // ================================================================
    leaderThink() {
      const s = this.state;
      if (s.phase !== 'lead') return this.err('当前不是带头阶段');
      const pid = s.leaderIndex;
      this.log(`${this.P(pid).name} 选择【思考】，本回合不带头。`);
      this.beginThinker(pid, 'endTurn');
      return this.ok();
    }

    // sel: {kind:'card', index} | {kind:'jack', index, role}
    //    | {kind:'petition', indices, role} | {kind:'palace', indices, role}
    //    | {kind:'circus', indices, role}
    leaderLead(sel) {
      const s = this.state;
      if (s.phase !== 'lead') return this.err('当前不是带头阶段');
      const pid = s.leaderIndex;
      const res = this._playRole(pid, sel, true);
      if (!res.ok) return res;
      s.ledRole = res.role;
      s.ledInstances = res.instances;
      this.log(`${this.P(pid).name} 带头【${CARDS.ROLE_ZH[res.role]} ${res.role}】（${res.desc}）。`);
      // 进入跟随阶段
      s.phase = 'follow';
      s.followQueue = [];
      for (let k = 1; k < s.nPlayers; k++) s.followQueue.push((pid + k) % s.nPlayers);
      s.fi = 0;
      s.current = s.followQueue.length ? s.followQueue[0] : pid;
      if (!s.followQueue.length) this.startActions();
      return this.ok();
    }

    // 内部：把牌作为某角色打出 (带头/跟随通用)。返回 {role, instances, desc}
    _playRole(pid, sel, isLead) {
      const p = this.P(pid), s = this.state;
      if (!s.played[pid]) s.played[pid] = { cards: [], jacks: 0 };
      const rec = s.played[pid];

      const takeFromHand = (idx) => { const c = p.hand[idx]; p.hand.splice(idx, 1); return c; };

      if (sel.kind === 'card') {
        const c = p.hand[sel.index];
        if (c == null || isJack(c)) return this.err('请选择一张普通角色牌');
        const role = roleOf(c);
        if (isLead && role == null) return this.err('不能带头思考者');
        takeFromHand(sel.index);
        rec.cards.push(c);
        return { ok: true, role, instances: 1, desc: c };
      }
      if (sel.kind === 'jack') {
        const c = p.hand[sel.index];
        if (!isJack(c)) return this.err('该牌不是 Jack');
        if (!ROLE_LIST.includes(sel.role)) return this.err('Jack 需指定有效角色（非思考者）');
        takeFromHand(sel.index);
        rec.jacks += 1;
        return { ok: true, role: sel.role, instances: 1, desc: `Jack→${sel.role}` };
      }
      if (sel.kind === 'petition') {
        // Republic: 2 张同角色当作 1 张 Jack
        const idxs = sel.indices.slice().sort((a, b) => b - a);
        if (idxs.length !== 2) return this.err('请愿(Republic)需选 2 张同角色牌');
        const cs = idxs.map(i => p.hand[i]);
        if (cs.some(isJack)) return this.err('Jack 不能用于请愿');
        const r0 = roleOf(cs[0]);
        if (!cs.every(c => roleOf(c) === r0)) return this.err('请愿的牌需同角色');
        if (!ROLE_LIST.includes(sel.role)) return this.err('请指定要扮演的角色');
        const removed = idxs.map(i => takeFromHand(i));
        removed.forEach(c => rec.cards.push(c));
        return { ok: true, role: sel.role, instances: 1, desc: `请愿(${r0}×2)→${sel.role}` };
      }
      if (sel.kind === 'circus') {
        // Circus: 2 张同角色当作 1 张 Jack
        if (!this.hasPower(pid, 'circus')) return this.err('你没有 Circus');
        const idxs = sel.indices.slice().sort((a, b) => b - a);
        if (idxs.length !== 2) return this.err('Circus 需选 2 张同角色牌');
        const cs = idxs.map(i => p.hand[i]);
        if (cs.some(isJack)) return this.err('Jack 不能用于 Circus');
        const r0 = roleOf(cs[0]);
        if (!cs.every(c => roleOf(c) === r0)) return this.err('Circus 的牌需同角色');
        if (!ROLE_LIST.includes(sel.role)) return this.err('请指定要扮演的角色');
        const removed = idxs.map(i => takeFromHand(i));
        removed.forEach(c => rec.cards.push(c));
        return { ok: true, role: sel.role, instances: 1, desc: `Circus(${r0}×2)→${sel.role}` };
      }
      if (sel.kind === 'palace') {
        // Palace: 多张同角色，各执行1次 (可含 Jack)
        if (!this.hasPower(pid, 'palace')) return this.err('你没有 Palace');
        const idxs = sel.indices.slice().sort((a, b) => b - a);
        if (idxs.length < 1) return this.err('Palace 需选至少 1 张');
        const cs = idxs.map(i => p.hand[i]);
        const role = sel.role;
        if (!ROLE_LIST.includes(role)) return this.err('请指定角色');
        // 每张必须是该角色或 Jack
        if (!cs.every(c => isJack(c) || roleOf(c) === role)) return this.err('Palace 各牌需同角色(或 Jack)');
        let inst = 0;
        idxs.forEach(i => {
          const c = takeFromHand(i);
          if (isJack(c)) rec.jacks += 1; else rec.cards.push(c);
          inst++;
        });
        return { ok: true, role, instances: inst, desc: `Palace ×${inst}→${role}` };
      }
      return this.err('未知的出牌方式');
    }

    // ================================================================
    //  阶段 2: 跟随 (clockwise)
    // ================================================================
    followThink() {
      const s = this.state;
      if (s.phase !== 'follow') return this.err('当前不是跟随阶段');
      const pid = s.current;
      this.log(`${this.P(pid).name} 选择【思考】（不跟随）。`);
      this.beginThinker(pid, 'follow');
      return this.ok();
    }
    followWith(sel) {
      const s = this.state;
      if (s.phase !== 'follow') return this.err('当前不是跟随阶段');
      const pid = s.current;
      // 跟随必须与带头角色一致
      const probe = this._peekRole(pid, sel);
      if (!probe.ok) return probe;
      if (probe.role !== s.ledRole) return this.err(`必须跟随【${s.ledRole}】或选择思考`);
      const res = this._playRole(pid, sel, false);
      if (!res.ok) return res;
      s.ledOrFollowed[pid] = true;
      s.played[pid].instances = res.instances;
      this.log(`${this.P(pid).name} 跟随【${s.ledRole}】（${res.desc}）。`);
      this._advanceFollow();
      return this.ok();
    }
    // 仅检查角色，不消耗
    _peekRole(pid, sel) {
      const p = this.P(pid);
      if (sel.kind === 'card') {
        const c = p.hand[sel.index];
        if (c == null || isJack(c)) return this.err('请选择普通角色牌');
        return { ok: true, role: roleOf(c) };
      }
      if (sel.kind === 'jack')   return { ok: true, role: sel.role };
      if (sel.kind === 'petition' || sel.kind === 'circus' || sel.kind === 'palace')
        return { ok: true, role: sel.role };
      return this.err('未知出牌方式');
    }
    _advanceFollow() {
      const s = this.state;
      s.fi++;
      if (s.fi >= s.followQueue.length) { this.startActions(); }
      else s.current = s.followQueue[s.fi];
    }

    // ================================================================
    //  思考者结算 (带头/跟随/动作内 通用)
    // ================================================================
    beginThinker(pid, returnTo) {
      // 记录基础跟随：思考者不算 ledOrFollowed
      this.state.pending = {
        type: 'thinker', pid, returnTo,
        canLatrine: this.hasPower(pid, 'latrine'),
        canVomit: this.hasPower(pid, 'vomitorium')
      };
    }
    // payload: {discard:'all'|index|null, choice:'jack'|'refill'|'draw1'}
    resolveThinker(payload) {
      const s = this.state, pend = s.pending;
      if (!pend || pend.type !== 'thinker') return this.err('当前无思考待结算');
      const pid = pend.pid, p = this.P(pid);
      payload = payload || {};
      // 预弃牌
      if (payload.discard === 'all' && pend.canVomit) {
        const moved = p.hand.filter(c => !isJack(c));
        p.hand.filter(isJack).forEach(() => s.jackPile++); // jack 回堆
        s.pool.push(...moved);
        p.hand = [];
        this.log(`${p.name} 用 Vomitorium 弃掉全部手牌到供应区。`);
      } else if (typeof payload.discard === 'number' && pend.canLatrine) {
        const c = p.hand[payload.discard];
        if (c != null) {
          p.hand.splice(payload.discard, 1);
          if (isJack(c)) s.jackPile++; else s.pool.push(c);
          this.log(`${p.name} 用 Latrine 弃 ${c} 到供应区。`);
        }
      }
      // 主选择
      const lim = this.handLimit(pid);
      let choice = payload.choice;
      if (choice === 'refill' && p.hand.length >= lim) choice = 'draw1';
      if (choice === 'jack') {
        if (s.jackPile > 0) { p.hand.push('Jack'); s.jackPile--; this.log(`${p.name} 思考：取 1 张 Jack。`); }
        else { this.log(`${p.name} 思考：无 Jack 可取，改抽 1 张。`); this.draw(pid, 1); }
      } else if (choice === 'draw1') {
        this.draw(pid, 1); this.log(`${p.name} 思考：抽 1 张。`);
      } else { // refill
        const need = Math.max(0, lim - p.hand.length);
        this.draw(pid, need); this.log(`${p.name} 思考：补牌至 ${lim} 张（抽 ${need} 张）。`);
      }
      const ret = pend.returnTo;
      s.pending = null;
      if (s.over) return this.ok();
      this._afterThinker(ret, pid);
      return this.ok();
    }
    _afterThinker(returnTo, pid) {
      const s = this.state;
      if (returnTo === 'endTurn') { this.endTurn(); }
      else if (returnTo === 'follow') { this._advanceFollow(); }
      else if (returnTo === 'action') { this.afterActionToken(pid); }
      else if (returnTo === 'endThinkerQueue') { this._processEndThinkers(); }
    }

    // ================================================================
    //  阶段 3: 动作结算
    // ================================================================
    startActions() {
      const s = this.state;
      s.phase = 'actions';
      // 行动顺序：带头者起，顺时针
      s.order = [];
      for (let k = 0; k < s.nPlayers; k++) s.order.push((s.leaderIndex + k) % s.nPlayers);
      s.oi = 0;
      s.tokens = {};
      // 带头者标记
      s.ledOrFollowed[s.leaderIndex] = true;
      for (const pid of s.order) {
        const toks = [];
        // 基础动作 = 带头/跟随实例数
        let base = 0;
        if (pid === s.leaderIndex) base = s.ledInstances;
        else if (s.played[pid] && s.ledOrFollowed[pid]) base = s.played[pid].instances || 0;
        // 随从动作
        let clients = 0;
        for (const cl of this.P(pid).clientele) {
          if (cl.fresh) continue;
          if (this.clientMatches(pid, cl, s.ledRole)) clients++;
        }
        if (clients > 0 && s.ledOrFollowed[pid] && this.hasPower(pid, 'circusMaximus')) clients *= 2;
        for (let i = 0; i < base + clients; i++) toks.push({ role: s.ledRole });
        s.tokens[pid] = toks;
      }
      this.log(`—— 动作阶段（${CARDS.ROLE_ZH[s.ledRole]}）——`);
      this._gotoActor();
    }

    _gotoActor() {
      const s = this.state;
      while (s.oi < s.order.length) {
        const pid = s.order[s.oi];
        if (s.tokens[pid] && s.tokens[pid].length > 0) { s.current = pid; return; }
        s.oi++;
      }
      this.endTurn();
    }
    // 当前行动者剩余动作
    actorTokens(pid) { return this.state.tokens[pid] || []; }
    currentRole() {
      const t = this.actorTokens(this.state.current);
      return t.length ? t[0].role : null;
    }
    _consumeToken(pid) { return this.state.tokens[pid].shift(); }
    afterActionToken(pid) {
      const s = this.state;
      if (s.over) return;
      // 当前玩家还有 token 则继续；否则下一个
      if (s.current === pid && s.tokens[pid] && s.tokens[pid].length > 0) return;
      s.oi++; this._gotoActor();
    }
    // 玩家主动放弃剩余动作
    endActor() {
      const s = this.state;
      if (s.phase !== 'actions') return this.err('非动作阶段');
      const pid = s.current;
      s.tokens[pid] = [];
      this.log(`${this.P(pid).name} 结束动作。`);
      s.oi++; this._gotoActor();
      return this.ok();
    }
    _pushTokensFront(pid, role, n) {
      const t = this.state.tokens[pid] || (this.state.tokens[pid] = []);
      const add = []; for (let i = 0; i < n; i++) add.push({ role });
      this.state.tokens[pid] = add.concat(t);
    }

    // ---------- LABORER ----------
    doLaborer(opt) {
      const s = this.state, pid = s.current;
      if (this.currentRole() !== 'Laborer') return this.err('当前不是劳工动作');
      opt = opt || {};
      const p = this.P(pid);
      let took = [];
      if (opt.poolIndex != null) {
        const c = s.pool[opt.poolIndex];
        if (c == null) return this.err('供应区无此牌');
        s.pool.splice(opt.poolIndex, 1); p.stockpile.push(c); took.push(c);
      } else if (!this.hasPower(pid, 'dock') || opt.handIndex == null) {
        if (s.pool.length === 0) return this.err('供应区为空');
        return this.err('请从供应区取一张材料');
      }
      // Dock: 额外从手牌取
      if (opt.handIndex != null) {
        if (!this.hasPower(pid, 'dock')) return this.err('你没有 Dock，不能从手牌取材料');
        const c = p.hand[opt.handIndex];
        if (c == null || isJack(c)) return this.err('手牌选择无效');
        p.hand.splice(opt.handIndex, 1); p.stockpile.push(c); took.push(c);
      }
      if (took.length === 0) return this.err('未取任何材料');
      this._consumeToken(pid);
      this.log(`${p.name} 劳工：取 ${took.join('、')} 入库存。`);
      this.afterActionToken(pid);
      return this.ok();
    }

    // ---------- PATRON ----------
    _hireClient(pid, card, src) {
      const p = this.P(pid);
      const client = { name: card, role: roleOf(card), fresh: true };
      p.clientele.push(client);
      this.log(`${p.name} 资助人：从${src}雇佣 ${card}（${client.role}）。`);
      // Bath: 新随从立即行动一次
      if (this.hasPower(pid, 'bath')) {
        this._pushTokensFront(pid, client.role, 1);
        this.log(`  └ Bath：新随从 ${client.role} 立即行动一次。`);
      }
      this.checkForum(pid);
    }
    doPatron(opt) {
      const s = this.state, pid = s.current, p = this.P(pid);
      if (this.currentRole() !== 'Patron') return this.err('当前不是资助人动作');
      opt = opt || {};
      if (p.clientele.length >= this.clienteleLimit(pid)) return this.err('随从已达上限');
      let card, src, primary;
      if (opt.source === 'deck') {
        if (!this.hasPower(pid, 'bar')) return this.err('你没有 Bar');
        const g = this.drawRaw(1); if (!g.length) return this.err('牌库为空'); card = g[0]; src = '牌库'; primary = 'deck';
      } else if (opt.source === 'hand') {
        if (!this.hasPower(pid, 'aqueduct')) return this.err('你没有 Aqueduct');
        card = p.hand[opt.index]; if (card == null || isJack(card)) return this.err('手牌选择无效');
        p.hand.splice(opt.index, 1); src = '手牌'; primary = 'hand';
      } else {
        card = s.pool[opt.index]; if (card == null) return this.err('供应区无此牌');
        s.pool.splice(opt.index, 1); src = '供应区'; primary = 'pool';
      }
      this._consumeToken(pid);
      this._hireClient(pid, card, src);
      if (s.over) return this.ok();
      // Bar(牌库) / Aqueduct(手牌) 的“额外随从”——是同一动作内的附加，而非替代
      const barAvail = this.hasPower(pid, 'bar') && primary !== 'deck';
      const aqAvail = this.hasPower(pid, 'aqueduct') && primary !== 'hand';
      if ((barAvail || aqAvail) && p.clientele.length < this.clienteleLimit(pid)) {
        s.pending = { type: 'patronBonus', pid, barUsed: !barAvail, aqUsed: !aqAvail };
        return this.ok();
      }
      this.afterActionToken(pid);
      return this.ok();
    }
    // opt: {take:'bar'|'aqueduct'|'done', index}
    resolvePatronBonus(opt) {
      const s = this.state, pend = s.pending;
      if (!pend || pend.type !== 'patronBonus') return this.err('无资助人附加待结算');
      const pid = pend.pid, p = this.P(pid); opt = opt || {};
      const room = () => p.clientele.length < this.clienteleLimit(pid);
      if (opt.take === 'bar' && !pend.barUsed && this.hasPower(pid, 'bar') && room()) {
        const g = this.drawRaw(1); if (g.length) this._hireClient(pid, g[0], '牌库(Bar)');
        pend.barUsed = true;
      } else if (opt.take === 'aqueduct' && !pend.aqUsed && this.hasPower(pid, 'aqueduct') && room()) {
        const c = p.hand[opt.index]; if (c == null || isJack(c)) return this.err('手牌选择无效');
        p.hand.splice(opt.index, 1); this._hireClient(pid, c, '手牌(Aqueduct)');
        pend.aqUsed = true;
      } else { // done
        s.pending = null; if (!s.over) this.afterActionToken(pid); return this.ok();
      }
      if (s.over) { s.pending = null; return this.ok(); }
      const more = (!pend.barUsed && this.hasPower(pid, 'bar')) || (!pend.aqUsed && this.hasPower(pid, 'aqueduct'));
      if (!more || !room()) { s.pending = null; this.afterActionToken(pid); }
      return this.ok();
    }

    // ---------- MERCHANT ----------
    doMerchant(opt) {
      const s = this.state, pid = s.current, p = this.P(pid);
      if (this.currentRole() !== 'Merchant') return this.err('当前不是商人动作');
      opt = opt || {};
      if (p.vault.length >= this.vaultLimit(pid)) return this.err('金库已达上限');
      let card, src, primary;
      if (opt.source === 'hand') {
        if (!this.hasPower(pid, 'basilica')) return this.err('你没有 Basilica');
        card = p.hand[opt.index]; if (card == null || isJack(card)) return this.err('手牌选择无效');
        p.hand.splice(opt.index, 1); src = '手牌'; primary = 'hand';
      } else if (opt.source === 'deck') {
        if (!this.hasPower(pid, 'atrium')) return this.err('你没有 Atrium');
        const g = this.drawRaw(1); if (!g.length) return this.err('牌库为空'); card = g[0]; src = '牌库(暗)'; primary = 'deck';
      } else {
        card = p.stockpile[opt.index]; if (card == null) return this.err('库存无此材料');
        p.stockpile.splice(opt.index, 1); src = '库存'; primary = 'stock';
      }
      p.vault.push(card);
      this._consumeToken(pid);
      this.log(`${p.name} 商人：将${src} ${primary === 'deck' ? '一张牌' : card} 存入金库。`);
      // Basilica: 额外从手牌再存1张（“In addition”，非替代）
      if (this.hasPower(pid, 'basilica') && primary !== 'hand' && p.vault.length < this.vaultLimit(pid) && p.hand.some(c => !isJack(c))) {
        this.state.pending = { type: 'basilicaBonus', pid };
        return this.ok();
      }
      this.afterActionToken(pid);
      return this.ok();
    }
    resolveBasilicaBonus(opt) {
      const s = this.state, pend = s.pending;
      if (!pend || pend.type !== 'basilicaBonus') return this.err('无 Basilica 附加待结算');
      const pid = pend.pid, p = this.P(pid); opt = opt || {};
      if (opt.take && p.vault.length < this.vaultLimit(pid)) {
        const c = p.hand[opt.index]; if (c == null || isJack(c)) return this.err('手牌选择无效');
        p.hand.splice(opt.index, 1); p.vault.push(c);
        this.log(`  └ Basilica：从手牌额外存入金库 1 张（隐藏）。`);
      }
      s.pending = null;
      if (!s.over) this.afterActionToken(pid);
      return this.ok();
    }

    // ---------- LEGIONARY ----------
    // opt: {material, coliseum:[{pid,clientIndex}]}
    doLegionary(opt) {
      const s = this.state, pid = s.current, p = this.P(pid);
      if (this.currentRole() !== 'Legionary') return this.err('当前不是军团兵动作');
      opt = opt || {};
      const mat = opt.material;
      if (!MATERIAL_LIST.includes(mat)) return this.err('请指定索取的材料');
      if (!p.hand.some(c => materialOf(c) === mat)) return this.err(`手牌需有 ${mat} 牌以示意索取`);

      const bridge = this.hasPower(pid, 'bridge');
      let taken = [];
      // 供应区
      const pidx = s.pool.findIndex(c => materialOf(c) === mat);
      if (pidx >= 0) { taken.push(s.pool.splice(pidx, 1)[0] + '(供应区)'); p.stockpile.push(taken[taken.length-1].replace('(供应区)','')); }
      // 目标对手
      let targets;
      if (bridge) targets = s.players.filter(q => q.id !== pid);
      else targets = [(pid + 1) % s.nPlayers, (pid - 1 + s.nPlayers) % s.nPlayers]
        .filter((v, i, a) => a.indexOf(v) === i).map(id => s.players[id]);
      for (const t of targets) {
        // Wall 始终免疫；Palisade 免疫(除非 Bridge)
        if (this.hasPower(t.id, 'wall')) { this.log(`  ${t.name} 有 Wall，免疫。`); continue; }
        if (this.hasPower(t.id, 'palisade') && !bridge) { this.log(`  ${t.name} 有 Palisade，免疫。`); continue; }
        const hi = t.hand.findIndex(c => materialOf(c) === mat);
        if (hi >= 0) { const c = t.hand.splice(hi, 1)[0]; p.stockpile.push(c); taken.push(`${c}(${t.name}手牌)`); }
        if (bridge) {
          const si = t.stockpile.findIndex(c => materialOf(c) === mat);
          if (si >= 0) { const c = t.stockpile.splice(si, 1)[0]; p.stockpile.push(c); taken.push(`${c}(${t.name}库存)`); }
        }
      }
      // Coliseum: 抓取对手随从入金库
      if (opt.coliseum && this.hasPower(pid, 'coliseum')) {
        for (const tg of opt.coliseum) {
          if (p.vault.length >= this.vaultLimit(pid)) break;
          const t = this.P(tg.pid); const cl = t.clientele[tg.clientIndex];
          if (!cl) continue;
          if (this.hasPower(tg.pid, 'wall') || this.hasPower(tg.pid, 'palisade')) continue;
          if (cl.role !== mat && roleOf(cl.name) !== this.matRole(mat)) { /* 需匹配角色 */ }
          // 角色需匹配所索取材料对应角色
          if (this.matRole(mat) !== cl.role) continue;
          t.clientele.splice(tg.clientIndex, 1);
          p.vault.push(cl.name);
          taken.push(`${cl.name}(${t.name}随从→金库)`);
        }
      }
      this._consumeToken(pid);
      this.log(`${p.name} 军团兵：索取 ${mat}${bridge ? '(Bridge:全场+库存)' : ''}。获得 ${taken.length ? taken.join('、') : '无'}。`);
      this.afterActionToken(pid);
      return this.ok();
    }
    matRole(mat) { return CARDS.MATERIALS[mat].role; }

    // ---------- 建造 (Craftsman / Architect 共用核心) ----------
    // 奠基
    layFoundation(role, opt) {
      const s = this.state, pid = s.current, p = this.P(pid);
      opt = opt || {};
      const c = p.hand[opt.handIndex];
      if (c == null || isJack(c)) return this.err('请选择手牌中的角色牌作为地基');
      const bd = BY_NAME[c];
      // Statue 可放任意 Site
      let siteMat = bd.material, siteVal = bd.value;
      if (bd.power === 'statue') {
        if (!MATERIAL_LIST.includes(opt.statueSite)) return this.err('Statue 需选择放置的 Site 材料');
        siteMat = opt.statueSite; siteVal = CARDS.MATERIALS[siteMat].value;
      }
      // 不能重名
      if (p.inProgress.some(x => x.name === c) || p.completed.some(x => x.name === c))
        return this.err('你已有同名地基/建筑');
      const site = s.sites[siteMat];
      const outOfTown = !!opt.outOfTown;
      if (outOfTown) {
        if (site.out <= 0) return this.err('该材料无城外 Site');
        const cost = this.hasPower(pid, 'tower') ? 1 : 2;
        if (this.actorTokens(pid).length < cost) return this.err(`城外奠基需 ${cost} 个建造动作`);
      } else {
        if (site.inTown <= 0) return this.err(`该材料无城内 Site（可尝试城外）`);
      }
      // 取走 Site
      if (outOfTown) site.out--; else site.inTown--;
      const struct = {
        id: this._structSeq++, name: c, power: bd.power,
        material: siteMat, value: siteVal, materials: [], outOfTown,
        isStatue: bd.power === 'statue'
      };
      p.hand.splice(opt.handIndex, 1);
      p.inProgress.push(struct);
      // 消耗 token (城外且无Tower=2)
      const cost = outOfTown && !this.hasPower(pid, 'tower') ? 2 : 1;
      for (let i = 0; i < cost; i++) this._consumeToken(pid);
      if (role === 'Craftsman') s.didCraftsman[pid] = true;
      this.log(`${p.name} ${role}：奠基 ${c}（${siteMat} Site，需 ${siteVal} 材料${outOfTown ? '，城外' : ''}）。`);
      // 结束判定：城内 Site 耗尽
      if (!outOfTown && this.inTownTotal() === 0) {
        this.afterActionToken(pid);
        if (!s.over) this.endGame(null, '城内 Site 用尽');
        return this.ok();
      }
      this.afterActionToken(pid);
      return this.ok();
    }

    // 加材料 / 完成
    addMaterial(role, opt) {
      const s = this.state, pid = s.current, p = this.P(pid);
      opt = opt || {};
      const struct = p.inProgress.find(x => x.id === opt.structureId);
      if (!struct) return this.err('未找到目标地基');
      // 取材料来源
      let card, src;
      if (role === 'Craftsman') {
        if (this.hasPower(pid, 'fountain') && opt.fountainCard) {
          card = opt.fountainCard; src = '牌库(Fountain)';
        } else {
          card = p.hand[opt.index]; src = '手牌';
          if (card == null || isJack(card)) return this.err('请选择手牌材料');
        }
      } else { // Architect
        if (opt.source === 'pool') {
          if (!this.hasPower(pid, 'archway')) return this.err('你没有 Archway，不能从供应区取材料');
          card = s.pool[opt.index]; src = '供应区(Archway)';
          if (card == null) return this.err('供应区无此牌');
        } else {
          card = p.stockpile[opt.index]; src = '库存';
          if (card == null) return this.err('库存无此材料');
        }
      }
      const cmat = materialOf(card);
      // 合法性：材料匹配，或 Tower(碎石万用) / Road(石建筑万用) / Scriptorium(大理石完成任意)
      const scriptorium = this.hasPower(pid, 'scriptorium') && cmat === 'Marble';
      let okMat = (cmat === struct.material);
      if (struct.isStatue) okMat = (cmat === struct.material || cmat === 'Marble');
      if (this.hasPower(pid, 'tower') && cmat === 'Rubble') okMat = true;
      if (this.hasPower(pid, 'road') && struct.material === 'Stone') okMat = true;
      if (scriptorium) okMat = true;
      if (!okMat) return this.err(`材料 ${cmat} 与建筑(${struct.material}) 不符`);

      // 取出材料
      if (src.startsWith('手牌')) p.hand.splice(opt.index, 1);
      else if (src.startsWith('库存')) p.stockpile.splice(opt.index, 1);
      else if (src.startsWith('供应区')) s.pool.splice(opt.index, 1);
      // Fountain：从牌库取的牌，未用部分已在 fountain 流程处理
      struct.materials.push(card);
      this._consumeToken(pid);
      if (role === 'Craftsman') s.didCraftsman[pid] = true;

      // 完成判定
      let complete = struct.materials.length >= struct.value;
      if (scriptorium) complete = true;                         // Scriptorium: 一块大理石即可完成
      if (struct.power === 'villa' && role === 'Architect') complete = true; // Villa: 建筑师放1块即完成
      this.log(`${p.name} ${role}：把 ${card}(${src}) 放入 ${struct.name}（${struct.materials.length}/${struct.value}）。`);
      if (complete) this.completeStructure(pid, struct);
      if (s.over) return this.ok();
      this.afterActionToken(pid);
      return this.ok();
    }

    completeStructure(pid, struct) {
      const s = this.state, p = this.P(pid);
      const i = p.inProgress.indexOf(struct);
      if (i >= 0) p.inProgress.splice(i, 1);
      const done = {
        name: struct.name, power: struct.power, material: struct.material,
        value: struct.value, isStatue: struct.isStatue, public: false
      };
      p.completed.push(done);
      p.influence += struct.value;
      this.log(`✦ ${p.name} 完成 ${struct.name}！影响力 +${struct.value} → ${p.influence}。功能：${BY_NAME[struct.name].zh}`);
      // 完成时触发
      const power = struct.power;
      if (power === 'catacomb') { this.afterActionToken(pid); if (!s.over) this.endGame(null, 'Catacomb 完成'); return; }
      if (power === 'amphitheatre') { this._pushTokensFront(pid, 'Craftsman', p.influence); this.log(`  └ Amphitheatre：获得 ${p.influence} 次工匠动作。`); }
      if (power === 'foundry')      { this._pushTokensFront(pid, 'Laborer',   p.influence); this.log(`  └ Foundry：获得 ${p.influence} 次劳工动作。`); }
      if (power === 'garden')       { this._pushTokensFront(pid, 'Patron',    p.influence); this.log(`  └ Garden：获得 ${p.influence} 次资助人动作。`); }
      if (power === 'school')       { this._pushTokensFront(pid, 'Thinker',   p.influence); this.log(`  └ School：获得 ${p.influence} 次思考动作。`); }
      if (power === 'prison')       { s.pending = { type:'prison', pid }; this.log(`  └ Prison：选择要夺取的对手已完成建筑。`); }
      this.checkForum(pid);
    }

    // Prison 结算: opt {targetPid, structIndex} 或 {skip:true}
    resolvePrison(opt) {
      const s = this.state, pend = s.pending;
      if (!pend || pend.type !== 'prison') return this.err('当前无 Prison 待结算');
      const pid = pend.pid, p = this.P(pid);
      opt = opt || {};
      if (!opt.skip) {
        const t = this.P(opt.targetPid);
        const st = t && t.completed[opt.structIndex];
        if (!st) return this.err('目标建筑无效');
        if (st.power === 'prison') { /* 允许偷被偷过的 */ }
        if (p.completed.some(x => x.name === st.name) || p.inProgress.some(x => x.name === st.name))
          return this.err('不能夺取与自己同名的建筑');
        // 转移建筑：连同其影响力(价值)一起移交给夺取者；再支付 3 影响力给原主
        t.completed.splice(opt.structIndex, 1);
        p.completed.push({ ...st, stolen: true });
        t.influence -= st.value; p.influence += st.value;  // 建筑价值随建筑转移
        p.influence -= 3; t.influence += 3;                // Prison 的 3 影响力补偿
        this.log(`${p.name} 用 Prison 夺取 ${t.name} 的 ${st.name}（价值${st.value}随之转移），并支付其 3 影响力。`);
        // 被偷的“完成时”效果对新主触发
        if (st.power === 'catacomb') { s.pending = null; this.afterActionToken(pid); if (!s.over) this.endGame(null,'Catacomb(被夺)'); return this.ok(); }
        this.checkForum(pid);
      } else {
        this.log(`${p.name} 放弃 Prison 夺取。`);
      }
      s.pending = null;
      if (!s.over) this.afterActionToken(pid);
      return this.ok();
    }

    // ---------- Fountain：从牌库抽1张，选择如何使用 ----------
    fountainDraw() {
      const s = this.state, pid = s.current;
      if (this.currentRole() !== 'Craftsman') return this.err('Fountain 仅在工匠动作使用');
      if (!this.hasPower(pid, 'fountain')) return this.err('你没有 Fountain');
      const g = this.drawRaw(1);
      if (!g.length) return this.err('牌库为空');
      s.pending = { type: 'fountain', pid, card: g[0] };
      this.log(`${this.P(pid).name} Fountain：翻出 ${g[0]}，选择用途。`);
      return this.ok();
    }
    // opt: {use:'foundation'|'fill'|'hand', structureId?, statueSite?, outOfTown?}
    resolveFountain(opt) {
      const s = this.state, pend = s.pending;
      if (!pend || pend.type !== 'fountain') return this.err('无 Fountain 待结算');
      const pid = pend.pid, p = this.P(pid), card = pend.card;
      opt = opt || {};
      if (opt.use === 'hand') {
        p.hand.push(card); s.pending = null;
        this._consumeToken(pid);   // 收入手牌也是一次工匠动作（修复：否则可无限抽牌）
        this.log(`  └ 收入手牌（消耗1工匠动作）。`);
        this.afterActionToken(pid); return this.ok();
      }
      // 放回手牌再走正常流程：临时加入手牌末尾再调用
      p.hand.push(card);
      const handIndex = p.hand.length - 1;
      s.pending = null;
      let res;
      if (opt.use === 'foundation') res = this.layFoundation('Craftsman', { handIndex, statueSite: opt.statueSite, outOfTown: opt.outOfTown });
      else res = this.addMaterial('Craftsman', { index: handIndex, structureId: opt.structureId });
      if (!res.ok) { /* 失败则保留在手牌 */ }
      return res;
    }

    // ---------- 思考 token (School/Academy) ----------
    doThinkerToken() {
      const s = this.state, pid = s.current;
      if (this.currentRole() !== 'Thinker') return this.err('当前不是思考动作');
      this._consumeToken(pid);
      this.beginThinker(pid, 'action');
      return this.ok();
    }

    // ---------- Stairway：把材料加入对手已完成建筑使其公开 ----------
    // opt: {targetPid, structIndex, source:'stockpile'|'pool', index}
    doStairway(opt) {
      const s = this.state, pid = s.current, p = this.P(pid);
      if (this.currentRole() !== 'Architect') return this.err('Stairway 仅在建筑师动作使用');
      if (!this.hasPower(pid, 'stairway')) return this.err('你没有 Stairway');
      const t = this.P(opt.targetPid); const st = t && t.completed[opt.structIndex];
      if (!st) return this.err('目标建筑无效');
      let card;
      if (opt.source === 'pool') { card = s.pool[opt.index]; if (card == null) return this.err('供应区无此牌'); }
      else { card = p.stockpile[opt.index]; if (card == null) return this.err('库存无此材料'); }
      if (materialOf(card) !== st.material) return this.err('材料需与该建筑一致');
      if (opt.source === 'pool') s.pool.splice(opt.index, 1); else p.stockpile.splice(opt.index, 1);
      st.public = true;
      s.publicPowers.add(st.power);
      // Stairway 是“额外动作”，不消耗建筑师动作（修复：原先错误地消耗了token）
      this.log(`${p.name} Stairway：向 ${t.name} 的 ${st.name} 加材料，使其功能对所有玩家开放（额外动作，不耗动作点）。`);
      this.afterActionToken(pid);
      return this.ok();
    }

    // ================================================================
    //  回合结束
    // ================================================================
    endTurn() {
      const s = this.state;
      if (s.over) return;
      // 回收带头/跟随的牌：Jack 回堆 (Senate 可截留)，角色牌入供应区 (Sewer 可入库存)
      const senateOwners = s.order.filter(pid => this.hasPower(pid, 'senate'));
      for (const pid of s.order) {
        const rec = s.played[pid]; if (!rec) continue;
        // 角色牌
        for (const c of rec.cards) {
          if (this.hasPower(pid, 'sewer')) { this.P(pid).stockpile.push(c); }
          else s.pool.push(c);
        }
        // jacks
        for (let j = 0; j < rec.jacks; j++) {
          // 对手的 Senate 可收走
          const taker = senateOwners.find(o => o !== pid);
          if (taker != null) { this.P(taker).hand.push('Jack'); this.log(`${this.P(taker).name} 用 Senate 收走 ${this.P(pid).name} 的 Jack。`); }
          else s.jackPile++;
        }
      }
      if (this.state.players.some((p,i)=>this.hasPower(i,'sewer'))) this.log(`（Sewer：相关玩家把带头/跟随牌收入库存）`);
      // 清空本回合出牌记录
      s.played = {};
      // 清除随从 fresh
      for (const p of s.players) p.clientele.forEach(c => c.fresh = false);

      // Academy：执行过工匠的玩家可在回合末额外思考
      s.endThinkerQueue = s.order.filter(pid => s.didCraftsman[pid] && this.hasPower(pid, 'academy'));
      s.didCraftsman = {};
      s.ledOrFollowed = {};
      this._processEndThinkers();
    }
    _processEndThinkers() {
      const s = this.state;
      if (s.over) return;
      if (s.endThinkerQueue && s.endThinkerQueue.length) {
        const pid = s.endThinkerQueue.shift();
        this.log(`${this.P(pid).name} 的 Academy：回合末额外思考一次。`);
        this.beginThinker(pid, 'endThinkerQueue');
        return;
      }
      this._passLeader();
    }
    _passLeader() {
      const s = this.state;
      if (s.over) return;
      s.leaderIndex = (s.leaderIndex + 1) % s.nPlayers;
      s.turnNo++;
      s.phase = 'lead';
      s.ledRole = null; s.ledInstances = 0;
      s.order = []; s.oi = 0; s.tokens = {};
      s.current = s.leaderIndex;
      this.log(`—— 第 ${s.turnNo} 回合：${this.P(s.leaderIndex).name} 带头 ——`);
    }

    surrender(toPid) {
      this.instantWin(toPid, '其他玩家投降');
      return this.ok();
    }

    // ================================================================
    //  计分
    // ================================================================
    scoreAll() {
      const s = this.state;
      // 商人奖励：每种材料金库中最多者 +3 (平手不给)
      const bonusOwner = {};
      for (const m of MATERIAL_LIST) {
        let best = -1, owner = -1, tie = false;
        s.players.forEach((p) => {
          const cnt = p.vault.filter(c => materialOf(c) === m).length;
          if (cnt > best) { best = cnt; owner = p.id; tie = false; }
          else if (cnt === best && best > 0) tie = true;
        });
        bonusOwner[m] = (best > 0 && !tie) ? owner : -1;
      }
      return s.players.map(p => {
        const infl = p.influence;
        const vaultVP = p.vault.reduce((a, c) => a + valueOf(c), 0);
        let bonus = 0; for (const m of MATERIAL_LIST) if (bonusOwner[m] === p.id) bonus += 3;
        let structVP = 0;
        p.completed.forEach(st => {
          if (st.power === 'statue') structVP += 3;
          if (st.power === 'wall') structVP += Math.floor(p.stockpile.length / 2);
        });
        const total = infl + vaultVP + bonus + structVP;
        return { id: p.id, name: p.name, influence: infl, vault: vaultVP, merchantBonus: bonus, structureVP: structVP, total };
      });
    }

    // ---------- 返回辅助 ----------
    ok(extra) { return Object.assign({ ok: true }, extra || {}); }
    err(msg) { return { ok: false, error: msg }; }
  }

  const ENGINE = { Game, makeRng, shuffle };
  global.GTR_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
