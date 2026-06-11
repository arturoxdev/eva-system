import { streamText } from "ai";

import { assertAiConfigured, chatModel } from "@/lib/ai";
import { getSessionUser, isAgencyRole } from "@/lib/auth-helpers";
import {
  ConversationNotFoundError,
  loadHistory,
  resolveConversation,
  saveMessage,
} from "@/lib/chat/persistence";

/**
 * Módulo 3 del PRD de chat (ADR-011): Route Handler `POST /api/chat`.
 *
 * Streaming de respuestas del modelo de OpenRouter (vía Vercel AI SDK) con la
 * base de datos como única fuente de verdad del historial.
 *
 * ── Contrato del request (el PR4 / `useChat` debe conformar a esto) ──────────
 * Body JSON con:
 *   - `conversationId?: string`  — opcional. Sin id se crea una conversación
 *     nueva; con un id existente se continúa; con un id desconocido → 404
 *     (NUNCA upsert).
 *   - el ÚLTIMO mensaje del usuario (NO el array completo del historial; el
 *     historial se reconstruye desde la base). Dos formas aceptadas:
 *       a) UIMessage v5: `{ message: { role: "user", parts: [{ type: "text",
 *          text: "..." }, ...] } }` — se concatenan los parts de texto.
 *       b) Atajo para curl/tests: `{ text: "..." }` a nivel raíz.
 *
 * Respuesta exitosa: stream UI-message del SDK con el header
 * `X-Conversation-Id: <id>` (el cliente lo captura para continuar la charla).
 *
 * Errores: 401 sin sesión · 403 no-agency · 400 body/texto inválido (no se
 * llama a OpenRouter) · 404 conversationId desconocido.
 *
 * System prompt genérico (no por-compañía en este PR).
 */

// El cliente de DB (pg/Neon) no corre en edge → runtime Node (default).
// Damos un techo explícito de 30s para la respuesta en streaming (ADR-011):
// suficiente para respuestas de chat, evita colgar workers indefinidamente.
export const maxDuration = 30;

const SYSTEM_PROMPT =
  "Eres un asistente de IA útil, claro y conciso. Responde en el mismo idioma del usuario.";

/** Extrae el texto del usuario de forma tolerante (UIMessage.parts o `text`). */
function extractUserText(body: Record<string, unknown>): string | null {
  // Forma a) atajo raíz `text`.
  if (typeof body.text === "string") {
    return body.text;
  }

  // Forma b) UIMessage v5 `{ message: { role, parts: [{ type:"text", text }] } }`.
  const message = body.message;
  if (message && typeof message === "object") {
    const parts = (message as Record<string, unknown>).parts;
    if (Array.isArray(parts)) {
      const text = parts
        .filter(
          (p): p is { type: string; text: string } =>
            !!p &&
            typeof p === "object" &&
            (p as Record<string, unknown>).type === "text" &&
            typeof (p as Record<string, unknown>).text === "string",
        )
        .map((p) => p.text)
        .join("");
      return text;
    }
  }

  return null;
}

export async function POST(request: Request) {
  // Auth: el endpoint cuesta dinero por request → sólo agency users.
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAgencyRole(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Body JSON.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "expected object" }, { status: 400 });
  }
  const obj = body as Record<string, unknown>;

  // `conversationId` opcional; si viene debe ser string.
  const conversationId = obj.conversationId;
  if (conversationId !== undefined && typeof conversationId !== "string") {
    return Response.json(
      { error: "conversationId must be a string" },
      { status: 400 },
    );
  }

  // Validación manual del texto del usuario (sin zod). No quemamos tokens si
  // el texto es inválido/vacío.
  const userText = extractUserText(obj);
  if (typeof userText !== "string" || userText.trim().length === 0) {
    return Response.json(
      { error: "message text is required" },
      { status: 400 },
    );
  }
  const content = userText.trim();

  // Resolución de conversación: id desconocido → 404 (nunca upsert).
  let id: string;
  try {
    const conversation = await resolveConversation(conversationId);
    id = conversation.id;
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    throw error;
  }

  // Asegura la key sólo después de validar todo (no antes: no queremos 500 por
  // config en requests que de todas formas serían 400/404).
  assertAiConfigured();

  // Persistimos el mensaje del usuario ANTES de abrir el stream.
  await saveMessage({ conversationId: id, role: "user", content });

  // Contexto desde la base (única fuente de verdad; incluye el mensaje recién
  // guardado). Objetos planos {role, content} → válidos como ModelMessage[].
  const history = await loadHistory(id);

  const result = streamText({
    model: chatModel,
    system: SYSTEM_PROMPT,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    // Permite cancelar la generación si el cliente aborta (combinado con
    // consumeStream para que onFinish siga corriendo, ver abajo).
    abortSignal: request.signal,
    // Persistimos la respuesta del asistente cuando termina la generación. Con
    // consumeStream() esto corre aunque el cliente cierre la conexión.
    onFinish: async ({ text }) => {
      const assistantText = text.trim();
      if (assistantText.length === 0) return;
      try {
        await saveMessage({
          conversationId: id,
          role: "assistant",
          content: assistantText,
        });
      } catch (error) {
        console.error(
          "[chat] no se pudo persistir el mensaje del asistente",
          JSON.stringify({
            conversationId: id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
  });

  // Sobrevivir la desconexión del cliente: consume el stream del lado servidor
  // para que la generación llegue a su fin y dispare onFinish aunque el cliente
  // cierre la conexión a media respuesta. Sin await (corre en background).
  result.consumeStream();

  // Stream UI-message con el header X-Conversation-Id en TODA respuesta OK.
  return result.toUIMessageStreamResponse({
    headers: { "X-Conversation-Id": id },
  });
}
