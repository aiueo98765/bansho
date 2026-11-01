/* 手ぶれ補正の効きを数で見る。
   node scripts/stab-test.mjs

   式は写していない。スマホ流は js/board.js の padStep をそのまま呼び、
   段の表も同じところから取る。パソコン流（一段・拍で決める）だけは
   式が三行なのでここに置いた。

   まっすぐ引くつもりの線に、生理的な震え（8Hz と 14Hz）を乗せた手を作って、
   引けた線が元のまっすぐからどれだけずれたかを測る。
   ずれが小さいほど効いている。遅れは、ペン先が指の何 px 後ろにいたか。 */

import {PULL, LAG_PAD, padStep} from '../js/board.js'

/* ── 手の動き ── */
function hand({speed, hz, dur = 4.0, amp = 2.0, amp2 = 0.8}){
  const n = Math.max(2, Math.round(dur * hz))
  const out = []
  for (let i = 0; i < n; i++){
    const t = i / hz
    /* 震えは線と直角の向きに出す */
    out.push({
      x: speed * t,
      y: amp * Math.sin(2 * Math.PI * 8 * t) + amp2 * Math.sin(2 * Math.PI * 14 * t + 1.1),
    })
  }
  return out
}

/* ── パソコン流（js/board.js の pullFor と feed と同じ） ── */
function pcRun(pts, level, pen){
  let a = PULL[level] ?? 1
  if (a >= 1) return pts.map(p => ({x: p.x, y: p.y}))
  if (pen) a = Math.min(1, a * 1.7)
  const t = {x: pts[0].x, y: pts[0].y}
  return pts.map(p => {
    t.x += (p.x - t.x) * a
    t.y += (p.y - t.y) * a
    return {x: t.x, y: t.y}
  })
}

/* ── スマホ流（本体の padStep を呼ぶ） ── */
function padRun(pts, level, touch){
  const L = LAG_PAD[level] || 0
  if (!L) return pts.map(p => ({x: p.x, y: p.y}))
  const s = {
    lag: (touch ? L * 1.35 : L) / 2,
    raw: {x: pts[0].x, y: pts[0].y},
    mid: {x: pts[0].x, y: pts[0].y},
    tip: {x: pts[0].x, y: pts[0].y},
    vel: {on: false, x: 0, y: 0},
  }
  return pts.map(p => {
    padStep(s, p.x, p.y, 1)
    return {x: s.tip.x, y: s.tip.y}
  })
}

/* ── ものさし。前半は補正が落ち着くまでなので捨てる ── */
function score(out, pts){
  let s = 0, n = 0
  for (let i = out.length >> 1; i < out.length; i++){ s += out[i].y * out[i].y; n++ }
  const last = out[out.length - 1], raw = pts[pts.length - 1]
  return {rms: Math.sqrt(s / n), lag: Math.hypot(raw.x - last.x, raw.y - last.y)}
}

const NAME = ['切', '弱', '中', '強', '極']
const CASES = [
  {label: 'ゆっくり 60px/s ・ 60Hz（マウス・指）', speed: 60, hz: 60},
  {label: 'ゆっくり 60px/s ・ 240Hz（S ペン）', speed: 60, hz: 240},
  {label: 'ふつう 260px/s ・ 60Hz', speed: 260, hz: 60},
  {label: '速い 900px/s ・ 60Hz', speed: 900, hz: 60},
]

const f = v => v.toFixed(2).padStart(6)
for (const c of CASES){
  const pts = hand(c)
  console.log('\n■ ' + c.label + '　（震えは山から谷まで 5.6px）')
  console.log('  段 │ パソコン(ペン) ずれ / 遅れ │ スマホ(ペン) ずれ / 遅れ │ スマホ(指) ずれ / 遅れ')
  for (let lv = 0; lv <= 4; lv++){
    const pc = score(pcRun(pts, lv, true), pts)
    const pd = score(padRun(pts, lv, false), pts)
    const pf = score(padRun(pts, lv, true), pts)
    console.log(`  ${NAME[lv]}  │  ${f(pc.rms)} / ${f(pc.lag)}` +
      `       │  ${f(pd.rms)} / ${f(pd.lag)}      │  ${f(pf.rms)} / ${f(pf.lag)}`)
  }
}

/* ── 角はどれだけ丸まるか。直角に折る線で、角から一番近づけた距離を見る ── */
{
  const hz = 60, step = 260 / hz, pts = []
  for (let i = 0; i < 90; i++) pts.push({x: i * step, y: 0})
  const cx = 89 * step
  for (let i = 1; i <= 90; i++) pts.push({x: cx, y: i * step})
  const near = out => out.reduce((d, p) => Math.min(d, Math.hypot(p.x - cx, p.y)), Infinity)
  console.log('\n■ 角の丸まり（直角に曲がる・260px/s・60Hz）　角からどれだけ離れたか')
  for (let lv = 1; lv <= 4; lv++){
    console.log(`  ${NAME[lv]}  │  パソコン ${near(pcRun(pts, lv, true)).toFixed(1)}px` +
      `  │  スマホ ${near(padRun(pts, lv, false)).toFixed(1)}px`)
  }
}

console.log('\n補正を強めるほど、ずれは小さく・遅れと角の丸みは大きくなる。' +
  '\nスマホ流は遅れを距離で決めてあるので、報告の速い端末（240Hz）でも効きが落ちない。')
