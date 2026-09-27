/** Join class names, skipping falsy values (a dependency-free stand-in for shadcn's `cn`). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
