// Tiny read-only proxy for public exchange market data.
// Whitelisted URL templates only, so it cannot be used as an open proxy.
// Served at /.netlify/functions/ticker (same origin as the page):
//   ?ex=kucoin|bybit|okx|mexc                      -> all-pairs ticker list
//   ?ex=...&kind=book|trades&sym=BASE (quote is USDT)  -> one pair's order book / recent trades
const TICKERS = {
  bybit: "https://api.bybit.com/v5/market/tickers?category=spot",
  mexc: "https://api.mexc.com/api/v3/ticker/bookTicker",
  kucoin: "https://api.kucoin.com/api/v1/market/allTickers",
  okx: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
};

const DETAIL = {
  mexc: {
    book: (s) => `https://api.mexc.com/api/v3/depth?symbol=${s}USDT&limit=50`,
    trades: (s) => `https://api.mexc.com/api/v3/trades?symbol=${s}USDT&limit=20`,
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

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const ex = q.get("ex");
  const kind = q.get("kind");
  let url;
  if (kind) {
    const sym = q.get("sym") || "";
    const d = DETAIL[ex];
    if (!d || !d[kind] || !/^[A-Za-z0-9]{2,20}$/.test(sym)) return new Response("bad request", { status: 400 });
    url = d[kind](sym.toUpperCase());
  } else {
    url = TICKERS[ex];
  }
  if (!url) return new Response("unknown exchange", { status: 400 });
  try {
    const r = await fetch(url, { headers: { "user-agent": "arb-scanner/1.0" } });
    return new Response(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=2" },
    });
  } catch (e) {
    return new Response(String(e), { status: 502 });
  }
};
