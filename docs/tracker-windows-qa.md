# QA de aprobación del tracker en Windows

Este documento es la matriz de aprobación funcional. **Un build verde no
reemplaza estas pruebas sobre Windows y redes reales.** La versión solo puede
marcarse aprobada cuando cada fila obligatoria tenga fecha, equipo, versión de
Albion, versión de Npcap y evidencia.

## Preparación

Registrar antes de cada corrida:

- commit y artefacto de GitHub Actions;
- versión de Windows, Albion Online, Npcap y `photon_codes.json`;
- proveedor (`npcap` o `socket`) y si la app se ejecutó como administrador;
- tipo de red, adaptador y presencia de VPN;
- únicamente contadores/códigos en la evidencia diagnóstica. No adjuntar nombres,
  GUID, contenido de paquetes ni capturas con datos personales.

La identidad se considera detectada solo cuando un `JoinResponse` exitoso aporta
Object ID, GUID y nombre. La instrucción de repetición es: **“Para detectar de
nuevo tu personaje, cerrá sesión en Albion y volvé a entrar.”**

## Matriz obligatoria de hardware y red

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| HW-01 | Npcap sobre Wi-Fi, sin VPN | Recorre Capturando red → Photon → servidor → JoinResponse → personaje; fija el adaptador correcto | Pendiente de Windows real |
| HW-02 | Npcap sobre Ethernet | Igual que HW-01, sin duplicar estadísticas | Pendiente de Windows real |
| HW-03 | Npcap con VPN activa | Omite loopback/down, elige el adaptador que entrega Photon válido y no mezcla duplicados | Pendiente de Windows real |
| HW-04 | Cambio Wi-Fi → Ethernet durante captura | Detecta caída, vuelve a Preparando captura, reabre y recupera sin Demo | Pendiente de Windows real |
| HW-05 | Activar/desactivar VPN durante captura | Libera el adaptador muerto/inactivo y vuelve a fijar el que entrega Photon | Pendiente de Windows real |
| HW-06 | Socket sin elevación | No informa captura activa; muestra que requiere administrador | Pendiente de Windows real |
| HW-07 | Socket como administrador, IPv4 | `SIO_RCVALL` se activa antes de informar Capturando red y detecta la sesión | Pendiente de Windows real |
| HW-08 | Socket como administrador, IPv6 | Abre todas las direcciones locales utilizables y detecta tráfico IPv6 | Pendiente de Windows real |
| HW-09 | Socket con varias IP/adaptadores | Abre múltiples sockets, evita métricas duplicadas y se recupera ante cambios | Pendiente de Windows real |

## Matriz obligatoria de sesión

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| SE-01 | JoinResponse normal | Identidad, mundo, entidad local y party se publican atómicamente | Pendiente de captura real |
| SE-02 | JoinResponse fragmentado en IPv4/Photon | Reensambla dentro de límites y detecta una sola identidad | Pendiente de captura real |
| SE-03 | Varias tramas Photon en un UDP | Despacha cada mensaje una vez y mantiene orden | Cubierto por fixture automatizado; repetir en real |
| SE-04 | Party ya formada antes del Join local | Conserva roster GUID interno y lo expone solo al identificar al local | Pendiente de captura real |
| SE-05 | ChangeCluster y JoinFinished | Conserva identidad, limpia Object IDs transitorios y registra mapa/instancia | Pendiente de captura real |
| SE-06 | Relog del mismo personaje | Continúa la sesión sin duplicar identidad | Pendiente de captura real |
| SE-07 | Cambio a otro personaje | Reemplaza entidad local y reinicia métricas para no mezclar personajes | Pendiente de captura real |
| SE-08 | Filtro de nombre coincidente/no coincidente | Solo acepta estadísticas si el nombre de Join coincide; cambiar el filtro reinicia la agregación | Pendiente de captura real |
| SE-09 | Paquete cifrado | Se cuenta y descarta; no intenta descifrarlo | Cubierto por fixture automatizado; repetir en real |

## Tabla externa y privacidad

| ID | Escenario | Resultado esperado | Estado |
|---|---|---|---|
| TB-01 | Recargar tabla válida actualizada | Se valida completa, se activa y reinicia la fuente si estaba corriendo | Pendiente de Windows real |
| TB-02 | Recargar tabla truncada, con JSON extra o esquema incompleto | No activa la tabla inválida; informa el error y conserva una tabla válida | Cubierto por tests; repetir en app |
| TB-03 | Ausencia de 252/253 o valor fuera de `int16` positivo | No entra al handler tipado; incrementa el contador correspondiente | Cubierto por tests; repetir en diagnóstico |
| PR-01 | Diagnóstico con sesión real | Solo muestra códigos, contadores y transporte; nunca nombres, GUID o contenido de paquetes | Pendiente de inspección real |
| PR-02 | Demo seleccionada | La interfaz muestra “MODO DEMO · NO ES TRACKING REAL” y nunca la confunde con captura | Pendiente de inspección visual |

## Evidencia y aprobación

Para cada fila pendiente, anexar en el PR o release:

1. fecha y responsable;
2. ID de fila y resultado (aprobado/falló);
3. commit/artefacto probado;
4. contadores y secuencia de fases sin PII;
5. pasos de reproducción para cualquier fallo.

La aprobación final requiere **todas** las filas HW, SE pendientes, TB de app y
PR en estado aprobado. Si Albion cambia el protocolo o se actualiza la tabla de
códigos, repetir al menos SE-01, SE-02, SE-04, SE-05, SE-07, TB-01 y TB-03.
