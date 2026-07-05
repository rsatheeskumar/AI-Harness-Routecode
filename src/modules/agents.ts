export abstract class BaseAgent {
  public abstract agent_type: "CODE" | "DEBUG" | "TEST";
  public abstract description: string;
  public abstract base_instructions: string;

  /**
   * Builds the comprehensive execution prompt, combining the user's task,
   * the agent's unique persona, and any relevant skill-specific instructions.
   */
  public buildPrompt(taskPrompt: string, skillsInstructions: string[], errorText?: string): string {
    const skillsSection = skillsInstructions.length > 0
      ? `\n### REQUIRED SKILL PROTOCOLS\nYou must strictly adhere to the following technological instructions:\n${skillsInstructions.map((inst, idx) => `${idx + 1}. ${inst}`).join("\n")}`
      : "";

    const errorSection = errorText && errorText.trim().length > 0
      ? `\n### FAILURES & DIAGNOSTICS LOGS\nAnalyze the following error output, tracebacks, or logs to diagnose the issue:\n\`\`\`\n${errorText}\n\`\`\``
      : "";

    return `### SYSTEM ROLE & PERSONA
${this.base_instructions}
${skillsSection}
${errorSection}

### USER TASK REQUEST
${taskPrompt}

### EXECUTION REQUIREMENTS
1. Analyze the context and requirements.
2. Formulate a clean, robust solution.
3. Output the final code modifications using distinct markdown blocks.
4. Provide a brief explanation of how the changes solve the problem.
`;
  }
}

export class CodeAgent extends BaseAgent {
  public agent_type = "CODE" as const;
  public description = "Optimal for synthesizing new features, modular components, and boilerplate scaffolds.";
  public base_instructions = `You are the RouteCode CODE Agent. 
Your specialty is writing new features, modules, and boilerplate. 
You design highly structured, maintainable, and modular files. 
Always aim to create clean API endpoints, models, and UI views with zero placeholders. 
Provide fully completed, high-quality production code.`;
}

export class DebugAgent extends BaseAgent {
  public agent_type = "DEBUG" as const;
  public description = "Optimal for diagnosing crash traces, failing test suites, and surgical bug fixing.";
  public base_instructions = `You are the RouteCode DEBUG Agent.
Your specialty is diagnosing exceptions, compiling errors, failing endpoints, and logical glitches.
You perform a careful root-cause analysis on stack traces or logs, pinpoint the exact lines of failure,
and propose surgical, minimal edits to resolve the problem without introducing regressions or side-effects.`;
}

export class TestAgent extends BaseAgent {
  public agent_type = "TEST" as const;
  public description = "Optimal for writing mock objects, integration specs, regression suites, and assertions.";
  public base_instructions = `You are the RouteCode TEST Agent.
Your specialty is drafting comprehensive unit tests, mock frameworks, integration assertions, and test configurations.
Always cover edge-cases, validation boundary rules, empty parameters, and error handler conditions. 
Ensure your tests are perfectly independent, decoupled from network connections, and completely deterministic.`;
}

export class AgentFactory {
  public static getAgent(type: "CODE" | "DEBUG" | "TEST"): BaseAgent {
    switch (type) {
      case "CODE":
        return new CodeAgent();
      case "DEBUG":
        return new DebugAgent();
      case "TEST":
        return new TestAgent();
      default:
        throw new Error(`Unsupported agent type: ${type}`);
    }
  }
}
