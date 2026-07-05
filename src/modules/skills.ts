export interface SkillMetadata {
  name: string;
  description: string;
  category: "language" | "framework" | "database" | "tool" | "workflow";
  instructions: string; // Specific instructions for models when executing tasks with this skill
  testCommand?: string;
  lintCommand?: string;
}

export class SkillRegistry {
  private skills: Map<string, SkillMetadata> = new Map();

  constructor() {
    this.seedDefaultSkills();
  }

  private seedDefaultSkills() {
    this.register({
      name: "python",
      description: "Python Programming Language",
      category: "language",
      instructions: "Ensure all Python code adheres to PEP 8 standards, utilizes modern typing conventions (type hints), and uses efficient structures (list comprehensions, generators where suitable). Optimize import groupings.",
      testCommand: "pytest",
      lintCommand: "ruff check ."
    });

    this.register({
      name: "fastapi",
      description: "FastAPI Framework for building APIs with Python",
      category: "framework",
      instructions: "Always leverage asynchronous request handlers (async def), implement robust Pydantic models with clear validation, utilize FastAPI's dependency injection system (Depends), and structure router endpoints cleanly.",
      testCommand: "pytest tests/api/",
      lintCommand: "ruff check ."
    });

    this.register({
      name: "react",
      description: "React Frontend Library with Tailwind CSS",
      category: "framework",
      instructions: "Implement functional components utilizing modern React hooks. Guard state changes carefully to avoid infinite loops, keep variables in useEffect dependency arrays stable, style components purely using clean utility-first Tailwind classes, and import all icons from 'lucide-react'.",
      testCommand: "npm run test",
      lintCommand: "npm run lint"
    });

    this.register({
      name: "typescript",
      description: "TypeScript strongly typed programming language",
      category: "language",
      instructions: "Enable strict type safety, declare clear interfaces, avoid utilizing 'any' types, prefer custom type guard utilities, and utilize named exports at the top level.",
      lintCommand: "tsc --noEmit"
    });

    this.register({
      name: "sql",
      description: "Relational Database querying and schema design",
      category: "database",
      instructions: "Optimize table scans, utilize proper indexes, ensure query parameterized safety to avoid SQL injection, use clear table aliases, and use subqueries or CTEs to maintain readability.",
    });

    this.register({
      name: "unit testing",
      description: "Unit testing codebases",
      category: "workflow",
      instructions: "Write pure, independent tests. Use comprehensive mocking (mock fixtures) to isolate external endpoints. Ensure tests are fully deterministic with zero side-effects. Cover happy paths, negative boundaries, and validation exceptions.",
      testCommand: "pytest"
    });
  }

  /**
   * Registers a new skill dynamically
   */
  public register(skill: SkillMetadata) {
    this.skills.set(skill.name.toLowerCase(), skill);
  }

  /**
   * Retrieves a skill by name
   */
  public get(name: string): SkillMetadata | undefined {
    return this.skills.get(name.toLowerCase());
  }

  /**
   * Returns all registered skills
   */
  public getAll(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  /**
   * Dynamically loads skills associated with a specific task fingerprint
   */
  public loadSkillsForFingerprint(skillsMap: Record<string, number>): SkillMetadata[] {
    const loaded: SkillMetadata[] = [];
    for (const [skillName, confidence] of Object.entries(skillsMap)) {
      if (confidence >= 0.5) { // Threshold for skill relevance
        const skill = this.get(skillName);
        if (skill) {
          loaded.push(skill);
        } else {
          // Dynamically register missing skill with default instructions
          const dynamicSkill: SkillMetadata = {
            name: skillName,
            description: `Dynamically detected expertise: ${skillName}`,
            category: "language",
            instructions: `Adopt professional best practices, strict typing, and optimized file structure patterns for ${skillName}.`
          };
          this.register(dynamicSkill);
          loaded.push(dynamicSkill);
        }
      }
    }
    return loaded;
  }
}
