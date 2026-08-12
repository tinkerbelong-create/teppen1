/* テッペンとリーヨ！ ── 画面と操作（PC・横長前提）
 *
 * 方針：メニューではなく「カードそのもの」を触って遊ぶ。
 *  - 今すぐ撃てる／拾えるカードは光り、札に「撃てる」と出る
 *  - 相手の番は自分の札が沈む
 *  - タップで持ち上げて、カードの上に出るボタンで決める
 *  - 上へドラッグして場や相手へ放り込んでもよい
 *
 * 画面は 1440x810 の版面に固定し、ウィンドウに合わせて全体を拡大縮小する。
 * カードは枚数に応じて大きさを計算して並べるので、はみ出しも重なりも起きない。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var E = NS.Engine, R = NS.Render, Fx = NS.Fx, DATA = NS.DATA, AI = NS.AI, Sim = NS.Sim, CFG = NS.CONFIG;

  function $(id) { return document.getElementById(id); }

  var S = {
    game: null, human: -1,
    playerCount: CFG.defaults.playerCount,
    humanPlays: CFG.defaults.humanPlays,
    myCap: CFG.defaults.captain,
    awaitAction: null, sel: null, targeting: null,
    prevBall: 0, speed: CFG.defaults.speed
  };

  /* ================================================================
   * 版面をウィンドウに合わせる
   * ============================================================== */
  function fitStage() {
    var c = CFG.stage;
    var w = global.innerWidth || document.documentElement.clientWidth || c.w;
    var h = global.innerHeight || document.documentElement.clientHeight || c.h;
    /* 起動直後にウィンドウの大きさが 0 で返ってくることがある。
     * そのまま計算すると盤面がつぶれるので、下限を入れておく。 */
    var u = Math.max(0.3, Math.min(w / c.w, h / c.h));
    document.documentElement.style.fontSize = (c.rem * u) + 'px';
  }

  /* ================================================================
   * 設定シート
   * ============================================================== */
  function buildSetup() {
    var seg = $('segPlayers');
    seg.replaceChildren();
    [2, 3, 4].forEach(function (n) {
      var b = R.el('button', null, n + '人');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.n = n;
      b.addEventListener('click', function () { S.playerCount = n; syncSetup(); });
      seg.appendChild(b);
    });

    var cg = $('capGrid');
    cg.replaceChildren();
    DATA.captains.forEach(function (c) {
      var b = R.el('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.cap = c.cap;

      var face = R.el('div', 'cap__face');
      face.style.backgroundImage = 'url("' + NS.asset(c.img) + '")';
      var f = NS.faceOf(c);
      face.style.backgroundSize = f.zoom + '%';
      face.style.backgroundPosition = f.x + '% ' + f.y + '%';
      b.appendChild(face);

      var box = R.el('div');
      box.appendChild(R.el('b', null, c.name));
      var mine = R.techsOf(c);
      box.appendChild(R.el('small', null, mine.main.concat(mine.sub).map(function (t) {
        return t.name + (t.dice ? '（' + R.diceLabel(t.dice) + '）' : '');
      }).join(' / ')));
      b.appendChild(box);

      b.addEventListener('click', function () { S.myCap = c.cap; syncSetup(); });
      cg.appendChild(b);
    });

    ['optHand', 'optWin', 'optCoin', 'optTech', 'optChar'].forEach(function (id) {
      $(id).addEventListener('input', syncSetup);
    });
    $('optHuman').addEventListener('change', syncSetup);
    $('optSpeed').value = String(CFG.defaults.speed);
    $('optSpeed').addEventListener('change', function () {
      S.speed = parseFloat($('optSpeed').value); Fx.setSpeed(S.speed);
    });
    Fx.setSpeed(S.speed);
    syncSetup();
  }

  function readSetup() {
    return {
      handSize: Math.max(1, +$('optHand').value || 12),
      winScore: Math.max(1, +$('optWin').value || 3),
      coins: Math.max(0, +$('optCoin').value || 0),
      techCopies: Math.max(1, +$('optTech').value || 1),
      charCopies: Math.max(1, +$('optChar').value || 1)
    };
  }

  function syncSetup() {
    Array.prototype.forEach.call($('segPlayers').children, function (b) {
      b.setAttribute('aria-checked', (+b.dataset.n === S.playerCount) ? 'true' : 'false');
    });
    Array.prototype.forEach.call($('capGrid').children, function (b) {
      b.setAttribute('aria-checked', (+b.dataset.cap === S.myCap) ? 'true' : 'false');
    });
    S.humanPlays = $('optHuman').checked;
    $('capGrid').style.opacity = S.humanPlays ? '1' : '.4';

    var o = readSetup();
    var deck = DATA.deckChars.length * o.charCopies + DATA.techs.length * o.techCopies + o.coins + 1;
    var dealt = o.handSize * S.playerCount;
    $('deckNote').textContent =
      '山札は ' + deck + ' 枚（キャラ ' + (DATA.deckChars.length * o.charCopies) +
      '＋必殺 ' + (DATA.techs.length * o.techCopies) + '＋コイン ' + o.coins + '＋ボール1）。' +
      '最初に ' + dealt + ' 枚配るので、山に残るのは ' + (deck - dealt) + ' 枚。山札が尽きたらタイムアップです。';
  }

  /* ================================================================
   * ゲーム開始
   * ============================================================== */
  function cpuAgent() {
    var a = AI.makeAgent();
    return {
      cpu: true,
      decide: async function (g, pi, req) {
        await Fx.hold(req.kind === 'action' ? 420 : 300);
        return a.decide(g, pi, req);
      }
    };
  }

  function startGame() {
    /* 前の試合がまだ走っていたら止める。
     * 止めないと2つの試合が同じ盤面に描き込み、決着表示まで混ざる。 */
    if (S.game) S.game.aborted = true;

    var o = readSetup();
    var n = S.playerCount;
    S.human = S.humanPlays ? 0 : -1;

    var caps = [1, 2, 3, 4];
    E.shuffle(caps, E.makeRng((Math.random() * 1e9) | 0));
    if (S.human === 0) {
      caps.splice(caps.indexOf(S.myCap), 1);
      caps.unshift(S.myCap);
    }

    var players = [];
    for (var i = 0; i < n; i++) {
      players.push({
        name: (i === S.human) ? 'あなた' : 'CPU' + (S.human === 0 ? i : i + 1),
        cpu: i !== S.human,
        captain: caps[i]
      });
    }

    var agents = [];
    for (var j = 0; j < n; j++) agents.push(j === S.human ? humanAgent() : cpuAgent());

    var g = E.createGame({
      players: players, handSize: o.handSize, winScore: o.winScore,
      coins: o.coins, techCopies: o.techCopies, charCopies: o.charCopies,
      seed: (Math.random() * 1e9) | 0
    }, agents, onEvent);

    S.game = g;
    S.prevBall = g.ball;
    S.sel = null; S.targeting = null; S.awaitAction = null;
    lastTurn = -1;
    $('logList').replaceChildren();
    $('stage').hidden = false;
    Fx.clear();
    fitStage();
    renderAll();

    E.run(g).then(function () { showFinish(g); }, function (err) {
      if (g !== S.game) return;
      console.error(err);
      Fx.finish('<div class="finish__word">試合が止まりました</div>' +
        '<div class="finish__sub">' + (err && err.message ? err.message : err) +
        '<br>この文言を作者に伝えてください（' + g.turnCount + '手目）</div>',
        function () { $('setup').showModal(); });
    });
  }

  /* ================================================================
   * イベント → 演出＋記録
   * ============================================================== */
  function rectOf(el) { return el ? el.getBoundingClientRect() : null; }
  function playerEl(pi) {
    if (pi === S.human) return $('mybench');
    return document.querySelector('.opp[data-pi="' + pi + '"]') || $('scores');
  }
  function cardElByUid(uid) { return document.querySelector('[data-uid="' + uid + '"]'); }
  function pname(g, pi) { return g.players[pi].name; }
  function teamText(team) { return team.map(function (c) { return c.name; }).join(' ＋ '); }

  async function onEvent(ev, g) {
    if (g !== S.game) return;          /* やり直し前の試合の出来事は捨てる */
    addLog(ev, g);
    await animate(ev, g);
    if (g !== S.game) return;
    renderAll();
  }

  var CENTER = function () {
    return { left: global.innerWidth / 2 - 60, top: global.innerHeight / 2 - 40, width: 120, height: 80 };
  };

  async function animate(ev, g) {
    switch (ev.k) {

      case 'turnStart':
        setBanner(pname(g, ev.p) + ' の番');
        if (ev.p !== S.human) await Fx.hold(240);
        break;

      case 'play':
        await Fx.flyCard(rectOf(cardElByUid(ev.card.uid)), rectOf($('piles')), ev.card, 480);
        break;

      case 'shootDeclare': {
        var s1 = rectOf(cardElByUid(ev.tech.uid));
        if (s1) await Fx.flyCard(s1, CENTER(), ev.tech, 340);
        await Fx.cutin(ev.tech, teamText(ev.team) + ' → ' + pname(g, ev.target),
          ev.pierce ? '貫通！　素手では止まらない' : null, 1350);
        break;
      }

      case 'defenseDeclare': {
        var s2 = rectOf(cardElByUid(ev.tech.uid));
        if (s2) await Fx.flyCard(s2, CENTER(), ev.tech, 340);
        await Fx.cutin(ev.tech, teamText(ev.team) + ' → ' + pname(g, ev.target) + ' からボールを狙う', null, 1200);
        break;
      }

      case 'catchDeclare':
        if (ev.mode === 'tech') {
          await Fx.cutin(ev.tech, ev.keeper.name + ' が立ちはだかる', null, 1150);
        } else {
          await Fx.toast(ev.keeper.name + ' の素手キャッチ！（' + R.diceLabel(ev.dice) + ' で成功）', 950);
        }
        break;

      case 'dribbleDeclare':
        await Fx.cutin(ev.tech, teamText(ev.team) + ' が振り切りにかかる', null, 1150);
        break;

      case 'noCatch':
        await Fx.toast(ev.reason === 'pierce'
          ? pname(g, ev.p) + ' はキーパー技を持っていない…　貫通シュートは止まらない'
          : pname(g, ev.p) + ' にゴールキーパーがいない！', 1200);
        break;

      case 'noDribble':
        await Fx.toast(pname(g, ev.p) + ' はドリブルで反応できない', 850);
        break;

      case 'dice':
        await Fx.dice(ev, pname(g, ev.p));
        break;

      case 'goal':
        await Fx.goal(pname(g, ev.p), ev.tech.name);
        break;

      case 'ball': {
        if (S.prevBall !== ev.to) {
          await Fx.flyBall(rectOf(playerEl(S.prevBall)), rectOf(playerEl(ev.to)));
        }
        S.prevBall = ev.to;
        break;
      }

      case 'steal':
        await Fx.toast(pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' の伏せ札から1枚うばった', 950);
        break;

      case 'raid':
        await Fx.toast('引き抜き！　' + pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' の【' + ev.card.name + '】を獲得', 1200);
        break;

      case 'scout':
        if (ev.p !== S.human) await Fx.toast(pname(g, ev.p) + ' が場から【' + ev.card.name + '】を拾った', 850);
        break;

      case 'fieldToDeck':
        await Fx.toast('場の【' + ev.card.name + '】を山札に戻した', 900);
        break;

      case 'returnToHand':
        await Fx.toast('【' + ev.card.name + '】は場に出ず手札に戻る', 1000);
        break;

      case 'catchResult':
        if (ev.ok) await Fx.toast('キャッチ成功！　シュートは山札へ消えた', 1000);
        break;

      case 'dribbleResult':
        await Fx.toast(ev.ok ? '振り切った！　ディフェンスは山札へ' : 'つかまった！　ドリブルは山札へ', 950);
        break;

      case 'defenseResult':
        await Fx.toast('ボールを奪った！', 850);
        break;

      case 'pass':
        await Fx.toast(pname(g, ev.p) + ' はできることがない（パス）', 900);
        break;
    }
  }

  /* ================================================================
   * 記録（補助）
   * ============================================================== */
  var lastTurn = -1;
  function addLog(ev, g) {
    var list = $('logList'), txt = null, hi = false;
    switch (ev.k) {
      case 'start': txt = 'キックオフ。ボールを引いたのは ' + pname(g, ev.ball); hi = true; break;
      case 'turnStart':
        if (ev.turn !== lastTurn) {
          lastTurn = ev.turn;
          list.appendChild(R.el('li', 'turnsep', '― ' + (ev.turn + 1) + '手目 ―'));
        }
        txt = pname(g, ev.p) + ' の番'; break;
      case 'play': txt = pname(g, ev.p) + ' が【' + ev.card.name + '】を場に出して1枚引いた'; break;
      case 'shootDeclare': txt = pname(g, ev.p) + ' → ' + pname(g, ev.target) + '　シュート【' + ev.tech.name + '】' + (ev.pierce ? '［貫通］' : ''); hi = true; break;
      case 'defenseDeclare': txt = pname(g, ev.p) + ' → ' + pname(g, ev.target) + '　ディフェンス【' + ev.tech.name + '】'; break;
      case 'catchDeclare': txt = '　' + pname(g, ev.p) + ' が ' + (ev.mode === 'bare' ? '素手キャッチ（' + ev.keeper.name + '）' : 'キャッチ【' + ev.tech.name + '】') + ' 出目' + R.diceLabel(ev.dice); break;
      case 'dribbleDeclare': txt = '　' + pname(g, ev.p) + ' がドリブル【' + ev.tech.name + '】 出目' + R.diceLabel(ev.dice); break;
      case 'dice': txt = '　サイコロ ' + ev.roll + ' → ' + (ev.ok ? '成功' : '失敗'); break;
      case 'noCatch': txt = '　' + pname(g, ev.p) + ' は反応できない' + (ev.reason === 'pierce' ? '（貫通）' : '（GKなし）'); break;
      case 'goal': txt = '⚡ ' + pname(g, ev.p) + ' のゴール！【' + ev.tech.name + '】'; hi = true; break;
      case 'score': txt = '　' + pname(g, ev.p) + '：' + ev.score + '点'; break;
      case 'ball': txt = '　ボールは ' + pname(g, ev.to) + ' へ'; break;
      case 'draw': if (ev.n) txt = '　' + pname(g, ev.p) + ' が' + ev.n + '枚引いた'; break;
      case 'steal': txt = '　' + pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' の伏せ札を1枚うばった'; break;
      case 'scout': txt = '　' + pname(g, ev.p) + ' が場から【' + ev.card.name + '】を' + (ev.free ? '無料で' : 'コイン1で') + '拾った'; break;
      case 'raid': txt = pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' から【' + ev.card.name + '】を引き抜いた（コイン2）'; hi = true; break;
      case 'fieldToDeck': txt = '　場の【' + ev.card.name + '】を山札へ'; break;
      case 'returnToHand': txt = '　【' + ev.card.name + '】は手札に戻った'; break;
      case 'catchResult': txt = ev.ok ? '　キャッチ成功。シュートは山札へ' : '　キャッチ失敗' + (ev.catchToDeck ? '。キャッチカードは山札へ' : ''); break;
      case 'dribbleResult': txt = ev.ok ? '　振り切り成功。ディフェンスは山札へ' : '　振り切り失敗。ドリブルは山札へ'; break;
      case 'defenseResult': txt = '　' + pname(g, ev.p) + ' がボールを奪った'; break;
      case 'pass': txt = pname(g, ev.p) + ' はパス'; break;
      case 'end':
        txt = ev.winner == null ? '引き分け' : pname(g, ev.winner) + ' の勝ち（' +
          ({ score: '規定点', timeup: 'タイムアップ・最多得点', timeupFirst: 'タイムアップ・先に得点', stuck: '進行停止' }[ev.reason] || ev.reason) + '）';
        hi = true; break;
    }
    if (!txt) return;
    var li = R.el('li', hi ? 'hi' : null, txt);
    list.appendChild(li);
    li.scrollIntoView({ block: 'end' });
  }

  /* ================================================================
   * 描画
   * ============================================================== */
  function setBanner(text) {
    var b = $('banner');
    if (!text) { b.hidden = true; return; }
    b.replaceChildren(R.el('span', null, text));
    b.hidden = false;
  }

  /* いま選べる手を、カードの見た目に落とすための索引 */
  function moveIndex() {
    var idx = {};
    if (!S.awaitAction) return idx;
    S.awaitAction.options.forEach(function (m) {
      var key;
      if (m.t === 'play') key = 'own|' + m.card.kind + '|' + m.card.name;
      else if (m.t === 'shoot' || m.t === 'defense') key = 'own|tech|' + m.card.name;
      else if (m.t === 'scoutField') key = 'field|' + m.card.kind + '|' + m.card.name;
      else if (m.t === 'scoutPlayer') key = 'opp' + m.target + '|char|' + m.card.name;
      (idx[key] = idx[key] || []).push(m);
    });
    return idx;
  }

  /* 自分が持っている選手の一覧（必殺カードの「必要な選手」を色分けするのに使う） */
  function ownedBases(g, pi) {
    var o = {};
    if (pi < 0) return o;
    E.ownedChars(g, pi).forEach(function (c) { o[c.base] = true; });
    return o;
  }

  function renderAll() {
    var g = S.game;
    if (!g) return;
    var idx = moveIndex();
    var owned = ownedBases(g, S.human);
    renderScores(g);
    renderOpponents(g, idx, owned);
    renderField(g, idx, owned);
    renderMyBench(g, idx);
    renderHand(g, idx, owned);
    mountActs();
    if (S.targeting) setBanner('だれに撃つ？　相手をタップ');
    else if (S.awaitAction) setBanner('あなたの番　カードをタップ、または上へドラッグ');
  }

  function renderScores(g) {
    var box = $('scores');
    box.replaceChildren();
    g.players.forEach(function (p, i) {
      var c = R.el('div', 'pscore');
      if (i === g.turn) c.classList.add('is-turn');
      if (i === S.human) c.classList.add('is-me');
      c.appendChild(R.el('div', 'pscore__n', String(p.score)));
      c.appendChild(R.el('div', 'pscore__name', p.name));
      if (i === g.ball) c.appendChild(R.el('div', 'pscore__ball', '⚽'));
      c.appendChild(R.el('div', 'pscore__meta', p.captain.name + '・手札' + p.hand.length));
      box.appendChild(c);
    });
  }

  /* 顔タイルの大きさを、枚数と入れ物の縦横の両方から決める。
   * 幅だけで決めると段が増えたときに縦へあふれるので、両方見る。
   * タイルの高さ ≒ 幅 × 1.26（顔＋名前の帯）。 */
  function benchTile(n, availW, availH, maxTw) {
    if (n <= 0) return maxTw;
    var best = 0;
    for (var r = 1; r <= 3; r++) {
      var per = Math.ceil(n / r);
      var byW = (availW - (per - 1) * 0.25) / per;
      var byH = (availH - (r - 1) * 0.25) / (r * 1.26);
      var tw = Math.min(maxTw, byW, byH);
      if (tw > best) best = tw;
    }
    return Math.max(1.8, best);
  }

  function renderOpponents(g, idx, owned) {
    var box = $('opponents');
    box.replaceChildren();
    var others = [];
    g.players.forEach(function (p, i) { if (i !== S.human) others.push(i); });
    if (!others.length) return;

    /* 相手パネル1枚ぶんの内寸（rem）。版面が固定なので計算で出せる */
    var panelInner = (90 - 1.8 - (others.length - 1) * 0.5) / others.length - 1.1;

    others.forEach(function (i) {
      var p = g.players[i];
      var o = R.el('div', 'opp');
      o.dataset.pi = i;
      if (i === g.turn) o.classList.add('is-turn');

      var head = R.el('div', 'opp__head');
      head.appendChild(R.el('span', 'opp__name', p.name));
      head.appendChild(R.el('span', 'opp__score', String(p.score)));
      if (i === g.ball) head.appendChild(R.el('span', 'opp__ball', '⚽'));
      head.appendChild(R.el('span', 'opp__hidden', '伏せ ' + E.hiddenHand(g, i).length));
      o.appendChild(head);

      var chars = [p.captain].concat(E.handChars(g, i));
      /* パネルの内寸（幅・高さ）に収まる大きさを出す */
      var tw = benchTile(chars.length, panelInner, 12.5 - 0.8 - 1.5, 4.6);

      var tiles = R.el('div', 'opp__tiles');
      chars.forEach(function (c, k) {
        var e = R.faceTile(c, { small: true });
        e.style.setProperty('--tw', tw + 'rem');
        var ms = (k === 0) ? null : idx['opp' + i + '|char|' + c.name];
        wire(e, c, 'opp' + i, ms);
        tiles.appendChild(e);
      });
      o.appendChild(tiles);

      if (S.targeting && S.targeting.byTarget[i]) {
        o.classList.add('is-targetable');
        o.addEventListener('click', function (e) {
          e.stopPropagation();
          commit(S.targeting.byTarget[i]);
        });
      }
      box.appendChild(o);
    });
  }

  /* 場は種類ごとの山にまとめる。
   * ルールブック9章「場が大きくなってきたら、種類ごとに分けて並べる」を画面でもやる。
   * 平均39枚・最大156枚まで溜まるので、1枚ずつ並べるやり方では画面に入らない。 */
  var PILE_DEFS = [
    { key: 'シュート', test: function (c) { return c.kind === 'tech' && c.type === 'シュート'; } },
    { key: 'ドリブル', test: function (c) { return c.kind === 'tech' && c.type === 'ドリブル'; } },
    { key: 'ディフェンス', test: function (c) { return c.kind === 'tech' && c.type === 'ディフェンス'; } },
    { key: 'キャッチ', test: function (c) { return c.kind === 'tech' && c.type === 'キャッチ'; } },
    { key: '選手', test: function (c) { return c.kind === 'char'; } }
  ];

  function renderField(g, idx, owned) {
    var box = $('piles');
    box.replaceChildren();

    PILE_DEFS.forEach(function (def) {
      var cards = g.field.filter(def.test);
      var live = cards.some(function (c) { return idx['field|' + c.kind + '|' + c.name]; });
      var e = R.pile(def.key, cards, { owned: owned });
      if (live) e.classList.add('is-live');
      e.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!cards.length) return;
        openPile(def.key, cards, idx);
      });
      box.appendChild(e);
    });

    var cnt = $('counters');
    cnt.replaceChildren();
    cnt.appendChild(R.counter('山札', g.deck.length, 'counter--deck'));
    cnt.appendChild(R.counter('捨て札', g.discard.length));
    if (S.human >= 0) cnt.appendChild(R.coinStack(E.countCoins(g, S.human)));
  }

  function renderMyBench(g, idx) {
    var box = $('mybench');
    box.replaceChildren();
    if (S.human < 0) {
      box.appendChild(R.el('div', 'bench__label', 'CPU同士の試合を見ています'));
      return;
    }
    box.appendChild(R.el('div', 'bench__label', '自分の選手'));
    /* 90（版面）－1.8（左右の余白）－2.2（縦書きラベルと安全代） */
    var chars = [g.players[S.human].captain].concat(E.handChars(g, S.human));
    var tw = benchTile(chars.length, 90 - 1.8 - 2.2, 9 - 0.85, 7.2);
    chars.forEach(function (c, k) {
      var e = R.faceTile(c);
      e.style.setProperty('--tw', tw + 'rem');
      wire(e, c, k === 0 ? 'cap' : 'own', k === 0 ? null : idx['own|char|' + c.name]);
      box.appendChild(e);
    });
  }

  /* 手札の必殺カードは、枚数から段数と大きさを計算して並べる。
   * こうすると重ならないので、技名が必ず読める。 */
  function handLayout(n) {
    var AVAIL_W = 90 - 1.8 - 4 - 0.8;             /* 版面 － 余白 － 左の欄 － すき間 */
    var AVAIL_H = 50.625 - 3.25 - 12.5 - 10 - 9 - 1;
    var best = { cw: 0, rows: 1 };
    for (var r = 1; r <= 4; r++) {
      var per = Math.ceil(n / r);
      var byW = (AVAIL_W - (per - 1) * 0.4) / per;
      var byH = ((AVAIL_H - (r - 1) * 0.4) / r) * 1.88;
      var cw = Math.min(20, byW, byH);
      if (cw > best.cw) best = { cw: cw, rows: r };
    }
    return best;
  }

  function renderHand(g, idx, owned) {
    var side = $('handSide');
    side.replaceChildren();
    var box = $('hand');
    box.replaceChildren();

    if (S.human < 0) {
      box.appendChild(R.el('div', 'hand__empty', '観戦モード。CPUだけで進みます。'));
      return;
    }

    side.appendChild(R.el('div', 'bench__label', '手札'));
    if (g.ball === S.human) {
      var b = R.el('div', 'ballmark', '⚽');
      b.title = 'ボールを持っている';
      side.appendChild(b);
    }

    var techs = g.players[S.human].hand.filter(function (c) { return c.kind === 'tech'; });
    if (!techs.length) { box.appendChild(R.el('div', 'hand__empty', '必殺カードを持っていない')); return; }

    var to = { 'シュート': 0, 'ドリブル': 1, 'ディフェンス': 2, 'キャッチ': 3 };
    techs.sort(function (a, b2) { return (to[a.type] - to[b2.type]) || a.name.localeCompare(b2.name); });

    var lay = handLayout(techs.length);
    box.style.setProperty('--cw', lay.cw + 'rem');
    techs.forEach(function (c) {
      var e = R.techCard(c, { owned: owned });
      e.style.setProperty('--cw', lay.cw + 'rem');
      wire(e, c, 'own', idx['own|tech|' + c.name]);
      box.appendChild(e);
    });
  }

  /* カードに「今できること」を貼りつける */
  function wire(e, cardData, zone, moves) {
    e.dataset.zone = zone;
    e.dataset.name = cardData.name || '';
    e._card = cardData;
    e._moves = moves || null;

    var kinds = {};
    (moves || []).forEach(function (m) { kinds[m.t] = 1; });
    var liveLabel = kinds.shoot ? '撃てる'
      : kinds.defense ? '奪える'
        : kinds.scoutPlayer ? '引き抜ける' : null;

    if (!S.awaitAction) {
      if (zone === 'own' || zone === 'cap') e.classList.add('is-dim');
    } else if (liveLabel) {
      e.classList.add('is-live');
      e.appendChild(R.el('div', 'card__hot', liveLabel));
    }
    if (S.sel === cardData.uid) e.classList.add('is-sel');

    e.addEventListener('pointerdown', onCardDown);
    e.addEventListener('click', function (ev) { ev.stopPropagation(); });
    return e;
  }

  /* ================================================================
   * カードにくっつく操作チップ
   * ============================================================== */
  function buildActs(el, cardData, moves) {
    var box = R.el('div', 'acts');

    function chip(label, cls, fn) {
      var b = R.el('button', cls || null, label);
      b.type = 'button';
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      box.appendChild(b);
    }

    var byType = {};
    (moves || []).forEach(function (m) { (byType[m.t] = byType[m.t] || []).push(m); });

    if (byType.shoot) {
      chip('シュート！', null, function () {
        var bt = {};
        byType.shoot.forEach(function (m) { bt[m.target] = withUid(m, cardData); });
        S.targeting = { byTarget: bt };
        S.sel = null;
        renderAll();
      });
    }
    if (byType.defense) chip('ディフェンス！', null, function () { commit(withUid(byType.defense[0], cardData)); });
    if (byType.play) chip('場に出す＋1枚引く', 'sub', function () { commit(withUid(byType.play[0], cardData)); });
    if (byType.scoutField) chip('拾う ⚡1', null, function () { commit(withUid(byType.scoutField[0], cardData)); });
    if (byType.scoutPlayer) chip('引き抜く ⚡2', null, function () { commit(withUid(byType.scoutPlayer[0], cardData)); });
    chip('大きく見る', 'sub', function () { showZoom(cardData); });
    chip('やめる', 'sub', function () { S.sel = null; renderAll(); });
    return box;
  }

  /* 選んだカードの真上に操作チップを貼る */
  function mountActs() {
    var old = $('actsLayer');
    if (old) old.remove();
    if (!S.sel) return;
    var el = cardElByUid(S.sel);
    if (!el) return;
    var box = buildActs(el, el._card, el._moves);
    box.id = 'actsLayer';
    document.body.appendChild(box);
    var r = el.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    box.style.left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), global.innerWidth - b.width - 8) + 'px';
    var top = r.top - b.height - 12;
    box.style.top = (top < 8 ? Math.min(r.bottom + 12, global.innerHeight - b.height - 8) : top) + 'px';
  }

  function withUid(move, cardData) {
    var m = {};
    for (var k in move) m[k] = move[k];
    m.uid = cardData.uid;
    m.card = cardData;
    return m;
  }

  function commit(move) {
    if (!S.awaitAction) return;
    var res = S.awaitAction.resolve;
    S.awaitAction = null; S.sel = null; S.targeting = null;
    setBanner(null);
    document.querySelector('.handrow').classList.remove('is-lit');
    renderAll();
    res(move);
  }

  /* ================================================================
   * タップとドラッグ
   * ============================================================== */
  var drag = null;

  function onCardDown(ev) {
    if (ev.button != null && ev.button > 0) return;
    var el = ev.currentTarget;
    drag = {
      el: el, card: el._card, moves: el._moves,
      x0: ev.clientX, y0: ev.clientY, t0: Date.now(),
      moved: false, ghost: null
    };
    global.addEventListener('pointermove', onCardMove);
    global.addEventListener('pointerup', onCardUp);
    global.addEventListener('pointercancel', onCardCancel);
  }

  function onCardMove(ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 12) return;
      if (!drag.moves || !drag.moves.length || drag.el.dataset.zone !== 'own') { cleanupDrag(); return; }
      drag.moved = true;
      startGhost();
    }
    drag.ghost.style.left = (ev.clientX - drag.rect.w / 2) + 'px';
    drag.ghost.style.top = (ev.clientY - drag.rect.h * 0.6) + 'px';
    highlightDrop(ev.clientX, ev.clientY);
  }

  function startGhost() {
    var b = drag.el.getBoundingClientRect();
    drag.rect = { w: b.width, h: b.height };
    var gh = drag.card.kind === 'tech'
      ? R.techCard(drag.card, { owned: ownedBases(S.game, S.human) })
      : R.faceTile(drag.card);
    gh.classList.add('is-drag');
    gh.style.setProperty('--cw', (b.width / parseFloat(getComputedStyle(document.documentElement).fontSize)) + 'rem');
    gh.style.setProperty('--tw', (b.width / parseFloat(getComputedStyle(document.documentElement).fontSize)) + 'rem');
    document.body.appendChild(gh);
    drag.ghost = gh;
    drag.el.style.opacity = '.25';

    var types = {};
    drag.moves.forEach(function (m) { types[m.t] = 1; });
    if (types.shoot || types.defense) {
      document.querySelectorAll('.opp').forEach(function (o) {
        var pi = +o.dataset.pi;
        if (drag.moves.some(function (m) { return (m.t === 'shoot' || m.t === 'defense') && m.target === pi; })) {
          o.classList.add('is-targetable');
        }
      });
    }
  }

  function highlightDrop(x, y) {
    var el = document.elementFromPoint(x, y);
    document.querySelectorAll('.opp.is-hot').forEach(function (o) { o.classList.remove('is-hot'); });
    var opp = el && el.closest && el.closest('.opp');
    if (opp && opp.classList.contains('is-targetable')) opp.classList.add('is-hot');
  }

  function onCardUp(ev) {
    if (!drag) return;
    if (!drag.moved) {
      var quick = Date.now() - drag.t0 < 900;
      var srcEl = drag.el;
      cleanupDrag();
      if (quick) tapCard(srcEl, ev);
      return;
    }
    var target = document.elementFromPoint(ev.clientX, ev.clientY);
    var moves = drag.moves, card = drag.card, chosen = null;
    if (target && target.closest) {
      var opp = target.closest('.opp');
      if (opp) {
        var pi = +opp.dataset.pi;
        chosen = moves.filter(function (m) { return (m.t === 'shoot' || m.t === 'defense') && m.target === pi; })[0] || null;
      } else if (target.closest('.fieldrow')) {
        chosen = moves.filter(function (m) { return m.t === 'play'; })[0] || null;
      }
    }
    cleanupDrag();
    if (chosen) commit(withUid(chosen, card));
    else renderAll();
  }

  function onCardCancel() { cleanupDrag(); renderAll(); }

  function cleanupDrag() {
    global.removeEventListener('pointermove', onCardMove);
    global.removeEventListener('pointerup', onCardUp);
    global.removeEventListener('pointercancel', onCardCancel);
    if (drag) {
      if (drag.ghost) drag.ghost.remove();
      if (drag.el) drag.el.style.opacity = '';
    }
    drag = null;
    document.querySelectorAll('.opp').forEach(function (o) { o.classList.remove('is-hot'); });
    if (!S.targeting) document.querySelectorAll('.opp').forEach(function (o) { o.classList.remove('is-targetable'); });
  }

  function tapCard(el, ev) {
    var target = (ev.target.closest && (ev.target.closest('.tcard') || ev.target.closest('.tile'))) || el;
    if (!target || !target._card) return;
    var c = target._card;
    if (!S.awaitAction || !target._moves || !target._moves.length) { showZoom(c); return; }
    S.sel = (S.sel === c.uid) ? null : c.uid;
    S.targeting = null;
    renderAll();
  }

  /* ================================================================
   * 選ばせるパネル
   * ============================================================== */
  function showChooser(cfg) {
    return new Promise(function (resolve) {
      var box = $('chooser');
      $('chooserTitle').textContent = cfg.title;
      $('chooserSub').textContent = cfg.sub || '';

      var inc = $('chooserIncoming');
      inc.replaceChildren();
      if (cfg.incoming) {
        var ic = R.techCard(cfg.incoming, { owned: ownedBases(S.game, S.human) });
        ic.style.cursor = 'default';
        inc.appendChild(ic);
      }

      var cards = $('chooserCards');
      cards.replaceChildren();
      cfg.options.forEach(function (o) {
        var b = R.el('button', 'opt');
        b.type = 'button';
        b.appendChild(o.el);
        if (o.label) b.appendChild(R.el('div', 'lbl', o.label));
        if (o.sub) b.appendChild(R.el('div', 'sub', o.sub));
        b.addEventListener('click', function () { close(o.value); });
        cards.appendChild(b);
      });

      var foot = $('chooserFoot');
      foot.replaceChildren();
      (cfg.foot || []).forEach(function (f) {
        var b = R.el('button', 'btn btn--sub', f.label);
        b.type = 'button';
        b.addEventListener('click', function () { close(f.value); });
        foot.appendChild(b);
      });

      box.hidden = false;
      function close(v) { box.hidden = true; resolve(v); }
    });
  }

  function bareTile(text, big, sub) {
    var d = R.el('div', 'bare');
    d.appendChild(R.el('div', null, text));
    if (big) d.appendChild(R.el('div', 'big', big));
    if (sub) d.appendChild(R.el('div', null, sub));
    return d;
  }

  /* 場の山を開いて中身を全部見せる。拾えるときはそのまま選べる */
  function openPile(label, cards, idx) {
    var owned = ownedBases(S.game, S.human);
    var seen = {}, uniq = [];
    cards.forEach(function (c) {
      var k = c.kind + ':' + c.name;
      if (seen[k]) { seen[k].n++; return; }
      seen[k] = { card: c, n: 1 };
      uniq.push(seen[k]);
    });

    var opts = uniq.map(function (u) {
      var e = u.card.kind === 'tech' ? R.techCard(u.card, { owned: owned }) : R.faceTile(u.card);
      var ms = idx['field|' + u.card.kind + '|' + u.card.name];
      return {
        el: e,
        label: u.n > 1 ? (u.n + '枚') : '',
        sub: ms ? 'コイン1で拾う' : '',
        value: ms ? withUid(ms[0], u.card) : null
      };
    });

    var canTake = opts.some(function (o) { return o.value; });
    showChooser({
      title: '場の「' + label + '」　' + cards.length + '枚',
      sub: canTake ? 'コイン1枚で1枚もらえます。選んでください。' : '中身の確認だけです（拾うにはコインと自分の番が必要）。',
      options: opts,
      foot: [{ label: '閉じる', value: null }]
    }).then(function (v) { if (v) commit(v); });
  }

  /* ================================================================
   * 人間のエージェント
   * ============================================================== */
  function humanAgent() {
    return {
      cpu: false,
      decide: function (g, pi, req) {
        var owned = ownedBases(g, pi);
        switch (req.kind) {
          case 'action':
            return new Promise(function (resolve) {
              S.awaitAction = { options: req.options, resolve: resolve };
              S.sel = null; S.targeting = null;
              renderAll();
              var hb = document.querySelector('.handrow');
              hb.classList.remove('is-lit');
              void hb.offsetWidth;
              hb.classList.add('is-lit');
            });

          case 'catch': {
            var opts = req.options.filter(function (o) { return o.t !== 'none'; }).map(function (o) {
              if (o.t === 'tech') {
                return {
                  el: R.techCard(o.card, { owned: owned }),
                  label: R.diceLabel(o.dice) + ' で成功（' + o.dice.length + '/6）',
                  sub: o.keeper.name + '　失敗すると山札行き', value: o
                };
              }
              return {
                el: bareTile('素手キャッチ', R.diceLabel(o.dice), o.keeper.name),
                label: o.dice.length + '/6', sub: '失うカードなし', value: o
              };
            });
            return showChooser({
              title: 'シュートが来た！',
              sub: req.tech.eff.pierce
                ? '【貫通】素手キャッチは効かない。必殺キャッチだけが止められる。'
                : 'どう受ける？　必殺カードで受けると、失敗したときそのカードは山札に消える。',
              incoming: req.tech,
              options: opts,
              foot: [{ label: '受けない（失点する）', value: { t: 'none' } }]
            });
          }

          case 'dribble': {
            var dopts = req.options.filter(function (o) { return o.t !== 'none'; }).map(function (o) {
              return {
                el: R.techCard(o.card, { owned: owned }),
                label: R.diceLabel(o.dice) + ' で成功（' + o.dice.length + '/6）',
                sub: '失敗すると山札行き', value: o
              };
            });
            return showChooser({
              title: 'ディフェンスを仕掛けられた',
              sub: '振り切れば、そのまま自分の手番になる。失敗するとボールを奪われる。',
              incoming: req.tech,
              options: dopts,
              foot: [{ label: '振り切らない（ボールを渡す）', value: { t: 'none' } }]
            });
          }

          case 'pickField': {
            var fopts = req.options.map(function (c) {
              return { el: c.kind === 'tech' ? R.techCard(c, { owned: owned }) : R.faceTile(c), value: c };
            });
            return showChooser({
              title: req.purpose === 'toDeck' ? '場から1枚、山札に戻す' : '場から1枚、無料でもらう',
              sub: req.purpose === 'toDeck' ? '相手が狙っていそうなカードを消せます。' : 'コインを払わずに拾えます。',
              options: fopts, foot: []
            });
          }

          case 'followUpShot': {
            var sopts = [];
            req.options.forEach(function (card) {
              S.game.players.forEach(function (p, j) {
                if (j === S.human) return;
                sopts.push({ el: R.techCard(card, { owned: owned }), label: p.name + 'へ', value: { card: card, target: j } });
              });
            });
            return showChooser({
              title: '奪ってそのまま撃てる！',
              sub: '奪ったキャラクターがシュートワザを持っています。',
              options: sopts, foot: [{ label: '撃たない', value: null }]
            });
          }
        }
        return null;
      }
    };
  }

  /* ================================================================
   * 拡大表示
   * ============================================================== */
  function showZoom(c) {
    showChooser({
      title: c.name,
      sub: '',
      options: [{ el: R.bigCard(c), value: null }],
      foot: [{ label: '閉じる', value: null }]
    });
  }

  /* ================================================================
   * 決着
   * ============================================================== */
  function showFinish(g) {
    if (g !== S.game || g.endReason === 'aborted') return;
    var reason = {
      score: '規定点に到達', timeup: 'タイムアップ・最多得点',
      timeupFirst: 'タイムアップ・同点だが先に得点', draw: '全員0点', stuck: '進行が止まった（要調査）'
    }[g.endReason] || g.endReason;

    var scores = g.players.map(function (p) {
      return '<div><span>' + p.name + '（' + p.captain.name + '）</span><span>' + p.score + '</span></div>';
    }).join('');

    var word = (g.winner == null) ? '引き分け'
      : (g.winner === S.human ? 'あなたの勝ち！' : g.players[g.winner].name + ' の勝ち');

    Fx.finish(
      '<div class="finish__word">' + word + '</div>' +
      '<div class="finish__scores">' + scores + '</div>' +
      '<div class="finish__sub">' + reason + '　／　' + g.turnCount + '手　／　山札のこり ' + g.deck.length + '枚</div>',
      function () { $('setup').showModal(); });
  }

  /* ================================================================
   * CPU一括対戦
   * ============================================================== */
  async function runSim() {
    var o = readSetup();
    var n = Math.max(10, +$('simN').value || 300);
    $('simProg').hidden = false;
    $('simOut').replaceChildren();
    $('btnSimRun').disabled = true;

    var st = await Sim.run({
      playerCount: S.playerCount, handSize: o.handSize, winScore: o.winScore,
      coins: o.coins, techCopies: o.techCopies, charCopies: o.charCopies
    }, n, function (done, total) {
      $('simProgBar').style.inlineSize = (done / total * 100) + '%';
    });

    $('btnSimRun').disabled = false;
    $('simProg').hidden = true;
    $('simOut').innerHTML = simReport(st);
  }

  function simReport(st) {
    var P = Sim.pct;
    var g = st.games;
    function tbl(rows) {
      return '<table>' + rows.map(function (r) {
        return '<tr><th>' + r[0] + '</th><td' + (r[2] ? ' class="flag"' : '') + '>' + r[1] + '</td></tr>';
      }).join('') + '</table>';
    }

    var out = '';
    out += '<h3>決着</h3>' + tbl([
      ['試合数', g],
      [st.config.winScore + '点に到達して決着', P(st.decided, g) + '（' + st.decided + '）', st.decided / g < 0.5],
      ['タイムアップ（山札切れ）', P(st.timeup, g)],
      ['全員0点で引き分け', P(st.draw, g), st.draw / g > 0.1],
      ['進行停止（要調査）', P(st.stuck, g), st.stuck > 0],
      ['1試合の平均手数', (st.turns / g).toFixed(1)],
      ['最長', st.turnsMax + '手'],
      ['1試合の平均総得点', (st.goals / g).toFixed(2)],
      ['0-0で終わった試合', P(st.zeroGoalGames, g), st.zeroGoalGames / g > 0.1],
      ['手番が飛ばされた回数', (st.interrupts / g).toFixed(1) + '回/試合'],
      ['山札の残り平均', (st.deckLeft / g).toFixed(1) + '枚']
    ]);

    out += '<h3>シュートとキャッチ</h3>' + tbl([
      ['シュート試行', st.shoots + '（1試合 ' + (st.shoots / g).toFixed(1) + '）'],
      ['そもそも反応できなかった', P(st.noCatchPossible, st.shoots)],
      ['　└ 貫通のせいで無理', st.noCatchPierce],
      ['　└ GKがいない', st.noCatchNoGk],
      ['キャッチ試行', st.catchTried],
      ['　└ 素手', st.catchBare + '（成功 ' + P(st.catchBareOk, st.catchBare) + '）'],
      ['　└ 必殺キャッチ', st.catchTech + '（成功 ' + P(st.catchTechOk, st.catchTech) + '）'],
      ['シュートが止まった割合', P(st.catchOk, st.shoots)],
      ['シュートが決まった割合', P(st.goals, st.shoots)]
    ]);

    out += '<h3>【貫通】は効きすぎていないか</h3>' + tbl([
      ['貫通シュート', st.pierceShoots + '回（全体の ' + P(st.pierceShoots, st.shoots) + '）'],
      ['　└ 決まった割合', P(st.pierceGoals, st.pierceShoots), st.pierceGoals / (st.pierceShoots || 1) > 0.9],
      ['通常シュート', st.plainShoots + '回'],
      ['　└ 決まった割合', P(st.plainGoals, st.plainShoots)],
      ['必殺カードが山札に消えた枚数', (st.lostToDeck / g).toFixed(1) + '枚/試合'],
      ['炎の風見鶏が手札に戻った回数', (st.kazamidori / g).toFixed(2) + '回/試合', st.kazamidori / g > 1]
    ]);

    out += '<h3>全員が試合に参加できているか</h3>' + tbl([
      ['一度もボールに触らなかった人', P(st.neverBall, st.seats), st.neverBall / st.seats > 0.1],
      ['一度もシュートを撃たなかった人', P(st.neverShot, st.seats), st.neverShot / st.seats > 0.1],
      ['いちばん撃った人が占める割合', (st.topShare / (st.topShareN || 1) * 100).toFixed(1) + '%',
        st.topShare / (st.topShareN || 1) > 0.55]
    ]);

    out += '<h3>ディフェンスとドリブル</h3>' + tbl([
      ['ディフェンス試行', st.defenses],
      ['ドリブルで反応', st.dribbles + '（' + P(st.dribbles, st.defenses) + '）'],
      ['振り切り成功', P(st.dribbleOk, st.dribbles)],
      ['ボールが移動した回数', st.defenseOk]
    ]);

    out += '<h3>スカウト</h3>' + tbl([
      ['場から拾った', st.scouts + '（1試合 ' + (st.scouts / g).toFixed(1) + '）'],
      ['引き抜き', st.raids + '（1試合 ' + (st.raids / g).toFixed(2) + '）', st.raids / g < 0.2]
    ]);

    var caps = ['円堂守①', '円堂守②', '円堂守③', '円堂守④'];
    out += '<h3>円堂4種の勝率</h3>' + tbl(caps.map(function (nm, i) {
      return [nm, P(st.winByCaptain[i], st.gamesByCaptain[i]) + '（' + st.winByCaptain[i] + '/' + st.gamesByCaptain[i] + '）'];
    }));

    out += '<h3>得点したワザ（上位）</h3><table>' +
      Sim.topList(st.goalByTech, 12).map(function (r) {
        return '<tr><th>' + r.k + '</th><td>' + r.v + '</td></tr>';
      }).join('') + '</table>';

    out += '<h3>使われたキャッチ</h3><table>' +
      Object.keys(st.catchByTech).map(function (k) { return [k, st.catchByTech[k]]; })
        .sort(function (a, b) { return b[1].tried - a[1].tried; })
        .map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1].tried + '回中 ' + r[1].ok + '成功</td></tr>'; })
        .join('') + '</table>';

    var spread = Object.keys(st.scoreSpread).sort(function (a, b) { return st.scoreSpread[b] - st.scoreSpread[a]; }).slice(0, 8);
    out += '<h3>最終スコアの並び（多い順）</h3><table>' +
      spread.map(function (k) { return '<tr><th>' + k + '</th><td>' + P(st.scoreSpread[k], g) + '</td></tr>'; }).join('') +
      '</table>';

    out += '<h3>設定</h3>' + tbl([
      ['人数', st.config.playerCount], ['初期手札', st.config.handSize],
      ['勝利点', st.config.winScore], ['コイン', st.config.coins],
      ['必殺カード複製', st.config.techCopies], ['キャラカード複製', st.config.charCopies],
      ['山札総数', st.deckTotal]
    ]);
    out += '<p style="opacity:.6;margin-top:1rem">※ これは判断材料です。数値をどうするかは作者が決めてください。</p>';
    return out;
  }

  /* ================================================================
   * 起動
   * ============================================================== */
  function boot() {
    fitStage();
    global.addEventListener('resize', function () { fitStage(); if (S.game) renderAll(); });
    global.addEventListener('load', fitStage);
    requestAnimationFrame(fitStage);

    Fx.init($('fx'));
    buildSetup();

    $('btnStart').addEventListener('click', function () { $('setup').close(); startGame(); });
    $('btnSim').addEventListener('click', function () { $('setup').close(); $('simdlg').showModal(); });
    $('btnSimRun').addEventListener('click', runSim);
    $('btnSimClose').addEventListener('click', function () { $('simdlg').close(); $('setup').showModal(); });
    $('btnMenu').addEventListener('click', function () { $('setup').showModal(); });

    $('btnLog').addEventListener('click', function () {
      var open = $('logpane').hidden;
      $('logpane').hidden = !open;
      $('btnLog').setAttribute('aria-pressed', open ? 'true' : 'false');
    });
    $('btnLogClose').addEventListener('click', function () {
      $('logpane').hidden = true; $('btnLog').setAttribute('aria-pressed', 'false');
    });

    document.addEventListener('click', function () {
      if (S.sel || S.targeting) { S.sel = null; S.targeting = null; renderAll(); }
    });

    $('setup').showModal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
