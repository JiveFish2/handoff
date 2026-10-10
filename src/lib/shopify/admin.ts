// Shopify Admin GraphQL API for an app in the store owner's own organization. The access
// token comes from the client-credentials grant and lasts 24 hours, so it is cached and
// renewed a minute before it runs out.

export const API_VERSION = "2026-07";

type Options = { shop: string; clientId: string; clientSecret: string; fetch?: typeof fetch };

export class ShopifyError extends Error {}

export function shopifyAdmin({ shop, clientId, clientSecret, fetch: doFetch = fetch }: Options) {
  const base = `https://${shop}.myshopify.com/admin`;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - 60_000) return token.value;
    const response = await doFetch(`${base}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!response.ok) {
      // Errors come back as an HTML page whose title names the cause, e.g. app_not_installed.
      const text = await response.text();
      const reason = text.match(/<title>([^<]*)<\/title>/)?.[1] ?? text.slice(0, 200);
      throw new ShopifyError(`Token request answered ${response.status}: ${reason}`);
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await doFetch(`${base}/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json().catch(() => null)) as { data?: T; errors?: unknown } | null;
    if (!response.ok || !body?.data || body.errors) {
      throw new ShopifyError(`GraphQL answered ${response.status}: ${JSON.stringify(body?.errors ?? body)}`);
    }
    return body.data;
  }

  return { graphql };
}

export type ShopifyAdmin = ReturnType<typeof shopifyAdmin>;
