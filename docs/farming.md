# Granja: bonos de isla y alcance del cálculo

Revisión: 9 de septiembre de 2026.

## Qué cambió

El selector anterior solo elegía precios. Ahora **Ciudad de la isla** determina el bono local y **Ciudad de precios** determina las cotizaciones y los precios manuales. Ambas selecciones se guardan en `farmPrefs` y se incluyen en el respaldo general.

El bono local nominal es **+10% de producción** para las siguientes combinaciones. No modifica la devolución de semillas, las crías ni el número de animales adultos. El bono de carnicería corresponde a otra operación, no a vender animales vivos. [1](https://forum.albiononline.com/index.php/Thread/185792-Island-Move-Period-Farming-Bonuses/)

| Isla | Cultivos | Hierbas | Productos animales |
|---|---|---|---|
| Lymhurst | Zanahoria, calabaza | Bardana almenada | Huevos de ganso |
| Bridgewatch | Frijoles, maíz | Cardo de dragón | Leche de cabra |
| Martlock | Trigo, patata | Dedalera elusiva | Leche de vaca |
| Thetford | Col | Agárico arcano, gordolobo de fuego | Ninguno (el cerdo tiene bono de carnicería) |
| Fort Sterling | Nabo | Milenrama demoníaca | Huevos de gallina, leche de oveja |
| Caerleon | Ninguno | Consuelda hojabrillante, cardo de dragón, gordolobo de fuego | Ninguno |
| Brecilien | Los ocho cultivos, no hierbas | Ninguna | Ninguno |

Distribución contrastada con el anuncio oficial y los campos `farmingyieldmodifier/@islandvalue` del archivo `farmingmodifiers.json`. [1](https://forum.albiononline.com/index.php/Thread/185792-Island-Move-Period-Farming-Bonuses/)

## Datos utilizados

Se conserva `albion-app/data/farm_data.json` con sus 109 entradas. Se añaden:

- `bonusCities`: ciudades que bonifican **esa semilla o ese productor adulto**, no sus crías.
- `yieldBase`: media del intervalo de cantidad del producto en su lootlist; excluye lombrices y otros productos secundarios.
- `focusCycles`: máximo de cuidados por ciclo, obtenido de `activefarmmaxcycles` para las crías.

Snapshot de `ao-data/ao-bin-dumps`: **`0be6a5e74f30fc1312118be3d017f3832f027cef`**.

- [farmingmodifiers.json](https://github.com/ao-data/ao-bin-dumps/blob/0be6a5e74f30fc1312118be3d017f3832f027cef/farmingmodifiers.json): islas de Thetford `0000`, Lymhurst `1000`, Bridgewatch `2000`, Martlock `3004`, Fort Sterling `4000`, Caerleon `3003`, Brecilien `5000`.
- [items.json](https://github.com/ao-data/ao-bin-dumps/blob/0be6a5e74f30fc1312118be3d017f3832f027cef/items.json): `farmableitem`, `harvest`, `products/product`, `activefarmmaxcycles`.
- [loot.json](https://github.com/ao-data/ao-bin-dumps/blob/0be6a5e74f30fc1312118be3d017f3832f027cef/loot.json): cultivo/hierba `3–6` (media 4,5); huevos/leche `7–11` (media 9) en este snapshot.

Los dumps completos no se incorporan al repositorio: solo los campos necesarios.

## Fórmulas y correcciones relacionadas

- Producción media = `yieldBase × (Premium ? 2 : 1) × (1 + bono_local)`.
- Semillas devueltas = `seedBack + (Foco ? focusBonus : 0)`. Puede superar 100%; no se limita a una semilla.
- Crías esperadas = `offspring + (Foco ? focusBonus × focusCycles : 0)`, suponiendo todos los cuidados disponibles.
- Crecimiento de crías = `grow / (Premium ? 2 : 1)`. Cultivos y productores conservan su ciclo de 22 horas.
- Margen por parcela y día = `margen_por_unidad × 9 / días_del_ciclo`.
- Impuesto de venta: 4% con Premium, 8% sin Premium.

Se corrige el anterior +50% de cosecha, la multiplicación del producto por Foco y la duplicación indiscriminada de crías. Premium duplica los productos; el riego y los cuidados mejoran semillas/crías, no la cosecha. La guía oficial confirma también la reducción de tiempo de crecimiento de animales con Premium. [2](https://wiki.albiononline.com/wiki/Island_Farms) [3](https://albiononline.com/news/guide-farming)

## Límites explícitos

- **Es una estimación con el bono nominal de +10%, no una reproducción exacta de cada recolección.** El modelo no simula azar ni redondeos intermedios del servidor. Se han documentado diferencias por redondeo en cosechas reales; por eso no se presentan los promedios como rendimientos garantizados. [4](https://forum.albiononline.com/index.php/Thread/212675-crop-farming-yield/)
- Los márgenes de animales son **antes de alimento**. El alimento favorito y su ahorro no se calculan aquí; tampoco la carnicería, sus tasas o retornos.
- Los productores se consideran reutilizables: no se descuenta su compra inicial de cada ciclo. No hay amortización de isla o edificios, transporte ni tasa de publicación.
- Semillas y crías devueltas se valoran al costo de reposición. No se simula la venta por separado de excedentes ni su impuesto.
- El cálculo por parcela mantiene el supuesto de nueve unidades. No es un simulador de colocación de animales grandes en perreras.
- Las combinaciones sin cotizaciones suficientes no se consideran rentables por asumir insumos gratis.

## Pruebas

```bash
cd albion-app
node farm-test.js
node qa-test.js
```

Requieren `jsdom`. Se verifican todas las combinaciones de ciudad/especie, Premium y Foco, exclusión de crías y monturas, independencia del mercado, precios manuales, persistencia, desglose y totales por parcela.
