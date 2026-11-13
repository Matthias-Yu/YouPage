# 有页 YouPage

每天，有一页。一个原生微信小程序手帐：桌面上放着一本 3D 的墨绿活页本和一卷胶带。
点封面翻开，横拖纸页翻月（贴纸跟着纸一起翻），在月历格子里直接写字，
从胶带卷上拉一段撕下来贴到纸上，点挂件会摇铃。

## 运行

用微信开发者工具打开本目录即可，无需 `npm install`。唯一的第三方代码是
`miniprogram/libs/threejs-miniprogram.js`（微信官方的 three.js r108 小程序适配版，MIT）。

## 目录

```
miniprogram/
  pages/home/              首页：WebGL 画布 + 画布外的按钮、贴纸条、写字输入栏
  scene/planner.js         3D 场景：本子、活页环、开合封面、翻页、镜头、手势、贴纸
  scene/draw.js            用 2D 画布画贴图：月历页、封皮、页背、标签、挂件、胶带
  scene/atlas.js           贴纸图集的索引（生成物）
  libs/threejs-miniprogram.js
  pages/day/               日页：某一天的完整一页（待办、随手记、2D 贴纸）
  pages/habits/            集章打卡
  pages/me/                统计、设置、备份恢复
  pages/member/            会员权益页（未接支付）
  components/deco-layer/   日页用的 2D 贴纸层
  utils/store.js           数据层（目前只存本机）
  utils/date.js            月历网格、农历、节日
  utils/catalog.js         贴纸包 / 心情 / 天气 / 胶带目录
  utils/member.js          会员开关与免费额度
  utils/sound.js           合成音效（铃铛、撕胶带、翻页、贴纸）
  utils/sync.js            云同步
  config.js                云开发环境 ID、同步云函数名
cloudfunctions/youpageSync 云同步的云函数
  assets/                  图标、贴纸 PNG、贴纸图集 atlas.png（生成物）
tools/
  art.json                 界面图标的 SVG 源
  gen-assets.ps1           从 art.json 生成界面图标
  gen-sticker-atlas.py     打包 3D 用的贴纸和月份插画
  check.js                 逻辑自测
  auto.ps1                 开发者工具自动化（点击、截图）
design/logo-640.png        图标原图
```

## 3D 场景要点

- 单位是厘米，纸页是 A6（10.5 × 14.8）。本子平放在 XY 平面，+Z 朝镜头。
- 界面都放在画布**外面**（顶部一条、底部面板）。WebGL 画布在开发者工具里会盖住普通组件，
  所以不要把按钮、输入框叠在画布上。
- 在格子里写字：镜头推到那一格，底部出现输入栏，输入的字实时画进月历页贴图。
- 月历页贴图是 1024 × 2048，镜头推得很近时字会发糊，这是贴图分辨率决定的。
- 贴纸是纸页上方的独立小面片，共用一张图集贴图（`assets/atlas.png`）。
- 翻页分三步：`beginFlip` 拿起一页（准备好两个月的贴图和贴纸）、`setFlipK` 翻到某个进度
  （手指拖动或动画驱动）、`endFlip` 翻过去或落回原处。翻起来那页上的贴纸按纸的弯曲逐帧摆位。
- 胶带卷在本子右下方的桌上：拉出的长度到 `TAPE_LEN` 就撕断，变成捏在手里的一段，松手贴下。
  点一下胶带卷换花色；花色贴图都能横向无缝平铺（`draw.tapeTile`）。
- 音效（`utils/sound.js`）用 WebAudio 在手机上现场合成，没有音频文件；「我的」里可以关掉。

## 改贴纸

贴纸和月份插画来自 [动物也上班的电子手帐本](https://github.com/xianxie6/animals-planner-2027)。
小程序的贴纸放在 `miniprogram/assets/stickers`，月份插画的源图放在 `tools/month-art`。
更新图片后用已安装 Pillow 的 Python 重建图集。

```sh
python3 tools/gen-sticker-atlas.py
```

新贴纸还要在 `miniprogram/utils/catalog.js` 的 `PACKS` 里登记才会出现在贴纸条里。
旧记录的贴纸 ID 在显示时映射到对应新图。

## 自测

这台机器没有装 Node，用开发者工具自带的运行时跑逻辑自测（农历、数据层、WXML 引用检查）：

```
$env:ELECTRON_RUN_AS_NODE='1'; & "C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe" tools\check.js (Resolve-Path miniprogram).Path
```

`tools/auto.ps1` 是一个极简的自动化客户端：开发者工具打开「安全设置 → 服务端口」后，
先 `cli auto --project <本目录> --auto-port 9420`，再用它按步骤点击、截图。
画布上的手势没法用它直接模拟，可以在步骤里调用页面的 `onTouchStart / onTouchMove / onTouchEnd`。

## 云同步

手帐数据（日页、月历贴纸和笔迹、习惯、打卡）同步到云开发，换手机、删了小程序都能找回来。
设备自己的设置（音效、封面、周起始日、胶带花色）不同步。

- 云函数 `cloudfunctions/youpageSync`：每个用户的每一份数据存成集合 `youpage_kv` 里的一条，
  用户身份取自调用上下文的 openid。集合第一次用到时自动创建。
- 客户端 `miniprogram/utils/sync.js`：启动 / 回到前台时先拉后推，本地改动后 2.5 秒推一次，切后台时立刻推。
  以 key 为单位、谁的修改时间新听谁的；只有「一个月的日页」按天合并，两台设备改同月不同天都保留。
- 照片在推送前上传到云存储 `youpage/photos/`，日页里的地址换成云文件 ID。
- 「我的」里可以关掉这台设备的同步，并显示上次同步时间或失败原因。

当前环境是 `cloud1-d1g2id4e4d7d2e2b4`（写在 `miniprogram/config.js`）。上线月历绘画前需要重新部署 `youpageSync`，让云端接收笔迹记录。
改了云函数后重新部署：右键 `cloudfunctions/youpageSync` →「上传并部署：云端安装依赖」，或者：

```
cli cloud functions deploy --env cloud1-d1g2id4e4d7d2e2b4 --names youpageSync --remote-npm-install --project <本目录>
```

注意：开发者工具模拟器里的云调用用的是开发者自己的微信身份，和你手机上是同一个账号。
在模拟器里写的内容会同步进你手机上的手帐。测试请用很远的月份（比如 2099 年），用完删掉。

同步逻辑的双设备测试（真实云函数代码跑在内存数据库上）：

```
$env:ELECTRON_RUN_AS_NODE='1'; & "C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe" tools\sync-test.js
```

## 隐私与上线合规

- 隐私政策、用户协议的正文在 `miniprogram/utils/legal.js`，小程序里的 `pages/legal` 和导出的 txt 共用这一份。
  改了内容要把 `VERSION` 改成当天日期，老用户下次打开会重新看到同意卡片。
- 运营者名称和联系邮箱填在 `miniprogram/config.js` 的 `OPERATOR`、`CONTACT_EMAIL`；没填时页面上显示「待填写」，`tools/check.js` 会给出提醒。
- 第一次打开时，首页底部是同意卡片。「同意并开始」同时是微信的隐私授权按钮（`open-type="agreePrivacyAuthorization"`）。
  不同意也能用，只是不开云端同步（`utils/consent.js`）。
- 「我的」里有隐私政策、用户协议、删除云端数据（云函数 `wipe` 删记录，照片文件由客户端用用户自己的权限删除）。
- 导出 txt（用于公众平台「用户隐私保护指引 → 补充文档」）：
  ```
  $env:ELECTRON_RUN_AS_NODE='1'; & "C:\Program Files (x86)\Tencent\微信web开发者工具\微信开发者工具.exe" tools\export-legal.js
  ```
  会生成 `docs/有页隐私政策.txt`、`docs/有页用户协议.txt`。

用到的隐私接口（都要在公众平台「用户隐私保护指引」里声明）：

| 后台声明项 | 接口 | 用途 |
| --- | --- | --- |
| 收集你选中的照片或视频信息 | `wx.chooseMedia` | 在日页上贴照片 |
| 收集你选中的文件 | `wx.chooseMessageFile` | 从聊天里的备份文件恢复 |
| 读取你的剪切板 | `wx.setClipboardData` / `wx.getClipboardData` | 备份到剪切板、从剪切板恢复 |

## 会员

`miniprogram/utils/member.js` 里 `BETA_FREE = true` 表示内测期全部权益限免。
正式收费需要：接入支付与服务端会员状态，把 `BETA_FREE` 改为 `false`，并实现 `status()`。

## 包体

内置贴纸、图集、图标和 Logo 优先从微信云存储读取，加载失败时使用包内副本。
更新素材时，把 `miniprogram/assets/` 下的文件按相同相对路径上传到新的版本目录，再更新 `miniprogram/config.js` 的 `ASSET_CLOUD_ROOT`。贴纸图集与坐标表应使用同一版本。
主包上限 2 MB，包含用于离线显示的图片副本。
