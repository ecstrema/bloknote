import { page } from "$app/state";

/**
 * The URL currently shown in the address bar. Shallow gotos (`goto(url, { shallow: true })`,
 * used to sync `?id=`, `?tab=` or `?q=` without reloading) only update `page.shallow.url`,
 * not `page.url`: reading `page.url` directly sees a stale query param (issues #197 and #212).
 * Use this helper everywhere URL-derived state is read outside of a real navigation.
 */
export function getBrowserUrl(): URL {
  return (page.shallow?.url ?? page.url) as URL;
}