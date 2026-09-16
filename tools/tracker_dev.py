#!/usr/bin/env python3
"""Simulador del motor de tracking para desarrollo del frontend de escritorio.

Replica los endpoints que la app de escritorio expone en Go (`/api/tracker/*`),
para poder trabajar las pestañas Sesión, Recolección y Mazmorras sin Windows,
sin Npcap y sin el juego abierto. NO es parte de lo que se distribuye: el .exe
usa la implementación real en `desktop/internal/tracker/`.

Sirve `desktop/ui/` (las pestañas del tracker son exclusivas del escritorio;
la web ya no las tiene) y resuelve `data/`, `icons/` e `img/` desde
`albion-app/`, igual que hace `sync_frontend.sh` al armar el frontend embebido.

Mantener los dos lados en sintonía: si cambia el contrato JSON en Go, cambiarlo
acá también, porque es lo que se prueba a diario.

Uso:  python3 tools/tracker_dev.py [puerto]
"""
from __future__ import annotations

import http.server
import json
import os
import pathlib
import queue
import random
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
# Código propio del escritorio (las pestañas del tracker ya no están en la web).
ROOT = os.path.join(_HERE, '..', 'desktop', 'ui')
# Assets compartidos: data/, icons/ e img/ nunca se duplican en desktop/ui; se
# sirven desde la fuente única, igual que en el .exe embebido.
ASSETS = os.path.join(_HERE, '..', 'albion-app')

PARTY = ['SheniaLiam', 'GrailHealer', 'SpetsnazTank', 'MistRunner']
ZONES = ['Martlock', 'Mase Knoll', 'Blackthorn Quarry', 'Caerleon', 'Thetford']
ITEMS = ['T6_BAG', 'T5_MAIN_CURSEDSTAFF', 'T4_2H_BOW', 'T6_ARMOR_LEATHER_SET2']
ABILITIES = ['Bola de fuego', 'Tajo', 'Flecha perforante', 'Maldición']
RESOURCES = [
    ('T5_WOOD', 'Troncos de cedro', 'wood', 5, 620),
    ('T6_ORE', 'Mineral de titanio', 'ore', 6, 1180),
    ('T5_FIBER', 'Fibra celeste', 'fiber', 5, 710),
    ('T6_HIDE', 'Piel gruesa', 'hide', 6, 1320),
    ('T5_ROCK', 'Granito', 'stone', 5, 430),
    ('T6_FISH_FRESHWATER_ALL_COMMON', 'Pez de agua dulce', 'fishing', 6, 980),
]


class Hub:
    """Pub/sub mínimo, equivalente al Hub de Go."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: set[queue.Queue] = set()

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=256)
        with self._lock:
            self._subs.add(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            self._subs.discard(q)

    def publish(self, kind: str, payload) -> None:
        event = {'type': kind, 'ts': int(time.time() * 1000), 'payload': payload}
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass  # suscriptor lento: se descarta, nunca se bloquea

    def count(self) -> int:
        with self._lock:
            return len(self._subs)


class State:
    """Estado agregado de la sesión, espejo de tracker.State en Go."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset(full=True)

    def reset(self, full: bool = False) -> None:
        with self._lock:
            self.started = time.time()
            self.fame = self.silver = self.respec = 0
            self.players: dict[str, dict] = {}
            self.loot: list[dict] = []
            self.maps: list[dict] = []
            if full:
                self.capturing = False
                self.character = ''
                self.zone = ''
                self.party: list[str] = []
            for name in self.party:
                self._player(name)
            if self.character:
                self._player(self.character)['self'] = True

    def _player(self, name: str) -> dict:
        p = self.players.get(name)
        if p is None:
            p = {'name': name, 'damage': 0, 'healing': 0, 'overheal': 0,
                 'taken': 0, 'biggestHit': 0, 'deaths': 0, 'kills': 0, 'self': False}
            self.players[name] = p
        return p

    def set_identity(self, character: str, party: list[str]) -> None:
        with self._lock:
            self.character = character
            self.party = list(party)
            for name in party:
                self._player(name)
            self._player(character)['self'] = True

    def enter_zone(self, name: str) -> None:
        with self._lock:
            now = int(time.time() * 1000)
            if self.maps and not self.maps[-1]['leave']:
                self.maps[-1]['leave'] = now
                self.maps[-1]['seconds'] = (now - self.maps[-1]['enter']) // 1000
            self.zone = name
            self.maps.append({'name': name, 'enter': now, 'leave': 0, 'seconds': 0})
            del self.maps[:-200]

    def add_damage(self, source: str, target: str, amount: int) -> None:
        with self._lock:
            p = self._player(source)
            p['damage'] += amount
            p['biggestHit'] = max(p['biggestHit'], amount)
            # Solo jugadores conocidos acumulan daño recibido: si no, cada mob
            # golpeado se colaría como una fila del medidor.
            if target in self.players:
                self.players[target]['taken'] += amount

    def add_healing(self, source: str, effective: int, overheal: int) -> None:
        with self._lock:
            p = self._player(source)
            p['healing'] += effective
            p['overheal'] += overheal

    def add_loot(self, entry: dict) -> None:
        with self._lock:
            entry['ts'] = int(time.time() * 1000)
            self.loot.append(entry)
            del self.loot[:-500]

    def snapshot(self) -> dict:
        with self._lock:
            elapsed = max(1.0, time.time() - self.started)
            total_dmg = sum(p['damage'] for p in self.players.values())
            total_heal = sum(p['healing'] for p in self.players.values())
            rows = []
            for p in self.players.values():
                row = dict(p)
                row['dps'] = row['damage'] / elapsed
                row['hps'] = row['healing'] / elapsed
                row['shareDamage'] = (row['damage'] / total_dmg * 100) if total_dmg else 0
                row['shareHealing'] = (row['healing'] / total_heal * 100) if total_heal else 0
                rows.append(row)
            rows.sort(key=lambda r: (-r['damage'], -r['healing'], r['name']))

            now = int(time.time() * 1000)
            maps = []
            for m in reversed(self.maps):
                m = dict(m)
                if not m['leave']:
                    m['seconds'] = (now - m['enter']) // 1000
                maps.append(m)

            hours = elapsed / 3600
            return {
                'capturing': self.capturing,
                'simulated': True,
                'character': self.character,
                'zone': self.zone,
                'party': list(self.party),
                'startedAt': int(self.started * 1000),
                'seconds': int(elapsed),
                'fame': self.fame,
                'silver': self.silver,
                'respec': self.respec,
                'famePerHour': self.fame / hours,
                'silverPerHour': self.silver / hours,
                'combatants': rows,
                'maps': maps,
                'loot': list(reversed(self.loot)),
            }


HUB = Hub()
STATE = State()
_STOP = threading.Event()
DIAG_ON = False

CODES_PATH = pathlib.Path(ASSETS) / 'data' / 'photon_codes.json'
_CODES_CACHE: dict | None = None


def load_codes(force: bool = False):
    """Lee photon_codes.json aplicando las mismas reglas que el Go.

    Devuelve (info, advertencia). info es None si la tabla no se pudo usar.
    """
    global _CODES_CACHE
    if _CODES_CACHE is not None and not force:
        return _CODES_CACHE, ''
    try:
        data = json.loads(CODES_PATH.read_text(encoding='utf-8'))
    except Exception as exc:
        return None, f'no se pudo leer photon_codes.json: {exc}'

    events, ops = {}, {}
    for section, dst in (('events', events), ('operations', ops)):
        for name, value in (data.get(section) or {}).items():
            if name.startswith('_') or value is None:
                continue
            if not isinstance(value, int) or not 0 <= value <= 65535:
                return None, f"{section}: '{name}' tiene un código inválido"
            dst[value] = name
    if not events:
        return None, 'la tabla no define ningún evento'

    # Listas completas código->nombre, ordenadas por código: es lo que
    # necesita el diagnóstico avanzado para mostrar la tabla cargada, no solo
    # el conteo. Espejo de Codes.Events()/Codes.Operations() en Go.
    event_list = [{'code': code, 'name': name} for code, name in sorted(events.items())]
    op_list = [{'code': code, 'name': name} for code, name in sorted(ops.items())]

    info = {
        'version': data.get('version', ''),
        'gameVersion': data.get('gameVersion', ''),
        'events': len(events),
        'operations': len(ops),
        'loadedFrom': str(CODES_PATH),
        'loadedAt': int(time.time() * 1000),
        'eventList': event_list,
        'operationList': op_list,
    }
    _CODES_CACHE = info
    return info, ''


def diagnostic_payload():
    """Simula el conteo de códigos vistos, para poder probar la interfaz."""
    if not DIAG_ON:
        return {'enabled': False, 'known': [], 'unknown': []}
    try:
        data = json.loads(CODES_PATH.read_text(encoding='utf-8'))
    except Exception:
        data = {'events': {}}
    known = []
    for name, code in list((data.get('events') or {}).items()):
        if name.startswith('_') or code is None:
            continue
        if name in ('HealthUpdate', 'Move', 'NewCharacter', 'UpdateFame', 'CastStart'):
            known.append({'code': code, 'name': name, 'count': random.randint(20, 900)})
    unknown = [{'code': c, 'count': random.randint(1, 60)} for c in (137, 281, 402)]
    return {'enabled': True, 'known': known, 'unknown': unknown}


def simulate() -> None:
    """Genera una sesión verosímil mientras el tracking esté activo."""
    STATE.set_identity(PARTY[0], PARTY)
    STATE.enter_zone(ZONES[0])
    tick = 0
    while not _STOP.is_set():
        time.sleep(0.7)
        if not STATE.capturing:
            continue
        tick += 1
        actor = random.choice(PARTY)
        if actor == 'GrailHealer':
            eff, over = random.randint(150, 750), random.randint(0, 200)
            STATE.add_healing(actor, eff, over)
            HUB.publish('heal', {'source': actor, 'amount': eff, 'overheal': over})
        else:
            dmg = random.randint(200, 1600)
            STATE.add_damage(actor, 'Mob heretico', dmg)
            with STATE._lock:
                STATE.fame += random.randint(40, 200)
                STATE.silver += random.randint(90, 490)
            HUB.publish('damage', {'source': actor, 'target': 'Mob heretico',
                                   'amount': dmg, 'ability': random.choice(ABILITIES)})
        if tick % 13 == 0:
            STATE.add_loot({'player': random.choice(PARTY), 'itemId': random.choice(ITEMS),
                            'quantity': random.randint(1, 3), 'quality': random.randint(1, 3),
                            'source': 'mob'})
            rid, name, kind, tier, unit_value = random.choice(RESOURCES)
            quantity = random.randint(1, 8)
            HUB.publish('gathering', {
                'uid': f'dev-gat-{time.time_ns()}', 'ts': int(time.time() * 1000),
                'itemId': rid, 'name': name, 'type': kind, 'tier': tier,
                'quantity': quantity, 'value': quantity * unit_value,
                'map': random.choice(ZONES),
            })
            HUB.publish('dungeonRun', {
                'uid': f'dev-dng-{time.time_ns()}', 'ts': int(time.time() * 1000),
                'type': random.choice(['solo', 'standard', 'static', 'avalonian',
                                       'corrupted', 'hellgate', 'hce', 'mists',
                                       'knightfall', 'abyssal', 'ancient']),
                'tier': random.randint(4, 8), 'enchantment': random.randint(0, 4),
                'map': random.choice(ZONES), 'duration': random.randint(420, 2200),
                'fame': random.randint(12000, 190000), 'respec': random.randint(0, 18000),
                'might': random.randint(0, 6000), 'favor': random.randint(0, 2400),
                'silver': random.randint(5000, 95000),
                'lootValue': random.randint(15000, 515000),
                'deaths': random.randint(0, 2), 'chests': random.randint(1, 8),
            })
            if random.random() < 0.4:
                STATE.enter_zone(random.choice(ZONES))
        if tick % 2 == 0:
            HUB.publish('snapshot', STATE.snapshot())


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # Los assets compartidos no viven en desktop/ui: se sirven desde
    # albion-app/ (data/, icons/, img/), igual que en el frontend embebido
    # que arma sync_frontend.sh para el .exe.
    def translate_path(self, path):
        shared = ('data', 'icons', 'img')
        head = path.lstrip('/').split('/', 1)[0].split('?', 1)[0]
        base = self.directory
        self.directory = ASSETS if head in shared else base
        try:
            return super().translate_path(path)
        finally:
            self.directory = base

    def _json(self, body, code: int = 200) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path.startswith('/api/tracker/status'):
            body = {'edition': 'tracker', 'available': True, 'reason': '',
                    'source': 'simulador (dev)', 'capturing': STATE.capturing,
                    'listeners': HUB.count()}
            codes, warn = load_codes()
            if codes:
                body['codes'] = codes
            if warn:
                body['codesWarning'] = warn
            return self._json(body)
        if self.path.startswith('/api/tracker/diagnostic'):
            return self._json(diagnostic_payload())
        if self.path.startswith('/api/tracker/devices'):
            return self._json({'devices': [
                {'name': 'dev-ethernet', 'description': 'Ethernet (simulado)'},
                {'name': 'dev-wifi', 'description': 'Wi-Fi (simulado)'},
            ]})
        if self.path.startswith('/api/tracker/session'):
            return self._json(STATE.snapshot())
        if self.path.startswith('/api/tracker/stream'):
            return self.stream()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/tracker/restart'):
            STATE.capturing = True
            HUB.publish('status', STATE.snapshot())
            return self._json({'ok': True, 'capturing': True})
        if self.path.startswith('/api/tracker/character/refresh'):
            STATE.character = ''
            STATE.capturing = True
            snap = STATE.snapshot()
            HUB.publish('status', snap)
            return self._json({'ok': True, 'capturing': True, 'snapshot': snap})
        if self.path.startswith('/api/tracker/start'):
            STATE.capturing = True
            HUB.publish('status', STATE.snapshot())
            return self._json({'ok': True, 'capturing': True})
        if self.path.startswith('/api/tracker/stop'):
            STATE.capturing = False
            HUB.publish('status', STATE.snapshot())
            return self._json({'ok': True, 'capturing': False})
        if self.path.startswith('/api/tracker/codes/reload'):
            codes, warn = load_codes(force=True)
            if codes is None:
                return self._json({'ok': False, 'reason': warn}, 400)
            return self._json({'ok': True, 'codes': codes, 'warning': warn,
                               'restarted': STATE.capturing})
        if self.path.startswith('/api/tracker/diagnostic'):
            global DIAG_ON
            DIAG_ON = not self.path.endswith('on=0')
            return self._json(diagnostic_payload())
        if self.path.startswith('/api/tracker/reset'):
            STATE.reset()
            snap = STATE.snapshot()
            HUB.publish('snapshot', snap)
            return self._json(snap)
        return self.send_error(405)

    def stream(self) -> None:
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        q = HUB.subscribe()
        try:
            self.wfile.write(b'data: ' + json.dumps(
                {'type': 'snapshot', 'ts': int(time.time() * 1000),
                 'payload': STATE.snapshot()}).encode() + b'\n\n')
            self.wfile.flush()
            while not _STOP.is_set():
                try:
                    event = q.get(timeout=10)
                except queue.Empty:
                    self.wfile.write(b': keepalive\n\n')
                    self.wfile.flush()
                    continue
                self.wfile.write(b'data: ' + json.dumps(event).encode() + b'\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            HUB.unsubscribe(q)

    def end_headers(self):
        if self.path.startswith('/icons/'):
            self.send_header('Cache-Control', 'public, max-age=604800')
        super().end_headers()

    def log_message(self, *args):
        pass


def main() -> None:
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    threading.Thread(target=simulate, daemon=True).start()
    # Bind 0.0.0.0 solo porque es un entorno de desarrollo en contenedor;
    # el ejecutable real escucha únicamente en 127.0.0.1.
    http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()


if __name__ == '__main__':
    main()
