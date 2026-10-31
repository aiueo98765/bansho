/* ═══════════════════════════════════════════════
   store.js — 手元に残す
   板は端末の中（IndexedDB）にだけ残る。部屋ごとに一枚。
   閉じて開き直しても続きから書ける。設定は localStorage。
   ═══════════════════════════════════════════════ */

const DB = 'bansho'
const SHELF = 'boards'
let dbp = null

function open(){
  if (dbp) return dbp
  dbp = new Promise((res, rej) => {
    let rq
    try { rq = indexedDB.open(DB, 1) } catch (e){ return rej(e) }
    rq.onupgradeneeded = () => {
      const db = rq.result
      if (!db.objectStoreNames.contains(SHELF)) db.createObjectStore(SHELF, {keyPath: 'room'})
    }
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => rej(rq.error)
  }).catch(e => { console.warn('[板書] 保存庫が開けません', e); return null })
  return dbp
}

function tx(mode){
  return open().then(db => (db ? db.transaction(SHELF, mode).objectStore(SHELF) : null))
}

export async function save(room, snapshot){
  const s = await tx('readwrite')
  if (!s) return
  return new Promise(res => {
    const rq = s.put({room, snapshot, at: Date.now()})
    rq.onsuccess = () => res(true)
    rq.onerror = () => res(false)
  })
}

export async function load(room){
  const s = await tx('readonly')
  if (!s) return null
  return new Promise(res => {
    const rq = s.get(room)
    rq.onsuccess = () => res(rq.result ? rq.result.snapshot : null)
    rq.onerror = () => res(null)
  })
}

export async function listBoards(){
  const s = await tx('readonly')
  if (!s) return []
  return new Promise(res => {
    const rq = s.getAll()
    rq.onsuccess = () => res((rq.result || [])
      .map(r => ({room: r.room, at: r.at, n: (r.snapshot?.els || []).length}))
      .sort((a, b) => b.at - a.at))
    rq.onerror = () => res([])
  })
}

export async function drop(room){
  const s = await tx('readwrite')
  if (!s) return
  return new Promise(res => { const rq = s.delete(room); rq.onsuccess = () => res(true); rq.onerror = () => res(false) })
}

/* 書くたびに保存すると重いので、手が止まってからまとめて書く */
export function autosave(getRoom, getSnapshot, ms = 700){
  let t = 0
  let last = 0
  return {
    nudge(){
      clearTimeout(t)
      t = setTimeout(() => {
        const room = getRoom()
        if (!room) return
        save(room, getSnapshot())
        last = Date.now()
      }, ms)
    },
    flush(){
      clearTimeout(t)
      const room = getRoom()
      if (room) save(room, getSnapshot())
    },
    get lastAt(){ return last },
  }
}

/* ── 設定 ─────────────────────────────────── */

const PREF = 'bansho.pref'

export function prefs(){
  try { return JSON.parse(localStorage.getItem(PREF) || '{}') } catch { return {} }
}

export function setPref(patch){
  try {
    const p = {...prefs(), ...patch}
    localStorage.setItem(PREF, JSON.stringify(p))
    return p
  } catch { return prefs() }
}
