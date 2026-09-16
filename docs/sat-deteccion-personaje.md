# Detección de personaje: archivos de SAT y equivalentes en este repo

Mapa de archivos para revisar personalmente cómo detecta el personaje
**AlbionOnline-StatisticsAnalysis (SAT)**, el proyecto GPL-3.0 del que este
tracker adapta el modelo de identidad (ver [`NOTICE`](../NOTICE)).

Todas las rutas de SAT se verificaron contra el árbol real de
`Triky313/AlbionOnline-StatisticsAnalysis` (rama `main`): las 50 rutas citadas
existen. Las de este repositorio se verificaron sobre el checkout actual.

> Para leer un archivo de SAT en el navegador:
> `https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/blob/main/<ruta>`

---

## 1. La regla de oro: el nombre sale del JoinResponse

En SAT el personaje local **no** se detecta olfateando nombres ni mirando lo
que el cliente pide. Sale de **una sola cosa**: la RESPUESTA del servidor a la
operación `Join` (código de operación **2**). Ahí vienen juntos el `ObjectId`,
el `Guid` y el `Username`.

Cadena completa, en orden de ejecución:

| # | Paso | Archivo en SAT |
|---|---|---|
| 1 | Captura UDP (puertos 5055/5056/**5058**) | `src/StatisticsAnalysisTool/Network/PacketProviders/LibpcapPacketProvider.cs` |
| 2 | Alternativa sin Npcap | `src/StatisticsAnalysisTool/Network/PacketProviders/SocketsPacketProvider.cs` |
| 3 | Trocea el datagrama en paquetes Photon | `src/StatisticsAnalysisTool.PhotonPackageParser/PhotonPacketFramer.cs` |
| 4 | Enmarca eNet: cabecera, comandos, fragmentos, CRC | `src/StatisticsAnalysisTool.PhotonPackageParser/PhotonParser.cs` |
| 5 | Tipos de comando (4/6/7/8) | `src/StatisticsAnalysisTool.PhotonPackageParser/CommandType.cs` |
| 6 | Tipos de mensaje (2/3/4) | `src/StatisticsAnalysisTool.PhotonPackageParser/MessageType.cs` |
| 7 | Decodifica el cuerpo Protocol18 | `src/StatisticsAnalysisTool.Protocol18/Protocol18Deserializer.cs` |
| 8 | Tabla de tipos del formato | `src/StatisticsAnalysisTool.Protocol18/Protocol18Type.cs` |
| 9 | Struct de la respuesta cruda | `src/StatisticsAnalysisTool.Protocol18/Photon/OperationResponse.cs` |
| 10 | **Saca el código real del parámetro 253** | `src/StatisticsAnalysisTool.Network/AlbionParser.cs` |
| 11 | Despacha al handler por código | `src/StatisticsAnalysisTool.Network/HandlersCollection.cs` |
| 12 | **Lee id/guid/nombre/mapa del JoinResponse** | `src/StatisticsAnalysisTool/Network/Operations/Responses/JoinResponse.cs` |
| 13 | **Marca el personaje como local** | `src/StatisticsAnalysisTool/Network/Handler/JoinResponseHandler.cs` |
| 14 | Guarda la identidad local | `src/StatisticsAnalysisTool/Models/NetworkModel/LocalUserData.cs` |
| 15 | Índice GUID ↔ ObjectId | `src/StatisticsAnalysisTool/Network/Manager/EntityController.cs` |
| 16 | Enum de operaciones (Join = 2) | `src/StatisticsAnalysisTool/Network/OperationCodes.cs` |
| 17 | Enum de eventos | `src/StatisticsAnalysisTool/Network/EventCodes.cs` |
| 18 | Bytes → Guid | `src/StatisticsAnalysisTool/Common/ExtensionMethod.cs` (`ObjectToGuid`) |

Los **dos archivos que hay que leer primero** son el 12 y el 13.

### Los índices exactos, leídos del código de SAT

`JoinResponse.cs` los lee así (no son adivinados, están en el constructor):

| Dato | Índice | Línea en `JoinResponse.cs` |
|---|---|---|
| `UserObjectId` | **0** | `parameters.ContainsKey(0)` |
| `UserGuid` | **1** | `parameters.ContainsKey(1)` |
| `Username` | **2** | `parameters.TryGetValue(2, …)` |
| `MapIndex` | **8** | `parameters.TryGetValue(8, …)` |
| `GuildName` | **58** | `parameters.ContainsKey(58)` |
| `AllianceName` | **79** | `parameters.ContainsKey(79)` |

Este repo usa **exactamente los mismos** índices, en
`albion-app/data/photon_codes.json` → `selfOperation.parameters`:
`{"id":0,"guid":1,"name":2,"zone":8,"guild":58,"alliance":79}`. **Coinciden.**

También verifiqué los ordinales de los enums de SAT calculándolos a mano
(en C# un enum sin valor explícito vale su posición): `Join = 2`,
`NewCharacter = 29`, `Leave = 1`, `UpdateFame = 82`, `ChangeCluster = 41`,
`PartyJoined = 231`. **Todos coinciden** con `photon_codes.json`.

**Conclusión: la tabla de códigos no es el problema.** Si seguís sin detectar
el personaje, el paquete se está perdiendo antes de llegar a esa tabla.

---

## 2. Los archivos equivalentes en este repositorio

| Paso | Archivo en este repo |
|---|---|
| Captura Npcap + filtro BPF | `desktop/internal/tracker/live.go` (const `bpfFilter`, línea 28) |
| Captura por socket | `desktop/internal/tracker/socket.go`, `socket_windows.go` |
| Puertos aceptados | `desktop/internal/tracker/netpacket.go` (`photonPort`, línea 27) |
| Framing eNet + fragmentos + CRC | `desktop/internal/tracker/photon/parser.go` |
| Cuerpo Protocol18 | `desktop/internal/tracker/photon/protocol18.go` |
| Protocol16 (capturas viejas) | `desktop/internal/tracker/photon/protocol16.go` |
| **Código real del parámetro 253** | `desktop/internal/tracker/live.go` (`realCode`, línea 362) |
| **Identifica el JoinResponse** | `desktop/internal/tracker/live.go` (`identifyJoinResponse`, línea 509) |
| **Lee id/guid/nombre/mapa** | `desktop/internal/tracker/operations.go` (`decodeJoinResponse`, línea 44) |
| **Marca la identidad local** | `desktop/internal/tracker/entity.go` (`SetLocal`, línea 146) |
| Compuerta de métricas | `desktop/internal/tracker/state.go` (`MetricsAllowed`, línea 490) |
| Tabla de códigos | `albion-app/data/photon_codes.json` |
| Pantalla "Personaje detectado" | `desktop/ui/js/tracker/ui.js` (línea 241) |

---

## 3. Dónde se corta la detección: los 4 candidatos reales

Ordenados por probabilidad, comparando el código de los dos proyectos.

### A. El byte de firma elige el decodificador — el más probable

`desktop/internal/tracker/photon/parser.go`, línea 356:

```go
protocol18 := data[0] != protocol16Signature   // 0xF3
```

Este repo mira el **primer byte del mensaje** y, si vale `0xF3`, decodifica con
Protocol16. SAT **nunca hace eso**: en `PhotonParser.cs` saltea la firma sin
mirarla (`offset++`) y usa Protocol18 **siempre**.

Ese byte es el *signifier byte* de Photon y no es un selector de protocolo. Si
en tu sesión cae en `0xF3`, el JoinResponse se decodifica con el parser
equivocado, falla y **se pierde entero**. Síntoma exacto: Photon entra, UDP
sube, pero el personaje nunca aparece.

Hay un test (`photon/signature_test.go`) que cubre `0x00, 0xf1, 0xfe, 0x02,
0x7f`, pero **deja fuera justamente `0xF3`**, que es el único valor que
dispara el bug. Los fixtures `testdata/photon/*.hex` también usan firma `0x00`.

### B. Se exige consumir el datagrama completo

`parser.go`, final de `receivePacket`:

```go
return offset == len(payload) && ok
```

SAT no impone esto: `ReceivePacket` avanza por longitud de paquete y corta
cuando el framer falla, sin invalidar lo ya entregado. Un byte de relleno al
final marca el paquete como fallido en este repo.

Ojo: esto degrada contadores y puede abortar el bucle de `Receive`, aunque el
callback del mensaje ya se haya disparado. Vale revisarlo junto con A.

### C. Se descarta la respuesta si `ReturnCode != 0`

`live.go`, línea 484:

```go
if op.ReturnCode != 0 { return }
```

SAT **no filtra por `ReturnCode`**. En `AlbionParser.OnResponse` el parámetro
`returnCode` se recibe y se ignora: el handler corre igual. Si tu servidor
manda el Join con un `ReturnCode` distinto de 0 (o el campo se decodifica mal),
este repo tira la respuesta y SAT la aceptaría.

### D. `decodeJoinResponse` exige los tres campos a la vez

`operations.go`, línea 72:

```go
return result, result.ObjectID != 0 && result.GUID != "" && result.Name != ""
```

Y `entity.go` línea 150 repite la exigencia. SAT es tolerante: cada campo se
lee con su propio `if`, y `JoinResponseHandler` ya muestra el nombre en la UI
aunque el GUID falte (solo `AddEntityAsync` pide los tres). Si el GUID llega
como un tipo que `GUIDFromPhoton` no reconoce, acá no se detecta nada; en SAT
el nombre igual aparecería.

---

## 4. Cómo comprobarlo vos mismo, sin recompilar

1. Pestaña **Sesión** → activar **Modo diagnóstico**.
2. Con el juego abierto, entrar a un mapa (eso fuerza un `Join`).
3. Mirar los contadores:

| Lo que ves | Qué significa |
|---|---|
| UDP en 0 | No es detección: es captura. Adaptador o Npcap. |
| UDP sube, Photon en 0 | Filtro/puertos. Revisar `bpfFilter`. |
| Photon sube, decodificados en 0 | **Candidato A** — la firma tira los mensajes. |
| Decodificados suben, operación 2 nunca aparece | Framing o fragmentos. |
| Operación 2 aparece, personaje no | **Candidatos C y D** — se descarta el JoinResponse. |

El cuarto y el quinto renglón son los que apuntan a los archivos de arriba.

---

## 5. Diferencia extra que conviene mirar

En SAT, `NewCharacterEvent.cs` lee el GUID en el índice **7** y el nombre en el
**1** — este repo usa los mismos (`"guid": 7, "name": 1`). Pero SAT tiene un
parche que acá no está: en las Brumas, un compañero de party llega con el
nombre literal `"PA"`, y `EntityController.AddEntity` lo reemplaza por el
nombre anterior conocido. No afecta la detección de *tu* personaje, pero sí a
los nombres de party.

---

## Fuentes

- SAT, rama `main`: <https://github.com/Triky313/AlbionOnline-StatisticsAnalysis>
- Revisión adaptada en este repo: `9f4471b2905f4152938d84721492c6ac86499750` (ver `NOTICE`)
- Tipo de mensaje `7` como variante de OperationResponse: `ao-data/albiondata-client` y `cantalupo555/albion-lens`
- Licencia: SAT es GPL-3.0, igual que este proyecto. Ver [`docs/licencia-gpl.md`](licencia-gpl.md)
