export type SessionStatus = "active" | "paused" | "finished" | "abandoned";

export type RecentSession = {
  sessionId: string;
  gameType: string;
  status: SessionStatus;
  updatedAt: number;
};

export type UserProfile = {
  nickname: string;
  createdAt: number;
  lastLoginAt: number;
  recentSessions: RecentSession[];
};

export type GameSession = {
  sessionId: string;
  uid: string;
  activeClientId: string;
  gameType: string;
  status: SessionStatus;
  version: number;
  stateCompressed: string;
  updatedAt: number;
};
