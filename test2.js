/* 深度测试：角色动作 + 建筑功能 */
const { Game } = require('./engine.js');
const CARDS = require('./cards.js');
let pass = 0, fail = 0;
function check(c, m) { if (c) pass++; else { fail++; console.log('  ✗', m); } }
function sec(t){ console.log('\n=== '+t+' ==='); }

// 工具：构造一个处于“动作阶段、指定角色 token”的局面，单人专注测试
function rig(role, n=2, seed=3) {
  const g = new Game(['A','B','C','D','E'].slice(0,n), {seed});
  const s = g.state;
  s.phase = 'actions';
  s.ledRole = role;
  s.order = []; for (let k=0;k<n;k++) s.order.push(k);
  s.oi = 0; s.current = 0;
  s.tokens = {}; for (let k=0;k<n;k++) s.tokens[k] = [];
  return g;
}
function giveTokens(g, pid, role, k){ for(let i=0;i<k;i++) g.state.tokens[pid].push({role}); g.state.current=pid; g.state.oi=g.state.order.indexOf(pid); }

// ---- Patron + Bath ----
sec('Patron / 上限 / Bath');
let g = rig('Patron');
let p=g.P(0); p.influence=3;
g.state.pool=['Insula','Market','Catacomb']; // 随从候选
giveTokens(g,0,'Patron',2); // 给2个token, 检查时回合未结束
let r=g.doPatron({index:0});
check(r.ok && p.clientele.length===1, 'Patron 从供应区雇佣: '+(r.error||''));
check(p.clientele[0].fresh===true, '新随从标记 fresh (回合内)');
// Bath: 完成 Bath, 雇佣随从立即行动
g = rig('Patron'); p=g.P(0); p.influence=4;
p.completed=[{name:'Bath',power:'bath',material:'Brick',value:2}];
g.state.pool=['Dock']; // Dock=Wood/Craftsman 随从
giveTokens(g,0,'Patron',1);
r=g.doPatron({index:0});
check(r.ok, 'Bath: 雇佣 craftsman: '+(r.error||''));
check(g.currentRole()==='Craftsman', 'Bath: 新随从(Craftsman)立即获得动作 token: '+g.currentRole());

// ---- Merchant + 上限 + Basilica ----
sec('Merchant / Vault 上限 / Basilica');
g = rig('Merchant'); p=g.P(0); p.influence=2; p.stockpile=['Bar','Insula','Latrine'];
giveTokens(g,0,'Merchant',3);
r=g.doMerchant({index:0}); check(r.ok && p.vault.length===1,'存1材料: '+(r.error||''));
r=g.doMerchant({index:0}); check(r.ok && p.vault.length===2,'存2材料');
r=g.doMerchant({index:0}); check(!r.ok,'金库满(上限2)应拒绝: '+(r.ok?'但通过了':''));

// ---- Legionary + Palisade/Wall/Bridge ----
sec('Legionary / 免疫 / Bridge');
g = rig('Legionary',3,11); p=g.P(0);
p.hand=['Insula']; // Rubble 牌, 索取 Rubble
g.P(1).hand=['Bar','Road']; // 邻居有 Rubble
g.P(2).hand=['Latrine'];    // 邻居有 Rubble
g.state.pool=['Road'];      // 供应区有 Rubble
giveTokens(g,0,'Legionary',1);
r=g.doLegionary({material:'Rubble'});
check(r.ok,'军团兵索取: '+(r.error||''));
check(p.stockpile.length===3,'从供应区+左右邻居各拿1 Rubble (共3): '+p.stockpile.length);
// Palisade 免疫
g = rig('Legionary',2,11); p=g.P(0); p.hand=['Insula'];
g.P(1).hand=['Bar']; g.P(1).completed=[{name:'Palisade',power:'palisade',material:'Wood',value:1}];
g.state.pool=[];
giveTokens(g,0,'Legionary',1);
r=g.doLegionary({material:'Rubble'});
check(p.stockpile.length===0,'Palisade 对手免疫，未拿到: '+p.stockpile.length);
// Bridge 无视 Palisade 且取库存
g = rig('Legionary',2,11); p=g.P(0); p.hand=['Insula'];
p.completed=[{name:'Bridge',power:'bridge',material:'Concrete',value:2}];
g.P(1).hand=['Bar']; g.P(1).stockpile=['Road']; g.P(1).completed=[{name:'Palisade',power:'palisade',material:'Wood',value:1}];
giveTokens(g,0,'Legionary',1);
r=g.doLegionary({material:'Rubble'});
check(p.stockpile.length===2,'Bridge 无视 Palisade 取手牌+库存 (共2): '+p.stockpile.length);
// Wall 即使 Bridge 也免疫
g = rig('Legionary',2,11); p=g.P(0); p.hand=['Insula'];
p.completed=[{name:'Bridge',power:'bridge',material:'Concrete',value:2}];
g.P(1).hand=['Bar']; g.P(1).completed=[{name:'Wall',power:'wall',material:'Concrete',value:2}];
giveTokens(g,0,'Legionary',1);
r=g.doLegionary({material:'Rubble'});
check(p.stockpile.length===0,'Wall 即使面对 Bridge 也免疫: '+p.stockpile.length);

// ---- Architect build from stockpile + Archway from pool ----
sec('Architect 建造 / Archway');
g = rig('Architect'); p=g.P(0);
p.hand=['Wall'];           // Concrete value2 地基
p.stockpile=['Senate','Tower']; // 2 Concrete 材料
giveTokens(g,0,'Architect',3);
r=g.layFoundation('Architect',{handIndex:0}); check(r.ok,'奠基 Wall: '+(r.error||''));
let st=p.inProgress[0];
r=g.addMaterial('Architect',{index:0,structureId:st.id,source:'stockpile'}); check(r.ok && st.materials.length===1,'加1 Concrete');
r=g.addMaterial('Architect',{index:0,structureId:st.id,source:'stockpile'}); check(r.ok,'加2 Concrete并完成');
check(p.completed.some(x=>x.name==='Wall'),'Wall 完成');
check(p.influence===4,'影响力 2→4 (Concrete value2): '+p.influence);
// Archway: 从供应区取材料
g = rig('Architect'); p=g.P(0);
p.completed=[{name:'Archway',power:'archway',material:'Brick',value:2}]; p.influence=4;
p.hand=['Latrine'];   // Rubble value1 地基
g.state.pool=['Bar']; // Rubble 材料在供应区
giveTokens(g,0,'Architect',2);
r=g.layFoundation('Architect',{handIndex:0}); check(r.ok,'奠基 Latrine(Rubble): '+(r.error||''));
st=p.inProgress[0];
r=g.addMaterial('Architect',{index:0,structureId:st.id,source:'pool'}); check(r.ok && p.completed.some(x=>x.name==='Latrine'),'Archway 从供应区取材料完成: '+(r.error||''));

// ---- 城外奠基 (2 动作) ----
sec('城外奠基');
g = rig('Craftsman'); p=g.P(0);
p.hand=['Palisade']; // Wood
g.state.sites['Wood'].inTown=0; g.state.sites['Wood'].out=2;
giveTokens(g,0,'Craftsman',2);
r=g.layFoundation('Craftsman',{handIndex:0,outOfTown:true});
check(r.ok,'城外奠基消耗2动作: '+(r.error||''));
check(g.actorTokens(0).length===0,'2个token已消耗: '+g.actorTokens(0).length);
// Tower: 城外仅1动作
g = rig('Craftsman'); p=g.P(0);
p.completed=[{name:'Tower',power:'tower',material:'Concrete',value:2}]; p.influence=4;
p.hand=['Palisade']; g.state.sites['Wood'].inTown=0; g.state.sites['Wood'].out=2;
giveTokens(g,0,'Craftsman',2);
r=g.layFoundation('Craftsman',{handIndex:0,outOfTown:true});
check(r.ok && g.actorTokens(0).length===1,'Tower: 城外仅1动作: '+(r.error||'')+' 剩'+g.actorTokens(0).length);

// ---- 完成时奖励：Foundry/School/Garden/Amphitheatre ----
sec('完成时奖励动作');
g = rig('Craftsman'); p=g.P(0); p.influence=2;
p.hand=['Foundry','Senate','Tower']; // Foundry=Brick value2
// 直接造好 Foundry: 给材料
p.hand.push('Academy','Archway'); // Brick 材料
giveTokens(g,0,'Craftsman',5);
r=g.layFoundation('Craftsman',{handIndex:p.hand.indexOf('Foundry')}); check(r.ok,'奠基 Foundry: '+(r.error||''));
st=p.inProgress[0];
let bi=p.hand.findIndex(c=>CARDS.BY_NAME[c].material==='Brick');
r=g.addMaterial('Craftsman',{index:bi,structureId:st.id}); check(r.ok,'加 Brick1');
bi=p.hand.findIndex(c=>CARDS.BY_NAME[c].material==='Brick');
r=g.addMaterial('Craftsman',{index:bi,structureId:st.id}); check(r.ok,'加 Brick2 完成 Foundry');
check(p.influence===4,'Foundry 完成影响力4');
// 完成后应获得 4 个 Laborer token (插到队首)
let labTokens = g.state.tokens[0].filter(t=>t.role==='Laborer').length;
check(labTokens===4,'Foundry: 获得4个劳工动作: '+labTokens);

// ---- Catacomb 结束 ----
sec('Catacomb 结束游戏');
g = rig('Craftsman'); p=g.P(0); p.influence=2;
p.hand=['Catacomb','Sewer','Villa','Prison']; // Catacomb=Stone value3, Stone材料
giveTokens(g,0,'Craftsman',5);
r=g.layFoundation('Craftsman',{handIndex:0}); st=p.inProgress[0];
let si=p.hand.findIndex(c=>CARDS.BY_NAME[c].material==='Stone');
g.addMaterial('Craftsman',{index:si,structureId:st.id});
si=p.hand.findIndex(c=>CARDS.BY_NAME[c].material==='Stone');
g.addMaterial('Craftsman',{index:si,structureId:st.id});
si=p.hand.findIndex(c=>CARDS.BY_NAME[c].material==='Stone');
r=g.addMaterial('Craftsman',{index:si,structureId:st.id});
check(g.state.over && g.state.over.reason.includes('Catacomb'),'Catacomb 完成→游戏结束: '+(g.state.over?g.state.over.reason:'未结束'));

// ---- Scriptorium: 1 Marble 完成任意 ----
sec('Scriptorium / Road / Statue');
g = rig('Craftsman'); p=g.P(0); p.influence=5;
p.completed=[{name:'Scriptorium',power:'scriptorium',material:'Stone',value:3}];
p.hand=['Catacomb','Temple']; // Catacomb=Stone value3 地基; Temple=Marble 材料
giveTokens(g,0,'Craftsman',2);
r=g.layFoundation('Craftsman',{handIndex:0}); st=p.inProgress[0];
r=g.addMaterial('Craftsman',{index:p.hand.indexOf('Temple'),structureId:st.id});
check(p.completed.some(x=>x.name==='Catacomb'),'Scriptorium: 1 Marble 完成 value3 建筑: '+(r.error||''));
// Statue 任意 site + 计分
g = rig('Architect'); p=g.P(0); p.influence=2;
p.hand=['Statue','Latrine']; // Statue=Marble; 放到 Rubble site(value1)
p.stockpile=['Bar']; // Rubble 材料
giveTokens(g,0,'Architect',2);
r=g.layFoundation('Architect',{handIndex:0,statueSite:'Rubble'}); check(r.ok,'Statue 放 Rubble Site: '+(r.error||''));
st=p.inProgress[0]; check(st.value===1,'Statue site value=1');
r=g.addMaterial('Architect',{index:0,structureId:st.id,source:'stockpile'});
check(p.completed.some(x=>x.name==='Statue'),'Statue 用1 Rubble完成');
let sc=g.scoreAll(); check(sc[0].structureVP>=3,'Statue +3 VP: '+sc[0].structureVP);

// ---- Circus Maximus 随从翻倍 ----
sec('Circus Maximus 随从动作翻倍');
g = new Game(['A','B'],{seed:4});
g.P(0).completed=[{name:'Circus Maximus',power:'circusMaximus',material:'Stone',value:3}];
g.P(0).influence=5;
g.P(0).clientele=[{name:'Bar',role:'Laborer',fresh:false},{name:'Insula',role:'Laborer',fresh:false}];
g.P(0).hand=['Insula','Bar','Latrine','Road','Market']; // 带头 Laborer
g.state.leaderIndex=0; g.state.current=0; g.state.phase='lead';
r=g.leaderLead({kind:'card',index:0}); // 带头劳工
// 对手思考
g.followThink(); g.resolveThinker({choice:'draw1'});
// leader: base1 + clients2 *2(circus maximus) = 5
check(g.actorTokens(0).length===5,'Circus Maximus: 1带头+2随从×2=5动作: '+g.actorTokens(0).length);

// ---- 商人奖励平手不给 ----
sec('计分: 商人奖励平手');
g = new Game(['A','B'],{seed:1});
g.P(0).vault=['Catacomb']; g.P(1).vault=['Garden']; // 各1 Stone, 平手
sc=g.scoreAll();
check(sc[0].merchantBonus===0 && sc[1].merchantBonus===0,'石料平手→无人得奖励');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
