/* テッペンとリーヨ！ ── 通信対戦
 *
 * しくみ：「1台が審判」方式。
 *   部屋を作った人（ホスト）の端末だけがルール処理を動かします。
 *   ほかの端末は「自分が見てよい情報」を受け取って表示し、押したボタンを送り返すだけ。
 *   ホストは各プレイヤーに その人ぶんの情報しか送らないので、
 *   他人の伏せ札はそもそも相手の端末に届きません。
 *
 * 中継には Firebase Realtime Database を使います。
 *   - Googleのサーバーを経由するので、携帯回線同士でもつながります
 *   - 必要な設定は「データベースのURL」1つだけ
 *   - ビルドツールは不要（scriptタグで読める版を使います）
 */
(function (global) {
  'use strict';

  var NS = global.TEPPEN = global.TEPPEN || {};

  var SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  var LS_DB = 'teppen.dbUrl';
  var LS_ME = 'teppen.me';

  var db = null, app = null, loaded = false;
  var room = null;          /* 部屋コード */
  var mySeat = -1;
  var iAmHost = false;
  var myUid = null;
  var listeners = [];
  var heartbeat = null;

  /* ---------------- 下ごしらえ ---------------- */

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('読み込み失敗: ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function loadSdk() {
    if (loaded) return;
    if (!global.firebase) {
      await loadScript(SDK + 'firebase-app-compat.js');
      await loadScript(SDK + 'firebase-database-compat.js');
    }
    loaded = true;
  }

  function uid() {
    var m = localStorage.getItem(LS_ME);
    if (!m) { m = 'u' + Math.random().toString(36).slice(2, 10); localStorage.setItem(LS_ME, m); }
    return m;
  }

  function normalizeDbUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '');
  }

  function getDbUrl() {
    return localStorage.getItem(LS_DB) || NS.NET_DEFAULT_DB || '';
  }
  function setDbUrl(u) {
    u = normalizeDbUrl(u);
    if (u) localStorage.setItem(LS_DB, u);
    return u;
  }

  /* まぎらわしい文字（0/O、1/I）を避けた4文字の合言葉 */
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function makeCode() {
    var s = '';
    for (var i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  async function connect(urlMaybe) {
    var url = normalizeDbUrl(urlMaybe || getDbUrl());
    if (!url) throw new Error('データベースのURLが設定されていません');
    await loadSdk();
    if (app && app.options.databaseURL === url) return db;
    if (app) { try { await app.delete(); } catch (e) { } app = null; }
    app = global.firebase.initializeApp({ databaseURL: url }, 'teppen-' + Date.now());
    db = global.firebase.database(app);
    myUid = uid();
    return db;
  }

  function ref(path) { return db.ref('teppen/' + path); }
  function roomRef(path) { return ref(room + (path ? '/' + path : '')); }

  function track(r, ev, fn) { r.on(ev, fn); listeners.push([r, ev, fn]); return fn; }
  function untrackAll() {
    listeners.forEach(function (l) { try { l[0].off(l[1], l[2]); } catch (e) { } });
    listeners = [];
  }

  /* 通信が生きているか（切れたら画面に出す） */
  var onlineCb = null;
  function watchOnline() {
    var r = db.ref('.info/connected');
    track(r, 'value', function (s) { if (onlineCb) onlineCb(!!s.val()); });
  }

  /* ---------------- 部屋を作る／入る ---------------- */

  async function createRoom(name, opts) {
    var code, tries = 0;
    do {
      code = makeCode();
      var snap = await ref(code + '/meta').once('value');
      if (!snap.exists()) break;
    } while (++tries < 12);

    room = code; mySeat = 0; iAmHost = true;
    await roomRef().set({
      meta: {
        host: myUid, createdAt: Date.now(), phase: 'lobby',
        opts: opts || null
      },
      seats: { 0: { name: name || 'ホスト', uid: myUid, connected: true, at: Date.now() } }
    });
    presence();
    watchOnline();
    return code;
  }

  async function joinRoom(code, name) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error('合言葉は4文字です');
    var snap = await ref(code + '/meta').once('value');
    if (!snap.exists()) throw new Error('その合言葉の部屋が見つかりません');

    room = code; iAmHost = false;

    /* すでに自分の席があれば、そこに戻る（入り直し） */
    var seats = (await roomRef('seats').once('value')).val() || {};
    var found = -1;
    Object.keys(seats).forEach(function (k) { if (seats[k] && seats[k].uid === myUid) found = +k; });

    if (found < 0) {
      for (var s = 1; s < 4; s++) { if (!seats[s]) { found = s; break; } }
      if (found < 0) throw new Error('この部屋は満席です（4人まで）');
    }
    mySeat = found;
    await roomRef('seats/' + mySeat).update({
      name: name || ('プレイヤー' + (mySeat + 1)), uid: myUid, connected: true, at: Date.now()
    });
    presence();
    watchOnline();
    return mySeat;
  }

  /* いま接続しているか印をつける。閉じたら自動で false になる */
  function presence() {
    var r = roomRef('seats/' + mySeat);
    r.onDisconnect().update({ connected: false });
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(function () {
      if (db && room) r.update({ connected: true, at: Date.now() });
    }, 15000);
  }

  function onSeats(cb) { track(roomRef('seats'), 'value', function (s) { cb(s.val() || {}); }); }
  function onMeta(cb) { track(roomRef('meta'), 'value', function (s) { cb(s.val() || {}); }); }

  async function setPhase(phase, extra) {
    var u = { phase: phase };
    if (extra) for (var k in extra) u[k] = extra[k];
    await roomRef('meta').update(u);
  }

  /* ---------------- ホスト：画面を配る ---------------- */

  /* 席ごとに別の場所へ書く。自分の席のぶんだけを見る作りにしてあるので、
   * 他人の伏せ札は端末に届かない。 */
  function pushViews(n, packedEv, viewsBySeat) {
    var u = {};
    Object.keys(viewsBySeat).forEach(function (seat) {
      u['v/' + seat] = { n: n, ev: packedEv || null, state: viewsBySeat[seat], t: Date.now() };
    });
    return roomRef().update(u);
  }

  function pushPrompt(seat, rid, prompt) {
    return roomRef('v/' + seat + '/prompt').set(prompt ? { rid: rid, req: prompt } : null);
  }

  function clearPrompt(seat) { return roomRef('v/' + seat + '/prompt').remove(); }

  /* ゲストの返事を待つ。返ってこないときは null を返して、CPUに任せる */
  function waitAction(seat, rid, timeoutMs) {
    return new Promise(function (resolve) {
      var r = roomRef('act/' + seat);
      var done = false;
      function fin(v) {
        if (done) return; done = true;
        try { r.off('value', h); } catch (e) { }
        clearTimeout(timer);
        resolve(v);
      }
      var h = r.on('value', function (s) {
        var v = s.val();
        if (v && v.rid === rid) { r.remove(); fin(v.choice === undefined ? null : v.choice); }
      });
      var timer = setTimeout(function () { fin(null); }, timeoutMs || 120000);
    });
  }

  /* ---------------- ゲスト：画面を受け取る／返事を送る ---------------- */

  function onMyView(cb) {
    track(roomRef('v/' + mySeat), 'value', function (s) { if (s.val()) cb(s.val()); });
  }

  function sendAction(rid, choice) {
    return roomRef('act/' + mySeat).set({ rid: rid, choice: choice === undefined ? null : choice, t: Date.now() });
  }

  /* ---------------- ホストが戻ってきたとき用の保存 ---------------- */

  function saveSnapshot(data) { return roomRef('snap').set({ t: Date.now(), data: data }); }
  async function loadSnapshot() {
    var s = await roomRef('snap').once('value');
    return s.val() ? s.val().data : null;
  }

  async function amIHostOf(code) {
    var s = await ref(code + '/meta').once('value');
    var m = s.val();
    return !!(m && m.host === uid());
  }

  /* ---------------- 後片付け ---------------- */
  function leave() {
    untrackAll();
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (db && room && mySeat >= 0) {
      try { roomRef('seats/' + mySeat).update({ connected: false }); } catch (e) { }
    }
    room = null; mySeat = -1; iAmHost = false;
  }

  /* 共有リンク（データベースのURLも一緒に渡すので、参加者は設定不要） */
  function shareLink(code) {
    var base = location.origin + location.pathname;
    return base + '?room=' + encodeURIComponent(code) + '&db=' + encodeURIComponent(getDbUrl());
  }

  function urlParams() {
    var p = new URLSearchParams(location.search);
    return { room: (p.get('room') || '').toUpperCase(), db: p.get('db') || '' };
  }

  NS.Net = {
    loadSdk: loadSdk, connect: connect,
    getDbUrl: getDbUrl, setDbUrl: setDbUrl, normalizeDbUrl: normalizeDbUrl,
    createRoom: createRoom, joinRoom: joinRoom, amIHostOf: amIHostOf,
    onSeats: onSeats, onMeta: onMeta, setPhase: setPhase,
    pushViews: pushViews, pushPrompt: pushPrompt, clearPrompt: clearPrompt,
    waitAction: waitAction, onMyView: onMyView, sendAction: sendAction,
    saveSnapshot: saveSnapshot, loadSnapshot: loadSnapshot,
    leave: leave, shareLink: shareLink, urlParams: urlParams,
    seat: function () { return mySeat; },
    code: function () { return room; },
    isHost: function () { return iAmHost; },
    active: function () { return !!room; },
    onOnline: function (cb) { onlineCb = cb; }
  };

})(window);
