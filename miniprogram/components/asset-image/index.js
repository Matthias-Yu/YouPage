const assets = require('../../utils/assets')

Component({
  options: { virtualHost: true },
  externalClasses: ['image-class'],
  properties: {
    src: String,
    mode: { type: String, value: 'scaleToFill' }
  },
  data: { resolved: '' },
  observers: {
    src(src) {
      this.setData({ resolved: assets.cloudId(src) || src })
    }
  },
  methods: {
    onImageError(e) {
      const { src, resolved } = this.data
      if (e.currentTarget.dataset.source === resolved && resolved !== src) {
        this.setData({ resolved: src })
      }
    }
  }
})
