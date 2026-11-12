// 用户对《隐私政策》《用户协议》的选择（每台设备各记各的）。
// 同意之前，有页照常可用，但不会把任何内容传到云端。
const store = require('./store')
const legal = require('./legal')

function get() {
  const s = store.getSettings()
  const decided = s.consentV === legal.VERSION
  return { decided, ok: decided && s.consentOk === true }
}

function set(ok) {
  store.setSetting('consentV', legal.VERSION)
  store.setSetting('consentOk', !!ok)
}

module.exports = { get, set }
