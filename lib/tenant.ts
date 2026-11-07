// Single-tenant for now. Every DB row already carries a tenant_id, so when auth
// is added this is the one function to change (read it from the session).
export const DEFAULT_TENANT = "default";

export async function getTenantId(): Promise<string> {
  return DEFAULT_TENANT;
}
