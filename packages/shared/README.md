# @tdts/shared

Part of [TDTS](../../docs/DESIGN.md). Code every program depends on, so they all agree on the protocol and the math. It has no runtime dependencies besides `zod` and runs in both Node and the browser.

| File                 | Contents                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages.ts`        | Network protocol: envelope, zod schemas per link (`ToCommandCenter`, `FromCommandCenter`, `ToWorldSim`, `FromWorldSim`), `createMessage`, `parseMessage`. **Source of truth for the protocol.** |
| `scenario.ts`        | Wave file schema; map view (start center/zoom) for configs.                                                                                                                                     |
| `geo.ts`             | Great-circle math: `distanceM`, `bearingDeg`, `destination`, `moveTowards`, `extrapolate`, bearing helpers.                                                                                     |
| `intercept.ts`       | `findEarliestIntercept`: when and where a weapon can hit a constant-velocity target. Used by the Command Center (assignment) and Shot Control (firing solution).                                |
| `device-identity.ts` | Device keys (Ed25519 via Web Crypto): `generateDeviceKeys`, `signChallenge`, `verifyChallenge`, `newChallengeNonce`, `deviceFingerprint`.                                                       |
| `keys.ts`            | Registration keys: `generateKey`, `isValidKeyFormat`.                                                                                                                                           |
| `constants.ts`       | Tuning values: fusion gates, heartbeat and kill-check timings, tick rate, default ports.                                                                                                        |

## Usage

```ts
import {
  createMessage,
  parseMessage,
  ToCommandCenterSchema,
  type ToCommandCenter,
} from "@tdts/shared";

const msg = createMessage<ToCommandCenter, "heartbeat">("heartbeat", {});
socket.send(JSON.stringify(msg));

const result = parseMessage(ToCommandCenterSchema, raw);
if (result.ok) handle(result.message);
else console.warn(result.error);
```

The package exports TypeScript source directly (`"exports": "./src/index.ts"`); apps run it through `tsx` (Node) and Vite (browser), so there is no build step.

## Rules

- Any message change goes here first, then into the programs that send or receive it.
- Keep it free of Node-only or browser-only APIs.
