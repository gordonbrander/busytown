/**
 * Core event types and matching utilities.
 *
 * @module event
 */

/**
 * A parsed event with deserialized payload.
 *
 * @property id - Unique auto-incrementing event ID
 * @property timestamp - Unix epoch timestamp when the event was created
 * @property type - Event type identifier (e.g., "task.created", "message.sent")
 * @property worker_id - ID of the worker that pushed this event
 * @property payload - Deserialized JSON payload data
 */
export type Event = {
  id: number;
  timestamp: number;
  type: string;
  worker_id: string;
  payload: unknown;
};

/**
 * Raw database row before JSON payload deserialization.
 */
export type RawEventRow = Omit<Event, "payload"> & { payload: string };

/** Minimal shape needed for event matching (satisfied by AgentDef). */
export type ListenerDef = {
  id: string;
  listen: string[];
};

/** Check if an event matches a listener's listen patterns. */
export const matchesListen = (
  event: Event,
  listener: ListenerDef,
): boolean => {
  for (const pattern of listener.listen) {
    if (pattern === "*") {
      // Wildcard matches everything except events from self
      if (event.worker_id !== listener.id) return true;
    } else if (pattern.endsWith(".*")) {
      // Prefix glob: "task.*" matches "task.created", "task.done", etc.
      const prefix = pattern.slice(0, -1);
      if (event.type.startsWith(prefix)) return true;
    } else {
      // Exact match
      if (event.type === pattern) return true;
    }
  }
  return false;
};

/** Filter events to those matching a listener's listen patterns. */
export const filterMatchedEvents = (
  events: Event[],
  listener: ListenerDef,
): Event[] => events.filter((e) => matchesListen(e, listener));
