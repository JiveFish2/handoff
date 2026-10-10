// npm run shopify:order — places a real demo order in the store; its webhook should arrive at
// the bridge a moment later.
import { shopifyAdmin } from "../src/lib/shopify/admin";
import { placeTestOrder } from "../src/lib/shopify/test-order";

const admin = shopifyAdmin({
  shop: process.env.SHOPIFY_SHOP!,
  clientId: process.env.SHOPIFY_CLIENT_ID!,
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET!,
});
const order = await placeTestOrder(admin);
console.log(`Placed ${order.name} (${order.id})`);
