import type * as THREE from 'three'

export type SyncContext = Pick<WebGL2RenderingContext, 'fenceSync' | 'getSyncParameter' | 'deleteSync' | 'flush' | 'SYNC_GPU_COMMANDS_COMPLETE' | 'SYNC_STATUS' | 'SIGNALED'>

export interface UploadPacing {
  batchBytes: number
  idleMs: number
}

export interface UploadPacer {
  drew(): void
  sent(bytes: number): void
  busy(): boolean
  reset(): void
}

export function textureBytes(texture: THREE.Texture): number {
  if (texture.source.dataReady === false) return 0
  let bytes = 0
  for (const level of texture.mipmaps as unknown[]) {
    const data = (level as { data?: unknown } | null)?.data
    if (ArrayBuffer.isView(data)) bytes += data.byteLength
  }
  return bytes
}

export function createUploadPacer(context: () => SyncContext, pacing: UploadPacing, now: () => number = () => performance.now()): UploadPacer {
  let since = 0
  let fence: WebGLSync | null = null
  let drawnAt = Number.NEGATIVE_INFINITY
  return {
    drew() {
      drawnAt = now()
    },
    sent(bytes) {
      since += bytes
      if (since < pacing.batchBytes) return
      since = 0
      const gl = context()
      if (fence) gl.deleteSync(fence)
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      gl.flush()
    },
    busy() {
      if (!fence || now() - drawnAt >= pacing.idleMs) return false
      const gl = context()
      if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return true
      gl.deleteSync(fence)
      fence = null
      return false
    },
    reset() {
      since = 0
      fence = null
    },
  }
}
