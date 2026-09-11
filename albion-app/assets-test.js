/* ============================================================
   Verificación del artefacto publicado
   ------------------------------------------------------------
   Lee index.html y comprueba que TODO archivo local que pide
   (scripts, hojas de estilo, imágenes, iconos) exista de verdad
   dentro de la raíz que se le pasa.

   Existe por un error real: index.html cargaba los ocho módulos
   de js/ pero ni pages.yml ni build.sh copiaban esa carpeta. La
   web y el .exe corrían con los fallbacks de app.js y tiraban
   ocho 404 por carga. Ninguna suite lo vio porque todas evalúan
   app.js aislado, nunca el sitio armado.

   Uso:
     node assets-test.js            # sobre las fuentes (albion-app/)
     node assets-test.js ../_site   # sobre el sitio de Pages
     node assets-test.js ../albion-exe/app
   ============================================================ */
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const errors = [];
const oks = [];

function check(cond, okMsg, errMsg) {
  if (cond) { oks.push(okMsg); console.log('  ✓ ' + okMsg); }
  else { errors.push(errMsg); console.log('  ✗ ' + errMsg); }
}

console.log(`Verificación de recursos del artefacto\n  raíz: ${root}\n`);

const indexPath = path.join(root, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`ERROR: no existe ${indexPath}`);
  process.exit(1);
}
const html = fs.readFileSync(indexPath, 'utf8');

/* Referencias locales: se descartan las absolutas (http, //, data:) y las
   anclas. El ?v= de cache-busting no es parte del nombre del archivo. */
const refs = new Set();
for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
  const raw = m[1].trim();
  if (!raw || /^(https?:)?\/\//i.test(raw) || /^(data|mailto|javascript):/i.test(raw) || raw.startsWith('#')) continue;
  refs.add(raw.split(/[?#]/)[0]);
}

console.log(`— referencias locales en index.html (${refs.size}) —`);
for (const ref of [...refs].sort()) {
  check(fs.existsSync(path.join(root, ref)), ref, `${ref} — REFERENCIADO PERO AUSENTE`);
}

/* Los módulos son el caso que falló: se exige la lista completa, así que
   agregar un módulo nuevo a js/ sin sumarlo al deploy también rompe acá. */
console.log('\n— módulos del frontend —');
const MODULES = [
  'js/core/storage.js', 'js/core/format.js', 'js/core/api.js', 'js/core/navigation.js',
  'js/market/history.js', 'js/crafting/recipe.js', 'js/profile/specs.js', 'js/builds/build.js',
];
for (const mod of MODULES) {
  const present = fs.existsSync(path.join(root, mod));
  check(present, `${mod} presente en el artefacto`, `${mod} FALTA en el artefacto (la app caería al fallback)`);
  if (present) {
    check(html.includes(mod), `${mod} cargado desde index.html`,
      `${mod} existe pero index.html no lo carga (código muerto)`);
  }
}

/* El artefacto no debe llevar herramientas de desarrollo ni el servidor
   local: son superficie de ataque y peso muerto en la web y en el .exe. */
if (path.resolve(root) !== path.resolve(__dirname)) {
  console.log('\n— higiene del artefacto —');
  for (const dev of ['server.py', 'qa-test.js', 'smoke-test.js', 'modules-test.js',
    'assets-test.js', 'black-market-test.js', 'farm-test.js', 'tracker-evidence-test.js',
    'botones.html', 'iconos.html', 'js/README.md', 'node_modules']) {
    check(!fs.existsSync(path.join(root, dev)), `${dev} queda fuera`, `${dev} NO debería viajar en el artefacto`);
  }
}

console.log(`\n${oks.length} OK · ${errors.length} errores`);
if (errors.length) {
  console.error('\nRecursos rotos:\n' + errors.map(e => '  - ' + e).join('\n'));
  process.exit(1);
}
