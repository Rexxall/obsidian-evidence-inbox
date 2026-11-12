/** A class name a CSS snippet can target, or "" when the value is empty or not a valid class. */
export function noteClassName(value: string | undefined): string {
  const name = (value ?? "").trim();
  return /^[A-Za-z][\w-]*$/.test(name) ? name : "";
}

/** Adds a class to a note's cssclasses, keeping the ones already there; the old `cssclass` field becomes `cssclasses`. */
export function withCssClass(frontmatter: Record<string, unknown>, value: string | undefined): void {
  const name = noteClassName(value);
  if (!name) return;
  const raw = frontmatter.cssclasses ?? frontmatter.cssclass;
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [])
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (!list.includes(name)) list.push(name);
  delete frontmatter.cssclass;
  frontmatter.cssclasses = list;
}
