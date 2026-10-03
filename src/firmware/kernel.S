# 教学机内核。启动、系统调用、定时器抢占、两个线程切换。
# 浏览器里的汇编器直接汇编这份文件。os/kernel.c 是同一条线的 C 写法。

.equ TICKS, 0x80008000
.equ CUR,   0x80008004
.equ SIG0,  0x80008008
.equ SIG1,  0x8000800C
.equ TCB0,  0x80008100
.equ TCB1,  0x80008200
.equ KSCR,  0x80008300
.equ UART,  0x10001000
.equ TIMER, 0x10000000
.equ INFO,  0x10003000
.equ FB,    0x10010000

    li sp, 0x80009000
    li t0, KSCR
    csrw mscratch, t0
    li t0, trap
    csrw mtvec, t0
    li a0, msg
    li a7, 1
    ecall

    li t0, TCB0
    li t1, user0
    sw t1, 128(t0)
    li t1, 0x80007000
    sw t1, 8(t0)
    li t0, TCB1
    li t1, user1
    sw t1, 128(t0)
    li t1, 0x80006000
    sw t1, 8(t0)

    li t0, CUR
    sw zero, 0(t0)
    li t0, TICKS
    sw zero, 0(t0)
    li t0, TCB0
    csrw mscratch, t0

    li t0, TIMER
    lw t1, 0(t0)
    addi t1, t1, 200
    sw t1, 8(t0)
    li t0, 128
    csrrs zero, mie, t0
    li t0, 128
    csrrs zero, mstatus, t0
    li a0, TCB0
    jal zero, restore

trap:
    csrrw a0, mscratch, a0
    sw ra, 4(a0)
    sw sp, 8(a0)
    sw gp, 12(a0)
    sw tp, 16(a0)
    sw t0, 20(a0)
    sw t1, 24(a0)
    sw t2, 28(a0)
    sw s0, 32(a0)
    sw s1, 36(a0)
    sw a1, 44(a0)
    sw a2, 48(a0)
    sw a3, 52(a0)
    sw a4, 56(a0)
    sw a5, 60(a0)
    sw a6, 64(a0)
    sw a7, 68(a0)
    sw s2, 72(a0)
    sw s3, 76(a0)
    sw s4, 80(a0)
    sw s5, 84(a0)
    sw s6, 88(a0)
    sw s7, 92(a0)
    sw s8, 96(a0)
    sw s9, 100(a0)
    sw s10, 104(a0)
    sw s11, 108(a0)
    sw t3, 112(a0)
    sw t4, 116(a0)
    sw t5, 120(a0)
    sw t6, 124(a0)
    csrr t0, mscratch
    sw t0, 40(a0)
    csrw mscratch, a0
    csrr t0, mepc
    sw t0, 128(a0)
    csrr t0, mcause
    li t1, 0x80000007
    beq t0, t1, on_timer
    li t1, 8
    beq t0, t1, on_ecall
    li t1, 11
    beq t0, t1, on_ecall
    jal zero, restore

on_ecall:
    lw t0, 68(a0)
    li t1, 1
    bne t0, t1, ecall_done
    lw t2, 40(a0)
print:
    lbu t3, 0(t2)
    beq t3, zero, ecall_done
    li t4, UART
    sw t3, 0(t4)
    addi t2, t2, 1
    jal zero, print
ecall_done:
    lw t0, 128(a0)
    addi t0, t0, 4
    sw t0, 128(a0)
    jal zero, restore

on_timer:
    li t0, TICKS
    lw t1, 0(t0)
    addi t1, t1, 1
    sw t1, 0(t0)
    li t0, CUR
    lw t1, 0(t0)
    beq t1, zero, to_thread1
    sw zero, 0(t0)
    li a0, TCB0
    jal zero, arm
to_thread1:
    li t1, 1
    sw t1, 0(t0)
    li a0, TCB1
arm:
    li t0, TIMER
    lw t1, 0(t0)
    addi t1, t1, 200
    sw t1, 8(t0)
    csrw mscratch, a0
    jal zero, restore

restore:
    lw t0, 128(a0)
    csrw mepc, t0
    lw ra, 4(a0)
    lw sp, 8(a0)
    lw gp, 12(a0)
    lw tp, 16(a0)
    lw t0, 20(a0)
    lw t1, 24(a0)
    lw t2, 28(a0)
    lw s0, 32(a0)
    lw s1, 36(a0)
    lw a1, 44(a0)
    lw a2, 48(a0)
    lw a3, 52(a0)
    lw a4, 56(a0)
    lw a5, 60(a0)
    lw a6, 64(a0)
    lw a7, 68(a0)
    lw s2, 72(a0)
    lw s3, 76(a0)
    lw s4, 80(a0)
    lw s5, 84(a0)
    lw s6, 88(a0)
    lw s7, 92(a0)
    lw s8, 96(a0)
    lw s9, 100(a0)
    lw s10, 104(a0)
    lw s11, 108(a0)
    lw t3, 112(a0)
    lw t4, 116(a0)
    lw t5, 120(a0)
    lw t6, 124(a0)
    lw a0, 40(a0)
    mret

user0:
    li t0, SIG0
    lw t1, 0(t0)
    addi t1, t1, 1
    sw t1, 0(t0)
    li a0, 0x00E23B2A
    li a1, 0
    jal ra, draw_row
    jal zero, user0

user1:
    li t0, SIG1
    lw t1, 0(t0)
    addi t1, t1, 1
    sw t1, 0(t0)
    li a0, 0x002F6FED
    li a1, 5
    jal ra, draw_row
    jal zero, user1

draw_row:
    li t0, INFO
    lw t1, 4(t0)
    beq t1, zero, draw_ret
    beq a1, zero, row0
    sll t2, t1, a1
    slli t2, t2, 2
    jal zero, row_ok
row0:
    li t2, 0
row_ok:
    li t0, FB
    add t0, t0, t2
    mv t3, t1
dloop:
    beq t3, zero, draw_ret
    sw a0, 0(t0)
    addi t0, t0, 4
    addi t3, t3, -1
    jal zero, dloop
draw_ret:
    jalr zero, ra, 0

msg:
    .asciz "HI\n"
