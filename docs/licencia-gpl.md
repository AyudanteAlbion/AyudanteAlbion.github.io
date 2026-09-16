# Licencia GPL-3.0 de Ayudante Albion

Desde el 16 de septiembre de 2026, el repositorio **Ayudante Albion**, la aplicación web y el
binario de escritorio se distribuyen bajo **GNU GPL, versión 3 únicamente**
(`GPL-3.0-only`). El texto íntegro está en [`../LICENSE`](../LICENSE).

## Código adaptado de Statistics Analysis Tool

El motor de tracking de escritorio contiene adaptaciones para Go/Wails del
ciclo de entidades de
[AlbionOnline-StatisticsAnalysis (SAT)](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis),
que está publicado bajo GPL-3.0. La base de referencia es el commit
[`9f4471b2905f4152938d84721492c6ac86499750`](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis/tree/9f4471b2905f4152938d84721492c6ac86499750).

Los avisos de atribución, el alcance de las adaptaciones y cómo obtener el
código fuente correspondiente están en [`../NOTICE`](../NOTICE). Los archivos
derivados del tracker llevan además un aviso de procedencia.

## Al distribuir un ejecutable

Toda distribución debe incluir `LICENSE`, `NOTICE` y una forma clara de obtener
el **código fuente correspondiente** de esa versión. El workflow de escritorio
lo hace automáticamente: añade esos archivos y `SOURCE_CODE.txt`, que apunta
al commit exacto indicado en `BUILD_INFO.txt`.

Esta licencia se refiere al código de Ayudante Albion y sus adaptaciones. No
transfiere derechos sobre Albion Online, sus marcas, sus íconos o sus datos;
esos elementos siguen perteneciendo a sus titulares respectivos. Tampoco es
una autorización de Sandbox Interactive para software de terceros. Consultá
[`cumplimiento-albion.md`](cumplimiento-albion.md) para los límites operativos
del tracker.
