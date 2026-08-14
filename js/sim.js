/* テッペンとリーヨ！ ── CPU一括対戦
 *
 * 画面を描かずに同じエンジンを回して、統計を出す。
 * バランス調整の材料であって、答えではない。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var E = NS.Engine;

  function blankStats() {
    return {
      games: 0,
      decided: 0, timeup: 0, draw: 0, stuck: 0,
      turns: 0, turnsMax: 0,
      goals: 0, zeroGoalGames: 0,
      shoots: 0, shootPierce: 0,
      catchTried: 0, catchBare: 0, catchTech: 0, catchOk: 0, catchBareOk: 0, catchTechOk: 0,
      noCatchPossible: 0, noCatchPierce: 0, noCatchNoGk: 0,
      defenses: 0, dribbles: 0, dribbleOk: 0, defenseOk: 0,
      scouts: 0, raids: 0,
      winByCaptain: [0, 0, 0, 0],
      gamesByCaptain: [0, 0, 0, 0],
      firstPlayerWins: 0,
      goalByTech: {},
      catchByTech: {},
      scoreSpread: {},
      interrupts: 0,          /* 手番の順番が飛ばされた回数（キャッチ成功・ドリブル成功・得点） */
      pierceShoots: 0, pierceGoals: 0,
      plainShoots: 0, plainGoals: 0,
      lostToDeck: 0,          /* 撃ち合いに負けて山札へ消えた必殺カードの枚数 */
      kazamidori: 0,          /* 炎の風見鶏が手札に戻った回数 */
      seats: 0, neverBall: 0, neverShot: 0, topShare: 0, topShareN: 0,
      deckLeft: 0,
      shootBy: [0, 0, 0, 0],   /* 何人技のシュートを撃ったか（1〜3人） */
      goalBy: [0, 0, 0, 0],
      coinsEarned: 0, coinsSpent: 0, coinsLeft: 0,
      streakMax: 0, streak2: 0, extraTurns: 0, reactWins: 0
    };
  }

  function collect(g, st) {
    st.games++;
    st.turns += g.turnCount;
    if (g.turnCount > st.turnsMax) st.turnsMax = g.turnCount;
    st.deckLeft += g.deck.length;

    if (g.endReason === 'score') st.decided++;
    else if (g.endReason === 'draw') st.draw++;
    else if (g.endReason === 'stuck') st.stuck++;
    else st.timeup++;

    var total = 0;
    g.players.forEach(function (p) { total += p.score; });
    st.goals += total;
    if (total === 0) st.zeroGoalGames++;

    var key = g.players.map(function (p) { return p.score; }).sort().reverse().join('-');
    st.scoreSpread[key] = (st.scoreSpread[key] || 0) + 1;

    g.players.forEach(function (p) {
      st.gamesByCaptain[p.captain.cap - 1]++;
    });
    if (g.winner !== null && g.winner !== undefined) {
      st.winByCaptain[g.players[g.winner].captain.cap - 1]++;
      if (g.winner === g.startPlayer) st.firstPlayerWins++;
    }

    /* 「その試合でボールに一度も触らなかった人」を数える。
     * 得点すると失点した人にボールと手番が渡るので、2人だけで往復しやすい構造になっている。 */
    var held = {}, shot = {};
    held[g.startPlayer] = 1;
    g.history.forEach(function (ev) {
      if (ev.k === 'ball') held[ev.to] = 1;
      if (ev.k === 'shootDeclare') shot[ev.p] = (shot[ev.p] || 0) + 1;
    });
    var counts = [];
    for (var q = 0; q < g.players.length; q++) {
      st.seats++;
      if (!held[q]) st.neverBall++;
      if (!shot[q]) st.neverShot++;
      counts.push(shot[q] || 0);
    }
    counts.sort(function (a, b) { return b - a; });
    var tot = counts.reduce(function (a, b) { return a + b; }, 0);
    if (tot) { st.topShare += counts[0] / tot; st.topShareN++; }

    g.players.forEach(function (p) { st.coinsLeft += p.coins; });
    st.coinsSpent += g.coinsSpent || 0;

    var n = g.players.length, last = -1, lastPierce = false, lastCombo = 1;
    g.history.forEach(function (ev) {
      switch (ev.k) {
        case 'turnStart':
          if (last >= 0 && ev.p !== (last + 1) % n) st.interrupts++;
          last = ev.p;
          break;
        case 'shootDeclare':
          st.shoots++;
          st.shootBy[Math.min(3, ev.tech.combo)]++;
          lastCombo = Math.min(3, ev.tech.combo);
          lastPierce = !!ev.pierce;
          if (ev.pierce) { st.shootPierce++; st.pierceShoots++; } else st.plainShoots++;
          break;
        case 'coin': st.coinsEarned += ev.n; break;
        case 'extraTurn': st.extraTurns++; break;
        case 'streak':
          st.reactWins++;
          if (ev.n > st.streakMax) st.streakMax = ev.n;
          if (ev.n >= 2) st.streak2++;
          break;
        case 'noCatch':
          st.noCatchPossible++;
          if (ev.reason === 'pierce') st.noCatchPierce++; else st.noCatchNoGk++;
          break;
        case 'catchDeclare':
          st.catchTried++;
          if (ev.mode === 'bare') st.catchBare++;
          else {
            st.catchTech++;
            var tn = ev.tech.name;
            st.catchByTech[tn] = st.catchByTech[tn] || { tried: 0, ok: 0 };
            st.catchByTech[tn].tried++;
          }
          break;
        case 'catchResult':
          if (ev.ok) {
            st.catchOk++;
            st.lostToDeck++;                       /* シュートが山札へ */
            if (ev.catchToField) {
              st.catchTechOk++;
              var cn = ev.catchToField.name;
              st.catchByTech[cn] = st.catchByTech[cn] || { tried: 0, ok: 0 };
              st.catchByTech[cn].ok++;
            } else st.catchBareOk++;
          } else if (ev.catchToDeck) st.lostToDeck++;
          break;
        case 'goal':
          st.goalByTech[ev.tech.name] = (st.goalByTech[ev.tech.name] || 0) + 1;
          st.goalBy[lastCombo]++;
          if (lastPierce) st.pierceGoals++; else st.plainGoals++;
          break;
        case 'returnToHand': st.kazamidori++; break;
        case 'defenseDeclare': st.defenses++; break;
        case 'dribbleDeclare': st.dribbles++; break;
        case 'dribbleResult': st.lostToDeck++; if (ev.ok) st.dribbleOk++; break;
        case 'defenseResult': if (ev.ok) st.defenseOk++; break;
        case 'scout': st.scouts++; break;
        case 'raid': st.raids++; break;
      }
    });
  }

  /* 1試合ぶんの設定（キャプテンはランダムに配る） */
  function makeSettings(base, seed) {
    var caps = [1, 2, 3, 4];
    var rng = E.makeRng(seed);
    E.shuffle(caps, rng);
    var players = [];
    for (var i = 0; i < base.playerCount; i++) {
      players.push({ name: 'CPU' + (i + 1), cpu: true, captain: caps[i] });
    }
    return {
      players: players,
      handSize: base.handSize,
      winScore: base.winScore,
      techCopies: base.techCopies,
      charCopies: base.charCopies,
      roster: base.roster || 'full',
      coin: base.coin || null,
      seed: seed
    };
  }

  /* 進捗を返しながら n 試合まわす */
  async function run(base, n, onProgress) {
    var st = blankStats();
    st.config = {
      playerCount: base.playerCount, handSize: base.handSize, winScore: base.winScore,
      techCopies: base.techCopies, charCopies: base.charCopies,
      roster: base.roster || 'full', coin: base.coin || null
    };
    var baseSeed = (Math.random() * 1e9) | 0;
    for (var i = 0; i < n; i++) {
      var s = makeSettings(base, baseSeed + i * 7919);
      var agents = [];
      for (var j = 0; j < base.playerCount; j++) agents.push(NS.AI.makeAgent());
      var g = E.createGame(s, agents, null);
      st.charKinds = g.roster.chars.length;
      st.techKinds = g.roster.techs.length;
      st.deckTotal = st.charKinds * base.charCopies + st.techKinds * base.techCopies + 1;
      await E.run(g);
      collect(g, st);
      if ((i % 20) === 19) {
        if (onProgress) onProgress(i + 1, n);
        await new Promise(function (r) { setTimeout(r, 0); });
      }
    }
    if (onProgress) onProgress(n, n);
    return st;
  }

  function pct(a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '–'; }

  function topList(obj, n, fmt) {
    return Object.keys(obj)
      .map(function (k) { return { k: k, v: obj[k] }; })
      .sort(function (a, b) { return (fmt ? fmt(b.v) : b.v) - (fmt ? fmt(a.v) : a.v); })
      .slice(0, n);
  }

  NS.Sim = { run: run, pct: pct, topList: topList };

})(window);
