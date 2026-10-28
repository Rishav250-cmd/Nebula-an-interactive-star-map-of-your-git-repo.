import app from "./app.js";
import { installProcessErrorHandlers } from "./services/errors.js";
import { config } from "./services/config.js";
import {
  clearRepositoryDirectory,
  initializeStore,
  startStoreMaintenance,
} from "./services/store.js";

installProcessErrorHandlers();

await clearRepositoryDirectory();
await initializeStore();
startStoreMaintenance();

const port = config.PORT;

app.listen(port, () => {
  console.log(`Nebula backend listening on port ${port}`);
});
