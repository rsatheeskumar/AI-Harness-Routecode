import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";

import { RouteCodeDB } from "./src/db/db.js";
import { ContextFingerprinter } from "./src/modules/fingerprint.js";
import { SkillRegistry } from "./src/modules/skills.js";
import { AgentFactory } from "./src/modules/agents.js";
import { ModelProviderFactory } from "./src/modules/providers.js";
import { ProbabilisticRouter } from "./src/modules/router.js";
import { EvaluatorFactory } from "./src/modules/evaluator.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize persistent database
const db = new RouteCodeDB();
const fingerprinter = new ContextFingerprinter();
const skillRegistry = new SkillRegistry();

// API Endpoints

// GET /health
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "RouteCode AI Engine",
    timestamp: new Date().toISOString()
  });
});

// GET /providers
app.get("/api/providers", (req, res) => {
  res.json([
    {
      name: "Anthropic",
      adapter: "AnthropicProviderAdapter",
      credentialsConfigured: !!process.env.ANTHROPIC_API_KEY,
      supportedModels: ["claude-3-5-sonnet"]
    },
    {
      name: "OpenAI",
      adapter: "OpenAIProviderAdapter",
      credentialsConfigured: !!process.env.OPENAI_API_KEY,
      supportedModels: ["gpt-4o", "gpt-4o-mini"]
    },
    {
      name: "Google",
      adapter: "GoogleProviderAdapter",
      credentialsConfigured: !!process.env.GEMINI_API_KEY,
      supportedModels: ["gemini-3.1-pro", "gemini-3.5-flash"]
    }
  ]);
});

// GET /models
app.get("/api/models", (req, res) => {
  res.json(db.getModels());
});

// POST /tasks/fingerprint
app.post("/api/tasks/fingerprint", (req, res) => {
  const { request, repositoryPath, selectedFiles, errorText } = req.body;

  if (!request) {
    return res.status(400).json({ error: "Missing required 'request' body field." });
  }

  // Generate fingerprint
  const fp = fingerprinter.fingerprint({
    request,
    repositoryPath,
    selectedFiles,
    errorText
  });

  // Save new task
  const taskId = `task-${Date.now()}`;
  const newTask = {
    id: taskId,
    developer_id: "dev-1",
    repository_id: "repo-1",
    prompt: request,
    status: "fingerprinted" as const,
    created_at: new Date().toISOString()
  };

  fp.task_id = taskId;

  db.addTask(newTask);
  db.addFingerprint(fp);

  res.json({
    task: newTask,
    fingerprint: fp
  });
});

// POST /route
app.post("/api/route", (req, res) => {
  const { taskId, max_cost_usd, max_tokens, max_latency_ms } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: "Missing required 'taskId' parameter." });
  }

  const task = db.getTasks().find(t => t.id === taskId);
  const fp = db.getFingerprints().find(f => f.task_id === taskId);

  if (!task || !fp) {
    return res.status(404).json({ error: "Task or Fingerprint not found." });
  }

  const router = new ProbabilisticRouter(db);
  const routeResult = router.route(fp, {
    max_cost_usd,
    max_tokens,
    max_latency_ms
  });

  const decisionId = `dec-${Date.now()}`;
  const decisionRecord = {
    id: decisionId,
    task_id: taskId,
    selected_model_id: routeResult.selected_model.id,
    predicted_success_probability: routeResult.predicted_success_probability,
    expected_cost: routeResult.expected_cost,
    expected_tokens: routeResult.expected_tokens,
    reason: routeResult.reason,
    created_at: new Date().toISOString(),
    candidates: routeResult.candidates.map((c, i) => ({
      id: `cand-${decisionId}-${i}`,
      decision_id: decisionId,
      model_id: c.model_id,
      predicted_success_probability: c.predicted_success_probability,
      expected_cost: c.expected_cost,
      expected_tokens: c.expected_tokens,
      status: c.status as any,
      reason: c.reason
    }))
  };

  db.addRoutingDecision(decisionRecord);
  db.updateTaskStatus(taskId, "routed");

  res.json(decisionRecord);
});

// POST /execute
app.post("/api/execute", async (req, res) => {
  const { taskId, decisionId } = req.body;

  if (!taskId || !decisionId) {
    return res.status(400).json({ error: "Missing required 'taskId' or 'decisionId' parameters." });
  }

  const task = db.getTasks().find(t => t.id === taskId);
  const fp = db.getFingerprints().find(f => f.task_id === taskId);
  const decision = db.getRoutingDecisions().find(d => d.id === decisionId);

  if (!task || !fp || !decision) {
    return res.status(404).json({ error: "Missing required Task, Fingerprint, or Routing context." });
  }

  try {
    const model = db.getModels().find(m => m.id === decision.selected_model_id)!;
    const providerAdapter = ModelProviderFactory.getProvider(model.provider);

    // Load agent behavior
    const agent = AgentFactory.getAgent(fp.agent_type);

    // Load dynamic skills
    const skills = skillRegistry.loadSkillsForFingerprint(fp.skills);
    const skillInstructions = skills.map(s => s.instructions);

    // Build core execution prompt
    const finalPrompt = agent.buildPrompt(task.prompt, skillInstructions, req.body.errorText);

    // Execute provider adapter
    const result = await providerAdapter.generate({
      modelId: model.id,
      prompt: finalPrompt,
      systemInstruction: agent.base_instructions
    });

    const executionId = `exec-${Date.now()}`;
    const executionRecord = {
      id: executionId,
      decision_id: decisionId,
      provider: result.provider,
      model: result.model,
      response: result.response || result.error || "Generation error.",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      estimated_cost: result.estimatedCostUsd,
      latency_ms: result.latencyMs,
      error_info: result.error,
      created_at: new Date().toISOString()
    };

    db.addModelExecution(executionRecord);
    db.updateTaskStatus(taskId, "executed");

    res.json(executionRecord);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to execute model." });
  }
});

// POST /evaluate
app.post("/api/evaluate", async (req, res) => {
  const { taskId, executionId } = req.body;

  if (!taskId || !executionId) {
    return res.status(400).json({ error: "Missing required 'taskId' or 'executionId' parameters." });
  }

  const task = db.getTasks().find(t => t.id === taskId);
  const fp = db.getFingerprints().find(f => f.task_id === taskId);
  const execution = db.getModelExecutions().find(e => e.id === executionId);

  if (!task || !fp || !execution) {
    return res.status(404).json({ error: "Context task, fingerprint, or execution not found." });
  }

  try {
    const evaluator = EvaluatorFactory.getEvaluator("python");
    const evalResult = await evaluator.evaluate({
      taskId,
      codePatch: execution.response,
      taskFamily: fp.task_family,
      skills: Object.keys(fp.skills)
    });

    const evalRecord = {
      id: `eval-${Date.now()}`,
      execution_id: executionId,
      command: "pytest tests/ && ruff check .",
      exit_code: evalResult.passed ? 0 : 1,
      stdout: evalResult.steps.map(s => `[${s.stepName}] command: ${s.command}\n${s.stdout}`).join("\n\n"),
      stderr: evalResult.steps.map(s => s.stderr).filter(Boolean).join("\n"),
      duration_ms: evalResult.overallDurationMs,
      passed: evalResult.passed,
      created_at: new Date().toISOString()
    };

    db.addEvaluationResult(evalRecord);
    db.updateTaskStatus(taskId, "evaluated");

    res.json(evalRecord);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Evaluation execution failure." });
  }
});

// POST /outcomes
app.post("/api/outcomes", (req, res) => {
  const { taskId, final_outcome, tests_passed, build_passed, lint_passed, human_edits, retry_count } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: "Missing 'taskId'." });
  }

  const outcomeRecord = {
    id: `out-${Date.now()}`,
    task_id: taskId,
    final_outcome: final_outcome || "success",
    tests_passed: !!tests_passed,
    build_passed: !!build_passed,
    lint_passed: !!lint_passed,
    human_edits: !!human_edits,
    retry_count: Number(retry_count || 0),
    created_at: new Date().toISOString()
  };

  db.addOutcomeEvent(outcomeRecord);
  db.updateTaskStatus(taskId, "evaluated");

  res.json(outcomeRecord);
});

// Helper for building profiles
function compileProfile(developerId: string) {
  const outcomes = db.getOutcomeEvents();
  const tasks = db.getTasks();
  const fingerprints = db.getFingerprints();
  const decisions = db.getRoutingDecisions();
  const models = db.getModels();

  // Model ID -> Successes / Failures
  const stats: Record<string, { modelName: string; provider: string; successes: number; total: number; totalCost: number; totalTokens: number; latencies: number[] }> = {};

  models.forEach(m => {
    stats[m.id] = {
      modelName: m.name,
      provider: m.provider,
      successes: 0,
      total: 0,
      totalCost: 0,
      totalTokens: 0,
      latencies: []
    };
  });

  outcomes.forEach(out => {
    const task = tasks.find(t => t.id === out.task_id);
    if (!task || task.developer_id !== developerId) return;

    const fp = fingerprints.find(f => f.task_id === task.id);
    const dec = decisions.find(d => d.task_id === task.id);
    if (!dec) return;

    const modelId = dec.selected_model_id;
    if (stats[modelId]) {
      stats[modelId].total++;
      if (out.final_outcome === "success") {
        stats[modelId].successes++;
      }
      stats[modelId].totalCost += dec.expected_cost;
      stats[modelId].totalTokens += dec.expected_tokens;
    }
  });

  return Object.entries(stats).map(([id, s]) => ({
    modelId: id,
    modelName: s.modelName,
    provider: s.provider,
    successRate: s.total > 0 ? Number((s.successes / s.total).toFixed(2)) : 0,
    totalAttempts: s.total,
    successes: s.successes,
    failures: s.total - s.successes,
    avgCostPerTask: s.total > 0 ? Number((s.totalCost / s.total).toFixed(4)) : 0,
    avgTokensPerTask: s.total > 0 ? Math.round(s.totalTokens / s.total) : 0
  }));
}

// GET /developers/{developer_id}/model-profile
app.get("/api/developers/:developer_id/model-profile", (req, res) => {
  const profile = compileProfile(req.params.developer_id);
  res.json(profile);
});

// GET /repositories/{repository_id}/model-profile
app.get("/api/repositories/:repository_id/model-profile", (req, res) => {
  const profile = compileProfile("dev-1"); // Fallback to developer-wide profile
  res.json(profile);
});

// GET /routing-decisions/{decision_id}
app.get("/api/routing-decisions/:decision_id", (req, res) => {
  const decision = db.getRoutingDecisions().find(d => d.id === req.params.decision_id);
  if (!decision) {
    return res.status(404).json({ error: "Routing decision not found." });
  }
  res.json(decision);
});


// Configure client rendering based on environment
async function startViteServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`RouteCode Engine running on http://localhost:${PORT}`);
  });
}

startViteServer();
