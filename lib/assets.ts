export const SUPPORTED_ASSETS = [
  { symbol: "EURUSD",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "GBPUSD",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "USDJPY",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "USDCAD",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "AUDUSD",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "NZDUSD",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "USDCHF",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "EURJPY",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "GBPJPY",  assetClass: "FOREX",     binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "XAGUSD",  assetClass: "COMMODITY", binanceSymbol: null,      provider: "Yahoo Finance" },
  { symbol: "BTCUSDT", assetClass: "CRYPTO",    binanceSymbol: "BTCUSDT", provider: "Binance" },
  { symbol: "ETHUSDT", assetClass: "CRYPTO",    binanceSymbol: "ETHUSDT", provider: "Binance" },
] as const;

export type SupportedAsset = typeof SUPPORTED_ASSETS[number];

export const TRADE_PLAN_STYLES = ["SCALP", "INTRADAY", "SWING"] as const;
export type TradePlanStyle = typeof TRADE_PLAN_STYLES[number];
