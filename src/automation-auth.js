export function isTrackingAutomationAuthorized(request, env) {
  const dedicated = String(env.TTG_TRACKING_AUTOMATION_TOKEN || "");
  const provided = String(request.headers.get("x-ttg-tracking-secret") || "");
  if (dedicated && provided && provided === dedicated) return true;

  const admin = String(env.ADMIN_TOKEN || "");
  const authorization = String(request.headers.get("authorization") || "");
  return Boolean(admin) && authorization === `Bearer ${admin}`;
}
