/* テッペンとリーヨ！ ── カードの見た目を組み立てる
 *
 * 画像を主役にする。
 *   キャラクター … 256x256 の正方形なので、正方形の顔タイルのまま切らずに見せる
 *   必殺技       … 1919x1020 の横長なので、横長のカードにして絵を全面に敷く
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var DATA = NS.DATA;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function bg(node, path) {
    node.style.backgroundImage = 'url("' + NS.asset(path) + '")';
    return node;
  }

  /* base → そのキャラが関わるワザ */
  var INV = {};
  DATA.techs.forEach(function (t) {
    (INV[t.main] = INV[t.main] || { main: [], sub: [] }).main.push(t);
    t.req.forEach(function (r) {
      (INV[r] = INV[r] || { main: [], sub: [] }).sub.push(t);
    });
  });

  /* 円堂が関わるワザは、決まった番号の円堂守だけが撃てる（data.js の captains[].only）。
   * ワザの名前 → 円堂の番号。番号つきで見せないと「顔はそろったのに撃てない」が起きる */
  var CAP_OF = {};
  DATA.captains.forEach(function (cp) { (cp.only || []).forEach(function (n) { CAP_OF[n] = cp.cap; }); });
  var CAPMARK = ['', '①', '②', '③', '④'];
  function capOf(t) { return t && CAP_OF[t.name] || 0; }

  function techsOf(ch) {
    var inv = INV[ch.base] || { main: [], sub: [] };
    var m = inv.main.slice(), s = inv.sub.slice();
    if (ch.only) {
      m = m.filter(function (t) { return ch.only.indexOf(t.name) >= 0; });
      s = s.filter(function (t) { return ch.only.indexOf(t.name) >= 0; });
    }
    return { main: m, sub: s };
  }

  function icon(type) {
    var i = el('i', 'ic ic--' + type, type.charAt(0));
    i.title = type;
    return i;
  }

  function diceLabel(dice) {
    if (!dice || !dice.length) return '';
    var run = true;
    for (var i = 1; i < dice.length; i++) if (dice[i] !== dice[i - 1] + 1) run = false;
    if (run && dice.length > 1) return dice[0] + '以上';
    return dice.join('・');
  }

  /* ================================================================
   * 顔タイル（キャラクター）
   * ============================================================== */
  function faceTile(c, opt) {
    opt = opt || {};
    var e = el('div', 'tile' + (opt.small ? ' tile--sm' : ''));
    e.dataset.uid = c.uid != null ? c.uid : '';
    e.dataset.kind = 'char';

    var face = el('div', 'tile__face');
    bg(face, c.img);
    var f = NS.faceOf(c);
    face.style.backgroundSize = f.zoom + '%';
    face.style.backgroundPosition = f.x + '% ' + f.y + '%';
    e.appendChild(face);

    var pos = el('div', 'tile__pos', c.pos);
    pos.dataset.pos = c.pos;
    e.appendChild(pos);

    e.appendChild(el('div', 'tile__name', c.name));

    if (c.cap) {
      e.classList.add('is-captain');
      e.appendChild(el('div', 'tile__cap', 'キャプテン'));
    }
    return e;
  }

  /* 必要な選手を示す、小さい丸い顔 */
  function reqChip(base, owned, capNo) {
    var src = DATA.charByBase[base];
    var e = el('span', 'rchip' + (owned === false ? ' is-missing' : ''));
    if (src) {
      bg(e, src.img);
      var f = NS.faceOf(src);
      e.style.backgroundSize = (f.zoom + 15) + '%';
      e.style.backgroundPosition = f.x + '% ' + f.y + '%';
    }
    e.title = base;
    /* 円堂には番号をつける（どの円堂守のワザか分かるように） */
    if (base === '円堂' && capNo) {
      e.classList.add('rchip--cap');
      e.appendChild(el('b', 'rchip__no', CAPMARK[capNo]));
      e.title = '円堂守' + CAPMARK[capNo];
    }
    return e;
  }

  /* ================================================================
   * 必殺カード（横長。絵を全面に敷いて、文字はその上に薄い帯で重ねる）
   * ============================================================== */
  function techCard(t, ctx) {
    ctx = ctx || {};
    var e = el('div', 'tcard tcard--' + t.type);
    e.dataset.uid = t.uid != null ? t.uid : '';
    e.dataset.kind = 'tech';

    var art = el('div', 'tcard__art');
    bg(art, t.img);
    e.appendChild(art);

    var top = el('div', 'tcard__top');
    top.appendChild(icon(t.type));
    top.appendChild(el('span', 'tcard__name', t.name));
    if (t.eff.pierce) top.appendChild(el('span', 'tag tag--pierce', '貫通'));
    var cn = capOf(t);
    e.appendChild(top);

    var foot = el('div', 'tcard__foot');

    var who = el('div', 'tcard__who');
    var owned = ctx.owned || null;
    var mains = [t.main].concat(t.req);
    mains.forEach(function (b, i) {
      if (i) foot.dataset.combo = '1';
      /* 円堂は、キャプテンの番号が合っているときだけ「持っている」 */
      var has = !owned ? undefined : (b === '円堂' && cn) ? !!owned['円堂#' + cn] : !!owned[b];
      who.appendChild(reqChip(b, has, b === '円堂' ? cn : 0));
    });
    foot.appendChild(who);

    var info = el('div', 'tcard__info');
    /* どの円堂守のワザか（キャプテンがこの番号の人だけが撃てる） */
    if (cn) info.appendChild(el('span', 'tag tag--cap', '円堂' + CAPMARK[cn] + 'の技'));
    if (t.dice) info.appendChild(el('span', 'dice-need', diceLabel(t.dice) + ' で成功'));
    if (t.efftxt) info.appendChild(el('span', 'tcard__eff', t.efftxt));
    foot.appendChild(info);

    e.appendChild(foot);
    return e;
  }

  /* ================================================================
   * コインとボール（1枚ずつ並べず、まとめて数で見せる）
   * ============================================================== */
  function coinStack(n) {
    var e = el('div', 'coinstack');
    e.dataset.kind = 'coin';
    e.appendChild(el('div', 'coinstack__coin', '⚡'));
    e.appendChild(el('div', 'coinstack__n', String(n)));
    e.appendChild(el('div', 'coinstack__cap', 'イナズマコイン'));
    return e;
  }

  /* ================================================================
   * 場の山（種類ごとに重ねる）
   * ルールブック9章「場が大きくなってきたら、種類ごとに分けて並べる」を画面でもやる。
   * ============================================================== */
  /* 縦持ちのスマホでは、山をカードではなく小さな札にする（横に5つ並べるため） */
  function pileChip(kindLabel, cards) {
    var e = el('div', 'pilechip');
    e.dataset.pile = kindLabel;
    var top = el('div', 'pilechip__ic');
    if (kindLabel === '選手') { top.textContent = '人'; top.classList.add('ic', 'ic--char'); }
    else { top.className = 'ic ic--' + kindLabel; top.textContent = kindLabel.charAt(0); }
    e.appendChild(top);
    e.appendChild(el('div', 'pilechip__n', String(cards.length)));
    e.appendChild(el('div', 'pilechip__label', kindLabel));
    if (!cards.length) e.classList.add('is-empty');
    return e;
  }

  function pile(kindLabel, cards, ctx) {
    var e = el('div', 'pile');
    e.dataset.pile = kindLabel;

    var deck = el('div', 'pile__deck');
    var top = cards[0];
    if (top) {
      if (top.kind === 'char') {
        var t = faceTile(top, { small: true });
        t.classList.add('pile__top', 'pile__top--char');
        deck.appendChild(t);
      } else {
        var c = techCard(top, ctx);
        c.classList.add('pile__top');
        deck.appendChild(c);
      }
      /* 下に重なっている感じを2枚ぶんだけ出す */
      if (cards.length > 1) deck.appendChild(el('div', 'pile__under pile__under--1'));
      if (cards.length > 2) deck.appendChild(el('div', 'pile__under pile__under--2'));
    } else {
      deck.appendChild(el('div', 'pile__empty', 'なし'));
    }
    e.appendChild(deck);

    var bar = el('div', 'pile__bar');
    bar.appendChild(el('span', 'pile__label', kindLabel));
    bar.appendChild(el('span', 'pile__n', String(cards.length)));
    e.appendChild(bar);

    if (!cards.length) e.classList.add('is-empty');
    return e;
  }

  /* 山札・捨て札のような、中身を見せないカウンター */
  function counter(label, n, cls) {
    var e = el('div', 'counter' + (cls ? ' ' + cls : ''));
    e.appendChild(el('div', 'counter__n', String(n)));
    e.appendChild(el('div', 'counter__label', label));
    return e;
  }

  /* ================================================================
   * 拡大表示（1枚をゆっくり見る）
   * ============================================================== */
  function bigCard(c) {
    if (c.kind === 'tech') {
      var e = el('div', 'big big--tech');
      var art = el('div', 'big__art');
      bg(art, c.img);
      e.appendChild(art);
      var body = el('div', 'big__body');
      var h = el('div', 'big__head');
      h.appendChild(icon(c.type));
      h.appendChild(el('span', 'big__name', c.name));
      if (c.eff.pierce) h.appendChild(el('span', 'tag tag--pierce', '貫通'));
      body.appendChild(h);

      var line = el('div', 'big__line');
      line.appendChild(el('span', 'big__cap', '必要な選手'));
      var who = el('span', 'big__who');
      var bcn = capOf(c);
      [c.main].concat(c.req).forEach(function (b) {
        var w = el('span', 'big__whoone');
        var isCap = (b === '円堂' && bcn);
        w.appendChild(reqChip(b, undefined, isCap ? bcn : 0));
        w.appendChild(el('span', null, isCap
          ? '円堂守' + CAPMARK[bcn] + '（キャプテンが円堂守' + CAPMARK[bcn] + 'の人だけ）' : b));
        who.appendChild(w);
      });
      line.appendChild(who);
      body.appendChild(line);

      if (c.dice) {
        var d = el('div', 'big__line');
        d.appendChild(el('span', 'big__cap', '成功する出目'));
        var pips = el('span', 'big__pips');
        for (var n = 1; n <= 6; n++) {
          pips.appendChild(el('span', 'pip' + (c.dice.indexOf(n) >= 0 ? ' on' : ''), String(n)));
        }
        d.appendChild(pips);
        body.appendChild(d);
      }
      if (c.efftxt) {
        var f = el('div', 'big__line');
        f.appendChild(el('span', 'big__cap', 'カードの効果'));
        f.appendChild(el('span', 'big__eff', (c.eff.pierce ? '【貫通】素手キャッチでは止められない。' : '') + c.efftxt));
        body.appendChild(f);
      }
      e.appendChild(body);
      return e;
    }

    var ce = el('div', 'big big--char');
    var t = faceTile(c);
    t.classList.add('big__tile');
    ce.appendChild(t);
    var cb = el('div', 'big__body');
    cb.appendChild(el('div', 'big__name', c.name + '（' + c.team + '・' + c.pos + '）'));
    var tk = techsOf(c);
    if (tk.main.length) {
      var l1 = el('div', 'big__line');
      l1.appendChild(el('span', 'big__cap', '撃てるワザ'));
      var w1 = el('span', 'big__techs');
      tk.main.forEach(function (tt) {
        var r = el('span', 'big__techone');
        r.appendChild(icon(tt.type));
        r.appendChild(el('span', null, tt.name + (tt.req.length ? '（＋' + tt.req.join('・') + '）' : '')));
        w1.appendChild(r);
      });
      l1.appendChild(w1);
      cb.appendChild(l1);
    }
    if (tk.sub.length) {
      var l2 = el('div', 'big__line');
      l2.appendChild(el('span', 'big__cap', '力を貸すワザ'));
      var w2 = el('span', 'big__techs');
      tk.sub.forEach(function (tt) {
        var r2 = el('span', 'big__techone');
        r2.appendChild(icon(tt.type));
        r2.appendChild(el('span', null, tt.name + '（' + tt.main + 'のワザ）'));
        w2.appendChild(r2);
      });
      l2.appendChild(w2);
      cb.appendChild(l2);
    }
    if (c.cap) cb.appendChild(el('div', 'big__eff', 'キャプテン。奪われず、場に出せず、変更できない。'));
    ce.appendChild(cb);
    return ce;
  }

  /* 場面ごとに一番ふさわしい形で1枚を出す */
  function card(c, ctx) {
    if (!c) return el('div', 'tile tile--back');
    if (c.kind === 'char') return faceTile(c, ctx);
    if (c.kind === 'tech') return techCard(c, ctx);
    return el('div', 'tile tile--back');
  }

  NS.Render = {
    el: el, icon: icon, diceLabel: diceLabel, techsOf: techsOf, INV: INV,
    faceTile: faceTile, techCard: techCard, reqChip: reqChip, capOf: capOf, CAPMARK: CAPMARK,
    coinStack: coinStack, pile: pile, pileChip: pileChip, counter: counter, bigCard: bigCard, card: card,
    url: function (p) { return NS.asset(p); }
  };

})(window);
