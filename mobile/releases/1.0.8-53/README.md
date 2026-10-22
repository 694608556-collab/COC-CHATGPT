# Android 1.0.8 / build53 容量修复包

- 文件：`coc-logbook-1.0.8-53-capacity-7389023.apk`，32,829,937 字节。
- SHA-256：`b1d9e1aa3db07f1fa156093021581c0aed6110004483b1c2a416dd447b321ffa`。
- 构建源码：`7389023ec5d5ec9858f0692ce853371b877f6631`。
- 完整云端：[39760537670](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39760537670)，mobile 与 native-capacity 全部成功。
- 包名 `coc.logbook`，非调试版，沿用原发布证书；v3签名和4字节/16KiB原生页对齐通过。证书SHA-256：`cc3020afe7446589b5dff92eb9fe69b7593af18f614445b1d8e5805e853143e7`。
- 包内7份网页/Worker与对应源码隔离重建逐字节一致，8份原字体一致；签名前后所有ZIP成员内容一致。ZIP CRC、无私钥/数据库/源码映射/样本夹具检查通过。

整库、单场完整正文、Excel/CSV及附件的固定内容配额已移除，单场64MiB限制不得恢复。实际能力取决于可用运行内存、存储和临时空间；传输分段、格式/全文/关联校验、即时授权、CAS、事务回滚及自动备份保留。没有设置新的固定总量。

当前源码云端177单元通过；29项实际Android模拟器原生测试通过，含96/192/512MiB完整大库、68MiB单场SQLite快照往返和低空间/SQL回滚、96MiB原生WebView/Worker正文搜索、65MiB表格及50001实体。68MiB完整恢复候选的语义校验另在1GiB堆宿主JVM通过，不能把这一项写成模拟器全链语义恢复通过。共享Node脚本通过512MiB正文XLSX及70MiB单场CSV/JSON/ZIP64/编辑上传；这些不是手机指标。完整浏览器131项是公司交接记录，本次家中未重复跑。

本包未安装到用户手机，没有新增S9正式界面计时或覆盖升级验收。不卸载或清空生产应用；升级前核对完整摘要，保留应用数据及完整外部备份。内部Android SQLite v5，不能强行用旧适配器降级打开。Android手势优化关闭、iOS外部目录问题暂缓的决定保持。

同目录`package-verification.json`和`acceptance.json`仅含公开核验摘要，无私人数据、原始日志或签名材料。iOS51对应任务39760569182在本Android交付记录生成时仍在界面/WKWebView验收，不据此宣称iOS完整CI通过。
