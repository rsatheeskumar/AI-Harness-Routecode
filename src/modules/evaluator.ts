export interface EvaluationRequest {
  taskId: string;
  codePatch: string;
  taskFamily: "debugging" | "code_generation" | "testing";
  skills: string[];
}

export interface StepResult {
  stepName: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ContainerEvaluationResult {
  containerId: string;
  imageName: string;
  passed: boolean;
  steps: StepResult[];
  overallDurationMs: number;
}

export interface Evaluator {
  evaluate(request: EvaluationRequest): Promise<ContainerEvaluationResult>;
}

export class PythonDockerEvaluator implements Evaluator {
  /**
   * Evaluates the generated Python code securely inside a simulated Docker container.
   */
  public async evaluate(request: EvaluationRequest): Promise<ContainerEvaluationResult> {
    const { taskId, codePatch, taskFamily } = request;
    const containerId = `rc-sandbox-${Math.random().toString(36).substring(2, 10)}`;
    const imageName = "routecode/runtime-python:3.12-slim";
    const steps: StepResult[] = [];
    const startTime = Date.now();

    // 1. Step 1: Docker Initialization & Compile Check
    const startStep1 = Date.now();
    let compileExitCode = 0;
    let compileStdout = "Successfully compiled modules.\nNo syntax errors found.";
    let compileStderr = "";

    // Basic heuristic: check for syntax error patterns in generated response
    if (codePatch.includes("SyntaxError") || codePatch.includes("<<<") || codePatch.includes(">>>")) {
      compileExitCode = 1;
      compileStdout = "Compilation failed.";
      compileStderr = "SyntaxError: invalid syntax near '<<<'";
    }

    steps.push({
      stepName: "Python Compile Check",
      command: "python -m py_compile app/main.py",
      exitCode: compileExitCode,
      stdout: compileStdout,
      stderr: compileStderr,
      durationMs: Date.now() - startStep1
    });

    // 2. Step 2: Ruff Linter
    const startStep2 = Date.now();
    let ruffExitCode = 0;
    let ruffStdout = "All format checks passed. 0 issues detected.";
    let ruffStderr = "";

    if (codePatch.toLowerCase().includes("import os") && !codePatch.includes("os.")) {
      ruffExitCode = 1; // Unused import
      ruffStdout = "app/main.py:1:1: F401 'os' imported but unused\nFound 1 error.";
    }

    steps.push({
      stepName: "Ruff Linter Check",
      command: "ruff check app/",
      exitCode: ruffExitCode,
      stdout: ruffStdout,
      stderr: ruffStderr,
      durationMs: Date.now() - startStep2
    });

    // 3. Step 3: Pytest Execution
    const startStep3 = Date.now();
    let testExitCode = 0;
    let testStdout = "";
    let testStderr = "";

    if (taskFamily === "debugging") {
      testStdout = `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.0.0, pluggy-1.4.0
rootdir: /app
collected 2 items

tests/test_endpoints.py .                                                [ 50%]
tests/test_regression.py .                                               [100%]

============================== 2 passed in 0.38s ===============================`;
    } else if (taskFamily === "testing") {
      testStdout = `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.0.0, pluggy-1.4.0
rootdir: /app
collected 5 items

tests/test_validation.py .....                                           [100%]

============================== 5 passed in 0.51s ===============================`;
    } else {
      testStdout = `============================= test session starts ==============================
platform linux -- Python 3.12.1, pytest-8.0.0, pluggy-1.4.0
rootdir: /app
collected 1 item

tests/test_feature.py .                                                  [100%]

============================== 1 passed in 0.12s ===============================`;
    }

    // If linter or compiler fails, pytest doesn't run or fails
    if (compileExitCode !== 0 || ruffExitCode !== 0) {
      testExitCode = 1;
      testStdout = "Pytest execution skipped due to syntax errors or compilation failures.";
      testStderr = "ImportError: cannot import name 'App' from 'app.main'";
    }

    steps.push({
      stepName: "Pytest Suite",
      command: "pytest tests/",
      exitCode: testExitCode,
      stdout: testStdout,
      stderr: testStderr,
      durationMs: Date.now() - startStep3
    });

    const overallDurationMs = Date.now() - startTime;
    const passed = compileExitCode === 0 && ruffExitCode === 0 && testExitCode === 0;

    // Simulate 400ms minor delay to give it a realistic containerized execution feel
    await new Promise((resolve) => setTimeout(resolve, 600));

    return {
      containerId,
      imageName,
      passed,
      steps,
      overallDurationMs
    };
  }
}

export class EvaluatorFactory {
  public static getEvaluator(language: string): Evaluator {
    const cleanLang = language.toLowerCase();
    if (cleanLang === "python") {
      return new PythonDockerEvaluator();
    }
    // Default fallback evaluator that simulates checks
    return new PythonDockerEvaluator();
  }
}
