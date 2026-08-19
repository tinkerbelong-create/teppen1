/* テッペンとリーヨ！ ── 設定を1か所に集めた場所
 *
 * 画像の置き場所・画面の基準サイズ・数値の初期値は、すべてここにあります。
 * あとでアプリにするときは、このファイルだけ書き換えれば済むようにしてあります。
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN = global.TEPPEN || {};

  NS.CONFIG = {

    /* 画像の置き場所。
     * いまは index.html と同じ場所を見ています。
     * アプリにして画像を別の場所に置くときは、ここだけ変えてください。
     * 例: 'https://example.com/teppen/' */
    assetBase: '',

    /* 画面の基準サイズ。この比率で組み、実際のウィンドウに合わせて全体を拡大縮小します。
     * こうしておくと、どんなウィンドウサイズでも、はみ出しも見切れも起きません。 */
    stage: { w: 1440, h: 810, rem: 16 },

    /* 顔タイルの既定値。
     *   zoom … 画像を何%に拡大して切り取るか（大きいほど顔が大きく写る）
     *   x, y … どこを中心に切り取るか（%）
     * 25枚を実際に見たところ、256x256 の画像は頭の中心が画像の 35〜43% にあり、
     * zoom 125 / y 0 でちょうどタイルの中央に顔が来ます。
     * 画像を差し替えて顔がずれたら、data.js の face の数値だけ直してください。 */
    face: { zoom: 125, x: 50, y: 0 },

    /* 数値の初期値（画面の設定からいつでも変えられます）
     * この組み合わせは、CPU一括対戦で 2人/3人/4人 それぞれ200試合ずつ回して決めました。
     * 3人戦で決着94%、1試合48手、連携技が全シュートの51%。 */
    defaults: {
      playerCount: 3,
      humanPlays: true,
      captain: 1,
      handSize: 14,
      winScore: 3,
      techCopies: 2,      /* 必殺カードは1種類あたり2枚 */
      charCopies: 3,      /* キャラカードは1種類あたり3枚 */
      roster: 'v2',       /* 収録キャラ。'v2'=18人 / 'v2b'=21人 / 'full'=24人 */
      speed: 0.55
    },

    /* イナズマコイン（カードではなくトークン）
     *   start        … ゲーム開始時に配る個数
     *   onReact      … キャッチ／ドリブルに成功したときにもらえる個数
     *   onReactStreak… 連続で成功するたび、もらえる個数がこれだけ増える
     *   onConcede    … 失点した人がもらえる個数
     *   onPlay       … 手番A（場に出して1枚引く）でもらえる個数
     *   reactDraw    … リアクション成功で引ける枚数
     *   cap          … 手持ちの上限 */
    coin: {
      start: 5,
      onReact: 2,
      onReactStreak: 1,
      onConcede: 1,
      onPlay: 0,
      reactDraw: 1,
      cap: 12
    },

    /* 効果音
     *   on     … 最初から音を出すか（画面の設定でいつでも切り替えられます）
     *   volume … 音量（0〜1）
     *   files  … 本物の音源に差し替えたいときだけ書きます
     *
     * いまは音のファイルを使わず、その場で音を作って鳴らしています。
     * 差し替えたい音があれば、下の files に「音の名前: ファイルの場所」を書き足してください。
     * 書いた音だけが差し替わり、書いていない音は今までどおりです。例：
     *
     *   files: {
     *     goal: '音/goal.mp3',
     *     stop: '音/stop.mp3'
     *   }
     *
     * 使える名前：tap（さわる）／press（決定）／card（場に出す）／draw（引く）／
     * turn（手番）／ball（ボール移動）／dice（サイコロ）／diceOk（成功）／diceNg（失敗）／
     * cutin（必殺技）／goal（ゴール）／stop（キャッチ成功）／breakthrough（ドリブル成功）／
     * fail（失敗）／coin（コイン獲得）／spend（コイン支払い）／steal（うばう）／
     * takeover（手番を奪う）／win（勝ち）／lose（負け）
     *
     * 手順とおすすめの素材サイトは 資料/音の差し替え方.md にまとめてあります。 */
    sound: {
      on: true,
      volume: 0.6,
      files: {}
    },

    /* 遊ぶ人向けルールブックの場所 */
    rulesUrl: 'あそびかた.html'
  };

  /* 画像1枚ぶんのURLを作る。日本語ファイル名をそのまま扱えるようにここで変換する。 */
  NS.asset = function (path) {
    if (!path) return '';
    if (/^(https?:)?\/\//.test(path) || path.indexOf('data:') === 0) return path;
    return NS.CONFIG.assetBase + encodeURI(path);
  };

  /* 顔の切り取り設定を取り出す（カードごとの指定がなければ既定値） */
  NS.faceOf = function (card) {
    var d = NS.CONFIG.face;
    var f = card && card.face;
    return {
      zoom: (f && f.zoom != null) ? f.zoom : d.zoom,
      x: (f && f.x != null) ? f.x : d.x,
      y: (f && f.y != null) ? f.y : d.y
    };
  };

})(window);
