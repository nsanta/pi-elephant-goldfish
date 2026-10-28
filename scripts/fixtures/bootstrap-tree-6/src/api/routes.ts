export const ROUTES: Record<string, string> = {
  "/health": "GET",
  "/items": "GET,POST",
};

export function resolveRoute(pathname: string): string | undefined {
  return ROUTES[pathname];
}
