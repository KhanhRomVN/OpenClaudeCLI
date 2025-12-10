import { parseMarkdown } from "./markdown.js";
import { CLITerminal } from "./cli-terminal.js";

// ============================================
// TYPES & INTERFACES
// ============================================

declare global {
  interface Window {
    claude: {
      getAuthStatus: () => Promise<boolean>;
      login: () => Promise<{ success: boolean; error?: string }>;
      logout: () => Promise<void>;
      createConversation: (model?: string) => Promise<{
        conversationId: string;
        parentMessageUuid: string;
      }>;
      sendMessage: (
        convId: string,
        message: string,
        parentUuid: string,
        attachments?: AttachmentPayload[]
      ) => Promise<void>;
      stopResponse: (convId: string) => Promise<void>;
      uploadAttachments: (
        files: Array<{
          name: string;
          size: number;
          type: string;
          data: ArrayBuffer | Uint8Array | number[];
        }>
      ) => Promise<UploadedAttachmentPayload[]>;
      getAccounts: () => Promise<{ success: boolean; accounts: AccountInfo[] }>;
      switchAccount: (accountId: string) => Promise<{ success: boolean }>;
      getActiveAccount: () => Promise<{
        success: boolean;
        account: AccountInfo | null;
      }>;
      onMessageStream: (callback: (data: StreamData) => void) => void;
      onMessageComplete: (callback: (data: CompleteData) => void) => void;
      onMessageThinking: (callback: (data: ThinkingData) => void) => void;
      onMessageThinkingStream: (
        callback: (data: ThinkingStreamData) => void
      ) => void;
      onMessageToolUse: (callback: (data: ToolUseData) => void) => void;
      onMessageToolResult: (callback: (data: ToolResultData) => void) => void;
    };
  }
}

interface AccountInfo {
  id: string;
  orgId: string;
  sessionKey: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  addedAt: number;
  lastUsed: number;
}

interface AttachmentPayload {
  document_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  file_url?: string;
  extracted_content?: string;
}

interface UploadedAttachmentPayload extends AttachmentPayload {}

interface UploadedAttachment extends AttachmentPayload {
  id: string;
}

interface ChatTab {
  id: string;
  name: string;
  accountId: string;
  conversationId: string | null;
  parentMessageUuid: string | null;
  model: string;
  messages: HTMLElement[];
  isLoading: boolean;
  streamingElement: HTMLElement | null;
  pendingAttachments: UploadedAttachment[];
  displayMode: "gui" | "cli";
  terminal: CLITerminal | null;
}

interface StreamData {
  conversationId: string;
  blockIndex?: number;
  fullText: string;
}

interface CompleteData {
  conversationId: string;
  fullText: string;
  steps: any[];
  messageUuid: string;
}

interface ThinkingData {
  conversationId: string;
  blockIndex: number;
  isThinking: boolean;
  thinkingText?: string;
}

interface ThinkingStreamData {
  conversationId: string;
  blockIndex: number;
  thinking: string;
}

interface ToolUseData {
  conversationId: string;
  blockIndex: number;
  toolName: string;
  message?: string;
  input?: unknown;
  isRunning: boolean;
}

interface ToolResultData {
  conversationId: string;
  blockIndex: number;
  toolName: string;
  result: unknown;
  isError: boolean;
}

// ============================================
// CONSTANTS
// ============================================

const MAX_TABS = 3;
const TAB_STORAGE_KEY = "chatTabs";
const ACTIVE_TAB_KEY = "activeTabId";

const modelDisplayNames: Record<string, string> = {
  "claude-opus-4-5-20251101": "Opus 4.5",
  "claude-sonnet-4-5-20250929": "Sonnet 4.5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

// ============================================
// STATE
// ============================================

let tabs: ChatTab[] = [];
let activeTabId: string | null = null;
let accounts: AccountInfo[] = [];
let selectedAccountForNewTab: string | null = null;

// ============================================
// UTILITY FUNCTIONS
// ============================================

const $ = (id: string) => document.getElementById(id);

function escapeHtml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    sizes.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function getAccountColor(accountId: string): string {
  const colors = ["#4A90E2", "#50C878", "#FFB347", "#FF6B6B", "#9B59B6"];
  const hash = accountId
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getAccountInitial(account: AccountInfo): string {
  if (account.name) return account.name[0].toUpperCase();
  if (account.email) return account.email[0].toUpperCase();
  return "A";
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function scrollToBottom() {
  const messages = $("messages");
  if (messages) messages.scrollTop = messages.scrollHeight;
}

// ============================================
// TAB MANAGEMENT
// ============================================

function canCreateNewTab(): boolean {
  return tabs.length < MAX_TABS;
}

function getActiveTab(): ChatTab | null {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function createTab(accountId: string, name?: string): ChatTab {
  const tabId = crypto.randomUUID();
  const tabName = name || `Chat ${tabs.length + 1}`;

  const tab: ChatTab = {
    id: tabId,
    name: tabName,
    accountId,
    conversationId: null,
    parentMessageUuid: null,
    model: "claude-opus-4-5-20251101",
    messages: [],
    isLoading: false,
    streamingElement: null,
    pendingAttachments: [],
    displayMode: "gui",
    terminal: null,
  };

  tabs.push(tab);
  activeTabId = tabId;

  // Initialize terminal for this tab
  initializeTerminal(tab);

  renderTabs();
  renderActiveTab();
  saveTabs();
  updateInputBadge();
  updateModelSelector();

  return tab;
}

function initializeTerminal(tab: ChatTab): void {
  const terminalContainer = $("terminal-container");
  if (!terminalContainer) return;

  // Clear existing terminal
  terminalContainer.innerHTML = "";

  // Create new terminal instance
  const terminal = new CLITerminal(terminalContainer);
  tab.terminal = terminal;

  // Write welcome message
  terminal.writeln(
    "\x1b[1;36m╔═══════════════════════════════════════════════════════╗\x1b[0m"
  );
  terminal.writeln(
    "\x1b[1;36m║\x1b[0m           \x1b[1;35mZenCLI Terminal - Open Claude\x1b[0m           \x1b[1;36m║\x1b[0m"
  );
  terminal.writeln(
    "\x1b[1;36m╚═══════════════════════════════════════════════════════╝\x1b[0m"
  );
  terminal.writeln("");
  terminal.writeln(
    "\x1b[32mTerminal ready. Messages will sync with GUI.\x1b[0m"
  );
  terminal.writeln("");
  terminal.write("\x1b[36m❯\x1b[0m ");

  // Handle terminal input
  let inputBuffer = "";
  terminal.onInput((data) => {
    // Handle special keys
    if (data === "\r") {
      // Enter
      terminal.writeln("");
      if (inputBuffer.trim()) {
        // Send message from CLI
        handleCLIMessage(tab, inputBuffer.trim());
        inputBuffer = "";
      }
      terminal.write("\x1b[36m❯\x1b[0m ");
    } else if (data === "\u007F") {
      // Backspace
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        terminal.write("\b \b");
      }
    } else if (data === "\u0003") {
      // Ctrl+C
      terminal.writeln("^C");
      inputBuffer = "";
      terminal.write("\x1b[36m❯\x1b[0m ");
    } else {
      // Regular character
      inputBuffer += data;
      terminal.write(data);
    }
  });
}

async function handleCLIMessage(tab: ChatTab, message: string): Promise<void> {
  if (!tab.terminal) return;

  // Display user message in terminal
  tab.terminal.writeln(`\x1b[33mYou:\x1b[0m ${message}`);

  // Add message to GUI
  addMessage("user", message);

  // Send message through existing sendMessage flow
  const input = $("input") as HTMLTextAreaElement;
  if (input) {
    input.value = message;
    await sendMessage();
    input.value = "";
  }
}

function switchTab(tabId: string) {
  if (activeTabId === tabId) return;

  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;

  activeTabId = tabId;
  renderTabs();
  renderActiveTab();
  updateInputBadge();
  updateModelSelector();
  saveTabs();
}

function closeTab(tabId: string) {
  if (tabs.length === 1) {
    console.log("Cannot close the last tab");
    return;
  }

  const tabIndex = tabs.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) return;

  tabs.splice(tabIndex, 1);

  if (activeTabId === tabId) {
    activeTabId = tabs[Math.max(0, tabIndex - 1)].id;
  }

  renderTabs();
  renderActiveTab();
  updateInputBadge();
  updateModelSelector();
  saveTabs();
}

function updateTabName(tabId: string, name: string) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tab.name = name;
  renderTabs();
  if (activeTabId === tabId) {
    updateInputBadge();
  }
  saveTabs();
}

function toggleDisplayMode() {
  const tab = getActiveTab();
  if (!tab) return;

  // Toggle mode
  tab.displayMode = tab.displayMode === "gui" ? "cli" : "gui";

  // Update chat container data attribute
  const chatContainer = $("chat-container");
  if (chatContainer) {
    chatContainer.setAttribute("data-mode", tab.displayMode);
  }

  // Update toggle button appearance
  const toggleBtn = $("toggle-mode-btn");
  if (toggleBtn) {
    if (tab.displayMode === "cli") {
      toggleBtn.classList.add("mode-cli");
    } else {
      toggleBtn.classList.remove("mode-cli");
    }
  }

  saveTabs();
}

// ============================================
// RENDERING
// ============================================

function renderTabs() {
  const container = $("tabs-container");
  const newTabBtn = $("new-tab-btn") as HTMLButtonElement;

  if (!container) return;

  container.innerHTML = tabs
    .map((tab) => {
      const account = accounts.find((a) => a.id === tab.accountId);
      const badgeColor = getAccountColor(tab.accountId);

      return `
        <div class="tab ${
          tab.id === activeTabId ? "active" : ""
        }" data-tab-id="${tab.id}">
          <div class="tab-badge" style="background: ${badgeColor};"></div>
          <span class="tab-name">${escapeHtml(tab.name)}</span>
          <button class="tab-close" data-tab-id="${tab.id}">×</button>
        </div>
      `;
    })
    .join("");

  // Update new tab button state
  if (newTabBtn) {
    newTabBtn.disabled = !canCreateNewTab();
  }

  // Add event listeners
  container.querySelectorAll(".tab").forEach((el) => {
    const tabId = (el as HTMLElement).dataset.tabId;
    if (!tabId) return;

    el.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("tab-close")) {
        switchTab(tabId);
      }
    });
  });

  container.querySelectorAll(".tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = (btn as HTMLElement).dataset.tabId;
      if (tabId) closeTab(tabId);
    });
  });
}

function renderActiveTab() {
  const tab = getActiveTab();
  const messagesContainer = $("messages");
  const emptyState = $("empty-state");
  const chatContainer = $("chat-container");
  const terminalContainer = $("terminal-container");

  if (!messagesContainer || !emptyState) return;

  // Update chat container mode
  if (chatContainer && tab) {
    chatContainer.setAttribute("data-mode", tab.displayMode);
  }

  // Update toggle button appearance
  const toggleBtn = $("toggle-mode-btn");
  if (toggleBtn && tab) {
    if (tab.displayMode === "cli") {
      toggleBtn.classList.add("mode-cli");
    } else {
      toggleBtn.classList.remove("mode-cli");
    }
  }

  // Initialize terminal if not already done
  if (tab && !tab.terminal && terminalContainer) {
    initializeTerminal(tab);
  }

  // Clear current messages
  messagesContainer.innerHTML = "";

  if (!tab || tab.messages.length === 0) {
    messagesContainer.appendChild(emptyState);
    return;
  }

  // Render tab's messages
  tab.messages.forEach((msg) => {
    messagesContainer.appendChild(msg.cloneNode(true));
  });

  scrollToBottom();
}

function updateInputBadge() {
  const tab = getActiveTab();
  const badgeText = $("badge-text");

  if (badgeText && tab) {
    badgeText.textContent = tab.name;
  }
}

function updateModelSelector() {
  const tab = getActiveTab();
  const modelSelector = $("model-selector") as HTMLSelectElement;

  if (modelSelector && tab) {
    modelSelector.value = tab.model;
  }
}

function renderAccountList(containerId: string) {
  const container = $(containerId);
  if (!container) return;

  if (accounts.length === 0) {
    container.innerHTML =
      '<div style="text-align: center; padding: 20px; color: rgba(0,0,0,0.4);">No accounts available</div>';
    return;
  }

  container.innerHTML = accounts
    .map((account) => {
      const initial = getAccountInitial(account);
      const color = getAccountColor(account.id);
      const isSelected = selectedAccountForNewTab === account.id;

      return `
        <div class="account-option ${
          isSelected ? "selected" : ""
        }" data-account-id="${account.id}">
          <div class="account-avatar" style="background: ${color};">${initial}</div>
          <div class="account-info">
            <div class="account-email">${escapeHtml(
              account.email || "Unknown"
            )}</div>
            <div class="account-id">${escapeHtml(
              account.id.substring(0, 16)
            )}...</div>
          </div>
        </div>
      `;
    })
    .join("");

  // Add click listeners
  container.querySelectorAll(".account-option").forEach((el) => {
    el.addEventListener("click", () => {
      const accountId = (el as HTMLElement).dataset.accountId;
      if (accountId) {
        selectedAccountForNewTab = accountId;
        renderAccountList(containerId);
      }
    });
  });
}

// ============================================
// MESSAGES
// ============================================

function addMessage(
  role: "user" | "assistant",
  content: string,
  raw = false
): HTMLElement {
  const el = document.createElement("div");
  el.className = `message ${role}`;

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";
  contentDiv.innerHTML =
    role === "user"
      ? escapeHtml(content)
      : raw
      ? content
      : parseMarkdown(content);

  el.appendChild(contentDiv);

  const tab = getActiveTab();
  if (tab) {
    tab.messages.push(el);
  }

  const messagesContainer = $("messages");
  if (messagesContainer) {
    const emptyState = $("empty-state");
    if (emptyState && emptyState.parentElement === messagesContainer) {
      messagesContainer.removeChild(emptyState);
    }
    messagesContainer.appendChild(el);
    scrollToBottom();
  }

  return el;
}

// ============================================
// ATTACHMENTS
// ============================================

function renderAttachmentList() {
  const tab = getActiveTab();
  if (!tab) return;

  const container = $("attachment-container");
  const list = $("attachment-list");

  if (!container || !list) return;

  if (tab.pendingAttachments.length === 0) {
    container.classList.remove("visible");
    return;
  }

  container.classList.add("visible");

  list.innerHTML = tab.pendingAttachments
    .map((a) => {
      const icon = a.file_type?.startsWith("image/") ? "🖼️" : "📄";
      return `
        <div class="attachment-pill" data-id="${a.id}">
          <div class="attachment-icon">${icon}</div>
          <div class="attachment-meta">
            <div class="attachment-name">${escapeHtml(a.file_name)}</div>
            <div class="attachment-size">${formatFileSize(a.file_size)}</div>
          </div>
          <button class="attachment-remove" data-id="${a.id}">×</button>
        </div>
      `;
    })
    .join("");

  // Add remove listeners
  list.querySelectorAll(".attachment-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id && tab) {
        tab.pendingAttachments = tab.pendingAttachments.filter(
          (a) => a.id !== id
        );
        renderAttachmentList();
      }
    });
  });
}

async function handleFileSelection(fileList: FileList | null) {
  const tab = getActiveTab();
  if (!fileList || fileList.length === 0 || !tab) return;

  const statusEl = $("attachment-status");
  if (statusEl) {
    statusEl.textContent = "Uploading...";
    statusEl.style.display = "block";
    statusEl.classList.remove("error");
  }

  try {
    const uploadPayload = await Promise.all(
      Array.from(fileList).map(async (file) => ({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        data: await file.arrayBuffer(),
      }))
    );

    const results = await window.claude.uploadAttachments(uploadPayload);
    const normalized = results.map((res) => ({
      id: crypto.randomUUID(),
      ...res,
    }));

    tab.pendingAttachments = [...tab.pendingAttachments, ...normalized];
    renderAttachmentList();

    if (statusEl) {
      statusEl.style.display = "none";
    }
  } catch (e: any) {
    if (statusEl) {
      statusEl.textContent = e?.message || "Upload failed";
      statusEl.classList.add("error");
    }
  }
}

// ============================================
// MESSAGING
// ============================================

async function sendMessage() {
  const tab = getActiveTab();
  const input = $("input") as HTMLTextAreaElement;

  if (!tab || !input) return;

  const message = input.value.trim();
  if (!message) return;

  // Create conversation if needed
  if (!tab.conversationId) {
    try {
      const result = await window.claude.createConversation(tab.model);
      tab.conversationId = result.conversationId;
      tab.parentMessageUuid = result.parentMessageUuid;
    } catch (e) {
      console.error("Failed to create conversation:", e);
      return;
    }
  }

  // Add user message
  addMessage("user", message);

  // Clear input
  input.value = "";
  autoResize(input);

  // Get attachments
  const attachments = tab.pendingAttachments.map((a) => ({
    document_id: a.document_id,
    file_name: a.file_name,
    file_size: a.file_size,
    file_type: a.file_type,
    file_url: a.file_url,
    extracted_content: a.extracted_content,
  }));

  // Clear attachments
  tab.pendingAttachments = [];
  renderAttachmentList();

  // Create assistant message placeholder
  const assistantMsg = addMessage("assistant", "", true);
  tab.streamingElement = assistantMsg.querySelector(".message-content");
  tab.isLoading = true;

  // Show stop button
  const sendBtn = $("send-btn");
  const stopBtn = $("stop-btn");
  if (sendBtn) sendBtn.style.display = "none";
  if (stopBtn) stopBtn.classList.add("visible");

  try {
    await window.claude.sendMessage(
      tab.conversationId!,
      message,
      tab.parentMessageUuid || tab.conversationId!,
      attachments
    );
  } catch (e) {
    console.error("Failed to send message:", e);
    if (tab.streamingElement) {
      tab.streamingElement.innerHTML = `<span style="color: #ff453a;">Error: ${escapeHtml(
        String(e)
      )}</span>`;
    }
    tab.isLoading = false;

    if (sendBtn) sendBtn.style.display = "flex";
    if (stopBtn) stopBtn.classList.remove("visible");
  }
}

async function stopStreaming() {
  const tab = getActiveTab();
  if (!tab || !tab.conversationId) return;

  try {
    await window.claude.stopResponse(tab.conversationId);
  } catch (e) {
    console.error("Failed to stop response:", e);
  }
}

// ============================================
// PERSISTENCE
// ============================================

function saveTabs() {
  const tabsData = tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    accountId: tab.accountId,
    conversationId: tab.conversationId,
    parentMessageUuid: tab.parentMessageUuid,
    model: tab.model,
    displayMode: tab.displayMode,
  }));

  localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabsData));
  localStorage.setItem(ACTIVE_TAB_KEY, activeTabId || "");
}

async function restoreTabs() {
  const tabsData = localStorage.getItem(TAB_STORAGE_KEY);
  const savedActiveTabId = localStorage.getItem(ACTIVE_TAB_KEY);

  if (tabsData) {
    try {
      const parsed = JSON.parse(tabsData);
      for (const tabData of parsed) {
        const tab: ChatTab = {
          id: tabData.id,
          name: tabData.name,
          accountId: tabData.accountId,
          conversationId: tabData.conversationId,
          parentMessageUuid: tabData.parentMessageUuid,
          model: tabData.model,
          messages: [],
          isLoading: false,
          streamingElement: null,
          pendingAttachments: [],
          displayMode: tabData.displayMode || "gui",
          terminal: null,
        };
        tabs.push(tab);
      }

      if (savedActiveTabId && tabs.find((t) => t.id === savedActiveTabId)) {
        activeTabId = savedActiveTabId;
      } else if (tabs.length > 0) {
        activeTabId = tabs[0].id;
      }
    } catch (e) {
      console.error("Failed to restore tabs:", e);
    }
  }

  // If no tabs, create default tab
  if (tabs.length === 0) {
    const activeAccount = await window.claude.getActiveAccount();
    if (activeAccount.success && activeAccount.account) {
      createTab(activeAccount.account.id, "Chat 1");
    }
  } else {
    renderTabs();
    renderActiveTab();
    updateInputBadge();
    updateModelSelector();
  }
}

// ============================================
// MODALS
// ============================================

function showLoginModal() {
  const modal = $("login-modal");
  if (modal) modal.classList.add("visible");
}

function hideLoginModal() {
  const modal = $("login-modal");
  if (modal) modal.classList.remove("visible");
}

function showAccountSelectModal() {
  selectedAccountForNewTab = null;
  renderAccountList("new-tab-account-list");
  const modal = $("account-select-modal");
  if (modal) modal.classList.add("visible");
}

function hideAccountSelectModal() {
  const modal = $("account-select-modal");
  if (modal) modal.classList.remove("visible");
  selectedAccountForNewTab = null;
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // New tab button
  const newTabBtn = $("new-tab-btn");
  newTabBtn?.addEventListener("click", () => {
    if (canCreateNewTab()) {
      showAccountSelectModal();
    }
  });

  // Account selection modal
  const cancelNewTab = $("cancel-new-tab");
  cancelNewTab?.addEventListener("click", hideAccountSelectModal);

  const accountModalOverlay = $("account-modal-overlay");
  accountModalOverlay?.addEventListener("click", hideAccountSelectModal);

  const addAccountForTab = $("add-account-for-tab");
  addAccountForTab?.addEventListener("click", async () => {
    if (selectedAccountForNewTab) {
      createTab(selectedAccountForNewTab);
      hideAccountSelectModal();
    } else {
      // Add new account
      try {
        const result = await window.claude.login();
        if (result.success) {
          await loadAccounts();
          hideAccountSelectModal();
          // Reload to show new account
          location.reload();
        }
      } catch (e) {
        console.error("Login failed:", e);
      }
    }
  });

  // Input badge (rename tab)
  const inputBadge = $("input-badge");
  inputBadge?.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) return;

    const newName = prompt("Enter new tab name:", tab.name);
    if (newName && newName.trim()) {
      updateTabName(tab.id, newName.trim());
    }
  });

  // Model selector
  const modelSelector = $("model-selector") as HTMLSelectElement;
  modelSelector?.addEventListener("change", () => {
    const tab = getActiveTab();
    if (tab) {
      tab.model = modelSelector.value;
      saveTabs();
    }
  });

  // Input
  const input = $("input") as HTMLTextAreaElement;
  input?.addEventListener("input", () => autoResize(input));
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Send button
  const sendBtn = $("send-btn");
  sendBtn?.addEventListener("click", sendMessage);

  // Stop button
  const stopBtn = $("stop-btn");
  stopBtn?.addEventListener("click", stopStreaming);

  // Attach button
  const attachBtn = $("attach-btn");
  const fileInput = $("file-input") as HTMLInputElement;
  attachBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    handleFileSelection(fileInput.files);
    fileInput.value = "";
  });

  // Logout button
  const logoutBtn = $("logout-btn");
  logoutBtn?.addEventListener("click", async () => {
    if (confirm("Are you sure you want to sign out?")) {
      await window.claude.logout();
      location.reload();
    }
  });

  // Toggle mode button
  const toggleModeBtn = $("toggle-mode-btn");
  toggleModeBtn?.addEventListener("click", () => {
    toggleDisplayMode();
  });

  // Terminal toggle button
  const terminalToggleBtn = $("terminal-toggle-btn");
  const terminalWrapper = $("terminal-wrapper");
  terminalToggleBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    terminalWrapper?.classList.toggle("collapsed");

    // Resize terminal when expanded
    if (!terminalWrapper?.classList.contains("collapsed")) {
      const tab = getActiveTab();
      if (tab?.terminal) {
        setTimeout(() => tab.terminal?.resize(), 100);
      }
    }
  });

  // Terminal header click to toggle
  const terminalHeader = document.querySelector(".terminal-header");
  terminalHeader?.addEventListener("click", () => {
    terminalWrapper?.classList.toggle("collapsed");

    // Resize terminal when expanded
    if (!terminalWrapper?.classList.contains("collapsed")) {
      const tab = getActiveTab();
      if (tab?.terminal) {
        setTimeout(() => tab.terminal?.resize(), 100);
      }
    }
  });

  // Login button
  const loginBtn = $("login-btn");
  loginBtn?.addEventListener("click", async () => {
    const errorEl = $("login-error");
    if (errorEl) errorEl.textContent = "";

    try {
      const result = await window.claude.login();
      if (result.success) {
        hideLoginModal();
        await init();
      } else {
        if (errorEl) errorEl.textContent = result.error || "Login failed";
      }
    } catch (e: any) {
      if (errorEl) errorEl.textContent = e?.message || "Login failed";
    }
  });

  // Stream events
  window.claude.onMessageStream((data) => {
    const tab = tabs.find((t) => t.conversationId === data.conversationId);
    if (tab && tab.streamingElement) {
      tab.streamingElement.innerHTML = parseMarkdown(data.fullText);
      if (tab.id === activeTabId) {
        scrollToBottom();
      }

      // Write to terminal if active tab
      if (tab.id === activeTabId && tab.terminal) {
        // Clear previous response line and write new one
        tab.terminal.write(
          `\r\x1b[K\x1b[32mClaude:\x1b[0m ${data.fullText.substring(0, 100)}...`
        );
      }
    }
  });

  window.claude.onMessageComplete((data) => {
    const tab = tabs.find((t) => t.conversationId === data.conversationId);
    if (tab) {
      tab.parentMessageUuid = data.messageUuid;
      tab.isLoading = false;
      tab.streamingElement = null;

      const sendBtn = $("send-btn");
      const stopBtn = $("stop-btn");
      if (sendBtn) sendBtn.style.display = "flex";
      if (stopBtn) stopBtn.classList.remove("visible");

      // Write complete response to terminal
      if (tab.terminal) {
        tab.terminal.writeln(`\r\x1b[K\x1b[32mClaude:\x1b[0m ${data.fullText}`);
        tab.terminal.writeln("");
        tab.terminal.write("\x1b[36m❯\x1b[0m ");
      }

      saveTabs();
    }
  });
}

// ============================================
// INITIALIZATION
// ============================================

async function loadAccounts() {
  const result = await window.claude.getAccounts();
  if (result.success) {
    accounts = result.accounts;
  }
}

async function init() {
  const isAuth = await window.claude.getAuthStatus();

  if (!isAuth) {
    showLoginModal();
    return;
  }

  await loadAccounts();
  await restoreTabs();
  setupEventListeners();
}

// Start app
init();
