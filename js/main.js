/* ═══════════════════════════════════════════════
   main.js — 全部つなぐ
   板（scene） ← 手（board） → 相手（net） → 手元の保存（store）
   ═══════════════════════════════════════════════ */

import {createScene, uid} from './scene.js'
import {createBoard} from './board.js'
import {createNet, newRoomCode, cleanRoomCode, colorFor, selfId} from './net.js'
import {THEMES, exportPage} from './render.js'
import {measureText, TEXT_FONT, LINE_H} from './geom.js'
import * as store from './store.js'
import {$, $$, el, icon, buildTools, markTool, buildOpts, toast, openSheet, mathSheet, graphSheet, INK} from './ui.js'
import {openScan} from './cam.js'

const canvas = $('#board')
let room = ''
let me = {name: '', col: colorFor(selfId), tablet: false}
let wake = null
let net = null
let board = null
let scene = null
let saver = null
let curPage = 0
let followAnim = 0

/* ── 外へ出す操作をまとめる ─────────────────
   線を動かしている間は一フレームごとに操作が出る。そのまま流すと詰まるので、
   同じ要素は後の形だけ残して、45ミリ秒ごとにまとめて送る。 */
let outbox = null
let outTimer = 0

function emit(op){
  if (!outbox) outbox = {puts: new Map(), dels: new Set(), pages: null, t: 0}
  for (const e of op.puts || []){ outbox.puts.set(e.id, e); outbox.dels.delete(e.id) }
  for (const id of op.dels || []){ outbox.dels.add(id); outbox.puts.delete(id) }
  if (op.pages) outbox.pages = op.pages
  outbox.t = Math.max(outbox.t, op.t || 0)
  saver?.nudge()
  if (!outTimer) outTimer = setTimeout(flushOut, 45)
}

function flushOut(){
  outTimer = 0
  const o = outbox
  outbox = null
  if (!o || !net) return
  const puts = [...o.puts.values()]
  const dels = [...o.dels]
  if (!puts.length && !dels.length && !o.pages) return
  net.op({puts, dels, pages: o.pages, t: o.t, by: selfId})
}

/* ── 起動 ─────────────────────────────────── */

function boot(){
  const pref = store.prefs()
  me.name = pref.name || ''
  me.col = pref.col || colorFor(selfId)

  scene = createScene({selfId, onChange: () => { board?.mark(); laterUI() }, onEmit: emit})

  board = createBoard({
    canvas, scene,
    hooks: {
      onState: syncUI,
      onCam: () => { paintZoom(); sendScreenView() },
      onTabletCam: d => {
        const t = board.tablet()
        if (t && net) net.tabletCam(d, t.peer)
      },
      onHover: sendCursor,
      onLiveStroke: sendLive,
      onLiveEnd: id => net?.live({id, done: 1}),
      onLaser: (x, y) => net?.laser({x, y}),
      /* 指二本でちょん＝戻す。ボタンを出さないので、これが取り消しの手 */
      onTwoTap: () => {
        if (!scene.canUndo){ if (board.tablet()) padWake('戻せるものがありません'); return }
        scene.undo()
        board.clearSelection()
        syncUI()
        if (board.tablet()) padWake('ひとつ戻しました')
      },
      onBezel: () => { if (board.tablet()) padWake('') },
      editText, editMath, editGraph, addGraph,
    },
  })

  board.st.theme = pref.theme || 'paper'
  board.st.col = pref.col2 || (THEMES[board.st.theme].dark ? INK.dark[0] : INK.light[0])
  if (pref.markCol) board.st.markCol = pref.markCol
  if (pref.smooth != null) board.st.smooth = pref.smooth
  applyTheme()

  buildTools($('#tools'), t => board.setTool(t))
  wireChrome()
  wireKeys()
  wirePaste()

  window.addEventListener('resize', () => { board.resize(); layoutText(); refitTablet() })
  new ResizeObserver(() => board.resize()).observe(canvas)

  openGate()
}

/* ── 入口の幕 ─────────────────────────────── */

function openGate(){
  const gate = $('#gate')
  const nameIn = $('#gName')
  const codeIn = $('#gCode')
  nameIn.value = me.name
  const hashRoom = cleanRoomCode(location.hash.replace('#', ''))
  if (hashRoom) codeIn.value = hashRoom

  store.listBoards().then(list => {
    const host = $('#gRecent')
    host.innerHTML = ''
    if (!list.length) return
    host.append(el('p', {class: 'g-head', text: 'まえに書いた板'}))
    for (const b of list.slice(0, 5)){
      host.append(el('button', {
        class: 'recent', type: 'button',
        html: `<b>${b.room}</b><span>${b.n} 個 · ${when(b.at)}</span>`,
        onclick: () => start(b.room),
      }))
    }
  })

  $('#gNew').onclick = () => start(newRoomCode())
  $('#gJoin').onclick = () => {
    const c = cleanRoomCode(codeIn.value)
    if (c.length < 7){ codeIn.focus(); codeIn.classList.add('bad'); setTimeout(() => codeIn.classList.remove('bad'), 600); return }
    start(c)
  }
  codeIn.addEventListener('input', () => {
    const p = codeIn.selectionStart === codeIn.value.length
    codeIn.value = cleanRoomCode(codeIn.value)
    if (p) codeIn.setSelectionRange(codeIn.value.length, codeIn.value.length)
  })
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('#gJoin').click() })
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') (codeIn.value ? $('#gJoin') : $('#gNew')).click() })

  gate.classList.add('on')
  setTimeout(() => (nameIn.value ? (codeIn.value ? codeIn : nameIn) : nameIn).focus(), 120)
}

function when(t){
  const d = (Date.now() - t) / 1000
  if (d < 90) return 'さっき'
  if (d < 3600) return Math.round(d / 60) + ' 分前'
  if (d < 86400) return Math.round(d / 3600) + ' 時間前'
  return Math.round(d / 86400) + ' 日前'
}

async function start(code){
  me.name = ($('#gName').value || '').trim().slice(0, 14) || 'だれか'
  store.setPref({name: me.name})
  room = code
  location.hash = code
  $('#gate').classList.remove('on')
  document.body.classList.add('live')
  $('#roomCode').textContent = code

  /* 手元の控えを先に開く。あとで相手の板と混ざる（新しいほうが残る） */
  const snap = await store.load(code)
  if (snap) scene.load(snap)
  board.st.pageId = scene.pages[0].id
  board.st.bg = scene.pages[0].bg || 'grid'
  curPage = 0

  saver = store.autosave(() => room, () => scene.snapshot())

  net = createNet({
    roomCode: code,
    getMe: () => me,
    getSnapshot: () => scene.snapshot(),
    onOp: op => scene.merge(op),
    onSnapshot: s => {
      scene.load(s)
      const pg = scene.pages[curPage] || scene.pages[0]
      board.st.pageId = pg.id
      board.st.bg = pg.bg || 'grid'
      refreshPages()
      board.mark()
      saver.nudge()
    },
    onLive: (d, from) => {
      if (!d) return
      if (d.done){ board.setLive(d.id, null); return }
      if (d.el && d.el.p === board.st.pageId) board.setLive(d.id, {...d.el, by: from})
    },
    onPeers: list => {
      board.peers = list.filter(p => p.page === board.st.pageId || p.page == null)
      paintPeers(list)
      /* 書いていた画面がいなくなったら、ペンタブを畳む */
      const t = board.tablet()
      if (t && !list.some(p => p.id === t.peer)){
        exitTablet()
        toast('つないでいた画面がいなくなりました')
      }
      syncUI()
    },
    onTabletHello: peerId => {
      sendScreenView(peerId)
      syncUI()
      if (!padSeen.has(peerId)){
        padSeen.add(peerId)
        toast('スマホがペンタブになりました。道具と色はこちらで決めます', 3600)
      }
    },
    onScreenView: (d, from) => {
      const t = board.tablet()
      if (t && from === t.peer && d && d.s){
        if (d.s.theme && d.s.theme !== board.st.theme){
          board.st.theme = d.s.theme
          applyTheme()
        }
        if (board.applyTools(d.s)) syncUI()
      }
      board.applyScreenView(d, from)
    },
    onTabletCam: (d, from) => {
      /* ペンタブからの「ここを映して」。ペンタブ同士では受けない */
      if (me.tablet || !d || !net) return
      if (!net.peers.some(p => p.id === from && p.tab)) return
      const c = board.cam
      c.x = d.x; c.y = d.y
      c.k = Math.max(0.08, Math.min(24, d.k || 1))
      board.mark()
      paintZoom()
      sendScreenView()
    },
    /* 「問題を写して」。ペンタブ側は受けて開き、開いたことを返す。
       画面側は、その返事ではじめて「スマホに出た」と分かる */
    onScanAsk: (d, from) => {
      if (d && d.ok){ scanAcked(); return }
      const t = board.tablet()
      if (!t || from !== t.peer) return
      startScan('camera', null, {
        needTap: true,                            /* 触っていない画面からカメラは呼べない */
        onOpen: () => net?.askScan(from, {ok: 1}),
      })
      padWake('問題を写します')
    },
    onView: (d, from) => {
      if (!d) return
      const who = net.peers.find(p => p.id === from)
      flyTo(d)
      toast((who?.name || 'だれか') + ' が画面を合わせました')
    },
    onLaser: d => { if (d) board.addLaser(d.x, d.y) },
    onStatus: s => paintStatus(s),
  })
  /* つながらなくても板は使える。一人で書けるほうが先 */
  try { net.join() } catch (e){ console.warn('[板書] つなげませんでした', e) }

  syncUI()
  refreshPages()
  paintZoom()
  board.resize()
  board.mark()
  if (!snap) toast('合図は ' + code + '。これを友だちに伝えると同じ板に入れます', 4200)
}

/* ── 送る ─────────────────────────────────── */

let curT = 0
function sendCursor(w){
  const now = performance.now()
  if (now - curT < 55) return
  curT = now
  net?.cursor({x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10, p: board.st.pageId})
}

function sendLive(e){
  /* 長い線はそのまま送ると重い。途中を間引いて送る（確定版はあとで別に届く） */
  let pts = e.pts
  if (pts.length > 600){
    const step = Math.ceil(pts.length / 3 / 200) * 3
    const o = []
    for (let i = 0; i < pts.length; i += step) o.push(pts[i], pts[i + 1], pts[i + 2])
    const n = pts.length
    o.push(pts[n - 3], pts[n - 2], pts[n - 1])
    pts = o
  }
  net?.live({id: e.id, el: {...e, pts: pts.map(v => Math.round(v * 100) / 100)}})
}

/* ── ペンタブモード ───────────────────────── */

/* 画面側。いまどこが映っているかをペンタブへ渡す。
   相手はこれに自分の見え方を合わせるので、モニターを見ながら書ける。 */
let tvAt = 0
let tvTimer = 0
let tvSig = ''        /* 前に送った見え方。同じなら送らない */
let tvSent = 0
function sendScreenView(target){
  if (!net || me.tablet) return
  if (!target && !net.peers.some(p => p.tab)) return
  /* 見え方といっしょに、筆の持ち方も渡す。ペンタブ側は何も決めない */
  const view = () => ({
    x: board.cam.x, y: board.cam.y, k: board.cam.k,
    w: board.R.W, h: board.R.H,
    p: board.st.pageId, bg: board.st.bg,
    s: board.toolState(),
  })
  /* 窓を畳んだりタブを裏に回すと、画面の大きさが 0 で取れることがある。
     そのまま渡すとペンタブ側の面が消えるので、送らずに前の姿のままにしておく */
  if (board.R.W < 2 || board.R.H < 2) return
  if (target){ net.screenView(view(), target); return }
  /* 何も変わっていないなら送らない。
     相手が書いている間、こちらは受け取るたびに syncUI を通るので、
     そのつど送ると一秒に十回も届く。ペンタブ側はそのたびに画面を合わせ直し、
     書いている最中の板が揺れる（実際に揺れた）。
     落ちてもいい知らせなので、変わらなくても二秒に一度だけは流しておく */
  const v = view()
  const sig = JSON.stringify(v)
  const t = performance.now()
  if (sig === tvSig && t - tvSent < 2000) return
  /* 間引くが、捨てはしない。最後の見え方は必ず遅れて届ける */
  clearTimeout(tvTimer)
  const wait = 100 - (t - tvAt)
  if (wait > 0){ tvTimer = setTimeout(() => sendScreenView(), wait); return }
  tvAt = t
  tvSig = sig
  tvSent = t
  net.screenView(v)
}

/* 画面に乗っている道具箱などを避けて、書ける面を取る。
   どの辺に寄っているかは、いちばん近い縁で決める */
function tabletInsets(){
  /* ペンタブのときは部品を全部しまうので、ふつうは画面いっぱいになる。
     それでも何か出ているときのために、どの辺に寄っているかで押し込む */
  const r = {t: 4, r: 4, b: 4, l: 4}
  const W = window.innerWidth, H = window.innerHeight
  for (const sel of ['#top', '#tools', '#opts', '#bottom', '#history']){
    const n = $(sel)
    if (!n || !n.offsetParent) continue
    const b = n.getBoundingClientRect()
    if (b.width < 2 || b.height < 2) continue
    const d = {t: b.bottom, l: b.right, r: W - b.left, b: H - b.top}
    let side = 't'
    for (const k of ['l', 'r', 'b']) if (d[k] < d[side]) side = k
    r[side] = Math.max(r[side], d[side] + 10)
  }
  return r
}

function refitTablet(){
  if (board.tablet()) board.setTabletPad(tabletInsets())
}

let myTools = null              /* ペンタブに入る前の、この端末の筆 */
const padSeen = new Set()       /* ペンタブになったことを知らせた相手 */

function startTablet(p){
  me.tablet = true
  myTools = board.toolState()
  net?.hello()
  board.setTablet(p.id, p.name)
  document.body.classList.add('tabletmode')
  goFull()
  keepAwake()
  syncUI()
  requestAnimationFrame(refitTablet)
  padWake(p.name + ' の画面に書いています　・　指二本でちょんと触ると戻す')
  /* 縦のままだと書ける面が細い帯になる。横にすれば画面いっぱい使える */
  if (window.innerHeight > window.innerWidth){
    setTimeout(() => { if (board.tablet()) padWake('横向きに持つと、書ける面が広くなります') }, 4200)
  }
}

function exitTablet(){
  if (!board.tablet()) return
  me.tablet = false
  board.exitTablet()
  document.body.classList.remove('tabletmode', 'padwake')
  clearTimeout(padTimer)
  dropFull()
  dropAwake()
  net?.hello()
  /* 借りていた筆を返して、自分の持ち物に戻す */
  if (myTools){ board.applyTools(myTools); if (myTools.theme) { board.st.theme = myTools.theme; applyTheme() } }
  myTools = null
  board.home()
  syncUI()
}

/* 書く面だけにしたいので、出られる全画面にする。
   iOS の Safari は要素の全画面を断るので、そのときは普通の画面のまま進む */
function goFull(){
  const el2 = document.documentElement
  try { (el2.requestFullscreen || el2.webkitRequestFullscreen)?.call(el2, {navigationUI: 'hide'}) } catch {}
}
function dropFull(){
  try { if (document.fullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document) } catch {}
}

/* 操作するものを出さない代わりに、触れたときだけ出口と覚え書きを見せる */
let padTimer = 0
function padWake(msg){
  const h = $('#padHint')
  if (msg) h.textContent = msg
  document.body.classList.add('padwake')
  board.showFrameLabel(true)
  clearTimeout(padTimer)
  padTimer = setTimeout(() => {
    document.body.classList.remove('padwake')
    board.showFrameLabel(false)
  }, msg ? 4000 : 2600)
}

function toggleTablet(){
  if (board.tablet()){ exitTablet(); return }
  const screens = (net?.peers || []).filter(p => !p.tab)
  if (!screens.length){
    openSheet({
      title: 'スマホをペンタブにする',
      body: [
        el('p', {class: 'share-lead', text: 'この端末を、板に書くためのペンタブにします。手元の板は見ずに、パソコンの画面を見ながら書けます。'}),
        el('p', {class: 'note', text: 'まだ相手の画面が見つかりません。先にパソコンで同じ合図の板を開いてください。'}),
        el('div', {class: 'code-big', text: room}),
      ],
    })
    return
  }
  if (screens.length === 1){ startTablet(screens[0]); return }
  const rows = el('div', {class: 'recents'})
  for (const p of screens){
    rows.append(el('button', {
      class: 'recent', type: 'button',
      html: `<b>${escapeHtml(p.name)}</b><span>この画面に書く</span>`,
      onclick: () => { sheet.close(); startTablet(p) },
    }))
  }
  const sheet = openSheet({
    title: 'どの画面に書きますか',
    body: [el('p', {class: 'note', text: '選んだ画面に映っているところが、この端末の書ける面になります。'}), rows],
  })
}

function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
}

/* 書いている間に画面が消えないようにする */
async function keepAwake(){
  try { wake = await navigator.wakeLock?.request('screen') } catch { wake = null }
}
function dropAwake(){
  try { wake?.release() } catch {}
  wake = null
}

/* ── 画面の見た目 ─────────────────────────── */

function applyTheme(){
  const t = board.st.theme
  document.documentElement.dataset.theme = t
  document.documentElement.dataset.dark = THEMES[t].dark ? '1' : '0'
  board.mark()
}

let uiSig = ''

/* スマホをペンタブにしてつないでいる人がいるか */
const padOn = () => !!net?.peers.some(p => p.tab)

/* 道具の設定欄は、関わる値が変わったときだけ組み直す。
   一筆ごとに作り直すと、押しかけのボタンが消えて取りこぼす */
function syncUI(){
  markTool($('#tools'), board.st.tool)
  const s = board.st
  const sig = [s.tool, s.col, s.sz, s.markCol, s.markSz, s.smooth, s.textSize, s.mathSize,
    s.eraseR, s.erasePart, s.arrow, s.fill, s.dash, s.snap, s.theme,
    !!board.tablet(), padOn(), board.selection.length].join('|')
  if (sig !== uiSig){
    uiSig = sig
    buildOptsNow()
  }
  $('#undo').disabled = !scene.canUndo
  $('#redo').disabled = !scene.canRedo
  if (board.tablet()) requestAnimationFrame(refitTablet)
  /* 筆を持ち替えたら、ペンタブにも同じものを持たせる */
  else sendScreenView()
}

function buildOptsNow(){
  buildOpts($('#opts'), board.st, {
    set: patch => {
      Object.assign(board.st, patch)
      if (patch.col) store.setPref({col2: patch.col})
      if (patch.markCol) store.setPref({markCol: patch.markCol})
      if (patch.smooth != null) store.setPref({smooth: patch.smooth})
      syncUI()
      board.applyCursor()
      board.mark()
    },
    selCount: () => board.selection.length,
    recolor: c => {
      const list = board.selection
      if (!list.length) return
      scene.put(list.map(e => ({...e, col: c})))
      board.mark()
    },
    duplicate: () => board.duplicate(),
    del: () => board.deleteSelection(),
    pad: padOn(),
  })
}

/* 板が変わるたびに DOM を触ると、書いている最中に引っかかる。一拍おいてまとめる */
let uiLater = false
function laterUI(){
  if (uiLater || !board) return
  uiLater = true
  requestAnimationFrame(() => {
    uiLater = false
    if (!board) return
    refreshPages()
    $('#undo').disabled = !scene.canUndo
    $('#redo').disabled = !scene.canRedo
  })
}

function paintZoom(){
  $('#zoomVal').textContent = Math.round(board.cam.k * 100) + '%'
}

function paintStatus(s){
  const dot = $('#netDot')
  dot.dataset.state = s.state
  $('#netLabel').textContent =
    s.state === 'live' ? `${s.peers} 人といっしょ` :
    s.state === 'seeking' ? '相手を待っています' : 'つながっていません'
}

function paintPeers(list){
  const host = $('#peers')
  host.innerHTML = ''
  host.append(el('span', {
    class: 'me' + (me.tablet ? ' pad' : ''), style: `--c:${me.col}`,
    title: me.name + (me.tablet ? '（あなた・ペンタブ）' : '（あなた）'),
    text: me.tablet ? '✎' : initial(me.name),
  }))
  for (const p of list){
    host.append(el('span', {
      class: 'who' + (p.tab ? ' pad' : ''), style: `--c:${p.col}`,
      title: p.name + (p.tab ? '（ペンタブ）' : '') + (p.page && p.page !== board.st.pageId ? '（別のページ）' : ''),
      text: p.tab ? '✎' : initial(p.name),
    }))
  }
  /* ペンタブは人数に数えない。同じ人の二台目なので */
  const people = list.filter(p => !p.tab).length + (me.tablet ? 0 : 1)
  $('#peerCount').textContent = String(Math.max(people, 1))
}

function initial(n){
  return (n || '?').trim().slice(0, 1).toUpperCase()
}

/* ── ページ ───────────────────────────────── */

function refreshPages(){
  const pages = scene.pages
  if (curPage >= pages.length) curPage = pages.length - 1
  const pg = pages[curPage]
  if (pg && board.st.pageId !== pg.id){
    board.st.pageId = pg.id
    board.st.bg = pg.bg || 'grid'
  }
  $('#pageNow').textContent = (curPage + 1) + ' / ' + pages.length
  $('#pagePrev').disabled = curPage === 0
  $('#pageNext').disabled = curPage >= pages.length - 1
  $('#pageDel').disabled = pages.length < 2
  for (const b of $$('#bgRow .opt')) b.classList.toggle('on', b.dataset.bg === board.st.bg)
}

function gotoPage(i){
  const pages = scene.pages
  curPage = Math.max(0, Math.min(pages.length - 1, i))
  board.st.pageId = pages[curPage].id
  board.st.bg = pages[curPage].bg || 'grid'
  board.clearSelection()
  board.home()
  refreshPages()
  board.mark()
  sendScreenView()
}

/* 並び順は数で持つ。前後のあいだを取れば、同時に足されても喧嘩しない */
function addPage(){
  const pages = scene.pages
  const a = pages[curPage]?.o ?? 0
  const b = pages[curPage + 1]?.o
  const o = b == null ? a + 1 : (a + b) / 2
  scene.putPages([{id: uid('p'), bg: board.st.bg, o}])
  gotoPage(curPage + 1)
  toast('ページを足しました')
}

function delPage(){
  const pages = scene.pages
  if (pages.length < 2) return
  const victim = pages[curPage]
  const ids = scene.onPage(victim.id).map(e => e.id)
  scene.act({dels: ids, pages: [{...victim, x: 1}]})
  gotoPage(Math.max(0, curPage - 1))
  toast('ページを消しました')
}

function setBG(bg){
  const pg = scene.pages[curPage]
  if (!pg) return
  scene.putPages([{...pg, bg}])
  board.st.bg = bg
  refreshPages()
  board.mark()
  sendScreenView()
}

/* ── 窓まわり ─────────────────────────────── */

function wireChrome(){
  $('#undo').onclick = () => { scene.undo(); board.clearSelection(); syncUI() }
  $('#redo').onclick = () => { scene.redo(); syncUI() }

  $('#zoomIn').onclick = () => board.zoom(1.25)
  $('#zoomOut').onclick = () => board.zoom(1 / 1.25)
  $('#zoomVal').onclick = () => board.zoom(1 / board.cam.k)
  $('#zoomFit').onclick = () => board.fit()
  $('#zoomHome').onclick = () => board.home()

  $('#pagePrev').onclick = () => gotoPage(curPage - 1)
  $('#pageNext').onclick = () => gotoPage(curPage + 1)
  $('#pageAdd').onclick = addPage
  $('#pageDel').onclick = () => {
    if (confirm('このページを消します。戻せません。')) delPage()
  }

  for (const b of $$('#bgRow .opt')) b.onclick = () => setBG(b.dataset.bg)

  $('#themeBtn').onclick = () => {
    const order = ['paper', 'board', 'slate']
    const next = order[(order.indexOf(board.st.theme) + 1) % order.length]
    const wasDefault = board.st.col === (THEMES[board.st.theme].dark ? INK.dark[0] : INK.light[0])
    board.st.theme = next
    if (wasDefault) board.st.col = THEMES[next].dark ? INK.dark[0] : INK.light[0]
    store.setPref({theme: next, col2: board.st.col})
    applyTheme()
    syncUI()
  }

  $('#syncBtn').onclick = () => {
    if (!net || !net.count){ toast('まだ誰も入っていません'); return }
    net.view({x: board.cam.x, y: board.cam.y, k: board.cam.k, p: board.st.pageId})
    toast('みんなの画面をここに合わせました')
  }

  $('#shareBtn').onclick = openShare
  $('#tabletBtn').onclick = toggleTablet
  $('#padExit').onclick = exitTablet
  /* 写すときだけ、スマホにもうひとつボタンを出す。
     押した指が「触った」証しになるので、ここからならカメラが開く */
  $('#padScan').onclick = () => { padWake(''); startScan('camera') }

  /* 全画面から抜けたら（戻るしぐさ・Esc）ペンタブも畳む。
     ただし写している間は別。カメラを許すか聞かれると全画面が外れる端末がある */
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']){
    document.addEventListener(ev, () => {
      if (scanning) return
      if (board.tablet() && !document.fullscreenElement && !document.webkitFullscreenElement) exitTablet()
    })
  }

  $('#saveBtn').onclick = () => {
    const cv = exportPage(scene, board.st.pageId, board.st.theme, board.st.bg, 2)
    cv.toBlob(b => {
      const a = el('a', {href: URL.createObjectURL(b), download: `板書-${room}-p${curPage + 1}.png`})
      document.body.append(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
    }, 'image/png')
    toast('画像にしました')
  }

  $('#clearBtn').onclick = () => {
    if (!scene.onPage(board.st.pageId).length) return
    if (confirm('このページの書いたものを全部消します。（戻すボタンで戻せます）')){
      scene.clearPage(board.st.pageId)
      board.clearSelection()
      syncUI()
    }
  }

  $('#scanBtn').onclick = openScanMenu

  $('#imgBtn').onclick = () => $('#fileIn').click()
  $('#fileIn').onchange = e => {
    for (const f of e.target.files) addImageFile(f)
    e.target.value = ''
  }

  $('#helpBtn').onclick = openHelp
}

function openShare(){
  const url = location.origin + location.pathname + '#' + room
  const body = [
    el('p', {class: 'share-lead', text: 'この合図を友だちに伝えると、同じ板に入れます。'}),
    el('div', {class: 'code-big', text: room}),
    el('div', {class: 'share-row'}, [
      el('input', {class: 'g-in', value: url, readonly: 'readonly', onclick: e => e.target.select()}),
      el('button', {class: 'btn tiny', type: 'button', text: 'リンクを写す', onclick: async e => {
        try { await navigator.clipboard.writeText(url); e.target.textContent = '写しました' }
        catch { toast('うまく写せませんでした。手で選んでください') }
      }}),
    ]),
    el('p', {class: 'note', text: 'サーバーは通りません。板の中身は端末どうしで直接やりとりします。中身が残るのは、それぞれの端末の中だけ。'}),
    el('div', {class: 'sep-h'}),
    el('p', {class: 'share-lead', text: '自分のスマホをペンタブにもできます。'}),
    el('p', {class: 'note', text: 'スマホで同じ合図の板を開き、上の「ペンタブ」ボタンを押すだけ。スマホは全画面の書く面だけになり、この画面がそのまま重なります。色も太さもこちらで決めたものが乗るので、手元は見ずにここを見ながら書けます。'}),
  ]
  openSheet({title: 'いっしょに書く', body})
}

function openHelp(){
  const rows = [
    ['ペン / 蛍光ペン / 消しゴム', 'P / M / E'],
    ['手ぶれ補正を強める / ゆるめる', 'Shift+S / S'],
    ['選ぶ', 'V'],
    ['直線・矢印 / 四角 / 円 / 三角', 'L / R / O / Y'],
    ['文字 / 数式 / グラフ', 'T / F / G'],
    ['指し棒', 'K'],
    ['戻す / やり直す', 'Ctrl+Z / Ctrl+Shift+Z'],
    ['画面を動かす', 'スペースを押しながら引く・指二本・ホイール'],
    ['拡大・縮小', 'Ctrl+ホイール・つまむ・Ctrl +/−'],
    ['全体を見る / 真ん中へ', 'Ctrl+1 / Ctrl+0'],
    ['選んだものを消す', 'Delete'],
    ['全部選ぶ / 複製', 'Ctrl+A / Ctrl+D'],
    ['画像で保存', 'Ctrl+S'],
    ['直線を15度ずつに / 正方形・正円', 'Shift を押しながら'],
    ['画像を貼る', 'Ctrl+V（スクショをそのまま貼れます）'],
    ['問題を写す', 'C'],
  ]
  const table = el('div', {class: 'keys'})
  for (const [a, b] of rows){
    table.append(el('div', {class: 'krow'}, [el('span', {text: a}), el('kbd', {text: b})]))
  }
  openSheet({
    title: '使い方',
    wide: true,
    body: [
      el('p', {class: 'note', text: '数式は TeX の書き方です（\\frac{1}{2} で分数、x^2 で2乗）。ボタンからも入れられます。グラフは y= の右側を書くだけで引けます。'}),
      el('p', {class: 'note', text: 'マウスで書くときは、ペンを選んで出てくる「手ぶれ補正」を中か強に。ペン先が少し遅れて付いてくるぶん、線のがたつきが取れます。'}),
      el('p', {class: 'note', text: 'スマホで同じ合図の板を開いて「ペンタブ」ボタンを押すと、スマホが全画面の書く面だけになります。色も太さも補正もこちら（パソコン）で決めたものがそのまま乗ります。スマホ側は、指二本でちょん＝戻す、つまむ＝画面を動かす、右上の ✕ でやめる。横向きに持つと広く使えます。'}),
      el('p', {class: 'note', text: '手ぶれ補正は、ペンタブにしたスマホには同じ段でもずっと強く効きます（手のひらの面に画面まるごとが映っているので、指の震えも何倍かに伸びるため）。それでも線が震えるなら「強」か「極」へ。'}),
      el('p', {class: 'note', text: '上の「問題を写す」（C）で、教科書やプリントの問題を板に置けます。写した一枚は、影も斜めの歪みも直して、白地に黒字の清書にしてから置きます。ペンタブのスマホがつながっていれば、ボタンはそのスマホのカメラを呼びます。撮ったあと、問題のかたまりを押すか、指でなぞって、使うところだけを選べます。'}),
      table,
    ],
  })
}

/* ── 文字を置く ───────────────────────────── */

let editing = null
const ta = () => $('#textEdit')

function editText(target, at){
  const t = ta()
  const st = board.st
  const e = target || null
  const size = e ? e.sz : st.textSize
  const col = e ? e.col : st.col
  editing = {el: e, at: at || {x: e.x, y: e.y}, size, col}
  t.value = e ? e.s : ''
  t.style.color = col
  t.style.display = 'block'
  layoutText()
  /* focus はひと呼吸おいて当てる。pointerdown と同じ拍で当てると弾かれる */
  setTimeout(() => {
    if (!editing) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  }, 0)
}

function layoutText(){
  if (!editing) return
  const t = ta()
  const p = board.worldToScreen(editing.at.x, editing.at.y)
  const k = board.cam.k
  t.style.left = p.x + 'px'
  t.style.top = p.y + 'px'
  t.style.fontSize = (editing.size * k) + 'px'
  t.style.lineHeight = LINE_H
  t.style.fontFamily = TEXT_FONT
  const m = measureText(t.value || ' ', editing.size)
  t.style.width = Math.max(m.w * k + 24 * k, 140) + 'px'
  t.style.height = Math.max(m.h * k, editing.size * k * LINE_H) + 'px'
}

function commitText(){
  if (!editing) return
  const t = ta()
  const s = t.value.replace(/\s+$/, '')
  const cur = editing
  editing = null
  t.style.display = 'none'
  t.value = ''
  if (cur.el){
    if (s) scene.put({...cur.el, s})
    else scene.remove([cur.el.id])
  } else if (s){
    board.place({type: 'text', x: cur.at.x, y: cur.at.y, s, col: cur.col, sz: cur.size}, {select: false})
  }
  syncUI()
  board.mark()
}

function wireText(){
  const t = ta()
  t.addEventListener('input', layoutText)
  t.addEventListener('blur', commitText)
  t.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ e.stopPropagation(); const c = editing; editing = null; t.style.display = 'none'; if (c?.el) board.mark(); return }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); t.blur() }
    e.stopPropagation()
  })
}

/* ── 数式とグラフ ─────────────────────────── */

function editMath(target, at){
  mathSheet({
    value: target ? target.s : '',
    theme: board.st.theme,
    color: target ? target.col : board.st.col,
    onDone: s => {
      if (target) scene.put({...target, s})
      else board.place({type: 'math', x: at.x, y: at.y, s, col: board.st.col, sz: board.st.mathSize})
      board.mark()
      syncUI()
    },
  })
}

function addGraph(at){
  graphSheet({
    theme: board.st.theme,
    onDone: g => {
      const w = 520, h = 380
      board.place({...g, x: at.x, y: at.y, w, h})
      board.mark()
    },
  })
}

function editGraph(target){
  graphSheet({
    value: target,
    theme: board.st.theme,
    onDone: g => {
      scene.put({...target, ...g, x: target.x, y: target.y, w: target.w, h: target.h})
      board.mark()
    },
  })
}

/* ── 画像 ─────────────────────────────────── */

function wirePaste(){
  window.addEventListener('paste', e => {
    if (editing) return
    const items = [...(e.clipboardData?.items || [])]
    const img = items.find(i => i.type.startsWith('image/'))
    if (img){
      e.preventDefault()
      addImageFile(img.getAsFile())
      return
    }
    const txt = e.clipboardData?.getData('text')
    if (txt && txt.trim()){
      e.preventDefault()
      const c = board.screenToWorld(board.R.W / 2, board.R.H / 2)
      board.place({type: 'text', x: c.x - 150, y: c.y - 20, s: txt.trim().slice(0, 2000), col: board.st.col, sz: board.st.textSize}, {select: true})
    }
  })
  canvas.addEventListener('dragover', e => { e.preventDefault() })
  canvas.addEventListener('drop', e => {
    e.preventDefault()
    for (const f of e.dataTransfer?.files || []) if (f.type.startsWith('image/')) addImageFile(f, e)
  })
}

async function addImageFile(file, ev){
  if (!file) return
  if (file.size > 14 * 1024 * 1024){ toast('画像が大きすぎます（14MBまで）'); return }
  try {
    const url = await shrink(file, 1600)
    const im = await loaded(url)
    const maxW = 560
    const k = Math.min(1, maxW / im.naturalWidth)
    const w = im.naturalWidth * k, h = im.naturalHeight * k
    let at
    if (ev) at = board.screenToWorld(ev.clientX - canvas.getBoundingClientRect().left, ev.clientY - canvas.getBoundingClientRect().top)
    else at = board.screenToWorld(board.R.W / 2, board.R.H / 2)
    board.place({type: 'img', x: at.x - w / 2, y: at.y - h / 2, w, h, src: url})
    board.mark()
    toast('貼りました')
  } catch (e){
    toast('画像を読めませんでした')
  }
}

function loaded(src){
  return new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res(im)
    im.onerror = rej
    im.src = src
  })
}

/* 相手に送るので、長辺を縮めて JPEG にする（透明が要るものは PNG のまま） */
async function shrink(file, max){
  const url = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(file)
  })
  const im = await loaded(url)
  const long = Math.max(im.naturalWidth, im.naturalHeight)
  const png = /png|gif|webp/i.test(file.type)
  if (long <= max && file.size < 900 * 1024) return url
  const k = Math.min(1, max / long)
  const cv = document.createElement('canvas')
  cv.width = Math.round(im.naturalWidth * k)
  cv.height = Math.round(im.naturalHeight * k)
  const c = cv.getContext('2d')
  c.imageSmoothingQuality = 'high'
  if (!png){ c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height) }
  c.drawImage(im, 0, 0, cv.width, cv.height)
  return cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.86)
}

/* ── 問題を写す ───────────────────────────── */

/* 写すのはスマホの仕事。ペンタブが付いていればそちらに頼み、
   いなければこの端末で写すか、撮ってある写真から読み取る */
function openScanMenu(){
  if (board.tablet()){ startScan('camera'); return }
  const pad = (net?.peers || []).find(p => p.tab)
  if (pad){ askPadScan(pad); return }
  const sh = openSheet({
    title: '問題を写す',
    body: [
      el('p', {class: 'share-lead', text: '紙を読み取って、白地に黒字に直してから板に置きます。影も、斜めから撮れた歪みも直します。'}),
      el('div', {class: 'recents'}, [
        el('button', {
          class: 'recent', type: 'button',
          html: '<b>カメラで写す</b><span>この端末のカメラを使います</span>',
          onclick: () => { sh.close(); startScan('camera') },
        }),
        el('button', {
          class: 'recent', type: 'button',
          html: '<b>写真を選ぶ</b><span>撮ってある写真や、教科書を写した画像から</span>',
          onclick: () => { sh.close(); startScan('file') },
        }),
      ]),
      el('p', {class: 'note', text: 'スマホをペンタブにしていると、このボタンはスマホのカメラを呼びます。手元の紙を写して、そのままこの板に置けます。'}),
    ],
  })
}

/* ペンタブのスマホに頼む。返事が来るまでは「出た」と言い切らない。
   こちらからはスマホの画面が見えないので、黙って失敗されるのがいちばん困る */
let scanWait = 0
function askPadScan(pad){
  net.askScan(pad.id)
  toast(pad.name + ' のスマホに出しています…', 2800)
  clearTimeout(scanWait)
  scanWait = setTimeout(() => {
    scanWait = 0
    const sh = openSheet({
      title: 'スマホが応えませんでした',
      body: [
        el('p', {class: 'share-lead', text: 'スマホ側で写す面が開かなかったようです。'}),
        el('p', {class: 'note', text: 'スマホの画面を一度触ってから、もう一度押してみてください。'}),
        el('p', {class: 'note', text: 'スマホの右上にある写すボタン（カメラの絵）からも開けます。ペンタブの画面に触れると出てきます。'}),
        el('p', {class: 'note', text: 'スマホが古い板書を開いたままだと、この合図を受け取れません。スマホで板を開き直してください。'}),
        el('div', {class: 'recents'}, [
          el('button', {
            class: 'recent', type: 'button',
            html: '<b>このパソコンで写真を選ぶ</b><span>スマホで撮った写真を送ってもらった場合など</span>',
            onclick: () => { sh.close(); startScan('file') },
          }),
        ]),
      ],
    })
  }, 4200)
}

function scanAcked(){
  if (!scanWait) return
  clearTimeout(scanWait)
  scanWait = 0
  toast('スマホに出しました。スマホを見てください', 3600)
}

let scanning = null
function startScan(source, file, more){
  if (scanning) return
  scanning = openScan({
    source, file, ...(more || {}),
    onPlace: placeScan,
    onClose: () => {
      scanning = null
      /* カメラを許すか聞かれると、全画面が外れることがある。ペンタブのままなら戻す */
      if (board.tablet()) goFull()
    },
  })
}

/* いま見えているところの真ん中に、読める大きさで置く。
   ペンタブのスマホから置いても、映っているのはパソコンの画面なので同じところに出る */
function placeScan(out){
  if (!out || !out.url) return
  const k = board.cam.k
  const w = Math.max(160, Math.min(1800, board.R.W * 0.62 / k))
  const h = w * out.h / out.w
  const c = board.screenToWorld(board.R.W / 2, board.R.H / 2)
  board.place({type: 'img', x: c.x - w / 2, y: c.y - h / 2, w, h, src: out.url})
  board.mark()
  if (board.tablet()) padWake('問題を置きました')
  else toast('問題を置きました')
}

/* ── 画面を合わせる ───────────────────────── */

function flyTo(d){
  if (d.p && d.p !== board.st.pageId){
    const i = scene.pages.findIndex(p => p.id === d.p)
    if (i >= 0){ curPage = i; board.st.pageId = d.p; board.st.bg = scene.pages[i].bg || 'grid'; refreshPages() }
  }
  cancelAnimationFrame(followAnim)
  const c = board.cam
  const from = {x: c.x, y: c.y, k: c.k}
  const t0 = performance.now()
  const dur = 420
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / dur)
    const e = 1 - Math.pow(1 - p, 3)
    c.x = from.x + (d.x - from.x) * e
    c.y = from.y + (d.y - from.y) * e
    c.k = from.k * Math.pow(d.k / from.k, e)
    board.mark()
    paintZoom()
    if (p < 1) followAnim = requestAnimationFrame(step)
  }
  followAnim = requestAnimationFrame(step)
}

/* ── 鍵盤 ─────────────────────────────────── */

const TOOLKEY = {v: 'select', p: 'pen', m: 'marker', e: 'eraser', l: 'line', r: 'rect', o: 'ell', y: 'tri', t: 'text', f: 'math', g: 'graph', k: 'laser'}

function wireKeys(){
  wireText()
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase()
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return
    const mod = e.ctrlKey || e.metaKey

    if (e.code === 'Space' && !mod){ board.setSpace(true); e.preventDefault(); return }

    if (mod){
      const k = e.key.toLowerCase()
      if (k === 'z'){ e.preventDefault(); e.shiftKey ? scene.redo() : scene.undo(); board.clearSelection(); syncUI(); return }
      if (k === 'y'){ e.preventDefault(); scene.redo(); syncUI(); return }
      if (k === 'a'){ e.preventDefault(); board.setTool('select'); board.select(scene.onPage(board.st.pageId).map(x => x.id)); return }
      if (k === 'd'){ e.preventDefault(); board.duplicate(); return }
      if (k === 's'){ e.preventDefault(); $('#saveBtn').click(); return }
      if (k === '0'){ e.preventDefault(); board.home(); return }
      if (k === '1'){ e.preventDefault(); board.fit(); return }
      if (e.key === '+' || e.key === '='){ e.preventDefault(); board.zoom(1.25); return }
      if (e.key === '-'){ e.preventDefault(); board.zoom(1 / 1.25); return }
      return
    }

    if (e.key === 'Delete' || e.key === 'Backspace'){
      if (board.selection.length){ e.preventDefault(); board.deleteSelection(); syncUI() }
      return
    }
    if (e.key === 'Escape'){ board.clearSelection(); return }
    if (e.key.startsWith('Arrow')){
      const d = e.shiftKey ? 16 : 1
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
      if (board.selection.length){ e.preventDefault(); board.nudge(dx, dy) }
      else { board.cam.x += dx * 12 / board.cam.k; board.cam.y += dy * 12 / board.cam.k; board.mark() }
      return
    }
    if (e.key === 'c' || e.key === 'C'){ openScanMenu(); return }
    if (e.key === '[' ){ gotoPage(curPage - 1); return }
    if (e.key === ']' ){ gotoPage(curPage + 1); return }
    if (e.key === 's' || e.key === 'S'){
      const v = Math.max(0, Math.min(4, board.st.smooth + (e.shiftKey ? 1 : -1)))
      board.st.smooth = v
      store.setPref({smooth: v})
      syncUI()
      toast('手ぶれ補正：' + ['切', '弱', '中', '強', '極'][v])
      return
    }
    const t = TOOLKEY[e.key.toLowerCase()]
    if (t && !e.altKey){ board.setTool(t); return }
  })

  window.addEventListener('keyup', e => {
    if (e.code === 'Space') board.setSpace(false)
  })
  window.addEventListener('blur', () => board.setSpace(false))
  /* 閉じ際の保存は間に合わないことがある。見えなくなった時点でも書いておく */
  window.addEventListener('beforeunload', () => { flushOut(); saver?.flush() })
  window.addEventListener('pagehide', () => { flushOut(); saver?.flush() })
  document.addEventListener('visibilitychange', () => { if (document.hidden){ flushOut(); saver?.flush() } })
}

boot()
