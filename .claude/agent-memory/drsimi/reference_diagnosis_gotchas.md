---
name: diagnosis-gotchas-eva
description: Red herrings y trampas conocidas al diagnosticar eva-system (warning SSL de pg es benigno; interop .mts rompe db.query en scripts tsx)
metadata:
  type: reference
---

Trampas conocidas al diagnosticar eva-system:

1. **Warning SSL de pg es ruido benigno.** Con Neon + `pg` >= 8.16 y `sslmode=require`, Node imprime "See https://www.postgresql.org/docs/current/libpq-ssl.html..." — es un deprecation warning de pg-connection-string, NO un fallo de conexión. No perseguirlo como causa de errores de auth/DB.

2. **Scripts one-off con tsx: usar extensión `.ts` (no `.mts`) y correr desde la raíz del proyecto.** Un archivo `.mts` que importa `lib/db/schema.ts` sufre interop CJS/ESM: el namespace import devuelve `{default, module.exports}` y `db.query.*` queda vacío — falso positivo de "schema roto". Con `.ts` plano + wrapper async funciona idéntico a la app.

3. **Login se puede probar end-to-end por curl** contra el dev server: GET `/api/auth/csrf` (guardar cookie), POST `/api/auth/callback/credentials` con csrfToken+email+password; éxito = 302 a `/` + cookie session-token; fallo = redirect con `error=CredentialsSignin`.

4. **`created_at` (timestamp sin tz) se serializa con offset local** al leerlo con node-postgres desde esta máquina (CST, UTC-6): un valor mostrado como `08:29Z` realmente es `02:29Z` UTC. Ajustar 6h al razonar sobre timelines.

5. **next-auth 5.0.0-beta.30, `signIn` cliente (`node_modules/next-auth/react.js:126`)**: hace preflight a `/api/auth/providers` (si falla navega a `/api/auth/error` AUNQUE `redirect:false`), y en `redirect:false` ejecuta `new URL(data.url)` que LANZA si url no es absoluta — un throw deja el form colgado en "Signing in...". Con el backend sano, el server siempre devuelve url absoluta (verificado). Cookie de sesión corrupta NO bloquea re-login: el middleware la trata como no autenticado (JWTSessionError benigno en logs) y el login la sobreescribe.

6. **localhost:3000 es origen compartido entre proyectos**: cookies acumuladas de otras apps pueden inflar headers (431) o confundir pruebas de auth en navegador. Primer paso con reportes "solo falla en navegador": ventana incógnito + revisar línea `[auth] Login rejected:` en el log del dev server (si no aparece, el request nunca llegó al backend).
