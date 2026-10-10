"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { replayOrder } from "@/lib/bridge/replay";
import { clientId, takeSlot, type DemoAction } from "@/lib/demo/limits";
import type { FaultMode } from "@/lib/erp/server";
import { queue, shopifyAdmin } from "@/lib/services";
import { placeTestOrder } from "@/lib/shopify/test-order";

// The console's three actions. Each one counts against the demo's limits before it does
// anything. Answers are short sentences the console shows as they are.

export type ActionResult = { ok: boolean; message: string };

const FAULT_MINUTES = 3;
const MODES: FaultMode[] = ["down", "slow", "rate_limited", "response_lost", "rejects"];

async function slot(action: DemoAction) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
  return takeSlot(sql, action, clientId(ip, process.env.DEMO_SALT ?? "handoff"));
}

export async function placeOrder(): Promise<ActionResult> {
  const allowed = await slot("order");
  if (!allowed.ok) return { ok: false, message: allowed.reason };
  try {
    const order = await placeTestOrder(shopifyAdmin());
    refresh();
    return { ok: true, message: `${order.name} placed in the store. Its webhook should arrive in a few seconds.` };
  } catch (error) {
    console.error("Test order failed", error);
    return { ok: false, message: "The store did not accept the order. Try again in a minute." };
  }
}

export async function setFault(mode: string, on: boolean): Promise<ActionResult> {
  if (!MODES.includes(mode as FaultMode)) return { ok: false, message: "Unknown fault." };
  if (on) {
    const allowed = await slot("fault");
    if (!allowed.ok) return { ok: false, message: allowed.reason };
    await sql`INSERT INTO erp.faults (mode, until) VALUES (${mode}, now() + ${FAULT_MINUTES} * interval '1 minute')
      ON CONFLICT (mode) DO UPDATE SET until = excluded.until`;
  } else {
    await sql`DELETE FROM erp.faults WHERE mode = ${mode}`;
  }
  refresh();
  return { ok: true, message: on ? `${mode} is on for ${FAULT_MINUTES} minutes.` : `${mode} is off.` };
}

export async function replay(orderId: number): Promise<ActionResult> {
  const allowed = await slot("replay");
  if (!allowed.ok) return { ok: false, message: allowed.reason };
  const done = await replayOrder(sql, queue(), orderId);
  refresh();
  return done ? { ok: true, message: "Sent back for delivery." } : { ok: false, message: "Only orders in the failed queue can be replayed." };
}
