/**
 * Claude Provider Type Definitions
 */

export interface ClaudeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
}

export interface ClaudeSession {
  sessionKey: string;
  orgId: string;
  deviceId: string;
  anonymousId: string;
  cookies: ClaudeCookie[];
  lastUsed: number;
}

export interface ClaudeAccount {
  accountId: string;
  accountName: string;
  email?: string;
  session: ClaudeSession;
  createdAt: number;
}
