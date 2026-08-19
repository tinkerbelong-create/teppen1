/* テッペンとリーヨ！ ── 効果音
 *
 * 音のファイルを1つも使わずに、その場で音を作って鳴らします（ブラウザの機能）。
 * ダウンロードが増えないので、通信対戦でも重くなりません。
 *
 * ■ 本物の音源に差し替えたくなったら
 *   js/config.js の sound.files に、鳴らしたい音のファイル名を書くだけです。
 *   書いた音だけが差し替わり、書いていない音は今までどおり鳴ります。
 *   くわしくは 資料/音の差し替え方.md を読んでください。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN;
  var CFG = NS.CONFIG;

  var ctx = null;      /* 音を鳴らす装置。最初に画面を触った時に作る */
  var master = null;   /* 全体の音量つまみ */
  var on = true;
  var vol = 0.6;
  var files = {};      /* 差し替え用の音源（読み込み済み） */

  /* ブラウザは「利用者が一度も触っていない状態」では音を出せない決まりになっている。
   * なので装置を作るのは、最初のクリックまで待つ。 */
  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);
    return ctx;
  }

  /* ---------------- 音の部品 ---------------- */

  /* 単音。freq から to へすべらせながら鳴らす */
  function tone(o) {
    var c = ensure(); if (!c) return;
    var t0 = c.currentTime + (o.at || 0);
    var dur = o.dur || 0.12;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to && o.to !== o.freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    var peak = (o.gain == null ? 0.22 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  /* ざらついた音（紙・風・笛の下地）。ホワイトノイズを削って作る */
  function noise(o) {
    var c = ensure(); if (!c) return;
    var t0 = c.currentTime + (o.at || 0);
    var dur = o.dur || 0.12;
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = o.lowpass ? 'lowpass' : 'bandpass';
    f.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + dur);
    f.Q.value = o.q || 1;
    var g = c.createGain();
    var peak = (o.gain == null ? 0.18 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.015, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  /* 音階を数字で書けるようにする。0 = ラ（440Hz） */
  function nt(n) { return 440 * Math.pow(2, n / 12); }

  /* ---------------- 音の一覧 ----------------
   * 名前 → 鳴らし方。ここを増やせば新しい音を足せます。 */
  var VOICE = {

    /* カードやボタンを触った */
    tap: function () {
      tone({ freq: nt(12), to: nt(16), dur: 0.05, type: 'triangle', gain: 0.13 });
    },

    /* 画面を進める大きめのボタン */
    press: function () {
      tone({ freq: nt(4), to: nt(11), dur: 0.09, type: 'square', gain: 0.18 });
      tone({ freq: nt(16), dur: 0.07, type: 'triangle', gain: 0.10, at: 0.04 });
    },

    /* カードを場に置く。紙がすべって、コトッと落ちる */
    card: function () {
      noise({ freq: 2600, to: 900, dur: 0.11, gain: 0.14 });
      tone({ freq: 150, to: 80, dur: 0.09, type: 'sine', gain: 0.20, at: 0.05 });
    },

    /* 山札から引く */
    draw: function () {
      noise({ freq: 900, to: 3000, dur: 0.13, gain: 0.11 });
    },

    /* 誰かの番になった */
    turn: function () {
      tone({ freq: nt(0), dur: 0.10, type: 'triangle', gain: 0.14 });
      tone({ freq: nt(7), dur: 0.13, type: 'triangle', gain: 0.14, at: 0.09 });
    },

    /* ボールが動く */
    ball: function () {
      tone({ freq: nt(-5), to: nt(7), dur: 0.16, type: 'sine', gain: 0.18 });
    },

    /* サイコロが転がる */
    dice: function () {
      for (var i = 0; i < 5; i++) {
        noise({ freq: 1800 + Math.random() * 1200, dur: 0.035, gain: 0.12, at: i * 0.075, q: 6 });
      }
    },

    /* 出目が当たり */
    diceOk: function () {
      tone({ freq: nt(4), dur: 0.09, type: 'square', gain: 0.20 });
      tone({ freq: nt(11), dur: 0.09, type: 'square', gain: 0.20, at: 0.08 });
      tone({ freq: nt(16), dur: 0.20, type: 'square', gain: 0.20, at: 0.16 });
    },

    /* 出目が外れ */
    diceNg: function () {
      tone({ freq: nt(3), to: nt(-4), dur: 0.26, type: 'sawtooth', gain: 0.16 });
    },

    /* 必殺技のカットイン。ためて、切り込む */
    cutin: function () {
      tone({ freq: nt(-12), to: nt(4), dur: 0.34, type: 'sawtooth', gain: 0.16 });
      noise({ freq: 400, to: 5000, dur: 0.30, gain: 0.13 });
      tone({ freq: nt(16), to: nt(4), dur: 0.28, type: 'square', gain: 0.14, at: 0.30 });
    },

    /* ゴール！ 笛とファンファーレ */
    goal: function () {
      noise({ freq: 2400, dur: 0.50, gain: 0.09, q: 3 });
      [0, 4, 7, 12].forEach(function (n, i) {
        tone({ freq: nt(n), dur: 0.16, type: 'square', gain: 0.22, at: i * 0.085 });
      });
      tone({ freq: nt(19), dur: 0.50, type: 'square', gain: 0.22, at: 0.36 });
      tone({ freq: nt(12), dur: 0.50, type: 'triangle', gain: 0.16, at: 0.36 });
    },

    /* とめた！（キャッチ成功） */
    stop: function () {
      tone({ freq: 120, to: 60, dur: 0.22, type: 'square', gain: 0.28 });
      noise({ freq: 700, to: 200, dur: 0.25, gain: 0.20, lowpass: true });
      tone({ freq: nt(7), dur: 0.28, type: 'triangle', gain: 0.15, at: 0.12 });
    },

    /* ぬけた！（ドリブル成功） */
    breakthrough: function () {
      noise({ freq: 600, to: 4200, dur: 0.28, gain: 0.17 });
      tone({ freq: nt(0), to: nt(14), dur: 0.26, type: 'triangle', gain: 0.18 });
    },

    /* 失敗した */
    fail: function () {
      tone({ freq: nt(-2), to: nt(-9), dur: 0.24, type: 'sawtooth', gain: 0.14 });
    },

    /* コインをもらった */
    coin: function () {
      tone({ freq: nt(14), dur: 0.07, type: 'square', gain: 0.18 });
      tone({ freq: nt(21), dur: 0.24, type: 'square', gain: 0.18, at: 0.06 });
    },

    /* コインを払った */
    spend: function () {
      tone({ freq: nt(9), to: nt(2), dur: 0.14, type: 'square', gain: 0.15 });
    },

    /* 奪う・引き抜く */
    steal: function () {
      noise({ freq: 3000, to: 700, dur: 0.14, gain: 0.18 });
      tone({ freq: nt(9), to: nt(-3), dur: 0.16, type: 'sawtooth', gain: 0.15 });
    },

    /* 手番が飛んで自分に回ってきた */
    takeover: function () {
      [0, 5, 9, 14].forEach(function (n, i) {
        tone({ freq: nt(n), dur: 0.12, type: 'square', gain: 0.19, at: i * 0.07 });
      });
    },

    /* 勝った */
    win: function () {
      [0, 4, 7, 12, 16].forEach(function (n, i) {
        tone({ freq: nt(n), dur: 0.18, type: 'square', gain: 0.22, at: i * 0.13 });
      });
      tone({ freq: nt(19), dur: 0.90, type: 'square', gain: 0.22, at: 0.65 });
      tone({ freq: nt(12), dur: 0.90, type: 'triangle', gain: 0.15, at: 0.65 });
    },

    /* 負けた・引き分け */
    lose: function () {
      [4, 2, -1, -5].forEach(function (n, i) {
        tone({ freq: nt(n), dur: 0.28, type: 'triangle', gain: 0.17, at: i * 0.19 });
      });
    }
  };

  /* ---------------- 差し替え用の音源 ---------------- */
  function fileFor(name) {
    var conf = (CFG.sound && CFG.sound.files) || {};
    var path = conf[name];
    if (!path) return null;
    if (!files[name]) {
      var a = new Audio(NS.asset(path));
      a.preload = 'auto';
      files[name] = a;
    }
    return files[name];
  }

  /* ---------------- 鳴らす ---------------- */
  function play(name) {
    if (!on || !name) return;
    var f = fileFor(name);
    if (f) {
      try {
        var c = f.cloneNode();       /* 続けて鳴らせるように複製して再生する */
        c.volume = vol;
        var pr = c.play();
        if (pr && pr.catch) pr.catch(function () { });
      } catch (e) { }
      return;
    }
    var v = VOICE[name];
    if (!v) return;
    try { v(); } catch (e) { }
  }

  function setOn(v) {
    on = !!v;
    try { localStorage.setItem('teppen.se.on', on ? '1' : '0'); } catch (e) { }
    if (on) ensure();
  }
  function setVolume(v) {
    vol = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = vol;
    try { localStorage.setItem('teppen.se.vol', String(vol)); } catch (e) { }
  }
  function isOn() { return on; }
  function volume() { return vol; }

  /* 前回の設定を思い出す */
  (function restore() {
    var c = (CFG.sound || {});
    on = (c.on !== false);
    vol = (c.volume == null ? 0.6 : c.volume);
    try {
      var so = localStorage.getItem('teppen.se.on');
      if (so !== null) on = (so === '1');
      var sv = localStorage.getItem('teppen.se.vol');
      if (sv !== null && !isNaN(parseFloat(sv))) vol = parseFloat(sv);
    } catch (e) { }
  })();

  NS.SE = {
    play: play, setOn: setOn, setVolume: setVolume,
    isOn: isOn, volume: volume, unlock: ensure,
    names: Object.keys(VOICE)
  };

})(window);
