import fs from "fs/promises";
import path from "path";
import os from "os";
import { CLIConfig } from "../types/index.js";
import type { ClaudeAccount } from "../types/claude.js";
import type { GoogleAccount } from "../types/google.js";

export interface StoredConfig {
  model?: string;
  provider?: "LiteLLM" | "Gemini";
  baseUrl?: string;
  mode?: "interactive" | "auto" | "debug";
  claudeAccounts?: ClaudeAccount[];
  activeClaudeAccountId?: string;
  googleAccounts?: GoogleAccount[];
  activeGoogleAccountId?: string;
}

export class ConfigStorage {
  private static instance: ConfigStorage;
  private configPath: string;

  private constructor() {
    // Lưu config trong home directory: ~/.zencli/config.json
    const homeDir = os.homedir();
    const zenCliDir = path.join(homeDir, ".zencli");
    this.configPath = path.join(zenCliDir, "config.json");
  }

  public static getInstance(): ConfigStorage {
    if (!ConfigStorage.instance) {
      ConfigStorage.instance = new ConfigStorage();
    }
    return ConfigStorage.instance;
  }

  /**
   * Đảm bảo thư mục config tồn tại
   */
  private async ensureConfigDir(): Promise<void> {
    const dir = path.dirname(this.configPath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Load config từ file
   */
  public async loadConfig(): Promise<StoredConfig> {
    try {
      await this.ensureConfigDir();
      const data = await fs.readFile(this.configPath, "utf-8");
      return JSON.parse(data);
    } catch {
      // Nếu file không tồn tại hoặc lỗi, trả về empty config
      return {};
    }
  }

  /**
   * Save config vào file
   */
  public async saveConfig(config: StoredConfig): Promise<void> {
    try {
      await this.ensureConfigDir();
      await fs.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("Failed to save config:", error);
    }
  }

  /**
   * Update một phần config
   */
  public async updateConfig(
    partialConfig: Partial<StoredConfig>
  ): Promise<void> {
    const currentConfig = await this.loadConfig();
    const newConfig = { ...currentConfig, ...partialConfig };
    await this.saveConfig(newConfig);
  }

  /**
   * Clear toàn bộ config
   */
  public async clearConfig(): Promise<void> {
    try {
      await fs.unlink(this.configPath);
    } catch {
      // Ignore nếu file không tồn tại
    }
  }

  // ==================== Claude Account Management ====================

  /**
   * Save a Claude account
   */
  public async saveClaudeAccount(account: ClaudeAccount): Promise<void> {
    const config = await this.loadConfig();
    const accounts = config.claudeAccounts || [];

    // Check if account already exists
    const existingIndex = accounts.findIndex(
      (acc) => acc.accountId === account.accountId
    );

    if (existingIndex >= 0) {
      // Update existing account
      accounts[existingIndex] = account;
    } else {
      // Add new account
      accounts.push(account);
    }

    await this.updateConfig({ claudeAccounts: accounts });
  }

  /**
   * Get a specific Claude account by ID
   */
  public async getClaudeAccount(
    accountId: string
  ): Promise<ClaudeAccount | null> {
    const config = await this.loadConfig();
    const accounts = config.claudeAccounts || [];
    return accounts.find((acc) => acc.accountId === accountId) || null;
  }

  /**
   * List all Claude accounts
   */
  public async listClaudeAccounts(): Promise<ClaudeAccount[]> {
    const config = await this.loadConfig();
    return config.claudeAccounts || [];
  }

  /**
   * Remove a Claude account
   */
  public async removeClaudeAccount(accountId: string): Promise<void> {
    const config = await this.loadConfig();
    const accounts = config.claudeAccounts || [];

    const filteredAccounts = accounts.filter(
      (acc) => acc.accountId !== accountId
    );

    // If the removed account was active, clear active account
    if (config.activeClaudeAccountId === accountId) {
      await this.updateConfig({
        claudeAccounts: filteredAccounts,
        activeClaudeAccountId: undefined,
      });
    } else {
      await this.updateConfig({ claudeAccounts: filteredAccounts });
    }
  }

  /**
   * Set the active Claude account
   */
  public async setActiveClaudeAccount(accountId: string): Promise<void> {
    const account = await this.getClaudeAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }
    await this.updateConfig({ activeClaudeAccountId: accountId });
  }

  /**
   * Get the active Claude account
   */
  public async getActiveClaudeAccount(): Promise<ClaudeAccount | null> {
    const config = await this.loadConfig();
    if (!config.activeClaudeAccountId) {
      return null;
    }
    return this.getClaudeAccount(config.activeClaudeAccountId);
  }

  /**
   * Update the last used timestamp for an account
   */
  public async updateAccountLastUsed(accountId: string): Promise<void> {
    const account = await this.getClaudeAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    account.session.lastUsed = Date.now();
    await this.saveClaudeAccount(account);
  }

  // ==================== Google Account Management ====================

  /**
   * Save a Google account
   */
  public async saveGoogleAccount(account: GoogleAccount): Promise<void> {
    const config = await this.loadConfig();
    const accounts = config.googleAccounts || [];

    // Check if account already exists
    const existingIndex = accounts.findIndex(
      (acc) => acc.accountId === account.accountId
    );

    if (existingIndex >= 0) {
      // Update existing account
      accounts[existingIndex] = account;
    } else {
      // Add new account
      accounts.push(account);
    }

    await this.updateConfig({ googleAccounts: accounts });
  }

  /**
   * Get a specific Google account by ID
   */
  public async getGoogleAccount(
    accountId: string
  ): Promise<GoogleAccount | null> {
    const config = await this.loadConfig();
    const accounts = config.googleAccounts || [];
    return accounts.find((acc) => acc.accountId === accountId) || null;
  }

  /**
   * List all Google accounts
   */
  public async listGoogleAccounts(): Promise<GoogleAccount[]> {
    const config = await this.loadConfig();
    return config.googleAccounts || [];
  }

  /**
   * Remove a Google account
   */
  public async removeGoogleAccount(accountId: string): Promise<void> {
    const config = await this.loadConfig();
    const accounts = config.googleAccounts || [];

    const filteredAccounts = accounts.filter(
      (acc) => acc.accountId !== accountId
    );

    // If the removed account was active, clear active account
    if (config.activeGoogleAccountId === accountId) {
      await this.updateConfig({
        googleAccounts: filteredAccounts,
        activeGoogleAccountId: undefined,
      });
    } else {
      await this.updateConfig({ googleAccounts: filteredAccounts });
    }
  }

  /**
   * Set the active Google account
   */
  public async setActiveGoogleAccount(accountId: string): Promise<void> {
    const account = await this.getGoogleAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }
    await this.updateConfig({ activeGoogleAccountId: accountId });
  }

  /**
   * Get the active Google account
   */
  public async getActiveGoogleAccount(): Promise<GoogleAccount | null> {
    const config = await this.loadConfig();
    if (!config.activeGoogleAccountId) {
      return null;
    }
    return this.getGoogleAccount(config.activeGoogleAccountId);
  }

  /**
   * Update the last used timestamp for a Google account
   */
  public async updateGoogleAccountLastUsed(accountId: string): Promise<void> {
    const account = await this.getGoogleAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    account.session.lastUsed = Date.now();
    await this.saveGoogleAccount(account);
  }
}
