const assets = require('../../utils/assets')

Component({
  options: { virtualHost: true },
  externalClasses: ['image-class'],
  properties: {
    src: String,
    mode: { type: String, value: 'scaleToFill' },
    previewLocal: Boolean
  },
  data: { resolved: '', cloudReady: false },
  observers: {
    src(src) {
      this.setData({ resolved: assets.cloudId(src) || src, cloudReady: false })
    }
  },
  methods: {
    onCloudLoad(e) {
      if (e.currentTarget.dataset.source === this.data.resolved) {
        this.setData({ cloudReady: true })
      }
    },
    onImageError(e) {
      const { src, resolved } = this.data
      if (e.currentTarget.dataset.source === resolved && resolved !== src) {
        this.setData({ resolved: src, cloudReady: false })
      }
    }
  }
})
