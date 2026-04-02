import type { ApexConfig } from "@/src/lib/config";
import { createId } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import type { ApexRepository } from "@/src/lib/repository";
import { getRecentSignalLogs, updateSignalOutcome } from "@/src/lib/signalLogger";
import { TelegramNotifier } from "@/src/lib/telegram";
import type {
  AllocationIntent,
  ChildOrderPlan,
  ExecutionIntent,
  ExecutionReport,
  ExecutionStyle,
  GatingPodOutput,
  SignalLifecycleEvent,
  SignalLifecycleRecord,
  SignalLifecycleState,
} from "@/src/interfaces/contracts";

type CandlePathBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  timestampClose: number;
};

export interface IVenueConnector {
  placeOrders(orders: ChildOrderPlan[]): Promise<Array<{ orderId: string; status: "filled" | "rejected"; fillPrice?: number }>>;
}

interface ExecutionStrategy {
  plan(intent: ExecutionIntent): ChildOrderPlan[];
}

class PassiveJoinStrategy implements ExecutionStrategy {
  plan(intent: ExecutionIntent): ChildOrderPlan[] {
    return [{
      child_order_id: createId("child"),
      intent_id: intent.intent_id,
      ts: Date.now(),
      symbol_canonical: intent.symbol_canonical,
      side: intent.side,
      size: intent.target_size,
      execution_style: "passive",
      expected_slippage_bps: intent.slippage_budget_bps * 0.35,
      status: "planned",
      notes: "Join top of book and wait.",
    }];
  }
}

class AdaptiveVWAPStrategy implements ExecutionStrategy {
  plan(intent: ExecutionIntent): ChildOrderPlan[] {
    return [0.4, 0.35, 0.25].map(slice => ({
      child_order_id: createId("child"),
      intent_id: intent.intent_id,
      ts: Date.now(),
      symbol_canonical: intent.symbol_canonical,
      side: intent.side,
      size: intent.target_size * slice,
      execution_style: "vwap",
      expected_slippage_bps: intent.slippage_budget_bps * 0.6,
      status: "planned",
      notes: `Adaptive VWAP slice ${slice}`,
    }));
  }
}

class UrgencySweepStrategy implements ExecutionStrategy {
  plan(intent: ExecutionIntent): ChildOrderPlan[] {
    return [{
      child_order_id: createId("child"),
      intent_id: intent.intent_id,
      ts: Date.now(),
      symbol_canonical: intent.symbol_canonical,
      side: intent.side,
      size: intent.target_size,
      execution_style: "sweep",
      expected_slippage_bps: intent.slippage_budget_bps,
      status: "planned",
      notes: "Aggressive sweep due to urgency.",
    }];
  }
}

function gaussian(mean = 0, sigma = 1): number {
  const left = 1 - Math.random();
  const right = 1 - Math.random();
  const normal = Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
  return mean + normal * sigma;
}

function preferExecutionStyle(advisory?: GatingPodOutput): ExecutionStyle {
  const constraintStyle = typeof advisory?.constraints.preferred_execution_style === "string"
    ? advisory.constraints.preferred_execution_style
    : undefined;
  const preferred = advisory?.preferred_execution_style ?? constraintStyle;
  if (preferred === "passive" || preferred === "vwap" || preferred === "twap" || preferred === "is" || preferred === "sweep" || preferred === "participation") {
    return preferred;
  }
  return "passive";
}

function addLifecycleEvent(record: SignalLifecycleRecord, state: SignalLifecycleState, detail: string, ts: number): SignalLifecycleRecord {
  const event: SignalLifecycleEvent = { ts, state, detail };
  return {
    ...record,
    state,
    updated_ts: ts,
    events: [...record.events, event],
  };
}

function segmentHitsLevel(start: number, end: number, level: number): boolean {
  return (start <= level && end >= level) || (start >= level && end <= level);
}

function candlePath(bar: CandlePathBar): number[] {
  if (bar.close >= bar.open) {
    return [bar.open, bar.low, bar.high, bar.close];
  }

  return [bar.open, bar.high, bar.low, bar.close];
}

type LoggedSignalOutcome = "stopped_out" | "hit_tp1" | "hit_tp2" | "hit_tp3" | "expired" | "cancelled";

function resolveLoggedOutcome(record: SignalLifecycleRecord): LoggedSignalOutcome | null {
  switch (record.state) {
    case "stopped_out":
      return "stopped_out";
    case "tp1_hit":
      return "hit_tp1";
    case "tp2_hit":
      return "hit_tp2";
    case "tp3_hit":
      return "hit_tp3";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

function resolveLoggedOutcomePrice(record: SignalLifecycleRecord, outcome: LoggedSignalOutcome): number | undefined {
  switch (outcome) {
    case "stopped_out":
      return record.sl;
    case "hit_tp1":
      return record.tp1;
    case "hit_tp2":
      return record.tp2 ?? undefined;
    case "hit_tp3":
      return record.tp3 ?? undefined;
    case "expired":
    case "cancelled":
      return record.entry;
    default:
      return undefined;
  }
}

export class ExecutionOrchestrator {
  private readonly strategies = new Map<string, ExecutionStrategy>([
    ["passive", new PassiveJoinStrategy()],
    ["vwap", new AdaptiveVWAPStrategy()],
    ["twap", new AdaptiveVWAPStrategy()],
    ["is", new AdaptiveVWAPStrategy()],
    ["participation", new AdaptiveVWAPStrategy()],
    ["sweep", new UrgencySweepStrategy()],
  ]);

  constructor(
    private readonly repository: ApexRepository,
    private readonly config: ApexConfig,
    private readonly notifier: TelegramNotifier,
    private readonly venueConnector?: IVenueConnector,
  ) {}

  private async syncSignalOutcome(record: SignalLifecycleRecord, previous?: SignalLifecycleRecord): Promise<void> {
    const outcome = resolveLoggedOutcome(record);
    if (!outcome) {
      return;
    }

    if (previous && previous.state === record.state && previous.outcome === record.outcome) {
      return;
    }

    const recentLogs = await getRecentSignalLogs(record.symbol_canonical, 10);
    const target = recentLogs.find(log => log.outcome == null) ?? recentLogs[0];
    if (!target) {
      return;
    }

    await updateSignalOutcome(
      target.id,
      outcome,
      resolveLoggedOutcomePrice(record, outcome),
    );
  }

  buildExecutionIntent(input: {
    candidate: AllocationIntent;
    advisory?: GatingPodOutput;
  }): ExecutionIntent | null {
    if (input.candidate.direction !== "buy" && input.candidate.direction !== "sell") {
      return null;
    }
    if (!input.candidate.trade_plan) {
      return null;
    }

    return {
      intent_id: createId("exec"),
      signal_id: input.candidate.candidate_id,
      ts: Date.now(),
      symbol_canonical: input.candidate.symbol_canonical,
      side: input.candidate.direction,
      timeframe: input.candidate.timeframe,
      entry_style: input.candidate.entry_style,
      target_size: Math.abs(input.candidate.target_position),
      urgency: Math.min(1, 0.35 + input.candidate.confidence * 0.5),
      execution_style: preferExecutionStyle(input.advisory),
      slippage_budget_bps: this.config.maxSlippageBps,
      lifecycle_state: "signal_created",
      trade_plan: input.candidate.trade_plan,
      constraints: {
        max_participation_rate: 0.25,
        spread_limit_bps: 30,
        blackout_active: this.repository.getRecoveryMode() === "full_stop",
      },
      fallback_style: "passive",
    };
  }

  private createLifecycle(intent: ExecutionIntent): SignalLifecycleRecord {
    return {
      signal_id: intent.signal_id,
      symbol_canonical: intent.symbol_canonical,
      direction: intent.side,
      timeframe: intent.timeframe,
      entry_style: intent.entry_style,
      created_ts: intent.ts,
      updated_ts: intent.ts,
      expires_at: intent.trade_plan.expires_at,
      state: "signal_created",
      outcome: "pending",
      entry: intent.trade_plan.entry,
      sl: intent.trade_plan.sl,
      tp1: intent.trade_plan.tp1,
      tp2: intent.trade_plan.tp2,
      tp3: intent.trade_plan.tp3,
      max_favorable_excursion: 0,
      max_adverse_excursion: 0,
      events: [{
        ts: intent.ts,
        state: "signal_created",
        detail: "Signal created and queued for paper execution.",
      }],
    };
  }

  private updateLifecycleWithBar(record: SignalLifecycleRecord, bar: CandlePathBar): SignalLifecycleRecord {
    if (["tp3_hit", "stopped_out", "expired", "cancelled"].includes(record.state)) {
      return record;
    }

    let next = { ...record };
    const favorableMove = record.direction === "buy" ? bar.high - record.entry : record.entry - bar.low;
    const adverseMove = record.direction === "buy" ? record.entry - bar.low : bar.high - record.entry;
    next.max_favorable_excursion = Math.max(next.max_favorable_excursion, favorableMove);
    next.max_adverse_excursion = Math.max(next.max_adverse_excursion, adverseMove);

    if (bar.timestampClose >= record.expires_at && ["signal_created", "pending_trigger"].includes(record.state)) {
      next = addLifecycleEvent(next, "expired", "Signal expired before entry activation.", bar.timestampClose);
      next.outcome = "expired";
      next.completed_ts = bar.timestampClose;
      return next;
    }

    const path = candlePath(bar);
    const activatedAlready = ["activated", "tp1_hit", "tp2_hit"].includes(record.state);
    let activated = activatedAlready;

    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index];
      const end = path[index + 1];

      if (!activated && segmentHitsLevel(start, end, record.entry)) {
        next = addLifecycleEvent(next, "activated", "Signal entry was triggered.", bar.timestampClose);
        next.activated_ts ??= bar.timestampClose;
        next.outcome = "open";
        activated = true;
      }

      if (!activated) {
        continue;
      }

      const stopHit = segmentHitsLevel(start, end, record.sl);
      const tp1Hit = segmentHitsLevel(start, end, record.tp1);
      const tp2Hit = record.tp2 != null && segmentHitsLevel(start, end, record.tp2);
      const tp3Hit = record.tp3 != null && segmentHitsLevel(start, end, record.tp3);

      if (stopHit) {
        next = addLifecycleEvent(next, "stopped_out", "Stop loss hit first on the candle path.", bar.timestampClose);
        next.outcome = "stopped_out";
        next.completed_ts = bar.timestampClose;
        next.time_to_sl_ms = bar.timestampClose - next.created_ts;
        return next;
      }
      if (tp1Hit && next.state === "activated") {
        next = addLifecycleEvent(next, "tp1_hit", "First target hit after activation.", bar.timestampClose);
        next.outcome = "tp1_hit";
        next.time_to_tp1_ms ??= bar.timestampClose - next.created_ts;
      }
      if (tp2Hit && (next.state === "tp1_hit" || next.state === "activated")) {
        next = addLifecycleEvent(next, "tp2_hit", "Second target hit after activation.", bar.timestampClose);
        next.outcome = "tp2_hit";
      }
      if (tp3Hit) {
        next = addLifecycleEvent(next, "tp3_hit", "Third target hit after activation.", bar.timestampClose);
        next.outcome = "tp3_hit";
        next.completed_ts = bar.timestampClose;
        return next;
      }
    }

    if (!activatedAlready && next.state === "signal_created") {
      next = addLifecycleEvent(next, "pending_trigger", "Signal is live but not yet activated.", bar.timestampClose);
      next.outcome = "pending";
    }

    return next;
  }

  async advanceSignalLifecycles(symbol: string, bars: CandlePathBar[]): Promise<SignalLifecycleRecord[]> {
    const records = this.repository.getSignalLifecycles({
      symbol,
      activeOnly: true,
      limit: 25,
    }).reverse();
    if (records.length === 0 || bars.length === 0) {
      return [];
    }

    const updated: SignalLifecycleRecord[] = [];
    for (const record of records) {
      let next = { ...record };
      for (const bar of bars) {
        if (bar.timestampClose <= next.updated_ts) {
          continue;
        }
        next = this.updateLifecycleWithBar(next, bar);
      }
      await this.repository.upsertSignalLifecycle(next);
      await this.syncSignalOutcome(next, record);
      updated.push(next);
    }
    return updated;
  }

  async execute(intent: ExecutionIntent, bars: CandlePathBar[]): Promise<ExecutionReport> {
    const strategy = this.strategies.get(intent.execution_style) ?? this.strategies.get(intent.fallback_style) ?? new PassiveJoinStrategy();
    const childOrders = strategy.plan(intent);
    let lifecycle = this.createLifecycle(intent);
    await this.repository.appendExecutionIntent(intent);
    await this.repository.appendChildOrders(childOrders);

    if (intent.constraints.blackout_active || this.repository.isKillSwitchActive()) {
      lifecycle = addLifecycleEvent(lifecycle, "cancelled", "Execution cancelled by blackout or kill switch.", Date.now());
      lifecycle.outcome = "cancelled";
      lifecycle.completed_ts = lifecycle.updated_ts;
      await this.repository.appendSignalLifecycle(lifecycle);
      await this.syncSignalOutcome(lifecycle);
      this.repository.recordExecutionHealth(intent.symbol_canonical, intent.slippage_budget_bps, true);
      return {
        intent,
        child_orders: childOrders.map(order => ({ ...order, status: "rejected" })),
        lifecycle,
        rejected: true,
      };
    }

    if (this.config.mode === "live" && this.venueConnector) {
      const results = await this.venueConnector.placeOrders(childOrders);
      const rejected = results.some(result => result.status === "rejected");
      if (rejected) {
        this.repository.recordExecutionHealth(intent.symbol_canonical, intent.slippage_budget_bps, true);
        lifecycle = addLifecycleEvent(lifecycle, "cancelled", "Venue rejected one or more child orders.", Date.now());
        lifecycle.outcome = "cancelled";
      } else {
        lifecycle = addLifecycleEvent(lifecycle, "activated", "Venue accepted child orders.", Date.now());
        lifecycle.outcome = "open";
      }
      await this.repository.appendSignalLifecycle(lifecycle);
      await this.syncSignalOutcome(lifecycle);
      return {
        intent,
        child_orders: childOrders,
        lifecycle,
        rejected,
      };
    }

    const simulatedSlippageBps = Math.abs(gaussian(Math.max(0.5, intent.urgency * 3), 0.75));
    const simulatedFillPrice = intent.side === "buy"
      ? intent.trade_plan.entry * (1 + simulatedSlippageBps / 10_000)
      : intent.trade_plan.entry * (1 - simulatedSlippageBps / 10_000);
    this.repository.recordExecutionHealth(intent.symbol_canonical, simulatedSlippageBps, false);
    this.repository.updatePosition(intent.symbol_canonical, intent.side === "buy" ? intent.target_size : -intent.target_size);

    for (const bar of bars) {
      lifecycle = this.updateLifecycleWithBar(lifecycle, bar);
    }
    await this.repository.appendSignalLifecycle(lifecycle);
    await this.syncSignalOutcome(lifecycle);

    if (simulatedSlippageBps > intent.slippage_budget_bps) {
      void this.notifier.sendMessage(
        `APEX execution alert\n${intent.symbol_canonical} slippage ${simulatedSlippageBps.toFixed(2)}bps exceeded budget ${intent.slippage_budget_bps.toFixed(2)}bps`,
      );
      logger.warn({
        module: "execution",
        message: "Slippage budget breached",
        symbol: intent.symbol_canonical,
        slippage_bps: simulatedSlippageBps,
        budget_bps: intent.slippage_budget_bps,
      });
    }

    return {
      intent,
      child_orders: childOrders.map(order => ({ ...order, status: "filled" })),
      lifecycle,
      simulated_fill_price: simulatedFillPrice,
      simulated_slippage_bps: simulatedSlippageBps,
      rejected: lifecycle.state === "cancelled",
    };
  }
}
