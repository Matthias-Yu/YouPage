// 裁切轮廓始终用原图像素坐标，预览与导出共用一套路径。
const MASKS = [
  { id: 'circle', name: '圆形', icon: '○' },
  { id: 'rounded', name: '圆角', icon: '▢' },
  { id: 'heart', name: '爱心', icon: '♡' },
  { id: 'star', name: '星形', icon: '☆' }
]
const MIN_OUTLINE_PX = 8
const SIMPLIFY_PX = 1.8
const ROUND_PX = 8

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function fitImage(width, height, stageWidth, stageHeight) {
  const scale = Math.min(stageWidth / width, stageHeight / height)
  return { x: (stageWidth - width * scale) / 2, y: (stageHeight - height * scale) / 2, scale }
}

function maskBox(image, center, size) {
  const side = Math.min(image.width, image.height) * size / 100
  const half = side / 2
  return {
    x: clamp(center.x - half, 0, image.width - side),
    y: clamp(center.y - half, 0, image.height - side),
    width: side,
    height: side
  }
}

function hasOutlineArea(points, minSide) {
  if (points.length < 3) return false
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  let area = 0
  let prev = points[points.length - 1]
  points.forEach(p => {
    left = Math.min(left, p.x)
    top = Math.min(top, p.y)
    right = Math.max(right, p.x)
    bottom = Math.max(bottom, p.y)
    area += prev.x * p.y - p.x * prev.y
    prev = p
  })
  return right - left >= minSide && bottom - top >= minSide && Math.abs(area) >= minSide * minSide
}

function distanceToSegmentSquared(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared
    ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
    : 0
  return (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2
}

function simplifyLoop(points, tolerance) {
  const toleranceSquared = tolerance * tolerance
  const start = points[0]
  let opposite = 1, farthest = 0
  for (let i = 1; i < points.length; i++) {
    const distance = (points[i].x - start.x) ** 2 + (points[i].y - start.y) ** 2
    if (distance > farthest) {
      opposite = i
      farthest = distance
    }
  }

  // Ramer–Douglas–Peucker：把闭合轮廓分成两段，分别去掉小幅抖动。
  const loop = points.concat(start)
  const keep = new Uint8Array(points.length)
  keep[0] = keep[opposite] = 1
  const spans = [0, opposite, opposite, points.length]
  while (spans.length) {
    const right = spans.pop(), left = spans.pop()
    let split = -1, maxDistance = toleranceSquared
    for (let i = left + 1; i < right; i++) {
      const distance = distanceToSegmentSquared(loop[i], loop[left], loop[right])
      if (distance > maxDistance) {
        split = i
        maxDistance = distance
      }
    }
    if (split !== -1) {
      keep[split] = 1
      spans.push(left, split, split, right)
    }
  }
  return points.filter((_, i) => keep[i])
}

function roundedCorners(points, radius, closed) {
  return points.map((point, i) => {
    if (!closed && (i === 0 || i === points.length - 1)) return { before: point, point, after: point }
    const previous = points[(i + points.length - 1) % points.length]
    const next = points[(i + 1) % points.length]
    const incoming = Math.hypot(previous.x - point.x, previous.y - point.y)
    const outgoing = Math.hypot(next.x - point.x, next.y - point.y)
    // 圆角最多占用相邻线段的一半，避免吞掉窄处的轮廓。
    const cut = Math.min(radius, incoming / 2, outgoing / 2)
    if (!cut) return { before: point, point, after: point }
    const before = {
      x: point.x + (previous.x - point.x) * cut / incoming,
      y: point.y + (previous.y - point.y) * cut / incoming
    }
    const after = {
      x: point.x + (next.x - point.x) * cut / outgoing,
      y: point.y + (next.y - point.y) * cut / outgoing
    }
    return { before, point, after }
  })
}

function curveRange(corners, axis) {
  let min = Infinity, max = -Infinity
  for (const { before, point, after } of corners) {
    const a = before[axis], b = point[axis], c = after[axis]
    min = Math.min(min, a, c)
    max = Math.max(max, a, c)
    const curvature = a - 2 * b + c
    if (!curvature) continue
    const t = (a - b) / curvature
    if (t > 0 && t < 1) {
      const extremum = a + (b - a) * t
      min = Math.min(min, extremum)
      max = Math.max(max, extremum)
    }
  }
  return [min, max]
}

function smoothOutline(points, scale) {
  const minSide = MIN_OUTLINE_PX / scale
  if (!hasOutlineArea(points, minSide)) return null
  const tolerance = SIMPLIFY_PX / scale
  const first = points[0], last = points[points.length - 1]
  // 手指回到起点时，去掉几乎重合的末点，让接缝和其它拐角一样圆滑。
  const endsTogether = Math.hypot(last.x - first.x, last.y - first.y) <= tolerance * 2
  const trimmed = endsTogether ? points.slice(0, -1) : points
  const loop = hasOutlineArea(trimmed, minSide) ? trimmed : points
  const simplified = simplifyLoop(loop, tolerance)
  const vertices = hasOutlineArea(simplified, minSide) ? simplified : loop
  const corners = roundedCorners(vertices, ROUND_PX / scale, true)
  const [x, right] = curveRange(corners, 'x')
  const [y, bottom] = curveRange(corners, 'y')
  return { shape: 'free', box: { x, y, width: right - x, height: bottom - y }, corners }
}

function traceCorners(ctx, corners, closed) {
  ctx.moveTo(corners[0].before.x, corners[0].before.y)
  corners.forEach(({ before, point, after }, i) => {
    if (i) ctx.lineTo(before.x, before.y)
    if (before !== after) ctx.quadraticCurveTo(point.x, point.y, after.x, after.y)
  })
  if (closed) ctx.closePath()
}

function traceStroke(ctx, points, scale) {
  ctx.beginPath()
  traceCorners(ctx, roundedCorners(points, ROUND_PX / scale, false), false)
}

function tracePath(ctx, { shape, box, corners }) {
  ctx.beginPath()
  if (shape === 'free') {
    traceCorners(ctx, corners, true)
    return
  }

  const { x, y, width: size } = box
  const cx = x + size / 2, cy = y + size / 2
  switch (shape) {
    case 'circle':
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2)
      break
    case 'rounded': {
      const r = size * 0.18, right = x + size, bottom = y + size
      ctx.moveTo(x + r, y)
      ctx.arcTo(right, y, right, bottom, r)
      ctx.arcTo(right, bottom, x, bottom, r)
      ctx.arcTo(x, bottom, x, y, r)
      ctx.arcTo(x, y, right, y, r)
      break
    }
    case 'heart':
      ctx.moveTo(cx, y + size * 0.2)
      ctx.bezierCurveTo(x + size * 0.34, y - size * 0.04, x, y + size * 0.01, x, y + size * 0.34)
      ctx.bezierCurveTo(x, y + size * 0.61, x + size * 0.26, y + size * 0.81, cx, y + size)
      ctx.bezierCurveTo(x + size * 0.74, y + size * 0.81, x + size, y + size * 0.61, x + size, y + size * 0.34)
      ctx.bezierCurveTo(x + size, y + size * 0.01, x + size * 0.66, y - size * 0.04, cx, y + size * 0.2)
      break
    case 'star':
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5 - Math.PI / 2
        const radius = size * (i % 2 ? 0.23 : 0.5)
        const px = cx + Math.cos(angle) * radius
        const py = cy + Math.sin(angle) * radius
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      break
  }
  ctx.closePath()
}

module.exports = { MASKS, clamp, fitImage, maskBox, smoothOutline, traceStroke, tracePath }
