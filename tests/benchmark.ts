import Stats from 'stats.js';
import { mat4 } from 'wgpu-matrix';
import { initWebGPU, device, canvas, adapterInfo, gpuTimer } from '../src/renderer';
import { Camera } from '../src/stage/camera';
import { Lights } from '../src/stage/lights';
import { Scene, setupLoaders } from '../src/stage/scene';
import { Stage } from '../src/stage/stage';
import { NaiveRenderer } from '../src/renderers/naive';
import { ForwardPlusRenderer } from '../src/renderers/forward_plus';
import { ClusteredDeferredRenderer } from '../src/renderers/clustered_deferred';

const output = document.querySelector<HTMLPreElement>('#results')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const median = (values: number[]) => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
start.onclick = () => { start.disabled = true; run().catch(error => { output.textContent += `\nFAIL ${error.message}`; }); };
async function run() {
    await initWebGPU();
    if (!device.features.has('timestamp-query')) throw new Error('GPU timestamp queries unavailable; no GPU timings fabricated.');
    let gpuError = '';
    device.addEventListener('uncapturederror', event => { gpuError = event.error.message; });
    setupLoaders();
    const scene = new Scene();
    output.textContent = 'Loading scene...';
    await scene.loadGltf('/scenes/sponza/Sponza.gltf');
    const camera = new Camera();
    const lights = new Lights(camera);
    for (let i=0; i<Lights.maxNumLights; i++) lights.lightsArray.set([0.06,0.08,0.05], i*8+4);
    device.queue.writeBuffer(lights.lightSetStorageBuffer,16,lights.lightsArray);
    const stage = new Stage(scene,lights,camera,new Stats());
    const results: object[] = [];
    const metadata = { date: new Date().toISOString(), userAgent: navigator.userAgent,
        gpu: { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture, device: adapterInfo.device, description: adapterInfo.description },
        warmup: 12, samples: 40, rounds: 2, clusterGrid: [16,9,24], method: 'GPU timestamp pass durations; CPU draw() wall time; queue drained each frame; fixed camera and light time 2000ms' };
    output.textContent = JSON.stringify(metadata,null,2);
    for (const [width,height] of [[640,360],[1280,720]]) {
        canvas.width=width; canvas.height=height;
        camera.projMat=mat4.perspective(Math.PI/4,width/height,Camera.nearPlane,Camera.farPlane);
        camera.onFrame(0);
        for (const count of [1,500,1000,2500,5000]) {
            lights.numLights=count; lights.updateLightSetUniformNumLights(); lights.onFrame(2000);
            await device.queue.onSubmittedWorkDone();
            for (const [name,Type] of [['Naive',NaiveRenderer],['Forward+',ForwardPlusRenderer],['Deferred',ClusteredDeferredRenderer]] as const) {
                const renderer=new Type(stage); renderer.stop();
                const samples = new Map<boolean, {cpu:number[], gpu:number[], passes:Record<string,number[]>}>();
                for (const bundled of [false,true]) samples.set(bundled,{cpu:[],gpu:[],passes:{}});
                for (let round=0;round<2;round++) {
                    // Reverse the order in the second round to reduce ordering bias.
                    for (const bundled of round===0 ? [false,true] : [true,false]) {
                        renderer.useBundles=bundled; gpuTimer.enabled=false;
                        for (let i=0;i<12;i++) { renderer.draw(); await device.queue.onSubmittedWorkDone(); }
                        gpuTimer.enabled=true;
                        const sample=samples.get(bundled)!;
                        for(let i=0;i<20;i++) {
                            const begin=performance.now(); renderer.draw(); sample.cpu.push(performance.now()-begin);
                            const passes=await gpuTimer.read();
                            sample.gpu.push(Object.values(passes).reduce((a,b)=>a+b,0));
                            for(const [label,value] of Object.entries(passes)) (sample.passes[label]??=[]).push(value);
                            if(gpuError) throw new Error(gpuError);
                        }
                        gpuTimer.enabled=false;
                    }
                }
                for (const [bundles,sample] of samples) {
                    const row={ width,height,lights:count,renderer:name,bundles,cpuMs:median(sample.cpu),gpuMs:median(sample.gpu),
                        passes:Object.fromEntries(Object.entries(sample.passes).map(([key,values])=>[key,median(values)])),raw:sample };
                    results.push(row);
                    output.textContent += `\n${width}x${height} ${count} ${name} bundles=${bundles}: CPU ${row.cpuMs.toFixed(3)} ms GPU ${row.gpuMs.toFixed(3)} ms`;
                }
                renderer.destroy();
                await new Promise(resolve=>requestAnimationFrame(resolve));
            }
        }
    }
    const report={metadata,results};
    const link=document.querySelector<HTMLAnchorElement>('#download')!;
    link.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    link.download='benchmark.json';link.hidden=false;
    if (location.search.includes('save')) {
        const response = await fetch('/__artifacts/benchmark', { method: 'POST', body: JSON.stringify(report, null, 2) });
        if (!response.ok) throw new Error('Could not save benchmark');
    }
    output.textContent+='\nPASS benchmark complete';
}
