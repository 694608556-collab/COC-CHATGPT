本包保留作历史；最新姓名下方候选修正见 [build35](../ios-1.0.4-35/README.md)。

# iOS 1.0.4 / build 34（未签名）

[下载 IPA](coc-logbook-1.0.4-34-ios-arm64-unsigned.ipa)，25,467,807 字节；SHA-256 `1e5d3f05192f3ad0037e10ebc99831e04986d00e20e8cdcd57fa54ec1eb42556`。

源码 `85a16a3`，[云端 39192872373](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39192872373)。包含 build32 的当前容器归档引用、正文手动翻页与搜索返回回顶、候选 absolute 原点与触摸保护，并在33之后校准 WebKit 已平移 BCR 的碰撞边界、保留顶部 safe-area。正式字体、按钮和数据契约不变，旧包不覆盖。

最终 [原生运行 39194220872](https://github.com/694608556-collab/COC-CHATGPT/actions/runs/39194220872) 全部成功：79 单元、38 核心、iPhone14 Pro/iOS27.0 独立模拟器三冷启动、截屏及3项系统 UI 测试通过。真实键盘下两候选完整可见，依次原生点选 Beta/Alpha、保存、终止重启并重新编辑确认姓名保留；另两项验证本机与系统目录选择后重启。运行提交 dffa704 相对本包源码 85a16a3 的应用源码及原生 App 无差异，仅测试/交付记录更新，本包未替换。完整97浏览器、类型/ESLint通过，旧回归先红后绿记录见 NEXT-SESSION。

本34包的 ZIP CRC、摘要、Info.plist 1.0.4/34、arm64 设备/iOS SDK27、无私人签名或数据库检查通过；独立目录复用 mobile 依赖及两级 tsconfig 复建，五份网页及八原字体逐字节一致。

未签名包不能直接安装。用户目标为全能签及自己的有效企业证书，保持原应用标识与数据，不卸载/清库；实际 iPhone14 Pro/iOS27.0 滑动、闪屏、归档/备份重开、取消失败重试仍待实体复测，爱思个人ID正常不作为结案。不上传个人签名，不合并或正式发布。
