/**
 * Normalize string to a slug.
 * Slugs allow word characters and dashes.
 * Spaces are replaced with dashes. Contiguous spaces are replaced with a single dash.
 */
export const toSlug = (s: string): string | undefined => {
  const slug = s
    .trim()
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/[^\w-]/g, "") // strip non-word, non-hyphen chars
    .toLowerCase();

  if (slug === "") return undefined;

  return slug;
};
