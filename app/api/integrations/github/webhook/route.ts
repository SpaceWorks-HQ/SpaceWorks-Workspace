import { receiveGithub } from "@/lib/integrations/github/webhook";
export const runtime = "nodejs";
export async function POST(request: Request) { return receiveGithub(request); }
