import { executeApexCycle, type ApexCycleExecutionOptions, type CycleResult } from "@/src/application/cycle/runCycle";
import type { AuditJournal } from "@/src/audit/AuditJournal";
import type { PortfolioAllocator } from "@/src/allocator/PortfolioAllocator";
import type { DataPlant } from "@/src/data-plant/DataPlant";
import { RiskEngine } from "@/src/domain/risk/RiskEngine";
import { ExecutionFeasibilityRiskModule } from "@/src/domain/risk/modules/ExecutionFeasibilityRiskModule";
import { LegacyRiskParityModule } from "@/src/domain/risk/modules/LegacyRiskParityModule";
import { MarketConditionsRiskModule } from "@/src/domain/risk/modules/MarketConditionsRiskModule";
import { PolicyRulesRiskModule } from "@/src/domain/risk/modules/PolicyRulesRiskModule";
import { PortfolioRiskModule } from "@/src/domain/risk/modules/PortfolioRiskModule";
import type { ExecutionOrchestrator } from "@/src/execution/ExecutionOrchestrator";
import type { FeatureEngine } from "@/src/feature-engine/FeatureEngine";
import type { DriftMonitor } from "@/src/learning/DriftMonitor";
import type { ApexConfig } from "@/src/lib/config";
import { logger } from "@/src/lib/logger";
import type { ApexRepository } from "@/src/lib/repository";
import { TelegramNotifier } from "@/src/lib/telegram";
import type { IAlphaPod, ModuleHealth } from "@/src/interfaces/contracts";
import type { OpsManager } from "@/src/ops/OpsManager";
import type { RiskGovernor } from "@/src/risk/RiskGovernor";

export class ApexEngine {
  private readonly riskEngine: RiskEngine;
  private cycleRunning = false;
  private activeCyclePromise: Promise<CycleResult> | null = null;

  constructor(
    private readonly config: ApexConfig,
    private readonly repository: ApexRepository,
    private readonly dataPlant: DataPlant,
    private readonly featureEngine: FeatureEngine,
    private readonly pods: IAlphaPod[],
    private readonly allocator: PortfolioAllocator,
    private readonly riskGovernor: RiskGovernor,
    private readonly execution: ExecutionOrchestrator,
    private readonly driftMonitor: DriftMonitor,
    private readonly auditJournal: AuditJournal,
    private readonly ops: OpsManager,
    private readonly notifier: TelegramNotifier,
  ) {
    this.riskEngine = new RiskEngine(
      new LegacyRiskParityModule(this.riskGovernor),
      [
        new PortfolioRiskModule(),
        new MarketConditionsRiskModule(),
        new ExecutionFeasibilityRiskModule(),
        new PolicyRulesRiskModule(),
      ],
    );
  }

  start(): void {
    // Manual-only deployment: cycles run only from explicit API route requests.
  }

  async stop(): Promise<void> {
    // Manual-only deployment: no background workers or cron tasks to stop.
  }

  queueCycle = async (source = "manual", options?: ApexCycleExecutionOptions): Promise<{ queued: boolean; jobId?: string; result?: CycleResult }> => {
    logger.info({
      module: "engine",
      message: this.cycleRunning ? "Joining running cycle inline" : "Running cycle inline",
      source,
      reason: this.cycleRunning ? "cycle_already_running" : undefined,
    });

    return {
      queued: false,
      result: await this.runCycle(options),
    };
  };

  getModuleHealth(): ModuleHealth[] {
    return [
      { module: "data-plant", status: "healthy", detail: "Feed intake active", updated_at: Date.now() },
      { module: "feature-engine", status: "healthy", detail: "Feature snapshots active", updated_at: Date.now() },
      { module: "pods", status: "healthy", detail: `${this.pods.filter(pod => pod.getStatus() === "active").length} active`, updated_at: Date.now() },
      { module: "allocator", status: "healthy", detail: "Signal candidate assembly active", updated_at: Date.now() },
      { module: "risk", status: this.repository.isKillSwitchActive() ? "halted" : "healthy", detail: "Signal quality governor active", updated_at: Date.now() },
      { module: "execution", status: this.repository.getRecoveryMode() === "full_stop" ? "halted" : "healthy", detail: "Signal lifecycle execution active", updated_at: Date.now() },
      { module: "learning", status: "healthy", detail: "Drift monitor isolated", updated_at: Date.now() },
    ];
  }

  getPods(): IAlphaPod[] {
    return this.pods;
  }

  getOpsManager(): OpsManager {
    return this.ops;
  }

  runCycle = async (options?: ApexCycleExecutionOptions): Promise<CycleResult> => {
    if (this.activeCyclePromise) {
      logger.info({
        module: "engine",
        message: "Cycle already running; joining active cycle",
        reason: "cycle_already_running",
      });
      return this.activeCyclePromise;
    }

    this.cycleRunning = true;
    this.activeCyclePromise = executeApexCycle({
      config: this.config,
      repository: this.repository,
      dataPlant: this.dataPlant,
      featureEngine: this.featureEngine,
      pods: this.pods,
      allocator: this.allocator,
      riskEngine: this.riskEngine,
      riskGovernor: this.riskGovernor,
      execution: this.execution,
      driftMonitor: this.driftMonitor,
      auditJournal: this.auditJournal,
      notifier: this.notifier,
      executionOptions: options,
    }).finally(() => {
      this.cycleRunning = false;
      this.activeCyclePromise = null;
    });

    return this.activeCyclePromise;
  };
}
