import type {
  AiContext,
  AiConversation,
  AiMessage,
  AiStructuredResponse,
  AiTicketResult,
} from "@berryit/shared/ai";
import { aiErrorMessage, isAiStructuredResponse } from "@berryit/shared/ai";
import { backendFetch } from "@/auth/client";
import type { AppConfig } from "@/config";

export class AiClientError extends Error {
  constructor(
    readonly code: string,
    message = aiErrorMessage(code),
  ) {
    super(message);
  }
}

type SessionLike = { access_token: string };

export function createAiClient(config: AppConfig, session: SessionLike) {
  const base = config.backendUrl.replace(/\/+$/, "") + "/ai/v1";

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      response = await backendFetch(base + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new AiClientError("GATEWAY_UNAVAILABLE");
    }

    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string } }
      | T
      | null;
    if (!response.ok) {
      const code =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error?.code === "string"
          ? body.error.code
          : "GATEWAY_UNAVAILABLE";
      throw new AiClientError(code);
    }
    return body as T;
  };

  return {
    context: () => request<AiContext>("/context"),

    conversations: async (organizationId: string): Promise<AiConversation[]> => {
      const body = await request<{ conversations: AiConversation[] }>(
        `/conversations?organizationId=${encodeURIComponent(organizationId)}`,
      );
      return body.conversations;
    },

    createConversation: async (input: {
      organizationId: string;
      projectId: string | null;
      serviceKey: string | null;
      title: string;
    }): Promise<AiConversation> => {
      const body = await request<{ conversation: AiConversation }>("/conversations", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return body.conversation;
    },

    messages: async (conversationId: string): Promise<AiMessage[]> => {
      const body = await request<{ messages: AiMessage[] }>(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
      );
      return body.messages.map((message) => ({
        ...message,
        structured_response: isAiStructuredResponse(message.structured_response)
          ? message.structured_response
          : null,
      }));
    },

    ask: async (
      conversationId: string,
      text: string,
      approvedForAi: boolean,
    ): Promise<AiStructuredResponse> => {
      const body = await request<{ response: unknown }>(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ text, approvedForAi }),
        },
      );
      if (!isAiStructuredResponse(body.response)) {
        throw new AiClientError("GATEWAY_RESPONSE_INVALID");
      }
      return body.response;
    },

    createTicket: async (conversationId: string): Promise<AiTicketResult> => {
      const body = await request<{ ticket: AiTicketResult }>(
        `/conversations/${encodeURIComponent(conversationId)}/tickets`,
        {
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        },
      );
      return body.ticket;
    },

    promoteKnowledge: async (
      conversationId: string,
      input: {
        assistantMessageId: string;
        title: string;
        problem: string;
        verifiedSolution: string;
      },
    ): Promise<{ id: string; title: string }> => {
      const body = await request<{ knowledge: { id: string; title: string } }>(
        `/conversations/${encodeURIComponent(conversationId)}/knowledge`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      return body.knowledge;
    },
  };
}

export type AiClient = ReturnType<typeof createAiClient>;
