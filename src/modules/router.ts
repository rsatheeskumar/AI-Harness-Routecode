import { RouteCodeDB, Model, PublicBenchmarkRecord, OutcomeEvent, TaskFingerprint, RoutingCandidate } from "../db/db";

export interface BudgetConstraints {
  max_cost_usd?: number;
  max_tokens?: number;
  max_latency_ms?: number;
}

export interface RoutingResult {
  selected_model: Model;
  predicted_success_probability: number;
  expected_cost: number;
  expected_tokens: number;
  reason: string[];
  candidates: Omit<RoutingCandidate, "id" | "decision_id">[];
}

export class ProbabilisticRouter {
  private db: RouteCodeDB;
  private priorStrength = 5.0; // Equates public benchmark weight to 5 personal tasks

  constructor(db: RouteCodeDB) {
    this.db = db;
  }

  /**
   * Estimates default token and cost requirements for a candidate model based on task complexity.
   */
  public estimateRequirements(model: Model, complexity: number) {
    // Standard task base tokens
    const baseInputTokens = 3000;
    const baseOutputTokens = 1500;

    // Scale tokens based on task complexity
    const estimatedInput = Math.floor(baseInputTokens * (0.5 + complexity * 1.5));
    const estimatedOutput = Math.floor(baseOutputTokens * (0.5 + complexity * 1.5));
    const expectedTokens = estimatedInput + estimatedOutput;

    const expectedCost = (estimatedInput * model.input_cost_per_m) / 1000000 + (estimatedOutput * model.output_cost_per_m) / 1000000;

    return {
      expectedTokens,
      expectedCost: Number(expectedCost.toFixed(6)),
      expectedLatencyMs: Math.floor(model.avg_latency_ms * (0.7 + complexity * 0.8))
    };
  }

  /**
   * Selects the optimal model by computing P(success) under budget constraints.
   */
  public route(fingerprint: TaskFingerprint, budget: BudgetConstraints): RoutingResult {
    const models = this.db.getModels();
    const benchmarks = this.db.getPublicBenchmarks();
    const outcomes = this.db.getOutcomeEvents();
    const tasks = this.db.getTasks();
    const taskFpMap = this.db.getFingerprints();

    const candidates: Omit<RoutingCandidate, "id" | "decision_id">[] = [];
    const reasonLog: string[] = [];

    // Map task_family to benchmark category
    const taskFamily = fingerprint.task_family;

    for (const model of models) {
      // 1. Calculate Public Prior
      let priorScore = 0.5; // Neutral default
      let priorSource = "Default uniform distribution";

      // Find relevant benchmark
      const relevantBenchmarks = benchmarks.filter(b => b.model_id === model.id);
      const exactBenchmark = relevantBenchmarks.find(b => b.task_family === taskFamily || (taskFamily === "debugging" && b.task_family === "repository_bug_fix"));
      const fallbackBenchmark = relevantBenchmarks[0];

      if (exactBenchmark) {
        priorScore = exactBenchmark.score;
        priorSource = `Public benchmark (${exactBenchmark.benchmark_name})`;
      } else if (fallbackBenchmark) {
        priorScore = fallbackBenchmark.score * 0.9; // Apply decay for task mismatch
        priorSource = `Public benchmark (${fallbackBenchmark.benchmark_name}) with task-mismatch decay`;
      }

      // 2. Fetch Personal Evidence
      let successes = 0;
      let failures = 0;

      // Filter outcomes for this specific model and similar task family
      outcomes.forEach(out => {
        const correspondingTask = tasks.find(t => t.id === out.task_id);
        if (correspondingTask) {
          const correspondingFp = taskFpMap.find(fp => fp.task_id === correspondingTask.id);
          const correspondingDecision = this.db.getRoutingDecisions().find(d => d.task_id === correspondingTask.id);

          if (correspondingDecision && correspondingDecision.selected_model_id === model.id && correspondingFp && correspondingFp.task_family === taskFamily) {
            if (out.final_outcome === "success") {
              successes++;
            } else {
              failures++;
            }
          }
        }
      });

      // 3. Compute Bayesian Beta-Binomial Update
      const alpha0 = priorScore * this.priorStrength;
      const beta0 = (1.0 - priorScore) * this.priorStrength;

      const alphaPost = alpha0 + successes;
      const betaPost = beta0 + failures;

      const pSuccess = alphaPost / (alphaPost + betaPost);

      // 4. Estimate Cost, Tokens, and Latency
      const reqs = this.estimateRequirements(model, fingerprint.complexity);

      // 5. Evaluate constraints
      let status: RoutingCandidate["status"] = "eligible";
      let filterReason = "";

      if (budget.max_cost_usd !== undefined && reqs.expectedCost > budget.max_cost_usd) {
        status = "filtered";
        filterReason = `Exceeds max cost ($${reqs.expectedCost.toFixed(4)} > $${budget.max_cost_usd})`;
      } else if (budget.max_tokens !== undefined && reqs.expectedTokens > budget.max_tokens) {
        status = "filtered";
        filterReason = `Exceeds token limit (${reqs.expectedTokens} > ${budget.max_tokens})`;
      } else if (budget.max_latency_ms !== undefined && reqs.expectedLatencyMs > budget.max_latency_ms) {
        status = "filtered";
        filterReason = `Exceeds latency budget (${reqs.expectedLatencyMs}ms > ${budget.max_latency_ms}ms)`;
      }

      candidates.push({
        model_id: model.id,
        predicted_success_probability: Number(pSuccess.toFixed(4)),
        expected_cost: reqs.expectedCost,
        expected_tokens: reqs.expectedTokens,
        status,
        reason: status === "filtered" ? filterReason : `Prior: ${priorScore.toFixed(2)} (${priorSource}). Dev evidence: +${successes}s / -${failures}f.`
      });
    }

    // 6. Select highest P(success) eligible model
    const eligibleCandidates = candidates.filter(c => c.status === "eligible");

    if (eligibleCandidates.length === 0) {
      // Budget constraint failure
      const cheapestModel = models.reduce((prev, curr) => prev.input_cost_per_m < curr.input_cost_per_m ? prev : curr);
      return {
        selected_model: cheapestModel,
        predicted_success_probability: 0.0,
        expected_cost: 0,
        expected_tokens: 0,
        reason: ["BUDGET EXCEEDED: No candidate model satisfied the specified cost, token, or latency budgets. Try relaxing your constraints."],
        candidates
      };
    }

    // Sort by predicted probability of success descending
    eligibleCandidates.sort((a, b) => b.predicted_success_probability - a.predicted_success_probability);
    const selectedCandidate = eligibleCandidates[0];
    const selectedModel = models.find(m => m.id === selectedCandidate.model_id)!;

    // Set selected candidate status
    const matchedCandidate = candidates.find(c => c.model_id === selectedCandidate.model_id)!;
    matchedCandidate.status = "selected";

    // Formulate clean natural routing explanations
    const priorMatch = benchmarks.find(b => b.model_id === selectedModel.id && (b.task_family === taskFamily || (taskFamily === "debugging" && b.task_family === "repository_bug_fix")));
    const priorVal = priorMatch ? priorMatch.score : 0.5;

    // Filter outcomes for the selected model to summarize in text
    let successes = 0;
    let failures = 0;
    outcomes.forEach(out => {
      const correspondingTask = tasks.find(t => t.id === out.task_id);
      if (correspondingTask) {
        const correspondingFp = taskFpMap.find(fp => fp.task_id === correspondingTask.id);
        const correspondingDecision = this.db.getRoutingDecisions().find(d => d.task_id === correspondingTask.id);
        if (correspondingDecision && correspondingDecision.selected_model_id === selectedModel.id && correspondingFp && correspondingFp.task_family === taskFamily) {
          if (out.final_outcome === "success") successes++; else failures++;
        }
      }
    });

    reasonLog.push(`Robust ${selectedModel.name} selected as the optimal coding choice with a predicted success probability of ${(selectedCandidate.predicted_success_probability * 100).toFixed(1)}%.`);
    reasonLog.push(`Starting from a task-family prior score of ${(priorVal * 100).toFixed(1)}% based on ${priorMatch ? priorMatch.benchmark_name : "default priors"}.`);
    if (successes > 0 || failures > 0) {
      reasonLog.push(`Bayesian update applied with your personal evidence profile: ${successes} successes, ${failures} failures for model ${selectedModel.name} on ${taskFamily} tasks.`);
    } else {
      reasonLog.push(`No personal outcomes observed yet for ${selectedModel.name} on ${taskFamily} tasks. Relying strictly on public benchmark priors.`);
    }
    reasonLog.push(`Estimated cost is $${selectedCandidate.expected_cost.toFixed(4)} and size is ${selectedCandidate.expected_tokens} tokens, which fully satisfies your requested budget constraints.`);

    return {
      selected_model: selectedModel,
      predicted_success_probability: selectedCandidate.predicted_success_probability,
      expected_cost: selectedCandidate.expected_cost,
      expected_tokens: selectedCandidate.expected_tokens,
      reason: reasonLog,
      candidates
    };
  }
}
