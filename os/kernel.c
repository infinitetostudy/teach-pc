/* 和 src/firmware/kernel.S 是同一条启动线。
 * 教学机网页直接汇编 kernel.S。本文件用 riscv32-unknown-elf-gcc 编，见 Makefile。
 * 链接地址是 0x80000000。
 */
typedef unsigned int uint32_t;

#define UART ((volatile uint32_t *)0x10001000)
#define TIMER ((volatile uint32_t *)0x10000000)
#define INFO ((volatile uint32_t *)0x10003000)
#define FB ((volatile uint32_t *)0x10010000)

extern char trap;
extern uint32_t ticks;
extern uint32_t current;
extern uint32_t tcb0[];
extern uint32_t tcb1[];
extern uint32_t kscratch[];

uint32_t ticks;
uint32_t current;
uint32_t sig0;
uint32_t sig1;
uint32_t tcb0[33];
uint32_t tcb1[33];
uint32_t kscratch[33];

static void ecall_print(const char *s) {
    register uint32_t a0 asm("a0") = (uint32_t)s;
    register uint32_t a7 asm("a7") = 1;
    asm volatile("ecall" : : "r"(a0), "r"(a7));
}

static void draw_row(uint32_t color, uint32_t shift) {
    uint32_t width = INFO[1];
    if (width == 0) return;
    uint32_t offset = shift == 0 ? 0 : (width << shift) << 2;
    volatile uint32_t *p = (volatile uint32_t *)(0x10010000 + offset);
    for (uint32_t i = 0; i < width; i++) p[i] = color;
}

static void user0(void) {
    for (;;) {
        sig0++;
        draw_row(0x00E23B2A, 0);
    }
}

static void user1(void) {
    for (;;) {
        sig1++;
        draw_row(0x002F6FED, 5);
    }
}

static void arm(uint32_t *tcb) {
    uint32_t now = TIMER[0];
    TIMER[2] = now + 200;
    asm volatile("csrw mscratch, %0" :: "r"(tcb));
    asm volatile("csrrs zero, mie, %0" :: "r"(128));
    asm volatile("csrrs zero, mstatus, %0" :: "r"(128));
    asm volatile("lw t0, 128(%0); csrw mepc, t0; mret" :: "r"(tcb));
}

void main(void) {
    asm volatile("csrw mtvec, %0" :: "r"(&trap));
    asm volatile("csrw mscratch, %0" :: "r"(kscratch));
    ecall_print("HI\n");
    tcb0[2] = 0x80007000;
    tcb0[32] = (uint32_t)user0;
    tcb1[2] = 0x80006000;
    tcb1[32] = (uint32_t)user1;
    current = 0;
    arm(tcb0);
}
