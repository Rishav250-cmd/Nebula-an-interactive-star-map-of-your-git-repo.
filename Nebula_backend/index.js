import app from "./app.js";
import { installProcessErrorHandlers } from "./services/errors.js";

installProcessErrorHandlers();

const port = process.env.PORT || 5001;

app.listen(port, () => {
  console.log(`Nebula backend listening on port ${port}`);
});
