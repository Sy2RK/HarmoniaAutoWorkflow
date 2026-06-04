import type { MessageInput } from "../db/repository.js";
import type { GraphAuthConfig } from "./auth.js";
import { getGraphAccessToken } from "./auth.js";

type GraphRecipient = {
  emailAddress?: {
    name?: string;
    address?: string;
  };
};

type GraphMessageResponse = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  body?: {
    content?: string;
  };
  bodyPreview?: string;
  hasAttachments?: boolean;
};

type GraphAttachmentResponse = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  "@odata.type"?: string;
};

type GraphCollection<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export type SyncedGraphMessage = MessageInput;

export type GraphAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isFile: boolean;
};

export type GraphDeltaResult = {
  messages: SyncedGraphMessage[];
  rawIds: Map<string, string>;
  deltaLink: string | null;
};

export interface GraphMailClient {
  listInboxDelta(mailboxAddress: string, deltaLink: string | null): Promise<GraphDeltaResult>;
  listAttachments(mailboxAddress: string, graphMessageId: string): Promise<GraphAttachment[]>;
  downloadAttachment(mailboxAddress: string, graphMessageId: string, attachmentId: string): Promise<Buffer>;
  sendMail(input: {
    mailboxAddress: string;
    to: string[];
    cc: string[];
    subject: string;
    bodyText: string;
  }): Promise<void>;
}

function recipientAddress(recipient: GraphRecipient | undefined): string {
  return recipient?.emailAddress?.address ?? "";
}

function recipientName(recipient: GraphRecipient | undefined): string | null {
  return recipient?.emailAddress?.name ?? null;
}

function recipientList(recipients: GraphRecipient[] | undefined): string[] {
  return (recipients ?? []).map(recipientAddress).filter(Boolean);
}

function toMessage(mailboxAddress: string, message: GraphMessageResponse): SyncedGraphMessage {
  const sender = message.from ?? message.sender;
  return {
    mailboxAddress,
    graphMessageId: message.id,
    internetMessageId: message.internetMessageId ?? null,
    conversationId: message.conversationId ?? null,
    subject: message.subject ?? "(无主题)",
    senderName: recipientName(sender),
    senderEmail: recipientAddress(sender),
    toRecipients: recipientList(message.toRecipients),
    ccRecipients: recipientList(message.ccRecipients),
    receivedAt: message.receivedDateTime ?? new Date().toISOString(),
    bodyText: message.body?.content ?? message.bodyPreview ?? "",
    hasAttachments: Boolean(message.hasAttachments)
  };
}

export class MicrosoftGraphMailClient implements GraphMailClient {
  private readonly authConfig: GraphAuthConfig;

  constructor(authConfig: GraphAuthConfig) {
    this.authConfig = authConfig;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await getGraphAccessToken(this.authConfig);
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"',
        "Content-Type": "application/json",
        ...init.headers
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Microsoft Graph request failed ${response.status}: ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async listInboxDelta(mailboxAddress: string, deltaLink: string | null): Promise<GraphDeltaResult> {
    const select = [
      "id",
      "internetMessageId",
      "conversationId",
      "subject",
      "from",
      "sender",
      "toRecipients",
      "ccRecipients",
      "receivedDateTime",
      "body",
      "bodyPreview",
      "hasAttachments"
    ].join(",");
    let url =
      deltaLink ??
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxAddress)}/mailFolders/inbox/messages/delta?$select=${select}&$top=25`;
    const messages: SyncedGraphMessage[] = [];
    const rawIds = new Map<string, string>();
    let delta: string | null = null;

    while (url) {
      const page = await this.request<GraphCollection<GraphMessageResponse>>(url);
      for (const item of page.value ?? []) {
        if (!item.id) continue;
        const mapped = toMessage(mailboxAddress, item);
        messages.push(mapped);
        rawIds.set(mapped.graphMessageId, item.id);
      }
      url = page["@odata.nextLink"] ?? "";
      delta = page["@odata.deltaLink"] ?? delta;
    }

    return { messages, rawIds, deltaLink: delta };
  }

  async listAttachments(mailboxAddress: string, graphMessageId: string): Promise<GraphAttachment[]> {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxAddress)}/messages/${encodeURIComponent(
      graphMessageId
    )}/attachments?$select=id,name,contentType,size,isInline`;
    const result = await this.request<GraphCollection<GraphAttachmentResponse>>(url);
    return (result.value ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name ?? "attachment",
      contentType: attachment.contentType ?? "application/octet-stream",
      size: attachment.size ?? 0,
      isFile: attachment["@odata.type"] ? attachment["@odata.type"] === "#microsoft.graph.fileAttachment" : !attachment.isInline
    }));
  }

  async downloadAttachment(mailboxAddress: string, graphMessageId: string, attachmentId: string): Promise<Buffer> {
    const token = await getGraphAccessToken(this.authConfig);
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxAddress)}/messages/${encodeURIComponent(
      graphMessageId
    )}/attachments/${encodeURIComponent(attachmentId)}/$value`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId"' } });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Attachment download failed ${response.status}: ${text}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async sendMail(input: {
    mailboxAddress: string;
    to: string[];
    cc: string[];
    subject: string;
    bodyText: string;
  }): Promise<void> {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.mailboxAddress)}/sendMail`;
    await this.request<void>(url, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: "Text", content: input.bodyText },
          toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
          ccRecipients: input.cc.map((address) => ({ emailAddress: { address } }))
        },
        saveToSentItems: true
      })
    });
  }
}
