import { erpApi } from "@/lib/services";

// The fictional ERP's order endpoint. See src/lib/erp/server.ts.
export const GET = (request: Request) => erpApi().findOrders(request);
export const POST = (request: Request) => erpApi().createOrder(request);
