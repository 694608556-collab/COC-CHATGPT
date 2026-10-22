# 1.0.8 / build50 动态整库容量

文件：[coc-logbook-1.0.8-50-ios-arm64-unsigned.ipa](coc-logbook-1.0.8-50-ios-arm64-unsigned.ipa)

iOS设备arm64，最低iOS15，未签名且无描述文件；使用自己的有效签名、原应用标识覆盖安装。

- 大小：25,867,536字节。
- SHA-256：`50aa18e6633c05b486aa767aadc5907e739b0ae06c4bb738cb9306ccd36f11d8`。
- Git文件摘要：`a38a60087426212161952d9c8e5fc09d7d278d85`。
- 构建源码：`fe94d1dde4b84e81f5de31e5519f5756bef44737`。
- 完整CI：[运行39736956142](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39736956142)成功。

整库取消固定64MiB总量，按实际可用空间、临时空间和余量管理；单场完整记录仍最多64MiB。完整JSON/ZIP备份和恢复、自动备份及只读正文搜索分段处理，阅读后释放界面缓存，原库完整正文保留。

包内6份生产网页/Worker与对应源码本地重建一致，8份原字体一致，ZIP完整性通过；详见`package-verification.json`。类型、Android149/iOS143单元、Android127/iOS132完整浏览器及两端原生云端均通过；规模和结果见`acceptance.json`及[完整说明](../../CAPACITY-DEVICE-20261022.md)。公开样本不是产品容量上限，也不是所有手机的实测能力。

安装前核对同目录SHA-256，不卸载、不清空生产应用。新内部SQLite版本Android5/iOS2保留原数据升级；不能强行降级到不认识新库的旧包。此包尚无用户实体机安装或114场正式界面计时；不宣传联网提速。Android手势关闭和iOS全能签外部目录暂缓保持原决定。
