import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chatConversations,
  chatMessageRoleEnum,
  chatMessages,
} from "@/lib/db/schema";

/**
 * Módulo 2 del PRD de chat: persistencia de conversaciones y mensajes.
 *
 * Es la base de verdad del historial. Interfaz chica, deliberadamente
 * desacoplada del transporte (sin HTTP, sin `NextResponse`/`Request`, sin
 * `process.env`) y del AI SDK (devuelve objetos planos `{ role, content }`,
 * nunca tipos de mensajes del SDK). El route handler del siguiente PR lo
 * orquesta; el mapeo a "model messages" lo hace la capa de IA.
 */

/** Rol de un mensaje de chat. Derivado de los valores del enum del esquema. */
export type ChatRole = (typeof chatMessageRoleEnum.enumValues)[number];

/** Mensaje plano del historial, sin acoplar a tipos del AI SDK. */
export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
}

/**
 * Se lanza cuando se pide resolver una conversación por id y no existe, para
 * que el route handler la mapee a 404. Nunca hacemos upsert de conversaciones.
 */
export class ConversationNotFoundError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

/** Inserta una conversación nueva y devuelve su id (generado por el esquema). */
export async function createConversation(): Promise<{ id: string }> {
  const [row] = await db
    .insert(chatConversations)
    .values({})
    .returning({ id: chatConversations.id });

  return { id: row.id };
}

/** Busca una conversación por id. `undefined` si no existe (nunca crea). */
export async function getConversation(
  id: string,
): Promise<{ id: string; createdAt: Date } | undefined> {
  return db.query.chatConversations.findFirst({
    where: eq(chatConversations.id, id),
    columns: { id: true, createdAt: true },
  });
}

/**
 * Devuelve TODOS los mensajes de la conversación en orden cronológico
 * ascendente (por `createdAt`, desempatado por `id` para un orden estable
 * cuando coinciden los timestamps). Objetos planos `{ role, content }`.
 */
export async function loadHistory(
  conversationId: string,
): Promise<ChatHistoryMessage[]> {
  return db.query.chatMessages.findMany({
    where: eq(chatMessages.conversationId, conversationId),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    columns: { role: true, content: true },
  });
}

/** Inserta un mensaje y devuelve su id (generado por el esquema). */
export async function saveMessage(input: {
  conversationId: string;
  role: ChatRole;
  content: string;
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
    })
    .returning({ id: chatMessages.id });

  return { id: row.id };
}

/**
 * Conveniencia para el route handler: sin id crea una conversación nueva; con
 * un id existente lo devuelve; con un id desconocido lanza
 * `ConversationNotFoundError` (→ 404). Nunca hace upsert. Las funciones
 * granulares siguen disponibles si el route prefiere orquestar a mano.
 */
export async function resolveConversation(
  conversationId?: string,
): Promise<{ id: string }> {
  if (!conversationId) {
    return createConversation();
  }

  const existing = await getConversation(conversationId);
  if (!existing) {
    throw new ConversationNotFoundError(conversationId);
  }

  return { id: existing.id };
}
