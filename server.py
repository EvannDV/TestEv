#!/usr/bin/env python3
"""JARVIS car HUD - serveur de donnees vehicule.

Lit la voiture (simulateur, OBD-II/ELM327 ou CAN brut + fichier DBC) et
diffuse l'etat en JSON sur WebSocket vers l'interface web.

  python3 server.py --source sim
  python3 server.py --source obd [--port /dev/rfcomm0]
  python3 server.py --source can --channel can0 --dbc ma_voiture.dbc --map can_map.json
"""
import argparse
import asyncio
import json
import math
import random
import threading
import time
from pathlib import Path

from aiohttp import web

WEB_DIR = Path(__file__).parent / "web"
FIELDS = ("speed", "rpm", "coolant", "fuel", "voltage", "throttle", "intake", "load", "gear")
STATE = {f: None for f in FIELDS}
STATE.update(source="?", ts=0.0)  # ts = derniere donnee recue de la voiture


def put(field, value):
    STATE[field] = value
    STATE["ts"] = time.time()


# --------------------------------------------------------------- simulateur
def run_sim(_args):
    ratios = [0, 125, 70, 46, 34, 27, 22]  # tr/min par km/h, par rapport
    speed, target, coolant, fuel, t_next = 0.0, 0.0, 20.0, 68.0, 0.0
    while True:
        now = time.time()
        if now > t_next:
            target = random.choice([0, 30, 50, 50, 80, 90, 110, 130])
            t_next = now + random.uniform(5, 12)
        accel = max(-9.0, min(5.0, (target - speed) * 0.6))
        speed = max(0.0, speed + accel * 0.05)
        gear = 0 if speed < 2 else min(6, 1 + int(speed // 22))
        rpm = 820 + random.uniform(-15, 15) if gear == 0 else max(900, speed * ratios[gear])
        throttle = max(0.0, min(100.0, accel * 18 + speed * 0.12))
        coolant = min(90 + 2 * math.sin(now / 20), coolant + 0.04)
        fuel = max(0.0, fuel - speed * 2e-6)
        for f, v in (("speed", round(speed, 1)), ("rpm", round(rpm)), ("gear", gear or "N"),
                     ("throttle", round(throttle)), ("coolant", round(coolant, 1)),
                     ("fuel", round(fuel, 1)), ("load", round(min(100, throttle * 0.8 + 15))),
                     ("intake", round(24 + 4 * math.sin(now / 40), 1)),
                     ("voltage", round(14.1 + 0.15 * math.sin(now / 3), 2))):
            put(f, v)
        time.sleep(0.05)


# ------------------------------------------------------------ OBD-II (ELM327)
def run_obd(args):
    import obd  # pip install obd

    c = obd.commands
    wanted = {"speed": c.SPEED, "rpm": c.RPM, "coolant": c.COOLANT_TEMP, "fuel": c.FUEL_LEVEL,
              "voltage": c.CONTROL_MODULE_VOLTAGE, "throttle": c.THROTTLE_POS,
              "intake": c.INTAKE_TEMP, "load": c.ENGINE_LOAD}
    while True:
        conn = obd.Async(args.port, fast=False)
        if not conn.is_connected():
            print("[obd] pas de connexion, nouvel essai dans 5 s")
            time.sleep(5)
            continue
        for field, cmd in wanted.items():
            if not conn.supports(cmd):
                print(f"[obd] {cmd.name} non supporte par ce vehicule")
                continue

            def cb(r, field=field):
                if not r.is_null():
                    put(field, round(float(r.value.magnitude), 1))

            conn.watch(cmd, callback=cb)
        conn.start()
        print("[obd] connecte")
        while conn.is_connected():
            time.sleep(1)
        conn.close()


# ------------------------------------------------------------ CAN brut + DBC
def run_can(args):
    import can  # pip install python-can cantools
    import cantools

    db = cantools.database.load_file(args.dbc)
    mapping = json.loads(Path(args.map).read_text())  # {"NomSignalDBC": "champ"}
    bad = [v for v in mapping.values() if v not in FIELDS]
    if bad:
        raise SystemExit(f"can_map: champs inconnus {bad}, attendus: {FIELDS}")
    known = {m.frame_id for m in db.messages}
    # Lecture seule : ce programme n'envoie JAMAIS de trame sur le bus.
    bus = can.interface.Bus(channel=args.channel, interface=args.interface)
    print(f"[can] ecoute sur {args.channel}")
    for msg in bus:
        if msg.arbitration_id not in known:
            continue
        try:
            decoded = db.decode_message(msg.arbitration_id, msg.data, decode_choices=False)
        except Exception:
            continue
        for sig, val in decoded.items():
            field = mapping.get(sig)
            if field:
                put(field, round(val, 1) if isinstance(val, float) else val)


SOURCES = {"sim": run_sim, "obd": run_obd, "can": run_can}


# ------------------------------------------------------------------ serveur
async def index(_req):
    return web.FileResponse(WEB_DIR / "index.html")


async def ws_handler(req):
    ws = web.WebSocketResponse(heartbeat=10)
    await ws.prepare(req)
    req.app["clients"].add(ws)
    try:
        async for _ in ws:
            pass
    finally:
        req.app["clients"].discard(ws)
    return ws


async def broadcaster(app):
    async def loop():
        while True:
            payload = json.dumps({**STATE, "age": round(time.time() - STATE["ts"], 1)})
            for ws in list(app["clients"]):
                try:
                    await ws.send_str(payload)
                except Exception:
                    app["clients"].discard(ws)
            await asyncio.sleep(1 / app["hz"])

    task = asyncio.create_task(loop())
    yield
    task.cancel()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", choices=SOURCES, default="sim")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--http-port", type=int, default=8080)
    p.add_argument("--hz", type=float, default=15, help="frequence d'envoi vers l'ecran")
    p.add_argument("--port", default=None, help="[obd] port serie ELM327 (auto si absent)")
    p.add_argument("--channel", default="can0", help="[can] interface")
    p.add_argument("--interface", default="socketcan", help="[can] type python-can")
    p.add_argument("--dbc", help="[can] fichier DBC du vehicule")
    p.add_argument("--map", default="can_map.json", help="[can] signal DBC -> champ")
    args = p.parse_args()
    if args.source == "can" and not args.dbc:
        p.error("--source can demande --dbc")

    STATE["source"] = args.source
    threading.Thread(target=SOURCES[args.source], args=(args,), daemon=True).start()

    app = web.Application()
    app["clients"], app["hz"] = set(), args.hz
    app.add_routes([web.get("/", index), web.get("/ws", ws_handler), web.static("/", WEB_DIR)])
    app.cleanup_ctx.append(broadcaster)
    print(f"JARVIS HUD -> http://localhost:{args.http_port}  (source: {args.source})")
    web.run_app(app, host=args.host, port=args.http_port, print=None)


if __name__ == "__main__":
    main()
