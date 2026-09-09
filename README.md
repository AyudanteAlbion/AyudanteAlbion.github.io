<div align="center">

<img src="docs/portada_AA.png" width="100%" alt="Ayudante Albion — calculadora de mercado y crafteo para Albion Online, por SheniaLiam">

# Ayudante Albion

Calculadora de mercado y crafteo para **Albion Online** (servidor West), hecha para el gremio <img src="docs/sg_logo.png" width="30" alt="Escudo de Spetsnaz Grail"> **Spetsnaz Grail**

<a href="https://discord.gg/FH3RzqMPA4" title="Unite al servidor de Discord de Ayudante Albion"><img src="docs/boton_discord.png" width="520" alt="Unite a nuestro Discord: servidor de la comunidad Ayudante Albion"></a>

</div>

Combina las recetas reales del juego con precios de mercado de la comunidad para responder una sola pregunta: cuánto ganás (o perdés) en cada operación. Accede a la página web o descarga el ejecutable de escritorio.

- Accede a la App: https://ayudantealbion.github.io
- Descarga y notas de versión: https://github.com/AyudanteAlbion/AyudanteAlbion.github.io
- Web del gremio: https://spetsnazgrail.com
- Discord del gremio (Spetsnaz Grail): https://discord.gg/TCNWUUA7UY
- Discord de la app (Ayudante Albion): https://discord.gg/FH3RzqMPA4

## Módulos

| Módulo | Qué hace |
|---|---|
| Cocina | Rentabilidad de crafteo de comida en Caerleon con RRR, foco y especialización de ciudad |
| Crafteo de equipo | Armas y armaduras por ciudad de especialización, con el diario de recetas disponible |
| Refinamiento | Madera, mineral, piedra, piel y fibra, tiers completos |
| Alquimia | Pociones y tinturas hechas en Brecilien |
| Encantado | Comprar vs. encantar con fragmentos; planificador con destino de venta independiente, incluido Black Market |
| Granja | Cultivos y productos animales con bonos de isla por ciudad; mercado independiente, Premium, Foco y margen diario por parcela |
| Flipping | Compra en 7 ciudades y venta en 8 destinos (incluido Black Market), con rutas netas de impuestos y preferencias guardadas |
| Alertas de precio | Vigilan un ítem mientras la app está abierta y avisan cuando conviene comprar, vender o flippear |
| Transmutación | Costo de subir tier o encantamiento pagando plata, comparado contra comprar el destino |
| Artefactos | Valor esperado del melding de fragmentos según la estrategia elegida |
| Buscador de precios | Cualquier ítem, todas las calidades, las 7 ciudades más el Mercado Negro, con historial |
| Registro de operaciones | Diario personal de compras y ventas con P&L, resumen por ítem y exportación CSV |
| Perfil | Fama, kills y muertes del personaje real desde el killboard oficial, más el cálculo del costo de Foco según tus especializaciones |
| SG → Spetsnaz Grail | Información del gremio, enlaces a su web y Discord, y creadores con estado EN VIVO / OFFLINE de Twitch |
| SG → Salón de miembros | Ingreso con Discord; los miembros verificados del servidor desbloquean ranking, estadísticas, top semanal, vínculo de personaje y exportación CSV |
| Fórmulas | Referencia de todas las cuentas que usa la app, para poder verificarlas |

El **Inicio** organiza las herramientas en dos slides manuales: **Crafteo** (equipo, refinamiento, alquimia, cocina, encantado y granja) y **Flipping** (flipping, transmutación, artefactos y alertas). Se cambian con los selectores de grupo, las flechas o el teclado, sin avance automático. Buscador, Registro, Perfil y Fórmulas conservan accesos rápidos; los favoritos siguen aparte.

Comportamientos comunes a las herramientas de cálculo:

- Todo precio es editable a mano por ítem, ciudad y calidad, con un botón para volver al valor de la API.
- Cada receta o ítem se puede marcar como favorito y aparece agrupado en la pantalla de inicio.
- Filtros, rutas, favoritos y registros se guardan en `localStorage` del navegador; desde el Registro de operaciones se exportan o importan como un único JSON de respaldo.

## Bonos de Granja / Islas

La **ciudad de la isla** aplica el bono local de +10% nominal al producto correspondiente; la **ciudad de precios** se elige por separado. Las dos ciudades se recuerdan. Las filas bonificadas y su desglose indican el bono aplicado.

El modelo distingue cultivos/hierbas, crías y productores de huevos/leche. No añade bonos a animales vivos ni monturas. Se corrigieron también las fórmulas relacionadas de cosecha, Premium, devolución de semillas y cuidados. Los resultados son estimaciones: no simulan el redondeo de cada cosecha; los márgenes de animales son antes de alimento y la carnicería no está incluida.

Ver [distribución por ciudad, fuentes y fórmulas](docs/farming.md). Pruebas: `cd albion-app && node farm-test.js` (requiere `jsdom`).

## Reportar errores

Al final de **Inicio**, el botón **Reportar un problema** abre un nuevo issue de este repositorio en otra pestaña. Incluye una plantilla en español con herramienta afectada, descripción, pasos para reproducir, resultado esperado, entorno y capturas opcionales.

El usuario revisa y envía el reporte desde su cuenta de GitHub; los issues son públicos. La app no crea reportes automáticamente ni adjunta datos del navegador, almacenamiento local o sesión de Discord. La plantilla también está disponible en `.github/ISSUE_TEMPLATE/bug_report.md` para quienes reporten directamente desde el repositorio. El enlace de la app lleva el contenido precargado, por lo que no depende de la publicación de esa plantilla.

## Comunidad

El botón de arriba lleva al **servidor de Discord de Ayudante Albion** (https://discord.gg/FH3RzqMPA4): ahí se comparten novedades, avisos de versiones, bugs y pedidos de funciones de la app. Dentro de la app el mismo destino está en el **Inicio**, en la pastilla «Únete a nuestra comunidad», justo debajo del crédito del gremio.

Es un servidor separado del del gremio — para jugar con Spetsnaz Grail hay que pasar por su Discord (https://discord.gg/TCNWUUA7UY), que además es el que verifica el acceso al Salón de miembros.

## Black Market: solo destino de venta

- Disponible en Flipping, Crafteo de equipo y el planificador de Encantado. En Alertas se puede vigilar su orden de compra o incluirlo en la mejor ruta de flipping.
- Nunca se ofrece como origen de compra ni como lugar de crafteo en el Registro. No se añade a los módulos de recursos, consumibles, artefactos ni granja: el Black Market compra equipo.
- La venta usa `buy_price_max` (lo que paga el mercado al jugador), con impuesto de 4%/8% según Premium, sin tasa de publicación. Sin orden de compra, no se calcula una venta con `sell_price_min` como respaldo.
- Flipping, Crafteo y Encantado consultan calidad Normal para evitar comparar precios de calidades distintas. El Buscador mantiene todas las calidades, sin mostrar compras en Black Market.

Pruebas de regresión (requieren `jsdom`):

```bash
cd albion-app
node black-market-test.js
node qa-test.js
node smoke-test.js
```

## Acceso de miembros SG (Discord)

La app es pública, pero tiene una sección exclusiva: los miembros de Spetsnaz Grail ingresan con su cuenta de Discord y desbloquean el **Salón de miembros** (ranking completo del gremio desde el killboard, estadísticas, top semanal y vínculo con su personaje de Albion).

La pestaña **SG** tiene dos subpestañas: **Spetsnaz Grail**, pública y seleccionada por defecto, y **Salón de miembros**, con el acceso y las herramientas. El retorno desde Discord y el acceso desde el menú de cuenta abren directamente el Salón. Las subpestañas también se recorren con las flechas del teclado, Inicio y Fin.

Cómo funciona: el botón «Ingresar con Discord» pasa por el Worker de Cloudflare, que hace el intercambio OAuth2 (el secreto nunca llega al navegador), verifica si el usuario pertenece al servidor de Discord de SG y devuelve una sesión firmada válida 30 días. El «Ver miembros del gremio» del módulo Perfil también queda reservado a miembros.

**Alcance del acceso actual:** el Worker verifica la membresía al ingresar y firma la sesión con HMAC. La app **no confía en ninguna sesión** (ni la que vuelve de Discord ni la guardada en el navegador) hasta que `GET /discord/verify` del Worker confirma firma y vigencia; una sesión forjada o alterada se descarta. Los datos que hoy muestra el Salón siguen siendo públicos (killboard); cualquier futura herramienta con datos privados debe servirlos desde el Worker validando la sesión, nunca desde el sitio estático.

### Puesta en marcha (una sola vez)

1. **Crear la app de Discord**: en el [Developer Portal](https://discord.com/developers/applications) → New Application. Copiar el **Client ID** y el **Client Secret** (pestaña OAuth2). No hace falta bot.
2. **Registrar el redirect**: en OAuth2 → Redirects, agregar exactamente:
   `https://ayudantealbion.josemesina21.workers.dev/discord/callback`
3. **Obtener el ID del servidor SG**: en Discord, Ajustes → Avanzado → Modo desarrollador activado; clic derecho sobre el servidor de Spetsnaz Grail → «Copiar ID del servidor».
4. **Configurar el Worker**: en el dashboard de Cloudflare → Workers & Pages → `ayudanteAlbion` → Settings → Variables and Secrets:
   - `DISCORD_CLIENT_ID` (texto) — el Client ID
   - `SG_DISCORD_GUILD_ID` (texto) — el ID del servidor
   - `DISCORD_CLIENT_SECRET` (**secreto**) — el Client Secret
   - `AA_SESSION_KEY` (**secreto, obligatorio**) — clave para firmar sesiones: al menos 32 caracteres aleatorios y distinta del Client Secret (por ejemplo `openssl rand -hex 32`). Sin ella el acceso SG queda desactivado.
5. **Deployar**: el Worker se construye solo desde este repo al pushear a `main`.

Hasta que las variables existan, la app funciona normal: el Salón muestra las herramientas disponibles y un aviso de configuración pendiente, sin ofrecer un botón de ingreso que no funciona. El botón de Discord de la barra permanece oculto (`GET /discord/config` responde `configured: false`).

### Probar sin tocar Discord

```bash
node worker/selftest.mjs     # 52 chequeos del OAuth y la verificación de sesión con Discord simulado
cd albion-app && node qa-test.js   # QA completa, incluye la Sala de miembros
```

## Ejecutable

`AyudanteAlbion.exe` para Windows 10/11 x64. Al abrirlo levanta un servidor local en el puerto 3000 (usa otro si está ocupado)

Para trabajar localmente:

```bash
cd albion-app
python3 server.py     # http://localhost:3000
```

El server local incluye un simulador del consentimiento de Discord (`/discord/login`): permite probar el ingreso de miembros SG, la Sala y el caso no-miembro sin necesidad de configurar Cloudflare.

## Seguridad

- **CSP** en `index.html`: solo se ejecuta `app.js` (sin scripts inline ni de terceros) y la red queda acotada a las APIs que usa la app. Si se agrega un servicio nuevo hay que sumarlo a la política o el navegador lo bloquea. Por eso los botones se enganchan con `data-*` y delegación de eventos, nunca con `onclick` inline.
- Todo dato que llega de fuera (Discord, killboard) se escapa antes de pintarse; los toasts usan texto plano.
- La sesión de Discord solo se acepta después de que el Worker confirme su firma (`/discord/verify`).
- El proxy del Worker reenvía únicamente las rutas del killboard que usa la app y solo a los orígenes de la app (GitHub Pages y localhost).
- Los CSV neutralizan celdas que empiezan como fórmula; el respaldo solo exporta/importa claves de datos conocidas (nunca la sesión ni la configuración del proxy).
- `server.py` escucha solo en `127.0.0.1`.

## Precios

Los precios reflejan el último escaneo de la comunidad, que puede tener varios minutos de demora. El Mercado Negro solo publica órdenes de compra (te compra a vos); por eso ahí la comparación se hace contra ese bid y no contra un precio de venta. Las alertas de precio solo funcionan con la app abierta. Si la cierras se detiene el seguimiento.

## Licencia

El código de este repositorio está bajo licencia MIT (ver `LICENSE`). La licencia cubre únicamente el código propio: los íconos, nombres y datos del juego pertenecen a Sandbox Interactive y las tablas extraídas de `ao-bin-dumps` siguen las condiciones de ese proyecto comunitario.

## Créditos

Desarrollado por SheniaLiam para el gremio Spetsnaz Grail. Los íconos y datos provienen de proyectos comunitarios; el killboard es de Sandbox Interactive.

**Assets de marca**: el arte de alta resolución está en `docs/branding/` (`portada_AA.png`, `logo_AA.png`, `sg_logo.png`) y no forma parte de la app ni del `.zip` de la release. Lo que usa este README son versiones optimizadas en `docs/`: la portada con esquinas redondeadas, el escudo de SG recortado con fondo transparente (para que funcione igual en tema claro y oscuro) y el botón de Discord, compuesto con el logo de Ayudante Albion.
