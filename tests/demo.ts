import Stats from 'stats.js';
import { vec3 } from 'wgpu-matrix';
import { initWebGPU, canvas, device } from '../src/renderer';
import { Camera } from '../src/stage/camera';
import { Lights } from '../src/stage/lights';
import { Scene, setupLoaders } from '../src/stage/scene';
import { Stage } from '../src/stage/stage';
import { NaiveRenderer } from '../src/renderers/naive';
import { ForwardPlusRenderer } from '../src/renderers/forward_plus';
import { ClusteredDeferredRenderer } from '../src/renderers/clustered_deferred';
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const button=document.querySelector<HTMLButtonElement>('#record')!;
button.onclick=()=> { button.disabled=true; record().catch(error=>{status.textContent=`FAIL ${error.message}`;}); };
function download(id:string,blob:Blob,name:string) {
    if (location.search.includes("save")) {
        void fetch(`/__artifacts/${id === "#video" ? "video" : "still"}`, { method: "POST", body: blob });
    }
    const a=document.querySelector<HTMLAnchorElement>(id)!;a.href=URL.createObjectURL(blob);a.download=name;a.hidden=false;
}
async function record() {
    await initWebGPU();setupLoaders();status.textContent='Loading Sponza...';
    const scene=new Scene();await scene.loadGltf('/scenes/sponza/Sponza.gltf');
    const camera=new Camera(); const lights=new Lights(camera);
    for(let i=0;i<Lights.maxNumLights;i++) lights.lightsArray.set([0.025+(i%7)*0.01,0.07,0.03+(i%5)*0.01],i*8+4);
    device.queue.writeBuffer(lights.lightSetStorageBuffer,16,lights.lightsArray);
    const stage=new Stage(scene,lights,camera,new Stats());
    const renderers=[new NaiveRenderer(stage),new ForwardPlusRenderer(stage),new ClusteredDeferredRenderer(stage)];
    renderers.forEach(r=>r.stop());
    const target=document.querySelector<HTMLCanvasElement>('#recording')!;
    const ctx=target.getContext('2d')!;
    const stream=target.captureStream(30);
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type))!;
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4000000});
    const chunks:Blob[]=[];recorder.ondataavailable=e=>{if(e.data.size) chunks.push(e.data);};
    recorder.onstop=()=>{
        download('#video',new Blob(chunks,{type:mimeType}),'demo.webm');
        stream.getTracks().forEach(track=>track.stop());renderers.forEach(r=>r.destroy());
        status.textContent='PASS: 36-second demo recorded';
    };
    const shots=[
        {mode:0,count:500,debug:false,bundles:false,title:'Naive forward | 500 lights'},
        {mode:1,count:500,debug:false,bundles:false,title:'Forward+ | 500 lights'},
        {mode:2,count:500,debug:false,bundles:false,title:'Clustered deferred | 500 lights'},
        {mode:2,count:500,debug:true,bundles:true,title:'Cluster debug | blue 0, green 32, red 64+'},
        {mode:2,count:5000,debug:false,bundles:true,title:'Clustered deferred | 5,000 lights | render bundles'},
        {mode:1,count:5000,debug:false,bundles:true,title:'Forward+ | 5,000 lights | render bundles'}
    ];
    let start=0;let saved=false;
    recorder.start();
    function frame(time:number) {
        if(!start) start=time; const elapsed=(time-start)/1000;
        if(elapsed>=36) {recorder.stop();return;}
        const shot=shots[Math.min(5,Math.floor(elapsed/6))];
        lights.numLights=shot.count;lights.showClusters=shot.debug;lights.updateLightSetUniformNumLights();
        camera.cameraPos=vec3.create(-7+Math.sin(elapsed*0.2)*1.5,2+Math.sin(elapsed*0.13)*0.4,Math.sin(elapsed*0.1)*0.6);
        camera.cameraFront=vec3.normalize([1,0.02,0.08*Math.sin(elapsed*0.17)]);camera.onFrame(0);lights.onFrame(elapsed*1000+2000);
        renderers[shot.mode].useBundles=shot.bundles;renderers[shot.mode].draw();
        ctx.fillStyle='#0d1728';ctx.fillRect(0,0,960,600);ctx.drawImage(canvas,0,60,960,540);
        ctx.fillStyle='white';ctx.font='22px sans-serif';ctx.fillText(shot.title,20,28);
        ctx.fillStyle='#aac3e5';ctx.font='14px sans-serif';ctx.fillText('CIS 565 Project 4 | Zachary Kelly | Sponza',20,49);
        if(elapsed>14&&!saved) {saved=true;target.toBlob(blob=>{if(blob) download('#still',blob,'clustered-deferred.png');});}
        status.textContent=`Recording ${elapsed.toFixed(1)} / 36 seconds`;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
