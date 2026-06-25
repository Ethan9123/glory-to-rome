/* 回归测试：审计确认的 5 个修复 */
const { Game } = require('./engine.js');
const CARDS = require('./cards.js');
let pass = 0, fail = 0;
function check(c, m) { if (c) pass++; else { fail++; console.log('  ✗', m); } }
function sec(t){ console.log('\n=== '+t+' ==='); }

function rig(role, n=2, seed=3) {
  const g = new Game(['A','B','C'].slice(0,n), {seed});
  const s = g.state; s.phase='actions'; s.ledRole=role;
  s.order=[]; for(let k=0;k<n;k++) s.order.push(k); s.oi=0; s.current=0;
  s.tokens={}; for(let k=0;k<n;k++) s.tokens[k]=[];
  return g;
}
function tok(g,pid,role,k){ for(let i=0;i<k;i++) g.state.tokens[pid].push({role}); g.state.current=pid; g.state.oi=g.state.order.indexOf(pid); }

// ---- Bar: 池+牌库 两个随从 (1动作) ----
sec('Bar 额外随从');
let g = rig('Patron'); let p=g.P(0); p.influence=5;
p.completed=[{name:'Bar',power:'bar',material:'Rubble',value:1}];
g.state.pool=['Insula']; // 1池随从
g.state.deck.push('Market'); // 确保牌库有牌
tok(g,0,'Patron',1);
let r=g.doPatron({index:0}); // 从池雇1
check(r.ok,'Bar: 从池雇佣: '+(r.error||''));
check(g.state.pending && g.state.pending.type==='patronBonus','Bar: 触发附加待结算');
let before=p.clientele.length;
r=g.resolvePatronBonus({take:'bar'}); // 牌库额外1
check(p.clientele.length===before+1,'Bar: 额外牌库随从 (共2个/1动作): '+p.clientele.length);
check(g.actorTokens(0).length===0,'Bar: 仍只消耗1动作');

// ---- Aqueduct: 池+手牌 两个随从 (1动作) ----
sec('Aqueduct 额外随从');
g = rig('Patron'); p=g.P(0); p.influence=6;
p.completed=[{name:'Aqueduct',power:'aqueduct',material:'Concrete',value:2}];
g.state.pool=['Insula']; p.hand=['Market','Dock'];
tok(g,0,'Patron',1);
r=g.doPatron({index:0}); check(r.ok && g.state.pending.type==='patronBonus','Aqueduct: 触发附加');
r=g.resolvePatronBonus({take:'aqueduct', index:0});
check(p.clientele.length===2,'Aqueduct: 池+手牌共2随从/1动作: '+p.clientele.length);
check(p.hand.length===1,'Aqueduct: 手牌-1');

// ---- Basilica: 库存+手牌 两张入金库 (1动作) ----
sec('Basilica 额外入库');
g = rig('Merchant'); p=g.P(0); p.influence=5;
p.completed=[{name:'Basilica',power:'basilica',material:'Marble',value:3}];
p.stockpile=['Catacomb']; p.hand=['Garden','Villa']; // Stone材料
tok(g,0,'Merchant',1);
r=g.doMerchant({index:0}); // 库存→金库
check(r.ok && g.state.pending && g.state.pending.type==='basilicaBonus','Basilica: 触发附加');
r=g.resolveBasilicaBonus({take:true, index:0});
check(p.vault.length===2,'Basilica: 库存+手牌共2张入金库/1动作: '+p.vault.length);
check(g.actorTokens(0).length===0,'Basilica: 仍只消耗1动作');

// ---- Stairway: 免费额外动作 (不消耗token) ----
sec('Stairway 免费动作');
g = rig('Architect'); p=g.P(0); p.influence=5;
p.completed=[{name:'Stairway',power:'stairway',material:'Marble',value:3}];
p.stockpile=['School']; // Brick 材料
let t=g.P(1); t.completed=[{name:'Archway',power:'archway',material:'Brick',value:2}]; // 对手已完成 Brick 建筑
tok(g,0,'Architect',2);
let toksBefore=g.actorTokens(0).length;
r=g.doStairway({targetPid:1, structIndex:0, source:'stockpile', index:0});
check(r.ok,'Stairway 执行: '+(r.error||''));
check(g.actorTokens(0).length===toksBefore,'Stairway: 不消耗动作 ('+toksBefore+'→'+g.actorTokens(0).length+')');
check(g.state.publicPowers.has('archway'),'Stairway: archway 功能公开');
check(g.hasPower(0,'archway'),'Stairway: 自己也获得公开功能');

// ---- Fountain: 收入手牌消耗1动作 (防无限抽) ----
sec('Fountain 消耗动作');
g = rig('Craftsman'); p=g.P(0); p.influence=5;
p.completed=[{name:'Fountain',power:'fountain',material:'Marble',value:3}];
tok(g,0,'Craftsman',1);
r=g.fountainDraw(); check(r.ok && g.state.pending.type==='fountain','Fountain 翻牌');
r=g.resolveFountain({use:'hand'});
check(g.actorTokens(0).length===0,'Fountain: 收入手牌消耗了1工匠动作: '+g.actorTokens(0).length);

// ---- Prison: 建筑价值随之转移 ----
sec('Prison 价值转移');
g = rig('Craftsman',2,9); p=g.P(0); let v=g.P(1);
// 受害者已完成一个 Wall(价值2), 影响力含其值
v.influence=4; v.completed=[{name:'Wall',power:'wall',material:'Concrete',value:2}];
// 夺取者完成 Prison
p.influence=5;
g.state.pending={type:'prison', pid:0};
let pInflBefore=p.influence, vInflBefore=v.influence;
r=g.resolvePrison({targetPid:1, structIndex:0});
check(r.ok,'Prison 夺取: '+(r.error||''));
// 夺取者: +价值2 -3 = -1 ; 受害者: -价值2 +3 = +1
check(p.influence===pInflBefore+2-3,'Prison: 夺取者影响力 +价值2-3: '+pInflBefore+'→'+p.influence);
check(v.influence===vInflBefore-2+3,'Prison: 受害者影响力 -价值2+3: '+vInflBefore+'→'+v.influence);
check(g.hasPower(0,'wall') && !g.hasPower(1,'wall'),'Prison: Wall 功能转移给夺取者');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
