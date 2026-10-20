import 'core-js/actual/object/from-entries'
// 后台表格同样会创建实体ID，需加载与主界面一致的系统随机源UUID兼容实现。
import './compat'
import { z } from 'zod'

// Packaged workers inherit the strict app CSP; never compile schemas with eval/new Function.
z.config({ jitless: true })
