import Stats from 'stats.js';
import { mat4, vec3 } from 'wgpu-matrix';
import { initWebGPU, device, canvas, context, canvasFormat } from '../src/renderer';
import { Camera } from '../src/stage/camera';
import { Lights } from '../src/stage/lights';
import { Scene, setupLoaders } from '../src/stage/scene';
import { Stage } from '../src/stage/stage';
import { NaiveRenderer } from '../src/renderers/naive';
import { ClusteredDeferredRenderer } from '../src/renderers/clustered_deferred';

const output = document.querySelector<HTMLPreElement>('#results')!;
const messages: string[] = [];

function report(message: string) {
    messages.push(message);
    output.textContent = messages.join('\n');
}

async function capture(renderer: NaiveRenderer | ClusteredDeferredRenderer) {
    const bytesPerRow = Math.ceil(canvas.width * 4 / 256) * 256;
    const buffer = device.createBuffer({
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    renderer.draw();
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
        { texture: context.getCurrentTexture() },
        { buffer, bytesPerRow },
        [canvas.width, canvas.height]
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    for (let y = 0; y < canvas.height; y++) {
        pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + canvas.width * 4), y * canvas.width * 4);
    }
    buffer.unmap();
    buffer.destroy();
    return pixels;
}

async function compare(stage: Stage, name: string) {
    // Stop the animation loops so both draws use exactly the same buffers.
    const naive = new NaiveRenderer(stage);
    naive.stop();
    const forward = new ClusteredDeferredRenderer(stage);
    forward.stop();
    try {
        naive.useBundles = false;
        const baseline = await capture(naive);
        const clustered = await capture(forward);
        forward.useBundles = false;
        const direct = await capture(forward);
        if (direct.some((value, index) => value !== clustered[index])) {
            throw new Error(name + ': render bundles changed the image');
        }
        let maxDifference = 0;
        let differentPixels = 0;
        let litPixels = 0;
        for (let i = 0; i < baseline.length; i += 4) {
            let different = false;
            if (baseline[i] + baseline[i + 1] + baseline[i + 2] > 0) litPixels++;
            for (let channel = 0; channel < 4; channel++) {
                const difference = Math.abs(baseline[i + channel] - clustered[i + channel]);
                maxDifference = Math.max(maxDifference, difference);
                different ||= difference > 1;
            }
            if (different) differentPixels++;
        }
        if (differentPixels) throw new Error(`${name}: ${differentPixels} pixels differ by more than 1/255 (max ${maxDifference})`);
        if (stage.lights.numLights > 0 && litPixels === 0) throw new Error(`${name}: empty baseline image`);
        report(`PASS ${name}: max channel difference ${maxDifference}/255, ${litPixels} lit pixels`);
    } finally {
        naive.destroy();
        forward.destroy();
    }
}

async function run() {
    await initWebGPU();
    context.configure({ device, format: canvasFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    device.addEventListener('uncapturederror', event => {
        output.dataset.status = 'failed';
        report(`GPU ERROR: ${event.error.message}`);
    });
    device.pushErrorScope('validation');
    setupLoaders();
    const scene = new Scene();
    await scene.loadGltf('/scenes/sponza/Sponza.gltf');
    const camera = new Camera();
    const lights = new Lights(camera);
    // Fixed colors make repeated runs comparable; motion uses fixed times below.
    for (let i = 0; i < Lights.maxNumLights; i++) {
        lights.lightsArray.set([0.03 + (i % 7) * 0.01, 0.08, 0.04 + (i % 5) * 0.01], i * 8 + 4);
    }
    device.queue.writeBuffer(lights.lightSetStorageBuffer, 16, lights.lightsArray);
    const stage = new Stage(scene, lights, camera, new Stats());
    camera.onFrame(0);
    for (const count of [1, 500, 5000, 1, 0]) {
        lights.numLights = count;
        lights.updateLightSetUniformNumLights();
        lights.onFrame(2000);
        if (count === 1) {
            device.queue.writeBuffer(lights.lightSetStorageBuffer, 16, new Float32Array([-3, 1, 0]));
        }
        await compare(stage, `${count} lights at the initial view`);
    }

    lights.numLights = 500;
    lights.updateLightSetUniformNumLights();
    camera.cameraPos = vec3.create(1, 3, 2);
    camera.cameraFront = vec3.normalize([-1, -0.15, -0.4]);
    camera.onFrame(0);
    lights.onFrame(9000);
    await compare(stage, 'moved camera and lights');
    lights.showClusters = true;
    await compare(stage, 'cluster debug view');
    lights.showClusters = false;

    canvas.width = 360;
    canvas.height = 640;
    camera.projMat = mat4.perspective(Math.PI / 4, canvas.width / canvas.height, Camera.nearPlane, Camera.farPlane);
    camera.onFrame(0);
    await compare(stage, 'portrait projection');

    const error = await device.popErrorScope();
    if (error) throw new Error(error.message);
    if (output.dataset.status === 'failed') throw new Error('uncaptured GPU error');
    output.dataset.status = 'passed';
    report('All clustered deferred checks passed.');
}

run().catch(error => {
    output.dataset.status = 'failed';
    report(`FAIL ${error.message}`);
    console.error(error);
});
