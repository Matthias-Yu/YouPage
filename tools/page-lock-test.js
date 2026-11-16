// Run with Node or the DevTools runtime: node tools/page-lock-test.js
// Exercise real page and gesture handlers with in-memory storage and mesh stand-ins.
const assert = require('assert')
const memory = {}
const clone = value => JSON.parse(JSON.stringify(value))
let modal
let writes = 0
global.wx = {
  getStorageSync: key => key in memory ? clone(memory[key]) : '',
  setStorageSync(key, value) { memory[key] = clone(value); writes++ },
  getStorageInfoSync: () => ({ keys: Object.keys(memory) }),
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812, pixelRatio: 2 }),
  showToast() {},
  showModal(options) { modal = options }
}

const store = require('../miniprogram/utils/store')
const date = require('../miniprogram/utils/date')
const { Planner } = require('../miniprogram/scene/planner')
let home
global.Page = options => { home = options }
require('../miniprogram/pages/home/index')
store.setSetting('sound', false)

const KEY = '2099-02'
const savedStickers = [
  { id: 'first', t: 's', k: 's01', x: 0.3, y: 0.4, s: 1, r: 0 },
  { id: 'second', t: 's', k: 's19', x: 0.6, y: 0.7, s: 1, r: 5 }
]
const savedInk = [{ tool: 'pen', color: '#303030', width: 5, points: [100, 100, 150, 150] }]

function vector() {
  return { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }) } }
}

function scene(locked = false) {
  store.saveMonthDeco(KEY, clone(savedStickers))
  store.saveMonthInk(KEY, clone(savedInk))
  const planner = Object.assign(Object.create(Planner.prototype), {
    locked, w: 375, h: 600,
    state: { open: true, t: 1, y: 2099, m: 2, focus: false },
    rig: { az: 0, el: 0, dist: 60, tx: 5, ty: 0 },
    tweens: [], events: [], pickables: [], target: 'page', stickerHits: true,
    camera: { updateMatrixWorld() {} },
    pageMesh: { position: { z: 1.3 } },
    inkMesh: { visible: false }, strip: { visible: false },
    layout: { cells: [{ inMonth: true, d: 16, key: '2099-02-16', x: 0, y: 0, w: 1024, h: 1443 }] },
    emit(type, payload) { this.events.push({ type, payload }) },
    applyRig() {}, drawMonth() {}, frame() {}, restTail() {},
    resize(w, h) { this.w = w; this.h = h },
    animateHeight(h, update) { this.h = h; update(h, 1) },
    pagePoint(x, y) { return { x: x / 100, y: -y / 100 } },
    stickerMesh(st) { return { userData: { type: 'sticker', st }, position: vector(), scale: vector(), rotation: vector() } },
    // Geometry and animation are outside these interaction tests.
    beginFlip(dir, to) { this.flip = { dir, to: to || date.addMonths(this.state.y, this.state.m, dir), k: 0 }; return true },
    setFlipK(k) { this.flip.k = k },
    endFlip(commit) { if (commit) Object.assign(this.state, this.flip.to); this.flip = null },
    setOpen(open) { this.state.open = open },
    nextRoll() { this.rollChanged = true }
  })
  planner.stickerG = {
    children: [],
    add(mesh) { this.children.push(mesh) },
    remove(mesh) { this.children = this.children.filter(child => child !== mesh) }
  }
  planner.raycaster = {
    setFromCamera() {},
    intersectObjects(objects) {
      if (objects === planner.stickerG.children) return planner.stickerHits ? objects.map(object => ({ object })) : []
      return [{ object: { userData: { type: planner.target } }, point: { x: 5, y: 0 } }]
    }
  }
  planner.loadStickers()
  return planner
}

function page(planner) {
  return Object.assign({}, home, {
    data: { ...clone(home.data), locked: planner.locked, open: true, ready: true, y: 2099, m: 2 },
    planner, winW: 375, winH: 812,
    setData(patch, done) { Object.assign(this.data, patch); if (done) done() }
  })
}

function test(name, run) {
  try {
    run()
    console.log('  ok   ' + name)
  } catch (error) {
    console.error('  FAIL ' + name, error)
    process.exitCode = 1
  }
}

const first = { id: 1, x: 100, y: 100 }

test('old settings default to unlocked; locking survives page reload', () => {
  assert.strictEqual(store.getSettings().pageLocked, false)
  const p = page(scene())
  p.togglePageLock()
  assert.strictEqual(memory['yp:settings'].pageLocked, true)
  const reloaded = page(scene())
  reloaded.onLoad()
  assert.strictEqual(reloaded.data.locked, true)
  reloaded.offSync()
  assert.strictEqual(store.isSyncable('yp:settings'), false)
})

test('dragging and pinching over a locked sticker moves the view without editing storage', () => {
  const p = scene(true)
  const before = writes
  p.touchStart([first])
  assert.strictEqual(p.g.hit.type, 'page')
  assert.ok(!p.grabbed)
  p.touchMove([{ ...first, y: 180 }])
  assert.notStrictEqual(p.rig.el, 0)
  p.touchEnd([])
  p.touchStart([first])
  p.touchStart([first, { id: 2, x: 200, y: 100 }])
  p.touchMove([first, { id: 2, x: 300, y: 100 }])
  assert.strictEqual(p.rig.dist, 30)
  p.touchEnd([])
  assert.strictEqual(writes, before)
  assert.deepStrictEqual(p.stickers, savedStickers)
  assert.deepStrictEqual(store.getMonthDeco(KEY), savedStickers)
})

test('locked pages allow month swipes, month buttons, anchored zoom, and cover controls', () => {
  const p = scene(true)
  p.touchStart([first])
  p.touchMove([{ ...first, x: -100 }])
  assert.strictEqual(p.g.mode, 'flip')
  p.touchEnd([])
  assert.strictEqual(p.state.m, 3)
  p.setMonth(2099, 4)
  assert.strictEqual(p.state.m, 4)
  const zoom = p.startCalendarZoom([first, { id: 2, x: 200, y: 100 }])
  assert.ok(zoom)
  p.moveCalendarZoom(zoom, [first, { id: 2, x: 300, y: 100 }])
  assert.strictEqual(p.rig.dist, 30)
  p.tap({ type: 'cover' })
  assert.strictEqual(p.state.open, false)
})

test('locked taps and tape gestures cannot open writing or add decorations', () => {
  const p = scene(true)
  const before = writes
  p.touchStart([first])
  p.touchEnd([])
  assert.ok(!p.events.some(event => event.type === 'cell'))
  p.target = 'roll'
  p.touchStart([first])
  p.touchMove([{ ...first, y: 180 }])
  assert.strictEqual(p.g.mode, 'orbit')
  p.touchEnd([])
  p.tap({ type: 'roll' })
  assert.ok(!p.pull && !p.rollChanged)
  assert.strictEqual(p.addSticker('s', 's01'), false)
  p.previewAt('s', 's01', 100, 100)
  assert.ok(!p.preview)
  assert.strictEqual(p.focusCell(16), false)
  assert.strictEqual(p.inkPoint(100, 100), null)
  p.setDrawing(true)
  assert.strictEqual(p.drawing, false)
  assert.strictEqual(writes, before)
})

test('locking mid-drag restores sticker position, scale, rotation, and stacking', () => {
  const p = scene()
  p.touchStart([first])
  p.touchMove([{ ...first, x: 140, y: 180 }])
  p.touchStart([first, { id: 2, x: 200, y: 100 }])
  p.touchMove([first, { id: 2, x: 250, y: 150 }])
  assert.notDeepStrictEqual(p.stickers, savedStickers)
  const before = writes
  p.setLocked(true)
  p.touchMove([{ ...first, x: 2000, y: 1000 }])
  p.touchEnd([])
  assert.ok(!p.grabbed && !p.g)
  assert.deepStrictEqual(p.stickers, savedStickers)
  assert.strictEqual(writes, before)
  assert.deepStrictEqual(store.getMonthDeco(KEY), savedStickers)
})

test('locking discards a pending sticker or torn tape and settles an unfinished page swipe', () => {
  const p = scene()
  p.previewAt('t', 'gingham', 100, 100)
  p.pull = { torn: true }
  p.strip.visible = true
  const before = writes
  p.setLocked(true)
  assert.ok(!p.preview && !p.pull && !p.strip.visible)
  assert.strictEqual(p.commitPreview(), false)
  assert.strictEqual(writes, before)
  p.beginFlip(1)
  p.setLocked(false)
  assert.ok(!p.flip)
  assert.strictEqual(p.state.m, 2)
})

test('lock button exits editing and cancels a pending stroke and late clear confirmation', () => {
  const p = page(scene())
  const start = { identifier: 1, x: 100, y: 100 }
  const moved = { identifier: 1, x: 130, y: 150 }
  p.toggleTools()
  p.clearInk()
  const confirmation = modal
  assert.ok(confirmation && p.confirmingClear)
  p.onTouchStart({ touches: [start] })
  assert.ok(p.stroke)
  p.togglePageLock()
  p.onTouchMove({ touches: [moved] })
  p.onTouchEnd({ touches: [], changedTouches: [moved] })
  assert.ok(p.data.locked && p.planner.locked)
  assert.ok(!p.stroke && !p.data.toolsOpen && !p.planner.drawing)
  confirmation.success({ confirm: true })
  const before = writes
  p.undoInk()
  p.redoInk()
  p.clearInk()
  p.startStroke(first)
  p.startInk({ d: 16, key: '2099-02-16' })
  p.toggleTools()
  p.toggleTray()
  p.pickCropDay()
  p.trayStart({ touches: [{ clientX: 100, clientY: 100 }], currentTarget: { dataset: { t: 's', k: 's01' } } })
  p.trayEnd()
  assert.ok(!p.data.ink && !p.stroke && !p.data.toolsOpen && !p.data.tray && !p.data.pickingDay)
  assert.strictEqual(writes, before)
  assert.deepStrictEqual(store.getMonthInk(KEY), savedInk)
  assert.deepStrictEqual(store.getMonthDeco(KEY), savedStickers)
  p.togglePageLock()
  confirmation.success({ confirm: true })
  assert.deepStrictEqual(store.getMonthInk(KEY), savedInk)
  assert.strictEqual(memory['yp:settings'].pageLocked, false)
  p.toggleTools()
  p.onTouchStart({ touches: [start] })
  p.onTouchMove({ touches: [moved] })
  p.onTouchEnd({ touches: [], changedTouches: [moved] })
  assert.strictEqual(store.getMonthInk(KEY).length, savedInk.length + 1)
})

test('unlocking restores sticker movement and date-tap editing', () => {
  const p = scene(true)
  p.setLocked(false)
  p.touchStart([first])
  assert.ok(p.grabbed)
  p.touchMove([{ ...first, x: 140, y: 180 }])
  p.touchEnd([])
  assert.notDeepStrictEqual(store.getMonthDeco(KEY), savedStickers)
  p.stickerHits = false
  p.touchStart([first])
  p.touchEnd([])
  assert.ok(p.events.some(event => event.type === 'cell'))
})
