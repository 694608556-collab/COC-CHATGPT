# COC 跑团记录簿 · 安卓首阶段开发版

## 2026-10-13 后续开发：浏览器预览与基础编辑

新增独立浏览器开发入口及基础编辑，详见 [浏览器开发说明](BROWSER-DEVELOPMENT.md)。
本次验证了 TypeScript、网页构建、18 项单元/存储边界测试及 320/412 CSS px 的两项浏览器流程测试。
原生编辑接口已接入现有安全副本和 SQLite 事务流程，但本次没有 Android SDK 或设备，未编译/验收新的 APK。
下方「本地真机证据」属于此前首阶段，不是本次编辑能力的真机证据。

这是正式移植代码的首阶段工程，不再是独立技术探针，也不是已完成的正式发布版。桌面业务代码与依赖清单保持不动，安卓使用自己的 package.json、锁文件和原生工程。

## 当前可用

- 仅三个底部入口：跑团记录、角色卡、数据与设置。
- 首次启动必须由用户选择本机或存储卡的普通共享子文件夹；取消、读写失败或授权失效时不能进入业务页，不静默改存其他位置。
- JSON / ZIP 备份校验与预览；正文不作为可随意丢弃的缓存；资料与闲记不进入安卓业务数据。
- 显式确认覆盖，先在可见目录写入并回读安全副本，再进行 SQLite 事务提交；不勾选时保留当前显示设置。
- 模组与场次浏览，正文搜索、过滤及每页 100 条消息；图片只保留链接/标签，不下载。
- 已有角色卡浏览；支持新建六/七版角色及基础资料、属性、当前值、技能分配、物品、已有背景和经历编辑。不恢复角色卡 Excel/PDF 导出。
- 模组新建及名称、进度、KP 编辑；手动场次新建及正文编辑；已有场次名称、日期、序号、归属模组编辑，在线正文与来源保持不动。
- 单场次 TXT 与安卓手动备份保存，创建新文件并回读验证，不覆盖同名用户文件。

尚未接入：删除、完整参与者/角色关联管理、角色版次转换及武器编辑、联网获取、自动备份、其余导出格式、归档附件导入、分享/打开操作、系统返回键的完整页面导航、桌面安全恢复安卓备份及正式签名发布。界面明确显示阶段限制，不能当作已具备上述能力。

## 身份与数据隔离

正式 applicationId 是用户指定的 `coc.logbook`。debug 构建增加 `.debug` 后缀，实际安装为 `coc.logbook.debug`，名称带“（开发版）”，不会覆盖独立技术验证版 `coc.logbook.spike` 或正式产品。当前版本 0.1.0-dev、versionCode 2，最低 Android 9 / API 28。

APK 不携带用户备份、真实正文或按样本生成的字体。当前使用系统字体、原电脑图标和电脑配色；没有把授权待核查的桌面字体复制到 APK。

用户可见导出/备份通过 SAF 文档树授权操作，内部数据库位于应用私有目录。SQLite schema v1 使用单一业务快照的分块存储与版本序号：避免 Android 9 CursorWindow 无法读取大型单行文本，也避免分割 UTF-16 代理对造成文字损坏。尚未移植桌面逐实体 SQL schema；后续迁移需保持此 schema 的可升级性，不能清库替代迁移。

## 备份契约

旧电脑备份输入支持 schemaVersion 1 / 2 的当前已知业务结构。ZIP 校验 backup.json、路径、重复条目、清单文件大小与 SHA256；首阶段输入上限 64 MB、解压累计上限 128 MB、最多 2000 个条目。归档附件在本阶段只校验，不恢复；导入预览明确提醒。

安卓手动/安全备份采用独立信封：

```json
{
  "format": "coc.logbook.android",
  "formatVersion": 1,
  "exportedAt": "ISO 8601",
  "restoreScope": ["modules", "records", "characters"],
  "snapshot": {
    "schemaVersion": 2,
    "exportedAt": "ISO 8601",
    "modules": [],
    "records": [],
    "characters": [],
    "settings": { "theme": "light", "filterPreset": {} }
  }
}
```

外层故意不设置 schemaVersion，当前桌面恢复校验会拒绝，防止它套用现有整库覆盖规则清空专属资料、闲记或剥除正文。桌面双向安全恢复完成之前，不提供“已兼容电脑恢复”的承诺。归档 URI 不来自备份，不能恢复电脑路径或用文件内容替用户授权。

## 构建与检查

在 `mobile` 中执行：

```text
pnpm install
pnpm typecheck
pnpm test
pnpm android:build
```

代码格式和 lint 使用仓库已安装工具，在仓库根执行：

```text
pnpm exec eslint mobile/src
pnpm exec prettier --ignore-path mobile/.gitignore --check mobile/src mobile/scripts mobile/package.json mobile/tsconfig.json mobile/vitest.config.ts mobile/capacitor.config.json
```

安卓构建脚本读取 JAVA_HOME（JDK 21）及 ANDROID_HOME（或 ANDROID_SDK_ROOT），尊重已有 GRADLE_USER_HOME。缺少工具时给出明确提示，不再写死旧电脑的 F 盘路径。浏览器预览不需要这些安卓工具。

最终 debug APK：`mobile/android/app/build/outputs/apk/debug/app-debug.apk`。构建会生成 www 与 Android assets，不直接编辑这些输出。

分支内保留当前已验证安装包：[`releases/coc-logbook-0.1.0-dev.apk`](releases/coc-logbook-0.1.0-dev.apk)，版本与摘要见 [`releases/README.md`](releases/README.md)。这只是开发版产物，不代表正式发布。

`src/MobileApp` 按页面/私有组件的同名目录组织；`src/data` 是多个页面共用的备份和原生契约。导出和过滤只读引用现有桌面共享代码，没有新建伪造 HTTP 接口，也没有启用生产 Mock。

## 本地真机证据

详见 `../docs/android-port-phase1.md`。真实样本与证据在 `F:\AndroidTools\coc-mobile-evidence-20261013`，不入仓库、不对外分发。scripts 中设备检查工具只针对已由 ADB 转发的本应用 WebView，不能拿它绕过用户的目录或恢复确认。

实现依据：[Capacitor 原生桥接](https://capacitorjs.com/docs/android/custom-code)、[Android 系统文档与目录授权](https://developer.android.com/training/data-storage/shared/documents-files)。
