export function wantsEventStream(accept: string | null): boolean {
  return (accept ?? "").toLowerCase().split(",").some((item) =>
    item.split(";")[0].trim() === "text/event-stream" && !/;\s*q\s*=\s*0(?:\.0*)?\s*(?:;|$)/.test(item));
}
