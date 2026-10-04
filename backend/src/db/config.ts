export class DatabaseConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL must be set to a valid PostgreSQL connection URL.");
    this.name = "DatabaseConfigurationError";
  }
}

export function getDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) throw new DatabaseConfigurationError();

  try {
    const parsed = new URL(value);
    const isPostgres = parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
    if (!isPostgres || !parsed.hostname || parsed.pathname.length <= 1) {
      throw new DatabaseConfigurationError();
    }
  } catch {
    throw new DatabaseConfigurationError();
  }

  return value;
}
