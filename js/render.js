/* ═══════════════════════════════════════════════
   render.js — 板を描く
   すべて世界座標で描き、拡大はキャンバスの変換に任せる。
   だから何倍に寄っても線も字も数式も滲まない（画像だけは元の解像度どおり）。

   ペンは「線を引く」のではなく輪郭を塗る。速さと筆圧で幅が変わり、
   入りと抜きが細くなる。これがあるかないかで、手書きの図の読みやすさが変わる。
   ═══════════════════════════════════════════════ */

import {typeset} from './math.js'
import {bbox, measureText, TEXT_FONT, LINE_H} from './geom.js'
import {compile} from './expr.js'

export const THEMES = {
  paper: {
    bg: '#fbfaf7', minor: 'rgba(42,74,120,.085)', major: 'rgba(42,74,120,.17)',
    axis: 'rgba(30,48,80,.42)', ink: '#1b1f27', sub: 'rgba(27,31,39,.5)', dark: false,
  },
  board: {
    bg: '#16322c', minor: 'rgba(255,255,255,.07)', major: 'rgba(255,255,255,.14)',
    axis: 'rgba(255,255,255,.42)', ink: '#f3f1e7', sub: 'rgba(243,241,231,.55)', dark: true,
  },
  slate: {
    bg: '#1a1c22', minor: 'rgba(160,190,255,.07)', major: 'rgba(160,190,255,.15)',
    axis: 'rgba(200,215,255,.4)', ink: '#eef1f6', sub: 'rgba(238,241,246,.55)', dark: true,
  },
}

const GRID = 32          /* 方眼の基準の一マス（世界座標） */
const imgCache = new Map()
const fnCache = new Map()

function getFn(src){
  let f = fnCache.get(src)
  if (f === undefined){
    f = compile(src).fn
    if (fnCache.size > 200) fnCache.clear()
    fnCache.set(src, f)
  }
  return f
}

function getImg(src, onLoad){
  let im = imgCache.get(src)
  if (!im){
    im = new Image()
    im.decoding = 'async'
    im.onload = () => onLoad?.()
    im.src = src
    imgCache.set(src, im)
  }
  return im
}

/* ── 位置の変換 ───────────────────────────── */

export function createCamera(){
  return {x: 0, y: 0, k: 1}
}

export function toWorld(cam, sx, sy, W, H){
  return {x: (sx - W / 2) / cam.k + cam.x, y: (sy - H / 2) / cam.k + cam.y}
}

export function toScreen(cam, wx, wy, W, H){
  return {x: (wx - cam.x) * cam.k + W / 2, y: (wy - cam.y) * cam.k + H / 2}
}

export function viewRect(cam, W, H){
  const a = toWorld(cam, 0, 0, W, H)
  const b = toWorld(cam, W, H, W, H)
  return {x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y}
}

/* ── ペンの輪郭 ───────────────────────────── */

/* 位置を軽くならす。端は動かさない（書き始めがずれると気持ち悪い） */
function smooth(p){
  const n = p.length / 3
  if (n < 4) return p
  const o = p.slice()
  for (let i = 1; i < n - 1; i++){
    const a = (i - 1) * 3, b = i * 3, c = (i + 1) * 3
    o[b] = p[a] * 0.25 + p[b] * 0.5 + p[c] * 0.25
    o[b + 1] = p[a + 1] * 0.25 + p[b + 1] * 0.5 + p[c + 1] * 0.25
  }
  /* 筆圧はもっと強くならす。生のままだとまだらに太る */
  for (let pass = 0; pass < 2; pass++){
    for (let i = 1; i < n - 1; i++){
      const a = (i - 1) * 3 + 2, b = i * 3 + 2, c = (i + 1) * 3 + 2
      o[b] = o[a] * 0.3 + o[b] * 0.4 + o[c] * 0.3
    }
  }
  return o
}

/* 滑らかな閉じた輪郭を一本のパスにする */
function polyPath(ctx, pts){
  const n = pts.length / 2
  if (n < 3) return
  ctx.moveTo((pts[(n - 1) * 2] + pts[0]) / 2, (pts[(n - 1) * 2 + 1] + pts[1]) / 2)
  for (let i = 0; i < n; i++){
    const j = (i + 1) % n
    const mx = (pts[i * 2] + pts[j * 2]) / 2
    const my = (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2
    ctx.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my)
  }
  ctx.closePath()
}

export function inkOutline(p0, size){
  const p = smooth(p0)
  const n = p.length / 3
  const base = size / 2
  if (n < 2){
    return {dot: true, x: p[0], y: p[1], r: base * (0.55 + 0.45 * (p[2] || 0.5))}
  }
  /* 弧長。入り抜きの細りに使う */
  const len = new Float64Array(n)
  let total = 0
  for (let i = 1; i < n; i++){
    total += Math.hypot(p[i * 3] - p[(i - 1) * 3], p[i * 3 + 1] - p[(i - 1) * 3 + 1])
    len[i] = total
  }
  const taper = Math.min(total * 0.32, base * 5.5)
  const L = [], R = []
  for (let i = 0; i < n; i++){
    const x = p[i * 3], y = p[i * 3 + 1]
    const ia = Math.max(0, i - 1), ib = Math.min(n - 1, i + 1)
    let dx = p[ib * 3] - p[ia * 3], dy = p[ib * 3 + 1] - p[ia * 3 + 1]
    let d = Math.hypot(dx, dy)
    if (d < 1e-6){ dx = 1; dy = 0; d = 1 }
    dx /= d; dy /= d
    let r = base * (0.42 + 0.72 * (p[i * 3 + 2] || 0.5))
    if (taper > 0.01){
      const a = Math.min(1, len[i] / taper)
      const b = Math.min(1, (total - len[i]) / taper)
      r *= 0.3 + 0.7 * Math.sqrt(Math.min(a, b))
    }
    r = Math.max(r, base * 0.12)
    L.push(x - dy * r, y + dx * r)
    R.push(x + dy * r, y - dx * r)
  }
  /* 両端は丸く閉じる */
  const cap = (cx, cy, px, py, r, out) => {
    const a0 = Math.atan2(py - cy, px - cx)
    for (let i = 1; i < 7; i++){
      const a = a0 + Math.PI * (i / 7)
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
  }
  const poly = L.slice()
  const ex = p[(n - 1) * 3], ey = p[(n - 1) * 3 + 1]
  const er = Math.hypot(L[L.length - 2] - ex, L[L.length - 1] - ey)
  cap(ex, ey, L[L.length - 2], L[L.length - 1], er, poly)
  for (let i = n - 1; i >= 0; i--) poly.push(R[i * 2], R[i * 2 + 1])
  const sx = p[0], sy = p[1]
  const sr = Math.hypot(R[0] - sx, R[1] - sy)
  cap(sx, sy, R[0], R[1], sr, poly)
  return {poly}
}

function drawPath(ctx, el){
  if (el.mode === 'marker'){
    /* 蛍光ペンは太さ一定、乗算で重ねる。重ねたところが濃くなるのが本物らしい */
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha *= 0.38
    ctx.strokeStyle = el.col
    ctx.lineWidth = el.sz * 3.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const p = smooth(el.pts)
    ctx.moveTo(p[0], p[1])
    for (let i = 3; i < p.length - 3; i += 3){
      ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 3]) / 2, (p[i + 1] + p[i + 4]) / 2)
    }
    ctx.lineTo(p[p.length - 3], p[p.length - 2])
    ctx.stroke()
    ctx.restore()
    return
  }
  const o = inkOutline(el.pts, el.sz)
  ctx.fillStyle = el.col
  ctx.beginPath()
  if (o.dot){ ctx.arc(o.x, o.y, Math.max(o.r, 0.3), 0, 7) }
  else polyPath(ctx, o.poly)
  ctx.fill()
}

/* ── 図形 ─────────────────────────────────── */

function dashes(ctx, el, k){
  if (el.dash) ctx.setLineDash([el.sz * 3.2, el.sz * 2.6])
  else ctx.setLineDash([])
}

function arrowHead(ctx, x, y, ang, s){
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - Math.cos(ang - 0.42) * s, y - Math.sin(ang - 0.42) * s)
  ctx.lineTo(x - Math.cos(ang) * s * 0.74, y - Math.sin(ang) * s * 0.74)
  ctx.lineTo(x - Math.cos(ang + 0.42) * s, y - Math.sin(ang + 0.42) * s)
  ctx.closePath()
  ctx.fill()
}

function drawLine(ctx, el, k){
  const ang = Math.atan2(el.y2 - el.y1, el.x2 - el.x1)
  const hs = el.sz * 4.2
  let x1 = el.x1, y1 = el.y1, x2 = el.x2, y2 = el.y2
  if (el.ar & 2){ x2 -= Math.cos(ang) * hs * 0.6; y2 -= Math.sin(ang) * hs * 0.6 }
  if (el.ar & 1){ x1 += Math.cos(ang) * hs * 0.6; y1 += Math.sin(ang) * hs * 0.6 }
  ctx.strokeStyle = el.col
  ctx.fillStyle = el.col
  ctx.lineWidth = el.sz
  ctx.lineCap = el.ar ? 'butt' : 'round'
  dashes(ctx, el, k)
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.setLineDash([])
  if (el.ar & 2) arrowHead(ctx, el.x2, el.y2, ang, hs)
  if (el.ar & 1) arrowHead(ctx, el.x1, el.y1, ang + Math.PI, hs)
}

function shapePath(ctx, el){
  const x = el.x, y = el.y, w = el.w, h = el.h
  ctx.beginPath()
  if (el.type === 'rect'){
    const r = Math.min(Math.abs(w), Math.abs(h)) * 0.04
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
    else ctx.rect(x, y, w, h)
  } else if (el.type === 'ell'){
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, 7)
  } else if (el.type === 'tri'){
    ctx.moveTo(x + w / 2, y)
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x, y + h)
    ctx.closePath()
  }
}

function drawShape(ctx, el, k){
  shapePath(ctx, el)
  if (el.fill){
    const a = ctx.globalAlpha
    ctx.globalAlpha = a * 0.16
    ctx.fillStyle = el.col
    ctx.fill()
    ctx.globalAlpha = a
  }
  ctx.strokeStyle = el.col
  ctx.lineWidth = el.sz
  ctx.lineJoin = 'round'
  dashes(ctx, el, k)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawText(ctx, el){
  const m = measureText(el.s, el.sz)
  ctx.fillStyle = el.col
  ctx.font = (el.bold ? 'bold ' : '') + el.sz + 'px ' + TEXT_FONT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const lh = el.sz * LINE_H
  m.lines.forEach((l, i) => ctx.fillText(l, el.x, el.y + lh * i + el.sz * 1.0))
}

function drawMath(ctx, el){
  const t = typeset(el.s, el.sz)
  ctx.fillStyle = el.col
  ctx.save()
  t.draw(ctx, el.x, el.y + t.h)
  ctx.restore()
}

/* ── 関数のグラフ ─────────────────────────── */

function niceStep(span, want){
  const raw = span / want
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const s = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return s * mag
}

function fmtNum(v, step){
  if (Math.abs(v) < step * 1e-6) return '0'
  const dec = Math.max(0, -Math.floor(Math.log10(step)) + (step < 1 ? 0 : 0))
  const s = v.toFixed(Math.min(dec, 4))
  return s.replace(/\.?0+$/, '')
}

function drawGraph(ctx, el, th, k){
  const {x, y, w, h} = el
  const xmin = el.xmin, xmax = el.xmax, ymin = el.ymin, ymax = el.ymax
  const X = v => x + (v - xmin) / (xmax - xmin) * w
  const Y = v => y + h - (v - ymin) / (ymax - ymin) * h
  const px = 1 / k

  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()

  /* 下地 */
  ctx.fillStyle = th.dark ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.72)'
  ctx.fillRect(x, y, w, h)

  const sx = niceStep(xmax - xmin, Math.max(4, w / 64))
  const sy = niceStep(ymax - ymin, Math.max(4, h / 64))

  /* 方眼。細かいほうは、画面で 5px 以上空くときだけ引く */
  ctx.lineWidth = px
  const subX = sx / 5, subY = sy / 5
  const roomX = subX / (xmax - xmin) * w * k
  const roomY = subY / (ymax - ymin) * h * k
  if (roomX > 5 && roomY > 5){
    ctx.strokeStyle = th.minor
    ctx.beginPath()
    for (let v = Math.ceil(xmin / subX) * subX; v <= xmax; v += subX){ const gx = X(v); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h) }
    for (let v = Math.ceil(ymin / subY) * subY; v <= ymax; v += subY){ const gy = Y(v); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy) }
    ctx.stroke()
  }
  ctx.strokeStyle = th.major
  ctx.beginPath()
  for (let v = Math.ceil(xmin / sx) * sx; v <= xmax; v += sx){ const gx = X(v); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h) }
  for (let v = Math.ceil(ymin / sy) * sy; v <= ymax; v += sy){ const gy = Y(v); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy) }
  ctx.stroke()

  /* 軸 */
  const ax = X(0), ay = Y(0)
  ctx.strokeStyle = th.axis
  ctx.lineWidth = px * 1.6
  ctx.beginPath()
  if (ymin <= 0 && ymax >= 0){ ctx.moveTo(x, ay); ctx.lineTo(x + w, ay) }
  if (xmin <= 0 && xmax >= 0){ ctx.moveTo(ax, y); ctx.lineTo(ax, y + h) }
  ctx.stroke()

  /* 目盛の数 */
  if (el.labels !== false){
    const fs = Math.max(9, Math.min(h, w) * 0.05)
    ctx.font = fs + 'px ' + TEXT_FONT
    ctx.fillStyle = th.sub
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const ty = ymin <= 0 && ymax >= 0 ? Math.min(ay + fs * 0.3, y + h - fs * 1.2) : y + h - fs * 1.2
    for (let v = Math.ceil(xmin / sx) * sx; v <= xmax + 1e-9; v += sx){
      if (Math.abs(v) < sx * 1e-6) continue
      ctx.fillText(fmtNum(v, sx), X(v), ty)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const tx = xmin <= 0 && xmax >= 0 ? Math.max(ax - fs * 0.35, x + fs * 0.3) : x + w - fs * 0.3
    for (let v = Math.ceil(ymin / sy) * sy; v <= ymax + 1e-9; v += sy){
      if (Math.abs(v) < sy * 1e-6) continue
      ctx.fillText(fmtNum(v, sy), tx, Y(v))
    }
    if (xmin <= 0 && xmax >= 0 && ymin <= 0 && ymax >= 0){
      ctx.textAlign = 'right'; ctx.textBaseline = 'top'
      ctx.fillText('O', ax - fs * 0.25, ay + fs * 0.2)
    }
  }

  /* 曲線 */
  const N = Math.max(240, Math.min(1600, Math.round(w * k)))
  for (const f of (el.fns || [])){
    const fn = getFn(f.s)
    if (!fn) continue
    ctx.strokeStyle = f.col
    ctx.lineWidth = Math.max(px * 1.2, (el.lw || 2.4))
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    let drawing = false
    let prevY = null
    for (let i = 0; i <= N; i++){
      const vx = xmin + (xmax - xmin) * i / N
      let vy
      try { vy = fn(vx) } catch { vy = NaN }
      const ok = Number.isFinite(vy)
      /* 漸近線をまたいだところは繋がない。繋ぐと縦の嘘の線が出る */
      const jump = prevY != null && Math.abs(vy - prevY) > (ymax - ymin) * 1.4
      if (!ok || jump){
        drawing = false
        prevY = ok ? vy : null
        continue
      }
      const gx = X(vx), gy = Y(vy)
      const far = vy > ymax + (ymax - ymin) || vy < ymin - (ymax - ymin)
      if (far){
        if (drawing){ ctx.lineTo(gx, Y(Math.max(Math.min(vy, ymax + (ymax - ymin) * 0.1), ymin - (ymax - ymin) * 0.1))) }
        drawing = false
        prevY = vy
        continue
      }
      if (drawing) ctx.lineTo(gx, gy)
      else { ctx.moveTo(gx, gy); drawing = true }
      prevY = vy
    }
    ctx.stroke()
  }

  ctx.restore()

  /* 枠 */
  ctx.strokeStyle = th.dark ? 'rgba(255,255,255,.2)' : 'rgba(30,48,80,.22)'
  ctx.lineWidth = px
  ctx.strokeRect(x, y, w, h)

  /* 式の見出し */
  if (el.fns && el.fns.length && el.legend !== false){
    const fs = Math.max(10, Math.min(h, w) * 0.058)
    ctx.font = fs + 'px ' + TEXT_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    let ly = y + fs * 0.4
    for (const f of el.fns){
      const label = 'y = ' + f.s.replace(/^\s*(y|f\(x\))\s*=\s*/i, '')
      const tw = ctx.measureText(label).width
      ctx.fillStyle = th.dark ? 'rgba(0,0,0,.4)' : 'rgba(255,255,255,.82)'
      ctx.fillRect(x + fs * 0.35, ly, tw + fs * 0.5, fs * 1.25)
      ctx.fillStyle = f.col
      ctx.fillText(label, x + fs * 0.6, ly + fs * 0.15)
      ly += fs * 1.45
    }
  }
}

/* ── 一要素 ───────────────────────────────── */

export function drawEl(ctx, el, th, k, onImgLoad){
  ctx.save()
  switch (el.type){
    case 'path': drawPath(ctx, el); break
    case 'line': drawLine(ctx, el, k); break
    case 'rect': case 'ell': case 'tri': drawShape(ctx, el, k); break
    case 'text': drawText(ctx, el); break
    case 'math': drawMath(ctx, el); break
    case 'graph': drawGraph(ctx, el, th, k); break
    case 'img': {
      const im = getImg(el.src, onImgLoad)
      if (im.complete && im.naturalWidth){
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(im, el.x, el.y, el.w, el.h)
      } else {
        ctx.fillStyle = th.dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)'
        ctx.fillRect(el.x, el.y, el.w, el.h)
      }
      break
    }
  }
  ctx.restore()
}

/* ── 背景 ─────────────────────────────────── */

function drawBG(ctx, th, bg, cam, W, H){
  ctx.fillStyle = th.bg
  ctx.fillRect(0, 0, W, H)
  if (bg === 'plain') return
  const v = viewRect(cam, W, H)
  const k = cam.k
  /* 一マスが画面で細かすぎるときは間引く */
  let step = GRID
  while (step * k < 11) step *= 2
  while (step * k > 110) step /= 2
  const px = 1
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(k, k)
  ctx.translate(-cam.x, -cam.y)
  ctx.lineWidth = px / k

  const x0 = Math.floor(v.x / step) * step
  const y0 = Math.floor(v.y / step) * step
  const x1 = v.x + v.w, y1 = v.y + v.h

  if (bg === 'dot'){
    ctx.fillStyle = th.major
    const r = Math.min(1.4, 1.2) / k
    for (let gx = x0; gx <= x1; gx += step){
      for (let gy = y0; gy <= y1; gy += step){
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 7); ctx.fill()
      }
    }
    ctx.restore()
    return
  }

  const snap = v2 => Math.round((v2 - cam.x) * k) / k + cam.x
  const major = step * 4

  ctx.strokeStyle = th.minor
  ctx.beginPath()
  if (bg !== 'line'){
    for (let gx = x0; gx <= x1; gx += step){
      if (Math.abs(gx % major) < 1e-6) continue
      const s = snap(gx); ctx.moveTo(s, v.y); ctx.lineTo(s, y1)
    }
  }
  for (let gy = y0; gy <= y1; gy += step){
    if (bg !== 'line' && Math.abs(gy % major) < 1e-6) continue
    const s = Math.round((gy - cam.y) * k) / k + cam.y
    ctx.moveTo(v.x, s); ctx.lineTo(x1, s)
  }
  ctx.stroke()

  if (bg === 'line'){ ctx.restore(); return }

  ctx.strokeStyle = th.major
  ctx.beginPath()
  for (let gx = Math.floor(v.x / major) * major; gx <= x1; gx += major){
    const s = snap(gx); ctx.moveTo(s, v.y); ctx.lineTo(s, y1)
  }
  for (let gy = Math.floor(v.y / major) * major; gy <= y1; gy += major){
    const s = Math.round((gy - cam.y) * k) / k + cam.y
    ctx.moveTo(v.x, s); ctx.lineTo(x1, s)
  }
  ctx.stroke()

  if (bg === 'graph'){
    /* 原点を通る軸を一本だけ強く */
    ctx.strokeStyle = th.axis
    ctx.lineWidth = 1.5 / k
    ctx.beginPath()
    ctx.moveTo(v.x, 0); ctx.lineTo(x1, 0)
    ctx.moveTo(0, v.y); ctx.lineTo(0, y1)
    ctx.stroke()
  }
  ctx.restore()
}

/* ── 画面ぜんたい ─────────────────────────── */

export function createRenderer(canvas){
  const ctx = canvas.getContext('2d', {alpha: false, desynchronized: true})
  let W = 0, H = 0, dpr = 1

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const r = canvas.getBoundingClientRect()
    W = Math.max(1, Math.round(r.width))
    H = Math.max(1, Math.round(r.height))
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
  }

  function draw(opts){
    const {scene, cam, theme, pageId, bg, live, selection, peers, laser, preview, ghost, frame} = opts
    const dim = opts.dim == null ? 1 : opts.dim
    const th = THEMES[theme] || THEMES.paper
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawBG(ctx, th, bg || 'grid', cam, W, H)

    ctx.globalAlpha = dim
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.scale(cam.k, cam.k)
    ctx.translate(-cam.x, -cam.y)

    const v = viewRect(cam, W, H)
    const pad = 40 / cam.k
    const vis = {x: v.x - pad, y: v.y - pad, w: v.w + pad * 2, h: v.h + pad * 2}

    const list = scene.onPage(pageId)
    for (const el of list){
      const b = bbox(el)
      if (b.x > vis.x + vis.w || b.x + b.w < vis.x || b.y > vis.y + vis.h || b.y + b.h < vis.y) continue
      drawEl(ctx, el, th, cam.k, opts.onImgLoad)
    }

    /* 相手が今まさに書いている線 */
    if (live) for (const el of live.values()) drawEl(ctx, el, th, cam.k)

    /* 自分がこれから置くもの */
    if (preview) for (const el of preview) drawEl(ctx, el, th, cam.k)
    if (ghost) ghost(ctx, cam.k, th)

    ctx.restore()
    ctx.globalAlpha = 1

    /* ここから画面座標。拡大しても太さが変わらないもの */
    if (frame) drawFrame(ctx, frame, W, H, th)
    if (selection && selection.length){
      drawSelection(ctx, selection, cam, W, H, th)
    }
    if (laser && laser.length) drawLaser(ctx, laser, cam, W, H)
    if (peers) drawPeers(ctx, peers, cam, W, H, th)
    return {W, H, dpr}
  }

  return {
    ctx, resize, draw,
    get W(){ return W }, get H(){ return H }, get dpr(){ return dpr },
  }
}

/* ペンタブの「使える面」を見せる。
   実機のペンタブと同じで、枠の中だけが相手の画面にあたる。外は縁。 */
function drawFrame(ctx, f, W, H, th){
  ctx.save()
  const label = (s, x, y) => {
    ctx.font = '600 12px ' + TEXT_FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const w = ctx.measureText(s).width + 20
    ctx.fillStyle = th.dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)'
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 11, w, 22, 11)
    else ctx.rect(x - w / 2, y - 11, w, 22)
    ctx.fill()
    ctx.fillStyle = th.dark ? 'rgba(255,255,255,.72)' : 'rgba(30,36,46,.62)'
    ctx.fillText(s, x, y)
  }

  if (!f.w || !f.h){
    ctx.fillStyle = th.dark ? 'rgba(0,0,0,.45)' : 'rgba(240,238,232,.75)'
    ctx.fillRect(0, 0, W, H)
    label('つなぐ画面をさがしています…', W / 2, H / 2)
    ctx.restore()
    return
  }

  /* 縁を落とす */
  ctx.fillStyle = th.dark ? 'rgba(0,0,0,.5)' : 'rgba(26,32,44,.14)'
  ctx.beginPath()
  ctx.rect(0, 0, W, H)
  ctx.rect(f.x, f.y, f.w, f.h)
  ctx.fill('evenodd')

  /* 四隅のかぎ。全部を囲うより、面の広さが目で分かる */
  const c = Math.min(f.w, f.h) * 0.07 + 10
  ctx.strokeStyle = th.dark ? 'rgba(255,255,255,.5)' : 'rgba(30,48,80,.42)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const [cx, cy, sx, sy] of [
    [f.x, f.y, 1, 1], [f.x + f.w, f.y, -1, 1],
    [f.x + f.w, f.y + f.h, -1, -1], [f.x, f.y + f.h, 1, -1],
  ]){
    ctx.moveTo(cx + sx * c, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + sy * c)
  }
  ctx.stroke()

  ctx.strokeStyle = th.dark ? 'rgba(255,255,255,.16)' : 'rgba(30,48,80,.16)'
  ctx.lineWidth = 1
  ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1)

  if (f.name) label(f.name + ' の画面', f.x + f.w / 2, Math.max(f.y - 18, 14))
  ctx.restore()
}

export const HANDLE = 7

export function selectionBox(list, cam, W, H){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const el of list){
    const b = bbox(el)
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  if (!Number.isFinite(x0)) return null
  const a = toScreen(cam, x0, y0, W, H)
  const b2 = toScreen(cam, x1, y1, W, H)
  return {x: a.x, y: a.y, w: b2.x - a.x, h: b2.y - a.y, world: {x: x0, y: y0, w: x1 - x0, h: y1 - y0}}
}

function drawSelection(ctx, list, cam, W, H, th){
  const s = selectionBox(list, cam, W, H)
  if (!s) return
  const pad = 6
  const x = s.x - pad, y = s.y - pad, w = s.w + pad * 2, h = s.h + pad * 2
  ctx.save()
  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = 1.25
  ctx.setLineDash([5, 4])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.fillStyle = th.dark ? '#16322c' : '#fff'
  for (const [hx, hy] of handles(x, y, w, h)){
    ctx.beginPath()
    ctx.rect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

export function handles(x, y, w, h){
  return [
    [x, y], [x + w / 2, y], [x + w, y],
    [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h],
    [x, y + h], [x, y + h / 2],
  ]
}

function drawLaser(ctx, pts, cam, W, H){
  ctx.save()
  const now = performance.now()
  for (const t of pts){
    const age = (now - t.t) / 900
    if (age > 1) continue
    const p = toScreen(cam, t.x, t.y, W, H)
    const r = 4 + 9 * (1 - age)
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.2)
    g.addColorStop(0, `rgba(255,60,80,${0.85 * (1 - age)})`)
    g.addColorStop(0.45, `rgba(255,60,80,${0.3 * (1 - age)})`)
    g.addColorStop(1, 'rgba(255,60,80,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.2, 0, 7); ctx.fill()
  }
  ctx.restore()
}

function drawPeers(ctx, peers, cam, W, H, th){
  ctx.save()
  ctx.font = '600 11.5px ' + TEXT_FONT
  for (const p of peers){
    if (!p.cursor) continue
    const s = toScreen(cam, p.cursor.x, p.cursor.y, W, H)
    if (s.x < -60 || s.y < -40 || s.x > W + 60 || s.y > H + 60) continue
    ctx.save()
    ctx.translate(s.x, s.y)
    /* 矢の形。相手の色で塗る */
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, 15.5)
    ctx.lineTo(4.1, 11.8)
    ctx.lineTo(6.8, 17.4)
    ctx.lineTo(9.3, 16.2)
    ctx.lineTo(6.6, 10.7)
    ctx.lineTo(11.6, 10.3)
    ctx.closePath()
    ctx.fillStyle = p.col
    ctx.strokeStyle = 'rgba(0,0,0,.35)'
    ctx.lineWidth = 1
    ctx.fill()
    ctx.stroke()
    const name = p.name || '?'
    const tw = ctx.measureText(name).width
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(11, 15, tw + 12, 18, 9)
    else ctx.rect(11, 15, tw + 12, 18)
    ctx.fillStyle = p.col
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, 17, 24.5)
    ctx.restore()
  }
  ctx.restore()
}

/* ── 書き出し ─────────────────────────────── */

export function exportPage(scene, pageId, theme, bg, scale = 2, margin = 48){
  const th = THEMES[theme] || THEMES.paper
  const list = scene.onPage(pageId)
  let b = null
  for (const el of list){
    const e = bbox(el)
    if (!b) b = {x: e.x, y: e.y, X: e.x + e.w, Y: e.y + e.h}
    else { b.x = Math.min(b.x, e.x); b.y = Math.min(b.y, e.y); b.X = Math.max(b.X, e.x + e.w); b.Y = Math.max(b.Y, e.y + e.h) }
  }
  if (!b) b = {x: -400, y: -250, X: 400, Y: 250}
  const w = b.X - b.x + margin * 2
  const h = b.Y - b.y + margin * 2
  const cv = document.createElement('canvas')
  const s = Math.min(scale, 8000 / Math.max(w, h))
  cv.width = Math.max(1, Math.round(w * s))
  cv.height = Math.max(1, Math.round(h * s))
  const c = cv.getContext('2d')
  const cam = {x: b.x - margin + w / 2, y: b.y - margin + h / 2, k: s}
  c.fillStyle = th.bg
  c.fillRect(0, 0, cv.width, cv.height)
  if (bg && bg !== 'plain'){
    const saved = c.getTransform()
    drawGridInto(c, th, bg, cam, cv.width, cv.height)
    c.setTransform(saved)
  }
  c.save()
  c.translate(cv.width / 2, cv.height / 2)
  c.scale(s, s)
  c.translate(-cam.x, -cam.y)
  for (const el of list) drawEl(c, el, th, s)
  c.restore()
  return cv
}

/* drawBG は背景の塗りからやるので、そのまま呼ぶと書き出しでも同じ見た目になる */
function drawGridInto(c, th, bg, cam, W, H){
  drawBG(c, th, bg, cam, W, H)
}
