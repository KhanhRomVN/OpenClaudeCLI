/**
 * Google Provider Type Definitions
 */

export interface GoogleCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
}

export interface GoogleSession {
  accessToken?: string;
  refreshToken?: string;
  cookies: GoogleCookie[];
  lastUsed: number;
}

export interface GoogleAccount {
  accountId: string;
  accountName: string;
  email?: string;
  session: GoogleSession;
  createdAt: number;
}
