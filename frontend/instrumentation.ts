export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { backendOrigin, frontendOrigin, gatewaySecret } = await import("@/lib/frontend/config");
    frontendOrigin();
    const backend = backendOrigin();
    gatewaySecret();
    if (process.env.NEXT_PUBLIC_BACKEND_ORIGIN !== backend) throw new Error("NEXT_PUBLIC_BACKEND_ORIGIN must match BACKEND_ORIGIN; rebuild after changing public origins.");
    if (process.env.NODE_ENV === "production") {
      const raw = process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ?? "";
      const decoded = Buffer.from(raw, "base64");
      if (![16, 24, 32].includes(decoded.length) || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) throw new Error("A stable frontend Server Actions encryption key is required at build and runtime.");
    }
    if (!["x-nf-client-connection-ip", "x-real-ip"].includes(process.env.FRONTEND_TRUSTED_IP_HEADER ?? "")) throw new Error("FRONTEND_TRUSTED_IP_HEADER is required.");
  }
}
