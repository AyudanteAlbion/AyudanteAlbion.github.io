//go:build windows

package tracker

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const sioReceiveAll = 0x98000001 // SIO_RCVALL / RCVALL_ON

var (
	ws2          = syscall.NewLazyDLL("ws2_32.dll")
	procWSAIoctl = ws2.NewProc("WSAIoctl")
)

type localCaptureAddress struct {
	ip      net.IP
	zone    string
	family  int
	adapter string
}

func localCaptureAddresses() ([]localCaptureAddress, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	result := make([]localCaptureAddress, 0)
	seen := make(map[string]bool)
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, addressErr := iface.Addrs()
		if addressErr != nil {
			continue
		}
		for _, address := range addresses {
			ip, _, parseErr := net.ParseCIDR(address.String())
			if parseErr != nil || ip == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
				continue
			}
			family := 6
			if ip.To4() != nil {
				family = 4
				ip = ip.To4()
			}
			zone := ""
			if family == 6 && ip.IsLinkLocalUnicast() {
				zone = iface.Name
			}
			key := fmt.Sprintf("%d|%s|%s", family, ip.String(), zone)
			if seen[key] {
				continue
			}
			seen[key] = true
			result = append(result, localCaptureAddress{ip: append(net.IP(nil), ip...), zone: zone, family: family, adapter: iface.Name})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].adapter != result[j].adapter {
			return result[i].adapter < result[j].adapter
		}
		if result[i].family != result[j].family {
			return result[i].family < result[j].family
		}
		return result[i].ip.String() < result[j].ip.String()
	})
	return result, nil
}

func platformNetworkSignature() (string, error) {
	addresses, err := localCaptureAddresses()
	if err != nil {
		return "", err
	}
	parts := make([]string, 0, len(addresses))
	for _, address := range addresses {
		parts = append(parts, fmt.Sprintf("%s/%d/%s", address.ip, address.family, address.adapter))
	}
	return strings.Join(parts, "|"), nil
}

func enableReceiveAll(conn *net.IPConn) error {
	raw, err := conn.SyscallConn()
	if err != nil {
		return err
	}
	var ioctlErr error
	controlErr := raw.Control(func(handle uintptr) {
		if setErr := syscall.SetsockoptInt(syscall.Handle(handle), syscall.IPPROTO_IP, 2, 1); setErr != nil {
			ioctlErr = setErr
			return
		}
		in := uint32(1)
		var out uint32
		var returned uint32
		result, _, callErr := procWSAIoctl.Call(
			handle, uintptr(sioReceiveAll),
			uintptr(unsafe.Pointer(&in)), unsafe.Sizeof(in),
			uintptr(unsafe.Pointer(&out)), unsafe.Sizeof(out),
			uintptr(unsafe.Pointer(&returned)), 0, 0,
		)
		if int32(result) == -1 {
			if callErr != syscall.Errno(0) {
				ioctlErr = callErr
			} else {
				ioctlErr = fmt.Errorf("WSAIoctl(SIO_RCVALL) falló")
			}
		}
	})
	if controlErr != nil {
		return controlErr
	}
	return ioctlErr
}

func openPlatformRawCapture(ctx context.Context) (*platformRawCapture, error) {
	addresses, err := localCaptureAddresses()
	if err != nil {
		return nil, err
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("no hay direcciones locales activas")
	}

	packets := make(chan CapturedDatagram, 256)
	errorsCh := make(chan error, len(addresses))
	connections := make([]*net.IPConn, 0, len(addresses))
	openedAddresses := make([]localCaptureAddress, 0, len(addresses))
	var lastErr error
	for _, address := range addresses {
		network := "ip4:0"
		if address.family == 6 {
			network = "ip6:41"
		}
		conn, listenErr := net.ListenIP(network, &net.IPAddr{IP: address.ip, Zone: address.zone})
		if listenErr != nil {
			lastErr = listenErr
			continue
		}
		if address.family == 4 {
			if ioctlErr := enableReceiveAll(conn); ioctlErr != nil {
				_ = conn.Close()
				lastErr = ioctlErr
				continue
			}
		} else {
			// Mirror SAT's IPv6 raw-socket option. Failure is non-fatal because
			// Windows versions differ in which receive-header option they expose.
			if raw, rawErr := conn.SyscallConn(); rawErr == nil {
				_ = raw.Control(func(handle uintptr) { _ = syscall.SetsockoptInt(syscall.Handle(handle), syscall.IPPROTO_IPV6, 29, 1) })
			}
		}
		connections = append(connections, conn)
		openedAddresses = append(openedAddresses, address)
	}
	if len(connections) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("Windows no permitió abrir raw sockets")
		}
		return nil, fmt.Errorf("no se pudo activar SIO_RCVALL; ejecutá Ayudante Albion como administrador: %w", lastErr)
	}

	captureCtx, cancel := context.WithCancel(ctx)
	var closeOnce sync.Once
	closeAll := func() {
		closeOnce.Do(func() {
			cancel()
			for _, conn := range connections {
				_ = conn.Close()
			}
		})
	}
	var wg sync.WaitGroup
	for index, conn := range connections {
		address := openedAddresses[index]
		wg.Add(1)
		go func(conn *net.IPConn, local localCaptureAddress) {
			defer wg.Done()
			buffer := make([]byte, 65535)
			reassembler := newIPv4Reassembler()
			for captureCtx.Err() == nil {
				_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
				n, remote, readErr := conn.ReadFromIP(buffer)
				if readErr != nil {
					if networkErr, ok := readErr.(net.Error); ok && networkErr.Timeout() {
						continue
					}
					if captureCtx.Err() == nil {
						select {
						case errorsCh <- readErr:
						default:
						}
					}
					return
				}
				if n <= 0 {
					continue
				}
				data := buffer[:n]
				var datagram CapturedDatagram
				var valid bool
				if data[0]>>4 == 4 {
					datagram, valid = parseIPv4(data, "socket:"+local.adapter, reassembler)
				} else if data[0]>>4 == 6 {
					datagram, valid = parseIPv6(data, "socket:"+local.adapter)
				} else if local.family == 6 {
					source := net.IP(nil)
					if remote != nil {
						source = remote.IP
					}
					datagram, valid = parseUDP(data, "socket:"+local.adapter, source, local.ip)
				}
				if valid {
					select {
					case packets <- datagram:
					case <-captureCtx.Done():
						return
					}
				}
			}
		}(conn, address)
	}
	go func() { <-captureCtx.Done(); closeAll() }()
	go func() { wg.Wait(); close(packets); close(errorsCh) }()
	signature, _ := platformNetworkSignature()
	return &platformRawCapture{packets: packets, errors: errorsCh, count: len(connections), signature: signature, close: closeAll}, nil
}
