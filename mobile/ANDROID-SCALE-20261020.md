# Android 1.0.8 / versionCode40：批量检测与大库压力

应用源码：`9d412cf0b3a8de08c0298d3425a8f0650c133145`。构建：[39394055569](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39394055569)。安装包与公开结果见 [releases/1.0.8-40](releases/1.0.8-40/README.md)。

## 定位与实现

旧版单模组检测前仍读取全库已保存正文。隔离副本捕获 Java `OutOfMemoryError`：普通堆上限192 MiB，`JsonFields.join → RecordOverlay.view → selectedContent → createExportSource` 尝试一次分配约66 MiB。设备配置的4 GB总内存不等于单应用Java堆配额。本次没有开启largeHeap，也不要求用户换大内存设备。

SQLite内部升级到v4，将元数据和逐场rawContent/manualContent分开，正文保持原始JSON词元并按65536 UTF-16单元分块，不切开代理对。v1/v2/v3迁移在SQLite升级事务内，失败回滚，保留revision；已对公开大库v3及两个实际旧库做升级验证。外部业务快照仍为schemaVersion 2。旧APK不能直接读取内部v4，不做降级、reset或清库。

所有Android获取入口——批量弹窗、模组内多选、正文页刷新——都使用三路有限并发、逐场后台校验与私有磁盘暂存，界面只积累元数据，不预读全库旧正文。暂存绑定目标ID、来源、目录授权和起始revision，逐份核对长度/SHA256/UTF-8/结构，完成全部目标并复核摘要后，先删除本次私有候选，再在单个CAS事务内更新目标。失败场次保留旧正文，未选场次不重写正文；保存成功前不显示“检测完毕”。失败可重试，进程中断不发布部分批次。

自动备份改为从相同精确版本流式封装，沿用原周期、修改判断、十份轮换、新URI、回读和登记保护，不恢复“操作前副本”。授权与归档范围不变；Android与iOS原生接口/PDF传输分别保留。

## 已执行验证与边界

- 90项移动单元、类型检查、生产构建通过；原有元数据、网络队列、PDF、归档发布、只读租约和分段上传检查通过。
- 15项独立Edge回归通过，覆盖批量统计/失败重试、手动正文与模板、七版角色卡补填、返回定位。
- MuMu Android12/15独立debug包各7项原生仪器测试通过：50模组/1000场约50 MiB v3迁移、未选正文零改写、失败旧正文保留、千场三轮提交、重开、CAS冲突、未完成批次、错误UTF-8、Unicode分块及超64 MiB回滚。随机测试库与生产数据隔离。
- 两版实际WebView以50模组、1000在线场次和50手动场次、约50 MiB公开虚构库执行三轮完整流程；网络响应仅本机生成，读取/解析/暂存/SQLite提交均走应用真实实现。每版3000在线结果、三次提交，手动不联网，无全库正文读取；采样JS堆结果见公开JSON。这不是手机硬件性能承诺。
- 两版重启后最后模组单独检测通过；最终全入口版本的模组内多选及正文刷新也通过，正文刷新只读取当前一场。
- 原证书生产APK在原实例的隔离副本覆盖升级；完整逻辑快照与升级前逐项一致，revision不因迁移增加。用户反馈样本的最后模组和整批真实网络检测均保存完成，手动内容、其他业务字段、应用偏好和原归档登记保留。私人表格、正文、链接、设备日志/XML和截图均未上传。

**容量仍为完整快照64 MiB**，不按模组数量静默截断。日志保留显示正文和原始消息，原始响应字数不能直接当最终保存字节数。两版公开超限输入均明确拒绝整批、revision不变、不显示完成，随后同一面板重试合规大小结果可成功。没有声称无限正文或任意规模均通过。

Android实体机覆盖升级仍待用户验证。iOS1.0.7/build41已由用户确认实机通过；iOS尚未完成本轮同等大库压力验收，不能套用Android192 MiB堆或宣称其绝无内存风险。静态检查发现其批量仍可能全量读取/序列化，应沿iOS独立存储接口另行优化。模拟器不能证明企业签名外部目录兼容性已解决。

首次CI同源码有一项既有浏览器存储测试5秒超时，独立12项重跑及相同源码CI第二次通过，未跳过断言。MuMu15的uiautomator曾在自身Shutdown线程SIGSEGV，应用进程保持；只在取得新XML及保存完成证明后确认结果，工具失败记录保留本机。

## 公开压力复现

原生测试通过独立`coc.logbook.debug40`包的`androidTest`执行。`IndexedPressureTest`只用随机命名测试库；不打开生产数据库，不清库。

```sh
adb -s DEVICE shell am instrument -w -r coc.logbook.debug40.test/androidx.test.runner.AndroidJUnitRunner
python scripts/public-scale-fixture.py /ABSOLUTE/NEW/public-scale.sqlite
```

生成器拒绝覆盖已有文件，输出完全虚构的v3库。界面测试只可把它配置到全新、独立debug包的空测试环境；不得替换已有私人数据库。确认独立测试包自己的公开测试目录授权后，将其WebView调试通道转发到本机PORT，使用Node24运行：

```sh
node scripts/check-android-scale-ui.cjs PORT /ABSOLUTE/NEW/result.json all 3
```

脚本先核对50个公开模组及1050条公开ID，其他库一律拒绝；只替换网络响应，真实暂存和CAS保留。`last 1`可复测最后模组。结果文件也拒绝覆盖。旧包和本机保护材料保留，未卸载原用户应用、弹出stash或触碰家庭电脑本地保护引用。
