import type { TradingViewResolution } from "@/lib/charting/resolutionMap";
import type { TradingViewDatafeed } from "@/lib/charting/tradingViewDatafeed";

type TradingViewWidgetOptions = {
  autosize?: boolean;
  symbol: string;
  interval: TradingViewResolution;
  container: string;
  datafeed: TradingViewDatafeed;
  library_path: string;
  locale?: string;
  timezone?: string;
  theme?: "Dark" | "Light";
  disabled_features?: string[];
  enabled_features?: string[];
};

type TradingViewShapePoint = {
  time: number;
  price: number;
};

type TradingViewShapeOptions = {
  shape: string;
  text?: string;
  lock?: boolean;
  disableSelection?: boolean;
  disableSave?: boolean;
  overrides?: Record<string, string | number | boolean>;
};

type TradingViewEntityId = string | number;

type TradingViewChartApi = {
  createShape?: (
    point: TradingViewShapePoint,
    options: TradingViewShapeOptions
  ) => TradingViewEntityId | Promise<TradingViewEntityId>;
  removeEntity?: (id: TradingViewEntityId) => void;
};

type TradingViewWidgetInstance = {
  remove?: () => void;
  chart?: () => TradingViewChartApi;
  activeChart?: () => TradingViewChartApi;
  onChartReady?: (callback: () => void) => void;
};

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: TradingViewWidgetOptions) => TradingViewWidgetInstance;
    };
  }
}

export {};
