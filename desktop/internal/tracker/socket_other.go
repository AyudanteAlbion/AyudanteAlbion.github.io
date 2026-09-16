//go:build !windows

package tracker

import (
	"context"
	"errors"
)

func openPlatformRawCapture(context.Context) (*platformRawCapture, error) {
	return nil, errors.New("los raw sockets SIO_RCVALL solo están disponibles en Windows")
}

func platformNetworkSignature() (string, error) { return "", nil }
