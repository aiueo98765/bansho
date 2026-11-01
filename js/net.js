/* ═══════════════════════════════════════════════
   net.js — 相手とつなぐ
   サーバーは持たない。公開リレーで相手を見つけたら、あとは端末同士の直通。
   板の中身はリレーを通らない。

   送るものは六種類。
     op  … 板への操作（確定・取り落としたら困る）
     lv  … いま書いている最中の線（捨てられてよい）
     cu  … 指先の位置
     sn  … 入ってきた人へ渡す板まるごと
     vw  … 画面の位置（「みんなの画面を合わせる」用）
     lz  … 指し棒
   ═══════════════════════════════════════════════ */

import {joinNostr, joinMqtt, selfId} from '../vendor/trystero.js'

const APP_ID = 'bansho-v1'

/* 相手を見つけるためだけに使う公開リレー。長く生きている先に絞ってある */
const RELAYS = {
  nostr: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.snort.social',
    'wss://offchain.pub',
    'wss://nostr.mom',
  ],
  mqtt: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://public:public@public.cloud.shiftr.io',
  ],
}

export {selfId}

export const PEER_COLORS = [
  '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

function hash(s){
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) & 0x7fffffff
  return h
}

export function colorFor(id){
  return PEER_COLORS[hash(String(id)) % PEER_COLORS.length]
}

export function createNet(opts){
  const {
    roomCode, route = 'nostr',
    onOp, onLive, onPeers, onSnapshot, onView, onStatus, onLaser,
    onScreenView, onTabletCam, onTabletHello, onScanAsk,
    getSnapshot, getMe,
  } = opts

  let room = null
  let alive = false
  let acts = null
  const peers = new Map()        /* id -> {name, col, cursor, page, at} */
  const pendingGive = new Map()  /* 板を渡そうとしている相手 -> 取り消し */
  let askTimer = 0
  let beat = 0
  let gotSnap = false

  function status(extra){
    onStatus?.({
      peers: peers.size,
      state: !alive ? 'off' : peers.size ? 'live' : 'seeking',
      route, room: roomCode, ...extra,
    })
  }

  function pushPeers(){
    onPeers?.([...peers.entries()].map(([id, p]) => ({id, ...p})))
  }

  const fire = (a, d, target) => {
    if (!a) return
    try { a.send(d, target ? {target} : {}) } catch {}
  }

  function join(){
    leave()
    gotSnap = false
    const joinRoom = route === 'mqtt' ? joinMqtt : joinNostr
    const config = {
      appId: APP_ID,
      /* 画像を貼ると大きくなるので、受け取る上限は広めに取る */
      maxReceiveBytes: 24 * 1024 * 1024,
      relayConfig: {urls: RELAYS[route] || RELAYS.nostr, redundancy: 4, warnOnRelayFailure: false},
      rtcConfig: {
        iceServers: [
          {urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']},
          {urls: ['stun:stun.cloudflare.com:3478']},
        ],
      },
    }
    try {
      room = joinRoom(config, APP_ID + '-' + roomCode, {
        onJoinError: d => { alive = false; status({error: (d && d.error) || 'join'}) },
      })
    } catch (e){
      alive = false
      status({error: String((e && e.message) || e)})
      return
    }
    alive = true

    let A
    try {
      A = {}
      for (const n of ['op', 'lv', 'cu', 'wh', 'sn', 'ak', 'gt', 'vw', 'lz', 'tv', 'tc', 'cs']) A[n] = room.makeAction(n)
    } catch (e){
      alive = false
      status({error: String((e && e.message) || e)})
      return
    }
    acts = A

    A.op.onMessage = d => { if (d && (d.puts || d.dels || d.pages)) onOp?.(d) }
    A.lv.onMessage = (d, {peerId}) => { if (d) onLive?.(d, peerId) }

    A.cu.onMessage = (d, {peerId}) => {
      const p = peers.get(peerId)
      if (!p || !d) return
      p.cursor = d.x == null ? null : {x: d.x, y: d.y}
      p.page = d.p
      p.at = Date.now()
      pushPeers()
    }

    A.wh.onMessage = (d, {peerId}) => {
      const prev = peers.get(peerId) || {}
      const tab = !!(d && d.t)
      peers.set(peerId, {
        ...prev,
        name: String((d && d.n) || '?').slice(0, 14),
        col: (d && d.c) || colorFor(peerId),
        tab,
      })
      pushPeers()
      status()
      /* 相手がペンタブなら、こちらの画面の見え方をすぐ渡す */
      if (tab && !getMe?.().tablet) onTabletHello?.(peerId)
    }

    /* 画面側 → ペンタブ側へ「いまここが映っている」 */
    A.tv.onMessage = (d, {peerId}) => onScreenView?.(d, peerId)
    /* ペンタブ側 → 画面側へ「ここを映して」 */
    A.tc.onMessage = (d, {peerId}) => onTabletCam?.(d, peerId)

    A.sn.onMessage = (d, {peerId}) => {
      if (!d) return
      onSnapshot?.(d, peerId)
      if (!gotSnap){
        gotSnap = true
        fire(A.gt, {})          /* もう足りた。他の人は送らなくていい */
      }
    }

    A.ak.onMessage = (d, {peerId}) => {
      /* 入ってきた人へ板を渡す。皆が一斉に送らないよう、自分の id で待ち時間をずらす */
      const snap = getSnapshot?.()
      if (!snap || (!snap.els?.length && !(snap.pages?.length > 1))) return
      const h = setTimeout(() => {
        pendingGive.delete(peerId)
        fire(A.sn, getSnapshot?.(), peerId)
      }, 150 + (hash(selfId) % 550))
      pendingGive.set(peerId, h)
    }

    A.gt.onMessage = (d, {peerId}) => {
      const h = pendingGive.get(peerId)
      if (h){ clearTimeout(h); pendingGive.delete(peerId) }
    }

    /* 画面側 → ペンタブ側へ「問題を写して」。撮った一枚は普通の操作として board に流れる */
    A.cs.onMessage = (d, {peerId}) => onScanAsk?.(d, peerId)

    A.vw.onMessage = (d, {peerId}) => onView?.(d, peerId)
    A.lz.onMessage = (d, {peerId}) => onLaser?.(d, peerId)

    room.onPeerJoin = id => {
      peers.set(id, {name: '…', col: colorFor(id), cursor: null, at: Date.now()})
      const me = getMe?.() || {}
      fire(A.wh, {n: me.name, c: me.col, t: me.tablet ? 1 : 0}, id)
      pushPeers()
      status()
    }

    room.onPeerLeave = id => {
      peers.delete(id)
      const h = pendingGive.get(id)
      if (h) clearTimeout(h)
      pendingGive.delete(id)
      pushPeers()
      status()
    }

    /* 先にいる人から板をもらう。誰もいなければ自分が最初の人 */
    clearTimeout(askTimer)
    askTimer = setTimeout(() => {
      const me = getMe?.() || {}
      fire(A.wh, {n: me.name, c: me.col, t: me.tablet ? 1 : 0})
      if (room && Object.keys(room.getPeers()).length) fire(A.ak, {})
    }, 1200)

    clearInterval(beat)
    beat = setInterval(() => {
      const me = getMe?.() || {}
      fire(A.wh, {n: me.name, c: me.col, t: me.tablet ? 1 : 0})
      status()
    }, 20000)

    status()
  }

  function leave(){
    clearTimeout(askTimer)
    clearInterval(beat)
    for (const h of pendingGive.values()) clearTimeout(h)
    pendingGive.clear()
    if (room){ try { room.leave() } catch {} }
    room = null
    acts = null
    alive = false
    peers.clear()
    pushPeers()
  }

  return {
    selfId,
    join, leave,
    get alive(){ return alive },
    get peers(){ return [...peers.entries()].map(([id, p]) => ({id, ...p})) },
    get count(){ return peers.size },
    op: d => fire(acts?.op, d),
    live: d => fire(acts?.lv, d),
    cursor: d => fire(acts?.cu, d),
    view: d => fire(acts?.vw, d),
    laser: d => fire(acts?.lz, d),
    askScan: target => fire(acts?.cs, {}, target),
    screenView: (d, target) => fire(acts?.tv, d, target),
    tabletCam: (d, target) => fire(acts?.tc, d, target),
    hello: () => { const me = getMe?.() || {}; fire(acts?.wh, {n: me.name, c: me.col, t: me.tablet ? 1 : 0}) },
    pushSnapshot: () => fire(acts?.sn, getSnapshot?.()),
  }
}

/* 部屋の名前。読み上げて伝えられる長さにする（紛れる字は外した） */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newRoomCode(){
  const a = new Uint8Array(6)
  crypto.getRandomValues(a)
  let s = ''
  for (const v of a) s += ALPHA[v % ALPHA.length]
  return s.slice(0, 3) + '-' + s.slice(3)
}

export function cleanRoomCode(s){
  const t = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  if (!t) return ''
  return t.length > 3 ? t.slice(0, 3) + '-' + t.slice(3) : t
}
