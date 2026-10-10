// npm run shopify:check — confirms the app can reach the store: gets a token, then reads the
// shop's name, the granted scopes and the inventory locations. Never prints the token.
import { shopifyAdmin } from "../src/lib/shopify/admin";

const admin = shopifyAdmin({
  shop: process.env.SHOPIFY_SHOP!,
  clientId: process.env.SHOPIFY_CLIENT_ID!,
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET!,
});

const data = await admin.graphql<{
  shop: { name: string; currencyCode: string; myshopifyDomain: string };
  currentAppInstallation: { accessScopes: { handle: string }[] };
  locations: { nodes: { id: string; name: string }[] };
  products: { nodes: { id: string }[] };
}>(`{
  shop { name currencyCode myshopifyDomain }
  currentAppInstallation { accessScopes { handle } }
  locations(first: 5) { nodes { id name } }
  products(first: 1) { nodes { id } }
}`);

console.log(`Shop: ${data.shop.name} (${data.shop.myshopifyDomain}), currency ${data.shop.currencyCode}`);
console.log(`Scopes: ${data.currentAppInstallation.accessScopes.map((s) => s.handle).join(", ")}`);
console.log(`Locations: ${data.locations.nodes.map((l) => l.name).join(", ")}`);
console.log(`Products so far: ${data.products.nodes.length ? "some" : "none"}`);
