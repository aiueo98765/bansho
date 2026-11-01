/* ═══════════════════════════════════════════════
   cam.js — 問題を写して、板に置くまで

   写す（スマホのカメラ）か、写真を選ぶ。どちらでも同じ面に出る。
   出たものは js/scan.js が清書した「白地に黒字」。
   そこから、使うところ（問題ひとつ）を選んで板に置く。

   ペンタブにしたスマホでも、パソコンでも、同じこの面を使う。
   ═══════════════════════════════════════════════ */

import {scan, toRGBA, cropGray} from './scan.js'
import {el} from './ui.js'

const SAY = {
  ask: 'カメラをひらきます',
  live: '問題が入るように構えて、まるいボタンで撮ります',
  busy: '読み取っています…',
  done: 'どこを板に置きますか。かたまりを押すか、指でなぞって囲みます',
  corner: '紙の四隅に合わせてください',
}

/* カメラが開かなかった理由を、その場に出す。
   スマホはパソコンと違って、断られた訳が見えないまま終わりやすい */
function whyDenied(e){
  const n = (e && e.name) || ''
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError'){
    return 'カメラが断られました。ブラウザの設定でこの板にカメラを許してください。' +
      'アプリの中で開いたページだと使えないことがあります（Safari や Chrome で開き直すと通ります）'
  }
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'この端末にカメラが見つかりませんでした'
  if (n === 'NotReadableError' || n === 'TrackStartError') return 'カメラが他のアプリに使われています。そちらを閉じてからもう一度'
  if (n === 'SecurityError') return 'この開きかたではカメラを使えません'
  return 'カメラを開けませんでした（' + (n || '訳が分かりません') + '）'
}

/* カメラを呼べる場所かどうか。http:// で開いていると、そもそも口がない */
function camReady(){
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    return 'この住所ではカメラを使えません。https の板（公開しているほう）を開いてください'
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    return 'このブラウザからはカメラを呼べませんでした。写真を選べば読み取れます'
  }
  return ''
}

/* needTap：パソコンから頼まれて開いたときは、スマホで一度押してもらってから
   カメラを呼ぶ。触っていない画面からいきなり呼ぶと、断られる端末がある */
export function openScan({source = 'camera', file = null, needTap = false, onPlace, onClose, onOpen} = {}){
  const root = el('div', {class: 'scanv'})
  const vid = el('video', {class: 'scan-vid', playsinline: '', muted: '', autoplay: ''})
  const cv = el('canvas', {class: 'scan-cv'})
  const say = el('div', {class: 'scan-say'})
  const bar = el('div', {class: 'scan-bar'})
  const x = el('button', {
    class: 'scan-x', type: 'button', 'aria-label': 'やめる',
    html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    onclick: () => close(),
  })
  /* パソコンから頼まれたときに出す、大きな一押し。
     ここを押した指が「触った」証しになり、カメラが開く */
  const big = el('button', {
    class: 'scan-big', type: 'button',
    onclick: startCam,
    html: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M3.5 8.6a2 2 0 0 1 2-2h2l1.3-2h6.4l1.3 2h2a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"/>' +
      '<circle cx="12" cy="12.8" r="3.7"/></svg><span>カメラをひらく</span>',
  })
  vid.muted = true
  root.append(vid, cv, big, say, bar, x)
  document.body.append(root)

  let stream = null, track = null
  let shot = null                 /* 撮った一枚（ImageData） */
  let res = null                  /* 清書 {g, w, h, blocks, quad, stats} */
  let sel = null                  /* 選んでいるところ {x,y,w,h}（清書の中の座標） */
  let corners = null              /* 枠を直しているときの四隅 */
  let state = ''
  let view = {s: 1, ox: 0, oy: 0}
  let drag = null

  /* ── 面を組み替える ── */
  function go(s, msg){
    state = s
    root.dataset.state = s
    say.textContent = msg || SAY[s] || ''
    bar.textContent = ''
    if (s === 'ask'){
      bar.append(btn('写真を選ぶ', 'ghost', pickFile), btn('やめる', 'ghost', () => close()))
    } else if (s === 'deny'){
      bar.append(
        btn('もう一度ひらく', 'go', startCam),
        btn('写真を選ぶ', 'ghost', pickFile),
        btn('やめる', 'ghost', () => close()),
      )
    } else if (s === 'live'){
      bar.append(
        track && torchable() ? btn('灯り', 'ghost', toggleTorch) : el('span', {class: 'scan-gap'}),
        el('button', {class: 'scan-shot', type: 'button', 'aria-label': '撮る', onclick: capture}),
        el('span', {class: 'scan-gap'}),
      )
    } else if (s === 'busy'){
      bar.append(el('div', {class: 'scan-wait'}))
    } else if (s === 'done'){
      bar.append(
        btn(source === 'file' ? '別の写真' : '撮りなおす', 'ghost', again),
        btn('紙の枠を直す', 'ghost', toCorners),
        btn('板に置く', 'go', place),
      )
      draw()
    } else if (s === 'corner'){
      bar.append(
        btn('やめる', 'ghost', () => go('done')),
        btn('枠は使わない', 'ghost', () => redo(null)),
        btn('これで直す', 'go', () => redo(corners)),
      )
      draw()
    }
  }

  function btn(text, cls, onclick){
    return el('button', {class: 'scan-b ' + cls, type: 'button', text, onclick})
  }

  /* ── カメラ ── */

  /* 注文は三段。細かく頼んで駄目なら、ゆるめて頼み直す。
     端末によっては、大きさの注文を付けただけで断られる */
  const WANTS = [
    {video: {facingMode: {ideal: 'environment'}, width: {ideal: 2560}, height: {ideal: 1440}}, audio: false},
    {video: {facingMode: {ideal: 'environment'}}, audio: false},
    {video: true, audio: false},
  ]

  async function startCam(){
    const why = camReady()
    if (why){ go('deny', why); return }
    go('live')
    let err = null
    for (const want of WANTS){
      try {
        stream = await navigator.mediaDevices.getUserMedia(want)
        err = null
        break
      } catch (e){
        err = e
        /* 断られたのなら、ゆるめて頼み直しても同じこと */
        if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) break
      }
    }
    if (!stream){
      console.warn('[板書] カメラが開きませんでした', err)
      go('deny', whyDenied(err))
      return
    }
    track = stream.getVideoTracks()[0]
    vid.srcObject = stream
    try { await vid.play() } catch {}
    go('live')
  }

  function torchable(){
    try { return !!track.getCapabilities?.().torch } catch { return false }
  }
  let torch = false
  async function toggleTorch(){
    torch = !torch
    try { await track.applyConstraints({advanced: [{torch}]}) } catch {}
  }

  function stopCam(){
    try { stream?.getTracks().forEach(t => t.stop()) } catch {}
    stream = null; track = null
    vid.srcObject = null
  }

  /* ── 撮る → 読み取る ── */
  function capture(){
    const w = vid.videoWidth, h = vid.videoHeight
    if (!w || !h) return
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d').drawImage(vid, 0, 0)
    shot = c.getContext('2d').getImageData(0, 0, w, h)
    stopCam()
    run(undefined)
  }

  /* 読み取りは重い。先に「読み取っています」を出してから回す */
  function run(quad){
    go('busy')
    setTimeout(() => {
      try {
        res = scan(shot, quad === undefined ? {} : {quad})
      } catch (e){
        console.warn('[板書] 読み取れませんでした', e)
        say.textContent = '読み取れませんでした'
        return
      }
      sel = pickDefault(res)
      corners = res.quad ? res.quad.map(p => ({...p})) : frameQuad()
      go('done')
    }, 30)
  }

  function redo(quad){ run(quad) }

  /* かたまりがひとつなら、それを選んでおく。いくつもあるなら全部 */
  function pickDefault(r){
    if (r.blocks.length === 1) return {...r.blocks[0]}
    return {x: 0, y: 0, w: r.w, h: r.h}
  }

  function frameQuad(){
    const w = shot.width, h = shot.height, m = 0.1
    return [
      {x: w * m, y: h * m}, {x: w * (1 - m), y: h * m},
      {x: w * (1 - m), y: h * (1 - m)}, {x: w * m, y: h * (1 - m)},
    ]
  }

  function again(){
    if (source === 'file'){ pickFile(); return }
    shot = null; res = null
    startCam()
  }

  function pickFile(){
    const inp = el('input', {type: 'file', accept: 'image/*', style: 'display:none'})
    inp.onchange = () => { if (inp.files[0]) fromFile(inp.files[0]); inp.remove() }
    document.body.append(inp)
    inp.click()
  }

  async function fromFile(f){
    go('busy')
    try {
      const url = URL.createObjectURL(f)
      const im = await new Promise((ok, ng) => {
        const i = new Image()
        i.onload = () => ok(i); i.onerror = ng
        i.src = url
      })
      const k = Math.min(1, 2600 / Math.max(im.naturalWidth, im.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(im.naturalWidth * k)
      c.height = Math.round(im.naturalHeight * k)
      const ctx = c.getContext('2d')
      ctx.drawImage(im, 0, 0, c.width, c.height)
      shot = ctx.getImageData(0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      source = 'file'
      run(undefined)
    } catch (e){
      say.textContent = '写真を読めませんでした'
    }
  }

  /* ── 描く ── */
  function draw(){
    const r = root.getBoundingClientRect()
    const dpr = Math.min(2.5, window.devicePixelRatio || 1)
    const barH = 86, topH = 46
    const vw = r.width, vh = Math.max(40, r.height - barH - topH)
    cv.width = Math.round(vw * dpr)
    cv.height = Math.round(vh * dpr)
    cv.style.width = vw + 'px'
    cv.style.height = vh + 'px'
    cv.style.top = topH + 'px'
    const c = cv.getContext('2d')
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, vw, vh)

    const img = state === 'corner' ? {w: shot.width, h: shot.height} : {w: res.w, h: res.h}
    const s = Math.min(vw / img.w, vh / img.h) * 0.96
    view = {s, ox: (vw - img.w * s) / 2, oy: (vh - img.h * s) / 2}
    c.save()
    c.translate(view.ox, view.oy)
    c.scale(s, s)

    if (state === 'corner'){
      c.drawImage(shotCanvas(), 0, 0)
      c.restore()
      /* 四隅 */
      c.lineWidth = 2
      c.strokeStyle = '#0d7a6a'
      c.beginPath()
      corners.forEach((p, i) => {
        const q = toView(p)
        i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)
      })
      c.closePath()
      c.stroke()
      for (const p of corners){
        const q = toView(p)
        c.beginPath()
        c.arc(q.x, q.y, 13, 0, 7)
        c.fillStyle = 'rgba(13,122,106,.92)'
        c.fill()
        c.strokeStyle = '#fff'
        c.lineWidth = 2.5
        c.stroke()
      }
      return
    }

    c.drawImage(resCanvas(), 0, 0)
    c.restore()

    /* かたまりの候補と、選んでいるところ */
    c.lineWidth = 1.5
    for (const b of res.blocks){
      if (sel && same(b, sel)) continue
      const a = toView({x: b.x, y: b.y}), z = toView({x: b.x + b.w, y: b.y + b.h})
      c.setLineDash([5, 5])
      c.strokeStyle = 'rgba(13,122,106,.5)'
      c.strokeRect(a.x, a.y, z.x - a.x, z.y - a.y)
    }
    c.setLineDash([])
    if (sel){
      const a = toView({x: sel.x, y: sel.y}), z = toView({x: sel.x + sel.w, y: sel.y + sel.h})
      c.save()
      c.fillStyle = 'rgba(10,14,20,.42)'
      c.beginPath()
      c.rect(0, 0, vw, vh)
      c.rect(a.x, a.y, z.x - a.x, z.y - a.y)
      c.fill('evenodd')
      c.restore()
      c.strokeStyle = '#0d7a6a'
      c.lineWidth = 2.5
      c.strokeRect(a.x, a.y, z.x - a.x, z.y - a.y)
    }
  }

  const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  const toView = p => ({x: p.x * view.s + view.ox, y: p.y * view.s + view.oy})
  const toImg = (sx, sy) => ({x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s})

  let shotCv = null
  function shotCanvas(){
    if (shotCv && shotCv.dataset.n === String(shot.width)) return shotCv
    const c = document.createElement('canvas')
    c.width = shot.width; c.height = shot.height
    c.getContext('2d').putImageData(shot, 0, 0)
    c.dataset.n = String(shot.width)
    shotCv = c
    return c
  }
  let resCv = null, resKey = ''
  function resCanvas(){
    const key = res.w + 'x' + res.h + ':' + res.stats.ms
    if (resCv && resKey === key) return resCv
    const c = document.createElement('canvas')
    c.width = res.w; c.height = res.h
    c.getContext('2d').putImageData(new ImageData(toRGBA(res.g, res.w, res.h), res.w, res.h), 0, 0)
    resCv = c; resKey = key
    return c
  }

  /* ── 触る ── */
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId)
    const r = cv.getBoundingClientRect()
    const p = toImg(e.clientX - r.left, e.clientY - r.top)
    if (state === 'corner'){
      let best = -1, bd = 1e9
      corners.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        if (d < bd){ bd = d; best = i }
      })
      if (bd * view.s < 46) drag = {kind: 'corner', i: best}
      return
    }
    drag = {kind: 'box', from: p, moved: 0}
  })

  cv.addEventListener('pointermove', e => {
    if (!drag) return
    const r = cv.getBoundingClientRect()
    const p = toImg(e.clientX - r.left, e.clientY - r.top)
    if (drag.kind === 'corner'){
      corners[drag.i] = {
        x: Math.max(0, Math.min(shot.width, p.x)),
        y: Math.max(0, Math.min(shot.height, p.y)),
      }
      draw()
      return
    }
    drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.from.x, p.y - drag.from.y) * view.s)
    if (drag.moved > 9){
      sel = box(drag.from, p)
      draw()
    }
  })

  cv.addEventListener('pointerup', e => {
    if (!drag) return
    if (drag.kind === 'box' && drag.moved <= 9){
      /* ちょんと触った。そこにあるかたまりを選ぶ。なければ全部に戻す */
      const r = cv.getBoundingClientRect()
      const p = toImg(e.clientX - r.left, e.clientY - r.top)
      const hit = res.blocks.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
      sel = hit ? {...hit} : {x: 0, y: 0, w: res.w, h: res.h}
      draw()
    }
    drag = null
  })

  function box(a, b){
    const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y))
    return {
      x: Math.round(x), y: Math.round(y),
      w: Math.round(Math.min(res.w, Math.max(a.x, b.x)) - x),
      h: Math.round(Math.min(res.h, Math.max(a.y, b.y)) - y),
    }
  }

  function toCorners(){
    corners = res.quad ? res.quad.map(p => ({...p})) : frameQuad()
    go('corner')
  }

  /* ── 板に置く ── */
  function place(){
    const b = sel && sel.w > 12 && sel.h > 12 ? sel : {x: 0, y: 0, w: res.w, h: res.h}
    const cut = cropGray(res.g, res.w, res.h, b)
    const out = encode(cut.g, cut.w, cut.h)
    onPlace?.(out)
    close()
  }

  /* PNG にする。白と黒だけなのでよく縮むが、大きすぎるときは段を下げる */
  function encode(g, w, h){
    let k = 1
    for (let i = 0; i < 4; i++){
      const o = toURL(g, w, h, k)
      if (o.url.length < 820 * 1024 || o.w < 760) return o
      k *= 0.76
    }
    return toURL(g, w, h, 0.4)
  }

  function toURL(g, w, h, k){
    const src = document.createElement('canvas')
    src.width = w; src.height = h
    src.getContext('2d').putImageData(new ImageData(toRGBA(g, w, h), w, h), 0, 0)
    if (k >= 1) return {url: src.toDataURL('image/png'), w, h}
    const cv2 = document.createElement('canvas')
    cv2.width = Math.max(1, Math.round(w * k))
    cv2.height = Math.max(1, Math.round(h * k))
    const c = cv2.getContext('2d')
    c.imageSmoothingQuality = 'high'
    c.fillStyle = '#fff'
    c.fillRect(0, 0, cv2.width, cv2.height)
    c.drawImage(src, 0, 0, cv2.width, cv2.height)
    return {url: cv2.toDataURL('image/png'), w: cv2.width, h: cv2.height}
  }

  /* ── 片付け ── */
  function close(){
    stopCam()
    window.removeEventListener('resize', onResize)
    document.removeEventListener('keydown', onKey)
    root.remove()
    onClose?.()
  }
  function onResize(){ if (state === 'done' || state === 'corner') draw() }
  function onKey(e){
    if (e.key === 'Escape'){ e.stopPropagation(); close() }
  }
  window.addEventListener('resize', onResize)
  document.addEventListener('keydown', onKey)

  onOpen?.()
  if (source === 'file' && file) fromFile(file)
  else if (source === 'file') pickFile()
  else if (needTap) go('ask')
  else startCam()

  return {close}
}
