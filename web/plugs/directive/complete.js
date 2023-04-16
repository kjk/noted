import { events } from "$sb/plugos-syscall/mod.js";
export async function queryComplete(completeEvent) {
  const match = /#query ([\w\-_]+)*$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  const allEvents = await events.listEvents();
  return {
    from: completeEvent.pos - match[1].length,
    options: allEvents
      .filter((eventName) => eventName.startsWith("query:"))
      .map((source) => ({
        label: source.substring("query:".length),
      })),
  };
}
