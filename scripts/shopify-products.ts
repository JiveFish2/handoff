// npm run shopify:products — creates (or updates) the Kilnhouse catalog in the Shopify store:
// one product per coffee, two size variants each, with the same SKUs and starting stock the
// bridge and the ERP expect. Safe to run again: products are matched by handle.
import { COFFEES, START_STOCK, SIZES } from "../src/catalog";
import { shopifyAdmin } from "../src/lib/shopify/admin";

const admin = shopifyAdmin({
  shop: process.env.SHOPIFY_SHOP!,
  clientId: process.env.SHOPIFY_CLIENT_ID!,
  clientSecret: process.env.SHOPIFY_CLIENT_SECRET!,
});

const NOTICE = "Kilnhouse Coffee is a fictional company. This store is a demo and does not sell anything.";
const sizeName = (size: (typeof SIZES)[number]) => (size === "1000" ? "1 kg" : "250 g");
const skuSuffix = (size: (typeof SIZES)[number]) => (size === "1000" ? "1kg" : "250");

const { locations } = await admin.graphql<{ locations: { nodes: { id: string }[] } }>(`{ locations(first: 1) { nodes { id } } }`);
const locationId = locations.nodes[0].id;

for (const coffee of COFFEES) {
  const result = await admin.graphql<{
    productSet: { product: { handle: string } | null; userErrors: { field: string[]; message: string }[] };
  }>(
    `mutation ($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
      productSet(synchronous: true, identifier: $identifier, input: $input) {
        product { handle }
        userErrors { field message }
      }
    }`,
    {
      identifier: { handle: coffee.slug },
      input: {
        title: coffee.name,
        handle: coffee.slug,
        vendor: "Kilnhouse Coffee",
        productType: "Coffee",
        status: "ACTIVE",
        tags: [coffee.origin],
        descriptionHtml:
          `<p>${coffee.description}</p><p><strong>Origin:</strong> ${coffee.origin}<br>` +
          `<strong>Tasting notes:</strong> ${coffee.notes}</p><p><em>${NOTICE}</em></p>`,
        productOptions: [{ name: "Size", position: 1, values: SIZES.map((s) => ({ name: sizeName(s) })) }],
        variants: SIZES.map((size) => ({
          optionValues: [{ optionName: "Size", name: sizeName(size) }],
          price: coffee.prices[size].toFixed(2),
          inventoryItem: { sku: `${coffee.slug}-${skuSuffix(size)}`, tracked: true },
          inventoryQuantities: [{ locationId, name: "available", quantity: START_STOCK[size] }],
        })),
      },
    },
  );
  const errors = result.productSet.userErrors;
  console.log(errors.length ? `${coffee.name}: ${errors.map((e) => `${e.field?.join(".")} ${e.message}`).join("; ")}` : `${coffee.name}: ok`);
}
