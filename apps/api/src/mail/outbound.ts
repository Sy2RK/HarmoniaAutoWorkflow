import type { GraphMailClient } from "../graph/client.js";

export type OutboundMail = {
  mailboxAddress: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
};

export type OutboundResult = {
  status: "sent" | "skipped" | "failed";
  error: string | null;
  sentAt: string | null;
};

export interface OutboundMailer {
  send(input: OutboundMail): Promise<OutboundResult>;
}

export class GraphOutboundMailer implements OutboundMailer {
  private readonly graph: GraphMailClient;
  private readonly sendingEnabled: boolean;

  constructor(graph: GraphMailClient, sendingEnabled: boolean) {
    this.graph = graph;
    this.sendingEnabled = sendingEnabled;
  }

  async send(input: OutboundMail): Promise<OutboundResult> {
    if (!this.sendingEnabled) {
      return { status: "skipped", error: "MAIL_SENDING_ENABLED=false", sentAt: null };
    }
    try {
      await this.graph.sendMail(input);
      return { status: "sent", error: null, sentAt: new Date().toISOString() };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error), sentAt: null };
    }
  }
}
