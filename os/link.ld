ENTRY(_start)
MEMORY { ram : ORIGIN = 0x80000000, LENGTH = 256K }
SECTIONS {
  .text : { *(.text*) } > ram
  .rodata : { *(.rodata*) } > ram
  .data : { *(.data*) } > ram
  .bss : { *(.bss*) *(COMMON) } > ram
}
