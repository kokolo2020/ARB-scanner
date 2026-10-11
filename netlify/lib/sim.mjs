// Paper-trading simulator for cross-exchange spreads, "option 1": money pre-positioned on both exchanges,
// so each trade is a simultaneous buy on one exchange and sell on the other, with no transfer.
// Pure logic (no network, no storage) so it can be unit-tested.
import { verifyRow } from "./core.mjs";

export const CFG = {
  epoch: 4,             // bump to wipe saved state on next run
  exchanges: ["kucoin", "okx", "mexc"],
  size: 250,            // USDT per paper trade
  fee: 0.001,           // taker fee per side (0.1%)
  cap: 0.10,            // ignore gross spreads above 10% (almost always bad data)
  watch: ["LUNC", "LRC"], // if non-empty, simulate only these coins (every route, every minute)
  topN: 8,              // candidates deep-checked per minute
  minQuotedNet: 0,      // only deep-check candidates that look profitable on top-of-book
  cooldownMin: 15,      // don't re-trade the same coin+route within this many minutes
  rebalancePct: 0.003,  // assumed cost of moving coins back between exchanges (0.3% of value moved)
  maxTrades: 300,       // recent trades kept in state
  maxLifetimes: 300,
  keepHours: 24 * 14,
};

export function emptyState(now) {
  return {
    version: 1, epoch: CFG.epoch, startedAt: now, lastRun: null, runs: 0, cfg: CFG,
    exStatus: {}, trades: [], tradeCount: 0, profit: 0, volume: 0,
    byCoin: {}, watch: {}, inv: {}, lastPx: {}, cooldown: {}, open: {}, lifetimes: [], hours: {},
  };
}

export function selectCandidates(rows, cfg = CFG) {
  if (cfg.watch && cfg.watch.length) return rows.filter((r) => cfg.watch.includes(r.base));
  return rows.filter((r) => r.net > cfg.minQuotedNet).sort((a, b) => b.net - a.net).slice(0, cfg.topN);
}

const blankHour = () => ({ runs: 0, real: 0, small: 0, stale: 0, no: 0, err: 0, trades: 0, profit: 0 });

export function stepSim(state, { candidates, details, exErr = {}, exOk = [] }, now, cfg = CFG) {
  state.cfg = cfg;
  state.runs++;
  state.lastRun = now;
  for (const ex of cfg.exchanges) {
    const s = state.exStatus[ex] || (state.exStatus[ex] = { ok: 0, fail: 0, lastErr: null });
    if (exOk.includes(ex)) s.ok++;
    else { s.fail++; s.lastErr = exErr[ex] || "unavailable"; }
  }
  const hk = new Date(now).toISOString().slice(0, 13);
  const h = state.hours[hk] || (state.hours[hk] = blankHour());
  h.runs++;
  const seen = new Set();
  const usedBuy = new Set(), usedSell = new Set(); // one fill per book side per run (no double-spending the same liquidity)

  for (const r of candidates) {
    const g = (ex, k) => details[ex + "|" + r.base + "|" + k];
    const bb = g(r.buy, "book"), sb = g(r.sell, "book"), bt = g(r.buy, "trades"), st = g(r.sell, "trades");
    const bad = [bb, sb].find((x) => !x || x.error || !x.asks || !x.bids || !x.asks.length || !x.bids.length);
    if (bad) { h.err++; continue; }
    const v = verifyRow(bb, sb, bt && !bt.error ? bt : null, st && !st.error ? st : null, cfg.size, cfg.fee, 0, now);
    h[v.verdict.toLowerCase()]++;
    const w = (state.watch || (state.watch = {}))[r.base] || (state.watch[r.base] = { checks: 0, real: 0, small: 0, stale: 0, no: 0, bestNet: -1 });
    w.checks++; w[v.verdict.toLowerCase()]++;
    if (v.atSize && v.atSize.net > w.bestNet) w.bestNet = v.atSize.net;
    const key = r.base + ":" + r.buy + ">" + r.sell;

    if (v.verdict === "REAL" || v.verdict === "SMALL") {
      seen.add(key);
      const o = state.open[key] || (state.open[key] = { first: now, last: now, count: 0, maxProfit: 0, verdict: v.verdict });
      o.last = now; o.count++; o.verdict = v.verdict;
      const p = v.verdict === "REAL" ? v.atSize.profit : v.best.profit;
      if (p > o.maxProfit) o.maxProfit = p;
    }

    if (v.verdict === "REAL") {
      const last = state.cooldown[key];
      if (last && now - last < cfg.cooldownMin * 60000) continue;
      if (usedBuy.has(r.base + r.buy) || usedSell.has(r.base + r.sell)) continue;
      usedBuy.add(r.base + r.buy); usedSell.add(r.base + r.sell);
      const a = v.atSize;
      const qty = cfg.size * (1 - cfg.fee) / a.buyAvg;
      state.trades.push({ t: now, coin: r.base, buy: r.buy, sell: r.sell, size: cfg.size, profit: a.profit, net: a.net, quotedNet: r.net, buyAvg: a.buyAvg, sellAvg: a.sellAvg, qty });
      if (state.trades.length > cfg.maxTrades) state.trades.shift();
      state.tradeCount++; state.profit += a.profit; state.volume += cfg.size;
      const c = state.byCoin[r.base] || (state.byCoin[r.base] = { n: 0, profit: 0, vol: 0 });
      c.n++; c.profit += a.profit; c.vol += cfg.size;
      const inv = state.inv[r.base] || (state.inv[r.base] = {});
      inv[r.buy] = (inv[r.buy] || 0) + qty;
      inv[r.sell] = (inv[r.sell] || 0) - qty;
      state.lastPx[r.base] = a.sellAvg;
      state.cooldown[key] = now;
      h.trades++; h.profit += a.profit;
    }
  }

  for (const key of Object.keys(state.open)) {
    if (seen.has(key)) continue;
    const o = state.open[key];
    state.lifetimes.push({ key, runs: o.count, maxProfit: o.maxProfit, verdict: o.verdict });
    delete state.open[key];
  }
  if (state.lifetimes.length > cfg.maxLifetimes) state.lifetimes = state.lifetimes.slice(-cfg.maxLifetimes);
  for (const k of Object.keys(state.cooldown)) if (now - state.cooldown[k] > cfg.cooldownMin * 60000) delete state.cooldown[k];
  const hrs = Object.keys(state.hours).sort();
  while (hrs.length > cfg.keepHours) delete state.hours[hrs.shift()];
  return state;
}

export function summarize(s) {
  const days = {};
  for (const [hour, v] of Object.entries(s.hours)) {
    const d = hour.slice(0, 10);
    const o = days[d] || (days[d] = blankHour());
    for (const k of Object.keys(o)) o[k] += v[k] || 0;
  }
  let moved = 0;
  for (const coin of Object.keys(s.inv)) {
    const px = s.lastPx[coin] || 0;
    for (const ex of Object.keys(s.inv[coin])) if (s.inv[coin][ex] > 0) moved += s.inv[coin][ex] * px;
  }
  const rebalanceCost = moved * s.cfg.rebalancePct;
  const life = s.lifetimes.map((x) => x.runs).sort((a, b) => a - b);
  return {
    startedAt: s.startedAt, lastRun: s.lastRun, runs: s.runs, cfg: s.cfg, exStatus: s.exStatus,
    tradeCount: s.tradeCount, profit: s.profit, volume: s.volume,
    rebalanceMoved: moved, rebalanceCost, netAfterRebalance: s.profit - rebalanceCost,
    days, watch: s.watch || {}, live: s.live || [],
    byCoin: Object.entries(s.byCoin).map(([coin, v]) => ({ coin, ...v })).sort((a, b) => b.profit - a.profit).slice(0, 10),
    trades: s.trades.slice(-20).reverse(),
    lifetimes: { count: life.length, median: life.length ? life[Math.floor(life.length / 2)] : null, max: life.length ? life[life.length - 1] : null, over5: life.filter((x) => x >= 5).length },
    openNow: Object.keys(s.open).length,
  };
}
