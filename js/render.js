/* テッペンとリーヨ！ ── カードの絵づくり
 * 画像は base64 で埋め込まない。リポジトリ内のファイルをそのまま参照する。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var DATA = NS.DATA;

  function url(path) { return encodeURI(path); }

  /* base → そのキャラが関わるワザ */
  var INV = {};
  DATA.techs.forEach(function (t) {
    (INV[t.main] = INV[t.main] || { main: [], sub: [] }).main.push(t);
    t.req.forEach(function (r) {
      (INV[r] = INV[r] || { main: [], sub: [] }).sub.push(t);
    });
  });

  function techsOf(ch) {
    var inv = INV[ch.base] || { main: [], sub: [] };
    var m = inv.main.slice(), s = inv.sub.slice();
    if (ch.only) {
      m = m.filter(function (t) { return ch.only.indexOf(t.name) >= 0; });
      s = s.filter(function (t) { return ch.only.indexOf(t.name) >= 0; });
    }
    return { main: m, sub: s };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
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

  /* ---------------- キャラクターカード ---------------- */
  function charCard(c, detail) {
    var e = el('div', 'card card--char');
    e.dataset.uid = c.uid;
    e.dataset.kind = 'char';

    e.appendChild(el('div', 'card__name', c.name));

    var art = el('div', 'card__art');
    art.style.backgroundImage = 'url("' + url(c.img) + '")';
    e.appendChild(art);

    var pos = el('div', 'card__pos', c.pos);
    pos.dataset.pos = c.pos;
    e.appendChild(pos);

    var foot = el('div', 'card__foot');
    var tk = techsOf(c);
    var lines = tk.main.concat(tk.sub);
    var limit = detail ? lines.length : 2;
    lines.slice(0, limit).forEach(function (t) {
      var ln = el('div', 'tline');
      ln.appendChild(icon(t.type));
      var b = el('b', null, t.name);
      ln.appendChild(b);
      var others = t.req.filter(function (r) { return r !== c.base; });
      if (t.main !== c.base) others = [t.main].concat(others).filter(function (r) { return r !== c.base; });
      if (others.length) ln.appendChild(el('span', 'req', '（' + others.join('・') + '）'));
      foot.appendChild(ln);
    });
    if (!detail && lines.length > limit) {
      foot.appendChild(el('div', 'tline', '＋' + (lines.length - limit)));
    }
    if (!lines.length) foot.appendChild(el('div', 'tline', 'ワザなし'));
    e.appendChild(foot);

    if (c.cap) {
      e.classList.add('is-captain');
      e.appendChild(el('div', 'card__cap', 'キャプテン'));
    }
    return e;
  }

  /* ---------------- 必殺カード ---------------- */
  function techCard(c, detail) {
    var e = el('div', 'card card--tech card--' + c.type);
    e.dataset.uid = c.uid;
    e.dataset.kind = 'tech';

    var nm = el('div', 'card__name');
    nm.appendChild(icon(c.type));
    nm.appendChild(el('span', null, c.name));
    e.appendChild(nm);

    var art = el('div', 'card__art');
    art.style.backgroundImage = 'url("' + url(c.img) + '")';
    e.appendChild(art);

    var foot = el('div', 'card__foot');
    if (c.eff.pierce) foot.appendChild(el('span', 'pierce', '貫通'));
    var who = [c.main].concat(c.req).join(' ＋ ');
    foot.appendChild(el('div', 'tline', who));
    if (c.dice) {
      var d = el('div', 'dice-need', '出目 ' + diceLabel(c.dice));
      foot.appendChild(d);
    }
    if (detail && c.efftxt) foot.appendChild(el('div', 'tline', c.efftxt));
    else if (c.efftxt && !c.eff.pierce) foot.appendChild(el('div', 'tline', c.efftxt));
    e.appendChild(foot);
    return e;
  }

  function coinCard(c) {
    var e = el('div', 'card card--coin');
    e.dataset.uid = c.uid; e.dataset.kind = 'coin';
    e.appendChild(el('div', 'glyph', '⚡'));
    e.appendChild(el('div', 'cap', 'イナズマコイン'));
    return e;
  }

  function ballCard(c) {
    var e = el('div', 'card card--ball');
    e.dataset.uid = c.uid; e.dataset.kind = 'ball';
    e.appendChild(el('div', 'glyph', '⚽'));
    e.appendChild(el('div', 'cap', 'ボール'));
    return e;
  }

  function backCard() {
    var e = el('div', 'card card--back');
    e.appendChild(el('div', 'glyph', '⚡'));
    return e;
  }

  function card(c, detail) {
    if (!c) return backCard();
    if (c.kind === 'char') return charCard(c, detail);
    if (c.kind === 'tech') return techCard(c, detail);
    if (c.kind === 'coin') return coinCard(c);
    if (c.kind === 'ball') return ballCard(c);
    return backCard();
  }

  NS.Render = {
    card: card, backCard: backCard, url: url,
    diceLabel: diceLabel, techsOf: techsOf, el: el, icon: icon, INV: INV
  };

})(window);
