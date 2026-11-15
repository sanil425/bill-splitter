/**
 * Request bodies for our own API routes. Limits are generous sanity caps,
 * not product rules.
 */
import { z } from "zod";
import { ItemSchema } from "./domain";

export const AttributeRequestSchema = z.object({
  /** Domain items from one or more receipts (may be empty in no-receipt mode). */
  items: z
    .array(ItemSchema)
    .max(300)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, { message: "Item ids must be unique" }),
  /** The host's typed notes, oldest first. */
  messages: z.array(z.string().trim().min(1).max(5000)).min(1).max(50),
  hostName: z.string().trim().min(1).max(60),
});
export type AttributeRequest = z.infer<typeof AttributeRequestSchema>;
