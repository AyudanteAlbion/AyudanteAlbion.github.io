# Ayudante Albion

Calculadora de mercado y crafteo para Albion Online (servidor Américas / West), hecha para el gremio Spetsnaz Grail.

Combina las recetas reales del juego con precios de mercado de la comunidad para responder una sola pregunta: cuánto ganás (o perdés) en cada operación. Corre como página web local o como ejecutable de escritorio; no tiene backend propio ni guarda datos en servidores.

- Web del gremio: https://spetsnazgrail.com
- Discord: https://discord.gg/cqG7rDmUSJ
- Descarga y notas de versión: https://github.com/Guallama31/AyudanteAlbion/releases/latest

## Módulos

| Módulo | Qué hace |
|---|---|
| Cocina | Rentabilidad de crafteo de comida en Caerleon con RRR, foco y especialización de ciudad |
| Crafteo de equipo | Armas y armaduras por ciudad de especialización, con el diario de recetas disponible |
| Refinamiento | Madera, mineral, piedra, piel y fibra, tiers completos |
| Alquimia | Pociones y tinturas hechas en Brecilien |
| Encantado | Comprar el ítem encantado vs. encantar con fragmentos, con las cantidades oficiales |
| Granja | Cultivos, animales y productores; ganancia diaria por parcela |
| Flipping | Mejor ruta de compra/venta entre las 7 ciudades, neto de impuestos; origen y destino fijables y se recuerdan |
| Alertas de precio | Vigilan un ítem mientras la app está abierta y avisan cuando conviene comprar, vender o flippear |
| Transmutación | Costo de subir tier o encantamiento pagando plata, comparado contra comprar el destino |
| Artefactos | Valor esperado del melding de fragmentos según la estrategia elegida |
| Buscador de precios | Cualquier ítem, todas las calidades, las 7 ciudades más el Mercado Negro, con historial |
| Registro de operaciones | Diario personal de compras y ventas con P&L, resumen por ítem y exportación CSV |
| Perfil | Fama, kills y muertes del personaje real desde el killboard oficial, más el cálculo del costo de Foco según tus especializaciones |
| Gremio | Enlaces de Spetsnaz Grail y creadores del gremio con estado EN VIVO / OFFLINE de su canal de Twitch |
| Fórmulas | Referencia de todas las cuentas que usa la app, para poder verificarlas |

Comportamientos comunes a las herramientas de cálculo:

- Todo precio es editable a mano por ítem, ciudad y calidad, con un botón para volver al valor de la API.
- Cada receta o ítem se puede marcar como favorito y aparece agrupado en la pantalla de inicio.
- Filtros, rutas, favoritos y registros se guardan en `localStorage` del navegador; desde el Registro de operaciones se exportan o importan como un único JSON de respaldo.

## Ejecutable de escritorio

`AyudanteAlbion.exe` para Windows 10/11 x64. Al abrirlo levanta un servidor local en el puerto 3000 (usa otro si está ocupado), abre el navegador y sirve la app embebida: no requiere instalación, administración ni conexión más que para consultar los precios.

Se apaga solo cuando la pestaña se cierra de verdad: la página envía un latido cada pocos segundos y el servidor se retira tras 15 minutos sin latidos. Mientras la pestaña esté abierta, el modo anti-pausa (activo por defecto) evita que el navegador congele o limite la app en segundo plano, usando una Web Lock, un loop de audio inaudible y Wake Lock con la app a la vista; el botón de rayo en la barra superior lo desactiva si preferís que el navegador ahorre recursos. La preferencia queda guardada.

## Desarrollo

Para trabajar localmente:

```bash
cd albion-app
python3 server.py     # http://localhost:3000
```

## Precios

Los precios reflejan el último escaneo de la comunidad, que puede tener varios minutos de demora. El Mercado Negro solo publica órdenes de compra (te compra a vos); por eso ahí la comparación se hace contra ese bid y no contra un precio de venta. Las alertas de precio solo funcionan con la app abierta, porque no hay servidor ni service worker de por medio. Todo cálculo es orientativo: el juego cambia, y ninguna de estas APIs lo garantiza.

## Créditos

Desarrollado por SheniaLiam para el gremio Spetsnaz Grail. Los íconos y datos provienen de proyectos comunitarios; el killboard es de Sandbox Interactive.
