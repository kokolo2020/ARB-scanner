// Scheduled every minute: paper-trading simulation of cross-exchange spreads.
// Reads public market data only. No API keys, no orders.
import { getStore } from "@netlify/blobs";
import { cross } from "../lib/core.mjs";
import { fetchTickers, fetchBook, fetchTrades } from "../lib/market.mjs";
import { CFG, emptyState, selectCandidates, stepSim } from "../lib/sim.mjs";

export default async () => {
  const now = Date.now();
  const store = getStore({ name: "arb-sim", consistency: "strong" });
  let state = await store.get("state", { type: "json" });
  if (!state || state.epoch !== CFG.epoch) state = emptyState(now);

  const results = await Promise.allSettled(CFG.exchanges.map((ex) => fetchTickers(ex)));
  const books = {}, exErr = {};
  results.forEach((r, i) => {
    const ex = CFG.exchanges[i];
    if (r.status === "fulfilled" && r.value.length) books[ex] = r.value;
    else exErr[ex] = (r.reason && r.reason.message) || "empty";
  });

  const rows = (Object.keys(books).length > 1 ? cross(books, CFG.size, CFG.fee, 0, CFG.cap).rows : []).filter((r) => !CFG.block.includes(r.base));
  // (only routes between exchanges that answered this minute are present, since cross() uses books we got)
  const candidates = selectCandidates(rows, CFG);

  const jobs = new Map();
  for (const r of candidates)
    for (const k of ["book", "trades"])
      for (const ex of [r.buy, r.sell]) jobs.set(`${ex}|${r.base}|${k}`, { ex, base: r.base, k });
  const details = {};
  await Promise.all([...jobs.entries()].map(async ([key, j]) => {
    try { details[key] = j.k === "book" ? await fetchBook(j.ex, j.base) : await fetchTrades(j.ex, j.base); }
    catch (e) { details[key] = { error: e.message }; }
  }));

  state.live = rows.filter((r) => CFG.watch.includes(r.base)).map((r) => ({ base: r.base, buy: r.buy, sell: r.sell, buyPx: r.buyPx, sellPx: r.sellPx, gross: r.gross, net: r.net, liq: r.liq }));
  stepSim(state, { candidates, details, exErr, exOk: Object.keys(books) }, now, CFG);
  await store.setJSON("state", state);
  return new Response("ok");
};

export const config = { schedule: "* * * * *", region: "fra" };
