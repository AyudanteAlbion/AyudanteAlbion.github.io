package tracker

import (
	"os"
	"path/filepath"
	"testing"
)

// shippedCodes carga la tabla real que se distribuye con la aplicación. Es la
// que decide si el tracker reconoce o no lo que manda el juego, así que se
// prueba tal cual viaja, no una copia de laboratorio.
func shippedCodes(t *testing.T) *Codes {
	t.Helper()
	path := filepath.Join("..", "..", "..", "albion-app", "data", "photon_codes.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no se pudo leer %s: %v", path, err)
	}
	codes, err := parseCodes(raw, path)
	if err != nil {
		t.Fatalf("parseCodes(%s) error = %v", path, err)
	}
	return codes
}

// Los códigos son el ordinal de cada miembro en los enums EventCodes.cs y
// OperationCodes.cs de la app de referencia. Una tabla desfasada es
// exactamente el fallo que dejaba "Personaje no detectado": el tracker recibe
// los paquetes pero no reconoce ninguno.
func TestShippedCodesMatchReferenceOrdinals(t *testing.T) {
	codes := shippedCodes(t)

	events := map[int32]string{
		1:   "Leave",
		2:   "JoinFinished",
		6:   "HealthUpdate",
		7:   "HealthUpdates",
		29:  "NewCharacter",
		62:  "TakeSilver",
		81:  "UpdateMoney",
		82:  "UpdateFame",
		84:  "UpdateReSpecPoints",
		85:  "UpdateCurrency",
		123: "NewMob",
		233: "PartyPlayerJoined",
		235: "PartyPlayerLeft",
		232: "PartyDisbanded",
		238: "PartySilverGained",
		279: "OtherGrabbedLoot",
	}
	for code, want := range events {
		got, ok := codes.EventName(code)
		if !ok || got != want {
			t.Errorf("EventName(%d) = %q/%v, want %q", code, got, ok, want)
		}
	}

	operations := map[int32]string{
		2:  "Join",
		41: "ChangeCluster",
	}
	for code, want := range operations {
		got, ok := codes.OperationName(code)
		if !ok || got != want {
			t.Errorf("OperationName(%d) = %q/%v, want %q", code, got, ok, want)
		}
	}
}

// ChangeCluster solo existe como operación. Declararlo como evento fue el
// motivo por el que cambiar de zona no recargaba nada: EventName() jamás
// devolvía ese nombre y el case quedaba muerto.
func TestChangeClusterIsAnOperationNotAnEvent(t *testing.T) {
	codes := shippedCodes(t)

	for code := int32(0); code <= 65535; code++ {
		if name, ok := codes.EventName(code); ok && name == "ChangeCluster" {
			t.Fatalf("ChangeCluster está declarado como evento en el código %d; es una operación", code)
		}
	}
	if _, ok := codes.OperationName(41); !ok {
		t.Fatal("falta la operación ChangeCluster (41) en la tabla")
	}
}

// La identidad local sale del JoinResponse. Sin el índice de zona la app
// mostraba el personaje pero dejaba "Ubicación no detectada".
func TestShippedSelfOperationCarriesNameAndZone(t *testing.T) {
	codes := shippedCodes(t)

	if codes.SelfOp.Operation != "Join" {
		t.Fatalf("selfOperation.operation = %q, want Join", codes.SelfOp.Operation)
	}
	for field, want := range map[string]int{"id": 0, "name": 2, "zone": 8} {
		if got, ok := codes.SelfOp.Parameters[field]; !ok || got != want {
			t.Errorf("selfOperation.parameters[%q] = %d/%v, want %d", field, got, ok, want)
		}
	}
}

// El tracker resuelve la zona de ChangeCluster y de JoinFinished por tabla;
// si falta el índice, el cambio de mapa se pierde en silencio.
func TestShippedZoneParametersExist(t *testing.T) {
	codes := shippedCodes(t)

	for _, name := range []string{"JoinFinished", "ChangeCluster"} {
		if _, ok := codes.Param(name, "zone"); !ok {
			t.Errorf("falta el parámetro 'zone' de %s", name)
		}
	}
}
