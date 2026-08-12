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

    /* 数値の初期値（画面の設定からいつでも変えられます） */
    defaults: {
      playerCount: 3,
      humanPlays: true,
      captain: 1,
      handSize: 12,
      winScore: 3,
      coins: 24,
      techCopies: 3,
      charCopies: 3,
      speed: 0.55
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
