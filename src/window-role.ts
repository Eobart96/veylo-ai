export type WindowRole = "main" | "overlay" | "backdrop";
export function visibleSections(role: WindowRole): ("overlay" | "guide")[] {
  return role === "main" ? ["overlay", "guide"] : [];
}
export function windowRole(search: string, nativeLabel?: string): WindowRole {
  const requested = nativeLabel ?? new URLSearchParams(search).get("window");
  return requested === "overlay" || requested === "backdrop" ? requested : "main";
}
