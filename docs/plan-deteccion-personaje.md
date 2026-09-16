# Plan de corrección: detección de personaje

Plan para los 4 puntos detectados en
[`docs/sat-deteccion-personaje.md`](sat-deteccion-personaje.md), alineando el
tracker con el comportamiento de **AlbionOnline-StatisticsAnalysis (SAT)**.

Principio rector: **SAT es tolerante al enmarcar y estricto al atribuir.**
Este repo hoy es al revés — descarta paquetes buenos por detalles de framing, y
después exige campos que SAT no exige. Las 4 correcciones mueven la severidad
al lugar correcto.

**Regla que no se toca:** la identidad local sigue saliendo **solo** del
JoinResponse. Ningún cambio de este plan permite que `NewCharacter`, un filtro
de nombre o un paquete cualquiera fabriquen identidad.

---

## Corrección del diagnóstico previo (importante)

Al planificar el punto B encontré que **el descarte es peor y ocurre en otro
lado** del que reporté. Lo verifiqué simulando la lógica exacta del repo:

```
JoinResponse limpio        -> Valid: true,  Packets: 1
JoinResponse + 2 bytes      -> Valid: FALSE, Packets: 0
JoinResponse + 11 bytes     -> Valid: FALSE, Packets: 0
```

El corte no está en `Receive()`, está en **`Inspect()`**, que corre *antes*
en `pipeline.go:157`:

```go
inspection := photon.Inspect(packet.Payload)
if !inspection.Valid {
    p.state.MarkMalformed()
    return          // <-- el parser NUNCA se ejecuta
}
```

`Inspect()` devuelve `Inspection{}` (todo en cero) ante cualquier sobra de
bytes. Con relleno al final, el datagrama entero se tira **antes de decodificar
nada**: no sube “Photon”, no sube “decodificados”, el JoinResponse ni se mira.

Y por eso el test actual no lo detecta: `TestMessageAcceptsTrailingBytes` llama
a `parser.Receive()` **directo**, salteándose `Inspect()`. El test pasa y el
bug sigue vivo en producción. Esto sube a B a la misma prioridad que A.

---

## Punto A — La firma no debe elegir el decodificador

**Archivo:** `desktop/internal/tracker/photon/parser.go:356`

**Hoy:**
```go
protocol18 := data[0] != protocol16Signature   // 0xF3
```

**Problema:** `data[0]` es el *signifier byte* de Photon, no un selector de
protocolo. SAT lo saltea sin mirarlo (`PhotonParser.cs`) y usa Protocol18
siempre. Si el byte cae en `0xF3`, el JoinResponse va al decodificador viejo,
falla y se pierde entero.

### Solución

Decodificar **siempre con Protocol18**, y usar Protocol16 solo como *fallback*
cuando Protocol18 falla — nunca guiándose por la firma:

```go
// La firma NO selecciona decodificador (SAT la saltea). Se intenta
// Protocol18, que es lo que habla el juego; si falla, se reintenta con
// Protocol16 para no perder capturas históricas.
ev, err := r.p18EventData(0)
if err != nil {
    r2 := &reader{buf: data, pos: 2}
    ev, err = r2.eventData(0)
}
```

Aplicar el mismo patrón a los tres casos (`msgEventData`,
`msgOperationRequest`, `msgOperationResponse`/`Alt`). Requiere reiniciar el
`reader` en cada reintento, porque el primer intento ya consumió bytes.

**Alternativa descartada:** quitar Protocol16 del todo. Es más cercano a SAT,
pero rompería `TestProtocol16SignatureStillUsesLegacyDecoder` y los fixtures
históricos sin necesidad. El fallback conserva ambas cosas.

**Riesgo:** bajo. Protocol18 sobre datos Protocol16 falla rápido (tipos
inválidos), así que el fallback no genera falsos positivos.

**Tests:**
- Extender `TestMessageSignatureDoesNotSelectDecoder` para incluir **`0xF3`**,
  el único valor que hoy dispara el bug y que el test omite.
- Conservar `TestProtocol16SignatureStillUsesLegacyDecoder` (ahora pasa por el
  fallback, no por la firma).

---

## Punto B — El relleno no puede invalidar un datagrama

**Archivos:** `photon/parser.go` (`Inspect`, `Receive`, `receivePacket`)

**Problema real** (ver corrección arriba): `Inspect()` anula el datagrama
completo ante bytes sobrantes, y `pipeline.go` lo descarta antes de decodificar.
Además `receivePacket` exige `offset == len(payload)` y `Receive` hace
`return false` al primer fallo de framing.

SAT no hace nada de esto: `ReceivePacket` avanza paquete a paquete y **corta el
bucle** cuando el framer falla, conservando lo ya entregado.

### Solución, en tres partes

**1. `Inspect()` conserva lo válido en vez de anular todo:**

```go
for offset := 0; offset < len(payload); {
    length, ok := photonPacketLength(payload[offset:])
    if !ok || length <= 0 {
        break          // conserva los paquetes ya contados
    }
    ...
}
result.Valid = result.Packets > 0
```

Así un datagrama con un JoinResponse válido + relleno sigue siendo `Valid: true,
Packets: 1` y llega al parser.

**2. `receivePacket` deja de exigir consumo total:**
`return offset == len(payload) && ok` → `return ok`.
La longitud del comando ya acota el mensaje; el relleno final es normal.

**3. `Receive` corta el bucle sin descartar lo ya procesado**, igual que SAT:
al fallar el framing hace `break` y devuelve lo acumulado, en vez de
`return false`.

**Contabilidad:** se preserva `MarkMalformed()`. Conviene que el relleno
tolerado **no** cuente como malformado (si no, el diagnóstico queda ruidoso),
pero un datagrama sin ningún paquete válido **sí** debe seguir contándose.

**Tests:**
- **Nuevo test a nivel `Inspect()`** con relleno final — es el que falta hoy y
  el que habría cazado el bug.
- **Nuevo test de integración por `pipeline.Ingest()`**, no por `Receive()`,
  para cubrir la ruta real de producción.
- `TestBadCRCIsRejected` debe seguir en verde: un CRC malo se rechaza igual.

---

## Punto C — No descartar la respuesta por `ReturnCode`

**Archivo:** `desktop/internal/tracker/live.go:484`

**Hoy:**
```go
if op.ReturnCode != 0 { return }
```

**Problema:** SAT recibe `returnCode` en `AlbionParser.OnResponse` y **lo
ignora**: el handler corre igual. Si Albion manda el Join con un valor distinto
de 0, o el campo se decodifica mal, este repo tira una respuesta que SAT
aceptaría.

### Solución

Quitar el descarte temprano y mover la decisión al decodificador de identidad.
El `ReturnCode` pasa a ser **telemetría, no compuerta**:

```go
// SAT no filtra por ReturnCode: recibe el valor y corre el handler igual.
// Se registra para diagnóstico, pero no descarta la respuesta.
h.diag.returnCode(op.ReturnCode)
code, ok := realCode(...)
```

La seguridad no se pierde: la identidad sigue exigiendo que `decodeJoinResponse`
extraiga ObjectID + GUID + nombre válidos. Un Join fallido de verdad no trae
esos campos y se rechaza igual, pero ahora **por ausencia de datos**, no por un
código que quizá ni significa error.

**Test a reescribir:** `TestFailedJoinResponseDoesNotIdentifyCharacter` hoy usa
`ReturnCode: 1` **con parámetros completos**. Debe pasar a verificar el caso
real: respuesta **sin** GUID/nombre → no hay identidad. Así se sigue cubriendo
la garantía sin depender de un filtro que SAT no tiene.

---

## Punto D — Tolerancia por campo, con atribución estricta

**Archivos:** `operations.go:72`, `entity.go:146-150`, `state.go:208`

**Hoy:** los tres campos son obligatorios de golpe, en tres capas.

**SAT:** lee cada campo con su propio `if`; `JoinResponseHandler` ya pone el
nombre en la UI aunque falte el GUID — solo `AddEntityAsync` pide los tres.

### Solución: separar *mostrar* de *atribuir*

Es el cambio más delicado, porque el GUID es la clave que evita atribuir
estadísticas al jugador equivocado. Propongo **dos niveles**:

| Nivel | Requiere | Habilita |
|---|---|---|
| **Detectado (parcial)** | nombre + ObjectID | Mostrar “Personaje: X” en la UI |
| **Confirmado** | nombre + ObjectID + **GUID** | Métricas, party, persistencia |

Concretamente:

1. `decodeJoinResponse` devuelve lo que pudo leer y marca qué falta, en vez de
   un `bool` único.
2. `LocalIdentity` suma un estado `detection: "partial"` junto a los actuales
   `waiting | detected | filtered`.
3. **`MetricsAllowed()` y el guardado de sesión NO cambian**: siguen exigiendo
   identidad completa (`validIdentity`, que incluye GUID no nulo).
4. La UI muestra el nombre en estado parcial, con la aclaración de que las
   métricas esperan el GUID.

Así el usuario deja de ver “Personaje no detectado” cuando el juego **sí** dijo
quién es, y al mismo tiempo ninguna estadística se atribuye sin GUID.

**Mejora complementaria (causa probable del GUID faltante):** ampliar
`GUIDFromPhoton`. Hoy acepta `photon.CustomValue`, `[]byte` y `[16]byte`. Si el
GUID llega como `[]any` de bytes o `CustomValue` anidado, devuelve `false` y se
pierde la identidad entera. Conviene aceptar esas formas — es un arreglo barato
que puede resolver el síntoma por sí solo.

**Tests:**
- Join **sin GUID** → nombre visible, `MetricsAllowed() == false`.
- Join **completo** → comportamiento actual intacto.
- `GUIDFromPhoton` con `[]any{byte...}` de 16 elementos.
- `TestMainCharacterFilterRequiresIdentityAndFiltersMetrics` debe seguir verde.

---

## Orden de trabajo sugerido

Cada punto es un commit independiente, para poder revertir sin arrastrar el
resto:

| # | Cambio | Riesgo | Por qué ese orden |
|---|---|---|---|
| 1 | **B** — `Inspect` + framing tolerante | Bajo | Es el que tira el paquete **más temprano**: sin esto, arreglar el resto no se nota |
| 2 | **A** — firma no selecciona decodificador | Bajo | Segundo corte en la cadena |
| 3 | **D2** — ampliar `GUIDFromPhoton` | Muy bajo | Arreglo aislado, puede resolver el síntoma solo |
| 4 | **C** — no filtrar por `ReturnCode` | Medio | Requiere reescribir un test de garantía |
| 5 | **D1** — estado parcial de identidad | Medio | Toca UI y contrato de estado; último para no mezclarlo con lo demás |

**Punto de control tras cada paso:** con Modo diagnóstico activo, entrar a un
mapa y mirar dónde se corta la cadena
(UDP → Photon → decodificados → operación 2 → personaje). Si el personaje
aparece en el paso 1 o 2, los siguientes son mejoras de robustez, no urgencias.

---

## Validación

- `npm test` — validación de repo, `photon_codes.json` y contratos de fase.
- `go test -race ./internal/tracker/...` desde `desktop/` — **no hay Go en este
  entorno de trabajo**, pero el workflow **Escritorio**
  (`.github/workflows/desktop.yml`) lo corre con Go 1.23.4 en cada PR que toca
  `desktop/`. Los cambios de A y B son de parser puro y quedan cubiertos ahí.
- Prueba manual en Windows con el juego abierto: es la única que confirma de
  verdad el punto A, porque depende del valor real del byte de firma.

## Qué NO se cambia

- La identidad local sigue viniendo **solo** del JoinResponse.
- `photon_codes.json` no se toca: verifiqué que todos sus índices y ordinales
  coinciden con SAT.
- Las métricas y la persistencia siguen exigiendo identidad **completa**.
- El filtro de personaje sigue siendo una compuerta real del backend.
