/* 引擎冒烟测试 (Node) */
const { Game } = require('./engine.js');
const CARDS = require('./cards.js');

let pass = 0, fail = 0;
function check(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL:', msg); } }
function section(t){ console.log('\n=== ' + t + ' ==='); }

// 用固定种子，便于复现
function newGame(n, seed) {
  const names = ['A','B','C','D','E'].slice(0, n);
  return new Game(names, { seed: seed || 12345 });
}

// ---- 1. 初始化 ----
section('初始化');
let g = newGame(3, 7);
check(g.state.players.length === 3, '3 名玩家');
check(g.state.players.every(p => p.hand.length === 5), '每人 5 张手牌');
check(g.state.pool.length === 3, '供应区 3 张 (起始)');
check(g.state.deck.length === 144 - 3*5 - 3, '牌库剩余正确: ' + g.state.deck.length);
check(g.state.jackPile === 6, 'Jack 堆 6');
check(g.state.players.every(p => p.influence === 2), '初始影响力 2');
MaterialsOK(g);
function MaterialsOK(g){
  const s = g.state;
  let ok = true;
  for (const m of CARDS.MATERIAL_LIST) if (s.sites[m].inTown !== 3 || s.sites[m].out !== 3) ok = false;
  check(ok, '场地: 城内3/城外3 (3人)');
}

// ---- 2. 一个完整劳工回合 ----
section('劳工回合');
g = newGame(2, 99);
// 给 leader 手里塞一张已知 Laborer 牌 (Rubble = Bar/Insula/Latrine/Road)
let lead = g.state.leaderIndex;
g.P(lead).hand = ['Bar','Insula','Latrine','Road','Market']; // Market=Wood/Craftsman
// 供应区放一张材料供取用
g.state.pool = ['Dock','Circus']; // Wood 材料
let before = g.P(lead).stockpile.length;
let r = g.leaderLead({ kind:'card', index:0 }); // 带头 Bar (Laborer)
check(r.ok, '带头劳工: ' + (r.error||''));
check(g.state.phase === 'follow', '进入跟随阶段');
// 对手思考(补牌)
let opp = g.state.current;
r = g.followThink();
check(g.state.pending && g.state.pending.type==='thinker', '对手进入思考结算');
r = g.resolveThinker({ choice:'refill' });
check(r.ok, '思考补牌: ' + (r.error||''));
check(g.state.phase === 'actions', '思考后进入动作阶段');
// leader 做劳工动作: 从供应区取一张
check(g.currentRole()==='Laborer', '当前为劳工动作 (leader)');
r = g.doLaborer({ poolIndex: 0 });
check(r.ok, '劳工取牌: ' + (r.error||''));
check(g.P(lead).stockpile.length === before + 1, '库存 +1');

// ---- 3. 建造流程 (工匠: 奠基→加料→完成 价值1 Wood) ----
section('建造流程 (工匠完成 Palisade)');
g = newGame(2, 5);
lead = g.state.leaderIndex;
g.P(lead).hand = ['Palisade','Palisade','Market','Bar','Insula']; // 两张 Palisade (Wood/Craftsman, value1)
g.state.pool = [];
r = g.leaderLead({ kind:'card', index:0 }); // 带头工匠, 打出1张 Palisade
check(r.ok, '带头工匠: ' + (r.error||''));
opp = g.state.current; g.followThink(); g.resolveThinker({ choice:'draw1' });
check(g.currentRole()==='Craftsman','当前工匠动作');
// 奠基 Palisade (手里还剩一张 Palisade idx? 手牌现为 [Palisade,Market,Bar,Insula])
let hi = g.P(lead).hand.indexOf('Palisade');
r = g.layFoundation('Craftsman', { handIndex: hi });
check(r.ok, '奠基 Palisade: ' + (r.error||''));
check(g.P(lead).inProgress.length === 1, '有1个在建');
check(g.state.sites['Wood'].inTown === 1, 'Wood 城内 Site -1');
// 还有 token? 工匠只有1个base动作, 已用. 应进入对手或结束
// 重新构造: 给足动作来加料并完成
g = newGame(2, 5);
lead = g.state.leaderIndex;
// 给 leader 一个工匠随从, 这样有2个工匠动作
g.P(lead).clientele = [{name:'Market', role:'Craftsman', fresh:false}];
g.P(lead).hand = ['Palisade','Dock','Bar','Insula','Market'];
g.state.pool = [];
r = g.leaderLead({ kind:'card', index:1 }); // 带头工匠 (Dock=Wood/Craftsman)
check(r.ok, '带头工匠(有随从): ' + (r.error||''));
opp = g.state.current; g.followThink(); g.resolveThinker({ choice:'draw1' });
check(g.actorTokens(lead).length === 2, '工匠动作=2 (带头+随从): ' + g.actorTokens(lead).length);
hi = g.P(lead).hand.indexOf('Palisade');
r = g.layFoundation('Craftsman', { handIndex: hi }); check(r.ok, '奠基: '+(r.error||''));
// 加一张 Wood 材料完成 (Palisade value1). 手里需要 Wood 牌
let woodIdx = g.P(lead).hand.findIndex(c => CARDS.materialOf ? false : CARDS.BY_NAME[c] && CARDS.BY_NAME[c].material==='Wood');
// 手牌: 现为 [Dock 已打出? ] 重新取
let st = g.P(lead).inProgress[0];
// 确保手里有 Wood 材料: 直接塞一张
g.P(lead).hand.push('Market'); // Wood
woodIdx = g.P(lead).hand.lastIndexOf('Market');
r = g.addMaterial('Craftsman', { index: woodIdx, structureId: st.id });
check(r.ok, '加料并完成: ' + (r.error||''));
check(g.P(lead).completed.length === 1, '已完成1建筑');
check(g.P(lead).influence === 3, '影响力 2→3 (Wood value1): ' + g.P(lead).influence);
check(g.hasPower(lead,'palisade'), 'Palisade 功能生效');

// ---- 4. 影响力/上限 ----
section('上限计算');
g = newGame(2, 1);
let p0 = g.P(0);
p0.influence = 4;
p0.completed = [{name:'Insula',power:'insula',material:'Rubble',value:1}];
check(g.clienteleLimit(0) === 6, 'Insula: 随从上限 4+2=6: ' + g.clienteleLimit(0));
p0.completed.push({name:'Aqueduct',power:'aqueduct',material:'Concrete',value:2});
check(g.clienteleLimit(0) === 12, 'Aqueduct: (4+2)*2=12: ' + g.clienteleLimit(0));
p0.completed.push({name:'Market',power:'market',material:'Wood',value:1});
check(g.vaultLimit(0) === 6, 'Market: 金库 4+2=6: ' + g.vaultLimit(0));
p0.completed.push({name:'Temple',power:'temple',material:'Marble',value:3});
check(g.handLimit(0) === 9, 'Temple: 手牌上限 5+4=9: ' + g.handLimit(0));

// ---- 5. 计分 ----
section('计分');
g = newGame(2, 1);
p0 = g.P(0);
p0.influence = 5;
p0.vault = ['Catacomb','Garden']; // 2张 Stone value3 → 6
p0.completed = [{name:'Statue',power:'statue',material:'Brick',value:2,isStatue:true}];
p0.stockpile = ['Bar','Insula','Latrine']; // 3张
let sc = g.scoreAll();
check(sc[0].influence === 5, '影响力分 5');
check(sc[0].vault === 6, '金库分 6: ' + sc[0].vault);
check(sc[0].structureVP === 3, 'Statue +3: ' + sc[0].structureVP);
check(sc[0].merchantBonus === 3, '商人奖励(石料最多) +3: ' + sc[0].merchantBonus);
check(sc[0].total === 17, '总分 5+6+3+3=17: ' + sc[0].total);

// ---- 6. Forum 即时获胜 ----
section('Forum 即时获胜');
g = newGame(2, 1);
p0 = g.P(0);
p0.completed = [{name:'Forum',power:'forum',material:'Marble',value:3}];
p0.clientele = CARDS.ROLE_LIST.map(role => ({name:'x', role, fresh:false}));
g.checkForum(0);
check(g.state.over && g.state.over.winner === 0, 'Forum: 集齐每角色随从获胜');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
