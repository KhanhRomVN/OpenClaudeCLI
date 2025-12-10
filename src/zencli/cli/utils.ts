import os from "os";
import path from "path";
import chalk from "chalk";

export function getCurrentFolder(): string {
  return process.cwd();
}

export function getHomeDir(): string {
  return os.homedir();
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export async function generateInitialConfig() {
  const { ConfigStorage } = await import("../config/storage.js");
  const storage = ConfigStorage.getInstance();
  const savedConfig = await storage.loadConfig();

  const contexts = [
    "4K tokens",
    "8K tokens",
    "16K tokens",
    "32K tokens",
    "128K tokens",
  ];

  return {
    model: savedConfig.model || "gpt-4-turbo",
    provider: savedConfig.provider || "LiteLLM",
    baseUrl: savedConfig.baseUrl || "http://localhost:3030",
    requestsUsed: Math.floor(Math.random() * 1000) + 100,
    contextUsed: contexts[Math.floor(Math.random() * contexts.length)],
    currentFolder: getCurrentFolder(),
    mode: savedConfig.mode || "interactive",
    task: "",
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function validatePath(inputPath: string): boolean {
  try {
    const resolved = path.resolve(inputPath);
    return true;
  } catch {
    return false;
  }
}
