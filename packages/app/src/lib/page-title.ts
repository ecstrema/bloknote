/**
 * The [DEV] prefix of the browser tab title in development, shown on every route (issue #240).
 * `pageTitle` wraps fixed title strings; `devPrefix` is meant for text-node expressions like
 * `<title>{devPrefix}Bloknote{name}</title>`, so wuchale keeps extracting the whole title
 * (placeholders included) as a single translatable message.
 */
export const devPrefix = import.meta.env.DEV ? "[DEV] " : "";

export function pageTitle(title: string): string {
  return `${devPrefix}${title}`;
}
