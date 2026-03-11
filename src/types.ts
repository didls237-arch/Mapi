export type MarketScope = "macro" | "kor" | "ex" | "coin";

export type AnalysisMarket = Exclude<MarketScope, "macro">;

export type Persona =
  | "기술적 차트 분석가"
  | "기업 애널리스트"
  | "옵션 트레이더"
  | "매크로 전문가";

export type TurnPhase = "탐색 단계" | "검증 및 반박 단계" | "수렴 및 합의 단계";

export interface DiscussionStartResponse {
  discussion_id: string;
}

export type ConsensusState = "continue" | "soft_consensus" | "final_consensus";

export interface DiscussionTurnResponse {
  content: string;
  citations?: Array<{ source: string; note?: string }>;
  risk_score?: number;
  consensus_state?: ConsensusState;
  consensus_reason?: string;
}

export interface FinalReportRequest {
  market: AnalysisMarket;
  ticker: string;
  thread_id: string;
  turns: Array<{
    turn_number: number;
    persona: Persona;
    phase: TurnPhase;
    content: string;
  }>;
}

export interface FinalReportResponse {
  report_id: string;
  verdict: "WAIT" | "BUY" | "SELL";
  confidence: number;
  entry: string;
  tp: string;
  sl: string;
  consensus: string;
  persona_comments: Array<{
    persona: Persona;
    opinion: string;
    stance: "찬성" | "중립" | "반대";
  }>;
  sources: string[];
  created_at: string;
}

export interface TimelineRow {
  date: string;
  previous_timeline: string;
  changed_timeline: string;
  risk: number;
}

export interface AnalysisJobRecord {
  guild_id: string;
  scope: AnalysisMarket;
  ticker: string;
  discord_thread_id: string;
  discord_forum_channel_id: string;
  discord_summary_channel_id: string;
  openclaw_discussion_id: string;
  next_turn: number;
  status: "running" | "completed" | "failed";
  actor_user_id: string;
  last_error: string | null;
}
