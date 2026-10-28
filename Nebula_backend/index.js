import app from "./app.js";
import { installProcessErrorHandlers } from "./services/errors.js";
import { config } from "./services/config.js";
import { pruneAnalysisCache } from "./services/cache.js";
import {
  clearRepositoryDirectory,
  initializeStore,
  startStoreMaintenance,
} from "./services/store.js";

installProcessErrorHandlers();

if (!config.REPO_DIR_EXPLICIT) await clearRepositoryDirectory();
await initializeStore();
await pruneAnalysisCache();
startStoreMaintenance();

const port = config.PORT;

app.listen(port, () => {
  console.log(`Nebula backend listening on port ${port}`);
});
