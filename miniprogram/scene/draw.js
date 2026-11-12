// 贴图绘制：月历页、封皮、页背、索引标签、挂件、胶带。
// 都画在离屏 2D 画布上，再把像素交给 WebGL。
// 画布整体上下翻转着画（见 begin），这样像素行的顺序正好是 WebGL 贴图要的顺序。

const date = require('../utils/date')
const store = require('../utils/store')
const atlas = require('./atlas')

// 月历页的逻辑坐标：宽 1024，按 A6 比例高 1443
const LW = 1024
const LH = 1443
// 活页孔在页高上的位置（上三个、下三个）
const RINGF = [0.2, 0.29, 0.38, 0.62, 0.71, 0.8]
const GRID = { x: 108, y: 338, w: 884, bottom: 1388 }

const C = {
  paper: '#FBF4E3',
  ink: '#2B382E',
  ink2: '#7A7461',
  faint: '#B9AC90',
  line: '#E0D1B1',
  line2: '#CDBB96',
  green: '#30533A',
  greenSoft: '#C6D6BE',
  terra: '#C96F43',
  cream: '#FCF0DA',
  hand: '#2F4F66'
}
const SERIF = '"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif'
const SANS = '"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif'
const HAND = '"Kaiti SC","STKaiti","KaiTi","Noto Serif CJK SC",serif'

// 每个月页眉上的小插画（取自贴纸）
const MONTH_ART = ['wx-snow', 'heart', 'flower', 'leaf', 'wx-sunny', 'melon', 'icecream', 'plane', 'moon', 'coffee', 'book', 'gift']

function begin(ctx, pw, ph, lw, lh, mirror) {
  if (mirror) ctx.setTransform(-pw / lw, 0, 0, -ph / lh, pw, ph)
  else ctx.setTransform(pw / lw, 0, 0, -ph / lh, 0, ph)
}

function pixels(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h)
  return { data: new Uint8Array(img.data.buffer), width: w, height: h }
}

function spaced(ctx, str, x, y, gap) {
  for (let i = 0; i < str.length; i++) {
    ctx.fillText(str[i], x, y)
    x += ctx.measureText(str[i]).width + gap
  }
  return x
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
  // 靠近活页环一侧的折痕阴影
  const fromLeft = holeX < w / 2
  const g = ctx.createLinearGradient(fromLeft ? 0 : w, 0, fromLeft ? 96 : w - 96, 0)
  g.addColorStop(0, 'rgba(120,90,50,0.2)')
  g.addColorStop(1, 'rgba(120,90,50,0)')
  ctx.fillStyle = g
  ctx.fillRect(fromLeft ? 0 : w - 96, 0, 96, h)
  RINGF.forEach(f => {
    const y = f * h
    const hole = ctx.createRadialGradient(holeX - 3, y - 3, 3, holeX, y, 22)
    hole.addColorStop(0, '#3a332a')
    hole.addColorStop(0.8, '#6b6152')
    hole.addColorStop(1, '#a89c86')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(holeX, y, 21, 0, Math.PI * 2)
    ctx.fill()
  })
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

  function sticker(ctx, key, x, y, size) {
    const cell = atlasImg && atlas.map[key]
    if (!cell) return
    const c = atlas.cell
    ctx.drawImage(atlasImg, cell[0] * c, cell[1] * c, c * cell[2], c, x, y, size * cell[2], size)
  }

  return {
    // 贴纸图集加载好之后，月历页上的心情章和插画才画得出来
    loadAtlas(done) {
      const img = scratch(1024, 2048).canvas.createImage()
      img.onload = () => {
        atlasImg = img
        done()
      }
      img.onerror = e => console.error('[draw] atlas load failed', e)
      img.src = '/assets/atlas.png'
    },

    // draft: { d, text } 表示正在写这一天的格子，直接把输入中的文字画上去
    month(y, m, weekStart, draft) {
      const PW = 1024, PH = 2048
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, LW, LH)
      paperBase(ctx, LW, LH, 44)
      const today = date.today()
      const data = store.getMonth(date.ym(y, m))

      // 页眉：大号月份 | 英文月名 / 年
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.fillStyle = C.ink
      ctx.font = '900 178px ' + SERIF
      const num = '' + m
      ctx.fillText(num, 104, 262)
      const nx = 104 + ctx.measureText(num).width + 26
      ctx.fillRect(nx, 124, 5, 138)
      ctx.font = '700 54px ' + SANS
      spaced(ctx, date.MONTH_EN[m - 1], nx + 30, 186, 5)
      ctx.fillStyle = C.ink2
      ctx.font = '500 34px ' + SANS
      ctx.fillText(y + ' · ' + date.MONTH_CN[m - 1], nx + 32, 246)
      ctx.save()
      ctx.translate(880, 168)
      ctx.rotate(0.12)
      sticker(ctx, MONTH_ART[m - 1], -95, -95, 190)
      ctx.restore()

      // 星期
      const names = date.weekNames(weekStart)
      const lay = layout(y, m, weekStart)
      const cw = GRID.w / 7
      ctx.font = '600 26px ' + SANS
      ctx.textAlign = 'center'
      names.forEach((n, i) => {
        ctx.fillStyle = n.we ? C.terra : C.ink2
        ctx.fillText(n.name, GRID.x + cw * (i + 0.5), GRID.y - 14)
      })

      // 周末底色、格线
      lay.cells.forEach(c => {
        if (c.inMonth && (c.wd === 0 || c.wd === 6)) {
          ctx.fillStyle = 'rgba(221,201,164,0.2)'
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
      ctx.strokeStyle = C.ink
      ctx.lineWidth = 3
      ctx.strokeRect(GRID.x, GRID.y, GRID.w, GRID.bottom - GRID.y)

      // 每一天
      lay.cells.forEach(c => {
        if (!c.inMonth) return
        const sum = store.summary(data[c.d])
        const isToday = c.key === today.key
        const weekend = c.wd === 0 || c.wd === 6
        ctx.textAlign = 'left'
        ctx.font = '700 34px ' + SERIF
        const label = '' + c.d
        if (isToday) {
          ctx.fillStyle = C.terra
          ctx.beginPath()
          ctx.arc(c.x + 31, c.y + 30, 24, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = C.cream
          ctx.textAlign = 'center'
          ctx.fillText(label, c.x + 31, c.y + 42)
          ctx.textAlign = 'left'
        } else {
          ctx.fillStyle = weekend ? C.terra : C.ink
          ctx.fillText(label, c.x + 12, c.y + 42)
        }
        const fest = date.festival(y, m, c.d)
        if (fest) {
          ctx.fillStyle = C.terra
          ctx.font = '500 20px ' + SANS
          ctx.fillText(fest.slice(0, 3), c.x + 60, c.y + 38)
        }
        if (sum && sum.mood) sticker(ctx, 'mood-' + sum.mood, c.x + c.w - 56, c.y + 3, 54)
        const writing = !!draft && draft.d === c.d
        const text = writing ? draft.text : (sum ? sum.snip : '')
        const box = textBox(c)
        ctx.font = CELL_FONT + 'px ' + HAND
        const lines = text ? wrap(ctx, text, box.w, Math.max(1, Math.floor(box.h / CELL_LINE))) : []
        // 直接写在格子里的用墨水色，从日页带过来的摘要淡一些
        ctx.fillStyle = writing || (sum && sum.plan) ? C.hand : C.ink2
        lines.forEach((ln, i) => ctx.fillText(ln, box.x, box.y + 26 + i * CELL_LINE))
        if (writing) {
          // 正在写的格子：虚线框 + 文末的光标
          ctx.save()
          ctx.strokeStyle = C.terra
          ctx.lineWidth = 3
          ctx.setLineDash([9, 7])
          ctx.strokeRect(c.x + 4, c.y + 4, c.w - 8, c.h - 8)
          ctx.setLineDash([])
          const last = lines.length ? lines[lines.length - 1] : ''
          const row = Math.max(0, lines.length - 1)
          ctx.fillStyle = C.terra
          ctx.fillRect(box.x + ctx.measureText(last).width + 3, box.y + 2 + row * CELL_LINE, 3, 28)
          ctx.restore()
        }
      })

      ctx.fillStyle = C.faint
      ctx.font = '500 19px ' + SANS
      ctx.textAlign = 'left'
      spaced(ctx, '有页 · YOUPAGE', GRID.x, 1420, 4)
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
      ctx.font = '700 44px ' + SANS
      spaced(ctx, 'WEEKLY', x0, 118, 10)
      ctx.fillStyle = C.faint
      ctx.font = '500 26px ' + SANS
      ctx.fillText('____ / ____  —  ____ / ____', x0 + 380, 116)
      ctx.fillStyle = C.terra
      ctx.fillRect(x0, 140, 64, 6)

      const top = 178, rowH = 168
      const names = ['一', '二', '三', '四', '五', '六', '日']
      names.forEach((n, i) => {
        const y = top + i * rowH
        const we = i >= 5
        // 星期圆章
        ctx.strokeStyle = we ? C.terra : C.green
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(x0 + 30, y + 40, 28, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = we ? C.terra : C.green
        ctx.font = '700 30px ' + SERIF
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
      ctx.font = '500 19px ' + SANS
      spaced(ctx, '有页 · YOUPAGE', x0, 1420, 4)
      return pixels(ctx, PW, PH)
    },

    // 封皮：墨绿布面 + 图标上那片翻起的纸角
    cover(year) {
      const P = 1024
      const lw = 1024, lh = 1331
      const { ctx } = scratch(P, P)
      begin(ctx, P, P, lw, lh)
      ctx.fillStyle = C.green
      ctx.fillRect(0, 0, lw, lh)
      // 布纹：很淡的斜向细线
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = -lh; i < lw; i += 9) {
        ctx.moveTo(i, 0)
        ctx.lineTo(i + lh, lh)
      }
      ctx.stroke()
      const vig = ctx.createRadialGradient(lw * 0.45, lh * 0.4, 200, lw / 2, lh / 2, 950)
      vig.addColorStop(0, 'rgba(255,255,255,0.07)')
      vig.addColorStop(1, 'rgba(0,0,0,0.22)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, lw, lh)
      ctx.strokeStyle = 'rgba(252,240,218,0.2)'
      ctx.lineWidth = 3
      roundRect(ctx, 46, 46, lw - 92, lh - 92, 34)
      ctx.stroke()

      ctx.fillStyle = C.cream
      ctx.textAlign = 'center'
      ctx.font = '900 168px ' + SERIF
      ctx.fillText('有', lw / 2 - 110, 430)
      ctx.fillText('页', lw / 2 + 110, 430)
      ctx.font = '600 30px ' + SANS
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(252,240,218,0.75)'
      const tw = 'YOUPAGE'.length * 36
      spaced(ctx, 'YOUPAGE', lw / 2 - tw / 2 + 4, 510, 16)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#E3A98C'
      ctx.font = '700 44px ' + SERIF
      ctx.fillText('' + year, lw / 2, 602)

      // 纸角
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 34
      ctx.fillStyle = '#FCEED3'
      ctx.beginPath()
      ctx.moveTo(lw, 690)
      ctx.bezierCurveTo(860, 980, 620, 1180, 300, lh)
      ctx.lineTo(lw, lh)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      const curl = ctx.createLinearGradient(520, 1000, 660, 1150)
      curl.addColorStop(0, 'rgba(160,120,60,0.34)')
      curl.addColorStop(1, 'rgba(160,120,60,0)')
      ctx.fillStyle = curl
      ctx.beginPath()
      ctx.moveTo(lw, 690)
      ctx.bezierCurveTo(860, 980, 620, 1180, 300, lh)
      ctx.lineTo(lw, lh)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = C.green
      ctx.lineCap = 'round'
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(640, 1172)
      ctx.lineTo(800, 1130)
      ctx.moveTo(668, 1226)
      ctx.lineTo(776, 1200)
      ctx.stroke()
      ctx.fillStyle = C.terra
      ctx.beginPath()
      ctx.arc(884, 1196, 44, 0, Math.PI * 2)
      ctx.fill()
      return pixels(ctx, P, P)
    },

    // 月份索引标签
    tab(n, active) {
      const PW = 64, PH = 128
      const { ctx } = scratch(PW, PH)
      begin(ctx, PW, PH, 64, 96)
      ctx.fillStyle = active ? C.green : C.greenSoft
      ctx.fillRect(0, 0, 64, 96)
      ctx.fillStyle = active ? C.cream : C.green
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '700 34px ' + SANS
      ctx.fillText('' + n, 30, 50)
      ctx.textBaseline = 'alphabetic'
      return pixels(ctx, PW, PH)
    },

    // 挂件：一枚赤陶色的小印章
    seal() {
      const P = 256
      const { ctx } = scratch(P, P)
      begin(ctx, P, P, P, P)
      ctx.fillStyle = C.terra
      ctx.fillRect(0, 0, P, P)
      ctx.strokeStyle = 'rgba(252,240,218,0.85)'
      ctx.lineWidth = 4
      ctx.setLineDash([7, 9])
      ctx.beginPath()
      ctx.arc(128, 128, 100, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = C.cream
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '900 118px ' + SERIF
      ctx.fillText('页', 128, 134)
      ctx.textBaseline = 'alphabetic'
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
        fill('#F3D3BE')
        ctx.strokeStyle = '#C96F43'
        ctx.lineWidth = 10
        ctx.beginPath()
        for (let x = -PH - 32; x < PW + PH; x += 32) {
          ctx.moveTo(x, PH + 8)
          ctx.lineTo(x + PH + 16, -8)
        }
        ctx.stroke()
      } else if (id === 'dots') {
        fill('#F2D58C')
        ctx.fillStyle = '#FFF8E9'
        ;[12, 32, 52].forEach((y, row) => {
          for (let x = 8 + (row % 2) * 8; x < PW + 8; x += 16) {
            ctx.beginPath()
            ctx.arc(x, y, 4, 0, Math.PI * 2)
            ctx.fill()
          }
        })
      } else if (id === 'kraft') {
        fill('#D9C39A')
        ctx.fillStyle = 'rgba(255,255,255,0.22)'
        for (let x = 0; x < PW; x += 16) ctx.fillRect(x, 0, 3, PH)
        ctx.fillStyle = 'rgba(120,90,50,0.12)'
        for (let x = 9; x < PW; x += 32) ctx.fillRect(x, 0, 2, PH)
      } else if (id === 'forest') {
        fill('#30533A')
        ctx.fillStyle = '#FCF0DA'
        for (let x = 8; x < PW; x += 32) ctx.fillRect(x, 29.5, 16, 5)
      } else if (id === 'sky') {
        fill('#EAF2F4')
        ctx.fillStyle = '#CFE0E6'
        for (let x = 0; x < PW; x += 16) ctx.fillRect(x, 0, 8, PH)
      } else {
        fill('#E4ECD9')
        ctx.fillStyle = 'rgba(48,83,58,0.28)'
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
  gingham: ['#DCE6D0', '#8FA987'],
  stripe: ['#F0CDB6', '#C96F43'],
  dots: ['#F2D58C', '#C9A24E'],
  kraft: ['#D9C39A', '#A88C5E'],
  forest: ['#3A6146', '#1E3826'],
  sky: ['#E3EEF1', '#9DBAC5']
}

// 活页环用的 matcap：一颗抛光金属球的样子（上亮、中间一道暗带、底部暖色反光）
function matcap(size) {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1
      const ny = ((y + 0.5) / size) * 2 - 1
      let v = 0.5 + 0.34 * ny
      v += 0.6 * Math.exp(-((nx + 0.35) * (nx + 0.35) + (ny - 0.45) * (ny - 0.45)) / 0.05)
      v -= 0.34 * Math.exp(-((ny + 0.2) * (ny + 0.2)) / 0.02) * (1 - 0.4 * nx * nx)
      const warm = 0.3 * Math.exp(-((ny + 0.75) * (ny + 0.75)) / 0.04)
      v = Math.max(0.1, Math.min(1, v + warm))
      const i = (y * size + x) * 4
      data[i] = Math.min(255, v * 255 + warm * 40)
      data[i + 1] = Math.min(255, v * 250)
      data[i + 2] = Math.min(255, v * 240 - warm * 30)
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
    const dark = i % 4 === 3
    data[i * 4] = dark ? 214 : 246
    data[i * 4 + 1] = dark ? 198 : 236
    data[i * 4 + 2] = dark ? 166 : 214
    data[i * 4 + 3] = 255
  }
  return alongU ? { data, width: n, height: 1 } : { data, width: 1, height: n }
}

module.exports = { LW, LH, RINGF, CELL_FONT, CELL_LINE, createPainter, layout, textBox, matcap, pageEdge }
