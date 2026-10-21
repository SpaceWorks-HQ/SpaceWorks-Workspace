import { z } from "zod";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getWorkspaceForAction } from "@/lib/permissions";
import { VAULT_MFA_COOKIE } from "@/lib/vault/mfa";
import { readSecrets, revealVersion } from "@/lib/secrets/service";
import { projectAudit } from "@/lib/secrets/queries";
import { formatSecrets, SecretsError, KEY_PATTERN } from "@/lib/secrets/values";
import {
  apiLimit,
  browserOrigin,
  jsonBody,
  privateHeaders,
  apiError,
} from "@/lib/secrets/http";
export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/w/[workspaceSlug]/secrets">,
) {
  try {
    browserOrigin(request);
    await apiLimit(request);
    const { workspaceSlug } = await params;
    const actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
    if (!actor) throw new SecretsError("That workspace is unavailable.");
    const body = await jsonBody(request);
    const ctx = {
      ...actor,
      proof: (await cookies()).get(VAULT_MFA_COOKIE)?.value,
    };
    if (body.operation === "audit") {
      const events = await projectAudit(
        ctx,
        String(body.projectId),
        body.action ? String(body.action) : undefined,
        body.environmentId ? String(body.environmentId) : undefined,
        body.from ? String(body.from) : undefined,
        body.until ? String(body.until) : undefined,
      );
      const csv = [
        "Time,Action,Actor,Environment,Record",
        ...events.map((e) =>
          [
            e.createdAt.toISOString(),
            e.action,
            e.actorId ?? "",
            e.environmentId ?? "",
            e.targetId ?? "",
          ]
            .map((v) => '"' + v.replaceAll('"', '""') + '"')
            .join(","),
        ),
      ].join("\n");
      return new Response(csv, {
        headers: {
          ...privateHeaders,
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=secrets-audit.csv",
        },
      });
    }
    if (body.operation === "version")
      return Response.json(
        {
          value: await revealVersion(
            ctx,
            String(body.environmentId),
            String(body.secretId),
            String(body.versionId),
          ),
        },
        { headers: privateHeaders },
      );
    if (!["reveal", "reveal-view", "raw", "copy", "export"].includes(String(body.operation))) throw new SecretsError("Choose a supported secrets operation.");
    if (
      body.operation !== "export" && body.operation !== "reveal-view" &&
      (typeof body.key !== "string" || !body.key)
    )
      throw new SecretsError("Choose a key to reveal.");
    const keys = body.operation === "reveal-view" ? z.array(z.string().regex(KEY_PATTERN)).min(1).max(500).safeParse(body.keys) : null;
    if (keys && !keys.success) throw new SecretsError("Choose up to 500 valid key names.");
    const values = await readSecrets(
      ctx,
      String(body.environmentId),
      String(body.path ?? "/"),
      {
        key: body.key ? String(body.key) : undefined,
        keys: keys?.success ? keys.data : undefined,
        exporting: body.operation === "export",
        raw: body.operation === "raw",
        copying: body.operation === "copy",
      },
    );
    if (body.operation === "export")
      return new Response(formatSecrets(values, String(body.format ?? "env")), {
        headers: {
          ...privateHeaders,
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    return Response.json({ values }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}
