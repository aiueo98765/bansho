/* ═══════════════════════════════════════════════
   ui.js — 道具箱と窓
   部品は全部ここで組む。板そのもの（board.js）とは線を引いてある。
   ═══════════════════════════════════════════════ */

import {typeset} from './math.js'
import {THEMES, drawEl} from './render.js'

export const INK = {
  light: ['#1b1f27', '#d92d20', '#1d4ed8', '#15803d', '#ea580c', '#7e22ce', '#0e7490', '#9d174d'],
  dark:  ['#f4f2e9', '#ff8a8a', '#8fc3ff', '#8de8a8', '#ffc078', '#d9b3ff', '#7fe3f0', '#ff9ec7'],
}
export const MARKER = ['#ffd84d', '#9ef09a', '#ff9ec7', '#8fd4ff', '#ffb067', '#c9a9ff']
export const SIZES = [1.6, 3.2, 6, 11]
export const ERASERS = [10, 20, 38, 64]

const I = {
  select: '<path d="M5 3l14 8-6 1.2L10.5 19z"/>',
  pen: '<path d="M4 20l3.2-.7L19 7.5a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L3.7 16.3 3 19.6z"/><path d="M14.5 6.2l3.3 3.3" stroke-width="1.3"/>',
  marker: '<path d="M6 19h12v2H6z"/><path d="M8.2 16.8l-1-4.3L16 4.3a1.7 1.7 0 0 1 2.4 0l1.3 1.3a1.7 1.7 0 0 1 0 2.4l-8.2 8.8z"/>',
  eraser: '<path d="M9 18.5H19.5M6.6 16.2l-2-2a1.6 1.6 0 0 1 0-2.3l7.6-7.6a1.6 1.6 0 0 1 2.3 0l4.4 4.4a1.6 1.6 0 0 1 0 2.3l-5.9 5.9H8.9z"/>',
  line: '<path d="M4.5 19.5L19.5 4.5" stroke-width="1.9"/>',
  arrow: '<path d="M4.5 19.5L19 5m0 0h-6m6 0v6" stroke-width="1.7"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ell: '<ellipse cx="12" cy="12" rx="8.2" ry="6.4"/>',
  tri: '<path d="M12 5l7.5 14H4.5z"/>',
  text: '<path d="M5 5h14M12 5v14M9 19h6" stroke-width="1.7"/>',
  math: '<path d="M4 7h7l3.5 11 2-7H20" stroke-width="1.6"/><path d="M5.5 12.5h4" stroke-width="1.3"/>',
  graph: '<path d="M4 20V4M4 20h16" stroke-width="1.6"/><path d="M5.5 16.5c3.5 0 4-9 7-9s3 5 6 5" stroke-width="1.6"/>',
  laser: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" stroke-width="1.4"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.8" cy="10" r="1.6"/><path d="M4.5 17l4.6-4.3 3.4 3 2.6-2.3 4.4 3.9"/>',
  undo: '<path d="M8 7H14.5a4.5 4.5 0 0 1 0 9H7" stroke-width="1.8"/><path d="M10.6 3.8L7 7.2l3.6 3.4" stroke-width="1.8"/>',
  redo: '<path d="M16 7H9.5a4.5 4.5 0 0 0 0 9H17" stroke-width="1.8"/><path d="M13.4 3.8L17 7.2l-3.6 3.4" stroke-width="1.8"/>',
  trash: '<path d="M4.5 7h15M9 7V5h6v2M6.5 7l1 12.5h9L17.5 7"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-width="1.9"/>',
  minus: '<path d="M5 12h14" stroke-width="1.9"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke-width="1.7"/>',
  home: '<path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5"/>',
  sync: '<path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L20 9M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4 15" stroke-width="1.6"/><path d="M20 4.5V9h-4.5M4 19.5V15h4.5" stroke-width="1.6"/>',
  down: '<path d="M12 4v11m0 0l-4.2-4.2M12 15l4.2-4.2M4.5 19.5h15" stroke-width="1.7"/>',
  share: '<circle cx="17.5" cy="6" r="2.6"/><circle cx="6.5" cy="12" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/><path d="M15.2 7.3L8.8 10.7M8.8 13.3l6.4 3.4"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" stroke-width="1"/>',
  page: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke-width="1.8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7" stroke-width="2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5H6.5a2 2 0 0 0-2 2v9"/>',
}

export function icon(name, size = 20){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`
}

export function $(sel, root = document){ return root.querySelector(sel) }
export function $$(sel, root = document){ return [...root.querySelectorAll(sel)] }

export function el(tag, attrs = {}, kids = []){
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)){
    if (k === 'class') n.className = v
    else if (k === 'html') n.innerHTML = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else if (v != null) n.setAttribute(k, v)
  }
  for (const k of [].concat(kids)) if (k) n.append(k)
  return n
}

/* ── 道具箱 ───────────────────────────────── */

const TOOLS = [
  {t: 'select', i: 'select', k: 'V', label: '選ぶ'},
  {t: 'pen', i: 'pen', k: 'P', label: 'ペン'},
  {t: 'marker', i: 'marker', k: 'M', label: '蛍光ペン'},
  {t: 'eraser', i: 'eraser', k: 'E', label: '消しゴム'},
  {sep: 1},
  {t: 'line', i: 'line', k: 'L', label: '直線・矢印'},
  {t: 'rect', i: 'rect', k: 'R', label: '四角'},
  {t: 'ell', i: 'ell', k: 'O', label: '円・楕円'},
  {t: 'tri', i: 'tri', k: 'Y', label: '三角'},
  {sep: 1},
  {t: 'text', i: 'text', k: 'T', label: '文字'},
  {t: 'math', i: 'math', k: 'F', label: '数式'},
  {t: 'graph', i: 'graph', k: 'G', label: '関数のグラフ'},
  {sep: 1},
  {t: 'laser', i: 'laser', k: 'K', label: '指し棒'},
]

export function buildTools(host, onPick){
  host.innerHTML = ''
  for (const t of TOOLS){
    if (t.sep){ host.append(el('div', {class: 'sep'})); continue }
    const b = el('button', {
      class: 'tool', 'data-tool': t.t, type: 'button',
      title: `${t.label}  (${t.k})`, 'aria-label': t.label,
      html: icon(t.i, 21),
      onclick: () => onPick(t.t),
    })
    host.append(b)
  }
}

export function markTool(host, tool){
  for (const b of $$('.tool', host)) b.classList.toggle('on', b.dataset.tool === tool)
}

/* ── 道具の設定 ───────────────────────────── */

export function buildOpts(host, st, api){
  host.innerHTML = ''
  const theme = THEMES[st.theme]
  const tool = st.tool
  const add = n => host.append(n)

  const swatches = (list, cur, pick) => {
    const row = el('div', {class: 'swatches'})
    for (const c of list){
      row.append(el('button', {
        class: 'sw' + (c.toLowerCase() === String(cur).toLowerCase() ? ' on' : ''),
        type: 'button', style: `--c:${c}`, title: c,
        onclick: () => pick(c),
      }))
    }
    return row
  }

  const sizes = (list, cur, pick, max = 11) => {
    const row = el('div', {class: 'sizes'})
    for (const s of list){
      const b = el('button', {class: 'sz' + (Math.abs(s - cur) < 0.01 ? ' on' : ''), type: 'button', title: s + ''})
      b.append(el('i', {style: `width:${Math.min(s / max * 17 + 3, 20)}px;height:${Math.min(s / max * 17 + 3, 20)}px`}))
      b.onclick = () => pick(s)
      row.append(b)
    }
    return row
  }

  const toggle = (label, on, fn, title) => el('button', {
    class: 'opt' + (on ? ' on' : ''), type: 'button', text: label, title: title || label,
    onclick: fn,
  })

  /* 見出しつきの並びボタン */
  const seg = (label, list, cur, pick, title) => {
    const g = el('div', {class: 'seg-g'})
    for (const [v, t] of list){
      g.append(el('button', {
        class: 'opt' + (v === cur ? ' on' : ''), type: 'button', text: t,
        onclick: () => pick(v),
      }))
    }
    return el('div', {class: 'seg', title: title || ''}, [el('span', {class: 'seg-l', text: label}), g])
  }

  if (tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ell' || tool === 'tri' || tool === 'text' || tool === 'math' || tool === 'graph'){
    add(swatches(theme.dark ? INK.dark : INK.light, st.col, c => api.set({col: c})))
  }
  if (tool === 'marker'){
    add(swatches(MARKER, st.markCol, c => api.set({markCol: c})))
    add(sizes([3, 5, 9, 15], st.markSz, s => api.set({markSz: s}), 15))
  }
  if (tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ell' || tool === 'tri'){
    add(sizes(SIZES, st.sz, s => api.set({sz: s})))
  }
  if (tool === 'pen' || tool === 'marker'){
    add(seg('手ぶれ補正', [[0, '切'], [1, '弱'], [2, '中'], [3, '強'], [4, '極']], st.smooth,
      v => api.set({smooth: v}),
      (api.pad
        ? 'ペン先が指を少し遅れて追いかけます。ペンタブにしたスマホには、同じ段でもずっと強く効きます（手のひらの面に画面まるごとが映っているので、指の震えも何倍かに伸びるため）'
        : 'ペン先が指を少し遅れて追いかけます。マウスで書くときは「中」か「強」が書きやすい')
      + '。強くするほど角は丸くなります'))
  }
  if (tool === 'text') add(sizes([16, 22, 30, 44], st.textSize, s => api.set({textSize: s}), 44))
  if (tool === 'math') add(sizes([22, 30, 42, 60], st.mathSize, s => api.set({mathSize: s}), 60))
  if (tool === 'eraser'){
    add(sizes(ERASERS, st.eraseR, s => api.set({eraseR: s}), 64))
    add(el('div', {class: 'sep-h'}))
    add(toggle('線ごと', !st.erasePart, () => api.set({erasePart: false}), '触れた線をまるごと消す'))
    add(toggle('部分', st.erasePart, () => api.set({erasePart: true}), 'なぞったところだけ消す'))
  }
  if (tool === 'line'){
    add(el('div', {class: 'sep-h'}))
    const arrows = [[0, '—'], [2, '→'], [3, '↔']]
    for (const [v, lbl] of arrows) add(toggle(lbl, st.arrow === v, () => api.set({arrow: v}), '矢の向き'))
  }
  if (tool === 'rect' || tool === 'ell' || tool === 'tri'){
    add(el('div', {class: 'sep-h'}))
    add(toggle('塗り', st.fill, () => api.set({fill: !st.fill}), '中を薄く塗る'))
  }
  if (tool === 'line' || tool === 'rect' || tool === 'ell' || tool === 'tri'){
    add(toggle('点線', st.dash, () => api.set({dash: !st.dash}), '点線にする'))
  }
  if (tool !== 'laser' && tool !== 'eraser' && tool !== 'select'){
    add(el('div', {class: 'sep-h'}))
    add(toggle('方眼', st.snap, () => api.set({snap: !st.snap}), 'マス目に合わせる'))
  }
  if (tool === 'select'){
    const n = api.selCount()
    add(el('span', {class: 'hint', text: n ? `${n} 個えらんでいる` : '囲むか、触れると選べる'}))
    if (n){
      add(el('div', {class: 'sep-h'}))
      add(swatches(theme.dark ? INK.dark : INK.light, '', c => api.recolor(c)))
      add(el('div', {class: 'sep-h'}))
      add(el('button', {class: 'opt', type: 'button', html: icon('copy', 16) + '<span>複製</span>', onclick: () => api.duplicate()}))
      add(el('button', {class: 'opt danger', type: 'button', html: icon('trash', 16) + '<span>消す</span>', onclick: () => api.del()}))
    }
  }
  host.classList.toggle('empty', !host.children.length)
}

/* ── 小窓 ─────────────────────────────────── */

export function toast(msg, ms = 2000){
  let t = $('#toast')
  if (!t){
    t = el('div', {id: 'toast'})
    document.body.append(t)
  }
  t.textContent = msg
  t.classList.add('on')
  clearTimeout(t._h)
  t._h = setTimeout(() => t.classList.remove('on'), ms)
}

export function openSheet({title, body, actions, wide, onClose}){
  const back = el('div', {class: 'veil'})
  const card = el('div', {class: 'sheet' + (wide ? ' wide' : '')})
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.() }
  const esc = e => { if (e.key === 'Escape'){ e.stopPropagation(); close() } }
  card.append(el('header', {}, [
    el('h2', {text: title}),
    el('button', {class: 'x', type: 'button', html: icon('close', 18), onclick: close, 'aria-label': '閉じる'}),
  ]))
  card.append(el('div', {class: 'sheet-body'}, body))
  if (actions) card.append(el('footer', {}, actions))
  back.append(card)
  back.addEventListener('pointerdown', e => { if (e.target === back) close() })
  document.addEventListener('keydown', esc)
  document.body.append(back)
  /* 裏に回ったタブでは requestAnimationFrame が止まる。
     一度測って確定させてから印を付ければ、必ず出る */
  void back.offsetHeight
  back.classList.add('on')
  return {close, card}
}

/* ── 数式の窓 ─────────────────────────────── */

const PADS = [
  ['分数', '\\frac{a}{b}', 3],
  ['累乗', 'x^{2}', 2],
  ['添字', 'x_{1}', 2],
  ['根号', '\\sqrt{x}', 2],
  ['n乗根', '\\sqrt[3]{x}', 2],
  ['≦', '\\le '], ['≧', '\\ge '], ['≠', '\\ne '], ['≒', '\\doteq '],
  ['±', '\\pm '], ['×', '\\times '], ['÷', '\\div '], ['·', '\\cdot '],
  ['π', '\\pi '], ['θ', '\\theta '], ['α', '\\alpha '], ['°', '^{\\circ}'],
  ['∠', '\\angle '], ['△', '\\triangle '], ['∥', '\\parallel '], ['⊥', '\\perp '],
  ['≡', '\\equiv '], ['∽', '\\sim '], ['∴', '\\therefore '], ['∵', '\\because '],
  ['→', '\\to '], ['⇔', '\\Leftrightarrow '], ['∞', '\\infty '], ['√2', '\\sqrt{2}', 0],
  ['sin', '\\sin '], ['cos', '\\cos '], ['tan', '\\tan '], ['log', '\\log '],
  ['Σ', '\\sum_{k=1}^{n} ', 9], ['∫', '\\int_{a}^{b} ', 8], ['lim', '\\lim_{n \\to \\infty} ', 13],
  ['ベクトル', '\\vec{a}', 2], ['絶対値', '\\left|x\\right|', 7], ['括弧', '\\left(\\right)', 7],
  ['行列', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 16],
  ['場合分け', '\\begin{cases} x & (x \\ge 0) \\\\ -x & (x < 0) \\end{cases}', 14],
]

export function mathSheet({value = '', size = 34, color = '#1b1f27', theme = 'paper', onDone}){
  const ta = el('textarea', {class: 'math-in', rows: 3, spellcheck: 'false', placeholder: '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'})
  ta.value = value
  const cv = el('canvas', {class: 'math-prev'})
  const err = el('div', {class: 'math-err'})
  const pad = el('div', {class: 'pad'})

  function insert(txt, back = 0){
    const s = ta.selectionStart, e = ta.selectionEnd
    const sel = ta.value.slice(s, e)
    let t = txt
    if (sel && txt.includes('{}')) t = txt.replace('{}', '{' + sel + '}')
    ta.value = ta.value.slice(0, s) + t + ta.value.slice(e)
    const caret = s + t.length - back
    ta.focus()
    ta.setSelectionRange(caret, caret)
    paint()
  }

  for (const [label, tex, back] of PADS){
    pad.append(el('button', {class: 'pk', type: 'button', text: label, title: tex.trim(), onclick: () => insert(tex, back || 0)}))
  }

  function paint(){
    const th = THEMES[theme] || THEMES.paper
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    const t = typeset(ta.value || '', 44)
    const padX = 26, padY = 20
    const w = Math.max(Math.min(t.w + padX * 2, 1400), 120)
    const h = t.h + t.d + padY * 2
    cv.style.width = w + 'px'
    cv.style.height = h + 'px'
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const c = cv.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.fillStyle = th.bg
    c.fillRect(0, 0, w, h)
    c.fillStyle = color
    t.draw(c, padX, padY + t.h)
    err.textContent = t.error ? '読めないところがあります: ' + t.error : ''
    err.classList.toggle('on', !!t.error)
  }

  ta.addEventListener('input', paint)
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); done() }
  })

  const sheet = openSheet({
    title: '数式',
    wide: true,
    body: [
      el('div', {class: 'prev-wrap'}, cv),
      err,
      ta,
      el('p', {class: 'note', text: 'TeX の書き方。ボタンでも入れられます。Ctrl+Enter で置く。'}),
      pad,
    ],
    actions: [
      el('button', {class: 'btn ghost', type: 'button', text: 'やめる', onclick: () => sheet.close()}),
      el('button', {class: 'btn go', type: 'button', text: '板に置く', onclick: () => done()}),
    ],
  })

  function done(){
    const v = ta.value.trim()
    sheet.close()
    if (v) onDone?.(v)
  }

  paint()
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length) }, 60)
  return sheet
}

/* ── グラフの窓 ───────────────────────────── */

export function graphSheet({value, theme = 'paper', onDone}){
  const v = value || {
    fns: [{s: 'x^2 - 2', col: '#d92d20'}],
    xmin: -6, xmax: 6, ymin: -4, ymax: 8, labels: true,
  }
  const rows = el('div', {class: 'g-rows'})
  const cv = el('canvas', {class: 'math-prev'})
  const COLORS = ['#d92d20', '#1d4ed8', '#15803d', '#7e22ce', '#ea580c', '#0e7490']
  let fns = v.fns.map(f => ({...f}))
  const range = {xmin: v.xmin, xmax: v.xmax, ymin: v.ymin, ymax: v.ymax}

  function rebuild(){
    rows.innerHTML = ''
    fns.forEach((f, i) => {
      const inp = el('input', {class: 'g-in', value: f.s, spellcheck: 'false', placeholder: 'x^2 - 2'})
      inp.addEventListener('input', () => { f.s = inp.value; paint() })
      const sw = el('button', {class: 'sw on', type: 'button', style: `--c:${f.col}`, title: '色を変える'})
      sw.onclick = () => {
        f.col = COLORS[(COLORS.indexOf(f.col) + 1) % COLORS.length]
        sw.style.setProperty('--c', f.col)
        paint()
      }
      const rm = el('button', {class: 'g-x', type: 'button', html: icon('close', 15), title: 'この式を消す'})
      rm.onclick = () => { fns.splice(i, 1); if (!fns.length) fns.push({s: '', col: COLORS[0]}); rebuild(); paint() }
      rows.append(el('div', {class: 'g-row'}, [sw, el('span', {class: 'g-y', text: 'y ='}), inp, rm]))
    })
    rows.append(el('button', {
      class: 'btn tiny', type: 'button', html: icon('plus', 15) + '<span>式を足す</span>',
      onclick: () => { fns.push({s: '', col: COLORS[fns.length % COLORS.length]}); rebuild(); paint() },
    }))
  }

  const num = (key, label) => {
    const i = el('input', {class: 'g-num', type: 'number', step: 'any', value: range[key]})
    i.addEventListener('input', () => {
      const n = parseFloat(i.value)
      if (Number.isFinite(n)){ range[key] = n; paint() }
    })
    return el('label', {class: 'g-lab'}, [el('span', {text: label}), i])
  }

  function current(){
    return {
      type: 'graph', x: 0, y: 0, w: 520, h: 380,
      fns: fns.filter(f => f.s.trim()), labels: true,
      xmin: Math.min(range.xmin, range.xmax - 0.1), xmax: Math.max(range.xmax, range.xmin + 0.1),
      ymin: Math.min(range.ymin, range.ymax - 0.1), ymax: Math.max(range.ymax, range.ymin + 0.1),
    }
  }

  function paint(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    /* 窓の幅に合わせる。はみ出すと目盛りの数が切れる */
    const room = (cv.parentElement && cv.parentElement.clientWidth) || 480
    const w = Math.max(260, Math.min(540, room - 2))
    const h = Math.round(w * 0.66)
    cv.style.width = w + 'px'
    cv.style.height = h + 'px'
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    const c = cv.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    const th = THEMES[theme] || THEMES.paper
    c.fillStyle = th.bg
    c.fillRect(0, 0, w, h)
    drawEl(c, {...current(), x: 14, y: 12, w: w - 28, h: h - 24}, th, 1)
  }

  rebuild()
  const sheet = openSheet({
    title: '関数のグラフ',
    wide: true,
    body: [
      el('div', {class: 'prev-wrap'}, cv),
      rows,
      el('div', {class: 'g-ranges'}, [num('xmin', 'x の左'), num('xmax', 'x の右'), num('ymin', 'y の下'), num('ymax', 'y の上')]),
      el('p', {class: 'note', text: '2x や 3sin x のように、掛け算の記号は省けます。sqrt(x)、|x|、log、ln、pi も使えます。'}),
    ],
    actions: [
      el('button', {class: 'btn ghost', type: 'button', text: 'やめる', onclick: () => sheet.close()}),
      el('button', {class: 'btn go', type: 'button', text: value ? '直す' : '板に置く', onclick: () => {
        const g = current()
        sheet.close()
        onDone?.(g)
      }}),
    ],
  })
  paint()
  return sheet
}
