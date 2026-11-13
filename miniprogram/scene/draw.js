// 贴图绘制：月历页、封皮、页背、索引标签、挂件、胶带。
// 都画在离屏 2D 画布上，再把像素交给 WebGL。
// 画布整体上下翻转着画（见 begin），这样像素行的顺序正好是 WebGL 贴图要的顺序。

const date = require('../utils/date')
const store = require('../utils/store')
const catalog = require('../utils/catalog')
const assets = require('../utils/assets')
const { InkLayer } = require('./ink')
const atlas = require('./atlas')

// 月历页的逻辑坐标：宽 1024，按 A6 比例高 1443
const LW = 1024
const LH = 1443
// 活页孔在页高上的位置（上三个、下三个）
const RINGF = [0.2, 0.29, 0.38, 0.62, 0.71, 0.8]
const GRID = { x: 108, y: 338, w: 884, bottom: 1388 }

const C = {
  paper: '#FAFAFA',
  ink: '#232323',
  ink2: '#535353',
  faint: '#696969',
  line: '#CECECE',
  line2: '#A6A6A6',
  accent: '#343434',
  emphasis: '#4C4C4C',
  white: '#FFFFFF',
  hand: '#303030'
}
const SANS = '"PingFang SC","HarmonyOS Sans SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif'
const NUMERALS = '"Avenir Next",Roboto,"Helvetica Neue",Arial,sans-serif'
const EDITORIAL = 'Georgia,"Noto Serif",serif'

function begin(ctx, pw, ph, lw, lh, mirror) {
  if (mirror) ctx.setTransform(-pw / lw, 0, 0, -ph / lh, pw, ph)
  else ctx.setTransform(pw / lw, 0, 0, -ph / lh, 0, ph)
}

function pixels(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h)
  return { data: new Uint8Array(img.data.buffer), width: w, height: h }
}

function wrap(ctx, text, maxW, maxLines) {
  const lines = []
  let line = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\n') {
      lines.push(line)
      line = ''
    } else if (line && ctx.measureText(line + ch).width > maxW) {
      lines.push(line)
      line = ch
    } else {
      line += ch
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'
  }
  return lines
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function paperBase(ctx, w, h, holeX) {
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, w, h)
  const shade = ctx.createLinearGradient(0, 0, w * 0.9, h)
  shade.addColorStop(0, 'rgba(255,255,255,0.64)')
  shade.addColorStop(0.68, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(120,120,120,0.13)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(60,60,60,0.055)'
  for (let i = 0; i < 1300; i++) {
    const x = ((i * 379 + (i % 17) * 31) % 1031) / 1031 * w
    const y = ((i * 233 + (i % 29) * 47) % 1451) / 1451 * h
    ctx.fillRect(x, y, 2 + i % 4, 1)
  }
  // 靠近活页环一侧的折痕阴影
  const fromLeft = holeX < w / 2
  const g = ctx.createLinearGradient(fromLeft ? 0 : w, 0, fromLeft ? 96 : w - 96, 0)
  g.addColorStop(0, 'rgba(48,48,48,0.19)')
  g.addColorStop(1, 'rgba(48,48,48,0)')
  ctx.fillStyle = g
  ctx.fillRect(fromLeft ? 0 : w - 96, 0, 96, h)
  RINGF.forEach(f => {
    const y = f * h
    const hole = ctx.createRadialGradient(holeX - 3, y - 3, 3, holeX, y, 16)
    hole.addColorStop(0, '#333333')
    hole.addColorStop(0.8, '#626262')
    hole.addColorStop(1, '#A6A6A6')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(holeX, y, 16, 0, Math.PI * 2)
    ctx.fill()
  })
}

// 透明封面上的米白印花：一只抱着书打瞌睡的狐狸。
function coverFox(ctx) {
  ctx.save()
  ctx.translate(566, 582)
  ctx.strokeStyle = '#F3F3F3'
  ctx.lineWidth = 3.8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // 头、耳朵和耳内的短线。
  ctx.beginPath()
  ctx.moveTo(-132, 64)
  ctx.bezierCurveTo(-179, 46, -198, 4, -145, -39)
  ctx.quadraticCurveTo(-161, -83, -151, -143)
  ctx.quadraticCurveTo(-103, -131, -67, -86)
  ctx.quadraticCurveTo(-20, -100, 27, -83)
  ctx.quadraticCurveTo(60, -122, 104, -133)
  ctx.quadraticCurveTo(119, -89, 109, -44)
  ctx.bezierCurveTo(159, -5, 154, 42, 103, 61)
  ctx.moveTo(-137, -114)
  ctx.quadraticCurveTo(-111, -105, -88, -81)
  ctx.moveTo(47, -77)
  ctx.quadraticCurveTo(67, -101, 93, -108)
  ctx.stroke()

  // 眼睛、鼻子和脸颊。
  ctx.beginPath()
  ctx.moveTo(-126, 6)
  ctx.quadraticCurveTo(-103, 29, -80, 9)
  ctx.moveTo(36, 11)
  ctx.quadraticCurveTo(57, 31, 80, 10)
  ctx.moveTo(-49, 46)
  ctx.quadraticCurveTo(-24, 43, -4, 47)
  ctx.quadraticCurveTo(-11, 59, -26, 61)
  ctx.quadraticCurveTo(-41, 58, -49, 46)
  ctx.moveTo(-26, 61)
  ctx.quadraticCurveTo(-32, 75, -47, 72)
  ctx.moveTo(-26, 61)
  ctx.quadraticCurveTo(-19, 75, -4, 73)
  ctx.moveTo(-142, 30)
  ctx.lineTo(-152, 36)
  ctx.moveTo(102, 34)
  ctx.lineTo(112, 41)
  ctx.stroke()

  // 尾巴从书后绕过来，末端留一条浅色分界。
  ctx.beginPath()
  ctx.moveTo(92, 83)
  ctx.bezierCurveTo(146, 114, 205, 93, 217, 41)
  ctx.bezierCurveTo(224, 11, 209, -3, 184, -4)
  ctx.bezierCurveTo(198, 19, 179, 45, 152, 51)
  ctx.moveTo(137, 143)
  ctx.bezierCurveTo(202, 145, 233, 99, 217, 41)
  ctx.moveTo(167, 46)
  ctx.quadraticCurveTo(175, 64, 201, 66)
  ctx.stroke()

  // 两只爪子搭着摊开的书。
  ctx.beginPath()
  ctx.moveTo(-122, 103)
  ctx.quadraticCurveTo(-123, 63, -101, 64)
  ctx.quadraticCurveTo(-83, 65, -87, 105)
  ctx.moveTo(55, 99)
  ctx.quadraticCurveTo(53, 63, 75, 64)
  ctx.quadraticCurveTo(94, 67, 91, 96)
  ctx.moveTo(-162, 96)
  ctx.quadraticCurveTo(-91, 90, -26, 130)
  ctx.quadraticCurveTo(54, 87, 126, 96)
  ctx.lineTo(107, 181)
  ctx.quadraticCurveTo(38, 176, -25, 212)
  ctx.quadraticCurveTo(-93, 175, -147, 182)
  ctx.closePath()
  ctx.moveTo(-26, 131)
  ctx.lineTo(-25, 212)
  ctx.moveTo(-132, 127)
  ctx.quadraticCurveTo(-93, 127, -53, 147)
  ctx.moveTo(0, 148)
  ctx.quadraticCurveTo(46, 127, 93, 126)
  ctx.moveTo(-128, 149)
  ctx.quadraticCurveTo(-94, 149, -55, 167)
  ctx.moveTo(3, 169)
  ctx.quadraticCurveTo(46, 149, 88, 147)
  ctx.stroke()
  ctx.restore()
}

// 月历格子的位置（逻辑坐标），绘制和点击命中共用
function layout(y, m, weekStart) {
  const cells = date.monthGrid(y, m, weekStart)
  const rows = cells.length / 7
  const cw = GRID.w / 7
  const ch = (GRID.bottom - GRID.y) / rows
  return {
    rows,
    cells: cells.map((c, i) => Object.assign({
      x: GRID.x + (i % 7) * cw,
      y: GRID.y + Math.floor(i / 7) * ch,
      w: cw,
      h: ch
    }, c))
  }
}

// 格子里写字的区域（日期数字下面）
function textBox(cell) {
  return { x: cell.x + 8, y: cell.y + 50, w: cell.w - 14, h: cell.h - 56 }
}
const CELL_FONT = 27
const CELL_LINE = 32

function createPainter() {
  const canvases = {}
  function scratch(w, h) {
    const k = w + 'x' + h
    if (!canvases[k]) {
      const c = wx.createOffscreenCanvas({ type: '2d', width: w, height: h })
      canvases[k] = { canvas: c, ctx: c.getContext('2d') }
    }
    return canvases[k]
  }
  let atlasImg = null
  let inkLayer = null

  function sticker(ctx, key, x, y, size) {
    const cell = atlasImg && atlas.map[key]
    if (!cell) return
    const c = atlas.cell
    ctx.drawImage(atlasImg, cell[0] * c, cell[1] * c, c, c, x, y, size, size)
  }

  return {
    // 贴纸图集加载好之后，月历页上的心情章和插画才画得出来
    loadAtlas(done) {
      const img = scratch(1024, 2048).canvas.createImage()
      assets.loadAtlasImage(img, () => {
        atlasImg = img
        done()
      }, e => console.error('[draw] atlas load failed', e))
    },

    // draft: { d, text } 表示正在写这一天的格子，直接把输入中的文字画上去
    month(y, m, weekStart, draft, lines) {
      const PW = 1024, PH = 2048
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, LW, LH)
      paperBase(ctx, LW, LH, 44)
      const today = date.today()
      const data = store.getMonth(date.ym(y, m))

      // 月份、年月和季节插画分成三块，留足日历正文的高度。
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.fillStyle = C.ink
      ctx.font = '400 150px ' + NUMERALS
      ctx.fillText(String(m).padStart(2, '0'), GRID.x - 5, 230)
      ctx.fillStyle = C.line2
      ctx.fillRect(304, 107, 2, 118)
      ctx.fillStyle = C.accent
      ctx.font = 'italic 56px ' + EDITORIAL
      ctx.fillText(date.MONTH_EN[m - 1], 331, 168)
      ctx.fillStyle = C.ink2
      ctx.font = '400 31px ' + SANS
      ctx.fillText(y + ' · ' + date.MONTH_CN[m - 1], 333, 219)
      ctx.save()
      roundRect(ctx, 769, 48, 220, 220, 14)
      ctx.clip()
      sticker(ctx, 'month-' + date.pad(m), 761, 40, 236)
      ctx.restore()

      // 星期
      const names = date.weekNames(weekStart)
      const lay = layout(y, m, weekStart)
      const cw = GRID.w / 7
      ctx.fillStyle = '#EDEDED'
      ctx.fillRect(GRID.x, GRID.y - 52, GRID.w, 52)
      ctx.font = '500 30px ' + SANS
      ctx.textAlign = 'center'
      names.forEach((n, i) => {
        ctx.fillStyle = n.we ? C.emphasis : C.ink2
        ctx.fillText(n.name, GRID.x + cw * (i + 0.5), GRID.y - 14)
      })

      // 周末底色、格线
      lay.cells.forEach(c => {
        if (c.inMonth && (c.wd === 0 || c.wd === 6)) {
          ctx.fillStyle = 'rgba(100,100,100,0.075)'
          ctx.fillRect(c.x, c.y, c.w, c.h)
        }
      })
      ctx.strokeStyle = C.line
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 1; i < 7; i++) {
        ctx.moveTo(GRID.x + cw * i, GRID.y)
        ctx.lineTo(GRID.x + cw * i, GRID.bottom)
      }
      const ch = (GRID.bottom - GRID.y) / lay.rows
      for (let r = 1; r < lay.rows; r++) {
        ctx.moveTo(GRID.x, GRID.y + ch * r)
        ctx.lineTo(GRID.x + GRID.w, GRID.y + ch * r)
      }
      ctx.stroke()
      ctx.strokeStyle = C.line2
      ctx.lineWidth = 2
      ctx.strokeRect(GRID.x, GRID.y, GRID.w, GRID.bottom - GRID.y)

      // 每一天
      lay.cells.forEach(c => {
        if (!c.inMonth) return
        const sum = store.summary(data[c.d])
        const isToday = c.key === today.key
        const weekend = c.wd === 0 || c.wd === 6
        ctx.textAlign = 'left'
        ctx.font = '500 36px ' + NUMERALS
        const label = '' + c.d
        if (isToday) {
          ctx.fillStyle = C.ink
          ctx.beginPath()
          ctx.arc(c.x + 31, c.y + 30, 24, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = C.white
          ctx.textAlign = 'center'
          ctx.fillText(label, c.x + 31, c.y + 42)
          ctx.textAlign = 'left'
        } else {
          ctx.fillStyle = weekend ? C.emphasis : C.ink
          ctx.fillText(label, c.x + 12, c.y + 42)
        }
        const fest = date.festival(y, m, c.d)
        if (fest) {
          ctx.fillStyle = C.emphasis
          ctx.font = '400 20px ' + SANS
          ctx.fillText(fest.slice(0, 3), c.x + 60, c.y + 38)
        }
        if (sum && sum.mood) sticker(ctx, catalog.stickerKey('mood-' + sum.mood), c.x + c.w - 56, c.y + 3, 54)
        const writing = !!draft && draft.d === c.d
        const text = writing ? draft.text : (sum ? sum.snip : '')
        const box = textBox(c)
        ctx.font = CELL_FONT + 'px ' + SANS
        const lines = text ? wrap(ctx, text, box.w, Math.max(1, Math.floor(box.h / CELL_LINE))) : []
        // 直接写在格子里的用墨水色，从日页带过来的摘要淡一些
        ctx.fillStyle = writing || (sum && sum.plan) ? C.hand : C.ink2
        lines.forEach((ln, i) => ctx.fillText(ln, box.x, box.y + 26 + i * CELL_LINE))
        if (writing) {
          // 正在写的格子：虚线框 + 文末的光标
          ctx.save()
          ctx.strokeStyle = C.emphasis
          ctx.lineWidth = 3
          ctx.setLineDash([9, 7])
          ctx.strokeRect(c.x + 4, c.y + 4, c.w - 8, c.h - 8)
          ctx.setLineDash([])
          const last = lines.length ? lines[lines.length - 1] : ''
          const row = Math.max(0, lines.length - 1)
          ctx.fillStyle = C.ink
          ctx.fillRect(box.x + ctx.measureText(last).width + 3, box.y + 2 + row * CELL_LINE, 3, 28)
          ctx.restore()
        }
      })

      ctx.fillStyle = C.faint
      ctx.font = '400 22px ' + SANS
      ctx.textAlign = 'left'
      ctx.fillText('有页', GRID.x, 1418)
      if (lines && lines.length) {
        if (!inkLayer) inkLayer = new InkLayer(LW, LH)
        inkLayer.paint(lines)
        ctx.drawImage(inkLayer.canvas, 0, 0, LW, LH)
      }
      return pixels(ctx, PW, PH)
    },

    // 每张月历页的背面印着一页周计划，孔在右边（翻过去以后靠着活页环）
    back() {
      const PW = 512, PH = 1024
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, LW, LH)
      paperBase(ctx, LW, LH, LW - 44)
      const x0 = 70, x1 = LW - 120
      ctx.textAlign = 'left'
      ctx.fillStyle = C.ink
      ctx.font = 'italic 52px ' + EDITORIAL
      ctx.fillText('Weekly', x0, 118)
      ctx.fillStyle = C.faint
      ctx.font = '500 26px ' + SANS
      ctx.fillText('____ / ____  —  ____ / ____', x0 + 380, 116)
      ctx.fillStyle = C.emphasis
      ctx.fillRect(x0, 140, 64, 6)

      const top = 178, rowH = 168
      const names = ['一', '二', '三', '四', '五', '六', '日']
      names.forEach((n, i) => {
        const y = top + i * rowH
        const we = i >= 5
        // 星期圆章
        ctx.strokeStyle = we ? C.emphasis : C.accent
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(x0 + 30, y + 40, 28, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = we ? C.emphasis : C.accent
        ctx.font = '500 30px ' + SANS
        ctx.textAlign = 'center'
        ctx.fillText(n, x0 + 30, y + 51)
        ctx.textAlign = 'left'
        // 书写横线
        ctx.strokeStyle = C.line
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let k = 1; k <= 3; k++) {
          ctx.moveTo(x0 + 82, y + k * 46)
          ctx.lineTo(x1 - 120, y + k * 46)
        }
        ctx.stroke()
        // 右边三个打卡小方格
        ctx.strokeStyle = C.line2
        for (let k = 0; k < 3; k++) {
          roundRect(ctx, x1 - 100 + k * 36, y + 30, 26, 26, 5)
          ctx.stroke()
        }
        // 分隔线
        if (i < names.length - 1) {
          ctx.strokeStyle = C.line
          ctx.setLineDash([6, 8])
          ctx.beginPath()
          ctx.moveTo(x0, y + rowH - 8)
          ctx.lineTo(x1, y + rowH - 8)
          ctx.stroke()
          ctx.setLineDash([])
        }
      })
      ctx.fillStyle = C.faint
      ctx.font = '400 22px ' + SANS
      ctx.fillText('有页', x0, 1420)
      return pixels(ctx, PW, PH)
    },

    // 烟灰色书衣下的扉页。插画印在上层塑料上。
    coverInsert(year) {
      const PW = 512, PH = 1024
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, 512, 720)
      const stock = ctx.createLinearGradient(20, 0, 480, 720)
      stock.addColorStop(0, '#656565')
      stock.addColorStop(0.5, '#404040')
      stock.addColorStop(1, '#242424')
      ctx.fillStyle = stock
      ctx.fillRect(0, 0, 512, 720)

      const gutter = ctx.createLinearGradient(0, 0, 70, 0)
      gutter.addColorStop(0, 'rgba(12,12,12,0.34)')
      gutter.addColorStop(1, 'rgba(12,12,12,0)')
      ctx.fillStyle = gutter
      ctx.fillRect(0, 0, 70, 720)

      ctx.fillStyle = '#F2F2F2'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.font = '500 70px ' + EDITORIAL
      ctx.fillText(String(year), 257, 137)
      ctx.font = '500 16px ' + SANS
      ctx.fillText('有页手帐', 257, 168)
      return pixels(ctx, PW, PH)
    },

    coverPrint() {
      const P = 1024
      const { ctx } = scratch(P, P)
      begin(ctx, P, P, 1024, 1331)
      ctx.clearRect(0, 0, 1024, 1331)
      coverFox(ctx)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#F3F3F3'
      ctx.font = 'italic 46px ' + EDITORIAL
      ctx.fillText('YouPage', 545, 1028)
      return pixels(ctx, P, P)
    },

    // 封二的浅灰纸衬和半透口袋，口袋开口远离装订边。
    lining() {
      const P = 512
      const { ctx } = scratch(P, P)
      begin(ctx, P, P, P, P)
      const paper = ctx.createLinearGradient(32, 0, 506, 512)
      paper.addColorStop(0, '#F0F0F0')
      paper.addColorStop(1, '#B9B9B9')
      ctx.fillStyle = paper
      ctx.fillRect(0, 0, P, P)
      const pocket = ctx.createLinearGradient(0, 284, 0, 510)
      pocket.addColorStop(0, 'rgba(55,55,55,0.10)')
      pocket.addColorStop(1, 'rgba(55,55,55,0.38)')
      ctx.fillStyle = pocket
      roundRect(ctx, 22, 287, 440, 198, 13)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.68)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      return pixels(ctx, P, P)
    },

    tab(n, active) {
      const PW = 64, PH = 128
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, 64, 96)
      const g = ctx.createLinearGradient(0, 0, 64, 96)
      g.addColorStop(0, active ? '#555555' : '#DEDEDE')
      g.addColorStop(1, active ? '#252525' : '#BFBFBF')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 96)
      ctx.fillStyle = active ? '#FAFAFA' : '#303030'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '500 34px ' + NUMERALS
      ctx.fillText('' + n, 34, 50)
      ctx.textBaseline = 'alphabetic'
      return pixels(ctx, PW, PH)
    },

    // 灰白亚克力挂件，印一枚和封面插画呼应的脚印。
    charm() {
      const P = 256
      const { ctx } = scratch(P, P)
      begin(ctx, P, P, P, P)
      ctx.fillStyle = '#F5F5F5'
      ctx.fillRect(0, 0, P, P)
      ctx.strokeStyle = '#8B8B8B'
      ctx.lineWidth = 2.6
      ctx.beginPath()
      ctx.arc(128, 128, 102, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#4A4A4A'
      ctx.beginPath()
      ctx.moveTo(81, 152)
      ctx.bezierCurveTo(94, 140, 99, 111, 128, 111)
      ctx.bezierCurveTo(153, 111, 161, 137, 175, 154)
      ctx.bezierCurveTo(190, 179, 164, 194, 144, 181)
      ctx.quadraticCurveTo(128, 172, 112, 181)
      ctx.bezierCurveTo(91, 194, 66, 177, 81, 152)
      ctx.fill()
      const toes = [[78, 103, 14], [109, 80, 16], [148, 80, 16], [178, 103, 14]]
      toes.forEach(([x, y, r]) => {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      })
      return pixels(ctx, P, P)
    },

    // 胶带花色（和 utils/catalog.js 里的 TAPES 一一对应）。
    // 256×64 一块，左右无缝，可以横向平铺：所有花纹的周期都能整除 256。
    // 一块代表 TAPE_TILE 厘米长、0.8 厘米宽的一段胶带。
    tapeTile(id) {
      const PW = 256, PH = 64
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, PW, PH)
      const fill = c => {
        ctx.fillStyle = c
        ctx.fillRect(0, 0, PW, PH)
      }
      if (id === 'stripe') {
        fill('#E4E4E4')
        ctx.strokeStyle = '#787878'
        ctx.lineWidth = 10
        ctx.beginPath()
        for (let x = -PH - 32; x < PW + PH; x += 32) {
          ctx.moveTo(x, PH + 8)
          ctx.lineTo(x + PH + 16, -8)
        }
        ctx.stroke()
      } else if (id === 'dots') {
        fill('#AFAFAF')
        ctx.fillStyle = '#FAFAFA'
        ;[12, 32, 52].forEach((y, row) => {
          for (let x = 8 + (row % 2) * 8; x < PW + 8; x += 16) {
            ctx.beginPath()
            ctx.arc(x, y, 4, 0, Math.PI * 2)
            ctx.fill()
          }
        })
      } else if (id === 'kraft') {
        fill('#C1C1C1')
        ctx.fillStyle = 'rgba(255,255,255,0.22)'
        for (let x = 0; x < PW; x += 16) ctx.fillRect(x, 0, 3, PH)
        ctx.fillStyle = 'rgba(70,70,70,0.12)'
        for (let x = 9; x < PW; x += 32) ctx.fillRect(x, 0, 2, PH)
      } else if (id === 'forest') {
        fill('#363636')
        ctx.fillStyle = '#ECECEC'
        for (let x = 8; x < PW; x += 32) ctx.fillRect(x, 29.5, 16, 5)
      } else if (id === 'sky') {
        fill('#F0F0F0')
        ctx.fillStyle = '#D1D1D1'
        for (let x = 0; x < PW; x += 16) ctx.fillRect(x, 0, 8, PH)
      } else {
        fill('#EAEAEA')
        ctx.fillStyle = 'rgba(55,55,55,0.28)'
        for (let x = 0; x < PW; x += 32) ctx.fillRect(x, 0, 16, PH)
        for (let y = 0; y < PH; y += 32) ctx.fillRect(0, y, PW, 16)
      }
      return pixels(ctx, PW, PH)
    },

    // 胶带卷顶面：一圈圈叠起来的胶带边。inner 是内圈半径占外圈的比例
    rollTop(id, inner) {
      const P = 128
      const { ctx } = scratch(P, P)
      begin(ctx, P, P, P, P)
      const col = TAPE_EDGE[id] || TAPE_EDGE.gingham
      ctx.fillStyle = col[0]
      ctx.fillRect(0, 0, P, P)
      const r0 = (P / 2) * inner, r1 = P / 2
      ctx.lineWidth = 1
      for (let r = r0 + 1.5, k = 0; r < r1; r += 2.4, k++) {
        ctx.strokeStyle = col[1]
        ctx.globalAlpha = k % 3 === 0 ? 0.55 : 0.25
        ctx.beginPath()
        ctx.arc(P / 2, P / 2, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.strokeStyle = col[1]
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(P / 2, P / 2, r1 - 1, 0, Math.PI * 2)
      ctx.stroke()
      // 一点反光
      const gl = ctx.createLinearGradient(20, 20, 100, 100)
      gl.addColorStop(0, 'rgba(255,255,255,0.32)')
      gl.addColorStop(0.5, 'rgba(255,255,255,0)')
      ctx.fillStyle = gl
      ctx.fillRect(0, 0, P, P)
      return pixels(ctx, P, P)
    }
  }
}

// 胶带卷顶面的颜色：[底色, 层与层之间的线]
const TAPE_EDGE = {
  gingham: ['#E2E2E2', '#999999'],
  stripe: ['#DADADA', '#787878'],
  dots: ['#AFAFAF', '#777777'],
  kraft: ['#C1C1C1', '#898989'],
  forest: ['#555555', '#252525'],
  sky: ['#EAEAEA', '#ACACAC']
}

// 活页环用的 matcap：一颗抛光金属球的样子（上亮、中间一道暗带、底部反光）
function matcap(size) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1
      const ny = ((y + 0.5) / size) * 2 - 1
      let v = 0.5 + 0.34 * ny
      v += 0.6 * Math.exp(-((nx + 0.35) * (nx + 0.35) + (ny - 0.45) * (ny - 0.45)) / 0.05)
      v -= 0.34 * Math.exp(-((ny + 0.2) * (ny + 0.2)) / 0.02) * (1 - 0.4 * nx * nx)
      const reflected = 0.3 * Math.exp(-((ny + 0.75) * (ny + 0.75)) / 0.04)
      const shade = Math.max(0.1, Math.min(1, v + reflected)) * 255
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = shade
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

// 本子侧面的纸页纹：一层一层的细线
function pageEdge(alongU) {
  const n = 16
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const tint = i % 5 === 3 ? 23 : i % 3 * 4
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 249 - tint
    data[i * 4 + 3] = 255
  }
  return alongU ? { data, width: n, height: 1 } : { data, width: 1, height: n }
}

module.exports = { LW, LH, RINGF, CELL_FONT, CELL_LINE, createPainter, layout, textBox, matcap, pageEdge }
