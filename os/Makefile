CC ?= riscv32-unknown-elf-gcc
CFLAGS ?= -march=rv32i -mabi=ilp32 -nostdlib -ffreestanding -Os -Wall -T link.ld

kernel.elf: start.S kernel.c link.ld
	$(CC) $(CFLAGS) start.S kernel.c -o kernel.elf

clean:
	rm -f kernel.elf
