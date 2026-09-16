# Cumplimiento con las normas de Albion Online

> Revisión: 15 de septiembre de 2026. Este documento es una auditoría técnica,
> no asesoramiento legal ni una autorización de Sandbox Interactive (SBI).
> Ninguna aplicación de terceros puede prometer riesgo cero de sanción.

## Referencias

- [Términos y condiciones de Albion Online](https://albiononline.com/terms-and-conditions), en particular la sección sobre manipulación y software de terceros.
- [Aclaración oficial sobre software de terceros y tráfico de red](https://forum.albiononline.com/index.php/Thread/124819-Regarding-3rd-Party-Software-and-Network-Traffic-aka-do-not-cheat-Update-16-45-U/): prohíbe radares, auto-inspección, auto-scouting, automatización, modificaciones del cliente, overlays que den ventaja y recolección que afecte sus servidores; ante dudas, indica consultar a soporte.
- [Respuesta sobre Albion Online Stats](https://forum.albiononline.com/index.php/Thread/131956-Albion-Online-Stats-is-legal/): el criterio comunicado fue aceptar el monitoreo limitado al grupo propio, sin modificar el cliente, sin jugadores fuera de la vista y sin overlay.
- [Statistics Analysis](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis#is-this-allowed): proyecto comunitario de referencia que declara los mismos cuatro límites. No es una aprobación transferible a otras aplicaciones.

Las respuestas históricas de SBI permiten entender el criterio, pero los términos
vigentes y una respuesta escrita de soporte tienen prioridad. SBI puede cambiar
su postura o evaluar cada herramienta de manera diferente.

## Resultado de la auditoría

| Límite | Implementación de Ayudante Albion |
|---|---|
| Solo observar | Npcap se abre en modo no promiscuo y el código solo importa funciones de lectura. No existe una ruta para inyectar, modificar o reenviar paquetes. |
| Sin cliente ni memoria | No se abre el proceso de Albion, no se leen/escriben sus archivos o memoria y no se carga código dentro del juego. |
| Sin automatización | No se emiten teclas, clics ni acciones del personaje. Tampoco se generan consultas automáticas al mercado dentro del juego. |
| Sin overlay | La información vive en una ventana independiente. La app no se vuelve transparente ni se fija encima del juego. |
| Solo personaje y party | Daño, curación y botín se aceptan únicamente si la fuente es el personaje detectado o un integrante de la party actual. Los demás eventos se descartan. |
| Solo campo de visión | Los nombres se conocen únicamente por eventos que Albion ya entregó a esta PC. No hay radar, búsqueda de entidades, proximidad ni alertas de jugadores. |
| Sin compartir captura | El tracker agrega estadísticas en memoria local. No sube paquetes, nombres, party, botín o rutas a un servidor. |
| Activación voluntaria | La captura empieza apagada y requiere que el usuario pulse **Activar tracking**. |
| Carga sobre SBI | La captura es pasiva. Las consultas de precios usan fuentes web comunitarias existentes; el tracker no crea tráfico hacia servidores del juego. |

## Barreras que deben conservarse

No se debe incorporar ninguna de estas funciones sin obtener antes una
confirmación escrita de SBI:

1. radar de jugadores, recursos, cofres, mobs o entidades;
2. auto-inspección, auto-scouting o avisos automáticos de enemigos;
3. reconstrucción o publicación automática de la topología, conexiones o portales de Caminos de Avalon (el historial personal lineal no debe convertirse en un GPS);
4. overlay, ventana transparente o modo «siempre visible» sobre Albion;
5. lectura de memoria, hooks, DLL injection o acceso al proceso del juego;
6. generación, modificación, repetición o envío de paquetes;
7. macros, clics, teclas o navegación automatizada;
8. escaneo automático del mercado o cualquier acción que produzca solicitudes adicionales al juego;
9. estadísticas de enemigos o de jugadores que no integran la party;
10. subida automática de tráfico o datos de sesión a servicios externos.

## Relación con Statistics Analysis

Se adoptó el **modelo de seguridad observable** de Statistics Analysis: monitor
pasivo, ventana separada, sin cliente modificado y alcance propio/party. El
tracker incorpora adaptaciones del ciclo de entidades de SAT bajo GPL-3.0; sus
avisos y procedencia están en [`../NOTICE`](../NOTICE). Ayudante Albion se
distribuye ahora bajo GPL-3.0-only. La licencia no es una aprobación de SAT ni
de SBI: las barreras verificables de este repositorio se mantienen.

## Recomendación antes de publicar

Enviar a soporte de Albion el enlace al repositorio y una descripción exacta de
las funciones. Conviene pedir evaluación escrita indicando expresamente:

- captura UDP pasiva con Npcap;
- aplicación separada, sin overlay;
- sin acceso a proceso, memoria o archivos del juego;
- sin envío de paquetes ni automatización;
- daño, curación y botín limitados al personaje/party;
- datos de sesión solo locales;
- código fuente público para auditoría.

Hasta recibir respuesta, la interfaz y la documentación no deben afirmar
«aprobada», «autorizada» o «imposible de banear». La formulación correcta es
«diseñada para respetar los criterios públicos», junto con la advertencia de
que SBI tiene la decisión final.
