// UI channel between the Command Center server and its operator page.
// Private to this program; messages are { type, payload }.

import { MapViewSchema } from "@tdts/shared";
import { z } from "zod";

export const CommandStateSchema = z.object({
  view: MapViewSchema,
});
export type CommandState = z.infer<typeof CommandStateSchema>;

export const ServerToUiSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), payload: CommandStateSchema }),
]);
export type ServerToUi = z.infer<typeof ServerToUiSchema>;
