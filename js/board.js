/* ═══════════════════════════════════════════════
   board.js — 手の動きを板の上の形に変える
   ペン・消しゴム・図形・選択・画面の移動ぜんぶここ。
   指二本は必ず画面の移動と拡大にする（書きかけがあっても取り消す）。
   ペンが触っている間は指を無視する（手のひらで線が増えないように）。
   ═══════════════════════════════════════════════ */

import {createRenderer, createCamera, toWorld, toScreen, selectionBox, handles, HANDLE, THEMES} from './render.js'
import {bbox, bboxAll, pick, nearest, inside, overlaps, translate, scaleEl, splitPath} from './geom.js'
import {uid} from './scene.js'

export const SNAP = 16            /* 方眼に合わせるときの刻み */
const MIN_K = 0.08, MAX_K = 24

/* 手ぶれ補正の段。切・弱・中・強。
   数はペン先が指に追いつく速さ。1 なら指のとおりにそのまま線になる。 */
export const PULL = [1, 0.5, 0.3, 0.17]

const CURSORS = {
  pen: 'crosshair', marker: 'crosshair', eraser: 'none', line: 'crosshair',
  rect: 'crosshair', ell: 'crosshair', tri: 'crosshair', text: 'text',
  math: 'cell', graph: 'cell', select: 'default', laser: 'none', pan: 'grab',
}

export function createBoard(opt){
  const {canvas, scene, hooks = {}} = opt
  const R = createRenderer(canvas)
  const cam = createCamera()

  const st = {
    tool: 'pen',
    col: '#1b1f27',
    markCol: '#ffd84d',     /* 蛍光ペンは別の色を覚える */
    sz: 3.2,
    markSz: 5,
    smooth: 2,              /* 手ぶれ補正の段。0=切 1=弱 2=中 3=強 */
    mode: 'pen',            /* pen | marker */
    fill: false,
    dash: false,
    arrow: 2,
    snap: false,
    erasePart: false,
    eraseR: 14,
    textSize: 26,
    mathSize: 34,
    theme: 'paper',
    bg: 'grid',
    pageId: null,
    spaceDown: false,
  }

  let dirty = true
  let raf = 0
  const live = new Map()          /* 相手が書いている最中の線 */
  const laser = []                /* 指し棒の軌跡 */
  let selection = []              /* 選んでいる要素の id */
  let preview = null              /* これから置くもの */
  let band = null                 /* 範囲選択の枠 */
  let peers = []
  let hoverPt = null              /* 今どこを指しているか（消しゴムの輪に使う） */

  /* ── 入口 ───────────────────────────────── */

  const api = {
    get cam(){ return cam },
    get st(){ return st },
    get selection(){ return selection.map(id => scene.el(id)).filter(Boolean) },
    get R(){ return R },
    set peers(v){ peers = v; mark() },
    mark, resize, zoom, zoomAt, fit, home, screenToWorld, worldToScreen,
    setTool(t){
      if (st.tool === 'select' && t !== 'select') selection = []
      st.tool = t
      if (t === 'pen' || t === 'marker') st.mode = t
      applyCursor()
      mark()
      hooks.onState?.()
    },
    setLive(id, el){
      if (!el) live.delete(id); else live.set(id, el)
      mark()
    },
    dropLive(from){
      for (const [k, v] of live) if (v.by === from) live.delete(k)
      mark()
    },
    addLaser(x, y){ laser.push({x, y, t: performance.now()}); mark() },
    select(ids){ selection = ids.slice(); mark(); hooks.onState?.() },
    clearSelection(){ selection = []; mark(); hooks.onState?.() },
    deleteSelection,
    nudge,
    duplicate,
    exportSel: () => selection.map(id => scene.el(id)).filter(Boolean),
    place,          /* 外から要素を置く（数式・グラフ・画像） */
  }

  /* ── 描き直し ───────────────────────────── */

  function mark(){
    dirty = true
    if (!raf) raf = requestAnimationFrame(tick)
  }

  function tick(){
    raf = 0
    const now = performance.now()
    while (laser.length && now - laser[0].t > 950) laser.shift()
    R.draw({
      scene, cam, theme: st.theme, pageId: st.pageId, bg: st.bg,
      live, laser, peers,
      selection: selection.map(id => scene.el(id)).filter(Boolean),
      preview: preview ? [preview] : null,
      ghost: ghostLayer,
      onImgLoad: mark,
    })
    dirty = false
    if (laser.length || live.size) mark()
  }

  function ghostLayer(ctx, k, th){
    if (band){
      const x = Math.min(band.x0, band.x1), y = Math.min(band.y0, band.y1)
      const w = Math.abs(band.x1 - band.x0), h = Math.abs(band.y1 - band.y0)
      ctx.save()
      ctx.fillStyle = 'rgba(59,130,246,.1)'
      ctx.strokeStyle = 'rgba(59,130,246,.85)'
      ctx.lineWidth = 1.2 / k
      ctx.setLineDash([5 / k, 4 / k])
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
      ctx.restore()
    }
    /* 消しゴムは大きさが見えないと使えない。輪を出す */
    if (st.tool === 'eraser' && hoverPt){
      ctx.save()
      ctx.strokeStyle = th.dark ? 'rgba(255,255,255,.75)' : 'rgba(30,35,50,.6)'
      ctx.lineWidth = 1.4 / k
      ctx.beginPath()
      ctx.arc(hoverPt.x, hoverPt.y, st.eraseR / k, 0, 7)
      ctx.stroke()
      ctx.restore()
    }
  }

  function resize(){ R.resize(); mark() }

  function applyCursor(){
    canvas.style.cursor = st.spaceDown ? 'grab' : (CURSORS[st.tool] || 'crosshair')
  }

  /* ── 座標 ───────────────────────────────── */

  function screenToWorld(sx, sy){ return toWorld(cam, sx, sy, R.W, R.H) }
  function worldToScreen(wx, wy){ return toScreen(cam, wx, wy, R.W, R.H) }

  function evPos(e){
    const r = canvas.getBoundingClientRect()
    return {sx: e.clientX - r.left, sy: e.clientY - r.top}
  }

  function evWorld(e){
    const {sx, sy} = evPos(e)
    return screenToWorld(sx, sy)
  }

  const snapV = v => st.snap ? Math.round(v / SNAP) * SNAP : v

  /* ── 拡大・移動 ─────────────────────────── */

  function zoomAt(sx, sy, factor){
    const before = screenToWorld(sx, sy)
    cam.k = Math.max(MIN_K, Math.min(MAX_K, cam.k * factor))
    const after = screenToWorld(sx, sy)
    cam.x += before.x - after.x
    cam.y += before.y - after.y
    mark()
    hooks.onCam?.()
  }

  function zoom(factor){ zoomAt(R.W / 2, R.H / 2, factor) }

  function home(){
    cam.x = 0; cam.y = 0; cam.k = 1
    mark(); hooks.onCam?.()
  }

  function fit(){
    const list = scene.onPage(st.pageId)
    const b = bboxAll(list)
    if (!b){ home(); return }
    const pad = 70
    const k = Math.min((R.W - pad * 2) / Math.max(b.w, 1), (R.H - pad * 2) / Math.max(b.h, 1))
    cam.k = Math.max(MIN_K, Math.min(2.5, k))
    cam.x = b.x + b.w / 2
    cam.y = b.y + b.h / 2
    mark(); hooks.onCam?.()
  }

  /* ── 要素を置く ─────────────────────────── */

  function place(el, {select = true} = {}){
    const full = {id: uid(), p: st.pageId, ...el}
    scene.add(full)
    if (select){ st.tool = 'select'; selection = [full.id]; applyCursor() }
    mark()
    hooks.onState?.()
    return full
  }

  function deleteSelection(){
    if (!selection.length) return
    scene.remove(selection)
    selection = []
    mark()
    hooks.onState?.()
  }

  function nudge(dx, dy){
    const list = api.selection
    if (!list.length) return
    scene.put(list.map(e => translate(e, dx, dy)))
    mark()
  }

  function duplicate(){
    const list = api.selection
    if (!list.length) return
    const copies = list.map(e => ({...translate(e, 24, 24), id: uid()}))
    scene.put(copies)
    selection = copies.map(c => c.id)
    mark()
    hooks.onState?.()
  }

  /* ── 筆圧 ───────────────────────────────── */

  let lastPt = null
  function pressureOf(e, wx, wy){
    const raw = e.pressure
    if (e.pointerType === 'pen' && raw > 0 && raw !== 0.5) return 0.15 + raw * 0.95
    /* マウスや指は筆圧が来ない。速さから作る（ゆっくり引くと太い） */
    let v = 0
    if (lastPt){
      const dt = Math.max(e.timeStamp - lastPt.t, 1)
      v = Math.hypot(wx - lastPt.x, wy - lastPt.y) * cam.k / dt
    }
    const p = 1 - Math.min(1, v / 2.6)
    return 0.42 + p * 0.5
  }

  /* ── 入力 ───────────────────────────────── */

  const active = new Map()        /* pointerId -> {type} */
  let drag = null                 /* 今やっていること */
  let penDown = false
  let pinch = null

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('pointerleave', () => { if (hoverPt){ hoverPt = null; mark() } })
  canvas.addEventListener('wheel', onWheel, {passive: false})
  canvas.addEventListener('dblclick', onDbl)

  function onDown(e){
    if (e.pointerType === 'touch' && penDown) return
    /* 書きかけの文字があれば、ここで確定させる */
    const ae = document.activeElement
    if (ae && ae !== document.body && ae !== canvas) ae.blur()
    /* 板の上では既定の動き（選択・focus の付け替え）を止める。
       止めないと、この直後に開く文字入力から focus がすぐ抜けてしまう */
    e.preventDefault()
    if (e.pointerType === 'pen') penDown = true
    try { canvas.setPointerCapture?.(e.pointerId) } catch {}
    active.set(e.pointerId, {type: e.pointerType, ...evPos(e)})

    /* 指二本になったら、書きかけをやめて画面の操作へ */
    if (active.size === 2 && [...active.values()].every(p => p.type === 'touch')){
      abortDrag()
      startPinch()
      return
    }
    if (active.size > 2) return

    const pos = evPos(e)
    const w = screenToWorld(pos.sx, pos.sy)
    lastPt = {x: w.x, y: w.y, t: e.timeStamp}

    /* 真ん中ボタン・右ボタン・スペースは画面の移動 */
    if (e.button === 1 || e.button === 2 || st.spaceDown || st.tool === 'pan'){
      drag = {kind: 'pan', sx: pos.sx, sy: pos.sy, cx: cam.x, cy: cam.y}
      canvas.style.cursor = 'grabbing'
      return
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return

    switch (st.tool){
      case 'pen': case 'marker': startStroke(e, w); break
      case 'eraser': startErase(w); break
      case 'laser': drag = {kind: 'laser'}; hooks.onLaser?.(w.x, w.y); api.addLaser(w.x, w.y); break
      case 'line': case 'rect': case 'ell': case 'tri': startShape(w); break
      case 'text': hooks.editText?.(null, {x: snapV(w.x), y: snapV(w.y)}); break
      case 'math': hooks.editMath?.(null, {x: snapV(w.x), y: snapV(w.y)}); break
      case 'graph': hooks.addGraph?.({x: snapV(w.x), y: snapV(w.y)}); break
      case 'select': startSelect(e, w, pos); break
    }
    mark()
  }

  function onMove(e){
    const a = active.get(e.pointerId)
    if (a) Object.assign(a, evPos(e))
    if (pinch){ movePinch(); return }
    if (e.pointerType === 'touch' && penDown) return

    const pos = evPos(e)
    const w = screenToWorld(pos.sx, pos.sy)
    hooks.onHover?.(w, active.size > 0)
    if (st.tool === 'eraser'){ hoverPt = w; mark() }

    if (!drag){
      if (st.tool === 'select') hoverCursor(pos, w)
      return
    }

    switch (drag.kind){
      case 'pan': {
        cam.x = drag.cx - (pos.sx - drag.sx) / cam.k
        cam.y = drag.cy - (pos.sy - drag.sy) / cam.k
        mark(); hooks.onCam?.()
        break
      }
      case 'stroke': moveStroke(e, w); break
      case 'erase': moveErase(w); break
      case 'laser': hooks.onLaser?.(w.x, w.y); api.addLaser(w.x, w.y); break
      case 'shape': moveShape(w, e); break
      case 'band': band.x1 = w.x; band.y1 = w.y; mark(); break
      case 'move': moveSel(w, e); break
      case 'resize': resizeSel(w, e); break
    }
    lastPt = {x: w.x, y: w.y, t: e.timeStamp}
  }

  function onUp(e){
    active.delete(e.pointerId)
    if (e.pointerType === 'pen') penDown = false
    if (pinch && active.size < 2) pinch = null
    if (!drag) { applyCursor(); return }
    const pos = evPos(e)
    const w = screenToWorld(pos.sx, pos.sy)
    switch (drag.kind){
      case 'stroke': endStroke(); break
      case 'shape': endShape(); break
      case 'band': endBand(); break
      case 'move': case 'resize': endTransform(); break
      case 'erase': endErase(); break
    }
    drag = null
    applyCursor()
    mark()
    hooks.onState?.()
  }

  function abortDrag(){
    if (drag && drag.kind === 'stroke' && drag.el) hooks.onLiveEnd?.(drag.el.id)
    drag = null
    preview = null
    band = null
    mark()
  }

  /* ── 指二本 ─────────────────────────────── */

  function twoTouch(){
    const t = [...active.values()].filter(p => p.type === 'touch')
    return t.length >= 2 ? t : null
  }

  function startPinch(){
    const t = twoTouch()
    if (!t) return
    const mid = {sx: (t[0].sx + t[1].sx) / 2, sy: (t[0].sy + t[1].sy) / 2}
    pinch = {
      d: Math.hypot(t[0].sx - t[1].sx, t[0].sy - t[1].sy) || 1,
      mid,
      world: screenToWorld(mid.sx, mid.sy),
      k: cam.k,
    }
  }

  function movePinch(){
    const t = twoTouch()
    if (!t){ pinch = null; return }
    const d = Math.hypot(t[0].sx - t[1].sx, t[0].sy - t[1].sy) || 1
    const mid = {sx: (t[0].sx + t[1].sx) / 2, sy: (t[0].sy + t[1].sy) / 2}
    cam.k = Math.max(MIN_K, Math.min(MAX_K, pinch.k * (d / pinch.d)))
    /* つまんだ点が指の真ん中に残るように寄せる */
    cam.x = pinch.world.x - (mid.sx - R.W / 2) / cam.k
    cam.y = pinch.world.y - (mid.sy - R.H / 2) / cam.k
    mark(); hooks.onCam?.()
  }

  function onWheel(e){
    e.preventDefault()
    const pos = evPos(e)
    if (e.ctrlKey || e.metaKey){
      zoomAt(pos.sx, pos.sy, Math.exp(-e.deltaY * 0.0022))
      return
    }
    const unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? R.H : 1
    if (e.shiftKey){
      cam.x += e.deltaY * unit / cam.k
    } else {
      cam.x += e.deltaX * unit / cam.k
      cam.y += e.deltaY * unit / cam.k
    }
    mark(); hooks.onCam?.()
  }

  function onDbl(e){
    const w = evWorld(e)
    const hit = pick(scene.onPage(st.pageId), w.x, w.y, 6 / cam.k)
    if (!hit) return
    if (hit.type === 'text') hooks.editText?.(hit)
    else if (hit.type === 'math') hooks.editMath?.(hit)
    else if (hit.type === 'graph') hooks.editGraph?.(hit)
    else { st.tool = 'select'; selection = [hit.id]; applyCursor(); mark(); hooks.onState?.() }
  }

  /* ── ペン ───────────────────────────────── */

  function startStroke(e, w){
    const mark = st.tool === 'marker'
    const el = {
      id: uid(), p: st.pageId, type: 'path',
      pts: [w.x, w.y, pressureOf(e, w.x, w.y)],
      col: mark ? st.markCol : st.col,
      sz: mark ? st.markSz : st.sz,
      mode: mark ? 'marker' : 'pen',
    }
    drag = {
      kind: 'stroke', el, sent: 0,
      pull: pullFor(e),
      tip: {x: w.x, y: w.y},     /* 実際に線になる位置 */
      raw: {x: w.x, y: w.y},     /* 指（マウス）の位置 */
      press: el.pts[2],
    }
    preview = el
  }

  /* 手ぶれ補正の強さ。ペン先が指を追いかける速さ（1 で補正なし）。
     小さいほど線は滑らかになるが、そのぶん遅れて付いてくる。 */
  function pullFor(e){
    const a = PULL[st.smooth] ?? 1
    if (a >= 1) return 0
    /* ペンタブは手が直接動かしている感覚が要るので、遅れを半分に抑える */
    return e.pointerType === 'pen' ? Math.min(1, a * 1.7) : a
  }

  /* 指の位置をペン先に流し込む。補正が切なら素通し */
  function feed(x, y, p){
    const el = drag.el
    drag.raw.x = x; drag.raw.y = y; drag.press = p
    if (!drag.pull) return pushPt(el, x, y, p)
    const t = drag.tip
    t.x += (x - t.x) * drag.pull
    t.y += (y - t.y) * drag.pull
    return pushPt(el, t.x, t.y, p)
  }

  /* 指を離したら、残っている遅れを詰めて指の位置まで伸ばす */
  function catchUp(){
    if (!drag.pull) return
    const el = drag.el, t = drag.tip, r = drag.raw
    const near = 0.5 / cam.k
    for (let i = 0; i < 40; i++){
      const dx = r.x - t.x, dy = r.y - t.y
      if (dx * dx + dy * dy < near * near) break
      t.x += dx * drag.pull
      t.y += dy * drag.pull
      pushPt(el, t.x, t.y, drag.press)
    }
    pushPt(el, r.x, r.y, drag.press)
  }

  function pushPt(el, x, y, p){
    const n = el.pts.length
    /* 近すぎる点は捨てる。拡大しているときほど細かく拾う。
       補正中はペン先が小刻みに進むので、拾う間隔も細かくする */
    const min = (drag && drag.pull ? 0.4 : 1.1) / cam.k
    if (n >= 3){
      const dx = x - el.pts[n - 3], dy = y - el.pts[n - 2]
      if (dx * dx + dy * dy < min * min) return false
    }
    el.pts.push(x, y, p)
    return true
  }

  function moveStroke(e, w){
    const el = drag.el
    let added = false
    /* 間引かれた中間点も拾う。速く引いたときの角が取れる */
    const co = e.getCoalescedEvents ? e.getCoalescedEvents() : null
    if (co && co.length > 1){
      for (const ce of co){
        const p = evPos(ce)
        const cw = screenToWorld(p.sx, p.sy)
        added = feed(cw.x, cw.y, pressureOf(ce, cw.x, cw.y)) || added
      }
    } else {
      added = feed(w.x, w.y, pressureOf(e, w.x, w.y))
    }
    if (!added) return
    preview = el
    mark()
    /* 相手には途切れないよう、ときどき今の形を丸ごと送る */
    const now = performance.now()
    if (now - drag.sent > 70){
      drag.sent = now
      hooks.onLiveStroke?.(el)
    }
  }

  function endStroke(){
    const el = drag.el
    catchUp()
    preview = null
    hooks.onLiveEnd?.(el.id)
    if (el.pts.length < 3) return
    /* 点ひとつ（ちょん、と置いた）も残す */
    scene.add(el)
  }

  /* ── 消しゴム ───────────────────────────── */

  function startErase(w){
    drag = {kind: 'erase', origs: new Map(), dels: new Set(), puts: []}
    moveErase(w)
  }

  function moveErase(w){
    const r = st.eraseR / cam.k
    const area = {x: w.x - r, y: w.y - r, w: r * 2, h: r * 2}
    const dels = [], puts = []
    for (const el of scene.onPage(st.pageId)){
      if (!overlaps(bbox(el), area)) continue
      if (st.erasePart && el.type === 'path'){
        const parts = splitPath(el, w.x, w.y, r)
        if (!parts) continue
        remember(el)
        dels.push(el.id)
        drag.dels.add(el.id)
        for (const pts of parts){
          const piece = {...el, id: uid(), pts}
          puts.push(piece)
          drag.puts.push(piece)
        }
        continue
      }
      if (nearest(el, w.x, w.y, r) < Infinity){
        remember(el)
        dels.push(el.id)
        drag.dels.add(el.id)
      }
    }
    if (!dels.length) return
    /* その場は軽く消す。戻せる一手にまとめるのは手を離したとき */
    scene.act({dels, puts}, {undoable: false})
    mark()
  }

  function remember(el){
    /* 消しゴムが割った破片をさらに割ったときは、大元だけを覚えておく */
    if (!drag.origs.has(el.id) && !drag.puts.some(p => p.id === el.id)) drag.origs.set(el.id, {...el})
    drag.puts = drag.puts.filter(p => p.id !== el.id)
  }

  function endErase(){
    if (!drag.dels.size) return
    const origs = [...drag.origs.values()]
    const pieces = drag.puts
    /* いったん消す前に戻し（相手には流さない）、同じことを一手として積み直す。
       こうしないと、なぞった回数ぶん戻しボタンを押す羽目になる */
    scene.act({puts: origs, dels: pieces.map(p => p.id)}, {undoable: false, emit: false})
    scene.act({dels: origs.map(e => e.id), puts: pieces}, {undoable: true})
  }

  /* ── 図形 ───────────────────────────────── */

  function startShape(w){
    const x = snapV(w.x), y = snapV(w.y)
    drag = {kind: 'shape', x0: x, y0: y}
  }

  function moveShape(w, e){
    let x1 = snapV(w.x), y1 = snapV(w.y)
    const x0 = drag.x0, y0 = drag.y0
    if (st.tool === 'line'){
      if (e.shiftKey){
        /* 15度刻みに寄せる。垂線や45度の補助線がすぐ引ける */
        const d = Math.hypot(x1 - x0, y1 - y0)
        const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 12)) * (Math.PI / 12)
        x1 = x0 + Math.cos(a) * d
        y1 = y0 + Math.sin(a) * d
      }
      preview = {
        id: '_tmp', p: st.pageId, type: 'line', x1: x0, y1: y0, x2: x1, y2: y1,
        col: st.col, sz: st.sz, ar: st.arrow, dash: st.dash,
      }
    } else {
      let w2 = x1 - x0, h2 = y1 - y0
      if (e.shiftKey){
        const m = Math.max(Math.abs(w2), Math.abs(h2))
        w2 = Math.sign(w2 || 1) * m
        h2 = Math.sign(h2 || 1) * m
      }
      let px = x0, py = y0
      if (e.altKey){ px = x0 - w2; py = y0 - h2; w2 *= 2; h2 *= 2 }
      preview = {
        id: '_tmp', p: st.pageId, type: st.tool,
        x: Math.min(px, px + w2), y: Math.min(py, py + h2),
        w: Math.abs(w2), h: Math.abs(h2),
        col: st.col, sz: st.sz, fill: st.fill, dash: st.dash,
      }
    }
    mark()
  }

  function endShape(){
    const el = preview
    preview = null
    if (!el) return
    const small = el.type === 'line'
      ? Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 3 / cam.k
      : (el.w < 3 / cam.k && el.h < 3 / cam.k)
    if (small) return
    scene.add({...el, id: uid()})
  }

  /* ── 選択 ───────────────────────────────── */

  function hitHandle(pos){
    const list = api.selection
    if (!list.length) return -1
    const s = selectionBox(list, cam, R.W, R.H)
    if (!s) return -1
    const pad = 6
    const hs = handles(s.x - pad, s.y - pad, s.w + pad * 2, s.h + pad * 2)
    for (let i = 0; i < hs.length; i++){
      if (Math.abs(pos.sx - hs[i][0]) <= HANDLE && Math.abs(pos.sy - hs[i][1]) <= HANDLE) return i
    }
    return -1
  }

  const HCUR = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize']

  function hoverCursor(pos, w){
    const h = hitHandle(pos)
    if (h >= 0){ canvas.style.cursor = HCUR[h]; return }
    const list = api.selection
    const b = list.length ? selectionBox(list, cam, R.W, R.H) : null
    if (b && inside({x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12}, pos.sx, pos.sy)){
      canvas.style.cursor = 'move'; return
    }
    canvas.style.cursor = pick(scene.onPage(st.pageId), w.x, w.y, 6 / cam.k) ? 'move' : 'default'
  }

  function startSelect(e, w, pos){
    const h = hitHandle(pos)
    if (h >= 0){
      const list = api.selection
      const b = bboxAll(list)
      drag = {kind: 'resize', h, b, orig: list.map(el => ({...el})), w0: w}
      return
    }
    const list = api.selection
    const sb = list.length ? selectionBox(list, cam, R.W, R.H) : null
    const onSel = sb && inside({x: sb.x - 6, y: sb.y - 6, w: sb.w + 12, h: sb.h + 12}, pos.sx, pos.sy)
    if (onSel){
      drag = {kind: 'move', orig: list.map(el => ({...el})), w0: w, moved: false}
      return
    }
    const hit = pick(scene.onPage(st.pageId), w.x, w.y, 6 / cam.k)
    if (hit){
      if (e.shiftKey && !selection.includes(hit.id)) selection.push(hit.id)
      else if (e.shiftKey) selection = selection.filter(i => i !== hit.id)
      else selection = [hit.id]
      const list2 = api.selection
      drag = {kind: 'move', orig: list2.map(el => ({...el})), w0: w, moved: false}
      mark()
      return
    }
    if (!e.shiftKey) selection = []
    band = {x0: w.x, y0: w.y, x1: w.x, y1: w.y}
    drag = {kind: 'band'}
    mark()
  }

  function moveSel(w, e){
    let dx = w.x - drag.w0.x, dy = w.y - drag.w0.y
    if (st.snap){ dx = Math.round(dx / SNAP) * SNAP; dy = Math.round(dy / SNAP) * SNAP }
    if (e.shiftKey){ if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
    if (!dx && !dy) return
    drag.moved = true
    scene.act({puts: drag.orig.map(el => translate(el, dx, dy))}, {undoable: false})
    mark()
  }

  function resizeSel(w, e){
    const {h, b, orig} = drag
    /* 掴んだ角の反対側を固定点にする */
    const left = h === 0 || h === 6 || h === 7
    const right = h === 2 || h === 3 || h === 4
    const top = h === 0 || h === 1 || h === 2
    const bot = h === 4 || h === 5 || h === 6
    const ox = right ? b.x : left ? b.x + b.w : b.x + b.w / 2
    const oy = bot ? b.y : top ? b.y + b.h : b.y + b.h / 2
    let sx = 1, sy = 1
    if (left || right) sx = (w.x - ox) / ((right ? b.x + b.w : b.x) - ox || 1)
    if (top || bot) sy = (w.y - oy) / ((bot ? b.y + b.h : b.y) - oy || 1)
    if (e.shiftKey || !(left || right) || !(top || bot)){
      const k = (left || right) && (top || bot) ? Math.max(Math.abs(sx), Math.abs(sy))
        : (left || right) ? Math.abs(sx) : Math.abs(sy)
      sx = (sx < 0 ? -1 : 1) * k
      sy = (sy < 0 ? -1 : 1) * k
    }
    sx = Math.abs(sx) < 0.02 ? 0.02 * Math.sign(sx || 1) : sx
    sy = Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy
    drag.moved = true
    scene.act({puts: orig.map(el => scaleEl(el, ox, oy, sx, sy))}, {undoable: false})
    mark()
  }

  function endTransform(){
    if (!drag.moved) return
    /* 動かし終えた形を、一回の「戻せる操作」として積み直す */
    const now = api.selection.map(el => ({...el}))
    scene.act({puts: drag.orig}, {undoable: false, emit: false})
    scene.put(now)
    mark()
  }

  function endBand(){
    const r = {
      x: Math.min(band.x0, band.x1), y: Math.min(band.y0, band.y1),
      w: Math.abs(band.x1 - band.x0), h: Math.abs(band.y1 - band.y0),
    }
    band = null
    if (r.w < 3 && r.h < 3) return
    for (const el of scene.onPage(st.pageId)){
      if (overlaps(bbox(el), r) && !selection.includes(el.id)) selection.push(el.id)
    }
    mark()
  }

  /* ── 鍵盤 ───────────────────────────────── */

  function setSpace(down){
    if (st.spaceDown === down) return
    st.spaceDown = down
    applyCursor()
  }

  api.setSpace = setSpace
  api.applyCursor = applyCursor

  R.resize()
  mark()
  return api
}
