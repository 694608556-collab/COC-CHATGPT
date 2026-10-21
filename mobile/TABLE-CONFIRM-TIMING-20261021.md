# 表格确认分段计时（无实体设备阶段）

本次先为原有完整元数据 commitTable 路径增加可选测量，不接入差量写库，不据此宣称 S9 的 3.769 秒或 6.973 秒已经降低。已交付安装包仍为1.0.8/build48，旧包保留。本机原有455个修改文件重新核对SHA256一致；只修改隔离工作副本。

## 测量边界

- 默认关闭。prepare任务和commitTable各自接受可选measure:true。只附加clock、totalMs、phasesMs；不记录输入值、正文、目录URI、设备标识或签名材料，不写诊断文件或上传。
- 界面仅在调用方明确提供onTableTiming时测量；生产入口不提供该回调。浏览器开发入口可用?table-timing启用，最近一份结果在window.__publicTableTimings；开发入口不进入APK/IPA。诊断回调抛错也不能把已提交保存变成失败提示。
- WebView总时间从开始投递确认校验到收到原生成功回复，排除用户覆盖确认等待；另测Worker往返和桥接往返。Worker内部独立测JSON编码、UTF-8编码、完整解码/解析/结构及关联校验、最终JSON编码。
- 原生仅在自身单调时钟上记录排队/资源、授权、大小核对、解析、事务开始与CAS、旧元数据读取、表格约束、记录比较及写入、容量检查、事务提交。Android额外分流式校验、旧记录索引、revision写入；iOS额外分合并后的完整校验。recordCompareAndWrite包含比较、编码及SQL，不能当作纯SQLite写入时间。
- 同一个phasesMs里的阶段是连续、不重叠的切片。不同进程不能直接相减时间戳；往返减内部总耗时只代表消息、调度、复制等未分配部分，不能全部归为传输。

64MiB、原目录及即时授权、预览revision、事务内CAS、完整关联校验、原始正文保留、自动备份周期和失败回滚均按原路径执行；measure不具备免校验权力。旧适配器不返回timing时保留原保存行为，不猜测原生耗时。

## 公开验证

单元对比开启/关闭测量后的完整快照与JSON完全相同，并检查非法结构/关联在两种模式均拒绝。原生核心在开启测量时验证旧正文逐字节保留、陈旧revision拒绝、注入SQL失败回滚；Android还把原容量拒绝用例置于测量模式。Android仪器用例需设备执行，不以编译代替执行。

完整浏览器的6000场用例启用真实Worker计时，仍覆盖预览分批展开、取消、完整保存、重启和最后一场；附加public-table-confirm-browser-timing.json，明确属于主机Edge/IndexedDB，不是手机或原生数据库。

iOS云端原有3020次公开批量处理及4次CAS保持原断言；完成后在同一隔离模拟器追加300模组/6000场，再在7050场中明确更新一场手动正文，分别记录真实打包Worker和原生桥接/事务时间，断言一次revision、全部实体数量、旧元数据及手动空行/Unicode回读。两项计时位于ios-scale-result.json的tableTiming。counts仍仅指前四轮批量处理，额外一场手动证明读取发生在计时结束后，单独标明profileManualReadbacks。

这组模拟器数据是3020次生成结果处理之后的库，正文体积与历史S9约50MiB场景不同；不可跨环境直接比较速度。WK公开脚本只由DEBUG+simulator启动入口注入，不进入Release。它不跳过原7项系统UI、3次冷启动或原3020批量检查。

本轮先有105项iOS单元和103项Android单元、两端类型通过；新增6000场专项通过。首次本地主机未指定Edge，默认Chromium不存在导致浏览器未能启动；保留该启动失败，随后显式用已安装Edge通过，没有改业务断言。完整浏览器和云端原生结果待本轮运行后补充。当前仍无实体设备，实体iPhone/企业签名/第三方提供器、正式APK生产覆盖升级待验。

下一步以阶段证据决定差量及原生循环优化；完整变化实体契约仍见[TABLE-DELTA-ASSESSMENT-20261021.md](https://github.com/694608556-collab/COC-CHATGPT/blob/codex/ios-ipa-adaptation/mobile/TABLE-DELTA-ASSESSMENT-20261021.md)。不能将本次计时接入写成差量协议已经实现或实机提速已经确认。
