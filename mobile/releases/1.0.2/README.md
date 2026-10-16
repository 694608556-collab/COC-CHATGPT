# 1.0.2 / 27 模拟器测试安装包

按用户要求生成并上传，基于 `0341a3c81d87e73f8c48f6b0ca57aab2ac11d32b`；本目录只包含 APK、校验文件与说明，不复制签名材料。旧包保留，不创建 GitHub Release、不合并 PR、不自动安装。

- [下载已签名 APK](https://raw.githubusercontent.com/694608556-collab/COC-CHATGPT/codex/ui-optimization-experiment/mobile/releases/1.0.2/coc-logbook-1.0.2.apk)
- [SHA-256 校验文件](coc-logbook-1.0.2.apk.sha256)
- 大小：32,076,032 字节，约 30.6 MiB。
- APK SHA-256：`39132ed35693409172a6ab9928e633320e8e72c4b3a97ca2e06e1541ddc262af`。
- 包名 `coc.logbook`；versionName `1.0.2`、versionCode `27`，非调试 Release；最低 Android 9 / API 28，targetSdk 36。
- 沿用原正式签名，证书 SHA-256：`cc3020afe7446589b5dff92eb9fe69b7593af18f614445b1d8e5805e853143e7`。已与旧 1.0.0 APK 直接比对一致，可覆盖安装同签名的 1.0.0／1.0.1，无须卸载。独立开发版 `.debug` 是另一包名。

## 本次内容

包含 1.0.1 的六项模拟器反馈修正和设置／最近保存卡片间距调整；进一步将“新增模组”按钮到下方手势说明缩至 6px，并删除设置中的黄色备份格式说明。保留原字体、全部正文、按钮尺寸、普通卸载前备份提示、版本检查／事务失败保护、排序即时保存和默认十分钟有修改才自动备份；不恢复已删除功能或操作前副本。

## 验证及边界

- [Android 云端构建 #31](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/38873190201) 成功：冻结锁文件安装、类型、63 项移动单元、网页、资源同步、Debug／Release 编译与未签名 Release 的 16KB 页面对齐检查通过。
- 云端未签名产物 ZIP SHA-256：`2a5979a394cee40cdcd69b0ad8e72e498ef327798a5d8dc2ce04554018ed0244`，下载已匹配；在本机仓库外使用原签名材料签署，v3 签名校验通过。
- 直接读取最终 APK 清单，版本／包名／最低系统及 `debuggable=false` 均匹配；按云端仅 mobile 依赖环境独立复建，四份网页资源和八份原字体逐字节一致，无开发入口、源码映射、开发服务器、数据库、测试样本或签名材料进入 APK。
- 最新两项修正已通过 6 项相关浏览器流程，升版后另通过 1 项版本与设置页尾流程，以及本机类型／格式／资源构建。未将历史 81 项全部浏览器或 JVM 检查算作本轮完整重跑。
- 未安装模拟器或手机，启动过渡、实际 SAF 文件操作及 UI 效果仍须用户实测；构建／签名通过不代表模拟器、S9 或其他机型通过。
