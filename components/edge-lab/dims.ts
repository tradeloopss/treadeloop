import { DIMS } from "@/lib/edge/core"

// The dimensions a trader can pick from, in the groups a picker shows them in.
export const GROUP_LABELS: Record<string, string> = { market: "Market", timing: "Timing", trade: "The trade", behaviour: "Behaviour", psychology: "State of mind", regime: "Market regime" }
export const DIM_GROUPS = Object.entries(GROUP_LABELS).map(([group, label]) => ({ group, label, dims: DIMS.filter((d) => d.group === group) }))
