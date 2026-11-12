// 音效：全部在手机上用 WebAudio 现场合成，不放音频文件、不占包体。
//   bell   挂件晃动时的小铃铛（几个不成谐波的泛音 + 里面小珠子的碰撞声）
//   peel   从胶带卷上撕拉胶带（一串细碎的「咔啦」声）
//   tear   胶带撕断
//   flip   翻一页纸
//   cover  翻开 / 合上封皮
//   stick  贴纸按到纸上
// 「我的」里可以关掉（设置项 sound）。

const store = require('./store')

let ctx = null
let broken = false
const cache = {}

function context() {
  if (ctx || broken) return ctx
  try {
    if (typeof wx.createWebAudioContext !== 'function') {
      broken = true
      return null
    }
    ctx = wx.createWebAudioContext()
  } catch (e) {
    console.warn('[sound] WebAudio unavailable', e)
    broken = true
  }
  return ctx
}

// 固定种子的随机数，每次合成出来的声音都一样
function rng(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function normalize(buf, peak) {
  let max = 0
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]))
  if (max > 0) {
    const k = peak / max
    for (let i = 0; i < buf.length; i++) buf[i] *= k
  }
  return buf
}

// 一下极短的「咔」：高通过的噪声，几毫秒衰减完
function tick(buf, rate, at, amp, rand, tau) {
  const start = Math.floor(at * rate)
  const n = Math.floor(rate * tau * 6)
  let prev = 0
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const w = rand() * 2 - 1
    buf[start + i] += (w - prev) * amp * Math.exp(-i / (rate * tau))
    prev = w
  }
}

// 低沉的一下「咚」
function thump(buf, rate, at, freq, amp, tau) {
  const start = Math.floor(at * rate)
  const n = Math.floor(rate * tau * 6)
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / rate
    buf[start + i] += Math.sin(2 * Math.PI * freq * t * (1 - 0.3 * t / (tau * 6))) * amp * Math.exp(-t / tau) * Math.min(1, i / (rate * 0.002))
  }
}

// 纸张摩擦的「唰」：噪声过两级一阶低通，取差得到一段带通，再套一个先强后弱的包络
function swish(buf, rate, at, dur, amp, lo, hi, rand) {
  const start = Math.floor(at * rate)
  const n = Math.floor(rate * dur)
  let a = 0, b = 0
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const k = i / n
    const alpha = lo + (hi - lo) * Math.sin(Math.PI * k)
    a += (rand() * 2 - 1 - a) * alpha
    b += (a - b) * alpha * 0.35
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.15)), 2)
    buf[start + i] += (a - b) * amp * env
  }
}

const SYNTH = {
  bell(rate) {
    const buf = new Float32Array(Math.floor(rate * 1.5))
    const rand = rng(7)
    const ratios = [1, 1.53, 2.31, 2.98, 3.87]
    const amps = [1, 0.55, 0.42, 0.25, 0.16]
    const taus = [0.5, 0.32, 0.2, 0.14, 0.09]
    // 晃一下会响好几声，一声比一声轻
    const hits = [[0, 1], [0.12, 0.5], [0.29, 0.28], [0.5, 0.12]]
    hits.forEach(([at, amp], h) => {
      const f0 = 2350 * (1 + (h % 2 ? 0.012 : -0.006))
      const start = Math.floor(at * rate)
      for (let i = start; i < buf.length; i++) {
        const t = (i - start) / rate
        const attack = Math.min(1, t / 0.0015)
        let v = 0
        for (let p = 0; p < ratios.length; p++) v += amps[p] * Math.exp(-t / taus[p]) * Math.sin(2 * Math.PI * f0 * ratios[p] * t + p)
        buf[i] += v * amp * attack
      }
      tick(buf, rate, at, amp * 0.8, rand, 0.0008)
    })
    return normalize(buf, 0.42)
  },

  peel(rate) {
    const dur = 0.3
    const buf = new Float32Array(Math.floor(rate * dur))
    const rand = rng(11)
    for (let i = 0; i < 46; i++) tick(buf, rate, dur * 0.92 * Math.pow(rand(), 1.4), 0.3 + rand() * 0.7, rand, 0.0005 + rand() * 0.0006)
    swish(buf, rate, 0, dur, 0.18, 0.35, 0.7, rand)
    return normalize(buf, 0.3)
  },

  tear(rate) {
    const dur = 0.2
    const buf = new Float32Array(Math.floor(rate * dur))
    const rand = rng(23)
    let prev = 0
    for (let i = 0; i < buf.length; i++) {
      const t = i / rate
      const w = rand() * 2 - 1
      buf[i] += (w - prev) * Math.min(1, t / 0.003) * Math.exp(-t / 0.035)
      prev = w
    }
    for (let i = 0; i < 8; i++) tick(buf, rate, rand() * 0.06, 0.6 + rand() * 0.4, rand, 0.0006)
    return normalize(buf, 0.5)
  },

  flip(rate) {
    const buf = new Float32Array(Math.floor(rate * 0.46))
    const rand = rng(31)
    swish(buf, rate, 0, 0.4, 1, 0.08, 0.42, rand)
    thump(buf, rate, 0.37, 150, 0.35, 0.02)
    return normalize(buf, 0.28)
  },

  cover(rate) {
    const buf = new Float32Array(Math.floor(rate * 0.7))
    const rand = rng(41)
    swish(buf, rate, 0, 0.55, 1, 0.03, 0.18, rand)
    thump(buf, rate, 0.55, 95, 1.2, 0.05)
    return normalize(buf, 0.34)
  },

  stick(rate) {
    const buf = new Float32Array(Math.floor(rate * 0.1))
    const rand = rng(53)
    thump(buf, rate, 0, 210, 1, 0.016)
    tick(buf, rate, 0, 0.25, rand, 0.003)
    return normalize(buf, 0.32)
  }
}

function enabled() {
  return store.getSettings().sound !== false
}

function play(name) {
  if (!SYNTH[name] || !enabled()) return
  const c = context()
  if (!c) return
  try {
    if (c.state === 'suspended' && c.resume) c.resume()
    const rate = c.sampleRate || 44100
    let buf = cache[name]
    if (!buf) {
      const data = SYNTH[name](rate)
      buf = c.createBuffer(1, data.length, rate)
      if (buf.copyToChannel) buf.copyToChannel(data, 0, 0)
      else buf.getChannelData(0).set(data)
      cache[name] = buf
    }
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch (e) {
    console.warn('[sound] play failed', name, e)
  }
}

// 轻微震动；type: light / medium / heavy
function buzz(type) {
  if (wx.vibrateShort) wx.vibrateShort({ type: type || 'light', fail() {} })
}

module.exports = { play, buzz, SYNTH }
