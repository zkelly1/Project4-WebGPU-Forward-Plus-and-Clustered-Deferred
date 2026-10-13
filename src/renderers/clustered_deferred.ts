import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredDeferredRenderer extends renderer.Renderer {
    depthTexture: GPUTexture;
    gBufferTextures: GPUTexture[];
    private sceneBindGroup: GPUBindGroup;
    private gBufferBindGroup: GPUBindGroup;
    private geometryPipeline: GPURenderPipeline;
    private lightingPipeline: GPURenderPipeline;
    private debugPipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);
        const device = renderer.device;
        const sceneLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
        ] });
        this.sceneBindGroup = device.createBindGroup({ layout: sceneLayout, entries: [
            { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
            { binding: 1, resource: { buffer: this.lights.lightSetStorageBuffer } },
            { binding: 2, resource: { buffer: this.lights.clusterSetStorageBuffer } }
        ] });
        const size = [renderer.canvas.width, renderer.canvas.height];
        this.depthTexture = device.createTexture({ size, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        // Keep position at full precision; normal and albedo use compact attachments.
        this.gBufferTextures = (['rgba32float', 'rgba16float', 'rgba16float'] as GPUTextureFormat[]).map(format =>
            device.createTexture({ label: 'G-buffer ' + format, size, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
        const gBufferLayout = device.createBindGroupLayout({ entries: [0, 1, 2].map(binding => ({
            binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' as GPUTextureSampleType }
        })) });
        this.gBufferBindGroup = device.createBindGroup({ layout: gBufferLayout, entries: this.gBufferTextures.map((texture, binding) => ({ binding, resource: texture.createView() })) });
        this.geometryPipeline = device.createRenderPipeline({
            label: 'deferred G-buffer',
            layout: device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, renderer.modelBindGroupLayout, renderer.materialBindGroupLayout] }),
            vertex: { module: device.createShaderModule({ code: shaders.naiveVertSrc }), buffers: [renderer.vertexBufferLayout] },
            fragment: { module: device.createShaderModule({ code: shaders.clusteredDeferredFragSrc }), targets: [{ format: 'rgba32float' }, { format: 'rgba16float' }, { format: 'rgba16float' }] },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
        });
        const lightingLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneLayout, gBufferLayout] });
        const makeLightingPipeline = (debug: boolean) => device.createRenderPipeline({
            label: debug ? 'deferred cluster debug' : 'deferred lighting',
            layout: lightingLayout,
            vertex: { module: device.createShaderModule({ code: shaders.clusteredDeferredFullscreenVertSrc }) },
            fragment: { module: device.createShaderModule({ code: shaders.clusteredDeferredFullscreenFragSrc }), constants: { showClusters: debug ? 1 : 0 }, targets: [{ format: renderer.canvasFormat }] }
        });
        this.lightingPipeline = makeLightingPipeline(false);
        this.debugPipeline = makeLightingPipeline(true);
    }

    override destroy() {
        super.destroy();
        this.depthTexture.destroy();
        this.gBufferTextures.forEach(texture => texture.destroy());
    }

    override draw() {
        renderer.gpuTimer.begin();
        const encoder = renderer.device.createCommandEncoder();
        this.lights.doLightClustering(encoder);
        const geometry = encoder.beginRenderPass({
            label: 'G-buffer pass',
            timestampWrites: renderer.gpuTimer.pass('geometry'),
            colorAttachments: this.gBufferTextures.map(texture => ({ view: texture.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' })),
            depthStencilAttachment: { view: this.depthTexture.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' }
        });
        this.drawScene(geometry, this.geometryPipeline, this.sceneBindGroup,
            ['rgba32float', 'rgba16float', 'rgba16float']);
        geometry.end();
        const lighting = encoder.beginRenderPass({ timestampWrites: renderer.gpuTimer.pass('lighting'), colorAttachments: [{ view: renderer.context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
        lighting.setPipeline(this.lights.showClusters ? this.debugPipeline : this.lightingPipeline);
        lighting.setBindGroup(0, this.sceneBindGroup);
        lighting.setBindGroup(1, this.gBufferBindGroup);
        lighting.draw(3);
        lighting.end();
        renderer.gpuTimer.resolve(encoder);
        renderer.device.queue.submit([encoder.finish()]);
    }
}
