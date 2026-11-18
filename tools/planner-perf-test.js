// Run with Node. Exercise the frame queue, month cache and texture uploads without WeChat or cloud storage.
const assert = require('assert')
const store = require('../miniprogram/utils/store')
const { Planner } = require('../miniprogram/scene/planner')
const date = require('../miniprogram/utils/date')

global.wx = { getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {} }
const frames = new Map()
let nextId = 0, renders = 0, shadowPasses = 0
const p = Object.assign(Object.create(Planner.prototype), {
  frameId: null, tweens: [], state: { y: 2026, m: 11 },
  canvas: {
    requestAnimationFrame(fn) { frames.set(++nextId, fn); return nextId },
    cancelAnimationFrame(id) { assert.ok(frames.delete(id)) }
  },
  renderer: {
    shadowMap: {},
    render() {
      renders++
      if (this.shadowMap.needsUpdate) shadowPasses++
      this.shadowMap.needsUpdate = false
    }
  }
})
p.tick = p.tick.bind(p)
function step() {
  assert.strictEqual(frames.size, 1)
  const [id, fn] = frames.entries().next().value
  frames.delete(id)
  fn()
}

p.resume()
p.invalidate()
p.invalidate()
step()
assert.strictEqual(frames.size, 0)
assert.strictEqual(renders, 1)
assert.strictEqual(shadowPasses, 1)
const tw = p.tween(1000, () => {})
step()
tw.t0 = Date.now() - 1100
step()
assert.strictEqual(frames.size, 0)
assert.strictEqual(shadowPasses, 1)
p.invalidate()
p.pause()
assert.strictEqual(frames.size, 0)
p.invalidate()
assert.strictEqual(frames.size, 0)
p.resume()
step()
console.log('  ok   frames coalesce, animations wake and settle, pause cancels, camera-only frames reuse shadows')

let paints = 0, meshLoads = 0, uploads = 0, mipmaps = 0
p.texTop = {}
p.texSpare = {}
p.texTop.generateMipmaps = true
p.painter = {
  month() { paints++; return { width: 3, height: 2, data: new Uint8Array(24) } },
  updateDraft() { return { x: 1, y: 0, width: 1, height: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) } }
}
p.THREE = { DataTexture: class {} }
p.renderer.getContext = () => ({ pixelStorei() {}, generateMipmap() { mipmaps++ } })
p.renderer.copyTextureToTexture = (pos, src, dest) => {
  assert.strictEqual(src.image, pos)
  assert.strictEqual(dest, p.texTop)
  uploads++
}
p.loadStickers = function () {
  meshLoads++
  this.decoSource = store.getMonthDeco(date.ym(this.state.y, this.state.m))
}
p.draft = null
p.refresh()
p.refresh()
assert.deepStrictEqual([paints, meshLoads], [1, 1])
store.applyRemote('yp:m:2026-12', { 1: { plan: 'another month' } })
p.refresh()
assert.strictEqual(paints, 1)
store.applyRemote('yp:d:2026-11', [{ id: 'new' }])
p.refresh()
assert.deepStrictEqual([paints, meshLoads], [1, 2])
store.applyRemote('yp:m:2026-11', { 8: { plan: 'a note' } })
p.refresh()
store.setSetting('weekStart', 0)
p.refresh()
assert.strictEqual(paints, 3)
p.setDraft(8, 'first')
p.setDraft(8, 'second')
assert.strictEqual(paints, 4)
assert.deepStrictEqual([uploads, mipmaps], [1, 1])
assert.deepStrictEqual([...p.texTop.image.data], [0,0,0,0, 1,2,3,4, 0,0,0,0, 0,0,0,0, 5,6,7,8, 0,0,0,0])
p.setDraft(0)
p.flip = {}
store.applyRemote('yp:m:2026-11', undefined)
p.refresh()
assert.strictEqual(paints, 5)
p.flip = null
p.refresh()
assert.strictEqual(paints, 6)
p.paint(p.texSpare, 2026, 12, null)
p.paint(p.texSpare, 2026, 12, null)
assert.strictEqual(paints, 7)
p.drawMonth(p.texTop)
assert.strictEqual(paints, 7)
p.atlasReady = true
p.drawMonth(p.texTop)
assert.strictEqual(paints, 8)
console.log('  ok   page textures reuse unchanged inputs, keep CPU patches, and invalidate after sync/settings/atlas changes')

// A top-edge patch on a flipped ink texture starts at the bottom in WebGL.
const ink = { flipY: true, image: { width: 2, height: 5, data: new Uint8Array(40) } }
const stripe = { x: 0, y: 0, width: 1, height: 2, data: Uint8Array.from([1,2,3,4, 5,6,7,8]) }
let unpackFlip
p.renderer.getContext = () => ({
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  pixelStorei(key, value) { if (key === this.UNPACK_FLIP_Y_WEBGL) unpackFlip = value }
})
p.renderer.copyTextureToTexture = (offset, src, dest) => {
  assert.strictEqual(unpackFlip, true)
  assert.deepStrictEqual(offset, { x: 0, y: 3 })
  assert.strictEqual(src.image, stripe)
  assert.strictEqual(dest, ink)
}
p.patchTexture(ink, stripe)
assert.deepStrictEqual([...ink.image.data.slice(0, 12)], [1,2,3,4, 0,0,0,0, 5,6,7,8])
console.log('  ok   partial ink uploads preserve the full texture orientation')

// Midnight, leap day and tombstones affect both the profile and the stamp cards.
date.today = () => ({ y: 2024, m: 3, d: 1, key: '2024-03-01' })
store.applyRemote('yp:h:2024-02', { habit: { 27: 1, 28: 1, 29: 1 } })
store.applyRemote('yp:m:2024-02', { 27: { gone: 1 }, 28: {}, 29: {} })
assert.strictEqual(store.habitStreak('habit'), 3)
assert.strictEqual(store.stats().streak, 2)
store.toggleHabit('habit', '2024-03-01')
assert.strictEqual(store.habitStreak('habit'), 4)
console.log('  ok   streaks cross leap day and stop at deleted entries')

let home
global.Page = definition => { home = definition }
require('../miniprogram/pages/home/index')
const editor = {
  data: { ink: { key: '2026-11-08', value: 'opened text' } },
  planner: { setDraft() {}, unfocus() {} },
  layout() {}
}
store.saveDay(editor.data.ink.key, { plan: 'updated on another device' })
editor.inkValue = 'opened text'
home.endInk.call(editor)
assert.strictEqual(store.getDay(editor.data.ink.key).plan, 'updated on another device')
editor.inkValue = 'new local edit'
home.endInk.call(editor)
assert.strictEqual(store.getDay(editor.data.ink.key).plan, 'new local edit')
console.log('  ok   closing an unchanged cell preserves sync updates; edits still save')
