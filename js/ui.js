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
  var SE = NS.SE;

  function $(id) { return document.getElementById(id); }

  var W = NS.Wire, Net = NS.Net;

  var S = {
    game: null, human: -1,
    playerCount: CFG.defaults.playerCount,
    humanPlays: CFG.defaults.humanPlays,
    myCap: CFG.defaults.captain,
    awaitAction: null, sel: null, targeting: null,
    prevBall: 0, speed: CFG.defaults.speed,
    layout: 'wide',
    lastTurnPlayer: 0,
    /* 通信対戦 */
    mode: 'cpu',            /* 'cpu' | 'host' | 'guest' */
    netSeats: {}, netCount: 2, rid: 0, viewN: 0,
    gQueue: [], gBusy: false, gLastN: -1, gLastRid: -1
  };

  /* ================================================================
   * 版面をウィンドウに合わせる
   * ============================================================== */
  /* 版面は2つ用意する。横長（PC・スマホ横持ち）と縦長（スマホ縦持ち）。
   * どちらも「決めた寸法どおりに組んで、画面に合わせて全体を縮める」やり方は同じ。
   * 数字の単位は rem（1rem ＝ 16px × 倍率）。 */
  var LAYOUT = {
    wide: {
      w: 1440, h: 810, rem: 16,
      handW: 90 - 1.8 - 4 - 0.8, handH: 50.625 - 3.25 - 12.5 - 10 - 9 - 1,
      maxCw: 20, myW: 90 - 1.8 - 2.2, myH: 9 - 0.85, myTw: 7.2,
      oppH: 12.5 - 0.8 - 1.5, oppTw: 4.6, oppPad: 1.1, stageW: 90, pad: 1.8,
      compactPiles: false
    },
    tall: {
      w: 390, h: 780, rem: 16,
      handW: 24.375 - 1.0 - 1.6 - 0.35, handH: 48.75 - 2.6 - 9.0 - 7.4 - 6.8 - 0.9,
      maxCw: 20, myW: 24.375 - 1.0 - 1.6, myH: 6.8 - 0.8, myTw: 5.4,
      oppH: 9.0 - 0.7 - 1.4, oppTw: 3.6, oppPad: 0.85, stageW: 24.375, pad: 1.0,
      compactPiles: true
    }
  };
  function LP() { return LAYOUT[S.layout] || LAYOUT.wide; }

  function fitStage() {
    var de = document.documentElement;
    var w = de.clientWidth || global.innerWidth || 1440;
    var h = de.clientHeight || global.innerHeight || 810;
    /* 縦のほうが長い、または横幅が狭いときは縦持ち用に切り替える */
    var mode = (h > w * 1.05 || w < 820) ? 'tall' : 'wide';
    S.layout = mode;
    var c = LAYOUT[mode];
    var st = $('stage');
    if (st) st.dataset.mode = mode;
    /* 起動直後にウィンドウの大きさが 0 で返ってくることがある。下限を入れておく */
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

    ['optHand', 'optWin', 'optTech', 'optChar',
      'optCoinStart', 'optCoinReact', 'optCoinStreak', 'optCoinConcede', 'optCoinPlay', 'optCoinCap'
    ].forEach(function (id) { $(id).addEventListener('input', syncSetup); });
    $('optRoster').addEventListener('change', syncSetup);
    $('optHuman').addEventListener('change', syncSetup);

    /* config.js の既定値を画面に流し込む */
    var d = CFG.defaults, c = CFG.coin;
    $('optHand').value = d.handSize; $('optWin').value = d.winScore;
    $('optTech').value = d.techCopies; $('optChar').value = d.charCopies;
    $('optRoster').value = d.roster;
    $('optCoinStart').value = c.start; $('optCoinReact').value = c.onReact;
    $('optCoinStreak').value = c.onReactStreak; $('optCoinConcede').value = c.onConcede;
    $('optCoinPlay').value = c.onPlay; $('optCoinCap').value = c.cap;
    $('optSpeed').value = String(CFG.defaults.speed);
    $('optSpeed').addEventListener('change', function () {
      S.speed = parseFloat($('optSpeed').value); Fx.setSpeed(S.speed);
    });
    Fx.setSpeed(S.speed);
    syncSetup();
  }

  function readSetup() {
    return {
      handSize: Math.max(1, +$('optHand').value || 14),
      winScore: Math.max(1, +$('optWin').value || 3),
      techCopies: Math.max(1, +$('optTech').value || 1),
      charCopies: Math.max(1, +$('optChar').value || 1),
      roster: $('optRoster').value,
      coin: {
        start: Math.max(0, +$('optCoinStart').value || 0),
        onReact: Math.max(0, +$('optCoinReact').value || 0),
        onReactStreak: Math.max(0, +$('optCoinStreak').value || 0),
        onConcede: Math.max(0, +$('optCoinConcede').value || 0),
        onPlay: Math.max(0, +$('optCoinPlay').value || 0),
        reactDraw: CFG.coin.reactDraw,
        cap: Math.max(1, +$('optCoinCap').value || 12)
      }
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
    var r = DATA.rosterFor(o.roster);
    var deck = r.chars.length * o.charCopies + r.techs.length * o.techCopies + 1;
    var dealt = o.handSize * S.playerCount;
    $('deckNote').textContent =
      '山札は ' + deck + ' 枚（キャラ ' + r.chars.length + '種×' + o.charCopies +
      '＝' + (r.chars.length * o.charCopies) + '枚／必殺 ' + r.techs.length + '種×' + o.techCopies +
      '＝' + (r.techs.length * o.techCopies) + '枚／ボール1枚）。' +
      'コインはカードではなくトークンなので山札に入りません。' +
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

  /* net を渡すと通信対戦のホストとして始める。
   *   net = { seats: {席番号: {name}}, count: 席の数 } */
  function startGame(net) {
    /* 前の試合がまだ走っていたら止める。
     * 止めないと2つの試合が同じ盤面に描き込み、決着表示まで混ざる。 */
    if (S.game) S.game.aborted = true;

    var o = readSetup();
    var n, i, j;

    if (net) {
      S.mode = 'host';
      S.human = 0;
      n = net.count;
      S.remoteSeats = [];
      for (i = 1; i < n; i++) if (net.seats[i]) S.remoteSeats.push(i);
    } else {
      S.mode = 'cpu';
      S.remoteSeats = [];
      n = S.playerCount;
      S.human = S.humanPlays ? 0 : -1;
    }

    var caps = [1, 2, 3, 4];
    E.shuffle(caps, E.makeRng((Math.random() * 1e9) | 0));
    if (S.human === 0 && !net) {
      caps.splice(caps.indexOf(S.myCap), 1);
      caps.unshift(S.myCap);
    }

    var players = [];
    for (i = 0; i < n; i++) {
      var nm;
      if (net) nm = net.seats[i] ? net.seats[i].name : ('CPU' + (i + 1));
      else nm = (i === S.human) ? 'あなた' : 'CPU' + (S.human === 0 ? i : i + 1);
      players.push({ name: nm, cpu: net ? !net.seats[i] : (i !== S.human), captain: caps[i] });
    }

    var agents = [];
    for (j = 0; j < n; j++) {
      if (j === S.human) agents.push(humanAgent());
      else if (net && net.seats[j]) agents.push(remoteAgent(j));
      else agents.push(cpuAgent());
    }

    var g = E.createGame({
      players: players, handSize: o.handSize, winScore: o.winScore,
      techCopies: o.techCopies, charCopies: o.charCopies,
      roster: o.roster, coin: o.coin,
      seed: (Math.random() * 1e9) | 0
    }, agents, onEvent);

    S.game = g;
    S.prevBall = g.ball;
    S.sel = null; S.targeting = null; S.awaitAction = null;
    lastTurn = -1;
    $('logList').replaceChildren();
    $('home').hidden = true;
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
        function () { showHome(); });
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

  /* ---------------- カードの呼び名 ----------------
   * 記録（ログ）と一言表示で使う。
   * イナズマイレブンを知らない人が読んでも、選手なのかワザなのか、
   * ワザならどの種類なのかが分かるように、名前の前に必ず種別を付ける。
   *   例）シュート技【ツインブースト】／選手【豪炎寺（FW・雷門）】 */
  function cardLabel(card) {
    if (!card) return '';
    if (card.kind === 'tech') return (card.type || '必殺') + '技【' + card.name + '】';
    if (card.kind === 'ball') return 'ボールカード';
    if (card.cap) return 'キャプテン【' + card.name + '】';
    var d = [];
    if (card.pos) d.push(card.pos);
    if (card.team) d.push(card.team);
    return '選手【' + card.name + (d.length ? '（' + d.join('・') + '）' : '') + '】';
  }
  /* 演出の一言など、短く出したいとき（チーム名までは出さない） */
  function cardShort(card) {
    if (!card) return '';
    if (card.kind === 'tech') return (card.type || '必殺') + '技【' + card.name + '】';
    if (card.kind === 'ball') return 'ボールカード';
    return '選手【' + card.name + '】';
  }
  /* ワザに使った選手を「（使った選手：豪炎寺 ＋ 染岡）」の形にする */
  function teamNote(team) {
    if (!team || !team.length) return '';
    return '（使った選手：' + teamText(team) + '）';
  }
  /* サイコロの必要な出目 */
  function needText(dice) {
    if (!dice || !dice.length) return '';
    return '必要な出目 ' + dice.join('・');
  }
  /* コインをもらった理由 */
  var COIN_WHY = {
    react: 'リアクション成功のごほうび',
    concede: '失点したおわび',
    effect: 'ワザの効果',
    play: '手番Aのごほうび'
  };

  async function onEvent(ev, g) {
    if (g !== S.game) return;          /* やり直し前の試合の出来事は捨てる */

    /* ホストは、出来事と「その席から見える盤面」を全員に配る。
     * 席ごとに別の場所へ書くので、他人の伏せ札は相手の端末に届かない。 */
    if (S.mode === 'host' && S.remoteSeats && S.remoteSeats.length) {
      S.viewN++;
      var views = {};
      S.remoteSeats.forEach(function (seat) { views[seat] = W.packView(g, seat); });
      Net.pushViews(S.viewN, W.packEv(ev), views);
      /* 手番の区切りで状態を保存しておく。ホストが落ちても、ここから再開できる */
      if (ev.k === 'turnStart') Net.saveSnapshot(W.packSnapshot(g));
    }

    addLog(ev, g);
    await animate(ev, g);
    if (g !== S.game) return;
    renderAll();
  }

  /* ================================================================
   * 通信対戦：ホスト側（ルール処理はこの端末だけで動く）
   * ============================================================== */

  /* 遠くのプレイヤーに「何を選ぶか」を聞きに行く役 */
  function remoteAgent(seat) {
    var fallback = AI.makeAgent();
    return {
      cpu: false, remote: true,
      decide: async function (g, pi, req) {
        var rid = ++S.rid;
        try {
          await Net.pushPrompt(seat, rid, W.packPrompt(req));
        } catch (e) { return fallback.decide(g, pi, req); }

        var plain = await Net.waitAction(seat, rid, 150000);
        try { await Net.clearPrompt(seat); } catch (e) { }

        if (plain == null) {
          /* 返事がない（電波が切れた・画面を閉じた）。試合が止まらないようCPUが代打 */
          await Fx.toast(g.players[pi].name + ' の返事がないので、CPUが代わりに動きます', 1100);
          return fallback.decide(g, pi, req);
        }
        return W.resolveChoice(req, plain) || fallback.decide(g, pi, req);
      }
    };
  }

  /* ================================================================
   * 通信対戦：ゲスト側（画面を受け取って、押した結果を返すだけ）
   * ============================================================== */
  function guestStart(seat) {
    S.mode = 'guest';
    S.human = seat;
    S.game = null;
    S.gQueue = []; S.gBusy = false; S.gLastN = -1; S.gLastRid = -1;
    lastTurn = -1;
    $('logList').replaceChildren();
    $('home').hidden = true;
    $('stage').hidden = false;
    Fx.clear();
    fitStage();
    setBanner('ホストの準備を待っています…');
    Net.onMyView(function (v) {
      if (v.n !== undefined && v.n !== S.gLastN) {
        S.gLastN = v.n;
        S.gQueue.push({ state: v.state, ev: v.ev });
      }
      if (v.prompt && v.prompt.rid !== S.gLastRid) {
        S.gLastRid = v.prompt.rid;
        S.gQueue.push({ prompt: v.prompt });
      }
      guestDrain();
    });
  }

  async function guestDrain() {
    if (S.gBusy) return;
    S.gBusy = true;
    try {
      while (S.gQueue.length) {
        var job = S.gQueue.shift();
        if (job.state) {
          S.game = W.unpackView(job.state);
          S.human = job.state.seat;
          if (job.ev) {
            var ev = W.unpackEv(job.ev);
            addLog(ev, S.game);
            await animate(ev, S.game);
            if (ev.k === 'end') { renderAll(); showFinish(S.game); continue; }
          }
          renderAll();
        }
        if (job.prompt) {
          var req = W.unpackPrompt(job.prompt.req);
          var choice = await humanDecide(req);
          try {
            await Net.sendAction(job.prompt.rid, W.packChoice(req.kind, choice));
          } catch (e) { console.error(e); }
          setBanner('相手の番を待っています…');
        }
      }
    } finally { S.gBusy = false; }
  }

  var CENTER = function () {
    return { left: global.innerWidth / 2 - 60, top: global.innerHeight / 2 - 40, width: 120, height: 80 };
  };

  async function animate(ev, g) {
    switch (ev.k) {

      case 'turnStart':
        setBanner(pname(g, ev.p) + ' の番');
        S.lastTurnPlayer = ev.p;
        SE.play('turn');
        if (ev.p !== S.human) await Fx.hold(240);
        break;

      case 'play':
        SE.play('card');
        await Fx.flyCard(rectOf(cardElByUid(ev.card.uid)), rectOf($('piles')), ev.card, 480);
        break;

      case 'shootDeclare': {
        var s1 = rectOf(cardElByUid(ev.tech.uid));
        if (s1) await Fx.flyCard(s1, CENTER(), ev.tech, 340);
        SE.play('cutin');
        await Fx.cutin(ev.tech, teamText(ev.team) + ' → ' + pname(g, ev.target),
          ev.pierce ? '貫通！　素手では止まらない' : null, 1350);
        break;
      }

      case 'defenseDeclare': {
        var s2 = rectOf(cardElByUid(ev.tech.uid));
        if (s2) await Fx.flyCard(s2, CENTER(), ev.tech, 340);
        SE.play('cutin');
        await Fx.cutin(ev.tech, teamText(ev.team) + ' → ' + pname(g, ev.target) + ' からボールを狙う', null, 1200);
        break;
      }

      case 'catchDeclare':
        if (ev.mode === 'tech') {
          SE.play('cutin');
          await Fx.cutin(ev.tech, ev.keeper.name + ' が立ちはだかる', null, 1150);
        } else {
          await Fx.toast(pname(g, ev.p) + ' の素手キャッチ！（キーパー：' + ev.keeper.name +
            '／' + R.diceLabel(ev.dice) + ' が出れば成功）', 1100);
        }
        break;

      case 'dribbleDeclare':
        SE.play('cutin');
        await Fx.cutin(ev.tech, teamText(ev.team) + ' が振り切りにかかる', null, 1150);
        break;

      case 'noCatch':
        SE.play('fail');
        await Fx.toast(ev.reason === 'pierce'
          ? pname(g, ev.p) + ' はキーパー技を持っていない…　貫通シュートは止まらない'
          : pname(g, ev.p) + ' にゴールキーパーがいない！', 1200);
        break;

      case 'noDribble':
        SE.play('fail');
        await Fx.toast(pname(g, ev.p) + ' はドリブル技を出せない', 850);
        break;

      case 'dice':
        SE.play('dice');
        await Fx.dice(ev, pname(g, ev.p));
        SE.play(ev.ok ? 'diceOk' : 'diceNg');
        break;

      case 'goal':
        SE.play('goal');
        await Fx.goal(pname(g, ev.p), ev.tech.name);
        break;

      case 'ball': {
        if (S.prevBall !== ev.to) {
          SE.play('ball');
          await Fx.flyBall(rectOf(playerEl(S.prevBall)), rectOf(playerEl(ev.to)));
        }
        S.prevBall = ev.to;
        break;
      }

      case 'steal':
        SE.play('steal');
        await Fx.toast(pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' の伏せ札から ' +
          cardShort(ev.card) + ' をうばった', 1100);
        break;

      case 'raid':
        SE.play('steal');
        await Fx.toast('引き抜き！　' + pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' の ' +
          cardShort(ev.card) + ' を獲得', 1300);
        break;

      case 'scout':
        if (ev.p !== S.human) await Fx.toast(pname(g, ev.p) + ' が場から ' + cardShort(ev.card) + ' を拾った', 950);
        break;

      case 'fieldToDeck':
        await Fx.toast('場の ' + cardShort(ev.card) + ' を山札に戻した', 950);
        break;

      case 'returnToHand':
        await Fx.toast(cardShort(ev.card) + ' は場に出ず手札に戻る', 1050);
        break;

      /* 守り切った瞬間。ここがいちばん気持ちよくあってほしいので、専用の全画面演出にする */
      case 'catchResult':
        if (ev.ok) { SE.play('stop'); await Fx.reaction('STOP!', 'とめた！', pname(g, ev.p), 'catch'); }
        break;

      case 'dribbleResult':
        if (ev.ok) { SE.play('breakthrough'); await Fx.reaction('BREAK!', 'ぬけた！', pname(g, ev.p), 'dribble'); }
        else {
          SE.play('fail');
          await Fx.toast('つかまった！　' + cardShort(ev.dribbleToDeck) + ' は山札へ', 1050);
        }
        break;

      case 'defenseResult':
        await Fx.toast(pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' からボールを奪った！', 950);
        break;

      /* コインは「もらった人」のところへ飛ばす。
       * 以前はいつも自分の手元へ飛んでいたので、失点したのに得したように見えていた。 */
      case 'coin': {
        var mine = (ev.p === S.human);
        var toEl = mine ? $('counters') : playerEl(ev.p);
        SE.play('coin');
        await Fx.coin(ev.n, ev.total, CENTER(), rectOf(toEl), mine,
          pname(g, ev.p), COIN_WHY[ev.why] || '');
        break;
      }

      /* 「間の人を飛ばして自分の番になった」ことを、はっきり出す */
      case 'streak': {
        var skipped = [];
        var n2 = g.players.length;
        for (var q = (S.lastTurnPlayer + 1) % n2; q !== ev.p; q = (q + 1) % n2) skipped.push(pname(g, q));
        var msg = skipped.length
          ? skipped.join('・') + ' を飛ばして、' + pname(g, ev.p) + ' の番！'
          : '守り切った！　' + pname(g, ev.p) + ' の番！';
        SE.play('takeover');
        await Fx.takeover(msg, ev.n);
        break;
      }

      case 'extraTurn':
        SE.play('takeover');
        await Fx.takeover(pname(g, ev.p) + ' は もう一度 自分の番！', 0);
        break;

      case 'digReveal':
        await Fx.toast('山札の上 ' + ev.cards.length + ' 枚を確認…', 700);
        break;

      case 'dig':
        await Fx.toast(cardShort(ev.kept) + ' を手札に。残りは場へ', 950);
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
      case 'start':
        txt = 'キックオフ。ボールカードを引いたのは ' + pname(g, ev.ball); hi = true; break;

      case 'turnStart':
        if (ev.turn !== lastTurn) {
          lastTurn = ev.turn;
          list.appendChild(R.el('li', 'turnsep', '― ' + (ev.turn + 1) + '手目 ―'));
        }
        txt = pname(g, ev.p) + ' の番'; break;

      case 'play':
        txt = pname(g, ev.p) + ' が ' + cardLabel(ev.card) + ' を場に出して、山札から1枚引いた'; break;

      case 'shootDeclare':
        txt = pname(g, ev.p) + ' が ' + pname(g, ev.target) + ' に ' + cardLabel(ev.tech) + ' を撃った'
          + teamNote(ev.team) + (ev.pierce ? '［貫通：素手では止まらない］' : ''); hi = true; break;

      case 'defenseDeclare':
        txt = pname(g, ev.p) + ' が ' + pname(g, ev.target) + ' に ' + cardLabel(ev.tech) + ' をしかけた'
          + teamNote(ev.team); break;

      case 'catchDeclare':
        txt = '　' + pname(g, ev.p) + ' が '
          + (ev.mode === 'bare'
            ? '素手でキャッチしにいった（キーパー：' + ev.keeper.name + '）'
            : cardLabel(ev.tech) + ' で止めにいった（キーパー：' + ev.keeper.name + '）')
          + '　' + needText(ev.dice); break;

      case 'dribbleDeclare':
        txt = '　' + pname(g, ev.p) + ' が ' + cardLabel(ev.tech) + ' で振り切りにいった'
          + teamNote(ev.team) + '　' + needText(ev.dice); break;

      case 'dice':
        txt = '　' + pname(g, ev.p) + ' のサイコロ ' + ev.roll + ' → '
          + (ev.ok ? '成功' : '失敗') + '（' + needText(ev.need) + '）'; break;

      case 'noCatch':
        txt = '　' + pname(g, ev.p) + ' はキャッチできない'
          + (ev.reason === 'pierce' ? '（貫通シュートなので素手では止まらない）' : '（ゴールキーパーがいない）'); break;

      case 'noDribble':
        txt = '　' + pname(g, ev.p) + ' はドリブル技を出せない'; break;

      case 'goal':
        txt = '⚡ ' + pname(g, ev.p) + ' が ' + pname(g, ev.conceder) + ' から ' + cardLabel(ev.tech) + ' でゴール！'
          + teamNote(ev.team); hi = true; break;

      case 'score':
        txt = '　' + pname(g, ev.p) + ' は ' + ev.score + '点になった'; break;

      case 'ball':
        txt = '　ボールは ' + pname(g, ev.to) + ' へ'; break;

      case 'draw':
        if (ev.n) txt = '　' + pname(g, ev.p) + ' が山札から' + ev.n + '枚引いた'; break;

      case 'steal':
        txt = '　' + pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' の伏せ札から '
          + cardLabel(ev.card) + ' をうばった'; break;

      case 'stealFail':
        txt = '　' + pname(g, ev.from) + ' の伏せ札は空だった'; break;

      case 'scout':
        txt = '　' + pname(g, ev.p) + ' が場から ' + cardLabel(ev.card) + ' を拾った'
          + (ev.free ? '（無料）' : '（イナズマコイン1個）'); break;

      case 'raid':
        txt = pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' から ' + cardLabel(ev.card) + ' を引き抜いた'
          + (ev.free ? '（無料）' : '（イナズマコイン2個）'); hi = true; break;

      case 'fieldToDeck':
        txt = '　' + pname(g, ev.p) + ' が場の ' + cardLabel(ev.card) + ' を山札にもどした'; break;

      case 'returnToHand':
        txt = '　' + cardLabel(ev.card) + ' は場に出ず、' + pname(g, ev.p) + ' の手札にもどった'; break;

      case 'toField':
        txt = '　' + cardLabel(ev.card) + ' は場へ'; break;

      case 'catchResult':
        txt = ev.ok
          ? '　' + pname(g, ev.p) + ' のキャッチ成功！ ' + cardLabel(ev.techToDeck) + ' は山札へ、'
              + (ev.catchToField ? cardLabel(ev.catchToField) + ' は場へ' : '素手だったのでカードは減らない')
          : '　' + pname(g, ev.p) + ' のキャッチ失敗'
              + (ev.catchToDeck ? '。' + cardLabel(ev.catchToDeck) + ' は山札へ' : '');
        hi = !!ev.ok; break;

      case 'dribbleResult':
        txt = ev.ok
          ? '　' + pname(g, ev.p) + ' の振り切り成功！ ' + cardLabel(ev.dribbleToField) + ' は場へ、'
              + cardLabel(ev.defenseToDeck) + ' は山札へ'
          : '　' + pname(g, ev.p) + ' の振り切り失敗。' + cardLabel(ev.dribbleToDeck) + ' は山札へ、'
              + cardLabel(ev.defenseToField) + ' は場へ';
        hi = !!ev.ok; break;

      case 'defenseResult':
        txt = '　' + pname(g, ev.p) + ' が ' + pname(g, ev.from) + ' からボールを奪った'; break;

      case 'coin':
        txt = '　' + pname(g, ev.p) + ' がイナズマコインを' + (ev.n > 0 ? '+' : '') + ev.n + '個もらった'
          + (COIN_WHY[ev.why] ? '（' + COIN_WHY[ev.why] + '）' : '')
          + '　手持ち' + ev.total + '個'; break;

      case 'streak':
        txt = ev.n >= 2 ? '　' + pname(g, ev.p) + ' が' + ev.n + '連続で守り切った！' : null;
        hi = ev.n >= 2; break;

      case 'extraTurn':
        txt = '　' + pname(g, ev.p) + ' はもう一度自分の手番'; hi = true; break;

      case 'digReveal':
        txt = '　' + pname(g, ev.p) + ' が山札の上 ' + ev.cards.length + ' 枚を見た'; break;

      case 'dig':
        txt = '　' + pname(g, ev.p) + ' が ' + cardLabel(ev.kept) + ' を手札に入れ、残りは場へ'; break;

      case 'pass':
        txt = pname(g, ev.p) + ' はできることがないのでパス'; break;

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
  /* back を渡すと「もどる」ボタンが出る。押し間違えたときに詰まらないように */
  function setBanner(text, back) {
    var b = $('banner');
    if (!text) { b.hidden = true; return; }
    $('bannerText').textContent = text;
    var bb = $('btnBannerBack');
    bb.hidden = !back;
    bb.onclick = back ? function (e) { e.stopPropagation(); back(); } : null;
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
    if (S.targeting) {
      setBanner('だれに撃つ？　相手をタップ', function () {
        /* ワザ選びに戻す。押し間違えても詰まらないように */
        var uid = S.targeting.fromUid;
        S.targeting = null; S.sel = uid;
        renderAll();
      });
    } else if (S.awaitAction) {
      setBanner('あなたの番　カードをタップ、または上へドラッグ');
    } else if (S.mode === 'guest') {
      setBanner(g.players[g.turn] ? g.players[g.turn].name + ' の番を待っています' : null);
    } else {
      setBanner(null);
    }
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
    for (var r = 1; r <= 4; r++) {
      var per = Math.ceil(n / r);
      var byW = (availW - (per - 1) * 0.25) / per;
      var byH = (availH - (r - 1) * 0.25) / (r * 1.26);
      var tw = Math.min(maxTw, byW, byH);
      if (tw > best) best = tw;
    }
    /* 下限を切ると横へあふれるので、幅から出る上限は必ず守る */
    return Math.max(1.2, Math.min(best, (availW - (n - 1) * 0.25) / n * 4));
  }

  function renderOpponents(g, idx, owned) {
    var box = $('opponents');
    box.replaceChildren();
    var others = [];
    g.players.forEach(function (p, i) { if (i !== S.human) others.push(i); });
    if (!others.length) return;

    /* 相手パネル1枚ぶんの内寸（rem）。版面が固定なので計算で出せる */
    var L = LP();
    var panelInner = (L.stageW - L.pad - (others.length - 1) * 0.5) / others.length - L.oppPad;

    others.forEach(function (i) {
      var p = g.players[i];
      var o = R.el('div', 'opp');
      o.dataset.pi = i;
      if (i === g.turn) o.classList.add('is-turn');

      var head = R.el('div', 'opp__head');
      head.appendChild(R.el('span', 'opp__name', p.name));
      head.appendChild(R.el('span', 'opp__score', String(p.score)));
      if (i === g.ball) head.appendChild(R.el('span', 'opp__ball', '⚽'));
      /* 通信対戦では相手の伏せ札の中身が届かないので、枚数だけを受け取って出す */
      var hid = (p.hiddenCount != null) ? p.hiddenCount : E.hiddenHand(g, i).length;
      head.appendChild(R.el('span', 'opp__hidden', '伏せ ' + hid));
      o.appendChild(head);

      var chars = [p.captain].concat(E.handChars(g, i));
      /* パネルの内寸（幅・高さ）に収まる大きさを出す */
      var tw = benchTile(chars.length, panelInner, L.oppH, L.oppTw);

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

    var compact = LP().compactPiles;
    PILE_DEFS.forEach(function (def) {
      var cards = g.field.filter(def.test);
      var live = cards.some(function (c) { return idx['field|' + c.kind + '|' + c.name]; });
      var e = compact ? R.pileChip(def.key, cards) : R.pile(def.key, cards, { owned: owned });
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
    var L = LP();
    var chars = [g.players[S.human].captain].concat(E.handChars(g, S.human));
    var tw = benchTile(chars.length, L.myW, L.myH, L.myTw);
    chars.forEach(function (c, k) {
      var e = R.faceTile(c);
      e.style.setProperty('--tw', tw + 'rem');
      wire(e, c, k === 0 ? 'cap' : 'own', k === 0 ? null : idx['own|char|' + c.name]);
      box.appendChild(e);
    });
  }

  /* 手札の必殺カードは、枚数から段数と大きさを計算して並べる。
   * こうすると重ならないので、技名が必ず読める。 */
  /* 手札の入れ物の大きさは、決め打ちせず実際に測る。
   * 決め打ちだと、余白や左の欄の分だけずれて、カードが画面からはみ出す。 */
  function handAvail() {
    var L = LP();
    var fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var box = $('hand');
    var w = box ? box.clientWidth / fs : 0;
    var h = box ? box.clientHeight / fs : 0;
    return { w: (w > 4 ? w : L.handW) - 0.3, h: (h > 4 ? h : L.handH) - 0.3 };
  }

  function handLayout(n) {
    var L = LP(), A = handAvail();
    var best = { cw: 0, rows: 1 };
    for (var r = 1; r <= 6; r++) {
      var per = Math.ceil(n / r);
      var byW = (A.w - (per - 1) * 0.4) / per;
      var byH = ((A.h - (r - 1) * 0.4) / r) * 1.88;
      var cw = Math.min(L.maxCw, byW, byH);
      if (cw > best.cw) best = { cw: cw, rows: r };
    }
    best.cw = Math.max(3, best.cw);
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
        S.targeting = { byTarget: bt, fromUid: cardData.uid };
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
    return { cpu: false, decide: function (g, pi, req) { return humanDecide(req); } };
  }

  /* 自分が選ぶ場面をまとめたもの。
   * CPU戦でも通信対戦（ゲスト側）でも、同じ画面をそのまま使う。 */
  function humanDecide(req) {
    var g = S.game, pi = S.human;
    return (function () {
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
            var PICK = {
              toDeck: ['場から1枚、山札に戻す', '相手が狙っていそうなカードを消せます。'],
              dig: ['山札の上を掘った', '1枚だけ手札にもらえます。残りは場に出ます。'],
              raid: ['相手の選手を1人、ただで引き抜く', 'コインを払わずにもらえます。キャプテンは選べません。'],
              scout: ['場から1枚、無料でもらう', 'コインを払わずに拾えます。']
            };
            var pk = PICK[req.purpose] || PICK.scout;
            return showChooser({ title: pk[0], sub: pk[1], options: fopts, foot: [] });
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
    })();
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

    SE.play((g.winner != null && g.winner === S.human) ? 'win' : 'lose');

    Fx.finish(
      '<div class="finish__word">' + word + '</div>' +
      '<div class="finish__scores">' + scores + '</div>' +
      '<div class="finish__sub">' + reason + '　／　' + g.turnCount + '手　／　山札のこり ' + g.deck.length + '枚</div>',
      function () { showHome(); });
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
      techCopies: o.techCopies, charCopies: o.charCopies,
      roster: o.roster, coin: o.coin
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

    out += '<h3>連携技はどれだけ撃たれたか</h3>' + tbl([
      ['1人技のシュート', (st.shootBy[1] / g).toFixed(2) + '回/試合'],
      ['2人技のシュート', (st.shootBy[2] / g).toFixed(2) + '回/試合', st.shootBy[2] / g < 1],
      ['3人技のシュート', (st.shootBy[3] / g).toFixed(2) + '回/試合', st.shootBy[3] / g < 1],
      ['連携技が占める割合', P(st.shootBy[2] + st.shootBy[3], st.shoots), (st.shootBy[2] + st.shootBy[3]) / (st.shoots || 1) < 0.3]
    ]);

    out += '<h3>リアクションは報われているか</h3>' + tbl([
      ['リアクション成功（合計）', (st.reactWins / g).toFixed(2) + '回/試合', st.reactWins / g < 1.5],
      ['2連続以上の守り', (st.streak2 / g).toFixed(2) + '回/試合'],
      ['いちばん長い連続', st.streakMax + '連続'],
      ['追加手番（イナズマブレイク）', (st.extraTurns / g).toFixed(2) + '回/試合']
    ]);

    out += '<h3>イナズマコイン</h3>' + tbl([
      ['1試合に増えた総数', (st.coinsEarned / g).toFixed(1) + '個'],
      ['1試合に使った総数', (st.coinsSpent / g).toFixed(1) + '個'],
      ['終了時の持ち越し', (st.coinsLeft / g).toFixed(1) + '個', st.coinsLeft / g > 20]
    ]);

    var c = st.config.coin || {};
    out += '<h3>設定</h3>' + tbl([
      ['人数', st.config.playerCount], ['初期手札', st.config.handSize],
      ['勝利点', st.config.winScore],
      ['収録キャラ', st.charKinds + '種'], ['必殺カード', st.techKinds + '種'],
      ['必殺カード複製', st.config.techCopies], ['キャラカード複製', st.config.charCopies],
      ['山札総数', st.deckTotal + '枚'],
      ['コイン 開始', (c.start != null ? c.start : 5) + '個'],
      ['コイン リアクション成功', (c.onReact != null ? c.onReact : 2) + '個'],
      ['コイン 失点', (c.onConcede != null ? c.onConcede : 1) + '個']
    ]);
    out += '<p style="opacity:.6;margin-top:1rem">※ これは判断材料です。数値をどうするかは作者が決めてください。</p>';
    return out;
  }

  /* ================================================================
   * 通信対戦の画面まわり
   * ============================================================== */
  function netMsg(t, bad) {
    var e = $('netMsg');
    e.textContent = t || '';
    e.className = 'netmsg' + (bad ? ' is-bad' : '');
  }
  function netStep(n) {
    $('netStep1').hidden = (n !== 1);
    $('netStep2').hidden = (n !== 2);
  }
  function myName() {
    var v = ($('netName').value || '').trim();
    if (v) localStorage.setItem('teppen.name', v);
    return v || localStorage.getItem('teppen.name') || 'プレイヤー';
  }

  function netOpen() {
    $('home').hidden = true;
    if ($('setup').open) $('setup').close();
    var p = Net.urlParams();
    if (p.db) Net.setDbUrl(p.db);
    $('netDb').value = Net.getDbUrl();
    $('netName').value = localStorage.getItem('teppen.name') || '';
    if (p.room) $('netCode').value = p.room;
    netStep(1);
    netMsg('');
    if (!$('netdlg').open) $('netdlg').showModal();
  }

  function netSeatList(seats) {
    S.netSeats = seats || {};
    var ul = $('netSeats');
    ul.replaceChildren();
    for (var i = 0; i < 4; i++) {
      var s = S.netSeats[i];
      var li = R.el('li', 'seatrow' + (i === Net.seat() ? ' is-me' : ''));
      var lbl = (i === 0 ? 'ホスト' : ('席' + (i + 1)));
      li.appendChild(R.el('span', 'seatrow__n', lbl));
      if (s) {
        li.appendChild(R.el('span', 'seatrow__name', s.name || '？'));
        li.appendChild(R.el('span', 'seatrow__st' + (s.connected ? ' is-on' : ''),
          s.connected ? '接続中' : '切断'));
      } else {
        li.appendChild(R.el('span', 'seatrow__name is-empty', (i < S.netCount) ? 'CPU' : '—'));
      }
      ul.appendChild(li);
    }
  }

  function netSeatCountUI() {
    var box = $('netSeatCount');
    box.replaceChildren();
    [2, 3, 4].forEach(function (n) {
      var b = R.el('button', null, n + '人');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.n = n;
      b.addEventListener('click', function () {
        S.netCount = n;
        Array.prototype.forEach.call(box.children, function (x) {
          x.setAttribute('aria-checked', (+x.dataset.n === S.netCount) ? 'true' : 'false');
        });
        netSeatList(S.netSeats);
      });
      b.setAttribute('aria-checked', (n === S.netCount) ? 'true' : 'false');
      box.appendChild(b);
    });
  }

  function netWatchRoom() {
    Net.onSeats(function (seats) {
      netSeatList(seats);
      /* 人が増えたら、席の数を自動で合わせる（ホストのみ） */
      if (Net.isHost()) {
        var max = 0;
        Object.keys(seats).forEach(function (k) { if (seats[k]) max = Math.max(max, +k + 1); });
        if (max > S.netCount) {
          S.netCount = Math.min(4, max);
          netSeatCountUI();
          netSeatList(seats);
        }
      }
    });
    Net.onMeta(function (m) {
      if (!m) return;
      if (m.phase === 'playing' && !Net.isHost() && S.mode !== 'guest') {
        $('netdlg').close();
        guestStart(Net.seat());
      }
    });
    Net.onOnline(function (on) {
      var b = $('netBadge');
      b.hidden = false;
      b.textContent = on ? ('部屋 ' + Net.code()) : '接続が切れています…';
      b.className = 'netbadge' + (on ? '' : ' is-off');
    });
  }

  /* 設定シートの「この設定で部屋を作る」から呼ばれる。
   * 設定シートを閉じて通信対戦の画面に戻し、そこで部屋を立てる。 */
  async function netCreate() {
    if ($('setup').open) $('setup').close();
    $('home').hidden = true;
    if (!$('netdlg').open) $('netdlg').showModal();
    netStep(1);
    try {
      netMsg('つないでいます…');
      var url = Net.setDbUrl($('netDb').value);
      if (!url) {
        netMsg('データベースのURLを入れてください（部屋を作る人だけ必要です）。' +
          'この画面のいちばん下「データベースのURL」を開いて貼ってください。', true);
        return;
      }
      await Net.connect(url);
      var code = await Net.createRoom(myName());
      S.netCount = 2;
      netSeatCountUI();
      $('netCodeBig').textContent = code;
      $('netHostCtl').hidden = false;
      $('netWait').hidden = true;
      netStep(2);
      netWatchRoom();
      netMsg('部屋ができました。リンクを送ってください。');
    } catch (e) {
      netMsg('作れませんでした：' + (e && e.message ? e.message : e), true);
    }
  }

  async function netJoin() {
    try {
      netMsg('つないでいます…');
      var url = Net.setDbUrl($('netDb').value) || Net.getDbUrl();
      if (!url) { netMsg('リンクから開くか、データベースのURLを入れてください', true); return; }
      await Net.connect(url);
      var code = ($('netCode').value || '').trim().toUpperCase();
      var seat = await Net.joinRoom(code, myName());
      $('netCodeBig').textContent = code;
      $('netHostCtl').hidden = true;
      $('netWait').hidden = false;
      netStep(2);
      netWatchRoom();
      netMsg('入れました。ホストが始めるのを待ちます。');
    } catch (e) {
      netMsg('入れませんでした：' + (e && e.message ? e.message : e), true);
    }
  }

  async function netStartGame() {
    try {
      await Net.setPhase('playing', { startedAt: Date.now() });
      $('netdlg').close();
      S.viewN = 0;
      startGame({ seats: S.netSeats, count: S.netCount });
    } catch (e) {
      netMsg('始められませんでした：' + (e && e.message ? e.message : e), true);
    }
  }

  function netCopyLink() {
    var link = Net.shareLink(Net.code());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(
        function () { netMsg('リンクをコピーしました。LINEなどに貼って送ってください。'); },
        function () { netMsg(link); });
    } else { netMsg(link); }
  }

  function netShareLink() {
    var link = Net.shareLink(Net.code());
    if (navigator.share) {
      navigator.share({ title: 'テッペンとリーヨ！', text: '合言葉 ' + Net.code(), url: link })
        .catch(function () { });
    } else { netCopyLink(); }
  }

  /* ================================================================
   * ホームと、画面の行き来
   *
   * 画面は3つの入口に分かれている。
   *   ひとりで遊ぶ（solo） … 設定してCPU戦
   *   みんなで対戦（host/guest） … 合言葉とリンクで集まる
   *   テストプレー（test） … 数値をいじる／CPU同士で回す
   * 設定シートは1枚を使い回し、data-mode で出すものを変えている。
   * ============================================================== */
  function closeDialogs() {
    ['setup', 'netdlg', 'simdlg'].forEach(function (id) {
      var d = $(id);
      if (d && d.open) { try { d.close(); } catch (e) { } }
    });
  }

  function showHome() {
    if (S.game) { S.game.aborted = true; S.game = null; }
    S.mode = 'cpu';
    closeDialogs();
    Fx.clear();
    $('stage').hidden = true;
    $('logpane').hidden = true;
    $('btnLog').setAttribute('aria-pressed', 'false');
    $('netBadge').hidden = true;
    $('home').hidden = false;
    syncSoundBtn();
  }

  var SETUP_TEXT = {
    solo: ['<span>試合の</span><em>したく</em>', '人数とキャプテンを決めて、キックオフ。'],
    host: ['<span>部屋の</span><em>したく</em>', 'この設定で部屋を作ります。合言葉とリンクは、このあと出ます。'],
    test: ['<span>テスト</span><em>プレー</em>', '数値をいじって試す画面。CPU同士で何百回も回して、結果を数字で見られます。'],
    live: ['<span>試合中の</span><em>設定</em>', '音や演出の速さを変えられます。']
  };

  function openSetup(mode) {
    var dlg = $('setup');
    $('home').hidden = true;
    dlg.dataset.mode = mode;
    $('advBox').open = (mode === 'test');
    var t = SETUP_TEXT[mode] || SETUP_TEXT.solo;
    $('setupTitle').innerHTML = t[0];
    $('setupLead').textContent = t[1];
    $('btnCloseSetup').hidden = !S.game;
    renderPresets();
    if (!dlg.open) dlg.showModal();
  }

  /* ================================================================
   * 保存したセットアップ（プリセット）
   *
   * 「この組み合わせが面白かった」を名前つきで残せるようにする。
   * 保存先はこの端末の中だけ（localStorage）。別の端末には引き継がれない。
   * ============================================================== */
  var PRESET_KEY = 'teppen.presets';

  function loadPresets() {
    try {
      var a = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function storePresets(a) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(a)); } catch (e) { }
  }

  /* いまの設定を、まるごとひとかたまりにする */
  function currentPreset() {
    var o = readSetup();
    return {
      playerCount: S.playerCount,
      humanPlays: $('optHuman').checked,
      captain: S.myCap,
      handSize: o.handSize, winScore: o.winScore,
      techCopies: o.techCopies, charCopies: o.charCopies,
      roster: o.roster, coin: o.coin,
      speed: parseFloat($('optSpeed').value)
    };
  }

  function applyPreset(d) {
    if (!d) return;
    if (d.playerCount) S.playerCount = d.playerCount;
    if (d.captain) S.myCap = d.captain;
    $('optHuman').checked = (d.humanPlays !== false);
    if (d.handSize != null) $('optHand').value = d.handSize;
    if (d.winScore != null) $('optWin').value = d.winScore;
    if (d.techCopies != null) $('optTech').value = d.techCopies;
    if (d.charCopies != null) $('optChar').value = d.charCopies;
    if (d.roster) $('optRoster').value = d.roster;
    var c = d.coin || {};
    if (c.start != null) $('optCoinStart').value = c.start;
    if (c.onReact != null) $('optCoinReact').value = c.onReact;
    if (c.onReactStreak != null) $('optCoinStreak').value = c.onReactStreak;
    if (c.onConcede != null) $('optCoinConcede').value = c.onConcede;
    if (c.onPlay != null) $('optCoinPlay').value = c.onPlay;
    if (c.cap != null) $('optCoinCap').value = c.cap;
    if (d.speed != null) {
      $('optSpeed').value = String(d.speed);
      S.speed = d.speed; Fx.setSpeed(S.speed);
    }
    syncSetup();
    renderPresets();
  }

  function renderPresets() {
    var box = $('presetList');
    if (!box) return;
    box.replaceChildren();
    var list = loadPresets();
    if (!list.length) {
      box.appendChild(R.el('span', 'presets__none', 'まだありません。設定を決めたら「いまの設定を保存」を押してください。'));
      return;
    }
    var now = JSON.stringify(currentPreset());
    list.forEach(function (p, i) {
      var same = (JSON.stringify(p.data) === now);
      var chip = R.el('div', 'preset' + (same ? ' is-on' : ''));

      var use = R.el('button', 'preset__use', p.name);
      use.type = 'button';
      use.title = 'この設定にする';
      use.addEventListener('click', function () { applyPreset(p.data); });
      chip.appendChild(use);

      var del = R.el('button', 'preset__del', '×');
      del.type = 'button';
      del.title = '消す';
      del.addEventListener('click', function () {
        if (!global.confirm('「' + p.name + '」を消しますか？')) return;
        var a = loadPresets();
        a.splice(i, 1);
        storePresets(a);
        renderPresets();
      });
      chip.appendChild(del);

      box.appendChild(chip);
    });
  }

  function savePresetNow() {
    var list = loadPresets();
    var name = global.prompt('この設定に名前をつけてください', 'セットアップ' + (list.length + 1));
    if (name == null) return;
    name = String(name).trim().slice(0, 20);
    if (!name) return;
    var data = currentPreset();
    var hit = -1;
    list.forEach(function (p, i) { if (p.name === name) hit = i; });
    if (hit >= 0) {
      if (!global.confirm('同じ名前があります。上書きしますか？')) return;
      list[hit] = { name: name, data: data };
    } else {
      list.push({ name: name, data: data });
    }
    storePresets(list);
    renderPresets();
  }

  /* ================================================================
   * 音の設定
   * ============================================================== */
  function syncSoundBtn() {
    var on = SE.isOn();
    var b = $('btnHomeSound');
    if (b) {
      b.textContent = on ? '音 オン' : '音 オフ';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if ($('optSound')) $('optSound').checked = on;
  }

  function buildSound() {
    var cb = $('optSound'), rg = $('optVol');
    cb.checked = SE.isOn();
    rg.value = Math.round(SE.volume() * 100);
    cb.addEventListener('change', function () {
      SE.setOn(cb.checked);
      syncSoundBtn();
      if (cb.checked) SE.play('coin');
    });
    rg.addEventListener('input', function () { SE.setVolume((+rg.value || 0) / 100); });
    rg.addEventListener('change', function () { SE.play('coin'); });
    syncSoundBtn();
  }

  /* ================================================================
   * 起動
   * ============================================================== */
  function boot() {
    fitStage();
    function refit() { fitStage(); if (S.game) renderAll(); }
    global.addEventListener('resize', refit);
    global.addEventListener('orientationchange', function () { setTimeout(refit, 250); });
    global.addEventListener('load', refit);
    /* 起動直後は画面サイズが 0 で返ることがあるので、少し置いてから測り直す */
    [0, 60, 250, 800].forEach(function (ms) { setTimeout(refit, ms); });

    Fx.init($('fx'));
    buildSetup();
    buildSound();

    /* さわった音。1か所でまとめて面倒を見る */
    document.addEventListener('pointerdown', function (e) {
      SE.unlock();
      var t = e.target;
      if (t && t.closest && t.closest('.btn,.tool,.homebtn,.seg button,.capgrid button,.card,.preset__use,.preset__del')) {
        SE.play('tap');
      }
    }, true);

    /* ---- ホーム ---- */
    $('btnHomeSolo').addEventListener('click', function () { SE.play('press'); openSetup('solo'); });
    $('btnHomeNet').addEventListener('click', function () { SE.play('press'); netOpen(); });
    $('btnHomeTest').addEventListener('click', function () { SE.play('press'); openSetup('test'); });
    $('btnHomeSound').addEventListener('click', function () {
      SE.setOn(!SE.isOn());
      syncSoundBtn();
      if (SE.isOn()) SE.play('coin');
    });

    /* ---- 設定シート ---- */
    $('btnStart').addEventListener('click', function () { SE.play('press'); $('setup').close(); startGame(); });
    $('btnStartTest').addEventListener('click', function () { $('setup').close(); startGame(); });
    $('btnSimOpen').addEventListener('click', function () { $('setup').close(); $('simdlg').showModal(); });
    $('btnMakeRoom').addEventListener('click', netCreate);
    $('btnToHome').addEventListener('click', showHome);
    $('btnPresetSave').addEventListener('click', savePresetNow);

    $('btnSimRun').addEventListener('click', runSim);
    $('btnSimClose').addEventListener('click', function () { $('simdlg').close(); openSetup('test'); });

    /* 試合中の「設定」。閉じて試合に戻れるようにする（押し間違え対策）。
     * 通信対戦の最中はやり直しボタンを出さない（相手の試合まで壊れるため） */
    $('btnMenu').addEventListener('click', function () {
      openSetup(S.mode === 'cpu' ? 'solo' : 'live');
    });
    $('btnCloseSetup').addEventListener('click', function () { $('setup').close(); });

    /* ---- 通信対戦 ---- */
    $('btnCreateRoom').addEventListener('click', function () {
      $('netdlg').close();
      openSetup('host');
    });
    $('btnJoinRoom').addEventListener('click', netJoin);
    $('btnNetStart').addEventListener('click', netStartGame);
    $('btnCopyLink').addEventListener('click', netCopyLink);
    $('btnShareLink').addEventListener('click', netShareLink);
    $('btnNetBack').addEventListener('click', showHome);
    $('netCode').addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });

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

    /* リンクから開いたときは、ホームを飛ばして通信対戦の画面へ */
    var p = Net.urlParams();
    if (p.room) { netOpen(); }
    else { showHome(); }
  }

  /* 動作確認用の入口。ふだんは使いません（不具合を追うときだけ） */
  NS.UI = {
    state: S,
    guestStart: guestStart,
    feedView: function (v, ev, prompt) {
      if (v) { S.gLastN++; S.gQueue.push({ state: v, ev: ev || null }); }
      if (prompt) { S.gLastRid++; S.gQueue.push({ prompt: { rid: S.gLastRid, req: prompt } }); }
      return guestDrain();
    },
    render: renderAll
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
