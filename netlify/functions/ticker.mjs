// Tiny read-only proxy for public exchange ticker data.
// Whitelisted URLs only, so it cannot be used as an open proxy.
// Served at /.netlify/functions/ticker?ex=kucoin|okx|binance (same origin as the page).
const URLS = {
  binance: "https://data-api.binance.vision/api/v3/ticker/bookTicker",
  kucoin: "https://api.kucoin.com/api/v1/market/allTickers",
  okx: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
};

export default async (req) => {
  const ex = new URL(req.url).searchParams.get("ex");
  const url = URLS[ex];
  if (!url) return new Response("unknown exchange", { status: 400 });
  try {
    const r = await fetch(url, { headers: { "user-agent": "arb-scanner/1.0" } });
    return new Response(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3" },
    });
  } catch (e) {
    return new Response(String(e), { status: 502 });
  }
};
