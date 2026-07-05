import fs from "fs";
import path from "path";

// Define Interfaces for Database Entities
export interface Developer {
  id: string;
  name: string;
  email: string;
  level: string;
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  language: string;
}

export interface Model {
  id: string; // e.g. "openai/gpt-4o", "anthropic/claude-3-5-sonnet"
  provider: "OpenAI" | "Anthropic" | "Google";
  name: string;
  input_cost_per_m: number; // USD per million tokens
  output_cost_per_m: number; // USD per million tokens
  avg_latency_ms: number;
}

export interface PublicBenchmarkRecord {
  id: string;
  benchmark_name: string;
  task_family: "debugging" | "code_generation" | "testing" | "repository_bug_fix";
  language: string;
  model_id: string;
  score: number; // 0.0 to 1.0
  source_url: string;
  measured_date: string;
  confidence: number;
}

export interface CodingTask {
  id: string;
  developer_id: string;
  repository_id: string;
  prompt: string;
  status: "fingerprinted" | "routed" | "executed" | "evaluated" | "failed";
  created_at: string;
}

export interface TaskFingerprint {
  id: string;
  task_id: string;
  agent_type: "CODE" | "DEBUG" | "TEST";
  agent_confidence: number;
  skills: Record<string, number>; // e.g. { "python": 0.98, "fastapi": 0.85 }
  task_family: "debugging" | "code_generation" | "testing";
  complexity: number;
  risk: number;
  context_need: number;
}

export interface RoutingCandidate {
  id: string;
  decision_id: string;
  model_id: string;
  predicted_success_probability: number;
  expected_cost: number;
  expected_tokens: number;
  status: "filtered" | "eligible" | "selected";
  reason: string;
}

export interface RoutingDecision {
  id: string;
  task_id: string;
  selected_model_id: string;
  predicted_success_probability: number;
  expected_cost: number;
  expected_tokens: number;
  reason: string[];
  created_at: string;
  candidates: RoutingCandidate[];
}

export interface ModelExecution {
  id: string;
  decision_id: string;
  provider: string;
  model: string;
  response: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  latency_ms: number;
  error_info?: string;
  created_at: string;
}

export interface EvaluationResult {
  id: string;
  execution_id: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  passed: boolean;
  created_at: string;
}

export interface OutcomeEvent {
  id: string;
  task_id: string;
  final_outcome: "success" | "failure";
  tests_passed: boolean;
  build_passed: boolean;
  lint_passed: boolean;
  human_edits: boolean;
  retry_count: number;
  created_at: string;
}

// Full Database Schema Interface
export interface DBStore {
  developers: Developer[];
  repositories: Repository[];
  models: Model[];
  public_benchmark_records: PublicBenchmarkRecord[];
  coding_tasks: CodingTask[];
  task_fingerprints: TaskFingerprint[];
  routing_decisions: RoutingDecision[];
  model_executions: ModelExecution[];
  evaluation_results: EvaluationResult[];
  outcome_events: OutcomeEvent[];
}

const DB_PATH = path.join(process.cwd(), "src", "db", "routecode_db.json");

export class RouteCodeDB {
  private data: DBStore;

  constructor() {
    this.data = this.load();
  }

  private load(): DBStore {
    try {
      if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH, "utf-8");
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error("Failed to load DB, initializing fresh store", e);
    }
    return this.initializeAndSave();
  }

  private save() {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save DB", e);
    }
  }

  private initializeAndSave(): DBStore {
    const models: Model[] = [
      { id: "anthropic/claude-3-5-sonnet", provider: "Anthropic", name: "claude-3-5-sonnet", input_cost_per_m: 3.0, output_cost_per_m: 15.0, avg_latency_ms: 2800 },
      { id: "openai/gpt-4o", provider: "OpenAI", name: "gpt-4o", input_cost_per_m: 5.0, output_cost_per_m: 15.0, avg_latency_ms: 2200 },
      { id: "google/gemini-3-1-pro", provider: "Google", name: "gemini-3.1-pro", input_cost_per_m: 1.25, output_cost_per_m: 5.0, avg_latency_ms: 1800 },
      { id: "google/gemini-3-5-flash", provider: "Google", name: "gemini-3.5-flash", input_cost_per_m: 0.075, output_cost_per_m: 0.30, avg_latency_ms: 700 },
      { id: "openai/gpt-4o-mini", provider: "OpenAI", name: "gpt-4o-mini", input_cost_per_m: 0.15, output_cost_per_m: 0.60, avg_latency_ms: 900 }
    ];

    const public_benchmark_records: PublicBenchmarkRecord[] = [
      // SWE-bench (bug fix repository-level)
      { id: "b1", benchmark_name: "SWE-bench", task_family: "repository_bug_fix", language: "python", model_id: "anthropic/claude-3-5-sonnet", score: 0.49, source_url: "https://www.swebench.com", measured_date: "2025-11-15", confidence: 0.95 },
      { id: "b2", benchmark_name: "SWE-bench", task_family: "repository_bug_fix", language: "python", model_id: "openai/gpt-4o", score: 0.38, source_url: "https://www.swebench.com", measured_date: "2025-11-15", confidence: 0.95 },
      { id: "b3", benchmark_name: "SWE-bench", task_family: "repository_bug_fix", language: "python", model_id: "google/gemini-3-1-pro", score: 0.35, source_url: "https://www.swebench.com", measured_date: "2025-12-01", confidence: 0.90 },
      { id: "b4", benchmark_name: "SWE-bench", task_family: "repository_bug_fix", language: "python", model_id: "openai/gpt-4o-mini", score: 0.21, source_url: "https://www.swebench.com", measured_date: "2025-11-15", confidence: 0.95 },
      { id: "b5", benchmark_name: "SWE-bench", task_family: "repository_bug_fix", language: "python", model_id: "google/gemini-3-5-flash", score: 0.19, source_url: "https://www.swebench.com", measured_date: "2025-12-01", confidence: 0.90 },

      // HumanEval (Python code generation)
      { id: "b6", benchmark_name: "HumanEval", task_family: "code_generation", language: "python", model_id: "anthropic/claude-3-5-sonnet", score: 0.92, source_url: "https://github.com/openai/human-eval", measured_date: "2025-10-10", confidence: 0.98 },
      { id: "b7", benchmark_name: "HumanEval", task_family: "code_generation", language: "python", model_id: "openai/gpt-4o", score: 0.90, source_url: "https://github.com/openai/human-eval", measured_date: "2025-10-10", confidence: 0.98 },
      { id: "b8", benchmark_name: "HumanEval", task_family: "code_generation", language: "python", model_id: "google/gemini-3-1-pro", score: 0.88, source_url: "https://github.com/openai/human-eval", measured_date: "2025-11-01", confidence: 0.95 },
      { id: "b9", benchmark_name: "HumanEval", task_family: "code_generation", language: "python", model_id: "google/gemini-3-5-flash", score: 0.82, source_url: "https://github.com/openai/human-eval", measured_date: "2025-11-01", confidence: 0.95 },
      { id: "b10", benchmark_name: "HumanEval", task_family: "code_generation", language: "python", model_id: "openai/gpt-4o-mini", score: 0.80, source_url: "https://github.com/openai/human-eval", measured_date: "2025-10-10", confidence: 0.98 },

      // Pytest-Eval (Testing & Debugging)
      { id: "b11", benchmark_name: "Pytest-Eval", task_family: "testing", language: "python", model_id: "anthropic/claude-3-5-sonnet", score: 0.85, source_url: "https://example.com/pytest-eval", measured_date: "2025-12-05", confidence: 0.85 },
      { id: "b12", benchmark_name: "Pytest-Eval", task_family: "testing", language: "python", model_id: "openai/gpt-4o", score: 0.82, source_url: "https://example.com/pytest-eval", measured_date: "2025-12-05", confidence: 0.85 },
      { id: "b13", benchmark_name: "Pytest-Eval", task_family: "testing", language: "python", model_id: "google/gemini-3-1-pro", score: 0.78, source_url: "https://example.com/pytest-eval", measured_date: "2025-12-05", confidence: 0.85 },
      { id: "b14", benchmark_name: "Pytest-Eval", task_family: "testing", language: "python", model_id: "google/gemini-3-5-flash", score: 0.74, source_url: "https://example.com/pytest-eval", measured_date: "2025-12-05", confidence: 0.85 },
      { id: "b15", benchmark_name: "Pytest-Eval", task_family: "testing", language: "python", model_id: "openai/gpt-4o-mini", score: 0.70, source_url: "https://example.com/pytest-eval", measured_date: "2025-12-05", confidence: 0.85 }
    ];

    const developers: Developer[] = [
      { id: "dev-1", name: "Lead AI Engineer", email: "rsatheeskumar@gmail.com", level: "Principal Architect" }
    ];

    const repositories: Repository[] = [
      { id: "repo-1", name: "fastapi-service", path: "/routecode/apps/api", language: "python" }
    ];

    // Seeding outcomes for historical learning data
    // Let's seed 15 outcome records with logical metrics.
    const coding_tasks: CodingTask[] = [];
    const task_fingerprints: TaskFingerprint[] = [];
    const routing_decisions: RoutingDecision[] = [];
    const model_executions: ModelExecution[] = [];
    const evaluation_results: EvaluationResult[] = [];
    const outcome_events: OutcomeEvent[] = [];

    // Generates seeded outcome history
    const seedTask = (
      id: string,
      prompt: string,
      agentType: "CODE" | "DEBUG" | "TEST",
      skills: Record<string, number>,
      taskFamily: "debugging" | "code_generation" | "testing",
      modelId: string,
      success: boolean,
      cost: number,
      tokens: number,
      daysAgo: number
    ) => {
      const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
      
      const task: CodingTask = {
        id,
        developer_id: "dev-1",
        repository_id: "repo-1",
        prompt,
        status: "evaluated",
        created_at: date
      };

      const fingerprint: TaskFingerprint = {
        id: `fp-${id}`,
        task_id: id,
        agent_type: agentType,
        agent_confidence: 0.90,
        skills,
        task_family: taskFamily,
        complexity: 0.65,
        risk: 0.50,
        context_need: 0.70
      };

      const decision: RoutingDecision = {
        id: `dec-${id}`,
        task_id: id,
        selected_model_id: modelId,
        predicted_success_probability: success ? 0.78 : 0.42,
        expected_cost: cost,
        expected_tokens: tokens,
        reason: ["Seeded database history"],
        created_at: date,
        candidates: []
      };

      const execution: ModelExecution = {
        id: `exec-${id}`,
        decision_id: `dec-${id}`,
        provider: modelId.split("/")[0],
        model: modelId.split("/")[1],
        response: success ? "Mocked fully working seeded success code." : "Mocked faulty seeded failure code.",
        input_tokens: Math.floor(tokens * 0.4),
        output_tokens: Math.floor(tokens * 0.6),
        estimated_cost: cost,
        latency_ms: 1000 + Math.random() * 2000,
        created_at: date
      };

      const evaluation: EvaluationResult = {
        id: `eval-${id}`,
        execution_id: `exec-${id}`,
        command: "pytest tests/",
        exit_code: success ? 0 : 1,
        stdout: success ? "15 passed in 0.42s" : "AssertionError: expected 200, got 500",
        stderr: "",
        duration_ms: 1200,
        passed: success,
        created_at: date
      };

      const outcome: OutcomeEvent = {
        id: `out-${id}`,
        task_id: id,
        final_outcome: success ? "success" : "failure",
        tests_passed: success,
        build_passed: success,
        lint_passed: success,
        human_edits: !success,
        retry_count: success ? 0 : 2,
        created_at: date
      };

      coding_tasks.push(task);
      task_fingerprints.push(fingerprint);
      routing_decisions.push(decision);
      model_executions.push(execution);
      evaluation_results.push(evaluation);
      outcome_events.push(outcome);
    };

    // Seed data points: Let's create a narrative of model capabilities.
    // Claude is highly successful in debugging & testing
    seedTask("t1", "Fix user login routing bug", "DEBUG", { python: 0.98, fastapi: 0.90 }, "debugging", "anthropic/claude-3-5-sonnet", true, 0.045, 6000, 10);
    seedTask("t2", "Write unit tests for checkout workflow", "TEST", { typescript: 0.95, react: 0.90 }, "testing", "anthropic/claude-3-5-sonnet", true, 0.052, 7000, 9);
    seedTask("t3", "Debug race condition in SQL database connection pool", "DEBUG", { python: 0.95, sql: 0.90 }, "debugging", "anthropic/claude-3-5-sonnet", true, 0.038, 5000, 8);
    seedTask("t4", "Implement item retrieval cache", "CODE", { python: 0.90 }, "code_generation", "anthropic/claude-3-5-sonnet", true, 0.030, 4000, 7);

    // GPT-4o has strong code generation, but occasionally fails in nested debugging
    seedTask("t5", "Generate standard user CRUD controller", "CODE", { python: 0.95, fastapi: 0.95 }, "code_generation", "openai/gpt-4o", true, 0.040, 5000, 10);
    seedTask("t6", "Fix SQL group by query aggregation bug", "DEBUG", { sql: 0.98 }, "debugging", "openai/gpt-4o", true, 0.032, 4000, 8);
    seedTask("t7", "Add regression tests for payment stripe adapter", "TEST", { python: 0.90 }, "testing", "openai/gpt-4o", false, 0.048, 6000, 6);
    seedTask("t8", "Build email sender integration module", "CODE", { python: 0.90 }, "code_generation", "openai/gpt-4o", true, 0.032, 4000, 5);

    // Gemini 3.1 Pro: highly reliable and fast
    seedTask("t9", "Implement JWT bearer authorization dependency", "CODE", { python: 0.98, fastapi: 0.95 }, "code_generation", "google/gemini-3-1-pro", true, 0.012, 5000, 10);
    seedTask("t10", "Write tests for product validation models", "TEST", { python: 0.90, fastapi: 0.90 }, "testing", "google/gemini-3-1-pro", true, 0.010, 4500, 8);
    seedTask("t11", "Debug connection timeout in websocket middleware", "DEBUG", { python: 0.95 }, "debugging", "google/gemini-3-1-pro", true, 0.015, 6000, 4);

    // Gemini 3.5 Flash: highly economical, perfect for simple tasks, but fails on hard debugging
    seedTask("t12", "Implement health-check endpoint", "CODE", { python: 0.95, fastapi: 0.95 }, "code_generation", "google/gemini-3-5-flash", true, 0.0006, 2000, 9);
    seedTask("t13", "Generate simple mock item dataset", "CODE", { python: 0.90 }, "code_generation", "google/gemini-3-5-flash", true, 0.0008, 2500, 7);
    seedTask("t14", "Debug complex Pydantic validation error with recursive models", "DEBUG", { python: 0.98, fastapi: 0.90 }, "debugging", "google/gemini-3-5-flash", false, 0.0012, 4000, 5);

    // GPT-4o mini: affordable and reliable
    seedTask("t15", "Write basic fixture config for Pytest", "TEST", { python: 0.90 }, "testing", "openai/gpt-4o-mini", true, 0.0018, 3000, 3);

    this.data = {
      developers,
      repositories,
      models,
      public_benchmark_records,
      coding_tasks,
      task_fingerprints,
      routing_decisions,
      model_executions,
      evaluation_results,
      outcome_events
    };

    this.save();
    return this.data;
  }

  // Getters
  public getModels(): Model[] {
    return this.data.models;
  }

  public getPublicBenchmarks(): PublicBenchmarkRecord[] {
    return this.data.public_benchmark_records;
  }

  public getDevelopers(): Developer[] {
    return this.data.developers;
  }

  public getRepositories(): Repository[] {
    return this.data.repositories;
  }

  public getTasks(): CodingTask[] {
    return this.data.coding_tasks;
  }

  public getFingerprints(): TaskFingerprint[] {
    return this.data.task_fingerprints;
  }

  public getRoutingDecisions(): RoutingDecision[] {
    return this.data.routing_decisions;
  }

  public getModelExecutions(): ModelExecution[] {
    return this.data.model_executions;
  }

  public getEvaluationResults(): EvaluationResult[] {
    return this.data.evaluation_results;
  }

  public getOutcomeEvents(): OutcomeEvent[] {
    return this.data.outcome_events;
  }

  // Setters/Creators
  public addTask(task: CodingTask) {
    this.data.coding_tasks.push(task);
    this.save();
  }

  public addFingerprint(fingerprint: TaskFingerprint) {
    this.data.task_fingerprints.push(fingerprint);
    this.save();
  }

  public addRoutingDecision(decision: RoutingDecision) {
    this.data.routing_decisions.push(decision);
    this.save();
  }

  public addModelExecution(execution: ModelExecution) {
    this.data.model_executions.push(execution);
    this.save();
  }

  public addEvaluationResult(result: EvaluationResult) {
    this.data.evaluation_results.push(result);
    this.save();
  }

  public addOutcomeEvent(outcome: OutcomeEvent) {
    this.data.outcome_events.push(outcome);
    this.save();
  }

  public updateTaskStatus(taskId: string, status: CodingTask["status"]) {
    const task = this.data.coding_tasks.find((t) => t.id === taskId);
    if (task) {
      task.status = status;
      this.save();
    }
  }
}
