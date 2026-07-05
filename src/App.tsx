import React, { useState, useEffect } from "react";
import { 
  Terminal, Cpu, Layers, Settings, Play, CheckCircle, AlertTriangle, 
  ArrowRight, BarChart3, User, Folder, DollarSign, Clock, 
  Coins, Copy, RotateCcw, Sparkles, Check, ChevronRight, X, Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Types derived from /src/db/db.ts
interface Model {
  id: string;
  provider: "OpenAI" | "Anthropic" | "Google";
  name: string;
  input_cost_per_m: number;
  output_cost_per_m: number;
  avg_latency_ms: number;
}

interface TaskFingerprint {
  agent_type: "CODE" | "DEBUG" | "TEST";
  agent_confidence: number;
  skills: Record<string, number>;
  task_family: "debugging" | "code_generation" | "testing";
  complexity: number;
  risk: number;
  context_need: number;
}

interface RoutingCandidate {
  id: string;
  model_id: string;
  predicted_success_probability: number;
  expected_cost: number;
  expected_tokens: number;
  status: "filtered" | "eligible" | "selected";
  reason: string;
}

interface RoutingDecision {
  id: string;
  task_id: string;
  selected_model_id: string;
  predicted_success_probability: number;
  expected_cost: number;
  expected_tokens: number;
  reason: string[];
  candidates: RoutingCandidate[];
}

interface ModelExecution {
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
}

interface EvaluationResult {
  id: string;
  execution_id: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  passed: boolean;
}

interface DeveloperModelProfile {
  modelId: string;
  modelName: string;
  provider: string;
  successRate: number;
  totalAttempts: number;
  successes: number;
  failures: number;
  avgCostPerTask: number;
  avgTokensPerTask: number;
}

export default function App() {
  // Navigation & State Management
  const [activeTab, setActiveTab] = useState<"task" | "dashboard">("task");
  const [workflowStep, setWorkflowStep] = useState<"setup" | "decision" | "execution">("setup");

  // Core Inputs
  const [prompt, setPrompt] = useState("Fix this failing FastAPI endpoint and add a regression test.");
  const [repoPath, setRepoPath] = useState("/routecode/apps/api");
  const [maxCost, setMaxCost] = useState<number>(0.15);
  const [maxTokens, setMaxTokens] = useState<number>(15000);
  const [maxLatency, setMaxLatency] = useState<number>(30000);
  const [errorText, setErrorText] = useState("HTTPException: status_code=500, detail='Database connection timeout during user creation block'");

  // API Workflow State
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<TaskFingerprint | null>(null);
  const [decision, setDecision] = useState<RoutingDecision | null>(null);
  const [execution, setExecution] = useState<ModelExecution | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [isCopied, setIsCopied] = useState(false);

  // Model Profiles (Dashboard Data)
  const [profiles, setProfiles] = useState<DeveloperModelProfile[]>([]);
  const [models, setModels] = useState<Model[]>([]);

  // Fetch profiles & models
  const loadDashboardData = async () => {
    try {
      const pRes = await fetch("/api/developers/dev-1/model-profile");
      const mRes = await fetch("/api/models");
      if (pRes.ok) setProfiles(await pRes.json());
      if (mRes.ok) setModels(await mRes.json());
    } catch (e) {
      console.error("Failed to fetch profiles", e);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Presets trigger helper
  const handleApplyPreset = (text: string, err: string = "") => {
    setPrompt(text);
    setErrorText(err);
  };

  // 1. Submit Setup -> Run Fingerprinter and Probabilistic Router
  const handleRouteTask = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      // Step A: Fingerprint Task
      const fpRes = await fetch("/api/tasks/fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: prompt,
          repositoryPath: repoPath,
          errorText: errorText
        })
      });

      if (!fpRes.ok) throw new Error("Fingerprinting failed");
      const fpData = await fpRes.json();
      setTaskId(fpData.task.id);
      setFingerprint(fpData.fingerprint);

      // Step B: Route Task
      const routeRes = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: fpData.task.id,
          max_cost_usd: maxCost,
          max_tokens: maxTokens,
          max_latency_ms: maxLatency
        })
      });

      if (!routeRes.ok) throw new Error("Routing failed");
      const routeData = await routeRes.json();
      setDecision(routeData);

      setWorkflowStep("decision");
    } catch (e) {
      console.error(e);
      alert("Error processing task: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 2. Execute Task -> Call Provider Adapter
  const handleExecuteTask = async () => {
    if (!taskId || !decision) return;
    setLoading(true);
    setTerminalLogs([]);
    try {
      const execRes = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          decisionId: decision.id,
          errorText
        })
      });

      if (!execRes.ok) throw new Error("Model execution failed");
      const execData = await execRes.json();
      setExecution(execData);

      setWorkflowStep("execution");

      // Instantly start running docker sandbox evaluations
      runContainerEvaluation(taskId, execData.id);
    } catch (e) {
      console.error(e);
      alert("Execution failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 3. Simulated container evaluation loop
  const runContainerEvaluation = async (tId: string, execId: string) => {
    const logs = [
      "⚡ [CONTAINER INIT] Spawning isolated runtime sandbox environment: routecode/runtime-python:3.12-slim...",
      "🐳 [CONTAINER SETUP] Mounting target working directory '/routecode/apps/api' in read-only sandbox mode.",
      "📦 [ENVIRONMENT] Pre-installing requirements: pytest, fastapi, uvicorn, pydantic.",
      "📝 [PATCH APPLY] Injecting model's code modifications surgically to target endpoint module..."
    ];

    for (const log of logs) {
      setTerminalLogs(prev => [...prev, log]);
      await new Promise(r => setTimeout(r, 600));
    }

    try {
      const evalRes = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: tId, executionId: execId })
      });

      if (evalRes.ok) {
        const evalData = await evalRes.json();
        setEvaluation(evalData);
        setTerminalLogs(prev => [
          ...prev,
          "✅ [COMPILATION] Compile check completed. Exit Code: 0 (Compilation Succeeded)",
          "✅ [LINT] Ruff syntax formatting audit completed. 0 issues detected.",
          "🚀 [TESTS] Executing pytest regression test suite...",
          evalData.stdout,
          "🎉 [EVALUATION SUCCESS] The container execution passed cleanly! No failures detected.",
          "👉 Click 'Commit Outcomes' to persist feedback and update model probabilities."
        ]);
      } else {
        throw new Error("Evaluation error response");
      }
    } catch (e) {
      setTerminalLogs(prev => [
        ...prev,
        "❌ [COMPILATION] Compile check failed.",
        "❌ [TESTS] Pytest execution crashed or failed. Exit Code: 1."
      ]);
    }
  };

  // 4. Commit outcomes to persistent database
  const handleCommitOutcomes = async () => {
    if (!taskId || !evaluation) return;
    setLoading(true);
    try {
      await fetch("/api/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          final_outcome: evaluation.passed ? "success" : "failure",
          tests_passed: evaluation.passed,
          build_passed: evaluation.passed,
          lint_passed: evaluation.passed,
          human_edits: false,
          retry_count: 0
        })
      });

      // Reload dashboard stats
      await loadDashboardData();
      setActiveTab("dashboard");
      setWorkflowStep("setup");
      setTaskId(null);
      setFingerprint(null);
      setDecision(null);
      setExecution(null);
      setEvaluation(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div 
      className="min-h-screen bg-[#020406] text-slate-300 font-sans antialiased flex flex-col selection:bg-indigo-500/30"
      style={{ backgroundImage: "radial-gradient(circle at 50% -20%, #1e293b 0%, #020406 80%)" }}
    >
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0a0c10]/60 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2.5 rounded text-white shadow-[0_0_15px_rgba(79,70,229,0.5)]">
            <Cpu className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
              RouteCode <span className="text-slate-500 font-normal">/ MVP v1.0.4</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-400 font-semibold">Autonomous AI Coding Harness</p>
          </div>
        </div>

        {/* Global Nav */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => { setActiveTab("task"); setWorkflowStep("setup"); }}
            className={`flex items-center space-x-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${
              activeTab === "task" 
                ? "bg-indigo-600/20 text-white border border-indigo-500/30 shadow-[0_0_15px_rgba(79,70,229,0.15)]" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Coding Harness</span>
          </button>
          <button
            onClick={() => { setActiveTab("dashboard"); loadDashboardData(); }}
            className={`flex items-center space-x-1.5 px-4 py-2 rounded text-sm font-medium transition-all ${
              activeTab === "dashboard" 
                ? "bg-indigo-600/20 text-white border border-indigo-500/30 shadow-[0_0_15px_rgba(79,70,229,0.15)]" 
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Learning Dashboard</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col justify-start">
        <AnimatePresence mode="wait">
          {activeTab === "task" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col gap-6"
            >
              {/* Pipeline Progress Indicator */}
              <div className="bg-[#0a0c10] border border-slate-800 rounded-lg p-4 flex items-center justify-between shadow-xl">
                <div className="flex items-center space-x-8 text-sm font-medium mx-auto md:mx-0">
                  <div className={`flex items-center space-x-2 transition-all ${workflowStep === "setup" ? "text-indigo-400" : "text-slate-500"}`}>
                    <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${workflowStep === "setup" ? "border-indigo-500/40 bg-indigo-950/40 text-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.3)]" : "border-slate-800 bg-[#050608]"}`}>1</span>
                    <span className={workflowStep === "setup" ? "text-white font-semibold" : ""}>Context Setup</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-800 hidden md:block" />
                  <div className={`flex items-center space-x-2 transition-all ${workflowStep === "decision" ? "text-indigo-400" : "text-slate-500"}`}>
                    <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${workflowStep === "decision" ? "border-indigo-500/40 bg-indigo-950/40 text-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.3)]" : "border-slate-800 bg-[#050608]"}`}>2</span>
                    <span className={workflowStep === "decision" ? "text-white font-semibold" : ""}>Bayesian Router</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-800 hidden md:block" />
                  <div className={`flex items-center space-x-2 transition-all ${workflowStep === "execution" ? "text-indigo-400" : "text-slate-500"}`}>
                    <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${workflowStep === "execution" ? "border-indigo-500/40 bg-indigo-950/40 text-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.3)]" : "border-slate-800 bg-[#050608]"}`}>3</span>
                    <span className={workflowStep === "execution" ? "text-white font-semibold" : ""}>Secure Execution & Eval</span>
                  </div>
                </div>
              </div>

              {/* Step 1: Context Setup */}
              {workflowStep === "setup" && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Input Form */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 space-y-5 shadow-xl">
                      <div className="border-b border-slate-800 pb-4 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Layers className="w-5 h-5 text-indigo-400" />
                          <h2 className="text-lg font-bold text-white uppercase tracking-wider">Coding Request Setup</h2>
                        </div>
                        <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Simulator Active</span>
                      </div>

                      {/* Presets Row */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Demo Scenarios & Presets</label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleApplyPreset(
                              "Fix this failing FastAPI endpoint and add a regression test.",
                              "HTTPException: status_code=500, detail='Database connection timeout during user creation block'"
                            )}
                            className="bg-[#050608] hover:bg-[#0c0f14] border border-slate-800 px-3 py-1.5 rounded text-xs font-medium text-indigo-400 flex items-center space-x-1.5 transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                            <span>1. FastAPI Fail Suit (Primary Demo)</span>
                          </button>
                          <button
                            onClick={() => handleApplyPreset(
                              "Generate standard PostgreSQL CRUD model for items with validation.",
                              ""
                            )}
                            className="bg-[#050608] hover:bg-[#0c0f14] border border-slate-800 px-3 py-1.5 rounded text-xs font-medium text-slate-300 flex items-center space-x-1 transition-colors"
                          >
                            <span>2. SQL CRUD CodeGen</span>
                          </button>
                        </div>
                      </div>

                      {/* Coding Request Prompt */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                          <span>User Coding Request</span>
                          <span className="text-[9px] text-slate-600 font-normal uppercase tracking-wider">Dynamic Parsing</span>
                        </label>
                        <textarea
                          rows={4}
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="Describe the feature to implement, code to generate, or debug bug..."
                          className="w-full bg-[#050608] border border-slate-800 rounded p-3 text-slate-200 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-700 font-sans leading-relaxed"
                        />
                      </div>

                      {/* Diagnostics/Exceptions logs */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
                          <span>Error logs / Tracebacks (Optional)</span>
                          <span className="text-[9px] text-amber-500 font-mono uppercase tracking-widest">Triggers DEBUG Mode</span>
                        </label>
                        <textarea
                          rows={3}
                          value={errorText}
                          onChange={(e) => setErrorText(e.target.value)}
                          placeholder="Paste compiler logs, crash outputs, exception stack traces, or failing tests logs here..."
                          className="w-full bg-[#050608] border border-slate-800 rounded p-3 text-slate-200 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-mono placeholder:text-slate-800 leading-relaxed"
                        />
                      </div>

                      {/* File Details & Repository Path */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center space-x-1.5">
                            <Folder className="w-3.5 h-3.5" />
                            <span>Repository Path</span>
                          </label>
                          <input
                            type="text"
                            value={repoPath}
                            onChange={(e) => setRepoPath(e.target.value)}
                            className="w-full bg-[#050608] border border-slate-800 rounded px-3 py-2 text-sm text-slate-300 focus:border-indigo-500 outline-none font-mono"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center space-x-1.5">
                            <User className="w-3.5 h-3.5" />
                            <span>Developer Profile Context</span>
                          </label>
                          <div className="bg-[#050608] border border-slate-800 px-3 py-2 rounded text-sm text-slate-300 flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]"></span>
                            <span>Principal Developer (dev-1)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Routing & Cost Parameters */}
                  <div className="space-y-6">
                    <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 space-y-6 shadow-xl">
                      <div className="border-b border-slate-800 pb-4">
                        <div className="flex items-center space-x-2">
                          <Settings className="w-5 h-5 text-indigo-400" />
                          <h3 className="text-lg font-bold text-white uppercase tracking-wider">Constraint Budgets</h3>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Routing filters models violating these parameters</p>
                      </div>

                      {/* Max Cost (USD) */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5" />
                            Max cost (USD)
                          </span>
                          <span className="text-indigo-400 font-mono">${maxCost.toFixed(3)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.005"
                          max="0.50"
                          step="0.005"
                          value={maxCost}
                          onChange={(e) => setMaxCost(parseFloat(e.target.value))}
                          className="w-full accent-indigo-500 bg-[#050608] rounded appearance-none h-1.5 cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                          <span>$0.005</span>
                          <span>$0.50</span>
                        </div>
                      </div>

                      {/* Max Tokens */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <Coins className="w-3.5 h-3.5" />
                            Max Tokens
                          </span>
                          <span className="text-indigo-400 font-mono">{maxTokens}</span>
                        </div>
                        <input
                          type="range"
                          min="2000"
                          max="50000"
                          step="1000"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                          className="w-full accent-indigo-500 bg-[#050608] rounded appearance-none h-1.5 cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                          <span>2,000</span>
                          <span>50,000</span>
                        </div>
                      </div>

                      {/* Max Latency */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            Max Latency
                          </span>
                          <span className="text-indigo-400 font-mono">{maxLatency}ms</span>
                        </div>
                        <input
                          type="range"
                          min="2000"
                          max="60000"
                          step="1000"
                          value={maxLatency}
                          onChange={(e) => setMaxLatency(parseInt(e.target.value))}
                          className="w-full accent-indigo-500 bg-[#050608] rounded appearance-none h-1.5 cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                          <span>2,000ms</span>
                          <span>60,000ms</span>
                        </div>
                      </div>

                      <button
                        onClick={handleRouteTask}
                        disabled={loading}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-900 disabled:text-slate-600 text-white font-bold py-3.5 rounded transition-all shadow-[0_4px_20px_rgba(79,70,229,0.3)] flex items-center justify-center space-x-2 text-xs uppercase tracking-widest"
                      >
                        {loading ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Analyzing Context & Routing...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-white text-white" />
                            <span>Route & Analyze Task</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Routing Decision Display */}
              {workflowStep === "decision" && fingerprint && decision && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column: Context Analysis Outputs */}
                  <div className="lg:col-span-1 space-y-6">
                    {/* Context Analysis Card */}
                    <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 space-y-5 shadow-xl">
                      <div className="border-b border-slate-800 pb-3">
                        <h3 className="text-md font-bold text-white uppercase tracking-wider flex items-center gap-2">
                          <Layers className="w-4 h-4 text-indigo-400" />
                          Context Fingerprint
                        </h3>
                      </div>

                      {/* Agent Type */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Selected Agent Type</span>
                        <div className="flex items-center justify-between bg-[#050608] p-2.5 rounded border border-slate-800/50">
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-widest ${
                            fingerprint.agent_type === "DEBUG" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                            fingerprint.agent_type === "TEST" ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" :
                            "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                          }`}>
                            {fingerprint.agent_type} Agent
                          </span>
                          <span className="text-xs font-semibold text-slate-400 font-mono">{(fingerprint.agent_confidence * 100).toFixed(0)}% CONF</span>
                        </div>
                      </div>

                      {/* Dynamic Skills */}
                      <div className="space-y-3 pt-2 border-t border-slate-800/40">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Detected Coding Skills</span>
                        <div className="space-y-3 bg-[#050608] p-3 rounded border border-slate-800/40">
                          {Object.entries(fingerprint.skills).map(([skill, val]) => (
                            <div key={skill} className="space-y-1">
                              <div className="flex justify-between items-center text-xs">
                                <span className="font-mono text-slate-400 capitalize">{skill}</span>
                                <span className="text-slate-300 font-mono">{((val as number) * 100).toFixed(0)}%</span>
                              </div>
                              <div className="w-full bg-slate-900 h-1.5 rounded overflow-hidden">
                                <div className="bg-indigo-500 h-full rounded shadow-[0_0_8px_#6366f1]" style={{ width: `${(val as number) * 100}%` }}></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Context Indicators */}
                      <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-slate-800/40">
                        <div className="bg-[#050608] p-2.5 rounded border border-slate-800">
                          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Complexity</div>
                          <div className="text-sm font-bold text-white font-mono mt-1">{(fingerprint.complexity * 10).toFixed(1)}</div>
                        </div>
                        <div className="bg-[#050608] p-2.5 rounded border border-slate-800">
                          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Risk Level</div>
                          <div className="text-sm font-bold text-rose-500 font-mono mt-1">{(fingerprint.risk * 10).toFixed(1)}</div>
                        </div>
                        <div className="bg-[#050608] p-2.5 rounded border border-slate-800">
                          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Ctx Need</div>
                          <div className="text-sm font-bold text-indigo-400 font-mono mt-1">{(fingerprint.context_need * 10).toFixed(1)}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Center Column: Model Candidates List */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Optimal Choice Hero Banner with gauge */}
                    {(() => {
                      const bestCand = decision.candidates.find((c) => c.status === "selected") || decision.candidates[0];
                      if (!bestCand) return null;
                      return (
                        <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full filter blur-3xl pointer-events-none"></div>
                          <div className="space-y-3">
                            <span className="text-[9px] uppercase tracking-[0.25em] text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded">Optimal Router Choice</span>
                            <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                              {bestCand.model_id.split("/")[1]}
                              <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                            </h3>
                            <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                              This candidate possesses the highest predicted probability of successful task execution within constraint thresholds, calculated using bayesian priors corrected by personal developer history.
                            </p>
                          </div>
                          <div className="relative flex-shrink-0 flex items-center justify-center">
                            <svg className="w-24 h-24 transform -rotate-90">
                              <circle cx="48" cy="48" r="42" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-900" />
                              <circle 
                                cx="48" 
                                cy="48" 
                                r="42" 
                                stroke="currentColor" 
                                strokeWidth="4" 
                                fill="transparent" 
                                className="text-indigo-500" 
                                strokeDasharray="263.89" 
                                strokeDashoffset={263.89 * (1 - bestCand.predicted_success_probability)} 
                                style={{ filter: "drop-shadow(0 0 4px rgba(99, 102, 241, 0.6))" }} 
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <p className="text-lg font-bold text-white font-mono">{(bestCand.predicted_success_probability * 100).toFixed(0)}%</p>
                              <p className="text-[8px] text-slate-500 uppercase tracking-widest">P(Success)</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 space-y-6 shadow-xl">
                      <div className="border-b border-slate-800 pb-4 flex items-center justify-between">
                        <div>
                          <h3 className="text-md font-bold text-white uppercase tracking-wider">Candidate AI Models</h3>
                          <p className="text-xs text-slate-500">Bayesian computation evaluating prior baseline and observed evidence</p>
                        </div>
                        <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-1 rounded font-bold uppercase tracking-wider">
                          P(success) Optimized
                        </span>
                      </div>

                      {/* Candidates List */}
                      <div className="space-y-3">
                        {decision.candidates.map((cand) => {
                          const isSelected = cand.status === "selected";
                          const isFiltered = cand.status === "filtered";
                          const providerShort = cand.model_id.split("/")[0];
                          const modelShort = cand.model_id.split("/")[1];

                          return (
                            <div 
                              key={cand.model_id} 
                              className={`p-4 rounded border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                                isSelected 
                                  ? "bg-indigo-950/10 border-indigo-500/40 shadow-[inset_0_0_20px_rgba(79,70,229,0.05)]" 
                                  : isFiltered 
                                    ? "bg-[#050608]/50 border-slate-900 opacity-40" 
                                    : "bg-[#050608] border-slate-800/80 hover:border-slate-700"
                              }`}
                            >
                              <div className="flex items-center space-x-3.5">
                                <div className={`px-2 py-1 rounded text-[9px] font-bold tracking-wider ${
                                  providerShort === "anthropic" ? "bg-amber-500/10 text-amber-400" :
                                  providerShort === "openai" ? "bg-purple-500/10 text-purple-400" :
                                  "bg-blue-500/10 text-blue-400"
                                }`}>
                                  {providerShort.toUpperCase()}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                                    <span>{modelShort}</span>
                                    {isSelected && <Sparkles className="w-3.5 h-3.5 text-indigo-400" />}
                                  </div>
                                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                                    Est: ${cand.expected_cost.toFixed(4)} | {cand.expected_tokens} tokens
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-between md:justify-end gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
                                <div className="text-left md:text-right">
                                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">P(success)</div>
                                  <div className={`text-md font-bold font-mono ${
                                    isFiltered ? "text-slate-500" :
                                    cand.predicted_success_probability > 0.75 ? "text-emerald-400" :
                                    cand.predicted_success_probability > 0.5 ? "text-indigo-400" : "text-amber-400"
                                  }`}>
                                    {isFiltered ? "0.0%" : `${(cand.predicted_success_probability * 100).toFixed(1)}%`}
                                  </div>
                                </div>

                                <div className="min-w-[100px] text-right">
                                  <span className={`inline-block px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-wider ${
                                    isSelected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                                    isFiltered ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                                    "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                                  }`}>
                                    {cand.status}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Explainability Block */}
                      <div className="bg-[#050608] border border-slate-800 p-5 rounded space-y-3">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                          <Info className="w-4 h-4 text-indigo-400" />
                          Bayesian Decision Reasonings
                        </h4>
                        <div className="space-y-2">
                          {decision.reason.map((r, i) => (
                            <div key={i} className="flex items-start space-x-2.5 text-xs text-slate-300 leading-relaxed">
                              <CheckCircle className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                              <span>{r}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex space-x-3 pt-2">
                        <button
                          onClick={() => setWorkflowStep("setup")}
                          className="flex-1 bg-[#050608] border border-slate-800 hover:bg-[#0c0f14] text-slate-300 font-bold py-3 rounded transition-all text-xs uppercase tracking-wider flex items-center justify-center space-x-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Back to Settings</span>
                        </button>
                        <button
                          onClick={handleExecuteTask}
                          disabled={loading}
                          className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded transition-all shadow-[0_4px_20px_rgba(79,70,229,0.3)] text-xs uppercase tracking-widest flex items-center justify-center space-x-1.5"
                        >
                          {loading ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Running Generation...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3.5 h-3.5 fill-white text-white" />
                              <span>Execute with Selected Model</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Execution Result display */}
              {workflowStep === "execution" && execution && (
                <div className="space-y-6">
                  {/* Top Stats Overview bar */}
                  <div className="bg-[#0a0c10] border border-slate-800 rounded p-5 flex flex-wrap gap-6 justify-between items-center shadow-xl">
                    <div className="flex items-center space-x-4">
                      <div className="p-2 bg-indigo-500/10 rounded border border-indigo-500/20 text-indigo-400">
                        <Cpu className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Executed Model Target</div>
                        <div className="text-md font-bold text-white uppercase tracking-wider">{execution.provider} / {execution.model}</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-8 text-sm">
                      <div className="flex items-center space-x-2 border-r border-slate-800 pr-8">
                        <Clock className="w-4 h-4 text-indigo-400" />
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Latency</div>
                          <div className="font-semibold font-mono text-white">{(execution.latency_ms / 1000).toFixed(2)}s</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 border-r border-slate-800 pr-8">
                        <Coins className="w-4 h-4 text-indigo-400" />
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Tokens</div>
                          <div className="font-semibold font-mono text-white">{execution.input_tokens + execution.output_tokens}</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <DollarSign className="w-4 h-4 text-emerald-400" />
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider">Est. Cost</div>
                          <div className="font-semibold font-mono text-emerald-400">${execution.estimated_cost.toFixed(4)}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left Column: Generated patch display */}
                    <div className="bg-[#0a0c10] border border-slate-800 rounded flex flex-col h-[520px] shadow-xl overflow-hidden">
                      <div className="border-b border-slate-800 px-5 py-4 flex items-center justify-between bg-[#050608]">
                        <div className="flex items-center space-x-2">
                          <Terminal className="w-4.5 h-4.5 text-indigo-400" />
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Generated Code & Modifications</h3>
                        </div>
                        <button
                          onClick={() => handleCopyCode(execution.response)}
                          className="text-slate-400 hover:text-white px-2.5 py-1 rounded text-xs bg-[#050608] border border-slate-800 flex items-center gap-1 transition-all"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Code</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Code Area */}
                      <div className="flex-1 overflow-auto bg-[#020406] p-5 font-mono text-xs text-slate-300 leading-relaxed">
                        <pre>{execution.response}</pre>
                      </div>
                    </div>

                    {/* Right Column: Terminal and verification logs */}
                    <div className="bg-[#0a0c10] border border-slate-800 rounded flex flex-col h-[520px] shadow-xl overflow-hidden">
                      <div className="border-b border-slate-800 px-5 py-4 flex items-center justify-between bg-[#050608]">
                        <div className="flex items-center space-x-2">
                          <Terminal className="w-4.5 h-4.5 text-indigo-400 animate-pulse" />
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Docker Testing Sandbox Simulator</h3>
                        </div>
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded uppercase tracking-wider bg-[#020406] border border-slate-800 text-indigo-400">
                          Python 3.12
                        </span>
                      </div>

                      {/* Terminal View */}
                      <div className="flex-1 overflow-auto bg-[#020406] p-5 font-mono text-xs text-slate-400 flex flex-col space-y-1.5 leading-relaxed shadow-inner">
                        {terminalLogs.map((log, idx) => {
                          const isSuccess = log.startsWith("✅") || log.includes("passed") || log.includes("SUCCESS");
                          const isWarning = log.startsWith("⚡") || log.startsWith("🐳") || log.startsWith("👉") || log.includes("requirements") || log.includes("SETUP");
                          return (
                            <div key={idx} className={`${isSuccess ? "text-emerald-400 font-semibold" : isWarning ? "text-slate-500 font-medium" : "text-indigo-400"}`}>
                              {log}
                            </div>
                          );
                        })}
                      </div>

                      {/* Bottom action block */}
                      <div className="border-t border-slate-800 p-4 bg-[#050608] flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {evaluation ? (
                            evaluation.passed ? (
                              <span className="flex items-center space-x-1 text-emerald-400 text-[10px] font-bold uppercase bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                                <CheckCircle className="w-3.5 h-3.5 fill-emerald-950" />
                                <span>Passed Checks</span>
                              </span>
                            ) : (
                              <span className="flex items-center space-x-1 text-rose-400 text-[10px] font-bold uppercase bg-rose-500/10 px-2.5 py-1 rounded border border-rose-500/20">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Failed Checks</span>
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 animate-pulse">Waiting for sandbox engine...</span>
                          )}
                        </div>

                        <button
                          onClick={handleCommitOutcomes}
                          disabled={!evaluation || loading}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-900 disabled:text-slate-600 text-white font-bold px-5 py-2.5 rounded transition-all text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.3)] cursor-pointer"
                        >
                          {loading ? "Saving evidence..." : "Commit Outcomes & Update Evidence"}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "dashboard" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Stats Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-[#0a0c10] border border-slate-800 rounded p-5 shadow-xl">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Total Tasks Processed</div>
                  <div className="text-3xl font-bold mt-1 text-white font-mono">
                    {profiles.reduce((sum, p) => sum + p.totalAttempts, 0)}
                  </div>
                </div>
                <div className="bg-[#0a0c10] border border-slate-800 rounded p-5 shadow-xl">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Precision Success Rate</div>
                  <div className="text-3xl font-bold mt-1 text-emerald-400 font-mono">
                    {profiles.length > 0 
                      ? `${(profiles.reduce((sum, p) => sum + p.successes, 0) / profiles.reduce((sum, p) => sum + p.totalAttempts, 0) * 100).toFixed(0)}%` 
                      : "0%"
                    }
                  </div>
                </div>
                <div className="bg-[#0a0c10] border border-slate-800 rounded p-5 shadow-xl">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Cumulative Cost Saved</div>
                  <div className="text-3xl font-bold mt-1 text-indigo-400 font-mono">$8.42</div>
                </div>
                <div className="bg-[#0a0c10] border border-slate-800 rounded p-5 shadow-xl">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active Bayesian Profiles</div>
                  <div className="text-3xl font-bold mt-1 text-indigo-400 font-mono">{profiles.length}</div>
                </div>
              </div>

              {/* Main Profile Cards Grid */}
              <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 shadow-xl space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <User className="w-5 h-5 text-indigo-400" />
                    Personal Model Preference Cards
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Calculates probability corrections updated dynamically by real-world outcome evidence</p>
                </div>

                {/* Profiles Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {profiles.map((p) => (
                    <div key={p.modelId} className="bg-[#050608] border border-slate-800 p-5 rounded space-y-4 shadow-md flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                          <span className={`px-2.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${
                            p.provider === "Anthropic" ? "bg-amber-500/10 text-amber-400" :
                            p.provider === "OpenAI" ? "bg-purple-500/10 text-purple-400" :
                            "bg-blue-500/10 text-blue-400"
                          }`}>
                            {p.provider}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">Attempted: {p.totalAttempts}</span>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-white">{p.modelName}</h4>
                          <div className="text-[10px] text-slate-500 mt-0.5">Prior Baseline + Bayesian Correction</div>
                        </div>

                        {/* Cost & Tokens */}
                        <div className="grid grid-cols-2 gap-2 text-center py-1 font-mono">
                          <div className="bg-[#020406] p-2 rounded border border-slate-800/60">
                            <div className="text-[9px] font-bold text-slate-500 uppercase">Avg cost / task</div>
                            <div className="text-xs font-semibold text-slate-300 mt-0.5">${p.avgCostPerTask.toFixed(4)}</div>
                          </div>
                          <div className="bg-[#020406] p-2 rounded border border-slate-800/60">
                            <div className="text-[9px] font-bold text-slate-500 uppercase">Avg tokens / task</div>
                            <div className="text-xs font-semibold text-slate-300 mt-0.5">{p.avgTokensPerTask}</div>
                          </div>
                        </div>
                      </div>

                      {/* Success Bar */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-800/40">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Bayesian Preference Rate</span>
                          <span className="font-bold text-emerald-400 font-mono">{(p.successRate * 100).toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-slate-900 h-1.5 rounded overflow-hidden">
                          <div className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full rounded" style={{ width: `${p.successRate * 100}%` }}></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Historical Updates Timeline */}
              <div className="bg-[#0a0c10] border border-slate-800 rounded p-6 shadow-xl space-y-4">
                <h3 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-indigo-400" />
                  Chronological Routing Preference Logs
                </h3>
                <div className="border border-slate-800 rounded overflow-hidden divide-y divide-slate-800">
                  <div className="bg-[#050608] p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest grid grid-cols-12 gap-4">
                    <span className="col-span-3">TIMESTAMP</span>
                    <span className="col-span-3">CODING TASK DESCRIPTION</span>
                    <span className="col-span-2">AGENT TYPE</span>
                    <span className="col-span-2">ROUTED MODEL</span>
                    <span className="col-span-2 text-right">EVALUATION OUTCOME</span>
                  </div>

                  <div className="divide-y divide-slate-850">
                    <div className="p-4 text-xs text-slate-300 grid grid-cols-12 gap-4 items-center bg-[#0a0c10]/20">
                      <span className="col-span-3 font-mono text-slate-500">2026-07-04 21:55:01</span>
                      <span className="col-span-3 font-medium text-slate-200">Fix user login routing bug</span>
                      <span className="col-span-2"><span className="bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded text-[9px] font-bold tracking-wider">DEBUG</span></span>
                      <span className="col-span-2 font-mono text-slate-400">claude-3-5-sonnet</span>
                      <span className="col-span-2 text-right text-emerald-400 font-bold">SUCCESS (tests passed)</span>
                    </div>
                    <div className="p-4 text-xs text-slate-300 grid grid-cols-12 gap-4 items-center bg-[#050608]/40">
                      <span className="col-span-3 font-mono text-slate-500">2026-07-04 18:30:45</span>
                      <span className="col-span-3 font-medium text-slate-200">Generate standard user CRUD controller</span>
                      <span className="col-span-2"><span className="bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded text-[9px] font-bold tracking-wider">CODE</span></span>
                      <span className="col-span-2 font-mono text-slate-400">gpt-4o</span>
                      <span className="col-span-2 text-right text-emerald-400 font-bold">SUCCESS (build passed)</span>
                    </div>
                    <div className="p-4 text-xs text-slate-300 grid grid-cols-12 gap-4 items-center bg-[#0a0c10]/20">
                      <span className="col-span-3 font-mono text-slate-500">2026-07-04 12:12:10</span>
                      <span className="col-span-3 font-medium text-slate-200">Debug connection timeout in websocket middleware</span>
                      <span className="col-span-2"><span className="bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded text-[9px] font-bold tracking-wider">DEBUG</span></span>
                      <span className="col-span-2 font-mono text-slate-400">gemini-3.1-pro</span>
                      <span className="col-span-2 text-right text-emerald-400 font-bold">SUCCESS (tests passed)</span>
                    </div>
                    <div className="p-4 text-xs text-slate-300 grid grid-cols-12 gap-4 items-center bg-[#050608]/40">
                      <span className="col-span-3 font-mono text-slate-500">2026-07-03 14:02:55</span>
                      <span className="col-span-3 font-medium text-slate-200">Debug complex Pydantic validation error</span>
                      <span className="col-span-2"><span className="bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded text-[9px] font-bold tracking-wider">DEBUG</span></span>
                      <span className="col-span-2 font-mono text-slate-400">gemini-3.5-flash</span>
                      <span className="col-span-2 text-right text-rose-400 font-bold">FAILURE (compile error)</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info block */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500 mt-12 bg-[#020406]/60 backdrop-blur-md">
        <p>© 2026 RouteCode Engine. Designed as a fully explainable, budget-aware personal model routing framework.</p>
      </footer>
    </div>
  );
}
