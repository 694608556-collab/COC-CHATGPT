import 'core-js/actual/object/from-entries'
import { z } from 'zod'

// Packaged workers inherit the strict app CSP; never compile schemas with eval/new Function.
z.config({ jitless: true })
