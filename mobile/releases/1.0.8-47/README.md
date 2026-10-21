# Android 1.0.8 / build47：姓名候选共享界面修正

应用源码 `18fe5b470d6a822c6f8c36e85b698ef550a28a18`，云端[39542584559](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39542584559)成功。正式包：[APK](coc-logbook-1.0.8-47.apk)、[SHA256](coc-logbook-1.0.8-47.apk.sha256)、[包校验](package-verification.json)、[修改前后浏览器回归](browser-regressions.json)。

修正已聚焦姓名框只收到pointerdown时不能重开候选；可见区域按pageTop/pageLeft换算，避免键盘平移重复叠加。两项受控网页回归修改前均失败，修改后类型、101单元和110完整Edge通过，0跳过/失败/flaky。仅移植两个共享界面组件；Android实体机尚未复现iOS原生尾空格，iOS专有的系统文本菜单避让不套入Android。

包名coc.logbook，versionCode47/versionName1.0.8，32,285,004字节，SHA256 `dacbe701373d824811ce0f4d844d39e01009bf6521cba0b609f37c51e3a462ce`。正式证书v3与旧版一致；min28/target36、非debug、16KiB原生库对齐和226个未压缩条目对齐通过。5网页资源、8原字体与独立源码重建逐字节一致，无开发样本、正文数据库、签名材料或源码映射。

未安装、卸载、清空或覆盖用户生产应用。本轮无Android原生业务代码修改，云端编译了独立.debug47及Instrumentation测试包，未冒充build47在S9执行原生10项。正式签名覆盖升级仍须先保护真实数据库、归档和授权，实体键盘/目录验收待办保留。原v4/PDF/SAF、64MiB、授权、CAS、事务/失败回滚、自动备份及旧安装包不变。
