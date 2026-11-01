/* 紙の清書（js/scan.js）の効きを数で見る。
   node scripts/scan-test.mjs

   式は写していない。本体の scan をそのまま呼ぶ。
   写真を合成して（紙・机・斜め・影・むらのある光・ぼけ・ざらつき）、
   出てきた清書を、元の紙の「字の形」と比べる。

   比べる相手は「一律のしきい値」。台形直しまでは同じことをして、
   明るさの切り分けだけを一律にする。影の下がどうなるかが数で出る。 */

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import {scan, skewAngle, findPaper, squareToQuad, mapQuad, inkBounds, cropGray,
  toGray, unwarpGray, shrinkGray} from '../js/scan.js'

/* ── でたらめの種（毎回同じ写真が出るように） ── */
function rng(seed){
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/* ── 紙を作る（白地に黒字。字の形も覚えておく） ── */
function makePage(){
  const w = 1000, h = 1400
  const g = new Uint8ClampedArray(w * h).fill(246)
  const ink = new Uint8Array(w * h)
  const R = rng(7)
  const put = (x, y, bw, bh, tone = 26) => {
    for (let yy = Math.max(0, y | 0); yy < Math.min(h, (y + bh) | 0); yy++){
      for (let xx = Math.max(0, x | 0); xx < Math.min(w, (x + bw) | 0); xx++){
        g[yy * w + xx] = tone
        ink[yy * w + xx] = 1
      }
    }
  }
  /* 問題番号 */
  put(70, 70, 14, 36); put(70, 70, 40, 12); put(70, 94, 40, 12)
  /* 本文。行の中は字の幅と隙間をばらす */
  const lines = 11
  for (let i = 0; i < lines; i++){
    const y = 140 + i * 84
    let x = 90 + (i === 0 ? 60 : 0)
    const end = 910 - (i === lines - 1 ? 300 : 0)
    while (x < end){
      const cw = 14 + Math.round(R() * 20)
      if (x + cw > end) break
      put(x, y + Math.round(R() * 3), cw, 28)
      x += cw + 8 + Math.round(R() * 10)
    }
  }
  /* 小数点・句点（4px の点。砂粒と間違えて落とされると困る） */
  const dots = []
  for (let i = 0; i < 6; i++){
    const x = 200 + i * 120, y = 1090
    put(x, y, 5, 5)
    dots.push({x: x + 2, y: y + 2})
  }
  /* 図。円と直線 */
  const cx = 500, cy = 1240, r = 95
  for (let a = 0; a < 6.284; a += 0.004){
    put(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4, 4)
  }
  for (let t = 0; t <= 1; t += 0.001){
    put(cx - r + t * 2 * r, cy - r + t * 2 * r, 4, 4)
    put(cx - r + t * 2 * r, cy, 4, 3)
  }
  return {g, w, h, ink, dots, cover: ink.reduce((a, b) => a + b, 0) / (w * h)}
}

/* ── 三行三列の逆行列（写真 → 単位正方形） ── */
function inv3(H){
  const m = [H.a, H.b, H.c, H.d, H.e, H.f, H.g, H.h, 1]
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  const o = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ]
  return (x, y) => {
    const den = o[6] * x + o[7] * y + o[8]
    return {u: (o[0] * x + o[1] * y + o[2]) / den, v: (o[3] * x + o[4] * y + o[5]) / den}
  }
}

function pick(g, w, h, x, y, out){
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return out
  const x0 = x | 0, y0 = y | 0
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const t = g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx
  const b = g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx
  return t * (1 - fy) + b * fy
}

/* ── 写真を合成する ── */
function shoot(page, {quad, W = 1600, H = 1200, desk = 56, shade = 0.42, noise = 4, blur = true, invert = false}){
  const back = inv3(squareToQuad(quad))
  const d = new Uint8ClampedArray(W * H * 4)
  const R = rng(99)
  const raw = new Float64Array(W * H)
  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      const {u, v} = back(x + 0.5, y + 0.5)
      let t
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1){
        t = pick(page.g, page.w, page.h, u * page.w - 0.5, v * page.h - 0.5, 246)
        if (invert) t = 255 - t
      } else {
        t = desk + (R() - 0.5) * 16
      }
      /* 光のむら：真ん中が明るく、縁が落ちる */
      const nx = (x / W - 0.5), ny = (y / H - 0.5)
      let L = 1 - 0.30 * (nx * nx * 2.4 + ny * ny * 1.6)
      /* 影：斜めの帯。ここが一律のしきい値を殺す */
      const s = (x / W) * 0.75 + (y / H) * 0.55
      if (s > 0.86) L *= 1 - shade * Math.min(1, (s - 0.86) / 0.3)
      raw[y * W + x] = t * L
    }
  }
  /* ぼけ（三画素の箱を縦横に）とざらつき */
  const tmp = new Float64Array(W * H)
  if (blur){
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const a = raw[y * W + Math.max(0, x - 1)], b = raw[y * W + x], c = raw[y * W + Math.min(W - 1, x + 1)]
      tmp[y * W + x] = (a + b + c) / 3
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const a = tmp[Math.max(0, y - 1) * W + x], b = tmp[y * W + x], c = tmp[Math.min(H - 1, y + 1) * W + x]
      raw[y * W + x] = (a + b + c) / 3
    }
  }
  for (let i = 0, j = 0; i < W * H; i++, j += 4){
    const v = Math.max(0, Math.min(255, raw[i] + (R() - 0.5) * noise * 2))
    d[j] = d[j + 1] = d[j + 2] = v
    d[j + 3] = 255
  }
  return {data: d, width: W, height: H}
}

/* ── ものさし ── */

/* 白さ：まっ白（250以上）の割合 */
function whiteness(v){
  let n = 0
  for (let i = 0; i < v.length; i++) if (v[i] >= 250) n++
  return n / v.length
}

/* 字の一致：どちらも「字のところ」を外枠でそろえてから重ねる */
function iou(out, ow, oh, page){
  const tb = inkBounds(page.ink.map ? page.ink : page.ink, page.w, page.h, 0)
  /* 元の紙の字の外枠 */
  let x0 = page.w, y0 = page.h, x1 = -1, y1 = -1
  for (let y = 0; y < page.h; y++) for (let x = 0; x < page.w; x++){
    if (page.ink[y * page.w + x]){
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
    }
  }
  const tw = x1 - x0 + 1, th = y1 - y0 + 1
  /* 清書のほうの字の外枠 */
  const ob = inkBounds(out, ow, oh, 0)
  let both = 0, either = 0
  for (let y = 0; y < th; y++){
    for (let x = 0; x < tw; x++){
      const a = !!page.ink[(y0 + y) * page.w + (x0 + x)]
      const sx = ob.x + (x + 0.5) * ob.w / tw - 0.5
      const sy = ob.y + (y + 0.5) * ob.h / th - 0.5
      const b = pick(out, ow, oh, sx, sy, 255) < 150
      if (a || b) either++
      if (a && b) both++
    }
  }
  void tb
  return either ? both / either : 0
}

/* 砂粒：小さすぎる黒のかたまりの数 */
function speckles(v, w, h){
  const on = new Uint8Array(w * h)
  for (let i = 0; i < on.length; i++) on[i] = v[i] < 128 ? 1 : 0
  const seen = new Int32Array(w * h).fill(-1)
  const st = new Int32Array(w * h)
  let n = 0
  for (let s = 0; s < on.length; s++){
    if (!on[s] || seen[s] >= 0) continue
    let top = 0, cnt = 0
    st[top++] = s; seen[s] = 1
    while (top){
      const p = st[--top]
      const x = p % w, y = (p - x) / w
      cnt++
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]){
        if (q >= 0 && on[q] && seen[q] < 0){ seen[q] = 1; st[top++] = q }
      }
    }
    if (cnt <= 6) n++
  }
  return n
}

/* 小数点が残っているか。元の点の場所を清書の上に写して、黒いかを見る */
function dotsAlive(out, ow, oh, page){
  let x0 = page.w, y0 = page.h, x1 = -1, y1 = -1
  for (let y = 0; y < page.h; y++) for (let x = 0; x < page.w; x++){
    if (page.ink[y * page.w + x]){
      if (x < x0) x0 = x; if (x > x1) x1 = x
      if (y < y0) y0 = y; if (y > y1) y1 = y
    }
  }
  const tw = x1 - x0 + 1, th = y1 - y0 + 1
  const ob = inkBounds(out, ow, oh, 0)
  let alive = 0
  for (const dt of page.dots){
    const sx = ob.x + (dt.x - x0 + 0.5) * ob.w / tw - 0.5
    const sy = ob.y + (dt.y - y0 + 0.5) * ob.h / th - 0.5
    let dark = false
    for (let j = -2; j <= 2 && !dark; j++) for (let i = -2; i <= 2 && !dark; i++){
      if (pick(out, ow, oh, sx + i, sy + j, 255) < 160) dark = true
    }
    if (dark) alive++
  }
  return alive
}

/* PNG にする。送るときの重さを見るのと、目で見たいときの書き出しに使う
   （本体には積まない。ここだけの道具） */
const crc32 = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++){
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return b => {
    let c = -1
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function png(v, w, h, levels = 6){
  const q = levels > 1 ? 255 / (levels - 1) : 0
  const rows = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++){
    rows[y * (w + 1)] = 0
    for (let x = 0; x < w; x++){
      const t = q ? Math.round(Math.round(v[y * w + x] / q) * q) : v[y * w + x]
      rows[y * (w + 1) + 1 + x] = t
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const pngSize = (v, w, h, levels = 6) => png(v, w, h, levels).length

/* --png <置き場> を付けると、写真と清書を目で見られるように書き出す */
const OUT = (() => {
  const i = process.argv.indexOf('--png')
  return i > 0 ? process.argv[i + 1] || '.' : null
})()
function dump(name, v, w, h){
  if (!OUT) return
  fs.mkdirSync(OUT, {recursive: true})
  fs.writeFileSync(path.join(OUT, name + '.png'), png(v, w, h, 0))
}

/* ── 一律のしきい値（比べる相手） ── */
function flatScan(img, quad, long = 1500){
  /* 台形直しまでは本体と同じ道を通し、明るさの切り分けだけ一律にする */
  let {g, w, h} = toGray(img)
  if (quad){
    const d = (a, b) => Math.hypot(quad[b].x - quad[a].x, quad[b].y - quad[a].y)
    let ow = Math.max(d(0, 1), d(3, 2)), oh = Math.max(d(0, 3), d(1, 2))
    const k = long / Math.max(ow, oh, 1)
    const u = unwarpGray(g, w, h, quad, Math.round(ow * k), Math.round(oh * k))
    g = u.g; w = u.w; h = u.h
  } else {
    const s = shrinkGray(g, w, h, long)
    g = s.g; w = s.w; h = s.h
  }
  /* 一律：画全体の大津 */
  const hist = new Float64Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let wB = 0, sumB = 0, best = -1, th = 128
  for (let v = 0; v < 256; v++){
    wB += hist[v]
    if (!wB) continue
    const wF = g.length - wB
    if (!wF) break
    sumB += v * hist[v]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const bt = wB * wF * (mB - mF) * (mB - mF)
    if (bt > best){ best = bt; th = v }
  }
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < out.length; i++) out[i] = g[i] > th ? 255 : 0
  return {g: out, w, h}
}

/* ── 回す ── */

const page = makePage()
const fmt = (v, n = 1) => v.toFixed(n).padStart(n === 0 ? 3 : n + 3)
const pct = v => (v * 100).toFixed(1).padStart(5) + '%'

/* 単位正方形 → 四隅の式が合っているか、先に確かめる */
{
  const q = [{x: 11, y: 7}, {x: 213, y: 29}, {x: 197, y: 161}, {x: 23, y: 143}]
  const H = squareToQuad(q)
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
  let err = 0
  for (let i = 0; i < 4; i++){
    const p = mapQuad(H, uv[i][0], uv[i][1])
    err = Math.max(err, Math.hypot(p.x - q[i].x, p.y - q[i].y))
  }
  console.log('■ 台形の式の確かめ　四隅のずれ ' + err.toExponential(1) + ' px' + (err < 1e-9 ? '　○' : '　×'))
}

/* 四隅を回す道具（傾けて持った一枚を作るのに使う） */
function turn(q, deg, cx = 800, cy = 600){
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return q.map(p => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * s,
    y: cy + (p.x - cx) * s + (p.y - cy) * c,
  }))
}

const CASES = [
  {
    name: '机の上の紙・斜めから・影つき',
    quad: [{x: 430, y: 95}, {x: 1105, y: 160}, {x: 1180, y: 1090}, {x: 360, y: 1020}],
  },
  {
    name: '紙が画面いっぱい（縁が写らない）・影つき',
    quad: [{x: 0, y: 0}, {x: 1600, y: 0}, {x: 1600, y: 1200}, {x: 0, y: 1200}],
  },
  {
    name: '3.2度 傾けて持った（枠は使わない）',
    quad: turn([{x: 490, y: 55}, {x: 1110, y: 55}, {x: 1110, y: 1145}, {x: 490, y: 1145}], 3.2),
    opt: {quad: null},
    only: 'skew',
  },
  {
    name: '黒板を写した（暗い地に白い字）',
    quad: [{x: 0, y: 0}, {x: 1600, y: 0}, {x: 1600, y: 1200}, {x: 0, y: 1200}],
    invert: true, desk: 24, shade: 0.3,
  },
]

let ci = 0
for (const c of CASES){
  const img = shoot(page, {quad: c.quad, invert: c.invert, desk: c.desk, shade: c.shade})
  const r = scan(img, c.opt || {})
  ci++
  dump('shot' + ci, toGray(img).g, img.width, img.height)
  dump('scan' + ci, r.g, r.w, r.h)
  const fl = flatScan(img, c.quad)
  const flCrop = (() => {
    const b = inkBounds(fl.g, fl.w, fl.h)
    const cg = cropGray(fl.g, fl.w, fl.h, b)
    return cg
  })()

  console.log('\n■ ' + c.name)
  const fp = c.opt && c.opt.quad === null ? null : findPaper(toGray(img).g, img.width, img.height)
  let cErr = null
  if (fp){
    cErr = 0
    for (let i = 0; i < 4; i++){
      cErr = Math.max(cErr, Math.hypot(fp.quad[i].x - c.quad[i].x, fp.quad[i].y - c.quad[i].y))
    }
  }
  console.log('  紙の四隅　　' + (r.quad
    ? '見つけた（本当の角とのずれ 最大 ' + fmt(cErr, 1) + ' px。使うときは 1.2% 内側に寄せる）'
    : '見つからず（そのまま使う）'))
  console.log('  出てきた大きさ ' + r.w + '×' + r.h + '　白地に黒字へ入れ替え ' + (r.stats.inverted ? 'した' : 'していない'))
  const skip = c.only === 'skew'       /* 端が切れる撮りかた。重ねて比べても意味がない */
  console.log('  ┌ ものさし ──────── 清書 ──── 一律のしきい値')
  console.log('  │ 背景の白さ　　　' + pct(whiteness(r.g)) + '　　' + pct(whiteness(flCrop.g)))
  console.log('  │ 字の一致　　　　' + (skip ? '  ——　　　  ——' :
    pct(iou(r.g, r.w, r.h, page)) + '　　' + pct(iou(flCrop.g, flCrop.w, flCrop.h, page))))
  console.log('  │ 小数点の残り　　' + (skip ? '  ——　　　  ——' :
    dotsAlive(r.g, r.w, r.h, page) + ' / 6　　　　' + dotsAlive(flCrop.g, flCrop.w, flCrop.h, page) + ' / 6'))
  console.log('  │ 砂粒の数　　　　' + String(speckles(r.g, r.w, r.h)).padStart(5) + '　　' + String(speckles(flCrop.g, flCrop.w, flCrop.h)).padStart(5))
  console.log('  └ 傾き　　　　　　見つけた ' + fmt(r.stats.skew, 2) + '度　→　直したあと ' + fmt(skewAngle(r.g, r.w, r.h) * 180 / Math.PI, 2) + '度')
  console.log('  送るときの重さ ' + (pngSize(r.g, r.w, r.h) / 1024).toFixed(0) + ' KB（PNG・段を6つに落として）' +
    '　／ 段を落とさないと ' + (pngSize(r.g, r.w, r.h, 0) / 1024).toFixed(0) + ' KB')
  console.log('  かかった時間 ' + r.stats.ms + ' ms　（' + img.width + '×' + img.height + ' の写真から）')
  console.log('  問題のかたまり ' + r.blocks.length + ' つ')
}

console.log('\n一律のしきい値だと、影の下の字が潰れて「背景の白さ」が落ち、字の一致も下がる。' +
  '\n明るさを場所ごとに見積もれば、同じ写真から白地に黒字が出る。')
