// Server-side public market data (no CORS issues here). Detection/simulation only: no keys, no orders.
import { parsers, normBook, normTrades } from "./core.mjs";

const TICKERS = {
  kucoin: "https://api.kucoin.com/api/v1/market/allTickers",
  bybit: "https://api.bybit.com/v5/market/tickers?category=spot",
  okx: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
  binance: "https://api.binance.com/api/v3/ticker/bookTicker",
};
const DETAIL = {
  binance: {
    book: (s) => `https://api.binance.com/api/v3/depth?symbol=${s}USDT&limit=50`,
    trades: (s) => `https://api.binance.com/api/v3/trades?symbol=${s}USDT&limit=20`,
  },
  kucoin: {
    book: (s) => `https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${s}-USDT`,
    trades: (s) => `https://api.kucoin.com/api/v1/market/histories?symbol=${s}-USDT`,
  },
  bybit: {
    book: (s) => `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${s}USDT&limit=50`,
    trades: (s) => `https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${s}USDT&limit=20`,
  },
  okx: {
    book: (s) => `https://www.okx.com/api/v5/market/books?instId=${s}-USDT&sz=20`,
    trades: (s) => `https://www.okx.com/api/v5/market/trades?instId=${s}-USDT&limit=20`,
  },
};

async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { "user-agent": "arb-sim/1.0" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export async function fetchTickers(ex) {
  const d = await getJSON(TICKERS[ex], 12000);
  if (ex === "bybit" && d.retCode !== 0) throw new Error("Bybit: " + d.retMsg);
  return parsers[ex](d);
}
export async function fetchBook(ex, base) {
  const d = await getJSON(DETAIL[ex].book(base));
  if (ex === "bybit" && d.retCode !== 0) throw new Error("Bybit: " + d.retMsg);
  return normBook(ex, d);
}
export async function fetchTrades(ex, base) {
  const d = await getJSON(DETAIL[ex].trades(base));
  if (ex === "bybit" && d.retCode !== 0) throw new Error("Bybit: " + d.retMsg);
  return normTrades(ex, d);
}
