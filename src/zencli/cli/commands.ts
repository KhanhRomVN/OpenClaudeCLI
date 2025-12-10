import { Command } from "commander";
import chalk from "chalk";
import gradient from "gradient-string";
import inquirer from "inquirer";
import { CLIUI } from "./ui.js";
// import { manageAccounts as manageClaudeAccountsImpl } from "../providers/claude/account-manager.js";
// import { manageAccounts as manageGoogleAccountsImpl } from "../providers/google/account-manager.js";

export function setupCommands(ui: CLIUI): Command {
  const program = new Command();

  program
    .name("zencli")
    .description("Modern CLI for ZenCLI UI Component Library")
    .version("1.0.0", "-v, --version", "Display ZenCLI version");

  program
    .command("start")
    .description("Start ZenCLI interactive mode")
    .action(() => {
      ui.renderAll();
    });

  program
    .command("stats")
    .description("Show current statistics")
    .action(() => {
      ui.renderStats();
    });

  program
    .command("model <model-name>")
    .description("Change AI model")
    .action(async (modelName: string) => {
      await ui.updateConfig({ model: modelName });
      console.log(chalk.green(`✓ Model changed to: ${modelName}`));
    });

  program
    .command("mode <mode-type>")
    .description("Change mode (interactive, auto, debug)")
    .action(async (modeType: string) => {
      if (["interactive", "auto", "debug"].includes(modeType)) {
        await ui.updateConfig({ mode: modeType as any });
        console.log(chalk.green(`✓ Mode changed to: ${modeType}`));
      } else {
        console.log(chalk.red("✗ Invalid mode. Use: interactive, auto, debug"));
      }
    });

  program
    .command("task <task-description>")
    .description("Set a new task")
    .action(async (taskDescription: string) => {
      await ui.updateConfig({ task: taskDescription });
      console.log(chalk.green(`✓ Task set: "${taskDescription}"`));
    });

  program
    .command("config")
    .description("Show current configuration")
    .action(() => {
      const config = {
        model: ui["config"].model,
        provider: ui["config"].provider,
        requests: ui["config"].requestsUsed,
        context: ui["config"].contextUsed,
        folder: ui["config"].currentFolder,
        mode: ui["config"].mode,
      };
      console.log(chalk.cyan(JSON.stringify(config, null, 2)));
    });

  program
    .option("-s, --setting", "Configure ZenCLI settings")
    .action(async (options) => {
      if (options.setting) {
        await showSettings(ui);
      }
    });

  return program;
}

async function showSettings(ui: CLIUI): Promise<void> {
  let continueSettings = true;

  while (continueSettings) {
    console.clear();
    console.log(gradient("cyan", "magenta")("\n⚙️  ZenCLI Settings\n"));

    const currentConfig = ui["config"];

    console.log(chalk.cyan("Current Configuration:"));
    console.log(chalk.gray("─".repeat(50)));
    console.log(
      `${chalk.yellow("Model:")} ${chalk.green(currentConfig.model)}`
    );
    console.log(
      `${chalk.yellow("Provider:")} ${chalk.green(currentConfig.provider)}`
    );
    if (currentConfig.baseUrl) {
      console.log(
        `${chalk.yellow("Base URL:")} ${chalk.green(currentConfig.baseUrl)}`
      );
    }
    console.log(chalk.gray("─".repeat(50)) + "\n");

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to configure?",
        choices: [
          { name: "Change Model", value: "model" },
          { name: "Change Provider", value: "provider" },
          { name: "Set Base URL (LiteLLM)", value: "baseUrl" },
          { name: "Google Account Manager", value: "googleAccounts" },
          { name: "View Full Config", value: "view" },
          { name: "Exit", value: "exit" },
        ],
      },
    ]);

    switch (answers.action) {
      case "model":
        await changeModel(ui);
        break;
      case "provider":
        await changeProvider(ui);
        break;
      case "baseUrl":
        await setBaseUrl(ui);
        break;
      case "googleAccounts":
        await manageGoogleAccounts();
        break;
      case "view":
        viewFullConfig(ui);
        break;
      case "exit":
        console.log(chalk.green("\n✓ Settings closed\n"));
        continueSettings = false;
        break;
    }
  }
}

async function changeModel(ui: CLIUI): Promise<void> {
  const models = ["gpt-4-turbo", "gpt-4", "claude-3", "gemini-pro", "custom"];

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "model",
      message: "Select a model:",
      choices: models,
    },
  ]);

  if (answer.model === "custom") {
    const customAnswer = await inquirer.prompt([
      {
        type: "input",
        name: "customModel",
        message: "Enter custom model name:",
      },
    ]);
    await ui.updateConfig({ model: customAnswer.customModel });
    console.log(
      chalk.green(`\n✓ Model changed to: ${customAnswer.customModel}`)
    );
  } else {
    await ui.updateConfig({ model: answer.model });
    console.log(chalk.green(`\n✓ Model changed to: ${answer.model}`));
  }

  await promptContinue();
}

async function changeProvider(ui: CLIUI): Promise<void> {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: "Select a provider:",
      choices: ["LiteLLM", "Gemini"],
    },
  ]);

  ui.updateConfig({ provider: answer.provider });
  console.log(chalk.green(`\n✓ Provider changed to: ${answer.provider}`));

  await promptContinue();
}

async function setBaseUrl(ui: CLIUI): Promise<void> {
  const answer = await inquirer.prompt([
    {
      type: "input",
      name: "baseUrl",
      message: "Enter LiteLLM base URL (leave empty to use default):",
      default: "",
    },
  ]);

  const baseUrl = answer.baseUrl.trim();
  await ui.updateConfig({ baseUrl: baseUrl || undefined });

  if (baseUrl) {
    console.log(chalk.green(`\n✓ Base URL set to: ${baseUrl}`));
  } else {
    console.log(chalk.green(`\n✓ Base URL cleared (using default)`));
  }

  await promptContinue();
}

async function viewFullConfig(ui: CLIUI): Promise<void> {
  const config = {
    model: ui["config"].model,
    provider: ui["config"].provider,
    baseUrl: ui["config"].baseUrl,
    requests: ui["config"].requestsUsed,
    context: ui["config"].contextUsed,
    folder: ui["config"].currentFolder,
    mode: ui["config"].mode,
  };

  console.log(chalk.cyan("\nFull Configuration:"));
  console.log(chalk.gray("─".repeat(50)));
  console.log(chalk.white(JSON.stringify(config, null, 2)));
  console.log(chalk.gray("─".repeat(50)));

  await promptContinue();
}

async function promptContinue(): Promise<void> {
  await inquirer.prompt([
    {
      type: "input",
      name: "continue",
      message: chalk.gray("Press Enter to continue..."),
    },
  ]);
}

async function manageGoogleAccounts(): Promise<void> {
  try {
    // await manageGoogleAccountsImpl();
    console.log(
      chalk.yellow("\nAccount management not available in this version.")
    );
    await promptContinue();
  } catch (error) {
    console.log(chalk.red(`\n✗ Error: ${(error as Error).message}`));
    await promptContinue();
  }
}
