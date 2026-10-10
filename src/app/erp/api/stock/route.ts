import { erpApi } from "@/lib/services";

// The fictional ERP's stock endpoint. See src/lib/erp/server.ts.
export const GET = (request: Request) => erpApi().getStock(request);
