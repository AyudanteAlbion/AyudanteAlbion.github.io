# Actualizar la tabla de códigos Photon

Guía práctica para cuando el tracker deja de mostrar datos después de un parche de Albion.

**No hace falta recompilar, ni reinstalar, ni esperar una versión nueva de la app.** Se edita un
archivo de texto y se toca un botón.

---

## 1. Por qué existe este archivo

Albion Online habla con sus servidores por el protocolo Photon. Cada cosa que pasa —un golpe, una
curación, entrar a un mapa, ganar fama— viaja como un *evento* identificado por un número.

Esos números **no son públicos ni estables**: Sandbox Interactive los reordena en casi cada parche.
Cuando eso pasa, el evento «daño» pasa a tener otro número, el tracker deja de reconocerlo y el
medidor se queda en cero.

Por eso la tabla vive en `albion-app/data/photon_codes.json` y **no dentro del ejecutable**. Un
parche de Albion se arregla editando texto, no publicando un binario nuevo.

---

## 2. Dónde busca el archivo la aplicación

En este orden, y gana el primero que exista y sea válido:

| # | Ubicación | Para qué sirve |
|---|---|---|
| 1 | `photon_codes.json` **junto al `.exe`** | El arreglo rápido: pegás el archivo al lado del ejecutable |
| 2 | `%APPDATA%\AyudanteAlbion\photon_codes.json` | Para que sobreviva a actualizar el `.exe` |
| 3 | La copia incluida en el ejecutable | La de fábrica, siempre presente |

Si una tabla externa está rota, **no se pierde el tracker**: se avisa el error en la pestaña Sesión
y se sigue usando la copia de fábrica.

---

## 3. Cómo actualizarla

### Paso 1 — Ver qué está llegando

En la pestaña **Sesión**, con el tracking activo, tocá **Modo diagnóstico**. Aparecen dos tablas:

- **Desconocidos** — códigos que el juego está mandando y la tabla no reconoce. Acá está el evento
  que se movió.
- **Reconocidos** — los que sí reconoce, con cuántas veces llegaron.

Un evento muy frecuente en combate y con números grandes es casi seguro `HealthUpdate` (daño y
curación). Los que llegan una vez al cambiar de mapa son `JoinFinished` o `ChangeCluster`.

### Paso 2 — Corregir el número

Abrí `photon_codes.json` con cualquier editor de texto y cambiá el número:

```json
"events": {
  "HealthUpdate": 6,     ← si el diagnóstico muestra que ahora es 7, poné 7
  "UpdateFame": 89
}
```

Para desactivar un evento sin borrarlo, poné `null`:

```json
"SiegeCampClaimStart": null
```

### Paso 3 — Recargar

Volvé a la pestaña Sesión y tocá **Recargar códigos**. La app lee el archivo de nuevo y, si el
tracking estaba activo, lo reinicia solo. **No hay que cerrar nada.**

Si el archivo tiene un error, la app lo dice y sigue funcionando con la tabla anterior.

---

## 4. Estructura del archivo

| Sección | Qué contiene |
|---|---|
| `version` | Identifica esta tabla. Cambialo al editarla, así se ve en la interfaz cuál está cargada |
| `gameVersion` | El parche de Albion para el que se verificó |
| `parameterKeys` | Dónde viaja el código real: `eventCode` 252, `operationCode` 253. Casi nunca cambian |
| `events` | Nombre lógico → número. **Lo que más cambia** |
| `operations` | Igual, para mensajes del cliente al servidor |
| `eventParameters` | Dentro de cada evento, en qué índice está cada dato (quién, a quién, cuánto) |
| `selfOperation` | De qué operación se saca tu personaje |

Las claves que empiezan con `_` son comentarios y se ignoran.

### Reglas que se validan

- Los códigos de `events` y `operations` van de **0 a 65535** (viajan como entero de 16 bits en el
  parámetro 252/253, por eso hay códigos mayores a 255).
- Los índices de `eventParameters` van de **0 a 255** (son claves del diccionario Photon).
- No puede haber dos eventos con el mismo código.
- `selfOperation.operation` tiene que existir en `operations`.

`python3 scripts/validate_repo.py` chequea todo esto, y `build.sh` también, para que no se publique
una edición Tracker con la tabla rota.

---

## 5. De dónde sacar los números correctos

- **El modo diagnóstico de la app** — la fuente más confiable, porque muestra lo que está pasando
  en tu cliente ahora mismo.
- [`ao-bin-dumps`](https://github.com/broderickhyman/ao-bin-dumps) — volcados de datos del cliente.
- [`AlbionOnline-StatisticsAnalysis`](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis) —
  suele actualizar sus códigos rápido después de cada parche.

---

## 6. Si actualizaste bien y aun así no anda

1. ¿El tracking está activo? Arranca apagado a propósito.
2. ¿Npcap está instalado y la app corre como administrador?
3. ¿El diagnóstico muestra *algún* código? Si no llega nada, el problema es la captura, no la tabla
   — revisá que no estés usando VPN o ExitLag, que rompen la captura.
4. ¿Cambió también el *índice de parámetros*? Si el evento se reconoce pero los números salen mal
   o en cero, lo que se movió es `eventParameters`, no el código del evento.
