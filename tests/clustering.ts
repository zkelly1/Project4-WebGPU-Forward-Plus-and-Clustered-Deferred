import { mat4, vec3 } from 'wgpu-matrix';
import { initWebGPU, device, canvas } from '../src/renderer';
import { Camera } from '../src/stage/camera';
import { Lights } from '../src/stage/lights';
import { constants } from '../src/shaders/shaders';
import commonRaw from '../src/shaders/common.wgsl?raw';

type Point = [number, number, number];
const { clusterCountX: nx, clusterCountY: ny, clusterCountZ: nz, lightRadius } = constants;
const output = document.querySelector<HTMLPreElement>('#results')!;
const messages: string[] = [];

function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
}

function report(message: string) {
    messages.push(message);
    output.textContent = messages.join('\n');
}

// Use projection scales directly here, independently of the shader's inverse projection.
function bounds(index: number, camera: Camera) {
    const x = index % nx;
    const y = Math.floor(index / nx) % ny;
    const z = Math.floor(index / (nx * ny));
    const near = Camera.nearPlane * Math.pow(Camera.farPlane / Camera.nearPlane, z / nz);
    const far = Camera.nearPlane * Math.pow(Camera.farPlane / Camera.nearPlane, (z + 1) / nz);
    const xs = [2 * x / nx - 1, 2 * (x + 1) / nx - 1];
    const ys = [1 - 2 * y / ny, 1 - 2 * (y + 1) / ny];
    const vx = xs.flatMap(v => [v * near / camera.projMat[0], v * far / camera.projMat[0]]);
    const vy = ys.flatMap(v => [v * near / camera.projMat[5], v * far / camera.projMat[5]]);
    return { min: [Math.min(...vx), Math.min(...vy), -far], max: [Math.max(...vx), Math.max(...vy), -near] };
}

async function checkLists(camera: Camera, lights: Lights, positions: Point[], name: string, inspectCluster = -1) {
    const data = new Float32Array(positions.length * Lights.numFloatsPerLight);
    positions.forEach((pos, i) => data.set(pos, i * Lights.numFloatsPerLight));
    if (data.length) device.queue.writeBuffer(lights.lightSetStorageBuffer, 16, data);
    lights.numLights = positions.length;
    lights.updateLightSetUniformNumLights();
    camera.onFrame(0);

    const readback = device.createBuffer({
        size: lights.clusterSetStorageBuffer.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    const encoder = device.createCommandEncoder();
    lights.doLightClustering(encoder);
    encoder.copyBufferToBuffer(lights.clusterSetStorageBuffer, 0, readback, 0, readback.size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    try {
        const mapped = readback.getMappedRange();
        const floats = new Float32Array(mapped);
        const words = new Uint32Array(mapped);
        const stride = Lights.clusterStride / 4;
        const forward = vec3.normalize(camera.cameraFront);
        const right = vec3.normalize(vec3.cross(forward, [0, 1, 0]));
        const up = vec3.cross(right, forward);
        const viewPositions = positions.map((_, i) => {
            const delta = vec3.subtract(data.subarray(i * 8, i * 8 + 3), camera.cameraPos);
            return [vec3.dot(delta, right), vec3.dot(delta, up), -vec3.dot(delta, forward)];
        });
        for (let i = 0; i < Lights.numClusters; i++) {
            const box = bounds(i, camera);
            const base = i * stride;
            for (let axis = 0; axis < 3; axis++) {
                for (const [offset, expected] of [[axis, box.min[axis]], [4 + axis, box.max[axis]]]) {
                    assert(Math.abs(floats[base + offset] - expected) < 0.0005 * Math.max(1, Math.abs(expected)),
                        `${name}: bounds differ in cluster ${i}`);
                }
            }
            const count = words[base + 3];
            assert(count <= positions.length, `${name}: invalid count in cluster ${i}`);
            const actual = words.subarray(base + 8, base + 8 + count);
            let cursor = 0;
            for (let j = 0; j < viewPositions.length; j++) {
                const p = viewPositions[j];
                let distanceSquared = 0;
                for (let axis = 0; axis < 3; axis++) {
                    const distance = Math.max(box.min[axis] - p[axis], p[axis] - box.max[axis], 0);
                    distanceSquared += distance * distance;
                }
                const found = cursor < actual.length && actual[cursor] === j;
                // Only the last few floating-point bits may differ at a tangent.
                if (Math.abs(distanceSquared - lightRadius * lightRadius) > 0.0001) {
                    assert(found === (distanceSquared < lightRadius * lightRadius),
                        `${name}: cluster ${i}, light ${j}, distance squared ${distanceSquared}`);
                }
                if (found) cursor++;
            }
            assert(cursor === count, `${name}: duplicate, unordered, or invalid light index in cluster ${i}`);
        }
        report(`PASS ${name}: all ${Lights.numClusters} cluster bounds and light lists`);
        const base = inspectCluster * stride;
        return inspectCluster < 0 ? new Uint32Array() : words.slice(base + 8, base + 8 + words[base + 3]);
    } finally {
        readback.unmap();
        readback.destroy();
    }
}

async function checkLookup(camera: Camera) {
    const samples: number[] = [];
    const expected: number[] = [];
    for (let z = 0; z < nz; z++) {
        const depth = Camera.nearPlane * Math.pow(Camera.farPlane / Camera.nearPlane, (z + 0.5) / nz);
        for (const x of [0, 0.5, 7.99, 8.01, 15.5, 16]) {
            for (const y of [0, 0.5, 3.99, 4.01, 8.5, 9]) {
                samples.push(x / nx * canvas.width, y / ny * canvas.height, depth, 0);
                expected.push(Math.min(nx - 1, Math.floor(x)) + nx * (Math.min(ny - 1, Math.floor(y)) + ny * z));
            }
        }
    }
    for (const [depth, z] of [[0, 0], [Camera.nearPlane, 0], [Camera.farPlane, nz - 1], [2000, nz - 1]]) {
        samples.push(0, 0, depth, 0);
        expected.push(nx * ny * z);
    }
    const input = device.createBuffer({ size: samples.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const result = device.createBuffer({ size: expected.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: result.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    device.queue.writeBuffer(input, 0, new Float32Array(samples));
    const common = commonRaw.replace(/\$\{(\w+)\}/g, (_, name: keyof typeof constants) => String(constants[name]));
    const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({ code: common + `
                @group(0) @binding(0) var<uniform> camera: CameraUniforms;
                @group(0) @binding(1) var<storage, read> samples: array<vec4f>;
                @group(0) @binding(2) var<storage, read_write> result: array<u32>;
                @compute @workgroup_size(64)
                fn main(@builtin(global_invocation_id) id: vec3u) {
                    if (id.x < arrayLength(&samples)) {
                        result[id.x] = clusterAtPixel(samples[id.x].xy, samples[id.x].z, camera);
                    }
                }`
            })
        }
    });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: camera.uniformsBuffer } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: result } }
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(expected.length / 64));
    pass.end();
    encoder.copyBufferToBuffer(result, 0, readback, 0, result.size);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = new Uint32Array(readback.getMappedRange());
    expected.forEach((value, i) => assert(actual[i] === value, `pixel lookup ${i}: ${actual[i]} != ${value}`));
    readback.unmap();
    [input, result, readback].forEach(buffer => buffer.destroy());
    report(`PASS ${expected.length} pixel/depth lookups, including viewport and near/far edges`);
}

async function run() {
    await initWebGPU();
    canvas.width = 1280;
    canvas.height = 720;
    device.addEventListener('uncapturederror', event => {
        output.dataset.status = 'failed';
        report(`GPU ERROR: ${event.error.message}`);
    });
    device.pushErrorScope('validation');
    const camera = new Camera();
    camera.cameraPos = vec3.create(0, 0, 0);
    camera.cameraFront = vec3.create(0, 0, -1);
    camera.projMat = mat4.perspective(Math.PI / 4, canvas.width / canvas.height, Camera.nearPlane, Camera.farPlane);
    const lights = new Lights(camera);
    await checkLists(camera, lights, [], 'empty input');
    await checkLists(camera, lights, [[0, 0, -3]], 'one light');

    const target = 8 + nx * (4 + ny * 12);
    const box = bounds(target, camera);
    const y = (box.min[1] + box.max[1]) / 2;
    const z = (box.min[2] + box.max[2]) / 2;
    const boundary: Point[] = [[-2, y, z], [-2.01, y, z], [-1.99, y, z],
        [0, 0, 1.8], [0, 0, 3], [0, 0, -1001], [0, 0, -1003]];
    const list = await checkLists(camera, lights, boundary, 'tangency, behind camera, near/far planes', target);
    assert(list.includes(0) && !list.includes(1) && list.includes(2), 'exact tangent should be included');
    report('PASS exact tangent, just outside, and just inside');

    const scattered: Point[] = Array.from({length: 5000}, (_, i) => [
        Math.sin(i * 13.7) * 30, Math.cos(i * 5.3) * 15, Math.sin(i * 1.7) * 40 - 20
    ]);
    await checkLists(camera, lights, scattered, '5,000 scattered lights');
    await checkLists(camera, lights, Array.from({length: 5000}, () => [0, 0, -3]), '5,000 overlapping lights');
    await checkLists(camera, lights, [], 'reset after full lists');
    await checkLookup(camera);

    camera.cameraPos = vec3.create(4, 2, -7);
    camera.cameraFront = vec3.normalize([-1, -0.2, 0.7]);
    await checkLists(camera, lights, scattered.slice(0, 500), 'translated and rotated camera');
    canvas.width = 720;
    canvas.height = 1280;
    camera.projMat = mat4.perspective(Math.PI / 4, canvas.width / canvas.height, Camera.nearPlane, Camera.farPlane);
    await checkLists(camera, lights, scattered.slice(0, 500), 'portrait projection');
    await checkLookup(camera);
    const error = await device.popErrorScope();
    assert(!error, error?.message ?? '');
    assert(output.dataset.status !== 'failed', 'uncaptured GPU error');
    output.dataset.status = 'passed';
    report('All clustering checks passed.');
}

run().catch(error => {
    output.dataset.status = 'failed';
    report(`FAIL ${error.message}`);
    console.error(error);
});
