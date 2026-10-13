// Usage: npm run trace            (latest trace)
//        npm run trace -- <traceId>

import { loadTrace, printTrace } from "./trace-printer";

printTrace(loadTrace(process.argv[2]));
