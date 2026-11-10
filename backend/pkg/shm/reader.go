package shm

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
)

type DB1Snapshot struct {
	TargetSpeed float32 `json:"Target_Speed"`
	LineEnable  bool    `json:"Line_Enable"`
	ErrorCode   int16   `json:"Error_Code"`
}

// ReadDB1 считывает сырые байты структуры DB1 из /dev/shm
func ReadDB1() (*DB1Snapshot, error) {
	shmPath := "/dev/shm/softplc_db1_shm"
	data, err := os.ReadFile(shmPath)
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать разделяемую память %s: %w", shmPath, err)
	}

	if len(data) < 7 {
		return nil, fmt.Errorf("размер SHM меньше ожидаемой структуры (%d байт)", len(data))
	}

	// Структура DB1 (pragma pack 1):
	// [0..3] float32 target_speed
	// [4]    bool    line_enable
	// [5..6] int16   error_code
	bits := binary.LittleEndian.Uint32(data[0:4])
	speed := math.Float32frombits(bits)
	enable := data[4] != 0
	errCode := int16(binary.LittleEndian.Uint16(data[5:7]))

	return &DB1Snapshot{
		TargetSpeed: speed,
		LineEnable:  enable,
		ErrorCode:   errCode,
	}, nil
}
