import type { PerformanceGpuBenchmark } from "./performance.js";

interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GpuComputePipelineLike {
  getBindGroupLayout(index: number): unknown;
}

interface GpuCommandEncoderLike {
  beginComputePass(): {
    setPipeline(pipeline: GpuComputePipelineLike): void;
    setBindGroup(index: number, bindGroup: unknown): void;
    dispatchWorkgroups(count: number): void;
    end(): void;
  };
  copyBufferToBuffer(source: GpuBufferLike, sourceOffset: number, destination: GpuBufferLike, destinationOffset: number, size: number): void;
  finish(): unknown;
}

interface GpuDeviceLike {
  readonly queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView): void;
    submit(commands: readonly unknown[]): void;
    onSubmittedWorkDone(): Promise<void>;
  };
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: { layout: "auto"; compute: { module: unknown; entryPoint: string } }): GpuComputePipelineLike;
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createBindGroup(descriptor: { layout: unknown; entries: readonly { binding: number; resource: { buffer: GpuBufferLike } }[] }): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
  destroy(): void;
}

interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}

interface NavigatorWithGpu extends Navigator {
  gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> };
}

const ELEMENTS = 1_048_576;
const ITERATIONS = 32;
const WORKGROUP_SIZE = 256;
const STORAGE = 0x0080;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const MAP_READ = 0x0001;
const TRANSFER_REPETITIONS = 8;
const DISPATCHES_PER_SUBMISSION = 4;

function result(status: PerformanceGpuBenchmark["status"], reason: string | null): PerformanceGpuBenchmark {
  return {
    id: "gpu-f32-compute-v1",
    measuredAt: new Date().toISOString(),
    status,
    initializationMs: null,
    durationMs: null,
    elementsPerDispatch: ELEMENTS,
    iterationsPerElement: ITERATIONS,
    dispatches: 0,
    iterationsPerSecond: null,
    uploadMebibytesPerSecond: null,
    readbackMebibytesPerSecond: null,
    verified: false,
    reason
  };
}

export async function runGpuBenchmark(durationMs = 1_000): Promise<PerformanceGpuBenchmark> {
  const gpu = (navigator as NavigatorWithGpu).gpu;
  if (gpu === undefined) return result("unavailable", "浏览器未提供 WebGPU");

  let device: GpuDeviceLike | null = null;
  let dataBuffer: GpuBufferLike | null = null;
  let readBuffer: GpuBufferLike | null = null;
  try {
    const initializationStartedAt = performance.now();
    const adapter = await gpu.requestAdapter();
    if (adapter === null) return result("unavailable", "未取得 WebGPU 适配器");
    device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: `
      @group(0) @binding(0) var<storage, read_write> values: array<f32>;

      @compute @workgroup_size(${WORKGROUP_SIZE})
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let index = id.x;
        if (index >= arrayLength(&values)) { return; }
        var value = values[index];
        for (var round = 0u; round < ${ITERATIONS}u; round++) {
          value = fract(value * 1.000001 + f32(round + 1u) * 0.0000001);
        }
        values[index] = value;
      }
    ` });
    const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const byteLength = ELEMENTS * Float32Array.BYTES_PER_ELEMENT;
    dataBuffer = device.createBuffer({ size: byteLength, usage: STORAGE | COPY_SRC | COPY_DST });
    readBuffer = device.createBuffer({ size: byteLength, usage: MAP_READ | COPY_DST });
    const input = new Float32Array(ELEMENTS);
    for (let index = 0; index < input.length; index += 1) input[index] = (index % 997) / 997;
    const uploadStartedAt = performance.now();
    for (let repeat = 0; repeat < TRANSFER_REPETITIONS; repeat += 1) device.queue.writeBuffer(dataBuffer, 0, input);
    await device.queue.onSubmittedWorkDone();
    const uploadMs = performance.now() - uploadStartedAt;
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: dataBuffer } }]
    });
    const warmupEncoder = device.createCommandEncoder();
    const warmupPass = warmupEncoder.beginComputePass();
    warmupPass.setPipeline(pipeline);
    warmupPass.setBindGroup(0, bindGroup);
    warmupPass.dispatchWorkgroups(ELEMENTS / WORKGROUP_SIZE);
    warmupPass.end();
    device.queue.submit([warmupEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const initializationMs = performance.now() - initializationStartedAt;

    const startedAt = performance.now();
    let dispatches = 0;
    while (performance.now() - startedAt < Math.max(500, Math.min(2_000, durationMs))) {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      for (let batch = 0; batch < DISPATCHES_PER_SUBMISSION; batch += 1) {
        pass.dispatchWorkgroups(ELEMENTS / WORKGROUP_SIZE);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      dispatches += DISPATCHES_PER_SUBMISSION;
    }
    const elapsedMs = performance.now() - startedAt;

    const readEncoder = device.createCommandEncoder();
    const readbackStartedAt = performance.now();
    for (let repeat = 0; repeat < TRANSFER_REPETITIONS; repeat += 1) {
      readEncoder.copyBufferToBuffer(dataBuffer, 0, readBuffer, 0, byteLength);
    }
    device.queue.submit([readEncoder.finish()]);
    await readBuffer.mapAsync(MAP_READ);
    const readbackMs = performance.now() - readbackStartedAt;
    const sample = new Float32Array(readBuffer.getMappedRange())[0];
    const verified = sample !== undefined && Number.isFinite(sample) && sample >= 0 && sample < 1;
    readBuffer.unmap();

    return {
      id: "gpu-f32-compute-v1",
      measuredAt: new Date().toISOString(),
      status: verified ? "completed" : "failed",
      initializationMs,
      durationMs: elapsedMs,
      elementsPerDispatch: ELEMENTS,
      iterationsPerElement: ITERATIONS,
      dispatches,
      iterationsPerSecond: verified ? Math.round(ELEMENTS * ITERATIONS * dispatches / (elapsedMs / 1_000)) : null,
      uploadMebibytesPerSecond: uploadMs > 0 ? Math.round(byteLength * TRANSFER_REPETITIONS / 1024 / 1024 / (uploadMs / 1_000)) : null,
      readbackMebibytesPerSecond: readbackMs > 0 ? Math.round(byteLength * TRANSFER_REPETITIONS / 1024 / 1024 / (readbackMs / 1_000)) : null,
      verified,
      reason: verified ? null : "GPU 输出校验失败"
    };
  } catch (error) {
    return result("failed", error instanceof Error ? error.message.slice(0, 160) : "WebGPU 基准运行失败");
  } finally {
    readBuffer?.destroy();
    dataBuffer?.destroy();
    device?.destroy();
  }
}
