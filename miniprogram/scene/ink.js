// 手绘坐标跟随纸页，橡皮只作用于透明笔迹图层。
const WIDTH = 512
const HEIGHT = 724
const TOOLS = [
  { id: 'pen', name: '画笔', widths: [5, 11, 20] },
  { id: 'marker', name: '荧光笔', widths: [18, 30, 45] },
  { id: 'eraser', name: '橡皮', widths: [18, 36, 60] }
]
const COLORS = [
  { name: '炭黑', value: '#242424' },
  { name: '湖蓝', value: '#39739B' },
  { name: '砖红', value: '#B45949' },
  { name: '淡紫', value: '#A96EAB' },
  { name: '芥末黄', value: '#D6A33E' }
]

function stroke(ctx, line) {
  const { points, tool, color, width } = line
  ctx.save()
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.globalAlpha = tool === 'marker' ? 0.38 : 1
  ctx.lineWidth = width
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineCap = ctx.lineJoin = 'round'
  ctx.beginPath()
  if (points.length === 2) {
    ctx.arc(points[0], points[1], width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1])
    ctx.stroke()
  }
  ctx.restore()
}

class InkLayer {
  constructor(pageWidth, pageHeight) {
    this.canvas = wx.createOffscreenCanvas({ type: '2d', width: WIDTH, height: HEIGHT })
    this.ctx = this.canvas.getContext('2d')
    this.scaleX = WIDTH / pageWidth
    this.scaleY = HEIGHT / pageHeight
  }

  clear() {
    const { ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0)
  }

  paint(lines) {
    const previous = this.lines
    if (lines === previous) return
    const appended = previous && lines.length === previous.length + 1 &&
      previous.every((line, i) => line === lines[i])
    if (appended) stroke(this.ctx, lines[lines.length - 1])
    else {
      this.clear()
      lines.forEach(line => stroke(this.ctx, line))
    }
    this.lines = lines
  }

  bounds(line) {
    const { points, width } = line
    let left = points[0], right = left, top = points[1], bottom = top
    for (let i = 2; i < points.length; i += 2) {
      left = Math.min(left, points[i])
      right = Math.max(right, points[i])
      top = Math.min(top, points[i + 1])
      bottom = Math.max(bottom, points[i + 1])
    }
    const r = width / 2
    // 两个额外的像素包含边缘抗锯齿。
    const x = Math.max(0, Math.floor((left - r) * this.scaleX) - 2)
    const y = Math.max(0, Math.floor((top - r) * this.scaleY) - 2)
    const w = Math.min(WIDTH, Math.ceil((right + r) * this.scaleX) + 2) - x
    const h = Math.min(HEIGHT, Math.ceil((bottom + r) * this.scaleY) + 2) - y
    return { x, y, width: w, height: h }
  }

  preview(base, line) {
    this.clear()
    this.ctx.drawImage(base.canvas, 0, 0, WIDTH / this.scaleX, HEIGHT / this.scaleY)
    stroke(this.ctx, line)
  }

  pixels({ x = 0, y = 0, width = WIDTH, height = HEIGHT } = {}) {
    const { data } = this.ctx.getImageData(x, y, width, height)
    return { x, y, width, height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
  }
}

module.exports = { InkLayer, TOOLS, COLORS }
