/* ═══════════════════════════════════════════════
   expr.js — 式を関数にする
   「y = 2x^2 - 3」のような板書どおりの書き方をそのまま受ける。
   掛け算の記号は省略できる（2x, 3sin x, x(x+1)）。
   ═══════════════════════════════════════════════ */

const FN = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, lg: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  sign: Math.sign,
}
const CONST = {pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2}

const TEX = {left: '', right: '', cdot: '*', times: '*', div: '/', frac: 'frac', sqrt: 'sqrt', pi: 'pi'}

/* 日本の板書で出る書き方を JS 寄りに寄せる前処理 */
function normalize(src){
  return String(src)
    .replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[＋]/g, '+').replace(/[－−—–ー]/g, '-')
    .replace(/[×･・＊]/g, '*').replace(/[÷／]/g, '/')
    .replace(/[＾]/g, '^').replace(/[＝]/g, '=')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ａ-ｚＡ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\\([a-z]+)/g, (m, w) => (w in TEX ? TEX[w] : m))
    .replace(/[{}]/g, c => (c === '{' ? '(' : ')'))
}

function tokenize(src){
  const out = []
  let i = 0
  while (i < src.length){
    const c = src[i]
    if (/\s/.test(c)){ i++; continue }
    if (/[0-9.]/.test(c)){
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const v = Number(src.slice(i, j))
      if (!Number.isFinite(v)) throw new Error('数が読めない: ' + src.slice(i, j))
      out.push({t: 'num', v}); i = j; continue
    }
    if (/[a-zA-Zπ]/.test(c)){
      let j = i
      while (j < src.length && /[a-zA-Z0-9π_]/.test(src[j])) j++
      out.push({t: 'name', v: src.slice(i, j)}); i = j; continue
    }
    if ('+-*/^(),|'.includes(c)){ out.push({t: c}); i++; continue }
    throw new Error('使えない文字: ' + c)
  }
  return out
}

/* 構文解析。返すのは (x) => number のクロージャ。 */
function parse(tokens, varName){
  let p = 0
  let abs = 0                       /* |…| の中にいるか。中では | を掛け算の始まりと見ない */
  const at = t => tokens[p] && tokens[p].t === t
  const eat = t => { if (!at(t)) throw new Error('"' + t + '" が足りない'); return tokens[p++] }

  function expr(){
    let node = term()
    while (at('+') || at('-')){
      const op = tokens[p++].t, rhs = term(), lhs = node
      node = op === '+' ? x => lhs(x) + rhs(x) : x => lhs(x) - rhs(x)
    }
    return node
  }

  function term(){
    let node = unary()
    for (;;){
      if (at('*') || at('/')){
        const op = tokens[p++].t, rhs = unary(), lhs = node
        node = op === '*' ? x => lhs(x) * rhs(x) : x => lhs(x) / rhs(x)
      } else if (at('num') || at('name') || at('(') || (at('|') && !abs)){
        /* 記号の省略された掛け算。2x, x(x+1), 3sin x */
        const rhs = unary(), lhs = node
        node = x => lhs(x) * rhs(x)
      } else return node
    }
  }

  function unary(){
    if (at('-')){ p++; const v = unary(); return x => -v(x) }
    if (at('+')){ p++; return unary() }
    return power()
  }

  /* 冪は右結合。2^3^2 は 2^(3^2)。 */
  function power(){
    const base = primary()
    if (at('^')){
      p++
      const ex = unary()
      return x => Math.pow(base(x), ex(x))
    }
    return base
  }

  function primary(){
    if (at('(')){ p++; const v = expr(); eat(')'); return v }
    if (at('|')){ p++; abs++; const v = expr(); abs--; eat('|'); return x => Math.abs(v(x)) }
    if (at('num')){ const v = tokens[p++].v; return () => v }
    if (at('name')){
      const name = tokens[p++].v
      const low = name.toLowerCase()
      if (low in FN){
        const f = FN[low]
        /* sin^2 x のような、関数名に冪が付く書き方 */
        let pw = null
        if (at('^')){ p++; pw = unary() }
        /* 引数は括弧つきでも、sin x のように素のままでも受ける */
        let arg
        if (at('(')){ p++; arg = expr(); eat(')') }
        else arg = power()
        return pw ? x => Math.pow(f(arg(x)), pw(x)) : x => f(arg(x))
      }
      if (low === 'frac'){
        eat('('); const a = expr(); eat(')'); eat('('); const b = expr(); eat(')')
        return x => a(x) / b(x)
      }
      if (low in CONST){ const v = CONST[low]; return () => v }
      if (low === varName) return x => x
      throw new Error('知らない記号: ' + name)
    }
    throw new Error(tokens[p] ? '式が途切れている' : '式が空')
  }

  const root = expr()
  if (p < tokens.length) throw new Error('式の後ろに余りがある')
  return root
}

/* 「y=…」「f(x)=…」の左辺は落とす。右辺だけを関数にする。 */
export function compile(src, varName = 'x'){
  try {
    let s = normalize(src)
    const eq = s.indexOf('=')
    if (eq >= 0){
      const lhs = s.slice(0, eq).trim()
      if (/^(y|f\(x\)|g\(x\)|h\(x\))$/i.test(lhs)) s = s.slice(eq + 1)
      else throw new Error('左辺は y か f(x) だけ')
    }
    if (!s.trim()) return {fn: null, error: '式が空'}
    const fn = parse(tokenize(s), varName.toLowerCase())
    /* 一度走らせて、落ちる式を弾く */
    if (typeof fn(0.37) !== 'number') throw new Error('数にならない')
    return {fn, error: null}
  } catch (e){
    return {fn: null, error: e.message || '式が読めない'}
  }
}
