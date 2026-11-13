// 3D 活页手帐：一本茶色透明六孔本，旁边放着一卷胶带。
// 坐标单位是厘米。本子平放在 XY 平面上，+Z 朝向镜头；纸页占 x∈[0,W]、y∈[-H/2,H/2]。
//
// 对外接口（页面只和这些打交道）：
//   new Planner(canvas, { width, height, dpr, y, m, year, open, on(type, data) })
//   touchStart / touchMove / touchEnd      手势（坐标相对画布左上角，px）
//   setOpen(bool) / setMonth(y, m)         开合封面、翻到某月
//   refresh()                              数据变了，重画当前月
//   addSticker(t, k)                       往纸页中间贴一张
//   previewAt / commitPreview / cancelPreview   从贴纸条拖一张出来
//   setRoll(k)                             桌上那卷胶带换成某种花色
//   focusCell(d) / setDraft(d, text) / unfocus()   镜头推到某天的格子上，边输入边画到纸上
//   resize(w, h)                           画布大小变了
//   pause() / resume() / dispose()
//
// 事件 on(type, data)：open、month、tab、cell、toast

const { createScopedThreejs } = require('../libs/threejs-miniprogram')
const draw = require('./draw')
const { InkLayer } = require('./ink')
const atlas = require('./atlas')
const date = require('../utils/date')
const store = require('../utils/store')
const catalog = require('../utils/catalog')
const sound = require('../utils/sound')
const assets = require('../utils/assets')

const W = 10.5, H = 14.8            // A6 纸页
const DESK = 0xE9EBE4
const CT = 0.2                      // 封皮厚
const T = 1.1                       // 纸叠厚
const PAGE_Z = CT + T               // 最上面一页的高度
const SPINE = 1.6                   // 书脊宽（合上时是竖起来的高度）
const HX = -1.0                     // 封皮左缘 / 书脊铰链的 x
const COVER_W = W + 1.5, COVER_H = H + 0.8
const RING_X = 0.08, RING_Z = CT + 0.6, RING_R = 0.62
const FOV = 30
const DEG = Math.PI / 180

const TAPE_W = 0.8                  // 胶带宽
const TAPE_LEN = 4.4                // 撕下来的一段有多长
const TAPE_TILE = 3.2               // 一块胶带花纹贴图代表多长
// 胶带卷：平躺在本子右下方的桌上
const ROLL = { x: 9.8, y: -8.95, r: 1.0, ri: 0.62, core: 0.52, h: 0.74 }
const TAIL_DIR = Math.atan2(0.06, -1) // 平时露在外面的那截胶带头朝左
const STRIP_SEG = 16

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function easeInOut(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
}

function easeOut(k) {
  return 1 - Math.pow(1 - k, 3)
}

let seq = 0
function newId() {
  return 'm' + Date.now().toString(36) + (seq++).toString(36)
}

class Planner {
  constructor(canvas, opts) {
    this.canvas = canvas
    this.opts = opts
    this.w = opts.width
    this.h = opts.height
    this.emit = opts.on || function () {}

    const THREE = this.THREE = createScopedThreejs(canvas)
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(opts.dpr || 2, 2))
    renderer.setSize(this.w, this.h, false)
    renderer.setClearColor(DESK, 1)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy())

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(FOV, this.w / this.h, 2, 400)
    this.raycaster = new THREE.Raycaster()
    this.painter = draw.createPainter()

    this.state = { open: false, t: 0, y: opts.y, m: opts.m, flipping: false, focus: false }
    this.rig = { az: 0, el: -0.2, dist: 60, tx: W / 2, ty: 0, tz: 1 }
    this.draft = null
    this.preview = null
    this.flip = null
    this.pull = null
    this.tapeTex = {}
    this.tapeMats = {}
    this.tweens = []
    this.stickers = []
    this.pickables = []
    this.grabbed = null
    this.g = null
    this.dirty = true
    this.running = true

    this.buildLights()
    this.buildDesk()
    this.buildBook()
    this.buildCharm()
    this.buildRoll(store.getSettings().tape)
    // 贴纸材质要先于任何一张贴纸建好（没有材质的 Mesh 会被 three 配上随机颜色）
    this.loadAtlasTexture()
    this.drawMonth(this.texTop)
    this.loadStickers()
    this.updateTabs()
    if (opts.open) {
      this.state.open = true
      this.setOpenT(1)
      this.updateTabs()
    }
    this.frame(false)

    this.painter.loadAtlas(() => {
      if (this.disposed) return
      // 图集到了：重画月历页（心情章、插画）
      this.drawMonth(this.texTop)
      this.dirty = true
    })

    this.tick = this.tick.bind(this)
    canvas.requestAnimationFrame(this.tick)
  }

  /* ---------- 贴图与材质 ---------- */

  texture(img, opts) {
    const THREE = this.THREE
    const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat)
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipMapLinearFilter
    tex.generateMipmaps = true
    tex.anisotropy = this.aniso
    if (opts && opts.repeat) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(opts.repeat[0], opts.repeat[1])
    }
    tex.needsUpdate = true
    return tex
  }

  lambert(color, map) {
    return new this.THREE.MeshLambertMaterial(map ? { map } : { color })
  }

  loadAtlasTexture() {
    const THREE = this.THREE
    const tex = this.atlasTex = new THREE.Texture()
    tex.anisotropy = this.aniso
    this.stickerMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    this.stickerMat.visible = false
    const img = this.canvas.createImage()
    assets.loadAtlasImage(img, () => {
      if (this.disposed) return
      tex.image = img
      tex.needsUpdate = true
      this.stickerMat.visible = true
      this.dirty = true
    }, e => console.error('[planner] atlas texture failed', e))
  }

  // 某种胶带花色的贴图：tile 可横向平铺；top 是胶带卷的顶面
  tapeTextures(k) {
    if (!this.tapeTex[k]) {
      this.tapeTex[k] = {
        tile: this.texture(this.painter.tapeTile(k), { repeat: [1, 1] }),
        top: this.texture(this.painter.rollTop(k, ROLL.ri / ROLL.r))
      }
    }
    return this.tapeTex[k]
  }

  tapeMaterial(k) {
    if (!this.tapeMats[k]) {
      this.tapeMats[k] = new this.THREE.MeshBasicMaterial({
        map: this.tapeTextures(k).tile, transparent: true, opacity: 0.92, depthWrite: false
      })
    }
    return this.tapeMats[k]
  }

  // 撕下来的一段胶带：两头是锯齿撕口，花纹按长度平铺（和从卷上拉出来时一样密）
  tapeGeometry() {
    if (this.tapeGeo) return this.tapeGeo
    const THREE = this.THREE
    const hw = TAPE_LEN / 2, hh = TAPE_W / 2, n = 10, tooth = 0.07
    const s = new THREE.Shape()
    s.moveTo(-hw, -hh)
    s.lineTo(hw, -hh)
    for (let i = 1; i <= n; i++) s.lineTo(hw - (i % 2 ? tooth : 0), -hh + (i * TAPE_W) / n)
    s.lineTo(-hw, hh)
    for (let i = 1; i <= n; i++) s.lineTo(-hw + (i % 2 ? tooth : 0), hh - (i * TAPE_W) / n)
    const geo = new THREE.ShapeBufferGeometry(s)
    const pos = geo.attributes.position, uv = geo.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + hw) / TAPE_TILE, (pos.getY(i) + hh) / TAPE_W)
    uv.needsUpdate = true
    this.tapeGeo = geo
    return geo
  }

  // 圆角板：x∈[0,w]，y、z 居中。第 0 组材质是正反两面，第 1 组是侧边
  plate(w, h, r, depth) {
    const THREE = this.THREE
    const s = new THREE.Shape()
    s.moveTo(r, 0)
    s.lineTo(w - r, 0)
    s.quadraticCurveTo(w, 0, w, r)
    s.lineTo(w, h - r)
    s.quadraticCurveTo(w, h, w - r, h)
    s.lineTo(r, h)
    s.quadraticCurveTo(0, h, 0, h - r)
    s.lineTo(0, r)
    s.quadraticCurveTo(0, 0, r, 0)
    const geo = new THREE.ExtrudeBufferGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 })
    const pos = geo.attributes.position, uv = geo.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w, pos.getY(i) / h)
    geo.translate(0, -h / 2, -depth / 2)
    return geo
  }

  /* ---------- 场景 ---------- */

  buildLights() {
    const THREE = this.THREE
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd4dbce, 0.73))
    // 左上方的漫射光让纸面和金属带有不同的质感。
    const key = new THREE.DirectionalLight(0xfff6e7, 0.48)
    key.position.set(-14, 16, 42)
    key.target.position.set(-1, 0, 0)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    const sc = key.shadow.camera
    sc.left = -22
    sc.right = 20
    sc.top = 18
    sc.bottom = -16
    sc.near = 8
    sc.far = 90
    key.shadow.bias = -0.0012
    key.shadow.radius = 3
    this.scene.add(key, key.target)
  }

  // 桌面本身不受光，和首页背景连成一片，
  // 上面再铺一层只显示影子的透明面
  buildDesk() {
    const THREE = this.THREE
    const geo = new THREE.PlaneBufferGeometry(400, 400)
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: DESK })))
    const shade = new THREE.Mesh(geo, new THREE.ShadowMaterial({ color: 0x435046, opacity: 0.27 }))
    shade.position.z = 0.002
    shade.receiveShadow = true
    this.scene.add(shade)
  }

  // 染色 PVC 透出下方纸张和活页环。压边、口袋的接缝和窗光共用一张透明面。
  sleeveMaterial(tint) {
    return new this.THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { tint: { value: tint } },
      vertexShader: `
        varying vec2 coverUV;
        varying vec3 viewNormal;
        varying vec3 viewDir;

        void main() {
          coverUV = uv;
          viewNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          viewDir = -viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        varying vec2 coverUV;
        varying vec3 viewNormal;
        varying vec3 viewDir;
        uniform float tint;

        float band(float distanceToLine, float width) {
          float distance = distanceToLine / width;
          return exp(-distance * distance);
        }

        void main() {
          vec2 p = coverUV;
          vec3 view = normalize(viewDir);
          float grazing = 1.0 - clamp(dot(view, normalize(viewNormal)), 0.0, 1.0);
          vec2 corner = abs((p - 0.5) * vec2(0.77, 1.0)) - vec2(0.34, 0.455);
          float edge = -(length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - 0.038);
          float rim = band(edge, 0.007) * 0.64 + band(edge - 0.018, 0.003) * 0.40;
          float pocket = smoothstep(0.38, 0.383, p.x) * (1.0 - smoothstep(0.91, 0.913, p.x))
            * (1.0 - smoothstep(0.41, 0.414, p.y));
          float seams = band(p.x - 0.135, 0.0035) * 0.29 + band(p.x - 0.91, 0.003) * 0.23;
          seams += band(p.y - 0.413, 0.0035) * smoothstep(0.37, 0.40, p.x)
            * (1.0 - smoothstep(0.89, 0.92, p.x)) * 0.25;

          float sweep = p.x + 0.045 * sin(p.y * 13.0) + 0.12 * p.y * p.y + view.x * 0.58;
          float gloss = band(sweep - 0.20, 0.037) * (0.18 + 0.28 * p.y);
          gloss += band(sweep - 0.60, 0.075) * smoothstep(0.40, 0.90, p.y) * 0.24;
          gloss += band(sweep - 0.96, 0.034) * 0.17;
          float top = p.y - 0.925 + 0.028 * sin(p.x * 11.0) + view.y * 0.24;
          gloss += band(top, 0.026) * smoothstep(0.05, 0.32, p.x)
            * (1.0 - smoothstep(0.73, 0.98, p.x)) * 0.33;

          float shine = clamp(rim + seams + gloss + grazing * grazing * 0.44, 0.0, 0.90);
          float shade = tint + pocket * 0.12;
          float opacity = shine + shade * (1.0 - shine);
          vec3 amber = mix(vec3(0.34, 0.17, 0.055), vec3(0.19, 0.073, 0.032), pocket * 0.6);
          vec3 highlight = vec3(1.0, 0.91, 0.72);
          vec3 color = mix(amber, highlight, shine / max(opacity, 0.001));
          gl_FragColor = vec4(color, opacity);
        }
      `
    })
  }

  buildBook() {
    const THREE = this.THREE
    const book = this.book = new THREE.Group()
    this.scene.add(book)
    const chestnut = this.lambert(0x70421F)
    const shadow = m => {
      m.castShadow = true
      m.receiveShadow = true
      return m
    }

    const inset = 0.18
    const insertW = COVER_W - 2 * inset, insertH = COVER_H - 2 * inset
    const plateGeo = this.plate(insertW, insertH, 0.52, 0.13)
    const sleeveGeo = this.plate(COVER_W, COVER_H, 0.64, CT + 0.065)
    const sleeveEdge = new THREE.MeshBasicMaterial({
      color: 0xA8753C, transparent: true, opacity: 0.63, depthWrite: false
    })

    // 后封皮的透明边缘在纸叠四周露出来。
    const back = shadow(new THREE.Mesh(plateGeo, chestnut))
    back.position.set(HX + inset, 0, CT / 2 + 0.03)
    back.userData = { type: 'back' }
    const backSleeve = new THREE.Mesh(sleeveGeo, [this.sleeveMaterial(0.20), sleeveEdge])
    backSleeve.position.set(HX, 0, CT / 2 + 0.03)
    backSleeve.renderOrder = 4
    book.add(back, backSleeve)

    // 纸叠
    const edgeU = this.lambert(0, this.texture(draw.pageEdge(true), { repeat: [3, 1] }))
    const edgeV = this.lambert(0, this.texture(draw.pageEdge(false), { repeat: [1, 3] }))
    const paper = this.lambert(0xFCF9EF)
    const stack = shadow(new THREE.Mesh(new THREE.BoxBufferGeometry(W, H, T), [edgeU, edgeU, edgeV, edgeV, paper, paper]))
    stack.position.set(W / 2, 0, CT + T / 2)
    book.add(stack)

    // 最上面的月历页；翻页时另一张贴图给另一个月用
    const blank = { data: new Uint8Array([252, 249, 239, 255]), width: 1, height: 1 }
    this.texTop = this.texture(blank)
    this.texSpare = this.texture(blank)
    const page = this.pageMesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(W, H), this.lambert(0, this.texTop))
    page.position.set(W / 2, 0, PAGE_Z + 0.01)
    page.receiveShadow = true
    page.userData = { type: 'page' }
    book.add(page)

    // 活页环
    const metal = new THREE.MeshMatcapMaterial({ color: 0xE8CB9B, matcap: this.texture(draw.matcap(128)) })
    const base = new THREE.Mesh(this.plate(0.68, H * 0.72, 0.18, 0.1), metal)
    base.position.set(RING_X - 0.73, 0, CT + 0.05)
    book.add(base)
    const ringGeo = new THREE.TorusBufferGeometry(RING_R, 0.065, 10, 40)
    draw.RINGF.forEach(f => {
      const ring = new THREE.Mesh(ringGeo, metal)
      ring.rotation.x = Math.PI / 2
      ring.position.set(RING_X, H / 2 - f * H, RING_Z)
      ring.castShadow = true
      book.add(ring)
    })

    // 月份索引标签，贴在纸叠右缘
    this.tabs = []
    const th = (H - 1.0) / 12
    const tabGeo = this.plate(0.82, th - 0.13, 0.18, 0.04)
    for (let i = 0; i < 12; i++) {
      const tab = new THREE.Mesh(tabGeo, [
        this.lambert(0, this.texture(this.painter.tab(i + 1, false))),
        this.lambert(0x8A9D8D)
      ])
      tab.position.set(W - 0.12, H / 2 - 0.5 - th * (i + 0.5), PAGE_Z - 0.035)
      tab.castShadow = true
      tab.userData = { type: 'tab', m: i + 1, on: this.texture(this.painter.tab(i + 1, true)), off: tab.material[0].map }
      this.tabs.push(tab)
      book.add(tab)
    }

    // 书脊和前封皮：两道铰链，合上时书脊竖着、封皮盖在纸上；打开后一起摊平在左边
    const spineG = this.spineG = new THREE.Group()
    spineG.position.set(HX, 0, CT / 2)
    const spine = shadow(new THREE.Mesh(this.plate(SPINE, COVER_H - 0.2, 0.19, CT), chestnut))
    spine.userData = { type: 'cover' }
    spineG.add(spine)
    const welt = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.066, 0.066, COVER_H - 0.4, 12), metal)
    welt.position.set(SPINE - 0.08, 0, 0.12)
    spineG.add(welt)
    const coverG = this.coverG = new THREE.Group()
    coverG.position.x = SPINE
    spineG.add(coverG)
    const cover = new THREE.Mesh(sleeveGeo, [this.sleeveMaterial(0.34), sleeveEdge])
    cover.userData = { type: 'cover' }
    cover.renderOrder = 4
    const print = new THREE.Mesh(new THREE.PlaneBufferGeometry(COVER_W, COVER_H),
      new THREE.MeshBasicMaterial({
        map: this.texture(this.painter.coverPrint()), transparent: true, depthWrite: false
      }))
    print.position.set(COVER_W / 2, 0, (CT + 0.065) / 2 + 0.006)
    print.renderOrder = 5
    const lining = new THREE.Mesh(new THREE.PlaneBufferGeometry(insertW, insertH),
      new THREE.MeshBasicMaterial({
        map: this.texture(this.painter.lining()), transparent: true, opacity: 0.67, depthWrite: false
      }))
    lining.position.set(COVER_W / 2, 0, -(CT + 0.065) / 2 - 0.004)
    lining.rotation.y = Math.PI
    lining.renderOrder = 5
    coverG.add(cover, print, lining)
    this.buildElastic(coverG, metal)

    // 扉页留在活页环内。翻起封面时随动画露出下面的月历。
    const titlePage = this.titlePage = new THREE.Mesh(new THREE.PlaneBufferGeometry(W - 0.46, H),
      new THREE.MeshLambertMaterial({
        map: this.texture(this.painter.coverInsert(this.opts.year || this.state.y)),
        transparent: true, depthWrite: false
      }))
    titlePage.position.set((W + 0.46) / 2, 0, PAGE_Z + 0.018)
    titlePage.renderOrder = 3
    titlePage.receiveShadow = true
    book.add(titlePage)
    book.add(spineG)
    // 翻页用的那张纸（会弯）。正面是月历，背面印着周计划
    const backImg = this.painter.back()
    const texBack = this.texture(backImg)
    const texBackMirror = this.texture(backImg, { repeat: [-1, 1] })
    texBackMirror.offset.x = 1
    const flipGeo = this.flipGeo = new THREE.PlaneBufferGeometry(W, H, 24, 1)
    flipGeo.translate(W / 2, 0, 0)
    this.flipBase = flipGeo.attributes.position.array.slice()
    const flip = this.flipG = new THREE.Group()
    this.flipFront = new THREE.Mesh(flipGeo, new THREE.MeshLambertMaterial({ map: this.texSpare, side: THREE.FrontSide }))
    const flipBack = new THREE.Mesh(flipGeo, new THREE.MeshLambertMaterial({ map: texBackMirror, side: THREE.BackSide }))
    this.flipFront.castShadow = true
    // 跟着这张纸一起翻的贴纸
    this.flipStk = new THREE.Group()
    flip.add(this.flipFront, flipBack, this.flipStk)
    flip.visible = false
    book.add(flip)

    // 已经翻过去的页，摞在摊开的封皮上
    const left = this.leftG = new THREE.Group()
    this.leftBox = new THREE.Mesh(new THREE.BoxBufferGeometry(W, H, 1), [edgeU, edgeU, edgeV, edgeV, paper, paper])
    this.leftBox.position.x = -W / 2
    this.leftBox.castShadow = true
    this.leftTop = new THREE.Mesh(new THREE.PlaneBufferGeometry(W, H), this.lambert(0, texBack))
    this.leftTop.position.x = -W / 2
    this.leftTop.receiveShadow = true
    left.add(this.leftBox, this.leftTop)
    left.visible = false
    book.add(left)

    // 贴纸层
    this.stickerG = new THREE.Group()
    this.stickerG.position.z = PAGE_Z + 0.03
    book.add(this.stickerG)

    this.pickables = [cover, spine, page, back].concat(this.tabs)
    this.setOpenT(0)
  }

  buildElastic(cover, metal) {
    const THREE = this.THREE
    const elastic = this.elastic = new THREE.Group()
    elastic.position.set(COVER_W - 0.12, -2.10, 0)
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-COVER_W + 0.08, 0.04, 0.18),
      new THREE.Vector3(-COVER_W + 1.2, 0.015, 0.19),
      new THREE.Vector3(-COVER_W * 0.50, 0, 0.19),
      new THREE.Vector3(-0.75, 0.02, 0.19),
      new THREE.Vector3(0.08, 0.08, 0.155),
      new THREE.Vector3(0.17, 0.17, -0.04),
      new THREE.Vector3(0.055, 0.30, -0.55)
    ])
    const band = new THREE.Mesh(new THREE.TubeBufferGeometry(path, 48, 0.053, 9, false),
      this.lambert(0xFFEFCD))
    band.castShadow = true
    const stud = new THREE.Mesh(new THREE.SphereBufferGeometry(0.16, 16, 10), metal)
    stud.scale.z = 0.34
    stud.position.set(0.015, 0.15, 0.16)
    elastic.add(band, stud)
    cover.add(elastic)
  }

  buildCharm() {
    const THREE = this.THREE
    const charm = this.charm = new THREE.Group()
    const metal = new THREE.MeshMatcapMaterial({ color: 0xDFC29D, matcap: this.texture(draw.matcap(64)) })
    const ring = new THREE.Mesh(new THREE.TorusBufferGeometry(0.32, 0.052, 10, 30), metal)
    ring.scale.y = 1.3
    ring.position.y = 0.34
    const loop = new THREE.Mesh(new THREE.TorusBufferGeometry(0.20, 0.041, 8, 24), metal)
    loop.position.y = 1.0
    const bell = new THREE.Mesh(new THREE.SphereBufferGeometry(0.23, 20, 16), metal)
    bell.position.set(-0.52, 1.56, 0.095)
    const side = this.lambert(0xB79670)
    const face = this.lambert(0, this.texture(this.painter.charm()))
    const disc = new THREE.Mesh(new THREE.CylinderBufferGeometry(0.96, 0.96, 0.15, 40), [side, face, side])
    disc.rotation.set(Math.PI / 2, Math.PI / 2, 0)
    disc.castShadow = true
    disc.userData = { type: 'charm' }
    const pendant = this.pendant = new THREE.Group()
    pendant.position.y = 1.98
    pendant.add(disc)
    charm.add(ring, loop, pendant, bell)
    this.charmSwing = 0
    this.poseCharm()
    this.scene.add(charm)
    this.pickables.push(disc)
  }

  // 胶带卷：外圈是胶带花纹，顶面是一圈圈的胶带边，中间是牛皮纸芯；旁边露出一截胶带头
  buildRoll(k) {
    const THREE = this.THREE
    const g = this.roll = new THREE.Group()
    g.position.set(ROLL.x, ROLL.y, 0)
    this.rollK = catalog.TAPES.some(t => t.id === k) ? k : catalog.TAPES[0].id
    const tex = this.tapeTextures(this.rollK)

    const sideGeo = new THREE.CylinderBufferGeometry(ROLL.r, ROLL.r, ROLL.h, 48, 1, true)
    const uv = sideGeo.attributes.uv
    // 周长约 6.6 厘米，花纹铺两遍正好接上
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2)
    this.rollSide = new THREE.Mesh(sideGeo, new THREE.MeshLambertMaterial({ map: tex.tile }))
    this.rollSide.rotation.x = Math.PI / 2
    this.rollSide.position.z = ROLL.h / 2
    this.rollSide.castShadow = true
    this.rollTop = new THREE.Mesh(new THREE.RingBufferGeometry(ROLL.ri, ROLL.r, 48, 1), new THREE.MeshLambertMaterial({ map: tex.top }))
    this.rollTop.position.z = ROLL.h + 0.002
    const core = new THREE.Mesh(new THREE.RingBufferGeometry(ROLL.core, ROLL.ri, 40, 1), this.lambert(0xCDB286))
    core.position.z = ROLL.h + 0.004
    const wall = new THREE.Mesh(new THREE.CylinderBufferGeometry(ROLL.core, ROLL.core, ROLL.h, 32, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xA88C5E, side: THREE.BackSide }))
    wall.rotation.x = Math.PI / 2
    wall.position.z = ROLL.h / 2
    // 中间的洞也要点得到：一块不画出来、只用来命中的圆片
    const holeMat = new THREE.MeshBasicMaterial()
    holeMat.visible = false
    const hole = new THREE.Mesh(new THREE.CircleBufferGeometry(ROLL.core, 24), holeMat)
    hole.position.z = ROLL.h
    g.add(this.rollSide, this.rollTop, core, wall, hole)
    this.scene.add(g)

    // 胶带头和拉出来的那一条，都是一条能弯的带子
    const stripMat = () => new THREE.MeshBasicMaterial({ map: tex.tile, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false })
    this.tail = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1, STRIP_SEG, 1), stripMat())
    this.strip = new THREE.Mesh(new THREE.PlaneBufferGeometry(1, 1, STRIP_SEG, 1), stripMat())
    this.strip.visible = false
    this.strip.renderOrder = 998
    this.scene.add(this.tail, this.strip)
    this.restTail()

    const hit = { type: 'roll' }
    const parts = [this.rollSide, this.rollTop, core, hole, this.tail]
    parts.forEach(m => {
      m.userData = hit
    })
    this.pickables.push.apply(this.pickables, parts)
  }

  // 平时那截胶带头：贴着桌面，从卷边往左伸出一点
  restTail() {
    const dx = Math.cos(TAIL_DIR), dy = Math.sin(TAIL_DIR)
    const ax = ROLL.x + dx * ROLL.r, ay = ROLL.y + dy * ROLL.r
    this.shapeStrip(this.tail, ax, ay, 0.02, ax + dx * 1.5, ay + dy * 1.5, 0.02, 0)
    this.tail.visible = true
  }

  // 把一条带子摆成从 A 到 P 的样子，中间拱起 lift 那么高
  shapeStrip(mesh, ax, ay, az, px, py, pz, lift) {
    const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv
    const dx = px - ax, dy = py - ay
    const len = Math.sqrt(dx * dx + dy * dy) || 0.001
    const nx = (-dy / len) * TAPE_W / 2, ny = (dx / len) * TAPE_W / 2
    for (let i = 0; i <= STRIP_SEG; i++) {
      const t = i / STRIP_SEG
      const cx = ax + dx * t, cy = ay + dy * t
      const cz = az + (pz - az) * t + lift * Math.sin(Math.PI * t)
      const u = (t * len) / TAPE_TILE
      pos.setXYZ(i, cx + nx, cy + ny, cz)
      pos.setXYZ(STRIP_SEG + 1 + i, cx - nx, cy - ny, cz)
      uv.setXY(i, u, 1)
      uv.setXY(STRIP_SEG + 1 + i, u, 0)
    }
    pos.needsUpdate = true
    uv.needsUpdate = true
    mesh.geometry.computeBoundingSphere()
    mesh.geometry.computeBoundingBox()
    this.dirty = true
  }

  setRoll(k) {
    if (k === this.rollK || !catalog.TAPES.some(t => t.id === k)) return
    this.rollK = k
    const tex = this.tapeTextures(k)
    this.rollSide.material.map = tex.tile
    this.rollTop.material.map = tex.top
    this.tail.material.map = tex.tile
    this.strip.material.map = tex.tile
    store.setSetting('tape', k)
    // 转一下，像拿起来又放下
    const r0 = this.roll.rotation.z
    this.tween(420, q => {
      this.roll.rotation.z = r0 + q * Math.PI * 0.5
    }, null, easeOut)
    this.dirty = true
  }

  // 点一下胶带卷：换下一种花色
  nextRoll() {
    const list = catalog.TAPES
    const i = list.findIndex(t => t.id === this.rollK)
    const next = list[(i + 1) % list.length]
    this.setRoll(next.id)
    sound.play('stick')
    this.emit('toast', '换成「' + next.name + '」')
  }

  // t: 0 合上 → 1 摊开
  setOpenT(t) {
    this.state.t = t
    this.spineG.rotation.y = -(Math.PI / 2) * (1 + t)
    this.coverG.rotation.y = (Math.PI / 2) * (1 - t)
    const release = easeOut(clamp(t / 0.65, 0, 1))
    this.elastic.scale.x = 1 - 0.87 * release
    this.elastic.rotation.y = -0.26 * release
    this.titlePage.material.opacity = 1 - clamp((t - 0.12) / 0.46, 0, 1)
    this.titlePage.visible = t < 0.58
    this.stickerG.visible = !this.titlePage.visible
    if (this.charm) this.poseCharm()
    this.dirty = true
  }

  poseCharm() {
    const t = this.state.t
    const angle = -2.42 + 2.66 * t
    this.charm.position.set(HX + 0.37 - 0.16 * t, COVER_H / 2 - 1.26 + 0.48 * t, 1.99 - 1.65 * t)
    this.charm.rotation.z = angle + this.charmSwing
    this.pendant.rotation.z = -angle
  }

  /* ---------- 月历页 ---------- */

  // 把某个月画进贴图，返回这个月的格子布局
  paint(tex, y, m, draft) {
    const weekStart = store.getSettings().weekStart
    const preview = this.drawing && this.inkMesh.visible && tex === this.texTop && y === this.state.y && m === this.state.m
    const lines = preview ? [] : store.getMonthInk(date.ym(y, m))
    tex.image = this.painter.month(y, m, weekStart, draft, lines)
    tex.needsUpdate = true
    this.dirty = true
    return draw.layout(y, m, weekStart)
  }

  drawMonth(tex) {
    const { y, m } = this.state
    const layout = this.paint(tex, y, m, tex === this.texTop ? this.draft : null)
    if (tex === this.texTop) this.layout = layout
  }

  // 正在往某天的格子里写字：把输入中的文字直接画到纸上。d 为 0 表示写完了
  setDraft(d, text) {
    this.draft = d ? { d, text: text || '' } : null
    this.drawMonth(this.texTop)
  }

  refresh() {
    if (this.flip) return
    this.drawMonth(this.texTop)
    this.loadStickers()
    this.inkDirty = true
  }

  setDrawing(on) {
    this.drawing = on
    if (on && !this.inkMesh) {
      const THREE = this.THREE
      this.inkLayer = new InkLayer(draw.LW, draw.LH)
      this.inkPreview = new InkLayer(draw.LW, draw.LH)
      // 2D 画布的像素从上往下，WebGL 的 UV 从下往上。
      this.inkTex = new THREE.DataTexture(null, 1, 1, THREE.RGBAFormat)
      this.inkTex.flipY = true
      this.inkTex.minFilter = this.inkTex.magFilter = THREE.LinearFilter
      this.inkTex.generateMipmaps = false
      this.inkMesh = new THREE.Mesh(this.pageMesh.geometry,
        new THREE.MeshLambertMaterial({ map: this.inkTex, transparent: true, depthWrite: false }))
      this.inkMesh.position.copy(this.pageMesh.position)
      this.inkMesh.position.z += 0.005
      this.inkMesh.renderOrder = 9
      this.inkMesh.receiveShadow = true
      this.pageMesh.parent.add(this.inkMesh)
    }
    if (!this.inkMesh) return
    this.previewInk(null)
    this.inkMesh.visible = on && !this.flip
    if (!this.flip) this.drawMonth(this.texTop)
  }

  previewInk(line) {
    this.inkLine = line
    this.inkDirty = true
  }

  drawInkPreview() {
    const saved = store.getMonthInk(date.ym(this.state.y, this.state.m))
    if (this.inkSaved !== saved) {
      this.inkSaved = saved
      this.inkLayer.paint(saved)
    }
    const layer = this.inkLine ? this.inkPreview : this.inkLayer
    if (this.inkLine) layer.preview(this.inkLayer, this.inkLine)
    this.inkTex.image = layer.pixels()
    this.inkTex.needsUpdate = true
    this.inkDirty = false
    this.dirty = true
  }

  inkPoint(x, y, clampToPage) {
    if (!this.canStick() || this.state.focus) return null
    this.camera.updateMatrixWorld()
    const p = this.pagePoint(x, y, this.pageMesh.position.z)
    if (!p || (!clampToPage && !this.onPage(p, 0))) return null
    return [Math.round(clamp(p.x / W, 0, 1) * draw.LW), Math.round(clamp(0.5 - p.y / H, 0, 1) * draw.LH)]
  }

  dayAt(x, y) {
    const point = this.inkPoint(x, y)
    return point && this.calendarCell(point[0], point[1])
  }

  calendarCell(x, y) {
    return this.layout.cells.find(c => c.inMonth && x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h)
  }

  updateTabs() {
    this.tabs.forEach(tab => {
      const on = tab.userData.m === this.state.m
      tab.material[0].map = on ? tab.userData.on : tab.userData.off
      tab.position.x = W + (on ? -0.015 : -0.12)
    })
    this.updateLeft(this.state.m)
  }

  // 左边那一摞：翻过去的月份越多越厚
  updateLeft(m) {
    const n = m - 1
    const thick = 0.05 + 0.08 * n
    this.leftBox.scale.z = thick
    this.leftBox.position.z = CT + thick / 2
    this.leftTop.position.z = CT + thick + 0.006
    this.leftG.visible = this.state.open && this.state.t > 0.97
    this.dirty = true
  }

  setMonth(y, m) {
    const s = this.state
    if (this.flip || (y === s.y && m === s.m)) return
    const dir = y * 12 + m > s.y * 12 + s.m ? 1 : -1
    if (!s.open || s.t < 1) {
      s.y = y
      s.m = m
      this.drawMonth(this.texTop)
      this.loadStickers()
      this.updateTabs()
      this.emit('month', { y, m })
      return
    }
    if (this.beginFlip(dir, { y, m })) this.endFlip(true)
  }

  // 拿起一页准备翻：dir 1 往后翻（下一个月），-1 往前翻。
  // 往后翻时，翻起来的是当前这页（连同上面的贴纸），下面露出新的月份；往前翻则是从左边拿回一页盖上来。
  beginFlip(dir, to) {
    const s = this.state
    if (this.flip || s.focus || !s.open || s.t < 1) return false
    to = to || date.addMonths(s.y, s.m, dir)
    if (this.inkMesh && this.inkMesh.visible) {
      this.inkMesh.visible = false
      this.drawMonth(this.texTop)
    }
    const oldTex = this.texTop, newTex = this.texSpare
    const layoutNew = this.paint(newTex, to.y, to.m, null)
    const oldMeshes = this.stickerG.children.slice()
    const newMeshes = this.stickerMeshes(to.y, to.m)
    this.flip = { dir, to, oldTex, newTex, layoutNew, k: 0, anim: false }
    s.flipping = true
    this.flipFront.material.map = dir > 0 ? oldTex : newTex
    this.pageMesh.material.map = dir > 0 ? newTex : oldTex
    if (dir > 0) {
      oldMeshes.forEach(mesh => {
        this.stickerG.remove(mesh)
        this.flipStk.add(mesh)
      })
      newMeshes.forEach((mesh, i) => {
        this.placeSticker(mesh, i)
        this.stickerG.add(mesh)
      })
    } else {
      newMeshes.forEach(mesh => this.flipStk.add(mesh))
    }
    this.updateLeft(dir > 0 ? s.m : to.m)
    this.flipG.visible = true
    this.setFlipK(0)
    return true
  }

  // k: 0 还没翻 → 1 翻完
  setFlipK(k) {
    const f = this.flip
    f.k = k
    this.bendFlip(f.dir > 0 ? k * Math.PI : (1 - k) * Math.PI)
  }

  // 松手：commit 为 true 就翻过去，否则落回原处
  endFlip(commit) {
    const f = this.flip
    if (!f || f.anim) return
    f.anim = true
    const from = f.k, to = commit ? 1 : 0
    if (from === to) {
      this.finishFlip(commit)
      return
    }
    if (commit) sound.play('flip')
    const dur = from === 0 ? 720 : 140 + 520 * Math.abs(to - from)
    this.tween(dur, q => this.setFlipK(from + (to - from) * q), () => this.finishFlip(commit), from === 0 ? easeInOut : easeOut)
  }

  finishFlip(commit) {
    const f = this.flip
    const s = this.state
    this.flip = null
    s.flipping = false
    this.flipG.visible = false
    while (this.flipStk.children.length) this.flipStk.remove(this.flipStk.children[0])
    if (commit) {
      s.y = f.to.y
      s.m = f.to.m
      this.texTop = f.newTex
      this.texSpare = f.oldTex
      this.layout = f.layoutNew
    }
    this.pageMesh.material.map = this.texTop
    if (this.inkMesh) {
      this.inkMesh.visible = this.drawing
      if (this.drawing) {
        this.drawMonth(this.texTop)
        this.inkDirty = true
      }
    }
    this.loadStickers()
    this.updateTabs()
    if (commit) this.emit('month', { y: s.y, m: s.m })
  }

  // a: 0 平躺在右边 → π 翻到左边。纸的外缘比装订边慢半拍，所以中途是弯的
  bendFlip(a) {
    const pos = this.flipGeo.attributes.position
    const curl = -0.75 * Math.sin(a)
    for (let i = 0; i < pos.count; i++) {
      const u = this.flipBase[i * 3]
      const ang = a + curl * (u / W) * (u / W)
      pos.setX(i, u * Math.cos(ang))
      pos.setZ(i, u * Math.sin(ang))
    }
    pos.needsUpdate = true
    this.flipGeo.computeVertexNormals()
    const leftZ = this.leftTop.position.z + 0.02
    const k = a / Math.PI
    this.flipG.position.set(0, 0, PAGE_Z + 0.03 + (leftZ - PAGE_Z) * k + 0.3 * Math.sin(a))

    // 纸上的贴纸：按它在纸上的位置找到弯曲后的那一点，并顺着纸面转过去。
    // 纸翻过竖直以后贴纸正面朝下，被背面剔除，自然就看不见了
    const kids = this.flipStk.children
    for (let i = 0; i < kids.length; i++) {
      const mesh = kids[i], st = mesh.userData.st
      const u = st.x * W
      const ang = a + curl * (u / W) * (u / W)
      const dang = (2 * curl * u) / (W * W)
      const phi = Math.atan2(Math.sin(ang) + u * Math.cos(ang) * dang, Math.cos(ang) - u * Math.sin(ang) * dang)
      const off = 0.02 + 0.004 * i
      mesh.position.set(u * Math.cos(ang) - Math.sin(phi) * off, H / 2 - st.y * W, u * Math.sin(ang) + Math.cos(phi) * off)
      mesh.rotation.set(0, -phi, -st.r * DEG)
      mesh.scale.set(st.s, st.s, 1)
      mesh.renderOrder = 10 + i
    }
    this.dirty = true
  }

  setOpen(open) {
    const s = this.state
    if (this.flip || this.pull || s.focus || s.open === open) return
    s.open = open
    if (!open) this.leftG.visible = false
    const from = s.t, to = open ? 1 : 0
    sound.play('cover')
    this.tween(950, k => this.setOpenT(from + (to - from) * k), () => this.updateTabs())
    this.frame(true)
    this.emit('open', open)
  }

  /* ---------- 贴纸 ---------- */

  stickerMesh(st) {
    const THREE = this.THREE
    let mesh
    if (st.t === 't') {
      mesh = new THREE.Mesh(this.tapeGeometry(), this.tapeMaterial(st.k))
    } else {
      const cell = atlas.map[catalog.stickerKey(st.k)]
      // 老字签以原本的高度贴入方形插画，避免把图案横向拉长。
      const size = catalog.isWide(st.k) ? 1.6 : 2.1
      const geo = new THREE.PlaneBufferGeometry(size, size)
      const du = atlas.cell / atlas.width, dv = atlas.cell / atlas.height
      const u0 = cell[0] * du, u1 = u0 + du
      const v1 = 1 - cell[1] * dv, v0 = v1 - dv
      const uv = geo.attributes.uv
      uv.setXY(0, u0, v1)
      uv.setXY(1, u1, v1)
      uv.setXY(2, u0, v0)
      uv.setXY(3, u1, v0)
      mesh = new THREE.Mesh(geo, this.stickerMat)
    }
    mesh.userData = { type: 'sticker', st }
    return mesh
  }

  stickerMeshes(y, m) {
    return store.getMonthDeco(date.ym(y, m)).map(st => this.stickerMesh(Object.assign({}, st)))
  }

  // st.x: 0–1（纸宽），st.y: 距纸页上缘多少个纸宽，st.r: 顺时针角度
  placeSticker(mesh, i) {
    const st = mesh.userData.st
    mesh.position.set(st.x * W, H / 2 - st.y * W, 0.004 * i)
    mesh.scale.set(st.s, st.s, 1)
    mesh.rotation.set(0, 0, -st.r * DEG)
    mesh.renderOrder = 10 + i
  }

  loadStickers() {
    const g = this.stickerG
    while (g.children.length) g.remove(g.children[0])
    this.preview = null
    const meshes = this.stickerMeshes(this.state.y, this.state.m)
    this.stickers = meshes.map(mesh => mesh.userData.st)
    meshes.forEach((mesh, i) => {
      this.placeSticker(mesh, i)
      g.add(mesh)
    })
    this.dirty = true
  }

  saveStickers() {
    store.saveMonthDeco(date.ym(this.state.y, this.state.m), this.stickers)
  }

  // 屏幕上一点落在纸页平面的哪里（世界坐标），落不到返回 null
  pagePoint(x, y, z = PAGE_Z) {
    const rc = this.raycaster
    rc.setFromCamera({ x: (x / this.w) * 2 - 1, y: -(y / this.h) * 2 + 1 }, this.camera)
    const o = rc.ray.origin, d = rc.ray.direction
    if (Math.abs(d.z) < 1e-6) return null
    const k = (z - o.z) / d.z
    return k > 0 ? { x: o.x + d.x * k, y: o.y + d.y * k } : null
  }

  onPage(p, margin) {
    return !!p && p.x > -margin && p.x < W + margin && p.y > -H / 2 - margin && p.y < H / 2 + margin
  }

  canStick() {
    const s = this.state
    return s.open && s.t >= 1 && !this.flip
  }

  // 往纸页中间贴一张
  addSticker(t, k) {
    if (!this.canStick()) return false
    const st = {
      id: newId(), t, k,
      x: Math.round((0.5 + (Math.random() - 0.5) * 0.3) * 1000) / 1000,
      y: Math.round(((H / 2 - (Math.random() - 0.5) * 3) / W) * 1000) / 1000,
      s: 1,
      r: Math.round((Math.random() - 0.5) * 16)
    }
    this.stickers.push(st)
    const mesh = this.stickerMesh(st)
    this.placeSticker(mesh, this.stickers.length - 1)
    this.stickerG.add(mesh)
    this.saveStickers()
    this.pop(mesh)
    sound.play('stick')
    return true
  }

  // 落下时轻轻弹一下
  pop(mesh) {
    const s = mesh.userData.st.s
    this.tween(260, k => {
      const sc = s * (1.25 - 0.25 * k)
      mesh.scale.set(sc, sc, 1)
    }, null, easeOut)
  }

  // 从贴纸条里拖出来：手指经过画布时，一张悬着的贴纸跟着走
  previewAt(t, k, x, y) {
    if (!this.canStick()) return
    if (!this.preview) {
      const st = { id: newId(), t, k, x: 0.5, y: 0.5, s: 1, r: Math.round((Math.random() - 0.5) * 16) }
      this.holdPreview(this.stickerMesh(st))
    }
    const p = this.pagePoint(x, y)
    if (!p) return
    this.preview.position.set(p.x, p.y, 0.35)
    this.dirty = true
  }

  // 一张悬在纸上方、还没贴下去的贴纸
  holdPreview(mesh) {
    const st = mesh.userData.st
    this.preview = mesh
    mesh.renderOrder = 999
    mesh.scale.set(1.08, 1.08, 1)
    mesh.rotation.set(0, 0, -st.r * DEG)
    this.stickerG.add(mesh)
  }

  // 松手：落在纸页上就贴住，否则丢掉
  commitPreview() {
    const mesh = this.preview
    this.preview = null
    if (!mesh) return false
    if (!this.canStick() || !this.onPage({ x: mesh.position.x, y: mesh.position.y }, 0)) {
      this.stickerG.remove(mesh)
      this.dirty = true
      return false
    }
    const st = mesh.userData.st
    st.x = Math.round((mesh.position.x / W) * 1000) / 1000
    st.y = Math.round(((H / 2 - mesh.position.y) / W) * 1000) / 1000
    this.stickers.push(st)
    this.placeSticker(mesh, this.stickers.length - 1)
    this.saveStickers()
    this.pop(mesh)
    sound.play('stick')
    return true
  }

  cancelPreview() {
    if (!this.preview) return
    this.stickerG.remove(this.preview)
    this.preview = null
    this.dirty = true
  }

  /* ---------- 从胶带卷上拉一段 ---------- */

  startPull() {
    this.pull = { len: 0, ticks: 0, torn: false, a: null, p: null }
    this.tail.visible = false
    sound.play('peel')
  }

  movePull(t) {
    const pull = this.pull
    const p = this.pagePoint(t.x, t.y)
    if (!p) return
    if (pull.torn) {
      // 撕下来以后，手指捏着这段的一头
      this.preview.position.set(p.x + pull.off.x, p.y + pull.off.y, 0.35)
      this.dirty = true
      return
    }
    const dx = p.x - ROLL.x, dy = p.y - ROLL.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const ux = dx / d, uy = dy / d
    const a = { x: ROLL.x + ux * ROLL.r, y: ROLL.y + uy * ROLL.r }
    const len = Math.max(0, d - ROLL.r)
    pull.a = a
    pull.p = p
    pull.len = len
    if (len < 0.1) {
      this.strip.visible = false
      this.dirty = true
      return
    }
    this.strip.visible = true
    // 拉起来的胶带在空中拱一点，别穿过本子的边
    this.shapeStrip(this.strip, a.x, a.y, ROLL.h * 0.5, p.x, p.y, PAGE_Z + 0.35, 0.5 + len * 0.08)
    // 每拉出一截响一下
    const ticks = Math.floor(len / 1.4)
    if (ticks > pull.ticks) {
      pull.ticks = ticks
      sound.play('peel')
    }
    if (len >= TAPE_LEN) this.tear(ux, uy, p)
  }

  // 拉够长度，撕断：这一段变成一张捏在手里的胶带
  tear(ux, uy, p) {
    const pull = this.pull
    let r = Math.round(-Math.atan2(uy, ux) / DEG)
    if (r > 90) r -= 180
    if (r <= -90) r += 180
    const st = { id: newId(), t: 't', k: this.rollK, x: 0.5, y: 0.5, s: 1, r }
    this.cancelPreview()
    this.holdPreview(this.stickerMesh(st))
    pull.torn = true
    pull.off = { x: -ux * TAPE_LEN / 2, y: -uy * TAPE_LEN / 2 }
    this.preview.position.set(p.x + pull.off.x, p.y + pull.off.y, 0.35)
    this.strip.visible = false
    this.restTail()
    sound.play('tear')
    sound.buzz('medium')
  }

  endPull() {
    const pull = this.pull
    this.pull = null
    if (pull.torn) {
      if (!this.commitPreview()) this.emit('toast', this.canStick() ? '要贴在纸页上哦' : '先把本子翻开')
      return
    }
    // 没拉够就松手：缩回卷上
    if (pull.a && this.strip.visible) {
      const a = pull.a, p = pull.p
      this.tween(160, q => {
        const k = 1 - q
        this.shapeStrip(this.strip, a.x, a.y, ROLL.h * 0.5, a.x + (p.x - a.x) * k, a.y + (p.y - a.y) * k, ROLL.h * 0.5 + (PAGE_Z + 0.35 - ROLL.h * 0.5) * k, 0.5 * k)
      }, () => {
        this.strip.visible = false
        this.restTail()
      }, easeOut)
    } else {
      this.strip.visible = false
      this.restTail()
    }
  }

  /* ---------- 镜头 ---------- */

  applyRig() {
    const r = this.rig, cam = this.camera
    const ce = Math.cos(r.el)
    cam.position.set(r.tx + r.dist * Math.sin(r.az) * ce, r.ty + r.dist * Math.sin(r.el), r.tz + r.dist * Math.cos(r.az) * ce)
    cam.up.set(0, 1, 0)
    cam.lookAt(r.tx, r.ty, r.tz)
    // 近远裁剪面跟着距离走，贴纸和纸页贴得很近，深度精度要省着用
    cam.near = Math.max(1, r.dist * 0.3)
    cam.far = r.dist * 3 + 120
    cam.updateProjectionMatrix()
  }

  rigTo(to, dur, done) {
    this.stopRigTween()
    const from = Object.assign({}, this.rig)
    this.rigTween = this.tween(dur, k => {
      for (const key in to) this.rig[key] = from[key] + (to[key] - from[key]) * k
      this.applyRig()
    }, done)
  }

  // 竖屏让月历保持可读，横屏给左右页都留出位置。
  frame(animate) {
    const s = this.state
    const spread = s.open && this.w >= 560 && this.w / this.h >= 1.02
    const left = spread ? HX - SPINE - COVER_W - 0.65 : s.open ? -2.1 : -3.6
    const right = s.open ? W + 1.25 : 12
    const bottom = ROLL.y - ROLL.r - 0.7
    const top = s.open ? COVER_H / 2 + 0.75 : COVER_H / 2 + 1.6
    const tanV = Math.tan(FOV * DEG / 2), tanH = tanV * (this.w / this.h)
    const to = {
      az: s.open ? 0 : 0.075,
      el: s.open ? -0.095 : -0.16,
      dist: Math.max((right - left) / 2 / tanH, (top - bottom) / 2 / tanV),
      tx: (left + right) / 2,
      ty: (bottom + top) / 2,
      tz: s.open ? PAGE_Z : 1
    }
    if (animate) this.rigTo(to, 900)
    else {
      Object.assign(this.rig, to)
      this.applyRig()
      this.dirty = true
    }
  }

  // 画布大小变了（贴纸条展开、键盘弹起）
  resize(w, h, keepView) {
    if (w === this.w && h === this.h) return
    this.w = w
    this.h = h
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    if (this.state.focus) this.focusCell(this.focusD, 260)
    else if (!keepView) this.frame(true)
    this.applyRig()
    this.dirty = true
  }

  cellOf(d) {
    return this.layout.cells.find(c => c.inMonth && c.d === d)
  }

  // 把镜头正对着推到某天的格子上（写字时用）
  focusCell(d, dur) {
    const cell = this.cellOf(d)
    if (!cell || !this.state.open || this.state.t < 1 || this.flip) return false
    this.state.focus = true
    this.focusD = d
    const tanV = Math.tan(FOV * DEG / 2), tanH = tanV * (this.w / this.h)
    const cw = cell.w / draw.LW * W, ch = cell.h / draw.LH * H
    this.rigTo({
      az: 0, el: 0,
      // 格子占画布宽度的四成左右（再近贴图就糊了），同时保证整格都在画布里
      dist: Math.max(cw / 0.4 / 2 / tanH, ch / 0.7 / 2 / tanV),
      tx: (cell.x + cell.w / 2) / draw.LW * W,
      ty: H / 2 - (cell.y + cell.h / 2) / draw.LH * H,
      tz: PAGE_Z
    }, dur || 480)
    return true
  }

  unfocus() {
    if (!this.state.focus) return
    this.state.focus = false
    this.frame(true)
  }

  startCalendarZoom(touches) {
    if (!this.canStick() || this.state.focus) return null
    this.stopRigTween()
    this.camera.updateMatrixWorld()
    const [x, y] = midpoint(touches)
    const anchor = this.pagePoint(x, y, this.pageMesh.position.z)
    return { anchor, span: span(touches), distance: this.rig.dist }
  }

  moveCalendarZoom(zoom, touches) {
    if (!this.canStick()) return
    this.rig.dist = clamp(zoom.distance * zoom.span / span(touches), 12, 150)
    this.applyRig()
    // 缩放后，把纸上原先位于两指之间的点移回当前的两指中点。
    this.camera.updateMatrixWorld()
    const [x, y] = midpoint(touches)
    const point = this.pagePoint(x, y, this.pageMesh.position.z)
    if (zoom.anchor && point) {
      this.rig.tx = clamp(this.rig.tx + zoom.anchor.x - point.x, 0, W)
      this.rig.ty = clamp(this.rig.ty + zoom.anchor.y - point.y, -H / 2, H / 2)
      this.applyRig()
    }
    this.dirty = true
  }

  /* ---------- 手势 ---------- */

  hit(x, y) {
    const rc = this.raycaster
    rc.setFromCamera({ x: (x / this.w) * 2 - 1, y: -(y / this.h) * 2 + 1 }, this.camera)
    if (this.canStick()) {
      const hs = rc.intersectObjects(this.stickerG.children)
      if (hs.length) {
        // 叠在一起时拿最上面那张
        let top = hs[0].object
        hs.forEach(h => {
          if (h.object.renderOrder > top.renderOrder) top = h.object
        })
        return { type: 'sticker', mesh: top }
      }
    }
    const hs = rc.intersectObjects(this.pickables)
    if (!hs.length) return { type: 'desk' }
    return Object.assign({ point: hs[0].point }, hs[0].object.userData)
  }

  touchStart(ts) {
    // 写字时、翻页动画进行中不接手势；翻页拖到一半又落下一根手指也不理
    if (this.state.focus || (this.flip && this.flip.anim)) return
    if (ts.length === 1) {
      if (this.flip) return
      const t = ts[0]
      this.stopRigTween()
      this.g = {
        x0: t.x, y0: t.y, x: t.x, y: t.y, t0: Date.now(), moved: false, mode: '',
        hit: this.hit(t.x, t.y), rig: Object.assign({}, this.rig), vx: 0, lt: Date.now()
      }
      if (this.g.hit.type === 'sticker') this.grab(this.g.hit.mesh, t)
    } else if (ts.length === 2 && this.g) {
      const g = this.g
      if (g.mode === 'tape' || g.mode === 'flip') return
      g.moved = true
      g.mode = this.grabbed ? 'sticker' : 'pinch'
      g.pinch = { d: span(ts), a: angle(ts), dist: this.rig.dist }
      if (this.grabbed) {
        g.pinch.s = this.grabbed.userData.st.s
        g.pinch.r = this.grabbed.userData.st.r
      }
    }
  }

  touchMove(ts) {
    const g = this.g
    if (!g || !ts.length) return
    if (ts.length >= 2 && g.pinch) {
      const k = span(ts) / g.pinch.d
      if (this.grabbed) {
        // 两指捏住贴纸：缩放 + 旋转
        const st = this.grabbed.userData.st
        st.s = clamp(Math.round(g.pinch.s * k * 100) / 100, 0.4, 3.6)
        st.r = Math.round(g.pinch.r + (angle(ts) - g.pinch.a) / DEG)
        this.grabbed.scale.set(st.s * 1.06, st.s * 1.06, 1)
        this.grabbed.rotation.z = -st.r * DEG
      } else {
        this.rig.dist = clamp(g.pinch.dist / k, 12, 150)
        this.applyRig()
      }
      this.dirty = true
      return
    }
    if (g.pinch) return // 两指抬起一指之后不再当成拖动
    const t = ts[0]
    const dx = t.x - g.x0, dy = t.y - g.y0
    if (!g.moved) {
      if (dx * dx + dy * dy < 64) return
      g.moved = true
      if (this.grabbed) g.mode = 'sticker'
      else if (g.hit.type === 'roll') {
        if (this.canStick()) {
          g.mode = 'tape'
          this.startPull()
        } else {
          g.mode = 'orbit'
          this.emit('toast', '先把本子翻开')
        }
      } else if (g.hit.type === 'page' && Math.abs(dx) > Math.abs(dy) * 1.2 && this.beginFlip(dx < 0 ? 1 : -1)) {
        g.mode = 'flip'
      } else g.mode = 'orbit'
    }
    const now = Date.now()
    g.vx = (t.x - g.x) / Math.max(1, now - g.lt)
    g.lt = now
    g.x = t.x
    g.y = t.y
    if (g.mode === 'sticker') {
      const p = this.pagePoint(t.x, t.y)
      if (p) {
        this.grabbed.position.x = p.x + this.grabOff.x
        this.grabbed.position.y = p.y + this.grabOff.y
        this.dirty = true
      }
    } else if (g.mode === 'tape') {
      this.movePull(t)
    } else if (g.mode === 'flip') {
      // 纸跟着手指翻：拖过大半个画布宽就是整页翻过去
      const f = this.flip
      this.setFlipK(clamp((f.dir > 0 ? -dx : dx) / (this.w * 0.8), 0, 1))
    } else if (g.mode === 'orbit') {
      // 拖动旋转视角，角度有限制，始终是「俯看桌面」
      this.rig.az = clamp(g.rig.az - dx * 0.005, -0.8, 0.8)
      this.rig.el = clamp(g.rig.el + dy * 0.005, -0.85, 0.35)
      this.applyRig()
      this.dirty = true
    }
  }

  touchEnd(ts) {
    const g = this.g
    if (!g || ts.length > 0) return
    this.g = null
    if (this.grabbed) {
      this.release()
      return
    }
    if (!g.moved) {
      if (Date.now() - g.t0 < 500) this.tap(g.hit)
      return
    }
    if (g.mode === 'tape') this.endPull()
    else if (g.mode === 'flip' && this.flip) {
      // 翻过四成就算数；快速一甩也算（停住一会儿再松手不算甩）
      const f = this.flip
      const vx = Date.now() - g.lt > 90 ? 0 : g.vx
      const fling = (f.dir > 0 ? -vx : vx) > 0.5
      this.endFlip(f.k > 0.4 || (f.k > 0.06 && fling))
    }
  }

  tap(hit) {
    const now = Date.now()
    const double = now - (this.lastTap || 0) < 320
    this.lastTap = now
    if (hit.type === 'cover') this.setOpen(!this.state.open)
    else if (hit.type === 'tab') this.emit('tab', hit.m)
    else if (hit.type === 'charm') this.swing()
    else if (hit.type === 'roll') this.nextRoll()
    else if (hit.type === 'page') {
      const lx = hit.point.x / W * draw.LW
      const ly = (H / 2 - hit.point.y) / H * draw.LH
      const cell = this.calendarCell(lx, ly)
      if (cell) this.emit('cell', { d: cell.d, key: cell.key })
    } else if (double) this.frame(true) // 双击桌面：视角复位
  }

  grab(mesh, t) {
    this.grabbed = mesh
    const p = this.pagePoint(t.x, t.y)
    this.grabOff = p ? { x: mesh.position.x - p.x, y: mesh.position.y - p.y } : { x: 0, y: 0 }
    // 揭起来：提到最上层，稍微放大
    const st = mesh.userData.st
    const i = this.stickers.indexOf(st)
    if (i > -1) {
      this.stickers.splice(i, 1)
      this.stickers.push(st)
    }
    mesh.position.z = 0.004 * (this.stickers.length + 2)
    mesh.renderOrder = 999
    mesh.scale.set(st.s * 1.06, st.s * 1.06, 1)
    this.dirty = true
  }

  release() {
    const mesh = this.grabbed
    this.grabbed = null
    const st = mesh.userData.st
    const inside = this.onPage({ x: mesh.position.x, y: mesh.position.y }, 0.4)
    if (!inside) {
      // 拖出纸页 = 撕掉
      this.stickers.splice(this.stickers.indexOf(st), 1)
      this.tween(220, k => mesh.scale.set(st.s * (1 - k), st.s * (1 - k), 1), () => {
        this.stickerG.remove(mesh)
        this.dirty = true
      })
      sound.play('tear')
      this.emit('toast', '撕掉了')
    } else {
      st.x = Math.round(clamp(mesh.position.x / W, 0, 1) * 1000) / 1000
      st.y = Math.round(((H / 2 - mesh.position.y) / W) * 1000) / 1000
      sound.play('stick')
    }
    this.stickerG.children.forEach(m => {
      const i = this.stickers.indexOf(m.userData.st)
      if (i > -1 && m !== mesh) this.placeSticker(m, i)
    })
    if (inside) this.placeSticker(mesh, this.stickers.indexOf(st))
    this.saveStickers()
    this.dirty = true
  }

  swing() {
    sound.play('bell')
    this.tween(2200, k => {
      this.charmSwing = 0.42 * Math.exp(-3.2 * k) * Math.sin(k * 17)
      this.poseCharm()
    }, () => {
      this.charmSwing = 0
      this.poseCharm()
    }, k => k)
  }

  /* ---------- 动画循环 ---------- */

  tween(dur, fn, done, easing) {
    const tw = { t0: Date.now(), dur, fn, done, easing: easing || easeInOut }
    this.tweens.push(tw)
    return tw
  }

  stopRigTween() {
    const i = this.tweens.indexOf(this.rigTween)
    if (i > -1) this.tweens.splice(i, 1)
    this.rigTween = null
  }

  tick() {
    if (!this.running) return
    const now = Date.now()
    if (this.tweens.length) {
      const list = this.tweens.slice()
      list.forEach(tw => {
        const k = Math.min(1, (now - tw.t0) / tw.dur)
        tw.fn(tw.easing(k))
        if (k >= 1) {
          const i = this.tweens.indexOf(tw)
          if (i > -1) this.tweens.splice(i, 1)
          if (tw.done) tw.done()
        }
      })
      this.dirty = true
    }
    if (this.inkDirty && this.inkMesh && this.inkMesh.visible) this.drawInkPreview()
    if (this.dirty) {
      this.dirty = false
      this.renderer.render(this.scene, this.camera)
    }
    this.canvas.requestAnimationFrame(this.tick)
  }

  pause() {
    this.running = false
  }

  resume() {
    if (this.running) return
    this.running = true
    this.dirty = true
    this.canvas.requestAnimationFrame(this.tick)
  }

  dispose() {
    this.disposed = true
    this.running = false
    this.tweens = []
    if (this.inkMesh) {
      this.inkTex.dispose()
      this.inkMesh.material.dispose()
    }
    try {
      this.renderer.dispose()
    } catch (e) {}
  }
}

function span(ts) {
  const dx = ts[0].x - ts[1].x, dy = ts[0].y - ts[1].y
  return Math.sqrt(dx * dx + dy * dy) || 1
}

function midpoint(ts) {
  return [(ts[0].x + ts[1].x) / 2, (ts[0].y + ts[1].y) / 2]
}

function angle(ts) {
  return Math.atan2(ts[1].y - ts[0].y, ts[1].x - ts[0].x)
}

module.exports = { Planner }
