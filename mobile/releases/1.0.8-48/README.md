# Android 1.0.8 / build48：姓名触摸获焦顺序

应用源码 `8f01cf485da33555e3240967d22e0c8e9ad3c8c2`，云端[39546964634](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39546964634)成功。正式包：[APK](coc-logbook-1.0.8-48.apk)、[SHA256](coc-logbook-1.0.8-48.apk.sha256)、[包校验](package-verification.json)、[浏览器回归](browser-regressions.json)。

在build47候选重开与pageTop坐标修正基础上，收窄pointerdown补开条件，仅在姓名框已经获焦时提前展开；首次获焦及键盘关闭后的点击保留原生focus/click顺序。iOS共享组件另检查键盘可见，iOS专用的系统文本菜单间距及视口动画协调未套入Android。不强制focus/blur，不阻止原生插入点、选择或复制粘贴，不改姓名值，不放宽精确断言。

类型、101单元、112完整Edge通过，0跳过/失败/flaky。两项焦点顺序回归先在相同旧组件的iOS浏览器夹具失败，再通过；Android完整套件包含对应回归。Android实体机尚无iOS尾空格复现证据，不将共享网页验证表述为Android原生键盘实测。

包名coc.logbook，versionCode48/versionName1.0.8，32,285,004字节，SHA256 `dd2083fd2a730df1fbc07b5a4fed280294198d350f45565ea233007b4227edf0`。正式证书v3与旧版一致；min28/target36、非debug、16KiB原生库对齐和226个未压缩条目对齐通过。5网页资源、8原字体与独立源码重建逐字节一致，无开发样本、正文数据库、签名材料或源码映射。

未安装、卸载、清空或覆盖用户生产应用。本轮无Android原生业务代码修改，云端编译了独立.debug48及Instrumentation测试包，未冒充build48在S9执行原生10项。正式签名覆盖升级仍须先保护真实数据库、归档和授权，实体键盘/目录验收待办保留。原v4/PDF/SAF、64MiB、授权、CAS、事务/失败回滚、自动备份及所有旧包保留。
