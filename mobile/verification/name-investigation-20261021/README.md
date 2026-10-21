# 公开姓名候选取证与回归

本目录只含公开模拟器夹具和浏览器结果，不含私人正文、数据库、实体设备序列号或签名材料。当前原生最终验收仍在运行；下列失败和候选包校验均不代表修复已交付。

原build46：[运行39448999303](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39448999303) attempt1、artifact12277614100。[触摸/录屏摘要](build46-original-tap-evidence.json)保留原附件SHA256、触摸坐标、原精确值及Unicode码点；[67秒](build46-attempt1-67s.png)、[69.3秒](build46-attempt1-69.3s.png)、[70秒](build46-attempt1-70s.png)为原公开录屏提取帧。期望Beta候选的触摸(108,534.571)落入原生预测栏首项，随后原断言观察到`Public Beta `。原beforeinput/input尚未安装，不能补造这部分事件。

[浏览器修改前后记录](name-fix-browser-regressions.json)保留确定失败、各阶段通过及一次完整滑动失败；最终4bf1b26为118/118、0跳过/失败/flaky。浏览器模拟的坐标和遮挡只证明受控网页回归，不冒充原生或实体机证据。

[此前原生运行](superseded-native-runs.json)保留未完成验收的失败、真实DOM候选点击数量、实际姓名、按保存ID原生重启回读及运行链接。早期[viewport-only候选47校验](superseded-build47-viewport-only-package.json)和[native-menu候选47校验](build47-native-menu-candidate-package.json)均已废止，未作为交付包上传。

应用源码4bf1b26541466996acefe1b5bf6d401de0626cc4的取证验收为[39549311163](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39549311163)；同应用、三个常规用例无跟踪的独立验收为[39550718620](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39550718620)。两轮均保留原10秒精确值断言，压力包含六轮连续/重复选择、切换、职业/姓名焦点和键盘开关。最终结论见[调查文档](../../IOS-NAME-INVESTIGATION-20261021.md)最新章节；实体iPhone及签名后目录/第三方提供器验收仍须独立执行。
