.section .text
.globl _start
_start:
    la sp, stack_top
    call main
1:
    j 1b

# 陷入和线程切换必须用汇编：要保存的是寄存器本身。
.globl trap
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
    j restore

on_ecall:
    lw t0, 68(a0)
    li t1, 1
    bne t0, t1, ecall_done
    lw t2, 40(a0)
1:
    lbu t3, 0(t2)
    beqz t3, ecall_done
    li t4, 0x10001000
    sw t3, 0(t4)
    addi t2, t2, 1
    j 1b
ecall_done:
    lw t0, 128(a0)
    addi t0, t0, 4
    sw t0, 128(a0)
    j restore

on_timer:
    la t0, ticks
    lw t1, 0(t0)
    addi t1, t1, 1
    sw t1, 0(t0)
    la t0, current
    lw t1, 0(t0)
    beqz t1, 2f
    sw zero, 0(t0)
    la a0, tcb0
    j 3f
2:
    li t1, 1
    sw t1, 0(t0)
    la a0, tcb1
3:
    li t0, 0x10000000
    lw t1, 0(t0)
    addi t1, t1, 200
    sw t1, 8(t0)
    csrw mscratch, a0

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

.section .bss
.align 4
stack:
    .space 4096
stack_top:
