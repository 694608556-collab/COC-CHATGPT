# Changelog

## 0.6.2 - 2026-09-22

- 修复删除末尾场次后新增场次编号凭空跳号的问题：新增场次的默认编号改为接续“现存场次的最大编号 + 1”。此前编号取自一个只增不减的历史最大值，删掉第 9-16 场后只剩第 8 场时，新增场次会直接跳到第 17 场。
- 编号选择窗口保持不变：现存编号中间存在空缺时仍会弹出，可填补空缺、接续最后编号或自定义编号；已有场次的名称与编号不会被重排或改名。
- 导入表格时链接状态一律重置为“待检测”，不再采信表格里的历史状态；覆盖更新已有场次时会同时清空已抓取的正文、抓取时间与错误信息，必须重新检测才能抓取正文。手动粘贴正文的场次保持“手动内容”不受影响。
- 导出的表格继续保留“状态”列以便查看，但导入时不再读取该列；跑团日期仍会原样带回。

## 0.6.1 - 2026-09-22

- 修复窗口仅能上下缩放、左右与四角缩放失效且拖动延迟的问题：关闭 Windows 隐形原生边框，恢复界面内八方向缩放热区，窗口保持直角、无阴影残块。
- 统一导入与导出表格格式：软件导出的表格可直接重新导入，状态、跑团日期、最近抓取时间三列会原样带回；重复海豹链接的场次按表格内容覆盖更新。
- 空白导入模板同时提供 xlsx 与 CSV 两种格式，默认含 1 位 KP 与 3 对 PC/PL（PC1/PL1、PC2/PL2、PC3/PL3）位置，表格下方附填写说明；旧版“参与者”一列的写法继续兼容。
- 批量下载、批量合成、导出表格完成后自动打开存储位置（单份合成/表格会在资源管理器中选中文件，批量下载与多份合成打开归档目录）。
- 批量合成的 TXT/DOCX/PDF 保留封面首页，取消每场强制分页，场次连排并在不同场次之间加入通栏分割线，场次标题保留。

## 0.6.0 - 2026-09-22

- 跑团记录汇总页场次超出可见范围时，右侧显示可正常拖动的竖向滚动条。
- 添加场次时，若现有场次编号不连续（例如删除过场次），会弹出与现有提示风格一致的编号选择窗口，可填补空缺编号、接续最后编号，也可自定义 1-9999 且未被占用的编号。
- 窗口四角改为 Windows 10 风格直角，保留窗口自由调整大小功能，并清理透明窗口遗留的矩形阴影与背景残块。

## 0.1.0 - 2026-09-11

- Portable Windows x64 test build.
- Local module, session record, SeaLog probing, filtering, export, character, table, backup and restore workflows.
- Six single-record exports: raw JSON, image DOC, dialogue DOC, DOCX, TXT and PDF.
- Offline DOCX/PDF generation without Microsoft Word or LibreOffice.
- JSON and ZIP backup/restore with registered-archive safety checks.
- Unsigned build; Windows SmartScreen may warn before launch.
