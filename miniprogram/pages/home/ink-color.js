function hexToHsv(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  let hue = 0
  if (delta) {
    if (max === r) hue = (g - b) / delta
    else if (max === g) hue = (b - r) / delta + 2
    else hue = (r - g) / delta + 4
  }
  return { h: Math.round((hue * 60 + 360) % 360), s: max ? delta / max : 0, v: max }
}

function hsvToHex({ h, s, v }) {
  const channel = offset => {
    const k = (offset + h / 60) % 6
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(value * 255).toString(16).padStart(2, '0')
  }
  return ('#' + channel(5) + channel(3) + channel(1)).toUpperCase()
}

module.exports = { hexToHsv, hsvToHex }
