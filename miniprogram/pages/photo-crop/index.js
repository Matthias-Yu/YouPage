const crop = require('../../utils/photo-crop')

const MAX_OUTPUT_EDGE = 1200

Page({
  data: {
    ready: false,
    loadFailed: false,
    saving: false,
    mode: 'free',
    shape: 'circle',
    masks: crop.MASKS,
    size: 78,
    hasOutline: false
  },

  onLoad(query) {
    this.source = query.src ? decodeURIComponent(query.src) : ''
    this.outline = null
  },

  onReady() {
    this.measure()
  },

  onResize() {
    if (this.image) this.measure()
  },

  onUnload() {
    this.disposed = true
  },

  measure() {
    wx.createSelectorQuery()
      .select('#crop-preview').fields({ node: true, rect: true, size: true })
      .select('#crop-export').fields({ node: true })
      .exec(([stage, output]) => {
        if (this.disposed) return
        if (!stage || !stage.node || !stage.width || !stage.height || !output || !output.node || !this.source) {
          this.setData({ loadFailed: true })
          return
        }
        this.stage = stage
        this.output = output.node
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        this.dpr = Math.min(info.pixelRatio || 1, 2)
        stage.node.width = Math.round(stage.width * this.dpr)
        stage.node.height = Math.round(stage.height * this.dpr)
        if (this.image) {
          this.fitPreview()
          return
        }
        const image = stage.node.createImage()
        image.onload = () => {
          if (this.disposed) return
          this.image = image
          this.center = { x: image.width / 2, y: image.height / 2 }
          this.fitPreview()
          this.setData({ ready: true })
        }
        image.onerror = () => {
          if (!this.disposed) this.setData({ loadFailed: true })
        }
        image.src = this.source
      })
  },

  fitPreview() {
    this.fit = crop.fitImage(this.image.width, this.image.height, this.stage.width, this.stage.height)
    this.render()
  },

  setMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (this.data.saving || mode === this.data.mode) return
    this.gesture = null
    this.setData({ mode }, () => {
      if (this.image) this.measure()
    })
  },

  setShape(e) {
    if (this.data.saving) return
    this.setData({ shape: e.currentTarget.dataset.shape }, () => this.render())
  },

  setSize(e) {
    if (this.data.saving) return
    const size = Number(e.detail.value)
    if (this.image) {
      const box = crop.maskBox(this.image, this.center, size)
      this.center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    this.setData({ size }, () => this.render())
  },

  resetOutline() {
    if (this.data.saving) return
    this.gesture = null
    this.outline = null
    this.setData({ hasOutline: false })
    this.render()
  },

  point(touch) {
    const x = Number.isFinite(touch.x) ? touch.x : touch.clientX - this.stage.left
    const y = Number.isFinite(touch.y) ? touch.y : touch.clientY - this.stage.top
    return {
      x: (x - this.fit.x) / this.fit.scale,
      y: (y - this.fit.y) / this.fit.scale
    }
  },

  onTouchStart(e) {
    if (!this.data.ready || this.data.saving || this.gesture || e.touches.length !== 1) return
    const touch = e.touches[0]
    const start = this.point(touch)
    if (!(start.x >= 0 && start.x <= this.image.width && start.y >= 0 && start.y <= this.image.height)) return
    this.gesture = { id: touch.identifier, start, center: this.center }
    if (this.data.mode === 'free') this.gesture.points = [start]
    this.render()
  },

  onTouchMove(e) {
    if (!this.gesture) return
    const touch = e.touches.find(t => t.identifier === this.gesture.id)
    if (touch) this.moveGesture(touch)
  },

  moveGesture(touch) {
    const point = this.point(touch)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    const { points, start, center } = this.gesture
    if (points) {
      point.x = crop.clamp(point.x, 0, this.image.width)
      point.y = crop.clamp(point.y, 0, this.image.height)
      const last = points[points.length - 1]
      if (Math.hypot(point.x - last.x, point.y - last.y) * this.fit.scale < 2) return
      points.push(point)
    } else {
      const box = crop.maskBox(this.image, {
        x: center.x + point.x - start.x,
        y: center.y + point.y - start.y
      }, this.data.size)
      this.center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    this.render()
  },

  onTouchEnd(e) {
    const gesture = this.gesture
    if (!gesture) return
    const touch = e.changedTouches.find(t => t.identifier === gesture.id)
    if (!touch) return
    this.moveGesture(touch)
    this.gesture = null
    if (gesture.points) {
      const outline = crop.smoothOutline(gesture.points, this.fit.scale)
      if (outline) {
        this.outline = outline
        this.setData({ hasOutline: true })
      } else {
        wx.showToast({ title: '沿照片画一个轮廓', icon: 'none' })
      }
    }
    this.render()
  },

  onTouchCancel() {
    this.gesture = null
    this.render()
  },

  selection() {
    if (this.data.mode === 'mask') {
      return { shape: this.data.shape, box: crop.maskBox(this.image, this.center, this.data.size) }
    }
    return this.outline
  },

  render() {
    if (this.disposed || !this.image || !this.fit) return
    const { node, width, height } = this.stage
    const { x, y, scale } = this.fit
    const ctx = node.getContext('2d')
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.translate(x, y)
    ctx.scale(scale, scale)
    ctx.drawImage(this.image, 0, 0)

    const drawing = this.gesture && this.gesture.points
    const selection = drawing ? null : this.selection()
    ctx.lineWidth = 2 / scale
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (selection) {
      ctx.fillStyle = 'rgba(23, 34, 27, 0.54)'
      ctx.fillRect(0, 0, this.image.width, this.image.height)
      crop.tracePath(ctx, selection)
      ctx.save()
      ctx.clip()
      ctx.drawImage(this.image, 0, 0)
      ctx.restore()
      ctx.setLineDash([5 / scale, 4 / scale])
    } else if (drawing) {
      crop.traceStroke(ctx, drawing, scale)
    } else {
      return
    }
    ctx.strokeStyle = '#FFF8DF'
    ctx.shadowColor = '#183226'
    ctx.shadowBlur = 2
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.setLineDash([])
  },

  applyCrop() {
    if (!this.data.ready || this.data.saving || this.gesture) return
    const selection = this.selection()
    if (!selection) return
    this.setData({ saving: true })
    const { box } = selection
    const scale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(box.width, box.height))
    const width = Math.max(1, Math.ceil(box.width * scale))
    const height = Math.max(1, Math.ceil(box.height * scale))
    const canvas = this.output
    try {
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale)
      crop.tracePath(ctx, selection)
      ctx.clip()
      ctx.drawImage(this.image, 0, 0)
      wx.canvasToTempFilePath({
        canvas, x: 0, y: 0, width, height, destWidth: width, destHeight: height, fileType: 'png',
        success: res => this.savePhoto(res.tempFilePath, width / height),
        fail: () => this.saveFailed('裁切失败，请重试')
      })
    } catch (err) {
      this.saveFailed('裁切失败，请重试')
    }
  },

  useOriginal() {
    if (!this.source || this.data.saving) return
    this.setData({ saving: true })
    this.savePhoto(this.source)
  },

  savePhoto(path, ratio) {
    if (this.disposed) return
    const extension = ratio ? '.png' : (path.match(/\.\w+$/) || ['.jpg'])[0]
    const dest = wx.env.USER_DATA_PATH + '/photo_' + Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8) + extension
    const fs = wx.getFileSystemManager()
    fs.saveFile({
      tempFilePath: path,
      filePath: dest,
      success: res => {
        const saved = res.savedFilePath || dest
        if (this.disposed) {
          fs.unlink({ filePath: saved, fail() {} })
          return
        }
        this.getOpenerEventChannel().emit('photo', { path: saved, ratio })
        wx.navigateBack()
      },
      fail: () => this.saveFailed('照片保存失败，请重试')
    })
  },

  saveFailed(message) {
    if (this.disposed) return
    this.setData({ saving: false })
    wx.showToast({ title: message, icon: 'none' })
  },

  cancel() {
    if (!this.data.saving) wx.navigateBack()
  }
})
