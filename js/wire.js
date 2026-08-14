/* テッペンとリーヨ！ ── 通信でやり取りするデータの詰め方
 *
 * カードの中身（画像のパス・効果・出目…）は全端末が最初から持っているので、
 * 通信では「どのカードか」だけを送ります。1枚あたり数十バイトで済みます。
 *
 *   カード → { u:通し番号, k:'c'キャラ/'t'必殺/'b'ボール, n:名前 }
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;

  function D() { return NS.DATA; }

  /* ---------------- カード ---------------- */
  function packCard(c) {
    if (!c) return null;
    if (c.kind === 'char') return { u: c.uid, k: 'c', n: c.name };
    if (c.kind === 'tech') return { u: c.uid, k: 't', n: c.name };
    return { u: c.uid, k: 'b', n: 'ボールカード' };
  }

  var charByName = null;
  function findChar(name) {
    if (!charByName) {
      charByName = {};
      D().deckChars.forEach(function (c) { charByName[c.name] = c; });
      D().captains.forEach(function (c) { charByName[c.name] = c; });
    }
    return charByName[name];
  }

  function unpackCard(p) {
    if (!p) return null;
    var proto;
    if (p.k === 'c') proto = findChar(p.n);
    else if (p.k === 't') proto = D().techByName[p.n];
    else proto = { kind: 'ball', name: 'ボールカード' };
    if (!proto) proto = { kind: 'tech', name: p.n, type: 'シュート', main: '', req: [], eff: {}, efftxt: '', img: '' };
    var o = { uid: p.u };
    for (var k in proto) o[k] = proto[k];
    return o;
  }

  function packList(a) { return (a || []).map(packCard); }
  function unpackList(a) { return (a || []).map(unpackCard); }

  /* ---------------- 盤面（席ごとに切り分ける） ---------------- */
  function packView(g, seat) {
    return {
      seat: seat, turn: g.turn, ball: g.ball, turnCount: g.turnCount,
      win: g.settings.winScore,
      deck: g.deck.length, discard: g.discard.length,
      field: packList(g.field),
      over: !!g.over, winner: (g.winner == null ? -1 : g.winner), reason: g.endReason || '',
      players: g.players.map(function (p, i) {
        return {
          name: p.name, score: p.score, coins: p.coins,
          cap: packCard(p.captain),
          chars: packList(p.hand.filter(function (c) { return c.kind === 'char'; })),
          hidden: p.hand.filter(function (c) { return c.kind === 'tech'; }).length,
          hasBall: p.hand.some(function (c) { return c.kind === 'ball'; }),
          /* 伏せ札の中身は、その本人ぶんにしか入れない */
          mine: (i === seat) ? packList(p.hand.filter(function (c) { return c.kind === 'tech'; })) : null
        };
      })
    };
  }

  /* 受け取った側で、画面の描画関数がそのまま読める形に戻す */
  function unpackView(v) {
    var g = {
      settings: { winScore: v.win },
      turn: v.turn, ball: v.ball, turnCount: v.turnCount,
      deck: { length: v.deck }, discard: { length: v.discard },
      field: unpackList(v.field),
      over: v.over, winner: (v.winner < 0 ? null : v.winner), endReason: v.reason,
      remote: true, mySeat: v.seat,
      players: (v.players || []).map(function (p, i) {
        var hand = unpackList(p.chars);
        if (p.mine) hand = hand.concat(unpackList(p.mine));
        if (p.hasBall) hand.push({ uid: -1 - i, kind: 'ball', name: 'ボールカード' });
        return {
          id: i, name: p.name, score: p.score, coins: p.coins,
          captain: unpackCard(p.cap), hand: hand,
          hiddenCount: p.hidden, goals: []
        };
      })
    };
    return g;
  }

  /* ---------------- 出来事（演出用） ---------------- */
  var CARD_FIELDS = ['card', 'tech', 'kept', 'keeper', 'techToDeck', 'catchToField', 'catchToDeck',
    'dribbleToField', 'defenseToDeck', 'dribbleToDeck', 'defenseToField'];
  var LIST_FIELDS = ['team', 'cards', 'toField'];

  function packEv(ev) {
    var o = {};
    for (var k in ev) {
      if (CARD_FIELDS.indexOf(k) >= 0) { if (ev[k]) o[k] = packCard(ev[k]); }
      else if (LIST_FIELDS.indexOf(k) >= 0) { if (ev[k]) o[k] = packList(ev[k]); }
      else if (ev[k] !== undefined && typeof ev[k] !== 'function') o[k] = ev[k];
    }
    return o;
  }

  function unpackEv(ev) {
    var o = {};
    for (var k in ev) {
      if (CARD_FIELDS.indexOf(k) >= 0) o[k] = unpackCard(ev[k]);
      else if (LIST_FIELDS.indexOf(k) >= 0) o[k] = unpackList(ev[k]);
      else o[k] = ev[k];
    }
    return o;
  }

  /* ---------------- 「何を選ぶか」の問い合わせ ---------------- */
  function packPrompt(req) {
    var p = { kind: req.kind };
    switch (req.kind) {
      case 'action':
        p.options = req.options.map(function (m) {
          return { t: m.t, u: m.uid, target: (m.target == null ? -1 : m.target), c: packCard(m.card) };
        });
        break;
      case 'catch':
      case 'dribble':
        p.tech = packCard(req.tech);
        p.from = req.from;
        p.options = req.options.map(function (o) {
          return { t: o.t, u: (o.uid == null ? -1 : o.uid), c: o.card ? packCard(o.card) : null,
            keeper: o.keeper ? packCard(o.keeper) : null, dice: o.dice || null };
        });
        break;
      case 'pickField':
        p.purpose = req.purpose;
        p.options = packList(req.options);
        break;
      case 'followUpShot':
        p.options = packList(req.options);
        break;
    }
    return p;
  }

  /* 受け取った側で、いつもの選択画面が読める形に戻す */
  function unpackPrompt(p) {
    var req = { kind: p.kind };
    switch (p.kind) {
      case 'action':
        req.options = (p.options || []).map(function (m) {
          return { t: m.t, uid: m.u, target: (m.target < 0 ? null : m.target), card: unpackCard(m.c) };
        });
        break;
      case 'catch':
      case 'dribble':
        req.tech = unpackCard(p.tech);
        req.from = p.from;
        req.options = (p.options || []).map(function (o) {
          return { t: o.t, uid: (o.u < 0 ? null : o.u), card: o.c ? unpackCard(o.c) : null,
            keeper: o.keeper ? unpackCard(o.keeper) : null, dice: o.dice || null };
        });
        break;
      case 'pickField':
        req.purpose = p.purpose;
        req.options = unpackList(p.options);
        break;
      case 'followUpShot':
        req.options = unpackList(p.options);
        break;
    }
    return req;
  }

  /* 選んだ結果を、最小限の情報にして送り返す */
  function packChoice(kind, choice) {
    if (choice == null) return null;
    switch (kind) {
      case 'action': return { t: choice.t, u: choice.uid, target: (choice.target == null ? -1 : choice.target) };
      case 'catch':
      case 'dribble': return { t: choice.t, u: (choice.uid == null ? -1 : choice.uid),
        keeper: choice.keeper ? choice.keeper.uid : -1 };
      case 'pickField': return { u: choice.uid };
      case 'followUpShot': return { u: choice.card.uid, target: choice.target };
    }
    return null;
  }

  /* ホスト側で、本物の選択肢に戻す */
  function resolveChoice(req, plain) {
    if (plain == null) return null;
    switch (req.kind) {
      case 'action': {
        var t = plain.target < 0 ? null : plain.target;
        var hit = req.options.filter(function (m) {
          return m.t === plain.t && m.uid === plain.u && (m.target == null ? null : m.target) === t;
        })[0];
        if (hit) return hit;
        /* 同名の別カードを押していた場合に備える */
        return req.options.filter(function (m) { return m.t === plain.t && (m.target == null ? null : m.target) === t; })[0] || null;
      }
      case 'catch':
      case 'dribble': {
        if (plain.t === 'none') return { t: 'none' };
        return req.options.filter(function (o) {
          if (o.t !== plain.t) return false;
          if (plain.t === 'bare') return o.keeper && o.keeper.uid === plain.keeper;
          return o.uid === plain.u;
        })[0] || req.options.filter(function (o) { return o.t === plain.t; })[0] || { t: 'none' };
      }
      case 'pickField':
        return req.options.filter(function (c) { return c.uid === plain.u; })[0] || req.options[0];
      case 'followUpShot': {
        var card = req.options.filter(function (c) { return c.uid === plain.u; })[0];
        return card ? { card: card, target: plain.target } : null;
      }
    }
    return null;
  }

  /* ---------------- ホストが戻ってきたとき用の保存 ---------------- */
  function packSnapshot(g) {
    return {
      settings: {
        handSize: g.settings.handSize, winScore: g.settings.winScore,
        techCopies: g.settings.techCopies, charCopies: g.settings.charCopies,
        roster: g.settings.roster, coin: g.settings.coin,
        players: g.settings.players
      },
      deck: packList(g.deck), field: packList(g.field), discard: packList(g.discard),
      ball: g.ball, turn: g.turn, turnCount: g.turnCount,
      goalOrder: g.goalOrder, coinsEarned: g.coinsEarned, coinsSpent: g.coinsSpent,
      players: g.players.map(function (p) {
        return { name: p.name, cpu: p.cpu, score: p.score, coins: p.coins, goals: p.goals,
          cap: packCard(p.captain), hand: packList(p.hand) };
      })
    };
  }

  function applySnapshot(g, s) {
    g.deck = unpackList(s.deck);
    g.field = unpackList(s.field);
    g.discard = unpackList(s.discard);
    g.ball = s.ball; g.turn = s.turn; g.turnCount = s.turnCount;
    g.goalOrder = s.goalOrder || [];
    g.coinsEarned = s.coinsEarned || 0; g.coinsSpent = s.coinsSpent || 0;
    s.players.forEach(function (p, i) {
      var P = g.players[i];
      P.score = p.score; P.coins = p.coins; P.goals = p.goals || [];
      P.captain = unpackCard(p.cap);
      P.hand = unpackList(p.hand);
    });
    return g;
  }

  NS.Wire = {
    packCard: packCard, unpackCard: unpackCard, packList: packList, unpackList: unpackList,
    packView: packView, unpackView: unpackView,
    packEv: packEv, unpackEv: unpackEv,
    packPrompt: packPrompt, unpackPrompt: unpackPrompt,
    packChoice: packChoice, resolveChoice: resolveChoice,
    packSnapshot: packSnapshot, applySnapshot: applySnapshot
  };

})(window);
