import { z } from "zod";

const trimmedString = (max: number) => z.string().trim().min(1).max(max);

export const updateObjectFieldsSchema = z.object({
  objectId: z.string().min(1),
  field: z.enum(["title", "goal", "currentState", "nextAction"]),
  value: z.string(),
});

export const checklistTitleSchema = z.object({
  objectId: z.string().min(1),
  itemId: z.string().min(1).optional(),
  title: z.string(),
});

export const checklistItemMutationSchema = z.object({
  objectId: z.string().min(1),
  itemId: z.string().min(1),
});

export const checklistReorderSchema = z.object({
  objectId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  orderedItemIds: z.array(z.string().min(1)),
});

export const objectReorderSchema = z.object({
  objectId: z.string().min(1),
  targetStatus: z.enum(["idea", "ready", "doing", "waiting", "done"]),
  orderedObjectIds: z.array(z.string().min(1)).min(1),
});

export const objectFieldLimits = {
  title: trimmedString(120),
  goal: trimmedString(1000),
  currentState: trimmedString(1000),
  nextAction: trimmedString(500),
} as const;

export const checklistTitleLimit = trimmedString(300);

export const manualCreateObjectSchema = z.object({
  title: objectFieldLimits.title,
  status: z.enum(["idea", "ready", "doing", "waiting", "done"]).default("idea"),
  goal: z.string().trim().max(1000).default(""),
  currentState: z.string().trim().max(1000).default(""),
  nextAction: z.string().trim().max(500).default(""),
}).strict();
