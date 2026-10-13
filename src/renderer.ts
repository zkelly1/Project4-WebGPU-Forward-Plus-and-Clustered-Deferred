import { Scene } from './stage/scene';
import { Lights } from './stage/lights';
import { Camera } from './stage/camera';
import { Stage } from './stage/stage';
import { GpuTimer } from './timer';

export var canvas: HTMLCanvasElement;
export var canvasFormat: GPUTextureFormat;
export var context: GPUCanvasContext;
export var device: GPUDevice;
export var adapterInfo: GPUAdapterInfo;
export var gpuTimer: GpuTimer;
export var canvasTextureView: GPUTextureView;

export var aspectRatio: number;
export const fovYDegrees = 45;

export var modelBindGroupLayout: GPUBindGroupLayout;
export var materialBindGroupLayout: GPUBindGroupLayout;

// CHECKITOUT: this function initializes WebGPU and also creates some bind group layouts shared by all the renderers
export async function initWebGPU() {
    canvas = document.getElementById("mainCanvas") as HTMLCanvasElement;

    const devicePixelRatio = window.devicePixelRatio;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;

    aspectRatio = canvas.width / canvas.height;

    if (!navigator.gpu)
    {
        let errorMessageElement = document.createElement("h1");
        errorMessageElement.textContent = "This browser doesn't support WebGPU! Try using Google Chrome.";
        errorMessageElement.style.paddingLeft = '0.4em';
        document.body.innerHTML = '';
        document.body.appendChild(errorMessageElement);
        throw new Error("WebGPU not supported on this browser");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter)
    {
        throw new Error("no appropriate GPUAdapter found");
    }

    adapterInfo = adapter.info;
    device = await adapter.requestDevice({
        requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : []
    });
    gpuTimer = new GpuTimer(device);

    context = canvas.getContext("webgpu")!;
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    console.log("WebGPU init successsful");

    modelBindGroupLayout = device.createBindGroupLayout({
        label: "model bind group layout",
        entries: [
            { // modelMat
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform" }
            }
        ]
    });

    materialBindGroupLayout = device.createBindGroupLayout({
        label: "material bind group layout",
        entries: [
            { // diffuseTex
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {}
            },
            { // diffuseTexSampler
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {}
            }
        ]
    });
}

export const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
        { // pos
            format: "float32x3",
            offset: 0,
            shaderLocation: 0
        },
        { // nor
            format: "float32x3",
            offset: 12,
            shaderLocation: 1
        },
        { // uv
            format: "float32x2",
            offset: 24,
            shaderLocation: 2
        }
    ]
};

export abstract class Renderer {
    useBundles = true;
    private bundles = new Map<GPURenderPipeline, GPURenderBundle>();
    protected scene: Scene;
    protected lights: Lights;
    protected camera: Camera;

    protected stats: Stats;

    private prevTime: number = 0;
    private frameRequestId: number;

    constructor(stage: Stage) {
        this.scene = stage.scene;
        this.lights = stage.lights;
        this.camera = stage.camera;
        this.stats = stage.stats;

        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }

    stop(): void {
        cancelAnimationFrame(this.frameRequestId);
    }

    destroy(): void {
        this.stop();
        this.bundles.clear();
    }

    protected drawScene(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline,
        sceneBindGroup: GPUBindGroup, colorFormats: GPUTextureFormat[]) {
        const record = (target: GPURenderPassEncoder | GPURenderBundleEncoder) => {
            target.setPipeline(pipeline);
            target.setBindGroup(0, sceneBindGroup);
            this.scene.iterate(node => target.setBindGroup(1, node.modelBindGroup),
                material => target.setBindGroup(2, material.materialBindGroup), primitive => {
                    target.setVertexBuffer(0, primitive.vertexBuffer);
                    target.setIndexBuffer(primitive.indexBuffer, 'uint32');
                    target.drawIndexed(primitive.numIndices);
                });
        };
        if (!this.useBundles) { record(pass); return; }
        let bundle = this.bundles.get(pipeline);
        if (!bundle) {
            const encoder = device.createRenderBundleEncoder({ colorFormats, depthStencilFormat: 'depth24plus' });
            record(encoder);
            bundle = encoder.finish();
            this.bundles.set(pipeline, bundle);
        }
        pass.executeBundles([bundle]);
    }

    protected abstract draw(): void;

    // CHECKITOUT: this is the main rendering loop
    private onFrame(time: number) {
        if (this.prevTime == 0) {
            this.prevTime = time;
        }

        let deltaTime = time - this.prevTime;
        this.camera.onFrame(deltaTime);
        this.lights.onFrame(time);

        this.stats.begin();

        this.draw();

        this.stats.end();

        this.prevTime = time;
        this.frameRequestId = requestAnimationFrame((t) => this.onFrame(t));
    }
}
