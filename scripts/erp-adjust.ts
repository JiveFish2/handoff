// npm run erp:adjust -- <ERP item code> <delta> [reason]
// Books a stock move in the fictional ERP, as the roastery would after a delivery or a count.
// The bridge picks it up on its next stock sync.
import { erpClient } from "../src/lib/erp/client";

const [code, delta, reason = "Manual adjustment"] = process.argv.slice(2);
if (!code || !Number.isInteger(Number(delta))) throw new Error("Usage: npm run erp:adjust -- KH-ETH-250 20 [reason]");
const erp = erpClient({ baseUrl: process.env.ERP_BASE_URL!, apiKey: process.env.ERP_API_KEY! });
const item = await erp.adjustStock({ item_code: code, delta: Number(delta), reason });
console.log(`${item.code} now ${item.stock} in the ERP.`);
