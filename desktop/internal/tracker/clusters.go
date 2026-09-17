// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed cluster_kinds.json
var clusterKindsJSON []byte

// Índice id → tipo de contenido generado del cluster/world.xml oficial
// (ao-bin-dumps), el mismo dato que la app de referencia carga como
// world.json. Solo se usa para clasificar clusters FIJOS: las instancias
// traen su propio token ("@RANDOMDUNGEON@<guid>").
type clusterKind struct {
	Kind  string `json:"k"` // static, hellgate, hce, avalon, arena, island, hideout
	Tier  int    `json:"t"` // 0 = desconocido
	Level int    `json:"q"` // nivel Q1..Q6 de estáticas negras; 0 = sin nivel
}

var clusterKinds = func() map[string]clusterKind {
	var doc struct {
		Clusters map[string]clusterKind `json:"clusters"`
	}
	if err := json.Unmarshal(clusterKindsJSON, &doc); err != nil || doc.Clusters == nil {
		return map[string]clusterKind{}
	}
	return doc.Clusters
}()

func lookupClusterKind(id string) (clusterKind, bool) {
	kind, ok := clusterKinds[strings.TrimSpace(id)]
	return kind, ok
}

// Tokens de instancia del protocolo, tal como los documenta WorldData de la
// app de referencia (muestras reales de captura):
//
//	@ISLAND@c640e642-5135-4203-89b5-0007e4215605
//	@RANDOMDUNGEON@fe968505-9771-4653-8ade-29a1bd6ddb56
//	@HIDEOUT@2306@29c344b3-2138-421d-a97c-06e29d4759ec
//	@MISTS@9283d553-ab71-4c14-bb34-64567137419a
const (
	tokenHellCluster    = "HELLCLUSTER"
	tokenRandomDungeon  = "RANDOMDUNGEON"
	tokenCorrupted      = "CORRUPTEDDUNGEON"
	tokenIsland         = "ISLAND"
	tokenHideout        = "HIDEOUT"
	tokenExpedition     = "EXPEDITION"
	tokenArena          = "ARENA"
	tokenMistsDungeon   = "MISTSDUNGEON"
	tokenMists          = "MISTS"
	tokenHellDungeon    = "HELLDUNGEON"
	tokenDragonArea     = "DRAGONAREA"
	staticDungeonPrefix = "DNG-MISTS-"
)

func isRandomDungeonToken(cluster string) bool {
	return strings.Contains(strings.ToUpper(cluster), tokenRandomDungeon)
}

// dungeonKindForZone clasifica una zona y devuelve el tipo de la pestaña
// Mazmorras ("" = no es mazmorra). Los TOKENS solo clasifican instancias
// ("@TOKEN@guid", con guid): IsDungeonCluster de la app de referencia exige
// un guid, y un cluster fijo cuyo id contenga "MISTS" (DNG-MISTS-*) no debe
// caer en el caso de las Nieblas. Para instancias se sigue el orden exacto de
// WorldData.GetMapType (MISTSDUNGEON antes que MISTS); para clusters fijos el
// índice del mundo solo abre partida en estáticas DUNGEON_* (sin DNG-MISTS-*,
// como IsStaticDungeon). Islas, escondites, arenas, caminos avalonianos y el
// mundo abierto no abren partida.
func dungeonKindForZone(cluster, instance string) (string, clusterKind) {
	token := strings.ToUpper(strings.TrimSpace(cluster))
	if instance != "" {
		switch {
		case strings.Contains(token, tokenHellCluster):
			return "hellgate", clusterKind{}
		case strings.Contains(token, tokenRandomDungeon):
			// El modo (solo / estándar / avaloniana) no viaja en el token: se
			// refina con las salidas de mazmorra y la zona de origen.
			return "standard", clusterKind{}
		case strings.Contains(token, tokenCorrupted):
			return "corrupted", clusterKind{}
		case strings.Contains(token, tokenIsland), strings.Contains(token, tokenHideout):
			return "", clusterKind{}
		case strings.Contains(token, tokenExpedition):
			return "hce", clusterKind{}
		case strings.Contains(token, tokenArena):
			return "", clusterKind{}
		case strings.Contains(token, tokenMistsDungeon):
			// La mazmorra de las Nieblas es la Abadía de Knightfall.
			return "knightfall", clusterKind{}
		case strings.Contains(token, tokenMists):
			return "mists", clusterKind{}
		case strings.Contains(token, tokenHellDungeon):
			// Abyssal Depths (el reino demoníaco de las hellgates).
			return "abyssal", clusterKind{}
		case strings.Contains(token, tokenDragonArea):
			return "ancient", clusterKind{}
		}
	}
	// Cluster fijo: solo las estáticas abren partida, con su tier y nivel.
	if kind, ok := lookupClusterKind(cluster); ok && kind.Kind == "static" && !strings.HasPrefix(token, staticDungeonPrefix) {
		return "static", kind
	}
	return "", clusterKind{}
}
