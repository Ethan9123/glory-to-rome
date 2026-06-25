/* ===================================================================
   Glory to Rome — 卡牌数据库 (核心40建筑 + 场地 + Jack)
   数据来源：GtR_cards.xls / 参考卡 / 黑盒版规则书附录
   每张 Order 牌由其“材料(material)”决定：角色(role)、价值(value)、颜色
   =================================================================== */
(function (global) {
  'use strict';

  // 材料 → { value(完成所需材料数 / 售卖价值), role(角色), zh(中文名), color(配色) }
  const MATERIALS = {
    Rubble:   { value: 1, role: 'Laborer',   zh: '碎石', color: '#d8a23a', text: '#3a2c08' },
    Wood:     { value: 1, role: 'Craftsman', zh: '木材', color: '#4a9d5b', text: '#0c2a13' },
    Concrete: { value: 2, role: 'Architect', zh: '混凝土', color: '#9aa0a6', text: '#1c2024' },
    Brick:    { value: 2, role: 'Legionary', zh: '砖块', color: '#cf4b3a', text: '#3a0d08' },
    Stone:    { value: 3, role: 'Merchant',  zh: '石料', color: '#3b7dd8', text: '#06203f' },
    Marble:   { value: 3, role: 'Patron',    zh: '大理石', color: '#9c5cc4', text: '#270d36' }
  };

  // 角色中文名
  const ROLE_ZH = {
    Thinker:   '思考者',
    Laborer:   '劳工',
    Craftsman: '工匠',
    Architect: '建筑师',
    Legionary: '军团兵',
    Merchant:  '商人',
    Patron:    '资助人'
  };

  /* 每个建筑：
     name   : 英文卡名 (界面保留英文)
     material: 材料 (决定 role / value / color)
     copies : 牌库中的份数
     power  : 功能ID (引擎据此实现)
     timing : 触发时机 (completion=完成时, passive=被动, action=动作时, end=回合结束, scoring=计分)
     zh     : 中文功能说明
     en     : 英文功能说明 (原卡文字)            */
  const BUILDINGS = [
    /* ---------- Laborer / Rubble (价值1, 每种6份) ---------- */
    { name:'Bar',      material:'Rubble', copies:6, power:'bar',      timing:'action',
      zh:'执行 PATRON 时，可改为从牌库抽 1 张作为随从（无需从供应区取）。',
      en:'When performing PATRON action may take card from DECK.' },
    { name:'Insula',   material:'Rubble', copies:6, power:'insula',   timing:'passive',
      zh:'随从(Clientele)上限 +2。',
      en:'Maximum CLIENTELE + 2.' },
    { name:'Latrine',  material:'Rubble', copies:6, power:'latrine',  timing:'action',
      zh:'执行 THINKER 前，可弃 1 张手牌到供应区(Pool)。',
      en:'Before performing THINKER action may discard one card to POOL.' },
    { name:'Road',     material:'Rubble', copies:6, power:'road',     timing:'passive',
      zh:'建造 Stone(石料) 建筑时，可使用任意材料。',
      en:'When adding to STONE structure may use any material.' },

    /* ---------- Craftsman / Wood (价值1, 每种6份) ---------- */
    { name:'Circus',   material:'Wood', copies:6, power:'circus',   timing:'passive',
      zh:'可将 2 张同角色的牌当作 1 张 Jack 使用。',
      en:'May play two cards of same role as JACK.' },
    { name:'Dock',     material:'Wood', copies:6, power:'dock',     timing:'action',
      zh:'执行 LABORER 时，可额外从手牌取 1 张材料放入库存。',
      en:'When performing LABORER action may take material from HAND.' },
    { name:'Market',   material:'Wood', copies:6, power:'market',   timing:'passive',
      zh:'金库(Vault)上限 +2。',
      en:'Maximum VAULT + 2.' },
    { name:'Palisade', material:'Wood', copies:6, power:'palisade', timing:'passive',
      zh:'免疫 LEGIONARY（不必交出卡牌）。',
      en:'Immune to LEGIONARY.' },

    /* ---------- Architect / Concrete (价值2, 每种3份) ---------- */
    { name:'Amphitheatre', material:'Concrete', copies:3, power:'amphitheatre', timing:'completion',
      zh:'完成时，按当前影响力点数，各执行 1 次 CRAFTSMAN。',
      en:'Upon completion, may perform one CRAFTSMAN action for each INFLUENCE.' },
    { name:'Aqueduct',     material:'Concrete', copies:3, power:'aqueduct',     timing:'passive',
      zh:'随从上限翻倍；执行 PATRON 时可额外从手牌取 1 个随从。',
      en:'Maximum CLIENTELE x2. When performing PATRON action may take client from HAND.' },
    { name:'Bridge',       material:'Concrete', copies:3, power:'bridge',       timing:'action',
      zh:'执行 LEGIONARY 时，可向所有对手索取材料（含其库存），无视 Palisade。',
      en:'When performing LEGIONARY may take material from STOCKPILE; ignore Palisades; all opponents.' },
    { name:'Senate',       material:'Concrete', copies:3, power:'senate',       timing:'end',
      zh:'回合结束时，可将对手本回合打出的 Jack 收入手牌。',
      en:'May take opponent’s JACK into HAND at end of turn it is played.' },
    { name:'Storeroom',    material:'Concrete', copies:3, power:'storeroom',    timing:'passive',
      zh:'你的所有随从都可当作 LABORER。',
      en:'All clients count as LABORERS.' },
    { name:'Tower',        material:'Concrete', copies:3, power:'tower',        timing:'passive',
      zh:'可用 Rubble 建造任意建筑；用 1 个动作即可在城外(out-of-town)奠基。',
      en:'May use RUBBLE in any structure. May lay foundation on out-of-town site at no extra cost.' },
    { name:'Vomitorium',   material:'Concrete', copies:3, power:'vomitorium',   timing:'action',
      zh:'执行 THINKER 前，可将全部手牌弃到供应区。',
      en:'Before performing THINKER action may discard all cards to POOL.' },
    { name:'Wall',         material:'Concrete', copies:3, power:'wall',         timing:'passive',
      zh:'免疫 LEGIONARY；游戏结束时，每 2 个库存材料 +1 分。',
      en:'Immune to LEGIONARY. +1 VP for every two materials in STOCKPILE.' },

    /* ---------- Legionary / Brick (价值2, 每种3份) ---------- */
    { name:'Academy', material:'Brick', copies:3, power:'academy', timing:'end',
      zh:'在执行过 CRAFTSMAN 的回合结束后，可额外执行 1 次 THINKER。',
      en:'May perform one THINKER action after turn during which you performed CRAFTSMAN.' },
    { name:'Archway', material:'Brick', copies:3, power:'archway', timing:'action',
      zh:'执行 ARCHITECT 时，可从供应区(Pool)取材料（而非库存）。',
      en:'When performing ARCHITECT action may take material from POOL.' },
    { name:'Atrium',  material:'Brick', copies:3, power:'atrium',  timing:'action',
      zh:'执行 MERCHANT 时，可从牌库取牌放入金库（不查看）。',
      en:'When performing MERCHANT action may take from DECK (do not look).' },
    { name:'Bath',    material:'Brick', copies:3, power:'bath',    timing:'action',
      zh:'执行 PATRON 雇佣的每个随从，入列时立即执行其角色 1 次。',
      en:'When performing PATRON, each client hired may perform its action once as it enters CLIENTELE.' },
    { name:'Foundry', material:'Brick', copies:3, power:'foundry', timing:'completion',
      zh:'完成时，按当前影响力点数，各执行 1 次 LABORER。',
      en:'Upon completion, may perform one LABORER action for each INFLUENCE.' },
    { name:'Gate',    material:'Brick', copies:3, power:'gate',    timing:'passive',
      zh:'未完成的 Marble(大理石) 建筑也提供其功能。',
      en:'Incomplete MARBLE structures provide FUNCTION.' },
    { name:'School',  material:'Brick', copies:3, power:'school',  timing:'completion',
      zh:'完成时，按当前影响力点数，各执行 1 次 THINKER。',
      en:'Upon completion, may perform one THINKER action for each INFLUENCE.' },
    { name:'Shrine',  material:'Brick', copies:3, power:'shrine',  timing:'passive',
      zh:'手牌上限 +2。',
      en:'Maximum HAND + 2.' },

    /* ---------- Merchant / Stone (价值3, 每种3份) ---------- */
    { name:'Catacomb',       material:'Stone', copies:3, power:'catacomb',      timing:'completion',
      zh:'完成时，游戏立即结束（照常计分）。',
      en:'Game ends immediately. Score as usual.' },
    { name:'Circus Maximus', material:'Stone', copies:3, power:'circusMaximus', timing:'passive',
      zh:'你带头或跟随某角色时，该角色的每个随从可执行 2 次动作。',
      en:'Each client may perform its action twice when you lead or follow its role.' },
    { name:'Coliseum',       material:'Stone', copies:3, power:'coliseum',      timing:'action',
      zh:'执行 LEGIONARY 时，可将对手对应角色的随从作为材料放入你的金库。',
      en:'When performing LEGIONARY may take opponent’s client and place in VAULT as material.' },
    { name:'Garden',         material:'Stone', copies:3, power:'garden',        timing:'completion',
      zh:'完成时，按当前影响力点数，各执行 1 次 PATRON。',
      en:'Upon completion, may perform one PATRON action for each INFLUENCE.' },
    { name:'Prison',         material:'Stone', copies:3, power:'prison',        timing:'completion',
      zh:'完成时，可付出 3 影响力，夺取对手 1 座已完成建筑。',
      en:'May exchange INFLUENCE for opponent’s completed structure.' },
    { name:'Scriptorium',    material:'Stone', copies:3, power:'scriptorium',   timing:'passive',
      zh:'可用 1 个 Marble 材料完成任意建筑。',
      en:'May use one MARBLE material to complete any structure.' },
    { name:'Sewer',          material:'Stone', copies:3, power:'sewer',         timing:'end',
      zh:'回合结束时，可将带头/跟随用过的角色牌放入库存。',
      en:'May place Order cards used to lead or follow into STOCKPILE at end of turn.' },
    { name:'Villa',          material:'Stone', copies:3, power:'villa',         timing:'passive',
      zh:'用 ARCHITECT 放入 1 个材料即可完成 Villa。',
      en:'When performing ARCHITECT action may complete Villa with one material.' },

    /* ---------- Patron / Marble (价值3, 每种3份) ---------- */
    { name:'Basilica',    material:'Marble', copies:3, power:'basilica',   timing:'action',
      zh:'执行 MERCHANT 时，可从手牌取材料放入金库。',
      en:'When performing MERCHANT action may take material from HAND.' },
    { name:'Forum',       material:'Marble', copies:3, power:'forum',      timing:'passive',
      zh:'当你拥有每种角色随从各至少 1 个时，立即获胜。',
      en:'One client of each role wins game.' },
    { name:'Fountain',    material:'Marble', copies:3, power:'fountain',   timing:'action',
      zh:'执行 CRAFTSMAN 时，可从牌库抽牌使用；未用的牌留入手牌。',
      en:'When performing CRAFTSMAN may use cards from DECK. Retain unused cards in HAND.' },
    { name:'Ludus Magna', material:'Marble', copies:3, power:'ludusMagna', timing:'passive',
      zh:'你的每个 MERCHANT 随从可当作任意角色。',
      en:'Each MERCHANT client counts as any role.' },
    { name:'Palace',      material:'Marble', copies:3, power:'palace',     timing:'passive',
      zh:'带头/跟随时可一次打出多张同角色牌，各执行 1 次动作。',
      en:'May play multiple cards of same role to perform additional actions.' },
    { name:'Stairway',    material:'Marble', copies:3, power:'stairway',   timing:'action',
      zh:'执行 ARCHITECT 时，可向对手已完成建筑加材料，使其功能对所有玩家开放。',
      en:'When performing ARCHITECT may add material to opponent’s completed structure to make function public.' },
    { name:'Statue',      material:'Marble', copies:3, power:'statue',     timing:'scoring',
      zh:'+3 分；可放在任意 Site 上。',
      en:'+3 VP. May place Statue on any SITE.' },
    { name:'Temple',      material:'Marble', copies:3, power:'temple',     timing:'passive',
      zh:'手牌上限 +4。',
      en:'Maximum HAND + 4.' }
  ];

  // 派生每个建筑的 role / value / color
  BUILDINGS.forEach(b => {
    const m = MATERIALS[b.material];
    b.role = m.role;
    b.value = m.value;
    b.color = m.color;
    b.textColor = m.text;
    b.materialZh = m.zh;
  });

  const BY_NAME = {};
  BUILDINGS.forEach(b => { BY_NAME[b.name] = b; });

  const MATERIAL_LIST = ['Rubble', 'Wood', 'Concrete', 'Brick', 'Stone', 'Marble'];
  const ROLE_LIST = ['Laborer', 'Craftsman', 'Architect', 'Legionary', 'Merchant', 'Patron'];

  const CARDS = {
    MATERIALS,
    MATERIAL_LIST,
    ROLE_LIST,
    ROLE_ZH,
    BUILDINGS,
    BY_NAME,
    roleOf(name)    { return BY_NAME[name] ? BY_NAME[name].role : null; },
    materialOf(name){ return BY_NAME[name] ? BY_NAME[name].material : null; },
    valueOf(name)   { return BY_NAME[name] ? BY_NAME[name].value : null; },
    colorOf(name)   { return BY_NAME[name] ? BY_NAME[name].color : '#888'; },
    // 构建完整 Order 牌库 (144 张) —— 返回卡名数组
    buildDeck() {
      const deck = [];
      BUILDINGS.forEach(b => { for (let i = 0; i < b.copies; i++) deck.push(b.name); });
      return deck; // 144 张
    }
  };

  global.GTR_CARDS = CARDS;
  if (typeof module !== 'undefined' && module.exports) module.exports = CARDS;
})(typeof window !== 'undefined' ? window : globalThis);
