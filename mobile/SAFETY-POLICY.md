# 已确认的分级安全副本契约（2026-10-14）

用户确认：设置和排序不生成完整副本；普通内容编辑十分钟保护窗口内最多一份；删除、清空、导入覆盖、更换正文来源或链接每次单独生成。已有文件不删除，CAS 版本检查、目录授权验证、事务与失败保护保留。

沿用 Capacitor Logbook.commitEdit / commitAction / commitRestore，不新增 HTTP 接口，不允许客户端传“跳过副本”标记。请求 JSON、expectedRevision、确认覆盖标记、附件等字段不变。原生端依据前后实体比较判定保护等级；浏览器独立开发存储实现相同行为，开发数据不进入 APK。

commitEdit 返回 `{ revision, safetyBackup?: SavedDocument }`：本次实际创建并回读的副本才返回 safetyBackup；设置及窗口内普通编辑没有该字段。commitAction 返回字段不变，只有排序可省副本；commitRestore 仍必须返回本次完整副本。界面不将“无本次副本”误写成“本次已生成”。

普通保护窗口以成功事务之后记录的时间及归档 URI 为准；首次普通编辑、窗口到期、时钟回退、目录变化都重新生成副本。副本创建或回读失败不能提交，陈旧版本不能写数据；窗口状态仅成功后更新。窗口粒度意味着不能依靠副本逐次回退窗口内编辑，但每次正常保存仍立即提交数据库。系统返回或确认取消不触发写入。

危险提交完成后旧普通窗口失效，下一次普通编辑为新的数据基线建立保护窗口；取消或失败不使旧窗口失效。这样导入的新数据不会错误沿用导入前的旧数据副本。

原生完整 JSON 请求完成严格 JsonReader 语法检查及 JSONObject 实体校验后，直接保留请求文本存储，避免重复序列化及数值精度变化；原生列表动作修改候选对象，仍须序列化后提交。设置判定采用结构比较而不是把全部正文数组序列化两次。所有判断只影响本次副本选择，不影响版本/授权/事务检查。

## 轻量设置提交契约

新增本工程 Capacitor `Logbook.commitSettings({ settings, expectedRevision })`，无 HTTP 请求。settings 是完整的 MobileSnapshot.settings：theme 为 light/dark，filterPreset 为既有八个布尔字段，autoBackup 可省略，否则 enabled 为布尔、interval 为 idle/daily/weekly、retention 固定 10。拒绝未知字段和类型错误；禁止通过此请求传递模组、场次、角色或目录。

原生从当前持久化快照读取并校验实体，只修改 settings 和 exportedAt 后序列化提交；未选择或授权失效、陈旧版本、校验或事务失败均不写入。设置不生成全量副本、不改变普通编辑保护窗口；返回 `{ revision, exportedAt }`，不携带正文或虚构副本。浏览器独立存储遵守相同语义，在 IndexedDB 写事务内再次检查版本及目录。前端收到成功响应后更新已确认设置、时间及版本，大 JSON 缓存置空；以后实际重开仍走完整读取校验。
