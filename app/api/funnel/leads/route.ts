import { handleLeadRequest } from "@/lib/funnel-intake";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleLeadRequest(request, process.env);
}
