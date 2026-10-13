// Uso: npm run trace            (último trace)
//      npm run trace -- <traceId>

import { loadTrace, printTrace } from "./trace-printer";

printTrace(loadTrace(process.argv[2]));
