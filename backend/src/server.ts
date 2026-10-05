import "dotenv/config";
import { assertFrontendOriginConfiguration, createApp } from "./app.js";
import { assertAuthenticationConfiguration } from "./auth/service.js";

const port = Number(process.env.PORT ?? 3000);
assertAuthenticationConfiguration();
assertFrontendOriginConfiguration();
createApp().listen(port, () => {
  console.log(`NEXUS backend listening on port ${port}`);
});
