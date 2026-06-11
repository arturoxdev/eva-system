import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageBody } from "@/components/layout/page-body";
import { ChatPlaygroundClient } from "./chat-playground-client";

/**
 * Módulo 4 del PRD de chat (ADR-011): página interna `/chat-playground`.
 *
 * Valida el endpoint `POST /api/chat` end-to-end con `useChat` y un transport
 * custom que recorta el payload al último mensaje y captura el header
 * `X-Conversation-Id` para continuar la conversación.
 *
 * La protección de sesión la hereda del layout `(dashboard)` (redirige a
 * `/login` sin sesión). El gating por rol root/admin es del PR5.
 */
export default async function ChatPlaygroundPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <>
      <PageHeader
        title="Chat Playground"
        subtitle="Página interna para validar el endpoint de chat con streaming."
      />
      <PageBody>
        <ChatPlaygroundClient />
      </PageBody>
    </>
  );
}
