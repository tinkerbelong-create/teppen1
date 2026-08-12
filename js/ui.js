/* テッペンとリーヨ！ ── 画面と操作
 *
 * 方針：メニューではなく「カードそのもの」を触って遊ぶ。
 *  - 今できることは、そのカードが光る
 *  - できないことは、そのカードが沈む
 *  - タップで持ち上げて、カードにくっついたボタンで決める
 *  - 上へドラッグして場へ／相手へ放り込んでもよい
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var E = NS.Engine, R = NS.Render, Fx = NS.Fx, DATA = NS.DATA, AI = NS.AI, Sim = NS.Sim;

  function $(id) { return document.getElementById(id); }

  var S = {
    game: null, human: -1,
    playerCount: 3, humanPlays: true, myCap: 1,
    awaitAction: null, sel: null, targeting: null,
    prevBall: 0, running: false, speed: 1
  };

  /* ================================================================
   * 設定シート
   * ============================================================== */
  function buildSetup() {
    var seg = $('segPlayers');
    seg.replaceChildren();
    [2, 3, 4].forEach(function (n) {
      var b = R.el('button', null, n + '人');
      b.type = 'button'; b.setAttribute('role', 'radio');
      b.addEventListener('click', function () { S.playerCount = n; syncSetup(); });
      b.dataset.n = n;
      seg.appendChild(b);
    });

    var cg = $('capGrid');
    cg.replaceChildren();
    DATA.captains.forEach(function (c) {
      var b = R.el('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.cap = c.cap;
      var im = document.createElement('img');
      im.src = R.url(c.img); im.alt = '';
      b.appendChild(im);
      var box = R.el('div');
      box.appendChild(R.el('b', null, c.name));
      var mine = R.techsOf(c);
      var kp = mine.main.concat(mine.sub).map(function (t) {
        return t.name + (t.dice ? '（' + R.diceLabel(t.dice) + '）' : '');
      }).join(' / ');
      box.appendChild(R.el('small', null, kp));
      b.appendChild(box);
      b.addEventListener('click', function () { S.myCap = c.cap; syncSetup(); });
      cg.appendChild(b);
    });

    ['optHand', 'optWin', 'optCoin', 'optTech', 'optChar'].forEach(function (id) {
      $(id).addEventListener('input', syncSetup);
    });
    $('optHuman').addEventListener('change', syncSetup);
    $('optSpeed').addEventListener('change', function () {
      S.speed = parseFloat($('optSpeed').value); Fx.setSpeed(S.speed);
    });
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
    var seg = $('segPlayers');
    Array.prototype.forEach.call(seg.children, function (b) {
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
      'そのうち ' + dealt + ' 枚を最初に配るので、山に残るのは ' + (deck - dealt) + ' 枚。' +
      '山札が尽きたらタイムアップです。';
  }

  /* ================================================================
   * ゲーム開始
   * ============================================================== */
  function makeAgents(n) {
    var agents = [];
    for (var i = 0; i < n; i++) {
      if (i === S.human) agents.push(humanAgent());
      else agents.push(cpuAgent());
    }
    return agents;
  }

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
    var o = readSetup();
    var n = S.playerCount;
    S.human = S.humanPlays ? 0 : -1;

    var caps = [1, 2, 3, 4];
    var rng = E.makeRng((Math.random() * 1e9) | 0);
    E.shuffle(caps, rng);
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

    var settings = {
      players: players, handSize: o.handSize, winScore: o.winScore,
      coins: o.coins, techCopies: o.techCopies, charCopies: o.charCopies,
      seed: (Math.random() * 1e9) | 0
    };

    var g = E.createGame(settings, makeAgents(n), onEvent);
    S.game = g;
    S.prevBall = g.ball;
    S.sel = null; S.targeting = null; S.awaitAction = null;
    $('logList').replaceChildren();
    $('app').hidden = false;
    Fx.clear();
    renderAll();
    S.running = true;
    E.run(g).then(function () { S.running = false; showFinish(g); },
      function (err) {
        /* 進行が止まったら黙って固まらせない。何が起きたか出して、やり直せるようにする */
        S.running = false;
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
    if (pi === S.human) return $('me');
    return document.querySelector('.opp[data-pi="' + pi + '"]') || $('scoreRows');
  }
  function cardElByUid(uid) { return document.querySelector('.card[data-uid="' + uid + '"]'); }
  function pname(g, pi) { return g.players[pi].name; }

  async function onEvent(ev, g) {
    addLog(ev, g);
    await animate(ev, g);
    renderAll();
  }

  function teamText(team) {
    return team.map(function (c) { return c.name; }).join(' ＋ ');
  }

  async function animate(ev, g) {
    switch (ev.k) {

      case 'turnStart':
        setBanner(pname(g, ev.p) + ' の番');
        if (ev.p !== S.human) await Fx.hold(260);
        break;

      case 'play': {
        var src = rectOf(cardElByUid(ev.card.uid));
        await Fx.flyCard(src, rectOf($('field')), ev.card, 480);
        break;
      }

      case 'shootDeclare': {
        var s1 = rectOf(cardElByUid(ev.tech.uid));
        if (s1) await Fx.flyCard(s1, { left: innerWidth / 2 - 40, top: innerHeight / 2 - 56, width: 80, height: 112 }, ev.tech, 380);
        await Fx.cutin(ev.tech, teamText(ev.team) + ' → ' + pname(g, ev.target),
          ev.pierce ? '貫通！素手では止まらない' : null, 1300);
        break;
      }

      case 'defenseDeclare': {
        var s2 = rectOf(cardElByUid(ev.tech.uid));
        if (s2) await Fx.flyCard(s2, { left: innerWidth / 2 - 40, top: innerHeight / 2 - 56, width: 80, height: 112 }, ev.tech, 380);
        await Fx.cutin(ev.tech, teamText(ev.team) + ' → ' + pname(g, ev.target) + ' からボールを狙う', null, 1150);
        break;
      }

      case 'catchDeclare':
        if (ev.mode === 'tech') {
          await Fx.cutin(ev.tech, ev.keeper.name + ' が立ちはだかる', null, 1050);
        } else {
          await Fx.toast(ev.keeper.name + ' の素手キャッチ！（' + R.diceLabel(ev.dice) + 'で成功）', 950);
        }
        break;

      case 'dribbleDeclare':
        await Fx.cutin(ev.tech, teamText(ev.team) + ' が振り切りにかかる', null, 1050);
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
        var from = rectOf(playerEl(S.prevBall));
        var to = rectOf(playerEl(ev.to));
        if (S.prevBall !== ev.to) await Fx.flyBall(from, to);
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
          var sep = R.el('li', 'turnsep', '― ' + (ev.turn + 1) + '手目 ―');
          list.appendChild(sep);
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

  function renderAll() {
    var g = S.game;
    if (!g) return;
    var idx = moveIndex();
    renderScore(g);
    renderOpponents(g, idx);
    renderField(g, idx);
    renderMe(g, idx);
    renderHand(g, idx);
    renderMeta(g);
    mountActs();
    if (S.targeting) setBanner('だれに撃つ？　相手をタップ');
    else if (S.awaitAction) setBanner('あなたの番　カードをタップ、または上へドラッグ');
  }

  /* 選んだカードの真上に操作チップを貼る（手札は横スクロールするので body 直下に置く） */
  function mountActs() {
    var old = document.getElementById('actsLayer');
    if (old) old.remove();
    if (!S.sel) return;
    var el = cardElByUid(S.sel);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'center' });
    var box = buildActs(el, el._card, el._moves);
    box.id = 'actsLayer';
    document.body.appendChild(box);
    var r = el.getBoundingClientRect();
    var b = box.getBoundingClientRect();
    box.style.left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), global.innerWidth - b.width - 8) + 'px';
    var top = r.top - b.height - 12;
    box.style.top = (top < 8 ? r.bottom + 12 : top) + 'px';
  }

  function renderScore(g) {
    var box = $('scoreRows');
    box.replaceChildren();
    g.players.forEach(function (p, i) {
      var c = R.el('div', 'pchip');
      if (i === g.turn) c.classList.add('is-turn');
      if (i === g.ball) c.classList.add('is-ball');
      if (i === S.human) c.classList.add('is-me');
      c.appendChild(R.el('div', 'pchip__score', String(p.score)));
      c.appendChild(R.el('div', 'pchip__name', p.name));
      c.appendChild(R.el('div', 'pchip__meta', p.captain.name + '・手札' + p.hand.length));
      box.appendChild(c);
    });
  }

  function renderMeta(g) {
    var coins = S.human >= 0 ? E.countCoins(g, S.human) : 0;
    var m = $('handMeta');
    m.replaceChildren();
    function add(label, val) {
      var s = R.el('span');
      s.appendChild(document.createTextNode(label + ' '));
      s.appendChild(R.el('b', null, String(val)));
      m.appendChild(s);
    }
    add('山札', g.deck.length);
    add('場', g.field.length);
    add('捨て札', g.discard.length);
    if (S.human >= 0) { add('コイン', coins); add('得点', g.players[S.human].score + '/' + g.settings.winScore); }
    else add('観戦中', '');
  }

  function renderOpponents(g, idx) {
    var box = $('opponents');
    box.replaceChildren();
    g.players.forEach(function (p, i) {
      if (i === S.human) return;
      var o = R.el('div', 'opp');
      o.dataset.pi = i;
      if (i === g.turn) o.classList.add('is-turn');

      var head = R.el('div', 'opp__head');
      head.appendChild(R.el('span', 'opp__name', p.name));
      head.appendChild(R.el('span', 'opp__score', String(p.score)));
      if (i === g.ball) head.appendChild(R.el('span', 'opp__ball', '⚽'));
      o.appendChild(head);

      var cards = R.el('div', 'opp__cards');
      var cap = R.card(p.captain);
      cap.classList.add('card--nano');
      tagCard(cap, p.captain, 'oppcap', i);
      cards.appendChild(cap);
      E.handChars(g, i).forEach(function (c) {
        var e = R.card(c);
        e.classList.add('card--nano');
        var ms = idx['opp' + i + '|char|' + c.name];
        tagCard(e, c, 'opp' + i, i, ms);
        cards.appendChild(e);
      });
      o.appendChild(cards);

      var hid = E.hiddenHand(g, i).length;
      var hbox = R.el('div', 'opp__hidden');
      for (var k = 0; k < Math.min(hid, 5); k++) hbox.appendChild(R.el('span', 'fan'));
      hbox.appendChild(document.createTextNode('伏せ ' + hid));
      o.appendChild(hbox);

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

  function renderField(g, idx) {
    var box = $('field');
    box.replaceChildren();
    if (!g.field.length) {
      box.appendChild(R.el('div', 'field__empty', 'まだ何も落ちていない。技を撃つと、そのカードはここに落ちる。'));
      return;
    }
    var order = { 'シュート': 0, 'ドリブル': 1, 'ディフェンス': 2, 'キャッチ': 3 };
    var sorted = g.field.slice().sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'char' ? 1 : -1;
      if (a.kind === 'tech') return (order[a.type] - order[b.type]) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    sorted.forEach(function (c) {
      var e = R.card(c);
      e.classList.add('card--mini');
      tagCard(e, c, 'field', -1, idx['field|' + c.kind + '|' + c.name]);
      box.appendChild(e);
    });
  }

  function renderMe(g, idx) {
    var box = $('me');
    box.replaceChildren();
    if (S.human < 0) {
      box.appendChild(R.el('div', 'me__label', 'CPU同士の試合を見ています'));
      return;
    }
    box.appendChild(R.el('div', 'me__label', '自分の選手（公開）'));
    var cap = R.card(g.players[S.human].captain);
    tagCard(cap, g.players[S.human].captain, 'cap', -1);
    box.appendChild(cap);
    E.handChars(g, S.human).forEach(function (c) {
      var e = R.card(c);
      tagCard(e, c, 'own', -1, idx['own|char|' + c.name]);
      box.appendChild(e);
    });
  }

  function renderHand(g, idx) {
    var box = $('hand');
    box.replaceChildren();
    if (S.human < 0) {
      box.appendChild(R.el('div', 'hand__empty', '観戦モード。CPUだけで進みます。'));
      return;
    }
    var hand = g.players[S.human].hand.filter(function (c) { return c.kind !== 'char'; });
    if (!hand.length) { box.appendChild(R.el('div', 'hand__empty', '伏せて持つカードがない')); return; }
    var rank = { tech: 0, coin: 1, ball: 2 };
    var to = { 'シュート': 0, 'ドリブル': 1, 'ディフェンス': 2, 'キャッチ': 3 };
    hand.sort(function (a, b) {
      if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
      if (a.kind === 'tech') return (to[a.type] - to[b.type]) || a.name.localeCompare(b.name);
      return 0;
    });
    hand.forEach(function (c) {
      var e = R.card(c);
      var ms = c.kind === 'tech' ? idx['own|tech|' + c.name] : idx['own|' + c.kind + '|' + c.name];
      tagCard(e, c, 'own', -1, ms);
      box.appendChild(e);
    });
  }

  /* カードに「今できること」を貼りつける */
  function tagCard(e, cardData, zone, oppIdx, moves) {
    e.dataset.zone = zone;
    e.dataset.name = cardData.name || '';
    e._card = cardData;
    e._moves = moves || null;

    /* 見た目の3段階
     *   is-live … この1枚で「今すぐ」ワザが撃てる／拾える／引き抜ける
     *   ふつう  … 場に出すことはできる（いつでもできるので目立たせない）
     *   is-dim  … 相手の番。自分は何もできない
     * 「使えるカードが光る」を、意味のある違いにするための切り分け。 */
    var kinds = {};
    (moves || []).forEach(function (m) { kinds[m.t] = 1; });
    var liveLabel = kinds.shoot ? '撃てる'
      : kinds.defense ? '奪える'
        : kinds.scoutField ? '拾える'
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
    var g = S.game;

    function chip(label, cls, fn) {
      var b = R.el('button', cls || null, label);
      b.type = 'button';
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      box.appendChild(b);
    }

    (moves || []).forEach(function (m) { m._label = null; });

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
    if (byType.defense) {
      chip('ディフェンス！', null, function () {
        commit(withUid(byType.defense[0], cardData));
      });
    }
    if (byType.play) {
      chip('場に出す＋1枚引く', 'sub', function () {
        commit(withUid(byType.play[0], cardData));
      });
    }
    if (byType.scoutField) {
      chip('拾う ⚡1', null, function () { commit(withUid(byType.scoutField[0], cardData)); });
    }
    if (byType.scoutPlayer) {
      chip('引き抜く ⚡2', null, function () { commit(withUid(byType.scoutPlayer[0], cardData)); });
    }
    chip('見る', 'sub', function () { showZoom(cardData); });
    chip('やめる', 'sub', function () { S.sel = null; renderAll(); });
    return box;
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
    document.querySelector('.handbar').classList.remove('is-lit');
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
      moved: false, ghost: null, id: ev.pointerId
    };
    global.addEventListener('pointermove', onCardMove);
    global.addEventListener('pointerup', onCardUp);
    global.addEventListener('pointercancel', onCardCancel);
  }

  function canDragFrom(zone) { return zone === 'own'; }

  function onCardMove(ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 12) return;
      if (!drag.moves || !drag.moves.length || !canDragFrom(drag.el.dataset.zone)) { cleanupDrag(); return; }
      if (Math.abs(dy) < Math.abs(dx)) { cleanupDrag(); return; }   /* 横は手札スクロールに譲る */
      drag.moved = true;
      startGhost(ev);
    }
    var r = drag.rect;
    drag.ghost.style.left = (ev.clientX - r.w / 2) + 'px';
    drag.ghost.style.top = (ev.clientY - r.h * 0.62) + 'px';
    highlightDrop(ev.clientX, ev.clientY);
  }

  function startGhost(ev) {
    var b = drag.el.getBoundingClientRect();
    drag.rect = { w: b.width, h: b.height };
    var gh = R.card(drag.card);
    gh.classList.add('is-drag');
    gh.style.width = b.width + 'px';
    gh.style.height = b.height + 'px';
    document.body.appendChild(gh);
    drag.ghost = gh;
    drag.el.style.opacity = '.25';

    var types = {};
    drag.moves.forEach(function (m) { types[m.t] = 1; });
    drag.types = types;
    if (types.play) $('field').classList.add('is-dropzone');
    if (types.shoot || types.defense) {
      document.querySelectorAll('.opp').forEach(function (o) {
        var pi = +o.dataset.pi;
        var ok = drag.moves.some(function (m) {
          return (m.t === 'shoot' && m.target === pi) || (m.t === 'defense' && m.target === pi);
        });
        if (ok) o.classList.add('is-targetable');
      });
    }
  }

  function highlightDrop(x, y) {
    var el = document.elementFromPoint(x, y);
    document.querySelectorAll('.opp.is-hot').forEach(function (o) { o.classList.remove('is-hot'); });
    $('field').classList.toggle('is-hot', !!(el && el.closest && el.closest('.fieldzone')));
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
    var moves = drag.moves, card = drag.card;
    var chosen = null;
    if (target && target.closest) {
      var opp = target.closest('.opp');
      if (opp) {
        var pi = +opp.dataset.pi;
        chosen = moves.filter(function (m) { return (m.t === 'shoot' || m.t === 'defense') && m.target === pi; })[0] || null;
      } else if (target.closest('.fieldzone')) {
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
    $('field').classList.remove('is-dropzone', 'is-hot');
    document.querySelectorAll('.opp').forEach(function (o) { o.classList.remove('is-hot'); });
    if (!S.targeting) document.querySelectorAll('.opp').forEach(function (o) { o.classList.remove('is-targetable'); });
  }

  function tapCard(el, ev) {
    var cardEl = (ev.target.closest && ev.target.closest('.card')) || el;
    if (!cardEl || !cardEl._card) return;
    var c = cardEl._card;
    if (!S.awaitAction || !cardEl._moves || !cardEl._moves.length) { showZoom(c); return; }
    S.sel = (S.sel === c.uid) ? null : c.uid;
    S.targeting = null;
    renderAll();
  }

  /* ================================================================
   * 選ばせるパネル（リアクションなど）
   * ============================================================== */
  function showChooser(cfg) {
    return new Promise(function (resolve) {
      var box = $('chooser');
      $('chooserTitle').textContent = cfg.title;

      var sub = $('chooserSub');
      sub.replaceChildren();
      if (cfg.incoming) {
        var row = R.el('div');
        row.style.cssText = 'display:flex;gap:.7rem;align-items:center;';
        var ic = R.card(cfg.incoming, true);
        ic.classList.add('card--mini');
        ic.style.cursor = 'default';
        row.appendChild(ic);
        row.appendChild(R.el('div', null, cfg.sub || ''));
        sub.appendChild(row);
      } else if (cfg.sub) {
        sub.textContent = cfg.sub;
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

  /* ================================================================
   * 人間のエージェント
   * ============================================================== */
  function humanAgent() {
    return {
      cpu: false,
      decide: function (g, pi, req) {
        switch (req.kind) {
          case 'action':
            return new Promise(function (resolve) {
              S.awaitAction = { options: req.options, resolve: resolve };
              S.sel = null; S.targeting = null;
              renderAll();
              var hb = document.querySelector('.handbar');
              hb.classList.remove('is-lit');
              void hb.offsetWidth;                    /* アニメを撃ち直す */
              hb.classList.add('is-lit');
            });

          case 'catch': {
            var opts = req.options.filter(function (o) { return o.t !== 'none'; }).map(function (o) {
              if (o.t === 'tech') {
                var e = R.card(o.card, true);
                e.style.cursor = 'pointer';
                return { el: e, label: R.diceLabel(o.dice) + ' で成功', sub: o.keeper.name + '　失敗すると山札行き', value: o };
              }
              return {
                el: bareTile('素手キャッチ', R.diceLabel(o.dice), o.keeper.name),
                label: (o.dice.length) + '/6', sub: '失うカードなし', value: o
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
              var e = R.card(o.card, true);
              return { el: e, label: R.diceLabel(o.dice) + ' で成功', sub: '失敗すると山札行き', value: o };
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
              var e = R.card(c, true);
              e.classList.add('card--mini');
              return { el: e, value: c };
            });
            return showChooser({
              title: req.purpose === 'toDeck' ? '場から1枚、山札に戻す' : '場から1枚、無料でもらう',
              sub: req.purpose === 'toDeck' ? '相手が狙っていそうなカードを消せる。' : 'コインを払わずに拾える。',
              options: fopts, foot: []
            });
          }

          case 'followUpShot': {
            var sopts = [];
            req.options.forEach(function (card) {
              S.game.players.forEach(function (p, j) {
                if (j === S.human) return;
                var e = R.card(card, true);
                e.classList.add('card--mini');
                sopts.push({ el: e, label: p.name + 'へ', value: { card: card, target: j } });
              });
            });
            return showChooser({
              title: '奪ってそのまま撃てる！',
              sub: '奪ったキャラクターがシュートワザを持っている。',
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
    var z = $('zoom'), inner = $('zoomInner');
    inner.replaceChildren(R.card(c, true));
    if (!z.open) z.showModal();
  }

  /* ================================================================
   * 決着
   * ============================================================== */
  function showFinish(g) {
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
      function () { $('setup').showModal(); }
    );
  }

  /* ================================================================
   * CPU一括対戦
   * ============================================================== */
  async function runSim() {
    var o = readSetup();
    var n = Math.max(10, +$('simN').value || 300);
    var base = {
      playerCount: S.playerCount, handSize: o.handSize, winScore: o.winScore,
      coins: o.coins, techCopies: o.techCopies, charCopies: o.charCopies
    };
    $('simProg').hidden = false;
    $('simOut').replaceChildren();
    $('btnSimRun').disabled = true;

    var st = await Sim.run(base, n, function (done, total) {
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

    var decidedRate = st.decided / g;
    var out = '';
    out += '<h3>決着</h3>' + tbl([
      ['試合数', g],
      [st.config.winScore + '点に到達して決着', P(st.decided, g) + '（' + st.decided + '）', decidedRate < 0.5],
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
      ['1試合を通してボールに一度も触らなかった人', P(st.neverBall, st.seats), st.neverBall / st.seats > 0.1],
      ['一度もシュートを撃たなかった人', P(st.neverShot, st.seats), st.neverShot / st.seats > 0.1],
      ['いちばん撃った人が占めるシュートの割合', (st.topShare / (st.topShareN || 1) * 100).toFixed(1) + '%',
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
      var w = st.winByCaptain[i], pl = st.gamesByCaptain[i];
      return [nm, P(w, pl) + '（' + w + '/' + pl + '）'];
    }));

    var gb = Sim.topList(st.goalByTech, 12);
    out += '<h3>得点したワザ（上位）</h3><table>' +
      gb.map(function (r) { return '<tr><th>' + r.k + '</th><td>' + r.v + '</td></tr>'; }).join('') + '</table>';

    var cb = Object.keys(st.catchByTech).map(function (k) {
      return [k, st.catchByTech[k].tried, st.catchByTech[k].ok];
    }).sort(function (a, b) { return b[1] - a[1]; });
    out += '<h3>使われたキャッチ</h3><table>' +
      cb.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '回中 ' + r[2] + '成功</td></tr>'; }).join('') +
      '</table>';

    var spread = Object.keys(st.scoreSpread).sort(function (a, b) { return st.scoreSpread[b] - st.scoreSpread[a]; }).slice(0, 8);
    out += '<h3>最終スコアの並び（多い順）</h3><table>' +
      spread.map(function (k) { return '<tr><th>' + k + '</th><td>' + P(st.scoreSpread[k], g) + '</td></tr>'; }).join('') +
      '</table>';

    out += '<h3>設定</h3>' + tbl([
      ['人数', st.config.playerCount],
      ['初期手札', st.config.handSize],
      ['勝利点', st.config.winScore],
      ['コイン', st.config.coins],
      ['必殺カード複製', st.config.techCopies],
      ['キャラカード複製', st.config.charCopies],
      ['山札総数', st.deckTotal]
    ]);
    out += '<p style="opacity:.6;margin-top:1rem">※ これは判断材料です。数値をどうするかは作者が決めてください。</p>';
    return out;
  }

  /* ================================================================
   * 起動
   * ============================================================== */
  function boot() {
    Fx.init($('fx'));
    buildSetup();

    $('btnStart').addEventListener('click', function () { $('setup').close(); startGame(); });
    $('btnSim').addEventListener('click', function () { $('setup').close(); $('simdlg').showModal(); });
    $('btnSimRun').addEventListener('click', runSim);
    $('btnSimClose').addEventListener('click', function () { $('simdlg').close(); $('setup').showModal(); });
    $('btnMenu').addEventListener('click', function () { $('setup').showModal(); });
    $('zoomClose').addEventListener('click', function () { $('zoom').close(); });
    $('zoom').addEventListener('click', function (e) { if (e.target.id === 'zoom') $('zoom').close(); });

    $('btnLog').addEventListener('click', function () {
      var open = $('logpane').hidden;
      $('logpane').hidden = !open;
      $('btnLog').setAttribute('aria-pressed', open ? 'true' : 'false');
    });
    $('btnLogClose').addEventListener('click', function () {
      $('logpane').hidden = true; $('btnLog').setAttribute('aria-pressed', 'false');
    });

    /* 何もないところをタップしたら選択解除 */
    document.addEventListener('click', function () {
      if (S.sel || S.targeting) { S.sel = null; S.targeting = null; renderAll(); }
    });

    $('setup').showModal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
