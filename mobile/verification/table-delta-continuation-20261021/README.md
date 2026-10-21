# 2026-10-21 家中差量接续：主机编码等价

从 iOS `e7e9f44` 接续。原 production 测量在完整对象的严格比较处失败：正文恢复函数会保留值为 `undefined` 的可选字段外壳，而完整校验器不保留这些自有键。原始失败已在本机复现；应用与业务断言没有修改。

修正后的测量先让真实 `createTableDelta` 的结果经过 JSON 序列化和解析，再用真实 `applyTableDelta` 重建。必须先证明**完整重建 JSON 与原完整校验编码逐字相同**，再通过真实 `performSnapshotJob({type:'prepare'})` 复验，并对完整快照、完整 JSON 和 UTF-8 字节分别进行严格比较。没有使用宽松比较器、字段筛选或仅比较变化行。

| 场景 | 完整候选 UTF-8 字节 | 生产差量 UTF-8 字节 | 变化数量 | 全部等价断言 |
| --- | ---: | ---: | --- | --- |
| 单手动更新 | 2,424,345 | 679 | 手动更新 1 | 通过 |
| 手动及参与者更新 | 2,424,406 | 936 | 手动更新 1、模组参与者 1 | 通过 |
| 新增角色 | 2,429,188 | 5,257 | 角色 1 | 通过 |
| 追加 6000 场 | 2,575,752 | 2,221,869 | 模组 300、场次 6000 | 通过 |

这些差量字节包含实际协议的 `initialSettings`，不能用此前草案的 449 字节替代。记录不包含真实原生桥接封装、目录授权、SQLite、设备 I/O 或旧正文，也不提供新的设备提速结论。

在 `mobile` 目录复现：

```powershell
node scripts/profile-table-confirm.mjs single production
node scripts/profile-table-confirm.mjs participants production
node scripts/profile-table-confirm.mjs characters production
node scripts/profile-table-confirm.mjs append production
```

四份 `production-*.json` 均为公开生成夹具的完整脚本结果。iOS原生测试变量重名另在ca05adb修正。

## 最终iOS完整原生验证

[云端39586805588](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39586805588)完整成功：86原生核心、设备Release、3冷启动、7系统UI，原精确断言与等待预算不变。UI为core 3项/304.945秒、names 3项/381.523秒、stress 1项/408.597秒，均0失败；逐项名称和耗时在ios-native-summary.json。原生公开规模部分36.687秒；WKWebView 3020次公开结果、4次批量CAS、0旧正文整库读取通过，178次503为夹具故意注入。

ios-scale-result.json保留完整公开报告。追加6000场诊断1026ms（原生729.350ms），单手动1068ms（原生939.094ms），另有2次表格CAS及1次明确手动正文回读。脚本使用完整Worker prepare与诊断差量抽取，已标记不代表生产预览租约全路径，不是实体iPhone或CSV/UI总耗时。

本地类型、109单元和118完整Edge通过。UI证据12342242583、启动/规模证据12342697290。旧安装包仍为1.0.8/build48，未替换或发布；CI未签名候选IPA不是新交付。跨平台说明见[本轮验收报告](../../TABLE-DELTA-VALIDATION-20261021.md)，实现顺序见[容量方案](../../CAPACITY-EXPANSION-PLAN-20261021.md)。
