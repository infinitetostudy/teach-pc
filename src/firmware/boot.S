# 引导 ROM。检查内存可写，把磁盘程序抄到装入地址，再跳过去。
    lui t0, 0x40000
    lw t1, 0(t0)
    lui t2, %hi(0x54454348)
    addi t2, t2, %lo(0x54454348)
    bne t1, t2, bad
    lw t3, 8(t0)
    lui t4, 0x10003
    lw t4, 0(t4)
    bltu t4, t3, badmem
    beq t3, zero, bad
    lw a0, 4(t0)
    lui a1, 0x12345
    sw a1, 0(a0)
    lw a2, 0(a0)
    bne a1, a2, badmem
    addi a1, t0, 16
    mv a3, t3
copy:
    beq a3, zero, go
    lw a4, 0(a1)
    sw a4, 0(a0)
    addi a1, a1, 4
    addi a0, a0, 4
    addi a3, a3, -4
    jal zero, copy
go:
    lw a0, 4(t0)
    jalr zero, a0, 0
badmem:
    addi a0, zero, 1
    lui a5, 0x10001
    addi a1, zero, 77
    sw a1, 0(a5)
    addi a1, zero, 69
    sw a1, 0(a5)
    addi a1, zero, 77
    sw a1, 0(a5)
    ebreak
bad:
    addi a0, zero, 2
    ebreak
