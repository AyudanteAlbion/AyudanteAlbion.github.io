// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"fmt"
	"strings"
	"time"
)

// Seguimiento de mazmorras a partir de los cambios de zona.
//
// Albion no manda un evento "empezó una mazmorra": lo que llega es el cluster
// nuevo, ya sea como operación ChangeCluster, como JoinResponse (parámetro 8)
// o como evento JoinFinished. Las instancias traen un token
// ("@RANDOMDUNGEON@<guid>", "@MISTS@<guid>") y los mapas fijos un índice del
// mundo que se resuelve con cluster_kinds.json. Entrar a una de esas zonas
// abre una partida y salir a cualquier otra la cierra. La fama, la plata y
// los puntos de respec de la partida son la diferencia de los contadores de
// sesión entre el principio y el final, así que no hace falta un contador
// paralelo que se pueda desincronizar del medidor de la pestaña Sesión.
//
// El modelo copia a DungeonController de la app de referencia (SAT): los
// pasillos de una mazmorra aleatoria encadenan varias instancias con el mismo
// token RANDOMDUNGEON y continúan la MISMA partida; corruptas, hellgates,
// nieblas y estáticas abren una nueva por mapa.

// dungeonRun es la partida en curso. Solo existe mientras el personaje está
// dentro de la instancia.
type dungeonRun struct {
	Type     string // tipo de la pestaña Mazmorras: solo|standard|avalonian|…
	Cluster  string // token de instancia ("RANDOMDUNGEON") o índice del mundo
	Instance string // guid de la instancia (vacío en mapas fijos)
	Tier     int    // 0 = desconocido: la interfaz lo muestra como tal
	Level    int    // nivel Q1..Q6 de estáticas negras / nivel de mazmorra
	Start    time.Time
	Fame     int64
	Silver   int64
	Respec   int64
	Might           int64
	Favor           int64
	FactionPoints   int64
	FactionStanding int64
	PaidRespecSilver int64
	Deaths          int
	Chests   int
}

// beginDungeon abre una partida si la zona nueva es una mazmorra. Toma la foto
// de los contadores para poder calcular la diferencia al salir. prevZone es la
// zona de la que se viene: una mazmorra aleatoria entrada desde un Camino de
// Avalon es avaloniana, igual que en la app de referencia.
func (h *handlers) beginDungeon(prevZone, cluster, instance string) {
	kind, world := dungeonKindForZone(cluster, instance)
	if kind == "" {
		return
	}
	// Los pasillos encadenados de una aleatoria se atendieron antes, en
	// applyZoneChange: llegar acá significa que la partida anterior ya cerró.
	run := &dungeonRun{
		Type:     kind,
		Cluster:  cluster,
		Instance: instance,
		Tier:     world.Tier,
		Level:    world.Level,
		Start:    time.Now(),
	}
	snap := h.st.Snapshot()
	run.Fame = snap.Fame
	run.Silver = snap.Silver
	run.Respec = snap.Respec
	run.FactionPoints = snap.FactionPoints
	run.FactionStanding = snap.FactionStanding
	run.PaidRespecSilver = snap.PaidSilverForRespec
	if isRandomDungeonToken(cluster) {
		if prevCluster, _ := splitZone(prevZone); prevCluster != "" {
			if kind, _ := lookupClusterKind(prevCluster); kind.Kind == "avalon" {
				run.Type = "avalonian"
			}
		}
	}
	h.dungeon = run
}

// continueDungeon decide si el cambio de zona continúa la partida en curso.
// Solo las mazmorras aleatorias encadenan pasillos: pasar de una niebla a su
// mazmorra son DOS partidas, igual que en la app de referencia.
func (h *handlers) continueDungeon(cluster string) bool {
	return h.dungeon != nil && isRandomDungeonToken(cluster) && isRandomDungeonToken(h.dungeon.Cluster)
}

// refineDungeonRun ajusta tipo, tier y nivel de la partida con la información
// que traen las salidas de mazmorra aleatoria (evento NewRandomDungeonExit):
// el UniqueName ("T7_SOLO_…", "AVALON_…") es la única pista del modo, el token
// "@RANDOMDUNGEON@guid" no distingue solo de grupo. Es el mismo criterio que
// GetRandomDungeonModeFromExit / GetDungeonTierFromExit de la app de
// referencia: AVALON gana, después _SOLO, y un tier legible la marca
// estándar; sin marcas, el modo actual se conserva.
func (h *handlers) refineDungeonRun(dungeonType, uniqueName string, level int64, alreadyEntered bool) {
	run := h.dungeon
	if run == nil || !isRandomDungeonToken(run.Cluster) {
		return
	}
	value := strings.ToUpper(uniqueName)
	if value == "" {
		value = strings.ToUpper(dungeonType)
	}
	switch {
	case strings.Contains(value, "AVALON"):
		run.Type = "avalonian"
	case strings.Contains(value, "_SOLO"):
		run.Type = "solo"
	case dungeonTierFromExit(value) > 0:
		run.Type = "standard"
	}
	if tier := dungeonTierFromExit(uniqueName); tier > 0 {
		run.Tier = tier
	} else if tier := dungeonTierFromExit(dungeonType); tier > 0 {
		run.Tier = tier
	}
	// El nivel de una entrada solo es visible antes de entrar a esa mazmorra.
	if !alreadyEntered && level >= 0 && level <= 4 {
		run.Level = int(level)
	}
}

// dungeonTierFromExit lee el tier del PREFIJO "T4…" del nombre de la salida,
// como GetDungeonTierFromExit de la referencia (T1..T8).
func dungeonTierFromExit(value string) int {
	value = strings.ToUpper(strings.TrimSpace(value))
	if len(value) < 2 || value[0] != 'T' {
		return 0
	}
	digit := value[1]
	if digit < '1' || digit > '8' {
		return 0
	}
	return int(digit - '0')
}

// finishDungeon cierra la partida en curso y publica el resumen. Una partida
// sin nada acumulado y de duración despreciable no se registra: entrar y salir
// de la entrada no es una partida.
func (h *handlers) finishDungeon() {
	run := h.dungeon
	if run == nil {
		return
	}
	h.dungeon = nil

	snap := h.st.Snapshot()
	duration := int64(time.Since(run.Start).Seconds())
	fame := snap.Fame - run.Fame
	silver := snap.Silver - run.Silver
	respec := snap.Respec - run.Respec
	factionPoints := snap.FactionPoints - run.FactionPoints
	factionStanding := snap.FactionStanding - run.FactionStanding
	paidRespecSilver := snap.PaidSilverForRespec - run.PaidRespecSilver
	// Un reinicio de sesión en mitad de la mazmorra deja los contadores por
	// debajo del arranque: en ese caso la diferencia no significa nada.
	if fame < 0 {
		fame = 0
	}
	if silver < 0 {
		silver = 0
	}
	if respec < 0 { respec = 0 }
	if factionPoints < 0 { factionPoints = 0 }
	if factionStanding < 0 { factionStanding = 0 }
	if paidRespecSilver < 0 { paidRespecSilver = 0 }
	if duration < 15 && fame == 0 && silver == 0 && factionPoints == 0 && factionStanding == 0 {
		return
	}

	// La zona se reconstruye en el formato del protocolo: "@TOKEN@guid" para
	// instancias, índice a secas para mapas fijos.
	zone := run.Cluster
	if run.Instance != "" {
		zone = "@" + run.Cluster + "@" + run.Instance
	}

	h.hub.Publish(NewEvent("dungeonRun", map[string]any{
		"uid":         fmt.Sprintf("dng-%d", run.Start.UnixNano()),
		"ts":          time.Now().UnixMilli(),
		"startedAt":   run.Start.UnixMilli(),
		"type":        run.Type,
		"tier":        run.Tier,
		"level":       run.Level,
		"enchantment": 0,
		"map":         run.Cluster,
		"zone":        zone,
		"duration":    duration,
		"fame":        fame,
		"silver":      silver,
		"respec":      respec,
		"paidSilverForRespec": paidRespecSilver,
		"factionPoints": factionPoints,
		"factionStanding": factionStanding,
		"might":       run.Might,
		"favor":       run.Favor,
		"deaths":      run.Deaths,
		"chests":      run.Chests,
	}))
}
