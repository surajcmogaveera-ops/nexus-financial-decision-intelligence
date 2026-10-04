import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Client generation and schema validation do not need a live database.
    // Migration commands still require a real DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
