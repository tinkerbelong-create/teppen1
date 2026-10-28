/* テッペンとリーヨ！ ── チュートリアル
 *
 * 本物の盤面で「決まった手札・決まった展開」の1試合を、案内にしたがって遊ぶ。
 * ルール処理は engine.js をそのまま使う（ここではルールを書かない）。
 * ここでやるのは次の3つだけ：
 *   1. 最初の手札と山札を並べる（setup）
 *   2. その場面で押してよい手を1つにしぼる／CPUの手を決める（エージェント）
 *   3. サイコロの目を決める（rng の差し替え。案内どおりに進めるため）
 *
 * 文章の根拠は 資料/ルールブック_v0.1.md。書かれていないことは案内に書かない。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN = global.TEPPEN || {};

  /* ================================================================
   * 台本
   *   me  … あなたの番・あなたの受け方（その手だけを押せるようにする）
   *   cpu … CPUが選ぶ手
   *   roll… その受けのサイコロの目
   *   say … 押す前に出す案内（押すまで出しっぱなし）
   *   after … その手のあと、指定の出来事が起きたら出す説明（「つぎへ」で進む）
   * ============================================================== */
  var ME = [
    {
      kind: 'action', match: { t: 'shoot', name: 'ファイアトルネード' }, place: 'mid',
      say: '<b>手番B：必殺ワザを撃つ</b>あなたがボールを持っています（⚽）。ボールを持っている人だけがシュートを撃てます。' +
        '光っている「ファイアトルネード」をタップして「シュート！」、そのあとCPUをタップしてください。',
      after: { k: 'turnStart', p: 1, say: [
        '<b>ゴール！</b>シュートを撃つ側はサイコロを振りません。サイコロを振るのは受ける側だけです。' +
        'CPUのキャプテン円堂は、素手だと「6」でしか止められません。',
        '<b>決まったあと</b>決まったシュートカードは「場」へ置かれます。失点したCPUには、ボール・山札から1枚・コイン1個と、次の手番がわたります。' +
        '失点しても、まるごと損ではありません。'
      ] }
    },
    {
      kind: 'catch', match: { t: 'tech', name: 'ゴッドハンド' }, roll: 5, place: 'top',
      say: '<b>キャッチ</b>CPUがあなたにシュートを撃ってきました。キーパー（円堂）がいるので、サイコロでキャッチを試せます。' +
        '必殺カード「ゴッドハンド」は 1・3・5・6 で成功。素手（6だけ）より止めやすいです。ゴッドハンドを選んでください。',
      after: { k: 'streak', p: 0, say: [
        '<b>キャッチ成功！</b>ボールはあなたへ移り、そのままあなたの番になります（あいだの人がいれば飛ばされます）。' +
        '守り切ったごほうびに、コイン2個と山札から1枚もらえました。',
        '<b>使ったカードの行き先</b>勝ったゴッドハンドは「場」へ。負けたCPUのシュートは「山札」へ消えます。' +
        '撃ち合いに負けたときだけ、そのカードは山札に消えます。'
      ] }
    },
    {
      kind: 'action', match: { t: 'play', name: 'ザ・ウォール' }, place: 'mid',
      say: '<b>手番A：場に出して1枚引く</b>「ザ・ウォール」は壁山がいないと撃てない、今は使い道のないカードです。' +
        'ザ・ウォールをタップして「場に出す＋1枚引く」を押してください。'
    },
    {
      kind: 'dribble', match: { t: 'tech', name: '疾風ダッシュ' }, roll: 4, place: 'top',
      say: '<b>ドリブル</b>CPUがディフェンスでボールを奪いに来ました。ドリブルで振り切れます。' +
        '「疾風ダッシュ」は 3以上 で成功。選んでください。',
      after: { k: 'streak', p: 0, say: [
        '<b>振り切った！</b>ボールはあなたのまま、あなたの番です。' +
        '同じ攻防のなかで続けて守り切ったので、コインは2個＋1個＝3個もらえました。続けて守るほど増えます。'
      ] }
    },
    {
      kind: 'action', match: { t: 'scoutField', name: 'ファイアトルネード' }, place: 'top',
      say: '<b>手番C：場からスカウト（コイン1個）</b>場のカードは、コイン1個で1枚拾えます。' +
        'さっき決めた「ファイアトルネード」を拾って、もう一度撃てるようにしましょう。場の「シュート」の山をタップして、ファイアトルネードを選んでください。',
      after: { k: 'scout', p: 0, say: [
        '<b>拾いました</b>撃った必殺カードは手札を離れるので、同じ技をまた撃つにはコインで拾い直します。' +
        'コインが「何回ワザを撃てるか」を決めます。'
      ] }
    },
    {
      kind: 'action', match: { t: 'scoutPlayer', name: '鬼道（雷門）' }, place: 'mid',
      say: '<b>手番C：引き抜きスカウト（コイン2個）</b>手札の「イナズマブレイク」は3人ワザ。鬼道（雷門）・豪炎寺・円堂の3人がそろうと撃てます。' +
        'あなたには鬼道（雷門）が足りません。CPUの選手をコイン2個で1人引き抜けます（キャプテンは引き抜けません）。' +
        'CPUの「鬼道（雷門）」をタップして「引き抜く」を押してください。',
      after: { k: 'raid', p: 0, say: [
        '<b>3人がそろいました</b>選手は全員に見えているので、「あの選手がほしい」と狙って引き抜けます。' +
        'イナズマブレイクが撃てるようになりました。'
      ] }
    },
    {
      kind: 'action', match: { t: 'shoot', name: 'イナズマブレイク' }, place: 'mid',
      say: '<b>貫通シュート</b>イナズマブレイクには【貫通】と書いてあります。貫通シュートは素手キャッチでは止められず、' +
        'キーパー技の必殺カードがないと止められません。イナズマブレイクでシュートしてください。',
      after: { k: 'extraTurn', p: 0, say: [
        '<b>2点目！</b>イナズマブレイクはカードの効果で、決まってもボールが相手に渡らず、もう一度あなたの番になります。'
      ] }
    },
    {
      kind: 'action', match: { t: 'shoot', name: 'ファイアトルネード' }, place: 'mid',
      say: '<b>あと1点</b>先に3点取ったほうが勝ちです。拾い直したファイアトルネードで決めましょう！'
    }
  ];

  var CPU = [
    { kind: 'catch', pick: 'bare', roll: 3 },
    { kind: 'action', match: { t: 'shoot', name: 'ドラゴンクラッシュ' } },
    { kind: 'action', match: { t: 'defense', name: 'キラースライド' } },
    { kind: 'action', match: { t: 'play', name: 'コイルターン' } },
    { kind: 'action', match: { t: 'play', name: 'ヘブンズタイム' } },
    { kind: 'catch', pick: 'bare', roll: 2 }
  ];

  /* 最初の手札。キャプテンは あなた＝円堂守① / CPU＝円堂守② */
  var HANDS = [
    { chars: ['豪炎寺', '風丸'], techs: ['ファイアトルネード', 'イナズマブレイク', 'ゴッドハンド', '疾風ダッシュ', 'ザ・ウォール'] },
    { chars: ['染岡', '土門', '鬼道（雷門）'], techs: ['ドラゴンクラッシュ', 'キラースライド', 'コイルターン', 'ヘブンズタイム'] }
  ];

  var INTRO = [
    { place: 'mid', say: '<b>チュートリアル</b>案内にしたがって1試合遊びながら、ルールを覚えます。相手はCPU1人。<b class="inl">先に3点</b>取ったほうが勝ちです。' },
    { place: 'mid', focus: '#opponents', say: '<b>相手の選手</b>上に並んでいるのがCPUの選手（キャラクターカード）です。選手は全員に見えています。' },
    { place: 'top', focus: '#mybench', say: '<b>あなたの選手</b>いちばん左はキャプテンの円堂守。奪われることも場に出すこともない、ずっとあなたのチームにいる選手です。' },
    { place: 'mid', focus: '.handrow', say: '<b>手札の必殺カード</b>こちらは相手には見えません。撃つには、カードの左下に描かれた選手が全員そろっている必要があります。' },
    { place: 'top', focus: '.fieldrow', say: '<b>場・山札・コイン</b>真ん中が「場」。使った必殺カードが置かれ、コイン1個で拾えます。右は山札と、あなたのイナズマコイン（最初は5個）です。' },
    { place: 'mid', say: '<b>自分の番にやること</b>次の3つから<b class="inl">1つ</b>を選びます。<br>A：カードを場に出して1枚引く／B：必殺ワザを撃つ／C：スカウト（場から拾う・相手の選手を引き抜く）' }
  ];

  var DONE = [
    '<b>チュートリアル完了！</b>これで基本はすべてです。本番では、だれに撃つか・何を拾うかを自分で考えます。' +
    'サイコロの目も本番では決まっていません。',
    '<b>覚えておくこと</b>山札がなくなったらタイムアップ。そのときは点の多い人の勝ち、同点なら先に点を取った人の勝ちです。' +
    'くわしいルールは「あそびかた」にまとまっています。'
  ];

  /* ================================================================
   * 案内の吹き出し
   * ============================================================== */
  var box = null, blocker = null, stopped = false, curPlace = 'mid';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function ensureBox() {
    if (box) return;
    blocker = el('div', 'tut-block');
    blocker.hidden = true;
    box = el('div', 'tut');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = '<div class="tut__head"><span class="tut__tag">チュートリアル</span>' +
      '<button type="button" class="tut__quit">やめる</button></div>' +
      '<div class="tut__text"></div><div class="tut__foot"></div>';
    box.hidden = true;
    document.body.appendChild(blocker);
    document.body.appendChild(box);
    box.querySelector('.tut__quit').addEventListener('click', function () {
      if (global.confirm('チュートリアルをやめて、ホームにもどりますか？') && api.onQuit) api.onQuit();
    });
  }

  function clearFocus() {
    document.querySelectorAll('.tut-focus').forEach(function (e) { e.classList.remove('tut-focus'); });
  }

  /* 吹き出しの置き場所。盤面の部品の位置から決める（版面は画面に合わせて伸び縮みするため） */
  function place(where) {
    if (!box || box.hidden) return;
    curPlace = where || curPlace;
    var anchor = document.querySelector(curPlace === 'top' ? '#opponents' : '#piles');
    var vw = document.documentElement.clientWidth;
    var r = anchor ? anchor.getBoundingClientRect() : { top: 80, left: 0, width: vw };
    var w = Math.min(vw - 16, Math.max(300, Math.min(r.width, 600)));
    box.style.inlineSize = w + 'px';
    box.style.left = Math.max(8, Math.min(vw - w - 8, r.left + (r.width - w) / 2)) + 'px';
    box.style.top = Math.max(8, r.top + 4) + 'px';
  }

  function show(html, where, focus) {
    ensureBox();
    clearFocus();
    if (focus) document.querySelectorAll(focus).forEach(function (e) { e.classList.add('tut-focus'); });
    box.querySelector('.tut__text').innerHTML = html;
    box.hidden = false;
    place(where);
  }

  /* 「つぎへ」を押すまで待つ説明 */
  function say(list, where, focus) {
    var items = list.map(function (x) { return typeof x === 'string' ? { say: x, place: where, focus: focus } : x; });
    return items.reduce(function (p, it, i) {
      return p.then(function () {
        if (stopped) return new Promise(function () { });
        return new Promise(function (resolve) {
          show(it.say, it.place || where, it.focus);
          blocker.hidden = false;
          var foot = box.querySelector('.tut__foot');
          foot.replaceChildren();
          var b = el('button', 'btn btn--go tut__next', (i === items.length - 1 && it.last) ? it.last : 'つぎへ');
          b.type = 'button';
          b.addEventListener('click', function () {
            blocker.hidden = true;
            foot.replaceChildren();
            clearFocus();
            resolve();
          });
          foot.appendChild(b);
          b.focus();
        });
      });
    }, Promise.resolve());
  }

  /* 操作を待つあいだ出しておく案内（ボタンなし） */
  function hint(html, where) {
    show(html, where, null);
    blocker.hidden = true;
    box.querySelector('.tut__foot').replaceChildren();
  }

  function hide() {
    if (!box) return;
    box.hidden = true;
    blocker.hidden = true;
    clearFocus();
  }

  /* ================================================================
   * 盤面の準備
   * ============================================================== */
  var meQ, cpuQ, triggers, nextRoll, baseRng;

  function takeFromDeck(g, test) {
    for (var i = g.deck.length - 1; i >= 0; i--) {
      if (test(g.deck[i])) return g.deck.splice(i, 1)[0];
    }
    throw new Error('チュートリアルの山札に見つからないカード');
  }

  function setup(g) {
    var E = NS.Engine;
    meQ = ME.slice(); cpuQ = CPU.slice(); triggers = []; nextRoll = 0; stopped = false;

    HANDS.forEach(function (h, pi) {
      var hand = [];
      h.chars.forEach(function (n) { hand.push(takeFromDeck(g, function (c) { return c.kind === 'char' && c.base === n; })); });
      h.techs.forEach(function (n) { hand.push(takeFromDeck(g, function (c) { return c.kind === 'tech' && c.name === n; })); });
      g.players[pi].hand = hand;
    });

    /* 案内どおりに進めるため、山札からキーパーとキャッチの必殺カードを抜いておく
     * （CPUが引いてしまうと、貫通シュートの説明と食い違うため） */
    g.deck = g.deck.filter(function (c) {
      return !(c.kind === 'char' && c.pos === 'GK') && !(c.kind === 'tech' && c.type === 'キャッチ');
    });

    /* ボールはあなたが持って始める */
    g.players.forEach(function (p) { p.hand = p.hand.filter(function (c) { return c.kind !== 'ball'; }); });
    g.players[0].hand.push(E.inst(E.BALL_PROTO));
    g.ball = 0; g.turn = 0; g.startPlayer = 0;

    /* サイコロだけ台本の目にする。ほかの乱数（山札を混ぜる等）はそのまま */
    baseRng = g.rng;
    g.rng = function () {
      if (nextRoll) { var r = nextRoll; nextRoll = 0; return (r - 1) / 6 + 0.01; }
      return baseRng();
    };
  }

  function matches(o, m) {
    if (!m) return false;
    if (o.t !== m.t) return false;
    var nm = o.card ? o.card.name : '';
    return !m.name || nm === m.name;
  }

  /* ================================================================
   * エージェント
   * ============================================================== */
  function wrapHuman(base) {
    return {
      cpu: false,
      decide: async function (g, pi, req) {
        var step = meQ[0];
        if (!step || step.kind !== req.kind) {
          /* 台本にない場面（起きないはず）。ふつうに選ばせる */
          hide();
          return base.decide(g, pi, req);
        }
        meQ.shift();
        var opts = req.options.filter(function (o) { return matches(o, step.match); });
        if (!opts.length) { hide(); return base.decide(g, pi, req); }
        hint(step.say, step.place);
        var r = {};
        for (var k in req) r[k] = req[k];
        r.options = opts;
        r.noPass = true;
        var choice = await base.decide(g, pi, r);
        hide();
        if (step.roll) nextRoll = step.roll;
        if (step.after) triggers.push(step.after);
        return choice;
      }
    };
  }

  function cpuAgent() {
    return {
      cpu: true,
      decide: async function (g, pi, req) {
        await NS.Fx.hold(req.kind === 'action' ? 520 : 380);
        var step = cpuQ[0];
        if (step && step.kind === req.kind) {
          cpuQ.shift();
          if (step.roll) nextRoll = step.roll;
          if (req.kind === 'catch') {
            var c = req.options.filter(function (o) { return o.t === step.pick; })[0];
            return c || { t: 'none' };
          }
          var m = req.options.filter(function (o) { return matches(o, step.match); })[0];
          if (m) return m;
        }
        /* 台本にない場面：ふつうのCPUに任せる */
        return NS.AI.makeAgent().decide(g, pi, req);
      }
    };
  }

  function wrapEvent(fn) {
    return async function (ev, g) {
      await fn(ev, g);
      if (stopped || !triggers.length) return;
      var t = triggers[0];
      if (t.k === ev.k && (t.p == null || t.p === ev.p)) {
        triggers.shift();
        await say(t.say, 'mid');
      }
    };
  }

  /* ================================================================
   * 外から使う入口
   * ============================================================== */
  var api = {
    onQuit: null,
    settings: function () {
      return {
        players: [
          { name: 'あなた', cpu: false, captain: 1 },
          { name: 'CPU', cpu: true, captain: 2 }
        ],
        handSize: 0, winScore: 3, techCopies: 2, charCopies: 3, roster: 'v2'
      };
    },
    setup: setup,
    wrapHuman: wrapHuman,
    cpuAgent: cpuAgent,
    wrapEvent: wrapEvent,
    intro: function () { return say(INTRO, 'mid'); },
    done: function () { return say(DONE.map(function (s, i) { return { say: s, place: 'mid', last: i === DONE.length - 1 ? '閉じる' : null }; }), 'mid'); },
    place: function () { place(); },
    stop: function () { stopped = true; triggers = []; hide(); }
  };

  NS.Tutorial = api;

})(window);
