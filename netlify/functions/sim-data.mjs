// Read-only summary of the paper-trading simulation, for the page's Simulation tab.
import { getStore } from "@netlify/blobs";
import { summarize } from "../lib/sim.mjs";

export default async () => {
  const state = await getStore({ name: "arb-sim", consistency: "strong" }).get("state", { type: "json" });
  const body = state ? summarize(state) : { empty: true };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
};
