import type { Assembly } from './catalog'

export type DiskKind = 'ok' | 'pixel' | 'key' | 'kernel' | 'page'

export type Preset = {
  id: string
  name: string
  detail: string
  slots: Assembly
  disk: DiskKind
}

const base: Assembly = {
  board: 'board-rv32',
  cpu: 'cpu-single',
  ram: 'ram-256',
  gpu: 'gpu-text',
  psu: 'psu-300',
  disk: 'disk-virt',
  monitor: 'mon-text',
  keyboard: 'kbd-matrix',
}

export const PRESETS: Preset[] = [
  {
    id: 'teach',
    name: '推荐教学机',
    detail: '能上电，引导 ROM 会把终端程序装进内存。',
    slots: base,
    disk: 'ok',
  },
  {
    id: 'power',
    name: '功率不足',
    detail: '150 W 电源带不动这块显卡，上电应停在电源。',
    slots: { ...base, ram: 'ram-1024', gpu: 'gpu-640', monitor: 'mon-640', psu: 'psu-150' },
    disk: 'ok',
  },
  {
    id: 'noram',
    name: '没有内存',
    detail: '内存槽是空的，自检应停在内存，不会取指。',
    slots: {
      board: 'board-rv32',
      cpu: 'cpu-single',
      gpu: 'gpu-text',
      psu: 'psu-300',
      disk: 'disk-virt',
      monitor: 'mon-text',
      keyboard: 'kbd-matrix',
    },
    disk: 'ok',
  },
  {
    id: 'ram',
    name: '内存过小',
    detail: '64 KiB 装不下内核镜像，引导程序会停住。',
    slots: { ...base, ram: 'ram-64' },
    disk: 'kernel',
  },
  {
    id: 'video',
    name: '分辨率过高',
    detail: '640×480 的显示器超过 320×240 的显卡。',
    slots: { ...base, gpu: 'gpu-320', monitor: 'mon-640' },
    disk: 'ok',
  },
  {
    id: 'wide',
    name: '更大的屏幕',
    detail: '同一颗内核，换成 1 MiB 内存和 640×480 显卡。',
    slots: { ...base, ram: 'ram-1024', gpu: 'gpu-640', monitor: 'mon-640', psu: 'psu-500' },
    disk: 'kernel',
  },
]
