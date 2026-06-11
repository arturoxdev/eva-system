import { createOpenRouter } from "@openrouter/ai-sdk-provider";

/**
 * Módulo 3 del PRD de chat: cliente de IA (provider de OpenRouter para el
 * Vercel AI SDK). Sigue el patrón de `lib/stripe.ts`: no se hace `throw` en
 * tiempo de import para que los entornos sin la key configurada puedan buildar;
 * cualquier ruta que realmente llame al modelo fallará con el mensaje claro de
 * `assertAiConfigured()` (el route handler lo invoca antes de abrir el stream).
 */

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.warn(
    "[ai] OPENROUTER_API_KEY no está configurada; las llamadas a OpenRouter fallarán hasta configurarla.",
  );
}

/** Modelo por defecto del PRD: barato y rápido. Configurable por env. */
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

const openrouter = createOpenRouter({
  // Si falta la key, pasamos un placeholder para no romper el import; el
  // `assertAiConfigured()` de abajo es el guardia real antes de cada request.
  apiKey: apiKey ?? "or-unset",
});

/**
 * Modelo de chat configurado. Lee `OPENROUTER_MODEL` (p.ej.
 * `anthropic/claude-haiku-4.5`, `openai/gpt-4o`, …) con un default barato.
 */
export const chatModel = openrouter(process.env.OPENROUTER_MODEL || DEFAULT_MODEL);

/** Lanza un error claro si falta la API key. Llamar antes de usar el modelo. */
export function assertAiConfigured(): void {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY no está configurada");
  }
}
