import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SessionRecord {
  sessionId: string;
  createdAt: string;
  lastTurnAt: string;
  turns: number;
  model: string;
  /** Input tokens of the last request, what the next turn starts from. Absent on records from before it was tracked. */
  contextTokens?: number;
}

/** One file, one session. Restarting the process resumes it; `new` deletes it. */
export class SessionStore {
  private readonly path: string;

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, "session.json");
  }

  read(): SessionRecord | undefined {
    if (!existsSync(this.path)) return undefined;
    return JSON.parse(readFileSync(this.path, "utf8")) as SessionRecord;
  }

  recordTurn(sessionId: string, model: string, contextTokens: number): SessionRecord {
    const now = new Date().toISOString();
    const current = this.read();
    const next: SessionRecord =
      current && current.sessionId === sessionId
        ? { ...current, lastTurnAt: now, turns: current.turns + 1, model, contextTokens: contextTokens || current.contextTokens }
        : { sessionId, createdAt: now, lastTurnAt: now, turns: 1, model, contextTokens };
    writeFileSync(this.path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}
