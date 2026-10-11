@group(${bindGroup_scene}) @binding(0) var<uniform> camera: CameraUniforms;
@group(${bindGroup_scene}) @binding(2) var<storage, read> clusterSet: ClusterSet;
@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput {
    @builtin(position) pixel: vec4f,
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f {
    if (textureSample(diffuseTex, diffuseTexSampler, in.uv).a < 0.5) {
        discard;
    }

    let viewPos = camera.viewMat * vec4f(in.pos, 1);
    let index = clusterAtPixel(in.pixel.xy, -viewPos.z, camera);
    let count = clusterSet.clusters[index].numLights;
    // Blue is empty, green is 32 lights, and red is 64 or more.
    let t = min(f32(count) / 64, 1);
    var color = vec3f(t, 1 - abs(2 * t - 1), 1 - t);
    let tilePos = fract(in.pixel.xy / camera.viewport * vec2f(${clusterCountX}, ${clusterCountY}));
    if (tilePos.x < 0.025 || tilePos.y < 0.025) {
        color *= 0.35;
    }
    return vec4f(color, 1);
}
