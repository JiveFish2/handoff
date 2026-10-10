import { sql } from "@/lib/db";
import { erpClient } from "@/lib/erp/client";
import { erpServer } from "@/lib/erp/server";

// Wiring for the running app; tests build the same pieces against their own database.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const erp = () =>
  erpClient({ baseUrl: required("ERP_BASE_URL"), apiKey: required("ERP_API_KEY") });

export const erpApi = () => erpServer(sql, { apiKey: required("ERP_API_KEY") });

export const shopifySecret = () => required("SHOPIFY_CLIENT_SECRET");
