import { modelCheckCriticalProtocols } from "../packages/competition-engine/src/index.js";

const report = modelCheckCriticalProtocols();
console.log(JSON.stringify(report, null, 2));
if (report.status !== "VERIFIED") process.exitCode = 1;
