/* テッペンとリーヨ！ ── 通信対戦の接続先
 *
 * Firebase Realtime Database のURLをここに書いておくと、
 * 毎回アプリに貼り付けなくて済みます（書かなくても動きます）。
 *
 * 例：
 *   TEPPEN.NET_DEFAULT_DB = 'https://teppen-abcd-default-rtdb.firebaseio.com';
 *
 * ここが空でも、アプリの「通信対戦」画面で1回貼れば端末が覚えます。
 * 参加する人は、ホストから届いたリンクを開くだけなので設定は要りません。
 */
(function (global) {
  'use strict';
  var NS = global.TEPPEN = global.TEPPEN || {};
  NS.NET_DEFAULT_DB = '';
})(window);
