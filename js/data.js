/* テッペンとリーヨ！ ── カードのデータ
 *
 * ここは「データだけ」です。処理は書きません。
 * 将来そのままJSONに移せるように、画像のパスも組み立てずに文字列で持っています。
 *
 * face … 顔タイルの切り取り方。省略すると config.js の既定値（zoom 125 / y 0）を使います。
 *        25枚を実際に見て、頭の大きさが揃うように決めた数値です。
 *        画像を差し替えて顔がずれたら、ここの数値だけ直してください。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN = global.TEPPEN || {};

  /* ------------------------------------------------------------------
   * キャラクター（山札に入る24人）
   * ---------------------------------------------------------------- */
  var CHARS = [
    { base: '円堂',        pos: 'GK', team: '雷門',       img: 'キャラクターメイン/雷門/円堂　GK.webp' },
    { base: '豪炎寺',      pos: 'FW', team: '雷門',       img: 'キャラクターメイン/雷門/豪炎寺　FW.webp',
      face: { zoom: 132 } },                                  /* 顔が他より小さく写っているので寄せる */
    { base: '鬼道（雷門）', pos: 'MF', team: '雷門',       img: 'キャラクターメイン/雷門/鬼道（雷門）　MF.jpg' },
    { base: '風丸',        pos: 'DF', team: '雷門',       img: 'キャラクターメイン/雷門/風丸　DF.webp',
      face: { x: 45 } },                                      /* 右に大きな髪。顔は左寄り */
    { base: '染岡',        pos: 'FW', team: '雷門',       img: 'キャラクターメイン/雷門/染岡　FW.webp' },
    { base: '壁山',        pos: 'DF', team: '雷門',       img: 'キャラクターメイン/雷門/壁山　DF.webp',
      face: { zoom: 116 } },                                  /* 頭が大きく広いので引く */
    { base: '土門',        pos: 'DF', team: '雷門',       img: 'キャラクターメイン/雷門/土門　DF.webp' },
    { base: '一之瀬',      pos: 'MF', team: '雷門',       img: 'キャラクターメイン/雷門/一之瀬　MF.webp' },
    { base: 'マックス',    pos: 'FW', team: '雷門',       img: 'キャラクターメイン/雷門/マックス　FW.webp',
      face: { zoom: 120 } },                                  /* 帽子ぶん上に余白が要る */
    { base: 'メガネ',      pos: 'FW', team: '雷門',       img: 'キャラクターメイン/雷門/メガネ　FW.webp' },
    { base: '仁',          pos: 'DF', team: '雷門',       img: 'キャラクターメイン/雷門/仁　DF.webp',
      face: { zoom: 120 } },
    { base: 'しょうりん',  pos: 'MF', team: '雷門',       img: 'キャラクターメイン/雷門/しょうりん　MF.webp',
      face: { zoom: 118, x: 46 } },                           /* 右に大きなポニーテール */
    { base: 'げんおう',    pos: 'GK', team: '帝国',       img: 'キャラクターメイン/帝国/げんおう　GK.webp' },
    { base: '鬼道（帝国）', pos: 'MF', team: '帝国',       img: 'キャラクターメイン/帝国/鬼道（帝国）　MF.webp' },
    { base: '佐久間',      pos: 'FW', team: '帝国',       img: 'キャラクターメイン/帝国/佐久間　FW.webp',
      face: { zoom: 118, x: 53 } },                           /* 長い髪が左右に広がる */
    { base: '寺門',        pos: 'FW', team: '帝国',       img: 'キャラクターメイン/帝国/寺門　FW.webp' },
    { base: '洞面',        pos: 'MF', team: '帝国',       img: 'キャラクターメイン/帝国/洞面　MF.webp',
      face: { zoom: 114 } },                                  /* 髪が横に大きく張り出す */
    { base: '友',          pos: 'FW', team: '木戸川清修', img: 'キャラクターメイン/木戸川清修/友　FW.webp',
      face: { zoom: 120 } },
    { base: '勝',          pos: 'FW', team: '木戸川清修', img: 'キャラクターメイン/木戸川清修/勝　FW.webp' },
    { base: '努',          pos: 'FW', team: '木戸川清修', img: 'キャラクターメイン/木戸川清修/努　FW.webp' },
    { base: '西垣',        pos: 'DF', team: '木戸川清修', img: 'キャラクターメイン/木戸川清修/西垣　DF.webp' },
    { base: 'アフロディ',  pos: 'MF', team: '世宇子',     img: 'キャラクターメイン/世宇子/アフロディ　MF.webp' },
    { base: 'デメテル',    pos: 'FW', team: '世宇子',     img: 'キャラクターメイン/世宇子/デメテル　FW.webp',
      face: { zoom: 118 } },                                  /* 兜の飾りが上に伸びる */
    { base: 'ヘラ',        pos: 'MF', team: '世宇子',     img: 'キャラクターメイン/世宇子/ヘラ　MF.webp' },
    { base: 'ポセイドン',  pos: 'GK', team: '世宇子',     img: 'キャラクターメイン/世宇子/ポセイドン　GK.webp',
      face: { zoom: 120 } }
  ];

  /* ------------------------------------------------------------------
   * キャプテン＝円堂守4種（山札には入らない）
   *   only … その円堂が関われるワザ。カードに書かれている2つだけ。
   * ---------------------------------------------------------------- */
  var CAPTAINS = [
    { name: '円堂守①', cap: 1, only: ['ゴッドハンド', 'イナズマブレイク'] },
    { name: '円堂守②', cap: 2, only: ['マジン・ザ・ハンド', 'イナズマ１号落とし'] },
    { name: '円堂守③', cap: 3, only: ['熱血パンチ', 'ザ・フェニックス'] },
    { name: '円堂守④', cap: 4, only: ['爆裂パンチ', 'トライペガサス'] }
  ];

  /* ------------------------------------------------------------------
   * 必殺カード（36枚）
   * ---------------------------------------------------------------- */
  var TECHS = [
    /* ---- シュート 21 ---- */
    { name: 'ファイアトルネード', type: 'シュート', main: '豪炎寺', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技シュート/ファイアトルネード　豪炎寺.png' },
    { name: 'ドラゴンクラッシュ', type: 'シュート', main: '染岡', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技シュート/ドラゴンクラッシュ　染岡.png' },
    { name: 'バックトルネード', type: 'シュート', main: '勝', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技シュート/バックトルネード　勝.png' },
    { name: 'クロスドライブ', type: 'シュート', main: 'マックス', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技シュート/クロスドライブ　マックス.png' },
    { name: 'スピニングショット', type: 'シュート', main: '一之瀬', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技シュート/スピニングショット　一之瀬｛画像に名前なし｝.png' },
    { name: '百裂ショット', type: 'シュート', main: '寺門', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技シュート/百裂ショット　寺門.png' },
    { name: 'ディバインアロー', type: 'シュート', main: 'ヘラ', req: [], dice: null,
      eff: { draw: 1 }, efftxt: '決まったら、山札から1枚引く',
      img: '必殺技シュート/ディバインアロー　ヘラ.png' },
    { name: 'リフレクトバスター', type: 'シュート', main: 'デメテル', req: [], dice: null,
      eff: { scout: 1 }, efftxt: '決まったら、場から1枚を無料でスカウト',
      img: '必殺技シュート/リフレクトバスター　デメテル.png' },
    { name: 'ゴッドノウズ', type: 'シュート', main: 'アフロディ', req: [], dice: null,
      eff: { steal: 1 }, efftxt: '決まったら、相手の伏せ手札から1枚を奪う',
      img: '必殺技シュート/ゴッドノウズ　アフロディ.png' },

    /* --- 2人技：ぜんぶ「資源が増える」方向にそろえた --- */
    { name: 'イナズマ落とし', type: 'シュート', main: '豪炎寺', req: ['壁山'], dice: null,
      eff: { draw: 2 }, efftxt: '決まったら、山札から2枚引く',
      img: '必殺技シュート/イナズマ落とし　豪炎寺（壁山）.png' },
    { name: 'メガネクラッシュ', type: 'シュート', main: 'メガネ', req: ['染岡'], dice: null,
      eff: { scout: 1, coin: 1 }, efftxt: '決まったら、場から1枚を無料で拾い、コインを1個もらう',
      img: '必殺技シュート/メガネクラッシュ　メガネ（染岡）｛画像に名前なし｝.png' },
    { name: 'ドラゴントルネード', type: 'シュート', main: '染岡', req: ['豪炎寺'], dice: null,
      eff: { steal: 1, coin: 1 }, efftxt: '決まったら、相手の伏せ手札から1枚を奪い、コインを1個もらう',
      img: '必殺技シュート/ドラゴントルネード　染岡（豪炎寺）.png' },
    { name: 'ツインブースト', type: 'シュート', main: '鬼道（帝国）', req: ['佐久間'], dice: null,
      eff: { fieldToDeck: 1, scout: 1 }, efftxt: '決まったら、場から1枚を山札に戻し、場から1枚を無料で拾う',
      img: '必殺技シュート/ツインブースト　鬼道（佐久間）.png' },
    { name: '炎の風見鶏', type: 'シュート', main: '豪炎寺', req: ['風丸'], dice: null,
      eff: { returnToHand: true }, efftxt: '決まったら、このカードは場に出ず手札に戻る',
      img: '必殺技シュート/炎の風見鶏　豪炎寺（風丸）.png' },

    /* --- 3人技：ぜんぶ「試合の流れを変える」方向にそろえた --- */
    { name: 'トライアングルZ', type: 'シュート', main: '友', req: ['勝', '努'], dice: null,
      eff: { draw: 3, coin: 2 }, efftxt: '決まったら、山札から3枚引き、コインを2個もらう',
      img: '必殺技シュート/トライアングルZ　友（勝・努）.png' },
    { name: 'デスゾーン', type: 'シュート', main: '佐久間', req: ['寺門', '洞面'], dice: null,
      eff: { pierce: true, raidFree: 1 }, efftxt: '決まったら、相手の選手を1人ただで引き抜く（キャプテンを除く）',
      img: '必殺技シュート/デスゾーン　佐久間（寺門・洞面）.png' },
    { name: '皇帝ペンギン２号', type: 'シュート', main: '鬼道（帝国）', req: ['佐久間', '寺門'], dice: null,
      eff: { pierce: true, coin: 3 }, efftxt: '決まったら、コインを3個もらう',
      img: '必殺技シュート/皇帝ペンギン２号　鬼道（佐久間・寺門）.png' },
    { name: 'イナズマ１号落とし', type: 'シュート', main: '豪炎寺', req: ['円堂', '壁山'], dice: null,
      eff: { pierce: true, dig: 3 }, efftxt: '決まったら、山札の上3枚を見て1枚を手札に、残りは場に出す',
      img: '必殺技シュート/イナズマ１号落とし　豪炎寺（円堂・壁山）｛画像に名前なし｝.png' },
    { name: 'ザ・フェニックス', type: 'シュート', main: '一之瀬', req: ['土門', '円堂'], dice: null,
      eff: { pierce: true, steal: 2 }, efftxt: '決まったら、相手の伏せ手札から2枚を奪う',
      img: '必殺技シュート/ザ・フェニックス　一之瀬（土門・円堂）.png' },
    { name: 'トライペガサス', type: 'シュート', main: '一之瀬', req: ['土門', '円堂'], dice: null,
      eff: { pierce: true, draw: 3 }, efftxt: '決まったら、山札から3枚引く',
      img: '必殺技シュート/トライペガサス　一之瀬（土門・円堂）.png' },
    { name: 'イナズマブレイク', type: 'シュート', main: '鬼道（雷門）', req: ['豪炎寺', '円堂'], dice: null,
      eff: { pierce: true, keepBall: true, extraTurn: true },
      efftxt: '決まっても、ボールは相手に渡らない。さらにもう一度、自分の手番',
      img: '必殺技シュート/イナズマブレイク　鬼道（豪炎寺・円堂）｛画像に名前なし｝.png' },

    /* ---- ドリブル 4（効果なし。強さは出目だけ） ---- */
    { name: '疾風ダッシュ', type: 'ドリブル', main: '風丸', req: [], dice: [3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技ドリブル/疾風ダッシュ　風丸.png' },
    { name: 'ヘブンズタイム', type: 'ドリブル', main: 'アフロディ', req: [], dice: [3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技ドリブル/ヘブンズタイム　アフロディ.png' },
    { name: '竜巻旋風', type: 'ドリブル', main: 'しょうりん', req: [], dice: [4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技ドリブル/竜巻旋風　しょうりん.png' },
    { name: 'ダッシュストーム', type: 'ドリブル', main: 'デメテル', req: [], dice: [4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技ドリブル/ダッシュストーム　デメテル　｛画像に名前なし｝.png' },

    /* ---- ディフェンス 4 ---- */
    { name: 'ザ・ウォール', type: 'ディフェンス', main: '壁山', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技ディフェンス/ザ・ウォール　壁山.png' },
    { name: 'キラースライド', type: 'ディフェンス', main: '土門', req: [], dice: null, eff: {}, efftxt: '',
      img: '必殺技ディフェンス/キラースライド　土門.png' },
    { name: 'スピニングカット', type: 'ディフェンス', main: '西垣', req: [], dice: null,
      eff: { draw: 1 }, efftxt: '成功したら、山札から1枚引く',
      img: '必殺技ディフェンス/スピニングカット　西垣.png' },
    { name: 'コイルターン', type: 'ディフェンス', main: '仁', req: [], dice: null,
      eff: { draw: 1 }, efftxt: '成功したら、山札から1枚引く',
      img: '必殺技ディフェンス/コイルターン　仁.png' },

    /* ---- キャッチ 7（出目が効果） ---- */
    { name: 'マジン・ザ・ハンド', type: 'キャッチ', main: '円堂', req: [], dice: [2, 3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/マジン・ザ・ハンド　円堂.png' },
    { name: 'ゴッドハンド', type: 'キャッチ', main: '円堂', req: [], dice: [1, 3, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/ゴッドハンド　円堂.png' },
    { name: '爆裂パンチ', type: 'キャッチ', main: '円堂', req: [], dice: [3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/爆裂パンチ　円堂.png' },
    { name: '熱血パンチ', type: 'キャッチ', main: '円堂', req: [], dice: [4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/熱血パンチ　円堂.png' },
    { name: 'フルパワーシールド', type: 'キャッチ', main: 'げんおう', req: [], dice: [2, 3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/フルパワーシールド　げんおう.png' },
    { name: 'パワーシールド', type: 'キャッチ', main: 'げんおう', req: [], dice: [3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/パワーシールド　げんおう.png' },
    { name: 'ツナミウォール', type: 'キャッチ', main: 'ポセイドン', req: [], dice: [2, 3, 4, 5, 6], eff: {}, efftxt: '',
      img: '必殺技キャッチ/ツナミウォール　ポセイドン.png' }
  ];

  /* ------------------------------------------------------------------
   * ここから下は、上のデータを使いやすい形に並べ替えているだけです。
   * ---------------------------------------------------------------- */

  var charByBase = {};
  CHARS.forEach(function (c) { charByBase[c.base] = c; });

  function makeChar(src, extra) {
    var c = {
      kind: 'char', name: src.base, base: src.base,
      pos: src.pos, team: src.team, img: src.img, face: src.face || null,
      cap: 0, only: null
    };
    if (extra) for (var k in extra) c[k] = extra[k];
    return c;
  }

  var deckChars = CHARS.map(function (c) { return makeChar(c); })
    .filter(function (c) { return c.base !== '円堂'; });

  var captains = CAPTAINS.map(function (cp) {
    return makeChar(charByBase['円堂'], { name: cp.name, cap: cp.cap, only: cp.only });
  });

  var techs = TECHS.map(function (t) {
    return {
      kind: 'tech',
      name: t.name, type: t.type, main: t.main, req: t.req,
      dice: t.dice, eff: t.eff, efftxt: t.efftxt, img: t.img,
      combo: t.req.length + 1
    };
  });

  var techByName = {};
  techs.forEach(function (t) { techByName[t.name] = t; });

  /* ------------------------------------------------------------------
   * 収録するキャラクターの絞り込み
   *
   * 'full' … 24人（これまでどおり）
   * 'v2'   … 18人。1人技しか持たないキャラと、他の技に乗るだけのキャラを外した。
   *          外すと、その人が主のワザも一緒に消える。
   * ---------------------------------------------------------------- */
  var ROSTER_OUT = {
    v2: ['マックス', 'メガネ', 'ヘラ', '友', '勝', '努'],   /* 18人 */
    v2b: ['マックス', 'メガネ', 'ヘラ']                     /* 21人。木戸川の三兄弟を残す案 */
  };

  function rosterFor(name) {
    var out = ROSTER_OUT[name];
    if (!out) return { chars: deckChars, techs: techs };
    var gone = {};
    out.forEach(function (b) { gone[b] = true; });
    var cs = deckChars.filter(function (c) { return !gone[c.base]; });
    var ts = techs.filter(function (t) {
      if (gone[t.main]) return false;                              /* 使い手がいない */
      return !t.req.some(function (r) { return gone[r]; });        /* 相方がいない */
    });
    return { chars: cs, techs: ts };
  }

  NS.DATA = {
    captains: captains,
    deckChars: deckChars,
    rosterFor: rosterFor,
    rosterNames: ['full', 'v2'],
    charByBase: charByBase,
    techs: techs,
    techByName: techByName,
    typeOrder: ['シュート', 'ドリブル', 'ディフェンス', 'キャッチ'],
    /* 素手キャッチの出目：円堂は6のみ、それ以外のキーパーは5か6 */
    bareHandDice: function (charBase) { return charBase === '円堂' ? [6] : [5, 6]; }
  };

})(window);
