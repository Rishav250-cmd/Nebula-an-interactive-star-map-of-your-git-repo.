import app from "./app.js";
import { installProcessErrorHandlers } from "./services/errors.js";
import { config } from "./services/config.js";

installProcessErrorHandlers();

const port = config.PORT;

app.listen(port, () => {
  console.log(`Nebula backend listening on port ${port}`);
});
