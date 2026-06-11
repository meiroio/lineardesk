// Cloud Postgres (Neon, etc.) connection strings ship with `sslmode=require`,
// which pg-connection-string currently treats as `verify-full` but warns will
// adopt weaker libpq semantics (no cert verification) in pg v9. Pin
// `verify-full` explicitly to keep strict TLS verification and silence the
// deprecation warning. Local (Docker) connections are left untouched so they
// connect without TLS.
export function normalizeConnectionString(connectionString: string): string {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) {
    return connectionString
  }

  try {
    const url = new URL(connectionString)
    url.searchParams.set("sslmode", "verify-full")
    return url.toString()
  } catch {
    return connectionString
  }
}
