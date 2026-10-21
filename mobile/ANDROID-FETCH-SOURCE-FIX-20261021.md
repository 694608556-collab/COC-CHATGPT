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

本机仪器测试构建使用仓库外初始化脚本替换为独立应用标识，并排除本机离线缓存的旧 Kotlin jdk7/jdk8 重复类；不修改仓库依赖或正式构建配置。正式构建需另行核验。

尚需修复包覆盖升级后的用户原数据复测；独立原生测试不等于用户界面和实际网络验收。此前本机旧安装包的删除状态继续保留，不提交历史安装文件删除，也不恢复旧包。`refs/backups/home-handoff-20261019` 保留且不应用。
