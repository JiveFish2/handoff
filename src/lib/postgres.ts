import postgres from "postgres";

// Local Postgres has no TLS; hosted databases (Neon) require it.
export function connect(url: string, max = 5) {
  return postgres(url, {
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    max,
    idle_timeout: 20,
    onnotice: () => {},
  });
}

export type Sql = ReturnType<typeof connect>;
