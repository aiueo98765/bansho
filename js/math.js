/* ═══════════════════════════════════════════════
   math.js — 数式を canvas に組む
   TeX の書き方を受けて、箱（幅・ベースラインより上の高さ・下の深さ）を積む。
   画像でもフォントでもなく「その場で組む」ので、どれだけ拡大しても滲まない。
   根号・括弧・矢印は字ではなくパスで描く。字に頼ると伸ばしたときに崩れる。
   ═══════════════════════════════════════════════ */

const MATH = '"Latin Modern Math","STIX Two Math","Cambria Math","Times New Roman",serif'
const SANS = '"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif'
const JPN  = '"Hiragino Mincho ProN","Yu Mincho","MS Mincho",serif'

/* ── 記号表 ───────────────────────────────── */

const GREEK = {
  alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ϵ', varepsilon:'ε',
  zeta:'ζ', eta:'η', theta:'θ', vartheta:'ϑ', iota:'ι', kappa:'κ',
  lambda:'λ', mu:'μ', nu:'ν', xi:'ξ', omicron:'ο', pi:'π', varpi:'ϖ',
  rho:'ρ', varrho:'ϱ', sigma:'σ', varsigma:'ς', tau:'τ', upsilon:'υ',
  phi:'ϕ', varphi:'φ', chi:'χ', psi:'ψ', omega:'ω',
  Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Xi:'Ξ', Pi:'Π',
  Sigma:'Σ', Upsilon:'Υ', Phi:'Φ', Psi:'Ψ', Omega:'Ω',
}

/* 二項演算子。前後に中くらいの空きが入る */
const BIN = {
  times:'×', div:'÷', cdot:'⋅', pm:'±', mp:'∓', ast:'∗', star:'⋆',
  circ:'∘', bullet:'∙', oplus:'⊕', ominus:'⊖', otimes:'⊗', odot:'⊙',
  cap:'∩', cup:'∪', setminus:'∖', wedge:'∧', vee:'∨',
}

/* 関係記号。前後に広い空きが入る */
const REL = {
  le:'≤', leq:'≤', ge:'≥', geq:'≥', ne:'≠', neq:'≠', ll:'≪', gg:'≫',
  approx:'≈', equiv:'≡', sim:'∼', simeq:'≃', cong:'≅', propto:'∝',
  doteq:'≒', fallingdotseq:'≒', risingdotseq:'≓',
  in:'∈', notin:'∉', ni:'∋', subset:'⊂', subseteq:'⊆', supset:'⊃',
  supseteq:'⊇', parallel:'∥', perp:'⊥', mid:'∣', nmid:'∤',
  to:'→', rightarrow:'→', longrightarrow:'⟶', leftarrow:'←',
  longleftarrow:'⟵', leftrightarrow:'↔', Rightarrow:'⇒', Leftarrow:'⇐',
  Leftrightarrow:'⇔', iff:'⇔', implies:'⇒', mapsto:'↦', gets:'←',
  nearrow:'↗', searrow:'↘',
}

/* 単独で立つ記号 */
const ORD = {
  infty:'∞', partial:'∂', nabla:'∇', forall:'∀', exists:'∃', nexists:'∄',
  emptyset:'∅', varnothing:'∅', angle:'∠', measuredangle:'∡',
  triangle:'△', square:'□', bigcirc:'◯', diamond:'◇',
  degree:'°', circ_deg:'°', prime:'′', dprime:'″', hbar:'ℏ', ell:'ℓ',
  Re:'ℜ', Im:'ℑ', aleph:'ℵ', surd:'√', neg:'¬', lnot:'¬',
  because:'∵', therefore:'∴', ldots:'…', dots:'…', cdots:'⋯',
  vdots:'⋮', ddots:'⋱', quad:' ', qquad:'  ',
  backslash:'\\', '#':'#', '$':'$', '%':'%', '&':'&', '_':'_',
  '{':'{', '}':'}', 'equiv2':'≡',
}

const OPEN = {'(':'(', '[':'[', 'lbrace':'{', 'langle':'⟨', 'lceil':'⌈', 'lfloor':'⌊', 'lvert':'|', 'lVert':'‖'}
const CLOSE = {')':')', ']':']', 'rbrace':'}', 'rangle':'⟩', 'rceil':'⌉', 'rfloor':'⌋', 'rvert':'|', 'rVert':'‖'}

/* 立体で組む関数名 */
const FUNCS = ['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan',
  'sinh','cosh','tanh','coth','log','ln','lg','exp','det','dim','deg','gcd',
  'ker','hom','arg','Pr','sup','inf']
/* 上下に添字を置く作用素 */
const BIGOPS = {sum:'∑', prod:'∏', coprod:'∐', bigcap:'⋂', bigcup:'⋃', bigoplus:'⨁'}
const INTS = {int:'∫', iint:'∬', iiint:'∭', oint:'∮'}
const LIMS = ['lim','limsup','liminf','max','min','argmax','argmin']

const BB = {A:'𝔸',B:'𝔹',C:'ℂ',D:'𝔻',E:'𝔼',F:'𝔽',G:'𝔾',H:'ℍ',I:'𝕀',J:'𝕁',
  K:'𝕂',L:'𝕃',M:'𝕄',N:'ℕ',O:'𝕆',P:'ℙ',Q:'ℚ',R:'ℝ',S:'𝕊',T:'𝕋',U:'𝕌',
  V:'𝕍',W:'𝕎',X:'𝕏',Y:'𝕐',Z:'ℤ'}

const SPACES = {',':0.167, ':':0.222, ';':0.278, '!':-0.167, ' ':0.333,
  quad:1, qquad:2, enspace:0.5, thinspace:0.167, nobreakspace:0.333}

const MATRICES = {
  matrix:['',''], pmatrix:['(',')'], bmatrix:['[',']'], Bmatrix:['{','}'],
  vmatrix:['|','|'], Vmatrix:['‖','‖'], cases:['{',''], array:['',''],
  aligned:['',''], gathered:['',''],
}

/* ── 字の寸法 ─────────────────────────────── */

let MC = null
const mcache = new Map()

function measure(ch, f){
  const key = f + '\u0000' + ch
  let m = mcache.get(key)
  if (m) return m
  if (!MC) MC = document.createElement('canvas').getContext('2d')
  MC.font = f
  const t = MC.measureText(ch)
  m = {
    w: t.width,
    h: Math.max(t.actualBoundingBoxAscent || 0, 0),
    d: Math.max(t.actualBoundingBoxDescent || 0, 0),
  }
  if (mcache.size < 4000) mcache.set(key, m)
  return m
}

/* ── 箱 ───────────────────────────────────── */

const box = (w, h, d, draw) => ({w, h, d, draw})
const nil = s => box(s, 0, 0, () => {})

function hcat(boxes){
  let w = 0, h = 0, d = 0
  for (const b of boxes){ w += b.w; h = Math.max(h, b.h); d = Math.max(d, b.d) }
  return box(w, h, d, (c, x, y) => {
    let cx = x
    for (const b of boxes){ b.draw(c, cx, y); cx += b.w }
  })
}

/* 箱をベースラインから dy だけ持ち上げる（dy>0 で上） */
function raise(b, dy){
  return box(b.w, b.h + dy, Math.max(b.d - dy, 0), (c, x, y) => b.draw(c, x, y - dy))
}

function shiftX(b, dx){
  return box(b.w + dx, b.h, b.d, (c, x, y) => b.draw(c, x + dx, y))
}

/* 幅 w の中で中央に置く */
function center(b, w){
  const dx = (w - b.w) / 2
  return box(w, b.h, b.d, (c, x, y) => b.draw(c, x + dx, y))
}

function glyph(ch, f){
  const m = measure(ch, f)
  return box(m.w, m.h, m.d, (c, x, y) => {
    c.font = f
    c.textAlign = 'left'
    c.textBaseline = 'alphabetic'
    c.fillText(ch, x, y)
  })
}

/* 塗りの矩形。罫線や分数の棒に使う */
function bar(w, th, lift){
  return box(w, lift + th, 0, (c, x, y) => c.fillRect(x, y - lift - th, w, th))
}

/* ── 字句 ─────────────────────────────────── */

function lex(src){
  const t = []
  let i = 0
  while (i < src.length){
    const c = src[i]
    if (c === '\\'){
      const m = /^\\([a-zA-Z]+\*?|.)/.exec(src.slice(i))
      if (!m){ i++; continue }
      t.push({k: 'cmd', v: m[1]})
      i += m[0].length
    } else if (c === '{' || c === '}' || c === '^' || c === '_' || c === '&'){
      t.push({k: c}); i++
    } else if (c === ' ' || c === '\n' || c === '\t'){
      i++
    } else {
      t.push({k: 'ch', v: c}); i++
    }
  }
  return t
}

/* ── 構文 ─────────────────────────────────── */

function parse(tokens){
  let p = 0
  const at = k => tokens[p] && tokens[p].k === k
  const cmd = v => tokens[p] && tokens[p].k === 'cmd' && tokens[p].v === v

  function group(){
    if (at('{')){ p++; const n = nodes('}'); return {t: 'list', items: n} }
    if (p >= tokens.length) return {t: 'list', items: []}
    return atom()
  }

  function opt(){
    if (at('ch') && tokens[p].v === '['){
      p++
      const out = []
      let depth = 0
      while (p < tokens.length){
        const tk = tokens[p]
        if (tk.k === 'ch' && tk.v === '[') depth++
        if (tk.k === 'ch' && tk.v === ']'){ if (!depth){ p++; break } depth-- }
        out.push(tk); p++
      }
      return {t: 'list', items: parse(out)}
    }
    return null
  }

  /* \begin{env} から対応する \end{env} までを行と桁に割る */
  function env(){
    const name = at('{') ? (p++, rawWord()) : 'matrix'
    let depth = 0
    const body = []
    while (p < tokens.length){
      const tk = tokens[p]
      if (tk.k === 'cmd' && tk.v === 'begin') depth++
      if (tk.k === 'cmd' && tk.v === 'end'){
        if (!depth){ p++; if (at('{')){ p++; rawWord() } break }
        depth--
      }
      body.push(tk); p++
    }
    /* array の桁指定は読み飛ばす */
    const rows = [[[]]]
    let d2 = 0
    for (const tk of body){
      if (tk.k === '{') d2++
      if (tk.k === '}') d2--
      if (!d2 && tk.k === '&'){ rows[rows.length - 1].push([]); continue }
      if (!d2 && tk.k === 'cmd' && (tk.v === '\\' || tk.v === 'cr')){ rows.push([[]]); continue }
      rows[rows.length - 1][rows[rows.length - 1].length - 1].push(tk)
    }
    const parsed = rows
      .map(r => r.map(cell => parse(cell)))
      .filter((r, i, a) => i < a.length - 1 || r.some(c => c.length))
    return {t: 'env', name, rows: parsed}
  }

  function rawWord(){
    let s = ''
    while (p < tokens.length && !at('}')){
      const tk = tokens[p++]
      s += tk.k === 'ch' ? tk.v : (tk.v || '')
    }
    if (at('}')) p++
    return s
  }

  function atom(){
    const tk = tokens[p]
    if (!tk) return {t: 'list', items: []}
    if (tk.k === 'ch'){ p++; return {t: 'ch', c: tk.v} }
    if (tk.k === '{'){ return group() }
    if (tk.k === 'cmd'){
      const name = tk.v
      p++
      if (name === 'begin') return env()
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac' || name === 'binom' || name === 'dbinom'){
        const a = group(), b = group()
        return {t: name.includes('binom') ? 'binom' : 'frac', a, b, big: name[0] === 'd'}
      }
      if (name === 'sqrt'){
        const o = opt()
        return {t: 'sqrt', idx: o, a: group()}
      }
      if (name === 'left'){
        const l = delimName()
        const body = nodes('right')
        const r = delimName()
        return {t: 'delim', l, r, body}
      }
      if (name === 'text' || name === 'textrm' || name === 'mbox'){ return {t: 'text', s: readText()} }
      if (name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'mathbb' ||
          name === 'mathcal' || name === 'mathsf' || name === 'bm' || name === 'boldsymbol'){
        return {t: 'style', how: name, a: group()}
      }
      if (name === 'overline' || name === 'underline' || name === 'bar' || name === 'vec' ||
          name === 'overrightarrow' || name === 'hat' || name === 'widehat' ||
          name === 'tilde' || name === 'widetilde' || name === 'dot' || name === 'ddot'){
        return {t: 'accent', how: name, a: group()}
      }
      if (name === 'pmod'){ return {t: 'pmod', a: group()} }
      if (name === 'operatorname'){ return {t: 'opname', s: readText()} }
      if (name in SPACES) return {t: 'space', em: SPACES[name]}
      return {t: 'cmd', name}
    }
    p++   /* ^ _ & } が裸で出たら捨てる */
    return {t: 'list', items: []}
  }

  function readText(){
    if (!at('{')) return ''
    p++
    let s = '', depth = 0
    while (p < tokens.length){
      const tk = tokens[p]
      if (tk.k === '{') depth++
      if (tk.k === '}'){ if (!depth){ p++; break } depth-- }
      p++
      s += tk.k === 'ch' ? tk.v : (tk.k === 'cmd' ? (tk.v === ' ' ? ' ' : '\\' + tk.v) : '')
      if (tk.k === 'cmd' && tk.v === ' ') s = s.slice(0, -1) + ' '
    }
    return s
  }

  function delimName(){
    const tk = tokens[p]
    if (!tk) return '.'
    p++
    if (tk.k === 'ch') return tk.v
    if (tk.k === 'cmd'){
      if (tk.v === '{') return '{'
      if (tk.v === '}') return '}'
      if (tk.v in OPEN) return OPEN[tk.v]
      if (tk.v in CLOSE) return CLOSE[tk.v]
      if (tk.v === 'vert') return '|'
      if (tk.v === 'Vert') return '‖'
    }
    return '.'
  }

  /* 添字つきの一塊を読む */
  function scripted(){
    const base = atom()
    let sup = null, sub = null
    for (let i = 0; i < 2; i++){
      if (at('^') && !sup){ p++; sup = group() }
      else if (at('_') && !sub){ p++; sub = group() }
      else break
    }
    /* 素のままの ' は上付きのプライム */
    while (at('ch') && tokens[p].v === "'"){
      p++
      sup = sup ? {t: 'list', items: [sup, {t: 'cmd', name: 'prime'}]} : {t: 'cmd', name: 'prime'}
    }
    if (sup || sub) return {t: 'script', base, sup, sub}
    return base
  }

  function nodes(stop){
    const out = []
    while (p < tokens.length){
      if (stop === '}' && at('}')){ p++; break }
      if (stop === 'right' && cmd('right')){ p++; break }
      out.push(scripted())
    }
    return out
  }

  const res = nodes(null)
  return res
}

/* ── 組版 ─────────────────────────────────── */

const ITAL = s => 'italic ' + s + 'px ' + MATH
const UP = s => s + 'px ' + MATH
const BOLD = s => 'bold italic ' + s + 'px ' + MATH

function sub(st, scale, extra){
  return {...st, size: Math.max(st.size * scale, 5), level: st.level + 1, ...extra}
}

/* 文字の役。前後の空きの決め手になる */
function classOf(ch){
  if ('+-±∓×÷⋅∗⋆∘∙⊕⊖⊗⊙∩∪∖∧∨'.includes(ch)) return 'bin'
  if ('=≠<>≤≥≪≫≈≡∼≃≅∝≒≓∈∉∋⊂⊆⊃⊇∥⊥→←↔⇒⇐⇔↦⟶⟵↗↘'.includes(ch)) return 'rel'
  if ('([{⟨⌈⌊'.includes(ch)) return 'open'
  if (')]}⟩⌉⌋'.includes(ch)) return 'close'
  if (',;:'.includes(ch)) return 'punct'
  return 'ord'
}

function gapEm(l, r){
  if (l === 'bin' || r === 'bin') return 0.215
  if (l === 'rel' || r === 'rel') return 0.275
  if (l === 'punct') return 0.17
  if (l === 'op') return 0.1
  if (l === 'ord' && r === 'op') return 0.1
  return 0
}

function layList(nodes, st){
  const out = []
  let prev = null
  for (const n of nodes){
    let {b, cls} = layNode(n, st)
    /* 符号が単項なら、前の空きは入れない（-x, (-3) など） */
    if (cls === 'bin' && (prev === null || prev === 'bin' || prev === 'rel' || prev === 'open' || prev === 'punct' || prev === 'op')) cls = 'ord'
    if (prev !== null){
      const g = gapEm(prev, cls) * st.size
      if (g) out.push(nil(g))
    }
    out.push(b)
    prev = cls
  }
  if (!out.length) return {b: nil(0), cls: 'ord'}
  return {b: hcat(out), cls: prev}
}

function layNode(n, st){
  switch (n.t){
    case 'list': {
      const r = layList(n.items, st)
      return {b: r.b, cls: n.items.length === 1 ? r.cls : 'ord'}
    }
    case 'ch': return layChar(n.c, st)
    case 'space': return {b: nil(n.em * st.size), cls: 'ord'}
    case 'text': return {b: layText(n.s, st, false), cls: 'ord'}
    case 'opname': return {b: layText(n.s, st, true), cls: 'op'}
    case 'style': return {b: layStyle(n, st), cls: 'ord'}
    case 'frac': return {b: layFrac(n.a, n.b, st, true), cls: 'ord'}
    case 'binom': return {b: layBinom(n, st), cls: 'ord'}
    case 'sqrt': return {b: laySqrt(n, st), cls: 'ord'}
    case 'accent': return {b: layAccent(n, st), cls: 'ord'}
    case 'delim': return {b: layDelim(n, st), cls: 'ord'}
    case 'env': return {b: layEnv(n, st), cls: 'ord'}
    case 'script': return layScript(n, st)
    case 'pmod': {
      const inner = layList([{t: 'text', s: 'mod'}, {t: 'space', em: 0.25}, n.a], st)
      return {b: hcat([nil(0.4 * st.size), wrap(inner.b, '(', ')', st)]), cls: 'ord'}
    }
    case 'cmd': return layCmd(n.name, st)
  }
  return {b: nil(0), cls: 'ord'}
}

function layChar(c, st){
  const cls = classOf(c)
  /* 変数は斜体、数と記号は立体。これだけで式が「数式の顔」になる */
  const ital = /[a-zA-Zα-ωΑ-Ω]/.test(c) && !st.upright
  const f = st.bold ? (ital ? BOLD(st.size) : 'bold ' + UP(st.size))
          : ital ? ITAL(st.size) : UP(st.size)
  if (c === '-') return {b: minus(st), cls: 'bin'}
  return {b: glyph(c, f), cls}
}

/* ハイフンではなく引き算の横棒を引く。字によって細すぎたり短すぎたりするため */
function minus(st){
  const w = 0.56 * st.size, th = Math.max(0.045 * st.size, 0.75), lift = 0.26 * st.size
  return box(w, lift + th, 0, (c, x, y) => c.fillRect(x + w * 0.08, y - lift - th / 2, w * 0.84, th))
}

function layText(s, st, upright){
  const jp = /[　-鿿＀-￯]/.test(s)
  const f = jp ? st.size + 'px ' + JPN : (upright ? UP(st.size) : st.size + 'px ' + MATH)
  const parts = []
  for (const ch of s) parts.push(ch === ' ' ? nil(0.28 * st.size) : glyph(ch, f))
  return parts.length ? hcat(parts) : nil(0)
}

function layStyle(n, st){
  if (n.how === 'mathbb'){
    const src = flatten(n.a)
    const mapped = src.replace(/[A-Z]/g, c => BB[c] || c)
    return layText(mapped, {...st}, true)
  }
  const extra = n.how === 'mathrm' || n.how === 'mathsf' ? {upright: true}
    : n.how === 'mathbf' || n.how === 'bm' || n.how === 'boldsymbol' ? {bold: true}
    : n.how === 'mathcal' ? {upright: false} : {}
  return layList([n.a], {...st, ...extra}).b
}

function flatten(node){
  if (!node) return ''
  if (node.t === 'ch') return node.c
  if (node.t === 'list') return node.items.map(flatten).join('')
  if (node.t === 'text') return node.s
  if (node.t === 'cmd') return GREEK[node.name] || ORD[node.name] || ''
  return ''
}

function layFrac(a, b, st, ruled){
  const inner = sub(st, st.level === 0 ? 0.92 : 0.78)
  const num = layList([a], inner).b
  const den = layList([b], inner).b
  const th = Math.max(0.048 * st.size, 0.8)
  const axis = 0.26 * st.size
  const pad = 0.14 * st.size
  const gap = 0.13 * st.size
  const w = Math.max(num.w, den.w) + pad * 2
  const upH = axis + th / 2 + gap + num.d
  const dnH = -axis + th / 2 + gap + den.h
  return box(w, upH + num.h, dnH + den.d, (c, x, y) => {
    num.draw(c, x + (w - num.w) / 2, y - upH)
    den.draw(c, x + (w - den.w) / 2, y + dnH)
    if (ruled) c.fillRect(x + pad * 0.4, y - axis - th / 2, w - pad * 0.8, th)
  })
}

function layBinom(n, st){
  return wrap(layFrac(n.a, n.b, st, false), '(', ')', st)
}

function layScript(n, st){
  const base = layNode(n.base, st)
  const name = n.base.t === 'cmd' ? n.base.name : null
  /* ∑ や lim は上下に、∫ は右肩右足に添える */
  if (name && (name in BIGOPS || LIMS.includes(name))) return {b: layLimits(base.b, n, st), cls: 'op'}

  const ss = sub(st, st.level === 0 ? 0.68 : 0.58)
  const supB = n.sup ? layList([n.sup], ss).b : null
  const subB = n.sub ? layList([n.sub], ss).b : null
  const b = base.b
  const supShift = Math.max(b.h - 0.22 * st.size, 0.42 * st.size)
  const subShift = Math.max(b.d + 0.12 * st.size, 0.2 * st.size)
  const w = Math.max(supB ? supB.w : 0, subB ? subB.w : 0)
  const kern = 0.035 * st.size
  const h = Math.max(b.h, supB ? supShift + supB.h : 0)
  const d = Math.max(b.d, subB ? subShift + subB.d : 0)
  return {
    b: box(b.w + w + kern, h, d, (c, x, y) => {
      b.draw(c, x, y)
      if (supB) supB.draw(c, x + b.w + kern, y - supShift)
      if (subB) subB.draw(c, x + b.w + kern, y + subShift)
    }),
    cls: base.cls === 'op' ? 'op' : 'ord',
  }
}

function layLimits(opB, n, st){
  const ss = sub(st, 0.62)
  const up = n.sup ? layList([n.sup], ss).b : null
  const dn = n.sub ? layList([n.sub], ss).b : null
  const w = Math.max(opB.w, up ? up.w : 0, dn ? dn.w : 0)
  const g = 0.14 * st.size
  const h = opB.h + (up ? g + up.d + up.h : 0)
  const d = opB.d + (dn ? g + dn.h + dn.d : 0)
  return box(w, h, d, (c, x, y) => {
    opB.draw(c, x + (w - opB.w) / 2, y)
    if (up) up.draw(c, x + (w - up.w) / 2, y - opB.h - g - up.d)
    if (dn) dn.draw(c, x + (w - dn.w) / 2, y + opB.d + g + dn.h)
  })
}

function laySqrt(n, st){
  const inner = layList([n.a], {...st, level: st.level + 1}).b
  const th = Math.max(0.05 * st.size, 0.9)
  const vgap = 0.12 * st.size
  const pad = 0.1 * st.size
  const bot = inner.d + 0.04 * st.size
  const top = inner.h + vgap + th
  const H = top + bot
  const rw = Math.max(0.46 * st.size, H * 0.3)
  const idx = n.idx ? layList([n.idx], sub(st, 0.5)).b : null
  const lead = idx ? Math.max(0, idx.w - rw * 0.45) : 0
  const w = lead + rw + inner.w + pad * 2
  return box(w, Math.max(top, idx ? H * 0.72 + idx.h : 0), bot, (c, x, y) => {
    const x0 = x + lead
    const yt = y - top, yb = y + bot
    c.save()
    c.strokeStyle = c.fillStyle
    c.lineCap = 'round'
    c.lineJoin = 'round'
    /* 足の払いと斜め。太めに引く */
    c.lineWidth = th * 1.55
    c.beginPath()
    c.moveTo(x0 + rw * 0.04, yb - H * 0.40)
    c.lineTo(x0 + rw * 0.26, yb - H * 0.33)
    c.lineTo(x0 + rw * 0.52, yb - th * 0.6)
    c.lineTo(x0 + rw * 0.95, yt + th / 2)
    c.stroke()
    /* 上の横棒は細く */
    c.lineWidth = th
    c.beginPath()
    c.moveTo(x0 + rw * 0.93, yt + th / 2)
    c.lineTo(x0 + rw + inner.w + pad * 2, yt + th / 2)
    c.stroke()
    c.restore()
    inner.draw(c, x0 + rw + pad, y)
    if (idx) idx.draw(c, x, yb - H * 0.62)
  })
}

function layAccent(n, st){
  const inner = layList([n.a], st).b
  const th = Math.max(0.05 * st.size, 0.9)
  const g = 0.1 * st.size
  const how = n.how
  if (how === 'underline'){
    const dep = inner.d + g + th * 2
    return box(inner.w, inner.h, dep, (c, x, y) => {
      inner.draw(c, x, y)
      c.fillRect(x, y + inner.d + g, inner.w, th)
    })
  }
  const base = Math.max(inner.h, 0.6 * st.size)
  const ht = base + g + th * (how === 'ddot' || how === 'dot' ? 3 : 2.2)
  return box(inner.w, ht, inner.d, (c, x, y) => {
    inner.draw(c, x, y)
    const ay = y - base - g
    c.save()
    c.strokeStyle = c.fillStyle
    c.lineWidth = th
    c.lineCap = 'round'
    c.lineJoin = 'round'
    const w = inner.w
    if (how === 'overline' || how === 'bar'){
      c.fillRect(x, ay - th, w, th)
    } else if (how === 'vec' || how === 'overrightarrow'){
      const ah = Math.max(0.16 * st.size, w * 0.1)
      c.beginPath()
      c.moveTo(x + th, ay - th / 2)
      c.lineTo(x + w - th, ay - th / 2)
      c.moveTo(x + w - th - ah, ay - th / 2 - ah * 0.62)
      c.lineTo(x + w - th, ay - th / 2)
      c.lineTo(x + w - th - ah, ay - th / 2 + ah * 0.62)
      c.stroke()
    } else if (how === 'hat' || how === 'widehat'){
      const hw = Math.min(w, 0.6 * st.size)
      const cx = x + w / 2
      c.beginPath()
      c.moveTo(cx - hw / 2, ay)
      c.lineTo(cx, ay - hw * 0.45)
      c.lineTo(cx + hw / 2, ay)
      c.stroke()
    } else if (how === 'tilde' || how === 'widetilde'){
      const hw = Math.min(w, 0.7 * st.size)
      const cx = x + w / 2
      c.beginPath()
      c.moveTo(cx - hw / 2, ay - hw * 0.08)
      c.bezierCurveTo(cx - hw * 0.2, ay - hw * 0.4, cx + hw * 0.2, ay + hw * 0.22, cx + hw / 2, ay - hw * 0.1)
      c.stroke()
    } else if (how === 'dot' || how === 'ddot'){
      const r = th * 1.1
      const cx = x + w / 2
      const off = how === 'ddot' ? r * 2.1 : 0
      c.beginPath(); c.arc(cx - off, ay - r, r, 0, 7); c.fill()
      if (off){ c.beginPath(); c.arc(cx + off, ay - r, r, 0, 7); c.fill() }
    }
    c.restore()
  })
}

/* 中身の高さに合わせて括弧を伸ばす */
function stretchy(ch, h, d, st){
  if (ch === '.' || ch === '') return nil(0)
  const H = h + d
  const th = Math.max(0.055 * st.size, 1)
  const w = ch === '|' ? th * 3.4 : ch === '‖' ? th * 6 : Math.max(0.3 * st.size, H * 0.14)
  return box(w, h, d, (c, x, y) => {
    const t = y - h, b = y + d, mid = (t + b) / 2
    c.save()
    c.strokeStyle = c.fillStyle
    c.lineWidth = th
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.beginPath()
    const L = x + w * 0.22, R = x + w * 0.82
    if (ch === '('){
      c.moveTo(R, t); c.bezierCurveTo(L - w * 0.1, t + H * 0.22, L - w * 0.1, b - H * 0.22, R, b)
    } else if (ch === ')'){
      c.moveTo(L, t); c.bezierCurveTo(R + w * 0.1, t + H * 0.22, R + w * 0.1, b - H * 0.22, L, b)
    } else if (ch === '['){
      c.moveTo(R, t); c.lineTo(L, t); c.lineTo(L, b); c.lineTo(R, b)
    } else if (ch === ']'){
      c.moveTo(L, t); c.lineTo(R, t); c.lineTo(R, b); c.lineTo(L, b)
    } else if (ch === '{' || ch === '}'){
      const s = ch === '{' ? 1 : -1
      const cx = x + w / 2 + (s > 0 ? w * 0.1 : -w * 0.1)
      const e = cx + s * w * 0.42
      c.moveTo(e, t)
      c.bezierCurveTo(cx, t + H * 0.06, cx, mid - H * 0.16, cx - s * w * 0.3, mid)
      c.bezierCurveTo(cx, mid + H * 0.16, cx, b - H * 0.06, e, b)
    } else if (ch === '⌈'){
      c.moveTo(R, t); c.lineTo(L, t); c.lineTo(L, b)
    } else if (ch === '⌉'){
      c.moveTo(L, t); c.lineTo(R, t); c.lineTo(R, b)
    } else if (ch === '⌊'){
      c.moveTo(L, t); c.lineTo(L, b); c.lineTo(R, b)
    } else if (ch === '⌋'){
      c.moveTo(R, t); c.lineTo(R, b); c.lineTo(L, b)
    } else if (ch === '‖'){
      c.moveTo(x + w * 0.3, t); c.lineTo(x + w * 0.3, b)
      c.moveTo(x + w * 0.7, t); c.lineTo(x + w * 0.7, b)
    } else {
      c.moveTo(x + w / 2, t); c.lineTo(x + w / 2, b)
    }
    c.stroke()
    c.restore()
  })
}

function wrap(inner, l, r, st){
  const pad = 0.05 * st.size
  const h = Math.max(inner.h, 0.55 * st.size) + pad
  const d = Math.max(inner.d, 0.16 * st.size) + pad
  return hcat([stretchy(l, h, d, st), inner, stretchy(r, h, d, st)])
}

function layDelim(n, st){
  const inner = layList(n.body, st).b
  return wrap(inner, n.l, n.r, st)
}

function layEnv(n, st){
  const name = n.name.replace(/\*$/, '')
  const [l, r] = MATRICES[name] || ['', '']
  const inner = {...st, level: st.level + (name === 'cases' ? 0 : 0)}
  const cells = n.rows.map(row => row.map(cell => layList(cell, inner).b))
  const cols = Math.max(1, ...cells.map(r => r.length))
  const colW = []
  for (let j = 0; j < cols; j++){
    colW[j] = Math.max(0, ...cells.map(r => (r[j] ? r[j].w : 0)))
  }
  const colGap = (name === 'cases' ? 0.9 : 0.62) * st.size
  const rowGap = 0.42 * st.size
  const rowH = cells.map(r => Math.max(0.6 * st.size, ...r.map(b => b.h)))
  const rowD = cells.map(r => Math.max(0.18 * st.size, ...r.map(b => b.d)))
  let total = 0
  const tops = []
  for (let i = 0; i < cells.length; i++){
    tops.push(total + rowH[i])
    total += rowH[i] + rowD[i] + (i < cells.length - 1 ? rowGap : 0)
  }
  const w = colW.reduce((a, b) => a + b, 0) + colGap * (cols - 1)
  const axis = 0.26 * st.size
  const h = total / 2 + axis
  const grid = box(w, h, total - h, (c, x, y) => {
    const y0 = y - h
    for (let i = 0; i < cells.length; i++){
      let cx = x
      for (let j = 0; j < cols; j++){
        const b = cells[i][j]
        if (b){
          const dx = (name === 'cases' || name === 'array' || name === 'aligned') ? 0 : (colW[j] - b.w) / 2
          b.draw(c, cx + dx, y0 + tops[i])
        }
        cx += colW[j] + colGap
      }
    }
  })
  if (!l && !r) return grid
  const pad = 0.1 * st.size
  return hcat([
    stretchy(l, grid.h + pad, grid.d + pad, st),
    grid,
    stretchy(r, grid.h + pad, grid.d + pad, st),
  ])
}

function layCmd(name, st){
  if (name in GREEK){
    const up = /^[A-Z]/.test(name)
    return {b: glyph(GREEK[name], up || st.upright ? UP(st.size) : ITAL(st.size)), cls: 'ord'}
  }
  if (name in BIN) return {b: glyph(BIN[name], UP(st.size)), cls: 'bin'}
  if (name in REL) return {b: glyph(REL[name], UP(st.size)), cls: 'rel'}
  if (name in BIGOPS){
    const s = st.size * 1.45
    return {b: glyph(BIGOPS[name], UP(s)), cls: 'op'}
  }
  if (name in INTS){
    const s = st.size * 1.7
    const g = glyph(INTS[name], 'italic ' + s + 'px ' + MATH)
    return {b: hcat([g, nil(0.06 * st.size)]), cls: 'op'}
  }
  if (LIMS.includes(name) || FUNCS.includes(name)){
    return {b: layText(name, st, true), cls: 'op'}
  }
  if (name in ORD) return {b: glyph(ORD[name], UP(st.size)), cls: classOf(ORD[name]) }
  if (name in OPEN) return {b: glyph(OPEN[name], UP(st.size)), cls: 'open'}
  if (name in CLOSE) return {b: glyph(CLOSE[name], UP(st.size)), cls: 'close'}
  if (name === 'vert') return {b: glyph('|', UP(st.size)), cls: 'ord'}
  if (name === 'Vert') return {b: glyph('‖', UP(st.size)), cls: 'ord'}
  if (name === 'displaystyle' || name === 'textstyle' || name === 'limits' || name === 'nolimits') return {b: nil(0), cls: 'ord'}
  /* 知らない命令は、それと分かるように薄く出す */
  return {b: layText('\\' + name, {...st, size: st.size * 0.8}, true), cls: 'ord'}
}

/* ── 入口 ─────────────────────────────────── */

const tcache = new Map()

export function typeset(src, size = 32){
  const key = size + '\u0000' + src
  const hit = tcache.get(key)
  if (hit) return hit
  let out
  try {
    const ast = parse(lex(String(src)))
    const r = layList(ast, {size, level: 0, upright: false, bold: false})
    const b = r.b
    out = {
      w: Math.max(b.w, size * 0.3),
      h: Math.max(b.h, size * 0.6),
      d: Math.max(b.d, size * 0.14),
      draw: b.draw,
      error: null,
    }
  } catch (e){
    const b = layText(String(src), {size, level: 0}, true)
    out = {w: b.w, h: Math.max(b.h, size * 0.6), d: b.d, draw: b.draw, error: e.message || 'parse error'}
  }
  if (tcache.size > 600) tcache.clear()
  tcache.set(key, out)
  return out
}

/* 選択枠や当たり判定のための外寸 */
export function measureMath(src, size){
  const t = typeset(src, size)
  return {w: t.w, h: t.h + t.d, ascent: t.h}
}
