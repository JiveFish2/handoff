import { erpApi } from "@/lib/services";

// Stock moves booked in the fictional ERP. See src/lib/erp/server.ts.
export const POST = (request: Request) => erpApi().adjustStock(request);
