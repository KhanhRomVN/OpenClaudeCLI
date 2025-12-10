export interface CLIConfig {
  model: string;
  provider: "LiteLLM" | "Gemini";
  baseUrl?: string;
  requestsUsed: number;
  contextUsed: string;
  currentFolder: string;
  mode: "interactive" | "auto" | "debug";
  task: string;
  websocketConnected?: boolean;
}

export interface Shortcut {
  key: string;
  description: string;
  action: () => void;
}

export interface WebSocketClient {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  isConnected: () => boolean;
  send: (data: any) => void;
}
