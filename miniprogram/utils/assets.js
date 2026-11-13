const config = require('../config')

const PREFIX = '/assets/'
const ATLAS = PREFIX + 'atlas.png'
let atlasDownload

function cloudId(src) {
  if (!src || !src.startsWith(PREFIX) || typeof wx === 'undefined' || !wx.cloud || !config.ASSET_CLOUD_ROOT) return ''
  let root = config.ASSET_CLOUD_ROOT
  if (src === PREFIX + 'logo.png') root = root.replace(/[^/]+\/$/, config.LOGO_ASSET_VERSION + '/')
  else if (src.startsWith(PREFIX + 'icons/')) root = root.replace(/[^/]+\/$/, config.ICON_ASSET_VERSION + '/')
  return root + src.slice(PREFIX.length)
}

function atlasPath() {
  const fileID = cloudId(ATLAS)
  if (!fileID || !wx.cloud.downloadFile) return Promise.resolve(ATLAS)
  if (!atlasDownload) {
    atlasDownload = new Promise((resolve, reject) => {
      wx.cloud.downloadFile({
        fileID,
        success: res => res.tempFilePath ? resolve(res.tempFilePath) : reject(),
        fail: reject
      })
    }).catch(() => {
      atlasDownload = null
      return ATLAS
    })
  }
  return atlasDownload
}

// Canvas 图片需要文件路径。两种画布共用一次下载，各自解码图集。
function loadAtlasImage(image, loaded, failed) {
  image.onload = loaded
  atlasPath().then(path => {
    image.onerror = e => {
      if (path === ATLAS) {
        failed(e)
        return
      }
      atlasDownload = null
      image.onerror = failed
      image.src = ATLAS
    }
    image.src = path
  })
}

module.exports = { cloudId, loadAtlasImage }
