/**
 * Core event types and matching utilities.
 * @module event
 */
import { z } from "zod/v4";

/**
 * A parsed event with deserialized payload.
 *
 * @property id - Unique auto-incrementing event ID
 * @property timestamp - Unix epoch timestamp when the event was created
 * @property type - Event type identifier (e.g., "task.created", "message.sent")
 * @property worker_id - ID of the worker that pushed this event
 * @property payload - Deserialized JSON payload data
 */
export const EventSchema = z.object({
  id: z.number().int(),
  timestamp: z.number().int(),
  type: z.string(),
  worker_id: z.string(),
  payload: z.unknown(),
});

export type Event = z.infer<typeof EventSchema>;

/**
 * Raw database row before JSON payload deserialization.
 */
export const RawEventRowSchema = EventSchema.extend({ payload: z.string() });

export type RawEventRow = z.infer<typeof RawEventRowSchema>;

/** Minimal shape needed for event matching (satisfied by AgentDef). */
export const ListenerDefSchema = z.object({
  id: z.string(),
  listen: z.array(z.string()),
});

export type ListenerDef = z.infer<typeof ListenerDefSchema>;

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
