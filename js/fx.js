/* テッペンとリーヨ！ ── 演出
 *
 * ここが「盤面の上で起きていることを見せる」担当。
 * エンジンが投げてくるイベントを受けて、必要なら処理を止めて見せる。
 * signature は必殺技カットイン。他の動きは足さない。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var R = NS.Render;

  var root = null;
  var speed = 1;              /* 1=ふつう 0.55=はやい 0=なし */
  var skipResolve = null;
  var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init(elRoot) {
    root = elRoot;
    root.addEventListener('pointerdown', function () {
      if (skipResolve) { var r = skipResolve; skipResolve = null; r(); }
    });
  }
  function setSpeed(v) { speed = v; }

  function hold(ms) {
    if (speed === 0) return Promise.resolve();
    var t = ms * speed;
    return new Promise(function (res) {
      var done = false;
      function fin() { if (done) return; done = true; skipResolve = null; res(); }
      skipResolve = fin;
      setTimeout(fin, reduce ? Math.min(t, 220) : t);
    });
  }

  function clear() { if (root) root.replaceChildren(); root.style.pointerEvents = 'none'; }
  function busy() { root.style.pointerEvents = 'auto'; }

  var TYPE_COLOR = {
    'シュート': 'var(--t-shoot)', 'ドリブル': 'var(--t-dribble)',
    'ディフェンス': 'var(--t-defense)', 'キャッチ': 'var(--t-catch)'
  };
  var TYPE_WORD = {
    'シュート': 'SHOOT', 'ドリブル': 'DRIBBLE',
    'ディフェンス': 'DEFENSE', 'キャッチ': 'CATCH'
  };

  /* ---------------- 必殺技カットイン ---------------- */
  async function cutin(tech, byText, tagText, ms) {
    if (speed === 0) return;
    busy();
    var wrap = R.el('div', 'cutin');
    wrap.style.setProperty('--band', TYPE_COLOR[tech.type] || 'var(--t-shoot)');

    wrap.appendChild(R.el('div', 'cutin__band'));

    var art = R.el('div', 'cutin__art');
    art.style.backgroundImage = 'url("' + R.url(tech.img) + '")';
    wrap.appendChild(art);

    var tx = R.el('div', 'cutin__text');
    tx.appendChild(R.el('div', 'cutin__kind', TYPE_WORD[tech.type] || ''));
    tx.appendChild(R.el('div', 'cutin__name', tech.name));
    if (byText) tx.appendChild(R.el('div', 'cutin__by', byText));
    if (tagText) tx.appendChild(R.el('div', 'cutin__tag', tagText));
    wrap.appendChild(tx);

    /* 稲妻を3本だけ。散らさない */
    [22, 54, 79].forEach(function (x, i) {
      var b = R.el('div', 'bolt');
      b.style.left = x + '%';
      b.style.animationDelay = (0.1 + i * 0.06) + 's';
      wrap.appendChild(b);
    });

    root.appendChild(wrap);
    await hold(ms || 1250);
    wrap.classList.add('is-out');
    await hold(260);
    wrap.remove();
    root.style.pointerEvents = 'none';
  }

  /* ---------------- サイコロ ---------------- */
  var PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8],
    4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
  };

  function dieEl(n) {
    var d = R.el('div', 'die');
    for (var i = 0; i < 9; i++) {
      var p = R.el('i');
      if (PIPS[n].indexOf(i) >= 0) p.className = 'on';
      d.appendChild(p);
    }
    return d;
  }

  async function dice(ev, whoName) {
    if (speed === 0) return;
    busy();
    var stage = R.el('div', 'diceStage');
    stage.appendChild(R.el('div', 'diceStage__who', whoName + ' のサイコロ'));

    var d = dieEl(ev.roll);
    d.classList.add('is-rolling');
    stage.appendChild(d);

    var row = R.el('div', 'needrow');
    for (var n = 1; n <= 6; n++) {
      var p = R.el('div', 'pip', String(n));
      if (ev.need.indexOf(n) >= 0) p.classList.add('need');
      row.appendChild(p);
    }
    stage.appendChild(row);

    var verdict = R.el('div', 'diceStage__verdict');
    verdict.style.visibility = 'hidden';
    verdict.textContent = ' ';
    stage.appendChild(verdict);

    root.appendChild(stage);
    await hold(760);                       /* 転がる */

    d.classList.remove('is-rolling');
    d.classList.add(ev.ok ? 'is-hit' : 'is-miss');
    row.children[ev.roll - 1].classList.add('rolled');
    verdict.style.visibility = 'visible';
    verdict.className = 'diceStage__verdict ' + (ev.ok ? 'ok' : 'ng');
    verdict.textContent = ev.ok
      ? (ev.of === 'catch' ? 'とめた！' : 'ぬけた！')
      : (ev.of === 'catch' ? 'とどかない…' : 'つかまった…');

    await hold(1050);
    stage.remove();
    root.style.pointerEvents = 'none';
  }

  /* ---------------- ゴール ---------------- */
  async function goal(name, techName) {
    if (speed === 0) return;
    busy();
    var g = R.el('div', 'goalfx');
    var box = R.el('div');
    box.style.textAlign = 'center';
    box.appendChild(R.el('div', 'goalfx__word', 'ゴール！'));
    box.appendChild(R.el('div', 'goalfx__who', name + '　［' + techName + '］'));
    g.appendChild(box);

    for (var i = 0; i < 14; i++) {
      var s = R.el('div', 'spark');
      s.style.left = (6 + Math.random() * 88) + '%';
      s.style.top = (18 + Math.random() * 64) + '%';
      s.style.rotate = (Math.random() * 90 - 45) + 'deg';
      s.animate(
        [{ opacity: 0, translate: '0 0', scale: .4 },
         { opacity: 1, translate: '0 -26px', scale: 1, offset: .35 },
         { opacity: 0, translate: '0 -70px', scale: .6 }],
        { duration: 900 * speed, delay: Math.random() * 320 * speed, easing: 'cubic-bezier(.16,.94,.16,1)' }
      );
      g.appendChild(s);
    }
    root.appendChild(g);
    await hold(1500);
    g.remove();
    root.style.pointerEvents = 'none';
  }

  /* ---------------- 一言 ---------------- */
  async function toast(text, ms) {
    if (speed === 0) return;
    var t = R.el('div', 'toast');
    t.appendChild(R.el('span', null, text));
    root.appendChild(t);
    await hold(ms || 900);
    t.remove();
  }

  /* アニメの完了を待つ。タブが裏に回っていたり描画が止まっていると
   * finished が解決されないことがあるので、必ず時間切れで先に進める。
   * ここで止まるとゲームそのものが固まってしまう。 */
  function settle(anim, el, ms) {
    var done = false;
    function fin() { if (done) return; done = true; el.remove(); }
    return Promise.race([
      anim.finished.catch(function () { }),
      new Promise(function (r) { setTimeout(r, ms + 400); })
    ]).then(fin, fin);
  }

  /* ---------------- カードが飛ぶ ---------------- */
  function flyCard(fromRect, toRect, cardData, ms) {
    if (speed === 0 || !fromRect || !toRect) return Promise.resolve();
    var f = R.el('div', 'flyer');
    f.style.left = fromRect.left + 'px';
    f.style.top = fromRect.top + 'px';
    f.style.width = fromRect.width + 'px';
    f.style.height = fromRect.height + 'px';
    if (cardData && cardData.img) f.style.backgroundImage = 'url("' + R.url(cardData.img) + '")';
    else if (cardData && cardData.kind === 'coin') f.style.background = 'radial-gradient(circle at 38% 30%,#FFE58A,#FFCE1F 42%,#E2A300 78%)';
    root.appendChild(f);
    var dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2);
    var dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2);
    var dur = (ms || 520) * speed;
    var a = f.animate(
      [{ translate: '0 0', scale: 1, rotate: '0deg' },
       { translate: (dx * .5) + 'px ' + (dy * .5 - 30) + 'px', scale: 1.12, rotate: '-8deg', offset: .5 },
       { translate: dx + 'px ' + dy + 'px', scale: .72, rotate: '2deg', opacity: .25 }],
      { duration: dur, easing: 'cubic-bezier(.16,.94,.16,1)' }
    );
    return settle(a, f, dur);
  }

  function flyBall(fromRect, toRect) {
    if (speed === 0 || !fromRect || !toRect) return Promise.resolve();
    var b = R.el('div', 'flyball', '⚽');
    b.style.left = (fromRect.left + fromRect.width / 2 - 17) + 'px';
    b.style.top = (fromRect.top + fromRect.height / 2 - 17) + 'px';
    root.appendChild(b);
    var dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2);
    var dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2);
    var dur = 640 * speed;
    var a = b.animate(
      [{ translate: '0 0', rotate: '0deg' },
       { translate: (dx * .5) + 'px ' + (dy * .5 - 70) + 'px', rotate: '260deg', offset: .5 },
       { translate: dx + 'px ' + dy + 'px', rotate: '540deg' }],
      { duration: dur, easing: 'cubic-bezier(.3,.7,.2,1)' }
    );
    return settle(a, b, dur);
  }

  /* ---------------- 決着 ---------------- */
  function finish(html, onAgain) {
    busy();
    var f = R.el('div', 'finish');
    f.innerHTML = html;
    var btn = R.el('button', 'btn btn--go', 'もう1試合');
    btn.addEventListener('click', function () { f.remove(); root.style.pointerEvents = 'none'; onAgain(); });
    f.appendChild(btn);
    root.appendChild(f);
  }

  NS.Fx = {
    init: init, setSpeed: setSpeed, getSpeed: function () { return speed; },
    hold: hold, clear: clear,
    cutin: cutin, dice: dice, goal: goal, toast: toast,
    flyCard: flyCard, flyBall: flyBall, finish: finish
  };

})(window);
