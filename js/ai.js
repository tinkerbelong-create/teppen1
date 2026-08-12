/* テッペンとリーヨ！ ── CPUの考え方
 *
 * 公開情報だけで判断する。相手の伏せ手札（必殺カード・コイン）は覗かない。
 * 見えるのは「相手のキャラクターカード」「キャプテン」「得点」「ボール」「場」「手札の枚数」。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var E = NS.Engine;
  var DATA = NS.DATA;

  /* 相手が「そのキーパー用の必殺キャッチを持っている」確率のざっくり見積り。
   * 見えないので固定値。枚数設定によって変わるが、読み合いの雰囲気は出る。 */
  var P_HAS_CATCH_PER_KEEPER = 0.22;
  var AVG_CATCH_SUCCESS = 0.72;
  var P_HAS_DRIBBLE = 0.28;
  var AVG_DRIBBLE_SUCCESS = 0.58;

  function effBonus(tech) {
    var e = tech.eff, v = 0;
    if (e.draw) v += e.draw * 1.5;
    if (e.steal) v += 2;
    if (e.scout) v += 2;
    if (e.fieldToDeck) v += 1;
    if (e.returnToHand) v += 4;
    if (e.keepBall) v += 3;
    return v;
  }

  /* 公開情報から「この相手はどれくらい止めてきそうか」 */
  function catchThreat(g, target, pierce) {
    var gks = {}, has = false;
    E.ownedChars(g, target).forEach(function (c) {
      if (c.pos === 'GK') { gks[c.base] = c; has = true; }
    });
    if (!has) return 0;

    var keeperCount = Object.keys(gks).length;
    var pTech = 1 - Math.pow(1 - P_HAS_CATCH_PER_KEEPER, keeperCount);
    var pTechCatch = pTech * AVG_CATCH_SUCCESS;
    if (pierce) return pTechCatch;

    var bare = 0;
    for (var k in gks) bare = Math.max(bare, k === '円堂' ? 1 / 6 : 1 / 3);
    return pTechCatch + (1 - pTech) * bare;
  }

  function dribbleThreat() {
    return P_HAS_DRIBBLE * AVG_DRIBBLE_SUCCESS;
  }

  /* 手札のカード1枚の価値（捨てる順番を決めるのに使う） */
  function cardValue(g, pi, card) {
    var i, t, v;
    if (card.kind === 'coin') return 6;
    if (card.kind === 'ball') return 999;

    if (card.kind === 'char') {
      var mine = E.ownedChars(g, pi);
      var dup = 0;
      for (i = 0; i < mine.length; i++) if (mine[i] !== card && mine[i].base === card.base) dup++;
      if (dup > 0) return 0.4;

      v = card.pos === 'GK' ? 6 : 0.5;
      var hand = g.players[pi].hand;
      for (i = 0; i < hand.length; i++) {
        t = hand[i];
        if (t.kind !== 'tech') continue;
        if (t.main === card.base && E.charFitsTech(card, t.name)) v += 5;
        else if (t.req.indexOf(card.base) >= 0) v += 4;
      }
      /* 将来性：このキャラが絡むワザの多さ */
      DATA.techs.forEach(function (tt) {
        if (tt.main === card.base) v += 0.5;
        else if (tt.req.indexOf(card.base) >= 0) v += 0.3;
      });
      return v;
    }

    /* tech */
    var ready = !!E.assembleTeam(g, pi, card);
    if (card.type === 'キャッチ') return ready ? 9 : 1.2;
    if (card.type === 'ドリブル') return ready ? 7 : 0.8;
    if (card.type === 'ディフェンス') return ready ? 6 + effBonus(card) : 1;
    /* シュート */
    if (ready) return 9 + effBonus(card) + (g.ball === pi ? 4 : 0);
    /* あと1枚で撃てるか */
    var missing = 0;
    var have = {};
    E.ownedChars(g, pi).forEach(function (c) { have[c.base] = 1; });
    if (!E.findMain(g, pi, card)) missing++;
    card.req.forEach(function (r) { if (!have[r]) missing++; });
    return missing <= 1 ? 3.5 : 0.9;
  }

  /* 評価値のものさし
   *   得点だけが勝ち筋なので、撃てるときに撃つのが最優先。
   *   「場に出して1枚引く」は手が無いときの逃げ道であって、選びにいく手ではない。
   *   ここを間違えると、CPUが延々とカードを捨てるだけの試合になる（実際になった）。 */
  function bestShot(g, pi, moves) {
    var winNow = g.settings.winScore - 1;
    var best = null, bestV = -Infinity;
    moves.forEach(function (m) {
      if (m.t !== 'shoot') return;
      var pierce = !!m.card.eff.pierce;
      var pC = catchThreat(g, m.target, pierce);
      var reward = 24 + effBonus(m.card) * 1.6;
      if (g.players[pi].score === winNow) reward += 30;          /* 決めれば勝ち */
      var risk = pC * (6 + m.card.combo * 1.5);                  /* 止められると山札行き */
      var giveBall = m.card.eff.keepBall ? 0 : 3;
      if (g.players[m.target].score === winNow) giveBall += 5;   /* 王手の相手にボールを渡したくない */
      var v = (1 - pC) * reward - risk - giveBall;
      if (v > bestV) { bestV = v; best = m; }
    });
    return best ? { move: best, value: bestV } : null;
  }

  function bestDefense(g, pi, moves) {
    var best = null, bestV = -Infinity;
    var pD = dribbleThreat();
    var shootReady = g.players[pi].hand.some(function (c) {
      return c.kind === 'tech' && c.type === 'シュート' && E.assembleTeam(g, pi, c);
    });
    moves.forEach(function (m) {
      if (m.t !== 'defense') return;
      var v = (1 - pD) * (11 + effBonus(m.card)) - pD * 5;
      if (g.players[m.target].score === g.settings.winScore - 1) v += 8;
      if (shootReady) v += 4;                                    /* 奪えば次に撃てる */
      if (v > bestV) { bestV = v; best = m; }
    });
    return best ? { move: best, value: bestV } : null;
  }

  /* 場から拾う価値：拾った後に何が起きるか */
  function pickupValue(g, pi, card) {
    if (card.kind === 'char') {
      var before = 0, after = 0;
      g.players[pi].hand.forEach(function (t) {
        if (t.kind !== 'tech') return;
        if (E.assembleTeam(g, pi, t)) before++;
      });
      g.players[pi].hand.push(card);
      g.players[pi].hand.forEach(function (t) {
        if (t.kind !== 'tech') return;
        if (E.assembleTeam(g, pi, t)) after++;
      });
      g.players[pi].hand.pop();
      return cardValue(g, pi, card) + (after - before) * 8;
    }
    /* tech：今すぐ撃てるものだけ高い */
    var v = cardValue(g, pi, card);
    return v;
  }

  function bestScout(g, pi, moves) {
    var best = null, bestV = -Infinity;
    moves.forEach(function (m) {
      if (m.t !== 'scoutField') return;
      var v = pickupValue(g, pi, m.card) - 9;      /* コイン1枚ぶんの重み */
      if (v > bestV) { bestV = v; best = m; }
    });
    moves.forEach(function (m) {
      if (m.t !== 'scoutPlayer') return;
      var v = pickupValue(g, pi, m.card) - 17;     /* コイン2枚ぶん */
      /* 相手のエースを止める価値 */
      var them = m.target;
      var theirUse = 0;
      DATA.techs.forEach(function (tt) {
        if (tt.main === m.card.base || tt.req.indexOf(m.card.base) >= 0) theirUse++;
      });
      v += theirUse * 0.6;
      if (g.players[them].score === g.settings.winScore - 1) v += 4;
      if (v > bestV) { bestV = v; best = m; }
    });
    return best ? { move: best, value: bestV } : null;
  }

  function worstCardToDump(g, pi, moves) {
    var best = null, bestV = Infinity;
    moves.forEach(function (m) {
      if (m.t !== 'play') return;
      var v = cardValue(g, pi, m.card);
      if (v < bestV) { bestV = v; best = m; }
    });
    /* 捨てて引くのはあくまで待ちの手。捨てるカードが要らないほど少しマシ、という程度に留める */
    return best ? { move: best, value: 2.4 - Math.min(bestV, 6) * 0.25 } : null;
  }

  function chooseAction(g, pi, moves) {
    var cands = [];
    var s = bestShot(g, pi, moves); if (s) cands.push(s);
    var d = bestDefense(g, pi, moves); if (d) cands.push(d);
    var c = bestScout(g, pi, moves); if (c) cands.push(c);
    var p = worstCardToDump(g, pi, moves); if (p) cands.push(p);
    if (!cands.length) return moves[0];
    cands.sort(function (a, b) { return b.value - a.value; });
    return cands[0].move;
  }

  function chooseCatch(g, pi, req) {
    var opts = req.options;
    var techs = opts.filter(function (o) { return o.t === 'tech'; });
    var bares = opts.filter(function (o) { return o.t === 'bare'; });
    var p = function (o) { return o.dice.length / 6; };

    techs.sort(function (a, b) { return p(b) - p(a); });
    bares.sort(function (a, b) { return p(b) - p(a); });

    var bestTech = techs[0] || null;
    var bestBare = bares[0] || null;

    /* 貫通シュートは素手が使えない。持っているなら出すしかない */
    if (!bestBare) return bestTech || { t: 'none' };
    if (!bestTech) return bestBare;

    /* 決められたら相手の勝ちなら、確率の高いほうを迷わず出す */
    if (g.players[req.from].score === g.settings.winScore - 1) {
      return p(bestTech) >= p(bestBare) ? bestTech : bestBare;
    }
    /* ふだんは「差が大きいときだけカードを賭ける」 */
    return (p(bestTech) - p(bestBare) >= 0.3) ? bestTech : bestBare;
  }

  function chooseDribble(g, pi, req) {
    var techs = req.options.filter(function (o) { return o.t === 'tech'; });
    if (!techs.length) return { t: 'none' };
    techs.sort(function (a, b) { return b.dice.length - a.dice.length; });
    return techs[0];
  }

  function chooseField(g, pi, req) {
    var opts = req.options;
    if (!opts.length) return null;
    var scored = opts.map(function (c) {
      if (req.purpose === 'toDeck') {
        /* 相手にとっていちばん価値がありそうなカードを消す */
        var worst = 0;
        for (var j = 0; j < g.players.length; j++) {
          if (j === pi) continue;
          worst = Math.max(worst, pickupValue(g, j, c));
        }
        return { c: c, v: worst };
      }
      return { c: c, v: pickupValue(g, pi, c) };
    });
    scored.sort(function (a, b) { return b.v - a.v; });
    return scored[0].c;
  }

  function makeAgent() {
    return {
      cpu: true,
      decide: function (g, pi, req) {
        switch (req.kind) {
          case 'action': return chooseAction(g, pi, req.options);
          case 'catch': return chooseCatch(g, pi, req);
          case 'dribble': return chooseDribble(g, pi, req);
          case 'pickField': return chooseField(g, pi, req);
          case 'followUpShot': {
            var best = null, bv = -Infinity;
            req.options.forEach(function (card) {
              for (var j = 0; j < g.players.length; j++) {
                if (j === pi) continue;
                var v = (1 - catchThreat(g, j, !!card.eff.pierce)) * (10 + effBonus(card));
                if (v > bv) { bv = v; best = { card: card, target: j }; }
              }
            });
            return best;
          }
          default: return null;
        }
      }
    };
  }

  NS.AI = {
    makeAgent: makeAgent,
    cardValue: cardValue,
    catchThreat: catchThreat,
    effBonus: effBonus
  };

})(window);
