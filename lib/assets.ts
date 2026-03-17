export const SUPPORTED_ASSETS = [
  { symbol: "EURUSD", assetClass: "FOREX", binanceSymbol: null, alphaSymbol: "EUR", finnhubSymbol: null, provider: "Alpha Vantage" },
  { symbol: "GBPUSD", assetClass: "FOREX", binanceSymbol: null, alphaSymbol: "GBP", finnhubSymbol: null, provider: "Alpha Vantage" },
  { symbol: "USDJPY", assetClass: "FOREX", binanceSymbol: null, alphaSymbol: "JPY", finnhubSymbol: null, provider: "Alpha Vantage" },
  { symbol: "XAUUSD", assetClass: "COMMODITY", binanceSymbol: null, alphaSymbol: "XAU", finnhubSymbol: null, provider: "Alpha Vantage" },
  { symbol: "XAGUSD", assetClass: "COMMODITY", binanceSymbol: null, alphaSymbol: "XAG", finnhubSymbol: null, provider: "Alpha Vantage" },
  { symbol: "BTCUSDT", assetClass: "CRYPTO", binanceSymbol: "BTCUSDT", alphaSymbol: null, finnhubSymbol: null, provider: "Binance" },
  { symbol: "ETHUSDT", assetClass: "CRYPTO", binanceSymbol: "ETHUSDT", alphaSymbol: null, finnhubSymbol: null, provider: "Binance" },
] as const;

export type SupportedAsset = typeof SUPPORTED_ASSETS[number];

export const TRADE_PLAN_STYLES = ["SCALP", "INTRADAY", "SWING"] as const;
export type TradePlanStyle = typeof TRADE_PLAN_STYLES[number];
