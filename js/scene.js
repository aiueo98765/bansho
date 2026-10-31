/* ═══════════════════════════════════════════════
   scene.js — 板の中身
   要素は書いた順ではなく「時刻つきの箱」として持つ。
   同じ id に後の時刻が来たら差し替える。消したものは墓標を残す。
   こうしておくと、同じ操作が二度届いても、順番が入れ替わって届いても、
   全員の板が同じ形に落ち着く（最後に書いた人が勝つ）。
   ═══════════════════════════════════════════════ */

export const PAGE_BG = ['plain', 'grid', 'dot', 'line', 'graph']

let seq = 0
export function uid(prefix = 'e'){
  seq = (seq + 1) & 0xffff
  return prefix + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 6)
}

/* 時刻の比較。数が同じときは書いた人の id で決める（全員同じ答えになる） */
function newer(a, b){
  if (!b) return true
  if (a.t !== b.t) return a.t > b.t
  return String(a.by) > String(b.by)
}

/* 一枚目の id は全員で同じにしておく。別々に起動した二人が同じ部屋で
   出会ったとき、ページの id が食い違うと書いたものが迷子になるため。 */
export const FIRST_PAGE = 'p1'

export function createScene({selfId, onChange, onEmit}){
  const els = new Map()          /* id -> 要素 */
  const dead = new Map()         /* id -> 消した時刻 */
  /* ページは消さずに x:1 の印を付ける。消した／足したが行き違っても取り違えない */
  const pgs = new Map([[FIRST_PAGE, {id: FIRST_PAGE, bg: 'grid', o: 0, t: 0, by: ''}]])
  let clock = 1
  const undos = []
  const redos = []
  let sortedFor = null
  let sorted = []
  let quiet = 0

  const bump = () => ++clock
  function sawT(t){ if (t > clock) clock = t }

  /* 墓標は消さずに持ち続ける。あとから遅れて届いた書き込みを跳ね返すため。
     際限なく増えないよう、古いものから落とす */
  const TOMBS = 20000
  function prune(){
    if (dead.size <= TOMBS) return
    const old = [...dead.entries()].sort((a, b) => a[1].t - b[1].t)
    for (let i = 0; i < old.length - TOMBS + 2000; i++) dead.delete(old[i][0])
  }

  function touched(){
    sortedFor = null
    if (!quiet) onChange?.()
  }

  /* ── 読み出し ───────────────────────────── */

  function pageList(){
    return [...pgs.values()]
      .filter(p => !p.x)
      .sort((a, b) => (a.o - b.o) || (a.id < b.id ? -1 : 1))
  }

  function onPage(pid){
    if (sortedFor === pid) return sorted
    const out = []
    for (const e of els.values()) if (e.p === pid) out.push(e)
    out.sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1))
    sortedFor = pid
    sorted = out
    return out
  }

  /* ── 書き込み ───────────────────────────── */

  /* op = {puts:[要素], dels:[id], pages:[ページ]} */
  function merge(op){
    let changed = false
    for (const p of (op.pages || [])){
      if (!p || !p.id) continue
      sawT(p.t || 0)
      const cur = pgs.get(p.id)
      if (newer(p, cur)){ pgs.set(p.id, {...p}); changed = true }
    }
    /* 墓標も要素と同じ「時刻＋書いた人」で持つ。
       どちらが後かを一つのものさしで決めないと、同じ時刻が並んだとき
       届いた順で勝ち負けが変わってしまい、二人の板が食い違う。 */
    for (const d of (op.dels || [])){
      const id = typeof d === 'string' ? d : d.id
      if (!id) continue
      const rec = {t: op.t || 0, by: op.by}
      sawT(rec.t)
      const prev = dead.get(id)
      if (newer(rec, prev)){ dead.set(id, rec); prune() }
      const had = els.get(id)
      if (had && newer(rec, had)){ els.delete(id); changed = true }
    }
    for (const el of (op.puts || [])){
      if (!el || !el.id) continue
      sawT(el.t || 0)
      const tomb = dead.get(el.id)
      if (tomb && !newer(el, tomb)) continue    /* 墓標のほうが後なら置かない */
      const cur = els.get(el.id)
      if (newer(el, cur)){
        els.set(el.id, {...el})
        changed = true
      }
    }
    if (changed) touched()
    return changed
  }

  /* この操作を取り消す操作を作る（まだ流さない） */
  function inverse(op, dels){
    const inv = {puts: [], dels: [], pages: null}
    for (const e of (op.puts || [])){
      const old = els.get(e.id)
      if (old) inv.puts.push({...old}); else inv.dels.push(e.id)
    }
    for (const id of dels){
      const old = els.get(id)
      if (old) inv.puts.push({...old})
    }
    if (op.pages){
      inv.pages = op.pages.map(p => {
        const old = pgs.get(p.id)
        return old ? {...old} : {...p, x: 1}
      })
    }
    return inv
  }

  /* 自分の操作。新しい時刻を振って、戻すための逆操作を積んでから流す */
  function act(op, {undoable = true, emit = true} = {}){
    const t = bump()
    const dels = (op.dels || []).map(e => (typeof e === 'string' ? e : e.id))

    if (undoable){
      const inv = inverse(op, dels)
      if (inv.puts.length || inv.dels.length || inv.pages){
        undos.push(inv)
        if (undos.length > 200) undos.shift()
        redos.length = 0
      }
    }

    const wire = {
      puts: (op.puts || []).map(e => ({...e, t, by: selfId})),
      dels,
      pages: op.pages ? op.pages.map(p => ({...p, t, by: selfId})) : null,
      t, by: selfId,
    }
    merge(wire)
    if (emit) onEmit?.(wire)
    return wire
  }

  /* 戻す／やり直す。相手より新しい時刻で流し直すので、相手の板も戻る */
  function replay(op){
    const t = bump()
    const dels = op.dels || []
    const inv = inverse(op, dels)
    const wire = {
      puts: (op.puts || []).map(e => ({...e, t, by: selfId})),
      dels,
      pages: op.pages ? op.pages.map(p => ({...p, t, by: selfId})) : null,
      t, by: selfId,
    }
    merge(wire)
    onEmit?.(wire)
    return inv
  }

  /* ── 公開 ───────────────────────────────── */

  return {
    get pages(){ return pageList() },
    get selfId(){ return selfId },
    get size(){ return els.size },

    el: id => els.get(id),
    onPage,
    all: () => [...els.values()],

    act,
    merge,

    add(el){ return act({puts: [el]}) },
    put(list){ return act({puts: Array.isArray(list) ? list : [list]}) },
    remove(ids){ return act({dels: ids}) },

    /* 書いている最中は履歴に積まない（線が一本終わってから積む） */
    putQuiet(list){ return act({puts: Array.isArray(list) ? list : [list]}, {undoable: false}) },

    /* 触るページだけ渡す。残りはそのまま */
    putPages(list){ return act({pages: Array.isArray(list) ? list : [list]}) },

    undo(){
      const op = undos.pop()
      if (!op) return false
      redos.push(replay(op))
      if (redos.length > 200) redos.shift()
      return true
    },
    redo(){
      const op = redos.pop()
      if (!op) return false
      undos.push(replay(op))
      return true
    },
    get canUndo(){ return undos.length > 0 },
    get canRedo(){ return redos.length > 0 },

    /* 新しく来た人に渡す一式 */
    snapshot(){
      return {
        v: 3,
        pages: [...pgs.values()].map(p => ({...p})),
        els: [...els.values()],
        dead: [...dead.entries()],
        clock,
      }
    },
    load(snap){
      if (!snap) return
      quiet++
      try {
        if (snap.clock) sawT(snap.clock)
        for (const [id, rec] of (snap.dead || [])){
          /* 古い形（数だけ）の控えも読めるようにしておく */
          const r = typeof rec === 'number' ? {t: rec, by: ''} : rec
          if (r && newer(r, dead.get(id))){ dead.set(id, r); sawT(r.t) }
        }
        prune()
        /* 一枚目しか無い真っ新な板なら、相手のページ立てをそのまま採る */
        const fresh = !els.size && pgs.size === 1
        for (const p of (snap.pages || [])){
          if (!p || !p.id) continue
          if (fresh || newer(p, pgs.get(p.id))) pgs.set(p.id, {...p})
        }
        merge({puts: snap.els || [], t: 0, by: 'snap'})
      } finally { quiet-- }
      touched()
    },
    /* 板を白紙に戻す（墓標を立てるので、相手の板からも消える） */
    clearPage(pid){
      const ids = onPage(pid).map(e => e.id)
      return ids.length ? act({dels: ids}) : null
    },
    get clock(){ return clock },
  }
}
