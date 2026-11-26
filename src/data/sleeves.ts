import type { PlayerId } from "../engine/types";

// A deck's sleeve / g_sleeve is a path in the card-images bucket, so both players' clients can load it
export interface Sleeve {
  path: string;
  name: string;
  own?: boolean;        // uploaded by this player (deletable); the default set is shared
}

// Used when a deck has no sleeve chosen
export const DEFAULT_SLEEVES: Record<PlayerId, { sleeve: string; g_sleeve: string }> = {
  me: { sleeve: "defaults/sleeves/emilia.jpg", g_sleeve: "defaults/sleeves/sun.jpg" },
  bot: { sleeve: "defaults/sleeves/echidna.jpg", g_sleeve: "defaults/sleeves/moon.jpg" },
};
