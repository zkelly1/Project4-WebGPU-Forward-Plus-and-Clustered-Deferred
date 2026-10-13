@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read> clusterSet: ClusterSet;
@group(1) @binding(0) var positionTex: texture_2d<f32>;
@group(1) @binding(1) var normalTex: texture_2d<f32>;
@group(1) @binding(2) var albedoTex: texture_2d<f32>;
override showClusters: bool = false;

@fragment
fn main(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let coords = vec2i(pixel.xy);
    let position = textureLoad(positionTex, coords, 0);
    let normal = textureLoad(normalTex, coords, 0);
    if (position.w == 0) { return vec4f(0); }
    let viewPos = camera.viewMat * vec4f(position.xyz, 1);
    let index = clusterAtPixel(pixel.xy, -viewPos.z, camera);
    let cluster = &clusterSet.clusters[index];
    if (showClusters) {
        let t = min(f32((*cluster).numLights) / 64, 1);
        var color = vec3f(t, 1 - abs(2 * t - 1), 1 - t);
        let tilePos = fract(pixel.xy / camera.viewport * vec2f(${clusterCountX}, ${clusterCountY}));
        if (tilePos.x < 0.025 || tilePos.y < 0.025) { color *= 0.35; }
        return vec4f(color, 1);
    }
    let albedo = textureLoad(albedoTex, coords, 0).rgb;
    let nor = normalize(normal.xyz);
    var light = vec3f(0);
    for (var i = 0u; i < (*cluster).numLights; i++) {
        light += calculateLightContrib(lightSet.lights[(*cluster).lightIndices[i]], position.xyz, nor);
    }
    return vec4f(albedo * light, 1);
}
