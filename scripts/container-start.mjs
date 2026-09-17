import { configureDatabase } from "./container-env.mjs";
configureDatabase();
// Import in this process so the production server receives container signals.
await import("../server.js");
