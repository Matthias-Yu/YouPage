// 装饰层：盖在纸页上的贴纸 / 胶带 / 照片。
// 拖动、旋转、缩放的跟手部分在 gesture.wxs（渲染层）里完成，松手时回调 commit 落盘。
//
// items: [{ id, t, k, x, y, s, r, ratio? }]
//   t  's' 贴纸  't' 胶带  'p' 照片
//   k  贴纸 key / 胶带 id / 照片本地路径
//   x,y 中心点，单位是「纸宽」（与屏幕尺寸无关）；s 缩放；r 旋转角度

const catalog = require('../../utils/catalog')

// 各类元素的基础尺寸（纸宽的倍数）[宽, 高]
const SIZE = {
  s: [0.2, 0.2],
  wide: [0.3, 0.15],
  t: [0.42, 0.075],
  p: [0.4, 0.46]
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

Component({
  properties: {
    items: { type: Array, value: [] },
    // 纸页宽度（px）
    pw: { type: Number, value: 0 }
  },

  data: {
    list: [],
    sel: ''
  },

  observers: {
    'items, pw': function (items, pw) {
      this.setData({ list: this.build(items || [], pw) })
    }
  },

  methods: {
    build(items, pw) {
      if (!pw) return []
      return items.map(it => {
        const cutout = it.t === 'p' && Number.isFinite(it.ratio) && it.ratio > 0
        const size = cutout
          ? [SIZE.p[0] * Math.min(1, it.ratio), SIZE.p[0] / Math.max(1, it.ratio)]
          : it.t === 's' && catalog.isWide(it.k) ? SIZE.wide : (SIZE[it.t] || SIZE.s)
        const px = Math.round(it.x * pw * 10) / 10
        const py = Math.round(it.y * pw * 10) / 10
        const view = {
          id: it.id,
          t: it.t,
          cutout,
          w: Math.max(1, Math.round(size[0] * pw)),
          h: Math.max(1, Math.round(size[1] * pw)),
          inv: Math.round(1000 / it.s) / 1000,
          pos: [px, py, it.s, it.r].join(','),
          tf: 'translate3d(' + px + 'px,' + py + 'px,0) rotate(' + it.r + 'deg) scale(' + it.s + ')'
        }
        if (it.t === 's') view.src = catalog.src(it.k)
        else if (it.t === 't') view.css = catalog.tapeCss(it.k)
        else view.src = it.k
        return view
      })
    },

    select(id) {
      this.setData({ sel: id })
    },

    clear() {
      if (this.data.sel) this.setData({ sel: '' })
    },

    // 点一下选中，并把它提到最上层
    onTapEl(e) {
      const id = e.currentTarget.dataset.id
      if (id === this.data.sel) return
      this.setData({ sel: id })
      const items = this.data.items.slice()
      const i = items.findIndex(it => it.id === id)
      if (i > -1 && i < items.length - 1) {
        items.push(items.splice(i, 1)[0])
        this.emit(items)
      }
    },

    // gesture.wxs 松手时调用，p 的 x/y 是 px
    commit(p) {
      const pw = this.data.pw
      const items = this.data.items.map(it => {
        if (it.id !== p.id) return it
        return Object.assign({}, it, {
          x: Math.round(clamp(p.x / pw, 0, 1) * 1000) / 1000,
          y: Math.round(Math.max(0, p.y / pw) * 1000) / 1000,
          s: p.s,
          r: p.r
        })
      })
      this.emit(items)
    },

    onDelete(e) {
      const id = e.currentTarget.dataset.id
      const removed = this.data.items.find(it => it.id === id)
      this.setData({ sel: '' })
      this.emit(this.data.items.filter(it => it.id !== id), removed)
    },

    emit(items, removed) {
      this.triggerEvent('change', { items, removed: removed || null })
    }
  }
})
