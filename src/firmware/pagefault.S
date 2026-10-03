# 最小 Sv32 页表。恒等映射内存和设备后，访问未映射地址，机器停在这一拍。
    li s0, 0x80004000
    li t0, 1024
    mv t1, s0
zloop:
    sw zero, 0(t1)
    addi t1, t1, 4
    addi t0, t0, -1
    bne t0, zero, zloop

    li t0, 0x040000CF
    sw t0, 256(s0)
    li t0, 0x200000CF
    li t1, 0x80004800
    sw t0, 0(t1)

    li t0, 0x80080004
    csrw satp, t0
    li t0, 0x90000000
    lw t1, 0(t0)
    ebreak
