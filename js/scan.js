/* ═══════════════════════════════════════════════
   scan.js — 紙を写した一枚を、白地に黒字の清書に直す

   色を抜くだけでは足りない。写真というのは、
   ・紙の真ん中より縁のほうが暗い（光の当たりかた）
   ・手やスマホの影が落ちている
   ・斜めから撮れていて、紙が台形になっている
   ・持ち手が傾いていて、行が斜めに流れている
   一律のしきい値で切ると、明るいところの薄い字は飛び、
   影の中は丸ごと真っ黒に潰れる。どちらも読めない。

   so： 紙を見つける → 台形を直す → 明るさを「場所ごとに」見積もる
        → 字だけ残す → 傾きを直す → 余白を詰める → 問題のかたまりを探す

   DOM は触らない。画は {data, width, height}（RGBA）で受け、
   中では明るさ一枚（0..255 の Uint8ClampedArray）で持ち回る。
   node からも同じ関数を回せる（scripts/scan-test.mjs）。
   ═══════════════════════════════════════════════ */

/* ── 下ごしらえ ───────────────────────────── */

/* RGBA → 明るさ。目の感じ方に合わせた重み（BT.601） */
export function toGray(img){
  const d = img.data, w = img.width, h = img.height
  const g = new Uint8ClampedArray(w * h)
  for (let i = 0, j = 0; i < g.length; i++, j += 4){
    g[i] = (77 * d[j] + 150 * d[j + 1] + 29 * d[j + 2]) >> 8
  }
  return {g, w, h}
}

/* 白地に黒字の一枚 → RGBA。
   段を落としておくと PNG がよく縮む（白と黒の続きが長くなるため） */
export function toRGBA(v, w, h, {levels = 6} = {}){
  const out = new Uint8ClampedArray(w * h * 4)
  const q = levels > 1 ? 255 / (levels - 1) : 0
  for (let i = 0, j = 0; i < v.length; i++, j += 4){
    const t = q ? Math.round(Math.round(v[i] / q) * q) : v[i]
    out[j] = out[j + 1] = out[j + 2] = t
    out[j + 3] = 255
  }
  return out
}

/* 明るさの画を縮める（下見用）。箱の平均で間引くので、細い字も残る。
   縮める必要がないときは同じものを返す（中身を書き換えないこと） */
export function shrinkGray(g, w, h, max){
  if (Math.max(w, h) <= max) return {g, w, h}
  const s = max / Math.max(w, h)
  const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s))
  const out = new Uint8ClampedArray(nw * nh)
  const bx = w / nw, by = h / nh
  for (let y = 0; y < nh; y++){
    const y0 = Math.floor(y * by)
    const y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) * by)))
    for (let x = 0; x < nw; x++){
      const x0 = Math.floor(x * bx)
      const x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) * bx)))
      let s2 = 0, n = 0
      for (let yy = y0; yy < y1; yy++){
        const base = yy * w
        for (let xx = x0; xx < x1; xx++){ s2 += g[base + xx]; n++ }
      }
      out[y * nw + x] = s2 / n
    }
  }
  return {g: out, w: nw, h: nh}
}

export function cropGray(v, w, h, box){
  const bw = Math.max(1, Math.min(w - box.x, box.w))
  const bh = Math.max(1, Math.min(h - box.y, box.h))
  const out = new Uint8ClampedArray(bw * bh)
  for (let y = 0; y < bh; y++){
    out.set(v.subarray((box.y + y) * w + box.x, (box.y + y) * w + box.x + bw), y * bw)
  }
  return {g: out, w: bw, h: bh}
}

/* 明るさの山を二つに分ける境目（大津の方法）。紙と机を分けるのに使う */
function otsu(g){
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
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best){ best = between; th = v }
  }
  return th
}

/* 明るさの上から何割めか。紙の地の明るさを、影に引きずられずに取る */
export function percentile(g, p){
  const hist = new Uint32Array(256)
  for (let i = 0; i < g.length; i++) hist[g[i]]++
  let need = g.length * p, acc = 0
  for (let v = 0; v < 256; v++){ acc += hist[v]; if (acc >= need) return v }
  return 255
}

/* つながったかたまりを数える（四近傍）。
   返すのは {id, boxes}。boxes には画素数と外枠、縁に触れた画素数が入る */
function components(on, w, h){
  const id = new Int32Array(w * h).fill(-1)
  const stack = new Int32Array(w * h)
  const boxes = []
  for (let s = 0; s < on.length; s++){
    if (!on[s] || id[s] >= 0) continue
    const k = boxes.length
    let top = 0
    stack[top++] = s
    id[s] = k
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, border = 0
    while (top){
      const p = stack[--top]
      const x = p % w, y = (p - x) / w
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++
      if (x > 0 && on[p - 1] && id[p - 1] < 0){ id[p - 1] = k; stack[top++] = p - 1 }
      if (x < w - 1 && on[p + 1] && id[p + 1] < 0){ id[p + 1] = k; stack[top++] = p + 1 }
      if (y > 0 && on[p - w] && id[p - w] < 0){ id[p - w] = k; stack[top++] = p - w }
      if (y < h - 1 && on[p + w] && id[p + w] < 0){ id[p + w] = k; stack[top++] = p + w }
    }
    boxes.push({n, x0, y0, x1, y1, border})
  }
  return {id, boxes}
}

/* ── 紙を見つける ─────────────────────────── */

/* 紙は「大きくて明るいひとかたまり」。机の上に置いた紙を撮った一枚なら、
   これで四隅が出る。紙が画面いっぱいで縁が写っていないときは、何も返さない
   （そのまま撮れていることが多いので、下手に直すより触らないほうがいい）。 */
export function findPaper(g0, w0, h0){
  const {g, w, h} = shrinkGray(g0, w0, h0, 360)
  const th = otsu(g)
  const on = new Uint8Array(w * h)
  for (let i = 0; i < on.length; i++) on[i] = g[i] > th ? 1 : 0
  const {id, boxes} = components(on, w, h)
  let bi = -1
  for (let i = 0; i < boxes.length; i++) if (bi < 0 || boxes[i].n > boxes[bi].n) bi = i
  if (bi < 0) return null
  const b = boxes[bi]
  const area = w * h
  if (b.n < area * 0.12) return null       /* 小さすぎる。紙ではない */
  if (b.n > area * 0.90) return null       /* 画面いっぱい。紙の縁が写っていない */
  /* 四辺にべったり付いているなら、見えているのは紙の縁ではなく画面の縁。
     それを四隅として引き伸ばすと、歪みを直すどころか増やすことになる */
  if (b.border > (w + h) * 0.55) return null

  /* 四隅は、斜めの向きでいちばん端にある点 */
  let tl = null, tr = null, br = null, bl = null
  let a1 = Infinity, a2 = -Infinity, a3 = -Infinity, a4 = Infinity
  for (let y = b.y0; y <= b.y1; y++){
    const base = y * w
    for (let x = b.x0; x <= b.x1; x++){
      if (id[base + x] !== bi) continue
      const s = x + y, d = x - y
      if (s < a1){ a1 = s; tl = {x, y} }
      if (s > a2){ a2 = s; br = {x, y} }
      if (d > a3){ a3 = d; tr = {x, y} }
      if (d < a4){ a4 = d; bl = {x, y} }
    }
  }
  const quad = [tl, tr, br, bl]
  if (quad.some(p => !p)) return null
  if (!quadOK(quad, w, h)) return null
  /* 四角らしさ。かたまりが台形を埋めていないなら、紙ではない（皿や手など） */
  if (b.n < quadArea(quad) * 0.78) return null

  const kx = w0 / w, ky = h0 / h
  return {
    quad: quad.map(p => ({x: (p.x + 0.5) * kx, y: (p.y + 0.5) * ky})),
    fill: b.n / area,
  }
}

export function quadArea(q){
  let s = 0
  for (let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/* 台形として使えるか。凸で、辺が短すぎず、角がつぶれていないこと */
function quadOK(q, w, h){
  const m = Math.min(w, h)
  for (let i = 0; i < 4; i++){
    const a = q[i], b = q[(i + 1) % 4]
    if (Math.hypot(b.x - a.x, b.y - a.y) < m * 0.15) return false
  }
  let sign = 0
  for (let i = 0; i < 4; i++){
    const p = q[i], c = q[(i + 1) % 4], n = q[(i + 2) % 4]
    const z = (c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x)
    const s = Math.sign(z)
    if (!sign) sign = s
    else if (s !== sign) return false
    const l1 = Math.hypot(p.x - c.x, p.y - c.y), l2 = Math.hypot(n.x - c.x, n.y - c.y)
    const cos = ((p.x - c.x) * (n.x - c.x) + (p.y - c.y) * (n.y - c.y)) / (l1 * l2 || 1)
    if (Math.abs(cos) > 0.64) return false     /* 50度より鋭い / 130度より鈍い角 */
  }
  return true
}

/* ── 台形を直す ───────────────────────────── */

/* 単位の正方形 → 四隅（Heckbert の射影変換）。
   0=左上 1=右上 2=右下 3=左下。出口の画の (u,v) から元の画の位置を引くのに使う */
export function squareToQuad(q){
  const [p0, p1, p2, p3] = q
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9){
    return {
      a: p1.x - p0.x, b: p2.x - p1.x, c: p0.x,
      d: p1.y - p0.y, e: p2.y - p1.y, f: p0.y,
      g: 0, h: 0,
    }
  }
  const dx1 = p1.x - p2.x, dy1 = p1.y - p2.y
  const dx2 = p3.x - p2.x, dy2 = p3.y - p2.y
  const den = dx1 * dy2 - dy1 * dx2
  const g = (sx * dy2 - sy * dx2) / den
  const h = (dx1 * sy - dy1 * sx) / den
  return {
    a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + h * p3.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + h * p3.y, f: p0.y,
    g, h,
  }
}

export function mapQuad(H, u, v){
  const den = H.g * u + H.h * v + 1
  return {x: (H.a * u + H.b * v + H.c) / den, y: (H.d * u + H.e * v + H.f) / den}
}

function sampleGray(g, w, h, x, y, fill){
  if (x < -0.6 || y < -0.6 || x > w - 0.4 || y > h - 0.4) return fill
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = x - x0, fy = y - y0
  const xa = Math.min(w - 1, Math.max(0, x0)), xb = Math.min(w - 1, Math.max(0, x0 + 1))
  const ya = Math.min(h - 1, Math.max(0, y0)), yb = Math.min(h - 1, Math.max(0, y0 + 1))
  const t = g[ya * w + xa] * (1 - fx) + g[ya * w + xb] * fx
  const b = g[yb * w + xa] * (1 - fx) + g[yb * w + xb] * fx
  return t * (1 - fy) + b * fy
}

/* 四隅で囲まれたところを、まっすぐな長方形に引き伸ばす */
export function unwarpGray(g, w, h, quad, outW, outH){
  const H = squareToQuad(quad)
  const out = new Uint8ClampedArray(outW * outH)
  for (let y = 0; y < outH; y++){
    const v = (y + 0.5) / outH
    const row = y * outW
    for (let x = 0; x < outW; x++){
      const u = (x + 0.5) / outW
      const den = H.g * u + H.h * v + 1
      const sx = (H.a * u + H.b * v + H.c) / den
      const sy = (H.d * u + H.e * v + H.f) / den
      out[row + x] = sampleGray(g, w, h, sx - 0.5, sy - 0.5, 255)
    }
  }
  return {g: out, w: outW, h: outH}
}

/* ── 字だけ残す ───────────────────────────── */

/* 明るさを「場所ごとに」見積もって切る（Sauvola）。
   窓の中の平均 m と ばらつき sd を見て、しきい値を
   T = m (1 + k (sd/R - 1)) とする。字のあるところは ばらつき が大きいので
   T は m に近づき、何もないところは T が m より下がって白く残る。
   積算の表（面積和）を作ってあるので、窓がいくら大きくても一画素あたり一定の手間。 */
export function binarize(g, w, h, opt = {}){
  const win = opt.win || Math.max(15, (Math.round(Math.min(w, h) / 18) | 1))
  const k = opt.k != null ? opt.k : 0.2
  const R = opt.R != null ? opt.R : 110
  const flat = opt.flat != null ? opt.flat : 9     /* これより平らなら「地か、ベタ塗り」 */
  const soft = opt.soft != null ? opt.soft : 11    /* しきい値のまわりをぼかす幅 */
  const solid = opt.solid != null ? opt.solid : 46 /* まわりよりこれだけ暗ければベタ塗り */
  const r = win >> 1
  /* 平らなところが「紙の地」なのか「ベタ塗り」なのかは、
     広く見たときの明るさと比べて決める。ここを画全体の明るさで決めると、
     影の落ちた何も書いていないところが丸ごと真っ黒になる（実際になった）。 */
  const rB = Math.max(r * 3, Math.round(Math.min(w, h) / 6))
  const bg = percentile(g, 0.80)                   /* 紙の地の明るさ（覚え書き用） */

  const W1 = w + 1
  const s1 = new Float64Array(W1 * (h + 1))
  const s2 = new Float64Array(W1 * (h + 1))
  for (let y = 0; y < h; y++){
    let a = 0, b = 0
    const row = y * w, o0 = (y + 1) * W1
    for (let x = 0; x < w; x++){
      const v = g[row + x]
      a += v; b += v * v
      s1[o0 + x + 1] = s1[o0 - W1 + x + 1] + a
      s2[o0 + x + 1] = s2[o0 - W1 + x + 1] + b
    }
  }

  const out = new Uint8ClampedArray(w * h)
  let darkN = 0
  for (let y = 0; y < h; y++){
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
    const A0 = y0 * W1, C0 = (y1 + 1) * W1
    const row = y * w
    for (let x = 0; x < w; x++){
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      const cnt = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum = s1[C0 + x1 + 1] - s1[C0 + x0] - s1[A0 + x1 + 1] + s1[A0 + x0]
      const sq = s2[C0 + x1 + 1] - s2[C0 + x0] - s2[A0 + x1 + 1] + s2[A0 + x0]
      const m = sum / cnt
      const sd = Math.sqrt(Math.max(0, sq / cnt - m * m))
      const v = g[row + x]
      let o
      if (sd < flat){
        /* 平らなところ。広く見たときの明るさと比べて、地かベタ塗りかを決める */
        const yb0 = Math.max(0, y - rB), yb1 = Math.min(h - 1, y + rB)
        const xb0 = Math.max(0, x - rB), xb1 = Math.min(w - 1, x + rB)
        const AB = yb0 * W1, CB = (yb1 + 1) * W1
        const mB = (s1[CB + xb1 + 1] - s1[CB + xb0] - s1[AB + xb1 + 1] + s1[AB + xb0]) /
          ((xb1 - xb0 + 1) * (yb1 - yb0 + 1))
        o = m > mB - solid ? (v > m - flat * 2 ? 255 : 0) : 0
      } else {
        const t = m * (1 + k * (sd / R - 1))
        o = 255 * (0.5 + (v - t) / (2 * soft))
      }
      out[row + x] = o
      if (out[row + x] < 128) darkN++
    }
  }
  return {v: out, dark: darkN / (w * h), win, bg}
}

/* ごみを落とす。小さすぎるかたまりは砂粒、縁にべったり付いた大きな黒は
   紙の外（机・影）。小数点や句点は残したいので、下限は控えめにする */
export function despeckle(v, w, h, opt = {}){
  const minA = opt.minArea != null ? opt.minArea
    : Math.max(5, Math.round(Math.pow(Math.max(w, h) / 520, 2) * 2))
  const on = new Uint8Array(w * h)
  for (let i = 0; i < on.length; i++) on[i] = v[i] < 128 ? 1 : 0
  const {id, boxes} = components(on, w, h)
  const area = w * h
  const kill = new Uint8Array(boxes.length)
  let small = 0, edge = 0
  for (let i = 0; i < boxes.length; i++){
    const b = boxes[i]
    if (b.n < minA){ kill[i] = 1; small++; continue }
    if (b.border > (w + h) * 0.12 && b.n > area * 0.04){ kill[i] = 1; edge++ }
  }
  if (small + edge){
    for (let i = 0; i < on.length; i++) if (on[i] && kill[id[i]]) v[i] = 255
  }
  return {removed: small, edges: edge}
}

/* ── 傾きを直す ───────────────────────────── */

/* 字の行がいちばんよくそろう角度を探す。
   行の濃さを横に積んで、そのばらつきがいちばん大きい角度が答え。
   山がはっきりしないとき（図だけの紙）は 0 を返して、何もしない。 */
export function skewAngle(v, w, h, opt = {}){
  const lim = opt.limit != null ? opt.limit : 7      /* 探す範囲（度） */
  const step = opt.step != null ? opt.step : 0.35
  const s = shrinkGray(v, w, h, 560)
  const sw = s.w, sh = s.h, sg = s.g
  const T = Math.ceil(Math.tan(lim * Math.PI / 180) * sw) + 1
  const N = sh + 2 * T + 2
  const rows = new Float64Array(N)
  let best = 0, bestV = -1
  const all = []
  for (let deg = -lim; deg <= lim + 1e-9; deg += step){
    const t = Math.tan(deg * Math.PI / 180)
    rows.fill(0)
    for (let y = 0; y < sh; y++){
      const base = y * sw
      for (let x = 0; x < sw; x++){
        if (sg[base + x] >= 150) continue
        rows[(y + T - t * x) | 0] += 1
      }
    }
    let m = 0
    for (let i = 0; i < N; i++) m += rows[i]
    m /= N
    let q = 0
    for (let i = 0; i < N; i++){ const d = rows[i] - m; q += d * d }
    q /= N
    all.push(q)
    if (q > bestV){ bestV = q; best = deg }
  }
  const med = [...all].sort((a, b) => a - b)[all.length >> 1]
  if (Math.abs(best) < 0.4 || !(bestV > med * 1.22)) return 0
  return best * Math.PI / 180
}

/* 画を回す。外に出たところは紙の色（白）で埋める */
export function rotateGray(v, w, h, ang, fill = 255){
  if (!ang) return {g: v, w, h}
  const c = Math.cos(ang), s = Math.sin(ang)
  const nw = Math.ceil(Math.abs(w * c) + Math.abs(h * s))
  const nh = Math.ceil(Math.abs(w * s) + Math.abs(h * c))
  const out = new Uint8ClampedArray(nw * nh)
  const cx = w / 2, cy = h / 2, ncx = nw / 2, ncy = nh / 2
  for (let y = 0; y < nh; y++){
    const dy = y + 0.5 - ncy
    const row = y * nw
    for (let x = 0; x < nw; x++){
      const dx = x + 0.5 - ncx
      out[row + x] = sampleGray(v, w, h, cx + dx * c + dy * s - 0.5, cy - dx * s + dy * c - 0.5, fill)
    }
  }
  return {g: out, w: nw, h: nh}
}

/* ── 余白と、問題のかたまり ─────────────────── */

/* いちばん外の線を落とす。台形直しをしないと、紙と机の境目が
   ぐるりと黒い線になって残る。外から数えて、黒ばかりの行と列を削る。
   削るのは端のわずかだけなので、中に書いてあるものには触れない */
export function trimEdge(v, w, h, opt = {}){
  const lim = opt.trim != null ? opt.trim : 0.055
  const need = 0.5
  let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1
  const maxX = Math.round(w * lim), maxY = Math.round(h * lim)
  const rowDark = y => {
    let n = 0
    for (let x = x0; x <= x1; x++) if (v[y * w + x] < 128) n++
    return n / Math.max(1, x1 - x0 + 1)
  }
  const colDark = x => {
    let n = 0
    for (let y = y0; y <= y1; y++) if (v[y * w + x] < 128) n++
    return n / Math.max(1, y1 - y0 + 1)
  }
  while (y0 < y1 && y0 < maxY && rowDark(y0) > need) y0++
  while (y1 > y0 && h - 1 - y1 < maxY && rowDark(y1) > need) y1--
  while (x0 < x1 && x0 < maxX && colDark(x0) > need) x0++
  while (x1 > x0 && w - 1 - x1 < maxX && colDark(x1) > need) x1--
  return {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1}
}

export function inkBounds(v, w, h, pad = 0.022){
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++){
    const row = y * w
    for (let x = 0; x < w; x++){
      if (v[row + x] < 150){
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return {x: 0, y: 0, w, h}
  const m = Math.round(Math.min(w, h) * pad)
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m)
  x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m)
  return {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1}
}

/* 問題のかたまりを探す。
   横に伸ばして字を行につなぎ、縦にも少し伸ばして添え字をつなぐ。
   できた行のうち、近いものを束ねる。問題と問題の間は行間より広いので、これで分かれる。 */
export function blocks(v, w, h){
  const s = shrinkGray(v, w, h, 700)
  const sw = s.w, sh = s.h, sg = s.g
  const on = new Uint8Array(sw * sh)
  for (let i = 0; i < on.length; i++) on[i] = sg[i] < 160 ? 1 : 0

  /* 横に伸ばす幅。式は「2x + 1」のように字の間が空くので、
     狭く取ると一行が何本にも割れる */
  const gapX = Math.max(4, Math.round(sw * 0.034))
  const a = new Uint8Array(on)
  for (let y = 0; y < sh; y++){
    const base = y * sw
    let last = -1
    for (let x = 0; x < sw; x++){
      if (!on[base + x]) continue
      if (last >= 0 && x - last <= gapX) for (let i = last + 1; i < x; i++) a[base + i] = 1
      last = x
    }
  }
  const gapY = Math.max(2, Math.round(sh * 0.008))
  const b = new Uint8Array(a)
  for (let x = 0; x < sw; x++){
    let last = -1
    for (let y = 0; y < sh; y++){
      if (!a[y * sw + x]) continue
      if (last >= 0 && y - last <= gapY) for (let i = last + 1; i < y; i++) b[i * sw + x] = 1
      last = y
    }
  }

  const {boxes} = components(b, sw, sh)
  const alive = boxes.filter(o => o.n > sw * sh * 0.00008)
  const wide = o => o.x1 - o.x0 > sw * 0.04 && o.n > sw * sh * 0.0004
  const lines = alive.filter(wide).map(o => ({x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1}))
  /* 問題番号のような小さなしるしは、行として数えると細かく割れてしまう。
     あとで近くのかたまりに足しこむ */
  const marks = alive.filter(o => !wide(o))
  if (!lines.length) return []
  const hs = lines.map(l => l.y1 - l.y0 + 1).sort((p, q) => p - q)
  const lineH = Math.max(4, hs[hs.length >> 1])
  lines.sort((p, q) => p.y0 - q.y0)
  /* 行間は紙によってまるで違う。字の高さで決めずに、
     その紙の「ふつうの行間」を見てから、それより広く空いたところで切る。
     問題と問題の間は、行間より必ず広い */
  const gaps = []
  for (let i = 1; i < lines.length; i++) gaps.push(Math.max(0, lines[i].y0 - lines[i - 1].y1))
  gaps.sort((p, q) => p - q)
  const midGap = gaps.length ? gaps[gaps.length >> 1] : lineH
  const join = Math.max(lineH * 0.9, midGap * 1.6)

  const out = []
  for (const l of lines){
    const last = out[out.length - 1]
    const near = last && l.y0 - last.y1 <= join &&
      Math.min(l.x1, last.x1) - Math.max(l.x0, last.x0) > -sw * 0.08
    if (near){
      last.x0 = Math.min(last.x0, l.x0)
      last.x1 = Math.max(last.x1, l.x1)
      last.y1 = Math.max(last.y1, l.y1)
    } else out.push({...l})
  }

  /* 小さなしるし（番号・記号・図の中の字）を、いちばん近いかたまりに足す */
  for (const m of marks){
    let best = null, bd = Infinity
    for (const o of out){
      const dx = Math.max(0, o.x0 - m.x1, m.x0 - o.x1)
      const dy = Math.max(0, o.y0 - m.y1, m.y0 - o.y1)
      if (dx > lineH * 3 || dy > lineH * 2) continue
      const d = dx + dy
      if (d < bd){ bd = d; best = o }
    }
    if (!best) continue
    best.x0 = Math.min(best.x0, m.x0)
    best.x1 = Math.max(best.x1, m.x1)
    best.y0 = Math.min(best.y0, m.y0)
    best.y1 = Math.max(best.y1, m.y1)
  }

  /* 問題番号は本文より短くて、少し上に離れて立っている。
     そのままだと別のかたまりになるので、下の本文に合わせる */
  for (let i = out.length - 2; i >= 0; i--){
    const a = out[i], b = out[i + 1]
    if (a.x1 - a.x0 > sw * 0.18) continue
    if (b.y0 - a.y1 > lineH * 2.4) continue
    if (b.x0 < a.x0 - lineH) continue
    b.x0 = Math.min(a.x0, b.x0)
    b.x1 = Math.max(a.x1, b.x1)
    b.y0 = Math.min(a.y0, b.y0)
    out.splice(i, 1)
  }

  /* しるしを足したあとで、重なったもの・近すぎるものをまとめ直す。
     重なった枠や、ひとつの問題が二重に出る枠は、押すときに迷う */
  for (let again = true; again;){
    again = false
    for (let i = 0; i < out.length && !again; i++){
      for (let j = i + 1; j < out.length; j++){
        const a = out[i], b = out[j]
        const over = !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0)
        const gapY = Math.max(b.y0 - a.y1, a.y0 - b.y1)
        const sideBy = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > -sw * 0.08
        if (!over && !(gapY <= join && sideBy)) continue
        a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1)
        a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1)
        out.splice(j, 1)
        again = true
        break
      }
    }
  }
  out.sort((p, q) => p.y0 - q.y0)

  const kx = w / sw, ky = h / sh
  const m = Math.round(Math.min(w, h) * 0.014)
  return out.map(o => {
    const x = Math.max(0, Math.round(o.x0 * kx) - m)
    const y = Math.max(0, Math.round(o.y0 * ky) - m)
    return {
      x, y,
      w: Math.min(w, Math.round((o.x1 + 1) * kx) + m) - x,
      h: Math.min(h, Math.round((o.y1 + 1) * ky) + m) - y,
    }
  }).filter(o => o.w > w * 0.08 && o.h > h * 0.018).slice(0, 10)
}

/* ── 通し ─────────────────────────────────── */

/* 写した一枚 → 白地に黒字。
   opt.quad に四隅を渡せば探さずにそれを使う。null を渡せば台形直しをしない。
   返すのは明るさ一枚（g, w, h）。板に置くときは toRGBA で色にする。 */
export function scan(img, opt = {}){
  const long = opt.long || 1500
  const t0 = Date.now()
  const stats = {}
  let {g, w, h} = toGray(img)
  stats.src = {w, h}

  let quad = null
  if (opt.quad === null) quad = null
  else if (opt.quad) quad = opt.quad
  else {
    quad = findPaper(g, w, h)?.quad || null
    /* 自分で見つけた四隅は、ほんの少し内側へ寄せる。
       きっかり縁に乗せると、机や影が帯になって入ってくる */
    if (quad){
      const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4
      const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4
      const t = opt.inset != null ? opt.inset : 0.012
      quad = quad.map(p => ({x: p.x + (cx - p.x) * t, y: p.y + (cy - p.y) * t}))
    }
  }
  stats.found = !!quad

  if (quad){
    const d = (a, b) => Math.hypot(quad[b].x - quad[a].x, quad[b].y - quad[a].y)
    let ow = Math.max(d(0, 1), d(3, 2)), oh = Math.max(d(0, 3), d(1, 2))
    const k = long / Math.max(ow, oh, 1)
    ow = Math.max(8, Math.round(ow * k))
    oh = Math.max(8, Math.round(oh * k))
    const u = unwarpGray(g, w, h, quad, ow, oh)
    g = u.g; w = u.w; h = u.h
  } else {
    const s = shrinkGray(g, w, h, long)
    g = s.g; w = s.w; h = s.h
  }

  /* 地が暗ければ黒板を写した一枚。先に白黒を入れ替えておけば、
     あとは紙と同じ道を通って「白地に黒字」で出てくる */
  stats.bg = percentile(g, 0.80)
  if (opt.autoInvert !== false && stats.bg < 105){
    for (let i = 0; i < g.length; i++) g[i] = 255 - g[i]
    stats.inverted = true
  }
  const b = binarize(g, w, h, opt)
  stats.dark = b.dark
  let v = b.v
  const sp = despeckle(v, w, h, opt)
  stats.speckles = sp.removed
  stats.edges = sp.edges

  if (opt.trim !== false){
    const t = trimEdge(v, w, h, opt)
    if (t.w !== w || t.h !== h){
      const c = cropGray(v, w, h, t)
      v = c.g; w = c.w; h = c.h
      stats.trimmed = true
    }
  }

  const ang = opt.skew === false ? 0 : skewAngle(v, w, h)
  stats.skew = ang * 180 / Math.PI
  if (ang){
    const r = rotateGray(v, w, h, -ang)
    v = r.g; w = r.w; h = r.h
  }

  if (opt.crop !== false){
    const box = inkBounds(v, w, h)
    if (box.w !== w || box.h !== h){
      const c = cropGray(v, w, h, box)
      v = c.g; w = c.w; h = c.h
    }
  }

  stats.ms = Date.now() - t0
  return {g: v, w, h, quad, blocks: opt.blocks === false ? [] : blocks(v, w, h), stats}
}
