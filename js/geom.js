/* ═══════════════════════════════════════════════
   geom.js — 要素の寸法と当たり判定
   選択・移動・拡大はここの外寸だけを見て動く。描画側とは分けてある。
   ═══════════════════════════════════════════════ */

import {measureMath} from './math.js'

export const TEXT_FONT = '"Hiragino Kaku Gothic ProN","Yu Gothic UI","Segoe UI",system-ui,sans-serif'
export const LINE_H = 1.38

let MC = null
export function measureText(s, size, font = TEXT_FONT){
  if (!MC) MC = document.createElement('canvas').getContext('2d')
  MC.font = size + 'px ' + font
  const lines = String(s).split('\n')
  let w = 0
  for (const l of lines) w = Math.max(w, MC.measureText(l || ' ').width)
  return {w, h: lines.length * size * LINE_H, lines}
}

export function bbox(el){
  switch (el.type){
    case 'path': {
      const p = el.pts
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < p.length; i += 3){
        if (p[i] < x0) x0 = p[i]
        if (p[i] > x1) x1 = p[i]
        if (p[i + 1] < y0) y0 = p[i + 1]
        if (p[i + 1] > y1) y1 = p[i + 1]
      }
      if (!Number.isFinite(x0)) return {x: 0, y: 0, w: 0, h: 0}
      const r = (el.sz || 3) * (el.mode === 'marker' ? 2.2 : 0.8)
      return {x: x0 - r, y: y0 - r, w: x1 - x0 + r * 2, h: y1 - y0 + r * 2}
    }
    case 'line': {
      const r = (el.sz || 3) * 0.8 + 2
      return {
        x: Math.min(el.x1, el.x2) - r, y: Math.min(el.y1, el.y2) - r,
        w: Math.abs(el.x2 - el.x1) + r * 2, h: Math.abs(el.y2 - el.y1) + r * 2,
      }
    }
    case 'rect': case 'ell': case 'tri': case 'graph': case 'img': {
      const r = el.type === 'img' || el.type === 'graph' ? 0 : (el.sz || 3) * 0.6
      const x = Math.min(el.x, el.x + el.w), y = Math.min(el.y, el.y + el.h)
      return {x: x - r, y: y - r, w: Math.abs(el.w) + r * 2, h: Math.abs(el.h) + r * 2}
    }
    case 'text': {
      const m = measureText(el.s, el.sz)
      return {x: el.x, y: el.y, w: Math.max(m.w, el.sz * 0.6), h: m.h}
    }
    case 'math': {
      const m = measureMath(el.s, el.sz)
      return {x: el.x, y: el.y, w: m.w, h: m.h}
    }
  }
  return {x: el.x || 0, y: el.y || 0, w: el.w || 0, h: el.h || 0}
}

export function bboxAll(list){
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const el of list){
    const b = bbox(el)
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  if (!Number.isFinite(x0)) return null
  return {x: x0, y: y0, w: x1 - x0, h: y1 - y0}
}

function segDist(px, py, ax, ay, bx, by){
  const vx = bx - ax, vy = by - ay
  const L = vx * vx + vy * vy
  let t = L ? ((px - ax) * vx + (py - ay) * vy) / L : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const dx = px - (ax + vx * t), dy = py - (ay + vy * t)
  return Math.hypot(dx, dy)
}

/* 線の近さを返す（当たりなら距離、外れなら Infinity） */
export function nearest(el, x, y, tol){
  switch (el.type){
    case 'path': {
      const p = el.pts
      const r = tol + (el.sz || 3) * (el.mode === 'marker' ? 1.6 : 0.6)
      let best = Infinity
      if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= r ? 0 : Infinity
      for (let i = 0; i + 5 < p.length; i += 3){
        const d = segDist(x, y, p[i], p[i + 1], p[i + 3], p[i + 4])
        if (d < best) best = d
        if (best <= r) return best
      }
      return best <= r ? best : Infinity
    }
    case 'line': {
      const r = tol + (el.sz || 3) * 0.6
      const d = segDist(x, y, el.x1, el.y1, el.x2, el.y2)
      return d <= r ? d : Infinity
    }
    case 'rect': case 'tri': {
      const b = bbox(el)
      if (el.fill) return inside(b, x, y) ? 0 : Infinity
      const r = tol + (el.sz || 3) * 0.6
      const d = Math.min(
        segDist(x, y, b.x, b.y, b.x + b.w, b.y),
        segDist(x, y, b.x + b.w, b.y, b.x + b.w, b.y + b.h),
        segDist(x, y, b.x + b.w, b.y + b.h, b.x, b.y + b.h),
        segDist(x, y, b.x, b.y + b.h, b.x, b.y),
      )
      return d <= r ? d : Infinity
    }
    case 'ell': {
      const b = bbox(el)
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2
      const rx = Math.max(b.w / 2, 1), ry = Math.max(b.h / 2, 1)
      const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
      if (el.fill) return q <= 1 ? 0 : Infinity
      const r = (tol + (el.sz || 3) * 0.6) / Math.min(rx, ry)
      const dq = Math.abs(Math.sqrt(q) - 1)
      return dq <= r * 1.6 ? dq : Infinity
    }
    default: {
      const b = bbox(el)
      return inside(b, x, y) ? 0 : Infinity
    }
  }
}

export function inside(b, x, y){
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
}

export function overlaps(a, b){
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/* 上に乗っているものを拾う。後から書いたものが優先 */
export function pick(list, x, y, tol){
  for (let i = list.length - 1; i >= 0; i--){
    if (nearest(list[i], x, y, tol) < Infinity) return list[i]
  }
  return null
}

export function translate(el, dx, dy){
  const o = {...el}
  if (el.type === 'path'){
    const p = el.pts.slice()
    for (let i = 0; i < p.length; i += 3){ p[i] += dx; p[i + 1] += dy }
    o.pts = p
  } else if (el.type === 'line'){
    o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy
  } else {
    o.x += dx; o.y += dy
  }
  return o
}

/* 原点 (ox,oy) を固定して sx,sy 倍する。線の太さと字の大きさも一緒に動かす */
export function scaleEl(el, ox, oy, sx, sy){
  const o = {...el}
  const k = Math.sqrt(Math.abs(sx * sy)) || 1
  const fx = v => ox + (v - ox) * sx
  const fy = v => oy + (v - oy) * sy
  if (el.type === 'path'){
    const p = el.pts.slice()
    for (let i = 0; i < p.length; i += 3){ p[i] = fx(p[i]); p[i + 1] = fy(p[i + 1]) }
    o.pts = p
    o.sz = Math.max(0.5, (el.sz || 3) * k)
  } else if (el.type === 'line'){
    o.x1 = fx(el.x1); o.y1 = fy(el.y1); o.x2 = fx(el.x2); o.y2 = fy(el.y2)
    o.sz = Math.max(0.5, (el.sz || 3) * k)
  } else if (el.type === 'text' || el.type === 'math'){
    o.x = fx(el.x); o.y = fy(el.y)
    o.sz = Math.max(6, (el.sz || 24) * k)
  } else {
    const x2 = fx(el.x + el.w), y2 = fy(el.y + el.h)
    o.x = fx(el.x); o.y = fy(el.y)
    o.w = x2 - o.x; o.h = y2 - o.y
    if (el.sz) o.sz = Math.max(0.5, el.sz * k)
  }
  return o
}

/* 消しゴムが線の途中をなぞったとき、その部分だけ抜いて残りを返す */
export function splitPath(el, cx, cy, r){
  const p = el.pts
  const keep = []
  let run = []
  const rr = r + (el.sz || 3) * 0.4
  for (let i = 0; i < p.length; i += 3){
    const hit = Math.hypot(p[i] - cx, p[i + 1] - cy) <= rr
    if (hit){
      if (run.length >= 6) keep.push(run)
      run = []
    } else {
      run.push(p[i], p[i + 1], p[i + 2])
    }
  }
  if (run.length >= 6) keep.push(run)
  if (keep.length === 1 && keep[0].length === p.length) return null   /* 触っていない */
  return keep
}
