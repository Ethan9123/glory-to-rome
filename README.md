# Glory to Rome — 网页热座版（粉丝自制）

一个在浏览器里运行的 **Glory to Rome**（Carl Chudyk 设计的卡牌策略游戏）**本地热座**实现：
**2–5 人同屏轮流游玩**，中文界面，完整规则引擎，实现核心 40 座建筑（Republic 规则）。

## ▶ 在线游玩
启用 GitHub Pages 后即可访问（见仓库 Settings → Pages 给出的链接）。
本地也可直接用浏览器打开 `index.html`。

## 玩法简介
- 每回合带头者「带头」一个角色或「思考」抽牌；其余玩家「跟随」或「思考」。
- 六种角色：思考者 / 劳工 / 工匠 / 建筑师 / 军团兵 / 商人 / 资助人。
- 建造：奠基 → 放入同色材料 → 完成后获得影响力与建筑功能。
- 结束条件触发后按 影响力 + 金库 + 商人奖励 + 建筑分 计分。
- 顶栏「参考卡」查看角色与流程；「日志」查看记录。

## 技术
纯原生 HTML/CSS/JavaScript，无需构建、无依赖、无后端。规则引擎可用 Node 测试：
```
node test.js && node test2.js && node test3.js
```

## 文件
`index.html` · `config.js` · `cards.js`（数据）· `engine.js`（规则引擎）· `ui.js`（界面）· `style.css`

---

## 版权声明 / Disclaimer
本项目为 **非官方、粉丝自制** 的数字实现，仅供学习与个人游玩。
**Glory to Rome** 由 Carl Chudyk 设计，版权归 **Cambridge Games Factory** 所有，本项目与其无任何关联。

本仓库 **不包含任何官方美术、卡面图或出版物素材**，仅使用本项目原创的样式化卡牌。
游戏名称与机制属于事实性/玩法信息；如版权方有任何异议，请联系仓库所有者，将立即处理。

This is an **unofficial, fan-made** digital implementation for personal and educational use only.
*Glory to Rome* is designed by Carl Chudyk and © Cambridge Games Factory; this project is not affiliated with or endorsed by them.
**No official artwork or published assets are included** — only original, stylized cards created for this project.
