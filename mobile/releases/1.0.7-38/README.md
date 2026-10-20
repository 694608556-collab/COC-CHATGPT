# Android 1.0.7 / versionCode38

APK沿用原发布证书，v3签名通过，证书SHA256为cc3020afe7446589b5dff92eb9fe69b7593af18f614445b1d8e5805e853143e7。versionCode38，包名coc.logbook，min28/target36，非debuggable。云端Actions成功。

本轮修复：批量检测选择列表末行不再与外框重叠；手动正文阅读及搜索跳过纯空白行，分页/命中使用同一索引。原始保存内容、编辑、导出和备份换行保留。Android顶部原返回按钮保留。

源码提交：9a49e6f6b120019e1154f490a55dcc69c6c8ce76。构建：https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39373325067

验证：iOS90/Android87单元、两端类型及生产构建、iOS分支109完整Edge回归、Android18独立专项通过。ZIP完整性、五份生产网页与隔离源码复建逐字节一致、八份原字体一致；Android226份存储条目的4字节/原生库16KB对齐通过。摘要见SHA256SUMS.txt，检查记录见package-verification.json。

文件：coc-logbook-1.0.7-38.apk，32129356字节，SHA256 d7a7c57bbadf3653d517f9e42ce5d20d8a40932182408631621e91e43444201f。

旧IPA40/APK37保留。实体机保留数据覆盖升级、批量检测、手动正文导出回导、角色卡补填及全能签企业签名外部系统目录仍须实体复测；模拟器通过不代表外部目录问题已解决。授权、CAS、备份周期及两平台原生正文/PDF传输差异不变，不恢复操作前副本。没有安装/卸载/清库，没有上传私人截图、表格、业务数据或签名凭据。
