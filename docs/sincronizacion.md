# Sincronización entre dispositivos — diseño y contrato

Referencia técnica de la copia en la nube. Para el uso cotidiano alcanza con
la sección «Sincronización entre dispositivos» del README.

## Problema

Toda la app vive en el `localStorage` del navegador. Cambiar de PC, de
navegador o reinstalar el ejecutable dejaba atrás el registro de operaciones,
los favoritos y los precios manuales. El respaldo en archivo lo resolvía a
mano; esto lo resuelve con la cuenta de Discord que los miembros ya usan.

## Contrato

El Worker expone `/sync`, la única ruta que acepta métodos de escritura:

| Método | Respuesta |
|---|---|
| `GET /sync` + `Authorization: Bearer <sesión>` | `{ok, updated, data, bytes}` — la copia del usuario |
| `PUT /sync` + `Authorization: Bearer <sesión>` | Guarda `{updated, data}` del cuerpo JSON |
| `DELETE /sync` + `Authorization: Bearer <sesión>` | Borra la copia |

## Control de acceso

Antes de tocar el KV se valida, en este orden:

1. **Origen permitido** — GitHub Pages o localhost.
2. **Firma HMAC y vigencia** de la sesión, con la misma comprobación que
   `/discord/verify`. Una sesión forjada devuelve 401 sin llegar al
   almacenamiento.
3. **Membresía de SG**.

La clave del KV es `u:<id de Discord>`: nadie puede leer ni pisar los datos de
otra persona sin su sesión firmada.

## Límites

Protegen el namespace y evitan que una copia corrupta rompa otro dispositivo:

- 512 KB por usuario, 64 claves, 256 KB por clave.
- Allowlist de nombres de clave.
- Cada valor debe ser JSON válido.
- La copia caduca a los 180 días sin uso.

El cliente vuelve a filtrar y validar lo que baja; no confía solo en el
servidor.

## Qué nunca se sincroniza

La sesión de Discord y la URL del proxy quedan fuera de la allowlist.
Sincronizar la sesión permitiría que un dispositivo robe el ingreso de otro.

## Degradación

`GET /discord/config` informa `sync: true|false` según esté vinculado el
binding KV `AA_SYNC`. Sin él, `/sync` responde `503 no-configurado`, la app
oculta los botones y explica el motivo: todo sigue funcionando contra
`localStorage` como antes.

## Probar sin Cloudflare

`tools/server.py` implementa el mismo contrato con un almacén en memoria,
junto al simulador de Discord. La configuración del binding y el control de acceso
se describen en la documentación de despliegue.

La configuración del binding se administra en Cloudflare y en `wrangler.toml`.
