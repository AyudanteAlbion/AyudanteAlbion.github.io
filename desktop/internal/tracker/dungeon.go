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
// Albion no manda un evento "empezó una mazmorra": lo que llega es un cambio
// de cluster cuyo identificador compuesto ("guid@RANDOMDUNGEON@SOLO") describe
// el tipo de instancia. Entrar a una de esas instancias abre una partida y
// salir a cualquier otra zona la cierra. La fama, la plata y los puntos de
// respec de la partida son la diferencia de los contadores de sesión entre el
// principio y el final, así que no hace falta un contador paralelo que se
// pueda desincronizar del medidor de la pestaña Sesión.

// dungeonRun es la partida en curso. Solo existe mientras el personaje está
// dentro de la instancia.
type dungeonRun struct {
	Type     string
	Map      string
	Instance string
	Start    time.Time
	Fame     int64
	Silver   int64
	Respec   int64
	Deaths   int
}

// dungeonKind traduce el tramo de instancia al tipo que muestra la pestaña
// Mazmorras. Devuelve "" cuando la zona no es una mazmorra: una ciudad, una
// zona abierta o un refugio no abren partida.
//
// Los nombres de la derecha son las claves que entiende el frontend
// (ui/js/tracker/dungeons.js). Cualquier instancia de mazmorra que no
// reconozcamos cae en "standard" en vez de perderse.
func dungeonKind(instance string) string {
	value := strings.ToUpper(strings.TrimSpace(instance))
	if value == "" {
		return ""
	}
	// El orden importa: las variantes más específicas van antes que las
	// genéricas, porque las cadenas se solapan (por ejemplo, un hellgate
	// corrupto contiene "HELL" y "CORRUPTED").
	switch {
	case strings.Contains(value, "HIDEOUT"), strings.Contains(value, "ISLAND"),
		strings.Contains(value, "GUILDISLAND"), strings.Contains(value, "SAFEAREA"):
		return "" // no son mazmorras
	case strings.Contains(value, "CORRUPTED"):
		return "corrupted"
	case strings.Contains(value, "HELL"):
		return "hellgate"
	case strings.Contains(value, "AVALON"):
		return "avalonian"
	case strings.Contains(value, "MIST"):
		return "mists"
	case strings.Contains(value, "EXPEDITION"), strings.Contains(value, "HCE"):
		return "hce"
	case strings.Contains(value, "KNIGHTFALL"):
		return "knightfall"
	case strings.Contains(value, "ABYSSAL"):
		return "abyssal"
	case strings.Contains(value, "ANCIENT"):
		return "ancient"
	case strings.Contains(value, "SOLO"):
		return "solo"
	case strings.Contains(value, "STATIC"):
		return "static"
	case strings.Contains(value, "DUNGEON"):
		return "standard"
	}
	return ""
}

// dungeonTier lee el tier del identificador de instancia cuando viene ("T6").
// Devuelve 0 si no aparece: la interfaz lo muestra como desconocido en vez de
// inventar un valor.
func dungeonTier(instance string) int {
	value := strings.ToUpper(instance)
	for i := 0; i+1 < len(value); i++ {
		if value[i] != 'T' {
			continue
		}
		digit := value[i+1]
		if digit < '1' || digit > '8' {
			continue
		}
		// "T6" tiene que ser un token propio, no el final de otra palabra.
		if i > 0 && (isAlphaNum(value[i-1])) {
			continue
		}
		return int(digit - '0')
	}
	return 0
}

func isAlphaNum(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

// beginDungeon abre una partida si la zona nueva es una mazmorra. Toma la foto
// de los contadores para poder calcular la diferencia al salir.
func (h *handlers) beginDungeon(cluster, instance string) {
	kind := dungeonKind(instance)
	if kind == "" {
		return
	}
	snap := h.st.Snapshot()
	h.dungeon = &dungeonRun{
		Type:     kind,
		Map:      cluster,
		Instance: instance,
		Start:    time.Now(),
		Fame:     snap.Fame,
		Silver:   snap.Silver,
		Respec:   snap.Respec,
	}
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
	// Un reinicio de sesión en mitad de la mazmorra deja los contadores por
	// debajo del arranque: en ese caso la diferencia no significa nada.
	if fame < 0 {
		fame = 0
	}
	if silver < 0 {
		silver = 0
	}
	if respec < 0 {
		respec = 0
	}
	if duration < 15 && fame == 0 && silver == 0 {
		return
	}

	h.hub.Publish(NewEvent("dungeonRun", map[string]any{
		"uid":         fmt.Sprintf("dng-%d", run.Start.UnixNano()),
		"ts":          time.Now().UnixMilli(),
		"type":        run.Type,
		"tier":        dungeonTier(run.Instance),
		"enchantment": 0,
		"map":         run.Map,
		"duration":    duration,
		"fame":        fame,
		"silver":      silver,
		"respec":      respec,
		"deaths":      run.Deaths,
	}))
}
