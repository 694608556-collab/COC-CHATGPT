# iPhone 1.0.4 / build 30：夜间顶部与搜索聚焦修正

[下载待签名 IPA](coc-logbook-1.0.4-30-ios-arm64-unsigned.ipa) · [SHA-256](coc-logbook-1.0.4-30-ios-arm64-unsigned.ipa.sha256)

源码 `2fd2e789bfee4642064e5055b9da5f3b14886720`；[云端构建 39139704865](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39139704865)。显示版本 1.0.4、iOS build 30，安卓仍为 1.0.4 / 29；包名 `coc.logbook`，arm64 Release，25,461,513 字节。SHA-256：`812a435ac331e40cd56e13d6f5ecd5c1dff9fe0afbcb6d4d3449bbe2872f4b06`。

iOS 26+ 隐藏与网页不透明安全区顶栏重复的原生滚动边缘材料，iOS 控件 color-scheme 跟随应用明暗主题；仅 iOS 增加 maximum-scale=1，防止原字号输入控件聚焦时整页放大，页面手势放大范围也受此限制，应用内正文尺寸设置保留。原字体、按钮尺寸、完整正文、数据版本检查、目录书签、事务与自动备份规则不变。

本地 78 单元、类型/格式/ESLint、完整 94 浏览器回归、生产资源与八份原字体检查通过。IPA 已独立复核 ZIP CRC、SHA-256、arm64、版本与网页/Worker/字体逐字节匹配，无个人证书或私有数据。最新云端最终成功：78 单元、24 macOS Swift 核心及设备 Release 通过；iPhone 14 Pro / iOS 27.0 三次冷启动均 complete，深色 color-scheme、原生边缘隐藏、视口策略、原生概览、双 Worker、WebCrypto 与字体全部通过。已查看原生截图，顶部为均匀深色，没有先前浅色渐变；诊断直接改变 DOM 主题，截图中的系统状态栏图标没有经过真实设置切换，不将其作为系统图标颜色验收。

这是未签名包，须在用户本机重新签名；旧签名包不会自动获得修正。先在现有应用导出完整备份，再沿用同一签名账号及签名后应用标识尝试保留数据覆盖安装，不卸载或清库；新旧包与个人签名材料分开保留，个人签名包/描述文件不上传仓库。build 29 由用户确认安装、打开和设置目录通过；build 30 实体 iPhone 键盘聚焦/收起/切页、夜间顶端及旋转仍待复测，不能以配置断言或浏览器通过替代。

旧 [build 29](../ios-1.0.4/README.md) 保留。未正式发布、未合并 PR。
