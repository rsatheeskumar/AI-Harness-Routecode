import { TaskFingerprint } from "../db/db";

export interface FingerprintInput {
  request: string;
  repositoryPath?: string;
  selectedFiles?: string[];
  errorText?: string;
}

export class ContextFingerprinter {
  /**
   * Deterministically fingerprints the coding task context based on rules, keywords, and inputs.
   */
  public fingerprint(input: FingerprintInput): TaskFingerprint {
    const { request, repositoryPath = "", selectedFiles = [], errorText = "" } = input;
    const reqLower = request.toLowerCase();
    const errLower = errorText.toLowerCase();
    const pathLower = repositoryPath.toLowerCase();

    // 1. Detect Agent Type
    let agent_type: TaskFingerprint["agent_type"] = "CODE";
    let agent_confidence = 0.80;

    const debugKeywords = ["fix", "bug", "error", "failing", "fail", "crash", "exception", "stack trace", "infinite loop", "broken", "issue", "resolve"];
    const testKeywords = ["test", "pytest", "testing", "unit test", "spec", "assert", "coverage", "mock", "regression"];

    const debugMatch = debugKeywords.filter(k => reqLower.includes(k) || errLower.includes(k)).length;
    const testMatch = testKeywords.filter(k => reqLower.includes(k)).length;

    if (errorText.trim().length > 0 || debugMatch > 1 || reqLower.includes("stack trace") || reqLower.includes("error")) {
      agent_type = "DEBUG";
      agent_confidence = Math.min(0.95, 0.85 + debugMatch * 0.05);
    } else if (testMatch > 1 || reqLower.includes("pytest") || reqLower.includes("regression test")) {
      agent_type = "TEST";
      agent_confidence = Math.min(0.95, 0.80 + testMatch * 0.05);
    } else {
      agent_type = "CODE";
      agent_confidence = 0.85;
    }

    // 2. Detect Required Skills
    const skills: Record<string, number> = {};

    // Check languages and frameworks
    if (reqLower.includes("python") || pathLower.includes(".py") || selectedFiles.some(f => f.endsWith(".py")) || errLower.includes("python") || reqLower.includes("pytest")) {
      skills["python"] = 0.98;
    }
    if (reqLower.includes("fastapi") || reqLower.includes("uvicorn") || reqLower.includes("pydantic")) {
      skills["fastapi"] = 0.95;
    }
    if (reqLower.includes("react") || reqLower.includes("useState") || reqLower.includes("tsx") || reqLower.includes("jsx") || selectedFiles.some(f => f.endsWith(".tsx") || f.endsWith(".jsx"))) {
      skills["react"] = 0.95;
    }
    if (reqLower.includes("typescript") || reqLower.includes("ts ") || selectedFiles.some(f => f.endsWith(".ts") || f.endsWith(".tsx"))) {
      skills["typescript"] = 0.95;
    }
    if (reqLower.includes("javascript") || reqLower.includes("js ") || selectedFiles.some(f => f.endsWith(".js") || f.endsWith(".jsx"))) {
      skills["javascript"] = 0.90;
    }
    if (reqLower.includes("sql") || reqLower.includes("postgres") || reqLower.includes("sqlite") || reqLower.includes("database") || reqLower.includes("query") || reqLower.includes("select ")) {
      skills["sql"] = 0.92;
    }
    if (reqLower.includes("pyspark") || reqLower.includes("spark") || reqLower.includes("databricks")) {
      skills["pyspark"] = 0.91;
    }
    if (reqLower.includes("spring") || reqLower.includes("java ") || reqLower.includes("jar ") || selectedFiles.some(f => f.endsWith(".java"))) {
      skills["java"] = 0.95;
      if (reqLower.includes("spring boot")) {
        skills["spring boot"] = 0.92;
      }
    }

    // Add general skills based on agent type
    if (agent_type === "DEBUG") {
      skills["debugging"] = 0.90;
    } else if (agent_type === "TEST") {
      skills["unit testing"] = 0.95;
    }

    // Default skill if none detected
    if (Object.keys(skills).length === 0) {
      skills["general coding"] = 0.85;
    }

    // 3. Map Task Family
    let task_family: TaskFingerprint["task_family"] = "code_generation";
    if (agent_type === "DEBUG") {
      task_family = "debugging";
    } else if (agent_type === "TEST") {
      task_family = "testing";
    }

    // 4. Calculate complexity, risk, and context need
    let complexity = 0.40;
    let risk = 0.30;
    let context_need = 0.30;

    // Adjust based on prompt length
    if (request.length > 500) {
      complexity += 0.25;
      context_need += 0.20;
    } else if (request.length > 200) {
      complexity += 0.15;
      context_need += 0.10;
    }

    // Adjust based on error text
    if (errorText.trim().length > 0) {
      complexity += 0.15;
      risk += 0.25;
      context_need += 0.30;
    }

    // Adjust based on skills quantity
    const skillsCount = Object.keys(skills).length;
    if (skillsCount > 2) {
      complexity += 0.15;
      risk += 0.10;
    }

    // Clamps
    complexity = Math.max(0.1, Math.min(0.95, complexity));
    risk = Math.max(0.1, Math.min(0.95, risk));
    context_need = Math.max(0.1, Math.min(0.95, context_need));

    return {
      id: `fp-${Date.now()}`,
      task_id: "", // Will be assigned on create
      agent_type,
      agent_confidence,
      skills,
      task_family,
      complexity,
      risk,
      context_need
    };
  }

  /**
   * Future Interface for LLM-based advanced classification.
   * Can be invoked to run deep semantic analysis when deterministic rules are not sufficient.
   */
  public async llmFingerprint(input: FingerprintInput, geminiClient: any): Promise<TaskFingerprint> {
    // Falls back to standard rule-based classification in this MVP, 
    // but registers the method signature for architectural compliance.
    return Promise.resolve(this.fingerprint(input));
  }
}
