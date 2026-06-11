"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { SendIcon, PlusIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/**
 * Construye el transport custom hacia `/api/chat` con un holder mutable interno
 * para el `conversationId` capturado del servidor.
 *
 * Definido a nivel de módulo (fuera del render) a propósito: el holder y el
 * acceso a su `.current` viven en los closures del transport, no en el cuerpo
 * del componente, evitando los avisos de "ref durante render" del React
 * Compiler. El componente lo instancia una sola vez vía `useState` perezoso.
 *
 *  - `prepareSendMessagesRequest` recorta el payload: manda SOLO el último
 *    UIMessage + el `conversationId` capturado (el historial lo reconstruye el
 *    servidor desde la base, nunca el cliente).
 *  - `fetch` custom: tras la `Response`, lee el header `X-Conversation-Id`, lo
 *    guarda en el holder y lo notifica vía `onConversationId`. El id NUNCA lo
 *    genera el cliente; siempre viene del servidor.
 */
function createChatTransport(onConversationId: (id: string) => void) {
  const idHolder: { current: string | null } = { current: null };

  const transport = new DefaultChatTransport<UIMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages }) => {
      const lastMessage = messages[messages.length - 1];
      return {
        body: {
          conversationId: idHolder.current ?? undefined,
          message: lastMessage,
        },
      };
    },
    fetch: async (fetchInput, init) => {
      const response = await fetch(fetchInput, init);
      const headerId = response.headers.get("X-Conversation-Id");
      if (headerId) {
        idHolder.current = headerId;
        onConversationId(headerId);
      }
      // Devolvemos la response intacta para que useChat consuma el stream.
      return response;
    },
  });

  // `reset()` permite empezar una conversación nueva: el próximo envío irá sin
  // conversationId y el servidor creará una nueva.
  return {
    transport,
    reset: () => {
      idHolder.current = null;
    },
  };
}

/** Cliente del Chat Playground (ADR-011). */
export function ChatPlaygroundClient() {
  // Espejo en estado del conversationId para mostrarlo en la UI (la fuente
  // mutable real vive dentro del transport).
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");

  // Transport creado una sola vez (initializer perezoso de useState).
  const [chat] = useState(() => createChatTransport(setConversationId));

  const { messages, sendMessage, status, setMessages, error } =
    useChat<UIMessage>({ transport: chat.transport });

  const isBusy = status === "submitted" || status === "streaming";
  const canSend = !isBusy && input.trim().length > 0;

  function handleSend() {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    void sendMessage({ text });
  }

  function handleNewConversation() {
    setMessages([]);
    chat.reset();
    setConversationId(null);
    setInput("");
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Barra de estado: conversationId actual + estado del stream. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>Conversación:</span>
          {conversationId ? (
            <code className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              {conversationId}
            </code>
          ) : (
            <span className="italic">nueva (sin enviar)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewConversation}
            disabled={isBusy}
          >
            <PlusIcon data-icon="inline-start" />
            Nueva conversación
          </Button>
        </div>
      </div>

      {/* Hilo de la conversación. */}
      <div className="flex min-h-72 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xs">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">
            Escribe un mensaje para empezar a chatear.
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive">
          Error: {error.message}
        </p>
      )}

      {/* Composer. */}
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter salto de línea)"
          className="min-h-16 flex-1 resize-none"
          disabled={isBusy}
        />
        <Button onClick={handleSend} disabled={!canSend} size="lg">
          {isBusy ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          Enviar
        </Button>
      </div>
    </div>
  );
}

/** Burbuja de un mensaje (user a la derecha, assistant a la izquierda). */
function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  // Sólo renderizamos los parts de texto (el streaming token-por-token llega ya
  // resuelto por useChat dentro del part de texto).
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
            : "max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground"
        }
      >
        <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide opacity-60">
          {isUser ? "Tú" : "Asistente"}
        </span>
        <p className="whitespace-pre-wrap break-words">
          {text || <span className="opacity-60">…</span>}
        </p>
      </div>
    </div>
  );
}

/** Indicador del estado del stream de useChat. */
function StatusBadge({ status }: { status: ReturnType<typeof useChat>["status"] }) {
  switch (status) {
    case "submitted":
      return <Badge variant="warning">Enviando…</Badge>;
    case "streaming":
      return <Badge variant="warning">Streaming…</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="secondary">Listo</Badge>;
  }
}
