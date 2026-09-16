//go:build windows

// Package capture envuelve Npcap (wpcap.dll) para leer el tráfico del juego.
//
// Se llama a la DLL por syscall en vez de usar gopacket/pcap por dos razones:
// el build no depende de módulos externos (la toolchain fija del workflow compila
// sin red), y no hace falta cgo ni un toolchain de C para producir el .exe
// desde Linux, que es como se compila hoy.
package capture

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	errbufSize   = 256
	pcapOpenLive = 1

	// Modo promiscuo apagado: alcanza con el tráfico de esta máquina y así
	// no se captura nada de otros equipos de la red.
	promiscOff = 0
	snapLen    = 65536
	readTimeMs = 100
)

var (
	loadOnce sync.Once
	dll      *syscall.DLL

	procFindAllDevs *syscall.Proc
	procFreeAllDevs *syscall.Proc
	procOpenLive    *syscall.Proc
	procClose       *syscall.Proc
	procNextEx      *syscall.Proc
	procCompile     *syscall.Proc
	procSetFilter   *syscall.Proc
	procFreeCode    *syscall.Proc
	procLibVersion  *syscall.Proc
	procDataLink    *syscall.Proc

	loadErr error
)

// pcap_if_t
type pcapIf struct {
	Next        *pcapIf
	Name        *byte
	Description *byte
	Addresses   uintptr
	Flags       uint32
}

// pcap_pkthdr
type pcapPktHdr struct {
	TsSec  int32
	TsUsec int32
	CapLen uint32
	Len    uint32
}

// bpf_program
type bpfProgram struct {
	Len   uint32
	Insns uintptr
}

func load() error {
	loadOnce.Do(func() {
		// Npcap se instala en System32\Npcap. LoadLibrary lo encuentra si el
		// instalador puso el modo compatible con WinPcap; si no, hay que
		// buscarlo ahí explícitamente.
		var err error
		dll, err = syscall.LoadDLL("wpcap.dll")
		if err != nil {
			dll, err = syscall.LoadDLL(`C:\Windows\System32\Npcap\wpcap.dll`)
		}
		if err != nil {
			loadErr = errors.New("no se encontró wpcap.dll — falta instalar Npcap")
			return
		}
		find := func(name string) *syscall.Proc {
			p, e := dll.FindProc(name)
			if e != nil && loadErr == nil {
				loadErr = fmt.Errorf("wpcap.dll no expone %s (¿versión muy vieja?)", name)
			}
			return p
		}
		procFindAllDevs = find("pcap_findalldevs")
		procFreeAllDevs = find("pcap_freealldevs")
		procOpenLive = find("pcap_open_live")
		procClose = find("pcap_close")
		procNextEx = find("pcap_next_ex")
		procCompile = find("pcap_compile")
		procSetFilter = find("pcap_setfilter")
		procFreeCode = find("pcap_freecode")
		procLibVersion = find("pcap_lib_version")
		procDataLink = find("pcap_datalink")
	})
	return loadErr
}

func goStr(p *byte) string {
	if p == nil {
		return ""
	}
	var out []byte
	for i := 0; ; i++ {
		c := *(*byte)(unsafe.Pointer(uintptr(unsafe.Pointer(p)) + uintptr(i)))
		if c == 0 {
			break
		}
		out = append(out, c)
	}
	return string(out)
}

// Available informa si Npcap está instalado y utilizable.
func Available() (bool, string) {
	if err := load(); err != nil {
		return false, err.Error()
	}
	return true, ""
}

// Version devuelve la versión de la librería de captura.
func Version() string {
	if load() != nil {
		return ""
	}
	r, _, _ := procLibVersion.Call()
	return goStr((*byte)(unsafe.Pointer(r)))
}

// Device es una interfaz de red disponible para capturar.
type Device struct {
	Name        string
	Description string
	Up          bool
	Loopback    bool
}

// Devices lista las interfaces que Npcap puede abrir.
func Devices() ([]Device, error) {
	if err := load(); err != nil {
		return nil, err
	}
	var head *pcapIf
	errbuf := make([]byte, errbufSize)
	ret, _, _ := procFindAllDevs.Call(
		uintptr(unsafe.Pointer(&head)),
		uintptr(unsafe.Pointer(&errbuf[0])),
	)
	if int32(ret) != 0 {
		return nil, fmt.Errorf("pcap_findalldevs: %s", goStr(&errbuf[0]))
	}
	defer procFreeAllDevs.Call(uintptr(unsafe.Pointer(head)))

	var out []Device
	for d := head; d != nil; d = d.Next {
		// libpcap flags: LOOPBACK=0x1, UP=0x2. Older WinPcap builds may
		// report zero; treat those as up for backward compatibility.
		out = append(out, Device{
			Name: goStr(d.Name), Description: goStr(d.Description),
			Loopback: d.Flags&0x1 != 0,
			Up:       d.Flags&0x2 != 0 || d.Flags == 0,
		})
	}
	if len(out) == 0 {
		return nil, errors.New("no hay interfaces de red disponibles (¿falta ejecutar como administrador?)")
	}
	return out, nil
}

// Handle es una captura abierta sobre una interfaz.
type Handle struct {
	ptr      uintptr
	linkType int32
}

// Open abre la interfaz y le aplica el filtro BPF indicado.
func Open(device, filter string) (*Handle, error) {
	if err := load(); err != nil {
		return nil, err
	}
	name, err := syscall.BytePtrFromString(device)
	if err != nil {
		return nil, err
	}
	errbuf := make([]byte, errbufSize)
	ptr, _, _ := procOpenLive.Call(
		uintptr(unsafe.Pointer(name)),
		uintptr(snapLen),
		uintptr(promiscOff),
		uintptr(readTimeMs),
		uintptr(unsafe.Pointer(&errbuf[0])),
	)
	if ptr == 0 {
		msg := goStr(&errbuf[0])
		if strings.Contains(strings.ToLower(msg), "denied") {
			msg += " — hay que ejecutar la app como administrador"
		}
		return nil, fmt.Errorf("no se pudo abrir %s: %s", device, msg)
	}
	h := &Handle{ptr: ptr}

	link, _, _ := procDataLink.Call(ptr)
	h.linkType = int32(link)

	if filter != "" {
		if err := h.setFilter(filter); err != nil {
			h.Close()
			return nil, err
		}
	}
	return h, nil
}

func (h *Handle) setFilter(filter string) error {
	expr, err := syscall.BytePtrFromString(filter)
	if err != nil {
		return err
	}
	var prog bpfProgram
	ret, _, _ := procCompile.Call(
		h.ptr,
		uintptr(unsafe.Pointer(&prog)),
		uintptr(unsafe.Pointer(expr)),
		1, // optimizar
		0xffffffff,
	)
	if int32(ret) != 0 {
		return fmt.Errorf("filtro BPF inválido: %s", filter)
	}
	defer procFreeCode.Call(uintptr(unsafe.Pointer(&prog)))

	ret, _, _ = procSetFilter.Call(h.ptr, uintptr(unsafe.Pointer(&prog)))
	if int32(ret) != 0 {
		return errors.New("no se pudo aplicar el filtro de captura")
	}
	return nil
}

// LinkType devuelve el tipo de enlace (1 = Ethernet).
func (h *Handle) LinkType() int32 { return h.linkType }

// Next devuelve el próximo paquete. `ok` en false con err nil significa que
// venció el timeout de lectura: no hay error, simplemente no llegó nada.
//
// El slice devuelto apunta al búfer interno de Npcap y deja de ser válido en
// la próxima llamada: hay que copiar lo que se quiera conservar.
func (h *Handle) Next() (data []byte, ok bool, err error) {
	var hdr *pcapPktHdr
	var pkt *byte
	ret, _, _ := procNextEx.Call(
		h.ptr,
		uintptr(unsafe.Pointer(&hdr)),
		uintptr(unsafe.Pointer(&pkt)),
	)
	switch int32(ret) {
	case 1:
		if hdr == nil || pkt == nil {
			return nil, false, nil
		}
		n := int(hdr.CapLen)
		if n <= 0 || n > snapLen {
			return nil, false, nil
		}
		return unsafe.Slice(pkt, n), true, nil
	case 0:
		return nil, false, nil // timeout
	case -2:
		return nil, false, errors.New("fin de la captura")
	default:
		return nil, false, errors.New("error leyendo de la interfaz de red")
	}
}

// Close cierra la captura.
func (h *Handle) Close() {
	if h.ptr != 0 {
		procClose.Call(h.ptr)
		h.ptr = 0
	}
}

// Backoff entre reintentos de apertura, para no martillar la interfaz.
const Backoff = 3 * time.Second
