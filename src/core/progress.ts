import chalk from "chalk";
import ora from "ora";

export class CommandProgress {
  private current = 0;

  constructor(
    private readonly title: string,
    private readonly totalSteps: number,
  ) {
    if (title.trim().length > 0) {
      console.log(chalk.bold(`\n${this.title}`));
    }
  }

  async step<T>(label: string, task: () => Promise<T>): Promise<T> {
    this.current += 1;
    const prefix = `[${this.current}/${this.totalSteps}]`;
    const spinner = ora(`${prefix} ${label}`).start();

    try {
      const result = await task();
      spinner.succeed(chalk.green(`${prefix} ${label}`));
      return result;
    } catch (error) {
      spinner.fail(chalk.red(`${prefix} ${label}`));
      throw error;
    }
  }

  async interactiveStep<T>(label: string, task: () => Promise<T>): Promise<T> {
    this.current += 1;
    const prefix = `[${this.current}/${this.totalSteps}]`;
    console.log(chalk.cyan(`${prefix} ${label}...`));

    try {
      const result = await task();
      console.log(chalk.green(`✔ ${prefix} ${label}`));
      return result;
    } catch (error) {
      console.log(chalk.red(`✖ ${prefix} ${label}`));
      throw error;
    }
  }

  /**
   * Like interactiveStep but for tasks that return { status: 'success' | 'failed' }
   * (e.g. brew) so we show ✔/✖ from the result instead of always succeeding.
   */
  async interactiveStepWithStatus<T extends { status: string }>(
    label: string,
    task: () => Promise<T>,
  ): Promise<T> {
    this.current += 1;
    const prefix = `[${this.current}/${this.totalSteps}]`;
    console.log(chalk.bold.cyan(`${prefix} ${label}`));

    const result = await task();

    if (result.status === "failed") {
      console.log(chalk.red(`  ✖ ${prefix} ${label}`));
    } else if (result.status === "warn") {
      console.log(chalk.yellow(`  ⚠ ${prefix} ${label}`));
    } else {
      console.log(chalk.green(`  ✔ ${prefix} ${label}`));
    }

    return result;
  }

  tick(label: string): void {
    this.current += 1;
    const prefix = `[${this.current}/${this.totalSteps}]`;
    console.log(chalk.green(`${prefix} ${label}`));
  }

  info(message: string): void {
    console.log(chalk.dim(`  ${message}`));
  }

  done(message: string): void {
    console.log(chalk.green(message));
  }
}
