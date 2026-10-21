# Android 检测来源误判修复（2026-10-21）

用户反馈：当前 IPA 正常，APK 的批量链接检测及单场检测均报告“检测结果未暂存：检测来源已变化”。只修复 Android 原生检测暂存，不调整 iOS。

## 已确认根因

Android `JSONObject` 的表格写入会将链接中的斜杠序列化为 `\/`，网页 `JSON.stringify` 上传相同链接时使用 `/`。`FetchBatch.stage` 直接比较 `moduleId`、`sourceType`、`link` 的原始 JSON token，导致相同字符串被误判为来源变化。成功结果的 `cacheSourceUrl` 原来也存在相同问题。

在 S9 独立应用 `coc.logbook.fetchsource20261021.debug` 中，以生成的公开样本重现：

- `IndexedPressureTest#fetchStageAcceptsEquivalentJsonSlashEscapes`：修复前报同一句“检测来源已变化”。
- `IndexedPressureTest#fetchStageAfterNativeTableImportAcceptsUnchangedSource`：实际原生表格写入后再上传网页形式的结果，修复前同样失败；修复后覆盖完整表格/差量导入、单场/多场四种组合。

前后使用同一公开夹具和相同原生数据库路径，仅改变暂存字符串比较实现。原始测试日志留在仓库外；不读取正式应用数据库或私人链接。

## 修复与约束

只解码小型身份/状态字段，比较严格字符串值；拒绝缺失、null、数字、布尔、对象、数组。不进行 URL 归一化、百分号解码、去空白或忽略大小写。来源发生真实变化、缓存来源不匹配、手动正文混入仍被拒绝；失败暂存会截断未接纳片段，已暂存结果可继续完成整批重试。

正文保留原始流式 token，超出 JavaScript 安全整数的数字和中文/emoji 不重新序列化。保留完整目标覆盖、逐段摘要、授权、revision/CAS、单次事务、回滚、失败保留旧正文、自动备份及 64MiB 上限。

## 已完成验证

- S9 / Android 9，公开数据独立包：`IndexedPressureTest` 共 15 项通过（151.146 秒）。包括本次四个回归方法、15 种真实来源/类型变化拒绝与干净重试、失败正文保留、三轮千场检测、约 50MiB 旧库迁移、6000 场表格追加、关联校验、CAS/超限/SQL 失败回滚。
- Android 类型检查和 107 项单元测试通过；原生元数据 42 检查及网络队列、PDF、读取租约、归档、上传检查通过。
- 生产网页构建检查通过，保留八个原字体。
- 完整 Edge 浏览器回归 123 项通过（8.1 分钟）。修复源码提交 `00eeb3688ca91daee0a6b912712fdc7c26ab94f4`，版本提交 `ee9cdf585cdec87472e2c5439d91b10d76639177` 已上传 `codex/ui-optimization-experiment`；同源码云端运行 `39624785029` 完整成功。

首轮本机仪器测试构建使用仓库外初始化脚本替换为独立应用标识，并排除本机离线缓存的旧 Kotlin jdk7/jdk8 重复类；未修改仓库依赖或正式构建配置。后续从锁文件重新安装独立依赖后，标准 Gradle release/仪器测试编译均通过；去掉 Kotlin 排除项、只保留独立包名重新构建后，四项本次针对性原生回归再次通过（2.983 秒）。独立测试包已按本次所有权标记清理，正式应用未卸载、未清空、未启动。

## 本地修复包

`E:\COClogbook\local-delivery-latest-20261021\coc-logbook-1.0.8-49-fetchfix-ee9cdf5.apk`，32,313,676 字节，SHA-256 `14338ca3735d438de7f4baf1be53ec64eda8e5e076a5a4317349ce8c865ee55a`。由本机标准 Gradle release 构建，使用原发布证书签名；证书 SHA-256 `cc3020afe7446589b5dff92eb9fe69b7593af18f614445b1d8e5805e853143e7`。非调试、正式包名/1.0.8/build49、签名和 4 字节/原生库 16KiB 对齐通过，五个生产网页文件及八字体逐项匹配。签名文件、APK 和原始日志不上传 GitHub。

最新目录中先前 build48 APK 在新包核验后移入回收站；保留 iOS 原 IPA，其摘要再次核对一致。build49 尚未覆盖安装到用户手机，用户原数据/真实网络功能复测待完成。

尚需修复包覆盖升级后的用户原数据复测；独立原生测试不等于用户界面和实际网络验收。此前本机旧安装包的删除状态继续保留，不提交历史安装文件删除，也不恢复旧包。`refs/backups/home-handoff-20261019` 保留且不应用。
