# Guía del propietario: panel administrativo Fantasy LPF

**Estado actual:** la implementación está en el repositorio, pero el panel **no está habilitado para uso real** hasta aplicar y verificar la migración de Supabase, configurar MFA en el servidor y completar QA. Ninguna cuenta real ha recibido `ADMIN`.

## ADMIN PANEL URL

La ruta prevista es `https://fantasy-lpf.vercel.app/admin`. Verificar la URL y su protección después del despliegue; no usarla todavía como panel operativo.

## FIRST LOGIN PROCEDURE / MFA SETUP

1. Un operador de base de datos confiable confirma tu `user_id` exacto y, **solo con tu autorización**, ejecuta `set_fantasy_admin_role(user_id,'ADMIN',operator)` mediante una conexión directa privilegiada. La operación queda auditada. Nunca se hace desde el perfil, localStorage o el navegador.
2. Abre `/admin` e inicia sesión con la cuenta autorizada. La contraseña normal no basta para abrir datos administrativos.
3. Si aún no hay MFA, vuelve a introducir la contraseña. Agrega la clave mostrada una sola vez a cualquier aplicación de autenticación compatible con TOTP. Introduce el código de seis dígitos para confirmar.
4. En accesos posteriores, inicia sesión e introduce un nuevo código TOTP. El servidor comprobará sesión, rol y MFA antes de devolver datos.

## SESSION / LOGOUT

La sesión administrativa caduca tras 15 minutos de inactividad o 8 horas absolutas. Usa «Cerrar sesión administrativa» al terminar. Cerrar la sesión normal o cambiar la contraseña invalida el acceso administrativo. En un dispositivo ajeno, cierra también la sesión normal del juego.

## WHAT I CAN SEE / WHAT I CAN MODIFY

Overview muestra conteos reales; Users ofrece búsqueda y filtros acotados; User Detail muestra cuenta, equipo, XI/banca, economía, transferencias, ligas e historial disponible; System muestra estado operativo saneado. Todo es **solo lectura**. El panel no cambia puntos, precios, bancos, plantillas, roles, torneos, scoring ni el pipeline.

## HOW TO ADD AN ADMIN / HOW TO REMOVE AN ADMIN

Un operador de base de datos confiable valida la identidad y usa `set_fantasy_admin_role` o `revoke_fantasy_admin_role` mediante una conexión directa privilegiada, fuera del frontend. El trigger registra concesión y revocación, incluido el identificador del operador. El nuevo administrador debe configurar TOTP antes de acceder. Revocar el rol elimina las sesiones administrativas y bloquea inmediatamente las APIs. No compartas cuentas administrativas.

## TRUSTED DATABASE OPERATOR

En esta arquitectura el operador es **una persona con acceso Owner al proyecto Fantasy LPF en Supabase**, autenticada en el dashboard de Supabase y autorizada a usar el SQL Editor con el rol PostgreSQL `postgres`. No es una cuenta Fantasy, un usuario `ADMIN`, Vercel, el worker ni el rol `service_role` expuesto por API. Antes de operar, comprueba en Supabase Dashboard → Project Settings/Members que la cuenta concreta tiene ese permiso; este repositorio no permite verificar quién es el Owner humano actual. El operador debe actuar desde una sesión propia de Supabase, en un equipo confiable, y registrar su identificador real en `p_operator`. La cuenta de aplicación no recibe este privilegio.

## LOST MFA PROCEDURE / LOST PASSWORD PROCEDURE

Si pierdes el autenticador, el Owner del proyecto Supabase descrito arriba debe verificar tu identidad por un canal independiente y ejecutar `reset_fantasy_admin_mfa(user_id,operator)` desde SQL Editor. La función revoca las sesiones administrativas y registra el reinicio; después debes volver a registrar TOTP. No existe código de recuperación ni puerta trasera en la UI.

Si olvidas la contraseña, **todavía no existe recuperación automática ni un procedimiento break-glass validado en producción**. El procedimiento propuesto requiere al Owner de Supabase: (1) verificar identidad y control de la dirección de correo registrada por un canal independiente; (2) confirmar el `user_id` exacto; (3) generar fuera del dashboard un hash bcrypt de una contraseña nueva sin registrar la contraseña en historial SQL, logs o chat; (4) en una transacción privilegiada, actualizar únicamente `users.password_hash`, revocar todas las filas de `sessions` y `admin_sessions` de ese usuario y registrar `PASSWORD_RECOVERY` en `admin_audit_log` con el identificador del operador; (5) verificar el resultado y exigir nuevo login y MFA. La transacción debe abortar si el `user_id` no existe o no coincide con la cuenta verificada. **No ejecutes este procedimiento hasta disponer de un script parametrizado y una prueba PostgreSQL real de atomicidad y auditoría.** La pérdida del teléfono no justifica desactivar MFA permanentemente.

## MFA ENCRYPTION KEY CUSTODY

`ADMIN_MFA_ENCRYPTION_KEY` debe existir solo como variable de servidor en Vercel. Una copia protegida fuera de Vercel es necesaria para recuperación ante desastre. Si se pierde la única copia, los secretos TOTP cifrados existentes no se pueden descifrar: se deben revocar las sesiones administrativas y reiniciar MFA mediante el procedimiento privilegiado y auditado para cada administrador. No se debe sustituir la clave sin plan de migración. Una rotación futura debe descifrar con la clave anterior y recifrar con la nueva dentro de una operación controlada y verificada, con rollback; luego se retira la clave anterior. Nunca se coloca la clave en el bundle, repositorio, logs ni respuestas API.

## SUSPECTED COMPROMISE PROCEDURE / EMERGENCY PROCEDURE

1. Deja de usar el dispositivo sospechoso y solicita al operador que elimine todas tus filas en `sessions` y `admin_sessions` y, si hace falta, revoque temporalmente `ADMIN`.
2. Desde un dispositivo limpio, cambia la contraseña tras recuperar el acceso y vuelve a enrolar MFA si el autenticador pudo quedar expuesto.
3. Revisa `admin_audit_log`, roles concedidos y accesos denegados. Comprueba la integridad de usuarios, equipos y datos observados; el panel actual no tiene escrituras de producto.
4. Evalúa si se expusieron secretos del servidor. Rótalos solo si hay evidencia o necesidad; verifica RLS y el acceso del pipeline después.
5. Para restaurar acceso, un operador vuelve a asignar el rol y confirma que MFA y sesiones funcionen correctamente.

## SECURITY CHECKLIST / CUIDADOS QUE DEBES TENER

- Usa una contraseña única y fuerte; no la reutilices ni compartas la cuenta `ADMIN`.
- Mantén TOTP y protege el teléfono/autenticador. No compartas códigos, cookies ni tokens.
- No copies secretos desde DevTools ni envíes credenciales por chat, correo o WhatsApp.
- Evita equipos públicos; cierra sesión en equipos ajenos; mantén navegador y sistema actualizados.
- Revisa actividad administrativa sospechosa y solicita revocación inmediata ante compromiso.

El sistema aplica roles del servidor, MFA, expiración, RLS, límites de peticiones y auditoría. La custodia de contraseña, autenticador y dispositivos depende de ti.

## DO NOT DO THIS

No edites roles sin procedimiento auditado, no desactives RLS, no uses `service_role` desde el navegador, no compartas `PIPELINE_WORKER_SECRET`, no edites puntos en PostgreSQL, no desactives MFA por comodidad y no uses el worker como mecanismo administrativo.
