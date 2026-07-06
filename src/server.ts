import { config } from "./config.js";
import { SERVER_NAME } from "./constants.js";
import { createExpressApp } from "./server-factory.js";

const app = createExpressApp(config);

const httpServer = app.listen(config.port, config.host, () => {
  console.log(
    `${SERVER_NAME} listening on http://${config.host}:${config.port}${config.mcpEndpoint}`
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => {
      process.exit(0);
    });
  });
}
