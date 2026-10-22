# APK55 / IPA53 完整导入导出计时

以下仅为公开虚构夹具，非用户私人114场库。S9为实际隔离测试应用；iOS为完整成功CI中的全新模拟器，不能当作iPhone实测。库78场、每场650条消息、约22.26MB；角色卡682849字节，表格114个链接另加1个手动行。时间不计人工停留，包含实际Worker、SQLite、文件复制和回读。

角色卡计至完整可编辑草稿，随后取消，不是点击保存的耗时。旧BIFF XLS角色卡是明确拒绝用例；delayed-stage取消故意注入1.5秒，不计作正常导入。各类预览与确认分开计时。

| 操作 | S9实机/秒 | iOS云端模拟器/秒 |
|---|---:|---:|
| module-search-0 | 3.272 | 7.019 |
| module-search-1 | 0.240 | 3.072 |
| module-search-2 | 0.287 | 1.920 |
| character-import-back-cancel-with-delayed-stage | 3.165 | 2.422 |
| character-import-xlsx-0 | 1.577 | 0.543 |
| character-import-xlsx-1 | 1.484 | 0.485 |
| character-import-xlsx-2 | 1.522 | 0.628 |
| character-import-xls-explicit-rejection-0 | 0.716 | 0.193 |
| character-import-xls-explicit-rejection-1 | 0.770 | 0.148 |
| character-import-xls-explicit-rejection-2 | 0.802 | 0.154 |
| record-table-import-preview-csv | 1.516 | 0.522 |
| record-table-import-commit-csv | 0.445 | 2.306 |
| record-table-import-preview-xlsx | 1.746 | 3.570 |
| record-table-import-commit-xlsx | 0.395 | 0.811 |
| record-table-import-preview-xls | 1.574 | 2.245 |
| record-table-import-commit-xls | 0.380 | 0.585 |
| record-table-export-csv | 0.488 | 0.198 |
| record-table-export-xlsx | 0.290 | 0.046 |
| blank-template-csv | 0.109 | 0.030 |
| blank-template-xlsx | 0.142 | 0.060 |
| backup-export-json | 5.167 | 12.295 |
| backup-export-zip-with-attachments | 22.032 | 17.475 |
| backup-import-preview-json | 22.755 | 14.447 |
| backup-import-commit-json | 9.378 | 20.002 |
| backup-import-preview-zip | 38.243 | 35.349 |
| backup-import-commit-zip | 9.265 | 12.111 |
| automatic-backup-json | 5.326 | 43.901 |
| reader-submitted-search | 0.342 | 0.104 |
| single-export-原始 JSON | 0.881 | 0.607 |
| single-export-TXT | 0.319 | 0.097 |
| single-export-带图 DOC | 0.432 | 0.096 |
| single-export-纯对话 DOC | 0.395 | 0.095 |
| single-export-DOCX | 0.702 | 0.168 |
| single-export-PDF | 1.586 | 21.875 |
| batch-export-原始 JSON | 1.035 | 0.216 |
| batch-export-TXT | 0.751 | 0.131 |
| batch-export-带图 DOC | 1.000 | 0.141 |
| batch-export-纯对话 DOC | 0.874 | 0.161 |
| batch-export-DOCX | 0.913 | 0.140 |
| batch-export-PDF | 2.683 | 43.472 |
| combined-export-原始 JSON | 1.038 | 0.214 |
| combined-export-TXT | 0.787 | 0.107 |
| combined-export-带图 DOC | 0.697 | 0.130 |
| combined-export-纯对话 DOC | 0.703 | 0.126 |
| combined-export-DOCX | 0.545 | 0.125 |
| combined-export-PDF | 2.239 | 54.604 |
