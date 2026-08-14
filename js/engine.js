/* テッペンとリーヨ！ ── ルールエンジン
 *
 * 画面のことは一切知らない。ルールブック v0.1 の通りに動く。
 * 起きたことは g.emit(event) で外に投げるだけ。
 * 演出で止めたいときは emit が Promise を返せば、エンジンはそれを待つ。
 * CPU一括対戦（sim.js）は emit を空にして同じコードを高速で回す。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var DATA = NS.DATA;

  /* ---------------- 乱数（シード固定できる） ---------------- */
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------------- カード実体 ---------------- */
  var uidSeq = 0;
  function inst(proto) {
    var c = { uid: ++uidSeq };
    for (var k in proto) if (Object.prototype.hasOwnProperty.call(proto, k)) c[k] = proto[k];
    return c;
  }
  /* イナズマコインはカードではなくトークン（各プレイヤーの持ち物）。
   * ボールはカードのまま。配るときに1枚だけ手札に混ざる。 */
  var BALL_PROTO = { kind: 'ball', name: 'ボールカード' };

  /* ---------------- 所持判定 ---------------- */

  /* 円堂守はカードに書かれた2つのワザにしか関われない。
   * （効果設計メモ「4つとも、その円堂を持つ人だけの専用技」を成立させる制限） */
  function charFitsTech(ch, techName) {
    return ch.only ? ch.only.indexOf(techName) >= 0 : true;
  }

  function ownedChars(g, pi) {
    var p = g.players[pi];
    var out = [p.captain];
    for (var i = 0; i < p.hand.length; i++) if (p.hand[i].kind === 'char') out.push(p.hand[i]);
    return out;
  }

  /* そのワザの「主」になれるキャラを1枚返す（いなければ null） */
  function findMain(g, pi, tech) {
    var cs = ownedChars(g, pi);
    for (var i = 0; i < cs.length; i++) {
      if (cs[i].base === tech.main && charFitsTech(cs[i], tech.name)) return cs[i];
    }
    return null;
  }

  /* 連携に必要な選手が全員そろっているか。そろっていれば [主, 必要選手...] を返す */
  function assembleTeam(g, pi, tech) {
    var main = findMain(g, pi, tech);
    if (!main) return null;
    var team = [main];
    var used = {}; used[main.uid] = 1;
    var cs = ownedChars(g, pi);
    for (var i = 0; i < tech.req.length; i++) {
      var need = tech.req[i], found = null;
      for (var j = 0; j < cs.length; j++) {
        if (used[cs[j].uid]) continue;
        if (cs[j].base === need && charFitsTech(cs[j], tech.name)) { found = cs[j]; break; }
      }
      if (!found) return null;
      used[found.uid] = 1;
      team.push(found);
    }
    return team;
  }

  function countCoins(g, pi) { return g.players[pi].coins; }

  /* コインがトークンになったので、伏せているのは必殺カードだけになった */
  function hiddenHand(g, pi) {
    return g.players[pi].hand.filter(function (c) { return c.kind === 'tech'; });
  }

  /* コインの増減はここ1か所を通す。上限を超えたぶんは捨てる。 */
  function addCoins(g, pi, n, why) {
    if (!n) return 0;
    var p = g.players[pi];
    var cap = g.settings.coin.cap;
    var before = p.coins;
    p.coins = Math.max(0, Math.min(cap, p.coins + n));
    var d = p.coins - before;
    if (d > 0) g.coinsEarned += d;
    if (d < 0) g.coinsSpent -= d;
    return d;
  }
  function handChars(g, pi) {
    return g.players[pi].hand.filter(function (c) { return c.kind === 'char'; });
  }
  function findCard(g, pi, uid) {
    var h = g.players[pi].hand;
    for (var i = 0; i < h.length; i++) if (h[i].uid === uid) return h[i];
    return null;
  }
  function removeFromHand(g, pi, card) {
    var h = g.players[pi].hand, i = h.indexOf(card);
    if (i >= 0) h.splice(i, 1);
    return card;
  }

  /* ---------------- ゾーン移動 ---------------- */
  function toField(g, card) { g.field.push(card); }
  function toDeck(g, card) { g.deck.push(card); shuffle(g.deck, g.rng); }
  function toDiscard(g, card) { g.discard.push(card); }

  function drawCards(g, pi, n) {
    var got = [];
    for (var i = 0; i < n; i++) {
      if (!g.deck.length) { g.timeUp = true; break; }
      var c = g.deck.pop();
      g.players[pi].hand.push(c);
      got.push(c);
      if (!g.deck.length) g.timeUp = true;
    }
    return got;
  }

  /* ---------------- 合法手 ---------------- */
  function legalMoves(g, pi) {
    var p = g.players[pi], moves = [], i, j;

    /* A : 場に出して1枚引く（キャラ・必殺カードのみ。コインとボールは出せない） */
    var seen = {};
    for (i = 0; i < p.hand.length; i++) {
      var c = p.hand[i];
      if (c.kind !== 'char' && c.kind !== 'tech') continue;
      var key = c.kind + ':' + c.name;
      if (seen[key]) continue;
      seen[key] = 1;
      moves.push({ t: 'play', uid: c.uid, card: c });
    }

    /* B : ワザを撃つ */
    var techSeen = {};
    for (i = 0; i < p.hand.length; i++) {
      var tc = p.hand[i];
      if (tc.kind !== 'tech') continue;
      if (techSeen[tc.name]) continue;
      techSeen[tc.name] = 1;
      var team = assembleTeam(g, pi, tc);
      if (!team) continue;
      if (tc.type === 'シュート') {
        if (g.ball !== pi) continue;
        for (j = 0; j < g.players.length; j++) {
          if (j === pi) continue;
          moves.push({ t: 'shoot', uid: tc.uid, card: tc, team: team, target: j });
        }
      } else if (tc.type === 'ディフェンス') {
        if (g.ball === pi) continue;
        moves.push({ t: 'defense', uid: tc.uid, card: tc, team: team, target: g.ball });
      }
      /* ドリブル・キャッチはリアクション専用。自分の手番からは撃てない */
    }

    /* C-1 : 場からスカウト（コイン1） */
    if (countCoins(g, pi) >= 1) {
      var fseen = {};
      for (i = 0; i < g.field.length; i++) {
        var fc = g.field[i], fk = fc.kind + ':' + fc.name;
        if (fseen[fk]) continue;
        fseen[fk] = 1;
        moves.push({ t: 'scoutField', uid: fc.uid, card: fc });
      }
    }

    /* C-2 : 引き抜きスカウト（コイン2）。キャプテンは対象外（手札にいないので自然に除外） */
    if (countCoins(g, pi) >= 2) {
      for (j = 0; j < g.players.length; j++) {
        if (j === pi) continue;
        var cs = handChars(g, j), cseen = {};
        for (i = 0; i < cs.length; i++) {
          if (cseen[cs[i].name]) continue;
          cseen[cs[i].name] = 1;
          moves.push({ t: 'scoutPlayer', target: j, uid: cs[i].uid, card: cs[i] });
        }
      }
    }

    return moves;
  }

  /* ---------------- リアクションの選択肢 ---------------- */
  function catchOptions(g, pi, shootTech) {
    var opts = [], i, j;
    var pierce = !!shootTech.eff.pierce;
    var gks = ownedChars(g, pi).filter(function (c) { return c.pos === 'GK'; });

    /* ② 必殺キャッチ */
    var seen = {};
    var hand = g.players[pi].hand;
    for (i = 0; i < hand.length; i++) {
      var tc = hand[i];
      if (tc.kind !== 'tech' || tc.type !== 'キャッチ') continue;
      if (seen[tc.name]) continue;
      for (j = 0; j < gks.length; j++) {
        if (gks[j].base === tc.main && charFitsTech(gks[j], tc.name)) {
          seen[tc.name] = 1;
          opts.push({ t: 'tech', uid: tc.uid, card: tc, keeper: gks[j], dice: tc.dice });
          break;
        }
      }
    }
    /* ① 素手キャッチ（貫通シュートには使えない） */
    if (!pierce) {
      var bseen = {};
      for (j = 0; j < gks.length; j++) {
        if (bseen[gks[j].base]) continue;
        bseen[gks[j].base] = 1;
        opts.push({ t: 'bare', keeper: gks[j], dice: DATA.bareHandDice(gks[j].base) });
      }
    }
    opts.push({ t: 'none' });
    return opts;
  }

  function dribbleOptions(g, pi) {
    var opts = [], seen = {};
    var hand = g.players[pi].hand;
    for (var i = 0; i < hand.length; i++) {
      var tc = hand[i];
      if (tc.kind !== 'tech' || tc.type !== 'ドリブル') continue;
      if (seen[tc.name]) continue;
      var team = assembleTeam(g, pi, tc);
      if (!team) continue;
      seen[tc.name] = 1;
      opts.push({ t: 'tech', uid: tc.uid, card: tc, team: team, dice: tc.dice });
    }
    opts.push({ t: 'none' });
    return opts;
  }

  /* ---------------- 進行 ---------------- */

  function emit(g, ev) {
    ev.turn = g.turnCount;
    g.history.push(ev);
    if (g.emit) return g.emit(ev, g);
    return null;
  }
  async function fire(g, ev) {
    var r = emit(g, ev);
    if (r && typeof r.then === 'function') await r;
  }
  async function ask(g, pi, req) {
    var r = g.agents[pi].decide(g, pi, req);
    if (r && typeof r.then === 'function') r = await r;
    return r;
  }

  function rollDie(g) { return 1 + Math.floor(g.rng() * 6); }

  /* リアクションに成功したときの見返り。
   * 「守り切った → 一気に攻め返す」の燃料になる部分。
   * 同じ攻防のなかで守り続けるほど、もらえるコインが増える。 */
  async function reactionReward(g, pi, kind) {
    var c = g.settings.coin;
    g.reactStreak = (g.reactStreakBy === pi) ? g.reactStreak + 1 : 1;
    g.reactStreakBy = pi;

    var coins = c.onReact + (g.reactStreak - 1) * c.onReactStreak;
    var got = addCoins(g, pi, coins);
    if (got) await fire(g, { k: 'coin', p: pi, n: got, why: 'react', total: g.players[pi].coins, streak: g.reactStreak });

    if (c.reactDraw) {
      var d = drawCards(g, pi, c.reactDraw);
      if (d.length) await fire(g, { k: 'draw', p: pi, n: d.length, cards: d, why: 'react' });
    }
    await fire(g, { k: 'streak', p: pi, n: g.reactStreak, of: kind });
  }
  function breakStreak(g) { g.reactStreak = 0; g.reactStreakBy = -1; }

  /* ===== シュートの解決 ===== */
  async function resolveShoot(g, pi, techCard, team, target) {
    var p = g.players[pi];
    removeFromHand(g, pi, techCard);

    await fire(g, {
      k: 'shootDeclare', p: pi, target: target,
      tech: techCard, team: team.slice(),
      pierce: !!techCard.eff.pierce
    });

    var opts = catchOptions(g, target, techCard);
    var real = opts.filter(function (o) { return o.t !== 'none'; });
    var choice = { t: 'none' };

    if (!real.length) {
      await fire(g, {
        k: 'noCatch', p: target,
        reason: ownedChars(g, target).some(function (c) { return c.pos === 'GK'; })
          ? (techCard.eff.pierce ? 'pierce' : 'nogk') : 'nogk'
      });
    } else {
      choice = await ask(g, target, { kind: 'catch', options: opts, tech: techCard, from: pi });
      if (!choice) choice = { t: 'none' };
    }

    if (choice.t === 'none') {
      /* キャッチせず → 得点 */
      await goal(g, pi, target, techCard, team);
      return;
    }

    var usedCard = null;
    if (choice.t === 'tech') {
      usedCard = findCard(g, target, choice.uid) || choice.card;
      removeFromHand(g, target, usedCard);
    }
    await fire(g, {
      k: 'catchDeclare', p: target, mode: choice.t,
      tech: usedCard, keeper: choice.keeper, dice: choice.dice
    });

    var roll = rollDie(g);
    var ok = choice.dice.indexOf(roll) >= 0;
    await fire(g, { k: 'dice', p: target, roll: roll, need: choice.dice, ok: ok, of: 'catch' });

    if (ok) {
      /* キャッチ成功：シュートは山札へ、キャッチカードは場へ、ボールと手番はキャッチした人へ */
      toDeck(g, techCard);
      if (usedCard) toField(g, usedCard);
      g.ball = target;
      g.forcedNext = target;
      await fire(g, {
        k: 'catchResult', p: target, ok: true, from: pi,
        techToDeck: techCard, catchToField: usedCard
      });
      await fire(g, { k: 'ball', to: target, why: 'catch' });
      await reactionReward(g, target, 'catch');
    } else {
      /* キャッチ失敗：キャッチカードは山札へ、シュートは場へ（得点処理の中で） */
      if (usedCard) toDeck(g, usedCard);
      await fire(g, { k: 'catchResult', p: target, ok: false, from: pi, catchToDeck: usedCard });
      await goal(g, pi, target, techCard, team);
    }
  }

  /* ===== 得点 ===== */
  async function goal(g, scorer, conceder, techCard, team) {
    var eff = techCard.eff;

    await fire(g, { k: 'goal', p: scorer, conceder: conceder, tech: techCard, team: team.slice() });

    /* 使ったシュートカードの行き先 */
    if (eff.returnToHand) {
      g.players[scorer].hand.push(techCard);
      await fire(g, { k: 'returnToHand', p: scorer, card: techCard });
    } else {
      toField(g, techCard);
      await fire(g, { k: 'toField', card: techCard, from: scorer });
    }

    /* カードごとの効果 */
    if (eff.draw) {
      var got = drawCards(g, scorer, eff.draw);
      await fire(g, { k: 'draw', p: scorer, n: got.length, cards: got, why: 'effect' });
    }
    if (eff.coin) {
      var cg = addCoins(g, scorer, eff.coin);
      if (cg) await fire(g, { k: 'coin', p: scorer, n: cg, why: 'effect', total: g.players[scorer].coins });
    }
    if (eff.steal) {
      for (var s = 0; s < eff.steal; s++) {
        var pool = hiddenHand(g, conceder);
        if (!pool.length) { await fire(g, { k: 'stealFail', p: scorer, from: conceder }); break; }
        var taken = pool[Math.floor(g.rng() * pool.length)];
        removeFromHand(g, conceder, taken);
        g.players[scorer].hand.push(taken);
        await fire(g, { k: 'steal', p: scorer, from: conceder, card: taken });
      }
    }
    /* 山札の上を掘る：3枚見て1枚を手札に、残りは場へ。
     * 自分だけが得をしないよう、残りは全員が拾える場に落ちる。 */
    if (eff.dig) {
      var dug = [];
      for (var q = 0; q < eff.dig && g.deck.length; q++) dug.push(g.deck.pop());
      if (!g.deck.length) g.timeUp = true;
      if (dug.length) {
        await fire(g, { k: 'digReveal', p: scorer, cards: dug.slice() });
        var keep = await ask(g, scorer, { kind: 'pickField', options: dug.slice(), purpose: 'dig' });
        if (!keep) keep = dug[0];
        g.players[scorer].hand.push(keep);
        dug.forEach(function (c) { if (c !== keep) toField(g, c); });
        await fire(g, { k: 'dig', p: scorer, kept: keep, toField: dug.filter(function (c) { return c !== keep; }) });
      }
    }
    /* ただで引き抜く：相手の公開キャラを1人もらう（キャプテンは対象外） */
    if (eff.raidFree) {
      for (var r = 0; r < eff.raidFree; r++) {
        var cands = handChars(g, conceder);
        if (!cands.length) break;
        var pick3 = await ask(g, scorer, { kind: 'pickField', options: cands.slice(), purpose: 'raid' });
        if (!pick3) pick3 = cands[0];
        removeFromHand(g, conceder, pick3);
        g.players[scorer].hand.push(pick3);
        await fire(g, { k: 'raid', p: scorer, from: conceder, card: pick3, coins: 0, free: true });
      }
    }
    if (eff.scout && g.field.length) {
      var pick = await ask(g, scorer, { kind: 'pickField', options: g.field.slice(), purpose: 'scout' });
      if (pick) {
        var idx = g.field.indexOf(pick);
        if (idx >= 0) {
          g.field.splice(idx, 1);
          g.players[scorer].hand.push(pick);
          await fire(g, { k: 'scout', p: scorer, card: pick, free: true });
        }
      }
    }
    if (eff.fieldToDeck && g.field.length) {
      var pick2 = await ask(g, scorer, { kind: 'pickField', options: g.field.slice(), purpose: 'toDeck' });
      if (pick2) {
        var idx2 = g.field.indexOf(pick2);
        if (idx2 >= 0) {
          g.field.splice(idx2, 1);
          toDeck(g, pick2);
          await fire(g, { k: 'fieldToDeck', p: scorer, card: pick2 });
        }
      }
    }

    /* スコア */
    g.players[scorer].score += 1;
    g.goalOrder.push(scorer);
    g.players[scorer].goals.push(g.goalOrder.length);
    await fire(g, { k: 'score', p: scorer, score: g.players[scorer].score });

    if (g.players[scorer].score >= g.settings.winScore) {
      g.over = true; g.winner = scorer; g.endReason = 'score';
      await fire(g, { k: 'end', winner: scorer, reason: 'score' });
      return;
    }

    /* キックオフ */
    if (eff.keepBall) {
      await fire(g, { k: 'ball', to: scorer, why: 'keep' });
    } else {
      g.ball = conceder;
      await fire(g, { k: 'ball', to: conceder, why: 'kickoff' });
    }
    var d = drawCards(g, conceder, 1);
    await fire(g, { k: 'draw', p: conceder, n: d.length, cards: d, why: 'concede' });

    /* 失点した側にはコインも入る。守る手段がない人ほど資金が貯まる */
    var cc = addCoins(g, conceder, g.settings.coin.onConcede);
    if (cc) await fire(g, { k: 'coin', p: conceder, n: cc, why: 'concede', total: g.players[conceder].coins });

    /* 追加手番（イナズマブレイクだけ）。失点した側の手番より優先する */
    g.forcedNext = eff.extraTurn ? scorer : conceder;
    if (eff.extraTurn) await fire(g, { k: 'extraTurn', p: scorer });
    breakStreak(g);
  }

  /* ===== ディフェンスの解決 ===== */
  async function resolveDefense(g, pi, techCard, team, target) {
    removeFromHand(g, pi, techCard);
    await fire(g, { k: 'defenseDeclare', p: pi, target: target, tech: techCard, team: team.slice() });

    var opts = dribbleOptions(g, target);
    var real = opts.filter(function (o) { return o.t !== 'none'; });
    var choice = { t: 'none' };
    if (real.length) {
      choice = await ask(g, target, { kind: 'dribble', options: opts, tech: techCard, from: pi });
      if (!choice) choice = { t: 'none' };
    } else {
      await fire(g, { k: 'noDribble', p: target });
    }

    if (choice.t === 'none') {
      toField(g, techCard);
      await fire(g, { k: 'toField', card: techCard, from: pi });
      await defenseSuccess(g, pi, target, techCard, team);
      return;
    }

    var dribCard = findCard(g, target, choice.uid) || choice.card;
    removeFromHand(g, target, dribCard);
    await fire(g, { k: 'dribbleDeclare', p: target, tech: dribCard, team: choice.team.slice(), dice: choice.dice });

    var roll = rollDie(g);
    var ok = choice.dice.indexOf(roll) >= 0;
    await fire(g, { k: 'dice', p: target, roll: roll, need: choice.dice, ok: ok, of: 'dribble' });

    if (ok) {
      /* 振り切った：ドリブルは場へ（勝ち）、ディフェンスは山札へ（負け）、手番はドリブルした人へ */
      toField(g, dribCard);
      toDeck(g, techCard);
      g.forcedNext = target;
      await fire(g, {
        k: 'dribbleResult', p: target, ok: true,
        dribbleToField: dribCard, defenseToDeck: techCard
      });
      await reactionReward(g, target, 'dribble');
    } else {
      /* 振り切れず：ドリブルは山札へ（負け）、ディフェンスは場へ（勝ち） */
      toDeck(g, dribCard);
      toField(g, techCard);
      await fire(g, {
        k: 'dribbleResult', p: target, ok: false,
        dribbleToDeck: dribCard, defenseToField: techCard
      });
      await defenseSuccess(g, pi, target, techCard, team);
    }
  }

  async function defenseSuccess(g, pi, target, techCard, team) {
    g.ball = pi;
    await fire(g, { k: 'defenseResult', p: pi, from: target, ok: true });
    await fire(g, { k: 'ball', to: pi, why: 'steal' });

    if (techCard.eff.draw) {
      var got = drawCards(g, pi, techCard.eff.draw);
      await fire(g, { k: 'draw', p: pi, n: got.length, cards: got, why: 'effect' });
    }

    /* 7-3「奪ったキャラクターがシュートワザを持っていれば、そのターンのうちにシュートを撃てる」
     * 現行カードではディフェンス使用者（壁山・土門・西垣・仁）が誰もシュート技を持たないため
     * 実際には発火しないが、ルール通り実装しておく。 */
    var stealer = team[0];
    var shots = g.players[pi].hand.filter(function (c) {
      if (c.kind !== 'tech' || c.type !== 'シュート') return false;
      if (c.main !== stealer.base || !charFitsTech(stealer, c.name)) return false;
      return !!assembleTeam(g, pi, c);
    });
    if (shots.length) {
      var pick = await ask(g, pi, { kind: 'followUpShot', options: shots, stealer: stealer });
      if (pick && pick.card) {
        await resolveShoot(g, pi, pick.card, assembleTeam(g, pi, pick.card), pick.target);
      }
    }
  }

  /* ===== 1手番 ===== */
  async function runTurn(g) {
    var pi = g.turn;
    await fire(g, { k: 'turnStart', p: pi, ball: g.ball });

    var moves = legalMoves(g, pi);
    if (!moves.length) {
      await fire(g, { k: 'pass', p: pi });
      return;
    }

    var mv = await ask(g, pi, { kind: 'action', options: moves });
    if (!mv) mv = moves[0];

    if (mv.t === 'play') {
      var card = findCard(g, pi, mv.uid) || mv.card;
      removeFromHand(g, pi, card);
      toField(g, card);
      await fire(g, { k: 'play', p: pi, card: card });
      var got = drawCards(g, pi, 1);
      await fire(g, { k: 'draw', p: pi, n: got.length, cards: got, why: 'action' });
      var cp = addCoins(g, pi, g.settings.coin.onPlay);
      if (cp) await fire(g, { k: 'coin', p: pi, n: cp, why: 'play', total: g.players[pi].coins });

    } else if (mv.t === 'shoot') {
      var sc = findCard(g, pi, mv.uid) || mv.card;
      await resolveShoot(g, pi, sc, assembleTeam(g, pi, sc), mv.target);

    } else if (mv.t === 'defense') {
      var dc = findCard(g, pi, mv.uid) || mv.card;
      await resolveDefense(g, pi, dc, assembleTeam(g, pi, dc), g.ball);

    } else if (mv.t === 'scoutField') {
      addCoins(g, pi, -1);
      var i = -1;
      for (var q = 0; q < g.field.length; q++) if (g.field[q].uid === mv.uid) { i = q; break; }
      if (i < 0) i = 0;
      var taken = g.field.splice(i, 1)[0];
      g.players[pi].hand.push(taken);
      await fire(g, { k: 'scout', p: pi, card: taken, free: false, coins: 1 });

    } else if (mv.t === 'scoutPlayer') {
      addCoins(g, pi, -2);
      var vic = findCard(g, mv.target, mv.uid);
      if (vic) {
        removeFromHand(g, mv.target, vic);
        g.players[pi].hand.push(vic);
        await fire(g, { k: 'raid', p: pi, from: mv.target, card: vic, coins: 2 });
      }
    }
  }

  /* ===== タイムアップ判定 ===== */
  function finishTimeUp(g) {
    var best = -1, cands = [];
    g.players.forEach(function (p, i) {
      if (p.score > best) { best = p.score; cands = [i]; }
      else if (p.score === best) cands.push(i);
    });
    if (best === 0) { g.winner = null; g.endReason = 'draw'; }
    else if (cands.length === 1) { g.winner = cands[0]; g.endReason = 'timeup'; }
    else {
      /* 同点なら、先に得点した人の勝ち */
      var win = cands[0], bestOrder = Infinity;
      cands.forEach(function (i) {
        var o = g.players[i].goals[0];
        if (o < bestOrder) { bestOrder = o; win = i; }
      });
      g.winner = win; g.endReason = 'timeupFirst';
    }
    g.over = true;
  }

  /* ---------------- 準備 ---------------- */
  /* コインの既定値。設定で上書きできる */
  var COIN_DEFAULT = {
    start: 5,           /* ゲーム開始時に配るコイン */
    onReact: 2,         /* リアクション成功で もらえるコイン */
    onReactStreak: 1,   /* 連続で成功するたび、もらえる量が増える */
    onConcede: 1,       /* 失点した人がもらえるコイン */
    onPlay: 0,          /* 手番A（場に出して1枚引く）でもらえるコイン */
    reactDraw: 1,       /* リアクション成功で引ける枚数 */
    cap: 12             /* 手持ちの上限 */
  };

  function createGame(settings, agents, emitFn) {
    var rng = makeRng(settings.seed || (Math.random() * 1e9) | 0);
    var n = settings.players.length;

    /* コイン設定を既定値で埋める */
    var coin = {};
    for (var ck in COIN_DEFAULT) coin[ck] = COIN_DEFAULT[ck];
    if (settings.coin) for (var ck2 in settings.coin) coin[ck2] = settings.coin[ck2];
    settings.coin = coin;

    var roster = DATA.rosterFor(settings.roster || 'full');

    var g = {
      settings: settings, rng: rng, agents: agents, emit: emitFn || null,
      roster: roster,
      deck: [], field: [], discard: [],
      players: [], ball: 0, turn: 0, turnCount: 0,
      forcedNext: null, over: false, winner: null, endReason: null,
      timeUp: false, goalOrder: [], history: [],
      coinsEarned: 0, coinsSpent: 0, reactStreak: 0, reactStreakBy: -1
    };

    /* 山札。コインはトークンになったので、山札はキャラと必殺カードとボールだけ */
    var i, j;
    for (i = 0; i < roster.chars.length; i++)
      for (j = 0; j < settings.charCopies; j++) g.deck.push(inst(roster.chars[i]));
    for (i = 0; i < roster.techs.length; i++)
      for (j = 0; j < settings.techCopies; j++) g.deck.push(inst(roster.techs[i]));
    shuffle(g.deck, rng);

    /* プレイヤーとキャプテン */
    for (i = 0; i < n; i++) {
      var ps = settings.players[i];
      g.players.push({
        id: i, name: ps.name, cpu: !!ps.cpu,
        captain: inst(DATA.captains[ps.captain - 1]),
        hand: [], score: 0, goals: [], coins: coin.start
      });
      g.coinsEarned += coin.start;
    }

    /* 手札を配る */
    for (i = 0; i < n; i++)
      for (j = 0; j < settings.handSize; j++)
        if (g.deck.length) g.players[i].hand.push(g.deck.pop());

    /* ボールカードは配る山に1枚だけ混ざっている ＝ 誰か1人の手札に入る。
     * 引き当てた人からスタート。 */
    g.ball = Math.floor(rng() * n);
    g.players[g.ball].hand.push(inst(BALL_PROTO));
    g.turn = g.ball;
    g.startPlayer = g.ball;

    return g;
  }

  var MAX_TURNS = 500;

  async function run(g) {
    await fire(g, { k: 'start', ball: g.ball });
    while (!g.over) {
      /* 途中でやり直したとき、前の試合をここで畳む。
       * 放っておくと2つの試合が同時に進んで盤面が混ざる。 */
      if (g.aborted) { g.over = true; g.endReason = 'aborted'; return g; }
      await runTurn(g);
      if (g.over) break;
      g.turnCount++;
      if (g.timeUp) { finishTimeUp(g); await fire(g, { k: 'end', winner: g.winner, reason: g.endReason }); break; }
      if (g.turnCount >= MAX_TURNS) {
        g.endReason = 'stuck'; finishTimeUp(g); g.endReason = 'stuck';
        await fire(g, { k: 'end', winner: g.winner, reason: 'stuck' });
        break;
      }
      if (g.forcedNext !== null) { g.turn = g.forcedNext; g.forcedNext = null; }
      else g.turn = (g.turn + 1) % g.players.length;
    }
    return g;
  }

  NS.Engine = {
    createGame: createGame,
    run: run,
    legalMoves: legalMoves,
    catchOptions: catchOptions,
    dribbleOptions: dribbleOptions,
    assembleTeam: assembleTeam,
    findMain: findMain,
    charFitsTech: charFitsTech,
    ownedChars: ownedChars,
    handChars: handChars,
    hiddenHand: hiddenHand,
    countCoins: countCoins,
    addCoins: addCoins,
    makeRng: makeRng,
    shuffle: shuffle,
    inst: inst,
    COIN_DEFAULT: COIN_DEFAULT,
    BALL_PROTO: BALL_PROTO
  };

})(window);
