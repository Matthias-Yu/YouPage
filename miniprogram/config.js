module.exports = {
  // 云开发环境 ID（微信开发者工具 → 云开发 → 设置 里能看到，形如 cloud1-xxxx）。
  // 留空时使用这个小程序的默认环境（最早创建的那个）。换环境时，云函数 youpageSync 也要部署到新环境。
  CLOUD_ENV: 'cloud1-d1g2id4e4d7d2e2b4',
  // 内置素材的版本目录，发布新素材时与云存储文件一起更新。
  ASSET_CLOUD_ROOT: 'cloud://cloud1-d1g2id4e4d7d2e2b4.636c-cloud1-d1g2id4e4d7d2e2b4-1531148926/youpage/assets/22e047f/',
  // 工具图标和品牌 Logo 各自使用独立版本。
  ICON_ASSET_VERSION: 'mono-ca95a8839a',
  LOGO_ASSET_VERSION: 'pearl-e836df6d42',
  // 同步用的云函数，代码在 cloudfunctions/youpageSync
  SYNC_FUNCTION: 'youpageSync',
  // 照片上传到云存储的目录
  PHOTO_DIR: 'youpage/photos/',

  // 隐私政策、用户协议里的运营者和联系方式。提交审核前必须填好：
  // 运营者写小程序主体名称（个人主体写姓名，企业写公司全称），邮箱用来接收用户的查阅、删除等请求。
  OPERATOR: '',
  CONTACT_EMAIL: ''
}
